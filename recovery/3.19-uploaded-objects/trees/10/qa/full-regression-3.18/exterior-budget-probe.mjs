import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../../dist/vendor/three.module.js';
import {countVisibleGeometry} from '../../dist/city-render-budget.js';
const rootURL=new URL('../../',import.meta.url);
const baselineURL=new URL('../../../baseline-317/',import.meta.url);
const protocol=JSON.parse(readFileSync(new URL('../render-budget-comparison-3.5.json',import.meta.url)));
const budget=JSON.parse(readFileSync(new URL('../exterior-baseline-3.5.json',import.meta.url)));
const sha=x=>createHash('sha256').update(x).digest('hex');
async function capture(baseURL){
  const {CITY_BUILDINGS}=await import(new URL('dist/city-data.js',baseURL));
  const {buildUrbanArchitecture}=await import(new URL('dist/urban-architecture.js',baseURL));
  const {buildStreetLife}=await import(new URL('dist/street-life.js',baseURL));
  const root=new THREE.Group(),architecture=buildUrbanArchitecture(THREE,root,CITY_BUILDINGS),street=buildStreetLife(THREE,root);
  await Promise.all([architecture.ready,street.ready]);
  const camera=new THREE.PerspectiveCamera(52,16/9,.1,1800),views={};let time=1,coldStart;
  for(const quality of ['balanced','high','ultra','balanced']){
    architecture.setQuality(quality);street.setQuality(quality);const rows=[];
    for(const view of protocol.views){
      camera.position.set(...view.position);camera.lookAt(...view.lookAt);camera.updateMatrixWorld(true);time+=1;
      architecture.update(time,camera.position);street.update(time,camera.position);
      const row={view:view.id,...countVisibleGeometry(THREE,root,camera),meshes:[]};
      root.traverseVisible(mesh=>{if(!mesh.isMesh)return;const c=countVisibleGeometry(THREE,mesh,camera);if(c.drawCalls)row.meshes.push({name:mesh.name,level:mesh.userData.renderDetail,material:mesh.material.name,surface:mesh.material.userData.exteriorSurface,count:mesh.count,...c});});
      rows.push(row);
    }
    if(quality==='balanced'&&!coldStart)coldStart=rows;views[quality]=rows;
  }
  const result={architecture:architecture.stats,street:street.stats,views,coldStart,sourceSHA256:Object.fromEntries(['dist/urban-architecture.js','dist/street-life.js','dist/city-render-budget.js','dist/street-display.js'].flatMap(f=>{try{return [[f,sha(readFileSync(new URL(f,baseURL)))]];}catch{return [];}}))};
  architecture.dispose();street.dispose();return result;
}
const current=await capture(rootURL),baseline317=await capture(baselineURL);
const comparison=Object.keys(current.views).flatMap(quality=>current.views[quality].map(row=>{
  const ceiling=budget.views[quality].find(x=>x.view===row.view),before=baseline317.views[quality].find(x=>x.view===row.view);
  return {quality,view:row.view,budgetDraw:ceiling.drawCalls,baseline317Draw:before.drawCalls,currentDraw:row.drawCalls,budgetTriangles:ceiling.triangles*1.1,baseline317Triangles:before.triangles,currentTriangles:row.triangles,passes:row.drawCalls<=ceiling.drawCalls&&row.triangles<=ceiling.triangles*1.10};
}));
const result={status:comparison.every(x=>x.passes)?'within-original-budgets':'budget-exceeded',createdAt:new Date().toISOString(),scope:'Exact original view order and balanced/high/ultra/balanced visibility history; no DOM or GPU.',comparison,current,baseline317};
const output=process.argv[2]||'exterior-budget-probe-before.json';
writeFileSync(new URL(output,import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,comparison},null,2));
