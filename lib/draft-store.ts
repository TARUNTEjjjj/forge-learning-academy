import { projectContentEqual, validProjectDocument, type ProjectDocument } from "./project-files";

export type ProjectDraft = {
  version: 1; project: ProjectDocument; revision: string; savedRevision: string | null;
  baseUpdatedAt: string | null; updatedAt: string; epoch: string;
};
const memory = new Map<string, string>();
const eventName = "forge-project-drafts";
const prefix = (userKey: string) => `forge.projects.v2.${encodeURIComponent(userKey)}.`;
const epochKey = (userKey: string) => `${prefix(userKey)}$epoch`;
const draftKey = (userKey: string, id: string) => `${prefix(userKey)}${id}`;
function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): boolean {
  // Keep only failed writes in memory. Successful writes remain visible across tabs.
  try { localStorage.setItem(key, value); memory.delete(key); return true; }
  catch { memory.set(key, value); return false; }
}
function notify(userKey: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(eventName, { detail: userKey }));
}
function keys(userKey: string) {
  const found = new Set([...memory.keys()].filter(key => key.startsWith(prefix(userKey))));
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(prefix(userKey))) found.add(key); } } catch { /* Memory fallback remains usable. */ }
  return [...found].filter(key => key !== epochKey(userKey)).sort();
}
export function projectDraftEpoch(userKey: string) { return read(epochKey(userKey)) || "initial"; }
function validDraft(value: unknown): value is ProjectDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as ProjectDraft;
  return draft.version === 1 && validProjectDocument(draft.project) && typeof draft.revision === "string" && draft.revision.length <= 80 &&
    (draft.savedRevision === null || typeof draft.savedRevision === "string") && (draft.baseUpdatedAt === null || typeof draft.baseUpdatedAt === "string") &&
    typeof draft.updatedAt === "string" && typeof draft.epoch === "string";
}
export function parseProjectDraftSnapshot(raw: string): ProjectDraft[] {
  try { const value: unknown = JSON.parse(raw); return Array.isArray(value) ? value.filter(validDraft).slice(0, 20) : []; } catch { return []; }
}
export function readProjectDraft(userKey: string, id: string): ProjectDraft | undefined {
  try { const value: unknown = JSON.parse(read(draftKey(userKey, id)) || "null"); return validDraft(value) && value.epoch === projectDraftEpoch(userKey) ? value : undefined; } catch { return undefined; }
}
/** A stable string snapshot is suitable for React's external-store subscription. */
export function readProjectDraftSnapshot(userKey: string): string {
  const epoch = projectDraftEpoch(userKey);
  const drafts = keys(userKey).flatMap(key => {
    try { const value: unknown = JSON.parse(read(key) || "null"); return validDraft(value) && value.epoch === epoch ? [value] : []; } catch { return []; }
  }).slice(0, 20);
  return JSON.stringify(drafts);
}
export function subscribeProjectDrafts(userKey: string, callback: () => void) {
  const local = (event: Event) => { if ((event as CustomEvent).detail === userKey) callback(); };
  const external = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix(userKey))) {
      if (event.key === null || event.key === epochKey(userKey)) for (const key of memory.keys()) { if (key.startsWith(prefix(userKey))) memory.delete(key); }
      else if (event.newValue === null) memory.delete(event.key);
      callback();
    }
  };
  window.addEventListener(eventName, local); window.addEventListener("storage", external);
  return () => { window.removeEventListener(eventName, local); window.removeEventListener("storage", external); };
}
export function saveProjectDraft(userKey: string, project: ProjectDocument, baseUpdatedAt: string | null = null, expectedEpoch = projectDraftEpoch(userKey)) {
  if (projectDraftEpoch(userKey) !== expectedEpoch) return { record: undefined, persisted: false, deleted: true };
  if (!validProjectDocument(project)) throw new Error("The project cannot be recovered safely. Check its file sizes and names.");
  const previous = readProjectDraft(userKey, project.id);
  if (!previous && parseProjectDraftSnapshot(readProjectDraftSnapshot(userKey)).length >= 20) throw new Error("You have 20 local projects. Export your work before removing a local project.");
  const record: ProjectDraft = {
    version: 1, project, revision: crypto.randomUUID(), savedRevision: previous?.savedRevision || null,
    baseUpdatedAt: previous && previous.revision !== previous.savedRevision ? previous.baseUpdatedAt : baseUpdatedAt, updatedAt: new Date().toISOString(), epoch: expectedEpoch,
  };
  const persisted = write(draftKey(userKey, project.id), JSON.stringify(record)); notify(userKey);
  return { record, persisted, deleted: false };
}
/** A late response can acknowledge its snapshot without replacing a newer editor draft. */
export function markProjectDraftSaved(userKey: string, id: string, submittedRevision: string, expectedEpoch: string) {
  if (projectDraftEpoch(userKey) !== expectedEpoch) return { applied: false, newerEdits: false, persisted: true };
  const current = readProjectDraft(userKey, id);
  if (!current) return { applied: false, newerEdits: false, persisted: true };
  const record = { ...current, savedRevision: current.savedRevision === current.revision && current.revision !== submittedRevision ? current.savedRevision : submittedRevision };
  const persisted = write(draftKey(userKey, id), JSON.stringify(record)); notify(userKey);
  return { applied: true, newerEdits: current.revision !== submittedRevision, persisted };
}
/** A newer dirty draft wins over remote refreshes, including revision-conflict responses. */
export function resolveProjectDraft(cloud: ProjectDocument | undefined, updatedAt: string | undefined, local: ProjectDraft | undefined) {
  if (!local) return cloud;
  if (!cloud || local.revision !== local.savedRevision || updatedAt === local.baseUpdatedAt || projectContentEqual(local.project, cloud)) return local.project;
  return cloud;
}
export function hasVolatileProjectDrafts(userKey: string) { return [...memory.keys()].some(key => key.startsWith(prefix(userKey)) && key !== epochKey(userKey)); }
export function removeProjectDraft(userKey: string, id: string) {
  const key = draftKey(userKey, id);
  try { localStorage.removeItem(key); } catch { return false; }
  memory.delete(key);
  notify(userKey); return true;
}
/** Call only after the server confirms account-data deletion. Epoch blocks stale save callbacks. */
export function clearProjectDrafts(userKey: string) {
  let persisted = true;
  for (const key of keys(userKey)) { memory.delete(key); try { localStorage.removeItem(key); } catch { persisted = false; } }
  if (!write(epochKey(userKey), crypto.randomUUID())) persisted = false;
  notify(userKey); return persisted;
}
