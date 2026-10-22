import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,sampleVehicleSurface,VEHICLE_GEOMETRY,VEHICLE_DRIVER_VIEW} from '../dist/vehicle.js';
import {createRoadster as createBefore,sampleVehicleSurface as beforeSurface,VEHICLE_GEOMETRY as BEFORE_GEOMETRY} from '../dist/vehicle-reference-3.15.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

// Independent geometric observations complement the existing tyre, LOD and
// shader tests. This test never treats material numbers as pixel acceptance.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[],check=(name,fn)=>checks.push({name,status:'passed',detail:fn()});
const after=createRoadster({inspection:true}),before=createBefore({inspection:true});

check('The task baseline is the unmodified 3.15 vehicle and its isolated layout',()=>{
  const source=readFileSync(new URL('../dist/vehicle-reference-3.15.js',import.meta.url),'utf8').replace("from './vehicle-reference-layout-3.15.js'","from './vehicle-layout.js'");
  const layout=readFileSync(new URL('../dist/vehicle-reference-layout-3.15.js',import.meta.url));
  assert.equal(sha(source),'b9ce9ad625561c45e2843d88763adbf6767bb44d2dedcd3194f6080ca8e0f591');
  assert.equal(sha(layout),'d2918ca2d9c3a7ff14a5b6647665ffd19f933bea9d1047ae6410b6f43d6414ec');
  const dimensions={};for(const [key,value] of Object.entries(BEFORE_GEOMETRY))if(typeof value==='number'){assert.equal(VEHICLE_GEOMETRY[key],value,key);dimensions[key]=value;}
  for(let i=0;i<4;i++)assert.deepEqual(after.wheels[i].tyreProfile,before.wheels[i].tyreProfile);
  return{baselineCommit:'9f6c8f47a2678beee3915a0320ac2bf93312e96b',restoredVehicleSHA256:sha(source),layoutSHA256:sha(layout),unchangedDimensions:dimensions,unchangedTyreProfiles:4};
});

function normalTurn(sample,z){
  const section=sample(0,z).section,lo=(section.crease-.045)*section.width,hi=(section.ridge+.055)*section.width,n=600,epsilon=.00005;
  let previous=null,peak=0,total=0;
  for(let i=0;i<=n;i++){
    const x=THREE.MathUtils.lerp(lo,hi,i/n),slope=(sample(x+epsilon,z).bodyY-sample(x-epsilon,z).bodyY)/(2*epsilon),angle=Math.atan(slope);
    assert.ok(Number.isFinite(angle));if(previous!==null){const turn=Math.abs(angle-previous);peak=Math.max(peak,turn*n/(hi-lo));total+=turn;}previous=angle;
  }
  return{peakNormalTurningRadPerM:peak,totalNormalTurningDeg:THREE.MathUtils.radToDeg(total),xRangeM:[lo,hi],samples:n+1};
}
check('Transverse shoulder curvature retains the broad continuous band across the changed main sections',()=>{
  const sections=[-1.42,.9,1.42,1.8].map(z=>({zM:z,before:normalTurn(beforeSurface,z),after:normalTurn(sampleVehicleSurface,z)}));
  for(const row of sections){assert.ok(row.after.peakNormalTurningRadPerM<row.before.peakNormalTurningRadPerM*.35);}
  return{sections,meaning:'The local curvature bound remains. Total section turning is recorded, not held within the former 3-degree equality: 3.18 intentionally changes shoulder height and width. This diagnostic is not a shape-accuracy or image-quality score.'};
});

const meshes=root=>{const list=[];root.traverse(o=>{if(o.isMesh)list.push(o);});return list;};
check('The cabin cowl closes the sight line into the front coil-over bay',()=>{
  const results=[];
  for(const quality of ['balanced','high','ultra']){
    for(const model of [before,after]){model.setQuality(quality);model.setDisplayConfiguration('official-study');model.group.updateMatrixWorld(true);}
    for(const x of [-.39,.39]){
      const origin=new THREE.Vector3(0,.49,-.70),target=new THREE.Vector3(x,.151,1.34),distance=origin.distanceTo(target),direction=target.clone().sub(origin).normalize();
      const ray=new THREE.Raycaster(origin,direction,0,distance);
      const original=ray.intersectObjects(meshes(before.group.getObjectByName('two-seat official-photograph cabin study')),false);
      const current=ray.intersectObjects(meshes(after.group.getObjectByName('two-seat official-photograph cabin study')),false);
      assert.equal(original.length,0,'The 3.15 fixture no longer exposes the unclosed cowl sight line');
      assert.ok(current.length>0);assert.ok(current[0].point.z>.60&&current[0].point.z<.80);
      results.push({quality,coilBayTargetM:target.toArray(),beforeCabinOcclusion:false,afterOcclusionM:current[0].point.toArray()});
    }
  }
  for(const name of ['single-seat cockpit','two-seat official-photograph cabin study'])assert.ok(after.group.getObjectByName(name).getObjectByName('squared steering yoke').position.x>0);
  return{rays:results,leftHandDriveDisplay:true,scope:'Closes the visible dashboard/firewall return only. This is not a claim about an OEM crash beam, hidden bulkhead structure or measured driver sight lines.'};
});

check('The experimental seat back is visible from behind instead of leaving floating harness straps',()=>{
  const observations=[];
  for(const quality of ['balanced','high','ultra']){
    for(const model of [before,after]){model.setQuality(quality);model.setDisplayConfiguration('experimental');model.group.updateMatrixWorld(true);}
    const sample=(model,direction)=>{
      const cabin=model.group.getObjectByName('single-seat cockpit'),x=cabin.getObjectByName('squared steering yoke').position.x,origin=new THREE.Vector3(x,.25,direction>0?-1:0),ray=new THREE.Raycaster(origin,new THREE.Vector3(0,0,direction),0,.7);
      const panels=meshes(cabin).filter(o=>[model.materials.upholstery,model.materials.interiorTrim].includes(o.material));
      return{originM:origin.toArray(),hits:ray.intersectObjects(panels,false).map(hit=>hit.point.toArray())};
    };
    const old=sample(before,1),current=sample(after,1),front=sample(after,-1);assert.equal(old.hits.length,0);assert.ok(current.hits.length>0&&front.hits.length>0);assert.ok(current.hits[0][2]>-.50&&current.hits[0][2]<-.40);
    observations.push({quality,beforeRear:old,afterRear:current,afterFront:front});
  }
  return{observations,scope:'Driver-relative rays account for the separate left-seat correction. Existing upholstery now renders both faces; this does not certify a measured seat shell, crash structure or manufacturing thickness.'};
});

check('Glazing remains independently sorted and does not cast an opaque depth shadow across the cabin',()=>{
  const profiles=[];
  for(const quality of ['balanced','high','ultra']){
    after.setQuality(quality);after.setCutaway(true);after.setCutaway(false);
    const panes=meshes(after.group).filter(o=>o.userData.independentOpticalPanel&&[after.materials.glass,after.materials.balancedGlass].includes(o.material));
    assert.equal(panes.length,5);
    for(const pane of panes){assert.equal(pane.castShadow,false);assert.equal(pane.receiveShadow,false);assert.equal(pane.material.depthWrite,false);assert.equal(pane.material.metalness,0);assert.ok(pane.material.opacity<1);assert.ok(pane.material.userData.interiorVisualAlphaMultiplier<.3);}
    profiles.push({quality,independentlySortedPanes:panes.length,opaquePaneShadowCasters:panes.filter(p=>p.castShadow).length,exteriorAlpha:panes[0].material.opacity,interiorVisualAlphaMultiplier:panes[0].material.userData.interiorVisualAlphaMultiplier});
  }
  return{profiles,physicalTransmissionClaim:false,approximation:'A disclosed interior-facing visual filter with no refractive/transmissive shadow pass. Real WebGL compilation and view-through images are separate evidence.'};
});

check('The driving eye sees through the windscreen with visible cabin geometry, including balanced, and exterior LOD restores',()=>{
  const observations=[],eye=new THREE.Vector3().fromArray(VEHICLE_DRIVER_VIEW.position),target=new THREE.Vector3().fromArray(VEHICLE_DRIVER_VIEW.target);
  for(const quality of ['balanced','high','ultra']){
    const car=createRoadster({quality}),camera=new THREE.PerspectiveCamera(48,16/9,.07,2300);
    const exterior=()=>{camera.position.set(0,5,100);camera.lookAt(0,0,0);camera.updateMatrixWorld();car.setViewBudget(camera,720);};
    exterior();const beforeCost=car.getRenderCost(),materials=Object.values(car.materials).map(m=>({material:m,opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite}));
    car.setInteriorView(true);camera.position.copy(eye);camera.lookAt(target);camera.updateMatrixWorld();car.setViewBudget(camera,720);car.group.updateMatrixWorld(true);
    const interiorCost=car.getRenderCost();assert.equal(car.group.visible,true);assert.equal(car.group.getObjectByName('single-seat cockpit').visible,true);assert.equal(interiorCost.geometryQuality,quality);
    const opaque=[],panes=[];car.group.traverseVisible(o=>{if(o.isMesh)(o.material.transparent?panes:opaque).push(o);});
    const rays=[];
    for(const pitch of [-3,0,3,6])for(const yaw of [-12,-6,0,6,12]){
      const direction=new THREE.Vector3(Math.tan(yaw*Math.PI/180),Math.tan(pitch*Math.PI/180),1).normalize(),ray=new THREE.Raycaster(eye,direction,.07,5),solid=ray.intersectObjects(opaque,false),glass=ray.intersectObjects(panes,false);
      assert.equal(solid.length,0,quality+' forward aperture '+yaw+'/'+pitch);assert.equal(glass.length,1);assert.ok(glass[0].object.userData.independentOpticalPanel);
      rays.push({yawDeg:yaw,pitchDeg:pitch,opaqueHits:solid.length,paneHits:glass.length,paneDistanceM:glass[0].distance});
    }
    const down=new THREE.Raycaster(eye,new THREE.Vector3(.36,.265,.21).sub(eye).normalize(),.07,1),interiorHit=down.intersectObjects(opaque,false)[0];
    assert.ok(interiorHit&&interiorHit.point.z>.18&&interiorHit.point.z<.23&&interiorHit.point.y>.24&&interiorHit.point.y<.30,'The seated view lost its actual steering/display foreground');
    car.setInteriorView(false);exterior();assert.deepEqual(car.getRenderCost(),beforeCost);assert.equal(car.interiorView,false);
    for(const {material,opacity,transparent,depthWrite}of materials){assert.equal(material.opacity,opacity);assert.equal(material.transparent,transparent);assert.equal(material.depthWrite,depthWrite);}
    car.setCutaway(true);const cutawayPaint=car.materials.paint.opacity;car.setInteriorView(true);car.setInteriorView(false);assert.equal(car.materials.paint.opacity,cutawayPaint);car.setCutaway(false);
    observations.push({quality,eyeM:eye.toArray(),forwardApertureRays:rays,steeringForegroundHitM:interiorHit.point.toArray(),interiorGeometryCost:{drawables:interiorCost.drawables,triangles:interiorCost.triangles},restoredExteriorGeometryQuality:beforeCost.geometryQuality,restoredExteriorDrawables:beforeCost.drawables});car.dispose();
  }
  return{observations,scope:'A sampled central road cone and existing steering foreground, with visible non-inspection cabin at every LOD. This is not a complete driver eye ellipse, visibility certification, pixel-brightness test or a wet-night driving acceptance.'};
});

function rearOccluders(model){return meshes(model.group.getObjectByName('underbody and cold-gas equipment')).filter(o=>[model.materials.black,model.materials.carbon].includes(o.material));}
check('Four lower fan mouths have actual panel apertures and open duct sleeves at every LOD',()=>{
  const observations=[];
  for(const quality of ['balanced','high','ultra']){
    for(const model of [before,after]){model.setQuality(quality);model.group.updateMatrixWorld(true);}
    const oldPanels=rearOccluders(before),newPanels=rearOccluders(after);
    for(let index=0;index<4;index++){
      const x=(index-1.5)*.32,ray=new THREE.Raycaster(new THREE.Vector3(x+.045,-.256,-2.45),new THREE.Vector3(0,0,1),0,.25);
      const oldHits=ray.intersectObjects(oldPanels,false),newHits=ray.intersectObjects(newPanels,false);
      assert.ok(oldHits.length>0);assert.equal(newHits.length,0);
      ray.ray.origin.x=x+.135;const retained=ray.intersectObjects(newPanels,false);assert.ok(retained.length>0,'The full surrounding panel was deleted instead of cutting an aperture');
      observations.push({quality,fan:index+1,oldOpaqueIntersections:oldHits.map(h=>h.point.z),newOpaqueIntersections:0,retainedSurroundDepthM:retained[0].point.z});
    }
  }
  return{observations,scope:'Rays deliberately exclude fan blades and hubs. They prove openings in the backing geometry and duct, not that every view sees through a rotating fan.'};
});

function darkSpokeCoverage(model){
  const wheel=model.wheels.find(w=>w.side===1&&w.z>0),objects=meshes(wheel.spin).filter(o=>o.material===model.materials.wheelDark),ray=new THREE.Raycaster();let blocked=0,samples=0;
  for(let radial=0;radial<8;radial++)for(let angular=0;angular<72;angular++){
    const radius=THREE.MathUtils.lerp(.10,.275,radial/7),angle=angular*Math.PI*2/72;
    ray.set(new THREE.Vector3(1.30,wheel.assembly.position.y+radius*Math.cos(angle),wheel.z+radius*Math.sin(angle)),new THREE.Vector3(-1,0,0));ray.far=.65;
    blocked+=ray.intersectObjects(objects,false).length>0?1:0;samples++;
  }
  return{blocked,samples,fraction:blocked/samples};
}
check('The split-spoke geometry reduces the broad coated spoke coverage while retaining the tyre envelope',()=>{
  before.setQuality('high');after.setQuality('high');before.group.updateMatrixWorld(true);after.group.updateMatrixWorld(true);
  const original=darkSpokeCoverage(before),current=darkSpokeCoverage(after);assert.ok(current.fraction<original.fraction);
  return{before:original,after:current,scope:'Axial geometric rays over one wheel face, excluding metal aero sectors and brake rotor. This is a geometric coverage sample, not image luminance or appearance acceptance.'};
});

const sourcePaths=['dist/vehicle.js','dist/main.js','dist/vehicle-reference-3.15.js','dist/vehicle-reference-layout-3.15.js','dist/vehicle-inspection.js','dist/vehicle-inspection.html','dist/vehicle-study-capture.js','dist/i18n-vehicle-314-en.js','tests/vehicle-finish-3.16.test.mjs'];
const report={schema:'roadster-vehicle-finish-3.16',status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,asOf:new Date().toISOString(),baselineCommit:'9f6c8f47a2678beee3915a0320ac2bf93312e96b',checks,sourceHashes:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))])),limitations:['This report is a source/geometry/material lifecycle test and contains no captured GPU pixels.','Public images establish visible shape and trim references, not measured dimensions, BRDFs, structural load paths or optical transmittance.','The stock study and experimental model remain visibly distinct; neither display choice changes the driving mass, inertia, gas model or actuator locations.']};
writeFileSync(new URL(`../qa/vehicle-finish-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
before.dispose();after.dispose();console.log(JSON.stringify(report,null,2));
