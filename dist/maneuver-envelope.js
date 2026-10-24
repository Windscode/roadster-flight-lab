import {sampleRollManeuver} from './vehicle-models.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DT=1/240;

export function maneuverLaunchForce(mass,gravity,verticalSpeed,launchVelocity,launchAcceleration,forceLimit){
  return Math.min(forceLimit,mass*(gravity+clamp((launchVelocity-verticalSpeed)*8,0,launchAcceleration)));
}
export function landingDescentSpeed(clearance){
  return -Math.max(.30,Math.min(7,Math.sqrt(2*1.5*Math.max(0,clearance-.40))));
}

// A nominal vertical prediction with explicit engineering reserves. It is
// independent of the live solver and never writes the vehicle's state. The
// lift/rotation/landing equations are the same reduced physical relationships
// used by the maneuver controller; the coupled differential-jet force is not
// treated as free vertical lift while inverted.
export function createManeuverEnvelope(sim,plan,defaultParameters){
  const b=sim.body,p=sim.params,below=sim.traceSurface(b.position,{x:0,y:-1,z:0},220),wind=sim.getWind();
  const local=b.quaternion.conjugate().vmult(b.velocity),up=b.quaternion.vmult({x:0,y:1,z:0});
  const reasons=[];
  // The reduced model is enabled only for the default physics configuration.
  // Single-parameter research samples do not validate combinations or the
  // continuous parameter space. Keep one explicit comparison with the actual
  // kernel defaults, instead of an expanding list of special allowed cases.
  const differences=Object.entries(defaultParameters??{}).filter(([key,value])=>p[key]!==value)
    .map(([key,expected])=>({key,expected,actual:p[key]}));
  const parameterDomain={policy:'default-physics-only',differences};
  if(!defaultParameters)reasons.push('default-parameter-baseline-required');
  else if(differences.length)reasons.push('custom-physics-parameters-outside-validated-domain');
  if(sim._observationConfig?.enabled)reasons.push('ideal-control-observation-required');
  if(sim._fanLevel>.01||sim._nozzles.some(n=>n.force>1)||sim._wing?.deployment>.01)reasons.push('settled-actuator-state-required');
  if(!plan.originGrounded||sim._contactCount!==4)reasons.push('four-wheel-ground-start-required');
  if(!below||below.normal.y<Math.cos(Math.PI/180))reasons.push('approximately-level-support-required');
  if(up.y<Math.cos(3*Math.PI/180)||b.angularVelocity.length()>.15||Math.abs(b.velocity.y)>.3)reasons.push('settled-upright-start-required');
  if(Math.abs(local.x)>.5||Math.abs(sim._lastInput?.steer??0)>.08||Math.hypot(b.velocity.x,b.velocity.z)>35)reasons.push('straight-driving-envelope-required');
  if((wind?.speedMps??0)+(wind?.gustMps??0)>.1)reasons.push('still-air-required');
  if(sim._nozzleFault&&sim._nozzleFault.scale<1)reasons.push('healthy-nozzles-required');
  if(p.supplyMode!=='bench')reasons.push('constant-supply-required');
  if(p.valveRiseTime>.09||p.valveFallTime>.06)reasons.push('valve-response-outside-validated-range');
  const summary={model:'phase-envelope-1',kind:plan.name,active:reasons.length===0,fallbackReasons:reasons,parameterDomain,
    scope:'Nominal 1D force/valve prediction plus measured engineering reserves; not a mathematical upper bound or collision certificate.'};
  if(reasons.length)return {summary,samples:[]};

  const horizonS=5,timeReserveS=4*Math.max(p.valveRiseTime,p.valveFallTime)+.1,heightReserveM=.75,attitudeReserveRad=10*Math.PI/180;
  const groundY=b.position.y-below.distance,restHeight=Math.max(.52,b.position.y-groundY),mass=b.mass;
  const inertia=plan.name==='pitch'?b.inertia.x:b.inertia.z,lever=plan.name==='pitch'?Math.abs(sim._nozzles[0].position.z):Math.abs(sim._nozzles[0].position.x);
  const maxForce=sim._availableLiftForce(),samples=[],transitions={launchS:0};
  let height=b.position.y-groundY,velocity=b.velocity.y,force=sim._nozzles.filter(n=>n.kind==='lift').reduce((a,n)=>a+n.force,0),phase='climb',phaseTime=0,angle=0;
  const upperExtent=angle=>{
    const sin=Math.sin(angle),cos=Math.cos(angle),axis=plan.name==='pitch'?{x:0,y:cos,z:sin}:{x:sin,y:cos,z:0};
    let top=0;
    for(let i=0;i<4;i++){
      const o=b.shapeOffsets[i],h=b.shapes[i].halfExtents;
      top=Math.max(top,o.x*axis.x+o.y*axis.y+o.z*axis.z+Math.abs(axis.x)*h.x+Math.abs(axis.y)*h.y+Math.abs(axis.z)*h.z);
    }
    // Include both bump-stop colliders and fully extended tyre positions.
    // A bounding sphere conservatively covers steering and tyre shoulders.
    for(let i=0;i<4;i++){
      const o=b.shapeOffsets[sim._wheelStopIndices[i]],r=Math.hypot(p.wheelRadius,.1325);
      for(const y of [o.y,.06-p.suspensionRest-p.suspensionDroop])top=Math.max(top,o.x*axis.x+y*axis.y+o.z*axis.z+r);
    }
    return top;
  };
  const record=timeS=>{
    let top=0;
    for(const offset of [-attitudeReserveRad,0,attitudeReserveRad])top=Math.max(top,upperExtent(angle+offset));
    samples.push({timeS,cgHeightM:height,upperHeightM:height+top,phase});
  };
  record(0);
  for(let i=1;i<=Math.ceil(horizonS/DT);i++){
    phaseTime+=DT;let desired;
    if(phase==='climb'){
      desired=maneuverLaunchForce(mass,p.gravity,velocity,plan.launchVelocity,plan.launchAccelerationMps2,maxForce);
      if(height>=plan.minimumRotationClearanceM&&velocity>=plan.launchVelocity-.25){phase='rotate';phaseTime=0;transitions.rotateS=i*DT;}
    }else if(phase==='rotate'){
      const sample=sampleRollManeuver(plan.profile,phaseTime);angle=sample.angleRad;
      desired=inertia*Math.abs(sample.accelerationRadS2)/lever;
      if(phaseTime>=plan.profile.durationS){phase='land';phaseTime=0;angle=0;transitions.landS=i*DT;}
    }else{
      const clearance=Math.max(0,height-.60),descent=landingDescentSpeed(clearance);
      desired=mass*(p.gravity+clamp((descent-velocity)*8,-p.gravity*.95,p.gravity*2));
    }
    desired=clamp(desired,0,maxForce);
    const tau=desired>force?p.valveRiseTime:p.valveFallTime;
    force+=(desired-force)*(1-Math.exp(-DT/tau));
    velocity+=(force*Math.cos(angle)/mass-p.gravity)*DT;height+=velocity*DT;
    // Unilateral ground support in this prediction. Real suspension and
    // contact still decide the actual landing, including bounce or failure.
    if(height<restHeight){height=restHeight;velocity=Math.max(0,velocity);if(phase==='land')transitions.supportS??=i*DT;}
    record(i*DT);
  }
  Object.assign(summary,{horizonS,stepS:DT,timeReserveS,heightReserveM,attitudeReserveDeg:10,transitions,
    nominalPeakCgHeightM:Math.max(...samples.map(s=>s.cgHeightM)),nominalPeakUpperHeightM:Math.max(...samples.map(s=>s.upperHeightM)),
    omitted:'Full thrust allocation/tracking, horizontal force drift, wind, variable gas mass/pressure, changing support planes and future pilot changes.'});
  if(!transitions.landS){summary.active=false;summary.fallbackReasons.push('nominal-rotation-did-not-finish');}
  return {summary,samples,initialCgHeightM:b.position.y-groundY};
}

export function envelopeClearanceAt(envelope,timeS,stationHalfTimeS=0){
  const {summary,samples,initialCgHeightM}=envelope;
  if(!summary.active)return null;
  const radius=summary.timeReserveS+stationHalfTimeS,start=clamp(Math.floor((timeS-radius)/DT),0,samples.length-1),end=clamp(Math.ceil((timeS+radius)/DT),0,samples.length-1);
  let top=0;
  for(let i=start;i<=end;i++)top=Math.max(top,samples[i].upperHeightM);
  return top+summary.heightReserveM-initialCgHeightM;
}
