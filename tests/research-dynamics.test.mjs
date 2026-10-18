import assert from 'node:assert/strict';
import {readFileSync,writeFileSync}from'node:fs';
import {createHash}from'node:crypto';
import {RoadsterSim}from'../dist/physics.js';
import {nozzleExhaustVelocity}from'../dist/vehicle-models.js';
import {runExperiment}from'../dist/experiment-worker.js';
const dt=1/120,checks=[],values={};const pass=s=>{checks.push(s);console.log('PASS: '+s);};
const flat=(params={})=>{const s=new RoadsterSim(params);for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.body.position.set(0,.62,-350);for(let k=0;k<240;k++)s.step(dt);return s;};
values.turns=[];
for(const speed of[60,100,160]){const s=flat();s.body.velocity.z=speed/3.6;let beta=0,steer=0;for(let k=0;k<42;k++){const t=s.step(dt,{steer:1});beta=Math.max(beta,Math.abs(t.bodySlipDeg));steer=Math.max(steer,Math.abs(t.steeringCentreDeg));assert.ok(t.wheelStates.every(w=>w.gripUse<=1+1e-10));}for(let k=0;k<360;k++)s.step(dt);assert.ok(beta<1&&Math.abs(s.telemetry().bodySlipDeg)<.05);values.turns.push({speedKmh:speed,peakBetaDeg:beta,peakSteerDeg:steer,settledBetaDeg:s.telemetry().bodySlipDeg});}
pass('60–160 km/h brief keyboard turns remain below one degree sideslip and settle without resetting pose or velocity');
{
 const a=flat({steeringAssist:false});a.body.velocity.z=15;for(let k=0;k<40;k++)a.step(dt,{steer:.5});const w=a.telemetry().wheelStates;assert.ok(w[1].steer>w[0].steer&&w[0].steer>0);assert.ok(a.body.position.x>0);
 const b=flat({steeringAssist:false,tractionAssist:false});b.body.velocity.z=100/3.6;let slip=0;for(let k=0;k<120;k++){const t=b.step(dt,{steer:.7,throttle:.5});slip=Math.max(slip,Math.abs(t.bodySlipDeg));assert.ok(t.wheelStates.every(w=>Math.hypot(w.lateralForceN,w.longitudinalForceN)<=b.params.tireMu*w.normalLoadN+1e-7));}assert.ok(slip>3);values.rawSteerPeakBetaDeg=slip;
}
pass('Ackermann inner and outer angles differ; disabling assistance permits real saturation while every combined tire force remains friction-bounded');
{
 const assisted=flat(),raw=flat();raw.setMode('manual');for(let k=0;k<120;k++){assisted.step(dt,{lift:1});raw.step(dt,{lift:1});}const a=assisted.telemetry(),b=raw.telemetry();assert.equal(a.mode,'hover');assert.ok(a.verticalSpeed<1.6&&a.heightWorld<1.6);assert.ok(b.verticalSpeed>20&&b.heightWorld>10);values.eKey={assisted:{height:a.heightWorld,vertical:a.verticalSpeed},raw:{height:b.heightWorld,vertical:b.verticalSpeed}};
 for(let k=0;k<90;k++)assisted.step(dt);assert.ok(Math.abs(assisted.body.velocity.y)<.3);
}
pass('Normal E enters a bounded climb-rate controller, release brakes the rise; the separately labelled manual mode retains full physical thrust');
{
 const s=flat(),before=s.gasMass;s.body.position.y=5;s.setMode('hover');let used=0,impulse=0,ve0;for(let k=0;k<240;k++){const t=s.step(dt);used+=t.massFlowKgS*dt;impulse+=t.thrustN*dt;ve0??=t.effectiveExhaustVelocity;const ideal=Math.sqrt(2*s.params.gasGamma/(s.params.gasGamma-1)*287.05*t.gasTemperatureK);assert.ok(t.effectiveExhaustVelocity<ideal*1.02);}
 assert.ok(Math.abs(before-s.gasMass-used)<1e-8);assert.ok(Math.abs(s.telemetry().deliveredImpulseNs-impulse)<1e-6);assert.ok(s.telemetry().effectiveExhaustVelocity<ve0);assert.equal(nozzleExhaustVelocity({...s.params,nozzleModel:'constant'},50,100),650);values.exhaust={initial:ve0,cooled:s.telemetry().effectiveExhaustVelocity,usedKg:used,initialHoverSeconds:flat().telemetry().hoverSecondsEstimate};
}
pass('Temperature-pressure exhaust stays below the ideal energy limit, cools, and conserves actual mass flow and delivered impulse');
{
 values.rolls=[];for(const scenario of['free','hover']){const s=flat();s.reset(scenario);s.startManeuver('roll');let inverted=false,touch=null,air=false;for(let k=0;k<960;k++){const t=s.step(dt);inverted||=s.body.quaternion.vmult({x:0,y:1,z:0}).y<-.9;if(!t.contactCount)air=true;if(k>180&&air&&t.contactCount&&!touch)touch={time:t.simTime,speed:Math.abs(t.verticalSpeed),gas:t.gasMass};assert.equal(s.world.contacts.filter(c=>c.bi===s.body||c.bj===s.body).length,0);}assert.ok(inverted&&touch&&touch.speed<.65&&touch.gas>10);assert.equal(s.mode,'drive');values.rolls.push({scenario,...touch,gasRemaining:s.gasMass});}
 const blocked=new RoadsterSim();blocked.reset('ceiling');const mode=blocked.mode;assert.equal(blocked.startManeuver('roll'),false);assert.equal(blocked.mode,mode);const low=flat();low.gasMass*=.5;assert.equal(low.startManeuver('roll'),false);assert.equal(low.mode,'drive');
}
pass('Finite ground and airborne ballistic rolls land softly without hull impacts; gas and attitude prechecks reject infeasible launches without changing mode');
{
 const a=runExperiment({kind:'steer',speedKmh:80,angleDeg:2}),b=runExperiment({kind:'steer',speedKmh:80,angleDeg:2});assert.deepEqual(a.metrics,b.metrics);assert.equal(a.rows.length,80);assert.equal(a.appliedParams.steeringAssist,false);assert.ok(a.metrics.maxBetaDeg<5);assert.ok(a.rows.every((r,i)=>Math.abs(r.time-(i+1)/20)<1e-8));assert.ok(a.assumptions.length>=3);
 const rise=runExperiment({kind:'rise'});assert.ok(rise.metrics.maxVerticalMps<1.7);values.experiments={steer:a.metrics,rise:rise.metrics};
}
pass('Independent research fixtures are deterministic, retain applied parameters and assumptions, and record uniform 20 Hz source data');
{
 const m=JSON.parse(readFileSync('dist/assets/music/manifest.json'));assert.equal(m.tracks.length,10);assert.equal(m.tracks.filter(t=>t.collection==='classical').length,3);assert.ok(m.tracks.some(t=>t.language==='zh')&&m.tracks.some(t=>!t.instrumental&&t.language==='en'));
 for(const t of m.tracks){const data=readFileSync('dist/'+t.src);assert.equal(data.length,t.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),t.sha256);assert.ok(['CC-BY-4.0','CC0-1.0'].includes(t.license)&&t.attribution&&t.licenseEvidenceUrl);}
}
pass('The local radio includes instrumental, English and Chinese recordings with explicit attribution licenses and matching asset hashes');
writeFileSync('qa/research-dynamics-3.4.json',JSON.stringify({status:'passed',checks,values,scope:'Internal engineering-model acceptance; not Tesla calibration'},null,2)+'\n');
