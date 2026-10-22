import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {executeLandingTask,reexecuteLandingTask,parseLandingArchive,DEFAULT_LANDING_TASK} from '../dist/landing-challenge.js';
import {executeWindMatrix,windMatrixPlan,validateWindMatrix,summarizeWindMatrix} from '../dist/wind-matrix-study.js';
import {windResponseChartData} from '../dist/wind-response-chart.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const output=process.argv[2]??`qa/wind-matrix-${REPORT_VERSION}/development`;mkdirSync(output,{recursive:true});
const sourcePaths=['dist/physics.js','dist/vehicle-models.js','dist/simulation-snapshot.js','dist/landing-challenge.js','dist/wind-control-study.js','dist/wind-matrix-study.js','dist/wind-response-chart.js'];
const hashes=()=>Object.fromEntries(sourcePaths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const initialHashes=hashes(),report={schema:'roadster-wind-matrix-evidence-3.18',recordedAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,sourceHashes:initialHashes,checks:[],experiments:[],limitations:['Numerical fixed-step solver only; native pixels and user GPU acceptance are separate.','Three declared seeds per direction are sensitivity cases, not a population reliability probability.','This experiment changes only the height outer-loop controller; horizontal control is shared.']};
const persist=()=>writeFileSync(output+'/report.json',JSON.stringify(report,null,2)+'\n');
function storeMatrix(name,result){
  const archive={schema:'roadster.landing-library',version:1,records:result.records,algorithms:[result.matrix.plan.frozen.baselineAlgorithm,result.matrix.plan.frozen.candidateAlgorithm],windMatrices:[result.matrix]};
  const raw=JSON.stringify(archive);assert.equal(JSON.stringify(parseLandingArchive(raw)),raw);const zipped=gzipSync(raw,{level:6});writeFileSync(output+'/'+name+'.json.gz',zipped);
  const bytes=Buffer.byteLength(raw),entry={name,bytes,gzipBytes:zipped.length,sha256:createHash('sha256').update(raw).digest('hex'),archive:name+'.json.gz',sourceInitialState:result.matrix.plan.frozen.initialStateLabel,records:result.records.length,summary:result.matrixSummary};report.experiments.push(entry);persist();return entry;
}
try{
 const source=await executeLandingTask({yieldEvery:0});assert.equal(source.status,'completed');
 report.source={id:source.id,initialState:source.initialSnapshot.stateLabel,hardware:source.initialSnapshot.physical.params,supply:source.supplyMode,pressureBar:source.task.initialPressureBar,task:source.task};
 const plan=windMatrixPlan(source,source.algorithm.algorithm,{profile:'strong',seed:31701});assert.deepEqual(plan.seeds,[31701,31702,31703]);assert.equal(plan.plannedPairs,6);assert.throws(()=>windMatrixPlan(source,null,{seed:4294967294}),/seed/);
 let strong;
 for(const profile of ['calm','crosswind','strong']){
  const began=performance.now(),result=await executeWindMatrix({source,wind:{profile,seed:31701,candidateMode:'responsive'},yieldEvery:0});
  assert.equal(result.matrix.status,'completed');assert.equal(result.matrix.rows.length,profile==='calm'?3:6);
  for(const row of result.matrix.rows){const a=result.records.find(r=>r.id===row.baselineId),b=result.records.find(r=>r.id===row.candidateId);assert.deepEqual(a.initialSnapshot.physical,b.initialSnapshot.physical);assert.deepEqual(a.initialSnapshot.physical,source.initialSnapshot.physical);assert.deepEqual(a.task.disturbances,b.task.disturbances);assert.equal(a.algorithm.controlHz,b.algorithm.controlHz);assert.equal(a.supplyMode,b.supplyMode);assert.equal(row.summary.controlled,true);}
  const entry=storeMatrix(profile+'-bench',result);entry.wallMs=performance.now()-began;console.log(profile+' matrix: '+result.records.length+' records; '+entry.bytes+' bytes');
  if(profile==='strong')strong=result;
 }
 report.checks.push({name:'All strength/direction cases use the same complete physical initial state, with A/B identical wind schedules and control frequencies',status:'passed'});
 const a=strong.records[0],b=strong.records[1],chart=windResponseChartData(a,b);for(const [i,r]of [a,b].entries())for(let j=0;j<r.samples.length;j++)assert.equal(chart.curves[i].values[j].heightErrorM,r.samples[j].heightM-r.samples[j].targetHeightM);assert.deepEqual(chart.window,{startS:2,endS:6});
 const again=await reexecuteLandingTask(b,{yieldEvery:0});assert.deepEqual(again.controllerIO,b.controllerIO);assert.deepEqual(again.summary,b.summary);assert.deepEqual(again.finalSnapshot.physical,b.finalSnapshot.physical);
 report.checks.push({name:'Plot height error derives from actual retained states; chosen matrix B exactly reexecutes every decision and terminal state',status:'passed',recordId:b.id,steps:b.stepCount});
 const finite=await executeLandingTask({task:{...structuredClone(DEFAULT_LANDING_TASK),supplyMode:'finite',initialPressureBar:100},yieldEvery:0});
 const finiteMatrix=await executeWindMatrix({source:finite,wind:{profile:'strong',seed:31701,candidateMode:'responsive'},yieldEvery:0});
 for(const r of finiteMatrix.records){assert.notEqual(r.status,'completed');assert.equal(r.summary.externalSupplyKg,0);}storeMatrix('strong-finite100',finiteMatrix);
 const controller=new AbortController(),cancelled=await executeWindMatrix({source,signal:controller.signal,wind:{profile:'strong',seed:31701},yieldEvery:120,yieldTask:async()=>{},onProgress:p=>{if(p.timeS>=3)controller.abort();}});
 assert.equal(cancelled.matrix.status,'cancelled');assert.equal(cancelled.records.length,1);assert.equal(cancelled.records[0].stepCount,360);assert.equal(cancelled.records[0].summary.windResponse.count,120);assert.equal(cancelled.matrixSummary.groups[0].distributions.heightRmseM.n,0);assert.equal(cancelled.matrixSummary.notRunPairs,5);assert.equal(cancelled.matrixSummary.groups[1].attempted,0);storeMatrix('cancelled-3s',cancelled);
 report.checks.push({name:'Finite-supply failures, partial windows and never-started cases remain distinct, without imputed zero error or a winner',status:'passed'});
 const corrupt=structuredClone(strong.matrix);corrupt.rows[0].summary.a.heightRmseM+=1;assert.throws(()=>validateWindMatrix(corrupt,{recordMap:new Map(strong.records.map(r=>[r.id,r]))}),/metrics/);
 assert.deepEqual(summarizeWindMatrix(strong.matrix,strong.records),strong.matrixSummary);report.checks.push({name:'Matrix archive verifies its summaries against the original full records and rejects altered metrics',status:'passed'});
 report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{report.sourceHashesAfter=hashes();report.sourcesUnchangedDuringRun=JSON.stringify(initialHashes)===JSON.stringify(report.sourceHashesAfter);report.completedAt=new Date().toISOString();persist();console.log(JSON.stringify({status:report.status,output,sourcesUnchanged:report.sourcesUnchangedDuringRun}));}
