import {awaitExport} from './await-export.mjs';
import {withActualExportWorker} from './export-worker-dom-adapter.mjs';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
// Optional DOM-only integration check. Supply an installed jsdom package path:
// node qa/research-panel-dom-check.mjs /path/to/node_modules/jsdom
// Canvas drawing is stubbed; this is not browser layout or GPU visual QA.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createResearchStudyPanel} from '../dist/research-lab.js';
import {runExperiment} from '../dist/experiment-worker.js';
import {RoadsterSim} from '../dist/physics.js';
import {RESEARCH_PARAMETERS} from '../dist/research-protocol.js';

const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||'jsdom');
const dom=new JSDOM('<!doctype html><html><head></head><body><main><button id="city-action">City</button></main><div id="mount-a"></div><div id="mount-b"></div></body></html>',{url:'https://windscode.github.io/roadster-flight-lab/'});
const doc=dom.window.document,results=[],requests=[],workers=new Set(),events=[];let drawCalls=0,lastBlob=null,solverReports=0;
const canvasContext=new Proxy({},{get:(_,key)=>['fillStyle','font','textBaseline','textAlign','lineWidth','strokeStyle'].includes(key)?'':()=>drawCalls++,set:()=>true});
dom.window.HTMLCanvasElement.prototype.getContext=()=>canvasContext;dom.window.HTMLElement.prototype.scrollIntoView=()=>{};dom.window.HTMLAnchorElement.prototype.click=()=>{};
const saved={fetch:globalThis.fetch,Worker:globalThis.Worker,createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
globalThis.fetch=async url=>{assert.ok(String(url).endsWith('/research-panel.html'));return{ok:true,status:200,text:async()=>readFileSync(new URL('../dist/research-panel.html',import.meta.url),'utf8')};};
URL.createObjectURL=blob=>{lastBlob=blob;return'blob:research-panel-dom-check';};URL.revokeObjectURL=()=>{};
// The asynchronous facade checks the browser-worker message contract while
// obtaining reports from the actual solver. Worker-thread scheduling and canvas
// pixels are deliberately outside this DOM test's evidence.
globalThis.Worker=withActualExportWorker(class {
  constructor(url,options){assert.ok(String(url).endsWith('/experiment-worker.js'));assert.equal(options.type,'module');this.stopped=false;workers.add(this);}
  postMessage(request){requests.push(structuredClone(request));this.timer=setTimeout(()=>{if(this.stopped)return;try{const report=runExperiment(request);solverReports++;this.onmessage?.({data:{ok:true,report}});}catch(error){this.onmessage?.({data:{ok:false,error:error.message}});}},0);}
  terminate(){this.stopped=true;clearTimeout(this.timer);workers.delete(this);}
});
const waitFor=async fn=>{const deadline=Date.now()+30000;while(!fn()){assert.ok(Date.now()<deadline,'DOM study timed out');await new Promise(resolve=>setTimeout(resolve,10));}};
const test=async(name,fn)=>{const start=performance.now();await fn();results.push({name,status:'PASS',ms:Math.round(performance.now()-start)});console.log('PASS: '+name);};
const change=element=>element.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
const $=(panel,id)=>panel.root.querySelector(`[data-study-id="${id}"]`);
const sim=new RoadsterSim({}, {world:'windlab'}),getSim=()=>sim;
let first,second,history,oversized,archiveFixture;
try{
  await test('Two mounted study instances have local fields, unique labels and scoped CSS',async()=>{
    first=await createResearchStudyPanel({mount:doc.getElementById('mount-a'),getSim,onEvent:(...e)=>events.push(e)});second=await createResearchStudyPanel({mount:doc.getElementById('mount-b'),getSim});
    const ids=Array.from(doc.querySelectorAll('[id]'),e=>e.id);assert.equal(new Set(ids).size,ids.length);
    assert.equal(doc.querySelectorAll('link[data-roadster-study-styles]').length,1);
    for(const panel of [first,second]){for(const key of Object.keys(RESEARCH_PARAMETERS))assert.ok($(panel,'lab-param-'+key),key);for(const label of panel.root.querySelectorAll('label[for]'))assert.ok(doc.getElementById(label.htmlFor),label.htmlFor);}
    // CSS comments are not selectors; every real selector remains panel-scoped.
    const css=readFileSync(new URL('../dist/research.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');for(const [,selector]of css.matchAll(/([^{}]+)\{/g))if(!selector.trim().startsWith('@'))for(const s of selector.split(','))assert.ok(s.trim().startsWith('.research-study-panel'),s);
    assert.equal(first.getState().open,false);first.open();assert.equal(first.getState().open,true);
  });
  await test('Reading current parameters does not reset or advance the live laboratory vehicle',async()=>{
    sim.setParam('dryMass',1900);const before=JSON.stringify(sim.telemetry());assert.equal(first.loadCurrentParameters(),true);assert.equal(+$(first,'lab-param-dryMass').value,1900);assert.equal(JSON.stringify(sim.telemetry()),before);
    assert.notEqual(+$(second,'lab-param-dryMass').value,1900,'read changed a different panel');
    let drivingKeyEvents=0;doc.defaultView.addEventListener('keydown',()=>drivingKeyEvents++);$(first,'study-note').dispatchEvent(new dom.window.KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));assert.equal(drivingKeyEvents,0);
  });
  await test('A complete A/B study runs two frozen requests and renders actual solver responses',async()=>{
    const before=JSON.stringify(sim.telemetry());$(first,'lab-kind').value='brake';change($(first,'lab-kind'));$(first,'lab-mode').value='pair';change($(first,'lab-mode'));$(first,'lab-pair').value='tireMu';change($(first,'lab-pair'));
    const requestStart=requests.length;$(first,'protocol-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>!first.getState().running);
    const batch=requests.slice(requestStart);assert.equal(batch.length,2);assert.deepEqual(batch.map(r=>r.params.tireMu),[.65,1.25]);assert.equal(first.getState().records,2);
    assert.ok(drawCalls>50);assert.equal($(first,'analysis-content').hidden,false);assert.equal($(first,'record-table').children.length,2);assert.equal(JSON.stringify(sim.telemetry()),before);
    const diag=JSON.parse($(first,'analysis-content').dataset.result);assert.equal(diag.kind,'brake');assert.equal(diag.records,2);assert.ok(events.some(e=>e[0]==='research_study_complete'));
  });
  await test('Sweep configuration, archive export and imported-mode exit remain usable',async()=>{
    $(first,'lab-mode').value='sweep';change($(first,'lab-mode'));$(first,'sweep-key').value='dryMass';change($(first,'sweep-key'));assert.ok(+$(first,'sweep-from').value<+$(first,'sweep-to').value);assert.equal($(first,'sweep-count').value,'3');
    $(first,'export-study').click();await awaitExport(doc);assert.ok(lastBlob);const archive=JSON.parse(await lastBlob.text());archiveFixture=archive;assert.equal(archive.requests.length,2);assert.equal(archive.results.length,2);
    const input=$(second,'import-study');Object.defineProperty(input,'files',{configurable:true,value:[{size:2000,text:async()=>JSON.stringify(archive)}]});change(input);await waitFor(()=>$(second,'lab-mode').value==='imported');assert.equal($(second,'lab-mode').disabled,false);assert.equal($(second,'lab-kind').disabled,false);assert.equal($(second,'lab-param-dryMass').disabled,true);
    $(second,'lab-mode').value='single';change($(second,'lab-mode'));assert.equal($(second,'lab-param-dryMass').disabled,false);
    $(first,'export-rows').click();await awaitExport(doc);assert.match(await lastBlob.text(),/run_id,case,/);
  });
  await test('Road-surface launch, ABS/TCS and wing comparisons are executable options in the same standard research panel',async()=>{
    $(first,'lab-kind').value='launch';change($(first,'lab-kind'));$(first,'lab-mode').value='pair';change($(first,'lab-mode'));assert.equal($(first,'road-condition').hidden,false);assert.ok([...$(first,'lab-pair').options].some(o=>o.value==='tractionAssist'));assert.ok([...$(first,'lab-pair').options].some(o=>o.value==='wingMode'));$(first,'lab-pair').value='tractionAssist';$(first,'lab-road-surface').value='split';const requestStart=requests.length;$(first,'protocol-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>!first.getState().running);const jobs=requests.slice(requestStart);assert.equal(jobs.length,2);assert.deepEqual(jobs.map(r=>r.params.tractionAssist),[false,true]);assert.ok(jobs.every(r=>r.params.roadSurface==='split'));assert.equal(first.getState().records,4);assert.ok([...$(first,'chart-channel').options].some(o=>o.value==='wheelFL'));assert.ok([...$(first,'chart-channel').options].some(o=>o.value==='slipRR'));
  });
  await test('Channel, overlay, record switches and clear reset pointer series and units without waiting for another pointer event',async()=>{
    const canvas=$(first,'response-chart');canvas.getBoundingClientRect=()=>({left:0,top:0,width:1100,height:280});canvas.onpointermove({currentTarget:canvas,clientX:500});assert.match($(first,'chart-readout').textContent,/t ≈/);$(first,'chart-channel').value='slipFL';change($(first,'chart-channel'));assert.match($(first,'chart-readout').textContent,/左前滑移率/);assert.doesNotMatch($(first,'chart-readout').textContent,/km\/h/);const checked=$(first,'record-table').querySelector('input:checked');checked.checked=false;checked.onchange();assert.match($(first,'chart-readout').textContent,/1 条当前系列/);const other=$(first,'record-table').querySelectorAll('tr')[2].querySelector('button');other.click();assert.match($(first,'active-title').textContent,/直线制动/);assert.doesNotMatch($(first,'chart-readout').textContent,/t ≈/);$(first,'export-rows').click();await awaitExport(doc);const csv=await lastBlob.text(),diag=JSON.parse($(first,'analysis-content').dataset.result);assert.match(csv,new RegExp('model='+diag.modelVersion));assert.match(csv,new RegExp('protocol='+diag.protocolVersion));assert.equal(csv.split('\r\n').filter(line=>!line.startsWith('#')).length,201);$(first,'clear-library').click();assert.equal(first.getState().records,0);assert.equal($(first,'response-legend').children.length,0);assert.equal($(first,'summary-unit').textContent,'');assert.equal($(first,'chart-readout').textContent,'没有当前曲线。');
  });
  await test('Cancelling, closing and disposal stop workers and keep the active page intact',async()=>{
    $(second,'lab-mode').value='imported';change($(second,'lab-mode'));$(second,'protocol-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));assert.equal(second.getState().running,true);const stale=[...workers][0];second.cancel();assert.equal(second.getState().lastAttempt.status,'cancelled');assert.match($(second,'attempt-log').textContent,/cancelled/);assert.equal(second.getState().running,false);assert.equal(workers.size,0);
    $(second,'protocol-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));const replacement=[...workers][0];stale.onmessage({data:{ok:true,report:archiveFixture.results[0].report}});assert.equal(second.getState().running,true,'stale worker completion terminated a replacement');assert.ok(workers.has(replacement));second.cancel();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(second.getState().records,0);
    const location=dom.window.location.href;first.open();$(first,'study-close').click();assert.equal(first.getState().open,false);assert.equal(dom.window.location.href,location);assert.ok(doc.getElementById('city-action'));
    first.dispose();second.dispose();assert.equal(doc.querySelectorAll('.research-study-panel').length,0);assert.equal(workers.size,0);
  });
  await test('Historical fixtures remain readable and cannot overwrite or co-plot with a new model at the storage cap',async()=>{
    // These version-labelled fixtures exercise archive handling; their numeric
    // values originate in the real reports above, not historical-physics claims.
    const base=structuredClone(archiveFixture.results[0].report);base.modelVersion='3.6.0';base.modelBuildId='historical-model-test-fixture';base.rows=base.rows.slice(0,5);
    const stored=Array.from({length:64},(_,i)=>({id:'historical-'+i,label:'历史存档夹具 '+i,report:base})),raw=JSON.stringify(stored);assert.ok(new TextEncoder().encode(raw).byteLength<4*1024*1024);dom.window.localStorage.setItem('roadster-research-library-v2',raw);
    history=await createResearchStudyPanel({mount:doc.getElementById('mount-a'),getSim});history.open();assert.equal(history.getState().records,64);assert.match($(history,'active-protocol').textContent,/历史结果/);assert.equal(JSON.parse($(history,'analysis-content').dataset.result).historical,true);
    $(history,'rerun-active').click();await waitFor(()=>!history.getState().running);assert.equal(history.getState().records,65);assert.equal(dom.window.localStorage.getItem('roadster-research-library-v2'),raw,'new model silently erased old records');assert.match($(history,'library-notice').textContent,/64项/);
    const current=JSON.parse($(history,'analysis-content').dataset.result);assert.equal(current.historical,false);assert.equal(current.selected,1);assert.equal($(history,'record-table').querySelectorAll('tr.historical input:disabled').length,64);
    $(history,'export-library').click();await awaitExport(doc);const complete=JSON.parse(await lastBlob.text());assert.equal(complete.entries.length,65);assert.equal(complete.entries.filter(e=>e.report.modelVersion==='3.6.0').length,64);
    history.dispose();
  });
  await test('Oversized old archives are protected before parsing and new session results remain exportable',async()=>{
    const raw=' '.repeat(4*1024*1024+1);dom.window.localStorage.setItem('roadster-research-library-v2',raw);oversized=await createResearchStudyPanel({mount:doc.getElementById('mount-b'),getSim});oversized.open();assert.equal(oversized.getState().records,0);assert.match($(oversized,'library-notice').textContent,/4 MiB/);assert.equal($(oversized,'export-preserved').hidden,false);
    $(oversized,'lab-kind').value='brake';change($(oversized,'lab-kind'));$(oversized,'protocol-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>!oversized.getState().running);assert.equal(oversized.getState().records,1);assert.equal(dom.window.localStorage.getItem('roadster-research-library-v2'),raw);assert.equal($(oversized,'export-library').disabled,false);
    oversized.dispose();assert.equal(workers.size,0);
  });
  const sourceFiles=['dist/research-lab.js','dist/research-panel.html','dist/research.css','qa/research-panel-dom-check.mjs'],sourceHashes=Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]));
  writeFileSync(new URL(`./research-panel-dom-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({version:REPORT_VERSION,generatedAt:new Date().toISOString(),scope:'JSDOM events and state, with actual deterministic solver reports through an asynchronous Worker API facade. Historical-version fixtures test storage only. Canvas is stubbed; no browser layout, actual Worker-thread scheduling, GPU pixels or FPS evidence.',tests:results,sourceHashes,solverReports,uniqueLiveInstancesTested:2,canvasDrawingCalls:drawCalls},null,2)+'\n');
}finally{first?.dispose();second?.dispose();history?.dispose();oversized?.dispose();globalThis.fetch=saved.fetch;globalThis.Worker=saved.Worker;URL.createObjectURL=saved.createObjectURL;URL.revokeObjectURL=saved.revokeObjectURL;dom.window.close();}
