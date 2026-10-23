import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {createRouteExperience} from '../dist/route-experience.js';
import {ExperimentRecorder, ExperimentPlayback, contentLabel, currentExperimentIdentity} from '../dist/experiment-records.js';
import {setLanguage} from '../dist/i18n.js';
import {getExportState} from '../dist/export-download.js';
import {prepare, driver, DT} from './route-driver-3.21.mjs';

const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.JSDOM_MODULE_PATH||'jsdom');
const checks=[];
const dom=new JSDOM('<main><div id="route"></div><div id="hud"></div></main>',{url:'https://route-ui.fixture.invalid/'});
const originalDocument=globalThis.document,originalStorage=globalThis.localStorage;
globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;
const doc=dom.window.document;
let downloadedUrl=null;
dom.window.HTMLAnchorElement.prototype.click=function(){downloadedUrl=this.href;};
let sim=new RoadsterSim(),paused=true,mode='live',context='city',switchOnPrepare=false;
const records=[],stops=[],inspections=[],events=[];
const recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=>context,onFinish:record=>records.push(record)});
const ui=createRouteExperience({mount:doc.getElementById('route'),hudMount:doc.getElementById('hud'),getSim:()=>sim,getPaused:()=>paused,getContext:()=>context,getSessionMode:()=>mode,getRecording:()=>recorder.getState(),
  onPrepare:(preset,{prepareSim}={})=>{
    assert.equal(paused,true);
    if(switchOnPrepare){sim=new RoadsterSim();context='city';switchOnPrepare=false;}
    prepareSim?.(sim);
    return{descriptor:prepare(sim,preset==='after-rain-night'?'after-rain':preset)};
  },
  onStart:()=>{recorder.start({name:'Finite route DOM lifecycle'});paused=false;return recorder.getState();},
  onFinish:reason=>{stops.push(reason);return recorder.finish(reason==='route-completed'?'completed':'cancelled',reason);},
  onInspect:id=>inspections.push(id),onOpen(){},onSound(){},onHead(){},recordEvent:(type,detail)=>{events.push({type,detail});recorder.event(type,detail);},notify(){}
});
const route=key=>doc.querySelector(`[data-route="${key}"]`),resource=key=>doc.querySelector(`[data-resource="${key}"]`),action=key=>doc.querySelector(`[data-route-action="${key}"]`);
async function click(key){action(key).click();await Promise.resolve();await Promise.resolve();ui.update();}
async function prepareRun(){paused=true;ui.update();await click('prepare');assert.equal(ui.getState().prepared,true);assert.equal(action('start').disabled,false);}
function chooseMode(value){resource('mode').value=value;resource('mode').dispatchEvent(new dom.window.Event('change',{bubbles:true}));ui.update();}
function step(input){recorder.beforeStep(input);const t=sim.advanceFixed(input,DT);recorder.afterStep(t,input,DT);ui.afterStep(t,DT);return t;}
try{
  await prepareRun();assert.equal(sim.params.supplyMode,'finite');assert(Math.abs(sim.telemetry().energyKWh-.12)<1e-9);
  await click('start');assert.equal(recorder.getState().recording,true);assert.equal(resource('mode').disabled,true);
  const control=driver('economy');let steps=0;
  while(!ui.getState().run.finished&&steps<8400){step(control(sim));steps++;}
  ui.update();const completed=ui.getState().resourceHistory.at(-1),record=records.at(-1);
  assert.equal(completed.completed,true,JSON.stringify(completed));assert.equal(record.reason,'route-completed');assert.equal(record.id,completed.recordId);assert.equal(stops.length,1);
  assert.deepEqual(record.events.filter(e=>e.type==='route_checkpoint').map(e=>e.detail.checkpoint),[0,1,2,3]);
  assert(record.events.some(e=>e.type==='resource_route_result'&&e.detail.completed));
  assert(completed.work.recoveredJ>0);assert.equal(completed.externalGasKg,0);assert(Math.abs(completed.balanceErrorJ)<.02);
  assert.equal(action('start').disabled,true);assert.equal(action('inspect').disabled,false);await click('inspect');assert.equal(inspections.at(-1),record.id);
  const replay=new RoadsterSim(),playback=new ExperimentPlayback(record,{sim:replay});
  while(!playback.finished){const input=playback.nextInput();if(playback.finished)break;const t=replay.advanceFixed(input,DT);playback.afterStep(t);}
  assert.deepEqual(replay.exportState(),sim.exportState());
  checks.push({name:'Real finite DOM prepare/start/complete/record/replay',steps,elapsedS:completed.elapsedS,netWh:completed.netEnergyJ/3600,recoveredWh:completed.work.recoveredJ/3600});

  await prepareRun();await click('start');const faster=driver('balanced');let secondSteps=0;
  while(!ui.getState().run.finished&&secondSteps<8400){step(faster(sim));secondSteps++;}
  const second=ui.getState().resourceHistory.at(-1);assert.equal(second.completed,true);assert.equal(second.comparisonKey,completed.comparisonKey);assert.match(resource('comparison').textContent,/有效同条件成绩|valid matching run/);
  checks.push({name:'Two complete real trajectories produce a matched time/energy/gas difference',secondSteps,elapsedS:second.elapsedS,deltaWh:(second.netEnergyJ-completed.netEnergyJ)/3600});

  paused=true;chooseMode('practice');assert.equal(action('start').disabled,true);await prepareRun();assert.equal(sim.params.supplyMode,'bench');assert(sim.telemetry().energyKWh>199);
  await click('start');step({brake:1});await click('end');const practice=ui.getState().resourceHistory.at(-1);assert.equal(practice.finite,false);assert.equal(practice.completed,false);assert.equal(practice.reason,'pilot-ended');
  assert.match(resource('comparison').textContent,/失败或条件不同|Failed or unmatched/);assert.doesNotMatch(resource('comparison').textContent,/相对上一条有效同条件|Latest versus previous valid/);
  checks.push({name:'Practice switch requires fresh preparation and restores full battery'});

  paused=true;chooseMode('finite');await prepareRun();await click('start');step({brake:1});
  const externalId=recorder.getState().id;recorder.finish('cancelled','external-panel-stop');const count=records.length;
  ui.afterStep(sim.telemetry(),DT);ui.update();assert.equal(ui.getState().lastResult.reason,'recording-ended-externally');assert.equal(records.length,count);assert.equal(records.at(-1).id,externalId);assert.equal(records.at(-1).reason,'external-panel-stop');await click('inspect');assert.equal(inspections.at(-1),externalId);
  checks.push({name:'External recorder stop cannot become route success or overwrite its result'});

  await prepareRun();await click('start');step({brake:1});const routeRecordId=recorder.getState().id;recorder.finish('cancelled','switched-record');
  recorder.start({name:'Unrelated recording'});const otherRecordId=recorder.getState().id,stopCount=stops.length;assert.notEqual(otherRecordId,routeRecordId);
  ui.afterStep(sim.telemetry(),DT);ui.update();assert.equal(ui.getState().lastResult.recordId,routeRecordId);assert.equal(ui.getState().lastResult.reason,'recording-ended-externally');assert.equal(recorder.getState().recording,true);assert.equal(recorder.getState().id,otherRecordId);assert.equal(stops.length,stopCount);recorder.finish('cancelled','fixture-cleanup');
  checks.push({name:'Changing recorder owner preserves the unrelated active recording'});

  await prepareRun();const physical=contentLabel(sim.exportState());mode='review';ui.update();assert.equal(action('prepare').disabled,true);assert.equal(action('start').disabled,true);await click('prepare');assert.equal(contentLabel(sim.exportState()),physical);mode='live';ui.update();
  sim.setParam('regenEfficiency',.7);await click('start');assert.equal(recorder.getState().recording,false);assert.match(route('status').textContent,/条件已改变|Conditions changed/);
  checks.push({name:'Review protects live car; changed parameters require preparation'});

  await prepareRun();sim.body.quaternion.setFromEuler(0,.015,0);await click('start');assert.equal(recorder.getState().recording,false);assert.match(route('status').textContent,/条件已改变|Conditions changed/);
  await prepareRun();sim.body.velocity.x=.1;await click('start');assert.equal(recorder.getState().recording,false);assert.match(route('status').textContent,/条件已改变|Conditions changed/);
  checks.push({name:'Small paused yaw or velocity edits invalidate exact prepared start'});

  const previousSim=sim,previous=contentLabel(sim.exportState());context='lab';switchOnPrepare=true;await prepareRun();assert.notEqual(sim,previousSim);assert.equal(contentLabel(previousSim.exportState()),previous);assert.equal(sim.params.supplyMode,'finite');assert(Math.abs(sim.telemetry().energyKWh-.12)<1e-9);await click('start');assert.equal(recorder.getState().recording,true);step({brake:1});await click('end');
  checks.push({name:'Lab-to-city preparation configures the target sim and preserves original lab state'});

  const selected=resource('mode').value;setLanguage('en',{persist:false});assert.equal(resource('mode').value,selected);assert.match(resource('history').textContent,/Finite|Practice/);setLanguage('zh',{persist:false});
  const history=JSON.parse(globalThis.localStorage.getItem('roadster-resource-runs-3.21'));assert.equal(history.length,ui.getState().resourceHistory.length);assert(history.length<=6);
  checks.push({name:'Language switch preserves mode; persisted history retains all recent results'});

  await prepareRun();await click('start');step({brake:1});const goodStorage=globalThis.localStorage;globalThis.localStorage={getItem:key=>goodStorage.getItem(key),setItem(){throw Error('Quota fixture');}};await click('end');globalThis.localStorage=goodStorage;
  assert.match(resource('storage').textContent,/未保存摘要|not saved/);assert.equal(resource('export').disabled,false);assert.equal(ui.getState().resourceHistory.at(-1).reason,'pilot-ended');
  resource('export').click();for(let i=0;i<100&&getExportState(doc).status!=='handed-off';i++)await new Promise(resolve=>setTimeout(resolve,5));
  const receipt=getExportState(doc);assert.equal(receipt.status,'handed-off',receipt.error);assert.equal(receipt.browserCompletion,'unobservable');assert(downloadedUrl);
  const exported=await(await fetch(downloadedUrl)).json();assert.equal(exported.schema,'roadster-resource-summary-1');assert.deepEqual(exported.runs,ui.getState().resourceHistory);assert.match(exported.scope,/summaries/);
  doc.querySelector('[data-export="close"]').click();
  checks.push({name:'Rejected storage preserves in-memory result; actual summary encoder exports exact retained runs',browserDownloadClaim:'unobservable; DOM handoff only'});
  mkdirSync('qa/resource-3.21',{recursive:true});writeFileSync('qa/resource-3.21/dom-lifecycle.json',JSON.stringify({status:'passed',identity:currentExperimentIdentity(),scope:'JSDOM with production route UI, simulation, recorder and exact playback. Explicit host scene-switch adapter. No browser graphics, native keyboard/gamepad, audible device or GPU acceptance.',checks},null,2)+'\n');
  console.log(JSON.stringify({status:'passed',checks:checks.length,report:'qa/resource-3.21/dom-lifecycle.json'}));
}finally{ui.dispose();setLanguage('zh',{persist:false});globalThis.document=originalDocument;if(originalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalStorage;dom.window.close();}
