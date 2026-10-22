import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {executeLandingTask,reexecuteLandingTask,DEFAULT_LANDING_TASK,parseLandingArchive} from '../dist/landing-challenge.js';
import {executeWindPair,windStudyPlan,summarizeWindPair} from '../dist/wind-control-study.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const checks=[],copy=x=>structuredClone(x),test=async(name,fn)=>{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS '+name);};
let source,calm,strong,finitePair,cancelled;
await test('Wind seed declares the exact schedule; different seeds change it without using rendering time',()=>{
 const first=windStudyPlan(DEFAULT_LANDING_TASK,{profile:'strong',seed:31701}),same=windStudyPlan(DEFAULT_LANDING_TASK,{profile:'strong',seed:31701}),other=windStudyPlan(DEFAULT_LANDING_TASK,{profile:'strong',seed:31702});
 assert.deepEqual(first,same);assert.notDeepEqual(first.task.disturbances,other.task.disturbances);
 assert.equal(first.taskId,same.taskId);assert.notEqual(first.scheduleHash,other.scheduleHash);
 assert.throws(()=>windStudyPlan(DEFAULT_LANDING_TASK,{seed:1.5}),/seed/);
 return{seed:first.seed,scheduleHash:first.scheduleHash,disturbances:first.task.disturbances};
});
await test('Strong wind A/B uses identical complete physical initial state, wind, control rate and all-step metrics',async()=>{
 source=await executeLandingTask({yieldEvery:0});assert.equal(source.status,'completed');
 strong=await executeWindPair({source,wind:{profile:'strong',seed:31701,candidateMode:'responsive'},yieldEvery:0});
 const{baseline:a,candidate:b}=strong;assert.equal(strong.windSummary.controlled,true);assert.equal(strong.windSummary.qualified,true);assert.equal(strong.windSummary.winner,null);
 assert.deepEqual(a.initialSnapshot.physical,b.initialSnapshot.physical);assert.deepEqual(a.initialSnapshot.physical,source.initialSnapshot.physical);assert.equal(a.taskId,b.taskId);assert.equal(a.algorithm.controlHz,b.algorithm.controlHz);
 assert.notEqual(a.algorithm.hash,b.algorithm.hash);assert.deepEqual(a.initialControllerState.states,b.initialControllerState.states);assert.equal(a.initialControllerState.lastOutput,b.initialControllerState.lastOutput);
 for(const r of [a,b]){assert.equal(r.summary.windResponse.count,480);assert.equal(r.summary.windResponse.durationS,4);assert.equal(r.summary.windResponse.complete,true);assert.equal(r.summary.statisticsCount??r.summary.count,r.stepCount);assert.ok(r.samples.some(s=>Math.hypot(s.windVelocity.x,s.windVelocity.z)>20));assert.equal(r.summary.onboardDischargedKg,0);}
 const windA=a.samples.filter(s=>s.timeS<=6).map(s=>[s.timeS,s.windVelocity]);const windB=b.samples.filter(s=>s.timeS<=6).map(s=>[s.timeS,s.windVelocity]);assert.deepEqual(windA,windB);
 assert.ok(b.summary.windResponse.heightRmseM<a.summary.windResponse.heightRmseM);assert.ok(b.summary.windResponse.gasThroughputKg>a.summary.windResponse.gasThroughputKg);assert.ok(b.summary.gasThroughputKg<a.summary.gasThroughputKg);
 return strong.windSummary;
});
await test('A declared wind result re-executes through the same solver with exact decisions and terminal state',async()=>{
 const again=await reexecuteLandingTask(strong.candidate,{yieldEvery:0});assert.deepEqual(again.controllerIO,strong.candidate.controllerIO);assert.deepEqual(again.summary,strong.candidate.summary);assert.deepEqual(again.finalSnapshot.physical,strong.candidate.finalSnapshot.physical);
 return{stepCount:again.stepCount,terminalStateLabel:again.finalSnapshot.stateLabel};
});
await test('Calm and gust conditions remain separate; a different schedule cannot be called the same-condition winner',async()=>{
 calm=await executeWindPair({source,wind:{profile:'calm',seed:31701,candidateMode:'responsive'},yieldEvery:0});
 assert.equal(calm.baseline.summary.windResponse.peakWindMps,0);assert.notEqual(calm.baseline.taskId,strong.baseline.taskId);
 const mismatched=summarizeWindPair(calm.baseline,strong.candidate);assert.equal(mismatched.controlled,false);assert.equal(mismatched.qualified,false);assert.ok(Object.values(mismatched.differences).every(v=>v===null));assert.equal(mismatched.winner,null);
 return{calm:calm.windSummary,gust:strong.windSummary,scope:'Height error in this window includes takeoff settling. Calm/gust pairs distinguish that transient from wind effects; neither pair is a population reliability claim.'};
});
await test('Finite supply failures and cancelled partial wind runs are retained and never promoted',async()=>{
 const finite=await executeLandingTask({task:{...copy(DEFAULT_LANDING_TASK),supplyMode:'finite',initialPressureBar:100},yieldEvery:0});
 finitePair=await executeWindPair({source:finite,wind:{profile:'strong',seed:31701,candidateMode:'responsive'},yieldEvery:0});
 assert.equal(finitePair.windSummary.qualified,false);assert.equal(finitePair.windSummary.winner,null);
 for(const r of [finitePair.baseline,finitePair.candidate]){assert.notEqual(r.status,'completed');assert.equal(r.summary.externalSupplyKg,0);assert.ok(r.summary.windResponse.count<480);}
 const controller=new AbortController();cancelled=await executeWindPair({source,wind:{profile:'crosswind',seed:31701,candidateMode:'responsive'},signal:controller.signal,yieldEvery:120,yieldTask:async()=>{},onProgress:p=>{if(p.timeS>=3)controller.abort();}});
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.baseline.status,'cancelled');assert.equal(cancelled.candidate,null);assert.equal(cancelled.windSummary.qualified,false);assert.ok(cancelled.baseline.stepCount>0);
 assert.equal(cancelled.windSummary.a.windowSampleCount,120);assert.equal(cancelled.windSummary.a.windowSeconds,1);
 for(const key of ['heightRmseM','lateralRmseM','attitudeRmseDeg','windowGasKg','windowLimitedS'])assert.equal(cancelled.windSummary.a[key],null,'Incomplete fixed-window metric must not masquerade as four seconds');
 assert.ok(cancelled.windSummary.a.partialWindow.heightRmseM>0);
 return{finite:finitePair.windSummary,cancelledSteps:cancelled.baseline.stepCount};
});
await test('Wind records round-trip through the existing task archive and retain both full physical traces',()=>{
 const records=[strong.baseline,strong.candidate],archive={schema:'roadster.landing-library',version:1,records,algorithms:records.map(r=>r.algorithm.algorithm)};
 const raw=JSON.stringify(archive),loaded=parseLandingArchive(raw);assert.deepEqual(loaded,archive);assert.equal(loaded.records[0].windComparison.pairId,loaded.records[1].windComparison.pairId);
 return{bytes:Buffer.byteLength(raw),records:records.length,samples:records.map(r=>r.samples.length)};
});
mkdirSync(`qa/wind-response-${REPORT_VERSION}`,{recursive:true});
writeFileSync(`qa/wind-response-${REPORT_VERSION}/report.json`,JSON.stringify({schema:'roadster-wind-response-3.17',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',checks,scope:'Actual fixed-step solver. Browser UI/visual execution and user-GPU performance are separate.'},null,2)+'\n');
writeFileSync(`qa/wind-response-${REPORT_VERSION}/records.json`,JSON.stringify({schema:'roadster.landing-library',version:1,records:[calm.baseline,calm.candidate,strong.baseline,strong.candidate,finitePair.baseline,finitePair.candidate,cancelled.baseline],algorithms:[source.algorithm.algorithm,strong.candidate.algorithm.algorithm]})+'\n');
