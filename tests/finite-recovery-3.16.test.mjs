import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RoadsterSim} from '../dist/physics.js';
import {FlightProgramRunner,defaultProgramLibrary,compactResult,parseResultArchive} from '../dist/flight-programs.js';
import {FINITE_PROGRAM_RECOVERY,finiteProgramRecoveryDecision} from '../dist/finite-program-recovery.js';
import {contentLabel} from '../dist/experiment-records.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const checks=[],cases=[],traces=[],policy=defaultProgramLibrary().programs.find(p=>p.id==='finite-budget'),hash=x=>createHash('sha256').update(x).digest('hex');
const check=(name,pass,detail={})=>{checks.push({name,passed:!!pass,...detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
function fixture(pressure,supplyMode='finite'){
  const s=new RoadsterSim({initialPressureBar:pressure,supplyMode},{world:'windlab'});for(let i=0;i<240;i++)s.advanceFixed({});return s;
}
function run(snapshot,pressure,enabled,initialSupply='finite'){
  const s=fixture(pressure,initialSupply);s.importState(snapshot);const initial=s.exportState(),start=s.simTime,initialGas=s.gasMass,id=`${pressure}bar-${enabled?'reserve-recovery':'original-schedule'}-${initialSupply}`;let result=null,firstContact=null,hasFlown=false,peakHeight=s.body.position.y,maxGasBudgetError=0,externalDuringTask=0,steps=0,refined=0;
  const r=new FlightProgramRunner({getSim:()=>s,getContext:()=> 'lab',finiteRecovery:enabled,now:()=> `2026-10-20T00:${String(cases.length).padStart(2,'0')}:00.000Z`,onFinish:x=>result=x});r.start(policy);
  for(;steps<120*35&&r.active;steps++){
    const before=s.telemetry(),input=r.stepInput(1/120,{});if(!r.active)break;
    const t=s.advanceFixed(input);r.afterFixedStep(t);if(t.integration.substeps>1)refined++;
    externalDuringTask+=t.integration.externalGasDeltaKg;maxGasBudgetError=Math.max(maxGasBudgetError,Math.abs(initialGas-t.gasMass-t.onboardGasConsumedKg));peakHeight=Math.max(peakHeight,t.position.y);
    if(t.contactCount===0&&t.position.y>.8)hasFlown=true;
    if(hasFlown&&!firstContact&&t.contactCount>0)firstContact={timeS:t.simTime-start,preControlStepVerticalMps:before.velocity.y,postControlStepVerticalMps:t.velocity.y,tiltDeg:Math.acos(Math.max(-1,Math.min(1,1-2*(t.quaternion.x*t.quaternion.x+t.quaternion.z*t.quaternion.z))))*180/Math.PI};
    traces.push(JSON.stringify({id,step:steps+1,timeS:t.simTime-start,mode:t.mode,contacts:t.contactCount,position:t.position,velocity:t.velocity,quaternion:t.quaternion,pressureBar:t.pressureBar,gasMassKg:t.gasMass,onboardGasConsumedKg:t.onboardGasConsumedKg,externalGasSuppliedKg:t.externalGasSuppliedKg,integration:t.integration,recovery:r.active?.recovery?{state:r.active.recovery.state,elapsedS:r.active.recovery.elapsedS,stableTimeS:r.active.recovery.stableTimeS}:null}));
  }
  const t=s.telemetry(),row={id,initialPressureBar:pressure,initialSupply,guardEnabled:enabled,initialStateLabel:contentLabel(initial),initialGasKg:initialGas,requestedProgram:policy,steps,actualDurationS:t.simTime-start,refinedControlSteps:refined,peakHeightM:peakHeight,firstContact,firstContactLimitMps:1.4,adverseFirstContact:!firstContact||Math.max(0,-firstContact.preControlStepVerticalMps)>1.4||firstContact.tiltDeg>8,externalGasDuringTaskKg:externalDuringTask,gasMassBalanceMaxErrorKg:maxGasBudgetError,finalGasKg:t.gasMass,restoredSupply:t.supplyMode,result};cases.push(row);
  console.log(`${id}: ${firstContact?.preControlStepVerticalMps.toFixed(3)} m/s first contact, ${result?.status}, ${row.actualDurationS.toFixed(3)} s, ${t.gasMass.toFixed(3)} kg left.`);return row;
}
for(const pressure of [100,150,200,350,125,275]){
  const snapshot=fixture(pressure).exportState();for(const enabled of [false,true])run(snapshot,pressure,enabled);
}
const benchRestore=run(fixture(350,'bench').exportState(),350,true,'bench');
const old=cases.filter(c=>!c.guardEnabled),guarded=cases.filter(c=>c.guardEnabled),pairs=old.map(a=>({before:a,after:cases.find(b=>b.guardEnabled&&b.initialPressureBar===a.initialPressureBar&&b.initialSupply===a.initialSupply)}));
check('Every guarded comparison imports the identical full initial physical snapshot and original program',pairs.every(({before:a,after:b})=>a.initialStateLabel===b.initialStateLabel&&JSON.stringify(a.requestedProgram)===JSON.stringify(b.requestedProgram)));
check('The original schedule retains every measured hard contact and does not hide a contradictory workflow outcome',old.every(c=>c.adverseFirstContact&&['completed','failed'].includes(c.result.status))&&old.some(c=>c.result.status==='completed'),{scope:'Workflow completion was not proof of safe landing; these before-policy measurements remain in the report.'});
check('The same finite gas, thrust and original land controller reduce the measured touchdown speed across all six pressures',pairs.every(({before:a,after:b})=>b.firstContact&&Math.abs(b.firstContact.preControlStepVerticalMps)<Math.abs(a.firstContact.preControlStepVerticalMps)&&!b.adverseFirstContact));
check('The requested task is explicitly interrupted, and only actual sustained wheel-supported recovery is called landed',guarded.every(c=>c.result.status==='cancelled'&&c.result.finiteRecovery.originalTaskCompleted===false&&c.result.finiteRecovery.state==='landed'&&c.result.finiteRecovery.stableTimeS>=.5-1e-9&&c.result.stages.at(-1).outcome==='interrupted-for-finite-recovery'));
check('No external gas enters any physical step of the original or recovered finite task',cases.every(c=>Math.abs(c.externalGasDuringTaskKg)<1e-12&&c.gasMassBalanceMaxErrorKg<1e-7&&c.finalGasKg>=0&&Math.abs(c.result.summary.gasThroughputKg-(c.initialGasKg-c.finalGasKg))<1e-7));
check('The inherited bench setting is restored only after the finite recovery has finished',benchRestore.restoredSupply==='bench'&&benchRestore.result.supplyMode==='finite'&&benchRestore.result.finiteRecovery.externalGasUsedKg===0&&benchRestore.result.finiteRecovery.state==='landed');
const archive=JSON.stringify({schema:'roadster.flight-results',version:1,results:guarded.map(c=>compactResult(c.result))});
check('Recovery reasons, the untouched requested stages and measured recovery evidence survive result archive round-trip',parseResultArchive(archive).every((r,i)=>JSON.stringify(r.finiteRecovery)===JSON.stringify(guarded[i].result.finiteRecovery)&&JSON.stringify(r.program)===JSON.stringify(policy)));
{
  const s=fixture(150);s.body.position.y=2;s._contactCount=0;s.setMode('hover');s.setWind({speedMps:2,directionDeg:90,gustMps:0,gustPeriodS:4});
  check('The simple near-level calm forecast is not silently extended to wind or failed-nozzle tasks',finiteProgramRecoveryDecision(s,s.telemetry())===null);s.clearWind();s.setNozzleFault({id:'lift-FL',scale:.5});assert.equal(finiteProgramRecoveryDecision(s,s.telemetry()),null);
}
const bytes=gzipSync(Buffer.from(traces.join('\n')+'\n'),{level:9}),traceName='finite-recovery-3.16.ndjson.gz';writeFileSync(new URL('../qa/'+traceName,import.meta.url),bytes);
const sources=['dist/physics.js','dist/finite-program-recovery.js','dist/flight-programs.js','dist/landing-reserve.js'];
const report={schema:'roadster-finite-program-recovery-evidence',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,createdAt:new Date().toISOString(),status:checks.every(c=>c.passed)?'passed-with-original-task-interruptions':'failed',policy:FINITE_PROGRAM_RECOVERY,checks,cases,sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))])),trace:{file:traceName,bytes:bytes.length,samples:traces.length,sha256:hash(bytes)},limits:['Both branches run the same current physical solver. The sole policy difference is whether the existing finite landing estimate may interrupt the original schedule.','A return to ground sacrifices the remaining requested stages; cancelled is deliberate and is not counted as original-task completion.','100/150/200/350 bar were the exploratory comparison; 125/275 bar are additional preselected pressure checks, not real-vehicle validation.','The reserve forecast is one-dimensional and only used inside its calm, nearly level validity envelope. The 25% predicted remaining fraction is an explicit conservative policy margin, not an actuator increase or certified safe reserve.','Touchdown speed is sampled from successive 120 Hz control states; contact may begin inside a refined step. This is not a native-video or crash-safety certificate.','The separate finite 100 bar disturbance-landing research task retains its existing failed outcome; its task protocol is not shortened or replaced.']};
writeFileSync(new URL('../qa/finite-recovery-3.16.json',import.meta.url),JSON.stringify(report,null,2)+'\n');assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
