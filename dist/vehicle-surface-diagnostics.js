import * as THREE from './vendor/three.module.js';
import {attachReceiverPlaneShadows} from './receiver-plane-shadows.js';

export const VEHICLE_SURFACE_MODES=Object.freeze([
  {id:'surface',name:'完整材质与阴影'},
  {id:'no-shadow',name:'关闭车身接收阴影'},
  {id:'no-environment',name:'关闭环境反射'},
  {id:'diffuse',name:'纯漫反射灰模'},
  {id:'normals',name:'表面法线'},
  {id:'wireframe',name:'三角网格'}
]);

// Reversible diagnostic overrides. Call restore before an LOD/material state
// change and apply after it. Articulated geometry and physics are untouched.
export function createVehicleSurfaceDiagnostics(scene){
  let mode='surface',saved=[],environmentIntensity=null;
  const clones=new Map(),normal=new THREE.MeshNormalMaterial({side:THREE.DoubleSide}),
    diffuse=new THREE.MeshLambertMaterial({color:0x8796a3,side:THREE.DoubleSide}),
    wire=new THREE.MeshBasicMaterial({color:0x83e2e1,side:THREE.DoubleSide,wireframe:true});
  normal.toneMapped=false;wire.toneMapped=false;
  attachReceiverPlaneShadows(diffuse);
  function restore(){
    for(const {object,material,receiveShadow}of saved){object.material=material;object.receiveShadow=receiveShadow;}saved=[];
    if(environmentIntensity!==null){scene.environmentIntensity=environmentIntensity;environmentIntensity=null;}
  }
  function reflectionless(material){
    if(!clones.has(material))clones.set(material,material.clone());
    // Glass opacity/cutaway state can change between diagnostic frames. Keep
    // that authored state current while removing only its environment term.
    const m=clones.get(material);m.copy(material);m.onBeforeCompile=material.onBeforeCompile;m.customProgramCacheKey=material.customProgramCacheKey;
    if('envMapIntensity'in m)m.envMapIntensity=0;return m;
  }
  function apply(models){
    restore();if(mode==='surface')return;
    if(mode==='no-environment'){environmentIntensity=scene.environmentIntensity;scene.environmentIntensity=0;}
    for(const model of models){
      const root=model.group||model;root.traverse(object=>{
        if(!object.isMesh)return;saved.push({object,material:object.material,receiveShadow:object.receiveShadow});
        if(mode==='no-shadow')object.receiveShadow=false;
        else if(mode==='no-environment')object.material=Array.isArray(object.material)?object.material.map(reflectionless):reflectionless(object.material);
        else object.material=mode==='normals'?normal:mode==='wireframe'?wire:diffuse;
      });
    }
  }
  function setMode(value){if(!VEHICLE_SURFACE_MODES.some(m=>m.id===value))throw Error('Unknown surface diagnostic mode');restore();mode=value;}
  return {setMode,apply,restore,get mode(){return mode;},snapshot(){return {mode,overridesOnly:true,environmentContribution:mode==='no-environment'?'disabled':'authored',receiverShadows:mode==='no-shadow'?'disabled on inspected vehicle only':'authored',normalSpace:mode==='normals'?'view':null,physicsModified:false};},dispose(){restore();[normal,diffuse,wire,...clones.values()].forEach(m=>m.dispose());clones.clear();}};
}
