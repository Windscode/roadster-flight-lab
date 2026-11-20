import {getLanguage,onLanguageChange} from './i18n.js';
import {ResourceMission,RESOURCE_ROUTE,prepareResourceRoute,completeResourcePreparation,comparableResourceRuns,resourceRunDifference,routeGasUseKg,resourceInitialState,resourceVerdict} from './resource-mission.js';
import {exportJson} from './export-download.js';
import {sharedInputs} from './semantic-input.js';
import {routeSurfaceProgress} from './route-surface.js';
import {WEAVE_SECTORS,weaveApproach} from './route-sectors.js';
import {ResourceHistory} from './resource-history.js';
const L=(zh,en)=>getLanguage()==='en'?en:zh;
const gasLabel=run=>run.finite?L('车载用气','Tank gas'):L('外部供气','External gas');
const f=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—';
export function createRouteExperience({mount,hudMount,getSim,getPaused,getContext,getRecording=()=>null,getSessionMode=()=> 'live',onPrepare,onStart,onFinish,onInspect,onOpen,onSound,onHead,recordEvent=()=>{},notify=()=>{}}){
  const doc=mount.ownerDocument,section=doc.createElement('section');section.className='route-experience';section.dataset.noI18n='';
  section.innerHTML='<p class="route-eyebrow">01 / WEAVE STREET · 302.5 m</p><h3 data-route="title"></h3><p data-route="intro"></p><label><span data-route="condition-label"></span><select data-route="condition"><option value="dry-day"></option><option value="after-rain"></option><option value="after-rain-night"></option></select></label><div class="route-actions"><button data-route-action="prepare"></button><button data-route-action="start"></button><button data-route-action="end"></button><button data-route-action="retry" hidden></button></div><label class="route-feedback"><input type="checkbox" data-route="sound"><span data-route="sound-label"></span></label><label class="route-feedback"><input type="checkbox" data-route="head" checked><span data-route="head-label"></span></label><p data-route="status" role="status"></p><p class="field-help" data-route="limits"></p><button data-route-action="inspect"></button>';
  mount.prepend(section);const $=key=>section.querySelector('[data-route="'+key+'"]'),action=key=>section.querySelector('[data-route-action="'+key+'"]');
  const hud=doc.createElement('aside');hud.className='route-driving-card';hud.dataset.noI18n='';hud.hidden=true;hud.innerHTML='<div><strong data-live="title"></strong><button data-live="open">↗</button></div><p data-live="instruction"></p><div data-live="wheels"></div><small data-live="detail"></small><div data-live="result" hidden><button data-live="splits"></button> <button data-live="retry"></button></div>';hudMount.append(hud);
  const live=key=>hud.querySelector('[data-live="'+key+'"]');live('open').onclick=onOpen;
  const wheelBadges=Array.from({length:4},()=>live('wheels').appendChild(doc.createElement('span')));
  const style=doc.createElement('style');style.textContent='.route-experience{padding:18px 16px;margin:4px 0 22px;background:#172a2de8;border:1px solid #8bb3a866;border-radius:10px}.route-experience h3{font-size:21px;margin:5px 0 12px}.route-experience p{line-height:1.6}.route-experience label{display:block}.route-experience select{width:100%;margin-top:6px}.route-eyebrow{font-size:10px;letter-spacing:1.2px;color:#aed1bb}.route-actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.route-sector-table{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:12px;font-variant-numeric:tabular-nums}.route-sector-table th,.route-sector-table td{text-align:right;padding:5px 3px;border-bottom:1px solid #91ac9a35}.route-sector-table th:first-child{text-align:left}.route-sector-table small{display:block;color:#b9cdae}.route-feedback{font-size:12px;margin:8px 0}.route-driving-card{position:relative;width:100%;box-sizing:border-box;flex:0 0 auto;padding:10px 14px;border:1px solid #8ab4a55c;background:#102427e8;border-radius:8px;color:#deeee3;font-size:12px;pointer-events:auto;z-index:18}.route-driving-card[hidden],.route-driving-card [hidden]{display:none!important}.route-driving-card [data-live=result]{display:flex;gap:8px;margin-top:8px}.route-driving-card [data-live=result] button{border:1px solid #69948b;border-radius:5px;padding:5px 9px}.route-driving-card [data-live=retry]{background:#38554b}.route-driving-card>div:first-child{display:flex;justify-content:space-between;align-items:center}.route-driving-card button{padding:2px 8px;background:transparent;border:0;color:inherit}.route-driving-card p{margin:7px 0}.route-driving-card [data-live=wheels]{display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px}.route-driving-card [data-live=wheels]>span{padding:4px 6px;background:#c5dec40a;border-left:2px solid #99bea5}.route-driving-card small{display:block;margin-top:6px;color:#a9c1b8;line-height:1.5}@media(max-width:750px){.route-driving-card{padding:9px 11px}}';section.append(style);
  const resourceControls=doc.createElement('div');resourceControls.innerHTML='<label><span data-resource="mode-label"></span><select data-resource="mode"><option value="finite"></option><option value="practice"></option></select></label><p data-resource="budget"></p><p data-resource="accounting"></p><details><summary data-resource="history-title"></summary><p data-resource="comparison"></p><div data-resource="history"></div></details><p data-resource="storage" role="status"></p><button data-resource="retry-save" hidden></button> <button data-resource="export"></button>';
  section.insertBefore(resourceControls,$('limits'));const resource=key=>resourceControls.querySelector('[data-resource="'+key+'"]');
  let mission=null,preparation=null,busy=false;const history=new ResourceHistory(),resourceHistory=history.runs;
  function renderStorage(){
    const state=history.snapshot(),status=resource('storage'),retry=resource('retry-save');
    status.hidden=state.status==='saved';
    status.dataset.persistence=JSON.stringify(state);
    retry.hidden=!state.unsavedCount||state.protectedArchive;
    retry.textContent=L('重试保存摘要','Retry saving summaries');
    if(status.hidden){status.textContent='';return;}
    if(state.protectedArchive)status.textContent=L('原摘要存档无法完整读取，已保护。导出包含原文和本会话的全部摘要。','The original summary archive is protected. New results are not saved. Export includes the original text and all session summaries.');
    else if(state.reason==='conflict')status.textContent=L('其他页面更改了记录。可以重试合并，或在关闭前导出本次结果。','Another page changed the records. Retry the merge or export this session before closing.');
    else if(state.reason==='quota')status.textContent=L('浏览器存储空间已满，未保存摘要。可直接导出全部摘要，或腾出空间后重试保存。','Browser storage is full. Summaries are not saved. Export all summaries now or free space and retry saving.');
    else status.textContent=L('当前浏览器未保存摘要。可重试保存，或在关闭前导出本会话的全部结果。','Summaries are not saved in this browser. Retry saving or export all session results before closing.');
  }
  function resultMessage(){
    return message+(run?.finished&&history.snapshot().status==='unsaved'?L(' · 摘要未保存，请打开路线面板导出',' · Summary not saved; open the route panel to export.'):'');
  }
  function sectorTable(item,previous){
    const panel=doc.createElement('details'),title=doc.createElement('summary');
    title.textContent=L('分段收支','Sector breakdown')+' · '+item.sectors.length+'/'+WEAVE_SECTORS.length;
    panel.append(title);
    const table=doc.createElement('table');table.className='route-sector-table';
    const caption=table.createCaption();
    const matched=previous?.sectors?.length===4&&comparableResourceRuns(item,previous);
    caption.textContent=matched?L('每格第二行为相对上次同条件完赛的差值','Second line shows change from the previous matched finish'):item.sectors.length===4?L('第四段计入终点停车时间','The fourth sector includes the final stop'):L('仅列已通过的计时线，整程收支还包含最后一段未完路程','Only crossed lines are shown. Run totals also include the unfinished leg.');
    const header=table.createTHead().insertRow();
    for(const label of [L('路段','Sector'),'s',L('净 Wh','Net Wh'),L('回充 Wh','Regen Wh'),gasLabel(item)+' kg']){
      const th=doc.createElement('th');th.scope='col';th.textContent=label;header.append(th);
    }
    const body=table.createTBody();
    for(const [i,split] of item.sectors.entries()){
      const row=body.insertRow(),name=doc.createElement('th');name.scope='row';
      name.textContent=L(WEAVE_SECTORS[i].zh,WEAVE_SECTORS[i].en);row.append(name);
      for(const key of ['elapsedS','netWh','recoveredWh',item.finite?'gasUsedKg':'externalGasKg']){
        const cell=row.insertCell();cell.textContent=f(split[key],2);
        if(matched){const delta=split[key]-previous.sectors[i][key],sub=doc.createElement('small');sub.textContent=(delta>0?'+':'')+f(delta,2);cell.append(sub);}
      }
    }
    panel.append(table);return panel;
  }
  function renderHistory(){resource('history').replaceChildren();const latest=resourceHistory.at(-1);
    const previous=resourceHistory.slice(0,-1).findLast(item=>comparableResourceRuns(latest,item));
    const delta=resourceRunDifference(latest,previous),signed=(v,n=2)=>(v>0?'+':'')+f(v,n);
    resource('comparison').textContent=delta?L('最近一次相对上一条有效同条件成绩：','Latest versus previous valid matching run: ')+signed(delta.elapsedS)+' s · '+signed(delta.netWh)+' Wh · '+signed(delta.gasKg)+' kg · '+L('回充 ','recovered ')+signed(delta.recoveredWh)+' Wh':L('完成两次完整初态相同的路线后，显示用时、用电与耗气差值。失败或条件不同的记录保留，但不参与成绩比较。','Complete two runs with identical full initial states to compare time, energy and gas. Failed or unmatched runs are retained but excluded from comparison.');
    renderStorage();resource('export').textContent=L('导出收支摘要与保存状态','Export summaries and save status');resource('export').hidden=resource('export').disabled=!resourceHistory.length&&history.protectedRaw===null;for(const item of resourceHistory.toReversed()){const row=doc.createElement('div');const comparable=comparableResourceRuns(item,latest);row.textContent=(item.finite?L('有限任务','Finite'):L('自由练习','Practice'))+' · '+resourceVerdict(item.reason,getLanguage()==='en')+' · '+f(item.elapsedS)+' s · '+f(item.netEnergyJ/3600,2)+' Wh · '+gasLabel(item)+' '+f(routeGasUseKg(item),2)+' kg · '+L('回充 ','recovered ')+f(item.work.recoveredJ/3600,2)+' Wh'+(item.resourceEvidence?.scope==='last-measured-valid-state'?L(' · 最后有效采样',' · last valid sample'):'')+(item!==latest?(comparable?L(' · 与最近一次同条件',' · matched to latest'):L(' · 未完成或条件不同，不比较',' · incomplete or unmatched')):'');
    if(item.recordId){const inspect=doc.createElement('button');inspect.textContent=L('查看输入 / 重放','Inputs / replay');inspect.onclick=()=>onInspect(item.recordId);row.append(doc.createElement('br'),inspect);}if(item.sectors?.length){const prior=resourceHistory.slice(0,resourceHistory.indexOf(item)).findLast(other=>comparableResourceRuns(item,other));row.append(sectorTable(item,prior));}resource('history').append(row);}}
  resource('retry-save').onclick=()=>{
    const saved=history.save();
    renderHistory();update();
    notify(saved?L('本次摘要已保存。','Session summaries saved.'):resource('storage').textContent,6500);
  };
  resource('export').onclick=()=>exportJson(()=>history.archive(),'roadster-resource-runs.json',{doc});
  resource('mode').onchange=()=>{showBudget();preparation=null;message=L('模式已改变；必须重新准备，不能沿用上次资源初态。','Mode changed. Prepare again; the previous initial state cannot be reused.');update();};
  let descriptor=null,run=null,recordId=null,lastResult=null,lastRegion='',message='';
  function showBudget(){
    resource('budget').textContent=resource('mode').value==='finite'?
      L('65 秒内完成 302.5 m。起始可用电量 120 Wh，车载气罐 100 bar / 600 L。终点需保留 5 Wh 和 5 kg 气。短点按起步，提前松开加速键可回充。','Finish 302.5 m within 65 s. Start with 120 Wh available and a 100 bar / 600 L tank. Retain 5 Wh and 5 kg at the finish. Start with short throttle pulses and lift early to regenerate.'):
      L('自由练习使用外部恒压气源和充满的电池，按四段记录时间、电耗和外部供气量。可在路口前停下来熟悉转弯。','Practice starts with a full battery and an external constant-pressure supply. Four sectors record time, battery work and gas throughput. Take your time at the turn.');
  }
  function render(){
    resource('mode-label').textContent=L('驾驶方式','Run mode');resource('mode').options[0].textContent=L('有限资源挑战','Finite-resource mission');resource('mode').options[1].textContent=L('自由练习（外部恒压气源）','Free practice (external constant-pressure gas)');
    showBudget();
    resource('history-title').textContent=L('最近 6 次收支与复盘；未保存的会话结果全部保留','Last six runs and replay; all unsaved session results retained');renderHistory();
    $('title').textContent=L('一段路，读懂车的反应','One street. Read the car.');
    $('intro').textContent=L('沿车道向前通过三道金色计时线（60、180、235 m）。入弯前减速，左转后在青色圈内停稳半秒。建议 30 km/h。赛后可展开分段收支。','Cross the three amber timing lines in the lane (60, 180 and 235 m). Brake before the left turn and stop inside the teal ring for half a second. Try 30 km/h. Open the splits after your run.');
    $('condition-label').textContent=L('下一次准备条件','Next preparation');
    for(const [value,zh,en]of [['dry-day','干燥白天 · 标定路面','Dry day · mapped road'],['after-rain','雨后白天 · 局部潮湿','After rain · daylight'],['after-rain-night','雨后夜间 · 同一物理路面','After rain · night, same grip']])$('condition').querySelector('[value="'+value+'"]').textContent=L(zh,en);
    action('prepare').textContent=L('准备路线 · 复位并暂停','Prepare route · reset and pause');action('start').textContent=L('开始驾驶并记录','Drive and record');action('end').textContent=L('结束本次记录','Finish recording');
    action('retry').textContent=live('retry').textContent=L('重试这条路线','Retry this route');
    live('splits').textContent=L('查看分段收支','Review splits');
    action('inspect').textContent=L('查看这次记录 / 原条件重放','Inspect record / original replay');
    $('sound-label').textContent=L('开启轮胎 / 制动 / 落地声音','Tyre, braking and touchdown audio');$('head-label').textContent=L('驾驶舱轻微头部惯性','Subtle cockpit head movement');
    $('limits').textContent=L('准备会建立新的路线初态并清空当前输入；只在暂停时应用。行驶中切换观赏昼夜不改变附着。湿润、外观和抓地分别标定，未模拟水滑。','Preparation creates a new route initial state and clears input, only while paused. Presentation lighting never changes grip during a run. Moisture, appearance and friction are separate; no hydroplaning model.');
    live('open').setAttribute('aria-label',L('打开路线与分段成绩','Open route and sector results'));
    update();
  }
  async function perform(name){if(busy)return;busy=true;try{
    update();
    if(name==='retry'){
      if(!run?.finished||getSessionMode()!=='live'||getRecording()?.recording)return;
      if(!getPaused())onOpen();
      $('condition').value=run.preset;resource('mode').value=run.finite?'finite':'practice';showBudget();
    }
    if(name==='prepare'||name==='retry'){
      if(!getPaused()||getSessionMode()!=='live'||run&&!run.finished)throw Error(L('先暂停并结束当前路线。','Pause and end the current route first.'));
      preparation=null;const finite=resource('mode').value==='finite';const result=await onPrepare($('condition').value,{prepareSim:sim=>prepareResourceRoute(sim,finite)});preparation=completeResourcePreparation(getSim(),finite);mission=null;descriptor=result.descriptor;run=null;recordId=null;lastRegion='';message=L('初态已准备；开始后用已绑定的前进 / 制动动作驾驶。','Prepared. Start and use your bound forward / brake actions.');
    }
    if(name==='start'||name==='retry'){
      if(!descriptor||run||!preparation)throw Error(L('每次驾驶请重新准备路线。','Prepare the route again for each attempt.'));
      const sim=getSim(),t=sim.telemetry(),origin=descriptor.route.start;
      if(getSessionMode()!=='live'||!getPaused()||Math.hypot(t.position.x-origin.x,t.position.z-origin.z)>3||Math.hypot(t.velocity.x,t.velocity.z)>.45)throw Error(L('请重新准备路线，在起点停稳后开始。','Prepare the route and start while stopped at its beginning.'));
      if(preparation.params!==JSON.stringify(sim.params)||preparation.finite!==(resource('mode').value==='finite')||preparation.initialState!==resourceInitialState(sim))throw Error(L('条件已改变，请重新准备。','Conditions changed; prepare again.'));
      mission=new ResourceMission(sim,{finite:preparation.finite,descriptorHash:sim.getRouteSurface()?.descriptorHash,inputProfile:sharedInputs.getProfile()});
      const result=onStart(descriptor);recordId=result?.id??result?.recordId??null;mission.recordId=recordId;recordEvent('resource_route_start',{identity:mission.identity,resourceBudget:preparation.finite?RESOURCE_ROUTE:null});run={preset:$('condition').value,finite:preparation.finite,startedAt:sim.simTime,descriptorHash:sim.getRouteSurface()?.descriptorHash,maximumDistanceM:0,passedCheckpoints:[],finished:false};message='';
    }else if(name==='end')finish('pilot-ended');
    else if(name==='inspect')onInspect(recordId);
  }catch(error){message=error.message;notify(message,6500);}finally{busy=false;}update();}
  live('retry').onclick=()=>perform('retry');
  live('splits').onclick=()=>{
    onOpen();
    const archive=resource('history-title').parentElement;archive.open=true;
    const latest=resource('history').querySelector('details');if(latest)latest.open=true;
    resource('history-title').focus();resource('history-title').scrollIntoView?.({block:'center'});
  };
  for(const name of ['prepare','start','end','inspect','retry'])action(name).onclick=()=>perform(name);
  $('sound').onchange=()=>onSound($('sound').checked);$('head').onchange=()=>onHead($('head').checked);
  function finish(reason,{stopRecording=true}={}){if(!run||run.finished)return;run.finished=true;const budget=mission?.result(getSim(),reason);if(budget){recordEvent('resource_route_result',budget);history.append(budget);renderHistory();}const result=stopRecording?onFinish(budget&&!budget.completed&&reason==='route-completed'?budget.reason:reason):null;lastResult={work:budget?.work??null,recordId:result?.id??recordId,reason:budget?.reason??reason,elapsedS:budget?.elapsedS??getSim().simTime-run.startedAt,distanceM:run.maximumDistanceM,descriptorHash:run.descriptorHash};recordId=lastResult.recordId;message=reason==='route-completed'?L('已沿路线到达终点并停车；记录已结束，可查看本次路况与输入。','Route completed and stopped. The run is ready to inspect.'):L('本次路线记录已结束。','Route recording ended.');if(budget)message=resourceVerdict(budget.reason,getLanguage()==='en')+' · '+f(budget.elapsedS)+' s · '+L('净用电 ','net ')+f(budget.netEnergyJ/3600,2)+' Wh · '+gasLabel(budget)+' '+f(routeGasUseKg(budget),2)+' kg';if(budget?.resourceEvidence?.scope==='last-measured-valid-state')message+=L(' · 数值取最后有效采样，非精确失败瞬间',' · values from last valid sample, not the exact failure instant');notify(resultMessage(),6500);}
  function syncRecording(t){
    const recording=getRecording();
    if(run&&!run.finished&&t.fault){finish('simulation-fault',{stopRecording:false});return;}
    if(run&&!run.finished&&recording&&(!recording.recording||recording.id&&recordId&&recording.id!==recordId)){
      finish('recording-ended-externally',{stopRecording:false});
    }
  }
  function afterStep(t){
    syncRecording(t);
    if(!run||run.finished||!descriptor)return;
    const failed=mission?.check(getSim(),t);if(failed){finish(failed.reason);return;}
    const {timing}=mission,progress=timing.progress;
    run.maximumDistanceM=Math.max(run.maximumDistanceM,progress.distanceM);
    const checkpoint=Math.min(WEAVE_SECTORS.length-1,timing.rows.length);
    if(checkpoint===run.passedCheckpoints.length){
      run.passedCheckpoints.push(checkpoint);
      recordEvent('route_checkpoint',{checkpoint,distanceM:progress.distanceM,descriptorHash:run.descriptorHash,energy:t.energyAccounting,gasKg:t.gasMass});
    }
    const region=(t.wheelStates??[]).map(w=>w.contact?w.surfaceId??'legacy':'air').join('|');if(region!==lastRegion){recordEvent('route_wheel_surface',{regions:(t.wheelStates??[]).map(w=>({wheel:w.id,surfaceId:w.surfaceId,mu:w.surfaceMu,contact:w.contact})),descriptorHash:run.descriptorHash});lastRegion=region;}
    if(timing.finished)finish('route-completed');
  }
  function update(){
    const sim=getSim(),surface=sim.getRouteSurface?.(),t=sim.telemetry();
    const active=surface&&surface.descriptor.id==='weave-learning-route'&&getContext()==='city';
    syncRecording(t);
    action('prepare').disabled=busy||getSessionMode()!=='live'||!getPaused()||!!run&&!run.finished;action('start').disabled=busy||getSessionMode()!=='live'||!getPaused()||!active||!descriptor||!preparation||!!run;action('end').disabled=busy||!run||run.finished;action('inspect').disabled=busy||!recordId||!!run&&!run.finished;
    action('retry').hidden=!run?.finished;action('retry').disabled=live('retry').disabled=busy||getSessionMode()!=='live'||!!getRecording()?.recording;
    resource('mode').disabled=busy||!!run&&!run.finished;
    const recordedWork=run?.finished&&lastResult?.work,energy=recordedWork||t.energyAccounting;
    resource('accounting').textContent=energy?(recordedWork?L('本次记录电池收支　','Recorded battery balance · '):L('当前车辆电池收支　','Live battery balance · '))+f(energy.motorElectricalJ/3600,2)+' Wh '+L('电驱 + ','drive + ')+f((energy.fanJ+energy.auxiliaryJ)/3600,2)+' Wh '+L('风扇/附件 − ','fan/aux − ')+f(energy.recoveredJ/3600,2)+' Wh '+L('回充；反向驱动制动热 ','recovered; opposing-drive heat ')+f((energy.motorBrakingHeatJ??0)/3600,2)+' Wh'+L('（不计入回充），轮胎滑移热不回收。',' (not recovered); tyre slip heat is not recovered.'):'';
    $('condition').disabled=busy||!!run&&!run.finished;
    $('status').textContent=resultMessage()||(run&&!run.finished?L('记录中 · ','Recording · ')+f(t.simTime-run.startedAt)+' s':L('暂停后准备一组新条件。','Pause to prepare new conditions.'));
    hud.hidden=!active||!descriptor||getSessionMode()!=='live';if(hud.hidden)return;
    const ended=!!run?.finished&&!!lastResult;
    live('result').hidden=!ended;live('wheels').hidden=ended;
    if(ended){
      live('title').textContent=resourceVerdict(lastResult.reason,getLanguage()==='en');
      live('instruction').textContent=f(lastResult.elapsedS,1)+' s · '+L('已记录 ','Recorded ')+(mission?.timing.rows.length??0)+'/4 '+L('段','sectors');
      live('detail').textContent=lastResult.reason==='battery-exhausted'?L('用短点按起步，提前收油，轻刹回充。','Use short throttle pulses, lift early and brake gently to regenerate.'):'';
      return;
    }
    const desc=surface.descriptor,progress=routeSurfaceProgress(desc,t.position),cue=weaveApproach(desc,progress,t);
    live('title').textContent=L(desc.label,desc.labelEn)+' · '+f(progress.distanceM,0)+' / '+Math.round(desc.route.lengthM)+' m';
    const missed=run&&!run.finished&&mission?.timing.missedGate;
    let instruction;
    if(missed)instruction=L('漏过计时线，请沿原车道返回并向前通过 ','Missed timing line. Rejoin the lane and cross forward at ')+WEAVE_SECTORS[mission.timing.rows.length].endM+' m';
    else if(cue?.kind==='inside')instruction=L('停车圈内 · 制动至四轮停稳半秒','Inside the circle · brake and settle on all wheels for ½ s');
    else if(cue?.kind==='return')instruction=L('已驶过终点 · 返回停车圈，距圈心 ','Past the finish · return to the circle, centre ')+f(cue.distance,0)+' m';
    else if(!cue||cue.kind==='off-route')instruction=L('已偏离示范路线 · 沿原车道返回','Outside the route · return via the road');
    else{
      instruction=cue.kind==='turn'?L('前方左转 ','Left turn in ')+f(cue.distance,0)+L(' m · 建议 30 km/h',' m · aim for 30 km/h'):L('沿横街至停车圈心 ','Stop at the circle centre in ')+f(cue.distance,0)+' m';
      if(cue.distance<=80&&cue.exceedsGrip)instruction+=L(' · 立即减速，所需制动力超出当前轮胎余量',' · slow now, required braking exceeds current tyre grip');
      else if(cue.distance<=80&&cue.required>=.25)instruction+=L(' · 所需减速度 ',' · required deceleration ')+f(cue.required,1)+' m/s²';
    }
    live('instruction').textContent=instruction;
    for(const [i,badge] of wheelBadges.entries()){const w=t.wheelStates?.[i];badge.hidden=!w;if(!w)continue;badge.textContent=(w.id??['FR','FL','RR','RL'][i])+' '+(w.contact?L(w.surfaceLabel??'旧路面',w.surfaceLabelEn??'Legacy road')+' μ '+f(w.surfaceMu,2)+(w.absActive?' · ABS':''):L('离地','air'));}
    const slip=(t.wheelStates??[]).reduce((n,w)=>n+(w.contact?w.slipPowerW??0:0),0);
    live('detail').textContent=(mission?.finite?L('剩余 ','Remaining ')+f(Math.max(0,RESOURCE_ROUTE.deadlineS-(t.simTime-mission.startedAt)))+' s · '+f(t.energyKWh*1000,1)+' Wh · '+f(t.gasMass,1)+' kg · ':preparation?.finite?L('准备：120 Wh / 有限气源 · ','Prepared: 120 Wh / finite gas · '):'')+L('回充 ','Charge ')+f((t.energyAccounting?.chargePowerW??0)/1000,1)+' kW · '+L('滑移耗散 ','Slip dissipation ')+f(slip/1000,1)+' kW · '+(run&&!run.finished?L('记录中','recording'):getPaused()?L('暂停准备','paused'):L('自由驾驶','free driving'));
  }
  const stopLanguage=onLanguageChange(render);render();
  return{update,afterStep,needsFixedStep:()=>!!run&&!run.finished,cancel(reason='scene-change'){if(run&&!run.finished)finish(reason);descriptor=null;preparation=null;mission=null;run=null;hud.hidden=true;},getState:()=>({prepared:!!descriptor,recordId,run:run?{...run}:null,lastResult:lastResult?structuredClone(lastResult):null,resource:mission?{finite:mission.finite,identity:mission.identity,failure:mission.failure}:null,resourceHistory:structuredClone(resourceHistory),resourcePersistence:history.snapshot()}),setFeedback({sound,head}={}){if(sound!==undefined)$('sound').checked=!!sound;if(head!==undefined)$('head').checked=!!head;},dispose(){stopLanguage();section.remove();hud.remove();}};
}
