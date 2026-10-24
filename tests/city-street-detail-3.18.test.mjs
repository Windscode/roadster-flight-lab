import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';
import {CITY_STREETS} from '../dist/city-plan.js';
import {createEnvironment} from '../dist/city-environment.js';
import {createCrosstownStreetEdge} from '../dist/city-street-edge.js';
import {buildStreetDisplay,DISPLAY_RECIPES} from '../dist/street-display.js';
import {createNightOccluders} from '../dist/city-night-transport.js';
import {createNightDirectEvaluator} from '../dist/night-direct-transport.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';
import {CITY_WEATHER_PRESETS} from '../dist/visual-presets.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex'),checks=[];
const check=async(name,fn)=>{try{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS '+name);}catch(error){checks.push({name,status:'failed',error:{message:error.message,stack:error.stack}});console.error('FAIL '+name,error.message);}};
const geometry=new RoadsterSim().getWorldGeometry(),edge=createCrosstownStreetEdge(),oldFetch=globalThis.fetch;
globalThis.fetch=async url=>{try{const b=readFileSync(url);return{ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return{ok:false};}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem},env=createEnvironment(scene,renderer,geometry,camera);
await env.ready;

await check('The whole 3.17 physical city and its road clearances remain identical',()=>{
  const baseline=JSON.parse(readFileSync(new URL('../qa/irradiance-bake-3.17.json',import.meta.url))),hash=sha(canonicalGeometryJSON(geometry));
  assert.equal(hash,baseline.geometryCanonicalSHA256);assert.equal(CITY_BUILDINGS.length,114);assert.equal(CITY_STREETS.length,12);
  assert.equal(edge.version,'crosstown-public-frontage-3.17-1');assert.equal(edge.frontages.length,4);assert.ok(edge.frontages.every(f=>f.sealed&&f.showcaseDepthM===.62));
  return {geometryCanonicalSHA256:hash,baselineCommit:'d9a4fbfd434fe49cdbeae18c32f624360e9dc4e9',buildings:CITY_BUILDINGS.length,streets:CITY_STREETS.length,scope:'Exact shared solids, so new facade work does not open rooms or expand map bounds.'};
});

await check('Shallow showcases use separated glazing, returns and usable-scale contents within the existing recess',()=>{
  const rows=[];
  for(const recipe of DISPLAY_RECIPES){
    const parts=[],summary=buildStreetDisplay((kind,size,x,y,out,tint)=>parts.push({kind,size,x,y,out,tint}),{width:4.6,height:2.7,sill:.38,recipe,variant:1,door:true});
    const glass=parts.find(p=>p.kind==='shopGlass'),back=parts.find(p=>p.kind==='displayBack'&&p.size[2]<.04),goods=parts.filter(p=>p.kind==='displayGoods');
    assert.ok(glass&&back&&goods.length);assert.ok(glass.out-back.out>.5);assert.ok(parts.every(p=>p.size.every(v=>Number.isFinite(v)&&v>0)&&p.out-p.size[2]/2>=-.62));
    assert.equal(summary.handleHeightM,1.06);assert.ok(parts.some(p=>p.kind==='displayGoods'&&Math.abs(p.y-1.06)<1e-9&&p.size[1]===.28));
    assert.ok(parts.some(p=>p.kind==='displayFrame'&&p.size[2]>.4),'Door must have real deep jamb returns');rows.push({recipe,depthM:summary.depthM,glassToBackM:glass.out-back.out,handleHeightM:summary.handleHeightM,doorWidthM:1.10});
  }
  const glazing=new Set();scene.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.name?.includes('showcase glazing')||m?.name==='display-glazing')glazing.add(m);});
  assert.ok(glazing.size>0);for(const m of glazing){assert.equal(m.transparent,true);assert.ok(m.opacity>0&&m.opacity<.3);assert.equal(m.depthWrite,false);}
  return {recipes:rows,glazing:[...glazing].map(m=>({name:m.name,opacity:m.opacity,roughness:m.roughness})),scope:'Actual geometry/material separation. Visual usefulness, street rhythm and legibility are judged in matched native views, not by object count.'};
});

await check('Selective upper facade light originates at actual finite fixtures and reaches external receivers',()=>{
  const anchors=env.getPracticalLightAnchors().filter(a=>a.id.startsWith('upper-grazer-')),occluders=createNightOccluders(geometry),rows=[];
  assert.equal(anchors.length,8);assert.equal(new Set(anchors.map(a=>a.building)).size,4);
  for(const a of anchors){
    assert.equal(occluders.inside(a.position),false,a.id+' emitter inside solid');assert.equal(occluders.inside(a.target),false,a.id+' receiver inside solid');
    const sample=createNightDirectEvaluator([a],occluders).evaluate(a.target);assert.equal(sample.blocked,0);assert.equal(sample.contributing,1);assert.ok(sample.coefficients.some(v=>v>0));
    rows.push({id:a.id,source:a.position,receiver:a.target,intensity:a.intensity,rangeM:a.range,coefficients:sample.coefficients});
  }
  assert.equal(CITY_WEATHER_PRESETS['clear-day'].exposure,.87);assert.equal(CITY_WEATHER_PRESETS['wet-night'].exposure,1.02);
  return {fixtures:rows,scope:'Authored intensity, finite cone and static-envelope transport. Not photometric calibration; nearby direct pools remain bounded and far diffuse uses probes.'};
});

await check('External night direct and bounce retain the exact baked geometry, lights, transport and volume data',()=>{
  const anchorSHA256=sha(JSON.stringify(env.getPracticalLightAnchors())),rows=[];
  for(const folder of ['night-irradiance','night-direct-irradiance']){
    const m=JSON.parse(readFileSync(new URL('../dist/assets/'+folder+'/manifest.json',import.meta.url)));assert.equal(m.anchorSHA256,anchorSHA256);assert.equal(m.geometryCanonicalSHA256,sha(canonicalGeometryJSON(geometry)));
    // Renderer-only display light never enters the baked fixture list. Whole
    // renderer source hashes can change while the bake's real inputs do not.
    // Keep the original manifest, and require both inputs above plus unchanged
    // transport/albedo/layout implementation and every baked volume below.
    for(const path of ['dist/city-night-transport.js','dist/night-direct-transport.js','dist/night-city-lighting.js','dist/night-direct-lighting.js'].filter(path=>m.sourceHashes[path]))assert.equal(m.sourceHashes[path],sha(readFileSync(new URL('../'+path,import.meta.url))));
    for(const v of m.volumes)assert.equal(v.sha256,sha(readFileSync(new URL('../dist/assets/'+folder+'/'+v.file,import.meta.url))));rows.push({folder,identity:m.identity,anchorSHA256,compatibility:'Original bake retained: exact external fixtures, shared solids, transport and volume bytes. Display-only shelf light is excluded; no rebake is claimed.',rendererSourceChanges:Object.fromEntries(['dist/street-display.js','dist/urban-architecture.js','dist/city-street-edge.js','dist/city-environment.js'].map(path=>[path,{baked:m.sourceHashes[path],current:sha(readFileSync(new URL('../'+path,import.meta.url)))}]))});
  }
  return rows;
});

globalThis.fetch=oldFetch;const resources=new Set();scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])resources.add(m);});resources.forEach(r=>r.dispose?.());
const files=['dist/street-display.js','dist/city-frontage-design.js','dist/city-street-edge.js','dist/urban-architecture.js','dist/city-environment.js'];
const report={schema:'roadster-street-detail-3.18',createdAt:new Date().toISOString(),status:checks.every(c=>c.status==='passed')?'passed':'failed',checks,sourceHashes:Object.fromEntries(files.map(f=>[f,sha(readFileSync(new URL('../'+f,import.meta.url)))])),limits:['The 3.17 final batch repair was geometry-equivalent; this intentional 3.18 facade edit is not. Its old equivalence report remains historical evidence.','Current whole-scene and fifteen-view draw/triangle budgets are checked separately without raising ceilings.','No object count or scalar audit substitutes for complete-street, corner, night and continuous driving observations.']};
writeFileSync(new URL(`../qa/city-street-detail-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');if(report.status!=='passed')process.exitCode=1;
