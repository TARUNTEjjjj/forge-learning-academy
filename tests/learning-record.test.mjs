import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

// Restoring an exported learning record: the file format, its validation, merge/replace, and the locked save.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const url = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const progressUrl = url(read("../lib/progress.ts"));
const recordUrl = url(read("../lib/learning-record.ts").replace('"./progress"', JSON.stringify(progressUrl)));
const [progress, record, { MISSIONS }] = await Promise.all([import(progressUrl), import(recordUrl), import(url(read("../lib/missions.ts")))]);
const { createBrowserProgressRequest, BROWSER_PROGRESS_KEY } = await import(url(read("../lib/browser-progress.ts").replace('"./progress"', JSON.stringify(progressUrl)).replace('"./learning-record"', JSON.stringify(recordUrl))));

class Storage {
  values = new Map(); writes = 0; readError = null; writeError = null;
  getItem(key) { if (this.readError) throw this.readError; return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.writeError) throw this.writeError; this.writes++; this.values.set(key, value); }
}
class Locks {
  queues = new Map();
  request(name, callback) {
    const next = (this.queues.get(name) ?? Promise.resolve()).then(callback);
    this.queues.set(name, next.catch(() => {}));
    return next;
  }
}
let clock = Date.parse("2026-11-01T00:00:00.000Z");
function browser(storage = new Storage(), locks = new Locks()) {
  return { storage, locks, request: createBrowserProgressRequest({ storage, locks, crypto: webcrypto, now: () => new Date(clock += 60_000) }) };
}
async function body(response, status = 200) { assert.equal(response.status, status, JSON.stringify(await response.clone().json())); return response.json(); }
const bytes = value => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const parse = value => record.parseLearningRecord(bytes(value), MISSIONS);
const [first, second, third] = MISSIONS;
const lab = { completed: [first.id], drafts: { [first.id]: "def progress(completed, goal):\n    return round(100 * completed / goal)\n" } };

/** A browser with one of everything a learner saves, made through the real save path. */
async function filledBrowser() {
  const tab = browser();
  let revision = (await body(await tab.request("GET"))).revision;
  for (const action of [
    { action: "saveProfile", name: "Ada", weeklyHours: 12, language: "python" },
    { action: "setModule", moduleId: "python-basics", complete: true, evidence: "Wrote a parser" },
    { action: "logSession", minutes: 45, note: "Graphs" },
    { action: "saveProject", id: "tracker", title: "Study tracker", description: "Mine", code: "print('hi')\n", files: [{ path: "main.py", content: "print('hi')\n" }, { path: "tests/test_main.py", content: "import unittest\n" }], templateId: "study-tracker", repoUrl: "https://github.com/ada/tracker", status: "building" },
    { action: "recordAttempt", missionId: first.id, passed: 3, total: 3, category: "success" },
  ]) revision = (await body(await tab.request("POST", { ...action, revision, operationId: webcrypto.randomUUID() }))).revision;
  return { ...tab, state: (await body(await tab.request("GET"))).state, revision };
}
const restore = (tab, state, mode, revision, operationId = webcrypto.randomUUID()) => tab.request("POST", { action: "importRecord", mode, state, revision, operationId });

test("an exported record round-trips into a new browser with replace and with merge", async () => {
  const source = await filledBrowser();
  const file = record.learningRecordExport(source.state, lab, new Date("2026-11-18T10:00:00.000Z"));
  const exported = JSON.parse(file);
  assert.equal(exported.format, "forge-learning-record"); assert.equal(exported.formatVersion, 1);
  assert.equal(exported.exportedAt, "2026-11-18T10:00:00.000Z");
  const parsed = parse(file);
  assert.equal(parsed.formatVersion, 1); assert.deepEqual(parsed.state, source.state); assert.deepEqual(parsed.practiceLab, lab);
  for (const mode of ["replace", "merge"]) {
    const target = browser();
    const { revision } = await body(await target.request("GET"));
    const restored = await body(await restore(target, parsed.state, mode, revision));
    assert.deepEqual(restored.state, source.state, `${mode} into an empty browser restores the whole record`);
    assert.equal(restored.revision, revision + 1);
    assert.deepEqual((await body(await browser(target.storage, target.locks).request("GET"))).state, source.state, "the restore is saved");
    // A restored record exports to the same record again.
    assert.deepEqual(parse(record.learningRecordExport(restored.state, lab)).state, source.state);
  }
});

test("unversioned exports from earlier releases are read, with or without the Python lab", async () => {
  const { state } = await filledBrowser();
  // 30 Oct–15 Nov 2026: { exportedAt, ...state }. From 15 Nov 2026 the lab was added as practiceLab.
  const oldest = parse({ exportedAt: "2026-11-01T09:00:00.000Z", ...state });
  assert.equal(oldest.formatVersion, 0); assert.equal(oldest.practiceLab, null); assert.deepEqual(oldest.state, state);
  const withLab = parse({ exportedAt: "2026-11-16T09:00:00.000Z", ...state, practiceLab: lab });
  assert.equal(withLab.formatVersion, 0); assert.deepEqual(withLab.practiceLab, lab);
  // Without a lab section, neither mode touches the lab.
  const current = { completed: [second.id], drafts: { [second.id]: "mine" } };
  for (const mode of ["merge", "replace"]) assert.deepEqual(record.practiceRestorePlan(current, null, mode), { completed: [second.id], write: {}, remove: [], keptCurrent: [] });
  // Export files keep starter code out; a file that includes it is not counted as a draft.
  assert.deepEqual(parse({ exportedAt: "2026-11-16T09:00:00.000Z", ...state, practiceLab: { completed: [], drafts: { [second.id]: second.starter } } }).practiceLab.drafts, {});
});

test("damaged, partial, foreign, newer and oversized files are refused before anything is written", async () => {
  const { state } = await filledBrowser();
  const good = JSON.parse(record.learningRecordExport(state, lab));
  const text = JSON.stringify(good);
  const refuse = (input, pattern, name) => assert.throws(() => record.parseLearningRecord(input instanceof Uint8Array ? input : bytes(input), MISSIONS), error => error instanceof progress.ProgressError && pattern.test(error.message) && /Nothing was changed/.test(error.message), name);
  refuse(text.slice(0, Math.floor(text.length / 2)), /not complete JSON/, "a file cut short");
  refuse(new Uint8Array([0x7b, 0xff, 0x7d]), /not complete JSON/, "bytes that are not UTF-8");
  refuse(new Uint8Array(record.MAX_RECORD_FILE_BYTES + 1), /larger than 5 MB/, "an oversized file is not parsed");
  refuse([good], /record is not valid/, "a list");
  refuse({ ...good, format: "someone-else" }, /not a Forge learning record/, "another format");
  refuse({ ...good, formatVersion: 2 }, /newer version of Forge/, "a newer format");
  refuse({ ...good, formatVersion: "1" }, /formatVersion is not valid/, "a malformed version");
  refuse({ ...good, cloudToken: "x" }, /"cloudToken" is not valid/, "an unknown field");
  refuse({ ...good, exportedAt: "yesterday" }, /exportedAt/, "a bad export date");
  const { practiceLab: ignored, ...noLab } = good; void ignored;
  refuse(noLab, /practiceLab is not valid. This section is missing/, "a versioned file without its lab section");
  const { projects: ignoredProjects, ...noProjects } = good; void ignoredProjects;
  refuse(noProjects, /projects is not valid. This section is missing/, "a partial record");
  refuse({ ...good, sessions: [good.sessions[0], good.sessions[0]] }, /sessions entry 2 .*appears more than once/, "a repeated session ID");
  refuse({ ...good, attempts: [{ ...good.attempts[0], id: "not-a-uuid" }] }, /attempts entry 1 .*ID is missing or malformed/, "a malformed attempt ID");
  refuse({ ...good, attempts: [{ ...good.attempts[0], source: "teacher-verified" }] }, /attempts entry 1/, "a result not recorded by this browser");
  refuse({ ...good, projects: [{ ...good.projects[0], id: "../escape" }] }, /projects entry 1 .*invalid characters/, "an unsafe project ID");
  refuse({ ...good, projects: [{ ...good.projects[0], files: [{ path: "../main.py", content: "" }] }] }, /projects entry 1/, "an unsafe project path");
  refuse({ ...good, modules: { "python-basics": { ...good.modules["python-basics"], updatedAt: "2026-13-45T00:00:00.000Z" } } }, /module python-basics .*not a valid timestamp/, "an impossible date");
  refuse({ ...good, profile: { ...good.profile, name: " padded " } }, /extra fields, untrimmed text/, "edited text");
  refuse({ ...good, sessions: Array.from({ length: 5001 }, () => good.sessions[0]) }, /Forge keeps at most 5000/, "too many sessions");
  refuse({ ...good, practiceLab: { completed: ["retired"], drafts: {} } }, /unknown or repeated mission/, "an unknown completed mission");
  refuse({ ...good, practiceLab: { completed: [first.id, first.id], drafts: {} } }, /unknown or repeated mission/, "a repeated completed mission");
  refuse({ ...good, practiceLab: { completed: [], drafts: { retired: "x" } } }, /not a Python lab mission/, "a draft for an unknown mission");
  refuse({ ...good, practiceLab: { completed: [], drafts: { [first.id]: "x".repeat(30_001) } } }, /at most 30,000 characters/, "a draft the lab would not show");
  refuse({ ...good, practiceLab: { completed: [], drafts: {}, extra: 1 } }, /practiceLab is not valid/, "extra lab fields");
  refuse({ ...good, projects: Array.from({ length: 8 }, (_, index) => ({ ...good.projects[0], id: `p${index}`, files: Array.from({ length: 6 }, (_, file) => ({ path: file ? `f${file}.py` : "main.py", content: file ? "x".repeat(39_000) : good.projects[0].code })) })) }, /larger than the 1,500,000 bytes/, "a record too large to save");
});

test("the restore request is validated and limited before the lock, and a conflict or failure keeps existing data", async () => {
  const source = await filledBrowser();
  const target = await filledBrowser();
  const before = target.storage.getItem(BROWSER_PROGRESS_KEY), writes = target.storage.writes;
  const unchanged = () => { assert.equal(target.storage.getItem(BROWSER_PROGRESS_KEY), before); assert.equal(target.storage.writes, writes); };
  // Invalid records and modes.
  assert.equal((await body(await restore(target, { ...source.state, sessions: "none" }, "replace", target.revision), 422)).code, "invalid_learning_record"); unchanged();
  assert.match((await body(await restore(target, source.state, "overwrite", target.revision), 400)).error, /merge or replace/); unchanged();
  assert.match((await body(await target.request("POST", { action: "importRecord", mode: "merge", state: source.state, revision: target.revision, extra: true }), 400)).error, /unexpected fields/); unchanged();
  // A whole saved record is allowed, but not more; ordinary updates keep their smaller limit.
  assert.equal((await body(await restore(target, { ...source.state, padding: "x".repeat(record.MAX_IMPORT_REQUEST_BYTES) }, "merge", target.revision), 413)).code, "invalid_update"); unchanged();
  assert.equal((await target.request("POST", { action: "logSession", minutes: 5, note: "x".repeat(progress.MAX_REQUEST_BYTES), revision: target.revision })).status, 413); unchanged();
  // A preview made before another tab's save is not applied over it.
  const otherTab = browser(target.storage, target.locks);
  const saved = await body(await otherTab.request("POST", { action: "logSession", minutes: 10, note: "Other tab", revision: target.revision, operationId: webcrypto.randomUUID() }));
  const afterOtherTab = target.storage.getItem(BROWSER_PROGRESS_KEY);
  const conflict = await body(await restore(target, source.state, "replace", target.revision), 409);
  assert.equal(conflict.code, "revision_conflict"); assert.deepEqual(conflict.state, saved.state);
  assert.equal(target.storage.getItem(BROWSER_PROGRESS_KEY), afterOtherTab);
  // Full storage: the write is refused and the saved record is unchanged.
  target.storage.writeError = Object.assign(new Error("full"), { name: "QuotaExceededError" });
  assert.equal((await body(await restore(target, source.state, "replace", saved.revision), 507)).code, "browser_storage_full");
  target.storage.writeError = null;
  assert.equal(target.storage.getItem(BROWSER_PROGRESS_KEY), afterOtherTab);
  // Denied storage: nothing can be read, so nothing is written.
  target.storage.readError = Object.assign(new Error("denied"), { name: "SecurityError" });
  assert.equal((await body(await restore(target, source.state, "replace", saved.revision), 503)).code, "browser_storage_unavailable");
  target.storage.readError = null;
  assert.equal(target.storage.getItem(BROWSER_PROGRESS_KEY), afterOtherTab);
  // Without Web Locks no restore is attempted.
  assert.equal((await body(await createBrowserProgressRequest({ storage: target.storage, locks: undefined, crypto: webcrypto })("POST", { action: "importRecord", mode: "merge", state: source.state, revision: saved.revision }), 503)).code, "browser_locks_unavailable");
  assert.equal(target.storage.getItem(BROWSER_PROGRESS_KEY), afterOtherTab);
});

test("two tabs restoring or saving at the same revision commit one change, and a retried restore is replayed", async () => {
  const source = await filledBrowser();
  const target = browser();
  const { revision } = await body(await target.request("GET"));
  const otherTab = browser(target.storage, target.locks);
  const responses = await Promise.all([
    restore(target, source.state, "replace", revision),
    otherTab.request("POST", { action: "logSession", minutes: 20, note: "Racing", revision, operationId: webcrypto.randomUUID() }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409], "exactly one tab's change is committed; the other must refresh");
  const winner = await body(responses.find(response => response.status === 200));
  assert.deepEqual((await body(await target.request("GET"))).state, winner.state);
  assert.equal(winner.revision, revision + 1);
  // A retry of the same restore (an uncertain save) is answered from its receipt instead of being applied twice.
  const operationId = webcrypto.randomUUID();
  const applied = await body(await restore(target, source.state, "merge", winner.revision, operationId));
  const retry = await body(await restore(target, source.state, "merge", winner.revision, operationId));
  assert.equal(retry.replayed, true); assert.equal(retry.appliedRevision, applied.revision); assert.deepEqual(retry.state, applied.state);
  assert.equal((await body(await restore(target, { ...source.state, sessions: [] }, "merge", winner.revision, operationId), 409)).code, "operation_conflict");
});

test("merge keeps this browser's work, adds the file's, and keeps the newer copy of anything in both", async () => {
  const mine = (await filledBrowser()).state;
  const theirs = structuredClone(mine);
  const later = "2030-01-01T00:00:00.000Z", earlier = "2020-01-01T00:00:00.000Z";
  theirs.profile = { name: "Someone", weeklyHours: 30, language: "cpp" };
  theirs.modules["python-basics"] = { complete: false, evidence: "Older note", updatedAt: earlier };
  theirs.modules["git-basics"] = { complete: true, evidence: "Branches", updatedAt: later };
  theirs.sessions.push({ id: webcrypto.randomUUID(), minutes: 30, note: "From file", createdAt: earlier });
  theirs.projects[0] = { ...theirs.projects[0], title: "Older title", updatedAt: earlier };
  theirs.projects.push({ ...mine.projects[0], id: "second", title: "Second", updatedAt: later });
  theirs.attempts = [{ id: webcrypto.randomUUID(), missionId: second.id, passed: 1, total: 3, category: "logic", createdAt: later, source: "browser-self-report" }];
  const { state, summary } = record.restoredState(mine, theirs, "merge");
  assert.deepEqual(state.profile, mine.profile, "a profile set here is kept");
  assert.equal(state.modules["python-basics"].evidence, "Wrote a parser", "the older module note does not replace a newer one");
  assert.equal(state.modules["git-basics"].evidence, "Branches");
  assert.deepEqual(state.sessions.map(s => s.note), ["From file", "Graphs"], "sessions are joined by ID in time order");
  assert.deepEqual(state.projects.map(p => p.title), ["Study tracker", "Second"]);
  assert.equal(state.attempts.length, 2, "the file's results are added; this browser's are kept");
  assert.deepEqual(summary, { mode: "merge", profile: "kept", modules: { added: 1, updated: 0, removed: 0 }, sessions: { added: 1, removed: 0 }, projects: { added: 1, updated: 0, removed: 0, keptNewer: 1 }, attempts: { added: 1, removed: 0, trimmed: 0 }, result: { modules: 2, sessions: 2, projects: 2, attempts: 2, bytes: progress.savedBytes(state) } });
  // A newer copy in the file wins; the file's profile is used only while this browser's is untouched.
  theirs.projects[0].updatedAt = later;
  assert.equal(record.restoredState(mine, theirs, "merge").state.projects[0].title, "Older title");
  assert.deepEqual(record.restoredState(progress.emptyState(), theirs, "merge").state.profile, theirs.profile);
  // Replace reports what it removes.
  const replaced = record.restoredState(mine, progress.emptyState(), "replace");
  assert.deepEqual(replaced.state, progress.emptyState());
  assert.deepEqual([replaced.summary.modules.removed, replaced.summary.sessions.removed, replaced.summary.projects.removed, replaced.summary.attempts.removed], [1, 1, 1, 1]);
  assert.equal(record.restoredState(mine, mine, "merge").summary.result.attempts, 1, "merging a record into itself changes nothing");
  assert.deepEqual(record.restoredState(mine, mine, "merge").state, mine);
});

test("merge stays within the saved-record limits: practice results keep the latest 500 and other overflows are refused", () => {
  const attempt = (index, createdAt) => ({ id: webcrypto.randomUUID(), missionId: first.id, passed: 0, total: 1, category: "logic", createdAt, source: "browser-self-report" });
  const mine = { ...progress.emptyState(), attempts: Array.from({ length: 300 }, (_, index) => attempt(index, new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString())) };
  const theirs = { ...progress.emptyState(), attempts: Array.from({ length: 300 }, (_, index) => attempt(index, new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString())) };
  const merged = record.restoredState(mine, theirs, "merge");
  assert.equal(merged.state.attempts.length, 500); assert.equal(merged.summary.attempts.trimmed, 100);
  assert.deepEqual(merged.state.attempts.slice(-300), mine.attempts, "the oldest results, here the file's, are the ones dropped");
  const project = id => ({ id, title: id, description: "", code: "", repoUrl: "", status: "draft", updatedAt: "2026-11-01T00:00:00.000Z" });
  const many = n => ({ ...progress.emptyState(), projects: Array.from({ length: n }, (_, index) => project(`p${index}-${n}`)) });
  assert.throws(() => record.restoredState(many(11), many(10), "merge"), /21 projects; Forge keeps at most 20. Choose replace instead/);
  assert.equal(record.restoredState(many(11), many(10), "replace").state.projects.length, 10);
});

test("the Python lab plan merges drafts without overwriting this browser's, and replace makes the lab match the file", () => {
  const current = { completed: [second.id], drafts: { [first.id]: "my newer draft", [second.id]: "only here" } };
  const file = { completed: [first.id], drafts: { [first.id]: "file draft", [third.id]: "file only" } };
  assert.deepEqual(record.practiceRestorePlan(current, file, "merge"), { completed: [second.id, first.id], write: { [third.id]: "file only" }, remove: [], keptCurrent: [first.id] });
  assert.deepEqual(record.practiceRestorePlan(current, file, "replace"), { completed: [first.id], write: { [first.id]: "file draft", [third.id]: "file only" }, remove: [second.id], keptCurrent: [] });
  assert.deepEqual(record.practiceRestorePlan(file, file, "merge"), { completed: [first.id], write: {}, remove: [], keptCurrent: [] });
});

test("the docs describe what a record restores and what it does not", () => {
  const readme = read("../README.md"), privacy = read("../public/privacy.html");
  assert.doesNotMatch(readme, /cannot load them back in/); assert.doesNotMatch(privacy, /cannot load these downloads back in/);
  for (const text of [readme, privacy]) {
    assert.match(text, /Restore a learning record/);
    assert.match(text, /ZIP/);
  }
  assert.match(read("../lib/learning-record.ts"), /Not in the record: project ZIP downloads/);
});
