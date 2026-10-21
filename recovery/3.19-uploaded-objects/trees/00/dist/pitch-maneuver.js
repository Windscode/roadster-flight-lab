import {sampleRollManeuver} from './vehicle-models.js';
import {sampleQuickRollHeadroom} from './vehicle-clearance.js';

// A commanded angular trajectory, not an animation or a body-state override.
// Its longer pitch lever arm is accompanied by the actual, much larger Ixx.
// Main jets still point only along +body Y; the inverted half is ballistic.
export function pitchManeuverProfile(){
  return {kind:'controlled-pitch-1',angleRad:2*Math.PI,rateRadS:5*Math.PI/3,
    accelerationRadS2:25*Math.PI/9,rampS:.6,cruiseS:.6,durationS:1.8};
}

export function manualPitchEnvelope(sim){
  const input=sim._lastInput??{},rate=Math.abs(input.pitch??0)*sim.params.pitchRateDegS;
  if(rate<.01||sim._maneuver||sim.mode!=='hover')return {active:false,mode:'manual-rate'};
  const radians=rate*Math.PI/180,alpha=sim.params.angularAccelerationDegS2*Math.PI/180;
  const nominalFullTurnS=2*Math.PI/radians+radians/(2*alpha);
  const gravityOnlyInvertedDropM=.5*sim.params.gravity*(Math.PI/radians)**2;
  const surface=sim.traceSurface(sim.body.position,{x:0,y:-1,z:0},220),clearanceM=surface?.distance??null;
  return {active:true,mode:'manual-rate',requestedRateDegS:rate,nominalFullTurnS,clearanceM,gravityOnlyInvertedDropM,
    lowClearanceWarning:clearanceM!==null&&clearanceM<gravityOnlyInvertedDropM+2.4,
    minimumSafeHeightM:null,
    message:`手动 ${rate.toFixed(0)}°/s，一周约 ${nominalFullTurnS.toFixed(1)} s，不含回平 / 着陆；倒置无法持续承重。U 是独立受控后翻`,
    scope:'Reference-rate time and a gravity-only scale, not a certified minimum altitude. Actual jets, inertia, initial velocity, valves and G recovery change the trajectory.'};
}

export const PITCH_OPERATIONAL_ENVELOPE=Object.freeze({policy:'bounded-pitch-envelope-318',maxHorizontalSpeedMps:18,maxLateralSpeedMps:1,maxSteerInput:.08,maxYawRateRadS:.25,maxSlopeDeg:5,maxWindPeakMps:12,
  scope:'Bounded model operating guard. Combined limits require sampled clearance and real supply/torque margins; not an arbitrary-condition safety certificate.'});

export function startPitchManeuver(sim){
  const p=sim.params,b=sim.body,profile=pitchManeuverProfile(),origin={x:b.position.x,y:b.position.y,z:b.position.z};
  const reject=reason=>{sim.status='受控后翻预检：'+reason;return false;};
  if(sim._maneuver)return reject('已有自动动作，请完成或取消后再开始');
  const up=b.quaternion.vmult({x:0,y:1,z:0});
  if(up.y<Math.cos(10*Math.PI/180))return reject('初始倾角须不超过 10°，请先回正');
  if(b.angularVelocity.length()>.5)return reject('初始角速度过大，请先松键制动');
  if(Math.hypot(b.velocity.x,b.velocity.z)>18)return reject('当前水平速度超过已验证的 18 m/s 起始范围');
  const envelope=PITCH_OPERATIONAL_ENVELOPE,localVelocity=b.quaternion.conjugate().vmult(b.velocity),localRate=b.quaternion.conjugate().vmult(b.angularVelocity);
  if(Math.abs(localVelocity.x)>envelope.maxLateralSpeedMps+1e-9)return reject('横向速度超过已验证的 1 m/s；先停止侧滑');
  if(Math.abs(sim._lastInput?.steer??0)>envelope.maxSteerInput||Math.abs(localRate.y)>envelope.maxYawRateRadS)return reject('转向 / 偏航仍在持续；回直并稳定后再启动');
  const wind=sim.getWind(),windPeak=(wind?.speedMps??0)+(wind?.gustMps??0);
  if(windPeak>envelope.maxWindPeakMps)return reject('规定风峰值超过本轮 12 m/s 受控动作范围');
  const below=sim.traceSurface(b.position,{x:0,y:-1,z:0},220);
  const grounded=sim._contactCount>=2||(below?.distance<.8&&Math.abs(b.velocity.y)<.7);
  const slopeDeg=below?Math.acos(Math.max(-1,Math.min(1,below.normal.y)))*180/Math.PI:null;
  if(grounded&&slopeDeg!==null&&slopeDeg>envelope.maxSlopeDeg+1e-7)return reject('支撑面坡度超过本轮 5° 受控动作范围');
  if(grounded&&sim._contactCount>0&&sim._contactCount<4)return reject('车轮支撑不完整；四轮稳定后再启动');
  const availableAccel=sim._availableLiftForce()/b.mass-p.gravity,netAccel=.88*availableAccel;
  if(availableAccel<6||sim._energyUsed>=p.batteryKWh)return reject('起跳与制动推力不足');
  const authority=sim.getControlAuthority(),pitchTorque=Math.min(authority.positiveTorqueUpperNm.x,-authority.negativeTorqueLowerNm.x);
  const referenceTorque=b.inertia.x*profile.accelerationRadS2,torqueMargin=pitchTorque/Math.max(1,referenceTorque);
  if(torqueMargin<1.65)return reject('双向俯仰力矩 / 阀门跟踪余量不足');
  const lever=Math.abs(sim._nozzles[0].position.z),minimumRotationClearanceM=2.65;
  const launchVelocity=p.gravity*profile.cruiseS*.5+1.8;
  const launchTime=Math.max(0,launchVelocity-b.velocity.y)/netAccel+4*p.valveRiseTime+.15;
  const arrestDistance=Math.max(0,-b.velocity.y)**2/(2*netAccel)+Math.max(0,-b.velocity.y)*4*p.valveRiseTime;
  if(!grounded&&below&&below.distance<2.4+arrestDistance)return reject('下降速度下的车长旋转 / 制动净空不足');
  let estimatedY=0,estimatedVy=launchVelocity,peakY=0,peakVy=launchVelocity,rotationPeak=0;
  for(let i=0;i<240;i++){
    const sample=sampleRollManeuver(profile,(i+.5)/240*profile.durationS),step=profile.durationS/240;
    const coupledLift=b.inertia.x/b.mass/lever*Math.abs(sample.accelerationRadS2);
    estimatedVy+=(coupledLift*Math.cos(sample.angleRad)-p.gravity)*step;estimatedY+=estimatedVy*step;
    peakVy+=(coupledLift*Math.max(0,Math.cos(sample.angleRad))-p.gravity)*step;peakY+=peakVy*step;rotationPeak=Math.max(rotationPeak,peakY);
  }
  const launchRise=Math.max(0,minimumRotationClearanceM-(below?.distance??origin.y),(b.velocity.y+launchVelocity)*launchTime*.5);
  const peakRise=launchRise+rotationPeak+2.4;
  // Sample the current footprint and its nominal horizontal coast path. These
  // rays reject obvious roofs; they are explicitly not a swept-volume proof.
  const headroom=[];
  const sampleTimes=Array.from({length:21},(_,i)=>i*.25);
  for(const t of sampleTimes){
    const position={x:origin.x+b.velocity.x*t,y:origin.y,z:origin.z+b.velocity.z*t};
    headroom.push(sampleQuickRollHeadroom(position,(o,d,r)=>sim.traceSurface(o,d,r),peakRise+2.5));
  }
  if(headroom.some(h=>h.distanceM!==null&&h.distanceM<peakRise+2.4))return reject('车长旋转包络 / 预计滑行路径上方净空不足');
  const launchImpulse=b.mass*(Math.max(0,launchVelocity-b.velocity.y)+p.gravity*launchTime);
  const rotationImpulse=2*b.inertia.x*profile.rateRadS/lever;
  const arrestSpeed=Math.max(0,-estimatedVy),arrestTime=arrestSpeed/netAccel+4*p.valveRiseTime+.15;
  const arrestImpulse=b.mass*(arrestSpeed+p.gravity*arrestTime),reserveImpulse=b.mass*p.gravity*1.5;
  const requiredImpulse=1.16*(launchImpulse+rotationImpulse+arrestImpulse+reserveImpulse),availableImpulse=sim._hoverBudget().impulseNs;
  if(p.supplyMode==='finite'&&availableImpulse<requiredImpulse)return reject(`剩余冲量 ${(availableImpulse/1000).toFixed(1)} kN·s 低于后翻 / 回稳预算 ${(requiredImpulse/1000).toFixed(1)} kN·s`);
  sim.setMode('hover');
  sim._maneuver={name:'pitch',phase:'climb',time:0,angle:0,duration:profile.durationS,origin,originGrounded:grounded,returnHeight:origin.y,
    launchVelocity,launchTime,launchAccelerationMps2:netAccel,minimumRotationClearanceM,profile,actualPitchRad:0,
    requiredImpulseNs:requiredImpulse,plannedPeakHeight:origin.y+peakRise,autoLand:grounded,
    preflight:{policy:'controlled-pitch-1',operationalEnvelope:{...envelope,initialHorizontalMps:Math.hypot(b.velocity.x,b.velocity.z),initialLateralMps:localVelocity.x,initialYawRateRadS:localRate.y,initialSteer:sim._lastInput?.steer??0,supportSlopeDeg:slopeDeg,windPeakMps:windPeak},referenceTorqueNm:referenceTorque,pitchTorqueUpperNm:pitchTorque,torqueMargin,leverArmM:lever,
      availableAccelMps2:availableAccel,launchImpulseNs:launchImpulse,rotationImpulseNs:rotationImpulse,arrestImpulseNs:arrestImpulse,
      settlingImpulseNs:reserveImpulse,impulseMargin:1.16,predictedRotationEndVerticalMps:estimatedVy,
      predictedRotationDisplacementM:estimatedY,availableImpulseNs:Number.isFinite(availableImpulse)?availableImpulse:null,
      headroomEstimated:true,headroomSamples:headroom.length*5,headroomHorizonS:5,headroomScope:'Five upward rays at 0.25 s coast samples through 5 s. Conservative sampled roofs only; no swept-volume or changing-obstacle certificate'}};
  sim._heightTarget=origin.y;sim.status='受控后空翻：自动起跳 → 喷口俯仰闭环 → 物理着陆；区别于 E+1 手动定率';return true;
}
