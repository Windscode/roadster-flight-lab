import {RoadsterSim,PHYSICS_HZ} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
const dt=1/PHYSICS_HZ;
export function runExperiment({kind='steer',params={},speedKmh=80,angleDeg=2}){
 if(!['steer','rise','hover','roll'].includes(kind))throw Error('未知试验类型');
 if(kind==='steer'&&(!Number.isFinite(speedKmh)||speedKmh<20||speedKmh>160||!Number.isFinite(angleDeg)||angleDeg<.2||angleDeg>5))throw Error('转向试验请输入20–160 km/h车速与0.2–5°路轮转角');
 const applied={...params};if(kind==='steer')applied.steeringAssist=false;
 const sim=new RoadsterSim(applied);for(const b of [...sim.world.bodies])if(b!==sim.body&&b.userData?.id!=='ground')sim.world.removeBody(b);
 sim.reset(kind==='hover'?'hover':'free');sim.body.position.set(0,kind==='hover'?4:.62,-350);
 if(kind!=='hover'){for(let k=0;k<240;k++)sim.step(dt);}
 sim.simTime=0;sim._stepCount=0;if(kind==='steer')sim.body.velocity.z=speedKmh/3.6;if(kind==='roll')sim.startManeuver('roll');
 const initial=sim.telemetry(),duration=kind==='hover'?10:kind==='roll'?8:4,rows=[],phases=[];
 let maxBeta=0,maxYaw=0,maxVertical=0,maxHeight=0,lossOfSupport=null,firstAir=false,touchdown=null,inverted=false,oldPhase;
 for(let k=0;k<duration*PHYSICS_HZ;k++){
  const time=k*dt,input={};if(kind==='steer'){input.steer=time>.5&&time<2.5?angleDeg*Math.PI/180/.49:0;input.throttle=Math.max(0,Math.min(.35,(speedKmh/3.6-sim.body.velocity.length())*.07+.045));}if(kind==='rise')input.lift=time<2?1:0;
  const t=sim.step(dt,input);if(t.fault)throw Error(t.fault);
  if(t.contactCount===0)firstAir=true;if(firstAir&&t.contactCount>0&&!touchdown)touchdown={time:t.simTime,speedMps:Math.abs(t.verticalSpeed),remainingGasKg:t.gasMass};
  maxBeta=Math.max(maxBeta,Math.abs(t.bodySlipDeg));maxYaw=Math.max(maxYaw,Math.abs(t.angularVelocity.y));maxVertical=Math.max(maxVertical,t.verticalSpeed);maxHeight=Math.max(maxHeight,t.heightWorld);
  inverted||=sim.body.quaternion.vmult({x:0,y:1,z:0}).y<-.9;if(t.thrustMargin<1&&lossOfSupport===null&&kind==='hover')lossOfSupport=t.simTime;
  if(t.maneuver?.phase!==oldPhase){oldPhase=t.maneuver?.phase;phases.push({time:t.simTime,phase:oldPhase||'done'});}
  if(k%6===5)rows.push({time:t.simTime,speed:t.forwardSpeedKmh,height:t.heightWorld,vertical:t.verticalSpeed,beta:t.bodySlipDeg,steer:t.steeringCentreDeg,yaw:t.angularVelocity.y*180/Math.PI,roll:t.rollDeg,gas:t.gasMass,pressure:t.pressureBar,flow:t.massFlowKgS,ve:t.effectiveExhaustVelocity,thrust:t.thrustN,grip:Math.max(...t.wheelStates.map(w=>w.gripUse)),contacts:t.contactCount});
 }
 const final=sim.telemetry();return{schemaVersion:1,modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),kind,fixture:'隔离水平试验台，地面来自同一碰撞模型；不移动当前场景车辆',input:{speedKmh,angleDeg,duration,dt},requestedParams:params,appliedParams:sim.params,assumptions:['未由Tesla实车数据标定','轮胎为载荷相关角刚度/松弛/联合摩擦近似，无独立轮速/热模型','喷管为定效率等熵理想空气近似，无真实气体/相变/罐壁传热标定'],metrics:{maxBetaDeg:maxBeta,maxYawRateDegS:maxYaw*180/Math.PI,maxVerticalMps:maxVertical,maxHeightM:maxHeight,gasUsedKg:initial.gasMass-final.gasMass,initialHoverEstimateSeconds:Number.isFinite(initial.hoverSecondsEstimate)?initial.hoverSecondsEstimate:null,lossOfSupportSeconds:lossOfSupport,touchdown,inverted,remainingGasKg:final.gasMass},phases,rows};
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope)self.onmessage=e=>{try{self.postMessage({ok:true,report:runExperiment(e.data)});}catch(error){self.postMessage({ok:false,error:error.message});}};
