import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';
import {buildUrbanArchitecture as current,routeFacingFacade,backgroundGroundFrontage} from '../dist/urban-architecture.js';
import {buildUrbanArchitecture as previous} from './fixtures/urban-architecture-before-budget-3.16.mjs';

// Reconstruct both real InstancedMesh trees. No copied generator formula is
// used to predict the new pane: compare actual front vertices, normals, UVs,
// colour and material response from the two independently retained modules.
const sha=s=>createHash('sha256').update(s).digest('hex'),checks=[];
const provenance=JSON.parse(readFileSync(new URL('./fixtures/urban-architecture-before-budget-3.16.provenance.json',import.meta.url)));
const fixture=readFileSync(new URL('./fixtures/urban-architecture-before-budget-3.16.mjs',import.meta.url),'utf8');
assert.equal(sha(fixture),provenance.fixtureSHA256);
let restored=fixture;for(const file of provenance.changedOnlyImportSpecifiers)restored=restored.replaceAll("'../../dist/"+file+"'","'./"+file+"'");
assert.equal(sha(restored),provenance.originalSHA256,'Only import relocation may differ from the retained original');
// 3.17 remodelled downtown upper walls; 3.18 also authors the addressed
// ground-floor showcase and upper-occupancy modules. Those shapes cannot be
// declared equal to the old art. Keep exact representation equality for every
// building that uses neither edited module, and retain the whole-city budgets
// plus city-street-detail-3.18 checks for the deliberately edited parcels.
const redesigned=CITY_BUILDINGS.filter(b=>b.id.startsWith('block-')||b.id.startsWith('arcology-')||b.archetype!=='foundry'&&[0,1,2,3].some(side=>routeFacingFacade(b,side)||backgroundGroundFrontage(b,side)));
const retained=CITY_BUILDINGS.filter(b=>!redesigned.includes(b));
const before=previous(THREE,new THREE.Group(),retained),after=current(THREE,new THREE.Group(),retained);
await Promise.all([before.ready,after.ready]);
assert.equal(before.stats.instances,after.stats.instances,'No authored instance may be removed to pass a budget');
const matrix=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3(),colour=new THREE.Color();
function collect(kit){
  const panes=[],other=new Map();let attributesMax=0;
  kit.group.traverse(mesh=>{
    if(!mesh.isInstancedMesh)return;
    // Count real attribute locations, including the four matrix columns.
    const locations=Object.keys(mesh.geometry.attributes).length+4+(mesh.instanceColor?1:0);attributesMax=Math.max(attributesMax,locations);assert.ok(locations<=16);
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);mesh.getColorAt(i,colour);
      const material=mesh.material,kind=material.userData.exteriorSurface,level=mesh.userData.renderDetail;
      if(kind!=='glass'){
        const key=JSON.stringify({geometry:mesh.geometry.type,level,matrix:matrix.toArray(),colour:colour.toArray(),material:material.name,roughness:material.roughness,metalness:material.metalness});
        other.set(key,(other.get(key)||0)+1);continue;
      }
      const position=mesh.geometry.getAttribute('position'),normal=mesh.geometry.getAttribute('normal'),uv=mesh.geometry.getAttribute('uv'),metric=mesh.geometry.getAttribute('exteriorMetric'),instance=mesh.geometry.getAttribute('urbanGlazing');
      const face=[];for(let j=0;j<normal.count;j++)if(normal.getZ(j)>.99999)face.push(j);
      assert.equal(face.length,4,'Only the actual outward planar quad is compared');normalMatrix.getNormalMatrix(matrix);
      const vertices=face.map(j=>new THREE.Vector3().fromBufferAttribute(position,j).applyMatrix4(matrix).toArray());
      const centre=vertices.reduce((sum,v)=>sum.map((n,k)=>n+v[k]/4),[0,0,0]);
      const emission=instance?[instance.getX(i),instance.getY(i),instance.getZ(i)]:material.emissive.toArray().map(v=>v*material.emissiveIntensity),env=instance?instance.getW(i):material.envMapIntensity;
      panes.push({geometry:mesh.geometry.type,matrix:matrix.toArray(),level,centre,vertices,normal:new THREE.Vector3().fromBufferAttribute(normal,face[0]).applyMatrix3(normalMatrix).normalize().toArray(),uv:face.map(j=>[uv.getX(j),uv.getY(j)]),metres:[metric.getX(i),metric.getY(i)],colour:colour.toArray(),emission,env,roughness:material.roughness,metalness:material.metalness,transparent:material.transparent,side:material.side,material,used:false});
    }
  });return{panes,other,attributesMax};
}
const old=collect(before),now=collect(after);
assert.equal(old.panes.length,now.panes.length);assert.deepEqual(now.other,old.other,'Every non-pane authored shape, material, transform, tint and LOD must remain exact');
checks.push({name:'Every original instance survives; non-pane shapes retain exact geometry, transform, tint, material and detail tier',status:'passed',totalInstances:after.stats.instances,glazingInstances:now.panes.length,otherInstances:[...now.other.values()].reduce((n,v)=>n+v,0),attributeLocationsMaximum:now.attributesMax,attributeLimit:16});
const cells=new Map(),cellKey=c=>c.join(',');for(const pane of now.panes){const key=cellKey(pane.centre.map(Math.floor));if(!cells.has(key))cells.set(key,[]);cells.get(key).push(pane);}
const delta=(a,b)=>Math.max(...a.map((v,k)=>Math.abs(v-b[k]))),errors={vertexM:0,normal:0,uv:0,metreUV:0,colour:0,emissionLinear:0,environmentIntensity:0};
let converted=0,unchangedBoxes=0;
for(const pane of old.panes){
  const c=pane.centre.map(Math.floor),candidates=[];
  for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1])candidates.push(...(cells.get(cellKey([c[0]+x,c[1]+y,c[2]+z]))||[]));
  const match=candidates.find(v=>!v.used&&v.level===pane.level&&delta(v.centre,pane.centre)<.0001&&delta(v.normal,pane.normal)<1e-7&&delta(v.metres,pane.metres)<.00001&&delta(v.colour,pane.colour)<1e-7&&delta(v.emission,pane.emission)<1e-8);
  assert.ok(match,'An original pane has no matching retained outward surface: '+JSON.stringify({centre:pane.centre,level:pane.level,geometry:pane.geometry}));match.used=true;
  for(let j=0;j<4;j++){errors.vertexM=Math.max(errors.vertexM,delta(match.vertices[j],pane.vertices[j]));errors.uv=Math.max(errors.uv,delta(match.uv[j],pane.uv[j]));}
  errors.normal=Math.max(errors.normal,delta(match.normal,pane.normal));errors.metreUV=Math.max(errors.metreUV,delta(match.metres,pane.metres));errors.colour=Math.max(errors.colour,delta(match.colour,pane.colour));errors.emissionLinear=Math.max(errors.emissionLinear,delta(match.emission,pane.emission));errors.environmentIntensity=Math.max(errors.environmentIntensity,Math.abs(match.env-pane.env));
  for(const field of ['roughness','metalness','transparent','side','level'])assert.equal(match[field],pane[field]);
  if(match.geometry==='PlaneGeometry'){assert.equal(pane.geometry,'BoxGeometry');converted++;}else{assert.equal(match.geometry,pane.geometry);assert.deepEqual(match.matrix,pane.matrix);unchangedBoxes++;}
  // Initial, clear-day and night emission preserve the real old materials.
  for(const scale of [1,0,2.1])assert.ok(delta(match.emission.map(v=>v*scale),pane.emission.map(v=>v*scale))<3e-8);
  // Scene environments intentionally ignore authored material intensity in
  // Three. Explicit material maps use the preserved per-instance parameter.
  assert.ok(Math.abs(match.env-pane.env)<6e-8);
}
assert.ok(now.panes.every(p=>p.used));assert.ok(converted>0,'Retained sealed-recess glazing still exercises the hidden-face conversion');assert.ok(unchangedBoxes>0);assert.ok(errors.vertexM<.0001);assert.ok(errors.normal<1e-7);assert.equal(errors.uv,0);
checks.push({name:'Every outward glass vertex, normal, metre UV, tint, emission, reflection parameter and LOD matches the retained generator',status:'passed',comparedPanes:old.panes.length,convertedHiddenFaceBoxes:converted,unchangedFullBoxes:unchangedBoxes,maxErrors:errors,positionToleranceM:.0001,scope:'Comparison uses the actual Float32 instance matrices; front planes differ only by sub-0.1 mm transform rounding. Hidden side/back faces in solid sealed recesses are removed; full freestanding clerestory boxes are retained.'});
const material=now.panes[0].material,shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader,{});
assert.ok(shader.vertexShader.includes('vUrbanGlazing=urbanGlazing;'));assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance*=vUrbanGlazing.rgb;'));
assert.ok(shader.fragmentShader.includes('envMapIntensity*mix(1.,vUrbanGlazing.w,urbanExplicitGlazingEnvironment)'));
assert.ok(shader.fragmentShader.includes('exteriorRoughDelta'));assert.ok(shader.vertexShader.includes('vExteriorUv=uv*exteriorFaceMetres;'));
material.onBeforeRender();assert.equal(shader.uniforms.urbanExplicitGlazingEnvironment.value,0);
const texture=new THREE.Texture();material.envMap=texture;material.onBeforeRender();assert.equal(shader.uniforms.urbanExplicitGlazingEnvironment.value,1);material.envMap=null;material.onBeforeRender();assert.equal(shader.uniforms.urbanExplicitGlazingEnvironment.value,0);texture.dispose();
assert.equal(material.userData.windowBacklight,true);assert.equal(material.emissiveIntensity,1);assert.deepEqual(material.emissive.toArray(),[1,1,1]);
checks.push({name:'The actual glass shader carries instance response through the inherited exterior hooks and preserves scene-versus-explicit environment selection',status:'passed',newSamplerUniforms:0,newAttributeLocations:1,emissionEnvironmentStates:['initial ×1','clear day ×0','wet night ×2.1'],scope:'Source hook and material state checks only; actual GPU link/draw validation is separate.'});
const files=['dist/urban-architecture.js','dist/city-exterior-materials.js','dist/city-render-budget.js','dist/city-frontage-design.js','tests/city-glazing-budget-3.16.test.mjs','tests/fixtures/urban-architecture-before-budget-3.16.mjs','tests/fixtures/urban-architecture-before-budget-3.16.provenance.json'];
const bufferBytes=kit=>kit.group.children.reduce((bytes,mesh)=>bytes+mesh.instanceMatrix.array.byteLength+(mesh.instanceColor?.array.byteLength||0)+Object.values(mesh.geometry.attributes).reduce((n,attribute)=>n+attribute.array.byteLength,0)+(mesh.geometry.index?.array.byteLength||0),0);
const report={schema:'roadster-city-glazing-budget-preservation-3.17',status:'passed',createdAt:new Date().toISOString(),original:provenance,retainedBuildingIDs:retained.map(b=>b.id),intentionallyRemodelledBuildingIDs:redesigned.map(b=>b.id),checks,allocation:{before:{triangles:before.stats.triangles,batches:before.stats.drawBatches,actualBufferBytes:bufferBytes(before)},after:{triangles:after.stats.triangles,batches:after.stats.drawBatches,actualBufferBytes:bufferBytes(after)}},sourceHashes:Object.fromEntries(files.map(file=>[file,sha(readFileSync(new URL('../'+file,import.meta.url)))])),scope:'Every retained building is compared exactly. The 3.17 block/arcology and 3.18 addressed-street redesigns are explicitly excluded from old-art equality and validated separately; their original historical reports remain unchanged. The full 15-view budget still covers all parcels against unchanged 3.5 thresholds. This independent representation-preservation test cannot replace final source-bound GPU frames, validate hidden geometry from an impossible position inside a closed building, or measure hardware performance.'};
writeFileSync(new URL(`../qa/city-glazing-budget-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');before.dispose();after.dispose();console.log(JSON.stringify({status:report.status,checks:checks.length,allocation:report.allocation,maxErrors:errors},null,2));
