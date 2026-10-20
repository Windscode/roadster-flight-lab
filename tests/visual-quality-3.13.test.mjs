import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,sampleVehicleSurface,BONNET_JOINT_SPEC} from '../dist/vehicle.js';
import {buildCityLandmarks,SOUTH_QUAY_ENTRY_SOLIDS,SOUTH_QUAY_ENTRY_LIGHTS} from '../dist/city-landmarks.js';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const fixture=JSON.parse(readFileSync(new URL('../qa/fixtures/vehicle-optical-baseline-3.12.json',import.meta.url)));
const checks=[],car=createRoadster({quality:'high'}),check=(name,fn)=>checks.push({name,status:'passed',detail:fn()});
const sha=data=>createHash('sha256').update(data).digest('hex');
check('The authored wedge sections and primary paint optics are unchanged from the published 3.12 source',()=>{
  for(const p of fixture.samplePoints)assert.deepEqual(sampleVehicleSurface(p.x,p.z),p.sample);
  for(const [key,value] of Object.entries(fixture.paint))assert.equal(car.materials.paint[key],value);
  assert.equal(car.materials.glass.opacity,fixture.glassOpacity);
  for(const key of ['glass','coverLens'])for(const value of Object.values(car.materials[key]))assert.ok(!value?.isTexture,'Optical detail must not add texture units');
  return{baselineCommit:fixture.baselineCommit,sourceSHA256:fixture.sourceSHA256,bodySectionSamples:fixture.samplePoints.length,paint:fixture.paint,glassOpacity:fixture.glassOpacity,newTextureUnits:0};
});
check('Vertical rays hit a recessed joint floor rather than a raised black tube or uncut paint at every LOD',()=>{
  const result={},ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
  for(const quality of ['balanced','high','ultra']){
    car.setQuality(quality);car.group.updateMatrixWorld(true);const surfaces=[];
    car.group.traverse(o=>{if(o.isMesh&&[car.materials.paint,car.materials.balancedPaint,car.materials.seam].includes(o.material))surfaces.push(o);});
    const samples=[...fixture.jointRays,...[-.4,0,.4].map(x=>({x,z:1,bodyY:sampleVehicleSurface(x,1).bodyY}))].map(p=>{
      ray.set(new THREE.Vector3(p.x,1,p.z),down);const hit=ray.intersectObjects(surfaces,false)[0];assert.ok(hit);
      const belowBodyM=p.bodyY-hit.point.y;assert.equal(hit.object.material,car.materials.seam,'Joint must be open to its dark recessed floor');
      // Curved grid interpolation differs slightly by LOD; retain a sub-mm
      // geometric tolerance rather than accepting a surface-level dark stripe.
      assert.ok(Math.abs(belowBodyM-BONNET_JOINT_SPEC.depthM)<.0005,quality+' joint floor has wrong depth');
      const transverse=p.z===1,adjacent={x:p.x+(transverse?0:.008),z:p.z+(transverse?.008:0)};
      ray.set(new THREE.Vector3(adjacent.x,1,adjacent.z),down);const neighbour=ray.intersectObjects(surfaces,false)[0];assert.ok(neighbour);
      assert.ok([car.materials.paint,car.materials.balancedPaint].includes(neighbour.object.material),'Adjacent painted body was removed');
      return{x:p.x,z:p.z,baselineAboveBodyM:p.aboveAuthoredBodyM??null,belowBodyM};
    });result[quality]=samples;
  }
  return{authoredJoint:BONNET_JOINT_SPEC,samples:result};
});
check('Individual glazing and headlamp covers have independent camera sorting anchors without moving the glazing envelope',()=>{
  car.setQuality('high');car.group.updateMatrixWorld(true);const optical=[],glass=[];
  car.group.traverse(o=>{if(o.isMesh&&o.userData.independentOpticalPanel){optical.push(o);if(o.material===car.materials.glass)glass.push(o);}});
  const sortCentre=o=>{o.geometry.computeBoundingSphere();return o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);};
  assert.equal(glass.length,5);assert.equal(optical.length,7);assert.equal(new Set(optical.map(o=>sortCentre(o).toArray().join(','))).size,7);
  const bounds=new THREE.Box3();for(const pane of glass){bounds.union(new THREE.Box3().setFromObject(pane));assert.ok(!pane.userData.batched,'Optical pane was merged into a fixed-order batch');assert.ok(pane.material.name.startsWith('Roadster / '));}
  for(const edge of ['min','max'])for(let i=0;i<3;i++)assert.ok(Math.abs(bounds[edge].toArray()[i]-fixture.glassBounds[edge][i])<1e-6,'Glazing envelope changed while splitting optical batches');
  const depthOrder=(position)=>{const camera=new THREE.PerspectiveCamera(50,16/9,.01,50);camera.position.set(...position);camera.lookAt(0,.3,0);camera.updateMatrixWorld(true);return glass.map(o=>({name:o.name,z:sortCentre(o).applyMatrix4(camera.matrixWorldInverse).z})).sort((a,b)=>a.z-b.z).map(x=>x.name);};
  const front=depthOrder([0,.7,6]),back=depthOrder([0,.7,-6]),left=depthOrder([6,.7,0]),right=depthOrder([-6,.7,0]);
  const index=(order,name)=>order.findIndex(n=>n.includes(name));
  assert.ok(index(front,'rear backlight')<index(front,'windscreen'));assert.ok(index(back,'windscreen')<index(back,'rear backlight'));
  assert.ok(index(left,'right frameless')<index(left,'left frameless'));assert.ok(index(right,'left frameless')<index(right,'right frameless'));
  const before=optical.map(o=>({object:o,position:o.position.toArray(),bounds:new THREE.Box3().setFromObject(o)}));
  for(let cycle=0;cycle<3;cycle++)for(const quality of ['balanced','ultra','high']){car.setQuality(quality);car.setCutaway(true);car.setCutaway(false);}
  car.group.updateMatrixWorld(true);for(const p of before){assert.deepEqual(p.object.position.toArray(),p.position);const after=new THREE.Box3().setFromObject(p.object);assert.ok(after.min.distanceTo(p.bounds.min)<1e-7&&after.max.distanceTo(p.bounds.max)<1e-7);}
  assert.equal(car.materials.glass.opacity,.94);assert.equal(car.materials.coverLens.depthWrite,false);
  return{baselineGlassBatches:fixture.glass.length,currentGlassPanels:glass.length,headlampCovers:optical.length-glass.length,front,back,left,right,worldEnvelope:{min:bounds.min.toArray(),max:bounds.max.toArray()},scope:'Object-level transparency sorting and unchanged world geometry; no GPU blending or reflection acceptance.'};
});
check('Both mirrored headlamp cover meshes have outward-facing triangle indices, not only corrected shading normals',()=>{
  car.setQuality('high');const result={triangles:0,upward:0,downward:0},a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  car.group.traverse(o=>{if(!o.isMesh||o.material!==car.materials.coverLens)return;const g=o.geometry,p=g.attributes.position,index=g.index;
    for(let i=0;i<index.count;i+=3){a.fromBufferAttribute(p,index.getX(i));b.fromBufferAttribute(p,index.getX(i+1));c.fromBufferAttribute(p,index.getX(i+2));const normal=b.sub(a).cross(c.sub(a));result.triangles++;result[normal.y>0?'upward':'downward']++;}
  });
  assert.equal(result.triangles,fixture.baselineCoverWinding.triangles);assert.ok(fixture.baselineCoverWinding.downward>0);assert.equal(result.downward,0);assert.equal(car.materials.coverLens.side,THREE.FrontSide);
  return{before:fixture.baselineCoverWinding,after:result,scope:'The former double-sided cover concealed its mirrored winding mismatch. One-sided optical covers require actual outward index winding.'};
});
check('The South Quay entrance is drawn from the same solid transforms used by physics, with an open road and ramp',()=>{
  const scene=new THREE.Group(),landmark=buildCityLandmarks(THREE,scene),geometry=new RoadsterSim().getWorldGeometry(),matrix=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3(),renderInstances=[];
  landmark.root.updateMatrixWorld(true);landmark.root.traverse(o=>{if(!o.isInstancedMesh||o.geometry.type!=='BoxGeometry')return;for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);matrix.decompose(p,q,s);renderInstances.push({position:p.toArray(),size:s.toArray(),quaternion:q.toArray()});}});
  assert.equal(SOUTH_QUAY_ENTRY_SOLIDS.length,8);
  const near=(a,b,t=3e-5)=>a.every((v,i)=>Math.abs(v-b[i])<t);
  for(const solid of SOUTH_QUAY_ENTRY_SOLIDS){
    const physical=geometry.find(g=>g.id===solid.id);assert.ok(physical);assert.deepEqual(physical.position,solid.position);assert.deepEqual(physical.size,solid.size);
    assert.ok(renderInstances.some(v=>near(v.position,physical.position)&&near(v.size,physical.size)&&near(v.quaternion,physical.quaternion)),'Shared collider has no matching visible solid: '+solid.id);
    const min=solid.position.map((v,i)=>v-solid.size[i]/2),max=solid.position.map((v,i)=>v+solid.size[i]/2);
    const intersects=(a,b)=>min.every((v,i)=>v<b[i]&&max[i]>a[i]);
    assert.ok(!intersects([-700,0,-431],[700,4,-409]),'Entry obstructs the existing 22 m arterial');
    assert.ok(!intersects([-436,0,-468],[-424,5,-431]),'Entry obstructs the original 12 m ramp corridor below 5 m');
  }
  for(const light of SOUTH_QUAY_ENTRY_LIGHTS){assert.ok(landmark.lightAnchors.some(a=>a.id===light.id&&near(a.position,light.position)));assert.ok(landmark.root.getObjectByName(light.id+' / actual luminaire'));assert.equal(light.practical,true);assert.ok(light.range<=22);}
  const result={sharedSolids:SOUTH_QUAY_ENTRY_SOLIDS.map(g=>g.id),rampDeckWidthM:12,arterialWidthM:22,newEntryPierClearWidthM:18.6,checkedHeadroomM:5,finiteRangeFixtures:SOUTH_QUAY_ENTRY_LIGHTS.map(({id,range,intensity})=>({id,range,intensity})),scope:'Preserves prior ramp railings; 12 m is deck width, not net clearance between existing rails.'};
  const geos=new Set(),materials=new Set();landmark.root.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)materials.add(o.material);});for(const g of geos)g.dispose();for(const m of materials)m.dispose();return result;
});
check('Sorting/detail costs stay bounded at each existing driving LOD',()=>{
  const result={};for(const quality of ['balanced','high','ultra']){car.setQuality(quality);const current=car.getRenderCost(),before=fixture.profiles[quality];assert.ok(current.drawables-before.drawables<=8);assert.ok(current.triangles/before.triangles<1.05);result[quality]={before,current,drawablesDelta:current.drawables-before.drawables,trianglesDelta:current.triangles-before.triangles};}return result;
});
const sourceFiles=['dist/vehicle.js','dist/city-landmarks.js','tests/visual-quality-3.13.test.mjs','qa/fixtures/vehicle-optical-baseline-3.12.json'];
const report={status:'passed',modelVersion:MODEL_VERSION,asOf:new Date().toISOString(),checks,sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))])),limitations:['These are geometric, raycast, sorting-anchor and source checks. They do not certify transparent blending, reflections, shadows, night readability or frame times on a GPU.','The supplied 3.11/3.12 screenshots are baseline evidence, not screenshots of this change. Fixed-camera 3.13 before/after images remain required.','New entrance lighting is subject to the global light pool and the finite spatial resolution of the rebaked static fields.']};
writeFileSync(new URL(`../qa/visual-quality-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');car.dispose();console.log(JSON.stringify(report,null,2));
