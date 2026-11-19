import { emptyState, MAX_STATE_BYTES, ProgressError, savedBytes, validateAction, type LearnerState } from "./progress";

/**
 * The "Export my learning record" file, and the rules for restoring one.
 *
 * Format "forge-learning-record", formatVersion 1:
 *   { format, formatVersion: 1, exportedAt, profile, modules, sessions, projects, attempts,
 *     practiceLab: { completed: missionId[], drafts: { [missionId]: code } } }
 * The five state sections are exactly what this browser saves. Unversioned files from earlier releases
 * (exportedAt plus the five sections, with practiceLab from 15 November 2026 on) are read as legacy files.
 *
 * Not in the record: project ZIP downloads (each saved project's files are in "projects", but a ZIP cannot be
 * loaded), edits to a project that were never saved to this browser, the optional CI starter, the Git playground,
 * resource-library caches and any learner sign-in.
 */
export const LEARNING_RECORD_FORMAT = "forge-learning-record";
export const LEARNING_RECORD_VERSION = 1;
/** The largest file read at all: a full saved record and twelve maximum Python drafts, pretty-printed. */
export const MAX_RECORD_FILE_BYTES = 5_000_000;
/** The lab keeps drafts of at most this many characters (Practice.tsx shows the starter for longer ones). */
export const MAX_PRACTICE_DRAFT_CHARS = 30_000;
/** An import request carries a complete saved record. */
export const MAX_IMPORT_REQUEST_BYTES = MAX_STATE_BYTES + 10_000;

export type PracticeLabRecord = { completed: string[]; drafts: Record<string, string> };
export type LearningRecord = { formatVersion: 0 | 1; exportedAt: string; state: LearnerState; practiceLab: PracticeLabRecord | null };
export type ImportMode = "merge" | "replace";
export type ImportAction = { action: "importRecord"; revision: number; operationId?: string; mode: ImportMode; state: LearnerState };
type Mission = { id: string; starter: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const STATE_KEYS = ["profile", "modules", "sessions", "projects", "attempts"] as const;

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Reports where a saved or imported record is invalid. It must throw. */
export type ValidationFailure = (where: string, detail: string) => never;

/** Validate a saved or imported record as strictly as new updates; nothing is repaired or silently dropped. */
export function validateLearnerState(value: unknown, fail: ValidationFailure): LearnerState {
  function check<T>(where: string, run: () => T): T {
    try { return run(); } catch (error) { return fail(where, error instanceof ProgressError ? error.message : "It could not be read."); }
  }
  const timestamp = (where: string, stamp: unknown): string => {
    if (typeof stamp !== "string" || !STAMP.test(stamp) || !Number.isFinite(Date.parse(stamp))) fail(where, "Its date is not a valid timestamp.");
    return stamp as string;
  };
  const rows = (name: string, rowsValue: unknown, maximum: number, uuid: boolean): Record<string, unknown>[] => {
    if (!Array.isArray(rowsValue)) return fail(name, "It must be a list.");
    if (rowsValue.length > maximum) fail(name, `It has ${rowsValue.length} entries; Forge keeps at most ${maximum}.`);
    const ids = new Set<string>();
    rowsValue.forEach((row, index) => {
      if (!isRecord(row)) fail(`${name} entry ${index + 1}`, "It must be an object.");
      if (typeof row.id !== "string" || (uuid && !UUID.test(row.id))) fail(`${name} entry ${index + 1}`, "Its ID is missing or malformed.");
      if (ids.has(row.id as string)) fail(`${name} entry ${index + 1}`, `Its ID ${row.id as string} appears more than once.`);
      ids.add(row.id as string);
    });
    return rowsValue;
  };
  if (!isRecord(value)) return fail("record", "It must be an object.");
  for (const key of STATE_KEYS) if (!(key in value)) fail(key, "This section is missing.");
  if (!isRecord(value.profile)) return fail("profile", "It must be an object.");
  if (!isRecord(value.modules)) return fail("modules", "It must be an object.");
  if (Object.keys(value.modules).length > 200) fail("modules", "Forge keeps at most 200 modules.");
  if (savedBytes(value) > MAX_STATE_BYTES) fail("record", `It is larger than the ${MAX_STATE_BYTES.toLocaleString("en-US")} bytes a browser workspace can save.`);
  const profile = check("profile", () => validateAction({ ...value.profile as object, revision: 0, action: "saveProfile" }));
  if (profile.action !== "saveProfile") return fail("profile", "It could not be read.");
  const normalized: LearnerState = { ...emptyState(), profile: { name: profile.name, weeklyHours: profile.weeklyHours, language: profile.language } };
  for (const [moduleId, entry] of Object.entries(value.modules)) {
    const where = `module ${moduleId.slice(0, 80)}`;
    if (!isRecord(entry)) fail(where, "It must be an object.");
    const updatedAt = timestamp(where, (entry as Record<string, unknown>).updatedAt);
    const action = check(where, () => validateAction({ ...entry as object, revision: 0, action: "setModule", moduleId }));
    if (action.action !== "setModule") return fail(where, "It could not be read.");
    normalized.modules[moduleId] = { complete: action.complete, evidence: action.evidence, updatedAt };
  }
  normalized.sessions = rows("sessions", value.sessions, 5000, true).map((entry, index) => {
    const where = `sessions entry ${index + 1}`;
    const createdAt = timestamp(where, entry.createdAt);
    const action = check(where, () => validateAction({ ...entry, revision: 0, action: "logSession" }));
    if (action.action !== "logSession") return fail(where, "It could not be read.");
    return { id: entry.id as string, minutes: action.minutes, note: action.note, createdAt };
  });
  normalized.projects = rows("projects", value.projects, 20, false).map((entry, index) => {
    const where = `projects entry ${index + 1}`;
    const updatedAt = timestamp(where, entry.updatedAt);
    const action = check(where, () => validateAction({ ...entry, revision: 0, action: "saveProject" }));
    if (action.action !== "saveProject") return fail(where, "It could not be read.");
    const { action: ignoredAction, revision: ignoredRevision, operationId: ignoredId, ...project } = action;
    void ignoredAction; void ignoredRevision; void ignoredId;
    return { ...project, updatedAt };
  });
  normalized.attempts = rows("attempts", value.attempts, 500, true).map((entry, index) => {
    const where = `attempts entry ${index + 1}`;
    const createdAt = timestamp(where, entry.createdAt);
    const action = check(where, () => validateAction({ ...entry, revision: 0, action: "recordAttempt" }));
    if (action.action !== "recordAttempt" || entry.source !== "browser-self-report") return fail(where, "It is not a practice result recorded by this browser.");
    return { id: entry.id as string, missionId: action.missionId, passed: action.passed, total: action.total, category: action.category, createdAt, source: "browser-self-report" };
  });
  // Saved text is trimmed and has no other fields; a record that differs was changed after it was saved.
  if (canonical(normalized) !== canonical(value)) fail("record", "It has extra fields, untrimmed text or other changes Forge does not save.");
  return normalized;
}

function importFailure(where: string, detail: string): never {
  throw new ProgressError(`This file cannot be restored: ${where} is not valid. ${detail} Nothing was changed.`, 422, "invalid_learning_record");
}

function practiceLab(value: unknown, missions: readonly Mission[]): PracticeLabRecord {
  if (!isRecord(value) || Object.keys(value).some(key => key !== "completed" && key !== "drafts")) return importFailure("practiceLab", "It must hold only completed missions and drafts.");
  const known = new Map(missions.map(mission => [mission.id, mission]));
  if (!Array.isArray(value.completed) || value.completed.length > missions.length) importFailure("practiceLab completed", "It must list Python lab missions.");
  const completed = value.completed as unknown[];
  if (completed.some(id => typeof id !== "string" || !known.has(id)) || new Set(completed).size !== completed.length) importFailure("practiceLab completed", "It lists an unknown or repeated mission.");
  if (!isRecord(value.drafts)) return importFailure("practiceLab drafts", "It must map mission IDs to code.");
  const drafts: Record<string, string> = {};
  for (const [id, code] of Object.entries(value.drafts)) {
    if (!known.has(id)) importFailure(`practiceLab draft ${id.slice(0, 80)}`, "It is not a Python lab mission in this version of Forge.");
    if (typeof code !== "string" || code.length > MAX_PRACTICE_DRAFT_CHARS) importFailure(`practiceLab draft ${id}`, `It must be code of at most ${MAX_PRACTICE_DRAFT_CHARS.toLocaleString("en-US")} characters.`);
    if (code !== known.get(id)!.starter) drafts[id] = code as string;
  }
  return { completed: completed as string[], drafts };
}

/**
 * Read an exported file. Only the bytes are trusted: size, UTF-8, JSON, format, version, sections, IDs and limits
 * are all checked here, before anything is written.
 */
export function parseLearningRecord(bytes: Uint8Array, missions: readonly Mission[]): LearningRecord {
  if (bytes.byteLength > MAX_RECORD_FILE_BYTES) throw new ProgressError(`This file is larger than ${MAX_RECORD_FILE_BYTES / 1_000_000} MB, so it is not a Forge learning record. Nothing was changed.`, 413, "learning_record_too_large");
  let data: unknown;
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ProgressError("This file is not a readable learning record (it is not complete JSON text). It may be damaged or cut short. Nothing was changed.", 422, "invalid_learning_record"); }
  if (!isRecord(data)) return importFailure("record", "It must be a JSON object.");
  let formatVersion: 0 | 1;
  if ("format" in data || "formatVersion" in data) {
    if (data.format !== LEARNING_RECORD_FORMAT) return importFailure("format", "This is not a Forge learning record.");
    if (typeof data.formatVersion === "number" && Number.isSafeInteger(data.formatVersion) && data.formatVersion > LEARNING_RECORD_VERSION) throw new ProgressError("This learning record was made by a newer version of Forge. Reload Forge to update it, then try again. Nothing was changed.", 422, "learning_record_too_new");
    if (data.formatVersion !== LEARNING_RECORD_VERSION) return importFailure("formatVersion", "This version is not supported.");
    formatVersion = 1;
  } else formatVersion = 0;
  const allowed = new Set<string>(["exportedAt", ...STATE_KEYS, "practiceLab", ...(formatVersion ? ["format", "formatVersion"] : [])]);
  const extra = Object.keys(data).find(key => !allowed.has(key));
  if (extra) importFailure(`"${extra.slice(0, 40)}"`, "This field is not part of a learning record.");
  if (typeof data.exportedAt !== "string" || !STAMP.test(data.exportedAt) || !Number.isFinite(Date.parse(data.exportedAt))) importFailure("exportedAt", "The export date is missing or malformed.");
  if (formatVersion === 1 && !("practiceLab" in data)) importFailure("practiceLab", "This section is missing.");
  const state = validateLearnerState(Object.fromEntries(STATE_KEYS.filter(key => key in data).map(key => [key, data[key]])), importFailure);
  return { formatVersion, exportedAt: data.exportedAt as string, state, practiceLab: "practiceLab" in data ? practiceLab(data.practiceLab, missions) : null };
}

/** The file "Export my learning record" downloads. */
export function learningRecordExport(state: LearnerState, lab: PracticeLabRecord, now = new Date()) {
  return JSON.stringify({ format: LEARNING_RECORD_FORMAT, formatVersion: LEARNING_RECORD_VERSION, exportedAt: now.toISOString(), ...state, practiceLab: lab }, null, 2);
}

/** Validates an importRecord request body. The record is held to the same rules as saved browser data. */
export function validateImportAction(value: unknown): ImportAction {
  if (!isRecord(value)) throw new ProgressError("Please send a JSON object.");
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision > Number.MAX_SAFE_INTEGER - 1) throw new ProgressError("Revision must be a whole number.");
  if (value.operationId !== undefined && (typeof value.operationId !== "string" || !UUID.test(value.operationId))) throw new ProgressError("Operation ID must be a UUID.");
  if (value.mode !== "merge" && value.mode !== "replace") throw new ProgressError("Choose merge or replace.");
  if (Object.keys(value).some(key => !["action", "revision", "operationId", "mode", "state"].includes(key))) throw new ProgressError("This restore request has unexpected fields.");
  const state = validateLearnerState(value.state, importFailure);
  return { action: "importRecord", revision: value.revision, ...(value.operationId !== undefined ? { operationId: (value.operationId as string).toLowerCase() } : {}), mode: value.mode, state };
}

function isDefaultProfile(profile: LearnerState["profile"]) {
  return canonical(profile) === canonical(emptyState().profile);
}
const newer = (current: string, incoming: string) => Date.parse(incoming) > Date.parse(current);
const byCreated = <T extends { createdAt: string }>(rowsValue: T[]) => rowsValue.map((row, index) => ({ row, index })).sort((a, b) => Date.parse(a.row.createdAt) - Date.parse(b.row.createdAt) || a.index - b.index).map(item => item.row);

export type ImportSummary = {
  mode: ImportMode;
  profile: "kept" | "from-file";
  modules: { added: number; updated: number; removed: number };
  sessions: { added: number; removed: number };
  projects: { added: number; updated: number; removed: number; keptNewer: number };
  attempts: { added: number; removed: number; trimmed: number };
  result: { modules: number; sessions: number; projects: number; attempts: number; bytes: number };
};

/**
 * The record a restore saves. Replace saves the file's record as it is. Merge keeps everything already here and adds
 * what the file has: a module or project in both keeps the more recently updated copy (this browser's on a tie),
 * sessions and practice results are joined by ID, and the profile comes from the file only while this browser's is
 * untouched. Throws, before any write, when the result would exceed a limit rather than dropping work.
 */
export function restoredState(current: LearnerState, imported: LearnerState, mode: ImportMode): { state: LearnerState; summary: ImportSummary } {
  const currentModules = Object.keys(current.modules), importedModules = Object.keys(imported.modules);
  const currentProjects = new Map(current.projects.map(project => [project.id, project]));
  const importedProjects = new Map(imported.projects.map(project => [project.id, project]));
  const currentSessions = new Set(current.sessions.map(session => session.id)), importedSessions = new Set(imported.sessions.map(session => session.id));
  const currentAttempts = new Set(current.attempts.map(attempt => attempt.id)), importedAttempts = new Set(imported.attempts.map(attempt => attempt.id));
  let state: LearnerState, summary: Omit<ImportSummary, "result">;
  if (mode === "replace") {
    state = structuredClone(imported);
    const changedProjects = imported.projects.filter(project => currentProjects.has(project.id) && canonical(project) !== canonical(currentProjects.get(project.id))).length;
    summary = {
      mode, profile: "from-file",
      modules: { added: importedModules.filter(id => !(id in current.modules)).length, updated: importedModules.filter(id => id in current.modules && canonical(current.modules[id]) !== canonical(imported.modules[id])).length, removed: currentModules.filter(id => !(id in imported.modules)).length },
      sessions: { added: imported.sessions.filter(session => !currentSessions.has(session.id)).length, removed: current.sessions.filter(session => !importedSessions.has(session.id)).length },
      projects: { added: imported.projects.filter(project => !currentProjects.has(project.id)).length, updated: changedProjects, removed: current.projects.filter(project => !importedProjects.has(project.id)).length, keptNewer: 0 },
      attempts: { added: imported.attempts.filter(attempt => !currentAttempts.has(attempt.id)).length, removed: current.attempts.filter(attempt => !importedAttempts.has(attempt.id)).length, trimmed: 0 },
    };
  } else {
    state = structuredClone(current);
    const profile = isDefaultProfile(current.profile) && !isDefaultProfile(imported.profile) ? "from-file" : "kept";
    if (profile === "from-file") state.profile = { ...imported.profile };
    let moduleAdded = 0, moduleUpdated = 0;
    for (const id of importedModules) {
      const mine = current.modules[id], theirs = imported.modules[id];
      if (!mine) { state.modules[id] = { ...theirs }; moduleAdded++; }
      else if (newer(mine.updatedAt, theirs.updatedAt) && canonical(mine) !== canonical(theirs)) { state.modules[id] = { ...theirs }; moduleUpdated++; }
    }
    if (Object.keys(state.modules).length > 200) throw new ProgressError(`Merging would keep ${Object.keys(state.modules).length} modules; Forge keeps at most 200. Choose replace instead, or nothing will be changed.`, 413, "learning_record_too_large");
    const newSessions = imported.sessions.filter(session => !currentSessions.has(session.id));
    state.sessions = byCreated([...current.sessions, ...newSessions].map(session => ({ ...session })));
    if (state.sessions.length > 5000) throw new ProgressError(`Merging would keep ${state.sessions.length} practice sessions; Forge keeps at most 5000. Choose replace instead, or nothing will be changed.`, 413, "learning_record_too_large");
    let projectAdded = 0, projectUpdated = 0, keptNewer = 0;
    for (const project of imported.projects) {
      const index = state.projects.findIndex(item => item.id === project.id);
      if (index < 0) { state.projects.push(structuredClone(project)); projectAdded++; }
      else if (canonical(state.projects[index]) !== canonical(project)) {
        if (newer(state.projects[index].updatedAt, project.updatedAt)) { state.projects[index] = structuredClone(project); projectUpdated++; } else keptNewer++;
      }
    }
    if (state.projects.length > 20) throw new ProgressError(`Merging would keep ${state.projects.length} projects; Forge keeps at most 20. Choose replace instead, or nothing will be changed.`, 413, "learning_record_too_large");
    // applyAction keeps the latest 500 practice results; a merge follows the same rule and the preview reports it.
    const joined = byCreated([...current.attempts, ...imported.attempts.filter(attempt => !currentAttempts.has(attempt.id))].map(attempt => ({ ...attempt })));
    state.attempts = joined.slice(-500);
    summary = {
      mode, profile,
      modules: { added: moduleAdded, updated: moduleUpdated, removed: 0 },
      sessions: { added: newSessions.length, removed: 0 },
      projects: { added: projectAdded, updated: projectUpdated, removed: 0, keptNewer },
      attempts: { added: joined.length - current.attempts.length, removed: 0, trimmed: joined.length - state.attempts.length },
    };
  }
  const bytes = savedBytes(state);
  if (bytes > MAX_STATE_BYTES) throw new ProgressError(`The restored record would need ${bytes.toLocaleString("en-US")} bytes; a browser workspace saves at most ${MAX_STATE_BYTES.toLocaleString("en-US")}. Choose replace, or remove large projects first. Nothing was changed.`, 413, "learning_record_too_large");
  return { state, summary: { ...summary, result: { modules: Object.keys(state.modules).length, sessions: state.sessions.length, projects: state.projects.length, attempts: state.attempts.length, bytes } } };
}

export type PracticeRestorePlan = { completed: string[]; write: Record<string, string>; remove: string[]; keptCurrent: string[] };
/**
 * Python lab changes for a restore, from the drafts in this browser now. Merge writes a file's draft only where this
 * browser has no draft for that mission, keeps this browser's draft where both differ, and joins completed missions.
 * Replace makes the lab match the file: missions without a draft in the file return to their starter code.
 * A legacy file without a practiceLab section leaves the lab unchanged in both modes.
 */
export function practiceRestorePlan(current: PracticeLabRecord, file: PracticeLabRecord | null, mode: ImportMode): PracticeRestorePlan {
  if (!file) return { completed: current.completed, write: {}, remove: [], keptCurrent: [] };
  const write: Record<string, string> = {}, keptCurrent: string[] = [];
  for (const [id, code] of Object.entries(file.drafts)) {
    if (current.drafts[id] === code) continue;
    if (mode === "merge" && id in current.drafts) keptCurrent.push(id); else write[id] = code;
  }
  const remove = mode === "replace" ? Object.keys(current.drafts).filter(id => !(id in file.drafts)) : [];
  const completed = mode === "replace" ? [...file.completed] : [...new Set([...current.completed, ...file.completed])];
  return { completed, write, remove, keptCurrent };
}
