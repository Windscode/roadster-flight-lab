import {estimateLandingReserve} from './landing-reserve.js';

// This policy can stop a finite-gas program before its requested stages are
// complete. It uses the existing bounded forecast and original land maneuver;
// it never changes thrust, gas, pose, velocity, or the requested task itself.
export const FINITE_PROGRAM_RECOVERY=Object.freeze({protocol:'finite-program-reserve-recovery-1',sampleIntervalS:.1,minimumPredictedRemainingFraction:.25,maximumRecoveryS:25,stableDwellS:.5,touchdownVerticalLimitMps:1.4,scope:'Near-level, low-horizontal-speed, calm, healthy-nozzle finite-gas program flight over a sampled lower surface. A conservative advisory trigger, not a landing guarantee.'});
export function finiteProgramRecoveryDecision(sim,t){
  if(t.supplyMode!=='finite'||t.contactCount>0||t.maneuver||!t.controlAuthority||typeof sim.getClearanceEstimate!=='function')return null;
  const tilt=Math.acos(Math.max(-1,Math.min(1,t.controlAuthority.bodyUpDot)))*180/Math.PI;
  if(tilt>10||Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z)>.35||Math.hypot(t.velocity.x,t.velocity.z)>3)return null;
  if(t.nozzleFault||(t.wind?.speedMps||0)+(t.wind?.gustMps||0)>0)return null;
  const estimate=estimateLandingReserve(t,sim.params,sim.getClearanceEstimate({includeQuickRoll:false,maxDistance:120,directions:['down']}));
  const remaining=estimate.landing?.gasRemainingKg,ratio=Number.isFinite(remaining)&&t.gasMass>0?remaining/t.gasMass:null;
  const insufficient=['insufficient','insufficient-support'].includes(estimate.status),lowReserve=estimate.status==='estimated-reserve'&&ratio!==null&&ratio<FINITE_PROGRAM_RECOVERY.minimumPredictedRemainingFraction;
  if(!insufficient&&!lowReserve)return null;
  return{protocol:FINITE_PROGRAM_RECOVERY.protocol,reason:insufficient?'current-landing-estimate-insufficient':'predicted-remaining-fraction-low',atSimTimeS:t.simTime,position:{...t.position},velocity:{...t.velocity},gasMassKg:t.gasMass,pressureBar:t.pressureBar,predictedRemainingFraction:ratio,estimate,policy:FINITE_PROGRAM_RECOVERY};
}
export function beginFiniteRecovery(t,decision,maximumS=FINITE_PROGRAM_RECOVERY.maximumRecoveryS){
  return{protocol:FINITE_PROGRAM_RECOVERY.protocol,decision,originalTaskCompleted:false,state:'landing',startedAtSimTimeS:t.simTime,elapsedS:0,maximumS,stableTimeS:0,firstContact:null,hardContact:false,hullContact:false,minimumHeightM:t.position.y,peakTiltDeg:0,previous:{verticalMps:t.velocity.y,contactCount:t.contactCount},gasStartKg:t.gasMass,externalStartKg:t.externalGasSuppliedKg??0};
}
export function observeFiniteRecovery(sim,recovery,t,dt){
  recovery.elapsedS=t.simTime-recovery.startedAtSimTimeS;
  const tilt=Math.acos(Math.max(-1,Math.min(1,1-2*(t.quaternion.x*t.quaternion.x+t.quaternion.z*t.quaternion.z))))*180/Math.PI;
  recovery.minimumHeightM=Math.min(recovery.minimumHeightM,t.position.y);recovery.peakTiltDeg=Math.max(recovery.peakTiltDeg,tilt);
  if(!recovery.firstContact&&recovery.previous.contactCount===0&&t.contactCount>0){recovery.firstContact={simTimeS:t.simTime,elapsedS:recovery.elapsedS,preControlStepVerticalMps:recovery.previous.verticalMps,postControlStepVerticalMps:t.velocity.y,tiltDeg:tilt};recovery.hardContact=Math.max(0,-recovery.previous.verticalMps)>FINITE_PROGRAM_RECOVERY.touchdownVerticalLimitMps||tilt>8;}
  const contacts=sim.getContactDiagnostics?.()??[];
  recovery.hullContact||=contacts.some(c=>c.vehicleShape>=0&&c.vehicleShape<4);
  const stable=t.mode==='drive'&&t.contactCount>=3&&Math.abs(t.velocity.y)<.35&&Math.hypot(t.velocity.x,t.velocity.z)<.4&&Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z)<.15&&tilt<8;
  recovery.stableTimeS=stable?recovery.stableTimeS+dt:0;
  recovery.previous={verticalMps:t.velocity.y,contactCount:t.contactCount};
  recovery.onboardGasUsedKg=recovery.gasStartKg-t.gasMass;recovery.externalGasUsedKg=(t.externalGasSuppliedKg??0)-recovery.externalStartKg;
  if(t.fault){recovery.state='failed';return{status:'failed',reason:'有限储气提前回收出现求解异常：'+t.fault};}
  if(recovery.stableTimeS>=FINITE_PROGRAM_RECOVERY.stableDwellS-1e-9){
    recovery.state=recovery.hardContact||recovery.hullContact?'landed-with-adverse-contact':'landed';recovery.endedAtSimTimeS=t.simTime;
    return{status:recovery.state==='landed'?'cancelled':'failed',reason:recovery.state==='landed'?'有限储气：原任务因着陆储备不足提前中止，已用剩余瓶装气落稳':'有限储气：原任务提前中止，回收发生硬触地或车壳接触'};
  }
  if(recovery.elapsedS>=recovery.maximumS-1e-9){recovery.state='timeout';return{status:'timeout',reason:'有限储气：原任务提前中止，回收窗口内未确认落稳'};}
  return null;
}
