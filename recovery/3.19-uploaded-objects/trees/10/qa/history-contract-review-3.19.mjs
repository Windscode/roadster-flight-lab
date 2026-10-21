// Release-specific read-only audit, run before renewing the central review gate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {createRouteSurfacePreset} from '../dist/route-surface.js';
import {ExperimentRecorder,ExperimentPlayback,replayEligibility,executeExperiment,prepareRecordedStateForCurrentModel,validateExperimentRecord,contentLabel,loadExperimentArchive,parseExperimentArchive,exportExperimentArchive,experimentCSV,EXPERIMENT_LIBRARY_KEY} from '../dist/experiment-records.js';
import {assertCurrentSnapshotRejected} from '../tests/history-contract-3.14.mjs';

const root=new URL('../',import.meta.url),file=p=>new URL(p,root),clone=structuredClone,hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(MODEL_VERSION,'3.19.0');
const fixtures=['qa/fixtures/live-record-3.8.json','qa/fixtures/live-record-3.9.json','qa/contact-step-contract-3.18.records.json.gz'],historical=[];
for(const path of fixtures){
  const raw=readFileSync(file(path)),parsed=JSON.parse(path.endsWith('.gz')?gunzipSync(raw):raw),records=parsed.records??[parsed];
  for(const record of records){
    validateExperimentRecord(record);const unchanged=JSON.stringify(record),eligible=replayEligibility(record);assert.equal(eligible.exact,false);assert.equal(eligible.recompute,false);assert.equal(eligible.migrationRequired,false);
    const destination=new RoadsterSim(record.initialSnapshot.physical.params,{world:record.initialSnapshot.physical.worldType}),before=destination.exportState();let imports=0,steps=0;
    const importState=destination.importState.bind(destination),advanceFixed=destination.advanceFixed.bind(destination);
    // Instrument methods without inventing enumerable physical-state fields.
    Object.defineProperty(destination,'importState',{value:(...args)=>{imports++;return importState(...args);}});
    Object.defineProperty(destination,'advanceFixed',{value:(...args)=>{steps++;return advanceFixed(...args);}});
    for(const recompute of [false,true])assert.throws(()=>new ExperimentPlayback(record,{sim:destination,recompute}),{message:eligible.reason});
    await assert.rejects(executeExperiment(record,{createSim:()=>destination,recompute:true,yieldEvery:0}),{message:eligible.reason});
    assert.throws(()=>prepareRecordedStateForCurrentModel(record,destination,{recompute:true}),/没有此历史模型的显式状态迁移器/);assert.equal(imports,0);assert.equal(steps,0);assert.deepEqual(destination.exportState(),before);
    assert.throws(()=>importState(record.initialSnapshot.physical),/模型 .* 与当前 3\.19\.0 不同/);assert.deepEqual(destination.exportState(),before);
    const archive=JSON.stringify({schema:'roadster.live-experiment-library',version:1,records:[record]});let writes=0;
    const storage={getItem:key=>key===EXPERIMENT_LIBRARY_KEY?archive:null,setItem(){writes++;throw Error('Unexpected history write');}};
    const loaded=loadExperimentArchive(storage);assert.equal(loaded.warning,null);assert.deepEqual(loaded.records,[record]);assert.deepEqual(parseExperimentArchive(JSON.stringify(exportExperimentArchive(loaded.records))),[record]);assert.ok(experimentCSV(record).includes('model='+record.identity.modelVersion));assert.equal(writes,0);assert.equal(JSON.stringify(record),unchanged);
    historical.push({path,fileSha256:hash(raw),id:record.id,sourceIdentity:record.identity,eligibility:eligible,physicalImports:imports,physicalSteps:steps,directImportRejected:true,viewExportUnchanged:true,storageWrites:writes,originalRouteFieldPresent:'_routeSurface' in record.initialSnapshot.physical.state,originalContactFeedbackPresent:'_contactFeedback' in record.initialSnapshot.physical.state});
  }
  assert.deepEqual(readFileSync(file(path)),raw);
}
const current=new RoadsterSim();current.setRouteSurface(createRouteSurfacePreset('after-rain'),{phase:'preparation'});
const recorder=new ExperimentRecorder({getSim:()=>current,getContext:()=> 'city'});recorder.start({name:'3.19 explicit compatibility review'});const input=recorder.beforeStep({brake:1}),t=current.advanceFixed(input,1/120);recorder.afterStep(t,input,1/120);const record=recorder.finish();validateExperimentRecord(record);assert.equal(replayEligibility(record).exact,true);
const original=record.initialSnapshot.physical,createSim=s=>new RoadsterSim(s.params,{world:s.worldType}),invalid=clone(record);invalid.initialSnapshot.physical.geometrySignature='different-current-collision-world';invalid.initialSnapshot.stateLabel=contentLabel(invalid.initialSnapshot.physical);
const geometry=await assertCurrentSnapshotRejected({record:invalid,createSim,message:'快照不可恢复：场景几何或世界类型不匹配'});
const destination=createSim(original);destination.setRouteSurface(createRouteSurfacePreset('dry-day'),{phase:'preparation'});destination._contactFeedback={sequence:7,lastEvent:null,rigidPairs:{},scope:'Destination history marker'};
const missing=clone(original);delete missing.state._routeSurface;delete missing.state._contactFeedback;destination.importState(missing);assert.equal(destination.getRouteSurface(),null);assert.equal(destination._contactFeedback.sequence,0);assert.equal(destination._contactFeedback.lastEvent,null);
const invalidFields=[];for(const [field,mutate,message] of [['_routeSurface',s=>s.state._routeSurface.materials.damp.gripScale=-1,/路线表面描述无效/],['_contactFeedback',s=>s.state._contactFeedback.sequence=-1,/接触反馈状态无效/]]){const s=clone(original),before=destination.exportState();mutate(s);assert.throws(()=>destination.importState(s),message);assert.deepEqual(destination.exportState(),before);invalidFields.push({field,rejectedBeforeMutation:true});}
const report={schema:'roadster-historical-contract-release-review',version:1,createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',scope:'Independent runtime checks before updating either per-release review assertion. No runtime, historical identity, migration allowlist, physical threshold or original fixture was changed.',historical,currentGeometry:geometry,currentSnapshotFields:{preservedInNewSnapshot:true,missingSameModelFields:{routeSurface:null,contactSequence:0,destinationHistoryNotInherited:true},invalidFields},auditHarnessCorrection:'The first ad hoc probe assigned enumerable instrumentation methods; the strict snapshot exporter correctly refused undeclared fields. This saved probe uses non-enumerable instrumentation, with no runtime change.',sourceHashes:Object.fromEntries(['dist/experiment-records.js','dist/simulation-snapshot.js','dist/landing-challenge.js','dist/vehicle-models.js','dist/model-build.js'].map(p=>[p,hash(readFileSync(file(p)))]))};
writeFileSync(file('qa/history-contract-review-3.19.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'passed',build:MODEL_BUILD_ID,historicalRecords:historical.map(r=>r.sourceIdentity.modelVersion),currentGeometry:geometry,newFields:report.currentSnapshotFields}));
