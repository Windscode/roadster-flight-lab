import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {estimateLandingReserve,controlLimitFeedback} from '../dist/landing-reserve.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const cases=[],checks=[];
function run(id,{height=2,velocity=0,supplyMode='finite',mass,temperature=293.15,wind=false,fault=false,tilt=0,horizontal=0,surface=true}={}){
 const sim=new RoadsterSim({supplyMode});sim.reset('hover');sim.body.position.set(0,height,0);sim.body.velocity.set(horizontal,velocity,0);sim._contactCount=0;
 if(mass!==undefined){sim.gasMass=mass;sim.body.mass=sim.params.dryMass+mass;sim.body.updateMassProperties();}sim.gasTemperature=temperature;
 if(wind)sim.setWind({speedMps:8,directionDeg:90});if(fault)sim.setNozzleFault({id:'lift-FL',scale:0});if(tilt)sim.body.quaternion.setFromEuler(tilt,0,0);
 const telemetry=sim.telemetry(),before=sim.exportState();const clearance={distances:{down:{distanceM:surface?height-.6:null,objectId:surface?'ground':null}}};const estimate=estimateLandingReserve(telemetry,sim.params,clearance);
 assert.deepEqual(sim.exportState(),before,'advisory never mutates simulation');assert.doesNotThrow(()=>JSON.stringify(estimate));cases.push({id,input:{height,velocity,supplyMode,mass:telemetry.gasMass,pressure:telemetry.pressureBar,temperature,wind,fault,tilt,horizontal},estimate});return estimate;
}
const low=run('same-tank-low'),high=run('same-tank-high',{height:10}),fast=run('same-tank-fast-descent',{velocity:-12});
assert.equal(low.status,'estimated-reserve');assert.equal(high.status,'insufficient');assert.equal(fast.status,'insufficient');assert.equal(fast.hover.feasible,true);assert.equal(fast.arrest.possible,false);assert.equal(cases[0].input.mass,cases[1].input.mass);checks.push('Same actual remaining gas: low gentle descent, high descent and fast low descent produce different landing/arrest results; hover does not imply safe landing.');
const bench=run('bench-high',{height:10,supplyMode:'bench'});assert.equal(bench.landing.gasRemainingKg,null);assert.equal(bench.landing.enduranceS,null);assert.equal(bench.landing.gasRequiredKg,null);assert.ok(bench.landing.throughputKg>0);checks.push('Bench reports throughput, never finite remaining gas or endurance.');
const lowPressure=run('low-pressure',{mass:5});assert.equal(lowPressure.hover.feasible,false);assert.equal(lowPressure.status,'insufficient-support');assert.equal(lowPressure.arrest.possible,null);checks.push('Low-pressure failed trim does not produce an available landing estimate.');
const cold=run('same-mass-cold',{temperature:200});assert.ok(cold.landing.gasRequiredKg>low.landing.gasRequiredKg);checks.push('Temperature enters the existing nozzle/gas laws; same mass has greater predicted gas use when cold.');
const wind=run('wind',{wind:true});assert.equal(wind.status,'conditional-estimate');assert.ok(wind.limitations.includes('wind-not-forecast'));
const fault=run('front-left-disabled',{fault:true});assert.ok(fault.limitations.includes('fault-capacity-included-not-dynamic-recovery'));checks.push('Wind and nozzle-fault qualifications remain visible; static capacity is not dynamic-recovery certification.');
for(const [id,options]of [['tilted',{tilt:.4}],['horizontal',{horizontal:8}],['no-surface',{surface:false}]])assert.equal(run(id,options).status,'unavailable');checks.push('Tilt, fast lateral travel and missing lower surface make the advisory unavailable.');
const sim=new RoadsterSim();for(let i=0;i<120;i++)sim.advanceFixed({throttle:1});for(let i=0;i<30;i++)sim.advanceFixed({});const feedback=controlLimitFeedback(sim.telemetry());assert.ok(feedback.reasons.includes('lift-off-regeneration'));checks.push('Production default lift-off regeneration is identified from actual forces, not disabled in the default test.');
const report={schema:'roadster-landing-reserve-tests',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',checks,cases,defaultRegenFeedback:feedback,scope:'Actual-solver initial states plus bounded advisory forecast; not a 6-DOF landing success certificate or native HUD/GPU test.'};writeFileSync(new URL(`../qa/landing-reserve-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');for(const c of checks)console.log('PASS: '+c);
