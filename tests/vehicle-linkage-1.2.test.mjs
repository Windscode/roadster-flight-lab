import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster,VEHICLE_GEOMETRY as G} from '../dist/vehicle.js';
import {soundState} from '../dist/audio.js';
import {RoadsterSim} from '../dist/physics.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const car=createRoadster({inspection:true});car.setQuality('high');car.setCutaway(true);
const point=(o,x=0,y=0,z=0)=>o.localToWorld(new THREE.Vector3(x,y,z));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,a+' differs from '+b);
const pushrodLength=Math.hypot(.84-.45,.09-(.06-.287-.08),.018+.08),heights=[];
const struts=[],rotors=[];car.group.traverse(o=>{if(o.name==='wing actuator')struts.push(o);if(o.name==='extraction fan rotor')rotors.push(o);});
assert.equal(struts.length,2);assert.equal(rotors.length,4);
function verifyWing(){
  for(const s of struts){
    const x=s.userData.mountX;close(point(s,0,-.06,0).distanceTo(point(car.group,x,.264,-2.009)),0);
    close(point(s,0,.06,0).distanceTo(point(car.wing,x,-.007,.057)),0);
  }
}
verifyWing();
for(const travel of [G.suspensionMinimum,.287,.32,G.suspensionMaximum])for(const steer of [-G.maxSteer,0,G.maxSteer]){
  car.update({wheelStates:car.wheels.map(w=>({suspensionLength:travel,steer:w.z>0?steer:0})),wing:{deployment:0,position:{x:0,y:.41,z:-2.09},incidenceRad:-.24}},0);
  verifyWing();
  for(const {group} of car.suspensions){
    const rod=group.getObjectByName('titanium pushrod'),eye=group.getObjectByName('moving spring perch'),shaft=group.getObjectByName('damper shaft'),spring=group.getObjectByName('gold inboard coil spring');
    close(point(rod,0,-.5).distanceTo(point(eye)),0);close(point(rod,0,-.5).distanceTo(point(rod,0,.5)),pushrodLength);
    close(point(shaft,0,.5).distanceTo(point(eye)),0);close(point(shaft,0,-.5).distanceTo(point(eye.parent,0,.19)),0);
    close(spring.position.y,eye.position.y/2);close(spring.scale.y*.34,eye.position.y-.018);assert.ok(shaft.scale.y>0);
    heights.push(eye.position.y);
  }
}
const sim=new RoadsterSim({supplyMode:'bench'});sim.reset('free');
function advanceFan(){
  const t=sim.advanceFixed({},1/120),before=rotors.map(o=>o.rotation.z);car.update(t,1/120);
  for(const [i,r] of rotors.entries())close(r.rotation.z-before[i],36*t.electricalSupply.fanSpinFraction/120);
  return {spin:t.electricalSupply.fanSpinFraction,gain:soundState(t).fanGain};
}
sim.suctionEnabled=true;let powered;for(let i=0;i<45;i++)powered=advanceFan();assert.ok(powered.spin>0&&powered.gain>0);
sim.suctionEnabled=false;const coast=advanceFan();assert.ok(coast.spin>0&&coast.spin<powered.spin&&coast.gain>0);
sim.reset('free');sim.prepareEnergy(0);sim.suctionEnabled=true;const empty=advanceFan();close(empty.spin,0);close(empty.gain,0);
const dir='qa/vehicle-'+REPORT_VERSION;mkdirSync(dir,{recursive:true});writeFileSync(dir+'/articulation.json',JSON.stringify({status:'passed',cornerPoses:heights.length,pushrodLengthM:pushrodLength,springSeatTravelRangeM:[Math.min(...heights),Math.max(...heights)],powered,coast,empty,scope:'Illustrative fixed-length rod and two pivot positions on the rendered mesh. Fan sound verified at signal level.'},null,2)+'\n');
car.dispose();console.log('PASS suspension endpoints, rigid mounts, initial and deployed wing, fan spin and audio');
