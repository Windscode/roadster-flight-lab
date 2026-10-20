import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as THREE from '../dist/vendor/three.module.js';
import {createIndirectLighting} from '../dist/indirect-lighting.js';
import {RoadsterSim} from '../dist/physics.js';
import {partitionCityGeometry} from '../qa/city-geometry-scope.mjs';
import {URBAN_MATERIAL_PALETTE} from '../dist/urban-architecture.js';
import {irradianceAt,shBasis,fibonacciDirection,canonicalGeometryJSON} from '../dist/irradiance-math.js';
const checks=[],pass=s=>{checks.push(s);console.log('PASS: '+s);};
const constant=[.3,.6,1.1],coeff=new Array(27).fill(0);
for(let i=0;i<8192;i++){const d=fibonacciDirection(i,8192),b=shBasis(d);for(let j=0;j<9;j++)for(let c=0;c<3;c++)coeff[j*3+c]+=constant[c]*b[j]*4*Math.PI/8192;}
for(const n of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const E=irradianceAt(coeff,n);E.forEach((v,c)=>assert.ok(Math.abs(v-constant[c]*Math.PI)<.0001));}
pass('Isotropic radiance integrates to pi times radiance on six normals without double cosine convolution');
{
 const c=Array.from({length:27},(_,i)=>Math.sin(i*.7)*.3),sh=new THREE.SphericalHarmonics3();for(let i=0;i<9;i++)sh.coefficients[i].set(...c.slice(i*3,i*3+3));
 for(let i=0;i<64;i++){const n=fibonacciDirection(i,64),a=irradianceAt(c,n),b=sh.getIrradianceAt(new THREE.Vector3(...n),new THREE.Vector3());a.forEach((v,j)=>assert.ok(Math.abs(v-Math.max(0,b.getComponent(j)))<.000005));}
}
pass('Directional SH evaluation agrees with the independent Three.js irradiance implementation across 64 normals');
const manifest=JSON.parse(readFileSync('dist/assets/irradiance/manifest.json')),fullGeometry=new RoadsterSim().getWorldGeometry(),geometryScope=partitionCityGeometry(fullGeometry);
const fullGeometryCanonicalSHA256=createHash('sha256').update(canonicalGeometryJSON(fullGeometry)).digest('hex');
assert.equal(createHash('sha256').update(canonicalGeometryJSON(fullGeometry)).digest('hex'),manifest.geometryCanonicalSHA256,'A baked static envelope changed above 1e-9 precision: rebake the field');
const approximation='The 3.10 rebake includes all '+geometryScope.added.length+' retained 3.9 corridor entities. Fine 3.10 facade articulation uses the shared closed envelopes and averaged diffuse reflectance, not a per-detail lightmap.';
assert.equal(manifest.geometryHashQuantization,1e-9);
assert.deepEqual(manifest.materialModel.wallTintSRGB,URBAN_MATERIAL_PALETTE.map(p=>p.wall),'The shared wall palette changed: rebake the diffuse field');
assert.equal(createHash('sha256').update(JSON.stringify(manifest.materialModel)).digest('hex'),manifest.materialModelSHA256,'The bake material description no longer matches its recorded identity');
let valid=0,total=0;
for(const v of manifest.volumes){
 const bytes=readFileSync('dist/assets/irradiance/'+v.file);assert.equal(bytes.length,v.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),v.sha256);assert.equal(bytes.length,v.size[0]*v.size[1]*v.heights.length*9*8);
 for(let y=0;y<v.heights.length;y++)for(let z=0;z<v.size[1];z++)for(let x=0;x<v.size[0];x++){
  total++;let validity;const c=[];
  for(let j=0;j<9;j++){const index=(((y*9+j)*v.size[1]+z)*v.size[0]+x)*8,a=THREE.DataUtils.fromHalfFloat(bytes.readUInt16LE(index+6));assert.ok(a===0||a===1);if(j===0)validity=a;else assert.equal(a,validity);for(let k=0;k<3;k++){const value=THREE.DataUtils.fromHalfFloat(bytes.readUInt16LE(index+k*2));assert.ok(Number.isFinite(value));c.push(value);if(!a)assert.equal(value,0);}}
  if(validity){valid++;for(const n of [[0,1,0],[0,-1,0],[1,0,0],[0,0,1]])assert.ok(irradianceAt(c,n).every(value=>Number.isFinite(value)&&value>=0&&value<30));}
 }
}
assert.equal(valid,manifest.validProbes);assert.equal(total,manifest.totalProbes);assert.ok(valid<total&&valid>10000);
pass('Every stored probe has finite coefficients, consistent validity, exact dimensions and verified data, full current canonical geometry and material identities');
{
 const result=spawnSync(process.execPath,['scripts/bake-indirect.mjs','--audit'],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);const report=JSON.parse(readFileSync('qa/irradiance-convergence-3.11.json'));assert.equal(report.status,'passed');assert.ok(report.cases.every(c=>c.relativeError<.25));
}
pass('Four city locations retain nonnegative bounce energy and agree with a 1536-ray transport reference within the documented spot-check tolerance');
const shader=readFileSync('dist/indirect-lighting.js','utf8');assert.ok(shader.includes('textureLod(field'));assert.ok(shader.includes('reflectedLight.indirectDiffuse*=mix'));assert.ok(!shader.includes('reflectedLight.directDiffuse*='));
pass('Contact AO affects only indirect diffuse; spatial probe samples use explicit LOD in divergent geometry branches');
{
 const load=async url=>{const b=readFileSync(url);return{ok:true,json:async()=>JSON.parse(b.toString('utf8')),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
 const gi=createIndirectLighting({},{fetchAsset:load});assert.equal(gi.exposureAt({x:0,y:3,z:0}),.90);await gi.ready;assert.equal(gi.stats.loaded,true);
 const open=gi.exposureAt({x:0,y:32,z:-350},true),shade=gi.exposureAt({x:-200,y:.8,z:-264},false);assert.ok(open>=.90&&open<1.2);assert.ok(shade>open*1.4&&shade<=2.7);
 for(const p of [{x:-200,y:.8,z:-344},{x:-180,y:14,z:48},{x:680,y:100,z:-650}])for(const sun of [true,false])assert.ok(Number.isFinite(gi.exposureAt(p,sun))&&gi.exposureAt(p,sun)>=.9&&gi.exposureAt(p,sun)<=2.7);
}
pass('Camera adaptation responds to spatial shade and sun visibility, stays bounded and has an unloaded fixed-exposure fallback');
writeFileSync('qa/indirect-light-validation-3.11.json',JSON.stringify({status:'passed',checks,validProbes:valid,totalProbes:total,bounces:manifest.bounces,samplesPerProbe:manifest.samplesPerProbe,geometrySHA256:manifest.geometrySHA256,geometryCanonicalSHA256:manifest.geometryCanonicalSHA256,geometryHashQuantization:manifest.geometryHashQuantization,materialModelSHA256:manifest.materialModelSHA256,fullGeometryCanonicalSHA256,newSharedEntityIds:geometryScope.addedIds,limits:[...manifest.limitations,approximation]},null,2)+'\n');
