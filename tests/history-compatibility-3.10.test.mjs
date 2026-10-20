import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {ExperimentRecorder,ExperimentPlayback,executeExperiment,replayEligibility,prepareRecordedStateForCurrentModel,validateExperimentRecord} from '../dist/experiment-records.js';

const root=new URL('../',import.meta.url),clone=value=>JSON.parse(JSON.stringify(value));
const originalPath=new URL('qa/fixtures/live-record-3.9.json',root),originalBytes=readFileSync(originalPath);
const original=JSON.parse(originalBytes.toString('utf8'));
const createSim=snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType});
const evidence=[];
assert.equal(original.identity.modelVersion,'3.9.0');
assert.equal(original.identity.modelBuildId,'b353a90366f128bcf4c188fee0c4a3aad38e6a9f83baf27272c8b5828369ad70');
validateExperimentRecord(original);
const bytesBefore=JSON.stringify(original),eligibility=replayEligibility(original);
assert.equal(eligibility.exact,false);assert.equal(eligibility.recompute,true);
assert.throws(()=>new ExperimentPlayback(original,{sim:createSim(original.initialSnapshot.physical)}),/原 3.9/);
const result=await executeExperiment(original,{createSim,recompute:true,yieldEvery:0});
assert.equal(result.status,'completed');assert.equal(result.sourceIdentity.modelVersion,'3.9.0');
assert.equal(result.identity.modelVersion,MODEL_VERSION);assert.equal(result.reproduction.status,'not_applicable');
assert.equal(result.completedSteps,original.stepCount);assert.equal(JSON.stringify(original),bytesBefore);
const expected=clone(original.initialSnapshot.physical);expected.modelVersion=MODEL_VERSION;
if(['3.11.0','3.12.0','3.13.0'].includes(MODEL_VERSION)){expected.params.verticalAccelerationMps2=3;assert.equal(result.compatibility.migration.parameterMapping.verticalAccelerationMps2.value,3);}
assert.deepEqual(result.initialSnapshot.physical,expected,'Migration must preserve the complete physical snapshot apart from its explicitly mapped model label and declared legacy acceleration parameter.');
assert.deepEqual(result.compatibility.migration.addedDefaultState,[]);
evidence.push({name:'Actual published 3.9 source record is retained and explicitly recomputed without relabelling it as exact replay',status:'PASS',sourceIdentity:original.identity,executionIdentity:result.identity,steps:result.completedSteps,migration:result.compatibility.migration,reproduction:result.reproduction.status});
console.log('PASS: Actual 3.9 history is immutable; explicit '+MODEL_VERSION+' recomputation preserves its complete initial state and legacy 3 m/s² acceleration.');

// A different build of the current model is a recomputation case, not an
// unsupported model migration. Generate a real current-model record before
// changing only its declared build identity; never relabel old physical state.
const currentSim=createSim(result.initialSnapshot.physical);currentSim.importState(result.initialSnapshot.physical);
const recorder=new ExperimentRecorder({getSim:()=>currentSim,getContext:()=>original.context,now:()=> '2026-10-20T00:00:00.000Z'});
recorder.start({name:'Current-model unknown-build compatibility'});
for(let step=0;step<6;step++){const input={steer:.12,throttle:.2};recorder.beforeStep(input);const telemetry=currentSim.advanceFixed(input,1/120);recorder.afterStep(telemetry,input,1/120);}
const currentRecord=recorder.finish();validateExperimentRecord(currentRecord);assert.equal(replayEligibility(currentRecord).exact,true);
const unknownBuild=clone(currentRecord),unknownBuildId='uninstalled-build-for-current-model';
unknownBuild.identity.modelBuildId=unknownBuildId;unknownBuild.initialSnapshot.identity.modelBuildId=unknownBuildId;unknownBuild.finalSnapshot.identity.modelBuildId=unknownBuildId;
validateExperimentRecord(unknownBuild);const unknownBuildBefore=JSON.stringify(unknownBuild),unknownBuildEligibility=replayEligibility(unknownBuild);
assert.equal(unknownBuildEligibility.exact,false);assert.equal(unknownBuildEligibility.recompute,true);
assert.throws(()=>new ExperimentPlayback(unknownBuild,{sim:createSim(unknownBuild.initialSnapshot.physical)}),/不能精确重放/);
const unknownBuildRun=await executeExperiment(unknownBuild,{createSim,recompute:true,yieldEvery:0});
assert.equal(unknownBuildRun.status,'completed');assert.equal(unknownBuildRun.identity.modelVersion,MODEL_VERSION);assert.equal(unknownBuildRun.identity.modelBuildId,MODEL_BUILD_ID);
assert.equal(unknownBuildRun.sourceIdentity.modelBuildId,unknownBuildId);assert.equal(unknownBuildRun.compatibility.model,'current-model-recompute');assert.equal(unknownBuildRun.compatibility.migration,null);assert.equal(unknownBuildRun.reproduction.status,'not_applicable');
assert.deepEqual(unknownBuildRun.initialSnapshot.physical,unknownBuild.initialSnapshot.physical);assert.equal(JSON.stringify(unknownBuild),unknownBuildBefore);
evidence.push({name:'An unknown build of the current model refuses exact replay but allows explicit unchanged-state recomputation',status:'PASS',sourceIdentity:unknownBuild.identity,executionIdentity:unknownBuildRun.identity,steps:unknownBuildRun.completedSteps,migration:unknownBuildRun.compatibility.migration,reproduction:unknownBuildRun.reproduction.status});
console.log('PASS: Unknown '+MODEL_VERSION+' build requires explicit recomputation and retains source identity and physical state.');

const badGeometry=clone(original);badGeometry.initialSnapshot.physical.geometrySignature='different-collision-world';
assert.throws(()=>prepareRecordedStateForCurrentModel(badGeometry,createSim(original.initialSnapshot.physical),{recompute:true}),/几何/);
const badParameters=clone(original);delete badParameters.initialSnapshot.physical.params.altitudeGain;
assert.throws(()=>prepareRecordedStateForCurrentModel(badParameters,createSim(original.initialSnapshot.physical),{recompute:true}),/参数契约/);
const badState=clone(original);delete badState.initialSnapshot.physical.state._heightIntegral;
assert.throws(()=>prepareRecordedStateForCurrentModel(badState,createSim(original.initialSnapshot.physical),{recompute:true}),/尚未声明迁移/);
for(const version of ['3.6.0','3.14.0']){
  const unknown=clone(original);unknown.identity.modelVersion=version;unknown.initialSnapshot.physical.modelVersion=version;
  assert.equal(replayEligibility(unknown).exact,false);assert.equal(replayEligibility(unknown).recompute,false);
}
assert.equal(JSON.stringify(original),bytesBefore);assert.deepEqual(readFileSync(originalPath),originalBytes,'The original historical fixture bytes must remain unchanged.');
evidence.push({name:'Incompatible collision worlds, parameter/state contracts and unimplemented model versions refuse execution',status:'PASS'});
console.log('PASS: Historical compatibility checks fail closed before advancing physics.');
const sources=['dist/experiment-records.js','dist/simulation-snapshot.js','dist/physics.js','dist/vehicle-models.js','dist/model-build.js','tests/history-compatibility-3.10.test.mjs','qa/fixtures/live-record-3.9.json'];
writeFileSync(new URL(`qa/history-original-3.9-to-${REPORT_VERSION}.json`,root),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Original 3.9 solver fixture and actual current numerical solver. Historical recomputation is not execution of the old solver. No graphics or human driving acceptance.',sourceHashes:Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex')])),evidence},null,2)+'\n');
