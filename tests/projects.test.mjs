import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const filesUrl = moduleUrl(read("../lib/project-files.ts"));
const files = await import(filesUrl);
const store = await import(moduleUrl(read("../lib/draft-store.ts").replace('"./project-files"', JSON.stringify(filesUrl))));
const { createProject, validateFiles, validateFilePath, createProjectZip, crc32, normalizeSavedProject, projectContentEqual, withFiles } = files;
class FakeStorage {
  data = new Map(); failWrites = false; failReads = false;
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { if(this.failReads) throw new Error("blocked"); return this.data.get(key) ?? null; }
  setItem(key, value) { if(this.failWrites) throw new Error("quota"); this.data.set(key, value); }
  removeItem(key) { if(this.failWrites) throw new Error("blocked"); this.data.delete(key); }
}
globalThis.localStorage = new FakeStorage();
globalThis.window = new EventTarget();
const project = id => createProject("study-tracker", id);
const editTitle = (p, title) => ({...p, title});
const scope = label => `${label}-${crypto.randomUUID()}`;
const parsed = user => store.parseProjectDraftSnapshot(store.readProjectDraftSnapshot(user));

test("each project starter has editable source, tests, README, and gitignore", () => {
  for(const template of files.PROJECT_TEMPLATES) {
    const p = createProject(template.id);
    assert.equal(validateFiles(p.files), null);
    assert.deepEqual(p.files.map(f=>f.path), ["main.py","test_main.py","README.md",".gitignore"]);
    assert.equal(p.files.find(f=>f.path === "main.py").content, p.code);
    assert.equal(files.validProjectDocument(p), true);
  }
  assert.notEqual(createProject("study-tracker").id, createProject("study-tracker").id);
});

test("renaming preserves contents and supports nested paths and capitalization", () => {
  const original = project("rename");
  const renamed = files.renameProjectFile(original, "test_main.py", "tests/test_tracker.py");
  assert.equal(renamed.files.find(file => file.path === "tests/test_tracker.py").content, original.files.find(file => file.path === "test_main.py").content);
  assert.ok(original.files.some(file => file.path === "test_main.py"));
  assert.equal(renamed.code, original.code);
  const capitalized = files.renameProjectFile(original, "README.md", "readme.md");
  assert.ok(capitalized.files.some(file => file.path === "readme.md"));
});

test("renaming rejects entry-point changes, collisions, hierarchy conflicts and unsafe paths atomically", () => {
  const original = project("rename-invalid");
  const before = structuredClone(original);
  for (const [from, to] of [["main.py", "app.py"], ["missing.py", "x.py"], ["README.md", "TEST_MAIN.py"], ["README.md", "main.py/readme.txt"], ["README.md", "../readme.txt"], ["README.md", ".env"]]) {
    assert.throws(() => files.renameProjectFile(original, from, to));
    assert.deepEqual(original, before);
  }
  const recoverable = withFiles(original, [...original.files, { path: "README.md/child.py", content: "recover me" }]);
  const repaired = files.renameProjectFile(recoverable, "README.md", "GUIDE.md");
  assert.equal(files.validateFileHierarchy(repaired.files), null);
  assert.equal(repaired.files.find(file => file.path === "README.md/child.py").content, "recover me");
});

test("legacy projects keep the original Python code when upgrading the manifest", () => {
  const legacy={...project("graph-toolkit"),files:undefined,templateId:undefined};
  const normalized=normalizeSavedProject({...legacy,code:"# my existing work\n"});
  assert.equal(normalized.templateId,"graph-toolkit");
  assert.equal(normalized.files.find(f=>f.path === "main.py").content,"# my existing work\n");
  assert.equal(normalized.code,"# my existing work\n");
});

test("file edits maintain the legacy entry point and comparisons are path-aware", () => {
  const a=project("sync"); const b=withFiles(a,a.files.map(f=>f.path === "main.py"?{...f,content:"print(42)"}:f));
  assert.equal(b.code,"print(42)"); assert.equal(projectContentEqual(a,b),false);
  assert.equal(projectContentEqual(b,{...b,files:[...b.files].reverse()}),true);
});

test("manifest rejects unsafe paths and credential/workflow paths", () => {
  for(const path of ["/main.py","../main.py","a/../x","a//x","a/./x","a\\x","x/",".git/config","folder/.GIT/index",".github/anything.yml","x/.github/a",".env","secrets/.env.local",".ENV.production","hello world.py","é.py"]) {
    assert.notEqual(validateFilePath(path),null,path);
  }
  for(const path of ["main.py","src/utils.py",".gitignore","tests/test_math.py","README.md"]) assert.equal(validateFilePath(path),null,path);
  assert.equal(validateFilePath(".github/workflows/test.yml",true),null);
  assert.notEqual(validateFilePath(".github/other.yml",true),null);
});

test("manifest bounds count UTF-8 bytes and reject case-insensitive duplicates", () => {
  assert.equal(validateFiles([{path:"main.py",content:"é".repeat(20000)}]),null);
  assert.match(validateFiles([{path:"main.py",content:"é".repeat(20001)}]),/40,000/);
  assert.match(validateFiles([{path:"main.py",content:""},{path:"MAIN.py",content:""}]),/unique/);
  assert.match(validateFiles([{path:"test.py",content:""}]),/main.py/);
  assert.match(validateFiles(Array.from({length:13},(_,i)=>({path:i?`file${i}.py`:"main.py",content:""}))),/1–12/);
  const big=Array.from({length:4},(_,i)=>({path:i?`f${i}.py`:"main.py",content:"x".repeat(40000)}));
  assert.equal(validateFiles(big),null);
  assert.match(validateFiles([...big,{path:"extra.txt",content:"x"}]),/160,000/);
});

test("ZIP exports preserve directories and Unicode and can be read by standard Python", () => {
  const p=project("zip"); const entries=[...p.files,{path:"src/note.txt",content:"mathematics → code\nதமிழ்"},{path:".github/workflows/test.yml",content:files.WORKFLOW_STARTER}];
  const bytes=createProjectZip(entries);
  const result=spawnSync("python3",["-c",`import sys,zipfile,io,json\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.testzip() is None\nprint(json.dumps({n:z.read(n).decode('utf-8') for n in z.namelist()}))`],{input:bytes,encoding:"utf8"});
  assert.equal(result.status,0,result.stderr); assert.deepEqual(JSON.parse(result.stdout),Object.fromEntries(entries.map(f=>[f.path,f.content])));
  assert.equal(crc32(new TextEncoder().encode("123456789")),0xcbf43926);
  assert.throws(()=>createProjectZip([{path:"../escape.txt",content:"x"}]),/parent|relative/);
});

test("file-folder collisions are rejected before creating an unextractable ZIP", () => {
  for (const paths of [["src", "src/utils.py"], ["src/utils.py", "src"], ["Src", "src/utils.py"], ["a/b", "a/b/c.py"]]) {
    const entries = paths.map(path => ({ path, content: "" }));
    assert.match(files.validateFileHierarchy(entries), /already a file/);
    assert.throws(() => createProjectZip(entries), /already a file/);
  }
  const valid = [{ path: "src/utils.py", content: "" }, { path: "src/tests/math.py", content: "" }, { path: "src.py", content: "" }];
  assert.equal(files.validateFileHierarchy(valid), null);
  assert.doesNotThrow(() => createProjectZip(valid));
});

test("previously stored colliding paths remain recoverable so learners can fix or remove them", () => {
  const user = scope("legacy-hierarchy");
  const existing = withFiles(project("legacy-hierarchy"), [{ path: "main.py", content: "print(42)" }, { path: "src", content: "keep my notes" }, { path: "src/utils.py", content: "value = 42" }]);
  store.saveProjectDraft(user, existing);
  assert.deepEqual(store.readProjectDraft(user, existing.id).project.files, existing.files);
  assert.equal(files.validProjectDocument(existing), true);
});

test("account-scoped recovery preserves independent project instances", () => {
  const alice=scope("alice"), bob=scope("bob"); const one=project("one"),two=project("two");
  store.saveProjectDraft(alice,one);store.saveProjectDraft(alice,two);store.saveProjectDraft(bob,editTitle(one,"Bob"));
  assert.equal(parsed(alice).length,2);assert.equal(parsed(bob).length,1);
  assert.equal(store.readProjectDraft(alice,"one").project.title,one.title);
  assert.equal(store.readProjectDraft(bob,"one").project.title,"Bob");
  const snapshot=store.readProjectDraftSnapshot(alice); assert.equal(snapshot,store.readProjectDraftSnapshot(alice));
});

test("late save acknowledgements preserve newer edits and keep them dirty", () => {
  const user=scope("race");const a=store.saveProjectDraft(user,project("race"),"cloud-v1").record;
  const b=store.saveProjectDraft(user,editTitle(a.project,"I edited while saving"),"cloud-v1").record;
  const result=store.markProjectDraftSaved(user,a.project.id,a.revision,a.epoch);
  const current=store.readProjectDraft(user,"race");
  assert.equal(result.newerEdits,true);assert.equal(current.project.title,b.project.title);
  assert.equal(current.revision,b.revision);assert.notEqual(current.revision,current.savedRevision);
  assert.equal(store.resolveProjectDraft(a.project,"cloud-v2",current).title,b.project.title);
});

test("save completion cleans only the submitted revision", () => {
  const user=scope("clean");const a=store.saveProjectDraft(user,project("clean")).record;
  store.markProjectDraftSaved(user,a.project.id,a.revision,a.epoch);
  const current=store.readProjectDraft(user,"clean");assert.equal(current.revision,current.savedRevision);
  const b=store.saveProjectDraft(user,editTitle(a.project,"new revision"),"newbase").record;
  store.markProjectDraftSaved(user,b.project.id,b.revision,b.epoch);
  store.markProjectDraftSaved(user,a.project.id,a.revision,a.epoch);
  assert.equal(store.readProjectDraft(user,"clean").savedRevision,b.revision,"older ack must not dirty a later acknowledged revision");
});

test("remote changes refresh clean drafts while dirty drafts survive conflicts", () => {
  const user=scope("remote");const a=store.saveProjectDraft(user,project("remote"),"cloud-v1").record;
  store.markProjectDraftSaved(user,a.project.id,a.revision,a.epoch);
  const clean=store.readProjectDraft(user,"remote");const remote=editTitle(a.project,"Other device");
  assert.equal(store.resolveProjectDraft(remote,"cloud-v2",clean).title,"Other device");
  assert.equal(store.resolveProjectDraft(remote,"cloud-v1",clean).title,a.project.title,"old props cannot overwrite acknowledged local snapshot");
  const dirty=store.saveProjectDraft(user,editTitle(remote,"My latest edit"),"cloud-v2").record;
  assert.equal(dirty.baseUpdatedAt,"cloud-v2");
  assert.equal(store.resolveProjectDraft(remote,"cloud-v3",dirty).title,"My latest edit");
});

test("data deletion clears persisted and fallback drafts and blocks stale callbacks", () => {
  const user=scope("delete"),other=scope("keep");const a=store.saveProjectDraft(user,project("deleted")).record;store.saveProjectDraft(other,project("keep"));
  assert.equal(store.clearProjectDrafts(user),true);assert.equal(parsed(user).length,0);assert.equal(parsed(other).length,1);
  assert.equal(store.markProjectDraftSaved(user,a.project.id,a.revision,a.epoch).applied,false);
  assert.equal(store.saveProjectDraft(user,a.project,null,a.epoch).deleted,true);assert.equal(parsed(user).length,0);
});

test("quota failure retains a volatile draft and reports it for unload protection", () => {
  const user=scope("quota");localStorage.failWrites=true;
  try { const result=store.saveProjectDraft(user,project("volatile"));assert.equal(result.persisted,false);assert.equal(store.hasVolatileProjectDrafts(user),true);assert.equal(parsed(user).length,1);store.clearProjectDrafts(user);assert.equal(parsed(user).length,0); }
  finally {localStorage.failWrites=false;}
});

test("draft subscriptions are scoped and unsubscribe cleanly", () => {
  const user=scope("events"),other=scope("events-other");let count=0;const off=store.subscribeProjectDrafts(user,()=>count++);
  store.saveProjectDraft(other,project("other"));assert.equal(count,0);
  store.saveProjectDraft(user,project("mine"));assert.equal(count,1);off();store.saveProjectDraft(user,project("mine"));assert.equal(count,1);
});

test("malformed drafts and out-of-epoch records are ignored", () => {
  assert.deepEqual(store.parseProjectDraftSnapshot("not-json"),[]);assert.deepEqual(store.parseProjectDraftSnapshot('[{"version":1}]'),[]);
  const user=scope("corrupt");localStorage.setItem(`forge.projects.v2.${encodeURIComponent(user)}.bad`,"<script>");assert.deepEqual(parsed(user),[]);
  const a=store.saveProjectDraft(user,project("expired")).record;store.clearProjectDrafts(user);
  localStorage.setItem(`forge.projects.v2.${encodeURIComponent(user)}.expired`,JSON.stringify(a));assert.deepEqual(parsed(user),[]);
});

test("local project limits do not prevent editing existing projects", () => {
  const user=scope("limit");for(let i=0;i<20;i++)store.saveProjectDraft(user,project(`p${i}`));
  assert.throws(()=>store.saveProjectDraft(user,project("overflow")),/20/);
  store.saveProjectDraft(user,editTitle(project("p0"),"Still editable"));assert.equal(parsed(user).length,20);
  assert.equal(store.removeProjectDraft(user,"p1"),true);assert.equal(parsed(user).length,19);store.saveProjectDraft(user,project("replacement"));assert.equal(parsed(user).length,20);
});


test("another tab cannot replace a volatile local draft, while deletion epochs still clear it", () => {
  const user=scope("volatile-tab");const key=`forge.projects.v2.${encodeURIComponent(user)}.mine`;const off=store.subscribeProjectDrafts(user,()=>{});
  let original;
  localStorage.failWrites=true;
  try {original=store.saveProjectDraft(user,editTitle(project("mine"),"Unsaved local work")).record;} finally {localStorage.failWrites=false;}
  const external={...original,project:editTitle(original.project,"Other tab"),revision:crypto.randomUUID()};
  localStorage.setItem(key,JSON.stringify(external));
  window.dispatchEvent(Object.assign(new Event("storage"),{key,newValue:JSON.stringify(external)}));
  assert.equal(store.readProjectDraft(user,"mine").project.title,"Unsaved local work");
  const resetKey=`forge.projects.v2.${encodeURIComponent(user)}.$epoch`;localStorage.setItem(resetKey,"reset-in-other-tab");
  window.dispatchEvent(Object.assign(new Event("storage"),{key:resetKey,newValue:"reset-in-other-tab"}));
  assert.deepEqual(parsed(user),[]);off();
});

for (const template of files.PROJECT_TEMPLATES) {
  test(`exported ${template.id} starter passes its included Python tests`, () => {
    const entries=createProject(template.id).files;
    const script=`import json,sys,tempfile,pathlib,subprocess\nfiles=json.load(sys.stdin)\nwith tempfile.TemporaryDirectory() as tmp:\n for f in files:\n  p=pathlib.Path(tmp)/f['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_text(f['content'])\n result=subprocess.run([sys.executable,'-m','unittest','discover','-v'],cwd=tmp,capture_output=True,text=True)\n print(result.stdout);print(result.stderr,file=sys.stderr);sys.exit(result.returncode)\n`;
    const result=spawnSync("python3",["-c",script],{input:JSON.stringify(entries),encoding:"utf8",timeout:10000});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stderr,/OK/);
  });
}
