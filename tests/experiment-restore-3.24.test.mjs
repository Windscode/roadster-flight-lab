import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {RoadsterSim} from '../dist/physics.js';
import {preflightExperimentRestore,matchesRestoredSnapshot} from '../dist/experiment-restore.js';
import {ExperimentRecorder,ExperimentPlayback,contentLabel,exportExperimentArchive} from '../dist/experiment-records.js';
import {createExperimentConsole} from '../dist/experiment-console.js';
import {CityFlightChallenge,makeCityFlightTask,validateCityFlightResult} from '../dist/city-flight-challenge.js';
import {createPracticeAttempt} from '../dist/city-flight-review.js';
import {createCityFlightUI} from '../dist/city-flight-ui.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {prepare,DT} from './route-driver-3.21.mjs';

const clone=structuredClone,evidence=[];
async function test(name,run){const result=await run();evidence.push({name,status:'passed',...result});console.log('PASS: '+name);}
function capture(sim,context='city',steps=24){
  const recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=>context});recorder.start({name:'Portable restore / original physical route'});
  for(let i=0;i<steps;i++){const input=recorder.beforeStep({throttle:.15}),t=sim.advanceFixed(input,DT);recorder.afterStep(t,input,DT);}
  return recorder.finish();
}
const source=new RoadsterSim(),destination=new RoadsterSim();prepare(source);
const record=capture(source),snapshot=record.initialSnapshot.physical;

await test('Complete city record restores its route surface without a presentation configuration',()=>{
  assert.equal(record.initialSnapshot.sceneConfiguration,null);
  const original=JSON.stringify(record),before=destination.exportState();
  const checked=preflightExperimentRestore({snapshot,context:'city'},destination);
  assert.notEqual(checked.sim,destination);assert.deepEqual(destination.exportState(),before);
  assert.deepEqual(checked.sim.getRouteSurface(),source.getRouteSurface());
  const playback=new ExperimentPlayback(record,{sim:checked.sim});
  for(let i=0;i<record.stepCount;i++){const t=checked.sim.advanceFixed(playback.nextInput(),DT);playback.afterStep(t);}
  const verdict=playback.reproduction();assert.equal(verdict.status,'matched');assert.equal(JSON.stringify(record),original);
  return{raw:snapshot.geometrySignature,portable:snapshot.geometryIdentity,route:checked.sim.getRouteSurface().descriptor.id,steps:record.stepCount,reproduction:verdict.status};
});

await test('Representable geometry perturbation changes raw provenance but preserves canonical compatibility',()=>{
  const geometry=destination.geometry.find(g=>g.id==='arch-0'),body=destination.world.bodies.find(b=>b.userData?.id===geometry.id),original=geometry.position[1];
  const delta=Number.EPSILON*Math.max(1,Math.abs(original));geometry.position[1]+=delta;body.position.y=geometry.position[1];
  try{
    const changed=destination.exportState();assert.notEqual(changed.geometrySignature,snapshot.geometrySignature);assert.deepEqual(changed.geometryIdentity,snapshot.geometryIdentity);
    const before=destination.exportState();preflightExperimentRestore({snapshot,context:'city'},destination);assert.deepEqual(destination.exportState(),before);
    destination.importState(snapshot);assert.equal(destination.getRouteSurface().descriptor.id,source.getRouteSurface().descriptor.id);
    return{perturbationM:geometry.position[1]-original,rawBefore:snapshot.geometrySignature,rawAfter:changed.geometrySignature,portable:changed.geometryIdentity.signature,scope:'Numerical last-bit fixture; actual Chrome/Node identity comparison remains browser acceptance evidence.'};
  }finally{geometry.position[1]=original;body.position.y=original;}
});

await test('Real geometry, shape, type and body ordering differences reject without mutating the live state',()=>{
  const ground=destination.world.bodies.find(b=>b.userData?.id==='ground'),geometry=destination.geometry.find(g=>g.id==='ground');
  const cases=[
    ['metadata-position',()=>{geometry.position[0]+=.001;},()=>{geometry.position[0]-=.001;}],
    ['static-body-position',()=>{ground.position.x+=.001;},()=>{ground.position.x-=.001;}],
    ['static-body-orientation',()=>{ground.quaternion.setFromEuler(0,.001,0);},()=>{ground.quaternion.set(0,0,0,1);}],
    ['box-half-extent',()=>{ground.shapes[0].halfExtents.x+=.001;},()=>{ground.shapes[0].halfExtents.x-=.001;}],
    ['local-shape-position',()=>{ground.shapeOffsets[0].x+=.001;},()=>{ground.shapeOffsets[0].x-=.001;}],
    ['local-shape-orientation',()=>{ground.shapeOrientations[0].setFromEuler(.001,0,0);},()=>{ground.shapeOrientations[0].set(0,0,0,1);}],
    ['body-type',()=>{ground.type=4;},()=>{ground.type=2;}],
    ['shape-type',()=>{ground.shapes[0].type=2;},()=>{ground.shapes[0].type=4;}],
    ['body-order',()=>{[destination.world.bodies[1],destination.world.bodies[2]]=[destination.world.bodies[2],destination.world.bodies[1]];},()=>{[destination.world.bodies[1],destination.world.bodies[2]]=[destination.world.bodies[2],destination.world.bodies[1]];}],
  ];
  for(const [name,change,undo]of cases){change();try{const before=destination.exportState();assert.throws(()=>preflightExperimentRestore({snapshot,context:'city'},destination),/几何或世界类型/);assert.deepEqual(destination.exportState(),before,name);}finally{undo();}}
  const before=destination.exportState();assert.throws(()=>preflightExperimentRestore({snapshot,context:'lab'},destination),/上下文/);assert.deepEqual(destination.exportState(),before);
  return{rejected:cases.map(([name])=>name).concat('context-world-conflict'),minimumRealDifferenceM:.001};
});

await test('Optional portable identity cannot be bypassed; legacy raw signatures retain strict behavior',()=>{
  const legacy=clone(snapshot);delete legacy.geometryIdentity;
  destination.importState(legacy);
  for(const mutate of [s=>s.geometryIdentity=null,s=>s.geometryIdentity.version=99,s=>s.geometryIdentity.precision=1e-3,s=>s.geometryIdentity.signature='00000000',s=>s.geometrySignature='invalid']){
    const invalid=clone(snapshot);mutate(invalid);const before=destination.exportState();assert.throws(()=>destination.importState(invalid),/几何或世界类型/);assert.deepEqual(destination.exportState(),before);
  }
  const differentRaw=clone(legacy);differentRaw.geometrySignature='00000000';assert.throws(()=>destination.importState(differentRaw),/几何或世界类型/);
  const ground=destination.world.bodies.find(b=>b.userData?.id==='ground');ground.position.x=.001;
  try{const before=destination.exportState();assert.throws(()=>preflightExperimentRestore({snapshot:legacy,context:'city'},destination),/几何或世界类型/);assert.deepEqual(destination.exportState(),before);}finally{ground.position.x=0;}
  const oldState=clone(legacy);delete oldState.state._routeSurface;destination.importState(oldState);assert.equal(destination.getRouteSurface(),null);
  return{legacySameRaw:'accepted',legacyDifferentRaw:'rejected',absentLegacyRoute:'explicit null',portableMismatchWithMatchingRaw:'rejected'};
});

await test('Full physical and resource validation occurs on an isolated solver before any live mutation',()=>{
  const cases=[['resource-ledger',s=>s.resourceAccounting.remainingJ=-1],['state',s=>delete s.state._observationSeed],['parameter',s=>s.params.wheelRadius=-1],['model',s=>s.modelVersion='0.0.0']];
  for(const [name,mutate]of cases){const invalid=clone(snapshot);mutate(invalid);const before=destination.exportState(),bytes=JSON.stringify(invalid);assert.throws(()=>preflightExperimentRestore({snapshot:invalid,context:'city'},destination));assert.deepEqual(destination.exportState(),before,name);assert.equal(JSON.stringify(invalid),bytes);}
  return{rejected:cases.map(([name])=>name)};
});

if(!process.env.JSDOM_MODULE_PATH)throw Error('JSDOM_MODULE_PATH is required: the console non-destructive rejection is part of this check');
const {JSDOM}=createRequire(import.meta.url)(process.env.JSDOM_MODULE_PATH);
const dom=new JSDOM('<main></main>',{url:'http://localhost/'}),oldDocument=globalThis.document;
globalThis.document=dom.window.document;dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
const live=new RoadsterSim({}, {world:'windlab'}),labRecord=capture(live,'lab'),notices=[],calls={cancel:0,commit:0,start:0};
let camera={mode:'chase',position:[3,4,5]},reject=false,archive=JSON.stringify(exportExperimentArchive([labRecord]));
const ui=createExperimentConsole({mount:dom.window.document.querySelector('main'),getSim:()=>live,getContext:()=> 'lab',getSceneConfiguration:()=>camera,
  storage:{getItem:()=>archive,setItem:(_key,value)=>{archive=value;}},notify:(message,kind)=>notices.push({message,kind}),
  onBeforeRestore:()=>{calls.cancel++;},onStart:()=>{calls.start++;},
  onRestoreExperiment:request=>{if(reject)throw Error('deliberate incompatible live geometry');const result=preflightExperimentRestore(request,live);if(request.validateOnly)return result.sim;calls.commit++;live.importState(request.snapshot);camera=clone(request.sceneConfiguration);return live;}});
try{
  await test('Console rejected replay keeps active recording, physical state, camera and cancellation ownership',()=>{
    ui.startRecording({name:'Do not cancel this recording'});const state=live.exportState(),view=clone(camera),before=clone(calls);reject=true;
    assert.throws(()=>ui.startReplay(labRecord),/deliberate incompatible/);assert.equal(ui.getState().recording,true);assert.deepEqual(live.exportState(),state);assert.deepEqual(camera,view);assert.deepEqual(calls,before);
    reject=false;const bad=clone(labRecord);bad.inputRuns[0].steps++;
    assert.throws(()=>ui.startReplay(bad),/输入数量和物理步数/);assert.equal(ui.getState().recording,true);assert.deepEqual(live.exportState(),state);assert.deepEqual(camera,view);assert.deepEqual(calls,before);
    return{geometryRejection:'no cancellation or mutation',recordValidationRejection:'no cancellation or mutation'};
  });
  await test('Failed replacement and return preserve existing replay and its original return point',()=>{
    const before=live.exportState(),view=clone(camera);ui.startReplay(labRecord);assert.equal(ui.getState().recording,false);assert.equal(ui.getState().replaying,true);
    const current=live.exportState(),priorCalls=clone(calls);reject=true;assert.throws(()=>ui.startReplay(labRecord),/deliberate incompatible/);assert.equal(ui.getState().replaying,true);assert.deepEqual(calls,priorCalls);assert.deepEqual(live.exportState(),current);
    const button=dom.window.document.querySelector('[data-ex-action="return-before-replay"]');button.click();assert.equal(ui.getState().replaying,true);assert.deepEqual(calls,priorCalls);assert.deepEqual(live.exportState(),current);assert.match(notices.at(-1).message,/deliberate incompatible/);assert.equal(button.disabled,false);
    reject=false;button.click();assert.equal(ui.getState().replaying,false);assert.deepEqual(live.exportState(),before);assert.deepEqual(camera,view);assert.equal(button.disabled,true);
    return{rejectedReplacement:'running replay and return point retained',rejectedReturn:'running replay and return point retained',successfulReturn:'original physical and presentation state restored'};
  });
  await test('Same-start practice accepts only verified geometry portability and keeps all other state exact',async()=>{
    const origin=new RoadsterSim({supplyMode:'bench'});origin.reset('harbor');for(let i=0;i<240;i++)origin.advanceFixed({brake:1},DT);
    const geometry=origin.geometry.find(g=>g.id==='arch-0'),body=origin.world.bodies.find(b=>b.userData?.id===geometry.id);
    geometry.position[1]+=Number.EPSILON*Math.max(1,Math.abs(geometry.position[1]));body.position.y=geometry.position[1];
    const challenge=new CityFlightChallenge(origin,{task:makeCityFlightTask({supplyMode:'bench'}),attemptClass:'practice'}).start();challenge.cancel('pilot_cancel');
    const source=challenge.result;validateCityFlightResult(source);const bytes=JSON.stringify(source),physical=source.liveExperiment.initialSnapshot.physical;
    const createSim=state=>new RoadsterSim(state.params,{world:state.worldType});
    const prepared=createPracticeAttempt(source,{createSim});assert.equal(prepared.initialStateLabel,source.liveExperiment.initialSnapshot.stateLabel);
    assert.notEqual(prepared.sim.exportState().geometrySignature,physical.geometrySignature);assert.notEqual(contentLabel(prepared.sim.exportState()),prepared.initialStateLabel);
    assert.equal(matchesRestoredSnapshot(prepared.sim,physical),true);
    const integral=prepared.sim._heightIntegral;prepared.sim._heightIntegral=integral+1e-12;assert.equal(matchesRestoredSnapshot(prepared.sim,physical),false);prepared.sim._heightIntegral=integral;
    assert.throws(()=>createPracticeAttempt(source,{createSim:state=>{const sim=createSim(state);sim.world.bodies.find(b=>b.userData?.id==='ground').position.x=.001;return sim;}}),/几何或世界类型/);
    const invalid=clone(source);invalid.liveExperiment.initialSnapshot.physical.geometryIdentity.version=99;assert.throws(()=>createPracticeAttempt(invalid,{createSim}),/几何或世界类型/);
    const legacy=clone(source);delete legacy.liveExperiment.initialSnapshot.physical.geometryIdentity;legacy.liveExperiment.initialSnapshot.stateLabel=contentLabel(legacy.liveExperiment.initialSnapshot.physical);
    assert.throws(()=>createPracticeAttempt(legacy,{createSim}),/几何或世界类型/);
    const nativeLegacy=clone(source);nativeLegacy.liveExperiment.initialSnapshot.physical=prepared.sim.exportState();delete nativeLegacy.liveExperiment.initialSnapshot.physical.geometryIdentity;nativeLegacy.liveExperiment.initialSnapshot.stateLabel=contentLabel(nativeLegacy.liveExperiment.initialSnapshot.physical);
    const legacyPrepared=createPracticeAttempt(nativeLegacy,{createSim});
    assert.equal(matchesRestoredSnapshot(legacyPrepared.sim,legacyPrepared.initialSnapshot),true);
    legacyPrepared.sim.world.bodies.find(b=>b.userData?.id==='ground').position.x=.001;
    assert.throws(()=>matchesRestoredSnapshot(legacyPrepared.sim,legacyPrepared.initialSnapshot),/几何或世界类型/);
    assert.throws(()=>createPracticeAttempt(nativeLegacy,{createSim:state=>{const sim=createSim(state);sim.world.bodies.find(b=>b.userData?.id==='ground').position.x=.001;return sim;}}),/几何或世界类型/);
    const mount=dom.window.document.createElement('section');dom.window.document.body.append(mount);let active=origin,mode='live';const store=new Map();
    const city=createCityFlightUI({mount,getSim:()=>active,getSessionMode:()=>mode,storage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},onPractice:value=>{active=value.sim;mode='practice';}});
    try{
      await city.preparePractice(source);assert.equal(city.getState().practicePrepared,true);
      const x=active.body.position.x;active.body.position.x=x+1e-12;assert.throws(()=>city.start(),/初态已改变|initial state changed/);assert.equal(city.getState().practicePrepared,true);active.body.position.x=x;
      city.start();assert.equal(city.getState().running,true);assert.equal(city.getState().live.attemptClass,'practice');city.cancel('pilot_cancel');
      assert.equal(city.getRecords().at(-1).parentRunId,source.runId);assert.equal(city.getRecords().at(-1).score.eligible,false);assert.equal(JSON.stringify(source),bytes);
    }finally{city.dispose();mount.remove();}
    return{sourceRaw:physical.geometrySignature,destinationRaw:prepared.sim.exportState().geometrySignature,portable:physical.geometryIdentity.signature,originalSourceLabel:prepared.initialStateLabel,nonGeometryStateTolerance:0,legacyDifferentRaw:'rejected',legacyMatchingRaw:'accepted',uiPractice:'started after portable restoration; actual state changes still rejected',sourceEvidence:'unchanged'};
  });
}finally{ui.dispose();dom.window.close();if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
writeFileSync(new URL(`../qa/experiment-restore-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',evidence,scope:'Full solver snapshot and DOM checks. Synthetic ULP portability is not actual cross-engine trajectory proof; browser acceptance is recorded separately. No historical record is modified or assigned a new identity.'},null,2)+'\n');
