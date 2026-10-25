import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {estimateLandingReserve} from '../dist/landing-reserve.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const cases=[],DT=1/120,close=(a,b,tolerance=.00001)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const baselineCommit='88ddb11799403b5fffa78a86e7cece72085d207e';
const source=execFileSync('git',['show',`${baselineCommit}:dist/landing-reserve.js`],{encoding:'utf8'});
mkdirSync('.runtime/landing-energy-1.1',{recursive:true});
const previousPath=resolve('.runtime/landing-energy-1.1/previous.mjs');
writeFileSync(previousPath,source.replace(/from '\.\/([^']+)'/g,(_m,name)=>`from '${pathToFileURL(resolve('dist',name)).href}'`));
const {estimateLandingReserve:before}=await import(pathToFileURL(previousPath).href);
function scenario(energyJ,{supplyMode='finite',fan=false,height=2}={}){
  const sim=new RoadsterSim({supplyMode});sim.reset('hover');sim.body.position.set(0,height,0);sim.prepareEnergy(energyJ/3.6e6);sim.suctionEnabled=fan;
  const clearance={distances:{down:{distanceM:height-.6,objectId:'ground'}}};return{sim,clearance};
}
function estimate(id,fixture){
  const {sim,clearance}=fixture,t=sim.telemetry(),snapshot=sim.exportState(),result=estimateLandingReserve(t,sim.params,clearance);
  assert.deepEqual(sim.exportState(),snapshot,'Advisory must not mutate body, controller or resources');
  assert.equal(result.protocol,'vertical-landing-reserve-2');assert.doesNotThrow(()=>JSON.stringify(result));
  cases.push({id,initialEnergyJ:t.energyKWh*3.6e6,supplyMode:t.supplyMode,fan:sim.suctionEnabled,result});return result;
}
for(const supplyMode of ['finite','bench']){
  const empty=scenario(1,{supplyMode}),old=before(empty.sim.telemetry(),empty.sim.params,empty.clearance);
  assert.equal(old.status,'estimated-reserve','A positive 1 J remainder must reproduce the old optimistic forecast');
  const now=estimate('only-one-joule-'+supplyMode,empty);
  assert.equal(now.status,'insufficient');assert.equal(now.landing.controlPowerLost,true);
  assert.equal(now.landing.status,'hard-contact-estimate');close(now.landing.electricalUsedJ,1);close(now.landing.electricalRemainingJ,0);
  close(now.landing.gasRequiredKg??now.landing.throughputKg,0);
  assert.ok(now.limitations.includes('electrical-supply-exhausted'));
  const actual=empty.sim.advanceFixed({frontJets:1,rearJets:1},DT);close(actual.thrustN,0);close(actual.energyAccounting.auxiliaryJ,1);
  cases.push({id:'1.0-counterexample-'+supplyMode,status:old.status,oldPredictedContactVerticalMps:old.landing.contactVerticalMps,actualFirstStepThrustN:actual.thrustN});
}
const powered=estimate('adequate-control-energy',scenario(10000));
assert.equal(powered.status,'estimated-reserve');assert.equal(powered.landing.controlPowerLost,false);
close(powered.landing.electricalUsedJ,powered.landing.timeS*800);
close(powered.landing.electricalUsedJ+powered.landing.electricalRemainingJ,10000);
assert.equal(powered.arrest.electricalUsedJ,0,'Already non-descending means no arrest maneuver is needed');

const loaded=estimate('same-energy-active-fan',scenario(10000,{fan:true}));
assert.equal(loaded.status,'insufficient');assert.equal(loaded.landing.controlPowerLost,true);
assert.equal(loaded.electrical.reservePowerW,26800,'Do not omit the existing 26 kW fan load');
assert.equal(loaded.electrical.fanReservePowerW,26000);
close(loaded.landing.electricalUsedJ+loaded.landing.electricalRemainingJ,10000);

const coast=scenario(100000,{supplyMode:'bench',fan:true,height:4});
for(let i=0;i<15;i++)coast.sim.advanceFixed({},DT);
coast.sim.suctionEnabled=false;
assert.ok(coast.sim.telemetry().electricalSupply.fanSpinFraction>.1);
const coasting=estimate('switched-off-fan-still-spinning',coast);
assert.equal(coasting.electrical.fanReservePowerW,26000,'Spin-down may still consume electricity after the switch is off');

const driving=scenario(10000,{supplyMode:'bench'});driving.sim.advanceFixed({throttle:.25},DT);
const excluded=estimate('active-drive-input',driving);
assert.equal(excluded.status,'unavailable');assert.ok(excluded.limitations.includes('wheel-drive-outside-estimate'));
assert.equal(excluded.landing.available,false);
const missing=scenario(10000),bad=missing.sim.telemetry();delete bad.energyKWh;
assert.equal(estimateLandingReserve(bad,missing.sim.params,missing.clearance).status,'unavailable','Unknown electric resource cannot be treated as infinite');

// The counterexample is not fixed by a more optimistic label: the initial
// electrical supply monotonically extends powered time under one same load.
let lastPoweredContact=null;
for(const energyJ of [1,100,400,800,1600,3200,6400,10000]){
  const result=estimate('energy-sweep-'+energyJ,scenario(energyJ,{supplyMode:'bench'}));
  assert.ok(result.landing.electricalUsedJ<=energyJ+.00001);
  if(!result.landing.controlPowerLost){
    assert.equal(result.status,'estimated-reserve');
    if(lastPoweredContact!==null)close(result.landing.contactVerticalMps,lastPoweredContact);
    lastPoweredContact=result.landing.contactVerticalMps;
  }
}
mkdirSync(`qa/physics-${REPORT_VERSION}`,{recursive:true});
writeFileSync(`qa/physics-${REPORT_VERSION}/landing-energy.json`,JSON.stringify({status:'passed',modelBuildId:MODEL_BUILD_ID,baselineCommit,baselineSourceSHA256:createHash('sha256').update(source).digest('hex'),sourceSHA256:createHash('sha256').update(readFileSync('dist/landing-reserve.js')).digest('hex'),cases,scope:'Read-only 1D landing advisory on actual solver states. Initial conditions are declared. Constant 800 W auxiliaries and full active/spinning fan rating reserve; active wheel drive is outside scope. Not a full 6DOF landing certificate, measured battery curve or native input test.'},null,2)+'\n');
console.log(`PASS landing electricity: ${cases.length} cases`);
