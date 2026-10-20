// Explicit, on-device render acceptance. No WebGL context is emulated here.
// getActiveUniform reports linked uniforms across both shader stages. Counting
// ALL active sampler elements is a conservative fragment-stage upper bound;
// the source-declaration split is diagnostic only, never a driver stage query.
export const RENDER_AUDIT_SCHEMA='roadster.gpu-program-audit-1';
export const TARGET_FRAGMENT_SAMPLERS=16;
const samplerTypes=new Set([0x8b5e,0x8b60,0x8b5f,0x8b62,0x8dc1,0x8dc4,0x8dc5,0x8dca,0x8dcb,0x8dcc,0x8dcf,0x8dd2,0x8dd3,0x8dd4,0x8dd7]);
const copy=value=>JSON.parse(JSON.stringify(value));
const digest=text=>{let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');};
const declaredSamplers=source=>new Set([...source.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?[iu]?sampler\w+\s+([^;]+);/g)].flatMap(match=>match[1].split(',').map(name=>name.trim().match(/^\w+/)?.[0]).filter(Boolean)));
function readErrors(gl){const errors=[];for(let i=0;i<16;i++){const error=gl.getError();if(error===gl.NO_ERROR)break;errors.push(error);}return errors;}
function nameOf(material){return material?.name||`${material?.type||'Unknown material'} #${material?.id??'unknown'}`;}
function ancestry(object){const names=[];for(let node=object;node&&names.length<5;node=node.parent)if(node.name)names.push(node.name);return names;}
function objectKind(object){return object?.isInstancedMesh?'instanced-mesh':object?.isMesh?'mesh':object?.type||'unknown';}
function categoriesOf(object,material){
  const result=[];for(let node=object;node;node=node.parent)if(node.userData?.renderAuditGroup)result.push(node.userData.renderAuditGroup);
  if(/asphalt|road surface/i.test(material?.name||''))result.push('road');
  if(/aged mineral plaster/i.test(material?.name||''))result.push('mineral-facade');
  if(object?.isInstancedMesh&&/Urban\s*\//i.test(material?.name||''))result.push('instanced-building');
  return [...new Set(result)];
}

export function inspectLinkedSamplers(gl,program){
  const linked=Boolean(gl.getProgramParameter(program,gl.LINK_STATUS));
  if(!linked)return {linked:false,activeSamplerElements:null,activeSamplers:null,sourceStageDeclaration:null,programLog:gl.getProgramInfoLog(program)||''};
  const stages={vertex:'',fragment:''};
  for(const shader of gl.getAttachedShaders(program)||[]){const type=gl.getShaderParameter(shader,gl.SHADER_TYPE);if(type===gl.VERTEX_SHADER)stages.vertex=gl.getShaderSource(shader)||'';if(type===gl.FRAGMENT_SHADER)stages.fragment=gl.getShaderSource(shader)||'';}
  const vertex=declaredSamplers(stages.vertex),fragment=declaredSamplers(stages.fragment),activeSamplers=[];
  const count=gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);
  for(let i=0;i<count;i++){
    const uniform=gl.getActiveUniform(program,i);if(!uniform||!samplerTypes.has(uniform.type))continue;
    const root=uniform.name.replace(/\[\d+\]$/,''),location=gl.getUniformLocation(program,uniform.name),raw=location===null?null:gl.getUniform(program,location);
    activeSamplers.push({name:uniform.name,type:uniform.type,size:uniform.size,textureUnits:raw===null?null:ArrayBuffer.isView(raw)?Array.from(raw):[raw],declaredInVertex:vertex.has(root),declaredInFragment:fragment.has(root)});
  }
  return {linked:true,activeSamplerElements:activeSamplers.reduce((sum,s)=>sum+s.size,0),activeSamplers,
    sourceStageDeclaration:{vertex:[...vertex],fragment:[...fragment],scope:'Declarations from the actual attached source; preprocessor-dead declarations may remain. These are not per-stage active-uniform queries.'},
    sources:{vertexFNV1a:digest(stages.vertex),fragmentFNV1a:digest(stages.fragment)},programLog:gl.getProgramInfoLog(program)||''};
}

export function createRenderProgramDiagnostics(renderer,{targetFragmentSamplers=TARGET_FRAGMENT_SAMPLERS,primaryCamera=null}={}){
  const gl=renderer.getContext(),originalDraw=renderer.renderBufferDirect,originalError=renderer.debug.onShaderError;
  let currentMaterial=null,currentObject=null,active=null,lastReport=null,errorCount=0;
  const errors=[],maxErrors=64;
  const limits={fragmentTextureImageUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),vertexTextureImageUnits:gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),combinedTextureImageUnits:gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),max3DTextureSize:gl.MAX_3D_TEXTURE_SIZE?gl.getParameter(gl.MAX_3D_TEXTURE_SIZE):null,targetFragmentSamplers};
  const shaderFailure=(context,program,vertexShader,fragmentShader)=>{
    const event={index:++errorCount,at:new Date().toISOString(),material:nameOf(currentMaterial),materialType:currentMaterial?.type??null,objects:ancestry(currentObject),objectKind:objectKind(currentObject),linked:Boolean(context.getProgramParameter(program,context.LINK_STATUS)),programLog:context.getProgramInfoLog(program)||'',vertexLog:context.getShaderInfoLog(vertexShader)||'',fragmentLog:context.getShaderInfoLog(fragmentShader)||'',vertexSource:context.getShaderSource(vertexShader)||'',fragmentSource:context.getShaderSource(fragmentShader)||''};
    if(errors.length<maxErrors)errors.push(event);
    active?.shaderErrors.push(event);
    // Installing the supported callback replaces Three's default logger, so
    // retain a visible error rather than concealing the original failure.
    console.error('Roadster WebGL program failed:',event.material,event.programLog,event.vertexLog,event.fragmentLog);
    if(typeof originalError==='function')originalError(context,program,vertexShader,fragmentShader);
  };
  renderer.debug.checkShaderErrors=true;renderer.debug.onShaderError=shaderFailure;
  renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group){
    const previousMaterial=currentMaterial,previousObject=currentObject;currentMaterial=material;currentObject=object;
    const before=active?(renderer.info.render.calls||0):0;
    try{
      const value=originalDraw.call(this,camera,scene,geometry,material,object,group);
      if(active){
        const count=(renderer.info.render.calls||0)-before,webglProgram=renderer.properties.get(material)?.currentProgram,program=webglProgram?.program;
        if(!program){if(count>0)active.unattributedDrawCalls+=count;return value;}
        let record=active.programs.get(program);
        if(!record){
          const linked=inspectLinkedSamplers(gl,program),bound=gl.getParameter(gl.CURRENT_PROGRAM)===program;
          // Validation occurs with this draw's real texture bindings in place.
          // A failed link is not queried for uniforms or interpreted as zero.
          if(linked.linked&&bound)gl.validateProgram(program);
          record={programId:webglProgram.id??null,cacheKeyFNV1a:digest(webglProgram.cacheKey||''),...linked,validated:linked.linked&&bound?Boolean(gl.getProgramParameter(program,gl.VALIDATE_STATUS)):false,boundProgramMatches:bound,validationLog:linked.linked?gl.getProgramInfoLog(program)||'':null,materials:[],materialTypes:[],objects:[],objectKinds:[],categories:[],mainColorCategories:[],mainColorDrawCalls:0,cameraIds:[],renderTargets:[],drawCalls:0,glErrors:[],lightingVariants:[]};
          active.programs.set(program,record);
        }
        const name=nameOf(material),kind=objectKind(object),path=ancestry(object).join(' / '),variant=material?.userData?.cityLightingVariant??material?.userData?.roadsterCityLighting??null;
        if(!record.materials.includes(name))record.materials.push(name);
        if(!record.materialTypes.includes(material.type))record.materialTypes.push(material.type);
        if(!record.objectKinds.includes(kind))record.objectKinds.push(kind);
        if(path&&!record.objects.includes(path)&&record.objects.length<24)record.objects.push(path);
        const categories=categoriesOf(object,material);
        for(const category of categories)if(!record.categories.includes(category))record.categories.push(category);
        const mainColor=(!primaryCamera||camera===primaryCamera)&&(material.isMeshStandardMaterial||material.isMeshPhysicalMaterial||['MeshStandardMaterial','MeshPhysicalMaterial'].includes(material.type));
        if(mainColor&&count>0){record.mainColorDrawCalls+=count;for(const category of categories)if(!record.mainColorCategories.includes(category))record.mainColorCategories.push(category);}
        if(!record.cameraIds.includes(camera?.id??null))record.cameraIds.push(camera?.id??null);
        const target=renderer.getRenderTarget?.(),targetLabel=target?`${target.texture?.name||'offscreen'}:${target.width}x${target.height}`:'default-framebuffer';
        if(!record.renderTargets.includes(targetLabel))record.renderTargets.push(targetLabel);
        if(variant&&!record.lightingVariants.some(v=>JSON.stringify(v)===JSON.stringify(variant)))record.lightingVariants.push(copy(variant));
        record.drawCalls+=Math.max(0,count);active.drawCalls+=Math.max(0,count);record.glErrors.push(...readErrors(gl));
      }
      return value;
    }finally{currentMaterial=previousMaterial;currentObject=previousObject;}
  };
  return {
    beginFrame(conditions={}){
      if(active)throw Error('A render-program capture is already in progress.');
      active={conditions:copy(conditions),startedAt:new Date().toISOString(),programs:new Map(),shaderErrors:[],drawCalls:0,unattributedDrawCalls:0,priorGlErrors:readErrors(gl)};
    },
    endFrame(extra={}){
      if(!active)throw Error('No render-program capture is in progress.');
      const frame=active;active=null;const programs=[...frame.programs.values()],remainingGlErrors=readErrors(gl),failures=[];
      if(gl.isContextLost())failures.push('webgl-context-lost');
      if(extra.aborted)failures.push('capture-aborted');
      if(frame.drawCalls===0)failures.push('no-observed-draw-calls');
      if(frame.unattributedDrawCalls)failures.push('draw-without-program-attribution');
      if(frame.shaderErrors.length)failures.push('shader-link-error');
      if(remainingGlErrors.length)failures.push('frame-gl-error');
      const observedCategories=[...new Set(programs.filter(p=>p.mainColorDrawCalls>0&&p.linked&&p.validated&&p.boundProgramMatches&&!p.glErrors.length).flatMap(p=>p.mainColorCategories))];
      for(const required of extra.requiredCategories||[])if(!observedCategories.includes(required))failures.push('required-category-not-drawn:'+required);
      for(const p of programs){
        if(!p.linked||!p.validated||!p.boundProgramMatches)failures.push(`program-${p.programId}-not-runnable`);
        if(p.linked&&p.activeSamplerElements>Math.min(limits.fragmentTextureImageUnits,targetFragmentSamplers))failures.push(`program-${p.programId}-sampler-budget`);
        if(p.glErrors.length)failures.push(`program-${p.programId}-draw-gl-error`);
      }
      lastReport={schema:RENDER_AUDIT_SCHEMA,status:failures.length?'failed':'passed',startedAt:frame.startedAt,finishedAt:new Date().toISOString(),conditions:frame.conditions,...copy(extra),limits,drawCalls:frame.drawCalls,unattributedDrawCalls:frame.unattributedDrawCalls,programCount:programs.length,programs,observedCategories,failures:[...new Set(failures)],priorGlErrors:frame.priorGlErrors,remainingGlErrors,shaderErrors:frame.shaderErrors,
        scope:'Actual WebGL link/validation, active sampler arrays and observed draw submissions on this device. Required categories count only Standard/Physical material color draws through the configured main camera, excluding shadow, normal and reflection-camera passes. All active sampler elements form a conservative fragment budget bound. Successful draws do not establish visual quality, complete city coverage or route performance.'};
      return copy(lastReport);
    },
    snapshot(){return lastReport?copy(lastReport):null;},
    failures(){return {total:errorCount,retained:copy(errors),omitted:Math.max(0,errorCount-errors.length)};},
    get active(){return active!==null;},
    get errorCount(){return errorCount;},
    dispose(){renderer.renderBufferDirect=originalDraw;renderer.debug.onShaderError=originalError;active=null;}
  };
}
