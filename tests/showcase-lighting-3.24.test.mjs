import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {SHOWCASE_LIGHTING,showcaseIrradiance,installShowcaseLighting} from '../dist/showcase-lighting.js';
import {buildStreetDisplay,DISPLAY_RECIPES} from '../dist/street-display.js';
import {createCrosstownStreetEdge} from '../dist/city-street-edge.js';
import {buildUrbanArchitecture} from '../dist/urban-architecture.js';
import {buildStreetLife} from '../dist/street-life.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';
import {countVisibleGeometry} from '../dist/city-render-budget.js';
import {createEnvironment} from '../dist/city-environment.js';
import {RoadsterSim} from '../dist/physics.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';

const sha=b=>createHash('sha256').update(b).digest('hex'),checks=[];
const check=async(name,fn)=>{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS '+name);};
const baseline=JSON.parse(readFileSync(new URL('../qa/fixtures/showcase-baseline-3.24.json',import.meta.url)));
const protocol=JSON.parse(readFileSync(new URL('../qa/render-budget-comparison-3.5.json',import.meta.url)));
const ceiling=JSON.parse(readFileSync(new URL('../qa/exterior-baseline-3.5.json',import.meta.url)));

await check('Each sealed shallow display has a mounted source and only its opaque pieces receive it',()=>{
  let receiverParts=0;
  for(const recipe of DISPLAY_RECIPES)for(const door of [false,true])for(const variant of [0,1]){
    const pieces=[],summary=buildStreetDisplay((kind,size,x,y,out,tint,_variance,_geometry,_tile,_rotation,light)=>pieces.push({kind,size,x,y,out,tint,light}),{width:4.6,height:2.7,sill:.38,recipe,variant,door});
    const lamps=pieces.filter(p=>p.kind==='lamp'),glass=pieces.find(p=>p.kind==='shopGlass');
    assert.equal(lamps.length,1);assert.equal(lamps[0].light,undefined);assert.equal(glass.light,null);
    const source=summary.light,lens=lamps[0];assert.ok(Math.abs(source.position[0]-lens.x)<1e-9);assert.equal(source.position[2],lens.out);
    assert.ok(lens.y-lens.size[1]/2-source.position[1]>0&&lens.y-source.position[1]<.02,'Emitter just below its visible lens');
    assert.ok(source.span[0]<lens.size[0]/2);assert.equal(source.cool,recipe==='workshop');
    for(const p of pieces){assert.ok(p.out-p.size[2]/2>=-.62&&p.out+p.size[2]/2<=.01);if(p.light){assert.ok(['displayBack','displayWood','displayGoods','displayFrame'].includes(p.kind));assert.equal(p.light,source);receiverParts++;}}
  }
  const edge=createCrosstownStreetEdge(),sources=edge.finishes.filter(p=>p.material==='display-lamp');
  assert.equal(sources.length,edge.finishes.filter(p=>p.material==='display-glazing').length);
  assert.ok(edge.finishes.every(p=>p.material));assert.ok(edge.finishes.filter(p=>p.material==='display-glazing').every(p=>!p.showcaseLight));
  assert.ok(edge.finishes.some(p=>p.showcaseLight?.cool));assert.ok(edge.finishes.some(p=>p.showcaseLight&&!p.showcaseLight.cool));
  return {recipeVariants:16,receiverParts,crosstownSources:sources.length,recessDepthM:.62};
});

await check('Local diffuse obeys receiver orientation, downward emission and bounded distance',()=>{
  const light={position:[0,3,0],span:[.8,0,0],cool:false},near=showcaseIrradiance([0,2,0],[0,1,0],light),far=showcaseIrradiance([0,0,0],[0,1,0],light);
  assert.ok(near.every((v,k)=>v>far[k]&&v>0));
  assert.deepEqual(showcaseIrradiance([0,4,0],[0,-1,0],light),[0,0,0]);
  assert.deepEqual(showcaseIrradiance([0,2,0],[0,-1,0],light),[0,0,0]);
  assert.deepEqual(showcaseIrradiance([0,2,0],[0,1,0],null),[0,0,0]);
  for(const d of [0,1e-10,.01,.18,1,5])assert.ok(showcaseIrradiance([0,3-d,0],[0,1,0],{...light,span:[0,0,0]}).every(v=>Number.isFinite(v)&&v<=SHOWCASE_LIGHTING.intensityCd/SHOWCASE_LIGHTING.minimumDistanceM**2));
  const geometry=new THREE.BoxGeometry();assert.equal(installShowcaseLighting(THREE,geometry,[{},{}]),0);assert.equal(geometry.getAttribute('showcaseEmitter'),undefined);geometry.dispose();
  return {near,far,scope:SHOWCASE_LIGHTING.scope};
});

const savedFetch=globalThis.fetch;
globalThis.fetch=async url=>{try{const b=readFileSync(url);return{ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return{ok:false};}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
const geometry=new RoadsterSim().getWorldGeometry(),environment=createEnvironment(scene,renderer,geometry,camera);await environment.ready;

await check('Full-city receiver buffers are finite, aligned to visible sources and zero elsewhere',()=>{
  const materials=new Set(),positions=[],lights=new Map();let receiverCount=0,zeroCount=0,attributeBytes=0,unlitBatches=0;
  scene.traverse(o=>{
    if(!o.isInstancedMesh)return;
    if(o.material.name==='Urban / small practical light'||o.material.name==='City / confined display shelf lamp')for(let i=0;i<o.count;i++)positions.push([o.instanceMatrix.array[i*16+12],o.instanceMatrix.array[i*16+13],o.instanceMatrix.array[i*16+14]]);
    if(!o.material.userData.showcaseLighting)return;materials.add(o.material);
    const emitter=o.geometry.getAttribute('showcaseEmitter'),span=o.geometry.getAttribute('showcaseSpan');
    if(!emitter){assert.equal(span,undefined);assert.deepEqual(o.material.defaultAttributeValues.showcaseEmitter,[0,0,0,0]);assert.deepEqual(o.material.defaultAttributeValues.showcaseSpan,[0,0,0,0]);unlitBatches++;return;}
    assert.equal(emitter.count,o.count);assert.equal(span.count,o.count);attributeBytes+=emitter.array.byteLength+span.array.byteLength;
    assert.ok([...emitter.array,...span.array].every(Number.isFinite));
    for(let i=0;i<o.count;i++){
      const offset=i*4;if(emitter.array[offset+3]===0){zeroCount++;assert.ok([...emitter.array.slice(offset,offset+4),...span.array.slice(offset,offset+4)].every(v=>v===0));continue;}
      assert.equal(emitter.array[offset+3],SHOWCASE_LIGHTING.intensityCd);assert.ok([0,1].includes(span.array[offset+3]));
      const p=Array.from(emitter.array.slice(offset,offset+3)),position=[o.instanceMatrix.array[i*16+12],o.instanceMatrix.array[i*16+13],o.instanceMatrix.array[i*16+14]];
      assert.ok(Math.hypot(...p.map((v,k)=>v-position[k]))<8,'Receiver escapes its authored shallow cabinet');
      lights.set(p.map(v=>v.toFixed(3)).join(','),p);receiverCount++;
    }
  });
  for(const p of lights.values())assert.ok(positions.some(q=>Math.hypot(q[0]-p[0],q[2]-p[2])<.001&&q[1]-p[1]>.012&&q[1]-p[1]<.022),'No visible lamp immediately above '+p);
  assert.equal(lights.size,185+createCrosstownStreetEdge().finishes.filter(p=>p.material==='display-lamp').length);
  assert.ok(receiverCount>5000&&unlitBatches>100);assert.ok(attributeBytes<1_100_000,'Sparse attributes must not allocate buffers across the entire city');
  return {materials:materials.size,visibleSources:lights.size,receiverCount,zeroCount,unlitBatches,attributeBytes};
});

await check('Day/night and quality changes preserve one shader term and distinct composed program keys',()=>{
  const rows=[],keys=new Map();
  for(const quality of ['balanced','high','ultra','balanced'])for(const weather of ['clear-day','wet-night','clear-day']){
    environment.setQuality(quality);environment.setWeatherPreset(weather);const materials=new Set();scene.traverse(o=>{if(o.material?.userData.showcaseLighting)materials.add(o.material);});
    for(const m of materials){
      const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms)};m.onBeforeCompile(shader,renderer);
      assert.equal((shader.fragmentShader.match(/vec3 showcaseNormal=/g)||[]).length,1);assert.equal((shader.vertexShader.match(/attribute vec4 showcaseEmitter;/g)||[]).length,1);
      assert.ok(shader.fragmentShader.includes('BRDF_Lambert(material.diffuseColor)'));assert.ok(shader.fragmentShader.includes('if(vShowcaseEmitter.w>0.)'));
      assert.ok(!shader.fragmentShader.includes('totalEmissiveRadiance+=showcase'));assert.ok(shader.fragmentShader.includes('max(showcaseDirection.y,0.)'));
      const key=m.customProgramCacheKey();assert.ok(key.includes(SHOWCASE_LIGHTING.version));assert.ok(key.includes(weather==='wet-night'?'night-atlas':'day-sh'));
      const id=quality+'|'+weather+'|'+m.name;if(keys.has(id))assert.equal(keys.get(id),key,'Roundtrip must keep an equivalent cache key');else keys.set(id,key);
      assert.ok(m.emissive.r===0&&m.emissive.g===0&&m.emissive.b===0,'Opaque contents must not become self emissive');
    }
    rows.push({quality,weather,materials:materials.size});
  }
  return {variants:rows,scope:'Real environment material callbacks and cache keys, including CSM/exterior/transport injection. Native GPU compilation and appearance are separate browser checks.'};
});

await check('Original external night bake inputs and complete city remain byte-identical',()=>{
  const anchors=environment.getPracticalLightAnchors(),anchorSHA256=sha(JSON.stringify(anchors)),geometrySHA256=sha(canonicalGeometryJSON(geometry)),rows=[];
  for(const folder of ['night-irradiance','night-direct-irradiance']){
    const m=JSON.parse(readFileSync(new URL('../dist/assets/'+folder+'/manifest.json',import.meta.url)));
    assert.equal(m.anchorSHA256,anchorSHA256);assert.equal(m.geometryCanonicalSHA256,geometrySHA256);
    for(const file of ['dist/city-night-transport.js','dist/night-direct-transport.js'].filter(file=>m.sourceHashes[file]))assert.equal(sha(readFileSync(new URL('../'+file,import.meta.url))),m.sourceHashes[file]);
    for(const v of m.volumes)assert.equal(sha(readFileSync(new URL('../dist/assets/'+folder+'/'+v.file,import.meta.url))),v.sha256);
    rows.push({folder,originalIdentity:m.identity,anchorSHA256,geometrySHA256});
  }
  return {bakes:rows,scope:'Shelf lights are local to authored opaque contents and absent from existing street-light anchors; original baked data is retained, not regenerated or duplicated.'};
});

const routeRoot=new THREE.Group(),architecture=buildUrbanArchitecture(THREE,routeRoot,CITY_BUILDINGS),street=buildStreetLife(THREE,routeRoot);await Promise.all([architecture.ready,street.ready]);
await check('Original architecture is unchanged apart from 185 shelf lenses; fifteen view budgets hold',()=>{
  const h=createHash('sha256');
  for(const mesh of architecture.group.children.filter(m=>!m.name.includes(' / lamp / ')).sort((a,b)=>a.name.localeCompare(b.name))){h.update(mesh.name);for(const array of [mesh.instanceMatrix.array,mesh.instanceColor?.array,mesh.geometry.attributes.position.array,mesh.geometry.index?.array])if(array)h.update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));}
  assert.equal(h.digest('hex'),baseline.nonLampArchitectureSHA256);assert.equal(architecture.stats.drawBatches,baseline.architecture.drawBatches);assert.equal(architecture.stats.instances-baseline.architecture.instances,185);assert.equal(architecture.stats.triangles-baseline.architecture.triangles,185*12);
  const camera=new THREE.PerspectiveCamera(52,16/9,.1,1800),views={};let time=1;
  for(const quality of ['balanced','high','ultra','balanced']){
    architecture.setQuality(quality);street.setQuality(quality);views[quality]=protocol.views.map(view=>{camera.position.set(...view.position);camera.lookAt(...view.lookAt);camera.updateMatrixWorld(true);time+=1;architecture.update(time,camera.position);street.update(time,camera.position);return{view:view.id,...countVisibleGeometry(THREE,routeRoot,camera)};});
  }
  for(const quality of ['balanced','high','ultra'])for(const row of views[quality]){
    const old=baseline.views[quality].find(v=>v.view===row.view),limit=ceiling.views[quality].find(v=>v.view===row.view);
    assert.equal(row.drawCalls,old.drawCalls);assert.equal(row.shadowDrawCalls,old.shadowDrawCalls);assert.equal(row.shadowTriangles,old.shadowTriangles);
    assert.ok(row.triangles<=old.triangles*1.01);assert.ok(row.drawCalls<=limit.drawCalls&&row.triangles<=limit.triangles*1.10);if(quality==='balanced')assert.ok(row.drawCalls<300&&row.triangles<650000);
  }
  return {baselineCommit:baseline.sourceCommit,allocatedDrawBatches:architecture.stats.drawBatches,addedLenses:185,addedTriangles:2220,showcaseAttributeBytes:architecture.stats.showcaseAttributeBytes,geometryMiBBefore:baseline.architecture.geometryMiB,geometryMiBAfter:architecture.stats.geometryMiB,views,scope:'Architecture and existing street furnishings. Full rendered scene and target frame rate require native browser measurement.'};
});

globalThis.fetch=savedFetch;architecture.dispose();street.dispose();const resources=new Set();scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])resources.add(m);});for(const resource of resources)resource.dispose?.();
const files=['dist/showcase-lighting.js','dist/street-display.js','dist/urban-architecture.js','dist/city-street-edge.js','dist/city-environment.js'];
const report={version:'3.24',status:'passed',createdAt:new Date().toISOString(),checks,sourceHashes:Object.fromEntries(files.map(file=>[file,sha(readFileSync(new URL('../'+file,import.meta.url)))])),limits:[SHOWCASE_LIGHTING.scope,'The light is authored, not measured photometry. The existing building envelopes remain closed; this does not implement enterable shops.','Numerical/material and geometry checks do not establish GPU compile, visual legibility or native frame-rate acceptance.']};
writeFileSync(new URL(`../qa/showcase-lighting-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
