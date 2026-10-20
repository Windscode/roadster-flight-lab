import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {partitionCityGeometry} from './city-geometry-scope.mjs';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';
import {createEnvironment} from '../dist/city-environment.js';
import {countVisibleGeometry,CITY_RENDER_PRESETS} from '../dist/city-render-budget.js';

// Geometry and program-lifecycle checks use real Three objects with no DOM or
// graphics context. They deliberately do not report an achieved GPU frame rate.
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{const b=readFileSync(url);return {ok:true,json:async()=>JSON.parse(b.toString('utf8')),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
const checks=[],record=(name,data={})=>checks.push({name,status:'passed',...data});
const comparison=JSON.parse(readFileSync(new URL('./render-budget-comparison-3.5.json',import.meta.url))),sim=new RoadsterSim(),geometry=sim.getWorldGeometry();
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(52,16/9,.1,1800),renderer={getDrawingBufferSize:v=>v.set(1600,900)};
const environment=createEnvironment(scene,renderer,geometry,camera);await environment.ready;
const environmentMaterials=new Set();scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.isMeshStandardMaterial)environmentMaterials.add(m);});
let disposedPrograms=0;environmentMaterials.forEach(m=>m.addEventListener('dispose',()=>disposedPrograms++));
const actual={},lightingVariants=[];let time=1,coldStart=null;
function checkLightingVariant(quality,night){
  let staticMaterials=0;
  for(const material of environmentMaterials){
    assert.equal(material.defines.CSM_CASCADES,CITY_RENDER_PRESETS[quality].shadowCascades);
    const variant=material.userData.cityLightingVariant,shader={vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}};
    assert.equal(variant.quality,quality);assert.equal(variant.night,night);material.onBeforeCompile(shader,renderer);
    const source=shader.vertexShader+'\n'+shader.fragmentShader;
    assert.ok(shader.uniforms.CSM_cascades);
    assert.equal(shader.fragmentShader.includes('vec3 giField('),!night&&quality!=='balanced','Daytime SH must use only the selected daytime fragment variant');
    assert.equal(shader.vertexShader.includes('vec3 giField('),!night&&quality==='balanced','Balanced daytime still evaluates the unchanged SH field at vertices');
    assert.equal(source.includes('uniform highp sampler2DArray giCity,giStreet'),!night,'Disabled daytime transport must have no night-program sampler declarations');
    assert.equal(shader.fragmentShader.includes('uniform sampler2D probeSunDepth'),!night&&quality!=='balanced');
    assert.equal(shader.fragmentShader.includes('uniform sampler2D giAO'),quality!=='balanced','High and ultra retain contact AO in both weather variants');
    assert.equal(shader.fragmentShader.includes('uniform highp sampler3D nightFieldAtlas'),night,'The retained night bounce uses one city/route atlas sampler only at night');
    assert.equal(shader.fragmentShader.includes('uniform highp sampler3D stationaryFieldAtlas'),night&&variant.isStatic,'Static night direct light has its separate one-atlas sampler');
    assert.equal(source.includes('vec3 nightReadField('),night);assert.equal(source.includes('vec3 stationaryReadField('),night&&variant.isStatic);
    for(const oldName of ['nightCityField','nightRouteField','stationaryCityField','stationaryRouteField']){assert.ok(!(oldName in shader.uniforms));assert.ok(!source.includes(oldName),'Old two-texture bindings must not survive atlas compilation');}
    if(night){
      assert.equal(shader.uniforms.nightFieldReady.value,1);assert.ok(shader.uniforms.nightFieldAtlas.value.isData3DTexture);
      if(variant.isStatic){staticMaterials++;assert.equal(shader.uniforms.stationaryFieldReady.value,1);assert.ok(shader.uniforms.stationaryFieldAtlas.value.isData3DTexture);}
    }else assert.equal(shader.uniforms.giReady.value,1);
  }
  if(night)assert.ok(staticMaterials>0,'This scene must exercise the stationary direct-light variant');
  lightingVariants.push({quality,weather:night?'wet-night':'clear-day',materialCount:environmentMaterials.size,staticNightMaterials:staticMaterials,scope:'Actual material shader-source bindings; GPU linking and active-uniform arrays are gated separately'});
}
for(const quality of ['balanced','high','ultra','balanced']){
  const disposedBeforeQuality=disposedPrograms;environment.setQuality(quality);const profile=CITY_RENDER_PRESETS[quality];
  assert.ok(disposedPrograms-disposedBeforeQuality>=environmentMaterials.size,'Each quality switch must independently retire old CSM program states');
  assert.equal(environment.stats.shadowCascades,profile.shadowCascades);
  assert.equal(scene.children.filter(o=>o.isDirectionalLight).length,profile.shadowCascades);
  assert.equal(scene.children.filter(o=>o.type==='CubeCamera').length,quality==='balanced'?0:1);
  assert.equal(environment.stats.indirectLighting.evaluation,profile.giMode);
  checkLightingVariant(quality,false);
  for(const night of [true,false]){const before=disposedPrograms;environment.setWeatherPreset(night?'wet-night':'clear-day');assert.ok(disposedPrograms-before>=environmentMaterials.size,'Changing weather transport must independently retire cached uniform tables');checkLightingVariant(quality,night);}
  assert.equal(environment.stats.nightIndirectLighting.routeSpacingMetres,quality==='balanced'?8:4);
  assert.equal(environment.stats.nightIndirectLighting.runtimeTextureReadsPerFragment,3);assert.equal(environment.stats.nightIndirectLighting.maximumTransitionReads,6);
  assert.equal(environment.stats.nightDirectLighting.routeSpacingMetres,quality==='balanced'?8:4);
  assert.equal(environment.stats.nightDirectLighting.maximumAdditionalTextureReads,3);assert.equal(environment.stats.nightDirectLighting.maximumTransitionTextureReads,6);
  for(const field of [environment.stats.nightIndirectLighting,environment.stats.nightDirectLighting]){assert.equal(field.activeFieldSamplers,1);assert.equal(field.realTimeLightsAdded,0);assert.equal(field.atlasGPUBytes,quality==='balanced'?1373760:3149280);assert.ok(field.atlasCacheBytes<=4523040,'Only coarse and fine atlas copies may be cached per field');}
  const rows=[];
  for(const view of comparison.views){
    camera.position.set(...view.position);camera.lookAt(...view.lookAt);camera.updateMatrixWorld(true);environment.update(time+=1,camera.position);assert.equal(environment.wantsShadowUpdate(time,camera.position),true);
    const row={view:view.id,...countVisibleGeometry(THREE,environment.root,camera)};rows.push(row);
    if(quality==='balanced'){
      const before=comparison['v3.4'].balanced.find(v=>v.view===view.id);
      assert.ok(row.triangles<before.triangles*.50,view.id+' must halve original triangle submissions');
      assert.ok(row.drawCalls<400,view.id+' exceeds smooth beauty draw budget');
    }
  }
  if(quality==='balanced'&&!coldStart)coldStart=rows;
  actual[quality]=rows;
}
assert.ok(disposedPrograms>=environmentMaterials.size*4,'CSM program properties survive a quality round trip');
record('Repeated quality round trip replaces 1 / 2 / 3 cascade systems and invalidates disposed CSM uniform caches',{disposedMaterialProgramStates:disposedPrograms});
record('Balanced allocates no cube camera and evaluates daytime SH at vertices; mutually exclusive weather programs retain contact AO and one atlas each for night bounce/direct, with unchanged 3-read / 6-transition-read budgets',{variants:lightingVariants,sourceBindingChecksOnly:true,activeSamplerAndGpuDrawGate:'Separate exact-source/offline reflection and actual browser program diagnostics'});
record('Five authored city views halve baseline triangles with fewer than 400 beauty submissions',{views:actual.balanced});
camera.position.set(-200,3,-385);camera.lookAt(-200,4,-280);time+=1;environment.update(time,camera.position);
assert.equal(environment.wantsShadowUpdate(time,camera.position),true);
assert.equal(environment.wantsShadowUpdate(time+.008,camera.position),false);
assert.equal(environment.wantsShadowUpdate(time+.017,camera.position),false);
assert.equal(environment.wantsShadowUpdate(time+.034,camera.position),true);
assert.equal(environment.wantsShadowUpdate(time+.035,new THREE.Vector3(400,12,180)),true);
record('Balanced shadow cadence caps at 30 Hz and refreshes immediately after a teleport');
for(const floor of geometry.filter(g=>g.kind==='floor')){
  const visible=environment.root.getObjectByName(floor.id);assert.ok(visible);assert.equal(visible.position.y,floor.position[1]+floor.size[1]/2);assert.equal(visible.userData.renderDetail,'mass');
  assert.ok(visible.geometry.attributes.position.count>100);camera.position.set(0,500,0);environment.update(time+=1,camera.position);assert.equal(visible.visible,true);
}
record('Tessellated ground remains visible at 500 m and exactly matches the existing physical floor top');
const geometrySHA256=createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
const canonicalSHA256=createHash('sha256').update(canonicalGeometryJSON(geometry)).digest('hex');
const geometryScope=partitionCityGeometry(geometry),retainedGeometryCanonicalSHA256=createHash('sha256').update(canonicalGeometryJSON(geometryScope.legacy)).digest('hex');
assert.equal(canonicalSHA256,JSON.parse(readFileSync(new URL('../dist/assets/irradiance/manifest.json',import.meta.url))).geometryCanonicalSHA256,'The current daylight bake must match the complete current city');
assert.equal(retainedGeometryCanonicalSHA256,JSON.parse(readFileSync(new URL('./city-3.4-browser-assets.json',import.meta.url))).stats.roundedGeometryHash);
record('Original physical city retains its exact canonical identity and the new daylight bake matches the complete current city including retained roadside fixtures',{geometrySHA256,canonicalSHA256,retainedGeometryCanonicalSHA256,newSharedEntities:geometryScope.added.length,newSharedEntityIds:geometryScope.addedIds});
const result={status:'passed',method:'Real Three geometry/frustum and material lifecycle; no GPU context or browser timing',checks,profiles:CITY_RENDER_PRESETS,views:actual,coldStart,limits:['Beauty submission estimates omit the vehicle, externally loaded shrubs and canvas label meshes.','Shadow counts in comparison files are visible casting candidates, not draws measured inside each light frustum.','More spatial batches can increase draws in sparse views while removing many vertices; the total allocated batch count is not a performance gate.','Actual browser FPS, GPU shader execution and visual appearance need a supported browser on target hardware.','The 3.10 daylight field was rebaked against the full current static geometry including the retained 3.9 roadside fixtures. Fine facade details still use averaged closed envelopes; the separate night field is one stationary diffuse surface bounce.']};
writeFileSync(new URL(`./render-budget-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');globalThis.fetch=originalFetch;
console.log(JSON.stringify({status:result.status,checks:checks.map(c=>c.name),balanced:actual.balanced},null,2));
