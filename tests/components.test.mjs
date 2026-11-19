import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import * as React from "./react-stand-in.mjs";

// Renders the real Practice and Projects components with React replaced by ./react-stand-in.mjs, and drives them
// through their own event handlers, as a learner would.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const dataUrl = js => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
/** Imports a component with React swapped for the stand-in, icons for empty components, and its modules as given. */
async function component(path, modules) {
  const source = read(path);
  const icons = /import \{([^}]+)\} from "lucide-react"/.exec(source)[1].split(",").map(name => name.trim()).filter(Boolean);
  let js = transpile(source);
  const standIn = new URL("./react-stand-in.mjs", import.meta.url).href;
  for (const [specifier, url] of Object.entries({ "react/jsx-runtime": standIn, react: standIn, "lucide-react": dataUrl(icons.map(name => `export const ${name} = () => null;`).join("\n")), ...modules })) {
    assert.ok(js.includes(`from "${specifier}"`), `${path} no longer imports ${specifier}`);
    js = js.replaceAll(`from "${specifier}"`, `from ${JSON.stringify(url)}`);
  }
  return import(dataUrl(js));
}
const missionsUrl = dataUrl(transpile(read("../lib/missions.ts")));
const progressUrl = dataUrl(transpile(read("../lib/progress.ts")));
const filesUrl = dataUrl(transpile(read("../lib/project-files.ts")));
const draftsUrl = dataUrl(transpile(read("../lib/draft-store.ts")).replace('"./project-files"', JSON.stringify(filesUrl)));
const Practice = (await component("../app/components/Practice.tsx", { "../../lib/python-worker.js?raw": dataUrl(`export default ${JSON.stringify(read("../lib/python-worker.js"))};`), "../../lib/missions": missionsUrl })).default;
const Projects = (await component("../app/components/Projects.tsx", { "../../lib/progress": progressUrl, "../../lib/project-files": filesUrl, "../../lib/draft-store": draftsUrl })).default;
const [missions, progress, files, drafts] = await Promise.all([missionsUrl, progressUrl, filesUrl, draftsUrl].map(url => import(url)));

// The browser pieces the components touch: storage, and a sandbox iframe that records what the app posts to it.
const stored = new Map();
globalThis.localStorage = {
  get length() { return stored.size; }, key(index) { return [...stored.keys()][index] ?? null; },
  getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { stored.set(key, String(value)); }, removeItem(key) { stored.delete(key); },
};
globalThis.window = Object.assign(new EventTarget(), { location: { href: "https://forge.test/" } });
globalThis.HTMLElement = class HTMLElement {};
class SandboxFrame {
  style = {}; posted = []; removed = false;
  contentWindow = { postMessage: message => this.posted.push(message) };
  setAttribute() {}
  set srcdoc(html) { this.nonce = JSON.parse(/const nonce = ("[^"]+");/.exec(html)[1]); }
  remove() { this.removed = true; }
}
const frames = [];
globalThis.document = { activeElement: null, body: { appendChild() {} }, createElement: () => { const frame = new SandboxFrame(); frames.push(frame); return frame; } };
/** Replaces setTimeout until restore(): the lab's 60-second, 8-second and 1-second limits run when advanced. */
function fakeTimers() {
  const saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const pending = new Map(); let now = 0, id = 0;
  globalThis.setTimeout = (callback, delay = 0) => { pending.set(++id, { at: now + delay, callback }); return id; };
  globalThis.clearTimeout = key => { pending.delete(key); };
  return {
    advance(ms) {
      for (let due; (due = [...pending].filter(([, timer]) => timer.at <= now + ms).sort(([, a], [, b]) => a.at - b.at)[0]);) {
        pending.delete(due[0]); ms -= due[1].at - now; now = due[1].at; due[1].callback(); React.flush();
      }
      now += ms;
    },
    restore() { Object.assign(globalThis, saved); },
  };
}
/** What the sandbox would forward from the Python worker. */
function fromSandbox(frame, data) {
  window.dispatchEvent(Object.assign(new Event("message"), { source: frame.contentWindow, data: { nonce: frame.nonce, data } }));
  React.flush();
}
function lab(userKey) {
  const results = [];
  React.render(React.jsx(Practice, { userKey, onResult: result => results.push(result) }));
  const only = (match, name) => { const found = React.findAll(match); assert.equal(found.length, 1, `expected one ${name}`); return found[0]; };
  const button = label => only(node => node.type === "button" && React.text(node).trim() === label, `"${label}" button`);
  const inside = (className, type) => { const box = React.findAll(node => React.hasClass(node, className))[0]; return box ? React.text(React.findAll(node => node.type === type, box)[0]) : null; };
  return {
    results,
    click(label) { const target = button(label); assert.ok(!target.props.disabled, `${label} is disabled`); target.props.onClick(); React.flush(); },
    /** Clicks Check solution and returns the sandbox it created. */
    check() { only(node => React.hasClass(node, "lab-primary"), "Check solution button").props.onClick(); React.flush(); return frames.at(-1); },
    type(code) { only(node => node.type === "textarea", "editor").props.onChange({ target: { value: code } }); React.flush(); },
    editor: () => only(node => node.type === "textarea", "editor").props.value,
    feedback: () => React.findAll(node => React.hasClass(node, "lab-feedback")).map(React.text)[0] ?? null,
    error: () => inside("lab-error", "p"),
    console: () => inside("lab-output", "pre"),
  };
}
const CORRECT = "def progress(completed, goal):\n    return 0 if goal <= 0 else max(0, min(100, completed * 100 // goal))\n";
const progressMission = missions.MISSIONS.find(mission => mission.id === "progress");
const passing = { error: null, results: progressMission.tests.map(test => ({ value: test.expected, error: null, mutated: false })) };

test("confirming Reset during a run stops that run first, as Stop and switching missions do", () => {
  // The confirmation can stay open while a run starts. A run left going would put its result, its 8-second limit
  // and its progress report beside the starter code.
  const timers = fakeTimers();
  try {
    const view = lab("reset-during-run");
    view.type(CORRECT); view.click("Reset code");
    const frame = view.check();
    fromSandbox(frame, { type: "ready" });
    assert.equal(frame.posted.find(message => message.type === "run")?.payload.code, CORRECT);
    view.click("Reset");
    assert.ok(frame.posted.some(message => message.type === "stop"), "the run's sandbox is told to stop");
    fromSandbox(frame, { type: "result", payload: passing, output: "" });
    timers.advance(8000);
    assert.equal(view.editor(), progressMission.starter); assert.equal(view.feedback(), null);
    assert.deepEqual(view.results, []); assert.equal(localStorage.getItem("forge.lab.user.reset-during-run.completed"), null);
    // A reset while Python is still loading: the discarded code never reaches the worker.
    view.type(CORRECT); view.click("Reset code");
    const loading = view.check();
    view.click("Reset"); fromSandbox(loading, { type: "ready" });
    assert.ok(!loading.posted.some(message => message.type === "run")); assert.equal(view.feedback(), null); assert.deepEqual(view.results, []);
  } finally { React.unmount(); timers.restore(); }
});

test("the lab shows console output when the worker stops with an error or returns a result it cannot use, as it does with a result", () => {
  // The worker sends what the program printed with every result and with errors: after os._exit(), very deep
  // recursion, a result too large to send or one the lab rejects, those prints are what the learner needs to debug.
  const timers = fakeTimers();
  try {
    const tooLong = Array.from({ length: 10_001 }, () => 0);
    for (const [name, message, error] of [
      ["a result", { type: "result", payload: passing, output: "debug: checked\n" }, null],
      ["an error that stopped Python", { type: "error", message: "Python stopped unexpectedly: Exit: Program terminated with exit(0).", output: "debug: loaded input\n" }, /^Python stopped unexpectedly/],
      ["a result the lab cannot use", { type: "result", payload: { error: null, results: passing.results.map(item => ({ ...item, value: tooLong })) }, output: "debug: about to return\n" }, /^The program returned an unexpected result format/],
    ]) {
      const view = lab(`console-${name.replaceAll(" ", "-")}`);
      view.type(CORRECT); const frame = view.check();
      fromSandbox(frame, { type: "ready" }); fromSandbox(frame, message);
      assert.equal(view.console(), message.output, name);
      if (error) assert.match(view.error(), error, name);
    }
    // An error with nothing printed, such as Python failing to load, shows no empty panel.
    const view = lab("console-load-failure");
    fromSandbox(view.check(), { type: "error", message: "Python could not load. Check your connection, then try again." });
    assert.equal(view.console(), null); assert.match(view.error(), /^Python could not load/);
  } finally { React.unmount(); timers.restore(); }
});

test("the Projects editor shows the shared budget and keeps Save disabled when a save would not leave room for practice results", async () => {
  // Saved projects share MAX_STATE_BYTES with practice history and notes. Without the room kept for the capped
  // practice history, projects could fill it and every later practice result would fail to save.
  const line = "    total = total + compute(item, index)  # typical Python line\n";
  const fill = size => line.repeat(Math.ceil(size / line.length)).slice(0, size);
  const project = (id, size, count = 4) => files.withFiles({ ...files.createProject("study-tracker", id), title: `Project ${id}` }, ["main.py", "test_main.py", "README.md", "notes.md"].slice(0, count).map(path => ({ path, content: fill(size) })));
  const saveAll = (state, list) => list.reduce((next, item) => progress.applyAction(next, progress.validateAction({ action: "saveProject", revision: 0, ...item })), state);
  const sent = [];
  const show = (state, reservedBytes = progress.practiceHistoryReserve(state.attempts)) => React.render(React.jsx(Projects, { projects: state.projects, usedBytes: progress.savedBytes(state), reservedBytes, signed: true, userKey: "budget", onSave: async item => { sent.push(item.id); return true; } }));
  const find = match => React.findAll(match)[0];
  const view = () => ({
    save: find(node => node.type === "button" && /Save in this browser|Saving/.test(React.text(node))),
    error: React.findAll(node => React.hasClass(node, "project-error")).map(React.text)[0] ?? "",
    budget: React.text(find(node => React.hasClass(node, "fine-print") && /Saved projects share/.test(React.text(node)))),
  });
  const open = id => { find(node => node.type === "select" && React.findAll(option => option.type === "option", node).length > 1).props.onChange({ target: { value: id } }); React.flush(); };
  const type = (editor, value) => { find(node => node.type === "textarea" && React.hasClass(node, "project-editor") === editor).props.onChange({ target: { value } }); React.flush(); };
  try {
    const six = saveAll(progress.emptyState(), Array.from({ length: 6 }, (_, index) => project(`project-${index + 1}`, 40_000)));
    const reserved = progress.practiceHistoryReserve(six.attempts);
    assert.ok(reserved > 0);
    drafts.saveProjectDraft("budget", project("project-7", 40_000));
    show(six);
    assert.equal(view().budget, `Saved projects share ${progress.MAX_STATE_BYTES.toLocaleString()} bytes of browser storage with your practice history and notes. ${progress.savedBytes(six).toLocaleString()} bytes are in use, and ${reserved.toLocaleString()} more are kept for your practice results.`);
    assert.equal(view().save.props.disabled, false);
    // A 7th full-size project still fits under the ceiling, but not beside the room kept for practice results.
    open("project-7");
    assert.ok(progress.savedBytes(saveAll(six, [project("project-7", 40_000)])) <= progress.MAX_STATE_BYTES);
    assert.equal(view().save.props.disabled, true); assert.match(view().error, /kept for your practice results/);
    await view().save.props.onClick(); assert.deepEqual(sent, [], "Save must not send a save that does not leave that room");
    drafts.saveProjectDraft("budget", project("project-7", 20_000, 1)); React.flush();
    assert.equal(view().save.props.disabled, false, "a smaller 7th project fits"); assert.equal(view().error, "");
    // A record saved before this room was kept can still shrink a project, but not grow one.
    const seven = saveAll(six, [project("project-7", 40_000)]);
    show(seven); open("project-1");
    type(true, fill(30_000));
    assert.equal(view().save.props.disabled, false, "shrinking a project frees space");
    type(false, "A longer description of this project. ".repeat(20));
    assert.equal(view().save.props.disabled, false, "a project that is still smaller than its saved copy frees space");
    open("project-2"); type(false, "A longer description of this project. ".repeat(20));
    assert.equal(view().save.props.disabled, true, "growing a project would leave less room for practice results"); assert.match(view().error, /kept for your practice results/);
    // A full practice history needs no more room, so the budget line says only what is in use.
    show(seven, 0);
    assert.equal(view().budget, `Saved projects share ${progress.MAX_STATE_BYTES.toLocaleString()} bytes of browser storage with your practice history and notes. ${progress.savedBytes(seven).toLocaleString()} bytes are in use.`);
  } finally { React.unmount(); }
});

test("Restore a learning record previews the file, switches between merge and replace, and restores at the previewed revision", async () => {
  const recordUrl = dataUrl(transpile(read("../lib/learning-record.ts").replace('"./progress"', JSON.stringify(progressUrl))));
  const RestoreRecord = (await component("../app/components/RestoreRecord.tsx", { "../../lib/missions": missionsUrl, "../../lib/learning-record": recordUrl })).default;
  const record = await import(recordUrl);
  const [mission] = missions.MISSIONS;
  const current = { ...progress.emptyState(), profile: { name: "Here", weeklyHours: 10, language: "python" }, sessions: [{ id: "5b1f7a3e-1d2c-4a8b-9c0d-1e2f3a4b5c6d", minutes: 30, note: "Only here", createdAt: "2026-11-01T00:00:00.000Z" }] };
  const fromFile = { ...progress.emptyState(), sessions: [{ id: "6c2f7a3e-1d2c-4a8b-9c0d-1e2f3a4b5c6d", minutes: 20, note: "From file", createdAt: "2026-10-01T00:00:00.000Z" }] };
  const restores = [];
  let exported = 0;
  React.render(React.jsx(RestoreRecord, { state: current, revision: 7, signed: true, practiceLab: () => ({ completed: [], drafts: {} }), onRestore: async (...args) => { restores.push(args); return true; }, onExportCurrent: () => exported++ }));
  const input = () => React.findAll(node => node.type === "input" && node.props.type === "file")[0];
  const choose = async (name, content, size) => {
    const bytes = new TextEncoder().encode(content);
    input().props.onChange({ currentTarget: { value: name, files: [{ name, size: size ?? bytes.byteLength, arrayBuffer: async () => bytes.buffer }] } });
    await new Promise(resolve => setImmediate(resolve)); React.flush();
  };
  const alerts = () => React.findAll(node => node.props.role === "alert").map(React.text);
  const button = label => React.findAll(node => node.type === "button" && React.text(node).trim() === label)[0];
  // A damaged file and an oversized one are refused with a message; nothing is offered to restore.
  await choose("broken.json", '{"format":"forge-learning-record",');
  assert.match(alerts()[0], /broken\.json: .*not complete JSON.*Nothing was changed/); assert.equal(button("Merge this record"), undefined);
  await choose("huge.json", "{}", record.MAX_RECORD_FILE_BYTES + 1);
  assert.match(alerts()[0], /larger than 5 MB/);
  // A valid file shows its contents and what merge would change.
  await choose("forge-progress.json", record.learningRecordExport(fromFile, { completed: [mission.id], drafts: { [mission.id]: "print(1)" } }, new Date("2026-11-18T00:00:00.000Z")));
  assert.deepEqual(alerts(), []);
  const preview = () => React.text(React.findAll(node => node.props["aria-label"] === "Restore preview")[0]);
  assert.match(preview(), /learning record format 1/); assert.match(preview(), /1 practice session, 0 projects, 0 practice results, 1 Python draft and 1 completed mission/);
  assert.match(preview(), /Profile: your current profile is kept/); assert.match(preview(), /Practice sessions: 1 added\./); assert.match(preview(), /Python lab: 1 drafts written/);
  assert.doesNotMatch(preview(), /removes work/);
  // Replace says what it removes and offers a backup first.
  React.findAll(node => node.type === "input" && node.props.value === "replace")[0].props.onChange(); React.flush();
  assert.match(preview(), /Practice sessions: 1 added, 1 removed/); assert.match(preview(), /Profile: taken from the file/); assert.match(preview(), /Replace removes work that is only in this browser/);
  button("Download current record first").props.onClick(); assert.equal(exported, 1);
  button("Replace with this record").props.onClick(); await new Promise(resolve => setImmediate(resolve)); React.flush();
  assert.equal(restores.length, 1); assert.equal(restores[0][1], "replace"); assert.equal(restores[0][2], 7, "the restore is applied at the revision the preview showed");
  assert.deepEqual(restores[0][0].state, fromFile);
  assert.match(React.text(React.findAll(node => node.props.role === "status")[0]), /The record was restored/);
  assert.equal(React.findAll(node => node.props["aria-label"] === "Restore preview").length, 0);
  React.unmount();
});
