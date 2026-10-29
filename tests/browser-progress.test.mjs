import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const url = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const progressUrl = url(read("../lib/progress.ts"));
const progress = await import(progressUrl);
const { createBrowserProgressRequest, browserProgressRequest, BROWSER_PROGRESS_KEY, BROWSER_RECEIPT_LIMIT } = await import(url(read("../lib/browser-progress.ts").replace('"./progress"', JSON.stringify(progressUrl))));

class Storage {
  values = new Map(); writes = 0; readError = null; writeError = null; silentWrites = false; afterWriteReadError = false;
  getItem(key) { if (this.readError) throw this.readError; return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.writeError) throw this.writeError;
    this.writes++;
    if (!this.silentWrites) this.values.set(key, value);
    if (this.afterWriteReadError) { this.afterWriteReadError = false; this.readError = new Error("read blocked after write"); }
  }
}
class Locks {
  queues = new Map(); active = 0; maximum = 0;
  request(name, callback) {
    const previous = this.queues.get(name) ?? Promise.resolve();
    const next = previous.then(async () => { this.active++; this.maximum = Math.max(this.maximum, this.active); try { return await callback(); } finally { this.active--; } });
    this.queues.set(name, next.catch(() => {}));
    return next;
  }
}
function fixture(storage = new Storage(), locks = new Locks()) {
  const request = createBrowserProgressRequest({ storage, locks, crypto: webcrypto, now: () => new Date("2026-10-30T00:00:00.000Z") });
  return { storage, locks, request };
}
const operation = (fields = {}) => ({ action: "logSession", minutes: 25, note: "Built and tested BFS", revision: 0, operationId: webcrypto.randomUUID(), ...fields });
const profile = (fields = {}) => operation({ action: "saveProfile", name: "Explorer", weeklyHours: 20, language: "python", ...fields });
async function body(response, status = 200) { assert.equal(response.status, status); assert.equal(response.headers.get("Cache-Control"), "no-store"); return response.json(); }

test("first use proves persistence and a new adapter reads the same origin's saved state", async () => {
  const { request, storage, locks } = fixture();
  const initial = await body(await request("GET"));
  assert.deepEqual(initial.state, progress.emptyState()); assert.equal(initial.revision, 0); assert.equal(storage.writes, 1);
  const saved = await body(await request("POST", profile({ name: "Math learner" })));
  assert.equal(saved.revision, 1); assert.equal(saved.state.profile.name, "Math learner"); assert.equal(saved.replayed, false);
  const reloaded = await body(await fixture(storage, locks).request("GET"));
  assert.deepEqual(reloaded.state, saved.state); assert.equal(reloaded.revision, 1); assert.equal(storage.writes, 2, "reads do not rewrite existing state");
});

test("separate browser origins keep independent workspaces", async () => {
  const first = fixture(), second = fixture();
  await body(await first.request("POST", profile({ name: "First browser" })));
  const other = await body(await second.request("GET"));
  assert.equal(other.revision, 0); assert.equal(other.state.profile.name, "");
});

test("two tabs with the same revision commit only one independent update", async () => {
  const { request, storage, locks } = fixture();
  const secondTab = fixture(storage, locks).request;
  const responses = await Promise.all([request("POST", operation({ note: "Tab A" })), secondTab("POST", operation({ note: "Tab B" }))]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const latest = await body(await request("GET"));
  assert.equal(latest.revision, 1); assert.equal(latest.state.sessions.length, 1); assert.equal(locks.maximum, 1);
  const failed = await responses.find(response => response.status === 409).json();
  assert.equal(failed.code, "revision_conflict"); assert.deepEqual(failed.state, latest.state);
});

test("concurrent exact retries apply once and normalized property order hashes consistently", async () => {
  const { request, storage, locks } = fixture();
  const action = operation();
  const reordered = Object.fromEntries(Object.entries(action).reverse());
  const results = await Promise.all([request("POST", action), fixture(storage, locks).request("POST", reordered)]);
  const data = await Promise.all(results.map(response => body(response)));
  assert.deepEqual(data.map(item => item.replayed).sort(), [false, true]);
  assert.equal(data[0].state.sessions.length, 1); assert.equal(data[1].revision, 1); assert.equal(storage.writes, 1);
});

test("operation IDs cannot be reused for a different payload", async () => {
  const { request, storage } = fixture(); const action = operation();
  await body(await request("POST", action)); const before = storage.getItem(BROWSER_PROGRESS_KEY);
  const conflict = await body(await request("POST", { ...action, minutes: 50 }), 409);
  assert.equal(conflict.code, "operation_conflict"); assert.equal(storage.getItem(BROWSER_PROGRESS_KEY), before);
});

test("reset retains revision tombstones and retries return current state without deleting newer work", async () => {
  const { request } = fixture(); const old = operation();
  await body(await request("POST", old));
  const reset = operation({ action: "deleteData", confirm: "DELETE MY DATA", revision: 1 });
  const deleted = await body(await request("POST", reset));
  assert.deepEqual(deleted.state, progress.emptyState()); assert.equal(deleted.revision, 2);
  const newWork = await body(await request("POST", operation({ revision: 2, note: "Work after reset" })));
  for (const previous of [old, reset]) {
    const replay = await body(await request("POST", previous));
    assert.equal(replay.replayed, true); assert.equal(replay.revision, 3); assert.deepEqual(replay.state, newWork.state);
  }
  const stale = await body(await request("POST", operation({ note: "Late stale tab" })), 409);
  assert.equal(stale.code, "revision_conflict"); assert.equal(stale.state.sessions.length, 1);
  await body(await request("POST", operation({ action: "deleteData", confirm: "yes", revision: 3 })), 400);
});

test("receipts remain bounded and an evicted old retry cannot reapply", async () => {
  const { request, storage } = fixture(); const first = profile();
  await body(await request("POST", first));
  for (let revision = 1; revision <= BROWSER_RECEIPT_LIMIT; revision++) await body(await request("POST", profile({ revision })));
  const saved = JSON.parse(storage.getItem(BROWSER_PROGRESS_KEY));
  assert.equal(saved.receipts.length, BROWSER_RECEIPT_LIMIT); assert.equal(saved.revision, BROWSER_RECEIPT_LIMIT + 1);
  const rejected = await body(await request("POST", first), 409); assert.equal(rejected.code, "revision_conflict");
});

test("missing locks, blocked reads, and blocked writes never report successful saves", async () => {
  const unsupported = fixture(new Storage(), undefined);
  unsupported.request = createBrowserProgressRequest({ storage: unsupported.storage, locks: null, crypto: webcrypto });
  assert.equal((await body(await unsupported.request("GET"), 503)).code, "browser_locks_unavailable");
  for (const mode of ["readError", "writeError"]) {
    const { request, storage } = fixture(); storage[mode] = new Error("private sensitive browser detail");
    const failed = await body(await request("GET"), 503);
    assert.equal(failed.code, "browser_storage_unavailable"); assert.doesNotMatch(JSON.stringify(failed), /private sensitive/);
    await body(await request("POST", operation()), 503); assert.equal(storage.values.size, 0);
  }
});

test("quota failure keeps the previous state intact and the same request can be retried", async () => {
  const { request, storage } = fixture(); await body(await request("GET"));
  const before = storage.getItem(BROWSER_PROGRESS_KEY), action = operation();
  storage.writeError = Object.assign(new Error("full"), { name: "QuotaExceededError" });
  const failed = await body(await request("POST", action), 507);
  assert.equal(failed.code, "browser_storage_full"); assert.equal(storage.getItem(BROWSER_PROGRESS_KEY), before);
  assert.equal((await body(await request("GET"))).revision, 0, "existing data remains readable for export when storage is full");
  storage.writeError = null;
  assert.equal((await body(await request("POST", action))).state.sessions.length, 1);
});

test("an uncertain confirmation retries by receipt without duplicating a committed session", async () => {
  const { request, storage } = fixture(); await body(await request("GET")); const action = operation();
  storage.afterWriteReadError = true;
  await body(await request("POST", action), 503);
  storage.readError = null;
  const replay = await body(await request("POST", action));
  assert.equal(replay.replayed, true); assert.equal(replay.state.sessions.length, 1); assert.equal(replay.revision, 1);
});

test("storage that silently drops writes cannot return false success", async () => {
  const { request, storage } = fixture(); storage.silentWrites = true;
  await body(await request("GET"), 503); await body(await request("POST", operation()), 503); assert.equal(storage.values.size, 0);
});

test("malformed persisted records are preserved instead of reset or overwritten", async () => {
  const { request, storage } = fixture(); await body(await request("POST", operation()));
  const valid = JSON.parse(storage.getItem(BROWSER_PROGRESS_KEY));
  const cases = ["not json", JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, state: { ...valid.state, sessions: [{ ...valid.state.sessions[0], minutes: -10 }] } }), JSON.stringify({ ...valid, state: { ...valid.state, unexpected: "field" } }), JSON.stringify({ ...valid, receipts: [...valid.receipts, valid.receipts[0]] }), JSON.stringify({ ...valid, revision: 0 }), JSON.stringify({ ...valid, state: { ...valid.state, modules: JSON.parse('{"__proto__":{"complete":true,"evidence":"x","updatedAt":"2026-10-30T00:00:00.000Z"}}') } })];
  for (const raw of cases) {
    storage.setItem(BROWSER_PROGRESS_KEY, raw);
    assert.equal((await body(await request("GET"), 503)).code, "browser_storage_corrupt");
    await body(await request("POST", operation()), 503);
    assert.equal(storage.getItem(BROWSER_PROGRESS_KEY), raw);
  }
});

test("shared validation rejects unsafe files, incorrect practice reports, and excessive payloads", async () => {
  const { request, storage } = fixture();
  const cases = [operation({ minutes: 241 }), profile({ language: "javascript" }), operation({ action: "recordAttempt", missionId: "hello", passed: 1, total: 2, category: "success" }), operation({ action: "saveProject", id: "test", title: "Test", description: "", code: "", repoUrl: "", status: "draft", files: [{ path: "main.py", content: "" }, { path: "../escape", content: "" }] })];
  for (const action of cases) await body(await request("POST", action), 400);
  await body(await request("POST", profile({ extra: "é".repeat(100_000) })), 413);
  const cyclic = {}; cyclic.self = cyclic;
  await body(await request("POST", cyclic), 400);
  assert.equal(storage.values.size, 0);
});

test("project manifests and practice coaching round trip through persisted validation", async () => {
  const { request } = fixture();
  const source = "print('தமிழ்')\n";
  await body(await request("POST", operation({ action: "saveProject", id: "project-test", templateId: "test-bench", title: "A project", description: "Tested", code: source, files: [{ path: "main.py", content: source }, { path: "README.md", content: "A useful project" }], repoUrl: "https://github.com/example/project", status: "building" })));
  await body(await request("POST", operation({ action: "setModule", revision: 1, moduleId: "basics", complete: true, evidence: "I ran the tests" })));
  const attempt = await body(await request("POST", operation({ action: "recordAttempt", revision: 2, missionId: "hello", passed: 1, total: 2, category: "syntax" })));
  const reloaded = await body(await request("GET"));
  assert.deepEqual(reloaded.state, attempt.state); assert.equal(reloaded.state.projects[0].code, source);
  assert.equal(reloaded.recommendation.focus, "practice"); assert.equal(reloaded.state.attempts[0].source, "browser-self-report");
});

test("the shared workspace byte ceiling rejects a large update without losing existing projects", async () => {
  const { request, storage } = fixture(); const source = "x".repeat(39_000);
  for (let revision = 0; revision < 19; revision++) {
    await body(await request("POST", operation({ action: "saveProject", revision, id: `project-${revision}`, title: "Large project", description: "", code: source, files: [{ path: "main.py", content: source }], repoUrl: "", status: "draft" })));
  }
  const before = storage.getItem(BROWSER_PROGRESS_KEY);
  await body(await request("POST", operation({ action: "saveProject", revision: 19, id: "project-19", title: "One too many bytes", description: "", code: source, files: [{ path: "main.py", content: source }], repoUrl: "", status: "draft" })), 413);
  assert.equal(storage.getItem(BROWSER_PROGRESS_KEY), before);
  const latest = await body(await request("GET")); assert.equal(latest.revision, 19); assert.equal(latest.state.projects.length, 19);
});

test("the default adapter is importable without a browser and fails clearly when called there", async () => {
  const response = await body(await browserProgressRequest("GET"), 503);
  assert.equal(response.code, "browser_storage_unavailable");
});
