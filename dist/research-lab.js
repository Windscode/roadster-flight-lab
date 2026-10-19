import {DEFAULT_PARAMS} from './physics.js';
import {MODEL_VERSION} from './vehicle-models.js';
import {MODEL_BUILD_ID} from './model-build.js';
import {EXPERIMENTS,PROTOCOL_VERSION,RESEARCH_PARAMETERS,normalizeResearchRequest} from './research-protocol.js';
import {PAIR_KEYS,PAIRS,SWEEP_KEYS,buildStudyRequests,studyArchive,importStudy,researchConditionLabel} from './research-study.js';
import {t as translate,onLanguageChange,localizeTree} from './i18n.js';

let panelSerial=0;

/** CSV belongs to one selected historical report, not to the application's
 * currently loaded model or whichever other curves happen to be checked. */
export function standardReportCSV(entry){
  const r=entry?.report;if(!r||!Array.isArray(r.rows)||!r.rows.length)throw Error('所选记录没有可导出的样本');
  const keys=Object.keys(r.rows[0]),cell=v=>v===null||v===undefined?'':typeof v==='number'?v.toPrecision(12):'"'+String(v).replaceAll('"','""')+'"';
  const intervals=r.rows.slice(1).map((row,i)=>row.time-r.rows[i].time),uniform=intervals.length<2||intervals.every(d=>Math.abs(d-intervals[0])<1e-8);
  return['# Roadster selected standard experiment; model='+r.modelVersion+'; build='+r.modelBuildId+'; protocol='+r.protocolVersion,'# run_id='+r.runId+'; case='+entry.label,'# sampling='+JSON.stringify({declaredHz:r.input?.sampleHz??null,storedRows:r.rows.length,uniform,storedIntervalS:uniform?intervals[0]??null:null,note:'Use row time; metadata belongs to this stored report'}),'# immutable_metrics_source=original fixed '+Math.round(1/(r.input?.dt||1/120))+' Hz integration; metrics='+JSON.stringify(r.metrics),'# Complete protocol, parameters and identities are in the matching JSON. This CSV contains this selected record only.',['run_id','case',...keys].join(','),...r.rows.map(row=>[r.runId,entry.label,...keys.map(k=>row[k])].map(cell).join(','))].join('\r\n');
}

/** Mounts the established pair/sweep/archive study in the active page.
 * Workers use frozen standard initial states; getSim only reads parameters.
 * All DOM lookups and CSS stay inside this instance. No navigation or iframe.
 */
export async function createResearchStudyPanel({mount,getSim=()=>null,onEvent=()=>{},onClose=()=>{}}={}){
  if(!mount?.ownerDocument)throw new Error('高级研究面板需要一个有效的挂载节点');
  const document=mount.ownerDocument,window=document.defaultView||globalThis;
  let localStorage=null;try{localStorage=window.localStorage;}catch{}
  const response=await fetch(new URL('./research-panel.html',import.meta.url));
  if(!response.ok)throw new Error('高级研究面板加载失败：'+response.status);
  const markup=await response.text();
  if(!document.querySelector('link[data-roadster-study-styles]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./research.css',import.meta.url).href;link.dataset.roadsterStudyStyles='';document.head.append(link);}
  const root=document.createElement('section');root.className='research-study-panel';root.hidden=true;root.setAttribute('aria-label','高级研究：对照、参数扫描与试验记录');root.innerHTML=markup;
  const prefix='roadster-study-'+(++panelSerial)+'-';
  for(const element of root.querySelectorAll('[id]')){element.dataset.studyId=element.id;element.id=prefix+element.id;}
  for(const element of root.querySelectorAll('[for]'))element.setAttribute('for',prefix+element.getAttribute('for'));
  for(const attribute of ['aria-labelledby','aria-describedby'])for(const element of root.querySelectorAll('['+attribute+']'))element.setAttribute(attribute,element.getAttribute(attribute).split(/\s+/).map(id=>prefix+id).join(' '));
  mount.append(root);let disposed=false;

  const $=id=>root.querySelector(`[data-study-id="${id}"]`),colors=['#c4dfb4','#e9b781','#8bc3d3','#ce9bc2','#a9afe1','#d2ce8c','#80ba9f'];
  const labels={completed:'计算完成',stable_stop:'持续停止已确认',stable_landing:'稳定着陆已确认',recovered:'持续回稳已确认',not_recovered_in_window:'窗口内未恢复',held_in_window:'窗口内悬停保持',hover_not_held:'悬停未保持',height_hold_lost:'高度未保持',rejected:'预检拒绝',window_ended_without_stable_landing:'窗口内未稳定着陆',window_ended_without_stop:'窗口内未停止'};
  const channels={slipFL:['左前滑移率',''],slipFR:['右前滑移率',''],slipRL:['左后滑移率',''],slipRR:['右后滑移率',''],wheelFL:['左前角速度 / rad/s','rad/s'],wheelFR:['右前角速度 / rad/s','rad/s'],wheelRL:['左后角速度 / rad/s','rad/s'],wheelRR:['右后角速度 / rad/s','rad/s'],abs:['最小 ABS 制动比例',''],tcs:['最小 TCS 驱动比例',''],wing:['尾翼展开量',''],wingDrag:['尾翼阻力 / N','N'],wingDownforce:['尾翼下压力 / N','N'],beta:['有效道路侧偏 / °','°'],yaw:['偏航速率 / °/s','°/s'],steer:['实际路轮角 / °','°'],speed:['实际前进速度 / km/h','km/h'],height:['重心高度 / m','m'],targetHeight:['高度参考 / m','m'],heightError:['高度误差 / m','m'],vertical:['垂直速度 / m/s','m/s'],roll:['滚转角 / °','°'],rollTravel:['累计解缠滚转 / °','°'],positionError:['水平位置偏移 / m','m'],grip:['最大轮胎附着利用率',''],gas:['剩余气量 / kg','kg'],flow:['实际质量流率 / kg/s','kg/s'],pressure:['罐压 / bar','bar'],temperature:['罐温 / K','K'],thrustMargin:['额定主推力 / 车重',''],allocationError:['分配残差 / 归一化','']};
  const channelSets={steer:['beta','yaw','steer','speed','grip'],brake:['speed','slipFL','slipFR','slipRL','slipRR','wheelFL','wheelFR','wheelRL','wheelRR','abs','yaw','grip','wing','wingDrag','wingDownforce'],launch:['speed','slipFL','slipFR','slipRL','slipRR','wheelFL','wheelFR','wheelRL','wheelRR','tcs','yaw','grip','wing','wingDrag','wingDownforce'],attitude:['roll','heightError','height','vertical','positionError'],rise:['height','targetHeight','vertical','heightError'],hover:['heightError','height','positionError','vertical'],roll:['height','rollTravel','roll','vertical']};
  let params={...DEFAULT_PARAMS},entries=[],selected=new Set(),activeId=null,worker=null,pendingReject=null,generation=0,imported=[],chartSeries=[],chartRange=null;
  const storeKey='roadster-research-library-v2',attemptKey='roadster-study-attempts-v1',draftKey='roadster-study-draft-v1';let attempts=[],activeAttempt=null,attemptProtected=false,draftSource=null;
  const maxStoredRecords=64,maxStoredBytes=4*1024*1024;
  let loadedRawArchive='[]',preservedRawArchive=null,storageReadProtected=false,persistenceWarning='';
  const byteLength=value=>new TextEncoder().encode(value).byteLength;
  const currentRecord=e=>e.report.modelVersion===MODEL_VERSION&&e.report.modelBuildId===MODEL_BUILD_ID&&e.report.protocolVersion===PROTOCOL_VERSION;
  const matchingModel=(a,b)=>a.report.kind===b.report.kind&&a.report.modelVersion===b.report.modelVersion&&a.report.modelBuildId===b.report.modelBuildId&&a.report.protocolVersion===b.report.protocolVersion;
  function validStoredRecord(e){const r=e?.report;return typeof e?.id==='string'&&typeof e.label==='string'&&r?.schemaVersion===2&&EXPERIMENTS[r.kind]&&typeof r.modelVersion==='string'&&typeof r.modelBuildId==='string'&&typeof r.protocolVersion==='string'&&r.request&&r.metrics&&r.appliedParams&&Number.isFinite(r.input?.duration)&&Array.isArray(r.rows)&&r.rows.length<=200&&r.rows.every(row=>row&&Number.isFinite(row.time))&&Array.isArray(r.warnings)&&Array.isArray(r.overrides);}
  function readArchive(raw){if(raw.length>maxStoredBytes||byteLength(raw)>maxStoredBytes)throw Error('原有记录超过4 MiB，保留原存档并暂停自动覆盖');const records=JSON.parse(raw);if(!Array.isArray(records)||records.length>maxStoredRecords)throw Error('原有记录超过64项或格式不符，保留原存档并暂停自动覆盖');if(records.some(e=>!validStoredRecord(e))||new Set(records.map(e=>e.id)).size!==records.length)throw Error('部分原有记录不能安全读取，保留原存档并暂停自动覆盖');return records;}
  const fmt=(v,n=2)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(n):'—';
  function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o;}
  function setStatus(message,error=false){$('lab-status').textContent=message;$('lab-status').style.color=error?'#eac18f':'';localizeTree($('lab-status'));}
  function saveAttempts(){try{if(attemptProtected)throw Error('旧执行日志格式受保护');const text=JSON.stringify(attempts);if(attempts.length>64||text.length>1_000_000)throw Error('执行日志达到64项 / 1 MB上限');localStorage?.setItem(attemptKey,text);}catch(error){setStatus(error.message+'；新增执行证据仍可随全部记录 JSON 导出。',true);}$('attempt-log').textContent=attempts.length?JSON.stringify(attempts.map(a=>({id:a.id,status:a.status,startedAt:a.startedAt,finishedAt:a.finishedAt,completed:a.completedIds?.length||0,requested:a.jobs?.length||0,reason:a.reason,identity:a.identity})),null,2):'尚无执行记录。';}
  function finishAttempt(status,reason=''){if(!activeAttempt)return;Object.assign(activeAttempt,{status,reason,finishedAt:new Date().toISOString()});activeAttempt=null;saveAttempts();}
  function renderParameterFields(){
   $('lab-parameters').replaceChildren();for(const [key,p]of Object.entries(RESEARCH_PARAMETERS)){const id='lab-param-'+key,label=document.createElement('label');label.htmlFor=prefix+id;label.textContent=p.label;const unit=document.createElement('span');unit.textContent=p.unit;label.append(unit);const input=document.createElement('input');Object.assign(input,{id:prefix+id,type:'number',min:p.min,max:p.max,step:'any',value:params[key]});input.dataset.studyId=id;input.dataset.parameter=key;$('lab-parameters').append(label,input);}
   $('lab-road-surface').value=params.roadSurface;$('lab-abs').checked=params.absEnabled;$('lab-wing').value=params.wingMode;$('lab-supply').value=params.supplyMode;$('lab-gas-model').value=params.gasModel;$('lab-nozzle-model').value=params.nozzleModel;$('lab-steering-assist').checked=params.steeringAssist;$('lab-traction-assist').checked=params.tractionAssist;
  }
  function collectRequest(){const p={...params};for(const [key]of Object.entries(RESEARCH_PARAMETERS))p[key]=+$('lab-param-'+key).value;Object.assign(p,{roadSurface:$('lab-road-surface').value,absEnabled:$('lab-abs').checked,wingMode:$('lab-wing').value,supplyMode:$('lab-supply').value,gasModel:$('lab-gas-model').value,nozzleModel:$('lab-nozzle-model').value,steeringAssist:$('lab-steering-assist').checked,tractionAssist:$('lab-traction-assist').checked});return normalizeResearchRequest({kind:$('lab-kind').value,params:p,speedKmh:['steer','brake'].includes($('lab-kind').value)?+$('lab-speed').value:80,angleDeg:$('lab-kind').value==='steer'?+$('lab-angle').value:2,steerInput:$('lab-kind').value==='steer'?+$('lab-steer-input').value:.22,steeringProtocol:$('lab-steering-protocol').value,initialRollDeg:$('lab-kind').value==='attitude'?+$('lab-roll').value:35,heightM:$('lab-kind').value==='attitude'?+$('lab-height').value:12,stabilization:$('lab-stabilization').checked});}
  function draftDescriptor(request){return EXPERIMENTS[request.kind].title+(researchConditionLabel(request)?' · '+researchConditionLabel(request):'');}
  function syncPending({saveDraft=true,edited=false}={}){
   try{const request=collectRequest();if(edited&&draftSource)draftSource={...draftSource,edited:true};const source=draftSource?` · 来源历史 ${draftSource.modelVersion} / ${draftSource.runId}${draftSource.edited?'，配置已修改':''}`:'';
    $('pending-config').textContent=translate(`待运行：${draftDescriptor(request)} · 当前模型 ${MODEL_VERSION}${source}。此处配置尚未执行，右侧所选结果独立保留。`);
    $('pending-config').dataset.pending=JSON.stringify({kind:request.kind,identity:{modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,protocolVersion:PROTOCOL_VERSION},request,source:draftSource});
    if(saveDraft&&localStorage){const draft={version:1,request,mode:$('lab-mode').value,pairKey:$('lab-pair').value,sweep:{key:$('sweep-key').value,from:+$('sweep-from').value,to:+$('sweep-to').value,count:+$('sweep-count').value},imported:$('lab-mode').value==='imported'?imported:[],note:$('study-note').value,source:draftSource};localStorage.setItem(draftKey,JSON.stringify(draft));}
   }catch(error){$('pending-config').textContent=translate('待运行配置尚未有效：'+error.message+'。已保存的历史结果没有改变。');}
   localizeTree(root);
  }
  function applyRequestToForm(request,{source=null,mode='single',note=''}={}){
   const r=normalizeResearchRequest(request);params={...r.params};$('lab-kind').value=r.kind;$('lab-mode').value=mode;draftSource=source;renderParameterFields();updateForm(true);
   for(const [key,value]of Object.entries({'lab-speed':r.speedKmh,'lab-angle':r.angleDeg,'lab-steer-input':r.steerInput,'lab-steering-protocol':r.steeringProtocol,'lab-roll':r.initialRollDeg,'lab-height':r.heightM}))if(value!==undefined)$(key).value=value;
   $('lab-stabilization').checked=r.stabilization;$('study-note').value=note;updateForm();return r;
  }
  function loadHistoricalConfig(){const a=active();if(!a)return false;if(worker){setStatus('请先停止正在运行的试验。',true);return false;}imported=[];applyRequestToForm(a.report.request,{source:{id:a.id,runId:a.report.runId,modelVersion:a.report.modelVersion,modelBuildId:a.report.modelBuildId,protocolVersion:a.report.protocolVersion,edited:false},note:a.note||''});syncPending();setStatus('历史配置已载入待运行区；所选历史响应保持原样，点击运行将产生当前模型的新记录。');onEvent('research_study_history_config_loaded',{sourceId:a.id,sourceModel:a.report.modelVersion,sourceBuild:a.report.modelBuildId});return true;}
  function restoreDraft(){try{const text=localStorage?.getItem(draftKey);if(!text)return false;if(text.length>100000)throw Error('保存的待运行配置过大');const draft=JSON.parse(text);if(draft.version!==1||!['single','pair','sweep','imported'].includes(draft.mode))throw Error('待运行配置格式不支持');imported=draft.mode==='imported'?(draft.imported||[]).map(j=>({label:String(j.label||'导入方案'),request:normalizeResearchRequest(j.request)})):[];if(imported.length>12)throw Error('待运行方案过多');applyRequestToForm(draft.request,{source:draft.source??null,mode:draft.mode,note:String(draft.note||'').slice(0,100)});if(PAIR_KEYS[draft.request.kind].includes(draft.pairKey))$('lab-pair').value=draft.pairKey;if(SWEEP_KEYS[draft.request.kind].includes(draft.sweep?.key)){$('sweep-key').value=draft.sweep.key;updateSweep();for(const [field,key]of [['sweep-from','from'],['sweep-to','to'],['sweep-count','count']])if(Number.isFinite(draft.sweep[key]))$(field).value=draft.sweep[key];}updateForm();syncPending({saveDraft:false});return true;}catch(error){setStatus('原待运行配置未能载入：'+error.message+'；历史结果仍可查看。',true);return false;}}
  function updateSweep(){const p=RESEARCH_PARAMETERS[$('sweep-key').value];if(!p)return;const center=+($('lab-param-'+$('sweep-key').value)?.value||params[$('sweep-key').value]);for(const id of ['sweep-from','sweep-to']){const e=$(id);e.min=p.min;e.max=p.max;e.step='any';}$('sweep-from').value=Math.max(p.min,+(center*.7).toPrecision(4));$('sweep-to').value=Math.min(p.max,+(center*1.3).toPrecision(4));}
  function updateForm(reset=false){
   const kind=$('lab-kind').value,mode=$('lab-mode').value;
   $('protocol-description').textContent=EXPERIMENTS[kind].description;
   $('road-condition').hidden=!['steer','brake','launch'].includes(kind);$('road-fields').hidden=!['steer','brake'].includes(kind);$('steer-fields').hidden=kind!=='steer';$('attitude-fields').hidden=kind!=='attitude';
   $('pair-fields').hidden=mode!=='pair';$('sweep-fields').hidden=mode!=='sweep';
   if(reset){$('lab-pair').replaceChildren(...PAIR_KEYS[kind].map(k=>option(k,PAIRS[k].label)));$('sweep-key').replaceChildren(...SWEEP_KEYS[kind].map(k=>option(k,RESEARCH_PARAMETERS[k].label)));updateSweep();}
   if(mode==='pair'&&$('lab-pair').value==='steeringAssist')$('lab-steering-protocol').value='driver';
   $('wheel-angle-field').hidden=$('lab-steering-protocol').value!=='wheel';$('driver-input-field').hidden=$('lab-steering-protocol').value!=='driver';
   $('lab-steering-protocol').disabled=mode==='pair'&&$('lab-pair').value==='steeringAssist';
   const pair=PAIRS[$('lab-pair').value];$('pair-description').textContent=pair?'同一初态与时序：'+pair.labels.join(' ↔ ')+(pair.key==='steeringAssist'?'。自动采用相同驾驶输入，保留辅助差异。':'。'):'';
   for(const e of $('protocol-form').querySelectorAll('input,select'))if(!['lab-kind','lab-mode','study-note'].includes(e.dataset.studyId))e.disabled=mode==='imported'||e.dataset.studyId==='lab-steering-protocol'&&mode==='pair'&&$('lab-pair').value==='steeringAssist';
   if(mode==='imported')$('protocol-description').textContent=`已导入${imported.length}个冻结方案；点击运行后按当前${PROTOCOL_VERSION}协议重新计算，不采信文件中的旧指标。`;
  }
  function save({replace=false}={}){
    try{
      if(!localStorage)throw Error('浏览器存储不可用');
      if(storageReadProtected&&!replace)throw Error('原有存档已保护，新的结果只保留在本会话');
      const latestRaw=localStorage.getItem(storeKey)||'[]';
      if(!replace&&latestRaw!==loadedRawArchive){let latest;try{latest=readArchive(latestRaw);}catch(error){storageReadProtected=true;preservedRawArchive=latestRaw;throw error;}const merged=new Map(latest.map(e=>[e.id,e]));for(const e of entries)if(!merged.has(e.id))merged.set(e.id,e);entries=[...merged.values()];}
      const serialized=JSON.stringify(entries);if(entries.length>maxStoredRecords||byteLength(serialized)>maxStoredBytes)throw Error('已达到64项 / 4 MiB存储上限；旧记录保持不变，新结果只保留在本会话');
      localStorage.setItem(storeKey,serialized);loadedRawArchive=serialized;persistenceWarning='';return true;
    }catch(error){persistenceWarning=error.message+'。请导出全部记录 JSON 后再清理。';setStatus(persistenceWarning,true);return false;}
  }
  function active(){return entries.find(e=>e.id===activeId)||entries.at(-1);}
  function compatible(){const a=active();return a?entries.filter(e=>selected.has(e.id)&&matchingModel(e,a)):[];}
  function metricSet(r){const m=r.metrics;
   switch(r.kind){
    case'steer':return[['最大有效侧偏',m.maxBetaDeg,'°'],['实际速度 RMSE',m.speedRmseKmh,'km/h'],['峰值偏航速率',m.maxYawRateDegS,'°/s'],['驾驶器饱和',m.driverSaturationSeconds,'s']];
    case'brake':return[['制动距离',m.stop?.distanceM,'m'],['轮胎抱死持续',m.lockedWheelSeconds,'s'],['ABS调制持续',m.absActiveSeconds,'s'],['最大偏航偏移',m.maxHeadingDeviationDeg,'°']];
    case'launch':return[['起步行驶距离',m.launchDistanceM,'m'],['结束速度',m.finalSpeedKmh,'km/h'],['空转持续',m.spinningWheelSeconds,'s'],['TCS调制持续',m.tcsActiveSeconds,'s']];
    case'attitude':return[['持续回稳时刻',m.recoveredAtSeconds,'s'],['高度误差 RMSE',m.heightRmseM,'m'],['喷口饱和时间',m.nozzleSaturationSeconds,'s'],['实际通过气量',m.throughputKg,'kg']];
    case'rise':return[['最大上升速率',m.maxVerticalMps,'m/s'],['松开后的续升',m.releaseOvershootM,'m'],['高度误差 RMSE',m.heightRmseM,'m'],['实际通过气量',m.throughputKg,'kg']];
    case'hover':return[['额定能力不足时刻',m.lossOfSupportSeconds,'s'],['持续高度超限时刻',m.heightHoldLostSeconds,'s'],['最大水平漂移',m.maxPositionErrorM,'m'],['实际通过气量',m.throughputKg,'kg']];
    case'roll':return[['累计解缠旋转',m.rollTravelDeg,'°'],['首次承载前垂速',m.touchdown?.speedMps,'m/s'],['稳定着陆确认',m.stableLanding?.time,'s'],['剩余车载气体',m.remainingGasKg,'kg']];
   }
  }
  function summaryValue(r){const m=r.metrics;switch(r.kind){case'steer':return['最大有效侧偏',m.maxBetaDeg,'°'];case'brake':return['制动距离',m.stop?.distanceM,'m'];case'launch':return['起步行驶距离',m.launchDistanceM,'m'];case'attitude':return['持续回稳时刻',m.recoveredAtSeconds,'s'];case'hover':return['持续高度超限时刻',m.heightHoldLostSeconds,'s'];case'rise':return['最大上升速率',m.maxVerticalMps,'m/s'];case'roll':return['稳定着陆确认',m.stableLanding?.time,'s'];}}
  function drawTime(canvas,series,key){
   const g=canvas.getContext('2d'),w=canvas.width,h=canvas.height,L=65,R=w-25,T=24,B=h-34;
   g.clearRect(0,0,w,h);g.font='14px Consolas';const values=series.flatMap(e=>e.report.rows.map(r=>r[key])).filter(v=>typeof v==='number'&&Number.isFinite(v));
   let lo=values.length?Math.min(0,...values):0,hi=values.length?Math.max(...values):1;if(hi-lo<.01){hi+=.5;lo-=.5;}const pad=(hi-lo)*.08;lo-=pad;hi+=pad;
   const maxT=Math.max(1,...series.map(e=>e.report.input.duration));
   for(let i=0;i<5;i++){const y=T+(B-T)*i/4;g.strokeStyle='#304448';g.lineWidth=1;g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();g.fillStyle='#96aaa7';g.fillText((hi-(hi-lo)*i/4).toFixed(Math.abs(hi-lo)<5?2:0),4,y+4);}
   for(let i=0;i<=4;i++){g.fillStyle='#91aaa4';g.fillText((maxT*i/4).toFixed(1)+'s',L+(R-L)*i/4-8,h-8);}
   if(!values.length){g.fillStyle='#b6c1b4';g.fillText(translate('无有效样本 / 该量在此工况不适用'),L+30,(T+B)/2);}
   series.forEach((e,j)=>{g.strokeStyle=colors[j%colors.length];g.lineWidth=2.3;g.beginPath();let connected=false;for(const row of e.report.rows){const v=row[key];if(typeof v!=='number'||!Number.isFinite(v)){connected=false;continue;}const x=L+(R-L)*row.time/maxT,y=B-(v-lo)/(hi-lo)*(B-T);if(connected)g.lineTo(x,y);else g.moveTo(x,y);connected=true;}g.stroke();});
   return{L,R,T,B,maxT,lo,hi};
  }
  function drawSummary(series){
   const c=$('summary-chart'),g=c.getContext('2d'),w=c.width,h=c.height,L=56,R=w-18,T=24,B=h-45;g.clearRect(0,0,w,h);g.font='13px Consolas';
   const summary=summaryValue(active().report);$('summary-chart-title').textContent=summary[0];$('summary-unit').textContent=summary[2];
   const vals=series.map(e=>summaryValue(e.report)[1]),hi=Math.max(1,...vals.filter(v=>typeof v==='number'))*1.15,span=(R-L)/Math.max(1,series.length);
   for(let i=0;i<4;i++){const y=B-(B-T)*i/3;g.strokeStyle='#304448';g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();g.fillStyle='#8ca49e';g.fillText((hi*i/3).toFixed(1),5,y+4);}
   series.forEach((e,i)=>{const value=vals[i],x=L+i*span+span*.23;g.fillStyle=colors[i%colors.length];if(typeof value==='number'){const bh=value/hi*(B-T);g.fillRect(x,B-bh,span*.54,Math.max(1,bh));g.fillText(fmt(value),x,Math.max(T,B-bh-8));}else{g.fillText(translate('未发生'),x,B-15);}g.fillStyle='#a7bbb5';g.fillText(String(i+1),x+span*.15,h-18);});
  }
  function resetChartReadout(){const key=$('chart-channel').value;$('chart-readout').textContent=chartSeries.length?`${channels[key]?.[0]||'时间响应'} · ${chartSeries.length} 条当前系列；移动指针读取最近样本。`:'没有当前曲线。';}
  function clearCharts(){chartSeries=[];chartRange=null;for(const id of ['response-chart','budget-chart','summary-chart']){const c=$(id);c.getContext('2d')?.clearRect(0,0,c.width,c.height);}$('response-legend').replaceChildren();$('summary-unit').textContent='';$('summary-chart-title').textContent='参数响应';$('metric-cards').replaceChildren();$('report-details').replaceChildren();$('analysis-content').dataset.result='';resetChartReadout();}
  function renderCharts(){const a=active();if(!a){clearCharts();return;}chartSeries=compatible();if(!chartSeries.length)chartSeries=[a];chartRange=drawTime($('response-chart'),chartSeries,$('chart-channel').value);drawTime($('budget-chart'),chartSeries,$('budget-channel').value);drawSummary(chartSeries);$('response-legend').replaceChildren(...chartSeries.map((e,i)=>{const span=document.createElement('span'),mark=document.createElement('i');mark.style.background=colors[i%colors.length];span.append(mark,document.createTextNode(`${i+1}. ${e.label}`));return span;}));resetChartReadout();}
  function renderDetails(r){const node=$('report-details');node.replaceChildren();for(const [title,value]of [['实验判据',r.definitions],['事件时序',r.events],['强制协议覆盖',r.overrides],['模型假设',r.assumptions],['参数快照',r.appliedParams],['初态与终态',{initial:r.initialState,final:r.finalState}]]){const h=document.createElement('h4');h.textContent=title;const pre=document.createElement('pre');pre.dataset.noI18n='';pre.textContent=JSON.stringify(value,null,2);node.append(h,pre);}}
  function renderComparison(){
   const a=active();if(!a)return;const r=a.report;
   const first=compatible()[0],baseline=first&&first.id!==a.id?metricSet(first.report):null;
   $('metric-cards').replaceChildren(...metricSet(r).map(([name,value,unit],i)=>{const div=document.createElement('div');div.className='metric';const label=document.createElement('span'),n=document.createElement('b'),small=document.createElement('small');label.textContent=name;n.textContent=fmt(value)+(typeof value==='number'?' '+unit:'');small.textContent=baseline&&typeof value==='number'&&typeof baseline[i][1]==='number'?'同版本首条 Δ '+fmt(value-baseline[i][1])+' '+unit:typeof value==='number'?(currentRecord(a)?'当前模型120Hz响应统计':'历史模型120Hz响应统计'):'窗口内未发生 / 不适用';div.append(label,n,small);return div;}));
   // DOM-visible diagnostics support independent UI verification without private state access.
   $('analysis-content').dataset.result=JSON.stringify({kind:r.kind,outcome:r.outcome,runId:r.runId,records:entries.length,metrics:r.metrics,selected:compatible().length,historical:!currentRecord(a),modelVersion:r.modelVersion,modelBuildId:r.modelBuildId,protocolVersion:r.protocolVersion});
   renderCharts();
  }
  function render(){
   const a=active();$('lab-empty').hidden=!!a;$('analysis-content').hidden=!a;for(const id of ['export-study','export-rows'])$(id).disabled=!entries.length;$('export-library').disabled=!entries.length&&!attempts.length;$('record-count').textContent=entries.length+' 项';$('library-notice').hidden=!persistenceWarning;$('library-notice').textContent=persistenceWarning;$('export-preserved').hidden=!preservedRawArchive;
   $('record-table').replaceChildren(...[...entries].reverse().map(e=>{const tr=document.createElement('tr');tr.classList.toggle('active',a?.id===e.id);tr.classList.toggle('historical',!currentRecord(e));const td=document.createElement('td'),check=document.createElement('input');check.type='checkbox';check.checked=selected.has(e.id)&&(!a||matchingModel(e,a));check.disabled=!!a&&!matchingModel(e,a);check.setAttribute('aria-label','叠加 '+e.label);check.title=check.disabled?'只叠加同模型、同构建与同协议的同类试验':'';check.onchange=()=>{if(check.checked)selected.add(e.id);else selected.delete(e.id);renderComparison();};td.append(check);tr.append(td);const name=document.createElement('td'),button=document.createElement('button'),small=document.createElement('small');button.textContent=translate(EXPERIMENTS[e.report.kind].title)+' · '+translate(e.label)+(researchConditionLabel(e.report.request)&&!e.label.includes(researchConditionLabel(e.report.request))?' · '+translate(researchConditionLabel(e.report.request)):'');small.textContent=(currentRecord(e)?'当前':'历史')+'模型 '+e.report.modelVersion+' · '+e.report.modelBuildId.slice(0,10)+' · '+e.report.runId+' / '+e.report.appliedParams.supplyMode;button.onclick=()=>{activeId=e.id;selected=new Set(entries.filter(other=>selected.has(other.id)&&matchingModel(other,e)).map(other=>other.id));selected.add(e.id);render();};name.append(button,small);tr.append(name);for(const value of [labels[e.report.outcome]||e.report.outcome,fmt(summaryValue(e.report)[1])+' '+summaryValue(e.report)[2],fmt(e.report.metrics.gasUsedKg)]){const cell=document.createElement('td');cell.textContent=value;tr.append(cell);}return tr;}));
   if(!a){clearCharts();localizeTree(root);return;}const r=a.report;$('selected-result-context').textContent=translate('当前查看的是已保存结果：'+EXPERIMENTS[r.kind].title+' · '+researchConditionLabel(r.request)+'。左侧是另一个待运行配置；查看或切换结果不会替换它。');$('active-protocol').textContent=(currentRecord(a)?'当前模型结果':'历史结果')+' · '+r.runId+' · '+r.protocolVersion+' · 模型 '+r.modelVersion+' · '+r.modelBuildId.slice(0,10);$('active-title').textContent=EXPERIMENTS[r.kind].title+' / '+a.label;$('active-outcome').textContent=labels[r.outcome]||r.outcome;$('active-outcome').classList.toggle('caution',!currentRecord(a)||r.warnings.length>0||['rejected','hover_not_held','not_recovered_in_window'].includes(r.outcome));
   const messages=[...r.warnings,...r.overrides];if(!currentRecord(a))messages.unshift('历史结果：基于模型 '+r.modelVersion+' / '+r.modelBuildId.slice(0,10)+'。此处回看原响应，不代表当前模型；可按当前模型重算方案。');if(r.appliedParams.supplyMode==='bench')messages.push('恒压试验台：车载气量不变，实际通过气量来自外部气源。');$('result-warnings').classList.toggle('notice',!r.warnings.length&&currentRecord(a));$('result-warnings').hidden=!messages.length;$('result-warnings').textContent=messages.join('\n');
   const old=$('chart-channel').value,options=channelSets[r.kind];$('chart-channel').replaceChildren(...options.map(k=>option(k,channels[k][0])));$('chart-channel').value=options.includes(old)?old:options[0];renderDetails(r);renderComparison();localizeTree(root);

  }
  function compute(request){return new Promise((resolve,reject)=>{
   let launched;const fail=error=>{if(launched&&worker!==launched)return;try{launched?.terminate();}catch{}worker=null;pendingReject=null;reject(error instanceof Error?error:Error(String(error)));};
   try{const WorkerCtor=window.Worker??globalThis.Worker;if(!WorkerCtor)throw Error('浏览器不支持后台 Worker；历史查看与导出仍可用');launched=new WorkerCtor(new URL('./experiment-worker.js',import.meta.url),{type:'module'});worker=launched;pendingReject=reject;launched.onmessage=e=>{if(disposed||worker!==launched)return;if(!e.data.ok){fail(Error(e.data.error));return;}launched.terminate();worker=null;pendingReject=null;resolve(e.data.report);};launched.onerror=e=>fail(Error(e.message));launched.onmessageerror=()=>fail(Error('后台返回数据不能读取'));launched.postMessage(request);}catch(error){fail(error);}
  });}
  async function run(event){event?.preventDefault();if(disposed||worker)return;const turn=++generation;let jobs;
   try{jobs=$('lab-mode').value==='imported'?imported:buildStudyRequests(collectRequest(),{mode:$('lab-mode').value,pairKey:$('lab-pair').value,sweepKey:$('sweep-key').value,from:+$('sweep-from').value,to:+$('sweep-to').value,count:+$('sweep-count').value});if(!jobs.length)throw Error('没有可运行方案');}catch(e){setStatus(e.message,true);return;}
   $('lab-run').disabled=true;$('lab-cancel').disabled=false;$('results-title').scrollIntoView({behavior:'smooth',block:'start'});onEvent('research_study_start',{jobs:jobs.length,kind:jobs[0]?.request.kind});const batch=Date.now().toString(36)+'-'+prefix+turn,ids=[],frozenNote=$('study-note').value,frozenSource=draftSource?structuredClone(draftSource):null;activeAttempt={id:batch,status:'running',identity:{modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,protocolVersion:PROTOCOL_VERSION},startedAt:new Date().toISOString(),jobs:structuredClone(jobs),completedIds:ids,note:frozenNote,sourceConfiguration:frozenSource};attempts.push(activeAttempt);saveAttempts();
   try{for(let i=0;i<jobs.length;i++){if(turn!==generation)break;const job=jobs[i];setStatus(`计算 ${i+1} / ${jobs.length}：${job.label} · 不改变三维场景`);const report=await compute(job.request);if(turn!==generation)break;const entry={id:batch+'-'+i,batchId:batch,label:job.label,factor:job.factor||null,note:frozenNote,sourceConfiguration:frozenSource,report};entries.push(entry);ids.push(entry.id);activeId=entry.id;selected=new Set(ids);save();render();}if(turn===generation){setStatus(`已完成 ${ids.length} / ${jobs.length} · `+(persistenceWarning?'部分结果仅保留在本会话，请导出全部记录。':'参数与原始数据已保存在本机'),!!persistenceWarning);finishAttempt('completed','全部方案已返回实际求解结果');onEvent('research_study_complete',{completed:ids.length,jobs:jobs.length,persisted:!persistenceWarning});}}catch(e){if(turn===generation){finishAttempt('failed',e.message);setStatus('计算未完成：'+e.message+'；失败条件已留证。',true);}}finally{if(turn===generation){$('lab-run').disabled=false;$('lab-cancel').disabled=true;}}
  }
  function cancel(){finishAttempt('cancelled','用户停止：保留冻结请求和已返回结果；未返回的中间状态不冒称为完整记录');generation++;worker?.terminate();worker=null;pendingReject?.(Error('已停止'));pendingReject=null;$('lab-run').disabled=false;$('lab-cancel').disabled=true;setStatus('已停止；已完成的实验记录保留。');onEvent('research_study_cancel');}
  function download(text,name,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('protocol-form').onsubmit=run;$('lab-cancel').onclick=cancel;$('lab-kind').onchange=()=>{resetChartReadout();imported=[];if($('lab-mode').value==='imported')$('lab-mode').value='single';updateForm(true);};for(const id of ['lab-mode','lab-pair','lab-steering-protocol'])$(id).onchange=()=>updateForm();$('sweep-key').onchange=updateSweep;
  $('lab-defaults').onclick=()=>{params={...DEFAULT_PARAMS};draftSource=null;renderParameterFields();updateSweep();syncPending();setStatus('已恢复默认研究参数。');};
  for(const b of root.querySelectorAll('[data-preset]'))b.onclick=()=>{cancel();const kind=b.dataset.preset;$('lab-kind').value=kind;$('lab-mode').value='pair';updateForm(true);$('lab-pair').value=kind==='brake'?'absEnabled':kind==='launch'?'tractionAssist':kind==='attitude'?'stabilization':'supplyMode';updateForm();draftSource=null;syncPending();setStatus('方案已载入：'+EXPERIMENTS[kind].title+'，点击运行开始。');};
  $('chart-channel').onchange=renderCharts;$('budget-channel').onchange=renderCharts;
  $('response-chart').onpointermove=e=>{if(!chartRange||!chartSeries.length)return;const c=e.currentTarget,rect=c.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*c.width,time=clamp((x-chartRange.L)/(chartRange.R-chartRange.L),0,1)*chartRange.maxT,key=$('chart-channel').value;const values=chartSeries.map((s,i)=>{const row=s.report.rows.reduce((a,b)=>Math.abs(b.time-time)<Math.abs(a.time-time)?b:a,s.report.rows[0]);return`${i+1}: ${row?fmt(row[key]):'—'} ${channels[key]?.[1]||''}`;});$('chart-readout').textContent=`t ≈ ${fmt(time)} s　`+values.join('　|　');};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  $('export-study').onclick=()=>{const chosen=compatible().length?compatible():active()?[active()]:[];if(chosen.length>12){setStatus('可重算研究包每组最多12条；请选择较少的记录，或导出全部记录作完整归档。',true);return;}download(JSON.stringify(studyArchive(chosen,$('study-note').value),null,2),'roadster-research-study.json','application/json');};
  $('export-library').onclick=()=>download(JSON.stringify({schemaVersion:1,application:'Roadster Research Library Archive',createdAt:new Date().toISOString(),note:'本面板标准实验整库：含标准报告 entries 和执行尝试 attempts；不包含现场驾驶快照库或流程配置库。每条 report 保留原模型、构建和协议。需要重算时，选择最多12条导出研究包。',entries,attempts},null,2),'roadster-research-library-archive.json','application/json');
  $('export-preserved').onclick=()=>{if(preservedRawArchive)download(preservedRawArchive,'roadster-research-preserved-records.json','application/json');};
  $('load-active-config').onclick=()=>{try{loadHistoricalConfig();}catch(error){setStatus('历史配置载入失败：'+error.message,true);}};
  $('rerun-active').onclick=()=>{try{if(loadHistoricalConfig()){onEvent('research_study_rerun',{sourceModel:draftSource.modelVersion,sourceBuild:draftSource.modelBuildId});run();}}catch(error){setStatus('当前模型不能重算该方案：'+error.message,true);}};
  $('export-rows').onclick=()=>{const a=active();if(!a?.report.rows.length)return;download('\uFEFF'+standardReportCSV(a),'roadster-'+a.report.runId+'-selected.csv','text/csv;charset=utf-8');};
  $('import-study').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>6e6)throw Error('研究包需小于6MB');imported=importStudy(JSON.parse(await file.text()));$('lab-mode').value='imported';updateForm();draftSource=null;syncPending();setStatus(`已导入${imported.length}条方案；点击运行按当前协议重算。`);}catch(error){setStatus('导入失败：'+error.message,true);}finally{e.target.value='';}};
  $('clear-library').onclick=()=>{if(worker){setStatus('请先停止运行，再清空记录。',true);return;}entries=[];selected.clear();activeId=null;storageReadProtected=false;preservedRawArchive=null;const saved=save({replace:true});render();setStatus(saved?'本机实验记录已清空。':'本会话记录已清空；原本机存档未能修改。请检查浏览器存储。',!saved);};
  $('lab-kind').replaceChildren(...Object.entries(EXPERIMENTS).map(([k,v])=>option(k,v.domain+' / '+v.title)));$('model-version').textContent=MODEL_VERSION+' / '+PROTOCOL_VERSION;
  try{const current=getSim?.();if(current?.params){params=normalizeResearchRequest({params:{...current.params}}).params;$('handoff-note').hidden=false;$('handoff-note').textContent='已读取当前车辆参数；后台标准试验使用自己的初态，现场车辆状态保持。';}}catch{}
  renderParameterFields();updateForm(true);restoreDraft();syncPending({saveDraft:false});
  try{const raw=localStorage?.getItem(attemptKey)||'[]';if(raw.length>1_000_000)throw Error('旧执行记录过大');attempts=JSON.parse(raw);if(!Array.isArray(attempts)||attempts.length>64||attempts.some(a=>!a||typeof a.id!=='string'||!Array.isArray(a.jobs)||!['running','completed','failed','cancelled','interrupted'].includes(a.status)))throw Error('旧执行记录格式错误');for(const a of attempts)if(a.status==='running'){a.status='interrupted';a.reason='页面上次离开时尚未收到完成结果；只保留已经返回的记录';}}catch{attempts=[];attemptProtected=true;}saveAttempts();
  try{loadedRawArchive=localStorage?.getItem(storeKey)||'[]';entries=readArchive(loadedRawArchive);if(entries.length){activeId=entries.at(-1).id;selected.add(activeId);}}catch(error){storageReadProtected=true;preservedRawArchive=loadedRawArchive;persistenceWarning=error.message+'。可以导出原有存档；运行新的试验不会覆盖它。';}render();

  function loadCurrentParameters(){try{const sim=getSim?.();if(!sim?.params)throw new Error('当前没有可读取的车辆');params=normalizeResearchRequest({params:{...sim.params}}).params;renderParameterFields();updateSweep();$('handoff-note').hidden=false;$('handoff-note').textContent='参数来自当前车辆；运行标准试验不会修改现场车辆。';draftSource=null;syncPending();setStatus('已读取当前车辆参数，点击运行进行标准对照。');onEvent('research_study_parameters_read');return true;}catch(error){setStatus(error.message,true);return false;}}
  function open(){if(disposed)return false;root.hidden=false;syncPending({saveDraft:false});localizeTree(root);onEvent('research_study_panel_open');return true;}
  function close(){if(disposed)return;root.hidden=true;onClose();}
  const keydown=event=>{event.stopPropagation();if(event.code==='Escape'){event.preventDefault();close();}},keyup=event=>event.stopPropagation();
  root.addEventListener('keydown',keydown);root.addEventListener('keyup',keyup);
  const draftChange=()=>syncPending({edited:true});$('protocol-form').addEventListener('change',draftChange);const stopLanguage=onLanguageChange(()=>{updateForm();render();syncPending({saveDraft:false});});$('lab-current').onclick=loadCurrentParameters;$('study-close').onclick=close;
  return {root,open,close,cancel,loadCurrentParameters,
    getState:()=>({open:!root.hidden,running:!!worker,records:entries.length,activeId,pendingRequest:JSON.parse($('pending-config').dataset.pending||'null')?.request??null,draftSource,attempts:attempts.length,lastAttempt:attempts.at(-1)?{id:attempts.at(-1).id,status:attempts.at(-1).status}:null}),
    dispose(){if(disposed)return;disposed=true;stopLanguage();$('protocol-form').removeEventListener('change',draftChange);finishAttempt('cancelled','研究面板被关闭 / 卸载');generation++;worker?.terminate();worker=null;pendingReject?.(Error('研究面板已关闭'));pendingReject=null;root.removeEventListener('keydown',keydown);root.removeEventListener('keyup',keyup);root.remove();},
  };
}
