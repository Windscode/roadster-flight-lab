import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {attachRoadSurface,ROAD_ROUTE_REGION_CAPACITY} from '../dist/road-surface-material.js';
import {createRouteSurfacePreset,queryRouteSurface,routeSurfaceHash} from '../dist/route-surface.js';
import {createRouteBridgeDetails,buildRouteServicePortal} from '../dist/city-route-detail.js';
import {buildUrbanArchitecture} from '../dist/urban-architecture.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';

const root=new URL('./route-visuals-3.19/',import.meta.url);mkdirSync(root,{recursive:true});
const checks=[];
const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
// The original material callback owns the actual GPU binding, including the
// arrays populated here; inspect that callback rather than a second map model.
const material=new THREE.MeshStandardMaterial();
const binding=attachRoadSurface(material,{albedo:new THREE.Texture(),normal:new THREE.Texture(),roughness:new THREE.Texture()});
material.onBeforeCompile(shader,{});
let compared=0;
for(const preset of ['dry-day','after-rain']){
  const descriptor=createRouteSurfacePreset(preset);binding.setRouteSurfaceDescription(descriptor);
  const uniforms=shader.uniforms;
  assert.equal(uniforms.roadRouteCount.value,descriptor.regions.length);
  assert.equal(binding.routeState.hash,routeSurfaceHash(descriptor));
  for(let x=-205.25;x<-138;x+=.71)for(let z=-387.27;z<-122;z+=1.17){
    let selected=null;
    for(let index=0;index<uniforms.roadRouteCount.value;index++){
      const b=uniforms.roadRouteBounds.value[index];
      if(x>=b.x&&x<=b.z&&z>=b.y&&z<=b.w)selected=uniforms.roadRouteFinish.value[index];
    }
    const contact=queryRouteSurface(descriptor,x,z);
    assert.equal(!!selected,!!contact,'Rendered and contact regions must coincide away from the filtered edge pixel');
    if(contact){assert.equal(selected.x,contact.opticalWetness);assert.equal(selected.y,contact.roughness);assert.equal(selected.z,contact.kind==='metal'?2:contact.kind==='patch'?1:0);compared++;}
  }
  const before=JSON.stringify(binding.getRouteSurfaceDescription());
  binding.setWetness(1);binding.setQuality('ultra');binding.setWetness(0);binding.setQuality('balanced');
  assert.equal(JSON.stringify(binding.getRouteSurfaceDescription()),before,'Observational weather and quality cannot alter prepared conditions');
  const external=binding.getRouteSurfaceDescription();external.regions.length=0;
  assert.equal(binding.getRouteSurfaceDescription().regions.length,descriptor.regions.length);
  assert.equal(queryRouteSurface(descriptor,-200,-300,{y:5.4}),null);
  assert.equal(queryRouteSurface(descriptor,-200,-220,{y:20}),null);
  assert.equal(uniforms.roadRouteGround.value.x,descriptor.groundY);
  assert.equal(uniforms.roadRouteGround.value.y,descriptor.contactToleranceM);
}
const preserved=binding.routeState.hash;
assert.throws(()=>binding.setRouteSurfaceDescription({schema:'bad'}));assert.equal(binding.routeState.hash,preserved);
binding.setRouteSurfaceDescription(null);assert.equal(shader.uniforms.roadRouteCount.value,0);assert.equal(binding.routeState.active,false);
assert.equal(ROAD_ROUTE_REGION_CAPACITY,12);
checks.push({name:'Actual material uniforms and per-wheel map agree; weather/quality changes preserve prepared descriptor; elevated decks excluded',status:'passed',compared,scope:'CPU binding and map consistency, not GPU pixels'});
const samplerCount=s=>[...s.matchAll(/\buniform\s+(?:highp\s+)?sampler\w*\s+([^;]+);/g)].flatMap(m=>m[1].split(',')).length;
// eb2ca9's road callback declares albedo, normal, roughness and reflection.
// Retain that independently recorded four-sampler ceiling in portable QA.
const roadSamplers=samplerCount(shader.fragmentShader)-samplerCount(THREE.ShaderLib.standard.fragmentShader);
assert.equal(roadSamplers,4);
checks.push({name:'Prepared regions add zero texture samplers and no geometry pass',status:'passed',roadSamplers,uniformPayloadBytes:12*2*4*4+2*4+4,scope:'Shader source bindings; offline/GPU compilation checked separately'});
const bridges=createRouteBridgeDetails();
assert.equal(bridges.anchors.length,4);assert.equal(bridges.textureBytesAdded,0);
for(const item of bridges.items){assert.ok(item.size.every(n=>n>0&&Number.isFinite(n)));assert.ok(item.position.every(Number.isFinite));assert.equal(item.shadow,false);}
const pieces=[];const portal=buildRouteServicePortal((kind,size,x,y,out,tint)=>pieces.push({kind,size,x,y,out,tint}),{});
assert.equal(portal.depthM,.62);assert.equal(portal.handleHeightM,1.06);assert.equal(portal.sealed,true);
const rear=pieces.find(p=>p.kind==='displayBack'&&p.out===-.58),glass=pieces.find(p=>p.kind==='shopGlass');
assert.ok(rear&&glass&&glass.out-rear.out>.40);
assert.ok(pieces.filter(p=>p.size[2]>.5).length>=5,'Capped portals need actual side/top/bottom return depth');
const architecture=buildUrbanArchitecture(THREE,new THREE.Group(),CITY_BUILDINGS);await architecture.ready;
assert.equal(architecture.stats.routeServicePortals,2);assert.equal(architecture.stats.buildings,114);
checks.push({name:'Two addressed service portals and two retained bridge joints use closed, finite attached geometry',status:'passed',portalDepthM:portal.depthM,portalHandlesM:portal.handleHeightM,bridgeFinishTriangles:bridges.items.length*12,servicePortals:architecture.stats.routeServicePortals,retainedBuildings:architecture.stats.buildings});
architecture.dispose();
const files=['dist/city-route-detail.js','dist/city-frontage-design.js','dist/city-environment.js','dist/road-surface-material.js','dist/route-surface.js'];
const report={schema:'roadster-route-visuals-3.19',createdAt:new Date().toISOString(),status:'passed',checks,sourceHashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')])),limits:['No GPU frame-time or VRAM result is asserted.','No screenshot or continuous driving observation is replaced by a CPU check.','Old 3.18 street showcases, collision geometry and practical source anchors are retained; exact historical regressions remain separate.']};
writeFileSync(new URL('report.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
