/**
 * Real browser/Pyodide regression, intentionally separate from the fast Node suite.
 * Build and serve the app before running. No learner execution is stubbed.
 *
 * FORGE_ORIGIN=http://127.0.0.1:4173 \
 * PLAYWRIGHT_CORE_PATH=/absolute/path/to/node_modules/playwright-core \
 * BROWSER_EXECUTABLE=/absolute/path/to/chrome \
 * FORGE_BROWSER_REPORT=/absolute/path/to/report.json node tests/python-browser.mjs
 *
 * Optional FORGE_BLOCK_CDN=1 adds a separate external-CDN-blocked run. Routing
 * disables browser HTTP caching, so that context runs separately. No context is
 * runtime cache evidence: the opaque-origin sandbox bypasses the HTTP cache, so
 * Chrome downloads the runtime on every run.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const origin = new URL(process.env.FORGE_ORIGIN || 'http://127.0.0.1:4173').origin;
assert(['http:', 'https:'].includes(new URL(origin).protocol), 'Use an HTTP(S) Forge origin.');
const reportPath = resolve(process.env.FORGE_BROWSER_REPORT || 'qa/python-browser.json');
const modulePath = process.env.PLAYWRIGHT_CORE_PATH;
const moduleSpecifier = modulePath
  ? pathToFileURL(isAbsolute(modulePath) && /\.(?:mjs|js)$/.test(modulePath)
    ? modulePath : join(resolve(modulePath), 'index.mjs')).href
  : 'playwright-core';
const { chromium } = await import(moduleSpecifier);
const defaultChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.BROWSER_EXECUTABLE
  || (process.platform === 'darwin' && existsSync(defaultChrome) ? defaultChrome : undefined);
const runtimePrefix = '/runtime/pyodide/314.0.1/';
const runtimeFiles = new Set([
  'pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm',
  'python_stdlib.zip', 'pyodide-lock.json',
]);
const editorName = 'Python code editor';
const frameSelector = 'iframe[title="Isolated Python execution"]';
const correct = 'def progress(completed, goal):\n    return 0 if goal <= 0 else max(0, min(100, completed * 100 // goal))\n';
const incomplete = 'def progress(completed, goal):\n    return 0\n';
const infinite = 'def progress(completed, goal):\n    while True:\n        pass\n';
const syntaxError = 'def progress(completed, goal)\n    return 0\n';
const stateWriter = 'import builtins\nbuiltins._forge_browser_probe = 73\n' + correct;
const stateReader = 'import builtins\ndef progress(completed, goal):\n'
  + '    if hasattr(builtins, "_forge_browser_probe"):\n        return -999\n'
  + '    return 0 if goal <= 0 else max(0, min(100, completed * 100 // goal))\n';
// The lab opens on the progress mission. Read its graded cases, so the expected scores follow lib/missions.ts.
const missionsSource = readFileSync(new URL('../lib/missions.ts', import.meta.url), 'utf8');
const { MISSIONS, jsonEqual } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(missionsSource,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`);
const progressCases = MISSIONS.find(mission => mission.id === 'progress').tests;
const checks = progressCases.length;
// `incomplete` returns 0, so under the lab's pass rule it passes exactly the cases that expect 0.
const incompletePassed = progressCases.filter(test => jsonEqual(0, test.expected)).length;
const report = {
  origin, runtimeVersion: '314.0.1', startedAt: new Date().toISOString(),
  passed: false, runs: [], network: [], contexts: [], errors: [], console: [],
};
const responseTasks = [];
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

async function checkpoint() {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}

async function newWorkspace(label, blockCdn = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const contextInfo = { label, blockCdn, routingDisablesCache: blockCdn, closed: false };
  report.contexts.push(contextInfo);
  const requests = new Map();
  if (blockCdn) {
    await context.route('https://cdn.jsdelivr.net/**', route => route.abort('blockedbyclient'));
  }
  context.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.includes('pyodide') && !url.pathname.endsWith('python_stdlib.zip')) return;
    const record = {
      context: label, url: request.url(), method: request.method(),
      startedAt: new Date().toISOString(), startedMs: Date.now(),
    };
    report.network.push(record);
    requests.set(request, record);
  });
  context.on('response', response => {
    const request = response.request();
    const record = requests.get(request);
    if (!record) return;
    record.status = response.status();
    record.headersMs = Date.now() - record.startedMs;
    const headers = response.headers();
    record.headers = Object.fromEntries(
      ['content-type', 'content-length', 'cache-control', 'access-control-allow-origin', 'etag']
        .filter(key => headers[key] !== undefined).map(key => [key, headers[key]]),
    );
    const task = (async () => {
      const error = await response.finished();
      record.finishedMs = Date.now() - record.startedMs;
      record.finishError = error?.message || null;
      record.timing = request.timing();
      try { record.sizes = await request.sizes(); } catch { /* A stopped request may have no sizes. */ }
    })().catch(error => { record.finishError = error.message; });
    responseTasks.push(task);
  });
  context.on('requestfailed', request => {
    const record = requests.get(request);
    if (record) {
      record.failedMs = Date.now() - record.startedMs;
      record.failure = request.failure()?.errorText || 'Request failed';
    }
  });
  page.on('pageerror', error => report.errors.push({ context: label, message: error.message }));
  page.on('crash', () => report.errors.push({ context: label, message: 'Browser page crashed' }));
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) {
      report.console.push({ context: label, type: message.type(), text: message.text().slice(0, 2000) });
    }
  });
  await page.goto(origin + '/#practice', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByLabel(editorName).waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('forge.browser-progress.v1');
    return raw && Array.isArray(JSON.parse(raw).state?.attempts);
  });
  return { context, page, label, contextInfo };
}

async function attemptCount(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('forge.browser-progress.v1')).state.attempts.length);
}

async function noExecutionFrame(page) {
  await page.waitForFunction(selector => document.querySelectorAll(selector).length === 0,
    frameSelector, { timeout: 5000 });
}

async function run(workspace, name, code, { passed = checks, message, category } = {}) {
  const { page, label } = workspace;
  const previousCount = await attemptCount(page);
  await page.getByLabel(editorName).fill(code);
  const entry = { context: label, name, expectedPassed: passed, expectedMessage: message || null };
  report.runs.push(entry);
  const start = Date.now();
  await page.getByRole('button', { name: 'Check solution', exact: true }).click();
  await page.locator('.lab-feedback').waitFor({ timeout: 75_000 });
  entry.milliseconds = Date.now() - start;
  entry.feedback = (await page.locator('.lab-feedback').innerText()).slice(0, 1500);
  assert(entry.feedback.includes(message || `${passed} / ${checks} checks passed`), `${name}: ${entry.feedback}`);
  await noExecutionFrame(page);
  await page.waitForFunction(count => {
    const state = JSON.parse(localStorage.getItem('forge.browser-progress.v1'));
    return state.state.attempts.length === count;
  }, previousCount + 1, { timeout: 5000 });
  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem('forge.browser-progress.v1')).state.attempts.at(-1));
  assert.equal(latest.passed, passed, `${name}: saved score`);
  assert.equal(latest.total, checks, `${name}: saved denominator`);
  if (category) assert.equal(latest.category, category, `${name}: saved feedback category`);
  assert.equal(await page.getByLabel(editorName).inputValue(), code, `${name}: code preserved`);
  entry.saved = { passed: latest.passed, total: latest.total, category: latest.category };
  entry.remainingIframes = await page.locator(frameSelector).count();
  entry.passed = true;
  await checkpoint();
  console.log(`PASS ${label}: ${name} (${entry.milliseconds}ms)`);
}

async function stopRun(workspace) {
  const { page, label } = workspace;
  const previousCount = await attemptCount(page);
  await page.getByLabel(editorName).fill(infinite);
  await page.getByRole('button', { name: 'Check solution', exact: true }).click();
  await page.getByText('Running your function against the selected cases. This run stops automatically after 8 seconds.', { exact: true }).waitFor({ timeout: 65_000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByText(/Run stopped\. Your code is saved here/).waitFor();
  await noExecutionFrame(page);
  assert.equal(await attemptCount(page), previousCount, 'Explicit Stop must not invent a failed mark.');
  assert.equal(await page.getByLabel(editorName).inputValue(), infinite, 'Stop preserves the draft.');
  report.runs.push({ context: label, name: 'explicit Stop', passed: true, remainingIframes: 0, recordedAttempt: false });
  await checkpoint();
  console.log(`PASS ${label}: explicit Stop`);
}

async function closeWorkspace(workspace) {
  await workspace.context.close();
  workspace.contextInfo.closed = true;
}

try {
  const repeated = await newWorkspace('repeated-no-routing');
  for (let pair = 1; pair <= 2; pair++) {
    await run(repeated, `correct pair ${pair}`, correct);
    await run(repeated, `incomplete pair ${pair}`, incomplete, { passed: incompletePassed });
  }
  await run(repeated, 'write isolated builtins state', stateWriter);
  await run(repeated, 'fresh interpreter has no previous builtins state', stateReader);
  await repeated.page.reload({ waitUntil: 'domcontentloaded' });
  await repeated.page.getByLabel(editorName).waitFor();
  assert.equal(await repeated.page.getByLabel(editorName).inputValue(), stateReader, 'Draft survives reload.');
  await run(repeated, 'valid after reload', correct);
  await run(repeated, 'Python syntax error', syntaxError, { passed: 0, message: 'Python paused near line', category: 'syntax' });
  await run(repeated, 'valid after syntax error', correct);
  await run(repeated, 'infinite loop reaches execution deadline', infinite, { passed: 0, message: '8-second limit', category: 'performance' });
  await run(repeated, 'valid after execution deadline', correct);
  await stopRun(repeated);
  await run(repeated, 'valid after explicit Stop', correct);
  await closeWorkspace(repeated);

  const cold = await newWorkspace('separate-cold-context');
  await run(cold, 'cold-context correct', correct);
  await run(cold, 'cold-context incomplete', incomplete, { passed: incompletePassed });
  await closeWorkspace(cold);

  if (process.env.FORGE_BLOCK_CDN === '1') {
    const blocked = await newWorkspace('CDN-blocked-separate-context', true);
    await run(blocked, 'real Python with external CDN blocked', correct);
    await closeWorkspace(blocked);
  }
  await Promise.allSettled(responseTasks);
  assert.deepEqual(report.errors, [], 'No browser page errors or crashes.');
  assert(report.network.length > 0, 'Runtime requests must be observed.');
  for (const request of report.network) {
    const url = new URL(request.url);
    assert.equal(url.origin, origin, 'Runtime must use the configured Forge origin.');
    assert.equal(url.pathname.slice(0, runtimePrefix.length), runtimePrefix, 'Runtime version path must be pinned.');
    assert(runtimeFiles.has(url.pathname.slice(runtimePrefix.length)), 'Unexpected runtime dependency.');
    assert.equal(request.status, 200, 'Every runtime asset succeeds.');
    assert.equal(request.finishError, null, 'Runtime response body completes.');
    assert.equal(request.failure, undefined, 'No failed runtime request.');
  }
  for (const name of runtimeFiles) {
    assert(report.network.some(request => new URL(request.url).pathname === runtimePrefix + name), `Missing runtime asset: ${name}`);
  }
  report.passed = true;
} catch (error) {
  report.failure = error.stack || error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await browser.close();
  await Promise.allSettled(responseTasks);
  report.finishedAt = new Date().toISOString();
  await checkpoint();
  console.log(`Browser receipt: ${reportPath}`);
}
