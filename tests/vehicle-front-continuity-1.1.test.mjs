import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,VEHICLE_GEOMETRY,VEHICLE_DRIVER_VIEW,sampleVehicleFrontCorner as cheek,sampleVehicleFrontLowerCorner as lower,sampleVehicleFrontCrown as crown,sampleVehicleNoseLeading as nose,sampleVehicleSurface as body,sampleVehicleSide as sideSkin} from '../dist/vehicle.js';
import {readGitObject} from './git-object-read.mjs';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const baselineCommit='88ddb11799403b5fffa78a86e7cece72085d207e';
const bytes=readGitObject(baselineCommit+':dist/vehicle.js');
const baseline=await import('data:text/javascript;base64,'+Buffer.from(bytes.toString().replaceAll("from './","from '"+pathToFileURL(resolve('dist')+'/').href)).toString('base64'));
const before=baseline.createRoadster({inspection:true}),after=createRoadster({inspection:true});
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
const normal=(f,u,v)=>{
  const h=1e-6,ua=Math.max(0,u-h),ub=Math.min(1,u+h),va=Math.max(0,v-h),vb=Math.min(1,v+h),a=f(ua,v),b=f(ub,v),c=f(u,va),d=f(u,vb);
  return new THREE.Vector3(...b.map((n,i)=>n-a[i])).cross(new THREE.Vector3(...d.map((n,i)=>n-c[i]))).normalize();
};
const angle=(a,b)=>Math.acos(Math.min(1,Math.abs(a.dot(b))))*180/Math.PI;
const numeric=o=>Object.fromEntries(Object.entries(o).filter(([,n])=>typeof n==='number'));
assert.deepEqual(numeric(VEHICLE_GEOMETRY),numeric(baseline.VEHICLE_GEOMETRY));
assert.deepEqual(VEHICLE_DRIVER_VIEW,baseline.VEHICLE_DRIVER_VIEW);
for(let i=0;i<4;i++)assert.deepEqual(after.wheels[i].tyreProfile,before.wheels[i].tyreProfile);
const counterexample=baseline.sampleVehicleFrontCorner(1,0,0),closed=nose(1,1);
assert.ok(Math.abs(counterexample[1]-closed[1])>.01,'Retain the original visibly stepped leading-edge counterexample');
const continuity=[];
for(const side of [-1,1]){
  let maxGap=0,maxNoseGap=0,maxNormalAngle=0,maxSideAngle=0;
  for(let i=0;i<=40;i++){
    const u=i/40;
    maxGap=Math.max(maxGap,distance(crown(side,u,1),cheek(side,u,0)),distance(cheek(side,u,1),lower(side,u,0)));
    maxNoseGap=Math.max(maxNoseGap,distance(crown(side,0,u),nose(side>0?1:0,u)));
    const start=crown(side,u,0);assert.ok(Math.abs(start[1]-body(start[0],2.30).bodyY)<1e-12);
    if(i>0&&i<40)maxNormalAngle=Math.max(maxNormalAngle,angle(normal((a,b)=>crown(side,a,b),u,1),normal((a,b)=>cheek(side,a,b),u,0)));
    if(i>0&&i<40){
      const p=cheek(side,1,u),dy=(sideSkin(2.30,p[1]+1e-5).x-sideSkin(2.30,p[1]-1e-5).x)/2e-5,dz=(sideSkin(2.30,p[1]).x-sideSkin(2.2999,p[1]).x)/.0001;
      maxSideAngle=Math.max(maxSideAngle,angle(normal((a,b)=>cheek(side,a,b),1,u),new THREE.Vector3(side,-dy,-dz).normalize()));
    }
  }
  assert.ok(maxGap<1e-12);assert.ok(maxNoseGap<1e-8);assert.ok(maxNormalAngle<.02);assert.ok(maxSideAngle<.02);
  continuity.push({side,maxGapM:maxGap,maxNoseGapM:maxNoseGap,maxNormalAngleDeg:maxNormalAngle,maxSideAngleDeg:maxSideAngle});
}
const panelMeshes=car=>{const list=[];car.group.traverseVisible(o=>{if(o.isMesh&&[car.materials.paint,car.materials.balancedPaint,car.materials.black].includes(o.material))list.push(o);});return list;};
const coverage=[],cost=[];
for(const quality of ['balanced','high','ultra']){
  for(const car of [before,after]){car.setQuality(quality);car.group.updateMatrixWorld(true);}
  for(const side of [-1,1]){
    const ray=new THREE.Raycaster(new THREE.Vector3(side*.635,-.140,2.60),new THREE.Vector3(0,0,-1),0,.30);
    assert.equal(ray.intersectObjects(panelMeshes(before),false).length,0,'The 1.0 mouth-to-cheek opening must remain reproducible');
    const hits=ray.intersectObjects(panelMeshes(after),false);assert.ok(hits.length>0,'The actual return must close the mouth-to-cheek gap in every LOD');
    coverage.push({quality,side,oldHit:false,newHitZ:hits[0].point.z});
  }
  after.group.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;assert.ok(p.array.every(Number.isFinite));if(n)for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.0005);});
  const a=before.getRenderCost(),b=after.getRenderCost();assert.equal(b.drawables,a.drawables);assert.equal(b.triangles,a.triangles);cost.push({quality,before:a,after:b});
}
for(const name of ['paint','glass','carbon','frontPanel','rubber','wheelDark','wheelSilver']){
  for(const property of ['roughness','metalness','opacity'])assert.equal(after.materials[name][property],before.materials[name][property]);
  assert.equal(after.materials[name].color.getHex(),before.materials[name].color.getHex());
}
const report={schema:'roadster-front-continuity-1.1',status:'passed',baselineCommit,vehicleSHA256:createHash('sha256').update(readFileSync('dist/vehicle.js')).digest('hex'),counterexample:{baselineCheekTop:counterexample,currentJoinedTop:closed,oldStepM:Math.abs(counterexample[1]-closed[1])},continuity,coverage,cost,limits:['Authored surface continuity and gap repair, not newly measured Tesla dimensions.','Material response, wheel/suspension envelope, eye point and force geometry are unchanged.','Numerical geometry and draw-count checks do not certify rendered pixels or real GPU timing. Matched browser inspection is separate.']};
mkdirSync(`qa/vehicle-${REPORT_VERSION}`,{recursive:true});writeFileSync(`qa/vehicle-${REPORT_VERSION}/front-continuity.json`,JSON.stringify(report,null,2)+'\n');
before.dispose();after.dispose();console.log(JSON.stringify({status:'passed',oldStepM:report.counterexample.oldStepM,continuity,coverage,cost:cost.map(r=>({quality:r.quality,addedTriangles:r.after.triangles-r.before.triangles,addedDrawables:r.after.drawables-r.before.drawables}))}));
