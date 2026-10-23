import assert from 'node:assert/strict';
import {RoadsterSim} from '../dist/physics.js';
import {prepare,DT} from './route-driver-3.21.mjs';
import {ResourceMission,prepareResourceRoute,completeResourcePreparation,comparableResourceRuns,resourceRunDifference} from '../dist/resource-mission.js';
function initial(change=()=>{}) {
 const sim=new RoadsterSim();prepareResourceRoute(sim,true);prepare(sim);completeResourcePreparation(sim,true);change(sim);
 return {sim,mission:new ResourceMission(sim,{descriptorHash:sim.getRouteSurface().descriptorHash})};
}
// Classification fixtures exercise identities; only the separate route-driver
// test establishes actual physical completion, not result('route-completed').
const a=initial(),b=initial();
const ar=a.mission.result(a.sim,'route-completed'),br=b.mission.result(b.sim,'route-completed');
assert(comparableResourceRuns(ar,br));assert.deepEqual(resourceRunDifference(ar,br),{elapsedS:0,netWh:0,gasKg:0,recoveredWh:0});
for(const change of [s=>s.body.position.x+=.01,s=>s.body.velocity.z=.01,s=>s.body.quaternion.setFromEuler(0,.01,0),s=>{s.wheelStates[0].angularVelocityRadS=.1;},s=>{s._observationSeed+=1;}]){
 const c=initial(change),cr=c.mission.result(c.sim,'route-completed');assert(!comparableResourceRuns(ar,cr),'Different full initial state cannot be ranked together');
}
for(const changed of [{completed:false},{reason:'pilot-ended'},{firstFailure:{reason:'collision'}},{balanceErrorJ:1},{elapsedS:NaN},{identity:{...ar.identity,initialState:undefined}}])assert(!comparableResourceRuns(ar,{...br,...changed}));
const c=initial();c.sim.advanceFixed({throttle:.2},DT);assert.equal(c.mission.check(c.sim),null);assert(!comparableResourceRuns(ar,c.mission.result(c.sim,'pilot-ended')));
const collided=initial();assert.equal(collided.mission.check(collided.sim,{...collided.sim.telemetry(),rigidContactCount:1}).reason,'collision');
console.log('PASS full-state comparison, failed/legacy exclusion, finite validation and collision classification');
