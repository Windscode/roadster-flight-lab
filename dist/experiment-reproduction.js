/* Reproduction is a measured comparison, not a synonym for solver completion.
 * Tolerances describe numerical agreement, not Tesla calibration accuracy. */
export const REPRODUCTION_TOLERANCES=Object.freeze({
  positionM:1e-6,velocityMps:1e-6,attitudeDeg:1e-5,angularVelocityRadS:1e-6,
  gasMassKg:1e-8,tankTemperatureK:1e-6,wheelOmegaRadS:1e-5,
  controllerAbsolute:1e-7,controllerRelative:1e-9,
});
const finite=Number.isFinite;
const clone=v=>JSON.parse(JSON.stringify(v));
const tuple=v=>Array.isArray(v)?v:v?.$type==='Vec3'||v?.$type==='Quaternion'?v.values.map(x=>x?.$type==='NegativeZero'?-0:x):v&&typeof v==='object'?['x','y','z',...('w'in v?['w']:[])].map(k=>scalar(v[k])):null;
const scalar=v=>v?.$type==='NegativeZero'?-0:v;
const distance=(a,b)=>a&&b&&a.length===b.length&&a.every(finite)&&b.every(finite)?Math.hypot(...a.map((v,i)=>v-b[i])):null;
export function quaternionDistanceDeg(a,b){
  a=tuple(a);b=tuple(b);if(!a||!b||a.length!==4||b.length!==4||!a.every(finite)||!b.every(finite))return null;
  const na=Math.hypot(...a),nb=Math.hypot(...b);if(na<1e-12||nb<1e-12)return null;
  a=a.map(v=>v/na);b=b.map(v=>v/nb);const sign=a.reduce((s,v,i)=>s+v*b[i],0)<0?-1:1;
  // atan2 of quaternion chords is well conditioned close to exact equality.
  return 4*Math.atan2(Math.hypot(...a.map((v,i)=>v-sign*b[i])),Math.hypot(...a.map((v,i)=>v+sign*b[i])))*180/Math.PI;
}
const CONTROLLER_FIELDS=['mode','stabilizationMode','airStabilization','suctionEnabled','simTime','_stepCount','_steerCentre','_verticalControl','_levelRecovery','_headingTarget','_heightIntegral','_heightJogging','_heightTarget','_holdActive','_holdFeasible','_holdPositionTarget','_holdQuaternionTarget','_holdStatus','_manualCommandInput','_manualPoseFeasible','_manualQuaternionTarget','_manualReferenceRate','_manualTranslationActive','_maneuver','_poseTakeoffActive','_poseTakeoffOriginHeight','_poseTakeoffQuaternion','_poseTargetExplicit','_positionTarget','_rollReference','_stableHeading','_stableHeight','_stableJogging','_stabilizationActive','_landingContactTime','_nozzles','_observationConfig','_observationSeed','_observationHistory','_nozzleFault','_wing','_wind','_lastVelocity','_lastInput','_fanLevel','_sealLipExtensions','_sealLipContacts','_energyUsed','_motorWork','_gasConsumedKg','_externalGasKg','_brakeDissipationJ','_tireDissipationJ','_driveAccounting'];
const OPTIONAL_CONTROLLER_FIELDS=new Set(['_poseTakeoffOriginHeight','_poseTakeoffQuaternion']);
CONTROLLER_FIELDS.push('_pressureLimited','_allocationError','_hasPower','_sealQuality','_sealDistanceSum','_sealDistanceCount');
const WHEEL_MEMORY_FIELDS=['id','steer','rotation','suspensionLength','contact','normalLoadN','relaxedSlip','slipRatio','absPressure','tcsFactor','absActive','tcsActive'];
const BODY_CONFIGURATION_FIELDS=['mass','invMass','inertia','invInertia','linearDamping','angularDamping','linearFactor','angularFactor','type','fixedRotation','shapeOffsets','shapeOrientations','collisionFilterGroup','collisionFilterMask','collisionResponse','isTrigger'];
const WORLD_CONFIGURATION_FIELDS=['time','stepnumber','gravity','solver','quatNormalizeSkip','quatNormalizeFast'];
// Sensor history deliberately uses plain objects, unlike Cannon's tagged
// targets. Only this declared quaternion path gets sign-invariant treatment.
const plainQuaternionPath=path=>/^state\._observationHistory\.\d+\.quaternion$/u.test(path);
const DISCRETE_NUMBER_PATHS=new Set(['state._observationSeed','state._observationConfig.seed','state._stepCount','world.stepnumber','world.solver.iterations','world.quatNormalizeSkip','body.type','body.collisionFilterGroup','body.collisionFilterMask']);
function contactSupportSet(world){
  if(!Array.isArray(world?.contacts))return null;
  const support=[];for(const c of world.contacts){if(!['bi','bj','si','sj'].every(k=>Number.isInteger(c[k])&&c[k]>=0))return null;const a=[c.bi,c.si],b=[c.bj,c.sj];if(a[0]>b[0]||a[0]===b[0]&&a[1]>b[1])support.push([...b,...a].join(':'));else support.push([...a,...b].join(':'));}
  // The next controller reads hull/shape support before Cannon rebuilds its
  // equations. Local index sets avoid global IDs, ordering and multipliers.
  return[...new Set(support)].sort();
}
const requiredTerminal=['position','velocity','attitude','angularVelocity','gasMass','tankTemperature','wheelOmega'];
function terminalState(physical){const s=physical?.state||{},body=physical?.body||{};return{
  position:tuple(body.position),velocity:tuple(body.velocity),attitude:tuple(body.quaternion),angularVelocity:tuple(body.angularVelocity),
  gasMass:scalar(s.gasMass),tankTemperature:scalar(s.gasTemperature),wheelOmega:s.wheelStates?.map(w=>scalar(w.angularVelocityRadS)),
};}
function curveState(sample){return{
  position:tuple(sample.position),velocity:tuple(sample.velocity),attitude:tuple(sample.quaternion),angularVelocity:tuple(sample.angularVelocity),
  gasMass:sample.gasMassKg,tankTemperature:sample.tankTemperatureK,wheelOmega:sample.wheelOmegaRadS,
};}
const channelInfo={position:['m','positionM'],velocity:['m/s','velocityMps'],attitude:['deg','attitudeDeg'],angularVelocity:['rad/s','angularVelocityRadS'],gasMass:['kg','gasMassKg'],tankTemperature:['K','tankTemperatureK'],wheelOmega:['rad/s','wheelOmegaRadS']};
function errorFor(key,a,b){if(key==='attitude')return quaternionDistanceDeg(a,b);if(Array.isArray(a)||Array.isArray(b))return distance(a,b);return finite(a)&&finite(b)?Math.abs(a-b):null;}

/** Compare only actually retained reference samples at exact fixed-step indices.
 * Full-state checks are terminal; they do not invent 120 Hz historical curves. */
export class ExperimentReproductionCheck{
  constructor(record,{expectAgreement=true,compatibility=null,controllerOverride=null}={}){
    this.record=record;this.expectAgreement=expectAgreement;this.compatibility=compatibility;this.controllerOverride=controllerOverride;
    this.referenceSamples=new Map(record.samples.map(s=>[s.step,s]));this.seen=new Set();this.curves={};this.firstDivergence=null;this.mismatchCount=0;
  }
  mismatch(detail){this.mismatchCount++;if(!this.firstDivergence||detail.step<this.firstDivergence.step)this.firstDivergence={...detail,timeS:detail.step/120};}
  compareChannel(channel,a,b,{step,scope}){
    const [unit,key]=channelInfo[channel],error=errorFor(channel,a,b),tolerance=REPRODUCTION_TOLERANCES[key];
    const comparison={error,tolerance,unit,available:error!==null,withinTolerance:error===null?null:error<=tolerance};
    if(error!==null&&error>tolerance)this.mismatch({scope,channel,step,error,tolerance,unit});return comparison;
  }
  observe(sample,step=sample.step){
    const original=this.referenceSamples.get(step);if(!original||this.seen.has(step))return;this.seen.add(step);
    const a=curveState(original),b=curveState(sample);
    for(const channel of requiredTerminal){const value=this.compareChannel(channel,a[channel],b[channel],{step,scope:'stored-curve'}),entry=this.curves[channel]??={unit:value.unit,tolerance:value.tolerance,comparedSamples:0,missingSamples:0,maxError:null,maxErrorStep:null};if(value.available){entry.comparedSamples++;if(entry.maxError===null||value.error>entry.maxError){entry.maxError=value.error;entry.maxErrorStep=step;}}else entry.missingSamples++;}
  }
  finish({finalPhysical,finalSample,completedSteps,status='completed',reason='',semantics='fixed-input-replay'}={}){
    // The recorder includes an off-grid terminal sample only at finish(), after
    // any terminal public commands. On-grid samples came from afterStep().
    if(finalSample)this.observe(finalSample,completedSteps);
    const original=terminalState(this.record.finalSnapshot.physical),current=terminalState(finalPhysical),terminal={},sameTerminalStep=completedSteps===this.record.stepCount;
    for(const key of requiredTerminal)terminal[key]=sameTerminalStep?this.compareChannel(key,original[key],current[key],{step:completedSteps,scope:'terminal'}):{error:null,tolerance:REPRODUCTION_TOLERANCES[channelInfo[key][1]],unit:channelInfo[key][0],available:false,withinTolerance:null,reason:'Recorded terminal step was not reached; comparing a partial state to a future endpoint would be misleading.'};
    if(terminal.wheelOmega.available)terminal.wheelOmega.wheels=this.record.finalSnapshot.physical.state.wheelStates.map((w,i)=>({id:w.id,error:Math.abs(original.wheelOmega[i]-current.wheelOmega[i]),unit:'rad/s'}));
    const controller={comparedAtSourceTerminal:sameTerminalStep,comparedScalars:0,comparedDiscrete:0,missingFields:[],absentOptionalFields:[],mismatchCount:0,maxAbsoluteError:0,maxNormalizedError:0,firstMismatch:null};
    const walk=(a,b,path)=>{
      a=scalar(a);b=scalar(b);
      if(a?.$type==='Undefined')a=undefined;if(b?.$type==='Undefined')b=undefined;
      if(DISCRETE_NUMBER_PATHS.has(path)&&finite(a)&&finite(b)){controller.comparedDiscrete++;if(a!==b)different(path,Math.abs(a-b),0);return;}
      if(finite(a)&&finite(b)){const error=Math.abs(a-b),tolerance=REPRODUCTION_TOLERANCES.controllerAbsolute+REPRODUCTION_TOLERANCES.controllerRelative*Math.max(Math.abs(a),Math.abs(b));controller.comparedScalars++;controller.maxAbsoluteError=Math.max(controller.maxAbsoluteError,error);controller.maxNormalizedError=Math.max(controller.maxNormalizedError,error/tolerance);if(error>tolerance)different(path,error,tolerance);return;}
      if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
        if(a.$type==='Quaternion'&&b.$type==='Quaternion'||plainQuaternionPath(path)){const error=quaternionDistanceDeg(a,b),tolerance=REPRODUCTION_TOLERANCES.attitudeDeg;if(error===null){controller.missingFields.push(path);return;}controller.comparedScalars++;controller.maxAbsoluteError=Math.max(controller.maxAbsoluteError,error);controller.maxNormalizedError=Math.max(controller.maxNormalizedError,error/tolerance);if(error>tolerance)different(path,error,tolerance);return;}
        for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],path+'.'+key);return;
      }
      controller.comparedDiscrete++;if(a!==b)different(path,null,0);
    };
    const different=(path,error,tolerance)=>{controller.mismatchCount++;const mismatch={scope:'terminal-controller',channel:path,step:completedSteps,error,tolerance,unit:error===null?'exact state':'state units'};controller.firstMismatch??=mismatch;this.mismatch(mismatch);};
    const compareRequired=(a,b,key,path)=>{if(!a||!(key in a)||!b||!(key in b)){controller.missingFields.push(path);return;}walk(a[key],b[key],path);};
    if(sameTerminalStep){for(const key of CONTROLLER_FIELDS){const originalState=this.record.finalSnapshot.physical.state||{},currentState=finalPhysical?.state||{};if(!(key in originalState)||!(key in currentState)){if(OPTIONAL_CONTROLLER_FIELDS.has(key)&&!(key in originalState)&&!(key in currentState))controller.absentOptionalFields.push(key);else controller.missingFields.push(key);continue;}walk(originalState[key],currentState[key],'state.'+key);}
      for(let i=0;i<4;i++)for(const key of WHEEL_MEMORY_FIELDS)compareRequired(this.record.finalSnapshot.physical.state?.wheelStates?.[i],finalPhysical?.state?.wheelStates?.[i],key,`wheel.${i}.${key}`);
      for(const key of new Set([...Object.keys(this.record.initialSnapshot.physical.params||{}),...Object.keys(finalPhysical?.params||{})]))compareRequired(this.record.finalSnapshot.physical.params,finalPhysical?.params,key,'params.'+key);
      for(const key of BODY_CONFIGURATION_FIELDS)compareRequired(this.record.finalSnapshot.physical.body,finalPhysical?.body,key,'body.'+key);
      for(const key of WORLD_CONFIGURATION_FIELDS)compareRequired(this.record.finalSnapshot.physical.world,finalPhysical?.world,key,'world.'+key);
      if('frictionGravity' in (this.record.finalSnapshot.physical.world||{})||'frictionGravity' in (finalPhysical?.world||{}))compareRequired(this.record.finalSnapshot.physical.world,finalPhysical?.world,'frictionGravity','world.frictionGravity');
      const sourceSupport=contactSupportSet(this.record.finalSnapshot.physical.world),actualSupport=contactSupportSet(finalPhysical?.world);if(sourceSupport===null||actualSupport===null)controller.missingFields.push('world.contacts');else{controller.contactSupport={source:sourceSupport,actual:actualSupport,scope:'Canonical local body/shape support set; not transient Cannon equation multipliers or global object IDs.'};walk(sourceSupport,actualSupport,'world.contactSupport');}
    }
    const complete=status==='completed'&&completedSteps===this.record.stepCount;
    const terminalComplete=Object.values(terminal).every(c=>c.available)&&controller.missingFields.length===0,curvesComplete=this.seen.size===this.referenceSamples.size&&requiredTerminal.every(k=>this.curves[k]?.comparedSamples===this.referenceSamples.size);
    const measuredMatch=this.mismatchCount===0;
    const verdict=!this.expectAgreement?'not_applicable':!complete?'incomplete':!terminalComplete||!curvesComplete?'insufficient_evidence':measuredMatch?'matched':'diverged';
    return{schema:'roadster.reproduction-verdict',version:1,status:verdict,executionStatus:status,semantics,expectedAgreement:this.expectAgreement,sourceStatus:this.record.status,
      sourceIdentity:clone(this.record.identity),compatibility:this.compatibility,controllerOverride:this.controllerOverride?clone(this.controllerOverride):null,
      tolerances:{...REPRODUCTION_TOLERANCES},completedSteps,requestedSteps:this.record.stepCount,terminalComparedAtSameStep:sameTerminalStep,
      terminal,controller,curves:clone(this.curves),firstDivergence:this.firstDivergence,mismatchCount:this.mismatchCount,
      sampling:{referenceStoredSamples:this.referenceSamples.size,comparedSamples:this.seen.size,referenceDecimated:!!this.record.sampling?.decimated,referenceRawHz:this.record.sampling?.rawHz??null,
        coverage:'Only retained reference samples at matching fixed-step indices were compared; no interpolation and no reconstructed peaks or integrals. Controller and complete rigid-body/gas/wheel comparisons are terminal.'},
      reason:!this.expectAgreement?'This is current-model/controller recomputation. Errors describe differences from the historical reference, not an exact reproduction requirement.':!complete?'Execution did not complete the recorded segment. Partial comparisons do not establish complete reproduction.':!terminalComplete||!curvesComplete?'Required terminal values or retained reference samples are missing; agreement cannot be certified.':measuredMatch?'Completed the recorded segment; terminal state, required control state and available retained curves agree within the declared numerical tolerances.':'Execution completed but the reproduced state or retained response curves differ beyond tolerance.',
      executionReason:reason,
    };
  }
}
