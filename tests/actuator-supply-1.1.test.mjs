import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RoadsterSim} from '../dist/physics.js';
import {nozzlePressureFactor} from '../dist/nozzle-supply.js';
import {hoverBudget} from '../dist/vehicle-models.js';
import {AUXILIARY_POWER_W} from '../dist/energy-model.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const DT=1/120,checks=[],close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const baselineCommit='88ddb11799403b5fffa78a86e7cece72085d207e';
// Keep the accepted 1.0 numerical implementation distinct. Nonchanged support
// modules are shared; no claim about full historical renderer execution.
const files=['physics.js','physics-kernel-319.js','energy-model.js','resource-wheels.js'];
const baselineDir=resolve('.runtime/actuator-supply-1.1-baseline');mkdirSync(baselineDir,{recursive:true});
const sourceHashes={};
for(const file of files){
  const source=execFileSync('git',['show',`${baselineCommit}:dist/${file}`],{encoding:'utf8'});
  sourceHashes[file]=createHash('sha256').update(source).digest('hex');
  const linked=source.replace(/from '\.\/([^']+)'/g,(_m,name)=>`from '${files.includes(name)?'./'+name:pathToFileURL(resolve('dist',name)).href}'`);
  writeFileSync(resolve(baselineDir,file),linked);
}
const {RoadsterSim:Before}=await import(pathToFileURL(resolve(baselineDir,'physics.js')).href);
function atPressure(Type,ambientPressureBar,pressureBar,{regulatorBar=50,supplyMode='finite'}={}){
  const s=new Type({ambientPressureBar,regulatorBar,supplyMode,initialPressureBar:20});s.reset('hover');
  s.gasMass=pressureBar*1e5*(s.params.tankLitres/1000)/(287.05*s.gasTemperature);s._updateMass(true);
  return s;
}

for(const ambient of [.6,1,2,5])for(const delta of [-.1,0,1,20,70]){
  const s=atPressure(RoadsterSim,ambient,ambient+delta),before=s.exportState(),authority=s.getControlAuthority();
  const factor=nozzlePressureFactor(s.pressureBar(),s.params.regulatorBar,ambient);
  close(authority.liftMaxN,4*s.params.liftNozzleMax*factor);
  close(s._availableLiftForce(),authority.liftMaxN);
  const t=s.advanceFixed({frontJets:1,rearJets:1},DT);
  assert.equal(t.fault,null);close(t.energyAccounting.balanceErrorJ,0,.02);
  for(const n of t.nozzles.filter(n=>n.kind==='lift'))close(n.maxForce,s.params.liftNozzleMax*factor);
  assert.ok(t.thrustN<=authority.liftMaxN+1e-9);
  if(delta<=0){
    close(t.thrustN,0);close(t.massFlowKgS,0);close(t.onboardGasConsumedKg,0);
    close(s.gasMass,before.state.gasMass);assert.equal(hoverBudget(s.params,s.gasMass,s.gasTemperature).seconds,0);
  }else{
    assert.ok(t.thrustN>0&&t.onboardGasConsumedKg>0);
    close(before.state.gasMass-s.gasMass,t.onboardGasConsumedKg,1e-10);
    close(t.massFlowKgS*DT,t.onboardGasConsumedKg,1e-10);
  }
  checks.push({name:'ambient-relative-nozzle-supply',ambientBar:ambient,initialPressureBar:ambient+delta,availableLiftN:authority.liftMaxN,thrustN:t.thrustN,gasConsumedKg:t.onboardGasConsumedKg});
}
// A regulator set at/below the ambient cannot deliver a positive chamber
// pressure difference; all estimates and actual valves must fail closed.
for(const regulatorBar of [2,5]){
  const s=atPressure(RoadsterSim,5,20,{regulatorBar}),t=s.advanceFixed({frontJets:1,rearJets:1},DT);
  close(t.thrustN,0);close(s.getControlAuthority().liftMaxN,0);close(s._availableLiftForce(),0);
  assert.equal(hoverBudget(s.params,s.gasMass,s.gasTemperature).seconds,0);
  assert.equal(t.fault,null);checks.push({name:'regulator-cannot-exceed-ambient',regulatorBar,thrustN:t.thrustN});
}
const oldZero=atPressure(Before,2,2),oldMass=oldZero.gasMass,oldZeroResult=oldZero.advanceFixed({frontJets:1,rearJets:1},DT);
assert.ok(oldZeroResult.thrustN>0&&oldZeroResult.onboardGasConsumedKg>oldMass*.99,'Fixture must reproduce the actual 1.0 defect');
checks.push({name:'verified-1.0-zero-pressure-counterexample',availableLiftN:0,thrustN:oldZeroResult.thrustN,gasConsumedKg:oldZeroResult.onboardGasConsumedKg,initialGasMassKg:oldMass});

// Resource budgeting is exercised through ordinary solved steps, not by
// directly calling the wing display or the thrust allocator.
for(const supplyMode of ['finite','bench'])for(const initialJ of [0,1,AUXILIARY_POWER_W*DT+1,80]){
  const s=new RoadsterSim({supplyMode,regenEnabled:false});s.reset('hover');s.prepareEnergy(initialJ/3.6e6);
  s.suctionEnabled=true;s.setWing({mode:'fixed',deployment:1});
  const t=s.advanceFixed({frontJets:1,rearJets:1},DT);
  close(t.energyAccounting.balanceErrorJ,0,.02);assert.equal(t.fault,null);
  if(initialJ<AUXILIARY_POWER_W*DT){
    assert.equal(s._hasPower,false);close(t.thrustN,0);close(t.suctionN,0);close(t.wing.deployment,0);
    close(t.onboardGasConsumedKg+t.externalGasSuppliedKg,0);close(t.energyAccounting.auxiliaryJ,initialJ,.00001);
    close(t.energyAccounting.remainingJ,0,.00001);
  }else{assert.ok(t.thrustN>0);assert.ok(t.wing.deployment>0);}
  for(let i=0;i<120;i++){const now=s.advanceFixed({frontJets:1,rearJets:1},DT);close(now.energyAccounting.balanceErrorJ,0,.02);assert.equal(now.fault,null);}
  const exhausted=s.telemetry(),frozen=exhausted.wing.deployment,gas=exhausted.onboardGasConsumedKg+exhausted.externalGasSuppliedKg;
  s.setWing({mode:'fixed',deployment:frozen>.01?0:1});
  for(let i=0;i<60;i++)s.advanceFixed({frontJets:1,rearJets:1},DT);
  const final=s.telemetry();close(final.wing.deployment,frozen);close(final.thrustN,0);close(final.onboardGasConsumedKg+final.externalGasSuppliedKg,gas);
  close(final.energyAccounting.grossJ,initialJ,.00001);close(final.energyAccounting.remainingJ,0,.00001);
  const snapshot=s.exportState(),copy=new RoadsterSim();copy.importState(snapshot);
  for(let i=0;i<30;i++){s.advanceFixed({},DT);copy.advanceFixed({},DT);}
  assert.deepEqual(s.exportState(),copy.exportState(),'Exhausted actuator state must continue exactly after restore');
  checks.push({name:'shared-control-supply-and-exhaustion',supplyMode,initialJ,firstThrustN:t.thrustN,firstWing:t.wing.deployment,finalWing:final.wing.deployment,deliveredJ:final.energyAccounting.grossJ,unservedAuxiliaryJ:final.energyAccounting.unservedAuxiliaryJ,exactContinuation:true});
}
const unpowered=new Before();unpowered.reset('hover');unpowered.prepareEnergy(0);unpowered.setWing({mode:'fixed',deployment:1});
for(let i=0;i<60;i++)unpowered.advanceFixed({},DT);
assert.ok(unpowered.telemetry().wing.deployment>.74);
checks.push({name:'verified-1.0-unpowered-wing-counterexample',deployment:unpowered.telemetry().wing.deployment,auxiliaryJ:unpowered.telemetry().energyAccounting.auxiliaryJ});

// Check unchanged operating conditions against the accepted baseline through
// full solver state, including contact, wheels, resources and controller state.
for(const [scenario,params]of [['free',{}],['hover',{supplyMode:'finite'}],['free',{roadSurface:'wet'}]]){
  const current=new RoadsterSim(params),old=new Before(params);current.reset(scenario);old.reset(scenario);
  for(let i=0;i<240;i++){
    const input=scenario==='hover'?{lift:i<60?.4:0,pitch:i>=120&&i<180?.15:0}:{throttle:i<100?.35:0,steer:i>=60&&i<120?.2:0,brake:i>=130?.35:0};
    const now=current.advanceFixed(input,DT),prior=old.advanceFixed(input,DT);
    for(const key of ['position','quaternion','velocity','angularVelocity','wing','energyAccounting','gasMass','thrustN','wheelStates','reference'])
      assert.deepEqual(now[key],prior[key],`Default ambient ${key} diverged at ${scenario}/${i}`);
  }
  assert.deepEqual(current.exportState(),old.exportState(),'Default operating terminal state must remain unchanged');
  checks.push({name:'unchanged-default-operating-state',scenario,params,physicalSteps:240,exactFullState:true});
}
const sources=['dist/nozzle-supply.js','dist/physics-kernel-319.js','dist/physics.js','dist/resource-wheels.js','dist/energy-model.js','dist/vehicle-models.js'];
mkdirSync(`qa/physics-${REPORT_VERSION}`,{recursive:true});
writeFileSync(`qa/physics-${REPORT_VERSION}/actuator-supply.json`,JSON.stringify({status:'passed',modelBuildId:MODEL_BUILD_ID,baselineCommit,baselineSourceHashes:sourceHashes,sourceHashes:Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),checks,scope:'Real numerical solver with declared initial gas/energy fixtures. Unified ambient pressure map; conservative control brownout within one integration slice. Auxiliary power remains a lumped engineering load, not identified OEM electrical circuits. No native/GPU or whole-world energy certificate.'},null,2)+'\n');
console.log(`PASS actuator supply: ${checks.length} checks`);
