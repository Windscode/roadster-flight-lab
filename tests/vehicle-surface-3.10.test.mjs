import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,sampleVehicleSurface,VEHICLE_GEOMETRY} from '../dist/vehicle.js';
import {createRoadster as createBaseline,sampleVehicleSurface as baselineSurface} from '../dist/vehicle-reference-3.9.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const checks=[],sha=data=>createHash('sha256').update(data).digest('hex');
const check=(name,fn)=>{const detail=fn();checks.push({name,status:'passed',detail});};
const car=createRoadster({quality:'high'}),baseline=createBaseline({quality:'high'});
check('Frozen 3.9 geometry and layout retain the exact published source except the isolated layout import',()=>{
  const source=readFileSync(new URL('../dist/vehicle-reference-3.9.js',import.meta.url));
  const restored=Buffer.from(source.toString().replace("from './vehicle-reference-layout-3.9.js'","from './vehicle-layout.js'"));
  const layout=readFileSync(new URL('../dist/vehicle-reference-layout-3.9.js',import.meta.url));
  assert.equal(sha(restored),'cb37f8d9ca5b502831f1ea0f4a3642c3c3a4436976a75e489d65a412a6f1d05a');
  assert.equal(sha(layout),'d2918ca2d9c3a7ff14a5b6647665ffd19f933bea9d1047ae6410b6f43d6414ec');
  return{baselineCommit:'6083bbf0e01f4eef5447f2c1b951d8b41e691f46',restoredSourceSHA256:sha(restored),layoutSHA256:sha(layout)};
});
function sectionScan(sample,x){
  let minimum=Infinity,maximum=-Infinity,previous=null,totalNormalTurningDeg=0;
  for(let j=0;j<=800;j++){
    const z=1.02+j/800*.91,d=.0001,slope=(sample(x,z+d).bodyY-sample(x,z-d).bodyY)/(2*d),angle=Math.atan(slope)*180/Math.PI;
    assert.ok(Number.isFinite(angle));minimum=Math.min(minimum,angle);maximum=Math.max(maximum,angle);
    if(previous!==null)totalNormalTurningDeg+=Math.abs(angle-previous);previous=angle;
  }
  return{minimumLongitudinalNormalAngleDeg:minimum,maximumLongitudinalNormalAngleDeg:maximum,totalNormalTurningDeg};
}
check('Front-fender diagnostic sections remove the local reverse-slope blister while preserving the wedge',()=>{
  // Coordinates cover the small hood/fender region visible in the supplied
  // front-light close-ups. This is a geometric diagnostic, not a pixel score.
  const sections=[.70,.72,.78].map(x=>({xM:x,zRangeM:[1.02,1.93],baseline:sectionScan(baselineSurface,x),current:sectionScan(sampleVehicleSurface,x)}));
  for(const section of sections){assert.ok(section.current.maximumLongitudinalNormalAngleDeg<0,'unintended uphill blister remains');assert.ok(section.current.totalNormalTurningDeg<section.baseline.totalNormalTurningDeg,'local normal oscillation has not decreased');}
  return{sections,scope:'Longitudinal geometric cross-sections only. Real specular reflections under strip lights and natural light still require new rendered frames.'};
});
check('Feature-aligned hood strips meet with coincident positions and derivative normals at each LOD',()=>{
  const result={};
  for(const quality of ['balanced','high','ultra']){
    car.setQuality(quality);let pairs=0,maxAngle=0;const seen=new Map();
    car.group.traverse(o=>{
      if(!o.isMesh||![car.materials.paint,car.materials.balancedPaint].includes(o.material))return;
      const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;
      for(let i=0;i<p.count;i++){
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i),surface=sampleVehicleSurface(x,z);
        if(z<.82||z>2.28||Math.abs(x)<.04||Math.abs(x)>surface.outerX*.985||Math.abs(y-surface.bodyY)>2e-6)continue;
        const key=[x,y,z].map(v=>v.toFixed(6)).join(':');
        const normal=new THREE.Vector3(n.getX(i),n.getY(i),n.getZ(i)).normalize();
        if(seen.has(key)){pairs++;const dot=normal.dot(seen.get(key));maxAngle=Math.max(maxAngle,Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI);}
        else seen.set(key,normal);
      }
    });
    assert.ok(pairs>100,quality+' has no adjoining feature samples');assert.ok(maxAngle<.06,quality+' has a smooth-strip normal seam');
    result[quality]={coincidentPairs:pairs,maximumNormalAngleDeg:maxAngle};
  }
  return result;
});
check('Cutaway and capture preparation restore authored glass opacity without drift or a wheel/wing pose change',()=>{
  car.setQuality('high');const initial=Object.fromEntries(['paint','glass','balancedPaint','balancedGlass'].map(k=>[k,car.materials[k].opacity]));
  const t={wheelStates:car.wheels.map(w=>({suspensionLength:.265,steer:w.z>0?.37:0,rotation:1.17})),wing:{deployment:.57,position:{x:0,y:.496,z:-2.065},incidenceRad:-.1425}};
  car.update(t,0);const wheelPose=car.wheels.map(w=>({p:w.assembly.position.toArray(),q:w.assembly.quaternion.toArray(),spin:w.spin.rotation.toArray()}));
  const wingPose={p:car.wing.position.toArray(),q:car.wing.quaternion.toArray()};
  for(let i=0;i<5;i++)for(const quality of ['balanced','high','ultra']){
    car.setQuality(quality);car.setCutaway(false);
    for(const key of Object.keys(initial))assert.equal(car.materials[key].opacity,initial[key]);
    car.setCutaway(true);car.setCutaway(false);
    for(const key of Object.keys(initial))assert.equal(car.materials[key].opacity,initial[key]);
    assert.equal(car.materials.glass.transparent,true);assert.equal(car.materials.glass.depthWrite,false);
  }
  assert.deepEqual(car.wheels.map(w=>({p:w.assembly.position.toArray(),q:w.assembly.quaternion.toArray(),spin:w.spin.rotation.toArray()})),wheelPose);
  assert.deepEqual({p:car.wing.position.toArray(),q:car.wing.quaternion.toArray()},wingPose);
  const legacyInitial=baseline.materials.glass.opacity;baseline.setCutaway(false);
  return{currentExteriorOpacity:initial,legacyGlassBeforeCapturePreparation:legacyInitial,legacyGlassAfterCapturePreparation:baseline.materials.glass.opacity,cycles:15,wingSource:car.wing.userData.source};
});
function mirrorClearance(model){
  model.setQuality('high');model.group.updateMatrixWorld(true);
  const glass=[];model.group.traverse(o=>{if(o.isMesh&&o.material===model.materials.glass)glass.push(o);});
  const cabin=model.group.getObjectByName('single-seat cockpit'),ray=new THREE.Raycaster(),point=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0),seen=new Set();let maximumProtrusion=-Infinity,samples=0;
  cabin.traverse(o=>{const p=o.geometry?.attributes.position;if(!p)return;for(let i=0;i<p.count;i++){
    point.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
    if(point.y<.48||point.z<.10||point.z>.30)continue;
    const key=point.toArray().map(x=>x.toFixed(5)).join(':');if(seen.has(key))continue;seen.add(key);
    ray.set(new THREE.Vector3(point.x,2,point.z),down);const roof=ray.intersectObjects(glass,false)[0];assert.ok(roof,'mirror has no windscreen above its XZ point');
    maximumProtrusion=Math.max(maximumProtrusion,point.y-roof.point.y);samples++;
  }});
  assert.ok(samples>20);return{samples,maximumProtrusionAboveGlassM:maximumProtrusion};
}
check('The interior mirror remains below the actual glazing mesh instead of breaking the windscreen silhouette',()=>{
  const before=mirrorClearance(baseline),after=mirrorClearance(car);assert.ok(before.maximumProtrusionAboveGlassM>.01,'fixture no longer identifies the original mirror penetration');assert.ok(after.maximumProtrusionAboveGlassM<-.001,'mirror pierces the current windscreen');return{baseline:before,current:after};
});
const files=['dist/vehicle.js','dist/vehicle-inspection.js','dist/vehicle-inspection.html','dist/i18n-vehicle-310-en.js','dist/vehicle-reference-3.9.js','dist/vehicle-reference-layout-3.9.js','tests/vehicle-surface-3.10.test.mjs'];
const report={status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,asOf:new Date().toISOString(),geometry:VEHICLE_GEOMETRY,checks,sourceHashes:Object.fromEntries(files.map(path=>[path,sha(readFileSync(new URL('../'+path,import.meta.url)))])),limitations:['No GPU was used in these tests. Original WebGL images supplied by the user established the visible defects; this report verifies source, surface continuity and state handling only.','Rendered after-images under the unchanged studio and broad daylight rigs remain necessary for visual acceptance.','Official camera focal length, CAD surfaces and optical properties are not available; the source image is a proportion/landmark reference, not a metric calibration.']};
writeFileSync(new URL(`../qa/vehicle-surface-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
car.dispose();baseline.dispose();console.log(JSON.stringify(report,null,2));
