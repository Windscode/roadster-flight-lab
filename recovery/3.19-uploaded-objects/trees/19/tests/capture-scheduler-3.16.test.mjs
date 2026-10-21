import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Execute the actual production frame/request functions with controlled async
// callbacks, and retain the exact frozen source that exposed redundant draws.
// The renderer and physics effects below are boundary counters, not a GPU or
// vehicle solver, so these checks never certify native pixels or route motion.
const root=new URL('../',import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
const fixture=JSON.parse(readFileSync(new URL('tests/fixtures/capture-scheduler-before-3.16.json',root),'utf8'));
assert.equal(fixture.sourceSHA256,'dd7b9c69f4fef5add7c6e8497bb9b5bf7e394bd0f3286e96e52c65d701e6c133');
for(const record of Object.values(fixture.functions))assert.equal(sha(record.source),record.sha256);
const originalMatrix=readFileSync(new URL(fixture.matrixFixture,root),'utf8');assert.equal(sha(originalMatrix),fixture.matrixSHA256);
const originals={main:Object.fromEntries(Object.entries(fixture.functions).map(([name,record])=>[name,record.source])),matrix:originalMatrix};
const candidates={main:readFileSync(new URL('dist/main.js',root),'utf8'),matrix:readFileSync(new URL('dist/render-capture-matrix.js',root),'utf8')};
function extract(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function bootstrap(){
  const effect={raf:0,sceneUpdates:0,reflectionSubmissions:0,composers:0,audits:0,toBlobCalls:0,physicsSteps:0,errors:[]};
  const vector=(x=0,y=0,z=0)=>({x,y,z,copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;},lerp(v,a){this.x+=(v.x-this.x)*a;this.y+=(v.y-this.y)*a;this.z+=(v.z-this.z)*a;return this;},set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}});
  class Quaternion{constructor(x=0,y=0,z=0,w=1){Object.assign(this,{x,y,z,w});}copy(){return this;}slerp(){return this;}}
  const nodes=new Map();
  Object.assign(globalThis,{
    effects:effect,clock:0,timers:[],blobCallbacks:[],requestAnimationFrame:()=>{effect.raf++;},document:{hidden:false},performance:{now:()=>globalThis.clock},
    setTimeout:(fn,delay)=>{const timer={fn,at:globalThis.clock+delay,active:true};globalThis.timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.active=false;},
    tr:s=>s,captureCancelled:()=>Object.assign(Error('Capture cancelled by user'),{name:'AbortError'}),matrixAbort:null,pendingProgramCapture:null,programMatrixBusy:true,graphicsStopped:false,
    paused:true,menuOpen:false,lastTime:0,lastRendered:0,previousFrameWasDiagnostic:false,nextResourceSample:Infinity,resourceHistory:[],captureImageRequested:false,captureBundleRequested:false,
    t:{simTime:0,position:{x:0,y:.62,z:0},quaternion:{x:0,y:0,z:0,w:1},mode:'drive',stabilizationMode:'off',targetAltitude:0},
    vec:v=>vector(v.x,v.y,v.z),THREE:{Quaternion},scale:1,physicalDelta:0,showForces:false,lastExposureSample:Infinity,exposureTarget:1.02,exposureLock:1.02,weatherPreset:'wet-night',activeContext:'city',quality:'high',
    cameraMode:'fixed',renderSize:{width:800,height:450},uiTimer:0,frames:0,fpsTime:0,displayFps:0,captureNotice:false,fixedCameraId:'viaduct',MODEL_VERSION:'3.16.0',
    sound:null,keys:new Set(),forcesRoot:{},trail:{},targetGroup:{visible:false,position:vector()},
    camera:{position:vector(),projectionMatrix:{},projectionMatrixInverse:{},updateMatrixWorld(){}},
    car:{group:{position:vector(),quaternion:new Quaternion()},update(){},setViewBudget(){}},
    environment:{stats:{},wantsShadowUpdate:()=>false,particleLighting:()=>({ambient:0,lights:[]}),updateReflections(){effect.reflectionSubmissions++;}},
    exhaust:{mesh:{},setLighting(){},update(){}},ssao:{enabled:false},
    renderer:{info:{reset(){},programs:[],memory:{}},shadowMap:{needsUpdate:false},toneMappingExposure:1.02,domElement:{toBlob(callback){effect.toBlobCalls++;globalThis.blobCallbacks.push(callback);}}},
    composer:{render(){effect.composers++;}},
    meter:{frameNumber:0,begin(){this.frameNumber++;},measure(_name,fn){return fn();},beginGpu(){},endGpu(){},end(){return{cpu:{total:0},calls:effect.composers,triangles:0};},capture:null},
    renderPrograms:{active:false,beginFrame(conditions){this.active=true;this.conditions=conditions;effect.audits++;},endFrame(extra={}){this.active=false;return{status:'stub-only-no-GPU',label:this.conditions.label,drawCalls:0,...extra};},withPass(_name,fn){return fn();}},
    programConditions:label=>({label}),programStatus(){},visualConditions:()=>({simState:{simTime:globalThis.t.simTime}}),
    updateCamera(){},updateForces(){},updateEnvironment(){effect.sceneUpdates++;},syncUi(){},resize(){},toast(){},governor:{update:()=>false},
    $:id=>{if(!nodes.has(id))nodes.set(id,{checked:true,dataset:{},textContent:''});return nodes.get(id);},
    shell:{graphicsUnavailable:message=>effect.errors.push(message)},console:{error:error=>effect.errors.push(String(error))},
    researchConsole:{update(){},needsFixedStep:()=>false,afterFixedStep(){}},controlCapture:{getState:()=>({active:false})},inputSession:{tracing:false},
    // The route runner is inactive in this scheduler boundary fixture. Keep
    // the real frame's 3.19 dependency explicit without introducing a solver.
    cityFlight:{needsFixedStep:()=>false},routeExperience:{needsFixedStep:()=>false},inputs:()=>({}),captureSample(){},
    sim:{body:{previousPosition:{x:0,y:.62,z:0},previousQuaternion:{x:0,y:0,z:0,w:1}},interpolationAlpha:1,_lastInput:{brake:0},
      telemetry:()=>globalThis.t,step(dt){effect.physicsSteps++;globalThis.t.simTime+=dt;return globalThis.t;}},
  });
}
function make(source,{paused=true,matrixBusy=true}={}){
  const context=vm.createContext({});
  vm.runInContext('('+bootstrap.toString()+')();',context);
  context.paused=paused;context.programMatrixBusy=matrixBusy;
  const request=typeof source==='string'?extract(source,'  function requestProgramFrame(','  function programConditions('):source.request;
  const frame=typeof source==='string'?extract(source,'  function frame(now){','  if(new URLSearchParams(location.search)'):source.frame;
  const cancel=typeof source==='string'?extract(source,'  function cancelProgramMatrix(){',"\n  $('render-program-cancel')"):source.cancel;
  vm.runInContext(request+'\n'+frame+'\n'+cancel,context,{timeout:1000});
  return context;
}
const clone=value=>JSON.parse(JSON.stringify(value));
function tick(context,time){context.clock=time;context.frame(time);assert.deepEqual(clone(context.effects.errors),[]);}
function expire(context,time){context.clock=time;for(const timer of context.timers)if(timer.active&&timer.at<=time){timer.active=false;timer.fn();}}
function queue(context,png=true){return context.requestProgramFrame({label:'fixture-export',png}).then(value=>({ok:true,value}),error=>({ok:false,error}));}
const checks=[];
for(const [name,source]of [['before',originals.main],['candidate',candidates.main]]){
  const c=make(source),pending=queue(c);tick(c,100);tick(c,200);tick(c,300);
  const beforeCancel=clone(c.effects);c.cancelProgramMatrix();const result=await pending;
  assert.equal(result.ok,false);assert.equal(result.error.name,'AbortError');assert.equal(beforeCancel.raf,3);assert.equal(beforeCancel.toBlobCalls,1);assert.equal(beforeCancel.audits,1);
  assert.equal(beforeCancel.composers,name==='before'?3:1);assert.equal(beforeCancel.reflectionSubmissions,name==='before'?3:1);assert.equal(beforeCancel.sceneUpdates,name==='before'?3:1);assert.equal(c.lastTime,300);
  assert.equal(c.pendingProgramCapture,null);assert.equal(c.timers.some(t=>t.active),false);
  tick(c,400);assert.equal(c.effects.composers,beforeCancel.composers+1);
  checks.push({case:name+'-paused-pending-PNG-rAF-and-cancel',effectsBeforeCancel:beforeCancel,lastTimeBeforeCancel:300,cancelled:true,renderResumedAfterCancel:true,scope:'Actual extracted main functions; rendering and blob completion are controlled stubs, not GPU timing.'});
}
for(const [name,source]of [['before',originals.main],['candidate',candidates.main]]){
  const c=make(source,{paused:false,matrixBusy:false}),pending=queue(c);tick(c,100);tick(c,200);tick(c,300);
  assert.equal(c.effects.physicsSteps,3);assert.equal(c.effects.composers,3);assert.equal(c.effects.toBlobCalls,1);
  c.clock=400;c.blobCallbacks[0]({fixture:'blob'});const result=await pending;assert.equal(result.ok,true);
  assert.ok(result.value.conditions.simState.simTime<c.t.simTime,'Conditions retain the earlier captured physical state while active driving continues.');
  checks.push({case:name+'-active-driving-continues',effects:clone(c.effects),capturedSimTime:result.value.conditions.simState.simTime,currentSimTime:c.t.simTime});
}
{
  const c=make(candidates.main),pending=queue(c);expire(c,20001);const result=await pending;
  assert.equal(result.ok,false);assert.equal(result.error.captureProgress.phase,'queued');assert.equal(result.error.captureAudit,null);assert.equal(c.effects.composers,0);
  checks.push({case:'candidate-original-deadline-before-first-frame',message:result.error.message,progress:clone(result.error.captureProgress),exportAuditAvailable:false});
}
{
  const c=make(candidates.main),pending=queue(c);tick(c,100);tick(c,200);expire(c,20001);const result=await pending;
  assert.equal(result.ok,false);assert.equal(result.error.captureProgress.phase,'toBlob-return');assert.equal(result.error.captureAudit.label,'fixture-export');
  const retained=JSON.stringify(result.error.captureProgress);c.clock=21000;c.blobCallbacks[0]({fixture:'late-blob'});
  assert.equal(JSON.stringify(result.error.captureProgress),retained);assert.equal(c.pendingProgramCapture,null);
  checks.push({case:'candidate-original-deadline-after-draw-retains-own-audit',progress:clone(result.error.captureProgress),captureAudit:clone(result.error.captureAudit),lateCallbackDoesNotResolveOrRewriteFailure:true});
}
{
  const c=make(candidates.main),pending=queue(c);tick(c,100);tick(c,200);c.clock=400;c.blobCallbacks[0]({fixture:'blob'});const result=await pending;
  assert.equal(result.ok,true);assert.equal(result.value.captureProgress.phase,'callback');assert.equal(result.value.conditions.captureProgress.phase,'callback');
  assert.deepEqual(Object.keys(result.value.captureProgress.phases),['queued','draw-start','draw-end','conditions-frozen','toBlob-call','toBlob-return','callback']);
  assert.equal(c.timers.some(t=>t.active),false);checks.push({case:'candidate-successful-callback-has-small-phase-record',progress:clone(result.value.captureProgress)});
}
{
  const c=make(candidates.main),pending=queue(c,false);tick(c,100);const result=await pending;tick(c,200);
  assert.equal(result.ok,true);assert.equal(c.effects.toBlobCalls,0);assert.equal(c.effects.composers,2);assert.equal(result.value.captureProgress.phase,'conditions-frozen');
  checks.push({case:'candidate-ordinary-no-PNG-frame-does-not-freeze',effects:clone(c.effects)});
}
{
  const c=make(candidates.main),pending=queue(c);c.composer.render=()=>{throw Error('controlled draw abort');};c.clock=100;c.frame(100);const result=await pending;
  assert.equal(result.ok,false);assert.equal(result.error.captureProgress.phase,'draw-start');assert.equal(result.error.captureAudit.label,'fixture-export');assert.equal(result.error.captureAudit.aborted,'controlled draw abort');
  checks.push({case:'candidate-render-exception-retains-existing-aborted-export-audit',progress:clone(result.error.captureProgress),captureAudit:clone(result.error.captureAudit)});
}
const load=text=>import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const beforeMatrix=await load(originals.matrix),afterMatrix=await load(candidates.matrix);
assert.deepEqual(afterMatrix.CITY_PROGRAM_MATRIX,beforeMatrix.CITY_PROGRAM_MATRIX);assert.equal(afterMatrix.CITY_PROGRAM_MATRIX.length,14);
{
  const exportAudit={label:'current-export',status:'stub-only-no-GPU'},ordinaryAudit={label:'previous-ordinary',status:'stub-only-no-GPU'};
  const progress={phase:'toBlob-return',label:'current-export',deadlineMs:20000};
  const result=await afterMatrix.collectProgramMatrix({captureCase:async()=>{throw Object.assign(Error('fixture deadline'),{captureProgress:progress,captureAudit:exportAudit,partialAudit:ordinaryAudit,partialAuditSource:'ordinary-paused-frame'});}});
  assert.equal(result.report.expectedFrames,14);assert.equal(result.report.completedFrames,0);assert.equal(result.report.status,'failed');
  assert.deepEqual(result.report.failure.captureAudit,exportAudit);assert.deepEqual(result.report.failure.partialAudit,ordinaryAudit);assert.equal(result.report.failure.partialAuditSource,'ordinary-paused-frame');assert.deepEqual(result.report.failure.captureProgress,progress);
  checks.push({case:'matrix-preserves-current-export-audit-and-ordinary-prefix-separately',expectedFrames:14,completedFrames:0,failure:result.report.failure});
}
const sourcePaths=['dist/main.js','dist/render-capture-matrix.js','tests/capture-scheduler-3.16.test.mjs','tests/fixtures/capture-scheduler-before-3.16.json','tests/fixtures/render-capture-matrix-before-3.16.mjs'];
const report={schema:'roadster-capture-scheduler-isolated-checks-3.16',createdAt:new Date().toISOString(),status:'passed',checks:checks.map(result=>({name:result.case,status:'passed',...result})),sourceHashes:Object.fromEntries(sourcePaths.map(path=>[path,sha(readFileSync(new URL(path,root)))])),baseline:{sourceBuild:fixture.sourceBuild,sourcePath:fixture.sourcePath,sourceSHA256:fixture.sourceSHA256,functions:Object.fromEntries(Object.entries(fixture.functions).map(([name,record])=>[name,{startLine:record.startLine,endLine:record.endLine,sha256:record.sha256}]))},limits:['The exact application request/frame/cancel functions and matrix collector run in a Node VM with deterministic asynchronous callbacks and clock.','Rendering and physical integration are effect counters only: this proves scheduling, cancellation, preserved active stepping and failure evidence. It is not native PNG encoding, GPU queue, pixel or vehicle dynamics validation.','Original 20,000 ms deadline and all fourteen matrix case definitions are unchanged.','PNG physical state, frame number, render time and capturedAt remain frozen at the rendered frame. captureProgress is a separate later lifecycle record, not a new image or recaptured physics state.']};
writeFileSync(new URL(`qa/capture-scheduler-${REPORT_VERSION}.json`,root),JSON.stringify(report,null,2)+'\n');
for(const check of report.checks)console.log('PASS '+check.name);
console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:`qa/capture-scheduler-${REPORT_VERSION}.json`,nativeWebgl:false}));
