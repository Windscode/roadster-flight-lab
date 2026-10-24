import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {InputSession} from '../dist/input-session.js';
import {DriverHeadFeedback} from '../dist/driver-feedback.js';
import {createCityFlightUI} from '../dist/city-flight-ui.js';
import {createApplicationShell} from '../dist/app-shell.js';
import {CityFlightChallenge,makeCityFlightTask} from '../dist/city-flight-challenge.js';
import {CityFlightReview,createPracticeAttempt} from '../dist/city-flight-review.js';
import {createRouteSurfacePreset} from '../dist/route-surface.js';
import {CITY_WEATHER_PRESETS} from '../dist/visual-presets.js';
import {RENDER_PROFILES} from '../dist/render-profiles.js';
import {canonicalJSON,contentLabel,currentExperimentIdentity} from '../dist/experiment-records.js';

// Execute the production function and callback bodies verbatim. Only graphics,
// menus and outer research controllers are fixtures; the simulator, snapshots,
// task UI, recorder, review executor, input session and Three cameras are real.
const source=fs.readFileSync('dist/main.js','utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,`production source boundary ${start}`);return source.slice(a,b);}
function line(prefix){const found=source.split('\n').find(row=>row.startsWith(prefix));assert(found,`production source line ${prefix}`);return found;}
const extracted={
 isolation:between('  function setPaused(','  function prepareSurfaceRoute('),
 camera:between('  function resetCamera(','  function activateScenario('),
 panels:between('  function closePanels(','  function openPanel('),
 cameraConditions:line('  function cameraConditions('),
 sceneConfiguration:line('  function sceneConfiguration('),
 inputSession:line('  const inputSession=new InputSession('),
 callbacks:between('  cityFlight=createCityFlightUI(','\n  let sound='),
 ensureRunning:line('  function ensureRunning('),
 focus:line("  document.addEventListener('focusin'"),
 protectedKey:line("  window.addEventListener('keydown',e=>{if(protectedLearningState()"),
 protectedPointers:between("  for(const type of ['click','input','change','pointerdown'])", "\n  for(const event of ['click','input','change','pointerdown','wheel'])"),
 pilotKey:between("  window.addEventListener('keydown',e=>{if(graphicsStopped||programMatrixBusy)", '\n  function releaseDiagnosticInput('),
 inputKeys:line('  const inputKeys='),
 liveResearchGate:line('    canUseLiveResearch:'),
 beforeResearchRun:line('    beforeResearchRun:'),
};
const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||process.env.JSDOM_MODULE_PATH||'jsdom');
const dom=new JSDOM(fs.readFileSync('dist/index.html','utf8'),{url:'https://fixture.invalid/'}),doc=dom.window.document,oldDocument=globalThis.document,oldWindow=globalThis.window;globalThis.document=doc;globalThis.window=dom.window;
const draw=new Proxy({},{get:(object,key)=>object[key]??(()=>{}),set:(object,key,value)=>{object[key]=value;return true;}});dom.window.HTMLCanvasElement.prototype.getContext=()=>draw;
const initialSim=new RoadsterSim({supplyMode:'finite'},{world:'city'});initialSim.reset('city');initialSim.setRouteSurface(createRouteSurfacePreset('after-rain'),{phase:'preparation'});initialSim.setWind({speedMps:1.6,directionDeg:70,gustMps:.4,gustPeriodS:4});for(let step=0;step<180;step++)initialSim.advanceFixed({throttle:.2});
const liveBefore=initialSim.exportState(),liveLabel=contentLabel(liveBefore),camera=new THREE.PerspectiveCamera(57,16/9,.07,2300);camera.position.set(17,6,-8);camera.lookAt(11,1,12);
const fixtures={research:{running:false,experiment:{recording:false,replaying:false,numericRunning:false},landing:{running:false,numericRunning:false}},capture:{active:false},events:[],surface:null,navigation:{id:'waterfront',label:'Original waypoint',position:[0,0,-400]}};
const factory=new Function('D',`
 const {THREE,RoadsterSim,InputSession,DriverHeadFeedback,CITY_WEATHER_PRESETS,RENDER_PROFILES,document,fixtures}=D;
 const window=document.defaultView,{HTMLInputElement,HTMLSelectElement,HTMLTextAreaElement}=window,$=id=>document.getElementById(id),$$=selector=>[...document.querySelectorAll(selector)],vec=v=>new THREE.Vector3(v.x,v.y,v.z),getLanguage=()=> 'zh',localStorage=window.localStorage;
 let sim=D.initialSim,t=sim.telemetry(),activeContext='city',scenario=sim.scenario,scale=1,learningSessionMode='live',learningSaved=null,learningPrepared=false,learningSeekSerial=0;
 let programMatrixBusy=false,renderPreparing=false,graphicsStopped=false,paused=true,lastTime=0,menuOpen=false,started=true,reverseHold=0,sound=null,lastActionResetSequence=0,pendingManeuver=null;
 let quality='balanced',weatherPreset='clear-day',exposureLock=null,lampSelection='auto',activeBenchmarkRoute=sim.getRouteSurface()?.descriptor.id??null,cameraMode='orbit',fixedCameraId=null;
 let wantedCamera=null,cameraObstruction=null,cameraSolveMode=null,clearanceSampleAt=0,samples=[],trailCount=0,trailClock=0,panelFocus=null,pausedByPanel=false,activeDrawer=null;
 const headFeedback=new DriverHeadFeedback({enabled:false}),camera=D.camera,orbitCamera=camera.clone(),lastPosition=new THREE.Vector3(),controls={target:new THREE.Vector3(11,1,12),enabled:true,update(){orbitCamera.lookAt(this.target);}};
 const keys=new Set(),renderer={toneMappingExposure:.93},trailGeometry={setDrawRange(){}},meter={markEvent(){}},operationHud={invalidate(){},update(){}},viewport=$('viewport'),shell={studyOpen:false,graphics:{status:'available'}},operationStack=document.createElement('div');$('app').append(operationStack);
 const car={group:new THREE.Group(),lampMode:'off',update(){}},environment={setRouteSurfaceDescription(value){fixtures.surface=value;}};let exhaust={sim,reset(){}};
 const contexts={city:{sim,scene:new THREE.Scene()}},cityMap={get waypoint(){return fixtures.navigation;},setSurfaceRoute(value){fixtures.mapSurface=value;},setDestination(value){fixtures.navigation=value;}};
 const researchConsole={getState:()=>fixtures.research,getExperimentState:()=>fixtures.research.experiment,cancel(){},stopRecording(){},recordEvent(type,data){fixtures.events.push({type,data});},close(){},handleKey(){return false;}};
 const controlCapture={getState:()=>fixtures.capture,cancel(){}},routeExperience={setFeedback(value){fixtures.feedback=value;},cancel(){}};
 let cityFlight=null,callbacks=null;
 const createCityFlightUI=options=>{callbacks=options;return D.createCityFlightUI(options);};
 const toast=message=>fixtures.events.push({type:'toast',message}),logEvent=(type,data)=>fixtures.events.push({type,data}),syncUi=()=>{},syncExposureControls=()=>{};
 const setCityWeather=value=>{weatherPreset=value;},setQuality=value=>{quality=value;};
 const switchContext=()=>{throw Error('This integration fixture covers the city context; lab graphics switching is not simulated.');};
 const start=()=>{throw Error('Unexpected launch path in prepared practice.');},closeGameMenu=()=>{menuOpen=false;setPaused(false);},closeStudy=()=>{},openGameMenu=()=>{},openPanel=()=>{},openResearch=()=>{};
 const rejectedKey=()=>{},releaseDiagnosticInput=()=>keys.clear();
 ${extracted.isolation}
 ${extracted.camera}
 ${extracted.cameraConditions}
 ${extracted.sceneConfiguration}
 ${extracted.panels}
 ${extracted.ensureRunning}
 ${extracted.inputSession}
 ${extracted.callbacks}
 ${extracted.inputKeys}
 ${extracted.protectedKey}
 ${extracted.protectedPointers}
 ${extracted.pilotKey}
 ${extracted.focus}
 return {ui:cityFlight,callbacks,inputSession,keys,returnLearningLive,setPaused,protectedLearningState,sceneConfiguration,cameraConditions,
 ${extracted.liveResearchGate}
 ${extracted.beforeResearchRun}
 getSim:()=>sim,getState:()=>({paused,mode:learningSessionMode,prepared:learningPrepared,hasReturn:!!learningSaved,seekSerial:learningSeekSerial}),
 setPanelFocus:value=>{panelFocus=value;},setResearch:value=>{fixtures.research=value;},setCapture:value=>{fixtures.capture=value;},
 getPresentation:()=>({surface:fixtures.surface,mapSurface:fixtures.mapSurface,navigation:fixtures.navigation,route:activeBenchmarkRoute,head:headFeedback.enabled})};
`);
const host=factory({THREE,RoadsterSim,InputSession,DriverHeadFeedback,CITY_WEATHER_PRESETS,RENDER_PROFILES,document:doc,fixtures,initialSim,camera,createCityFlightUI});
const productionShell=createApplicationShell({initialSim});productionShell.attachLive({getSim:host.getSim,getContext:()=> 'city',getSceneConfiguration:host.sceneConfiguration,canUseLiveResearch:host.canUseLiveResearch,beforeResearchRun:host.beforeResearchRun,toast(){},restoreExperiment(){throw Error('Protected research restore must be refused before invoking its host.');}});productionShell.graphicsReady();
const cameraBefore=host.cameraConditions(),navigationBefore=structuredClone(fixtures.navigation);
// Make a valid source record through the real task API. The source uses the
// existing harbor preparation and 120 Hz brake input; it is not a failed-score mock.
const sourceSim=new RoadsterSim({supplyMode:'bench'},{world:'city'});sourceSim.reset('harbor');for(let i=0;i<240;i++)sourceSim.advanceFixed({brake:1});
const challenge=new CityFlightChallenge(sourceSim,{task:makeCityFlightTask({supplyMode:'bench'}),attemptClass:'practice'}).start();
for(let i=0;i<300;i++){if(i===298)sourceSim.setPoseTarget({position:{x:400,y:10.5,z:230},quaternion:{x:0,y:0,z:0,w:1}});const input=challenge.beforeStep(i<298?{brake:1}:{});challenge.afterStep(sourceSim.advanceFixed(input),input,1/120);}const record=challenge.cancel('pilot_cancel');
const createSim=snapshot=>new RoadsterSim({...snapshot.params},{world:snapshot.worldType});

for(const block of [
 {running:true}, {experiment:{recording:true}}, {experiment:{replaying:true}}, {experiment:{numericRunning:true}}, {landing:{running:true}}, {landing:{numericRunning:true}},
]){host.setResearch(block);const prepared=createPracticeAttempt(record,{createSim});assert.throws(()=>host.callbacks.onPractice(prepared),/结束正在进行/);assert.equal(contentLabel(host.getSim().exportState()),liveLabel);assert.equal(host.getState().hasReturn,false);}
host.setResearch({});host.setCapture({active:true});assert.throws(()=>host.callbacks.onPractice(createPracticeAttempt(record,{createSim})),/结束正在进行/);host.setCapture({active:false});

// Start preparation through the real task UI and production host callbacks.
// closePanels restores focus to an actual input, invoking the production
// InputSession release hook while the imported initial state is protected.
host.setPanelFocus(doc.getElementById('vertical-speed-command'));await host.ui.preparePractice(record);
assert.equal(host.getState().mode,'practice');assert.equal(host.getState().paused,true);assert.equal(host.getState().prepared,true);
const preparedLabel=record.liveExperiment.initialSnapshot.stateLabel;assert.equal(contentLabel(host.getSim().exportState()),preparedLabel);
productionShell.openResearch('programs');await productionShell.openStudy();assert.equal(productionShell.getState().research.open,false);assert.equal(productionShell.getState().studyOpen,false);
assert.throws(()=>productionShell.research.startRecording(),/不可用/);assert.throws(()=>productionShell.research.startReplay(record.liveExperiment),/不可用/);productionShell.research.handleKey('Digit3');assert.equal(productionShell.getState().research.running,false);assert.equal(contentLabel(host.getSim().exportState()),preparedLabel);
doc.getElementById('response-pitchRateDegS')?.focus();doc.getElementById('target-height').focus();host.inputSession.release('window-blur',{pause:true});host.setPaused(false);
const button=host.ui.prep.querySelector('[data-cf-action="start"]'),space=new dom.window.KeyboardEvent('keydown',{code:'Space',bubbles:true,cancelable:true});button.dispatchEvent(space);
assert.equal(space.defaultPrevented,false,'Space remains a native button action');assert.equal(host.keys.size,0,'button Space does not enter driver inputs');assert.equal(host.getState().paused,true);
assert.equal(contentLabel(host.getSim().exportState()),preparedLabel,'focus, release, button keyboard and resume cannot rewrite prepared snapshot');
host.ui.start();assert.equal(host.ui.getState().running,true);assert.equal(host.getState().prepared,false);assert.equal(host.getState().paused,false);
const pilotInput=host.ui.beforeStep({brake:1});host.ui.afterStep(host.getSim().advanceFixed(pilotInput),pilotInput,1/120);host.ui.cancel('pilot_cancel');
assert.equal(host.ui.getRecords().at(-1).liveExperiment.initialSnapshot.stateLabel,preparedLabel);host.returnLearningLive();
assert.equal(canonicalJSON(host.getSim().exportState()),canonicalJSON(liveBefore));assert.equal(host.getState().paused,true);assert.deepEqual(host.cameraConditions(),cameraBefore);assert.deepEqual(host.getPresentation().navigation,navigationBefore);
assert.equal(host.getPresentation().surface.id,liveBefore.state._routeSurface.id);assert.equal(host.getPresentation().mapSurface.id,liveBefore.state._routeSurface.id);

// Hold a real seek at its first cooperative yield: the production callback
// must already protect the active simulation before awaiting the replay.
let releaseSeek;const wait=new Promise(resolve=>{releaseSeek=resolve;});let firstYield=true;
const review=new CityFlightReview(record,{createSim,yieldEvery:1,yieldTask:()=>{if(firstYield){firstYield=false;return wait;}return Promise.resolve();}});
const pending=host.callbacks.onReview({record,step:120,review});assert.equal(host.getState().mode,'review');assert.equal(host.protectedLearningState(),true);assert.equal(host.getState().paused,true);
const seekLabel=contentLabel(host.getSim().exportState());host.inputSession.release('editing-focus');host.setPaused(false);assert.equal(contentLabel(host.getSim().exportState()),seekLabel);assert.equal(host.getState().paused,true);
releaseSeek();const reviewed=await pending;assert.equal(reviewed.displayedStep,120);assert.equal(host.getSim(),review.sim);
await host.callbacks.onReview({record,step:record.stepCount,review});assert.equal(host.getSim().telemetry().holdActive,true);const heldLabel=contentLabel(host.getSim().exportState());
// The research chip has an internal open/stop path independent of the shell.
// Its idle Stop action must honor the same dynamic live-operation boundary.
doc.querySelector('.rc-running-chip [data-rc-action="stop"]').click();assert.equal(contentLabel(host.getSim().exportState()),heldLabel,'research chip must not release a reviewed hold target');
host.returnLearningLive();assert.equal(canonicalJSON(host.getSim().exportState()),canonicalJSON(liveBefore));

// A delayed seek may not replace a later explicitly prepared practice.
let releaseOld;const oldWait=new Promise(resolve=>{releaseOld=resolve;});firstYield=true;
const stale=new CityFlightReview(record,{createSim,yieldEvery:1,yieldTask:()=>{if(firstYield){firstYield=false;return oldWait;}return Promise.resolve();}}),oldSeek=host.callbacks.onReview({record,step:20,review:stale});
const newer=createPracticeAttempt(record,{createSim});host.callbacks.onPractice(newer);releaseOld();assert.equal((await oldSeek).cancelled,true);assert.equal(host.getSim(),newer.sim);assert.equal(contentLabel(host.getSim().exportState()),preparedLabel);host.returnLearningLive();
assert.equal(canonicalJSON(host.getSim().exportState()),canonicalJSON(liveBefore));

const report={schema:'roadster-learning-main-integration-3.19',identity:currentExperimentIdentity(),mainSha256:crypto.createHash('sha256').update(source).digest('hex'),extractedSourceSha256:Object.fromEntries(Object.entries(extracted).map(([key,value])=>[key,crypto.createHash('sha256').update(value).digest('hex')])),scope:'Production main.js isolation functions, callbacks, keyboard/focus guards and InputSession executed verbatim with actual RoadsterSim, task UI/recorder/review, application shell, research UI and Three cameras; JSDOM and graphics/menu/controller fixtures. City context only; no WebGL, browser-native keys or lab graphics switch claim.',activeResearchAndRecordingEntryRefused:true,preparedCompleteSnapshotUnchangedUntilStart:true,shellStudyAndResearchEntryBlockedDuringPreparation:true,researchShortcutRecordingReplayAndIdleStopCannotMutateIsolatedSim:true,buttonSpaceDoesNotBecomeDriverInput:true,seekProtectedBeforeAwait:true,lateSeekCannotOverridePractice:true,returnCompleteStateExactlyRestored:true,cameraSurfaceAndNavigationRestored:true,sourceRecordId:record.id,liveStateLabel:liveLabel};
fs.mkdirSync(`qa/learning-loop-${REPORT_VERSION}`,{recursive:true});fs.writeFileSync(`qa/learning-loop-${REPORT_VERSION}/main-integration-report.json`,JSON.stringify(report,null,2));host.ui.dispose();productionShell.research.dispose();globalThis.document=oldDocument;globalThis.window=oldWindow;dom.window.close();
console.log('Production main isolation: preparation, input guards, seek freeze, stale seek, exact live/camera/surface return and research exclusions passed.');
