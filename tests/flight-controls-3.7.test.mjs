import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {RoadsterSim,PHYSICS_HZ} from '../dist/physics.js';
import {roadWheelAngle} from '../dist/vehicle-models.js';
import {Quaternion,Vec3} from '../dist/vendor/cannon-es.js';

const dt=1/PHYSICS_HZ,checks=[],values={steering:[],ascent:[],roll:[],manualRoll:[],pitch:[],finite:[]};
const pass=name=>{checks.push(name);console.log('PASS: '+name);};
const close=(a,b,tol,label)=>assert.ok(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b} (±${tol})`);
const flat=(height=.62,params={})=>{
  // Retain the named 3.7 manual-input regression profile. Current defaults
  // and the complete 3.10/3.11 comparison live in vehicle-dynamics-3.11.
  // X cases below explicitly select their common manual/X actuator profile.
  const sim=new RoadsterSim({steeringAccelG:.9,climbRateMps:1.5,rollRateDegS:120,pitchRateDegS:32,angularAccelerationDegS2:160,verticalAccelerationMps2:3,attitudeResponse:3.6,...params});
  for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
  sim.body.position.set(0,height,-350);
  if(height<1)for(let i=0;i<240;i++)sim._advance(dt,{});
  else sim.setMode('hover');
  return sim;
};
const run=(sim,seconds,input={},inspect)=>{
  for(let i=0;i<Math.round(seconds*PHYSICS_HZ);i++){
    sim._advance(dt,typeof input==='function'?input(i*dt,i):input);
    assert.equal(sim._fault,null,'A hidden reset must not masquerade as convergence');
    inspect?.(sim,i);
  }
  return sim.telemetry();
};
const snapshot=sim=>JSON.stringify({position:sim.body.position,velocity:sim.body.velocity,quaternion:sim.body.quaternion,omega:sim.body.angularVelocity});

// Numerical 3.6 baseline was reproduced on the same stripped flat ground,
// 120 Hz, 1.5 s full steering / 0.15 throttle fixture before changing sources.
const baselineRadii=new Map([[10,22.276397731400028],[15,45.87710586353648],[25,124.18463454012517]]);
for(const speed of [10,15,25]){
  const s=flat();s.body.velocity.z=speed;s.wheelStates.forEach(w=>w.angularVelocityRadS=speed/s.params.wheelRadius);let minContacts=4,maxGrip=0,maxRoll=0;
  const t=run(s,1.5,{steer:1,throttle:.15},sim=>{
    minContacts=Math.min(minContacts,sim._contactCount);maxRoll=Math.max(maxRoll,Math.abs(sim._angles().roll));
    for(const w of sim.wheelStates)maxGrip=Math.max(maxGrip,w.gripUse);
  });
  const radius=s.body.velocity.length()/Math.abs(s.body.angularVelocity.y);
  assert.ok(radius<baselineRadii.get(speed)*.75,'Useful medium-speed curvature must improve at the actual rigid body');
  assert.ok(minContacts>=3&&maxGrip<=1+1e-10&&maxRoll<.30,'Improvement must retain contact and friction-circle limits');
  values.steering.push({startSpeedMps:speed,finalSpeedKmh:t.speedKmh,beforeRadiusM:baselineRadii.get(speed),afterRadiusM:radius,maxGrip,maxRollDeg:maxRoll*180/Math.PI,minContacts});
}
for(const speed of [28,56,83]){
  const s=flat();assert.ok(roadWheelAngle(1,speed,s.params)<.04,'High-speed wheel demand remains bounded');
  s.body.velocity.z=speed;s.wheelStates.forEach(w=>w.angularVelocityRadS=speed/s.params.wheelRadius);const t=run(s,2,{steer:.8});assert.ok(Math.abs(t.rollDeg)<20);assert.ok(t.wheelStates.every(w=>w.gripUse<=1+1e-10));
}
pass('Medium-speed steering produces smaller real turn radii while tyre friction, wheel contact and high-speed steering limits remain physical');

for(const settled of [false,true]){
  const states=[];
  for(const suction of [false,true]){
    const s=flat();s.setSuction(suction);if(settled)run(s,1);
    const t=run(s,1.5,{lift:1});assert.equal(t.mode,'hover');assert.ok(t.verticalSpeed<1.65&&t.heightWorld<3);
    states.push(t);values.ascent.push({suctionArmed:suction,sealPreviouslySettled:settled,heightM:t.heightWorld,verticalSpeedMps:t.verticalSpeed});
  }
  close(states[0].heightWorld,states[1].heightWorld,settled?.06:1e-12,'Suction cannot bypass controlled E ascent');
  close(states[0].verticalSpeed,states[1].verticalSpeed,settled?.06:1e-12,'E climb-rate equivalence');
}
pass('E enters the same controlled takeoff with suction armed or disarmed, including release of an already established seal');

for(const level of [false,true]){
  const s=flat(3);s.setAirStabilization(level);let touched=false;
  const t=run(s,8,{lift:-1},sim=>{if(sim._contactCount>=3)touched=true;});
  assert.ok(touched);assert.equal(t.mode,'drive');assert.equal(t.contactCount,4);assert.ok(t.thrustN<.01);
  assert.ok(t.nozzles.every(n=>n.command===0));close(t.heightWorld,.59701,.025,'Settled suspension');
  const released=run(s,.5);assert.equal(released.mode,'drive');assert.ok(released.thrustN<.01);
}
pass('Continuing Q on supported wheels completes touchdown in either city stabilization state and closes valves without a hover re-launch');

for(const height of [.62,4,18]){
  const s=flat(height,{rollRateDegS:180,angularAccelerationDegS2:360,verticalAccelerationMps2:5,attitudeResponse:4.5}),origin=s.body.position.y,ground=height<1;assert.equal(s.startManeuver('roll'),true);
  const plan={...s._maneuver};let inverted=false,airContacts=0,minRotate=Infinity,peak=origin;
  // The calmer common 180/360 profile completes around 12.7 s and then uses
  // real force to settle the remaining vertical velocity; compare a 15 s hold.
  const t=run(s,15,{},sim=>{
    const up=sim.body.quaternion.vmult(new Vec3(0,1,0));inverted ||= up.y<-.9;
    if(sim._maneuver?.phase==='rotate')minRotate=Math.min(minRotate,sim.body.position.y);
    if(!ground&&sim._contactCount)airContacts++;
    peak=Math.max(peak,sim.body.position.y);
  });
  assert.ok(inverted&&minRotate>1.5);assert.equal(t.maneuver,null);assert.ok(peak<plan.plannedPeakHeight);
  close(t.heightWorld,origin,.07,'X must return to its latched world height');
  if(ground){assert.equal(t.mode,'drive');assert.equal(t.contactCount,4);assert.ok(t.thrustN<.01);}
  else{assert.equal(airContacts,0,'Airborne X must never touch the ground and relaunch');assert.equal(t.mode,'hover');assert.ok(t.speedKmh<.06);}
  values.roll.push({originHeightM:origin,originGrounded:ground,plannedPeakHeightM:plan.plannedPeakHeight,measuredPeakHeightM:peak,minRotationHeightM:minRotate,finalHeightM:t.heightWorld,finalMode:t.mode,finalThrustN:t.thrustN,airborneContacts:airContacts});
}
pass('X latches ground/air origin, completes a genuine inversion, respects its planned headroom and returns airborne starts without any touchdown');

{
  const low=flat(4,{supplyMode:'finite',rollRateDegS:180,angularAccelerationDegS2:360,verticalAccelerationMps2:5,attitudeResponse:4.5}),state=snapshot(low);assert.equal(low.startManeuver('roll'),false);assert.equal(snapshot(low),state);assert.equal(low._maneuver,null);assert.match(low.status,/冲量/);
  const roof=new RoadsterSim({}, {world:'windlab'});roof.body.position.y=14;roof.setMode('hover');const before=snapshot(roof);assert.equal(roof.startManeuver('roll'),false);assert.equal(snapshot(roof),before);assert.match(roof.status,/净空/);
  for(const [tankLitres,height]of [[900,.62],[1100,4]]){
    // A finite positive case must declare a feasible faster profile: at the
    // calmer 180/360 default, 900 L now correctly fails the impulse preflight.
    const s=flat(height,{supplyMode:'finite',tankLitres,rollRateDegS:360,angularAccelerationDegS2:720,verticalAccelerationMps2:10,attitudeResponse:4.5});assert.equal(s.startManeuver('roll'),true);let inverted=false,completion=null;
    for(let i=0;i<12*PHYSICS_HZ;i++){
      s._advance(dt,{});assert.equal(s._fault,null);inverted ||= s.body.quaternion.vmult(new Vec3(0,1,0)).y<-.9;
      if(height>1)assert.equal(s._contactCount,0);
      if(!s._maneuver){completion=s.telemetry();break;}
    }
    assert.ok(inverted&&completion);assert.ok(completion.gasMass>30);close(completion.heightWorld,height<1?.60:height,.15,'Finite return state');
    assert.equal(completion.mode,height<1?'drive':'hover');
    values.finite.push({tankLitres,originHeightM:height,completionTimeS:completion.simTime,completionHeightM:completion.heightWorld,remainingGasKg:completion.gasMass,pressureBar:completion.pressureBar,finalMode:completion.mode});
  }
}
pass('Finite-X checks impulse before starting, adequate finite tanks preserve the requested return state, and insufficient overhead clearance declines without moving the vehicle');

for(const sign of [-1,1]){
  const s=flat(100);let angle=0,previous=s._angles().roll,inverted=false,maxRate=0;
  run(s,3.6,{roll:sign},sim=>{
    const next=sim._angles().roll;let delta=next-previous;while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI;
    angle+=delta;previous=next;inverted ||= sim.body.quaternion.vmult(new Vec3(0,1,0)).y<-.9;maxRate=Math.max(maxRate,sim.body.angularVelocity.length());
  });
  assert.ok(inverted&&Math.abs(angle)>2*Math.PI,'Held Z/B must continuously pass through a complete revolution');
  assert.ok(maxRate<3.2,'Angular rate must remain bounded by a controlled reference');
  const releaseRoll=s._angles().roll*180/Math.PI;
  const t=run(s,6);assert.ok(s.body.angularVelocity.length()<.04,'Release must brake angular velocity through nozzle moments');
  assert.ok(Math.abs(t.rollDeg)>15,'Release retains a changed attitude instead of snapping back to level');
  close(t.rollDeg,releaseRoll,.35,'Release holds the actual achieved roll');
  assert.ok(t.heightWorld<99,'Unsupported roll orientations must incur actual altitude loss');
  values.manualRoll.push({input:sign,accumulatedRollDeg:angle*180/Math.PI,peakAngularRateRadS:maxRate,releaseRollDeg:releaseRoll,settledRollDeg:t.rollDeg,settledAngularRateRadS:s.body.angularVelocity.length(),heightAfterM:t.heightWorld,poseFeasible:t.manualPoseFeasible});
}
pass('Non-level Z/B command continuous full roll in either direction, retain finite rates, physically brake on release and do not fake inverted support');

{
  // Reproduced with the former 3 m/s2 comfort cap: a 3.4 s roll starting
  // at 100 m stopped falling only at 41.5407232159318 m. A manual roll
  // has no pre-launch, so unsupported flight must still cost real height.
  const baselineLossM=100-41.5407232159318,results=[];
  for(const levelTakeover of [false,true]){
    const s=flat(32);let minimumHeightM=32,peakVerticalForceN=0,arrest=null,release=null;
    const t=run(s,10,(_time,i)=>{
      if(i===408&&levelTakeover)s.setAirStabilization(true);
      return{roll:i<408?1:0};
    },(sim,i)=>{
      assert.equal(sim._contactCount,0,'With adequate clearance the physical fall arrest must remain airborne');
      minimumHeightM=Math.min(minimumHeightM,sim.body.position.y);
      assert.ok(sim._nozzles.every(n=>n.force>=0&&n.force<=n.maxForce+1e-9),'Fall arrest cannot exceed an actual nozzle limit');
      if(i===407)release={heightM:sim.body.position.y,verticalSpeedMps:sim.body.velocity.y,rollDeg:sim._angles().roll*180/Math.PI};
      if(i>=408){
        const force=sim.body.quaternion.vmult(new Vec3(...sim._achievedWrench.slice(0,3)));
        peakVerticalForceN=Math.max(peakVerticalForceN,force.y);
        if(!arrest&&sim.body.velocity.y>=0)arrest={timeS:sim.simTime,heightM:sim.body.position.y};
      }
    });
    assert.ok(arrest&&minimumHeightM>4.5);
    assert.ok(32-minimumHeightM<baselineLossM*.50,'Use available braking thrust instead of prolonging a fast fall at the ordinary comfort cap');
    assert.ok(peakVerticalForceN>s.body.mass*(s.params.gravity+10),'The improvement must come from real additional upward nozzle force');
    assert.equal(t.stabilizationMode,levelTakeover?'level':'off');assert.equal(t.mode,'hover');
    if(levelTakeover)close(t.heightWorld,32,.06,'G-level takeover recovers the saved flight height through force control');
    results.push({levelTakeover,originHeightM:32,heldRollS:3.4,minimumHeightM,heightLossM:32-minimumHeightM,peakVerticalForceN,release,arrest,finalHeightM:t.heightWorld});
  }
  const low=flat(20);let firstContact=null;
  for(let i=0;i<408;i++){
    low._advance(dt,{roll:1});assert.equal(low._fault,null);
    if(low._contactCount){firstContact={timeS:low.simTime,heightM:low.body.position.y,verticalSpeedMps:low.body.velocity.y};break;}
  }
  assert.ok(firstContact&&firstContact.timeS<3.4&&firstContact.verticalSpeedMps< -8,'Insufficient 20 m clearance must produce a real collision, not an automatic jump or hidden ground avoidance');
  values.manualArrest={baselineComfortCapLossM:baselineLossM,adequateClearance:results,insufficient20mFirstContact:firstContact};
}
pass('Fast manual descent can use bounded physical braking thrust, remains controllable through G takeover, and still collides when an unplanned roll lacks clearance');

for(const sign of [-1,1]){
  const s=flat(20);let drift=0,maxRate=0,releasePitch=0;
  const t=run(s,8,(time)=>({pitch:time<.7?sign:0}),(sim,i)=>{drift=Math.max(drift,Math.hypot(sim.body.position.x,sim.body.position.z+350));maxRate=Math.max(maxRate,sim.body.angularVelocity.length());if(i===83)releasePitch=sim._angles().pitch*180/Math.PI;});
  assert.ok(t.pitchDeg*sign>18&&t.pitchDeg*sign<24,'0.7 s of the configured 32 deg/s rate produces a modest pitch change');
  close(t.pitchDeg,releasePitch,.15,'Release holds achieved pitch');assert.ok(maxRate<.85);assert.ok(drift<.15);assert.ok(t.speedKmh<.02);
  close(t.heightWorld,20,.03,'Supported pitch attitude keeps position');assert.equal(t.manualPoseFeasible,true);
  values.pitch.push({input:sign,settledPitchDeg:t.pitchDeg,peakAngularRateRadS:maxRate,peakHorizontalDriftM:drift,finalHeightM:t.heightWorld,finalSpeedKmh:t.speedKmh});
}
pass('Normalized 1/2 pitch requests change supported attitude smoothly while world-position feedback arrests translation and holds the result');

{
  const s=new RoadsterSim({}, {world:'windlab'});run(s,2);
  for(const bad of [{},{position:{x:0,y:4,z:0},quaternion:{x:0,y:0,z:0,w:0}},{position:{x:NaN,y:4,z:0},quaternion:{x:0,y:0,z:0,w:1}}]){
    const before=snapshot(s);assert.equal(s.setPoseTarget(bad),false);assert.equal(snapshot(s),before);
  }
  const q=new Quaternion();q.setFromEuler(-.12,0,.20,'YXZ');const before=snapshot(s);
  assert.equal(s.setPoseTarget({position:{x:0,y:4,z:0},quaternion:{x:q.x*2,y:q.y*2,z:q.z*2,w:q.w*2}}),true);assert.equal(snapshot(s),before,'Target setter must not write body state');
  assert.equal(s.mode,'hover','Explicit pose research must retain a valid airborne manual-control fallback');
  const t=run(s,10);assert.equal(t.holdStatus,'holding');assert.equal(t.holdFeasible,true);assert.ok(t.holdPositionError<.02&&t.holdAttitudeErrorDeg<.1);
  const inverted=flat(100);inverted.body.quaternion.setFromEuler(0,0,Math.PI);inverted.setPoseTarget({position:{x:0,y:100,z:-350},quaternion:{x:0,y:0,z:1,w:0}});
  const fall=run(inverted,1);assert.equal(fall.holdFeasible,false);assert.equal(fall.holdStatus,'limited');assert.ok(fall.verticalSpeed< -9.5);assert.ok(fall.thrustN<.01);
  for(const [key,badValue,limit]of [['positionGain',100,8],['rollRateDegS',1000,360],['pitchRateDegS',0,5]]){s.setParam(key,badValue);assert.equal(s.params[key],limit);}
}
pass('Research pose targets validate atomically, can take off through real force from supported wheels, expose bounded tuning and report unsupported inversion honestly');

{
  const states=[];
  for(const fps of [30,60,144]){
    const s=flat(20),samples=[],calls=[];s.setWind({speedMps:12,directionDeg:60,gustMps:3,gustPeriodS:1.7});
    for(let frame=0;frame<fps*3;frame++)s.step(1/fps,(time,fixedDt)=>{calls.push(time);close(fixedDt,dt,1e-15,'provider dt');return{pitch:time<.55?.4:0,throttle:time>1&&time<1.8?.2:0,lift:time>2?.1:0};},sample=>samples.push(sample.simTime));
    assert.equal(calls.length,3*PHYSICS_HZ);assert.equal(samples.length,60);calls.forEach((time,i)=>close(time,i*dt,1e-11,'fixed-step provider clock'));
    states.push([...Object.values(s.body.position),...Object.values(s.body.velocity),...Object.values(s.body.quaternion),...Object.values(s.body.angularVelocity)]);
  }
  for(const state of states.slice(1))state.forEach((value,i)=>close(value,states[0][i],1e-12,'Display cadence invariance (floating-point quaternion normalization tolerance)'));
}
pass('Program input providers and wind advance at exactly 120 Hz independently of 30/60/144 Hz rendering, while the existing 20 Hz sample callback is retained');

{
  const s=flat(20),p=s.params;s.setMode('manual');assert.equal(s.setWind({speedMps:20,directionDeg:90,gustMps:5,gustPeriodS:2}),true);
  s.body.force.setZero();s.body.torque.setZero();s._aero(0);
  close(s.body.force.x,.5*p.airDensity*1.4*400,1e-9,'Drag from actual relative air velocity');close(s.body.force.z,0,1e-9,'Wind flow convention');
  const before=s.getWind();assert.equal(s.setWind({speedMps:Infinity}),false);assert.deepEqual(s.getWind(),before);
  const t=run(s,.5);close(t.windVelocity.x,25,1e-9,'Analytic gust');assert.ok(t.velocity.x>0,'Wind must accelerate the unregulated rigid body');
  s.clearWind();assert.equal(s.getWind(),null);assert.deepEqual(s.telemetry().windVelocity,{x:0,y:0,z:0});
  values.wind={directionConvention:'0 deg toward +Z; 90 deg toward +X',forceAt20MpsN:.5*p.airDensity*1.4*400,gustPeakMps:t.windVelocity.x};
}
pass('Prescribed lab wind acts through relative-airflow aerodynamic force with deterministic gust timing, validated parameters and a true calm reset');

writeFileSync(`qa/flight-controls-${REPORT_VERSION}.json`,JSON.stringify({status:'passed',physicsHz:PHYSICS_HZ,checks,values,
  limits:'Deterministic reduced-order engineering model, not OEM identification. Flat-ground and authored lab fixtures are numerical acceptance checks. They do not certify arbitrary obstacles, all finite-tank parameters or real vehicle operation. One-way lift and bounded side jets cannot statically support every attitude; no inverse lift or pose freeze is introduced.'},null,2)+'\n');
console.log(`Flight controls 3.7: ${checks.length} acceptance groups passed.`);
