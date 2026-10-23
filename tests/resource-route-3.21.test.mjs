import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {ResourceMission,prepareResourceRoute,completeResourcePreparation} from '../dist/resource-mission.js';
import {ExperimentRecorder,ExperimentPlayback} from '../dist/experiment-records.js';
import {prepare,driver,routeTerminal,DT} from './route-driver-3.21.mjs';
const style=process.argv[2]??'balanced',preset=process.argv[3]??'dry-day';
const sim=new RoadsterSim();prepareResourceRoute(sim,true);const descriptor=prepare(sim,preset);completeResourcePreparation(sim,true);
const recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=> 'city'});recorder.start({name:`3.21 ${style} ${preset}`});
const mission=new ResourceMission(sim,{descriptorHash:sim.getRouteSurface().descriptorHash,recordId:recorder.getState().id});recorder.event('resource_route_start',{identity:mission.identity});
const control=driver(style);let stable=0,completed=false,rigidSteps=0,minContacts=4,maxClosure=0,lastDistance=0;const checkpoints=new Set();
for(let step=0;step<120*70;step++){
 const input=control(sim);recorder.beforeStep(input);const t=sim.advanceFixed(input,DT);recorder.afterStep(t,t.driverInput,DT);assert.equal(t.fault,null);
 rigidSteps+=Number(t.rigidContactCount>0);minContacts=Math.min(minContacts,t.contactCount);maxClosure=Math.max(maxClosure,Math.abs(t.energyAccounting.balanceErrorJ));
 const z=t.position.z+380,progress=z<247.5?z:247.5+t.position.x+200;checkpoints.add(progress<60?0:progress<180?1:progress<235?2:3);
 if(mission.check(sim,t))break;
 stable=routeTerminal(descriptor,t)&&checkpoints.size===4?stable+DT:0;if(stable>=.5){completed=true;break;}
}
const result=mission.result(sim,completed?'route-completed':'not-completed');recorder.event('resource_route_result',result);const record=recorder.finish(completed?'completed':'cancelled',result.reason);
mkdirSync('qa/resource-3.21',{recursive:true});writeFileSync(`qa/resource-3.21/${style}-${preset}.json`,JSON.stringify({result,rigidSteps,minContacts,maxClosure,scope:'Numerical full-city driver, same production physics/record/replay. No native keys, GPU or audible device acceptance.'},null,2)+'\n');writeFileSync(`qa/resource-3.21/${style}-${preset}-record.json`,JSON.stringify(record)+'\n');
console.log(JSON.stringify({style,preset,completed:result.completed,reason:result.reason,elapsed:result.elapsedS,netWh:result.netEnergyJ/3600,recoveredWh:result.work.recoveredJ/3600,gas:result.gasUsedKg,remainingWh:result.remainingKWh*1000,rigidSteps,minContacts,maxClosure,position:sim.telemetry().position}));
assert(result.completed,'Actual route must finish within finite resources');assert.equal(rigidSteps,0);assert.equal(minContacts,4);assert(maxClosure<.02);assert(result.work.recoveredJ>0);assert.equal(result.externalGasKg,0);
if(process.env.REPLAY==='1'){
 const replay=new RoadsterSim(),playback=new ExperimentPlayback(record,{sim:replay});while(!playback.finished){const input=playback.nextInput();if(playback.finished)break;const t=replay.advanceFixed(input,DT);playback.afterStep(t);}
 assert.deepEqual(replay.exportState(),sim.exportState());const reproduction=playback.reproduction();writeFileSync(`qa/resource-3.21/${style}-${preset}-replay.json`,JSON.stringify(reproduction,null,2)+'\n');console.log('Exact full-state replay passed');
}
