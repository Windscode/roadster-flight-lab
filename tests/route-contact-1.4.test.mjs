import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {ResourceMission,prepareResourceRoute,completeResourcePreparation} from '../dist/resource-mission.js';
import {prepare,DT} from './route-driver-3.21.mjs';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const trace=JSON.parse(readFileSync('qa/browser-1.4/turn-counterexample.json','utf8'));
function start(){
  const sim=new RoadsterSim();prepareResourceRoute(sim,false);
  const descriptor=prepare(sim);completeResourcePreparation(sim,false);
  return {sim,mission:new ResourceMission(sim,{descriptor,descriptorHash:sim.getRouteSurface().descriptorHash,finite:false})};
}
const {sim,mission}=start();
let t,steps=0;
for(const run of trace.appliedInputRuns)for(let i=0;i<run.steps;i++){
  t=sim.advanceFixed(run.input,DT);steps++;
  assert.equal(mission.check(sim,t),null,'Ordinary load transfer must leave the driving attempt active');
}
assert.equal(steps,trace.stepCount);
assert.equal(t.contactCount,4);assert.ok(t.rigidContactCount>0);
const ledger=t.integration.contactLedger;
assert.equal(ledger.hullEquations,0);assert.ok(ledger.wheelStopEquations>0);
assert.ok(ledger.pairs.some(p=>p.vehiclePart==='wheel-stop-FR'&&p.objectId==='ground'));
const error=Math.hypot(...['x','y','z'].map(axis=>t.position[axis]-trace.finalPosition[axis]));
assert.ok(error<1e-6,'Same recorded pedals and steering must give the original trajectory');

function impact(type){
  const {sim,mission}=start();
  if(type==='sidewall'){
    const p=sim.body.position;
    sim._addBox('wheel-side-check','barrier',[.12,.32,.8],[p.x-1.04,.22,p.z+1.42]);
    sim.body.velocity.x=-3;
  }else{
    sim.body.position.y=.12;sim.body.velocity.y=-1;
  }
  for(let i=0;i<60;i++){
    const t=sim.advanceFixed({},DT),failure=mission.check(sim,t);
    if(!failure)continue;
    assert.equal(failure.reason,'collision');assert.ok(failure.contact);
    if(type==='sidewall'){
      assert.equal(failure.contact.objectId,'wheel-side-check');
      assert.match(failure.contact.vehiclePart,/wheel-stop/);
      assert.ok(Math.abs(failure.contact.normalOnVehicle.x)>.8);
    }else{
      assert.equal(failure.contact.objectId,'ground');
      assert.ok(t.integration.contactLedger.hullEquations>0);
    }
    return failure.contact;
  }
  assert.fail(type+' fixture missed contact');
}
const out='qa/release-'+REPORT_VERSION;mkdirSync(out,{recursive:true});
writeFileSync(out+'/route-contacts.json',JSON.stringify({modelBuildId:MODEL_BUILD_ID,steps,trajectoryErrorM:error,
  wheelSupport:{hullEquations:ledger.hullEquations,wheelStopEquations:ledger.wheelStopEquations,missionContinued:true},
  wheelImpact:impact('sidewall'),bodyGrounding:impact('grounding')},null,2)+'\n');
console.log('PASS recorded cornering, wheel-side obstacle and body grounding');
