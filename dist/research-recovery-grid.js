/** Discrete G-levelling trials over the installed vehicle solver.
 * Heights are sampled initial conditions, never an interpolated safety limit. */
export const RECOVERY_GRID_VERSION=1;
export const RECOVERY_GRID_PROTOCOL='g-recovery-grid-1';
export const RECOVERY_GRID_ROLLS=Object.freeze([30,60,90,120]);
export const RECOVERY_GRID_HEIGHTS=Object.freeze([3,6,12,24]);
export const RECOVERY_GRID_DEFAULTS=Object.freeze({windMps:6,nozzleScale:1});
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

export function normalizeRecoveryGridOptions(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['windMps','nozzleScale'].includes(key)))throw Error('恢复网格设置格式无效');
 const options={...RECOVERY_GRID_DEFAULTS,...value};
 if(!finite(options.windMps,0,12)||![1,.75,.5].includes(options.nozzleScale))throw Error('恢复网格仅支持0–12 m/s侧风和100% / 75% / 50%喷口能力');
 return options;
}
export function normalizeRecoveryGridCase(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['version','rollDeg','heightM','windMps','nozzleScale'].includes(key)))throw Error('恢复网格案例格式无效');
 if(value.version!==RECOVERY_GRID_VERSION||!RECOVERY_GRID_ROLLS.includes(value.rollDeg)||!RECOVERY_GRID_HEIGHTS.includes(value.heightM)||!finite(value.windMps,0,12)||![1,.75,.5].includes(value.nozzleScale))throw Error('恢复网格案例超出已声明的离散工况');
 return{version:RECOVERY_GRID_VERSION,rollDeg:value.rollDeg,heightM:value.heightM,windMps:value.windMps,nozzleScale:value.nozzleScale};
}
export function recoveryGridCaseLabel(value){const c=normalizeRecoveryGridCase(value);return`滚转 ${c.rollDeg}° / 高度 ${c.heightM} m`;}
export function buildRecoveryGridJobs(request,options={}){
 if(request.kind!=='attitude'||request.robustness)throw Error('G恢复高度网格仅适用于独立空中稳姿试验');
 const conditions=normalizeRecoveryGridOptions(options),jobs=[];
 for(const heightM of RECOVERY_GRID_HEIGHTS)for(const rollDeg of RECOVERY_GRID_ROLLS){
  const next=structuredClone(request);delete next.durationS;
  next.initialRollDeg=rollDeg;next.heightM=heightM;next.stabilization=true;
  next.recoveryGrid=normalizeRecoveryGridCase({version:RECOVERY_GRID_VERSION,rollDeg,heightM,...conditions});
  jobs.push({label:recoveryGridCaseLabel(next.recoveryGrid),request:next,factor:{kind:'g-recovery-grid',...next.recoveryGrid}});
 }
 return jobs;
}
export function recoveryGridEnvironment(value){
 const c=normalizeRecoveryGridCase(value);
 return{protocolVersion:RECOVERY_GRID_PROTOCOL,durationS:12,sampleHz:10,controllerMode:'g-level',
  initial:{rollDeg:c.rollDeg,pitchDeg:-10,headingDeg:0,heightM:c.heightM,angularVelocityRadS:{x:.2,y:0,z:.3}},
  wind:{speedMps:c.windMps,directionDeg:90,gustMps:0,gustPeriodS:5},
  nozzleFault:{id:'lift-FR',scale:c.nozzleScale},
  observation:'Exact simulation feedback; no added sensor noise or delay.',
  reference:'Ordinary G levelling captures the starting height and heading; no setPoseTarget, added position lock or modified body state during integration.'};
}
export function recoveryGridOutcome(report){
 if(!report)return'not_returned';
 if(report.metrics?.groundTouchSeconds!==null&&report.metrics?.groundTouchSeconds!==undefined||report.metrics?.hullContactSamples>0||report.outcome==='contact')return'contact';
 return report.outcome==='recovered'?'recovered':'not_recovered_in_window';
}
/** A full grid is a single common configuration over all 16 unique axes. */
export function validateRecoveryGridJobs(jobs){
 if(!Array.isArray(jobs)||jobs.length!==16)throw Error('完整恢复网格必须包含16个不同的滚转与高度组合');
 const cells=new Set();let common=null;
 for(const job of jobs){const request=job?.request,c=normalizeRecoveryGridCase(request?.recoveryGrid);
  if(request.kind!=='attitude'||request.stabilization!==true||request.initialRollDeg!==c.rollDeg||request.heightM!==c.heightM)throw Error('恢复网格任务与初态声明不一致');
  const key=c.rollDeg+'/'+c.heightM;if(cells.has(key))throw Error('恢复网格不能包含重复的滚转与高度组合');cells.add(key);
  const baseline=structuredClone(request);delete baseline.initialRollDeg;delete baseline.heightM;delete baseline.recoveryGrid.rollDeg;delete baseline.recoveryGrid.heightM;
  const signature=canonical(baseline);if(common!==null&&signature!==common)throw Error('同一恢复网格必须使用相同的车辆参数、侧风和喷口工况');common=signature;
 }
 return true;
}
/** Match complete requests and source identities before assigning a cell.
 * Duplicate, mismatched or absent results never become successful samples. */
export function summarizeRecoveryGrid(entries,{jobs=[],executionStatus='unknown',identity=null}={}){
 if(jobs.length)validateRecoveryGridJobs(jobs);
 const cases=jobs.map(job=>{
  const c=normalizeRecoveryGridCase(job.request.recoveryGrid),key=canonical(job.request);
  const matches=entries.filter(entry=>entry.report?.request?.recoveryGrid&&canonical(entry.report.request)===key&&(!identity||entry.report.modelVersion===identity.modelVersion&&entry.report.modelBuildId===identity.modelBuildId&&entry.report.protocolVersion===identity.protocolVersion));
  const entry=matches.length===1?matches[0]:null,r=entry?.report,m=r?.metrics;
  return{rollDeg:c.rollDeg,heightM:c.heightM,windMps:c.windMps,nozzleScale:c.nozzleScale,id:entry?.id??null,runId:r?.runId??null,outcome:recoveryGridOutcome(r),
   recoverySeconds:r?.outcome==='recovered'?m.sustainedFinalRecoverySeconds??m.recoveredAtSeconds:null,
   minimumHeightM:m?.minHeightM??null,maximumHeightLossM:m?.maximumHeightLossM??null,groundTouchSeconds:m?.groundTouchSeconds??null,rigidBodyContactSamples:m?.hullContactSamples??null,
   gasThroughputKg:m?.throughputKg??null,externalGasKg:m?.externalSupplyKg??null,onboardGasKg:m?.gasUsedKg??null,energyKWh:m?.energyUsedKWh??null,saturationSeconds:m?.nozzleSaturationSeconds??null,
   ambiguity:matches.length>1};
 });
 const lowestSampledSuccess=RECOVERY_GRID_ROLLS.map(rollDeg=>{const candidates=cases.filter(c=>c.rollDeg===rollDeg&&c.outcome==='recovered');return{rollDeg,heightM:candidates.length?Math.min(...candidates.map(c=>c.heightM)):null,returned:cases.filter(c=>c.rollDeg===rollDeg&&c.outcome!=='not_returned').length};});
 const returnedCases=cases.filter(c=>c.outcome!=='not_returned').length;
 return{schema:'roadster.g-recovery-grid-summary',version:1,protocolVersion:RECOVERY_GRID_PROTOCOL,executionStatus,expectedCases:jobs.length,returnedCases,
  complete:executionStatus==='completed'&&returnedCases===jobs.length&&jobs.length===16,
  counts:Object.fromEntries(['recovered','contact','not_recovered_in_window','not_returned'].map(outcome=>[outcome,cases.filter(c=>c.outcome===outcome).length])),
  lowestSampledSuccess,cases,limitation:'Only the lowest successful sampled starting height is reported. No interpolation, continuous minimum safe height, unsampled guarantee or real-vehicle prediction.'};
}
