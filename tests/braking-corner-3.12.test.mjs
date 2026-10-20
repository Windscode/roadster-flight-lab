import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim,DEFAULT_PARAMS} from '../dist/physics.js';
import * as CANNON from '../dist/vendor/cannon-es.js';
import {RoadsterSim as PreCrown} from './fixtures/physics-3.15-before/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {integrateWheel} from '../dist/tire-dynamics.js';
import {driverAxes} from '../dist/controls.js';
import {RoadsterSim as Before} from '../qa/fixtures/baseline-3.11/physics.js';
import {integrateWheel as beforeWheel} from '../qa/fixtures/baseline-3.11/tire-dynamics.js';
import {driverAxes as beforeAxes} from '../qa/fixtures/baseline-3.11/controls.js';
import {DT,DEG,flatDynamics} from './dynamics-fixtures-3.11.mjs';

const checks=[],evidence={},curves=[];
const check=(name,run)=>{const result=run();checks.push({name,status:'PASS'});console.log('PASS: '+name);return result;};
const close=(a,b,tolerance,label)=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} vs ${b} (tolerance ${tolerance})`);
const hash=path=>createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex');
const sum=(array,read)=>array.reduce((total,item)=>total+read(item),0);
const summarize=run=>{const {rows,...rest}=run;return rest;};
const wheelColumns=['loadN','alphaDeg','longSlip','grip','FxN','FyN','steerDeg','brakeRequestN','actualBrakeNm','regenRequestN','serviceRequestN','actualRegenNm','actualServiceNm','actualRollingNm','absPressure'];
const columns=['timeS','xM','zM','speedKmh','inputSteer','inputThrottle','inputBrake','wheelCentreDeg','yawRateDegS','bodyBetaDeg','contacts','rigidContacts',...['FR','FL','RR','RL'].flatMap(id=>wheelColumns.map(key=>id+'_'+key))];
const fixtureManifest=JSON.parse(readFileSync(new URL('../qa/fixtures/baseline-3.11/dynamics-manifest.json',import.meta.url)));
for(const [name,sha]of Object.entries(fixtureManifest.fixtureSha256))assert.equal(hash('qa/fixtures/baseline-3.11/'+name),sha,'Frozen 3.11 fixture provenance');

// One-change ablation: keep the frozen 3.11 brake switch, tire law and every
// other source mechanism. Only share each existing axle's service request by
// that axle's measured loads. The production module is never patched by tests.
const baselineUrl=new URL('../qa/fixtures/baseline-3.11/physics.js',import.meta.url);
const baselineText=readFileSync(baselineUrl,'utf8').replace(/from '([^']+)'/g,(_,path)=>`from '${new URL(path,baselineUrl).href}'`);
const oldShare='const serviceBrake=input.brake*p.brakeForce*(i<2?.30:.20);';
assert.equal(baselineText.split(oldShare).length,2,'Ablation target must occur exactly once');
const axleSource=baselineText.replace(oldShare,'const axleLoad=this.wheelStates.slice(i<2?0:2,i<2?2:4).reduce((sum,w)=>sum+w.normalLoadN,0);const serviceBrake=input.brake*p.brakeForce*(i<2?.6:.4)*w.normalLoadN/Math.max(1,axleLoad);');
const {RoadsterSim:AxleOnly}=await import('data:text/javascript;base64,'+Buffer.from(axleSource).toString('base64'));
const stages=[['published-3.11',Before],['axle-only-ablation',AxleOnly],['production-'+REPORT_VERSION,RoadsterSim]];

function rolling(Sim,speedKmh,params={}){
  const sim=flatDynamics(Sim,{params});
  // Declared one-time rolling state with matched wheel spin, followed by real
  // integration. This is not a claim of accelerating from rest on a city road.
  sim.body.velocity.set(0,0,speedKmh/3.6);
  sim.wheelStates.forEach(w=>w.angularVelocityRadS=speedKmh/3.6/sim.params.wheelRadius);
  return sim;
}
function runCorner(Sim,{speedKmh=90,surface='dry',steer=1,brake=.15,throttle=0,seconds=4,stopAtRest=false,settle=true}={}){
  const sim=rolling(Sim,speedKmh,{roadSurface:surface}),b=sim.body;
  if(settle)for(let k=0;k<120;k++)sim.advanceFixed({throttle:.02},DT);
  const start=sim.telemetry(),previous=b.position.clone(),startBrakeJ=start.brakeDissipationJ,rows=[],hasAttribution=Number.isFinite(sim._driveAccounting.brakeMechanicalWorkJ);
  const m={initialSpeedKmh:start.speedKmh,endSpeedKmh:null,peakBodySlipDeg:0,peakBodySlipAbove30KmhDeg:0,speedAtPeakBodySlipKmh:0,peakTireSlipDeg:0,peakLongitudinalSlip:0,peakYawRateDegS:0,peakWheelAngleDeg:0,peakGrip:0,saturatedAnyWheelSeconds:0,minimumLoadN:Infinity,maximumLoadN:0,minimumContacts:4,hullContactSteps:0,wheelStopContactSteps:0,pathLengthM:0,durationSeconds:0,stopTimeSeconds:null,maximumBrakeRequestN:0,minimumBrakeRequestN:Infinity,peakActualBrakeEquivalentN:0,minimumAbsPressure:1,brakeMechanicalWorkJ:0,liftOffBrakeMechanicalWorkJ:0,electricalRecoveredWorkJ:0};
  if(!hasAttribution)for(const key of ['brakeMechanicalWorkJ','liftOffBrakeMechanicalWorkJ','electricalRecoveredWorkJ'])m[key]=null;
  for(let k=0;k<Math.round(seconds/DT);k++){
    const t=sim.advanceFixed({steer,brake,throttle},DT),wheels=t.wheelStates;
    assert.equal(t.fault,null);
    const rigid=sim.world.contacts.filter(c=>c.bi===b||c.bj===b),hull=rigid.filter(c=>(c.bi===b?c.si:c.sj).material!==sim._wheelStopMaterial);
    m.endSpeedKmh=t.speedKmh;m.durationSeconds=(k+1)*DT;
    if(Math.abs(t.bodySlipDeg)>m.peakBodySlipDeg){m.peakBodySlipDeg=Math.abs(t.bodySlipDeg);m.speedAtPeakBodySlipKmh=t.speedKmh;}
    if(t.speedKmh>=30)m.peakBodySlipAbove30KmhDeg=Math.max(m.peakBodySlipAbove30KmhDeg,Math.abs(t.bodySlipDeg));
    m.peakTireSlipDeg=Math.max(m.peakTireSlipDeg,...wheels.map(w=>Math.abs(w.slipAngle)*DEG));
    m.peakLongitudinalSlip=Math.max(m.peakLongitudinalSlip,...wheels.map(w=>Math.abs(w.slipRatio||0)));
    m.peakYawRateDegS=Math.max(m.peakYawRateDegS,Math.abs(t.angularVelocity.y)*DEG);
    m.peakWheelAngleDeg=Math.max(m.peakWheelAngleDeg,Math.abs(t.steeringCentreDeg));
    m.peakGrip=Math.max(m.peakGrip,...wheels.map(w=>w.gripUse));
    m.saturatedAnyWheelSeconds+=Number(wheels.some(w=>w.gripUse>.99))*DT;
    m.minimumLoadN=Math.min(m.minimumLoadN,...wheels.map(w=>w.normalLoadN));m.maximumLoadN=Math.max(m.maximumLoadN,...wheels.map(w=>w.normalLoadN));
    m.minimumContacts=Math.min(m.minimumContacts,t.contactCount);
    m.hullContactSteps+=Number(hull.length>0);m.wheelStopContactSteps+=Number(rigid.length>hull.length);
    m.pathLengthM+=b.position.distanceTo(previous);previous.copy(b.position);
    const request=sum(wheels,w=>w.brakeDemandN);
    m.maximumBrakeRequestN=Math.max(m.maximumBrakeRequestN,request);m.minimumBrakeRequestN=Math.min(m.minimumBrakeRequestN,request);
    m.peakActualBrakeEquivalentN=Math.max(m.peakActualBrakeEquivalentN,sum(wheels,w=>w.brakeTorqueNm)/sim.params.wheelRadius);
    m.minimumAbsPressure=Math.min(m.minimumAbsPressure,...wheels.map(w=>w.absPressure));
    const a=sim._driveAccounting;
    if(hasAttribution){
      m.brakeMechanicalWorkJ+=a.brakeMechanicalWorkJ;m.liftOffBrakeMechanicalWorkJ+=a.liftOffBrakeMechanicalWorkJ;m.electricalRecoveredWorkJ+=a.electricalRecoveredWorkJ;
      for(const w of wheels)close(w.regenBrakeTorqueNm+w.serviceBrakeTorqueNm+w.rollingBrakeTorqueNm,w.brakeTorqueNm,1e-8,'Actual post-ABS torque partition on the complete maneuver');
    }
    if(k%6===0)rows.push([(k+1)*DT,t.position.x,t.position.z,t.speedKmh,steer,throttle,brake,t.steeringCentreDeg,t.angularVelocity.y*DEG,t.bodySlipDeg,t.contactCount,rigid.length,...wheels.flatMap(w=>[w.normalLoadN,w.slipAngle*DEG,w.slipRatio,w.gripUse,w.longitudinalForceN,w.lateralForceN,w.steer*DEG,w.brakeDemandN,w.brakeTorqueNm,w.regenBrakeDemandN??null,w.serviceBrakeDemandN??null,w.regenBrakeTorqueNm??null,w.serviceBrakeTorqueNm??null,w.rollingBrakeTorqueNm??null,w.absPressure])]);
    if(t.speedKmh<.36&&m.stopTimeSeconds===null){m.stopTimeSeconds=(k+1)*DT;if(stopAtRest)break;}
  }
  m.speedLossKmh=m.initialSpeedKmh-m.endSpeedKmh;m.totalPassiveMechanicalWorkJ=sim._brakeDissipationJ-startBrakeJ;
  return {configuration:{speedKmh,surface,steer,brake,throttle,seconds,stopAtRest,settle},metrics:m,rows};
}
function retain(stage,run){curves.push({stage,...run});return {stage,...summarize(run)};}

check('The service-brake/load-transfer cause is isolated before adding the continuous pedal handover',()=>{
  evidence.primary=[];
  for(const surface of ['dry','wet']){
    const results=stages.map(([stage,Sim])=>retain(stage,runCorner(Sim,{surface})));
    const [before,axle,after]=results.map(r=>r.metrics);
    assert.ok(before.peakBodySlipAbove30KmhDeg>20,'The published brake-in-turn failure must be reproduced');
    assert.ok(axle.peakBodySlipAbove30KmhDeg<3&&after.peakBodySlipAbove30KmhDeg<3,'Redistribution resolves this measured high-speed drift');
    assert.ok(after.peakLongitudinalSlip<.05&&after.saturatedAnyWheelSeconds===0);
    for(const r of results){close(r.metrics.minimumBrakeRequestN,6300,1e-7,'Unchanged 15% total service request');close(r.metrics.maximumBrakeRequestN,6300,1e-7,'Unchanged 15% total service request');assert.equal(r.metrics.minimumContacts,4);assert.equal(r.metrics.hullContactSteps+r.metrics.wheelStopContactSteps,0);assert.ok(r.metrics.peakGrip<=1+1e-9);}
    // Keep the original exact one-change claim on the actual frozen ray-support
    // solver. A continuous finite-radius contact patch changes the force lever
    // arm under roll/pitch; its production trajectory is not that ablation.
    // Every original production performance/budget limit above still applies.
    const isolatedPreCrown=retain('frozen-3.15-ray-support',runCorner(PreCrown,{surface}));
    for(const key of ['peakBodySlipAbove30KmhDeg','peakTireSlipDeg','peakLongitudinalSlip','endSpeedKmh','pathLengthM'])close(isolatedPreCrown.metrics[key],axle[key],1e-6,'Frozen ray-support production preserves the isolated axle-only result: '+key);
    evidence.primary.push({surface,results,isolatedPreCrown});
  }
});

check('Gentle inputs, opposite turns, straight full braking and split-friction limits are retained under actual wheel integration',()=>{
  evidence.gentle=[];evidence.stopping=[];evidence.split=[];
  for(const speedKmh of [54,90])for(const surface of ['dry','wet']){
    const runs=[['published-3.11',Before],['production-'+REPORT_VERSION,RoadsterSim]].map(([stage,Sim])=>retain(stage,runCorner(Sim,{speedKmh,surface,steer:.2})));
    for(const r of runs)assert.ok(r.metrics.peakBodySlipAbove30KmhDeg<2&&r.metrics.peakTireSlipDeg<3,'Gentle-turn cases were already stable and must stay so');
    assert.ok(runs[1].metrics.peakBodySlipAbove30KmhDeg<runs[0].metrics.peakBodySlipAbove30KmhDeg+.1);
    evidence.gentle.push({speedKmh,surface,results:runs});
  }
  for(const surface of ['dry','wet']){
    const mirror=retain('production-'+REPORT_VERSION,runCorner(RoadsterSim,{surface,steer:-1}));
    const positive=evidence.primary.find(r=>r.surface===surface).results.at(-1);
    close(mirror.metrics.peakBodySlipAbove30KmhDeg,positive.metrics.peakBodySlipAbove30KmhDeg,1e-6,'Mirror turn symmetry');
    evidence.gentle.push({surface,mirror});
    const results=[['published-3.11',Before],['production-'+REPORT_VERSION,RoadsterSim]].map(([stage,Sim])=>retain(stage,runCorner(Sim,{surface,steer:0,brake:1,seconds:6,stopAtRest:true})));
    const [before,after]=results.map(r=>r.metrics);assert.notEqual(after.stopTimeSeconds,null);
    const isolatedPreCrown=retain('frozen-3.15-ray-support',runCorner(PreCrown,{surface,steer:0,brake:1,seconds:6,stopAtRest:true}));
    close(isolatedPreCrown.metrics.pathLengthM,before.pathLengthM,1e-6,'The frozen ray-support 60/40 stopping trajectory is retained exactly');
    assert.ok(after.pathLengthM<=before.pathLengthM+1e-6,'The current finite-radius contact may not increase the historical stopping distance');
    close(after.minimumBrakeRequestN,42000,1e-7,'Current full service request retains the original 42 kN budget');
    close(after.maximumBrakeRequestN,42000,1e-7,'Current full service request may not exceed the original 42 kN budget');
    close(after.stopTimeSeconds,before.stopTimeSeconds,DT,'Straight stopping duration');
    assert.ok(after.minimumAbsPressure<.8,'Wet/dry full-brake regression must exercise ABS, not only easy cases');
    assert.equal(after.minimumContacts,4);assert.equal(after.hullContactSteps+after.wheelStopContactSteps,0);
    evidence.stopping.push({surface,results,isolatedPreCrown});
  }
  for(const steer of [0,1]){
    const results=[['published-3.11',Before],['production-'+REPORT_VERSION,RoadsterSim]].map(([stage,Sim])=>retain(stage,runCorner(Sim,{surface:'split',steer,brake:1,seconds:6,stopAtRest:true})));
    const after=results.at(-1).metrics;assert.notEqual(after.stopTimeSeconds,null);assert.ok(after.peakGrip<=1+1e-9);assert.equal(after.minimumContacts,4);
    evidence.split.push({steer,results});
  }
});

function brakeStep(Sim,brake,{speedKmh=54,throttle=0}={}){
  const sim=rolling(Sim,speedKmh),before=sim.body.velocity.z,t=sim.advanceFixed({brake,throttle},DT),w=t.wheelStates;
  return {brake,initialSpeedKmh:speedKmh,actualSpeedKmh:t.speedKmh,actualDecelerationMps2:(before-t.velocity.z)/DT,reportedBrakeDemandN:sum(w,w=>w.brakeDemandN),actualBrakeEquivalentN:sum(w,w=>w.brakeTorqueNm)/sim.params.wheelRadius,regenEquivalentN:t.regenForceN,regenRequestN:Number.isFinite(w[0].regenBrakeDemandN)?sum(w,w=>w.regenBrakeDemandN):null,serviceRequestN:Number.isFinite(w[0].serviceBrakeDemandN)?sum(w,w=>w.serviceBrakeDemandN):null};
}
check('Passing one percent brake no longer removes the lift-off force; a nondecreasing envelope stays inside 42 kN',()=>{
  const pedals=[0,.009,.01,.010001,.011,.02,.03,.061,.062,1];
  evidence.pedalHandover=stages.map(([stage,Sim])=>({stage,rows:pedals.map(pedal=>brakeStep(Sim,pedal))}));
  const before=evidence.pedalHandover[0].rows,after=evidence.pedalHandover[2].rows;
  assert.ok(before[2].actualBrakeEquivalentN-before[4].actualBrakeEquivalentN>2000,'Published .01 switch is really exercised');
  close(after[2].actualBrakeEquivalentN,after[4].actualBrakeEquivalentN,1e-6,'Additional light pedal does not remove total actual braking');
  close(after[2].actualDecelerationMps2,after[4].actualDecelerationMps2,.002,'Real first-step deceleration remains continuous');
  const lower=brakeStep(RoadsterSim,.01-1e-8),upper=brakeStep(RoadsterSim,.01+1e-8);
  assert.ok(Math.abs(lower.actualDecelerationMps2-upper.actualDecelerationMps2)<1e-7);
  let previous=0;
  // Reuse one settled chassis for independent isolated wheel-contact calls.
  // Restore matched spin at every sample; this sweep is a command law probe,
  // not a road trajectory or time history.
  const sim=rolling(RoadsterSim,54),b=sim.body,sweep=[];
  for(let k=0;k<=200;k++){
    const brake=k/200;b.force.setZero();b.torque.setZero();
    sim.wheelStates.forEach(w=>{w.angularVelocityRadS=15/sim.params.wheelRadius;w.absPressure=1;});
    sim._wheels(DT,{throttle:0,steer:0,brake});
    const request=sum(sim.wheelStates,w=>w.brakeDemandN);
    assert.ok(request>=previous-1e-8&&request<=DEFAULT_PARAMS.brakeForce+1e-8,'Total request is nondecreasing and capped');
    previous=request;if(k%5===0)sweep.push({brake,requestN:request,regenRequestN:sum(sim.wheelStates,w=>w.regenBrakeDemandN),serviceRequestN:sum(sim.wheelStates,w=>w.serviceBrakeDemandN)});
  }
  evidence.pedalEnvelope={formula:'B=max(R,S); E=R*(1-smoothstep(clamp(S/R))); service=B-E',lowPedalMeaning:'The first part of brake travel transfers existing lift-off deceleration to service brakes; it does not add a second brake pool.',sweep};
});

check('Contact loss cannot duplicate an axle budget and low-speed brake input cannot release parking hold',()=>{
  evidence.contactBudgets=[];
  for(const mask of [15,7,3,12,5,0])for(const brake of [.15,1]){
    const sim=rolling(RoadsterSim,54),ground=sim.world.bodies.find(body=>body.userData?.id==='ground');
    assert.ok(ground,'The isolated support fixture has a ground body');
    const floorY=ground.position.y+ground.shapes[0].halfExtents.y;
    const patches=sim.wheelStates.map(w=>({...w.contactPointWorld}));
    sim.world.removeBody(ground);
    // Real separated wheel-sized supports, not a stub of the obsolete ray path.
    // Missing patches cannot be reached by either tyre radius or half width.
    for(let i=0;i<4;i++)if(mask&(1<<i)){
      const support=new CANNON.Body({mass:0,position:new CANNON.Vec3(patches[i].x,floorY-.1,patches[i].z),shape:new CANNON.Box(new CANNON.Vec3(.3,.1,.55))});
      support.userData={id:'brake-mask-support-'+i};sim.world.addBody(support);
    }
    sim.body.force.setZero();sim.body.torque.setZero();sim._wheels(DT,{throttle:0,steer:0,brake});
    const w=sim.wheelStates,front=sum(w.slice(0,2),w=>w.brakeDemandN),rear=sum(w.slice(2),w=>w.brakeDemandN);
    assert.equal(w.reduce((value,wheel,i)=>value|(Number(wheel.contact)<<i),0),mask,'The real support geometry must produce the declared contact mask');
    close(front,brake*42000*.6,1e-8,'Front axle request');close(rear,brake*42000*.4,1e-8,'Rear axle request');
    assert.ok(sum(w,w=>w.brakeDemandN)<=42000+1e-8);
    for(const axle of [w.slice(0,2),w.slice(2)])if(axle.some(w=>w.contact))for(const wheel of axle)if(!wheel.contact)assert.equal(wheel.brakeDemandN,0,'No unused duplicate on an unloaded partner');
    evidence.contactBudgets.push({contactMaskFR_FL_RR_RL:mask,brake,frontRequestN:front,rearRequestN:rear,wheels:w.map(w=>({id:w.id,contact:w.contact,loadN:w.normalLoadN,requestN:w.brakeDemandN,actualBrakeNm:w.brakeTorqueNm}))});
  }
  evidence.parking=[];
  for(const [stage,Sim]of [['published-3.11',Before],['production-'+REPORT_VERSION,RoadsterSim]])for(const brake of [0,.009,.011,.2,1]){
    const sim=flatDynamics(Sim),start=sim.body.position.clone();let maxSpeed=0,maxRequest=0;
    for(let k=0;k<360;k++){
      // Explicit 1 kN longitudinal external disturbance on level ground. It
      // is applied as force before each step, never as a velocity correction.
      sim.body.force.z+=1000;const t=sim.advanceFixed({brake},DT);
      assert.equal(t.fault,null);maxSpeed=Math.max(maxSpeed,t.speedKmh);maxRequest=Math.max(maxRequest,sum(t.wheelStates,w=>w.brakeDemandN));
    }
    const distance=sim.body.position.distanceTo(start);
    if(Sim===RoadsterSim){assert.ok(distance<.04&&maxSpeed<.1,'Static-friction approximation retains a small compliant hold');assert.ok(maxRequest<=42000+1e-8);}
    evidence.parking.push({stage,brake,disturbanceN:1000,durationSeconds:3,displacementM:distance,peakSpeedKmh:maxSpeed,maxRequestN:maxRequest});
  }
  const old=evidence.parking.find(r=>r.stage==='published-3.11'&&r.brake===.011),fixed=evidence.parking.find(r=>r.stage==='production-'+REPORT_VERSION&&r.brake===.011);
  assert.ok(old.displacementM>fixed.displacementM*10,'The formerly released hold is reproduced under a physical disturbance');
});

check('Actual passive torque/work is separated after ABS and wheel stopping, without inventing battery recharge',()=>{
  evidence.workAttribution=[];
  for(const omega of [40,-40,.04]){
    const w={angularVelocityRadS:omega,rotation:0,absPressure:1,tcsFactor:1},inertia=2,initial=.5*inertia*omega*omega;
    const r=integrateWheel(w,{dt:DT,vlong:0,normalLoadN:0,mu:0,lateralForceN:0,driveTorqueNm:0,brakeTorqueNm:500,regenTorqueNm:200,rollingTorqueNm:50,radius:.37,inertia,effectiveMass:600,absEnabled:false,tcsEnabled:false});
    close(initial-w.wheelEnergyJ,r.brakeEnergyJ,1e-9,'Passive work equals free-wheel rotational energy loss');
    close(r.regenBrakeEnergyJ/r.brakeEnergyJ,200/550,1e-12,'Attributed fraction uses the applied passive impulse');
    close(w.regenBrakeTorqueNm+w.serviceBrakeTorqueNm+w.rollingBrakeTorqueNm,w.brakeTorqueNm,1e-10,'Actual torque partition');
    if(omega===.04)assert.ok(w.brakeTorqueNm<20,'A stopped wheel does not deliver its full command throughout the step');
    evidence.workAttribution.push({initialOmegaRadS:omega,finalOmegaRadS:w.angularVelocityRadS,mechanicalWorkJ:r.brakeEnergyJ,liftOffWorkJ:r.regenBrakeEnergyJ,actualTotalNm:w.brakeTorqueNm,actualLiftOffNm:w.regenBrakeTorqueNm,actualServiceNm:w.serviceBrakeTorqueNm,actualRollingNm:w.rollingBrakeTorqueNm});
  }
  // An already slipping wet tire invokes measured-slip ABS on this very
  // substep. Adding work attribution must leave the frozen tire solve intact.
  const initialWheel={angularVelocityRadS:5,rotation:0,absPressure:1,tcsFactor:1},oldWheel=structuredClone(initialWheel),newWheel=structuredClone(initialWheel);
  const args={dt:DT,vlong:15,normalLoadN:6000,mu:.65,lateralForceN:1400,driveTorqueNm:0,brakeTorqueNm:5000,regenTorqueNm:2000,rollingTorqueNm:50,radius:.37,inertia:2,effectiveMass:600,absEnabled:true,tcsEnabled:true};
  const oldResult=beforeWheel(oldWheel,args),newResult=integrateWheel(newWheel,args);
  assert.ok(newWheel.absActive&&newWheel.absPressure<.8,'Measured-slip ABS is actually exercised');
  for(const key of ['longitudinalForceN','lateralForceN','brakeEnergyJ','tireEnergyJ','driveWorkJ','spinMomentumChangeNms'])close(newResult[key],oldResult[key],0,'Attribution leaves the physical tire result unchanged: '+key);
  close(newWheel.regenBrakeTorqueNm+newWheel.serviceBrakeTorqueNm+newWheel.rollingBrakeTorqueNm,newWheel.brakeTorqueNm,1e-8,'ABS actual torque partition');
  assert.ok(newWheel.brakeTorqueNm<args.brakeTorqueNm&&newResult.regenBrakeEnergyJ>0&&newResult.regenBrakeEnergyJ<=newResult.brakeEnergyJ);
  evidence.postAbsAttribution={absPressure:newWheel.absPressure,actualBrakeNm:newWheel.brakeTorqueNm,actualLiftOffNm:newWheel.regenBrakeTorqueNm,actualServiceNm:newWheel.serviceBrakeTorqueNm,actualRollingNm:newWheel.rollingBrakeTorqueNm,oldPhysicalResultEqualsNew:true};
  const sim=rolling(RoadsterSim,54,{roadSurface:'wet'}),startEnergy=sim._energyUsed,startPassive=sim._brakeDissipationJ;
  let passiveJ=0,liftOffJ=0,recoveredJ=0;
  for(let k=0;k<240;k++){
    sim.advanceFixed({brake:.03},DT);const a=sim._driveAccounting;
    passiveJ+=a.brakeMechanicalWorkJ;liftOffJ+=a.liftOffBrakeMechanicalWorkJ;recoveredJ+=a.electricalRecoveredWorkJ;
    assert.ok(a.liftOffBrakeMechanicalWorkJ>=0&&a.liftOffBrakeMechanicalWorkJ<=a.brakeMechanicalWorkJ+1e-9);assert.equal(a.electricalRecoveredWorkJ,0);
    for(const w of sim.wheelStates)close(w.regenBrakeTorqueNm+w.serviceBrakeTorqueNm+w.rollingBrakeTorqueNm,w.brakeTorqueNm,1e-8,'Integrated post-ABS torque partition');
  }
  close(passiveJ,sim._brakeDissipationJ-startPassive,1e-7,'Per-step passive work agrees with the existing cumulative ledger');
  close((sim._energyUsed-startEnergy)*3.6e6,800*2,1e-7,'The existing 800 W auxiliary demand remains, without battery credit');
  assert.ok(passiveJ>10000&&liftOffJ>0);assert.equal(recoveredJ,0);
  evidence.energyLedger={durationSeconds:2,initialSpeedKmh:54,brake:.03,surface:'wet',passiveMechanicalWorkJ:passiveJ,equivalentLiftOffMechanicalWorkJ:liftOffJ,electricalRecoveredWorkJ:recoveredJ,batteryEnergySpentJ:(sim._energyUsed-startEnergy)*3.6e6,scope:'Mechanical work removed from wheel motion. No battery recuperation efficiency or battery recharge is implemented; nominal regenPower still bounds the existing speed-based force request, not a newly validated substep recuperator model.'};
});

check('Gamepad centre/edge/full-scale continuity and keyboard priority are exercised through the real input mapper',()=>{
  const read=(mapper,x,axis='steer',keys=new Set())=>mapper(keys,{connected:true,axes:[axis==='steer'?x:0,axis==='lift'?x:0,axis==='roll'?x:0],buttons:[]})[axis];
  evidence.gamepad=[];
  for(const axis of ['steer','roll','lift']){
    for(const x of [-1,-.7,-.130001,-.13,-.129999,0,.129999,.13,.130001,.7,1]){
      const before=read(beforeAxes,x,axis),after=read(driverAxes,x,axis);evidence.gamepad.push({axis,stick:x,before,after});
      assert.ok(Math.abs(after)<=1);close(after,-read(driverAxes,-x,axis),1e-12,'Symmetric gamepad axis');
      if(Math.abs(x)<=.13)assert.equal(Math.abs(after),0);
    }
    assert.ok(Math.abs(read(driverAxes,.130001,axis))<.000002);
    assert.ok(Math.abs(read(beforeAxes,.130001,axis))>.13);
    assert.equal(read(driverAxes,1,axis),-1);assert.equal(read(driverAxes,-1,axis),1);
  }
  assert.equal(read(driverAxes,-.7,'steer',new Set(['KeyD'])),-1);
  assert.equal(read(driverAxes,.7,'roll',new Set(['KeyZ'])),1);
  assert.equal(read(driverAxes,.7,'lift',new Set(['KeyE'])),1);
});

check('Blended braking snapshots replay exactly and reset clears the new brake diagnostics',()=>{
  const source=rolling(RoadsterSim,54,{roadSurface:'wet'});
  for(let k=0;k<120;k++)source.advanceFixed({throttle:0,brake:.025,steer:.3},DT);
  const snapshot=source.exportState(),replay=flatDynamics(RoadsterSim);replay.importState(snapshot);
  for(let k=0;k<180;k++){const input={steer:k<90?.3:-.2,brake:k<90?.011:.15};source.advanceFixed(input,DT);replay.advanceFixed(input,DT);}
  assert.deepEqual(replay.exportState(),source.exportState());
  source.reset();const t=source.telemetry();assert.equal(t.driveAccounting.brakeMechanicalWorkJ,0);assert.equal(t.driveAccounting.liftOffBrakeMechanicalWorkJ,0);assert.equal(t.driveAccounting.electricalRecoveredWorkJ,0);
  for(const w of t.wheelStates)for(const key of ['brakeDemandN','serviceBrakeDemandN','regenBrakeDemandN','brakeTorqueNm','serviceBrakeTorqueNm','regenBrakeTorqueNm','rollingBrakeTorqueNm'])assert.equal(w[key],0);
  evidence.replay={result:'exact full snapshot after 180 continued mixed-braking steps',modelVersion:MODEL_VERSION,resetDiagnostics:'zero'};
});

assert.equal(DEFAULT_PARAMS.tireMu,1.25);assert.equal(DEFAULT_PARAMS.motorPower,700000);assert.equal(DEFAULT_PARAMS.brakeForce,42000);assert.equal(DEFAULT_PARAMS.liftNozzleMax,20000);
const sourceSha256=Object.fromEntries(['dist/physics.js','dist/tire-dynamics.js','dist/vehicle-models.js','dist/controls.js','dist/driving-capture.js','dist/simulation-snapshot.js'].map(path=>[path,hash(path)]));
const common={modelVersion:MODEL_VERSION,solverHz:120,sourceSha256,baselinePublishedCommit:fixtureManifest.publishedCommit,scope:'Flat numerical fixtures and command-mapper tests. Same declared initial conditions and protocols within each comparison. No WebGL, GPU/FPS, keyboard/device latency, camera feel, city collision route or Tesla calibration acceptance.'};
writeFileSync(new URL(`../qa/braking-controls-curves-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({schema:'roadster.numerical-braking-curves',version:1,...common,sampleHz:20,columns,runs:curves})+'\n');
writeFileSync(new URL(`../qa/braking-controls-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({status:'passed',generatedAt:new Date().toISOString(),...common,checks,evidence,curveFile:`qa/braking-controls-curves-${REPORT_VERSION}.json`,limits:['The primary 15% braking/full mapped-steering case is a reproduced remaining nonlinear combined-demand fault; 20% steering was already stable.','Service allocation retains a fixed 60/40 axle split; it is a simplified within-axle load-aware distribution, not a calibrated OEM EBD/ESC.','Split-friction hard corner braking still produces a real slide; no yaw/velocity override or friction increase is used.','The low-speed hold remains a compliant tire/static-friction approximation with small creep, not a pose clamp.','Equivalent motor retardation removes mechanical energy; no electrical energy is returned to the battery.','The selected limits remain engineering assumptions: dry mu 1.25, 700 kW traction, 42 kN brake request and 20 kN per main nozzle.']},null,2)+'\n');
console.log(JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,checks:checks.length,curveRuns:curves.length,primary:evidence.primary.map(({surface,results})=>({surface,results:results.map(r=>({stage:r.stage,betaAbove30Deg:r.metrics.peakBodySlipAbove30KmhDeg,endSpeedKmh:r.metrics.endSpeedKmh}))}))}));
