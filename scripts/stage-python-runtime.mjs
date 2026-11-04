import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export const manifest = JSON.parse(await readFile(join(root, 'scripts/python-runtime-manifest.json'), 'utf8'));
export const assetLimit = 25 * 1024 * 1024;

export async function verifyRuntimeAsset(path, expected) {
  const info = await stat(path);
  if (!info.isFile() || info.size !== expected.bytes || info.size >= assetLimit) {
    throw new Error(`Invalid size for ${expected.name}: expected ${expected.bytes} bytes below the Pages asset limit`);
  }
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
    throw new Error(`SHA-256 mismatch for ${expected.name}; refusing to stage an unverified runtime`);
  }
  return bytes;
}

export async function stagePythonRuntime({ packageDirectory, outputDirectory } = {}) {
  const source = packageDirectory ?? dirname(require.resolve('pyodide/package.json'));
  const target = outputDirectory ?? join(root, 'public/runtime/pyodide', manifest.version);
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (metadata.name !== manifest.package || metadata.version !== manifest.version) {
    throw new Error(`Expected ${manifest.package}@${manifest.version}; run npm ci with the committed lockfile`);
  }

  // Validate every byte before touching an existing staged runtime. Keep verified
  // buffers so a source file changing between verification and copy cannot pass.
  const assets = await Promise.all(manifest.files.map(async (file) => ({
    file, bytes: await verifyRuntimeAsset(join(source, file.name), file),
  })));
  await mkdir(dirname(target), { recursive: true });
  const temporary = await mkdtemp(join(dirname(target), '.pyodide-stage-'));
  try {
    for (const { file, bytes } of assets) await writeFile(join(temporary, file.name), bytes);
    await cp(join(root, 'licenses', `pyodide-${manifest.version}`), join(temporary, 'licenses'), { recursive: true });
    await writeFile(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(target, { recursive: true, force: true });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { directory: target, version: manifest.version, files: assets.length, bytes: assets.reduce((n, a) => n + a.bytes.length, 0) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await stagePythonRuntime();
    console.log(`Verified and staged Pyodide ${result.version}: ${result.files} runtime files, ${result.bytes} bytes.`);
  } catch (error) {
    console.error(`Pyodide staging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
