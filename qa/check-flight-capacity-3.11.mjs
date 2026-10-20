import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
// Reproduce the finite/bench capacity probe using public city scenarios and the
// actual flight-program runner. This is numerical evidence, not visual QA.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {FlightProgramRunner,defaultProgramLibrary} from '../dist/flight-programs.js';
const DT=1/120,cases=[];
const sources=['dist/physics.js','dist/vehicle-models.js','dist/flight-programs.js'];
for(const settings of [
  {label:'standard-bench-600',params:{supplyMode:'bench',tankLitres:600}},
  {label:'standard-finite-900',params:{supplyMode:'finite',tankLitres:900}},
  {label:'maneuver-bench-600',params:{supplyMode:'bench',tankLitres:600,rollRateDegS:240,pitchRateDegS:90,angularAccelerationDegS2:480,climbRateMps:14,verticalAccelerationMps2:6}},
  {label:'maneuver-finite-900',params:{supplyMode:'finite',tankLitres:900,rollRateDegS:240,pitchRateDegS:90,angularAccelerationDegS2:480,climbRateMps:14,verticalAccelerationMps2:6}},
])for(const scenario of ['free','hover']){
  const sim=new RoadsterSim(settings.params,{world:'city'});sim.reset(scenario);
  if(scenario==='hover'){const t=sim.telemetry();sim.setPoseTarget({position:t.position,quaternion:t.quaternion});}
  for(let k=0;k<240;k++)sim.advanceFixed({},DT);
  const before=sim.telemetry();let result,thrown=null;
  const runner=new FlightProgramRunner({getSim:()=>sim,getContext:()=> 'city',onFinish:r=>result=r});
  try{runner.start(defaultProgramLibrary().programs.find(p=>p.id==='roll-return'));}catch(e){thrown=e.message;}
  const plan=sim.getReference().maneuver;
  let maxHeight=before.heightWorld,minHeight=before.heightWorld,peakRollSpeed=0,contactDuringRotate=false;
  for(let k=0;k<30/DT&&runner.active;k++){
    const rotate=sim.telemetry().maneuver?.phase==='rotate',t=sim.advanceFixed(runner.stepInput(DT,{}),DT);
    maxHeight=Math.max(maxHeight,t.heightWorld);minHeight=Math.min(minHeight,t.heightWorld);
    const local=sim.body.quaternion.conjugate().vmult(sim.body.angularVelocity);
    peakRollSpeed=Math.max(peakRollSpeed,Math.abs(local.z)*180/Math.PI);
    if(rotate&&(t.contactCount||sim.world.contacts.some(c=>c.bi===sim.body||c.bj===sim.body)))contactDuringRotate=true;
    if(t.fault)throw Error(t.fault);
  }
  const t=sim.telemetry();
  const row={label:settings.label,scenario,params:settings.params,initialPosition:before.position,
    initialGasMassKg:sim.gasInitialMass,gasAtStartKg:before.gasMass,status:result?.status||'running',
    reason:thrown||result?.reason,durationS:result?.durationS,
    plan:plan?{duration:plan.duration,launchVelocity:plan.launchVelocity,launchAccelerationMps2:plan.launchAccelerationMps2,requiredImpulseNs:plan.requiredImpulseNs,plannedPeakHeight:plan.plannedPeakHeight}:null,
    finalMode:t.mode,finalHeightM:t.heightWorld,finalContacts:t.contactCount,gasEndKg:t.gasMass,
    maxRiseM:maxHeight-before.heightWorld,minRelativeHeightM:minHeight-before.heightWorld,
    peakRollSpeedDegS:peakRollSpeed,contactDuringRotate};
  cases.push(row);console.log(JSON.stringify(row));
}
const report={modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),
  sourceSha256:Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(fs.readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),
  reproductionCommand:'node qa/check-flight-capacity-3.11.mjs',
  scope:'Complete original city, public free/hover starts, 2 s settling with physical pose hold in hover, actual 120 Hz solver, no parameter overrides after start and no WebGL.',
  interpretation:'A null plan means a preflight refusal: duration/rise/rate zero indicate no maneuver was executed. Hover settling consumes finite gas before the recorded start; compare gasAtStartKg and the full stated scenario.',cases};
fs.writeFileSync(new URL(`./flight-capacity-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
