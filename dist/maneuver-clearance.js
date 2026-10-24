import {QUICK_ROLL_HEADROOM_OFFSETS} from './vehicle-clearance.js';
import {envelopeClearanceAt} from './maneuver-envelope.js';

/** Bounded preflight estimate, not a swept-volume collision guarantee.
 * Follow the present horizontal velocity for the declared action horizon.
 * Rotate the footprint with the car so a heading change cannot shrink it.
 * This changes no physical state, actuator command or maneuver trajectory. */
export function sampleManeuverHeadroom(sim,{rangeM,horizonS,requiredM=rangeM,envelope=null}){
  const b=sim.body,speed=Math.hypot(b.velocity.x,b.velocity.z);
  const horizon=Math.max(0,Math.min(5,horizonS));
  const forward=b.quaternion.vmult({x:0,y:0,z:1});
  const heading=Math.atan2(forward.x,forward.z),sin=Math.sin(heading),cos=Math.cos(heading);
  const below=sim.traceSurface(b.position,{x:0,y:-1,z:0},220),normal=below?.normal;
  // Carry the launch datum along its support plane. Keeping world Y fixed
  // on an uphill road eventually starts the rays below the road collider,
  // mistaking its underside for a ceiling and refusing an ordinary slope.
  const surfaceVerticalMps=normal?.y>.7?-(normal.x*b.velocity.x+normal.z*b.velocity.z)/normal.y:0;
  // At most 0.25 s / 1 m between stations within the normal driving range.
  // The hard ray budget is explicit for extreme initial-condition studies.
  let phased=!!envelope?.summary.active;
  const intervals=!phased&&speed<.05?0:Math.min(256,Math.max(1,Math.ceil(horizon/.25),Math.ceil(speed*horizon)));
  let supportSampleCount=0,supportChanged=false;
  // The reduced landing prediction assumes the initial support plane. Check
  // its sampled continuation from the low launch datum (not above the roof,
  // which would confuse a bridge deck with the road beneath it). Steps, gaps
  // and slope transitions keep the older conservative height estimate.
  if(phased)for(let i=0;i<=intervals;i++){
    const t=intervals?horizon*i/intervals:0,origin={x:b.position.x+b.velocity.x*t,y:b.position.y+surfaceVerticalMps*t,z:b.position.z+b.velocity.z*t};
    const support=sim.traceSurface(origin,{x:0,y:-1,z:0},Math.max(2,(below?.distance??0)+.5));supportSampleCount++;
    if(!support||Math.abs(support.distance-below.distance)>.10||support.normal.y<Math.cos(Math.PI/180)){supportChanged=true;phased=false;break;}
  }
  const envelopeSummary=envelope?{...envelope.summary,...(supportChanged?{active:false,fallbackReasons:[...envelope.summary.fallbackReasons,'support-plane-changes-along-path']}:{})}:null;
  let nearest=null,violation=null,sampleCount=0;
  for(let i=0;i<=intervals;i++){
    const timeS=intervals?horizon*i/intervals:0;
    const stationRequired=phased?envelopeClearanceAt(envelope,timeS,intervals?horizon/intervals/2:0):requiredM;
    const stationRange=phased?stationRequired:rangeM;
    for(const [x,z]of QUICK_ROLL_HEADROOM_OFFSETS){
      const offsetX=x*cos+z*sin,offsetZ=-x*sin+z*cos;
      const footprintRise=normal?.y>.7?-(normal.x*offsetX+normal.z*offsetZ)/normal.y:0;
      const origin={x:b.position.x+b.velocity.x*timeS+offsetX,y:b.position.y+surfaceVerticalMps*timeS+footprintRise,z:b.position.z+b.velocity.z*timeS+offsetZ};
      const hit=sim.traceSurface(origin,{x:0,y:1,z:0},stationRange);sampleCount++;
      if(hit&&(!nearest||hit.distance<nearest.distanceM))nearest={distanceM:hit.distance,objectId:hit.objectId??null,timeS,origin};
      if(hit&&hit.distance<stationRequired&&(!violation||hit.distance-stationRequired<violation.marginM))violation={distanceM:hit.distance,requiredM:stationRequired,marginM:hit.distance-stationRequired,objectId:hit.objectId??null,timeS};
    }
  }
  return {distanceM:nearest?.distanceM??null,objectId:nearest?.objectId??null,nearestTimeS:nearest?.timeS??null,blocked:!!violation,violation,
    horizonS:horizon,rangeM,sampleCount,stationCount:intervals+1,stationSpacingM:intervals?speed*horizon/intervals:0,surfaceVerticalMps,
    envelope:envelopeSummary,supportSampleCount,
    estimated:true,method:'Five heading-aligned upward rays along a constant-horizontal-velocity path and the initial support plane; '+(phased?'phase-dependent force/valve/geometry height prediction with explicit reserves; ':'conservative single peak-height envelope; ')+'bounded to five seconds, 1285 upward rays and 257 support probes.',
    notCovered:'Continuous swept volume, thin obstacles between samples, horizontal thrust drift, future steering/throttle changes, wind drift or moving obstacles.'};
}
