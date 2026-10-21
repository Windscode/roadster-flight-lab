import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {DriverHeadFeedback,DRIVER_HEAD_LIMITS} from '../dist/driver-feedback.js';
import {soundState,createContactSoundGate} from '../dist/audio.js';
import {createRouteSurfacePreset} from '../dist/route-surface.js';
import {advanceChasePosition,resolveCameraObstruction} from '../dist/chase-camera.js';
import {VEHICLE_DRIVER_VIEW} from '../dist/vehicle.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const DT=1/120,zero={x:0,y:0,z:0},checks=[],evidence={};
const check=(name,fn)=>{fn();checks.push({name,status:'PASS'});console.log('PASS: '+name);};
const close=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} versus ${b}`);
const clone=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');
const cameraStart=source.indexOf('  function updateCamera('),cameraEnd=source.indexOf('\n  onLanguageChange(',cameraStart);
assert.ok(cameraStart>=0&&cameraEnd>cameraStart,'The integration test must execute the actual main camera update function');
const cameraSource=source.slice(cameraStart,cameraEnd);

function prepared(){
  const s=new RoadsterSim();s.body.position.set(-200,.62,-300);s.body.aabbNeedsUpdate=true;
  s.setRouteSurface(createRouteSurfacePreset('after-rain'),{phase:'preparation'});
  for(let k=0;k<120;k++)s.advanceFixed({brake:1},DT);
  return s;
}
function seededHead(enabled=true){
  const head=new DriverHeadFeedback({enabled}),q={x:0,y:0,z:0,w:1};let sample;
  for(let k=0;k<=60;k++){sample={simTime:k*DT,velocity:{x:2*k*DT,y:-k*DT,z:4*k*DT},quaternion:q};head.update(sample);}
  return{head,sample};
}
function cameraHarness(mode,feedback,sample,{session='live',paused=false,matrixBusy=false}={}){
  // Use real Three camera transforms and the production camera updater. Only
  // DOM/menu/renderer controls are inert fixtures, not replacement camera math.
  const factory=new Function('THREE','headFeedback','initialMode','sample','options','advanceChasePosition','resolveCameraObstruction','VEHICLE_DRIVER_VIEW',`
    const vec=v=>new THREE.Vector3(v.x,v.y,v.z),camera=new THREE.PerspectiveCamera(48,16/9,.08,2000);camera.position.set(-205,4,-310);camera.lookAt(vec(sample.position));
    const orbitCamera=camera.clone(),car={group:{visible:true},setInteriorView(){}},controls={target:vec(sample.position),update(){}};
    const shell={studyOpen:false},researchConsole={getState:()=>({open:false})},sim={getWorldGeometry:()=>[]};
    const CITY_CAPTURE_CAMERAS=[{id:'fixture-fixed',position:[-220,12,-290],target:[-200,.7,-300]}];
    const innerWidth=1280,innerHeight=720,menuOpen=false;
    let cameraMode=initialMode,cameraSolveMode=initialMode,wantedCamera=camera.position.clone(),cameraObstruction=null,lastPosition=vec(sample.position),fixedCameraId='fixture-fixed';
    let programMatrixBusy=options.matrixBusy,paused=options.paused,learningSessionMode=options.session;
    ${cameraSource}
    return{camera,run:()=>updateCamera(1/60,sample),getHead:()=>headFeedback.getState()};
  `);
  return factory(THREE,feedback,mode,sample,{session,paused,matrixBusy},advanceChasePosition,resolveCameraObstruction,VEHICLE_DRIVER_VIEW);
}

check('Actual RoadsterSim trajectories and complete snapshots are identical with head/audio feedback enabled or disabled at every fixed step',()=>{
  const sourceSim=prepared(),initial=sourceSim.exportState(),enabled=new RoadsterSim(),disabled=new RoadsterSim();enabled.importState(initial);disabled.importState(clone(initial));
  const head=new DriverHeadFeedback(),off=new DriverHeadFeedback({enabled:false}),audioGate=createContactSoundGate(),maximum={x:0,y:0,z:0};let observedNonzero=false;
  for(let k=0;k<720;k++){
    const input=k<240?{throttle:.23}:k<420?{throttle:.06,steer:.08}:{brake:.7};
    const a=enabled.advanceFixed(input,DT),b=disabled.advanceFixed(input,DT),before=JSON.stringify(a);
    const shift=head.update(a),inactive=off.update(b);soundState(a);audioGate.consume(a);
    assert.equal(JSON.stringify(a),before,'Feedback must not mutate the telemetry object');assert.deepEqual(inactive,zero);
    for(const axis of ['x','y','z']){assert.ok(Number.isFinite(shift[axis]));maximum[axis]=Math.max(maximum[axis],Math.abs(shift[axis]));assert.ok(Math.abs(shift[axis])<=DRIVER_HEAD_LIMITS[axis]+1e-12);observedNonzero||=Math.abs(shift[axis])>.001;}
    assert.deepEqual(enabled.exportState(),disabled.exportState(),`Complete physical snapshot differs at step ${k}`);
  }
  assert.ok(observedNonzero,'The test must exercise real head movement, not two disabled filters');
  const airborne=enabled.exportState();airborne.body.position.values[1]=.82;airborne.body.previousPosition.values[1]=.82;airborne.body.interpolatedPosition.values[1]=.82;
  airborne.body.velocity.values=[0,0,0];airborne.body.angularVelocity.values=[0,0,0];enabled.importState(airborne);disabled.importState(clone(airborne));head.reset();off.reset();let contactSoundEvents=0;
  for(let k=0;k<360;k++){const a=enabled.advanceFixed({},DT),b=disabled.advanceFixed({},DT);head.update(a);off.update(b);if(audioGate.consume(a))contactSoundEvents++;soundState(a);assert.deepEqual(enabled.exportState(),disabled.exportState(),`Landing snapshot differs at step ${k}`);}
  assert.ok(contactSoundEvents>=1,'A genuine landing sound event must be read during equality testing');
  evidence.physicalIsolation={drivingFixedSteps:720,landingFixedSteps:360,completeSnapshotEquality:'exact at every fixed step',maximumObservedOffsetM:maximum,landingSoundEvents:contactSoundEvents,interpretation:'Numerical full-city integration. Enabling the read-only presentation filter and sound state does not change any captured physical continuation state.'};
});

check('Offset is bounded, follows local acceleration direction and never introduces camera rotation',()=>{
  const head=new DriverHeadFeedback(),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2),limits={...DRIVER_HEAD_LIMITS};let last;
  for(let k=0;k<480;k++){const qPlain={x:q.x,y:q.y,z:q.z,w:q.w};last=head.update({simTime:k*DT,velocity:{x:k*DT*1000,y:k*DT*1000,z:0},quaternion:qPlain});for(const axis of ['x','y','z'])assert.ok(Math.abs(last[axis])<=limits[axis]+1e-12);}
  assert.ok(last.z<-.034&&last.y<-.011);assert.ok(Math.abs(last.x)<1e-10,'World +X at 90 degree yaw must be local +Z');assert.equal(head.getState().rotationApplied,false);
  const actual=seededHead(),sample={...actual.sample,position:{x:-200,y:.62,z:-300},headingDeg:0,heightWorld:.62,contactCount:4,rollDeg:0};
  const on=cameraHarness('cockpit',actual.head,sample),off=cameraHarness('cockpit',new DriverHeadFeedback({enabled:false}),sample);on.run();off.run();
  close(on.camera.quaternion.angleTo(off.camera.quaternion),0,1e-7);const delta=on.camera.position.clone().sub(off.camera.position),offset=actual.head.getState().offsetM;
  close(delta.x,offset.x);close(delta.y,offset.y);close(delta.z,offset.z);assert.ok(delta.length()>.001);
  evidence.limits={limitsM:limits,stressOffsetM:last,stressMeaning:'Synthetic large acceleration probes a presentation bound, not a physical vehicle maneuver',cameraShiftM:delta.toArray(),cameraQuaternionDifferenceRad:on.camera.quaternion.angleTo(off.camera.quaternion),rotationApplied:false};
});

check('Pause freezes the presentation state; repeated frames do not integrate it, and seek/reset clears old inertial memory',()=>{
  const {head,sample}=seededHead(),before=clone(head.getState()),filterBefore=clone({previous:head.previous,acceleration:head.acceleration});
  for(let k=0;k<200;k++)assert.deepEqual(head.update(sample,{paused:true}),before.offsetM);
  assert.deepEqual(head.getState(),before);assert.deepEqual({previous:head.previous,acceleration:head.acceleration},filterBefore);
  for(let k=0;k<200;k++)assert.deepEqual(head.update(sample),before.offsetM);
  assert.deepEqual(head.update({...sample,simTime:sample.simTime-.2,velocity:{x:500,y:300,z:-100}}),zero,'Backward seek resets the filter without inventing an acceleration');
  assert.deepEqual(head.update({...sample,simTime:sample.simTime+5}),zero,'A large forward seek/reset gap cannot be differentiated as acceleration');
  const seeded=seededHead();seeded.head.setEnabled(false);assert.deepEqual(seeded.head.getState().offsetM,zero);assert.equal(seeded.head.previous,null);seeded.head.setEnabled(true);assert.deepEqual(seeded.head.update(sample),zero,'Re-enable starts a new observation history');
  evidence.pauseAndSeek={pause:'holds current bounded offset and freezes filter time; it does not force the current camera to neutral',repeatedFrame:'no integration at identical physical time',backwardSeek:'zero offset and reset acceleration',largeGapThresholdS:.15,reenable:'starts at neutral, without a stale velocity impulse'};
});

check('The production main camera updater leaves fixed/orbit/chase/top and review camera poses independent of head feedback',()=>{
  evidence.cameraModes=[];
  for(const mode of ['fixed','orbit','chase','top']){
    const active=seededHead(),sample={...active.sample,position:{x:-200,y:.62,z:-300},headingDeg:0,heightWorld:.62,contactCount:4,rollDeg:0},off=new DriverHeadFeedback({enabled:false});
    const a=cameraHarness(mode,active.head,sample),b=cameraHarness(mode,off,sample);a.run();b.run();
    assert.deepEqual(a.camera.position.toArray(),b.camera.position.toArray());assert.deepEqual(a.camera.quaternion.toArray(),b.camera.quaternion.toArray());assert.deepEqual(active.head.getState().offsetM,zero);
    evidence.cameraModes.push({mode,positionIdentical:true,orientationIdentical:true,headStateReset:true});
  }
  const active=seededHead(),sample={...active.sample,position:{x:-200,y:.62,z:-300},headingDeg:0,heightWorld:.62,contactCount:4,rollDeg:0};
  const a=cameraHarness('cockpit',active.head,sample,{session:'review'}),b=cameraHarness('cockpit',new DriverHeadFeedback({enabled:false}),sample,{session:'review'});a.run();b.run();
  assert.deepEqual(a.camera.position.toArray(),b.camera.position.toArray());assert.deepEqual(a.camera.quaternion.toArray(),b.camera.quaternion.toArray());assert.deepEqual(active.head.getState().offsetM,zero);evidence.reviewCockpit='inactive presentation filter; exact nominal recorded-frame geometry';
});

const sourceHashes=Object.fromEntries(['dist/driver-feedback.js','dist/audio.js','dist/physics.js','dist/main.js','dist/route-experience.js'].map(path=>[path,createHash('sha256').update(path==='dist/main.js'?source:readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]));
const report={schema:'roadster-driver-feedback-acceptance',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,createdAt:new Date().toISOString(),scope:'Real RoadsterSim numerical integration, production read-only filters, and the actual main camera updater executed against real Three camera math with inert DOM/menu fixtures. Not browser/native-keyboard, GPU or human comfort acceptance.',checks,evidence,sourceHashes};
mkdirSync(new URL('../qa/',import.meta.url),{recursive:true});writeFileSync(new URL('../qa/driver-feedback-3.19.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
