// One bounded comparison of the actual a347 and repaired full architecture.
// No renderer, product mutation, old snapshot relabelling, or relaxed budgets.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as THREE from '../../dist/vendor/three.module.js';
import {CITY_BUILDINGS} from '../../dist/city-data.js';
import {buildUrbanArchitecture} from '../../dist/urban-architecture.js';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../../dist/model-build.js';
import {MODEL_BUILD_ID as BEFORE_BUILD,MODEL_SOURCE_HASHES as BEFORE_HASHES} from './pre-batching-a347/model-build.js';

const root=new URL('../../',import.meta.url),here=new URL('./',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
const read=path=>readFileSync(new URL(path,root)),json=value=>JSON.stringify(value),sorted=entries=>entries.sort(([a],[b])=>a.localeCompare(b));
const provenance=JSON.parse(readFileSync(new URL('pre-batching-a347/provenance.json',here))),oldBytes=readFileSync(new URL('pre-batching-a347/urban-architecture.js',here)),currentBytes=read('dist/urban-architecture.js');
assert.equal(sha(oldBytes),provenance.files.find(row=>row.path==='dist/urban-architecture.js').sha256);
assert.equal(sha(oldBytes),BEFORE_HASHES['urban-architecture.js']);assert.equal(sha(currentBytes),MODEL_SOURCE_HASHES['urban-architecture.js']);
const oldSource=oldBytes.toString(),eol=oldSource.includes('\r\n')?'\r\n':'\n',mergeLine="    if(mergeDowntownConcrete&&kind==='darkConcrete')kind='concrete';"+eol,aliasLine="    else if(kind==='displayFrame')kind='edges';"+eol;
const expectedSource=oldSource.replace("level==='detail'&&kind==='edges'?80:160","level==='detail'&&(kind==='edges'||kind==='displayFrame')?80:160").replace(mergeLine,'').replace(aliasLine,aliasLine+mergeLine);
assert.equal(expectedSource,currentBytes.toString(),'No changes beyond the two declared batching edits, including canvas/texture authoring');

// Relocate only the frozen module's five relative imports. Reverse relocation
// must recover its original full bytes, including line endings.
const relocatedImports=[];
const relocated=oldBytes.toString().replace(/from (['"])(\.\/[^'"]+)\1/g,(whole,quote,path)=>{const url=new URL('dist/'+path.slice(2),root).href;relocatedImports.push({path,url,whole});return `from ${quote}${url}${quote}`;});
assert.equal(relocatedImports.length,5);let restored=relocated;
for(const item of relocatedImports)restored=restored.replace(`from '${item.url}'`,item.whole);
assert.equal(sha(restored),sha(oldBytes));
const {buildUrbanArchitecture:retained}=await import('data:text/javascript;base64,'+Buffer.from(relocated).toString('base64'));

// Check the actual static dependency closure, not just the five direct imports.
const dependencyHashes={},visited=new Set();
function dependencies(path){if(visited.has(path))return;visited.add(path);const bytes=read('dist/'+path);dependencyHashes[path]=sha(bytes);assert.equal(dependencyHashes[path],BEFORE_HASHES[path],`Frozen/current dependency differs: ${path}`);assert.equal(dependencyHashes[path],MODEL_SOURCE_HASHES[path]);
  for(const match of bytes.toString().matchAll(/(?:from\s*|import\s*)(['"])(\.[^'"]+)\1/g)){const target=new URL(match[2],new URL('dist/'+path,root));dependencies(decodeURIComponent(target.pathname.slice(new URL('dist/',root).pathname.length)));}}
for(const item of relocatedImports)dependencies(item.path.slice(2));dependencies('vendor/three.module.js');

// Only names/IDs used for bookkeeping are excluded. Actual material values,
// texture slots, callbacks, compiled shader source and uniforms are retained.
function value(v){
  if(v===undefined)return {undefined:true};if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number')return Number.isFinite(v)?v:String(v);if(typeof v==='function')return {functionSHA256:sha(v.toString())};
  if(v.isColor||v.isVector2||v.isVector3||v.isVector4||v.isMatrix3||v.isMatrix4)return {type:v.constructor.name,values:v.toArray()};
  if(ArrayBuffer.isView(v))return {type:v.constructor.name,values:Array.from(v)};
  if(Array.isArray(v))return v.map(value);
  return Object.fromEntries(sorted(Object.entries(v)).map(([key,entry])=>[key,value(entry)]));
}
const concreteNames=new Set(['Urban / aged mineral plaster','Urban / recessed concrete']);
function materialResponse(material){
  const properties=Object.fromEntries(sorted(Object.entries(material)).filter(([key])=>!['id','uuid','name','version','_listeners'].includes(key)).map(([key,entry])=>[key,value(entry)]));
  const shader={uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeRender();material.onBeforeCompile(shader,{});
  return {name:concreteNames.has(material.name)?'Equivalent mineral concrete':material.name,properties,programKey:material.customProgramCacheKey(),onBeforeRender:value(material.onBeforeRender),onBeforeCompile:value(material.onBeforeCompile),vertexShaderSHA256:sha(shader.vertexShader),fragmentShaderSHA256:sha(shader.fragmentShader),uniforms:value(shader.uniforms)};
}
const attrInfo=attribute=>({arrayType:attribute.array.constructor.name,itemSize:attribute.itemSize,normalized:attribute.normalized,usage:attribute.usage,gpuType:attribute.gpuType,meshPerAttribute:attribute.meshPerAttribute??null});
function collect(kit){
  const materials=new Map(),materialRecords={},geometryRecords={},rows=new Map(),matrix=new THREE.Matrix4(),normal=new THREE.Matrix3(),colour=new THREE.Color();let count=0;
  kit.group.updateMatrixWorld(true);kit.group.traverse(mesh=>{if(mesh.isMesh){assert.ok(mesh.isInstancedMesh,'Unexpected non-instanced authored geometry');materials.set(mesh.material,{});}});
  for(const quality of ['balanced','high','ultra']){kit.setQuality(quality);for(const [material,profiles] of materials)profiles[quality]=materialResponse(material);}
  kit.group.traverse(mesh=>{
    if(!mesh.isInstancedMesh)return;const material=materials.get(mesh.material),materialHash=sha(json(material));materialRecords[mesh.material.name]={sha256:materialHash,profiles:material};
    const attributes=sorted(Object.entries(mesh.geometry.attributes));
    const geometry={type:mesh.geometry.type,index:mesh.geometry.index?{...attrInfo(mesh.geometry.index),array:Array.from(mesh.geometry.index.array)}:null,groups:mesh.geometry.groups,drawRange:value(mesh.geometry.drawRange),attributes:Object.fromEntries(attributes.filter(([,a])=>!a.isInstancedBufferAttribute).map(([name,a])=>[name,{...attrInfo(a),array:Array.from(a.array)}]))},geometryHash=sha(json(geometry));geometryRecords[geometryHash]=geometry;
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);normal.getNormalMatrix(matrix);mesh.getColorAt(i,colour);
      const instanceAttributes=Object.fromEntries(attributes.filter(([,a])=>a.isInstancedBufferAttribute).map(([name,a])=>{assert.equal(a.meshPerAttribute,1);return[name,{...attrInfo(a),array:Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize))}];}));
      const record={geometryHash,materialHash,worldMatrix:matrix.toArray(),worldNormalMatrix:normal.toArray(),colour:colour.toArray(),instanceColourFormat:attrInfo(mesh.instanceColor),instanceAttributes,level:mesh.userData.renderDetail,castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow,frustumCulled:mesh.frustumCulled,visible:mesh.visible,renderOrder:mesh.renderOrder,layers:mesh.layers.mask,userData:Object.fromEntries(sorted(Object.entries(mesh.userData)).filter(([key])=>key!=='sector'))};
      const key=sha(json(record)),row=rows.get(key)??{count:0,record,sources:new Map()},source={batch:mesh.name,sector:mesh.userData.sector,material:mesh.material.name},sourceKey=json(source);row.count++;row.sources.set(sourceKey,(row.sources.get(sourceKey)||0)+1);rows.set(key,row);count++;
    }
  });
  return {count,rows,materialRecords,geometryRecords,stats:structuredClone(kit.stats),lightAnchors:structuredClone(kit.lightAnchors),instanceSetSHA256:sha(json(sorted([...rows].map(([key,row])=>[key,row.count]))))};
}

let before,after;
try{
  before=retained(THREE,new THREE.Group(),CITY_BUILDINGS);after=buildUrbanArchitecture(THREE,new THREE.Group(),CITY_BUILDINGS);await Promise.all([before.ready,after.ready]);
  const old=collect(before),now=collect(after),missing=[],added=[],batchChanges=[],unexpectedBatchChanges=[];
  const describe=(key,row,delta)=>({key,count:delta,record:row.record,sources:sorted([...row.sources]).map(([source,count])=>({...JSON.parse(source),count}))});
  for(const [key,row] of old.rows){const current=now.rows.get(key),delta=row.count-(current?.count??0);if(delta>0)missing.push(describe(key,row,delta));if(!current)continue;
    const from=sorted([...row.sources]),to=sorted([...current.sources]);if(json(from)===json(to))continue;
    const sources=[...from,...to].map(([source])=>JSON.parse(source)),kind=sources.every(source=>concreteNames.has(source.material))?'identical-concrete-label':row.record.level==='detail'&&sources.every(source=>source.material==='Urban / anodised frame')?'80-m-frame-spatial-group':null;
    const change={kind,instances:Math.min(row.count,current.count),from:from.map(([source,count])=>({...JSON.parse(source),count})),to:to.map(([source,count])=>({...JSON.parse(source),count}))};
    (kind?batchChanges:unexpectedBatchChanges).push(change);
  }
  for(const [key,row] of now.rows){const delta=row.count-(old.rows.get(key)?.count??0);if(delta>0)added.push(describe(key,row,delta));}
  const concreteEquivalent=old.materialRecords['Urban / aged mineral plaster'].sha256===old.materialRecords['Urban / recessed concrete'].sha256;
  const checks={onlyTwoDeclaredSourceEdits:expectedSource===currentBytes.toString(),allActualInstancesPreserved:old.count===now.count&&missing.length===0&&added.length===0,indexedTrianglesPreserved:old.stats.triangles===now.stats.triangles,onlyAllowedBatchMetadataChanges:unexpectedBatchChanges.length===0,concreteRenderingResponsesIdentical:concreteEquivalent,lightAnchorsPreserved:json(old.lightAnchors)===json(now.lightAnchors)};
  const differences={missing,added,unexpectedBatchChanges,allowedBatchChanges:batchChanges},differenceBytes=gzipSync(json(differences),{level:9});writeFileSync(new URL('batching-equivalence-differences.json.gz',here),differenceBytes);
  const report={schema:'roadster-batching-equivalence-3.18',createdAt:new Date().toISOString(),status:Object.values(checks).every(Boolean)?'passed':'failed',beforeBuild:BEFORE_BUILD,currentBuild:MODEL_BUILD_ID,sourceHashes:{frozenUrban:sha(oldBytes),currentUrban:sha(currentBytes),script:sha(readFileSync(new URL(import.meta.url))),dependencies:dependencyHashes},importRelocation:{count:relocatedImports.length,restoredOriginalSHA256:sha(restored),relocatedSHA256:sha(relocated),paths:relocatedImports.map(({path,url})=>({path,url}))},checks,instances:now.count,before:{instanceSetSHA256:old.instanceSetSHA256,stats:old.stats},after:{instanceSetSHA256:now.instanceSetSHA256,stats:now.stats},actualDifferences:{missingInstances:missing.reduce((n,row)=>n+row.count,0),addedInstances:added.reduce((n,row)=>n+row.count,0),unexpectedBatchChanges:unexpectedBatchChanges.length,concreteLabelInstances:batchChanges.filter(row=>row.kind==='identical-concrete-label').reduce((n,row)=>n+row.instances,0),spatialGroupInstances:batchChanges.filter(row=>row.kind==='80-m-frame-spatial-group').reduce((n,row)=>n+row.instances,0)},differenceArtifact:{file:'batching-equivalence-differences.json.gz',bytes:differenceBytes.length,sha256:sha(differenceBytes)},materials:{before:old.materialRecords,after:now.materialRecords},prototypeGeometry:now.geometryRecords,scope:['Exact unordered multiset comparison of actual full-city architecture instances; no epsilon rounding or tolerance change. World transforms and inverse-transpose normal matrices, all indexed faces and normal/UV arrays, instance colour/metric/glazing/atlas attributes, actual material properties/compiled callbacks/uniforms at balanced/high/ultra, LOD class and initial shadow eligibility are compared.','Only identical concrete names and frame spatial grouping are excluded from physical instance identity. The complete real batch metadata differences are saved.','DOM-free construction: canvas atlas pixels and asynchronously loaded image pixels are not generated here. Their unchanged authoring/dependency sources are verified; this is not a browser image, shader execution, shadow raster, or GPU performance test.','Spatial batch bounds intentionally change culling and distance-trigger decisions. Equal LOD class and shadow eligibility do not claim identical visibility at arbitrary cameras. The unchanged fifteen-view draw/triangle budget is validated separately.']};
  writeFileSync(new URL('batching-equivalence-result.json',here),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,beforeBuild:BEFORE_BUILD,currentBuild:MODEL_BUILD_ID,checks,instances:now.count,beforeBatches:old.stats.drawBatches,afterBatches:now.stats.drawBatches,triangles:now.stats.triangles,actualDifferences:report.actualDifferences},null,2));assert.equal(report.status,'passed','Real differences retained in batching-equivalence-result.json and compressed differences');
}finally{before?.dispose();after?.dispose();}
