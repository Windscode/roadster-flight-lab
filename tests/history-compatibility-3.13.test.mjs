import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {COMMAND_METHODS,EXPERIMENT_LIBRARY_KEY,validateExperimentRecord,replayEligibility,prepareRecordedStateForCurrentModel,executeExperiment,ExperimentPlayback,loadExperimentArchive,parseExperimentArchive,exportExperimentArchive,experimentCSV} from '../dist/experiment-records.js';

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

function flatCurrent(snapshot){
  const sim=new RoadsterSim(snapshot.params);
  for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
  sim.body.position.set(0,40,-240);sim.setMode('hover');return sim;
}
const currentWorld=snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType});
function instrumentFactory(createSim,observed){return snapshot=>{
  const sim=createSim(snapshot),advance=sim.advanceFixed;let inStep=false,commandDepth=0,step=0;
  for(const method of COMMAND_METHODS){const original=sim[method];if(typeof original!=='function')continue;
    Object.defineProperty(sim,method,{configurable:true,writable:true,value:function(...args){
      const capture=!inStep&&commandDepth===0;commandDepth++;
      try{return original.apply(this,args);}finally{commandDepth--;if(capture)observed.commands.push({step,method,args:copy(args)});}
    }});
  }
  Object.defineProperty(sim,'advanceFixed',{configurable:true,writable:true,value:function(input,dt){observed.inputs.push(copy(input));inStep=true;try{return advance.call(this,input,dt);}finally{inStep=false;step++;}}});
  return sim;
};}

for(const name of ['live-record-3.12.json','live-record-midroll-3.12.json']){
  const raw=readFileSync(file(name)),before=Buffer.from(raw),entry=provenance.outputs.find(value=>value.file===name);assert.ok(entry);assert.equal(hash(raw),entry.sha256);
  const source=JSON.parse(raw);validateExperimentRecord(source);assert.equal(source.identity.modelVersion,'3.12.0');assert.equal(source.initialSnapshot.physical.modelVersion,'3.12.0');
  const originalText=JSON.stringify(source),factory=name.includes('midroll')?flatCurrent:currentWorld,eligible=replayEligibility(source);
  assert.equal(eligible.exact,false);assert.equal(eligible.recompute,true);assert.equal(eligible.migrationRequired,true);
  assert.throws(()=>new ExperimentPlayback(source,{sim:factory(source.initialSnapshot.physical)}),/不能精确重放/);
  const prepared=prepareRecordedStateForCurrentModel(source,factory(source.initialSnapshot.physical),{recompute:true});
  const expected=copy(source.initialSnapshot.physical);expected.modelVersion=MODEL_VERSION;
  assert.deepEqual(prepared.physical,expected,'Only the declared model version changes; full historical parameters/body/wheels/gas/controller state survive');
  assert.deepEqual(prepared.compatibility.migration.changed,['modelVersion']);assert.deepEqual(prepared.compatibility.migration.parameterMapping,{});assert.deepEqual(prepared.compatibility.migration.addedDefaultState,[]);

  // Viewing and explicitly recalculating a history must not write the archive.
  // Keep the original formatting bytes too, not merely a canonical JSON copy.
  const archiveText='{\n  "schema":"roadster.live-experiment-library",\n  "version":1,\n  "records":['+raw.toString('utf8')+']\n}\n',storage=new Map([[EXPERIMENT_LIBRARY_KEY,archiveText]]);
  const loaded=loadExperimentArchive({getItem:key=>storage.get(key),setItem(){throw Error('History reads / recomputation must not implicitly save');}});assert.equal(loaded.warning,null);assert.deepEqual(loaded.records[0],source);
  const observed={inputs:[],commands:[]},run=await executeExperiment(loaded.records[0],{createSim:instrumentFactory(factory,observed),recompute:true,yieldEvery:0});
  assert.equal(run.status,'completed');assert.equal(run.completedSteps,source.stepCount);assert.equal(run.execution,'current-model-recompute');assert.equal(run.reproduction.status,'not_applicable');
  assert.deepEqual(run.sourceIdentity,source.identity);assert.equal(run.identity.modelVersion,MODEL_VERSION);assert.equal(run.identity.modelBuildId,MODEL_BUILD_ID);assert.deepEqual(run.initialSnapshot.physical,expected);
  assert.deepEqual(observed.inputs,source.inputRuns.flatMap(r=>Array.from({length:r.steps},()=>r.input)),'Recomputation feeds the original ordered driver journal');
  assert.deepEqual(observed.commands,source.events.filter(e=>e.kind==='command').map(({step,method,args})=>({step,method,args})),'Public commands retain their recorded fixed-step boundary and order');
  assert.equal(storage.get(EXPERIMENT_LIBRARY_KEY),archiveText);assert.equal(JSON.stringify(loaded.records[0]),originalText);assert.equal(JSON.stringify(source),originalText);assert.deepEqual(readFileSync(file(name)),before);
  assert.deepEqual(parseExperimentArchive(JSON.stringify(exportExperimentArchive(loaded.records))),loaded.records);assert.match(experimentCSV(source),/model=3\.12\.0/);

  if(name==='live-record-3.12.json'){
    const state=source.initialSnapshot.physical.state,params=source.initialSnapshot.physical.params;
    assert.equal(params.supplyMode,'finite');assert.ok(state.gasMass<state.gasInitialMass);assert.ok(state.wheelStates.some(w=>Math.abs(w.angularVelocityRadS)>1));assert.ok(state._observationHistory.length>1);assert.equal(state._observationConfig.seed,312);
    assert.equal(params.verticalAccelerationMps2,4.5);assert.equal(params.rollRateDegS,220);assert.equal(params.climbRateMps,4.6);assert.ok(source.events.some(e=>e.method==='setSupplyMode'&&e.args[0]==='bench'));assert.ok(source.events.some(e=>e.method==='setSupplyMode'&&e.args[0]==='finite'));
  }else{
    const provided=JSON.parse(readFileSync(file('x-midroll-3.12.json')));
    assert.deepEqual(source.initialSnapshot.physical,provided);
    const old=provided.state._maneuver,initial=run.initialSnapshot.physical.state._maneuver,final=run.finalSnapshot.physical.state._maneuver;
    assert.deepEqual(initial,old);assert.equal(initial.profile.kind,'pilot-rate-envelope');assert.equal(initial.profile.durationS,2.5);assert.equal(initial.launchAccelerationMps2,5);
    assert.equal(final.phase,'rotate');assert.deepEqual(final.profile,old.profile);assert.equal(final.duration,old.duration);assert.equal(final.launchAccelerationMps2,old.launchAccelerationMps2);
  }
  evidence.push({fixture:name,sourceSHA256:entry.sha256,sourceIdentity:source.identity,executionIdentity:run.identity,steps:run.completedSteps,status:run.status,reproduction:run.reproduction.status,migration:run.compatibility.migration,
    originalInputJournalSHA256:hash(JSON.stringify(source.inputRuns)),originalCommandJournalSHA256:hash(JSON.stringify(source.events)),inputSteps:observed.inputs.length,commands:observed.commands.length,
    parameters:Object.keys(source.initialSnapshot.physical.params).length,initialGasMassKg:source.initialSnapshot.physical.state.gasMass,initialSupply:source.initialSnapshot.physical.params.supplyMode,initialWheelOmegaRadS:source.initialSnapshot.physical.state.wheelStates.map(w=>w.angularVelocityRadS),oldManeuverProfile:source.initialSnapshot.physical.state._maneuver?.profile??null,
    originalFileBytesUnchanged:true,archiveBytesUnchanged:true,fullInitialStatePreservedExceptDeclaredVersion:true,worldScope:entry.worldScope});
}

const cityName='live-record-city-3.12.json',cityBytes=readFileSync(file(cityName)),city=JSON.parse(cityBytes),cityEntry=provenance.outputs.find(v=>v.file===cityName);assert.equal(hash(cityBytes),cityEntry.sha256);validateExperimentRecord(city);
const destination=currentWorld(city.initialSnapshot.physical),destinationBefore=destination.exportState(),oldSignature=city.initialSnapshot.physical.geometrySignature,newSignature=destinationBefore.geometrySignature;
assert.notEqual(oldSignature,newSignature,'The newly modelled South Quay collision envelopes change the complete city signature');
assert.equal(replayEligibility(city).recompute,true,'The model schema has a migrator; geometry is checked against the actual destination at execution');
let rejection='';await assert.rejects(async()=>{try{await executeExperiment(city,{createSim:()=>destination,recompute:true,yieldEvery:0});}catch(error){rejection=error.message;throw error;}},/历史场景几何与当前模型不同/);
assert.deepEqual(destination.exportState(),destinationBefore,'Reject before import/integration');assert.deepEqual(readFileSync(file(cityName)),cityBytes);assert.deepEqual(parseExperimentArchive(cityBytes.toString('utf8'))[0],city);assert.match(experimentCSV(city),/model=3\.12\.0/);
evidence.push({fixture:cityName,sourceSHA256:cityEntry.sha256,sourceIdentity:city.identity,oldGeometrySignature:oldSignature,currentGeometrySignature:newSignature,execution:'rejected-before-import-and-integration',reason:rejection,historyViewAndExportRetained:true,originalFileBytesUnchanged:true,worldScope:cityEntry.worldScope});

const files=['tests/history-compatibility-3.13.test.mjs','qa/fixtures/generate-live-records-3.12.mjs','qa/fixtures/live-record-3.12-provenance.json',...provenance.outputs.map(v=>'qa/fixtures/'+v.file),'qa/fixtures/x-midroll-3.12.json','dist/experiment-records.js','dist/simulation-snapshot.js','dist/physics.js','dist/vehicle-models.js'];
const report={status:'passed',createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Genuine published 3.12 histories retain original identities, bytes, parameters, gas, wheels and input/command journals. Explicit current-model recomputation is distinct from old-solver exact replay. The old full city is refused when collision signatures differ; declared compatible flat mid-roll keeps its recorded 2.5 s profile.',fixtureProvenance:provenance,sourceHashes:Object.fromEntries(files.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))])),evidence};
const reportPath=new URL(`../qa/history-compatibility-3.12-to-${REPORT_VERSION}.json`,import.meta.url);writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log('PASS: Original 3.12 complete rolling/gas histories explicitly recompute with all source state and journals preserved; original file/archive bytes are unchanged.');
console.log('PASS: Public record migration preserves the in-progress legacy X profile and refuses the changed full-city collision identity before integration.');
console.log('Report:',reportPath.pathname);
