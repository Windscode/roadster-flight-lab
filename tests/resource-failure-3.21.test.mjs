import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {RoadsterSim} from '../dist/physics.js';
import {ResourceMission,prepareResourceRoute,completeResourcePreparation} from '../dist/resource-mission.js';
import {prepare,DT} from './route-driver-3.21.mjs';

function setup(){
  const sim=new RoadsterSim();prepareResourceRoute(sim);const descriptor=prepare(sim);completeResourcePreparation(sim);
  return{sim,descriptor,mission:new ResourceMission(sim,{descriptorHash:sim.getRouteSurface().descriptorHash})};
}
function driveOnce(sim,mission){const t=sim.advanceFixed({throttle:.3},DT);assert.equal(mission.check(sim,t),null);return t;}
function boundary(sim){sim.body.position.y=349.999;sim.body.velocity.y=10;return sim.advanceFixed({},DT);}
const a=setup();driveOnce(a.sim,a.mission);const failure=boundary(a.sim),terminal=failure.failure.triggerContinuationSnapshot;
assert.equal(failure.failure.kind,'safety-domain');assert.equal(failure.energyKWh,200,'Kernel has reset the live car');
const result=a.mission.result(a.sim,'simulation-fault');
assert.equal(result.reason,'simulation-fault');assert.equal(result.completed,false);assert.equal(result.resourceEvidence.scope,'failure-terminal-snapshot');
assert(result.elapsedS>0);assert(result.remainingKWh<.12);assert(result.netEnergyJ>0&&result.netEnergyJ<432000);assert(result.work.auxiliaryJ>0);assert(Math.abs(result.balanceErrorJ)<.02);
assert(Math.abs(result.elapsedS-(terminal.state.simTime-a.mission.startedAt))<1e-12);
assert(Math.abs(result.remainingKWh-(terminal.params.batteryKWh-terminal.state._energyUsed))<1e-12);
assert.equal(result.gasRemainingKg,terminal.state.gasMass);
assert.equal(result.work.motorElectricalJ,terminal.resourceAccounting.motorElectricalJ-a.mission.initial.energyAccounting.motorElectricalJ);
// Once captured, later live-car edits cannot rewrite the result's resources.
a.sim.prepareEnergy(10);assert.deepEqual(a.mission.result(a.sim,'simulation-fault'),result);

const b=setup(),measured=driveOnce(b.sim,b.mission);b.sim.body.velocity.x=NaN;
const invalid=b.sim.advanceFixed({},DT);assert.equal(invalid.failure.kind,'non-finite-state');assert.equal(invalid.failure.triggerContinuationSnapshot,null);
const fallback=b.mission.result(b.sim,'simulation-fault');assert.equal(fallback.resourceEvidence.scope,'last-measured-valid-state');assert.equal(fallback.resourceEvidence.terminal,false);
assert.equal(fallback.resourceEvidence.simTime,measured.simTime);assert.equal(fallback.remainingKWh,measured.energyKWh);assert.equal(fallback.gasRemainingKg,measured.gasMass);
assert.equal(fallback.work.motorElectricalJ,measured.energyAccounting.motorElectricalJ-b.mission.initial.energyAccounting.motorElectricalJ);
assert(fallback.elapsedS>0);assert(fallback.netEnergyJ>0);assert(!fallback.samples.some(s=>s.energyKWh>1),'Reset battery must never enter the mission samples');

const c=setup();c.sim.body.velocity.x=NaN;c.sim.advanceFixed({},DT);
const immediate=c.mission.result(c.sim,'simulation-fault');assert.equal(immediate.resourceEvidence.scope,'last-measured-valid-state');assert.equal(immediate.resourceEvidence.simTime,c.mission.initial.simTime);
assert.equal(immediate.elapsedS,0);assert.equal(immediate.netEnergyJ,0,'Only the actual prepared sample exists; do not invent a later last-valid measurement');

const d=setup(),beforeReset=driveOnce(d.sim,d.mission);d.sim.reset('city');
const reset=d.mission.result(d.sim,'pilot-ended');assert.equal(reset.reason,'reset-or-resource-reprepared');assert.equal(reset.remainingKWh,beforeReset.energyKWh);assert(reset.elapsedS>0);assert(reset.netEnergyJ>0);

const e=setup();e.sim.body.position.y=.2;const collision=e.sim.advanceFixed({},DT);
assert.equal(collision.fault,null);assert(collision.rigidContactCount>0,'Physical penetration fixture must produce real rigid contact');
const collided=e.mission.result(e.sim,'collision');assert.equal(collided.reason,'collision');assert.equal(collided.resourceEvidence.scope,'live-terminal-state');assert.equal(collided.remainingKWh,collision.energyKWh);

let domFaultPriority=false;
if(process.env.JSDOM_MODULE_PATH){
  const {JSDOM}=createRequire(import.meta.url)(process.env.JSDOM_MODULE_PATH);
  const {createRouteExperience}=await import('../dist/route-experience.js');
  const dom=new JSDOM('<main><div id="route"></div><div id="hud"></div></main>'),doc=dom.window.document;
  const live=setup();let paused=true,recording={recording:false},stops=0;
  const ui=createRouteExperience({mount:doc.getElementById('route'),hudMount:doc.getElementById('hud'),getSim:()=>live.sim,getPaused:()=>paused,getContext:()=> 'city',getRecording:()=>recording,
    onPrepare:(_,{prepareSim})=>{prepareSim(live.sim);return{descriptor:prepare(live.sim)};},
    onStart:()=>{paused=false;recording={recording:true,id:'fault-fixture'};return recording;},onFinish:()=>{stops++;},onInspect(){},onOpen(){},onSound(){},onHead(){}});
  async function click(action){doc.querySelector(`[data-route-action="${action}"]`).click();await Promise.resolve();await Promise.resolve();ui.update();}
  try{
    await click('prepare');await click('start');assert(ui.getState().run);
    const t=boundary(live.sim);recording={recording:false};ui.afterStep(t,DT);ui.update();
    assert.equal(ui.getState().lastResult.reason,'simulation-fault');assert.equal(ui.getState().resourceHistory.at(-1).resourceEvidence.scope,'failure-terminal-snapshot');assert.equal(stops,0,'Do not stop an already-finished recorder again');domFaultPriority=true;
  }finally{ui.dispose();dom.window.close();}
}
console.log(JSON.stringify({status:'passed',checks:['finite failure terminal resources','immutable captured failure result','nonfinite last-measured fallback','initial-only fallback without invented work','explicit reset excludes reset-car resources','actual collision remains collision'],domFaultPriority,scope:'Production physics boundary/contact fixtures and exact measured resource accounting. Optional DOM priority fixture; no native input or GPU acceptance.'}));
