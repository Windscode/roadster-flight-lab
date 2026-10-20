// Declared numerical initial conditions. These helpers do not render frames,
// synthesize FPS, or replace a user's keyboard / camera acceptance.
import {sampleRollManeuver} from '../dist/vehicle-models.js';
export const DT=1/120,DEG=180/Math.PI;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function flatDynamics(Sim,{height=.62,params={}}={}){
  const sim=new Sim(params);
  for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
  sim.body.position.set(0,height,-240);
  if(height<1)for(let k=0;k<240;k++)sim.advanceFixed({},DT);
  else sim.setMode('hover');
  return sim;
}
export const HANDLING_COLUMNS=['timeS','xM','zM','speedKmh','inputSteer','inputThrottle','inputBrake','wheelCentreDeg','yawRateDegS','bodyBetaDeg','lateralAccelerationMps2','contacts',...['FR','FL','RR','RL'].flatMap(id=>['loadN','alphaDeg','longSlip','grip','FxN','FyN','steerDeg'].map(key=>id+'_'+key))];
export function handlingRun(Sim,configuration){
  const {speedKmh=54,steer=.2,power='hold',surface='dry',kind='step',seconds=6,params={}}=configuration;
  const speed=speedKmh/3.6,sim=flatDynamics(Sim,{params:{roadSurface:surface,...params}}),b=sim.body;
  // An explicit rolling initial condition, then a 1 s ordinary pedal settling
  // interval. No state is assigned during the measured maneuver.
  b.velocity.set(0,0,speed);sim.wheelStates.forEach(w=>w.angularVelocityRadS=speed/sim.params.wheelRadius);
  const rows=[],metrics={startSpeedKmh:null,endSpeedKmh:null,peakBodySlipDeg:0,speedAtPeakBodySlipKmh:null,peakBodySlipAbove30KmhDeg:0,peakTireSlipDeg:0,peakLongitudinalSlip:0,minimumCorneringDriveScale:1,corneringTractionActiveS:0,peakYawRateDegS:0,peakWheelAngleDeg:0,peakGrip:0,gripSaturationS:0,minContacts:4,bodyContactSteps:0,pathLengthM:0,peakMotorPowerW:0,peakMotorTorqueBudgetExcessNm:0,minNormalLoadN:Infinity,maxNormalLoadN:0,steeringDurationS:0};
  let previous=b.position.clone(),lastInput={},startEnergy=sim._energyUsed;
  for(let k=0;k<Math.round(seconds/DT);k++){
    const time=k*DT,active=time>=1&&time<5,v=b.quaternion.conjugate().vmult(b.velocity);
    let direction=active?1:0;
    if(kind==='tap')direction=time>=1&&time<1.20?1:0;
    if(kind==='lane')direction=time>=1&&time<1.6?1:time>=1.6&&time<2.2?-1:0;
    const throttle=!active||power==='hold'?clamp((speed-v.z)*.38+.02,0,1):power==='full'?1:power==='coast'?0:.02;
    const input={steer:steer*direction,throttle,brake:power==='brake'&&active?.35:0},before=b.velocity.clone();
    const t=sim.advanceFixed(input,DT),delta=b.velocity.vsub(before).scale(1/DT),lateral=delta.dot(b.quaternion.vmult({x:1,y:0,z:0}));
    if(t.fault)throw new Error(t.fault);
    const wheels=t.wheelStates;
    if(active){
      metrics.startSpeedKmh??=t.speedKmh;metrics.endSpeedKmh=t.speedKmh;metrics.steeringDurationS+=DT;
      if(Math.abs(t.bodySlipDeg)>metrics.peakBodySlipDeg){metrics.peakBodySlipDeg=Math.abs(t.bodySlipDeg);metrics.speedAtPeakBodySlipKmh=t.speedKmh;}
      if(t.speedKmh>=30)metrics.peakBodySlipAbove30KmhDeg=Math.max(metrics.peakBodySlipAbove30KmhDeg,Math.abs(t.bodySlipDeg));
      metrics.peakTireSlipDeg=Math.max(metrics.peakTireSlipDeg,...wheels.map(w=>Math.abs(w.slipAngle)*DEG));
      metrics.peakLongitudinalSlip=Math.max(metrics.peakLongitudinalSlip,...wheels.map(w=>Math.abs(w.slipRatio||0)));
      metrics.minimumCorneringDriveScale=Math.min(metrics.minimumCorneringDriveScale,sim._driveAccounting.corneringDriveScale??1);metrics.corneringTractionActiveS+=Number(!!sim._driveAccounting.corneringTractionActive)*DT;
      metrics.peakYawRateDegS=Math.max(metrics.peakYawRateDegS,Math.abs(t.angularVelocity.y)*DEG);metrics.peakWheelAngleDeg=Math.max(metrics.peakWheelAngleDeg,Math.abs(t.steeringCentreDeg));
      metrics.peakGrip=Math.max(metrics.peakGrip,...wheels.map(w=>w.gripUse));metrics.gripSaturationS+=Number(wheels.some(w=>w.gripUse>.98))*DT;
      metrics.minContacts=Math.min(metrics.minContacts,t.contactCount);metrics.minNormalLoadN=Math.min(metrics.minNormalLoadN,...wheels.map(w=>w.normalLoadN));metrics.maxNormalLoadN=Math.max(metrics.maxNormalLoadN,...wheels.map(w=>w.normalLoadN));
      metrics.pathLengthM+=b.position.distanceTo(previous);metrics.peakMotorPowerW=Math.max(metrics.peakMotorPowerW,sim._driveAccounting.mechanicalPowerW);metrics.peakMotorTorqueBudgetExcessNm=Math.max(metrics.peakMotorTorqueBudgetExcessNm,sim._driveAccounting.actualTorqueNm-sim._driveAccounting.torqueBudgetNm);
      metrics.bodyContactSteps+=Number(sim.world.contacts.some(c=>{const shape=c.bi===b?c.si:c.bj===b?c.sj:null;return shape&&shape.material!==sim._wheelStopMaterial;}));
    }
    if(k%6===0)rows.push([time+DT,t.position.x,t.position.z,t.speedKmh,input.steer,input.throttle,input.brake,t.steeringCentreDeg,t.angularVelocity.y*DEG,t.bodySlipDeg,lateral,t.contactCount,...wheels.flatMap(w=>[w.normalLoadN,w.slipAngle*DEG,w.slipRatio,w.gripUse,w.longitudinalForceN,w.lateralForceN,w.steer*DEG])]);
    previous=b.position.clone();lastInput=input;
  }
  metrics.speedLossKmh=metrics.startSpeedKmh-metrics.endSpeedKmh;metrics.energyUsedKWh=sim._energyUsed-startEnergy;
  metrics.finalSpeedKmh=sim.telemetry().speedKmh;metrics.finalBodySlipDeg=sim.telemetry().bodySlipDeg;
  return {configuration:{speedKmh,steer,power,surface,kind,seconds,params},metrics,rows};
}
export const FLIGHT_COLUMNS=['timeS','heightM','verticalMps','rollDeg','pitchDeg','headingDeg','quaternionX','quaternionY','quaternionZ','quaternionW','inputLift','inputRoll','inputPitch','rollRateDegS','pitchRateDegS','yawRateDegS','refRollRateDegS','thrustN','allocationResidual','externalGasKg','remainingGasKg','phase',...['desired','achieved'].flatMap(kind=>['FxN','FyN','FzN','MxNm','MyNm','MzNm'].map(channel=>kind+'_'+channel)),...['lift-FR','lift-FL','lift-RR','lift-RL','roll-FR','roll-FL','roll-RR','roll-RL','rear-boost','front-brake'].flatMap(id=>[id+'_actualN',id+'_commandN'])];
export function flightRow(sim,t,time,phase){
  const w=sim.body.quaternion.conjugate().vmult(sim.body.angularVelocity),ref=sim.getReference();
  const a=t.maneuver,u=a?Math.max(0,Math.min(1,a.time/a.duration)):0,rollReference=a?.phase==='rotate'?(a.profile?sampleRollManeuver(a.profile,a.time).rateRadS:2*Math.PI*30*u*u*(1-u)*(1-u)/a.duration):ref.manualRate.z;
  return[time,t.heightWorld,t.verticalSpeed,t.rollDeg,t.pitchDeg,t.headingDeg,sim.body.quaternion.x,sim.body.quaternion.y,sim.body.quaternion.z,sim.body.quaternion.w,t.driverInput.lift,t.driverInput.roll,t.driverInput.pitch,w.z*DEG,w.x*DEG,w.y*DEG,rollReference*DEG,t.thrustN,t.allocationError,t.externalGasSuppliedKg,t.gasMass,phase,...t.desiredWrench,...t.achievedWrench,...t.nozzles.flatMap(n=>[n.force,n.command])];
}
export function verticalRun(Sim,{level=false,params={},speedMps=8}={}){
  const sim=flatDynamics(Sim,{height:60,params:{...params,climbRateMps:speedMps}});sim.setAirStabilization(level);
  let release=null,stopped=null,peak=60,timeTo95=null,maxAcceleration=0;const rows=[];
  for(let k=0;k<12/DT;k++){
    const time=k*DT,active=time<4,before=sim.body.velocity.y,t=sim.advanceFixed(active?{lift:1}:{},DT);
    if(t.fault)throw new Error(t.fault);
    maxAcceleration=Math.max(maxAcceleration,(t.verticalSpeed-before)/DT);if(active&&timeTo95===null&&t.verticalSpeed>=.95*speedMps)timeTo95=time+DT;
    if(!active&&!release)release={timeS:time,heightM:t.heightWorld,velocityMps:t.verticalSpeed};
    if(release){peak=Math.max(peak,t.heightWorld);if(stopped===null&&Math.abs(t.verticalSpeed)<.06)stopped=time+DT;}
    if(k%6===0)rows.push(flightRow(sim,t,time+DT,active?'climb':'release'));
  }
  return{configuration:{level,params,speedMps},metrics:{timeTo95S:timeTo95,peakAscentAccelerationMps2:maxAcceleration,release,extraClimbM:peak-release.heightM,releaseBrakeTimeS:stopped-release.timeS,finalVelocityMps:sim.body.velocity.y},rows};
}
export function rotationRun(Sim,{automatic=false,axis='roll',prelaunch=false,params={},height=80,gestureSeconds=null,levelInitially=false}={}){
  const sim=flatDynamics(Sim,{height,params});sim.setAirStabilization(levelInitially);const start=sim.telemetry();
  let phase=prelaunch?'climb':'rotate',release=null,recoveredAt=null,rotation=0,maxRate=0,minHeight=height,maxHeight=height,minUp=1,saturationS=0,peakForceRatio=0,maxRotationHeight=height,firstContact=null;
  let plan=null,accepted=true;if(automatic){accepted=sim.startManeuver('roll');plan=structuredClone(sim._maneuver);phase='automatic';}
  const rows=[];const duration=(360/(params.rollRateDegS||sim.params.rollRateDegS))+(params.rollRateDegS||sim.params.rollRateDegS)/(params.angularAccelerationDegS2||sim.params.angularAccelerationDegS2),launchSpeed=Math.min(14,9.81*duration*.5+1.4);
  for(let k=0;accepted&&k<24/DT;k++){
    const time=k*DT;let input={};
    if(phase==='climb')input={lift:1};else if(phase==='rotate')input={[axis]:-1};
    const preStepVerticalMps=sim.body.velocity.y;
    const t=sim.advanceFixed(input,DT),w=sim.body.quaternion.conjugate().vmult(sim.body.angularVelocity),rate=(axis==='roll'?w.z:w.x)*DEG;
    if(t.fault)throw new Error(t.fault);
    if(phase==='rotate'||automatic)rotation+=rate*DT;
    maxRate=Math.max(maxRate,Math.abs(rate));minHeight=Math.min(minHeight,t.heightWorld);maxHeight=Math.max(maxHeight,t.heightWorld);minUp=Math.min(minUp,sim.body.quaternion.vmult({x:0,y:1,z:0}).y);
    saturationS+=Number(t.nozzles.some(n=>n.maxForce>0&&n.command>=n.maxForce*.985))*DT;peakForceRatio=Math.max(peakForceRatio,...t.nozzles.map(n=>n.maxForce>0?n.force/n.maxForce:0));
    const rigidContacts=sim.world.contacts.filter(c=>c.bi===sim.body||c.bj===sim.body);
    const hullContactCount=rigidContacts.filter(c=>(c.bi===sim.body?c.si:c.sj).material!==sim._wheelStopMaterial).length;
    if((t.contactCount>0||rigidContacts.length>0)&&firstContact===null)firstContact={timeS:time+DT,heightM:t.heightWorld,verticalMps:t.verticalSpeed,preStepVerticalMps,wheelContacts:t.contactCount,rigidContactCount:rigidContacts.length,hullContactCount,wheelStopContactCount:rigidContacts.length-hullContactCount,kind:hullContactCount?'hull-impact':rigidContacts.length?'rigid-wheel-stop-impact':'wheel-support'};
    if(phase==='climb'&&t.verticalSpeed>=launchSpeed-.25){phase='rotate';}
    if(phase==='rotate'&&(gestureSeconds===null?Math.abs(rotation)>=360:time>=gestureSeconds)){phase='release';release={timeS:time+DT,heightM:t.heightWorld,verticalMps:t.verticalSpeed,rotationDeg:rotation,rateDegS:rate,rollDeg:t.rollDeg,pitchDeg:t.pitchDeg};}
    if(phase==='release'&&time+DT>=release.timeS+.30){phase='recover';sim.setAirStabilization(true);}
    if(phase==='recover'&&t.levelRecovery.status==='level'&&Math.abs(t.verticalSpeed)<.2){recoveredAt=time+DT;}
    if(k%6===0)rows.push(flightRow(sim,t,time+DT,automatic?t.maneuver?.phase||'finished':phase));
    if(automatic&&!t.maneuver||recoveredAt!==null||firstContact!==null)break;
  }
  const final=sim.telemetry();return{configuration:{automatic,axis,prelaunch,params,height,gestureSeconds,levelInitially},accepted,plan,metrics:{rotationDeg:rotation,peakRateDegS:maxRate,minHeightM:minHeight,maxHeightM:maxHeight,heightLossM:height-minHeight,minimumUpDot:minUp,release,recoveredAtS:recoveredAt,saturationS,peakForceRatio,firstContact,finalHeightM:final.heightWorld,finalVerticalMps:final.verticalSpeed,finalRollDeg:final.rollDeg,finalPitchDeg:final.pitchDeg,finalHeadingDeg:final.headingDeg,finalMode:final.mode,durationS:sim.simTime-start.simTime,externalGasKg:final.externalGasSuppliedKg-start.externalGasSuppliedKg},rows};
}
