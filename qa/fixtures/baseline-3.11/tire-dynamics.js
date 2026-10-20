// Reduced longitudinal brush/sliding law coupled to an independent rotating
// wheel. The implicit local contact solve prevents the stiff low-speed tire
// from creating energy. This is an engineering approximation, not OEM data.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function regularizedSlip(omega,v,radius,regularization=.75){return(omega*radius-v)/Math.max(regularization,Math.abs(v),Math.abs(omega*radius));}
export function longitudinalTireForce(slip,capacity){
  const a=Math.abs(slip),slide=1-.22*clamp((a-.16)/.74,0,1);
  return capacity*Math.tanh(slip*15)*slide;
}
// Static creep and a rolling tyre describe the same contact. Blend their force
// laws across 1.5–4.5 m/s rather than changing branches at exactly 3 m/s. The
// smoothstep has zero derivative at both ends; the combined-slip solver below
// still bounds the delivered vector by mu * Fz. This is a low-order contact
// approximation, not a second source of grip or a velocity constraint.
export function lateralTireForce({vlong,vlat,normalLoadN,mu,cornerStiffness,relaxedSlip,effectiveMass,gravityLateral=0}){
  const capacity=Math.max(0,normalLoadN*mu),u=clamp((Math.abs(vlong)-1.5)/3,0,1),rollingWeight=u*u*(3-2*u);
  const creep=-vlat*effectiveMass*24;
  const rolling=-Math.tanh(cornerStiffness*relaxedSlip/Math.max(1,capacity))*capacity;
  return {forceN:creep+(rolling-creep)*rollingWeight-gravityLateral*effectiveMass,rollingWeight};
}
export function integrateWheel(w,{dt,vlong,normalLoadN,mu,lateralForceN,driveTorqueNm,brakeTorqueNm,rollingTorqueNm=0,radius,inertia,effectiveMass,gravityLong=0,absEnabled=true,tcsEnabled=true,maxDrivePowerW=Infinity}){
  const n=Math.max(1,Math.ceil(dt*600)),h=dt/n,capacity=Math.max(0,normalLoadN*mu);
  let speed=vlong,impulse=0,latImpulse=0,brakeEnergy=0,tireEnergy=0,driveWork=0,actualDrive=0,actualBrake=0,postTcsRequest=0;
  w.angularVelocityRadS??=0;w.absPressure??=1;w.tcsFactor??=1;
  const startingOmega=w.angularVelocityRadS;
  w.absActive=false;w.tcsActive=false;w.drivePowerLimited=false;
  w.requestedDriveTorqueNm=driveTorqueNm;w.allocatedDrivePowerW=Number.isFinite(maxDrivePowerW)?Math.max(0,maxDrivePowerW):null;
  for(let i=0;i<n;i++){
    const slip=regularizedSlip(w.angularVelocityRadS,speed,radius),direction=Math.sign(speed)||Math.sign(w.angularVelocityRadS)||Math.sign(driveTorqueNm)||1;
    const brakingSlip=-slip*direction,drivingSlip=slip*(Math.sign(driveTorqueNm)||direction);
    if(absEnabled&&brakeTorqueNm>1&&Math.abs(speed)>1.2){
      const rate=brakingSlip>.14?-45*(brakingSlip-.14):8*(.14-brakingSlip);
      w.absPressure=clamp(w.absPressure+rate*h,.02,1);
    }else w.absPressure=1;
    if(tcsEnabled&&Math.abs(driveTorqueNm)>1&&Math.abs(w.angularVelocityRadS*radius)>1){
      const rate=drivingSlip>.13?-35*(drivingSlip-.13):5*(.13-drivingSlip);
      w.tcsFactor=clamp(w.tcsFactor+rate*h,.025,1);
    }else w.tcsFactor=1;
    let drive=driveTorqueNm*w.tcsFactor;
    postTcsRequest+=drive*h;
    // Bound *actual midpoint work*, including spin acceleration during this
    // substep. A beginning-of-step P/omega cap alone exceeds the power limit
    // as the wheel accelerates. The friction circle bounds |contact torque|;
    // passive brakes cannot increase |omega|. Thus this analytic upper bound
    // is conservative for every force considered by the implicit contact solve:
    // |T| (|omega0| + h (|T| + mu Fz r)/(2 I)) <= allocated power.
    // Every wheel receives a share of ONE vehicle budget before this solve;
    // unused power is not silently reassigned while solving another wheel.
    if(Number.isFinite(maxDrivePowerW)){
      const power=Math.max(0,maxDrivePowerW),a=h/(2*inertia),b=Math.abs(w.angularVelocityRadS)+a*capacity*radius;
      const limit=power>0?2*power/(b+Math.sqrt(b*b+4*a*power)):0;
      if(Math.abs(drive)>limit){drive=Math.sign(drive)*limit;w.drivePowerLimited=true;}
    }
    const brake=brakeTorqueNm*w.absPressure+rollingTorqueNm;
    const omega0=w.angularVelocityRadS;
    const advance=force=>{
      const free=omega0+h*(drive-force*radius)/inertia;
      return Math.sign(free)*Math.max(0,Math.abs(free)-h*brake/inertia);
    };
    const contact=force=>{
      const omega=advance(force),v=speed+h*(force/effectiveMass+gravityLong);
      const raw=longitudinalTireForce(regularizedSlip(omega,v,radius),capacity);
      const scale=Math.min(1,capacity/Math.max(1e-12,Math.hypot(raw,lateralForceN)));
      return{omega,v,force:raw*scale,lateral:lateralForceN*scale};
    };
    const exactRest=omega0===0&&speed===0&&drive===0&&gravityLong===0;
    let lo=-capacity,hi=capacity;
    if(capacity&&!exactRest)for(let k=0;k<18;k++){const mid=(lo+hi)*.5;if(mid>contact(mid).force)hi=mid;else lo=mid;}
    // Zero is exact at rest; bisection brackets otherwise introduce a tiny
    // force when both angular and translational initial velocities are zero.
    const fx=capacity&&!exactRest?(lo+hi)*.5:0;
    const next=contact(fx),omega1=advance(fx),midOmega=(omega0+omega1)*.5;
    const appliedBrake=drive-fx*radius-inertia*(omega1-omega0)/h;
    w.angularVelocityRadS=omega1;w.rotation+=midOmega*h;
    brakeEnergy+=Math.max(0,appliedBrake*midOmega)*h;
    tireEnergy+=Math.max(0,fx*(radius*omega1-next.v))*h;
    driveWork+=Math.max(0,drive*midOmega)*h;
    actualDrive+=drive*h;actualBrake+=Math.abs(appliedBrake)*h;
    // The root solve has finite tolerance. Enforce the remaining lateral
    // budget against the force actually integrated, so that tolerance cannot
    // create a friction-circle overshoot at the contact patch.
    const lateral=Math.sign(next.lateral)*Math.min(Math.abs(next.lateral),Math.sqrt(Math.max(0,capacity*capacity-fx*fx)));
    impulse+=fx*h;latImpulse+=lateral*h;speed=next.v;
    w.absActive||=w.absPressure<.98;w.tcsActive||=w.tcsFactor<.98;
  }
  w.slipRatio=regularizedSlip(w.angularVelocityRadS,speed,radius);w.contactSpeedMps=vlong;w.surfaceMu=mu;
  w.driveTorqueNm=actualDrive/dt;w.brakeTorqueNm=actualBrake/dt;w.tireReactionTorqueNm=-impulse/dt*radius;
  w.postTcsTorqueRequestNm=postTcsRequest/dt;w.driveMechanicalPowerW=driveWork/dt;
  w.wheelEnergyJ=.5*inertia*w.angularVelocityRadS**2;
  return{longitudinalForceN:impulse/dt,lateralForceN:latImpulse/dt,brakeEnergyJ:brakeEnergy,tireEnergyJ:tireEnergy,driveWorkJ:driveWork,spinMomentumChangeNms:inertia*(w.angularVelocityRadS-startingOmega)};
}
