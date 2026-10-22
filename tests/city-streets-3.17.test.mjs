import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {CITY_BUILDINGS,CITY_CONTINUITY} from '../dist/city-data.js';
import {CITY_STREETS,CITY_ROUTE_CORRIDOR} from '../dist/city-plan.js';
import {createCrosstownStreetEdge} from '../dist/city-street-edge.js';
import {createEnvironment} from '../dist/city-environment.js';
import {createNightOccluders} from '../dist/city-night-transport.js';
import {createNightDirectEvaluator} from '../dist/night-direct-transport.js';
import {buildUrbanArchitecture} from '../dist/urban-architecture.js';
import {DOWNTOWN_FACADE_STYLES} from '../dist/city-frontage-design.js';
import {CITY_WEATHER_PRESETS} from '../dist/visual-presets.js';
import {partitionCityGeometry,CITY_CHANGES_317_CONTRACT} from '../qa/city-geometry-scope.mjs';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';

const sha=v=>createHash('sha256').update(v).digest('hex'),checks=[];
const check=async(name,fn)=>{try{checks.push({name,status:'passed',detail:await fn()});}catch(error){checks.push({name,status:'failed',error:{message:error.message,actual:error.actual,expected:error.expected,stack:error.stack}});}};
const geometry=new RoadsterSim().getWorldGeometry(),map=new Map(geometry.map(g=>[g.id,g])),edge=createCrosstownStreetEdge();
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{try{const b=readFileSync(url);return{ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return{ok:false};}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
const environment=createEnvironment(scene,renderer,geometry,camera);await environment.ready;environment.root.updateMatrixWorld(true);

await check('Exactly four public street edges and 66 translated lamp supports preserve every other 3.16 physical entity',()=>{
  const p=partitionCityGeometry(geometry),f=CITY_CHANGES_317_CONTRACT;
  assert.equal(edge.frontages.length,4);assert.equal(edge.solids.length,116);assert.equal(f.changed.length,66);assert.equal(f.removed.length,0);
  assert.equal(CITY_BUILDINGS.length,114);assert.equal(CITY_STREETS.length,12);
  assert.deepEqual(f.added.map(g=>g.id),edge.solids.map(g=>g.id));
  for(const {before,after} of f.changed){assert.deepEqual(before.size,after.size);assert.deepEqual(before.quaternion,after.quaternion);assert.equal(before.position[1],after.position[1]);}
  return{baselineCommit:f.sourceCommit,baselineCount:f.baselineCount,currentCount:f.currentCount,addedRaisedSolids:edge.solids.length,movedOriginalLampSupports:f.changed.length,removed:0,frontages:edge.frontages,geometryContract:p.contract};
});

await check('Street-edge visible masses match shared physics and keep full named and inherited road cross sections open',()=>{
  const actual=[],local=new THREE.Matrix4(),world=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),size=new THREE.Vector3();
  environment.root.traverse(mesh=>{if(!mesh.isInstancedMesh||mesh.geometry.type!=='BoxGeometry')return;for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,local);world.multiplyMatrices(mesh.matrixWorld,local);world.decompose(position,rotation,size);actual.push({position:position.toArray(),size:size.toArray()});}});
  const overlap=(a,b)=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  const roads=CITY_STREETS.filter(r=>r.points.every(p=>p[1]===0)).flatMap(r=>r.points.slice(1).map((b,i)=>{const a=r.points[i],h=r.width/2;return{id:r.id,rect:[Math.min(a[0],b[0])-h,Math.min(a[2],b[2])-h,Math.max(a[0],b[0])+h,Math.max(a[2],b[2])+h]};}));
  for(let c=-600;c<=600;c+=100){roads.push({id:'original-grid-x-'+c,rect:[c-14,-620,c+14,620]},{id:'original-grid-z-'+c,rect:[-620,c-14,620,c+14]});}
  const rows=[];
  for(const s of edge.solids){const g=map.get(s.id);assert.ok(g);assert.deepEqual(g.size,s.size);assert.deepEqual(g.position,s.position);
    assert.ok(actual.some(a=>a.position.every((v,k)=>Math.abs(v-g.position[k])<.0003)&&a.size.every((v,k)=>Math.abs(v-g.size[k])<.0003)),'Missing actual rendered shared mass '+s.id);
    const r=[g.position[0]-g.size[0]/2,g.position[2]-g.size[2]/2,g.position[0]+g.size[0]/2,g.position[2]+g.size[2]/2];
    for(const road of roads)assert.equal(overlap(r,road.rect),0,'New street edge intrudes into '+road.id+': '+s.id);
    rows.push({id:s.id,renderMatchesPhysical:true,roadOverlapM2:0});
  }
  return{checkedSolids:rows.length,checkedRoadRectangles:roads.length,originalGridWidthM:28,crosstownWidthM:18,rows,limits:'Closed external shells and actual instanced boxes; this checks road clearance, not native driving behaviour.'};
});

await check('All 25 new canopy sources have an overhead physical canopy and an unblocked intended external receiver',()=>{
  const occluders=createNightOccluders(geometry),anchors=environment.getPracticalLightAnchors().filter(a=>a.id.startsWith('street-edge-'));
  assert.equal(anchors.length,25);const rows=[];
  for(const a of anchors){const canopy=map.get(a.mount.sharedGeometryId);assert.ok(canopy);const underside=canopy.position[1]-canopy.size[1]/2;
    assert.ok(underside-a.position[1]>.045&&underside-a.position[1]<.065);assert.ok(a.position[1]+a.lensSize[1]/2>underside,'The actual lens must attach to the canopy');assert.ok(Math.abs(a.position[0]-canopy.position[0])<.0001);assert.ok(Math.abs(a.position[2]-canopy.position[2])<canopy.size[2]/2);
    assert.equal(occluders.inside(a.position),false,a.id+' source is inside a solid');
    // The authored aim point is the pavement itself, legitimately within the
    // bake's surface exclusion band. Test incoming light 10 cm above that
    // same target rather than declaring a surface aim point an interior lamp.
    const receiver=a.target.map((v,k)=>v+(k===1?.10:0));assert.equal(occluders.inside(receiver),false);
    const sample=createNightDirectEvaluator([a],occluders).evaluate(receiver);assert.equal(sample.blocked,0);assert.equal(sample.contributing,1);
    rows.push({id:a.id,physicalCanopy:canopy.id,sourceToCanopyUndersideM:underside-a.position[1],intensity:a.intensity,rangeM:a.range,surfaceAimPoint:a.target,externalReceiver:receiver});
  }
  assert.equal(environment.getPracticalLightAnchors().filter(a=>a.id.startsWith('frontage-')).length,374);
  return{sources:rows,retainedPortalSources:374,limits:'Finite authored emitter/cone and shared solid ray test; not measured lumens or a full GPU light audit.'};
});

await check('Staggered corridor sources reduce the old direct-light gaps without adding lamps or raising exposure',()=>{
  const before=CITY_CHANGES_317_CONTRACT.corridorLightsBefore,after=CITY_ROUTE_CORRIDOR.lights;
  assert.equal(before.length,after.length);assert.equal(CITY_WEATHER_PRESETS['wet-night'].exposure,1.02);
  const unoccluded={trace:()=>null},sample=anchors=>{const evaluator=createNightDirectEvaluator(anchors,unoccluded),rows=[];for(let x=-78;x<=78;x+=2){const value=evaluator.evaluate([x,.1,-132.5]);rows.push({position:[x,.1,-132.5],up:value.coefficients.slice(6,9),mean:value.coefficients.slice(6,9).reduce((a,b)=>a+b,0)/3});}return rows;};
  const stats=rows=>{const v=rows.map(r=>r.mean).sort((a,b)=>a-b);return{minimum:v[0],median:v[Math.floor(v.length/2)],maximum:v.at(-1),below001:v.filter(v=>v<.01).length};};
  const oldRows=sample(before),newRows=sample(after),old=stats(oldRows),now=stats(newRows);
  assert.ok(now.minimum>1);assert.equal(now.below001,0);assert.ok(old.below001>0);assert.ok(now.maximum<old.maximum);
  return{sourceCount:after.length,before:old,after:now,oldRows,newRows,scope:'Unoccluded analytic corridor fixtures only at identical road-centre points. Not rendered pixels, total scene light, measured lux or all-city continuity.'};
});

await check('Remodelled downtown walls keep real front/return faces with finite normals and reduce full-scene triangle allocation',async()=>{
  const kit=buildUrbanArchitecture(THREE,new THREE.Group(),CITY_BUILDINGS);await kit.ready;
  const original=JSON.parse(readFileSync(new URL('../qa/fixtures/city-architecture-baseline-3.16.json',import.meta.url))),partial=[];
  for(const mesh of kit.group.children){const g=mesh.geometry,index=g.index;if(g.type!=='BoxGeometry'||index?.count!==18)continue;
    const normal=g.getAttribute('normal'),pos=g.getAttribute('position'),axes=new Set();
    for(const v of new Set(index.array)){const n=new THREE.Vector3().fromBufferAttribute(normal,v);assert.ok(Math.abs(n.length()-1)<1e-7);assert.ok([pos.getX(v),pos.getY(v),pos.getZ(v)].every(Number.isFinite));axes.add(n.toArray().join(','));}
    assert.equal(axes.size,3);assert.ok(axes.has('0,0,1'));
    assert.ok(axes.has('1,0,0')&&axes.has('-1,0,0')||axes.has('0,1,0')&&axes.has('0,-1,0'));
    partial.push({batch:mesh.name,instances:mesh.count,indexedFaces:[...axes]});
  }
  assert.ok(partial.length>0);assert.equal(Object.keys(kit.stats.downtownStoreyOrders).length,DOWNTOWN_FACADE_STYLES.length);
  assert.ok(kit.stats.triangles<=original.allocation.triangles);
  const result={fiveOrders:DOWNTOWN_FACADE_STYLES,actualStoreyOrders:kit.stats.downtownStoreyOrders,originalFullArchitecture:original.allocation,currentFullArchitecture:{triangles:kit.stats.triangles,batches:kit.stats.drawBatches},compactBatches:partial,limits:'Only hidden back/cap faces are retired and same-layer backing is merged; original solid cores remain. More spatial/material batches can trade fewer vertices for extra draw calls: the unchanged per-view 400-draw and original triangle budgets are enforced by render-budget-check.mjs. Actual frame visibility, shadows and appearance are separately inspected. Allocated triangles do not establish FPS.'};kit.dispose();return result;
});

await check('Night high/ultra round trips retain live CSM uniform owners instead of disposing every city material',()=>{
  environment.setQuality('high');environment.setWeatherPreset('wet-night');
  const materials=new Set();scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.isMeshStandardMaterial)materials.add(m);});
  let disposed=0;materials.forEach(m=>m.addEventListener('dispose',()=>disposed++));
  const original=new Map([...materials].map(m=>[m,{compile:m.onBeforeCompile,key:m.customProgramCacheKey()}])),rows=[];
  for(const quality of ['ultra','high','ultra','high']){
    environment.setQuality(quality);assert.equal(disposed,0);assert.equal(environment.stats.shadowCascades,1);
    const lights=scene.children.filter(o=>o.isDirectionalLight);assert.equal(lights.length,1);assert.equal(lights[0].intensity,0);assert.equal(lights[0].castShadow,false);
    for(const m of materials){assert.equal(m.onBeforeCompile,original.get(m).compile);assert.equal(m.customProgramCacheKey(),original.get(m).key);assert.equal(m.defines.CSM_CASCADES,1);assert.equal(m.userData.cityLightingVariant.quality,quality);
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};m.onBeforeCompile(shader,renderer);assert.ok(shader.uniforms.CSM_cascades);assert.ok(shader.uniforms.nightFieldAtlas);assert.ok(shader.uniforms.giAO);}
    rows.push({quality,disposedMaterialPrograms:disposed,directionalLights:lights.length,sunShadowMaps:0,fragmentGI:true});
  }
  environment.setWeatherPreset('clear-day');assert.ok(disposed>=materials.size);assert.equal(environment.stats.shadowCascades,2);
  return{materials:materials.size,roundTrips:rows,dayWeatherRetiredPrograms:disposed,limits:'CPU lifecycle and real material hooks only. First-use light-count shader compilation, resized real spot maps and reflection targets still cost time. Native frame-time capture is separate.'};
});

await check('All three transport manifests bind to the current whole physical city',()=>{
  const hash=sha(canonicalGeometryJSON(geometry)),rows=[];
  for(const folder of ['irradiance','night-irradiance','night-direct-irradiance']){const m=JSON.parse(readFileSync(new URL('../dist/assets/'+folder+'/manifest.json',import.meta.url)));assert.equal(m.geometryCanonicalSHA256,hash);for(const v of m.volumes)assert.equal(sha(readFileSync(new URL('../dist/assets/'+folder+'/'+v.file,import.meta.url))),v.sha256);rows.push({folder,geometryCanonicalSHA256:hash,volumes:m.volumes.map(v=>({file:v.file,sha256:v.sha256,bytes:v.bytes}))});}
  return rows;
});

const files=['dist/city-street-edge.js','dist/city-continuity.js','dist/city-corridor-plan.js','dist/city-frontage-design.js','dist/urban-architecture.js','dist/city-environment.js','dist/city-material-lighting.js','dist/visual-presets.js','dist/city-render-budget.js','tests/city-streets-3.17.test.mjs','qa/fixtures/city-changes-3.17.json'];
const report={schema:'roadster-city-streets-3.17',createdAt:new Date().toISOString(),status:checks.every(c=>c.status==='passed')?'passed':'failed',checks,sourceHashes:Object.fromEntries(files.map(f=>[f,sha(readFileSync(new URL('../'+f,import.meta.url)))])),limits:'Numerical geometry/source/material assertions are separate from matched browser pixels, native driving and target-hardware performance. Original 3.16 evidence is retained.'};
writeFileSync(new URL(`../qa/city-streets-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');globalThis.fetch=originalFetch;const resources=new Set();scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])resources.add(m);});resources.forEach(r=>r.dispose?.());console.log(JSON.stringify({status:report.status,checks:checks.map(c=>({name:c.name,status:c.status,error:c.error}))},null,2));if(report.status!=='passed')process.exitCode=1;
