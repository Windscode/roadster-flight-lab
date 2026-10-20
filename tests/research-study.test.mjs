import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';
import {runExperiment} from '../dist/experiment-worker.js';
import {normalizeResearchRequest,savedResearchRequest,protocolId,PROTOCOL_VERSION} from '../dist/research-protocol.js';
import {buildStudyRequests,studyArchive,importStudy} from '../dist/research-study.js';
const checks=[],values={};const pass=s=>{checks.push(s);console.log('PASS: '+s);};
for(const [name,hash]of Object.entries(MODEL_SOURCE_HASHES))assert.equal(createHash('sha256').update(readFileSync('dist/'+name)).digest('hex'),hash,'Regenerate model build after editing '+name);
assert.equal(createHash('sha256').update(JSON.stringify(MODEL_SOURCE_HASHES)).digest('hex'),MODEL_BUILD_ID);
pass('Exported model build identity matches the source hashes of the solver, fixture, protocol and imported geometry');
const hover=runExperiment({kind:'hover',params:{supplyMode:'bench'}});
assert.ok(hover.metrics.maxPositionErrorM<1e-6&&hover.metrics.heightRmseM<.03);assert.equal(hover.outcome,'held_in_window');assert.equal(hover.metrics.gasUsedKg,0);assert.ok(hover.metrics.throughputKg>350);assert.equal(hover.metrics.heightHoldLostSeconds,null);
values.benchHover=hover.metrics;pass('Isolated hover captures the same horizontal reference as its initial state and reports external through-flow separately from tank depletion');
const finite=runExperiment({kind:'hover'});
assert.ok(finite.metrics.lossOfSupportSeconds<finite.metrics.heightHoldLostSeconds&&finite.metrics.heightHoldLostSeconds<finite.metrics.groundTouchSeconds);assert.ok(Math.abs(finite.metrics.massBalanceErrorKg)<1e-8);assert.ok(finite.metrics.maxPositionErrorM<.01);assert.equal(finite.outcome,'hover_not_held');
values.finiteHover=finite.metrics;pass('Finite hover distinguishes capacity loss, sustained tracking error and ground contact while conserving gas mass');
const attitudeJobs=buildStudyRequests({kind:'attitude'},{mode:'pair',pairKey:'stabilization'}),attitude=attitudeJobs.map(j=>runExperiment(j.request));
assert.notEqual(attitude[0].outcome,'recovered');assert.equal(attitude[1].outcome,'recovered');assert.ok(attitude[1].metrics.recoveredAtSeconds>.5&&attitude[1].metrics.recoveryMaintainedToEnd);assert.equal(attitude[1].metrics.groundTouchSeconds,null);
values.attitude=attitude.map(r=>({outcome:r.outcome,metrics:r.metrics}));pass('Matched attitude A/B changes only the real stabilizer and requires a sustained low-error low-angular-rate recovery');
// Current quick X has a separate reference and a smaller measured budget.
// Successful finite runs and genuinely insufficient finite starts are both
// exercised; rejected inputs must still preserve the complete initial state.
const roll=runExperiment({kind:'roll',params:{supplyMode:'bench',tankLitres:600}});
const rejectedRolls=[200,300,400].map(tankLitres=>runExperiment({kind:'roll',params:{supplyMode:'finite',tankLitres}}));
const finiteRolls=[600,900].map(tankLitres=>runExperiment({kind:'roll',params:{supplyMode:'finite',tankLitres}}));
assert.equal(roll.appliedParams.supplyMode,'bench');assert.equal(roll.appliedParams.tankLitres,600);
assert.equal(roll.protocolVersion,PROTOCOL_VERSION);assert.equal(roll.request.durationS,20);assert.equal(roll.input.duration,20);assert.equal(roll.rows.length,400);assert.equal(roll.metrics.statisticsSteps,2400);
assert.equal(roll.outcome,'stable_landing');assert.ok(roll.metrics.completeRotation&&roll.metrics.inverted&&Math.abs(roll.metrics.rollTravelDeg)>350);
// A full 0.5 s qualifies. Repeated 1/120 s additions can report that interval
// 3e-14 s below 0.5; this tolerance is numerical, far below one solver step.
assert.ok(roll.metrics.stableLanding.time-roll.metrics.touchdown.time>=.5-1e-12);assert.equal(roll.metrics.stableLanding.confirmationSeconds,.5);assert.ok(roll.metrics.stableLanding.time<=roll.rows.at(-1).time);
assert.equal(roll.finalState.mode,'drive');assert.equal(roll.finalState.contacts,4);assert.ok(Math.abs(roll.finalState.position.y-roll.initialState.position.y)<.15);assert.equal(roll.metrics.hullContactSamples,0);
assert.equal(roll.metrics.gasUsedKg,0);assert.equal(roll.metrics.remainingGasKg,roll.initialState.gasKg);assert.ok(roll.metrics.remainingGasKg>30&&roll.metrics.deliveredImpulseNs>0);assert.ok(Math.abs(roll.metrics.massBalanceErrorKg)<1e-8);assert.ok(roll.metrics.throughputKg>0);assert.equal(roll.metrics.externalSupplyKg,roll.metrics.throughputKg);
assert.equal(roll.metrics.heightHoldLostSeconds,null);assert.equal(roll.metrics.maxBetaDeg,null);
assert.deepEqual(rejectedRolls.map(r=>r.appliedParams.tankLitres),[200,300,400]);
for(const finite of finiteRolls){assert.equal(finite.outcome,'stable_landing');assert.ok(finite.metrics.completeRotation&&finite.metrics.inverted);assert.equal(finite.metrics.hullContactSamples,0);assert.equal(finite.finalState.mode,'drive');assert.ok(finite.metrics.stableLanding.time-finite.metrics.touchdown.time>=.5-1e-12);assert.ok(finite.metrics.gasUsedKg>0);assert.equal(finite.metrics.externalSupplyKg,0);assert.ok(Math.abs(finite.metrics.massBalanceErrorKg)<1e-8);}
values.finiteRolls=finiteRolls.map(r=>({tankLitres:r.appliedParams.tankLitres,outcome:r.outcome,metrics:r.metrics}));
for(const rejected of rejectedRolls){
  assert.equal(rejected.appliedParams.supplyMode,'finite');assert.equal(rejected.outcome,'rejected');assert.equal(rejected.rows.length,0);assert.deepEqual(rejected.phases,[]);
  assert.deepEqual(rejected.finalState,rejected.initialState);assert.deepEqual(rejected.events.map(e=>({time:e.time,type:e.type})),[{time:0,type:'maneuver_rejected'}]);
  assert.match(rejected.events[0].note,/剩余冲量不足/);
  assert.equal(rejected.metrics.gasUsedKg,0);assert.equal(rejected.metrics.throughputKg,0);assert.equal(rejected.metrics.deliveredImpulseNs,0);assert.equal(rejected.metrics.massBalanceErrorKg,0);
  assert.equal(rejected.metrics.completeRotation,false);assert.equal(rejected.metrics.touchdown,null);assert.equal(rejected.metrics.stableLanding,null);
}
values.roll=roll.metrics;values.rollFixture={supplyMode:roll.appliedParams.supplyMode,tankLitres:roll.appliedParams.tankLitres,outcome:roll.outcome,initialState:roll.initialState,finalState:roll.finalState};
values.rejectedRolls=rejectedRolls.map(r=>({supplyMode:r.appliedParams.supplyMode,tankLitres:r.appliedParams.tankLitres,outcome:r.outcome,reason:r.events[0].note,sampleCount:r.rows.length,initialState:r.initialState,finalState:r.finalState,metrics:r.metrics}));
pass('Bench and finite 600/900 L quick rolls complete full rotation and confirmed stable landing; insufficient finite 200/300/400 L starts preserve state with no samples, impulse or gas use');
// The only changed experimental factor here is the observation window. Keep
// the old 8-second duration and distinct identity. The faster current model
// now lands within 8 s; archived old outcomes are never rewritten.
const shortRoll=runExperiment({kind:'roll',params:{supplyMode:'bench',tankLitres:600},durationS:8});
assert.deepEqual(shortRoll.initialState,roll.initialState);assert.equal(shortRoll.input.duration,8);assert.equal(shortRoll.rows.length,160);assert.equal(shortRoll.metrics.statisticsSteps,960);
assert.equal(shortRoll.outcome,'stable_landing');assert.ok(shortRoll.metrics.completeRotation&&shortRoll.metrics.inverted);assert.ok(shortRoll.metrics.touchdown&&shortRoll.metrics.stableLanding);assert.ok(shortRoll.metrics.stableLanding.time<=8);assert.equal(shortRoll.metrics.hullContactSamples,0);assert.notEqual(shortRoll.runId,roll.runId);
const legacy=structuredClone(shortRoll);legacy.protocolVersion='flat-lab-3';delete legacy.request.durationS;
const untouched=structuredClone(legacy),legacyArchive=studyArchive([{label:'Explicit old-request-format fixture; current solver 8-second data',report:legacy}]);
assert.deepEqual(legacy,untouched);assert.deepEqual(legacyArchive.results[0].report,untouched);assert.equal(legacyArchive.requests[0].request.durationS,8);assert.equal(importStudy(legacyArchive)[0].request.durationS,8);
const oldArchive=structuredClone(legacyArchive);delete oldArchive.requests[0].request.durationS;
assert.equal(importStudy(oldArchive)[0].request.durationS,8);delete oldArchive.results;assert.equal(importStudy(oldArchive)[0].request.durationS,8);
const currentArchive=studyArchive([{label:'Current 20-second request',report:roll}]);assert.equal(importStudy(currentArchive)[0].request.durationS,20);
assert.equal(savedResearchRequest(legacy.request,{durationS:8}).durationS,8);assert.throws(()=>savedResearchRequest(legacy.request,{protocolVersion:'unknown'}),/缺少有效观察窗口/);assert.throws(()=>savedResearchRequest(roll.request,{durationS:8}),/观察窗口不一致/);
for(const durationS of [0,12,NaN,21])assert.throws(()=>normalizeResearchRequest({kind:'roll',durationS}),/观察窗口/);
values.rollWindows={oldWindow:{durationS:8,outcome:shortRoll.outcome,rows:shortRoll.rows.length,runId:shortRoll.runId,completeRotation:shortRoll.metrics.completeRotation,finalHeightM:shortRoll.finalState.position.y},currentWindow:{durationS:20,outcome:roll.outcome,rows:roll.rows.length,runId:roll.runId,touchdown:roll.metrics.touchdown,stableLanding:roll.metrics.stableLanding},history:{fixture:'Current 8-second solver data with an explicitly simulated old request format; not an old-model physical run',reportUnchanged:true,exportedAndImportedDurationS:8,requestOnlyLegacyArchiveDurationS:8,currentArchiveDurationS:20}};
pass('The 20-second standard roll window and retained 8-second historical window have distinct identities, real outcomes, exact frozen durations and unchanged historical reports');
const brakeJobs=buildStudyRequests({kind:'brake'},{mode:'sweep',sweepKey:'tireMu',from:.65,to:1.25,count:3}),brakes=brakeJobs.map(j=>runExperiment(j.request));
assert.deepEqual(brakeJobs.map(j=>j.request.params.tireMu),[.65,.95,1.25]);const distances=brakes.map(r=>r.metrics.stop?.distanceM);assert.ok(distances[0]>distances[1]&&distances[1]>distances[2]);assert.ok(brakes.every(r=>r.outcome==='stable_stop'&&r.metrics.stop.confirmationSeconds===.5&&r.rows.find(x=>x.time>.55).brake===1));
values.brakingDistancesM=distances;pass('Single-factor friction sweep keeps identical initial conditions and produces monotonic measured brake distances with confirmed stops');
const steerJobs=buildStudyRequests({kind:'steer'},{mode:'pair',pairKey:'steeringAssist'}),steers=steerJobs.map(j=>runExperiment(j.request));
assert.ok(steerJobs.every(j=>j.request.steeringProtocol==='driver'));assert.deepEqual(steerJobs.map(j=>j.request.params.steeringAssist),[false,true]);assert.ok(Math.max(...steers[0].rows.map(r=>r.steer))>Math.max(...steers[1].rows.map(r=>r.steer)));const wheel=runExperiment({kind:'steer'});assert.equal(wheel.appliedParams.steeringAssist,false);assert.ok(wheel.overrides.length>0&&wheel.metrics.speedRmseKmh<2);
values.speedRmseKmh=wheel.metrics.speedRmseKmh;pass('Fixed-wheel protocol exposes its assistance override while fixed-driver A/B retains an actual difference in road-wheel angle and logs speed accuracy');
const repeat=runExperiment({kind:'steer'});assert.deepEqual(repeat.rows,wheel.rows);assert.deepEqual(repeat.metrics,wheel.metrics);assert.equal(repeat.runId,wheel.runId);assert.equal(protocolId(normalizeResearchRequest({params:{dryMass:1900,tireMu:1}})),protocolId(normalizeResearchRequest({params:{tireMu:1,dryMass:1900}})));assert.ok(wheel.rows.every((r,i)=>Math.abs(r.time-(i+1)/20)<1e-8));
pass('Identical model and protocol reproduce complete source curves at uniform 20 Hz and protocol identity ignores parameter ordering');
const archive=studyArchive(brakes.map((report,i)=>({label:brakeJobs[i].label,report})));archive.results[0].report={metrics:{fake:true}};const imported=importStudy(archive);assert.deepEqual(imported.map(j=>j.request),brakeJobs.map(j=>j.request));assert.ok(imported.every(j=>!('metrics'in j.request)));assert.throws(()=>importStudy({...archive,requests:Array(13).fill(archive.requests[0])}));assert.throws(()=>normalizeResearchRequest({params:{gasGamma:1}}));assert.throws(()=>normalizeResearchRequest({params:{tankLitres:NaN}}));assert.throws(()=>buildStudyRequests({kind:'hover'},{mode:'sweep',sweepKey:'tireMu',from:.65,to:1.25,count:3}));
pass('Study archive import revalidates frozen requests, ignores supplied metrics and rejects oversized, non-finite or scientifically inapplicable protocols');
writeFileSync(`qa/research-study-${REPORT_VERSION}.json`,JSON.stringify({status:'passed',checks,values,scope:'Software and research-protocol validation; no physical Tesla calibration'},null,2)+'\n');
