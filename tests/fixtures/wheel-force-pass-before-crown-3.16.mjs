// Frozen force pass from the pre-crown 3.16 candidate. Only the support
// query argument differs in the causal brake-regression comparison.
import * as CANNON from '../../dist/vendor/cannon-es.js';
import {roadWheelAngle} from '../../dist/vehicle-models.js';
import {integrateWheel,regularizedSlip,lateralTireForce} from '../../dist/tire-dynamics.js';
const V=(x=0,y=0,z=0)=>new CANNON.Vec3(x,y,z),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),plain=v=>({x:v.x,y:v.y,z:v.z});
const Y=V(0,1,0),Z=V(0,0,1),X=V(1,0,0),WHEEL_LOCATIONS=[[-.89,.06,1.42],[.89,.06,1.42],[-.89,.06,-1.42],[.89,.06,-1.42]];
export function wheelsWithFrozenForcePass(dt,input,circularWheelSupport){
    const b=this.body,p=this.params,up=b.quaternion.vmult(Y);
    // Lateral sliding does not make a fast car slow: using only body-forward
    // speed made the steering envelope grow as beta grew. Use the complete
    // tangent-plane speed and the actual road's load-weighted contact grip.
    const planarSpeed=Math.sqrt(Math.max(0,b.velocity.lengthSquared()-b.velocity.dot(up)**2));
    const previousLoad=this.wheelStates.reduce((sum,w)=>sum+(w.contact?w.normalLoadN:0),0);
    const steeringMu=previousLoad>1?this.wheelStates.reduce((sum,w)=>sum+(w.contact?this._surfaceMu(w.contactPointWorld||b.position)*w.normalLoadN:0),0)/previousLoad:this._surfaceMu(b.position);
    const steerTarget=roadWheelAngle(input.steer,planarSpeed,p,steeringMu);
    this._steerCentre+=clamp((steerTarget-this._steerCentre)*(1-Math.exp(-dt/.10)),-1.8*dt,1.8*dt);
    const contacts=[];
    for(let i=0;i<4;i++) {
      const mount=V(...WHEEL_LOCATIONS[i]),from=b.pointToWorldFrame(mount);
      const extension=p.suspensionRest+p.suspensionDroop;
      const ray=this._wheelRays[i],w=this.wheelStates[i];
      const turn=this._steerCentre,radius=2.84/Math.max(1e-6,Math.tan(Math.abs(turn)));
      w.steer=i<2?Math.sign(turn)*Math.atan(2.84/(radius-Math.sign(turn)*mount.x)):0;
      // A wheel can strike a curb or land before its suspension ray reports
      // support. Its collider must follow the same steering command in air.
      const stopQ=new CANNON.Quaternion();stopQ.setFromEuler(0,w.steer,Math.PI/2,'YXZ');b.shapeOrientations[this._wheelStopIndices[i]].copy(stopQ);b.aabbNeedsUpdate=true;
      const wheelForward=b.quaternion.vmult(V(Math.sin(w.steer),0,Math.cos(w.steer)));
      const hit=circularWheelSupport(this.world,{mount:from,up,forward:wheelForward,radius:p.wheelRadius,minLength:p.suspensionMin-p.wheelRadius,maxLength:extension},ray);
      w.contactGeometry=hit?{...ray.wheelSupport}:null;
      const alignment=hit?ray.hitNormalWorld.dot(up):0;
      w.contactNormalWorld=hit?plain(ray.hitNormalWorld):plain(up);
      w.contactPointWorld=hit?plain(ray.hitPointWorld):null;w.contactObjectId=hit?ray.body?.userData?.id??null:null;
      const length=hit?ray.distance-p.wheelRadius:extension;
      w.contact=!!hit && length<=extension && alignment>.30;
      w.suspensionLength=clamp(length,p.suspensionMin,extension);
      w.position={x:mount.x,y:mount.y-w.suspensionLength,z:mount.z};w.normalLoadN=0;
      w.brakeDemandN=0;w.longitudinalForceN=0;w.lateralForceN=0;w.gripUse=0;
      w.lateralSpeedMps=null;w.longitudinalSpeedMps=null;w.lateralDemandN=0;w.rollingContactWeight=0;
      if(!w.contact) { w.relaxedSlip=0;continue; }
      const relative=ray.hitPointWorld.vsub(b.position);
      const velocity=b.angularVelocity.cross(relative).vadd(b.velocity);
      const vn=velocity.dot(ray.hitNormalWorld);
      const compression=p.suspensionRest-length;
      const bump=Math.max(0,p.suspensionMin+.015-length);
      const spring=clamp((p.springRate*compression-p.suspensionDamping*vn+600000*bump)/Math.max(.4,alignment),0,b.mass*p.gravity*2.3);
      w.contact=spring>1;
      if(!w.contact)continue;
      w.normalLoadN=spring;
      b.applyForce(ray.hitNormalWorld.scale(spring),relative);
      const forward=b.quaternion.vmult(V(Math.sin(w.steer),0,Math.cos(w.steer)));
      forward.vsub(ray.hitNormalWorld.scale(forward.dot(ray.hitNormalWorld)),forward);forward.normalize();
      const right=ray.hitNormalWorld.cross(forward);right.normalize();
      const vlong=velocity.dot(forward),vlat=velocity.dot(right);
      w.lateralSpeedMps=vlat;w.longitudinalSpeedMps=vlong;
      w.slipAngle=Math.atan2(vlat,Math.abs(vlong)+.6);
      contacts.push({w,relative,normal:ray.hitNormalWorld.clone(),forward,right,vlong,vlat});
    }
    this._contactCount=contacts.length;
    const n=Math.max(1,contacts.length),g=this.world.gravity;
    const totalLoad=Math.max(1,contacts.reduce((sum,c)=>sum+c.w.normalLoadN,0));
    this._motorForceN=0;this._regenForceN=0;
    let driveForce=this._hasPower&&input.brake<.01&&(this.mode==='drive'||contacts.length>0)?input.throttle*p.maxMotorForce:0;
    const speed=Math.abs(b.velocity.dot(b.quaternion.vmult(Z)));
    // Keep the existing 60/40 service-axle budgets. Sharing equal quarters
    // inside an axle overloaded the lightly loaded inside tire during a bend.
    // An unloaded wheel gets no extra share while its axle partner is grounded;
    // an entirely airborne axle retains its budget for braking wheel spin.
    const axleLoads=[this.wheelStates[0].normalLoadN+this.wheelStates[1].normalLoadN,this.wheelStates[2].normalLoadN+this.wheelStates[3].normalLoadN];
    const serviceShares=this.wheelStates.map((w,i)=>axleLoads[i>>1]>1?(i<2?.6:.4)*w.normalLoadN/axleLoads[i>>1]:(i<2?.30:.20));
    const pedal=Math.abs(input.throttle),pedalU=clamp((pedal-.010)/.010,0,1),pedalBlend=pedalU*pedalU*(3-2*pedalU);
    const liftOff=this._hasPower&&contacts.length?Math.min(p.brakeForce,p.regenForce,p.regenPower/Math.max(speed,1))*(1-pedalBlend):0;
    const serviceRequest=input.brake*p.brakeForce,totalBrakeRequest=Math.max(liftOff,serviceRequest);
    const takeover=liftOff>0?clamp(serviceRequest/liftOff,0,1):1,serviceBlend=takeover*takeover*(3-2*takeover);
    const regenRequest=liftOff*(1-serviceBlend),serviceRemainder=totalBrakeRequest-regenRequest;
    const regenDemands=this.wheelStates.map(w=>regenRequest*w.normalLoadN/totalLoad);
    const serviceDemands=serviceShares.map(share=>serviceRemainder*share);
    // A small brake-pedal movement must not release the existing low-speed
    // parking hold. Top-ups share only the unused vehicle brake budget.
    const parkTopUps=this.wheelStates.map((w,i)=>{
      const c=contacts.find(c=>c.w===w),holding=pedal<.010&&c&&Math.abs(c.vlong)<.18;
      return holding?Math.max(0,p.brakeForce*serviceShares[i]-serviceDemands[i]-regenDemands[i]):0;
    });
    const parkSum=parkTopUps.reduce((sum,value)=>sum+value,0),parkScale=Math.min(1,Math.max(0,p.brakeForce-totalBrakeRequest)/Math.max(1e-12,parkSum));
    for(let i=0;i<4;i++)serviceDemands[i]+=parkTopUps[i]*parkScale;
    const poweredWheels=p.tractionAssist?this.wheelStates.filter(w=>w.contact):this.wheelStates;
    const motorSpeed=Math.max(speed,...poweredWheels.map(w=>Math.abs(w.angularVelocityRadS*p.wheelRadius)));
    driveForce=clamp(driveForce,-p.motorPower/Math.max(8,motorSpeed),p.motorPower/Math.max(8,motorSpeed));
    const pilotDriveForce=driveForce;
    let corneringDriveScale=1;
    if(p.tractionAssist&&contacts.length&&Math.abs(driveForce)>1){
      // Preserve lateral authority before wheelspin develops. The old TCS
      // regulated longitudinal slip alone and could spend the same friction
      // budget twice when W and A/D were held together. Reduce one common
      // motor request using the most constrained contact, preserving the
      // existing load shares; this never adds a yaw moment or modifies motion.
      const requestedAy=Math.min(planarSpeed*planarSpeed*Math.abs(Math.tan(steerTarget))/2.84,
        Math.min(p.steeringAccelG,.85*steeringMu)*p.gravity*Math.abs(input.steer));
      for(const c of contacts){
        const index=this.wheelStates.indexOf(c.w),capacity=this._surfaceMu(c.w.contactPointWorld)*c.w.normalLoadN;
        const corner=(index<2?p.cornerStiffnessFront:p.cornerStiffnessRear)*Math.pow(Math.max(1,c.w.normalLoadN)/5500,.9);
        const currentDemand=Math.abs(Math.tanh(corner*c.w.slipAngle/Math.max(1,capacity))*capacity);
        const lateralDemand=Math.max(currentDemand,c.w.normalLoadN*requestedAy/p.gravity);
        // A 6% command reserve at full steering covers transient load changes.
        // Straight-line drive retains the complete existing torque budget.
        const commandCapacity=capacity*(1-.06*Math.abs(input.steer));
        const longitudinalLimit=Math.sqrt(Math.max(0,commandCapacity*commandCapacity-lateralDemand*lateralDemand));
        corneringDriveScale=Math.min(corneringDriveScale,longitudinalLimit/Math.max(1,Math.abs(driveForce)*c.w.normalLoadN/totalLoad));
      }
      driveForce*=corneringDriveScale;
    }
    const contactByWheel=new Map(contacts.map(c=>[c.w,c]));
    // One axle torque/power budget is normalized across all four wheels. With
    // TCS, unloaded wheels are cut rather than receiving an additional quarter
    // of the already distributed grounded budget. Without TCS the fixed 25%
    // shares allow real airborne spin and waste part of the available power.
    const rawShares=this.wheelStates.map(w=>p.tractionAssist?(w.contact?w.normalLoadN/totalLoad:0):.25);
    const shareScale=1/Math.max(1,rawShares.reduce((sum,value)=>sum+value,0));
    const shares=rawShares.map(value=>value*shareScale),totalTorque=driveForce*p.wheelRadius;
    const accounting=this._driveAccounting={torqueBudgetNm:Math.abs(pilotDriveForce*p.wheelRadius),requestedTorqueNm:0,postTcsTorqueNm:0,actualTorqueNm:0,
      mechanicalPowerLimitW:p.motorPower,mechanicalPowerW:0,electricalPowerW:0,mechanicalWorkJ:0,electricalWorkJ:0,
      powerLimited:false,airbornePolicy:p.tractionAssist?'unloaded-drive-cut':'equal-four-wheel-shares',shares:[...shares],corneringDriveScale,corneringTractionActive:corneringDriveScale<.98,steeringSurfaceMu:steeringMu,steeringSpeedMps:planarSpeed,
      brakeMechanicalWorkJ:0,liftOffBrakeMechanicalWorkJ:0,electricalRecoveredWorkJ:0};
    for(let i=0;i<4;i++) {
      const w=this.wheelStates[i],c=contactByWheel.get(w),effectiveMass=b.mass/n;
      const driveTorque=totalTorque*shares[i],maxDrivePowerW=p.motorPower*shares[i];
      accounting.requestedTorqueNm+=Math.abs(driveTorque);
      w.serviceBrakeDemandN=serviceDemands[i];w.regenBrakeDemandN=regenDemands[i];w.brakeDemandN=serviceDemands[i]+regenDemands[i];
      w.corneringDriveScale=corneringDriveScale;w.corneringTractionActive=!!c&&corneringDriveScale<.98&&Math.abs(pilotDriveForce*shares[i])>1;
      if(!c){
        // Free wheels retain spin and respond to axle/brake torque. Rotation is
        // never inferred from chassis speed, including immediately after lift.
        const result=integrateWheel(w,{dt,vlong:0,normalLoadN:0,mu:0,lateralForceN:0,
          driveTorqueNm:driveTorque,maxDrivePowerW,brakeTorqueNm:w.brakeDemandN*p.wheelRadius,regenTorqueNm:w.regenBrakeDemandN*p.wheelRadius,
          radius:p.wheelRadius,inertia:p.wheelInertia,effectiveMass,absEnabled:false,tcsEnabled:p.tractionAssist});
        b.torque.vadd(b.quaternion.vmult(V(Math.cos(w.steer),0,-Math.sin(w.steer))).scale(-result.spinMomentumChangeNms/dt),b.torque);
        this._motorWork+=result.driveWorkJ/.9;this._brakeDissipationJ+=result.brakeEnergyJ;
        accounting.brakeMechanicalWorkJ+=result.brakeEnergyJ;accounting.liftOffBrakeMechanicalWorkJ+=result.regenBrakeEnergyJ;
        this._motorForceN+=w.driveTorqueNm/p.wheelRadius;
        accounting.postTcsTorqueNm+=Math.abs(w.postTcsTorqueRequestNm);accounting.actualTorqueNm+=Math.abs(w.driveTorqueNm);accounting.mechanicalWorkJ+=result.driveWorkJ;accounting.powerLimited||=w.drivePowerLimited;
        w.longitudinalForceN=0;w.lateralForceN=0;w.gripUse=0;w.slipRatio=null;continue;
      }
      const mu=this._surfaceMu(w.contactPointWorld),capacity=mu*w.normalLoadN;
      const corner=(i<2?p.cornerStiffnessFront:p.cornerStiffnessRear)*Math.pow(Math.max(1,w.normalLoadN)/5500,.9);
      const relaxation=clamp(p.tireRelaxationLength/(Math.abs(c.vlong)+.8),.008,.25);
      w.relaxedSlip+=(w.slipAngle-(w.relaxedSlip||0))*(1-Math.exp(-dt/relaxation));
      const lateralContact=lateralTireForce({vlong:c.vlong,vlat:c.vlat,normalLoadN:w.normalLoadN,mu,cornerStiffness:corner,relaxedSlip:w.relaxedSlip,effectiveMass,gravityLateral:g.dot(c.right)});
      const lateral=lateralContact.forceN;w.lateralDemandN=lateral;w.rollingContactWeight=lateralContact.rollingWeight;
      // A brake torque distribution is not an ABS. Each wheel below has real
      // rotational inertia, contact reaction torque and a slip regulator that
      // releases/reapplies its requested pressure after measured wheel slip.
      // TCS only releases its already budgeted torque; it never creates a new pool.
      // The pedal first takes over the existing lift-off deceleration, then
      // adds service braking. max(R, S) is continuous and nondecreasing in S;
      // its smooth allocation crossfade never adds R on top of the 42 kN cap.
      // "regen" remains an equivalent motor-retarding channel: all passive
      // wheel work is dissipated in this model; no battery energy is credited.
      const brake=w.brakeDemandN;
      const result=integrateWheel(w,{dt,vlong:c.vlong,normalLoadN:w.normalLoadN,mu,lateralForceN:lateral,
        driveTorqueNm:driveTorque,maxDrivePowerW,brakeTorqueNm:brake*p.wheelRadius,regenTorqueNm:w.regenBrakeDemandN*p.wheelRadius,
        rollingTorqueNm:w.normalLoadN*.011*p.wheelRadius*pedalBlend,
        radius:p.wheelRadius,inertia:p.wheelInertia,effectiveMass,gravityLong:g.dot(c.forward),absEnabled:p.absEnabled,tcsEnabled:p.tractionAssist});
      w.tcsActive||=w.corneringTractionActive;
      const flong=result.longitudinalForceN,flat=result.lateralForceN;
      w.longitudinalForceN=flong;w.lateralForceN=flat;w.gripUse=capacity?Math.hypot(flong,flat)/capacity:0;
      this._motorForceN+=w.driveTorqueNm/p.wheelRadius;
      this._regenForceN+=w.regenBrakeTorqueNm/p.wheelRadius;
      b.applyForce(c.forward.scale(flong).vadd(c.right.scale(flat)),c.relative);
      // Contact forces act on the complete vehicle. Subtract the wheel's
      // changing relative spin momentum from chassis pitch torque; otherwise
      // axle acceleration creates unaccounted angular momentum. Steering-axis
      // gyroscopic cross terms remain outside this reduced four-wheel model.
      b.torque.vadd(b.quaternion.vmult(V(Math.cos(w.steer),0,-Math.sin(w.steer))).scale(-result.spinMomentumChangeNms/dt),b.torque);
      this._motorWork+=result.driveWorkJ/.9;
      accounting.postTcsTorqueNm+=Math.abs(w.postTcsTorqueRequestNm);accounting.actualTorqueNm+=Math.abs(w.driveTorqueNm);accounting.mechanicalWorkJ+=result.driveWorkJ;accounting.powerLimited||=w.drivePowerLimited;
      this._brakeDissipationJ+=result.brakeEnergyJ;this._tireDissipationJ+=result.tireEnergyJ+Math.max(0,-flat*c.vlat)*dt;
      accounting.brakeMechanicalWorkJ+=result.brakeEnergyJ;accounting.liftOffBrakeMechanicalWorkJ+=result.regenBrakeEnergyJ;
    }
    accounting.mechanicalPowerW=accounting.mechanicalWorkJ/dt;accounting.electricalWorkJ=accounting.mechanicalWorkJ/.9;accounting.electricalPowerW=accounting.electricalWorkJ/dt;
  }
