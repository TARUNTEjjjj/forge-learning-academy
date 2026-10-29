import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const testDir = dirname(fileURLToPath(import.meta.url));
const dataPath = join(testDir, "../public/curriculum.json");
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const modules = data.phases.flatMap(phase => phase.modules);
const examples = modules.flatMap(module => module.codeExamples.map(example => ({ ...example, moduleId: module.id })));
const officialHosts = new Set([
  "docs.python.org", "www.python.org", "code.visualstudio.com", "missing.csail.mit.edu",
  "git-scm.com", "docs.github.com", "learn.github.com", "ocw.mit.edu", "isocpp.org",
  "isocpp.github.io", "codeforces.com", "cses.fi", "atcoder.jp", "leetcode.com",
  "icpc.global", "developer.mozilla.org", "fastapi.tiangolo.com", "www.postgresql.org",
  "docs.pytest.org", "hypothesis.readthedocs.io", "playwright.dev", "owasp.org",
  "opentelemetry.io", "sre.google", "docs.docker.com", "www.micro1.ai",
  "www.mercor.com", "outlier.ai", "www.afterquery.com", "clang.llvm.org"
]);

function unique(values, description) {
  assert.equal(new Set(values).size, values.length, `${description} must be unique`);
}

test("curriculum allocates exactly 2,000 hours without module-hour drift", () => {
  assert.equal(data.totalHours, 2000);
  assert.equal(data.phases.length, 10);
  assert.equal(modules.length, 50);
  assert.equal(data.phases.reduce((total, phase) => total + phase.hours, 0), data.totalHours);
  assert.equal(Object.values(data.overview.timeAllocation).reduce((a, b) => a + b), data.totalHours);
  for (const phase of data.phases) {
    assert.equal(phase.modules.reduce((total, module) => total + module.hours, 0), phase.hours, phase.id);
    for (const module of phase.modules) assert.ok(Number.isInteger(module.hours) && module.hours > 0);
  }
});

test("prerequisites form a valid ordered acyclic graph", () => {
  unique(data.phases.map(phase => phase.id), "Phase identifiers");
  const seen = new Set();
  for (const phase of data.phases) {
    unique(phase.prerequisites, `${phase.id} prerequisites`);
    for (const prerequisite of phase.prerequisites) assert.ok(seen.has(prerequisite), `${phase.id} requires unknown or later phase ${prerequisite}`);
    seen.add(phase.id);
  }
  assert.deepEqual(data.phases[0].prerequisites, []);
});

test("every module has substantive instruction, work and observable criteria", () => {
  unique(modules.map(module => module.id), "Module identifiers");
  for (const phase of data.phases) {
    assert.match(phase.id, /^[a-z][a-z0-9-]*$/);
    assert.match(phase.color, /^#[0-9a-f]{6}$/i);
    assert.ok(phase.modules.length >= 5 && phase.modules.length <= 8);
    for (const module of phase.modules) {
      assert.match(module.id, /^[a-z][a-z0-9-]*$/);
      for (const key of ["title", "task", "project"]) assert.ok(typeof module[key] === "string" && module[key].length > 8, `${module.id}.${key}`);
      assert.ok(module.lessons.length >= 3);
      assert.ok(module.lessons.every(paragraph => paragraph.trim().split(/\s+/).length >= 30), module.id);
      assert.ok(module.successCriteria.length >= 3);
      assert.ok(module.successCriteria.every(criterion => typeof criterion === "string" && criterion.length > 12));
      assert.ok(module.resources.length >= 1);
      assert.ok(Array.isArray(module.codeExamples));
      for (const example of module.codeExamples) {
        assert.ok(["python", "cpp", "shell"].includes(example.language));
        assert.ok(example.code.length > 8 && example.explanation.length > 30);
      }
    }
  }
});

test("resource URLs use official allowlisted HTTPS origins without credential leaks", () => {
  unique(data.resources.map(resource => resource.id), "Resource identifiers");
  const references = [...data.resources, ...data.problems, ...modules.flatMap(module => module.resources)];
  for (const reference of references) {
    const url = new URL(reference.url);
    assert.equal(url.protocol, "https:", reference.url);
    assert.ok(officialHosts.has(url.hostname), `Unreviewed origin: ${url.hostname}`);
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.equal(url.port, "");
    assert.ok(!/[?&](token|key|secret|password)=/i.test(reference.url));
    assert.ok(typeof reference.title === "string" && reference.title.length > 2);
  }
  const catalogue = new Set(data.resources.map(resource => resource.url));
  for (const module of modules) for (const resource of module.resources) assert.ok(catalogue.has(resource.url), `Uncatalogued module source: ${resource.url}`);
});

test("problem catalogue links original judges and does not contain copied solutions", () => {
  assert.equal(data.problems.length, 36);
  assert.equal(data.problems.filter(problem => problem.platform === "Codeforces").length, 25);
  unique(data.problems.map(problem => problem.id), "Problem identifiers");
  unique(data.problems.map(problem => problem.url), "Problem links");
  const phaseIds = new Set(data.phases.map(phase => phase.id));
  const hosts = { Codeforces: "codeforces.com", CSES: "cses.fi", AtCoder: "atcoder.jp", LeetCode: "leetcode.com" };
  for (const problem of data.problems) {
    assert.ok(phaseIds.has(problem.phaseId));
    assert.equal(new URL(problem.url).hostname, hosts[problem.platform]);
    assert.ok(["Foundation", "Developing", "Advanced", "Expert"].includes(problem.difficulty));
    assert.ok(problem.topic.length > 3 && problem.practiceNote.length > 30);
    for (const forbidden of ["solution", "statement", "editorial", "answer", "code"]) assert.ok(!(forbidden in problem));
  }
  assert.match(data.overview.difficultyNote, /not live platform ratings/i);
});

test("curriculum preserves realistic expectations and critical trust boundaries", () => {
  assert.match(data.overview.promise, /does not guarantee/i);
  assert.match(data.overview.pace, /50 weeks/);
  assert.match(data.overview.pace, /22\.2/);
  const allLessons = modules.flatMap(module => module.lessons).join("\n");
  for (const concept of ["PowerShell", "virtual environment", "git rebase --abort", "amortized", "idempotency", "authorization", "rollback", "untrusted", "property", "overflow"]) {
    assert.ok(allLessons.toLowerCase().includes(concept.toLowerCase()), `Missing critical concept: ${concept}`);
  }
  assert.match(data.overview.assessment, /inspect or delete/);
  assert.match(data.overview.integrity, /own work/);
  assert.doesNotMatch(JSON.stringify(data), /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/);
  for (const module of modules) for (const paragraph of module.lessons) assert.doesNotMatch(paragraph, /<\s*(script|iframe|object|embed)\b/i);
});

test("all twelve Python examples parse and their documented behavior passes boundary checks", () => {
  assert.equal(examples.filter(example => example.language === "python").length, 12);
  const result = spawnSync(process.env.PYTHON || "python3", [join(testDir, "curriculum_examples.py"), dataPath], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ""}`);
  assert.match(result.stdout, /12 Python snippets parsed/);
});

test("all four shell teaching snippets parse without executing commands", () => {
  const shells = examples.filter(example => example.language === "shell");
  assert.equal(shells.length, 4);
  for (const example of shells) {
    const result = spawnSync("sh", ["-n"], { input: example.code, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, `${example.moduleId}: ${result.stderr}`);
  }
});

test("C++ example compiles with warnings and prints the correct total", t => {
  const compiler = process.env.CXX || "c++";
  const available = spawnSync(compiler, ["--version"], { encoding: "utf8", timeout: 10000 });
  if (available.error?.code === "ENOENT") return t.skip("Install a C++ compiler or set CXX to validate this example.");
  assert.equal(available.status, 0, available.stderr);
  const directory = mkdtempSync(join(tmpdir(), "forge-curriculum-cpp-"));
  try {
    const source = join(directory, "example.cpp");
    const binary = join(directory, process.platform === "win32" ? "example.exe" : "example");
    const cpp = examples.filter(example => example.language === "cpp");
    assert.equal(cpp.length, 1);
    writeFileSync(source, cpp[0].code);
    const compilation = spawnSync(compiler, ["-std=c++20", "-Wall", "-Wextra", "-Wpedantic", "-Werror", source, "-o", binary], { encoding: "utf8", timeout: 30000 });
    assert.equal(compilation.status, 0, compilation.stderr);
    const execution = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout.trim(), "80");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the 17 examples contain no unexpected executable language", () => {
  assert.equal(examples.length, 17);
  assert.deepEqual([...new Set(examples.map(example => example.language))].sort(), ["cpp", "python", "shell"]);
});
