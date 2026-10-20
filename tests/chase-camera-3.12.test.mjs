import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {advanceChasePosition} from '../dist/chase-camera.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';

// The exact world-space update in published 3.11 main.js, isolated from Three.
function previousFollow(current,vehicle,_previous,offset,dt){
  const a=1-Math.exp(-4*dt);
  return Object.fromEntries(['x','y','z'].map(axis=>[axis,current[axis]+(vehicle[axis]+offset[axis]-current[axis])*a]));
}
const distance=speed=>6.7+Math.min(Math.abs(speed)*.045,2.5);
const length=v=>Math.hypot(v.x,v.y,v.z);
function track(follow,{speed=25,fps=60,durationS=5,turnRate=0,drift={x:0,y:0,z:0}}={}){
  const dt=1/fps,d=distance(speed),samples=[];
  const position=time=>({x:(turnRate?speed*(1-Math.cos(turnRate*time))/turnRate:0)+drift.x*time,y:.62+.08*Math.sin(20*time)+drift.y*time,z:(turnRate?speed*Math.sin(turnRate*time)/turnRate:speed*time)+drift.z*time});
  let previous=position(0),camera={x:previous.x,y:previous.y+2.2,z:previous.z-d};
  for(let frame=1;frame<=fps*durationS;frame++){
    const time=frame*dt,vehicle=position(time),heading=turnRate*time,offset={x:-Math.sin(heading)*d,y:2.2,z:-Math.cos(heading)*d};
    const saved=JSON.stringify({vehicle,previous,offset});
    camera=follow(camera,vehicle,previous,offset,dt);
    assert.equal(JSON.stringify({vehicle,previous,offset}),saved,'Camera follow must never change vehicle or target state');
    const relative={x:camera.x-vehicle.x,y:camera.y-vehicle.y,z:camera.z-vehicle.z};
    samples.push({time,camera:{...camera},vehicle:{...vehicle},relative,planarDistanceM:Math.hypot(relative.x,relative.z),rearDistanceM:-(relative.x*Math.sin(heading)+relative.z*Math.cos(heading))});
    previous=vehicle;
  }
  return{last:samples.at(-1),samples,nominalDistanceM:d};
}
const comparisons=[];
for(const speed of [15,25,-15])for(const fps of [30,60,144]){
  const options={speed,fps},before=track(previousFollow,options),after=track(advanceChasePosition,options);
  assert.ok(Math.abs(after.last.rearDistanceM-after.nominalDistanceM)<1e-9,'Constant-speed translation must not alter the specified follow distance');
  assert.ok(Math.abs(before.last.rearDistanceM-before.nominalDistanceM)>3,'The retained 3.11 world-space lag must actually be reproduced');
  assert.equal(after.last.camera.y,before.last.camera.y,'Suspension/vertical filtering must retain the previous response exactly');
  comparisons.push({speedKmh:speed*3.6,fps,nominalDistanceM:after.nominalDistanceM,beforeDistanceM:before.last.rearDistanceM,afterDistanceM:after.last.rearDistanceM});
}

// Add a uniform horizontal translation to the same turn. Relative camera motion
// should be invariant under that transport; the physical heading is unchanged.
const transport=[];
for(const fps of [30,60,144]){
  const base=track(advanceChasePosition,{fps,turnRate:.28}),shift=track(advanceChasePosition,{fps,turnRate:.28,drift:{x:4,y:0,z:-7}});
  let maximumError=0;
  for(let i=0;i<base.samples.length;i++){
    const a=base.samples[i],b=shift.samples[i];
    maximumError=Math.max(maximumError,length({x:a.relative.x-b.relative.x,y:a.relative.y-b.relative.y,z:a.relative.z-b.relative.z}));
  }
  assert.ok(maximumError<1e-9,'Relative framing must not acquire a speed-dependent turn error from horizontal translation');
  transport.push({fps,turnRateRadS:.28,extraTranslationMps:{x:4,z:-7},maximumRelativeErrorM:maximumError});
}
const stopped=track(advanceChasePosition,{speed:0});
assert.equal(stopped.last.rearDistanceM,6.7);
const paused={x:1,y:2,z:3},vehicle={x:0,y:0,z:0};
assert.deepEqual(advanceChasePosition(paused,vehicle,vehicle,{x:0,y:2.2,z:-8},0),paused,'Zero dt with no vehicle translation must not advance the camera');
const sourcePaths=['dist/chase-camera.js','dist/main.js'];
const sourceHashes=Object.fromEntries(sourcePaths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]));
const report={status:'passed',version:MODEL_VERSION,scope:'Deterministic camera kinematics in Node at specified update rates. Not WebGL frames, measured GPU performance, tyre handling or human driving acceptance.',publishedBaseline:{commit:'ab9372b56a01c2a47b18d32baf48162f3cd8f86c',file:'dist/main.js',algorithm:'World-space position.lerp(vehicle + heading offset, 1-exp(-4*dt))'},protocol:{durationS:5,constantSpeedsKmh:[54,90,-54],updateRatesHz:[30,60,144],verticalSignal:'0.62 + 0.08 sin(20t) metres; previous vertical filtering retained',zeroDtScope:'A zero-time/no-translation function call only; actual UI pause keeps calling the camera with wall-clock dt and can continue settling.',physicalStateMutated:false},comparisons,transport,sourceHashes};
mkdirSync(new URL('../qa/',import.meta.url),{recursive:true});
writeFileSync(new URL('../qa/chase-camera-3.12.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('PASS: chase framing preserves its specified distance across speed and update rate; horizontal transport is invariant, vertical filtering and physical state are retained.');
