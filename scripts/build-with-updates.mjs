import {readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readAppRelease,stampAppVersion,writeAppVersion} from './app-release.mjs';
import {stageResourceExplorer,stageRootOfflineWorker} from './stage-resource-explorer.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const release=await readAppRelease(root,{project:'forge-learning-academy',sourcePaths:[
  'index.html','src','app','lib','resources','offline-resources-worker.js','vite.config.ts','package.json','package-lock.json',
  'public/privacy.html','public/favicon.svg','public/curriculum.json','public/curriculum-guide.html','public/local-workspace.json','public/_headers','public/python-worker.js',
  'scripts/build-with-updates.mjs','scripts/stage-python-runtime.mjs','scripts/python-runtime-manifest.json','scripts/app-release.mjs','scripts/app-update-protocol.mjs','scripts/stage-resource-explorer.mjs',
],ignorePaths:['resources/README.md','resources/sources.json']});
await stageResourceExplorer(root,resolve(root,'public/resources'),{release});
await stageRootOfflineWorker(root,resolve(root,'public'),{release});
const result=spawnSync(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'build'],{cwd:root,stdio:'inherit'});
if(result.error) throw result.error;
if(result.status!==0) process.exit(result.status??1);
const output=resolve(root,'dist');
for(const entry of await readdir(output,{withFileTypes:true})) {
  if(entry.isFile()&&entry.name.endsWith('.html')) {
    const path=resolve(output,entry.name);
    await writeFile(path,stampAppVersion(await readFile(path,'utf8'),release));
  }
}
await writeAppVersion(output,release,{workers:[{scope:'/',script:'/offline-resources-worker.js'},{scope:'/resources/',script:'/resources/offline-worker.js'}]});
console.log(`Application version ${release.version}`);
