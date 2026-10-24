/* Bounded, observable pilot procedures. These emit ordinary driver commands;
 * the existing solver, recorder and replay executor retain physical authority.
 * This module never integrates physics or assigns a rigid-body state. */
import {roadWheelAngle} from './vehicle-models.js';

export const CONTROL_CAPTURE_PROTOCOL_VERSION='control-capture-2';
export const CONTROL_CAPTURE_PROTOCOLS=Object.freeze([
  ...[10,54,90].map(speedKmh=>({id:`steer-${speedKmh}-gentle`,type:'steer',steerInput:.2,speedKmh,label:`${speedKmh} km/h · 20% 轻幅转向`,labelEn:`${speedKmh} km/h · 20% steering`,description:'从静止真实加速，连续稳速 2 s 后保持 20% 转向输入 4 s；冻结稳速油门。此为模拟轴输入，不能冒充键盘短按。路面采用当前设定。',descriptionEn:'Physically accelerate from rest, stabilize for 2 s, then hold a 20% analog steering input for 4 s at the settled throttle. This is not a keyboard tap. Uses the current road condition.'})),
  {id:'steer-54-tap',type:'steer',steerInput:1,pulseSeconds:.15,speedKmh:54,label:'54 km/h · A / D 短按 150 ms',labelEn:'54 km/h · A / D tap, 150 ms',description:'连续稳速 2 s 后输入全幅转向 150 ms，再回中；完整记录后续 4 s。模拟的是按键命令时序，不是设备延迟或用户手感验收。',descriptionEn:'Stabilize for 2 s, command full steering for 150 ms, then release. Retain the complete 4 s response. This reproduces a command sequence, not device latency or subjective driving feel.'},
  {id:'steer-90-coast',type:'steer',steerInput:.5,coast:true,speedKmh:90,label:'90 km/h · 松油 + 50% 转向',labelEn:'90 km/h · Lift off + 50% steering',description:'连续稳速 2 s 后松油，并保持 50% 转向输入 4 s；包含松油电机制动与抓地竞争；回充按实际轮功和电池充电限制计入资源账本。',descriptionEn:'After 2 s of stable speed, lift off and hold 50% steering for 4 s. Includes motor-retarding braking and combined tire-force demand; regeneration follows actual wheel work and battery charging limits in the resource ledger.'},
  {id:'steer-54',type:'steer',label:'54 km/h · 稳速后转向',labelEn:'54 km/h · Stabilized steering step',speedKmh:54,description:'实际加速并连续稳速 2 s；固定全幅转向 4 s，油门冻结为稳速末段值，再制动。需要城市开阔平地。',descriptionEn:'Physically accelerate and hold speed for 2 s; apply full steering for 4 s with the settled throttle frozen, then brake. Requires open, level city ground.'},
  {id:'steer-90',type:'steer',label:'90 km/h · 稳速后转向',labelEn:'90 km/h · Stabilized steering step',speedKmh:90,description:'与 54 km/h 相同输入协议；需更长预备段和转向净空。速度损失含冻结油门下的实际驱动、阻力及轮胎耗散。',descriptionEn:'Same input procedure as 54 km/h, with a longer preparation and turn envelope. Speed loss includes real drive, drag and tire dissipation at the frozen throttle.'},
  {id:'vertical-8-release',type:'vertical',label:'E 8 m/s · 松键制动与 Q 接地',labelEn:'E 8 m/s · Release braking and Q landing',description:'从稳定空中初态开始，显式设 8 m/s 上升 5 s，松键至垂速稳定，再持续 Q 至实际接地、阀门关闭；最后恢复原升降设定。',descriptionEn:'Start from stable flight; explicitly set 8 m/s, hold E for 5 s, release until settled, then hold Q until supported with closed valves. Restore the original vertical setting at the end.'},
  ...[['roll-z-level','roll',1,'Z'],['roll-b-level','roll',-1,'B'],['pitch-1-level','pitch',1,'1'],['pitch-2-level','pitch',-1,'2']].map(([id,axis,sign,key])=>({id,type:'level',axis,sign,key,label:`${key} → 松键 → G · 姿态恢复`,labelEn:`${key} → Release → G · Attitude recovery`,description:`关闭回正，以 ${key} 施加0.9 s 有界姿态输入，松键 1 s，再开启 G；保留姿态时序、恢复时间与掉高。`,descriptionEn:`Disable levelling, apply ${key} for 0.9 s, release for 1 s, then enable G. Retain the attitude series, recovery time and height loss.`})),
].map(Object.freeze));

// Existing outer-city ground, not new isolated test tracks. The host may offer
// an explicit scene reset to these zero-speed initial conditions BEFORE it
// starts recording. The procedure itself never performs this initialization.
export const CONTROL_CAPTURE_STARTS=Object.freeze({
  ...Object.fromEntries(['steer-10-gentle','steer-54-gentle','steer-54-tap','steer-90-gentle','steer-90-coast'].map(id=>[id,Object.freeze({id:'capture-'+id,protocolId:id,label:'外圈采集起点 · 静止',labelEn:'Outer-city capture start · At rest',position:Object.freeze([id.includes('-90')?-300:id==='steer-54-tap'?-170:-120,.62,-602]),yaw:Math.PI/2,steerSign:-1,mode:'drive',initialSpeedMps:0})])),
  'steer-54':Object.freeze({id:'capture-steer-54',protocolId:'steer-54',label:'54 km/h 外圈采集起点 · 静止',labelEn:'54 km/h outer-city capture start · At rest',position:Object.freeze([-170,.62,-602]),yaw:Math.PI/2,steerSign:-1,mode:'drive',initialSpeedMps:0}),
  'steer-90':Object.freeze({id:'capture-steer-90',protocolId:'steer-90',label:'90 km/h 外圈采集起点 · 静止',labelEn:'90 km/h outer-city capture start · At rest',position:Object.freeze([-375,.62,-602]),yaw:Math.PI/2,steerSign:-1,mode:'drive',initialSpeedMps:0}),
});

const HZ=120,DT=1/HZ,DEG=180/Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),copy=v=>JSON.parse(JSON.stringify(v));
const horizontal=t=>Math.hypot(t.velocity.x,t.velocity.z),angular=t=>Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const driverActive=i=>Object.entries(i||{}).some(([key,v])=>key==='boost'?v===true:typeof v==='number'&&Math.abs(v)>.025);
const finite=v=>Number.isFinite(v)?v:null;
const curveNumber=v=>Number.isFinite(v)?Math.round(v*1e6)/1e6:null;
export const CONTROL_CAPTURE_COLUMNS=Object.freeze({
  wheels:Object.freeze(['id','contact','steerDeg','normalLoadN','slipAngleDeg','relaxedSlipDeg','longitudinalSlip','frictionUtilization','surfaceMu','longitudinalForceN','lateralForceN','driveTorqueNm','brakeTorqueNm','absActive','tcsActive']),
  nozzles:Object.freeze(['id','commandN','actualForceN','availableForceN']),
});
function frame(t){const a=t.headingDeg/DEG;return{forward:{x:Math.sin(a),y:0,z:Math.cos(a)},left:{x:Math.cos(a),y:0,z:-Math.sin(a)}};}
function point(origin,forward,left,s,l=0){return{x:origin.x+forward.x*s+left.x*l,y:origin.y,z:origin.z+forward.z*s+left.z*l};}
function tilted(t){const q=t.quaternion;return Math.acos(clamp(1-2*(q.x*q.x+q.z*q.z),-1,1))*DEG;}

/** Read-only collision probes. A sampled envelope is a preflight check, not a
 * proof of a collision-free trajectory; every actual contact is still checked. */
export function checkControlCaptureClearance(sim,definition,t,{steerSign=1,atMeasurement=false}={}){
  if(typeof sim.traceSurface!=='function')return{ok:false,reason:'当前模型没有净空射线接口，不能开始此采集。',reasonEn:'The current model has no clearance ray interface.'};
  if(t.worldType==='windlab')return{ok:false,reason:'风场室长度或顶部净空不足；请先驶入城市开阔区域。',reasonEn:'The wind laboratory is too short or lacks overhead clearance. Navigate to open city ground first.'};
  const origin=t.position,{forward,left}=frame(t),checkSegment=(a,b,width=1.2)=>{
    const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<.01)return null;const dir={x:dx/length,y:0,z:dz/length},side={x:dir.z,y:0,z:-dir.x};
    for(const offset of [-width,0,width])for(const y of [origin.y-.35,origin.y+.4]){const hit=sim.traceSurface({x:a.x+side.x*offset,y,z:a.z+side.z*offset},dir,length+2.5);if(hit)return hit;}
    return null;
  };
  if(definition.type==='steer'){
    // After the acceleration-limited approach, reserve the mandatory 2 s
    // quiet-speed window plus 5 s for the PI approach/held-pedal settling.
    // The previous 4 s allowance underestimated the actual default 54/90 km/h
    // preparation by 36/76 m. This remains a planning estimate: parameters can
    // change the distance, so the actual stabilized position is checked again.
    const v=definition.speedKmh/3.6,initial=Math.max(0,t.forwardSpeedKmh/3.6),preparation=atMeasurement?0:Math.max(0,(v*v-initial*initial)/(2*2.5))+v*(2+5)+8;
    const angle=roadWheelAngle(definition.steerInput??1,v,sim.params),mu=sim.params.tireMu*(sim.params.roadSurface==='dry'?1:sim.params.wetGripMultiplier),radius=Math.max(6,v*v/Math.max(.1,mu*sim.params.gravity),2.84/Math.max(.005,Math.tan(Math.abs(angle))));
    if(preparation>0){const hit=checkSegment(point(origin,forward,left,2.5),point(origin,forward,left,preparation));if(hit)return{ok:false,reason:`预备段前方约 ${hit.distance.toFixed(1)} m 有障碍；此速度需约 ${preparation.toFixed(0)} m 平直预备空间。`,reasonEn:`An obstacle is about ${hit.distance.toFixed(1)} m ahead. This speed needs about ${preparation.toFixed(0)} m of level preparation space.`,preparationM:preparation};}
    const anchor=point(origin,forward,left,preparation),curves=[];
    // A released short pulse travels much straighter than a held step. Include
    // that straight envelope as well as the deliberately conservative arcs.
    if(definition.pulseSeconds){const hit=checkSegment(anchor,point(anchor,forward,left,v*4));if(hit)return{ok:false,reason:'短按后的前方净空不足；请更换开阔起点。',reasonEn:'Insufficient forward clearance after the steering tap. Use an open starting position.'};}
    // Bound likely understeer with three arcs, rather than requiring a vacant
    // 100 m square. These are diagnostic estimates, never steering waypoints.
    for(const multiplier of [1,1.2,1.4]){
      const r=radius*multiplier,points=[];for(let i=0;i<=20;i++){const theta=v*4*i/20/r;points.push(point(anchor,forward,left,r*Math.sin(theta),steerSign*r*(1-Math.cos(theta))));}
      for(let i=1;i<points.length;i++){const hit=checkSegment(points[i-1],points[i]);if(hit)return{ok:false,reason:'预计转向弧线存在建筑、路缘或边界障碍；请换朝向 / 转向方向或移到开阔区域。',reasonEn:'The estimated turn intersects a building, curb or boundary. Change heading / turn direction or use an open area.',preparationM:preparation,estimatedRadiusM:radius};}
      curves.push(points);
    }
    for(const sample of [point(origin,forward,left,preparation/2),anchor,...curves[1].filter((_,i)=>i%4===0)]){const hit=sim.traceSurface({...sample,y:origin.y+2},{x:0,y:-1,z:0},4);if(!hit||hit.normal.y<.96||Math.abs(hit.point.y-(origin.y-t.altitude))>.35)return{ok:false,reason:'预备段或转向弧线不是连续平地；本协议不把坡道 / 路肩碰撞算作转向响应。',reasonEn:'The preparation or turn path is not continuous level ground. A ramp or curb impact is not a steering-response measurement.'};}
    return{ok:true,preparationM:preparation,estimatedRadiusM:radius,estimatedTurnTimeS:4,method:'Three sampled bicycle arcs at 1.0/1.2/1.4 radius with vehicle width and collision rays; rechecked at actual stabilized position. Not a reachability guarantee.'};
  }
  const above=definition.type==='vertical'?8*5+8*8/(2*3)+5:5;
  for(const [x,z]of [[0,0],[-1.2,-2.5],[1.2,-2.5],[-1.2,2.5],[1.2,2.5]]){const hit=sim.traceSurface({x:origin.x+x,y:origin.y,z:origin.z+z},{x:0,y:1,z:0},above);if(hit)return{ok:false,reason:`上方净空仅 ${hit.distance.toFixed(1)} m，本协议需要约 ${above.toFixed(0)} m。`,reasonEn:`Overhead clearance is only ${hit.distance.toFixed(1)} m; this procedure needs about ${above.toFixed(0)} m.`};}
  for(const d of [{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}])if(sim.traceSurface(origin,d,5))return{ok:false,reason:'车身周围 5 m 内有障碍，不能开始姿态采集。',reasonEn:'There is an obstacle within 5 m of the vehicle.'};
  return{ok:true,overheadM:above,minimumInitialAltitudeM:20,method:'Five overhead rays and four lateral rays; no removal of scene colliders.'};
}

export class ControlCaptureProtocol{
  constructor({getSim,startRecording,stopRecording,recordEvent,getRecordingState=()=>({recording:false}),getRecords=()=>[],onStatus=()=>{},onFinish=()=>{}}={}){
    if(![getSim,startRecording,stopRecording,recordEvent].every(f=>typeof f==='function'))throw Error('Control capture needs the existing simulation and experiment recorder callbacks.');
    Object.assign(this,{getSim,startRecording,stopRecording,recordEvent,getRecordingState,getRecords,onStatus,onFinish});this.active=null;this.lastResult=null;this.serial=0;
  }
  start(id,{steerSign=1}={}){
    if(this.active||this.getRecordingState().recording||this.getRecordingState().replaying)throw Error('请先结束当前流程 / 记录 / 重放。');
    const definition=CONTROL_CAPTURE_PROTOCOLS.find(d=>d.id===id);if(!definition)throw Error('未知现场采集协议。');
    const sim=this.getSim();if(!sim?.telemetry||!sim?.exportState)throw Error('现场物理仿真不可用。');
    const t=sim.telemetry(),sign=steerSign<0?-1:1,initialGround=sim.traceSurface?.(t.position,{x:0,y:-1,z:0},.9),awaitingInitialGround=definition.type==='steer'&&t.contactCount<4&&t.speedKmh<.5&&initialGround?.normal.y>.96;
    // Invalid conditions produce a zero-step, fully identified failed record.
    // They do not silently reposition the car or substitute another test site.
    const captureRunId=`capture-${Date.now()}-${++this.serial}`;
    this.startRecording({name:definition.label,kind:'control-capture',lineage:{captureProtocol:CONTROL_CAPTURE_PROTOCOL_VERSION,protocolId:id,captureRunId}});this.lastResult=null;
    this.active={sim,definition,captureRunId,steerSign:sign,awaitingInitialGround,step:0,phase:'prepare',phaseStep:0,stableSteps:0,stableWindow:[],integral:0,previous:t,initial:t,phaseEvents:[],samples:[],throttleWindow:[],preparationThrottle:null,frozenThrottle:0,commandsStarted:false,phaseCommandPending:true,originalClimbRate:sim.params.climbRateMps,climbRateChanged:false,pendingInput:null,metrics:{rawHz:HZ,minimumHeightM:t.heightWorld,maximumHeightM:t.heightWorld,peakAbsoluteRollDeg:Math.abs(t.rollDeg),peakAbsolutePitchDeg:Math.abs(t.pitchDeg),peakAngularSpeedDegS:angular(t)*DEG,peakSlipDeg:0,peakYawRateDegS:0,peakLateralAccelerationMps2:0,nozzleSaturationSeconds:0,pathLengthM:0,measurementSteps:0,measurementSpeedSumKmh:0,measurementMinSpeedKmh:null,measurementMaxSpeedKmh:null,radiusSumM:0,radiusCount:0,releaseHeightM:null,releaseVerticalMps:null,releasePeakHeightM:null,verticalStoppedAtS:null,recoveredAtS:null,recoveryStartHeightM:null,recoveryMinimumHeightM:null,groundConfirmedAtS:null,stableSpeedWindow:null,steerStartedAtS:null,steerEndedAtS:null},roadRadiusSamples:[]};
    this.recordEvent('control_capture_start',{protocol:CONTROL_CAPTURE_PROTOCOL_VERSION,definition:copy(definition),steerSign:sign,physicalSetup:'Uses the current full physical state. Preparation is ordinary throttle/brake; no rigid-body state assignment.',recordingHz:HZ,measurementHz:20});
    let failure=null;if(t.fault||t.maneuver)failure={reason:'当前有物理错误或其他机动流程；未开始采集。',reasonEn:'A physics fault or another maneuver is active.'};
    else if(definition.type==='steer'&&(t.mode!=='drive'||t.contactCount!==4&&!awaitingInitialGround||tilted(t)>5||t.suctionEnabled))failure={reason:'道路采集需要四轮接地、车身基本水平、吸附关闭且处于驾驶模式。',reasonEn:'Road capture requires four grounded wheels, a nearly level body, suction off and Drive mode.'};
    else if(definition.type!=='steer'&&(t.contactCount||t.mode!=='hover'||t.altitude<20||horizontal(t)>.5||Math.abs(t.verticalSpeed)>.5||angular(t)>.1||tilted(t)>3||t.suctionEnabled))failure={reason:'飞行采集需要距下方至少 20 m 的稳定水平悬停，吸附关闭。',reasonEn:'Flight capture requires stable, level hover at least 20 m above the surface, with suction off.'};
    const clearance=failure||checkControlCaptureClearance(sim,definition,t,{steerSign:sign});this.recordEvent('control_capture_clearance',clearance);this._sample(t);
    if(!clearance.ok){this._finish('failed',clearance.reason,clearance.reasonEn);return this.getState();}
    this._phase('prepare',t);this.onStatus(this.getState());return this.getState();
  }
  _phase(phase,t){const a=this.active;if(!a)return;a.phase=phase;a.phaseStep=a.step;a.stableSteps=0;a.phaseCommandPending=true;const event={phase,step:a.step,timeS:a.step/HZ,simTime:t.simTime,position:copy(t.position),velocity:copy(t.velocity),rollDeg:t.rollDeg,pitchDeg:t.pitchDeg,headingDeg:t.headingDeg};a.phaseEvents.push(event);this.recordEvent('control_capture_phase',event);this.onStatus(this.getState());}
  _command(method,...args){const a=this.active;if(!a)return false;try{if(a.sim[method](...args)===false)throw Error('Control command was rejected.');return true;}catch(error){this._finish('failed',`公开控制命令 ${method} 被拒绝：${error.message}`,`Public control command ${method} failed: ${error.message}`);return false;}}
  beforeStep(dt,input={}){
    const a=this.active;if(!a)return input;
    if(Math.abs(dt-DT)>1e-10){this._finish('failed','采集只接受 120 Hz 固定物理步。','Capture requires fixed 120 Hz physical steps.');return input;}
    if(this.getSim()!==a.sim){this.cancel('场景改变，采集已取消。','Scene changed; capture cancelled.');return input;}
    if(!this.getRecordingState().recording){this._finish('cancelled','关联现场记录提前结束；保存其实际前缀，未判定协议完成。','The associated live recording ended early. Its actual prefix is retained; the protocol did not complete.');return input;}
    if(driverActive(input)){this.recordEvent('control_capture_takeover',{input:copy(input)});this.cancel('人工驾驶输入接管；已完成区间保留。','Pilot input took over; the completed prefix is retained.');return input;}
    if(a.climbRateChanged&&a.sim.params.climbRateMps!==8){a.climbRateChanged=false;this.cancel('升降设定已由操作者改变；保留新设定和已执行区间。','The operator changed the vertical setting; the new value and executed prefix are retained.');return input;}
    const t=a.previous,def=a.definition;
    if(a.phaseCommandPending){a.phaseCommandPending=false;
      if(def.type!=='steer'&&a.phase==='prepare'){
        if(!this._command('setStabilizationMode','level'))return{};
        if(def.type==='vertical'){a.climbRateChanged=true;if(!this._command('setParam','climbRateMps',8))return{};}
      }
      if(def.type==='level'&&a.phase==='manual'&&!this._command('setStabilizationMode','off'))return{};
      if(def.type==='level'&&a.phase==='recover'&&!this._command('setStabilizationMode','level'))return{};
    }
    let result={};
    if(def.type==='steer'){
      if(a.phase==='prepare'&&a.awaitingInitialGround){result={brake:1};a.pendingInput=result;return result;}
      if(a.phase==='prepare'){
        const p=a.sim.params,v=Math.max(0,t.forwardSpeedKmh/3.6),error=def.speedKmh/3.6-v,drag=.5*p.airDensity*p.dragArea*v*v+t.mass*p.gravity*.011;
        const requestedAcceleration=.8*error+.4*a.integral,desired=drag+t.mass*clamp(requestedAcceleration,-2.5,2.5),available=Math.min(p.maxMotorForce,p.motorPower/Math.max(1,v));
        // This is the protocol's throttle driver, not a change to vehicle
        // physics. Both its acceleration request and real drive saturation
        // stop integral wind-up during the approach to the requested speed.
        if(Math.abs(requestedAcceleration)<2.5&&Math.abs(desired)<available||error*requestedAcceleration<0)a.integral=clamp(a.integral+error*dt,-5,5);
        if(a.preparationThrottle!==null&&Math.abs(error)>.8/3.6)a.preparationThrottle=null;
        // Near the target, hold a real pedal value for the existing strict
        // 120 Hz settling gate. Chasing sub-centimetre speed error with
        // alternating drive/regen cannot establish a continuous quiet window.
        // The unchanged gate still rejects excessive speed drift/acceleration.
        result=a.preparationThrottle!==null?{throttle:a.preparationThrottle}:desired>=0?{throttle:Math.max(.016,clamp(desired/p.maxMotorForce,0,1))}:{brake:clamp(-desired/p.brakeForce,0,1)};
      }else if(a.phase==='steer'){
        const phaseTime=(a.step-a.phaseStep)/HZ,steering=def.pulseSeconds&&phaseTime>=def.pulseSeconds?0:(def.steerInput??1);
        result={throttle:def.coast?0:a.frozenThrottle,steer:a.steerSign*steering};
      }else if(a.phase==='brake')result={brake:1};
    }else if(def.type==='vertical'){if(a.phase==='climb')result={lift:1};else if(a.phase==='descend')result={lift:-1};}
    else if(a.phase==='manual')result={[def.axis]:def.sign};
    a.pendingInput=result;return result;
  }
  afterStep(t,dt=DT){
    const a=this.active;if(!a||a.pendingInput===null)return;const input=a.pendingInput;a.pendingInput=null;a.step++;const elapsed=(a.step-a.phaseStep)/HZ,def=a.definition,m=a.metrics,old=a.previous;
    m.minimumHeightM=Math.min(m.minimumHeightM,t.heightWorld);m.maximumHeightM=Math.max(m.maximumHeightM,t.heightWorld);m.peakAbsoluteRollDeg=Math.max(m.peakAbsoluteRollDeg,Math.abs(t.rollDeg));m.peakAbsolutePitchDeg=Math.max(m.peakAbsolutePitchDeg,Math.abs(t.pitchDeg));m.peakAngularSpeedDegS=Math.max(m.peakAngularSpeedDegS,angular(t)*DEG);m.pathLengthM+=.5*(horizontal(t)+horizontal(old))*dt;
    if(t.nozzles.some(n=>n.maxForce>1&&n.command>=n.maxForce*.98))m.nozzleSaturationSeconds+=dt;
    m.wheelExtrema??={};
    for(const w of t.wheelStates||[]){
      const row=m.wheelExtrema[w.id]??={samples:0,unloadedSteps:0,minLoadN:null,maxLoadN:0,peakAbsoluteSlipAngleDeg:0,peakAbsoluteLongitudinalSlip:0,peakFrictionUtilization:0};
      row.samples++;if(!w.contact)row.unloadedSteps++;else row.minLoadN=Math.min(row.minLoadN??Infinity,w.normalLoadN);
      row.maxLoadN=Math.max(row.maxLoadN,w.normalLoadN||0);row.peakAbsoluteSlipAngleDeg=Math.max(row.peakAbsoluteSlipAngleDeg,Math.abs(w.slipAngle||0)*DEG);row.peakAbsoluteLongitudinalSlip=Math.max(row.peakAbsoluteLongitudinalSlip,Math.abs(w.slipRatio||0));row.peakFrictionUtilization=Math.max(row.peakFrictionUtilization,w.gripUse||0);
    }
    const hullContact=a.sim.world.contacts.some(c=>c.bi===a.sim.body||c.bj===a.sim.body),lateralNormalContact=a.sim.world.contacts.some(c=>(c.bi===a.sim.body||c.bj===a.sim.body)&&Math.abs(c.ni.y)<.75);
    a.previous=t;
    if(a.step%6===0)this._sample(t);
    if(t.fault){this._finish('failed',String(t.fault),String(t.fault));return;}
    if(def.type==='steer'&&a.awaitingInitialGround&&t.contactCount===4)a.awaitingInitialGround=false;
    if(def.type==='steer'&&((t.contactCount<4&&(!a.awaitingInitialGround||a.step>60))||lateralNormalContact)){this._finish('failed','道路采集发生接触丢失或车体碰撞，未判作有效转向完成。','Road capture lost wheel contact or hit an obstacle; it is not a completed steering measurement.');return;}
    if(def.type!=='steer'&&a.phase!=='descend'&&(t.contactCount||hullContact)){this._finish('failed','飞行采集提前接触场景，恢复结果未判为成功。','Flight capture contacted the scene before landing; recovery is not marked successful.');return;}
    if(def.type==='steer'){
      if(a.phase==='prepare'){
        a.throttleWindow.push(input.throttle||0);if(a.throttleWindow.length>60)a.throttleWindow.shift();
        if(a.preparationThrottle===null&&Math.abs(t.forwardSpeedKmh-def.speedKmh)<.25&&Math.abs(t.longitudinalAcceleration)<.2&&(input.throttle||0)>=.016&&!(input.brake>0))a.preparationThrottle=input.throttle;
        const steady=Math.abs(t.forwardSpeedKmh-def.speedKmh)<=.8&&Math.abs(t.longitudinalAcceleration)<.2&&Math.abs(t.bodySlipDeg)<2&&angular(t)<.04;
        a.stableSteps=steady?a.stableSteps+1:0;if(steady)a.stableWindow.push({speedKmh:t.forwardSpeedKmh,accelerationMps2:t.longitudinalAcceleration,slipDeg:t.bodySlipDeg,angularRateRadS:angular(t)});else a.stableWindow=[];
        if(a.stableSteps>=240){
          m.stableSpeedWindow={startStep:a.step-240,endStep:a.step,durationS:2,targetSpeedKmh:def.speedKmh,toleranceKmh:.8,maximumLongitudinalAccelerationMps2:.2,actualMinimumSpeedKmh:Math.min(...a.stableWindow.map(s=>s.speedKmh)),actualMaximumSpeedKmh:Math.max(...a.stableWindow.map(s=>s.speedKmh)),actualPeakAbsoluteAccelerationMps2:Math.max(...a.stableWindow.map(s=>Math.abs(s.accelerationMps2))),actualPeakSlipDeg:Math.max(...a.stableWindow.map(s=>Math.abs(s.slipDeg))),actualPeakAngularRateRadS:Math.max(...a.stableWindow.map(s=>s.angularRateRadS)),definition:'Every 120 Hz sample must pass speed, acceleration, side-slip and angular-rate conditions.'};
          const clearance=checkControlCaptureClearance(a.sim,def,t,{steerSign:a.steerSign,atMeasurement:true});this.recordEvent('control_capture_measurement_clearance',clearance);if(!clearance.ok){this._finish('failed',clearance.reason,clearance.reasonEn);return;}
          a.frozenThrottle=a.throttleWindow.reduce((s,v)=>s+v,0)/a.throttleWindow.length;m.frozenThrottle=a.frozenThrottle;m.steerStartSpeedKmh=t.forwardSpeedKmh;m.steerStartHeadingDeg=t.headingDeg;m.steerStartedAtS=a.step/HZ;this._phase('steer',t);
        }else if(elapsed>30)this._finish('timeout','30 s 内未满足连续稳速 2 s；保留预备段，未开始正式转向计量。','A continuous 2 s stabilized-speed window was not achieved within 30 s. Preparation is retained; steering measurement did not begin.');
      }else if(a.phase==='steer'){
        m.measurementSteps++;m.measurementSpeedSumKmh+=t.forwardSpeedKmh;m.measurementMinSpeedKmh=Math.min(m.measurementMinSpeedKmh??Infinity,t.forwardSpeedKmh);m.measurementMaxSpeedKmh=Math.max(m.measurementMaxSpeedKmh??-Infinity,t.forwardSpeedKmh);m.peakSlipDeg=Math.max(m.peakSlipDeg,Math.abs(t.bodySlipDeg));m.peakYawRateDegS=Math.max(m.peakYawRateDegS,Math.abs(t.angularVelocity.y)*DEG);
        const basis=frame(t),ax=(t.velocity.x-old.velocity.x)/dt,az=(t.velocity.z-old.velocity.z)/dt;m.peakLateralAccelerationMps2=Math.max(m.peakLateralAccelerationMps2,Math.abs(ax*basis.left.x+az*basis.left.z));
        if(elapsed>=1&&Math.abs(t.angularVelocity.y)>.02){const r=horizontal(t)/Math.abs(t.angularVelocity.y);m.radiusSumM+=r;m.radiusCount++;a.roadRadiusSamples.push(r);}
        if(elapsed>=.5&&m.yawAtHalfSecondDegS===undefined)m.yawAtHalfSecondDegS=t.angularVelocity.y*DEG;
        if(elapsed>=4){m.steerEndSpeedKmh=t.forwardSpeedKmh;m.speedLossKmh=m.steerStartSpeedKmh-t.forwardSpeedKmh;m.steerEndedAtS=a.step/HZ;m.headingChangeDeg=wrap((t.headingDeg-m.steerStartHeadingDeg)/DEG)*DEG;this._phase('brake',t);}
      }else if(a.phase==='brake'){
        a.stableSteps=horizontal(t)<.15?a.stableSteps+1:0;if(a.stableSteps>=60)this._finish('completed','稳速、转向与制动段已完成；按实际输入日志保存。','Stabilized-speed, steering and braking phases completed; actual input journal retained.');else if(elapsed>15)this._finish('timeout','制动段未在窗口内稳定停止。','The vehicle did not stabilize at rest within the braking window.');
      }
    }else if(a.phase==='prepare'){
      const steady=tilted(t)<3&&angular(t)<.08&&horizontal(t)<.4&&Math.abs(t.verticalSpeed)<.15;a.stableSteps=steady?a.stableSteps+1:0;
      if(a.stableSteps>=120)this._phase(def.type==='vertical'?'climb':'manual',t);else if(elapsed>8)this._finish('timeout','飞行预备段未稳定；记录保留。','The flight preparation did not settle; evidence is retained.');
    }else if(def.type==='vertical'){
      if(a.phase==='climb'&&elapsed>=5){m.releaseHeightM=t.heightWorld;m.releaseVerticalMps=t.verticalSpeed;m.releasePeakHeightM=t.heightWorld;this._phase('release',t);}
      else if(a.phase==='release'){
        m.releasePeakHeightM=Math.max(m.releasePeakHeightM,t.heightWorld);a.stableSteps=Math.abs(t.verticalSpeed)<.1&&horizontal(t)<.4?a.stableSteps+1:0;
        if(a.stableSteps>=120){m.verticalStoppedAtS=a.step/HZ;m.releaseBrakeTimeS=elapsed;m.releaseClimbDistanceM=m.releasePeakHeightM-m.releaseHeightM;this._phase('descend',t);}else if(elapsed>14)this._finish('timeout','松键后未在窗口内停止垂直运动，不能把参考高度当作实际停止点。','Vertical motion did not settle after release; the reference height is not an observed stopping point.');
      }else if(a.phase==='descend'){
        const landed=t.contactCount>=3&&t.mode==='drive'&&t.thrustN<10&&t.massFlowKgS<.05&&horizontal(t)<.3&&Math.abs(t.verticalSpeed)<.2;a.stableSteps=landed?a.stableSteps+1:0;
        if(a.stableSteps>=72){m.groundConfirmedAtS=a.step/HZ;m.groundThrustN=t.thrustN;m.groundMassFlowKgS=t.massFlowKgS;this._finish('completed','E 松键制动与持续 Q 接地关阀已按实际状态完成。','E-release braking and held-Q landing with closed valves completed from measured states.');}else if(elapsed>40)this._finish('timeout','持续 Q 尚未在窗口内形成稳定着陆与关阀。','Held Q did not produce stable landing and valve closure within the window.');
      }
    }else if(a.phase==='manual'&&elapsed>=.9)this._phase('manual-release',t);
    else if(a.phase==='manual-release'&&elapsed>=1){m.recoveryStartHeightM=t.heightWorld;m.recoveryMinimumHeightM=t.heightWorld;m.recoveryStartRollDeg=t.rollDeg;m.recoveryStartPitchDeg=t.pitchDeg;m.recoveryHeadingTargetDeg=t.headingDeg;this._phase('recover',t);}
    else if(a.phase==='recover'){
      m.recoveryMinimumHeightM=Math.min(m.recoveryMinimumHeightM,t.heightWorld);m.recoveryHeightLossM=m.recoveryStartHeightM-m.recoveryMinimumHeightM;
      const stable=tilted(t)<2&&angular(t)<5/DEG&&Math.abs(t.verticalSpeed)<.3;a.stableSteps=stable?a.stableSteps+1:0;
      if(a.stableSteps>=120){m.recoveredAtS=a.step/HZ;m.recoveryTimeS=elapsed;m.finalTiltDeg=tilted(t);m.finalHeadingErrorDeg=wrap((t.headingDeg-m.recoveryHeadingTargetDeg)/DEG)*DEG;this._finish('completed','G 回正达到持续 1 s 的水平 / 角速 / 垂速判据；掉高与饱和保留。','G levelling met the tilt, angular-rate and vertical-speed criteria for 1 s. Height loss and saturation are retained.');}else if(elapsed>15)this._finish('timeout','G 回正未在窗口内达到持续稳定判据；实际轨迹与推力限制保留。','G did not meet the sustained recovery criteria within the window; actual motion and actuator limits are retained.');
    }
  }
  _sample(t){const a=this.active;if(!a)return;const samples=a.samples,row={step:a.step,timeS:a.step/HZ,simTime:t.simTime,phase:a.phase,speedKmh:t.forwardSpeedKmh,bodySlipDeg:t.bodySlipDeg,yawRateDegS:t.angularVelocity.y*DEG,steeringCentreDeg:t.steeringCentreDeg,heightM:t.heightWorld,verticalMps:t.verticalSpeed,rollDeg:t.rollDeg,pitchDeg:t.pitchDeg,headingDeg:t.headingDeg,tiltDeg:tilted(t),angularSpeedDegS:angular(t)*DEG,position:copy(t.position),input:copy(t.driverInput),contactCount:t.contactCount,gasKg:t.gasMass,tankTemperatureK:t.gasTemperatureK,externalGasSuppliedKg:t.externalGasSuppliedKg,energyUsedKWh:t.energyUsedKWh,thrustN:t.thrustN,allocationError:t.allocationError,stabilizationMode:t.stabilizationMode,roadSurface:a.sim.params.roadSurface,
      bodyQuaternion:copy(t.quaternion),angularVelocityWorld:copy(t.angularVelocity),desiredWrench:copy(t.desiredWrench),achievedWrench:copy(t.achievedWrench),
      wheels:(t.wheelStates||[]).map(w=>[w.id,!!w.contact,curveNumber(w.steer*DEG),curveNumber(w.normalLoadN),curveNumber(w.slipAngle*DEG),curveNumber(w.relaxedSlip*DEG),curveNumber(w.slipRatio),curveNumber(w.gripUse),curveNumber(w.surfaceMu),curveNumber(w.longitudinalForceN),curveNumber(w.lateralForceN),curveNumber(w.driveTorqueNm),curveNumber(w.brakeTorqueNm),!!w.absActive,!!w.tcsActive]),
      nozzles:(t.nozzles||[]).map(n=>[n.id,curveNumber(n.command),curveNumber(n.force),curveNumber(n.maxForce)])
    };if(samples.at(-1)?.step===a.step)samples[samples.length-1]=row;else samples.push(row);}
  _finish(status,reason,reasonEn=reason){
    const a=this.active;if(!a)return this.lastResult;this._sample(a.previous);const m=a.metrics,radii=[...a.roadRadiusSamples].sort((x,y)=>x-y);Object.assign(m,{durationS:a.step/HZ,measuredSteeringDurationS:m.measurementSteps/HZ,meanMeasurementSpeedKmh:m.measurementSteps?m.measurementSpeedSumKmh/m.measurementSteps:null,meanPathRadiusM:m.radiusCount?m.radiusSumM/m.radiusCount:null,medianPathRadiusM:radii.length?radii[Math.floor(radii.length/2)]:null,onboardGasUsedKg:a.previous.onboardGasConsumedKg-a.initial.onboardGasConsumedKg,externalGasUsedKg:a.previous.externalGasSuppliedKg-a.initial.externalGasSuppliedKg,energyUsedKWh:a.previous.energyUsedKWh-a.initial.energyUsedKWh});
    const recording=this.getRecordingState().recording,report={schema:'roadster.control-capture-evidence',version:2,protocol:CONTROL_CAPTURE_PROTOCOL_VERSION,protocolId:a.definition.id,captureRunId:a.captureRunId,status,reason,reasonEn,steps:a.step,resultEventInRecord:recording,cleanupAfterRecord:!recording&&a.climbRateChanged&&a.sim.params.climbRateMps===8,metrics:copy(m),phases:copy(a.phaseEvents),telemetryColumns:CONTROL_CAPTURE_COLUMNS,sampling:{curvePrecision:'Wheel/nozzle table numbers rounded to 6 decimal places; full original physical snapshots and input journal remain executable.',source:'fixed simulation time',rawStatisticsHz:HZ,storedHz:20,storedCount:a.samples.length,includesInitialAndFinal:true,note:'The final interval may be shorter than 0.05 s. All statistics use every actual 120 Hz step; saved curves are not their source.'},samples:copy(a.samples),claims:{execution:'actual-inputs-through-existing-solver',graphics:'This record alone does not establish real rendering, browser/GPU identity, input-device latency or display FPS.',speed:'Steering measurement starts only after the entire 2 s stable window. The selected protocol then holds settled throttle, releases it for coasting, or applies a timed steering pulse as declared; speed remains a physical outcome. A 20% analog command is not a keyboard tap.',radius:'Horizontal speed divided by absolute yaw rate after the first 1 s; time series and speed variation must accompany the mean. It is not a steady-state constant-speed circle test.',earlyRecordEnd:'If resultEventInRecord is false, the recorder ended before the protocol summary. The original saved prefix is authoritative; this session summary is not retroactively appended to that record.'}};
    if(recording)this.recordEvent('control_capture_result',report);
    if(a.climbRateChanged&&this.getSim()===a.sim&&a.sim.params.climbRateMps===8){try{a.sim.setParam('climbRateMps',a.originalClimbRate);}catch(error){this.recordEvent('control_capture_restore_error',{parameter:'climbRateMps',reason:String(error.message)});}}
    this.active=null;const record=this.stopRecording(reason,status)||this.getRecords().find(r=>r.lineage?.captureRunId===a.captureRunId);this.lastResult={...report,recordId:record?.id??null,identity:record?.identity??null,record:record??null};this.onStatus(this.getState());this.onFinish(this.lastResult);return this.lastResult;
  }
  cancel(reason='用户停止采集；保留已执行区间。',reasonEn='Capture stopped by the user; the executed prefix is retained.'){return this._finish('cancelled',reason,reasonEn);}
  getState(){const a=this.active;return a?{active:true,id:a.definition.id,label:a.definition.label,labelEn:a.definition.labelEn,phase:a.phase,step:a.step,timeS:a.step/HZ,phaseTimeS:(a.step-a.phaseStep)/HZ,stableTimeS:a.stableSteps/HZ,targetSpeedKmh:a.definition.speedKmh??null,actualSpeedKmh:finite(a.previous.forwardSpeedKmh)}:{active:false,status:this.lastResult?.status??'idle',reason:this.lastResult?.reason??'',reasonEn:this.lastResult?.reasonEn??'',recordId:this.lastResult?.recordId??null};}
  getResult(){return this.lastResult;}
}
