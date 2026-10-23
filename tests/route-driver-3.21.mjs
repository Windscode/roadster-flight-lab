// Numerical steering driver, derived from the retained 3.19 route QA policy.
// It emits ordinary fixed-step inputs, never assigns pose after preparation.
// Policies react to trajectories: different styles are not strict controller A/B.
import {roadWheelAngle} from '../dist/vehicle-models.js';
import {createRouteSurfacePreset,routeSurfaceProgress} from '../dist/route-surface.js';
export const DT=1/120;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function prepare(sim,preset='dry-day'){
 const descriptor=createRouteSurfacePreset(preset),p=descriptor.route.start;
 sim.reset('city');sim.setRoadSurface('dry');sim.setRouteSurface(descriptor,{phase:'preparation'});
 sim.body.position.set(p.x,p.y,p.z);sim.body.quaternion.setFromEuler(0,p.yaw,0);sim.body.previousPosition.copy(sim.body.position);sim.body.interpolatedPosition.copy(sim.body.position);sim.body.previousQuaternion.copy(sim.body.quaternion);sim.body.interpolatedQuaternion.copy(sim.body.quaternion);sim.body.aabbNeedsUpdate=true;
 for(let i=0;i<60;i++)sim.advanceFixed({brake:1},DT);
 sim.releasePilotInput('route-preparation');return descriptor;
}
export function driver(style='balanced'){
 const points=[];for(let z=-380;z<=-142;z+=2)points.push({x:-200,z});
 for(let k=1;k<=20;k++){const a=k/20*Math.PI/2;points.push({x:-190.5-9.5*Math.cos(a),z:-142+9.5*Math.sin(a)});}
 for(let x=-188.5;x<=-145;x+=2)points.push({x,z:-132.5});points.push({x:-145,z:-132.5});let targetIndex=0;
 return sim=>{
  const p=sim.body.position;while(targetIndex<points.length-1&&Math.hypot(p.x-points[targetIndex].x,p.z-points[targetIndex].z)<4)targetIndex++;
  const target=points[targetIndex],heading=sim._angles().heading,targetHeading=Math.atan2(target.x-p.x,target.z-p.z),error=Math.atan2(Math.sin(targetHeading-heading),Math.cos(targetHeading-heading));
  const speed=sim.body.velocity.length(),straight=style==='economy'?7:style==='boost'?10:9;
  const sectionSpeed=p.z<-165?straight:p.x<-185?3.5:style==='economy'?5:7,remaining=Math.hypot(p.x+145,p.z+132.5),speedGoal=Math.min(sectionSpeed,Math.sqrt(2*2*Math.max(0,remaining-.5)));
  const maxAngle=roadWheelAngle(1,speed,sim.params,sim._surfaceMu({x:p.x,y:0,z:p.z}));
  const steer=clamp(Math.atan(2.84*2*Math.sin(error)/Math.max(2,Math.hypot(target.x-p.x,target.z-p.z)))/maxAngle,-1,1);
  return{throttle:clamp((speedGoal-speed)*.3+.02,0,style==='economy'?.35:.6),brake:clamp((speed-speedGoal)*.2,0,.6),steer,boost:style==='boost'&&sim.simTime<1.3};
 };
}
export function routeTerminal(descriptor,t){const progress=routeSurfaceProgress(descriptor,t.position),end=descriptor.route.waypoints.at(-1);return progress.distanceM>295&&progress.lateralDistanceM<9&&Math.hypot(t.position.x-end.x,t.position.z-end.z)<5&&Math.hypot(t.velocity.x,t.velocity.z)<.45&&t.contactCount===4&&Math.abs(t.rollDeg)<5&&Math.abs(t.pitchDeg)<5&&Math.abs(t.velocity.y)<.2&&Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z)<.2;}
