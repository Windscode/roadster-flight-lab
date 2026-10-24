import * as CANNON from './vendor/cannon-es.js';
import {MODEL_VERSION} from './vehicle-models.js';
import {observationConfiguration} from './control-observation.js';
import {validateRouteSurface} from './route-surface.js';
import {canonicalGeometryJSON} from './irradiance-math.js';

export const SIM_STATE_SCHEMA='roadster-sim-state',SIM_STATE_SCHEMA_VERSION=1;
const omitted=new Set(['params','worldType','world','body','geometry','_roadMaterial','_wheelStopMaterial','_wheelStopIndices','_ray','_wheelRays','_pads','_observationBody','_integration']);
const allowedState=new Set(('_accumulator _achievedWrench _allocationError _contactCount _desiredWrench _effectiveExhaustVelocity _energyUsed _fallReset _fanLevel _fault _gLoad _hasPower _headingTarget _heightIntegral _heightJogging _heightTarget _holdActive _holdFeasible _holdPositionTarget _holdQuaternionTarget _holdStatus _impulseNs _landingContactTime _lastInput _lastVelocity _longitudinalAcceleration _maneuver _manualCommandInput _manualPoseFeasible _manualQuaternionTarget _manualReferenceRate _manualTranslationActive _massFlowKgS _motorForceN _motorWork _nozzles _poseTakeoffActive _poseTakeoffOriginHeight _poseTakeoffQuaternion _poseTargetExplicit _positionTarget _pressureLimited _regenForceN _rollReference _sealDistanceCount _sealDistanceSum _sealLipContacts _sealLipExtensions _sealQuality _stabilizationActive _stableHeading _stableHeight _stableJogging _steerCentre _stepCount _suctionForce _thrustN _thrustWanted _wind airStabilization gasInitialMass gasMass gasTemperature mode scenario simTime stabilizationMode status suctionEnabled wheelStates _wing _observation _observationConfig _observationHistory _observationSeed _nozzleFault _gasConsumedKg _externalGasKg _brakeDissipationJ _tireDissipationJ _driveAccounting _verticalControl _levelRecovery _researchHeightControl _routeSurface _contactFeedback').split(' '));
const bodyFields=('position previousPosition interpolatedPosition initPosition velocity initVelocity force mass invMass linearDamping type allowSleep sleepState sleepSpeedLimit sleepTimeLimit timeLastSleepy wakeUpAfterNarrowphase torque quaternion initQuaternion previousQuaternion interpolatedQuaternion angularVelocity initAngularVelocity shapeOffsets shapeOrientations inertia invInertia invMassSolve invInertiaSolve fixedRotation angularDamping linearFactor angularFactor vlambda wlambda collisionFilterGroup collisionFilterMask collisionResponse isTrigger').split(' ');
const worldFields=('time stepnumber dt accumulator default_dt quatNormalizeSkip quatNormalizeFast allowSleep hasActiveBodies gravity frictionGravity').split(' ');
const forbidden=new Set(['__proto__','prototype','constructor']);
const fail=message=>{throw new Error(`快照不可恢复：${message}`);};

function encode(value){
  if(value instanceof CANNON.Quaternion)return{$type:'Quaternion',values:[value.x,value.y,value.z,value.w].map(encode)};
  if(value instanceof CANNON.Vec3)return{$type:'Vec3',values:[value.x,value.y,value.z].map(encode)};
  if(value===undefined)return{$type:'Undefined'};
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('包含非有限数');return Object.is(value,-0)?{$type:'NegativeZero'}:value;}
  if(Array.isArray(value))return value.map(encode);
  if(typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
    const result={};for(const [key,entry]of Object.entries(value)){if(forbidden.has(key))fail('非法字段');result[key]=encode(entry);}return result;
  }
  fail('存在未声明的状态类型');
}
function decode(value,depth=0){
  if(depth>32)fail('嵌套过深');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('包含非有限数');return value;}
  if(!value||typeof value!=='object')fail('非 JSON 状态');
  if(Array.isArray(value)){if(value.length>20000)fail('数组超出限制');return value.map(v=>decode(v,depth+1));}
  if(value.$type){
    if(value.$type==='Undefined'&&Object.keys(value).length===1)return undefined;
    if(value.$type==='NegativeZero'&&Object.keys(value).length===1)return -0;
    const count=value.$type==='Quaternion'?4:value.$type==='Vec3'?3:0;
    if(!count||!Array.isArray(value.values)||value.values.length!==count||Object.keys(value).length!==2)fail('向量类型无效');
    const values=value.values.map(v=>decode(v,depth+1));if(!values.every(Number.isFinite))fail('向量类型无效');
    if(count===4&&Math.abs(Math.hypot(...values)-1)>.002)fail('四元数未归一化');
    return count===4?new CANNON.Quaternion(...values):new CANNON.Vec3(...values);
  }
  const result={};for(const [key,entry]of Object.entries(value)){if(forbidden.has(key))fail('非法字段');result[key]=decode(entry,depth+1);}return result;
}
function geometrySignature(sim){
  // Identity is supplementary to the cryptographic build identity kept by the
  // experiment record. Body ordering / shape counts are part of continuation.
  const text=JSON.stringify([sim.geometry,sim.world.bodies.map(b=>[b.type,b.shapes.length,b===sim.body?'vehicle':b.userData?.id])]);
  return hashGeometry(text);
}
function hashGeometry(text){
  let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);
  return(h>>>0).toString(16).padStart(8,'0');
}
function shapeGeometry(shape){
  const types=CANNON.Shape.types;
  if(shape.type===types.BOX)return[shape.type,shape.halfExtents.toArray()];
  if(shape.type===types.PLANE)return[shape.type];
  if(shape.type===types.SPHERE)return[shape.type,shape.radius];
  if(shape.type===types.CYLINDER||shape.type===types.CONVEXPOLYHEDRON)return[shape.type,shape.vertices.map(v=>v.toArray()),shape.faces];
  fail('碰撞形状尚未加入几何身份契约');
}
export function simulationGeometryIdentity(sim){
  // Sub-nanometre rounding removes platform math last-bit differences, not
  // real scene changes. Keep body/shape order: contact histories use indices.
  // Vehicle transforms and wheel steering are continuation state; fixed scene
  // transforms, local shape transforms and primitive dimensions are geometry.
  const bodies=sim.world.bodies.map(b=>[b.type,b===sim.body?'vehicle':b.userData?.id,
    b.shapes.map(shapeGeometry),...(b===sim.body?[]:[b.position.toArray(),b.quaternion.toArray(),b.shapeOffsets.map(v=>v.toArray()),b.shapeOrientations.map(q=>q.toArray()),b.collisionFilterGroup,b.collisionFilterMask,b.collisionResponse,b.isTrigger])]);
  return{schema:'roadster-collision-identity',version:1,precision:1e-9,signature:hashGeometry(canonicalGeometryJSON([sim.geometry,bodies]))};
}
export function assertSnapshotWorldCompatible(sim,snapshot){
  if(snapshot?.worldType!==sim.worldType||typeof snapshot.geometrySignature!=='string'||!/^[\da-f]{8}$/.test(snapshot.geometrySignature))fail('场景几何或世界类型不匹配');
  if(Object.hasOwn(snapshot,'geometryIdentity')){
    const identity=snapshot.geometryIdentity;
    if(!identity||identity.schema!=='roadster-collision-identity'||identity.version!==1||identity.precision!==1e-9||typeof identity.signature!=='string'||identity.signature!==simulationGeometryIdentity(sim).signature)fail('场景几何或世界类型不匹配');
  }else if(snapshot.geometrySignature!==geometrySignature(sim)){
    // An old raw signature cannot prove cross-engine equivalence. Never infer
    // a portable identity for historical data or rewrite imported evidence.
    fail('场景几何或世界类型不匹配');
  }
}
const pick=(object,fields)=>Object.fromEntries(fields.filter(k=>k in object).map(k=>[k,encode(object[k])]));
function sameType(value,template){
  if(template instanceof CANNON.Vec3)return value instanceof CANNON.Vec3;
  if(template instanceof CANNON.Quaternion)return value instanceof CANNON.Quaternion;
  if(Array.isArray(template))return Array.isArray(value)&&value.length===template.length&&value.every((v,i)=>sameType(v,template[i]));
  if(template===null||template===undefined)return value===template;
  return typeof value===typeof template;
}
function pairIndices(matrix,bodies){
  const indices=new Map(bodies.map((b,i)=>[b.id,i]));
  return Object.keys(matrix.matrix).map(k=>k.split('-').map(Number).map(id=>indices.get(id))).filter(p=>p.every(Number.isInteger));
}
function overlaps(keeper,objects){
  const indices=new Map(objects.map((o,i)=>[o.id,i]));
  const list=key=>keeper[key].map(v=>[(v>>>16)&65535,v&65535].map(id=>indices.get(id))).filter(p=>p.every(Number.isInteger));
  return{current:list('current'),previous:list('previous')};
}
export function exportSimulationState(sim){
  const state={};for(const [key,value]of Object.entries(sim))if(!omitted.has(key)){
    if(!allowedState.has(key))fail(`新状态 ${key} 尚未加入快照契约`);state[key]=encode(value);
  }
  const bodies=sim.world.bodies,shapes=bodies.flatMap(b=>b.shapes);
  const contacts=sim.world.contacts.map(c=>({bi:bodies.indexOf(c.bi),bj:bodies.indexOf(c.bj),si:c.bi.shapes.indexOf(c.si),sj:c.bj.shapes.indexOf(c.sj),values:pick(c,['minForce','maxForce','a','b','eps','enabled','multiplier','restitution','ri','rj','ni'])}));
  return{schema:SIM_STATE_SCHEMA,schemaVersion:SIM_STATE_SCHEMA_VERSION,modelVersion:MODEL_VERSION,worldType:sim.worldType,geometrySignature:geometrySignature(sim),geometryIdentity:simulationGeometryIdentity(sim),params:encode(sim.params),state,
    body:pick(sim.body,bodyFields),world:{...pick(sim.world,worldFields),solver:{iterations:sim.world.solver.iterations,tolerance:sim.world.solver.tolerance},contacts,
      collisionPairs:pairIndices(sim.world.collisionMatrix,bodies),previousCollisionPairs:pairIndices(sim.world.collisionMatrixPrevious,bodies),bodyOverlaps:overlaps(sim.world.bodyOverlapKeeper,bodies),shapeOverlaps:overlaps(sim.world.shapeOverlapKeeper,shapes)}};
}
export function importSimulationState(sim,snapshot,{allowVersionMismatch=false}={}){
  if(allowVersionMismatch)fail('不支持跨模型执行；请使用明确标记的新模型重算');
  if(snapshot?.schema!==SIM_STATE_SCHEMA||snapshot.schemaVersion!==SIM_STATE_SCHEMA_VERSION)fail('不支持的状态格式');
  if(snapshot.modelVersion!==MODEL_VERSION)fail(`模型 ${snapshot.modelVersion} 与当前 ${MODEL_VERSION} 不同`);
  assertSnapshotWorldCompatible(sim,snapshot);
  const state=decode(snapshot.state),body=decode(snapshot.body),world=decode(snapshot.world),params=decode(snapshot.params);
  if(!state||!body||!world||!params)fail('状态不完整');
  // Absence has an explicit legacy meaning, never the destination live state.
  // Model-version checks above still prohibit silently running historical physics.
  if(!('_routeSurface' in state))state._routeSurface=null;
  if(!('_contactFeedback' in state))state._contactFeedback={sequence:0,lastEvent:null,rigidPairs:{},scope:'Legacy snapshot: no contact-onset feedback recorded.'};
  if(state._routeSurface!==null){try{validateRouteSurface(state._routeSurface);}catch{fail('路线表面描述无效');}}
  const feedback=state._contactFeedback,event=feedback?.lastEvent;
  if(!feedback||!Number.isInteger(feedback.sequence)||feedback.sequence<0||!feedback.rigidPairs||typeof feedback.rigidPairs!=='object'||Object.keys(feedback.rigidPairs).length>128||Object.values(feedback.rigidPairs).some(t=>!Number.isFinite(t)||t<0))fail('接触反馈状态无效');
  if(event!==null&&(!event||!Number.isInteger(event.id)||event.id<1||event.id>feedback.sequence||!['touchdown','hull-impact'].includes(event.kind)||!['timeS','normalEnergyJ','normalImpulseNs','normalSpeedMps'].every(k=>Number.isFinite(event[k])&&event[k]>=0)||!Array.isArray(event.wheelIds)||event.wheelIds.length>4))fail('接触开始事件无效');
  for(const key of Object.keys(state))if(!allowedState.has(key))fail(`未知状态 ${key}`);
  // An absent field cannot silently inherit the current vehicle's history.
  for(const key of Object.keys(sim))if(!omitted.has(key)&&!(key in state)&&key!=='_poseTakeoffOriginHeight'&&key!=='_poseTakeoffQuaternion')fail(`缺少状态 ${key}`);
  for(const key of bodyFields)if(!(key in body))fail(`缺少车体状态 ${key}`);
  for(const key of bodyFields)if(!sameType(body[key],sim.body[key]))fail(`车体状态 ${key} 类型无效`);
  if(!(body.position instanceof CANNON.Vec3)||!(body.quaternion instanceof CANNON.Quaternion)||body.mass<=0||body.mass>20000||state._accumulator< -1e-9||state._accumulator>.11||state.simTime<0||state.gasMass<0||state.gasTemperature<=0)fail('物理状态越界');
  if(!['drive','hover','manual'].includes(state.mode)||!['off','level','hold'].includes(state.stabilizationMode)||state._nozzles?.length!==10||state.wheelStates?.length!==4||body.shapeOrientations.length!==sim.body.shapes.length)fail('执行器状态不完整');
  if(Math.abs(body.invMass-1/body.mass)>1e-10||['x','y','z'].some(k=>body.inertia[k]<=0||body.invInertia[k]<=0))fail('质量／惯量状态无效');
  const currentParams=Object.keys(sim.params);if(Object.keys(params).length!==currentParams.length||currentParams.some(k=>!(k in params)))fail('参数契约不匹配');
  if(!Number.isFinite(params.verticalAccelerationMps2)||params.verticalAccelerationMps2<1||params.verticalAccelerationMps2>10)fail('升降加速度参数无效');
  for(const [key,value]of Object.entries(params))if(typeof value!==typeof sim.params[key])fail(`参数 ${key} 类型不同`);
  if(!['dry','wet','split'].includes(params.roadSurface)||!['active','fixed'].includes(params.wingMode)||!['bench','finite'].includes(params.supplyMode)||!['adiabatic','isothermal'].includes(params.gasModel)||!['constant','isentropic'].includes(params.nozzleModel)||params.wheelRadius<=0||params.wheelInertia<=0||params.tankLitres<=0||params.gasTemperatureK<=0||params.tireMu<=0||params.valveRiseTime<=0||params.valveFallTime<=0)fail('参数取值无效');
  for(const key of ['_lastVelocity','_manualCommandInput','_manualReferenceRate','_positionTarget'])if(!(state[key] instanceof CANNON.Vec3))fail(`向量 ${key} 无效`);
  for(const key of ['_holdPositionTarget'])if(state[key]!==null&&!(state[key] instanceof CANNON.Vec3))fail(`目标 ${key} 无效`);
  for(const key of ['_manualQuaternionTarget','_holdQuaternionTarget','_poseTakeoffQuaternion'])if(state[key]!=null&&!(state[key] instanceof CANNON.Quaternion))fail(`目标 ${key} 无效`);
  if(state._nozzles.some((n,i)=>n.id!==sim._nozzles[i].id||n.kind!==sim._nozzles[i].kind||!(n.position instanceof CANNON.Vec3)||!(n.direction instanceof CANNON.Vec3)||!Array.isArray(n.column)||n.column.length!==6||n.position.distanceTo(sim._nozzles[i].position)>1e-12||n.direction.distanceTo(sim._nozzles[i].direction)>1e-12||n.column.some((v,k)=>Math.abs(v-sim._nozzles[i].column[k])>1e-12)||![n.force,n.command,n.maxForce].every(v=>Number.isFinite(v)&&v>=0)))fail('喷口状态或几何不匹配');
  if(state.wheelStates.some((w,i)=>w.id!==sim.wheelStates[i].id||!Number.isFinite(w.angularVelocityRadS)||!Number.isFinite(w.rotation)||!Number.isFinite(w.absPressure)||w.absPressure<0||w.absPressure>1||!Number.isFinite(w.tcsFactor)||w.tcsFactor<0||w.tcsFactor>1))fail('轮速/调节器状态无效');
  const drive=state._driveAccounting,vertical=state._verticalControl,recovery=state._levelRecovery;
  if(!drive||!['torqueBudgetNm','requestedTorqueNm','postTcsTorqueNm','actualTorqueNm','mechanicalPowerLimitW','mechanicalPowerW','electricalPowerW','mechanicalWorkJ','electricalWorkJ'].every(k=>Number.isFinite(drive[k])&&drive[k]>=0)||typeof drive.powerLimited!=='boolean'||!['unloaded-drive-cut','equal-four-wheel-shares'].includes(drive.airbornePolicy)||!Array.isArray(drive.shares)||drive.shares.length!==4||drive.shares.some(v=>!Number.isFinite(v)||v<0||v>1)||drive.shares.reduce((a,v)=>a+v,0)>1+1e-10)fail('驱动预算状态无效');
  if(!vertical||!['commandMps','targetMps','accelerationLimitMps2'].every(k=>Number.isFinite(vertical[k]))||vertical.accelerationLimitMps2<=0||typeof vertical.braking!=='boolean'||typeof vertical.pilotActive!=='boolean')fail('升降控制状态无效');
  const researchHeight=state._researchHeightControl;
  if(!researchHeight||typeof researchHeight.enabled!=='boolean'||typeof researchHeight.active!=='boolean'||typeof researchHeight.reason!=='string'||researchHeight.reason.length>120||researchHeight.controllerHash!==null&&(typeof researchHeight.controllerHash!=='string'||researchHeight.controllerHash.length>128)||researchHeight.requestedAccelerationMps2!==null&&!Number.isFinite(researchHeight.requestedAccelerationMps2)||researchHeight.appliedAccelerationMps2!==null&&(!Number.isFinite(researchHeight.appliedAccelerationMps2)||Math.abs(researchHeight.appliedAccelerationMps2)>6+1e-9)||researchHeight.commandStep!==null&&(!Number.isInteger(researchHeight.commandStep)||researchHeight.commandStep<0)||researchHeight.expiresAtStep!==null&&(!Number.isInteger(researchHeight.expiresAtStep)||researchHeight.expiresAtStep<0)||researchHeight.enabled&&(!Number.isInteger(researchHeight.commandStep)||!Number.isInteger(researchHeight.expiresAtStep)||researchHeight.expiresAtStep<=researchHeight.commandStep||researchHeight.expiresAtStep-researchHeight.commandStep>12||researchHeight.requestedAccelerationMps2===null||researchHeight.controllerHash===null))fail('研究高度外环状态无效');
  const maneuver=state._maneuver;
  if(maneuver?.abortReason!==undefined&&(typeof maneuver.abortReason!=='string'||maneuver.abortReason.length>200))fail('滚转中止原因无效');
  if(maneuver?.name==='pitch'){
    const q=maneuver.profile;
    if(!q||q.kind!=='controlled-pitch-1'||!['angleRad','rateRadS','accelerationRadS2','rampS','cruiseS','durationS'].every(k=>Number.isFinite(q[k]))||
      Math.abs(q.angleRad-2*Math.PI)>1e-8||Math.abs(q.rateRadS-5*Math.PI/3)>1e-8||Math.abs(q.accelerationRadS2-25*Math.PI/9)>1e-8||
      Math.abs(q.rampS-.6)>1e-8||Math.abs(q.cruiseS-.6)>1e-8||Math.abs(q.durationS-1.8)>1e-8||
      !Number.isFinite(maneuver.actualPitchRad)||!Number.isFinite(maneuver.launchAccelerationMps2)||maneuver.launchAccelerationMps2<=0||
      maneuver.launchAccelerationMps2>Math.max(0,4*params.liftNozzleMax/body.mass-params.gravity)+1e-8||
      Math.abs(maneuver.minimumRotationClearanceM-2.65)>1e-8||Math.abs(maneuver.duration-1.8)>1e-8||
      !['climb','rotate','land','recover'].includes(maneuver.phase))fail('受控后翻轨迹版本、状态或净空无效');
  }
  if(maneuver?.name==='roll'&&maneuver.profile){
    const q=maneuver.profile;
    if(!['pilot-rate-envelope','quick-roll-1'].includes(q.kind)||!['angleRad','rateRadS','accelerationRadS2','rampS','cruiseS','durationS'].every(k=>Number.isFinite(q[k]))||q.angleRad<=0||q.rateRadS<=0||q.rateRadS>2*Math.PI+1e-10||q.accelerationRadS2<=0||q.accelerationRadS2>4*Math.PI+1e-10||q.rampS<=0||q.cruiseS<0||Math.abs(q.durationS-2*q.rampS-q.cruiseS)>1e-8||Math.abs(q.angleRad-q.rateRadS*(q.rampS+q.cruiseS))>1e-8||!Number.isFinite(maneuver.launchAccelerationMps2)||maneuver.launchAccelerationMps2<=0||maneuver.launchAccelerationMps2>(q.kind==='quick-roll-1'?Math.max(0,4*params.liftNozzleMax/body.mass-params.gravity):10)+1e-8||!Number.isFinite(maneuver.actualRollRad))fail('滚转指令轨迹状态无效');
    if(q.kind==='quick-roll-1'&&(!Number.isFinite(maneuver.minimumRotationClearanceM)||!Number.isFinite(maneuver.duration)||Math.abs(maneuver.duration-q.durationS)>1e-8||Math.abs(q.angleRad-2*Math.PI)>1e-8||Math.abs(q.rateRadS-2*Math.PI)>1e-8||Math.abs(q.accelerationRadS2-4*Math.PI)>1e-8||Math.abs(q.rampS-.5)>1e-8||Math.abs(q.cruiseS-.5)>1e-8||Math.abs(maneuver.minimumRotationClearanceM-1.55)>1e-8))fail('快翻轨迹版本或轮廓净空无效');
  }
  if(!recovery||!['inactive','armed','surface','recovering','limited','level','pilot-pitch'].includes(recovery.status)||!['active','verticalSupportFeasible','torqueSaturated'].every(k=>typeof recovery[k]==='boolean')||!Number.isFinite(recovery.tiltErrorDeg)||recovery.tiltErrorDeg<0||recovery.tiltErrorDeg>180||!Number.isFinite(recovery.headingTargetRad))fail('自动回正状态无效');
  if(!state._wing||![state._wing.deployment,state._wing.command].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!Number.isFinite(state._wing.incidenceRad)||!['position','applicationPoint','forceBody'].every(k=>state._wing[k]&&['x','y','z'].every(a=>Number.isFinite(state._wing[k][a])))||!Number.isInteger(state._stepCount)||state._stepCount<0)fail('执行器或固定步相位无效');
  try{observationConfiguration(state._observationConfig);}catch{fail('观测配置无效');}
  if(!Number.isInteger(state._observationSeed)||state._observationSeed<0||state._observationSeed>4294967295||!Array.isArray(state._observationHistory)||state._observationHistory.length>130)fail('观测延迟线无效');
  const sampleValid=o=>o&&Number.isFinite(o.simTime)&&['position','velocity','angularVelocity'].every(k=>o[k]&&['x','y','z'].every(a=>Number.isFinite(o[k][a])))&&o.quaternion&&['x','y','z','w'].every(a=>Number.isFinite(o.quaternion[a]))&&Math.abs(Math.hypot(o.quaternion.x,o.quaternion.y,o.quaternion.z,o.quaternion.w)-1)<.002;
  if(!sampleValid(state._observation)||state._observationHistory.some((o,i)=>!sampleValid(o)||i>0&&o.simTime<state._observationHistory[i-1].simTime))fail('观测历史无效');
  if(state._nozzleFault!==null&&(!state._nozzleFault||!sim._nozzles.some(n=>n.id===state._nozzleFault.id)||!Number.isFinite(state._nozzleFault.scale)||state._nozzleFault.scale<0||state._nozzleFault.scale>1))fail('喷口降额状态无效');
  const bodies=sim.world.bodies,shapes=bodies.flatMap(b=>b.shapes);
  const validPairs=(pairs,items)=>Array.isArray(pairs)&&pairs.every(p=>Array.isArray(p)&&p.length===2&&p.every(i=>Number.isInteger(i)&&i>=0&&i<items.length));
  if(!validPairs(world.collisionPairs,bodies)||!validPairs(world.previousCollisionPairs,bodies)||!['current','previous'].every(k=>validPairs(world.bodyOverlaps?.[k],bodies)&&validPairs(world.shapeOverlaps?.[k],shapes)))fail('接触历史无效');
  if(!Array.isArray(world.contacts)||world.contacts.length>128||world.contacts.some(c=>!bodies[c.bi]||!bodies[c.bj]||!bodies[c.bi].shapes[c.si]||!bodies[c.bj].shapes[c.sj]||!['ri','rj','ni'].every(k=>c.values?.[k] instanceof CANNON.Vec3)||!['minForce','maxForce','a','b','eps','multiplier','restitution'].every(k=>Number.isFinite(c.values[k]))||typeof c.values.enabled!=='boolean'))fail('接触状态无效');
  for(const key of worldFields)if(key in sim.world&&(!(key in world)||!sameType(world[key],sim.world[key])))fail(`世界状态 ${key} 无效`);
  if(!Number.isFinite(world.time)||!Number.isInteger(world.stepnumber)||world.stepnumber<0||!Number.isInteger(world.solver?.iterations)||world.solver.iterations<1||world.solver.iterations>100||!Number.isFinite(world.solver.tolerance)||world.solver.tolerance<=0)fail('求解器状态无效');
  // No mutation occurs until all values and reference indices validate.
  sim.params=params;
  for(const key of allowedState){if(key in state)sim[key]=state[key];else delete sim[key];}
  for(const key of bodyFields)sim.body[key]=body[key];
  sim.body.updateInertiaWorld(true);sim.body.updateBoundingRadius();sim.body.aabbNeedsUpdate=true;
  for(const key of worldFields){if(key in world)sim.world[key]=world[key];}
  sim.world.solver.iterations=world.solver.iterations;sim.world.solver.tolerance=world.solver.tolerance;
  for(const [matrix,list]of [[sim.world.collisionMatrix,world.collisionPairs],[sim.world.collisionMatrixPrevious,world.previousCollisionPairs]]){matrix.reset();for(const [a,b]of list)matrix.set(bodies[a],bodies[b],true);}
  for(const [keeper,data,items]of [[sim.world.bodyOverlapKeeper,world.bodyOverlaps,bodies],[sim.world.shapeOverlapKeeper,world.shapeOverlaps,shapes]])for(const key of ['current','previous'])keeper[key]=data[key].map(([a,b])=>keeper.getKey(items[a].id,items[b].id)).sort((a,b)=>a-b);
  sim.world.contacts=world.contacts.map(c=>{const equation=new CANNON.ContactEquation(bodies[c.bi],bodies[c.bj]);Object.assign(equation,c.values);equation.si=bodies[c.bi].shapes[c.si];equation.sj=bodies[c.bj].shapes[c.sj];return equation;});
  // Cannon regenerates contact / friction equations before solving each step;
  // previous contact identity above is needed by support logic and events.
  sim.world.frictionEquations.length=0;sim.world.broadphase.dirty=true;sim._observationBody=null;sim._integration=null;
  return{ok:true,modelVersion:MODEL_VERSION,simTime:sim.simTime};
}
