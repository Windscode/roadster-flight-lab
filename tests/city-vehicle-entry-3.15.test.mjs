import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {RoadsterSim,DEFAULT_PARAMS} from '../dist/physics.js';
import {ExperimentRecorder,currentExperimentIdentity,contentLabel,validateExperimentRecord} from '../dist/experiment-records.js';
const beforePath='qa/city-entry-3.15-before.json',captureBefore=process.argv.includes('--capture-before');
if(captureBefore&&fs.existsSync(beforePath))throw Error('Original before evidence already exists; do not overwrite it');
const sim=new RoadsterSim({}, {world:'city'});sim.reset('free');
// Declared fixture initialisation only. Before and after use this identical
// stopped pose, default production parameters (including regen), and controls.
// No rigid-body assignment occurs after the initial 240 physical settling steps.
sim.body.position.set(100,.62,302.5);sim.body.quaternion.setFromEuler(0,Math.PI/2,0);sim.body.previousPosition.copy(sim.body.position);sim.body.interpolatedPosition.copy(sim.body.position);sim.body.previousQuaternion.copy(sim.body.quaternion);sim.body.interpolatedQuaternion.copy(sim.body.quaternion);sim.body.aabbNeedsUpdate=true;sim.setMode('drive');
for(let i=0;i<240;i++)sim.advanceFixed({brake:1});
const recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=> 'city'});recorder.start({name:'Foundry terrace vehicle entrance / 3 m/s / default regen',kind:'physical-road-fixture'});
const initial=sim.telemetry(),samples=[],encountered=new Set();let reachedAtS=null;
for(let step=0;step<120*15;step++){
 const t=sim.telemetry(),input=t.position.x<119?{throttle:Math.min(1,Math.max(0,(3-t.velocity.x)*.3))}:{brake:1};
 recorder.beforeStep(input);const next=sim.advanceFixed(input,1/120);recorder.afterStep(next,input,1/120);
 const contactObjects=[];for(const w of next.wheelStates)if(w.contact&&w.contactObjectId){encountered.add(w.contactObjectId);contactObjects.push(w.contactObjectId);}
 const hull=sim.world.contacts.filter(c=>(c.bi===sim.body||c.bj===sim.body)&&(c.bi===sim.body?c.si:c.sj)?.material!==sim._wheelStopMaterial).map(c=>(c.bi===sim.body?c.bj:c.bi).userData?.id??'unnamed');
 samples.push({step:step+1,timeS:(step+1)/120,position:next.position,velocity:next.velocity,speedKmh:next.speedKmh,rollDeg:next.rollDeg,pitchDeg:next.pitchDeg,contactCount:next.contactCount,contactObjects,hullContacts:hull,wheels:next.wheelStates.map(w=>({id:w.id,loadN:w.normalLoadN,travelM:w.suspensionLength,omegaRadS:w.angularVelocityRadS,longitudinalSlip:w.slipRatio,objectId:w.contactObjectId,point:w.contactPointWorld})),driveAccounting:next.driveAccounting,regenForceN:next.regenForceN??null});
 if(next.fault)throw Error(next.fault);if(next.position.x>=119&&reachedAtS===null)reachedAtS=(step+1)/120;if(reachedAtS!==null&&Math.hypot(next.velocity.x,next.velocity.z)<.05)break;
}
const record=recorder.finish('completed','fixture ended after passage/braking or declared 15 s limit');validateExperimentRecord(record);
const passage=samples.filter(s=>s.position.x>=105&&s.position.x<=116),heights=passage.flatMap(s=>s.wheels.filter(w=>w.point).map(w=>w.point.y));
const summary={reachedAtS,finalPosition:sim.telemetry().position,peakVerticalSpeedMps:Math.max(...passage.map(s=>Math.abs(s.velocity.y))),peakPitchDeg:Math.max(...passage.map(s=>Math.abs(s.pitchDeg))),peakWheelLoadN:Math.max(...passage.flatMap(s=>s.wheels.map(w=>w.loadN))),minimumContacts:Math.min(...passage.map(s=>s.contactCount)),maximumWheelSupportY:Math.max(...heights),minimumWheelSupportY:Math.min(...heights),encountered:[...encountered],hullContactSteps:samples.filter(s=>s.hullContacts.length).length,driveRegeneration:{regenForceN:sim.params.regenForce,regenPowerW:sim.params.regenPower},surfaceStepCriterion:{maximumM:.02,measuredM:Math.max(...heights)-Math.min(...heights),passed:Math.max(...heights)-Math.min(...heights)<=.02}};
const initialContract={params:sim.params,pose:{position:initial.position,velocity:initial.velocity,quaternion:initial.quaternion,angularVelocity:initial.angularVelocity},gasMass:initial.gasMass,gasTemperature:initial.gasTemperatureK,settlingSteps:240,control:'throttle=clamp((3-vx)*0.3,0,1) until x119; then brake=1',fixedHz:120};
const evidence={schema:'roadster-city-vehicle-entry-fixture',version:1,phase:captureBefore?'before':'after',identity:currentExperimentIdentity(),geometryIdentity:record.initialSnapshot.physical.geometrySignature,geometry:sim.getWorldGeometry().filter(g=>g.id.startsWith('plan-foundry-paving')),sourceHashes:Object.fromEntries(['dist/city-plan.js','dist/physics.js','dist/vehicle-models.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),initialContract,initialContractLabel:contentLabel(initialContract),summary,record,sampling:{statisticsHz:120,storedHz:120,allFixedSteps:samples.length},samples,limits:'Independent default-regen low-speed passage across the selected vehicle mouth. Does not validate all kerbs, wheel impacts, full-city driving, visual lighting or human handling.'};
assert.equal(sim.params.regenForce,DEFAULT_PARAMS.regenForce);assert.equal(sim.params.regenPower,DEFAULT_PARAMS.regenPower);
fs.mkdirSync('qa',{recursive:true});
if(captureBefore){assert(summary.encountered.includes('plan-foundry-paving-110.5'));assert.equal(summary.surfaceStepCriterion.passed,false);fs.writeFileSync(beforePath,JSON.stringify(evidence,null,2));console.log('Captured original raised crossing: '+JSON.stringify(summary));}
else{
 const before=JSON.parse(fs.readFileSync(beforePath));assert.deepEqual(initialContract,before.initialContract,'before/after initial state, default regen and control law must stay identical');assert.notEqual(evidence.geometryIdentity,before.geometryIdentity);assert.equal(before.summary.surfaceStepCriterion.passed,false);assert.equal(summary.surfaceStepCriterion.passed,true,'legal vehicle mouth must be level, not a 12 cm footway crossing');assert(summary.reachedAtS!==null);assert.equal(summary.hullContactSteps,0);assert(!summary.encountered.some(id=>id.startsWith('plan-foundry-paving-110.5')));assert(summary.peakVerticalSpeedMps<before.summary.peakVerticalSpeedMps);assert(summary.peakPitchDeg<before.summary.peakPitchDeg);
 fs.writeFileSync(`qa/city-entry-${REPORT_VERSION}-after.json`,JSON.stringify(evidence,null,2));fs.writeFileSync(`qa/city-entry-${REPORT_VERSION}-comparison.json`,JSON.stringify({schema:'roadster-city-vehicle-entry-comparison',version:1,identity:currentExperimentIdentity(),sameInitialContract:true,initialContractLabel:evidence.initialContractLabel,before:{geometryIdentity:before.geometryIdentity,sourceHashes:before.sourceHashes,summary:before.summary},after:{geometryIdentity:evidence.geometryIdentity,sourceHashes:evidence.sourceHashes,summary},change:'Split only the east foundry paving at the existing 8 m terrace-link carriageway mouth. Shared visual/collision boxes use the same opening; road topology, vehicle parameters, grip and initial fixture did not change.',originalFailurePreserved:true},null,2));console.log('city-vehicle-entry-3.15: passed; before/after '+JSON.stringify({before:before.summary,after:summary}));
}
