import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {RoadsterSim, SCENARIOS} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {Vec3} from '../dist/vendor/cannon-es.js';
import * as THREE from '../dist/vendor/three.module.js';
import {ColdGasExhaust,plumeOutlets} from '../dist/exhaust.js';
import {telemetryRow,TELEMETRY_COLUMNS,telemetryCSV} from '../dist/telemetry.js';

const results=[];
let rotationReport;
const run=(s,seconds,input={},observe,{allowFault=false}={})=>{
  const started=s.simTime,steps=Math.round(seconds*120);let previous=started,sawFault=false;
  for(let i=0;i<steps;i++) {
    const t=s.step(1/120,input);
    if(t.fault) {sawFault=true;assert.ok(allowFault,`unexpected simulation recovery at substep ${i}: ${t.fault}`);}
    if(!allowFault || !sawFault) {
      assert.ok(t.simTime>previous,`simulation time failed to advance at substep ${i}: ${previous} -> ${t.simTime}`);
      close(t.simTime,started+(i+1)/120,1e-8,'fixed-step elapsed time');
    }
    previous=t.simTime;if(observe)observe(t,i);
  }
  if(!allowFault||!sawFault)close(s.simTime,started+steps/120,1e-8,'complete requested run duration');
  return s.telemetry();
};
const close=(actual,expected,tolerance,label)=>assert.ok(Math.abs(actual-expected)<=tolerance,
  `${label}: ${actual} versus ${expected} ± ${tolerance}`);
const test=(name,fn)=>{const start=performance.now();console.log('RUN: '+name);fn();const ms=Math.round(performance.now()-start);results.push({test:name,status:'PASS',ms});console.log('PASS: '+name+' ('+ms+' ms)');};

const spinInvariants=b=>{
  const local=b.quaternion.conjugate().vmult(b.angularVelocity);
  const L=b.quaternion.vmult(new Vec3(local.x*b.inertia.x,local.y*b.inertia.y,local.z*b.inertia.z));
  return {L,E:.5*b.angularVelocity.dot(L)};
};
const freeSpin=(dt,seconds=1,torque=new Vec3())=>{
  const s=new RoadsterSim(),b=s.body;s.world.gravity.setZero();b.position.set(0,100,0);
  b.linearDamping=0;b.angularDamping=0;b.angularVelocity.set(.7,1.2,.4);
  const first=spinInvariants(b),count=Math.round(seconds/dt);
  let maxMomentumError=0,maxEnergyError=0;
  for(let i=0;i<count;i++) {
    b.torque.copy(torque);s.world.step(dt);const state=spinInvariants(b);
    maxMomentumError=Math.max(maxMomentumError,state.L.vsub(first.L).vsub(torque.scale((i+1)*dt)).length()/first.L.length());
    maxEnergyError=Math.max(maxEnergyError,Math.abs(state.E-first.E)/first.E);
  }
  const last=spinInvariants(b);
  close(s.world.time,count*dt,1e-9,'world integration elapsed time');
  return {momentumError:last.L.vsub(first.L).vsub(torque.scale(count*dt)).length()/first.L.length(),
    energyError:Math.abs(last.E-first.E)/first.E,maxMomentumError,maxEnergyError,omega:b.angularVelocity.clone()};
};

test('Asymmetric torque-free rotation conserves world angular momentum and rotational energy',()=>{
  const one=freeSpin(1/120,1),ten=freeSpin(1/120,10);
  rotationReport={initialAngularVelocityRadPerSec:[.7,1.2,.4],hz:120,durationSeconds:10,worldAngularMomentumRelativeError:ten.momentumError,peakRotationalEnergyRelativeError:ten.maxEnergyError,stepConvergence:'second order'};
  assert.ok(one.momentumError<1e-10,`1 s L error ${one.momentumError}`);
  assert.ok(ten.momentumError<1e-9,`10 s L error ${ten.momentumError}`);
  assert.ok(one.energyError<1e-5,`1 s E error ${one.energyError}`);
  assert.ok(ten.energyError<1e-5,`10 s E error ${ten.energyError}`);
  assert.ok(ten.maxMomentumError<1e-9,`10 s peak L error ${ten.maxMomentumError}`);
  assert.ok(ten.maxEnergyError<1e-5,`10 s peak E error ${ten.maxEnergyError}`);
  assert.ok(one.omega.vsub(new Vec3(.7,1.2,.4)).length()>.1,'asymmetric free rotation must evolve omega');
  const driven=freeSpin(1/120,1,new Vec3(1500,-400,800));
  assert.ok(driven.momentumError<1e-10,'angular momentum change must equal the external torque impulse');
});

test('Rotational midpoint integration shows second-order step-size convergence',()=>{
  const coarse=freeSpin(1/60),medium=freeSpin(1/120),fine=freeSpin(1/240),reference=freeSpin(1/1920);
  const coarseError=coarse.omega.vsub(reference.omega).length();
  const mediumError=medium.omega.vsub(reference.omega).length();
  const fineError=fine.omega.vsub(reference.omega).length();
  assert.ok(mediumError<coarseError*.30,'halving timestep must reduce rotation error by approximately four');
  assert.ok(fineError<mediumError*.30,'further halving must preserve second-order convergence');
  assert.ok(medium.energyError<coarse.energyError*.30);assert.ok(fine.energyError<medium.energyError*.30);
});

test('10 s ground rest: four contacts, no translation or rotational drift',()=>{
  const s=new RoadsterSim();const t=run(s,10);
  close(t.position.x,0,1e-6,'x drift');close(t.position.z,-28,1e-6,'z drift');
  assert.ok(t.position.y>.55&&t.position.y<.66);assert.equal(t.contactCount,4);
  assert.ok(t.speedKmh<.001);assert.ok(Math.abs(t.rollDeg)<.01);assert.equal(t.thrustN,0);
  assert.ok(t.wheelStates.every(w=>w.contactNormalWorld.y>.99&&Math.abs(w.contactPointWorld.y)<.01),'load vectors use actual ground contact normals and points');
});

test('1 s free fall follows gravity without hidden altitude or attitude forces',()=>{
  const s=new RoadsterSim();s.body.position.y=12;s.setMode('drive');
  const t=run(s,1);
  close(t.verticalSpeed,-9.81,.09,'fall velocity');close(t.position.y,12-9.81/2,.10,'fall distance');
  assert.equal(t.contactCount,0);assert.equal(t.thrustN,0);assert.equal(t.suctionN,0);
});

test('Motor acceleration, friction-limited braking and steering turn the actual body',()=>{
  const s=new RoadsterSim();const accelerating=run(s,3,{throttle:1});
  assert.ok(accelerating.speedKmh>75);const movingZ=accelerating.position.z;
  const stopped=run(s,3,{brake:1});assert.ok(stopped.speedKmh<.5);assert.ok(stopped.position.z>movingZ);
  s.reset();const corner=run(s,2,{throttle:.4,steer:.55});
  assert.ok(corner.position.x>.4);assert.ok(corner.headingDeg>8&&corner.headingDeg<140);
});

test('Bench-fed hover tracks height, translates and returns to a low-speed hold',()=>{
  const s=new RoadsterSim({supplyMode:'bench'});s.reset('hover');s.setParam('hoverHeight',7);
  let t=run(s,6);close(t.position.y,7,.015,'height tracking');assert.equal(t.contactCount,0);
  const z=t.position.z;t=run(s,3,{throttle:.45});assert.ok(t.position.z-z>6);
  t=run(s,8);assert.ok(t.speedKmh<.2);close(t.position.y,7,.015,'moving height');
  close(t.gasFraction,1,1e-12,'bench tank mass');
});

test('Ceiling pressure holds for 10 s, permits tire-driven movement, then releases',()=>{
  const s=new RoadsterSim();s.reset('ceiling');let t=run(s,10);
  assert.equal(t.contactCount,4);assert.ok(t.suctionN>t.mass*9.81);close(t.position.y,7.39,.04,'ceiling hold');
  assert.ok(t.wheelStates.every(w=>w.contactNormalWorld.y<-.99),'ceiling contact normal must point down into the vehicle');
  const z=t.position.z;t=run(s,1.25,{throttle:.3});assert.ok(t.position.z-z>1.4);
  s.setSuction(false);t=run(s,.7);assert.ok(t.verticalSpeed<-4);assert.ok(t.contactCount===0);
});

test('Suction requires a nearby supporting surface: no magnetic capture in free air',()=>{
  const s=new RoadsterSim();s.reset('hover');s.setMode('drive');s.body.position.y=12;s.setSuction(true);
  const t=run(s,.5);assert.equal(t.suctionN,0);assert.equal(t.sealQuality,0);
  close(t.verticalSpeed,-4.905,.04,'unsealed fall velocity');
});

test('Finite gas consumption equals summed nozzle impulse divided by effective exhaust velocity',()=>{
  const s=new RoadsterSim({supplyMode:'finite'});s.reset('hover');const before=s.gasMass;let impulse=0;
  const t=run(s,3,{},frame=>{impulse+=frame.massFlowKgS/120;});
  close(before-s.gasMass,impulse,.0001,'propellant bookkeeping');
  close(t.mass,s.params.dryMass+s.gasMass,.31,'changing total mass');assert.ok(t.pressureBar<250);
  close(t.thrustN,t.nozzles.reduce((a,n)=>a+n.force,0),1e-8,'nozzle force total');
});

test('Exhausted gas removes all thrust; prolonged finite hover loses support',()=>{
  const empty=new RoadsterSim({supplyMode:'finite'});empty.reset('hover');empty.gasMass=0;
  const t=run(empty,.5);assert.equal(t.thrustN,0);assert.ok(t.verticalSpeed<-4);
  const finite=new RoadsterSim({supplyMode:'finite'});finite.reset('hover');const depleted=run(finite,10);
  // Cooling leaves a little unusable gas; loss of pressure, not an exactly
  // empty tank, is the physical condition that removes support.
  assert.ok(depleted.gasFraction<.04);assert.ok(depleted.thrustMargin<.1);assert.ok(depleted.heightWorld<1.1);assert.ok(depleted.pressureLimited);
  finite.refillGas();assert.equal(finite.telemetry().gasFraction,1);
});

test('A full roll is a six-DOF actuator maneuver with inversion, ballistic descent and recovery',()=>{
  const s=new RoadsterSim({supplyMode:'bench'});s.reset('hover');s.startManeuver('roll');
  let inverted=false,minY=Infinity,rotating=false;
  // Shared 180/360 references require a longer physical prelaunch and return.
  const t=run(s,15,{},frame=>{
    const up=s.body.quaternion.vmult({x:0,y:1,z:0});if(up.y<-.9)inverted=true;
    if(frame.maneuver?.phase==='rotate') {rotating=true;minY=Math.min(minY,frame.heightWorld);}
  });
  assert.ok(inverted);assert.ok(rotating);assert.ok(minY>1);assert.ok(Math.abs(t.rollDeg)<2);
  assert.ok(Math.abs(t.verticalSpeed)<.2);assert.equal(t.maneuver,null);
});

test('180° arch traversal continuously climbs from ground and stops upside down',()=>{
  const s=new RoadsterSim();s.reset('ramp');s.startManeuver('ramp');
  let maxHeight=0,passedVertical=false;
  const t=run(s,22,{},frame=>{
    maxHeight=Math.max(maxHeight,frame.heightWorld);if(Math.abs(frame.pitchDeg)>85)passedVertical=true;
  });
  assert.ok(passedVertical);assert.ok(maxHeight>17);assert.ok(t.heightWorld>17&&t.heightWorld<18);
  assert.ok(t.position.z<40);assert.equal(t.contactCount,4);assert.ok(t.speedKmh<.1);
  assert.ok(s.body.quaternion.vmult({x:0,y:1,z:0}).y<-.99);
  assert.equal(t.thrustN,0);assert.equal(t.gasFraction,1);
});

test('Mode takeover, non-finite input guards and scenario resets remain finite',()=>{
  const s=new RoadsterSim();s.reset('ramp');s.startManeuver('ramp');run(s,1);s.startManeuver('cancel');
  assert.equal(s.mode,'drive');assert.equal(s.telemetry().maneuver,null);
  s.body.velocity.x=NaN;run(s,1/60,{throttle:Infinity,lift:NaN},undefined,{allowFault:true});assert.ok(s.telemetry().fault);
  assert.ok(Number.isFinite(s.body.position.y));
  for(const key of Object.keys(SCENARIOS)) {
    s.reset(key);s.setSupplyMode('bench');const t=run(s,2,{throttle:NaN,steer:Infinity});
    assert.ok(Object.values(t.position).every(Number.isFinite));assert.ok(!t.fault);
  }
  s.setParam('dryMass',NaN);assert.ok(Number.isFinite(s.body.mass));
});

test('Normal test runs reject a hidden recovery instead of accepting a shortened simulation',()=>{
  const s=new RoadsterSim();
  assert.throws(()=>run(s,10,{},(_,i)=>{if(i===399)s.body.velocity.x=NaN;}),/unexpected simulation recovery/);
});

test('Collision geometry exposes every static collider, including arch and boundaries',()=>{
  const s=new RoadsterSim(),g=s.getWorldGeometry();
  assert.equal(g.length,s.world.bodies.filter(b=>b.mass===0).length);
  assert.equal(g.filter(x=>x.kind==='arch').length,64);
  assert.ok(g.every(x=>x.position.length===3&&x.quaternion.length===4&&x.size.length===3));
});

test('Released accelerator coasts with mild regeneration instead of hidden hard braking',()=>{
  const s=new RoadsterSim();run(s,3,{throttle:1});const before=s.body.velocity.length();run(s,1);
  const deceleration=before-s.body.velocity.length();assert.ok(deceleration>.2&&deceleration<2,`coast deceleration ${deceleration}`);
});

test('Valve output has finite rise and decay, and consumed gas follows delivered force',()=>{
  const s=new RoadsterSim({supplyMode:'finite'});s.reset('hover');s.setMode('manual');const t=s.step(1/120,{lift:1});
  assert.ok(t.thrustN>1000&&t.thrustN<25000,`first-step thrust ${t.thrustN}`);
  assert.ok(t.nozzles.some(n=>n.command>n.force*2));run(s,.3,{lift:1});const before=s.telemetry().thrustN;const next=s.step(1/120);
  assert.ok(next.thrustN>0&&next.thrustN<before);run(s,.5);assert.ok(s.telemetry().thrustN<.01);
});

test('Adiabatic blowdown cools the tank and has lower pressure than the equal-mass isothermal case',()=>{
  const s=new RoadsterSim({supplyMode:'finite'});s.reset('hover');run(s,2);
  const t=s.telemetry(),isothermal=t.gasFraction*s.params.initialPressureBar;
  assert.ok(t.gasTemperatureK<270);assert.ok(t.pressureBar<isothermal);
  close(t.pressureBar,t.gasMass*287.05*t.gasTemperatureK/(s.params.tankLitres/1000)/1e5,1e-8,'ideal gas pressure');
  s.setParam('gasModel','isothermal');run(s,1);close(s.telemetry().gasTemperatureK,s.params.gasTemperatureK,1e-9,'isothermal comparison');
});

test('After a roll, hover does not retain opposing side jets in the allocator null space',()=>{
  const s=new RoadsterSim({supplyMode:'bench'});s.reset('hover');s.startManeuver('roll');const t=run(s,15);
  const side=t.nozzles.filter(n=>n.kind==='roll').reduce((a,n)=>a+n.force,0);
  assert.ok(side<10,`idle side thrust ${side}`);assert.ok(Math.abs(t.thrustN-t.mass*9.81)<30);
});

test('A ground-origin automatic roll with adequate finite impulse returns to a gentle landing before fuel loses support',()=>{
  // X uses the independent quick-roll profile; the manual controls below do
  // not expand its nozzle limits. Finite shortfalls are tested separately.
  const s=new RoadsterSim({supplyMode:'finite',tankLitres:900,rollRateDegS:360,angularAccelerationDegS2:720,verticalAccelerationMps2:10});s.reset('free');assert.equal(s.startManeuver('roll'),true);let minimum=99,inverted=false,firstContact=null;
  const t=run(s,10,{},frame=>{
    if(frame.maneuver?.phase==='rotate'){minimum=Math.min(minimum,frame.heightWorld);assert.equal(frame.contactCount,0);}
    if(s.body.quaternion.vmult({x:0,y:1,z:0}).y<-.9)inverted=true;
    if(frame.simTime>2&&frame.contactCount&&!firstContact)firstContact={speed:Math.abs(frame.verticalSpeed),gas:frame.gasMass};
  });
  assert.ok(inverted);assert.ok(minimum>1.3);assert.ok(firstContact.speed<.65,`touchdown ${firstContact.speed}`);assert.ok(firstContact.gas>10);
  assert.equal(t.mode,'drive');assert.equal(t.maneuver,null);assert.equal(t.contactCount,4);assert.ok(t.speedKmh<.05);
});

test('Twenty-Hz telemetry is uniform at 30, 60 and 144 display frames per second',()=>{
  for(const fps of [30,60,144]){
    const s=new RoadsterSim({supplyMode:'bench'});s.reset('hover');const samples=[];
    for(let frame=0;frame<fps*3;frame++)s.step(1/fps,{},sample=>samples.push(sample.simTime));
    assert.equal(samples.length,60,`${fps} fps sample count`);
    samples.forEach((time,i)=>close(time,(i+1)/20,1e-8,'sample timestamp'));
  }
});

test('Power exhaustion removes motor, fan and jet authority even with an external gas supply',()=>{
  const s=new RoadsterSim({batteryKWh:1e-6,supplyMode:'bench'});s.reset('hover');s.setSuction(true);const t=run(s,.65,{throttle:1,lift:1,boost:true});
  assert.equal(t.energyKWh,0);assert.equal(t.thrustN,0);assert.ok(t.suctionN<1);assert.ok(t.verticalSpeed<-5);
});

test('A slow altitude integral rejects a constant unmodelled vertical load without pose correction',()=>{
  const s=new RoadsterSim({supplyMode:'bench'});s.reset('hover');
  for(let i=0;i<120*50;i++){s.body.applyForce(new Vec3(0,-1500,0));s.step(1/120);}
  close(s.body.position.y,4,.015,'disturbed altitude');assert.ok(s.telemetry().thrustN>s.body.mass*9.81+1300);
});

test('CSV schema contains quaternion, gas temperature and both nozzle command and delivered force',()=>{
  const s=new RoadsterSim();s.reset('hover');run(s,.2);const row=telemetryRow(s.telemetry());
  assert.equal(row.length,TELEMETRY_COLUMNS.length);assert.ok(TELEMETRY_COLUMNS.includes('qw'));assert.ok(TELEMETRY_COLUMNS.includes('gas_temperature_K'));assert.ok(TELEMETRY_COLUMNS.includes('lift-FL_command_N'));
  const csv=telemetryCSV([row],{params:s.params,events:[{type:'test'}],date:'test'});assert.ok(csv.includes('Initial parameters'));assert.equal(csv.split('\r\n').at(-1).split(',').length,row.length);
});

test('World-space exhaust preserves force sign and does not attach old gas to a moving vehicle',()=>{
  const sim=new RoadsterSim({supplyMode:'bench'});sim.reset('hover');const t=run(sim,1),scene=new THREE.Scene(),effect=new ColdGasExhaust(scene,null,{seed:1});
  const outlets=plumeOutlets(t.nozzles);assert.ok(outlets.filter(o=>o.id.startsWith('lift')).every(o=>o.direction.y===-1));
  for(let i=0;i<20;i++)effect.update(t,1/60);assert.ok(effect.particles.length>10);
  const particle=effect.particles.find(p=>p.life>.5),before=particle.position.clone();
  const off={...t,position:{x:1000,y:4,z:1000},nozzles:t.nozzles.map(n=>({...n,force:0}))};effect.update(off,1/60);
  assert.ok(particle.position.distanceTo(before)<2);assert.ok(particle.position.x<10);
  const stopped=particle.position.clone();effect.update(off,0);assert.ok(particle.position.equals(stopped));effect.dispose();
});

test('Mist emission count is frame-rate independent and rear outlets share one actuator force',()=>{
  const sim=new RoadsterSim({supplyMode:'bench'});sim.reset('hover');const t=run(sim,1),counts=[];
  for(const fps of [30,60,144]){const effect=new ColdGasExhaust(new THREE.Scene(),null);for(let i=0;i<fps;i++)effect.update(t,1/fps);counts.push(effect.emitted);effect.dispose();}
  assert.ok(Math.max(...counts)-Math.min(...counts)<=4,`emission counts ${counts}`);
  const rear={id:'rear-boost',kind:'longitudinal',position:{x:0,y:0,z:-2.07},direction:{x:0,y:0,z:1},force:11000};
  const outlets=plumeOutlets([rear]);assert.equal(outlets.length,4);assert.equal(outlets.reduce((s,n)=>s+n.force,0),11000);
});

console.table(results);
console.log(`${results.length} meaningful physics acceptance checks passed.`);
if(process.argv.includes('--report'))writeFileSync(new URL('../dist/validation.json',import.meta.url),JSON.stringify({
  generatedAt:new Date().toISOString(),model:'Roadster Flight Lab '+MODEL_VERSION,scope:'软件内部动力学验收，不代表Tesla真实车辆标定',
  physics:{status:'passed',fixedStepHz:120,total:results.length,checks:results},
  independentRotationCheck:rotationReport,
  browserVisualQA:{status:'not_performed',modelVersion:MODEL_VERSION,reason:'This version has numerical, geometric, static integration and offline shader checks; no current browser, GPU frame-time or visual acceptance has been performed.',historicalReports:['qa/browser.json','qa/city-3.4-browser-assets.json'],historyScope:'Retained older-version records are not evidence of current-version browser acceptance.'},
  realVehicleValidation:{status:'not_performed',reason:'OEM calibration and vehicle test data are not available'}
},null,2)+'\n');

