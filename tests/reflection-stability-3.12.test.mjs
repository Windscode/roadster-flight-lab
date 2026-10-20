import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {createRoadster} from '../dist/vehicle.js';
import {CITY_BENCHMARK_ROUTE} from '../dist/visual-presets.js';
import {createCityPracticalLights} from '../dist/city-practical-lights.js';
import {attachRoadSurface} from '../dist/road-surface-material.js';
import {createWetRoadReflection,wetReflectionDomainWeight,WET_REFLECTION_DOMAIN} from '../dist/wet-road-reflection.js';
import {createWetRoadReflection as createBaselineReflection} from '../qa/fixtures/baseline-3.11/wet-road-reflection.js';

// This fixture records CPU render submissions and state, without a framebuffer.
// It must never be presented as a rendered image or a GPU/frame-rate benchmark.
const checks=[],evidence={},test=(name,fn)=>{fn();checks.push({name,status:'passed'});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['dist/wet-road-reflection.js','dist/road-surface-material.js','dist/city-environment.js'];
const manifest=JSON.parse(readFileSync(new URL('../qa/fixtures/baseline-3.11/manifest.json',import.meta.url),'utf8'));
const sources=Object.fromEntries(sourceFiles.map(path=>[path,hash(readFileSync(new URL('../'+path,import.meta.url)))]));

function rendererStub(){
  let target={name:'main'},face=2,mip=1,viewport=new THREE.Vector4(7,8,600,350),scissor=new THREE.Vector4(1,2,500,300),scissorTest=true;
  return {xr:{enabled:true},shadowMap:{autoUpdate:true,needsUpdate:true},calls:0,fail:false,
    getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
    getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,
    setViewport:v=>viewport.copy(v),setScissor:v=>scissor.copy(v),setScissorTest:v=>scissorTest=v,
    setRenderTarget:(v,f=0,m=0)=>{target=v;face=f;mip=m;},clear(){},
    render(){this.calls++;if(this.fail)throw Error('controlled reflection framebuffer failure');}};
}

function rig(create=createWetRoadReflection,quality='high'){
  const scene=new THREE.Scene(),renderer=rendererStub(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300);
  camera.position.set(-200,2,-300);camera.lookAt(-200,2,-260);camera.updateMatrixWorld(true);
  const geometry=new THREE.BoxGeometry(1.9,1.1,4.5),material=new THREE.MeshStandardMaterial(),root=new THREE.Group(),body=new THREE.Mesh(geometry,material);
  root.position.set(-200,.74,-275);root.add(body);scene.add(root);
  const textures={albedo:new THREE.Texture(),normal:new THREE.Texture(),roughness:new THREE.Texture()},roadMaterial=new THREE.MeshStandardMaterial();
  const surface=attachRoadSurface(roadMaterial,textures),reflection=create(scene,renderer,camera,surface);
  reflection.configure(quality);reflection.setEnabled(true);
  const lights=[{id:'known-street-fixture',position:[-204,7,-275],target:[-201,0,-277],intensity:1000,gain:1}];
  const render=time=>reflection.render(time,[],{dynamicRoot:root,practicalLights:lights});
  const dispose=()=>{reflection.dispose();geometry.dispose();material.dispose();roadMaterial.dispose();Object.values(textures).forEach(t=>t.dispose());};
  return {scene,renderer,camera,root,body,material,roadMaterial,surface,reflection,lights,render,dispose};
}

function cadence(create,quality,mode,{hz=60,duration=2}={}){
  const r=rig(create,quality),times=[];
  for(let frame=0;frame<=duration*hz;frame++){
    const time=frame/hz;
    if(mode==='vehicle')r.root.position.z=-275+time*10;
    if(mode==='light'){r.lights[0].intensity=1000*time/duration;r.lights[0].gain=time/duration;}
    if(r.render(time))times.push(time);
    assert.ok(r.reflection.stats.passesThisFrame<=1);
  }
  const intervals=times.slice(1).map((time,i)=>time-times[i]);
  const result={quality,mode,attemptedRefreshHz:hz,durationS:duration,configuredMaximumHz:r.reflection.stats.maximumHz,
    targetSize:[r.reflection.stats.width,r.reflection.stats.height],captures:times.length,captureTimesS:times,
    minimumIntervalS:Math.min(...intervals),maximumIntervalS:Math.max(...intervals),
    meanInterCaptureHz:intervals.length/(times.at(-1)-times[0]),dynamicRefreshes:r.reflection.stats.dynamicRefreshes??null};
  assert.ok(result.minimumIntervalS>=1/result.configuredMaximumHz-1e-9);
  r.dispose();return result;
}

test('The 3.11 fixture reconstructs the published source byte-for-byte after its sole import rewrite',()=>{
  const bytes=readFileSync(new URL('../'+manifest.fixturePath,import.meta.url));
  assert.equal(hash(bytes),manifest.fixtureSha256);
  const text=bytes.toString(),{from,to,occurrences}=manifest.adaptation;
  assert.equal(text.split(to).length-1,occurrences);assert.equal(hash(text.replace(to,from)),manifest.sourceSha256);
  evidence.baseline={...manifest,fixtureVerified:true};
});

test('A moving vehicle at a fixed camera uses the existing high/ultra capture budgets instead of the idle timer',()=>{
  const rows=[];
  for(const quality of ['high','ultra']){
    const before=cadence(createBaselineReflection,quality,'vehicle'),after=cadence(createWetRoadReflection,quality,'vehicle');
    assert.equal(before.captures,6);assert.ok(before.maximumIntervalS>=.35-1e-9);
    assert.equal(after.captures,quality==='high'?25:41);
    assert.ok(after.maximumIntervalS<=1/after.configuredMaximumHz+1e-9);
    assert.deepEqual(after.targetSize,before.targetSize);assert.equal(after.configuredMaximumHz,before.configuredMaximumHz);
    rows.push({before,after});
  }
  evidence.fixedCameraVehicleMotion={vehicleSpeedMps:10,rootStartM:[-200,.74,-275],cameraPositionM:[-200,2,-300],cameraTargetM:[-200,2,-260],rows};
});

test('Actual selected-light fade values also invalidate a fixed view with a motionless car',()=>{
  const before=cadence(createBaselineReflection,'high','light'),after=cadence(createWetRoadReflection,'high','light');
  assert.equal(before.captures,6);assert.equal(after.captures,25);
  const r=rig();assert.ok(r.render(0));r.lights[0].id='replacement-fixture-at-same-position';
  assert.equal(r.render(.02),false);assert.equal(r.render(.1),true);assert.equal(r.reflection.stats.lastCaptureReason,'dynamic-source');r.dispose();
  evidence.fixedCameraLightFade={intensityRamp:[0,1000],gainRamp:[0,1],before,after,identityChangeRespectsRateCap:true};
});

test('The production practical pool fade is observed without moving the camera or changing lamp power assumptions',()=>{
  const r=rig(),anchors=[{id:'fixture-a',position:[-203,7,-290],target:[-199,0,-284],role:'street',range:29,intensity:1750},
    {id:'fixture-b',position:[-196,6,-278],target:[-201,0,-274],role:'street',range:27,intensity:1500}];
  const pool=createCityPracticalLights(r.scene,anchors);pool.configure('high');pool.setEnabled(true);const times=[],states=[];
  for(let frame=0;frame<=120;frame++){
    const time=frame/60;pool.update(time,r.camera.position,r.camera);
    if(r.reflection.render(time,[],{dynamicRoot:r.root,practicalLights:pool.stats.selected})){times.push(time);states.push(pool.stats.selected.map(({id,intensity,gain})=>({id,intensity,gain})));}
  }
  assert.ok(times.length>=15,'The real lamp pool fade must not fall back to the idle-camera schedule');
  assert.ok(times.slice(1).every((t,i)=>t-times[i]>=1/12-1e-9));assert.equal(r.reflection.stats.sourceLights,pool.stats.selected.length);
  assert.ok(states.at(-1).every(l=>l.gain>.999));
  evidence.actualPracticalPool={quality:'high',attemptedRefreshHz:60,durationS:2,captureTimesS:times,firstCaptureLights:states[0],lastCaptureLights:states.at(-1),sourceLightCount:r.reflection.stats.sourceLights};
  pool.dispose();r.dispose();
});

test('An actually static scene keeps the former idle reuse and motion cannot exceed either cap at high call rates',()=>{
  const rows=[];
  for(const quality of ['high','ultra']){
    const before=cadence(createBaselineReflection,quality,'static'),after=cadence(createWetRoadReflection,quality,'static');
    assert.deepEqual(after.captureTimesS,before.captureTimesS);
    const attempts=cadence(createWetRoadReflection,quality,'vehicle',{hz:1000,duration:1});
    assert.ok(attempts.captures<=attempts.configuredMaximumHz+1);
    rows.push({quality,staticCaptureTimesS:after.captureTimesS,highFrequencyAttempts:attempts});
  }
  evidence.staticAndCap=rows;
});

test('Real Roadster wheel, physical-wing display, seal deformation and brake-lamp changes are detected with an unchanged root',()=>{
  const r=rig(),car=createRoadster({quality:'high'});car.group.position.copy(r.root.position);r.scene.remove(r.root);r.scene.add(car.group);
  car.update({},0);const rootPose={position:car.group.position.toArray(),quaternion:car.group.quaternion.toArray()},rows=[];
  const capture=t=>r.reflection.render(t,[],{dynamicRoot:car.group,practicalLights:r.lights});
  assert.ok(capture(0));const originalCount=r.reflection.stats.sourceObjects;
  const mutations=[
    ['wheel-spin',()=>car.wheels[0].spin.rotation.x+=.28],
    ['physical-wing-display',()=>car.update({wing:{deployment:.42,position:{x:0,y:.451,z:-2.065},incidenceRad:-.105}},0)],
    ['seal-buffer-deformation',()=>car.chamber.update({contactCount:4,suctionEnabled:true},0)],
    ['brake-lamp',()=>{car.materials.tailLight.emissiveIntensity=2.4;}],
    ['paint-colour',()=>car.setColor(0x1e5469)]
  ];
  mutations.forEach(([id,mutate],i)=>{const time=(i+1)*.1;mutate();assert.equal(capture(time-.05),false,id+' bypassed the cap');assert.equal(capture(time),true,id+' left a stale capture');rows.push({id,timeS:time,reason:r.reflection.stats.lastCaptureReason});});
  assert.deepEqual(car.group.position.toArray(),rootPose.position);assert.deepEqual(car.group.quaternion.toArray(),rootPose.quaternion);
  assert.ok(originalCount>50&&originalCount<500);assert.ok(r.reflection.stats.sourceMaterials<originalCount);
  assert.equal(capture(.61),false,'Unchanged car must return to idle reuse');
  evidence.realVehicleSubtree={rootUnchanged:true,visibleObjects:originalCount,distinctMaterials:r.reflection.stats.sourceMaterials,mutations:rows,wholeCityTraversedForInvalidation:false};
  car.dispose();r.dispose();
});

test('Root-parent movement, visibility and LOD membership changes are captured even with unchanged local root coordinates',()=>{
  const r=rig(),parent=new THREE.Group();r.scene.add(parent);parent.add(r.root);assert.ok(r.render(0));
  parent.position.z+=1;assert.ok(r.render(.1));r.body.visible=false;assert.ok(r.render(.2));r.body.visible=true;assert.ok(r.render(.3));
  const replacement=r.body.clone();r.root.remove(r.body);r.root.add(replacement);assert.ok(r.render(.4));
  evidence.sceneMembership={parentWorldTransform:true,hiddenAndRestoredChild:true,replacedVisibleObject:true};r.dispose();
});

test('Fixed-pose lens changes invalidate the old projection without changing the original 400 m bounded pass',()=>{
  const before=rig(createBaselineReflection),after=rig();
  for(const r of [before,after]){assert.ok(r.render(0));r.camera.fov=52;r.camera.updateProjectionMatrix();}
  assert.equal(before.render(.1),false);assert.equal(after.render(.02),false);assert.equal(after.render(.1),true);
  assert.equal(after.reflection.stats.projectionFarM,400);assert.equal(after.camera.far,2300);
  after.camera.setViewOffset(1280,720,20,0,1260,720);assert.ok(after.render(.2));
  evidence.lensInvalidation={beforeFovRefreshAt100ms:false,afterFovRefreshAt100ms:true,subviewRefresh:true,mainFarM:2300,reflectionFarM:400};before.dispose();after.dispose();
});

test('The camera-domain coefficient fades inside the old district instead of switching from one to zero at its edge',()=>{
  const before=rig(createBaselineReflection),after=rig(),heights=[14,15,16,17,17.5,17.9,17.99,18.01],rows=[];
  for(const [i,y]of heights.entries()){
    for(const r of [before,after]){r.camera.position.y=y;r.camera.updateMatrixWorld(true);r.render(i*.4);}
    const oldCoefficient=before.surface.uniforms.roadReflectionEnabled.value,newCoefficient=after.surface.uniforms.roadReflectionEnabled.value*after.surface.uniforms.roadReflectionStrength.value;
    rows.push({cameraHeightM:y,beforeDomainCoefficient:oldCoefficient,afterDomainCoefficient:newCoefficient});
  }
  assert.equal(rows.at(-2).beforeDomainCoefficient,1);assert.equal(rows.at(-1).beforeDomainCoefficient,0);
  assert.ok(rows.at(-2).afterDomainCoefficient<.00002);assert.equal(rows.at(-1).afterDomainCoefficient,0);
  assert.equal(rows[0].afterDomainCoefficient,1);assert.ok(rows.slice(1).every((row,i)=>row.afterDomainCoefficient<=rows[i].afterDomainCoefficient));
  const edges=[];
  for(const [axis,boundary,inward]of [['x',-245,1],['x',145,-1],['z',-425,1],['z',-105,-1]]){
    const at=offset=>wetReflectionDomainWeight({...{x:-100,y:2,z:-250},[axis]:boundary+inward*offset});
    assert.equal(at(-.01),0);assert.equal(at(0),0);assert.ok(at(.01)<.000003);assert.equal(at(12),1);
    edges.push({axis,boundaryM:boundary,weightOutside:at(-.01),weightAt1cmInside:at(.01),weightAt6mInside:at(6),weightAt12mInside:at(12)});
  }
  assert.equal(wetReflectionDomainWeight({x:-100,y:.16,z:-250}),0);assert.equal(wetReflectionDomainWeight({x:-100,y:.56,z:-250}),1);
  for(const p of [null,{x:NaN,y:2,z:-250},{x:-100,y:Infinity,z:-250},{x:-100,y:2,z:undefined}])assert.equal(wetReflectionDomainWeight(p),0);
  const fixedViews=CITY_BENCHMARK_ROUTE.cameras.map(c=>({id:c.id,weight:wetReflectionDomainWeight(new THREE.Vector3(...c.position))}));assert.ok(fixedViews.every(c=>c.weight===1));
  evidence.domainFade={domain:WET_REFLECTION_DOMAIN,heightSweep:rows,horizontalEdges:edges,existingFixedViews:fixedViews,
    interpretation:'Coefficients of the planar-for-environment specular replacement, not measured pixel luminance or brightness improvement.'};before.dispose();after.dispose();
});

test('Cached texture frames update the blend every displayed frame without spending an extra capture',()=>{
  const r=rig();r.camera.position.y=16;assert.ok(r.render(0));const before=r.surface.uniforms.roadReflectionStrength.value,passes=r.renderer.calls;
  r.camera.position.y=16.08;assert.equal(r.render(1/240),false);
  const after=r.surface.uniforms.roadReflectionStrength.value;assert.ok(after<before);assert.equal(r.renderer.calls,passes);assert.equal(r.surface.uniforms.roadReflectionEnabled.value,1);
  r.camera.position.y=18.01;assert.equal(r.render(2/240),false);assert.equal(r.surface.uniforms.roadReflectionEnabled.value,0);assert.equal(r.surface.uniforms.roadReflectionStrength.value,0);
  evidence.cachedFrameBlend={initialHeightM:16,nextHeightM:16.08,initialCoefficient:before,nextCoefficient:after,additionalCaptures:0,outsideDisabled:true};r.dispose();
});

test('Shader fade weights the entire planar/environment replacement and preserves the five existing reflection taps',()=>{
  const r=rig(),shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  r.roadMaterial.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.roadReflectionStrength,r.surface.uniforms.roadReflectionStrength);
  const declaration=shader.fragmentShader.match(/float roadReflectionMask=([^;]+);/)[1];assert.ok(declaration.startsWith('roadReflectionStrength*'));
  assert.ok(shader.fragmentShader.includes('(roadReflected*roadFresnel-reflectedLight.indirectSpecular)*roadWater*roadReflectionMask'));
  assert.equal((shader.fragmentShader.match(/texture2D\(roadReflection,/g)||[]).length,5);
  // Endpoint/midpoint oracle: the same coefficient must blend the two complete
  // alternatives; scaling just the added planar colour leaves a dark boundary.
  const samples=[];
  for(const weight of [0,.25,.5,.75,1]){
    const baseDiffuse=.7,environment=.24,planar=.46,puddleCoverage=.6;
    const result=baseDiffuse+environment+(planar-environment)*puddleCoverage*weight;
    const alternative=baseDiffuse+environment*(1-puddleCoverage*weight)+planar*puddleCoverage*weight;
    assert.ok(Math.abs(result-alternative)<1e-14);samples.push({weight,linearSpecularExample:result-baseDiffuse});
  }
  evidence.shaderWeighting={replacementWeightedAsAWhole:true,planarTextureReads:5,extraTextureReads:0,exampleSamples:samples,
    scope:'Material hook wiring and scalar composition only; this test does not compile a GPU shader or produce pixels.'};r.dispose();
});

test('A failed pass preserves the last good projection and all existing visibility/render state while disabling invalid reflection data',()=>{
  const r=rig(),far=r.body.clone();far.position.set(-200,2,350);r.scene.add(far);const hidden=far.clone();hidden.visible=false;r.scene.add(hidden);
  const excluded=new THREE.Group();excluded.visible=true;r.scene.add(excluded);assert.ok(r.render(0));
  const old={target:r.renderer.getRenderTarget(),face:r.renderer.getActiveCubeFace(),mip:r.renderer.getActiveMipmapLevel(),viewport:r.renderer.getViewport(new THREE.Vector4()).toArray(),scissor:r.renderer.getScissor(new THREE.Vector4()).toArray(),scissorTest:r.renderer.getScissorTest(),xr:r.renderer.xr.enabled,shadowAuto:r.renderer.shadowMap.autoUpdate,shadowNeeded:r.renderer.shadowMap.needsUpdate,matrix:r.surface.uniforms.roadReflectionMatrix.value.toArray()};
  r.root.position.z+=1;r.renderer.fail=true;
  assert.throws(()=>r.reflection.render(.1,[excluded],{dynamicRoot:r.root,practicalLights:r.lights}),/controlled reflection/);
  assert.equal(r.renderer.getRenderTarget(),old.target);assert.equal(r.renderer.getActiveCubeFace(),old.face);assert.equal(r.renderer.getActiveMipmapLevel(),old.mip);
  assert.deepEqual(r.renderer.getViewport(new THREE.Vector4()).toArray(),old.viewport);assert.deepEqual(r.renderer.getScissor(new THREE.Vector4()).toArray(),old.scissor);assert.equal(r.renderer.getScissorTest(),old.scissorTest);
  assert.equal(r.renderer.xr.enabled,old.xr);assert.equal(r.renderer.shadowMap.autoUpdate,old.shadowAuto);assert.equal(r.renderer.shadowMap.needsUpdate,old.shadowNeeded);
  assert.ok(far.visible&&excluded.visible);assert.equal(hidden.visible,false);assert.equal(r.surface.uniforms.roadReflectionEnabled.value,0);assert.equal(r.surface.uniforms.roadReflectionStrength.value,0);
  assert.deepEqual(r.surface.uniforms.roadReflectionMatrix.value.toArray(),old.matrix);
  r.renderer.fail=false;assert.equal(r.render(.11),true,'An invalid capture must retry, rather than declaring failed source changes clean');
  evidence.failureRecovery={rendererStateRestored:true,dedicatedCullingRestored:true,genericHiddenPreserved:true,oldProjectionPreserved:true,invalidTextureDisabled:true,failedSourceChangeRetried:true};r.dispose();
});

test('Balanced, disabled/disposed state and a rewound clock do not leave a stale enabled coefficient',()=>{
  const r=rig();assert.ok(r.render(1));r.reflection.configure('balanced');assert.equal(r.render(2),false);assert.equal(r.surface.uniforms.roadReflectionStrength.value,0);assert.equal(r.surface.uniforms.roadReflection.value,null);
  r.reflection.configure('ultra');assert.ok(r.render(3));assert.ok(r.render(.1));r.reflection.setEnabled(false);assert.equal(r.render(.2),false);assert.equal(r.surface.uniforms.roadReflectionEnabled.value,0);
  r.reflection.setEnabled(true);assert.ok(r.render(.3));r.reflection.dispose();assert.equal(r.render(.4),false);assert.equal(r.surface.uniforms.roadReflectionStrength.value,0);assert.equal(r.surface.uniforms.roadReflection.value,null);
  evidence.lifecycle={balancedAdditionalPasses:0,disabledCoefficient:0,disposedCoefficient:0,clockRewindInvalidates:true};r.dispose();
});

const report={schema:'roadster.reflection-stability',version:1,modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),
  verificationType:'CPU submission cadence, material composition and pass-state verification; no WebGL context or framebuffer',
  sourceSha256:sources,checks,evidence,actualScreenshots:null,actualGpuFrameTimes:null,
  remainingAcceptance:'Same camera/resolution/quality/weather WebGL captures of moving reflected car, wheel/wing and light fades; continuous boundary crossings; actual driven p50/p95/p99 frame times after warmup. The cap and target dimensions are unchanged, but previously stale fixed views can now consume more of that existing budget.'};
writeFileSync(new URL('../qa/reflection-stability-3.12.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({modelVersion:MODEL_VERSION,checks:checks.length,status:'passed',report:'qa/reflection-stability-3.12.json',webglPixels:false,gpuFrameTimes:false}));
