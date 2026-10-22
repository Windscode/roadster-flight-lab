import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {InputSession} from '../dist/input-session.js';
import {RoadsterSim} from '../dist/physics.js';
import {driverAxes} from '../dist/controls.js';
import {motionDiagnostics,rememberValidStep,resetSafetyJournal} from '../dist/simulation-safety.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const checks=[],cases=[],trace=[],hash=x=>createHash('sha256').update(x).digest('hex');
const check=(name,pass,details={})=>{checks.push({name,passed:!!pass,...details});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
const clockDescriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=0;
try{
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
  const session=new InputSession({capacity:12}),detail={reason:'a mutable ingress object',payload:{n:1}};
  session.note('fixture',detail);const shallow=session.export({}, {clone:false});detail.payload.n=7;session.note('fixture',{payload:{n:2}});
  check('An asynchronous shallow export owns its event list and every retained event is an immutable value snapshot',shallow.events.length===1&&shallow.events[0].payload.n===1&&Object.isFrozen(shallow.events[0])&&Object.isFrozen(shallow.events[0].payload));
  assert.throws(()=>{shallow.events[0].payload.n=9;},TypeError);const deep=session.export();deep.events[0].payload.n=12;assert.equal(session.events[0].payload.n,1);
  session.action('roll',{accepted:true,reason:'accepted'});now=25000;
  check('A trace remains armed when wall time elapses before the first simulated step',session.tracing);
  session.step({simTime:1,physicalStep:120},{});now=50000;
  check('Slow rendering cannot end the trace before 20 seconds of actual simulation have elapsed',session.tracing);session.step({simTime:20.9,physicalStep:2508},{});assert.equal(session.tracing,true);session.step({simTime:21,physicalStep:2520},{});assert.equal(session.tracing,false);
  session.action('roll',{accepted:false,reason:'focus-is-in-editor'});const rejected=session.lastActionReceipt;session.release('scenario-reset');check('A rejected action retains its reason while reset ends only the active trace',rejected.reason==='focus-is-in-editor'&&!session.tracing&&session.lastActionReceipt===rejected);
  for(let i=0;i<30;i++)session.note('bounded',{i});check('The event cap remains explicit and reports dropped history',session.events.length===12&&session.dropped>0&&session.export().physicsTracePolicy.includes('12-event'));
}finally{Object.defineProperty(globalThis,'performance',clockDescriptor);}
{
  const sim=new RoadsterSim();sim.reset('free');resetSafetyJournal(sim);
  for(let i=1;i<=36;i++){sim.body.quaternion.setFromEuler(-i*Math.PI/18,0,0);sim.simTime=i/120;sim._stepCount=i;rememberValidStep(sim,1/120);}
  const travel=motionDiagnostics(sim);
  check('Actual quaternion increments retain a signed 360° pitch path through the Euler wrap',Math.abs(travel.pitchDeg-360)<1e-8&&Math.abs(travel.rollDeg)<1e-8&&Math.abs(sim._angles().pitch)<1e-8,{scope:'Diagnostic-only analytic pose sequence. It is not a physical maneuver.',travel});
}
function append(id,t,input){trace.push(JSON.stringify({id,physicalStep:t.physicalStep,simTime:t.simTime,input,position:t.position,velocity:t.velocity,quaternion:t.quaternion,angularVelocity:t.angularVelocity,euler:{pitch:t.pitchDeg,roll:t.rollDeg,yaw:t.headingDeg},attitudeTravel:t.attitudeTravel,contactCount:t.contactCount,rigidContactCount:t.maneuverFeedback?.lastRun?.rigidContactCount??null,controlAuthority:t.controlAuthority,levelRecovery:t.levelRecovery,pilotIntent:t.pilotIntent,maneuverFeedback:t.maneuverFeedback,pressureBar:t.pressureBar,integration:t.integration}));}
{
  const s=new RoadsterSim({supplyMode:'bench'});s.reset('city');s.setStabilizationMode('level');for(let i=0;i<180;i++)s.advanceFixed({brake:1});
  const start=s.telemetry(),session=new InputSession({onRelease:r=>s.releasePilotInput(r)});session.note('keydown',{code:'KeyX',accepted:true,repeat:false,reason:'action'});const accepted=s.startManeuver('roll');session.action('roll',{accepted,reason:s.status,telemetry:s.telemetry()});const profile={...s._maneuver.profile};let finished=null,peak=start.position.y;
  for(let i=0;i<120*12;i++){
    if(i===12)session.up({code:'KeyX'});const t=s.advanceFixed({});session.step(t,{});append('quick-x-city',t,{});peak=Math.max(peak,t.position.y);
    if(!t.maneuver&&t.maneuverFeedback.lastRun){finished=t;break;}
  }
  const run=finished?.maneuverFeedback.lastRun,row={id:'quick-x-city',scope:'The production action and actual solver with a 100 ms simulated key edge; native browser delivery is separately verified by the parent integration.',start,profile,peakCgHeightM:peak,final:finished,receipt:session.lastActionReceipt};cases.push(row);
  check('X release after 100 ms does not cancel the original quick, low maneuver',accepted===true&&profile.kind==='quick-roll-1'&&profile.durationS===1.5&&finished?.mode==='drive'&&run?.state==='completed'&&run.elapsedS<5&&peak<4.5&&Math.abs(run.actualRollTravelDeg)>350,row);
  check('The finished action remains inspectable after its live maneuver object disappears',run&&Math.abs(run.externalGasKg-(finished.externalGasSuppliedKg-start.externalGasSuppliedKg))<1e-7&&Math.abs(run.endedAtSimTimeS-finished.simTime)<1e-9,{run});
  s.body.quaternion.setFromEuler(.4,0,0);const pose=s.exportState().body,rejected=s.startManeuver('roll');
  check('A physical X preflight refusal gives a persistent explicit reason without changing body state',rejected===false&&s.telemetry().maneuverFeedback.lastAction.accepted===false&&s.telemetry().maneuverFeedback.lastAction.reason.includes('10°')&&JSON.stringify(s.exportState().body)===JSON.stringify(pose));
}
for(const height of [60,120])for(const g of [true,false]){
  const heldSeconds=height===60?6:6.5,heldSteps=Math.round(heldSeconds*120),steps=heldSteps+720;
  const s=new RoadsterSim({supplyMode:'bench'});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.geometry=s.geometry.filter(g=>g.id==='ground');s.reset('hover');s.body.position.set(0,height,-350);s.setStabilizationMode(g?'level':'off');
  const input=driverAxes(new Set(['KeyW','KeyE','Digit1'])),initial=s.exportState();let hold=null,minHeight=s.body.position.y,contactSteps=0,heldContactSteps=0,limitedSteps=0,firstFullTurn=null;
  for(let i=0;i<steps;i++){const command=i<heldSteps?input:{},t=s.advanceFixed(command);append(`we1-${g?'g-on':'g-off'}-declared-${height}m-start`,t,command);minHeight=Math.min(minHeight,t.position.y);const contact=t.contactCount>0||s.getContactDiagnostics().length>0;contactSteps+=Number(contact);heldContactSteps+=Number(contact&&i<heldSteps);limitedSteps+=!t.controlAuthority.currentPoseTrimFeasible||t.controlAuthority.saturatedNozzles.length?1:0;if(!firstFullTurn&&t.attitudeTravel.pitchDeg>=360)firstFullTurn={timeS:(i+1)/120,heightM:t.position.y,precedingContactSteps:heldContactSteps};if(i===heldSteps-1)hold=t;}
  const final=s.telemetry(),row={id:`we1-${g?'g-on':'g-off'}-declared-${height}m-start`,initialSnapshot:initial,heldSeconds,releaseSeconds:6,minimumCgHeightM:minHeight,contactSteps,heldContactSteps,firstFullTurn,limitedSteps,hold,final,airborneFullTurnWithoutContact:!!firstFullTurn&&heldContactSteps===0&&contactSteps===0,scope:height===60?'Retained insufficient-clearance counterexample: contact occurred despite a high start; its cumulative turn must not be called a clean maneuver.':'Declared high-start numerical reference for continuous pitch and G release; no claim that ground-start or finite-gas keys safely complete a backflip.'};cases.push(row);
  if(height===60)continue;
  check(`Held W+E+1 records actual continuous pitch beyond 360° with G ${g?'on':'off'} in the declared 120 m fixture`,hold.attitudeTravel.pitchDeg>360&&hold.pilotIntent.pitch.accepted&&hold.pilotIntent.requested.throttle===1&&hold.pilotIntent.requested.lift===1&&contactSteps===0,{travel:hold.attitudeTravel,minimumCgHeightM:minHeight,contactSteps,limitedSteps,firstFullTurn});
  if(g)check('G release physically returns level in the declared 120 m bench fixture without contact',Math.abs(final.pitchDeg)<1&&Math.abs(final.rollDeg)<1&&final.levelRecovery.status==='level'&&final.angularVelocity&&Math.hypot(final.angularVelocity.x,final.angularVelocity.y,final.angularVelocity.z)<.05,{finalPitch:final.pitchDeg,finalRoll:final.rollDeg,travel:final.attitudeTravel});
  else check('G-off release holds its attained pitch instead of pretending to be level',Math.abs(final.pitchDeg-hold.pitchDeg)<1&&Math.abs(final.pitchDeg)>3,{heldPitch:hold.pitchDeg,finalPitch:final.pitchDeg});
}
check('The report separates contact-assisted travel from a continuous airborne turn',cases.filter(c=>c.id.startsWith('we1')).every(c=>c.airborneFullTurnWithoutContact===(!!c.firstFullTurn&&c.contactSteps===0&&c.heldContactSteps===0)),{counterexamples:cases.filter(c=>c.id.includes('60m')).map(c=>({id:c.id,contactSteps:c.contactSteps,heldContactSteps:c.heldContactSteps,verdict:c.airborneFullTurnWithoutContact}))});
const bytes=gzipSync(Buffer.from(trace.join('\n')+'\n'),{level:9}),traceName=`input-action-evidence-${REPORT_VERSION}.ndjson.gz`;writeFileSync(new URL('../qa/'+traceName,import.meta.url),bytes);
const sources=['dist/input-session.js','dist/simulation-safety.js','dist/physics.js','dist/simulation-snapshot.js'];
const report={schema:'roadster-input-action-and-actual-attitude-evidence',version:1,createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:checks.every(c=>c.passed)?'passed':'failed',checks,cases,sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))])),trace:{file:traceName,bytes:bytes.length,samples:trace.length,sha256:hash(bytes)},limits:['Received/simulated event tests and actual numerical solver traces do not replace native browser keyboard delivery or rendered video.','A signed body-axis path is not an Euler angle and is not by itself proof of a clean isolated backflip. The raw actual quaternions, contacts and axis travel are retained.','The 60 m WE1 fixture touches ground and remains a counterexample. The no-contact reference starts at 120 m with constant external supply, and loses substantial height while inverted. Neither finite-gas success nor low-altitude ground-start recovery is inferred.','The 2400-event production rolling capacity can discard the start of a long capture. Discard count and capacity remain explicit even when the wall/simulation time trace window is extended.']};writeFileSync(new URL(`../qa/input-action-evidence-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
