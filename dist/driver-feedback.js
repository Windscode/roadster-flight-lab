// Read-only presentation filter. No force, pose, controller or snapshot writes.
// All displacement is at the driver's head; the rendered chassis stays physical.
export const DRIVER_HEAD_LIMITS=Object.freeze({x:.025,y:.012,z:.035});
const clamp=(v,limit)=>Math.max(-limit,Math.min(limit,v));
const rotateInverse=(v,q)=>{
  const x=-q.x,y=-q.y,z=-q.z,w=q.w;
  const ix=w*v.x+y*v.z-z*v.y,iy=w*v.y+z*v.x-x*v.z,iz=w*v.z+x*v.y-y*v.x,iw=-x*v.x-y*v.y-z*v.z;
  return {x:ix*w-iw*x-iy*z+iz*y,y:iy*w-iw*y-iz*x+ix*z,z:iz*w-iw*z-ix*y+iy*x};
};
export class DriverHeadFeedback {
  constructor({enabled=true}={}){this.enabled=enabled;this.reset();}
  reset(){this.previous=null;this.acceleration={x:0,y:0,z:0};this.offset={x:0,y:0,z:0};}
  setEnabled(enabled){this.enabled=!!enabled;this.reset();}
  update(t,{active=true,paused=false}={}){
    if(!active||!this.enabled){this.reset();return {...this.offset};}
    if(paused)return {...this.offset};
    const time=t.simTime,v=t.velocity,q=t.quaternion;
    if(!Number.isFinite(time)||!v||!q)return {x:0,y:0,z:0};
    const previous=this.previous,dt=previous?time-previous.time:0;
    this.previous={time,velocity:{x:v.x,y:v.y,z:v.z}};
    // A replay seek/reset is not an acceleration impulse. Repeated display frames
    // keep the last physical estimate rather than differentiating interpolated pose.
    if(!previous||dt<0||dt>.15){this.acceleration={x:0,y:0,z:0};this.offset={x:0,y:0,z:0};return {...this.offset};}
    if(dt<=1e-8)return {...this.offset};
    const world={x:(v.x-previous.velocity.x)/dt,y:(v.y-previous.velocity.y)/dt,z:(v.z-previous.velocity.z)/dt};
    const local=rotateInverse(world,q),a=1-Math.exp(-dt/0.16),b=1-Math.exp(-dt/0.13);
    for(const axis of ['x','y','z'])this.acceleration[axis]+=(clamp(local[axis],15)-this.acceleration[axis])*a;
    const target={x:clamp(-this.acceleration.x*.0022,DRIVER_HEAD_LIMITS.x),y:clamp(-this.acceleration.y*.0008,DRIVER_HEAD_LIMITS.y),z:clamp(-this.acceleration.z*.0028,DRIVER_HEAD_LIMITS.z)};
    for(const axis of ['x','y','z'])this.offset[axis]+=(target[axis]-this.offset[axis])*b;
    return {...this.offset};
  }
  getState(){return {enabled:this.enabled,offsetM:{...this.offset},limitsM:{...DRIVER_HEAD_LIMITS},rotationApplied:false,presentationOnly:true};}
}
