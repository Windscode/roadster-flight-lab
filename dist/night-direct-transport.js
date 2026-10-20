import * as THREE from './vendor/three.module.js';
import {nightNormalise,nightDot} from './city-night-transport.js';

// Same candela, inverse-square range cut-off and smooth cone as real spots.
// One visibility ray per contributing fixture/probe, not a sky-brightness lift.
export function createNightDirectEvaluator(anchors,occluders){
  const cellSize=32,cells=new Map();
  for(const a of anchors){
    if(!a.practical)continue;
    const entry={...a,colorLinear:new THREE.Color(a.color||0xffd0a2).toArray(),axis:nightNormalise((a.target||[a.position[0],0,a.position[2]]).map((v,k)=>v-a.position[k]))};
    const key=Math.floor(a.position[0]/cellSize)+','+Math.floor(a.position[2]/cellSize);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(entry);
  }
  function evaluate(p,{occlusion=true}={}){
    const c=new Float64Array(18),cx=Math.floor(p[0]/cellSize),cz=Math.floor(p[2]/cellSize);let contributing=0,blocked=0;
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const a of cells.get((cx+dx)+','+(cz+dz))||[]){
      const delta=a.position.map((v,k)=>v-p[k]),distance=Math.hypot(...delta),range=Math.min(32,a.range||28);if(distance<.10||distance>=range)continue;
      const direction=delta.map(v=>v/distance),angle=a.angle||.90,outer=Math.cos(angle),inner=Math.cos(angle*(1-(a.penumbra??.55))),cosine=-nightDot(direction,a.axis),t=Math.max(0,Math.min(1,(cosine-outer)/Math.max(1e-6,inner-outer)));
      if(t<.0001)continue;
      if(occlusion&&occluders.trace(p,direction,distance-.10)){blocked++;continue;}
      const falloff=(1-(distance/range)**4)**2/Math.max(1,distance*distance),intensity=(a.intensity||1500)*t*t*(3-2*t)*falloff,
        basis=[Math.max(direction[0],0),Math.max(-direction[0],0),Math.max(direction[1],0),Math.max(-direction[1],0),Math.max(direction[2],0),Math.max(-direction[2],0)];
      for(let j=0;j<6;j++)for(let k=0;k<3;k++)c[j*3+k]+=a.colorLinear[k]*intensity*basis[j];contributing++;
    }
    return {coefficients:Array.from(c),contributing,blocked};
  }
  return {evaluate};
}
