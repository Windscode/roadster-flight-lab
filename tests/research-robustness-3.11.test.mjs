import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runExperiment} from '../dist/experiment-worker.js';
import {buildStudyRequests,studyArchive,importStudy} from '../dist/research-study.js';
import {summarizeRobustness,ROBUSTNESS_SEEDS} from '../dist/research-robustness.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const base={kind:'attitude',params:{supplyMode:'bench'}},jobs=buildStudyRequests(base,{mode:'robustness'});
assert.equal(jobs.length,20);assert.deepEqual([...new Set(jobs.map(j=>j.request.robustness.seed))],ROBUSTNESS_SEEDS);
assert.throws(()=>buildStudyRequests(base,{mode:'robustness',robustness:{candidateResponse:jobs[0].request.params.attitudeResponse}}),/A 与 B/);
const entries=jobs.map((job,i)=>({id:'robust-'+i,batchId:'real-solver',label:job.label,report:runExperiment(job.request)}));
for(let i=0;i<entries.length;i+=2){
 const a=entries[i].report,b=entries[i+1].report,params={...b.appliedParams};params.attitudeResponse=a.appliedParams.attitudeResponse;
 assert.deepEqual(a.appliedParams,params,'Only the declared attitude response may differ within a pair');
 assert.deepEqual(a.initialState,b.initialState,'The entire retained physical and observed initial state must be identical within a seed pair');
 assert.equal(a.metrics.statisticsSteps,1440);assert.equal(a.input.sampleHz,10);assert.equal(a.rows.length,120);
 assert.equal(a.initialState.observation.configuration.enabled,true);assert.equal(a.initialState.observation.configuration.seed,jobs[i].request.robustness.seed);
}
assert.notDeepEqual(entries[0].report.rows,entries[2].report.rows,'Different seeds must enter the actual controller and change the trajectory');
assert.notEqual(entries[0].report.metrics.throughputKg,entries[1].report.metrics.throughputKg,'Controller comparison must affect delivered actuation, not just a label');
const repeated=runExperiment(jobs[0].request);assert.deepEqual(repeated.rows,entries[0].report.rows);assert.deepEqual(repeated.metrics,entries[0].report.metrics);
const imported=importStudy(studyArchive(entries));assert.deepEqual(imported.map(j=>j.request),jobs.map(j=>j.request));
const repeatImported=runExperiment(imported[10].request);assert.deepEqual(repeatImported.rows,entries[10].report.rows);
const summary=summarizeRobustness(entries,{executionStatus:'completed'});assert.equal(summary.complete,true);assert.equal(summary.pairedCases,10);assert.equal(summary.groups.length,4);
const partial=summarizeRobustness(entries.slice(0,3),{executionStatus:'cancelled'});assert.equal(partial.complete,false);assert.equal(partial.returnedCases,3);assert.equal(partial.pairedCases,1);
const mismatched=structuredClone(entries.slice(0,2));mismatched[1].report.request.params.dryMass+=1;assert.equal(summarizeRobustness(mismatched).pairedCases,0,'Different mass cannot be described as a fair seed pair');
const failure=runExperiment({...jobs[0].request,params:{...jobs[0].request.params,supplyMode:'finite',tankLitres:200,initialPressureBar:100}});assert.equal(failure.outcome,'not_recovered_in_window');assert.ok(failure.metrics.groundTouchSeconds!==null||failure.metrics.heightHoldLostSeconds!==null);assert.ok(failure.metrics.throughputKg>0);
const bytes=Buffer.byteLength(JSON.stringify(entries));assert.ok(bytes<3*1024*1024,'One complete study should fit the existing 4 MiB archive with room for prior small experiments');
const paths=['dist/research-robustness.js','dist/research-study.js','dist/research-protocol.js','dist/experiment-worker.js','dist/physics.js','dist/control-observation.js','dist/vehicle-models.js','tests/research-robustness-3.11.test.mjs'];
writeFileSync(new URL(`../qa/research-robustness-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',scope:'Actual deterministic solver, public pose/observation/wind/fault interfaces. Numerical controller research; no graphics, real-vehicle reliability or human handling acceptance.',sourceHashes:Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),storedBytes:bytes,summary,finiteFailure:{outcome:failure.outcome,metrics:failure.metrics},checks:['20 physically executed cases; identical paired initial conditions except the declared controller parameter','Same seed repeats; different seeds change actual observed state and trajectories','Export/import recomputation preserves each complete request and reproduces the measured response','Cancelled batches and mismatched pairs remain incomplete; finite-gas failure is retained']},null,2)+'\n');
for(const check of ['Seeded disturbance enters actual controller feedback and changes the delivered response','Same-seed pairing and exact request export/import are reproducible','Physical failure, cancellation and unmatched conditions remain distinct from successful execution','Twenty results fit the existing history budget without deleting earlier records'])console.log('PASS: '+check);
console.log(JSON.stringify({storedBytes:bytes,groups:summary.groups},null,2));
