import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {EffectComposer} from '../dist/vendor/addons/postprocessing/EffectComposer.js';
import {RENDER_PROFILES,renderResolution,sizeRenderPipeline,ResolutionGovernor} from '../dist/render-profiles.js';
import {PerformanceMeter} from '../dist/performance-meter.js';
import {ContactAOPass} from '../dist/contact-ao-pass.js';
import {ColdGasExhaust} from '../dist/exhaust.js';
const checks=[],pass=s=>{checks.push(s);console.log('PASS: '+s);};

const matrices=[];
for(const [width,height,dpr]of [[1920,1080,1],[2560,1440,2],[3440,1440,1.5],[5120,1440,2],[3840,2160,2],[390,844,3]]){
  for(const [quality,p]of Object.entries(RENDER_PROFILES)){
    const s=renderResolution(width,height,dpr,quality);assert.ok(s.width*s.height<=p.maxPixels);assert.ok(s.pixelRatio<=p.maxDpr);assert.ok(s.width>0&&s.height>0);
    matrices.push({css:[width,height],deviceDpr:dpr,quality,render:[s.width,s.height],pixels:s.width*s.height});
  }
}
pass('Pixel budgets hold across 1080p, Retina, 4K and 5120-wide viewports');

{
  const renderer={pixelRatio:1.7,width:2560,height:1440,getPixelRatio(){return this.pixelRatio;},getSize(v){return v.set(this.width,this.height);},setPixelRatio(v){this.pixelRatio=v;},setSize(w,h){this.width=w;this.height=h;}};
  const composer=new EffectComposer(renderer),initial=composer.renderTarget1.width*composer.renderTarget1.height;
  // Reproduce v3.4's independent composer pixel ratio before testing the fix.
  renderer.setPixelRatio(1);composer.setSize(2560,1440);assert.equal(composer.renderTarget1.width,4352);
  for(const quality of ['ultra','balanced','high','balanced']){
    const s=sizeRenderPipeline(renderer,composer,2560,1440,2,quality,1);
    assert.equal(composer.renderTarget1.width,s.width);assert.equal(composer.renderTarget2.height,s.height);
    assert.equal(Math.floor(renderer.width*renderer.pixelRatio),s.width);assert.equal(Math.floor(renderer.height*renderer.pixelRatio),s.height);
    assert.ok(composer.renderTarget1.width*composer.renderTarget1.height<initial);
  }
  composer.dispose();
}
pass('Actual Three.js compositor dimensions track the renderer when switching HiDPI presets repeatedly');

{
  const g=new ResolutionGovernor('balanced');
  for(let i=0;i<30*30;i++)g.update(1000/30,{cpuMs:8,gpuMs:25});
  assert.equal(g.scale,RENDER_PROFILES.balanced.minScale);
  const low=g.scale;for(let i=0;i<60*30;i++)g.update(1000/60,{cpuMs:5,gpuMs:8});assert.ok(g.scale>low&&g.scale<=1);
  g.setQuality('balanced');for(let i=0;i<300;i++)g.update(100,{active:false});assert.equal(g.scale,1);
  g.setQuality('ultra');for(let i=0;i<300;i++)g.update(100);assert.equal(g.scale,1);
}
pass('Resolution governor reduces sustained overload, recovers slowly, and ignores pause or fixed-quality modes');

{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),passAO=new ContactAOPass(scene,camera,8,8,12);
  const clear=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshPhysicalMaterial({transparent:true,opacity:.5})),opaque=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());scene.add(clear,opaque);
  const previous=new THREE.MeshBasicMaterial();scene.overrideMaterial=previous;
  const renderer={shadowMap:{enabled:true}};let normals=0,fullscreen=0;
  passAO._renderOverride=()=>{normals++;assert.equal(renderer.shadowMap.enabled,false);assert.equal(clear.visible,false);assert.equal(opaque.visible,true);};
  passAO._renderPass=()=>fullscreen++;passAO.render(renderer);
  assert.equal(normals,1);assert.equal(fullscreen,2);assert.equal(clear.visible,true);assert.equal(renderer.shadowMap.enabled,true);assert.equal(scene.overrideMaterial,previous);
  passAO._renderOverride=()=>{scene.overrideMaterial=passAO.normalMaterial;throw Error('injected render failure');};assert.throws(()=>passAO.render(renderer),/injected/);
  assert.equal(scene.overrideMaterial,previous);assert.equal(renderer.shadowMap.enabled,true);assert.equal(clear.visible,true);passAO.dispose();
}
pass('Contact AO submits one normal pass and two filters, preserving shadow/visibility state even on render failure');

{
  let available=false,disjoint=false,resultReads=0,deleted=0;
  const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};
  const gl={QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,getExtension:()=>ext,createQuery:()=>({}),beginQuery(){},endQuery(){},getParameter:()=>disjoint,getQueryParameter(q,k){if(k===3)return available;resultReads++;return 6500000;},deleteQuery(){deleted++;}};
  const renderer={getContext:()=>gl,info:{render:{calls:0,triangles:0}}},m=new PerformanceMeter(renderer);
  for(let i=0;i<12;i++){m.begin(i*16.6667,16.6667);m.beginGpu();m.end({active:true});}
  m.pollGpu();assert.equal(resultReads,0);available=true;m.pollGpu();assert.equal(m.gpuMs,6.5);assert.equal(deleted,1);
  m.frameNumber=23;m.begin(400,16.6667);m.beginGpu();m.end({active:true});disjoint=true;m.pollGpu();assert.equal(m.gpuMs,null);assert.equal(resultReads,1);
  assert.ok(Math.abs(m.snapshot().medianFps-60)<.01);
  m.startCapture();for(let i=0;i<300;i++){m.begin(500+i*100,100);m.end({active:false});}assert.equal(m.capture.elapsedMs,0);
  for(let i=0;i<300;i++){m.begin(31000+i*100,100);m.end({active:true});}assert.equal(m.capture.complete,true);assert.equal(m.capture.elapsedMs,30000);
  const count=m.capture.frames.length;m.begin(62000,100);m.end({active:true});assert.equal(m.capture.frames.length,count);m.dispose();
}
pass('GPU timing is nonblocking/disjoint-aware; 30-second performance capture excludes menu time and stops when complete');

{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(5,3,5);camera.updateMatrixWorld();
  let traces=0;const exhaust=new ColdGasExhaust(scene,{traceSurface(){traces++;return null;},params:{exhaustVelocity:570}});exhaust.setQuality('balanced',RENDER_PROFILES.balanced);
  const t={quaternion:{x:0,y:0,z:0,w:1},position:{x:0,y:10,z:0},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0},simTime:0,effectiveExhaustVelocity:570,nozzles:[{id:'lift',position:{x:0,y:-.3,z:0},direction:{x:0,y:1,z:0},kind:'lift',force:80000}]};
  for(let i=0;i<180;i++){t.simTime=i/60;exhaust.update(t,1/60,camera);assert.ok(exhaust.particles.length<=1500);}
  assert.ok(traces<65,'Mist surface queries must be cached while the nozzle is stationary');assert.equal(exhaust.mesh.geometry.instanceCount,exhaust.particles.length);
  const a=exhaust.mesh.geometry.attributes.aWorld;assert.equal(a.updateRanges[0].count,exhaust.particles.length*3);assert.ok(a.updateRanges[0].count<a.array.length);assert.equal(t.nozzles[0].force,80000);exhaust.dispose();
}
pass('Balanced exhaust limits particles and GPU uploads, amortizes visual raycasts, and never changes physical thrust');

writeFileSync('qa/render-performance-3.7.json',JSON.stringify({status:'passed',scope:'Deterministic render-budget, shader-pass scheduling and runtime instrumentation regression tests; no browser or GPU FPS measurement.',checks,resolutionMatrix:matrices},null,2)+'\n');
