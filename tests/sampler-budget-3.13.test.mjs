import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import * as THREE from '../dist/vendor/three.module.js';
import {packNightFieldAtlas} from '../dist/night-field-atlas.js';
import {createNightCityLighting} from '../dist/night-city-lighting.js';
import {createNightDirectLighting} from '../dist/night-direct-lighting.js';
import {cityLightingVariant} from '../dist/city-material-lighting.js';
import {createEnvironment} from '../dist/city-environment.js';
import {createRoadster} from '../dist/vehicle.js';
import {RoadsterSim} from '../dist/physics.js';

const reportArg=process.argv.indexOf('--report'),reportPath=reportArg>=0?process.argv[reportArg+1]:`qa/sampler-budget-${REPORT_VERSION}.json`;
const checks=[],evidence={},hash=data=>createHash('sha256').update(data).digest('hex');
const fetchAsset=async url=>{try{const b=readFileSync(url);return{ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return{ok:false};}};
function pass(name,detail){checks.push({name,status:'passed',detail});console.log('PASS:',name);}

// Independent old-texture oracle: normalized GL coordinates, edge clamp and
// eight texels of trilinear interpolation. Compare real half-float coefficient
// fields before/after packing, including negative/outside UV and seam edges.
function trilinear(image,uv){
  const size=[image.width,image.height,image.depth],at=uv.map((v,i)=>Math.max(0,Math.min(size[i]-1,v*size[i]-.5))),low=at.map(Math.floor),f=at.map((v,i)=>v-low[i]),result=[0,0,0,0];
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
    const p=[x,y,z].map((v,i)=>Math.min(size[i]-1,low[i]+v)),w=(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);
    const index=((p[2]*image.height+p[1])*image.width+p[0])*4;
    for(let c=0;c<4;c++)result[c]+=THREE.DataUtils.fromHalfFloat(image.data[index+c])*w;
  }
  return result;
}
const fields=[];
for(const direct of [false,true]){
  const field=direct?createNightDirectLighting({fetchAsset}):createNightCityLighting({fetchAsset});
  assert.equal(await field.ready,true);field.setEnabled(true);
  let maximumError=0,comparisons=0,checkedHalfValues=0;
  const qualities=[];
  for(const quality of ['balanced','high','ultra','balanced','high']){
    field.setQuality(quality);
    const atlas=field.uniforms.nightFieldAtlas.value.image,city=field.uniforms.nightCityField.value.image,route=field.uniforms.nightRouteField.value.image;
    assert.ok(Math.max(atlas.width,atlas.height,atlas.depth)<=256);
    assert.equal(field.stats.activeFieldSamplers,1);
    for(const [source,offset]of [[city,0],[route,city.width]]){
      for(let z=0;z<source.depth;z++)for(let y=0;y<source.height;y++){
        const from=(z*source.height+y)*source.width*4,to=((z*atlas.height+y)*atlas.width+offset)*4;
        assert.deepEqual(atlas.data.subarray(to,to+source.width*4),source.data.subarray(from,from+source.width*4));checkedHalfValues+=source.width*4;
      }
      for(const u of [-.1,0,.5/source.width,.017,.37,.5,.987,1-.5/source.width,1,1.1])for(const v of [-.1,0,.5/source.height,.23,.5,.89,1-.5/source.height,1,1.1])for(const w of [.5/30,1.7/30,4.5/30,5.5/30,14.2/30,24.5/30,29.5/30]){
        const clamp=(value,dimension)=>Math.max(.5/dimension,Math.min(1-.5/dimension,value));
        const old=trilinear(source,[u,v,w]),packed=trilinear(atlas,[(offset+clamp(u,source.width)*source.width)/atlas.width,clamp(v,source.height)*source.height/atlas.height,w]);
        for(let c=0;c<4;c++){const error=Math.abs(old[c]-packed[c]);maximumError=Math.max(maximumError,error);assert.ok(error<1e-10,`Atlas interpolation changed ${error}`);}comparisons++;
      }
    }
    qualities.push({quality,size:[atlas.width,atlas.height,atlas.depth],activeBytes:field.stats.atlasGPUBytes,paddingBytes:field.stats.atlasPaddingBytes,cacheBytes:field.stats.atlasCacheBytes});
  }
  const current=field.uniforms.nightFieldAtlas.value;field.setQuality('ultra');assert.equal(field.uniforms.nightFieldAtlas.value,current,'high and ultra share the same fine atlas');
  fields.push({kind:direct?'stationary direct':'bounce',checkedHalfValues,comparisons,maximumError,qualities,sourceIdentity:field.stats.identity});
}
evidence.atlases=fields;
pass('Every retained half-float coefficient is identical; independent trilinear samples preserve edge/clamp/direction/height interpolation',fields.map(({kind,checkedHalfValues,comparisons,maximumError})=>({kind,checkedHalfValues,comparisons,maximumError})));

const limited=createNightCityLighting({fetchAsset,max3DTextureSize:161});limited.setQuality('high');assert.equal(await limited.ready,false);assert.match(limited.stats.error,/MAX_3D_TEXTURE_SIZE 161/);
assert.throws(()=>packNightFieldAtlas({data:new Uint16Array(4),width:1,height:1,depth:1},{data:new Uint16Array(8),width:1,height:1,depth:2}),/matching height/);
pass('Atlas dimensions respect the supplied 3D texture limit; malformed depth layouts fail explicitly',{currentFine:[162,81,30],testedRejectLimit:161,WebGL2Minimum3DSize:256});

const previousFetch=globalThis.fetch;globalThis.fetch=fetchAsset;
try{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),car=createRoadster({quality:'high'});scene.add(car.group);
  const renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
  const world=createEnvironment(scene,renderer,new RoadsterSim().getWorldGeometry(),camera);await world.ready;
  const materials=[];scene.traverse(o=>{if(o.isMesh)for(const material of Array.isArray(o.material)?o.material:[o.material])if(material?.isMeshStandardMaterial&&!materials.includes(material))materials.push(material);});
  const road=materials.find(m=>m.name==='City / scanned asphalt + local puddles'),mineral=materials.find(m=>m.name==='Urban / aged mineral plaster');assert.ok(road&&mineral);
  const dynamic=materials.find(m=>m.userData.cityLightingVariant?.isStatic===false);assert.ok(dynamic);
  const sequence=[['high','wet-night'],['balanced','wet-night'],['high','wet-night'],['ultra','wet-night'],['ultra','clear-day'],['high','clear-day'],['high','wet-night'],['high','clear-day'],['high','wet-night']];
  const observations=[];let disposals=0;road.addEventListener('dispose',()=>disposals++);
  for(const [quality,weather]of sequence){
    world.setQuality(quality);world.setWeatherPreset(weather);
    const entries=[];
    for(const material of [road,mineral,dynamic]){
      const variant=material.userData.cityLightingVariant,shader={vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}};
      assert.equal(variant.quality,quality);assert.equal(variant.night,weather==='wet-night');
      material.onBeforeCompile(shader,renderer);
      assert.equal(shader.fragmentShader.includes('uniform highp sampler2DArray giCity,giStreet'),!variant.night&&quality!=='balanced');
      assert.equal(shader.fragmentShader.includes('uniform highp sampler3D nightFieldAtlas'),variant.night);
      assert.equal(shader.fragmentShader.includes('uniform highp sampler3D stationaryFieldAtlas'),variant.night&&variant.isStatic);
      assert.equal(shader.fragmentShader.includes('uniform sampler2D probeSunDepth'),!variant.night&&quality!=='balanced');
      assert.equal(shader.fragmentShader.includes('uniform sampler2D giAO'),quality!=='balanced');
      assert.ok(!shader.fragmentShader.includes('uniform highp sampler3D nightCityField,nightRouteField'));
      entries.push({material:material.name||material.type,key:variant.key,isStatic:variant.isStatic});
    }
    observations.push({quality,weather,entries});
  }
  assert.ok(disposals>=sequence.length,'quality/weather releases old program tables');
  assert.notEqual(cityLightingVariant({quality:'high',night:false,isStatic:true}).key,cityLightingVariant({quality:'high',night:true,isStatic:true}).key);
  evidence.switches={sequence:observations,roadProgramDisposals:disposals,materialCount:materials.length,sceneGraphOnly:true};
  pass('Real city bindMaterial chain selects mutually exclusive weather transport, preserves static/dynamic distinction and retires stale tables through high/balanced/high and day/night cycles',{sequence:sequence.length,roadProgramDisposals:disposals,sceneGraphOnly:true});
  car.dispose();
}finally{globalThis.fetch=previousFetch;}

const files=['dist/city-environment.js','dist/city-material-lighting.js','dist/night-field-atlas.js','dist/night-city-lighting.js','dist/night-direct-lighting.js','dist/indirect-lighting.js','tests/sampler-budget-3.13.test.mjs'];
const report={status:'passed',createdAt:new Date().toISOString(),checks,evidence,sourceHashes:Object.fromEntries(files.map(p=>[p,hash(readFileSync(p))])),limits:['CPU storage/interpolation and real JavaScript shader-binding lifecycle checks; no WebGL context, GPU link/draw, image, FPS or target-device acceptance.','Actual driver active-uniform arrays, LINK_STATUS, VALIDATE_STATUS and draws are captured separately by the live render diagnostics.','Atlas padding adds bounded CPU/GPU storage; source transport resolution, coefficients, light budgets and material maps remain unchanged.']};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log('Report:',reportPath);
