import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {ExperimentPlayback,executeExperiment,replayEligibility,prepareRecordedStateForCurrentModel,validateExperimentRecord} from '../dist/experiment-records.js';

const root=new URL('../',import.meta.url),clone=value=>JSON.parse(JSON.stringify(value));
const original=JSON.parse(readFileSync(new URL('qa/fixtures/live-record-3.9.json',root),'utf8'));
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
if(['3.11.0','3.12.0'].includes(MODEL_VERSION)){expected.params.verticalAccelerationMps2=3;assert.equal(result.compatibility.migration.parameterMapping.verticalAccelerationMps2.value,3);}
assert.deepEqual(result.initialSnapshot.physical,expected,'Migration must preserve the complete physical snapshot apart from its explicitly mapped model label and declared legacy acceleration parameter.');
assert.deepEqual(result.compatibility.migration.addedDefaultState,[]);
evidence.push({name:'Actual published 3.9 source record is retained and explicitly recomputed without relabelling it as exact replay',status:'PASS',sourceIdentity:original.identity,executionIdentity:result.identity,steps:result.completedSteps,migration:result.compatibility.migration,reproduction:result.reproduction.status});
console.log('PASS: Actual 3.9 history is immutable; explicit current-model recomputation preserves its complete initial state.');

const badGeometry=clone(original);badGeometry.initialSnapshot.physical.geometrySignature='different-collision-world';
assert.throws(()=>prepareRecordedStateForCurrentModel(badGeometry,createSim(original.initialSnapshot.physical),{recompute:true}),/几何/);
const badParameters=clone(original);delete badParameters.initialSnapshot.physical.params.altitudeGain;
assert.throws(()=>prepareRecordedStateForCurrentModel(badParameters,createSim(original.initialSnapshot.physical),{recompute:true}),/参数契约/);
const badState=clone(original);delete badState.initialSnapshot.physical.state._heightIntegral;
assert.throws(()=>prepareRecordedStateForCurrentModel(badState,createSim(original.initialSnapshot.physical),{recompute:true}),/尚未声明迁移/);
for(const version of ['3.6.0','3.13.0']){
  const unknown=clone(original);unknown.identity.modelVersion=version;unknown.initialSnapshot.physical.modelVersion=version;
  assert.equal(replayEligibility(unknown).exact,false);assert.equal(replayEligibility(unknown).recompute,false);
}
evidence.push({name:'Incompatible collision worlds, parameter/state contracts and unimplemented model versions refuse execution',status:'PASS'});
console.log('PASS: Historical compatibility checks fail closed before advancing physics.');
const sources=['dist/experiment-records.js','dist/simulation-snapshot.js','dist/physics.js','dist/vehicle-models.js','dist/model-build.js','tests/history-compatibility-3.10.test.mjs','qa/fixtures/live-record-3.9.json'];
writeFileSync(new URL(`qa/history-original-3.9-to-${REPORT_VERSION}.json`,root),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Original 3.9 solver fixture and actual current numerical solver. Historical recomputation is not execution of the old solver. No graphics or human driving acceptance.',sourceHashes:Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex')])),evidence},null,2)+'\n');
