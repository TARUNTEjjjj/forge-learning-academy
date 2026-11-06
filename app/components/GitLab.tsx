"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, ChevronRight, Copy, FileCode2, GitBranch, GitCommitHorizontal, HelpCircle, RotateCcw, Terminal } from "lucide-react";

type Snapshot = Record<string, string>;
export type SimCommit = { id: string; message: string; parents: string[]; files: Snapshot; branch: string };
export type GitState = {
  branch: string; branches: Record<string, string>; commits: SimCommit[]; working: Snapshot; index: Snapshot;
  merge: null | { target: string; branch: string; conflicts: string[] };
};
export type GitResponse = { state: GitState; output: string; clear?: boolean };
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (a: Snapshot, b: Snapshot) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);
export function initialGitState(): GitState {
  const files = { "README.md": "# Study tracker\n\nA tiny tool for a big learning journey.\n" };
  return { branch: "main", branches: { main: "c000001" }, commits: [{ id: "c000001", message: "Start study tracker", parents: [], files, branch: "main" }], working: { ...files, "tracker.py": "def progress(completed, goal):\n    if goal <= 0:\n        return 0\n    return max(0, min(100, completed * 100 // goal))\n" }, index: { ...files }, merge: null };
}
function head(state: GitState) { return state.commits.find(commit => commit.id === state.branches[state.branch])!; }
export function gitChanges(state: GitState) {
  const latest = head(state).files;
  const staged = [...new Set([...Object.keys(latest), ...Object.keys(state.index)])].filter(file => latest[file] !== state.index[file]);
  const changed = [...new Set([...Object.keys(state.index), ...Object.keys(state.working)])].filter(file => own(state.index, file) && state.index[file] !== state.working[file]);
  const untracked = Object.keys(state.working).filter(file => !own(state.index, file));
  return { staged, changed, untracked };
}
function isClean(state: GitState) { const changes = gitChanges(state); return !changes.staged.length && !changes.changed.length && !changes.untracked.length; }
function ancestors(state: GitState, ...ids: string[]) {
  const seen = new Map<string, number>(); const queue: [string, number][] = ids.map(id => [id, 0]);
  for (let i = 0; i < queue.length; i++) {
    const [current, depth] = queue[i]; if (seen.has(current)) continue; seen.set(current, depth);
    const commit = state.commits.find(item => item.id === current);
    for (const parent of commit?.parents || []) queue.push([parent, depth + 1]);
  }
  return seen;
}
function makeCommit(state: GitState, message: string, parents = [state.branches[state.branch]]) {
  const id = `c${String(state.commits.length + 1).padStart(6, "0")}`;
  state.commits.push({ id, message, parents, files: { ...state.index }, branch: state.branch });
  state.branches[state.branch] = id;
  return id;
}
function validBranch(name: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,49}$/.test(name) && !name.includes("..") && !name.includes("//") && !name.endsWith("/") && !name.endsWith(".") && !name.endsWith(".lock") && name.split("/").every(part => !part.startsWith("."));
}
function parseCommand(command: string): string[] | null {
  const parts: string[] = []; let word = ""; let quote = ""; let escaped = false; let started = false;
  for (const char of command) {
    if (escaped) { word += char; escaped = false; started = true; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ""; else word += char; started = true; continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/\s/.test(char)) { if (started) parts.push(word); word = ""; started = false; }
    else { word += char; started = true; }
  }
  if (quote || escaped) return null;
  if (started) parts.push(word);
  return parts;
}

export const GIT_HELP = `This is a local learning simulator. No files or repositories leave your browser.

git status                     Inspect working tree and staging area
git add <file>   /   git add .  Stage the current contents of files
git diff                       Compare working files with staged files
git diff --staged               Compare staged files with the latest commit
git commit -m "message"         Save the staged snapshot
git branch                     List branches
git branch <name>              Create a branch at the current commit
git switch -c <name>           Create and switch to a branch
git switch <name>              Move to an existing branch (clean worktree required here)
git log                        Read commits reachable from HEAD
git merge <branch>             Merge a branch into the current branch
git merge --abort              Cancel an unresolved merge
git restore --staged <file>     Unstage a file
git restore <file>             Replace a tracked working file with its staged contents
git reset                      Unstage everything; keep working files
clear                          Clear terminal output

Edit files in the editor above. Start with git status, then git add tracker.py.
GitHub, push, clone, and pull need a real repository; use the contribution workspace for those.`;

/** Pure, deliberately small Git model with snapshots, pointers, and three-way file merges. */
export function runGitCommand(previous: GitState, command: string): GitResponse {
  const state = clone(previous);
  const reply = (output: string): GitResponse => ({ state, output });
  const parts = parseCommand(command.trim());
  if (!parts) return reply('A quoted string is still open. Close it, for example: git commit -m "Add progress helper"');
  if (parts.length === 0) return reply("");
  if (parts[0] === "help") return reply(GIT_HELP);
  if (parts[0] === "clear") return { state, output: "", clear: true };
  if (parts[0] !== "git") return reply("This terminal teaches Git commands. Try git status, or type help to see the supported commands.");
  const [, verb, ...args] = parts;
  if (verb === "status") {
    const { staged, changed, untracked } = gitChanges(state);
    const lines = [`On branch ${state.branch}`];
    if (state.merge) lines.push(state.merge.conflicts.length ? `Merge in progress. Resolve and stage: ${state.merge.conflicts.join(", ")}` : "All conflicts are staged. Commit to finish the merge.");
    if (staged.length) lines.push(`Changes staged for the next commit:\n${staged.map(file => `  ${file}`).join("\n")}`);
    if (changed.length) lines.push(`Working changes not staged:\n${changed.map(file => `  ${file}`).join("\n")}`);
    if (untracked.length) lines.push(`Untracked files:\n${untracked.map(file => `  ${file}`).join("\n")}`);
    if (!staged.length && !changed.length && !untracked.length) lines.push("Working tree clean.");
    return reply(lines.join("\n\n"));
  }
  if (verb === "add") {
    if (args.length !== 1) return reply("Use git add <file> or git add . to stage the current file contents.");
    const paths = args[0] === "." ? [...new Set([...Object.keys(state.working), ...Object.keys(state.index)])] : args;
    for (const file of paths) {
      if (!own(state.working, file) && !own(state.index, file)) return reply(`No file named ${file}. Select an existing file in the editor.`);
      if (state.merge?.conflicts.includes(file) && /^(<{7}|={7}|>{7})/m.test(state.working[file] || "")) return reply(`Resolve the conflict markers in ${file} before staging it in this lab.`);
    }
    for (const file of paths) {
      if (own(state.working, file)) state.index[file] = state.working[file]; else delete state.index[file];
      if (state.merge) state.merge.conflicts = state.merge.conflicts.filter(item => item !== file);
    }
    return reply(`Staged ${args[0] === "." ? "current file contents" : args[0]}. Later edits will need another git add.`);
  }
  if (verb === "commit") {
    if (args.length !== 2 || args[0] !== "-m" || !args[1].trim()) return reply('Give the snapshot a useful message: git commit -m "Add progress helper"');
    if (args[1].length > 200) return reply("Keep this lab's commit message under 200 characters.");
    if (state.merge?.conflicts.length) return reply(`Resolve and stage the remaining conflicts first: ${state.merge.conflicts.join(", ")}`);
    if (equal(head(state).files, state.index) && !state.merge) return reply("No staged changes to commit. Edit a file, then use git add <file>.");
    const parents = state.merge ? [state.branches[state.branch], state.merge.target] : [state.branches[state.branch]];
    const id = makeCommit(state, args[1].trim(), parents); state.merge = null;
    return reply(`[${state.branch} ${id}] ${args[1].trim()}\nThe staged snapshot is now part of your history.`);
  }
  if (verb === "branch" && args.length === 0) return reply(Object.keys(state.branches).map(name => `${name === state.branch ? "*" : " "} ${name} → ${state.branches[name]}`).join("\n"));
  if ((verb === "branch" && args.length === 1) || (verb === "switch" && args[0] === "-c" && args.length === 2)) {
    if (state.merge) return reply("Finish or abort the current merge before creating a branch.");
    const name = verb === "branch" ? args[0] : args[1];
    if (!validBranch(name) || name === "__proto__" || name === "constructor" || name === "prototype") return reply("Use a short branch name like feature/streak, with letters, numbers, slashes, dashes, or underscores.");
    if (own(state.branches, name)) return reply(`Branch ${name} already exists. Use git switch ${name}.`);
    if (Object.keys(state.branches).some(branch => branch.startsWith(`${name}/`) || name.startsWith(`${branch}/`))) return reply("That name conflicts with an existing branch path. Choose another name.");
    state.branches[name] = state.branches[state.branch];
    if (verb === "switch") state.branch = name;
    return reply(verb === "switch" ? `Switched to new branch ${name}. Working changes travel with you until committed.` : `Created branch ${name} at ${state.branches[name]}. You are still on ${state.branch}.`);
  }
  if (verb === "switch") {
    if (args.length !== 1) return reply("Use git switch <branch>, or git switch -c <new-branch>.");
    if (!own(state.branches, args[0])) return reply(`Branch ${args[0]} does not exist. Use git branch to list branches.`);
    if (state.merge) return reply("Finish or abort the current merge before switching branches.");
    if (!isClean(state)) return reply("This lab requires a clean worktree before switching existing branches. Stage and commit your work, or restore it first. Real Git allows some nonconflicting changes to travel between branches.");
    state.branch = args[0]; state.working = { ...head(state).files }; state.index = { ...head(state).files };
    return reply(`Switched to branch ${state.branch}. The files now match its latest snapshot.`);
  }
  if (verb === "log") {
    const reachable = ancestors(state, state.branches[state.branch]);
    return reply(state.commits.filter(commit => reachable.has(commit.id)).reverse().map(commit => {
      const labels = Object.entries(state.branches).filter(([, id]) => id === commit.id).map(([branch]) => branch === state.branch ? `HEAD → ${branch}` : branch);
      return `${commit.id}${labels.length ? ` (${labels.join(", ")})` : ""}\n  ${commit.message}${commit.parents.length > 1 ? `\n  Merge parents: ${commit.parents.join(" ")}` : ""}`;
    }).join("\n\n"));
  }
  if (verb === "diff") {
    if (args.length > 1 || (args.length === 1 && args[0] !== "--staged" && args[0] !== "--cached")) return reply("Use git diff or git diff --staged in this lab.");
    const staged = args.length > 0; const before = staged ? head(state).files : state.index; const after = staged ? state.index : state.working;
    const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file] && (staged || own(before, file)));
    if (!paths.length) return reply(staged ? "No staged differences." : "No tracked working differences. git diff does not show untracked files; try git status.");
    return reply(paths.map(file => `--- ${file} (${staged ? "HEAD" : "staged"})\n+++ ${file} (${staged ? "staged" : "working"})\n${(before[file] || "").split("\n").map(line => `- ${line}`).join("\n")}\n${(after[file] || "").split("\n").map(line => `+ ${line}`).join("\n")}`).join("\n\n") + "\n\nThis lab displays whole-file before/after views; real Git emits line-level hunks.");
  }
  if (verb === "restore" || verb === "reset") {
    if (state.merge) return reply("Use git merge --abort to discard the in-progress merge, or finish resolving it.");
    if (verb === "reset") {
      if (args.length) return reply("This lab supports git reset to unstage all files. History-changing reset modes are outside this simulator.");
      state.index = { ...head(state).files }; return reply("Unstaged all files. Working files and commit history are unchanged.");
    }
    const staged = args[0] === "--staged"; const file = staged ? args[1] : args[0];
    if (args.length !== (staged ? 2 : 1) || !file) return reply("Use git restore <file> or git restore --staged <file>.");
    const source = staged ? head(state).files : state.index; const target = staged ? state.index : state.working;
    if (!own(source, file) && !(staged && own(state.index, file))) return reply(`No tracked file named ${file} in that snapshot.`);
    if (own(source, file)) target[file] = source[file]; else delete target[file];
    return reply(staged ? `Unstaged ${file}; working contents preserved.` : `Restored ${file} from the staged snapshot. Unstaged edits to that file were discarded in this simulator.`);
  }
  if (verb === "merge") {
    if (args[0] === "--abort" && args.length === 1) {
      if (!state.merge) return reply("There is no merge in progress.");
      state.working = { ...head(state).files }; state.index = { ...head(state).files }; state.merge = null;
      return reply("Merge cancelled. Files restored to the current branch's snapshot.");
    }
    if (args.length !== 1) return reply("Use git merge <branch> while on the branch that should receive the changes.");
    if (!own(state.branches, args[0])) return reply(`No branch named ${args[0]}.`);
    if (state.merge) return reply("A merge is already in progress. Resolve it or use git merge --abort.");
    if (!isClean(state)) return reply("Commit or restore working changes before merging in this lab.");
    const ours = head(state); const target = state.branches[args[0]]; const theirs = state.commits.find(commit => commit.id === target)!;
    const ourAncestors = ancestors(state, ours.id); const theirAncestors = ancestors(state, target);
    if (ourAncestors.has(target)) return reply("Already up to date: that branch's history is already included here.");
    if (theirAncestors.has(ours.id)) {
      state.branches[state.branch] = target; state.working = { ...theirs.files }; state.index = { ...theirs.files };
      return reply(`Fast-forward: ${state.branch} now points to ${target}. No extra commit was needed because its previous tip was an ancestor.`);
    }
    const shared = [...ourAncestors.keys()].filter(id => theirAncestors.has(id));
    // Like git merge-base, never use a common ancestor that another common ancestor already contains.
    const older = ancestors(state, ...shared.flatMap(id => state.commits.find(commit => commit.id === id)!.parents));
    const common = shared.filter(id => !older.has(id)).sort((a, b) => ourAncestors.get(a)! + theirAncestors.get(a)! - ourAncestors.get(b)! - theirAncestors.get(b)!)[0];
    if (!common) return reply("These histories have no common ancestor; this simulator does not combine unrelated repositories.");
    const base = state.commits.find(commit => commit.id === common)!.files;
    const files = [...new Set([...Object.keys(base), ...Object.keys(ours.files), ...Object.keys(theirs.files)])];
    const merged: Snapshot = {}; const conflicts: string[] = [];
    for (const file of files) {
      const original = base[file], a = ours.files[file], b = theirs.files[file];
      let value: string | undefined;
      if (a === b) value = a; else if (a === original) value = b; else if (b === original) value = a;
      else { conflicts.push(file); value = `<<<<<<< HEAD\n${a || ""}\n=======\n${b || ""}\n>>>>>>> ${args[0]}\n`; }
      if (value !== undefined) merged[file] = value;
    }
    state.working = merged; state.index = { ...merged };
    if (conflicts.length) {
      for (const file of conflicts) { if (own(ours.files, file)) state.index[file] = ours.files[file]; else delete state.index[file]; }
      state.merge = { target, branch: args[0], conflicts };
      return reply(`Merge conflict in ${conflicts.join(", ")}.\nOpen each file, keep the intended contents, remove all conflict markers, then git add <file> and git commit -m "Resolve merge".\nThis simulator merges at file level; real Git can automatically merge independent edits within one file.`);
    }
    const id = makeCommit(state, `Merge ${args[0]} into ${state.branch}`, [ours.id, target]);
    return reply(`Merged ${args[0]} into ${state.branch}. Commit ${id} has two parents, preserving both histories.`);
  }
  if (["push", "pull", "clone", "fetch", "remote"].includes(verb)) return reply("This is a browser simulator with no remote repository. Use the contribution workspace for real GitHub projects. In real Git, a remote is a named URL such as origin; push uploads commits and fetch downloads remote history.");
  if (verb === "init") return reply("This practice repository is already initialized. In a real folder, git init creates a .git directory that stores your repository history and configuration.");
  return reply(`This lab does not implement git ${verb || "(command)"}. Type help for the supported commands and their purpose.`);
}

export default function GitLab() {
  const [state, setState] = useState<GitState>(initialGitState);
  const [file, setFile] = useState("tracker.py");
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<{ command: string; output: string }[]>([{ command: "", output: "Welcome to your first repository.\nA repository is a project folder plus a history of snapshots.\nYou have one new file. Try git status to see it." }]);
  const [resetOpen, setResetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const terminal = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const changes = gitChanges(state);
  const selectedFile = own(state.working, file) ? file : Object.keys(state.working)[0];
  useEffect(() => { if (terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight; }, [history]);
  function execute(value: string) {
    if (!value.trim()) return;
    const response = runGitCommand(state, value);
    setState(response.state); setCommand("");
    setHistory(previous => response.clear ? [] : [...previous.slice(-79), { command: value.trim(), output: response.output }]);
    input.current?.focus();
  }
  async function copyCommands() {
    try { await navigator.clipboard.writeText(history.filter(item => item.command).map(item => item.command).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setHistory(previous => [...previous, { command: "", output: "Clipboard access was unavailable. Select and copy your commands from the terminal." }]); }
  }
  const branchNames = [...new Set(state.commits.map(commit => commit.branch))];
  const lanes = Object.fromEntries(branchNames.map((name, index) => [name, index]));
  const nodeHeight = 54; const svgHeight = Math.max(110, state.commits.length * nodeHeight + 35);

  return <div className="lab-git">
    <style>{GIT_CSS}</style>
    <div className="lab-git-heading"><div><span className="lab-git-eyebrow">MAKE CHANGES WITHOUT THE FEAR</span><h2>Your ideas have a history.</h2><p>Learn Git by moving real snapshots through a safe browser simulator.</p></div><span className="lab-simulator"><span /> Local simulator</span></div>
    <div className="lab-git-intro"><div><span>01</span><strong>Working directory</strong><p>The files you are editing right now.</p></div><ChevronRight size={16} /><div><span>02</span><strong>Staging area</strong><p>The exact changes chosen for your next snapshot.</p></div><ChevronRight size={16} /><div><span>03</span><strong>Repository</strong><p>Your saved snapshots, connected into a history.</p></div></div>
    <div className="lab-git-grid">
      <div className="lab-git-work">
        <div className="lab-file-panel"><div className="lab-file-header"><span><FileCode2 size={15} /> Working files</span><label><span className="lab-sr-only">Choose a file to edit</span><select value={selectedFile} onChange={event => setFile(event.target.value)}>{Object.keys(state.working).map(name => <option key={name} value={name}>{name}</option>)}</select></label><span className="lab-branch-label"><GitBranch size={13} /> {state.branch}</span></div>
          <textarea aria-label={`Edit ${selectedFile}`} value={state.working[selectedFile] || ""} spellCheck={false} maxLength={15000} onChange={event => setState(previous => ({ ...previous, working: { ...previous.working, [selectedFile]: event.target.value } }))} />
          <div className="lab-file-caption">Edit this file. Then stage and commit the version you want to keep.</div>
        </div>
        <div className="lab-git-zones"><div><span>WORKING CHANGES</span><strong>{changes.changed.length + changes.untracked.length}</strong><small>{[...changes.changed, ...changes.untracked].join(", ") || "All saved"}</small></div><div><span>STAGED FILES</span><strong>{changes.staged.length}</strong><small>{changes.staged.join(", ") || "Ready for your selection"}</small></div><div><span>COMMITS</span><strong>{state.commits.length}</strong><small>HEAD → {state.branch}</small></div></div>
        <div className="lab-terminal"><div className="lab-terminal-header"><span><Terminal size={15} /> Terminal</span><div><button onClick={copyCommands} title="Copy commands">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button><button onClick={() => setHelpOpen(!helpOpen)} aria-expanded={helpOpen}><HelpCircle size={14} /> Commands</button></div></div>
          <div className="lab-terminal-output" ref={terminal} role="log" aria-label="Git command history" aria-live="polite">{history.map((entry, index) => <div key={index}>{entry.command && <p className="lab-terminal-command"><span>❯</span> {entry.command}</p>}<pre>{entry.output}</pre></div>)}</div>
          <form className="lab-terminal-input" onSubmit={event => { event.preventDefault(); execute(command); }}><span>❯</span><input ref={input} aria-label="Git command" autoComplete="off" spellCheck={false} value={command} maxLength={500} onChange={event => setCommand(event.target.value)} placeholder="Type git status, then press Enter" /><button type="submit" aria-label="Run Git command"><ChevronRight size={17} /></button></form>
        </div>
        <div className="lab-git-shortcuts"><span>Try a command</span>{["git status", "git add tracker.py", 'git commit -m "Add progress helper"', "git switch -c feature/streak", "git log"].map(value => <button key={value} onClick={() => execute(value)}>{value}</button>)}</div>
        {helpOpen && <div className="lab-git-help"><pre>{GIT_HELP}</pre></div>}
      </div>
      <aside className="lab-history-panel"><div className="lab-history-title"><GitCommitHorizontal size={17} /><strong>Your commit graph</strong></div><p>Each dot is a snapshot. A branch is a movable label pointing to one snapshot.</p>
        <div className="lab-branch-list">{Object.entries(state.branches).map(([name]) => <span className={name === state.branch ? "lab-current-branch" : ""} key={name}><GitBranch size={12} />{name}{name === state.branch && <small>HEAD</small>}</span>)}</div>
        <div className="lab-dag-scroll"><svg className="lab-dag" viewBox={`0 0 ${Math.max(300, branchNames.length * 38 + 245)} ${svgHeight}`} role="img" aria-label={`Commit graph with ${state.commits.length} commits across ${Object.keys(state.branches).length} branches`}>
          {state.commits.map((commit, index) => commit.parents.map(parent => {
            const parentIndex = state.commits.findIndex(item => item.id === parent); const parentCommit = state.commits[parentIndex];
            return <path key={`${commit.id}-${parent}`} d={`M ${25 + lanes[commit.branch] * 30} ${25 + (state.commits.length - 1 - index) * nodeHeight} C ${25 + lanes[commit.branch] * 30} ${45 + (state.commits.length - 1 - index) * nodeHeight}, ${25 + lanes[parentCommit.branch] * 30} ${5 + (state.commits.length - 1 - parentIndex) * nodeHeight}, ${25 + lanes[parentCommit.branch] * 30} ${25 + (state.commits.length - 1 - parentIndex) * nodeHeight}`} stroke={commit.parents.length > 1 ? "#e7bd85" : "#54735a"} strokeWidth="2" fill="none" />;
          }))}
          {state.commits.map((commit, index) => { const x = 25 + lanes[commit.branch] * 30; const y = 25 + (state.commits.length - 1 - index) * nodeHeight; const isHead = state.branches[state.branch] === commit.id; const textX = 60 + (branchNames.length - 1) * 30;
            return <g key={commit.id}><circle cx={x} cy={y} r={isHead ? 7 : 5} fill={isHead ? "#baf4ac" : "#1b3022"} stroke="#8fb38c" strokeWidth="2" /><text x={textX} y={y - 2} fill={isHead ? "#c6edbb" : "#a9beab"} fontSize="11" fontFamily="ui-monospace,monospace">{commit.id}{isHead ? " ← HEAD" : ""}</text><text x={textX} y={y + 15} fill="#809b87" fontSize="10">{commit.message.length > 27 ? commit.message.slice(0, 26) + "…" : commit.message}</text></g>;
          })}
        </svg></div>
        <div className="lab-git-next"><span>YOUR NEXT EXPERIMENT</span><ol><li>Stage and commit <code>tracker.py</code>.</li><li>Create a branch with <code>git switch -c feature/streak</code>.</li><li>Edit the file; stage and commit again.</li><li>Run <code>git switch main</code>, then <code>git merge feature/streak</code>.</li><li>Watch the label move. That is a fast-forward merge.</li></ol></div>
        <div className="lab-git-advanced"><details><summary>Try a merge conflict <ArrowDown size={13} /></summary><p>After creating a feature branch, change and commit the same file differently on each branch. Switch to main and merge the feature. Resolve the markers in the editor, stage the file, then commit. To restart the merge, use <code>git merge --abort</code>.</p></details></div>
        <button className="lab-reset-lab" onClick={() => setResetOpen(!resetOpen)}><RotateCcw size={13} /> Restart this experiment</button>
        {resetOpen && <div className="lab-git-reset"><p>Clear this simulator’s files and history?</p><button onClick={() => { setState(initialGitState()); setFile("tracker.py"); setHistory([{ command: "", output: "Fresh repository ready. Start with git status." }]); setResetOpen(false); setCommand(""); }}>Restart</button><button onClick={() => setResetOpen(false)}>Keep exploring</button></div>}
      </aside>
    </div>
    <div className="lab-git-footer"><p><strong>Git ≠ GitHub.</strong> Git manages history on your computer. GitHub hosts repositories online and adds issues, reviews, pull requests, and collaboration. This simulator makes no GitHub changes and resets when you leave this section.</p><a href="https://git-scm.com/book/en/v2" target="_blank" rel="noopener noreferrer">Read the free Pro Git book <ChevronRight size={14} /></a></div>
  </div>;
}

const GIT_CSS = `
.lab-git{color:#F5F3EB}
.lab-git button,.lab-git input,.lab-git textarea,.lab-git select{font:inherit}
.lab-git button{cursor:pointer}
.lab-git button:focus-visible,.lab-git input:focus-visible,.lab-git textarea:focus-visible,.lab-git select:focus-visible,.lab-git summary:focus-visible,.lab-git a:focus-visible{outline:2px solid #FF6478;outline-offset:3px}
.lab-git-heading{display:flex;gap:20px;align-items:center;justify-content:space-between;margin-bottom:28px}
.lab-git-eyebrow{font-size:10px;letter-spacing:2px;color:#FF6478}
.lab-git-heading h2{font-size:clamp(24px,3vw,36px);font-weight:500;letter-spacing:-1px;margin:12px 0 8px}
.lab-git-heading p{font-size:13px;color:#A6AFC1}
.lab-simulator{display:flex;align-items:center;gap:8px;white-space:nowrap;background:rgba(169,155,255,.08);border:1px solid #2B3650;border-radius:20px;padding:8px 12px;font-size:10px;color:#A99BFF}
.lab-simulator>span{width:5px;height:5px;background:#FF6478;border-radius:50%}
.lab-git-intro{display:flex;align-items:center;gap:20px;background:#121A2D;border:1px solid #2B3650;border-radius:12px;padding:22px 25px;margin-bottom:24px}
.lab-git-intro>div{flex:1}
.lab-git-intro>svg{flex-shrink:0;color:#A6AFC1}
.lab-git-intro>div>span{display:inline-block;font:10px ui-monospace,monospace;color:#A99BFF;margin-right:9px}
.lab-git-intro strong{font-size:12px;font-weight:500}
.lab-git-intro p{font-size:11px;color:#A6AFC1;line-height:1.6;margin:8px 0 0}
.lab-git-grid{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:22px}
.lab-git-work{min-width:0}
.lab-file-panel{border:1px solid #2B3650;border-radius:10px;overflow:hidden;background:#0B1020}
.lab-file-header{display:flex;align-items:center;gap:14px;border-bottom:1px solid #2B3650;background:#19243A;padding:11px 14px;font-size:11px;color:#A6AFC1}
.lab-file-header>span{display:flex;align-items:center;gap:6px}
.lab-file-header select{color:#F5F3EB;background:#121A2D;border:1px solid #2B3650;border-radius:4px;padding:4px 6px;font:11px ui-monospace,monospace}
.lab-branch-label{margin-left:auto;color:#A99BFF;max-width:180px;overflow-wrap:anywhere}
.lab-file-panel textarea{width:100%;height:210px;display:block;resize:vertical;background:transparent;border:0;color:#F5F3EB;padding:18px;font:12px/1.9 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:4;border-radius:0;white-space:pre;min-height:140px}
.lab-file-caption{border-top:1px solid #2B3650;padding:9px 14px;color:#A6AFC1;font-size:10px;line-height:1.5}
.lab-git-zones{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:14px 0}
.lab-git-zones>div{border:1px solid #2B3650;background:#121A2D;border-radius:7px;padding:12px}
.lab-git-zones span{font-size:8px;letter-spacing:1px;color:#A6AFC1}
.lab-git-zones strong{font-size:25px;display:block;font-weight:500;margin:5px 0;color:#FF6478}
.lab-git-zones small{font-size:9px;line-height:1.5;display:block;color:#A6AFC1;overflow-wrap:anywhere}
.lab-terminal{background:#0B1020;border:1px solid #2B3650;border-radius:10px;overflow:hidden}
.lab-terminal-header{display:flex;align-items:center;justify-content:space-between;background:#19243A;border-bottom:1px solid #2B3650;padding:11px 14px;color:#A6AFC1;font-size:11px}
.lab-terminal-header>span,.lab-terminal-header>div{display:flex;align-items:center;gap:7px}
.lab-terminal-header button{display:flex;align-items:center;gap:5px;background:none;border:0;color:#A6AFC1;font-size:10px;padding:2px 5px}
.lab-terminal-output{height:260px;overflow:auto;padding:13px 16px}
.lab-terminal-output>div{margin-bottom:15px}
.lab-terminal-output pre{font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#A6AFC1;margin:6px 0}
.lab-terminal-command{font:11px/1.7 ui-monospace,monospace;color:#F5F3EB;margin:8px 0}
.lab-terminal-command>span{color:#FF6478}
.lab-terminal-input{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#19243A;border-top:1px solid #2B3650;color:#FF6478}
.lab-terminal-input input{min-width:0;flex:1;background:transparent;border:0;color:#F5F3EB;font:12px ui-monospace,monospace;padding:4px 3px}
.lab-terminal-input input::placeholder{color:#A6AFC1}
.lab-terminal-input button{display:grid;place-items:center;border:1px solid #2B3650;border-radius:5px;background:#19243A;color:#F5F3EB;padding:3px 7px}
.lab-git-shortcuts{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:14px 0}
.lab-git-shortcuts>span{font-size:10px;color:#A6AFC1;margin-right:3px}
.lab-git-shortcuts button{font:9px ui-monospace,monospace;color:#A99BFF;background:#19243A;border:1px solid #2B3650;border-radius:5px;padding:7px 9px}
.lab-git-shortcuts button:hover{background:#19243A}
.lab-git-help{background:#121A2D;border:1px solid #2B3650;border-radius:9px;padding:15px}
.lab-git-help pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#A6AFC1;font:10px/1.8 ui-monospace,monospace;margin:0}
.lab-history-panel{border:1px solid #2B3650;border-radius:11px;background:#121A2D;padding:20px;min-width:0}
.lab-history-title{display:flex;gap:8px;align-items:center;color:#F5F3EB;font-size:12px}
.lab-history-title strong{font-weight:500}
.lab-history-panel>p{font-size:11px;color:#A6AFC1;line-height:1.7;margin:13px 0}
.lab-branch-list{display:flex;gap:7px;flex-wrap:wrap;margin:17px 0}
.lab-branch-list>span{display:flex;gap:5px;align-items:center;font:10px ui-monospace,monospace;color:#A6AFC1;border:1px solid #2B3650;border-radius:5px;padding:5px 7px;overflow-wrap:anywhere;max-width:100%}
.lab-branch-list .lab-current-branch{background:rgba(255,100,120,.08);color:#FF6478;border-color:rgba(255,100,120,.35)}
.lab-branch-list small{font-size:8px;color:#A6AFC1}
.lab-dag-scroll{overflow:auto;max-height:370px;border-top:1px solid #2B3650;border-bottom:1px solid #2B3650;padding:10px 0;margin:12px 0 22px}
.lab-dag{min-width:270px;width:100%;display:block}
.lab-git-next>span{font-size:9px;letter-spacing:1.3px;color:#A99BFF}
.lab-git-next ol{margin:13px 0 0;padding-left:16px}
.lab-git-next li{font-size:11px;color:#A6AFC1;line-height:1.8;margin-bottom:8px;padding-left:3px}
.lab-git-next code{font-size:10px;color:#A99BFF;overflow-wrap:anywhere}
.lab-git-advanced{border-top:1px solid #2B3650;margin-top:20px;padding-top:16px;font-size:11px;color:#A6AFC1}
.lab-git-advanced summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none}
.lab-git-advanced p{font-size:11px;color:#A6AFC1;line-height:1.8}
.lab-git-advanced code{font-size:10px;color:#A99BFF}
.lab-reset-lab{display:flex;align-items:center;gap:6px;background:transparent;border:0;padding:0;margin-top:22px;color:#A6AFC1;font-size:10px!important}
.lab-git-reset{margin-top:12px;padding:10px;border:1px solid #2B3650;border-radius:6px}
.lab-git-reset p{font-size:10px;color:#F5F3EB}
.lab-git-reset button{background:#19243A;color:#F5F3EB;font-size:10px;border:1px solid #2B3650;border-radius:4px;padding:5px 7px;margin-right:5px}
.lab-git-footer{display:flex;align-items:center;justify-content:space-between;gap:25px;border-top:1px solid #2B3650;margin-top:25px;padding-top:18px}
.lab-git-footer p{font-size:11px;color:#A6AFC1;line-height:1.8;max-width:730px;margin:0}
.lab-git-footer strong{font-weight:500;color:#F5F3EB}
.lab-git-footer a{display:flex;align-items:center;gap:5px;white-space:nowrap;color:#A99BFF;font-size:11px;text-decoration:none}
.lab-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.lab-git{--git-bg:#0B1020;--git-panel:#121A2D;--git-raised:#19243A;--git-text:#F5F3EB;--git-muted:#A6AFC1;--git-line:#2B3650;--git-accent:#FF6478;--git-primary:#D82745;--git-violet:#A99BFF;color-scheme:dark}
.lab-git-heading{color:var(--git-text)}
.lab-git-heading h2{font-weight:700}
.lab-simulator{border-color:rgba(169,155,255,.35)}
.lab-git-intro>svg{color:var(--git-violet)}
.lab-git-intro strong{color:var(--git-text)}
.lab-file-panel,.lab-terminal,.lab-history-panel{box-shadow:0 12px 32px rgba(11,16,32,.2)}
.lab-file-header,.lab-terminal-header{background:var(--git-raised)}
.lab-file-panel textarea{caret-color:var(--git-accent);font-size:13px}
.lab-file-panel textarea::selection,.lab-terminal-input input::selection{background:rgba(169,155,255,.3);color:var(--git-text)}
.lab-file-caption{background:var(--git-panel)}
.lab-terminal-output pre{color:var(--git-text)}
.lab-terminal-command{color:var(--git-violet)}
.lab-terminal-input{background:var(--git-panel)}
.lab-terminal-input input{caret-color:var(--git-accent)}
.lab-terminal-input button{background:var(--git-primary);color:#FFFFFF;border-color:var(--git-primary);min-width:30px;min-height:30px}
.lab-terminal-input button:hover{background:#C51F3B;border-color:#C51F3B}
.lab-terminal-header button{color:var(--git-violet)}
.lab-terminal-header button:hover{color:var(--git-text)}
.lab-git-shortcuts button{font-size:10px;transition:background .16s ease,border-color .16s ease}
.lab-git-shortcuts button:hover{border-color:var(--git-violet)}
.lab-git-help{background:var(--git-panel)}
.lab-git-help pre{color:var(--git-text)}
.lab-history-panel{background:var(--git-panel)}
.lab-current-branch small{color:var(--git-accent)}
.lab-dag path{stroke:var(--git-violet);opacity:.65}
.lab-dag path[stroke="#e7bd85"]{stroke:var(--git-accent);opacity:.8}
.lab-dag circle{fill:var(--git-raised);stroke:var(--git-violet)}
.lab-dag circle[fill="#baf4ac"]{fill:var(--git-accent);stroke:var(--git-accent)}
.lab-dag text{fill:var(--git-muted)}
.lab-dag text[fill="#c6edbb"]{fill:var(--git-accent)}
.lab-git-advanced summary{color:var(--git-violet)}
.lab-reset-lab{color:var(--git-muted)}
.lab-reset-lab:hover{color:#FFB4BE}
.lab-git-reset{border-color:rgba(255,180,190,.35);background:rgba(255,180,190,.04)}
.lab-git-reset p{color:var(--git-text)}
.lab-git-reset button:hover{border-color:var(--git-violet)}
.lab-git-footer strong{color:var(--git-text)}
.lab-git-footer a{color:var(--git-violet)}
.lab-git-footer a:hover{color:var(--git-text)}
@media(prefers-reduced-motion:reduce){.lab-git button{transition:none}}
@media(max-width:1000px){.lab-git-grid{grid-template-columns:minmax(0,1fr) 270px;gap:15px}
.lab-history-panel{padding:15px}
.lab-file-header{gap:7px}
.lab-file-header>span:first-child{font-size:10px}
.lab-branch-label{max-width:100px}
.lab-git-intro{padding:18px;gap:12px}
.lab-git-footer{align-items:flex-start;flex-direction:column;gap:12px}}
@media(max-width:760px){.lab-git-grid{grid-template-columns:1fr}
.lab-git-heading{align-items:flex-start;gap:10px}
.lab-git-heading h2{font-size:27px}
.lab-simulator{font-size:8px;padding:7px 8px}
.lab-git-intro{align-items:flex-start;gap:12px;padding:17px 13px}
.lab-git-intro>svg{display:none}
.lab-git-intro strong{display:block;font-size:11px;margin-top:7px}
.lab-git-intro p{font-size:10px}
.lab-git-zones{gap:7px}
.lab-git-zones>div{padding:10px}
.lab-git-zones span{font-size:7px}
.lab-file-header{flex-wrap:wrap}
.lab-file-header select{font-size:10px}
.lab-branch-label{font-size:9px}
.lab-dag-scroll{max-height:280px}
.lab-dag{max-width:360px}
.lab-git-footer a{font-size:11px}
.lab-git-heading p{font-size:12px}}`;
