import {awaitExport} from './await-export.mjs';
import {withActualExportWorker} from './export-worker-dom-adapter.mjs';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
// Isolated DOM + actual 120 Hz solver. Canvas and worker scheduling are facades;
// this is neither native input, target GPU, layout pixels nor 3D acceptance.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createResearchConsole} from '../dist/research-console.js';
import {createResearchStudyPanel} from '../dist/research-lab.js';
import {RoadsterSim} from '../dist/physics.js';
import {defaultProgramLibrary,PROGRAM_STORAGE_KEY,RESULT_STORAGE_KEY} from '../dist/flight-programs.js';
import {EXPERIMENT_LIBRARY_KEY,exportExperimentArchive,contentLabel} from '../dist/experiment-records.js';
import {executeLandingTask,reexecuteLandingTask,compareLandingAlgorithms,LANDING_LIBRARY_KEY} from '../dist/landing-challenge.js';
import {runExperiment} from '../dist/experiment-worker.js';
import {setLanguage} from '../dist/i18n.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||'/tmp/roadster-dom-314/node_modules/jsdom');
const checks=[],copy=x=>JSON.parse(JSON.stringify(x));let blob=null;
URL.createObjectURL=value=>{blob=value;return'blob:fixture-only';};URL.revokeObjectURL=()=>{};
const test=async(name,fn)=>{await fn();checks.push({name,status:'passed'});console.log('PASS: '+name);};
const waitFor=async check=>{const end=Date.now()+30000;while(!check()){assert.ok(Date.now()<end,'DOM fixture deadline');await new Promise(resolve=>setTimeout(resolve,10));}};
function harness(initial={}){
 const dom=new JSDOM('<!doctype html><html><head></head><body><main id="mount"></main><div id="study"></div></body></html>',{url:'https://fixture.invalid/roadster-flight-lab/'}),doc=dom.window.document;
 dom.window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>{o[k]=v;return true;}});dom.window.HTMLAnchorElement.prototype.click=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 for(const [key,value]of Object.entries(initial))dom.window.localStorage.setItem(key,value);
 const original=dom.window.Storage.prototype.setItem;const rejected=new Set();dom.window.Storage.prototype.setItem=function(key,value){if(rejected.has(key))throw new dom.window.DOMException('Isolated fixture quota / write denied','QuotaExceededError');return original.call(this,key,value);};
 let sim=new RoadsterSim({}, {world:'windlab'}),ui;for(let k=0;k<240;k++)sim.advanceFixed({});
 class WorkerFacade{
  constructor(url){this.url=String(url);this.controller=new AbortController();this.closed=false;}
  postMessage(data){if(data.action==='cancel'){this.controller.abort();return;}setTimeout(async()=>{if(this.closed)return;try{if(this.url.endsWith('/landing-research-worker.js')){const options={signal:this.controller.signal,yieldEvery:120,onProgress:progress=>this.onmessage?.({data:{id:data.id,type:'progress',progress}}),yieldTask:()=>new Promise(resolve=>setTimeout(resolve,0))};const result=data.action==='compare'?await compareLandingAlgorithms(data.source,data.algorithm,options):data.action==='rerun'?await reexecuteLandingTask(data.source,{...options,algorithm:data.algorithm}):await executeLandingTask({...options,task:data.task,algorithm:data.algorithm});if(!this.closed)this.onmessage?.({data:{id:data.id,type:'result',result}});}else{const report=runExperiment(data);if(!this.closed)this.onmessage?.({data:{ok:true,report}});}}catch(error){this.onmessage?.({data:this.url.endsWith('/landing-research-worker.js')?{id:data.id,type:'error',error:error.message}:{ok:false,error:error.message}});}},0);}
  terminate(){this.closed=true;this.controller.abort();}
 }
 const RoutedWorkerFacade=withActualExportWorker(WorkerFacade);dom.window.Worker=RoutedWorkerFacade;
 const make=()=>{ui=createResearchConsole({mount:doc.getElementById('mount'),getSim:()=>sim,getContext:()=> 'lab',getLiveAvailable:()=>true,onRestoreExperiment:({snapshot})=>{sim=new RoadsterSim(snapshot.params,{world:snapshot.worldType});sim.importState(snapshot);return sim;}});return ui;};make();
 const click=(kind,key)=>doc.querySelector(`[data-${kind}-action="${key}"]`).click(),change=node=>node.dispatchEvent(new dom.window.Event('change',{bubbles:true})),input=node=>node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 const tick=(n,pilot={})=>{for(let k=0;k<n;k++){const u=ui.beforeFixedStep(1/120,typeof pilot==='function'?pilot(k):pilot),t=sim.advanceFixed(u);ui.afterFixedStep(t,t.driverInput,1/120);if(k%6===0)ui.captureSample(t);}ui.update(sim.telemetry(),0);};
 return{dom,doc,rejected,click,change,input,tick,get ui(){return ui;},get sim(){return sim;},reload(){ui.dispose();doc.getElementById('mount').replaceChildren();make();},dispose(){ui.dispose();dom.window.close();},WorkerFacade:RoutedWorkerFacade};
}
await test('Live save failure persists past completion, append/import stay in session export, failed deletion retains old disk and selection',async()=>{
 const h=harness();try{
  h.click('ex','record');h.tick(12);h.click('ex','stop-record');const storage=h.dom.window.localStorage,old=storage.getItem(EXPERIMENT_LIBRARY_KEY);h.rejected.add(EXPERIMENT_LIBRARY_KEY);
  h.click('ex','record');h.tick(18);h.click('ex','stop-record');assert.equal(h.ui.getExperimentState().recordCount,2);assert.equal(h.ui.getExperimentState().persistence.sessionOnly,true);assert.equal(h.doc.querySelector('[data-ex="persistence"]').hidden,false);assert.match(h.doc.querySelector('[data-rc="message"]').textContent,/完成/);assert.match(h.doc.querySelector('[data-ex="persistence"]').textContent,/仅本会话/);assert.equal(storage.getItem(EXPERIMENT_LIBRARY_KEY),old);
  const selected=h.ui.getExperimentState().selectedId;h.click('ex','delete-selected');assert.equal(h.ui.getExperimentState().recordCount,2);assert.equal(h.ui.getExperimentState().selectedId,selected);assert.equal(storage.getItem(EXPERIMENT_LIBRARY_KEY),old);
  const imported=copy(h.ui.getExperimentRecords()[0]);imported.id='isolated-import';imported.name='原始 中文 custom name';const raw=JSON.stringify(exportExperimentArchive([imported])),field=h.doc.querySelector('[data-ex="import"]');Object.defineProperty(field,'files',{value:[{size:raw.length,text:async()=>raw}],configurable:true});h.change(field);await waitFor(()=>h.ui.getExperimentState().recordCount===3);h.click('ex','export-all');await awaitExport(h.doc);const exported=JSON.parse(await blob.text());assert.equal(exported.records.length,3);assert.equal(exported.records.at(-1).name,imported.name);assert.equal(exported.persistence.sessionOnly,true);
  h.rejected.clear();h.reload();assert.equal(h.ui.getExperimentState().recordCount,1);assert.equal(storage.getItem(EXPERIMENT_LIBRARY_KEY),old);
 }finally{h.dispose();}
});
await test('Procedure delete / controller save commit only after disk success; import/save/reload preserve ±360 / ±120 rate requests',async()=>{
 const lib=defaultProgramLibrary();lib.programs[0].stages=[{type:'rate',axis:'roll',rateDegS:360,durationS:1},{type:'rate',axis:'pitch',rateDegS:-120,durationS:1}];const h=harness({[PROGRAM_STORAGE_KEY]:JSON.stringify(lib)});try{
  h.ui.open('programs');const rates=[...h.doc.querySelectorAll('[data-rc-stage-field="rateDegS"]')];assert.deepEqual(rates.map(n=>[n.min,n.max,n.value]),[['-360','360','360'],['-120','120','-120']]);const old=h.dom.window.localStorage.getItem(PROGRAM_STORAGE_KEY),before=h.ui.getState().savedPrograms;
  h.rejected.add(PROGRAM_STORAGE_KEY);h.click('rc','delete');assert.deepEqual(h.ui.getState().savedPrograms,before);assert.equal(h.dom.window.localStorage.getItem(PROGRAM_STORAGE_KEY),old);
  h.doc.querySelector('[data-rc-param="rollRateDegS"]').value='360';h.doc.querySelector('[data-rc-param="pitchRateDegS"]').value='120';h.click('rc','save-controller');assert.equal(h.dom.window.localStorage.getItem(PROGRAM_STORAGE_KEY),old);assert.equal(h.doc.querySelector('[data-rc="persistence"]').hidden,false);
  h.rejected.clear();h.click('rc','save-controller');h.click('rc','save-program');h.reload();assert.equal(JSON.parse(h.dom.window.localStorage.getItem(PROGRAM_STORAGE_KEY)).controller.pitchRateDegS,120);assert.deepEqual([...h.doc.querySelectorAll('[data-rc-stage-field="rateDegS"]')].map(n=>n.value),['360','-120']);
 }finally{h.dispose();}
});
await test('Procedure result save failure remains independently visible after completed notification; raw live link and 120 Hz metrics are retained',async()=>{
 const lib=defaultProgramLibrary();lib.programs[0].stages=[{type:'wait',durationS:.25}];const h=harness({[PROGRAM_STORAGE_KEY]:JSON.stringify(lib)});try{
  h.rejected.add(RESULT_STORAGE_KEY);h.ui.handleKey('Digit3');h.tick(40);assert.equal(h.ui.getState().running,false);assert.equal(h.ui.getState().resultCount,1);assert.equal(h.doc.querySelector('[data-rc="persistence"]').hidden,false);assert.match(h.doc.querySelector('[data-rc="message"]').textContent,/完成/);h.click('rc','export-results-all');await awaitExport(h.doc);const result=JSON.parse(await blob.text()).results[0];assert.equal(result.summary.statisticsHz,120);assert.ok(result.liveExperimentId);assert.equal(h.ui.getExperimentRecords()[0].id,result.liveExperimentId);assert.equal(h.dom.window.localStorage.getItem(RESULT_STORAGE_KEY),null);
 }finally{h.dispose();}
});
await test('Damaged procedure/results archives are isolated with exact original strings and new finished results cannot overwrite them',async()=>{
 for(const key of [PROGRAM_STORAGE_KEY,RESULT_STORAGE_KEY]){
  const raw='{"version":999,"partial":"unrecognized retained bytes"}';const h=harness({[key]:raw});try{h.ui.handleKey('Digit3');h.tick(5);h.ui.cancel('fixture cancel');assert.equal(h.dom.window.localStorage.getItem(key),raw);assert.equal(h.doc.querySelector('[data-rc="persistence"]').hidden,false);h.click('rc','export-protected');await awaitExport(h.doc);const exported=JSON.parse(await blob.text());assert.equal(exported[key===PROGRAM_STORAGE_KEY?'programs':'results'],raw);}finally{h.dispose();}
 }
});
await test('Standard research failed clear keeps report/selection/raw disk; quota and protected attempt logs are separate persistent states',async()=>{
 const h=harness();let panel;const saved={fetch:globalThis.fetch,Worker:globalThis.Worker};try{
  globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync('dist/research-panel.html','utf8')});globalThis.Worker=h.WorkerFacade;
  const report=runExperiment({kind:'rise'}),entry={id:'standard-fixture',batchId:'fixture',label:'Original exact report',factor:null,note:'fixture',report};h.dom.window.localStorage.setItem('roadster-research-library-v2',JSON.stringify([entry]));h.dom.window.localStorage.setItem('roadster-study-attempts-v1','{protected bad attempt');
  panel=await createResearchStudyPanel({mount:h.doc.getElementById('study'),getSim:()=>h.sim});const $=key=>panel.root.querySelector(`[data-study-id="${key}"]`);const original=h.dom.window.localStorage.getItem('roadster-research-library-v2'),active=panel.getState().activeId;h.rejected.add('roadster-research-library-v2');$('clear-library').click();assert.equal(panel.getState().records,1);assert.equal(panel.getState().activeId,active);assert.equal(h.dom.window.localStorage.getItem('roadster-research-library-v2'),original);assert.match($('library-notice').textContent,/未保存/);assert.equal(panel.getState().persistence.attempts,false);
  $('lab-kind').value='rise';h.change($('lab-kind'));$('lab-mode').value='single';h.change($('lab-mode'));$('lab-run').click();await waitFor(()=>!panel.getState().running&&panel.getState().records===2);assert.equal(h.dom.window.localStorage.getItem('roadster-research-library-v2'),original);assert.equal(h.dom.window.localStorage.getItem('roadster-study-attempts-v1'),'{protected bad attempt');assert.match($('library-notice').textContent,/未保存/);$('export-library').click();await awaitExport(h.doc);const archive=JSON.parse(await blob.text());assert.equal(archive.entries.length,2);assert.equal(archive.protectedRaw.attempts,'{protected bad attempt');assert.equal(archive.attempts.at(-1).status,'completed');
 }finally{panel?.dispose();globalThis.fetch=saved.fetch;globalThis.Worker=saved.Worker;h.dispose();}
});
await test('Numeric challenge, saved editable graph, refresh, same-task re-decision, comparison, cancellation and EN editing share one usable UI',async()=>{
 const h=harness();try{
  h.ui.open('landing');h.click('lr','numeric');await waitFor(()=>!h.ui.getState().landing.numericRunning&&h.ui.getState().landing.recordCount===1);const baseline=h.ui.getLandingRecords()[0];assert.equal(baseline.status,'completed');const originalText=h.doc.querySelector('[data-lr="algorithm"]').value;
  const graph=JSON.parse(originalText);graph.name='我的 original / completion';graph.root.args[0].args[0].value=1.8;const editor=h.doc.querySelector('[data-lr="algorithm"]');editor.value=JSON.stringify(graph,null,2);h.input(editor);h.click('lr','save');const text=editor.value;setLanguage('en',{persist:false});assert.equal(editor.value,text);assert.equal(JSON.parse(editor.value).name,graph.name);assert.match(h.doc.querySelector('[data-lr-label="title"]').textContent,/Disturbed landing/);assert.match(h.doc.querySelector('[data-lr="authority"]').textContent,/Authority/);setLanguage('zh',{persist:false});assert.equal(editor.value,text);
  h.click('lr','compare');await waitFor(()=>!h.ui.getState().landing.numericRunning&&h.ui.getState().landing.recordCount===3);const records=h.ui.getLandingRecords();assert.notEqual(records[2].algorithm.hash,baseline.algorithm.hash);assert.deepEqual(records[1].initialSnapshot.physical,records[2].initialSnapshot.physical);assert.notDeepEqual(records[1].controllerIO,records[2].controllerIO);
  h.click('lr','export');await awaitExport(h.doc);const archive=JSON.parse(await blob.text());assert.equal(archive.records.length,3);h.reload();assert.equal(h.ui.getState().landing.recordCount,3);assert.equal(JSON.parse(h.doc.querySelector('[data-lr="algorithm"]').value).name,graph.name);h.click('lr','rerun');h.click('lr','cancel');await waitFor(()=>!h.ui.getState().landing.numericRunning&&h.ui.getState().landing.recordCount===4);assert.equal(h.ui.getLandingRecords().at(-1).status,'cancelled');
 }finally{setLanguage('zh',{persist:false});h.dispose();}
});
await test('Live challenge uses the host fixed-step loop; pilot takeover releases authority and an invalid graph cannot start',async()=>{
 const h=harness();try{
  h.click('lr','live');assert.equal(h.ui.getState().landing.running,true);h.tick(180);assert.ok(h.sim.body.position.y>1);h.tick(1,{throttle:.2});assert.equal(h.ui.getState().landing.running,false);assert.equal(h.ui.getLandingRecords().at(-1).reason,'pilot_takeover');assert.equal(h.sim.telemetry().researchHeightControl.enabled,false);
  const editor=h.doc.querySelector('[data-lr="algorithm"]');editor.value='{"root":{"op":"eval"}}';h.input(editor);h.click('lr','live');assert.equal(h.ui.getState().landing.running,false);assert.equal(h.doc.querySelector('[data-lr="graph-state"]').dataset.valid,'false');assert.doesNotThrow(()=>h.ui.update(h.sim.telemetry(),0));
 }finally{h.dispose();}
});
await test('Live low-pressure challenge keeps its real hard-landing failure, offers event telemetry and survives export/import/refresh',async()=>{
 const h=harness();try{
  h.ui.open('landing');const supply=h.doc.querySelector('[data-lr="supply"]'),pressure=h.doc.querySelector('[data-lr="pressure"]');supply.value='finite';pressure.value='100';h.input(pressure);h.click('lr','live');h.tick(400);const failure=h.ui.getLandingRecords().at(-1);assert.equal(failure.status,'failed');assert.equal(failure.reason,'hard_or_tilted_touchdown');assert.equal(failure.failureEvidence,null);assert.ok(failure.summary.firstContact.preContactVerticalMps>1.4);assert.equal(failure.summary.externalSupplyKg,0);assert.match(h.doc.querySelector('[data-lr="verdict"]').textContent,/硬着陆/);assert.ok(h.doc.querySelector('[data-lr="events"]').options.length>3);
  const events=h.doc.querySelector('[data-lr="events"]');events.value=String(failure.events.findIndex(e=>e.type==='first_contact'));h.change(events);assert.match(h.doc.querySelector('[data-lr="event-detail"]').textContent,/first_contact/);h.click('lr','one');await awaitExport(h.doc);const raw=await blob.text();assert.equal(JSON.parse(raw).reason,'hard_or_tilted_touchdown');h.reload();assert.equal(h.ui.getLandingRecords().at(-1).reason,'hard_or_tilted_touchdown');
  const imported=JSON.parse(raw);imported.id='imported-failed-task-fixture';const field=h.doc.querySelector('[data-lr="import"]'),text=JSON.stringify(imported);Object.defineProperty(field,'files',{value:[{size:text.length,text:async()=>text}],configurable:true});h.change(field);await waitFor(()=>h.ui.getState().landing.recordCount===2);h.reload();assert.equal(h.ui.getState().landing.recordCount,2);
 }finally{h.dispose();}
});
await test('Challenge quota and quarantined original archives keep full new results and edited algorithms in session export with a persistent warning',async()=>{
 for(const original of [null,'{"schema":"roadster.landing-library","version":999,"records":["protected bytes"]}']){
  const h=harness(original?{[LANDING_LIBRARY_KEY]:original}:{});try{if(!original)h.rejected.add(LANDING_LIBRARY_KEY);h.click('lr','live');h.tick(25);h.click('lr','cancel');assert.equal(h.ui.getState().landing.recordCount,1);assert.equal(h.ui.getState().landing.persistence.sessionOnly,true);assert.equal(h.doc.querySelector('[data-lr="persistence"]').hidden,false);assert.equal(h.dom.window.localStorage.getItem(LANDING_LIBRARY_KEY),original);h.ui.update(h.sim.telemetry(),0);assert.equal(h.doc.querySelector('[data-lr="persistence"]').hidden,false);h.click('lr','export');await awaitExport(h.doc);const exported=JSON.parse(await blob.text());assert.equal(exported.records.length,1);assert.equal(exported.records[0].status,'cancelled');assert.ok(exported.records[0].algorithm.algorithm);assert.equal(exported.protectedRaw,original);assert.equal(exported.persistence.sessionOnly,true);h.reload();assert.equal(h.dom.window.localStorage.getItem(LANDING_LIBRARY_KEY),original);assert.equal(h.ui.getState().landing.recordCount,0);}finally{h.dispose();}
 }
});
const paths=['dist/research-console.js','dist/experiment-console.js','dist/research-lab.js','dist/landing-research-ui.js','dist/landing-challenge.js'];writeFileSync(`qa/research-safety-${REPORT_VERSION}-dom.json`,JSON.stringify({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',scope:'Isolated DOM/storage + actual 120 Hz solver; Canvas/Worker scheduling facades. No user archive was modified. No native 3D, GPU or frame-time claim.',checks,sourceHashes:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))},null,2)+'\n');
