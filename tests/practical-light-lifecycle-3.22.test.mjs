import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCityPracticalLights,CITY_PRACTICAL_LIGHT_BUDGET} from '../dist/city-practical-lights.js';

const results=[];
const anchors=Array.from({length:9},(_,i)=>({id:'lamp-'+i,position:[0,9,i*12-24],target:[0,0,i*12-24],range:32,intensity:1500}));
function fixture(){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,16/9,.1,100),lights=createCityPracticalLights(scene,anchors);
  let time=0;lights.setEnabled(true);
  function step({advance=1/60}={}){
    time+=advance;camera.updateMatrixWorld(true);lights.update(time,camera.position,camera);
    const refresh=lights.wantsShadowUpdate(time);scene.updateMatrixWorld(true);
    if(refresh)for(const light of lights.getLights())if(light.shadow.needsUpdate){light.shadow.updateMatrices(light);light.shadow.needsUpdate=false;}
    return refresh;
  }
  function settle(quality,z){
    lights.configure(quality);camera.position.set(0,2,z);camera.lookAt(0,2,z+1);
    for(let i=0;i<300;i++)step();
    return lights.stats.selected.map(row=>row.id);
  }
  return {scene,camera,lights,step,settle};
}

// Selection moves while fewer slots are available. The restored slots must
// join the current selection, not revive fixtures now owned by another slot.
{
  const f=fixture(),rows=[];
  for(const [quality,z] of [['high',0],['balanced',12],['high',12],['ultra',24],['balanced',0],['ultra',0],['high',36],['balanced',12],['high',12]]){
    const selected=f.settle(quality,z),budget=CITY_PRACTICAL_LIGHT_BUDGET[quality];
    assert.equal(new Set(selected).size,selected.length,`${quality} at ${z}: duplicated fixture ${selected}`);
    assert.ok(selected.length>=Math.min(3,budget.street)&&selected.length<=budget.street,'Keep nearby lighting within the selected quality budget');
    assert.ok(f.lights.getLights().every(light=>light.castShadow),'Real practical shadows must remain enabled');
    rows.push({quality,z,selected,shadowMaps:f.lights.stats.shadowMaps});
  }
  f.lights.dispose();results.push({name:'unique occupied fixtures across quality changes and camera movement',rows});
}

// Check every displayed frame, including an outgoing light's nonzero fade.
// The final settled selection alone misses a newly restored slot reclaiming
// a fixture that another slot is still visibly fading out.
{
  const f=fixture();let seed=7713,quality='balanced',maximumSpots=0,qualityChanges=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let frame=0;frame<900;frame++){
    if(frame%7===0){
      quality=['balanced','high','ultra'][Math.floor(random()*3)];f.lights.configure(quality);qualityChanges++;
      const z=random()*72-12;f.camera.position.set(0,2,z);f.camera.lookAt(0,2,z+(random()>.5?10:-10));
    }
    f.step();const selected=f.lights.stats.selected,ids=selected.map(row=>row.id);
    assert.equal(new Set(ids).size,ids.length,`Frame ${frame}: outgoing fixture selected twice: ${ids}`);
    assert.ok(selected.every(row=>Number.isFinite(row.gain)&&row.gain>=0&&row.gain<=1));
    assert.ok(selected.length<=CITY_PRACTICAL_LIGHT_BUDGET[quality].street);
    maximumSpots=Math.max(maximumSpots,selected.length);
  }
  f.lights.dispose();results.push({name:'per-frame unique ownership during rapid camera/quality crossfades',seed:7713,frames:900,qualityChanges,maximumSpots});
}

// With lamps off, vehicle pose tracking continues but headlamp depth does not.
// Relighting without another movement must refresh the old depth immediately.
for(const quality of ['balanced','high','ultra']){
  const f=fixture(),vehicle=new THREE.Group();f.scene.add(vehicle);vehicle.userData.lampMode='low-beam';f.lights.setVehicleRoot(vehicle);f.settle(quality,0);
  const heads=f.lights.getLights().filter(light=>light.name.startsWith('Roadster'));
  assert.equal(heads.length,CITY_PRACTICAL_LIGHT_BUDGET[quality].heads);
  const initialDepthPositions=heads.map(light=>light.shadow.camera.position.clone());
  vehicle.userData.lampMode='off';vehicle.position.set(2,0,6);vehicle.rotation.y=.4;
  for(let frame=0;frame<8;frame++)f.step();
  assert.equal(f.lights.getLights().filter(light=>light.name.startsWith('Roadster')).length,0);
  assert.ok(heads.every((light,i)=>light.shadow.camera.position.equals(initialDepthPositions[i])),'An off lamp must not consume a depth refresh');
  vehicle.userData.lampMode='low-beam';const refresh=f.step();
  assert.equal(refresh,true,'Relighting a stationary car must invalidate old headlamp depth');
  const errors=heads.map(light=>({position:light.position.distanceTo(light.shadow.camera.position),direction:1-new THREE.Vector3().subVectors(light.target.position,light.position).normalize().dot(light.shadow.camera.getWorldDirection(new THREE.Vector3()))}));
  assert.ok(errors.every(error=>error.position<1e-9&&Math.abs(error.direction)<1e-9),'Depth camera must match the new light pose');
  // Once serviced, a stationary unchanged frame must not become a permanent
  // full-rate shadow refresh merely because its headlamps are enabled.
  assert.equal(f.step(),false);
  f.lights.setVehicleRoot(null);f.step();
  assert.equal(f.lights.stats.headlightSpots,0);
  assert.ok(f.lights.getLights().every(light=>!light.name.startsWith('Roadster')),'Removing a vehicle must remove its live beams');
  f.lights.dispose();results.push({name:'headlamp off/move/on and vehicle detach',quality,refresh,errors});
}

const report={schema:'roadster-practical-light-lifecycle-3.22',status:'passed',scope:'Actual Three.js light selection, light transforms and shadow camera matrices; no GPU pixels, FPS or universal shadow-flicker acceptance.',results};
mkdirSync('qa/rendering-3.22',{recursive:true});writeFileSync('qa/rendering-3.22/practical-light-lifecycle.json',JSON.stringify(report,null,2)+'\n');
console.log('PASS practical-light lifecycle: unique fixtures, same-frame relighting depth, bounded idle updates and vehicle detach');
