// Pinned to the version documented at https://pyodide.org/en/314.0.1/usage/webworker.html.
// Runs only inside an opaque-origin sandbox iframe. Never pass credentials to this worker.
// A classic blob bootstrap dynamically imports the ES-module runtime: unlike a module
// blob worker, this also starts inside WebKit's opaque-origin sandbox. No importScripts.
let output = "";
const send = self.postMessage.bind(self);
// Capture raw writes: Pyodide's line-batched stdout/stderr callbacks drop text printed
// without a trailing newline. Output stays bounded to 4000 characters.
const capture = () => {
  const decoder = new TextDecoder();
  return { write: (buffer) => { if (output.length < 4000) output += decoder.decode(buffer, { stream: true }).slice(0, 4000 - output.length); return buffer.length; } };
};
// runtimeBase is injected by the bundled app; only versioned public assets are allowed.
const ready = import(runtimeBase + "pyodide.mjs").then(({ loadPyodide }) => loadPyodide({ indexURL: runtimeBase })).then((pyodide) => {
  pyodide.setStdout(capture());
  pyodide.setStderr(capture());
  return pyodide;
});

ready.then(() => send({ type: "ready" })).catch((error) => {
  send({ type: "error", message: "Python could not load. Check your connection, then try again. Your code is still here. " + String(error).slice(0, 300) });
});

let used = false;
self.onmessage = async (event) => {
  if (used) return;
  const payload = event.data;
  if (!payload || payload.type !== "run" || typeof payload.code !== "string" || payload.code.length > 30000 ||
      typeof payload.functionName !== "string" || !/^[a-z_][a-z0-9_]*$/i.test(payload.functionName) ||
      !Array.isArray(payload.cases) || payload.cases.length > 30) return;
  used = true;
  try {
    const pyodide = await ready;
    // Capture the runner's imports before learner code executes. This is practice feedback,
    // never a trusted grade or a security boundary; the iframe sandbox supplies isolation.
    pyodide.globals.set("__forge_payload", JSON.stringify({ code: payload.code, functionName: payload.functionName, cases: payload.cases }));
    const raw = await pyodide.runPythonAsync(`
import json as _forge_json
import sys as _forge_sys
import traceback as _forge_traceback
import copy as _forge_copy

def _forge_check():
    data = _forge_json.loads(__forge_payload)
    namespace = {"__name__": "__learner__"}
    result = {"results": [], "error": None}
    try:
        exec(compile(data["code"], "solution.py", "exec"), namespace)
        fn = namespace.get(data["functionName"])
        if not callable(fn):
            result["error"] = "Define a function named " + data["functionName"] + " so the app can call it."
            return _forge_json.dumps(result)
    except SyntaxError as error:
        line = error.lineno or 1
        result["error"] = "Python paused near line " + str(line) + ": " + str(error.msg) + ". Check the surrounding line, colon, brackets, and indentation, then try again."
        return _forge_json.dumps(result)
    except BaseException as error:
        result["error"] = type(error).__name__ + ": " + str(error)[:500]
        return _forge_json.dumps(result)
    for args in data["cases"]:
        try:
            original = _forge_copy.deepcopy(args)
            value = fn(*args)
            # Round-trip to ensure values crossing the boundary are ordinary JSON.
            value = _forge_json.loads(_forge_json.dumps(value, allow_nan=False))
            result["results"].append({"value": value, "error": None, "mutated": args != original})
        except BaseException as error:
            result["results"].append({"value": None, "error": type(error).__name__ + ": " + str(error)[:500], "mutated": False})
    return _forge_json.dumps(result, allow_nan=False)

def _forge_run():
    try:
        return _forge_check()
    finally:
        # Like CPython at exit, flush text that is still buffered without a final newline.
        for stream in (_forge_sys.stdout, _forge_sys.stderr, _forge_sys.__stdout__, _forge_sys.__stderr__):
            try:
                stream.flush()
            except BaseException:
                pass

_forge_run()
`);
    if (typeof raw !== "string" || raw.length > 200000) throw new Error("The result is too large. Return a small value matching the contract.");
    send({ type: "result", payload: JSON.parse(raw), output: output.slice(0, 4000) });
  } catch (error) {
    send({ type: "error", message: String(error instanceof Error ? error.message : error).slice(0, 1000), output: output.slice(0, 4000) });
  }
};
