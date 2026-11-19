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
