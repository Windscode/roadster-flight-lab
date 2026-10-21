// One-time 3.18 reference maintenance, preserving every camera/photograph UV.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {sampleVehicleSurface,sampleVehicleCanopy} from '../dist/vehicle.js';
import {VEHICLE_PHOTO_MATCHES,normalizedLandmarkReport} from '../dist/vehicle-display-study.js';
const refs=structuredClone(VEHICLE_PHOTO_MATCHES),observations=[];
for(const ref of refs){
 const old=structuredClone(ref),camera=new THREE.PerspectiveCamera(),[w,h]=ref.sourceResolution;
 camera.filmGauge=36;camera.aspect=w/h;camera.setFocalLength(ref.focalLengthMm);camera.position.set(...ref.position);camera.lookAt(...ref.target);camera.setViewOffset(w,h,-ref.frameShiftUV[0]*w,-ref.frameShiftUV[1]*h,w,h);
 for(const point of ref.landmarks){
  const [x,y,z]=point.pointM,side=Math.sign(x)||1;
  if(point.id.startsWith('windshield'))point.pointM=sampleVehicleCanopy(side,.80);
  else if(point.id.startsWith('roof'))point.pointM=sampleVehicleCanopy(side,z);
  else if(point.id==='rear-window-corner')point.pointM=sampleVehicleCanopy(side,-1.48);
  else if(point.id==='nose'||point.id==='rear-shoulder'||point.id==='tail'){
   const s=sampleVehicleSurface(0,z);point.pointM=[side*s.topSkinEdgeX,s.topSkinEdgeY,z];
  }else if(point.id.startsWith('nose-')){const s=sampleVehicleSurface(0,2.3),xx=side*s.bonnetHalfWidth;point.pointM=[xx,sampleVehicleSurface(xx,2.3).bodyY,2.3];}
  else if(point.id.startsWith('shoulder-')){const s=sampleVehicleSurface(0,1.42);point.pointM=[side*s.topSkinEdgeX,s.topSkinEdgeY,1.42];}
 }
 const measured=normalizedLandmarkReport(THREE,camera,new THREE.Matrix4(),ref);
 for(let i=0;i<ref.landmarks.length;i++){ref.landmarks[i].projectedUV=measured.points[i].projectedUV;ref.landmarks[i].errorImageDiagonalFraction=measured.points[i].errorImageDiagonalFraction;}
 ref.rmsImageDiagonalFraction=measured.rmsImageDiagonalFraction;
 ref.geometryLandmarksRevision='3.18 actual loft and top-skin samples; photo point associations remain authored hypotheses';
 ref.cameraFit='Original assumed 50 mm camera, pose and framing retained unchanged from 3.14. 3.18 updates the model points from the actual loft and top skin without refitting the camera. Residuals combine annotation, view fit and geometry; they do not isolate CAD accuracy or form improvement.';
 assert.deepEqual(ref.position,old.position);assert.deepEqual(ref.target,old.target);assert.deepEqual(ref.frameShiftUV,old.frameShiftUV);assert.equal(ref.focalLengthMm,old.focalLengthMm);
 observations.push({id:ref.id,previousAuthoredPoints:old.landmarks,currentActualSurfacePoints:ref.landmarks,cameraUnchanged:true,previousCombinedResidual:old.rmsImageDiagonalFraction,currentCombinedResidual:ref.rmsImageDiagonalFraction,meaning:'Point definitions were corrected alongside intentional shape changes; do not interpret residual differences alone as a visual improvement score.'});
}
const path='dist/vehicle-display-study.js',s=readFileSync(path,'utf8'),start=s.indexOf('export const VEHICLE_PHOTO_MATCHES=Object.freeze('),end=s.indexOf('\nexport const VEHICLE_CABIN_REFERENCE=',start);
assert.ok(start>=0&&end>start);
writeFileSync(path,s.slice(0,start)+'export const VEHICLE_PHOTO_MATCHES=Object.freeze('+JSON.stringify(refs,null,2)+');'+s.slice(end));
writeFileSync('qa/vehicle-form-3.18/reference-landmarks.json',JSON.stringify({schema:'roadster-current-surface-reference-3.18',createdAt:new Date().toISOString(),observations},null,2)+'\n');
console.log(JSON.stringify(observations.map(x=>({id:x.id,cameraUnchanged:x.cameraUnchanged,currentCombinedResidual:x.currentCombinedResidual}))));
