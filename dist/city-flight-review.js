/** Challenge learning uses the existing fixed-input replay executor. Display
 * samples are evidence only; they never become a continuation state. */
import {ExperimentPlayback,replayEligibility,contentLabel,canonicalJSON} from './experiment-records.js';

const copy=v=>JSON.parse(JSON.stringify(v));
const finite=v=>Number.isFinite(v)?v:null;
const length=v=>v?Math.hypot(v.x??0,v.y??0,v.z??0):0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let runSerial=0;
export const createCityRunId=()=>`city-${Date.now().toString(36)}-${(++runSerial).toString(36)}`;

export function violationMeasurements(reason,detail={},t={},summary={},route={}){
 const rows=[],add=(key,zh,en,actual,operator,threshold,unit='')=>rows.push({key,label:zh,labelEn:en,actual:finite(actual),operator,threshold:finite(threshold),unit});
 const landing=route.landing??{},gate=route.gate??{},drive=route.drive??{};
 if(reason==='hard_or_tilted_landing'){
  add('descent','触地前下降速度','Pre-contact descent',detail.descentMps,'≤',landing.maximumTouchdownVerticalMps,'m/s');
  add('tilt','触地倾角','Contact tilt',detail.tiltDeg,'≤',landing.maximumTouchdownTiltDeg,'°');
 }else if(reason==='gate_envelope_outside'){
  add('gate-width','含余量的横向半包络','Lateral half envelope + margin',(detail.envelopeHalfWidthM??0)+(gate.envelopeMarginM??0),'≤',gate.halfWidthM,'m');
  add('gate-height','含余量的竖向半包络','Vertical half envelope + margin',(detail.envelopeHalfHeightM??0)+(gate.envelopeMarginM??0),'≤',gate.halfHeightM,'m');
 }else if(reason==='gate_forward_speed'||reason==='reverse_gate_crossing')add('gate-speed','沿门法线速度','Speed along gate normal',detail.forwardSpeedMps,'≥',gate.minimumForwardSpeedMps,'m/s');
 else if(reason==='gate_not_airborne'||reason==='contact_before_gate')add('contacts','接触轮数','Contact wheels',t.contactCount,'=',0,'');
 else if(reason==='left_drive_lane')add('lane','车道中心横向偏差','Lateral lane offset',Math.abs((t.position?.x??0)-(route.start?.center?.[0]??0)),'≤',drive.halfWidthM,'m');
 else if(reason==='invalid_drive_checkpoint'){
  add('distance','连续轮胎驾驶距离','Continuous wheel driving',summary.groundDistanceM,'≥',drive.minimumGroundDistanceM,'m');add('contacts','检查点接触轮数','Checkpoint contact wheels',t.contactCount,'≥',3,'');
 }else if(reason==='takeoff_before_drive_checkpoint')add('checkpoint','起飞时世界 Z','World Z at takeoff',t.position?.z,'≥',drive.checkpointZ,'m');
 else if(reason==='missed_takeoff_strip'){
  add('strip-z-min','起飞区 Z 下界','Takeoff strip Z minimum',t.position?.z,'≥',route.takeoff?.minZ,'m');add('strip-z-max','起飞区 Z 上界','Takeoff strip Z maximum',t.position?.z,'≤',route.takeoff?.maxZ,'m');
  add('strip-x-min','起飞区 X 下界','Takeoff strip X minimum',t.position?.x,'≥',route.takeoff?.minX,'m');add('strip-x-max','起飞区 X 上界','Takeoff strip X maximum',t.position?.x,'≤',route.takeoff?.maxX,'m');
 }else if(reason==='landing_outside_platform_zone')add('landing-offset','落地中心距离','Distance to landing centre',detail.distanceM,'≤',landing.radiusM,'m');
 else if(reason==='outside_task_bounds')for(const [axis,min,max]of [['x','minX','maxX'],['y','minY','maxY'],['z','minZ','maxZ']]){
  add(axis+'-min','世界 '+axis.toUpperCase()+' 下界','World '+axis.toUpperCase()+' minimum',t.position?.[axis],'≥',route.bounds?.[min],'m');add(axis+'-max','世界 '+axis.toUpperCase()+' 上界','World '+axis.toUpperCase()+' maximum',t.position?.[axis],'≤',route.bounds?.[max],'m');
 }else if(reason==='task_timeout')add('duration','任务用时','Task elapsed time',detail.timeS??summary.timeS,'≤',route.timeoutS,'s');
 else if(reason==='physical_discontinuity')add('jump','单步运动残差','One-step motion residual',detail.residualM,'≤',.10,'m');
 else if(reason==='hull_collision')add('hull-contact','车体接触数（不含轮胎止挡）','Hull contacts excluding wheel stops',detail.contacts?.length,'=',0,'');
 else if(['conditions_changed','reset_attempt'].includes(reason))add('frozen-change','冻结条件改动','Frozen-condition changes',1,'=',0,'');
 return rows.map(row=>({...row,violated:row.actual===null||row.threshold===null?null:row.operator==='≤'?row.actual>row.threshold+1e-9:row.operator==='≥'?row.actual<row.threshold-1e-9:Math.abs(row.actual-row.threshold)>1e-9}));
}

export function firstViolationReview(record){
 if(!record)return null;
 const violation=record.violations?.[0]??(record.status==='timeout'?{step:record.stepCount,timeS:record.durationS,reason:record.reason,detail:{timeS:record.durationS}}:null);
 if(!violation)return{status:record.status,reason:record.reason,first:null,measurements:[],precedingEvents:[],note:'No rule violation is recorded. Completion and cancellation remain distinct.'};
 const samples=record.liveExperiment?.samples??[],sample=samples.reduce((best,row)=>row.step<=violation.step&&(!best||row.step>best.step)?row:best,null),detail=violation.detail??{};
 const telemetry=detail.observed??sample??{};
 return{status:record.status,reason:violation.reason,first:copy(violation),measurements:copy(detail.measurements??violationMeasurements(violation.reason,detail,telemetry,record.summary,record.task.route)),precedingEvents:record.events.filter(e=>e.step<=violation.step&&!['violation','finish'].includes(e.type)).slice(-5).map(copy),note:'The earliest recorded rule breach is shown. Temporal order is evidence of sequence, not proof of cause.'};
}

export function reviewTelemetry(t,step){
 const ownership=t.controlOwnership??{},v=t.velocity??{},speed=length(v),heading=t.headingDeg??null;
 return{step,timeS:step/120,simTime:t.simTime,position:copy(t.position??{}),velocity:copy(v),quaternion:copy(t.quaternion??{}),speedMps:speed,heightM:t.position?.y??null,verticalSpeedMps:v.y??null,headingDeg:heading,velocityHeadingDeg:Math.hypot(v.x??0,v.z??0)>.05?((Math.atan2(v.x,v.z)*180/Math.PI)%360+360)%360:null,rollDeg:t.rollDeg??null,pitchDeg:t.pitchDeg??null,
  contactCount:t.contactCount??0,wheels:(t.wheelStates??[]).map(w=>({id:w.id,contact:!!w.contact,normalLoadN:finite(w.normalLoadN),surfaceId:w.surfaceId??w.contactObjectId??null,surfaceMaterial:w.surfaceMaterial??null,mu:finite(w.surfaceMu),slipPowerW:finite(w.slipPowerW)})),
  owner:ownership.owner??null,positionPolicy:ownership.positionPolicy??null,positionTarget:copy(ownership.positionTarget??null),heightTarget:finite(ownership.heightTarget),requestedWrench:copy(ownership.requestedWrench??t.desiredWrench??[]),commandForceN:finite(ownership.commandForceN),actualForceN:finite(ownership.actualForceN??t.thrustN),valveResidualOnly:!!ownership.valveResidualOnly,
  nozzles:(t.nozzles??[]).map(n=>({id:n.id,commandN:finite(n.command),actualN:finite(n.force)})),gasMassKg:finite(t.gasMass),pressureBar:finite(t.pressureBar),contactEvent:copy(t.contactFeedback?.lastEvent??null),mode:t.mode??null};
}

export function storedReviewSample(record,step){
 const samples=record.liveExperiment?.samples??[],nearest=samples.reduce((best,row)=>!best||Math.abs(row.step-step)<Math.abs(best.step-step)?row:best,null);
 return{sample:nearest?copy(nearest):null,requestedStep:step,displayedStep:nearest?.step??null,exact:false,interpolated:false,note:'Nearest retained sample; no interpolation and no physics continuation. Original 20 Hz data may have been decimated.'};
}

/** An isolated simulator is required, so seeking cannot consume the live car's
 * gas, move it, or change the formal score. Backward seeks restart the exact
 * recorded initial state and execute the existing original-input playback. */
export class CityFlightReview{
 constructor(record,{createSim,yieldEvery=240,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  if(typeof createSim!=='function')throw Error('Review requires an isolated simulator factory');this.record=record;this.createSim=createSim;this.yieldEvery=yieldEvery;this.yieldTask=yieldTask;this.eligibility=replayEligibility(record.liveExperiment);this.sim=null;this.playback=null;this.generation=0;this.busy=false;this.state=null;
 }
 async seekStep(requestedStep){
  const step=clamp(Math.round(requestedStep),0,this.record.stepCount),generation=++this.generation;
  if(!this.eligibility.exact){this.state={...storedReviewSample(this.record,step),mode:'historical-read-only',eligibility:this.eligibility};return this.state;}
  this.busy=true;
  try{
   if(!this.playback||step<this.playback.step){this.sim=this.createSim(copy(this.record.liveExperiment.initialSnapshot.physical));this.playback=new ExperimentPlayback(this.record.liveExperiment,{sim:this.sim});}
   while(this.playback.step<step&&!this.playback.finished){const input=this.playback.nextInput();if(this.playback.finished)break;const t=this.sim.advanceFixed(input,1/120);this.playback.afterStep(t);if(t.fault)throw Error('Review solver failed: '+t.fault);if(this.yieldEvery&&this.playback.step%this.yieldEvery===0){await this.yieldTask();if(generation!==this.generation)return{cancelled:true};}}
   this.state={mode:'isolated-exact-review',exact:true,interpolated:false,requestedStep:step,displayedStep:this.playback.step,sample:reviewTelemetry(this.sim.telemetry(),this.playback.step),sourceId:this.record.id,identity:copy(this.record.identity),complete:this.playback.finished,reproduction:this.playback.finished?this.playback.reproduction():null};return this.state;
  }finally{if(generation===this.generation)this.busy=false;}
 }
 cancel(){this.generation++;this.busy=false;}
}

export function createPracticeAttempt(record,{createSim}={}){
 const eligible=replayEligibility(record.liveExperiment);if(!eligible.exact)throw Error(eligible.reason);
 const physical=copy(record.liveExperiment.initialSnapshot.physical),sim=createSim(physical);sim.importState(physical,{allowVersionMismatch:false});
 const unchanged=canonicalJSON(sim.exportState())===canonicalJSON(physical);if(!unchanged)throw Error('Practice initial-state import differs from its source');
 return{sim,runId:createCityRunId(),parentRunId:record.runId??record.id,record,attemptClass:'practice',initialStateLabel:record.liveExperiment.initialSnapshot.stateLabel,sceneConfiguration:copy(record.liveExperiment.initialSnapshot.sceneConfiguration??null),paused:true};
}

const eventOrder=['drive_checkpoint','takeoff','gate_passed','touchdown','stable_landing'];
export function compareCityAttempts(a,b){
 if(!a||!b)return null;
 const find=(r,type)=>r.events.find(e=>e.type===type)??null,rows=eventOrder.map(type=>{const ea=find(a,type),eb=find(b,type);return{type,a:ea?{timeS:ea.timeS,step:ea.step,detail:copy(ea.detail)}:null,b:eb?{timeS:eb.timeS,step:eb.step,detail:copy(eb.detail)}:null,deltaTimeS:ea&&eb?eb.timeS-ea.timeS:null};});
 const metrics=[['touchdown-descent','触地前下降速度','Pre-contact descent','m/s',a.summary.firstContact?-a.summary.firstContact.preContactVerticalMps:null,b.summary.firstContact?-b.summary.firstContact.preContactVerticalMps:null],['touchdown-tilt','触地最大倾角','Maximum contact tilt','°',a.summary.firstContact?Math.max(Math.abs(a.summary.firstContact.rollDeg),Math.abs(a.summary.firstContact.pitchDeg)):null,b.summary.firstContact?Math.max(Math.abs(b.summary.firstContact.rollDeg),Math.abs(b.summary.firstContact.pitchDeg)):null],['gas','喷口通过气量','Nozzle gas throughput','kg',a.summary.gasThroughputKg,b.summary.gasThroughputKg],['height','全程最高高度','Peak world height','m',a.summary.maximumWorldCgHeightM,b.summary.maximumWorldCgHeightM]].map(([key,label,labelEn,unit,av,bv])=>({key,label,labelEn,unit,a:finite(av),b:finite(bv),delta:Number.isFinite(av)&&Number.isFinite(bv)?bv-av:null}));
 const sameInitialState=a.liveExperiment.initialSnapshot.stateLabel===b.liveExperiment.initialSnapshot.stateLabel,sameConditions=a.conditionsLabel===b.conditionsLabel&&a.taskId===b.taskId,sameModel=a.identity.modelBuildId===b.identity.modelBuildId&&a.identity.modelVersion===b.identity.modelVersion;
 return{schema:'roadster.city-attempt-comparison',version:1,a:a.id,b:b.id,sameInitialState,sameConditions,sameModel,events:rows,metrics,semantics:'event-aligned-human-attempts',strictControllerAB:false,inputSequencesEqual:canonicalJSON(a.liveExperiment.inputRuns)===canonicalJSON(b.liveExperiment.inputRuns),commandSequencesEqual:canonicalJSON(a.liveExperiment.events.filter(e=>e.kind==='command'))===canonicalJSON(b.liveExperiment.events.filter(e=>e.kind==='command')),note:'Human attempts are aligned by physical events; differing inputs are not a controlled controller A/B experiment. Missing events remain missing.'};
}

export function alignedEventSeries(record,type='takeoff'){
 const event=record.events.find(e=>e.type===type);if(!event)return[];
 return(record.liveExperiment.samples??[]).map(row=>({relativeTimeS:row.timeS-event.timeS,timeS:row.timeS,step:row.step,heightM:row.heightM,speedMps:row.speedMps,verticalSpeedMps:row.velocity?.y??null}));
}
