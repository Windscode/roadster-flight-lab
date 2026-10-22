/* A small, predeclared matrix over the existing paired solver and result library.
 * No parameter search or synthetic animation; every attempted record is retained. */
import {validateLandingResult,validateLandingTask} from './landing-challenge.js';
import {validateHeightAlgorithm} from './bounded-height-controller.js';
import {executeWindPair,windStudyPlan,windStudyCandidate,windResponseMetrics,summarizeWindPair} from './wind-control-study.js';
import {contentLabel} from './experiment-records.js';

export const WIND_MATRIX_PROTOCOL='wind-response-matrix-1';
export const WIND_MATRIX_LIMITS=Object.freeze({seeds:3,maxPairs:6,maxMatrices:8});
const copy=value=>JSON.parse(JSON.stringify(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);

export function windMatrixPlan(source,algorithm,wind={}){
  validateLandingResult(source);
  const {profile='strong',seed=31701,candidateMode='responsive'}=wind;
  if(!Number.isInteger(seed)||seed<0||seed>4294967293)throw Error('Matrix start seed must allow three consecutive uint32 seeds');
  const candidate=windStudyCandidate(source,algorithm,candidateMode),seeds=[seed,seed+1,seed+2];
  // Calm has no physical direction, so do not inflate its sample count with duplicates.
  const directions=profile==='calm'?['lateral']:['lateral','longitudinal'];
  const cases=[];
  for(const s of seeds)for(const direction of directions){const plan=windStudyPlan(source.task,{profile,seed:s,direction});cases.push({index:cases.length,seed:s,profile,direction,task:plan.task,taskId:plan.taskId,scheduleHash:plan.scheduleHash});}
  return{protocol:WIND_MATRIX_PROTOCOL,seeds,directions,profile,candidateMode,cases,
    plannedPairs:cases.length,plannedRecords:cases.length*2,
    frozen:{sourceResultId:source.id,identity:copy(source.identity),initialStateLabel:source.initialSnapshot.stateLabel,
      collisionIdentity:source.collisionIdentity,task:copy(source.task),controlHz:source.algorithm.controlHz,supplyMode:source.supplyMode,
      baselineAlgorithm:copy(source.algorithm.algorithm),candidateAlgorithm:candidate,
      baselineAlgorithmHash:source.algorithm.hash,candidateAlgorithmHash:validateHeightAlgorithm(candidate).hash},
    scope:'Three declared consecutive seeds, each with lateral and fore-aft wind at the selected strength. Calm is run once per seed, but its identical zero-wind trajectories are deterministic repeats, not independent wind cases. Change strength explicitly for another batch with the same source and seeds. These few deterministic scenarios are a sensitivity sample, not an estimated atmospheric reliability probability.'};
}

function distribution(values){
  const sorted=values.filter(finite).sort((a,b)=>a-b);
  const quantile=p=>{if(!sorted.length)return null;const at=(sorted.length-1)*p,i=Math.floor(at);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(at-i);};
  return{n:sorted.length,min:sorted[0]??null,median:quantile(.5),p90:quantile(.9),max:sorted.at(-1)??null};
}

export function summarizeWindMatrix(matrix,records){
  const byId=new Map(records.map(r=>[r.id,r])),groups=[];
  for(const direction of matrix.plan.directions)for(const role of ['A','B']){
    const rows=matrix.rows.filter(r=>r.direction===direction),values=rows.map(row=>byId.get(role==='A'?row.baselineId:row.candidateId)).filter(Boolean),metrics=values.map(windResponseMetrics);
    const failures={};for(const r of values)if(!(r.status==='completed'&&r.summary.landingSucceeded))failures[r.reason]=(failures[r.reason]??0)+1;
    const distributions={};for(const key of ['heightRmseM','lateralRmseM','attitudeRmseDeg','windowGasKg','totalGasKg','windowLimitedS','totalAllocationLimitedS','controllerLimitedS','landingS'])distributions[key]=distribution(metrics.map(m=>m[key]));
    const planned=matrix.plan.cases.filter(c=>c.direction===direction).length,successes=metrics.filter(m=>m.landed).length;
    groups.push({profile:matrix.plan.profile,direction,role,planned,attempted:values.length,notRun:planned-values.length,
      stableLandings:successes,empiricalSuccessFraction:values.length?successes/values.length:null,
      completeWindows:metrics.filter(m=>m.windowComplete).length,failures,distributions});
  }
  const tails=[];
  for(const row of matrix.rows)for(const role of ['A','B']){const id=role==='A'?row.baselineId:row.candidateId,r=byId.get(id);if(!r)continue;const m=windResponseMetrics(r);tails.push({resultId:r.id,caseIndex:row.caseIndex,seed:row.seed,profile:row.profile,direction:row.direction,role,status:r.status,reason:r.reason,windowComplete:m.windowComplete,heightRmseM:m.heightRmseM,totalGasKg:m.totalGasKg,allocationLimitedS:m.totalAllocationLimitedS,controllerLimitedS:m.controllerLimitedS});}
  tails.sort((a,b)=>(a.status==='completed')-(b.status==='completed')||(b.heightRmseM??-1)-(a.heightRmseM??-1));
  return{status:matrix.status,plannedPairs:matrix.plan.plannedPairs,attemptedPairs:matrix.rows.length,
    qualifiedPairs:matrix.rows.filter(row=>row.summary.qualified).length,notRunPairs:matrix.plan.plannedPairs-matrix.rows.length,
    groups,tails:tails.slice(0,6),winner:null,
    metricScope:'Distribution uses every attempted full 2–6 s window, including later failed landings. Partial-window statistics remain in each record and do not enter four-second distributions. Full-task gas includes failed/cancelled shorter tasks and must be read with outcome/duration.',
    probabilityScope:'Success fraction describes only these declared deterministic cases. Three seeds are not a population reliability estimate.'};
}

export function validateWindMatrix(matrix,{recordMap=null}={}){
  if(matrix?.schema!=='roadster.wind-matrix'||matrix.version!==1||matrix.protocol!==WIND_MATRIX_PROTOCOL||typeof matrix.id!=='string'||!['completed','cancelled'].includes(matrix.status)||!Array.isArray(matrix.rows)||!matrix.plan||matrix.plan.protocol!==WIND_MATRIX_PROTOCOL)throw Error('Invalid wind matrix');
  const plan=matrix.plan;
  if(!Array.isArray(plan.cases)||plan.cases.length<1||plan.cases.length>WIND_MATRIX_LIMITS.maxPairs||plan.plannedPairs!==plan.cases.length||plan.plannedRecords!==plan.cases.length*2||matrix.rows.length>plan.cases.length||!plan.frozen?.initialStateLabel)throw Error('Wind matrix exceeds its declared bound');
  if(!['calm','crosswind','strong'].includes(plan.profile)||!Array.isArray(plan.seeds)||plan.seeds.length!==3||!Number.isInteger(plan.seeds[0])||plan.seeds[0]<0||plan.seeds[0]>4294967293||plan.seeds.some((seed,index)=>seed!==plan.seeds[0]+index)||!['responsive','edited'].includes(plan.candidateMode))throw Error('Invalid wind matrix seed/profile declaration');
  const directions=plan.profile==='calm'?['lateral']:['lateral','longitudinal'];
  if(JSON.stringify(plan.directions)!==JSON.stringify(directions)||plan.cases.length!==plan.seeds.length*directions.length)throw Error('Invalid wind matrix direction declaration');
  validateLandingTask(plan.frozen.task);
  for(const role of ['baseline','candidate'])if(validateHeightAlgorithm(plan.frozen[role+'Algorithm']).hash!==plan.frozen[role+'AlgorithmHash'])throw Error('Wind matrix controller identity mismatch');
  for(const [index,c]of plan.cases.entries()){
    const seed=plan.seeds[Math.floor(index/directions.length)],direction=directions[index%directions.length],expected=windStudyPlan(plan.frozen.task,{profile:plan.profile,seed,direction});
    if(c.index!==index||c.seed!==seed||c.profile!==plan.profile||c.direction!==direction||c.taskId!==expected.taskId||c.scheduleHash!==expected.scheduleHash||contentLabel(validateLandingTask(c.task))!==expected.taskId)throw Error('Wind matrix case differs from its frozen wind declaration');
  }
  const seen=new Set();
  for(const row of matrix.rows){
    const c=plan.cases[row.caseIndex];if(!c||seen.has(row.caseIndex)||row.seed!==c.seed||row.profile!==c.profile||row.direction!==c.direction||row.taskId!==c.taskId||row.scheduleHash!==c.scheduleHash||typeof row.baselineId!=='string'||row.candidateId!==null&&typeof row.candidateId!=='string')throw Error('Wind matrix row/plan mismatch');seen.add(row.caseIndex);validateLandingTask(c.task);
    if(recordMap){const a=recordMap.get(row.baselineId),b=row.candidateId?recordMap.get(row.candidateId):null;if(!a||row.candidateId&&!b)throw Error('Wind matrix result is missing');for(const [role,r]of [['baseline',a],['candidate',b]])if(r){validateLandingResult(r);const link=r.windComparison;if(r.initialSnapshot.stateLabel!==plan.frozen.initialStateLabel||r.taskId!==c.taskId||r.algorithm.hash!==plan.frozen[role+'AlgorithmHash']||r.algorithm.controlHz!==plan.frozen.controlHz||r.supplyMode!==plan.frozen.supplyMode||r.collisionIdentity!==plan.frozen.collisionIdentity||r.identity.modelVersion!==plan.frozen.identity.modelVersion||r.identity.modelBuildId!==plan.frozen.identity.modelBuildId||r.identity.fixedHz!==plan.frozen.identity.fixedHz||link?.matrixId!==matrix.id||link.caseIndex!==row.caseIndex||link.role!==(role==='baseline'?'A':'B')||link.seed!==c.seed||link.direction!==c.direction||link.scheduleHash!==c.scheduleHash)throw Error('Wind matrix result linkage mismatch');}if(JSON.stringify(summarizeWindPair(a,b))!==JSON.stringify(row.summary))throw Error('Wind matrix metrics differ from retained results');}
  }
  return matrix;
}

export async function executeWindMatrix({source,algorithm,wind={profile:'strong',seed:31701,candidateMode:'responsive'},signal,onProgress=()=>{},yieldEvery=120,yieldTask}={}){
  const plan=windMatrixPlan(source,algorithm,wind),id='wind-matrix-'+Date.now().toString(36)+'-'+contentLabel(plan).slice(-8),records=[],rows=[];
  for(const c of plan.cases){
    if(signal?.aborted)break;
    const result=await executeWindPair({source,algorithm,wind:{profile:c.profile,seed:c.seed,direction:c.direction,candidateMode:plan.candidateMode},signal,yieldEvery,...(yieldTask?{yieldTask}:{}),onProgress:p=>onProgress({...p,caseIndex:c.index,caseCount:plan.cases.length,seed:c.seed,profile:c.profile,direction:c.direction,candidate:c.index*2+p.candidate,candidateCount:plan.plannedRecords})});
    for(const r of [result.baseline,result.candidate].filter(Boolean)){r.windComparison.matrixId=id;r.windComparison.caseIndex=c.index;records.push(r);}
    rows.push({caseIndex:c.index,seed:c.seed,profile:c.profile,direction:c.direction,taskId:c.taskId,scheduleHash:c.scheduleHash,baselineId:result.baseline.id,candidateId:result.candidate?.id??null,summary:result.windSummary});
    onProgress({phase:'pair_finished',caseIndex:c.index,caseCount:plan.cases.length,candidate:records.length,candidateCount:plan.plannedRecords,status:result.status,seed:c.seed,profile:c.profile,direction:c.direction});
  }
  const matrix={schema:'roadster.wind-matrix',version:1,protocol:WIND_MATRIX_PROTOCOL,id,status:signal?.aborted?'cancelled':'completed',createdAt:new Date().toISOString(),plan,rows};
  validateWindMatrix(matrix,{recordMap:new Map(records.map(r=>[r.id,r]))});
  return{matrix,records,matrixSummary:summarizeWindMatrix(matrix,records)};
}
