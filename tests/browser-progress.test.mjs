import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const url = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const progressUrl = url(read("../lib/progress.ts"));
const progress = await import(progressUrl);
const { createSerialTaskQueue } = await import(url(read("../lib/serial-task-queue.ts")));
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

// A receipt's payload hash is an unsalted SHA-256 of the save, which anyone who reads this storage can match against guesses.
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
async function payloadHash(save) {
  const { operationId, ...payload } = progress.validateAction(save); void operationId;
  return Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(payload)))).toString("hex");
}

test("deleted saves leave nothing in browser storage that depends on their contents, and retries of them are still answered", async () => {
  const ids = Array.from({ length: 4 }, () => webcrypto.randomUUID());
  const histories = [
    [profile({ name: "Sanjay", weeklyHours: 15 }), operation({ minutes: 137, note: "Focus timer session" }), operation({ action: "recordAttempt", missionId: "capacity", passed: 2, total: 7, category: "logic" })],
    [profile({ name: "Explorer", weeklyHours: 20 }), operation({ minutes: 25, note: "Focus timer session" }), operation({ action: "recordAttempt", missionId: "network", passed: 6, total: 6, category: "success" })],
  ];
  const stored = [];
  for (const history of histories) {
    const { request, storage } = fixture();
    const saves = history.map((save, revision) => ({ ...save, revision, operationId: ids[revision] }));
    for (const save of saves) await body(await request("POST", save));
    const deletion = operation({ action: "deleteData", confirm: "DELETE MY DATA", revision: saves.length, operationId: ids[saves.length] });
    await body(await request("POST", deletion));
    const raw = storage.getItem(BROWSER_PROGRESS_KEY); stored.push(raw);
    for (const save of saves) assert.ok(!raw.includes(await payloadHash(save)), `the hash of a deleted ${save.action} is still stored`);
    // A delete's payload is fixed by its revision, so its own hash reveals nothing. A tab still on the earlier
    // release compares hashes only, and must be able to retry its unconfirmed delete and then clear local drafts.
    assert.equal(JSON.parse(raw).receipts.at(-1).payloadHash, await payloadHash(deletion), "the delete's own receipt keeps its hash");
    const otherTab = Object.assign(new Storage(), { values: storage.values });
    await body(await fixture(otherTab).request("GET")); assert.equal(otherTab.writes, 0, "another tab's read finds nothing left to erase");
    for (const save of saves) {
      const replay = await body(await request("POST", save));
      assert.equal(replay.replayed, true); assert.deepEqual(replay.state, progress.emptyState());
    }
    const reused = await body(await request("POST", operation({ revision: saves.length + 1, operationId: ids[0] })), 409);
    assert.equal(reused.code, "operation_conflict");
  }
  assert.equal(stored[0], stored[1], "what a delete leaves in storage must not depend on what was deleted");
});

test("a record deleted before receipts were erased has their payload hashes erased when it is next read", async () => {
  const { request, storage } = fixture();
  const saves = [profile({ name: "Sanjay", weeklyHours: 15 }), operation({ revision: 1, minutes: 137, note: "Focus timer session" })];
  for (const save of saves) await body(await request("POST", save));
  // What the earlier release stored: its delete receipt and the receipts before it kept their payload hashes.
  const envelope = JSON.parse(storage.getItem(BROWSER_PROGRESS_KEY));
  const deletion = { action: "deleteData", confirm: "DELETE MY DATA", revision: 2, operationId: webcrypto.randomUUID() };
  envelope.receipts.push({ operationId: deletion.operationId, payloadHash: await payloadHash(deletion), appliedRevision: 3 });
  Object.assign(envelope, { revision: 3, state: progress.emptyState() });
  storage.setItem(BROWSER_PROGRESS_KEY, JSON.stringify(envelope));
  const later = operation({ revision: 3, note: "Work after the delete" });
  const saved = await body(await request("POST", later));
  const legacy = storage.getItem(BROWSER_PROGRESS_KEY);
  for (const save of [...saves, deletion]) assert.ok(legacy.includes(await payloadHash(save)));
  const read = await body(await request("GET"));
  assert.deepEqual(read.state, saved.state); assert.equal(read.revision, 4);
  const erased = storage.getItem(BROWSER_PROGRESS_KEY);
  for (const save of saves) assert.ok(!erased.includes(await payloadHash(save)), `the hash of a deleted ${save.action} is still stored`);
  // The delete's own payload is fixed by its revision. Keeping its hash lets the earlier release, which compares
  // hashes only, still answer that tab's retry of the delete, so it goes on to clear the lab and project drafts.
  assert.ok(erased.includes(await payloadHash(deletion)), "the delete's own receipt keeps its hash");
  assert.ok(erased.includes(await payloadHash(later)), "receipts after the delete keep their hashes");
  const writes = storage.writes; await body(await request("GET")); assert.equal(storage.writes, writes, "reads rewrite the record only to erase hashes");
  // A tab opened later has checked nothing yet, and finds the delete already handled.
  const laterTab = Object.assign(new Storage(), { values: storage.values });
  await body(await fixture(laterTab).request("GET")); assert.equal(laterTab.writes, 0, "a handled delete is not rewritten by each new tab");
  for (const save of [...saves, deletion, later]) assert.equal((await body(await request("POST", save))).replayed, true);
  assert.equal((await body(await request("POST", { ...later, minutes: 50 }), 409)).code, "operation_conflict");
  assert.deepEqual((await body(await request("GET"))).state, saved.state);
});

test("reads look for an earlier release's deletion only in receipts added since this tab's last read", async () => {
  // Forge reads again on every storage event from another tab, so a read must not hash all 256 receipts each time.
  let digests = 0;
  const subtle = { digest: (...args) => { digests++; return webcrypto.subtle.digest(...args); } };
  const storage = new Storage();
  const request = createBrowserProgressRequest({ storage, locks: new Locks(), crypto: { randomUUID: () => webcrypto.randomUUID(), subtle }, now: () => new Date("2026-10-30T00:00:00.000Z") });
  for (let revision = 0; revision < BROWSER_RECEIPT_LIMIT + 10; revision++) await body(await request("POST", operation({ revision })));
  const digestsForRead = async () => { digests = 0; await body(await request("GET")); return digests; };
  assert.equal(await digestsForRead(), BROWSER_RECEIPT_LIMIT, "the first read checks every receipt");
  assert.equal(await digestsForRead(), 0, "the next read has nothing new to check");
  await body(await request("POST", operation({ revision: BROWSER_RECEIPT_LIMIT + 10 })));
  assert.equal(await digestsForRead(), 1);
  // An earlier release's delete, added after this tab's last read, is still found, and the hashes before it are erased once.
  const envelope = JSON.parse(storage.getItem(BROWSER_PROGRESS_KEY));
  const deletion = { action: "deleteData", confirm: "DELETE MY DATA", revision: envelope.revision, operationId: webcrypto.randomUUID() };
  envelope.receipts = [...envelope.receipts, { operationId: deletion.operationId, payloadHash: await payloadHash(deletion), appliedRevision: envelope.revision + 1 }].slice(-BROWSER_RECEIPT_LIMIT);
  Object.assign(envelope, { revision: envelope.revision + 1, state: progress.emptyState() });
  storage.setItem(BROWSER_PROGRESS_KEY, JSON.stringify(envelope));
  const writes = storage.writes;
  assert.equal(await digestsForRead(), 1); assert.equal(storage.writes, writes + 1);
  const receipts = JSON.parse(storage.getItem(BROWSER_PROGRESS_KEY)).receipts;
  assert.ok(receipts.slice(0, -1).every(receipt => receipt.payloadHash === "0".repeat(64)), "every hash before the delete is erased");
  assert.equal(receipts.at(-1).payloadHash, await payloadHash(deletion));
  assert.equal(await digestsForRead(), 0); assert.equal(storage.writes, writes + 1, "a handled delete is not rewritten");
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
  await body(await request("POST", profile({ extra: "é".repeat(progress.MAX_REQUEST_BYTES / 2) })), 413);
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

test("a project save's size is predicted exactly, so the Projects editor can stop one that cannot fit", async () => {
  // The editor allows 20 projects of up to 160,000 bytes, but they share the 1,500,000-byte record with practice
  // history and notes, and main.py is stored again as code: the 8th full-size project cannot be saved.
  // components.test.mjs renders the editor with these numbers.
  const { request } = fixture();
  const line = "    total = total + compute(item, index)  # typical Python line\n";
  const files = (size, count = 4) => ["main.py", "test_main.py", "README.md", "notes.md"].slice(0, count).map(path => ({ path, content: line.repeat(Math.ceil(size / line.length)).slice(0, size) }));
  const project = (id, projectFiles) => ({ action: "saveProject", id, templateId: "study-tracker", title: ` Project ${id} `, description: "", code: projectFiles[0].content, files: projectFiles, repoUrl: "https://github.com/example/project/", status: "draft" });
  let saved = await body(await request("GET")), rejected = [];
  const saves = [...Array.from({ length: 8 }, (_, index) => project(`full-${index}`, files(40_000))), project("full-0", files(1_000, 1)), project("full-1", files(20_000, 2)), project("small", files(500, 1)), project("full-0", files(30_000, 3))];
  for (const save of saves) {
    const predicted = progress.savedBytes(saved.state) + progress.projectSaveBytes(saved.state.projects, progress.validateAction({ ...save, revision: saved.revision }));
    const response = await request("POST", { ...save, revision: saved.revision, operationId: webcrypto.randomUUID() });
    if (predicted > progress.MAX_STATE_BYTES) { await body(response, 413); rejected.push(save.id); continue; }
    saved = await body(response);
    assert.equal(progress.savedBytes(saved.state), predicted, `saving ${save.id} used a size the editor did not predict`);
  }
  assert.deepEqual(rejected, ["full-7"]);
  // Forge needs React and a browser, so check only what it gives the editor.
  const forge = read("../app/components/Forge.tsx").replace(/\s+/g, ""), from = forge.indexOf("<Projects"), element = forge.slice(from, forge.indexOf("/>", from));
  assert.ok(from >= 0 && element.includes("usedBytes={usedBytes}") && element.includes("reservedBytes={reservedBytes}"), "Forge must give the Projects editor the bytes in use and the room kept for practice results");
  assert.ok(forge.includes("savedBytes(state)") && forge.includes("practiceHistoryReserve(state.attempts)"), "Forge must measure the saved record and the practice history it holds");
});

test("the room kept for the practice history covers every practice result it can still take", () => {
  // applyAction keeps the latest 500 attempts. A record whose size plus this room fits MAX_STATE_BYTES takes the
  // next practice result whatever its size, so the Projects editor keeps the room free when projects grow.
  const largest = { action: "recordAttempt", revision: 0, missionId: "m".repeat(80), passed: 999, total: 1000, category: "performance" };
  const typical = { action: "recordAttempt", revision: 0, missionId: "progress", passed: 9, total: 9, category: "success" };
  let state = progress.emptyState();
  const record = save => {
    const before = progress.savedBytes(state), room = progress.practiceHistoryReserve(state.attempts);
    state = progress.applyAction(state, progress.validateAction(save), "2026-10-30T00:00:00.000Z", webcrypto.randomUUID());
    assert.ok(progress.savedBytes(state) - before <= room, `a practice result grew the record by more than the ${room} bytes kept for it`);
  };
  for (let index = 0; index < 700; index++) record(index % 3 ? typical : largest);
  assert.equal(state.attempts.length, 500);
  // The room is exact: 500 of the largest attempts use all of it.
  for (let index = 0; index < 500; index++) record(largest);
  assert.equal(progress.practiceHistoryReserve(state.attempts), 0);
  assert.equal(progress.savedBytes(state.attempts) - progress.savedBytes([]), progress.practiceHistoryReserve([]));
});

test("the default adapter is importable without a browser and fails clearly when called there", async () => {
  const response = await body(await browserProgressRequest("GET"), 503);
  assert.equal(response.code, "browser_storage_unavailable");
});


test("the serial task queue makes a completed practice check wait for an in-flight profile save and use its revision", async () => {
  const { request } = fixture();
  const queue = createSerialTaskQueue();
  let revision = 0;
  let release;
  const delayedSave = new Promise(resolve => { release = resolve; });
  let profileStarted;
  const started = new Promise(resolve => { profileStarted = resolve; });
  const saveProfile = queue(async () => {
    profileStarted();
    await delayedSave;
    const result = await body(await request("POST", profile({ name: "Queued learner", revision })));
    revision = result.revision;
  });
  await started;
  let attemptStarted = false;
  const saveAttempt = queue(async () => {
    attemptStarted = true;
    const result = await body(await request("POST", operation({ action: "recordAttempt", missionId: "hello", passed: 2, total: 2, category: "success", revision })));
    revision = result.revision;
  });
  await Promise.resolve();
  assert.equal(attemptStarted, false, "the completed check must not race or be discarded");
  release();
  await Promise.all([saveProfile, saveAttempt]);
  const result = await body(await request("GET"));
  assert.equal(result.revision, 2);
  assert.equal(result.state.profile.name, "Queued learner");
  assert.equal(result.state.attempts.length, 1);
  assert.equal(result.state.attempts[0].missionId, "hello");
});

test("a rejected queued task does not prevent the next independent save", async () => {
  const queue = createSerialTaskQueue();
  const failed = queue(async () => { throw new Error("unavailable"); });
  const next = queue(async () => "saved");
  await assert.rejects(failed, /unavailable/);
  assert.equal(await next, "saved");
});

test("Forge sends saves through the serial queue at the latest revision and practice handlers repair focus before removing a control", () => {
  const forge = read("../app/components/Forge.tsx");
  assert.ok(forge.includes("saveQueue.current(()=>mutationRef.current(fields))"), "mutate must queue a save instead of rejecting one that arrives during another save");
  assert.ok(forge.includes("revision:revisionRef.current"), "a queued save must use the revision left by the save before it");
  const practice = read("../app/components/Practice.tsx");
  assert.ok(practice.includes('active.matches(":focus-visible")'), "focus must move to the editor only when the removed control had keyboard focus");
  const between = (start, end) => {
    const from = practice.indexOf(start), to = practice.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Practice.tsx no longer has ${start} followed by ${end}`);
    return practice.slice(from, to);
  };
  const handlers = {
    selectMission: between("function selectMission(", "function cancel("),
    cancel: between("function cancel(", "async function run("),
    "the start of run": between("async function run(", "const nonce"),
    fail: between("const fail =", "timer = setTimeout("),
    "the result branch": between('data.type === "result"', 'window.addEventListener("message", listener)'),
  };
  for (const [name, body] of Object.entries(handlers)) assert.ok(body.includes("focusEditorAfterRemoval();"), `${name} must call focusEditorAfterRemoval()`);
});
