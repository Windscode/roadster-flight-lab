import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {CityFlightChallenge,makeCityFlightTask,validateCityFlightResult,parseCityFlightArchive,bestCityFlight} from '../dist/city-flight-challenge.js';
import {CityFlightReview,createPracticeAttempt,firstViolationReview,compareCityAttempts} from '../dist/city-flight-review.js';
import {CityBehaviorMonitor} from '../dist/city-behavior-monitor.js';
import {currentExperimentIdentity,contentLabel} from '../dist/experiment-records.js';

const out='qa/learning-loop-3.19',dt=1/120,q={x:0,y:0,z:0,w:1};
fs.mkdirSync(out,{recursive:true});
function fixture(){const sim=new RoadsterSim({supplyMode:'bench'},{world:'city'});sim.reset('harbor');for(let i=0;i<240;i++)sim.advanceFixed({brake:1});return sim;}
const createSim=state=>new RoadsterSim({...state.params},{world:state.worldType});
function run({variant='success',prepared=null}={}){
 const sim=prepared?.sim??fixture(),task=prepared?.record.task??makeCityFlightTask({supplyMode:'bench'}),runner=new CityFlightChallenge(sim,{task,attemptClass:'practice',runId:prepared?.runId,parentRunId:prepared?.parentRunId??null}).start();
 let phase='drive',phaseStep=0;const commands=[],recordingId=runner.recorder.getState().id;assert(recordingId,'record identity is available when an attempt starts');
 function command(method,...args){commands.push({step:runner.step,method,args:structuredClone(args)});sim[method](...args);}
 while(!runner.finished){
  const t=sim.telemetry();let input={};
  if(phase==='drive'){
   const v=t.velocity.z,remaining=258-t.position.z,brake=remaining<=Math.max(3,v*v/8);input={throttle:brake?0:Math.min(1,Math.max(0,(6-v)*.25)),brake:brake?1:0};
   if(remaining<3&&Math.abs(v)<.15){phase='rise';phaseStep=runner.step;command('setPoseTarget',{position:{x:400,y:variant==='envelope'?18:12,z:t.position.z},quaternion:q});}
  }else if(phase==='rise'&&runner.step-phaseStep>300){phase='travel';phaseStep=runner.step;command('setPoseTarget',{position:{x:400,y:variant==='envelope'?18:12,z:305},quaternion:q});}
  else if(phase==='travel'&&Math.abs(t.position.z-305)<.8&&Math.abs(t.velocity.z)<.35){phase='land';phaseStep=runner.step;if(variant==='hard')command('setMode','drive');else command('startManeuver','land');}
  input=runner.beforeStep(input);if(runner.finished)break;runner.afterStep(sim.advanceFixed(input,dt),input,dt);
 }
 validateCityFlightResult(runner.result);assert.equal(runner.result.liveExperiment.id,recordingId,'route or challenge result opens the same record announced at start');assert(!commands.some(c=>['reset','setParam','refillGas'].includes(c.method)));return{sim,record:runner.result,commands};
}

const hard=run({variant:'hard'}),envelope=run({variant:'envelope'}),success=run();
assert.equal(hard.record.reason,'hard_or_tilted_landing');assert.equal(envelope.record.reason,'gate_envelope_outside');assert.equal(success.record.status,'completed');
const originalLive=fixture();originalLive.advanceFixed({throttle:.4});const savedLive=contentLabel(originalLive.exportState());
const reviews=[];
for(const attempt of [hard,envelope,success]){
 const record=attempt.record,review=new CityFlightReview(record,{createSim,yieldEvery:0}),event=record.violations[0]??record.events.find(e=>e.type==='stable_landing'),beforeStep=Math.max(0,event.step-360);
 const before=await review.seekStep(beforeStep),at=await review.seekStep(event.step),terminal=await review.seekStep(record.stepCount);
 assert.equal(before.displayedStep,beforeStep);assert.equal(at.displayedStep,event.step);assert.equal(terminal.reproduction.status,'matched');
 assert.equal(contentLabel(originalLive.exportState()),savedLive);assert.notEqual(review.sim,originalLive);
 const backwards=await review.seekStep(beforeStep);assert.equal(backwards.displayedStep,beforeStep);
 const prepared=createPracticeAttempt(record,{createSim});assert.notEqual(prepared.runId,record.id);assert.equal(prepared.parentRunId,record.id);assert.equal(contentLabel(prepared.sim.exportState()),record.liveExperiment.initialSnapshot.stateLabel);
 const next=run({variant:'success',prepared});assert.equal(next.record.status,'completed');assert.equal(next.record.attemptClass,'practice');assert.equal(next.record.score.eligible,false);assert.equal(next.record.parentRunId,record.id);
 const comparison=compareCityAttempts(record,next.record);assert(comparison.sameInitialState&&comparison.sameConditions&&comparison.sameModel);assert.equal(comparison.strictControllerAB,false);
 if(attempt===hard){assert(comparison.metrics.find(x=>x.key==='touchdown-descent').delta<0);assert.equal(firstViolationReview(record).measurements[0].violated,true);}
 if(attempt===envelope)assert(firstViolationReview(record).measurements.some(m=>m.key==='gate-height'&&m.violated));
 reviews.push({sourceId:record.id,reason:record.reason,beforeStep,eventStep:event.step,reproduction:terminal.reproduction,practiceId:next.record.id,comparison,firstViolation:firstViolationReview(record)});
 fs.writeFileSync(`${out}/${attempt===hard?'hard':attempt===envelope?'envelope':'success'}-practice.json`,JSON.stringify(next.record));
}
assert.equal(bestCityFlight([success.record],success.record.task,success.record.conditionsLabel),null,'successful practices stay out of formal rankings');
// Old identities remain view-only. No simulator is created for a foreign build.
const historical=structuredClone(hard.record);historical.liveExperiment.identity.modelBuildId='unavailable-original-build';let created=false;
const readOnly=new CityFlightReview(historical,{createSim:()=>{created=true;throw Error('must not construct');}}),old=await readOnly.seekStep(historical.stepCount-180);
assert.equal(old.mode,'historical-read-only');assert.equal(old.interpolated,false);assert.equal(created,false);

// Advisory logic probes are separate from the physically integrated attempts.
const notices=[],monitor=new CityBehaviorMonitor({onEvent:event=>notices.push(event)}),telemetry=fixture().telemetry();
for(let i=0;i<90;i++)monitor.update({...telemetry,simTime:i*dt,controlOwnership:{owner:'flight-assist',commandForceN:15000,actualForceN:15000},driverInput:{}});
for(let i=90;i<180;i++)monitor.update({...telemetry,simTime:i*dt,controlOwnership:{owner:'driver',commandForceN:0,actualForceN:200,valveResidualOnly:true},driverInput:{}});
assert.equal(notices.length,0,'explicit H/E and closing-valve residual are not unauthorized requests');
for(let i=180;i<300;i++)monitor.update({...telemetry,simTime:i*dt,controlOwnership:{owner:'driver',commandForceN:900,actualForceN:950},driverInput:{}});
assert.equal(notices.length,1);assert.equal(notices[0].type,'unowned-new-nozzle-request');
monitor.markReportedLanding({...telemetry,simTime:3});for(let i=360;i<550;i++)monitor.update({...telemetry,simTime:i*dt,contactCount:2,controlOwnership:{owner:'driver',commandForceN:0,actualForceN:0},driverInput:{}});
assert(notices.some(e=>e.type==='reported-landed-support-lost'));assert(notices.every(e=>e.causalClaim===false));
const explicitNotices=[],explicitMonitor=new CityBehaviorMonitor({onEvent:event=>explicitNotices.push(event)});
for(let i=0;i<240;i++)explicitMonitor.update({...telemetry,simTime:i*dt,contactCount:0,maneuverFeedback:{lastRun:{name:'roll',state:'completed',reason:'returned-to-start-height',startedAtSimTimeS:-5}},controlOwnership:{owner:'driver',commandForceN:0,actualForceN:0},driverInput:{}});
assert.equal(explicitNotices.length,0,'a completed airborne roll does not claim a settled landing');
explicitMonitor.markReportedLanding({...telemetry,simTime:2});for(let i=240;i<480;i++)explicitMonitor.update({...telemetry,simTime:i*dt,contactCount:0,controlOwnership:{owner:'g-level-height',commandForceN:15000,actualForceN:15000},driverInput:{}});
assert.equal(explicitNotices.length,0,'an explicit G height controller is not unauthorized support loss');
const archive={schema:'roadster.city-flight-library',version:1,records:[hard.record,envelope.record,success.record]};assert.equal(parseCityFlightArchive(JSON.stringify(archive)).records.length,3);
fs.writeFileSync(`${out}/three-attempts.json`,JSON.stringify(archive));
fs.writeFileSync(`${out}/input-journal.json`,JSON.stringify({identity:currentExperimentIdentity(),cases:[hard,envelope,success].map(({record,commands})=>({runId:record.id,reason:record.reason,commands,inputRuns:record.liveExperiment.inputRuns,fullCommandEvents:record.liveExperiment.events.filter(e=>e.kind==='command')}))},null,2));
fs.writeFileSync(`${out}/report.json`,JSON.stringify({schema:'roadster-learning-loop-3.19',identity:currentExperimentIdentity(),execution:'Actual RoadsterSim at 120 Hz, using the existing public drive input and pose/landing commands. No body-state overwrite, refill or parameter change inside attempts. Numerical execution, not native keyboard or GPU evidence.',cases:[hard,envelope,success].map(({record})=>({id:record.id,status:record.status,reason:record.reason,durationS:record.durationS,firstContact:record.summary.firstContact,gate:record.summary.gateCrossing})),reviews,originalLiveUnchanged:true,oldBuildReadOnly:true,practiceExcludedFromFormalRanking:true,advisoryUnitProbes:{events:notices,scope:'Synthetic ownership/support inputs to a read-only monitor; not claimed as observed physical defects.'}},null,2));
console.log('Learning loop: real hard landing, envelope breach and success; exact isolated review, identical-start practice, event comparison passed.');
