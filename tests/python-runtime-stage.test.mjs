import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assetLimit, manifest, stagePythonRuntime, verifyRuntimeAsset } from '../scripts/stage-python-runtime.mjs';

test('pinned npm runtime stages unchanged with provenance and license notices', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'forge-pyodide-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const outputDirectory = join(temp, 'runtime');
  const result = await stagePythonRuntime({ outputDirectory });
  assert.equal(result.version, '314.0.1');
  assert.equal(result.files, 5);
  assert.equal(result.bytes, 13_545_926);
  assert.deepEqual((await readdir(outputDirectory)).sort(), [...manifest.files.map(f => f.name), 'manifest.json', 'licenses'].sort());
  for (const file of manifest.files) {
    assert.ok(file.bytes < assetLimit);
    await verifyRuntimeAsset(join(outputDirectory, file.name), file);
  }
  assert.deepEqual(JSON.parse(await readFile(join(outputDirectory, 'manifest.json'), 'utf8')), manifest);
  assert.match(await readFile(join(outputDirectory, 'licenses/NOTICE.txt'), 'utf8'), /Mozilla Public License 2\.0/);
  assert.match(await readFile(join(outputDirectory, 'licenses/PYTHON-LICENSE.txt'), 'utf8'), /PYTHON SOFTWARE FOUNDATION LICENSE/);
  assert.match(await readFile(join(outputDirectory, 'licenses/EMSCRIPTEN-LICENSE.txt'), 'utf8'), /University of Illinois/);
  const notices = JSON.parse(await readFile(join(outputDirectory, 'licenses/sources.json'), 'utf8'));
  for (const notice of notices) {
    const bytes = await readFile(join(outputDirectory, 'licenses', notice.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), notice.sha256, notice.file);
  }
});

test('a same-length modified asset and a truncated asset fail verification', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'forge-runtime-hash-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, 'fixture.mjs');
  const bytes = Buffer.from('original');
  const expected = { name: 'fixture.mjs', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(path, bytes);
  assert.deepEqual(await verifyRuntimeAsset(path, expected), bytes);
  await writeFile(path, 'modified');
  await assert.rejects(verifyRuntimeAsset(path, expected), /SHA-256 mismatch/);
  await writeFile(path, 'short');
  await assert.rejects(verifyRuntimeAsset(path, expected), /Invalid size/);
});

test('another runtime version cannot replace an existing staged output', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'forge-runtime-version-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await writeFile(join(temp, 'package.json'), JSON.stringify({ name: 'pyodide', version: '314.0.2' }));
  const sentinel = join(temp, 'existing-runtime');
  await writeFile(sentinel, 'previous verified runtime');
  await assert.rejects(stagePythonRuntime({ packageDirectory: temp, outputDirectory: sentinel }), /Expected pyodide@314\.0\.1/);
  assert.equal(await readFile(sentinel, 'utf8'), 'previous verified runtime');
});
