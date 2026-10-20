import {exportJson,exportFile} from './export-download.js';
import './research-i18n-3.14.js';
import {ExperimentRecorder,ExperimentPlayback,EXPERIMENT_LIMITS,EXPERIMENT_LIBRARY_KEY,loadExperimentArchive,saveExperimentArchive,exportExperimentArchive,parseExperimentArchive,experimentCSV,replayEligibility,currentExperimentIdentity,contentLabel} from './experiment-records.js';
import {CONTROLLER_FIELDS,validateController,hasPilotInput} from './flight-programs.js';
import {t as tr,onLanguageChange,localizeTree} from './i18n.js';
import {PersistenceState} from './research-storage.js';

const clone=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,n=2)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(n):'—';
const statusNames={completed:'完成',cancelled:'已取消 / 接管',failed:'失败留证',timeout:'超时',limit:'达到记录上限'};
const button=(key,label,extra='')=>`<button type="button" data-ex-action="${key}" ${extra}>${label}</button>`;

/** The archive and numerical controls remain usable without WebGL. The host
 * controls availability of the live simulator and restores its scene. */
export function createExperimentConsole({mount,getSim,getContext=()=> 'city',getSceneConfiguration=()=>null,getLiveAvailable=()=>true,onRestoreExperiment,onBeforeRestore=()=>{},onStart=()=>{},onCancel=()=>{},onStatus=()=>{},notify=()=>{},getControllerDraft=()=>({}),storage}={}){
  const doc=mount.ownerDocument,loaded=loadExperimentArchive(storage);let records=loaded.records,selectedId=records.at(-1)?.id??null,protectedRaw=loaded.protectedRaw,available=getLiveAvailable(),unavailableReason='',playback=null,replaySource=null,replaySavedContext=null,worker=null,job=null,serial=0,disposed=false,plotKey='heightM',lastReplay=null;
  const persistence=new PersistenceState(loaded.warning||'',protectedRaw);let diskRaw=loaded.raw??null;
  mount.innerHTML=`
    <p class="rc-message" role="alert" data-ex="persistence" data-kind="warning" hidden></p>
    <section class="rc-section rc-record-section"><h3>记录这次驾驶 / 飞行</h3><p class="rc-help">先记录，再驾驶或执行已有流程。初始刚体、轮速、气罐、阀门、控制器、接触历史、风场相位及噪声种子一起保存。记录保留实际 120 Hz 输入和按序控制事件；保存天气、画质、路线及初始机位，暂不重放过程中的镜头运动。</p>
      <label class="rc-field rc-full"><span>本次实验名称</span><input data-ex="record-name" maxlength="100" value="城市驾驶 / 飞行记录"></label>
      <div class="rc-program-actions">${button('record','开始记录','class="rc-run" data-ex-live')}${button('stop-record','结束并保存','class="rc-stop"')}</div><p data-ex="record-state" class="rc-live-state" role="status">未记录 · 最长 300 s</p><p data-ex="availability" class="rc-help" hidden></p>
    </section>
    <details class="rc-section"><summary>测量扰动与喷口故障 <span>进入实际控制路径</span></summary><p class="rc-help">噪声为有种子的有界均匀采样；延迟使用仿真时间采样保持。只影响飞行反馈观测，轮速与接地开关仍为理想测量。故障改变单个喷口可用推力。</p>
      <label class="rc-check"><input type="checkbox" data-ex="observation-enabled">开启测量延迟 / 噪声</label>
      <div class="rc-grid">${[['delayMs','延迟 · ms',0,0,500,1],['seed','种子',37,0,4294967295,1],['positionNoiseM','位置噪声幅值 · m',.015,0,5,.005],['velocityNoiseMps','速度噪声幅值 · m/s',.02,0,5,.01],['attitudeNoiseDeg','姿态噪声幅值 · °',.2,0,15,.1],['angularRateNoiseRadS','角速噪声幅值 · rad/s',.01,0,2,.005]].map(([k,label,v,min,max,step])=>`<label class="rc-field"><span>${label}</span><input type="number" data-ex-observation="${k}" value="${v}" min="${min}" max="${max}" step="${step}"></label>`).join('')}</div>
      <div class="rc-button-row">${button('apply-observation','应用测量模型','data-ex-live')}${button('reset-observation','关闭并重置','data-ex-live')}</div>
      <div class="rc-grid"><label class="rc-field"><span>喷口</span><select data-ex="fault-id"><option value="lift-FR">右前主喷口</option><option value="lift-FL">左前主喷口</option><option value="lift-RR">右后主喷口</option><option value="lift-RL">左后主喷口</option></select></label><label class="rc-field"><span>可用推力比例 · 0 完全失效</span><input type="number" data-ex="fault-scale" min="0" max="1" step=".1" value=".5"></label></div>
      <div class="rc-button-row">${button('apply-fault','应用单喷口降额','data-ex-live')}${button('clear-fault','恢复喷口','data-ex-live')}</div><p class="rc-help" data-ex="fault-status">当前测量与故障状态由仿真读取。</p>
    </details>
    <section class="rc-section"><div class="rc-section-title"><h3>现场实验档案</h3><span data-ex="record-count">0 项</span></div><label class="rc-field rc-full"><span>选择历史结果 · 查看不会改变现场车辆</span><select data-ex="record-select"></select></label><p class="rc-help rc-identity" data-ex="identity"></p>
      <select data-ex="plot-channel" aria-label="记录曲线通道"><option value="heightM">高度 / m</option><option value="positionErrorM">位置误差 / m</option><option value="attitudeErrorDeg">姿态误差 / °</option><option value="speedMps">速度 / m/s</option><option value="massFlowKgS">喷出质量流量 / kg/s</option></select><canvas data-ex="plot" width="720" height="250" aria-label="所选历史记录和 A/B 响应"></canvas><p class="rc-help" data-ex="sampling"></p>
      <div class="rc-button-row">${button('replay','原条件三维重放','class="rc-primary" data-ex-live')}${button('stop-replay','停止重放')}${button('return-before-replay','返回重放前状态','data-ex-live')}</div><p class="rc-help" data-ex="replay-eligibility"></p>
      <div class="rc-button-row">${button('numeric-replay','原条件数值复算')}${button('recompute','按当前构建重算')}</div>
      <details class="rc-section"><summary>公平控制器 A / B <span>同快照 · 同输入 · 同扰动</span></summary><p class="rc-help">A 使用选中记录的控制参数；B 只更改下列声明的控制器参数。两次都导入相同完整初态、实际风场相位、观测延迟缓存和噪声种子，重放相同驾驶输入与命令。当前控制器按各组增益重新分配执行器；这不是让原自动流程自主重新决策。按当前模型计算，保留源记录身份，不要求两组与原轨迹完全相同。</p><div class="rc-grid">${CONTROLLER_FIELDS.map(([key,label,min,max,step,unit,value])=>`<label class="rc-field"><span>B · ${label} / ${unit}</span><input type="number" data-ex-controller="${key}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`).join('')}</div><div class="rc-button-row">${button('copy-source-controller','B 读取原记录参数')}${button('copy-draft-controller','B 读取控制面板参数')}${button('compare','运行公平 A / B','class="rc-primary"')}</div></details>
      <div class="rc-numeric-controls"><b data-ex="job-state" role="status">数值执行就绪 · 不需要图形设备</b>${button('stop-job','停止数值执行')}</div><div data-ex="comparison" class="rc-comparison"></div>
      <details class="rc-section"><summary>初态、事件与统计来源</summary><pre data-no-i18n data-ex="details" class="rc-record-details"></pre></details>
      <div class="rc-button-row">${button('export-all','现场整库 JSON')}${button('export-one','选中记录 JSON')}${button('export-csv','选中记录 CSV')}<label class="rc-file-button">合并导入记录<input type="file" accept=".json,application/json" data-ex="import"></label></div><div class="rc-button-row">${button('export-protected','导出受保护原存档')}${button('delete-selected','删除选中记录')}</div>
      <p class="rc-help">整库 JSON 含全部现场实验及关联数值对照；单记录 CSV 仅含选中记录的已存曲线和原始统计说明。浏览器最多 32 项 / 4 MiB：达到上限后保留旧记录，新结果仍可在本会话导出。曲线可抽稀，快照、输入、事件和原始统计保持完整。</p>
    </section>`;
  const $=name=>mount.querySelector(`[data-ex="${name}"]`),buttons=key=>Array.from(mount.querySelectorAll(`[data-ex-action="${key}"]`));
  function download(value,name,type='application/json'){return exportFile(value,name,type,{doc});}
  function selected(){return records.find(r=>r.id===selectedId)||records.at(-1)||null;}
  function requireLive(){if(!available||!getLiveAvailable()||!getSim())throw Error(unavailableReason||'图形现场不可用；仍可查看历史、导出和运行数值研究');}
  function paintPersistence(){const state=persistence.snapshot();$('persistence').hidden=!state.sessionOnly;$('persistence').textContent=state.sessionOnly?'现场记录：仅本会话 / 未保存。'+state.message+'。可导出当前完整结果与整库；完成状态不表示已保存。':'';$('persistence').dataset.persistence=JSON.stringify(state);localizeTree($('persistence'));}
  function persist(){try{const saved=saveExperimentArchive(storage,records,{protectedRaw}),merged=new Map(saved.map(r=>[r.id,r]));for(const r of records)merged.set(r.id,r);records=[...merged.values()];diskRaw=storage.getItem(EXPERIMENT_LIBRARY_KEY);persistence.saved();paintPersistence();return true;}catch(error){persistence.failed(error,records.map(r=>r.id));paintPersistence();notify(error.message,'warning');return false;}}
  function addRecord(record){records.push(record);selectedId=record.id;persist();render();notify(`${statusNames[record.status]||record.status}：${record.name}，${fmt(record.durationS,1)} s / ${record.stepCount} 个物理步`);}
  const recorder=new ExperimentRecorder({getSim,getContext,getSceneConfiguration,onFinish:addRecord,onStatus:()=>{paintStatus();onStatus();}});
  function startRecording(options={}){requireLive();if(playback)stopReplay('开始新的现场记录');recorder.start({name:options.name||$('record-name').value||'现场驾驶 / 飞行',...options});onStart({id:'live-record',name:'现场实验记录'});paintStatus();return recorder.getState();}
  function stopRecording(reason='用户结束现场记录',status='completed'){const result=recorder.finish(status,reason);paintStatus();return result;}
  function startProgramRecording(program){if(recorder.active){recorder.event('program_attached',{program:clone(program)});return false;}if(!available||!getSim()?.exportState)return false;startRecording({name:program.name,kind:'program',program});return true;}
  function finishProgram(result){recorder.event('program_result',{status:result.status,reason:result.reason,id:result.id});if(recorder.active?.kind==='program'){const recorded=stopRecording(result.reason,result.status);if(recorded)result.liveExperimentId=recorded.id;}return result;}
  function captureReturnState(){const sim=getSim();return{snapshot:sim.exportState(),context:getContext(),sceneConfiguration:clone(getSceneConfiguration()??null)};}
  function startReplay(record=selected(),{recompute=false}={}){
    requireLive();if(!record)throw Error('先选择一条完整现场记录');if(recompute)throw Error('三维按钮只执行原条件；新构建重算请使用明确的数值重算按钮');const eligible=replayEligibility(record);if(!eligible.exact)throw Error(eligible.reason);
    if(typeof onRestoreExperiment!=='function')throw Error('现场没有安装状态恢复适配器');onBeforeRestore('开始原条件重放');stopRecording('开始重放前结束本次记录','cancelled');if(playback)stopReplay('启动另一条重放');
    replaySavedContext=captureReturnState();const sim=onRestoreExperiment({snapshot:clone(record.initialSnapshot.physical),context:record.context,sceneConfiguration:clone(record.initialSnapshot.sceneConfiguration??null),allowVersionMismatch:false});
    playback=new ExperimentPlayback(record,{sim:sim||getSim(),recompute:false});replaySource=record;lastReplay=null;onStart({id:'experiment-replay',name:'按原条件重放'});paintStatus();notify('已恢复完整原始状态，正在按固定步输入重放。驾驶输入会立即接管；可返回重放前状态。');return playback.getState();
  }
  function replayResult(status,reason){
    const source=replaySource;let reproduction;
    try{reproduction=playback.reproduction({status,reason});}catch(error){reproduction={schema:'roadster.reproduction-verdict',version:1,status:'incomplete',executionStatus:status,reason:'Terminal comparison unavailable: '+error.message,completedSteps:playback.step,requestedSteps:source.stepCount};}
    return{schema:'roadster.live-replay-check',version:2,sourceId:source.id,identity:currentExperimentIdentity(),sourceIdentity:clone(source.identity),status,reason,step:playback.step,totalSteps:source.stepCount,compatibility:playback.compatibility,execution:'original-conditions-replay',reproduction,finalPositionErrorM:reproduction.terminal?.position?.error??null,note:'Input execution and reproduction agreement are separate. State/retained-curve comparison is not pixel or GPU performance evidence.'};
  }
  function stopReplay(reason='用户停止三维重放',status='cancelled'){
    if(!playback)return false;lastReplay=replayResult(status,reason);const source=replaySource;playback=null;replaySource=null;attachAnalysis(source,lastReplay);paintStatus();onCancel(reason);return true;
  }
  function attachAnalysis(record,result){if(!record)return;(record.analyses??=[]).push(result);persist();render();}
  function beforeStep(input){
    if(playback){if(hasPilotInput(input)){stopReplay('驾驶输入接管三维重放');return input;}try{const value=playback.nextInput();if(playback.finished){completeReplay();return input;}return value;}catch(error){stopReplay('重放事件执行异常：'+error.message,'failed');notify(tr('重放失败已留证：'+error.message),'error');return input;}}
    return recorder.beforeStep(input);
  }
  function completeReplay(){
    const source=replaySource;lastReplay=replayResult('completed','记录输入已执行完毕');playback=null;replaySource=null;attachAnalysis(source,lastReplay);
    const matched=lastReplay.reproduction.status==='matched';notify(tr(matched?`原条件重放复现一致，终点位置误差 ${fmt(lastReplay.finalPositionErrorM,9)} m。`:'重放执行完成，但复现未通过；请查看终态、曲线误差与首次分歧。'),matched?'success':'warning');paintStatus();
  }
  function afterStep(t,input,dt){if(playback){try{playback.afterStep(t);if(t.fault){stopReplay('物理求解异常：'+t.fault,'failed');return;}if(playback.finished)completeReplay();}catch(error){stopReplay('重放事件执行异常：'+error.message,'failed');notify(tr('重放失败已留证：'+error.message),'error');}}else recorder.afterStep(t,input,dt);}
  function recordEvent(type,detail){recorder.event(type,detail);}
  function controllerValues(){const values={};for(const field of mount.querySelectorAll('[data-ex-controller]')){if(!field.checkValidity()||!Number.isFinite(field.valueAsNumber))throw Error('B 组控制参数超出范围');values[field.dataset.exController]=field.valueAsNumber;}return validateController(values);}
  function setControllerFields(values){for(const field of mount.querySelectorAll('[data-ex-controller]'))if(field.dataset.exController in values)field.value=values[field.dataset.exController];}
  function failNumeric(currentJob,message){
    if(!currentJob||job!==currentJob)return;const launched=worker;worker=null;job=null;let reason=String(message);
    try{launched?.terminate();}catch(error){reason+='；后台执行器清理异常：'+(error.message||String(error));}
    const {source,action,controllerA,controllerB}=currentJob;attachAnalysis(source,{schema:'roadster.execution-attempt',version:1,id:currentJob.id,status:'failed',reason,sourceId:source.id,sourceStateLabel:source.initialSnapshot.stateLabel,sourceIdentity:clone(source.identity),identity:currentExperimentIdentity(),startedAt:currentJob.startedAt,finishedAt:new Date().toISOString(),failureStage:currentJob.phase,lastReportedProgress:currentJob.lastReportedProgress??null,action,controllerA,controllerB});
    $('job-state').textContent='执行失败已留证：'+reason;notify(reason,'error');paintStatus();
  }
  function runNumeric(action){
    const source=selected();if(!source)throw Error('先选择一条现场记录');if(worker||job)throw Error('请等待或停止当前数值执行');const eligibility=replayEligibility(source);if(action==='numeric-replay'&&!eligibility.exact||action!=='numeric-replay'&&!eligibility.recompute)throw Error(eligibility.reason);
    const WorkerCtor=doc.defaultView?.Worker??globalThis.Worker;if(!WorkerCtor)throw Error('浏览器不支持后台 Worker；历史查看与导出仍可用');
    const controllerB=action==='compare'?controllerValues():null,controllerA=action==='compare'?Object.fromEntries(CONTROLLER_FIELDS.map(([key,,,,,,fallback])=>[key,source.initialSnapshot.physical.params[key]??fallback])):null;
    if(action==='compare'&&!Object.keys(controllerB).some(k=>controllerB[k]!==controllerA[k]))throw Error('A 与 B 相同。修改 B 的一个或多个控制器参数后运行');
    const currentJob=job={id:'execution-'+Date.now().toString(36)+'-'+(++serial),source,action,startedAt:new Date().toISOString(),controllerA,controllerB,phase:'constructing-worker'};
    try{
      const launched=worker=new WorkerCtor(new URL('./experiment-replay-worker.js',import.meta.url),{type:'module'});
      launched.onmessage=({data})=>{if(job!==currentJob||worker!==launched||data.id!==currentJob.id)return;if(data.type==='progress'){currentJob.lastReportedProgress=clone(data.progress);$('job-state').textContent=`${data.progress.case?'组 '+data.progress.case+' · ':''}${data.progress.step}/${data.progress.totalSteps} 步`;return;}if(data.type==='error'){failNumeric(currentJob,data.error);return;}if(data.type==='result'){attachAnalysis(source,{...data.result,id:currentJob.id,startedAt:currentJob.startedAt});launched.terminate();worker=null;job=null;const verdictLabel={matched:'复现一致',diverged:'复现有分歧',incomplete:'未完成复现比较',insufficient_evidence:'证据不足，不能确认复现',not_applicable:'当前模型对照 / 不要求复现一致'}[data.result.reproduction?.status]||'当前模型对照 / 不要求复现一致';$('job-state').textContent=`数值${data.result.status==='completed'?'执行完成':'执行结束'} · ${statusNames[data.result.status]||data.result.status} · ${verdictLabel} · 结果已留证`;paintStatus();}};
      launched.onerror=event=>failNumeric(currentJob,event.message||'后台数值执行器错误');currentJob.phase='posting-request';$('job-state').textContent='数值执行中 · 同快照 / 同扰动 / 同输入';paintStatus();
      launched.postMessage({id:currentJob.id,action:action==='compare'?'compare':'replay',record:source,recompute:action!=='numeric-replay',controllerA,controllerB});if(job===currentJob)currentJob.phase='running';
    }catch(error){failNumeric(currentJob,error.message||String(error));}
  }
  function stopJob(){if(!worker||!job)return false;const currentJob=job;try{currentJob.phase='requesting-cancel';worker.postMessage({action:'cancel',id:currentJob.id});if(job===currentJob)$('job-state').textContent='正在停止 · 将保留已计算步数和取消原因';}catch(error){failNumeric(currentJob,error.message||String(error));}return true;}
  function drawPlot(){
    const canvas=$('plot'),g=canvas.getContext('2d');if(!g)return;const record=selected(),analysis=record?.analyses?.at(-1),series=analysis?.baseline?[{label:'A',samples:analysis.baseline.samples||[]},{label:'B',samples:analysis.candidate?.samples||[]}]:analysis?.samples?[{label:'原记录',samples:record.samples},{label:'数值复算',samples:analysis.samples}]:record?[{label:'原记录',samples:record.samples}]:[];const w=canvas.width,h=canvas.height,L=57,R=w-19,T=24,B=h-31;g.clearRect(0,0,w,h);g.fillStyle='#0b1821';g.fillRect(0,0,w,h);g.font='15px Consolas,monospace';const values=series.flatMap(s=>s.samples.map(row=>row[plotKey])).filter(Number.isFinite);if(!values.length){g.fillStyle='#a7bbc7';g.fillText(tr('选择记录后显示已保存的响应'),L,120);return;}let lo=Math.min(...values),hi=Math.max(...values),pad=Math.max(.05,(hi-lo)*.1);lo-=pad;hi+=pad;const end=Math.max(1,...series.flatMap(s=>s.samples.map(row=>row.timeS)));g.strokeStyle='#31454f';g.fillStyle='#9fb8c4';g.lineWidth=1;for(let i=0;i<4;i++){const y=B-(B-T)*i/3;g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();g.fillText(fmt(lo+(hi-lo)*i/3,1),3,y+4);}series.forEach((s,i)=>{g.strokeStyle=['#9ee2c9','#e3b679'][i%2];g.beginPath();g.lineWidth=2.5;let connected=false;for(const row of s.samples){if(!Number.isFinite(row[plotKey])){connected=false;continue;}const x=L+(R-L)*row.timeS/end,y=B-(row[plotKey]-lo)/(hi-lo)*(B-T);if(connected)g.lineTo(x,y);else g.moveTo(x,y);connected=true;}g.stroke();g.fillStyle=g.strokeStyle;g.fillText(tr(s.label),L+i*210,17);});g.fillStyle='#9fb8c4';g.fillText('0 s',L,h-6);g.fillText(fmt(end,1)+' s',R-55,h-6);
  }
  function render(){
    paintPersistence();const record=selected();if(record)selectedId=record.id;$('record-count').textContent=records.length+' 项';$('record-select').innerHTML=records.length?records.slice().reverse().map(r=>`<option data-no-i18n value="${esc(r.id)}"${r.id===selectedId?' selected':''}>${esc(r.name)} · ${esc(tr(statusNames[r.status]||r.status))} · ${fmt(r.durationS,1)} s</option>`).join(''):'<option value="">尚无现场记录</option>';
    $('identity').textContent=record?`${record.identity.modelVersion} / ${record.identity.modelBuildId.slice(0,12)} / ${record.identity.protocolVersion} · ${record.context==='lab'?'实验室':'城市'} · 初始 simTime ${fmt(record.initialSnapshot.initialSimTime,6)} s · ${record.initialSnapshot.stateLabel}`:'原条件重放使用完整快照；仅程序名称相同不能证明工况相同。';
    $('sampling').textContent=record?`${record.sampling.decimated?'历史展示曲线已抽稀':'完整采样曲线'} · ${record.sampling.storedCount}/${record.sampling.rawCount} 点；${record.sampling.uniform&&record.sampling.storedIntervalS?`当前点间隔 ${fmt(record.sampling.storedIntervalS,4)} s`:'点间隔不均匀，以 timeS 为准'}。指标来源：全部 ${record.summary.count} 个 120 Hz 物理步。`:'';
    $('replay-eligibility').textContent=record?replayEligibility(record).reason:'';
    const analysis=record?.analyses?.at(-1),summaries=analysis?.baseline?[['A',analysis.baseline.summary],['B',analysis.candidate?.summary]]:analysis?.summary?[['原记录',record.summary],['复算',analysis.summary]]:record?[['原记录',record.summary]]:[];
    const metrics=[['位置 RMS / m','rmsPositionErrorM'],['位置峰值 / m','peakPositionErrorM'],['姿态峰值 / °','peakAttitudeErrorDeg'],['最低高度 / m','minimumHeightM'],['最高速度 / m/s','peakSpeedMps'],['喷口总通过量 / kg','gasThroughputKg'],['车载排出气量 / kg','onboardDischargedKg'],['外供气量 / kg','externalSupplyKg']];
    $('comparison').innerHTML=summaries.length?`<table><thead><tr><th>固定步统计</th>${summaries.map(([name])=>`<th>${esc(name)}</th>`).join('')}</tr></thead><tbody>${metrics.map(([label,key])=>`<tr><th>${label}</th>${summaries.map(([,s])=>`<td>${fmt(s?.[key],3)}</td>`).join('')}</tr>`).join('')}</tbody></table>${analysis?`<p class="rc-help">${esc(analysis.status)} · ${esc(analysis.reason||analysis.conditions||analysis.note||'数值执行结果')} ${analysis.changed?'声明差异：'+esc(analysis.changed.join(', ')):''}</p>`:''}`:'';
    $('details').textContent=record?JSON.stringify({identity:record.identity,startedAt:record.startedAt,status:record.status,reason:record.reason,initialState:record.initialSnapshot.physical,initialSceneConfiguration:record.initialSnapshot.sceneConfiguration??null,finalSceneConfiguration:record.finalSnapshot.sceneConfiguration??null,sceneConfigurationScope:record.initialSnapshot.sceneConfigurationScope??'未保存视景配置',events:record.events,summary:record.summary,sampling:record.sampling,lastAnalysis:analysis?{identity:analysis.identity,sourceIdentity:analysis.sourceIdentity,status:analysis.status,completedSteps:analysis.completedSteps,requestedSteps:analysis.requestedSteps,execution:analysis.execution,compatibility:analysis.compatibility,reproduction:analysis.reproduction}:null},null,2):'记录后可查看完整原始条件。';
    for(const el of buttons('export-protected'))el.hidden=!protectedRaw;renderReproduction(analysis);drawPlot();paintStatus();localizeTree(mount);
  }
  function renderReproduction(analysis){
    const verdict=analysis?.reproduction;if(!verdict)return;
    const names={matched:'复现一致',diverged:'执行完成，复现有分歧',incomplete:'执行未完成，不能确认复现',not_applicable:'当前模型 / 控制器重算，不要求复现一致',insufficient_evidence:'证据不足，不能确认复现'};
    const section=doc.createElement('section');section.className='rc-reproduction';section.dataset.verdict=verdict.status;section.dataset.reproduction=JSON.stringify(verdict);
    const heading=doc.createElement('h4');heading.textContent=tr(names[verdict.status]||verdict.status);section.append(heading);
    const rows=[['位置','position'],['速度','velocity'],['姿态','attitude'],['角速度','angularVelocity'],['气量','gasMass'],['罐温','tankTemperature'],['轮速','wheelOmega']];
    if(verdict.terminal){const table=doc.createElement('table');table.innerHTML=`<thead><tr><th>${tr('终态量')}</th><th>${tr('实际误差')}</th><th>${tr('容差')}</th></tr></thead><tbody>${rows.map(([label,key])=>{const m=verdict.terminal[key];return`<tr><th>${tr(label)}</th><td>${m?.error===null?'—':Number(m?.error).toExponential(3)} ${m?.unit||''}</td><td>${m?.tolerance??'—'} ${m?.unit||''}</td></tr>`;}).join('')}</tbody>`;section.append(table);}
    const coverage=doc.createElement('p');coverage.className='rc-help';coverage.textContent=tr(`曲线比较 ${verdict.sampling?.comparedSamples??0} / ${verdict.sampling?.referenceStoredSamples??0} 个已存时刻；只比较相同步，不插值补造历史。控制状态在终点比较。`);section.append(coverage);
    if(verdict.controller){const control=doc.createElement('p'),c=verdict.controller;control.className='rc-help';control.textContent=tr(c.comparedAtSourceTerminal?`控制状态：${c.comparedScalars} 个数值、${c.comparedDiscrete} 个离散值；最大连续误差 / 容差 ${fmt(c.maxNormalizedError,3)}；缺失 ${c.missingFields.length} 项。`:'控制状态尚未到原记录终点，未作终态比较。');section.append(control);if(c.missingFields.length){const missing=doc.createElement('code');missing.textContent=c.missingFields.join(', ');section.append(missing);}}
    if(verdict.firstDivergence){const d=verdict.firstDivergence,line=doc.createElement('p');line.className='rc-help rc-error';line.textContent=tr(`首次可观测分歧：第 ${d.step} 步 / ${fmt(d.timeS,6)} s · ${d.scope} · ${d.channel} · 误差 ${d.error===null?'状态不同':d.error}，容差 ${d.tolerance}。`);section.append(line);}
    if(verdict.status==='not_applicable'){const line=doc.createElement('p');line.className='rc-help';line.textContent=tr('误差仅用于描述相对历史响应的变化；当前模型与原模型不同，或控制器参数已声明改变。');section.append(line);}
    $('comparison').append(section);
  }
  function paintStatus(){
    const state=recorder.getState();$('record-state').textContent=state.recording?`● 记录中 · ${fmt(state.durationS,1)} / 300 s · ${state.eventCount} 条事件`:playback?`▶ 三维重放 · ${playback.step}/${playback.record.stepCount} 步`:'未记录 · 开始记录不会重置车辆、气量或风场';
    for(const el of mount.querySelectorAll('[data-ex-live]'))el.disabled=!available||!getLiveAvailable();for(const el of buttons('record'))el.disabled=!available||state.recording||!!playback;
    for(const el of buttons('stop-record'))el.disabled=!state.recording;for(const el of buttons('stop-replay'))el.disabled=!playback;for(const el of buttons('return-before-replay'))el.disabled=!available||!replaySavedContext;for(const el of buttons('stop-job'))el.disabled=!worker;
    const eligible=selected()?replayEligibility(selected()):null;for(const key of ['replay','numeric-replay'])for(const el of buttons(key))el.disabled=!eligible?.exact||key==='replay'&&!available||!!worker&&key==='numeric-replay';for(const key of ['compare','recompute'])for(const el of buttons(key))el.disabled=!eligible?.recompute||!!worker;
  }
  function setLiveAvailable(value,reason=''){available=!!value;unavailableReason=reason;if(!available){stopRecording('现场图形不可用：'+reason,'failed');stopReplay('现场图形不可用：'+reason,'failed');}$('availability').hidden=available;$('availability').textContent=reason||'三维现场不可用；历史、导出与后台数值研究可继续。';paintStatus();}
  function update(t){paintStatus();if(!t)return;const config=t.observation?.configuration,fault=t.nozzleFault;$('fault-status').textContent=`观测：${config?.enabled?`${config.delayMs} ms / 种子 ${config.seed}`:'无延迟 / 无噪声'}；喷口：${fault?`${fault.id} 可用 ${(fault.scale*100).toFixed(0)}%`:'正常'}。`;
    // Dropdown IDs follow the physical solver instead of assuming artwork order.
    const ids=(t.nozzles||[]).filter(n=>n.kind==='lift').map(n=>n.id);if(ids.length&&$('fault-id').options[0]?.value!==ids[0])$('fault-id').innerHTML=ids.map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('');}
  async function perform(action){try{
    if(action==='record')startRecording();else if(action==='stop-record')stopRecording();else if(action==='replay')startReplay();else if(action==='stop-replay')stopReplay();else if(action==='stop-job')stopJob();
    else if(action==='return-before-replay'){requireLive();if(!replaySavedContext)throw Error('没有重放前状态');onBeforeRestore('返回重放前状态');stopRecording('返回重放前结束本次记录','cancelled');stopReplay('返回重放前状态');const previous=replaySavedContext;onRestoreExperiment({snapshot:clone(previous.snapshot),context:previous.context,sceneConfiguration:clone(previous.sceneConfiguration??null),allowVersionMismatch:false});replaySavedContext=null;notify('已恢复重放前的完整现场状态与视景配置；原有流程和记录已结束留证。');}
    else if(['numeric-replay','recompute','compare'].includes(action))runNumeric(action);
    else if(action==='copy-source-controller'){if(!selected())throw Error('先选择记录');setControllerFields(selected().initialSnapshot.physical.params);notify('B 已读取原记录参数；修改后再运行公平 A/B。');}
    else if(action==='copy-draft-controller'){setControllerFields(getControllerDraft());notify('B 已读取控制面板输入值；现场车辆参数未改变。');}
    else if(action==='apply-observation'||action==='reset-observation'){requireLive();let config={enabled:false};if(action==='apply-observation'){config.enabled=$('observation-enabled').checked;for(const field of mount.querySelectorAll('[data-ex-observation]')){if(!field.checkValidity())throw Error('观测参数超出范围');config[field.dataset.exObservation]=field.valueAsNumber;}}if(getSim().setObservation(config)===false)throw Error('测量模型参数无效');notify('测量模型已应用；控制器将使用统一观测接口。');update(getSim().telemetry());}
    else if(action==='apply-fault'||action==='clear-fault'){requireLive();if(action==='clear-fault')getSim().clearNozzleFault();else{if(!$('fault-scale').checkValidity())throw Error('降额比例必须在 0–1');if(getSim().setNozzleFault({id:$('fault-id').value,scale:$('fault-scale').valueAsNumber})===false)throw Error('喷口 ID / 降额比例无效');}notify('喷口能力已更新，推力分配与气源消耗继续由物理模型计算。');update(getSim().telemetry());}
    else if(action==='export-all')exportJson(()=>({...exportExperimentArchive(records.slice()),persistence:persistence.snapshot(),protectedRaw}),'roadster-live-experiments-all.json',{doc});
    else if(action==='export-one'||action==='export-csv'){const record=selected();if(!record)throw Error('先选择记录');if(action==='export-csv')download(()=>'\uFEFF'+experimentCSV(record),record.id+'.csv','text/csv;charset=utf-8');else exportJson(()=>record,record.id+'.json',{doc});}
    else if(action==='export-protected'&&protectedRaw)download(protectedRaw,'roadster-live-protected-archive.json');
    else if(action==='delete-selected'){if(recorder.active||playback||worker)throw Error('请先结束正在记录或执行的试验');const record=selected();if(!record)return;if(protectedRaw)throw Error('原存档受保护，请先导出并修复，当前不覆盖旧数据');const candidate=records.filter(r=>r.id!==record.id),expectedRaw=diskRaw;try{saveExperimentArchive(storage,candidate,{protectedRaw,replace:true,expectedRaw});}catch(error){persistence.failed(error);paintPersistence();throw error;}records=candidate;selectedId=records.at(-1)?.id??null;diskRaw=storage.getItem(EXPERIMENT_LIBRARY_KEY);persistence.saved();render();notify('已删除选中的现场记录。');}
    paintStatus();
  }catch(error){notify(error.message,'error');}}
  const click=event=>{const target=event.target.closest('[data-ex-action]');if(target){event.stopPropagation();perform(target.dataset.exAction);}},change=event=>{if(event.target===$('record-select')){selectedId=event.target.value;render();}else if(event.target===$('plot-channel')){plotKey=event.target.value;drawPlot();}};
  const importFile=async event=>{try{const file=event.target.files?.[0];if(!file)return;if(file.size>EXPERIMENT_LIMITS.importBytes)throw Error('归档必须小于 12 MiB');const imported=parseExperimentArchive(await file.text()),merged=new Map(records.map(r=>[r.id,r]));for(const r of imported){const old=merged.get(r.id);if(old&&contentLabel(old)!==contentLabel(r))throw Error('同 ID 的记录内容不同，拒绝静默覆盖：'+r.id);merged.set(r.id,r);}records=[...merged.values()];selectedId=imported.at(-1)?.id??selectedId;persist();render();notify('已合并导入记录。原始身份保留，未自动执行任何内容。');}catch(error){notify(error.message,'error');}finally{event.target.value='';}};
  const pagehide=()=>{stopRecording('页面离开，自动保留已完成的记录','cancelled');stopReplay('页面离开');if(worker){attachAnalysis(job.source,{schema:'roadster.execution-attempt',version:1,id:job.id,status:'cancelled',reason:'页面离开；保留最后报告的进度，未声称未返回的工作量已经保存',lastReportedProgress:job.lastReportedProgress??null,identity:currentExperimentIdentity(),sourceIdentity:clone(job.source.identity)});worker.terminate();worker=null;job=null;}};doc.defaultView?.addEventListener('pagehide',pagehide);
  const stopLanguage=onLanguageChange(()=>{render();if(getSim())update(getSim().telemetry());});mount.addEventListener('click',click);mount.addEventListener('change',change);$('import').addEventListener('change',importFile);render();if(loaded.warning)notify(loaded.warning,'warning');
  return{startRecording,stopRecording,startProgramRecording,finishProgram,startReplay,stopReplay,beforeStep,afterStep,recordEvent,setLiveAvailable,update,
    stopAll(reason='用户停止研究'){const recorded=stopRecording(reason,'cancelled'),replayed=stopReplay(reason),numeric=stopJob();return!!recorded||replayed||numeric;},
    onContextChange(){stopRecording('场景切换','cancelled');stopReplay('场景切换');update(getSim()?.telemetry?.());},
    getState:()=>({...recorder.getState(),...(playback?.getState()||{replaying:false}),recordCount:records.length,selectedId,persistence:persistence.snapshot(),numericRunning:!!worker,numericJob:job?{id:job.id,action:job.action}:null,lastReplay,liveAvailable:available}),
    getRecords:()=>records.map(r=>clone(r)),
    dispose(){if(disposed)return;disposed=true;stopLanguage();doc.defaultView?.removeEventListener('pagehide',pagehide);stopRecording('控制台关闭','cancelled');stopReplay('控制台关闭');if(worker){attachAnalysis(job.source,{schema:'roadster.execution-attempt',version:1,status:'cancelled',reason:'页面关闭数值执行器',identity:currentExperimentIdentity(),sourceIdentity:clone(job.source.identity),id:job.id});worker.terminate();worker=null;}mount.removeEventListener('click',click);mount.removeEventListener('change',change);$('import').removeEventListener('change',importFile);},
  };
}
