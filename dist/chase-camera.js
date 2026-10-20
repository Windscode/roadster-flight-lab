/** Follow actual vehicle translation before smoothing the relative chase offset.
 * World-space lag otherwise grows by approximately speed / damping: at 90 km/h
 * it adds about six metres to the intended follow distance and keeps the camera
 * outside the turn. Heading remains the physical chassis heading, never the
 * velocity direction, so real tyre sideslip remains visible.
 *
 * Only the horizontal translation is transported. The existing world-space
 * vertical filter still softens suspension movement, touchdown and flight.
 * Inputs are read-only; this function changes no physical state or camera target.
 */
export const CHASE_DAMPING_PER_SECOND=4;

export function advanceChasePosition(current,vehicle,previousVehicle,offset,dt){
  const blend=1-Math.exp(-CHASE_DAMPING_PER_SECOND*Math.max(0,Number.isFinite(dt)?dt:0));
  const carriedX=current.x+vehicle.x-previousVehicle.x;
  const carriedZ=current.z+vehicle.z-previousVehicle.z;
  return{
    x:carriedX+(vehicle.x+offset.x-carriedX)*blend,
    y:current.y+(vehicle.y+offset.y-current.y)*blend,
    z:carriedZ+(vehicle.z+offset.z-carriedZ)*blend,
  };
}

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const inverseRotate=(p,q)=>{
  const x=-q[0],y=-q[1],z=-q[2],w=q[3],ix=w*p.x+y*p.z-z*p.y,iy=w*p.y+z*p.x-x*p.z,iz=w*p.z+x*p.y-y*p.x,iw=-x*p.x-y*p.y-z*p.z;
  return{x:ix*w-iw*x-iy*z+iz*y,y:iy*w-iw*y-iz*x+ix*z,z:iz*w-iw*z-ix*y+iy*x};
};

/** Near plane corner distance from the optical centre, plus a small clearance
 * skin. A swept ball is conservative for the rectangular near plane. */
export function cameraClearanceRadius({near=.08,fov=60,aspect=16/9,viewOffsetFraction=0,skin=.06}={}){
  const tan=Math.tan(clamp(fov,10,120)*Math.PI/360),horizontal=tan*Math.max(.1,aspect)*(1+2*Math.abs(viewOffsetFraction));
  return Math.max(.12,Math.max(.01,near)*Math.sqrt(1+tan*tan+horizontal*horizontal)+Math.max(0,skin));
}

function boxEntry(from,to,box,radius){
  const q=box.quaternion??[0,0,0,1],p=box.position,origin=inverseRotate({x:from.x-p[0],y:from.y-p[1],z:from.z-p[2]},q),delta=inverseRotate({x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},q);
  let lo=0,hi=1,insideExpanded=true,insideSolid=true;
  for(let i=0;i<3;i++){
    const key=['x','y','z'][i],half=box.size[i]/2,extent=half+radius,o=origin[key],d=delta[key];
    insideExpanded&&=Math.abs(o)<=extent;insideSolid&&=Math.abs(o)<=half;
    if(Math.abs(d)<1e-12){if(Math.abs(o)>extent)return null;continue;}
    let a=(-extent-o)/d,b=(extent-o)/d;if(a>b)[a,b]=[b,a];lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi)return null;
  }
  // The look-at anchor may lie within the near-plane padding beside a wall.
  // Allow the camera to leave that padding when the anchor itself is outside
  // the solid and the entire requested camera point is beyond the exit.
  if(insideExpanded&&!insideSolid&&hi<1){
    // Leaving padding is allowed only when this segment does not cross the
    // actual solid. Crossing the whole wall also exits its padding; that is
    // not a valid outward escape.
    let solidLo=0,solidHi=1,intersectsSolid=true;
    for(let i=0;i<3;i++){
      const key=['x','y','z'][i],half=box.size[i]/2,o=origin[key],d=delta[key];
      if(Math.abs(d)<1e-12){if(Math.abs(o)>half){intersectsSolid=false;break;}continue;}
      let a=(-half-o)/d,b=(half-o)/d;if(a>b)[a,b]=[b,a];solidLo=Math.max(solidLo,a);solidHi=Math.min(solidHi,b);
      if(solidLo>solidHi){intersectsSolid=false;break;}
    }
    if(!intersectsSolid)return null;
  }
  return{fraction:clamp(lo,0,1),anchorInsideSolid:insideSolid};
}

/** Read-only camera collision against the same immutable box descriptions
 * used by RoadsterSim. Both chase and orbit call this after their desired
 * camera position has been calculated. Retraction has no intentional lag;
 * release waits 0.18 s then eases out, so a thin post does not cause alternating
 * full-distance frames. It never hides geometry or changes physical state. */
export function resolveCameraObstruction({target,desired,geometry,previous=null,dt=1/60,near=.08,fov=60,aspect=16/9,viewOffsetFraction=0,releaseRate=3.5,releaseHoldS=.18}={}){
  if(!target||!desired||![target.x,target.y,target.z,desired.x,desired.y,desired.z].every(Number.isFinite))throw new Error('Camera obstruction requires finite target and desired positions');
  const delta={x:desired.x-target.x,y:desired.y-target.y,z:desired.z-target.z},length=Math.hypot(delta.x,delta.y,delta.z),radius=cameraClearanceRadius({near,fov,aspect,viewOffsetFraction});
  if(length<1e-9)return{position:{...desired},distanceM:0,desiredDistanceM:0,nearPlaneRadiusM:radius,obstructed:false,hit:null,state:{distanceM:0,holdRemainingS:0}};
  let nearest=null;
  for(const box of geometry??[]){if(box.type!=='box'||!Array.isArray(box.size)||!Array.isArray(box.position))continue;const hit=boxEntry(target,desired,box,radius);if(hit&&(!nearest||hit.fraction<nearest.fraction))nearest={...hit,objectId:box.id,kind:box.kind};}
  const available=nearest?Math.max(0,length*nearest.fraction-.025):length;
  const elapsed=clamp(Number.isFinite(dt)?dt:0,0,.1),old=previous?.distanceM,validOld=Number.isFinite(old);
  let distance=available,holdRemaining=previous?.holdRemainingS??0;
  if(!validOld||available<old-.015){distance=available;holdRemaining=nearest?releaseHoldS:0;}
  else{
    holdRemaining=Math.max(0,holdRemaining-elapsed);
    if(nearest&&available<=old+.015)holdRemaining=Math.max(holdRemaining,releaseHoldS);
    distance=Math.min(available,holdRemaining>0?old:old+(available-old)*(1-Math.exp(-releaseRate*elapsed)));
  }
  distance=clamp(distance,0,length);
  return{position:{x:target.x+delta.x*distance/length,y:target.y+delta.y*distance/length,z:target.z+delta.z*distance/length},distanceM:distance,desiredDistanceM:length,nearPlaneRadiusM:radius,
    obstructed:!!nearest,hit:nearest?{objectId:nearest.objectId,kind:nearest.kind,distanceM:length*nearest.fraction,anchorInsideSolid:nearest.anchorInsideSolid}:null,
    state:{distanceM:distance,holdRemainingS:holdRemaining},method:'shared collision OBBs inflated by near-plane corner radius'};
}
