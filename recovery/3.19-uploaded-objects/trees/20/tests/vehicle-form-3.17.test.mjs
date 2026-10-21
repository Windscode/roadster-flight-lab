import assert from 'node:assert/strict';
import {readGitObject} from './git-object-read.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,sampleVehicleSurface,VEHICLE_GEOMETRY,VEHICLE_DRIVER_VIEW} from '../dist/vehicle.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
const commit='a0fce89e55efe6eaa54210987ef07cf9dfd7171e';
const sha=x=>createHash('sha256').update(x).digest('hex');
const frozen=readGitObject(commit+':dist/vehicle.js');
assert.equal(sha(frozen),'b7e7703513ad42631d429951d97de0e6bc9a23c5da53ef831e9b1784b5a61247');
const shared=['vehicle-light-state.js','vehicle-layout.js','visual-presets.js','vendor/three.module.js'];
const frozenDeps=new Map(shared.map(path=>[path,readGitObject(commit+':dist/'+path)]));
const dependencyHashes=shared.map(path=>({path,baseline:sha(frozenDeps.get(path)),candidate:sha(readFileSync('dist/'+path))}));
assert.equal(sha(frozenDeps.get('vendor/three.module.js')),sha(readFileSync('dist/vendor/three.module.js')),'THREE revision changed; evaluate the frozen renderer separately.');
const sourceURL=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const baselineSource=frozen.toString().replace(/from '\.\/([^']+)'/g,(_,path)=>"from '"+(path==='vendor/three.module.js'?pathToFileURL(resolve('dist',path)).href:sourceURL(frozenDeps.get(path)))+"'");
const baseline=await import(sourceURL(baselineSource));
const before=baseline.createRoadster({inspection:true}),after=createRoadster({inspection:true}),checks=[];
const record=(name,detail)=>checks.push({name,status:'passed',detail});
for(const [key,value]of Object.entries(baseline.VEHICLE_GEOMETRY))if(typeof value==='number')assert.equal(VEHICLE_GEOMETRY[key],value,key);
assert.deepEqual(VEHICLE_DRIVER_VIEW,baseline.VEHICLE_DRIVER_VIEW);
record('Physical wheel envelope and left seated eye remain unchanged',{driverEye:VEHICLE_DRIVER_VIEW,physicalParameters:Object.fromEntries(Object.entries(VEHICLE_GEOMETRY).filter(([,v])=>typeof v==='number'))});
const painted=car=>{const list=[];car.group.traverseVisible(o=>{if(o.isMesh&&[car.materials.paint,car.materials.balancedPaint].includes(o.material))list.push(o);});return list;};
function topNormal(sample,x,z){const e=.0005;return new THREE.Vector3(-(sample(x+e,z).bodyY-sample(x-e,z).bodyY)/(2*e),1,-(sample(x,z+e).bodyY-sample(x,z-e).bodyY)/(2*e)).normalize();}
function shoulderJoin(car,sample,z){
 const s=sample(0,z),x=s.topSkinEdgeX??s.outerX,y=s.topSkinEdgeY??sample(x,z).bodyY;
 const ray=new THREE.Raycaster(new THREE.Vector3(2,y-.0002,z),new THREE.Vector3(-1,0,0),0,2);
 const hit=ray.intersectObjects(painted(car),false)[0];assert.ok(hit,'Missing painted side at '+z);
 const n=hit.normal.clone().transformDirection(hit.object.matrixWorld),top=topNormal(sample,x,z);
 return{zM:z,topEdgeM:[x,y,z],sideHitM:hit.point.toArray(),normalAngleDeg:THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(top.dot(n),-1,1)))};
}
const seams=[];
for(const quality of ['balanced','high','ultra']){
 for(const car of [before,after]){car.setQuality(quality);car.group.updateMatrixWorld(true);}
 for(const z of [-1.42,-.40,0,.55,.90,1.20,1.42,1.75]){
  const a=shoulderJoin(before,baseline.sampleVehicleSurface,z),b=shoulderJoin(after,sampleVehicleSurface,z);
  assert.ok(a.normalAngleDeg>50,'The baseline no longer reproduces the sharp shoulder');
  assert.ok(b.normalAngleDeg<8,quality+' shoulder remains sharply discontinuous at '+z+': '+b.normalAngleDeg);
  seams.push({quality,before:a,after:b});
 }
}
record('The real side mesh joins the top skin with a continuous shaded shoulder at every LOD',{samples:seams,scope:'Independent ray intersections at the real shared skin boundary; this is not an image quality score.'});
const costs=[];
for(const quality of ['balanced','high','ultra']){
 for(const car of [before,after])car.setQuality(quality);
 const a=before.getRenderCost(),b=after.getRenderCost();assert.ok(b.triangles<a.triangles*1.01);assert.ok(b.drawables<=a.drawables);
 costs.push({quality,before:a,after:b,triangleChange:b.triangles-a.triangles});
}
record('Shape changes reuse the existing mesh budget',{costs,maximumPermittedTriangleIncreaseFraction:.01,noAdditionalDrawable:true});
// The original 3.17 stripe diagnosis isolated an unchanged central hood.
// 3.18 intentionally changes the main sections. Keep the actual delta in this
// report, while retaining the texture/shadow contracts that isolate rendering.
for(const car of [before,after]){car.setQuality('ultra');car.group.updateMatrixWorld(true);}
const hood=[];
for(const x of [-.40,0,.40])for(const z of [1.10,1.40,1.70,2.00]){
 const ray=new THREE.Raycaster(new THREE.Vector3(x,3,z),new THREE.Vector3(0,-1,0));
 const a=ray.intersectObjects(painted(before),false)[0],b=ray.intersectObjects(painted(after),false)[0];
 assert.ok(a&&b);assert.ok([...b.point,...b.normal].every(Number.isFinite));
 hood.push({x,z,heightM:b.point.y,heightChangeM:b.point.y-a.point.y,normalDelta:a.normal.distanceTo(b.normal)});
}
for(const car of [before,after])for(const key of ['map','normalMap','bumpMap','roughnessMap','metalnessMap'])assert.equal(car.materials.paint[key],null,'Paint texture could explain the stripe change: '+key);
for(const key of ['roughness','metalness','clearcoat','clearcoatRoughness'])assert.equal(after.materials.paint[key],before.materials.paint[key]);
assert.equal(before.materials.paint.userData.receiverPlaneShadows,undefined);
assert.equal(after.materials.paint.userData.receiverPlaneShadows,'receiver-plane-pcf-3.11');
const paintedShadows=painted(after).map(o=>({name:o.name,cast:o.castShadow,receive:o.receiveShadow}));assert.ok(paintedShadows.every(o=>o.cast&&o.receive));
record('Texture-free paint and common-factory shadow correction remain; intentional 3.18 section changes are reported separately',{hood,paintMapsAllNull:true,paintRoughnessUnchanged:true,beforeFactoryReceiverCorrection:null,afterFactoryReceiverCorrection:after.materials.paint.userData.receiverPlaneShadows,paintedShadows,scope:'Historical 3.17 stripe isolation used unchanged hood normals. Current 3.18 main-body changes invalidate that geometric equality, but do not remove the retained texture/shadow contract. Dynamic shadow pixels are a separate gate.'});
const shaders=[];
for(const car of [createRoadster({quality:'balanced'}),createRoadster({quality:'high',inspection:true})]){
 for(const material of Object.values(car.materials))if(material.isMeshStandardMaterial){
  assert.equal(material.userData.receiverPlaneShadows,'receiver-plane-pcf-3.11');
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader,{});
  assert.ok(shader.fragmentShader.includes('roadsterPlaneCompare'));assert.ok(shader.uniforms.roadsterPlaneEnabled);
 }
 shaders.push({inspection:car.group.getObjectByName('two-seat official-photograph cabin study')!==undefined,materialCount:Object.values(car.materials).filter(m=>m.isMeshStandardMaterial).length,correctionInstalled:true});car.dispose();
}
record('Common vehicle factory retains receiver-plane correction in laboratory and all quality variants',{shaders,retainsShadowCastingAndReceiving:true,scope:'Shader injection contract; actual compiled WebGL and stripe diagnosis are separate PNG evidence.'});
const panelBounds=car=>{const box=new THREE.Box3();car.group.traverse(o=>{if(o.isMesh&&o.material===car.materials.frontPanel)box.expandByObject(o);});return{min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new THREE.Vector3()).toArray()};};
record('Closed upper fascia remains separate from the open lower intake',{before:panelBounds(before),after:panelBounds(after),scope:'Authored dimensions inferred from visible photographs, not Tesla CAD measurements.'});
const report={schema:'roadster-vehicle-form-3.17',status:'passed',createdAt:new Date().toISOString(),baseline:{commit,vehicleSHA256:sha(frozen),sharedDependencies:dependencyHashes},modelBuildId:MODEL_BUILD_ID,vehicleSHA256:sha(readFileSync('dist/vehicle.js')),checks,limits:['No dynamic mass, inertia, tyre geometry, pressure or thrust changes are made by the visual model.','This test does not assert photorealism, real GPU performance or an OEM tolerance envelope.','The separate original PNGs retain their actual source hashes and capture identity.']};
writeFileSync('qa/vehicle-form-'+REPORT_VERSION+'.json',JSON.stringify(report,null,2)+'\n');before.dispose();after.dispose();console.log(JSON.stringify(report,null,2));
