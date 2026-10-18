import {RoadsterSim,PHYSICS_HZ} from './physics.js';
import {MODEL_VERSION} from './vehicle-models.js';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from './model-build.js';
import {EXPERIMENTS,PROTOCOL_VERSION,normalizeResearchRequest,protocolId} from './research-protocol.js';
const dt=1/PHYSICS_HZ,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rad=Math.PI/180,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
function snapshot(t){return{position:t.position,velocity:t.velocity,quaternion:t.quaternion,angularVelocity:t.angularVelocity,gasKg:t.gasMass,temperatureK:t.gasTemperatureK,pressureBar:t.pressureBar,mode:t.mode,contacts:t.contactCount};}
function researchBeta(t){
 const q=t.quaternion,f={x:2*(q.x*q.z+q.w*q.y),z:1-2*(q.x*q.x+q.y*q.y)},h=Math.hypot(f.x,f.z);
 if(h<.9||t.contactCount<3)return null;
 const forward=(t.velocity.x*f.x+t.velocity.z*f.z)/h;
 if(forward<2)return null;
 return Math.atan2((t.velocity.x*f.z-t.velocity.z*f.x)/h,forward)/rad;
}
export function runExperiment(raw={}){
 const request=normalizeResearchRequest(raw),{kind,speedKmh,angleDeg,steerInput,steeringProtocol}=request,applied={...request.params},overrides=[];
 if(kind==='steer'&&steeringProtocol==='wheel'){applied.steeringAssist=false;overrides.push('固定路轮角协议强制关闭道路限舵辅助；比较辅助应选择固定驾驶输入协议');}
 const sim=new RoadsterSim(applied);
 for(const b of [...sim.world.bodies])if(b!==sim.body&&b.userData?.id!=='ground')sim.world.removeBody(b);
 sim.reset(kind==='hover'?'hover':'free');
 const initialHeight=kind==='hover'?4:kind==='attitude'?request.heightM:.62;
 sim.body.position.set(0,initialHeight,-350);sim.body.previousPosition.copy(sim.body.position);sim.body.aabbNeedsUpdate=true;
 // Moving a fixture must move the controller's position reference as well.
 sim._positionTarget.copy(sim.body.position);sim._heightTarget=initialHeight;sim._headingTarget=0;
 if(!['hover','attitude'].includes(kind)){for(let k=0;k<240;k++)sim.step(dt);}
 sim.simTime=0;sim._stepCount=0;sim._accumulator=0;
 if(['steer','brake'].includes(kind))sim.body.velocity.z=speedKmh/3.6;
 if(kind==='attitude'){
  sim.body.quaternion.setFromEuler(-10*rad,0,request.initialRollDeg*rad,'YXZ');sim.body.previousQuaternion.copy(sim.body.quaternion);
  sim.body.angularVelocity.set(.2,0,.3);sim.setAirStabilization(request.stabilization);
 }
 if(kind==='hover'){sim.setParam('hoverHeight',4);overrides.push('本悬停协议高度参考固定4米；不扫描hoverHeight');}
 const initial=sim.telemetry(),duration=EXPERIMENTS[kind].duration,rows=[],phases=[],events=[],warnings=[];
 let accepted=true;if(kind==='roll')accepted=sim.startManeuver('roll')!==false;
 if(!accepted)events.push({time:0,type:'maneuver_rejected',note:'气量、姿态或净空预检未通过'});
 let previous=initial,maxBeta=0,betaSamples=0,maxYaw=0,maxVertical=0,maxHeight=initial.heightWorld,minHeight=initial.heightWorld;
 let maxRoll=0,rollTravel=0,oldRoll=initial.rollDeg*rad,inverted=false,firstAir=false,touchdown=null,stableLanding=null,stableTimer=0;
 let capabilityLoss=null,heightLoss=null,groundTouch=null,heightFailureTimer=0,gasEmpty=null,stop=null,stopCandidate=null,stopTimer=0;
 let totalFlow=0,impulse=0,saturationSeconds=0,residualSquared=0,activeControlSteps=0,heightSquared=0,heightSamples=0,maxPositionError=0;
 let speedSquared=0,speedSum=0,speedMin=Infinity,speedMax=-Infinity,speedCount=0,speedIntegral=0,brakeDistance=0,brakeStart=null;
 let maxHeading=0,maxLateral=0,hullContacts=0,oldPhase,peakAfterRelease=0,releaseHeight=null,recoveryTimer=0,recoveredAt=null,driverSaturationSeconds=0;
 const steps=accepted?duration*PHYSICS_HZ:0;
 for(let k=0;k<steps;k++){
  const time=k*dt,input={};
  if(kind==='steer'||kind==='brake'&&time<.5){
   // Longitudinal PI test driver acts only through ordinary throttle/brake.
   const error=speedKmh/3.6-previous.forwardSpeedKmh/3.6;
   const v=Math.max(0,previous.forwardSpeedKmh/3.6),drag=.5*applied.airDensity*applied.dragArea*v*v;
   const demand=drag+previous.mass*clamp(.7*error+.4*speedIntegral,-2.5,2.5),available=Math.min(applied.maxMotorForce,applied.motorPower/Math.max(1,v));
   const saturated=demand>available||demand< -applied.brakeForce;if(saturated)driverSaturationSeconds+=dt;
   if(!saturated||error*demand<0)speedIntegral=clamp(speedIntegral+error*dt,-3,3);
   if(demand>=0)input.throttle=clamp(demand/Math.max(1,applied.maxMotorForce),0,1);else input.brake=clamp(-demand/applied.brakeForce,0,1);
  }
  if(kind==='steer')input.steer=time>=.5&&time<2.5?(steeringProtocol==='wheel'?angleDeg*rad/.49:steerInput):0;
  if(kind==='brake'&&time>=.5){input.brake=1;brakeStart??={time:previous.simTime,position:{...previous.position}};}
  if(kind==='rise')input.lift=time<2?1:0;
  const t=sim.step(dt,input);if(t.fault)throw Error('试验无效：'+t.fault);
  const up=sim.body.quaternion.vmult({x:0,y:1,z:0}).y,horizontal=Math.hypot(t.velocity.x,t.velocity.z),beta=researchBeta(t);
  if(beta!==null){maxBeta=Math.max(maxBeta,Math.abs(beta));betaSamples++;}
  maxYaw=Math.max(maxYaw,Math.abs(t.angularVelocity.y));maxVertical=Math.max(maxVertical,t.verticalSpeed);maxHeight=Math.max(maxHeight,t.heightWorld);minHeight=Math.min(minHeight,t.heightWorld);
  maxRoll=Math.max(maxRoll,Math.abs(t.rollDeg));rollTravel+=wrap(t.rollDeg*rad-oldRoll);oldRoll=t.rollDeg*rad;inverted||=up<-.9;
  if(t.contactCount===0)firstAir=true;
  if(firstAir&&t.contactCount>0&&!touchdown)touchdown={time:t.simTime,speedMps:Math.max(0,-previous.verticalSpeed),postStepSpeedMps:Math.abs(t.verticalSpeed),remainingGasKg:t.gasMass,definition:'首次承载轮胎射线；垂速取接触前一个120Hz样本，不等于接触冲量求解峰值'};
  if(['hover','attitude'].includes(kind)&&t.contactCount>0&&groundTouch===null)groundTouch=t.simTime;
  if(kind==='roll'&&firstAir&&t.contactCount>=3&&up>.96&&Math.abs(t.verticalSpeed)<.65&&horizontal<.4&&sim.body.angularVelocity.length()<.15&&t.mode==='drive')stableTimer+=dt;else stableTimer=0;
  if(stableTimer>=.5&&!stableLanding)stableLanding={time:t.simTime,confirmationSeconds:.5,remainingGasKg:t.gasMass};
  if(t.thrustMargin<1&&capabilityLoss===null)capabilityLoss=t.simTime;
  const reference=kind==='attitude'?request.heightM:t.targetAltitude,heightError=t.heightWorld-reference;
  if(['hover','attitude','rise'].includes(kind)){heightSquared+=heightError**2;heightSamples++;}
  if(['hover','attitude'].includes(kind)&&Math.abs(heightError)>.75)heightFailureTimer+=dt;else heightFailureTimer=0;
  if(heightFailureTimer>=.25&&heightLoss===null)heightLoss=t.simTime;
  if(t.gasMass<.01&&gasEmpty===null)gasEmpty=t.simTime;
  totalFlow+=t.massFlowKgS*dt;impulse+=t.thrustN*dt;
  const saturated=t.nozzles.some(n=>n.maxForce>1&&n.command>=n.maxForce*.98);if(saturated)saturationSeconds+=dt;
  if(t.desiredWrench.some(v=>Math.abs(v)>1)){residualSquared+=t.allocationError**2;activeControlSteps++;}
  if(kind==='attitude'&&Math.abs(t.rollDeg)<2&&Math.abs(t.pitchDeg)<2&&Math.abs(heightError)<.75&&sim.body.angularVelocity.length()<.15&&groundTouch===null)recoveryTimer+=dt;else recoveryTimer=0;
  if(recoveryTimer>=.5&&recoveredAt===null)recoveredAt=t.simTime;
  if(kind==='steer'){
   const speed=t.forwardSpeedKmh;speedSquared+=(speed-speedKmh)**2;speedSum+=speed;speedMin=Math.min(speedMin,speed);speedMax=Math.max(speedMax,speed);speedCount++;
  }
  if(kind==='brake'&&brakeStart){
   brakeDistance+=.5*(horizontal+Math.hypot(previous.velocity.x,previous.velocity.z))*dt;
   if(horizontal<.1&&t.contactCount>=3){stopCandidate??={time:t.simTime,distance:brakeDistance};stopTimer+=dt;}else{stopTimer=0;stopCandidate=null;}
   if(stopTimer>=.5&&!stop)stop={timeSeconds:stopCandidate.time-brakeStart.time,distanceM:stopCandidate.distance,confirmedAt:t.simTime,thresholdMps:.1,confirmationSeconds:.5};
  }
  maxHeading=Math.max(maxHeading,Math.abs(wrap(t.headingDeg*rad))/rad);maxLateral=Math.max(maxLateral,Math.abs(t.position.x));maxPositionError=Math.max(maxPositionError,Math.hypot(t.position.x,t.position.z+350));
  const hull=sim.world.contacts.filter(c=>c.bi===sim.body||c.bj===sim.body).length;if(hull&&!hullContacts)events.push({time:t.simTime,type:'rigid_body_contact'});hullContacts+=hull;
  if(kind==='rise'&&time>=2){releaseHeight??=previous.heightWorld;peakAfterRelease=Math.max(peakAfterRelease,t.heightWorld-releaseHeight);}
  const phase=t.maneuver?.phase||'done';if(phase!==oldPhase){oldPhase=phase;phases.push({time:t.simTime,phase});}
  if(k%6===5)rows.push({time:t.simTime,speed:t.forwardSpeedKmh,height:t.heightWorld,targetHeight:reference,heightError,vertical:t.verticalSpeed,beta,betaValid:beta!==null?1:0,steer:t.steeringCentreDeg,steerInput:input.steer||0,throttle:input.throttle||0,brake:input.brake||0,yaw:t.angularVelocity.y/rad,roll:t.rollDeg,rollTravel:rollTravel/rad,pitch:t.pitchDeg,gas:t.gasMass,temperature:t.gasTemperatureK,pressure:t.pressureBar,flow:t.massFlowKgS,ve:t.effectiveExhaustVelocity,thrust:t.thrustN,thrustMargin:t.thrustMargin,allocationError:t.allocationError,saturated:saturated?1:0,grip:Math.max(...t.wheelStates.map(w=>w.gripUse)),contacts:t.contactCount,x:t.position.x,z:t.position.z,positionError:Math.hypot(t.position.x,t.position.z+350)});
  previous=t;
 }
 const final=sim.telemetry(),speedRmse=speedCount?Math.sqrt(speedSquared/speedCount):null,completeRotation=Math.abs(rollTravel/rad)>=350&&inverted;
 if(kind==='steer'&&speedRmse>speedKmh*.05)warnings.push('实际速度RMSE超过初速5%，不宜解释为定速转向响应');
 if(kind==='steer'&&betaSamples<steps*.9)warnings.push('前进/接地/姿态门限有效侧偏样本不足90%');
 if(hullContacts)warnings.push('出现刚体接触，当前响应含接触/机械止挡作用');
 if(heightLoss!==null&&['hover','attitude'].includes(kind))warnings.push('高度误差持续超限；不应只依据额定推重比判断控制成功');
 let outcome='completed';
 if(!accepted)outcome='rejected';
 else if(kind==='roll')outcome=completeRotation&&stableLanding&&hullContacts===0?'stable_landing':'window_ended_without_stable_landing';
 else if(kind==='brake')outcome=stop?'stable_stop':'window_ended_without_stop';
 else if(kind==='attitude')outcome=recoveryTimer>=.5&&groundTouch===null?'recovered':'not_recovered_in_window';
 else if(kind==='hover')outcome=heightLoss===null&&groundTouch===null&&maxPositionError<.75&&Math.abs(final.rollDeg)<2&&Math.abs(final.pitchDeg)<2?'held_in_window':'hover_not_held';
 for(const [type,time]of [['thrust_capability_below_weight',capabilityLoss],['sustained_height_error',heightLoss],['ground_touch',groundTouch],['gas_empty',gasEmpty],['stable_attitude_recovery',recoveredAt]])if(time!==null)events.push({time,type});
 const metrics={maxBetaDeg:betaSamples?maxBeta:null,betaValidFraction:steps?betaSamples/steps:0,maxYawRateDegS:maxYaw/rad,maxVerticalMps:maxVertical,maxHeightM:maxHeight,minHeightM:minHeight,maxAbsRollDeg:maxRoll,rollTravelDeg:rollTravel/rad,completeRotation,inverted,
  gasUsedKg:initial.gasMass-final.gasMass,throughputKg:totalFlow,massBalanceErrorKg:applied.supplyMode==='finite'?initial.gasMass-final.gasMass-totalFlow:0,deliveredImpulseNs:impulse,remainingGasKg:final.gasMass,
  initialHoverEstimateSeconds:Number.isFinite(initial.hoverSecondsEstimate)?initial.hoverSecondsEstimate:null,lossOfSupportSeconds:capabilityLoss,heightHoldLostSeconds:heightLoss,groundTouchSeconds:groundTouch,touchdown,stableLanding,stop,
  speedRmseKmh:speedRmse,meanSpeedKmh:speedCount?speedSum/speedCount:null,minSpeedKmh:speedCount?speedMin:null,maxSpeedKmh:speedCount?speedMax:null,heightRmseM:heightSamples?Math.sqrt(heightSquared/heightSamples):null,maxPositionErrorM:maxPositionError,finalPositionErrorM:Math.hypot(final.position.x,final.position.z+350),releaseOvershootM:releaseHeight===null?null:peakAfterRelease,
  recoveredAtSeconds:recoveredAt,recoveryMaintainedToEnd:recoveryTimer>=.5,driverSaturationSeconds,nozzleSaturationSeconds:saturationSeconds,allocationRmse:activeControlSteps?Math.sqrt(residualSquared/activeControlSteps):0,maxHeadingDeviationDeg:maxHeading,maxLateralDeviationM:maxLateral,hullContactSamples:hullContacts};
 return{schemaVersion:2,protocolVersion:PROTOCOL_VERSION,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,modelSourceHashes:MODEL_SOURCE_HASHES,runId:protocolId(request),generatedAt:new Date().toISOString(),kind,outcome,warnings,request,fixture:'隔离水平地面；车辆/轮胎/控制/气源使用同一120Hz求解器；不改变城市中的车辆',
  input:{speedKmh,angleDeg,steerInput,steeringProtocol,duration,dt,settleSeconds:['hover','attitude'].includes(kind)?0:2,sampleHz:20},requestedParams:request.params,appliedParams:sim.params,overrides,initialState:snapshot(initial),finalState:snapshot(final),
  definitions:{beta:'水平前进投影atan2(v_lateral,v_forward)，要求v_forward≥2m/s、前向水平投影≥0.9、至少3轮承载；否则null',rotation:'解缠滚转角累计≥350°且经过倒置，限定本低俯仰协议；非任意多轴SO(3)证明',landing:'至少3轮承载、直立、垂速<0.65、平面速度<0.4m/s、角速<0.15rad/s、drive持续0.5秒',heightLoss:'仅高度保持/稳姿协议：高度误差绝对值>0.75m持续0.25秒；有意弹道下降不计入',recovery:'姿态误差<2°、角速<0.15rad/s、高度误差<0.75m且未触地，持续0.5秒；终点仍满足',stop:'制动后平面速度<0.1m/s且至少3轮承载持续0.5秒'},
  assumptions:['未经Tesla实车试验数据标定；软件内部响应不等于真实车辆预测','轮胎为角刚度/载荷/松弛/联合摩擦近似，无独立轮速和热模型','喷管为定效率等熵理想空气近似，无真实高压气体、喷管几何与罐壁传热标定','同一固定步长下可重复不等于已验证模型精度；置信区间需要可信参数分布'],metrics,phases,events,rows};
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope)self.onmessage=e=>{try{self.postMessage({ok:true,report:runExperiment(e.data)});}catch(error){self.postMessage({ok:false,error:error.message});}};
