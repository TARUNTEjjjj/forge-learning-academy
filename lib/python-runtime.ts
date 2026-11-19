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

async function fetchVerified(base: string): Promise<RuntimeFiles> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This page cannot verify the Python runtime. Open Forge from its https:// address, then try again.");
  const entries = await Promise.all(manifest.files.map(async file => {
    // Same-origin and credential-free, using the normal HTTP cache for these immutable, versioned files.
    const response = await fetch(base + file.name, { credentials: "omit" });
    if (!response.ok) throw new Error(`${file.name} returned HTTP ${response.status}.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== file.bytes || hex(await subtle.digest("SHA-256", bytes)) !== file.sha256) {
      throw new Error(`${file.name} did not match the pinned Python ${RUNTIME_VERSION} runtime, so it was not used.`);
    }
    return [file.name, bytes] as const;
  }));
  return Object.fromEntries(entries);
}

let loaded: { base: string; files: Promise<RuntimeFiles> } | null = null;

/** Resolves with verified runtime bytes, reusing them for this page; a failed load is retried next time. */
export function loadPythonRuntime(base: string): Promise<RuntimeFiles> {
  if (loaded?.base === base) return loaded.files;
  const current = { base, files: fetchVerified(base) };
  loaded = current;
  current.files.catch(() => { if (loaded === current) loaded = null; });
  return current.files;
}
