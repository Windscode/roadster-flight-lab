import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {readGitObject} from './git-object-read.mjs';
import {RoadsterSim} from '../dist/physics.js';
import {ExperimentRecorder} from '../dist/experiment-records.js';
import {estimateLandingReserve} from '../dist/landing-reserve.js';
import {hoverBudget} from '../dist/vehicle-models.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const baseline='9eda86e9d8687feec9245609282b8b568370927b',links=new Map();
for(const name of ['nozzle-supply.js','vehicle-models.js','physics-kernel-319.js','physics.js','landing-reserve.js']){
  const url=new URL('../dist/'+name,import.meta.url);
  const source=readGitObject(baseline+':dist/'+name).toString().replaceAll('import.meta.url',JSON.stringify(url.href))
    .replace(/from '\.\/([^']+)'/g,(_,dep)=>"from '"+(links.get(dep)??new URL(dep,url).href)+"'");
  links.set(name,'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {RoadsterSim:Prior}=await import(links.get('physics.js'));
const {estimateLandingReserve:oldForecast}=await import(links.get('landing-reserve.js'));
const dt=1/120,close=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<=eps,a+' differs from '+b);
const measurements=[];
function discharge(Type,gasModel){
  const sim=new Type({supplyMode:'finite',tankLitres:50,initialPressureBar:20,regulatorBar:5,ambientPressureBar:1,gasModel});
  sim.reset('free');
  const mass=sim.gasMass,samples=[];
  for(let i=0;i<120;i++){
    const t=sim.advanceFixed({frontJets:1,rearJets:1},dt);
    assert.equal(t.fault,null);
    if(Type===RoadsterSim){
      assert.ok(t.pressureBar>=sim.params.ambientPressureBar-2e-12);
      close(sim.gasMass+t.onboardGasConsumedKg,mass);
      close(t.massFlowKgS*dt,(samples.at(-1)?.massKg??mass)-sim.gasMass);
    }
    samples.push({pressureBar:t.pressureBar,massKg:sim.gasMass,thrustN:t.thrustN});
  }
  return samples;
}
for(const model of ['isothermal','adiabatic']){
  const old=discharge(Prior,model),current=discharge(RoadsterSim,model);
  assert.equal(old[2].pressureBar,0);assert.ok(current[2].massKg>0);
  measurements.push({model,firstThreeOld:old.slice(0,3),firstThreeCurrent:current.slice(0,3),minimumBar:Math.min(...current.map(x=>x.pressureBar)),final:current.at(-1)});
}
const sim=new RoadsterSim({supplyMode:'bench'});sim.reset('hover');sim.body.position.set(0,1,0);sim.body.velocity.y=-2;
const surface={distances:{down:{distanceM:.4,objectId:'ground'}}},base=sim.telemetry(),advisory=[];
for(const kind of ['closed','opposed longitudinal','vertical']){
  const t=structuredClone(base);
  // Controlled adviser input: same stored state and 20 kN scalar valve load,
  // split over two opposing horizontal or four upward valves.
  for(const n of t.nozzles)n.force=kind==='opposed longitudinal'&&n.kind==='longitudinal'?10000:kind==='vertical'&&n.kind==='lift'?5000:0;
  const result=estimateLandingReserve(t,sim.params,surface),old=oldForecast(t,sim.params,surface);
  advisory.push({kind,oldContact:old.landing.contactVerticalMps,contact:result.landing.contactVerticalMps,arrestDistance:result.arrest.heightRequiredM,throughput:result.landing.throughputKg});
}
const [closed,opposed,up]=advisory;
close(opposed.oldContact,up.oldContact);close(opposed.contact,closed.contact);close(opposed.arrestDistance,closed.arrestDistance);
assert.ok(opposed.throughput>closed.throughput&&up.arrestDistance<closed.arrestDistance&&up.contact>closed.contact);
const disabled={...sim.params,regulatorBar:50,initialPressureBar:1};
assert.equal(hoverBudget(disabled,sim.gasMass,sim.gasTemperature).seconds,0);
assert.equal(hoverBudget(sim.params,sim.gasMass,sim.gasTemperature).seconds,Infinity);
sim.body.velocity.set(0,0,0);sim.prepareEnergy(0);assert.equal(sim.telemetry().hoverBudgetSeconds??sim._hoverBudget().seconds,0);
const references=[];
for(const mode of ['climb','height-hold','level']){
  const s=new RoadsterSim({supplyMode:'bench'});s.reset('hover');
  if(mode==='level')s.setStabilizationMode('level');
  const journal=new ExperimentRecorder({getSim:()=>s});journal.start();
  for(let i=0;i<120;i++){const input={lift:mode==='climb'?1:0};journal.beforeStep(input);const t=s.advanceFixed(input,dt);journal.afterStep(t,t.driverInput,dt);}
  const last=journal.finish().samples.at(-1),ownership=s.getControlOwnership();
  if(mode==='climb'){assert.equal(last.positionErrorM,null);assert.equal(last.targetHeightM,null);}
  else if(mode==='height-hold'){
    close(s.getReference().position.y,ownership.heightTarget);close(last.targetHeightM,ownership.heightTarget);
    assert.ok(Number.isFinite(last.positionErrorM));
  }else{assert.equal(last.positionErrorM,null);assert.ok(Number.isFinite(last.targetHeightM));}
  references.push({mode,targetHeightM:last.targetHeightM,positionErrorM:last.positionErrorM});
}
const dir='qa/physics-'+REPORT_VERSION;mkdirSync(dir,{recursive:true});
writeFileSync(dir+'/discharge-reserve.json',JSON.stringify({baseline,status:'passed',measurements,advisory,references,scope:'120 live fixed steps for each tank model. The advisory comparison uses a controlled residual-valve state at 0.40 m sampled clearance.'},null,2)+'\n');
console.log('PASS open-valve ambient equilibrium, stored mass, residual thrust direction, hover supply');
