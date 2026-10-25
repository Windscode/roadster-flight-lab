import * as THREE from './vendor/three.module.js';

export const WET_REFLECTION_DISTANCE_M=400;
export const WET_REFLECTION_DOMAIN=Object.freeze({minX:-245,maxX:145,minZ:-425,maxZ:-105,minY:.16,maxY:18,horizontalFadeM:12,lowerFadeEndY:.56,upperFadeStartY:14});

// Fade inside the existing capture domain. Per-fragment UV/road masks alone
// cannot hide a camera crossing its old binary height or district boundary.
export function wetReflectionDomainWeight(p){
  if(!p||![p.x,p.y,p.z].every(Number.isFinite))return 0;
  const d=WET_REFLECTION_DOMAIN,edge=Math.min(p.x-d.minX,d.maxX-p.x,p.z-d.minZ,d.maxZ-p.z);
  return THREE.MathUtils.smoothstep(edge,0,d.horizontalFadeM)*THREE.MathUtils.smoothstep(p.y,d.minY,d.lowerFadeEndY)*(1-THREE.MathUtils.smoothstep(p.y,d.upperFadeStartY,d.maxY));
}

// Inspect only the moving vehicle subtree and the already selected practicals,
// not every city object. Local wheel/wing transforms and deforming seal buffers
// matter even when both the camera and vehicle root remain still.
function reflectionSourceSnapshot(root,practicals){
  const values=[],materials=new Set();let objects=0;
  if(root){
    values.push(root.id,root.visible);
    if(root.visible){
      root.updateWorldMatrix(true,false);values.push(...root.matrixWorld.elements);
      root.traverseVisible(object=>{
        objects++;const geometry=object.geometry;
        values.push(object.id,object.parent?.id??-1,...object.position,...object.quaternion,...object.scale,geometry?.id??-1,
          geometry?.attributes.position?.version??-1,geometry?.attributes.normal?.version??-1,object.instanceMatrix?.version??-1,object.count??-1);
        if(!object.matrixAutoUpdate)values.push(...object.matrix.elements);
        if(object.morphTargetInfluences)values.push(...object.morphTargetInfluences);
        for(const material of Array.isArray(object.material)?object.material:[object.material])if(material)materials.add(material);
      });
    }
  }
  // Shared brake lamps and body paint can change without a transform update.
  for(const material of materials)values.push(material.id,material.version,material.opacity,material.color?.r,material.color?.g,material.color?.b,
    material.emissive?.r,material.emissive?.g,material.emissive?.b,material.emissiveIntensity,material.envMap?.id??-1,material.envMapIntensity);
  values.push('practicals',practicals.length);
  for(const light of practicals)values.push(light.id,...light.position,...light.target,light.intensity,light.gain);
  return {values,objects,materials:materials.size,lights:practicals.length};
}

function sameSourceSnapshot(a,b){
  return a&&a.values.length===b.values.length&&a.values.every((v,i)=>v===b.values[i]||(typeof v==='number'&&typeof b.values[i]==='number'&&Math.abs(v-b.values[i])<.0001));
}

// Copy lens settings, then construct a NEW bounded perspective projection.
// Copying the main projection after setting .far silently restores its 2300 m
// frustum. This also preserves zoom, film offset and sub-view/aspect settings.
export function buildWetReflectionCamera(source,virtual=new THREE.PerspectiveCamera(),{planeY=.011,far=WET_REFLECTION_DISTANCE_M,clipBias=.003}={}){
  if(!source?.isPerspectiveCamera)throw new TypeError('Wet-road reflection needs a perspective camera');
  source.updateMatrixWorld(true);virtual.copy(source,false);
  virtual.near=source.near;virtual.far=Math.min(source.far,Math.max(source.near+.1,far));virtual.updateProjectionMatrix();
  const baseProjection=virtual.projectionMatrix.clone(),direction=new THREE.Vector3();source.getWorldDirection(direction);
  const position=source.getWorldPosition(new THREE.Vector3()),target=position.clone().add(direction);target.y=2*planeY-target.y;
  virtual.position.set(position.x,2*planeY-position.y,position.z);virtual.up.set(0,1,0).applyQuaternion(source.getWorldQuaternion(new THREE.Quaternion()));virtual.up.y=-virtual.up.y;
  virtual.lookAt(target);virtual.updateMatrixWorld(true);
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-planeY).applyMatrix4(virtual.matrixWorldInverse);
  const clip=new THREE.Vector4(plane.normal.x,plane.normal.y,plane.normal.z,plane.constant),q=new THREE.Vector4(),projection=virtual.projectionMatrix.elements;
  q.set((Math.sign(clip.x)+projection[8])/projection[0],(Math.sign(clip.y)+projection[9])/projection[5],-1,(1+projection[10])/projection[14]);
  const divisor=clip.dot(q);if(!Number.isFinite(divisor)||Math.abs(divisor)<1e-7)return null;
  clip.multiplyScalar(2/divisor);projection[2]=clip.x;projection[6]=clip.y;projection[10]=clip.z+1-clipBias;projection[14]=clip.w;
  virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
  return {camera:virtual,baseProjection,far:virtual.far,planeY};
}

// Dedicated pass culling is additional to the ordinary city LOD/visibility.
// A bound crossing the radius remains submitted and is clipped by the camera;
// this is conservative per render batch, not a claim of per-instance culling.
export function hideDistantReflectionMeshes(scene,origin,maximumDistance=WET_REFLECTION_DISTANCE_M){
  const hidden=[],sphere=new THREE.Sphere();scene.updateMatrixWorld(true);
  scene.traverseVisible(object=>{
    if(!object.isMesh||object.userData.reflectionAlwaysVisible)return;
    if(object.isInstancedMesh){if(!object.boundingSphere)object.computeBoundingSphere();sphere.copy(object.boundingSphere);}
    else{if(!object.geometry?.boundingSphere)object.geometry?.computeBoundingSphere();if(!object.geometry?.boundingSphere)return;sphere.copy(object.geometry.boundingSphere);}
    sphere.applyMatrix4(object.matrixWorld);
    if(sphere.center.distanceTo(origin)-sphere.radius>maximumDistance){object.visible=false;hidden.push(object);}
  });
  return hidden;
}

// One finite ground-plane specular capture, derived from the oblique clipping
// construction used by the vendored Three.js Reflector. The rendered road is
// never duplicated as an overlapping transparent mirror plane.
export function createWetRoadReflection(scene,renderer,camera,surface){
  const virtual=new THREE.PerspectiveCamera(),matrix=new THREE.Matrix4();
  const bias=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
  const uniforms=surface.uniforms,lastPosition=new THREE.Vector3(Infinity,Infinity,Infinity),lastOrientation=new THREE.Quaternion(),lastProjection=new THREE.Matrix4();
  let target=null,quality='balanced',enabled=false,captureValid=false,lastSources=null,lastCapture=-Infinity,lastTime=-Infinity,period=1/12;
  const stats={enabled:false,width:0,height:0,maximumHz:0,passes:0,passesThisFrame:0,lastCpuMs:0,
    maximumDistanceM:WET_REFLECTION_DISTANCE_M,projectionFarM:WET_REFLECTION_DISTANCE_M,distanceCulledMeshes:0,domainWeight:0,sourceObjects:0,sourceMaterials:0,sourceLights:0,dynamicRefreshes:0,lastCaptureReason:null,
    algorithm:'Bounded perspective + oblique ground clip + dedicated conservative distance cull; five-tap spatial filter',
    refreshPolicy:'Camera/lens, visible vehicle transforms/deformations and selected practical state invalidate the capture within the existing 12/20 Hz caps; a static scene reuses it for 0.35 s. Spatial fade stays inside the original domain.',
    scope:'Only y≈0 inside the authored route district; high/ultra presets only. No SSR, ray tracing or wet-fluid simulation.'};
  function setBlend(weight){
    const active=captureValid&&enabled&&!!target&&weight>0;
    uniforms.roadReflectionEnabled.value=active?1:0;uniforms.roadReflectionStrength.value=active?weight:0;
  }
  function configure(value){
    quality=value;const size=quality==='ultra'?[768,432]:quality==='high'?[512,288]:null;
    if(!size){target?.dispose();target=null;uniforms.roadReflection.value=null;}
    else{
      if(!target)target=new THREE.WebGLRenderTarget(...size,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,stencilBuffer:false,samples:0});
      else target.setSize(...size);
      target.texture.name='Wet road / bounded linear specular capture';target.texture.generateMipmaps=false;
      uniforms.roadReflection.value=target.texture;uniforms.roadReflectionTexel.value.set(1/size[0],1/size[1]);
    }
    period=quality==='ultra'?1/20:1/12;
    Object.assign(stats,{width:size?.[0]||0,height:size?.[1]||0,maximumHz:size?1/period:0,domainWeight:0});lastCapture=-Infinity;captureValid=false;setBlend(0);
  }
  function render(time,exclude=[],{dynamicRoot=null,practicalLights=[]}={}){
    stats.passesThisFrame=0;
    const p=camera.position,weight=wetReflectionDomainWeight(p);
    stats.domainWeight=weight;stats.enabled=!!(enabled&&target&&weight>0&&Number.isFinite(time));
    if(!stats.enabled){setBlend(0);return false;}
    if(time<lastTime){lastCapture=-Infinity;captureValid=false;}lastTime=time;
    // Update blend on every displayed frame, including frames that reuse the
    // texture. Neither camera nor source motion can bypass the profile cap.
    setBlend(weight);
    if(time-lastCapture+1e-9<period)return false;
    const moved=lastPosition.distanceToSquared(p)>.0064||1-Math.abs(lastOrientation.dot(camera.quaternion))>1e-5||camera.projectionMatrix.elements.some((v,i)=>Math.abs(v-lastProjection.elements[i])>1e-7);
    const sources=reflectionSourceSnapshot(dynamicRoot,practicalLights),sourceMoved=!sameSourceSnapshot(lastSources,sources);
    stats.sourceObjects=sources.objects;stats.sourceMaterials=sources.materials;stats.sourceLights=sources.lights;
    if(captureValid&&!moved&&!sourceMoved&&time-lastCapture<.35)return false;
    const reflection=buildWetReflectionCamera(camera,virtual);if(!reflection){captureValid=false;setBlend(0);return false;}
    // Texture coordinates use the bounded lens before its near plane is made
    // oblique. The same world point must keep its x/y coordinate in the image.
    matrix.copy(bias).multiply(reflection.baseProjection).multiply(virtual.matrixWorldInverse);
    stats.projectionFarM=reflection.far;
    const old={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),
      viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),
      xr:renderer.xr.enabled,shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeded:renderer.shadowMap.needsUpdate,
      texture:uniforms.roadReflection.value,enabled:uniforms.roadReflectionEnabled.value};
    const hidden=exclude.filter(Boolean).map(object=>({object,visible:object.visible}));let distant=[],captured=false;
    const begin=performance.now();
    try{
      hidden.forEach(({object})=>object.visible=false);distant=hideDistantReflectionMeshes(scene,p,reflection.far);stats.distanceCulledMeshes=distant.length;
      // A uniform-controlled branch does not make an active sampler harmless:
      // WebGL forbids sampling a texture attached to the drawing framebuffer.
      // Three binds its separate empty 2D texture for this null sampler value.
      uniforms.roadReflectionEnabled.value=0;uniforms.roadReflection.value=null;
      // This pass runs only at night: service pending local spotlight maps
      // before reflecting them, so a new fixture cannot be captured unshadowed.
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=old.shadowNeeded;
      renderer.setScissorTest(false);renderer.setRenderTarget(target);renderer.clear(true,true,false);renderer.render(scene,virtual);
      captured=true;
    }finally{
      stats.lastCpuMs=performance.now()-begin;
      renderer.xr.enabled=old.xr;renderer.shadowMap.autoUpdate=old.shadowAuto;
      // A successful reflection already services the pending night spotlight
      // requests. Preserve consumption of the global request instead of
      // entering shadow preparation again in the main view. Individual lights
      // also have their own dirty flags; this is not a per-map draw reduction.
      // Failed draws still owe the caller its original request.
      if(!captured)renderer.shadowMap.needsUpdate=old.shadowNeeded;
      renderer.setViewport(old.viewport);renderer.setScissor(old.scissor);renderer.setScissorTest(old.scissorTest);renderer.setRenderTarget(old.target,old.face,old.mip);
      // Leave the writing target before exposing its texture to later passes.
      uniforms.roadReflection.value=old.texture;uniforms.roadReflectionEnabled.value=old.enabled;
      distant.forEach(object=>object.visible=true);hidden.forEach(({object,visible})=>object.visible=visible);
      // clear/render may have overwritten part of the previous image. Restore
      // pass state, but retain the existing policy of disabling a failed cache.
      if(!captured){captureValid=false;setBlend(0);}
    }
    stats.lastCaptureReason=!captureValid?'invalid-cache':moved?'camera-or-lens':sourceMoved?'dynamic-source':'idle-refresh';
    if(captureValid&&sourceMoved)stats.dynamicRefreshes++;
    lastCapture=time;lastPosition.copy(p);lastOrientation.copy(camera.quaternion);lastProjection.copy(camera.projectionMatrix);lastSources=sources;captureValid=true;
    stats.passes++;stats.passesThisFrame=1;uniforms.roadReflectionMatrix.value.copy(matrix);setBlend(weight);return true;
  }
  return {stats,configure,render,setEnabled(value){enabled=!!value;stats.enabled=enabled&&!!target;lastCapture=-Infinity;captureValid=false;setBlend(0);},
    dispose(){target?.dispose();target=null;captureValid=false;stats.enabled=false;uniforms.roadReflection.value=null;setBlend(0);}};
}
