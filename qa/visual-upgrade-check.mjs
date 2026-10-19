import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {createRoadster,VEHICLE_GEOMETRY} from '../dist/vehicle.js';
import {CITY_STREETS} from '../dist/city-plan.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';
import {CITY_BENCHMARK_ROUTE as ROUTE,CITY_WEATHER_PRESETS,VEHICLE_INSPECTION_RIG,chooseVehicleGeometryProfile,vehicleProjectedPixels} from '../dist/visual-presets.js';
import {attachRoadSurface} from '../dist/road-surface-material.js';
import {createCityPracticalLights,CITY_PRACTICAL_LIGHT_BUDGET} from '../dist/city-practical-lights.js';
import {createWetRoadReflection} from '../dist/wet-road-reflection.js';
import {createEnvironment} from '../dist/city-environment.js';

const checks=[],evidence={},test=async(name,fn)=>{await fn();checks.push({name,status:'passed'});};
const sim=new RoadsterSim(),car=createRoadster({quality:'ultra'});
await test('The full benchmark loop follows canonical supported roads and preserves the overall city',()=>{
  const used=new Set(),geometry=sim.getWorldGeometry();let samples=0;
  for(let j=1;j<ROUTE.points.length;j++){
    const a=ROUTE.points[j-1],b=ROUTE.points[j],length=Math.hypot(b[0]-a[0],b[2]-a[2]),steps=Math.ceil(length/3);
    for(let i=0;i<=steps;i++){
      const t=i/steps,x=a[0]+(b[0]-a[0])*t,z=a[2]+(b[2]-a[2])*t;
      const street=CITY_STREETS.find(r=>r.points.slice(1).some((p,k)=>{const q=r.points[k],dx=p[0]-q[0],dz=p[2]-q[2],tt=Math.max(0,Math.min(1,((x-q[0])*dx+(z-q[2])*dz)/(dx*dx+dz*dz)));return Math.hypot(x-q[0]-dx*tt,z-q[2]-dz*tt)<r.width/2-.6;}));
      assert.ok(street,'route point leaves the canonical road');used.add(street.id);
      const hit=sim.traceSurface({x,y:.3,z},{x:0,y:-1,z:0},.6);assert.ok(hit&&Math.abs(hit.point.y)<.10,'route loses ground support');
      const forward={x:(b[0]-a[0])/length,y:0,z:(b[2]-a[2])/length};
      for(const side of [-1,0,1])for(const height of [.45,1.20]){
        const origin={x:x-forward.z*side*1.05,y:height,z:z+forward.x*side*1.05};
        const ceiling=sim.traceSurface(origin,{x:0,y:1,z:0},.03);assert.ok(!ceiling,'benchmark sampled a solid obstacle');
      }
      samples++;
    }
  }
  assert.deepEqual(ROUTE.points[0],ROUTE.points.at(-1));assert.ok(ROUTE.lengthMetres>1100&&ROUTE.lengthMetres<1200);assert.ok(ROUTE.estimatedDurationS>130&&ROUTE.estimatedDurationS<180);
  assert.ok(CITY_BUILDINGS.length>100&&geometry.length>500,'city was reduced to a short course');
  evidence.route={id:ROUTE.id,lengthMetres:ROUTE.lengthMetres,nominalDurationS:ROUTE.estimatedDurationS,sampledCentres:samples,streetIds:[...used],buildings:CITY_BUILDINGS.length,worldSolids:geometry.length};
});
await test('Wing mesh reads the physical deployment exactly and ignores display speed/brake targets',()=>{
  for(const deployment of [0,.23,.60,1]){
    car.update({wing:{deployment},speedKmh:360,brake:1,mode:'hover'},.1);
    assert.equal(car.wing.userData.deployment,deployment);assert.equal(car.wing.position.y,.325+deployment*.30);assert.equal(car.wing.rotation.x,-deployment*.25);
  }
  car.update({wing:{deployment:.34},speedKmh:0,brake:0,mode:'drive'},0);assert.equal(car.wing.userData.deployment,.34);
  sim.setWing({mode:'fixed',deployment:.74});for(let i=0;i<180;i++)sim.step(1/240,{});
  const physical=sim.telemetry().wing;assert.ok(physical.position&&Number.isFinite(physical.incidenceRad));car.update({wing:physical},0);
  assert.deepEqual(car.wing.position.toArray(),[physical.position.x,physical.position.y,physical.position.z]);assert.equal(car.wing.rotation.x,physical.incidenceRad);
  evidence.wing={source:car.wing.userData.source,physicalPosition:physical.position,incidenceRad:physical.incidenceRad,visualTravelMetres:.30,maximumAngleRad:.25,actuatorDynamics:'Owned and tested by physics.js'};
});
await test('Projected footprint and inspection context change actual geometry while preserving wheel state',()=>{
  const camera=new THREE.PerspectiveCamera(50,16/9,.1,1000),before=car.wheels.map(w=>({position:w.assembly.position.toArray(),rotation:w.spin.rotation.toArray()}));
  const costs={};
  for(const [id,z,inspection]of [['distant',80,false],['driving',5,false],['inspection',5,true]]){
    camera.position.set(0,.3,z);camera.lookAt(0,.02,0);camera.updateMatrixWorld();
    car.setViewBudget(camera,1080,{inspection});costs[id]=car.getRenderCost();
  }
  assert.equal(costs.distant.geometryQuality,'balanced');assert.equal(costs.driving.geometryQuality,'high');assert.equal(costs.inspection.geometryQuality,'ultra');
  assert.ok(costs.distant.triangles<costs.driving.triangles&&costs.driving.triangles<costs.inspection.triangles);
  car.wheels.forEach((w,i)=>{assert.deepEqual(w.assembly.position.toArray(),before[i].position);assert.deepEqual(w.spin.rotation.toArray(),before[i].rotation);});
  assert.equal(chooseVehicleGeometryProfile('ultra',680,{inspection:true,previous:'high'}),'high');assert.equal(chooseVehicleGeometryProfile('ultra',680,{inspection:true,previous:'ultra'}),'ultra');
  assert.ok(vehicleProjectedPixels({distance:20,fov:50,height:2160})>vehicleProjectedPixels({distance:20,fov:50,height:1080}));
  evidence.geometryBudgets=costs;evidence.physicalGeometry={wheelbaseMetres:VEHICLE_GEOMETRY.wheelbaseHalf*2,trackMetres:VEHICLE_GEOMETRY.wheelTrackHalf*2,radiusMetres:VEHICLE_GEOMETRY.tyreRadius};
});
await test('Street/headlight pool uses finite shadowed lights at real anchors, with bounded update rate',()=>{
  const scene=new THREE.Scene(),vehicle=new THREE.Group();scene.add(vehicle);vehicle.position.set(-200,.7,-300);
  const anchors=Array.from({length:8},(_,i)=>({position:[-209+i%2*18,7.3,-320+Math.floor(i/2)*14],color:0xffccaa,intensity:1600,range:28}));
  const lights=createCityPracticalLights(scene,anchors);lights.setVehicleRoot(vehicle);lights.setEnabled(true);
  for(const quality of ['balanced','high','ultra']){
    lights.configure(quality);for(let i=0;i<80;i++)lights.update(i/60,{x:-200,y:2,z:-300});
    const budget=CITY_PRACTICAL_LIGHT_BUDGET[quality];assert.ok(lights.stats.streetSpots<=budget.street);assert.equal(lights.stats.headlightSpots,budget.heads);assert.ok(lights.stats.shadowMaps<=budget.street+budget.heads);
    for(const light of lights.getLights()){assert.equal(light.isSpotLight,true);assert.equal(light.castShadow,true);assert.equal(light.shadow.autoUpdate,false);assert.ok(light.distance<=66&&light.angle<1);}
    assert.equal(lights.wantsShadowUpdate(10),true);assert.equal(lights.wantsShadowUpdate(10+1/240),false);
  }
  lights.setEnabled(false);assert.equal(lights.getLights().length,0);evidence.lightBudgets=CITY_PRACTICAL_LIGHT_BUDGET;lights.dispose();
});
function fakeRenderer(){
  let target={id:'original'},face=2,mip=1,viewport=new THREE.Vector4(7,8,600,350),scissor=new THREE.Vector4(1,2,500,300),scissorTest=true;
  return {xr:{enabled:true},shadowMap:{autoUpdate:true,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem,calls:0,fail:false,
    capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),
    getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
    getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,
    setViewport:v=>viewport.copy(v),setScissor:v=>scissor.copy(v),setScissorTest:v=>scissorTest=v,
    setRenderTarget:(v,f=0,m=0)=>{target=v;face=f;mip=m;},clear(){},render(){this.calls++;if(this.fail)throw Error('injected capture failure');}
  };
}
await test('Wet reflection has no balanced pass, respects its cap and restores renderer state on failure',()=>{
  const renderer=fakeRenderer(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,500);camera.position.set(-200,2,-300);camera.lookAt(-200,2,-260);camera.updateMatrixWorld();
  const surface=attachRoadSurface(new THREE.MeshStandardMaterial(),{albedo:new THREE.Texture(),normal:new THREE.Texture(),roughness:new THREE.Texture()}),reflection=createWetRoadReflection(scene,renderer,camera,surface);
  reflection.configure('balanced');reflection.setEnabled(true);assert.equal(reflection.render(0),false);assert.equal(renderer.calls,0);
  reflection.configure('high');assert.equal(reflection.render(0),true);assert.equal(reflection.render(1/240),false);assert.equal(surface.uniforms.roadReflectionEnabled.value,1);
  assert.equal(reflection.stats.width,512);assert.equal(reflection.stats.height,288);assert.equal(reflection.stats.maximumHz,12);
  camera.lookAt(-180,2,-260);camera.updateMatrixWorld();assert.equal(reflection.render(.10),true,'Turning in place needs a fresh reflection within the rate cap');
  const goodMatrix=surface.uniforms.roadReflectionMatrix.value.toArray();
  const object=new THREE.Group();object.visible=true;renderer.fail=true;const oldTarget=renderer.getRenderTarget(),oldViewport=renderer.getViewport(new THREE.Vector4()).toArray();
  assert.throws(()=>reflection.render(1,[object]),/injected/);assert.equal(renderer.getRenderTarget(),oldTarget);assert.equal(renderer.getActiveCubeFace(),2);assert.equal(renderer.getActiveMipmapLevel(),1);assert.deepEqual(renderer.getViewport(new THREE.Vector4()).toArray(),oldViewport);assert.equal(renderer.xr.enabled,true);assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.shadowMap.needsUpdate,true);assert.equal(object.visible,true);assert.deepEqual(surface.uniforms.roadReflectionMatrix.value.toArray(),goodMatrix);assert.equal(surface.uniforms.roadReflectionEnabled.value,0);
  camera.position.x=300;assert.equal(reflection.render(2),false);assert.equal(surface.uniforms.roadReflectionEnabled.value,0);
  evidence.reflection={balancedPasses:0,highSize:[512,288],highMaximumHz:12,ultraSize:[768,432],ultraMaximumHz:20,failureStateRestored:true};reflection.dispose();
});
await test('Weather preset switches actual GI, physical lights and water without changing city geometry',async()=>{
  const oldFetch=globalThis.fetch;globalThis.fetch=async url=>{if(new URL(url).protocol==='file:'){const b=readFileSync(url);return{ok:true,json:async()=>JSON.parse(b.toString()),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}return oldFetch(url);};
  try{
    const scene=new THREE.Scene(),renderer=fakeRenderer(),camera=new THREE.PerspectiveCamera(48,16/9,.1,1800);camera.position.set(-200,2,-350);
    const environment=createEnvironment(scene,renderer,sim.getWorldGeometry(),camera);await environment.ready;
    assert.equal(environment.stats.indirectLighting.loaded,true);const children=environment.root.children.length;
    assert.equal(environment.setWeatherPreset('wet-night'),true);environment.setVehicleRoot(car.group);environment.update(1,camera.position);
    assert.equal(environment.stats.indirectLighting.enabled,false);assert.equal(environment.getPresentation().wetness,1);assert.equal(environment.exposureAt(camera.position),CITY_WEATHER_PRESETS['wet-night'].exposure);
    assert.equal(environment.stats.renderBudget.practicalLights.enabled,true);
    environment.setWeatherPreset('clear-day');assert.equal(environment.stats.indirectLighting.enabled,true);assert.equal(environment.getPresentation().wetness,0);assert.equal(environment.stats.renderBudget.practicalLights.enabled,false);assert.equal(environment.root.children.length,children);assert.equal(environment.setWeatherPreset('unsupported'),false);
    evidence.weather={dayGI:true,nightDaylightGI:false,nightExposure:1.08,cityGeometryRetained:true,nightEnvironmentPixels:'Not tested: Node run intentionally has no document or GPU.'};
  }finally{globalThis.fetch=oldFetch;}
});
await test('Inspection rig retains fixed optical settings and an attributable unmodified 3.7 visual baseline',()=>{
  assert.equal(VEHICLE_INSPECTION_RIG.focalLengthMm,50);assert.equal(VEHICLE_INSPECTION_RIG.cameras.length,6);
  const baseline=readFileSync(new URL('../dist/vehicle-reference-3.7.js',import.meta.url),'utf8');assert.ok(baseline.includes('2411ede79f7d7d7501017dbb7f5346a50de2714a'));assert.ok(baseline.includes("'./vehicle-reference-layout-3.7.js'"));
  assert.ok(readFileSync(new URL('../dist/vehicle-inspection.js',import.meta.url),'utf8').includes("import('./vehicle-reference-3.7.js')"));
  evidence.inspection={rig:VEHICLE_INSPECTION_RIG.id,focalLengthMm:50,cameras:VEHICLE_INSPECTION_RIG.cameras.map(c=>c.id),baseline:'3.7 mesh/material under current renderer and lighting; not a complete old pipeline capture',actualScreenshots:'Not captured in this graphics-disabled environment'};
});
const paths=['dist/visual-presets.js','dist/vehicle.js','dist/vehicle-inspection.js','dist/vehicle-inspection.html','dist/vehicle-inspection.css','dist/vehicle-reference-3.7.js','dist/vehicle-reference-layout-3.7.js','dist/city-environment.js','dist/city-practical-lights.js','dist/wet-road-reflection.js','dist/road-surface-material.js','dist/indirect-lighting.js','dist/urban-architecture.js','dist/city-map.js','qa/visual-upgrade-check.mjs'];
const sourceHashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]));
const result={format:'roadster-visual-structure-acceptance-1',status:'passed',createdAt:new Date().toISOString(),checks,evidence,sourceHashes,limits:['Geometry, API state and renderer-contract tests only. No real WebGL frame, browser graphics driver, pixel/shadow-leak inspection, GPU performance or real driving experience is certified.','The reflection renderer is exercised through a state-recording stub; its real framebuffer needs target-device validation.','A 50 mm rig makes future comparison repeatable. Official image focal lengths and dimensions are not published.','Additional street facade surfaces remain within the existing conservative building envelopes; no buildings or city routes were removed.']};
writeFileSync(new URL('./visual-upgrade-3.8.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:checks.length,evidence},null,2));car.dispose();
