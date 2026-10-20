import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {CityFlightChallenge,CITY_FLIGHT_ROUTE,CITY_FLIGHT_LIBRARY_KEY,makeCityFlightTask,validateCityFlightResult,parseCityFlightArchive,saveCityFlightLibrary,loadCityFlightLibrary,sweepCityGate} from '../dist/city-flight-challenge.js';
import {ExperimentPlayback,currentExperimentIdentity,contentLabel} from '../dist/experiment-records.js';
const dt=1/120,q={x:0,y:0,z:0,w:1};
function fixture(supplyMode='bench'){const sim=new RoadsterSim({supplyMode},{world:'city'});sim.reset('harbor');for(let i=0;i<240;i++)sim.advanceFixed({brake:1});return sim;}
function run({supplyMode='bench',variant='success'}={}){
 const sim=fixture(supplyMode),runner=new CityFlightChallenge(sim,{task:makeCityFlightTask({supplyMode})}).start();let phase='drive',phaseStep=0,reverseSent=false;
 const commands=[];function command(method,...args){commands.push({step:runner.step,method,args:structuredClone(args)});sim[method](...args);}
 while(!runner.finished){
  const t=sim.telemetry();let input={};
  if(phase==='drive'){
   const v=t.velocity.z,remaining=258-t.position.z,brake=remaining<=Math.max(3,v*v/8);
   input={throttle:brake?0:Math.min(1,Math.max(0,(6-v)*.25)),brake:brake?1:0};
   if(variant==='missed-takeoff')input={throttle:Math.min(1,Math.max(0,(6-v)*.25))};
   else if(remaining<3&&Math.abs(v)<.15){phase='rise';phaseStep=runner.step;command('setPoseTarget',{position:{x:400,y:variant==='high-gate'?18:12,z:t.position.z},quaternion:q});}
  }else if(phase==='rise'&&runner.step-phaseStep>300){phase='travel';phaseStep=runner.step;command('setPoseTarget',{position:{x:400,y:variant==='high-gate'?18:12,z:305},quaternion:q});}
  else if(phase==='travel'){
   if(variant==='reverse'&&runner.gatePassed&&!reverseSent){reverseSent=true;command('setPoseTarget',{position:{x:400,y:12,z:270},quaternion:q});}
   else if(variant!=='reverse'&&Math.abs(t.position.z-305)<.8&&Math.abs(t.velocity.z)<.35){phase='land';phaseStep=runner.step;command('startManeuver','land');}
  }
  input=runner.beforeStep(input);if(runner.finished)break;runner.afterStep(sim.advanceFixed(input,dt),input,dt);
 }
 validateCityFlightResult(runner.result);assert.equal(contentLabel(runner.result.liveExperiment.initialSnapshot.physical),runner.result.liveExperiment.initialSnapshot.stateLabel);
 assert(!commands.some(c=>['reset','setParam','refillGas'].includes(c.method)),'fixture initialization is before the recorded attempt; no pose/mass/thrust overwrite within attempt');
 return{result:runner.result,commands};
}
const success=run();assert.equal(success.result.status,'completed');assert(success.result.summary.groundDistanceM>18);assert(success.result.summary.takeoffAtS>success.result.summary.driveCheckpointAtS);assert(success.result.summary.gateCrossing.timeS>success.result.summary.takeoffAtS);assert(success.result.summary.firstContact.timeS>success.result.summary.gateCrossing.timeS);assert(success.result.summary.stableLandingAtS>success.result.summary.firstContact.timeS);assert.equal(success.result.violations.length,0);assert.equal(success.result.summary.onboardDischargedKg,0);assert(success.result.summary.externalSupplyKg>0);
const finite=run({supplyMode:'finite'});assert.equal(finite.result.status,'failed');assert.notEqual(finite.result.reason,'solver_fault');assert(finite.result.summary.onboardDischargedKg>0);assert.equal(finite.result.summary.externalSupplyKg,0);
const missed=run({variant:'missed-takeoff'});assert.equal(missed.result.reason,'missed_takeoff_strip');
const high=run({variant:'high-gate'});assert.equal(high.result.reason,'gate_envelope_outside');assert.equal(high.result.summary.landingSucceeded,false);
const reverse=run({variant:'reverse'});assert.equal(reverse.result.reason,'reverse_gate_crossing');assert(reverse.result.summary.gateCrossing,'reverse violation must follow a real valid forward crossing');
// Full-state export/reload + actual existing command/input playback, with a
// new independent task observer on every 120 Hz step.
const imported=parseCityFlightArchive(JSON.stringify(success.result)).records[0],replaySim=fixture(),playback=new ExperimentPlayback(imported.liveExperiment,{sim:replaySim}),replay=new CityFlightChallenge(replaySim,{task:imported.task}).start();
while(!playback.finished&&!replay.finished){const input=playback.nextInput();if(playback.finished)break;replay.beforeStep(input);const t=replaySim.advanceFixed(input,dt);playback.afterStep(t);replay.afterStep(t,input,dt);}
assert.equal(replay.result?.status,'completed');assert.equal(replay.step,success.result.stepCount);assert.equal(contentLabel(replay.result.liveExperiment.finalSnapshot.physical),contentLabel(success.result.liveExperiment.finalSnapshot.physical));
// Cancellation and forbidden commands retain physical terminal evidence.
const cancelSim=fixture(),cancelRunner=new CityFlightChallenge(cancelSim).start(),before=JSON.stringify(cancelSim.exportState());cancelRunner.cancel();assert.equal(JSON.stringify(cancelSim.exportState()),before);validateCityFlightResult(cancelRunner.result);
const resetSim=fixture(),resetRunner=new CityFlightChallenge(resetSim).start();resetSim.reset('free');assert.equal(resetRunner.result.reason,'reset_attempt');assert(resetRunner.result.liveExperiment.finalSnapshot.physical.body.position.values[1]>8);assert(resetSim.body.position.y<1);validateCityFlightResult(resetRunner.result);
// A single large frame may contain a crossing: the primitive uses the swept
// segment, never equality at a sampled render position. Reverse is separate.
const a={position:{x:400,y:12,z:279},velocity:{x:0,y:0,z:240}},b={position:{x:400,y:12,z:281},velocity:{x:0,y:0,z:240}},env=p=>[{...p.position}];const sweep=sweepCityGate(a,b,env(a),env(b));assert(sweep.inside);assert.equal(sweep.fraction,.5);assert.equal(sweepCityGate(b,a,env(b),env(a)).direction,'reverse');
// Isolated storage fixtures: old bytes survive rejection; the new complete
// result remains in memory for export, and corrupt archives stay quarantined.
const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem(k,v){data.set(k,v);}};const one={schema:'roadster.city-flight-library',version:1,records:[success.result]};saveCityFlightLibrary(storage,one,{expectedRaw:null});const old=data.get(CITY_FLIGHT_LIBRARY_KEY);assert.equal(loadCityFlightLibrary(storage).value.records[0].id,success.result.id);
const reject={getItem:storage.getItem,setItem(){throw new DOMException('fixture full','QuotaExceededError');}},candidate={...one,records:[...one.records,finite.result]};assert.throws(()=>saveCityFlightLibrary(reject,candidate,{expectedRaw:old}),/fixture full/);assert.equal(data.get(CITY_FLIGHT_LIBRARY_KEY),old);assert.equal(candidate.records.length,2);assert.equal(parseCityFlightArchive(JSON.stringify(candidate)).records.length,2);
const bad='{"schema":"unsupported","secretless_fixture":true}';data.set(CITY_FLIGHT_LIBRARY_KEY,bad);const isolated=loadCityFlightLibrary(storage);assert.equal(isolated.protectedRaw,bad);assert.throws(()=>saveCityFlightLibrary(storage,one,{protectedRaw:isolated.protectedRaw}),/只读隔离/);assert.equal(data.get(CITY_FLIGHT_LIBRARY_KEY),bad);
const results=[success,finite,missed,high,reverse];const report={schema:'roadster-city-flight-qa',version:1,identity:currentExperimentIdentity(),route:CITY_FLIGHT_ROUTE,setup:'Existing harbor scenario initialized before each attempt, then 240 physical settling steps. This is a numerical solver fixture, not evidence of a native user driving to the start from the website.',fixedHz:120,results:results.map(({result,commands})=>({id:result.id,status:result.status,reason:result.reason,summary:result.summary,stepCount:result.stepCount,taskId:result.taskId,collisionIdentity:result.collisionIdentity,commands})),replay:{status:replay.result.status,steps:replay.step,identicalFinalPhysicalContentLabel:true},cancellation:{unchangedPhysicalState:true},resetFailure:{preResetTerminalRetained:true},storage:{quotaOldBytesUnchanged:true,fullUnsavedCandidateExportable:true,corruptRawQuarantined:true},limits:['No GPU rendering or native keyboard result is claimed by these numeric fixtures.','The successful external-supply route does not establish finite-gas feasibility; finite failure is retained.','Task score is gated on collision-free stable landing before time and gas.']};
fs.mkdirSync('qa',{recursive:true});fs.writeFileSync('qa/city-flight-3.15.json',JSON.stringify(report,null,2));fs.writeFileSync('qa/city-flight-3.15-records.json',JSON.stringify({schema:'roadster.city-flight-library',version:1,records:results.map(x=>x.result)},null,2));console.log('city-flight-3.15: passed; bench '+success.result.durationS+' s; finite failure='+finite.result.reason+'; complete physical replay matched');
