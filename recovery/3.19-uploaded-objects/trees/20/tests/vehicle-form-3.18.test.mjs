import assert from 'node:assert/strict';
import {readGitObject} from './git-object-read.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,sampleVehicleSurface,sampleVehicleSide,VEHICLE_GEOMETRY,VEHICLE_DRIVER_VIEW} from '../dist/vehicle.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

// The complete fixed-view PNGs are the shape evidence. These few geometric
// observations verify that the visible changes are real surfaces, not lighting
// substitutions, while protecting the existing wheel/force hard points.
const baselineCommit='d9a4fbfd434fe49cdbeae18c32f624360e9dc4e9';
const frozen=readGitObject(baselineCommit+':dist/vehicle.js');
const src=frozen.toString().replaceAll("from './","from '"+pathToFileURL(resolve('dist')+'/').href);
const baseline=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const before=baseline.createRoadster({inspection:true}),after=createRoadster({inspection:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const findings=[];const record=(name,detail)=>findings.push({name,status:'passed',detail});
for(const [key,value] of Object.entries(baseline.VEHICLE_GEOMETRY))if(typeof value==='number')assert.equal(VEHICLE_GEOMETRY[key],value,key);
assert.deepEqual(VEHICLE_DRIVER_VIEW,baseline.VEHICLE_DRIVER_VIEW);
for(let i=0;i<4;i++)assert.deepEqual(after.wheels[i].tyreProfile,before.wheels[i].tyreProfile);
for(const model of [before,after])model.group.updateMatrixWorld(true);
for(let i=1;i<=4;i++){
 const a=before.group.getObjectByName('rear propulsion nozzle '+i),b=after.group.getObjectByName('rear propulsion nozzle '+i);
 assert.deepEqual(a.position.toArray(),b.position.toArray());assert.deepEqual(a.quaternion.toArray(),b.quaternion.toArray());
}
record('Wheel and tyre envelope, left eye, rear nozzle centres, and fixed wing pose are retained',{physicalDimensions:Object.fromEntries(Object.entries(VEHICLE_GEOMETRY).filter(([,v])=>typeof v==='number')),driverEye:VEHICLE_DRIVER_VIEW,wingBefore:before.wing.position.toArray(),wingAfter:after.wing.position.toArray(),scope:'No metric dimension or physical property is inferred from the photographs.'});
assert.deepEqual(before.wing.position.toArray(),after.wing.position.toArray());

const stations=[-2.3,-1.86,-1.42,-.76,0,.73,1.42,1.95,2.3].map(z=>({z,before:baseline.sampleVehicleSurface(0,z),after:sampleVehicleSurface(0,z)}));
const shoulderDelta=model=>model(0,-.76).section.shoulder-model(0,.73).section.shoulder;
assert.ok(shoulderDelta(sampleVehicleSurface)-shoulderDelta(baseline.sampleVehicleSurface)>.04);
assert.ok(sampleVehicleSurface(0,2.3).outerX-baseline.sampleVehicleSurface(0,2.3).outerX>.04);
record('The waist rises more strongly toward the rear and the white nose corner occupies a broader real volume',{stations,waistRiseBeforeM:shoulderDelta(baseline.sampleVehicleSurface),waistRiseAfterM:shoulderDelta(sampleVehicleSurface),scope:'Authored geometry delta, not an OEM measurement or an image-quality score.'});

const meshes=(car,materials)=>{const out=[];car.group.traverseVisible(o=>{if(o.isMesh&&materials.includes(o.material))out.push(o);});return out;};
const sillRays=[];
for(const side of [-1,1]){
 const ray=new THREE.Raycaster(new THREE.Vector3(side*2,-.274,-.75),new THREE.Vector3(-side,0,0),0,2);
 const a=ray.intersectObjects(meshes(before,[before.materials.paint,before.materials.carbon]),false)[0];
 const b=ray.intersectObjects(meshes(after,[after.materials.paint,after.materials.carbon]),false)[0];
 assert.ok(a&&b);assert.equal(a.object.material,before.materials.paint);assert.equal(b.object.material,after.materials.carbon);
 sillRays.push({side,before:{point:a.point.toArray(),material:'paint'},after:{point:b.point.toArray(),material:'carbon'}});
}
record('The rising dark sill replaces the lower painted volume and is not an overlay strip',{sillRays,surfaceSideAtRear:sampleVehicleSide(-.75,-.274)});

const paneBounds=(car,name)=>{const p=car.group.getObjectByName(name);assert.ok(p);const box=new THREE.Box3().setFromObject(p);return{min:box.min.toArray(),max:box.max.toArray()};};
const windscreen={before:paneBounds(before,'compound curved windscreen'),after:paneBounds(after,'compound curved windscreen')};
const roof={before:paneBounds(before,'panoramic roof glazing'),after:paneBounds(after,'panoramic roof glazing')};
const rearWindow={before:paneBounds(before,'curved rear backlight'),after:paneBounds(after,'curved rear backlight')};
assert.ok(windscreen.after.max[0]-windscreen.before.max[0]>.10);
assert.ok(Math.abs(roof.after.max[1]-roof.before.max[1])<.002);
assert.ok(Math.abs(roof.after.max[0]-roof.before.max[0])<1e-6);
assert.ok(rearWindow.after.min[2]<rearWindow.before.min[2]-.20);
record('Same fitted-front review leads to a wider windscreen landing, retained roof crest, and a longer rear transition',{windscreen,roof,rearWindow,scope:'The windscreen half-width is an authored correction. Unknown camera intrinsics prohibit interpreting the 0.110 m edit as a measured OEM difference.'});

const costs=[];
for(const quality of ['balanced','high','ultra']){before.setQuality(quality);after.setQuality(quality);const a=before.getRenderCost(),b=after.getRenderCost();assert.ok(b.triangles<a.triangles*1.01);assert.ok(b.drawables<=a.drawables);costs.push({quality,before:a,after:b});}
for(const key of ['paint','glass','carbon','frontPanel']){
 assert.equal(before.materials[key].color.getHex(),after.materials[key].color.getHex());
 for(const property of ['metalness','roughness','opacity'])assert.equal(before.materials[key][property],after.materials[key][property]);
}
record('The result is attributable to main geometry with unchanged finish and no extra drawable count',{costs,scope:'Resource and attribution checks only; all visual judgements require the actual fixed-view PNGs.'});
const report={schema:'roadster-vehicle-main-form-3.18',createdAt:new Date().toISOString(),status:'passed',baselineCommit,baselineVehicleSHA256:sha(frozen),vehicleSHA256:sha(readFileSync('dist/vehicle.js')),modelBuildId:MODEL_BUILD_ID,findings,limits:['The numeric baseline loads exact 3.17 vehicle.js against current shared geometry dependencies; separate native baseline captures use the frozen 3.17 application.','Independent parametric reconstruction, not OEM CAD.','Same-view source photos have unknown camera intrinsics; technical and photographic comparison cameras remain distinct.','Physical collision hull is not regenerated from the visual shell. Main physical contact validation is separate.','Source-only geometry evidence is not a user-GPU acceptance or a visual score.']};
writeFileSync('qa/vehicle-main-form-'+REPORT_VERSION+'.json',JSON.stringify(report,null,2)+'\n');
before.dispose();after.dispose();console.log(JSON.stringify(report,null,2));
