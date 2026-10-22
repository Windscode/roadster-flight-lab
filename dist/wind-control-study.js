/* Paired wind experiments reuse the live landing runner and its full snapshots.
 * The seed generates a declared wind schedule once, never random solver forces.
 * All physics, valve limits, contacts and landing criteria remain unchanged. */
import {validateLandingTask,validateLandingResult,executeLandingTask} from './landing-challenge.js';
import {validateHeightAlgorithm} from './bounded-height-controller.js';
import {heightStudyCandidates} from './height-control-study.js';
import {compareConditions} from './research-comparison.js';
import {contentLabel} from './experiment-records.js';

export const WIND_STUDY_PROTOCOL='paired-wind-response-1';
export const WIND_STUDY_PROFILES=Object.freeze({
  calm:Object.freeze({speedMps:0,gustMps:0,label:'静风基线 / Calm'}),
  crosswind:Object.freeze({speedMps:12,gustMps:4,label:'城市横风 / Crosswind'}),
  strong:Object.freeze({speedMps:20,gustMps:10,label:'强阵风边界 / Strong gust'})
});
const copy=v=>JSON.parse(JSON.stringify(v));
const round=v=>Math.round(v*1e6)/1e6;

function randomGenerator(seed){
  let state=seed>>>0;
  return()=>{let t=state=(state+0x6D2B79F5)>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
}
export function windStudyPlan(task,{profile='crosswind',seed=31701,direction='lateral'}={}){
  const source=validateLandingTask(task),p=WIND_STUDY_PROFILES[profile];
  if(!p||!Number.isInteger(seed)||seed<0||seed>4294967295||!['lateral','longitudinal'].includes(direction))throw Error('Invalid wind profile, direction or uint32 seed');
  const next=randomGenerator(seed);
  const disturbances=[1.5,2.6,3.8,5.0].map((timeS,index)=>({timeS,
    speedMps:round(p.speedMps*(.8+.2*next())),
    directionDeg:round(((index%2?270:90)+(next()-.5)*50+(direction==='longitudinal'?90:0)+360)%360),
    gustMps:round(p.gustMps*(.7+.3*next())),gustPeriodS:round(1.1+next()*1.8)}));
  disturbances.push({timeS:7.5,speedMps:0,directionDeg:0,gustMps:0,gustPeriodS:3});
  const definition=validateLandingTask({...source,name:`Wind ${profile}${direction==='longitudinal'?' / fore-aft':''} / seed ${seed}`,disturbances});
  return{protocol:WIND_STUDY_PROTOCOL,profile,seed,direction,task:definition,taskId:contentLabel(definition),
    scheduleHash:contentLabel(disturbances),window:{startS:2,endS:6,statisticsHz:120},
    windMeaning:'Seeded piecewise wind settings; each segment uses the existing sinusoidal gust and absolute simulation clock. This is a prescribed field, not CFD or a stochastic atmosphere.',
    seedMeaning:'Mulberry32 uint32 seed selects declared speed, direction and period. Observer state/seed remains in the unchanged initial snapshot.',
    comparison:'A and B use the identical full physical initial state, wind schedule, task, supply, model and control frequency. Each graph has its own hash-bound controller state, with the same four zero slots and zero output. Only the declared height graph changes.'};
}
export function windStudyCandidate(source,algorithm,mode='responsive'){
  validateLandingResult(source);
  const value=mode==='edited'?algorithm:mode==='responsive'?heightStudyCandidates(source.algorithm.algorithm)[1].algorithm:null;
  if(!value)throw Error('Unknown wind comparison candidate');
  const a=validateHeightAlgorithm(value);
  if(a.controlHz!==source.algorithm.controlHz)throw Error('Wind A/B requires the same control frequency');
  if(a.hash===source.algorithm.hash)throw Error('A and B are identical; edit the candidate or use the declared responsive PD preset');
  return a.algorithm;
}
export function windResponseMetrics(record){
  validateLandingResult(record);const s=record.summary,w=s.windResponse??null;
  return{status:record.status,reason:record.reason,landed:record.status==='completed'&&s.landingSucceeded===true,
    windowComplete:w?.complete===true,heightRmseM:w?.complete?w.heightRmseM:null,lateralRmseM:w?.complete?w.lateralRmseM:null,
    peakLateralM:w?.complete?w.peakLateralM:null,attitudeRmseDeg:w?.complete?w.attitudeRmseDeg:null,
    peakWindMps:w?.complete?w.peakWindMps:null,windowGasKg:w?.complete?w.gasThroughputKg:null,
    windowLimitedS:w?.complete?w.allocationLimitedS:null,windowSeconds:w?.durationS??0,windowSampleCount:w?.count??0,
    partialWindow:w&&!w.complete?copy(w):null,
    settlingS:s.hoverSettlingTimeS??null,landingS:s.stableLandingAtS??null,
    totalGasKg:s.gasThroughputKg,totalAllocationLimitedS:s.saturationSeconds??0,controllerLimitedS:s.controllerLimitedSeconds??0,outputLimitedS:s.controllerOutputLimitedSeconds??0,slewLimitedS:s.controllerSlewLimitedSeconds??0,supplyMode:record.supplyMode};
}
export function summarizeWindPair(baseline,candidate){
  const a=windResponseMetrics(baseline),b=candidate?windResponseMetrics(candidate):null;
  const conditions=candidate?compareConditions(baseline,candidate):null;
  const controlled=conditions?.controlled===true;
  const qualified=controlled&&a.landed&&b.landed&&a.windowComplete&&b.windowComplete;
  const differences={};
  for(const key of ['heightRmseM','lateralRmseM','attitudeRmseDeg','windowGasKg','windowLimitedS','settlingS','landingS','totalGasKg'])differences[key]=qualified&&Number.isFinite(a[key])&&Number.isFinite(b[key])?b[key]-a[key]:null;
  return{protocol:WIND_STUDY_PROTOCOL,controlled,qualified,baselineId:baseline.id,candidateId:candidate?.id??null,
    a,b,differences,winner:null,
    interpretation:qualified?'Compare each error, stability and gas metric separately. There is no combined winner.':'Retain all failures and incomplete windows. Different conditions or failed landings do not qualify for a performance winner.',
    boundary:'A result applies only to this wind schedule, seed, initial state, supply and hardware configuration. One selected seed is not a reliability or failure probability.'};
}
export async function executeWindPair({source,algorithm,wind={profile:'crosswind',seed:31701,candidateMode:'responsive'},signal,onProgress=()=>{},yieldEvery=120,yieldTask}={}){
  validateLandingResult(source);
  const initial=source.initialControllerState;
  if(initial.states.some(v=>v!==0)||initial.lastOutput!==0||initial.lastStep!==null||initial.fault!==null)throw Error('Wind A/B requires the declared zero controller initial state; run a fresh baseline');
  const candidateAlgorithm=windStudyCandidate(source,algorithm,wind.candidateMode??'responsive');
  const plan=windStudyPlan(source.task,wind);
  const pairId='wind-pair-'+Date.now().toString(36)+'-'+contentLabel({plan,source:source.id,candidate:candidateAlgorithm}).slice(-8);
  const records=[];
  for(const [index,graph]of [source.algorithm.algorithm,candidateAlgorithm].entries()){
    if(signal?.aborted&&records.length)break;
    const record=await executeLandingTask({task:plan.task,algorithm:graph,
      initialSnapshot:source.initialSnapshot,initialControllerState:index===0?source.initialControllerState:null,
      signal,yieldEvery,...(yieldTask?{yieldTask}:{}),onProgress:p=>onProgress({...p,candidate:index+1,candidateCount:2})});
    record.windComparison={protocol:WIND_STUDY_PROTOCOL,pairId,role:index?'B':'A',sourceResultId:source.id,
      profile:plan.profile,seed:plan.seed,direction:plan.direction,scheduleHash:plan.scheduleHash,window:plan.window,
      candidateMode:wind.candidateMode??'responsive',windMeaning:plan.windMeaning,seedMeaning:plan.seedMeaning};
    records.push(record);
  }
  const [baseline,candidate=null]=records;
  return{status:signal?.aborted?'cancelled':'completed',baseline,candidate,
    windPlan:plan,windSummary:summarizeWindPair(baseline,candidate)};
}
