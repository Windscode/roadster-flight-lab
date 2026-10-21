import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {CITY_BUILDINGS,CITY_CONTINUITY,CITY_ROUTES} from '../dist/city-data.js';
import {CITY_STREETS} from '../dist/city-plan.js';
import {LANDMARK_RESERVATIONS} from '../dist/city-landmarks.js';
import {createEnvironment} from '../dist/city-environment.js';
import {CITY_CONNECTOR_GARDENS} from '../dist/street-life.js';
import {CITY_PRACTICAL_LIGHT_BUDGET,cityPracticalRoadHeight,rankCityPracticalAnchors} from '../dist/city-practical-lights.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';
import {createNightOccluders} from '../dist/city-night-transport.js';
import {createNightDirectEvaluator} from '../dist/night-direct-transport.js';

const checks=[],sha=value=>createHash('sha256').update(value).digest('hex');
const check=async(name,run)=>{try{checks.push({name,status:'passed',detail:await run()});}catch(error){checks.push({name,status:'failed',error:{message:error.message,actual:error.actual,expected:error.expected}});}};
const geometry=new RoadsterSim().getWorldGeometry(),geometryMap=new Map(geometry.map(g=>[g.id,g]));
const before=JSON.parse(readFileSync(new URL('../qa/fixtures/city-lighting-3.15-before.json',import.meta.url)));
const overlapArea=(a,b)=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));

await check('Flush forecourts preserve the entire inherited 28 m grid and all authored surface streets, mouths and landmark reservations',()=>{
  const parcels=new Map(CITY_BUILDINGS.map(b=>[b.id,b])),rows=CITY_CONTINUITY.streetSections.forecourts,conflicts=[];
  const roadRectangles=CITY_STREETS.filter(r=>r.points[0][1]===0).flatMap(road=>road.points.slice(1).map((b,i)=>{
    const a=road.points[i],h=road.width/2;return{id:road.id,rectangle:[Math.min(a[0],b[0])-h,Math.min(a[2],b[2])-h,Math.max(a[0],b[0])+h,Math.max(a[2],b[2])+h]};
  }));
  for(const row of rows){
    const b=parcels.get(row.building),[x,z]=row.cell;if(row.building){assert.ok(b?.id.startsWith('block-'));assert.deepEqual([b.x,b.z],row.cell);}else assert.equal(row.role,'unbuilt original grid forecourt');
    assert.ok(row.rectangle[0]>=x-36&&row.rectangle[2]<=x+36&&row.rectangle[1]>=z-36&&row.rectangle[3]<=z+36);
    assert.equal(Math.abs(x%100),50);assert.equal(Math.abs(z%100),50);
    for(const road of roadRectangles)if(overlapArea(row.rectangle,road.rectangle)>1e-8)conflicts.push({forecourt:row.id,road:road.id});
    for(const r of LANDMARK_RESERVATIONS)assert.equal(overlapArea(row.rectangle,[r.minX,r.minZ,r.maxX,r.maxZ]),0);
    const finish=CITY_CONTINUITY.finishes.find(f=>f.id===row.id);assert.ok(finish);assert.ok(finish.position[1]+finish.size[1]/2<.010);assert.ok(!geometryMap.has(row.id),'An optical finish must not silently add a new physical step');
  }
  assert.ok(rows.length>0);assert.deepEqual(conflicts,[]);
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)assert.ok(overlapArea(rows[i].rectangle,rows[j].rectangle)<1e-8,'Forecourt tiles overlap');
  return{gridRoadWidthM:28,authoredSurfaceStreetsChecked:roadRectangles.length,forecourtAreasM2:rows.reduce((n,r)=>n+(r.rectangle[2]-r.rectangle[0])*(r.rectangle[3]-r.rectangle[1]),0),conflicts,collisionChange:false,limits:'These are flush optical ground finishes. The original physical floor and friction remain the support model; painted boundaries do not prevent off-road driving.'};
});

// Independent Three triangle ray casts use the actual shared OBB transforms,
// not the simulation's contact solver or road-occupancy helper.
const rayMeshes=geometry.map(g=>{const m=new THREE.Mesh(new THREE.BoxGeometry(...g.size),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.position.set(...g.position);m.quaternion.set(...g.quaternion);m.name=g.id;m.updateMatrixWorld(true);return m;});
const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
const downward=(x,z)=>{ray.set(new THREE.Vector3(x,.28,z),down);ray.near=0;ray.far=.7;return ray.intersectObjects(rayMeshes,false)[0];};
await check('The Foundry transition has a continuous physical footway section with open full-width crossings and a clear 18 m carriageway',()=>{
  const samples=[],failures=[];
  for(let z=-116.5;z<138;z+=2)for(const side of [-1,1]){
    const crossing=z< -84||Math.abs(z)<16||Math.abs(z-100)<16,hit=downward(100+side*10.5,z),expected=crossing?0:.12;
    if(!hit||Math.abs(hit.point.y-expected)>.00001)failures.push({position:[100+side*10.5,z],expected,hit:hit?{id:hit.object.name,y:hit.point.y}:null});
    samples.push({x:100+side*10.5,z,kind:crossing?'open crossing':'footway',topM:hit?.point.y});
    const lane=downward(100+side*8.90,z);assert.ok(lane);assert.ok(Math.abs(lane.point.y)<.00001,'A new footway narrows the declared 18 m street');
  }
  assert.deepEqual(failures,[]);
  return{rangeZ_M:[-84,138],approachKeptFlatRangeZ_M:[-117,-84],footwayWidthM:3,footwayHeightM:.12,crossingCentresZ_M:[-100,0,100],crossingOpeningM:32,carriagewayWidthM:18,samples,failures,limits:'Independent vertical triangle intersections at 2 m spacing. The separate 3.14 continuity gate checks full OBB corridor clearance; this is not a tyre-impact or native drive test.'};
});

const originalFetch=globalThis.fetch;globalThis.fetch=async url=>{try{const b=readFileSync(url);return{ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return{ok:false};}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
const environment=createEnvironment(scene,renderer,geometry,camera);await environment.ready;environment.root.updateMatrixWorld(true);
const anchors=environment.getPracticalLightAnchors();

await check('Cross Street seats and trees share conservative physical supports and keep both named and inherited background crossings open',()=>{
  const actual=[],matrix=new THREE.Matrix4(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
  environment.root.traverse(o=>{if(!o.isInstancedMesh||!['BoxGeometry','CylinderGeometry'].includes(o.geometry.type))return;for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);matrix.decompose(position,quaternion,scale);actual.push({type:o.geometry.type,position:position.toArray(),size:scale.toArray()});}});
  const matching=(g,type)=>actual.filter(a=>a.type===type&&a.position.every((v,k)=>Math.abs(v-g.position[k])<.0002));
  const rows=[];for(const [index,garden]of CITY_CONNECTOR_GARDENS.entries()){
    const planter=geometryMap.get('street-connector-planter-'+index),trunk=geometryMap.get('street-connector-trunk-'+index),seat=geometryMap.get('street-connector-seat-'+index);assert.ok(planter&&trunk&&seat);
    assert.ok(matching(planter,'BoxGeometry').some(a=>a.size.every((v,k)=>Math.abs(v-planter.size[k])<.0002)));
    assert.ok(matching(trunk,'CylinderGeometry').some(a=>Math.abs(a.size[1]-trunk.size[1])<.0002&&a.size[0]<=trunk.size[0]&&a.size[2]<=trunk.size[2]));
    for(const g of [planter,trunk,seat]){
      const box=new THREE.Box3().setFromObject(rayMeshes.find(m=>m.name===g.id)),r=[box.min.x,box.min.z,box.max.x,box.max.z];
      assert.equal(overlapArea(r,[-300,-141.5,200,-123.5]),0,'A support enters the unchanged 18 m Cross Street');
      for(const x of [-100,0,100])assert.equal(overlapArea(r,[x-14,-200,x+14,-100]),0,'A support narrows an inherited 28 m cross-road');
    }
    rows.push({garden,physical:[planter.id,trunk.id,seat.id],planterRenderedExactly:true,trunkRenderWithinPhysicalEnvelope:true});
  }
  return{rows,limits:'Supports and trunk geometry are shared with the physical world; foliage remains ordinary non-colliding visual detail. This is not a navigation traversal or screen-quality score.'};
});

await check('Light selection uses the actual road layer; upper and ground lights cannot score their own unrelated floor',()=>{
  const rows=[{p:{x:-200,y:2.15,z:-345},expected:0},{p:{x:230,y:6,z:300},expected:4},{p:{x:400,y:10,z:316},expected:8},{p:{x:400,y:2,z:316},expected:0}];
  for(const row of rows){const y=cityPracticalRoadHeight(row.p,CITY_STREETS,CITY_ROUTES);assert.ok(Math.abs(y-row.expected)<1e-9);row.actual=y;}
  const synthetic=[{id:'ground',position:[0,7,0],target:[0,0,5],surfaceY:0,intensity:1500,practical:true},{id:'upper',position:[0,15,0],target:[0,8,5],surfaceY:8,intensity:1500,practical:true}];
  assert.deepEqual(rankCityPracticalAnchors(synthetic,{x:0,y:10,z:2},{surfaceY:8}).map(r=>r.anchor.id),['upper']);
  assert.deepEqual(rankCityPracticalAnchors(synthetic,{x:0,y:2,z:2},{surfaceY:0}).map(r=>r.anchor.id),['ground']);
  assert.deepEqual(Object.fromEntries(Object.entries(CITY_PRACTICAL_LIGHT_BUDGET).map(([name,p])=>[name,p.street])),{balanced:2,high:3,ultra:4});
  return{rows,unchangedLiveStreetSpotBudgets:{balanced:2,high:3,ultra:4},limits:'The selected layer guides ranking only. Actual spots retain finite cones and shadows; this does not certify every camera or dynamic transition.'};
});

await check('New ramp and arcade lenses have actual physical mounting support; Foundry and portal housings drive physically located finite sources',()=>{
  const ramp=anchors.filter(a=>a.role==='route-rail'),arcade=anchors.filter(a=>a.id.startsWith('forum-arcade-')),foundry=anchors.filter(a=>a.id.startsWith('foundry-avenue-')),rows=[];
  assert.ok(ramp.length&&arcade.length&&foundry.length);assert.equal(new Set(anchors.map(a=>a.id)).size,anchors.length,'Runtime fixture identifiers must be unique');
  for(const a of ramp){const support=geometryMap.get(a.mount.sharedGeometryId);assert.ok(support);const inverse=new THREE.Quaternion(...support.quaternion).invert(),local=new THREE.Vector3(...a.mount.backingCentre).sub(new THREE.Vector3(...support.position)).applyQuaternion(inverse),embed=support.size[1]/2-(local.y-.024);
    assert.ok(embed>.020&&embed<.024);assert.ok(Math.abs(local.x)<1e-8);assert.ok(Math.abs(local.z)<support.size[2]/2-.35);
    const sourceLocal=new THREE.Vector3(...a.position).sub(new THREE.Vector3(...support.position)).applyQuaternion(inverse);assert.ok(sourceLocal.y>support.size[1]/2+.035);
    rows.push({id:a.id,sharedSupport:support.id,backingEmbedM:embed,sourceClearanceAboveRailM:sourceLocal.y-support.size[1]/2});
  }
  for(const a of arcade){ray.set(new THREE.Vector3(...a.position),new THREE.Vector3(0,1,0));ray.near=0;ray.far=.20;const hit=ray.intersectObjects(rayMeshes,false)[0];assert.ok(hit,'Arcade lamp lacks an overhead physical roof');assert.ok(Math.abs(hit.point.y-15.7)<.0001);rows.push({id:a.id,roof:hit.object.name,roofUndersideM:hit.point.y,stack:'lens top 15.620 m = backing bottom; backing top 15.700 m = roof underside'});}
  for(const a of foundry){assert.equal(a.practical,true);assert.equal(a.surfaceY,0);assert.ok(a.target[0]>=91&&a.target[0]<=109);assert.ok(a.position[1]<7.14&&a.position[1]>7.05);}
  const portalLenses=[],portalMetal=[],renderedSteel=[],renderedMasonry=[];
  const renderedBox=(mesh,index)=>{const matrix=mesh.matrixWorld.clone();if(mesh.isInstancedMesh){const local=new THREE.Matrix4();mesh.getMatrixAt(index,local);matrix.multiply(local);}if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();return mesh.geometry.boundingBox.clone().applyMatrix4(matrix);};
  environment.root.traverse(o=>{
    if(o.isMesh&&o.material?.name==='Urban / small practical light')portalLenses.push(o);
    if(o.isMesh&&o.material?.name==='Urban / weathered steel')portalMetal.push(o);
    const rows=o.material?.name==='Urban / weathered steel'?renderedSteel:o.material?.name==='Urban / aged mineral plaster'?renderedMasonry:null;
    if(!rows||!o.isMesh||o.geometry.type!=='BoxGeometry')return;
    for(let i=0;i<(o.isInstancedMesh?o.count:1);i++)rows.push({id:o.name+'#'+i,box:renderedBox(o,i)});
  });
  const overlapVolume=(a,b)=>Math.max(0,Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x))*Math.max(0,Math.min(a.max.y,b.max.y)-Math.max(a.min.y,b.min.y))*Math.max(0,Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z));
  const nightOccluders=createNightOccluders(geometry);
  const portals=[];for(const a of anchors.filter(a=>a.id.startsWith('frontage-'))){
    ray.set(new THREE.Vector3(...a.position),new THREE.Vector3(0,1,0));ray.near=0;ray.far=.025;
    const hit=ray.intersectObjects(portalLenses,false)[0];assert.ok(hit,'A portal source floats beyond its actual rendered lens: '+a.id);
    assert.ok(hit.distance>=.002&&hit.distance<=.012,'Portal emitter must clear the real lamp underside by millimetres');
    const sourceToLens=hit.distance;
    ray.far=.12;const backing=ray.intersectObjects(portalMetal,false)[0];
    assert.ok(backing&&backing.distance>.046&&backing.distance<.057,'The emitted light has no close, actually rendered backing above its lens: '+a.id);
    const lensBox=renderedBox(hit.object,hit.instanceId),backingBox=renderedBox(backing.object,backing.instanceId);
    assert.ok(overlapVolume(lensBox,backingBox)>1e-8,'The lens is not attached to the actual metal backing: '+a.id);
    const sign=renderedSteel.find(row=>row.box.max.y-row.box.min.y>.4&&overlapVolume(row.box,backingBox)>1e-8);
    assert.ok(sign,'The lamp backing has no positive-volume attachment to its sign housing: '+a.id);
    const standoffs=renderedSteel.filter(row=>{
      const height=row.box.max.y-row.box.min.y;
      return height>.1&&height<.3&&row.box.min.y>sign.box.min.y+.4&&overlapVolume(row.box,sign.box)>1e-8;
    }).map(row=>({...row,wall:renderedMasonry.find(wall=>overlapVolume(wall.box,row.box)>1e-8)})).filter(row=>row.wall);
    assert.ok(standoffs.length>=2,'The complete projected sign/lamp assembly lacks two real steel connections into rendered masonry: '+a.id);
    const b=CITY_BUILDINGS.find(b=>b.id===a.building),side=Number(a.id.match(/-(\d+)-\d+$/)[1]),normal=[Math.sin(side*Math.PI/2),0,Math.cos(side*Math.PI/2)],half=Math.abs(normal[0])>.5?b.w/2:b.d/2,
      clearance=p=>(p[0]-b.x)*normal[0]+(p[2]-b.z)*normal[2]-half;
    assert.ok(clearance(a.position)>.05&&clearance(a.target)>.05,'A source/target is inside its closed bake envelope: '+a.id);
    assert.equal(nightOccluders.inside(a.position),false,'An actual door source is inside shared solid geometry: '+a.id);
    const probe=a.target.map((v,k)=>v+normal[k]*(.60-clearance(a.target))),toward=new THREE.Vector3(...a.position).sub(new THREE.Vector3(...probe)),distance=toward.length();toward.divideScalar(distance);
    ray.set(new THREE.Vector3(...probe),toward);ray.near=0;ray.far=distance-.10;
    assert.equal(ray.intersectObjects(rayMeshes,false).length,0,'Independent triangle rays block the intended external door-light receiver: '+a.id);
    const direct=createNightDirectEvaluator([a],nightOccluders).evaluate(probe);
    assert.equal(direct.contributing,1,'The actual night direct field loses this physically external door source: '+a.id);assert.equal(direct.blocked,0);
    portals.push({id:a.id,sourceToActualLensUndersideM:sourceToLens,sourceToActualBackingUndersideM:backing.distance,
      positiveVolumeMountingPath:{lensToBackingM3:overlapVolume(lensBox,backingBox),backingToSignM3:overlapVolume(backingBox,sign.box),
        standoffs:standoffs.map(row=>({steel:row.id,masonry:row.wall.id,signOverlapM3:overlapVolume(row.box,sign.box),masonryOverlapM3:overlapVolume(row.box,row.wall.box)}))},
      sourceClearanceOutsideClosedEnvelopeM:clearance(a.position),targetClearanceOutsideClosedEnvelopeM:clearance(a.target),target:a.target,
      externalReceiver:probe,independentTriangleSegmentClear:true,productionDirectContributions:direct.contributing});
  }
  assert.ok(portals.length>0);
  return{rows,foundrySources:foundry.map(a=>({id:a.id,position:a.position,target:a.target,intensityCd:a.intensity,rangeM:a.range})),portals,limits:'Shared physical support, actual Three lens triangle intersections and authored source placement, not a GPU draw or photometric lamp certification. Fine lens/backplate geometry is exterior render detail.'};
});

// Recompute direct irradiance without the production night transport helper.
// Rays intersect actual Three box triangles; lamp cones are reconstructed from
// the runtime source records. Mean linear RGB below is an authored simulation
// quantity, not measured lux or a perceptual screen-brightness score.
function directSample(position){
  const p=new THREE.Vector3(...position),rgb=[0,0,0];let sources=0,blocked=0;
  for(const a of anchors){const toward=new THREE.Vector3(...a.position).sub(p),distance=toward.length(),range=Math.min(32,a.range||28);if(distance<.1||distance>=range)continue;toward.divideScalar(distance);
    const axis=new THREE.Vector3(...(a.target||[a.position[0],0,a.position[2]])).sub(new THREE.Vector3(...a.position)).normalize(),angle=a.angle||.9,outer=Math.cos(angle),inner=Math.cos(angle*(1-(a.penumbra??.55))),t=Math.max(0,Math.min(1,(-toward.dot(axis)-outer)/(inner-outer)));
    if(t<.0001)continue;ray.set(p,toward);ray.near=0;ray.far=distance-.10;if(ray.intersectObjects(rayMeshes,false).length){blocked++;continue;}
    const incident=(a.intensity||1500)*t*t*(3-2*t)*(1-(distance/range)**4)**2/Math.max(1,distance*distance)*Math.max(0,toward.y),color=new THREE.Color(a.color||0xffd0a2).toArray();
    color.forEach((v,k)=>rgb[k]+=v*incident);sources++;
  }
  return{position,up:rgb,sources,blocked};
}
await check('The previously unlit Foundry, ordinary boulevard and upper avenue samples now receive actual fixture light with independent triangle occlusion',()=>{
  const paths={};for(const [name,oldRows]of Object.entries(before.paths)){const current=oldRows.map(row=>directSample(row.position)),stats=rows=>{const values=rows.map(r=>r.up.reduce((n,v)=>n+v,0)/3).sort((a,b)=>a-b);return{min:values[0],median:values[Math.floor(values.length/2)],zeroBelow001:values.filter(v=>v<.01).length};};paths[name]={before:stats(oldRows),after:stats(current),samples:current};}
  for(const name of ['foundry','background','forum']){assert.equal(paths[name].after.zeroBelow001,0,name+' retains a sampled dark break');assert.ok(paths[name].after.median>paths[name].before.median);}
  return{baselineCommit:before.baselineCommit,baselineSourceHashes:before.sourceHashes,paths,method:'Independent Three triangle rays and reconstructed source cones; headlamps excluded',limitations:['Sparse points do not establish continuous illumination of the whole city.','The terrace endpoint at [280,8.35,300] remains above the last low rail source; do not claim full upper-arrival illumination from these samples.','Weave/crosstown retained samples include some canopy shadows; more light everywhere is not the acceptance goal.','Light values do not substitute for matched raster frames or native route driving.']};
});

const files=['dist/city-continuity.js','dist/city-street-sections.js','dist/city-environment.js','dist/city-practical-lights.js','dist/city-horizon.js','dist/city-frontage-design.js','dist/urban-architecture.js','dist/pavement-surface-material.js','dist/street-life.js','tests/city-quality-3.16.test.mjs'];
const report={schema:'roadster-city-quality-3.16',createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,status:checks.every(c=>c.status==='passed')?'passed':'failed',geometryCanonicalSHA256:sha(canonicalGeometryJSON(geometry)),checks,sourceHashes:Object.fromEntries(files.map(file=>[file,sha(readFileSync(new URL('../'+file,import.meta.url)))])),scope:'Source preservation is checked separately by city-continuity-3.14. This report tests physical/visual boundary separation, independent shared-geometry rays, actual lamp support, road-layer selection and sparse simulated direct-light samples. It cannot certify GPU draw completeness, artistic quality, vehicle route completion or performance.'};
writeFileSync(new URL(`../qa/city-quality-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
globalThis.fetch=originalFetch;const resources=new Set();for(const mesh of rayMeshes){resources.add(mesh.geometry);resources.add(mesh.material);}scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])resources.add(m);});resources.forEach(r=>r.dispose?.());
console.log(JSON.stringify({status:report.status,checks:checks.map(c=>({name:c.name,status:c.status,error:c.error})),geometryCanonicalSHA256:report.geometryCanonicalSHA256},null,2));
assert.equal(report.status,'passed',`See qa/city-quality-${REPORT_VERSION}.json for retained failures`);
