/** A bounded experiment over the existing pose controller and observation path.
 * No solver, actuator model or pseudo-random source is introduced here. */
export const ROBUSTNESS_VERSION=1;
export const ROBUSTNESS_SEEDS=Object.freeze([37,101,271,509,997]);
export const ROBUSTNESS_DEFAULTS=Object.freeze({candidateResponse:2.5,delayMs:120,windMps:6,nozzleScale:1});
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const clone=value=>structuredClone(value);

export function normalizeRobustnessCase(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','group','seed','delayMs','windMps','nozzleScale'].includes(k)))throw Error('鲁棒试验条件格式无效');
 if(value.version!==ROBUSTNESS_VERSION||!['A','B'].includes(value.group)||!Number.isInteger(value.seed)||!finite(value.seed,0,4294967295)||!finite(value.delayMs,0,250)||!finite(value.windMps,0,15)||!finite(value.nozzleScale,.5,1))throw Error('鲁棒试验条件超出支持范围');
 return{version:ROBUSTNESS_VERSION,group:value.group,seed:value.seed,delayMs:value.delayMs,windMps:value.windMps,nozzleScale:value.nozzleScale};
}

export function robustnessEnvironment(value){
 const c=normalizeRobustnessCase(value);
 return{durationS:12,sampleHz:10,
  observation:{enabled:true,delayMs:c.delayMs,seed:c.seed,positionNoiseM:.02,velocityNoiseMps:.04,attitudeNoiseDeg:.35,angularRateNoiseRadS:.02},
  wind:{speedMps:c.windMps,directionDeg:65,gustMps:c.windMps/3,gustPeriodS:5},
  nozzleFault:c.nozzleScale<1?{id:'lift-FR',scale:c.nozzleScale}:null,
  controllerMode:'research-pose-hold',reference:'Initial position and level quaternion; no driver input. G uses a separate levelling controller.',
  noiseModel:'Independent bounded uniform observation noise at every physics step; deterministic Mulberry32. The same seed pairs A and B; wind phase starts at simulation time zero.'};
}

export function robustnessCaseLabel(value){const c=normalizeRobustnessCase(value);return`${c.group} / 种子 ${c.seed} / 延迟 ${c.delayMs} ms`;}

export function buildRobustnessJobs(request,options={}){
 if(request.kind!=='attitude')throw Error('多种子对照仅用于空中稳姿恢复');
 const o={...ROBUSTNESS_DEFAULTS,...options};
 if(!finite(o.candidateResponse,1,7)||!finite(o.delayMs,10,250)||!finite(o.windMps,0,15)||!finite(o.nozzleScale,.5,1))throw Error('鲁棒对照参数超出允许范围');
 if(Math.abs(o.candidateResponse-request.params.attitudeResponse)<1e-10)throw Error('A 与 B 的姿态响应相同，请修改 B 后再运行');
 const jobs=[];
 for(const delayMs of [0,o.delayMs])for(const seed of ROBUSTNESS_SEEDS)for(const group of ['A','B']){
  const next=clone(request);next.stabilization=true;
  if(group==='B')next.params.attitudeResponse=o.candidateResponse;
  next.robustness=normalizeRobustnessCase({version:ROBUSTNESS_VERSION,group,seed,delayMs,windMps:o.windMps,nozzleScale:o.nozzleScale});
  jobs.push({label:robustnessCaseLabel(next.robustness),request:next,factor:{kind:'pose-controller-robustness',...next.robustness}});
 }
 return jobs;
}

const stable=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
function pairConditions(report){
 const request=clone(report.request);delete request.params.attitudeResponse;delete request.robustness.group;
 return JSON.stringify(stable({model:report.modelVersion,build:report.modelBuildId,protocol:report.protocolVersion,request}));
}
const mean=values=>values.length?values.reduce((sum,v)=>sum+v,0)/values.length:null;
const maximum=values=>values.length?Math.max(...values):null;

/** Summarize only returned solver reports. Missing/cancelled cases stay missing,
 * and pair deltas require identical declared conditions except attitude gain. */
export function summarizeRobustness(entries,{expectedCases=20,executionStatus='unknown'}={}){
 const runs=entries.filter(e=>e.report?.request?.robustness).map(entry=>{
  const r=entry.report,c=normalizeRobustnessCase(r.request.robustness),m=r.metrics;
  return{id:entry.id,runId:r.runId,group:c.group,seed:c.seed,delayMs:c.delayMs,response:r.appliedParams.attitudeResponse,
   success:r.outcome==='recovered',outcome:r.outcome,recoverySeconds:m.sustainedFinalRecoverySeconds??(r.outcome==='recovered'?m.recoveredAtSeconds:null),heightRmseM:m.heightRmseM,
   attitudeRmseDeg:m.attitudeRmseDeg??null,maximumHeightLossM:m.maximumHeightLossM??Math.max(0,r.request.heightM-m.minHeightM),
   saturationSeconds:m.nozzleSaturationSeconds,gasThroughputKg:m.throughputKg,onboardGasKg:m.gasUsedKg,externalGasKg:m.externalSupplyKg,
   energyKWh:m.energyUsedKWh??null,positionRmseM:m.positionRmseM??null,conditions:pairConditions(r)};
 });
 const pairs=[];
 for(const a of runs.filter(r=>r.group==='A')){
  const matches=runs.filter(b=>b.group==='B'&&b.seed===a.seed&&b.delayMs===a.delayMs&&b.conditions===a.conditions);
  if(matches.length===1&&runs.filter(other=>other.group==='A'&&other.conditions===a.conditions).length===1){const b=matches[0];pairs.push({seed:a.seed,delayMs:a.delayMs,aId:a.id,bId:b.id,bothSucceeded:a.success&&b.success,successA:a.success,successB:b.success,deltaHeightRmseM:b.heightRmseM-a.heightRmseM,deltaGasKg:b.gasThroughputKg-a.gasThroughputKg});}
 }
 const groups=[];
 for(const delayMs of [...new Set(runs.map(r=>r.delayMs))].sort((a,b)=>a-b))for(const group of ['A','B']){
  const cases=runs.filter(r=>r.delayMs===delayMs&&r.group===group);if(!cases.length)continue;
  groups.push({group,delayMs,completed:cases.length,successes:cases.filter(r=>r.success).length,successFraction:cases.filter(r=>r.success).length/cases.length,
   meanHeightRmseM:mean(cases.map(r=>r.heightRmseM).filter(Number.isFinite)),worstHeightLossM:maximum(cases.map(r=>r.maximumHeightLossM).filter(Number.isFinite)),
   meanGasKg:mean(cases.map(r=>r.gasThroughputKg).filter(Number.isFinite)),worstSaturationSeconds:maximum(cases.map(r=>r.saturationSeconds).filter(Number.isFinite))});
 }
 return{schema:'roadster.pose-robustness-summary',version:1,executionStatus,expectedCases,returnedCases:runs.length,complete:executionStatus==='completed'&&runs.length===expectedCases,
  pairedCases:pairs.length,groups,pairs,runs:runs.map(({conditions,...run})=>run),
  interpretation:'Success means the declared pose/position/rate tolerances are maintained at the end of the 12-second window without ground or hull contact. Execution completion and physical success differ. All cases and failed outcomes remain visible. Five selected seeds do not establish a population failure rate or confidence interval.'};
}
