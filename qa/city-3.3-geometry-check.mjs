import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {CITY_BUILDINGS,CITY_COLLIDERS,buildingMassing} from '../dist/city-data.js';
import {STREET_COLLIDERS,buildStreetLife} from '../dist/street-life.js';
import {buildUrbanArchitecture} from '../dist/urban-architecture.js';
import {RoadsterSim} from '../dist/physics.js';

const sim=new RoadsterSim(),root=new THREE.Group(),architecture=buildUrbanArchitecture(THREE,root,CITY_BUILDINGS),street=buildStreetLife(THREE,root),checks=[];
const record=(name,count)=>checks.push({name,count,status:'passed'});
let instances=0;
root.traverse(o=>{if(!o.isMesh)return;assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));if(o.isInstancedMesh){assert.ok(o.instanceMatrix.array.every(Number.isFinite));instances+=o.count;}});
assert.ok(architecture.stats.triangles<2_400_000);assert.ok(street.stats.triangles<350_000);assert.ok(architecture.stats.drawBatches+street.stats.drawBatches<370);
assert.ok(street.stats.stalls<=24&&street.stats.pedestrians<=16);
record('finite geometry, instancing and bounded draw/triangle budgets',instances);
let tierCount=0,roofRays=0;
function inTier(x,z,b,t,margin=0){const dx=x-b.x-t.x,dz=z-b.z-t.z,c=Math.cos(t.yaw),s=Math.sin(t.yaw);return Math.abs(c*dx-s*dz)<t.w/2+margin&&Math.abs(s*dx+c*dz)<t.d/2+margin;}
for(const b of CITY_BUILDINGS){
 const tiers=buildingMassing(b);
 for(let i=0;i<tiers.length;i++){
  const t=tiers[i],c=Math.abs(Math.cos(t.yaw)),s=Math.abs(Math.sin(t.yaw)),ex=(c*t.w+s*t.d)/2,ez=(s*t.w+c*t.d)/2;
  assert.ok(Math.abs(t.x)+ex<=b.w/2+1e-6&&Math.abs(t.z)+ez<=b.d/2+1e-6,b.id+' extends outside its original parcel');
  assert.ok(t.top>t.bottom);if(i)assert.ok(Math.abs(t.bottom-tiers[i-1].top)<1e-7);tierCount++;
  if(i===0||i===tiers.length-1)continue;
  let found=false;
  for(const xx of [-.38,0,.38])for(const zz of [-.38,0,.38]){
   if(found)continue;const x=b.x+t.x+Math.cos(t.yaw)*xx*t.w+Math.sin(t.yaw)*zz*t.d,z=b.z+t.z-Math.sin(t.yaw)*xx*t.w+Math.cos(t.yaw)*zz*t.d;
   if(tiers.slice(i+1).some(next=>inTier(x,z,b,next,.5)))continue;
   const expected=b.baseY+t.top,hit=sim.traceSurface({x,y:expected+.12,z},{x:0,y:-1,z:0},.3);
   assert.ok(hit&&Math.abs(hit.point.y-expected)<.015,b.id+' exposed terrace has no matching roof contact');roofRays++;found=true;
  }
 }
}
record('all storey-aligned solid tiers remain in original parcels and join vertically',tierCount);
assert.ok(roofRays>300);record('independent rays contact exposed terrace tops at their visible height',roofRays);
let facadeRays=0;
for(const b of CITY_BUILDINGS.filter(b=>b.id.startsWith('market-front-'))){
 const side=Math.sign(b.x+200);
 for(const t of buildingMassing(b).slice(2)){
  const origin={x:-200,y:b.baseY+(t.top+t.bottom)/2,z:b.z},direction={x:side,y:0,z:0},c=Math.cos(t.yaw),s=Math.sin(t.yaw),o=[c*(origin.x-b.x-t.x)-s*(origin.z-b.z-t.z),s*(origin.x-b.x-t.x)+c*(origin.z-b.z-t.z)],d=[c*side,s*side],half=[t.w/2,t.d/2];
  let near=0,far=60;for(let k=0;k<2;k++){if(Math.abs(d[k])<1e-9){assert.ok(Math.abs(o[k])<=half[k]);continue;}let a=(-half[k]-o[k])/d[k],z=(half[k]-o[k])/d[k];if(a>z)[a,z]=[z,a];near=Math.max(near,a);far=Math.min(far,z);}
  assert.ok(near<=far);const hit=sim.traceSurface(origin,direction,60);
  assert.ok(hit&&Math.abs(hit.distance-near)<.025,b.id+' has a phantom collision in front of its setback');facadeRays++;
 }
}
record('horizontal street rays reach actual recessed facades without old full-box collisions',facadeRays);
function aabb(g){const c=Math.abs(Math.cos(g.rotation[1])),s=Math.abs(Math.sin(g.rotation[1]));return{x0:g.position[0]-(g.size[0]*c+g.size[2]*s)/2,x1:g.position[0]+(g.size[0]*c+g.size[2]*s)/2,z0:g.position[2]-(g.size[2]*c+g.size[0]*s)/2,z1:g.position[2]+(g.size[2]*c+g.size[0]*s)/2};}
let pavingPairs=0;
for(const b of CITY_BUILDINGS.filter(b=>/^market-(front|gate)-/.test(b.id))){const foundation=aabb(CITY_COLLIDERS.find(g=>g.id===b.id+'-sidewalk')),strip=aabb(STREET_COLLIDERS.find(g=>g.id==='street-'+b.id+'-pavement'));const area=Math.max(0,Math.min(foundation.x1,strip.x1)-Math.max(foundation.x0,strip.x0))*Math.max(0,Math.min(foundation.z1,strip.z1)-Math.max(foundation.z0,strip.z0));assert.ok(area<1e-5,b.id+' has duplicate coplanar pavement area');pavingPairs++;}
record('generic parcel pavements do not overlap authored lower-city strips',pavingPairs);
let laneProps=0;
for(const g of STREET_COLLIDERS){if(g.position[1]-g.size[1]/2>2.5||g.position[1]+g.size[1]/2<.35)continue;const a=aabb(g);if(a.z1< -400||a.z0>48)continue;assert.ok(a.x1<=-205||a.x0>=-195,g.id+' obstructs the 10 m lower carriageway');laneProps++;}
record('street props preserve a 10 m lower-city vehicle corridor',laneProps);
const result={status:'passed',date:'2026-10-18',checks,geometry:{buildings:CITY_BUILDINGS.length,physicalBuildingTiers:tierCount,cityColliders:CITY_COLLIDERS.length,streetColliders:STREET_COLLIDERS.length},architecture:architecture.stats,streetLife:street.stats,characters:{planned:2,browserEvidence:'qa/city-3.3-browser-assets.json',source:'dist/assets/characters/manifest.json'},limits:['Facade microdetails and thin railings use conservative solid building envelopes, not room-scale interiors.','Static rays validate authored contact geometry, not unrestricted pedestrian pathfinding.','Full scene GI must be rebaked after the changed massing.']};
writeFileSync(new URL('./city-3.3-geometry.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
architecture.dispose();street.dispose();
