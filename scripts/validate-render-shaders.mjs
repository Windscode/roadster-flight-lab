#!/usr/bin/env node
// Offline shader syntax/link validation. This never creates a browser, WebGL
// context, preview server or image, and makes no GPU/performance assertion.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const dist=new URL('../dist/',import.meta.url);
const args=process.argv.slice(2);
let validator=process.env.GLSLANG_VALIDATOR||'glslangValidator';
let reportPath=path.join(root,'qa/render-shader-validation-3.7.json');
for(let i=0;i<args.length;i++){
  if(args[i]==='--validatorPath')validator=args[++i];
  else if(args[i].startsWith('--validatorPath='))validator=args[i].slice(16);
  else if(args[i]==='--report')reportPath=path.resolve(args[++i]);
  else if(args[i]==='--help'){
    console.log('Usage: node scripts/validate-render-shaders.mjs --validatorPath /path/to/glslangValidator [--report qa/render-shader-validation-3.7.json]\nRequires an existing glslangValidator; this script does not download a compiler.');
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
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'roadster-render-shaders-'));
const sourceFiles=['dist/vendor/three.module.js','dist/vendor/three.core.js','dist/exhaust.js','dist/contact-ao-pass.js',
  'dist/vendor/addons/postprocessing/SSAOPass.js','dist/vendor/addons/postprocessing/UnrealBloomPass.js',
  'dist/vendor/addons/postprocessing/OutputPass.js','dist/vendor/addons/shaders/OutputShader.js',
  'dist/vendor/addons/shaders/SSAOShader.js','dist/vendor/addons/shaders/FXAAShader.js',
  'dist/vendor/addons/shaders/SMAAShader.js'];

try{
  const version=await run(validator,['--version']);
  if(version.code!==0)throw Error('Validator failed: '+version.stderr+version.stdout);
  // Reuse the exact vendored Three.js program emitter, including GLSL 3
  // conversion, defines, #include expansion and loop unrolling. The only change
  // to this temporary module is exposing its otherwise-private emitter.
  const moduleSource=await fs.readFile(new URL('vendor/three.module.js',dist),'utf8');
  const modulePath=path.join(temporary,'three-review.mjs');
  const core=JSON.stringify(new URL('vendor/three.core.js',dist).href);
  await fs.writeFile(modulePath,moduleSource.replaceAll("'./three.core.js'",core)+'\nexport {WebGLProgram as ReviewWebGLProgram};\n');
  const THREE=await import(pathToFileURL(modulePath));
  const [{ColdGasExhaust},{ContactAOPass},{FXAAShader},smaa,{OutputPass},{UnrealBloomPass}]=await Promise.all([
    import(new URL('exhaust.js',dist)),import(new URL('contact-ao-pass.js',dist)),
    import(new URL('vendor/addons/shaders/FXAAShader.js',dist)),import(new URL('vendor/addons/shaders/SMAAShader.js',dist)),
    import(new URL('vendor/addons/postprocessing/OutputPass.js',dist)),import(new URL('vendor/addons/postprocessing/UnrealBloomPass.js',dist))
  ]);

  function assemble(material,extra={}){
    const sources=[],captured=Symbol('Sources captured');
    const gl={
      VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,createProgram:()=>({}),createShader:type=>({type}),
      shaderSource:(shader,source)=>sources.push({stage:shader.type===35633?'vert':'frag',source}),
      compileShader(){},attachShader(){},bindAttribLocation(){},linkProgram(){throw captured;}
    };
    const renderer={getContext:()=>gl,debug:{checkShaderErrors:false}};
    const parameters={
      precision:'highp',shaderType:material.isRawShaderMaterial?'RawShaderMaterial':'ShaderMaterial',shaderName:'OfflineReview',
      isRawShaderMaterial:!!material.isRawShaderMaterial,defines:material.defines,
      vertexShader:material.vertexShader,fragmentShader:material.fragmentShader,
      toneMapping:THREE.NoToneMapping,outputColorSpace:THREE.LinearSRGBColorSpace,
      envMap:false,envMapCubeUVHeight:null,numDirLights:0,numSpotLights:0,numPointLights:0,numHemiLights:0,
      numRectAreaLights:0,numDirLightShadows:0,numSpotLightShadows:0,numSpotLightMaps:0,
      numSpotLightShadowsWithMaps:0,numPointLightShadows:0,numClippingPlanes:0,numClipIntersection:0,...extra
    };
    try{new THREE.ReviewWebGLProgram(renderer,'offline-review',parameters,{});}catch(error){if(error!==captured)throw error;}
    if(sources.length!==2)throw Error('Expected one vertex and one fragment shader');
    return sources;
  }

  const results=[];
  const clean=s=>s.split(temporary+path.sep).join('');
  async function compile(name,material,extra={}){
    const shaders=assemble(material,extra),files=[];
    for(const shader of shaders){
      const file=path.join(temporary,name+'.'+shader.stage);files.push(file);await fs.writeFile(file,shader.source);
    }
    const raw=await run(validator,['-l',...files]);
    const item={name,status:raw.code===0?'exact-pass':'fail',exitCode:raw.code,
      sourceHashes:Object.fromEntries(shaders.map(s=>[s.stage,sha256(s.source)])),diagnostics:clean(raw.stdout+raw.stderr)};
    // Some glslang releases reserve `average` even for GLSL ES 3.00; the
    // unmodified Three.js common chunk declares average(vec3). Preserve and
    // report the original failure, then normalize this identifier in temporary
    // validation input only. Production shaders and vendor files stay intact.
    if(raw.code!==0&&/['"]average['"]\s*:\s*function name is redeclaration/.test(item.diagnostics)){
      const normalized=[];
      for(const shader of shaders){
        const file=path.join(temporary,'compiler-normalized-'+name+'.'+shader.stage);
        await fs.writeFile(file,shader.source.replace(/\baverage\b/g,'roadsterReviewAverage'));normalized.push(file);
      }
      const compatibility=await run(validator,['-l',...normalized]);
      item.compilerOnlyCompatibility={replacement:'average → roadsterReviewAverage',
        scope:'Temporary assembled GLSL input only; unmodified stock Three.js common function identifier.',
        passed:compatibility.code===0,exitCode:compatibility.code,diagnostics:clean(compatibility.stdout+compatibility.stderr)};
      if(compatibility.code===0)item.status='compatibility-pass';
    }
    results.push(item);console.log(name+': '+item.status);
  }

  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.07,2300);
  const mist=new ColdGasExhaust(scene,null);
  for(const quality of ['balanced','high']){mist.setQuality(quality);await compile('mist-'+quality,mist.mesh.material);}
  mist.dispose();
  for(const count of [12,20]){
    const ao=new ContactAOPass(scene,camera,1,1,count);
    await compile('ssao-'+count,ao.ssaoMaterial);await compile('ssao-blur-'+count,ao.blurMaterial);ao.dispose();
  }
  await compile('fxaa',FXAAShader);
  for(const [name,shader]of Object.entries(smaa))await compile('smaa-'+name,shader);
  const output=new OutputPass();
  output.material.defines={ACES_FILMIC_TONE_MAPPING:'',SRGB_TRANSFER:''};
  await compile('output-aces-srgb',output.material);output.dispose();
  const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.13,.42,1.35);
  await compile('bloom-highpass',bloom.materialHighPassFilter);
  for(let i=0;i<bloom.separableBlurMaterials.length;i++)await compile('bloom-blur-'+i,bloom.separableBlurMaterials[i]);
  await compile('bloom-composite',bloom.compositeMaterial);bloom.dispose();

  const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,sha256(await fs.readFile(path.join(root,name)))])));
  const report={
    format:'roadster-offline-render-shader-validation-1',createdAt:new Date().toISOString(),
    validator:{name:path.basename(validator),version:version.stdout.trim()},
    method:'Exact vendored Three.js WebGLProgram emitter captured through a fake GL sink; external glslangValidator compiles and links vertex/fragment pairs. No WebGL context is created.',
    scope:'Cold-gas mist quality defines, ContactAO SSAO kernels and depth/normal bilateral blur, FXAA, SMAA, ACES/sRGB OutputPass and UnrealBloom passes. City CSM/GI and surface shaders are validated separately.',
    limitations:['Offline syntax and stage-interface validation only. No browser execution, GPU driver, texture completeness, framebuffer validation, visual inspection or FPS measurement.',
      'Five bloom blur pairs may require a reported compiler-only identifier normalization for the unchanged Three.js common average(vec3) function. Such results are compatibility-pass, not exact-pass.',
      'Built-in beauty/normal/depth material permutations are not exhaustively compiled by this script.'],
    summary:{programPairs:results.length,stages:results.length*2,exactPass:results.filter(r=>r.status==='exact-pass').length,
      compatibilityPass:results.filter(r=>r.status==='compatibility-pass').length,failed:results.filter(r=>r.status==='fail').length},
    sourceHashes,results
  };
  await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary));console.log('Report: '+reportPath);
  if(report.summary.failed)process.exitCode=1;
}finally{await fs.rm(temporary,{recursive:true,force:true});}
