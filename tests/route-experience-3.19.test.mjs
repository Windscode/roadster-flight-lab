import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {RoadsterSim} from '../dist/physics.js';
import {createRouteExperience} from '../dist/route-experience.js';
import {createRouteSurfacePreset,routeSurfaceProgress} from '../dist/route-surface.js';
import {createExperimentConsole} from '../dist/experiment-console.js';
import {contentLabel,currentExperimentIdentity,normalizeRecordedInput,exportExperimentArchive} from '../dist/experiment-records.js';
import {setLanguage} from '../dist/i18n.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||process.env.JSDOM_MODULE_PATH||'jsdom');
const DT=1/120,output=`qa/route-experience-${REPORT_VERSION}`,fixturePath='qa/surface-route-3.19/route-drive.json';
mkdirSync(output,{recursive:true});
const bytes=readFileSync(fixturePath),fixture=JSON.parse(bytes),sha=b=>createHash('sha256').update(b).digest('hex');
const sourcePaths=['dist/route-experience.js','dist/route-surface.js','dist/experiment-console.js','dist/experiment-records.js','dist/physics.js','tests/route-experience-3.19.test.mjs'];
const hashes=()=>Object.fromEntries(sourcePaths.map(path=>[path,sha(readFileSync(path))]));
const report={schema:'roadster-route-experience-ui-3.19',identity:currentExperimentIdentity(),startedAt:new Date().toISOString(),status:'running',environment:'JSDOM, actual route UI, RoadsterSim and archive console/ExperimentRecorder with an explicit host adapter. No main.js DOM integration, native keyboard, rendered pixels, audible device or GPU acceptance.',inputFixture:{path:fixturePath,sha256:sha(bytes),modelVersion:fixture.modelVersion,modelBuildId:fixture.modelBuildId,scope:'The existing numerical driver input sequences are applied to the current model after the host 0.5 s preparation. This is not a claim that a historical solver or its exact recorded initial snapshot was replayed.'},sourceHashesAtStart:hashes(),checks:[],continuousRuns:[],limits:['Completion boundary cases use labelled read-only telemetry fixtures derived from a real terminal state. They test UI classification and are not physical trajectory claims.','The harness owns only an in-memory archive. Only the two actual continuous integrations are exported as experiment records.','Current main.js environment/map restoration and actual browser operation need their separate integration checks.']};
const realRecords=[];let realTerminal=null;
const persist=()=>writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');
async function check(name,fn){try{const detail=await fn();report.checks.push({name,status:'passed',detail});console.log('PASS: '+name);}catch(error){report.checks.push({name,status:'failed',error:{message:error.message,stack:error.stack}});console.error('FAIL: '+name+' — '+error.message);}persist();}

function harness(){
  const dom=new JSDOM('<main><div id="route"></div><div id="hud"></div><div id="archive"></div></main>',{url:'https://route-ui.fixture.invalid/'}),doc=dom.window.document;
  const oldDocument=globalThis.document;globalThis.document=doc;
  dom.window.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const sim=new RoadsterSim();let paused=true,mode='live',starts=0,preparations=0,finishes=[],inspected=[],notices=[];
  const presentation=()=>({version:3,context:'city',routeSurface:sim.getRouteSurface(),routeId:sim.getRouteSurface()?.descriptor.id??null,weatherPreset:'clear-day'});
  const experiments=createExperimentConsole({mount:doc.getElementById('archive'),getSim:()=>sim,getContext:()=> 'city',getSceneConfiguration:presentation,storage,onStart:()=>{paused=false;}});
  const ui=createRouteExperience({mount:doc.getElementById('route'),hudMount:doc.getElementById('hud'),getSim:()=>sim,getContext:()=> 'city',getPaused:()=>paused,getSessionMode:()=>mode,getRecording:experiments.getState,
    onPrepare:preset=>{
      assert.equal(paused,true,'host requires paused preparation');assert.equal(mode,'live','host forbids changing a review/practice scene');preparations++;
      const descriptor=createRouteSurfacePreset(preset==='dry-day'?'dry-day':'after-rain'),p=descriptor.route.start;
      sim.reset('city');sim.setRoadSurface('dry');assert.equal(sim.setRouteSurface(descriptor,{phase:'preparation'}),true);
      sim.body.position.set(p.x,p.y,p.z);sim.body.quaternion.setFromEuler(0,p.yaw,0);sim.body.previousPosition.copy(sim.body.position);sim.body.interpolatedPosition.copy(sim.body.position);sim.body.previousQuaternion.copy(sim.body.quaternion);sim.body.interpolatedQuaternion.copy(sim.body.quaternion);sim.body.aabbNeedsUpdate=true;
      for(let i=0;i<60;i++)sim.advanceFixed({brake:1},DT);sim.releasePilotInput('route-preparation');paused=true;return{descriptor};
    },
    onStart:descriptor=>{starts++;const state=experiments.startRecording({name:descriptor.label+' / UI continuous route'});experiments.recordEvent('surface_route_start',{surface:sim.getRouteSurface(),scene:presentation()});return state;},
    onFinish:reason=>{finishes.push(reason);return experiments.stopRecording(reason,reason==='route-completed'?'completed':'cancelled');},
    onInspect:id=>{inspected.push(id);assert.equal(experiments.selectRecord(id),true);},onOpen:()=>{},onSound:()=>{},onHead:()=>{},recordEvent:experiments.recordEvent,notify:message=>notices.push(message)});
  const action=name=>doc.querySelector('[data-route-action="'+name+'"]');
  async function click(name){action(name).click();await Promise.resolve();await Promise.resolve();ui.update();}
  async function prepare(preset='dry-day'){paused=true;doc.querySelector('[data-route="condition"]').value=preset;ui.update();assert.equal(action('prepare').disabled,false);await click('prepare');assert.equal(ui.getState().prepared,true);assert.equal(paused,true);}
  function step(input){const applied=experiments.beforeStep(input),t=sim.advanceFixed(applied,DT);experiments.afterStep(t,applied,DT);ui.afterStep(t,DT);return t;}
  return{dom,doc,sim,ui,experiments,action,click,prepare,step,finishes,inspected,notices,get starts(){return starts;},get preparations(){return preparations;},setPaused(value){paused=value;ui.update();},setMode(value){mode=value;ui.update();},dispose(){ui.dispose();experiments.dispose();globalThis.document=oldDocument;dom.window.close();}};
}
function appendInput(runs,input){const value=normalizeRecordedInput(input),last=runs.at(-1);if(last&&JSON.stringify(last.input)===JSON.stringify(value))last.steps++;else runs.push({steps:1,input:value});}

await check('Both declared route input sequences create complete current-model records with ordered checkpoints and per-wheel surface events',async()=>{
  for(const source of fixture.runs){
    const h=harness();try{
      await h.prepare(source.preset);await h.click('start');const startId=h.ui.getState().recordId;assert.ok(startId);assert.equal(h.experiments.getState().id,startId);
      const expectedInputs=[],visited=new Set();let completedStep=null,terminal=null,step=0;
      for(const block of source.inputRuns)for(let i=0;i<block.steps;i++){
        const recording=h.experiments.getState().recording;if(recording)appendInput(expectedInputs,block.input);
        const t=h.step(block.input);step++;assert.equal(t.fault,null);assert.equal(t.contactCount,4);assert.equal(t.rigidContactCount,0);
        for(const wheel of t.wheelStates)if(wheel.contact)visited.add(wheel.surfaceId);
        if(completedStep===null&&h.ui.getState().run?.finished){completedStep=step;terminal=structuredClone(t);}
        if(step%30===0)h.ui.update();
      }
      h.ui.update();const result=h.ui.getState().lastResult,record=h.experiments.getRecords().find(r=>r.id===startId);
      assert.equal(result.reason,'route-completed');assert.equal(record.status,'completed');assert.equal(record.reason,'route-completed');assert.equal(record.id,result.recordId);assert.equal(record.stepCount,completedStep);assert.deepEqual(record.inputRuns,expectedInputs);assert.equal(h.finishes.length,1);
      const checkpoints=record.events.filter(e=>e.type==='route_checkpoint');assert.deepEqual(checkpoints.map(e=>e.detail.checkpoint),[0,1,2,3]);assert.ok(checkpoints.every((e,i)=>!i||e.step>checkpoints[i-1].step));
      assert.ok(record.events.every((e,i)=>e.step<=record.stepCount&&(!i||e.step>=record.events[i-1].step)));
      const surfaces=record.events.filter(e=>e.type==='route_wheel_surface');assert.ok(surfaces.length>8);assert.ok(surfaces.every(e=>e.detail.descriptorHash===result.descriptorHash&&e.detail.regions.length===4));
      for(const region of source.visitedRegions)assert.ok(visited.has(region),'missing region '+region);
      assert.equal(terminal.contactCount,4);assert.ok(Math.hypot(terminal.velocity.x,terminal.velocity.z)<.45);assert.ok(Math.abs(terminal.rollDeg)<5&&Math.abs(terminal.pitchDeg)<5);assert.ok(routeSurfaceProgress(h.sim.getRouteSurface().descriptor,terminal.position).distanceM>295);
      const starts=h.starts;h.setPaused(true);assert.equal(h.action('start').disabled,true);await h.click('start');assert.equal(h.starts,starts);assert.equal(h.experiments.getRecords().length,1,'a terminal re-click cannot manufacture another completed route');
      // An unrelated subsequent record must not change where the route's
      // inspect action leads. This checks the real archive selection API.
      h.experiments.startRecording({name:'unrelated selection fixture'});h.experiments.stopRecording('fixture','cancelled');assert.notEqual(h.experiments.getState().selectedId,startId);
      await h.click('inspect');assert.equal(h.inspected.at(-1),startId);assert.equal(h.experiments.getState().selectedId,startId);
      realRecords.push(record);realTerminal??=terminal;
      report.continuousRuns.push({preset:source.preset,recordId:startId,inputStepsApplied:step,recordedSteps:record.stepCount,descriptorHash:result.descriptorHash,checkpointSteps:checkpoints.map(e=>({checkpoint:e.detail.checkpoint,step:e.step})),surfaceEventCount:surfaces.length,visitedRegions:[...visited],finishPosition:terminal.position,finishSpeedMps:Math.hypot(terminal.velocity.x,terminal.velocity.z),finishContacts:terminal.contactCount,finishTiltDeg:{roll:terminal.rollDeg,pitch:terminal.pitchDeg},inspectSelectedId:h.experiments.getState().selectedId});
    }finally{h.dispose();}
  }
  return{actualIntegrations:report.continuousRuns.length,scope:'Actual fixed-step inputs, route UI lifecycle and archive records; not native keyboard operation.'};
});

await check('Moving away from a prepared start cannot begin a route record, and review/practice actions cannot reset or start the live car',async()=>{
  const h=harness();try{
    await h.prepare();const expected=h.sim.body.position.z;
    // Real integration moves away from the origin before any route recording.
    for(let i=0;i<240;i++)h.sim.advanceFixed({throttle:.3},DT);assert.ok(h.sim.body.position.z-expected>3);
    h.setPaused(true);await h.click('start');assert.equal(h.starts,0);assert.equal(h.ui.getState().run,null);assert.equal(h.experiments.getState().recording,false);
    await h.prepare();const initial=contentLabel(h.sim.exportState()),preparations=h.preparations;
    for(const mode of ['review','practice']){h.setMode(mode);assert.equal(h.action('prepare').disabled,true);assert.equal(h.action('start').disabled,true);await h.click('prepare');await h.click('start');assert.equal(h.preparations,preparations);assert.equal(h.starts,0);assert.equal(contentLabel(h.sim.exportState()),initial);}
    return{rejectedAfterActualDriving:true,protectedSessionModes:['review','practice'],physicalStateUnchangedByDisabledActions:true};
  }finally{h.dispose();}
});

function telemetryFixture(h,changes={}){
  assert.ok(realTerminal,'actual continuous integration must provide the terminal fixture');
  return {...structuredClone(realTerminal),simTime:h.sim.simTime,...changes};
}
function orderedSignals(h){for(const z of [-380,-300,-180,-140])h.ui.afterStep(telemetryFixture(h,{position:{x:-200,y:.597,z}}),DT);}
await check('Read-only completion fixtures require ordered route progress, four wheels, low linear/angular speed, limited tilt and a continuous half-second stop',async()=>{
  const h=harness();try{
    await h.prepare();await h.click('start');const valid=telemetryFixture(h);
    for(let i=0;i<120;i++)h.ui.afterStep(valid,DT);assert.equal(h.ui.getState().run.finished,false,'appearing at the finish cannot replace traversing checkpoints');
    orderedSignals(h);
    const missingWheel=structuredClone(valid.wheelStates);missingWheel[0].contact=false;
    const invalid=[['three-wheel support',{contactCount:3,wheelStates:missingWheel}],['roll',{rollDeg:6}],['pitch',{pitchDeg:6}],['vertical motion',{velocity:{...valid.velocity,y:.3}}],['angular motion',{angularVelocity:{x:.3,y:0,z:0}}],['horizontal motion',{velocity:{x:.6,y:0,z:0}}]];
    for(const [label,change]of invalid){for(let i=0;i<90;i++)h.ui.afterStep(telemetryFixture(h,change),DT);assert.equal(h.ui.getState().run.finished,false,label+' must not complete the route');}
    for(let i=0;i<59;i++)h.ui.afterStep(valid,DT);assert.equal(h.ui.getState().run.finished,false,'less than half a second cannot complete');
    h.ui.afterStep(valid,DT);assert.equal(h.ui.getState().lastResult.reason,'route-completed');assert.equal(h.finishes.length,1);
    return{scope:'UI decision boundary fixtures, not additional physical trajectories',rejectedConditions:invalid.map(([label])=>label),orderedCheckpointsRequired:true,continuousStopSeconds:.5};
  }finally{h.dispose();}
});

await check('An external recording stop is respected by the next fixed step before any display refresh; the original record remains inspectable',async()=>{
  const h=harness();try{
    await h.prepare();await h.click('start');h.step({brake:1});const id=h.ui.getState().recordId;orderedSignals(h);const valid=telemetryFixture(h);
    for(let i=0;i<59;i++)h.ui.afterStep(valid,DT);const external=h.experiments.stopRecording('external-panel-stop','cancelled');assert.equal(external.id,id);
    // The browser can execute another physics step before the next UI paint.
    h.ui.afterStep(valid,DT);assert.equal(h.finishes.length,0,'route must not complete an externally stopped recording');h.ui.update();assert.equal(h.ui.getState().lastResult.reason,'recording-ended-externally');
    for(let i=0;i<120;i++)h.ui.afterStep(valid,DT);assert.equal(h.finishes.length,0);assert.equal(h.experiments.getRecords().find(r=>r.id===id).status,'cancelled');
    await h.click('inspect');assert.equal(h.inspected.at(-1),id);assert.equal(h.experiments.getState().selectedId,id);
    return{scope:'Actual recorder interruption plus a read-only terminal telemetry boundary fixture',externalRecordId:id,retainedStatus:'cancelled',falseCompletionCount:h.finishes.length};
  }finally{h.dispose();}
});

await check('Cancelling route guidance keeps it hidden on subsequent updates while retaining the explicitly prepared physical surface',async()=>{
  const h=harness();try{
    await h.prepare('after-rain');const surface=h.sim.getRouteSurface(),physical=contentLabel(h.sim.exportState());h.ui.cancel('city-challenge-start');h.ui.update();
    assert.equal(h.doc.querySelector('.route-driving-card').hidden,true);assert.equal(h.ui.getState().prepared,false);assert.deepEqual(h.sim.getRouteSurface(),surface);assert.equal(contentLabel(h.sim.exportState()),physical);
    return{physicalSurfacePreserved:true,cancelledGuideRemainsHidden:true};
  }finally{h.dispose();}
});

setLanguage('zh',{persist:false});
if(realRecords.length){const archive=gzipSync(Buffer.from(JSON.stringify(exportExperimentArchive(realRecords))),{level:6});writeFileSync(`${output}/continuous-route-records.json.gz`,archive);report.records={path:`${output}/continuous-route-records.json.gz`,count:realRecords.length,bytes:archive.length,sha256:sha(archive)};}
report.sourceHashesAtEnd=hashes();report.sourceStableDuringRun=JSON.stringify(report.sourceHashesAtStart)===JSON.stringify(report.sourceHashesAtEnd);
report.status=report.checks.every(c=>c.status==='passed')?'passed':'failed';report.finishedAt=new Date().toISOString();persist();
if(report.status!=='passed')process.exitCode=1;
console.log(JSON.stringify({status:report.status,report:`${output}/report.json`,sourceStableDuringRun:report.sourceStableDuringRun,continuousRecords:realRecords.length}));
