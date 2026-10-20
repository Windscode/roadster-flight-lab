import {getLanguage,t as tr} from './i18n.js';
import {estimateLandingReserve,controlLimitFeedback} from './landing-reserve.js';
import {pilotIntentMessage} from './pilot-input-intent.js';
const f=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
export function createOperationHud({mount,getSim,getContext,getOwner=()=>'',getLastAction=()=>null,exportInputs=()=>{}}){
  const doc=mount.ownerDocument,node=doc.createElement('aside');node.className='operation-hud';node.setAttribute('data-no-i18n','');
  node.innerHTML='<strong data-operation="identity"></strong><p data-operation="limits"></p><p data-operation="intent" role="status"></p><p class="operation-action" data-operation="action" role="status" hidden></p><p class="operation-attitude" data-operation="attitude"></p><details class="operation-detail"><summary data-operation="summary"></summary><p data-operation="motion-scope"></p><p data-operation="authority"></p><p data-operation="reserve"></p><p data-operation="scope"></p><button type="button" data-operation="export"></button></details>';
  mount.append(node);const $=name=>node.querySelector('[data-operation="'+name+'"]');$('export').addEventListener('click',exportInputs);
  let cached=null,sampled=-Infinity,lastContext=null;
  const limitNames={ 'pressure-derating':['压力降额','Pressure derating'],'attitude-support-limit':['当前姿态无法静态承重','No static support at this attitude'],'force-or-torque-saturation':['合力 / 力矩受限','Force / torque saturation'],'valve-rise':['阀门正在建立推力','Valve thrust building'],'tcs-torque-limit':['TCS 限矩','TCS torque limit'],'combined-tire-grip':['转向与驱动共用附着','Shared cornering / drive grip'],'motor-power-limit':['电机功率受限','Motor power limit'],'lift-off-regeneration':['松油门再生制动','Lift-off regeneration']};
  return{node,update(t,{paused=false}={}){
    const en=getLanguage()==='en',L=(zh,enText)=>en?enText:zh,context=getContext(),sim=getSim();
    const now=performance.now();if(now-sampled>500||lastContext!==context||!cached){const clearance=sim.getClearanceEstimate({maxDistance:120,includeQuickRoll:false,directions:['down']});cached=estimateLandingReserve(t,sim.params,clearance);sampled=now;lastContext=context;}
    const gas=t.supplyMode==='bench'?L('恒压外供气','External constant pressure'):L('有限储气','Finite tank');
    const wind=t.wind&&(t.wind.speedMps||t.wind.gustMps)?L('有风','Wind'):L('无风','No wind'),fault=t.nozzleFault?L('故障 ','Fault ')+t.nozzleFault.id+' '+Math.round(t.nozzleFault.scale*100)+'%':L('无故障','No fault');
    const owner=getOwner()||t.pilotIntent?.controller||t.mode;
    const owners={'ground-drive':['驾驶者','Pilot'],'g-level':['G 回正','G level'],'g-pitch-override':['驾驶者俯仰 / G 待命','Pilot pitch / G armed'],'pilot-attitude-rate':['手动姿态','Pilot attitude'],'pose-hold':['研究保持','Research hold'],'maneuver':['自动动作','Maneuver'],'raw-wrench':['原始推力','Raw thrust']};
    $('identity').textContent=(context==='lab'?L('实验室','Lab'):L('城市','City'))+' · '+gas+' · '+(owners[owner]?.[en?1:0]||owner)+(paused?' · '+L('暂停','Paused'):'');
    const feedback=controlLimitFeedback(t),reasons=feedback.reasons.slice(0,2).map(k=>limitNames[k]?.[en?1:0]||k);
    $('limits').textContent=wind+' · '+fault+(reasons.length?' · '+reasons.join(' / '):'');
    $('limits').title=L('请求 / 实现 ','Requested / achieved ')+f(feedback.requested,0)+' / '+f(feedback.achieved,0)+' '+feedback.unit;
    const intent=pilotIntentMessage(t.pilotIntent,getLanguage());$('intent').textContent=intent;$('intent').hidden=!intent;
    const receipt=getLastAction(),feedbackRun=t.maneuverFeedback?.lastRun,physicsAction=t.maneuverFeedback?.lastAction;
    const rejected=receipt?.accepted===false&&receipt.simTime>=Math.max(physicsAction?.simTimeS??-Infinity,feedbackRun?.startedAtSimTimeS??-Infinity);
    const action=rejected?receipt:feedbackRun??physicsAction??receipt;
    const actionNames={roll:L('X 快速滚转','X quick roll'),land:L('L 自动着陆','L auto land'),KeyX:L('X 快速滚转','X quick roll'),KeyG:L('G 回平','G level')};
    const actionStates={accepted:L('已接收','Accepted'),rejected:L('未执行','Not executed'),running:L('进行中','Running'),completed:L('已完成','Completed'),cancelled:L('已取消','Cancelled'),interrupted:L('已中断','Interrupted'),aborted:L('已中止','Aborted')};
    $('action').hidden=!action;
    if(action){const hasRun=action===feedbackRun;const state=actionStates[action.state]??action.state??'';
      $('action').textContent=(actionNames[action.name]||action.name)+' · '+state+(hasRun?' · '+f(action.elapsedS,2)+' s / '+f(action.actualRollTravelDeg,1)+'°':action.reason?' · '+tr(action.reason):'');
      $('action').title=tr(action.reason||'');$('action').dataset.state=action.state||'';
    }
    const travel=t.attitudeTravel;const recovery=t.levelRecovery;
    const recoveryNames={inactive:L('G 关闭','G off'),armed:L('G 待命','G armed'),surface:L('地面接触','Surface contact'),recovering:L('G 回平中','G recovering'),limited:L('G 力矩 / 支撑受限','G torque / support limited'),'pilot-pitch':L('手动俯仰，G 待命','Pilot pitch; G armed'),settled:L('G 已回平','G level settled'),level:L('G 已回平','G level settled')};
    $('attitude').textContent=L('姿态 P / R ','Pose P / R ')+f(t.pitchDeg,0)+'° / '+f(t.rollDeg,0)+'°'+(travel?'\n'+L('累计俯仰 / 滚转 ','Pitch / roll travel ')+f(travel.pitchDeg,0)+'° / '+f(travel.rollDeg,0)+'°':'')+(recovery?' · '+(recoveryNames[recovery.status]??recovery.status):'');
    $('motion-scope').textContent=L('累计值从最近复位开始，逐物理步积分实际四元数的机体轴转角；不使用欧拉角展开。复合旋转的单轴累计达到 360°，仍不等于干净完成一次完整后翻。','Travel integrates actual body-axis quaternion increments since reset, not unwrapped Euler angles. A 360° component during compound motion alone does not prove a clean backflip.');
    const authority=t.controlAuthority;
    $('authority').textContent=authority?L('当前姿态竖直推力上界 / 重力：','Current-pose vertical thrust bound / weight: ')+f(authority.verticalForceUpperBoundN,0)+' / '+f(authority.weightN,0)+' N · '+L('饱和喷口 ','Saturated nozzles ')+(authority.saturatedNozzles?.join(', ')||'—')+(recovery?'\n'+L('回平倾斜误差 ','Level tilt error ')+f(recovery.tiltErrorDeg,1)+'°':''):'';
    const hover=cached.hover.feasible?L('可静态悬停','Static hover feasible'):L('悬停承重不足','Insufficient static support');
    const arrest=!cached.arrest.available?L('止降未估计','Arrest not estimated'):cached.arrest.possible?L('止降估计可行','Arrest estimated feasible'):L('当前净空不足以止降','Insufficient arrest clearance');
    const reserve=cached.status==='grounded'?L('轮胎承载','On wheels'):cached.status==='insufficient-support'||cached.status==='insufficient'?L('着陆储备不足','Landing reserve insufficient'):cached.status==='unavailable'?L('着陆储备不可得','Landing reserve unavailable'):L('着陆余量估计','Landing reserve estimate');
    $('summary').textContent=reserve+(t.supplyMode==='finite'&&cached.landing.status==='soft-contact-estimate'?' · '+f(cached.landing.gasRemainingKg,0)+' kg':'');
    node.dataset.reserveStatus=cached.status;node.dataset.reserve=JSON.stringify(cached);
    $('reserve').textContent=hover+' · '+arrest+(cached.arrest.heightRequiredM!==null&&cached.arrest.heightRequiredM!==undefined?' ('+f(cached.arrest.heightRequiredM,2)+' m)':'')+'\n'+(t.supplyMode==='bench'?L('外供气不显示有限续航。','No finite endurance for external supply.'):cached.landing.available?L('预计耗气 / 余气：','Estimated use / remaining: ')+f(cached.landing.gasRequiredKg)+' / '+f(cached.landing.gasRemainingKg)+' kg':L('无法可靠估计当前着陆耗气。','Current landing gas use cannot be estimated reliably.'));
    $('scope').textContent=L('仿真内估计：近水平、低横速、采样下表面，未预测横风、侧向障碍和未来故障。15% 配平余量；超出范围显示不可得。不是实车安全保证。','Simulation advisory: near level, low horizontal speed and sampled lower surface. Wind, lateral obstacles and future faults are not predicted. 15% trim reserve; outside scope is unavailable. Not a real-car safety guarantee.');
    $('export').textContent=L('导出最近输入时序','Export recent input timeline');
    return cached;
  },invalidate(){sampled=-Infinity;},snapshot:()=>cached};
}
