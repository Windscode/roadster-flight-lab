import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {createEnvironment} from '../dist/city-environment.js';
import {createCityPracticalLights,rankCityPracticalAnchors,CITY_PRACTICAL_LIGHT_BUDGET} from '../dist/city-practical-lights.js';
import {createNightCityLighting} from '../dist/night-city-lighting.js';
import {createNightOccluders,makeNightBounceSources,createNightBounceEvaluator,evaluateNightCoefficients} from '../dist/city-night-transport.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';

const sha=b=>createHash('sha256').update(b).digest('hex'),checks=[],evidence={};
const pass=name=>{checks.push({name,status:'passed'});console.log('PASS:',name);};
const fetchAsset=async url=>{const b=readFileSync(url);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
globalThis.fetch=fetchAsset;
const geometry=new RoadsterSim().getWorldGeometry(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),
  renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
camera.position.set(-202.6,2.15,-393);camera.lookAt(-198.5,4,-324);camera.updateMatrixWorld();
const environment=createEnvironment(scene,renderer,geometry,camera);await environment.ready;
const anchors=environment.getPracticalLightAnchors(),manifest=JSON.parse(readFileSync('dist/assets/night-irradiance/manifest.json'));
assert.equal(manifest.geometryCanonicalSHA256,sha(canonicalGeometryJSON(geometry)));
assert.equal(manifest.anchorSHA256,sha(JSON.stringify(anchors)));
let bytes=0,coefficients=0;
for(const v of manifest.volumes){
  const buffer=readFileSync('dist/assets/night-irradiance/'+v.file);assert.equal(buffer.length,v.bytes);assert.equal(sha(buffer),v.sha256);
  const[nx,nz]=v.size,ny=manifest.heights.length;assert.equal(buffer.length,nx*nz*ny*6*8);assert.ok(Math.max(nx,nz,ny*6)<=256,'within the WebGL2 minimum 3D texture size');
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    let valid;
    for(let axis=0;axis<6;axis++){
      const i=(((axis*ny+y)*nz+z)*nx+x)*8,a=THREE.DataUtils.fromHalfFloat(buffer.readUInt16LE(i+6));
      assert.ok(a===0||a===1);if(axis===0)valid=a;else assert.equal(a,valid);
      for(let c=0;c<3;c++){const value=THREE.DataUtils.fromHalfFloat(buffer.readUInt16LE(i+c*2));assert.ok(Number.isFinite(value)&&value>=0);if(!valid)assert.equal(value,0);coefficients++;}
    }
  }bytes+=buffer.length;
}
assert.ok(bytes<4*1024*1024);pass('Night assets match current fixture/geometry identities, preserve nonnegative directional values and stay within the 4 MiB / WebGL2 texture budget');
evidence.nightField={identity:manifest.identity,bytes,coefficients,layout:manifest.volumes.map(v=>({id:v.id,spacing:v.step,dimensions:[...v.size,30]}))};

const occluders=createNightOccluders(geometry),sources=makeNightBounceSources(anchors,occluders),evaluator=createNightBounceEvaluator(sources,occluders);
assert.equal(sources.length,manifest.bounceSources);
let blocked=0;
for(const p of [[-200,.6,-392],[-203,2.4,-264],[-190.1,2.4,-370],[-200,12,-264]]){
  const actual=evaluator.evaluate(p),open=evaluator.evaluate(p,{occlusion:false});blocked+=actual.blocked;
  actual.coefficients.forEach((value,i)=>assert.ok(value>=0&&value<=open.coefficients[i]+1e-12,'occlusion must not add a negative-lobe artefact'));
  for(const n of [[0,1,0],[1,0,0],[-1,0,0],[Math.SQRT1_2,Math.SQRT1_2,0]]){
    const c=evaluateNightCoefficients(actual.coefficients,n),unoccluded=evaluateNightCoefficients(open.coefficients,n);c.forEach((value,k)=>assert.ok(value>=0&&value<=unoccluded[k]+1e-12));
  }
}
assert.ok(blocked>0);
assert.deepEqual(createNightBounceEvaluator([],occluders).evaluate([-200,2,-264]).coefficients,new Array(18).fill(0));
const p=[-200,.6,-392],reference=evaluator.evaluate(p).coefficients,v=manifest.volumes[1],data=readFileSync('dist/assets/night-irradiance/'+v.file),x=(p[0]-v.min[0])/v.step[0],z=(p[2]-v.min[1])/v.step[1];
for(let axis=0;axis<6;axis++)for(let c=0;c<3;c++){
  const index=(((axis*manifest.heights.length)*v.size[1]+z)*v.size[0]+x)*8+c*2,stored=THREE.DataUtils.fromHalfFloat(data.readUInt16LE(index)),wanted=reference[axis*3+c];
  assert.ok(Math.abs(stored-wanted)<=Math.max(1e-7,wanted*.001));
}
pass('Fixture-to-surface-to-probe transport is finite, rejects occluded energy, has zero output with no fixtures, and agrees with packed probe values');
evidence.transport={blockedTestSegments:blocked,bounceSources:sources.length,packedProbe:{position:p,maximumRelativeQuantization:.001},scope:'Numerical transport and storage, not GPU appearance'};

const night=createNightCityLighting({fetchAsset});await night.ready;night.setEnabled(true);assert.equal(night.uniforms.nightFieldReady.value,1);
night.setQuality('balanced');assert.equal(night.stats.routeSpacingMetres,8);assert.equal(night.uniforms.nightRouteField.value.image.width,55);
night.setQuality('high');assert.equal(night.stats.routeSpacingMetres,4);assert.equal(night.uniforms.nightRouteField.value.image.width,109);
night.setEnabled(false);assert.equal(night.uniforms.nightFieldReady.value,0);
const shader={vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}};night.inject(shader);
assert.equal((shader.fragmentShader.match(/textureLod\(field/g)||[]).length,3);assert.ok(!shader.fragmentShader.includes('reflectedLight.directDiffuse*='));
pass('Balanced uses the coarser field, 3D sampling uses three explicit-LOD reads per field, and day mode contributes no night bounce or direct-light multiplier');

const lightScene=new THREE.Scene(),vehicle=new THREE.Group();lightScene.add(vehicle);vehicle.position.set(-200,.7,-345);
const lights=createCityPracticalLights(lightScene,anchors);lights.setVehicleRoot(vehicle);lights.setEnabled(true);lights.configure('high');
for(let i=0;i<180;i++){lights.update(i/60,camera.position,camera);lights.wantsShadowUpdate(i/60);}
const before=lights.stats.selected.map(a=>a.id).sort(),gainBefore=lights.stats.selected.reduce((n,a)=>n+a.gain,0);
assert.ok(before.length===3&&gainBefore>2.95);
vehicle.position.set(200,30,350);
for(let i=180;i<360;i++){lights.update(i/60,camera.position,camera);lights.wantsShadowUpdate(i/60);}
assert.deepEqual(lights.stats.selected.map(a=>a.id).sort(),before,'fixed-camera pool must not follow separated vehicle');
const updatesBefore=lights.stats.updates;
for(let i=360;i<420;i++){lights.update(i/60,camera.position,camera);lights.wantsShadowUpdate(i/60);}
assert.equal(lights.stats.updates,updatesBefore,'stationary paused scene must not regenerate identical shadow maps');
const pausedRedundantShadowUpdates=lights.stats.updates-updatesBefore;
let minGain=3,maxMaps=0;
for(let i=420;i<840;i++){
  camera.position.z=-393+(i-420)/60*4;camera.lookAt(-198.5,4,camera.position.z+69);camera.updateMatrixWorld();
  lights.update(i/60,camera.position,camera);lights.wantsShadowUpdate(i/60);minGain=Math.min(minGain,lights.stats.selected.reduce((n,a)=>n+a.gain,0));maxMaps=Math.max(maxMaps,lights.stats.shadowMaps);
}
assert.ok(minGain>1.65,'routine handoffs must not dim the entire pool at once');assert.ok(maxMaps<=CITY_PRACTICAL_LIGHT_BUDGET.high.street+CITY_PRACTICAL_LIGHT_BUDGET.high.heads);
const symmetric=[-20,20].map(z=>({position:[0,7,z],target:[0,0,z],intensity:1500,range:28,role:'street'}));
assert.equal(rankCityPracticalAnchors(symmetric,{x:0,y:2,z:0},{direction:{x:0,y:0,z:1}})[0].index,1);
assert.equal(rankCityPracticalAnchors(symmetric,{x:0,y:2,z:0},{direction:{x:0,y:0,z:-1}})[0].index,0);
pass('Fixed-camera pool is vehicle-independent, responds to view direction, keeps overlapping light during handoff and does not refresh static paused shadows');
evidence.practicalPool={baselineCameraIds:before,maximumHighShadowMaps:maxMaps,minimumSumOfGainsDuring4mpsCameraTravel:minGain,pausedRedundantShadowUpdates,pausedVerifiedIntervalS:1,maximums:CITY_PRACTICAL_LIGHT_BUDGET};
lights.dispose();

const paths=['dist/city-environment.js','dist/city-practical-lights.js','dist/city-frontage-design.js','dist/city-night-transport.js','dist/night-city-lighting.js','dist/road-surface-material.js','dist/street-life.js','dist/urban-architecture.js','dist/visual-presets.js','scripts/bake-night-city.mjs','tests/city-lighting-3.10.test.mjs'];
const report={status:'passed',checks,evidence,sourceHashes:Object.fromEntries(paths.map(p=>[p,sha(readFileSync(p))])),limits:[
  'Actual 3.9 IAB images supplied by the user were inspected. This report does not contain 3.10 GPU pixels or motion/FPS acceptance.',
  'Night diffuse transport is one stationary surface bounce with representative envelope albedos; it does not include dynamic car occlusion or fine facade lightmaps.',
  'The preserved physical city and tyre/flight models are independent of these material/light changes.']};
writeFileSync('qa/city-lighting-3.11.json',JSON.stringify(report,null,2)+'\n');
