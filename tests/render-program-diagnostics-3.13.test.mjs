import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createRenderProgramDiagnostics,inspectLinkedSamplers} from '../dist/render-program-diagnostics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
const checks=[];
function pass(name){checks.push(name);console.log('PASS: '+name);}
function fixture({samplers=13,linked=true,valid=true,draws=true}={}){
  const shaderV={type:35633,source:'uniform sampler2D boneTexture;'},shaderF={type:35632,source:'uniform sampler2D spotShadowMap[6]; uniform highp sampler3D nightAtlas; uniform sampler2D surfaceMaps[6],giStreet;'};
  const program={linked,valid,samplers,shaders:[shaderV,shaderF]},props=new WeakMap(),queue=[];let current=null,validated=0,queries=0;
  const gl={NO_ERROR:0,LINK_STATUS:35714,VALIDATE_STATUS:35715,ACTIVE_UNIFORMS:35718,CURRENT_PROGRAM:35725,SHADER_TYPE:35663,VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,MAX_TEXTURE_IMAGE_UNITS:34930,MAX_VERTEX_TEXTURE_IMAGE_UNITS:35660,MAX_COMBINED_TEXTURE_IMAGE_UNITS:35661,MAX_3D_TEXTURE_SIZE:32883,
    getParameter(k){queries++;return k===35725?current:k===34930?16:k===35660?16:k===35661?32:k===32883?256:null;},
    getProgramParameter(p,k){queries++;return k===35714?p.linked:k===35715?p.valid:k===35718?3:null;},
    getAttachedShaders:p=>p.shaders,getShaderParameter:(s,k)=>s.type,getShaderSource:s=>s.source,getShaderInfoLog:()=>'',getProgramInfoLog:p=>p.linked?'':'FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)',
    getActiveUniform(p,i){return [{name:'spotShadowMap[0]',size:6,type:0x8b5e},{name:'nightAtlas',size:1,type:0x8b5f},{name:'surfaceMaps[0]',size:p.samplers-7,type:0x8b5e}][i];},
    getUniformLocation:(p,name)=>name,getUniform:(p,name)=>name==='nightAtlas'?6:name==='spotShadowMap[0]'?new Int32Array([0,1,2,3,4,5]):new Int32Array(Array.from({length:p.samplers-7},(_,i)=>i+7)),
    FRAMEBUFFER:36160,FRAMEBUFFER_BINDING:36006,FRAMEBUFFER_COMPLETE:36053,checkFramebufferStatus:()=>36053,getError:()=>queue.shift()||0,isContextLost:()=>false,validateProgram(p){assert.equal(current,p,'validate the actual bound draw program');validated++;},
  };
  const renderer={getContext:()=>gl,debug:{onShaderError:null,checkShaderErrors:true},info:{render:{calls:0}},properties:{get:m=>props.get(m)},renderBufferDirect(camera,scene,geometry,material){props.set(material,{currentProgram:{id:1,cacheKey:'actual-test-variant',program}});current=program;if(draws)this.info.render.calls++;}};
  const material={id:1,type:'MeshStandardMaterial',name:'City / scanned asphalt + local puddles',userData:{cityLightingVariant:{key:'wet-night/high'}}};
  const object={isMesh:true,name:'Road plane',userData:{},parent:null};
  return {renderer,gl,program,material,object,queue,get queries(){return queries;},get validated(){return validated;},draw(){renderer.renderBufferDirect(null,null,null,material,object,null);}};
}
{
  const f=fixture();const r=inspectLinkedSamplers(f.gl,f.program);assert.equal(r.activeSamplerElements,13);assert.equal(r.activeSamplers[0].size,6);assert.deepEqual(r.activeSamplers[0].textureUnits,[0,1,2,3,4,5]);assert.equal(r.activeSamplers[0].declaredInFragment,true);assert.equal(r.activeSamplers[0].declaredInVertex,false);assert.ok(r.sourceStageDeclaration.fragment.includes('giStreet'));pass('Linked sampler arrays count every active element and retain actual bindings; source stage declarations are explicitly separate');
}
{
  const f=fixture(),audit=createRenderProgramDiagnostics(f.renderer),before=f.queries;f.draw();assert.equal(f.queries,before);audit.beginFrame({quality:'high'});f.draw();const r=audit.endFrame({requiredCategories:['road']});assert.equal(r.status,'passed');assert.equal(r.drawCalls,1);assert.equal(f.validated,1);assert.equal(r.programs[0].materials[0],f.material.name);assert.deepEqual(r.observedCategories,['road']);audit.dispose();pass('Only explicit captures query GL, validate the bound program, and attribute successful draws to named road materials');
}
{
  const f=fixture({samplers:18}),audit=createRenderProgramDiagnostics(f.renderer);audit.beginFrame();f.draw();const r=audit.endFrame();assert.equal(r.status,'failed');assert.ok(r.failures.some(s=>s.includes('sampler-budget')));assert.equal(r.programs[0].activeSamplerElements,18);pass('An 18-element linked facade/road resource set cannot pass the target-16 gate');
}
{
  const f=fixture({linked:false}),audit=createRenderProgramDiagnostics(f.renderer);audit.beginFrame();f.draw();const r=audit.endFrame();assert.equal(r.status,'failed');assert.equal(r.programs[0].activeSamplers,null);assert.equal(r.programs[0].activeSamplerElements,null);assert.equal(f.validated,0);pass('Failed links retain unavailable active arrays instead of interpreting a zero count as success');
}
{
  const f=fixture({valid:false}),audit=createRenderProgramDiagnostics(f.renderer);audit.beginFrame();f.draw();const r=audit.endFrame();assert.equal(r.status,'failed');assert.equal(r.programs[0].validated,false);pass('A linked program still fails when validation with actual draw bindings fails');
}
{
  const f=fixture(),audit=createRenderProgramDiagnostics(f.renderer);audit.beginFrame();f.queue.push(1282);f.draw();const r=audit.endFrame();assert.equal(r.status,'failed');assert.deepEqual(r.programs[0].glErrors,[]);assert.deepEqual(r.programs[0].preDrawErrors,[1282]);audit.beginFrame();f.draw();assert.equal(audit.endFrame().status,'passed');pass('Pre-draw GL errors remain separate from the following draw and a later clean frame does not rewrite the failed record');
}
{
  const f=fixture({draws:false}),audit=createRenderProgramDiagnostics(f.renderer);audit.beginFrame();f.draw();const r=audit.endFrame({requiredCategories:['vehicle','instanced-building']});assert.equal(r.status,'failed');assert.ok(r.failures.includes('no-observed-draw-calls'));assert.ok(r.failures.includes('required-category-not-drawn:vehicle'));pass('No draw or missing required vehicle/building categories cannot be accepted as coverage');
}
{
  const f=fixture(),audit=createRenderProgramDiagnostics(f.renderer);audit.beginFrame();assert.throws(()=>audit.beginFrame(),/already/);f.draw();const first=audit.endFrame();first.programs[0].activeSamplers[0].size=999;assert.equal(audit.snapshot().programs[0].activeSamplers[0].size,6);pass('Capture state rejects overlap and exported records cannot mutate retained evidence');
}
{
  const camera={id:31},reflection={id:32},f=fixture(),audit=createRenderProgramDiagnostics(f.renderer,{primaryCamera:camera});f.object.userData.renderAuditGroup='vehicle';
  for(const [drawCamera,type] of [[reflection,'MeshStandardMaterial'],[camera,'MeshDepthMaterial'],[camera,'MeshNormalMaterial']]){f.material.type=type;audit.beginFrame();f.renderer.renderBufferDirect(drawCamera,null,null,f.material,f.object,null);const r=audit.endFrame({requiredCategories:['vehicle']});assert.equal(r.status,'failed');assert.ok(r.failures.includes('required-category-not-drawn:vehicle'));}
  f.material.type='MeshPhysicalMaterial';audit.beginFrame();f.renderer.renderBufferDirect(camera,null,null,f.material,f.object,null);assert.equal(audit.endFrame({requiredCategories:['vehicle']}).status,'passed');
  pass('Vehicle coverage requires the main camera and actual PBR color material, never reflection, depth or normal passes');
}
{
  const f=fixture(),audit=createRenderProgramDiagnostics(f.renderer);audit.beginFrame();f.draw();const r=audit.endFrame({aborted:'deliberate interrupted capture'});assert.equal(r.status,'failed');assert.ok(r.failures.includes('capture-aborted'));pass('An interrupted capture never retains a passed verdict');
}
writeFileSync(new URL('../qa/render-program-diagnostics-'+MODEL_VERSION.replace(/\.0$/,'')+'.json',import.meta.url),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,checks,scope:'GL-interface fixtures test capture, attribution, sampler arrays and rejection behavior. No WebGL renderer, actual GPU, target-driver link, visible pixel or route-FPS acceptance is claimed.'},null,2)+'\n');
