/** One live city task: real wheel driving, takeoff, swept air gate, and stable
 * landing on the existing terrace. This observer never moves a rigid body or
 * changes thrust, mass, gas, control targets or the collision world. */
import {ExperimentRecorder,contentLabel,canonicalJSON,currentExperimentIdentity,validateExperimentRecord} from './experiment-records.js';
import {readProtectedArchive,writeArchiveCandidate} from './research-storage.js';

const copy=v=>JSON.parse(JSON.stringify(v));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const norm=v=>Math.hypot(v.x,v.y,v.z);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const DT=1/120,wrap=a=>((a+540)%360)-180;
export const CITY_FLIGHT_PROTOCOL='city-drive-gate-landing-1';
export const CITY_FLIGHT_LIBRARY_KEY='roadster-city-flight-library-v1';
export const CITY_FLIGHT_ROUTE=freeze({
 id:'forum-terrace-hop-1',name:'上城 · 驾驶与飞越',nameEn:'Upper City · Drive and fly',
 surfaceId:'upper-city-terrace',surfaceY:8,streetId:'forum-main',
 start:{center:[400,8,230],radiusM:2.5,maxSpeedMps:.5,headingDeg:0,headingToleranceDeg:20},
 drive:{minimumGroundDistanceM:18,checkpointZ:252,halfWidthM:5.5},
 takeoff:{minX:394.5,maxX:405.5,minZ:252,maxZ:266,minimumCgHeightM:9.05,airborneDwellS:.12},
 gate:{id:'forum-air-gate',center:[400,12,280],normal:[0,0,1],halfWidthM:5.5,halfHeightM:2.7,minimumForwardSpeedMps:.25,envelopeMarginM:.05},
 landing:{center:[400,8,305],radiusM:4.5,bounds:{minX:393.5,maxX:406.5,minZ:298.5,maxZ:311.5},maximumTouchdownVerticalMps:1.4,maximumTouchdownTiltDeg:8,stableContacts:3,stableHorizontalMps:.4,stableVerticalMps:.35,stableAngularRadS:.15,stableSeconds:.5},
 bounds:{minX:389.5,maxX:410.5,minZ:220,maxZ:330,minY:7.8,maxY:24},timeoutS:75,
 rules:['Start stopped on the existing 8 m terrace road, heading +Z; starting never teleports or refills.', 'Drive on wheels at least 18 m and cross z=252 before taking off inside the marked strip.', 'Cross the gate once in +Z while fully airborne; the physical hull/tyre envelope must fit the 11 by 5.4 m opening.', 'Touch down only inside the marked terrace area, with <=1.4 m/s descent and <=8 degree tilt; no hull collision.', 'At least 3 wheels on upper-city-terrace, slow translation and rotation for 0.5 s are required before completion.', 'Reset, refill, changed wind/fault/model parameters or a discontinuity end the attempt; cancel releases the observer without moving the vehicle.'],
 scope:'A single curated route on an existing vehicle platform. It does not certify other roads, rooftop access, arbitrary jumps or finite-gas success.'
});
export function makeCityFlightTask({supplyMode='bench'}={}){if(!['bench','finite'].includes(supplyMode))throw Error('Declare bench or finite supply');return freeze({schema:'roadster.city-flight-task',version:1,protocol:CITY_FLIGHT_PROTOCOL,routeId:CITY_FLIGHT_ROUTE.id,supplyMode,route:copy(CITY_FLIGHT_ROUTE)});}
export function validateCityFlightTask(task){if(task?.schema!=='roadster.city-flight-task'||task.version!==1||task.protocol!==CITY_FLIGHT_PROTOCOL||!['bench','finite'].includes(task.supplyMode)||task.routeId!==CITY_FLIGHT_ROUTE.id||canonicalJSON(task)!==canonicalJSON(makeCityFlightTask({supplyMode:task.supplyMode})))throw Error('Unsupported or modified city task rules; create a declared new protocol instead');return task;}
const identity=()=>({...currentExperimentIdentity(),taskProtocol:CITY_FLIGHT_PROTOCOL});
function rotation(p,q){const ix=q.w*p.x+q.y*p.z-q.z*p.y,iy=q.w*p.y+q.z*p.x-q.x*p.z,iz=q.w*p.z+q.x*p.y-q.y*p.x,iw=-q.x*p.x-q.y*p.y-q.z*p.z;return{x:ix*q.w-iw*q.x-iy*q.z+iz*q.y,y:iy*q.w-iw*q.y-iz*q.x+ix*q.z,z:iz*q.w-iw*q.z-ix*q.y+iy*q.x};}
function physicalEnvelope(sim){
 const points=[],body=sim.body;
 for(let i=0;i<4;i++){const h=body.shapes[i]?.halfExtents,o=body.shapeOffsets[i],localQ=body.shapeOrientations[i];if(!h)throw Error('Physical hull envelope unavailable');for(const x of [-h.x,h.x])for(const y of [-h.y,h.y])for(const z of [-h.z,h.z]){const local=rotation({x,y,z},localQ),p=rotation({x:local.x+o.x,y:local.y+o.y,z:local.z+o.z},body.quaternion);points.push({x:p.x+body.position.x,y:p.y+body.position.y,z:p.z+body.position.z});}}
 for(const wheel of sim.wheelStates)for(const axis of ['x','y','z'])for(const sign of [-1,1]){const local={...wheel.position};local[axis]+=sign*(axis==='x'?.1325:sim.params.wheelRadius);const p=rotation(local,body.quaternion);points.push({x:p.x+body.position.x,y:p.y+body.position.y,z:p.z+body.position.z});}
 return points;
}
function signed(point,gate){return(point.x-gate.center[0])*gate.normal[0]+(point.y-gate.center[1])*gate.normal[1]+(point.z-gate.center[2])*gate.normal[2];}
/** Linear sweep of the CG plane crossing plus physical envelope projections
 * within one acknowledged 120 Hz step. Rendering frequency is irrelevant. */
export function sweepCityGate(previous,current,previousEnvelope,currentEnvelope,gate=CITY_FLIGHT_ROUTE.gate){
 const a=signed(previous.position,gate),b=signed(current.position,gate),direction=b-a;
 if(!(a<=0&&b>0||a>=0&&b<0)||Math.abs(direction)<1e-12)return null;
 const fraction=-a/direction,p={};for(const axis of ['x','y','z'])p[axis]=previous.position[axis]+(current.position[axis]-previous.position[axis])*fraction;
 const right={x:gate.normal[2],y:0,z:-gate.normal[0]},points=currentEnvelope.map((point,i)=>{const old=previousEnvelope[i]??point;return{x:old.x+(point.x-old.x)*fraction,y:old.y+(point.y-old.y)*fraction,z:old.z+(point.z-old.z)*fraction};});
 let width=0,height=0;for(const point of points){width=Math.max(width,Math.abs((point.x-gate.center[0])*right.x+(point.z-gate.center[2])*right.z));height=Math.max(height,Math.abs(point.y-gate.center[1]));}
 const forwardSpeed=previous.velocity.x*gate.normal[0]+previous.velocity.y*gate.normal[1]+previous.velocity.z*gate.normal[2]+fraction*((current.velocity.x-previous.velocity.x)*gate.normal[0]+(current.velocity.y-previous.velocity.y)*gate.normal[1]+(current.velocity.z-previous.velocity.z)*gate.normal[2]);
 return{direction:direction>0?'forward':'reverse',fraction,position:p,forwardSpeedMps:forwardSpeed,envelopeHalfWidthM:width,envelopeHalfHeightM:height,inside:width+gate.envelopeMarginM<=gate.halfWidthM&&height+gate.envelopeMarginM<=gate.halfHeightM,method:'linear 120 Hz endpoint envelope projection at CG plane crossing; not a continuous curved swept-volume certificate'};
}
function contacts(sim){return sim.world.contacts.filter(c=>c.bi===sim.body||c.bj===sim.body).map(c=>({objectId:(c.bi===sim.body?c.bj:c.bi).userData?.id??'unnamed',wheelStop:(c.bi===sim.body?c.si:c.sj)?.material===sim._wheelStopMaterial}));}
function support(t){return(t.wheelStates??[]).filter(w=>w.contact);}
function inRectangle(p,b){return p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ;}
function conditions(sim){return{params:copy(sim.params),wind:sim.getWind?.()??null,nozzleFault:copy(sim._nozzleFault??null),observation:copy(sim._observationConfig??null)};}
function startedInZone(t){const r=CITY_FLIGHT_ROUTE.start;return Math.hypot(t.position.x-r.center[0],t.position.z-r.center[2])<=r.radiusM&&Math.abs(t.position.y-(CITY_FLIGHT_ROUTE.surfaceY+.60))<.35;}
export function cityFlightStartCheck(sim,{task=makeCityFlightTask({supplyMode:sim.params.supplyMode})}={}){
 validateCityFlightTask(task);const t=sim.telemetry(),issues=[],platform=sim.getWorldGeometry().find(g=>g.id===CITY_FLIGHT_ROUTE.surfaceId),s=support(t);
 if(sim.worldType!=='city')issues.push('city_required');
 if(!platform||canonicalJSON({size:platform.size,position:platform.position})!==canonicalJSON({size:[280,8,270],position:[420,4,285]}))issues.push('platform_identity_changed');
 if(!startedInZone(t))issues.push('drive_to_start');
 if(s.length<3||s.some(w=>w.contactObjectId!==CITY_FLIGHT_ROUTE.surfaceId))issues.push('start_support');
 if(norm(t.velocity)>CITY_FLIGHT_ROUTE.start.maxSpeedMps||norm(t.angularVelocity)>.15)issues.push('stop_first');
 if(Math.abs(wrap(t.headingDeg-CITY_FLIGHT_ROUTE.start.headingDeg))>CITY_FLIGHT_ROUTE.start.headingToleranceDeg)issues.push('face_forward');
 if(Math.max(Math.abs(t.rollDeg),Math.abs(t.pitchDeg))>8||t.mode!=='drive')issues.push('drive_mode_required');
 if(t.supplyMode!==task.supplyMode)issues.push('supply_mismatch');if(t.fault)issues.push('solver_fault');
 return{ok:issues.length===0,issues,taskId:contentLabel(task),start:copy(CITY_FLIGHT_ROUTE.start),supplyMode:task.supplyMode,currentSupplyMode:t.supplyMode,currentPressureBar:t.pressureBar,currentGasMassKg:t.gasMass,teleport:false};
}
const FORBIDDEN_COMMANDS=['reset','refillGas','setParam','setWind','clearWind','setSupplyMode','setNozzleFault','clearNozzleFault','setObservation','setRoadSurface'];
export class CityFlightChallenge{
 constructor(sim,{task=makeCityFlightTask({supplyMode:sim.params.supplyMode}),onEvent=()=>{},onFinish=()=>{},getSceneConfiguration=()=>null}={}){
  this.sim=sim;this.task=freeze(copy(validateCityFlightTask(task)));this.onEvent=onEvent;this.onFinish=onFinish;this.started=false;this.finished=false;this.phase='ready';this.step=0;this.events=[];this.violations=[];this.restorers=[];this.airborneDwell=0;this.airborne=false;this.gatePassed=false;this.stableTime=0;this.pending=false;
  this.recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=> 'city',getSceneConfiguration,onFinish:r=>{this.liveExperiment=r;}});
  this.summary={statisticsHz:120,count:0,groundDistanceM:0,pathDistanceM:0,peakSpeedMps:0,minimumWorldCgHeightM:null,maximumWorldCgHeightM:null,minimumHullGapEstimateM:null,saturationSeconds:0,gasThroughputKg:0,onboardDischargedKg:0,externalSupplyKg:0,firstContact:null,landingErrorM:null,stableLandingAtS:null,gateCrossing:null,driveCheckpointAtS:null,takeoffAtS:null,hullCollision:false};
 }
 event(type,detail={}){const e={step:this.step,timeS:this.step*DT,type,detail:copy(detail)};this.events.push(e);this.recorder.event('city_challenge_'+type,detail);try{this.onEvent(e);}catch{}return e;}
 installGuards(){for(const method of FORBIDDEN_COMMANDS){const sim=this.sim,original=sim[method];if(typeof original!=='function')continue;const own=Object.prototype.hasOwnProperty.call(sim,method),runner=this;function guarded(...args){if(runner.started&&!runner.finished&&!runner.recorder.inPhysics){runner.event('forbidden_command',{method,args:copy(args)});runner.fail(method==='reset'?'reset_attempt':'conditions_changed',{method});}return original.apply(this,args);}Object.defineProperty(sim,method,{value:guarded,writable:true,configurable:true,enumerable:own?Object.getOwnPropertyDescriptor(sim,method).enumerable:false});this.restorers.push(()=>{if(sim[method]===guarded){if(own)sim[method]=original;else delete sim[method];}});}}
 start(){
  if(this.started)throw Error('City task already started');const check=cityFlightStartCheck(this.sim,{task:this.task});if(!check.ok){const error=Error(check.issues.join(', '));error.issues=check.issues;throw error;}
  this.frozenConditions=conditions(this.sim);this.conditionsLabel=contentLabel({...this.frozenConditions,initialGasMassKg:this.sim.gasMass,initialGasTemperatureK:this.sim.gasTemperature});this.conditionText=canonicalJSON(this.frozenConditions);this.previous=this.sim.telemetry();this.previousEnvelope=physicalEnvelope(this.sim);this.startSimTime=this.sim.simTime;this.initialStep=this.sim._stepCount;
  this.installGuards();try{this.initialSnapshot=this.recorder.start({name:CITY_FLIGHT_ROUTE.name,kind:'city-flight-challenge',program:{schema:'roadster.city-flight-program',version:1,task:this.task},lineage:{taskId:contentLabel(this.task)}});}catch(error){for(const restore of this.restorers.splice(0))restore();throw error;}
  this.started=true;this.phase='drive';this.event('start',{taskId:contentLabel(this.task),conditionsLabel:this.conditionsLabel,supplyMode:this.task.supplyMode,rules:CITY_FLIGHT_ROUTE.rules});return this;
 }
 beforeStep(input={}){
  if(!this.started||this.finished)return input;
  if(canonicalJSON(conditions(this.sim))!==this.conditionText){this.fail('conditions_changed',{detected:'before fixed integration'});return input;}
  if(this.pending){this.fail('unacknowledged_fixed_step');return input;}
  this.pending=true;return this.recorder.beforeStep(input);
 }
 afterStep(t,input=t?.driverInput??{},dt=DT){
  if(!this.started||this.finished)return this.getState();
  if(!this.pending||!finite(dt)||Math.abs(dt-DT)>1e-10){this.fail('fixed_step_protocol',{pending:this.pending,dt});return this.getState();}
  this.pending=false;this.recorder.afterStep(t,input,dt);this.step++;
  if(t.fault){this.fail('solver_fault',{fault:String(t.fault)});return this.getState();}
  if(!t.position||!Object.values(t.position).every(finite)||!Object.values(t.velocity).every(finite)){this.fail('non_finite_state');return this.getState();}
  const expectedTime=this.startSimTime+this.step*DT;if(Math.abs(t.simTime-expectedTime)>1e-7||this.sim._stepCount!==this.initialStep+this.step){this.fail('fixed_step_discontinuity',{expectedTime,actualTime:t.simTime});return this.getState();}
  const jump=Math.hypot(...['x','y','z'].map(a=>t.position[a]-this.previous.position[a]-t.velocity[a]*DT));if(jump>.10){this.fail('physical_discontinuity',{residualM:jump});return this.getState();}
  const envelope=physicalEnvelope(this.sim),stats=this.summary,delta=Math.hypot(...['x','y','z'].map(a=>t.position[a]-this.previous.position[a])),time=this.step*DT,tilt=Math.max(Math.abs(t.rollDeg),Math.abs(t.pitchDeg)),wheels=support(t),hull=contacts(this.sim).filter(c=>!c.wheelStop),distance=Math.hypot(t.position.x-400,t.position.z-305);
  stats.count++;stats.pathDistanceM+=delta;if(this.previous.contactCount>=3&&t.contactCount>=3&&!this.airborne)stats.groundDistanceM+=Math.hypot(t.position.x-this.previous.position.x,t.position.z-this.previous.position.z);
  stats.peakSpeedMps=Math.max(stats.peakSpeedMps,norm(t.velocity));stats.minimumWorldCgHeightM=Math.min(stats.minimumWorldCgHeightM??Infinity,t.position.y);stats.maximumWorldCgHeightM=Math.max(stats.maximumWorldCgHeightM??-Infinity,t.position.y);stats.minimumHullGapEstimateM=Math.min(stats.minimumHullGapEstimateM??Infinity,...envelope.slice(0,32).map(p=>p.y-CITY_FLIGHT_ROUTE.surfaceY));
  const gas=Math.max(0,t.massFlowKgS??0)*DT;stats.gasThroughputKg+=gas;if(t.supplyMode==='bench')stats.externalSupplyKg+=gas;else stats.onboardDischargedKg+=gas;if(t.pressureLimited||t.controlAuthority?.saturatedNozzles?.length)stats.saturationSeconds+=DT;
  if(hull.length){stats.hullCollision=true;this.fail('hull_collision',{contacts:hull});return this.getState();}
  const bounds=CITY_FLIGHT_ROUTE.bounds;if(!inRectangle(t.position,bounds)||t.position.y<bounds.minY||t.position.y>bounds.maxY){this.fail('outside_task_bounds',{position:t.position});return this.getState();}
  if(this.phase==='drive'){
   if(t.contactCount===0&&t.position.y>CITY_FLIGHT_ROUTE.takeoff.minimumCgHeightM){this.fail('takeoff_before_drive_checkpoint');return this.getState();}
   if(Math.abs(t.position.x-400)>CITY_FLIGHT_ROUTE.drive.halfWidthM){this.fail('left_drive_lane');return this.getState();}
   if(this.previous.position.z<CITY_FLIGHT_ROUTE.drive.checkpointZ&&t.position.z>=CITY_FLIGHT_ROUTE.drive.checkpointZ){if(t.contactCount<3||stats.groundDistanceM<CITY_FLIGHT_ROUTE.drive.minimumGroundDistanceM){this.fail('invalid_drive_checkpoint');return this.getState();}this.phase='takeoff';stats.driveCheckpointAtS=time;this.event('drive_checkpoint',{groundDistanceM:stats.groundDistanceM,position:t.position});}
  }
  if(this.phase==='takeoff'){
   if(!inRectangle(t.position,CITY_FLIGHT_ROUTE.takeoff)){this.fail('missed_takeoff_strip',{position:t.position});return this.getState();}
   if(t.contactCount===0&&t.position.y>=CITY_FLIGHT_ROUTE.takeoff.minimumCgHeightM)this.airborneDwell+=DT;else this.airborneDwell=0;
   if(this.airborneDwell+1e-9>=CITY_FLIGHT_ROUTE.takeoff.airborneDwellS){this.airborne=true;this.phase='gate';stats.takeoffAtS=time;this.event('takeoff',{position:t.position,airborneDwellS:this.airborneDwell});}
  }
  const crossing=sweepCityGate(this.previous,t,this.previousEnvelope,envelope);
  if(crossing){this.event('gate_crossing',crossing);if(crossing.direction!=='forward'){this.fail('reverse_gate_crossing',crossing);return this.getState();}if(!this.airborne||t.contactCount||this.previous.contactCount){this.fail('gate_not_airborne',crossing);return this.getState();}if(!crossing.inside||crossing.forwardSpeedMps<CITY_FLIGHT_ROUTE.gate.minimumForwardSpeedMps){this.fail(!crossing.inside?'gate_envelope_outside':'gate_forward_speed',crossing);return this.getState();}if(!this.gatePassed){this.gatePassed=true;this.phase='landing';stats.gateCrossing={...crossing,step:this.step,timeS:(this.step-1+crossing.fraction)*DT};this.event('gate_passed',stats.gateCrossing);}}
  if(this.airborne&&t.contactCount>0){
   if(!this.gatePassed){this.fail('contact_before_gate',{wheelObjects:wheels.map(w=>w.contactObjectId)});return this.getState();}
   const landing=CITY_FLIGHT_ROUTE.landing;
   if(!stats.firstContact){stats.firstContact={step:this.step,timeS:time,position:copy(t.position),preContactVerticalMps:this.previous.velocity.y,verticalMps:t.velocity.y,rollDeg:t.rollDeg,pitchDeg:t.pitchDeg,wheelObjects:wheels.map(w=>w.contactObjectId)};this.event('touchdown',stats.firstContact);}
   if(wheels.some(w=>w.contactObjectId!==CITY_FLIGHT_ROUTE.surfaceId)||distance>landing.radiusM||wheels.some(w=>w.contactPointWorld&&!inRectangle(w.contactPointWorld,landing.bounds))){this.fail('landing_outside_platform_zone',{distanceM:distance,contacts:wheels.map(w=>({id:w.contactObjectId,point:w.contactPointWorld}))});return this.getState();}
   if(this.previous.contactCount===0&&(-this.previous.velocity.y>landing.maximumTouchdownVerticalMps||tilt>landing.maximumTouchdownTiltDeg)){this.fail('hard_or_tilted_landing',{descentMps:-this.previous.velocity.y,tiltDeg:tilt});return this.getState();}
   const stable=t.contactCount>=landing.stableContacts&&Math.hypot(t.velocity.x,t.velocity.z)<=landing.stableHorizontalMps&&Math.abs(t.velocity.y)<=landing.stableVerticalMps&&norm(t.angularVelocity)<=landing.stableAngularRadS&&tilt<=landing.maximumTouchdownTiltDeg;
   this.stableTime=stable?this.stableTime+DT:0;
   if(this.stableTime+1e-9>=landing.stableSeconds){stats.stableLandingAtS=time;stats.landingErrorM=distance;this.event('stable_landing',{stableSeconds:this.stableTime,errorM:distance});this.finish('completed','stable_platform_landing');return this.getState();}
  }else this.stableTime=0;
  this.previous=t;this.previousEnvelope=envelope;
  if(time>=CITY_FLIGHT_ROUTE.timeoutS)this.finish('timeout','task_timeout');return this.getState();
 }
 fail(reason,detail={}){this.violations.push({step:this.step,timeS:this.step*DT,reason,detail:copy(detail)});this.event('violation',{reason,...detail});return this.finish('failed',reason);}
 finish(status='cancelled',reason='pilot_cancel'){
  if(this.finished||!this.started)return this.result??null;
  this.finished=true;this.pending=false;this.event('finish',{status,reason});const live=this.recorder.active?this.recorder.finish(status,reason):this.liveExperiment;for(const restore of this.restorers.splice(0))restore();
  if(live?.status==='failed'&&status==='completed'){status='failed';reason='record_terminal_failure';}
  this.phase=status;const summary={...this.summary,landingSucceeded:status==='completed',gasRemainingKg:live?.summary.gasRemainingKg??null,clearanceMeaning:'Minimum world-Y corner gap of the four actual hull boxes above the declared flat 8 m terrace; an estimate, not city AGL or recovery height.',supplyMeaning:this.task.supplyMode==='bench'?'External regulated flow; not an onboard tank consumption result.':'Actual finite onboard discharge; no refill during the attempt.'};
  this.result={schema:'roadster.city-flight-result',version:1,id:'city-'+Date.now().toString(36)+'-'+contentLabel({initial:this.initialSnapshot.stateLabel,steps:this.step,status}).slice(-8),identity:identity(),task:this.task,taskId:contentLabel(this.task),conditionsLabel:this.conditionsLabel,frozenConditions:this.frozenConditions,collisionIdentity:this.initialSnapshot.physical.geometrySignature,status,reason,durationS:this.step*DT,stepCount:this.step,supplyMode:this.task.supplyMode,summary,events:this.events,violations:this.violations,liveExperimentId:live?.id??null,liveExperiment:live,sampling:{statisticsHz:120,statisticsCount:summary.count,curveHz:20,curveSource:'liveExperiment.samples',gateDetection:'every acknowledged 120 Hz physical step; linear segment crossing',completeInputs:true},score:{eligible:status==='completed',ordering:['completed without a collision or violation','durationS ascending','gasThroughputKg ascending'],timeS:status==='completed'?this.step*DT:null,gasKg:status==='completed'?summary.gasThroughputKg:null}};
  try{this.onFinish(this.result);}catch{}return this.result;
 }
 cancel(reason='pilot_takeover'){return this.finish('cancelled',reason);}
 getState(){return{running:this.started&&!this.finished,phase:this.phase,step:this.step,timeS:this.step*DT,authority:'pilot through existing drive / hover controls; challenge observes only',taskId:contentLabel(this.task),supplyMode:this.task.supplyMode,gatePassed:this.gatePassed,stableSeconds:this.stableTime,summary:{...this.summary},result:this.result??null};}
}
export function validateCityFlightResult(r){
 if(r?.schema!=='roadster.city-flight-result'||r.version!==1||typeof r.id!=='string'||r.id.length>120||!['completed','failed','timeout','cancelled'].includes(r.status)||!Number.isInteger(r.stepCount)||r.stepCount<0||r.stepCount>CITY_FLIGHT_ROUTE.timeoutS*120||!r.identity||r.identity.taskProtocol!==CITY_FLIGHT_PROTOCOL||!r.summary||!Array.isArray(r.events)||!Array.isArray(r.violations)||r.events.length>10000||r.violations.length>100)throw Error('Invalid city-flight result');
 validateCityFlightTask(r.task);validateExperimentRecord(r.liveExperiment);
 if(r.taskId!==contentLabel(r.task)||r.liveExperimentId!==r.liveExperiment.id||r.stepCount!==r.liveExperiment.stepCount||Math.abs(r.durationS-r.stepCount/120)>1e-9||r.supplyMode!==r.task.supplyMode||r.collisionIdentity!==r.liveExperiment.initialSnapshot.physical.geometrySignature||r.identity.modelVersion!==r.liveExperiment.identity.modelVersion||r.identity.modelBuildId!==r.liveExperiment.identity.modelBuildId)throw Error('City task / physical record identity mismatch');
 if(r.conditionsLabel!==contentLabel({...r.frozenConditions,initialGasMassKg:r.liveExperiment.initialSnapshot.physical.state.gasMass,initialGasTemperatureK:r.liveExperiment.initialSnapshot.physical.state.gasTemperature})||canonicalJSON(r.frozenConditions?.params)!==canonicalJSON(r.liveExperiment.initialSnapshot.physical.params))throw Error('Frozen city conditions do not match the initial physical state');
 let lastEvent=-1;for(const event of r.events){if(!Number.isInteger(event.step)||event.step<lastEvent||event.step>r.stepCount||!finite(event.timeS)||Math.abs(event.timeS-event.step/120)>1e-8)throw Error('Invalid city event sequence');lastEvent=event.step;}
 if(r.status==='completed'&&(!r.summary.landingSucceeded||!r.summary.gateCrossing||!r.summary.firstContact||r.violations.length||r.summary.hullCollision||r.summary.stableLandingAtS===null))throw Error('Completion lacks mandatory physical evidence');
 function check(v,depth=0){if(depth>48)throw Error('Result nesting too deep');if(typeof v==='number'&&!finite(v))throw Error('Non-finite city result');if(v&&typeof v==='object')for(const [key,child]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(key))throw Error('Illegal field');check(child,depth+1);}}check(r);return r;
}
export function parseCityFlightArchive(raw){if(typeof raw!=='string'||new TextEncoder().encode(raw).length>12*1024*1024)throw Error('City task archive exceeds 12 MiB');let value=JSON.parse(raw);if(value?.schema==='roadster.city-flight-result')value={schema:'roadster.city-flight-library',version:1,records:[value]};if(value?.schema!=='roadster.city-flight-library'||value.version!==1||!Array.isArray(value.records)||value.records.length>128)throw Error('Unsupported city task archive');const ids=new Set();for(const r of value.records){validateCityFlightResult(r);if(ids.has(r.id))throw Error('Duplicate city result ID');ids.add(r.id);}return value;}
export function loadCityFlightLibrary(storage){return readProtectedArchive(storage,CITY_FLIGHT_LIBRARY_KEY,{parse:parseCityFlightArchive,empty:()=>({schema:'roadster.city-flight-library',version:1,records:[]}),maxBytes:4*1024*1024});}
export function saveCityFlightLibrary(storage,value,{protectedRaw=null,expectedRaw}={}){if(value.records.length>32)throw Error('32 city results already stored; new complete result stays in this session and remains exportable');return writeArchiveCandidate(storage,CITY_FLIGHT_LIBRARY_KEY,value,{parse:parseCityFlightArchive,maxBytes:4*1024*1024,protectedRaw,expectedRaw}).value;}
export function bestCityFlight(records,task,conditionsLabel){const key=contentLabel(task),current=identity();return records.filter(r=>r.status==='completed'&&r.summary.landingSucceeded&&r.taskId===key&&r.conditionsLabel===conditionsLabel&&r.identity.modelVersion===current.modelVersion&&r.identity.modelBuildId===current.modelBuildId).sort((a,b)=>a.durationS-b.durationS||a.summary.gasThroughputKg-b.summary.gasThroughputKg)[0]??null;}
