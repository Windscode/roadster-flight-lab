// Shadow depth belongs to the displayed pose, not the next physics step.
// Idle refresh budgets may never reuse a moving caster's old depth silhouette.
export const SHADOW_MOTION_POLICY='display-pose-coherent-3.18';
const vector=v=>v?[v.x,v.y,v.z]:null;
const rotation=q=>q?[q.x,q.y,q.z,q.w]:null;
function changed(a,b,epsilon){
  return !a||!b||a.length!==b.length||a.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(b[i])||Math.abs(v-b[i])>epsilon);
}
export function createShadowMotionTracker(){
  let previous=null;
  return {
    sample(position,{quaternion=null,wheelStates=[],camera=null}={}){
      const current={p:vector(position),q:rotation(quaternion),w:wheelStates.flatMap(w=>[w.steer||0,w.suspensionLength||0,w.rotation||0]),
        cp:vector(camera?.position),cq:rotation(camera?.quaternion)};
      const casterChanged=!previous||changed(current.p,previous.p,.00025)||(current.q&&changed(current.q,previous.q,.00002))||changed(current.w,previous.w,.0002);
      const cameraChanged=!!camera&&(!previous||changed(current.cp,previous.cp,.00025)||changed(current.cq,previous.cq,.00002));
      previous=current;return {casterChanged,cameraChanged,policy:SHADOW_MOTION_POLICY};
    },
    reset(){previous=null;}
  };
}

// Fixed light direction and light-space texel origin. The depth raster no
// longer drifts by fractional texels when the laboratory's follow volume moves.
export function snapDirectionalShadow(THREE,light,target,offset){
  light.target.position.copy(target);light.position.copy(target).add(offset);
  light.target.updateMatrixWorld();light.updateMatrixWorld();
  const camera=light.shadow.camera;
  camera.position.copy(light.position);camera.up.set(0,1,0);camera.lookAt(light.target.position);camera.updateMatrixWorld(true);
  const origin=new THREE.Vector3(0,0,0).applyMatrix4(camera.matrixWorldInverse),
    tx=(camera.right-camera.left)/light.shadow.mapSize.x,ty=(camera.top-camera.bottom)/light.shadow.mapSize.y;
  const dx=(origin.x/tx-Math.round(origin.x/tx))*tx,dy=(origin.y/ty-Math.round(origin.y/ty))*ty;
  const shift=new THREE.Vector3(dx,dy,0).applyQuaternion(camera.quaternion);
  light.position.add(shift);light.target.position.add(shift);
  light.updateMatrixWorld();light.target.updateMatrixWorld();
  return {texelMetres:[tx,ty],snapOffsetMetres:[dx,dy]};
}
