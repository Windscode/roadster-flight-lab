/* Research references are commands to the physical controller. This module
 * never assigns rigid-body position, velocity, orientation, force or torque. */
export const FLIGHT_PROGRAM_SCHEMA = 'roadster.flight-program-library';
export const FLIGHT_PROGRAM_VERSION = 1;
export const PROGRAM_STORAGE_KEY = 'roadster-flight-programs-v1';
export const RESULT_STORAGE_KEY = 'roadster-flight-results-v1';
export const PROGRAM_SHORTCUTS = Object.freeze(Array.from({length:7},(_,i)=>`Digit${i+3}`));
export const PROGRAM_LIMITS = Object.freeze({programs:16,stages:12,durationS:300,importBytes:131072,results:16,samples:6201});
export const CONTROLLER_FIELDS = Object.freeze([
  ['positionGain','水平位置增益',.2,8,.1,'s⁻²',2.4],
  ['velocityGain','水平速度阻尼',.3,8,.1,'s⁻¹',3.1],
  ['altitudeGain','高度位置增益',.3,10,.1,'s⁻²',3.2],
  ['verticalDamping','垂直速度阻尼',.5,10,.1,'s⁻¹',3.6],
  ['attitudeResponse','姿态响应',1,7,.1,'rad/s',3.6],
  ['rollRateDegS','滚转指令上限',15,180,5,'°/s',120],
  ['pitchRateDegS','俯仰指令上限',5,90,1,'°/s',32],
  ['yawRateDegS','偏航指令上限',5,100,1,'°/s',46],
  ['angularAccelerationDegS2','角加速度上限',20,300,10,'°/s²',160],
]);
const copy=value=>JSON.parse(JSON.stringify(value));
const rad=Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const fail=(path,message)=>{throw new TypeError(`${path}：${message}`);};
const plain=(value,path)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(path,'应为对象');return value;};
const number=(value,min,max,path)=>{if(!finite(value)||value<min||value>max)fail(path,`应为 ${min}–${max} 范围内的有限数值`);return value;};
const choose=(value,values,path)=>{if(!values.includes(value))fail(path,`不支持 ${String(value).slice(0,32)}`);return value;};
const string=(value,min,max,path)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u001f]/.test(value))fail(path,`应为 ${min}–${max} 个可显示字符`);return value.trim();};
function keys(value,allowed,path){for(const key of Object.keys(value))if(!allowed.includes(key))fail(path,`未知字段 ${key}`);}

export function validateWind(value,path='风场'){
  if(value===null)return null;
  plain(value,path);keys(value,['speedMps','directionDeg','gustMps','gustPeriodS'],path);
  return {speedMps:number(value.speedMps,0,30,`${path}.平均风速`),directionDeg:number(value.directionDeg,0,360,`${path}.流向`),gustMps:number(value.gustMps,0,20,`${path}.阵风幅值`),gustPeriodS:number(value.gustPeriodS,.5,60,`${path}.阵风周期`)};
}
export function validateController(value,path='控制参数'){
  plain(value,path);keys(value,CONTROLLER_FIELDS.map(f=>f[0]),path);
  const result={};for(const [key,label,min,max,,,,]of CONTROLLER_FIELDS)if(key in value)result[key]=number(value[key],min,max,`${path}.${label}`);return result;
}
export function validateStage(value,path='阶段'){
  plain(value,path);
  const type=choose(value.type,['pose','wait','rate','roll','land','wind'],`${path}.类型`);
  const allowed={pose:['dxM','dyM','dzM','attitude','pitchDeg','rollDeg','yawDeg','exit','settleS'],wait:[],rate:['axis','rateDegS'],roll:[],land:[],wind:['wind']}[type];
  keys(value,['type','durationS',...allowed],path);
  const out={type,durationS:number(value.durationS,type==='rate'?.1:.25,type==='rate'?12:90,`${path}.时长`)};
  if(type==='pose')Object.assign(out,{
    dxM:number(value.dxM,-100,100,`${path}.X 偏移`),dyM:number(value.dyM,-50,80,`${path}.Y 偏移`),dzM:number(value.dzM,-100,100,`${path}.Z 偏移`),
    attitude:choose(value.attitude,['start','custom'],`${path}.姿态参考`),
    pitchDeg:number(value.pitchDeg,-180,180,`${path}.俯仰`),rollDeg:number(value.rollDeg,-180,180,`${path}.滚转`),yawDeg:number(value.yawDeg,-360,360,`${path}.航向偏移`),
    exit:choose(value.exit,['duration','settled'],`${path}.结束条件`),settleS:number(value.settleS,.25,5,`${path}.稳定保持时间`),
  });
  if(type==='pose'&&out.exit==='settled'&&out.settleS>out.durationS)fail(path,'稳定保持时间不能超过阶段超时');
  if(type==='rate'){
    out.axis=choose(value.axis,['roll','pitch','yaw'],`${path}.旋转轴`);
    out.rateDegS=number(value.rateDegS,out.axis==='roll'?-180:out.axis==='pitch'?-90:-100,out.axis==='roll'?180:out.axis==='pitch'?90:100,`${path}.角速度`);
    if(Math.abs(out.rateDegS)<1)fail(path,'角速度绝对值至少为 1°/s');
  }
  if(type==='wind')out.wind=validateWind(value.wind,`${path}.风场`);
  return out;
}
export function validateProgram(value,path='流程'){
  plain(value,path);keys(value,['id','name','shortcut','supplyMode','wind','stages'],path);
  const id=string(value.id,1,48,`${path}.ID`);if(!/^[a-zA-Z0-9_-]+$/.test(id))fail(path,'ID 只能含字母、数字、下划线及连字符');
  const out={id,name:string(value.name,1,42,`${path}.名称`),shortcut:value.shortcut===null?null:choose(value.shortcut,PROGRAM_SHORTCUTS,`${path}.快捷键`),supplyMode:choose(value.supplyMode,['inherit','bench','finite'],`${path}.供气`),wind:validateWind(value.wind,`${path}.初始风场`)};
  if(!Array.isArray(value.stages)||!value.stages.length||value.stages.length>PROGRAM_LIMITS.stages)fail(path,`阶段数量应为 1–${PROGRAM_LIMITS.stages}`);
  out.stages=value.stages.map((s,i)=>validateStage(s,`${path}.阶段 ${i+1}`));
  if(out.stages.reduce((sum,s)=>sum+s.durationS,0)>PROGRAM_LIMITS.durationS)fail(path,`流程总时长上限为 ${PROGRAM_LIMITS.durationS} s`);
  return out;
}
export function validateProgramLibrary(value){
  plain(value,'流程库');keys(value,['schema','version','programs','controller'],'流程库');
  if(value.schema!==FLIGHT_PROGRAM_SCHEMA||value.version!==FLIGHT_PROGRAM_VERSION)fail('流程库','格式或版本不受支持');
  if(!Array.isArray(value.programs)||!value.programs.length||value.programs.length>PROGRAM_LIMITS.programs)fail('流程库',`流程数量应为 1–${PROGRAM_LIMITS.programs}`);
  const programs=value.programs.map((p,i)=>validateProgram(p,`流程 ${i+1}`)),ids=new Set(),bindings=new Set();
  for(const p of programs){if(ids.has(p.id))fail('流程库',`重复 ID ${p.id}`);ids.add(p.id);if(p.shortcut){if(bindings.has(p.shortcut))fail('流程库',`快捷键 ${p.shortcut.slice(5)} 冲突`);bindings.add(p.shortcut);}}
  return {schema:FLIGHT_PROGRAM_SCHEMA,version:FLIGHT_PROGRAM_VERSION,programs,controller:validateController(value.controller??{})};
}
export function parseProgramLibrary(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>PROGRAM_LIMITS.importBytes)fail('导入文件','文件不能大于 128 KiB');
  let value;try{value=JSON.parse(text);}catch{fail('导入文件','不是有效 JSON');}
  return validateProgramLibrary(value);
}
export function defaultStage(type='pose'){
  if(type==='pose')return{type,durationS:8,dxM:0,dyM:2,dzM:0,attitude:'start',pitchDeg:0,rollDeg:0,yawDeg:0,exit:'duration',settleS:1};
  if(type==='rate')return{type,durationS:3,axis:'roll',rateDegS:60};
  if(type==='wind')return{type,durationS:8,wind:{speedMps:8,directionDeg:90,gustMps:4,gustPeriodS:4}};
  return{type,durationS:type==='wait'?2:type==='land'?25:20};
}
export function defaultProgramLibrary(){
  const pose=(dyM,durationS,extra={})=>({...defaultStage(),dyM,durationS,...extra});
  return validateProgramLibrary({schema:FLIGHT_PROGRAM_SCHEMA,version:FLIGHT_PROGRAM_VERSION,controller:{},programs:[
    {id:'pose-step',name:'高度与姿态阶跃',shortcut:'Digit3',supplyMode:'inherit',wind:null,stages:[pose(2,9,{exit:'settled'}),pose(2,10,{attitude:'custom',pitchDeg:8,rollDeg:15,yawDeg:20}),pose(2,7)]},
    {id:'gust-rejection',name:'侧风与阵风抑制',shortcut:'Digit4',supplyMode:'bench',wind:{speedMps:0,directionDeg:90,gustMps:0,gustPeriodS:4},stages:[pose(3,10,{exit:'settled'}),{type:'wind',durationS:12,wind:{speedMps:8,directionDeg:90,gustMps:5,gustPeriodS:4}},{type:'wind',durationS:6,wind:null}]},
    {id:'roll-return',name:'翻转并返回起始高度',shortcut:'Digit5',supplyMode:'inherit',wind:null,stages:[{type:'roll',durationS:25}]},
    {id:'finite-budget',name:'有限储气悬停与着陆',shortcut:'Digit6',supplyMode:'finite',wind:{speedMps:0,directionDeg:0,gustMps:0,gustPeriodS:4},stages:[pose(1.5,4),{type:'wait',durationS:1},{type:'land',durationS:25}]},
  ]});
}
export function loadProgramLibrary(storage){
  try{const raw=storage?.getItem(PROGRAM_STORAGE_KEY);return{library:raw?parseProgramLibrary(raw):defaultProgramLibrary(),warning:null};}
  catch(error){return{library:defaultProgramLibrary(),warning:`本地流程未载入：${error.message}`};}
}
export function saveProgramLibrary(storage,value){const library=validateProgramLibrary(value);if(!storage)throw new Error('浏览器存储不可用，请导出 JSON 保留配置');storage.setItem(PROGRAM_STORAGE_KEY,JSON.stringify(library));return library;}
export function quaternionFromAttitude(pitchDeg,rollDeg,headingDeg){
  // Heading about world +Y; positive pitch raises the +Z nose; positive roll
  // follows the existing +Z body-axis convention used by Z in this simulator.
  const x=-pitchDeg*rad/2,y=headingDeg*rad/2,z=rollDeg*rad/2;
  const sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y),sz=Math.sin(z),cz=Math.cos(z);
  return{x:sx*cy*cz+cx*sy*sz,y:cx*sy*cz-sx*cy*sz,z:cx*cy*sz-sx*sy*cz,w:cx*cy*cz+sx*sy*sz};
}
export function quaternionErrorDeg(a,b){if(!a||!b)return null;const an=Math.hypot(a.x,a.y,a.z,a.w),bn=Math.hypot(b.x,b.y,b.z,b.w);if(an<1e-9||bn<1e-9)return null;return 2*Math.acos(clamp(Math.abs((a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)/(an*bn)),0,1))/rad;}
export function hasPilotInput(input={}){return ['throttle','steer','lift','roll','pitch','brake','frontJets','rearJets'].some(k=>finite(input[k])&&Math.abs(input[k])>.02)||input.boost===true;}
const norm=v=>v?Math.hypot(v.x||0,v.y||0,v.z||0):0;
const positionError=(a,b)=>a&&b?Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z):null;
const numeric=value=>finite(value)?value:null;
function capture(t){return{position:{...t.position},quaternion:{...t.quaternion}};}
function safeWind(sim,t){const wind=sim.getWind?.()??t.wind??null;return wind?{speedMps:wind.speedMps,directionDeg:wind.directionDeg,gustMps:wind.gustMps,gustPeriodS:wind.gustPeriodS}:null;}
function setWind(sim,wind){if(wind){if(sim.setWind(wind)===false)throw new Error('风场参考未被仿真接受');}else sim.clearWind();}
function stageLabel(stage){return{pose:'姿态 / 位置参考',wait:'等待',rate:'角速度指令',roll:'自动翻转',land:'制导着陆',wind:'风场扰动'}[stage.type];}

/** The caller invokes stepInput once per actual fixed physics substep. Timers,
 * dwell tests and 20 Hz samples advance only with simulation time. Rendering,
 * pause duration and animation frame grouping cannot speed up a sequence. */
export class FlightProgramRunner{
  constructor({getSim,getContext=()=> 'city',onEvent=()=>{},onStart=()=>{},onFinish=()=>{},now=()=>new Date().toISOString()}={}){
    if(typeof getSim!=='function')throw new TypeError('getSim is required');
    Object.assign(this,{getSim,getContext,onEvent,onStart,onFinish,now});this.active=null;this.lastResult=null;this.serial=0;
  }
  start(program){
    const validated=validateProgram(program);if(this.active)this.cancel('启动另一个流程');
    const sim=this.getSim(),t=sim.telemetry();if(t.fault)throw new Error(`仿真异常：${t.fault}`);
    if(!t.position||!t.quaternion)throw new Error('仿真姿态不可用');
    if(t.suctionEnabled)throw new Error('请先关闭吸附，再启动飞行研究流程');
    if(t.maneuver)sim.startManeuver('cancel');
    const active={program:validated,sim,context:this.getContext(),origin:capture(t),heading:t.headingDeg||0,index:-1,stage:null,elapsedS:0,stageElapsedS:0,settledS:0,lastSimTime:t.simTime,startTime:t.simTime,startedAt:this.now(),target:null,lastTelemetry:t,previousSample:null,samples:[],stages:[],gasThroughputKg:0,startEnergy:t.energyUsedKWh||0,previousWind:safeWind(sim,t),previousSupply:sim.params.supplyMode,windChanged:false,supplyChanged:false,stageTargetStart:null,hasSeenManeuver:false,effectiveRateDegS:null};
    this.active=active;
    try{
      if(validated.supplyMode!=='inherit'){sim.setSupplyMode(validated.supplyMode);active.supplyChanged=true;}
      if(validated.wind!==null){setWind(sim,validated.wind);active.windChanged=true;}
      this.onEvent('program_start',{id:validated.id,name:validated.name,context:active.context,supplyMode:sim.params.supplyMode});
      this._sample(t);this._enterStage();
      if(this.active)this.onStart(validated);
    }catch(error){if(this.active)this._finish('failed',error.message);throw error;}
    return !!this.active;
  }
  _enterStage(){
    const a=this.active;if(!a)return;
    a.index++;if(a.index>=a.program.stages.length){this._finish('completed','已执行全部阶段');return;}
    a.stage=a.program.stages[a.index];a.stageElapsedS=0;a.settledS=0;a.settledSinceS=null;a.hasSeenManeuver=false;a.effectiveRateDegS=null;
    const sim=a.sim,t=sim.telemetry(),s=a.stage;a.lastTelemetry=t;
    const record={index:a.index,type:s.type,label:stageLabel(s),startS:a.elapsedS,durationS:0,outcome:'running',settlingTimeS:null,peakPositionErrorM:null,peakAttitudeErrorDeg:null,overshootM:0,command:{...s}};a.stages.push(record);
    if(s.type==='pose'){
      const position={x:a.origin.position.x+s.dxM,y:a.origin.position.y+s.dyM,z:a.origin.position.z+s.dzM};
      const quaternion=s.attitude==='start'?{...a.origin.quaternion}:quaternionFromAttitude(s.pitchDeg,s.rollDeg,a.heading+s.yawDeg);
      a.stageTargetStart={...t.position};a.target={position,quaternion};
      if(sim.setPoseTarget(a.target)===false)throw new Error('目标位置或姿态无效；车辆未被移动');
    }else if(s.type==='rate'){
      sim.setMode('hover');sim.setStabilizationMode('off');
      a.target={position:{...t.position},quaternion:null};
      const key={roll:'rollRateDegS',pitch:'pitchRateDegS',yaw:'yawRateDegS'}[s.axis];
      const limit=sim.params[key]||CONTROLLER_FIELDS.find(f=>f[0]===key)[6];
      a.effectiveRateDegS=clamp(s.rateDegS,-limit,limit);record.effectiveRateDegS=a.effectiveRateDegS;
    }else if(s.type==='roll'||s.type==='land'){
      a.target=null;
      if(sim.startManeuver(s.type)===false)throw new Error(sim.status||`${stageLabel(s)}预检未通过`);
      a.hasSeenManeuver=!!sim.telemetry().maneuver;
      if(!a.hasSeenManeuver)throw new Error(`${stageLabel(s)}未进入执行状态`);
    }else if(s.type==='wind'){
      setWind(sim,s.wind);a.windChanged=true;
    }
    a.lastTelemetry=sim.telemetry();
    this.onEvent('program_stage',{id:a.program.id,index:a.index,type:s.type,durationS:s.durationS});
  }
  _stable(t){
    const a=this.active;if(!a?.target)return false;
    const ep=positionError(t.position,a.target.position),ea=quaternionErrorDeg(t.quaternion,a.target.quaternion);
    return ep!==null&&ep<.35&&(ea===null||ea<3)&&norm(t.velocity)<.4&&norm(t.angularVelocity)<5*rad&&t.holdFeasible!==false&&!t.pressureLimited;
  }
  _completeStage(outcome='completed'){
    const a=this.active;if(!a)return;const t=a.sim.telemetry(),r=a.stages.at(-1);
    r.durationS=a.stageElapsedS;r.outcome=outcome;r.finalPositionErrorM=positionError(t.position,a.target?.position);r.finalAttitudeErrorDeg=quaternionErrorDeg(t.quaternion,a.target?.quaternion);r.finalFeasible=t.holdFeasible??null;
    if(a.stage.type==='rate'){
      // The controller brakes angular rate; this captures the attained physical
      // attitude only. It does not zero angular velocity or teleport the body.
      const reference=capture(t);if(a.sim.setPoseTarget(reference)===false)throw new Error('旋转后姿态参考无法接受');a.target=reference;
    }
    if(a.stage.type==='roll'&&t.mode!=='drive'){
      const reference=capture(t);if(a.sim.setPoseTarget(reference)!==false)a.target=reference;
    }
    if(a.stage.type==='land'){a.target=null;}
    this._enterStage();
  }
  stepInput(fixedDt,pilotInput={}){
    if(!this.active)return pilotInput;
    if(!finite(fixedDt)||fixedDt<=0||fixedDt>.1)throw new TypeError('流程需要有效的固定物理步长（0–0.1 s）');
    const a=this.active;
    if(a.sim!==this.getSim()||a.context!==this.getContext()){this.cancel('已切换场景');return pilotInput;}
    if(hasPilotInput(pilotInput)){this.cancel('驾驶输入接管');return pilotInput;}
    const sim=a.sim;
    if(sim.simTime<a.lastSimTime-1e-8){this.cancel('仿真已重新初始化');return pilotInput;}
    a.lastSimTime=sim.simTime;
    if(sim.simTime-(a.previousSample?.simTime??a.startTime)>=.05-1e-9){const t=sim.telemetry();a.lastTelemetry=t;this._sample(t);if(t.fault){this._finish('failed',t.fault);return pilotInput;}}
    const s=a.stage,t=a.lastTelemetry;
    if(s.type==='pose'){
      if(this._stable(t)){if(a.settledSinceS===null)a.settledSinceS=a.stageElapsedS;a.settledS=a.stageElapsedS-a.settledSinceS;}
      else{a.settledSinceS=null;a.settledS=0;}
      if(a.settledS>=s.settleS-1e-9&&a.stages.at(-1).settlingTimeS===null)a.stages.at(-1).settlingTimeS=a.settledSinceS;
    }
    const timedOut=a.stageElapsedS>=s.durationS-1e-9;
    let complete=false;
    if(s.type==='roll'||s.type==='land'){
      if(t.maneuver)a.hasSeenManeuver=true;
      if(a.stageElapsedS>0&&a.hasSeenManeuver&&!t.maneuver){
        complete=s.type==='roll'||(t.mode==='drive'&&t.contactCount>0&&Math.abs(t.verticalSpeed||0)<.6);
        if(!complete){this._finish('failed','着陆动作结束，但未确认地面接触');return pilotInput;}
      }
      if(timedOut&&!complete){this._finish('timeout',`${stageLabel(s)}超过 ${s.durationS} s，尚未确认完成`);return pilotInput;}
    }else if(s.type==='pose'&&s.exit==='settled'){
      complete=a.settledS>=s.settleS-1e-9;
      if(timedOut&&!complete){this._finish('timeout','位置 / 姿态尚未达到稳定判据');return pilotInput;}
    }else complete=timedOut;
    if(complete){try{this._completeStage();}catch(error){this._finish('failed',error.message);}if(!this.active)return pilotInput;}
    const active=this.active;active.elapsedS+=fixedDt;active.stageElapsedS+=fixedDt;
    if(active.stage.type==='rate'){
      const key={roll:'rollRateDegS',pitch:'pitchRateDegS',yaw:'yawRateDegS'}[active.stage.axis];
      const limit=active.sim.params[key]||CONTROLLER_FIELDS.find(f=>f[0]===key)[6];
      const axis=active.stage.axis==='yaw'?'steer':active.stage.axis;
      return{...pilotInput,[axis]:clamp(active.effectiveRateDegS/limit,-1,1)};
    }
    return pilotInput;
  }
  _sample(t){
    const a=this.active;if(!a)return;
    const dt=a.previousSample?Math.max(0,t.simTime-a.previousSample.simTime):0;
    if(a.previousSample&&dt<=1e-9)return;
    const flow=finite(t.massFlowKgS)?Math.max(0,t.massFlowKgS):0;
    if(a.previousSample)a.gasThroughputKg+=.5*(a.previousSample.flow+flow)*dt;
    a.previousSample={simTime:t.simTime,flow};
    const ep=positionError(t.position,a.target?.position),ea=quaternionErrorDeg(t.quaternion,a.target?.quaternion??(a.stage?.type==='rate'?t.manualQuaternionTarget:null));
    const sample={timeS:Math.max(0,t.simTime-a.startTime),stage:a.index,heightM:numeric(t.position?.y),targetHeightM:numeric(a.target?.position?.y??t.targetAltitude),positionErrorM:ep,attitudeErrorDeg:ea,rollDeg:numeric(t.rollDeg),pitchDeg:numeric(t.pitchDeg),speedMps:numeric(norm(t.velocity)),pressureBar:numeric(t.pressureBar),massFlowKgS:flow,allocationError:numeric(t.allocationError),feasible:t.holdFeasible??t.manualPoseFeasible??null};
    a.samples.push(sample);if(a.samples.length>PROGRAM_LIMITS.samples)a.samples.shift();
    const record=a.stages.at(-1);
    if(record){
      if(ep!==null)record.peakPositionErrorM=Math.max(record.peakPositionErrorM||0,ep);
      if(ea!==null)record.peakAttitudeErrorDeg=Math.max(record.peakAttitudeErrorDeg||0,ea);
      if(a.stage.type==='pose'&&a.stageTargetStart&&a.target){
        const start=a.stageTargetStart,target=a.target.position,d={x:target.x-start.x,y:target.y-start.y,z:target.z-start.z},length=norm(d);
        if(length>.01){const excess=((t.position.x-target.x)*d.x+(t.position.y-target.y)*d.y+(t.position.z-target.z)*d.z)/length;record.overshootM=Math.max(record.overshootM,excess);}
      }
    }
  }
  cancel(reason='已停止流程'){if(!this.active)return false;this._finish('cancelled',reason);return true;}
  _finish(status,reason){
    const a=this.active;if(!a)return;const sim=a.sim,t=sim.telemetry();this._sample(t);
    const lastStage=a.stages.at(-1);if(lastStage?.outcome==='running'){lastStage.outcome=status;lastStage.durationS=a.stageElapsedS;}
    if(status!=='completed'){
      // Keep finite authority and actual momentum. Cancelling an automatic
      // maneuver releases it; airborne motion is handed to the ordinary pilot
      // controller with its current measured references.
      if(t.maneuver)sim.startManeuver('cancel');
      if(sim.stabilizationMode==='hold')sim.setStabilizationMode('off');
    }
    if(a.windChanged)setWind(sim,a.previousWind);
    if(a.supplyChanged)sim.setSupplyMode(a.previousSupply);
    const es=a.samples.filter(s=>s.positionErrorM!==null),att=a.samples.filter(s=>s.attitudeErrorDeg!==null),alloc=a.samples.filter(s=>s.allocationError!==null);
    const result={schema:'roadster.flight-program-result',version:1,id:`run-${++this.serial}-${a.startedAt.replace(/[^0-9]/g,'')}`,programId:a.program.id,name:a.program.name,context:a.context,startedAt:a.startedAt,status,reason,durationS:Math.max(0,t.simTime-a.startTime),supplyMode:a.program.supplyMode==='inherit'?a.previousSupply:a.program.supplyMode,controller:Object.fromEntries(CONTROLLER_FIELDS.map(([key,,,,,,fallback])=>[key,sim.params[key]??fallback])),wind:a.program.wind,program:copy(a.program),summary:{peakPositionErrorM:es.length?Math.max(...es.map(s=>s.positionErrorM)):null,rmsPositionErrorM:es.length?Math.sqrt(es.reduce((sum,s)=>sum+s.positionErrorM*s.positionErrorM,0)/es.length):null,peakAttitudeErrorDeg:att.length?Math.max(...att.map(s=>s.attitudeErrorDeg)):null,saturationFraction:alloc.length?alloc.filter(s=>s.feasible===false||s.allocationError>.2).length/alloc.length:null,gasThroughputKg:a.gasThroughputKg,gasRemainingKg:numeric(t.gasMass),energyUsedKWh:Math.max(0,(t.energyUsedKWh||0)-a.startEnergy),finalPositionErrorM:positionError(t.position,a.target?.position),finalAttitudeErrorDeg:quaternionErrorDeg(t.quaternion,a.target?.quaternion),finalFeasible:t.holdFeasible??null},stages:copy(a.stages),samples:copy(a.samples)};
    this.active=null;this.lastResult=result;this.onEvent('program_finish',{id:a.program.id,status,reason,durationS:result.durationS});this.onFinish(result);
  }
  getState(){const a=this.active,r=this.lastResult;return a?{running:true,id:a.program.id,name:a.program.name,stage:a.index+1,stageCount:a.program.stages.length,stageType:a.stage?.type,stageLabel:a.stage?stageLabel(a.stage):'',elapsedS:a.elapsedS,stageElapsedS:a.stageElapsedS,stageDurationS:a.stage?.durationS??0,settledS:a.settledS,target:a.target?copy(a.target):null,effectiveRateDegS:a.effectiveRateDegS,gasThroughputKg:a.gasThroughputKg}:{running:false,result:r?{id:r.id,name:r.name,programId:r.programId,status:r.status,reason:r.reason,durationS:r.durationS,summary:{...r.summary}}:null};}
}

/** Persist compact measured records, while full 20 Hz samples remain available
 * for JSON/CSV export in the current session. Never persist executable content. */
export function compactResult(result){
  const out=copy(result);const stride=Math.max(1,Math.ceil(out.samples.length/180));out.samples=out.samples.filter((_,i)=>i%stride===0||i===out.samples.length-1);return out;
}
export function loadResults(storage){
  try{
    const raw=storage?.getItem(RESULT_STORAGE_KEY);if(!raw)return[];if(raw.length>2_000_000)return[];
    const value=JSON.parse(raw);if(value.schema!=='roadster.flight-results'||value.version!==1||!Array.isArray(value.results)||value.results.length>PROGRAM_LIMITS.results)return[];
    return value.results.filter(r=>{
      if(!r||r.schema!=='roadster.flight-program-result'||r.version!==1||typeof r.name!=='string'||r.name.length>42||typeof r.id!=='string'||r.id.length>90||typeof r.startedAt!=='string'||r.startedAt.length>48||!['completed','cancelled','failed','timeout'].includes(r.status)||!finite(r.durationS)||r.durationS<0||r.durationS>301||!r.summary||!Array.isArray(r.samples)||r.samples.length>181||!Array.isArray(r.stages)||r.stages.length>12)return false;
      try{validateProgram(r.program);validateController(r.controller);for(const s of r.samples)if(!s||Object.values(s).some(v=>typeof v==='number'&&!Number.isFinite(v)))return false;for(const v of Object.values(r.summary))if(v!==null&&typeof v!=='boolean'&&(!finite(v)||v<0))return false;}catch{return false;}
      return true;
    });
  }catch{return[];}
}
export function saveResults(storage,results){if(!storage)throw new Error('浏览器存储不可用');const compact=results.slice(-PROGRAM_LIMITS.results).map(compactResult);storage.setItem(RESULT_STORAGE_KEY,JSON.stringify({schema:'roadster.flight-results',version:1,results:compact}));}
export function resultCSV(result){
  const fields=['timeS','stage','heightM','targetHeightM','positionErrorM','attitudeErrorDeg','rollDeg','pitchDeg','speedMps','pressureBar','massFlowKgS','allocationError','feasible'];
  return ['# Roadster Flight Lab — analytic wind / rigid-body experiment; 20 Hz simulation-time samples',fields.join(','),...result.samples.map(s=>fields.map(k=>s[k]===null||s[k]===undefined?'':String(s[k])).join(','))].join('\n');
}
