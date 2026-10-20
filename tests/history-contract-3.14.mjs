// Shared assertions reviewed for the 3.15 history contract. These do not manufacture a
// migration: historical bytes stay readable/exportable and an unavailable old
// model is rejected independently of current-model snapshot validation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {EXPERIMENT_LIBRARY_KEY,ExperimentPlayback,executeExperiment,validateExperimentRecord,replayEligibility,prepareRecordedStateForCurrentModel,loadExperimentArchive,parseExperimentArchive,exportExperimentArchive,experimentCSV} from '../dist/experiment-records.js';

export const unavailableModelReason=version=>'原模型 '+version+' 未安装，且没有此完整状态的迁移器；不能执行旧模型。可查看 / 导出历史，或在流程编辑器明确按当前模型重新建立试验。';

export async function assertHistoricalReadOnly({source,bytes,path,createSim}){
  assert.equal(MODEL_VERSION,'3.15.0','A later release must explicitly review this no-migrator contract.');
  validateExperimentRecord(source);assert.notEqual(source.identity.modelVersion,MODEL_VERSION);
  const before=JSON.stringify(source),reason=unavailableModelReason(source.identity.modelVersion),eligibility=replayEligibility(source);
  assert.deepEqual(eligibility,{exact:false,recompute:false,migrationRequired:false,reason});
  const destination=createSim(source.initialSnapshot.physical),destinationBefore=destination.exportState();let imports=0,steps=0;
  const importState=destination.importState,advanceFixed=destination.advanceFixed;
  Object.defineProperty(destination,'importState',{configurable:true,value:function(...args){imports++;return importState.apply(this,args);}});
  Object.defineProperty(destination,'advanceFixed',{configurable:true,value:function(...args){steps++;return advanceFixed.apply(this,args);}});
  assert.throws(()=>new ExperimentPlayback(source,{sim:destination}),{name:'Error',message:reason});
  assert.throws(()=>new ExperimentPlayback(source,{sim:destination,recompute:true}),{name:'Error',message:reason});
  await assert.rejects(executeExperiment(source,{createSim:()=>destination,recompute:true,yieldEvery:0}),{name:'Error',message:reason});
  assert.throws(()=>prepareRecordedStateForCurrentModel(source,destination,{recompute:true}),{name:'Error',message:'没有此历史模型的显式状态迁移器'});
  assert.equal(imports,0,'Missing-model rejection occurs before physical import');assert.equal(steps,0,'Missing-model rejection cannot advance physics');
  assert.deepEqual(destination.exportState(),destinationBefore);
  const raw=bytes??Buffer.from(before),archiveText='{\n  "schema":"roadster.live-experiment-library",\n  "version":1,\n  "records":['+raw.toString('utf8')+']\n}\n';
  let writes=0;const storage={getItem:key=>key===EXPERIMENT_LIBRARY_KEY?archiveText:null,setItem(){writes++;throw Error('History reads and exports must not save');}};
  const loaded=loadExperimentArchive(storage);assert.equal(loaded.warning,null);assert.deepEqual(loaded.records,[source]);
  assert.deepEqual(parseExperimentArchive(JSON.stringify(exportExperimentArchive(loaded.records))),[source]);
  assert.deepEqual(parseExperimentArchive(raw.toString('utf8')),[source]);
  assert.ok(experimentCSV(source).includes('model='+source.identity.modelVersion));
  assert.equal(writes,0);assert.equal(storage.getItem(EXPERIMENT_LIBRARY_KEY),archiveText);assert.equal(JSON.stringify(source),before);
  if(path)assert.deepEqual(readFileSync(path),raw,'Original historical fixture bytes must remain unchanged');
  return{sourceIdentity:source.identity,execution:'rejected-before-import-and-integration',reason,physicalImports:imports,physicalSteps:steps,historyViewAndExportRetained:true,sourceUnchanged:true,originalFileBytesUnchanged:!!path,archiveBytesUnchanged:true};
}

export async function assertCurrentSnapshotRejected({record,createSim,message}){
  validateExperimentRecord(record);assert.equal(record.identity.modelVersion,MODEL_VERSION);
  // Eligibility describes available code; physical consistency is checked when
  // importing into the actual destination, never inferred from this metadata.
  assert.equal(replayEligibility(record).exact,true);assert.equal(replayEligibility(record).recompute,true);
  const destination=createSim(record.initialSnapshot.physical),before=destination.exportState();let steps=0;
  const advanceFixed=destination.advanceFixed;
  Object.defineProperty(destination,'advanceFixed',{configurable:true,value:function(...args){steps++;return advanceFixed.apply(this,args);}});
  assert.throws(()=>new ExperimentPlayback(record,{sim:destination}),{name:'Error',message});
  await assert.rejects(executeExperiment(record,{createSim:()=>destination,recompute:true,yieldEvery:0}),{name:'Error',message});
  assert.equal(steps,0);assert.deepEqual(destination.exportState(),before,'Invalid current snapshot is rejected before any state is imported or integrated');
  return{modelVersion:MODEL_VERSION,reason:message,physicalSteps:steps,destinationUnchanged:true};
}
