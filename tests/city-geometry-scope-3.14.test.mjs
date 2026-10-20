import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {partitionCityGeometry,CITY_GEOMETRY_CONTRACT as fixture,CITY_ENTRY_GEOMETRY_CONTRACT as entryFixture,CITY_ADDITIONS_316_CONTRACT as additionsFixture} from '../qa/city-geometry-scope.mjs';
const geometry=new RoadsterSim().getWorldGeometry(),scope=partitionCityGeometry(geometry),checks=[];
const mutate=(name,fn)=>{const copy=structuredClone(geometry);fn(copy);let failure=null;try{partitionCityGeometry(copy);}catch(error){failure={name:error.name,message:error.message};}assert.ok(failure,name+' must be rejected');checks.push({name,status:'passed',injectedMutationRejected:failure});};
mutate('Changing an unrelated original road remains forbidden',g=>g.find(x=>x.id==='east-ridge-107').position[1]+=.001);
mutate('Changing an original perimeter remains forbidden',g=>g.find(x=>x.id==='boundary-west').size[1]+=.001);
mutate('Changing a previously accepted corridor/entry is not hidden by its addition label',g=>g.find(x=>x.id===scope.added.find(x=>!fixture.continuityAdditionIds.includes(x.id)).id).size[0]+=.001);
mutate('Changing an approved tower value remains forbidden',g=>g.find(x=>x.id==='arcology-west-tier-1').size[0]+=.001);
mutate('Restoring a superseded invisible tower tier remains forbidden',g=>g.push(structuredClone(fixture.towers[0].before[3])));
mutate('Removing an unrelated original entity remains forbidden',g=>g.splice(g.findIndex(x=>x.id==='ground'),1));
mutate('An unlisted new entity cannot be excluded by a continuity prefix',g=>g.push({...structuredClone(g[0]),id:'continuity-unlisted-intrusion'}));
mutate('A duplicate entity cannot be hidden by a Map',g=>g.push(structuredClone(g[0])));
const [southId,northId]=entryFixture.expectedCurrent.map(g=>g.id);
mutate('Closing even 1 mm of the approved vehicle opening remains forbidden',g=>g.find(x=>x.id===southId).size[2]+=.001);
mutate('Moving the approved opening along the original street remains forbidden',g=>{g.find(x=>x.id===southId).position[2]+=.001;g.find(x=>x.id===northId).position[2]+=.001;});
mutate('Changing the retained paving height remains forbidden',g=>g.find(x=>x.id===northId).size[1]+=.001);
mutate('Changing the paving collision kind remains forbidden',g=>g.find(x=>x.id===northId).kind='building');
mutate('Changing a split piece orientation remains forbidden',g=>g.find(x=>x.id===northId).quaternion[0]=.001);
mutate('Removing an approved paving piece remains forbidden',g=>g.splice(g.findIndex(x=>x.id===northId),1));
mutate('Restoring the old invisible pavement across the vehicle mouth remains forbidden',g=>g.push(structuredClone(entryFixture.before)));
mutate('A similar paving prefix does not create a general exclusion',g=>g.push({...structuredClone(entryFixture.expectedCurrent[0]),id:'plan-foundry-paving-110.5-extra'}));
const newWalkId='continuity-foundry-inner-walk--1--84';
mutate('Widening a new 3.16 footway by 1 mm is rejected',g=>g.find(x=>x.id===newWalkId).size[0]+=.001);
mutate('Moving a new 3.16 footway 1 mm into a crossing is rejected',g=>g.find(x=>x.id===newWalkId).position[2]-=.001);
mutate('Changing a new support collision kind is rejected',g=>g.find(x=>x.id==='street-connector-trunk-0').kind='building');
mutate('Removing the new shelter roof is rejected',g=>g.splice(g.findIndex(x=>x.id==='continuity-crosstown-shelter-roof'),1));
mutate('Duplicating a new street seat cannot disappear inside an addition map',g=>g.push(structuredClone(g.find(x=>x.id==='street-connector-seat-0'))));
mutate('A similar new footway prefix grants no additional exclusion',g=>g.push({...structuredClone(g.find(x=>x.id===newWalkId)),id:'continuity-foundry-inner-walk-unlisted'}));
mutate('The exact new addition order remains checked',g=>{const a=g.findIndex(x=>x.id===newWalkId);[g[a],g[a+1]]=[g[a+1],g[a]];});
const preFix=JSON.parse(readFileSync(new URL('../qa/fixtures/city-additions-3.16-before-crossroad-fix.json',import.meta.url)));
mutate('Restoring the two demonstrably obstructing pre-fix kerbs is rejected',g=>{for(const side of [-1,1]){const old=preFix.expectedCurrent.find(x=>x.id===`continuity-foundry-inner-walk-${side}--117`),slot=g.findIndex(x=>x.id===`continuity-foundry-inner-walk-${side}--84`);g[slot]=structuredClone(old);}});
// Independent actual triangle rays test the original cross-road opening. The
// production geometry contract cannot justify its own newly frozen boundary.
const meshFor=g=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...g.size),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.position.set(...g.position);mesh.quaternion.set(...g.quaternion);mesh.name=g.id;mesh.updateMatrixWorld(true);return mesh;};
const meshes=geometry.map(meshFor),ray=new THREE.Raycaster(),samples=[];
for(const centreZ of [-100,0,100])for(const offset of [-15.999,-14,-7,0,7,14,15.999]){
  const z=centreZ+offset;ray.set(new THREE.Vector3(80,.06,z),new THREE.Vector3(1,0,0));ray.far=40;
  const hits=ray.intersectObjects(meshes,false).map(hit=>({id:hit.object.name,point:hit.point.toArray()}));assert.deepEqual(hits,[],'The original full 32 m cross-road opening must remain physically clear at '+z);samples.push({z,hits});
}
const badMeshes=preFix.expectedCurrent.filter(g=>g.id.endsWith('--117')).map(meshFor);ray.set(new THREE.Vector3(80,.06,-100),new THREE.Vector3(1,0,0));ray.far=40;
const originalNegative=ray.intersectObjects(badMeshes,false).map(hit=>({id:hit.object.name,x:hit.point.x,distance:hit.distance}));assert.deepEqual(originalNegative.map(hit=>hit.x),[88,91,109,112],'The retained real obstruction must still be reproduced by the independent oracle');
const additions=geometry.filter(g=>additionsFixture.expectedCurrent.some(e=>e.id===g.id)),boundaries=[];
const rectangleOverlap=(a,b)=>Math.max(0,Math.min(a.max.x,b[2])-Math.max(a.min.x,b[0]))*Math.max(0,Math.min(a.max.z,b[3])-Math.max(a.min.z,b[1]));
for(const g of additions){
  const box=new THREE.Box3().setFromObject(meshes.find(m=>m.name===g.id));
  assert.equal(rectangleOverlap(box,[91,-132.5,109,138]),0,'A new support enters the declared Foundry carriageway');
  assert.equal(rectangleOverlap(box,[-300,-141.5,200,-123.5]),0,'A new support enters the declared Crosstown carriageway');
  if(g.id.includes('shelter')||g.id.startsWith('street-connector-'))for(const x of [-100,0,100])assert.equal(rectangleOverlap(box,[x-14,-200,x+14,-100]),0,'A new support narrows an original 28 m grid cross-road');
  boundaries.push({id:g.id,min:box.min.toArray(),max:box.max.toArray(),crosstown18mCarriagewayClear:true,foundry18mCarriagewayClear:true});
}
assert.equal(additions.length,31);
checks.push({name:'All 31 exact additions keep declared carriageways open and all three original Foundry crossings retain their full 32 m opening',status:'passed',samples,boundaries,retainedPreFixNegative:originalNegative,method:'Independent Three DoubleSide box triangles and transformed actual geometry bounds, not the production solver or contract boundary helper'});
const correctionFile=new URL('../qa/foundry-crossroad-correction-3.16.json',import.meta.url),correction=JSON.parse(readFileSync(correctionFile));correction.after={createdAt:new Date().toISOString(),sourceSHA256:createHash('sha256').update(readFileSync(new URL('../dist/city-continuity.js',import.meta.url))).digest('hex'),geometryCanonicalSHA256:scope.contract.currentPhysicalCanonicalSHA256,hits:samples.find(s=>s.z===-100).hits,allThreeCrossings:samples,retainedPreFixNegativeReproduced:originalNegative,scope:'Independent triangle oracle. Actual route driving remains separate.'};writeFileSync(correctionFile,JSON.stringify(correction,null,2)+'\n');
for(const mesh of [...meshes,...badMeshes]){mesh.geometry.dispose();mesh.material.dispose();}
const approved=scope.contract.approved315GeometryChanges;assert.equal(approved.length,1);assert.equal(approved[0].opening.widthM,8);assert.equal(approved[0].opening.zMin,298.5);assert.equal(approved[0].opening.zMax,306.5);
assert.equal(scope.contract.reconstructedHistoricalCanonicalSHA256,fixture.baselineHistoricalCanonicalSHA256);
assert.equal(scope.contract.reconstructedSource313CanonicalSHA256,fixture.baselineFullCanonicalSHA256);
checks.push({name:'The exact 8 m opening reconstructs both immutable historical identities with every other entity retained',status:'passed',currentPhysicalCount:geometry.length,reconstructedHistoricalCount:scope.contract.reconstructedHistoricalCount,reconstructedSource313Count:scope.contract.reconstructedSource313Count});
const files=['qa/city-geometry-scope.mjs','qa/fixtures/city-geometry-scope-3.14.json','qa/fixtures/city-entry-geometry-scope-3.15.json','qa/fixtures/city-additions-3.16.json','qa/fixtures/city-additions-3.16-before-crossroad-fix.json','qa/city-plan-3.14-before-entry.json','tests/city-geometry-scope-3.14.test.mjs'];
const report={schema:'roadster-city-geometry-scope-3.14-result',status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,createdAt:new Date().toISOString(),checks,geometryContract:scope.contract,sourceSHA256:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex')])),scope:'Independent frozen 3.13 source comparison and injected contract violations only. Does not claim image, GPU, collision traversal or performance acceptance.'};
writeFileSync(new URL(`../qa/city-geometry-scope-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:checks.length,unchangedSource313:scope.contract.unchangedSource313Count,reconstructedHistoricalCanonicalSHA256:scope.contract.reconstructedHistoricalCanonicalSHA256},null,2));
