import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

// Load the production pure models without a browser, bundler, or duplicate implementation.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText).toString("base64")}`;
const missionsUrl = moduleUrl(read("../lib/missions.ts"));
const missions = await import(missionsUrl);
const gitSource = read("../app/components/GitLab.tsx").split("export default function GitLab")[0].replace(/^import .* from .*;$/gm, "");
const { initialGitState, runGitCommand, gitChanges } = await import(moduleUrl(gitSource));
const practiceSource = read("../app/components/Practice.tsx").split("export default function Practice")[0].replace(/^import pythonWorkerSource .*;$/gm, "").replace(/^import .* from "react";$/gm, "").replace(/^import .* from "lucide-react";$/gm, "").replace('"../../lib/missions"', JSON.stringify(missionsUrl));
const { validateRunnerResult, resetPracticeStorage, readStore, writeStore, disposeSandbox } = await import(moduleUrl(practiceSource + "\nexport { readStore, writeStore, disposeSandbox };"));
const step = (state, command) => runGitCommand(state, command).state;
const firstCommit = () => step(step(initialGitState(), "git add ."), 'git commit -m "Add tracker"');
const edit = (state, path, content) => ({ ...state, working: { ...state.working, [path]: content } });
const commitEdit = (state, path, content) => step(step(edit(state, path, content), `git add ${path}`), 'git commit -m "Update file"');
const current = state => state.commits.find(commit => commit.id === state.branches[state.branch]);

test("initial repository distinguishes untracked files from committed files", () => {
  const state = initialGitState();
  assert.deepEqual(gitChanges(state), { staged: [], changed: [], untracked: ["tracker.py"] });
  assert.equal(state.commits.length, 1);
});

test("staging captures a snapshot, not later edits", () => {
  let state = edit(initialGitState(), "tracker.py", "version one");
  state = step(state, "git add tracker.py"); state = edit(state, "tracker.py", "version two");
  state = step(state, 'git commit -m "Keep first version"');
  assert.equal(current(state).files["tracker.py"], "version one");
  assert.equal(state.working["tracker.py"], "version two");
  assert.deepEqual(gitChanges(state).changed, ["tracker.py"]);
});

test("git command execution does not mutate its input", () => {
  const original = initialGitState(); const saved = JSON.stringify(original);
  runGitCommand(original, "git add .");
  assert.equal(JSON.stringify(original), saved);
});

test("committing nothing preserves history", () => {
  const state = initialGitState(); const result = runGitCommand(state, 'git commit -m "Empty"');
  assert.equal(result.state.commits.length, 1); assert.match(result.output, /No staged changes/);
});

test("quotes preserve commit messages and unmatched quotes are actionable", () => {
  let state = step(initialGitState(), "git add .");
  state = step(state, 'git commit -m "A useful multi-word message"');
  assert.equal(current(state).message, "A useful multi-word message");
  assert.match(runGitCommand(state, 'git commit -m "unfinished').output, /quoted string is still open/);
});

test("branch creation moves neither history nor files", () => {
  const original = firstCommit(); const state = step(original, "git branch feature");
  assert.equal(state.branch, "main"); assert.equal(state.branches.feature, state.branches.main);
  assert.deepEqual(state.working, original.working);
});

test("creating and switching a branch carries uncommitted work", () => {
  const state = step(initialGitState(), "git switch -c feature/streak");
  assert.equal(state.branch, "feature/streak"); assert.ok(state.working["tracker.py"]);
});

test("existing branch switch protects uncommitted edits", () => {
  let state = step(firstCommit(), "git branch other"); state = edit(state, "tracker.py", "draft");
  const result = runGitCommand(state, "git switch other");
  assert.equal(result.state.branch, "main"); assert.equal(result.state.working["tracker.py"], "draft");
  assert.match(result.output, /clean worktree/);
});

test("switching branches restores their snapshots", () => {
  let state = step(firstCommit(), "git switch -c feature");
  state = commitEdit(state, "tracker.py", "feature version");
  state = step(state, "git switch main"); assert.notEqual(state.working["tracker.py"], "feature version");
  state = step(state, "git switch feature"); assert.equal(state.working["tracker.py"], "feature version");
});

test("fast-forward changes only the receiving branch pointer", () => {
  let state = step(firstCommit(), "git switch -c feature"); state = commitEdit(state, "tracker.py", "feature version");
  const count = state.commits.length;
  state = step(step(state, "git switch main"), "git merge feature");
  assert.equal(state.branches.main, state.branches.feature); assert.equal(state.commits.length, count);
  assert.equal(state.working["tracker.py"], "feature version");
});

test("divergent changes to different files create a two-parent merge", () => {
  let state = step(firstCommit(), "git switch -c feature"); state = commitEdit(state, "tracker.py", "feature change");
  const featureTip = state.branches.feature;
  state = step(state, "git switch main"); state = commitEdit(state, "README.md", "main documentation");
  const mainTip = state.branches.main;
  state = step(state, "git merge feature");
  assert.deepEqual(current(state).parents, [mainTip, featureTip]);
  assert.equal(state.working["README.md"], "main documentation"); assert.equal(state.working["tracker.py"], "feature change");
  assert.equal(state.merge, null);
});

function conflictingState() {
  let state = step(firstCommit(), "git switch -c feature"); state = commitEdit(state, "tracker.py", "feature content");
  state = step(state, "git switch main"); state = commitEdit(state, "tracker.py", "main content");
  return step(state, "git merge feature");
}

test("conflicts expose both versions and block commit until resolved", () => {
  const state = conflictingState(); assert.deepEqual(state.merge.conflicts, ["tracker.py"]);
  assert.match(state.working["tracker.py"], /<<<<<<< HEAD/); assert.match(state.working["tracker.py"], /feature content/);
  assert.match(runGitCommand(state, "git add tracker.py").output, /Resolve the conflict markers/);
  assert.match(runGitCommand(state, 'git commit -m "Merge"').output, /Resolve and stage/);
});

test("resolved merge creates a commit that preserves both histories", () => {
  let state = conflictingState(); const parents = [state.branches.main, state.branches.feature];
  state = edit(state, "tracker.py", "combined content"); state = step(state, "git add tracker.py");
  assert.deepEqual(state.merge.conflicts, []);
  state = step(state, 'git commit -m "Resolve both ideas"');
  assert.deepEqual(current(state).parents, parents); assert.equal(state.merge, null);
  assert.equal(current(state).files["tracker.py"], "combined content");
});

test("merge abort restores the receiving branch without history loss", () => {
  const before = conflictingState(); const after = step(before, "git merge --abort");
  assert.equal(after.merge, null); assert.equal(after.working["tracker.py"], "main content");
  assert.equal(after.commits.length, before.commits.length); assert.deepEqual(gitChanges(after), { staged: [], changed: [], untracked: [] });
});

test("merge base is the nearest common ancestor, so an older one cannot undo a committed revert", () => {
  // Matches `git merge-base`: O is closer by path length but is an ancestor of L, the real base.
  const original = initialGitState().working["README.md"];
  let state = step(firstCommit(), "git branch q");
  state = commitEdit(state, "README.md", "L\n"); const base = state.branches.main;
  state = step(step(state, "git branch tb"), "git switch -c ub");
  for (const text of ["p1\n", "p2\n", "p3\n"]) state = commitEdit(state, "tracker.py", text);
  state = commitEdit(step(state, "git switch q"), "tracker.py", "p3\n");
  state = step(step(state, "git switch ub"), "git merge q");
  state = commitEdit(state, "README.md", original);
  state = commitEdit(step(state, "git switch tb"), "tracker.py", "p3\n");
  const ours = step(state, "git switch ub").branches.ub, theirs = state.branches.tb;
  state = step(step(state, "git switch ub"), "git merge tb");
  assert.deepEqual(current(state).parents, [ours, theirs]); assert.equal(state.merge, null);
  assert.equal(state.working["README.md"], original, `merge base should be ${base}; the revert must survive`);
  assert.equal(state.working["tracker.py"], "p3\n");
});

test("merging an included ancestor is a no-op", () => {
  let state = step(firstCommit(), "git branch older"); state = commitEdit(state, "README.md", "New readme");
  const result = runGitCommand(state, "git merge older"); assert.deepEqual(result.state, state); assert.match(result.output, /Already up to date/);
});

test("reset unstages everything without discarding files", () => {
  let state = step(initialGitState(), "git add ."); state = step(state, "git reset");
  assert.deepEqual(gitChanges(state).staged, []); assert.ok(state.working["tracker.py"]); assert.equal(state.commits.length, 1);
});

test("restore --staged preserves working contents and restore uses the index", () => {
  let state = firstCommit(); state = edit(state, "tracker.py", "staged version"); state = step(state, "git add tracker.py");
  state = edit(state, "tracker.py", "unstaged version"); state = step(state, "git restore tracker.py");
  assert.equal(state.working["tracker.py"], "staged version");
  state = step(state, "git restore --staged tracker.py"); assert.equal(state.working["tracker.py"], "staged version"); assert.deepEqual(gitChanges(state).staged, []);
});

test("unstaging a new file leaves it untracked", () => {
  const state = step(step(initialGitState(), "git add tracker.py"), "git restore --staged tracker.py");
  assert.deepEqual(gitChanges(state).untracked, ["tracker.py"]); assert.ok(state.working["tracker.py"]);
});

test("Git log shows only ancestors of the current HEAD", () => {
  let state = step(firstCommit(), "git switch -c feature"); state = commitEdit(state, "tracker.py", "feature");
  const id = state.branches.feature; state = step(state, "git switch main");
  assert.ok(!runGitCommand(state, "git log").output.includes(id));
  state = step(state, "git merge feature"); assert.ok(runGitCommand(state, "git log").output.includes(id));
});

test("branch validation prevents prototype names and invalid refs", () => {
  for (const name of ["__proto__", "constructor", "bad..ref", "a//b", "x.lock", "a/."]) {
    const state = step(initialGitState(), `git branch ${name}`); assert.deepEqual(Object.keys(state.branches), ["main"]);
  }
  let state = step(firstCommit(), "git branch feature"); state = step(state, "git branch feature/sub"); assert.ok(!state.branches["feature/sub"]);
});

test("branch validation rejects names git refuses: HEAD and .lock path components", () => {
  // git check-ref-format --branch rejects these; a branch named HEAD would also mislabel HEAD in git log.
  for (const command of ["git branch HEAD", "git switch -c HEAD", "git branch a.lock/b"]) {
    const result = runGitCommand(firstCommit(), command);
    assert.deepEqual(Object.keys(result.state.branches), ["main"], command); assert.equal(result.state.branch, "main", command);
    assert.match(result.output, /Use a short branch name/, command);
  }
  assert.ok(step(firstCommit(), "git branch feature/HEAD").branches["feature/HEAD"], "only the exact name HEAD is reserved");
});

test("network commands explicitly explain simulation boundary", () => {
  for (const command of ["git push", "git clone url", "git fetch", "git pull"]) assert.match(runGitCommand(initialGitState(), command).output, /no remote repository/);
});

test("diff separates staged and unstaged changes and excludes untracked", () => {
  let state = initialGitState(); assert.match(runGitCommand(state, "git diff").output, /No tracked working differences/);
  state = step(state, "git add tracker.py"); assert.match(runGitCommand(state, "git diff --staged").output, /tracker.py/);
  assert.match(runGitCommand(state, "git diff").output, /No tracked working differences/);
});

test("runner validates structure, finite JSON, result count and error lengths", () => {
  assert.equal(validateRunnerResult({ results: [{ value: 25, error: null, mutated: false }], error: null }, 1), true);
  assert.equal(validateRunnerResult({ results: [], error: "Python paused near line 2" }, 3), true);
  for (const bad of [null, {}, { results: [], error: null }, { results: [{ value: NaN, error: null, mutated: false }], error: null }, { results: [{ value: 5, error: null }], error: null }, { results: [{ value: 5, error: "a".repeat(2001), mutated: false }], error: null }]) assert.equal(validateRunnerResult(bad, 1), false);
});

test("JSON equality ignores dictionary key ordering but preserves list order and types", () => {
  assert.equal(missions.jsonEqual({ b: 2, a: [1, true] }, { a: [1, true], b: 2 }), true);
  assert.equal(missions.jsonEqual([1, 2], [2, 1]), false); assert.equal(missions.jsonEqual(1, true), false);
  assert.equal(missions.jsonEqual({}, []), false); assert.equal(missions.jsonEqual(null, {}), false);
});

test("all original missions provide contracts, examples, edge cases, and hints", () => {
  assert.equal(missions.MISSIONS.length, 12); assert.equal(new Set(missions.MISSIONS.map(m => m.id)).size, 12);
  for (const mission of missions.MISSIONS) {
    assert.ok(mission.contract.length > 40, mission.id); assert.ok(mission.tests.length >= 4, mission.id);
    assert.equal(mission.tests.filter(t => t.sample).length, 2, mission.id); assert.equal(mission.hints.length, 3, mission.id);
    assert.ok(mission.starter.includes(`def ${mission.functionName}(`), mission.id); assert.ok(mission.resource.url.startsWith("https://"));
  }
});

const SOLUTIONS = {
  progress: `def progress(completed, goal):\n    return 0 if goal <= 0 else max(0, min(100, completed * 100 // goal))`,
  "study-streak": `def longest_streak(minutes):\n    best = current = 0\n    for value in minutes:\n        current = current + 1 if value > 0 else 0\n        best = max(best, current)\n    return best`,
  "issue-labels": `def label_counts(labels):\n    result = {}\n    for label in labels:\n        label = label.strip().lower()\n        if label: result[label] = result.get(label, 0) + 1\n    return result`,
  queue: `def review_order(requests):\n    return [item[0] for item in sorted(requests, key=lambda x: (-x[1], -x[2], x[0]))]`,
  "first-bad": `def first_at_least(times, threshold):\n    lo, hi = 0, len(times)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if times[mid] < threshold: lo = mid + 1\n        else: hi = mid\n    return lo`,
  brackets: `def balanced(text):\n    stack = []\n    pairs = {')':'(', ']':'[', '}':'{'}\n    for char in text:\n        if char in '([{': stack.append(char)\n        elif char in pairs:\n            if not stack or stack.pop() != pairs[char]: return False\n    return not stack`,
  "pair-budget": `def count_pairs(costs, budget):\n    values = sorted(costs)\n    left, right, count = 0, len(values)-1, 0\n    while left < right:\n        if values[left] + values[right] <= budget:\n            count += right-left\n            left += 1\n        else: right -= 1\n    return count`,
  outages: `def merge_windows(windows):\n    result = []\n    for start, end in sorted(windows):\n        if not result or start > result[-1][1]: result.append([start, end])\n        else: result[-1][1] = max(result[-1][1], end)\n    return result`,
  network: `from collections import deque\ndef shortest_hops(graph, start, target):\n    queue = deque([(start,0)])\n    visited = {start}\n    while queue:\n        node, distance = queue.popleft()\n        if node == target: return distance\n        for neighbor in graph.get(node, []):\n            if neighbor not in visited:\n                visited.add(neighbor)\n                queue.append((neighbor, distance+1))\n    return -1`,
  "release-plan": `import heapq\ndef build_order(deps):\n    indegree = {name:len(items) for name,items in deps.items()}\n    children = {name:[] for name in deps}\n    for name,items in deps.items():\n        for item in items: children[item].append(name)\n    heap = [name for name in deps if indegree[name] == 0]\n    heapq.heapify(heap)\n    result = []\n    while heap:\n        name = heapq.heappop(heap)\n        result.append(name)\n        for child in children[name]:\n            indegree[child] -= 1\n            if indegree[child] == 0: heapq.heappush(heap, child)\n    return result if len(result) == len(deps) else []`,
  "test-engineer": `def first_match(values, target):\n    left, right, answer = 0, len(values)-1, -1\n    while left <= right:\n        mid = (left+right)//2\n        if values[mid] < target: left = mid+1\n        else:\n            if values[mid] == target: answer = mid\n            right = mid-1\n    return answer`,
  capacity: `def best_plan(hours, values, budget):\n    dp = [0]*(budget+1)\n    for cost,value in zip(hours,values):\n        for b in range(budget, cost-1, -1): dp[b] = max(dp[b], dp[b-cost]+value)\n    return dp[budget]`,
};
const worker = read("../lib/python-worker.js");
const harness = worker.match(/runPythonAsync\(`([\s\S]*?)`\)/)[1].trim().replace(/_forge_run\(\)$/, "print(_forge_run())");
function runPython(code, functionName, cases) {
  const payload = JSON.stringify({ code, functionName, cases });
  const python = `__forge_payload = ${JSON.stringify(payload)}\n${harness}`;
  const result = spawnSync(process.env.PYTHON_BIN || "python3", ["-c", python], { encoding: "utf8", timeout: 8000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout.trim());
}

for (const mission of missions.MISSIONS) test(`production Python harness: ${mission.id} passes its full contract suite`, () => {
  const actual = runPython(SOLUTIONS[mission.id], mission.functionName, mission.tests.map(test => test.args));
  assert.equal(actual.error, null);
  actual.results.forEach((result, index) => {
    assert.equal(result.error, null, mission.tests[index].label);
    assert.ok(missions.jsonEqual(result.value, mission.tests[index].expected), `${mission.tests[index].label}: expected ${JSON.stringify(mission.tests[index].expected)}, got ${JSON.stringify(result.value)}`);
    if (mission.preserveInput) assert.equal(result.mutated, false);
  });
});

test("production harness gives calm syntax feedback and detects missing functions", () => {
  const invalid = runPython("def progress(x)\n    return x", "progress", [[1]]); assert.match(invalid.error, /Python paused near line/);
  const missing = runPython("x = 1", "progress", [[1]]); assert.match(missing.error, /Define a function named progress/);
});

test("production harness distinguishes runtime errors and input mutation", () => {
  const error = runPython("def f(x):\n    return 1/0", "f", [[1]]); assert.match(error.results[0].error, /ZeroDivisionError/);
  const mutation = runPython("def f(x):\n    x.append(2)\n    return x", "f", [[[1]]]); assert.equal(mutation.results[0].mutated, true);
});

test("runner keeps expected answers outside worker and isolates app origin", () => {
  const ui = read("../app/components/Practice.tsx");
  assert.match(ui, /setAttribute\("sandbox", "allow-scripts"\)/); assert.ok(!ui.includes('"allow-same-origin"'));
  assert.match(ui, /event.source !== frame\?\.contentWindow/); assert.match(ui, /event.data\?\.nonce !== nonce/);
  assert.match(ui, /cases: tests.map\(test => test.args\)/); assert.match(ui, /60000/); assert.match(ui, /8000/);
  assert.match(ui, /if \(started\) return/); assert.match(ui, /if \(!started\) return/);
  assert.match(ui, /python-worker\.js\?raw/);
  assert.match(ui, /runtime\/pyodide\/314\.0\.1\//);
  assert.match(worker, /import\(runtimeBase \+ "pyodide\.mjs"\)/);
  assert.ok(!ui.includes("cdn.jsdelivr.net") && !worker.includes("cdn.jsdelivr.net"));
});

test("runner waits for matching worker termination before removing its sandbox, with bounded fallback", () => {
  const previous = { window: globalThis.window, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const timers = new Map(); let id = 0;
  globalThis.window = new EventTarget();
  globalThis.setTimeout = callback => { timers.set(++id, callback); return id; };
  globalThis.clearTimeout = key => timers.delete(key);
  const messages = []; let removed = 0;
  const child = { postMessage: (...args) => messages.push(args) };
  const frame = { contentWindow: child, remove: () => removed++ };
  const message = (source, data) => { const event = new Event("message"); Object.assign(event, { source, data }); window.dispatchEvent(event); };
  try {
    disposeSandbox(frame, "first-run");
    assert.deepEqual(messages, [[{ type: "stop", nonce: "first-run" }, "*"]]);
    assert.equal(removed, 0);
    message({}, { nonce: "first-run", stopped: true });
    message(child, { nonce: "old-run", stopped: true });
    assert.equal(removed, 0);
    message(child, { nonce: "first-run", stopped: true });
    assert.equal(removed, 1); assert.equal(timers.size, 0);
    message(child, { nonce: "first-run", stopped: true });
    assert.equal(removed, 1);
    disposeSandbox(frame, "second-run");
    [...timers.values()][0]();
    assert.equal(removed, 2); assert.equal(timers.size, 0);
    message(child, { nonce: "second-run", stopped: true });
    assert.equal(removed, 2);
  } finally { Object.assign(globalThis, previous); }
});


test("confirmed deletion clears same-tab practice cache and signals active runtimes", () => {
  const oldStorage = globalThis.localStorage, oldWindow = globalThis.window;
  const entries = new Map([["unrelated", "keep"]]);
  globalThis.localStorage = {
    get length() { return entries.size; }, key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(key) ?? null; }, setItem(key, value) { entries.set(key, value); }, removeItem(key) { entries.delete(key); },
  };
  globalThis.window = new EventTarget(); let stopped = 0;
  window.addEventListener("forge-lab-reset", () => stopped++);
  try {
    writeStore("forge.lab.code.progress", "private draft"); writeStore("forge.lab.completed", '["progress"]');
    assert.equal(readStore("forge.lab.code.progress", "starter"), "private draft");
    writeStore("forge.lab.user.alice.code.progress", "Alice draft"); writeStore("forge.lab.user.bob.code.progress", "Bob draft");
    assert.equal(resetPracticeStorage("alice"), true);
    assert.equal(readStore("forge.lab.user.alice.code.progress", "starter"), "starter");
    assert.equal(readStore("forge.lab.user.bob.code.progress", "starter"), "Bob draft");
    assert.equal(resetPracticeStorage(), true);
    assert.equal(readStore("forge.lab.code.progress", "starter"), "starter");
    assert.equal(readStore("forge.lab.completed", "[]"), "[]");
    assert.equal(entries.get("unrelated"), "keep"); assert.equal(stopped, 2);
  } finally { globalThis.localStorage = oldStorage; globalThis.window = oldWindow; }
});
