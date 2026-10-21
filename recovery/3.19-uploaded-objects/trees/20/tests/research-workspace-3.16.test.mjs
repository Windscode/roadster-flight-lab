import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {createResearchConsole} from '../dist/research-console.js';
import {landingResultSummary} from '../dist/research-result-summary.js';
import {LANDING_LIBRARY_KEY} from '../dist/landing-challenge.js';
import {setLanguage} from '../dist/i18n.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {awaitExport} from '../qa/await-export.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||process.env.JSDOM_MODULE_PATH||'jsdom'),sourcePath='qa/height-study-fixtures-3.15.json',raw=readFileSync(sourcePath,'utf8'),fixture=JSON.parse(raw),checks=[];
const dom=new JSDOM('<!doctype html><body><div id="research"></div></body>',{url:'https://fixture.invalid/'}),doc=dom.window.document;
dom.window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:text=>({width:text.length*8})},{get:(t,k)=>k in t?t[k]:()=>{},set:()=>true});dom.window.HTMLElement.prototype.scrollIntoView=()=>{};dom.window.HTMLAnchorElement.prototype.click=()=>{};
const globals={document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL};let blob;globalThis.document=doc;URL.createObjectURL=b=>{blob=b;return'blob:workspace-test';};URL.revokeObjectURL=()=>{};
const storedRaw=JSON.stringify(fixture);doc.defaultView.localStorage.setItem(LANDING_LIBRARY_KEY,storedRaw);const sim=new RoadsterSim({supplyMode:'bench'},{world:'windlab'}),before=JSON.stringify(sim.exportState()),ui=createResearchConsole({mount:doc.getElementById('research'),getSim:()=>sim,getContext:()=> 'lab',storage:dom.window.localStorage});
const check=(name,fn)=>{fn();checks.push({name,status:'passed'});console.log('PASS: '+name);};
try{
  check('Operation and analysis reuse existing task, editor and result nodes with clear defaults',()=>{
    ui.open('landing');assert.equal(ui.getState().workspace,'operate');assert.equal(doc.querySelector('.lr-setup').hidden,false);assert.equal(doc.querySelector('.lr-analysis').hidden,true);assert.equal(doc.querySelector('.lr-editor').open,false);assert.equal(doc.querySelector('[data-lr="preview"]').closest('details').open,false);
    ui.setWorkspace('analyze');assert(doc.body.classList.contains('research-analysis'));assert.equal(doc.querySelector('.lr-analysis').hidden,false);assert.equal(doc.querySelectorAll('[data-lr="algorithm"]').length,1);assert.equal(doc.querySelector('[data-lr="metrics"]').closest('details').open,false);
  });
  check('Speed, settling and gas cards come directly from saved all-step statistics',()=>{
    const select=doc.querySelector('[data-lr="records"]');select.value=fixture.records[0].id;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    const summary=JSON.parse(doc.querySelector('[data-lr="result-summary"]').dataset.summary),saved=fixture.records[0].summary;
    assert.equal(summary.landingTimeS,saved.stableLandingAtS);assert.equal(summary.settlingTimeS,saved.hoverSettlingTimeS);assert.equal(summary.totalGasKg,saved.externalSupplyKg);assert.equal(summary.fixedWindowGasKg,saved.takeoffHoldGasKg);assert.equal(doc.querySelectorAll('.lr-kpis button').length,3);
    doc.querySelector('[data-lr-inspect="metrics"]').click();assert.equal(doc.querySelector('[data-lr="metrics"]').closest('details').open,true);
  });
  check('Comparison requires matched conditions and successful outcomes; finite and external supply never rank together',()=>{
    const a=fixture.records[0],b=fixture.records[1],matched=landingResultSummary(b,a);assert.equal(matched.comparison.qualified,true);assert.equal(matched.comparison.differences.settlingTimeS,b.summary.hoverSettlingTimeS-a.summary.hoverSettlingTimeS);
    const failure=structuredClone(b);failure.status='failed';failure.summary.landingSucceeded=false;assert.equal(landingResultSummary(failure,a).comparison.qualified,false);
    const finite=structuredClone(b);finite.supplyMode='finite';finite.task.supplyMode='finite';assert.equal(landingResultSummary(finite,a).comparison.qualified,false);
    const early=structuredClone(b);early.summary.takeoffHoldDurationS=4.2;assert.equal(landingResultSummary(early).fixedWindowGasKg,null);
  });
  check('Watching the scene and returning to a finished result do not advance or reconstruct physics',()=>{
    doc.querySelector('[data-rc-action="observe"]').click();assert.equal(ui.getState().open,false);assert.equal(ui.getState().observing,true);assert(!doc.body.classList.contains('research-open'));assert.equal(doc.querySelector('.rc-running-chip').hidden,false);
    doc.querySelector('[data-rc-action="show-running"]').click();assert.equal(ui.getState().open,true);assert.equal(ui.getState().workspace,'analyze');assert.equal(ui.getState().tab,'landing');assert.equal(JSON.stringify(sim.exportState()),before);
  });
  check('Ready-state recovery removes the stale initialization notice while preserving unrelated messages',()=>{
    ui.setLiveAvailable(false,'Synthetic initialization message');assert.match(doc.querySelector('[data-rc="message"]').textContent,/Synthetic initialization/);ui.setLiveAvailable(true);assert.equal(doc.querySelector('[data-rc="message"]').hidden,true);
  });
  check('Locale and workspace changes preserve the historical archive and editable graph bytes',()=>{
    const graph=doc.querySelector('[data-lr="algorithm"]').value;setLanguage('en');ui.setWorkspace('operate');ui.setWorkspace('analyze');assert.equal(doc.querySelector('[data-lr="algorithm"]').value,graph);assert.equal(dom.window.localStorage.getItem(LANDING_LIBRARY_KEY),storedRaw);assert.equal(JSON.stringify(ui.getLandingRecords()),JSON.stringify(fixture.records));setLanguage('zh');
  });
  doc.querySelector('[data-lr-action="export"]').click();await awaitExport(doc);const exported=JSON.parse(await blob.text());assert.deepEqual(exported.records,fixture.records);checks.push({name:'Existing complete task records survive the new cooperative export unchanged',status:'passed'});console.log('PASS: Existing complete task records survive the new cooperative export unchanged');
  const files=['dist/research-console.js','dist/landing-research-ui.js','dist/research-result-summary.js','tests/research-workspace-3.16.test.mjs'];writeFileSync(`qa/research-workspace-${REPORT_VERSION}.json`,JSON.stringify({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,checks,sourceFixture:{path:sourcePath,sha256:createHash('sha256').update(raw).digest('hex'),records:fixture.records.map(r=>({id:r.id,identity:r.identity}))},sourceHashes:Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),scope:'DOM state and archive integrity using existing synthetic 3.15 solver records; no new control law or demonstration solver. Layout/pixels and native download timings are separate.'},null,2)+'\n');
}finally{ui.dispose();setLanguage('zh');URL.createObjectURL=globals.create;URL.revokeObjectURL=globals.revoke;globalThis.document=globals.document;dom.window.close();}
