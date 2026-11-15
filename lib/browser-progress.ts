import { applyAction, emptyState, MAX_REQUEST_BYTES, MAX_STATE_BYTES, ProgressError, progressResponse, validateAction, type LearnerState, type ProgressAction } from "./progress";

/** One workspace per browser origin. This is not an account or an authentication credential. */
export const BROWSER_WORKSPACE_ID = "browser-local";
export const BROWSER_PROGRESS_KEY = "forge.browser-progress.v1";
export const BROWSER_PROGRESS_LOCK = "forge.browser-progress.v1.write";
export const BROWSER_RECEIPT_LIMIT = 256;
const MAX_ENVELOPE_BYTES = MAX_STATE_BYTES + 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
/** Stands in for the payload hash of every receipt before a data deletion, which deleted saves could be guessed from. */
const ERASED_PAYLOAD_HASH = "0".repeat(64);

type Receipt = { operationId: string; payloadHash: string; appliedRevision: number };
type ReceiptId = Pick<Receipt, "operationId" | "appliedRevision">;
/**
 * Per storage, the newest receipt a read has already checked for an earlier release's deletion. Receipts never
 * change once written, except to have their hashes erased, so later reads check only the receipts added since.
 */
const checkedReceipts = new WeakMap<BrowserProgressStorage, ReceiptId>();
type Envelope = { version: 1; revision: number; state: LearnerState; receipts: Receipt[] };
export type BrowserProgressStorage = Pick<Storage, "getItem" | "setItem">;
export type BrowserProgressLocks = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
export type BrowserProgressDependencies = {
  storage: BrowserProgressStorage;
  locks: BrowserProgressLocks;
  crypto?: Pick<Crypto, "randomUUID" | "subtle">;
  now?: () => Date;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: responseHeaders });
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
async function payloadDigest(cryptoApi: Pick<Crypto, "subtle">, payload: unknown) {
  const digest = await cryptoApi.subtle.digest("SHA-256", encoder.encode(canonical(payload)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
/** A deletion keeps receipts as tombstones (operation ID and revision) but erases the payload hashes before its own. */
function eraseThrough(receipts: Receipt[], index: number): Receipt[] {
  return receipts.map((receipt, position) => position <= index ? { ...receipt, payloadHash: ERASED_PAYLOAD_HASH } : receipt);
}
/**
 * Deletions saved before hashes were erased left them in place. Returns the last receipt to erase, the one just
 * before the latest such deletion, or -1. The deletion keeps its own hash: its payload is fixed by its revision, so
 * the hash reveals nothing, and an earlier release answers a retry of that deletion only when the hash matches.
 */
async function unerasedBeforeDeletion(receipts: Receipt[], cryptoApi: Pick<Crypto, "subtle">, checked?: ReceiptId) {
  for (let index = receipts.length - 1; index >= 0; index--) {
    const { operationId, appliedRevision, payloadHash } = receipts[index];
    if (payloadHash === ERASED_PAYLOAD_HASH || (operationId === checked?.operationId && appliedRevision === checked.appliedRevision)) return -1;
    if (payloadHash === await payloadDigest(cryptoApi, { action: "deleteData", revision: appliedRevision - 1, confirm: "DELETE MY DATA" })) {
      return index > 0 && receipts[index - 1].payloadHash !== ERASED_PAYLOAD_HASH ? index - 1 : -1;
    }
  }
  return -1;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function corrupt(): never {
  throw new ProgressError("Saved browser progress is damaged or uses an unsupported format. It has not been overwritten. Keep a copy of your browser data before clearing this site's storage.", 503, "browser_storage_corrupt");
}
function timestamp(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) corrupt();
}
function rows(value: unknown, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > maximum || !value.every(isRecord)) corrupt();
  return value;
}
function uniqueIds(values: Record<string, unknown>[], uuid = true) {
  const ids = new Set();
  for (const value of values) {
    if (typeof value.id !== "string" || (uuid && !UUID.test(value.id)) || ids.has(value.id)) corrupt();
    ids.add(value.id);
  }
}

/** Validate persisted data as strictly as new updates; malformed data is never silently replaced. */
function validateState(value: unknown): LearnerState {
  if (!isRecord(value) || !isRecord(value.profile) || !isRecord(value.modules) || Object.keys(value.modules).length > 200) corrupt();
  if (encoder.encode(JSON.stringify(value)).byteLength > MAX_STATE_BYTES) corrupt();
  const profile = validateAction({ ...value.profile, revision: 0, action: "saveProfile" });
  if (profile.action !== "saveProfile") corrupt();
  const normalized: LearnerState = { ...emptyState(), profile: { name: profile.name, weeklyHours: profile.weeklyHours, language: profile.language } };
  for (const [moduleId, entry] of Object.entries(value.modules)) {
    if (!isRecord(entry)) corrupt();
    timestamp(entry.updatedAt);
    const action = validateAction({ ...entry, revision: 0, action: "setModule", moduleId });
    if (action.action !== "setModule") corrupt();
    normalized.modules[moduleId] = { complete: action.complete, evidence: action.evidence, updatedAt: entry.updatedAt };
  }
  const sessions = rows(value.sessions, 5000); uniqueIds(sessions);
  normalized.sessions = sessions.map(entry => {
    timestamp(entry.createdAt);
    const action = validateAction({ ...entry, revision: 0, action: "logSession" });
    if (action.action !== "logSession") corrupt();
    return { id: entry.id as string, minutes: action.minutes, note: action.note, createdAt: entry.createdAt };
  });
  const projects = rows(value.projects, 20); uniqueIds(projects, false);
  normalized.projects = projects.map(entry => {
    timestamp(entry.updatedAt);
    const action = validateAction({ ...entry, revision: 0, action: "saveProject" });
    if (action.action !== "saveProject") corrupt();
    const { action: ignoredAction, revision: ignoredRevision, operationId: ignoredId, ...project } = action;
    void ignoredAction; void ignoredRevision; void ignoredId;
    return { ...project, updatedAt: entry.updatedAt };
  });
  const attempts = rows(value.attempts, 500); uniqueIds(attempts);
  normalized.attempts = attempts.map(entry => {
    timestamp(entry.createdAt);
    const action = validateAction({ ...entry, revision: 0, action: "recordAttempt" });
    if (action.action !== "recordAttempt" || entry.source !== "browser-self-report") corrupt();
    return { id: entry.id as string, missionId: action.missionId, passed: action.passed, total: action.total, category: action.category, createdAt: entry.createdAt, source: "browser-self-report" };
  });
  if (canonical(normalized) !== canonical(value)) corrupt();
  return normalized;
}

function readEnvelope(storage: BrowserProgressStorage): Envelope | null {
  const raw = storage.getItem(BROWSER_PROGRESS_KEY);
  if (raw === null) return null;
  if (encoder.encode(raw).byteLength > MAX_ENVELOPE_BYTES) corrupt();
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.version !== 1 || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0 || !Array.isArray(data.receipts) || data.receipts.length > BROWSER_RECEIPT_LIMIT) corrupt();
    const state = validateState(data.state);
    const seen = new Set(); let previous = 0;
    for (const receipt of data.receipts) {
      if (!isRecord(receipt) || typeof receipt.operationId !== "string" || !UUID.test(receipt.operationId) || seen.has(receipt.operationId) || typeof receipt.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(receipt.payloadHash) || !Number.isSafeInteger(receipt.appliedRevision) || (receipt.appliedRevision as number) <= previous || (receipt.appliedRevision as number) > (data.revision as number) || Object.keys(receipt).length !== 3) corrupt();
      seen.add(receipt.operationId); previous = receipt.appliedRevision as number;
    }
    if (Object.keys(data).length !== 4 || (data.revision === 0 && (data.receipts.length || canonical(state) !== canonical(emptyState())))) corrupt();
    return { version: 1, revision: data.revision as number, state, receipts: data.receipts as Receipt[] };
  } catch { return corrupt(); }
}

function writeEnvelope(storage: BrowserProgressStorage, envelope: Envelope) {
  const raw = JSON.stringify(envelope);
  if (encoder.encode(raw).byteLength > MAX_ENVELOPE_BYTES) throw new ProgressError("This browser workspace is full. Export your learning record and reduce large project files.", 507, "browser_storage_full");
  try { storage.setItem(BROWSER_PROGRESS_KEY, raw); }
  catch (error) {
    if (error && typeof error === "object" && "name" in error && ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(String(error.name))) throw new ProgressError("Your browser storage is full. This change was not saved. Download your projects and learning record, then free space before retrying.", 507, "browser_storage_full");
    throw error;
  }
  // A failed confirmation is an uncertain save: its receipt makes an identical retry safe.
  if (storage.getItem(BROWSER_PROGRESS_KEY) !== raw) throw new ProgressError("The browser did not confirm the save. Keep this page open and retry the same change.", 503, "browser_storage_unavailable");
}
function errorResponse(error: unknown) {
  if (error instanceof ProgressError) return json({ error: error.message, code: error.code || "invalid_update" }, error.status);
  return json({ error: "Browser storage is unavailable. This change could not be confirmed. Keep this page open, allow site storage, and retry the same change. Private browsing or browser settings may prevent saves.", code: "browser_storage_unavailable" }, 503);
}

/** A single locked storage write commits state, revision, and retry receipts together across tabs. */
export function createBrowserProgressRequest(dependencies: BrowserProgressDependencies) {
  return async function request(method: "GET" | "POST", payload?: unknown): Promise<Response> {
    try {
      if (method !== "GET" && method !== "POST") return json({ error: "Use GET or POST.", code: "method_not_allowed" }, 405);
      if (!dependencies.locks || typeof dependencies.locks.request !== "function") throw new ProgressError("This browser cannot coordinate safe saves across tabs. Use a current browser over HTTPS to save progress.", 503, "browser_locks_unavailable");
      const cryptoApi = dependencies.crypto ?? globalThis.crypto;
      let action: ProgressAction | undefined;
      let operationId = "";
      let payloadHash = "";
      if (method === "POST") {
        let serialized: string | undefined;
        try { serialized = JSON.stringify(payload); } catch { throw new ProgressError("The update is not valid JSON."); }
        if (serialized === undefined) throw new ProgressError("An update body is required.");
        if (encoder.encode(serialized).byteLength > MAX_REQUEST_BYTES) throw new ProgressError(`This update is too large. Keep the complete update under ${MAX_REQUEST_BYTES.toLocaleString("en-US")} bytes.`, 413);
        action = validateAction(JSON.parse(serialized));
        operationId = action.operationId ?? cryptoApi.randomUUID();
        const { operationId: ignoredId, ...normalizedPayload } = action; void ignoredId;
        payloadHash = await payloadDigest(cryptoApi, normalizedPayload);
      }
      return await dependencies.locks.request(BROWSER_PROGRESS_LOCK, async () => {
        const existing = readEnvelope(dependencies.storage);
        const current: Envelope = existing ?? { version: 1, revision: 0, state: emptyState(), receipts: [] };
        if (method === "GET") {
          // First use verifies writes are possible rather than displaying a fictitious saved workspace.
          if (!existing) writeEnvelope(dependencies.storage, current);
          else {
            // A deletion saved by an earlier release kept the payload hashes before it: erase them now. The read
            // still succeeds when storage cannot take this write, and the next read tries again.
            try {
              const through = await unerasedBeforeDeletion(current.receipts, cryptoApi, checkedReceipts.get(dependencies.storage));
              if (through >= 0) writeEnvelope(dependencies.storage, { ...current, receipts: eraseThrough(current.receipts, through) });
              const newest = current.receipts.at(-1);
              if (newest) checkedReceipts.set(dependencies.storage, { operationId: newest.operationId, appliedRevision: newest.appliedRevision });
            } catch { /* Retried on the next read. */ }
          }
          return json(progressResponse(current.state, current.revision));
        }
        if (!action) throw new ProgressError("An update body is required.");
        const receipt = current.receipts.find(item => item.operationId === operationId);
        if (receipt) {
          // An erased receipt has no payload hash left, but a retry of its save still carries the revision it was applied at.
          const sameUpdate = receipt.payloadHash === ERASED_PAYLOAD_HASH ? action.revision === receipt.appliedRevision - 1 : receipt.payloadHash === payloadHash;
          if (!sameUpdate) return json({ error: "This operation ID already belongs to a different update. Refresh your progress before trying again.", code: "operation_conflict", ...progressResponse(current.state, current.revision) }, 409);
          return json({ ...progressResponse(current.state, current.revision), operationId, replayed: true, appliedRevision: receipt.appliedRevision });
        }
        if (action.revision !== current.revision) return json({ error: "Your progress changed in another tab. Refresh and retry your change.", code: "revision_conflict", ...progressResponse(current.state, current.revision) }, 409);
        const revision = current.revision + 1;
        const state = applyAction(current.state, action, (dependencies.now?.() ?? new Date()).toISOString(), cryptoApi.randomUUID());
        // Reset preserves revision/receipt tombstones; delayed pre-reset saves cannot resurrect erased work.
        // It erases their payload hashes: anyone who can read this storage could recover deleted saves by hashing guesses.
        // Its own receipt keeps its hash, which only restates its revision, so every release can answer a retry of it.
        const appended = [...current.receipts, { operationId, payloadHash, appliedRevision: revision }];
        const receipts = (action.action === "deleteData" ? eraseThrough(appended, appended.length - 2) : appended).slice(-BROWSER_RECEIPT_LIMIT);
        writeEnvelope(dependencies.storage, { version: 1, revision, state, receipts });
        return json({ ...progressResponse(state, revision), operationId, replayed: false, appliedRevision: revision });
      });
    } catch (error) { return errorResponse(error); }
  };
}

/** Lazy access keeps importing this module safe in build/test environments without a window. */
export async function browserProgressRequest(method: "GET" | "POST", payload?: unknown): Promise<Response> {
  try {
    return await createBrowserProgressRequest({ storage: window.localStorage, locks: navigator.locks })(method, payload);
  } catch (error) { return errorResponse(error); }
}
