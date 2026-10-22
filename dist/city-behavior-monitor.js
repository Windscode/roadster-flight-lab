/** Advisory observations only. No force, pose, score, threshold or controller
 * authority is modified. A notice is emitted once per sustained episode. */
const copy=v=>JSON.parse(JSON.stringify(v));
const distance=(a,b)=>Math.hypot((a?.x??0)-(b?.x??0),(a?.y??0)-(b?.y??0),(a?.z??0)-(b?.z??0));
const angle=(a,b)=>a&&b?2*Math.acos(Math.min(1,Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w))):0;
export class CityBehaviorMonitor{
 constructor({onEvent=()=>{}}={}){this.onEvent=onEvent;this.episodes=new Map();this.action=null;this.landing=null;this.lastCompleted=null;}
 emit(type,t,detail){const event={type,simTime:t.simTime,advisory:true,causalClaim:false,detail:copy(detail)};this.onEvent(event);return event;}
 sustained(key,active,duration,t,detail){if(!active){this.episodes.delete(key);return;}let e=this.episodes.get(key);if(!e){e={at:t.simTime,emitted:false};this.episodes.set(key,e);}if(!e.emitted&&t.simTime-e.at>=duration){e.emitted=true;this.emit(key,t,{durationS:t.simTime-e.at,...detail});}}
 markReportedLanding(t,source='challenge-stable-landing'){this.landing={time:t.simTime,source};}
 update(t){
  const owner=t.controlOwnership??{},input=t.driverInput??{},explicitInput=input.frontJets>0||input.rearJets>0||input.boost===true;
  this.sustained('unowned-new-nozzle-request',owner.owner==='driver'&&!explicitInput&&(owner.commandForceN??0)>1&&!owner.valveResidualOnly,.25,t,{owner:owner.owner??null,commandForceN:owner.commandForceN??null,actualForceN:owner.actualForceN??null,valveResidualOnly:!!owner.valveResidualOnly,meaning:'New commands without a declared flight/manual/maneuver source; closing-valve residual thrust is excluded.'});
  const action=t.maneuverFeedback?.lastRun,m=t.maneuver;
  // A roll or pitch may complete by returning to its original airborne
  // height. Only the explicit wheel-supported handoff claims a landing.
  if(action?.state==='completed'&&action.reason==='wheel-supported-landing'&&action.startedAtSimTimeS!==this.lastCompleted){this.lastCompleted=action.startedAtSimTimeS;this.markReportedLanding(t,'explicit-'+action.name+'-completed');}
  const activeName=typeof m==='string'?m:m?.name??(action?.state==='running'?action.name:null),phase=typeof m==='object'?m?.phase:null;
  if(activeName){
   if(!this.action||this.action.name!==activeName||this.action.phase!==phase)this.action={name:activeName,phase,start:t.simTime,windowAt:t.simTime,position:copy(t.position),quaternion:copy(t.quaternion),motion:0,turn:0,previousPosition:copy(t.position),previousQuaternion:copy(t.quaternion),reported:false};
   const a=this.action;a.motion+=distance(t.position,a.previousPosition);a.turn+=angle(t.quaternion,a.previousQuaternion);a.previousPosition=copy(t.position);a.previousQuaternion=copy(t.quaternion);
   if(t.simTime-a.windowAt>=3){if(a.motion<.08&&a.turn<2*Math.PI/180&&!a.reported){a.reported=true;this.emit('action-no-progress',t,{name:activeName,phase,windowS:t.simTime-a.windowAt,pathM:a.motion,rotationRad:a.turn,meaning:'Sustained low motion, not a diagnosed cause; check the preceding commands and authority.'});}a.windowAt=t.simTime;a.motion=0;a.turn=0;}
   this.sustained('action-overdue',t.simTime-a.start>30,0,t,{name:activeName,phase,elapsedS:t.simTime-a.start,advisoryLimitS:30});
  }else{this.action=null;this.episodes.delete('action-overdue');}
  if(this.landing){
   const deliberateFlight=!!activeName||['flight-assist','g-level-height','manual-wrench','raw-valves','explicit-pose-hold'].includes(owner.owner)||Math.abs(input.lift??0)>.01||explicitInput;
   if(deliberateFlight||t.simTime-this.landing.time>8){this.landing=null;this.episodes.delete('reported-landed-support-lost');}
   else this.sustained('reported-landed-support-lost',(t.contactCount??0)<3,1,t,{reportedBy:this.landing.source,sinceReportS:t.simTime-this.landing.time,contactCount:t.contactCount??0,requiredContacts:3,meaning:'Reported settled state lost support for at least 1 s, with no new explicit flight request.'});
  }
 }
}
