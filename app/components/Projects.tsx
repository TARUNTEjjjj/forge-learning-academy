"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, Check, Code2, Download, FolderGit2, GitBranch, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { repositoryUrl, type LearnerState } from "../../lib/progress";
import { byteLength, createProject, createProjectZip, FILE_LIMIT, normalizeSavedProject, PROJECT_LIMIT, PROJECT_TEMPLATES, projectContentEqual, renameProjectFile, validateFileHierarchy, validateFilePath, validateFiles, withFiles, WORKFLOW_STARTER, type ProjectDocument, type ProjectFile } from "../../lib/project-files";
import { hasVolatileProjectDrafts, markProjectDraftSaved, parseProjectDraftSnapshot, projectDraftEpoch, readProjectDraft, readProjectDraftSnapshot, removeProjectDraft, resolveProjectDraft, saveProjectDraft, subscribeProjectDrafts } from "../../lib/draft-store";

type SavedProject = LearnerState["projects"][number];
export type ProjectSave = ProjectDocument;
type Props = { projects: SavedProject[]; onSave: (project: ProjectSave) => Promise<boolean>; signed: boolean; userKey: string };

export default function Projects(props: Props) { return <ProjectsWorkspace key={props.userKey} {...props}/>; }

function ProjectsWorkspace({ projects, onSave, signed, userKey }: Props) {
  const subscribe = useCallback((callback: () => void) => subscribeProjectDrafts(userKey, callback), [userKey]);
  const raw = useSyncExternalStore(subscribe, () => readProjectDraftSnapshot(userKey), () => "[]");
  const drafts = parseProjectDraftSnapshot(raw);
  const cloud = new Map(projects.map(project => [project.id, { project: normalizeSavedProject(project), updatedAt: project.updatedAt }]));
  const local = new Map(drafts.map(draft => [draft.project.id, draft]));
  const ids = [...new Set([...cloud.keys(), ...local.keys()])];
  const [selected, setSelected] = useState("");
  const activeId = ids.includes(selected) ? selected : ids[0];
  const saved = cloud.get(activeId);
  const draft = local.get(activeId);
  const project = resolveProjectDraft(saved?.project, saved?.updatedAt, draft);
  const [tab, setTab] = useState("main.py");
  const [newPath, setNewPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<ProjectFile | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [discarded, setDiscarded] = useState<ProjectDocument | null>(null);
  const alive = useRef(true);
  const epoch = projectDraftEpoch(userKey);
  const volatile = hasVolatileProjectDrafts(userKey);
  const activeFile = project?.files.find(file => file.path === tab) || project?.files[0];
  const dirty = !!draft && draft.revision !== draft.savedRevision;
  const template = PROJECT_TEMPLATES.find(item => item.id === project?.templateId);
  const repoProblem = project ? (() => { try { repositoryUrl(project.repoUrl); return ""; } catch (reason) { return reason instanceof Error ? reason.message : "Use a GitHub repository URL."; } })() : "";
  const validation = project ? validateFiles(project.files) || (!project.title.trim() ? "Give your project a title before saving." : "") || repoProblem : "";

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (hasVolatileProjectDrafts(userKey)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [userKey]);

  function edit(next: ProjectDocument) {
    try {
      const result = saveProjectDraft(userKey, next, cloud.get(next.id)?.updatedAt || null, epoch);
      if (result.deleted) { setError("Browser learning data was cleared. Start a new project to continue."); return false; }
      setError(""); setMessage(result.persisted ? "" : "Browser storage is unavailable. Download a ZIP before leaving this page."); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your change could not be stored. Download the current files before leaving."); return false; }
  }
  function start(templateId: string) {
    if (ids.length >= PROJECT_LIMIT) { setError("This workspace has 20 projects. Export and remove a local-only draft to make room."); return; }
    const next = createProject(templateId);
    if (!edit(next)) return; setSelected(next.id); setTab("main.py"); setRemoved(null); setDiscarding(false);
    if (!hasVolatileProjectDrafts(userKey)) setMessage("New project created. Edits are recovered automatically on this device.");
  }
  function select(id: string) { setSelected(id); setTab("main.py"); setRemoved(null); setDiscarding(false); setMessage(""); setError(""); }
  function editFile(content: string) {
    if (!project || !activeFile) return;
    const files = project.files.map(file => file.path === activeFile.path ? { ...file, content } : file);
    const problem = validateFiles(files);
    if (problem) { setError(`${problem} Your previous contents are still here.`); return; }
    edit(withFiles(project, files));
  }
  function addFile() {
    if (!project) return;
    const path = newPath.trim(); const problem = validateFilePath(path);
    if (problem) { setError(problem); return; }
    if (project.files.some(file => file.path.toLowerCase() === path.toLowerCase())) { setError("A file with that name already exists."); return; }
    if (project.files.length >= FILE_LIMIT) { setError("A project supports up to 12 files."); return; }
    const files = [...project.files, { path, content: "" }];
    const hierarchyError = validateFileHierarchy(files);
    if (hierarchyError) { setError(hierarchyError); return; }
    if (edit(withFiles(project, files))) { setTab(path); setNewPath(""); }
  }
  function removeFile() {
    if (!project || !activeFile || activeFile.path === "main.py") return;
    if (edit(withFiles(project, project.files.filter(file => file.path !== activeFile.path)))) { setRemoved(activeFile); setTab("main.py"); }
  }
  function renameFile() {
    if (!project || !activeFile || activeFile.path === "main.py") return;
    const name = window.prompt("Rename this file. Update Python imports and other references yourself after renaming.", activeFile.path);
    if (name === null || name.trim() === activeFile.path) return;
    try {
      const path = name.trim();
      if (edit(renameProjectFile(project, activeFile.path, path))) { setTab(path); setRemoved(null); setMessage("File renamed. Its contents were preserved; update any imports or references to the old path."); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The file could not be renamed."); }
  }
  function restoreFile() {
    if (!project || !removed) return;
    const files = [...project.files, removed]; const problem = validateFiles(files) || validateFileHierarchy(files);
    if (problem) { setError(problem); return; }
    if (edit(withFiles(project, files))) { setTab(removed.path); setRemoved(null); }
  }
  async function save() {
    if (!project || busy || validation || !signed) return;
    const snapshot = { ...project, files: project.files.map(file => ({ ...file })) };
    let record = readProjectDraft(userKey, snapshot.id);
    try {
      if (!record || !projectContentEqual(record.project, snapshot)) record = saveProjectDraft(userKey, snapshot, saved?.updatedAt || null, epoch).record;
      if (!record) return;
      const submitted = record; setBusy(true); setError(""); setMessage("");
      const success = await onSave(snapshot);
      if (success) {
        const result = markProjectDraftSaved(userKey, snapshot.id, submitted.revision, submitted.epoch);
        if (alive.current && result.applied) setMessage(result.newerEdits ? "Earlier version saved in this browser. Your newer edits are still here; save again when ready." : "Project saved in this browser. Your editable files are included.");
      } else if (alive.current) setError("Saving did not complete. Your browser draft is preserved. Review the storage notice and retry.");
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "Saving did not complete. Your browser draft is preserved."); }
    finally { if (alive.current) setBusy(false); }
  }
  function download(files: ProjectFile[], suffix = "") {
    if (!project) return;
    try {
      const bytes = createProjectZip(files); const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "forge-project"}${suffix}.zip`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The project ZIP could not be created."); }
  }
  function discard() {
    if (!project) return;
    const persisted = removeProjectDraft(userKey, project.id);
    if (persisted) setDiscarded(project);
    setDiscarding(false); setRemoved(null);
    setMessage(persisted ? "Local draft removed. You can restore it below while you stay on Build & contribute." : "The browser could not remove this draft. Export it and retry before closing.");
  }
  function undoDiscard() {
    if (!discarded) return;
    if (!edit(discarded)) return; setSelected(discarded.id); setDiscarded(null); setMessage("Local draft restored.");
  }

  return <div className="projects-page">
    <style>{PROJECT_CSS}</style>
    <div className="contribution-status"><span className="integration-icon"><GitBranch size={24}/></span><div><h3>Your contribution workspace</h3><p>Build a project, save it in this browser, then download its files to test and publish yourself.</p></div><span className="pill">Browser workspace</span></div>
    <div className="project-grid">{PROJECT_TEMPLATES.map(item => <button key={item.id} className="project-card" onClick={() => start(item.id)} disabled={ids.length >= PROJECT_LIMIT}><div><FolderGit2 size={26}/><span className="eyebrow">{item.level}</span></div><h3>{item.title}</h3><p>{item.description}</p><div className="tags">{item.skills.map(skill => <span key={skill}>{skill}</span>)}</div><span className="project-start"><Plus size={15}/> Start a new project</span></button>)}</div>
    <section className="panel project-workspace">
      <div className="section-head"><div><p className="eyebrow">PROJECT WORKSPACE · {ids.length}/{PROJECT_LIMIT}</p><h2>{project ? "Make it your own." : "Your next contribution starts here."}</h2></div>{project && <button className="primary small" disabled={busy || !signed || !!validation} onClick={save}><Save size={15}/>{busy ? "Saving…" : "Save in this browser"}</button>}</div>
      {ids.length > 0 && <label className="project-picker">Open a project<select value={activeId} onChange={event => select(event.target.value)}>{ids.map(id => { const item = resolveProjectDraft(cloud.get(id)?.project, cloud.get(id)?.updatedAt, local.get(id)); return <option key={id} value={id}>{item?.title || "Untitled project"}{!cloud.has(id) ? " · local" : ""}{local.get(id)?.revision !== local.get(id)?.savedRevision ? " · edited" : ""}</option>; })}</select></label>}
      {project ? <>
        <div className="project-details"><label>Project title<input value={project.title} maxLength={120} onChange={event => edit({ ...project, title: event.target.value })}/></label><label>Project status<select value={project.status} onChange={event => edit({ ...project, status: event.target.value as ProjectDocument["status"] })}><option value="draft">Draft</option><option value="building">Building</option><option value="published">Published (self-reported)</option></select></label></div>
        <label className="project-description">Description<textarea value={project.description} maxLength={2000} rows={2} onChange={event => edit({ ...project, description: event.target.value })}/></label>
        <div className="callout"><Code2 size={21}/><span>{template?.brief || "Build a useful feature, add tests, and explain your design decisions."}</span></div>
        <div className="project-file-tabs" role="group" aria-label="Project files">{project.files.map(file => <button key={file.path} className={file.path === activeFile?.path ? "active" : ""} aria-pressed={file.path === activeFile?.path} onClick={() => setTab(file.path)}>{file.path}</button>)}</div>
        <textarea className="project-editor" aria-label={`Edit ${activeFile?.path || "project file"}`} value={activeFile?.content || ""} onChange={event => editFile(event.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={40000}/>
        <div className="editor-bottom"><span>{activeFile?.path} · {byteLength(activeFile?.content || "").toLocaleString()} / 40,000 bytes · Editable</span>{activeFile?.path !== "main.py" && <><button className="text-button" onClick={renameFile}>Rename file</button><button className="text-button" onClick={removeFile}><Trash2 size={14}/>Remove file</button></>}</div>
        <div className="project-file-tools"><form onSubmit={event => { event.preventDefault(); addFile(); }}><label className="sr-only" htmlFor="new-project-file">New file path</label><input id="new-project-file" value={newPath} maxLength={160} placeholder="New file path, e.g. utils.py" onChange={event => setNewPath(event.target.value)}/><button className="outline small" disabled={!newPath.trim() || project.files.length >= FILE_LIMIT}><Plus size={14}/>Add file</button></form><span>{project.files.length}/{FILE_LIMIT} files · {project.files.reduce((total, file) => total + byteLength(file.content), 0).toLocaleString()} / 160,000 bytes</span></div>
        {removed && <p className="project-inline-notice">Removed {removed.path}. <button className="text-button" onClick={restoreFile}><RotateCcw size={14}/>Restore file</button></p>}
        <label className="project-repo">Repository URL <span>(optional, self-reported)</span><input value={project.repoUrl} type="url" maxLength={300} placeholder="https://github.com/your-name/your-project" onChange={event => edit({ ...project, repoUrl: event.target.value })}/></label>
        <div className="project-save-state" role="status"><Check size={16}/><span>{volatile ? "Edits are kept only for this visit. Download your files before leaving." : dirty ? "Edits recovered in this browser. Save a version here, and download a ZIP to use elsewhere." : saved ? "Saved browser project loaded. Your next edit will be recovered here." : "Local project recovered on this device."}</span></div>
        {!signed && <p className="fine-print">Browser saving is not ready. You can still edit and download a ZIP; check the storage notice before leaving.</p>}
        {validation && <p className="project-error" role="alert">{validation}</p>}
        <div className="project-export-actions"><button className="outline" onClick={() => download(project.files)}><Download size={16}/>Download project ZIP</button><button className="text-button" onClick={() => download([...project.files, { path: ".github/workflows/test.yml", content: WORKFLOW_STARTER }], "-with-ci")}><Download size={15}/>ZIP with optional CI starter</button>{draft && <button className="text-button" disabled={busy} onClick={() => setDiscarding(true)}><Trash2 size={14}/>{saved ? "Discard local changes" : "Remove local draft"}</button>}</div>
        {discarding && <div className="project-discard" role="group" aria-label="Confirm removal of local draft"><p>{saved ? "Return to the last saved browser copy?" : "Remove this draft from this device?"} Download a ZIP first if you want a permanent backup. You can undo while you stay on Build & contribute.</p><button className="outline small" onClick={() => download(project.files)}><Download size={14}/>Download backup</button><button className="outline small" onClick={discard}>Confirm removal</button><button className="text-button" onClick={() => setDiscarding(false)}>Keep editing</button></div>}
        <div className="callout"><GitBranch size={21}/><span><b>Ready for real Git?</b> Download your project ZIP, extract it, and open the folder in VS Code. Run the tests, then follow the steps below to publish through your own GitHub account. Add its repository URL above when you are ready.</span></div>
        <p className="fine-print">Saving here stores a copy in this browser; it does not create a GitHub commit. The optional CI starter is included in its ZIP download. Review it and run your tests before publishing.</p>
      </> : <div className="project-empty"><FolderGit2 size={36}/><p>Choose one of the three starters above. Each choice creates an independent project with editable Python, tests, README, and .gitignore files.</p></div>}
      {message && <p role="status" className="project-inline-notice">{message}</p>}{error && <p role="alert" className="project-error">{error}</p>}
      {discarded && <button className="text-button" onClick={undoDiscard}><RotateCcw size={15}/>Restore “{discarded.title || "Untitled project"}”</button>}
    </section>
    <div className="contribute-grid"><section className="panel"><p className="eyebrow">TAKE IT INTO THE WORLD</p><h2>Your first real repository.</h2><ol className="steps-list"><li><b>Make it yours.</b><p>Change a feature, add tests, and explain your choices in the README. Download and extract the project ZIP; nested paths stay intact.</p></li><li><b>Open it in VS Code and run it.</b><p>Extract the ZIP, choose File → Open Folder in VS Code, and select the extracted folder. Open its terminal and run:</p><pre>python main.py{'\n'}python -m unittest discover -v</pre></li><li><b>Create an empty GitHub repository.</b><p>Choose a clear name and decide whether it should be public or private.</p><a className="outline" href="https://github.com/new" target="_blank" rel="noopener noreferrer">Create repository on GitHub <ArrowUpRight size={15}/></a></li><li><b>Commit and publish your files.</b><pre>git init{'\n'}git add .{'\n'}{'git commit -m "Build first tested version"'}{'\n'}git branch -M main{'\n'}git remote add origin YOUR_REPOSITORY_URL{'\n'}git push -u origin main</pre><p>Replace YOUR_REPOSITORY_URL with the URL GitHub gives you. Authenticate using GitHub’s supported tools.</p></li><li><b>Review the result.</b><p>Read your rendered README, inspect your diff, and check your tests. Pin work you can explain.</p></li></ol></section><section className="panel"><p className="eyebrow">CONTRIBUTE WITH CARE</p><h2>A good pull request is a conversation.</h2><div className="contribution-checks">{["Read README and CONTRIBUTING before choosing an issue.", "Reproduce the issue and discuss a small, useful change.", "Fork or create a branch; keep the scope focused.", "Write a failing test, fix the bug, and rerun the suite.", "Explain why, show evidence, and respond to review.", "Respect maintainers’ time. Quality beats contribution counts."].map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></div>)}</div><a className="text-button" href="https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project" target="_blank" rel="noopener noreferrer">GitHub’s contribution guide <ArrowUpRight size={15}/></a><div className="callout"><ShieldCheck size={20}/><span>Keep credentials and personal data out of project files. Publish through your own GitHub account after reviewing the files. This website does not connect to or write to GitHub.</span></div></section></div>
  </div>;
}

const PROJECT_CSS = `
.projects-page .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.projects-page .project-card:disabled{opacity:.6;cursor:not-allowed}
.project-start{display:flex;align-items:center;gap:6px;margin-top:16px;color:#A99BFF;font-size:12px;font-weight:700}
.project-picker,.project-description,.project-repo{display:flex;flex-direction:column;gap:8px;font-size:12px;font-weight:650;margin:18px 0}
.project-picker select,.project-description textarea,.project-repo input,.project-file-tools input{border:1px solid #2B3650;border-radius:8px;background:#0B1020;padding:11px 12px;font:inherit;color:#F5F3EB;min-width:0}
.project-picker select{width:100%}
.project-description textarea{resize:vertical}
.project-repo>span{font-weight:400;color:#A6AFC1}
.project-file-tabs{flex-wrap:wrap}
.project-file-tabs button{overflow-wrap:anywhere}
.project-file-tools{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0}
.project-file-tools form{display:flex;gap:8px;flex:1;min-width:0}
.project-file-tools input{flex:1;max-width:330px}
.project-file-tools>span{font-size:11px;color:#A6AFC1}
.project-save-state{display:flex;gap:8px;align-items:flex-start;color:var(--project-success);font-size:12px;margin:18px 0 8px;line-height:1.6}
.project-save-state svg{flex-shrink:0;margin-top:2px}
.project-export-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:20px}
.project-inline-notice{color:var(--project-success);font-size:12px;line-height:1.7;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.project-error{background:rgba(255,180,190,.06);border:1px solid rgba(255,180,190,.4);border-radius:8px;padding:12px;color:#FFB4BE;font-size:13px;line-height:1.6}
.project-empty{display:flex;align-items:center;gap:20px;padding:35px 10px;color:#A6AFC1;line-height:1.8;max-width:650px}
.project-empty svg{flex-shrink:0}
.project-discard{border:1px solid rgba(255,180,190,.4);padding:15px;border-radius:9px;margin-top:15px;background:rgba(255,180,190,.06);display:flex;gap:12px;flex-wrap:wrap}
.project-discard p{width:100%;font-size:13px;margin:0;line-height:1.7}
.projects-page .project-editor{tab-size:4;white-space:pre;overflow:auto}
.projects-page .editor-bottom{gap:10px;flex-wrap:wrap}
.projects-page .project-details input{width:100%}
.projects-page button:focus-visible,.projects-page a:focus-visible,.projects-page input:focus-visible,.projects-page select:focus-visible,.projects-page textarea:focus-visible{outline:3px solid #FF6478;outline-offset:3px}
.projects-page{--project-bg:#0B1020;--project-panel:#121A2D;--project-raised:#19243A;--project-text:#F5F3EB;--project-muted:#A6AFC1;--project-line:#2B3650;--project-accent:#FF6478;--project-success:#91DDCF;--project-violet:#A99BFF;color:var(--project-text);color-scheme:dark}
.projects-page .project-card{background:var(--project-panel);border-color:var(--project-line);text-align:left;transition:border-color .18s ease,background .18s ease}
.projects-page .project-card:hover:not(:disabled){background:var(--project-raised);border-color:var(--project-violet)}
.projects-page .project-card h3,.projects-page .project-workspace h2{color:var(--project-text)}
.projects-page .project-card p{color:var(--project-muted)}
.projects-page .project-card>div:first-child>svg{color:var(--project-violet)}
.projects-page .tags span{color:var(--project-violet);background:rgba(169,155,255,.08);border:1px solid rgba(169,155,255,.18)}
.project-start{color:var(--project-accent)}
.projects-page .contribution-status{background:var(--project-panel);border-color:var(--project-line)}
.projects-page .integration-icon{color:var(--project-accent);background:rgba(255,100,120,.1)}
.projects-page .project-workspace{background:var(--project-panel);border-color:var(--project-line)}
.project-picker,.project-description,.project-repo,.projects-page .project-details label{color:var(--project-text)}
.projects-page .project-details input,.projects-page .project-details select{color:var(--project-text);background:var(--project-bg);border-color:var(--project-line)}
.projects-page input::placeholder,.projects-page textarea::placeholder{color:var(--project-muted);opacity:1}
.projects-page .project-file-tabs{background:var(--project-raised);border:1px solid var(--project-line);border-radius:10px 10px 0 0;padding:7px;gap:5px}
.projects-page .project-file-tabs button{color:var(--project-muted);background:transparent;border:1px solid transparent;border-radius:6px;padding:8px 11px}
.projects-page .project-file-tabs button:hover{color:var(--project-text);background:var(--project-panel)}
.projects-page .project-file-tabs button.active{color:var(--project-accent);background:var(--project-bg);border-color:var(--project-line)}
.projects-page .project-editor{background:var(--project-bg);color:var(--project-text);border:1px solid var(--project-line);border-top:0;border-radius:0;caret-color:var(--project-accent);font-size:13px;line-height:1.8}
.projects-page .project-editor::selection{background:rgba(169,155,255,.3);color:var(--project-text)}
.projects-page .editor-bottom{background:var(--project-raised);color:var(--project-muted);border:1px solid var(--project-line);border-top:0;border-radius:0 0 10px 10px;padding:12px 14px}
.projects-page .editor-bottom button{color:var(--project-violet)}
.project-save-state,.project-inline-notice{color:var(--project-success)}
.project-discard p{color:var(--project-text)}
.project-file-tools input{caret-color:var(--project-accent)}
.projects-page .steps-list pre{color:var(--project-text);background:var(--project-bg);border:1px solid var(--project-line)}
.projects-page .contribution-checks span{color:var(--project-violet);background:rgba(169,155,255,.08)}
.project-export-actions .text-button:hover,.project-inline-notice .text-button:hover{color:var(--project-text)}
@media(prefers-reduced-motion:reduce){.projects-page .project-card{transition:none}}
@media(max-width:640px){.project-file-tools{align-items:stretch;flex-direction:column}
.project-file-tools form{flex-wrap:wrap}
.project-file-tools input{width:100%;max-width:none}
.project-export-actions{align-items:flex-start;flex-direction:column}
.projects-page .section-head{align-items:flex-start;gap:18px;flex-wrap:wrap}
.project-empty{align-items:flex-start}
.project-picker select{max-width:100%}
.projects-page .project-details{grid-template-columns:1fr}
.projects-page .project-editor{font-size:12px}}
`;
