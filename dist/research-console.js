import {exportJson,exportFile} from './export-download.js';
import './research-i18n-3.14.js';
import {WIND_LAB_DIMENSIONS} from './wind-lab-data.js';
import {createLandingResearchPanel} from './landing-research-ui.js';
import {PersistenceState} from './research-storage.js';
import {compareConditions} from './research-comparison.js';
import {createExperimentConsole} from './experiment-console.js';
import {getLanguage,t as tr,onLanguageChange,localizeTree} from './i18n.js';
import {
  FlightProgramRunner,CONTROLLER_FIELDS,PROGRAM_SHORTCUTS,PROGRAM_LIMITS,RATE_LIMITS,
  defaultStage,defaultProgramLibrary,validateProgram,validateProgramLibrary,
  validateController,validateWind,parseProgramLibrary,loadProgramLibrary,
  saveProgramLibrary,loadResults,loadResultArchive,saveResults,quaternionFromAttitude,
  quaternionErrorDeg,resultCSV,
} from './flight-programs.js';

const copy=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const f=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'—';
const select=(values,value)=>values.map(([v,label])=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(label)}</option>`).join('');
const stageNames={pose:'位置 / 姿态参考',wait:'保持前一指令',rate:'连续角速度指令',roll:'自动翻转并返回',land:'自动着陆',wind:'改变风场'};
const statusNames={completed:'流程完成',cancelled:'已接管 / 停止',failed:'未完成',timeout:'超时'};
const builtinProgramNames=new Map(defaultProgramLibrary().programs.map(p=>[p.id,p.name]));
// A translated preset title is presentation. A renamed/user procedure remains
// byte-for-byte as entered, including when it happens to contain UI words.
const programName=p=>builtinProgramNames.get(p.programId??p.id)===p.name?tr(p.name):p.name;
const flowDefault={speedMps:0,directionDeg:90,gustMps:0,gustPeriodS:4};
const input=(label,value,attrs='')=>`<label class="rc-field"><span>${label}</span><input type="number" value="${esc(value)}" ${attrs}></label>`;
const button=(action,label,cls='')=>`<button type="button" data-rc-action="${action}" class="${cls}">${label}</button>`;

/** Same DOM, same viewport, two physical scene contexts supplied by main.js.
 * Only public simulation control APIs are called by this research surface. */
export function createResearchConsole({mount=document.body,getSim,getContext=()=> 'city',getSceneConfiguration=()=>null,onEnterLab=()=>{},onReturnCity=()=>{},onOpenStudy=()=>{},onEvent=()=>{},onToast=()=>{},onBeforeRun=()=>{},onStart=()=>{},onCancel=()=>{},getLiveAvailable=()=>true,onRestoreExperiment}={}){
  const doc=mount.ownerDocument||document;let liveAvailable=getLiveAvailable(),liveReason='';
  let storage;try{storage=doc.defaultView?.localStorage;}catch{storage=null;}
  const loaded=loadProgramLibrary(storage),loadedResults=loadResultArchive(storage);let library=loaded.library,results=loadedResults.results;const programPersistence=new PersistenceState(loaded.warning||'',loaded.protectedRaw),resultPersistence=new PersistenceState(loadedResults.warning||'',loadedResults.protectedRaw);let pendingImport=null;
  let draft=copy(library.programs[0]),selectedId=draft.id,tab='controls',opened=false,lastPaint=-Infinity,lastLiveSample=-Infinity,liveSamples=[],plotMetric='height',workspace='operate',observing=false;
  let message=loaded.warning||'',messageKind=loaded.warning?'warning':'',latestFullResult=null,selectedResults=results.slice(-2).map(r=>r.id),disposed=false;
  const shell=doc.createElement('section');shell.className='research-console';shell.hidden=true;shell.setAttribute('aria-label','风场研究控制台');
  shell.innerHTML=`
    <header class="rc-header"><div class="rc-emblem" aria-hidden="true">R<span>LAB</span></div><div><p>ROADSTER / RESEARCH</p><h2>风场实验室</h2></div><button type="button" data-rc-action="close" class="rc-close" aria-label="收起研究控制台">×</button></header>
    <nav class="rc-workspaces" data-no-i18n aria-label="Research workspace"><button type="button" data-rc-workspace="operate"></button><button type="button" data-rc-workspace="analyze"></button><button type="button" data-rc-action="observe"></button></nav><div class="rc-context"><span data-rc="context">城市 · 现场试验</span><button type="button" data-rc-action="context" data-rc="context-button">进入风场实验室 ↗</button></div>
    <p class="rc-help" data-rc="space-warning" role="status"></p>
    <nav class="rc-tabs" aria-label="研究项目"><button type="button" data-rc-tab="controls" aria-selected="true">控制与风场</button><button type="button" data-rc-tab="programs" aria-selected="false">自动流程</button><button type="button" data-rc-tab="results" aria-selected="false">流程结果</button><button type="button" data-rc-tab="experiments" aria-selected="false">记录与重放</button><button type="button" data-rc-tab="landing" aria-selected="false">控制律 / 着陆</button></nav>
    <div class="rc-message" role="status" data-rc="message" hidden></div><div class="rc-message" role="alert" data-rc="persistence" data-kind="warning" hidden></div><div class="rc-button-row">${button('export-protected','导出受保护流程原存档')}${button('export-session','导出当前会话完整研究成果')}</div>
    <div class="rc-body"><section data-rc-panel="landing" hidden></section>
      <section data-rc-panel="controls">
        <div class="rc-section-title"><h3>实际状态 <span>SIMULATION</span></h3><span class="rc-state-pill" data-rc="feasibility">待采样</span></div>
        <div class="rc-telemetry"><div><span>世界高度</span><strong data-rc="height">—</strong><small>m</small></div><div><span>俯仰</span><strong data-rc="pitch">—</strong><small>°</small></div><div><span>滚转</span><strong data-rc="roll">—</strong><small>°</small></div></div>
        <div class="rc-target-line" data-rc="target-line">参考值与实际值分开显示；改变目标后由喷口闭环跟踪。</div><div class="rc-target-line rc-target-attitude" data-rc="target-attitude"></div>
        <section class="rc-section">
          <h3>定姿与定点</h3><p class="rc-help">捕获当前测量值，或设置下面的世界坐标与姿态。位置单位 m，角度单位 °。姿态不可配平时仍按实际受力运动。</p>
          <div class="rc-button-row">${button('capture','捕获当前姿态并保持','rc-primary')}${button('read-pose','读取到下方')}</div>
          <div class="rc-grid rc-grid-3">
            ${input('世界 X',0,'data-rc-pose="x" min="-1000" max="1000" step="0.1"')}${input('世界 Y / 高度',3,'data-rc-pose="y" min="0.4" max="200" step="0.1"')}${input('世界 Z',0,'data-rc-pose="z" min="-1000" max="1000" step="0.1"')}
            ${input('俯仰 / 机头上仰 +',0,'data-rc-pose="pitch" min="-180" max="180" step="1"')}${input('滚转 / Z 方向 +',0,'data-rc-pose="roll" min="-180" max="180" step="1"')}${input('世界航向',0,'data-rc-pose="heading" min="-360" max="360" step="1"')}
          </div>
          <div class="rc-button-row">${button('apply-pose','应用自定义目标','rc-primary')}${button('pose-program','存成快捷动作')}${button('release','释放研究保持')}</div>
          <p class="rc-help">驾驶键随时接管。G 在城市里仅切换自动平稳；定姿定点保留在研究控制台。</p>
        </section>
        <section class="rc-section">
          <h3>解析风场</h3><div class="rc-grid">
            ${input('平均风速 · m/s',0,'data-rc-wind="speedMps" min="0" max="30" step="0.5"')}${input('气流去向 · °',90,'data-rc-wind="directionDeg" min="0" max="360" step="5"')}
            ${input('正弦阵风幅值 · m/s',0,'data-rc-wind="gustMps" min="0" max="20" step="0.5"')}${input('阵风周期 · s',4,'data-rc-wind="gustPeriodS" min="0.5" max="60" step="0.5"')}
          </div><div class="rc-button-row">${button('apply-wind','施加风场')}${button('clear-wind','恢复静风')}${button('wind-program','存成风场动作')}</div>
          <p class="rc-help">流向 0° → 世界 +Z，90° → +X。风速按仿真时间正弦变化且下限为 0。这里使用解析风与刚体气动模型，不计算 CFD 流场。</p>
        </section>
        <details class="rc-section rc-details"><summary>控制器增益与速率限制 <span>实时生效</span></summary><p class="rc-help">位置 / 速度反馈与姿态角速度反馈共同驱动有界喷口。增益过高可能产生超调；推力与阀门响应仍有限。</p><div class="rc-grid">${CONTROLLER_FIELDS.map(([key,label,min,max,step,unit,value])=>input(`${label} · ${unit}`,value,`data-rc-param="${key}" min="${min}" max="${max}" step="${step}"`)).join('')}</div><div class="rc-button-row">${button('apply-controller','应用参数','rc-primary')}${button('save-controller','保存为我的参数')}${button('load-controller','载入已保存参数')}${button('defaults-controller','恢复默认')}</div></details>
        <section class="rc-section"><h3>进一步研究</h3><p class="rc-help">在同一仿真页面开展参数扫描、成对对照与批量数值试验，保留结果库和完整研究参数。</p>${button('study','参数扫描与配对研究 ↗')}</section>
      </section>
      <section data-rc-panel="programs" hidden>
        <div class="rc-section-title"><h3>我的自动流程</h3><span>3–9 可绑定</span></div>
        <label class="rc-field rc-full"><span>已保存流程</span><select data-rc="program-select"></select></label>
        <div class="rc-button-row rc-small-buttons">${button('new','新建')}${button('duplicate','复制当前')}${button('delete','删除')}</div>
        <div class="rc-grid"><label class="rc-field"><span>名称</span><input type="text" maxlength="42" data-rc="program-name"></label><label class="rc-field"><span>快捷键 / 城市与实验室通用</span><select data-rc="program-shortcut"></select></label><label class="rc-field"><span>开始时供气</span><select data-rc="program-supply">${select([['inherit','沿用当前'],['bench','外部持续供气'],['finite','有限储气']], 'inherit')}</select></label><div class="rc-program-total"><span>总时长上限</span><strong data-rc="program-total">— s</strong></div></div>
        <p class="rc-help">位置偏移相对流程开始时的世界坐标；自定义航向为起始航向的增量。保持原姿态会保留完整起始四元数。角速度阶段可连续转过 360°。</p>
        <div class="rc-stage-list" data-rc="stages"></div>
        <div class="rc-button-row">${button('add-stage','＋ 添加阶段')}${button('save-program','保存流程与快捷键','rc-primary')}</div>
        <div class="rc-program-actions">${button('run','运行当前流程','rc-run')}${button('stop','停止 / 驾驶接管','rc-stop')}</div>
        <p class="rc-help">运行使用当前编辑值；快捷键使用已保存值。翻转、着陆及“达到稳定”阶段都检查真实完成条件，超时会终止。设置参数不会自动补满气瓶。流程结束后恢复原供气与风场；空中的最终参考继续由物理控制器保持。</p>
        <details class="rc-section"><summary>导入 / 导出流程库</summary><p class="rc-help">带版本的 JSON，包含所有流程、快捷键和保存的控制参数。导入仅替换配置库，不会自动执行或改变车辆状态。</p><div class="rc-button-row">${button('export-programs','导出 JSON')}<label class="rc-file-button">导入 JSON<input type="file" accept=".json,application/json" data-rc="import-programs"></label></div></details>
      </section>
      <section data-rc-panel="results" hidden>
        <div class="rc-section-title"><h3>实时响应</h3><select data-rc="plot-metric" aria-label="图表指标"><option value="height">实际 / 目标高度</option><option value="position">位置跟踪误差</option><option value="attitude">姿态跟踪误差</option></select></div>
        <canvas data-rc="plot" width="720" height="280" aria-label="以仿真时间为横轴的响应曲线"></canvas>
        <div class="rc-plot-key"><span><i></i>实际 / 误差</span><span><i class="target"></i>高度参考</span><span>20 Hz · 仿真时间</span></div>
        <div class="rc-metrics"><div><span>位置误差</span><b data-rc="position-error">— m</b></div><div><span>姿态误差</span><b data-rc="attitude-error">— °</b></div><div><span>推力分配残差</span><b data-rc="allocation">—</b></div><div><span>喷口总质量流量</span><b data-rc="flow">— kg/s</b></div></div>
        <p class="rc-help">稳定判据：位置误差 &lt; 0.35 m、姿态误差 &lt; 3°、速度 &lt; 0.4 m/s、角速度 &lt; 5°/s，且无推力不足。阶段中“稳定保持时间”指定持续时长。误差超标会如实保留，不代表试验通过。</p>
        <div class="rc-section-title"><h3>试验记录与比较</h3><span data-rc="result-count">0 / 16</span></div>
        <div data-rc="results" class="rc-result-list"></div><div data-rc="comparison" class="rc-comparison"></div>
        <div class="rc-button-row">${button('export-results-all','流程结果整库 JSON')}${button('export-result','选中流程 JSON')}${button('export-csv','选中流程 CSV')}</div>
        <p class="rc-help">流程结果最多持久化 16 条，达到上限后保留旧记录；新增结果可在当前会话导出。历史曲线最多 181 点，采样时间以 timeS 为准。完整现场初态、实际输入与原条件重放请使用“记录与重放”。</p>
      </section>
      <section data-rc-panel="experiments" hidden></section>
    </div>
    <footer class="rc-footer"><span data-rc="run-status">就绪 · 驾驶键可随时接管</span><button type="button" data-rc-action="stop">停止流程</button></footer>`;
  const chip=doc.createElement('div');chip.className='rc-running-chip';chip.hidden=true;chip.innerHTML='<button type="button" data-rc-action="show-running"><b>研究流程</b><span data-rc="chip-status"></span></button><button type="button" data-rc-action="stop" aria-label="停止研究流程">停止</button>';
  mount.append(shell,chip);
  const $=name=>shell.querySelector(`[data-rc="${name}"]`),$$=query=>Array.from(shell.querySelectorAll(query));
  const notify=(text,kind='info')=>{message=text;messageKind=kind;$('message').textContent=text;$('message').dataset.kind=kind;$('message').hidden=!text;if(text)onToast(text,kind==='error'?7000:4200);};
  let experiments=null,landing=null;
  const runner=new FlightProgramRunner({getSim,getContext,onEvent,onStart,onFinish(result){
    experiments?.finishProgram(result);latestFullResult=result;results.push(result);selectedResults=results.slice(-2).map(r=>r.id);
    try{saveResults(storage,results,{protectedRaw:loadedResults.protectedRaw});resultPersistence.saved();}catch(error){resultPersistence.failed(error,[result.id]);notify(error.message+'；请导出流程结果整库。','warning');}paintPersistence();
    renderResults();paintStatus();notify(`${statusNames[result.status]}：${result.reason}`,result.status==='completed'?'info':result.status==='cancelled'?'info':'warning');
  }});
  experiments=createExperimentConsole({mount:shell.querySelector('[data-rc-panel="experiments"]'),getSim,getContext,getSceneConfiguration,getLiveAvailable:()=>liveAvailable&&getLiveAvailable(),onRestoreExperiment,onBeforeRestore:reason=>{if(runner.cancel(reason))onCancel(reason);},onStart,onCancel,onStatus:()=>paintStatus(),notify,getControllerDraft:localControllerValues,storage});
  landing=createLandingResearchPanel({mount:shell.querySelector('[data-rc-panel="landing"]'),getSim,getLiveAvailable:()=>liveAvailable&&getLiveAvailable(),onRestoreExperiment,onBeforeStart:()=>{runner.cancel('开始抗扰着陆挑战');experiments.stopAll('开始抗扰着陆挑战');},onStart,onCancel,notify,storage,onPresentationChange:mode=>{if(mode==='observe')observe();else setWorkspace('analyze');}});
  function requireLive(){if(!liveAvailable||!getLiveAvailable()||!getSim())throw new Error(liveReason||'三维现场不可用；仍可查看历史、导出与运行数值研究');}
  function download(content,name,type='application/json'){return exportFile(content,name,type,{doc});}
  function paintPersistence(){const states=[['流程配置',programPersistence.snapshot()],['流程结果',resultPersistence.snapshot()]],failures=states.filter(([,s])=>s.sessionOnly);$('persistence').hidden=!failures.length;$('persistence').textContent=failures.map(([label,s])=>label+'：仅本会话 / 未保存。'+s.message).join('\n');$('persistence').dataset.persistence=JSON.stringify(Object.fromEntries(states));for(const b of $$('[data-rc-action="export-protected"]'))b.hidden=!loaded.protectedRaw&&!loadedResults.protectedRaw;localizeTree($('persistence'));}
  function persist(candidate=library){try{const saved=saveProgramLibrary(storage,candidate,{protectedRaw:loaded.protectedRaw,expectedRaw:loaded.raw});library=saved;loaded.raw=storage.getItem('roadster-flight-programs-v1');programPersistence.saved();paintPersistence();return saved;}catch(error){programPersistence.failed(error);paintPersistence();throw error;}}
  function fieldNumbers(selector,keyName){const values={};for(const el of $$(selector)){const value=el.valueAsNumber;if(!Number.isFinite(value)||!el.checkValidity())throw new Error(`${el.closest('label')?.querySelector('span')?.textContent||keyName} 超出范围或不是有效数字`);values[el.dataset[keyName]]=value;}return values;}
  function readCurrentPose(){
    const t=getSim()?.telemetry?.();if(!t)return;const values={x:t.position.x,y:t.position.y,z:t.position.z,pitch:t.pitchDeg,roll:t.rollDeg,heading:t.headingDeg};
    for(const el of $$('[data-rc-pose]'))el.value=f(values[el.dataset.rcPose],el.dataset.rcPose.length===1?2:1);
  }
  function readSettings(){
    const sim=getSim();if(!sim)return;const wind=sim.getWind?.()??sim.telemetry().wind??flowDefault;
    for(const el of $$('[data-rc-param]')){const key=el.dataset.rcParam;el.value=sim.params[key]??CONTROLLER_FIELDS.find(f=>f[0]===key)[6];}
    for(const el of $$('[data-rc-wind]'))el.value=wind?.[el.dataset.rcWind]??flowDefault[el.dataset.rcWind];
  }
  function applyController(values){validateController(values);for(const[key,value]of Object.entries(values))getSim().setParam(key,value);onEvent('research_controller_change',{values});}
  function cancel(reason='研究流程已停止',status='cancelled'){const challenge=landing?.cancel(reason)||false,replayed=experiments?.stopReplay(reason,status)||false,did=runner.cancel(reason);if(did)onCancel(reason);return did||replayed||challenge;}
  function run(program){requireLive();const validated=validateProgram(program);onBeforeRun(validated);cancel('启动新的研究流程');const owned=experiments.startProgramRecording(validated);try{runner.start(validated);}catch(error){if(owned)experiments.stopRecording(error.message,'failed');throw error;}paintStatus();}
  function saveDraft(){
    const p=validateProgram(draft),exists=library.programs.some(x=>x.id===p.id);const candidate=validateProgramLibrary({...library,programs:exists?library.programs.map(x=>x.id===p.id?p:x):[...library.programs,p]});
    persist(candidate);selectedId=p.id;draft=copy(p);renderPrograms();notify('流程与快捷键已保存，可在城市或实验室中运行。');
  }
  function updateDraftHeader(){draft.name=$('program-name').value;draft.shortcut=$('program-shortcut').value||null;draft.supplyMode=$('program-supply').value;}
  function renderProgramChoices(){
    $('program-select').innerHTML=library.programs.map(p=>`<option data-no-i18n value="${esc(p.id)}"${p.id===selectedId?' selected':''}>${esc(programName(p))}${p.shortcut?` · ${p.shortcut.slice(5)}`:''}</option>`).join('');
    if(!library.programs.some(p=>p.id===selectedId)){const option=doc.createElement('option');option.value=selectedId;option.dataset.noI18n='';option.textContent=`${draft.name} · ${tr('未保存')}`;option.selected=true;$('program-select').append(option);}
  }
  function renderPrograms(){
    renderProgramChoices();
    $('program-name').value=draft.name;$('program-shortcut').innerHTML=select([['','不绑定'],...PROGRAM_SHORTCUTS.map(code=>[code,code.slice(5)])],draft.shortcut||'');$('program-supply').value=draft.supplyMode;
    $('program-total').textContent=`${f(draft.stages.reduce((sum,s)=>sum+(s.durationS||0),0),1)} s`;
    $('stages').innerHTML=draft.stages.map((stage,index)=>stageHTML(stage,index)).join('');
  }
  function stageHTML(stage,index){
    const n=(label,key,min,max,step=1)=>input(label,stage[key],`data-rc-stage-field="${key}" min="${min}" max="${max}" step="${step}"`);
    let fields='';
    if(stage.type==='pose')fields=`<div class="rc-grid rc-grid-3">${n('ΔX · m','dxM',-100,100,.1)}${n('ΔY · m','dyM',-50,80,.1)}${n('ΔZ · m','dzM',-100,100,.1)}</div><label class="rc-field rc-full"><span>姿态参考</span><select data-rc-stage-field="attitude">${select([['start','保持流程起始姿态'],['custom','自定义俯仰 / 滚转 / 航向']],stage.attitude)}</select></label><div class="rc-grid rc-grid-3"${stage.attitude==='start'?' hidden':''}>${n('俯仰 · °','pitchDeg',-180,180)}${n('滚转 · °','rollDeg',-180,180)}${n('Δ航向 · °','yawDeg',-360,360)}</div><div class="rc-grid"><label class="rc-field"><span>结束条件</span><select data-rc-stage-field="exit">${select([['duration','运行指定时长'],['settled','达到稳定 / 超时终止']],stage.exit)}</select></label>${n('稳定保持 · s','settleS',.25,5,.25)}</div>`;
    if(stage.type==='rate'){const maximum=RATE_LIMITS[stage.axis];fields=`<div class="rc-grid"><label class="rc-field"><span>机体旋转轴</span><select data-rc-stage-field="axis">${select([['roll','滚转（Z / B）'],['pitch','俯仰（1 / 2）'],['yaw','偏航（A / D）']],stage.axis)}</select></label>${n('请求角速度 · °/s','rateDegS',-maximum,maximum,1)}</div><p class="rc-help">请求范围：滚转 ±${RATE_LIMITS.roll}°/s，俯仰 ±${RATE_LIMITS.pitch}°/s，偏航 ±${RATE_LIMITS.yaw}°/s。连续积分参考；实际有效请求另受控制器速率上限约束。阶段结束后捕获实际达到的姿态。倒置时可能无法持续悬停。</p>`;}
    if(stage.type==='wind')fields=`<div class="rc-grid">${['speedMps','directionDeg','gustMps','gustPeriodS'].map((key,i)=>input(['平均风速 · m/s','气流去向 · °','阵风幅值 · m/s','阵风周期 · s'][i],stage.wind?.[key]??flowDefault[key],`data-rc-stage-wind="${key}" min="${i===3?.5:0}" max="${[30,360,20,60][i]}" step="0.5"`)).join('')}</div><p class="rc-help">该阶段保留前一控制参考，只改变风场。风速与阵风均设为 0 即静风。</p>`;
    if(stage.type==='roll')fields='<p class="rc-help">使用与 X 相同的物理自动流程。地面出发会返回地面；空中出发会返回起始高度附近。需通过净空、姿态与剩余气量预检。</p>';
    if(stage.type==='land')fields='<p class="rc-help">持续闭环下降，确认接触地面与下降速度收敛后结束。超时不会显示着陆成功。</p>';
    if(stage.type==='wait')fields='<p class="rc-help">不产生新的姿态或位置参考，继续前一阶段的控制状态。</p>';
    return `<article class="rc-stage" data-rc-stage="${index}"><header><b>${String(index+1).padStart(2,'0')}</b><select data-rc-stage-field="type" aria-label="阶段 ${index+1} 类型">${select(Object.entries(stageNames),stage.type)}</select><div><button type="button" data-rc-stage-action="up" aria-label="上移阶段"${index===0?' disabled':''}>↑</button><button type="button" data-rc-stage-action="down" aria-label="下移阶段"${index===draft.stages.length-1?' disabled':''}>↓</button><button type="button" data-rc-stage-action="remove" aria-label="删除阶段"${draft.stages.length===1?' disabled':''}>×</button></div></header>${n(stage.type==='roll'||stage.type==='land'||stage.exit==='settled'?'超时上限 · s':'阶段时长 · s','durationS',stage.type==='rate'?.1:.25,stage.type==='rate'?12:90,.1)}${fields}</article>`;
  }
  function renderResults(){
    $('result-count').textContent=`${results.length} / ${PROGRAM_LIMITS.results}`;
    $('results').innerHTML=results.length?results.slice().reverse().map(r=>`<label class="rc-result"><input type="checkbox" data-rc-result="${esc(r.id)}"${selectedResults.includes(r.id)?' checked':''}><span><strong data-no-i18n>${esc(programName(r))}</strong><small>${esc(r.startedAt.replace('T',' ').slice(0,19))} UTC · ${f(r.durationS,1)} s</small></span><em data-status="${esc(r.status)}">${esc(statusNames[r.status])}</em></label>`).join(''):'<p class="rc-empty">运行一个自动流程后，查看误差、超调、稳定时间与气体消耗。可先使用“高度与姿态阶跃”。</p>';
    const selected=selectedResults.map(id=>results.find(r=>r.id===id)).filter(Boolean).slice(-2);
    if(!selected.length){$('comparison').innerHTML='';return;}
    const rows=[['位置误差 RMS · m',r=>f(r.summary.rmsPositionErrorM)],['最大位置误差 · m',r=>f(r.summary.peakPositionErrorM)],['最大姿态误差 · °',r=>f(r.summary.peakAttitudeErrorDeg,1)],['目标方向最大超调 · m',r=>f(Math.max(0,...r.stages.map(s=>s.overshootM||0)))],['最后定姿段稳定时间 · s',r=>{const stage=r.stages.filter(s=>s.type==='pose').at(-1);return f(stage?.settlingTimeS);}],['推力受限采样比例',r=>r.summary.saturationFraction===null?'—':`${f(r.summary.saturationFraction*100,1)}%`],['喷口通过气量 · kg',r=>f(r.summary.gasThroughputKg)],['车载排出气量 · kg',r=>f(r.summary.onboardDischargedKg)],['外供气量 · kg',r=>f(r.summary.externalSupplyKg)],['供气模式',r=>r.supplyMode==='finite'?'有限储气':'外部持续'],['结束姿态可配平',r=>r.summary.finalFeasible===null?'未判定':r.summary.finalFeasible?'是':'否']];
    const conditions=selected.length===2?compareConditions(selected[0],selected[1]):null;
    $('comparison').dataset.conditions=JSON.stringify(conditions);$('comparison').innerHTML=(conditions?`<p class="rc-help">${esc(conditions.controlled?'受控比较：只有声明的控制器差异。':'描述性比较：初态 / 模型 / 风 / 气源 / 任务条件未全部匹配，不判定哪组更好。')}</p><pre class="rc-record-details" data-no-i18n>${esc(JSON.stringify(conditions,null,2))}</pre>`:'')+`<table><thead><tr><th>测量指标</th>${selected.map(r=>`<th data-no-i18n>${esc(programName(r))}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,value])=>`<tr><th>${label}</th>${selected.map(r=>`<td>${esc(value(r))}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="rc-help">超调沿目标方向投影。新版主统计来自全部 120 Hz 物理步；20 Hz 曲线及历史抽稀仅供显示。每条结果的 statisticsHz 独立保留。流程完成只表示阶段已执行，稳定与受限情况请看测量。</p>`;
  }
  function paintStatus(){
    const s=runner.getState(),experiment=experiments?.getState(),challenge=landing?.getState();const line=challenge?.running?tr('抗扰着陆挑战')+' · '+f(challenge.live.timeS,1)+' s':experiment?.recording?tr(`现场记录 · ${f(experiment.durationS,1)} / 300 s`):experiment?.replaying?tr(`原条件重放 · ${experiment.step}/${experiment.totalSteps} 步`):experiment?.numericRunning?tr('后台数值执行中 · 可停止并保留记录'):s.running?`${programName(s)} · ${s.stage}/${s.stageCount} ${tr(s.stageLabel)} · ${f(s.stageElapsedS,1)} / ${f(s.stageDurationS,1)} s`:tr('就绪 · 驾驶键可随时接管');
    for(const el of [$('run-status'),chip.querySelector('[data-rc="chip-status"]')]){el.dataset.noI18n='';el.textContent=line;}chip.hidden=!(s.running||experiment?.recording||experiment?.replaying||experiment?.numericRunning||challenge?.running||challenge?.numericRunning||observing)||opened;
    shell.dataset.running=String(s.running||challenge?.running||challenge?.numericRunning);paintWorkspace();const context=getContext()==='lab'?'lab':'city';shell.dataset.context=context;$('context').textContent=context==='lab'?'风场实验室 · 原位研究':'城市 · 现场试验';$('context-button').textContent=context==='lab'?'返回城市 ↗':'进入风场实验室 ↗';
  }
  function setTab(name){if(!['controls','programs','results','experiments','landing'].includes(name))return;tab=name;for(const el of $$('[data-rc-panel]'))el.hidden=el.dataset.rcPanel!==tab;for(const el of $$('[data-rc-tab]'))el.setAttribute('aria-selected',String(el.dataset.rcTab===tab));if(tab==='results')drawPlot();}
  function paintWorkspace(){
    const L=(zh,en)=>getLanguage()==='en'?en:zh;shell.dataset.workspace=workspace;
    doc.body.classList.toggle('research-analysis',opened&&workspace==='analyze');
    for(const el of $$('[data-rc-workspace]')){el.textContent=el.dataset.rcWorkspace==='operate'?L('操作 / 观测','Operate / observe'):L('结果分析','Analyze results');el.setAttribute('aria-pressed',String(el.dataset.rcWorkspace===workspace));}
    shell.querySelector('[data-rc-action="observe"]').textContent=L('收起观察 ↗','Watch scene ↗');
    const challenge=landing?.getState();if(observing&&!challenge?.running&&!challenge?.numericRunning&&!runner.getState().running){
      const result=challenge?.result;chip.querySelector('[data-rc="chip-status"]').textContent=result?(result.status==='completed'?L('已结束','Ended'):L('未完成','Incomplete'))+' · '+(challenge.persistence.sessionOnly?L('仅会话 / 未保存','Session only / unsaved'):L('已保存','Saved'))+' · '+L('查看结果','View results'):L('研究已收起 · 返回操作','Research collapsed · return to controls');
    }
    const running=runner.getState().running||challenge?.running||challenge?.numericRunning||experiments?.getState().recording||experiments?.getState().replaying||experiments?.getState().numericRunning;
    const show=chip.querySelector('[data-rc-action="show-running"] b');show.dataset.noI18n='';show.textContent=running?L('展开研究','Open research'):challenge?.result?L('查看结果','View results'):L('返回操作','Return to controls');
    chip.querySelector('[data-rc-action="stop"]').hidden=!running&&getSim()?.stabilizationMode!=='hold';
  }
  function setWorkspace(value){workspace=value==='analyze'?'analyze':'operate';if(workspace==='analyze'&&tab!=='landing')setTab('results');else if(workspace==='operate'&&tab==='results')setTab('controls');paintWorkspace();landing?.setPresentation(workspace==='analyze'?'analysis':'setup');if(tab==='results')drawPlot();}
  function observe(){observing=true;opened=false;shell.hidden=true;doc.body.classList.remove('research-open','research-analysis');paintStatus();}
  function open(name=tab){observing=false;opened=true;shell.hidden=false;localizeTree(shell);doc.body.classList.add('research-open');setTab(name);paintStatus();if(getSim())update(getSim().telemetry(),0);}
  function close(){observing=false;opened=false;shell.hidden=true;doc.body.classList.remove('research-open','research-analysis');paintStatus();}
  function localControllerValues(){return fieldNumbers('[data-rc-param]','rcParam');}
  function uniqueId(){let id;do{id=`user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;}while(library.programs.some(p=>p.id===id));return id;}
  function perform(action){
    try{
      if(['context','capture','apply-pose','release','apply-wind','clear-wind','apply-controller','defaults-controller','run'].includes(action))requireLive();
      if(action==='close')close();
      else if(action==='observe')observe();
      else if(action==='study'){close();onOpenStudy();}
      else if(action==='context'){cancel('切换研究环境');if(getContext()==='lab')onReturnCity();else onEnterLab();}
      else if(action==='stop'){const cancelled=cancel('已停止研究流程'),stopped=experiments.stopAll('用户停止研究'),active=cancelled||stopped;if(!active&&getSim()?.stabilizationMode==='hold'){getSim().setStabilizationMode('off');onCancel('释放研究保持');notify('研究保持已释放，车辆继续按当前动量运动。');}paintStatus();}
      else if(action==='show-running'){const current=landing?.getState();open(current?.running||current?.result?'landing':'results');if(current?.result&&!current.running)setWorkspace('analyze');}
      else if(action==='capture'){cancel('设置新的姿态参考');const t=getSim().telemetry();if(getSim().setPoseTarget({position:{...t.position},quaternion:{...t.quaternion}})===false)throw new Error('当前参考无法接受');readCurrentPose();onStart({id:'capture-pose',name:'捕获当前姿态'});onEvent('research_pose_capture',{position:t.position,quaternion:t.quaternion});notify('已捕获当前位置与姿态。喷口正在闭环减速与配平。');}
      else if(action==='read-pose'){readCurrentPose();notify('已读取当前测量值；点击“应用自定义目标”后才会改变参考。');}
      else if(action==='apply-pose'){const v=fieldNumbers('[data-rc-pose]','rcPose');cancel('设置新的姿态参考');const target={position:{x:v.x,y:v.y,z:v.z},quaternion:quaternionFromAttitude(v.pitch,v.roll,v.heading)};if(getSim().setPoseTarget(target)===false)throw new Error('自定义参考无效');onStart({id:'custom-pose',name:'自定义姿态'});onEvent('research_pose_target',target);notify('自定义目标已送入物理控制器，请观察实际误差与可配平状态。');}
      else if(action==='pose-program'){const v=fieldNumbers('[data-rc-pose]','rcPose'),t=getSim().telemetry();draft=validateProgram({id:uniqueId(),name:'我的姿态快捷动作',shortcut:null,supplyMode:'inherit',wind:null,stages:[{...defaultStage(),dxM:v.x-t.position.x,dyM:v.y-t.position.y,dzM:v.z-t.position.z,attitude:'custom',pitchDeg:v.pitch,rollDeg:v.roll,yawDeg:((v.heading-t.headingDeg+540)%360)-180}]});selectedId=draft.id;renderPrograms();setTab('programs');$('program-shortcut').focus();notify('已生成相对当前起点的姿态动作。选择 3–9 快捷键并保存后，可在城市中使用。');}
      else if(action==='release'){cancel('释放研究保持');getSim().setStabilizationMode('off');onCancel('释放研究保持');notify('已释放研究保持，恢复驾驶控制。');}
      else if(action==='apply-wind'){const wind=validateWind(fieldNumbers('[data-rc-wind]','rcWind'));cancel('手动改变风场');getSim().setWind(wind);onEvent('research_wind',wind);notify('风场已应用；它会作用于车辆的相对气流与气动力。');}
      else if(action==='clear-wind'){cancel('手动恢复静风');getSim().clearWind();readSettings();onEvent('research_wind',{wind:null});notify('风场已恢复静风。');}
      else if(action==='wind-program'){const wind=validateWind(fieldNumbers('[data-rc-wind]','rcWind'));draft=validateProgram({id:uniqueId(),name:'我的风场快捷动作',shortcut:null,supplyMode:'inherit',wind:null,stages:[{type:'wind',durationS:12,wind}]});selectedId=draft.id;renderPrograms();setTab('programs');$('program-shortcut').focus();notify('已生成 12 s 风场动作；执行时沿用当前驾驶 / 姿态控制，结束恢复原风场。');}
      else if(action==='apply-controller'){cancel('手动调整控制参数');applyController(localControllerValues());notify('控制参数已实时应用。');}
      else if(action==='save-controller'){const values=validateController(localControllerValues());persist({...library,controller:values});notify('控制参数已保存。换场景后先“载入已保存参数”，再“应用参数”。');}
      else if(action==='load-controller'){if(!Object.keys(library.controller).length)throw new Error('尚未保存自定义控制参数');for(const el of $$('[data-rc-param]'))if(el.dataset.rcParam in library.controller)el.value=library.controller[el.dataset.rcParam];notify('已载入保存值；点击“应用参数”后才会改变当前控制器。');}
      else if(action==='defaults-controller'){cancel('恢复控制参数');const values=Object.fromEntries(CONTROLLER_FIELDS.map(([key,,,,,,value])=>[key,value]));applyController(values);readSettings();notify('控制器参数已恢复默认值。');}
      else if(action==='new'){if(library.programs.length>=PROGRAM_LIMITS.programs)throw new Error('最多保存 16 个流程，请先删除不需要的流程');draft={id:uniqueId(),name:'我的研究流程',shortcut:null,supplyMode:'inherit',wind:null,stages:[defaultStage()]};selectedId=draft.id;renderPrograms();}
      else if(action==='duplicate'){draft={...copy(draft),id:uniqueId(),name:`${draft.name.slice(0,35)} 副本`,shortcut:null};selectedId=draft.id;renderPrograms();}
      else if(action==='delete'){if(library.programs.length===1)throw new Error('至少保留一个流程');persist({...library,programs:library.programs.filter(p=>p.id!==selectedId)});draft=copy(library.programs[0]);selectedId=draft.id;renderPrograms();notify('已从此浏览器的流程库删除。');}
      else if(action==='add-stage'){if(draft.stages.length>=PROGRAM_LIMITS.stages)throw new Error('每个流程最多 12 个阶段');updateDraftHeader();draft.stages.push(defaultStage('wait'));renderPrograms();}
      else if(action==='save-program'){updateDraftHeader();saveDraft();}
      else if(action==='run'){updateDraftHeader();run(validateProgram(draft));notify('流程开始。W/A/S/D、E/Q、1/2、Z/B 或刹车会立即交还操纵权。');}
      else if(action==='export-programs'){exportJson(()=>validateProgramLibrary(library),'roadster-flight-programs-v1.json',{doc});notify('正在准备已保存的流程库；导出状态显示在右下角。');}
      else if(action==='export-protected'){exportJson(()=>({programs:loaded.protectedRaw,results:loadedResults.protectedRaw}),'roadster-flight-protected-raw.json',{doc});}
      else if(action==='export-session'){exportJson(()=>({schema:'roadster.research-session',version:1,library,draft,pendingImport,results,persistence:{programs:programPersistence.snapshot(),results:resultPersistence.snapshot()},protectedRaw:{programs:loaded.protectedRaw,results:loadedResults.protectedRaw},liveRecords:experiments.getRecords()}),'roadster-research-session.json',{doc});}
      else if(action==='export-results-all'){exportJson(()=>({schema:'roadster.flight-results',version:1,scope:'全部流程结果，每项保持原身份、原始统计和已存曲线',results:[...results]}),'roadster-flight-results-all.json',{doc});}
      else if(action==='export-result'||action==='export-csv'){const result=results.find(r=>r.id===selectedResults.at(-1))||latestFullResult||results.at(-1);if(!result)throw new Error('尚无试验记录');const suffix=action==='export-csv'?'csv':'json';if(action==='export-csv')download(()=>'\uFEFF'+resultCSV(result),`roadster-${result.programId}-${result.id}.${suffix}`,'text/csv;charset=utf-8');else exportJson(()=>result,`roadster-${result.programId}-${result.id}.${suffix}`,{doc});if(result.sampling?.decimated)notify('导出的是选中历史曲线；采样间隔与原始统计来源已写入文件，不标称为完整 20 Hz。','warning');}
    }catch(error){notify(error.message,'error');}
  }
  function click(event){
    const workspaceButton=event.target.closest('[data-rc-workspace]');if(workspaceButton){setWorkspace(workspaceButton.dataset.rcWorkspace);return;}
    const tabButton=event.target.closest('[data-rc-tab]');if(tabButton){setTab(tabButton.dataset.rcTab);return;}
    const stageButton=event.target.closest('[data-rc-stage-action]');if(stageButton){
      const index=+stageButton.closest('[data-rc-stage]').dataset.rcStage,action=stageButton.dataset.rcStageAction;updateDraftHeader();
      if(action==='remove'&&draft.stages.length>1)draft.stages.splice(index,1);else if(action==='up'&&index>0)[draft.stages[index-1],draft.stages[index]]=[draft.stages[index],draft.stages[index-1]];else if(action==='down'&&index<draft.stages.length-1)[draft.stages[index+1],draft.stages[index]]=[draft.stages[index],draft.stages[index+1]];renderPrograms();return;
    }
    const target=event.target.closest('[data-rc-action]');if(target)perform(target.dataset.rcAction);
  }
  function change(event){
    const target=event.target;
    if(target===$('program-select')){selectedId=target.value;draft=copy(library.programs.find(p=>p.id===selectedId));renderPrograms();}
    if(['program-name','program-shortcut','program-supply'].some(n=>target===$(n)))updateDraftHeader();
    if(target.dataset.rcStageField){const index=+target.closest('[data-rc-stage]').dataset.rcStage,key=target.dataset.rcStageField;
      if(key==='type'){draft.stages[index]=defaultStage(target.value);renderPrograms();}
      else{draft.stages[index][key]=target.type==='number'?target.valueAsNumber:target.value;if(['attitude','exit','axis'].includes(key))renderPrograms();else $('program-total').textContent=`${f(draft.stages.reduce((sum,s)=>sum+(s.durationS||0),0),1)} s`;}
    }
    if(target.dataset.rcStageWind){const stage=draft.stages[+target.closest('[data-rc-stage]').dataset.rcStage];stage.wind={...flowDefault,...stage.wind,[target.dataset.rcStageWind]:target.valueAsNumber};}
    if(target.dataset.rcResult){selectedResults=selectedResults.filter(id=>id!==target.dataset.rcResult);if(target.checked)selectedResults.push(target.dataset.rcResult);selectedResults=selectedResults.slice(-2);renderResults();}
    if(target===$('plot-metric')){plotMetric=target.value;drawPlot();}
  }
  async function importFile(event){const file=event.target.files?.[0];if(!file)return;try{if(file.size>PROGRAM_LIMITS.importBytes)throw new Error('流程 JSON 不能大于 128 KiB');const parsed=parseProgramLibrary(await file.text());pendingImport=parsed;persist(parsed);pendingImport=null;draft=copy(library.programs[0]);selectedId=draft.id;renderPrograms();if(Object.keys(library.controller).length)for(const el of $$('[data-rc-param]'))if(el.dataset.rcParam in library.controller)el.value=library.controller[el.dataset.rcParam];notify('流程库已导入；车辆状态与当前参数未改变。');}catch(error){notify(error.message,'error');}finally{event.target.value='';}}
  shell.addEventListener('click',click);chip.addEventListener('click',click);shell.addEventListener('change',change);$('import-programs').addEventListener('change',importFile);
  function drawPlot(){
    if(!opened||tab!=='results')return;const canvas=$('plot'),ctx=canvas.getContext('2d');if(!ctx)return;
    const samples=liveSamples.slice(-400),w=canvas.width,h=canvas.height,l=57,r=w-18,top=23,bottom=h-36;
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#0b1821';ctx.fillRect(0,0,w,h);ctx.font='18px Consolas, monospace';
    const key=plotMetric==='height'?'heightM':plotMetric==='position'?'positionErrorM':'attitudeErrorDeg';const target=plotMetric==='height';
    const values=samples.flatMap(s=>[s[key],...(target?[s.targetHeightM]:[])]).filter(Number.isFinite);
    if(!samples.length||!values.length){ctx.fillStyle='#87a6b5';ctx.fillText(tr('运行试验后显示仿真时间曲线'),62,143);return;}
    let min=Math.min(...values),max=Math.max(...values);const padding=Math.max(.1,(max-min)*.15);min-=padding;max+=padding;if(plotMetric!=='height')min=0;
    const t0=samples[0].timeS,t1=Math.max(t0+1,samples.at(-1).timeS),x=t=>l+(t-t0)/(t1-t0)*(r-l),y=v=>bottom-(v-min)/(max-min)*(bottom-top);
    ctx.lineWidth=1;ctx.strokeStyle='#24404d';ctx.fillStyle='#7796a5';
    for(let i=0;i<4;i++){const v=min+(max-min)*i/3,yy=y(v);ctx.beginPath();ctx.moveTo(l,yy);ctx.lineTo(r,yy);ctx.stroke();ctx.textAlign='right';ctx.fillText(f(v,1),l-8,yy+5);}
    ctx.textAlign='left';ctx.fillText(`${f(t0,1)} s`,l,h-9);ctx.textAlign='right';ctx.fillText(`${f(t1,1)} s`,r,h-9);
    const line=(field,color,dashed)=>{ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=3;ctx.setLineDash(dashed?[8,6]:[]);let pen=false;for(const s of samples){if(!Number.isFinite(s[field])){pen=false;continue;}if(pen)ctx.lineTo(x(s.timeS),y(s[field]));else ctx.moveTo(x(s.timeS),y(s[field]));pen=true;}ctx.stroke();ctx.setLineDash([]);};
    if(target)line('targetHeightM','#d5b771',true);line(key,'#83dace',false);
  }
  function captureSample(telemetry){
    if(disposed||!telemetry)return;const time=telemetry.simTime;
    if(time<lastLiveSample-.001){liveSamples=[];lastLiveSample=-Infinity;}
    if(time-lastLiveSample>=.05-1e-8){
      lastLiveSample=time;const state=runner.getState(),manual=telemetry.mode==='hover'&&telemetry.stabilizationMode==='off'&&!telemetry.maneuver,target=state.target?.position??telemetry.holdPositionTarget,quaternion=state.target?.quaternion??telemetry.holdQuaternionTarget??(manual?telemetry.manualQuaternionTarget:null);
      liveSamples.push({timeS:time,heightM:telemetry.position?.y,targetHeightM:target?.y??telemetry.targetAltitude,positionErrorM:target?Math.hypot(telemetry.position.x-target.x,telemetry.position.y-target.y,telemetry.position.z-target.z):null,attitudeErrorDeg:quaternionErrorDeg(telemetry.quaternion,quaternion)});if(liveSamples.length>500)liveSamples.shift();
    }
  }
  function update(telemetry,dt=0){
    if(disposed||!telemetry)return;if(!liveSamples.length)captureSample(telemetry);
    const now=typeof performance!=='undefined'?performance.now():Date.now();if(now-lastPaint<90&&dt!==0)return;lastPaint=now;experiments?.update(telemetry);landing?.update();paintStatus();if(!opened)return;
    $('height').textContent=f(telemetry.heightWorld,2);$('pitch').textContent=f(telemetry.pitchDeg,1);$('roll').textContent=f(telemetry.rollDeg,1);
    const holding=telemetry.stabilizationMode==='hold',limited=telemetry.holdFeasible===false||telemetry.manualPoseFeasible===false||telemetry.pressureLimited;
    $('feasibility').textContent=limited?'推力 / 配平受限':holding?(telemetry.holdActive?'正在物理跟踪':'等待可控状态'):'驾驶控制';$('feasibility').dataset.limited=String(limited);
    const active=runner.getState(),target=active.target?.position??telemetry.holdPositionTarget;
    const lab=getContext()==='lab',outside=lab&&target&&(Math.abs(target.x)>24||Math.abs(target.z)>42||target.y+1.1>WIND_LAB_DIMENSIONS.clearHeight);$('space-warning').textContent=(lab?'实验室工作区 X ±24 / Z ±42 m，净高 24.1 m。':'城市现场：世界高度不等于恢复净空。')+(outside?'目标及车体包络可能越出工作区 / 净高；请求未被夹紧。':'')+' '+(telemetry.supplyMode==='bench'?'恒压外供气':'有限车载气源')+' · '+(telemetry.stabilizationMode==='hold'?'研究定姿定点':telemetry.stabilizationMode==='level'?'普通 G 水平稳定':'驾驶控制');
    $('target-line').textContent=target?`目标世界位置  X ${f(target.x,2)} / Y ${f(target.y,2)} / Z ${f(target.z,2)} m${active.effectiveRateDegS!==null&&active.effectiveRateDegS!==undefined?` · 有效角速度指令 ${f(active.effectiveRateDegS,1)}°/s`:''}`:'无研究位置参考 · 车辆按当前驾驶模式控制';
    const manual=telemetry.mode==='hover'&&telemetry.stabilizationMode==='off'&&!telemetry.maneuver,q=active.target?.quaternion??telemetry.holdQuaternionTarget??(manual?telemetry.manualQuaternionTarget:null);
    if(q){const fy=2*(q.y*q.z-q.w*q.x),fx=2*(q.x*q.z+q.w*q.y),fz=1-2*(q.x*q.x+q.y*q.y),ry=2*(q.x*q.y+q.w*q.z),uy=1-2*(q.x*q.x+q.z*q.z);$('target-attitude').textContent=`目标姿态  俯仰 ${f(Math.asin(Math.max(-1,Math.min(1,fy)))*180/Math.PI,1)}° / 滚转 ${f(Math.atan2(ry,uy)*180/Math.PI,1)}° / 航向 ${f((Math.atan2(fx,fz)*180/Math.PI+360)%360,1)}°`;}
    else $('target-attitude').textContent='';
    const sample=liveSamples.at(-1);$('position-error').textContent=`${f(sample?.positionErrorM)} m`;$('attitude-error').textContent=`${f(sample?.attitudeErrorDeg,1)} °`;$('allocation').textContent=f(telemetry.allocationError,3);$('flow').textContent=`${f(telemetry.massFlowKgS,2)} kg/s`;drawPlot();
  }
  function handleKey(code){if(!PROGRAM_SHORTCUTS.includes(code))return false;const program=library.programs.find(p=>p.shortcut===code);if(!program)return false;try{run(program);}catch(error){notify(error.message,'error');}return true;}
  function onContextChange(){cancel('研究环境已切换');landing?.onContextChange();experiments.onContextChange();liveSamples=[];lastLiveSample=-Infinity;readSettings();readCurrentPose();paintStatus();if(opened)if(getSim())update(getSim().telemetry(),0);}
  function setLiveAvailable(value,reason=''){const priorReason=liveReason;liveAvailable=!!value;liveReason=reason;if(value&&priorReason&&message===priorReason)notify('');experiments.setLiveAvailable(value,reason);if(!value)cancel('三维现场不可用');for(const action of ['context','capture','apply-pose','release','apply-wind','clear-wind','apply-controller','defaults-controller','run'])for(const el of $$('[data-rc-action="'+action+'"]'))el.disabled=!liveAvailable;if(!value&&reason)notify(reason,'warning');}
  function beforeFixedStep(fixedDt,pilotInput={}){if(landing?.getState().running)return landing.beforeStep(pilotInput);if(experiments.getState().replaying)return experiments.beforeStep(pilotInput);const input=runner.stepInput(fixedDt,pilotInput);return experiments.beforeStep(input);}
  renderPrograms();renderResults();readSettings();readCurrentPose();setLiveAvailable(liveAvailable);paintPersistence();
  if(message){$('message').textContent=message;$('message').dataset.kind=messageKind;$('message').hidden=false;}
  const stopLanguage=onLanguageChange(()=>{renderProgramChoices();renderResults();paintStatus();localizeTree(shell);localizeTree(chip);drawPlot();if(getSim())update(getSim().telemetry(),0);});
  return{open,close,setWorkspace,toggle:()=>opened?close():open(),stepInput:beforeFixedStep,beforeFixedStep,afterFixedStep:(t,input,dt)=>{runner.afterFixedStep?.(t,dt);experiments.afterStep(t,input,dt);landing.afterStep(t);},recordEvent:experiments.recordEvent,startRecording:experiments.startRecording,stopRecording:experiments.stopRecording,startReplay:experiments.startReplay,setLiveAvailable,getExperimentState:experiments.getState,getExperimentRecords:experiments.getRecords,getLandingRecords:landing.getRecords,needsFixedStep:()=>{const state=experiments.getState();return state.recording||state.replaying||landing.getState().running;},captureSample,update,handleKey,onContextChange,cancel,getState:()=>({...runner.getState(),experiment:experiments.getState(),landing:landing.getState(),open:opened,tab,workspace,observing,context:getContext(),savedPrograms:library.programs.map(p=>({id:p.id,name:p.name,shortcut:p.shortcut})),resultCount:results.length,persistence:{programs:programPersistence.snapshot(),results:resultPersistence.snapshot()}}),dispose(){stopLanguage();landing.dispose();experiments.dispose();cancel('控制台已关闭');close();disposed=true;shell.removeEventListener('click',click);shell.removeEventListener('change',change);chip.removeEventListener('click',click);$('import-programs').removeEventListener('change',importFile);shell.remove();chip.remove();}};
}
