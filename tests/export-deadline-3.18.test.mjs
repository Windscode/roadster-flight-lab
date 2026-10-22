import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {exportJson,cancelExport,getExportState,EXPORT_PREPARATION_DEADLINE_MS} from '../dist/export-download.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||process.env.JSDOM_MODULE_PATH||'jsdom');
const dom=new JSDOM('<body></body>',{url:'https://export.fixture.invalid'}),doc=dom.window.document,checks=[],before={create:URL.createObjectURL,revoke:URL.revokeObjectURL};let clicks=0,blobs=[];
URL.createObjectURL=blob=>{blobs.push(blob);return'blob:fixture';};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=()=>{clicks++;};
const begin=performance.now();
try{
 assert.equal(EXPORT_PREPARATION_DEADLINE_MS,30000);
 const unresolved=await exportJson(()=>new Promise(()=>{}),'unresolved-snapshot.json',{doc,deadlineMs:40});assert.equal(unresolved.status,'failed');assert.equal(unresolved.phase,'deadline');assert.match(unresolved.error,/snapshot/);assert.equal(clicks,0);checks.push({name:'An unresolved asynchronous snapshot expires and identifies its blocked stage',status:'passed',receipt:unresolved});
 const workers=[];class SilentWorker{constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}}doc.defaultView.Worker=SilentWorker;
 const silent=await exportJson(()=>({frozen:true}),'silent-worker.json',{doc,deadlineMs:40});assert.equal(silent.status,'failed');assert.match(silent.error,/worker-wait/);assert(workers[0].terminated);assert.equal(clicks,0);checks.push({name:'A silent module Worker expires, terminates and never hands off an empty file',status:'passed',receipt:silent});
 const cancel=exportJson(()=>new Promise(()=>{}),'cancel-await.json',{doc,deadlineMs:500});await new Promise(r=>setTimeout(r,5));cancelExport(doc);const stopped=await cancel;assert.equal(stopped.status,'cancelled');assert.equal(clicks,0);checks.push({name:'Cancellation interrupts an unresolved snapshot without awaiting its promise',status:'passed',receipt:stopped});
 delete doc.defaultView.Worker;
 const exact={camera:{position:[1,2,3]},recordScope:'current-state-unbound'},done=await exportJson(()=>exact,'inspection-state.json',{doc});assert.equal(done.status,'handed-off');assert.equal(done.browserCompletion,'unobservable');assert.deepEqual(JSON.parse(await blobs.at(-1).text()),exact);assert.deepEqual(done.events.filter(e=>e.phase.startsWith('browser')).map(e=>e.phase),['browser-click','browser-handoff']);assert.equal(getExportState(doc).filename,'inspection-state.json');
 checks.push({name:'Successful application preparation retains the exact payload and separates browser handoff from disk completion',status:'passed',receipt:done});
 const source=readFileSync('dist/vehicle-inspection.js','utf8');assert.match(source,/\$\('capture-meta'\)\.onclick=\(\)=>exportJson\(\(\)=>metadata\(\)/);assert.match(source,/cachedGraphicsDevice/);assert.doesNotMatch(source,/setTimeout\(\(\)=>URL\.revokeObjectURL\(url\),1000\)/);
 checks.push({name:'Inspection current-state export uses the same bounded manager and caches invariant GPU identity outside its click path',status:'passed',scope:'Source event-chain check; native download is verified separately.'});
}finally{URL.createObjectURL=before.create;URL.revokeObjectURL=before.revoke;dom.window.close();}
mkdirSync(`qa/export-deadline-${REPORT_VERSION}`,{recursive:true});const paths=['dist/export-download.js','dist/export-encoder.js','dist/vehicle-inspection.js'];writeFileSync(`qa/export-deadline-${REPORT_VERSION}/report.json`,JSON.stringify({schema:'roadster-export-deadline-3.18',status:'passed',wallMs:performance.now()-begin,checks,sourceHashes:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),scope:'Actual download manager with intentionally unresolved snapshot and silent Worker fixtures, shortened deadlines for bounded failure tests. A JavaScript timer cannot preempt a synchronous browser/GPU stall or diagnose an external automation tool hang. No reproduction of the historical 1758/2561 s tool calls is claimed.'},null,2)+'\n');console.log('Bounded snapshot/worker failure and exact browser handoff checks passed.');
