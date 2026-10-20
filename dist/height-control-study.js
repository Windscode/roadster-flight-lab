/* A bounded, auditable experiment plan for the existing height AST layer.
 * Every candidate redecides against one frozen physical snapshot. No score,
 * state injection, controller bypass or omission of failed runs is used. */
import {HEIGHT_TEMPLATES,validateHeightAlgorithm} from './bounded-height-controller.js';
import {executeLandingTask,reexecuteLandingTask,validateLandingResult,validateLandingTask,HEIGHT_RESPONSE_CRITERIA} from './landing-challenge.js';
import {contentLabel,currentExperimentIdentity} from './experiment-records.js';
import {compareConditions} from './research-comparison.js';
export const HEIGHT_STUDY_PROTOCOL='height-pareto-study-1';
export const HEIGHT_STUDY_LIMITS=Object.freeze({maxCandidates:4,defaultCandidates:3,maxStudies:8});
const copy=v=>JSON.parse(JSON.stringify(v));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function pdParameters(algorithm){
  const a=validateHeightAlgorithm(algorithm).algorithm,r=a.root;
  if(r.op!=='sub'||r.args[0]?.op!=='mul'||r.args[1]?.op!=='mul'||r.args[0].args[0]?.op!=='const'||r.args[1].args[0]?.op!=='const'||r.args[0].args[1]?.op!=='input'||r.args[0].args[1].name!=='error'||r.args[1].args[1]?.op!=='input'||r.args[1].args[1].name!=='verticalSpeed')throw Error('This bounded scan declares two PD gains and output slew only. Use original/edited same-task comparison for a different AST composition; the graph is not rewritten automatically.');
  return{kp:r.args[0].args[0].value,kd:r.args[1].args[0].value,slew:a.slewLimit};
}
export function heightStudyCandidates(algorithm=HEIGHT_TEMPLATES.pd){
  const base=validateHeightAlgorithm(algorithm).algorithm,p=pdParameters(base);
  const tuples=[[p.kp,p.kd,p.slew],[p.kp*1.625,p.kd*(3.1/3.6),p.slew],[p.kp*8.125,p.kd*(7/3.6),Math.min(30,p.slew*(30/18))]];
  return tuples.map(([kp,kd,slew],index)=>{const a=copy(base);a.root.args[0].args[0].value=kp;a.root.args[1].args[0].value=kd;a.slewLimit=slew;if(index)a.name=(base.name.slice(0,42)+` / P${kp.toFixed(2)} D${kd.toFixed(2)} S${slew.toFixed(1)}`).slice(0,80);const definition=validateHeightAlgorithm(a);return{id:'candidate-'+index,algorithm:definition.algorithm,algorithmHash:definition.hash,parameters:{kp,kd,slewLimitMps3:slew,outputLimitMps2:a.outputLimit,controlHz:a.controlHz},declaration:index===0?'Unchanged edited baseline':'Only declared PD constants and slew limit differ'};});
}
export function heldOutLandingTask(task){
  const t=validateLandingTask(task);return{...t,name:(t.name.slice(0,59)+' / held-out wind').slice(0,80),disturbances:[{timeS:1.75,speedMps:7,directionDeg:45,gustMps:2,gustPeriodS:1.7},{timeS:3.4,speedMps:9,directionDeg:225,gustMps:3,gustPeriodS:2.3},{timeS:7.1,speedMps:1,directionDeg:135,gustMps:.5,gustPeriodS:2.9}]};
}
export function heightStudyMetrics(result){
  validateLandingResult(result);const s=result.summary;
  return{valid:result.status==='completed'&&s.landingSucceeded===true,reason:result.reason,status:result.status,settlingTimeS:s.hoverSettlingTimeS??null,overshootM:s.holdOvershootM??null,gasThroughputKg:s.gasThroughputKg,gasWindowKg:s.takeoffHoldDurationS>=6-1e-9?s.takeoffHoldGasKg:null,gasWindowSeconds:s.takeoffHoldDurationS??null,stableLandingAtS:s.stableLandingAtS,controllerLimitedSeconds:s.controllerLimitedSeconds,outputLimitedSeconds:s.controllerOutputLimitedSeconds??null,slewLimitedSeconds:s.controllerSlewLimitedSeconds??null,actuatorLimitedSeconds:s.saturationSeconds,peakMassFlowKgS:s.peakMassFlowKgS??null,heightRmseM:s.heightRmseM,supplyMode:result.supplyMode};
}
// Only completed, collision-free and sustained-landed runs can enter the front.
// A missing settling/overshoot metric is not a zero or an automatic victory.
export function heightParetoFront(rows){
  const eligible=rows.filter(r=>r.metrics.valid&&['settlingTimeS','overshootM','gasThroughputKg'].every(k=>finite(r.metrics[k])));
  const dominates=(a,b)=>['settlingTimeS','overshootM','gasThroughputKg'].every(k=>a.metrics[k]<=b.metrics[k]+1e-9)&&['settlingTimeS','overshootM','gasThroughputKg'].some(k=>a.metrics[k]<b.metrics[k]-1e-9);
  return eligible.filter(b=>!eligible.some(a=>a!==b&&dominates(a,b))).map(r=>r.id);
}
export function describeHeightTradeoff(baseline,candidate){
  const conditions=compareConditions(baseline,candidate),a=heightStudyMetrics(baseline),b=heightStudyMetrics(candidate);
  const differences={};for(const key of ['settlingTimeS','overshootM','gasThroughputKg','gasWindowKg','stableLandingAtS','controllerLimitedSeconds','outputLimitedSeconds','actuatorLimitedSeconds','heightRmseM'])differences[key]=finite(a[key])&&finite(b[key])?b[key]-a[key]:null;
  return{controlled:conditions.controlled,bothCompleted:a.valid&&b.valid,differences,meaning:'Negative settling/gas/error differences favour the candidate only for this fixed task. Gas through completion and gas within the identical 0–6 s window have different endpoints. AST output/slew limiting is distinct from physical actuator allocation saturation.',piInterpretation:'Integral state can accumulate while takeoff/valves and bounded acceleration lag; low-pass velocity adds phase lag. For this short ramp/hold/descent task, these may prolong settling and spend more time supporting weight. A changed curve alone is not an improvement. Inspect retained integral/filter states, target, observation and bounded/achieved response; no universal PI verdict is implied.'};
}
export function validateHeightStudy(study,{recordMap=null}={}){
  if(study?.schema!=='roadster.height-study'||study.version!==1||study.protocol!==HEIGHT_STUDY_PROTOCOL||typeof study.id!=='string'||!['completed','cancelled'].includes(study.status)||!Array.isArray(study.rows)||study.rows.length>HEIGHT_STUDY_LIMITS.maxCandidates||!Array.isArray(study.front)||!study.frozen?.initialStateLabel||!study.frozen?.identity||!Array.isArray(study.candidates)||study.candidates.length<1||study.candidates.length>HEIGHT_STUDY_LIMITS.maxCandidates)throw Error('Invalid bounded height study');
  validateLandingTask(study.frozen.task);validateLandingTask(study.validationTask);
  const candidates=new Map(study.candidates.map(c=>{const a=validateHeightAlgorithm(c.algorithm);if(a.hash!==c.algorithmHash||a.controlHz!==study.frozen.controlHz)throw Error('Study algorithm identity/frequency mismatch');return[c.id,c];}));
  if(candidates.size!==study.candidates.length)throw Error('Duplicate study candidate');
  const seen=new Set();for(const row of study.rows){if(!candidates.has(row.id)||seen.has(row.id)||typeof row.resultId!=='string'||row.algorithmHash!==candidates.get(row.id).algorithmHash||!row.metrics||!['completed','failed','cancelled','timeout'].includes(row.metrics.status))throw Error('Invalid study row');seen.add(row.id);if(recordMap){const r=recordMap.get(row.resultId);if(!r||r.algorithm.hash!==row.algorithmHash||r.initialSnapshot.stateLabel!==study.frozen.initialStateLabel||r.taskId!==study.frozen.taskId)throw Error('Study result linkage mismatch');validateLandingResult(r);if(JSON.stringify(heightStudyMetrics(r))!==JSON.stringify(row.metrics))throw Error('Study metrics do not match retained 120 Hz summary');}}
  if(study.front.some(id=>!seen.has(id))||JSON.stringify(study.front)!==JSON.stringify(heightParetoFront(study.rows)))throw Error('Pareto classification mismatch');
  return study;
}
export async function executeHeightStudy({source,algorithm=source?.algorithm?.algorithm??HEIGHT_TEMPLATES.pd,candidates=null,signal,onProgress=()=>{},yieldEvery=120,yieldTask}={}){
  validateLandingResult(source);const initial=source.initialControllerState;if(initial.states.some(v=>v!==0)||initial.lastOutput!==0||initial.lastStep!==null||initial.fault!==null)throw Error('Bounded scan requires the declared zero initial controller state. Run a fresh baseline first; archived state is not silently changed.');const plan=candidates??heightStudyCandidates(algorithm);if(!Array.isArray(plan)||plan.length<1||plan.length>HEIGHT_STUDY_LIMITS.maxCandidates)throw Error('Height study requires 1–4 declared candidates');const hz=source.algorithm.controlHz;
  for(const c of plan){const a=validateHeightAlgorithm(c.algorithm);if(a.hash!==c.algorithmHash||a.controlHz!==hz)throw Error('All study candidates must use the frozen control frequency');}
  const records=[],rows=[],frozen={task:copy(source.task),taskId:source.taskId,initialStateLabel:source.initialSnapshot.stateLabel,sourceResultId:source.id,identity:copy(source.identity),collisionIdentity:source.collisionIdentity,controlHz:hz,criteria:HEIGHT_RESPONSE_CRITERIA,changed:'Declared algorithm content/hash only; complete physical initial snapshot, initial controller state, wind schedule, model and control frequency are held fixed.'};
  for(let index=0;index<plan.length;index++){
    if(signal?.aborted)break;const c=plan[index];const result=await reexecuteLandingTask(source,{algorithm:c.algorithm,signal,yieldEvery,...(yieldTask?{yieldTask}:{}),onProgress:p=>onProgress({...p,candidate:index+1,candidateCount:plan.length,parameters:c.parameters})});result.studyLink={protocol:HEIGHT_STUDY_PROTOCOL,phase:'tuning',candidateId:c.id,sourceResultId:source.id};records.push(result);rows.push({id:c.id,resultId:result.id,algorithmHash:c.algorithmHash,parameters:copy(c.parameters??{}),metrics:heightStudyMetrics(result)});onProgress({candidate:index+1,candidateCount:plan.length,phase:'candidate_finished',step:result.stepCount,timeS:result.durationS,status:result.status});
  }
  const study={schema:'roadster.height-study',version:1,protocol:HEIGHT_STUDY_PROTOCOL,id:'height-study-'+Date.now().toString(36)+'-'+contentLabel({frozen,hashes:plan.map(c=>c.algorithmHash)}).slice(-8),status:signal?.aborted?'cancelled':'completed',frozen,candidates:copy(plan),rows,front:heightParetoFront(rows),validationTask:heldOutLandingTask(source.task),validationPolicy:'Predeclared held-out wind schedule, never included in tuning Pareto ranking. Validate a selected candidate explicitly; a validation failure remains a failure.',objectiveOrder:['Valid collision-free stable landing first','Non-dominated settling time, overshoot, complete-task gas; no weighted score'],createdAt:new Date().toISOString()};validateHeightStudy(study,{recordMap:new Map(records.map(r=>[r.id,r]))});return{study,records};
}
export async function validateHeightCandidate({source,signal,onProgress,yieldEvery=120,yieldTask}={}){
  validateLandingResult(source);const task=heldOutLandingTask(source.task),result=await executeLandingTask({task,algorithm:source.algorithm.algorithm,initialSnapshot:source.initialSnapshot,initialControllerState:source.initialControllerState,signal,onProgress,yieldEvery,...(yieldTask?{yieldTask}:{})});result.studyLink={protocol:HEIGHT_STUDY_PROTOCOL,phase:'held-out-validation',sourceResultId:source.id,tuningTaskId:source.taskId};return result;
}
