import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import test from "node:test";
import ts from "typescript";

// Loads lib/python-runtime.ts as the app bundles it, with the committed manifest inlined and fetch replaced.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = JSON.parse(read("../scripts/python-runtime-manifest.json"));
const source = read("../lib/python-runtime.ts").replace('import manifest from "../scripts/python-runtime-manifest.json";', `const manifest = ${JSON.stringify(manifest)};`);
const loader = () => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}#${Math.random()}`);
const runtime = dirname(createRequire(import.meta.url).resolve("pyodide/package.json")) + "/";
const BASE = "https://forge.test/runtime/pyodide/314.0.1/";

function serve(t, respond = name => readFileSync(runtime + name)) {
  const requests = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const name = String(url).slice(BASE.length);
    const body = respond(name);
    return body instanceof Response ? body : new Response(body);
  };
  t.after(() => { globalThis.fetch = saved; });
  return requests;
}

test("the page verifies every runtime file once and reuses the verified bytes for later runs", async (t) => {
  const requests = serve(t);
  const { loadPythonRuntime, runtimeBase, RUNTIME_FILES } = await loader();
  assert.equal(runtimeBase("https://forge.test/#practice"), BASE);
  assert.deepEqual(RUNTIME_FILES, manifest.files.map(file => file.name));
  const files = await loadPythonRuntime(BASE);
  for (const file of manifest.files) {
    assert.ok(files[file.name] instanceof ArrayBuffer, file.name);
    assert.equal(createHash("sha256").update(Buffer.from(files[file.name])).digest("hex"), file.sha256);
  }
  assert.deepEqual(requests.map(request => request.url), manifest.files.map(file => BASE + file.name));
  assert.ok(requests.every(request => request.init?.credentials === "omit"), "runtime requests carry no credentials");
  assert.equal(await loadPythonRuntime(BASE), files, "a later run reuses the same verified bytes");
  assert.equal(requests.length, manifest.files.length, "a later run makes no requests");
});

test("a changed, truncated or failed runtime file is never used, and the next run retries", async (t) => {
  let mode = "changed";
  const requests = serve(t, name => {
    const bytes = readFileSync(runtime + name);
    if (name !== "python_stdlib.zip") return bytes;
    if (mode === "changed") { const copy = Buffer.from(bytes); copy[100] ^= 1; return copy; }
    if (mode === "truncated") return bytes.subarray(0, bytes.length - 1);
    if (mode === "missing") return new Response("Not found", { status: 404 });
    return bytes;
  });
  const { loadPythonRuntime } = await loader();
  await assert.rejects(loadPythonRuntime(BASE), /python_stdlib\.zip did not match the pinned Python 314\.0\.1 runtime/);
  mode = "truncated";
  await assert.rejects(loadPythonRuntime(BASE), /python_stdlib\.zip did not match/);
  mode = "missing";
  await assert.rejects(loadPythonRuntime(BASE), /python_stdlib\.zip returned HTTP 404/);
  mode = "intact";
  const files = await loadPythonRuntime(BASE);
  assert.equal(files["python_stdlib.zip"].byteLength, manifest.files.find(file => file.name === "python_stdlib.zip").bytes);
  assert.equal(requests.length, manifest.files.length * 4, "each failed load is retried in full by the next run");
});

test("without Web Crypto, the page refuses to use an unverified runtime", async (t) => {
  const requests = serve(t);
  const saved = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  t.after(() => Object.defineProperty(globalThis, "crypto", saved));
  const { loadPythonRuntime } = await loader();
  await assert.rejects(loadPythonRuntime(BASE), /cannot verify the Python runtime/);
  assert.equal(requests.length, 0);
});

test("a stalled runtime download is abandoned and the next run starts a new one, while a slow one is not cut off", async (t) => {
  // Like a browser fetch: aborting the signal rejects a pending response and errors a body being read.
  let mode = "stall-body";
  const requests = [];
  const saved = globalThis.fetch;
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    requests.push(String(url));
    const name = String(url).slice(BASE.length), bytes = readFileSync(runtime + name);
    const aborted = () => init.signal.reason ?? new DOMException("Aborted", "AbortError");
    init.signal.addEventListener("abort", () => reject(aborted()));
    if (mode === "stall-headers" && name === "python_stdlib.zip") return;
    let sent = 0, timer;
    resolve(new Response(new ReadableStream({
      start(controller) { init.signal.addEventListener("abort", () => { clearTimeout(timer); try { controller.error(aborted()); } catch {} }); },
      pull(controller) {
        if (sent >= bytes.length) { controller.close(); return; }
        if (mode === "stall-body" && name === "python_stdlib.zip" && sent > 0) return new Promise(() => {});
        // "slow": every chunk arrives after a pause shorter than the idle limit, for longer than the limit overall.
        return new Promise(done => { timer = setTimeout(() => { const size = Math.ceil(bytes.length / (mode === "slow" ? 4 : 2)); controller.enqueue(bytes.subarray(sent, sent + size)); sent += size; done(); }, mode === "slow" ? 30 : 0); });
      },
    })));
  });
  t.after(() => { globalThis.fetch = saved; });
  const { loadPythonRuntime } = await loader();
  await assert.rejects(loadPythonRuntime(BASE, 50), /python_stdlib\.zip stopped downloading/);
  mode = "stall-headers";
  await assert.rejects(loadPythonRuntime(BASE, 50), /python_stdlib\.zip stopped downloading/);
  assert.equal(requests.length, manifest.files.length * 2, "each stalled load is retried in full by the next run");
  mode = "slow";
  const files = await loadPythonRuntime(BASE, 50);
  assert.equal(Object.keys(files).length, manifest.files.length);
});

test("a runtime file larger than the pinned one is refused without buffering the rest", async (t) => {
  let cancelled = false;
  serve(t, name => {
    const bytes = readFileSync(runtime + name);
    if (name !== "pyodide-lock.json") return bytes;
    // An endless body: the loader must stop at the pinned size and cancel it.
    return new Response(new ReadableStream({ pull(controller) { controller.enqueue(bytes.subarray(0, 4096)); }, cancel() { cancelled = true; } }));
  });
  const { loadPythonRuntime } = await loader();
  await assert.rejects(loadPythonRuntime(BASE), /pyodide-lock\.json did not match the pinned Python 314\.0\.1 runtime/);
  assert.ok(cancelled, "reading stops once the file is larger than the pinned one");
});

test("the pinned Pyodide honours createPyodideModule, the undocumented option the worker relies on", () => {
  // python-worker.js passes the verified pyodide.asm.mjs as createPyodideModule so that loadPyodide never imports
  // indexURL + "pyodide.asm.mjs" from the network (the sandbox policy would block it). The option is not part of
  // Pyodide's documented API, so this checks the exact release shipped: an upgrade changes the manifest and must
  // keep this short-circuit, or change the worker.
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(pkg.devDependencies.pyodide, manifest.version, "Pyodide is pinned to the exact manifest release");
  const loaderFile = readFileSync(runtime + "pyodide.mjs");
  assert.equal(createHash("sha256").update(loaderFile).digest("hex"), manifest.files.find(file => file.name === "pyodide.mjs").sha256, "the checked pyodide.mjs is the one the app ships");
  const text = loaderFile.toString("utf8");
  const shortCircuit = /async function (\w+)\((\w)\)\{if\(\2\.createPyodideModule\)return \2\.createPyodideModule;let \w=`\$\{\2\.indexURL\}pyodide\.asm\.mjs`;/.exec(text);
  assert.ok(shortCircuit, "pyodide.mjs returns a given createPyodideModule before importing pyodide.asm.mjs");
  assert.match(text, new RegExp(`await ${shortCircuit[1]}\\(\\w\\)`), "loadPyodide calls that loader with its config");
  const worker = read("../lib/python-worker.js");
  assert.match(worker, /loadPyodide\(\{ indexURL: runtimeBase, createPyodideModule \}\)/);
});
