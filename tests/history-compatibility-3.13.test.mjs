import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {ExperimentRecorder,contentLabel,validateExperimentRecord,replayEligibility,prepareRecordedStateForCurrentModel,executeExperiment,ExperimentPlayback,loadExperimentArchive,parseExperimentArchive,exportExperimentArchive,experimentCSV} from '../dist/experiment-records.js';

import {assertHistoricalReadOnly,assertCurrentSnapshotRejected} from './history-contract-3.14.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
const file=name=>new URL('../qa/fixtures/'+name,import.meta.url),provenance=JSON.parse(readFileSync(file('live-record-3.12-provenance.json'))),evidence=[];
assert.equal(provenance.commit,'70e98013d6da246c78c4c50ca2ef44595d1f356b');
assert.equal(hash(readFileSync(file(provenance.generator.split('/').at(-1)))),provenance.generatorSHA256);
const xManifest=JSON.parse(readFileSync(file('baseline-3.12-x/manifest.json')));
assert.equal(provenance.sourceHashes['dist/physics.js'],xManifest.files['physics.js'].sourceSha256);
assert.equal(provenance.sourceHashes['dist/vehicle-models.js'],xManifest.files['vehicle-models.js'].sourceSha256);
assert.equal(hash(readFileSync(file('x-midroll-3.12.json'))),provenance.midrollSource.sha256);
assert.equal(hash(readFileSync(file('baseline-3.12-x/manifest.json'))),provenance.midrollSource.solverManifestSHA256);
assert.ok(provenance.outputs.every(output=>output.originalSolverExactReplay));

const currentWorld=snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType});
for(const name of ['live-record-3.12.json','live-record-midroll-3.12.json','live-record-city-3.12.json']){
  const raw=readFileSync(file(name)),entry=provenance.outputs.find(value=>value.file===name);assert.ok(entry);assert.equal(hash(raw),entry.sha256);
  const source=JSON.parse(raw);validateExperimentRecord(source);assert.equal(source.identity.modelVersion,'3.12.0');assert.equal(source.initialSnapshot.physical.modelVersion,'3.12.0');
  const rejection=await assertHistoricalReadOnly({source,bytes:raw,path:file(name),createSim:currentWorld});
  assert.equal('_researchHeightControl' in source.initialSnapshot.physical.state,false);
  if(name==='live-record-3.12.json'){
    const state=source.initialSnapshot.physical.state,params=source.initialSnapshot.physical.params;
    assert.equal(params.supplyMode,'finite');assert.ok(state.gasMass<state.gasInitialMass);assert.ok(state.wheelStates.some(w=>Math.abs(w.angularVelocityRadS)>1));assert.ok(state._observationHistory.length>1);assert.equal(state._observationConfig.seed,312);
    assert.equal(params.verticalAccelerationMps2,4.5);assert.equal(params.rollRateDegS,220);assert.equal(params.climbRateMps,4.6);assert.ok(source.events.some(e=>e.method==='setSupplyMode'&&e.args[0]==='bench'));assert.ok(source.events.some(e=>e.method==='setSupplyMode'&&e.args[0]==='finite'));
  }else if(name==='live-record-midroll-3.12.json'){
    const provided=JSON.parse(readFileSync(file('x-midroll-3.12.json')));assert.deepEqual(source.initialSnapshot.physical,provided);
    const old=provided.state._maneuver;assert.equal(old.profile.kind,'pilot-rate-envelope');assert.equal(old.profile.durationS,2.5);assert.equal(old.launchAccelerationMps2,5);
  }
  evidence.push({fixture:name,sourceSHA256:entry.sha256,...rejection,
    originalInputJournalSHA256:hash(JSON.stringify(source.inputRuns)),originalCommandJournalSHA256:hash(JSON.stringify(source.events)),inputSteps:source.stepCount,commands:source.events.filter(e=>e.kind==='command').length,
    parameters:Object.keys(source.initialSnapshot.physical.params).length,initialGasMassKg:source.initialSnapshot.physical.state.gasMass,initialSupply:source.initialSnapshot.physical.params.supplyMode,initialWheelOmegaRadS:source.initialSnapshot.physical.state.wheelStates.map(w=>w.angularVelocityRadS),oldManeuverProfile:source.initialSnapshot.physical.state._maneuver?.profile??null,
    currentOnlyStateMissing:'_researchHeightControl',worldScope:entry.worldScope,legacyMigrationEvidence:'qa/history-compatibility-3.12-to-3.13.json'});
}

// Do not let the earlier unavailable-model error stand in for geometry safety.
// A new current-model city snapshot with the genuine old geometry signature
// must reach, and fail, the current destination's collision contract itself.
const city=JSON.parse(readFileSync(file('live-record-city-3.12.json'))),destination=currentWorld(city.initialSnapshot.physical),oldSignature=city.initialSnapshot.physical.geometrySignature,newSignature=destination.exportState().geometrySignature;
assert.notEqual(oldSignature,newSignature,'The current city collision identity differs from the archived complete city');
const recorder=new ExperimentRecorder({getSim:()=>destination,getContext:()=> 'city',now:()=> '2026-10-20T00:00:00.000Z'});recorder.start({name:'Current-model geometry rejection fixture'});
const input=recorder.beforeStep({}),telemetry=destination.advanceFixed(input,1/120);recorder.afterStep(telemetry,input,1/120);const incompatible=recorder.finish();
incompatible.initialSnapshot.physical.geometrySignature=oldSignature;incompatible.initialSnapshot.stateLabel=contentLabel(incompatible.initialSnapshot.physical);
const geometryRejection=await assertCurrentSnapshotRejected({record:incompatible,createSim:currentWorld,message:'快照不可恢复：场景几何或世界类型不匹配'});
evidence.push({fixture:'genuine-current-city-state-with-old-signature',...geometryRejection,oldGeometrySignature:oldSignature,currentGeometrySignature:newSignature,recordIdentity:incompatible.identity,scope:'Independent single-factor geometry fixture; no historical snapshot is relabelled or migrated.'});

const files=['tests/history-compatibility-3.13.test.mjs','tests/history-contract-3.14.mjs','qa/fixtures/generate-live-records-3.12.mjs','qa/fixtures/live-record-3.12-provenance.json',...provenance.outputs.map(v=>'qa/fixtures/'+v.file),'qa/fixtures/x-midroll-3.12.json','dist/experiment-records.js','dist/simulation-snapshot.js','dist/physics.js','dist/vehicle-models.js'];
const report={status:'passed',createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Genuine published 3.12 histories retain original identities, bytes, parameters, gas, wheels, old X profile and input/command journals in read/export. 3.14 has no declared migrator for their complete states and rejects before import or integration. A genuine current-model city snapshot independently tests collision-signature rejection; historical records are never relabelled as current.',fixtureProvenance:provenance,sourceHashes:Object.fromEntries(files.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))])),evidence};
const reportPath=new URL(`../qa/history-compatibility-3.12-to-${REPORT_VERSION}.json`,import.meta.url);writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log('PASS: Original 3.12 rolling/gas, mid-roll and city histories stay readable/exportable with original bytes and journals; undeclared 3.14 migration is explicitly refused.');
console.log('PASS: Retained legacy X profile is unchanged; a genuine current-model city state independently refuses the old geometry signature before integration.');
console.log('Report:',reportPath.pathname);
