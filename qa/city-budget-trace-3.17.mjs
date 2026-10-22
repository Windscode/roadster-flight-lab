// Bounded source-level trace for the historical exterior draw regression.
// Real Three frusta and the exact original visibility/quality history;
// no browser, frame-rate, visibility-distance or budget modifications.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';
import {buildUrbanArchitecture} from '../dist/urban-architecture.js';
import {buildStreetLife} from '../dist/street-life.js';
import {countVisibleGeometry} from '../dist/city-render-budget.js';
const tag=process.argv[2]||'trace';
if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid trace label');
const protocol=JSON.parse(readFileSync(new URL('./render-budget-comparison-3.5.json',import.meta.url)));
const baseline=JSON.parse(readFileSync(new URL('./exterior-baseline-3.5.json',import.meta.url)));
const root=new THREE.Group(),architecture=buildUrbanArchitecture(THREE,root,CITY_BUILDINGS),street=buildStreetLife(THREE,root);
await Promise.all([architecture.ready,street.ready]);
const camera=new THREE.PerspectiveCamera(52,16/9,.1,1800),views={},sphere=new THREE.Sphere();let time=1;
function visibleMeshes(){
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const meshes=[];
  root.traverseVisible(mesh=>{
    if(!mesh.isMesh)return;
    if(mesh.isInstancedMesh){if(!mesh.boundingSphere)mesh.computeBoundingSphere();sphere.copy(mesh.boundingSphere).applyMatrix4(mesh.matrixWorld);}
    else{if(!mesh.geometry.boundingSphere)mesh.geometry.computeBoundingSphere();sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);}
    if(mesh.frustumCulled&&!frustum.intersectsSphere(sphere))return;
    meshes.push({name:mesh.name,count:mesh.isInstancedMesh?mesh.count:1,triangles:(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1),material:mesh.material.name,level:mesh.userData.renderDetail,shadow:mesh.castShadow});
  });return meshes;
}
for(const quality of ['balanced','high','ultra','balanced']){
  architecture.setQuality(quality);street.setQuality(quality);const rows=[];
  for(const view of protocol.views){camera.position.set(...view.position);camera.lookAt(...view.lookAt);camera.updateMatrixWorld(true);time+=1;architecture.update(time,camera.position);street.update(time,camera.position);const result=countVisibleGeometry(THREE,root,camera),budget=baseline.views[quality].find(v=>v.view===view.id);rows.push({view:view.id,...result,budget:{drawCalls:budget.drawCalls,triangles:budget.triangles*1.1},drawDelta:result.drawCalls-budget.drawCalls,meshes:view.id==='botanical'?visibleMeshes():undefined});}
  views[quality]=rows;
}
const report={schema:'roadster-city-exterior-budget-trace-3.17',tag,createdAt:new Date().toISOString(),sourceHash:createHash('sha256').update(readFileSync(new URL('../dist/urban-architecture.js',import.meta.url))).digest('hex'),allocation:architecture.stats,views,scope:'Actual Three instance allocations and frustum submissions; excludes environment extras and vehicle, no GPU or frame-time assertion.'};
writeFileSync(new URL('./city-dev-attempts-3.17/exterior-budget-'+tag+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({tag,allocation:{triangles:architecture.stats.triangles,batches:architecture.stats.drawBatches},views:Object.fromEntries(Object.entries(views).map(([quality,rows])=>[quality,rows.map(({view,drawCalls,triangles,budget,drawDelta})=>({view,drawCalls,triangles,budget,drawDelta}))]))},null,2));
architecture.dispose();street.dispose();
