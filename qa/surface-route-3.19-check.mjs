import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {createRouteSurfacePreset,queryRouteSurface,routeSurfaceHash,validateRouteSurface,routeSurfaceProgress} from '../dist/route-surface.js';
import {soundState,createContactSoundGate} from '../dist/audio.js';
import {MODEL_VERSION,roadWheelAngle} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const DT=1/120,dir=new URL('./surface-route-3.19/',import.meta.url),checks=[],evidence={},traces=[];
mkdirSync(dir,{recursive:true});
const check=(name,fn)=>{const result=fn();checks.push({name,status:'PASS'});console.log('PASS: '+name);return result;};
const close=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const snapshot=s=>({position:{...s.body.position},quaternion:{...s.body.quaternion},velocity:{...s.body.velocity},angularVelocity:{...s.body.angularVelocity},gasMass:s.gasMass,gasTemperature:s.gasTemperature,energy:s._energyUsed,wheels:s.wheelStates.map(w=>({omega:w.angularVelocityRadS,rotation:w.rotation,normal:w.normalLoadN,force:[w.longitudinalForceN,w.lateralForceN]}))});
function ready(preset='dry-day',{x=-200,z=-307}={}){
  const s=new RoadsterSim();s.body.position.set(x,.62,z);s.body.previousPosition.copy(s.body.position);s.body.interpolatedPosition.copy(s.body.position);s.body.aabbNeedsUpdate=true;
  assert.equal(s.setRouteSurface(createRouteSurfacePreset(preset),{phase:'preparation'}),true);
  for(let k=0;k<120;k++)s.advanceFixed({brake:1},DT);
  assert.equal(s.telemetry().contactCount,4);assert.equal(s.telemetry().fault,null);return s;
}
function rolling(s,speed){s.body.velocity.set(0,0,speed/3.6);s.wheelStates.forEach(w=>w.angularVelocityRadS=speed/3.6/s.params.wheelRadius);}
function row(t){const sound=soundState(t);return{timeS:t.simTime,position:t.position,velocity:t.velocity,headingDeg:t.headingDeg,speedKmh:t.speedKmh,contacts:t.contactCount,slipPowerW:sound.slipPowerW,slipGain:sound.slipGain,roadGain:sound.roadGain,absGain:sound.absGain,wheels:t.wheelStates.map(w=>({id:w.id,point:w.contactPointWorld,surfaceId:w.surfaceId,material:w.surfaceMaterial,mu:w.surfaceMu,loadN:w.normalLoadN,slip:w.slipRatio,slipPowerW:w.slipPowerW,abs:w.absActive})),contactEvent:t.contactFeedback.lastEvent};}

check('One serializable authored map controls material identity and per-wheel friction without interpreting puddle colour as grip',()=>{
  const d=createRouteSurfacePreset('after-rain'),dry=createRouteSurfacePreset('dry-day');
  assert.equal(d.route.lengthM,302.5);assert.equal(validateRouteSurface(d).schema,d.schema);
  const a=queryRouteSurface(d,-200,-300),b=queryRouteSurface(dry,-200,-300);close(a.mu,.7);close(b.mu,1.25);
  const optical=structuredClone(d);optical.materials.damp.opticalWetness=0;optical.materials.damp.moisture=.05;
  close(queryRouteSurface(optical,-200,-300).mu,a.mu);assert.notEqual(routeSurfaceHash(optical),routeSurfaceHash(d));
  assert.equal(queryRouteSurface(d,-200,-225,{y:20}),null);assert.equal(queryRouteSurface(d,-200,-320,{y:5.4}),null);
  assert.equal(queryRouteSurface(d,-200,-300,{normalY:.5}),null);assert.equal(queryRouteSurface(d,0,0),null);
  assert.equal(queryRouteSurface(d,-200,-320).kind,'metal');assert.equal(queryRouteSurface(d,-200,-246).kind,'patch');
  const invalid=structuredClone(d);invalid.materials.damp.gripScale=-1;assert.throws(()=>validateRouteSurface(invalid));
  const sim=ready();const before=sim.getRouteSurface();assert.equal(sim.setRouteSurface(d),false);assert.deepEqual(sim.getRouteSurface(),before);
  assert.equal(sim.setRouteSurface(invalid,{phase:'preparation'}),false);assert.deepEqual(sim.getRouteSurface(),before);
  evidence.descriptors=[dry,d].map(descriptor=>({descriptor,descriptorHash:routeSurfaceHash(descriptor),fileSha256:createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')}));
});

check('Same 60 km/h city initial state and full brake produce a longer local-wet stop with real per-wheel ABS and recorded sound work',()=>{
  evidence.braking=[];for(const preset of ['dry-day','after-rain']){
    const s=ready(preset);rolling(s,60);const start=s.body.position.clone(),initial=snapshot(s),samples=[];let t,minPressure=1,absS=0,maximumGrip=0,slipWorkJ=0,k;
    for(k=0;k<120*6;k++){t=s.advanceFixed({brake:1},DT);assert.equal(t.fault,null);assert.equal(t.contactCount,4);
      for(const w of t.wheelStates){minPressure=Math.min(minPressure,w.absPressure);maximumGrip=Math.max(maximumGrip,w.gripUse);slipWorkJ+=w.slipPowerW*DT;const q=queryRouteSurface(s._routeSurface,w.contactPointWorld.x,w.contactPointWorld.z,{y:w.contactPointWorld.y,normalY:w.contactNormalWorld.y,baseMu:s.params.tireMu});assert.equal(q.surfaceId,w.surfaceId);close(q.mu,w.surfaceMu);}
      absS+=Number(t.wheelStates.some(w=>w.absActive))*DT;if(k%6===0)samples.push(row(t));if(t.speedKmh<.36)break;
    }
    assert.ok(k<120*6);assert.ok(maximumGrip<=1+1e-9);assert.ok(minPressure<.9&&absS>0&&slipWorkJ>0);
    evidence.braking.push({preset,initial,initialSpeedKmh:60,input:{brake:1},stopDistanceM:s.body.position.distanceTo(start),stopTimeS:(k+1)*DT,absActiveS:absS,minAbsPressure:minPressure,maximumGrip,slipWorkJ,final:row(t)});traces.push({kind:'braking',preset,samples});
  }
  const [dry,wet]=evidence.braking;assert.deepEqual(dry.initial,wet.initial);assert.ok(wet.stopDistanceM>dry.stopDistanceM*1.25&&wet.stopTimeS>dry.stopTimeS*1.25);
});

check('Same-input corner uses actual local grip in the existing steering envelope; it does not add a fictitious yaw force',()=>{
  evidence.corner=[];for(const preset of ['dry-day','after-rain']){
    const s=ready(preset,{x:-201.5,z:-300});rolling(s,45);const initial=snapshot(s),samples=[];let t;
    for(let k=0;k<120;k++){t=s.advanceFixed({steer:.75,throttle:.02},DT);assert.equal(t.fault,null);assert.equal(t.contactCount,4);if(k%6===0)samples.push(row(t));}
    evidence.corner.push({preset,initial,input:{steer:.75,throttle:.02},seconds:1,headingDeg:t.headingDeg,steeringCentreDeg:t.steeringCentreDeg,endPosition:t.position,bodySlipDeg:t.bodySlipDeg});traces.push({kind:'corner',preset,samples});
  }
  assert.deepEqual(evidence.corner[0].initial,evidence.corner[1].initial);assert.ok(evidence.corner[1].headingDeg<evidence.corner[0].headingDeg*.8);
  evidence.cornerInterpretation='The existing steering aid intentionally limits the wet-road wheel angle. Same human input is not a fixed-wheel-angle tyre-identification experiment.';
});

check('Four real wheel contact points cross a half-width wet boundary independently; elevated surfaces retain their legacy condition',()=>{
  const s=ready('after-rain',{z:-218});rolling(s,28.8);const samples=[];let t,splitObserved=false;
  for(let k=0;k<240;k++){t=s.advanceFixed({brake:.7},DT);assert.equal(t.fault,null);const mus=t.wheelStates.filter(w=>w.contact).map(w=>w.surfaceMu);splitObserved||=Math.min(...mus)<.8&&Math.max(...mus)>1.2;for(const w of t.wheelStates.filter(w=>w.contact)){const q=queryRouteSurface(s._routeSurface,w.contactPointWorld.x,w.contactPointWorld.z,{y:w.contactPointWorld.y,normalY:w.contactNormalWorld.y,baseMu:s.params.tireMu});close(w.surfaceMu,q?.mu??s.params.tireMu);}if(k%6===0)samples.push(row(t));}
  assert.ok(splitObserved);close(s._surfaceMu({x:-200,y:20,z:-208}),1.25);evidence.crossBoundary={splitObserved,final:row(t)};traces.push({kind:'cross-boundary',samples});
});

check('Low-speed stopping is quiet at rest, and genuine light and heavier touchdown each emit one bounded onset through continuous support',()=>{
  const park=ready('after-rain',{z:-208});rolling(park,2.88);let t;for(let k=0;k<480;k++)t=park.advanceFixed({brake:.15},DT);
  assert.ok(t.speedKmh<.01);assert.equal(soundState(t).slipGain,0);assert.ok(soundState(t).roadGain<1e-12);
  evidence.parking={final:row(t)};evidence.landing=[];
  for(const initialHeightM of [.82,1.6]){
    const s=ready();s.body.position.y=initialHeightM;s.body.velocity.set(0,0,0);s.body.aabbNeedsUpdate=true;const gate=createContactSoundGate(),played=[],events=[],samples=[];let last=0;
    for(let k=0;k<480;k++){t=s.advanceFixed({},DT);assert.equal(t.fault,null);const strike=gate.consume(t);if(strike)played.push(strike);if(t.contactFeedback.sequence!==last){events.push(t.contactFeedback.lastEvent);last=t.contactFeedback.sequence;}if(k%6===0)samples.push(row(t));}
    assert.equal(played.length,1);assert.equal(events.length,1);assert.equal(t.contactCount,4);assert.equal(soundState(t).impact,null);assert.ok(events[0].normalEnergyJ>0);
    evidence.landing.push({initialHeightM,events,played,final:row(t)});traces.push({kind:'natural-drop',initialHeightM,samples});
  }
  assert.ok(evidence.landing[1].events[0].normalEnergyJ>evidence.landing[0].events[0].normalEnergyJ*3);assert.ok(evidence.landing[1].played[0].gain>evidence.landing[0].played[0].gain);
});

check('Contact sound changes under equal-speed severe sliding, stays silent in air/rest, and reading all feedback leaves every physical step identical',()=>{
  const sim=ready('after-rain');rolling(sim,36);sim.body.velocity.x=5;
  const active=sim.advanceFixed({throttle:.1},DT),normal=structuredClone(active);
  for(const w of normal.wheelStates)w.slipPowerW=0;
  assert.equal(soundState(normal).slipGain,0);assert.ok(soundState(active).slipGain>.01);
  const air=structuredClone(active);air.contactCount=0;air.wheelStates.forEach(w=>w.contact=false);assert.equal(soundState(air).slipGain,0);assert.equal(soundState(air).roadGain,0);
  const frozen=sim.exportState(),a=new RoadsterSim(),b=new RoadsterSim();a.importState(frozen);b.importState(JSON.parse(JSON.stringify(frozen)));const gate=createContactSoundGate();
  for(let k=0;k<360;k++){const input={throttle:k<90?.1:0,brake:k>=90?.4:0,steer:k<60?.1:0},ta=a.advanceFixed(input,DT);b.advanceFixed(input,DT);const copy=JSON.stringify(ta);soundState(ta);gate.consume(ta);assert.equal(JSON.stringify(ta),copy);assert.deepEqual(snapshot(a),snapshot(b));}
  assert.deepEqual(a.exportState(),b.exportState());assert.equal(a.getRouteSurface().descriptorHash,sim.getRouteSurface().descriptorHash);
  evidence.feedbackIsolation={steps:360,physicalEquality:'exact every fixed step and complete final snapshot',sameSpeedSoundComparison:{normal:soundState(normal),slide:soundState(active),air:soundState(air)}};
});

check('Legacy dry/wet/split selection explicitly clears authored route conditions and preserves its old world-X contract',()=>{
  const s=ready('after-rain');for(const preset of ['dry','wet','split']){assert.equal(s.setRoadSurface(preset),true);assert.equal(s.getRouteSurface(),null);assert.equal(s.getRoadSurface().preset,preset);for(const x of [-1,1])close(s._surfaceMu({x,y:0,z:-300}),s.params.tireMu*(preset==='wet'||preset==='split'&&x<0?s.params.wetGripMultiplier:1));}
});


check('A declared numerical driver traverses the entire existing-city route, left turn and final stop under both surface maps without relocation',()=>{
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),points=[];
  for(let z=-380;z<=-142;z+=2)points.push({x:-200,z});
  // Round the existing junction at low speed; do not cut across a building.
  for(let k=1;k<=20;k++){const angle=k/20*Math.PI/2;points.push({x:-190.5-9.5*Math.cos(angle),z:-142+9.5*Math.sin(angle)});}
  for(let x=-188.5;x<=-145;x+=2)points.push({x,z:-132.5});points.push({x:-145,z:-132.5});
  const runs=[];
  for(const preset of ['dry-day','after-rain']){
    const s=ready(preset,{z:-380}),start=s.body.position.clone(),samples=[],inputs=[],surfaces=new Set(),materials=new Set();let targetIndex=0,t,rigidSteps=0,minContacts=4,actualDistanceM=0,previous=s.body.position.clone(),driveSteps=0,completed=false;
    const capture=(input,phase)=>{
      t=s.advanceFixed(input,DT);assert.equal(t.fault,null);minContacts=Math.min(minContacts,t.contactCount);rigidSteps+=Number(t.rigidContactCount>0);
      actualDistanceM+=s.body.position.distanceTo(previous);previous.copy(s.body.position);
      for(const wheel of t.wheelStates){if(wheel.contact){surfaces.add(wheel.surfaceId);materials.add(wheel.surfaceMaterial);}}
      const last=inputs.at(-1);if(last&&JSON.stringify(last.input)===JSON.stringify(input))last.steps++;else inputs.push({steps:1,input});
      if(driveSteps%6===0)samples.push({...row(t),input,phase});driveSteps++;
    };
    for(let k=0;k<120*80;k++){
      const p=s.body.position;while(targetIndex<points.length-1&&Math.hypot(p.x-points[targetIndex].x,p.z-points[targetIndex].z)<4)targetIndex++;
      const target=points[targetIndex],heading=s._angles().heading,targetHeading=Math.atan2(target.x-p.x,target.z-p.z),error=Math.atan2(Math.sin(targetHeading-heading),Math.cos(targetHeading-heading));
      const speed=s.body.velocity.length(),sectionSpeed=p.z<-165?9:p.x<-185?3.5:7,remaining=Math.hypot(p.x+145,p.z+132.5),speedGoal=Math.min(sectionSpeed,Math.sqrt(2*2*Math.max(0,remaining-.5)));
      const maxAngle=roadWheelAngle(1,speed,s.params,s._surfaceMu({x:p.x,y:0,z:p.z})),steer=clamp(Math.atan(2.84*2*Math.sin(error)/Math.max(2,Math.hypot(target.x-p.x,target.z-p.z)))/maxAngle,-1,1);
      capture({throttle:clamp((speedGoal-speed)*.3+.02,0,.6),brake:clamp((speed-speedGoal)*.2,0,.6),steer},'route');
      if(remaining<1&&speed<.2){completed=true;break;}
    }
    assert.ok(completed,'Numerical driver must actually reach the finish');for(let k=0;k<240;k++)capture({brake:1},'stop');
    assert.equal(rigidSteps,0);assert.equal(minContacts,4);assert.ok(t.speedKmh<.01);assert.equal(t.contactCount,4);assert.equal(t.controlOwnership.owner,'driver');assert.equal(t.thrustN,0);
    const progress=routeSurfaceProgress(s._routeSurface,t.position);assert.ok(progress.distanceM>301.5&&progress.remainingM<1&&progress.lateralDistanceM<1);for(const material of ['asphalt','damp','metal','patch'])assert.ok(materials.has(material));
    runs.push({preset,descriptorHash:s.getRouteSurface().descriptorHash,start:{...start},finish:t.position,routeLengthM:302.5,actualDrivenDistanceM:actualDistanceM,durationS:driveSteps*DT,physicalSteps:driveSteps,minimumWheelContacts:minContacts,rigidContactSteps:rigidSteps,visitedRegions:[...surfaces],visitedMaterials:[...materials],final:row(t),progress,inputRuns:inputs,samples});
  }
  const scope='Actual full-city physical integration with a deterministic numerical driver feedback policy. Steering/throttle/brake are applied as ordinary inputs; no pose is set after the initial preparation. This is not native keyboard acceptance or strict controller A/B: the same driver policy reacts to different trajectories and therefore emits different input sequences.';
  writeFileSync(new URL('route-drive.json',dir),JSON.stringify({schema:'roadster-continuous-route-numerical',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope,driverPath:points,runs},null,2)+'\n');
  evidence.continuousRoute={scope,runs:runs.map(({inputRuns,samples,...summary})=>summary),fullTrace:'qa/surface-route-3.19/route-drive.json'};
});

if(process.env.ROADSTER_BASELINE_DIR){
  const {pathToFileURL}=await import('node:url');const {RoadsterSim:Before}=await import(pathToFileURL(process.env.ROADSTER_BASELINE_DIR+'/dist/physics.js'));
  check('Unmapped legacy driving remains bit-identical to the preserved 3.18 physical source over continuous throttle, turn and brake inputs',()=>{
    const before=new Before(),after=new RoadsterSim();for(let k=0;k<1200;k++){const input={throttle:k<500?.2:0,steer:k>300&&k<600?.15:0,brake:k>=700?.3:0};before.advanceFixed(input,DT);after.advanceFixed(input,DT);assert.deepEqual(snapshot(before),snapshot(after));}
    evidence.legacyPhysicalEquality={steps:1200,status:'exact body/gas/energy/wheel state at every step',baseline:'preserved 3.18 eb2ca9 source, no descriptor'};
  });
}
const report={schema:'roadster-surface-route-acceptance',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,createdAt:new Date().toISOString(),scope:'Numerical full-city physics and read-only audio state. No claim of native keyboard, GPU frame timing, driver comfort or audible-device acceptance.',checks,evidence};
writeFileSync(new URL('numerical-report.json',dir),JSON.stringify(report,null,2)+'\n');
writeFileSync(new URL('contact-and-sound-curves.ndjson',dir),traces.map(v=>JSON.stringify(v)).join('\n')+'\n');
console.log(JSON.stringify({checks:checks.length,report:'qa/surface-route-3.19/numerical-report.json'}));
