// Generates a real historical fixture from byte-identical published sources.
// Usage: node qa/generate-live-history-3.11-for-3.12.mjs /tmp/roadster-published-3.11-history-source
// The source folder must contain unmodified modules extracted from commit ab937.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const folder=resolve(process.argv[2]),manifest=JSON.parse(readFileSync(folder+'/source-manifest.json','utf8'));
assert.equal(manifest.commit,'ab9372b56a01c2a47b18d32baf48162f3cd8f86c');
for(const [path,hash]of Object.entries(manifest.sourceHashes))assert.equal(createHash('sha256').update(readFileSync(folder+'/'+path)).digest('hex'),hash);
const {RoadsterSim}=await import(pathToFileURL(folder+'/dist/physics.js')),{ExperimentRecorder,executeExperiment}=await import(pathToFileURL(folder+'/dist/experiment-records.js'));
const sim=new RoadsterSim({supplyMode:'bench',verticalAccelerationMps2:4.5},{world:'windlab'});sim.setMode('hover');
for(let i=0;i<240;i++)sim.advanceFixed({});sim.setWind({speedMps:3,directionDeg:90,gustMps:1,gustPeriodS:5});sim.setObservation({enabled:true,delayMs:50,seed:311,positionNoiseM:.008,velocityNoiseMps:.015,attitudeNoiseDeg:.1,angularRateNoiseRadS:.003});for(let i=0;i<37;i++)sim.advanceFixed({});
let record;const recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=> 'lab',now:()=> '2026-10-20T06:00:00.000Z',onFinish:value=>record=value});recorder.start({name:'Published 3.11 history fixture for explicit 3.12 migration'});
for(let i=0;i<240;i++){if(i===30)sim.setNozzleFault({id:'lift-FR',scale:.75});if(i===100)sim.clearNozzleFault();const state=sim.advanceFixed(recorder.beforeStep({lift:i<60?.4:0}));recorder.afterStep(state,state.driverInput,1/120);}recorder.finish();
assert.equal(record.identity.modelVersion,'3.11.0');assert.equal(record.initialSnapshot.physical.params.verticalAccelerationMps2,4.5);const replay=await executeExperiment(record,{createSim:snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType}),yieldEvery:0});assert.deepEqual(replay.finalSnapshot.physical,record.finalSnapshot.physical);assert.deepEqual(replay.summary,record.summary);
const target=new URL('./fixtures/live-record-3.11.json',import.meta.url);writeFileSync(target,JSON.stringify(record,null,2)+'\n');writeFileSync(new URL('./fixtures/live-record-3.11-provenance.json',import.meta.url),JSON.stringify({...manifest,fixtureSha256:createHash('sha256').update(readFileSync(target)).digest('hex'),identity:record.identity,sourceScope:'19 unmodified dependency files read from the public Git tree; original 3.11 recorder and original 3.11 solver executed for fixture creation only. Installed application still only executes current-model explicit recomputation.',originalSolverExactReplay:true,steps:record.stepCount,generator:'qa/generate-live-history-3.11-for-3.12.mjs'},null,2)+'\n');console.log('PASS: Genuine published 3.11 fixture generated and exactly replayed by its source solver.');
