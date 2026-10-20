import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {ExperimentRecorder,executeExperiment,contentLabel} from '../dist/experiment-records.js';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {InputSession} from '../dist/input-session.js';
import {driverAxes} from '../dist/controls.js';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const checks=[],events=[],sim=new RoadsterSim(),keys=new Set(),session=new InputSession({keys,onRelease:r=>sim.releasePilotInput(r),onEvent:e=>events.push(e),capacity:40});
session.down({code:'KeyW'});session.down({code:'KeyE'});session.down({code:'Digit1'});session.down({code:'Digit1',repeat:true});assert.deepEqual([driverAxes(keys).throttle,driverAxes(keys).lift,driverAxes(keys).pitch],[1,1,1]);assert.ok(session.tracing);checks.push('W held, E + 1 and repeated keydown preserve simultaneous axes and trace the accepted browser event separately.');
for(let i=0;i<5;i++){const input=driverAxes(keys),t=sim.advanceFixed(input);session.step(t,input);}const before=sim.exportState(),forces=sim.telemetry().nozzles.map(n=>n.force);session.release('window-blur',{pause:true});assert.equal(keys.size,0);assert.deepEqual(sim.telemetry().nozzles.map(n=>n.force),forces);assert.deepEqual(sim.exportState().body,before.body);assert.equal(sim.telemetry().driverInput.throttle??0,0);checks.push('Window blur releases held inputs and command valves without teleporting or zeroing physical force.');
session.down({code:'KeyW'},false,'editing');assert.equal(keys.size,0);session.up({code:'KeyW'});assert.ok(session.export().events.some(e=>e.type==='keydown'&&!e.accepted&&e.reason==='editing'));checks.push('Rejected editing input and keyup remain distinguishable from missing hardware events.');
for(const reason of ['panel-open','context-switch','document-hidden','graphics-stopped','scenario-reset']){session.down({code:'KeyE'});session.release(reason);assert.equal(keys.size,0);assert.equal(sim.telemetry().driverInput.lift??0,0);}checks.push('Shared releases cover panel, scene, visibility, graphics and reset boundaries.');
for(let i=0;i<60;i++)session.note('fixture',{i});assert.equal(session.events.length,40);assert.ok(session.dropped>0);assert.doesNotThrow(()=>JSON.stringify(session.export()));checks.push('Bounded recent journal declares discarded older events; it does not claim an entire unbounded driving history.');
const source=readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');assert.ok(source.includes("inputSession.release('window-blur'"));assert.ok(source.includes("inputSession.release('document-hidden'"));assert.ok(source.includes("pendingProgramCapture?.reject?."));assert.ok(source.includes('lastTime=performance.now()'));checks.push('Main integration wires release and resets wall-clock baseline; context loss rejects pending capture and aborts matrix. Source integration only, not native focus/context-loss proof.');
// A pause/focus release changes the manual reference. It must be an ordered
// recorded command, not only a UI event, for a faithful fixed-input replay.
const recordedSim=new RoadsterSim({supplyMode:'bench'});recordedSim.reset('hover');recordedSim.setStabilizationMode('off');
const recorder=new ExperimentRecorder({getSim:()=>recordedSim,getContext:()=> 'city'});recorder.start({name:'Received input, focus release, resume fixture'});
for(let step=0;step<144;step++){
  if(step===36||step===96)recordedSim.releasePilotInput(step===36?'window-blur':'editing-focus');
  const input=step<36?{throttle:1,lift:1,pitch:1}:step<72?{}:step<96?{pitch:-.5}:{};
  recorder.beforeStep(input);recorder.afterStep(recordedSim.advanceFixed(input),input,1/120);
}
const releaseRecord=recorder.finish(),commands=releaseRecord.events.filter(e=>e.kind==='command'&&e.method==='releasePilotInput');
assert.deepEqual(commands.map(e=>[e.step,e.args[0]]),[[36,'window-blur'],[96,'editing-focus']]);
const replay=await executeExperiment(releaseRecord,{createSim:()=>new RoadsterSim({supplyMode:'bench'}),yieldEvery:0});
assert.equal(contentLabel(replay.finalSnapshot.physical),contentLabel(releaseRecord.finalSnapshot.physical));
checks.push('Focus/pause release is a recorded public command; export and complete fixed-input replay reproduce the full physical continuation exactly.');
const report={schema:'roadster-input-session-tests',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',checks,events,releaseReplay:{commands,initialStateLabel:releaseRecord.initialSnapshot.stateLabel,finalStateLabel:releaseRecord.finalSnapshot.stateLabel,matched:true},scope:'DOM-like received-event and actual-solver lifecycle test. Real hardware rollover, native focus and actual context loss remain separate acceptance.'};writeFileSync(new URL(`../qa/input-session-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');for(const c of checks)console.log('PASS: '+c);
