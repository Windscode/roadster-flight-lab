import {AABB,Vec3} from '../../../dist/vendor/cannon-es.js';

// The pilot/controller API remains at its requested fixed interval. Near an
// approaching hard feature the same force/valve/tire and Cannon equations are
// re-evaluated in shorter intervals. This is temporal refinement, not a force
// increase, position projection, collision waiver, or wider acceptance limit.
export const CONTACT_REFINEMENT_HZ=960;
export function contactStepSchedule(sim,dt){
  const b=sim.body;
  if(dt<=1/CONTACT_REFINEMENT_HZ+1e-12)return{count:1,reason:'already-refined'};
  const speed=b.velocity.length(),sweepSpeed=speed+b.angularVelocity.length()*2.4;
  // Decide whether refinement is needed from the state, with a shared 60 Hz
  // horizon. Using the caller's dt made the 240 Hz path switch refinement off
  // while the otherwise identical 60/120 Hz paths kept it on during impact.
  if(sweepSpeed/60<.03)return{count:1,reason:'small-contact-travel'};
  // Fixture/import callers can change pose before the first solver tick.
  // The decision must use the current physical pose, never a cached old AABB.
  b.updateAABB();
  const pad=.35,travel=b.velocity.scale(Math.max(dt,1/60)),lo=b.aabb.lowerBound,hi=b.aabb.upperBound;
  const bounds=new AABB({lowerBound:new Vec3(lo.x+Math.min(0,travel.x)-pad,lo.y+Math.min(0,travel.y)-pad,lo.z+Math.min(0,travel.z)-pad),
    upperBound:new Vec3(hi.x+Math.max(0,travel.x)+pad,hi.y+Math.max(0,travel.y)+pad,hi.z+Math.max(0,travel.z)+pad)});
  const near=sim.world.broadphase.aabbQuery(sim.world,bounds,[]),upright=1-2*(b.quaternion.x*b.quaternion.x+b.quaternion.z*b.quaternion.z)>.95;
  for(const other of near){
    if(other===b||other.mass!==0||(other.collisionFilterGroup&1)===0)continue;
    // A smooth supporting slab below the fully compressed wheel envelope does
    // not require impact refinement during ordinary level road driving.
    if(upright&&Math.abs(b.velocity.y)<1&&other.aabb.upperBound.y<lo.y-.005)continue;
    return{count:Math.min(16,Math.max(1,Math.ceil(dt*CONTACT_REFINEMENT_HZ-1e-10))),reason:'approaching-hard-contact',objectId:other.userData?.id??null};
  }
  return{count:1,reason:'no-near-hard-contact'};
}
