import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {validateExperimentRecord,replayEligibility,executeExperiment,ExperimentPlayback} from '../dist/experiment-records.js';
const evidence=[],createSim=snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType});
for(const version of ['3.9','3.10','3.11']){
 const source=JSON.parse(readFileSync(new URL('../qa/fixtures/live-record-'+version+'.json',import.meta.url),'utf8')),before=JSON.stringify(source);
 validateExperimentRecord(source);assert.equal(source.identity.modelVersion,version+'.0');assert.equal(replayEligibility(source).exact,false);assert.equal(replayEligibility(source).recompute,true);
 assert.throws(()=>new ExperimentPlayback(source,{sim:createSim(source.initialSnapshot.physical)}),/不能精确重放/);
 const run=await executeExperiment(source,{createSim,recompute:true,yieldEvery:0});assert.equal(run.status,'completed');assert.equal(run.reproduction.status,'not_applicable');assert.equal(run.sourceIdentity.modelVersion,source.identity.modelVersion);assert.equal(run.identity.modelVersion,MODEL_VERSION);assert.equal(run.completedSteps,source.stepCount);
 const expected=structuredClone(source.initialSnapshot.physical);expected.modelVersion=MODEL_VERSION;if(version!=='3.11')expected.params.verticalAccelerationMps2=3;assert.deepEqual(run.initialSnapshot.physical,expected);assert.deepEqual(run.compatibility.migration.addedDefaultState,[]);assert.equal(JSON.stringify(source),before);
 if(version!=='3.11')assert.equal(run.compatibility.migration.parameterMapping.verticalAccelerationMps2.value,3);else{assert.equal(run.initialSnapshot.physical.params.verticalAccelerationMps2,4.5);assert.deepEqual(run.compatibility.migration.parameterMapping,{});}assert.equal(run.initialSnapshot.physical.params.climbRateMps,source.initialSnapshot.physical.params.climbRateMps);assert.equal(run.initialSnapshot.physical.params.rollRateDegS,source.initialSnapshot.physical.params.rollRateDegS);
 evidence.push({sourceIdentity:source.identity,sourceSteps:source.stepCount,executionIdentity:run.identity,status:run.status,reproduction:run.reproduction.status,migration:run.compatibility.migration,sourceUnchanged:true});
}
const paths=['dist/experiment-records.js','dist/simulation-snapshot.js','dist/physics.js','dist/vehicle-models.js','tests/history-compatibility-3.11.test.mjs','qa/fixtures/live-record-3.9.json','qa/fixtures/live-record-3.10.json','qa/fixtures/live-record-3.11.json','qa/fixtures/live-record-3.11-provenance.json'];
writeFileSync(new URL(`../qa/history-compatibility-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Actual published 3.9/3.11 and source-generated 3.10 records are immutably viewed and explicitly migrated for current-model numerical recomputation; the old solvers are not executed by the current application.',fixtureProvenance:{'3.9':'6083bbf0e01f4eef5447f2c1b951d8b41e691f46','3.10':'6d2b897bc928ae0e44fa258a7184719cd660e48b (prior source commit; content incorporated in public 3.11)','3.11':'ab9372b56a01c2a47b18d32baf48162f3cd8f86c (public source solver fixture)'},sourceHashes:Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),evidence},null,2)+'\n');
console.log('PASS: Actual 3.9, 3.10 and 3.11 histories retain their source identity and all existing state/parameters');
console.log('PASS: Explicit '+MODEL_VERSION+' recomputation maps missing legacy vertical acceleration to 3 m/s², preserves explicit 3.11 values, and never claims old-solver replay');
