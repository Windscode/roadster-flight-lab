import assert from 'node:assert/strict';
import {RoadsterSim} from '../dist/physics.js';
import {ControlCaptureProtocol,CONTROL_CAPTURE_COLUMNS} from '../dist/driving-capture.js';
import {ExperimentRecorder,validateExperimentRecord} from '../dist/experiment-records.js';

function run(id){
  const sim=new RoadsterSim();
  // Isolated plane used only by this numerical protocol test; the live city
  // and its collision geometry are never changed by the application.
  for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
  sim.geometry=sim.geometry.filter(item=>item.id==='ground');sim.reset('free');
  for(let i=0;i<240;i++)sim.advanceFixed({});
  const records=[],recorder=new ExperimentRecorder({getSim:()=>sim,getContext:()=> 'city',getSceneConfiguration:()=>({numericalFixture:'isolated-plane'}),onFinish:r=>records.push(r)});
  const capture=new ControlCaptureProtocol({getSim:()=>sim,startRecording:o=>recorder.start(o),stopRecording:(reason,status)=>recorder.finish(status,reason),recordEvent:(...args)=>recorder.event(...args),getRecordingState:()=>recorder.getState(),getRecords:()=>records});
  capture.start(id);
  for(let i=0;i<7200&&capture.getState().active;i++){
    const input=recorder.beforeStep(capture.beforeStep(1/120,{})),t=sim.advanceFixed(input);
    recorder.afterStep(t,t.driverInput,1/120);capture.afterStep(t);
  }
  const result=capture.getResult();assert.ok(result);assert.equal(result.status,'completed',result.reason);validateExperimentRecord(result.record);
  assert.equal(result.metrics.measuredSteeringDurationS,4);
  const samples=result.samples.filter(s=>s.phase==='steer');assert.ok(samples.length>=80);
  assert.ok(samples.every(s=>s.wheels.length===4&&s.wheels.every(w=>w.length===CONTROL_CAPTURE_COLUMNS.wheels.length)));
  const load=CONTROL_CAPTURE_COLUMNS.wheels.indexOf('normalLoadN'),utilization=CONTROL_CAPTURE_COLUMNS.wheels.indexOf('frictionUtilization');
  assert.ok(samples.every(s=>s.wheels.every(w=>w[load]>0&&w[utilization]<=1.00001)));
  assert.ok(samples.every(s=>s.nozzles.every(n=>n.length===CONTROL_CAPTURE_COLUMNS.nozzles.length&&n[2]!==null)));
  return result;
}
for(const id of ['steer-10-gentle','steer-54-gentle','steer-90-gentle','steer-54-tap','steer-90-coast']){
  const result=run(id),start=result.phases.find(p=>p.phase==='steer').step;
  const inputs=result.record.inputRuns.flatMap(r=>Array.from({length:r.steps},()=>r.input)).slice(start,start+480);
  if(id.endsWith('gentle'))assert.ok(inputs.every(i=>i.steer===.2));
  if(id.endsWith('tap')){assert.equal(inputs.filter(i=>i.steer===1).length,18);assert.ok(inputs.slice(18).every(i=>(i.steer||0)===0));}
  if(id.endsWith('coast'))assert.ok(inputs.every(i=>(i.throttle||0)===0&&i.steer===.5));
  console.log(`PASS: ${id} retains declared command timing, stabilized speed, wheel-force tables and actual nozzle forces. Peak slip ${result.metrics.peakSlipDeg.toFixed(3)} deg.`);
}
