import assert from 'node:assert/strict';
import {RoadsterSim,PHYSICS_HZ} from '../dist/physics.js';

const dt=1/PHYSICS_HZ;
function bodyContacts(sim){
  return sim.world.contacts.filter(c=>{
    if(c.bi!==sim.body&&c.bj!==sim.body)return false;
    return (c.bi===sim.body?c.si:c.sj)?.material?.name!=='wheel-bump-stop';
  });
}
function stopRun({throttle=0,boost=false,batteryKWh=200,gas='full',speedKmh=100}={}){
  const sim=new RoadsterSim({batteryKWh});sim.body.position.set(0,.62,-80);
  if(gas==='empty'){sim.gasMass=0;sim._updateMass(true);}
  for(let i=0;i<3*PHYSICS_HZ;i++)sim.step(dt,{});
  assert.equal(sim.telemetry().contactCount,4,'The stop must start on four loaded tires');
  sim.body.velocity.set(0,0,speedKmh/3.6);sim.body.angularVelocity.setZero();
  // Author a rolling initial condition rather than a locked wheel at speed.
  sim.wheelStates.forEach(w=>w.angularVelocityRadS=sim.body.velocity.z/sim.params.wheelRadius);
  const start=sim.simTime,z0=sim.body.position.z;
  let stop=null,held=0,minSuspension=Infinity,allLoaded=true;
  // A broad bound derived from the assumed tire limit; the regression checks
  // brake authority and stable stop, not a fragile exact distance constant.
  const horizon=2.5*(speedKmh/3.6)/(sim.params.tireMu*sim.params.gravity)+1.5;
  for(let i=0;i<Math.ceil(horizon*PHYSICS_HZ);i++){
    const t=sim.step(dt,{throttle,boost,brake:1});
    assert.equal(t.fault,null,'A reset is not a brake stop');
    assert.ok(t.simTime>start,'Simulation time must progress without reset');
    assert.equal(bodyContacts(sim).length,0,'Body impact must not shorten the stopping distance');
    assert.ok(Math.abs(t.rollDeg)<8&&Math.abs(t.pitchDeg)<8,'Stop must remain upright');
    allLoaded&&=t.contactCount===4;
    minSuspension=Math.min(minSuspension,...t.wheelStates.map(w=>w.suspensionLength));
    if(!stop&&Math.abs(t.forwardSpeedKmh)<.36&&t.contactCount===4)stop={time:t.simTime-start,distance:t.position.z-z0};
    if(stop){held=Math.abs(t.forwardSpeedKmh)<.54&&t.contactCount===4?held+dt:0;if(held>=1)break;}
  }
  assert.ok(stop&&held>=1,'Deliberate brake must reach and hold a complete stop');
  assert.ok(allLoaded,'Straight level-floor braking must retain tire normal loads');
  assert.ok(minSuspension>=sim.params.suspensionMin-1e-9,'Visible suspension must respect the shared compression envelope');
  return {...stop,minSuspension,final:sim.telemetry()};
}

const reference=stopRun();
const conflict=stopRun({throttle:1});
assert.ok(Math.abs(conflict.distance-reference.distance)/reference.distance<.05,'Holding accelerator must not weaken deliberate braking');
assert.ok(Math.abs(conflict.final.forwardSpeedKmh)<.05,'Brake must suppress the old accelerator creep equilibrium');
console.log('PASS: Explicit brake takes priority over held accelerator and remains at rest');

const boosting=stopRun({throttle:1,boost:true});
assert.ok(Math.abs(boosting.distance-reference.distance)/reference.distance<.05,'Driving boost must not defeat deliberate braking');
assert.equal(boosting.final.thrustN,0,'Driving booster must be inhibited while the brake is held');
assert.ok(Math.abs(boosting.final.forwardSpeedKmh)<.05,'Brake must hold the stopped vehicle even with boost requested');
console.log('PASS: Explicit brake inhibits driving boost as well as motor torque');

const unpowered=stopRun({batteryKWh:0});
assert.ok(Math.abs(unpowered.distance-reference.distance)/reference.distance<.08,'Mechanical service brake must work without electrical power');
assert.equal(unpowered.final.energyKWh,0);
assert.equal(unpowered.final.thrustN,0);
console.log('PASS: Unpowered vehicle retains mechanical service braking');

const empty=stopRun({gas:'empty',speedKmh:50});
assert.ok(empty.final.mass<reference.final.mass,'Empty gas must actually reduce the tested mass');
assert.ok(empty.distance<reference.distance*.4,'Half-speed braking should require substantially less distance');
assert.ok(reference.minSuspension>=.24&&empty.minSuspension>=.24);
console.log('PASS: Loaded and empty vehicles brake within the wheel-arch compression contract');
