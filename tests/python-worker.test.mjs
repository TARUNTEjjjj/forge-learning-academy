import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

// Runs the production worker sources with the pinned Pyodide npm package in a Node worker thread.
// The host plays the sandbox's part: it hands the worker the runtime files, sends the run payload
// after "ready" and, like a browser worker, turns an unhandled promise rejection into an
// "unhandledrejection" event on self. Node cannot import blob: URLs, so the host serves each module
// blob from the runtime folder, and only when its bytes are exactly the file of that name.
const runtime = dirname(createRequire(import.meta.url).resolve("pyodide/package.json")) + "/";
const RUNTIME_FILES = JSON.parse(readFileSync(new URL("../scripts/python-runtime-manifest.json", import.meta.url), "utf8")).files.map(file => file.name);
const WORKERS = {
  current: readFileSync(new URL("../lib/python-worker.js", import.meta.url), "utf8"),
  // The compatibility worker loads the same release from jsDelivr; runWorker swaps in a local copy.
  compatibility: readFileSync(new URL("../public/python-worker.js", import.meta.url), "utf8"),
};
const HOST = `
const { parentPort, workerData } = require("node:worker_threads");
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const files = {};
for (const name of workerData.files) {
  try { const bytes = readFileSync(workerData.runtime + name); files[name] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length); } catch {}
}
const blobs = new WeakMap();
const NodeBlob = globalThis.Blob;
globalThis.Blob = class extends NodeBlob {
  constructor(parts, options) { super(parts, options); blobs.set(this, Buffer.concat(parts.map(part => Buffer.from(part)))); }
};
URL.createObjectURL = blob => {
  const name = Object.keys(files).find(key => Buffer.from(files[key]).equals(blobs.get(blob)));
  if (!name) throw new Error("The worker made a blob that is not a runtime file.");
  return pathToFileURL(workerData.runtime + name).href;
};
const self = new EventTarget();
self.postMessage = message => {
  parentPort.postMessage(message);
  if (message && message.type === "ready") self.onmessage({ data: workerData.payload });
};
process.on("unhandledRejection", reason => self.dispatchEvent(Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason })));
new Function("self", "runtimeBase", workerData.source)(self, workerData.runtime);
self.onmessage({ data: { type: "runtime", files } });
`;
const progress = "def progress(completed, goal):\n    return 0 if goal <= 0 else max(0, min(100, completed * 100 // goal))\n";

/** Resolves with every message the worker posted once its thread goes idle and exits. */
function runWorker(source, code, base = runtime) {
  return new Promise((resolve, reject) => {
    const payload = { type: "run", code, functionName: "progress", cases: [[1, 2], [0, 0]] };
    const workerData = { source: source.replaceAll("https://cdn.jsdelivr.net/pyodide/v314.0.1/full/", base), runtime: base, payload, files: RUNTIME_FILES };
    const host = new Worker(HOST, { eval: true, stdout: true, stderr: true, workerData });
    const messages = []; let logs = "";
    for (const stream of [host.stdout, host.stderr]) stream.on("data", chunk => { logs += chunk; });
    const timer = setTimeout(() => host.terminate(), 60_000);
    host.on("message", message => messages.push(message));
    host.on("error", error => { clearTimeout(timer); reject(error); });
    host.on("exit", () => { clearTimeout(timer); resolve({ messages, logs: logs.slice(-2000) }); });
  });
}

test("Python worker console output keeps text printed without a trailing newline", { timeout: 120_000 }, async () => {
  const code = 'import sys\nprint("first line")\nprint("partial", end="")\nsys.stdout.flush()\n'
    + 'sys.stderr.write("warning")\nsys.stderr.flush()\nprint(" tail", end="")\n'
    + 'def progress(completed, goal):\n    print(completed, end=" ")\n    return 0 if goal <= 0 else max(0, min(100, completed * 100 // goal))\n';
  const runs = await Promise.all(Object.values(WORKERS).map(source => runWorker(source, code)));
  for (const [index, name] of Object.keys(WORKERS).entries()) {
    const { messages, logs } = runs[index];
    const result = messages.find(message => message.type === "result");
    assert.ok(result, `${name}: ${JSON.stringify(messages)} ${logs}`);
    assert.deepEqual(result.payload.results.map(item => item.value), [50, 0], name);
    // Exactly what CPython prints: buffered text is flushed when the program ends.
    assert.equal(result.output, "first line\npartialwarning tail1 0 ", name);
  }
});

test("Python worker reports a fatal interpreter error at once instead of leaving the run to time out", { timeout: 120_000 }, async () => {
  // Both leave runPythonAsync pending forever; the only signal is an unhandled rejection.
  const fatal = {
    "os._exit": ["import os\nos._exit(0)\n" + progress, /exit\(0\)/],
    "deep recursion": ["import sys\nsys.setrecursionlimit(100000)\ndef progress(completed, goal):\n    return progress(completed, goal)\n", /Maximum call stack size exceeded/],
  };
  const jobs = Object.entries(WORKERS).flatMap(([name, source]) => Object.entries(fatal).map(([label, [code, cause]]) => ({ label: `${name} worker, ${label}`, source, code, cause })));
  const runs = await Promise.all(jobs.map(job => runWorker(job.source, job.code)));
  jobs.forEach(({ label, cause }, index) => {
    const { messages, logs } = runs[index];
    assert.deepEqual(messages.map(message => message.type), ["ready", "error"], `${label}: ${JSON.stringify(messages)} ${logs}`);
    assert.match(messages[1].message, /^Python stopped unexpectedly/, label);
    assert.match(messages[1].message, cause, label);
  });
});

test("Python worker reports a runtime file that fails to load as a load failure, without waiting", { timeout: 120_000 }, async (t) => {
  // Without pyodide.asm.wasm, the compatibility worker's loading never settles; only an unhandled rejection
  // reports it. The current worker is handed the files and rejects a missing one before Pyodide starts.
  const broken = await mkdtemp(join(tmpdir(), "forge-broken-runtime-"));
  t.after(() => rm(broken, { recursive: true, force: true }));
  for (const name of ["pyodide.mjs", "pyodide.asm.mjs", "python_stdlib.zip", "pyodide-lock.json"]) await copyFile(runtime + name, join(broken, name));
  const runs = await Promise.all(Object.values(WORKERS).map(source => runWorker(source, progress, broken + "/")));
  for (const [index, name] of Object.keys(WORKERS).entries()) {
    const { messages, logs } = runs[index];
    assert.equal(messages[0]?.type, "error", `${name}: ${JSON.stringify(messages)} ${logs}`);
    for (const message of messages) assert.match(message.message, /^Python could not load\./, name);
  }
});
