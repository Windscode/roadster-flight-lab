import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync} from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {ExperimentRecorder,EXPERIMENT_LIBRARY_KEY,exportExperimentArchive,parseExperimentArchive,saveExperimentArchive,compactExperiment,mergeExperimentRecord} from '../dist/experiment-records.js';
import {createExperimentConsole} from '../dist/experiment-console.js';
import {getExportState} from '../dist/export-download.js';
import {setLanguage} from '../dist/i18n.js';
const clone=structuredClone,checks=[];
const sim=new RoadsterSim({supplyMode:'bench'},{world:'windlab'}),recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=> 'lab'});
for(let i=0;i<120;i++)sim.advanceFixed({});
recorder.start({name:'Archive concurrency: actual fixed-step source'});
for(let i=0;i<2400;i++){const input=recorder.beforeStep({throttle:i<100?.05:0,brake:i>=100?1:0});const t=sim.advanceFixed(input);recorder.afterStep(t,input,1/120);}
const record=recorder.finish(),analysis=(id,speed)=>({schema:'roadster.record-execution',version:1,id,identity:record.identity,sourceIdentity:record.identity,sourceId:record.id,execution:'current-model-recompute',status:'completed',startedAt:'2026-10-25T03:00:00.000Z',summary:{...record.summary,peakSpeedMps:speed},samples:record.samples.slice(0,2),reason:'Controlled archive/UI fixture; not a measured physical intervention'});
function storage(raw=null){return{raw,getItem(key){assert.equal(key,EXPERIMENT_LIBRARY_KEY);return this.raw;},setItem(key,value){assert.equal(key,EXPERIMENT_LIBRARY_KEY);this.raw=value;}};}
const encode=records=>JSON.stringify(exportExperimentArchive(records));
function test(name,fn){fn();checks.push({name,status:'passed'});console.log('PASS '+name);}
test('Two stale pages append independent analyses without overwriting either result',()=>{
 const disk=storage();saveExperimentArchive(disk,[record]);const baseline=disk.raw;
 const a=parseExperimentArchive(baseline),b=parseExperimentArchive(baseline);a[0].analyses=[analysis('page-a',111)];b[0].analyses=[analysis('page-b',222)];
 saveExperimentArchive(disk,a,{baseRaw:baseline});const merged=saveExperimentArchive(disk,b,{baseRaw:baseline});
 assert.deepEqual(merged[0].analyses.map(x=>x.id),['page-a','page-b']);assert.deepEqual(merged[0].summary,record.summary);
 saveExperimentArchive(disk,b,{baseRaw:baseline});assert.equal(parseExperimentArchive(disk.raw)[0].analyses.length,2);
});
test('A stale unchanged record never resurrects an externally deleted experiment',()=>{
 const disk=storage(encode([record])),baseline=disk.raw;saveExperimentArchive(disk,[],{replace:true,expectedRaw:baseline});
 const next={...clone(record),id:'independent-new-record'};saveExperimentArchive(disk,[record,next],{baseRaw:baseline});
 assert.deepEqual(parseExperimentArchive(disk.raw).map(x=>x.id),[next.id]);
 const before=disk.raw,changed={...clone(record),analyses:[analysis('not-discarded',333)]};
 assert.throws(()=>saveExperimentArchive(disk,[changed],{baseRaw:baseline}),/删除/);assert.equal(disk.raw,before);assert.equal(changed.analyses.length,1);
});
test('Conflicting source contents, altered analysis history and same analysis IDs are refused',()=>{
 const disk=storage(encode([{...clone(record),analyses:[analysis('same-id',111)]}])),before=disk.raw;
 assert.throws(()=>saveExperimentArchive(disk,[{...clone(record),name:'Changed original'}]),/原始实验内容/);
 assert.throws(()=>saveExperimentArchive(disk,[{...clone(record),analyses:[analysis('same-id',999)]}]),/分析内容/);
 assert.throws(()=>saveExperimentArchive(disk,[record],{baseRaw:before}),/分析历史/);assert.equal(disk.raw,before);
 assert.throws(()=>mergeExperimentRecord(record,{...record,analyses:{invalid:true}}),/分析列表/);
});
test('Independent record appends merge and replacement deletion retains strict optimistic protection',()=>{
 const disk=storage(encode([record])),baseline=disk.raw,a={...clone(record),id:'new-a'},b={...clone(record),id:'new-b'};
 saveExperimentArchive(disk,[record,a],{baseRaw:baseline});saveExperimentArchive(disk,[record,b],{baseRaw:baseline});
 assert.deepEqual(parseExperimentArchive(disk.raw).map(x=>x.id),[record.id,a.id,b.id]);const before=disk.raw;
 assert.throws(()=>saveExperimentArchive(disk,[a],{replace:true,expectedRaw:baseline}),/另一页面/);assert.equal(disk.raw,before);
});
test('Race during write, silent storage refusal and unreadable archives preserve the disk',()=>{
 const disk=storage(encode([record])),baseline=disk.raw,remote={...clone(record),id:'remote-during-write'},get=disk.getItem;let reads=0;
 disk.getItem=function(key){if(++reads===2)this.raw=encode([record,remote]);return get.call(this,key);};
 assert.throws(()=>saveExperimentArchive(disk,[{...record,analyses:[analysis('race-local',123)]}],{baseRaw:baseline}),/另一页面/);assert.equal(parseExperimentArchive(disk.raw).length,2);
 disk.getItem=get;disk.setItem=()=>{};const before=disk.raw;assert.throws(()=>saveExperimentArchive(disk,[{...record,analyses:[analysis('silent-local',123)]}],{baseRaw:baseline}),/未写入/);assert.equal(disk.raw,before);
 const broken=storage('{broken');assert.throws(()=>saveExperimentArchive(broken,[record]),/保护/);assert.equal(broken.raw,'{broken');
});
test('Reimporting full display samples merges analyses with the compact stored source',()=>{
 const compact=compactExperiment(record),full={...clone(record),analyses:[analysis('imported-analysis',444)]};assert(compact.samples.length<record.samples.length);
 const merged=mergeExperimentRecord(compact,full);assert.equal(merged.samples.length,record.samples.length);assert.equal(merged.analyses[0].id,'imported-analysis');assert.deepEqual(merged.inputRuns,record.inputRuns);
});
test('Conflicts at shared full-curve steps cannot hide behind display decimation',()=>{
 const compact=compactExperiment(record),omitted=record.samples.find(sample=>!compact.samples.some(row=>row.step===sample.step));assert(omitted);
 const changed=clone(record);changed.samples.find(sample=>sample.step===omitted.step).heightM+=.125;
 assert.throws(()=>mergeExperimentRecord(record,changed),/相同步采样内容不同/);
 assert.throws(()=>mergeExperimentRecord(compact,changed,record),/相同步采样内容不同/);
 const disk=storage(encode([record])),before=disk.raw;assert.throws(()=>saveExperimentArchive(disk,[changed],{baseRaw:before}),/相同步采样内容不同/);assert.equal(disk.raw,before);
 assert.equal(mergeExperimentRecord(compact,record).samples.length,record.samples.length);
});
test('Repeated anonymous legacy attempts remain present rather than silently deduplicated',()=>{
 const old=analysis('temporary',123);delete old.id;const two={...clone(record),analyses:[old,clone(old)]},one={...clone(record),analyses:[clone(old)]};
 assert.equal(mergeExperimentRecord(two,one).analyses.length,2);assert.equal(mergeExperimentRecord(one,two).analyses.length,2);
 assert.throws(()=>mergeExperimentRecord(record,{...clone(record),analyses:[analysis('duplicate-id',111),analysis('duplicate-id',222)]}),/分析内容/);
});
test('Malformed imported analysis views are rejected before they can break the archive interface',()=>{
 for(const malformed of [{changed:'not-an-array'},{samples:{}},{baseline:{samples:[null]}},{reproduction:{controller:{missingFields:'invalid'}}}]){
  const disk=storage(encode([record])),before=disk.raw;assert.throws(()=>saveExperimentArchive(disk,[{...clone(record),analyses:[malformed]}]),/实验分析/);assert.equal(disk.raw,before);
 }
});
if(!process.env.JSDOM_MODULE_PATH)throw Error('JSDOM_MODULE_PATH is required for analysis selection and storage recovery');
const {JSDOM}=createRequire(import.meta.url)(process.env.JSDOM_MODULE_PATH),oldDocument=globalThis.document,oldURLCreate=URL.createObjectURL,oldURLRevoke=URL.revokeObjectURL;
const dom=new JSDOM('<main></main>',{url:'http://localhost/'});globalThis.document=dom.window.document;dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
let blob,downloads=[];URL.createObjectURL=value=>{blob=value;return'blob:analysis-history-test';};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
const source={...clone(record),analyses:[analysis('earlier',111),analysis('latest',222)]},disk=storage(encode([source])),notices=[];
const ui=createExperimentConsole({mount:dom.window.document.querySelector('main'),getSim:()=>sim,getContext:()=> 'lab',storage:disk,notify:(message,kind)=>notices.push({message,kind})});
const doc=dom.window.document,$=name=>doc.querySelector(`[data-ex="${name}"]`),button=name=>doc.querySelector(`[data-ex-action="${name}"]`);
try{
 test('Earlier analyses and original curves remain selectable without changing the live solver',()=>{
  const physical=sim.exportState();assert.equal($('analysis-select').value,'1');assert.match($('comparison').textContent,/222\.000/);
  $('analysis-select').value='0';$('analysis-select').dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.match($('comparison').textContent,/111\.000/);assert.doesNotMatch($('comparison').textContent,/222\.000/);
  assert.equal(JSON.parse($('details').textContent).selectedAnalysis.execution,'current-model-recompute');assert.deepEqual(sim.exportState(),physical);
  setLanguage('en',{persist:false});assert.match($('analysis-select').options[1].textContent,/Current-model recompute/);setLanguage('zh',{persist:false});
 });
 button('export-analysis').click();for(let i=0;i<100&&getExportState(doc).status!=='handed-off';i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(getExportState(doc).status,'handed-off');const exported=JSON.parse(await blob.text());assert.equal(exported.analysis.id,'earlier');assert.equal(exported.sourceId,record.id);assert.match(exported.scope,/full original experiment/);assert.equal(downloads.length,1);
 checks.push({name:'Selected historical analysis export retains its own result and original source identity',status:'passed'});
 test('Original source selection hides computed results and disables analysis-only export',()=>{
  $('analysis-select').value='-1';$('analysis-select').dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(button('export-analysis').disabled,true);assert.equal(JSON.parse($('details').textContent).selectedAnalysis,null);
 });
 test('A chosen unsaved analysis stays selected after merging another page’s independent result',()=>{
  const write=disk.setItem;let background;dom.window.Worker=class{constructor(){background=this;}postMessage(message){this.message=message;}terminate(){}};
  disk.setItem=()=>{throw Error('temporary quota');};button('recompute').click();assert(background);
  background.onmessage({data:{id:background.message.id,type:'result',result:analysis('local-result',333)}});
  assert.equal(ui.getState().persistence.sessionOnly,true);$('analysis-select').value='2';$('analysis-select').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  const chosen=JSON.parse($('details').textContent).selectedAnalysis.id;assert(chosen);
  disk.raw=encode([{...clone(source),analyses:[...clone(source.analyses),analysis('other-page-result',444)]}]);disk.setItem=write;
  button('retry-save').click();assert.equal(ui.getState().persistence.sessionOnly,false);assert.equal($('analysis-select').value,'3');assert.equal(JSON.parse($('details').textContent).selectedAnalysis.id,chosen);
  assert.deepEqual(ui.getRecords()[0].analyses.map(a=>a.id),['earlier','latest','other-page-result',chosen]);delete dom.window.Worker;
 });
 test('Quota failure preserves all session results and an explicit retry verifies recovery',()=>{
  const write=disk.setItem,before=disk.raw;disk.setItem=()=>{throw Error('quota fixture');};ui.startRecording({name:'Pending record survives quota'});ui.stopRecording();
  assert.equal(ui.getState().persistence.sessionOnly,true);assert.equal(button('retry-save').hidden,false);assert.equal(disk.raw,before);assert.equal(ui.getRecords().length,2);
  disk.setItem=write;button('retry-save').click();assert.equal(ui.getState().persistence.sessionOnly,false);assert.equal(button('retry-save').hidden,true);assert.equal(parseExperimentArchive(disk.raw).length,2);
 });
 test('Pending numerical execution refuses archive import and keeps the eventual result attached',()=>{
  ui.selectRecord(record.id);let background;dom.window.Worker=class{constructor(){background=this;}postMessage(message){this.message=message;}terminate(){}};
  const before=disk.raw,count=ui.getRecords().find(r=>r.id===record.id).analyses.length;button('recompute').click();assert.equal($('import').disabled,true);
  Object.defineProperty($('import'),'files',{configurable:true,value:[{size:10,text:async()=>encode([source])}]});$('import').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.match(notices.at(-1).message,/结束正在记录或执行/);assert.equal(disk.raw,before);
  background.onmessage({data:{id:background.message.id,type:'result',result:analysis('pending-import-result',555)}});
  assert.equal($('import').disabled,false);const saved=parseExperimentArchive(disk.raw).find(r=>r.id===record.id);assert.equal(saved.analyses.length,count+1);assert.equal(saved.analyses.at(-1).id,background.message.id);delete dom.window.Worker;
 });
 {
  let completeRead,background;const before=disk.raw;Object.defineProperty($('import'),'files',{configurable:true,value:[{size:10,text:()=>new Promise(resolve=>completeRead=resolve)}]});
  $('import').dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert(completeRead);
  dom.window.Worker=class{constructor(){background=this;}postMessage(message){this.message=message;}terminate(){}};button('recompute').click();completeRead(encode([source]));await Promise.resolve();await Promise.resolve();
  assert.match(notices.at(-1).message,/结束正在记录或执行/);assert.equal(disk.raw,before);
  background.onmessage({data:{id:background.message.id,type:'result',result:analysis('during-file-read-result',666)}});assert.equal(parseExperimentArchive(disk.raw).find(r=>r.id===record.id).analyses.at(-1).id,background.message.id);delete dom.window.Worker;
  checks.push({name:'An import whose file read began earlier is rechecked before it can replace an active execution source',status:'passed'});
 }
 test('Remote deletion during a pending job keeps its source and completed analysis in this session without resurrection',()=>{
  let background;dom.window.Worker=class{constructor(){background=this;}postMessage(message){this.message=message;}terminate(){}};button('recompute').click();
  disk.raw=encode(parseExperimentArchive(disk.raw).filter(r=>r.id!==record.id));const deleted=disk.raw;
  ui.startRecording({name:'Independent recording while a numerical job runs'});ui.stopRecording();
  assert(ui.getRecords().some(r=>r.id===record.id));assert.equal(ui.getState().persistence.sessionOnly,true);assert.equal(disk.raw,deleted);
  background.onmessage({data:{id:background.message.id,type:'result',result:analysis('deleted-source-result',777)}});
  const retained=ui.getRecords().find(r=>r.id===record.id);assert.equal(retained.analyses.at(-1).id,background.message.id);assert.equal(ui.getState().persistence.sessionOnly,true);assert.equal(disk.raw,deleted);
  button('retry-save').click();assert.equal(disk.raw,deleted);assert.match(notices.at(-1).message,/删除/);assert.equal(ui.getRecords().find(r=>r.id===record.id).analyses.at(-1).summary.peakSpeedMps,777);delete dom.window.Worker;
 });
}finally{ui.dispose();setLanguage('zh',{persist:false});globalThis.document=oldDocument;URL.createObjectURL=oldURLCreate;URL.revokeObjectURL=oldURLRevoke;dom.window.close();}
mkdirSync(`qa/research-history-${REPORT_VERSION}`,{recursive:true});writeFileSync(`qa/research-history-${REPORT_VERSION}/report.json`,JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,checks,scope:'Actual fixed-step source record, archive merges and conflict preservation, DOM selection/export/retry. Analysis numeric display values are declared fixtures; no new controller performance or browser GPU claim. Optimistic cross-page detection is not a transactional lock.'},null,2)+'\n');
console.log(`${checks.length} archive and analysis-history checks passed`);
