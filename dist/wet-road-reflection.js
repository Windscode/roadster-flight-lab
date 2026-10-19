import * as THREE from './vendor/three.module.js';

// One finite ground-plane specular capture, derived from the oblique clipping
// construction used by the vendored Three.js Reflector. The rendered road is
// never duplicated as an overlapping transparent mirror plane.
export function createWetRoadReflection(scene,renderer,camera,surface){
  const virtual=new THREE.PerspectiveCamera(),targetPoint=new THREE.Vector3(),viewDirection=new THREE.Vector3();
  const plane=new THREE.Plane(),clip=new THREE.Vector4(),q=new THREE.Vector4(),matrix=new THREE.Matrix4();
  const bias=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
  const uniforms=surface.uniforms,lastPosition=new THREE.Vector3(Infinity,Infinity,Infinity),lastOrientation=new THREE.Quaternion();
  let target=null,quality='balanced',enabled=false,lastCapture=-Infinity,lastTime=-Infinity,period=1/12;
  const stats={enabled:false,width:0,height:0,maximumHz:0,passes:0,passesThisFrame:0,lastCpuMs:0,
    algorithm:'Oblique-clipped single ground-plane specular capture; five-tap spatial filter',
    scope:'Only y≈0 inside the authored route district; high/ultra presets only. No SSR, ray tracing or wet-fluid simulation.'};
  function configure(value){
    quality=value;const size=quality==='ultra'?[768,432]:quality==='high'?[512,288]:null;
    if(!size){target?.dispose();target=null;uniforms.roadReflection.value=null;uniforms.roadReflectionEnabled.value=0;}
    else{
      if(!target)target=new THREE.WebGLRenderTarget(...size,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,stencilBuffer:false,samples:0});
      else target.setSize(...size);
      target.texture.name='Wet road / bounded linear specular capture';target.texture.generateMipmaps=false;
      uniforms.roadReflection.value=target.texture;uniforms.roadReflectionTexel.value.set(1/size[0],1/size[1]);
    }
    period=quality==='ultra'?1/20:1/12;
    Object.assign(stats,{width:size?.[0]||0,height:size?.[1]||0,maximumHz:size?1/period:0});lastCapture=-Infinity;
  }
  function render(time,exclude=[]){
    stats.passesThisFrame=0;
    const p=camera.position,inside=p.x>-245&&p.x<145&&p.z>-425&&p.z< -105&&p.y>.16&&p.y<18;
    stats.enabled=!!(enabled&&target&&inside);
    if(!stats.enabled){uniforms.roadReflectionEnabled.value=0;return false;}
    // A fixed camera needs no repeated captures. Motion still cannot exceed
    // the profile cap; the old projection is retained with the old texture.
    const moved=lastPosition.distanceToSquared(p)>.0064||1-Math.abs(lastOrientation.dot(camera.quaternion))>1e-5;
    if(time<lastTime)lastCapture=-Infinity;lastTime=time;
    if(time-lastCapture<period||(!moved&&time-lastCapture<.35))return false;
    camera.updateMatrixWorld(true);camera.getWorldDirection(viewDirection);
    virtual.position.set(p.x,-p.y+.022,p.z);
    targetPoint.copy(p).add(viewDirection);targetPoint.y=-targetPoint.y+.022;
    virtual.up.copy(camera.up);virtual.up.y=-virtual.up.y;
    virtual.lookAt(targetPoint);virtual.near=camera.near;virtual.far=Math.min(camera.far,400);
    virtual.projectionMatrix.copy(camera.projectionMatrix);virtual.updateMatrixWorld(true);
    matrix.copy(bias).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);
    plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0),new THREE.Vector3(0,.011,0));
    plane.applyMatrix4(virtual.matrixWorldInverse);clip.set(plane.normal.x,plane.normal.y,plane.normal.z,plane.constant);
    const projection=virtual.projectionMatrix.elements;
    q.set((Math.sign(clip.x)+projection[8])/projection[0],(Math.sign(clip.y)+projection[9])/projection[5],-1,(1+projection[10])/projection[14]);
    const divisor=clip.dot(q);if(Math.abs(divisor)<1e-7)return false;
    clip.multiplyScalar(2/divisor);projection[2]=clip.x;projection[6]=clip.y;projection[10]=clip.z+1-.003;projection[14]=clip.w;
    virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
    const old={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),
      viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),
      xr:renderer.xr.enabled,shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeded:renderer.shadowMap.needsUpdate,
      enabled:uniforms.roadReflectionEnabled.value};
    const hidden=exclude.filter(Boolean).map(object=>({object,visible:object.visible}));
    const begin=performance.now();
    try{
      hidden.forEach(({object})=>object.visible=false);uniforms.roadReflectionEnabled.value=0;
      // This pass runs only at night: service pending local spotlight maps
      // before reflecting them, so a new fixture cannot be captured unshadowed.
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=old.shadowNeeded;
      renderer.setScissorTest(false);renderer.setRenderTarget(target);renderer.clear(true,true,false);renderer.render(scene,virtual);
      lastCapture=time;lastPosition.copy(p);lastOrientation.copy(camera.quaternion);stats.passes++;stats.passesThisFrame=1;uniforms.roadReflectionMatrix.value.copy(matrix);uniforms.roadReflectionEnabled.value=1;return true;
    }finally{
      stats.lastCpuMs=performance.now()-begin;
      renderer.xr.enabled=old.xr;renderer.shadowMap.autoUpdate=old.shadowAuto;renderer.shadowMap.needsUpdate=old.shadowNeeded;
      renderer.setViewport(old.viewport);renderer.setScissor(old.scissor);renderer.setScissorTest(old.scissorTest);renderer.setRenderTarget(old.target,old.face,old.mip);
      hidden.forEach(({object,visible})=>object.visible=visible);
      if(stats.passesThisFrame===0)uniforms.roadReflectionEnabled.value=0;
    }
  }
  return {stats,configure,render,setEnabled(value){enabled=!!value;stats.enabled=enabled&&!!target;lastCapture=-Infinity;if(!enabled)uniforms.roadReflectionEnabled.value=0;},
    dispose(){target?.dispose();uniforms.roadReflection.value=null;uniforms.roadReflectionEnabled.value=0;}};
}
