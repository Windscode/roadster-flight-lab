// Read-only scene analysis against the unchanged 3.5 exterior budget. This is
// not a substitute for actual GPU draws, source-bound images or native driving.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {buildUrbanArchitecture} from '../dist/urban-architecture.js';
import {CITY_BUILDINGS} from '../dist/city-data.js';
import {buildStreetLife} from '../dist/street-life.js';
import {countVisibleGeometry} from '../dist/city-render-budget.js';
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)||'final';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Use an explicit safe observation label');
const base=JSON.parse(readFileSync(new URL('./exterior-baseline-3.5.json',import.meta.url))),protocol=JSON.parse(readFileSync(new URL('./render-budget-comparison-3.5.json',import.meta.url)));
const root=new THREE.Group(),architecture=buildUrbanArchitecture(THREE,root,CITY_BUILDINGS),street=buildStreetLife(THREE,root);await Promise.all([architecture.ready,street.ready]);
let time=1;const camera=new THREE.PerspectiveCamera(52,16/9,.1,1800),views={};
for(const quality of ['balanced','high','ultra','balanced']){
  architecture.setQuality(quality);street.setQuality(quality);
  views[quality]=protocol.views.map(view=>{
    camera.position.set(...view.position);camera.lookAt(...view.lookAt);camera.updateMatrixWorld(true);architecture.update(++time,camera.position);street.update(time,camera.position);
    const actual=countVisibleGeometry(THREE,root,camera),before=base.views[quality].find(v=>v.view===view.id);
    return{quality,view:view.id,actual,before,drawGatePassed:actual.drawCalls<=before.drawCalls,triangleGatePassed:actual.triangles<=before.triangles*1.10,balancedAbsoluteGatePassed:quality!=='balanced'||actual.drawCalls<300&&actual.triangles<650000};
  });
}
const allocation={triangles:{before:base.architecture.triangles+base.street.triangles,actual:architecture.stats.triangles+street.stats.triangles},batches:{before:base.architecture.drawBatches+base.street.drawBatches,actual:architecture.stats.drawBatches+street.stats.drawBatches}};
const failedViews=Object.values(views).flat().filter(v=>!v.drawGatePassed||!v.triangleGatePassed||!v.balancedAbsoluteGatePassed);
const status=allocation.triangles.actual<allocation.triangles.before&&allocation.batches.actual<allocation.batches.before&&!failedViews.length?'passed':'failed';
const files=['dist/urban-architecture.js','dist/city-frontage-design.js','dist/street-life.js','dist/city-render-budget.js','qa/exterior-baseline-3.5.json','qa/render-budget-comparison-3.5.json'];
const report={schema:'roadster-city-budget-observation-3.16',label,status,createdAt:new Date().toISOString(),allocation,views,failedViews,sourceHashes:Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')])),scope:'Original allocation reduction, per-view draw upper bound, 10% triangle ceiling and balanced absolute gates are unchanged. These are Three geometry/frustum estimates, not GPU timings or image completeness.'};
writeFileSync(new URL('./city-budget-'+label+'-3.16.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
architecture.dispose();street.dispose();console.log(JSON.stringify({status,allocation,failedViews},null,2));if(status!=='passed')process.exitCode=1;
