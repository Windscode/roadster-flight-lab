import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {CITY} from '../dist/city-data.js';
import {ControlCaptureProtocol,CONTROL_CAPTURE_PROTOCOLS,CONTROL_CAPTURE_STARTS,checkControlCaptureClearance} from '../dist/driving-capture.js';
import {ExperimentRecorder,executeExperiment,validateExperimentRecord,saveExperimentArchive,loadExperimentArchive} from '../dist/experiment-records.js';

const copy=v=>JSON.parse(JSON.stringify(v));
const DT=1/120,evidence=[],hash=path=>createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex');
function flatSim(params={}){
  const sim=new RoadsterSim(params);
  // Declared numerical fixture only: this removes scene geometry for isolated
  // protocol evaluation, never in the application or the control procedure.
  for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
  sim.geometry=sim.geometry.filter(g=>g.id==='ground');sim.reset('free');
  return sim;
}
function settle(sim,steps=240){for(let i=0;i<steps;i++)sim.advanceFixed({},DT);return sim;}
function host(sim,{sceneConfiguration={source:'Declared flat numerical fixture; no rendering. The website city is unchanged.'},now}={}){
  const records=[],recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=> 'city',getSceneConfiguration:()=>sceneConfiguration,onFinish:r=>records.push(r),...(now?{now}:{})});
  const capture=new ControlCaptureProtocol({getSim:()=>sim,startRecording:o=>recorder.start(o),stopRecording:(reason,status)=>recorder.finish(status,reason),recordEvent:(type,detail)=>recorder.event(type,detail),getRecordingState:()=>recorder.getState(),getRecords:()=>records});
  const tick=(input={})=>{const command=capture.beforeStep(DT,input),effective=recorder.beforeStep(command),t=sim.advanceFixed(effective,DT);recorder.afterStep(t,t.driverInput,DT);capture.afterStep(t,DT);return t;};
  return{sim,recorder,records,capture,tick};
}
function executeHost(h,{framesHz=120,maximumSteps=9000,inputAt=()=>({})}={}){
  let accumulator=0,ticks=0,frames=0;while(h.capture.getState().active&&ticks<maximumSteps){accumulator+=1/framesHz;while(accumulator>=DT-1e-12&&h.capture.getState().active){h.tick(inputAt(ticks));accumulator-=DT;ticks++;}frames++;}assert.equal(h.capture.getState().active,false,'Protocol must finish or explicitly fail within its bounds.');return{...h.capture.getResult(),displayDispatch:{framesHz,frames,ticks,scope:'Synthetic display scheduling only, not browser FPS.'}};
}
async function test(name,run){const data=await run();evidence.push({name,status:'PASS',...data});console.log('PASS: '+name);}

const roadResults={};
await test('54 / 90 km/h are reached from rest through recorded physical throttle; every sample in the 2 s gate passes and steering has a full 4 s interval',()=>{
  for(const id of ['steer-54','steer-90']){
    const h=host(settle(flatSim()));assert.ok(Math.abs(h.sim.telemetry().forwardSpeedKmh)<.01);const before=JSON.stringify(h.sim.exportState());h.capture.start(id);assert.equal(JSON.stringify(h.records[0]?.initialSnapshot?.physical??h.recorder.active.initialSnapshot.physical),before);const result=executeHost(h);assert.equal(result.status,'completed',result.reason);validateExperimentRecord(result.record);
    const phases=result.phases,stable=result.metrics.stableSpeedWindow,steer=phases.find(p=>p.phase==='steer');assert.ok(stable&&steer);assert.equal(stable.endStep-stable.startStep,240);assert.equal(result.metrics.measuredSteeringDurationS,4);assert.ok(Math.abs(result.metrics.steerStartSpeedKmh-CONTROL_CAPTURE_PROTOCOLS.find(p=>p.id===id).speedKmh)<.8);assert.equal(result.record.stepCount,result.record.inputRuns.reduce((s,r)=>s+r.steps,0));
    const expanded=result.record.inputRuns.flatMap(run=>Array.from({length:run.steps},()=>run.input));assert.ok(expanded.slice(0,steer.step).some(i=>i.throttle>0));assert.ok(expanded.slice(steer.step,steer.step+480).every(i=>i.steer===1&&i.throttle===result.metrics.frozenThrottle));assert.ok(result.record.events.some(e=>e.type==='control_capture_result'));assert.equal(result.record.events.some(e=>e.kind==='command'&&['reset','refillGas','setPoseTarget'].includes(e.method)),false);roadResults[id]=result;
  }
  return{scope:'Actual solver, flat numerical fixture; no WebGL or real input device.',cases:Object.fromEntries(Object.entries(roadResults).map(([id,r])=>[id,{recordId:r.recordId,steps:r.steps,metrics:r.metrics,recordBytes:Buffer.byteLength(JSON.stringify(r.record))}]))};
});

await test('Every explicit outer-city zero-speed setup completes against the intact city world, including an immediate start before the first suspension step',async()=>{
  const cases=[],records=[];
  for(const [id,start]of Object.entries(CONTROL_CAPTURE_STARTS)){
    const sim=new RoadsterSim(),b=sim.body;
    // This is declared SCENE INITIALIZATION before the record, equivalent to
    // the UI's explicit at-rest reset. It is never performed inside capture.
    b.position.set(...start.position);b.quaternion.setFromEuler(0,start.yaw,0,'YXZ');b.previousPosition.copy(b.position);b.previousQuaternion.copy(b.quaternion);b.aabbNeedsUpdate=true;
    const bodyCount=sim.world.bodies.length,geometry=JSON.stringify(sim.getWorldGeometry()),initial=sim.exportState();assert.equal(sim.telemetry().speedKmh,0);assert.equal(sim.telemetry().contactCount,0);assert.ok(sim.wheelStates.every(w=>w.angularVelocityRadS===0));
    // Deterministic report metadata makes this generated numerical fixture
    // byte-reproducible. This is not a browser/device capture timestamp.
    const fixtureTime=`2026-10-20T00:00:00.${String(cases.length).padStart(3,'0')}Z`;
    const h=host(sim,{now:()=>fixtureTime,sceneConfiguration:{source:'Actual complete city collision world in a numerical execution; no renderer or device timing.',explicitAtRestSetup:copy(start),timestampScope:'Fixed numerical-fixture metadata, not the time of a real browser capture.'}});
    const actualWallClock=Date.now;
    try{Date.now=()=>Date.parse(fixtureTime);h.capture.start(id,{steerSign:start.steerSign});}
    finally{Date.now=actualWallClock;}
    assert.deepEqual(h.recorder.active.initialSnapshot.physical,initial);
    const result=executeHost(h);assert.equal(result.status,'completed',`${id}: ${result.reason}`);assert.equal(sim.world.bodies.length,bodyCount);assert.equal(JSON.stringify(sim.getWorldGeometry()),geometry);const steeringSamples=result.samples.filter(s=>s.phase==='steer');assert.ok(steeringSamples.every(s=>s.contactCount===4));assert.equal(result.metrics.measuredSteeringDurationS,4);validateExperimentRecord(result.record);
    const surfaceIds={},gridDistances=[];
    for(const sample of steeringSamples){
      const p=sample.position,hit=sim.traceSurface({...p,y:p.y+1},{x:0,y:-1,z:0},3),surfaceId=sim._ray.body?.userData?.id;
      assert.ok(hit&&hit.normal.y>.999&&Math.abs(hit.point.y)<1e-7,`${id}: measured point must remain on the unchanged level city surface`);
      assert.equal(surfaceId,'ground',`${id}: a sidewalk/platform is not the declared road surface`);surfaceIds[surfaceId]=(surfaceIds[surfaceId]||0)+1;
      gridDistances.push(Math.min(Math.abs(p.x-Math.round(p.x/CITY.block)*CITY.block),Math.abs(p.z-Math.round(p.z/CITY.block)*CITY.block)));
    }
    const surfaceClassification={scope:'20 Hz vehicle-centre samples on existing city street/intersection asphalt. Not a continuous geometry sweep or a lane-keeping criterion; physical contact/collision guards run at 120 Hz.',samples:steeringSamples.length,surfaceIds,nominalGridStreetWidthM:CITY.roadWidth,maximumDistanceFromNearestGridAxisM:Math.max(...gridDistances),outsideNominalStreetStripSamples:gridDistances.filter(d=>d>CITY.roadWidth/2).length};
    const replay=await executeExperiment(result.record,{createSim:()=>new RoadsterSim(),yieldEvery:0});assert.equal(replay.reproduction.status,'matched');cases.push({protocol:id,explicitAtRestSetup:start,initialContactCount:0,cityBodyCount:bodyCount,geometryUnchanged:true,surfaceClassification,metrics:result.metrics,phases:result.phases,recordId:result.recordId,reproduction:replay.reproduction.status});records.push(result.record);
  }
  writeFileSync(new URL('../qa/fixtures/numerical-control-capture-city-3.11.json',import.meta.url),JSON.stringify({schema:'roadster.live-experiment-library',version:1,scope:'Numerical fixed-step runs in the intact city collision world. Explicit at-rest setup precedes recording. These are not captured IAB frames or real keyboard-device evidence.',records})+'\n');
  return{scope:'Intact website city geometry and dynamics, with declared zero-speed initialization; no WebGL.',cases};
});

await test('The stable-speed gate and fixed input history are independent of 60 / 120 / 240 Hz synthetic display dispatch',()=>{
  const rows=[];for(const fps of [60,120,240]){const h=host(settle(flatSim()));h.capture.start('steer-90');const result=executeHost(h,{framesHz:fps});assert.equal(result.status,'completed');assert.deepEqual(result.record.finalSnapshot.physical,roadResults['steer-90'].record.finalSnapshot.physical);assert.deepEqual(result.record.inputRuns,roadResults['steer-90'].record.inputRuns);assert.deepEqual(result.metrics,roadResults['steer-90'].metrics);rows.push({dispatchHz:fps,steps:result.steps,gate:result.metrics.stableSpeedWindow,terminalStateEqual:true,inputJournalEqual:true});}return{rows,actualBrowserFrameRate:false};
});

const airborne=flatSim();settle(airborne);airborne.setStabilizationMode('level');airborne.setParam('climbRateMps',8);for(let i=0;i<120*8;i++)airborne.advanceFixed({lift:1});for(let i=0;i<120*8;i++)airborne.advanceFixed({});airborne.setParam('climbRateMps',3);const flightInitial=airborne.exportState();assert.ok(airborne.telemetry().altitude>20);const flightResults={};
await test('E8 release and Q landing retain actual extra climb, throughput and closed-valve ground confirmation; original response setting is restored by a journaled command',()=>{
  const sim=flatSim();sim.importState(flightInitial);const h=host(sim);h.capture.start('vertical-8-release');const result=executeHost(h);assert.equal(result.status,'completed',result.reason);assert.ok(result.metrics.releaseVerticalMps>7.8);const brakingDistance=result.metrics.releaseVerticalMps**2/(2*sim.params.verticalAccelerationMps2);assert.ok(result.metrics.releaseClimbDistanceM>.75*brakingDistance&&result.metrics.releaseClimbDistanceM<1.6*brakingDistance,'Release must retain the finite, acceleration-limited stopping distance; measured '+result.metrics.releaseClimbDistanceM+' m, constant-acceleration reference '+brakingDistance+' m');assert.ok(result.metrics.externalGasUsedKg>0);assert.equal(result.metrics.onboardGasUsedKg,0);assert.ok(result.metrics.groundThrustN<10);assert.ok(result.metrics.groundMassFlowKgS<.05);assert.equal(sim.params.climbRateMps,3);assert.deepEqual(result.record.events.filter(e=>e.kind==='command'&&e.method==='setParam').map(e=>e.args),[['climbRateMps',8],['climbRateMps',3]]);validateExperimentRecord(result.record);flightResults.vertical=result;return{metrics:result.metrics,steps:result.steps,recordId:result.recordId};
});

await test('Z / B and 1 / 2 are actual rate inputs, followed by release and G; signed pose excursions, continuous samples and recovery costs survive in the same record',()=>{
  const rows=[];for(const id of ['roll-z-level','roll-b-level','pitch-1-level','pitch-2-level']){
    const sim=flatSim();sim.importState(flightInitial);const h=host(sim);h.capture.start(id);const result=executeHost(h);assert.equal(result.status,'completed',result.reason);validateExperimentRecord(result.record);assert.equal(result.metrics.finalTiltDeg<2,true);assert.ok(result.metrics.recoveryTimeS>1);assert.ok(result.metrics.recoveryHeightLossM>=0);const axis=id.startsWith('roll')?'roll':'pitch';assert.ok(Math.max(...result.samples.map(s=>Math.abs(s[axis+'Deg'])))>(axis==='roll'?40:15));assert.deepEqual(result.record.events.filter(e=>e.kind==='command'&&e.method==='setStabilizationMode').map(e=>e.args[0]),['level','off','level']);const fullInput=result.record.inputRuns.flatMap(run=>Array.from({length:run.steps},()=>run.input));assert.equal(fullInput.filter(i=>Math.abs(i[axis]||0)===1).length,108);flightResults[id]=result;rows.push({id,metrics:result.metrics,recordId:result.recordId,retainedPoseSamples:result.samples.length});
  }return{rows,scope:'Actual fixed-step solver and input journal, not live IAB driving.'};
});

await test('Protocol-enriched JSON still validates, persists without cutting events, and replays with the shared exact-input engine',async()=>{
  const selected=[roadResults['steer-90'].record,flightResults.vertical.record,flightResults['roll-z-level'].record],storage=new Map(),api={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  // The normal storage compactor may reduce display rows; it must retain the
  // protocol result event, full controller commands and per-step input runs.
  saveExperimentArchive(api,selected);const stored=loadExperimentArchive(api);assert.equal(stored.warning,null);const rows=[];
  for(const original of selected){const record=stored.records.find(r=>r.id===original.id);validateExperimentRecord(record);assert.deepEqual(record.events,original.events);assert.deepEqual(record.inputRuns,original.inputRuns);const result=await executeExperiment(record,{createSim:()=>flatSim(),yieldEvery:0});assert.equal(result.status,'completed');assert.equal(result.reproduction.status,'matched',JSON.stringify(result.reproduction));rows.push({recordId:record.id,reproduction:result.reproduction.status,retainedControlSamples:record.events.find(e=>e.type==='control_capture_result').detail.samples.length,bytes:Buffer.byteLength(JSON.stringify(record))});}
  return{rows,libraryBytes:Buffer.byteLength([...storage.values()][0]),statisticsNotRecomputedFromDisplayRows:true};
});

await test('Pilot takeover, an unmet speed gate and obstacle preflight keep failed/cancelled evidence without initializing a faster car or deleting city colliders',()=>{
  const takeover=host(settle(flatSim()));takeover.capture.start('steer-54');const cancelled=executeHost(takeover,{inputAt:step=>step===120?{steer:-.5}:{}});assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.record.stepCount,120);assert.ok(cancelled.record.events.some(e=>e.type==='control_capture_takeover'));validateExperimentRecord(cancelled.record);
  const weak=host(settle(flatSim({motorPower:500})));weak.capture.start('steer-90');const timedOut=executeHost(weak);assert.equal(timedOut.status,'timeout');assert.equal(timedOut.metrics.steerStartedAtS,null);assert.ok(timedOut.metrics.stableSpeedWindow===null);validateExperimentRecord(timedOut.record);
  const city=settle(new RoadsterSim()),bodyCount=city.world.bodies.length,geometry=JSON.stringify(city.getWorldGeometry()),blocked=host(city);city.reset('city');settle(city);blocked.capture.start('steer-90');const failure=blocked.capture.getResult();assert.equal(failure.status,'failed');assert.equal(failure.steps,0);assert.equal(city.world.bodies.length,bodyCount);assert.equal(JSON.stringify(city.getWorldGeometry()),geometry);assert.ok(failure.record.events.find(e=>e.type==='control_capture_clearance'));validateExperimentRecord(failure.record);
  return{cancelledSteps:cancelled.steps,timeoutSteps:timedOut.steps,neverSteeredWithoutStableGate:true,cityPreflightFailure:failure.reason,cityGeometryUnchanged:true};
});

await test('Operator vertical-setting changes survive cancellation, and an externally ended recorder links its exact prefix instead of showing the previous run',async()=>{
  const editedSim=flatSim();editedSim.importState(flightInitial);const edited=host(editedSim);edited.capture.start('vertical-8-release');for(let i=0;i<60;i++)edited.tick();editedSim.setParam('climbRateMps',6);edited.capture.beforeStep(DT,{});const cancelled=edited.capture.getResult();assert.equal(cancelled.status,'cancelled');assert.equal(editedSim.params.climbRateMps,6);assert.equal(cancelled.record.finalSnapshot.physical.params.climbRateMps,6);validateExperimentRecord(cancelled.record);
  const stoppedSim=flatSim();stoppedSim.importState(flightInitial);const stopped=host(stoppedSim);stopped.capture.start('vertical-8-release');for(let i=0;i<60;i++)stopped.tick();const source=stopped.recorder.finish('completed','Explicit research-console stop');stopped.capture.beforeStep(DT,{});const prefix=stopped.capture.getResult();assert.equal(prefix.status,'cancelled');assert.equal(prefix.recordId,source.id);assert.equal(prefix.resultEventInRecord,false);assert.equal(prefix.cleanupAfterRecord,true);assert.equal(prefix.steps,60);assert.equal(stoppedSim.params.climbRateMps,3);assert.equal(source.finalSnapshot.physical.params.climbRateMps,8);assert.equal(source.events.some(e=>e.type==='control_capture_result'),false);validateExperimentRecord(source);const replay=await executeExperiment(source,{createSim:()=>flatSim(),yieldEvery:0});assert.equal(replay.reproduction.status,'matched');
  stopped.capture.start('vertical-8-release');assert.equal(stopped.capture.getResult(),null,'An active new run must not display or export the previous result.');stopped.capture.cancel();
  return{operatorNewRateMps:editedSim.params.climbRateMps,recordedPrefixSteps:source.stepCount,protocolCompleted:false,prefixReproduction:replay.reproduction.status,postRecordRestoreExplicit:true};
});

const sources=['dist/driving-capture.js','dist/physics.js','dist/city-data.js','dist/experiment-records.js','dist/experiment-reproduction.js','tests/control-capture-3.10.test.mjs'];
writeFileSync(new URL('../qa/control-capture-3.11.json',import.meta.url),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Fixed-step physical solver, declared flat numerical fixtures, actual city read-only preflight and existing record/replay/storage. Does not establish real WebGL frames, live keyboard timing or GPU performance.',sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(p)])),evidence},null,2)+'\n');
