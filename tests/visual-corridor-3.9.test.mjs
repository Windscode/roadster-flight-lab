import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {CITY_STREETS,CITY_ROUTE_CORRIDOR} from '../dist/city-plan.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';
import {routeFacingFacade,buildUrbanArchitecture} from '../dist/urban-architecture.js';
import {buildWetReflectionCamera,hideDistantReflectionMeshes,createWetRoadReflection} from '../dist/wet-road-reflection.js';
import {attachRoadSurface} from '../dist/road-surface-material.js';
import {createCityPracticalLights} from '../dist/city-practical-lights.js';
import {CITY_VISUAL_CAPTURE_PROTOCOL} from '../dist/visual-presets.js';

const checks=[],evidence={},test=(name,fn)=>{fn();checks.push({name,status:'passed'});};
test('A 400 m reflection lens retains the main optical settings without inheriting its 2300 m far projection',()=>{
  const source=new THREE.PerspectiveCamera(48,16/9,.08,2300);source.zoom=1.15;source.filmOffset=1.2;
  source.setViewOffset(1920,1080,160,90,1600,900);source.position.set(-200,2,-300);source.lookAt(-205,2,-250);source.updateMatrixWorld();
  const original=source.projectionMatrix.toArray(),result=buildWetReflectionCamera(source),base=result.baseProjection;
  const at=d=>new THREE.Vector3(0,0,-d).applyMatrix4(base).z;
  assert.equal(result.camera.far,400);assert.ok(Math.abs(at(400)-1)<1e-12);assert.ok(at(401)>1);
  assert.ok(new THREE.Vector3(0,0,-600).applyMatrix4(source.projectionMatrix).z<1,'A main-camera far object is not a useful fixture');
  assert.ok(Math.abs(at(.08)+1)<1e-12);assert.deepEqual(source.projectionMatrix.toArray(),original);assert.equal(source.far,2300);
  for(const key of ['fov','aspect','zoom','filmOffset'])assert.equal(result.camera[key],source[key]);assert.deepEqual(result.camera.view,source.view);
  evidence.reflectionLens={mainFarM:source.far,reflectionFarM:result.camera.far,nearM:result.camera.near,lensAndViewOffsetPreserved:true,sourceCameraUnchanged:true};
});
test('Ground-plane clipping remains finite at low clearance, changing heading, pitch and camera roll',()=>{
  let tested=0;
  for(const heading of [0,.8,Math.PI,4.3])for(const pitch of [-.09,0,.12])for(const height of [.17,2,12])for(const roll of [0,.22]){
    const source=new THREE.PerspectiveCamera(48,16/9,.1,2300);source.position.set(-200,height,-300);source.quaternion.setFromEuler(new THREE.Euler(pitch,heading,roll,'YXZ'));source.updateMatrixWorld();
    const reflection=buildWetReflectionCamera(source);assert.ok(reflection);const camera=reflection.camera;
    assert.ok([...camera.projectionMatrix.elements,...camera.projectionMatrixInverse.elements].every(Number.isFinite));
    const reflectedDirection=source.getWorldDirection(new THREE.Vector3());reflectedDirection.y*=-1;
    assert.ok(reflectedDirection.distanceTo(camera.getWorldDirection(new THREE.Vector3()))<1e-12);
    const expectedUp=new THREE.Vector3(0,1,0).applyQuaternion(source.quaternion);expectedUp.y*=-1;assert.ok(camera.up.distanceTo(expectedUp)<1e-12);
    const above=source.position.clone().addScaledVector(source.getWorldDirection(new THREE.Vector3()),80);above.y=2;const below=above.clone();below.y=-2;
    const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    assert.ok(frustum.containsPoint(above),'A known above-ground target disappeared');assert.ok(!frustum.containsPoint(below),'A known below-ground target leaked through the oblique clip');tested++;
  }
  evidence.reflectionClip={cameraConditions:tested,heightM:[.17,12],pitchRad:[-.09,.12],rollRad:[0,.22],aboveGroundRetained:true,belowGroundClipped:true};
});
test('Dedicated radial culling removes far meshes and far instanced batches while preserving near and already-hidden objects',()=>{
  const scene=new THREE.Scene(),origin=new THREE.Vector3(-200,2,-300),geometry=new THREE.BoxGeometry(4,4,4),material=new THREE.MeshStandardMaterial();
  const add=(name,d)=>{const m=new THREE.Mesh(geometry,material);m.name=name;m.position.copy(origin).add(new THREE.Vector3(0,0,d));scene.add(m);return m;};
  const near=add('near',50),far=add('far',600),crossing=add('bound-crossing',401),existingHidden=add('generic-cull',450);existingHidden.visible=false;
  const batch=new THREE.InstancedMesh(geometry,material,2);batch.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-200,2,310));batch.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-204,2,330));scene.add(batch);
  const hidden=hideDistantReflectionMeshes(scene,origin,400);
  assert.ok(near.visible&&crossing.visible);assert.ok(!far.visible&&!batch.visible);assert.ok(!existingHidden.visible);assert.equal(hidden.length,2);
  hidden.forEach(o=>o.visible=true);assert.ok(far.visible&&batch.visible);assert.equal(existingHidden.visible,false);
  evidence.reflectionCull={knownNearM:50,knownFarM:600,farInstancedBatchHidden:true,boundaryCrossingBatchRetained:true,genericHiddenStatePreserved:true};geometry.dispose();material.dispose();
});
function rendererStub(){
  let target={name:'main'},viewport=new THREE.Vector4(0,0,1600,900),scissor=new THREE.Vector4(0,0,1600,900);
  return {xr:{enabled:false},shadowMap:{autoUpdate:false,needsUpdate:true},getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
    getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>false,setViewport:v=>viewport.copy(v),setScissor:v=>scissor.copy(v),setScissorTest(){},
    setRenderTarget:v=>target=v,clear(){},render(){throw Error('controlled framebuffer failure');}};
}
test('A failed reflection pass restores dedicated visibility without reviving the generic hidden set',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300);camera.position.set(-200,2,-300);camera.lookAt(-200,2,-200);
  const far=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshStandardMaterial());far.position.set(-200,2,330);scene.add(far);
  const hidden=far.clone();hidden.visible=false;scene.add(hidden);const renderer=rendererStub(),oldTarget=renderer.getRenderTarget();
  const surface=attachRoadSurface(new THREE.MeshStandardMaterial(),{albedo:new THREE.Texture(),normal:new THREE.Texture(),roughness:new THREE.Texture()}),reflection=createWetRoadReflection(scene,renderer,camera,surface);
  reflection.configure('high');reflection.setEnabled(true);assert.throws(()=>reflection.render(0),/controlled framebuffer/);
  assert.equal(renderer.getRenderTarget(),oldTarget);assert.equal(far.visible,true);assert.equal(hidden.visible,false);assert.equal(surface.uniforms.roadReflectionEnabled.value,0);
  assert.equal(reflection.stats.projectionFarM,400);assert.equal(reflection.stats.distanceCulledMeshes,1);reflection.dispose();far.geometry.dispose();far.material.dispose();
});
test('Connector pavements and fixtures share physics records and stay outside the entire canonical carriageway width',()=>{
  const geometry=new RoadsterSim().getWorldGeometry(),byId=new Map(geometry.map(g=>[g.id,g]));let checked=0;
  assert.equal(CITY_ROUTE_CORRIDOR.legs.length,3);
  for(const solid of CITY_ROUTE_CORRIDOR.solids){
    const physical=byId.get(solid.id);assert.ok(physical,solid.id+' is only visual');assert.deepEqual(physical.size,solid.size);assert.deepEqual(physical.position,solid.position);
    for(const road of CITY_STREETS.filter(s=>s.points[0][1]===0))for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i];if(a[0]!==b[0]&&a[2]!==b[2])continue;
      const vertical=a[0]===b[0],axis=vertical?2:0,across=vertical?0:2,overlap=Math.min(solid.position[axis]+solid.size[axis]/2,Math.max(a[axis],b[axis]))-Math.max(solid.position[axis]-solid.size[axis]/2,Math.min(a[axis],b[axis]));
      if(overlap>1e-8)assert.ok(Math.abs(solid.position[across]-a[across])-solid.size[across]/2>=road.width/2-1e-8,solid.id+' intrudes on '+road.id);
    }
    checked++;
  }
  for(const leg of CITY_ROUTE_CORRIDOR.legs){assert.equal(CITY_ROUTE_CORRIDOR.solids.filter(s=>s.id.startsWith('corridor-'+leg.id+'-walk-')).length,2);assert.ok(CITY_ROUTE_CORRIDOR.lights.some(l=>l.id.startsWith(leg.id)));}
  evidence.corridor={sharedSolids:checked,pavements:CITY_ROUTE_CORRIDOR.solids.filter(s=>s.kind==='corridor-paving').length,lightFixtures:CITY_ROUTE_CORRIDOR.lights.length,legs:CITY_ROUTE_CORRIDOR.legs.map(l=>l.id),completeRoadWidthsClear:true};
});
test('Functional frontage improvements cover every route family and real doorway lights point outside their solid buildings',()=>{
  const families={},faces=[];
  for(const b of CITY_BUILDINGS)for(let side=0;side<4;side++){const f=routeFacingFacade(b,side);if(f){families[f.family]=(families[f.family]||0)+1;faces.push({...f,building:b.id});}}
  assert.deepEqual(Object.keys(families).sort(),['canal','civic','industrial','market']);assert.ok(faces.length>8);
  const kit=buildUrbanArchitecture(THREE,new THREE.Group(),CITY_BUILDINGS);assert.equal(kit.stats.routeFacingFrontages,faces.length);assert.equal(kit.stats.facadePortals,faces.length);
  const doors=kit.lightAnchors.filter(a=>a.role==='door');assert.equal(doors.length,faces.length);
  for(const a of doors){const b=CITY_BUILDINGS.find(b=>b.id===a.building),outside=p=>Math.abs(p[0]-b.x)>b.w/2||Math.abs(p[2]-b.z)>b.d/2;assert.ok(outside(a.position)&&outside(a.target));assert.ok(a.target[1]<a.position[1]);}
  evidence.frontages={families,routeFacingFrontages:faces.length,doorwayAnchors:doors.length,windowBacklights:kit.stats.backlitWindowPanels,roomsOrCrowdsAdded:0};kit.dispose();
});
test('A near road fixture retains a slot when nearby door lights compete for the balanced budget',()=>{
  const scene=new THREE.Scene(),anchors=[{position:[1,3,0],target:[1,0,2],role:'door',range:10,intensity:180},{position:[-1,3,0],target:[-1,0,2],role:'door',range:10,intensity:180},{position:[7,7,0],target:[2,0,3],role:'street',range:29,intensity:1750}];
  const lights=createCityPracticalLights(scene,anchors);lights.configure('balanced');lights.setEnabled(true);for(let i=0;i<90;i++)lights.update(i/60,{x:0,y:2,z:0});
  assert.equal(lights.stats.streetSpots,2);assert.ok(lights.getLights().some(l=>l.position.x===7));assert.ok(lights.getLights().every(l=>l.castShadow));lights.dispose();
});
evidence.captureProtocol={...CITY_VISUAL_CAPTURE_PROTOCOL,actualScreenshots:null,actualFrameTimes:null,reason:'The available cloud browser reports GL_VENDOR/GL_RENDERER Disabled; no graphics driver or real frame was used by these Node checks.'};
const sourcePaths=['dist/city-corridor-plan.js','dist/city-plan.js','dist/city-environment.js','dist/urban-architecture.js','dist/pavement-surface-material.js','dist/road-surface-material.js','dist/city-practical-lights.js','dist/wet-road-reflection.js','dist/vehicle.js','dist/vehicle-inspection.js','dist/visual-presets.js','tests/visual-corridor-3.9.test.mjs'];
const sourceHashes=Object.fromEntries(sourcePaths.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]));
const report={format:'roadster-visual-corridor-3.9',createdAt:new Date().toISOString(),status:'passed',checks,evidence,sourceHashes,limits:['CPU geometry, matrix, shared world and renderer-state contracts only. None establish real image quality, shadow leakage, frame times or steering feel.','Reflection distance culling is conservative per mesh/instanced batch. A sphere crossing 400 m is retained; the rebuilt bounded base projection then receives an oblique near plane.','The original city remains; new micro-materials and small roadside fixtures use the existing daytime diffuse bake as an approximation, with real-time direct shadowing.']};
writeFileSync(new URL('../qa/visual-corridor-3.9.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:checks.length,evidence:{...evidence,captureProtocol:undefined}},null,2));
