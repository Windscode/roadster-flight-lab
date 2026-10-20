import {MODEL_VERSION} from './vehicle-models.js';
import {MODEL_BUILD_ID} from './model-build.js';
import {normalizeResearchRequest,savedResearchRequest,RESEARCH_PARAMETERS,PROTOCOL_VERSION} from './research-protocol.js';
import {buildRobustnessJobs,robustnessCaseLabel} from './research-robustness.js';
export const SWEEP_KEYS={steer:['tireMu','cornerStiffnessFront','cornerStiffnessRear','dryMass'],brake:['tireMu','dryMass'],launch:['tireMu','dryMass'],attitude:['dryMass','liftNozzleMax','valveRiseTime'],rise:['climbRateMps','dryMass','liftNozzleMax','valveRiseTime'],hover:['tankLitres','initialPressureBar','nozzleVelocityEfficiency','dryMass','liftNozzleMax'],roll:['tankLitres','initialPressureBar','dryMass','liftNozzleMax','valveRiseTime']};
export const PAIRS={
 supplyMode:{label:'有限储气 / 恒压试验台',key:'supplyMode',values:['finite','bench'],labels:['有限储气','恒压外供气']},
 gasModel:{label:'绝热 / 等温罐温模型',key:'gasModel',values:['adiabatic','isothermal'],labels:['绝热放空','等温对照']},
 nozzleModel:{label:'温压排速 / 固定650 m/s',key:'nozzleModel',values:['isentropic','constant'],labels:['温压排速','固定650 m/s']},
 steeringAssist:{label:'道路限舵辅助 关 / 开',key:'steeringAssist',values:[false,true],labels:['限舵关闭','限舵开启']},
 tractionAssist:{label:'轮速反馈 TCS 关 / 开',key:'tractionAssist',values:[false,true],labels:['TCS关闭','TCS开启']},
 absEnabled:{label:'轮速反馈 ABS 关 / 开',key:'absEnabled',values:[false,true],labels:['ABS关闭','ABS开启']},
 wingMode:{label:'固定收起翼 / 主动翼',key:'wingMode',values:['fixed','active'],labels:['固定翼收起','主动气动翼']},
 stabilization:{label:'G空中稳姿 关 / 开',key:'stabilization',values:[false,true],labels:['G关闭','G开启'],input:true},
 tireMu:{label:'摩擦系数 0.65 / 1.25',key:'tireMu',values:[.65,1.25],labels:['μ = 0.65','μ = 1.25']},
};
export const PAIR_KEYS={steer:['steeringAssist','tractionAssist'],brake:['absEnabled','wingMode','tireMu'],launch:['tractionAssist','wingMode'],attitude:['stabilization','supplyMode'],rise:['supplyMode','gasModel','nozzleModel'],hover:['supplyMode','gasModel','nozzleModel'],roll:['supplyMode','gasModel','nozzleModel']};
export function researchConditionLabel(request){
 const p=request.params||{};if(!['steer','brake','launch'].includes(request.kind))return'';
 return[({dry:'干地',wet:'湿地',split:'左右分离附着'})[p.roadSurface]||p.roadSurface,`ABS${p.absEnabled?'开启':'关闭'}`,`TCS${p.tractionAssist?'开启':'关闭'}`].join(' · ');
}
const namedJob=(label,request,extra={})=>({label:label+(researchConditionLabel(request)?' · '+researchConditionLabel(request):''),request,...extra});
export function buildStudyRequests(base,{mode='single',pairKey,sweepKey,from,to,count=3,robustness}={}){
 const request=normalizeResearchRequest(base);
 if(mode==='robustness')return buildRobustnessJobs(request,robustness).map(job=>({...job,request:normalizeResearchRequest(job.request)}));
 if(mode==='single')return[namedJob('单次实验',request)];
 if(mode==='pair'){
  if(!PAIR_KEYS[request.kind].includes(pairKey))throw Error('该对照因素不适用于本试验');
  const p=PAIRS[pairKey];return p.values.map((value,i)=>{const next=structuredClone(request);if(p.input)next[p.key]=value;else next.params[p.key]=value;if(pairKey==='steeringAssist')next.steeringProtocol='driver';if(pairKey==='wingMode')next.params.wingDeployment=0;return namedJob((i?'B / ':'A / ')+p.labels[i],normalizeResearchRequest(next));});
 }
 if(mode==='sweep'){
  if(!SWEEP_KEYS[request.kind].includes(sweepKey))throw Error('该扫描参数不适用于本试验');
  const p=RESEARCH_PARAMETERS[sweepKey];if(![3,5,7].includes(count)||!Number.isFinite(from)||!Number.isFinite(to)||from>=to||from<p.min||to>p.max)throw Error(`扫描需3/5/7点，起点小于终点，并在${p.min}–${p.max}${p.unit}范围内`);
  return Array.from({length:count},(_,i)=>{const value=+(from+(to-from)*i/(count-1)).toPrecision(10),next=structuredClone(request);next.params[sweepKey]=value;return namedJob(p.label+' = '+value+' '+p.unit,normalizeResearchRequest(next),{factor:{key:sweepKey,value}});});
 }
 throw Error('未知运行方式');
}
export function studyArchive(entries,note=''){
 return{schemaVersion:1,application:'Roadster Research Study',modelVersion:entries[0]?.report.modelVersion??MODEL_VERSION,modelBuildId:entries[0]?.report.modelBuildId??MODEL_BUILD_ID,protocolVersion:entries[0]?.report.protocolVersion??PROTOCOL_VERSION,exporterIdentity:{modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,protocolVersion:PROTOCOL_VERSION},createdAt:new Date().toISOString(),note,requests:entries.map(e=>({label:e.label,request:savedResearchRequest(e.report.request,{protocolVersion:e.report.protocolVersion,durationS:e.report.input?.duration}),note:e.note||'',factor:e.factor||null})),results:entries.map(e=>({label:e.label,note:e.note||'',report:e.report}))};
}
export function importStudy(value){
 if(value?.schemaVersion!==1||value.application!=='Roadster Research Study'||!Array.isArray(value.requests)||value.requests.length<1||value.requests.length>20||value.requests.length>12&&!value.requests.every(e=>e?.request?.robustness))throw Error('需要本工作区导出的1–12条实验方案，或最多20条鲁棒对照方案');
 return value.requests.map((e,i)=>{const report=value.results?.[i]?.report,request=normalizeResearchRequest(savedResearchRequest(e.request,{protocolVersion:report?.protocolVersion??value.protocolVersion,durationS:report?.kind==='roll'?report.input?.duration:undefined}));return{label:request.robustness?robustnessCaseLabel(request.robustness):'导入 / '+(i+1),request};});
}
