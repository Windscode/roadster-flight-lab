import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster} from '../dist/vehicle.js';
import {createCityPracticalLights} from '../dist/city-practical-lights.js';
import {createShadowMotionTracker} from '../dist/shadow-motion.js';
import {createWindLaboratory} from '../dist/wind-laboratory.js';
import {createEnvironment} from '../dist/city-environment.js';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
const REPORT_VERSION=MODEL_VERSION.split('.').slice(0,2).join('.');

const scene=new THREE.Scene(),car=createRoadster({quality:'high'}),camera=new THREE.PerspectiveCamera(48,16/9,.1,200);
scene.add(car.group,camera);camera.position.set(0,3,-8);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const light=createCityPracticalLights(scene,[{id:'rear-overhead',position:[0,6,-3],target:[0,0,-2],intensity:1200,range:24}]);
light.configure('high');light.setVehicleRoot(car.group);light.setEnabled(true);
const wingPose=deployment=>({deployment,position:{x:0,y:.325+deployment*.30,z:-2.065},incidenceRad:-deployment*.25});
const telemetry={wheelStates:car.wheels.map(w=>({steer:0,rotation:0,suspensionLength:.32})),wing:wingPose(0),sealLipExtensions:Array(20).fill(.074)};
let time=0;const rows=[];
function step(dt=0){
  time+=1/120;car.update(telemetry,dt);light.update(time,camera.position,camera);
  const refresh=light.wantsShadowUpdate(time);
  if(refresh)for(const lamp of light.getLights()){lamp.shadow.updateMatrices(lamp);lamp.shadow.needsUpdate=false;}
  return refresh;
}
for(let i=0;i<180;i++)step();
assert.equal(step(),false,'An unchanged parked vehicle must reuse its depth');
const rootMatrix=car.group.matrixWorld.clone(),wingCasters=[];
car.wing.traverseVisible(o=>{if(o.isMesh&&o.castShadow)wingCasters.push(o);});
assert.ok(wingCasters.length>0,'This counterexample must move actual opaque shadow casters');
car.group.updateMatrixWorld(true);const before=wingCasters.map(o=>o.matrixWorld.clone());
telemetry.wing=wingPose(1);
const wingRefresh=step();car.group.updateMatrixWorld(true);
assert.ok(car.group.matrixWorld.equals(rootMatrix),'Vehicle root is deliberately stationary');
assert.ok(wingCasters.some((o,i)=>!o.matrixWorld.equals(before[i])),'Actual wing caster transforms must change');
rows.push({name:'parked wing deployment',refresh:wingRefresh,wingCasters:wingCasters.length,rootUnchanged:true});
assert.equal(wingRefresh,true,'Wing deployment must refresh practical depth in the same displayed frame');
assert.equal(step(),false,'A settled wing must not create a permanent redraw loop');
const stableRevision=car.group.userData.shadowShapeRevision;
car.setQuality('high');car.setLampMode('off');car.setColor(0x203030);
assert.equal(car.group.userData.shadowShapeRevision,stableRevision,'Unchanged shape and color-only edits must not invalidate depth');
assert.equal(step(),false);
car.setLampMode('low-beam');step();
const exteriorRevision=car.group.userData.shadowShapeRevision;
car.setInteriorView(true);car.setInteriorView(false);
assert.equal(car.group.userData.shadowShapeRevision,exteriorRevision,'A high-quality cabin already present in the depth pass needs no extra refresh');

const beforeLOD=car.group.userData.shadowShapeRevision;
car.setViewBudget(camera,64);assert.equal(car.group.userData.geometryQuality,'balanced');
assert.ok(car.group.userData.shadowShapeRevision>beforeLOD);
assert.equal(step(),true,'A stationary LOD change must retire the previous opaque silhouette');
assert.equal(step(),false);
rows.push({name:'parked display geometry change',refresh:true,profile:car.group.userData.geometryQuality});

// Balanced hides the cockpit and excludes wing/fan/seal microdetail from
// depth. Their animation must not keep a parked car's maps permanently hot.
const balancedRevision=car.group.userData.shadowShapeRevision;
telemetry.suctionEnabled=true;telemetry.sealQuality=1;
const beforeTraverse=car.group.traverse;car.group.traverse=()=>{throw Error('Unexpected full vehicle traversal');};
try{
  for(let frame=0;frame<120;frame++){
    telemetry.wing=wingPose(frame/120);telemetry.steeringCentreDeg=Math.sin(frame)*20;
    telemetry.sealLipExtensions=Array(20).fill(.08+.001*frame);
    assert.equal(step(1/60),false,'Hidden or noncasting articulation must not refresh depth');
  }
}finally{car.group.traverse=beforeTraverse;}
assert.equal(car.group.userData.shadowShapeRevision,balancedRevision);
rows.push({name:'120 animated balanced frames with hidden/noncasting parts',unnecessaryDepthRefreshes:0});
telemetry.suctionEnabled=false;telemetry.sealQuality=0;telemetry.steeringCentreDeg=0;

car.setQuality('high');step();
const sealBefore=car.chamber.root.userData.sealGeometryUpdates;
telemetry.sealLipExtensions=Array(20).fill(.19);
assert.equal(step(),true,'A changed opaque flexible seal must invalidate its depth');
assert.ok(car.chamber.root.userData.sealGeometryUpdates>sealBefore);
assert.equal(step(),false);
rows.push({name:'parked flexible seal',refresh:true});

const tracker=createShadowMotionTracker();
tracker.sample(car.group.position,{shapeRevision:7});
assert.equal(tracker.sample(car.group.position,{shapeRevision:7}).casterChanged,false);
assert.equal(tracker.sample(car.group.position,{shapeRevision:8}).casterChanged,true);

const labScene=new THREE.Scene(),lab=createWindLaboratory(labScene,null,camera,new RoadsterSim({}, {world:'windlab'}).getWorldGeometry());
labScene.add(car.group);lab.setVehicleRoot(car.group);
assert.equal(lab.wantsShadowUpdate(0,car.group.position,telemetry),true);
assert.equal(lab.wantsShadowUpdate(.001,car.group.position,telemetry),false);
telemetry.wing=wingPose(.5);car.update(telemetry,0);
assert.equal(lab.wantsShadowUpdate(.002,car.group.position,telemetry),true,'Laboratory must also use the rendered shape revision');
assert.equal(lab.wantsShadowUpdate(.003,car.group.position,telemetry),false);
rows.push({name:'laboratory sub-idle-interval shape refresh',refresh:true});

const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{try{const b=readFileSync(url);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return {ok:false};}};
try{
  const cityScene=new THREE.Scene(),renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
  const city=createEnvironment(cityScene,renderer,new RoadsterSim().getWorldGeometry(),camera);await city.ready;
  city.setVehicleRoot(car.group);city.setQuality('high');
  assert.equal(city.wantsShadowUpdate(0,car.group.position,telemetry),true);
  assert.equal(city.wantsShadowUpdate(.001,car.group.position,telemetry),false);
  telemetry.wing=wingPose(.75);car.update(telemetry,0);
  assert.equal(city.wantsShadowUpdate(.002,car.group.position,telemetry),true,'Daylight cascades must observe the same rendered shape');
  assert.equal(city.wantsShadowUpdate(.003,car.group.position,telemetry),false);
  rows.push({name:'daylight sub-idle-interval shape refresh',refresh:true});
}finally{globalThis.fetch=originalFetch;}

// No traversal may be added to the per-frame invalidation path. The vehicle
// has a fixed set of articulated roots plus the existing seal-buffer revision.
const traverse=car.group.traverse;car.group.traverse=()=>{throw Error('Unexpected full vehicle traversal');};
try{for(let i=0;i<300;i++)step();}finally{car.group.traverse=traverse;}
rows.push({name:'300 parked updates without full vehicle traversal',updates:300});
lab.dispose();light.dispose();car.dispose();
mkdirSync(`qa/rendering-${REPORT_VERSION}`,{recursive:true});
writeFileSync(`qa/rendering-${REPORT_VERSION}/vehicle-shadow-state.json`,JSON.stringify({status:'passed',scope:'Actual Three.js opaque caster transforms and depth invalidation. No GPU pixel or universal flicker claim.',rows},null,2)+'\n');
console.log('PASS vehicle shadow state: wing, geometry profile, flexible seal, laboratory and bounded idle work');
