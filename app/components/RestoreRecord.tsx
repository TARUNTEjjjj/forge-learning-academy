"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";
import { MISSIONS } from "../../lib/missions";
import { MAX_RECORD_FILE_BYTES, parseLearningRecord, practiceRestorePlan, restoredState, type ImportMode, type LearningRecord, type PracticeLabRecord } from "../../lib/learning-record";
import type { LearnerState } from "../../lib/progress";

type Props = {
  state: LearnerState;
  revision: number;
  signed: boolean;
  /** The Python lab as it is now; read on every render so the preview follows edits in other views and tabs. */
  practiceLab: () => PracticeLabRecord;
  /** Resolves with what happened; `message` stays in the panel, since the app's notice fades after a few seconds. */
  onRestore: (record: LearningRecord, mode: ImportMode, previewRevision: number) => Promise<RestoreOutcome>;
  onExportCurrent: () => void;
};

export type RestoreOutcome = { restored: boolean; labSaved: boolean; message: string };

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const date = (stamp: string) => new Date(stamp).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Choose an exported learning record, preview what restoring it changes, then merge or replace. */
export default function RestoreRecord({ state, revision, signed, practiceLab, onRestore, onExportCurrent }: Props) {
  const [record, setRecord] = useState<LearningRecord | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const reading = useRef(0);
  // Keyboard and screen-reader users keep their place: focus moves to the preview when it opens, and back to the
  // file field when the preview closes after a restore or Cancel, instead of being lost with the removed buttons.
  const fileRef = useRef<HTMLInputElement | null>(null), previewRef = useRef<HTMLDivElement | null>(null);
  const [focusTarget, setFocusTarget] = useState<"" | "preview" | "file">("");
  useEffect(() => {
    if (focusTarget === "preview") previewRef.current?.focus();
    else if (focusTarget === "file") fileRef.current?.focus();
    if (focusTarget) setFocusTarget("");
  }, [focusTarget]);
  const lab = practiceLab();
  const preview = useMemo(() => {
    if (!record) return null;
    try { return { ...restoredState(state, record.state, mode), lab: practiceRestorePlan(lab, record.practiceLab, mode), problem: "" }; }
    catch (reason) { return { state: null, summary: null, lab: null, problem: reason instanceof Error ? reason.message : "This record cannot be restored here." }; }
  }, [record, state, mode, JSON.stringify(lab)]);

  async function choose(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    const serial = ++reading.current;
    setRecord(null); setError(""); setOutcome(null); setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > MAX_RECORD_FILE_BYTES) { setError(`This file is larger than ${MAX_RECORD_FILE_BYTES / 1_000_000} MB, so it is not a Forge learning record. Nothing was changed.`); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (serial !== reading.current) return;
      setRecord(parseLearningRecord(bytes, MISSIONS)); setFocusTarget("preview");
    } catch (reason) {
      if (serial === reading.current) setError(reason instanceof Error ? reason.message : "This file could not be read. Nothing was changed.");
    }
  }
  async function restore() {
    if (!record || !preview?.summary) return;
    setBusy(true); setOutcome(null);
    try {
      const result = await onRestore(record, mode, revision);
      setOutcome(result);
      if (result.restored) { setRecord(null); setFileName(""); setFocusTarget("file"); }
    } catch (reason) {
      setOutcome({ restored: false, labSaved: false, message: reason instanceof Error ? reason.message : "This record could not be restored." });
    } finally { setBusy(false); }
  }
  function cancel() { reading.current++; setRecord(null); setFileName(""); setError(""); setOutcome(null); setFocusTarget("file"); }

  const summary = preview?.summary, plan = preview?.lab;
  const removed = summary ? summary.modules.removed + summary.sessions.removed + summary.projects.removed + summary.attempts.removed + (plan?.remove.length ?? 0) : 0;
  const overwritten = summary ? summary.overwritten.modules.length + summary.overwritten.projects.length : 0;
  const lost = removed + overwritten + (summary?.attempts.trimmed ?? 0) + (mode === "replace" ? Object.keys(plan?.write ?? {}).filter(id => id in lab.drafts).length : 0);
  const names = (items: string[]) => items.length > 5 ? `${items.slice(0, 5).join(", ")} and ${items.length - 5} more` : items.join(", ");
  return <section className="panel restore-panel" aria-labelledby="restore-title">
    <style>{RESTORE_CSS}</style>
    <p className="eyebrow">RESTORE A LEARNING RECORD</p>
    <h2 id="restore-title">Bring an exported record back.</h2>
    <p>Choose a <code>forge-progress.json</code> file from <b>Export my learning record</b>. Forge checks the whole file and shows what would change before anything is saved. It restores your profile, module notes, practice sessions and results, saved projects, Python lab drafts and completed missions. Project ZIP files cannot be loaded, and project edits you never saved in this browser are not part of a record.</p>
    <label className="restore-file">Learning record file (.json)
      <input ref={fileRef} type="file" accept=".json,application/json" disabled={busy} onChange={event => void choose(event.currentTarget)}/>
    </label>
    {error && <p className="restore-error" role="alert">{fileName ? <b>{fileName}: </b> : null}{error}</p>}
    {outcome?.restored && outcome.labSaved && <p className="restore-done" role="status">The record was restored. Your progress now includes it.</p>}
    {outcome?.restored && !outcome.labSaved && <p className="restore-error" role="alert">{outcome.message}</p>}
    {outcome && !outcome.restored && <p className="restore-error" role="alert">This record was not restored: {outcome.message} Your current record is unchanged, and retrying the same restore is safe.</p>}
    {record && <div className="restore-preview" role="group" aria-label="Restore preview" tabIndex={-1} ref={previewRef}>
      <p><b>{fileName}</b> · exported {date(record.exportedAt)} · {record.formatVersion ? `learning record format ${record.formatVersion}` : "earlier Forge export (no format version)"}</p>
      <p>The file holds {plural(Object.keys(record.state.modules).length, "module")}, {plural(record.state.sessions.length, "practice session")}, {plural(record.state.projects.length, "project")}, {plural(record.state.attempts.length, "practice result")}{record.practiceLab ? `, ${plural(Object.keys(record.practiceLab.drafts).length, "Python draft")} and ${plural(record.practiceLab.completed.length, "completed mission")}` : ". It predates Python drafts in exports, so the Python lab is left as it is"}.</p>
      <fieldset className="restore-mode" disabled={busy}>
        <legend>How should it be restored?</legend>
        <label><input type="radio" name="restore-mode" value="merge" checked={mode === "merge"} onChange={() => setMode("merge")}/><span><b>Merge</b> — keep everything in this browser and add what the file has. Where both have the same module or project, the more recently updated copy is kept; your current Python drafts are kept.</span></label>
        <label><input type="radio" name="restore-mode" value="replace" checked={mode === "replace"} onChange={() => setMode("replace")}/><span><b>Replace</b> — make this browser's record match the file. Anything here that is not in the file is removed.</span></label>
      </fieldset>
      {preview?.problem && <p className="restore-error" role="alert">{preview.problem}</p>}
      {summary && plan && <ul className="restore-summary" aria-label="What restoring changes">
        <li>Profile: {summary.profile === "kept" ? "your current profile is kept" : "taken from the file"}.</li>
        <li>Modules: {summary.modules.added} added, {summary.modules.updated} updated{summary.modules.removed ? `, ${summary.modules.removed} removed` : ""}.</li>
        <li>Practice sessions: {summary.sessions.added} added{summary.sessions.removed ? `, ${summary.sessions.removed} removed` : ""}.</li>
        <li>Projects: {summary.projects.added} added, {summary.projects.updated} updated{summary.projects.keptNewer ? `, ${summary.projects.keptNewer} kept because this browser's copy is newer` : ""}{summary.projects.removed ? `, ${summary.projects.removed} removed` : ""}.</li>
        <li>Practice results: {summary.attempts.added} added{summary.attempts.removed ? `, ${summary.attempts.removed} removed` : ""}{summary.attempts.trimmed ? `; the oldest ${summary.attempts.trimmed} are dropped, because Forge keeps the latest 500` : ""}.</li>
        <li>Python lab: {Object.keys(plan.write).length} drafts written{plan.keptCurrent.length ? `, ${plan.keptCurrent.length} kept because you already have a different draft` : ""}{plan.remove.length ? `, ${plan.remove.length} returned to starter code` : ""}; {plural(plan.completed.length, "completed mission")} afterwards.</li>
        <li>Afterwards: {plural(summary.result.modules, "module")}, {plural(summary.result.sessions, "session")}, {plural(summary.result.projects, "project")}, {plural(summary.result.attempts, "practice result")}.</li>
      </ul>}
      {summary && lost > 0 && <div className="restore-warning" id="restore-warning">
        <p>{mode === "replace" ? "Replace removes or overwrites work that is only in this browser." : "Merge overwrites some work in this browser."} Download your current record first if you may want it.</p>
        {overwritten > 0 && <p>The file's copy replaces this browser's {[summary.overwritten.modules.length ? `notes for ${plural(summary.overwritten.modules.length, "module")} (${names(summary.overwritten.modules)})` : "", summary.overwritten.projects.length ? `${plural(summary.overwritten.projects.length, "project")} (${names(summary.overwritten.projects)})` : ""].filter(Boolean).join(" and ")}{mode === "merge" ? ", because the file's copy is dated later" : ""}.</p>}
        {mode === "merge" && summary.overwritten.fileAhead && <p>Some of those copies are dated later than this device's clock, so the device that exported the file may have its clock set ahead. Its copy is not necessarily newer.</p>}
      </div>}
      <div className="restore-actions">
        <button className="primary" disabled={busy || !signed || !summary} aria-describedby={summary && lost > 0 ? "restore-warning" : undefined} onClick={() => void restore()}><RotateCcw size={16}/>{mode === "merge" ? "Merge this record" : "Replace with this record"}</button>
        <button className="outline" disabled={busy} onClick={onExportCurrent}><Download size={16}/>Download current record first</button>
        <button className="text-button" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
      {!signed && <p className="fine-print">Browser saving is not ready, so nothing can be restored. Enable site storage and reload.</p>}
    </div>}
    {!record && <p className="fine-print"><Upload size={12}/> Restoring saves only in this browser. It does not sync devices or upload the file.</p>}
  </section>;
}

const RESTORE_CSS = `
.restore-panel{display:grid;gap:14px}
.restore-panel code{font-size:.92em}
.restore-file{display:grid;gap:8px;font-weight:700;color:#F5F3EB;max-width:520px}
.restore-file input{font-weight:400;color:#c1ccdf;min-height:43px}
.restore-preview{border:1px solid #34465f;border-radius:11px;padding:16px;display:grid;gap:12px;background:#192539}
.restore-preview p,.restore-summary{color:#c1ccdf;margin:0;line-height:1.7}
.restore-summary{padding-left:20px}
.restore-mode{border:0;margin:0;padding:0;display:grid;gap:10px}
.restore-mode legend{font-weight:700;color:#F5F3EB;margin-bottom:6px}
.restore-mode label{display:flex;gap:10px;align-items:flex-start;color:#c1ccdf;font-size:13px;font-weight:400;line-height:1.6;cursor:pointer;margin:0}
.restore-mode label span{display:block}
.restore-mode input{flex:none;width:18px;height:18px;min-height:0;margin:3px 0 0;padding:0;accent-color:#e23b54}
.restore-preview:focus{outline:2px solid #e23b54;outline-offset:3px}
.restore-warning p{margin:0;color:inherit!important}
.restore-warning{display:grid;gap:6px}
.restore-error,.restore-warning{background:rgba(255,180,190,.06);border:1px solid rgba(255,180,190,.4);border-radius:8px;padding:12px;color:#FFB4BE!important;line-height:1.6}
.restore-done{border:1px solid #3f6b58;border-radius:8px;padding:12px;color:#c9f0dc!important}
.restore-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.restore-actions .primary,.restore-actions .outline{display:inline-flex;gap:8px;align-items:center}
`;
