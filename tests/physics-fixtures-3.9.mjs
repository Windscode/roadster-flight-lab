// Shared deterministic numerical fixtures; these do not emulate a GPU or FPS.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const PHYSICS_39_BASE='a25b228a6d56f358cba24106ce897e1cb5c99bc1';
export function flatFixture(Sim,{height=.62,params={}}={}){
  const sim=new Sim(params);
  for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
  sim.body.position.set(0,height,-300);
  if(height<1)for(let k=0;k<240;k++)sim._advance(1/120,{});
  else sim.setMode('hover');
  return sim;
}
export function wheelBudgetFixture(Sim,{grounded=4,tcs=true,speed=30,throttle=1,dt=1/120,omegaScale=1}={}){
  const sim=new Sim({tractionAssist:tcs});
  sim.body.mass=2400;sim.body.updateMassProperties();sim.body.velocity.set(0,0,speed);sim.body.angularVelocity.setZero();
  sim.body.position.set(0,1,0);sim._hasPower=true;sim.mode='drive';sim._motorWork=0;
  sim.wheelStates.forEach(w=>{w.angularVelocityRadS=speed/sim.params.wheelRadius*omegaScale;w.absPressure=1;w.tcsFactor=1;});
  let index=0;
  sim._raySurface=(from,to,ray)=>{const hit=index++<grounded;if(!hit)return false;ray.distance=sim.params.wheelRadius+sim.params.suspensionRest-6000/sim.params.springRate;ray.hitNormalWorld.set(0,1,0);ray.hitPointWorld.set(from.x,from.y-ray.distance,from.z);return true;};
  const p=sim.params,r=p.wheelRadius;
  const torqueBudget=Math.min(Math.abs(throttle)*p.maxMotorForce*r,p.motorPower*r/Math.max(8,Math.abs(speed),Math.abs(speed*omegaScale)));
  const wheelEnergyBeforeJ=sim.wheelStates.reduce((a,w)=>a+.5*p.wheelInertia*w.angularVelocityRadS**2,0);
  sim._wheels(dt,{throttle,steer:0,brake:0,lift:0});
  return{grounded,tcs,speedMps:speed,dt,omegaScale,torqueBudgetNm:torqueBudget,
    requestedTorqueNm:sim._driveAccounting?.requestedTorqueNm??torqueBudget*(tcs&&grounded?1+(4-grounded)/4:1),
    actualTorqueNm:sim.wheelStates.reduce((a,w)=>a+Math.abs(w.driveTorqueNm),0),
    mechanicalPowerW:sim._motorWork*.9/dt,electricalPowerW:sim._motorWork/dt,electricalEnergyJ:sim._motorWork,
    wheelEnergyBeforeJ,wheelEnergyAfterJ:sim.wheelStates.reduce((a,w)=>a+w.wheelEnergyJ,0),
    totalLongitudinalForceN:sim.wheelStates.reduce((a,w)=>a+w.longitudinalForceN,0),
    wheels:sim.wheelStates.map(w=>({contact:w.contact,normalLoadN:w.normalLoadN,requestedTorqueNm:w.requestedDriveTorqueNm??null,
      actualTorqueNm:w.driveTorqueNm,omegaRadS:w.angularVelocityRadS,slipRatio:w.slipRatio,drivePowerW:w.driveMechanicalPowerW??null,tcsFactor:w.tcsFactor})),
    accounting:sim._driveAccounting??null};
}
export function steeringFixture(Sim,{speed=15,steer=1,seconds=6,stepAt=.25,params={}}={}){
  const sim=flatFixture(Sim,{params});sim.body.velocity.z=speed;sim.wheelStates.forEach(w=>w.angularVelocityRadS=speed/sim.params.wheelRadius);
  let yawAtHalfSecond=0,peakBetaDeg=0,peakLateralAcceleration=0,maxGrip=0,minContacts=4,settled=[];
  for(let i=0;i<Math.round(seconds*120);i++){
    const time=i/120,v=sim.body.quaternion.conjugate().vmult(sim.body.velocity);
    // An ordinary bounded speed feedback issues motor requests; it never sets
    // chassis speed after the explicitly declared rolling initial condition.
    sim._advance(1/120,{steer:time>=stepAt?steer:0,throttle:clamp((speed-v.z)*.38+.02,0,1)});
    const t=sim.telemetry();if(t.fault)throw Error(t.fault);
    peakBetaDeg=Math.max(peakBetaDeg,Math.abs(t.bodySlipDeg));maxGrip=Math.max(maxGrip,...t.wheelStates.map(w=>w.gripUse));minContacts=Math.min(minContacts,t.contactCount);
    const ay=Math.abs(sim.body.angularVelocity.y)*Math.hypot(sim.body.velocity.x,sim.body.velocity.z);
    peakLateralAcceleration=Math.max(peakLateralAcceleration,ay);
    if(i===Math.round((stepAt+.5)*120)-1)yawAtHalfSecond=sim.body.angularVelocity.y;
    if(time>=seconds-1)settled.push({speed:Math.hypot(sim.body.velocity.x,sim.body.velocity.z),yaw:Math.abs(sim.body.angularVelocity.y),steer:sim._steerCentre,beta:t.bodySlipDeg,ay});
  }
  const mean=key=>settled.reduce((a,v)=>a+v[key],0)/settled.length;
  return{initialSpeedMps:speed,steer,seconds,settledSpeedMps:mean('speed'),radiusM:mean('speed')/mean('yaw'),lateralAccelerationMps2:mean('ay'),yawRateRadS:mean('yaw'),yawAtHalfSecondRadS:yawAtHalfSecond,steeringCentreDeg:mean('steer')*180/Math.PI,bodySlipDeg:mean('beta'),peakBetaDeg,peakLateralAcceleration,maxGrip,minContacts};
}
export function levelFixture(Sim,{pitchDeg=0,rollDeg=0,headingDeg=0,gesture=null,gestureSeconds=.7,seconds=7,suctionArmed=false}={}){
  const sim=flatFixture(Sim,{height:130});sim.body.quaternion.setFromEuler(-pitchDeg*Math.PI/180,headingDeg*Math.PI/180,rollDeg*Math.PI/180,'YXZ');sim.setMode('hover');
  if(gesture)for(let k=0;k<Math.round(gestureSeconds*120);k++)sim._advance(1/120,gesture);
  for(let k=0;k<30;k++)sim._advance(1/120,{});
  const before=sim.telemetry(),bodyBefore=JSON.stringify([sim.body.position,sim.body.quaternion,sim.body.velocity,sim.body.angularVelocity]);
  if(suctionArmed)sim.setSuction(true);
  sim.setAirStabilization(true);
  const setterMovedBody=bodyBefore!==JSON.stringify([sim.body.position,sim.body.quaternion,sim.body.velocity,sim.body.angularVelocity]);
  let minHeight=before.heightWorld,maxRate=0,maxForceRatio=0,firstLevelTimeS=null,contact=false,limitedSteps=0;
  for(let k=0;k<Math.round(seconds*120);k++){
    sim._advance(1/120,{});const t=sim.telemetry();if(t.fault)throw Error(t.fault);
    minHeight=Math.min(minHeight,t.heightWorld);maxRate=Math.max(maxRate,Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z));
    maxForceRatio=Math.max(maxForceRatio,...t.nozzles.map(n=>n.maxForce?n.force/n.maxForce:0));contact||=t.contactCount>0;
    if(t.levelRecovery?.status==='limited')limitedSteps++;
    if(firstLevelTimeS===null&&Math.abs(t.rollDeg)<1&&Math.abs(t.pitchDeg)<1&&Math.hypot(t.angularVelocity.x,t.angularVelocity.z)<.04)firstLevelTimeS=(k+1)/120;
  }
  const after=sim.telemetry();return{pitchDeg,rollDeg,headingDeg,gesture,gestureSeconds,suctionArmed,before:{pitchDeg:before.pitchDeg,rollDeg:before.rollDeg,heightM:before.heightWorld,headingDeg:before.headingDeg},after:{pitchDeg:after.pitchDeg,rollDeg:after.rollDeg,heightM:after.heightWorld,headingDeg:after.headingDeg,verticalSpeedMps:after.verticalSpeed,sealQuality:after.sealQuality,stabilizationActive:after.stabilizationActive},setterMovedBody,minHeight,maxRate,maxForceRatio,firstLevelTimeS,contact,limitedSteps,levelRecovery:after.levelRecovery??null};
}

export function cityBendFixture(Sim,roadAngle,{speed=11}={}){
  // The authored Weave-to-Crosstown intersection, in the complete city world.
  // A bounded pure-pursuit test driver follows a 12 m centre-line corner.
  const path=[];for(let z=-188;z<=-144.5;z+=.5)path.push({x:-200,z});
  for(let k=1;k<=48;k++){const a=k/48*Math.PI/2;path.push({x:-188-12*Math.cos(a),z:-144.5+12*Math.sin(a)});}
  for(let x=-187.5;x<=-132;x+=.5)path.push({x,z:-132.5});
  const sim=new Sim();sim.body.position.set(-200,.62,-184);
  for(let k=0;k<240;k++)sim._advance(1/120,{});
  sim.body.velocity.z=speed;sim.wheelStates.forEach(w=>w.angularVelocityRadS=speed/sim.params.wheelRadius);
  let progress=0,maxError=0,sumError=0,n=0,hullImpactSteps=0,minContacts=4,maxGrip=0,peakSlipDeg=0,finished=false;
  for(let k=0;k<15*120;k++){
    const b=sim.body;let distance=Infinity;
    const searchStart=Math.max(0,progress-3),searchEnd=Math.min(path.length,progress+60);
    for(let j=searchStart;j<searchEnd;j++){
      const d=Math.hypot(path[j].x-b.position.x,path[j].z-b.position.z);if(d<distance){distance=d;progress=j;}
    }
    maxError=Math.max(maxError,distance);sumError+=distance;n++;
    const speedBody=b.quaternion.conjugate().vmult(b.velocity).z,lookAhead=Math.max(5,Math.abs(speedBody)*.65);
    let target=path.at(-1),travel=0;for(let j=progress+1;j<path.length;j++){travel+=Math.hypot(path[j].x-path[j-1].x,path[j].z-path[j-1].z);if(travel>=lookAhead){target=path[j];break;}}
    const heading=sim._angles().heading,dx=target.x-b.position.x,dz=target.z-b.position.z,lateral=dx*Math.cos(heading)-dz*Math.sin(heading);
    const delta=Math.atan2(2*2.84*lateral,dx*dx+dz*dz);
    sim._advance(1/120,{steer:clamp(delta/Math.max(.00001,roadAngle(1,Math.abs(speedBody),sim.params)),-1,1),throttle:clamp((speed-speedBody)*.38+.02,0,1)});
    const t=sim.telemetry();if(t.fault)throw Error(t.fault);
    hullImpactSteps+=Number(sim.world.contacts.some(c=>{const shape=c.bi===b?c.si:c.bj===b?c.sj:null;return shape&&shape.material!==sim._wheelStopMaterial;}));
    minContacts=Math.min(minContacts,t.contactCount);maxGrip=Math.max(maxGrip,...t.wheelStates.map(w=>w.gripUse));peakSlipDeg=Math.max(peakSlipDeg,Math.abs(t.bodySlipDeg));
    if(progress>=path.length-3){finished=true;break;}
  }
  return{world:'complete-authored-city',intersection:'weave-main / crosstown-link',cornerRadiusM:12,requestedSpeedMps:speed,finished,elapsedS:n/120,maxCrossTrackErrorM:maxError,meanCrossTrackErrorM:sumError/n,hullImpactSteps,minContacts,maxGrip,peakSlipDeg,finalPosition:{x:sim.body.position.x,y:sim.body.position.y,z:sim.body.position.z}};
}
