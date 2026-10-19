import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,VEHICLE_GEOMETRY as G,sampleVehicleSurface} from '../dist/vehicle.js';
import {SEAL_OUTLINE,SKIRT_BASE_Y,SKIRT_MAX_EXTENSION} from '../dist/vehicle-layout.js';

const car=createRoadster(),results=[];
const test=(name,fn)=>{const t=performance.now();fn();results.push({test:name,status:'PASS',ms:Math.round(performance.now()-t)});};
let meshes=0,vertices=0,minArchMargin=Infinity,minRoofMargin=Infinity,minWheelhouseWall=Infinity,minJetMargin=Infinity,sweepSamples=0;
test('Every authored position and normal is finite; nonzero normals are unit length',()=>{
  car.group.traverse(o=>{
    if(!o.geometry)return;meshes++;
    const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;vertices+=p?.count||0;
    if(p)assert.ok(p.array.every(Number.isFinite),o.name+' has nonfinite positions');
    if(n)for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.0005,o.name+' has invalid surface normal');
  });
});
test('Full suspension travel is represented directly, without shrinking or visually clamping tyres',()=>{
  for(const length of [.24,.255,.28,.32,.37,.41])for(const steer of [-.49,-.245,0,.245,.49]){
    const states=car.wheels.map(w=>({position:{x:w.side*.89,y:.06-length,z:w.z},steer:w.z>0?steer:0,rotation:.43,suspensionLength:length}));
    car.update({wheelStates:states,contactCount:4,suctionEnabled:true,sealQuality:1},1/60);
    car.wheels.forEach((w,i)=>{
      assert.equal(w.assembly.position.y,.06-length);
      assert.equal(w.assembly.rotation.y,states[i].steer);
      assert.equal(w.tire.scale.x,1);assert.equal(w.tire.scale.y,1);assert.equal(w.tire.scale.z,1);
    });
  }
});
test('Whole tyre sweep clears arch, roof, inner wheelhouse and isolated thrust duct',()=>{
  // Uses the actual tyre profile used by LatheGeometry, not just its centre.
  // Includes both shoulders, steering extremes, all four corners and six
  // suspension lengths. The envelope tests the liner before the outer paint.
  for(const w of car.wheels)for(const length of [.24,.255,.28,.32,.37,.41])for(let j=0;j<=10;j++){
    const steer=w.z>0?-.49+j*.098:0,c=Math.cos(steer),s=Math.sin(steer);
    for(const [r,axial] of w.tyreProfile)for(let k=0;k<96;k++){
      const a=k*Math.PI*2/96,x0=-axial,z0=r*Math.sin(a),y=.06-length+r*Math.cos(a);
      const x=w.side*.89+x0*c+z0*s,z=w.z-x0*s+z0*c,absX=Math.abs(x);
      sweepSamples++;
      minWheelhouseWall=Math.min(minWheelhouseWall,absX-.54);
      if(y>=-.315&&absX>=.54){
        const rz=G.archLongRadius-.003,ry=G.archVerticalRadius-.003;
        const q=((z-w.z)/rz)**2+((y-G.archCentreY)/ry)**2;
        const archMargin=(1-Math.sqrt(q))*Math.min(rz,ry);
        minArchMargin=Math.min(minArchMargin,archMargin);
        const body=sampleVehicleSurface(x,z);
        if(absX<body.outerX){
          const roofMargin=body.bodyY-.016-y;
          minRoofMargin=Math.min(minRoofMargin,roofMargin);
          assert.ok(roofMargin>.012,`roof interference: wheel=${w.assembly.name} L=${length} steer=${steer} margin=${roofMargin}`);
        }
        assert.ok(archMargin>.012,`arch interference: wheel=${w.assembly.name} L=${length} steer=${steer} margin=${archMargin}`);
      }
      if(y>-.335&&y<-.215){
        const nozzleMargin=Math.hypot(x-w.side*.59,z-w.z)-.103;
        minJetMargin=Math.min(minJetMargin,nozzleMargin);
        assert.ok(nozzleMargin>.025,'tyre intersects isolated lift nozzle collar');
      }
    }
  }
  assert.ok(minWheelhouseWall>.045,'steered tyre intersects inner wheelhouse bulkhead');
});
test('Continuous pressure chamber has an airtight roof, isolated wheel/jet cutouts and surface-following seal',()=>{
  const data=car.chamber.root.userData;
  assert.ok(data.projectedAreaM2>=data.effectiveSimulationAreaM2);
  assert.equal(data.wheelAndJetDuctsIsolated,true);
  assert.ok(data.perimeterXZ.length>=20);
  car.update({contactCount:4,suctionEnabled:true,sealQuality:1},.1);
  for(let i=0;i<30;i++)car.update({contactCount:4,suctionEnabled:true,sealQuality:1},.1);
  assert.ok(car.chamber.skirt.userData.extensionMetres>.254);
  for(let i=0;i<30;i++)car.update({contactCount:0,suctionEnabled:true,sealQuality:0},.1);
  assert.ok(car.chamber.skirt.userData.extensionMetres<.075);
  car.setCutaway(true);assert.equal(car.chamber.roof.visible,false);
  car.setCutaway(false);assert.equal(car.chamber.roof.visible,true);
});
test('Cabin glazing, body aperture, individual LED lenses and suspension articulation exist',()=>{
  const names=[];car.group.traverse(o=>{names.push(o.name,...o.userData.parts||[]);});
  for(const match of ['front clamshell','rear clamshell','single-seat cockpit','individual LED projector','deep sealed wheelhouse liner','gold inboard coil spring','lower wishbone','continuous airtight chamber roof'])assert.ok(names.some(n=>n.includes(match)),match);
  assert.equal(car.materials.glass.transparent,true);
  assert.equal(car.materials.glass.depthWrite,false);
  assert.equal(car.suspensions.length,4);
});
test('Pressed door has interior surface samples and each lamp is an actual opening in paint',()=>{
  const holes=[-1,1].map(s=>[[s*.679,2.120],[s*.886,1.793],[s*.749,1.746]]);
  const inTriangle=(x,z,t)=>{const d=t.map((a,i)=>{const b=t[(i+1)%3];return(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);});return d.every(v=>v>1e-7)||d.every(v=>v< -1e-7);};
  let sideSamples=0,paintInLamps=0;
  car.group.traverse(o=>{
    if(!o.isMesh||o.material!==car.materials.paint)return;
    const p=o.geometry.attributes.position,idx=o.geometry.index;
    for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))>.85&&Math.abs(p.getZ(i))<.15&&Math.abs(p.getY(i))<.15)sideSamples++;
    if(!idx)return;
    for(let i=0;i<idx.count;i+=3){const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)],x=ids.reduce((s,j)=>s+p.getX(j),0)/3,y=ids.reduce((s,j)=>s+p.getY(j),0)/3,z=ids.reduce((s,j)=>s+p.getZ(j),0)/3;
      if(holes.some(h=>inTriangle(x,z,h))&&Math.abs(y-sampleVehicleSurface(x,z).bodyY)<.006)paintInLamps++;
    }
  });
  assert.ok(sideSamples>100,'side body is only a boundary-triangulated flat sheet');
  assert.equal(paintInLamps,0,'paint still covers a recessed headlight opening');
  const names=[];car.group.traverse(o=>names.push(o.name,...o.userData.parts||[]));
  for(const name of ['recessed headlamp bevel','compound curved windscreen','flush sculpted roof rail','landscape cabin display glass','bucket seat sculpted backrest','sculpted rear painted apron'])assert.ok(names.some(n=>n.includes(name)),name);
});
test('All 20 physical seal segments and interpolation correction survive exterior rebuilding',()=>{
  const e=SEAL_OUTLINE.map((_,i)=>.10+i*.012),contacts=SEAL_OUTLINE.map(([x,z],i)=>({point:{x,y:SKIRT_BASE_Y-e[i],z},normal:{x:0,y:1,z:0},distance:e[i]}));
  car.update({sealLipExtensions:e,sealLipContacts:contacts,position:{x:0,y:-.012,z:0},quaternion:{x:0,y:0,z:0,w:1}},1/60);
  for(const mesh of car.chamber.skirt.children){
    const a=mesh.geometry?.attributes.position;if(!a)continue;
    const rows=60,width=a.count/(rows+1);
    for(let j=0;j<=rows;j++){
      const sample=(j/rows*20)%20,k=Math.floor(sample),f=sample-k,expected=(1-f)*Math.min(SKIRT_MAX_EXTENSION,Math.max(.04,e[k]-.012))+f*Math.min(SKIRT_MAX_EXTENSION,Math.max(.04,e[(k+1)%20]-.012));
      assert.ok(Math.abs(a.getY(j*width+width-1)+expected)<1e-6,'seal lip ignores physical perimeter or rendered pose correction');
    }
  }
});
const profiles={},glassSeams={},poseBefore={group:car.group.uuid,wheels:car.wheels.map(w=>({assembly:w.assembly.uuid,position:w.assembly.position.toArray(),rotation:w.spin.rotation.toArray()}))};
test('Render profiles reduce actual geometry and preserve articulated object identities and state',()=>{
  car.setCutaway(false);
  for(const quality of ['balanced','high','ultra']){
    car.setQuality(quality);profiles[quality]={atRest:car.getRenderCost()};
    assert.equal(car.group.uuid,poseBefore.group);
    car.wheels.forEach((w,i)=>{assert.equal(w.assembly.uuid,poseBefore.wheels[i].assembly);assert.deepEqual(w.assembly.position.toArray(),poseBefore.wheels[i].position);assert.deepEqual(w.spin.rotation.toArray(),poseBefore.wheels[i].rotation);});
    car.group.traverse(o=>{
      if(!o.geometry)return;const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;
      assert.ok(p.array.every(Number.isFinite),quality+': '+o.name+' has nonfinite positions');
      if(n)for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.0005,quality+': '+o.name+' has invalid normals');
    });
  }
  assert.ok(profiles.balanced.atRest.drawables<profiles.high.atRest.drawables*.60,'balanced keeps too many visible model parts');
  assert.ok(profiles.balanced.atRest.triangles<profiles.high.atRest.triangles*.30,'balanced retains the high-detail triangle budget');
  assert.ok(profiles.ultra.atRest.triangles>profiles.high.atRest.triangles,'ultra does not refine curved body and wheel surfaces');
});
test('Separate glazing panels share continuous derivative normals at every quality',()=>{
  for(const quality of ['balanced','high','ultra']){
    car.setQuality(quality);let pairs=0,maximumAngleDeg=0;
    car.group.traverse(o=>{
      if(!o.isMesh||![car.materials.glass,car.materials.balancedGlass].includes(o.material))return;
      const p=o.geometry.attributes.position,n=o.geometry.attributes.normal,seen=new Map();
      for(let i=0;i<p.count;i++){
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
        if(Math.abs(x)>.5||![.04,-.76].some(v=>Math.abs(z-v)<1e-6))continue;
        const key=[x,y,z].map(v=>v.toFixed(6)).join(':');
        if(seen.has(key)){const j=seen.get(key),dot=n.getX(i)*n.getX(j)+n.getY(i)*n.getY(j)+n.getZ(i)*n.getZ(j);maximumAngleDeg=Math.max(maximumAngleDeg,Math.acos(Math.min(1,Math.max(-1,dot)))*180/Math.PI);pairs++;}
        else seen.set(key,i);
      }
    });
    assert.ok(pairs>20,quality+' is missing adjoining glazing samples');
    assert.ok(maximumAngleDeg<.05,quality+' glazing produces a reflection seam');
    glassSeams[quality]={coincidentBoundaryPairs:pairs,maximumNormalAngleDeg:maximumAngleDeg};
  }
});
test('Balanced cutaway reveals real hardware and an unchanged seal does not rebuild its mesh',()=>{
  car.setQuality('balanced');assert.ok(car.suspensions.every(s=>!s.group.visible));
  car.setCutaway(true);assert.ok(car.suspensions.every(s=>s.group.visible));assert.equal(car.chamber.roof.visible,false);
  car.setCutaway(false);assert.ok(car.suspensions.every(s=>!s.group.visible));assert.equal(car.chamber.roof.visible,true);
  const telemetry={sealLipExtensions:SEAL_OUTLINE.map(()=>.18)};
  car.update(telemetry,1/60);const before=car.chamber.root.userData.sealGeometryUpdates;
  for(let i=0;i<120;i++)car.update(telemetry,1/60);
  assert.equal(car.chamber.root.userData.sealGeometryUpdates,before,'stationary lip rebuilt every render frame');
  telemetry.sealLipExtensions[7]=.19;car.update(telemetry,1/60);
  assert.equal(car.chamber.root.userData.sealGeometryUpdates,before+1,'changed physical seal segment did not update the mesh');
});
test('Late-created force nozzles use the selected profile and switching back reuses cached geometry',()=>{
  const nozzles=[];for(let i=0;i<10;i++)nozzles.push({id:'audit-'+i,kind:i<4?'lift':i<8?'roll':'longitudinal',position:{x:i%2?.59:-.59,y:-.29,z:i%4<2?1.42:-1.42},direction:{x:i<4?0:i<8?(i%2?1:-1):0,y:i<4?1:0,z:i>=8?(i===8?1:-1):0},force:1000,maxForce:8000});
  car.setQuality('balanced');car.update({nozzles,mode:'hover'},1/60);
  const cached=new Map();car.group.traverse(o=>{if(o.geometry)cached.set(o.uuid,o.geometry.uuid);});
  for(const quality of ['high','ultra','balanced']){
    car.setQuality(quality);profiles[quality].forceNozzles=car.getRenderCost();
    car.setCutaway(true);profiles[quality].cutaway=car.getRenderCost();car.setCutaway(false);
  }
  car.group.traverse(o=>{if(o.geometry)assert.equal(o.geometry.uuid,cached.get(o.uuid),'quality toggle allocated a duplicate geometry');});
  assert.equal(car.getRenderCost().shadowMeshes,5,'balanced must retain one body and four tyre shadow silhouettes');
  car.group.traverseVisible(o=>{if(o.castShadow)assert.ok([car.materials.paint,car.materials.balancedPaint,car.materials.rubber].includes(o.material),'small hardware ignored balanced shadow profile');});
  car.setColor(0xff8877);assert.equal(car.materials.paint.color.getHex(),car.materials.balancedPaint.color.getHex());
});
const renderBaseline=JSON.parse(readFileSync(fileURLToPath(new URL('../qa/vehicle-3.4-render-cost.json',import.meta.url)),'utf8'));
const renderAudit={status:'passed',asOf:new Date().toISOString(),method:renderBaseline.method,baselineCommit:renderBaseline.commit,baseline:{atRest:renderBaseline.atRest,forceNozzles:renderBaseline.forceNozzles,cutaway:renderBaseline.cutaway},profiles,glazingBoundaryNormals:glassSeams,balancedReductionAtRest:{visibleDrawables:1-profiles.balanced.atRest.drawables/renderBaseline.atRest.drawables,triangles:1-profiles.balanced.atRest.triangles/renderBaseline.atRest.triangles},limitations:['Static scene-graph budgets do not establish frame rate. Driver overhead, shadows, culling, reflections, resolution and GPU throughput require browser profiling.','The ten-visible-actuator comparison fixture is a conservative hardware visibility budget; it does not simulate a flight maneuver.']};
writeFileSync(fileURLToPath(new URL('../qa/vehicle-3.7-render-cost.json',import.meta.url)),JSON.stringify(renderAudit,null,2)+'\n');
const report={status:'passed',asOf:new Date().toISOString(),model:'Roadster photograph reconstruction v5',geometry:{meshes,vertices},profiles,glazingBoundaryNormals:glassSeams,sweep:{samples:sweepSamples,lengthRangeM:[.24,.41],frontSteerRangeRad:[-.49,.49],tyreRadiusM:.372,minimumArchLinerMarginM:minArchMargin,minimumRoofMarginM:minRoofMargin,minimumInnerWallMarginM:minWheelhouseWall,minimumLiftDuctMarginM:minJetMargin},pressureChamber:car.chamber.root.userData,tests:results,limitations:['A sampled geometric clearance test, not a tolerance stack-up or deformable tyre contact analysis.','Suspension links and pressure chamber are independently authored layouts, not OEM CAD or measured suspension kinematics.','Full tyre travel envelope is guaranteed only for the stated suspension and steering range.']};
writeFileSync(fileURLToPath(new URL('../qa/vehicle-geometry.json',import.meta.url)),JSON.stringify(report,null,2)+'\n');
car.dispose();
console.log(JSON.stringify(report,null,2));
