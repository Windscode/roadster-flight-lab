import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {advanceChasePosition,cameraClearanceRadius,resolveCameraObstruction} from '../dist/chase-camera.js';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import * as THREE from '../dist/vendor/three.module.js';
import {OrbitControls} from '../dist/vendor/addons/controls/OrbitControls.js';
import {sampleQuickRollHeadroom} from '../dist/vehicle-clearance.js';

const checks=[],evidence={};
const check=(name,run)=>{run();checks.push({name,status:'passed'});console.log('PASS: '+name);};
const close=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,`${a} vs ${b}`);
const box=(id,size,position,quaternion=[0,0,0,1])=>({id,type:'box',kind:'fixture',size,position,quaternion});
const flat=()=>{const sim=new RoadsterSim();for(const b of [...sim.world.bodies])if(b!==sim.body&&b.userData?.id!=='ground')sim.world.removeBody(b);sim.geometry=sim.geometry.filter(g=>g.id==='ground');sim.reset('free');return sim;};
const settle=sim=>{for(let i=0;i<180;i++)assert.equal(sim.advanceFixed({}).fault,null);};

check('Shared collision boxes retract both camera uses before the near plane intersects a wall',()=>{
  const target={x:0,y:1,z:0},desired={x:0,y:1,z:-8},geometry=[box('wall',[20,10,.4],[0,3,-5])],parameters={near:.08,fov:60,aspect:16/9};
  const before=JSON.stringify({target,desired,geometry}),r=resolveCameraObstruction({target,desired,geometry,...parameters}),radius=cameraClearanceRadius(parameters);
  assert.equal(r.hit.objectId,'wall');close(r.distanceM,4.8-radius-.025);assert.ok(-r.position.z+radius<4.8);assert.equal(JSON.stringify({target,desired,geometry}),before);
  // A pole misses the optical centre line but intersects a near-plane corner.
  const nearPlaneOnly=resolveCameraObstruction({target,desired,geometry:[box('narrow-post',[.08,3,.12],[.15,1.5,-4])],near:.1,fov:70,aspect:16/9});
  assert.equal(nearPlaneOnly.obstructed,true);assert.equal(nearPlaneOnly.hit.objectId,'narrow-post');
  const offsetRadius=cameraClearanceRadius({...parameters,viewOffsetFraction:.4});assert.ok(offsetRadius>radius);
  evidence.wall={...r,centreLineMissNearPlaneHit:nearPlaneOnly,offAxisNearPlaneRadiusM:offsetRadius};
});

check('Thin-post release uses time hysteresis without skipping the post or repeatedly snapping out',()=>{
  const target={x:0,y:1,z:0},desired={x:0,y:1,z:-8},post=box('post',[.12,3,.12],[0,1.5,-3]);let state=null;const rows=[];
  for(let frame=0;frame<180;frame++){
    const present=frame<30&&frame%2===0,r=resolveCameraObstruction({target,desired,geometry:present?[post]:[],previous:state,dt:1/60});state=r.state;rows.push({frame,postPresent:present,distanceM:r.distanceM});
    if(present)assert.ok(r.distanceM<3);if(frame>0&&frame<30)assert.ok(Math.abs(rows[frame].distanceM-rows[frame-1].distanceM)<.02);
  }
  assert.ok(rows.at(-1).distanceM>7.99);assert.ok(rows.slice(30).every((row,i,arr)=>i===0||row.distanceM>=arr[i-1].distanceM-1e-10));
  assert.ok(Math.max(...rows.slice(31).map((row,i)=>row.distanceM-rows[i+30].distanceM))<.4);
  evidence.thinPost={rows,releaseHoldS:.18,releaseRatePerS:3.5,implementationCounterexample:{initialHoldOnlyOnRetraction:true,alternatingPost30FramesMaximumJumpM:.29854256458883244,fix:'Refresh the release hold while the same nearest blocker still constrains distance; original <0.02 m frame-jump assertion retained'}};
});

check('Narrow corridor, overhead deck, reverse approach and turning fixtures preserve physical inputs',()=>{
  const geometry=[box('left-wall',[.5,9,40],[-3,4,-10]),box('right-wall',[.5,9,40],[3,4,-10]),box('bridge',[10,.5,6],[0,3.5,-7]),box('rear-wall',[6,9,.5],[0,4,-20])];
  const rows=[];let previous={x:0,y:.6,z:1},camera={x:0,y:2.8,z:-5.7},wanted={...camera},state=null;
  for(let i=0;i<300;i++){
    const phase=i/300,vehicle={x:Math.sin(phase*Math.PI)*.8,y:.6+1.1*Math.sin(phase*Math.PI),z:1-17*phase},heading=Math.sin(phase*2*Math.PI)*.5,offset={x:-Math.sin(heading)*6.7,y:2.2,z:-Math.cos(heading)*6.7};
    const desired=advanceChasePosition(wanted,vehicle,previous,offset,1/60),target={...vehicle,y:vehicle.y+.4},saved=JSON.stringify({vehicle,previous,geometry});
    const result=resolveCameraObstruction({target,desired,geometry,previous:state,dt:1/60});assert.equal(JSON.stringify({vehicle,previous,geometry}),saved);
    assert.ok([result.position.x,result.position.y,result.position.z,result.distanceM].every(Number.isFinite));assert.ok(result.distanceM<=result.desiredDistanceM+1e-8);camera=result.position;wanted=desired;state=result.state;previous=vehicle;
    rows.push({step:i,target,camera,obstacle:result.hit?.objectId??null,distanceM:result.distanceM});
  }
  assert.ok(rows.some(r=>r.obstacle==='bridge'));assert.ok(rows.some(r=>r.obstacle==='rear-wall'));
  const paddingExit=resolveCameraObstruction({target:{x:0,y:1,z:0},desired:{x:-5,y:2,z:0},geometry:[box('near-side-wall',[.3,8,20],[.23,4,0])]});assert.equal(paddingExit.obstructed,false,'A look-at anchor in padding outside a solid can move its camera away from that wall');
  const paddingCrossing=resolveCameraObstruction({target:{x:0,y:1,z:0},desired:{x:5,y:2,z:0},geometry:[box('near-side-wall',[.3,8,20],[.23,4,0])]});assert.equal(paddingCrossing.obstructed,true,'Leaving near-wall padding through the solid is still blocked');assert.ok(paddingCrossing.position.x<=.08,'The camera cannot move through the wall when its anchor is already within near-plane padding');
  evidence.paths={paddingExit,paddingCrossing,paddingCounterexample:{beforeCrossingWasIncorrectlyAllowed:true,afterSolidCrossingIsBlocked:true},scope:'Numerical camera target/desired positions only; no human city driving or rendered-wall acceptance',rows};
});


check('Actual vendor OrbitControls rotate an independent desired camera without inventing zoom at an obstruction',()=>{
  const rendered=new THREE.PerspectiveCamera(48,1280/720,.07,2300);rendered.position.set(0,0,1.5);
  const proxy=rendered.clone();proxy.position.set(0,0,8);const controls=new OrbitControls(proxy,null);
  controls.minDistance=3.6;controls.maxDistance=85;controls.enableDamping=true;controls.dampingFactor=.075;
  const beforeRendered=rendered.position.clone(),initialDesired=proxy.position.length();
  controls._sphericalDelta.theta=.1;controls.update();close(proxy.position.length(),initialDesired);assert.deepEqual(rendered.position,beforeRendered);
  controls._scale=.8;controls.update();close(proxy.position.length(),6.4);assert.deepEqual(rendered.position,beforeRendered);
  const result=resolveCameraObstruction({target:{x:0,y:0,z:0},desired:proxy.position,geometry:[box('front-wall',[20,10,.4],[0,0,2])]});
  assert.ok(result.distanceM<3.6);rendered.position.set(result.position.x,result.position.y,result.position.z);close(proxy.position.length(),6.4);
  evidence.orbitProxy={scope:'Actual vendored OrbitControls in Node without DOM input; pointer/keyboard handling still needs browser acceptance',initialRenderedDistanceM:1.5,initialDesiredDistanceM:initialDesired,afterRotationDesiredDistanceM:8,afterExplicitZoomDesiredDistanceM:proxy.position.length(),afterConstraintRenderedDistanceM:rendered.position.length(),regressionBefore:{method:'rendered-radius ratio interpreted as user zoom',rendered1_5mClampedTo3_6mByControls:true,desired8mIncorrectlyBecame19_2m:true}};
});

check('World CG altitude, CG down-ray and estimated physical-envelope distances remain distinct on ground/roof/bridge/tilt',()=>{
  const ground=flat();settle(ground);const g=ground.getClearanceEstimate({directions:['down','up'],includeQuickRoll:false});assert.ok(g.worldCgHeightM>.5&&g.worldCgHeightM<.7);close(g.distances.down.distanceM,0);close(g.centreDownDistanceM,g.worldCgHeightM);assert.equal(g.recoveryHeightM,null);close(g.hullDistances.down.distanceM,g.worldCgHeightM-.25);assert.ok(g.hullDistances.down.distanceM>.3);
  const platform=flat();platform._addBox('raised-deck','fixture',[20,8,20],[0,4,-28]);platform.body.position.y=8.62;settle(platform);const e=platform.getClearanceEstimate({directions:['down'],includeQuickRoll:false});assert.ok(e.worldCgHeightM>8.5);assert.ok(e.centreDownDistanceM<.7);close(e.distances.down.distanceM,0);assert.equal(e.centreDownObjectId,'raised-deck');
  const roof=flat();roof._addBox('roof','building',[20,20,20],[0,10,-28]);roof.body.position.y=20.62;settle(roof);const r=roof.getClearanceEstimate({directions:['down'],includeQuickRoll:false});assert.ok(r.worldCgHeightM>20.5);assert.equal(r.centreDownObjectId,'roof');close(r.distances.down.distanceM,0);
  const bridge=flat();bridge._addBox('bridge','fixture',[10,.5,10],[0,4,-28]);bridge.body.position.y=2.5;bridge.body.quaternion.setFromEuler(0,0,Math.PI/2);const t=bridge.getClearanceEstimate({directions:['down','up'],maxDistance:12});
  close(t.worldCgHeightM,2.5);close(t.centreDownDistanceM,2.5);assert.ok(Math.abs(t.distances.down.distanceM-(t.centreDownDistanceM-.6))>.3,'Tilted envelope is not the CG ray minus a constant');assert.equal(t.distances.up.objectId,'bridge');assert.ok(t.distances.up.distanceM<.3&&t.distances.up.distanceM>0);close(t.quickRollHeadroom.distanceM,1.25);
  const shared=sampleQuickRollHeadroom(bridge.body.position,(o,d,n)=>bridge.traceSurface(o,d,n),12);assert.deepEqual(t.quickRollHeadroom,shared,'Quick-roll preflight and HUD use one shared five-ray implementation');
  assert.equal(g.distances.up.distanceM,null);assert.equal(g.distances.up.availability,'no-surface-in-range');
  evidence.clearance={ground:g,elevated:e,roof:r,tiltedUnderBridge:t};
});

const sources=['dist/chase-camera.js','dist/vehicle-clearance.js','dist/physics.js','dist/main.js','dist/vendor/addons/controls/OrbitControls.js'];
writeFileSync(new URL('../qa/camera-clearance-3.14.json',import.meta.url),JSON.stringify({schema:'roadster-camera-clearance-evidence',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',checks,scope:'Read-only numerical geometry and camera kinematics. Real chase/orbit images, keyboard/focus operation and city-route camera acceptance remain target-browser gates.',sourceHashes:Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')])),evidence},null,2)+'\n');
