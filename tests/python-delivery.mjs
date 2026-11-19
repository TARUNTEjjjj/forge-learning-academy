/**
 * Measures Python runtime delivery in a real browser with the real Pyodide runtime.
 * Intentionally separate from the fast Node suite. Build first, then run:
 *
 * FORGE_DIST=/absolute/path/to/dist \
 * PLAYWRIGHT_CORE_PATH=/absolute/path/to/node_modules/playwright-core \
 * FORGE_BROWSER=chromium|webkit \
 * BROWSER_EXECUTABLE=/absolute/path/to/chrome   # optional, Chromium only
 * FORGE_THROTTLE_MBPS=20                          # optional shared link speed for every response
 * FORGE_DELIVERY_REPORT=/absolute/path/to/report.json node tests/python-delivery.mjs
 *
 * FORGE_SERVE_ONLY=1 FORGE_PORT=4173 only serves the build the same way, for tests/python-browser.mjs.
 *
 * The script serves the build itself, applying public/_headers, ETag revalidation and gzip
 * for JavaScript, JSON and WebAssembly. Request counts and bytes are counted by that server,
 * so a run that the browser satisfied without contacting it is visible as zero requests.
 * A successful repeat run is never treated as cache evidence on its own. Gzip approximates,
 * but is not identical to, Cloudflare Pages' compression; compare runs, not absolute bytes.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = resolve(process.env.FORGE_DIST || 'dist');
const browserName = process.env.FORGE_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(browserName), 'FORGE_BROWSER must be chromium or webkit.');
const reportPath = resolve(process.env.FORGE_DELIVERY_REPORT || `qa/python-delivery-${browserName}.json`);
// A small reading of the Pages _headers file: "/path" and "/prefix/*" rules, applied in order.
const headerRules = [];
for (const line of readFileSync(join(dist, '_headers'), 'utf8').split('\n')) {
  if (/^\S/.test(line)) headerRules.push({ pattern: line.trim(), headers: {} });
  else if (line.trim() && headerRules.length) {
    const [name, ...value] = line.trim().split(':');
    headerRules.at(-1).headers[name.trim().toLowerCase()] = value.join(':').trim();
  }
}
function pagesHeaders(path) {
  const headers = {};
  for (const { pattern, headers: values } of headerRules) {
    const matches = pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
    if (matches) Object.assign(headers, values);
  }
  return headers;
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const compressible = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.wasm', '.txt']);
const files = new Map();
function loadFile(path) {
  if (files.has(path)) return files.get(path);
  let file = null;
  try {
    const absolute = normalize(join(dist, decodeURIComponent(path)));
    if (absolute.startsWith(dist) && statSync(absolute).isFile()) {
      const body = readFileSync(absolute);
      file = { body, etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`,
        gzip: compressible.has(extname(absolute)) ? gzipSync(body, { level: 6 }) : null, type: types[extname(absolute)] || 'application/octet-stream' };
    }
  } catch { file = null; }
  files.set(path, file);
  return file;
}

const throttle = Number(process.env.FORGE_THROTTLE_MBPS || 0);
assert(Number.isFinite(throttle) && throttle >= 0, 'FORGE_THROTTLE_MBPS must be a positive number of megabits per second.');
let linkFree = 0;
/** Sends a body over one shared link of FORGE_THROTTLE_MBPS, or at loopback speed without it. */
async function send(response, body) {
  if (!throttle || !body) { response.end(body); return; }
  const bytesPerMs = throttle * 1e6 / 8 / 1000;
  for (let offset = 0; offset < body.length; offset += 16384) {
    const chunk = body.subarray(offset, offset + 16384);
    linkFree = Math.max(linkFree, Date.now()) + chunk.length / bytesPerMs;
    await new Promise(done => setTimeout(done, Math.max(0, linkFree - Date.now())));
    if (response.destroyed) return;
    response.write(chunk);
  }
  response.end();
}

const log = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
  const file = loadFile(path) || (extname(path) ? null : loadFile('/index.html'));
  const entry = { at: Date.now(), method: request.method, path: url.pathname, status: 404, bytes: 0, conditional: !!request.headers['if-none-match'], origin: request.headers.origin ?? null };
  log.push(entry);
  if (!file) { response.writeHead(404); response.end(); return; }
  const headers = { 'content-type': file.type, etag: file.etag, ...pagesHeaders(url.pathname), vary: 'Accept-Encoding' };
  if (request.headers['if-none-match'] === file.etag) {
    entry.status = 304; response.writeHead(304, headers); response.end(); return;
  }
  const gzip = file.gzip && /\bgzip\b/.test(request.headers['accept-encoding'] || '');
  const body = gzip ? file.gzip : file.body;
  entry.status = 200; entry.bytes = body.length; entry.uncompressed = file.body.length;
  response.writeHead(200, { ...headers, ...(gzip ? { 'content-encoding': 'gzip' } : {}), 'content-length': body.length });
  void send(response, request.method === 'HEAD' ? undefined : body);
});
await new Promise(done => server.listen(Number(process.env.FORGE_PORT || 0), '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.env.FORGE_SERVE_ONLY === '1') {
  // Serves the build with its Pages headers for tests/python-browser.mjs; stop with Ctrl-C.
  console.log(`Serving ${dist} at ${origin}`);
  await new Promise(() => {});
}
const modulePath = process.env.PLAYWRIGHT_CORE_PATH;
const moduleSpecifier = modulePath
  ? pathToFileURL(isAbsolute(modulePath) && /\.(?:mjs|js)$/.test(modulePath)
    ? modulePath : join(resolve(modulePath), 'index.mjs')).href
  : 'playwright-core';
const playwright = await import(moduleSpecifier);
const defaultChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = browserName === 'chromium'
  ? process.env.BROWSER_EXECUTABLE || (process.platform === 'darwin' ? defaultChrome : undefined) : undefined;


const editorName = 'Python code editor';
const correct = 'def progress(completed, goal):\n    return 0 if goal <= 0 else max(0, min(100, completed * 100 // goal))\n';
const launchOptions = { headless: true, ...(executablePath ? { executablePath } : {}) };
const report = { browser: browserName, throttleMbps: throttle || null, origin, dist, startedAt: new Date().toISOString(), runs: [], errors: [], passed: false };
const browser = await playwright[browserName].launch(launchOptions);
report.browserVersion = browser.version();

function runtimeRequests(since) {
  const requests = log.filter(entry => entry.at >= since && entry.path.startsWith('/runtime/'));
  return {
    requests: requests.length,
    downloads: requests.filter(entry => entry.status === 200).length,
    revalidations: requests.filter(entry => entry.status === 304).length,
    bytes: requests.reduce((sum, entry) => sum + entry.bytes, 0),
    // Requests from the opaque-origin sandbox carry "Origin: null"; the app page's own requests do not.
    fromOpaqueOrigin: requests.filter(entry => entry.origin === 'null').length,
    files: requests.map(entry => `${entry.status} ${entry.path.split('/').pop()}`),
  };
}

async function measuredRun(page, label) {
  const since = Date.now();
  await page.getByLabel(editorName).fill(correct);
  // The running message can be shorter than a polling interval, so the page records both marks.
  await page.evaluate(() => {
    const marks = window.__forgeMarks = { start: performance.now() };
    const observer = new MutationObserver(() => {
      if (!marks.running && document.querySelector('.lab-runtime-message')?.textContent.includes('8 seconds')) marks.running = performance.now();
      if (!marks.feedback && document.querySelector('.lab-feedback')) { marks.feedback = performance.now(); observer.disconnect(); }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Check solution', exact: true }).click();
  await page.locator('.lab-feedback').waitFor({ timeout: 90_000 });
  const marks = await page.evaluate(() => window.__forgeMarks);
  const feedback = await page.locator('.lab-feedback').innerText();
  assert(marks.running, `${label}: the run never reported a started interpreter: ${feedback.slice(0, 500)}`);
  const startupMs = Math.round(marks.running - marks.start);
  const totalMs = Math.round(marks.feedback - marks.start);
  assert.match(feedback, /checks passed/, `${label}: ${feedback.slice(0, 500)}`);
  await page.waitForFunction(() => document.querySelectorAll('iframe[title="Isolated Python execution"]').length === 0, null, { timeout: 5000 });
  await new Promise(done => setTimeout(done, 300));
  const entry = { label, startupMs, totalMs, ...runtimeRequests(since) };
  report.runs.push(entry);
  console.log(`${browserName} ${label}: ${entry.requests} runtime requests (${entry.downloads} downloads, ${entry.revalidations} revalidations, ${entry.fromOpaqueOrigin} from the sandbox), ${entry.bytes} bytes, startup ${startupMs} ms, total ${totalMs} ms`);
}

try {
  // Playwright contexts are ephemeral, like a private window; see docs/python-runtime.md for what that means here.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(origin + '/#practice', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(editorName).waitFor({ timeout: 60_000 });
  await measuredRun(page, 'cold run 1');
  await measuredRun(page, 'repeat run 2');
  await measuredRun(page, 'repeat run 3');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel(editorName).waitFor({ timeout: 60_000 });
  await measuredRun(page, 'after reload run 4');
  await page.goto('about:blank');
  await page.goto(origin + '/#practice', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(editorName).waitFor({ timeout: 60_000 });
  await measuredRun(page, 'after navigating back run 5');
  await context.close();
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const freshPage = await fresh.newPage();
  await freshPage.goto(origin + '/#practice', { waitUntil: 'domcontentloaded' });
  await freshPage.getByLabel(editorName).waitFor({ timeout: 60_000 });
  await measuredRun(freshPage, 'new browser context run 6');
  await fresh.close();
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack || error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await browser.close();
  server.close();
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Delivery report: ${reportPath}`);
}
