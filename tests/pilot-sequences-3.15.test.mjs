import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RoadsterSim} from '../dist/physics.js';
import {RoadsterSim as BeforeSim} from './fixtures/pilot-input-3.14-before/physics.js';
import {driverAxes} from '../dist/controls.js';
import {InputSession} from '../dist/input-session.js';
import {getRuntimeIdentity} from '../dist/runtime-identity.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

// This is a received-event integration test, not a hardware keyboard test.
// Browser dispatch -> production InputSession -> production driverAxes ->
// actual advanceFixed(1/120). Only the small G action adapter is test-owned;
// it follows main.js's non-repeat action branch and setStabilizationMode call.
const require=createRequire(import.meta.url);
const jsdomModule=process.env.JSDOM_MODULE_PATH||process.argv[2]||'jsdom';
let JSDOM;
try{({JSDOM}=require(jsdomModule));}catch(error){
 throw new Error('JSDOM is required. Set JSDOM_MODULE_PATH to the installed module path or pass that path as argv[2]. '+error.message);
}
const HZ=120,DT=1/HZ,STEPS=300,W_RELEASE=180,FIRST_PRESS=9,FIRST_RELEASE=90,RELEASE_GAP=4;
const sha=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const vec=value=>({x:value.x,y:value.y,z:value.z});
const quat=value=>({...vec(value),w:value.w});
const checks=[],results=[],traceRows=[];
const check=(name,passed,detail={})=>{checks.push({name,passed:!!passed,...detail});console.log(`${passed?'PASS':'FAIL'} ${name}`);};
const physical=sim=>({position:vec(sim.body.position),velocity:vec(sim.body.velocity),quaternion:quat(sim.body.quaternion),angularVelocity:vec(sim.body.angularVelocity),gasMassKg:sim.gasMass,gasTemperatureK:sim.gasTemperature,massKg:sim.body.mass,wheels:sim.wheelStates.map(w=>({id:w.id,angularVelocityRadS:w.angularVelocityRadS,rotationRad:w.rotation,suspensionM:w.suspensionLength,steerRad:w.steer,contact:w.contact,contactObjectId:w.contactObjectId,normalLoadN:w.normalLoadN})),nozzles:sim._nozzles.map(n=>({id:n.id,forceN:n.force,commandN:n.command,maxForceN:n.maxForce}))});

// Pairwise selections, not a claim of exhaustive combinations. All 12 initial
// support x G x speed combinations occur; both press/release orders, same-frame
// delivery, 1/4 physical-step gaps, G changes while held, and repeats occur.
const selections=[
 {id:'air-g-on-0-e1-gap1-reverse',air:true,g:true,speedKmh:0,order:['KeyE','Digit1'],gap:1,release:'reverse'},
 {id:'air-g-on-20-1e-gap1-forward',air:true,g:true,speedKmh:20,order:['Digit1','KeyE'],gap:1,release:'forward'},
 {id:'air-g-on-50-e1-same-forward',air:true,g:true,speedKmh:50,order:['KeyE','Digit1'],gap:0,release:'forward'},
 {id:'air-g-off-0-1e-gap4-reverse',air:true,g:false,speedKmh:0,order:['Digit1','KeyE'],gap:4,release:'reverse'},
 {id:'air-g-off-20-e1-gap4-reverse',air:true,g:false,speedKmh:20,order:['KeyE','Digit1'],gap:4,release:'reverse'},
 {id:'air-g-off-50-1e-same-forward',air:true,g:false,speedKmh:50,order:['Digit1','KeyE'],gap:0,release:'forward'},
 {id:'ground-g-on-0-e1-gap4-forward',air:false,g:true,speedKmh:0,order:['KeyE','Digit1'],gap:4,release:'forward'},
 {id:'ground-g-on-20-1e-gap4-reverse',air:false,g:true,speedKmh:20,order:['Digit1','KeyE'],gap:4,release:'reverse'},
 {id:'ground-g-on-50-1e-same-forward',air:false,g:true,speedKmh:50,order:['Digit1','KeyE'],gap:0,release:'forward'},
 {id:'ground-g-off-0-1e-gap1-forward',air:false,g:false,speedKmh:0,order:['Digit1','KeyE'],gap:1,release:'forward'},
 {id:'ground-g-off-20-e1-gap1-reverse',air:false,g:false,speedKmh:20,order:['KeyE','Digit1'],gap:1,release:'reverse'},
 {id:'ground-g-off-50-e1-same-forward',air:false,g:false,speedKmh:50,order:['KeyE','Digit1'],gap:0,release:'forward'},
 {id:'air-g-off-to-on-20-e1',air:true,g:false,speedKmh:20,order:['KeyE','Digit1'],gap:1,release:'forward',toggleAt:36},
 {id:'air-g-on-to-off-50-1e',air:true,g:true,speedKmh:50,order:['Digit1','KeyE'],gap:4,release:'forward',toggleAt:36},
 {id:'ground-g-off-to-on-0-1e',air:false,g:false,speedKmh:0,order:['Digit1','KeyE'],gap:4,release:'reverse',toggleAt:24},
 {id:'ground-g-on-to-off-20-e1',air:false,g:true,speedKmh:20,order:['KeyE','Digit1'],gap:1,release:'reverse',toggleAt:24},
 {id:'ground-g-on-50-pitch-only',air:false,g:true,speedKmh:50,order:['Digit1'],gap:0,release:'forward'},
 {id:'ground-g-off-to-on-0-pitch-only',air:false,g:false,speedKmh:0,order:['Digit1'],gap:0,release:'forward',toggleAt:24}
];
function schedule(config){
 let insertion=0;const events=[];
 const add=(step,type,code,repeat=false)=>events.push({step,type,code,repeat,order:insertion++});
 add(1,'keydown','KeyW');
 config.order.forEach((code,i)=>add(FIRST_PRESS+i*config.gap,'keydown',code));
 add(30,'keydown','Digit1',true);add(32,'keydown','KeyW',true);
 if(config.order.includes('KeyE'))add(34,'keydown','KeyE',true);
 if(config.toggleAt){add(config.toggleAt,'keydown','KeyG');add(config.toggleAt+1,'keydown','KeyG',true);add(config.toggleAt+2,'keyup','KeyG');}
 const release=config.release==='reverse'?[...config.order].reverse():config.order;
 release.forEach((code,i)=>add(FIRST_RELEASE+i*RELEASE_GAP,'keyup',code));
 add(W_RELEASE,'keyup','KeyW');
 return events.sort((a,b)=>a.step-b.step||a.order-b.order);
}
function fixture(Sim,config){
 const sim=new Sim({supplyMode:'bench'});
 // A declared isolated horizontal-ground fixture keeps the input timing test
 // independent of unrelated city collisions. It is not city route evidence.
 for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
 sim.geometry=sim.geometry.filter(g=>g.id==='ground');sim.reset('free');
 sim.body.position.set(0,config.air?20:.62,-350);
 if(!config.air)for(let i=0;i<180;i++)sim.advanceFixed({brake:1},DT);
 else sim.setMode('hover');
 sim.setStabilizationMode(config.g?'level':'off');
 // These are pre-recording initial conditions, not controls or corrections.
 // Wheel angular speeds match the prescribed +Z rolling speed at t=0.
 sim.body.velocity.set(0,0,config.speedKmh/3.6);
 for(const wheel of sim.wheelStates)wheel.angularVelocityRadS=config.speedKmh/3.6/sim.params.wheelRadius;
 sim.body.wakeUp();
 return sim;
}
function createIngress(sim){
 const dom=new JSDOM('<!doctype html><body><main tabindex="0"></main></body>',{url:'https://input-fixture.invalid/'});
 const keys=new Set(),pending=[],journalEvents=[];
 const session=new InputSession({keys,capacity:STEPS+200,onEvent:e=>journalEvents.push(copy(e)),onRelease:reason=>sim.releasePilotInput?.(reason)});
 let eventStep=0;
 dom.window.addEventListener('keydown',event=>{
  let reason='unhandled',accepted=false;
  if(['KeyW','KeyE','Digit1'].includes(event.code)){event.preventDefault();session.down(event,true,'pilot');reason='pilot';accepted=true;}
  else if(event.code==='KeyG'){
   if(event.repeat)reason='repeat-action-ignored';
   else{event.preventDefault();session.note('keydown',{code:event.code,repeat:false,accepted:true,reason:'action'});sim.setStabilizationMode(sim.stabilizationMode==='level'?'off':'level');reason='action';accepted=true;}
  }
  pending.push({receivedBeforeStep:eventStep,type:event.type,code:event.code,key:event.key,repeat:event.repeat,isTrusted:event.isTrusted,keyboardEventInstance:event instanceof dom.window.KeyboardEvent,accepted,reason,defaultPrevented:event.defaultPrevented,pressed:[...keys].sort(),stabilizationMode:sim.stabilizationMode,journalSequence:session.serial});
 });
 dom.window.addEventListener('keyup',event=>{
  session.up(event);pending.push({receivedBeforeStep:eventStep,type:event.type,code:event.code,key:event.key,repeat:event.repeat,isTrusted:event.isTrusted,keyboardEventInstance:event instanceof dom.window.KeyboardEvent,accepted:true,reason:'release',defaultPrevented:event.defaultPrevented,pressed:[...keys].sort(),stabilizationMode:sim.stabilizationMode,journalSequence:session.serial});
 });
 return{keys,session,journalEvents,dispatch(event){eventStep=event.step;const key={KeyW:'w',KeyE:'e',Digit1:'1',KeyG:'g'}[event.code];dom.window.dispatchEvent(new dom.window.KeyboardEvent(event.type,{code:event.code,key,repeat:event.repeat,bubbles:true,cancelable:true}));},drain(){return pending.splice(0);},close(){dom.window.close();}};
}
function run(config,variant,Sim){
 const sim=fixture(Sim,config),ingress=createIngress(sim),events=schedule(config);
 const initialTime=sim.simTime,initial=physical(sim),initialState=sim.exportState(),steps=[],physicalRows=[];
 let exception=null;
 for(let step=1;step<=STEPS;step++){
  for(const event of events.filter(e=>e.step===step))ingress.dispatch(event);
  const received=ingress.drain(),requested=driverAxes(ingress.keys),beforeMode=sim.mode;
  let t;try{t=sim.advanceFixed(requested,DT);}catch(error){exception={name:error.name,message:error.message,step};break;}
  ingress.session.step(t,t.driverInput);
  const ratios=t.nozzles.filter(n=>n.maxForce>0).map(n=>({id:n.id,command:n.command/n.maxForce,force:n.force/n.maxForce}));
  const actual=physical(sim),contacts=sim.getContactDiagnostics();
  const row={recordType:'step',caseId:config.id,variant,step,relativeTimeS:step*DT,simTime:t.simTime,received,pressed:[...ingress.keys].sort(),requested,applied:t.driverInput,beforeMode,mode:t.mode,stabilizationMode:t.stabilizationMode,stabilizationActive:t.stabilizationActive,pilotIntent:t.pilotIntent??null,reference:t.reference,
   state:{...actual,pitchDeg:t.pitchDeg,rollDeg:t.rollDeg,speedKmh:t.speedKmh,contactCount:t.contactCount,contacts},
   wrench:{desired:t.desiredWrench,achieved:t.achievedWrench,allocationResidual:t.allocationError,pressureLimited:t.pressureLimited,saturatedNozzles:t.controlAuthority.saturatedNozzles,ratios},
   inputSessionStep:copy(ingress.session.events.at(-1)),fault:t.failure??t.fault??null};
  steps.push(row);physicalRows.push(JSON.stringify(actual));traceRows.push(JSON.stringify(row));
  if(t.fault)break;
 }
 const sessionExport=ingress.session.export({variant,...getRuntimeIdentity()}),last=steps.at(-1),pitchRows=steps.filter(r=>r.requested.pitch===1),legalPitch=pitchRows.filter(r=>r.mode==='hover'),groundPitch=pitchRows.filter(r=>r.mode==='drive'&&r.state.contactCount>=2);
 const first=row=>row?{step:row.step,relativeTimeS:row.relativeTimeS,mode:row.mode,stabilizationMode:row.stabilizationMode,pitchDeg:row.state.pitchDeg,pilotIntent:row.pilotIntent,manualRate:row.reference.manualRate,referenceQuaternion:row.reference.quaternion}:null;
 const legacySuppressed=legalPitch.filter(r=>r.stabilizationMode==='level'&&r.stabilizationActive);
 const summary={id:config.id,variant,configuration:config,schedule:events,steps:steps.length,durationS:steps.length*DT,initialTimeS:initialTime,initial,initialMode:config.air?'hover':'drive',initialGeometryId:initialState.geometrySignature,fixtureGeometrySHA256:sha(JSON.stringify(sim.geometry)),initialPhysicalSHA256:sha(JSON.stringify(initial)),initialParameters:sim.params,
  receiptCount:steps.reduce((n,r)=>n+r.received.length,0),repeatCount:steps.flatMap(r=>r.received).filter(e=>e.repeat).length,allReceiptsAreSyntheticKeyboardEvents:steps.every(r=>r.received.every(e=>e.keyboardEventInstance&&e.isTrusted===false)),
  firstPitchReceipt:first(pitchRows[0]),firstLegalFlightPitch:first(legalPitch[0]),firstGroundRestriction:first(groundPitch[0]),legalFlightPitchSteps:legalPitch.length,groundPitchSteps:groundPitch.length,
  acceptedFlightPitchSteps:legalPitch.filter(r=>r.pilotIntent?.pitch.accepted).length,legacyGSuppressedSteps:variant==='before'?legacySuppressed.length:null,firstLegacyGSuppression:variant==='before'?first(legacySuppressed[0]):null,
  maxPitchWhileRequestedDeg:Math.max(...pitchRows.map(r=>r.state.pitchDeg)),minPitchWhileRequestedDeg:Math.min(...pitchRows.map(r=>r.state.pitchDeg)),peakReferencePitchRateDegS:Math.max(0,...pitchRows.map(r=>-r.reference.manualRate.x*180/Math.PI)),
  hullContactSteps:steps.filter(r=>r.state.contacts.some(c=>c.vehicleShape<4)).length,maximumContactPenetrationM:Math.max(0,...steps.flatMap(r=>r.state.contacts.map(c=>c.penetrationM))),maximumActuatorRatio:Math.max(0,...steps.flatMap(r=>r.wrench.ratios.flatMap(n=>[n.command,n.force]))),
  final:last?{...last.state,mode:last.mode,stabilizationMode:last.stabilizationMode,pilotIntent:last.pilotIntent,reference:last.reference}:null,exception,solverFault:steps.find(r=>r.fault)?.fault??null,physicalTrajectorySHA256:sha(physicalRows.join('\n')),
  journal:{source:sessionExport.source,physicsTracePolicy:sessionExport.physicsTracePolicy,capacity:sessionExport.capacity,droppedEvents:sessionExport.droppedEvents,eventCount:sessionExport.events.length,physicalStepCount:sessionExport.events.filter(e=>e.type==='physics-input').length,receivedEvents:ingress.journalEvents},
  invariants:{requestedMatchesApplied:steps.every(r=>Object.keys(r.requested).every(k=>r.requested[k]===r.applied[k])),wHeldContinuously:steps.every(r=>r.requested.throttle===(r.step<W_RELEASE?1:0)),allScheduledEventsReceived:steps.reduce((n,r)=>n+r.received.length,0)===events.length,
   pitchFollowsPressed:steps.every(r=>r.requested.pitch===Number(r.pressed.includes('Digit1'))&&r.applied.pitch===Number(r.pressed.includes('Digit1'))),
   flightPitchAccepted:legalPitch.every(r=>r.pilotIntent?.pitch.accepted&&r.reference.manualRate.x< -1e-9),groundPitchExplicit:groundPitch.every(r=>r.pilotIntent?.pitch.reason==='takeoff-required'),
   pitchReleaseHasNoStoredRate:steps.filter(r=>r.step>=FIRST_RELEASE&&!r.pressed.includes('Digit1')).every(r=>Math.abs(r.reference.manualRate.x)<1e-9&&!r.pilotIntent?.gPitchOverride),
   gStateMatchesNonRepeatActions:steps.every(r=>r.stabilizationMode===((config.g!==!!(config.toggleAt&&r.step>=config.toggleAt))?'level':'off'))}};
 traceRows.push(JSON.stringify({recordType:'case-end',caseId:config.id,variant,summary}));
 results.push(summary);ingress.close();return summary;
}
const baseline=JSON.parse(readFileSync(new URL('./fixtures/pilot-input-3.14-before/provenance.json',import.meta.url),'utf8'));
traceRows.push(JSON.stringify({recordType:'header',schema:'roadster-pilot-sequence-trace',version:1,identity:getRuntimeIdentity(),physicsHz:HZ,source:'Synthetic JSDOM KeyboardEvent dispatch, production InputSession and driverAxes, actual bounded 120 Hz solver',baseline,initialization:'All body position/velocity and wheel-speed assignments occur before InputSession creation. Each recorded interval receives only browser events and fixed-step inputs; no position/attitude corrections, reset, refill, X, or automatic maneuver commands.'}));
for(const config of selections)for(const [variant,Sim]of [['before',BeforeSim],['after',RoadsterSim]])run(config,variant,Sim);
const after=results.filter(r=>r.variant==='after'),before=results.filter(r=>r.variant==='before');
const find=(id,variant='after')=>results.find(r=>r.id===id&&r.variant===variant);
check('18 pairwise selections cover every ground/air x initial G x 0/20/50 km/h combination',new Set(selections.map(c=>[c.air,c.g,c.speedKmh].join(':'))).size===12&&selections.length===18);
check('Before and after start with exactly matching declared physical conditions and fixture geometry',after.every(r=>r.initialPhysicalSHA256===find(r.id,'before').initialPhysicalSHA256&&r.initialGeometryId===find(r.id,'before').initialGeometryId&&JSON.stringify(r.initialParameters)===JSON.stringify(find(r.id,'before').initialParameters)));
check('All initial translational speeds and all four wheel speeds match the prescribed rolling initial condition',results.every(r=>Math.abs(r.initial.velocity.z-r.configuration.speedKmh/3.6)<1e-12&&r.initial.wheels.every(w=>Math.abs(w.angularVelocityRadS-r.configuration.speedKmh/3.6/r.initialParameters.wheelRadius)<1e-12)));
check('All keydown/keyup/repeat receipts are dispatched JSDOM KeyboardEvents, explicitly synthetic',results.every(r=>r.allReceiptsAreSyntheticKeyboardEvents&&r.invariants.allScheduledEventsReceived&&r.repeatCount>=2));
check('InputSession records every one of the actual 120 Hz steps without journal eviction',results.every(r=>r.steps===STEPS&&r.journal.physicalStepCount===STEPS&&r.journal.droppedEvents===0));
check('Production driverAxes and applied solver inputs retain held W, E and 1 without repeat amplification or axis loss',results.every(r=>r.invariants.requestedMatchesApplied&&r.invariants.wHeldContinuously&&r.invariants.pitchFollowsPressed));
check('Every received 1 request in legal hover mode reaches the bounded pitch-rate path for all candidate sequences',after.every(r=>r.invariants.flightPitchAccepted),{legalPitchSteps:after.reduce((n,r)=>n+r.legalFlightPitchSteps,0)});
check('Ground-supported pitch before E or without E reports takeoff-required; the request is retained',after.every(r=>r.invariants.groundPitchExplicit)&&after.reduce((n,r)=>n+r.groundPitchSteps,0)>100,{groundPitchSteps:after.reduce((n,r)=>n+r.groundPitchSteps,0)});
check('Forward and reverse release orders stop only the released axes, without a leftover manual pitch rate',after.every(r=>r.invariants.pitchReleaseHasNoStoredRate));
check('G changes while 1 remains held affect the next physical step; repeated G does not toggle twice',results.every(r=>r.invariants.gStateMatchesNonRepeatActions)&&after.filter(r=>r.configuration.toggleAt).every(r=>r.legalFlightPitchSteps===0||r.invariants.flightPitchAccepted));
const counterBefore=find(selections[0].id,'before'),counterAfter=find(selections[0].id);
check('Historical G pitch suppression remains in Before traces and the same sequence physically pitches in the candidate',counterBefore.legacyGSuppressedSteps>0&&counterBefore.peakReferencePitchRateDegS===0&&counterAfter.peakReferencePitchRateDegS>0&&counterAfter.maxPitchWhileRequestedDeg-counterBefore.maxPitchWhileRequestedDeg>1,{beforeMaxPitchDeg:counterBefore.maxPitchWhileRequestedDeg,afterMaxPitchDeg:counterAfter.maxPitchWhileRequestedDeg,beforeSuppressedSteps:counterBefore.legacyGSuppressedSteps});
check('All sequence integrations remain finite and commands/forces stay within actual nozzle capacities',results.every(r=>!r.exception&&!r.solverFault&&r.maximumActuatorRatio<=1+1e-9));
const comparisons=after.map(r=>{const old=find(r.id,'before');return{id:r.id,initialSpeedKmh:r.configuration.speedKmh,initialSupport:r.configuration.air?'airborne':'ground-supported',initialG:r.configuration.g,pressOrder:r.configuration.order,pressGapSteps:r.configuration.gap,releaseOrder:r.configuration.release,gToggleAt:r.configuration.toggleAt??null,before:{maxPitchWhileRequestedDeg:old.maxPitchWhileRequestedDeg,peakReferencePitchRateDegS:old.peakReferencePitchRateDegS,gSuppressedSteps:old.legacyGSuppressedSteps,hullContactSteps:old.hullContactSteps},after:{maxPitchWhileRequestedDeg:r.maxPitchWhileRequestedDeg,peakReferencePitchRateDegS:r.peakReferencePitchRateDegS,acceptedFlightPitchSteps:r.acceptedFlightPitchSteps,groundRestrictedSteps:r.groundPitchSteps,hullContactSteps:r.hullContactSteps},trajectoryChanged:r.physicalTrajectorySHA256!==old.physicalTrajectorySHA256};});
const traceName=`pilot-sequences-${REPORT_VERSION}.ndjson.gz`,trace=gzipSync(Buffer.from(traceRows.join('\n')+'\n'),{level:9});
writeFileSync(new URL('../qa/'+traceName,import.meta.url),trace);
const sourcePaths=['dist/physics.js','dist/input-session.js','dist/controls.js','dist/pilot-input-intent.js','dist/main.js','dist/vehicle-models.js','dist/tire-dynamics.js','dist/control-observation.js','dist/simulation-safety.js','tests/pilot-sequences-3.15.test.mjs'];
const report={schema:'roadster-pilot-input-sequence-regression',version:1,createdAt:new Date().toISOString(),...getRuntimeIdentity(),physicsHz:HZ,status:checks.every(c=>c.passed)?'passed-with-retained-before-failures':'failed',baseline,
 environment:{keyboard:'JSDOM KeyboardEvent with isTrusted=false; synthetic event dispatch, not OS/hardware input',jsdomVersion:require(require.resolve('jsdom/package.json',{paths:[dirname(require.resolve(jsdomModule))]})).version,domAdapter:'Open, focused pilot surface only. Production InputSession and driverAxes are imported; G non-repeat action behavior is adapted from main.js. Full main/UI event routing is not executed.',solver:'Production current and immutable 3.14-physics fixture, each through public advanceFixed at 120 Hz; shared current helper dependencies as recorded in baseline provenance.',supplyMode:'bench',geometry:'Isolated original ground collider; no city obstacle or route acceptance.'},
 fixture:{groundHeightM:.62,airborneHeightM:20,positionZ:-350,groundSettlingSteps:180,initialSpeedsKmh:[0,20,50],wheelInitialization:'omega = initialSpeedMps / production wheelRadius for every wheel, after settling and before any journal event',mutationBoundary:'All fixture state assignments precede journal creation. No body, velocity, pose, mass, grip, thrust, wheel-state or source-parameter mutation during the recorded interval.',pressStep:FIRST_PRESS,releaseStep:FIRST_RELEASE,releaseGapSteps:RELEASE_GAP,wReleaseStep:W_RELEASE,recordedStepsPerCase:STEPS,statisticsHz:120,decimation:false},
 sourceHashes:Object.fromEntries(sourcePaths.map(path=>[path,sha(readFileSync(new URL('../'+path,import.meta.url)))])),checks,comparisons,cases:results,
 retainedBeforeFailures:before.filter(r=>r.legacyGSuppressedSteps>0).map(r=>({caseId:r.id,reason:'A received pitch=1 request was present in hover mode while the historical G level controller remained active; the recorded reference/motion is preserved, not replaced by a candidate diagnostic.',suppressedSteps:r.legacyGSuppressedSteps,first:r.firstLegacyGSuppression,trajectorySHA256:r.physicalTrajectorySHA256})),
 observedContactOutcomes:results.filter(r=>r.hullContactSteps>0).map(r=>({id:r.id,variant:r.variant,hullContactSteps:r.hullContactSteps,maximumPenetrationM:r.maximumContactPenetrationM,meaning:'Contact response is retained. Accepted pitch input does not certify successful takeoff, clearance, landing or recovery.'})),
 trace:{file:traceName,recordCount:traceRows.length,physicsSampleCount:results.reduce((n,r)=>n+r.steps,0),frequencyHz:HZ,sha256:sha(trace),compressedBytes:trace.length},
 pending:['Native physical keyboard rollover, platform focus/key delivery and real frame timing.','Full browser main.js action routing, real keyboard driving/flight, target GPU and visual acceptance.','Long-duration or full-turn maneuvers, finite-supply recovery and arbitrary initial states.'],
 limits:['Pairwise representative timing selections are not every input combination.','1 denotes a bounded pitch-rate request. Acceptance and reference advancement are distinct from achieved attitude, actuator availability and maneuver success. No complete-flip assertion is made.','The Before fixture imports current helper modules; it isolates the recorded 3.14 physics implementation, not a separately deployed historical browser build.','sourceCommit/sourceTree remain unavailable for this uncommitted test run; cryptographic file hashes bind the actual tested sources. The release runner must re-run this after final build identity generation.']};
writeFileSync(new URL(`../qa/pilot-sequences-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:checks.length,cases:results.length,samples:report.trace.physicsSampleCount,traceBytes:trace.length,retainedBeforeFailures:report.retainedBeforeFailures.length,observedContactOutcomes:report.observedContactOutcomes.length,beforePitchDeg:counterBefore.maxPitchWhileRequestedDeg,afterPitchDeg:counterAfter.maxPitchWhileRequestedDeg}));
assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
