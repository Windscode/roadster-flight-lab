import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,VEHICLE_GEOMETRY,sampleVehicleSurface} from '../dist/vehicle.js';
import {createRoadster as createBaseline,sampleVehicleSurface as sampleBaseline} from '../dist/vehicle-reference-3.13.js';
import {createRoadster as createRecentBaseline} from '../dist/vehicle-reference-3.15.js';
import {VEHICLE_PHOTO_MATCHES,normalizedLandmarkReport,letterboxViewport} from '../dist/vehicle-display-study.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const checks=[],check=(name,fn)=>checks.push({name,status:'passed',detail:fn()}),sha=b=>createHash('sha256').update(b).digest('hex');
const car=createRoadster({inspection:true}),driver=createRoadster(),baseline=createBaseline(),recentBaseline=createRecentBaseline();
const allNames=root=>{const names=[];root.traverse(o=>names.push(o.name,...o.userData.parts||[]));return names;};
check('Frozen 3.13 exterior restores the published bytes and independent layout',()=>{
  const source=readFileSync(new URL('../dist/vehicle-reference-3.13.js',import.meta.url)).toString().replace("from './vehicle-reference-layout-3.13.js'","from './vehicle-layout.js'");
  assert.equal(sha(source),'70515d7eec676d7a36f121701d0a7be17be6b19c0b4a826bfc794c279ccbb5b2');
  assert.equal(sha(readFileSync(new URL('../dist/vehicle-reference-layout-3.13.js',import.meta.url))),'d2918ca2d9c3a7ff14a5b6647665ffd19f933bea9d1047ae6410b6f43d6414ec');
  return{baselineCommit:'1dde9a3df081297978d7cc98409be86bcc6daa23',restoredSourceSHA256:sha(source),scope:'Frozen geometry/material code; the comparison uses the current renderer, not a frozen 3.13 rendering pipeline.'};
});
check('Two-seat display is inspection-only and swaps complete visible cabin identities',()=>{
  assert.throws(()=>driver.setDisplayConfiguration('official-study'),/inspection-only/);assert.equal(driver.displayConfiguration,'experimental');assert.equal(driver.group.getObjectByName('two-seat official-photograph cabin study'),undefined);
  const experiment=car.group.getObjectByName('single-seat cockpit'),official=car.group.getObjectByName('two-seat official-photograph cabin study'),equipment=car.group.getObjectByName('illustrative internal equipment'),jets=car.group.getObjectByName('simulated force application nozzles');
  const count=(root,term)=>allNames(root).filter(n=>n===term).length;
  // Merged objects may repeat the first part as their display name. Use the
  // part list per material to count the originally authored seat shell once.
  const seatShells=root=>{let n=0;root.traverse(o=>{n+=(o.userData.parts||[o.name]).filter(name=>name==='sculpted bucket seat shell').length;});return n;};
  assert.equal(seatShells(experiment),1);assert.equal(seatShells(official),2);
  assert.ok(count(experiment,'flat woven shoulder harness')>=2);assert.equal(count(official,'flat woven shoulder harness'),0);
  assert.ok(allNames(official).includes('photograph-study rear headlining crossmember'));
  for(const quality of ['balanced','high','ultra']){
    car.setQuality(quality);car.setDisplayConfiguration('official-study');car.setCutaway(true);
    assert.equal(official.visible,true);assert.equal(experiment.visible,false);assert.equal(equipment.visible,false);assert.equal(jets.visible,false);assert.equal(car.chamber.root.visible,false);
    car.setDisplayConfiguration('experimental');assert.equal(experiment.visible,true);assert.equal(official.visible,false);assert.equal(equipment.visible,true);assert.equal(jets.visible,true);assert.equal(car.chamber.root.visible,true);
    car.setCutaway(false);assert.equal(equipment.visible,false);
  }
  return{experimentalSeats:1,officialStudyFrontSeats:2,hiddenOEMStructureClaim:false,physicsWrites:false,inspectionOnly:true};
});
check('Lamp off, DRL and low-beam affect bounded emissive roles while retaining wells and optical covers',()=>{
  const states={};for(const mode of ['off','drl','low-beam']){car.setLampMode(mode);states[mode]=Object.fromEntries(['whiteLight','lampGuide','lampEmitter','tailLight'].map(key=>[key,car.materials[key].emissiveIntensity]));}
  assert.ok(Object.values(states.off).every(x=>x===0));assert.equal(states.drl.lampEmitter,0);assert.ok(states.drl.lampGuide>0);assert.ok(states['low-beam'].lampGuide>states['low-beam'].lampEmitter);assert.ok(states['low-beam'].lampGuide<=2);
  assert.throws(()=>car.setLampMode('unbounded'),/Unknown/);assert.equal(car.lampMode,'low-beam');
  const names=allNames(car.group);for(const term of ['triangular headlight housing','headlamp continuous upper edge light guide','headlamp upper opaque eyebrow','individual LED projector behind upper guide','flush clear headlamp cover'])assert.ok(names.some(n=>n===term),term);
  const normals=[];for(const quality of ['balanced','high','ultra']){car.setQuality(quality);let triangles=0,down=0;car.group.traverse(o=>{if(o.material!==car.materials.lampGuide)return;const p=o.geometry.attributes.position,i=o.geometry.index,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();for(let k=0;k<i.count;k+=3){a.fromBufferAttribute(p,i.getX(k));b.fromBufferAttribute(p,i.getX(k+1));c.fromBufferAttribute(p,i.getX(k+2));if(b.sub(a).cross(c.sub(a)).y<0)down++;triangles++;}});assert.equal(down,0);normals.push({quality,triangles,downwardWinding:down});}
  return{states,guideWinding:normals,addedTextureSamplers:0,internalOptics:'inferred, not manufacturer optical data'};
});
check('Rubber, coated dark alloy, machined silver, rotor and cabin finishes remain distinct without added texture samplers',()=>{
  assert.equal(car.materials.rubber.metalness,0);assert.ok(car.materials.rubber.roughness>.8);
  assert.ok(car.materials.wheelDark.metalness<.25);assert.ok(car.materials.wheelSilver.metalness>.8);assert.ok(car.materials.rotor.roughness>car.materials.wheelSilver.roughness+.15);
  assert.ok(car.materials.wheelSilver.color.r>car.materials.wheelDark.color.r*4);assert.ok(car.materials.seatFabric.color.r>car.materials.upholstery.color.r*4);assert.equal(car.materials.seatFabric.metalness,0);
  for(const key of ['lampGuide','seatFabric','seatBolster','headlining','tailMount'])for(const value of Object.values(car.materials[key]))assert.ok(!value?.isTexture,key+' unexpectedly adds a texture sampler');
  for(const key of ['metalness','roughness','clearcoat','clearcoatRoughness'])assert.equal(car.materials.paint[key],baseline.materials.paint[key]);assert.equal(car.materials.glass.opacity,.90);assert.equal(car.materials.glass.userData.interiorVisualAlphaMultiplier,.24);
  return Object.fromEntries(['rubber','wheelDark','wheelSilver','rotor','seatFabric','seatBolster'].map(key=>[key,{color:car.materials[key].color.getHexString(),metalness:car.materials[key].metalness,roughness:car.materials[key].roughness}]));
});
check('Tail installation surrounds unchanged nozzle positions and nozzle geometry',()=>{
  car.setQuality('high');baseline.setQuality('high');car.group.updateMatrixWorld(true);baseline.group.updateMatrixWorld(true);const ports=[];
  for(let i=1;i<=4;i++){const name='rear propulsion nozzle '+i,a=car.group.getObjectByName(name),b=baseline.group.getObjectByName(name);assert.ok(a&&b);assert.deepEqual(a.position.toArray(),b.position.toArray());assert.deepEqual(a.quaternion.toArray(),b.quaternion.toArray());const ba=new THREE.Box3().setFromObject(a),bb=new THREE.Box3().setFromObject(b);assert.ok(ba.min.distanceTo(bb.min)<1e-8&&ba.max.distanceTo(bb.max)<1e-8);ports.push({name,centre:a.position.toArray(),bounds:{min:ba.min.toArray(),max:ba.max.toArray()}});}
  const parts=allNames(car.group);for(const term of ['recessed cold-gas mounting pocket','unchanged-port thermal isolation edge','tail cassette support web','continuous rear module support sill'])assert.ok(parts.includes(term));
  // Independent rays through the actual merged carbon geometry distinguish a
  // real aperture from a black/metal disc resting over the uncut rear panel.
  const apertureRays=[],ray=new THREE.Raycaster();
  // 3.16 recesses the retained valance by up to 44 mm; the old -2.28 m
  // cutoff excluded that real panel from the outside-aperture ray. Keep the
  // full 25 cm rear installation depth while still excluding remote bodywork.
  const hits=(model,x,offset)=>{const panels=[];model.group.traverse(o=>{if(o.isMesh&&(o.userData.parts||[o.name]).includes('contoured rear carbon valance'))panels.push(o);});ray.set(new THREE.Vector3(x+offset,-.035,-2.45),new THREE.Vector3(0,0,1));return ray.intersectObjects(panels,false).filter(h=>h.point.z< -2.20);};
  for(const quality of ['balanced','high','ultra']){car.setQuality(quality);baseline.setQuality(quality);car.group.updateMatrixWorld(true);baseline.group.updateMatrixWorld(true);
    for(let j=0;j<4;j++){const x=(j-1.5)*.32,old=hits(baseline,x,.03),mouth=hits(car,x,.03),returnEdge=hits(car,x,.09),outside=hits(car,x,.135);assert.equal(old.length,1);assert.equal(mouth.length,0);assert.equal(returnEdge.length,1);assert.equal(outside.length,1);assert.ok(returnEdge[0].point.z<outside[0].point.z-.015);apertureRays.push({quality,port:j+1,oldPanelZ:old[0].point.z,currentPanelBlockingMouth:false,bevelZ:returnEdge[0].point.z,retainedPanelZ:outside[0].point.z});}
  }
  return{ports,apertureRays,sharedPhotoVisiblePortReturns:true,forceModelChanges:0,outletRadiusChanges:0,scope:'Visible ports remain a common longitudinal actuator representation, not four new independent forces. Surrounds are authored installation geometry, not a disclosed OEM internal mechanism.'};
});
check('Identity, LOD, lamps and cutaway cycling preserve wheel, wing and glass geometry state',()=>{
  const state={wheelStates:car.wheels.map(w=>({suspensionLength:.255,steer:w.z>0?.40:0,rotation:1.13})),wing:{deployment:.73,position:{x:0,y:.544,z:-2.065},incidenceRad:-.1825}};car.update(state,0);
  const pose=()=>({wheels:car.wheels.map(w=>({position:w.assembly.position.toArray(),rotation:w.assembly.quaternion.toArray(),spin:w.spin.rotation.toArray()})),wing:{position:car.wing.position.toArray(),rotation:car.wing.quaternion.toArray()}}),before=pose();
  for(let i=0;i<3;i++)for(const quality of ['balanced','ultra','high'])for(const mode of ['official-study','experimental']){car.setQuality(quality);car.setDisplayConfiguration(mode);car.setCutaway(true);car.setLampMode('off');car.setCutaway(false);car.setLampMode('low-beam');assert.deepEqual(pose(),before);}
  car.group.updateMatrixWorld(true);const panes=[];car.group.traverse(o=>{if(o.userData.independentOpticalPanel)panes.push(o);});assert.equal(panes.length,7);assert.equal(panes.filter(o=>o.material===car.materials.glass).length,5);
  // 3.18 deliberately changes the waist, nose and canopy transitions. The
  // wheel/arch/liner hard points remain fixed; visual station deltas are data.
  let maximumSurfaceDeltaM=0;const stationChanges=[];
  for(const z of [-2,-1.42,-.3,.8,1.42,2.1])for(const x of [0,.4,.7,.95]){
    const current=sampleVehicleSurface(x,z),old=sampleBaseline(x,z);
    for(const key of ['archY','linerInnerX'])assert.deepEqual(current[key],old[key],key);
    stationChanges.push({x,z,before:old,after:current});
    maximumSurfaceDeltaM=Math.max(maximumSurfaceDeltaM,Math.abs(current.bodyY-old.bodyY));
  }
  assert.equal(VEHICLE_GEOMETRY.tyreRadius,.372);assert.equal(VEHICLE_GEOMETRY.wheelTrackHalf,.89);assert.equal(VEHICLE_GEOMETRY.wheelbaseHalf,1.42);
  return{cycles:18,independentGlassPanels:5,independentLampCovers:2,unchangedTyreRadiusM:VEHICLE_GEOMETRY.tyreRadius,unchangedArchAndLiner:true,maximumSurfaceDeltaM,stationChanges,changedMainBody:'3.18 changes visual section stations; the earlier <10 mm local-fillet envelope is obsolete. The physical hard points and full existing tyre clearance gate remain unchanged.'};
});
check('Photographic cameras reproduce the declared normalized landmark residuals and keep a separate technical rig',()=>{
  const result=[];for(const ref of VEHICLE_PHOTO_MATCHES){const camera=new THREE.PerspectiveCamera(),[w,h]=ref.sourceResolution;camera.filmGauge=36;camera.aspect=w/h;camera.setFocalLength(ref.focalLengthMm);camera.position.set(...ref.position);camera.lookAt(...ref.target);camera.setViewOffset(w,h,-ref.frameShiftUV[0]*w,-ref.frameShiftUV[1]*h,w,h);const measured=normalizedLandmarkReport(THREE,camera,new THREE.Matrix4(),ref);assert.ok(Math.abs(measured.rmsImageDiagonalFraction-ref.rmsImageDiagonalFraction)<1e-12);assert.equal(measured.status,'design-comparison-only');assert.ok(measured.points.every(p=>p.errorPixels>=0&&p.manualTolerancePixels>=10));result.push({id:ref.id,sourceSHA256:ref.sha256,rmsImageDiagonalPercent:100*measured.rmsImageDiagonalFraction,landmarks:measured.points.length});}
  const box=letterboxViewport(900,720,3440/1024);assert.ok(Math.abs(box.width/box.height-3440/1024)<1e-12);assert.equal(box.width,900);assert.ok(box.y>0);assert.throws(()=>letterboxViewport(0,10,1),/Invalid/);return{views:result,metricCADClaim:false,geometryImprovementClaim:false};
});
check('All new geometry has finite unit normals and bounded incremental LOD costs against the 3.15 task baseline',()=>{
  // Preserve the historical 3.15 triangle ceiling and baseline counts. 3.22
  // separates exactly three material batches for the articulated yoke; they
  // were formerly baked into the static cabin and add no geometry.
  const costs={};for(const q of ['balanced','high','ultra']){driver.setQuality(q);baseline.setQuality(q);recentBaseline.setQuality(q);const after=driver.getRenderCost(),before=recentBaseline.getRenderCost(),historical313=baseline.getRenderCost();const articulatedBatchAllowance=3;assert.ok(after.triangles/before.triangles<1.04);assert.ok(after.drawables-before.drawables<=1+articulatedBatchAllowance);costs[q]={baselineVersion:'3.15.0',historical313,before,after,triangleDelta:after.triangles-before.triangles,drawablesDelta:after.drawables-before.drawables,articulatedBatchAllowance};}
  car.setDisplayConfiguration('official-study');for(const q of ['balanced','high','ultra']){car.setQuality(q);car.group.traverse(o=>{if(!o.geometry)return;const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;assert.ok(p.array.every(Number.isFinite),o.name);if(n)for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.0006,o.name+' invalid normal');});}
  return{costs,meaning:'Resource costs only, not visual quality or GPU performance.'};
});
const sourcePaths=['dist/vehicle.js','dist/vehicle-inspection.js','dist/vehicle-display-study.js','dist/vehicle-study-capture.js','dist/vehicle-reference-3.13.js','dist/vehicle-reference-layout-3.13.js','dist/vehicle-reference-3.15.js','dist/vehicle-reference-layout-3.15.js','dist/i18n-vehicle-314-en.js','tests/vehicle-display-3.14.test.mjs'];
const report={schema:'roadster-vehicle-display-3.14',status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,asOf:new Date().toISOString(),checks,sourceHashes:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))])),limitations:['Geometry/material parameters, camera projection and identity isolation are tested. No real GPU pixel or perceived-detail acceptance is implied.','This structural test does not acquire images; current matched WebGL captures and visual review are separate evidence.','Same-camera studio/daylight plus actual city wet-night frames, full optical orbit and steering/suspension/wing motion remain target-device checks.']};
writeFileSync(new URL(`../qa/vehicle-display-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');car.dispose();driver.dispose();baseline.dispose();recentBaseline.dispose();console.log(JSON.stringify(report,null,2));
