// Exact historical partition. Only explicitly listed additions and the three
// frozen 3.14 anchor profiles and one explicitly frozen 3.15 vehicle-mouth
// paving split, the explicit frozen 3.16 street additions, and the exact 3.17
// public street-edge solids / translated lamp supports can differ.
// Every other original entity retains its 1e-9
// canonical identity. No kind/prefix-wide geometry exclusions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CITY_ROUTE_CORRIDOR,CITY_STREETS} from '../dist/city-plan.js';
import {SOUTH_QUAY_ENTRY_SOLIDS} from '../dist/city-landmarks.js';
import {CITY_BUILDINGS,CITY_CONTINUITY} from '../dist/city-data.js';
import {STREET_COLLIDERS} from '../dist/street-life.js';
import {canonicalGeometryJSON as canonical} from '../dist/irradiance-math.js';
export const CITY_GEOMETRY_CONTRACT=JSON.parse(readFileSync(new URL('./fixtures/city-geometry-scope-3.14.json',import.meta.url)));
export const CITY_ENTRY_GEOMETRY_CONTRACT=JSON.parse(readFileSync(new URL('./fixtures/city-entry-geometry-scope-3.15.json',import.meta.url)));
export const CITY_ADDITIONS_316_CONTRACT=JSON.parse(readFileSync(new URL('./fixtures/city-additions-3.16.json',import.meta.url)));
export const CITY_CHANGES_317_CONTRACT=JSON.parse(readFileSync(new URL('./fixtures/city-changes-3.17.json',import.meta.url)));
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const eulerQuaternion=([x,y,z])=>{const sx=Math.sin(x/2),cx=Math.cos(x/2),sy=Math.sin(y/2),cy=Math.cos(y/2),sz=Math.sin(z/2),cz=Math.cos(z/2);return[sx*cy*cz+cx*sy*sz,cx*sy*cz-sx*cy*sz,cx*cy*sz+sx*sy*cz,cx*cy*cz-sx*sy*sz];};
function bounds(boxes){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const box of boxes){const [x,y,z,w]=box.quaternion,m=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
    for(const a of [-1,1])for(const b of [-1,1])for(const c of [-1,1]){const corner=[a*box.size[0]/2,b*box.size[1]/2,c*box.size[2]/2];for(let k=0;k<3;k++){const p=box.position[k]+m[k].reduce((v,e,j)=>v+e*corner[j],0);min[k]=Math.min(min[k],p);max[k]=Math.max(max[k],p);}}
  }
  return{min,max};
}
function restoreStreetEdge317ForHistoricalComparison(current){
  const f=CITY_CHANGES_317_CONTRACT,map=new Map(current.map(g=>[g.id,g]));
  assert.equal(map.size,current.length,'Duplicate physical geometry identities');
  assert.equal(current.length,f.currentCount);assert.equal(hash(current),f.currentSHA256,'A 3.17 city entity changed beyond the recorded exact street-edge/light-station changes');
  for(const g of f.added){assert.ok(map.has(g.id));assert.equal(canonical(map.get(g.id)),canonical(g),'Street-edge envelope differs: '+g.id);map.delete(g.id);}
  for(const row of f.changed){assert.equal(canonical(map.get(row.after.id)),canonical(row.after),'Recorded lamp station differs: '+row.after.id);map.set(row.before.id,row.before);}
  for(const g of f.removed){assert.ok(!map.has(g.id));map.set(g.id,g);}
  assert.equal(map.size,f.baselineCount);assert.equal(new Set(f.baselineOrder).size,f.baselineCount);
  const comparison=f.baselineOrder.map(id=>{assert.ok(map.has(id),'Missing retained 3.16 geometry '+id);return map.get(id);});
  assert.equal(hash(comparison),f.baselineSHA256,'Restoring only recorded 3.17 changes must recover the complete 3.16 city');
  const ids=new Set(f.added.map(g=>g.id));assert.deepEqual(CITY_CONTINUITY.solids.filter(g=>ids.has(g.id)),f.streetEdgeAuthoring,'Street-edge rendering authoring diverged from its collision envelope');
  return {comparison,ids,actual:f.added,change:{changeId:f.changeId,sourceCommit:f.sourceCommit,addedIds:f.added.map(g=>g.id),movedIds:f.changed.map(g=>g.after.id),removedIds:f.removed.map(g=>g.id),baselineSHA256:f.baselineSHA256,currentSHA256:f.currentSHA256,scope:f.scope}};
}
function restoreApproved316Additions(current){
  const f=CITY_ADDITIONS_316_CONTRACT,ids=new Set(f.expectedCurrent.map(g=>g.id));
  assert.equal(ids.size,31,'The approved 3.16 addition set must remain an exact 31-record list');
  assert.equal(hash(f.expectedCurrent),f.expectedCanonicalSHA256,'The 3.16 expected geometry identity changed');
  assert.equal(new Set(current.map(g=>g.id)).size,current.length,'Duplicate physical geometry identities');
  for(const[file,expected]of Object.entries(f.unchangedFrozenFixtures))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),expected,'A frozen historical fixture was altered: '+file);
  const actual=current.filter(g=>ids.has(g.id));
  assert.equal(canonical(actual),canonical(f.expectedCurrent),'An approved 3.16 addition was changed, removed, duplicated or reordered');
  for(const group of f.groups){
    assert.equal(group.ids.length,group.count);assert.equal(hash(group.expectedCurrent),group.canonicalSHA256);
    const idSet=new Set(group.ids),authored=group.id==='foundry-footways-and-crosstown-shelter'?CITY_CONTINUITY.solids:STREET_COLLIDERS;
    assert.deepEqual(authored.filter(g=>idSet.has(g.id)),group.authoring,'An approved 3.16 authored support changed: '+group.id);
  }
  const added317Ids=new Set(CITY_CHANGES_317_CONTRACT.added.map(g=>g.id));
  const retainedContinuity=CITY_CONTINUITY.solids.filter(g=>!ids.has(g.id)&&!added317Ids.has(g.id)),retainedStreet=STREET_COLLIDERS.filter(g=>!ids.has(g.id));
  const rawHash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const tag=f.authoringMetadataChange;assert.equal(tag.field,'data.project');assert.deepEqual(retainedContinuity.map(g=>g.id),tag.ids);
  const oldTaggedContinuity=retainedContinuity.map(g=>{assert.equal(g.data.project,tag.after,'Unexpected project version tag');return{...g,data:{...g.data,project:tag.before}};});
  assert.equal(rawHash(oldTaggedContinuity),f.sourceBefore.continuityAuthoringSHA256,'An original continuity object changed beyond the explicit project version tag');
  assert.equal(rawHash(retainedStreet),f.sourceBefore.streetColliderSHA256,'An original street furnishing proxy changed');
  const comparison=current.filter(g=>!ids.has(g.id));
  assert.equal(comparison.length,f.sourceBefore.physicalCount);
  assert.equal(hash(comparison),f.sourceBefore.physicalCanonicalSHA256,'After only the exact 3.16 additions are removed, the original 3.15 city must be byte-canonically intact');
  return{comparison,actual,retainedContinuity,change:{changeId:f.changeId,expectedCanonicalSHA256:f.expectedCanonicalSHA256,groups:f.groups.map(g=>({id:g.id,count:g.count,ids:g.ids,canonicalSHA256:g.canonicalSHA256,scope:g.scope})),sourceBefore:f.sourceBefore,originalContractFailures:f.originalContractFailures,scope:f.scope}};
}
function restoreApprovedEntryForHistoricalComparison(current){
  const f=CITY_ENTRY_GEOMETRY_CONTRACT,map=new Map(current.map(g=>[g.id,g]));
  assert.equal(map.size,current.length,'Duplicate physical geometry identities');
  const authoringBytes=readFileSync(new URL('../'+f.sourceAuthoringFixture,import.meta.url));
  assert.equal(createHash('sha256').update(authoringBytes).digest('hex'),f.sourceAuthoringFixtureSHA256,'The original pre-cut authoring fixture changed');
  const originalAuthoring=JSON.parse(authoringBytes),old=originalAuthoring.solids.find(g=>g.id===f.before.id);
  assert.equal(originalAuthoring.sourceSha256,f.sourceCityPlanSHA256);
  assert.ok(old,'The independently retained original paving is missing');
  assert.deepEqual({id:old.id,type:'box',kind:old.kind,size:old.size,position:old.position,quaternion:eulerQuaternion(old.rotation)},f.before,'The frozen historical paving differs from its original authoring data');
  assert.ok(!map.has(f.before.id),'The superseded paving must not remain across the vehicle mouth');
  const actual=f.expectedCurrent.map(expected=>{
    assert.ok(map.has(expected.id),'Missing explicitly approved vehicle-mouth paving '+expected.id);
    const found=map.get(expected.id);assert.equal(canonical(found),canonical(expected),'Unapproved vehicle-mouth paving change: '+expected.id);return found;
  });
  const [south,north]=actual,opening=f.opening;
  assert.equal(current.indexOf(north),current.indexOf(south)+1,'The two approved paving pieces must retain the original ordered slot');
  assert.deepEqual(bounds(actual),f.unchangedOuterBounds,'Paving outer bounds changed beyond the one vehicle mouth');
  assert.equal(south.position[2]+south.size[2]/2,opening.zMin);
  assert.equal(north.position[2]-north.size[2]/2,opening.zMax);
  assert.equal(opening.zMax-opening.zMin,opening.widthM);
  assert.equal((opening.zMin+opening.zMax)/2,opening.centreZ);
  const road=CITY_STREETS.find(r=>r.id===opening.roadId),oldRoad=originalAuthoring.streets.find(r=>r.id===opening.roadId);
  assert.deepEqual(road,oldRoad,'The original carriageway must not be moved or widened to justify the split');
  assert.equal(road.width,opening.widthM);assert.equal(road.points[0][2],opening.centreZ);assert.equal(road.points[1][2],opening.centreZ);
  assert.equal(south.position[0]-south.size[0]/2,opening.xMin);assert.equal(south.position[0]+south.size[0]/2,opening.xMax);
  // Replace only the verified southern slot, and remove only its verified
  // northern partner. The immutable historical counts/hashes below still
  // certify every other box, including all old planning/corridor/entry solids.
  const comparison=current.flatMap(g=>g.id===south.id?[structuredClone(f.before)]:g.id===north.id?[]:[g]);
  return{comparison,change:{changeId:f.changeId,sourceCommit:f.sourceCommit,sourceCityPlanSHA256:f.sourceCityPlanSHA256,before:f.before,current:actual,opening,unchangedOuterBounds:f.unchangedOuterBounds,originalFailure:f.originalFailure,scope:f.scope}};
}
export function partitionCityGeometry(currentGeometry){
  const changes317=restoreStreetEdge317ForHistoricalComparison(currentGeometry),additions316=restoreApproved316Additions(changes317.comparison),entry=restoreApprovedEntryForHistoricalComparison(additions316.comparison),geometry=entry.comparison;
  const f=CITY_GEOMETRY_CONTRACT,source=[...CITY_CHANGES_317_CONTRACT.corridorBefore,...SOUTH_QUAY_ENTRY_SOLIDS,...additions316.retainedContinuity],plan=new Map(source.map(s=>[s.id,s]));
  assert.equal(new Set(geometry.map(g=>g.id)).size,geometry.length,'Duplicate physical geometry identities');
  assert.equal(plan.size,source.length,'Duplicate authored addition identities');
  assert.deepEqual(additions316.retainedContinuity.map(g=>g.id),f.continuityAdditionIds,'3.14 additions must use the frozen explicit entity list');
  const added=geometry.filter(g=>plan.has(g.id)),legacy=geometry.filter(g=>!plan.has(g.id)),currentMap=new Map(geometry.map(g=>[g.id,g]));
  assert.equal(added.length,plan.size,'Authored entities are missing or duplicated in the physical world');
  for(const actual of added){
    const expected=plan.get(actual.id);assert.equal(actual.type,'box');assert.equal(actual.kind,expected.kind);assert.deepEqual(actual.position,expected.position);assert.deepEqual(actual.size,expected.size);
    assert.equal(canonical(actual.quaternion),canonical(eulerQuaternion(expected.rotation)),'Authored rotation differs: '+actual.id);
  }
  const added314=new Set(f.continuityAdditionIds),currentAdditions=added.filter(g=>added314.has(g.id));
  assert.equal(hash(currentAdditions),f.continuityAdditionsCanonicalSHA256,'3.14 additions changed after accepted shared-geometry review');
  const oldTowerIds=new Set(f.towers.flatMap(t=>t.before.map(g=>g.id))),newTowerIds=new Set(f.towers.flatMap(t=>t.expectedCurrent.map(g=>g.id))),towerRows=[];
  for(const tower of f.towers){
    const actual=tower.expectedCurrent.map(g=>{assert.ok(currentMap.has(g.id),'Missing approved tower tier '+g.id);return currentMap.get(g.id);});
    assert.equal(canonical(actual),canonical(tower.expectedCurrent),'Unapproved tower profile change: '+tower.id);
    for(const id of tower.removedIds)assert.ok(!currentMap.has(id),'Replaced old tower tier must not remain as an invisible collider: '+id);
    const b=CITY_BUILDINGS.find(b=>b.id===tower.id);assert.ok(b);const {id,x,z,w,d,height,baseY}=b;assert.deepEqual({id,x,z,w,d,height,baseY},tower.parcel,'Original tower parcel changed');
    const oldBounds=bounds(tower.before),newBounds=bounds(actual);
    for(const b of [oldBounds,newBounds])for(const side of ['min','max'])for(let k=0;k<3;k++)assert.ok(Math.abs(b[side][k]-tower.unchangedEnvelope[side][k])<1e-9,'Tower footprint/base/top envelope changed: '+tower.id);
    for(let i=0;i<actual.length;i++){
      const box=actual[i],bottom=box.position[1]-box.size[1]/2,top=box.position[1]+box.size[1]/2;
      if(i)assert.ok(Math.abs(bottom-(actual[i-1].position[1]+actual[i-1].size[1]/2))<1e-9,'Tower tiers have a gap or overlap');
      if(i<actual.length-1){const floor=(top-tower.parcel.baseY-tower.design.shopHeightM)/tower.design.floorHeightM;assert.ok(Math.abs(floor-Math.round(floor))<1e-9,'Tower transition is not on an original storey');}
    }
    towerRows.push({id:tower.id,before:tower.before,current:actual,removedIds:tower.removedIds,oldBounds,newBounds,parcelUnchanged:true});
  }
  const unchangedLegacy=legacy.filter(g=>!newTowerIds.has(g.id)),unchangedSource313=geometry.filter(g=>!added314.has(g.id)&&!newTowerIds.has(g.id));
  assert.equal(unchangedLegacy.length,f.unchangedHistoricalCount);assert.equal(hash(unchangedLegacy),f.unchangedHistoricalCanonicalSHA256,'An unrelated historical geometry entity changed');
  assert.equal(unchangedSource313.length,f.unchangedSource313Count);assert.equal(hash(unchangedSource313),f.unchangedSource313CanonicalSHA256,'An unrelated 3.13 geometry entity changed, including previous corridor/entry additions');
  const restore=list=>list.flatMap(g=>{const tower=f.towers.find(t=>t.id===g.id);return tower?tower.before:oldTowerIds.has(g.id)?[]:[g];});
  const reconstructedLegacy=restore(legacy),reconstructedSource313=restore(geometry.filter(g=>!added314.has(g.id)));
  assert.equal(reconstructedLegacy.length,f.baselineHistoricalCount);assert.equal(hash(reconstructedLegacy),f.baselineHistoricalCanonicalSHA256,'Reconstructed historical city must retain the original 77b01ed identity');
  assert.equal(reconstructedSource313.length,f.baselineFullCount);assert.equal(hash(reconstructedSource313),f.baselineFullCanonicalSHA256,'Reconstructed full 3.13 city differs from the independently frozen solver');
  const contract={currentPhysicalCount:currentGeometry.length,currentPhysicalCanonicalSHA256:hash(currentGeometry),approved315GeometryChanges:[entry.change],approved316Additions:additions316.change,historicalComparisonNormalization:'First verify the 31 exact 3.16 supports (13 continuity, 18 street furnishing) and remove only those verified records, recovering the independently restored 3.15 full city hash. Then restore the two explicitly checked 3.15 paving pieces to their frozen original box. The unchanged inherited historical counts/hashes still apply to every remaining record; they are not the full-current geometry identity.',sourceCommit:f.sourceCommit,sourcePhysicsSHA256:f.sourcePhysicsSHA256,sourceCitySHA256:f.sourceCitySHA256,quantization:f.quantization,unchangedHistoricalCount:unchangedLegacy.length,unchangedHistoricalCanonicalSHA256:hash(unchangedLegacy),unchangedSource313Count:unchangedSource313.length,unchangedSource313CanonicalSHA256:hash(unchangedSource313),reconstructedHistoricalCount:reconstructedLegacy.length,reconstructedHistoricalCanonicalSHA256:hash(reconstructedLegacy),reconstructedSource313Count:reconstructedSource313.length,reconstructedSource313CanonicalSHA256:hash(reconstructedSource313),explicit314AdditionCount:currentAdditions.length,explicit314AdditionIds:f.continuityAdditionIds,approvedTowerChanges:towerRows,originalFailure:f.firstFailure,scope:'Exact geometry identity, three explicit tower profiles, one explicit vehicle-mouth paving split and 31 exact new street supports only; not GPU, aesthetics, driving or performance acceptance.'};
  contract.approved317StreetChanges=changes317.change;
  contract.historicalComparisonNormalization='First verify and reverse exactly the 116 new shared street-edge envelopes and 66 moved lamp-support records in the frozen 3.17 fixture, recovering the full 3.16 geometry identity. '+contract.historicalComparisonNormalization;
  const allAdded=[...added,...additions316.actual,...changes317.actual];
  return{legacy,added:allAdded,addedIds:allAdded.map(g=>g.id),unchangedLegacy,unchangedSource313,reconstructedLegacy,contract};
}
