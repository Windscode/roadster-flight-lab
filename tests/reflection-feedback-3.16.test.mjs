import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {attachRoadSurface} from '../dist/road-surface-material.js';
import {createWetRoadReflection} from '../dist/wet-road-reflection.js';
import {createWetRoadReflection as createBaselineReflection} from '../qa/fixtures/reflection-feedback-3.15/wet-road-reflection.js';

// Observe the production material uniforms at its renderer boundary. This is
// a resource/state regression, not an emulated GL driver or GPU acceptance.
const checks=[],evidence={},test=(name,fn)=>{fn();checks.push({name,status:'passed'});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(readFileSync(new URL('../qa/fixtures/reflection-feedback-3.15/manifest.json',import.meta.url),'utf8'));

function rig(create=createWetRoadReflection,quality='high'){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300);
  camera.position.set(-200,2,-300);camera.lookAt(-200,2,-260);camera.updateMatrixWorld(true);
  const material=new THREE.MeshStandardMaterial(),geometry=new THREE.BoxGeometry(2,2,2),visible=new THREE.Mesh(geometry,material),hidden=visible.clone(),far=visible.clone();
  visible.position.set(-200,2,-280);hidden.visible=false;far.position.set(-200,2,400);scene.add(visible,hidden,far);
  const textures={albedo:new THREE.Texture(),normal:new THREE.Texture(),roughness:new THREE.Texture()};
  const surface=attachRoadSurface(material,textures),u=surface.uniforms,events=[];
  const oldTarget={name:'caller-target'},oldViewport=new THREE.Vector4(7,8,600,350),oldScissor=new THREE.Vector4(1,2,500,300);
  let target=oldTarget,face=2,mip=1,viewport=oldViewport.clone(),scissor=oldScissor.clone(),scissorTest=true;
  const record=phase=>events.push({phase,target,texture:u.roadReflection.value,enabled:u.roadReflectionEnabled.value,aliases:!!target?.texture&&target.texture===u.roadReflection.value});
  for(const name of ['roadReflection','roadReflectionEnabled']){
    let value=u[name].value;
    Object.defineProperty(u[name],'value',{enumerable:true,get:()=>value,set:next=>{value=next;record(name==='roadReflection'?'sampler-write':'enabled-write');}});
  }
  const renderer={xr:{enabled:true},shadowMap:{autoUpdate:true,needsUpdate:true},failAt:null,calls:0,
    getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
    getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,
    setViewport:v=>viewport.copy(v),setScissor:v=>scissor.copy(v),setScissorTest:v=>scissorTest=v,
    setRenderTarget(v,f=0,m=0){if(target?.texture&&v!==target)record('leave-writing-target');target=v;face=f;mip=m;record('target-bound');},
    clear(){record('clear');if(this.failAt==='clear')throw Error('controlled clear failure');},
    render(){record('render');this.calls++;if(this.failAt==='render')throw Error('controlled render failure');}};
  const reflection=create(scene,renderer,camera,surface);reflection.configure(quality);reflection.setEnabled(true);
  const render=time=>reflection.render(time,[visible,hidden]);
  const assertCallerState=()=>{
    assert.equal(renderer.getRenderTarget(),oldTarget);assert.equal(renderer.getActiveCubeFace(),2);assert.equal(renderer.getActiveMipmapLevel(),1);
    assert.deepEqual(renderer.getViewport(new THREE.Vector4()).toArray(),oldViewport.toArray());assert.deepEqual(renderer.getScissor(new THREE.Vector4()).toArray(),oldScissor.toArray());
    assert.equal(renderer.getScissorTest(),true);assert.equal(renderer.xr.enabled,true);assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.shadowMap.needsUpdate,true);
    assert.equal(visible.visible,true);assert.equal(hidden.visible,false);assert.equal(far.visible,true);
  };
  const dispose=()=>{reflection.dispose();geometry.dispose();material.dispose();Object.values(textures).forEach(t=>t.dispose());};
  return {scene,camera,material,surface,u,events,renderer,reflection,render,assertCallerState,dispose,oldTarget};
}

function assertSafePass(r,texture,oldEnabled){
  const clears=r.events.filter(e=>e.phase==='clear'),draws=r.events.filter(e=>e.phase==='render');
  assert.equal(clears.length,1);assert.equal(draws.length,1);
  for(const e of [...clears,...draws]){assert.equal(e.texture,null);assert.equal(e.enabled,0);assert.equal(e.aliases,false);}
  const leaving=r.events.findIndex(e=>e.phase==='leave-writing-target');assert.ok(leaving>=0);
  assert.equal(r.events[leaving].texture,null);assert.equal(r.events[leaving].enabled,0);
  const restored=r.events.slice(leaving+1).find(e=>e.phase==='sampler-write');
  assert.equal(restored.target,r.oldTarget);assert.equal(restored.texture,texture);
  const restoredFlag=r.events.slice(leaving+1).find(e=>e.phase==='enabled-write');
  assert.equal(restoredFlag.target,r.oldTarget);assert.equal(restoredFlag.enabled,oldEnabled);
  r.assertCallerState();assert.equal(r.u.roadReflection.value,texture);
}

test('A successful reflected view consumes the global shadow request; a failed draw retains it',()=>{
  const r=rig();let shadowPasses=0;
  r.renderer.render=function(){if(this.shadowMap.needsUpdate){shadowPasses++;this.shadowMap.needsUpdate=false;}};
  assert.equal(r.render(0),true);assert.equal(shadowPasses,1);assert.equal(r.renderer.shadowMap.needsUpdate,false);
  // The following main view need not enter global shadow preparation again.
  // Real lights also have per-light flags; this does not count GPU depth draws.
  r.renderer.render();assert.equal(shadowPasses,1);
  r.renderer.shadowMap.needsUpdate=true;r.camera.position.z+=1;
  r.renderer.render=function(){this.shadowMap.needsUpdate=false;throw Error('draw after shadow update failed');};
  assert.throws(()=>r.render(1),/draw after shadow/);assert.equal(r.renderer.shadowMap.needsUpdate,true);r.dispose();
});

test('The frozen 3.15 source is byte-exact after its single relative import adaptation',()=>{
  const bytes=readFileSync(new URL('../'+manifest.fixturePath,import.meta.url)),text=bytes.toString(),a=manifest.adaptation;
  assert.equal(hash(bytes),manifest.fixtureSha256);assert.equal(text.split(a.to).length-1,a.occurrences);
  assert.equal(hash(text.replace(a.to,a.from)),manifest.sourceSha256);evidence.baseline={...manifest,verified:true};
});

test('The production shader hook retains the same sampler uniform object even when its enabled flag is zero',()=>{
  const r=rig(),shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  r.material.onBeforeCompile(shader,{});assert.equal(shader.uniforms.roadReflection,r.u.roadReflection);
  assert.equal(shader.uniforms.roadReflectionEnabled,r.u.roadReflectionEnabled);assert.equal(r.u.roadReflectionEnabled.value,0);
  assert.ok(shader.fragmentShader.includes('uniform sampler2D roadReflection;'));
  assert.equal((shader.fragmentShader.match(/texture2D\(roadReflection,/g)||[]).length,5);
  evidence.sharedSampler={sameUniformObject:true,sourceTextureReads:5,scope:'Shader composition only; actual active-uniform evidence comes from the separate native WebGL capture.'};r.dispose();
});

test('Frozen 3.15 exposes the writing target texture to road draws despite its zero enabled flag',()=>{
  const r=rig(createBaselineReflection);r.events.length=0;assert.equal(r.render(0),true);
  const draw=r.events.find(e=>e.phase==='render');assert.equal(draw.enabled,0);assert.equal(draw.aliases,true);
  assert.equal(draw.texture,draw.target.texture);evidence.before={enabledDuringDraw:draw.enabled,samplerEqualsWritingTexture:true,
    cpuFacadeInventsNoGlError:true,scope:'Exact JS object identity at renderer.render; this is not a substitute for the independently captured GL1282.'};r.dispose();
});

test('High and ultra detach the sampler for every clear/draw and restore it only after leaving the target',()=>{
  const rows=[];
  for(const quality of ['high','ultra']){
    const r=rig(createWetRoadReflection,quality),texture=r.u.roadReflection.value;
    for(const [index,time] of [0,.1,.2,.6].entries()){
      r.camera.position.z+=1;r.events.length=0;assert.equal(r.render(time),true);
      assertSafePass(r,texture,index===0?0:1);assert.equal(r.u.roadReflectionEnabled.value,1);assert.equal(r.u.roadReflectionStrength.value,1);
    }
    rows.push({quality,passes:r.reflection.stats.passes,targetSize:[r.reflection.stats.width,r.reflection.stats.height],maximumHz:r.reflection.stats.maximumHz,aliasDraws:0,exactCallerStateRestored:true});r.dispose();
  }
  assert.deepEqual(rows.map(r=>r.targetSize),[[512,288],[768,432]]);assert.deepEqual(rows.map(r=>r.maximumHz),[12,20]);evidence.successfulPasses=rows;
});

test('Cached frames keep the original completed texture without issuing another reflection draw',()=>{
  const r=rig(),texture=r.u.roadReflection.value;assert.equal(r.render(0),true);r.events.length=0;
  assert.equal(r.render(.01),false);assert.equal(r.render(.1),false);assert.equal(r.renderer.calls,1);
  assert.equal(r.events.filter(e=>e.phase==='sampler-write').length,0);assert.equal(r.u.roadReflection.value,texture);assert.equal(r.u.roadReflectionEnabled.value,1);
  r.assertCallerState();evidence.cachedFrames={newDraws:0,samplerChanges:0,completedTexturePreserved:true};r.dispose();
});

test('Clear and render exceptions restore the exact sampler and caller state, then disable the partially written cache',()=>{
  const rows=[];
  for(const failAt of ['clear','render'])for(const previousCapture of [false,true]){
    const r=rig(),texture=r.u.roadReflection.value;
    if(previousCapture)assert.equal(r.render(0),true);
    const oldMatrix=r.u.roadReflectionMatrix.value.toArray(),oldPasses=r.reflection.stats.passes;
    r.camera.position.z+=2;r.renderer.failAt=failAt;r.events.length=0;
    assert.throws(()=>r.render(.1),new RegExp('controlled '+failAt+' failure'));
    const leaving=r.events.findIndex(e=>e.phase==='leave-writing-target');assert.ok(leaving>=0);assert.equal(r.events[leaving].texture,null);
    const restored=r.events.slice(leaving+1).find(e=>e.phase==='sampler-write');assert.equal(restored.target,r.oldTarget);assert.equal(restored.texture,texture);
    const flags=r.events.slice(leaving+1).filter(e=>e.phase==='enabled-write');assert.equal(flags[0].enabled,previousCapture?1:0);assert.equal(flags.at(-1).enabled,0);
    assert.equal(r.u.roadReflection.value,texture);assert.equal(r.u.roadReflectionEnabled.value,0);assert.equal(r.u.roadReflectionStrength.value,0);
    assert.deepEqual(r.u.roadReflectionMatrix.value.toArray(),oldMatrix);assert.equal(r.reflection.stats.passes,oldPasses);assert.equal(r.reflection.stats.passesThisFrame,0);r.assertCallerState();
    r.renderer.failAt=null;r.events.length=0;assert.equal(r.render(.11),true);assertSafePass(r,texture,0);assert.equal(r.u.roadReflectionEnabled.value,1);
    rows.push({failAt,previousCapture,exactSamplerRestored:true,partialCacheDisabled:true,oldProjectionPreserved:true,retrySucceeded:true});r.dispose();
  }
  evidence.failureRecovery=rows;
});

test('Disable/re-enable, quality disposal and recreation preserve balanced and low pass budgets',()=>{
  const r=rig(),firstTexture=r.u.roadReflection.value;assert.ok(r.render(0));r.reflection.setEnabled(false);r.events.length=0;
  assert.equal(r.render(.1),false);assert.equal(r.u.roadReflection.value,firstTexture);assert.equal(r.u.roadReflectionEnabled.value,0);assert.equal(r.events.some(e=>e.phase==='render'),false);
  r.reflection.setEnabled(true);r.events.length=0;assert.ok(r.render(.2));assertSafePass(r,firstTexture,0);
  let disposed=0;r.events.find(e=>e.phase==='render').target.addEventListener('dispose',()=>disposed++);
  for(const quality of ['balanced','low']){r.reflection.configure(quality);assert.equal(r.u.roadReflection.value,null);r.events.length=0;assert.equal(r.render(.3),false);assert.equal(r.events.some(e=>e.phase==='render'),false);}
  assert.equal(disposed,1);r.reflection.configure('ultra');const secondTexture=r.u.roadReflection.value;assert.notEqual(secondTexture,firstTexture);
  r.events.length=0;assert.ok(r.render(.4));assertSafePass(r,secondTexture,0);r.reflection.dispose();assert.equal(r.u.roadReflection.value,null);assert.equal(r.u.roadReflectionEnabled.value,0);assert.equal(r.render(.5),false);
  evidence.lifecycle={disabledAddsNoDraw:true,reEnableUsesSameTexture:true,balancedAndLowDraws:0,recreatedTextureIsDistinct:true,disposedSamplerNull:true};r.dispose();
});

test('The temporary pass restores an arbitrary previous sampler identity rather than substituting its own target',()=>{
  const r=rig(),previous=new THREE.Texture();r.u.roadReflection.value=previous;r.events.length=0;assert.ok(r.render(0));assertSafePass(r,previous,0);
  evidence.exactRestoration={previousTextureIdentityPreserved:true,scope:'State preservation contract; ordinary configuration uses the capture target texture.'};r.dispose();previous.dispose();
});

const sourcePaths=['dist/wet-road-reflection.js','dist/road-surface-material.js','dist/vendor/three.module.js','tests/reflection-feedback-3.16.test.mjs'];
const sourceSha256=Object.fromEntries(sourcePaths.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))]));
const report={schema:'roadster.reflection-feedback',version:1,modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),status:'passed',checks,sourceSha256,evidence,
  verificationType:'Production material and reflection module on a CPU renderer boundary observer; no WebGL context, getError emulation or pixel acceptance.',
  specification:{url:'https://registry.khronos.org/webgl/specs/latest/1.0/',section:'Feedback Loops Between Textures and the Framebuffer'},
  remainingAcceptance:'Same-condition native WebGL after-capture and 14-frame per-draw audit with zero new GL errors, using the final rebuilt identity. Existing 3.15 failure remains recorded.'};
writeFileSync(new URL(`../qa/reflection-feedback-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:checks.length,report:`qa/reflection-feedback-${REPORT_VERSION}.json`,nativeWebgl:false}));
