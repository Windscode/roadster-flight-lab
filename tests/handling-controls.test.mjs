import assert from 'node:assert/strict';
import {RoadsterSim,PHYSICS_HZ} from '../dist/physics.js';
import {driverAxes} from '../dist/controls.js';
import {soundState} from '../dist/audio.js';
import * as CANNON from '../dist/vendor/cannon-es.js';
const dt=1/PHYSICS_HZ;
const flat=()=>{const s=new RoadsterSim({supplyMode:'finite'});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.body.position.set(0,.62,-350);for(let k=0;k<360;k++)s.step(dt);return s;};

for(const [key,sign]of [['KeyD',-1],['ArrowRight',-1],['KeyA',1],['ArrowLeft',1]]){
  const s=flat(),i=driverAxes(new Set([key]));assert.equal(Math.sign(i.steer),sign);s.body.velocity.z=10;
  for(let k=0;k<120;k++)s.step(dt,{...i,throttle:.2});assert.ok(s.body.position.x*sign>.5,'Driver-right must curve toward local -X');
}
const pad={connected:true,axes:[.7,0,.6],buttons:[]};
assert.equal(driverAxes(new Set(),pad).steer,-.7);assert.equal(driverAxes(new Set(),pad).roll,-.6);
assert.equal(driverAxes(new Set(['KeyD']),pad).steer,-1);
assert.equal(driverAxes(new Set(['KeyB'])).roll,-1);
console.log('PASS: Keyboard, arrow, touch-key and gamepad steering share driver-right coordinates');

for(const speed of [100,200,300])for(const sign of [-1,1]){
  const s=flat();s.body.velocity.z=speed/3.6;s.body.quaternion.setFromEuler(0,sign*1e-5,0);
  let maxYaw=0,stopped=false;
  for(let k=0;k<10*PHYSICS_HZ;k++){
    const t=s.step(dt,{brake:1});assert.equal(t.fault,null);assert.equal(t.contactCount,4);
    assert.equal(s.world.contacts.filter(c=>c.bi===s.body||c.bj===s.body).length,0,'A scenery impact must not create the stop');
    const fw=s.body.quaternion.vmult({x:0,y:0,z:1});maxYaw=Math.max(maxYaw,Math.abs(Math.atan2(fw.x,fw.z)));
    const wheels=t.wheelStates,total=wheels.reduce((a,w)=>a+w.normalLoadN,0);
    for(const w of wheels){assert.ok(Math.abs(w.brakeDemandN/s.params.brakeForce-w.normalLoadN/total)<1e-10);assert.ok(w.gripUse<=1+1e-10);}
    if(t.speedKmh<.36){stopped=true;break;}
  }
  assert.ok(stopped&&maxYaw<.01*Math.PI/180,'A microscopic yaw disturbance must not become a brake spin');
}
console.log('PASS: 100–300 km/h perturbed braking remains upright with load-proportional EBD and bounded tire forces');

for(const [frontJets,rearJets]of [[1,0],[0,1],[1,1]]){
  const s=flat();s.body.position.y=5;s.setMode('drive');let impulse=0;const gas=s.gasMass;
  for(let k=0;k<12;k++){const t=s.step(dt,{frontJets,rearJets});impulse+=t.massFlowKgS*dt;}
  const t=s.telemetry();assert.ok(t.nozzles.slice(0,2).every(n=>frontJets?n.command>19000:n.command===0));
  assert.ok(t.nozzles.slice(2,4).every(n=>rearJets?n.command>19000:n.command===0));
  assert.ok(t.nozzles.slice(4).every(n=>n.command===0));
  assert.ok(Math.abs(gas-s.gasMass-impulse)<1e-9,'Manual jets must consume the same physical impulse budget');
  if(frontJets!==rearJets)assert.equal(Math.sign(t.angularVelocity.x),frontJets?-1:1);
  else assert.ok(Math.abs(t.angularVelocity.x)<1e-9);
  const force=t.thrustN;s.step(dt,{});assert.ok(s.telemetry().thrustN<force&&s.telemetry().thrustN>0,'Release uses physical closing-valve lag');
}
const weak=flat();weak.body.position.y=5;weak.setParam('initialPressureBar',20);weak.step(dt,{frontJets:1});assert.ok(weak.telemetry().nozzles[0].command<8000);
const dead=flat();dead._energyUsed=dead.params.batteryKWh;dead.step(dt,{frontJets:1,rearJets:1});assert.equal(dead.telemetry().thrustN,0);
assert.equal(driverAxes(new Set(['Digit1'])).pitch,1);assert.equal(driverAxes(new Set(['Numpad2'])).pitch,-1);
assert.equal(driverAxes(new Set(['Digit1','Digit2'])).pitch,0);
assert.equal(driverAxes(new Set(['Digit1'])).frontJets,0);assert.equal(driverAxes(new Set(['Digit2'])).rearJets,0);
const pitchPad={connected:true,axes:[0,0,0],buttons:[{},{},{},{},{value:.7},{value:.2}]};
assert.ok(Math.abs(driverAxes(new Set(),pitchPad).pitch-.5)<1e-12);
assert.equal(driverAxes(new Set(['Digit2']),pitchPad).pitch,-1);
console.log('PASS: Front/rear pair overrides retain pitch moment, valve lag, pressure limits and gas conservation');

const rest={forwardSpeedKmh:0,motorLoad:0,regenForceN:0,thrustN:0,suctionN:0,contactCount:4};
assert.equal(soundState(rest).motorGain,0);assert.equal(soundState(rest).roadGain,0);
const coast=soundState({...rest,forwardSpeedKmh:100}),pull=soundState({...rest,forwardSpeedKmh:100,motorLoad:.8});
assert.equal(coast.motorHz,pull.motorHz);assert.ok(pull.motorGain>.02&&coast.motorGain===0);
assert.ok(soundState({...rest,regenForceN:2500}).motorGain>0);
assert.equal(soundState({...rest,forwardSpeedKmh:100,contactCount:0}).roadGain,0);
assert.ok(soundState({...rest,thrustN:40000}).jetGain>0);
console.log('PASS: EV level responds to actual drive/regen load; rolling and gas sources stay separate and idle is silent');

// Compare the new broad phase with the engine's full reference scan, including
// hundreds of rotations and vertical rays across the actual authored city.
const s=new RoadsterSim(),grid=s.world.broadphase,reference=new CANNON.NaiveBroadphase();reference.useBoundingBoxes=true;
let seed=3827;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const pairs=bp=>{const a=[],b=[];bp.collisionPairs(s.world,a,b);return a.map((v,i)=>[v.id,b[i].id].sort((x,y)=>x-y).join(':')).sort();};
for(let k=0;k<160;k++){
  s.body.position.set(rand()*1200-600,rand()*35,rand()*1200-600);s.body.quaternion.setFromEuler(rand()*3,rand()*6,rand()*3);s.body.aabbNeedsUpdate=true;
  assert.deepEqual(pairs(grid),pairs(reference));
  const from={x:s.body.position.x,y:180,z:s.body.position.z},dir={x:0,y:-1,z:0};
  s.world.broadphase=grid;const a=s.traceSurface(from,dir,200);s.world.broadphase=reference;const b=s.traceSurface(from,dir,200);s.world.broadphase=grid;
  assert.equal(!!a,!!b);if(a)assert.ok(Math.abs(a.distance-b.distance)<1e-9);
}
console.log('PASS: Static-city grid matches reference collision pairs and surface rays across 160 randomized poses');

for(const name of ['city','harbor','skyway','garden','waterfront','sculpture']){const sim=new RoadsterSim();sim.reset(name);for(let k=0;k<240;k++)sim.step(dt);const t=sim.telemetry();assert.equal(t.fault,null);assert.equal(t.contactCount,4,name+' must spawn above a safe, load-bearing surface');assert.ok(Math.abs(t.pitchDeg)<1&&Math.abs(t.rollDeg)<1);}
const dock=new RoadsterSim();dock.reset('waterfront');for(let k=0;k<240;k++)dock.step(dt);
for(let k=0;k<1080;k++){const brake=dock.body.position.z<=-470;const t=dock.step(dt,{throttle:brake?0:.16,brake:brake?1:0});assert.equal(t.contactCount,4);assert.equal(t.fault,null);assert.equal(dock.world.contacts.filter(c=>c.bi===dock.body||c.bj===dock.body).length,0);}
assert.ok(dock.body.position.z< -470&&dock.body.velocity.length()<.15,'Waterfront ramp must join the elevated quay and permit a stable stop');
console.log('PASS: Six safe city spawns and the full waterfront ramp retain four tire contacts without hull impacts');
