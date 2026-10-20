import * as THREE from './vendor/three.module.js';

// Cube targets inherit setSize(width,height) in the bundled Three.js. A
// one-argument resize corrupts the viewport and depth attachment dimensions.
// Recreate on a real size change, retaining the resource on same-size weather
// changes. Recreation also gives all six face descriptors and PMREM a coherent
// new identity; it does not disable local reflections or lower their budget.
export function configureCubeProbeTarget(scene,previous,size,far){
  if(!Number.isInteger(size)||size<0||size>2048)throw new RangeError('Invalid cube probe size');
  let {target=null,camera=null}=previous||{};
  if(target&&(size===0||target.width!==size||target.height!==size)){
    camera?.removeFromParent();target.dispose();target=null;camera=null;
  }
  if(size>0&&!target){
    target=new THREE.WebGLCubeRenderTarget(size,{type:THREE.HalfFloatType,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter,depthBuffer:true,stencilBuffer:false});
    target.texture.name='Roadster.vehicle-local-probe';
    camera=new THREE.CubeCamera(.3,far,target);camera.name='Vehicle local reflection capture';scene.add(camera);
  }
  if(camera)for(const face of camera.children){face.far=far;face.updateProjectionMatrix();}
  return {target,camera};
}
