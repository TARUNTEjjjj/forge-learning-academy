/** Shared wire types and pure validation. Coaching is selected on the server. */
export type Language = "python" | "cpp";
export type ProjectStatus = "draft" | "building" | "published";
export type AttemptCategory = "syntax" | "logic" | "edge-cases" | "performance" | "success";
export type ProjectFile = { path: string; content: string };
export type ProjectTemplateId = "study-tracker" | "graph-toolkit" | "test-bench";
export type LearnerState = {
  profile: { name: string; weeklyHours: number; language: Language };
  modules: Record<string, { complete: boolean; evidence: string; updatedAt: string }>;
  sessions: { id: string; minutes: number; note: string; createdAt: string }[];
  projects: { files?: ProjectFile[]; templateId?: ProjectTemplateId; id: string; title: string; description: string; code: string; repoUrl: string; status: ProjectStatus; updatedAt: string }[];
  attempts: { id: string; missionId: string; passed: number; total: number; category: AttemptCategory; createdAt: string; source: "browser-self-report" }[];
};
export type Recommendation = { title: string; body: string; missionId: string | null; focus: "start" | "practice" | "deepen" | "advance"; source: "practice-history" };
export type ProgressResponse = { state: LearnerState; revision: number; recommendation: Recommendation; operationId?: string; replayed?: boolean; appliedRevision?: number };
type ActionBase = { revision: number; operationId?: string };
export type ProgressAction = ActionBase & (
  | { action: "setModule"; moduleId: string; complete: boolean; evidence: string }
  | { action: "logSession"; minutes: number; note: string }
  | { action: "saveProfile"; name: string; weeklyHours: number; language: Language }
  | { action: "saveProject"; files?: ProjectFile[]; templateId?: ProjectTemplateId; id: string; title: string; description: string; code: string; repoUrl: string; status: ProjectStatus }
  | { action: "recordAttempt"; missionId: string; passed: number; total: number; category: AttemptCategory }
  | { action: "deleteData"; confirm: "DELETE MY DATA" }
);
// Worst-case JSON-escaped saveProject body: 6 × (160,000 file bytes + 40,000 for main.py sent again as code) + 50,000 escaped metadata headroom.
export const MAX_REQUEST_BYTES = 1_250_000;
export const MAX_STATE_BYTES = 1_500_000;

export class ProgressError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) { super(message); this.name = "ProgressError"; this.status = status; this.code = code; }
}
export function emptyState(): LearnerState {
  return { profile: { name: "", weeklyHours: 20, language: "python" }, modules: {}, sessions: [], projects: [], attempts: [] };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProgressError("Please send a JSON object.");
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max) throw new ProgressError(`${name} must be text with at most ${max} characters.`);
  const clean = value.trim();
  if (required && !clean) throw new ProgressError(`${name} is required.`);
  return clean;
}
function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new ProgressError(`${name} must be a whole number between ${min} and ${max}.`);
  return value;
}
function identifier(value: unknown, name: string): string {
  const result = string(value, name, 80, true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result) || ["__proto__", "constructor", "prototype"].includes(result)) throw new ProgressError(`${name} contains invalid characters.`);
  return result;
}
function oneOf<T extends string>(value: unknown, name: string, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new ProgressError(`${name} has an unsupported value.`);
  return value as T;
}

/** Repository links are metadata, never fetched or executed by this API. */
export function repositoryUrl(value: unknown): string {
  const raw = string(value ?? "", "Repository URL", 300);
  if (!raw) return "";
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProgressError("Use a GitHub repository URL such as https://github.com/owner/repo."); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || !/^\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+\/?$/.test(url.pathname) || url.search || url.hash) throw new ProgressError("Use a GitHub repository URL such as https://github.com/owner/repo.");
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

/** Explicit manifest bounds apply to UTF-8 bytes, before source ever reaches GitHub. */
export function validateProjectFiles(value: unknown): ProjectFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new ProgressError("A project needs 1–12 files.");
  const seen = new Set<string>();
  let total = 0;
  const files = value.map(entry => {
    const file = object(entry);
    if (typeof file.path !== "string" || !file.path || file.path.length > 160 || !/^[a-zA-Z0-9_.\-/]+$/.test(file.path)) throw new ProgressError("Use a safe relative file path of at most 160 characters.");
    const segments = file.path.split("/");
    if (segments.some(part => !part || part === "." || part === ".." || [".git", ".github"].includes(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part))) throw new ProgressError("This file path is reserved or leaves the project directory.");
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw new ProgressError("File paths must be unique, including capitalization.");
    seen.add(key);
    if (typeof file.content !== "string") throw new ProgressError("File contents must be text.");
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (bytes > 40_000) throw new ProgressError("Each file must fit within 40,000 UTF-8 bytes.");
    total += bytes;
    return { path: file.path, content: file.content };
  });
  if (total > 160_000) throw new ProgressError("Project files must fit within 160,000 UTF-8 bytes in total.");
  if (!files.some(file => file.path === "main.py")) throw new ProgressError("Keep a main.py entry point in this Python project.");
  return files;
}

export function validateAction(value: unknown): ProgressAction {
  const p = object(value);
  const revision = integer(p.revision, "Revision", 0, Number.MAX_SAFE_INTEGER - 1);
  if (p.operationId !== undefined && (typeof p.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.operationId))) throw new ProgressError("Operation ID must be a UUID.");
  const base = { revision, ...(p.operationId !== undefined ? { operationId: (p.operationId as string).toLowerCase() } : {}) };
  switch (p.action) {
    case "setModule": {
      if (typeof p.complete !== "boolean") throw new ProgressError("Completion must be true or false.");
      return { action: p.action, ...base, moduleId: identifier(p.moduleId, "Module"), complete: p.complete, evidence: string(p.evidence ?? "", "Evidence", 1000) };
    }
    case "logSession": return { action: p.action, ...base, minutes: integer(p.minutes, "Session minutes", 1, 240), note: string(p.note ?? "", "Session note", 160) };
    case "saveProfile": return { action: p.action, ...base, name: string(p.name, "Name", 80), weeklyHours: integer(p.weeklyHours, "Weekly hours", 1, 80), language: oneOf(p.language, "Language", ["python", "cpp"] as const) };
    case "saveProject": {
      // Preserve source indentation and newlines exactly.
      if (typeof p.code !== "string" || p.code.length > 40000) throw new ProgressError("Code must be text with at most 40000 characters.");
      const files = p.files === undefined ? undefined : validateProjectFiles(p.files);
      const templateId = p.templateId === undefined ? undefined : oneOf(p.templateId, "Project template", ["study-tracker", "graph-toolkit", "test-bench"] as const);
      if (files && files.find(file => file.path === "main.py")?.content !== p.code) throw new ProgressError("The main.py file and code preview must match.");
      return { action: p.action, ...base, ...(files ? { files } : {}), ...(templateId ? { templateId } : {}), id: identifier(p.id, "Project ID"), title: string(p.title, "Project title", 120, true), description: string(p.description ?? "", "Project description", 2000), code: p.code, repoUrl: repositoryUrl(p.repoUrl), status: oneOf(p.status, "Project status", ["draft", "building", "published"] as const) };
    }
    case "recordAttempt": {
      const total = integer(p.total, "Total tests", 1, 1000);
      const passed = integer(p.passed, "Passed tests", 0, total);
      const category = oneOf(p.category, "Practice category", ["syntax", "logic", "edge-cases", "performance", "success"] as const);
      if ((category === "success") !== (passed === total)) throw new ProgressError("Practice outcome does not match the test counts.");
      return { action: p.action, ...base, missionId: identifier(p.missionId, "Mission"), passed, total, category };
    }
    case "deleteData": {
      if (p.confirm !== "DELETE MY DATA") throw new ProgressError("Confirm deletion with DELETE MY DATA.");
      return { action: p.action, ...base, confirm: p.confirm };
    }
    default: throw new ProgressError("Unknown progress action.");
  }
}

export function validatePostRequest(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ProgressError("This request must come from this website.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ProgressError("Use application/json for progress updates.", 415);
  const size = request.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || Number(size) > MAX_REQUEST_BYTES)) throw new ProgressError(`This update is too large. Keep the complete update under ${MAX_REQUEST_BYTES.toLocaleString("en-US")} bytes.`, 413);
}
export async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ProgressError("An update body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new ProgressError(`This update is too large. Keep the complete update under ${MAX_REQUEST_BYTES.toLocaleString("en-US")} bytes.`, 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ProgressError("The update is not valid JSON."); }
}

export function applyAction(previous: LearnerState, action: ProgressAction, now = new Date().toISOString(), id = crypto.randomUUID()): LearnerState {
  const state: LearnerState = structuredClone(previous);
  switch (action.action) {
    case "setModule":
      if (!(action.moduleId in state.modules) && Object.keys(state.modules).length >= 200) throw new ProgressError("The module limit has been reached.");
      state.modules[action.moduleId] = { complete: action.complete, evidence: action.evidence, updatedAt: now }; break;
    case "logSession":
      if (state.sessions.length >= 5000) throw new ProgressError("You have reached 5000 saved sessions. Export your progress before starting a fresh record.");
      state.sessions.push({ id, minutes: action.minutes, note: action.note, createdAt: now }); break;
    case "saveProfile": state.profile = { name: action.name, weeklyHours: action.weeklyHours, language: action.language }; break;
    case "saveProject": {
      const index = state.projects.findIndex(project => project.id === action.id);
      if (index < 0 && state.projects.length >= 20) throw new ProgressError("You can keep 20 project drafts. Update an existing draft to continue.");
      const project = { ...(action.files ? { files: action.files } : {}), ...(action.templateId ? { templateId: action.templateId } : {}), id: action.id, title: action.title, description: action.description, code: action.code, repoUrl: action.repoUrl, status: action.status, updatedAt: now };
      if (index < 0) state.projects.push(project); else state.projects[index] = project;
      break;
    }
    case "recordAttempt":
      state.attempts.push({ id, missionId: action.missionId, passed: action.passed, total: action.total, category: action.category, createdAt: now, source: "browser-self-report" });
      state.attempts = state.attempts.slice(-500); break;
    case "deleteData": return emptyState();
  }
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_STATE_BYTES) throw new ProgressError("Your saved workspace is full. Export your progress and shorten large project drafts.", 413);
  return state;
}

/** Practice reports support coaching, never certification or hiring claims. */
export function recommend(state: LearnerState): Recommendation {
  const source = "practice-history" as const;
  const recent = state.attempts.slice(-5);
  const latest = recent.at(-1);
  if (!latest) return { title: "Start with one small win", body: "Open the practice lab, run the starter example, and build your first working solution. Your next step will adapt as you practice.", missionId: null, focus: "start", source };
  const wins = recent.filter(attempt => attempt.passed === attempt.total).length;
  if (latest.passed === latest.total) {
    if (wins >= 3) return { title: "Ready to stretch", body: "You have several working solutions. Try the next challenge, explain its time complexity, and add one test that could break a tempting shortcut.", missionId: null, focus: "advance", source };
    return { title: "Make your solution stronger", body: "Your example tests pass. Explain why the method works, try an empty or boundary input, and compare it with a second approach before moving on.", missionId: latest.missionId, focus: "deepen", source };
  }
  const repeated = recent.filter(attempt => attempt.missionId === latest.missionId && attempt.passed < attempt.total).length >= 2;
  if (latest.category === "syntax") return { title: "Build a smaller working version", body: "Start with the example input and a single return value. Run it, then add one step at a time. The starter and first hint are there to help you regain momentum.", missionId: latest.missionId, focus: "practice", source };
  if (latest.category === "performance") return { title: "Look for repeated work", body: "Write down how many times each item is visited. Try storing a result you currently recompute, then rerun the same tests and compare the growth in work.", missionId: latest.missionId, focus: "practice", source };
  return { title: repeated ? "Take a smaller step" : "Explore one counterexample", body: repeated ? "Use the first hint, trace a tiny input by hand, and get that case working before returning to the full problem. A short review is part of progress." : "Pick one failing example and trace the values by hand. Check the smallest input, duplicate values, and the exact output the function should return.", missionId: latest.missionId, focus: "practice", source };
}
export function progressResponse(state: LearnerState, revision: number): ProgressResponse {
  return { state, revision, recommendation: recommend(state) };
}
