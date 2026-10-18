import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createLocalProbeSun} from '../dist/local-probe-sun.js';
import {SUN_DIRECTION} from '../dist/irradiance-math.js';
import {RENDER_PROFILES} from '../dist/render-profiles.js';
import {CITY_RENDER_PRESETS} from '../dist/city-render-budget.js';

const checks=[],pass=description=>{checks.push(description);console.log('PASS: '+description);};

// Model the documented distinction in the actual vendored renderer:
// setRenderTarget applies a target's physical viewport, but public setViewport
// multiplies logical coordinates by the screen DPR. No WebGL context is used.
function makeRenderer(pixelRatio){
  const viewport=new THREE.Vector4(3,5,1200,720),scissor=new THREE.Vector4(7,9,1100,650),clear=new THREE.Color(.12,.23,.34);
  let activeViewport=viewport.clone().multiplyScalar(pixelRatio),activeScissor=scissor.clone(),target=null,face=2,mip=1,scissorTest=true,alpha=.65;
  const renderer={
    autoClear:true,xr:{enabled:true},shadowMap:{enabled:true,autoUpdate:true,needsUpdate:true},info:{render:{calls:11,triangles:27}},
    getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
    getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,
    getClearColor:c=>c.copy(clear),getClearAlpha:()=>alpha,
    setClearColor(c,a){clear.set(c);if(a!==undefined)alpha=a;},
    setScissorTest(v){scissorTest=v;},
    setRenderTarget(t,f=0,m=0){target=t;face=f;mip=m;activeViewport=t?t.viewport.clone():viewport.clone().multiplyScalar(pixelRatio);activeScissor=t?t.scissor.clone():scissor.clone();},
    setViewport(x,y,w,h){if(x?.isVector4)viewport.copy(x);else viewport.set(x,y,w,h);activeViewport=viewport.clone().multiplyScalar(pixelRatio);},
    setScissor(x,y,w,h){if(x?.isVector4)scissor.copy(x);else scissor.set(x,y,w,h);activeScissor=scissor.clone();},
    clear(){assert.equal(scissorTest,false);},
    snapshot(){return{viewport:viewport.toArray(),activeViewport:activeViewport.toArray(),scissor:scissor.toArray(),activeScissor:activeScissor.toArray(),target,face,mip,scissorTest,clear:clear.toArray(),alpha,autoClear:this.autoClear,xr:this.xr.enabled,shadow:{...this.shadowMap}};},
    render(scene,camera){renderer.onRender?.(scene,camera,target,activeViewport);this.info.render.calls+=2;this.info.render.triangles+=24;}
  };
  return renderer;
}

for(const quality of ['balanced','high','ultra'])for(const key of ['probeSize','probeInterval','probeDistance','probeMaxAge','probeShadowSize'])
  assert.equal(RENDER_PROFILES[quality][key],CITY_RENDER_PRESETS[quality][key],quality+' '+key);
assert.equal(RENDER_PROFILES.balanced.probeShadowSize,0);
pass('Display and city profiles agree on probe scheduling; balanced allocates no local cube or sunlight map');

const cases=[];
for(const [pixelRatio,size,range]of [[1.35,512,125],[1.5,768,180]])for(const offscreen of [false,true]){
  const scene=new THREE.Scene(),renderer=makeRenderer(pixelRatio),sun=createLocalProbeSun(scene,renderer);
  const oldTarget=offscreen?new THREE.WebGLRenderTarget(300,180):null;
  if(oldTarget){oldTarget.viewport.set(8,10,260,150);oldTarget.scissor.set(9,11,220,140);renderer.setRenderTarget(oldTarget,3,2);}
  const ordinary=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());ordinary.castShadow=true;
  const farEnvelope=ordinary.clone();farEnvelope.castShadow=false;farEnvelope.userData.renderDetail='mass';
  const glass=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshPhysicalMaterial({transparent:true,opacity:.4}));glass.castShadow=true;
  const foliage=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial({alphaTest:.5}));foliage.castShadow=true;
  const decal=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial());decal.castShadow=false;
  const alreadyHidden=ordinary.clone();alreadyHidden.visible=false;
  scene.add(ordinary,farEnvelope,glass,foliage,decal,alreadyHidden);
  const oldOverride=new THREE.MeshBasicMaterial(),oldBackground=new THREE.Color(.2,.3,.4);scene.overrideMaterial=oldOverride;scene.background=oldBackground;
  sun.refreshCasters();sun.configure(size);
  const before=renderer.snapshot();
  renderer.onRender=(s,c,target,viewport)=>{
    assert.equal(s.overrideMaterial.depthPacking,THREE.RGBADepthPacking);assert.equal(s.background,null);
    assert.equal(renderer.xr.enabled,false);assert.equal(renderer.shadowMap.enabled,false);
    assert.equal(renderer.shadowMap.autoUpdate,false);assert.equal(renderer.shadowMap.needsUpdate,false);
    assert.deepEqual(viewport.toArray(),[0,0,size,size],'Do not scale a physical render-target viewport by screen DPR twice');
    assert.equal(target.texture.generateMipmaps,false);
    assert.equal(ordinary.visible,true);assert.equal(farEnvelope.visible,true);
    assert.equal(glass.visible,false);assert.equal(foliage.visible,false);assert.equal(decal.visible,false);assert.equal(alreadyHidden.visible,false);
    assert.ok(c.isOrthographicCamera);
  };
  const origin=new THREE.Vector3(-200,2.1,-298);
  assert.equal(sun.render(origin,range),true);
  assert.deepEqual(renderer.snapshot(),before);assert.equal(scene.overrideMaterial,oldOverride);assert.equal(scene.background,oldBackground);
  assert.equal(glass.visible,true);assert.equal(foliage.visible,true);assert.equal(decal.visible,true);assert.equal(alreadyHidden.visible,false);
  assert.equal(sun.stats.depthPasses,1);assert.equal(sun.stats.lastDrawCalls,2);assert.equal(sun.stats.lastTriangles,24);

  const matrix=sun.uniforms.probeSunMatrix.value,sunDirection=new THREE.Vector3(...SUN_DIRECTION).normalize();
  const projectedCentre=origin.clone().applyMatrix4(matrix);
  assert.ok(Math.abs(projectedCentre.x-.5)<1e-10&&Math.abs(projectedCentre.y-.5)<1e-10);
  const towardSun=origin.clone().addScaledVector(sunDirection,100).applyMatrix4(matrix);
  assert.ok(Math.abs(towardSun.x-projectedCentre.x)<1e-10&&Math.abs(towardSun.y-projectedCentre.y)<1e-10);
  assert.ok(towardSun.z<projectedCentre.z,'The shadow camera must look down the baked physical sun direction');
  let tested=0;
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])for(const sunward of [0,240]){
    const projected=origin.clone().add(new THREE.Vector3(x*range,y*range,z*range)).addScaledVector(sunDirection,sunward).applyMatrix4(matrix);
    assert.ok(projected.toArray().every(v=>v>0&&v<1),'All cube face far-plane corners, plus sunward blockers, must lie within the dedicated map');tested++;
  }
  cases.push({pixelRatio,previousTarget:offscreen?'offscreen with custom physical viewport':'screen',mapSize:size,cubeFaceFarMetres:range,testedCornersAndBlockerPoints:tested,shadowPasses:sun.stats.depthPasses,drawCalls:sun.stats.lastDrawCalls,triangles:sun.stats.lastTriangles});

  renderer.onRender=()=>{throw Error('injected probe depth failure');};
  assert.throws(()=>sun.render(origin,range),/injected probe depth failure/);
  assert.deepEqual(renderer.snapshot(),before);assert.equal(scene.overrideMaterial,oldOverride);assert.equal(scene.background,oldBackground);
  assert.equal(glass.visible,true);assert.equal(alreadyHidden.visible,false);assert.equal(sun.stats.depthPasses,1);
  sun.setActive(true);assert.equal(sun.uniforms.probeSunActive.value,1);
  sun.configure(0);sun.setActive(true);assert.equal(sun.uniforms.probeSunActive.value,0);assert.equal(sun.uniforms.probeSunDepth.value,null);
  assert.equal(sun.render(origin,range),false);assert.deepEqual(renderer.snapshot(),before);sun.dispose();oldTarget?.dispose();
}
pass('Dedicated sunlight capture uses 512/768 physical pixels at DPR 1.35/1.5, with exactly one depth submission per call');
pass('The local map follows the baked sun and contains all eight cube-volume corners plus 240 m of sunward blocker margin');
pass('Opaque mass remains eligible beyond the main-view shadow-distance gate; transparent, cutout, decal and hidden geometry do not become false opaque blockers');
pass('Render target, viewport, scissor, clear state, override, background, XR, shadow flags and visibility recover after success and injected failure');
pass('Returning to balanced releases the local sunlight target and disables its shader branch');

writeFileSync('qa/local-probe-sun-3.6.json',JSON.stringify({status:'passed',checks,cases,
  scope:'Deterministic resource, camera projection, HiDPI viewport and renderer-state regression tests with a stateful renderer double. No browser, graphics driver or rendered image is exercised.',
  limits:'Shadow rasterization, packed-depth GPU filtering and visual quality require actual browser/GPU acceptance.'},null,2)+'\n');
