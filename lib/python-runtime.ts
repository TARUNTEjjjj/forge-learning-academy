import manifest from "../scripts/python-runtime-manifest.json";

/**
 * Delivers the pinned Pyodide files to the Python sandbox.
 *
 * Requests made inside the opaque-origin sandbox bypass the browser's HTTP cache, so every run used
 * to download the runtime again. The app page is not opaque: it fetches the same versioned files from
 * its own origin (where the immutable Cache-Control applies), checks each file's size and SHA-256
 * against the committed manifest, and then posts a copy of the verified bytes into each new sandbox.
 * The sandbox keeps `sandbox="allow-scripts"` without allow-same-origin and still needs no network.
 * Verified bytes are kept in memory for this page, so later runs make no runtime requests at all.
 */
export const RUNTIME_VERSION = manifest.version;
export const RUNTIME_FILES = manifest.files.map(file => file.name);
export type RuntimeFiles = Record<string, ArrayBuffer>;

export function runtimeBase(href: string) { return new URL(`/runtime/pyodide/${RUNTIME_VERSION}/`, href).href; }

function hex(buffer: ArrayBuffer) { return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join(""); }

/**
 * A download that stops sending bytes for this long is abandoned, so the next run starts a new one. Without it a
 * stalled connection would keep the shared load pending, and every later run on the page would wait for it and time
 * out. A slow download that keeps receiving bytes is not cut off.
 */
export const RUNTIME_IDLE_MS = 20_000;

async function readBody(response: Response, expected: number, name: string, stalled: () => void, idleMs: number): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) return response.arrayBuffer();
  const bytes = new Uint8Array(expected);
  let size = 0, idle: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      clearTimeout(idle); idle = setTimeout(stalled, idleMs);
      const { done, value } = await reader.read();
      if (done) break;
      // Larger than the pinned file: stop reading rather than buffer whatever the server sends.
      if (size + value.byteLength > expected) throw new Error(`${name} did not match the pinned Python ${RUNTIME_VERSION} runtime, so it was not used.`);
      bytes.set(value, size); size += value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { clearTimeout(idle); }
  return size === expected ? bytes.buffer : bytes.slice(0, size).buffer;
}

async function fetchVerified(base: string, idleMs: number): Promise<RuntimeFiles> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This page cannot verify the Python runtime. Open Forge from its https:// address, then try again.");
  // One failed or stalled file fails the load; the others are cancelled instead of downloading for nothing.
  const controller = new AbortController();
  let reason: Error | undefined;
  const abort = (error: Error) => { reason ??= error; controller.abort(error); };
  const entries = await Promise.all(manifest.files.map(async file => {
    const stalled = () => abort(new Error(`${file.name} stopped downloading. Check your connection, then try again.`));
    const idle = setTimeout(stalled, idleMs);
    try {
      // Same-origin and credential-free, using the normal HTTP cache for these immutable, versioned files.
      const response = await fetch(base + file.name, { credentials: "omit", signal: controller.signal });
      clearTimeout(idle);
      if (!response.ok) throw new Error(`${file.name} returned HTTP ${response.status}.`);
      const bytes = await readBody(response, file.bytes, file.name, stalled, idleMs);
      if (bytes.byteLength !== file.bytes || hex(await subtle.digest("SHA-256", bytes)) !== file.sha256) {
        throw new Error(`${file.name} did not match the pinned Python ${RUNTIME_VERSION} runtime, so it was not used.`);
      }
      return [file.name, bytes] as const;
    } catch (error) {
      abort(error instanceof Error ? error : new Error(String(error)));
      throw reason;
    } finally { clearTimeout(idle); }
  }));
  return Object.fromEntries(entries);
}

let loaded: { base: string; files: Promise<RuntimeFiles> } | null = null;

/** Resolves with verified runtime bytes, reusing them for this page; a failed or stalled load is retried next time. */
export function loadPythonRuntime(base: string, idleMs = RUNTIME_IDLE_MS): Promise<RuntimeFiles> {
  if (loaded?.base === base) return loaded.files;
  const current = { base, files: fetchVerified(base, idleMs) };
  loaded = current;
  current.files.catch(() => { if (loaded === current) loaded = null; });
  return current.files;
}
