import {routeSurfaceProgress} from './route-surface.js';

// Ordered timing lines on the 302.5 m Weave route. Each split uses the first
// observed physical step past its line; the final one includes the settled stop.
export const WEAVE_SECTORS=Object.freeze([
  {endM:60,zh:'起步至检修钢板',en:'Launch to service plate'},
  {endM:180,zh:'桥下与半幅路面',en:'Underpass and split surface'},
  {endM:235,zh:'入弯制动区',en:'Braking approach'},
  {endM:302.5,zh:'左转至停稳',en:'Left turn and stop'}
].map(Object.freeze));
export const WEAVE_STOP_RADIUS_M=5;
export function weaveTimingMarks(descriptor){
  const points=descriptor.route.waypoints;
  return WEAVE_SECTORS.slice(0,-1).map(({endM})=>{
    let travelled=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
      if(length>0&&travelled+length>=endM){
        const u=(endM-travelled)/length;
        return {x:a.x+u*dx,z:a.z+u*dz,dx:dx/length,dz:dz/length};
      }
      travelled+=length;
    }
    throw Error('Timing line outside the prepared route');
  });
}
const point=t=>({simTime:t.simTime,remainingWh:t.energyKWh*1000,recoveredWh:t.energyAccounting.recoveredJ/3600,
  gasUsedKg:t.onboardGasConsumedKg,externalKg:t.externalGasSuppliedKg});
function measure(i,a,b){
  return {sector:i+1,endM:WEAVE_SECTORS[i].endM,atSimTime:b.simTime,elapsedS:b.simTime-a.simTime,
    netWh:a.remainingWh-b.remainingWh,recoveredWh:b.recoveredWh-a.recoveredWh,
    gasUsedKg:b.gasUsedKg-a.gasUsedKg,externalGasKg:b.externalKg-a.externalKg};
}
export class WeaveRouteTiming{
  constructor(descriptor,t){
    this.descriptor=descriptor;this.start=point(t);this.rows=[];this.stopSeconds=0;this.finished=false;
    this.previous=this.sample(t);this.progress=this.previous.progress;this.missedGate=false;
  }
  sample(t){
    const progress=routeSurfaceProgress(this.descriptor,t.position);
    // Bridges and upper decks can share the same X/Z coordinates as the road.
    const support=(t.wheelStates??[]).filter(w=>w.contact&&Number.isFinite(w.contactPointWorld?.y)&&
      Math.abs(w.contactPointWorld.y-this.descriptor.groundY)<=this.descriptor.contactToleranceM).length;
    return {progress,support:Math.min(support,t.contactCount),time:t.simTime,x:t.position.x,z:t.position.z,speed:Math.hypot(t.velocity.x,t.velocity.z)};
  }
  observe(t){
    if(this.finished||t.simTime<=this.previous.time)return;
    const curr=this.sample(t),prev=this.previous,dt=curr.time-prev.time;
    this.previous=curr;this.progress=curr.progress;
    const continuous=dt<=1/120+1e-7&&Math.hypot(curr.x-prev.x,curr.z-prev.z)<=.015+Math.max(curr.speed,prev.speed)*dt;
    const inLane=s=>s.support>=3&&s.progress.lateralDistanceM<=this.descriptor.route.widthM/2;
    const next=this.rows.length,line=WEAVE_SECTORS[next].endM;
    if(next<WEAVE_SECTORS.length-1){
      if(continuous&&inLane(prev)&&inLane(curr)&&prev.progress.distanceM<line&&curr.progress.distanceM>=line){
        const end=point(t);this.rows.push(measure(next,this.start,end));this.start=end;this.missedGate=false;
      }else this.missedGate=curr.progress.distanceM>=line;
      return;
    }
    const finish=this.descriptor.route.waypoints.at(-1);
    const stopped=continuous&&curr.support===4&&Math.hypot(curr.x-finish.x,curr.z-finish.z)<WEAVE_STOP_RADIUS_M&&
      curr.speed<.45&&Math.abs(t.velocity.y)<.2&&Math.abs(t.pitchDeg)<5&&Math.abs(t.rollDeg)<5&&
      Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z)<.2;
    // Start timing at the first supported, stationary sample. A discontinuity
    // or a repeated paused sample cannot contribute unobserved stopped time.
    if(!stopped)this.stopSince=null;
    else if(this.stopSince==null)this.stopSince=curr.time;
    this.stopSeconds=this.stopSince==null?0:curr.time-this.stopSince;
    if(this.stopSeconds>=.5-1e-8){
      this.rows.push(measure(next,this.start,point(t)));this.finished=true;
    }
  }
}
export function validSectorRows(rows){
  return Array.isArray(rows)&&rows.length<=WEAVE_SECTORS.length&&rows.every((r,i)=>
    r&&r.sector===i+1&&r.endM===WEAVE_SECTORS[i].endM&&
    ['atSimTime','elapsedS','netWh','recoveredWh','gasUsedKg','externalGasKg'].every(k=>Number.isFinite(r[k]))&&
    r.elapsedS>=0&&r.recoveredWh>=0&&r.gasUsedKg>=0&&r.externalGasKg>=0&&
    (i===0||r.atSimTime>rows[i-1].atSimTime));
}
