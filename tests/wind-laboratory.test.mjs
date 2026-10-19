import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createWindLaboratory} from '../dist/wind-laboratory.js';
import {WIND_LAB_GEOMETRY,WIND_LAB_SPAWN,WIND_LAB_DIMENSIONS} from '../dist/wind-lab-data.js';
import {RoadsterSim} from '../dist/physics.js';

const results=[],profiles={};
const test=(name,fn)=>{const start=performance.now();fn();results.push({name,status:'PASS',ms:Math.round((performance.now()-start)*100)/100});console.log('PASS: '+name);};
const sim=new RoadsterSim({}, {world:'windlab'}),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.07,200),lab=createWindLaboratory(scene,null,camera,sim.getWorldGeometry());
const find=name=>lab.group.getObjectByName(name);
const close=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);

test('The rendered collision solids match actual laboratory physics transforms',()=>{
  const actual=new Map(sim.getWorldGeometry().map(g=>[g.id,g])),visual=new Map();
  lab.group.updateMatrixWorld(true);const matrix=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
  lab.group.traverse(o=>{if(!o.isInstancedMesh)return;for(const item of o.userData.colliders||[]){assert.ok(!visual.has(item.id),'duplicate visual collider');o.getMatrixAt(item.instance,matrix);matrix.premultiply(o.matrixWorld);matrix.decompose(p,q,s);visual.set(item.id,{position:p.toArray(),quaternion:q.toArray(),size:s.toArray()});}});
  assert.equal(actual.size,WIND_LAB_GEOMETRY.length);assert.equal(visual.size,actual.size);assert.equal(sim.worldType,'windlab');
  for(const [id,g]of actual){const v=visual.get(id);assert.ok(v,id);for(const key of ['position','size','quaternion'])g[key].forEach((value,i)=>close(value,v[key][i]));}
  assert.ok(Object.isFrozen(WIND_LAB_GEOMETRY));assert.ok(WIND_LAB_GEOMETRY.every(g=>g.size.every(v=>Number.isFinite(v)&&v>0)&&g.position.every(Number.isFinite)));
});

test('The physical floor, roof and clear test volume use one metre-based datum',()=>{
  assert.deepEqual(WIND_LAB_SPAWN.position,[0,.74,0]);
  assert.deepEqual([WIND_LAB_DIMENSIONS.width,WIND_LAB_DIMENSIONS.length],[70,110]);
  const floor=sim.traceSurface({x:0,y:10,z:0},{x:0,y:-1,z:0},20),roof=sim.traceSurface({x:0,y:10,z:0},{x:0,y:1,z:0},30);
  assert.ok(floor&&roof);close(floor.point.y,0);close(roof.point.y,24.1);
  const min=WIND_LAB_DIMENSIONS.workingBounds.min,max=WIND_LAB_DIMENSIONS.workingBounds.max;
  for(const g of WIND_LAB_GEOMETRY){if(g.kind==='floor')continue;const overlaps=g.size.every((size,i)=>g.position[i]+size/2>min[i]+1e-7&&g.position[i]-size/2<max[i]-1e-7);assert.equal(overlaps,false,g.id+' intrudes into the declared clear volume');}
  assert.equal(sim.geometry.some(g=>g.id==='ground'),false,'city ground leaked into wind laboratory');
});

test('All qualities keep finite geometry and a bounded scene budget without reallocating meshes',()=>{
  const ids=[];lab.group.traverse(o=>{if(o.geometry)ids.push(o.uuid+':'+o.geometry.uuid);});
  for(const quality of ['balanced','high','ultra','balanced']){
    lab.setQuality(quality);lab.update({windVelocity:{x:0,y:0,z:12}},.1);profiles[quality]={...lab.stats.liveScene,shadowSize:lab.stats.renderBudget.shadowSize,tracers:lab.stats.prescribedFlow.tracers};
    const after=[];lab.group.traverse(o=>{if(!o.geometry)return;after.push(o.uuid+':'+o.geometry.uuid);for(const attribute of Object.values(o.geometry.attributes))assert.ok(attribute.array.every(Number.isFinite),quality+' '+o.name+' has nonfinite attributes');});
    assert.deepEqual(after,ids);assert.ok(lab.stats.liveScene.activeDistanceBatches<=40);assert.ok(lab.stats.liveScene.activeDistanceTriangles<35000);assert.equal(lab.stats.renderBudget.shadowCascades,1);assert.equal(lab.stats.renderBudget.pointLights,0);
  }
  assert.equal(profiles.balanced.tracers,44);assert.equal(profiles.high.tracers,100);assert.equal(profiles.ultra.tracers,160);
  assert.ok(profiles.balanced.activeDistanceTriangles<profiles.high.activeDistanceTriangles);
});

test('Flow is passive advection of the given velocity and stops at zero physical time',()=>{
  const flow=find('passive tracers of the prescribed uniform velocity — not CFD'),rotors=find('prescribed wind instrument fan rotors'),bounds=WIND_LAB_DIMENSIONS.flowBounds;
  lab.setQuality('ultra');lab.update({windVelocity:{x:4,y:2,z:-7}},.1);const before=flow.geometry.attributes.position.array.slice(),fanBefore=rotors.instanceMatrix.array.slice();
  lab.update({windVelocity:{x:4,y:2,z:-7}},0);assert.deepEqual(flow.geometry.attributes.position.array,before);assert.deepEqual(rotors.instanceMatrix.array,fanBefore);
  lab.update({windVelocity:{x:4,y:2,z:-7}},.05);const next=flow.geometry.attributes.position.array;
  for(let i=0;i<160;i++){
    const delta=[];for(let axis=0;axis<3;axis++){const v=[4,2,-7][axis],min=bounds.min[axis],max=bounds.max[axis],span=max-min,expected=min+((before[i*6+axis]-min+v*.05)%span+span)%span;close(next[i*6+axis],expected,4e-6);assert.ok(next[i*6+axis]>=min-1e-6&&next[i*6+axis]<=max+1e-6);assert.ok(next[i*6+3+axis]>=min-1e-6&&next[i*6+3+axis]<=max+1e-6);delta.push(next[i*6+axis]-next[i*6+3+axis]);}
    const cross=new THREE.Vector3(...delta).cross(new THREE.Vector3(4,2,-7));assert.ok(cross.length()<3e-5,'a clipped tracer changed the prescribed wind direction');
  }
  lab.update({windVelocity:{x:0,y:0,z:0}},.1);assert.equal(flow.visible,false);assert.equal(lab.stats.prescribedFlow.speedMps,0);
  lab.setFlowVisible(false);lab.update({windVelocity:{x:9,y:0,z:0}},.1);assert.equal(flow.visible,false);assert.equal(lab.stats.prescribedFlow.tracers,0);
  lab.setFlowVisible(true);lab.update({windVelocity:{x:9,y:0,z:0}},0);assert.equal(flow.visible,true);
});

test('Commanded pose display reads target position/quaternion without modifying simulation state',()=>{
  const target=find('commanded pose reference only'),position={x:4,y:8,z:-3},quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(.31,-.24,1.4));
  const telemetry={holdPositionTarget:position,holdQuaternionTarget:{...quaternion.toJSON?.()}};
  telemetry.holdQuaternionTarget={x:quaternion.x,y:quaternion.y,z:quaternion.z,w:quaternion.w};const original=JSON.stringify(telemetry);
  lab.update(telemetry,0);assert.equal(target.visible,true);assert.deepEqual(target.position.toArray(),[4,8,-3]);close(Math.abs(target.quaternion.dot(quaternion)),1);assert.equal(JSON.stringify(telemetry),original);
  lab.setTargetPose(null);assert.equal(target.visible,false);lab.update(telemetry,0);assert.equal(target.visible,false);
  lab.setTargetPose(undefined);lab.update(telemetry,0);assert.equal(target.visible,true);
  lab.setTargetPose({position,quaternion:{x:0,y:0,z:0,w:0}});assert.equal(target.visible,false);lab.setTargetPose(undefined);
});

test('A single stable-direction studio shadow obeys profile cadence and quality changes',()=>{
  lab.setQuality('balanced');const key=find('laboratory broad overhead key approximation');
  assert.equal(lab.wantsShadowUpdate(0,{x:0,y:.74,z:0}),true);assert.equal(lab.wantsShadowUpdate(.02,{x:0,y:.74,z:0}),false);assert.equal(lab.wantsShadowUpdate(.06,{x:0,y:.74,z:0}),true);
  const direction=key.target.position.clone().sub(key.position).normalize();
  assert.equal(lab.wantsShadowUpdate(.07,{x:14,y:20,z:18}),true);close(direction.dot(key.target.position.clone().sub(key.position).normalize()),1);
  for(const [q,size]of [['high',1536],['ultra',2048],['balanced',1024]]){lab.setQuality(q);assert.equal(key.shadow.mapSize.x,size);assert.equal(lab.wantsShadowUpdate(.071,{x:14,y:20,z:18}),true);}
  assert.equal(lab.stats.environmentCapture.captures,0,'Node guard attempted a GPU capture');
});

test('Failed indoor reflection capture restores renderer and foreign visibility state',()=>{
  const existingTarget={name:'previous render target'},viewport=new THREE.Vector4(8,12,200,100),scissor=new THREE.Vector4(2,3,90,80),state={target:existingTarget,face:3,mip:2,viewport:viewport.clone(),scissor:scissor.clone(),scissorTest:true};
  const renderer={isWebGLRenderer:true,capabilities:{getMaxAnisotropy:()=>4},xr:{enabled:true},shadowMap:{autoUpdate:true,needsUpdate:true},toneMapping:THREE.ACESFilmicToneMapping,autoClear:false,compile(){},getRenderTarget:()=>state.target,getActiveCubeFace:()=>state.face,getActiveMipmapLevel:()=>state.mip,getViewport:v=>v.copy(state.viewport),getScissor:v=>v.copy(state.scissor),getScissorTest:()=>state.scissorTest,setViewport:v=>state.viewport.copy(v),setScissor:v=>state.scissor.copy(v),setScissorTest:v=>state.scissorTest=v,setRenderTarget:(target,face,mip)=>Object.assign(state,{target,face,mip}),getClearColor(){throw new Error('intentional offline PMREM failure');}};
  const s=new THREE.Scene(),outside=new THREE.Group();s.add(outside);const env=new THREE.Texture();s.environment=env;const instance=createWindLaboratory(s,renderer,new THREE.PerspectiveCamera());
  assert.match(instance.stats.environmentCapture.status,/unavailable/);assert.equal(instance.stats.environmentCapture.captures,0);assert.equal(s.environment,env);assert.equal(outside.visible,true);
  assert.equal(state.target,existingTarget);assert.equal(state.face,3);assert.equal(state.mip,2);assert.deepEqual(state.viewport,viewport);assert.deepEqual(state.scissor,scissor);assert.equal(state.scissorTest,true);assert.equal(renderer.xr.enabled,true);assert.equal(renderer.autoClear,false);assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.shadowMap.needsUpdate,true);assert.equal(renderer.toneMapping,THREE.ACESFilmicToneMapping);
  instance.dispose();assert.deepEqual(s.children,[outside]);env.dispose();
});

test('Disposal releases owned GPU resources once and leaves shared arrow geometry untouched',()=>{
  const ownedGeometries=new Set(),ownedMaterials=new Set(),ownedTextures=new Set(),counts=new Map(),arrow=find('prescribed wind direction datum');
  lab.group.traverse(o=>{if(o.geometry&&o!==arrow.line&&o!==arrow.cone)ownedGeometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){ownedMaterials.add(m);if(m.map)ownedTextures.add(m.map);}});
  for(const object of [...ownedGeometries,...ownedMaterials,...ownedTextures]){counts.set(object,0);object.addEventListener('dispose',()=>counts.set(object,counts.get(object)+1));}
  let sharedDisposals=0;arrow.line.geometry.addEventListener('dispose',()=>sharedDisposals++);arrow.cone.geometry.addEventListener('dispose',()=>sharedDisposals++);
  lab.dispose();lab.dispose();for(const count of counts.values())assert.equal(count,1);assert.equal(sharedDisposals,0);assert.equal(scene.children.length,0);assert.equal(scene.background,null);assert.equal(scene.fog,null);
});

const sourceFiles=['dist/wind-lab-data.js','dist/wind-laboratory.js','tests/wind-laboratory.test.mjs'],sourceHashes=Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]));
writeFileSync(new URL('../qa/wind-laboratory-3.7.json',import.meta.url),JSON.stringify({version:'3.7',generatedAt:new Date().toISOString(),scope:'Node geometry, actual static physics raycasts, passive tracer math and render-state failure handling. No browser images, real GPU compilation, reflection success-path image validation or FPS measurement.',tests:results,sourceHashes,physicalSolids:WIND_LAB_GEOMETRY.length,profiles},null,2)+'\n');
console.log(`Wind laboratory: ${results.length} checks passed.`);
