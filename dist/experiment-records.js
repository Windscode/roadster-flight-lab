/* A live experiment is a frozen physical state plus ordered commands and
 * fixed-step inputs. Curves are evidence; they are never used as replay state. */
import {MODEL_VERSION} from './vehicle-models.js';
import {MODEL_BUILD_ID} from './model-build.js';
import {ExperimentReproductionCheck} from './experiment-reproduction.js';
import {writeArchiveCandidate} from './research-storage.js';
import {getRuntimeIdentity} from './runtime-identity.js';
import {physicalDiagnosticSnapshot,serializableDiagnostic} from './simulation-safety.js';
import {assertSnapshotWorldCompatible} from './simulation-snapshot.js';

export const LIVE_PROTOCOL_VERSION='live-fixed-inputs-1';
export const EXPERIMENT_SCHEMA='roadster.live-experiment';
export const EXPERIMENT_LIBRARY_KEY='roadster-live-experiments-v1';
export const EXPERIMENT_LIMITS=Object.freeze({durationS:300,steps:36000,records:32,importRecords:128,storageBytes:4*1024*1024,importBytes:12*1024*1024,events:10000});
export const FIXED_HZ=120;
export const COMMAND_METHODS=Object.freeze(['reset','setMode','setSuction','setStabilizationMode','setAirStabilization','setPoseTarget','setWind','clearWind','setSupplyMode','refillGas','setParam','startManeuver','setRoadSurface','setRouteSurface','setWing','setObservation','setNozzleFault','clearNozzleFault','releasePilotInput']);
const INPUT_KEYS=['throttle','steer','lift','roll','pitch','brake','frontJets','rearJets','boost'];
const CONTROLLER_KEYS=['positionGain','velocityGain','altitudeGain','verticalDamping','attitudeResponse','rollRateDegS','pitchRateDegS','yawRateDegS','angularAccelerationDegS2','verticalAccelerationMps2'];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const norm=v=>v?Math.hypot(v.x||0,v.y||0,v.z||0):0;
const numeric=v=>finite(v)?v:null;
const byteLength=v=>new TextEncoder().encode(v).byteLength;
const safeText=(v,max=200)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').slice(0,max);
export function currentExperimentIdentity(){return{...getRuntimeIdentity(),protocolVersion:LIVE_PROTOCOL_VERSION,fixedHz:FIXED_HZ};}
/** Attach a verified published source identity only to newly created results.
 * Imported historical identities and physical content labels are not rewritten. */
export function attachRuntimeProvenance(result){
  const runtime=getRuntimeIdentity();if(runtime.sourceIdentityStatus!=='matched-current-build')return result;
  for(const identity of [result?.identity,result?.initialSnapshot?.identity,result?.finalSnapshot?.identity])if(identity?.modelVersion===runtime.modelVersion&&identity?.modelBuildId===runtime.modelBuildId)Object.assign(identity,{sourceCommit:runtime.sourceCommit,sourceTree:runtime.sourceTree,sourceIdentityStatus:runtime.sourceIdentityStatus});
  return result;
}
export function canonicalJSON(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return'['+value.map(canonicalJSON).join(',')+']';
  return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
}
/** Deterministic content label, not a cryptographic signature or trust claim. */
export function contentLabel(value){let hash=2166136261;for(const code of canonicalJSON(value)){hash^=code.charCodeAt(0);hash=Math.imul(hash,16777619);}return'fnv1a32-'+(hash>>>0).toString(16).padStart(8,'0');}
function assertJSON(value,path='数据',depth=0){
  if(depth>48)throw Error(path+'：对象嵌套过深');
  if(value===null||typeof value==='boolean'||typeof value==='string')return;
  if(typeof value==='number'){if(!finite(value))throw Error(path+'：含非有限数值');return;}
  if(typeof value!=='object'||Array.isArray(value)&&value.length>100000)throw Error(path+'：不是受支持的 JSON');
  for(const [key,child]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw Error(path+'：含不允许的字段');assertJSON(child,path+'.'+key,depth+1);}
}
function poseError(a,b){return a&&b?Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z):null;}
function attitudeError(a,b){if(!a||!b)return null;const d=Math.hypot(a.x,a.y,a.z,a.w)*Math.hypot(b.x,b.y,b.z,b.w);return d>1e-12?2*Math.acos(Math.min(1,Math.abs((a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)/d)))*180/Math.PI:null;}
export function normalizeRecordedInput(input={}){
  const result={};for(const key of INPUT_KEYS){const value=input[key];if(key==='boost'){if(value===true)result[key]=true;}else if(finite(value)&&value!==0)result[key]=value;}return result;
}
export function captureExperimentSnapshot(sim,context='city',sceneConfiguration=null){
  if(!sim||typeof sim.exportState!=='function')throw Error('当前模型不支持完整状态快照，不能创建可重放实验');
  const physical=sim.exportState();assertJSON(physical,'仿真快照');const presentation=clone(sceneConfiguration??null);assertJSON(presentation,'视景配置');
  return{identity:currentExperimentIdentity(),context:context==='lab'?'lab':'city',physical,sceneConfiguration:presentation,sceneConfigurationScope:'Presentation preset and camera at capture time only; camera motion during the recorded run is not replayed. Physical stateLabel excludes presentation.',initialSimTime:sim.simTime,disturbancePhase:'absolute simulation time and observer RNG state are in physical snapshot',stateLabel:contentLabel(physical)};
}
/** A diagnostic pose is not a full Cannon continuation snapshot. Non-finite
 * failures keep exact diagnostic descriptions and explicitly lack a restorable
 * terminal snapshot; the safety reset pose is never substituted. */
export function capturedFailureTerminal(sim,context='lab',sceneConfiguration=null){
  const report=sim.getFailureReport?.()??null;if(!report||!sim._fault)return null;
  const physical=report.triggerContinuationSnapshot??null;
  return{failureEvidence:report,finalSnapshot:{identity:currentExperimentIdentity(),context,physical:physical?clone(physical):null,stateLabel:physical?contentLabel(physical):null,sceneConfiguration:clone(sceneConfiguration),initialSimTime:report.triggerSimTime,terminalReplayable:!!physical,terminalKind:physical?'failure-trigger-continuation':'diagnostic-only',terminalDiagnostic:{lastValid:report.lastValidPhysical,trigger:report.triggerPhysical},unavailableReason:physical?null:report.continuationUnavailable??'A complete finite terminal continuation is unavailable',terminalMeaning:'Pre-reset failure trigger. Diagnostic last-valid/trigger states are not full simulation continuation snapshots.'}};
}
/** Terminal capture can fail before the next physical step detects corrupt state.
 * Preserve serializable diagnostics and the last finite measured state, never a
 * reset origin or an invented full continuation. */
export function captureTerminalState(sim,context='lab',{lastValidTelemetry=null,step=null,sceneConfiguration=null}={}){
  const actual=capturedFailureTerminal(sim,context,sceneConfiguration);if(actual)return actual;
  try{return{finalSnapshot:captureExperimentSnapshot(sim,context,sceneConfiguration),failureEvidence:null,captureFailed:false};}
  catch(error){
    const t=lastValidTelemetry,last=t?serializableDiagnostic({schema:'roadster-physical-diagnostic',version:1,scope:'last finite telemetry retained by the research recorder; not a full Cannon continuation',simTime:t.simTime,step:null,position:t.position,velocity:t.velocity,quaternion:t.quaternion,angularVelocity:t.angularVelocity,gas:{massKg:t.gasMass,temperatureK:t.gasTemperatureK,pressureBar:t.pressureBar,supplyMode:t.supplyMode},energy:{electricUsedKWh:t.energyUsedKWh},mode:t.mode,stabilizationMode:t.stabilizationMode,wheels:t.wheelStates??[]}):null;
    const failureEvidence=serializableDiagnostic({schema:'roadster-research-terminal-failure',version:1,kind:'terminal-capture-unavailable',reason:String(error.message),phase:'research-finalization-before-physical-safety',triggerStep:sim._stepCount,recordStep:step,triggerSimTime:sim.simTime,lastValidPhysical:last,triggerPhysical:physicalDiagnosticSnapshot(sim),triggerContinuationSnapshot:null,continuationUnavailable:String(error.message),history:null,safetyAction:'Research authority released. Physical solver safety remains responsible for any reset; no final physical state is synthesized.'});
    return{captureFailed:true,failureEvidence,finalSnapshot:{identity:currentExperimentIdentity(),context,physical:null,stateLabel:null,sceneConfiguration:clone(sceneConfiguration),initialSimTime:numeric(sim.simTime),terminalReplayable:false,terminalKind:'diagnostic-only',terminalDiagnostic:{lastValid:last,trigger:failureEvidence.triggerPhysical},unavailableReason:String(error.message),terminalMeaning:'Full terminal capture failed before the physical safety pass. Last finite telemetry and invalid-field descriptions remain exportable; no exact continuation is claimed.'}};
  }
}
export function failurePhysicalTelemetry(current,report){
  if(!report)return current;const valid=v=>v&&['x','y','z'].every(k=>Number.isFinite(v[k])),trigger=report.triggerPhysical,d=valid(trigger?.position)&&valid(trigger?.velocity)&&valid(trigger?.angularVelocity)&&valid(trigger?.quaternion)&&Number.isFinite(trigger?.quaternion?.w)?trigger:report.lastValidPhysical;if(!d)return current;
  const q=d.quaternion,forwardY=2*(q.y*q.z-q.w*q.x),rightY=2*(q.x*q.y+q.w*q.z),upY=1-2*(q.x*q.x+q.z*q.z);
  return{...current,position:clone(d.position),velocity:clone(d.velocity),quaternion:clone(q),angularVelocity:clone(d.angularVelocity),simTime:d.simTime,gasMass:d.gas?.massKg,gasTemperatureK:d.gas?.temperatureK,pressureBar:d.gas?.pressureBar,supplyMode:d.gas?.supplyMode,energyUsedKWh:d.energy?.electricUsedKWh,mode:d.mode,stabilizationMode:d.stabilizationMode,rollDeg:Math.atan2(rightY,upY)*180/Math.PI,pitchDeg:Math.asin(Math.max(-1,Math.min(1,forwardY)))*180/Math.PI,contactCount:d.wheels?.filter(w=>w.contact).length??0,massFlowKgS:null,allocationError:null};
}
export function replayEligibility(record){
  if(record?.finalSnapshot?.terminalReplayable===false)return{exact:false,recompute:false,reason:'失败末态仅有诊断快照，没有可恢复的完整终态；可查看 / 导出触发步骤、最后有效状态和输入，不冒称精确重放'};
  if(!record?.initialSnapshot?.physical)return{exact:false,recompute:false,reason:'这是旧曲线记录，没有完整初态与固定步输入；只能查看，不能按原条件重放'};
  if(record.schema!==EXPERIMENT_SCHEMA||record.version!==1||record.identity?.protocolVersion!==LIVE_PROTOCOL_VERSION)return{exact:false,recompute:false,reason:'此记录协议没有安装执行器；历史数据可以查看与导出'};
  if(record.identity.modelVersion==='3.8.0'&&['3.9.0','3.10.0','3.11.0','3.12.0','3.13.0'].includes(MODEL_VERSION)&&record.initialSnapshot.physical.worldType==='city')return{exact:false,recompute:false,migrationRequired:false,reason:'3.8 城市记录的道路与碰撞几何已经改变，不能安全迁移完整现场状态；仍可查看与导出历史。请在当前城市重新建立实验。3.8 实验室 / 标准平地记录仍可选择明确的当前模型重算。'};
  const current=currentExperimentIdentity();if(record.identity.modelVersion!==current.modelVersion){const migration=canMigrateRecordedState(record.identity.modelVersion,current.modelVersion)&&record.initialSnapshot.physical.schemaVersion===1;return{exact:false,recompute:migration,migrationRequired:migration,reason:migration?(record.identity.modelVersion==='3.8.0'?'原 3.8 模型未安装，不能精确重放。可显式按当前模型重算历史初态：保留原参数、刚体、气源和控制状态，并补充当前模型新增的驱动诊断、升降制动与回正状态；迁移与差异单独留证。':`原 ${record.identity.modelVersion} 模型未安装，不能精确重放。可显式按当前模型重算；执行前核对完整状态字段与碰撞几何签名，保留原参数并声明新增参数映射。轮速、气源、控制器和扰动相位保持。`):'原模型 '+record.identity.modelVersion+' 未安装，且没有此完整状态的迁移器；不能执行旧模型。可查看 / 导出历史，或在流程编辑器明确按当前模型重新建立试验。'};}const exact=record.identity.modelVersion===current.modelVersion&&record.identity.modelBuildId===current.modelBuildId;
  return{exact,recompute:true,reason:exact?'可按原始条件执行当前相同模型 / 构建':'原始模型 / 构建未安装；不能精确重放。可明确选择按当前模型重新计算，并保留来源身份'};
}
function canMigrateRecordedState(from,to){
  if(from==='3.24.0'&&['1.0.0','1.1.0'].includes(to)||from==='1.0.0'&&to==='1.1.0')return true;
  const targets={'3.8.0':['3.9.0','3.10.0','3.11.0','3.12.0','3.13.0'],'3.9.0':['3.10.0','3.11.0','3.12.0','3.13.0'],'3.10.0':['3.11.0','3.12.0','3.13.0'],'3.11.0':['3.12.0','3.13.0'],'3.12.0':['3.13.0'],'3.16.0':['3.17.0']};
  return targets[from]?.includes(to)??false;
}
export function prepareRecordedStateForCurrentModel(record,sim,{recompute=false}={}){
  const physical=clone(record.initialSnapshot.physical),current=currentExperimentIdentity(),source=record.identity;
  const compatibility={model:source.modelVersion===current.modelVersion&&source.modelBuildId===current.modelBuildId?'exact':'current-model-recompute',sourceIdentity:clone(source),executionIdentity:current,conditions:'original-complete-snapshot',migration:null};
  if(physical.modelVersion!==current.modelVersion){
    if(!recompute||!canMigrateRecordedState(source.modelVersion,current.modelVersion)||physical.schemaVersion!==1)throw Error('没有此历史模型的显式状态迁移器');
    const template=sim.exportState(),releaseMigration=['3.24.0','1.0.0'].includes(source.modelVersion)&&['1.0.0','1.1.0'].includes(current.modelVersion),added=releaseMigration?[]:[...(source.modelVersion==='3.8.0'?['_driveAccounting','_verticalControl','_levelRecovery']:[]),...['_routeSurface','_contactFeedback'].filter(key=>key in template.state)];
    if(releaseMigration)assertSnapshotWorldCompatible(sim,physical);
    else if(physical.worldType!==template.worldType||physical.geometrySignature!==template.geometrySignature)throw Error('历史场景几何与当前模型不同；不能把不同碰撞世界标作同一原始条件');
    const parameterMapping={};
    // Older E/Q commands used an explicit 3 m/s² acceleration envelope. A new
    // session's stronger default must not silently accelerate an old input log.
    if(['3.11.0','3.12.0','3.13.0'].includes(current.modelVersion)&&['3.8.0','3.9.0','3.10.0'].includes(source.modelVersion)&&'verticalAccelerationMps2' in template.params&&!('verticalAccelerationMps2' in physical.params)){physical.params.verticalAccelerationMps2=3;parameterMapping.verticalAccelerationMps2={value:3,meaning:'Historical E/Q acceleration envelope; not the stronger new-session default.'};}
    if(canonicalJSON(Object.keys(physical.params).sort())!==canonicalJSON(Object.keys(template.params).sort()))throw Error('历史参数契约不兼容，当前模型重算未开始');
    const migrated=[];for(const key of added)if(!(key in physical.state)&&key in template.state){physical.state[key]=key==='_routeSurface'?null:key==='_contactFeedback'?{sequence:0,lastEvent:null,rigidPairs:{},scope:'Explicit historical mapping: no route surface or contact-onset feedback was recorded.'}:clone(template.state[key]);if(key==='_verticalControl')physical.state[key].accelerationLimitMps2=3;migrated.push('state.'+key);}
    const unexpected=Object.keys(template.state).filter(key=>!(key in physical.state)&&!['_poseTakeoffOriginHeight','_poseTakeoffQuaternion'].includes(key));if(unexpected.length)throw Error('当前模型增加了尚未声明迁移的状态：'+unexpected.join(', '));
    physical.modelVersion=current.modelVersion;compatibility.conditions='explicitly-migrated-historical-initial-state';compatibility.migration={from:source.modelVersion,to:current.modelVersion,addedDefaultState:migrated,parameterMapping,defaultStateMeaning:migrated.length?'Declared historical mapping only: absent route surface is null and contact-onset feedback starts empty, never copied from the live route. For 3.8, absent drive accounting, vertical braking and level-recovery memories also use declared defaults. This is explicit new-model recomputation.':'No default physical or controller state was added. Full historical state and collision signature must match the current contract.',changed:['modelVersion',...Object.keys(parameterMapping).map(key=>'params.'+key)],preserved:'All existing historical parameters (including climbRateMps and manual rate limits), rigid body, wheels, gas, valves, controller state, disturbance phase, observation buffers and seed.',limitation:'The '+source.modelVersion+' solver is not executed. The current model recalculates the explicitly mapped initial state; this is never an exact old-model replay.'};
  }
  return{physical,compatibility};
}
export function validateExperimentRecord(value){
  assertJSON(value,'实验记录');
  if(value?.schema!==EXPERIMENT_SCHEMA||value.version!==1)throw Error('现场实验格式或版本不支持');
  if(typeof value.id!=='string'||value.id.length>120||typeof value.name!=='string'||value.name.length>100)throw Error('实验 ID / 名称无效');
  if(!['completed','cancelled','failed','timeout','limit'].includes(value.status))throw Error('实验结束状态无效');
  if(!value.identity||typeof value.identity.modelVersion!=='string'||typeof value.identity.modelBuildId!=='string'||value.identity.fixedHz!==FIXED_HZ)throw Error('实验身份 / 固定物理频率无效');
  if(!value.initialSnapshot?.physical||(!value.finalSnapshot?.physical&&!(value.status==='failed'&&value.failureEvidence&&value.finalSnapshot?.terminalReplayable===false))||!Array.isArray(value.inputRuns)||!Array.isArray(value.events)||!Array.isArray(value.samples)||!value.summary||!value.sampling)throw Error('缺少快照、输入、事件、采样说明或统计');
  if(!Number.isInteger(value.stepCount)||value.stepCount<0||value.stepCount>EXPERIMENT_LIMITS.steps||value.inputRuns.length>value.stepCount||value.events.length>EXPERIMENT_LIMITS.events||value.samples.length>6002)throw Error('实验规模超出支持范围');
  if(value.analyses!==undefined&&(!Array.isArray(value.analyses)||value.analyses.some(a=>!a||typeof a!=='object'||Array.isArray(a))))throw Error('实验分析列表无效');
  for(const analysis of value.analyses??[]){
    if(analysis.changed!==undefined&&(!Array.isArray(analysis.changed)||analysis.changed.some(key=>typeof key!=='string')))throw Error('实验分析的参数差异列表无效');
    for(const result of [analysis,analysis.baseline,analysis.candidate].filter(v=>v!=null)){
      if(typeof result!=='object'||Array.isArray(result)||result.samples!==undefined&&(!Array.isArray(result.samples)||result.samples.some(row=>!row||typeof row!=='object'||Array.isArray(row))))throw Error('实验分析的曲线结构无效');
    }
    const controller=analysis.reproduction?.controller;
    if(controller&&(!Array.isArray(controller.missingFields)||controller.missingFields.some(key=>typeof key!=='string')))throw Error('实验分析的控制状态比较无效');
  }
  let count=0;for(const run of value.inputRuns){if(!Number.isInteger(run.steps)||run.steps<1||!run.input||typeof run.input!=='object'||Array.isArray(run.input))throw Error('固定步输入损坏');for(const [k,v]of Object.entries(run.input))if(!INPUT_KEYS.includes(k)||k==='boost'&&typeof v!=='boolean'||k!=='boost'&&(!finite(v)||Math.abs(v)>1))throw Error('记录含不受支持的输入');count+=run.steps;}
  if(count!==value.stepCount)throw Error('输入数量和物理步数不一致');
  if(value.appliedInputRuns&&(!Array.isArray(value.appliedInputRuns)||value.appliedInputRuns.reduce((n,r)=>n+(Number.isInteger(r.steps)&&r.steps>0?r.steps:NaN),0)!==value.stepCount))throw Error('实际应用输入证据的步数不一致');
  if(value.initialSnapshot.stateLabel!==contentLabel(value.initialSnapshot.physical)||(value.finalSnapshot.physical?value.finalSnapshot.stateLabel!==contentLabel(value.finalSnapshot.physical):value.finalSnapshot.stateLabel!==null))throw Error('完整状态内容与记录标签不一致；不能将改写后的文件静默视为原实验');
  let lastStep=-1;for(const event of value.events){if(!Number.isInteger(event.step)||event.step<lastStep||event.step>value.stepCount)throw Error('事件步序不一致');lastStep=event.step;if(event.kind==='command'&&(!COMMAND_METHODS.includes(event.method)||!Array.isArray(event.args)))throw Error('事件含未允许的控制 API');}
  if(value.initialSnapshot.identity?.modelVersion!==value.identity.modelVersion||value.initialSnapshot.identity?.modelBuildId!==value.identity.modelBuildId)throw Error('初态与实验身份不一致');
  if(value.initialSnapshot.physical.modelVersion!==value.identity.modelVersion)throw Error('物理快照与模型身份不一致');
  let previousSample=-1;for(const sample of value.samples){if(!finite(sample.timeS)||sample.timeS<0||!Number.isInteger(sample.step)||sample.step<=previousSample||sample.step>value.stepCount||Math.abs(sample.timeS-sample.step/FIXED_HZ)>1e-8)throw Error('采样时间或固定步索引无效');previousSample=sample.step;}
  return value;
}
function measuredSample(t,step,initialTime,includeReview=true){
  const target=t.mode==='hover'?(t.reference?.position??t.holdPositionTarget??null):null,q=t.reference?.quaternion??t.holdQuaternionTarget??t.manualQuaternionTarget;
  return{step,timeS:step/FIXED_HZ,simTime:t.simTime??initialTime+step/FIXED_HZ,position:{...t.position},velocity:{...t.velocity},quaternion:{...t.quaternion},angularVelocity:{...t.angularVelocity},heightM:numeric(t.position?.y),targetHeightM:numeric(target?.y??t.targetAltitude),positionErrorM:poseError(t.position,target),attitudeErrorDeg:attitudeError(t.quaternion,q),speedMps:norm(t.velocity),rollDeg:numeric(t.rollDeg),pitchDeg:numeric(t.pitchDeg),pressureBar:numeric(t.pressureBar),gasMassKg:numeric(t.gasMass),tankTemperatureK:numeric(t.gasTemperatureK),massFlowKgS:Math.max(0,t.massFlowKgS||0),supplyMode:t.supplyMode,allocationError:numeric(t.allocationError),feasible:t.holdFeasible??t.manualPoseFeasible??null,contactCount:t.contactCount??0,wheelOmegaRadS:(t.wheelStates||[]).map(w=>numeric(w.angularVelocityRadS)),wheelSlip:(t.wheelStates||[]).map(w=>numeric(w.slipRatio)),wingDeployment:numeric(t.wing?.deployment??t.wingDeployment),...(includeReview?{
    headingDeg:numeric(t.headingDeg),mode:t.mode??null,wheels:(t.wheelStates??[]).map(w=>({id:w.id??null,contact:!!w.contact,normalLoadN:numeric(w.normalLoadN),surfaceId:w.surfaceId??w.contactObjectId??null,surfaceMaterial:w.surfaceMaterial??null,mu:numeric(w.surfaceMu),slipPowerW:numeric(w.slipPowerW)})),
    owner:t.controlOwnership?.owner??null,positionPolicy:t.controlOwnership?.positionPolicy??null,positionTarget:clone(t.controlOwnership?.positionTarget??null),heightTarget:numeric(t.controlOwnership?.heightTarget),commandForceN:numeric(t.controlOwnership?.commandForceN),actualForceN:numeric(t.controlOwnership?.actualForceN??t.thrustN),valveResidualOnly:!!t.controlOwnership?.valveResidualOnly,nozzles:(t.nozzles??[]).map(n=>({id:n.id,commandN:numeric(n.command),actualN:numeric(n.force)})),contactEvent:clone(t.contactFeedback?.lastEvent??null)
  }:{})};
}
function energyBaseline(t){return{usedKWh:numeric(t.energyUsedKWh),revision:t.energyAccounting?.revision,grossJ:numeric(t.energyAccounting?.grossJ),recoveredJ:numeric(t.energyAccounting?.recoveredJ)};}
function emptyStats(){return{source:'all fixed 120 Hz post-integration states; independent of stored display curve',version:2,energyAccountingScope:'Signed net battery use = delivered battery energy minus regeneration across acknowledged solver steps; explicit resets and resource preparation are excluded. Incomplete accounting is labelled.',energyAccountingComplete:true,energyDischargedKWh:0,energyRecoveredKWh:0,count:0,positionCount:0,sumPositionSquared:0,peakPositionErrorM:null,peakAttitudeErrorDeg:null,allocationCount:0,saturatedCount:0,gasThroughputKg:0,onboardDischargedKg:0,externalSupplyKg:0,energyUsedKWh:0,peakSpeedMps:0,minimumHeightM:null,maximumHeightM:null};}
function accumulate(stats,t,dt,previousEnergy){
  const sample=measuredSample(t,0,0,false);stats.count++;
  if(sample.positionErrorM!==null){stats.positionCount++;stats.sumPositionSquared+=sample.positionErrorM**2;stats.peakPositionErrorM=Math.max(stats.peakPositionErrorM??0,sample.positionErrorM);}
  if(sample.attitudeErrorDeg!==null)stats.peakAttitudeErrorDeg=Math.max(stats.peakAttitudeErrorDeg??0,sample.attitudeErrorDeg);
  if(sample.allocationError!==null){stats.allocationCount++;if(sample.feasible===false||sample.allocationError>.2)stats.saturatedCount++;}
  const mass=Number.isFinite(t.integration?.gasThroughputKg)&&Math.abs(t.integration.controlDtS-dt)<1e-10?t.integration.gasThroughputKg:sample.massFlowKgS*dt;stats.gasThroughputKg+=mass;if(t.supplyMode==='bench')stats.externalSupplyKg+=mass;else stats.onboardDischargedKg+=mass;
  // Use the ledger on both sides of this actual solver step. Clipping negative
  // battery change erased regeneration; differencing across a reset would
  // instead invent recharge. The caller captures this baseline after commands.
  const energy=energyBaseline(t),gross=energy.grossJ-previousEnergy.grossJ,recovered=energy.recoveredJ-previousEnergy.recoveredJ;
  if(energy.revision===previousEnergy.revision&&[energy.grossJ,energy.recoveredJ,previousEnergy.grossJ,previousEnergy.recoveredJ].every(finite)&&gross>=-1e-8&&recovered>=-1e-8){
    const delivered=Math.max(0,gross)/3.6e6,returned=Math.max(0,recovered)/3.6e6;
    stats.energyDischargedKWh+=delivered;stats.energyRecoveredKWh+=returned;stats.energyUsedKWh+=delivered-returned;
  }else{
    stats.energyAccountingComplete=false;
    if(finite(energy.usedKWh)&&finite(previousEnergy.usedKWh))stats.energyUsedKWh+=energy.usedKWh-previousEnergy.usedKWh;
  }
  stats.peakSpeedMps=Math.max(stats.peakSpeedMps,sample.speedMps);
  if(sample.heightM!==null){stats.minimumHeightM=Math.min(stats.minimumHeightM??Infinity,sample.heightM);stats.maximumHeightM=Math.max(stats.maximumHeightM??-Infinity,sample.heightM);}
}
function finishStats(stats,t,expectedSteps=stats.count){return{...stats,energyAccountingComplete:stats.energyAccountingComplete&&stats.count===expectedSteps,rmsPositionErrorM:stats.positionCount?Math.sqrt(stats.sumPositionSquared/stats.positionCount):null,saturationFraction:stats.allocationCount?stats.saturatedCount/stats.allocationCount:null,gasRemainingKg:numeric(t.gasMass),finalPosition:{...t.position},finalVelocity:{...t.velocity},finalQuaternion:{...t.quaternion},finalAngularVelocity:{...t.angularVelocity},finalFault:t.fault??null};}
export function sampleDescription(samples,{rawCount=samples.length,rawHz=20,decimated=false}={}){
  const intervals=samples.slice(1).map((s,i)=>s.timeS-samples[i].timeS),uniform=intervals.length<2||intervals.every(d=>Math.abs(d-intervals[0])<1e-8);
  return{source:'simulation time',rawHz,rawCount,storedCount:samples.length,decimated,uniform,storedIntervalS:uniform&&intervals.length?intervals[0]:null,minIntervalS:intervals.length?Math.min(...intervals):null,maxIntervalS:intervals.length?Math.max(...intervals):null,note:decimated?'展示曲线已经抽稀；请使用每行 timeS。汇总量保留原始固定步统计，不由此曲线重算。':'原始 20 Hz 样本含初态和必要的最后端点；非整采样终止时最后间隔可能缩短。'};
}

/** Public commands are journaled only between solver steps. Nested calls and
 * calls made internally by the solver are deliberately not duplicated. */
export class ExperimentRecorder{
  constructor({getSim,getContext=()=> 'city',getSceneConfiguration=()=>null,onFinish=()=>{},onStatus=()=>{},now=()=>new Date().toISOString()}={}){Object.assign(this,{getSim,getContext,getSceneConfiguration,onFinish,onStatus,now});this.active=null;this.serial=0;this._restorers=[];this.inPhysics=false;this.commandDepth=0;}
  start({name='现场驾驶 / 飞行',kind='manual',program=null,lineage=null}={}){
    if(this.active)throw Error('请先结束当前现场记录');
    const sim=this.getSim(),initialSnapshot=captureExperimentSnapshot(sim,this.getContext(),this.getSceneConfiguration()),t=sim.telemetry(),startedAt=this.now();
    const a={id:`live-${startedAt.replace(/[^0-9]/g,'')}-${++this.serial}`,sim,name:safeText(name,100),kind,program:program?clone(program):null,lineage:lineage?clone(lineage):null,initialSnapshot,startedAt,stepCount:0,inputRuns:[],appliedInputRuns:[],events:[],samples:[measuredSample(t,0,t.simTime)],stats:emptyStats(),previousEnergy:energyBaseline(t),lastValidTelemetry:t,pendingInput:null};this.active=a;this.inPhysics=false;
    for(const method of COMMAND_METHODS){if(typeof sim[method]!=='function')continue;const original=sim[method],own=Object.prototype.hasOwnProperty.call(sim,method),self=this;function wrapped(...args){const capture=self.active?.sim===this&&!self.inPhysics&&self.commandDepth===0;self.commandDepth++;let result,error;try{result=original.apply(this,args);return result;}catch(e){error=e;throw e;}finally{self.commandDepth--;if(capture&&self.active){self._event({kind:'command',method,args:clone(args),accepted:!error&&result!==false,error:error?safeText(error.message):null});if(self.active)self.active.previousEnergy=energyBaseline(this.telemetry());}}}Object.defineProperty(sim,method,{value:wrapped,writable:true,configurable:true,enumerable:own?Object.getOwnPropertyDescriptor(sim,method).enumerable:false});this._restorers.push(()=>{if(sim[method]===wrapped){if(own)sim[method]=original;else delete sim[method];}});}
    this.event('record_start',{kind,context:initialSnapshot.context});this.onStatus(this.getState());return initialSnapshot;
  }
  _event(event){const a=this.active;if(!a)return;if(a.events.length>=EXPERIMENT_LIMITS.events){this.finish('limit','控制事件达到记录上限，原记录已保留');return;}a.events.push({step:a.stepCount,simTime:a.sim.simTime,...event});}
  event(type,detail={}){if(this.active)this._event({kind:'event',type:safeText(type,80),detail:clone(detail??{})});}
  beforeStep(input={}){
    const a=this.active;if(!a)return input;if(a.sim!==this.getSim()||a.initialSnapshot.context!==this.getContext()){this.finish('cancelled','场景切换终止本条记录');return input;}
    if(a.stepCount>=EXPERIMENT_LIMITS.steps){this.finish('limit','已达到 300 s 记录上限');return input;}
    const normalized=normalizeRecordedInput(input),last=a.inputRuns.at(-1);if(last&&canonicalJSON(last.input)===canonicalJSON(normalized))last.steps++;else a.inputRuns.push({steps:1,input:normalized});a.pendingInput=normalized;this.inPhysics=true;return input;
  }
  afterStep(t,input,dt=1/FIXED_HZ){
    this.inPhysics=false;const a=this.active;if(!a||a.pendingInput===null)return;a.pendingInput=null;
    if(!Number.isFinite(dt)||Math.abs(dt-1/FIXED_HZ)>1e-10){this.finish('failed','记录器只接受已声明的 120 Hz 固定步长');return;}
    const applied=normalizeRecordedInput(input||t.driverInput||{}),lastApplied=a.appliedInputRuns.at(-1);if(lastApplied&&canonicalJSON(lastApplied.input)===canonicalJSON(applied))lastApplied.steps++;else a.appliedInputRuns.push({steps:1,input:applied});
    a.stepCount++;if(t.fault&&a.sim.getFailureReport?.()){this.event('solver_fault',{fault:t.fault});this.finish('failed',String(t.fault));return;}accumulate(a.stats,t,dt,a.previousEnergy);a.previousEnergy=energyBaseline(t);a.lastValidTelemetry=t;
    if(a.stepCount%6===0)a.samples.push(measuredSample(t,a.stepCount,a.initialSnapshot.initialSimTime));
    if(t.fault){this.event('solver_fault',{fault:t.fault});this.finish('failed',String(t.fault));}else if(a.stepCount>=EXPERIMENT_LIMITS.steps)this.finish('limit','已达到 300 s 记录上限');
  }
  finish(status='completed',reason='现场记录结束'){
    const a=this.active;if(!a)return null;this.inPhysics=false;
    // A provider may be interrupted before integration. Do not claim this input
    // was applied unless afterStep acknowledged it.
    if(a.pendingInput!==null){const last=a.inputRuns.at(-1);if(last&&--last.steps===0)a.inputRuns.pop();a.pendingInput=null;}
    const currentScene=a.sim===this.getSim()&&a.initialSnapshot.context===this.getContext(),terminal=captureTerminalState(a.sim,a.initialSnapshot.context,{lastValidTelemetry:a.lastValidTelemetry,step:a.stepCount,sceneConfiguration:currentScene?this.getSceneConfiguration():a.initialSnapshot.sceneConfiguration}),failureEvidence=terminal.failureEvidence,t=failurePhysicalTelemetry(a.sim.telemetry(),failureEvidence);if(terminal.captureFailed){status='failed';reason='terminal_capture_failed: '+failureEvidence.reason;}else if(failureEvidence&&status==='completed'){status='failed';reason=failureEvidence.reason;}
    if(!failureEvidence&&a.samples.at(-1)?.step!==a.stepCount)a.samples.push(measuredSample(t,a.stepCount,a.initialSnapshot.initialSimTime));
    this.event('record_finish',{status,reason:safeText(reason)});
    const finalSnapshot=terminal.finalSnapshot;
    if(!currentScene)finalSnapshot.sceneConfigurationScope='The host already changed scenes; this is the saved initial presentation, not a claimed final camera measurement.';
    const result={schema:EXPERIMENT_SCHEMA,version:1,id:a.id,name:a.name,kind:a.kind,identity:{...a.initialSnapshot.identity},context:a.initialSnapshot.context,startedAt:a.startedAt,status,reason:safeText(reason),durationS:a.stepCount/FIXED_HZ,stepCount:a.stepCount,initialSnapshot:a.initialSnapshot,finalSnapshot,failureEvidence,program:a.program,lineage:a.lineage,inputRuns:a.inputRuns,appliedInputRuns:a.appliedInputRuns,inputDefinition:'inputRuns are effective pre-solver driver commands; appliedInputRuns are solver-applied commands after deterministic internal interlocks; playback feeds only inputRuns',events:a.events,summary:finishStats(a.stats,t,a.stepCount),sampling:sampleDescription(a.samples),samples:a.samples};
    attachRuntimeProvenance(result);this.active=null;for(const restore of this._restorers.splice(0))restore();this.onFinish(result);this.onStatus(this.getState());return result;
  }
  getState(){const a=this.active;return a?{recording:true,id:a.id,name:a.name,kind:a.kind,stepCount:a.stepCount,durationS:a.stepCount/FIXED_HZ,eventCount:a.events.length}:{recording:false};}
}

export class ExperimentPlayback{
  constructor(record,{sim,recompute=false,controllerOverride=null,onEvent=()=>{}}={}){
    validateExperimentRecord(record);const eligible=replayEligibility(record);if(!recompute&&!eligible.exact)throw Error(eligible.reason);if(recompute&&!eligible.recompute)throw Error(eligible.reason);
    if(!sim||typeof sim.importState!=='function')throw Error('重放需要物理仿真实例');
    this.record=record;this.sim=sim;this.recompute=recompute;this.onEvent=onEvent;this.step=0;this.runIndex=0;this.runRemaining=record.inputRuns[0]?.steps||0;this.eventIndex=0;this.finished=false;this.controllerOverride=controllerOverride;
    const prepared=prepareRecordedStateForCurrentModel(record,sim,{recompute});this.compatibility=prepared.compatibility;sim.importState(prepared.physical,{allowVersionMismatch:false});
    if(controllerOverride){for(const [key,value]of Object.entries(controllerOverride)){if(!CONTROLLER_KEYS.includes(key)||!finite(value))throw Error('A/B 只允许声明过的控制器参数差异');if(record.events.some(e=>e.kind==='command'&&e.method==='setParam'&&e.args[0]===key))throw Error(`记录中途修改了 ${key}，不能把这条记录作为恒定参数公平 A/B`);sim.setParam(key,value);}}
    this.check=new ExperimentReproductionCheck(record,{expectAgreement:!recompute&&!controllerOverride,compatibility:this.compatibility,controllerOverride});this.check.observe(measuredSample(sim.telemetry(),0,sim.simTime),0);
  }
  applyEvents(){while(this.eventIndex<this.record.events.length&&this.record.events[this.eventIndex].step===this.step){const e=this.record.events[this.eventIndex++];if(e.kind==='command'){let result,error;try{result=this.sim[e.method](...clone(e.args));}catch(caught){error=caught;}if(!this.recompute&&((!error&&result!==false)!==e.accepted))throw Error(`第 ${this.step} 步命令 ${e.method} 接受状态与原记录不同`);if(error&&e.accepted)throw error;}else this.onEvent(e);}}
  nextInput(){if(this.finished)return{};this.applyEvents();if(this.step>=this.record.stepCount){this.finished=true;return{};}return clone(this.record.inputRuns[this.runIndex]?.input||{});}
  afterStep(t=this.sim.telemetry()){if(this.finished)return;this.step++;if(--this.runRemaining<=0){this.runIndex++;this.runRemaining=this.record.inputRuns[this.runIndex]?.steps||0;}if(this.step<this.record.stepCount||this.step%6===0)this.check.observe(measuredSample(t,this.step,this.record.initialSnapshot.initialSimTime),this.step);if(this.step>=this.record.stepCount){this.applyEvents();this.finished=true;}}
  reproduction({status=this.finished?'completed':'cancelled',reason='',finalPhysical=this.sim.exportState()}={}){return this.check.finish({finalPhysical,finalSample:measuredSample(this.sim.telemetry(),this.step,this.record.initialSnapshot.initialSimTime),completedSteps:this.step,status,reason,semantics:this.controllerOverride?'fixed-driver-inputs-with-controller-redecision':this.recompute?'fixed-input-current-model-recompute':'fixed-input-replay'});}
  getState(){return{replaying:!this.finished,step:this.step,totalSteps:this.record.stepCount,name:this.record.name,exactModel:this.compatibility.model==='exact',executionSemantics:this.controllerOverride?'fixed-driver-inputs-with-controller-redecision':this.recompute?'fixed-input-current-model-recompute':'fixed-input-replay'};}
}

/** Numerical replay is the same solver execution without a renderer. It is
 * used by workers for repeatability and paired controller comparisons. */
export async function executeExperiment(record,{createSim,recompute=false,controllerOverride=null,signal,onProgress=()=>{},yieldEvery=600,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  if(typeof createSim!=='function')throw Error('缺少数值求解器工厂');
  const sim=createSim(record.initialSnapshot.physical),playback=new ExperimentPlayback(record,{sim,recompute,controllerOverride}),snapshot=captureExperimentSnapshot(sim,record.context,record.initialSnapshot.sceneConfiguration),stats=emptyStats(),samples=[measuredSample(sim.telemetry(),0,sim.simTime)];let previousEnergy=energyBaseline(sim.telemetry()),status='completed',reason='按记录输入执行完成';
  try{while(!playback.finished){if(signal?.aborted){status='cancelled';reason='用户取消数值执行';break;}const eventIndex=playback.eventIndex,input=playback.nextInput();if(playback.finished)break;if(record.events.slice(eventIndex,playback.eventIndex).some(event=>event.kind==='command'))previousEnergy=energyBaseline(sim.telemetry());const t=sim.advanceFixed(input,1/FIXED_HZ),integratedStep=playback.step+1;
      if(t.fault&&sim.getFailureReport?.()){playback.step=integratedStep;status='failed';reason=String(t.fault);break;}
      // The physical step already happened. Account its gas/energy and sample
      // before afterStep applies terminal commands, which may fail separately.
      accumulate(stats,t,1/FIXED_HZ,previousEnergy);previousEnergy=energyBaseline(t);if(integratedStep%6===0)samples.push(measuredSample(t,integratedStep,snapshot.initialSimTime));playback.afterStep(t);if(t.fault){status='failed';reason=String(t.fault);break;}if(yieldEvery>0&&playback.step%yieldEvery===0){onProgress({step:playback.step,totalSteps:record.stepCount});await yieldTask();}}
  }catch(error){status='failed';reason=safeText(error.message);}
  const failureTerminal=status==='failed'?capturedFailureTerminal(sim,record.context):null,t=failurePhysicalTelemetry(sim.telemetry(),failureTerminal?.failureEvidence);if(!failureTerminal&&samples.at(-1)?.step!==playback.step)samples.push(measuredSample(t,playback.step,snapshot.initialSimTime));
  const finalSnapshot=failureTerminal?.finalSnapshot??captureExperimentSnapshot(sim,record.context),failureEvidence=failureTerminal?.failureEvidence??null,reproduction=failureTerminal?{schema:'roadster.reproduction-verdict',version:1,status:'incomplete',executionStatus:'failed',reason:'Solver failure; pre-reset terminal diagnostics are retained separately. A reset state is never a reproduction target.',completedSteps:playback.step,requestedSteps:record.stepCount}:playback.reproduction({status,reason,finalPhysical:finalSnapshot.physical});
  return{schema:'roadster.record-execution',version:1,identity:currentExperimentIdentity(),sourceIdentity:clone(record.identity),sourceId:record.id,sourceStateLabel:record.initialSnapshot.stateLabel,execution:recompute?'current-model-recompute':'original-conditions-replay',inputSemantics:controllerOverride?'Recorded driver inputs and public command timing stay fixed. The current controller decides actuator commands again with declared gains; this is not a new autonomous pilot executing the original intent.':'Replays the recorded effective pre-solver input sequence and public command events; internal controller and interlock decisions are recalculated by the declared solver.',compatibility:playback.compatibility,reproduction,controllerOverride:controllerOverride?clone(controllerOverride):null,status,reason,completedSteps:playback.step,requestedSteps:record.stepCount,initialSnapshot:snapshot,finalSnapshot,failureEvidence,sceneConfigurationNote:'Initial presentation is retained as provenance. Numerical execution does not render or produce a final camera configuration.',summary:finishStats(stats,t,playback.step),sampling:sampleDescription(samples),samples};
}
export async function compareControllers(record,{createSim,controllerA={},controllerB={},signal,onProgress=()=>{},...options}={}){
  const changed=Object.keys({...controllerA,...controllerB}).filter(k=>(controllerA[k]??record.initialSnapshot.physical.params[k])!==(controllerB[k]??record.initialSnapshot.physical.params[k]));
  if(!changed.length)throw Error('A 与 B 没有声明的控制器参数差异');
  for(const key of changed)if(!CONTROLLER_KEYS.includes(key))throw Error('公平 A/B 只允许控制器参数差异');
  const common={schema:'roadster.snapshot-controller-pair',version:1,sourceId:record.id,identity:currentExperimentIdentity(),sourceIdentity:clone(record.identity),sourceStateLabel:record.initialSnapshot.stateLabel,changed,conditions:'Both executions import the identical full physical snapshot and recorded command/input sequence, including wind phase and observer RNG/buffers; only declared controller gains differ. A/B is explicitly recomputed with current model.'};
  const baseline=await executeExperiment(record,{...options,createSim,recompute:true,controllerOverride:controllerA,signal,onProgress:p=>onProgress({case:'A',...p})});
  if(signal?.aborted)return{...common,status:baseline.status==='failed'?'failed':'cancelled',reason:'A/B执行中止；B尚未计算',baseline,candidate:null};
  const candidate=await executeExperiment(record,{...options,createSim,recompute:true,controllerOverride:controllerB,signal,onProgress:p=>onProgress({case:'B',...p})});
  const statuses=[baseline.status,candidate.status],status=statuses.includes('failed')?'failed':statuses.includes('cancelled')?'cancelled':statuses.every(s=>s==='completed')?'completed':'failed';
  return{...common,status,reason:status==='completed'?'两组按同一记录条件执行完成':'至少一组未完成，不能将本对照判为成功',baseline,candidate};
}

export function compactExperiment(record,maxSamples=301){
  const out=clone(record);if(out.samples.length>maxSamples){const source=out.samples,stride=Math.ceil((source.length-1)/(maxSamples-1));out.samples=source.filter((_,i)=>i%stride===0||i===source.length-1);out.sampling=sampleDescription(out.samples,{rawCount:record.sampling.rawCount,rawHz:record.sampling.rawHz,decimated:true});}
  // Full inputs, commands, initial/final solver state and raw statistics stay.
  return out;
}
export function parseExperimentArchive(text,{maxRecords=EXPERIMENT_LIMITS.importRecords}={}){
  if(typeof text!=='string'||byteLength(text)>EXPERIMENT_LIMITS.importBytes)throw Error('现场实验归档需小于 12 MiB');let archive;try{archive=JSON.parse(text);}catch{throw Error('现场实验归档不是有效 JSON');}
  const records=archive?.schema===EXPERIMENT_SCHEMA?[archive]:archive?.schema==='roadster.live-experiment-library'&&archive.version===1?archive.records:null;
  if(!Array.isArray(records)||records.length>maxRecords)throw Error('实验归档结构错误或超过 '+maxRecords+' 条');const ids=new Set();for(const r of records){validateExperimentRecord(r);if(ids.has(r.id))throw Error('归档含重复实验 ID');ids.add(r.id);}return records;
}
export function exportExperimentArchive(records){return{schema:'roadster.live-experiment-library',version:1,exportedAt:new Date().toISOString(),scope:'all live records in this browser/session; each record retains its own model/build/protocol, exact inputs/state and immutable raw statistics',records};}
export function loadExperimentArchive(storage){
  let raw;try{raw=storage?.getItem(EXPERIMENT_LIBRARY_KEY)||'';if(!raw)return{records:[],warning:null,protectedRaw:null,raw:raw||null};if(byteLength(raw)>EXPERIMENT_LIMITS.storageBytes)throw Error('存档超过 4 MiB，暂不覆盖');return{records:parseExperimentArchive(raw,{maxRecords:EXPERIMENT_LIMITS.records}),warning:null,protectedRaw:null,raw};}catch(error){return{records:[],warning:'旧现场存档已保护：'+error.message,protectedRaw:raw||null,raw:raw||null};}
}
// Source captures are immutable. Only independently appended analyses can be
// merged between pages. Compare contents, never a short non-cryptographic label.
function experimentCore(record){const {analyses,...core}=record;return canonicalJSON(compactExperiment(core));}
function assertSharedSamplesAgree(a,b){
  const byStep=new Map(a.samples.map(sample=>[sample.step,sample]));
  for(const sample of b.samples){const previous=byStep.get(sample.step);if(previous&&canonicalJSON(previous)!==canonicalJSON(sample))throw Error('同 ID 实验的相同步采样内容不同，未合并：'+b.id+' / 第 '+sample.step+' 步');}
}
export function mergeExperimentRecord(current,local,base){
  validateExperimentRecord(current);validateExperimentRecord(local);if(base)validateExperimentRecord(base);
  // Compaction may omit display samples, but it cannot excuse a disagreement
  // at a time both archives actually retained. Never interpolate absent data.
  assertSharedSamplesAgree(current,local);if(base){assertSharedSamplesAgree(base,current);assertSharedSamplesAgree(base,local);}
  if(experimentCore(current)!==experimentCore(local)||base&&experimentCore(base)!==experimentCore(local))throw Error('同 ID 的原始实验内容不同，未覆盖：'+local.id);
  const before=base?.analyses??[],remote=current.analyses??[],incoming=local.analyses??[];
  if(base&&[remote,incoming].some(list=>before.some((value,i)=>canonicalJSON(value)!==canonicalJSON(list[i]??null))))throw Error('另一页面的分析历史与本页冲突，未覆盖：'+local.id);
  const merged=[...remote],seen=new Map();
  const keyFor=analysis=>{const text=canonicalJSON(analysis);return{key:typeof analysis.id==='string'?'id:'+analysis.id:'content:'+text,text};};
  for(const analysis of remote){const {key,text}=keyFor(analysis),prior=seen.get(key);if(prior&&prior.text!==text)throw Error('同 ID 的分析内容不同，未覆盖：'+analysis.id);seen.set(key,{text,count:(prior?.count??0)+1});}
  // Keep repeated legacy attempts already present in either archive. New
  // executions carry unique IDs; identical legacy entries have no attempt ID.
  for(const analysis of incoming){const {key,text}=keyFor(analysis),prior=seen.get(key);if(prior&&prior.text!==text)throw Error('同 ID 的分析内容不同，未覆盖：'+analysis.id);if(prior?.count>0){prior.count--;continue;}seen.set(key,{text,count:0});merged.push(analysis);}
  return{...local,...(merged.length||local.analyses||current.analyses?{analyses:merged}:{})};
}
export function saveExperimentArchive(storage,records,{protectedRaw=null,replace=false,expectedRaw,baseRaw,activeRecordIds=[]}={}){
  if(!storage)throw Error('浏览器存储不可用，请导出整库 JSON');if(protectedRaw)throw Error('旧存档受保护，新记录只留在当前会话；请先导出原存档');
  const existing=loadExperimentArchive(storage);if(existing.warning)throw Error(existing.warning);
  const baseline=new Map((baseRaw?parseExperimentArchive(baseRaw):[]).map(r=>[r.id,r])),all=new Map((replace?[]:existing.records).map(r=>[r.id,r]));
  for(const record of records){validateExperimentRecord(record);const current=all.get(record.id),base=baseline.get(record.id);
    if(!replace&&!current&&(base||activeRecordIds.includes(record.id))){
      // An in-flight worker/replay owns this source. Keep its original object
      // and baseline in the session until the result has been retained; an
      // unrelated save must not retire it under the execution callback.
      if(!activeRecordIds.includes(record.id)&&canonicalJSON(compactExperiment(record))===canonicalJSON(compactExperiment(base)))continue;
      throw Error('另一页面已删除此实验，本页执行与新增分析仅保留在会话，未恢复已删除记录：'+record.id);
    }
    all.set(record.id,!replace&&current?mergeExperimentRecord(current,record,base):record);
  }
  if(all.size>EXPERIMENT_LIMITS.records)throw Error('达到 32 条记录上限；旧记录未删除，新结果只保留在本次会话，请导出整库');
  const compact=[...all.values()].map(r=>compactExperiment(validateExperimentRecord(r))),text=JSON.stringify(exportExperimentArchive(compact));if(byteLength(text)>EXPERIMENT_LIMITS.storageBytes)throw Error('达到 4 MiB 存储上限；旧记录未覆盖，新结果只保留在本次会话，请导出整库');
  const saved=writeArchiveCandidate(storage,EXPERIMENT_LIBRARY_KEY,exportExperimentArchive(compact),{parse:parseExperimentArchive,maxBytes:EXPERIMENT_LIMITS.storageBytes,protectedRaw,expectedRaw:expectedRaw===undefined?existing.raw:expectedRaw});
  if(storage.getItem(EXPERIMENT_LIBRARY_KEY)!==saved.raw)throw Error('保存后存档发生变化或未写入；本页成果仍可导出，请重新尝试保存');
  return compact;
}
export function experimentCSV(record){
  const identity=record.identity||{},fields=['timeS','simTime','step','heightM','targetHeightM','positionErrorM','attitudeErrorDeg','speedMps','rollDeg','pitchDeg','pressureBar','gasMassKg','tankTemperatureK','massFlowKgS','supplyMode','allocationError','feasible','contactCount','wingDeployment'];
  const cell=v=>v===null||v===undefined?'':typeof v==='number'||typeof v==='boolean'?String(v):'"'+String(v).replaceAll('"','""')+'"';
  return['# Single selected experiment; model='+identity.modelVersion+'; build='+identity.modelBuildId+'; protocol='+identity.protocolVersion,'# record_id='+record.id+'; status='+record.status,'# sampling='+JSON.stringify(record.sampling),'# immutable_raw_summary='+JSON.stringify(record.summary),'# Full solver state, input journal and event order are in the matching JSON. CSV is the stored display/sample series, not an executable replay.',fields.join(','),...record.samples.map(s=>fields.map(k=>cell(s[k])).join(','))].join('\r\n');
}
