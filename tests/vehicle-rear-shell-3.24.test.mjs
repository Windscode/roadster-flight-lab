import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,VEHICLE_GEOMETRY,VEHICLE_DRIVER_VIEW,sampleVehicleRearCorner,sampleVehicleSide} from '../dist/vehicle.js';
import {readGitObject} from './git-object-read.mjs';

const baselineCommit='bb2fd93bc54bfcc79f27276b1b946e912d2156aa',frozen=readGitObject(baselineCommit+':dist/vehicle.js');
const source=frozen.toString().replaceAll("from './","from '"+pathToFileURL(resolve('dist')+'/').href);
const baseline=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const before=baseline.createRoadster({inspection:true}),after=createRoadster({inspection:true}),rows=[];
const meshes=(car,materials)=>{const out=[];car.group.traverseVisible(o=>{if(o.isMesh&&materials.includes(o.material))out.push(o);});return out;};
const cast=(objects,x,y)=>new THREE.Raycaster(new THREE.Vector3(x,y,-2.60),new THREE.Vector3(0,0,1),0,.4).intersectObjects(objects,false);
const numeric=o=>Object.fromEntries(Object.entries(o).filter(([,value])=>typeof value==='number'));
assert.deepEqual(numeric(VEHICLE_GEOMETRY),numeric(baseline.VEHICLE_GEOMETRY));
assert.deepEqual(VEHICLE_DRIVER_VIEW,baseline.VEHICLE_DRIVER_VIEW);
for(let i=0;i<4;i++)assert.deepEqual(after.wheels[i].tyreProfile,before.wheels[i].tyreProfile);
for(const side of [-1,1])for(let i=0;i<=20;i++){
  const p=sampleVehicleRearCorner(side,1,i/20),retained=sampleVehicleSide(-2.30,p[1]);
  assert.ok(Math.abs(p[0]-side*retained.x)<1e-12);assert.equal(p[2],-2.30);
}
rows.push({name:'rear quarters join the retained side skin at 42 independent section boundaries',wheelAndForceHardPointsChanged:0});

const coverage=[],cost=[];
for(const quality of ['balanced','high','ultra']){
  for(const car of [before,after]){car.setQuality(quality);car.group.updateMatrixWorld(true);}
  const paints=car=>meshes(car,[car.materials.paint,car.materials.balancedPaint]);
  for(const side of [-1,1])for(const x of [.80,.84,.88])for(const y of [-.15,-.24]){
    const old=cast(paints(before),side*x,y),current=cast(paints(after),side*x,y);
    assert.equal(old.length,0,'The retained 3.23 counterexample must lack this rear-quarter surface');
    assert.ok(current.length>0,'The new body must contain a real swept surface, not an overlay line');
    assert.ok(current[0].point.z< -2.30);
    coverage.push({quality,x:side*x,y,beforePaintHit:false,afterSurfaceZ:current[0].point.z});
  }
  for(let i=1;i<=4;i++){
    const name='rear propulsion nozzle '+i,a=before.group.getObjectByName(name),b=after.group.getObjectByName(name);
    assert.deepEqual(a.position.toArray(),b.position.toArray());assert.deepEqual(a.quaternion.toArray(),b.quaternion.toArray());
    const oldBox=new THREE.Box3().setFromObject(a),box=new THREE.Box3().setFromObject(b);
    assert.ok(oldBox.min.distanceTo(box.min)<1e-9&&oldBox.max.distanceTo(box.max)<1e-9);
  }
  const panels=meshes(after,[after.materials.carbon,after.materials.black,after.materials.paint,after.materials.balancedPaint]).filter(o=>{
    // The retained nozzle's actuator jacket is behind its bell. Test the
    // enclosing body and duct sleeve, not that unchanged internal hardware.
    for(let p=o;p;p=p.parent)if(p.name.startsWith('rear propulsion nozzle '))return false;
    return true;
  });
  for(let i=0;i<4;i++)for(const [y,offset] of [[-.035,.03],[-.256,.045]]){
    const ray=new THREE.Raycaster(new THREE.Vector3((i-1.5)*.32+offset,y,-2.45),new THREE.Vector3(0,0,1),0,.25);
    assert.equal(ray.intersectObjects(panels,false).length,0,'Rear-quarter enclosure must not cap an outlet or extraction duct');
  }
  after.group.traverse(o=>{
    const p=o.geometry?.attributes.position,n=o.geometry?.attributes.normal;if(!p)return;
    assert.ok(p.array.every(Number.isFinite));
    if(n)for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.0005,`Invalid ${quality} normal in ${o.name}`);
  });
  const old=before.getRenderCost(),current=after.getRenderCost();
  assert.equal(current.drawables,old.drawables,'The shell shares existing material batches');
  assert.ok(current.triangles<old.triangles*1.01,'The shell must stay within a one-percent geometry change');
  cost.push({quality,before:old,after:current});
}
rows.push({name:'rear-quarter body coverage is real at every quality',coverage});
rows.push({name:'eight existing functional openings and all nozzle dimensions retained',qualities:3,openingsPerQuality:8});
rows.push({name:'finite unit normals and unchanged drawable budget',cost});

after.setQuality('high');const solid=after.materials.paint.opacity,revision=after.group.userData.shadowShapeRevision;
after.setCutaway(true);assert.equal(after.materials.paint.opacity,.17);assert.ok(after.group.userData.shadowShapeRevision>revision);
assert.equal(after.group.getObjectByName('illustrative structural battery').visible,true);
after.setCutaway(false);assert.equal(after.materials.paint.opacity,solid);
const restored=after.group.userData.shadowShapeRevision;after.setQuality('high');assert.equal(after.group.userData.shadowShapeRevision,restored);
for(const material of ['paint','carbon','nozzle','rubber']){
  assert.equal(after.materials[material].color.getHex(),before.materials[material].color.getHex());
  assert.equal(after.materials[material].roughness,before.materials[material].roughness);
}
rows.push({name:'cutaway, shape invalidation, and separate existing material responses retained',steadyProfileInvalidation:false});
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={schema:'roadster-rear-shell-3.24',status:'passed',baselineCommit,baselineVehicleSHA256:hash(frozen),vehicleSHA256:hash(readFileSync(new URL('../dist/vehicle.js',import.meta.url))),rows,
  reference:{officialPage:'https://www.tesla.com/roadster',referenceImageAccess:'The official page was read; current rear-image fetches failed. Historical image notes are not treated as newly verified OEM geometry.',baselineDrivingImage:'qa/browser-3.23/roadster-3.23.0-chase-clear-day.png'},
  limits:['Independent wrapping body and cavity reconstruction; no OEM dimensions, hidden mechanism or production configuration claimed.','Existing experimental nozzle and fan locations, physics, wheel and suspension envelope remain unchanged.','Numerical geometry and source checks do not establish pixel quality; native matched views are reviewed separately.']};
mkdirSync('qa/vehicle-3.24',{recursive:true});writeFileSync('qa/vehicle-3.24/rear-shell.json',JSON.stringify(report,null,2)+'\n');
before.dispose();after.dispose();console.log('PASS rear shell: real wrap surfaces, eight open ducts, fixed hardware, normals, cutaway and bounded LOD');
