import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {ExperimentRecorder,ExperimentPlayback,executeExperiment,replayEligibility,prepareRecordedStateForCurrentModel,validateExperimentRecord,contentLabel} from '../dist/experiment-records.js';

import {assertHistoricalReadOnly,assertCurrentSnapshotRejected,unavailableModelReason} from './history-contract-3.14.mjs';

const root=new URL('../',import.meta.url),clone=value=>JSON.parse(JSON.stringify(value));
const originalPath=new URL('qa/fixtures/live-record-3.9.json',root),originalBytes=readFileSync(originalPath);
const original=JSON.parse(originalBytes.toString('utf8'));
const createSim=snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType});
const evidence=[];
assert.equal(original.identity.modelVersion,'3.9.0');
assert.equal(original.identity.modelBuildId,'b353a90366f128bcf4c188fee0c4a3aad38e6a9f83baf27272c8b5828369ad70');
validateExperimentRecord(original);
const bytesBefore=JSON.stringify(original);
const unavailable=await assertHistoricalReadOnly({source:original,bytes:originalBytes,path:originalPath,createSim});
evidence.push({name:'Actual published 3.9 source record remains readable/exportable and rejects undeclared 3.14 migration',status:'PASS',...unavailable,legacyMigrationEvidence:'qa/history-original-3.9-to-3.13.json'});
console.log('PASS: Actual 3.9 history is immutable and exportable; both exact replay and undeclared current-model migration are refused before import.');

// A different build of the current model remains a recomputation case. Generate
// a genuine current-model record, never relabel an old physical snapshot.
const currentSim=new RoadsterSim({supplyMode:'bench'},{world:'windlab'});
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

const invalidCases=[
  ['geometry',record=>record.initialSnapshot.physical.geometrySignature='different-collision-world','快照不可恢复：场景几何或世界类型不匹配'],
  ['parameters',record=>delete record.initialSnapshot.physical.params.altitudeGain,'快照不可恢复：参数契约不匹配'],
  ['controller-state',record=>delete record.initialSnapshot.physical.state._heightIntegral,'快照不可恢复：缺少状态 _heightIntegral']
];
for(const [name,mutate,message] of invalidCases){
  const invalid=clone(currentRecord);mutate(invalid);invalid.initialSnapshot.stateLabel=contentLabel(invalid.initialSnapshot.physical);
  const rejection=await assertCurrentSnapshotRejected({record:invalid,createSim,message});
  evidence.push({name:'Current-model '+name+' is rejected independently of historical version availability',status:'PASS',...rejection});
}
for(const version of ['3.6.0','99.0.0-uninstalled']){
  const unknown=clone(currentRecord);unknown.identity.modelVersion=version;unknown.initialSnapshot.identity.modelVersion=version;unknown.initialSnapshot.physical.modelVersion=version;unknown.initialSnapshot.stateLabel=contentLabel(unknown.initialSnapshot.physical);
  assert.deepEqual(replayEligibility(unknown),{exact:false,recompute:false,migrationRequired:false,reason:unavailableModelReason(version)});
  assert.throws(()=>new ExperimentPlayback(unknown,{sim:createSim(currentRecord.initialSnapshot.physical),recompute:true}),{name:'Error',message:unavailableModelReason(version)});
}
assert.equal(JSON.stringify(original),bytesBefore);assert.deepEqual(readFileSync(originalPath),originalBytes,'The original historical fixture bytes must remain unchanged.');
evidence.push({name:'Incompatible collision worlds, parameter/state contracts and unimplemented model versions refuse execution',status:'PASS'});
console.log('PASS: Historical compatibility checks fail closed before advancing physics.');
const sources=['dist/experiment-records.js','dist/simulation-snapshot.js','dist/physics.js','dist/vehicle-models.js','dist/model-build.js','tests/history-compatibility-3.10.test.mjs','tests/history-contract-3.14.mjs','qa/fixtures/live-record-3.9.json'];
writeFileSync(new URL(`qa/history-original-3.9-to-${REPORT_VERSION}.json`,root),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Original 3.9 solver fixture retained read-only, undeclared historical migration refused, and genuine current-model build recomputation plus geometry/parameter/state rejection tested independently. No old solver execution or relabelled historical state. No graphics or human driving acceptance.',sourceHashes:Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex')])),evidence},null,2)+'\n');
