import {canonicalJSON,contentLabel} from './experiment-records.js';
const clone=v=>v===undefined?null:JSON.parse(JSON.stringify(v));
/** An outcome comparison is causal only when the controlled conditions match.
 * Algorithm differences are declared, never silently folded into a score. */
export function comparisonConditions(record){
  const identity=record.identity||{modelVersion:record.modelVersion,modelBuildId:record.modelBuildId};
  const snapshot=record.initialSnapshot,physical=snapshot?.physical,body=physical?.body,state=physical?.state;
  return{initialState:snapshot?.stateLabel?{contentLabel:snapshot.stateLabel,world:physical?.worldType??record.context,collisionIdentity:physical?.geometrySignature??null,simTime:snapshot.initialSimTime??null,position:clone(body?.position),velocity:clone(body?.velocity),quaternion:clone(body?.quaternion),angularVelocity:clone(body?.angularVelocity),controllerInitialState:record.initialControllerState?clone({states:record.initialControllerState.states,lastOutput:record.initialControllerState.lastOutput,lastStep:record.initialControllerState.lastStep,fault:record.initialControllerState.fault}):null}:null,model:clone(identity),wind:clone(record.task?.disturbances??record.actualInheritedWind??record.wind),gas:{mode:record.task?.supplyMode??record.supplyMode??physical?.params?.supplyMode??null,initialPressureBar:record.task?.initialPressureBar??physical?.params?.initialPressureBar??null,remainingKg:clone(state?.gasMass),temperatureK:clone(state?.gasTemperature)},task:record.task?{contentLabel:contentLabel(record.task),definition:clone(record.task)}:record.program?{contentLabel:contentLabel(record.program),definition:clone(record.program)}:null,algorithm:record.algorithm?{hash:record.algorithm.hash,name:record.algorithm.algorithm?.name,interface:record.algorithm.interfaceVersion,controlHz:record.algorithm.controlHz}:clone(record.controller??null)};
}
export function compareConditions(a,b){
  const A=comparisonConditions(a),B=comparisonConditions(b),differences=Object.keys(A).filter(key=>canonicalJSON(A[key])!==canonicalJSON(B[key])),missing=['initialState','task'].filter(key=>A[key]===null||B[key]===null),controlled=!missing.length&&!differences.some(key=>key!=='algorithm');
  return{controlled,interpretation:controlled?'Controlled conditions; declared algorithm/controller differences only. Success, collision and landing verdict precede time/gas comparison.':'Descriptive comparison only; conditions differ or lack provenance. No better/worse verdict.',differences,missing,conditions:{A,B}};
}
