// Recreate genuine historical records with the original public recorder and
// solver. This is fixture generation only; the application does not install or
// silently execute an old model. Requires the public commit in local git.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const commit='70e98013d6da246c78c4c50ca2ef44595d1f356b',temporary=await fs.mkdtemp(path.join(os.tmpdir(),'roadster-published-312-history-'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHashes={};
function gitSource(name){return new Promise((resolve,reject)=>{const child=spawn('git',['-C',root,'show',commit+':'+name],{stdio:['ignore','pipe','pipe']}),out=[],errors=[];child.stdout.on('data',chunk=>out.push(chunk));child.stderr.on('data',chunk=>errors.push(chunk));child.on('error',reject);child.on('close',code=>code===0?resolve(Buffer.concat(out)):reject(Error(Buffer.concat(errors).toString('utf8'))));});}
async function extract(name){
  if(Object.hasOwn(sourceHashes,name))return;
  const bytes=await gitSource(name);
  sourceHashes[name]=sha(bytes);await fs.mkdir(path.dirname(path.join(temporary,name)),{recursive:true});await fs.writeFile(path.join(temporary,name),bytes);
  for(const match of bytes.toString('utf8').matchAll(/(?:\bfrom\s+|\bimport\s*)['"](\.[^'"]+)['"]/g)){
    const child=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));
    assert.ok(child.startsWith('dist/')&&child.endsWith('.js'),'Unexpected dependency '+child);await extract(child);
  }
}
const dt=1/120;
function flat(Sim,params={}){
  const sim=new Sim(params);
  for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
  sim.body.position.set(0,40,-240);sim.setMode('hover');return sim;
}
try{
  await fs.writeFile(path.join(temporary,'package.json'),'{"type":"module"}\n');
  await extract('dist/physics.js');await extract('dist/experiment-records.js');
  const {RoadsterSim}=await import(pathToFileURL(path.join(temporary,'dist/physics.js')));
  const {ExperimentRecorder,executeExperiment,validateExperimentRecord}=await import(pathToFileURL(path.join(temporary,'dist/experiment-records.js')));
  async function capture(sim,{name,context,stamp,steps,input,intervene=()=>{},createSim}){
    let record;const recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=>context,now:()=>stamp,onFinish:r=>record=r});
    recorder.start({name});
    for(let step=0;step<steps;step++){intervene(sim,step);const t=sim.advanceFixed(recorder.beforeStep(input(step)),dt);recorder.afterStep(t,t.driverInput,dt);}
    recorder.finish();validateExperimentRecord(record);assert.equal(record.status,'completed');assert.equal(record.identity.modelVersion,'3.12.0');
    const replay=await executeExperiment(record,{createSim,yieldEvery:0});
    assert.equal(replay.status,'completed');assert.deepEqual(replay.finalSnapshot.physical,record.finalSnapshot.physical);assert.deepEqual(replay.summary,record.summary);
    return record;
  }
  const laboratory=new RoadsterSim({supplyMode:'finite',verticalAccelerationMps2:4.5,climbRateMps:4.6,rollRateDegS:220,pitchRateDegS:78,angularAccelerationDegS2:420,tankLitres:650,initialPressureBar:330},{world:'windlab'});
  for(let i=0;i<240;i++)laboratory.advanceFixed({},dt);
  laboratory.setWind({speedMps:2.2,directionDeg:78,gustMps:.8,gustPeriodS:4.3});
  laboratory.setObservation({enabled:true,delayMs:50,seed:312,positionNoiseM:.008,velocityNoiseMps:.015,attitudeNoiseDeg:.1,angularRateNoiseRadS:.003});
  for(let i=0;i<120;i++)laboratory.advanceFixed({throttle:.32,steer:.06,rearJets:.08},dt);
  assert.ok(laboratory.wheelStates.some(w=>Math.abs(w.angularVelocityRadS)>1));assert.ok(laboratory.gasMass<laboratory.gasInitialMass);
  const lab=await capture(laboratory,{name:'Published 3.12 rolling finite-supply history',context:'lab',stamp:'2026-10-20T10:00:00.000Z',steps:240,
    input:i=>({throttle:i<120?.28:0,steer:i>=30&&i<150?.12:0,brake:i>=150?.35:0,rearJets:i<60?.05:0,frontJets:i>=180?.04:0}),
    intervene:(sim,i)=>{if(i===30)sim.setNozzleFault({id:'rear-boost',scale:.8});if(i===60)sim.setSupplyMode('bench');if(i===90)sim.clearNozzleFault();if(i===120)sim.setSupplyMode('finite');if(i===150)sim.setWing({mode:'fixed',deployment:.4});},
    createSim:s=>new RoadsterSim(s.params,{world:s.worldType})});
  const citySim=new RoadsterSim({supplyMode:'finite'},{world:'city'});for(let i=0;i<30;i++)citySim.advanceFixed({},dt);
  const city=await capture(citySim,{name:'Published 3.12 full-city collision identity',context:'city',stamp:'2026-10-20T10:01:00.000Z',steps:24,input:()=>({throttle:.2}),createSim:s=>new RoadsterSim(s.params,{world:s.worldType})});

  // The X comparison deliberately removes all non-ground static bodies. Its
  // supplied snapshot keeps the scene metadata used by that declared fixture;
  // do not rewrite the geometry signature or call it a full published city.
  const {RoadsterSim:LegacyFlatSim}=await import('./baseline-3.12-x/physics.js');
  const midrollBytes=await fs.readFile(new URL('./x-midroll-3.12.json',import.meta.url));
  const midrollSnapshot=JSON.parse(midrollBytes),midrollSim=flat(LegacyFlatSim,midrollSnapshot.params);midrollSim.importState(midrollSnapshot);
  assert.equal(midrollSim._maneuver?.profile?.kind,'pilot-rate-envelope');
  const midroll=await capture(midrollSim,{name:'Published 3.12 solver / declared flat mid-roll continuation',context:'city',stamp:'2026-10-20T10:02:00.000Z',steps:30,input:()=>({}),createSim:s=>flat(LegacyFlatSim,s.params)});
  assert.deepEqual(midroll.initialSnapshot.physical,midrollSnapshot);assert.equal(sha(await fs.readFile(new URL('./x-midroll-3.12.json',import.meta.url))),sha(midrollBytes));

  const outputs=[];
  for(const [file,record,worldScope]of [
    ['live-record-3.12.json',lab,'Unmodified public 3.12 wind laboratory; recorded rolling wheels, finite gas state, seeded delayed observations and ordered supply/fault/wing commands.'],
    ['live-record-city-3.12.json',city,'Unmodified full public 3.12 city geometry and solver. Its old collision identity must be rejected by the expanded 3.13 city.'],
    ['live-record-midroll-3.12.json',midroll,'Declared X-test flat fixture: frozen 3.12 solver with only ground/vehicle bodies; provided x-midroll-3.12 state retained exactly. Shared scene metadata is not claimed to be the full published 3.12 city.'],
  ]){
    const bytes=Buffer.from(JSON.stringify(record,null,2)+'\n');await fs.writeFile(new URL('./'+file,import.meta.url),bytes);
    outputs.push({file,sha256:sha(bytes),bytes:bytes.length,identity:record.identity,geometrySignature:record.initialSnapshot.physical.geometrySignature,worldScope,steps:record.stepCount,originalSolverExactReplay:true});
  }
  const provenance={commit,sourceHashes,sourceCount:Object.keys(sourceHashes).length,sourceScope:'Dependency closure extracted byte-for-byte from the public git commit. The original recorder executes the original solver for laboratory/full-city fixtures; only the declared mid-roll fixture uses the separately frozen relocated X solver and its provided two-body setup.',
    midrollSource:{file:'x-midroll-3.12.json',sha256:sha(midrollBytes),solverManifest:'baseline-3.12-x/manifest.json',solverManifestSHA256:sha(await fs.readFile(new URL('./baseline-3.12-x/manifest.json',import.meta.url)))},outputs,generator:'qa/fixtures/generate-live-records-3.12.mjs',generatorSHA256:sha(await fs.readFile(fileURLToPath(import.meta.url)))};
  await fs.writeFile(new URL('./live-record-3.12-provenance.json',import.meta.url),JSON.stringify(provenance,null,2)+'\n');
  console.log('PASS: Original published 3.12 recorder/solver generated and exactly replayed '+outputs.length+' historical fixtures.');console.log(JSON.stringify(outputs.map(({file,sha256,steps,geometrySignature})=>({file,sha256,steps,geometrySignature})),null,2));
}finally{await fs.rm(temporary,{recursive:true,force:true});}
