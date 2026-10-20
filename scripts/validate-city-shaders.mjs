#!/usr/bin/env node
import {REPORT_VERSION} from './qa-report-version.mjs';
// Offline GLSL syntax, stage-interface and active-sampler AST reflection.
// Uses an existing compiler; never downloads tools or creates a GL context.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as THREE from '../dist/vendor/three.module.js';
import {CSM} from '../dist/vendor/addons/csm/CSM.js';
import {createIndirectLighting} from '../dist/indirect-lighting.js';
import {createNightCityLighting} from '../dist/night-city-lighting.js';
import {createNightDirectLighting} from '../dist/night-direct-lighting.js';
import {injectReceiverPlaneShadows} from '../dist/receiver-plane-shadows.js';
import {CITY_RENDER_PRESETS} from '../dist/city-render-budget.js';
import {attachRoadSurface} from '../dist/road-surface-material.js';
import {attachPavementSurface} from '../dist/pavement-surface-material.js';
import {createLocalProbeSun} from '../dist/local-probe-sun.js';
import {createCityExteriorMaterials} from '../dist/city-exterior-materials.js';
import {cityLightingVariant,injectCityMaterialLighting} from '../dist/city-material-lighting.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dist=new URL('../dist/',import.meta.url);
let validator=process.env.GLSLANG_VALIDATOR||'glslangValidator';
let reportPath=path.join(root,`qa/city-shaders-${REPORT_VERSION}.json`);
let compareBaseline=false;
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  if(args[i]==='--validatorPath')validator=args[++i];
  else if(args[i].startsWith('--validatorPath='))validator=args[i].slice(16);
  else if(args[i]==='--report')reportPath=path.resolve(args[++i]);
  else if(args[i]==='--compareBaseline')compareBaseline=true;
  else if(args[i]==='--help'){
    console.log('Usage: node scripts/validate-city-shaders.mjs --validatorPath /path/to/glslangValidator [--report qa/city-shaders.json] [--compareBaseline]\nRequires an existing glslangValidator; no compiler is downloaded or installed.');
    process.exit(0);
  }else throw Error('Unknown argument: '+args[i]);
}
if(!validator)throw Error('Missing --validatorPath value');
function run(file,argv){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,argv,{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
    child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
  });
}
const sha256=content=>createHash('sha256').update(content).digest('hex');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'roadster-city-shaders-'));
const sourceFiles=['scripts/validate-city-shaders.mjs','dist/vendor/three.module.js','dist/vendor/three.core.js',
  'dist/vendor/addons/csm/CSM.js','dist/vendor/addons/csm/CSMShader.js','dist/indirect-lighting.js',
  'dist/irradiance-math.js','dist/city-render-budget.js','dist/city-environment.js',
  'dist/local-probe-sun.js','dist/pavement-surface-material.js','dist/road-surface-material.js','dist/city-exterior-materials.js','dist/wind-laboratory.js',
  'dist/city-practical-lights.js','dist/wet-road-reflection.js','dist/visual-presets.js','dist/night-city-lighting.js','dist/city-night-transport.js','dist/night-direct-lighting.js','dist/night-direct-transport.js','dist/receiver-plane-shadows.js','dist/city-material-lighting.js','dist/night-field-atlas.js'];

try{
  const version=await run(validator,['--version']);
  if(version.code!==0)throw Error('Validator failed: '+version.stderr+version.stdout);
  // The private emitter resolves the actual vendored GLSL prefixes, #includes
  // and unrolled loops. Only its export and relative core import are changed in
  // this temporary module; no production module is rewritten.
  const moduleSource=await fs.readFile(new URL('vendor/three.module.js',dist),'utf8');
  const modulePath=path.join(temporary,'three-review.mjs');
  const core=JSON.stringify(new URL('vendor/three.core.js',dist).href);
  await fs.writeFile(modulePath,moduleSource.replaceAll("'./three.core.js'",core)+'\nexport {WebGLProgram as ReviewWebGLProgram};\n');
  const emittedTHREE=await import(pathToFileURL(modulePath));
  function assemble(material,extra={}){
    const sources=[],captured=Symbol('Sources captured');
    const gl={VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,createProgram:()=>({}),createShader:type=>({type}),
      shaderSource:(shader,source)=>sources.push({stage:shader.type===35633?'vert':'frag',source}),
      compileShader(){},attachShader(){},bindAttribLocation(){},linkProgram(){throw captured;}};
    const renderer={getContext:()=>gl,debug:{checkShaderErrors:false}};
    const parameters={precision:'highp',shaderType:'MeshStandardMaterial',shaderName:'CityOfflineReview',
      isRawShaderMaterial:false,defines:material.defines,vertexShader:material.vertexShader,fragmentShader:material.fragmentShader,
      toneMapping:THREE.NoToneMapping,outputColorSpace:THREE.LinearSRGBColorSpace,
      envMap:false,envMapCubeUVHeight:null,numDirLights:0,numSpotLights:0,numPointLights:0,numHemiLights:0,
      numRectAreaLights:0,numDirLightShadows:0,numSpotLightShadows:0,numSpotLightMaps:0,
      numSpotLightShadowsWithMaps:0,numPointLightShadows:0,numClippingPlanes:0,numClipIntersection:0,...extra};
    try{new emittedTHREE.ReviewWebGLProgram(renderer,'offline-city-review',parameters,{});}catch(error){if(error!==captured)throw error;}
    if(sources.length!==2)throw Error('Expected one vertex and one fragment shader');
    return sources;
  }
  const results=[],clean=s=>s.split(temporary+path.sep).join('');
  const samplerTypes=new Set(['8b5d','8b5e','8b5f','8b60','8b61','8b62','8b63','8b64','8dc0','8dc1','8dc2','8dc3','8dc4','8dc5','8dca','8dcb','8dcc','8dcf','8dd0','8dd1','8dd2','8dd3','8dd4','8dd7','8dd8','8dd9','8d66','900c','900d','900e','900f','9108','9109','910a','910b','910c','910d']);
  function samplerReflection(output){
    const uniforms=output.split('Uniform reflection:')[1]?.split('Uniform block reflection:')[0]||'';
    const active=[];
    for(const line of uniforms.split('\n')){
      const m=line.match(/^(.+?):.*type ([0-9a-f]+), size (\d+),.*stages (\d+)/i);
      if(m&&samplerTypes.has(m[2].toLowerCase()))active.push({name:m[1],typeHex:m[2].toLowerCase(),arraySize:Number(m[3]),stageMask:Number(m[4])});
    }
    return{method:'glslang linked AST active-uniform reflection; array lengths counted; not driver glGetActiveUniform',active,
      fragmentUnits:active.reduce((n,u)=>n+((u.stageMask&16)?u.arraySize:0),0),
      vertexUnits:active.reduce((n,u)=>n+((u.stageMask&1)?u.arraySize:0),0),
      allStageUnits:active.reduce((n,u)=>n+u.arraySize,0),fragmentLimit:16,vertexLimit:16};
  }
  async function compile(name,shader,extra,coverage){
    const shaders=assemble(shader,extra),files=[];
    const fragment=shaders.find(s=>s.stage==='frag').source;
    if(fragment.includes('roadsterPlaneCompare')){
      const count=varying=>(fragment.match(new RegExp('roadsterGetShadow\\([^\\n;]*'+varying+'\\[\\s*\\d+\\s*\\]','g'))||[]).length;
      coverage.receiverPlaneCalls={directional:count('vDirectionalShadowCoord'),spot:count('vSpotLightCoord')};
      if((extra.numSpotLightShadows||0)>0&&coverage.receiverPlaneCalls.spot<(extra.numSpotLightShadows||0))throw Error(name+': actual emitted spot shadow calls do not use receiver-plane correction');
      if((extra.numDirLightShadows||0)>0&&coverage.receiverPlaneCalls.directional<(extra.numDirLightShadows||0))throw Error(name+': actual emitted directional shadow calls do not use receiver-plane correction');
    }
    for(const stage of shaders){const file=path.join(temporary,name+'.'+stage.stage);files.push(file);await fs.writeFile(file,stage.source);}
    const raw=await run(validator,['-l','-q',...files]);let reflected=raw.stdout,reflectionFiles=files;
    const item={name,coverage,status:raw.code===0?'exact-pass':'fail',exitCode:raw.code,
      sourceHashes:Object.fromEntries(shaders.map(s=>[s.stage,sha256(s.source)])),diagnostics:clean(raw.stdout.split('Uniform reflection:')[0]+raw.stderr)};
    // Some glslang versions reserve `average` although the stock Three.js
    // common chunk declares average(vec3). Keep the exact diagnostic and limit
    // the compatibility rename to compiler input in this temporary directory.
    if(raw.code!==0&&/['"]average['"]\s*:\s*function name is redeclaration/.test(item.diagnostics)){
      const normalized=[];
      for(const stage of shaders){const file=path.join(temporary,'compiler-normalized-'+name+'.'+stage.stage);normalized.push(file);await fs.writeFile(file,stage.source.replace(/\baverage\b/g,'roadsterReviewAverage'));}
      const compatibility=await run(validator,['-l','-q',...normalized]);reflected=compatibility.stdout;reflectionFiles=normalized;
      item.compilerOnlyCompatibility={replacement:'average → roadsterReviewAverage',
        scope:'Temporary assembled GLSL input only; unchanged stock Three.js common function identifier.',
        passed:compatibility.code===0,exitCode:compatibility.code,diagnostics:clean(compatibility.stdout.split('Uniform reflection:')[0]+compatibility.stderr)};
      if(compatibility.code===0)item.status='compatibility-pass';
    }
    if(item.status!=='fail'){
      item.samplers=samplerReflection(reflected);
      // Some glslang versions mark a vertex-only sampler as stage 1|16 in
      // combined AST reflection. Reflect each compiled stage independently;
      // retain the original linked mask as evidence, not as a GPU stage query.
      const perStage=[];
      for(const file of reflectionFiles){const stage=await run(validator,['-l','-q',file]);if(stage.code!==0)throw Error(name+': stage reflection failed');perStage.push(samplerReflection(stage.stdout));}
      const vertex=perStage[0].active,fragment=perStage[1].active;
      for(const active of item.samplers.active){active.linkedStageMask=active.stageMask;active.stageMask=(vertex.some(u=>u.name===active.name)?1:0)|(fragment.some(u=>u.name===active.name)?16:0);}
      item.samplers.fragmentUnits=fragment.reduce((n,u)=>n+u.arraySize,0);
      item.samplers.vertexUnits=vertex.reduce((n,u)=>n+u.arraySize,0);
      item.samplers.method+='; stage masks checked with separate stage AST reflection';
      item.samplers.withinBudget=item.samplers.fragmentUnits<=16&&item.samplers.vertexUnits<=16;
      if(!item.samplers.active.length&&extra.envMap)throw Error(name+': expected active sampler reflection');
      if(!coverage.expectedLegacyOverflow&&!item.samplers.withinBudget)item.status='fail';
      if(coverage.expectedLegacyOverflow&&item.samplers.withinBudget)throw Error(name+': expected the reproduced 3.12 sampler overflow');
    }
    results.push(item);console.log(name+': '+item.status+' / fragment samplers '+(item.samplers?.fragmentUnits??'unavailable'));
  }
  const gi=createIndirectLighting({},{fetchAsset:async url=>{
    const bytes=await fs.readFile(url);
    return{ok:true,json:async()=>JSON.parse(bytes.toString('utf8')),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  }});
  await gi.ready;
  const nightGI=createNightCityLighting({fetchAsset:async url=>{const bytes=await fs.readFile(url);return {ok:true,json:async()=>JSON.parse(bytes.toString('utf8')),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}});await nightGI.ready;
  const nightDirect=createNightDirectLighting({fetchAsset:async url=>{const bytes=await fs.readFile(url);return {ok:true,json:async()=>JSON.parse(bytes.toString('utf8')),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}});await nightDirect.ready;
  const probeSun=createLocalProbeSun(new THREE.Scene(),{}),exterior=createCityExteriorMaterials(THREE);
  const dummyTextures={albedo:new THREE.Texture(),normal:new THREE.Texture(),roughness:new THREE.Texture()};
  for(const quality of ['balanced','high','ultra'])for(const instanced of [false,true])for(const night of [false,true])for(const kind of ['standard','physical','asphalt','pavement','exterior-concrete','exterior-glass','exterior-enamel']){
    // Exterior/night material variants are required by the stationary field.
    const physical=kind==='physical',spots=night?({balanced:3,high:5,ultra:6}[quality]):0;
    gi.setEnabled(!night);nightGI.setEnabled(night);nightGI.setQuality(quality);
    const profile=CITY_RENDER_PRESETS[quality],count=profile.shadowCascades;
    const csm=new CSM({camera:new THREE.PerspectiveCamera(52,16/9,.1,1800),parent:new THREE.Scene(),
      cascades:count,maxFar:profile.shadowFar,shadowMapSize:profile.shadowSize});
    const material=physical?new THREE.MeshPhysicalMaterial():new THREE.MeshStandardMaterial();
    try{
      if(kind==='asphalt')attachRoadSurface(material,dummyTextures).setQuality(quality);
      if(kind==='pavement')attachPavementSurface(material).setWetness(night?1:0);
      if(kind.startsWith('exterior-')){exterior.attach(material,kind.slice(9));exterior.setQuality(quality);}
      const surfaceCompile=material.onBeforeCompile;
      csm.fade=true;csm.setupMaterial(material);gi.setQuality(quality,profile);
      const shader={vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}};
      const variant=cityLightingVariant({quality,night,isStatic:!physical});
      surfaceCompile.call(material,shader);material.onBeforeCompile(shader);injectCityMaterialLighting(shader,{variant,indirect:gi,nightIndirect:nightGI,nightDirect,probeSun});
      // CSM mutates the original module's ShaderChunk object. The temporary
      // emitter owns a separate object and must receive those actual mutations.
      Object.assign(emittedTHREE.ShaderChunk,THREE.ShaderChunk);
      const name=quality+'-'+(night?'wet-night-':'clear-day-')+(instanced?'instanced':'single')+'-'+kind;
      const defines={...material.defines};if(physical)defines.PHYSICAL='';
      const coverage={quality,weather:night?'wet-night':'clear-day',cascades:count,giEvaluation:night?'stationary fixture bounce / six-direction 3D field (daytime bake excluded)':profile.giMode,nightFieldReads:night?nightGI.stats.runtimeTextureReadsPerFragment:0,spotLights:spots,spotShadows:spots,instanced,
        material:physical?'Physical with clearcoat, albedo, normal and roughness maps':kind,
        shadowMap:'PCF soft main view; dedicated local sun depth branch only in daytime probe-capable variants',environment:'CubeUV IBL',fade:true,lightingVariant:variant};
      await compile(name,{...shader,defines},{shaderType:physical?'MeshPhysicalMaterial':'MeshStandardMaterial',shaderName:name,
        instancing:instanced,instancingColor:instanced,vertexColors:false,shadowMapEnabled:true,
        shadowMapType:THREE.PCFSoftShadowMap,numDirLights:count,numDirLightShadows:night?0:count,numHemiLights:1,numSpotLights:spots,numSpotLightShadows:spots,
        envMap:true,envMapMode:THREE.CubeUVReflectionMapping,envMapCubeUVHeight:1024,combine:THREE.MultiplyOperation,
        clearcoat:physical,opaque:!physical,map:physical,mapUv:'uv',normalMap:physical,normalMapTangentSpace:physical,
        normalMapUv:'uv',roughnessMap:physical,roughnessMapUv:'uv'},coverage);
    }finally{csm.remove();csm.dispose();material.dispose();}
  }
  let baseline=null;
  if(compareBaseline){
    const commit='70e98013d6da246c78c4c50ca2ef44595d1f356b',directory=path.join(temporary,'baseline-3.12');
    await fs.mkdir(directory);await fs.symlink(fileURLToPath(new URL('assets/',dist)),path.join(directory,'assets'),'dir');
    const hashes={};
    for(const name of ['indirect-lighting.js','night-city-lighting.js','night-direct-lighting.js']){
      const original=await run('git',['-C',root,'show',commit+':dist/'+name]);
      if(original.code!==0)throw Error('Cannot load frozen published 3.12 '+name);
      hashes['dist/'+name]=sha256(original.stdout);
      const adjusted=original.stdout
        .replaceAll("'./vendor/three.module.js'",JSON.stringify(new URL('vendor/three.module.js',dist).href))
        .replaceAll("'./irradiance-math.js'",JSON.stringify(new URL('irradiance-math.js',dist).href))
        .replaceAll("'./city-night-transport.js'",JSON.stringify(new URL('city-night-transport.js',dist).href));
      await fs.writeFile(path.join(directory,name),adjusted);
    }
    await fs.writeFile(path.join(directory,'package.json'),'{"type":"module"}');
    const originalBinding=await run('git',['-C',root,'show',commit+':dist/city-environment.js']);
    if(originalBinding.code!==0||!originalBinding.stdout.includes('indirect.inject(shader);nightIndirect.inject(shader);probeSun.inject(shader);if(staticMaterials.has(mat))nightDirect.inject(shader);'))throw Error('Frozen baseline injection order changed');
    hashes['dist/city-environment.js']=sha256(originalBinding.stdout);
    const fetchAsset=async url=>{const bytes=await fs.readFile(url);return{ok:true,json:async()=>JSON.parse(bytes.toString('utf8')),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};};
    const oldGI=(await import(pathToFileURL(path.join(directory,'indirect-lighting.js')))).createIndirectLighting({},{fetchAsset});
    const oldNight=(await import(pathToFileURL(path.join(directory,'night-city-lighting.js')))).createNightCityLighting({fetchAsset});
    const oldDirect=(await import(pathToFileURL(path.join(directory,'night-direct-lighting.js')))).createNightDirectLighting({fetchAsset});
    await Promise.all([oldGI.ready,oldNight.ready,oldDirect.ready]);
    for(const quality of ['balanced','high','ultra'])for(const kind of ['asphalt','exterior-concrete']){
      const profile=CITY_RENDER_PRESETS[quality],spots=quality==='balanced'?3:quality==='high'?5:6,csm=new CSM({camera:new THREE.PerspectiveCamera(52,16/9,.1,1800),parent:new THREE.Scene(),cascades:profile.shadowCascades,maxFar:profile.shadowFar,shadowMapSize:profile.shadowSize});
      const material=new THREE.MeshStandardMaterial();
      try{
        if(kind==='asphalt')attachRoadSurface(material,dummyTextures).setQuality(quality);
        else{exterior.attach(material,'concrete');exterior.setQuality(quality);}
        const surfaceCompile=material.onBeforeCompile;csm.fade=true;csm.setupMaterial(material);
        oldGI.setQuality(quality,profile);oldGI.setEnabled(false);oldNight.setQuality(quality);oldNight.setEnabled(true);oldDirect.setQuality(quality);oldDirect.setEnabled(true);
        const shader={vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}};
        surfaceCompile.call(material,shader);material.onBeforeCompile(shader);oldGI.inject(shader);oldNight.inject(shader);probeSun.inject(shader);oldDirect.inject(shader);injectReceiverPlaneShadows(shader);
        Object.assign(emittedTHREE.ShaderChunk,THREE.ShaderChunk);
        const name='baseline-3.12-'+quality+'-wet-night-instanced-'+kind;
        await compile(name,{...shader,defines:{...material.defines}},{shaderType:'MeshStandardMaterial',shaderName:name,instancing:true,instancingColor:true,shadowMapEnabled:true,shadowMapType:THREE.PCFSoftShadowMap,numDirLights:profile.shadowCascades,numDirLightShadows:0,numHemiLights:1,numSpotLights:spots,numSpotLightShadows:spots,envMap:true,envMapMode:THREE.CubeUVReflectionMapping,envMapCubeUVHeight:1024,combine:THREE.MultiplyOperation,opaque:true},
          {baselineCommit:commit,expectedLegacyOverflow:quality!=='balanced',quality,weather:'wet-night',material:kind,instanced:true,spotShadows:spots,dayGIReady:0,probeSunActive:0,unchangedSurfaceInjector:true});
      }finally{csm.remove();csm.dispose();material.dispose();}
    }
    baseline={commit,sourceHashes:hashes,scope:'Frozen published lighting shader code and exact unconditional injection order; asset coefficients do not affect sampler liveness; material texture injectors are unchanged.'};
  }
  // The lab shares Three.js with the city, whose CSM rewrites ShaderChunk
  // globally. Its ordinary single-key materials must still compile without
  // city CSM or irradiance defines when we switch contexts in the same page.
  Object.assign(emittedTHREE.ShaderChunk,THREE.ShaderChunk);
  for(const physical of [false,true])for(const instanced of [false,true]){
    const name='windlab-'+(physical?'physical':'standard')+'-'+(instanced?'instanced':'single');
    await compile(name,{...THREE.ShaderLib.physical,defines:physical?{PHYSICAL:''}:{}},{
      shaderType:physical?'MeshPhysicalMaterial':'MeshStandardMaterial',shaderName:name,
      instancing:instanced,instancingColor:instanced,vertexColors:false,shadowMapEnabled:true,
      shadowMapType:THREE.PCFSoftShadowMap,numDirLights:2,numDirLightShadows:1,numHemiLights:1,
      envMap:true,envMapMode:THREE.CubeUVReflectionMapping,envMapCubeUVHeight:512,combine:THREE.MultiplyOperation,
      clearcoat:physical,opaque:true,map:true,mapUv:'uv',roughnessMap:false,
    },{context:'windlab',cityCSM:false,cityGI:false,globalCityShaderChunksStillPresent:true,
      lights:'One shadowed key, one unshadowed fill, hemisphere',environment:'Static indoor CubeUV PMREM'});
  }
  // The inspection page has no city material injector. Exercise the actual
  // standalone correction used by body/clearcoat and the diffuse isolation.
  for(const kind of ['standard','physical','lambert']){
    const physical=kind==='physical',base=kind==='lambert'?THREE.ShaderLib.lambert:THREE.ShaderLib.physical,
      shader={vertexShader:base.vertexShader,fragmentShader:base.fragmentShader,uniforms:{},defines:physical?{PHYSICAL:''}:{}};
    injectReceiverPlaneShadows(shader);
    await compile('inspection-'+kind+'-receiver-plane',shader,{
      shaderType:kind==='lambert'?'MeshLambertMaterial':physical?'MeshPhysicalMaterial':'MeshStandardMaterial',shaderName:'InspectionReceiverPlane',
      shadowMapEnabled:true,shadowMapType:THREE.PCFSoftShadowMap,numDirLights:2,numDirLightShadows:1,numHemiLights:1,
      envMap:kind!=='lambert',envMapMode:THREE.CubeUVReflectionMapping,envMapCubeUVHeight:512,combine:THREE.MultiplyOperation,
      clearcoat:physical,opaque:true,doubleSided:kind==='lambert'
    },{context:'vehicle-inspection',cityCSM:false,cityGI:false,material:kind,standaloneReceiverPlaneCorrection:true});
  }
  const depthShader=THREE.ShaderLib.depth;
  await compile('probe-packed-depth-opaque',{...depthShader,defines:{}},{shaderType:'MeshDepthMaterial',shaderName:'ProbeSunDepth',
    useDepthPacking:true,depthPacking:THREE.RGBADepthPacking,doubleSided:true},
    {material:'Double-sided opaque RGBADepthPacking; local orthographic solar visibility capture'});
  probeSun.dispose();exterior.dispose();
  const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,sha256(await fs.readFile(path.join(root,name)))])));
  const failed=results.filter(r=>r.status==='fail').length;
  const report={format:'roadster-offline-city-shader-validation-1',createdAt:new Date().toISOString(),status:failed?'failed':'passed',
    validator:{name:path.basename(validator),version:version.stdout.trim()},
    method:'Exact vendored Three.js WebGLProgram emitter captured through a fake GL sink, with the live CSM ShaderChunk mutations copied to the temporary emitter. External glslangValidator compiles/links each pair and reflects active sampler arrays in the linked program and individual stages against a 16-unit stage budget; no GL context is created.',
    scope:'Balanced vertex irradiance and high/ultra fragment irradiance, 1/2/3 fading CSM cascades, regular/instanced Standard/Physical materials, day/wet-night spotlight and scanned wet-reflection road, metric paving and exterior concrete/glass/enamel shaders, dedicated local sun visibility branch, packed-depth capture and plain wind-lab PBR materials after city CSM globally changes ShaderChunk.',
    limitations:['Offline syntax, stage-interface and AST sampler reflection only. No browser execution, GPU driver, texture completeness, framebuffer validation, visual inspection or FPS measurement.',
      'Any compiler-only compatibility rename is recorded alongside the exact failure. Production vendor shaders remain unchanged.',
      'Sampler counts are final-emitted linked/stage AST active-uniform reflection with array lengths, not a target GPU driver query. Live GPU link/draw acceptance remains separate.',
      'This finite matrix covers the new CSM/GI paths, not every possible material, skinning or morph-target permutation.'],
    baseline,
    summary:{programPairs:results.length,stages:results.length*2,exactPass:results.filter(r=>r.status==='exact-pass').length,
      compatibilityPass:results.filter(r=>r.status==='compatibility-pass').length,failed,
      currentMaximumFragmentSamplers:Math.max(...results.filter(r=>!r.coverage.baselineCommit).map(r=>r.samplers?.fragmentUnits??0)),
      currentSamplerBudgetFailures:results.filter(r=>!r.coverage.baselineCommit&&!r.samplers?.withinBudget).length,
      reproducedLegacyOverBudget:results.filter(r=>r.coverage.expectedLegacyOverflow&&!r.samplers?.withinBudget).length},sourceHashes,results};
  await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary));console.log('Report: '+reportPath);
  if(failed)process.exitCode=1;
}finally{await fs.rm(temporary,{recursive:true,force:true});}
