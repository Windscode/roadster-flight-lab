import {MODEL_VERSION} from '../dist/vehicle-models.js';
const release=MODEL_VERSION.split('.').slice(0,2).join('.'),reportDir=`qa/resource-${release}`;
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {regenerationAcceptance,RESOURCE_DEFAULTS} from '../dist/energy-model.js';
import {vehicleBrakeSignal} from '../dist/vehicle-light-state.js';
import {prepare,DT} from './route-driver-3.21.mjs';
import {ResourceMission,prepareResourceRoute,completeResourcePreparation} from '../dist/resource-mission.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const results=[];
function rolling(params={},energy=.12,speed=16.667,preset='dry-day'){
 const s=new RoadsterSim(params);prepare(s,preset);if(preset==='after-rain'){s.body.position.z=-290;s.body.previousPosition.copy(s.body.position);s.body.interpolatedPosition.copy(s.body.position);s.body.aabbNeedsUpdate=true;for(let k=0;k<60;k++)s.advanceFixed({brake:1},DT);}s.prepareEnergy(energy);s.body.velocity.set(0,0,speed);for(const w of s.wheelStates)w.angularVelocityRadS=speed/s.params.wheelRadius;return s;
}
function close(a,b,tol=.02){assert(Math.abs(a-b)<tol,`${a} != ${b}`);}
function checkAccounting(t){const e=t.energyAccounting,a=t.driveAccounting;assert(Math.abs(e.balanceErrorJ)<.02);close(e.regenMechanicalJ,e.recoveredJ+e.regenLossJ);close(e.motorElectricalJ,e.motorMechanicalJ+e.motorLossJ);assert(e.remainingJ>=0);assert(e.chargePowerW<=e.chargePowerLimitW+.01);assert(e.recoveredJ<=e.regenMechanicalJ+.01);close(e.brakeHeatJ,e.frictionBrakeJ+e.regenLossJ);assert(e.rollingLossJ>=0);if(Number.isFinite(a.rollingLossWorkJ))close(a.brakeMechanicalWorkJ,a.regenMechanicalWorkJ+a.frictionBrakeWorkJ+a.rollingLossWorkJ);}
for(const [name,params,energy,speed,preset]of [
 ['normal',{},.12,16.667,'dry-day'],['charge-cap',{chargePowerLimitW:8000},.12,16.667,'dry-day'],['disabled',{regenEnabled:false},.12,16.667,'dry-day'],['full-pack',{},200,16.667,'dry-day'],['SOC-taper',{},199,16.667,'dry-day'],['reverse',{},.12,-12,'dry-day'],['wet-ABS',{},.12,16.667,'after-rain'],['different-efficiency',{regenEfficiency:.5},.12,16.667,'dry-day']]){
 const s=rolling(params,energy,speed,preset);let maxCharge=0,absSteps=0,first=null;
 for(let k=0;k<240;k++){const t=s.advanceFixed({brake:.45},DT);first??=structuredClone(t);checkAccounting(t);assert.equal(t.fault,null);maxCharge=Math.max(maxCharge,t.energyAccounting.chargePowerW);absSteps+=Number(t.wheelStates.some(w=>w.absActive));}
 const t=s.telemetry(),e=t.energyAccounting;if(name==='wet-ABS'){assert(first.wheelStates.some(w=>w.surfaceMu<1));assert(absSteps>0);}assert(e.frictionBrakeJ>0);if(name==='disabled')assert.equal(e.recoveredJ,0);else if(name!=='full-pack')assert(e.recoveredJ>0);if(name==='full-pack')assert.equal(first.energyAccounting.recoveredJ,0);if(name==='charge-cap')assert(maxCharge<=8000+.01);if(name==='SOC-taper')assert(maxCharge<=60000*(1-199/200+1600/(200*3.6e6))/(1-.95)+.01);close(e.recoveredJ,e.regenMechanicalJ*s.params.regenEfficiency);
 results.push({name,maxChargeW:maxCharge,recoveredJ:e.recoveredJ,frictionBrakeJ:e.frictionBrakeJ,tyreHeatJ:e.tireDissipationJ,balanceErrorJ:e.balanceErrorJ,absSteps,finalSpeedKmh:t.speedKmh});
 const snap=s.exportState(),clone=new RoadsterSim();clone.importState(snap);for(let k=0;k<40;k++){s.advanceFixed({brake:.2},DT);clone.advanceFixed({brake:.2},DT);}assert.deepEqual(s.exportState(),clone.exportState());
 const beforeRejectedImport=clone.exportState(),bad=structuredClone(snap);bad.resourceAccounting.recoveredJ+=1;assert.throws(()=>clone.importState(bad));assert.deepEqual(clone.exportState(),beforeRejectedImport,'Rejected resource snapshot must not mutate the live car');
}
const airborne=new RoadsterSim();airborne.reset('hover');airborne.prepareEnergy(.1);for(const w of airborne.wheelStates)w.angularVelocityRadS=90;for(let k=0;k<30;k++){const t=airborne.advanceFixed({brake:1},DT);assert.equal(t.contactCount,0);assert.equal(t.energyAccounting.recoveredJ,0);checkAccounting(t);}
results.push({name:'airborne-spinning-wheels-no-regen',recoveredJ:airborne.telemetry().energyAccounting.recoveredJ});
const empty=rolling({},0,0);for(let k=0;k<120;k++)checkAccounting(empty.advanceFixed({throttle:1},DT));assert.equal(empty.telemetry().energyAccounting.motorElectricalJ,0);assert.equal(empty.telemetry().energyKWh,0);
const tiny=rolling({},.00001,0);for(let k=0;k<120;k++)checkAccounting(tiny.advanceFixed({throttle:1},DT));assert(tiny.telemetry().energyAccounting.grossJ<=36.001);results.push({name:'empty-and-exhausting-battery',grossJ:tiny.telemetry().energyAccounting.grossJ});
const zero=new RoadsterSim();prepare(zero);zero.prepareEnergy(.12);for(let k=0;k<120;k++)zero.advanceFixed({brake:1},DT);assert(zero.telemetry().energyAccounting.recoveredJ<.01);results.push({name:'stationary-brake-no-fictitious-work',recoveredJ:zero.telemetry().energyAccounting.recoveredJ});
const driven=new RoadsterSim();prepare(driven);driven.prepareEnergy(.12);for(let k=0;k<120;k++)checkAccounting(driven.advanceFixed({throttle:.4},DT));
const drivenEnergy=driven.telemetry().energyAccounting;assert(drivenEnergy.rollingLossJ>0);assert.equal(drivenEnergy.frictionBrakeJ,0);assert.equal(drivenEnergy.brakeHeatJ,0);assert.equal(drivenEnergy.recoveredJ,0);
results.push({name:'rolling-resistance-is-not-friction-brake-heat',rollingLossJ:drivenEnergy.rollingLossJ,frictionBrakeJ:drivenEnergy.frictionBrakeJ,brakeHeatJ:drivenEnergy.brakeHeatJ});
const mechanical=[];for(const regenEnabled of [true,false]){const s=rolling({regenEnabled});for(let k=0;k<480;k++)s.advanceFixed({brake:.4},DT);mechanical.push(s.telemetry());}
close(mechanical[0].position.z,mechanical[1].position.z,.00001);close(mechanical[0].speedKmh,mechanical[1].speedKmh,.00001);results.push({name:'friction-compensation-preserves-stop',distanceDifferenceM:mechanical[0].position.z-mechanical[1].position.z});
assert(vehicleBrakeSignal({brake:0,regenForceN:0,forwardSpeedKmh:30,longitudinalAcceleration:-1.2,driveAccounting:{totalRetardingForceN:2600}}));
// Cross the real safety boundary during a solved slice. The reset must return
// a fault instead of dereferencing the cleared slice, and the captured failed
// terminal state must contain its own settled ledger, not the prior tick's.
const boundary=new RoadsterSim();boundary.prepareEnergy(.12);
boundary.body.position.y=349.999;boundary.body.velocity.y=10;
const failed=boundary.advanceFixed({},DT);assert.equal(failed.failure.kind,'safety-domain');assert(failed.fault);checkAccounting(failed);
const terminal=failed.failure.triggerContinuationSnapshot;assert(terminal);assert(terminal.resourceAccounting.auxiliaryJ>0);
const restoredFailure=new RoadsterSim();restoredFailure.importState(terminal);checkAccounting(restoredFailure.telemetry());
assert.deepEqual(restoredFailure.exportState(),terminal,'Captured failure remains an exact continuation snapshot');
assert(restoredFailure.body.position.y>350);assert(failed.position.y<350,'Reset state is distinct from failure terminal state');
results.push({name:'in-step-safety-reset-and-terminal-ledger',kind:failed.failure.kind,terminalAuxiliaryJ:terminal.resourceAccounting.auxiliaryJ,balanceErrorJ:restoredFailure.telemetry().energyAccounting.balanceErrorJ});
// A pre-step failure has no completed energy slice to book or replay.
const invalid=new RoadsterSim();invalid.body.velocity.x=NaN;
const invalidResult=invalid.advanceFixed({},DT);assert.equal(invalidResult.failure.kind,'non-finite-state');checkAccounting(invalidResult);assert.equal(invalidResult.energyAccounting.seconds,0);
results.push({name:'pre-step-failure-no-phantom-energy',kind:invalidResult.failure.kind,bookedSeconds:invalidResult.energyAccounting.seconds});
for(const cause of ['refill','param','reset','timeout','supply']){const s=new RoadsterSim();prepareResourceRoute(s,true);prepare(s);completeResourcePreparation(s,true);const m=new ResourceMission(s,{descriptorHash:s.getRouteSurface().descriptorHash});if(cause==='refill'){s.advanceFixed({boost:true,throttle:.1},DT);m.check(s);s.refillGas();}if(cause==='param')s.setParam('tireMu',1.3);if(cause==='reset')s.reset('city');if(cause==='timeout')s.simTime+=66;if(cause==='supply')s.setSupplyMode('bench');assert(m.check(s),cause+' must fail');results.push({name:'mission-rejects-'+cause,reason:m.failure.reason,scope:cause==='timeout'?'labelled time-boundary fixture':'production mutation'});}
mkdirSync(reportDir,{recursive:true});writeFileSync(`${reportDir}/energy.json`,JSON.stringify({status:'passed',modelBuildId:MODEL_BUILD_ID,results,scope:'Actual solver steps and explicitly labelled boundary fixtures. No native/GPU/audio acceptance.'},null,2)+'\n');console.log(JSON.stringify({status:'passed',results}));
