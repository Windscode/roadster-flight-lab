import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

// Two concrete transition counterexamples found during independent review.
// Inputs run continuously after the declared flat-ground initialization.
// This is numerical API evidence, not a claim about native keyboard delivery.
const dt=1/120,label=process.env.CONTROL_GUARD_LABEL||'final',out=`qa/control-continuity-${REPORT_VERSION}`,rows=[],checks=[],cases=[];
assert.match(label,/^[a-z0-9-]+$/);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const physical=s=>JSON.stringify([s.body.position,s.body.velocity,s.body.quaternion,s.body.angularVelocity,s.gasMass,s._nozzles]);
function fixture(){
 const s=new RoadsterSim({supplyMode:'bench'});
 for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);
 s.geometry=s.geometry.filter(g=>g.id==='ground');s.body.position.set(0,.62,0);
 for(let i=0;i<240;i++)s.advanceFixed({},dt);
 return s;
}
function step(s,id,phase,input={}){
 const t=s.advanceFixed(input,dt);
 rows.push(JSON.stringify({id,phase,simTime:t.simTime,input,mode:t.mode,position:t.position,velocity:t.velocity,quaternion:t.quaternion,angularVelocity:t.angularVelocity,reference:t.reference,ownership:t.controlOwnership,maneuver:t.maneuver,feedback:t.maneuverFeedback,contacts:t.contactCount,wheels:t.wheelStates.map(w=>({id:w.id,contact:w.contact,loadN:w.normalLoadN,lengthM:w.suspensionLength})),landingConfirmationS:s._landingContactTime,manualTranslationActive:s._manualTranslationActive,desiredWrench:t.desiredWrench,actualThrustN:t.thrustN,fault:t.fault}));
 return t;
}
function advance(s,id,phase,input,steps){for(let i=0;i<steps;i++)step(s,id,phase,input);}
function check(name,ok,detail){checks.push({name,passed:!!ok,...detail});console.log(`${ok?'PASS':'FAIL'} ${name}`);}

for(const entry of ['H','E']){
 const id=`moving-${entry}-entry`,s=fixture();s.setMode('hover');advance(s,id,'explicit-H-takeoff',{},720);advance(s,id,'W-translation',{throttle:1},480);
 s.setMode('drive');advance(s,id,'explicit-DRIVE-coast',{},12);
 const atEntry=s.telemetry(),bodyBefore=physical(s);
 if(entry==='H')s.setMode('hover');else step(s,id,'E-requests-flight',{lift:1});
 const bodyUnchangedAtH=entry!=='H'||physical(s)===bodyBefore,initialOwner=s.getControlOwnership();
 let minVz=Infinity,holdCapture=null,maxReferenceZ=s._positionTarget.z;
 for(let i=0;i<1440;i++){
  const t=step(s,id,'released-input-braking',{});minVz=Math.min(minVz,t.velocity.z);maxReferenceZ=Math.max(maxReferenceZ,t.reference.position.z);
  if(!s._manualTranslationActive&&holdCapture===null)holdCapture={timeS:t.simTime,z:t.position.z,targetZ:t.reference.position.z,speedMps:Math.hypot(t.velocity.x,t.velocity.z)};
 }
 const final=s.telemetry(),result={id,atEntry:{timeS:atEntry.simTime,position:atEntry.position,velocity:atEntry.velocity},bodyUnchangedAtH,initialOwner,holdCapture,maxReferenceZ,minVz,final:{position:final.position,velocity:final.velocity,reference:final.reference,ownership:final.controlOwnership,fault:final.fault}};cases.push(result);
 check(`${entry} entered while coasting brakes then captures its reached point`,atEntry.velocity.z>8&&bodyUnchangedAtH&&initialOwner.positionPolicy==='pilot-or-release-braking'&&holdCapture?.speedMps<.08&&holdCapture.z>atEntry.position.z+2&&Math.abs(final.position.z-holdCapture.targetZ)<.12&&minVz>-.04&&!final.fault,{id});
}

for(const name of ['roll','pitch']){
 const id=`Q-held-before-${name}`,s=fixture();advance(s,id,'Q-held-before-action',{lift:-1},60);
 const bodyBefore=physical(s),accepted=s.startManeuver(name),bodyUnchanged=physical(s)===bodyBefore,start=s.simTime,initial=s.exportState();
 let completed=null,minUp=1,maxConfirmationS=0,postMinContacts=4,postMaxCommand=0,postAllDrive=true;
 for(let i=0;i<1800;i++){
  maxConfirmationS=Math.max(maxConfirmationS,s._landingContactTime);
  const t=step(s,id,'Q-remains-held-through-action',{lift:-1});
  minUp=Math.min(minUp,1-2*(t.quaternion.x**2+t.quaternion.z**2));
  if(!s._maneuver&&completed===null)completed={elapsedS:s.simTime-start,feedback:t.maneuverFeedback.lastRun,contacts:t.contactCount,wheelLoads:t.wheelStates.map(w=>w.normalLoadN),weightN:t.mass*s.params.gravity};
  if(completed){postMinContacts=Math.min(postMinContacts,t.contactCount);postMaxCommand=Math.max(postMaxCommand,t.controlOwnership.commandForceN);postAllDrive&&=t.mode==='drive';}
  if(completed&&s.simTime-start-completed.elapsedS>=5)break;
 }
 const final=s.telemetry(),postS=completed?s.simTime-start-completed.elapsedS:0,result={id,accepted,bodyUnchanged,initial,completed,minUp,maxConfirmationS,postS,postMinContacts,postMaxCommand,postAllDrive,final:{position:final.position,velocity:final.velocity,mode:final.mode,contacts:final.contactCount,fault:final.fault}};cases.push(result);
 const travel=completed?.feedback?.[name==='roll'?'actualRollTravelDeg':'actualPitchTravelDeg'];
 check(`Pre-held Q cannot complete ${name} before its actual turn and four-wheel dwell`,accepted&&bodyUnchanged&&completed?.feedback.state==='completed'&&Math.abs(travel)>=355&&minUp<-.95&&maxConfirmationS>=.19&&completed.contacts===4&&completed.wheelLoads.every(load=>load>completed.weightN*.01)&&postS>=5-1e-8&&postMinContacts===4&&postMaxCommand===0&&postAllDrive&&!final.fault,{id});
}

for(const stabilization of ['hold','level']){
 const id=`${stabilization}-to-explicit-DRIVE`,s=fixture();s.setMode('hover');advance(s,id,'explicit-H-takeoff',{},720);s.setStabilizationMode(stabilization);advance(s,id,'explicit-stabilization',{},24);
 const before=physical(s);s.setMode('drive');const unchanged=physical(s)===before,afterMode=s.stabilizationMode;
 let maxCommand=0,allDrive=true,tail=false;
 for(let i=0;i<60;i++){const t=step(s,id,'H-selects-DRIVE',{});maxCommand=Math.max(maxCommand,t.controlOwnership.commandForceN);allDrive&&=t.mode==='drive';tail||=t.controlOwnership.valveResidualOnly;}
 const ownership=s.getControlOwnership();cases.push({id,unchanged,afterMode,maxCommand,allDrive,tail,ownership});
 if(stabilization==='hold')check('Leaving explicit pose hold for DRIVE does not arm an unrequested G controller',unchanged&&afterMode==='off'&&maxCommand===0&&allDrive&&tail&&ownership.owner==='driver',{id});
 else check('Explicitly enabled G retains its independent level ownership across the mode change',unchanged&&afterMode==='level'&&maxCommand>1000&&allDrive&&ownership.owner==='g-level-height',{id});
}

for(const action of ['suction','reset'])for(const stabilization of ['hold','level']){
 const id=`${stabilization}-exit-through-${action}`,s=fixture();s.setMode('hover');advance(s,id,'explicit-H-takeoff',{},720);s.setMode('drive');s.setStabilizationMode(stabilization);
 const before=physical(s);if(action==='suction')s.setSuction(true);else s.reset('free');
 const physicalMutationPolicySatisfied=action==='reset'||physical(s)===before,after=s.telemetry();let maxCommand=0;
 for(let i=0;i<30;i++){const t=step(s,id,'after-explicit-command',{});maxCommand=Math.max(maxCommand,t.controlOwnership.commandForceN);}
 cases.push({id,physicalMutationPolicySatisfied,afterMode:after.stabilizationMode,afterAirStabilization:after.airStabilization,maxCommand,ownership:s.getControlOwnership(),scope:action==='reset'?'Reset deliberately establishes its declared scenario state and clears stale hold references.':'Suction selection changes controller references without changing physical pose, velocity or current valve force.'});
 check(`${action} exits hold without arming G and preserves a previously explicit level request (${stabilization})`,physicalMutationPolicySatisfied&&after.stabilizationMode===(stabilization==='hold'?'off':'level')&&after.airStabilization===(stabilization==='level')&&after.holdPositionTarget===null&&(stabilization==='level'||maxCommand===0),{id});
}

mkdirSync(out,{recursive:true});
const trace=gzipSync(Buffer.from(rows.join('\n')+'\n'),{level:9}),traceFile=`entry-guards-${label}.ndjson.gz`;
writeFileSync(`${out}/${traceFile}`,trace);
const report={schema:'roadster-control-transition-guards-318',generatedAt:new Date().toISOString(),label,modelBuildId:MODEL_BUILD_ID,actualSourceSha256:sha(readFileSync('dist/physics.js')),status:checks.every(c=>c.passed)?'passed':'failed',checks,cases,trace:{file:traceFile,bytes:trace.length,sha256:sha(trace)},scope:'Actual solver and continuous mode/input transitions in a declared flat-ground bench-supply fixture. No per-step body mutation. Entry speed is attained by prior W input. Pre-held Q remains in every step through the actual action and five-second post-completion observation; this is not native browser input evidence.'};
writeFileSync(`${out}/entry-guards-${label}.json`,JSON.stringify(report,null,2)+'\n');
assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
