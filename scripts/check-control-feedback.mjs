import {RoadsterSim} from '../dist/physics.js';
import {RoadsterSim as V39} from '../qa/fixtures/baseline-3.9-x/physics.js';
import {flatDynamics,DT} from '../tests/dynamics-fixtures-3.11.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname,out=root+'qa/controls-3.21/';
const hashes=Object.fromEntries(['dist/physics.js','dist/physics-kernel-319.js','dist/resource-wheels.js','dist/vehicle-models.js','dist/pilot-input-intent.js','dist/controls.js','dist/semantic-input.js'].map(p=>[p,createHash('sha256').update(readFileSync(root+p)).digest('hex')]));
const x=[];
for(const [version,Sim]of [['3.9',V39],['3.21',RoadsterSim]]){
 const s=flatDynamics(Sim,{height:.62,params:{supplyMode:'bench',tankLitres:600}}),initial=s.telemetry();
 const accepted=s.startManeuver('roll');assert(accepted);let firstRotate=null,rotationEnd=null,complete=null,peak=initial.heightWorld,integrated=0,postMinContacts=4,maxRate=0,postCommandMax=0;
 for(let k=0;k<25/DT;k++){
  const prior=s._maneuver?.phase,t=s.advanceFixed({},DT),time=(k+1)*DT,w=s.body.quaternion.conjugate().vmult(s.body.angularVelocity);assert.equal(t.fault,null);
  peak=Math.max(peak,t.heightWorld);integrated+=w.z*DT*180/Math.PI;maxRate=Math.max(maxRate,Math.abs(w.z)*180/Math.PI);
  if(t.maneuver?.phase==='rotate'&&firstRotate===null)firstRotate=time;
  if(prior==='rotate'&&t.maneuver?.phase!=='rotate'&&rotationEnd===null)rotationEnd=time;
  if(!t.maneuver&&complete===null)complete=time;
  if(complete!==null){postMinContacts=Math.min(postMinContacts,t.contactCount);postCommandMax=Math.max(postCommandMax,t.controlOwnership?.commandForceN??0);if(time-complete>=5-1e-8)break;}
 }
 const t=s.telemetry();x.push({version,fixture:'matched flat ground, bench external supply, tank 600 L, no driver input after X',accepted,initialCgM:initial.heightWorld,peakCgM:peak,riseM:peak-initial.heightWorld,firstRotateS:firstRotate,rotationEndS:rotationEnd,rotationDurationS:rotationEnd-firstRotate,completionS:complete,peakRateDegS:maxRate,rollTravelDeg:integrated,postObservationS:s.simTime-initial.simTime-complete,postMinContacts,postCommandMax,final:{mode:t.mode,contacts:t.contactCount,rollDeg:t.rollDeg,pitchDeg:t.pitchDeg,heightM:t.heightWorld,thrustN:t.thrustN},scope:version==='3.9'?'Frozen historical solver in the same declared flat-ground fixture; not a reproduction of the historical browser session reported by the user.':'Current solver: four-wheel grounded completion plus 5 s observation.'});
}
const continuity=JSON.parse(readFileSync(root+'qa/control-continuity-3.21/report.json'));
const guards=JSON.parse(readFileSync(root+'qa/control-continuity-3.21/entry-guards-final.json'));
const pilot=JSON.parse(readFileSync(root+'qa/pilot-input-recovery-3.21.json'));
const result={schema:'roadster-user-feedback-numerical-review-3.21',createdAt:new Date().toISOString(),sourceHashes:hashes,checks:{continuity:continuity.checks.map(({name,passed})=>({name,passed})),transition:guards.checks.map(({name,passed})=>({name,passed})),pilotInput:pilot.checks.map(({name,passed})=>({name,passed}))},matchedX:x,movingX:continuity.runs.filter(r=>r.id.startsWith('X')).map(r=>({id:r.id,completionS:r.finished.elapsed,peakCgM:r.peakCgM,postObservationS:r.postFinishObservationS,postMinContacts:r.postMinContacts,postMaxCommandN:r.postCommandMax,finalContacts:r.final.contacts})),pilotCombinations:pilot.cases.filter(r=>r.variant==='after'&&r.id.includes('we1')).map(r=>({id:r.id,requested:r.input,heldSeconds:r.heldSeconds,holdPitchDeg:r.hold.pitchDeg,maxPitchDeg:r.maxPitchDeg,intent:r.hold.intent})),knownOpen:['Low-altitude manual pitch inversion is not certified by pitch-request acceptance; no claim that W+E+1 reproduces the automatic X roll (different axis).','No native physical keyboard rollover, rendered shadow, target GPU frame-time or human-feel acceptance.'],commands:['node tests/control-continuity-3.18.test.mjs','node tests/control-transition-guards-3.18.test.mjs','node tests/pilot-input-recovery-3.15.test.mjs','node scripts/check-control-feedback.mjs']};
mkdirSync(out,{recursive:true});writeFileSync(out+'summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(x,null,2));
