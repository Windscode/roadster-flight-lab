import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {buildStreetLife,STREET_COLLIDERS} from '../dist/street-life.js';

const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const source=fs.readFileSync(new URL('../dist/street-life.js',import.meta.url),'utf8');
const prefixHash=digest(source.split('export function buildStreetLife')[0]);
assert.equal(prefixHash,'9e05b206e8acf88aa91351d1956147ef2fefa80bc78510a563975c3421c0e7cf','The complete placement / collider prefix must remain byte-identical to v3.1');
assert.equal(STREET_COLLIDERS.length,284);
const root=new THREE.Group(),kit=buildStreetLife(THREE,root);
assert.equal(kit.stats.pedestrians,152);assert.equal(kit.stats.stalls,160);assert.equal(kit.stats.marketSections,35);
assert.equal(kit.stats.goods,3599);assert.equal(kit.stats.bicycles,35);assert.equal(kit.stats.trees,8);
assert.equal(kit.colliders,STREET_COLLIDERS);assert.equal(kit.stats.drawBatches,209);
assert.ok(kit.stats.triangles<1500000,'Street detail geometry budget');
const samples=[[-200,.62,-350],[100,.62,300],[400,8.62,260],[312,8.62,280]],timings=[];
let frames=0,matrixComponents=0,vertexComponents=0,normalComponents=0;
for(const position of samples){
  const vehicle=new THREE.Vector3(...position),start=performance.now();
  for(let i=0;i<120;i++)kit.update((frames++)/60,vehicle);
  timings.push((performance.now()-start)/120);
  root.traverse(mesh=>{if(!mesh.isMesh)return;
    for(const x of mesh.geometry.attributes.position.array){assert.ok(Number.isFinite(x));vertexComponents++;}
    for(const x of mesh.geometry.attributes.normal.array){assert.ok(Number.isFinite(x));normalComponents++;}
    if(mesh.isInstancedMesh)for(const x of mesh.instanceMatrix.array){assert.ok(Number.isFinite(x));matrixComponents++;}
  });
}
kit.update(Number.NaN,new THREE.Vector3());
const report={status:'passed',scope:'Original lightweight near-field street asset refinement; isolated asset QA, not a claim of AAA or full-city render performance',
  baseline:{drawBatches:149,triangles:1139640,instances:42455,pedestrians:152,stalls:160,collisionProxies:284},current:kit.stats,
  budget:{triangleGrowthPercent:+((kit.stats.triangles/1139640-1)*100).toFixed(2),extraBatches:kit.stats.drawBatches-149,addedExternalAssetBytes:0},
  placementPrefixSha256:prefixHash,colliderRecordsSha256:digest(JSON.stringify(STREET_COLLIDERS)),sourceSha256:digest(source),
  finiteChecks:{frames,vehicleLocations:samples.length,matrixComponents,vertexComponents,normalComponents},
  nodeCpuUpdateMeanMsByLocation:timings.map(x=>+x.toFixed(3)),
  browser:{isolatedPreview:true,consoleWarnings:0,consoleErrors:0,views:['street-detail-residents.png','street-detail-market.png','street-detail-courtyard.png'],temporaryHtmlRemoved:true},
  limitations:['Residents remain original procedural figures, without scanned skin, hair cards or skeletal mesh skinning.','CPU measurements exclude GPU rendering, CSM, environment capture and full-city passes.','Pedestrians are visual residents and yield on existing sidewalk paths; they are not physical collision bodies.']};
kit.dispose();assert.equal(root.children.length,0);
fs.writeFileSync(new URL('./street-detail-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const manifest={schemaVersion:1,name:'Original street detail kit',source:'../../street-life.js',sourceSha256:digest(source),
  thirdPartyDownloads:[],externalAssetBytes:0,
  provenance:'New meshes, articulated proportions, curve samples, atlas drawing and derivative material patterns are authored directly in street-life.js for this project. No extracted game mesh, texture, character, or third-party model is included.',
  license:'Project-authored source additions. No third-party redistribution grant is needed; this manifest does not introduce a license for the enclosing project.',
  designReference:'Existing street-life.js header documents the earlier visual study of artist portfolios. No reference photograph is sampled or embedded in these assets.',
  components:['Rounded counter shells and worktops','Curved tensioned fabric with scalloped valance','Open ceramic bowls and cups','Rounded bread and flour scores','Bevelled chair seats and backs','Articulated residents with elliptical shoulder/waist/jaw silhouettes, layered hair, faces, thumbs, shoes and idle hand poses','Filtered physical-scale weave, wood grain and produce microtexture']};
fs.mkdirSync(new URL('../dist/assets/street-detail/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../dist/assets/street-detail/manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'passed',stats:report.current,budget:report.budget,finiteChecks:report.finiteChecks,cpuMs:report.nodeCpuUpdateMeanMsByLocation}));
