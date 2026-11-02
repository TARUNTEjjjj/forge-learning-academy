"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Clock3, Code2, Lightbulb, Loader2, Play, RotateCcw, Square, Terminal, XCircle } from "lucide-react";
import { MISSIONS, isJsonValue, jsonEqual, type JsonValue, type Mission } from "../../lib/missions";

export type PracticeResult = { missionId: string; passed: number; total: number; category: string };
type Props = { onResult?: (result: PracticeResult) => void; initialMission?: string; userKey?: string };
type CaseResult = { value: JsonValue; error: string | null; mutated: boolean };
type Feedback = { results: CaseResult[]; error: string | null; output: string; sample: boolean };
type Status = "idle" | "loading" | "running" | "done" | "error";

const memoryStore = new Map<string, string>();
function subscribeStore(notify: () => void) {
  const otherTab = (event: StorageEvent) => { if (event.key) memoryStore.delete(event.key); else memoryStore.clear(); notify(); };
  window.addEventListener("storage", otherTab);
  window.addEventListener("forge-lab-storage", notify);
  return () => { window.removeEventListener("storage", otherTab); window.removeEventListener("forge-lab-storage", notify); };
}
function readStore(key: string, fallback: string) {
  if (memoryStore.has(key)) return memoryStore.get(key)!;
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeStore(key: string, value: string) {
  memoryStore.set(key, value);
  let persisted = true;
  try { localStorage.setItem(key, value); } catch { persisted = false; }
  window.dispatchEvent(new Event("forge-lab-storage"));
  return persisted;
}
/** Clear both persistent and same-tab fallback caches after confirmed account deletion. */
export function resetPracticeStorage(userKey?: string) {
  const belongs = (key: string) => userKey === undefined ? key.startsWith("forge.lab.") : key.startsWith(`forge.lab.user.${encodeURIComponent(userKey)}.`) || key.startsWith("forge.lab.code.") || key === "forge.lab.completed" || key === "forge.lab.epoch";
  for (const key of memoryStore.keys()) if (belongs(key)) memoryStore.delete(key);
  let persisted = true;
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => !!key && belongs(key));
    for (const key of keys) localStorage.removeItem(key);
    localStorage.setItem(userKey === undefined ? "forge.lab.epoch" : `forge.lab.user.${encodeURIComponent(userKey)}.epoch`, crypto.randomUUID());
  } catch { persisted = false; }
  window.dispatchEvent(new CustomEvent("forge-lab-reset", { detail: userKey }));
  window.dispatchEvent(new Event("forge-lab-storage"));
  return persisted;
}
function completedIds(raw: string): string[] {
  try { const value: unknown = JSON.parse(raw); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && MISSIONS.some(m => m.id === id)) : []; } catch { return []; }
}

let sourcePromise: Promise<string> | undefined;
function workerSource() {
  if (!sourcePromise) sourcePromise = fetch("/python-worker.js", { credentials: "same-origin" }).then(async response => {
    if (!response.ok) throw new Error("The Python runner file could not be loaded. Please retry.");
    const text = await response.text();
    if (text.length > 100000 || !text.includes("loadPyodide")) throw new Error("The Python runner was unavailable. Please retry.");
    return text;
  }).catch(error => { sourcePromise = undefined; throw error; });
  return sourcePromise;
}

export function validateRunnerResult(value: unknown, count: number): value is { results: CaseResult[]; error: string | null } {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (!(data.error === null || (typeof data.error === "string" && data.error.length <= 2000))) return false;
  if (!Array.isArray(data.results) || (data.error === null && data.results.length !== count) || data.results.length > count) return false;
  return data.results.every(item => typeof item === "object" && item !== null &&
    isJsonValue(item.value) && (item.error === null || (typeof item.error === "string" && item.error.length <= 2000)) && typeof item.mutated === "boolean");
}

function safeScript(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c"); }

/** An opaque sandbox keeps learner code away from app cookies, storage, and authenticated APIs. */
function sandboxDocument(source: string, nonce: string) {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net/pyodide/v314.0.1/full/; worker-src blob:; connect-src https://cdn.jsdelivr.net/pyodide/v314.0.1/full/;"></head><body><script>
const nonce = ${safeScript(nonce)};
window.addEventListener('securitypolicyviolation', event => parent.postMessage({nonce, data:{type:'error', message:'Python runtime asset was blocked by the browser policy: ' + event.violatedDirective + ' (' + event.blockedURI + ').'}}, '*'));
const url = URL.createObjectURL(new Blob([${safeScript(source)}], {type:'text/javascript'}));
let worker;
let readyForwarded = false;
let resultForwarded = false;
try {
  worker = new Worker(url);
  worker.onmessage = event => {
    const data = event.data;
    if (!data || typeof data !== 'object' || resultForwarded) return;
    if (data.type === 'ready' && !readyForwarded) { readyForwarded = true; parent.postMessage({nonce, data}, '*'); }
    else if (data.type === 'error' || (data.type === 'result' && readyForwarded)) { resultForwarded = true; parent.postMessage({nonce, data}, '*'); }
  };
  worker.onerror = event => parent.postMessage({nonce, data:{type:'error', message:'The Python environment could not start. Check your connection and browser support, then retry.' + (event.message ? ' ' + String(event.message).slice(0,300) : '')}}, '*');
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.nonce !== nonce) return;
    if (event.data.type === 'stop') { worker.terminate(); URL.revokeObjectURL(url); }
    if (event.data.type === 'run') worker.postMessage(event.data.payload);
  });
} catch(error) { parent.postMessage({nonce, data:{type:'error', message:String(error).slice(0,500)}}, '*'); }
<\/script></body></html>`;
}

function passedCase(result: CaseResult | undefined, expected: JsonValue, mission: Mission) {
  return !!result && result.error === null && !(mission.preserveInput && result.mutated) && jsonEqual(result.value, expected);
}

export default function Practice(props: Props) { return <PracticeWorkspace key={props.userKey || "anonymous"} {...props}/>; }
function PracticeWorkspace({ onResult, initialMission, userKey = "anonymous" }: Props) {
  const storePrefix = `forge.lab.user.${encodeURIComponent(userKey)}.`;
  const [missionId, setMissionId] = useState(MISSIONS.some(m => m.id === initialMission) ? initialMission! : MISSIONS[0].id);
  const mission = MISSIONS.find(item => item.id === missionId)!;
  const storedCode = useSyncExternalStore(subscribeStore, () => readStore(`${storePrefix}code.${missionId}`, mission.starter), () => mission.starter);
  const code = storedCode.length <= 30000 ? storedCode : mission.starter;
  const completed = completedIds(useSyncExternalStore(subscribeStore, () => readStore(`${storePrefix}completed`, "[]"), () => "[]"));
  const [status, setStatus] = useState<Status>("idle");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hintCount, setHintCount] = useState(0);
  const [storageNotice, setStorageNotice] = useState(false);
  const [lastSample, setLastSample] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  const runSerial = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef(onResult); resultRef.current = onResult;

  useEffect(() => {
    const cancelRun = () => { runSerial.current++; cleanup.current?.(); cleanup.current = null; };
    const reset = (event?: Event) => { if (event instanceof CustomEvent && event.detail !== undefined && event.detail !== userKey) return; cancelRun(); setStatus("idle"); setFeedback(null); setHintCount(0); setStorageNotice(false); };
    const otherTab = (event: StorageEvent) => { if (event.key === null || event.key === "forge.lab.epoch" || event.key === `${storePrefix}epoch` || (event.key.startsWith(storePrefix) && event.newValue === null)) reset(); };
    window.addEventListener("forge-lab-reset", reset); window.addEventListener("storage", otherTab);
    return () => { cancelRun(); window.removeEventListener("forge-lab-reset", reset); window.removeEventListener("storage", otherTab); };
  }, [storePrefix, userKey]);

  const busy = status === "loading" || status === "running";
  const shownTests = feedback?.sample ? mission.tests.filter(test => test.sample) : mission.tests;
  const passed = feedback ? shownTests.filter((test, index) => passedCase(feedback.results[index], test.expected, mission)).length : 0;
  const allPassed = feedback && !feedback.error && !feedback.sample && passed === mission.tests.length;

  function updateCode(value: string) {
    setFeedback(null);
    if (!busy) setStatus("idle");
    if (!writeStore(`${storePrefix}code.${missionId}`, value)) setStorageNotice(true);
  }
  function selectMission(id: string) {
    runSerial.current++; cleanup.current?.(); cleanup.current = null;
    setMissionId(id); setStatus("idle"); setFeedback(null); setHintCount(0); setResetOpen(false);
  }
  function cancel() {
    runSerial.current++; cleanup.current?.(); cleanup.current = null;
    setStatus("idle"); setFeedback({ results: [], error: "Run stopped. Your code is saved here; edit it and try again whenever you are ready.", output: "", sample: lastSample });
  }

  async function run(sample: boolean) {
    if (busy) return;
    cleanup.current?.();
    const serial = ++runSerial.current;
    setStatus("loading"); setFeedback(null); setLastSample(sample);
    const tests = sample ? mission.tests.filter(test => test.sample) : mission.tests;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: HTMLIFrameElement | undefined;
    let listener: ((event: MessageEvent) => void) | undefined;
    let settled = false;
    let started = false;
    const nonce = crypto.randomUUID();
    const dispose = () => {
      settled = true;
      if (timer) clearTimeout(timer);
      if (listener) window.removeEventListener("message", listener);
      if (frame) { frame.contentWindow?.postMessage({ type: "stop", nonce }, "*"); frame.remove(); }
    };
    cleanup.current = dispose;
    const fail = (message: string, performance = false) => {
      if (serial !== runSerial.current || settled) return;
      dispose(); setStatus("error"); setFeedback({ results: [], error: message, output: "", sample });
      if (performance && !sample) resultRef.current?.({ missionId: mission.id, passed: 0, total: tests.length, category: "performance" });
    };
    timer = setTimeout(() => fail("Python took too long to load. Check your connection, then retry. Your code is still here."), 60000);
    try {
      const source = await workerSource();
      if (serial !== runSerial.current || settled) return;
      frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts"); frame.setAttribute("aria-hidden", "true"); frame.setAttribute("title", "Isolated Python execution"); frame.style.display = "none";
      listener = (event: MessageEvent) => {
        if (serial !== runSerial.current || settled || event.source !== frame?.contentWindow || event.data?.nonce !== nonce) return;
        const data = event.data.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "ready") {
          if (started) return;
          started = true;
          if (timer) clearTimeout(timer);
          setStatus("running");
          timer = setTimeout(() => fail("This run reached the 8-second limit. Check that each loop moves toward its stopping condition, then try again.", true), 8000);
          frame!.contentWindow!.postMessage({ type: "run", nonce, payload: { type: "run", code, functionName: mission.functionName, cases: tests.map(test => test.args) } }, "*");
        } else if (data.type === "error") {
          fail(typeof data.message === "string" ? data.message.slice(0, 1500) : "This run could not finish. Please try again.");
        } else if (data.type === "result") {
          if (!started) return;
          if (!validateRunnerResult(data.payload, tests.length)) { fail("The program returned an unexpected result format. Return a plain Python value matching the contract."); return; }
          const result: Feedback = { ...data.payload, output: typeof data.output === "string" ? data.output.slice(0, 4000) : "", sample };
          dispose(); setStatus(result.error ? "error" : "done"); setFeedback(result);
          if (!sample && result.error) {
            resultRef.current?.({ missionId: mission.id, passed: 0, total: tests.length, category: result.error.startsWith("Python paused near line") ? "syntax" : "logic" });
          }
          if (!sample && !result.error) {
            const passed = tests.filter((test, i) => passedCase(result.results[i], test.expected, mission)).length;
            const examplesPass = tests.every((test, i) => !test.sample || passedCase(result.results[i], test.expected, mission));
            resultRef.current?.({ missionId: mission.id, passed, total: tests.length, category: passed === tests.length ? "success" : examplesPass ? "edge-cases" : "logic" });
            if (passed === tests.length) {
              const next = [...new Set([...completedIds(readStore(`${storePrefix}completed`, "[]")), mission.id])];
              if (!writeStore(`${storePrefix}completed`, JSON.stringify(next))) setStorageNotice(true);
            }
          }
        }
      };
      window.addEventListener("message", listener);
      frame.srcdoc = sandboxDocument(source, nonce);
      document.body.appendChild(frame);
    } catch (error) { fail(error instanceof Error ? error.message : "The Python environment could not start. Please retry."); }
  }

  return <div className="lab-root">
    <style>{LAB_CSS}</style>
    <div className="lab-topbar">
      <div><span className="lab-eyebrow">BUILD. TEST. UNDERSTAND.</span><h2>From a blank file to a working idea.</h2><p>Real Python. Small product challenges. Room to think.</p></div>
      <div className="lab-completion"><span>{completed.length}<small> / {MISSIONS.length}</small></span><p>missions completed</p></div>
    </div>
    <div className="lab-layout">
      <aside className="lab-missions" aria-label="Practice missions">
        <div className="lab-aside-heading"><Code2 size={16} /><span>THE PRACTICE PATH</span></div>
        {MISSIONS.map(item => <button className={`lab-mission ${item.id === missionId ? "lab-mission-active" : ""}`} key={item.id} onClick={() => selectMission(item.id)} aria-current={item.id === missionId ? "step" : undefined}>
          <span className={`lab-mission-number ${completed.includes(item.id) ? "lab-mission-done" : ""}`}>{completed.includes(item.id) ? <Check size={14} /> : item.level}</span>
          <span><strong>{item.title}</strong><small>{item.category} · {item.minutes} min</small></span>
        </button>)}
        <div className="lab-note"><BookOpen size={16} /><p>Begin with mission 01. Already comfortable? You can explore any mission.</p></div>
      </aside>
      <section className="lab-workspace" aria-label="Selected practice mission">
        <div className="lab-brief">
          <div className="lab-tags"><span>MISSION {mission.level}</span><span>{mission.category}</span><span><Clock3 size={13} /> {mission.minutes} min</span></div>
          <h3>{mission.title}</h3><p>{mission.brief}</p>
          <div className="lab-contract"><strong>Your task</strong><p>{mission.contract}</p></div>
          <details className="lab-intuition"><summary><Lightbulb size={15} /> Connect it to the mathematics <ChevronDown size={14} /></summary><p>{mission.intuition}</p></details>
          <div className="lab-samples">{mission.tests.filter(test => test.sample).map((test, index) => <div key={index}><span>EXAMPLE {index + 1}</span><code>{mission.functionName}({test.args.map(arg => JSON.stringify(arg)).join(", ")})</code><strong>→ {JSON.stringify(test.expected)}</strong></div>)}</div>
        </div>
        <div className="lab-editor-shell">
          <div className="lab-editor-heading"><span><span className="lab-python-dot" /> solution.py</span><span>Python 3.14 <span className="lab-editor-local">· local execution</span></span></div>
          <div className="lab-editor">
            <div ref={lineRef} className="lab-line-numbers" aria-hidden="true">{code.split("\n").map((_, i) => <div key={i}>{i + 1}</div>)}</div>
            <textarea ref={editorRef} aria-label="Python code editor" readOnly={busy} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={code} maxLength={30000} onChange={event => updateCode(event.target.value)} onScroll={event => { if (lineRef.current) lineRef.current.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void run(false); }
            }} />
          </div>
          <div className="lab-editor-footer"><span>Return a value from <code>{mission.functionName}</code> · Ctrl / ⌘ Enter to check</span><button className="lab-text-button" onClick={() => setResetOpen(!resetOpen)} disabled={busy}><RotateCcw size={13} /> Reset code</button></div>
          {resetOpen && <div className="lab-reset-confirm"><span>Replace this mission’s code with its starter?</span><button onClick={() => { updateCode(mission.starter); setFeedback(null); setStatus("idle"); setResetOpen(false); }}>Reset</button><button onClick={() => setResetOpen(false)}>Keep my code</button></div>}
        </div>
        <div className="lab-actions"><div><button className="lab-secondary" onClick={() => void run(true)} aria-disabled={busy}><Play size={15} /> Run examples</button><button className="lab-primary" onClick={() => void run(false)} aria-disabled={busy}>{busy ? <Loader2 size={16} className="lab-spin" /> : <CheckCircle2 size={16} />}{status === "loading" ? "Loading Python…" : status === "running" ? "Checking…" : "Check solution"}</button>{busy && <button className="lab-stop" onClick={cancel}><Square size={13} /> Stop</button>}</div><button className="lab-text-button" onClick={() => setHintCount(value => Math.min(value + 1, mission.hints.length))} disabled={hintCount >= mission.hints.length}><Lightbulb size={16} /> {hintCount === 0 ? "A small nudge" : hintCount < mission.hints.length ? "Another nudge" : "All hints shown"}</button></div>
        {busy && <p className="lab-runtime-message" role="status">{status === "loading" ? "Preparing an isolated Python workspace. The first run downloads the runtime and may take up to a minute." : "Running your function against the selected cases. This run stops automatically after 8 seconds."}</p>}
        {hintCount > 0 && <div className="lab-hints">{mission.hints.slice(0, hintCount).map((hint, index) => <p key={hint}><span>{index + 1}</span>{hint}</p>)}</div>}
        {feedback && <section className="lab-feedback" aria-live="polite" aria-label="Code feedback">
          <div className="lab-feedback-title"><Terminal size={17} /><strong>{feedback.error ? "Let’s adjust one thing" : `${passed} / ${shownTests.length} ${feedback.sample ? "examples" : "checks"} passed`}</strong>{allPassed && <span className="lab-pass-badge"><Check size={13} /> Mission complete</span>}</div>
          {feedback.error ? <div className="lab-error"><p>{feedback.error}</p><button className="lab-secondary" onClick={() => void run(lastSample)}>Try again</button></div> : <>
            <p className="lab-feedback-summary">{allPassed ? "Your function meets every checked case. Now make the reasoning your own." : feedback.sample && passed === shownTests.length ? "The examples work. Check your solution against the full set of cases next." : "Compare the expected result with yours. Find one small input that explains the difference."}</p>
            <div className="lab-test-list">{shownTests.map((test, index) => {
              const result = feedback.results[index]; const pass = passedCase(result, test.expected, mission);
              return <details className={pass ? "lab-case lab-case-pass" : "lab-case"} key={index}><summary>{pass ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<span>{test.label}</span><small>{pass ? "Passed" : "Explore"}</small><ChevronDown size={14} /></summary><div><p><b>Input</b> <code>{test.args.map(arg => JSON.stringify(arg)).join(", ")}</code></p><p><b>Expected</b> <code>{JSON.stringify(test.expected)}</code></p><p><b>Your result</b> <code>{result?.error || (mission.preserveInput && result?.mutated ? "The input was modified; return a new list instead." : JSON.stringify(result?.value))}</code></p></div></details>;
            })}</div>
            {allPassed && <div className="lab-next"><p>{mission.next}</p>{MISSIONS.findIndex(item => item.id === missionId) < MISSIONS.length - 1 && <button onClick={() => selectMission(MISSIONS[MISSIONS.findIndex(item => item.id === missionId) + 1].id)}>Next mission <ArrowRight size={16} /></button>}</div>}
          </>}
          {feedback.output && <details className="lab-output"><summary>Console output</summary><pre>{feedback.output}</pre></details>}
        </section>}
        <div className="lab-resource"><a href={mission.resource.url} target="_blank" rel="noopener noreferrer"><BookOpen size={15} /> {mission.resource.label} <ArrowRight size={13} /></a><span>Original exercises · practice feedback, not a certified grade</span></div>
        <p className="lab-privacy">Code runs in your browser in an isolated worker; a fresh workspace is created for every run. Drafts and completed missions are saved on this device. First-run runtime download requires internet. Test checks verify outputs; complexity requirements need your own reasoning.</p>
        {storageNotice && <p className="lab-storage-notice" role="status">Browser storage is unavailable. You can keep practicing, but copy your code before closing this page.</p>}
      </section>
    </div>
  </div>;
}

const LAB_CSS = `
.lab-root{--lab-bg:#0B1020;--lab-panel:#121A2D;--lab-line:#2B3650;--lab-text:#F5F3EB;--lab-muted:#A6AFC1;--lab-accent:#FF6478;--lab-success:#91DDCF;--lab-primary:#D82745;color:var(--lab-text);font-family:inherit}
.lab-root button,.lab-root textarea{font:inherit}
.lab-root button{cursor:pointer}
.lab-root button:disabled,.lab-root button[aria-disabled="true"]{cursor:not-allowed;opacity:.55}
.lab-root button:focus-visible,.lab-root a:focus-visible,.lab-root summary:focus-visible{outline:2px solid var(--lab-accent);outline-offset:4px}
.lab-root p{line-height:1.65}
.lab-topbar{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:30px}
.lab-eyebrow{color:var(--lab-accent);font-size:10px;letter-spacing:2px;font-weight:700}
.lab-topbar h2{font-size:clamp(22px,2.5vw,34px);font-weight:500;letter-spacing:-1px;margin:12px 0 8px}
.lab-topbar p{margin:0;color:var(--lab-muted);font-size:14px}
.lab-completion{min-width:130px;text-align:right}
.lab-completion>span{font-size:36px;font-weight:500;color:var(--lab-success)}
.lab-completion small{font-size:20px;color:var(--lab-muted)}
.lab-completion p{font-size:11px}
.lab-layout{display:grid;grid-template-columns:265px minmax(0,1fr);border:1px solid var(--lab-line);border-radius:16px;overflow:hidden;background:var(--lab-bg)}
.lab-missions{border-right:1px solid var(--lab-line);padding:22px 12px;background:#121A2D}
.lab-aside-heading{display:flex;align-items:center;gap:8px;padding:0 10px 20px;color:var(--lab-muted);font-size:10px;letter-spacing:1.7px}
.lab-mission{width:100%;border:1px solid transparent;background:transparent;border-radius:8px;padding:13px 9px;display:flex;gap:11px;text-align:left;color:var(--lab-muted);margin-bottom:4px}
.lab-mission:hover{background:#19243A}
.lab-mission-active{background:rgba(255,100,120,.08)!important;border-color:rgba(255,100,120,.4);color:var(--lab-text)}
.lab-mission-number{flex-shrink:0;width:27px;height:27px;border:1px solid #2B3650;border-radius:7px;display:grid;place-items:center;font:11px monospace;color:#A6AFC1}
.lab-mission-active .lab-mission-number{background:var(--lab-primary);color:#FFFFFF;border-color:var(--lab-primary)}
.lab-mission-done{background:rgba(145,221,207,.08);color:var(--lab-success);border-color:rgba(145,221,207,.35)}
.lab-mission strong{display:block;font-size:12px;font-weight:500;line-height:1.4}
.lab-mission small{display:block;color:var(--lab-muted);font-size:10px;margin-top:5px}
.lab-note{display:flex;align-items:flex-start;gap:9px;margin:22px 8px;color:var(--lab-muted);font-size:11px}
.lab-note svg{flex-shrink:0;margin-top:3px}
.lab-note p{margin:0}
.lab-workspace{min-width:0;padding:28px}
.lab-tags{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:10px}
.lab-tags>span{display:flex;align-items:center;gap:5px;border:1px solid #2B3650;padding:5px 8px;border-radius:4px;color:#A99BFF}
.lab-tags>span:first-child{letter-spacing:1px;color:var(--lab-accent);border-color:#2B3650;background:#19243A}
.lab-brief h3{font-size:27px;font-weight:500;letter-spacing:-.6px;margin:20px 0 10px}
.lab-brief>p{font-size:13px;color:#A6AFC1;margin-bottom:19px}
.lab-contract{padding:15px 18px;background:#19243A;border-radius:8px;border-left:2px solid #FF6478}
.lab-contract strong{font-size:12px;color:#F5F3EB}
.lab-contract p{font-size:12px;color:#A6AFC1;margin:6px 0 0}
.lab-intuition{margin:15px 0;font-size:12px;color:var(--lab-muted)}
.lab-intuition summary{display:flex;align-items:center;gap:7px;cursor:pointer;list-style:none}
.lab-intuition p{padding:0 21px;color:#A6AFC1}
.lab-samples{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}
.lab-samples>div{min-width:0;background:#121A2D;border:1px solid var(--lab-line);padding:12px 14px;border-radius:7px}
.lab-samples span{display:block;font-size:9px;color:var(--lab-muted);letter-spacing:1px;margin-bottom:10px}
.lab-samples code{display:block;overflow-wrap:anywhere;font:11px/1.6 ui-monospace,monospace;color:#F5F3EB}
.lab-samples strong{font:12px/1.6 ui-monospace,monospace;color:var(--lab-success);display:block;margin-top:5px}
.lab-editor-shell{border:1px solid #2B3650;border-radius:10px;overflow:hidden;background:#0B1020}
.lab-editor-heading{display:flex;justify-content:space-between;gap:8px;align-items:center;border-bottom:1px solid var(--lab-line);padding:12px 16px;font:11px ui-monospace,monospace;color:#A6AFC1;background:#19243A}
.lab-editor-heading>span{display:flex;align-items:center;gap:7px}
.lab-python-dot{width:6px;height:6px;border-radius:50%;background:#FF6478}
.lab-editor-local{color:#A6AFC1}
.lab-editor{display:flex;height:290px;overflow:hidden}
.lab-line-numbers{padding:18px 10px 18px 16px;min-width:45px;color:#A6AFC1;font:13px/23px ui-monospace,monospace;overflow:hidden;text-align:right;user-select:none}
.lab-editor textarea{display:block;width:100%;height:100%;resize:vertical;background:transparent;color:#F5F3EB;border:0;padding:18px 15px 18px 8px;font:13px/23px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre;tab-size:4;outline-offset:-2px;min-height:220px;border-radius:0}
.lab-editor textarea:focus{outline:1px solid #FF6478}
.lab-editor-footer{padding:10px 14px;display:flex;gap:10px;justify-content:space-between;align-items:center;border-top:1px solid var(--lab-line);color:#A6AFC1;font-size:10px}
.lab-editor-footer code{color:#A6AFC1}
.lab-text-button{background:none;border:0;padding:4px;color:#A99BFF;display:inline-flex;align-items:center;gap:6px;font-size:11px!important;white-space:nowrap}
.lab-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:17px 0}
.lab-actions>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lab-primary,.lab-secondary,.lab-stop{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:7px;padding:11px 15px;font-size:12px!important;font-weight:600!important}
.lab-primary{background:var(--lab-primary);color:#FFFFFF;border:1px solid var(--lab-primary)}
.lab-primary:hover{background:#C51F3B;border-color:#C51F3B}
.lab-secondary{background:#19243A;border:1px solid #2B3650;color:#F5F3EB}
.lab-secondary:hover{background:#19243A}
.lab-stop{background:transparent;border:1px solid rgba(255,180,190,.4);color:#FFB4BE}
.lab-runtime-message{font-size:12px;color:#A6AFC1;padding:12px 14px;border:1px solid #2B3650;border-radius:7px;background:#121A2D}
.lab-hints{background:rgba(169,155,255,.08);border:1px solid rgba(169,155,255,.4);border-radius:8px;padding:9px 15px;margin:15px 0}
.lab-hints p{display:flex;gap:11px;align-items:flex-start;color:#A6AFC1;font-size:12px}
.lab-hints span{flex-shrink:0;width:20px;height:20px;border:1px solid rgba(169,155,255,.4);border-radius:50%;text-align:center;color:#A99BFF;font-size:10px;line-height:18px}
.lab-feedback{margin-top:20px;border:1px solid var(--lab-line);border-radius:10px;overflow:hidden}
.lab-feedback-title{display:flex;gap:9px;align-items:center;padding:14px 17px;border-bottom:1px solid var(--lab-line);background:#19243A;color:#F5F3EB;font-size:12px}
.lab-feedback-title strong{font-weight:500}
.lab-pass-badge{margin-left:auto;font-size:9px;background:rgba(145,221,207,.08);padding:5px 8px;border-radius:4px;display:flex;gap:4px;align-items:center;color:var(--lab-success)}
.lab-feedback-summary{font-size:12px;color:#A6AFC1;margin:14px 17px}
.lab-error{padding:15px 17px;color:#FFB4BE;font-size:12px}
.lab-error p{white-space:pre-wrap}
.lab-test-list{padding:0 13px 13px}
.lab-case{border:1px solid rgba(255,180,190,.4);border-radius:6px;margin-top:6px;overflow:hidden}
.lab-case summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;padding:10px;color:#FFB4BE;font-size:11px}
.lab-case summary span{flex:1}
.lab-case summary small{color:#FFB4BE;font-size:10px}
.lab-case-pass{border-color:rgba(145,221,207,.35)}
.lab-case-pass summary{color:var(--lab-success)}
.lab-case-pass summary small{color:var(--lab-success)}
.lab-case>div{padding:0 12px 10px;font-size:11px;color:#A6AFC1}
.lab-case p{margin:6px 0;overflow-wrap:anywhere}
.lab-case b{font-weight:500;color:#A6AFC1;display:inline-block;min-width:80px}
.lab-case code{font-size:10px}
.lab-next{padding:14px 17px;border-top:1px solid var(--lab-line);background:rgba(145,221,207,.08)}
.lab-next p{margin:0 0 10px;color:#A6AFC1;font-size:12px}
.lab-next button{background:none;border:0;display:flex;align-items:center;gap:7px;color:var(--lab-accent);font-size:12px;padding:0}
.lab-output{padding:14px 17px;border-top:1px solid var(--lab-line);font-size:12px;color:#A6AFC1}
.lab-output summary{cursor:pointer}
.lab-output pre{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}
.lab-resource{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-top:22px;font-size:10px}
.lab-resource a{display:flex;align-items:center;gap:6px;color:#A99BFF;text-decoration:none}
.lab-resource>span{color:#A6AFC1}
.lab-privacy{font-size:10px;color:#A6AFC1;margin:14px 0 0}
.lab-storage-notice{padding:10px;border:1px solid rgba(255,180,190,.4);border-radius:6px;font-size:11px;color:#FFB4BE}
.lab-reset-confirm{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 15px;border-top:1px solid var(--lab-line);font-size:11px;color:#F5F3EB}
.lab-reset-confirm button{border:1px solid #2B3650;background:#19243A;color:#F5F3EB;border-radius:4px;padding:5px 8px;font-size:10px}
.lab-spin{animation:lab-spin 1s linear infinite}
@keyframes lab-spin{to{transform:rotate(360deg)}}
.lab-root{color-scheme:dark;--lab-violet:#A99BFF;--lab-danger:#FFB4BE}
.lab-topbar{color:var(--lab-text)}
.lab-topbar h2{font-weight:700}
.lab-layout{box-shadow:0 16px 48px rgba(11,16,32,.24)}
.lab-mission,.lab-primary,.lab-secondary,.lab-stop,.lab-text-button{transition:background .16s ease,border-color .16s ease,color .16s ease}
.lab-mission-active{box-shadow:inset 3px 0 0 var(--lab-accent)}
.lab-mission strong{font-weight:600}
.lab-mission-done{color:var(--lab-success)}
.lab-tags>span:first-child{background:rgba(255,100,120,.08);border-color:rgba(255,100,120,.35)}
.lab-contract{background:var(--lab-panel)}
.lab-contract strong{color:var(--lab-text)}
.lab-intuition summary{color:var(--lab-violet)}
.lab-editor-heading,.lab-editor-footer{background:var(--lab-panel)}
.lab-editor textarea{caret-color:var(--lab-accent);font-size:14px;line-height:24px}
.lab-line-numbers{font-size:12px;line-height:24px;background:var(--lab-bg);border-right:1px solid var(--lab-line)}
.lab-editor textarea::selection{background:rgba(169,155,255,.3);color:var(--lab-text)}
.lab-editor textarea:disabled,.lab-editor textarea:read-only{opacity:.75}
.lab-primary{box-shadow:0 3px 14px rgba(255,100,120,.1)}
.lab-primary:hover:not(:disabled):not([aria-disabled="true"]){background:#C51F3B;border-color:#C51F3B}
.lab-secondary:hover:not(:disabled):not([aria-disabled="true"]){border-color:var(--lab-violet)}
.lab-stop:hover:not(:disabled){background:rgba(255,180,190,.08)}
.lab-text-button:hover:not(:disabled),.lab-resource a:hover{color:var(--lab-text)}
.lab-runtime-message{color:var(--lab-muted)}
.lab-feedback-title{color:var(--lab-text)}
.lab-error{background:rgba(255,180,190,.04);color:var(--lab-danger)}
.lab-error p{color:inherit}
.lab-case>div{background:var(--lab-panel)}
.lab-case p,.lab-output pre{color:var(--lab-text)}
.lab-case code{font-size:11px}
.lab-case summary:hover{background:rgba(255,180,190,.04)}
.lab-case-pass summary:hover{background:rgba(145,221,207,.04)}
.lab-case-pass summary small{color:var(--lab-success)}
.lab-pass-badge{border:1px solid rgba(145,221,207,.3)}
.lab-next p{color:var(--lab-text)}
.lab-storage-notice{background:rgba(255,180,190,.06)}
.lab-reset-confirm{background:var(--lab-panel)}
.lab-reset-confirm button:hover{border-color:var(--lab-violet)}
@media(prefers-reduced-motion:reduce){.lab-root button{transition:none}}
@media(max-width:1000px){.lab-layout{grid-template-columns:220px minmax(0,1fr)}
.lab-workspace{padding:20px}
.lab-mission strong{font-size:11px}
.lab-actions{flex-wrap:wrap}
.lab-resource{align-items:flex-start;flex-direction:column}}
@media(max-width:700px){.lab-layout{grid-template-columns:1fr}
.lab-missions{border-right:0;border-bottom:1px solid var(--lab-line);display:flex;overflow-x:auto;gap:8px;padding:12px}
.lab-mission{min-width:200px;margin:0;padding:9px;align-items:center}
.lab-missions .lab-aside-heading,.lab-missions .lab-note{display:none}
.lab-topbar{align-items:flex-start}
.lab-topbar h2{font-size:25px}
.lab-completion{min-width:80px}
.lab-completion>span{font-size:28px}
.lab-completion p{font-size:9px}
.lab-workspace{padding:18px}
.lab-brief h3{font-size:24px}
.lab-samples{grid-template-columns:1fr}
.lab-editor-local{display:none}
.lab-editor-footer>span{font-size:9px}
.lab-editor-footer{align-items:flex-start}
.lab-primary,.lab-secondary,.lab-stop{padding:10px 12px}
.lab-actions{gap:8px}
.lab-feedback-title{flex-wrap:wrap}
.lab-pass-badge{margin-left:0}
.lab-privacy{font-size:10px}}
@media(prefers-reduced-motion:reduce){.lab-spin{animation:none}}`;
