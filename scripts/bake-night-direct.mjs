import {REPORT_VERSION} from './qa-report-version.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {createEnvironment} from '../dist/city-environment.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';
import {NIGHT_FIELD_LAYOUT,createNightOccluders,evaluateNightCoefficients} from '../dist/city-night-transport.js';
import {createNightDirectEvaluator} from '../dist/night-direct-transport.js';
const begin=performance.now(),sha=value=>createHash('sha256').update(value).digest('hex');
globalThis.fetch=async url=>{try{const b=readFileSync(url);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return {ok:false};}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
const geometry=new RoadsterSim().getWorldGeometry(),environment=createEnvironment(scene,renderer,geometry,camera);await environment.ready;
const anchors=environment.getPracticalLightAnchors(),occluders=createNightOccluders(geometry),evaluator=createNightDirectEvaluator(anchors,occluders),output=new URL('../dist/assets/night-direct-irradiance/',import.meta.url);mkdirSync(output,{recursive:true});
const volumes=[];let valid=0,total=0,blockedSegments=0,contributions=0;
for(const volume of NIGHT_FIELD_LAYOUT.volumes){
  const[nx,nz]=volume.size,ny=NIGHT_FIELD_LAYOUT.heights.length,data=new Uint16Array(nx*nz*ny*6*4);let validHere=0;
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const p=[volume.min[0]+x*volume.step[0],NIGHT_FIELD_LAYOUT.heights[y],volume.min[1]+z*volume.step[1]];total++;if(occluders.inside(p))continue;valid++;validHere++;
    const value=evaluator.evaluate(p);blockedSegments+=value.blocked;contributions+=value.contributing;
    for(let j=0;j<6;j++){const i=(((j*ny+y)*nz+z)*nx+x)*4;for(let k=0;k<3;k++)data[i+k]=THREE.DataUtils.toHalfFloat(value.coefficients[j*3+k]);data[i+3]=THREE.DataUtils.toHalfFloat(1);}
  }
  const file=volume.id.replace('night-','night-direct-')+'.bin',bytes=new Uint8Array(data.buffer);writeFileSync(new URL(file,output),bytes);volumes.push({...volume,file,validProbes:validHere,bytes:bytes.byteLength,sha256:sha(bytes)});console.log(file,validHere,'valid probes');
}
const cases=[[-200,.6,-376],[-200,.6,-344],[-200,.6,-279],[-203,2.4,-264],[-138,.6,-398],[-190.1,2.4,-370],[-200,12,-264],[-430,.6,-424],[-430,.6,-430.5],[-430,.8,-439],[126.8,.6,245.5],[300,8.6,300],[500,8.6,342],[615,.6,0]].map(position=>{const a=evaluator.evaluate(position),b=evaluator.evaluate(position,{occlusion:false});return {position,coefficients:a.coefficients,upIrradiance:evaluateNightCoefficients(a.coefficients,[0,1,0]),sideIrradiance:evaluateNightCoefficients(a.coefficients,[1,0,0]),blockedSegments:a.blocked,contributingFixtures:a.contributing,unoccludedUpIrradiance:evaluateNightCoefficients(b.coefficients,[0,1,0])};});
const sourceFiles=['dist/city-data.js','dist/city-continuity.js','dist/city-street-sections.js','dist/street-life.js','dist/city-plan.js','dist/city-horizon.js','dist/pavement-surface-material.js','dist/city-environment.js','dist/city-landmarks.js','dist/city-frontage-design.js','dist/urban-architecture.js','dist/night-direct-transport.js','dist/night-direct-lighting.js','dist/night-city-lighting.js','dist/city-night-transport.js','scripts/bake-night-direct.mjs'];
const report={version:1,createdAt:new Date().toISOString(),heights:NIGHT_FIELD_LAYOUT.heights,coefficients:6,volumes,totalProbes:total,validProbes:valid,anchors:anchors.length,staticEnvelopes:occluders.count,blockedSegments,contributions,
  geometryCanonicalSHA256:sha(canonicalGeometryJSON(geometry)),anchorSHA256:sha(JSON.stringify(anchors)),sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))])),seconds:(performance.now()-begin)/1000,
  algorithm:'Stationary fixture intensity/range/cone → static visibility → six-axis direct diffuse irradiance; separate from retained one-bounce transport',cases,
  assumptions:'Fixture intensities are authored visual estimates. Static direct diffuse replaces live street diffuse across a complementary 12–28 m viewing-distance transition. Headlamps, vehicle and live specular are excluded.',
  limits:['4/8 m route and 24 m outer probe spacing soften far light boundaries; these are not per-texel facade lightmaps.','Static closed envelopes exclude fine facade details and dynamic car occlusion. The near live region retains dynamic contact shadows.','The blend prevents additive double counting but still interpolates lighting approximations with different source coverage.','No GPU pixel, motion stability or frame-time acceptance follows from this offline bake.']};
report.identity=sha(JSON.stringify({geometry:report.geometryCanonicalSHA256,anchors:report.anchorSHA256,volumes:volumes.map(v=>v.sha256),layout:{heights:report.heights,coefficients:6}}));
writeFileSync(new URL('manifest.json',output),JSON.stringify(report,null,2)+'\n');writeFileSync(new URL(`../qa/night-direct-bake-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({identity:report.identity,bytes:volumes.reduce((n,v)=>n+v.bytes,0),seconds:report.seconds,cases},null,2));
