import {getLanguage,onLanguageChange} from './i18n.js';
import {ResourceMission,RESOURCE_ROUTE,prepareResourceRoute,completeResourcePreparation,comparableResourceRuns,resourceRunDifference,resourceInitialState,resourceVerdict} from './resource-mission.js';
import {exportJson} from './export-download.js';
import {sharedInputs} from './semantic-input.js';
import {routeSurfaceProgress} from './route-surface.js';
const L=(zh,en)=>getLanguage()==='en'?en:zh;
const f=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—';
export function createRouteExperience({mount,hudMount,getSim,getPaused,getContext,getRecording=()=>null,getSessionMode=()=> 'live',onPrepare,onStart,onFinish,onInspect,onOpen,onSound,onHead,recordEvent=()=>{},notify=()=>{}}){
  const doc=mount.ownerDocument,section=doc.createElement('section');section.className='route-experience';section.dataset.noI18n='';
  section.innerHTML='<p class="route-eyebrow">01 / WEAVE STREET · 302.5 m</p><h3 data-route="title"></h3><p data-route="intro"></p><label><span data-route="condition-label"></span><select data-route="condition"><option value="dry-day"></option><option value="after-rain"></option><option value="after-rain-night"></option></select></label><div class="route-actions"><button data-route-action="prepare"></button><button data-route-action="start"></button><button data-route-action="end"></button></div><label class="route-feedback"><input type="checkbox" data-route="sound"><span data-route="sound-label"></span></label><label class="route-feedback"><input type="checkbox" data-route="head" checked><span data-route="head-label"></span></label><p data-route="status" role="status"></p><p class="field-help" data-route="limits"></p><button data-route-action="inspect"></button>';
  mount.prepend(section);const $=key=>section.querySelector('[data-route="'+key+'"]'),action=key=>section.querySelector('[data-route-action="'+key+'"]');
  const hud=doc.createElement('aside');hud.className='route-driving-card';hud.dataset.noI18n='';hud.hidden=true;hud.innerHTML='<div><strong data-live="title"></strong><button data-live="open">↗</button></div><p data-live="instruction"></p><div data-live="wheels"></div><small data-live="detail"></small>';hudMount.append(hud);
  const live=key=>hud.querySelector('[data-live="'+key+'"]');live('open').onclick=onOpen;
  const style=doc.createElement('style');style.textContent='.route-experience{padding:18px 16px;margin:4px 0 22px;background:#172a2de8;border:1px solid #8bb3a866;border-radius:10px}.route-experience h3{font-size:21px;margin:5px 0 12px}.route-experience p{line-height:1.6}.route-experience label{display:block}.route-experience select{width:100%;margin-top:6px}.route-eyebrow{font-size:10px;letter-spacing:1.2px;color:#aed1bb}.route-actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.route-feedback{font-size:12px;margin:8px 0}.route-driving-card{position:relative;width:100%;box-sizing:border-box;flex:0 0 auto;padding:10px 14px;border:1px solid #8ab4a55c;background:#102427e8;border-radius:8px;color:#deeee3;font-size:12px;pointer-events:auto;z-index:18}.route-driving-card[hidden]{display:none}.route-driving-card>div:first-child{display:flex;justify-content:space-between;align-items:center}.route-driving-card button{padding:2px 8px;background:transparent;border:0;color:inherit}.route-driving-card p{margin:7px 0}.route-driving-card [data-live=wheels]{display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px}.route-driving-card [data-live=wheels]>span{padding:4px 6px;background:#c5dec40a;border-left:2px solid #99bea5}.route-driving-card small{display:block;margin-top:6px;color:#a9c1b8;line-height:1.5}@media(max-width:750px){.route-driving-card{padding:9px 11px}}';section.append(style);
  const resourceControls=doc.createElement('div');resourceControls.innerHTML='<label><span data-resource="mode-label"></span><select data-resource="mode"><option value="finite"></option><option value="practice"></option></select></label><p data-resource="budget"></p><p data-resource="accounting"></p><details><summary data-resource="history-title"></summary><p data-resource="comparison"></p><div data-resource="history"></div><button data-resource="export"></button><p data-resource="storage" role="status"></p></details>';
  section.insertBefore(resourceControls,$('limits'));const resource=key=>resourceControls.querySelector('[data-resource="'+key+'"]');
  let mission=null,preparation=null,busy=false;const resourceHistory=[];
  try{const stored=JSON.parse(globalThis.localStorage?.getItem('roadster-resource-runs-3.21')??'[]');if(Array.isArray(stored))for(const r of stored.slice(-6))if(r?.schema==='roadster-resource-route-1'&&typeof r.comparisonKey==='string'&&r.comparisonKey.length<100000&&r.work&&['elapsedS','remainingKWh','gasUsedKg','netEnergyJ'].every(k=>Number.isFinite(r[k])))resourceHistory.push(r);}catch{}
  function renderHistory(){resource('history').replaceChildren();const latest=resourceHistory.at(-1);
    const previous=resourceHistory.slice(0,-1).findLast(item=>comparableResourceRuns(latest,item));
    const delta=resourceRunDifference(latest,previous),signed=(v,n=2)=>(v>0?'+':'')+f(v,n);
    resource('comparison').textContent=delta?L('最近一次相对上一条有效同条件成绩：','Latest versus previous valid matching run: ')+signed(delta.elapsedS)+' s · '+signed(delta.netWh)+' Wh · '+signed(delta.gasKg)+' kg · '+L('回充 ','recovered ')+signed(delta.recoveredWh)+' Wh':L('完成两次完整初态相同的路线后，显示用时、用电与耗气差值。失败或条件不同的记录保留，但不参与成绩比较。','Complete two runs with identical full initial states to compare time, energy and gas. Failed or unmatched runs are retained but excluded from comparison.');
    resource('export').textContent=L('导出这 6 次以内的收支摘要','Export these run summaries (up to six)');resource('export').disabled=!resourceHistory.length;for(const item of resourceHistory.toReversed()){const row=doc.createElement('p');const comparable=comparableResourceRuns(item,latest);row.textContent=(item.finite?L('有限任务','Finite'):L('自由练习','Practice'))+' · '+resourceVerdict(item.reason,getLanguage()==='en')+' · '+f(item.elapsedS)+' s · '+f(item.netEnergyJ/3600,2)+' Wh · '+f(item.gasUsedKg,2)+' kg · '+L('回充 ','recovered ')+f(item.work.recoveredJ/3600,2)+' Wh'+(item.resourceEvidence?.scope==='last-measured-valid-state'?L(' · 最后有效采样',' · last valid sample'):'')+(item!==latest?(comparable?L(' · 与最近一次同条件',' · matched to latest'):L(' · 未完成或条件不同，不比较',' · incomplete or unmatched')):'');
    if(item.recordId){const inspect=doc.createElement('button');inspect.textContent=L('查看输入 / 重放','Inputs / replay');inspect.onclick=()=>onInspect(item.recordId);row.append(doc.createElement('br'),inspect);}resource('history').append(row);}}
  resource('export').onclick=()=>exportJson(()=>({schema:'roadster-resource-summary-1',runs:structuredClone(resourceHistory),scope:'Resource summaries; use Inputs / replay for full fixed-step records.'}),'roadster-resource-runs.json',{doc});
  resource('mode').onchange=()=>{preparation=null;message=L('模式已改变；必须重新准备，不能沿用上次资源初态。','Mode changed. Prepare again; the previous initial state cannot be reused.');update();};
  let descriptor=null,run=null,recordId=null,lastResult=null,lastRegion='',lastCheckpoint=-1,completeTime=0,message='';
  function render(){
    resource('mode-label').textContent=L('驾驶方式','Run mode');resource('mode').options[0].textContent=L('有限资源挑战','Finite-resource mission');resource('mode').options[1].textContent=L('自由练习（外部恒压气源）','Free practice (external constant-pressure gas)');
    resource('budget').textContent=L('同一条 302.5 m 街道：65 秒内停稳，起始可用电量 120 Wh、100 bar / 600 L 气源；终点保留 5 Wh 和 5 kg 气。提前滑行与回充省电，冷气加速省时但耗气。200 kWh 电池的近耗尽初态，不是缩小电池。','Same 302.5 m street: stop within 65 s, with 120 Wh available and a 100 bar / 600 L gas tank; retain 5 Wh and 5 kg gas. Coasting and regeneration save electricity; cold-gas boost trades gas for time. Near-empty initial state of a 200 kWh battery, not a smaller battery.');
    resource('history-title').textContent=L('最近 6 次收支与复盘（同构建同条件才比较）','Last six runs and replay (compare only matching build/conditions)');renderHistory();
    $('title').textContent=L('一段路，读懂车的反应','One street. Read the car.');
    $('intro').textContent=L('经过桥下检修面、局部潮湿与半幅交界，在横街左转后停车。建议 30 km/h，入弯前减速。','Cross the service plate, damp patches and split surface, turn left onto the cross street, then stop. Suggested 30 km/h; brake before the turn.');
    $('condition-label').textContent=L('下一次准备条件','Next preparation');
    for(const [value,zh,en]of [['dry-day','干燥白天 · 标定路面','Dry day · mapped road'],['after-rain','雨后白天 · 局部潮湿','After rain · daylight'],['after-rain-night','雨后夜间 · 同一物理路面','After rain · night, same grip']])$('condition').querySelector('[value="'+value+'"]').textContent=L(zh,en);
    action('prepare').textContent=L('准备路线 · 复位并暂停','Prepare route · reset and pause');action('start').textContent=L('开始驾驶并记录','Drive and record');action('end').textContent=L('结束本次记录','Finish recording');
    action('inspect').textContent=L('查看这次记录 / 原条件重放','Inspect record / original replay');
    $('sound-label').textContent=L('开启轮胎 / 制动 / 落地声音','Tyre, braking and touchdown audio');$('head-label').textContent=L('驾驶舱轻微头部惯性','Subtle cockpit head movement');
    $('limits').textContent=L('准备会建立新的路线初态并清空当前输入；只在暂停时应用。行驶中切换观赏昼夜不改变附着。湿润、外观和抓地分别标定，未模拟水滑。','Preparation creates a new route initial state and clears input, only while paused. Presentation lighting never changes grip during a run. Moisture, appearance and friction are separate; no hydroplaning model.');
    update();
  }
  async function perform(name){if(busy)return;busy=true;try{
    if(name==='prepare'){
      if(!getPaused()||getSessionMode()!=='live'||run&&!run.finished)throw Error(L('先暂停并结束当前路线。','Pause and end the current route first.'));
      preparation=null;const finite=resource('mode').value==='finite';const result=await onPrepare($('condition').value,{prepareSim:sim=>prepareResourceRoute(sim,finite)});preparation=completeResourcePreparation(getSim(),finite);mission=null;descriptor=result.descriptor;run=null;recordId=null;lastRegion='';lastCheckpoint=-1;completeTime=0;message=L('初态已准备；开始后用已绑定的前进 / 制动动作驾驶。','Prepared. Start and use your bound forward / brake actions.');
    }else if(name==='start'){
      if(!descriptor||run||!preparation)throw Error(L('每次驾驶请重新准备路线。','Prepare the route again for each attempt.'));
      const sim=getSim(),t=sim.telemetry(),origin=descriptor.route.start;
      if(getSessionMode()!=='live'||!getPaused()||Math.hypot(t.position.x-origin.x,t.position.z-origin.z)>3||Math.hypot(t.velocity.x,t.velocity.z)>.45)throw Error(L('请重新准备路线，在起点停稳后开始。','Prepare the route and start while stopped at its beginning.'));
      if(preparation.params!==JSON.stringify(sim.params)||preparation.finite!==(resource('mode').value==='finite')||preparation.initialState!==resourceInitialState(sim))throw Error(L('条件已改变，请重新准备。','Conditions changed; prepare again.'));
      mission=new ResourceMission(sim,{finite:preparation.finite,descriptorHash:sim.getRouteSurface()?.descriptorHash,inputProfile:sharedInputs.getProfile()});
      const result=onStart(descriptor);recordId=result?.id??result?.recordId??null;mission.recordId=recordId;recordEvent('resource_route_start',{identity:mission.identity,resourceBudget:preparation.finite?RESOURCE_ROUTE:null});run={startedAt:sim.simTime,descriptorHash:sim.getRouteSurface()?.descriptorHash,maximumDistanceM:0,passedCheckpoints:[],finished:false};message='';lastCheckpoint=-1;completeTime=0;
    }else if(name==='end')finish('pilot-ended');
    else if(name==='inspect')onInspect(recordId);
  }catch(error){message=error.message;notify(message,6500);}finally{busy=false;}update();}
  for(const name of ['prepare','start','end','inspect'])action(name).onclick=()=>perform(name);
  $('sound').onchange=()=>onSound($('sound').checked);$('head').onchange=()=>onHead($('head').checked);
  function finish(reason,{stopRecording=true}={}){if(!run||run.finished)return;run.finished=true;const budget=mission?.result(getSim(),reason);if(budget){recordEvent('resource_route_result',budget);resourceHistory.push(budget);if(resourceHistory.length>6)resourceHistory.shift();try{if(!globalThis.localStorage)throw Error('Storage unavailable');globalThis.localStorage.setItem('roadster-resource-runs-3.21',JSON.stringify(resourceHistory));resource('storage').textContent='';}catch{resource('storage').textContent=L('当前浏览器未保存摘要。关闭页面前可导出；本次仍保留在内存中。','Summary was not saved in this browser. Export before closing; it remains available in this session.');}renderHistory();}const result=stopRecording?onFinish(budget&&!budget.completed&&reason==='route-completed'?budget.reason:reason):null;lastResult={recordId:result?.id??recordId,reason:budget?.reason??reason,elapsedS:getSim().simTime-run.startedAt,distanceM:run.maximumDistanceM,descriptorHash:run.descriptorHash};recordId=lastResult.recordId;message=reason==='route-completed'?L('已沿路线到达终点并停车；记录已结束，可查看本次路况与输入。','Route completed and stopped. The run is ready to inspect.'):L('本次路线记录已结束。','Route recording ended.');if(budget)message=resourceVerdict(budget.reason,getLanguage()==='en')+' · '+f(budget.elapsedS)+' s · '+L('净用电 ','net ')+f(budget.netEnergyJ/3600,2)+' Wh · '+L('用气 ','gas ')+f(budget.gasUsedKg,2)+' kg';if(budget?.resourceEvidence?.scope==='last-measured-valid-state')message+=L(' · 数值取最后有效采样，非精确失败瞬间',' · values from last valid sample, not the exact failure instant');notify(message,6500);}
  function syncRecording(t){
    const recording=getRecording();
    if(run&&!run.finished&&t.fault){finish('simulation-fault',{stopRecording:false});return;}
    if(run&&!run.finished&&recording&&(!recording.recording||recording.id&&recordId&&recording.id!==recordId)){
      finish('recording-ended-externally',{stopRecording:false});
    }
  }
  function afterStep(t,dt){
    syncRecording(t);
    if(!run||run.finished||!descriptor)return;
    const failed=mission?.check(getSim(),t);if(failed){finish(failed.reason);return;}
    const progress=routeSurfaceProgress(descriptor,t.position);run.maximumDistanceM=Math.max(run.maximumDistanceM,progress?.distanceM??0);
    const checkpoint=progress.distanceM<60?0:progress.distanceM<180?1:progress.distanceM<235?2:3;
    if(checkpoint!==lastCheckpoint){recordEvent('route_checkpoint',{checkpoint,distanceM:progress.distanceM,descriptorHash:run.descriptorHash,energy:t.energyAccounting,gasKg:t.gasMass});lastCheckpoint=checkpoint;}
    if(progress.lateralDistanceM<9&&t.contactCount>=3&&checkpoint===run.passedCheckpoints.length)run.passedCheckpoints.push(checkpoint);
    const region=(t.wheelStates??[]).map(w=>w.contact?w.surfaceId??'legacy':'air').join('|');if(region!==lastRegion){recordEvent('route_wheel_surface',{regions:(t.wheelStates??[]).map(w=>({wheel:w.id,surfaceId:w.surfaceId,mu:w.surfaceMu,contact:w.contact})),descriptorHash:run.descriptorHash});lastRegion=region;}
    const end=descriptor.route.waypoints.at(-1),distance=Math.hypot(t.position.x-end.x,t.position.z-end.z),speed=Math.hypot(t.velocity.x,t.velocity.z);
    const stable=t.contactCount===4&&Math.abs(t.rollDeg)<5&&Math.abs(t.pitchDeg)<5&&Math.abs(t.velocity.y)<.2&&Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z)<.2;
    completeTime=distance<5&&speed<.45&&stable&&progress.distanceM>295&&run.passedCheckpoints.length===4?completeTime+dt:0;
    if(completeTime>=.5)finish('route-completed');
  }
  function update(){
    const sim=getSim(),surface=sim.getRouteSurface?.(),t=sim.telemetry();
    const active=surface&&surface.descriptor.id==='weave-learning-route'&&getContext()==='city';
    syncRecording(t);
    action('prepare').disabled=getSessionMode()!=='live'||!getPaused()||!!run&&!run.finished;action('start').disabled=getSessionMode()!=='live'||!getPaused()||!active||!descriptor||!preparation||!!run;action('end').disabled=!run||run.finished;action('inspect').disabled=!recordId||!!run&&!run.finished;
    resource('mode').disabled=!!run&&!run.finished;
    const energy=t.energyAccounting;resource('accounting').textContent=energy?L('电池收支：','Battery balance: ')+f(energy.motorElectricalJ/3600,2)+' Wh '+L('电驱 + ','drive + ')+f((energy.fanJ+energy.auxiliaryJ)/3600,2)+' Wh '+L('风扇/附件 − ','fan/aux − ')+f(energy.recoveredJ/3600,2)+' Wh '+L('回充；轮胎滑移热不回收。','recovered; tyre slip heat is not recovered.'):'';
    $('condition').disabled=!!run&&!run.finished;
    $('status').textContent=message||(run&&!run.finished?L('记录中 · ','Recording · ')+f(t.simTime-run.startedAt)+' s':L('暂停后准备一组新条件。','Pause to prepare new conditions.'));
    hud.hidden=!active||!descriptor||getSessionMode()!=='live';if(hud.hidden)return;
    const desc=surface.descriptor,progress=routeSurfaceProgress(desc,t.position),remaining=progress.remainingM,turn=247.5-progress.distanceM;
    live('title').textContent=L(desc.label,desc.labelEn)+' · '+f(progress.distanceM,0)+' / 303 m';
    live('instruction').textContent=progress.lateralDistanceM>9?L('已偏离示范路线 · 沿原车道返回','Outside the route · return via the road'):turn>25?L('沿街直行 · 路口前减速','Continue along the street · brake before the junction'):turn>0?L('前方左转 · 先制动，再使用左转动作','Turn left ahead · brake, then use your left action'):remaining>5?L('沿横街前进 · 终点前停车','Continue on cross street · stop at the end'):L('终点 · 制动至四轮停稳','Finish · brake to a stable stop');
    live('wheels').replaceChildren();for(const [i,w]of (t.wheelStates??[]).entries()){const badge=doc.createElement('span');badge.textContent=(w.id??['FL','FR','RL','RR'][i])+' '+(w.contact?L(w.surfaceLabel??'旧路面',w.surfaceLabelEn??'Legacy road')+' μ '+f(w.surfaceMu,2)+(w.absActive?' · ABS':''):L('离地','air'));live('wheels').append(badge);}
    const slip=(t.wheelStates??[]).reduce((n,w)=>n+(w.contact?w.slipPowerW??0:0),0);
    live('detail').textContent=(mission?.finite?L('剩余 ','Remaining ')+f(Math.max(0,RESOURCE_ROUTE.deadlineS-(t.simTime-mission.startedAt)))+' s · '+f(t.energyKWh*1000,1)+' Wh · '+f(t.gasMass,1)+' kg · ':preparation?.finite?L('准备：120 Wh / 有限气源 · ','Prepared: 120 Wh / finite gas · '):'')+L('回充 ','Charge ')+f((t.energyAccounting?.chargePowerW??0)/1000,1)+' kW · '+L('滑移耗散 ','Slip dissipation ')+f(slip/1000,1)+' kW · '+(run&&!run.finished?L('记录中','recording'):getPaused()?L('暂停准备','paused'):L('自由驾驶','free driving'));
  }
  const stopLanguage=onLanguageChange(render);render();
  return{update,afterStep,needsFixedStep:()=>!!run&&!run.finished,cancel(reason='scene-change'){if(run&&!run.finished)finish(reason);descriptor=null;preparation=null;mission=null;run=null;hud.hidden=true;},getState:()=>({prepared:!!descriptor,recordId,run:run?{...run}:null,lastResult:lastResult?{...lastResult}:null,resource:mission?{finite:mission.finite,identity:mission.identity,failure:mission.failure}:null,resourceHistory:structuredClone(resourceHistory)}),setFeedback({sound,head}={}){if(sound!==undefined)$('sound').checked=!!sound;if(head!==undefined)$('head').checked=!!head;},dispose(){stopLanguage();section.remove();hud.remove();}};
}
