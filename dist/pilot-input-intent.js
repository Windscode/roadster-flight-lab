/** Pilot command diagnostics describe the accepted control request, never
 * achieved motion. Physical authority remains in the existing allocator,
 * valves, gas supply and contacts. No history or continuation state is added. */
const axis=v=>Math.max(-1,Math.min(1,Number.isFinite(v)?v:0));
export function describePilotInputIntent(input={},context={}){
  const {mode='drive',stabilizationMode='off',stabilizationActive=false,contactCount=0,adhered=false,maneuver=null,pitchOverride=false,hasPower=true,pressureLimited=false,manualReferenceRate={x:0},params={}}=context;
  const requested={throttle:axis(input.throttle),steer:axis(input.steer),lift:axis(input.lift),pitch:axis(input.pitch),roll:axis(input.roll),brake:Math.max(0,axis(input.brake)),boost:!!input.boost,frontJets:Math.max(0,axis(input.frontJets)),rearJets:Math.max(0,axis(input.rearJets))};
  const raw=requested.frontJets>0||requested.rearJets>0;
  const controller=raw?'raw-valves':maneuver?'maneuver':adhered&&stabilizationMode==='level'?'surface-adhesion':pitchOverride?'g-pitch-override':stabilizationMode==='hold'?'pose-hold':stabilizationActive?'g-level':mode==='drive'?'ground-drive':mode==='manual'?'raw-wrench':'pilot-attitude-rate';
  const pitchAccepted=['g-pitch-override','pilot-attitude-rate','raw-wrench'].includes(controller);
  const pitchReason=Math.abs(requested.pitch)<=.01?'no-pitch-request':pitchAccepted?'accepted':controller==='ground-drive'?'takeoff-required':controller==='g-level'?'raw-mode-g-level-priority':controller==='surface-adhesion'?'surface-adhesion-priority':controller==='maneuver'?'maneuver-priority':controller==='raw-valves'?'raw-valve-priority':'pose-hold-priority';
  const lateral=stabilizationMode==='level'&&['g-level','g-pitch-override'].includes(controller);
  const limitations=[];
  if(Math.abs(requested.pitch)>.01&&!pitchAccepted)limitations.push(pitchReason);
  if(!hasPower)limitations.push('power-exhausted');
  if(pressureLimited)limitations.push('pressure-limited');
  if(contactCount>0&&pitchAccepted&&Math.abs(requested.pitch)>.01)limitations.push('contact-constrained');
  return{schema:'roadster.pilot-input-intent',version:1,requested,controller,stabilizationMode,gPitchOverride:pitchOverride,contactCount,
    pitch:{requested:requested.pitch,accepted:pitchAccepted,reason:pitchReason,requestedRateDegS:pitchAccepted&&controller!=='raw-wrench'?requested.pitch*(params.pitchRateDegS??60):null,
      referenceRateDegS:pitchAccepted&&controller!=='raw-wrench'?-(manualReferenceRate.x??0)*180/Math.PI:null,requestedTorqueNm:controller==='raw-wrench'?-requested.pitch*12000:null},
    roll:{requested:requested.roll,meaning:lateral?'lateral-translation':controller==='pilot-attitude-rate'?'roll-rate':controller==='raw-wrench'?'roll-moment':'inactive'},
    afterPitchRelease:stabilizationMode==='level'?'return-to-level':'hold-achieved-attitude',limitations,
    scope:'Accepted controller request only. Saturation, valve lag, finite supply and contact can prevent the requested motion.'};
}
export function pilotIntentMessage(intent,language='zh'){
  if(!intent)return'';const en=language==='en';
  if(intent.gPitchOverride)return en?'Pitch input accepted: G yields pitch while held; release to level. Z / B still move sideways.':'俯仰输入已接收：G 临时让出俯仰，松键后恢复水平；Z / B 仍为横移。';
  if(intent.pitch?.reason==='takeoff-required')return en?'1 / 2 received. Ground drive cannot pitch the supported vehicle; use E to lift off or H for flight assist.':'已收到 1 / 2。当前为轮胎驾驶；先 E 起飞或 H 进入辅助飞行，再调姿。';
  if(intent.pitch?.reason==='raw-mode-g-level-priority')return en?'Pitch request received. G level control currently owns the raw-thrust mode; disable G for the raw pitch request.':'俯仰请求已收到。原始喷口模式当前由 G 回正接管；关闭 G 后才能执行原始俯仰请求。';
  if(intent.pitch&&Math.abs(intent.pitch.requested)>.01&&!intent.pitch.accepted)return en?'Pitch request received; the current surface, valve or automatic controller has priority. Take over before adjusting attitude.':'俯仰请求已收到；当前接触、原始阀门或自动流程优先，请先接管再调姿。';
  return'';
}
