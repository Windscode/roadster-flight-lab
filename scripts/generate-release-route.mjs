// QA input generator, not a native keyboard or autonomous-driving claim.
// After the declared initial placement, only normal throttle/brake/steer inputs
// move the production vehicle. The saved journal is imported through the UI.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {RoadsterSim} from '../dist/physics.js';
import {roadWheelAngle,MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from './qa-report-version.mjs';
import {ExperimentRecorder,validateExperimentRecord} from '../dist/experiment-records.js';
const sim=new RoadsterSim({supplyMode:'bench'},{world:'city'}),dt=1/120;
sim.reset('city');sim.body.position.set(-200,.74,-390);sim.body.quaternion.set(0,0,0,1);
sim.body.previousPosition.copy(sim.body.position);sim.body.interpolatedPosition.copy(sim.body.position);
sim.body.previousQuaternion.copy(sim.body.quaternion);sim.body.interpolatedQuaternion.copy(sim.body.quaternion);sim.body.aabbNeedsUpdate=true;
for(let i=0;i<120;i++)sim.advanceFixed({brake:1},dt);sim.releasePilotInput('declared-benchmark-initial-state');
const points=[],line=(x,z,tx,tz)=>{const steps=Math.ceil(Math.hypot(tx-x,tz-z)/2);for(let i=0;i<steps;i++)points.push({x:x+(tx-x)*i/steps,z:z+(tz-z)*i/steps,speed:10});};
const arc=(f)=>{for(let i=0;i<10;i++)points.push({...f(i/10*Math.PI/2),speed:4.5});};
line(-200,-390,-200,-142.5);arc(a=>({x:-190-10*Math.cos(a),z:-142.5+10*Math.sin(a)}));
line(-190,-132.5,90,-132.5);arc(a=>({x:90+10*Math.sin(a),z:-142.5+10*Math.cos(a)}));
line(100,-142.5,100,-390);arc(a=>({x:90+10*Math.cos(a),z:-390-10*Math.sin(a)}));
line(90,-400,-190,-400);arc(a=>({x:-190-10*Math.sin(a),z:-390-10*Math.cos(a)}));
let index=0,loops=0,distance=0,maxLateral=0,hullContacts=0,minContacts=4,heldInput={};
const recorder=new ExperimentRecorder({getSim:()=>sim,getSceneConfiguration:()=>({version:3,context:'city',quality:'high',weatherPreset:'clear-day',camera:{mode:'chase'},autoExposure:true})});
recorder.start({name:`${REPORT_VERSION} QA · continuous Weave–Quay loop · 180 s`,kind:'release-route',lineage:{generator:'scripts/generate-release-route.mjs',method:'Pure pursuit fixed-step analog commands; no pose assignments after declared preparation. Dry physical road in both presentation comparisons.'}});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
for(let step=0;step<180/dt;step++){
  const p=sim.body.position;
  for(let guard=0;guard<20&&Math.hypot(p.x-points[index].x,p.z-points[index].z)<4;guard++){
    index++;if(index===points.length){index=0;loops++;recorder.event('route_loop',{loops});}
  }
  const target=points[index],speed=sim.body.velocity.length(),heading=sim._angles().heading,targetHeading=Math.atan2(target.x-p.x,target.z-p.z),error=Math.atan2(Math.sin(targetHeading-heading),Math.cos(targetHeading-heading));
  const speedGoal=Math.min(...Array.from({length:12},(_,j)=>points[(index+j)%points.length].speed));
  const maxAngle=roadWheelAngle(1,speed,sim.params,sim._surfaceMu({x:p.x,y:0,z:p.z}));
  // A fixed 20 Hz command source, held through the six real 120 Hz steps.
  // This bounds the import size without deleting or approximating replay inputs.
  if(step%6===0)heldInput={throttle:clamp((speedGoal-speed)*.3+.024,0,.55),brake:clamp((speed-speedGoal)*.25,0,.7),steer:clamp(Math.atan(2.84*2*Math.sin(error)/Math.max(2,Math.hypot(target.x-p.x,target.z-p.z)))/maxAngle,-1,1)};
  const input=heldInput;
  const before=p.clone();recorder.beforeStep(input);const t=sim.advanceFixed(input,dt);recorder.afterStep(t,t.driverInput,dt);
  assert.equal(t.fault,null);distance+=before.distanceTo(sim.body.position);minContacts=Math.min(minContacts,t.contactCount);
  maxLateral=Math.max(maxLateral,Math.min(...points.map(q=>Math.hypot(q.x-t.position.x,q.z-t.position.z))));
  hullContacts+=sim.getContactDiagnostics().filter(c=>c.vehicleShape<4).length;
}
const record=recorder.finish('completed','180 seconds of continuous production-physics loop inputs');validateExperimentRecord(record);
assert.ok(loops>=1,'Must complete the entire street loop');assert.equal(hullContacts,0);assert.ok(maxLateral<3);
mkdirSync('.runtime/release-route',{recursive:true});mkdirSync(`qa/browser-${REPORT_VERSION}`,{recursive:true});
const bytes=Buffer.from(JSON.stringify(record));writeFileSync('.runtime/release-route/route.json',bytes);writeFileSync(`qa/browser-${REPORT_VERSION}/route-record.json.gz`,gzipSync(bytes,{level:9}));
const summary={modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,durationS:record.durationS,steps:record.stepCount,loops,distanceM:distance,maxCentrelineErrorM:maxLateral,minContacts,hullContacts,storedSamples:record.samples.length,inputRuns:record.inputRuns.length,bytes:bytes.length,scope:'Numerical command generator on the complete retained Weave/Crosstown/Foundry/Canal loop. Browser replay/rendering acceptance is separate. No native driver or broader cross-district route claim.'};
writeFileSync(`qa/browser-${REPORT_VERSION}/route-generation.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
