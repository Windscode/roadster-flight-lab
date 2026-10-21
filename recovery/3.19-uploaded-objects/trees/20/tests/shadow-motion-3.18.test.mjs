import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createCityPracticalLights} from '../dist/city-practical-lights.js';
import {createCityPracticalLights as retained317} from '../qa/fixtures/city-practical-lights-3.17.mjs';
import {createWindLaboratory} from '../dist/wind-laboratory.js';
import {createEnvironment} from '../dist/city-environment.js';
import {RoadsterSim} from '../dist/physics.js';
import {createShadowMotionTracker} from '../dist/shadow-motion.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex'),checks=[],folder=new URL(`../qa/shadow-motion-${REPORT_VERSION}/`,import.meta.url);
mkdirSync(folder,{recursive:true});
const check=async(name,fn)=>{try{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS '+name);}catch(error){checks.push({name,status:'failed',error:{message:error.message,stack:error.stack}});console.error('FAIL '+name,error.message);}};
const provenance=JSON.parse(readFileSync(new URL('../qa/fixtures/city-practical-lights-3.17.provenance.json',import.meta.url)));
assert.equal(sha(readFileSync(new URL('../qa/fixtures/city-practical-lights-3.17.mjs',import.meta.url))),provenance.fixtureSHA256);

function headlampSequence(factory,quality){
  const scene=new THREE.Scene(),vehicle=new THREE.Group(),camera=new THREE.PerspectiveCamera(48,16/9,.1,100),lamp=factory(scene,[]),rows=[];
  scene.add(vehicle,camera);vehicle.userData.lampMode='low-beam';lamp.setVehicleRoot(vehicle);lamp.configure(quality);lamp.setEnabled(true);
  for(let frame=0;frame<=240;frame++){
    const time=frame/120;vehicle.position.set(Math.sin(time*.4)*3,.62,20*time);vehicle.quaternion.setFromEuler(new THREE.Euler(.04*Math.sin(time),.8*time,0));vehicle.updateMatrixWorld(true);
    camera.position.copy(vehicle.position).add(new THREE.Vector3(0,3,-8));camera.lookAt(vehicle.position);camera.updateMatrixWorld(true);
    lamp.update(time,camera.position,camera);const refreshed=lamp.wantsShadowUpdate(time,{casterChanged:true});scene.updateMatrixWorld(true);
    const lights=lamp.getLights().filter(l=>l.name.startsWith('Roadster'));
    if(refreshed)for(const light of lights){light.shadow.updateMatrices(light);light.shadow.needsUpdate=false;}
    const errors=lights.map(light=>({position:light.position.distanceTo(light.shadow.camera.position),direction:1-new THREE.Vector3().subVectors(light.target.position,light.position).normalize().dot(light.shadow.camera.getWorldDirection(new THREE.Vector3()))}));
    rows.push({frame,time,refreshed,maxStaleCameraPositionM:Math.max(0,...errors.map(e=>e.position)),maxStaleDirectionError:Math.max(0,...errors.map(e=>e.direction)),actualShadowMaps:lights.length});
  }
  lamp.dispose();return {quality,frames:rows.length,staleFrames:rows.filter(r=>r.maxStaleCameraPositionM>1e-8||r.maxStaleDirectionError>1e-9).length,maxStaleCameraPositionM:Math.max(...rows.map(r=>r.maxStaleCameraPositionM)),rows};
}
await check('Moving and turning headlamps use depth cameras from the same displayed pose at 120 Hz',()=>{
  const comparisons=[];
  for(const quality of ['balanced','high','ultra']){
    const before=headlampSequence(retained317,quality),after=headlampSequence(createCityPracticalLights,quality);
    assert.ok(before.staleFrames>100,'Retained scheduling counterexample no longer reproduces');assert.equal(after.staleFrames,0);assert.ok(after.rows.every(r=>r.actualShadowMaps>0),'Shadows were disabled');
    writeFileSync(new URL('headlamps-'+quality+'.json',folder),JSON.stringify({before,after},null,2)+'\n');
    comparisons.push({quality,before:{staleFrames:before.staleFrames,maxStaleCameraPositionM:before.maxStaleCameraPositionM},after:{staleFrames:after.staleFrames,maxStaleCameraPositionM:after.maxStaleCameraPositionM}});
  }
  return {comparisons,scope:'Actual Three light/shadow camera matrices and retained 3.17 scheduler; no pixel or target-GPU timing inference.'};
});

await check('A wheel steering change or body turn at fixed position invalidates shadow depth',()=>{
  const tracker=createShadowMotionTracker(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),wheelStates=[{steer:0,suspensionLength:.18,rotation:0}];
  tracker.sample(position,{quaternion,wheelStates});assert.equal(tracker.sample(position,{quaternion,wheelStates}).casterChanged,false);
  wheelStates[0].steer=.1;assert.equal(tracker.sample(position,{quaternion,wheelStates}).casterChanged,true);
  quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.15);assert.equal(tracker.sample(position,{quaternion,wheelStates}).casterChanged,true);
  wheelStates[0].suspensionLength=.15;assert.equal(tracker.sample(position,{quaternion,wheelStates}).casterChanged,true);
  return {motionInputs:['steering','suspension','body rotation'],scope:'Depth invalidation only, separate from the native input/video evidence.'};
});

await check('Laboratory depth projection has an integral texel origin throughout continuous follow motion',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.07,200),lab=createWindLaboratory(scene,null,camera,new RoadsterSim({}, {world:'windlab'}).getWorldGeometry()),key=lab.group.getObjectByName('laboratory broad overhead key approximation'),rows=[];
  for(const quality of ['balanced','high','ultra']){
    lab.setQuality(quality);let maxFraction=0,maxDirectionChange=0;const initial=new THREE.Vector3();
    for(let frame=0;frame<160;frame++){
      const p=new THREE.Vector3(-3+frame*.037,.65,Math.sin(frame*.02)*4),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),frame*.006);
      assert.equal(lab.wantsShadowUpdate(frame/120,p,{quaternion:q}),true);scene.updateMatrixWorld(true);key.shadow.updateMatrices(key);
      const lightOrigin=new THREE.Vector3().applyMatrix4(key.shadow.camera.matrixWorldInverse),tx=(key.shadow.camera.right-key.shadow.camera.left)/key.shadow.mapSize.x,ty=(key.shadow.camera.top-key.shadow.camera.bottom)/key.shadow.mapSize.y;
      const fraction=Math.max(Math.abs(lightOrigin.x/tx-Math.round(lightOrigin.x/tx)),Math.abs(lightOrigin.y/ty-Math.round(lightOrigin.y/ty)));maxFraction=Math.max(maxFraction,fraction);
      const direction=key.shadow.camera.getWorldDirection(new THREE.Vector3());if(frame===0)initial.copy(direction);maxDirectionChange=Math.max(maxDirectionChange,direction.distanceTo(initial));
      assert.ok(key.castShadow);assert.ok(key.shadow.bias!==0);assert.ok(fraction<1e-8,'Fractional light-space depth origin '+fraction);
    }
    assert.ok(maxDirectionChange<1e-10);rows.push({quality,maxFraction,maxDirectionChange,shadowSize:key.shadow.mapSize.x,normalBias:key.shadow.normalBias});
  }
  lab.dispose();return {rows,scope:'Independent coordinate projection of actual shadow cameras. Does not prove absence of all temporal aliasing.'};
});

await check('Daylight camera rotations and vehicle motion refresh cascades while wet night keeps real practical shadows',async()=>{
  const oldFetch=globalThis.fetch;globalThis.fetch=async url=>{try{const b=readFileSync(url);return{ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return{ok:false};}};
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem},env=createEnvironment(scene,renderer,new RoadsterSim().getWorldGeometry(),camera),vehicle=new THREE.Group(),p=new THREE.Vector3(-200,.65,-345),q=new THREE.Quaternion(),rows=[];
  scene.add(vehicle);env.setVehicleRoot(vehicle);await env.ready;
  try{
    for(const weather of ['clear-day','wet-night','clear-day']){
      env.setWeatherPreset(weather);env.setQuality('high');
      for(let frame=0;frame<30;frame++){
        const time=10+rows.length/120;p.z+=.03;vehicle.position.copy(p);vehicle.quaternion.copy(q);vehicle.updateMatrixWorld(true);
        camera.position.copy(p).add(new THREE.Vector3(Math.sin(frame*.02)*7,3,-8));camera.lookAt(p);camera.updateMatrixWorld(true);env.update(time,p);
        const refresh=env.wantsShadowUpdate(time,p,{quaternion:q});assert.equal(refresh,true);
        if(weather==='clear-day')assert.ok(scene.children.filter(l=>l.isDirectionalLight&&l.castShadow).length>=2);
        else {assert.equal(scene.children.filter(l=>l.isDirectionalLight&&l.castShadow).length,0);assert.ok(env.stats.renderBudget.practicalLights.headlightSpots>0);}
        rows.push({weather,frame,refresh,cascades:env.stats.shadowCascades,spotShadowMaps:env.stats.renderBudget.spotShadowMaps,motion:{...env.stats.renderBudget.shadowMotion}});
      }
    }
  }finally{globalThis.fetch=oldFetch;const resources=new Set();scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])resources.add(m);});for(const resource of resources)resource.dispose?.();}
  writeFileSync(new URL('city-camera-weather.json',folder),JSON.stringify(rows,null,2)+'\n');return {frames:rows.length,scope:'Real environment scheduler, light owners, weather transitions and matrices; GPU sampling remains a separate native observation.'};
});

const sourceFiles=['dist/shadow-motion.js','dist/city-environment.js','dist/city-practical-lights.js','dist/wind-laboratory.js','dist/main.js','dist/receiver-plane-shadows.js','dist/city-render-budget.js'];
const report={schema:'roadster-shadow-motion-3.18',createdAt:new Date().toISOString(),status:checks.every(c=>c.status==='passed')?'passed':'failed',baseline:provenance,checks,sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,sha(readFileSync(new URL('../'+f,import.meta.url)))])),limits:['No normal map, shadow caster or shadow receiver is disabled by this repair.','Resolution, bias, retained receiver-plane correction and CSM fade remain independent quality limits.','This report verifies the reproduced scheduling and projection faults. Native video and user-GPU observation are separate; no universal flicker-free claim.']};
writeFileSync(new URL('report.json',folder),JSON.stringify(report,null,2)+'\n');if(report.status!=='passed')process.exitCode=1;
