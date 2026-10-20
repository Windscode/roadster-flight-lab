import {REPORT_VERSION} from './qa-report-version.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {createEnvironment} from '../dist/city-environment.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';
import {NIGHT_FIELD_LAYOUT,createNightOccluders,makeNightBounceSources,createNightBounceEvaluator,evaluateNightCoefficients} from '../dist/city-night-transport.js';

const begin=performance.now(),sha=value=>createHash('sha256').update(value).digest('hex');
// No browser or GL context. Construction is used only to obtain the exact
// runtime fixture records; image appearance is deliberately not inferred here.
globalThis.fetch=async url=>{try{const b=readFileSync(url);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return {ok:false};}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),renderer={
  capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
const geometry=new RoadsterSim().getWorldGeometry(),environment=createEnvironment(scene,renderer,geometry,camera);
await environment.ready;
const anchors=environment.getPracticalLightAnchors(),occluders=createNightOccluders(geometry),sources=makeNightBounceSources(anchors,occluders),evaluator=createNightBounceEvaluator(sources,occluders);
const output=new URL('../dist/assets/night-irradiance/',import.meta.url);mkdirSync(output,{recursive:true});
const volumes=[];let valid=0,total=0,blockedSegments=0,contributions=0;
for(const volume of NIGHT_FIELD_LAYOUT.volumes){
  const[nx,nz]=volume.size,ny=NIGHT_FIELD_LAYOUT.heights.length,data=new Uint16Array(nx*nz*ny*6*4);let validHere=0;
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const p=[volume.min[0]+x*volume.step[0],NIGHT_FIELD_LAYOUT.heights[y],volume.min[1]+z*volume.step[1]];total++;if(occluders.inside(p))continue;valid++;validHere++;
    const value=evaluator.evaluate(p);blockedSegments+=value.blocked;contributions+=value.contributing;
    for(let j=0;j<6;j++){const i=(((j*ny+y)*nz+z)*nx+x)*4;for(let k=0;k<3;k++)data[i+k]=THREE.DataUtils.toHalfFloat(value.coefficients[j*3+k]);data[i+3]=THREE.DataUtils.toHalfFloat(1);}
  }
  const file=volume.id+'.bin',bytes=new Uint8Array(data.buffer);writeFileSync(new URL(file,output),bytes);
  volumes.push({...volume,file,validProbes:validHere,bytes:bytes.byteLength,sha256:sha(bytes)});console.log(volume.id,validHere,'valid probes');
}
const cases=[[-200,.6,-393],[-200,.6,-279],[-203,2.4,-264],[-138,.6,-398],[-190.1,2.4,-370],[-200,12,-264],[-430,.6,-424],[-430,.6,-430.5],[-430,.8,-439]].map(position=>{
  const visible=evaluator.evaluate(position),unoccluded=evaluator.evaluate(position,{occlusion:false});
  return {position,coefficients:visible.coefficients,upIrradiance:evaluateNightCoefficients(visible.coefficients,[0,1,0]),sideIrradiance:evaluateNightCoefficients(visible.coefficients,[1,0,0]),
    blockedSegments:visible.blocked,contributingSources:visible.contributing,unoccludedUpIrradiance:evaluateNightCoefficients(unoccluded.coefficients,[0,1,0])};
});
const sourceFiles=['dist/city-environment.js','dist/city-landmarks.js','dist/city-frontage-design.js','dist/city-night-transport.js','dist/city-corridor-plan.js','dist/urban-architecture.js','dist/night-city-lighting.js','scripts/bake-night-city.mjs'];
const report={version:1,createdAt:new Date().toISOString(),...NIGHT_FIELD_LAYOUT,volumes,totalProbes:total,validProbes:valid,anchors:anchors.length,bounceSources:sources.length,staticEnvelopes:occluders.count,blockedSegments,contributions,
  geometryCanonicalSHA256:sha(canonicalGeometryJSON(geometry)),anchorSHA256:sha(JSON.stringify(anchors)),sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))])),seconds:(performance.now()-begin)/1000,
  algorithm:'Fixture cone quadrature → first static envelope hit → cosine diffuse virtual source → visible probe; nonnegative six-axis ambient-cube storage',
  albedos:'Linear representative envelope reflectances: asphalt .070/.075/.078, paving .30/.31/.28, walls .27/.29/.28; these are engineering estimates.',cases,
  limits:['Reflected diffuse only; camera-selected direct spots and headlights are not baked.','Static envelope occlusion includes current corridor fixtures and the shared South Quay entry canopy. Sub-grid facade bevels, actual room interiors and dynamic car occlusion are excluded.','Only one diffuse surface event and finite-range softened virtual sources; finite probe interpolation can soften light near corners.','No screenshot, motion stability, frame time, GPU or subjective lighting acceptance follows from this bake.']};
report.identity=sha(JSON.stringify({geometry:report.geometryCanonicalSHA256,anchors:report.anchorSHA256,volumes:volumes.map(v=>v.sha256),layout:NIGHT_FIELD_LAYOUT}));
writeFileSync(new URL('manifest.json',output),JSON.stringify(report,null,2)+'\n');
writeFileSync(new URL(`../qa/night-irradiance-bake-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({identity:report.identity,bytes:volumes.reduce((n,v)=>n+v.bytes,0),seconds:report.seconds,cases},null,2));
