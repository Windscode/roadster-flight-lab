import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {configureCubeProbeTarget} from '../dist/cube-probe-target.js';
import {describeRenderTarget,createFramebufferInspector} from '../dist/framebuffer-diagnostics.js';
import {createRenderProgramDiagnostics} from '../dist/render-program-diagnostics.js';
import {CITY_PROGRAM_MATRIX,collectProgramMatrix,matrixArchiveFiles} from '../dist/render-capture-matrix.js';
import {captureArchive,crc32} from '../dist/capture-archive.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const checks=[];
const check=async(name,fn)=>{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS: '+name);};

await check('Frozen one-argument cube resize reproduces undefined height and invalid viewport in bundled Three.js',()=>{
  const target=new THREE.WebGLCubeRenderTarget(128);target.setSize(256);
  assert.equal(target.height,undefined);assert.equal(target.viewport.w,undefined);
  assert.ok(target.texture.image.every(image=>image.width===128&&image.height===128));target.dispose();
  return{scope:'CPU target allocation descriptors, not a target-driver framebuffer query',width:256,height:null,viewportHeight:'undefined',faceWidth:128};
});
await check('Repeated 128/256/0 quality changes keep six coherent faces, dispose replaced targets and retain same-size probes',()=>{
  const scene=new THREE.Scene();let state={},created=0,disposed=0;
  for(const size of [128,128,256,256,128,0,0,256,128,256]){
    const previous=state.target;state=configureCubeProbeTarget(scene,state,size,700);
    if(size===0){assert.equal(state.target,null);assert.equal(scene.children.length,0);continue;}
    assert.equal(scene.children.length,1);assert.equal(state.target.width,size);assert.equal(state.target.height,size);
    assert.equal(state.target.viewport.w,size);assert.equal(state.target.texture.image.length,6);
    for(const face of state.target.texture.image){assert.equal(face.width,size);assert.equal(face.height,size);}
    assert.equal(state.target.texture.type,THREE.HalfFloatType);assert.equal(state.target.texture.generateMipmaps,true);
    if(previous===state.target)assert.equal(previous.uuid,state.target.uuid);
    else{created++;state.target.addEventListener('dispose',()=>disposed++);}
    assert.equal(state.camera.children.length,6);assert.ok(state.camera.children.every(c=>c.far===700));
  }
  assert.equal(disposed,created-1);configureCubeProbeTarget(scene,state,0,700);assert.equal(disposed,created);
  assert.throws(()=>configureCubeProbeTarget(scene,{},undefined,700),/Invalid/);
  return{created,disposed,textureFormat:'unchanged half-float mipmapped cube',scope:'Actual Three.js resource objects, no GPU'};
});

function driverFacade(){
  const queue=[],fb={kind:'framebuffer'},color={kind:'texture'},depth={kind:'renderbuffer'},oldRenderbuffer={kind:'previous-renderbuffer'};
  let boundFramebuffer=null,boundRenderbuffer=oldRenderbuffer,renderTarget=null,currentProgram=null,attachmentHeight=256,status=36053,drawError=null,attributed=true,submittedCalls=1,inspectionError=null;
  const program={};let calls=0;
  const gl={NO_ERROR:0,NONE:0,FRAMEBUFFER:36160,FRAMEBUFFER_BINDING:36006,FRAMEBUFFER_COMPLETE:36053,FRAMEBUFFER_INCOMPLETE_ATTACHMENT:36054,
    COLOR_ATTACHMENT0:36064,DEPTH_ATTACHMENT:36096,STENCIL_ATTACHMENT:36128,FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:36048,FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:36049,FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL:36050,FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE:36051,
    TEXTURE:5890,RENDERBUFFER:36161,RENDERBUFFER_BINDING:36007,RENDERBUFFER_WIDTH:36162,RENDERBUFFER_HEIGHT:36163,RENDERBUFFER_INTERNAL_FORMAT:36164,RENDERBUFFER_SAMPLES:36011,
    LINK_STATUS:35714,VALIDATE_STATUS:35715,ACTIVE_UNIFORMS:35718,CURRENT_PROGRAM:35725,SHADER_TYPE:35663,VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,
    MAX_TEXTURE_IMAGE_UNITS:34930,MAX_VERTEX_TEXTURE_IMAGE_UNITS:35660,MAX_COMBINED_TEXTURE_IMAGE_UNITS:35661,MAX_3D_TEXTURE_SIZE:32883,
    getParameter(k){return k===36006?boundFramebuffer:k===36007?boundRenderbuffer:k===35725?currentProgram:k===34930||k===35660?16:k===35661?32:k===32883?256:null;},
    checkFramebufferStatus(){if(inspectionError){queue.push(inspectionError);inspectionError=null;}return status;},
    getFramebufferAttachmentParameter(target,a,k){if(k===36048)return a===36064?5890:a===36096?36161:0;if(k===36049)return a===36064?color:depth;if(k===36050)return 0;if(k===36051)return 34069;throw Error('Unexpected attachment query');},
    bindRenderbuffer:(target,value)=>{boundRenderbuffer=value;},getRenderbufferParameter:(target,k)=>k===36162?256:k===36163?attachmentHeight:k===36164?33189:k===36011?0:null,
    getProgramParameter:(p,k)=>k===35714||k===35715?true:k===35718?1:null,
    getAttachedShaders:()=>[{type:35633,source:'void main(){}'},{type:35632,source:'uniform sampler2D roadMaps[14];'}],
    getShaderParameter:s=>s.type,getShaderSource:s=>s.source,getShaderInfoLog:()=>'',getProgramInfoLog:()=>'',
    getActiveUniform:()=>({name:'roadMaps[0]',size:14,type:0x8b5e}),getUniformLocation:()=>1,getUniform:()=>new Int32Array(Array.from({length:14},(_,i)=>i)),
    validateProgram:()=>{},getError:()=>queue.shift()||0,isContextLost:()=>false};
  const renderer={getContext:()=>gl,domElement:{width:1280,height:720},debug:{onShaderError:null},getRenderTarget:()=>renderTarget,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
    setRenderTarget(target){renderTarget=target;boundFramebuffer=target?fb:null;},info:{render:{calls:0}},properties:{get:()=>attributed?({currentProgram:{id:71,cacheKey:'ultra-night',program}}):undefined},
    renderBufferDirect(){currentProgram=program;renderer.info.render.calls+=submittedCalls;calls+=submittedCalls;if(drawError)queue.push(drawError);}};
  const camera={id:9},material={id:21,type:'MeshStandardMaterial',name:'City / scanned asphalt + local puddles'},object={isMesh:true,name:'Canonical road surface',userData:{}};
  const draw=()=>renderer.renderBufferDirect(camera,null,null,material,object);
  return{gl,renderer,camera,queue,draw,oldRenderbuffer,get boundRenderbuffer(){return boundRenderbuffer;},setFault({fboStatus=36053,error=null,depthHeight=256,unattributed=false,submittedDrawCalls=1,diagnosticError=null}={}){status=fboStatus;drawError=error;attachmentHeight=depthHeight;attributed=!unattributed;submittedCalls=submittedDrawCalls;inspectionError=diagnosticError;}};
}
await check('Framebuffer inspection queries the actual attachment and restores renderbuffer binding',()=>{
  const f=driverFacade(),target=new THREE.WebGLCubeRenderTarget(256);f.renderer.setRenderTarget(target);f.setFault({fboStatus:36054,depthHeight:0});
  const inspect=createFramebufferInspector(f.gl,f.renderer),first=inspect(),second=inspect();
  assert.equal(first.complete,false);assert.equal(first.statusName,'FRAMEBUFFER_INCOMPLETE_ATTACHMENT');assert.equal(first.target.kind,'cube');
  assert.equal(first.attachments.find(x=>x.name==='depth').height,0);assert.equal(first.attachments.find(x=>x.name==='color0').cubeFace,34069);
  assert.equal(f.boundRenderbuffer,f.oldRenderbuffer);assert.equal(first.framebufferId,second.framebufferId);assert.equal(first.attachments[0].objectId,second.attachments[0].objectId);
  return first;
});
await check('Linked, validated, under-16 programs fail the actual draw gate on GL1286 and incomplete framebuffer',()=>{
  const f=driverFacade(),audit=createRenderProgramDiagnostics(f.renderer,{primaryCamera:f.camera}),target=new THREE.WebGLCubeRenderTarget(256);target.texture.name='Roadster.vehicle-local-probe';
  audit.beginFrame({quality:'ultra',weather:'wet-night'});f.setFault({fboStatus:36054,error:1286,depthHeight:0});
  audit.withPass('reflections',()=>{f.renderer.setRenderTarget(target);f.draw();});const report=audit.endFrame({requiredCategories:['road']});
  assert.equal(report.status,'failed');assert.equal(report.programs[0].linked,true);assert.equal(report.programs[0].validated,true);assert.equal(report.programs[0].activeSamplerElements,14);
  assert.deepEqual(report.programs[0].glErrors,[1286]);assert.deepEqual(report.observedCategories,[]);
  const event=report.programs[0].draws[0];assert.equal(event.pass,'reflections');assert.equal(report.framebuffers[event.framebuffer].attachments.find(x=>x.name==='depth').height,0);
  assert.ok(report.failures.includes('required-category-not-drawn:road'));assert.equal(report.targetBindings[0].pass,'reflections');audit.dispose();
  return{event,failures:report.failures};
});
await check('Carry-in, pre-draw and draw faults stay separate; a later clean frame cannot rewrite a failed frame',()=>{
  const f=driverFacade(),audit=createRenderProgramDiagnostics(f.renderer,{primaryCamera:f.camera});
  f.queue.push(1281);audit.beginFrame();f.queue.push(1282);f.setFault({error:1286});f.draw();const failed=audit.endFrame();
  assert.deepEqual(failed.priorGlErrors,[1281]);assert.deepEqual(failed.programs[0].preDrawErrors,[1282]);assert.deepEqual(failed.programs[0].glErrors,[1286]);
  f.setFault();audit.beginFrame();f.draw();const clean=audit.endFrame({requiredCategories:['road']});assert.equal(clean.status,'passed');assert.equal(failed.status,'failed');
  audit.dispose();return{failed:failed.failures,clean:clean.status};
});
await check('An attempted draw without a stored program retains its named pass/FBO and all error classes before a later clean draw',()=>{
  // Independently observed before this correction. The original early return
  // discarded drained errors when calls stayed at zero, allowing the following
  // clean road draw to produce a false pass. This is a diagnostic fixture,
  // not a claim about the cause of the user's target-device GL1286 failures.
  const beforeReproduction={sourceSHA256:'e82cfb7742e1931793c6518807f0542d843e442b581b22d6104a0e63b8f1c581',scope:'GL-interface fixture observed before correction; no target GPU',injected:{preDraw:1282,draw:1286},result:{status:'passed',failures:[],drawEvents:1,unattributedDrawCalls:0,programs:[{materials:['City / asphalt'],preDrawErrors:[],glErrors:[]}],remainingGlErrors:[]},failure:'The missing currentProgram branch returned after draining GL1282/GL1286; the original errors and attempted draw were absent from the report.'};
  const f=driverFacade(),audit=createRenderProgramDiagnostics(f.renderer,{primaryCamera:f.camera}),target=new THREE.WebGLCubeRenderTarget(256);target.texture.name='Fixture / missing-program-target';
  audit.beginFrame();audit.withPass('fixture/unattributed-attempt',()=>{
    f.renderer.setRenderTarget(target);f.setFault({unattributed:true,submittedDrawCalls:0,error:1286,diagnosticError:1280});f.queue.push(1282);f.draw();
  });
  f.setFault();audit.withPass('fixture/later-clean-road',()=>{f.renderer.setRenderTarget(null);f.draw();});const report=audit.endFrame({requiredCategories:['road']});
  assert.equal(report.status,'failed');assert.ok(report.failures.includes('unattributed-draw-gl-error'));assert.equal(report.unattributedDrawCalls,0);assert.equal(report.unattributedErrorDraws,1);assert.equal(report.drawCalls,1);assert.equal(report.drawEvents,2);
  const event=report.unattributedDraws[0];assert.equal(report.unattributedDraws.length,1);assert.equal(event.programId,null);assert.equal(event.material,'City / scanned asphalt + local puddles');assert.equal(event.object,'Canonical road surface');assert.equal(event.pass,'fixture/unattributed-attempt');assert.equal(event.cameraId,9);assert.equal(event.drawCalls,0);
  assert.deepEqual(event.preDrawErrors,[1282]);assert.deepEqual(event.drawErrors,[1286]);assert.deepEqual(event.diagnosticErrors,[1280]);const framebuffer=report.framebuffers[event.framebuffer];assert.equal(framebuffer.target.name,'Fixture / missing-program-target');assert.equal(framebuffer.target.width,256);assert.equal(framebuffer.target.height,256);assert.equal(framebuffer.complete,true);
  assert.deepEqual(report.programs[0].preDrawErrors,[]);assert.deepEqual(report.programs[0].glErrors,[]);assert.deepEqual(report.programs[0].diagnosticErrors,[]);assert.deepEqual(report.observedCategories,['road']);assert.deepEqual(report.remainingGlErrors,[]);audit.dispose();target.dispose();
  return{beforeReproduction,after:{status:report.status,failures:report.failures,event,framebuffer,laterCleanProgramDraws:report.programs[0].successfulMainColorDrawCalls}};
});
await check('A clean zero-draw unattributed attempt is retained without false failure; an actual unattributed draw still fails',()=>{
  const outcomes=[];
  for(const submittedDrawCalls of [0,1]){
    const f=driverFacade(),audit=createRenderProgramDiagnostics(f.renderer,{primaryCamera:f.camera});audit.beginFrame();f.setFault({unattributed:true,submittedDrawCalls});f.draw();f.setFault();f.draw();const report=audit.endFrame({requiredCategories:['road']});
    assert.equal(report.unattributedDraws.length,1);assert.equal(report.unattributedDraws[0].drawCalls,submittedDrawCalls);assert.deepEqual(report.unattributedDraws[0].preDrawErrors,[]);assert.deepEqual(report.unattributedDraws[0].drawErrors,[]);assert.deepEqual(report.unattributedDraws[0].diagnosticErrors,[]);assert.equal(report.unattributedErrorDraws,0);assert.equal(report.drawEvents,2);assert.equal(report.drawCalls,submittedDrawCalls+1);assert.equal(report.unattributedDrawCalls,submittedDrawCalls);
    assert.equal(report.status,submittedDrawCalls?'failed':'passed');assert.equal(report.failures.includes('draw-without-program-attribution'),submittedDrawCalls>0);audit.dispose();outcomes.push({submittedDrawCalls,status:report.status,failures:report.failures});
  }
  return{outcomes,scope:'GL-interface rejection semantics; no actual GPU'};
});
await check('Malformed target dimensions fail even if a facade claims framebuffer completeness',()=>{
  const f=driverFacade(),target=new THREE.WebGLCubeRenderTarget(128);target.setSize(256);f.renderer.setRenderTarget(target);
  assert.equal(describeRenderTarget(target,f.renderer).validDimensions,false);
  const audit=createRenderProgramDiagnostics(f.renderer);audit.beginFrame();f.draw();const report=audit.endFrame();assert.equal(report.status,'failed');assert.ok(report.failures.some(x=>x.startsWith('framebuffer-')));audit.dispose();
  return report.framebuffers[0].target;
});

// A valid 1×1 PNG is a labelled packaging fixture, never a renderer output.
const fixturePng=new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')],{type:'image/png'});
const caseResult=item=>({ordinary:{report:{status:'passed',fixture:true,label:item.label}},exported:{report:{status:'passed',fixture:true},conditions:{fixture:true,pixelSource:'1x1 packaging fixture, not WebGL',case:item.label},blob:fixturePng}});
function readStoreZip(bytes){
  const entries=[],view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){const nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),length=view.getUint32(offset+18,true),crc=view.getUint32(offset+14,true);assert.equal(view.getUint16(offset+8,true),0);
    const name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength)),start=offset+30+nameLength+extraLength,data=bytes.subarray(start,start+length);assert.equal(crc32(data),crc);entries.push({name,data});offset=start+length;}
  assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);assert.equal(view.getUint16(bytes.length-12,true),entries.length);return entries;
}
await check('Fourteen completed matrix cases produce an openable STORE ZIP with 14 PNGs, 14 conditions and exact CRCs',async()=>{
  const progress=[],result=await collectProgramMatrix({captureCase:async item=>caseResult(item),onProgress:x=>progress.push(x)});
  assert.equal(result.report.completedFrames,14);assert.equal(result.report.executionStatus,'completed');assert.equal(result.report.drawStatus,'passed');assert.equal(progress.at(-1).completed,14);
  const bytes=new Uint8Array(await (await captureArchive(matrixArchiveFiles(result))).arrayBuffer()),entries=readStoreZip(bytes);
  assert.equal(entries.length,30);assert.equal(entries.filter(x=>x.name.endsWith('.png')).length,14);assert.equal(entries.filter(x=>x.name.endsWith('.json')).length,15);
  for(const entry of entries.filter(x=>x.name.endsWith('.png')))assert.deepEqual(entry.data,new Uint8Array(await fixturePng.arrayBuffer()));
  writeFileSync('/tmp/roadster314-matrix-fixture.zip',bytes);return{entries:entries.length,frames:14,scope:'Archive/orchestration only; fixture pixels are not graphical acceptance'};
});
await check('Completed collection with a failing actual-draw verdict remains failed, not success',async()=>{
  const result=await collectProgramMatrix({captureCase:async item=>{const value=caseResult(item);if(item===CITY_PROGRAM_MATRIX[4])value.exported.report={status:'failed',failures:['draw-gl-error1286']};return value;}});
  assert.equal(result.report.executionStatus,'completed');assert.equal(result.report.drawStatus,'failed');assert.equal(result.report.status,'failed');assert.equal(result.report.completedFrames,14);return result.report.status;
});
await check('Failure during case 4 retains all three preceding original frames and the failed ordinary audit',async()=>{
  let count=0;const result=await collectProgramMatrix({captureCase:async item=>{if(++count===4){const error=Error('PNG encoding timeout');error.partialAudit={status:'failed',priorGlErrors:[1286]};throw error;}return caseResult(item);}});
  assert.equal(result.report.executionStatus,'failed');assert.equal(result.report.completedFrames,3);assert.equal(result.files.length,6);assert.equal(result.report.failure.nextCase,CITY_PROGRAM_MATRIX[3].label);assert.deepEqual(result.report.failure.partialAudit.priorGlErrors,[1286]);
  assert.equal(readStoreZip(new Uint8Array(await (await captureArchive(matrixArchiveFiles(result))).arrayBuffer())).length,8);return result.report.failure;
});
await check('Cancel preserves the exact prefix, leaves missing frames explicit, and still creates an archive',async()=>{
  const controller=new AbortController();const result=await collectProgramMatrix({signal:controller.signal,captureCase:async item=>caseResult(item),onProgress:s=>{if(s.completed===6)controller.abort();}});
  assert.equal(result.report.executionStatus,'cancelled');assert.equal(result.report.completedFrames,6);assert.equal(result.report.expectedFrames,14);assert.equal(result.report.drawStatus,'incomplete');
  const files=readStoreZip(new Uint8Array(await (await captureArchive(matrixArchiveFiles(result))).arrayBuffer()));assert.equal(files.filter(f=>f.name.endsWith('.png')).length,6);return{status:result.report.status,completed:6,missing:8};
});
await check('A missing PNG fails immediately and never substitutes a successful frame or a blank image',async()=>{
  const result=await collectProgramMatrix({captureCase:async()=>({ordinary:{report:{status:'passed'}},exported:{report:{status:'passed'},conditions:{}}})});
  assert.equal(result.report.status,'failed');assert.equal(result.files.length,0);assert.equal(result.report.completedFrames,0);return result.report.failure;
});
const sourceFiles=['dist/cube-probe-target.js','dist/framebuffer-diagnostics.js','dist/render-program-diagnostics.js','dist/render-capture-matrix.js','dist/capture-archive.js'];
writeFileSync(new URL('../qa/framebuffer-matrix-3.14.json',import.meta.url),JSON.stringify({status:'passed',createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,checks,sourceHashes:Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),scope:'Real Three.js CPU resource lifecycle + explicit GL-interface and ZIP fixtures. No current-release target GPU draw, full 14-frame real-image matrix, image quality or performance pass.'},null,2)+'\n');
