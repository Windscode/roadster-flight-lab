import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RoadsterSim} from '../dist/physics.js';
import {RoadsterSim as BeforeSim} from './fixtures/pilot-input-3.14-before/physics.js';
import {driverAxes} from '../dist/controls.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const HZ=120,dt=1/HZ,checks=[],traces=[],results=[];
const hash=x=>createHash('sha256').update(x).digest('hex');
const v=x=>[x.x,x.y,x.z],q=x=>[x.x,x.y,x.z,x.w];
const physical=s=>({position:v(s.body.position),velocity:v(s.body.velocity),quaternion:q(s.body.quaternion),omega:v(s.body.angularVelocity),gasMass:s.gasMass,gasTemperature:s.gasTemperature,nozzleForces:s._nozzles.map(n=>n.force)});
const check=(name,ok,details={})=>{checks.push({name,passed:!!ok,...details});console.log((ok?'PASS':'FAIL')+' '+name);};
function fixture(Sim,{height=.62,g=false,mode=null,params={}}={}){
 const s=new Sim({supplyMode:'bench',...params});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.geometry=s.geometry.filter(x=>x.id==='ground');
 s.reset('free');s.body.position.set(0,height,-350);if(height<1)for(let i=0;i<180;i++)s._advance(dt,{});else s.setMode('hover');
 s.setAirStabilization(g);if(mode)s.setMode(mode);return s;
}
const cases=[
 ['air-g-on-we1',{height:20,g:true,keys:['KeyW','KeyE','Digit1']}],['air-g-off-we1',{height:20,g:false,keys:['KeyW','KeyE','Digit1']}],
 ['air-g-on-we2',{height:20,g:true,keys:['KeyW','KeyE','Digit2']}],['air-g-on-pitch',{height:20,g:true,keys:['Digit1']}],
 ['air-g-off-pitch',{height:20,g:false,keys:['Digit1']}],['air-g-on-we',{height:20,g:true,keys:['KeyW','KeyE']}],
 ['air-g-on-z',{height:20,g:true,keys:['KeyZ']}],['air-g-on-we1z',{height:20,g:true,keys:['KeyW','KeyE','Digit1','KeyZ']}],
 ['ground-g-on-we1',{g:true,keys:['KeyW','KeyE','Digit1']}],['ground-g-off-we1',{g:false,keys:['KeyW','KeyE','Digit1']}],
 ['ground-g-on-pitch',{g:true,keys:['Digit1']}],['ground-g-on-w',{g:true,keys:['KeyW']}],
 ['air-raw-pitch',{height:20,g:false,mode:'manual',keys:['Digit1']}],['air-raw-w',{height:20,g:false,mode:'manual',keys:['KeyW']}]
];
for(const [id,c]of cases)for(const [variant,Sim]of [['before',BeforeSim],['after',RoadsterSim]]){
 const s=fixture(Sim,c),input=driverAxes(new Set(c.keys),null),initial=physical(s);let hold=null,maxPitch=0,minPitch=0,maxRoll=0,maxRatio=0,fault=null;
 const heldSteps=78,releaseSteps=c.mode==='manual'?24:360;
 for(let step=1;step<=heldSteps+releaseSteps;step++){
  const command=step<=heldSteps?input:{};s._advance(dt,command);const a=s._angles();maxPitch=Math.max(maxPitch,a.pitch*180/Math.PI);minPitch=Math.min(minPitch,a.pitch*180/Math.PI);maxRoll=Math.max(maxRoll,Math.abs(a.roll*180/Math.PI));
  for(const n of s._nozzles)if(n.maxForce>0)maxRatio=Math.max(maxRatio,n.force/n.maxForce,n.command/n.maxForce);
  if(s._fault){fault=s._fault;break;}
  const intent=s.getPilotInputIntent?.()??null;
  traces.push(JSON.stringify({caseId:id,variant,step,input:command,position:v(s.body.position),velocity:v(s.body.velocity),quaternion:q(s.body.quaternion),omega:v(s.body.angularVelocity),desired:s._desiredWrench,achieved:s._achievedWrench,contacts:s._contactCount,pressureBar:s.pressureBar(),gasKg:s.gasMass,intent:intent?.controller??null}));
  if(step===heldSteps)hold={...physical(s),pitchDeg:a.pitch*180/Math.PI,rollDeg:a.roll*180/Math.PI,intent,reference:s.getReference(),desiredWrench:[...s._desiredWrench]};
 }
 const final=s.telemetry();results.push({id,variant,input,initial,hold,final:{...physical(s),pitchDeg:final.pitchDeg,rollDeg:final.rollDeg,mode:final.mode,stabilizationMode:final.stabilizationMode,intent:final.pilotIntent??null},maxPitchDeg:maxPitch,minPitchDeg:minPitch,maxRollDeg:maxRoll,maxActuatorRatio:maxRatio,fault,heldSeconds:heldSteps/HZ,releaseSeconds:releaseSteps/HZ});
}
const row=(id,variant='after')=>results.find(x=>x.id===id&&x.variant===variant);
check('Production W+E+1 mapping preserves all three normalized requests',JSON.stringify(row('air-g-on-we1').input)===JSON.stringify(driverAxes(new Set(['KeyW','KeyE','Digit1']),null))&&row('air-g-on-we1').input.pitch===1&&row('air-g-on-we1').input.throttle===1&&row('air-g-on-we1').input.lift===1);
check('Historical G pitch loss is reproduced through the actual solver',Math.abs(row('air-g-on-we1','before').hold.pitchDeg)<.5&&row('air-g-on-we1','before').hold.reference.manualRate.x===0);
check('Held G+W+E+1 now changes physical pitch without dropping translation/ascent',row('air-g-on-we1').hold.pitchDeg>8&&row('air-g-on-we1').hold.position[1]>20&&row('air-g-on-we1').hold.position[2]>-350&&row('air-g-on-we1').hold.intent.pitch.accepted);
check('G+W+E+2 independently requests the opposite physical pitch',row('air-g-on-we2').hold.pitchDeg< -8&&row('air-g-on-we2').hold.intent.pitch.requested===-1);
check('G remains armed during pitch override and returns to level after release',row('air-g-on-pitch').hold.intent.controller==='g-pitch-override'&&row('air-g-on-pitch').final.stabilizationMode==='level'&&Math.abs(row('air-g-on-pitch').final.pitchDeg)<1);
check('G-off pitch still holds the achieved attitude after release',row('air-g-off-pitch').hold.pitchDeg>8&&Math.abs(row('air-g-off-pitch').final.pitchDeg-row('air-g-off-pitch').hold.pitchDeg)<1);
check('Z/B keep their established G lateral-translation meaning, including simultaneous pitch',row('air-g-on-z').hold.intent.roll.meaning==='lateral-translation'&&row('air-g-on-we1z').hold.intent.roll.meaning==='lateral-translation'&&Math.abs(row('air-g-on-we1z').hold.rollDeg)<3&&row('air-g-on-we1z').hold.position[0]>.1);
for(const id of ['air-g-on-z','air-g-on-we'])check(id+' physical trajectory remains exactly the historical no-pitch path',JSON.stringify(row(id).hold.position)===JSON.stringify(row(id,'before').hold.position)&&JSON.stringify(row(id).hold.quaternion)===JSON.stringify(row(id,'before').hold.quaternion));
check('Grounded pitch without takeoff is explicitly reported instead of silently discarded',row('ground-g-on-pitch').hold.intent.pitch.reason==='takeoff-required'&&row('ground-g-on-pitch').final.mode==='drive');
check('Simultaneous grounded W+E+1 reaches the hover pitch control path',row('ground-g-on-we1').hold.intent.controller==='g-pitch-override'&&row('ground-g-on-we1').hold.intent.pitch.accepted&&row('ground-g-on-we1').maxPitchDeg>3);
check('Raw wrench mode accepts 1/2 pitch separately from W/S axial thrust',row('air-raw-pitch').hold.desiredWrench[3]===-12000&&row('air-raw-w').hold.desiredWrench[3]===0&&row('air-raw-w','before').hold.desiredWrench[3]===-12000);
check('Every solver case remains finite within the actual nozzle capacities',results.every(x=>!x.fault&&x.maxActuatorRatio<=1+1e-9));
const releaseChecks=[];
for(const kind of ['pilot','raw-valves','pose-hold','maneuver']){
 const s=fixture(RoadsterSim,{height:20,g:false});if(kind==='pose-hold')s.setStabilizationMode('hold');if(kind==='maneuver')s.startManeuver('roll');
 for(let i=0;i<24;i++)s._advance(dt,kind==='pilot'?{pitch:.5,lift:.4}:kind==='raw-valves'?{frontJets:.5}:{});
 const inputShape=Object.keys(s._lastInput).sort(),before=physical(s),savedHold=s._holdQuaternionTarget?{quaternion:q(s._holdQuaternionTarget),position:v(s._holdPositionTarget)}:null,savedManeuver=JSON.stringify(s._maneuver),receipt=s.releasePilotInput('fixture-blur');
 const after=physical(s),unchanged=JSON.stringify(before)===JSON.stringify(after),holdUnchanged=JSON.stringify(savedHold)===JSON.stringify(s._holdQuaternionTarget?{quaternion:q(s._holdQuaternionTarget),position:v(s._holdPositionTarget)}:null),maneuverUnchanged=savedManeuver===JSON.stringify(s._maneuver);
 const once=JSON.stringify(s.exportState());s.releasePilotInput('fixture-second-blur');const idempotent=once===JSON.stringify(s.exportState()),shapePreserved=JSON.stringify(Object.keys(s._lastInput).sort())===JSON.stringify(inputShape),axesCleared=Object.values(s._lastInput).every(v=>v===0||v===false);
 const r={kind,receipt,idempotent,shapePreserved,axesCleared,bodyAndActualForceUnchanged:unchanged,holdUnchanged,maneuverUnchanged,commands:s._nozzles.map(n=>n.command),manualRate:v(s._manualReferenceRate),input:s._lastInput};releaseChecks.push(r);
 check(kind+' input release changes no body state/current nozzle force and retains automatic references',unchanged&&holdUnchanged&&maneuverUnchanged&&axesCleared&&shapePreserved&&idempotent&&s._manualReferenceRate.lengthSquared()===0&&(kind!=='raw-valves'||s._nozzles.every(n=>n.command===0)));
}
{
 const s=fixture(RoadsterSim,{height:20,g:true});for(let i=0;i<24;i++)s._advance(dt,{pitch:.5,lift:.2});const before=physical(s);s.releasePilotInput('fixture-g-pitch-blur');
 check('Releasing G pitch clears the active override immediately without snapping the body',JSON.stringify(before)===JSON.stringify(physical(s))&&!s.getPilotInputIntent().gPitchOverride&&s.stabilizationMode==='level');
}
// Toggle G while a pitch request is already held: no permanent off switch or
// disappearing held request; the following release recovers using real torque.
{
 const s=fixture(RoadsterSim,{height:20,g:false});for(let i=0;i<24;i++)s._advance(dt,{pitch:.5});s.setAirStabilization(true);for(let i=0;i<36;i++)s._advance(dt,{pitch:.5});const during=s.telemetry();for(let i=0;i<360;i++)s._advance(dt,{});const final=s.telemetry();
 check('Toggling G during a held pitch request keeps that request live, then levels on release',during.pilotIntent.gPitchOverride&&during.pitchDeg>8&&Math.abs(final.pitchDeg)<1&&final.stabilizationMode==='level');
}
const traceData=gzipSync(Buffer.from(traces.join('\n')+'\n'),{level:9}),traceName=`pilot-input-recovery-${REPORT_VERSION}.ndjson.gz`;writeFileSync(new URL('../qa/'+traceName,import.meta.url),traceData);
const paths=['dist/physics.js','dist/controls.js','dist/pilot-input-intent.js'];
const report={schema:'roadster-pilot-input-recovery',version:1,createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:checks.every(x=>x.passed)?'passed':'failed',physicsHz:HZ,baseline:JSON.parse(readFileSync(new URL('./fixtures/pilot-input-3.14-before/provenance.json',import.meta.url),'utf8')),scope:'Actual fixed-step solver and production key-state mapping; no native keyboard, graphics, handling quality or real-vehicle claim. Baseline and candidate use the same current helper dependencies and isolated ground geometry.',sourceHashes:Object.fromEntries(paths.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))])),checks,cases:results,releaseChecks,trace:{file:traceName,frequencyHz:HZ,samples:traces.length,sha256:hash(traceData),compressedBytes:traceData.length},limits:['G retains Z/B lateral translation. Only 1/2 temporarily takes pitch control while G remains armed.','A controller acceptance indicator is not an achieved motion/available-thrust guarantee.','Ground pitch-only input does not invent wheel or jet authority; it reports the required takeoff/flight mode.']};
writeFileSync(new URL(`../qa/pilot-input-recovery-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
assert.ok(checks.every(x=>x.passed),checks.filter(x=>!x.passed).map(x=>x.name).join('\n'));
console.log(JSON.stringify({checks:checks.length,cases:results.length,samples:traces.length,beforePitch:row('air-g-on-we1','before').hold.pitchDeg,afterPitch:row('air-g-on-we1').hold.pitchDeg,traceBytes:traceData.length}));
