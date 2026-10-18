#!/usr/bin/env node
// Offline GLSL syntax / stage-interface validation only. This script uses an
// existing compiler and never downloads tools or creates a browser / GL context.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as THREE from '../dist/vendor/three.module.js';
import {CSM} from '../dist/vendor/addons/csm/CSM.js';
import {createIndirectLighting} from '../dist/indirect-lighting.js';
import {CITY_RENDER_PRESETS} from '../dist/city-render-budget.js';
import {attachRoadSurface} from '../dist/road-surface-material.js';
import {createLocalProbeSun} from '../dist/local-probe-sun.js';
import {createCityExteriorMaterials} from '../dist/city-exterior-materials.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dist=new URL('../dist/',import.meta.url);
let validator=process.env.GLSLANG_VALIDATOR||'glslangValidator';
let reportPath=path.join(root,'qa/render-shaders-3.6.json');
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  if(args[i]==='--validatorPath')validator=args[++i];
  else if(args[i].startsWith('--validatorPath='))validator=args[i].slice(16);
  else if(args[i]==='--report')reportPath=path.resolve(args[++i]);
  else if(args[i]==='--help'){
    console.log('Usage: node scripts/validate-city-shaders.mjs --validatorPath /path/to/glslangValidator [--report qa/render-shaders-3.6.json]\nRequires an existing glslangValidator; no compiler is downloaded or installed.');
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
  'dist/local-probe-sun.js','dist/road-surface-material.js','dist/city-exterior-materials.js'];

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
  async function compile(name,shader,extra,coverage){
    const shaders=assemble(shader,extra),files=[];
    for(const stage of shaders){const file=path.join(temporary,name+'.'+stage.stage);files.push(file);await fs.writeFile(file,stage.source);}
    const raw=await run(validator,['-l',...files]);
    const item={name,coverage,status:raw.code===0?'exact-pass':'fail',exitCode:raw.code,
      sourceHashes:Object.fromEntries(shaders.map(s=>[s.stage,sha256(s.source)])),diagnostics:clean(raw.stdout+raw.stderr)};
    // Some glslang versions reserve `average` although the stock Three.js
    // common chunk declares average(vec3). Keep the exact diagnostic and limit
    // the compatibility rename to compiler input in this temporary directory.
    if(raw.code!==0&&/['"]average['"]\s*:\s*function name is redeclaration/.test(item.diagnostics)){
      const normalized=[];
      for(const stage of shaders){const file=path.join(temporary,'compiler-normalized-'+name+'.'+stage.stage);normalized.push(file);await fs.writeFile(file,stage.source.replace(/\baverage\b/g,'roadsterReviewAverage'));}
      const compatibility=await run(validator,['-l',...normalized]);
      item.compilerOnlyCompatibility={replacement:'average → roadsterReviewAverage',
        scope:'Temporary assembled GLSL input only; unchanged stock Three.js common function identifier.',
        passed:compatibility.code===0,exitCode:compatibility.code,diagnostics:clean(compatibility.stdout+compatibility.stderr)};
      if(compatibility.code===0)item.status='compatibility-pass';
    }
    results.push(item);console.log(name+': '+item.status);
  }
  const gi=createIndirectLighting({},{fetchAsset:async url=>{
    const bytes=await fs.readFile(url);
    return{ok:true,json:async()=>JSON.parse(bytes.toString('utf8')),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  }});
  await gi.ready;
  const probeSun=createLocalProbeSun(new THREE.Scene(),{}),exterior=createCityExteriorMaterials(THREE);
  const dummyTextures={albedo:new THREE.Texture(),normal:new THREE.Texture(),roughness:new THREE.Texture()};
  for(const quality of ['balanced','high','ultra'])for(const instanced of [false,true])for(const kind of ['standard','physical','asphalt','exterior-concrete','exterior-glass','exterior-enamel']){
    const physical=kind==='physical';
    const profile=CITY_RENDER_PRESETS[quality],count=profile.shadowCascades;
    const csm=new CSM({camera:new THREE.PerspectiveCamera(52,16/9,.1,1800),parent:new THREE.Scene(),
      cascades:count,maxFar:profile.shadowFar,shadowMapSize:profile.shadowSize});
    const material=physical?new THREE.MeshPhysicalMaterial():new THREE.MeshStandardMaterial();
    try{
      if(kind==='asphalt')attachRoadSurface(material,dummyTextures).setQuality(quality);
      if(kind.startsWith('exterior-')){exterior.attach(material,kind.slice(9));exterior.setQuality(quality);}
      const surfaceCompile=material.onBeforeCompile;
      csm.fade=true;csm.setupMaterial(material);gi.setQuality(quality,profile);
      const shader={vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}};
      surfaceCompile.call(material,shader);material.onBeforeCompile(shader);gi.inject(shader);probeSun.inject(shader);
      // CSM mutates the original module's ShaderChunk object. The temporary
      // emitter owns a separate object and must receive those actual mutations.
      Object.assign(emittedTHREE.ShaderChunk,THREE.ShaderChunk);
      const name=quality+'-'+(instanced?'instanced':'single')+'-'+kind;
      const defines={...material.defines};if(physical)defines.PHYSICAL='';
      const coverage={quality,cascades:count,giEvaluation:profile.giMode,instanced,
        material:physical?'Physical with clearcoat, albedo, normal and roughness maps':kind,
        shadowMap:'PCF soft main view; dedicated local sun depth branch in cube capture',environment:'CubeUV IBL',fade:true};
      await compile(name,{...shader,defines},{shaderType:physical?'MeshPhysicalMaterial':'MeshStandardMaterial',shaderName:name,
        instancing:instanced,instancingColor:instanced,vertexColors:false,shadowMapEnabled:true,
        shadowMapType:THREE.PCFSoftShadowMap,numDirLights:count,numDirLightShadows:count,numHemiLights:1,
        envMap:true,envMapMode:THREE.CubeUVReflectionMapping,envMapCubeUVHeight:1024,combine:THREE.MultiplyOperation,
        clearcoat:physical,opaque:!physical,map:physical,mapUv:'uv',normalMap:physical,normalMapTangentSpace:physical,
        normalMapUv:'uv',roughnessMap:physical,roughnessMapUv:'uv'},coverage);
    }finally{csm.remove();csm.dispose();material.dispose();}
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
    method:'Exact vendored Three.js WebGLProgram emitter captured through a fake GL sink, with the live CSM ShaderChunk mutations copied to the temporary emitter. External glslangValidator compiles and links each vertex/fragment pair; no GL context is created.',
    scope:'Balanced vertex irradiance and high/ultra fragment irradiance, 1/2/3 fading CSM cascades, regular/instanced Standard/Physical materials, scanned road and exterior concrete/glass/enamel shaders, dedicated local sun visibility branch and packed-depth capture.',
    limitations:['Offline syntax and stage-interface validation only. No browser execution, GPU driver, texture completeness, framebuffer validation, visual inspection or FPS measurement.',
      'Any compiler-only compatibility rename is recorded alongside the exact failure. Production vendor shaders remain unchanged.',
      'This finite matrix covers the new CSM/GI paths, not every possible material, skinning or morph-target permutation.'],
    summary:{programPairs:results.length,stages:results.length*2,exactPass:results.filter(r=>r.status==='exact-pass').length,
      compatibilityPass:results.filter(r=>r.status==='compatibility-pass').length,failed},sourceHashes,results};
  await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary));console.log('Report: '+reportPath);
  if(failed)process.exitCode=1;
}finally{await fs.rm(temporary,{recursive:true,force:true});}
