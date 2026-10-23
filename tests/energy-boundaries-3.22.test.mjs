import assert from 'node:assert/strict';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {integrateWheel} from '../dist/tire-dynamics.js';
import {validateEnergyLedger} from '../dist/energy-model.js';
import {prepare,DT} from './route-driver-3.21.mjs';
import {ResourceMission,prepareResourceRoute,completeResourcePreparation} from '../dist/resource-mission.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const results=[];
const close=(a,b,tolerance=.02)=>assert(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
// Without contact or friction brakes, axle midpoint work exactly equals the
// rotational energy change. Brake overlap also exercises the existing stop /
// reverse discretization; its tiny crossing residual is explicitly bounded
// at 0.02 J rather than described as exact continuous friction dynamics.
for(const sign of [-1,1])for(const hz of [60,120,240])for(const brake of [0,15]){
  const inertia=1.7,w={angularVelocityRadS:sign*40,rotation:0};
  const before=.5*inertia*w.angularVelocityRadS**2;let positive=0,negative=0,passive=0;
  for(let k=0;k<hz;k++){
    const r=integrateWheel(w,{dt:1/hz,vlong:0,normalLoadN:0,mu:0,lateralForceN:0,driveTorqueNm:-sign*100,brakeTorqueNm:brake,radius:.37,inertia,effectiveMass:500,absEnabled:false,tcsEnabled:false,maxDrivePowerW:30000});
    positive+=r.driveWorkJ;negative+=r.motorBrakingWorkJ;passive+=r.brakeEnergyJ;
    if(brake===0)close(w.wheelEnergyJ-before,positive-negative-passive,1e-7);
    else close(w.wheelEnergyJ-before,positive-negative-passive,.02);
    assert.equal(r.regenBrakeEnergyJ,0,'Opposing drive torque is not automatically battery recovery');
  }
  assert(negative>0&&positive>0,'Reversal must expose braking followed by motoring');
  results.push({name:'isolated-wheel-reversal',sign,hz,brakeNm:brake,motorWorkJ:positive,motorBrakingWorkJ:negative,passiveBrakeWorkJ:passive,energyResidualToleranceJ:brake===0?1e-7:.02,energyResidualJ:w.wheelEnergyJ-before-positive+negative+passive});
}
for(const sign of [-1,1]){
  const s=new RoadsterSim();prepareResourceRoute(s,false);prepare(s);s.prepareEnergy(1);
  s.body.velocity.set(0,0,sign*15);for(const w of s.wheelStates)w.angularVelocityRadS=sign*15/s.params.wheelRadius;
  completeResourcePreparation(s,false);
  const mission=new ResourceMission(s,{descriptorHash:s.getRouteSurface().descriptorHash,finite:false});
  for(let k=0;k<120;k++){
    const t=s.advanceFixed({throttle:-sign*.5},DT);assert.equal(t.fault,null);close(t.energyAccounting.balanceErrorJ,0);
    assert.equal(t.energyAccounting.recoveredJ,0);assert.equal(t.energyAccounting.motorMechanicalJ,0);
    assert.equal(t.energyAccounting.motorLossJ,0,'Motoring conversion loss must remain distinct from counter-torque heat');
  }
  const t=s.telemetry();assert(t.speedKmh<54&&t.speedKmh>10);assert(t.energyAccounting.motorBrakingHeatJ>100000);
  const result=mission.result(s,'manual-stop');close(result.work.motorBrakingHeatJ,t.energyAccounting.motorBrakingHeatJ);
  const snapshot=s.exportState(),restored=new RoadsterSim();restored.importState(snapshot);
  for(let k=0;k<30;k++){s.advanceFixed({throttle:-sign*.5},DT);restored.advanceFixed({throttle:-sign*.5},DT);}
  assert.deepEqual(s.exportState(),restored.exportState(),'Counter-torque work survives exact continuation');
  const bad=structuredClone(s.exportState());bad.resourceAccounting.motorBrakingHeatJ=-1;
  assert.throws(()=>validateEnergyLedger(bad.resourceAccounting));assert.throws(()=>restored.importState(bad));assert.deepEqual(s.exportState(),restored.exportState(),'Invalid heat ledger is rejected before live mutation');
  results.push({name:'vehicle-counter-torque',direction:sign,finalSpeedKmh:t.speedKmh,motorBrakingHeatJ:t.energyAccounting.motorBrakingHeatJ,batteryRecoveredJ:t.energyAccounting.recoveredJ,balanceErrorJ:t.energyAccounting.balanceErrorJ,exactContinuation:true,routeSummaryPreserved:true});
}
// The accepted zero-pressure cap must disable suction without invalid forces.
// Keep the fan and ray contacts active so this exercises the former 0/0 path.
const adhesion=new RoadsterSim();prepare(adhesion);adhesion.suctionEnabled=true;adhesion.setParam('suctionPressurePa',0);
for(let k=0;k<120;k++){
  const t=adhesion.advanceFixed({brake:1},DT);assert.equal(t.fault,null);assert.equal(t.suctionN,0);assert.equal(t.sealQuality,0);close(t.energyAccounting.balanceErrorJ,0);
}
assert(adhesion.telemetry().sealLipContacts.some(Boolean),'Regression must exercise near-surface seal rays');
adhesion.setParam('suctionPressurePa',5000);
for(let k=0;k<120;k++){const t=adhesion.advanceFixed({brake:1},DT);assert.equal(t.fault,null);close(t.energyAccounting.balanceErrorJ,0);}
assert(adhesion.telemetry().suctionN>0,'A valid pressure cap must restore adhesion on the same physical trajectory');
results.push({name:'zero-pressure-and-restored-adhesion',physicalSteps:240,restoredSuctionN:adhesion.telemetry().suctionN,contactCount:adhesion.telemetry().contactCount});
mkdirSync(`qa/energy-${REPORT_VERSION}`,{recursive:true});
writeFileSync(`qa/energy-${REPORT_VERSION}/boundaries.json`,JSON.stringify({status:'passed',modelBuildId:MODEL_BUILD_ID,results,scope:'Numerical free-wheel work closure, opposite-throttle vehicle runs,complete-state continuation, route-summary preservation and active adhesion pressure boundary; no whole-world energy certificate or native-device acceptance.'},null,2)+'\n');
console.log(`PASS energy boundaries: ${results.length} cases`);
