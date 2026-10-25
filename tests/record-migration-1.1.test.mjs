import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {replayEligibility,prepareRecordedStateForCurrentModel,executeExperiment,validateExperimentRecord,contentLabel} from '../dist/experiment-records.js';
const path='qa/browser-1.0/day-replay.json.gz',bytes=gunzipSync(readFileSync(path)),record=JSON.parse(bytes),original=JSON.stringify(record),createSim=s=>new RoadsterSim(s.params,{world:s.worldType});
assert.equal(record.identity.modelVersion,'1.0.0');validateExperimentRecord(record);
assert.equal(replayEligibility(record).exact,false);assert.equal(replayEligibility(record).recompute,true);
const sim=createSim(record.initialSnapshot.physical),live=sim.exportState();
assert.throws(()=>prepareRecordedStateForCurrentModel(record,sim),/迁移器/);assert.deepEqual(sim.exportState(),live);
const mapped=prepareRecordedStateForCurrentModel(record,sim,{recompute:true});
assert.deepEqual(mapped.compatibility.migration.changed,['modelVersion']);assert.deepEqual(mapped.compatibility.migration.addedDefaultState,[]);assert.deepEqual(mapped.compatibility.migration.parameterMapping,{});
assert.deepEqual({...mapped.physical,modelVersion:'1.0.0'},record.initialSnapshot.physical);sim.importState(mapped.physical);
const result=await executeExperiment(record,{createSim,recompute:true,yieldEvery:0});
assert.equal(result.status,'completed');assert.equal(result.completedSteps,21600);assert.equal(result.execution,'current-model-recompute');assert.equal(result.reproduction.status,'not_applicable');assert.equal(result.reproduction.expectedAgreement,false);assert.equal(JSON.stringify(record),original);
const rejects=[];
for(const [name,mutate]of [['world',s=>{s.geometryIdentity.signature='00000000';}],['missing-state',s=>{delete s.state._observationSeed;}],['missing-parameter',s=>{delete s.params.wheelRadius;}],['extra-parameter',s=>{s.params.futureUnknownParameter=1;}]]){
 const altered=structuredClone(record);mutate(altered.initialSnapshot.physical);altered.initialSnapshot.stateLabel=contentLabel(altered.initialSnapshot.physical);const target=createSim(record.initialSnapshot.physical),before=target.exportState();
 assert.throws(()=>{const ready=prepareRecordedStateForCurrentModel(altered,target,{recompute:true});target.importState(ready.physical);});assert.deepEqual(target.exportState(),before);rejects.push(name);
}
const unsupported=structuredClone(record);unsupported.identity.modelVersion='1.0.9';unsupported.initialSnapshot.identity.modelVersion='1.0.9';unsupported.initialSnapshot.physical.modelVersion='1.0.9';unsupported.initialSnapshot.stateLabel=contentLabel(unsupported.initialSnapshot.physical);assert.equal(replayEligibility(unsupported).recompute,false);
mkdirSync(`qa/release-${REPORT_VERSION}`,{recursive:true});writeFileSync(`qa/release-${REPORT_VERSION}/migration-from-1.0.json`,JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,source:path,sourceSha256:createHash('sha256').update(bytes).digest('hex'),steps:result.completedSteps,statusLabel:result.reproduction.status,compatibility:result.compatibility,summary:result.summary,sourceUnchanged:true,rejected:rejects,scope:'Complete 180 s browser-recorded 1.0 city loop recomputed by the current model. Source state/parameters/input/provenance remain unchanged; no exact old-model replay or GPU claim.'},null,2)+'\n');
console.log(`PASS 1.0 → ${MODEL_VERSION} explicit recompute: ${result.completedSteps} actual solver steps; unsupported/missing state mappings rejected`);
