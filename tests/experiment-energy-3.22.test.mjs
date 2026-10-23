import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {RoadsterSim} from '../dist/physics.js';
import {ExperimentRecorder,executeExperiment,exportExperimentArchive} from '../dist/experiment-records.js';
import {createExperimentConsole} from '../dist/experiment-console.js';
import {setLanguage} from '../dist/i18n.js';
import {prepare,DT} from './route-driver-3.21.mjs';

const close=(a,b,label)=>assert(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);
function setup(){
  const sim=new RoadsterSim();prepare(sim);sim.prepareEnergy(.12);
  // Explicit rolling initial condition; all subsequent motion uses the solver.
  sim.body.velocity.set(0,0,16.667);
  for(const wheel of sim.wheelStates)wheel.angularVelocityRadS=16.667/sim.params.wheelRadius;
  return sim;
}
function step(recorder,sim,input){recorder.beforeStep(input);const t=sim.advanceFixed(input,DT);assert.equal(t.fault,null);recorder.afterStep(t,input,DT);return t;}
const sim=setup(),recorder=new ExperimentRecorder({getSim:()=>sim});
recorder.start({name:'Braking with net recharge'});
const initial=sim.telemetry();for(let i=0;i<240;i++)step(recorder,sim,{brake:.45});
const terminal=sim.telemetry(),record=recorder.finish();
const expectedNet=initial.energyKWh-terminal.energyKWh;
assert(expectedNet<0,'The actual braking trajectory must gain battery charge');
close(record.summary.energyUsedKWh,expectedNet,'Recorded signed net battery use');
close(record.summary.energyDischargedKWh,(terminal.energyAccounting.grossJ-initial.energyAccounting.grossJ)/3.6e6,'Gross delivered battery energy');
close(record.summary.energyRecoveredKWh,(terminal.energyAccounting.recoveredJ-initial.energyAccounting.recoveredJ)/3.6e6,'Recovered battery energy');
close(record.summary.energyUsedKWh,record.summary.energyDischargedKWh-record.summary.energyRecoveredKWh,'Gross minus recovered');
assert.equal(record.summary.energyAccountingComplete,true);
const createSim=()=>new RoadsterSim();
const replay=await executeExperiment(record,{createSim,yieldEvery:0});
assert.equal(replay.status,'completed');assert.equal(replay.reproduction.status,'matched');
for(const key of ['energyUsedKWh','energyDischargedKWh','energyRecoveredKWh'])close(replay.summary[key],record.summary[key],`Replay ${key}`);

// A recorded reset changes the resource initial condition, not recovered work.
const resetSim=setup(),resetRecorder=new ExperimentRecorder({getSim:()=>resetSim});
resetRecorder.start({name:'Energy across explicit reset'});
let expectedGross=0,expectedRecovered=0;
for(let part=0;part<2;part++){
  if(part)resetSim.reset('city');
  const before=resetSim.telemetry().energyAccounting;
  for(let i=0;i<24;i++)step(resetRecorder,resetSim,{brake:1});
  const after=resetSim.telemetry().energyAccounting;
  expectedGross+=(after.grossJ-before.grossJ)/3.6e6;
  expectedRecovered+=(after.recoveredJ-before.recoveredJ)/3.6e6;
}
const resetRecord=resetRecorder.finish();
close(resetRecord.summary.energyUsedKWh,expectedGross-expectedRecovered,'Reset does not manufacture recharge');
close(resetRecord.summary.energyRecoveredKWh,expectedRecovered,'Reset recovered work');
const resetReplay=await executeExperiment(resetRecord,{createSim,yieldEvery:0});
assert.equal(resetReplay.reproduction.status,'matched');
for(const key of ['energyUsedKWh','energyDischargedKWh','energyRecoveredKWh'])close(resetReplay.summary[key],resetRecord.summary[key],`Reset replay ${key}`);
if(process.env.JSDOM_MODULE_PATH){
  const {JSDOM}=createRequire(import.meta.url)(process.env.JSDOM_MODULE_PATH);
  const dom=new JSDOM('<main></main>'),oldDocument=globalThis.document;
  globalThis.document=dom.window.document;
  dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
  const legacy=structuredClone(record);legacy.id+='-legacy';legacy.summary.version=1;
  for(const key of ['energyAccountingComplete','energyAccountingScope','energyDischargedKWh','energyRecoveredKWh'])delete legacy.summary[key];
  const archive=JSON.stringify(exportExperimentArchive([record,legacy]));
  const ui=createExperimentConsole({mount:dom.window.document.querySelector('main'),getSim:()=>sim,storage:{getItem:()=>archive,setItem(){}}});
  try{
    const rows=()=>[...dom.window.document.querySelectorAll('[data-ex="comparison"] tbody tr')].slice(-3);
    assert(rows().every(row=>row.querySelector('td').textContent==='—'),'Legacy positive-only value must not be relabelled net energy');
    ui.selectRecord(record.id);
    assert.equal(rows()[0].querySelector('td').textContent,(expectedNet*1000).toFixed(3));
    setLanguage('en',{persist:false});
    assert.match(rows()[0].textContent,/Net battery use/);
    assert.match(dom.window.document.querySelector('[data-ex="comparison"]').textContent,/negative means net recharge/);
  }finally{ui.dispose();setLanguage('zh',{persist:false});globalThis.document=oldDocument;dom.window.close();}
}
console.log(JSON.stringify({status:'passed',scope:'Real fixed-step braking, recording and exact replay; explicit reset boundary',domIncluded:!!process.env.JSDOM_MODULE_PATH,netWh:record.summary.energyUsedKWh*1000,dischargedWh:record.summary.energyDischargedKWh*1000,recoveredWh:record.summary.energyRecoveredKWh*1000}));
