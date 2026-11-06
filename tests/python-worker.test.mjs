import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

// Runs the production worker sources with the pinned Pyodide npm package in a Node worker thread.
// The host plays the sandbox's part: it sends the run payload after "ready" and, like a browser
// worker, turns an unhandled promise rejection into an "unhandledrejection" event on self.
const runtime = dirname(createRequire(import.meta.url).resolve("pyodide/package.json")) + "/";
const WORKERS = {
  current: readFileSync(new URL("../lib/python-worker.js", import.meta.url), "utf8"),
  // The compatibility worker loads the same release from jsDelivr; use the local copy offline.
  compatibility: readFileSync(new URL("../public/python-worker.js", import.meta.url), "utf8").replaceAll("https://cdn.jsdelivr.net/pyodide/v314.0.1/full/", runtime),
};
const HOST = `
const { parentPort, workerData } = require("node:worker_threads");
const self = new EventTarget();
self.postMessage = message => {
  parentPort.postMessage(message);
  if (message && message.type === "ready") self.onmessage({ data: workerData.payload });
};
process.on("unhandledRejection", reason => self.dispatchEvent(Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason })));
new Function("self", "runtimeBase", workerData.source)(self, workerData.runtime);
`;
const progress = "def progress(completed, goal):\n    return 0 if goal <= 0 else max(0, min(100, completed * 100 // goal))\n";

/** Resolves with every message the worker posted once its thread goes idle and exits. */
function runWorker(source, code) {
  return new Promise((resolve, reject) => {
    const payload = { type: "run", code, functionName: "progress", cases: [[1, 2], [0, 0]] };
    const host = new Worker(HOST, { eval: true, stdout: true, stderr: true, workerData: { source, runtime, payload } });
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
