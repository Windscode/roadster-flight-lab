import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {telemetryRow,TELEMETRY_COLUMNS} from '../dist/telemetry.js';
import {RoadsterSim,PHYSICS_HZ} from '../dist/physics.js';
const dt=1/PHYSICS_HZ;
const airborne=(roll=70,supplyMode='finite')=>{const s=new RoadsterSim({supplyMode});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.reset('free');s.body.position.set(0,32,-350);s.body.previousPosition.copy(s.body.position);s.body.quaternion.setFromEuler(.25,0,roll*Math.PI/180,'YXZ');s.body.angularVelocity.set(.4,-.1,.5);s.body.velocity.set(2,-1,1);s.setAirStabilization(true);return s;};
const results=[];
for(const angle of [25,70,135,175]){
 const s=airborne(angle,'bench'),gas=s.gasMass;let impulse=0,minY=32;
 for(let k=0;k<5*PHYSICS_HZ;k++){const t=s.step(dt,{});assert.equal(t.fault,null);assert.equal(t.contactCount,0);impulse+=t.thrustN*dt;minY=Math.min(minY,t.heightWorld);}
 const t=s.telemetry();assert.ok(Math.abs(t.rollDeg)<.08&&Math.abs(t.pitchDeg)<.08);assert.ok(s.body.angularVelocity.length()<.01);assert.ok(Math.abs(t.heightWorld-32)<.2);assert.ok(s.body.velocity.length()<.15);
 assert.ok(Math.abs(gas-s.gasMass)<1e-8);assert.equal(s.gasMass,gas);results.push({initialRoll:angle,finalRoll:t.rollDeg,finalPitch:t.pitchDeg,minY,finalY:t.heightWorld,gasUsed:gas-s.gasMass});
}
console.log('PASS: 25–175 degree disturbed attitudes recover on the explicit bench with real torque and ballistic height loss');
console.log(JSON.stringify(results));
{
 const s=airborne();for(let k=0;k<360;k++)s.step(dt);const before=s.body.position.y;s.setAirStabilization(false);for(let k=0;k<60;k++)s.step(dt);assert.ok(s.body.position.y<before-.7);assert.equal(s.telemetry().stabilizationActive,false);assert.ok(s.body.angularVelocity.length()<1);assert.ok(s.telemetry().thrustN<1);
}
console.log('PASS: Disabling stabilization releases the physical valves and restores gravity-driven free fall');
{
 const s=new RoadsterSim();s.reset('city');s.setAirStabilization(true);for(let k=0;k<360;k++)s.step(dt);assert.equal(s.telemetry().contactCount,4);assert.equal(s.telemetry().stabilizationActive,false);assert.equal(s.telemetry().thrustN,0);
 s.reset('ceiling');s.setAirStabilization(true);for(let k=0;k<120;k++)s.step(dt);assert.equal(s.telemetry().stabilizationActive,false);assert.ok(s.telemetry().suctionN>10000);
}
console.log('PASS: Armed assistance stays inactive on tires and during ceiling adhesion');
{
 for(const [frontJets,rearJets]of [[1,0],[0,1]]){const s=airborne(0);s.body.angularVelocity.setZero();for(let k=0;k<10;k++)s.step(dt);for(let k=0;k<12;k++)s.step(dt,{frontJets,rearJets});const t=s.telemetry();assert.equal(t.stabilizationActive,false);assert.ok(t.nozzles.slice(0,2).every(n=>frontJets?n.command>19000:n.command===0));assert.ok(t.nozzles.slice(2,4).every(n=>rearJets?n.command>19000:n.command===0));s.step(dt,{});assert.equal(s.telemetry().stabilizationActive,true);}
}
console.log('PASS: Manual front/rear jet pairs override stabilization and automatic recovery resumes on release');
{
 const dead=airborne();dead._energyUsed=dead.params.batteryKWh;for(let k=0;k<24;k++)dead.step(dt);assert.equal(dead.telemetry().thrustN,0);assert.ok(dead.body.position.y<31.7);
 const weak=airborne(0);weak.setParam('initialPressureBar',20);for(let k=0;k<120;k++){const t=weak.step(dt);assert.ok(t.nozzles.every(n=>n.command<=n.maxForce+1e-8));}assert.ok(weak.body.position.y<31);
}
console.log('PASS: Power loss and low tank pressure prevent unphysical stabilization or unlimited lift');

{
 const s=new RoadsterSim();s.reset('free');s.setAirStabilization(true);s.setMode('hover');for(let k=0;k<360;k++)s.step(dt);const t=s.telemetry();assert.ok(t.heightWorld>3.8&&t.heightWorld<4.2);assert.equal(t.stabilizationActive,true);const row=telemetryRow(t);assert.equal(row.length,TELEMETRY_COLUMNS.length);assert.deepEqual(['air_stabilization_armed','air_stabilization_active'].map(name=>row[TELEMETRY_COLUMNS.indexOf(name)]),[1,1]);
}
console.log('PASS: Armed ground takeoff retains the hover target and CSV records both assistance states');

{const s=airborne(25),initial=s.gasMass;let used=0;for(let i=0;i<240;i++){const t=s.step(dt);used+=t.massFlowKgS*dt;}const t=s.telemetry();assert.ok(Math.abs(initial-s.gasMass-used)<1e-8);assert.ok(Math.abs(t.rollDeg)<1&&Math.abs(t.pitchDeg)<1);assert.ok(s.gasMass<initial&&s.gasMass>50);}
console.log('PASS: Finite-tank recovery consumes temperature-dependent actual mass flow without hidden refill');
writeFileSync('qa/air-stabilization-3.9.json',JSON.stringify({status:'passed',durationSeconds:5,supplyMode:'bench',initialHeight:32,attitudeCases:results,finiteRecovery:{durationSeconds:2,initialRoll:25,massConservation:'actual nozzle mass flow',status:'passed'},checks:7,limits:'Known synthetic initial disturbances, not an arbitrary-envelope or OEM validation'},null,2)+'\n');
