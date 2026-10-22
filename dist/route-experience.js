import {getLanguage,onLanguageChange} from './i18n.js';
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
  let descriptor=null,run=null,recordId=null,lastResult=null,lastRegion='',lastCheckpoint=-1,completeTime=0,message='';
  function render(){
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
  async function perform(name){try{
    if(name==='prepare'){
      const result=await onPrepare($('condition').value);descriptor=result.descriptor;run=null;recordId=null;lastRegion='';lastCheckpoint=-1;completeTime=0;message=L('初态已准备；开始后按 W 驾驶，空格制动。','Prepared. Start, then W to drive and Space to brake.');
    }else if(name==='start'){
      if(!descriptor||run)throw Error(L('每次驾驶请重新准备路线。','Prepare the route again for each attempt.'));
      const sim=getSim(),t=sim.telemetry(),origin=descriptor.route.start;
      if(getSessionMode()!=='live'||!getPaused()||Math.hypot(t.position.x-origin.x,t.position.z-origin.z)>3||Math.hypot(t.velocity.x,t.velocity.z)>.45)throw Error(L('请重新准备路线，在起点停稳后开始。','Prepare the route and start while stopped at its beginning.'));
      const result=onStart(descriptor);recordId=result?.id??result?.recordId??null;run={startedAt:sim.simTime,descriptorHash:sim.getRouteSurface()?.descriptorHash,maximumDistanceM:0,passedCheckpoints:[],finished:false};message='';lastCheckpoint=-1;completeTime=0;
    }else if(name==='end')finish('pilot-ended');
    else if(name==='inspect')onInspect(recordId);
  }catch(error){message=error.message;notify(message,6500);}update();}
  for(const name of ['prepare','start','end','inspect'])action(name).onclick=()=>perform(name);
  $('sound').onchange=()=>onSound($('sound').checked);$('head').onchange=()=>onHead($('head').checked);
  function finish(reason){if(!run||run.finished)return;run.finished=true;const result=onFinish(reason);lastResult={recordId:result?.id??recordId,reason,elapsedS:getSim().simTime-run.startedAt,distanceM:run.maximumDistanceM,descriptorHash:run.descriptorHash};recordId=lastResult.recordId;message=reason==='route-completed'?L('已沿路线到达终点并停车；记录已结束，可查看本次路况与输入。','Route completed and stopped. The run is ready to inspect.'):L('本次路线记录已结束。','Route recording ended.');notify(message,6500);}
  function syncRecording(t){
    const recording=getRecording();
    if(run&&!run.finished&&recording&&(!recording.recording||recording.id&&recordId&&recording.id!==recordId)){
      run.finished=true;lastResult={recordId,reason:'recording-ended-externally',descriptorHash:run.descriptorHash,elapsedS:t.simTime-run.startedAt,distanceM:run.maximumDistanceM};message=L('记录已在其他面板结束；可查看对应记录，重新准备下一次。','Recording ended in another panel. Inspect this record or prepare another attempt.');
    }
  }
  function afterStep(t,dt){
    syncRecording(t);
    if(!run||run.finished||!descriptor)return;
    const progress=routeSurfaceProgress(descriptor,t.position);run.maximumDistanceM=Math.max(run.maximumDistanceM,progress?.distanceM??0);
    const checkpoint=progress.distanceM<60?0:progress.distanceM<180?1:progress.distanceM<235?2:3;
    if(checkpoint!==lastCheckpoint){recordEvent('route_checkpoint',{checkpoint,distanceM:progress.distanceM,descriptorHash:run.descriptorHash});lastCheckpoint=checkpoint;}
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
    action('prepare').disabled=getSessionMode()!=='live'||!getPaused()||!!run&&!run.finished;action('start').disabled=getSessionMode()!=='live'||!getPaused()||!active||!descriptor||!!run;action('end').disabled=!run||run.finished;action('inspect').disabled=!recordId||!!run&&!run.finished;
    $('condition').disabled=!!run&&!run.finished;
    $('status').textContent=message||(run&&!run.finished?L('记录中 · ','Recording · ')+f(t.simTime-run.startedAt)+' s':L('暂停后准备一组新条件。','Pause to prepare new conditions.'));
    hud.hidden=!active||!descriptor||getSessionMode()!=='live';if(hud.hidden)return;
    const desc=surface.descriptor,progress=routeSurfaceProgress(desc,t.position),remaining=progress.remainingM,turn=247.5-progress.distanceM;
    live('title').textContent=L(desc.label,desc.labelEn)+' · '+f(progress.distanceM,0)+' / 303 m';
    live('instruction').textContent=progress.lateralDistanceM>9?L('已偏离示范路线 · 沿原车道返回','Outside the route · return via the road'):turn>25?L('沿街直行 · 路口前减速','Continue along the street · brake before the junction'):turn>0?L('前方左转（A）· 先制动，再转向','Turn left ahead (A) · brake, then steer'):remaining>5?L('沿横街前进 · 终点前停车','Continue on cross street · stop at the end'):L('终点 · 制动至四轮停稳','Finish · brake to a stable stop');
    live('wheels').replaceChildren();for(const [i,w]of (t.wheelStates??[]).entries()){const badge=doc.createElement('span');badge.textContent=(w.id??['FL','FR','RL','RR'][i])+' '+(w.contact?L(w.surfaceLabel??'旧路面',w.surfaceLabelEn??'Legacy road')+' μ '+f(w.surfaceMu,2)+(w.absActive?' · ABS':''):L('离地','air'));live('wheels').append(badge);}
    const slip=(t.wheelStates??[]).reduce((n,w)=>n+(w.contact?w.slipPowerW??0:0),0);
    live('detail').textContent=L('滑移耗散 ','Slip dissipation ')+f(slip/1000,1)+' kW · '+(run&&!run.finished?L('记录中','recording'):getPaused()?L('暂停准备','paused'):L('自由驾驶','free driving'));
  }
  const stopLanguage=onLanguageChange(render);render();
  return{update,afterStep,needsFixedStep:()=>!!run&&!run.finished,cancel(reason='scene-change'){if(run&&!run.finished)finish(reason);descriptor=null;run=null;hud.hidden=true;},getState:()=>({prepared:!!descriptor,recordId,run:run?{...run}:null,lastResult:lastResult?{...lastResult}:null}),setFeedback({sound,head}={}){if(sound!==undefined)$('sound').checked=!!sound;if(head!==undefined)$('head').checked=!!head;},dispose(){stopLanguage();section.remove();hud.remove();}};
}
