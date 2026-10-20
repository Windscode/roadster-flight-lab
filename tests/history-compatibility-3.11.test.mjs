import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {validateExperimentRecord,replayEligibility,executeExperiment,ExperimentPlayback} from '../dist/experiment-records.js';
import {assertHistoricalReadOnly} from './history-contract-3.14.mjs';
const evidence=[],createSim=snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType});
for(const version of ['3.9','3.10','3.11']){
 const path=new URL('../qa/fixtures/live-record-'+version+'.json',import.meta.url),bytes=readFileSync(path),source=JSON.parse(bytes),before=JSON.stringify(source);
 assert.equal(source.identity.modelVersion,version+'.0');
 const result=await assertHistoricalReadOnly({source,bytes,path,createSim});
 // Original parameter/state evidence stays intact even though execution of
 // these old full snapshots has no declared current-model migrator.
 assert.equal(JSON.stringify(source),before);assert.equal('verticalAccelerationMps2' in source.initialSnapshot.physical.params,version==='3.11');
 if(version==='3.11')assert.equal(source.initialSnapshot.physical.params.verticalAccelerationMps2,4.5);
 assert.equal('_researchHeightControl' in source.initialSnapshot.physical.state,false);
 evidence.push({...result,sourceSteps:source.stepCount,originalClimbRateMps:source.initialSnapshot.physical.params.climbRateMps,originalRollRateDegS:source.initialSnapshot.physical.params.rollRateDegS,originalAccelerationMps2:source.initialSnapshot.physical.params.verticalAccelerationMps2??null,currentOnlyStateMissing:'_researchHeightControl',legacyMigrationEvidence:'qa/history-compatibility-3.13.json'});
}
const paths=['dist/experiment-records.js','dist/simulation-snapshot.js','dist/physics.js','dist/vehicle-models.js','tests/history-compatibility-3.11.test.mjs','tests/history-contract-3.14.mjs','qa/fixtures/live-record-3.9.json','qa/fixtures/live-record-3.10.json','qa/fixtures/live-record-3.11.json','qa/fixtures/live-record-3.11-provenance.json'];
writeFileSync(new URL(`../qa/history-compatibility-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Actual published 3.9/3.11 and source-generated 3.10 records remain immutably viewable and exportable. The current model explicitly refuses their undeclared full-state migration before import or integration; old solvers are not executed and historical parameters are not relabelled.',fixtureProvenance:{'3.9':'6083bbf0e01f4eef5447f2c1b951d8b41e691f46','3.10':'6d2b897bc928ae0e44fa258a7184719cd660e48b (prior source commit; content incorporated in public 3.11)','3.11':'ab9372b56a01c2a47b18d32baf48162f3cd8f86c (public source solver fixture)'},sourceHashes:Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),evidence},null,2)+'\n');
console.log('PASS: Actual 3.9, 3.10 and 3.11 histories retain their source identity and all existing state/parameters');
console.log('PASS: '+MODEL_VERSION+' explicitly refuses unavailable old-model exact replay and undeclared complete-state migration; retained legacy values are never silently mapped.');
