import * as THREE from './vendor/three.module.js';

// A deliberately small stationary-light bake. It contains reflected diffuse
// energy only: camera-selected direct/shadowed fixtures are never baked twice.
export const NIGHT_FIELD_LAYOUT=Object.freeze({
  version:1,heights:[.6,2.4,6,12,26],coefficients:6,
  volumes:[{id:'night-city',min:[-624,-624],step:[24,24],size:[53,53]},
    {id:'night-route',min:[-304,-424],step:[4,4],size:[109,81]},
    {id:'night-route-balanced',min:[-304,-424],step:[8,8],size:[55,41]}],
  coneSamples:24,bounceRange:22,softSourceRadius:2.0,
  assumptions:'One diffuse surface event, 24 deterministic cone samples per fixture, finite 22 m virtual-source influence, six-axis ambient-cube angular approximation and closed static envelopes. No direct light, daylight, emission-only signs or car headlamps are baked.'
});
export const nightDot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const nightNormalise=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rgb=hex=>new THREE.Color(hex).toArray();
function albedo(g){
  if(['floor','urban-road','skyway'].includes(g.kind))return [.070,.075,.078];
  if(['sidewalk','corridor-paving','plan-walkway','street-prop'].includes(g.kind))return [.30,.31,.28];
  if(g.kind==='building')return [.27,.29,.28];
  if(['city-canopy','ceiling','plan-roof','footbridge'].includes(g.kind))return [.19,.21,.21];
  return [.23,.25,.25];
}
export function createNightOccluders(geometry){
  const boxes=geometry.map(g=>{
    const q=new THREE.Quaternion(...g.quaternion),inverse=q.clone().invert(),e=new THREE.Matrix4().makeRotationFromQuaternion(q).elements,h=g.size.map(v=>v*.5),p=g.position;
    const ext=[Math.abs(e[0])*h[0]+Math.abs(e[4])*h[1]+Math.abs(e[8])*h[2],Math.abs(e[1])*h[0]+Math.abs(e[5])*h[1]+Math.abs(e[9])*h[2],Math.abs(e[2])*h[0]+Math.abs(e[6])*h[1]+Math.abs(e[10])*h[2]];
    return {id:g.id,p,h,q:q.toArray(),inverse:inverse.toArray(),min:p.map((v,i)=>v-ext[i]),max:p.map((v,i)=>v+ext[i]),albedo:albedo(g)};
  });
  function build(list){
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const b of list)for(let k=0;k<3;k++){min[k]=Math.min(min[k],b.min[k]);max[k]=Math.max(max[k],b.max[k]);}
    if(list.length<=6)return {min,max,boxes:list};
    const axis=max.map((v,i)=>v-min[i]).reduce((a,v,i,arr)=>v>arr[a]?i:a,0);list.sort((a,b)=>a.p[axis]-b.p[axis]);
    const m=list.length>>1;return {min,max,left:build(list.slice(0,m)),right:build(list.slice(m))};
  }
  const tree=build(boxes);
  function rotate(v,q){const[x,y,z]=v,[qx,qy,qz,qw]=q,tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);return [x+qw*tx+qy*tz-qz*ty,y+qw*ty+qz*tx-qx*tz,z+qw*tz+qx*ty-qy*tx];}
  function slab(o,d,min,max,far){let lo=0,hi=far;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-10){if(o[k]<min[k]||o[k]>max[k])return false;}else{let a=(min[k]-o[k])/d[k],b=(max[k]-o[k])/d[k];if(a>b)[a,b]=[b,a];lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi)return false;}}return true;}
  function trace(origin,direction,maxDistance=40){
    let best=maxDistance,hit=null;const stack=[tree];
    while(stack.length){const node=stack.pop();if(!slab(origin,direction,node.min,node.max,best))continue;
      if(node.boxes){for(const b of node.boxes){
        const o=rotate(origin.map((v,i)=>v-b.p[i]),b.inverse),d=rotate(direction,b.inverse);let near=-Infinity,far=best,axis=0,sign=0;
        for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-10){if(Math.abs(o[k])>b.h[k]){far=-Infinity;break;}}else{let a=(-b.h[k]-o[k])/d[k],c=(b.h[k]-o[k])/d[k],s=-1;if(a>c){[a,c]=[c,a];s=1;}if(a>near){near=a;axis=k;sign=s;}far=Math.min(far,c);}}
        if(near>1e-4&&near<=far&&near<best){best=near;const n=[0,0,0];n[axis]=sign;hit={id:b.id,distance:near,normal:rotate(n,b.q),albedo:b.albedo};}
      }}else stack.push(node.left,node.right);
    }return hit;
  }
  function inside(p){const stack=[tree];while(stack.length){const node=stack.pop();if(p.some((v,k)=>v<node.min[k]||v>node.max[k]))continue;if(node.boxes){for(const b of node.boxes){const local=rotate(p.map((v,k)=>v-b.p[k]),b.inverse);if(local.every((v,k)=>Math.abs(v)<b.h[k]+.045))return true;}}else stack.push(node.left,node.right);}return false;}
  return {trace,inside,count:boxes.length};
}

export function makeNightBounceSources(anchors,occluders){
  const sources=[],n=NIGHT_FIELD_LAYOUT.coneSamples;
  for(const [index,a]of anchors.entries()){
    if(!a.practical)continue;
    const direction=nightNormalise((a.target||[a.position[0],0,a.position[2]]).map((v,k)=>v-a.position[k])),
      tangent=nightNormalise(cross(direction,Math.abs(direction[1])<.9?[0,1,0]:[1,0,0])),bitangent=cross(direction,tangent),
      angle=a.angle||.90,outer=Math.cos(angle),inner=Math.cos(angle*(1-(a.penumbra??.55))),solidAngle=2*Math.PI*(1-outer),color=rgb(a.color||0xffd0a2),range=Math.min(32,a.range||28);
    for(let i=0;i<n;i++){
      const cosine=1-(i+.5)/n*(1-outer),sine=Math.sqrt(1-cosine*cosine),phase=i*2.399963229728653+index*.713,
        ray=direction.map((v,k)=>v*cosine+tangent[k]*sine*Math.cos(phase)+bitangent[k]*sine*Math.sin(phase)),hit=occluders.trace(a.position,ray,range);
      if(!hit)continue;
      const t=Math.max(0,Math.min(1,(cosine-outer)/Math.max(1e-6,inner-outer))),penumbra=t*t*(3-2*t),falloff=(1-(hit.distance/range)**4)**2,
        power=(a.intensity||1500)*solidAngle/n*penumbra*falloff;
      if(power<.02)continue;
      sources.push({anchorId:a.id||'fixture-'+index,position:a.position.map((v,k)=>v+ray[k]*hit.distance+hit.normal[k]*.07),normal:hit.normal,
        intensity:color.map((v,k)=>v*hit.albedo[k]*power/Math.PI),surface:hit.id});
    }
  }return sources;
}

export function createNightBounceEvaluator(sources,occluders){
  const cells=new Map(),range=NIGHT_FIELD_LAYOUT.bounceRange,cellSize=range;
  for(const s of sources){const key=Math.floor(s.position[0]/cellSize)+','+Math.floor(s.position[2]/cellSize);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(s);}
  function evaluate(p,{occlusion=true}={}){
    const c=new Float64Array(18),cx=Math.floor(p[0]/cellSize),cz=Math.floor(p[2]/cellSize);let contributing=0,blocked=0;
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const s of cells.get((cx+dx)+','+(cz+dz))||[]){
      const delta=s.position.map((v,k)=>v-p[k]),distance=Math.hypot(...delta);if(distance<.09||distance>=range)continue;
      const direction=delta.map(v=>v/distance),emission=Math.max(0,-nightDot(s.normal,direction));if(emission<.001)continue;
      if(occlusion&&occluders.trace(p,direction,distance-.10)){blocked++;continue;}
      const falloff=(1-(distance/range)**4)**2/(distance*distance+NIGHT_FIELD_LAYOUT.softSourceRadius**2),basis=[Math.max(direction[0],0),Math.max(-direction[0],0),Math.max(direction[1],0),Math.max(-direction[1],0),Math.max(direction[2],0),Math.max(-direction[2],0)];
      for(let j=0;j<6;j++)for(let k=0;k<3;k++)c[j*3+k]+=s.intensity[k]*emission*falloff*basis[j];contributing++;
    }return {coefficients:Array.from(c),contributing,blocked};
  }
  return {evaluate};
}

export function evaluateNightCoefficients(c,n){const w=[Math.max(n[0],0)**2,Math.max(-n[0],0)**2,Math.max(n[1],0)**2,Math.max(-n[1],0)**2,Math.max(n[2],0)**2,Math.max(-n[2],0)**2];return [0,1,2].map(k=>w.reduce((sum,v,j)=>sum+v*c[j*3+k],0));}
