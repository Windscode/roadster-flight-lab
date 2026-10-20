// Exact historical partition. Only explicitly listed additions and the three
// frozen 3.14 anchor profiles can differ; every other original entity retains
// its 1e-9 canonical identity. No kind/prefix-wide geometry exclusions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CITY_ROUTE_CORRIDOR} from '../dist/city-plan.js';
import {SOUTH_QUAY_ENTRY_SOLIDS} from '../dist/city-landmarks.js';
import {CITY_BUILDINGS,CITY_CONTINUITY} from '../dist/city-data.js';
import {canonicalGeometryJSON as canonical} from '../dist/irradiance-math.js';
export const CITY_GEOMETRY_CONTRACT=JSON.parse(readFileSync(new URL('./fixtures/city-geometry-scope-3.14.json',import.meta.url)));
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const eulerQuaternion=([x,y,z])=>{const sx=Math.sin(x/2),cx=Math.cos(x/2),sy=Math.sin(y/2),cy=Math.cos(y/2),sz=Math.sin(z/2),cz=Math.cos(z/2);return[sx*cy*cz+cx*sy*sz,cx*sy*cz-sx*cy*sz,cx*cy*sz+sx*sy*cz,cx*cy*cz-sx*sy*sz];};
function bounds(boxes){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const box of boxes){const [x,y,z,w]=box.quaternion,m=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
    for(const a of [-1,1])for(const b of [-1,1])for(const c of [-1,1]){const corner=[a*box.size[0]/2,b*box.size[1]/2,c*box.size[2]/2];for(let k=0;k<3;k++){const p=box.position[k]+m[k].reduce((v,e,j)=>v+e*corner[j],0);min[k]=Math.min(min[k],p);max[k]=Math.max(max[k],p);}}
  }
  return{min,max};
}
export function partitionCityGeometry(geometry){
  const f=CITY_GEOMETRY_CONTRACT,source=[...CITY_ROUTE_CORRIDOR.solids,...SOUTH_QUAY_ENTRY_SOLIDS,...CITY_CONTINUITY.solids],plan=new Map(source.map(s=>[s.id,s]));
  assert.equal(new Set(geometry.map(g=>g.id)).size,geometry.length,'Duplicate physical geometry identities');
  assert.equal(plan.size,source.length,'Duplicate authored addition identities');
  assert.deepEqual(CITY_CONTINUITY.solids.map(g=>g.id),f.continuityAdditionIds,'3.14 additions must use the frozen explicit entity list');
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
  const contract={sourceCommit:f.sourceCommit,sourcePhysicsSHA256:f.sourcePhysicsSHA256,sourceCitySHA256:f.sourceCitySHA256,quantization:f.quantization,unchangedHistoricalCount:unchangedLegacy.length,unchangedHistoricalCanonicalSHA256:hash(unchangedLegacy),unchangedSource313Count:unchangedSource313.length,unchangedSource313CanonicalSHA256:hash(unchangedSource313),reconstructedHistoricalCount:reconstructedLegacy.length,reconstructedHistoricalCanonicalSHA256:hash(reconstructedLegacy),reconstructedSource313Count:reconstructedSource313.length,reconstructedSource313CanonicalSHA256:hash(reconstructedSource313),explicit314AdditionCount:currentAdditions.length,explicit314AdditionIds:f.continuityAdditionIds,approvedTowerChanges:towerRows,originalFailure:f.firstFailure,scope:'Exact geometry identity and explicit shared-profile changes only; not GPU, aesthetics, driving or performance acceptance.'};
  return{legacy,added,addedIds:added.map(g=>g.id),unchangedLegacy,unchangedSource313,reconstructedLegacy,contract};
}
