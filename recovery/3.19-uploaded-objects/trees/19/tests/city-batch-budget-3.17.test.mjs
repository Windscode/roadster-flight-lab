import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';
import {buildUrbanArchitecture as current} from '../dist/urban-architecture.js';
import {buildUrbanArchitecture as retained} from '../qa/fixtures/urban-architecture-before-batch-3.17.mjs';

// This repair changes batching only. Verify every actual authored instance,
// prototype face/index/normal/UV, metric/glazing/atlas attribute, response and
// original LOD/shadow flag independently of the mesh's label and batch cell.
// The separate unmodified 15-view budget catches larger merged-frustum costs.
const sha=s=>createHash('sha256').update(s).digest('hex');
const provenance=JSON.parse(readFileSync(new URL('../qa/fixtures/urban-architecture-before-batch-3.17.provenance.json',import.meta.url)));
const fixture=readFileSync(new URL('../qa/fixtures/urban-architecture-before-batch-3.17.mjs',import.meta.url),'utf8');
assert.equal(sha(fixture),provenance.fixtureSHA256);
let original=fixture;for(const f of provenance.changedOnlyImportSpecifiers)original=original.replaceAll("'../../dist/"+f+"'","'./"+f+"'");assert.equal(sha(original),provenance.originalSHA256);
const before=retained(THREE,new THREE.Group(),CITY_BUILDINGS),after=current(THREE,new THREE.Group(),CITY_BUILDINGS);
await Promise.all([before.ready,after.ready]);
function materialIdentity(material){
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader,{});
  return {type:material.type,color:material.color.toArray(),emissive:material.emissive.toArray(),emissiveIntensity:material.emissiveIntensity,roughness:material.roughness,metalness:material.metalness,envMapIntensity:material.envMapIntensity,opacity:material.opacity,transparent:material.transparent,side:material.side,blending:material.blending,depthWrite:material.depthWrite,depthTest:material.depthTest,wireframe:material.wireframe,flatShading:material.flatShading,toneMapped:material.toneMapped,alphaTest:material.alphaTest,polygonOffset:material.polygonOffset,map:material.map,normalMap:material.normalMap,roughnessMap:material.roughnessMap,metalnessMap:material.metalnessMap,emissiveMap:material.emissiveMap,surface:material.userData.exteriorSurface||null,vertexShader:sha(shader.vertexShader),fragmentShader:sha(shader.fragmentShader),programKey:material.customProgramCacheKey()};
}
function collect(kit){
  const rows=new Map(),materials={},matrix=new THREE.Matrix4(),colour=new THREE.Color();let count=0;
  kit.group.traverse(mesh=>{
    if(!mesh.isInstancedMesh)return;
    const m=materialIdentity(mesh.material),materialHash=sha(JSON.stringify(m));materials[mesh.material.name]={hash:materialHash,response:m};
    const attributes=Object.entries(mesh.geometry.attributes).sort(([a],[b])=>a.localeCompare(b));
    const geometry={type:mesh.geometry.type,index:Array.from(mesh.geometry.index?.array||[]),attributes:Object.fromEntries(attributes.filter(([,a])=>!a.isInstancedBufferAttribute).map(([name,a])=>[name,{size:a.itemSize,normalized:a.normalized,array:Array.from(a.array)}]))},geometryHash=sha(JSON.stringify(geometry));
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);mesh.getColorAt(i,colour);
      const instanceAttributes=Object.fromEntries(attributes.filter(([,a])=>a.isInstancedBufferAttribute).map(([name,a])=>{assert.equal(a.meshPerAttribute,1);return[name,Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize))];}));
      const key=sha(JSON.stringify({geometryHash,materialHash,matrix:matrix.toArray(),colour:colour.toArray(),instanceAttributes,level:mesh.userData.renderDetail,castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow}));rows.set(key,(rows.get(key)||0)+1);count++;
    }
  });
  return{rows,count,materials,canonicalSHA256:sha(JSON.stringify([...rows.entries()].sort(([a],[b])=>a.localeCompare(b))))};
}
const old=collect(before),now=collect(after);
assert.equal(old.materials['Urban / aged mineral plaster'].hash,old.materials['Urban / recessed concrete'].hash,'Only numerically and shader-identical responses may be merged');
assert.equal(now.count,old.count);assert.equal(after.stats.triangles,before.stats.triangles);assert.deepEqual(now.rows,old.rows,'Every actual instance and surface response must survive unchanged');assert.ok(after.stats.drawBatches<before.stats.drawBatches);
const report={schema:'roadster-city-batch-equivalence-3.17',status:'passed',createdAt:new Date().toISOString(),provenance,checks:['Frozen pre-repair builder differs only by independently verified import relocation','Both concrete responses match all recorded actual material and shader parameters','Every full-scene instance, prototype indexed geometry, normal/UV, tint, metric/glazing/sign attribute, LOD and shadow flag matches','Allocated triangles are unchanged and real instance batches decrease'],instances:now.count,instanceSetSHA256:now.canonicalSHA256,before:{triangles:before.stats.triangles,batches:before.stats.drawBatches},after:{triangles:after.stats.triangles,batches:after.stats.drawBatches},mergedMaterialResponses:{plaster:old.materials['Urban / aged mineral plaster'],recessed:old.materials['Urban / recessed concrete']},sourceHashes:Object.fromEntries(['dist/urban-architecture.js','dist/city-exterior-materials.js','dist/city-render-budget.js','tests/city-batch-budget-3.17.test.mjs'].map(f=>[f,sha(readFileSync(new URL('../'+f,import.meta.url)))])),scope:'Actual Three object equivalence before culling; material names and sector identifiers are intentionally excluded. Atlas construction is DOM-free in both builders. This cannot replace the unchanged 15-view draw/triangle contract, native pixels, GPU performance or arbitrary-camera tests.'};
writeFileSync(new URL('../qa/city-batch-equivalence-3.17.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
before.dispose();after.dispose();console.log(JSON.stringify({status:report.status,instances:report.instances,before:report.before,after:report.after,instanceSetSHA256:report.instanceSetSHA256},null,2));
