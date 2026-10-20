import {REPORT_VERSION} from './qa-report-version.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {HDRLoader} from '../dist/vendor/addons/loaders/HDRLoader.js';
import {RoadsterSim} from '../dist/physics.js';
import {CITY_BUILDINGS,CITY_COLLIDERS} from '../dist/city-data.js';
import {LANDMARK_COLLIDERS} from '../dist/city-landmarks.js';
import {URBAN_MATERIAL_PALETTE} from '../dist/urban-architecture.js';
import {GI_VOLUMES,GI_HEIGHTS,SUN_DIRECTION,shBasis,fibonacciDirection,irradianceAt,canonicalGeometryJSON} from '../dist/irradiance-math.js';

// Offline diffuse path tracing of the city's shared solid envelopes. Specular
// paths, vegetation microgeometry and moving objects are deliberately excluded.
// Explicit sun next-event estimation + cosine-weighted diffuse continuation.
const start=performance.now(),samples=Number(process.env.GI_SAMPLES)||768,bounces=3;
const bytes=readFileSync(new URL('../dist/assets/daylight.hdr',import.meta.url));
const hdr=new HDRLoader().setDataType(THREE.FloatType).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const normalize=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);},dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sun=normalize(SUN_DIRECTION),colour=h=>{const c=new THREE.Color(h);return[c.r,c.g,c.b];};
const walls=URBAN_MATERIAL_PALETTE.map(p=>colour(p.wall));
const roadTint=colour(0x92989c),oldRoadTint=colour(0x999da0),roadAlbedo=[.072,.075,.078].map((v,i)=>v*roadTint[i]/oldRoadTint[i]);
const materialModel={version:'3.14',source:'dist/urban-architecture.js / URBAN_MATERIAL_PALETTE',wallTintSRGB:URBAN_MATERIAL_PALETTE.map(p=>p.wall),wallDiffuseScale:.76,roadTintSRGB:0x92989c,roadAverageLinear:roadAlbedo,assumption:'Static envelope averages including 3.14 civic/service/mineral embankment materials; scanned asphalt baseline average is rescaled by the current linear material tint. Individual windows, metal, shop interiors and textured facade variation are averaged.'};
const buildings=new Map(CITY_BUILDINGS.map(b=>[b.id,b])),landmarks=new Map(LANDMARK_COLLIDERS.map(g=>[g.id,g])),sourceSolids=new Map(CITY_COLLIDERS.map(g=>[g.id,g]));
const plannedAlbedos=Object.fromEntries(Object.entries({'warm-stone':0x9b9988,basalt:0x697573,ivory:0xc5c2ae,'aged-copper':0x826f59,oxide:0x967052,'corridor-pale':0xb3b0a4,'corridor-basalt':0x737f7d,'corridor-wood':0x60533d,'continuity-stone':0xb8b5a4,'service-concrete':0x8b9089,'weathered-steel':0x506064,'boundary-aggregate':0x737a6e}).map(([k,v])=>[k,colour(v).map(c=>c*.80)]));
function albedo(g){
  if(g.kind==='floor'||g.kind==='urban-road'||g.kind==='skyway')return roadAlbedo;
  const original=sourceSolids.get(g.id),material=original?.data?.material||landmarks.get(g.id)?.data?.material;
  if(plannedAlbedos[material])return plannedAlbedos[material];if(material==='glazing')return[.09,.12,.13];
  if(g.kind==='building'){const b=buildings.get(original?.buildingId||g.id.split('-tier-')[0]);return(b?.archetype==='civic'?colour(0xc3c1ad):walls[(g.style??b?.style??0)%5]).map(v=>v*.76);}
  if(material==='glass')return[.09,.12,.13];if(material==='timber')return[.24,.15,.08];if(material==='steel')return[.15,.17,.18];
  if(g.kind==='street-prop')return[.20,.19,.15];if(material==='limestone'||g.kind==='sidewalk')return[.42,.42,.38];
  return[.28,.29,.28];
}
const geometry=new RoadsterSim().getWorldGeometry();
const boxes=geometry.map(g=>{
  const q=new THREE.Quaternion(...g.quaternion),inv=q.clone().invert(),h=g.size.map(v=>v*.5),p=g.position;
  const matrix=new THREE.Matrix4().makeRotationFromQuaternion(q),e=matrix.elements;
  const ext=[Math.abs(e[0])*h[0]+Math.abs(e[4])*h[1]+Math.abs(e[8])*h[2],Math.abs(e[1])*h[0]+Math.abs(e[5])*h[1]+Math.abs(e[9])*h[2],Math.abs(e[2])*h[0]+Math.abs(e[6])*h[1]+Math.abs(e[10])*h[2]];
  return{p,h,inv:[inv.x,inv.y,inv.z,inv.w],q:[q.x,q.y,q.z,q.w],min:p.map((v,i)=>v-ext[i]),max:p.map((v,i)=>v+ext[i]),albedo:albedo(g)};
});
function build(list){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const b of list)for(let k=0;k<3;k++){min[k]=Math.min(min[k],b.min[k]);max[k]=Math.max(max[k],b.max[k]);}if(list.length<=6)return{min,max,boxes:list};const axis=max.map((v,i)=>v-min[i]).reduce((a,v,i,arr)=>v>arr[a]?i:a,0);list.sort((a,b)=>a.p[axis]-b.p[axis]);const m=list.length>>1;return{min,max,left:build(list.slice(0,m)),right:build(list.slice(m))};}
const tree=build([...boxes]);
function rotate(v,q){const[x,y,z]=v,[qx,qy,qz,qw]=q,tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);return[x+qw*tx+qy*tz-qz*ty,y+qw*ty+qz*tx-qx*tz,z+qw*tz+qx*ty-qy*tx];}
function slab(o,d,min,max,far){let lo=0,hi=far;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-10){if(o[k]<min[k]||o[k]>max[k])return Infinity;}else{let a=(min[k]-o[k])/d[k],b=(max[k]-o[k])/d[k];if(a>b)[a,b]=[b,a];lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi)return Infinity;}}return lo;}
function trace(o,d,maxDistance=1800){let best=maxDistance,hit=null;const stack=[tree];while(stack.length){const node=stack.pop();if(slab(o,d,node.min,node.max,best)===Infinity)continue;if(node.boxes){for(const b of node.boxes){const ol=rotate(o.map((v,i)=>v-b.p[i]),b.inv),dl=rotate(d,b.inv);let near=-Infinity,far=best,axis=0,sign=0;for(let k=0;k<3;k++){if(Math.abs(dl[k])<1e-10){if(Math.abs(ol[k])>b.h[k]){far=-Infinity;break;}}else{let a=(-b.h[k]-ol[k])/dl[k],c=(b.h[k]-ol[k])/dl[k],s=-1;if(a>c){[a,c]=[c,a];s=1;}if(a>near){near=a;axis=k;sign=s;}far=Math.min(far,c);}}if(near>1e-4&&near<=far&&near<best){best=near;const n=[0,0,0];n[axis]=sign;hit={distance:near,normal:rotate(n,b.q),albedo:b.albedo};}}}else{stack.push(node.left,node.right);}}return hit;}
function inside(p){const stack=[tree];while(stack.length){const n=stack.pop();if(p.some((v,k)=>v<n.min[k]||v>n.max[k]))continue;if(n.boxes){for(const b of n.boxes){const l=rotate(p.map((v,k)=>v-b.p[k]),b.inv);if(l.every((v,k)=>Math.abs(v)<b.h[k]+.045))return true;}}else stack.push(n.left,n.right);}return false;}
function rawSky(d){const u=(Math.atan2(d[2],d[0])/(2*Math.PI)+.5+1)%1,v=Math.acos(Math.max(-1,Math.min(1,d[1])))/Math.PI,x=Math.min(hdr.width-1,Math.floor(u*hdr.width)),y=Math.min(hdr.height-1,Math.floor(v*hdr.height)),i=(y*hdr.width+x)*4;return[hdr.data[i],hdr.data[i+1],hdr.data[i+2]];}
const sunFill=rawSky(normalize([sun[0]+.045,sun[1],sun[2]-.045]));
function sky(d){const c=dot(d,sun)>Math.cos(.025)?sunFill:rawSky(d);return c.map(v=>Math.min(16,v)*.80);}
const skySH=new Array(27).fill(0);for(let i=0;i<8192;i++){const d=fibonacciDirection(i,8192),c=sky(d),basis=shBasis(d);for(let j=0;j<9;j++)for(let k=0;k<3;k++)skySH[j*3+k]+=c[k]*basis[j]*4*Math.PI/8192;}
let seed=73891;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
function hemisphere(n){const a=2*Math.PI*rand(),r=Math.sqrt(rand()),z=Math.sqrt(1-r*r),t=normalize(Math.abs(n[1])<.9?[n[2],0,-n[0]]:[0,-n[2],n[1]]),b=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]];return n.map((v,k)=>v*z+t[k]*r*Math.cos(a)+b[k]*r*Math.sin(a));}
function radiance(origin,direction,depth=bounces){let o=origin,d=direction,L=[0,0,0],throughput=[1,1,1];for(let k=0;k<depth;k++){const hit=trace(o,d);if(!hit){const c=sky(d);for(let j=0;j<3;j++)L[j]+=throughput[j]*c[j];break;}const p=o.map((v,j)=>v+d[j]*hit.distance+hit.normal[j]*.025),cos=Math.max(0,dot(hit.normal,sun));if(cos>0&&!trace(p,sun))for(let j=0;j<3;j++)L[j]+=throughput[j]*hit.albedo[j]*[1,.947,.865][j]*2.7*cos/Math.PI;for(let j=0;j<3;j++)throughput[j]*=hit.albedo[j];o=p;d=hemisphere(hit.normal);}return L;}
if(process.argv.includes('--audit')){
  const cases=[];
  for(const p of [[-200,.8,-344],[-200,.8,-264],[-200,14,-264],[0,2.6,-350]]){
    const project=(count,depth)=>{const coeff=new Array(27).fill(0);for(let i=0;i<count;i++){seed=(Math.imul(i+31,1664525)+73891)>>>0;const d=fibonacciDirection(i,count,.4),L=radiance(p,d,depth),basis=shBasis(d);for(let j=0;j<9;j++)for(let k=0;k<3;k++)coeff[j*3+k]+=L[k]*basis[j]*4*Math.PI/count;}return irradianceAt(coeff,[0,1,0]);};
    const levels=[1,2,3].map(depth=>project(1536,depth)),preview=project(768,3),reference=levels[2];
    for(let i=1;i<3;i++)for(let c=0;c<3;c++)if(levels[i][c]+1e-10<levels[i-1][c])throw Error('Non-monotonic light transport');
    const relativeError=Math.hypot(...preview.map((v,i)=>v-reference[i]))/Math.max(.03,Math.hypot(...reference));
    if(relativeError>.25)throw Error('Probe convergence exceeds 25% at '+p);
    cases.push({point:p,bounceIrradiance:levels,preview768:preview,reference1536:reference,relativeError});
  }
  const report={status:'passed',meaning:'Independent fixed-direction three-event transport and 768/1536-ray convergence spot checks; not a full-scene ground truth',cases};writeFileSync(new URL(`../qa/irradiance-convergence-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exit(0);
}
const output=new URL('../dist/assets/irradiance/',import.meta.url);mkdirSync(output,{recursive:true});
const volumes=[];let valid=0,total=0;
for(const volume of GI_VOLUMES){const[nx,nz]=volume.size,ny=GI_HEIGHTS.length,data=new Uint16Array(nx*nz*ny*9*4);let validHere=0;
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const p=[volume.min[0]+x*volume.step[0],GI_HEIGHTS[y],volume.min[1]+z*volume.step[1]];total++;if(inside(p))continue;valid++;validHere++;
    const coefficients=new Array(27).fill(0),phase=rand()*Math.PI*2;
    for(let i=0;i<samples;i++){const d=fibonacciDirection(i,samples,phase),L=radiance(p,d),basis=shBasis(d);for(let j=0;j<9;j++)for(let k=0;k<3;k++)coefficients[j*3+k]+=L[k]*basis[j]*4*Math.PI/samples;}
    for(let j=0;j<9;j++){const index=(((y*9+j)*nz+z)*nx+x)*4;for(let k=0;k<3;k++)data[index+k]=THREE.DataUtils.toHalfFloat(coefficients[j*3+k]);data[index+3]=THREE.DataUtils.toHalfFloat(1);}
  }
  const name=volume.id+'.bin';writeFileSync(new URL(name,output),new Uint8Array(data.buffer));volumes.push({...volume,heights:GI_HEIGHTS,file:name,validProbes:validHere,bytes:data.byteLength,sha256:createHash('sha256').update(new Uint8Array(data.buffer)).digest('hex')});console.log(volume.id,validHere,'valid probes');
}
const sourceFiles=['dist/city-data.js','dist/city-continuity.js','dist/city-street-sections.js','dist/street-life.js','dist/city-plan.js','dist/city-landmarks.js','dist/urban-architecture.js','dist/irradiance-math.js','scripts/bake-indirect.mjs'];
const report={version:1,createdAt:new Date().toISOString(),sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')])),algorithm:'Offline diffuse path tracing / explicit sun next-event estimation / cosine hemisphere / order-2 real SH',bounces,samplesPerProbe:samples,sunDirection:sun,sunIntensity:2.7,skyIntensity:.8,skySH,sunFill,skyUpIrradiance:irradianceAt(skySH,[0,1,0]),volumes,totalProbes:total,validProbes:valid,staticEnvelopes:boxes.length,seconds:(performance.now()-start)/1000,geometrySHA256:createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),geometryCanonicalSHA256:createHash('sha256').update(canonicalGeometryJSON(geometry)).digest('hex'),geometryHashQuantization:1e-9,materialModel,materialModelSHA256:createHash('sha256').update(JSON.stringify(materialModel)).digest('hex'),limitations:['Static shared solid envelopes and average diffuse reflectances; fine facade, foliage and animated people are not path-traced.','Three surface events; not an unlimited-bounce solution, hardware ray tracing or DDGI.','Invalid solid probes are rejected; finite probe spacing may leak or blur lighting near thin geometry.','Specular reflections remain rasterized local probes; transparent transport and participating media are excluded.','Rebaked with the current physical geometry, including the retained corridor/3.13 entrance and the 3.14 continuity, roof silhouettes and peripheral banks; fine facade articulation remains an averaged envelope, not a facade-detail lightmap.']};
writeFileSync(new URL('manifest.json',output),JSON.stringify(report,null,2)+'\n');writeFileSync(new URL(`../qa/irradiance-bake-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log('Baked',valid,'/',total,'in',report.seconds.toFixed(1),'seconds. Sky upward E:',report.skyUpIrradiance);
