import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync}from'node:fs';
import {createHash}from'node:crypto';
import {RoadsterSim,DEFAULT_PARAMS}from'../dist/physics.js';
import {nozzleExhaustVelocity}from'../dist/vehicle-models.js';
import {runExperiment}from'../dist/experiment-worker.js';
const dt=1/120,checks=[],values={};const pass=s=>{checks.push(s);console.log('PASS: '+s);};
// Historical 0.9 g / 1.5 m/s input fixture; unchanged assertions, new defaults tested separately.
const flat=(params={})=>{const s=new RoadsterSim({supplyMode:'finite',steeringAccelG:.9,climbRateMps:1.5,...params});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.body.position.set(0,.62,-350);for(let k=0;k<240;k++)s.step(dt);return s;};
values.turns=[];
for(const speed of[60,100,160]){const s=flat();s.body.velocity.z=speed/3.6;s.wheelStates.forEach(w=>w.angularVelocityRadS=s.body.velocity.z/s.params.wheelRadius);let beta=0,steer=0;for(let k=0;k<42;k++){const t=s.step(dt,{steer:1});beta=Math.max(beta,Math.abs(t.bodySlipDeg));steer=Math.max(steer,Math.abs(t.steeringCentreDeg));assert.ok(t.wheelStates.every(w=>w.gripUse<=1+1e-10));}for(let k=0;k<360;k++)s.step(dt);assert.ok(beta<1&&Math.abs(s.telemetry().bodySlipDeg)<.05);values.turns.push({speedKmh:speed,peakBetaDeg:beta,peakSteerDeg:steer,settledBetaDeg:s.telemetry().bodySlipDeg});}
pass('60–160 km/h brief keyboard turns remain below one degree sideslip and settle without resetting pose or velocity');
{
 const a=flat({steeringAssist:false});a.body.velocity.z=15;a.wheelStates.forEach(w=>w.angularVelocityRadS=15/a.params.wheelRadius);for(let k=0;k<40;k++)a.step(dt,{steer:.5});const w=a.telemetry().wheelStates;assert.ok(w[1].steer>w[0].steer&&w[0].steer>0);assert.ok(a.body.position.x>0);
 const b=flat({steeringAssist:false,tractionAssist:false});b.body.velocity.z=100/3.6;b.wheelStates.forEach(w=>w.angularVelocityRadS=b.body.velocity.z/b.params.wheelRadius);let slip=0;for(let k=0;k<120;k++){const t=b.step(dt,{steer:.7,throttle:.5});slip=Math.max(slip,Math.abs(t.bodySlipDeg));assert.ok(t.wheelStates.every(w=>Math.hypot(w.lateralForceN,w.longitudinalForceN)<=b.params.tireMu*w.normalLoadN+1e-7));}assert.ok(slip>3);values.rawSteerPeakBetaDeg=slip;
}
pass('Ackermann inner and outer angles differ; disabling assistance permits real saturation while every combined tire force remains friction-bounded');
{
 // Direct speed reference intentionally removes the former altitude-target lag.
 // Height cannot exceed initial height plus the configured speed over one second.
 const assisted=flat(),raw=flat(),initialHeight=assisted.body.position.y;raw.setMode('manual');for(let k=0;k<120;k++){assisted.step(dt,{lift:1});raw.step(dt,{lift:1});}const a=assisted.telemetry(),b=raw.telemetry();assert.equal(a.mode,'hover');assert.ok(a.verticalSpeed<1.6&&a.heightWorld<=initialHeight+assisted.params.climbRateMps*1);assert.ok(b.verticalSpeed>20&&b.heightWorld>10);values.eKey={assisted:{height:a.heightWorld,vertical:a.verticalSpeed},raw:{height:b.heightWorld,vertical:b.verticalSpeed}};
 for(let k=0;k<90;k++)assisted.step(dt);assert.ok(Math.abs(assisted.body.velocity.y)<.3);
}
pass('Normal E enters a bounded climb-rate controller, release brakes the rise; the separate raw research API retains full physical thrust');
{
 const s=flat(),before=s.gasMass;s.body.position.y=5;s.setMode('hover');let used=0,impulse=0,ve0;for(let k=0;k<240;k++){const t=s.step(dt);used+=t.massFlowKgS*dt;impulse+=t.thrustN*dt;ve0??=t.effectiveExhaustVelocity;const ideal=Math.sqrt(2*s.params.gasGamma/(s.params.gasGamma-1)*287.05*t.gasTemperatureK);assert.ok(t.effectiveExhaustVelocity<ideal*1.02);}
 assert.ok(Math.abs(before-s.gasMass-used)<1e-8);assert.ok(Math.abs(s.telemetry().deliveredImpulseNs-impulse)<1e-6);assert.ok(s.telemetry().effectiveExhaustVelocity<ve0);assert.equal(nozzleExhaustVelocity({...s.params,nozzleModel:'constant'},50,100),650);values.exhaust={initial:ve0,cooled:s.telemetry().effectiveExhaustVelocity,usedKg:used,initialHoverSeconds:flat().telemetry().hoverSecondsEstimate};
}
pass('Temperature-pressure exhaust stays below the ideal energy limit, cools, and conserves actual mass flow and delivered impulse');
{
 // Other historical tests keep flat()'s original input settings. Roll acceptance
 // exercises the current default response explicitly, with declared bench supply.
 const rollFixture=(scenario,supplyMode,tankLitres)=>{const s=flat({supplyMode,tankLitres,climbRateMps:DEFAULT_PARAMS.climbRateMps,steeringAccelG:DEFAULT_PARAMS.steeringAccelG});s.reset(scenario);return s;};
 const physicalState=s=>{const state=s.exportState();delete state.state.status;return state;};
 const pose=s=>({position:{...s.body.position},quaternion:{...s.body.quaternion},velocity:{...s.body.velocity},angularVelocity:{...s.body.angularVelocity},mode:s.mode,gasMassKg:s.gasMass});
 values.rolls=[];values.rollPrechecks=[];
 for(const scenario of ['free','hover']){
  const tankLitres=600,s=rollFixture(scenario,'bench',tankLitres),origin=s.body.position.y,initialGas=s.gasMass;
  assert.equal(s.startManeuver('roll'),true);const plan=s.getReference().maneuver;
  // The planned launch and rotation precede a return from the predicted peak.
  // Budget a 4 m/s descent plus four seconds of braking/settling, instead of an
  // unrelated 12-second cutoff. Success criteria below are unchanged.
  const returnCruiseMps=4,convergenceBudgetS=4,returnTravelS=(plan.plannedPeakHeight-origin)/returnCruiseMps;
  const limitS=plan.launchTime+plan.duration+returnTravelS+convergenceBudgetS;
  let inverted=false,touch=null,air=false,maxHeight=origin;
  for(let k=0;k<Math.ceil(limitS/dt);k++){
   const t=s.step(dt);inverted ||= s.body.quaternion.vmult({x:0,y:1,z:0}).y<-.9;
   maxHeight=Math.max(maxHeight,t.heightWorld);
   if(!t.contactCount)air=true;
   if(k>180&&air&&t.contactCount&&!touch)touch={time:t.simTime,speed:Math.abs(t.verticalSpeed),gas:t.gasMass};
   assert.equal(s.world.contacts.filter(c=>c.bi===s.body||c.bj===s.body).length,0);
   if(scenario==='hover')assert.equal(t.contactCount,0,'Air-origin roll must not land and re-launch');
   if(!t.maneuver)break;
  }
  assert.ok(inverted);assert.equal(s.telemetry().maneuver,null);
  if(scenario==='free'){assert.ok(touch&&touch.speed<.65&&touch.gas>10);assert.equal(s.mode,'drive');}
  else{assert.equal(touch,null);assert.equal(s.mode,'hover');assert.ok(Math.abs(s.body.position.y-origin)<.1);}
  assert.equal(s.gasMass,initialGas);assert.equal(s.telemetry().onboardGasConsumedKg,0);assert.ok(s.telemetry().externalGasSuppliedKg>0);
  values.rolls.push({scenario,supplyMode:s.params.supplyMode,tankLitres,originHeightM:origin,finalHeightM:s.body.position.y,durationS:s.simTime,maxHeightM:maxHeight,touchdown:touch,gasRemaining:s.gasMass,onboardGasUsedKg:initialGas-s.gasMass,externalGasSuppliedKg:s.telemetry().externalGasSuppliedKg,window:{limitS,launchS:plan.launchTime,rotationS:plan.duration,returnTravelS,returnCruiseMps,convergenceBudgetS},response:{climbRateMps:s.params.climbRateMps,rollRateDegS:s.params.rollRateDegS,angularAccelerationDegS2:s.params.angularAccelerationDegS2}});
 }
 pass('Default bench 600 L ground rolls land softly and airborne rolls recover their original height without hull impacts; external gas throughput is not onboard depletion');
 for(const [scenario,tankLitres]of [['free',900],['hover',1100]]){
  const s=rollFixture(scenario,'finite',tankLitres),planner=rollFixture(scenario,'bench',tankLitres);
  // The diagnostic bench plan changes only supply mode and is never stepped.
  // It exposes the same mass/inertia-dependent required impulse without
  // bypassing the finite simulation's actual preflight decision.
  assert.deepEqual({...s.params,supplyMode:'bench'},planner.params);assert.equal(s.body.mass,planner.body.mass);assert.deepEqual(s.body.inertia,planner.body.inertia);
  assert.equal(planner.startManeuver('roll'),true);const requiredImpulseNs=planner.getReference().maneuver.requiredImpulseNs,availableImpulseNs=s.telemetry().usableHoverImpulseNs;
  assert.ok(availableImpulseNs<requiredImpulseNs);
  const before=physicalState(s),beforePose=pose(s);assert.equal(s.startManeuver('roll'),false);assert.match(s.status,/剩余冲量不足/);
  assert.deepEqual(physicalState(s),before,'Rejected finite launch changes only its status explanation');
  values.rollPrechecks.push({scenario,supplyMode:'finite',tankLitres,initialPressureBar:s.pressureBar(),availableImpulseNs,requiredImpulseNs,marginNs:availableImpulseNs-requiredImpulseNs,reason:s.status,before:beforePose,after:pose(s),physicalStateUnchanged:true});
 }
 const blocked=new RoadsterSim();blocked.reset('ceiling');const blockedBefore=physicalState(blocked);assert.equal(blocked.startManeuver('roll'),false);assert.deepEqual(physicalState(blocked),blockedBefore);assert.match(blocked.status,/先回正/);
 const low=flat();low.gasMass*=.5;const lowBefore=physicalState(low);assert.equal(low.startManeuver('roll'),false);assert.deepEqual(physicalState(low),lowBefore);assert.equal(low.mode,'drive');assert.match(low.status,/剩余冲量不足/);
 values.additionalRollRejections={inverted:{reason:blocked.status,physicalStateUnchanged:true},halfRemainingGas:{reason:low.status,gasMassKg:low.gasMass,physicalStateUnchanged:true}};
}
pass('Finite 900 L ground and 1100 L airborne defaults are rejected by their measured impulse shortfalls; gas and attitude rejections preserve the full physical state');
{
 const a=runExperiment({kind:'steer',speedKmh:80,angleDeg:2}),b=runExperiment({kind:'steer',speedKmh:80,angleDeg:2});assert.deepEqual(a.metrics,b.metrics);assert.equal(a.rows.length,80);assert.equal(a.appliedParams.steeringAssist,false);assert.ok(a.metrics.maxBetaDeg<5);assert.ok(a.rows.every((r,i)=>Math.abs(r.time-(i+1)/20)<1e-8));assert.ok(a.assumptions.length>=3);
 const rise=runExperiment({kind:'rise',params:{climbRateMps:1.5}});assert.ok(rise.metrics.maxVerticalMps<1.7);values.experiments={steer:a.metrics,rise:rise.metrics};
}
pass('Independent research fixtures are deterministic, retain applied parameters and assumptions, and record uniform 20 Hz source data');
{
 const m=JSON.parse(readFileSync('dist/assets/music/manifest.json'));assert.equal(m.tracks.length,10);assert.equal(m.tracks.filter(t=>t.collection==='classical').length,3);assert.ok(m.tracks.some(t=>t.language==='zh')&&m.tracks.some(t=>!t.instrumental&&t.language==='en'));
 for(const t of m.tracks){const data=readFileSync('dist/'+t.src);assert.equal(data.length,t.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),t.sha256);assert.ok(['CC-BY-4.0','CC0-1.0'].includes(t.license)&&t.attribution&&t.licenseEvidenceUrl);}
}
pass('The local radio includes instrumental, English and Chinese recordings with explicit attribution licenses and matching asset hashes');
writeFileSync(`qa/research-dynamics-${REPORT_VERSION}.json`,JSON.stringify({status:'passed',checks,values,scope:'Internal engineering-model acceptance; not Tesla calibration'},null,2)+'\n');
