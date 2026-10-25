import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {compareInitialSnapshots} from '../dist/experiment-restore.js';
import {captureExperimentSnapshot,contentLabel} from '../dist/experiment-records.js';
import {createRenderPreparation} from '../dist/render-preparation.js';
import {createRoadster,sampleVehicleFrontCorner,sampleVehicleSide} from '../dist/vehicle.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const rows=[],sim=new RoadsterSim({}, {world:'city'}),initial=captureExperimentSnapshot(sim,'city');
const foreign=structuredClone(initial);foreign.physical.geometrySignature=initial.physical.geometrySignature==='12345678'?'87654321':'12345678';
foreign.stateLabel=contentLabel(foreign.physical);
const pristine=JSON.stringify([initial,foreign]);
assert.notEqual(initial.stateLabel,foreign.stateLabel);
assert.deepEqual(compareInitialSnapshots(initial,foreign),{equal:true,basis:'validated-portable-geometry',ignoredField:'geometrySignature'});
assert.equal(JSON.stringify([initial,foreign]),pristine);
for(const change of [s=>s.body.position.values[1]+=.001,s=>s.state.gasMass-=.001,s=>s.state._heightTarget+=.01,s=>s.state.simTime+=1/120,s=>s.geometryIdentity.signature='00000000']){
  const different=structuredClone(foreign);change(different.physical);
  different.stateLabel=initial.stateLabel; // matching labels are not proof
  assert.equal(compareInitialSnapshots(initial,different).equal,false);
}
const legacy=structuredClone(foreign);delete legacy.physical.geometryIdentity;
assert.equal(compareInitialSnapshots(initial,legacy).equal,false);
const forged=structuredClone(initial),forgedOther=structuredClone(foreign);
forged.physical.geometryIdentity.signature=forgedOther.physical.geometryIdentity.signature='00000000';
assert.equal(compareInitialSnapshots(forged,forgedOther).equal,false);
rows.push({name:'portable initial states, exact continuation changes, legacy and forged identity',status:'passed'});

let release,calls=0,active=0,maxActive=0;const busy=[];
const queue=createRenderPreparation(async()=>{calls++;active++;maxActive=Math.max(active,maxActive);if(calls===1)await new Promise(r=>release=r);active--;},{onBusy:v=>busy.push(v)});
const first=queue.run();assert.equal(queue.run(),first);await Promise.resolve();queue.invalidate();release();await first;
assert.equal(calls,2);assert.equal(maxActive,1);assert.equal(queue.needed,false);assert.deepEqual(busy,[true,false]);
await queue.run();assert.equal(calls,2);
let failed=0;const bad=createRenderPreparation(async()=>{failed++;throw Error('fixture');});
await assert.rejects(bad.run(),/fixture/);assert.equal(bad.needed,false);await bad.run();assert.equal(failed,1);
bad.invalidate();await assert.rejects(bad.run(),/fixture/);assert.equal(failed,2);
rows.push({name:'render preparation coalesces changes, never races or retries failed preparation every frame',status:'passed'});

for(const side of [-1,1])for(let i=0;i<=40;i++){
  const v=i/40,p=sampleVehicleFrontCorner(side,1,v),skin=sampleVehicleSide(2.30,p[1]);
  assert.ok(Math.abs(p[0]-side*skin.x)<1e-12);assert.equal(p[2],2.30);
  const near=sampleVehicleFrontCorner(side,1-1e-5,v);
  const slope=side*(skin.x-sampleVehicleSide(2.2999,p[1]).x)/.0001;
  assert.ok(Math.abs((p[0]-near[0])-slope*(p[2]-near[2]))<1e-9,'The front quarter matches the actual side-skin tangent, not just its position');
  for(let j=0;j<=20;j++){const q=sampleVehicleFrontCorner(side,j/20,v);assert.ok(q.every(Number.isFinite));assert.ok(q[2]>=2.30&&q[2]<2.38);}
}
const car=createRoadster({inspection:true});const budgets=[];
for(const quality of ['balanced','high','ultra']){
  car.setQuality(quality);const cost=car.getRenderCost();budgets.push({quality,cost});
  car.group.traverse(o=>{if(!o.isMesh||!o.name.includes('front bumper'))return;for(const values of [o.geometry.attributes.position.array,o.geometry.attributes.normal.array])assert.ok(values.every(Number.isFinite));});
}
car.dispose();rows.push({name:'front corner continuity, finite surfaces and all three render budgets',status:'passed',budgets});
mkdirSync(`qa/release-${REPORT_VERSION}`,{recursive:true});writeFileSync(`qa/release-${REPORT_VERSION}/readiness.json`,JSON.stringify({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',rows,scope:'Numerical/structural checks; visual quality and actual GPU timing are assessed separately in browser evidence.'},null,2)+'\n');
console.log('PASS portable comparison, serialized preparation and front-corner continuity');
