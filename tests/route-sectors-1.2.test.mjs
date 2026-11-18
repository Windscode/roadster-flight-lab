import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createRouteSurfacePreset,prepareRouteSurface,routeSurfaceHash} from '../dist/route-surface.js';
import {WeaveRouteTiming,weaveTimingMarks,validSectorRows,WEAVE_STOP_RADIUS_M} from '../dist/route-sectors.js';
import {attachRoadSurface} from '../dist/road-surface-material.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const d=createRouteSurfacePreset(),step=1/120;
function sample(s,i,{speed=12,lane=0,level=0,supported=4}={}){
  const turn=s>247.5;
  return {simTime:i*step,position:{x:-200+(turn?s-247.5:lane),z:-380+Math.min(s,247.5)+(turn?lane:0)},
    contactCount:supported,wheelStates:Array.from({length:4},(_,k)=>({contact:k<supported,contactPointWorld:{y:level}})),
    velocity:{x:turn?speed:0,z:turn?0:speed,y:0},angularVelocity:{x:0,y:0,z:0},rollDeg:0,pitchDeg:0,
    energyKWh:.12-i*.0000001,energyAccounting:{recoveredJ:i*2},onboardGasConsumedKg:i*.0001,externalGasSuppliedKg:0};
}
const marks=weaveTimingMarks(d),material=new THREE.MeshStandardMaterial(),road=attachRoadSurface(material,{});
road.setRouteSurfaceDescription(d);
assert.deepEqual(marks,[{x:-200,z:-320,dx:0,dz:1},{x:-200,z:-200,dx:0,dz:1},{x:-200,z:-145,dx:0,dz:1}]);
assert.deepEqual(road.uniforms.roadGates.value.map(v=>v.toArray()),marks.map(m=>[m.x,m.z,m.dx,m.dz]));
assert.deepEqual(road.uniforms.roadStop.value.toArray(),[-145,-132.5,WEAVE_STOP_RADIUS_M,5]);
road.setRouteSurfaceDescription(null);assert.equal(road.uniforms.roadStop.value.w,0);material.dispose();
const frozen=prepareRouteSurface(d),original=routeSurfaceHash(frozen);d.regions[0].priority+=1;
assert.notEqual(routeSurfaceHash(d),original);assert.ok(Object.isFrozen(frozen.regions[0].bounds));assert.equal(routeSurfaceHash(frozen),original);

const rejected=[];
for(const [id,options] of [['upper deck',{level:12}],['airborne',{supported:0}],['two supporting tyres',{supported:2}],['adjacent lane',{lane:5.1}]]){
  const run=new WeaveRouteTiming(frozen,sample(59.9,0,options));run.observe(sample(60.0,1,options));
  assert.equal(run.rows.length,0);assert.equal(run.missedGate,true);rejected.push(id);
  run.observe(sample(59.96,2));run.observe(sample(60.03,3));assert.equal(run.rows.length,1,'valid forward retry');
  run.observe(sample(59.99,4));run.observe(sample(60.05,5));assert.equal(run.rows.length,1,'a recross cannot double count');
}
for(const [from,to,i] of [[55,60,1],[59.95,60.04,3]]){
  const t=new WeaveRouteTiming(frozen,sample(from,0));t.observe(sample(to,i));assert.equal(t.rows.length,0);
}
const run=new WeaveRouteTiming(frozen,sample(0,0));
for(let i=1;i<=3025;i++)run.observe(sample(i/10,i));
assert.equal(run.rows.length,3);let i=3025;
const stopped=(options={})=>sample(302.5,++i,{speed:0,...options});
const paused=stopped();for(let repeat=0;repeat<120;repeat++)run.observe(paused);
assert.equal(run.finished,false);assert.equal(run.stopSeconds,0);
for(let j=0;j<55;j++)run.observe(stopped());run.observe(stopped({supported:3}));
for(let j=0;j<60;j++)run.observe(stopped());assert.equal(run.finished,false);
run.observe(stopped());assert.equal(run.finished,true);assert.ok(validSectorRows(run.rows));assert.ok(!validSectorRows(run.rows.toReversed()));
assert.ok(Math.abs(run.rows.reduce((s,r)=>s+r.elapsedS,0)-i*step)<1e-10);
const dir='qa/resource-'+REPORT_VERSION;mkdirSync(dir,{recursive:true});
writeFileSync(dir+'/sector-boundaries.json',JSON.stringify({status:'passed',rejected,marks,rows:run.rows,scope:'Controlled timing-boundary samples. Full physically driven and replayed routes are reported separately.'},null,2)+'\n');
console.log('PASS timing line locations, ground/lane support, valid retries, continuous settled stop and immutable descriptors');
