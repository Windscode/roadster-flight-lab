import {awaitExport} from './await-export.mjs';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
/** Optional DOM integration check. No browser, WebGL context or pixel output.
 * Run: JSDOM_MODULE_PATH=/path/to/jsdom/lib/api.js node --experimental-vm-modules qa/same-page-ui-check.mjs
 * jsdom is a developer-only optional dependency, not part of the static site.
 */
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname,relative,sep} from 'node:path';
import * as NativeThree from '../dist/vendor/three.module.js';
import {VEHICLE_DRIVER_VIEW} from '../dist/vehicle.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {CONTROL_CAPTURE_STARTS} from '../dist/driving-capture.js';
import {CITY_BENCHMARK_ROUTE} from '../dist/visual-presets.js';

if(typeof vm.SourceTextModule!=='function')throw new Error('Use node --experimental-vm-modules qa/same-page-ui-check.mjs');
const jsdomPath=process.env.JSDOM_MODULE_PATH||'/tmp/roadster-dom-qa/node_modules/jsdom/lib/api.js';
const {JSDOM,VirtualConsole}=await import(pathToFileURL(jsdomPath));
const jsdomVersion=JSON.parse(await readFile(resolve(dirname(jsdomPath),'../package.json'),'utf8')).version;
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
const source=await readFile(resolve(dist,'index.html'),'utf8'),errors=[],checks=[],values={};
const noGraphics=process.argv.includes('--graphics-unavailable'),workerRequests=[],expectedGraphicsErrors=[],deploymentRequests=[];
const deploymentFixture={modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,sourceCommit:'fixture:dom-source-commit',sourceTree:'fixture:dom-source-tree',source:'same-page-ui deployment response fixture; not an actual Git commit or deployment'};
const pngEncoderFixture={defer:false,calls:0,pending:[]};let lastBlob=null;const graphicsFailure=new Error('QA: WebGL context deliberately unavailable');
const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
const dom=new JSDOM(source,{url:'https://qa.invalid/roadster-flight-lab/'+(noGraphics?'?view=lab':''),runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
const window=dom.window,document=window.document,context=dom.getInternalVMContext();
const $=id=>document.getElementById(id),q=selector=>document.querySelector(selector);
let nowMs=0,nextTimer=1,raf=[];const timers=new Map(),graphics={rendered:[],environments:[],cars:[],ao:[],composers:[]};
const noop=()=>{};
const canvasContext=canvas=>new Proxy({canvas,measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop}),getImageData:()=>({data:new Uint8ClampedArray(4)})},{get:(target,key)=>key in target?target[key]:noop,set:(target,key,value)=>(target[key]=value,true)});
window.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')throw new Error('GPU contexts are deliberately unavailable in DOM QA');return this._qaContext??=canvasContext(this);};
window.HTMLCanvasElement.prototype.toBlob=function(callback){
  pngEncoderFixture.calls++;const finish=()=>callback(new globalThis.Blob(['DOM facade: no pixels'],{type:'image/png'}));
  if(pngEncoderFixture.defer)pngEncoderFixture.pending.push(finish);else finish();
};
window.HTMLElement.prototype.scrollIntoView=noop;window.HTMLAnchorElement.prototype.click=noop;
window.HTMLElement.prototype.setPointerCapture=noop;
window.HTMLElement.prototype.releasePointerCapture=noop;
Object.defineProperty(window,'innerWidth',{value:1365,writable:true});Object.defineProperty(window,'innerHeight',{value:768,writable:true});
Object.defineProperty(window,'devicePixelRatio',{value:1});Object.defineProperty(window.performance,'now',{value:()=>nowMs});
Object.defineProperty(window.navigator,'getGamepads',{value:()=>[]});
window.requestAnimationFrame=callback=>{raf.push(callback);return raf.length;};window.cancelAnimationFrame=noop;
window.setTimeout=(callback,delay=0)=>{const id=nextTimer++;timers.set(id,{callback,due:nowMs+delay});return id;};window.clearTimeout=id=>timers.delete(id);
window.console={...console,error:(...args)=>{if(noGraphics&&args[0]===graphicsFailure)expectedGraphicsErrors.push(graphicsFailure.message);else errors.push(args.map(value=>value?.stack||String(value)).join(' '));}};
window.fetch=async request=>{
  const raw=String(request),url=new URL(raw,window.location.href),name=url.pathname.split('/').at(-1);
  if(name==='deployment.json'){deploymentRequests.push({url:raw,source:'explicit deployment fixture'});return{ok:true,status:200,json:async()=>structuredClone(deploymentFixture),text:async()=>JSON.stringify(deploymentFixture)};}
  if(!['research.json','research-panel.html'].includes(name))throw new Error('Unexpected network dependency in DOM QA: '+raw);
  const text=await readFile(resolve(dist,name),'utf8');
  loadedSources.add('dist/'+name);sourceSnapshots.set('dist/'+name,hashBytes(text));
  return{ok:true,status:200,text:async()=>text,json:async()=>JSON.parse(text)};
};
window.Blob=globalThis.Blob;window.structuredClone=globalThis.structuredClone;window.URL.createObjectURL=blob=>{lastBlob=blob;return 'blob:qa-local';};window.URL.revokeObjectURL=noop;
window.TextEncoder=globalThis.TextEncoder;window.TextDecoder=globalThis.TextDecoder;
window.Worker=class{
  constructor(url,options){this.url=String(url);this.stopped=false;this.exporting=this.url.endsWith('/export-worker.js');assert.ok(this.exporting||this.url.endsWith('/experiment-worker.js'),'Only the production numerical and export workers are used in this shell check');assert.equal(options.type,'module');}
  postMessage(request){if(!this.exporting)workerRequests.push(structuredClone(request));setImmediate(async()=>{if(this.stopped)return;try{const module=await getModule(resolve(dist,this.exporting?'export-encoder.js':'experiment-worker.js'));if(module.status==='unlinked')await module.link(linker);if(module.status==='linked')await module.evaluate();if(this.stopped)return;if(this.exporting){const encoded=await module.namespace.encodeJsonChunks(structuredClone(request.value),{onProgress:progress=>{if(!this.stopped)this.onmessage?.({data:{type:'progress',progress}});}});if(!this.stopped)this.onmessage?.({data:{type:'complete',result:{blob:new globalThis.Blob(encoded.parts,{type:'application/json'}),characters:encoded.characters,visited:encoded.visited,workerSerializeMs:0}}});}else{const report=module.namespace.runExperiment(request);this.onmessage?.({data:{ok:true,report}});}}catch(error){this.onmessage?.({data:this.exporting?{type:'failed',error:error.message}:{ok:false,error:error.message}});}});}
  terminate(){this.stopped=true;}
};

class MockRenderer{
  constructor(){if(noGraphics)throw graphicsFailure;this.domElement=document.createElement('canvas');this.shadowMap={};this.debug={checkShaderErrors:true,onShaderError:null};this.properties={get:()=>({})};this.renderBufferDirect=()=>{};this.info={autoReset:false,render:{calls:0,triangles:0},programs:[],reset(){this.render.calls=0;this.render.triangles=0;}};this.ratio=1;}
  setPixelRatio(value){this.ratio=value;}getPixelRatio(){return this.ratio;}
  setSize(width,height){this.width=width;this.height=height;this.domElement.width=Math.floor(width*this.ratio);this.domElement.height=Math.floor(height*this.ratio);}
  getSize(value){return value.set(this.width,this.height);}getDrawingBufferSize(value){return value.set(this.domElement.width,this.domElement.height);}
  getContext(){return{getExtension:()=>null,getParameter:()=>16,getError:()=>0,NO_ERROR:0,isContextLost:()=>false};}
  render(scene){this.info.render.calls++;graphics.rendered.push(scene.uuid);}
  async compileAsync(){if(graphics.compileGate)await graphics.compileGate;}compile(){}
}
class MockOrbitControls{constructor(){this.target=new NativeThree.Vector3();this.enabled=true;}update(){}dispose(){}}
class MockPass{constructor(){this.enabled=true;this.material={uniforms:{resolution:{value:new NativeThree.Vector2()}}};}render(){}setSize(){}dispose(){}}
class MockRenderPass extends MockPass{constructor(scene,camera){super();this.scene=scene;this.camera=camera;}render(renderer){renderer.render(this.scene,this.camera);}}
class MockContactAO extends MockPass{
  constructor(scene,camera){super();this.scene=scene;this.camera=camera;this.blurRenderTarget={texture:new NativeThree.Texture()};this.normalRenderTarget={depthTexture:new NativeThree.Texture()};this.ssaoMaterial={uniforms:{cameraProjectionMatrix:{value:new NativeThree.Matrix4()},cameraInverseProjectionMatrix:{value:new NativeThree.Matrix4()}}};graphics.ao.push(this);}
}
class MockComposer{
  constructor(renderer){this.renderer=renderer;this.passes=[];graphics.composers.push(this);}addPass(pass){this.passes.push(pass);}setPixelRatio(){}setSize(){}
  render(){for(const pass of this.passes)if(pass.enabled!==false)pass.render(this.renderer);}
}
class MockExhaust{
  constructor(scene){this.mesh=new NativeThree.Mesh(new NativeThree.BufferGeometry(),new NativeThree.MeshBasicMaterial());scene.add(this.mesh);this.particles=[];}
  reset(){this.particles.length=0;}setQuality(){}setDepth(){}setLighting(){}update(){}
}
function mockCar({quality}){
  const car={group:new NativeThree.Group(),quality,setQuality(value){this.quality=value;},setLampMode(value){this.lampMode=value;},setInteriorView(value){this.interiorView=value;},setCutaway(value){this.cutaway=value;},setColor(value){this.color=value;},setViewBudget(camera,height,options){this.viewBudget={height,options};},update(){},getRenderCost(){return{scope:'graphics mock; no GPU or geometry budget measured'};}};
  graphics.cars.push(car);return car;
}
function mockEnvironment(kind,scene){
  scene.userData.qaContext=kind;
  const environment={scene,stats:{qaContext:kind},ready:Promise.resolve(),quality:null,updates:0,reflections:0,
    setQuality(value){this.quality=value;},setContactAO(){},setDay(){},setWeatherPreset(value){this.weatherPreset=value;},setVehicleRoot(value){this.vehicleRoot=value;},resize(){},update(){this.updates++;},wantsShadowUpdate(){return false;},updateReflections(){this.reflections++;},exposureAt(){return .90;},particleLighting(){return{ambient:new NativeThree.Color(.1,.1,.1),lights:[]};},setTargetPose(value){this.target=value;}};
  graphics.environments.push(environment);return environment;
}
const mocks=new Map([
  ['vendor/three.module.js',{...NativeThree,WebGLRenderer:MockRenderer}],
  ['vendor/addons/controls/OrbitControls.js',{OrbitControls:MockOrbitControls}],
  ['vendor/addons/postprocessing/EffectComposer.js',{EffectComposer:MockComposer}],
  ['vendor/addons/postprocessing/RenderPass.js',{RenderPass:MockRenderPass}],
  ...['UnrealBloomPass','OutputPass','SMAAPass','ShaderPass'].map(name=>[`vendor/addons/postprocessing/${name}.js`,{[name]:MockPass}]),
  ['contact-ao-pass.js',{ContactAOPass:MockContactAO}],
  ['vehicle.js',{createRoadster:mockCar,VEHICLE_DRIVER_VIEW}],
  ['exhaust.js',{ColdGasExhaust:MockExhaust}],
  ['city-environment.js',{createEnvironment:scene=>mockEnvironment('city',scene)}],
  ['wind-laboratory.js',{createWindLaboratory:scene=>mockEnvironment('lab',scene)}],
  ['audio.js',{createVehicleAudio:()=>({enabled:true,volume:1,context:{state:'running',resume:async()=>{}},silence(){},update(){},setVolume(){}})}],
  ['car-radio.js',{createCarRadio:async()=>({toggle(){},next(){}})}],
]);
const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
// Mock keys and report paths use URL-style separators on every host. Keep
// native absolute paths for filesystem access and canonical module identity.
const relativeModulePath=(from,filename)=>relative(from,filename).split(sep).join('/');
const modules=new Map(),moduleLoads=new Map(),moduleConstructionCounts=new Map(),loadedSources=new Set(),sourceSnapshots=new Map([['dist/index.html',hashBytes(source)]]);
for(const name of ['style.css','game.css','research-console.css','research.css']){
  const path='dist/'+name;sourceSnapshots.set(path,hashBytes(await readFile(resolve(root,path))));
}
function getModule(filename){
  filename=resolve(filename);if(modules.has(filename))return Promise.resolve(modules.get(filename));
  if(moduleLoads.has(filename))return moduleLoads.get(filename);
  // A browser has one module instance per URL. Register the pending load before
  // reading source, so concurrent imports cannot create different Vec3 classes.
  const pending=Promise.resolve().then(()=>createModule(filename));moduleLoads.set(filename,pending);return pending;
}
async function createModule(filename){
  const key=relativeModulePath(dist,filename),mock=mocks.get(key);let module;
  if(mock)module=new vm.SyntheticModule(Object.keys(mock),function(){for(const[name,value]of Object.entries(mock))this.setExport(name,value);},{context,identifier:pathToFileURL(filename).href});
  else{
    const code=await readFile(filename,'utf8'),sourcePath=relativeModulePath(root,filename);loadedSources.add(sourcePath);sourceSnapshots.set(sourcePath,hashBytes(code));
    module=new vm.SourceTextModule(code,{context,identifier:pathToFileURL(filename).href,initializeImportMeta(meta){meta.url=pathToFileURL(filename).href;},importModuleDynamically:async(specifier,referencing)=>{const next=await getModule(resolve(dirname(fileURLToPath(referencing.identifier)),specifier));if(next.status==='unlinked')await next.link(linker);if(next.status==='linked')await next.evaluate();return next;}});
  }
  moduleConstructionCounts.set(filename,(moduleConstructionCounts.get(filename)||0)+1);modules.set(filename,module);return module;
}
async function linker(specifier,referencing){assert.ok(specifier.startsWith('.'),'Unexpected external module '+specifier);return getModule(resolve(dirname(fileURLToPath(referencing.identifier)),specifier));}
const entry=await getModule(resolve(dist,'app.js'));await entry.link(linker);await entry.evaluate();
// The dynamically imported production module graph performs asynchronous file
// reads in this VM adapter. Yield a real timer turn, as settle() does below:
// 2000 immediate callbacks can finish before I/O under concurrent DOM checks.
// This is fixture startup waiting, not a browser boot/performance assertion.
for(let turn=0;turn<2000&&!(window.roadsterReady||noGraphics&&window.roadsterApp?.getState().graphics.status==='unavailable');turn++)await new Promise(resolve=>setTimeout(resolve,1));
const assertHealthy=()=>{assert.equal(errors.length,0,errors.join('\n'));assert.ok($('error-screen').classList.contains('hidden'),$('error-message').textContent);};
assertHealthy();assert.equal(window.roadsterApplicationReady,true,'Application and numerical research shell must initialize independently of WebGL');
if(!noGraphics)assert.equal(window.roadsterReady,true,'Actual main.js boot must complete');
const state=()=>window.roadsterLab?.getState()||window.roadsterApp.getState();
const exportTurn=()=>{nowMs+=1;for(const[id,timer]of [...timers])if(timer.due<=nowMs){timers.delete(id);timer.callback();}};
const tick=(frames=1,frameMs=1000/60)=>{for(let i=0;i<frames;i++){nowMs+=frameMs;const callbacks=raf;raf=[];for(const callback of callbacks)callback(nowMs);for(const[id,timer]of [...timers])if(timer.due<=nowMs){timers.delete(id);timer.callback();}assertHealthy();}};
const renderingReady=async()=>{for(let i=0;i<20;i++){tick(1,40);await new Promise(resolve=>setImmediate(resolve));if($('render-prepare-progress').classList.contains('hidden'))return;}assert.fail('Render preparation did not settle');};
const click=selector=>{const element=selector.startsWith('#')?$(selector.slice(1)):q(selector);assert.ok(element,'Missing DOM control '+selector);element.click();assertHealthy();return element;};
const key=(code,{type='keydown',target=$('viewport'),repeat=false,...init}={})=>{const event=new window.KeyboardEvent(type,{code,bubbles:true,cancelable:true,repeat,...init});target.dispatchEvent(event);assertHealthy();return event;};
const tap=code=>{key(code);key(code,{type:'keyup'});};
const pass=name=>{checks.push(name);console.log('PASS: '+name);};
const settle=async(predicate,label)=>{for(let turn=0;turn<3000&&!predicate();turn++){exportTurn();await new Promise(resolve=>setTimeout(resolve,1));}assertHealthy();assert.ok(predicate(),label+'; last UI toast: '+$('toast').textContent);};
const study=()=>q('.research-study-panel');
const numerical=telemetry=>JSON.stringify({position:telemetry.position,quaternion:telemetry.quaternion,velocity:telemetry.velocity,angularVelocity:telemetry.angularVelocity,gasMass:telemetry.gasMass,time:telemetry.simTime});
const storedZipEntries=async blob=>{
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),entries={};let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),name=new TextDecoder().decode(bytes.slice(offset+30,offset+30+nameLength)),start=offset+30+nameLength+extraLength;entries[name]=bytes.slice(start,start+size);offset=start+size;}
  return entries;
};

if(!noGraphics){
assert.equal(state().context,'city');assert.equal(state().scenario,'city');assert.equal(state().paused,true);
assert.equal(document.querySelectorAll('#viewport canvas').length,1);assert.ok($('play-city'));
click('#play-city');tick(120);assert.equal(state().paused,false);assert.ok(state().simTime>1.9);
pass('Actual main.js boots the city through the primary entry and advances the real 120 Hz simulation with a single viewport canvas');
const initialResponseState=numerical(state());
$('vertical-speed-command').value='6.4';$('vertical-speed-command').dispatchEvent(new window.Event('input',{bubbles:true}));$('vertical-speed-command').dispatchEvent(new window.Event('change',{bubbles:true}));
assert.equal(window.roadsterLab.getParameters().climbRateMps,6.4);assert.equal(window.localStorage.getItem('roadster-vertical-speed'),'6.4');assert.equal(numerical(state()),initialResponseState,'Response preference must not reset or advance the vehicle');
click('#vertical-speed-reset');assert.equal(window.roadsterLab.getParameters().climbRateMps,5);assert.equal(window.localStorage.getItem('roadster-vertical-speed'),'5');assert.equal(numerical(state()),initialResponseState);
pass('Visible E/Q response changes the active target-speed parameter and persists without resetting physical state; reset restores 5 m/s');

for(const [key,value] of Object.entries({verticalAccelerationMps2:7.5,rollRateDegS:275,pitchRateDegS:85,angularAccelerationDegS2:550})){
  const control=$('response-'+key);assert.ok(control,'Visible slider '+key);control.value=String(value);control.dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal(window.roadsterLab.getParameters()[key],value);assert.equal(JSON.parse(window.localStorage.getItem('roadster-control-response-v1'))[key],value);assert.equal(numerical(state()),initialResponseState);
}
click('[data-response-preset="maneuver"]');assert.equal(window.roadsterLab.getParameters().climbRateMps,14);assert.equal(window.roadsterLab.getParameters().rollRateDegS,240);assert.equal(window.roadsterLab.getParameters().angularAccelerationDegS2,480);assert.equal(window.roadsterLab.getParameters().verticalAccelerationMps2,6);assert.equal(numerical(state()),initialResponseState);
click('[data-response-preset="quickroll"]');assert.equal(window.roadsterLab.getParameters().climbRateMps,4);assert.equal(window.roadsterLab.getParameters().rollRateDegS,360);assert.equal(window.roadsterLab.getParameters().pitchRateDegS,90);assert.equal(window.roadsterLab.getParameters().verticalAccelerationMps2,10);assert.equal(window.roadsterLab.getParameters().angularAccelerationDegS2,720);assert.equal(numerical(state()),initialResponseState);
click('[data-response-preset="standard"]');assert.equal(window.roadsterLab.getParameters().climbRateMps,5);assert.equal(window.roadsterLab.getParameters().rollRateDegS,180);assert.equal(window.roadsterLab.getParameters().angularAccelerationDegS2,360);assert.equal(numerical(state()),initialResponseState);
pass('All four manual-response sliders save on input and presets alter bounded reference limits without resetting, advancing or replacing physical state');

for(const expected of ['level','off','level','off']){tap('KeyG');tick(1);assert.equal(state().stabilizationMode,expected);assert.notEqual(state().stabilizationMode,'hold');}
key('Digit1');tick(1);assert.equal(state().driverInput.pitch,1);assert.equal(state().driverInput.frontJets,0);assert.equal(state().driverInput.rearJets,0);key('Digit1',{type:'keyup'});
key('Numpad2');tick(1);assert.equal(state().driverInput.pitch,-1);assert.equal(state().driverInput.frontJets,0);assert.equal(state().driverInput.rearJets,0);key('Numpad2',{type:'keyup'});
tick(1);assert.equal(state().driverInput.pitch,0);
pass('Actual G event routing has only off/level states, and keyboard/numpad 1/2 deliver normalized pitch without opening raw valves');

// Real main DOM events; they validate routing and visible text, not a native
// keyboard device, rendered camera pixels or human driving feel.
key('KeyW');tick(3);tap('KeyR');
assert.equal(state().paused,true);assert.equal(state().simTime,0);assert.equal($('drive-pause-hint').classList.contains('hidden'),false);assert.match($('drive-pause-hint').textContent,/P/);assert.match($('toast').textContent,/已复位并暂停.*P.*旧按键与阀门/);
assert.equal(Object.keys(state().driverInput).length,0);assert.ok(state().nozzles.every(n=>n.command===0&&n.force===0));const resetState=numerical(state()),resetNotice=$('toast').textContent;tick(8);assert.equal(numerical(state()),resetState);
tap('KeyP');tick(30);assert.equal(state().paused,false);assert.ok(state().simTime>0);assert.equal(state().driverInput.throttle,0,'R must clear the previously held W command before P resumes');assert.equal($('drive-pause-hint').classList.contains('hidden'),true);assert.equal($('launch-card').classList.contains('hidden'),true,'P after R must also dismiss the reset start card');assert.equal(document.body.classList.contains('body-running'),true,'Resume restores the ordinary driving HUD');key('KeyW',{type:'keyup'});
values.resetPause={resetPaused:true,resetTimeS:0,notice:resetNotice,oldThrottleCleared:true,resumedThroughP:true};
pass('Actual R resets and pauses with a visible P hint; P resumes without resurrecting old held input or valve commands');

// The compact operation header is outside the legacy game.css-hidden start
// and pause containers. Exercise its real main.js callback with held input.
const operationPause=$('operation-pause');assert.ok(operationPause?.closest('.operation-header'));assert.equal(operationPause.closest('.bottom-console,.launch-card,.topbar'),null);assert.equal(operationPause.type,'button');assert.equal(operationPause.hasAttribute('data-requires-graphics'),true);
assert.equal(operationPause.textContent,'暂停');assert.equal(operationPause.getAttribute('aria-label'),'暂停仿真以观察');
key('KeyW');tick(3);assert.equal(state().driverInput.throttle,1);const beforeHudPause=numerical(state()),pauseStep=state().physicalStep,pauseSequence=window.roadsterLab.getInputTimeline().events.at(-1)?.sequence??0;
click('#operation-pause');assert.equal(state().paused,true);assert.equal(operationPause.textContent,'继续');assert.equal(operationPause.getAttribute('aria-label'),'继续仿真');assert.equal(numerical(state()),beforeHudPause);assert.equal(state().physicalStep,pauseStep);assert.ok(Object.values(state().driverInput).every(value=>value===0||value===false));
const hudRelease=window.roadsterLab.getInputTimeline().events.filter(event=>event.sequence>pauseSequence&&event.type==='input-release'&&event.reason==='pause').at(-1);assert.ok(hudRelease);assert.equal(hudRelease.pause,true);assert.ok(hudRelease.released.includes('KeyW'));assert.equal(hudRelease.pressed.length,0);
tick(20);assert.equal(numerical(state()),beforeHudPause,'Paused HUD observation must preserve physical pose, velocity, gas and simulation time');assert.equal(state().physicalStep,pauseStep);
click('#operation-pause');assert.equal(state().paused,false);assert.equal(operationPause.textContent,'暂停');assert.equal(operationPause.getAttribute('aria-label'),'暂停仿真以观察');assert.equal(numerical(state()),beforeHudPause);tick(3);assert.equal(state().driverInput.throttle,0,'HUD resume must not resurrect W before its eventual keyup');key('KeyW',{type:'keyup'});
tap('KeyR');const resetHudState=numerical(state());assert.equal(operationPause.textContent,'继续');click('#operation-pause');assert.equal(state().paused,false);assert.equal(numerical(state()),resetHudState);assert.equal($('launch-card').classList.contains('hidden'),true);assert.equal(document.body.classList.contains('body-running'),true);tick(30);
values.operationPlayback={scope:'Actual main DOM callback and production solver; no native visibility or pixel claim',selector:'#operation-pause',outsideHiddenLegacyContainers:true,pausedPhysical:JSON.parse(beforeHudPause),physicalStep:pauseStep,heldInputRelease:hudRelease,pausedObservationFrames:20,oldThrottleNotRestored:true,resetResumedThroughStart:true};
pass('The operation HUD pauses the actual solver in place, releases held W, resumes without stale input, and uses the existing start path after reset');

click('[data-game-panel="parameters"]');assert.equal($('engineering-parameters').classList.contains('hidden'),false);assert.equal(state().paused,true);tick(20);
const trimBefore=numerical(state());click('#trim-inspect');assert.equal(numerical(state()),trimBefore);assert.match($('trim-status').textContent,/存在静态配平解.*力残差.*力矩残差.*动态恢复未据此判定/);assert.equal($('trim-forces').querySelectorAll('tr').length,10);assert.equal($('trim-export').disabled,false);
click('#trim-export');await awaitExport(document,{advance:exportTurn});const trimExport=JSON.parse(await lastBlob.text());assert.equal(trimExport.modelVersion,MODEL_VERSION);assert.equal(trimExport.modelBuildId,MODEL_BUILD_ID);assert.equal(trimExport.sourceIdentityStatus,'matched-current-build');assert.equal(trimExport.sourceCommit,deploymentFixture.sourceCommit);assert.equal(trimExport.sourceTree,deploymentFixture.sourceTree);assert.equal(trimExport.physical.schema,'roadster-sim-state');assert.equal(trimExport.trim.staticFeasible,true);assert.equal(trimExport.trim.dynamicRecovery,'not-evaluated');assert.ok(trimExport.trim.forceResidualN<=.05&&trimExport.trim.torqueResidualNm<=.05);assert.equal(numerical(state()),trimBefore);
const clearance=JSON.parse($('hud-clearance').dataset.estimate);assert.equal(clearance.estimate,true);assert.equal(clearance.recoveryHeightM,null);assert.equal(clearance.rangeM,8);assert.ok(Math.abs(clearance.worldCgHeightM-state().heightWorld)<1e-9);assert.ok(clearance.hullDistances.down.distanceM>0);assert.ok(clearance.hullDistances.down.distanceM<clearance.centreDownDistanceM);assert.equal(clearance.distances.down.distanceM,0);assert.match($('hud-flight').textContent,/世界重心 H/);assert.ok($('hud-flight').textContent.includes(state().heightWorld.toFixed(1)));assert.match($('hud-clearance').textContent,/车壳下估计.*整车上方.*含轮胎下方/);assert.match($('hud-clearance').title,/不是可用恢复高度/);
values.trimAndClearance={scope:'Actual main DOM and numerical API; no camera or pixel evidence',trimText:$('trim-status').textContent,forceResidualN:trimExport.trim.forceResidualN,torqueResidualNm:trimExport.trim.torqueResidualNm,rows:10,physicalStateUnchanged:true,exportContainsCompletePhysical:true,worldCgHeightM:clearance.worldCgHeightM,centreDownDistanceM:clearance.centreDownDistanceM,hullDownEstimateM:clearance.hullDistances.down.distanceM,includingTyresDownEstimateM:clearance.distances.down.distanceM,worldLabel:$('hud-flight').textContent,clearanceLabel:$('hud-clearance').textContent};
tap('Escape');assert.equal(state().paused,true);tap('KeyP');assert.equal(state().paused,false);
pass('Static trim inspect/export preserves physics, reports residuals and limited claims, while HUD separates world CG height from estimated hull and tyre clearance');


key('KeyW');tick(30);key('KeyW',{type:'keyup'});tick(1);
const cityBefore=numerical(state()),cityScene=graphics.environments[0].scene.uuid,urlBefore=window.location.href;
click('#context-switch');await renderingReady();assert.equal(state().context,'lab');assert.equal(state().worldType,'windlab');assert.equal(state().research.open,true);assert.equal(state().paused,false);tick(60);
assert.equal(window.location.href,urlBefore);assert.equal(document.querySelectorAll('#viewport canvas').length,1);
assert.equal(graphics.environments.length,2);const labEnvironment=graphics.environments[1];assert.ok(labEnvironment.updates>0);assert.equal(graphics.rendered.at(-1),labEnvironment.scene.uuid);
assert.equal(window.roadsterLab.getGeometry().some(item=>item.kind==='arch'),false);
click('#context-switch');await renderingReady();assert.equal(state().context,'city');assert.equal(numerical(state()),cityBefore,'Entering and simulating the lab must not advance or teleport the saved city vehicle');tick(1);assert.equal(graphics.rendered.at(-1),cityScene);
values.contexts={cityGeometry:window.roadsterLab.getGeometry().length,labGeometry:24,viewports:document.querySelectorAll('#viewport canvas').length,cityStatePreserved:true,navigationChanged:false};
pass('City/lab switching keeps one document and renderer, uses isolated real physics worlds, preserves the city vehicle state and routes drawing to the active scene');

for(const quality of ['high','ultra','balanced']){
  $('quality').value=quality;$('quality').dispatchEvent(new window.Event('change',{bubbles:true}));await renderingReady();tick(1);
  assert.equal(state().quality,quality);assert.equal(graphics.environments[0].quality,quality);
  const composer=graphics.composers[0];assert.equal(composer.passes.some(pass=>pass instanceof MockContactAO),quality!=='balanced');
  click('#context-switch');await renderingReady();tick(1);assert.equal(state().context,'lab');assert.equal(labEnvironment.quality,quality);assert.equal(composer.passes.some(pass=>pass instanceof MockContactAO),false,'City contact AO must not run in the lab');
  assert.equal(graphics.cars[1].quality,quality);click('#context-switch');await renderingReady();tick(1);assert.equal(state().context,'city');assert.equal(graphics.cars[0].quality,quality);
  if(quality!=='balanced')assert.equal(composer.passes.find(pass=>pass instanceof MockContactAO).scene.uuid,cityScene);
}
pass('All three quality changes and context round trips update the active car/environment and restore city AO to the right scene while keeping it disabled in the lab');

// Reproduce a still-pending shader compilation: changing weather used to
// dispose the program polled by Three.js and leave preparation stuck forever.
let releaseCompile;graphics.compileGate=new Promise(resolve=>releaseCompile=resolve);
$('quality').value='high';$('quality').dispatchEvent(new window.Event('change',{bubbles:true}));
const beforePreparation=numerical(state()),weatherBeforePreparation=graphics.environments[0].weatherPreset;
tick(1);await new Promise(resolve=>setImmediate(resolve));
assert.equal($('engineering-drawer').inert,true);assert.equal($('render-prepare-progress').classList.contains('hidden'),false);
$('weather-preset').value='wet-night';$('weather-preset').dispatchEvent(new window.Event('change',{bubbles:true}));
click('#context-switch');tap('KeyR');tap('KeyH');tick(4);
assert.equal(state().context,'city');assert.equal(graphics.environments[0].weatherPreset,weatherBeforePreparation);assert.equal(numerical(state()),beforePreparation);
graphics.compileGate=null;releaseCompile();await renderingReady();assert.notEqual($('engineering-drawer').inert,true);
$('weather-preset').value=weatherBeforePreparation;
values.preparationInteraction={pendingCompiler:true,weatherMutationBlocked:true,contextMutationBlocked:true,physicalSnapshotPreserved:true,controlsRestored:true};
pass('Pending shader preparation blocks weather, context and keyboard mutations, preserves the complete physical state and restores usable controls');

click('[data-research-console]');click('[data-rc-tab="programs"]');const input=q('[data-rc="program-name"]');assert.ok(input);input.focus();assert.equal(document.activeElement,input,'Typing test must focus the visible program editor');
const modeBefore=state().stabilizationMode;key('Digit1',{target:input});key('KeyG',{target:input});key('Digit3',{target:input});key('KeyW',{target:input});tick(1);
assert.equal(state().driverInput.pitch,0);assert.equal(state().driverInput.throttle,0);assert.equal(state().stabilizationMode,modeBefore);assert.equal(state().research.running,false);
for(const code of ['Digit1','KeyG','Digit3','KeyW'])key(code,{type:'keyup',target:input});
$('viewport').focus();key('KeyW');tick(1);assert.equal(state().driverInput.throttle,1);input.focus();tick(1);assert.equal(state().driverInput.throttle,0,'Editing focus must release previously held driving keys');key('KeyW',{type:'keyup',target:input});
pass('Actual form-focus events suppress driving, stabilization and saved-program shortcuts, and clear a previously held throttle');

input.value='DOM 集成姿态阶跃';input.dispatchEvent(new window.Event('change',{bubbles:true}));
const binding=q('[data-rc="program-shortcut"]');binding.value='Digit8';binding.dispatchEvent(new window.Event('change',{bubbles:true}));click('[data-rc-action="save-program"]');
assert.ok(state().research.savedPrograms.some(program=>program.shortcut==='Digit8'));
$('viewport').focus();tap('Digit8');tick(30);assert.equal(state().research.running,true,JSON.stringify({toast:$('toast').textContent,research:state().research}));assert.equal(state().stabilizationMode,'hold');assert.equal(state().mode,'hover');
click('[data-rc-action="observe"]');assert.equal(document.body.classList.contains('research-open'),false);const researchBeforeHudPause=state().research,programPausedPhysical=numerical(state());click('#operation-pause');tick(12);assert.equal(state().paused,true);assert.equal(state().research.running,true);assert.equal(state().stabilizationMode,'hold');assert.equal(numerical(state()),programPausedPhysical);
for(const field of ['id','stage','stageCount','stageType','elapsedS','stageElapsedS','stageDurationS','settledS','target','gasThroughputKg','finiteRecovery'])assert.equal(JSON.stringify(state().research[field]),JSON.stringify(researchBeforeHudPause[field]),'Pausing observation must retain program '+field);
for(const field of ['recording','stepCount','durationS'])assert.equal(state().research.experiment[field],researchBeforeHudPause.experiment[field]);assert.ok(state().research.experiment.eventCount>researchBeforeHudPause.experiment.eventCount,'The live record must retain the pause and input-release events without advancing its physical samples');
click('#operation-pause');assert.equal(state().paused,false);assert.equal(state().research.running,true);assert.equal(state().stabilizationMode,'hold');assert.equal(numerical(state()),programPausedPhysical);values.operationPlayback.researchOwnerPreserved=true;
key('Digit1');tick(1);assert.equal(state().research.running,false,'Pilot pitch must cancel the custom program');assert.equal(state().driverInput.pitch,1);key('Digit1',{type:'keyup'});tick(1);
click('#context-switch');await renderingReady();tick(1);$('viewport').focus();tap('Numpad8');tick(30);assert.equal(state().research.running,true);assert.equal(state().context,'lab');
click('[data-rc-action="stop"]');tick(1);assert.equal(state().research.running,false);
values.programs={savedShortcut:'Digit8',sameProgramRunsInCityAndLab:true,physicalTargetTrackingInvoked:true,pilotTakeoverCancels:true};
pass('The actual editor persists a custom shortcut, runs its real force-controlled program in both scenes and yields immediately to pilot pitch or the stop control');


click('[data-rc-action="study"]');assert.equal(state().paused,true);assert.equal(document.body.classList.contains('study-open'),true);
tap('Escape');assert.equal(document.body.classList.contains('study-open'),false);assert.equal(state().paused,false);
await settle(()=>!!study(),'The actual lazy study module must resolve after an immediate close');
assert.equal(study().hidden,true);assert.equal($('research-study-root').classList.contains('hidden'),true);
assert.equal(document.querySelectorAll('.research-study-panel').length,1);assert.equal(document.querySelectorAll('link[data-roadster-study-styles]').length,1);
pass('Closing the advanced study while its real lazy import is pending does not reopen a late panel or duplicate its DOM/styles');

click('[data-study-panel]');await settle(()=>study()&&!study().hidden,'Advanced study must reopen from the engineering control');
assert.equal(state().paused,true);assert.equal(state().research.open,false);
const pausedNumerical=numerical(state()),paramsBefore=JSON.stringify(window.roadsterLab.getParameters()),studyMode=state().stabilizationMode;
tick(120);assert.equal(numerical(state()),pausedNumerical,'The active 3D vehicle must not advance while the advanced numerical study is open');
let studyInput=study().querySelector('[data-study-id="lab-param-dryMass"]');assert.ok(studyInput);studyInput.focus();
studyInput.value='3100';studyInput.dispatchEvent(new window.Event('change',{bubbles:true}));
for(const target of [studyInput,$('viewport')])for(const code of ['KeyW','Digit1','KeyG','Digit8']){key(code,{target});key(code,{type:'keyup',target});}
tick(1);assert.equal(numerical(state()),pausedNumerical);assert.equal(state().stabilizationMode,studyMode);assert.equal(state().research.running,false);
assert.equal(JSON.stringify(window.roadsterLab.getParameters()),paramsBefore,'Study form edits must not mutate the live vehicle parameters');
click('[data-study-id="lab-current"]');studyInput=study().querySelector('[data-study-id="lab-param-dryMass"]');assert.equal(+studyInput.value,window.roadsterLab.getParameters().dryMass);
assert.equal(JSON.stringify(window.roadsterLab.getParameters()),paramsBefore);assert.equal(numerical(state()),pausedNumerical);
key('Escape',{target:studyInput});key('Escape',{type:'keyup',target:studyInput});
assert.equal(study().hidden,true);assert.equal(state().paused,false);assert.equal(document.body.classList.contains('body-menu'),false,'Panel Escape must not also open the driving menu');
tick(1);assert.notEqual(numerical(state()),pausedNumerical);
pass('Actual advanced-study DOM pauses the live vehicle, isolates form parameters and driving shortcuts, copies current parameters without mutation, then resumes exactly once on Escape');

click('#pause-btn');assert.equal(state().paused,true);const alreadyPaused=numerical(state());
click('[data-study-panel]');await settle(()=>!study().hidden,'Study must open while the vehicle is already paused');tick(30);
click('[data-study-id="study-close"]');assert.equal(state().paused,true);assert.equal(numerical(state()),alreadyPaused);
click('#pause-btn');assert.equal(state().paused,false);
click('[data-study-panel]');await settle(()=>!study().hidden,'Reused study panel must reopen');
click('#context-switch');await renderingReady();assert.equal(state().context,'city');assert.equal(study().hidden,true);assert.equal(document.body.classList.contains('study-open'),false);assert.equal(state().paused,false);
tick(1);assert.equal(graphics.rendered.at(-1),cityScene);assert.equal(document.querySelectorAll('#viewport canvas').length,1);assert.equal(window.location.href,urlBefore);
values.advancedStudy={actualModule:true,lazyCloseRaceHandled:true,activeVehiclePaused:true,parametersReadOnlyToLiveVehicle:true,priorPausePreserved:true,sceneSwitchClosesPanel:true,panelInstances:document.querySelectorAll('.research-study-panel').length,workerExecutionTested:false};
pass('Closing the study preserves an existing pause, and switching back to the city closes the reused panel and restores the correct single-viewport scene');


// The physical road, wing and visual controls must reach the same active sim.
$('road-surface').value='wet';$('road-surface').dispatchEvent(new window.Event('change',{bubbles:true}));
$('abs-enabled').checked=false;$('abs-enabled').dispatchEvent(new window.Event('change',{bubbles:true}));
$('wing-mode').value='fixed';$('wing-mode').dispatchEvent(new window.Event('change',{bubbles:true}));$('wing-command').value='75';$('wing-command').dispatchEvent(new window.Event('change',{bubbles:true}));
$('weather-preset').value='wet-night';$('weather-preset').dispatchEvent(new window.Event('change',{bubbles:true}));await renderingReady();tick(20);
assert.equal(window.roadsterLab.getParameters().roadSurface,'wet');assert.equal(window.roadsterLab.getParameters().absEnabled,false);assert.equal(state().wing.command,.75);assert.ok(state().wing.deployment>0);
assert.equal(graphics.environments[0].weatherPreset,'wet-night');assert.equal(graphics.environments[0].vehicleRoot,graphics.cars[0].group);assert.ok(graphics.cars[0].viewBudget.height>0);
click('#benchmark-route-start');assert.ok(Math.abs(state().position.x+200)<1e-12);assert.ok(Math.abs(state().position.z+390)<1e-12);assert.equal(state().paused,true);
$('benchmark-camera').value='weave-entry';$('benchmark-camera').dispatchEvent(new window.Event('change',{bubbles:true}));tick(2);assert.equal(state().cameraMode,'fixed');
click('#visual-capture-metadata');await awaitExport(document,{advance:exportTurn});const conditions=JSON.parse(await lastBlob.text());assert.equal(conditions.camera.id,'weave-entry');assert.equal(conditions.weatherPreset,'wet-night');assert.equal(conditions.simState.schema,'roadster-sim-state');
assert.deepEqual(conditions.camera.target,CITY_BENCHMARK_ROUTE.cameras.find(c=>c.id==='weave-entry').target);assert.equal(conditions.camera.targetMeaning,'fixed preset look-at');
pass('Road adhesion, actual ABS and wing controls route to physics; weather, screen-size LOD and fixed route camera metadata route to the active presentation');

// Validate collection semantics with a renderer facade, never pixel quality.
click('#exposure-baseline-39');tick(2);assert.equal($('exposure-lock').checked,true);assert.equal($('auto-exposure').disabled,true);
click('#visual-capture-metadata');await awaitExport(document,{advance:exportTurn});const locked=JSON.parse(await lastBlob.text());assert.equal(locked.exposureLock,1.02);assert.equal(locked.exposure,1.02);
$('weather-preset').value='clear-day';$('weather-preset').dispatchEvent(new window.Event('change',{bubbles:true}));await renderingReady();tick(2);
click('#visual-capture-metadata');await awaitExport(document,{advance:exportTurn});const dayLocked=JSON.parse(await lastBlob.text());assert.equal(dayLocked.exposureLock,1.02);assert.equal(dayLocked.exposure,1.02);
$('weather-preset').value='wet-night';$('weather-preset').dispatchEvent(new window.Event('change',{bubbles:true}));await renderingReady();
click('#visual-capture-bundle');
// Paused rendering is capped at 30 Hz. Two binary floating-point 60 Hz ticks
// can land just below the next permitted frame; keep RAF moving until that
// real main render callback occurs instead of relying on a phase coincidence.
for(let frame=0;frame<6&&lastBlob?.type!=='application/zip';frame++){tick(1,40);await new Promise(resolve=>setImmediate(resolve));}
await settle(()=>lastBlob?.type==='application/zip','Same-frame archive must finish');
const zip=new Uint8Array(await lastBlob.arrayBuffer()),zipView=new DataView(zip.buffer),zipEntries={};let zipOffset=0;
while(zipView.getUint32(zipOffset,true)===0x04034b50){const size=zipView.getUint32(zipOffset+18,true),nameLength=zipView.getUint16(zipOffset+26,true),extraLength=zipView.getUint16(zipOffset+28,true),name=new TextDecoder().decode(zip.slice(zipOffset+30,zipOffset+30+nameLength));const start=zipOffset+30+nameLength+extraLength;zipEntries[name]=zip.slice(start,start+size);zipOffset=start+size;}
const metadataName=Object.keys(zipEntries).find(name=>name.endsWith('.json')),sameFrame=JSON.parse(new TextDecoder().decode(zipEntries[metadataName]));
assert.equal(sameFrame.camera.id,'weave-entry');assert.equal(sameFrame.exposureLock,1.02);assert.equal(sameFrame.paused,true);assert.equal(sameFrame.renderState,'paused-preview');assert.ok(zipEntries[sameFrame.capture.imageFile]);assert.equal(sameFrame.capture.conditionsFile,metadataName);
assert.equal(new TextDecoder().decode(zipEntries[sameFrame.capture.imageFile]),'DOM facade: no pixels');
values.captureArchive={scope:'DOM renderer facade and ZIP structure only; no rendered pixels',entries:Object.keys(zipEntries),sameFrameConditions:true,exposureLockPersistsAcrossWeather:true};
pass('Image archive pairs the rendered-frame callback with frozen conditions, and an explicit exposure lock survives weather changes; no pixel assertion is made');

// Exercise the actual main.js matrix with real physics and a deliberately
// non-drawing renderer. Advancing the fake clock must not cost 15 real seconds
// or turn the mock's ordinary render callback into a claimed WebGL draw.
const readVisualConditions=async()=>{click('#visual-capture-metadata');await awaitExport(document,{advance:exportTurn});return JSON.parse(await lastBlob.text());};
const mutationFingerprint=()=>JSON.stringify({numerical:numerical(state()),mode:state().mode,maneuver:state().maneuver,suctionEnabled:state().suctionEnabled,stabilizationMode:state().stabilizationMode,params:window.roadsterLab.getParameters()});
async function checkProgramMatrix(label){
  const before=await readVisualConditions(),beforeFingerprint=mutationFingerprint(),qualityPreference=window.localStorage.getItem('roadster-quality'),menuBefore=document.body.classList.contains('body-menu');
  const criticalControls=['pause-btn','operation-pause','reset-btn','context-switch','render-program-matrix','render-program-capture','render-program-driving'].map(id=>[id,$(id).disabled]);
  const startedAt=nowMs,wallStart=performance.now();lastBlob=null;click('#render-program-matrix');assert.equal($('render-program-matrix').disabled,true,'Matrix must enter its exclusive capture interval');
  let frames=0,attempts=0;
  const attemptMutations=()=>{
    for(const code of ['KeyP','KeyH','KeyX','KeyR','KeyG','KeyW','KeyE','KeyZ','Digit1','KeyC']){const event=key(code);assert.equal(event.defaultPrevented,true,'Capture did not intercept '+code);key(code,{type:'keyup'});attempts++;}
    for(const id of ['pause-btn','operation-pause','reset-btn','roll-btn','refill-btn','suction-btn','context-switch']){const event=new window.MouseEvent('click',{bubbles:true,cancelable:true});$(id).dispatchEvent(event);assert.equal(event.defaultPrevented,true,'Capture-phase guard did not intercept '+id);attempts++;}
    for(const [id,type] of [['quality','change'],['vertical-speed-command','input']]){const event=new window.Event(type,{bubbles:true,cancelable:true});$(id).dispatchEvent(event);assert.equal(event.defaultPrevented,true);attempts++;}
    const pointer=new window.Event('pointerdown',{bubbles:true,cancelable:true});$('viewport').querySelector('canvas').dispatchEvent(pointer);assert.equal(pointer.defaultPrevented,true);attempts++;
    $('exposure-lock-value').dispatchEvent(new window.FocusEvent('focusin',{bubbles:true}));window.dispatchEvent(new window.Event('blur'));attempts+=2;
    const hiddenDescriptor=Object.getOwnPropertyDescriptor(document,'hidden');Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new window.Event('visibilitychange'));
    if(hiddenDescriptor)Object.defineProperty(document,'hidden',hiddenDescriptor);else delete document.hidden;document.dispatchEvent(new window.Event('visibilitychange'));attempts++;
    assert.equal(mutationFingerprint(),beforeFingerprint,'An input or click mutated the physical/controller state during a matrix');assert.equal(state().paused,true);
  };
  attemptMutations();
  for(;frames<300&&$('render-program-matrix').disabled;frames++){
    // One virtual 250 ms slice services RAF, fade timers and then every queued
    // promise/blob continuation. No wall-clock sleep and no physics mock.
    tick(1,250);await new Promise(resolve=>setImmediate(resolve));
    if($('render-program-matrix').disabled){assert.equal(mutationFingerprint(),beforeFingerprint);assert.equal(state().paused,true);assert.equal($('operation-pause').disabled,true,'HUD updates must not re-enable resume during the matrix');if(frames%9===0)attemptMutations();}
  }
  assert.equal($('render-program-matrix').disabled,false,'Matrix did not restore controls after its frames/archive completed');assert.equal(mutationFingerprint(),beforeFingerprint);
  await settle(()=>lastBlob?.type==='application/zip','Restored matrix must finish packaging its diagnostic archive');const entries=await storedZipEntries(lastBlob),matrix=JSON.parse(new TextDecoder().decode(entries['gpu-switch-matrix.json']));
  assert.equal(matrix.status,'failed','A renderer facade without linked draws must never pass a GPU gate');assert.equal(matrix.physicsUnchanged,true);assert.equal(matrix.cases.length,14);assert.equal(matrix.completedFrames,14);assert.equal(matrix.expectedFrames,14);assert.equal(matrix.executionStatus,'completed');assert.equal(matrix.drawStatus,'failed');assert.equal(Object.keys(entries).length,30);
  const expected=[['high','clear-day'],['high','wet-night'],['ultra','wet-night'],['ultra','clear-day'],['balanced','wet-night'],['high','wet-night'],['ultra','wet-night']];
  for(let i=0;i<matrix.cases.length;i++){
    const item=matrix.cases[i],condition=JSON.parse(new TextDecoder().decode(entries[item.conditionsFile]));
    assert.deepEqual([condition.quality,condition.weatherPreset],expected[Math.floor(i/2)]);assert.equal(condition.paused,true);assert.equal(condition.renderState,'paused-preview');assert.deepEqual(condition.simState,before.simState);
    assert.equal(condition.camera.viewOffset,null,'Diagnostic frames must use an uncropped camera');
    for(const report of [item.paused,item.export]){assert.equal(report.status,'failed');assert.equal(report.drawCalls,0);assert.equal(report.programCount,0);assert.ok(report.failures.includes('no-observed-draw-calls'));assert.ok(report.failures.some(f=>f.startsWith('required-category-not-drawn:')));}
    assert.equal(new TextDecoder().decode(entries[item.imageFile]),'DOM facade: no pixels');
  }
  assert.match($('render-program-status').textContent,/失败/);assert.equal(state().paused,before.paused);assert.equal(document.body.classList.contains('body-menu'),menuBefore);
  assert.equal(window.localStorage.getItem('roadster-quality'),qualityPreference,'Temporary quality changes must not overwrite the saved preference');
  for(const [id,disabled] of criticalControls)assert.equal($(id).disabled,disabled,id+' was not restored');
  const after=await readVisualConditions();for(const key of ['quality','weatherPreset','exposureLock','exposure','autoExposure','route','camera','simState'])assert.deepEqual(after[key],before[key],label+' failed to restore '+key);
  await renderingReady();
  return{label,scope:'Actual main DOM handlers with real physics and a non-drawing renderer facade; no GPU/pixel validation',virtualElapsedMs:nowMs-startedAt,wallElapsedMs:performance.now()-wallStart,virtualFrames:frames,interceptedMutationAttempts:attempts,cases:matrix.cases.length,reportedStatus:matrix.status,physicsUnchanged:matrix.physicsUnchanged,failures:[...new Set(matrix.cases.flatMap(c=>c.paused.failures))],restoredCameraMode:after.camera.mode,restoredViewOffset:after.camera.viewOffset,restoredPaused:after.paused};
}
$('exposure-lock-value').value='1.17';$('exposure-lock-value').dispatchEvent(new window.Event('change',{bubbles:true}));
const fixedMatrix=await checkProgramMatrix('paused fixed camera with a custom exposure lock');
click('#pause-btn');assert.equal(state().paused,false);if(state().stabilizationMode!=='off')tap('KeyG');
key('KeyE');tick(60);key('Digit1');tick(8);key('KeyE',{type:'keyup'});key('Digit1',{type:'keyup'});
const airborneInputSnapshot=await readVisualConditions();
assert.equal(state().mode,'hover');assert.equal(state().stabilizationMode,'off');assert.ok(state().position.y>1,'E/1 fixture must actually be airborne');
assert.equal(airborneInputSnapshot.simState.state._lastInput.lift,1);assert.equal(airborneInputSnapshot.simState.state._lastInput.pitch,1);
assert.notDeepEqual(airborneInputSnapshot.simState.state._manualQuaternionTarget,airborneInputSnapshot.simState.body.quaternion,'Accepted pitch must leave a real leading reference to protect');
const airborneMatrix=await checkProgramMatrix('airborne manual E/1 reference and nonzero last physical input');
values.airborneMatrix={...airborneMatrix,inputBefore:airborneInputSnapshot.simState.state._lastInput,referenceBefore:airborneInputSnapshot.simState.state._manualQuaternionTarget};
pass('Matrix preserves the complete airborne E/1 snapshot through focus, blur and hidden events, including accepted input and leading attitude reference');
click('#pause-btn');assert.equal(state().paused,true);

click('#pause-btn');assert.equal(state().paused,false);click('#camera-btn');assert.equal(state().cameraMode,'orbit');click('[data-research-console]');tick(2);
const beforeOffsetMatrix=await readVisualConditions();assert.ok(beforeOffsetMatrix.camera.viewOffset?.enabled,'The actual open research sidebar must create the offset fixture');
const offsetMatrix=await checkProgramMatrix('running orbit camera with the research sidebar offset');
values.programMatrix={scope:'DOM state and negative gate semantics only; no WebGL implementation',runs:[fixedMatrix,airborneMatrix,offsetMatrix],mockDrawsNeverPass:true,originalPhysicalStatePreserved:true,keyboardAndCapturePhaseClickGuards:true};
pass('Actual GPU-matrix UI freezes real physics against P/H/X/R, driving and synthetic click events, restores fixed/offset cameras and presentation, and reports failed for no draws');

// A resource request can remain pending. Its wait must time out before the
// first diagnostic draw and release the real UI/physics capture transaction.
const cityEnvironment=graphics.environments.find(e=>e.scene.userData.qaContext==='city'),savedReady=cityEnvironment.ready;
if(!state().paused)click('#pause-btn');
const timeoutBefore=await readVisualConditions(),timeoutFingerprint=mutationFingerprint(),timeoutBlob=lastBlob;
const timeoutControlStates=['pause-btn','operation-pause','reset-btn','context-switch','render-program-matrix','render-program-capture','render-program-driving'].map(id=>[id,$(id).disabled]);
try{
  cityEnvironment.ready=new Promise(()=>{});click('#render-program-matrix');
  assert.equal($('render-program-matrix').disabled,true);assert.equal(state().paused,true);
  await new Promise(resolve=>setImmediate(resolve));tick(1,20001);
  await settle(()=>!$('render-program-matrix').disabled&&lastBlob!==timeoutBlob&&lastBlob?.type==='application/zip','The bounded resource timeout must restore the UI and finish an explicitly failed evidence ZIP');
  const timeoutArchive=lastBlob,entries=await storedZipEntries(timeoutArchive),manifest=JSON.parse(new TextDecoder().decode(entries['gpu-switch-matrix.json']));
  assert.equal(manifest.status,'failed');assert.equal(manifest.executionStatus,'failed');assert.equal(manifest.drawStatus,'incomplete');assert.equal(manifest.expectedFrames,14);assert.equal(manifest.completedFrames,0);assert.equal(manifest.cases.length,0);assert.equal(manifest.physicsUnchanged,true);assert.equal(manifest.modelVersion,MODEL_VERSION);assert.equal(manifest.modelBuildId,MODEL_BUILD_ID);assert.equal(manifest.sourceCommit,deploymentFixture.sourceCommit);assert.equal(manifest.sourceTree,deploymentFixture.sourceTree);assert.equal(Object.keys(entries).filter(name=>name.endsWith('.png')).length,0);assert.equal(Object.keys(entries).length,2);assert.match(manifest.failure.message,/20 秒内未就绪/);
  // Retain the original assertion failure as an explicit contract revision:
  // failed 0/14 diagnostics are useful evidence; they are never a success ZIP.
  let retiredGateFailure=null;try{assert.equal(timeoutArchive,timeoutBlob,'No fake success archive may be emitted before resources become ready');}catch(error){retiredGateFailure={name:error.name,code:error.code,message:error.message,previousAssertion:'lastBlob === timeoutBlob',actualArchiveType:timeoutArchive.type};}
  assert.ok(retiredGateFailure,'The changed failure-output contract must be recorded, not silently remove the old assertion');
  const timeoutMessage=$('render-program-status').textContent;assert.match(timeoutMessage,/20 秒内未就绪/);assert.match(timeoutMessage,/0 \/ 14/);assert.match(timeoutMessage,/未通过/);assert.equal(mutationFingerprint(),timeoutFingerprint);
  for(const[id,disabled]of timeoutControlStates)assert.equal($(id).disabled,disabled,'Timeout did not restore '+id);assert.equal($('render-program-progress').classList.contains('hidden'),true);assert.equal($('render-program-cancel').disabled,true);
  const timeoutAfter=await readVisualConditions();for(const key of ['quality','weatherPreset','exposureLock','exposure','autoExposure','route','camera','simState'])assert.deepEqual(timeoutAfter[key],timeoutBefore[key],'Readiness timeout failed to restore '+key);
  assert.equal(state().paused,timeoutBefore.paused);
  // Verify exact transaction restoration before ordinary camera updates resume.
  // Those later updates may settle from the last interpolated render pose to
  // the paused physical pose; the persistent failure message is independent.
  tick(5,250);await new Promise(resolve=>setImmediate(resolve));assert.equal($('render-program-status').textContent,timeoutMessage,'Generic later completion/ready messages must not replace the original timeout');assert.equal(mutationFingerprint(),timeoutFingerprint);
  values.programMatrix.readinessTimeout={boundedMs:20000,physicalStateUnchanged:true,presentationRestored:true,archive:{status:manifest.status,executionStatus:manifest.executionStatus,drawStatus:manifest.drawStatus,expectedFrames:manifest.expectedFrames,completedFrames:manifest.completedFrames,pngCount:0,entries:Object.keys(entries),failure:manifest.failure},persistentMessage:timeoutMessage,contractRevision:{retainedOriginalFailure:retiredGateFailure,reason:'3.14 retains an explicitly failed 0/14 evidence archive instead of suppressing all output; no passing capture, invented frame or pixel evidence is allowed',replacementChecks:['failed execution','incomplete draw','0 of 14 frames','zero PNG entries','unchanged physics','original 20-second cause persists']}};
}finally{cityEnvironment.ready=savedReady;}
pass('A genuinely pending resource wait exports an explicitly failed 0/14 ZIP with zero PNGs, restores the UI/physics and keeps its original 20-second cause visible');

// Hold a real main.js PNG callback across many rendered facade frames, then
// cancel during the next callback. Only one request may be in flight and the
// completed prefix must survive; stale callbacks cannot start another capture.
const cancelBefore=await readVisualConditions(),cancelFingerprint=mutationFingerprint(),cancelControlStates=['pause-btn','operation-pause','reset-btn','context-switch','render-program-matrix','render-program-capture','render-program-driving'].map(id=>[id,$(id).disabled]);
const initialPngCalls=pngEncoderFixture.calls;pngEncoderFixture.defer=true;lastBlob=null;click('#render-program-matrix');
for(let frame=0;frame<40&&!pngEncoderFixture.pending.length;frame++){tick(1,250);await new Promise(resolve=>setImmediate(resolve));}
assert.equal(pngEncoderFixture.pending.length,1,'The first matrix PNG must be awaiting its deliberate callback');assert.equal(pngEncoderFixture.calls,initialPngCalls+1);assert.equal($('render-program-matrix').disabled,true);
for(let frame=0;frame<12;frame++){tick(1,250);await new Promise(resolve=>setImmediate(resolve));assert.equal(pngEncoderFixture.calls,initialPngCalls+1,'An in-flight PNG request must not be captured again on later RAFs');assert.equal(pngEncoderFixture.pending.length,1);assert.equal(mutationFingerprint(),cancelFingerprint);}
const blockedRestart=new window.MouseEvent('click',{bubbles:true,cancelable:true});$('render-program-matrix').dispatchEvent(blockedRestart);assert.equal(blockedRestart.defaultPrevented,true);assert.equal(pngEncoderFixture.calls,initialPngCalls+1);
pngEncoderFixture.pending.shift()();
for(let frame=0;frame<40&&!pngEncoderFixture.pending.length;frame++){tick(1,250);await new Promise(resolve=>setImmediate(resolve));}
assert.equal(pngEncoderFixture.pending.length,1);assert.equal(pngEncoderFixture.calls,initialPngCalls+2);assert.match($('render-program-progress-text').textContent,/1 \/ 14/);
const escaped=key('Escape');assert.equal(escaped.defaultPrevented,true);key('Escape',{type:'keyup'});
await settle(()=>!$('render-program-matrix').disabled&&lastBlob?.type==='application/zip','ESC must end matrix collection and archive the captured prefix');
const cancelledArchive=lastBlob,cancelEntries=await storedZipEntries(cancelledArchive),cancelled=JSON.parse(new TextDecoder().decode(cancelEntries['gpu-switch-matrix.json']));
assert.equal(cancelled.executionStatus,'cancelled');assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.completedFrames,1);assert.equal(cancelled.expectedFrames,14);assert.equal(cancelled.cases.length,1);assert.equal(cancelled.physicsUnchanged,true);assert.equal(cancelled.modelVersion,MODEL_VERSION);assert.equal(cancelled.modelBuildId,MODEL_BUILD_ID);assert.equal(cancelled.sourceCommit,deploymentFixture.sourceCommit);assert.equal(cancelled.sourceTree,deploymentFixture.sourceTree);assert.equal(cancelled.failure.name,'AbortError');assert.equal(cancelled.failure.completedFrames,1);assert.equal(Object.keys(cancelEntries).filter(name=>name.endsWith('.png')).length,1);assert.equal(Object.keys(cancelEntries).length,4);assert.equal(new TextDecoder().decode(cancelEntries[cancelled.cases[0].imageFile]),'DOM facade: no pixels');assert.equal(cancelled.cases[0].paused.status,'failed');assert.equal(cancelled.cases[0].export.status,'failed');
for(const[id,disabled]of cancelControlStates)assert.equal($(id).disabled,disabled,'ESC did not restore '+id);assert.equal($('render-program-progress').classList.contains('hidden'),true);assert.equal($('render-program-cancel').disabled,true);assert.equal(state().paused,cancelBefore.paused);assert.equal(mutationFingerprint(),cancelFingerprint);
const cancelMessage=$('render-program-status').textContent;assert.match(cancelMessage,/已取消/);assert.match(cancelMessage,/1 \/ 14/);
const cancelAfter=await readVisualConditions();for(const key of ['quality','weatherPreset','exposureLock','exposure','autoExposure','route','camera','simState'])assert.deepEqual(cancelAfter[key],cancelBefore[key],'ESC matrix cancellation failed to restore '+key);
const blobBeforeLateCallback=lastBlob;pngEncoderFixture.pending.shift()();pngEncoderFixture.defer=false;await new Promise(resolve=>setImmediate(resolve));tick(6,250);await new Promise(resolve=>setImmediate(resolve));assert.equal(lastBlob,blobBeforeLateCallback,'A late callback from the cancelled job must not initiate another download or finish another request');assert.equal(pngEncoderFixture.calls,initialPngCalls+2);assert.equal($('render-program-status').textContent,cancelMessage);assert.equal(mutationFingerprint(),cancelFingerprint);
values.programMatrix.cancelAndSlowPng={scope:'Actual matrix handlers with an intentionally delayed fake PNG encoder; no pixel/driver claim',heldEncoderAcrossFrames:12,encoderCalls:pngEncoderFixture.calls-initialPngCalls,duplicateCaptureRequests:0,manualRestartBlocked:true,executionStatus:cancelled.executionStatus,drawStatus:cancelled.drawStatus,completedFrames:cancelled.completedFrames,expectedFrames:cancelled.expectedFrames,pngCount:1,entries:Object.keys(cancelEntries),failure:cancelled.failure,physicalStateUnchanged:true,controlsRestored:true,lateCallbackIgnored:true,message:cancelMessage};
pass('Slow PNG callbacks stay single-flight; ESC retains a cancelled one-frame prefix, restores controls/physics and ignores a late encoder callback');

// Return the established fixture used by the following recorder/replay checks.
click('[data-rc-action="close"]');if(!state().paused)click('#pause-btn');
$('benchmark-camera').value='weave-entry';$('benchmark-camera').dispatchEvent(new window.Event('change',{bubbles:true}));click('#exposure-baseline-39');tick(2);

await renderingReady();click('#record-btn');tick(60);assert.equal(state().research.experiment.recording,true);click('#record-btn');
$('weather-preset').value='clear-day';$('weather-preset').dispatchEvent(new window.Event('change',{bubbles:true}));await renderingReady();
$('benchmark-camera').value='canal';$('benchmark-camera').dispatchEvent(new window.Event('change',{bubbles:true}));
click('#csv-btn');click('[data-ex-action="replay"]');await renderingReady();
// Wait for the recorded fixed-step protocol, not exactly 60 floating-point RAF
// deltas. The deliberately advanced matrix clock can shift a 120 Hz boundary
// by one callback without changing the saved inputs or replay result.
for(let frame=0;frame<72&&state().research.experiment.replaying;frame++)tick(1);
assert.equal(state().research.experiment.replaying,false);assert.equal(state().research.experiment.lastReplay.status,'completed');assert.equal(state().research.experiment.lastReplay.finalPositionErrorM,0);
assert.equal(graphics.environments[0].weatherPreset,'wet-night');assert.equal($('benchmark-camera').value,'weave-entry');assert.equal(state().cameraMode,'fixed');
click('[data-ex-action="record"]');tick(6);click('[data-ex-action="return-before-replay"]');assert.equal(state().research.experiment.recording,false);assert.equal(graphics.environments[0].weatherPreset,'clear-day');assert.equal($('benchmark-camera').value,'canal');
values.liveReplay={terminalPositionErrorM:0,initialWeatherRestored:true,initialFixedCameraRestored:true,returnStateConfigurationRestored:true,recordingEndedBeforeReturn:true};
pass('Actual main adapter replays the recorded fixed-step state with zero terminal position error, restores weather/camera, and ends a new recording before returning to the previous scene state');

await renderingReady();
$('road-surface').value='dry';$('road-surface').dispatchEvent(new window.Event('change',{bubbles:true}));
$('abs-enabled').checked=true;$('abs-enabled').dispatchEvent(new window.Event('change',{bubbles:true}));
$('control-capture-kind').value='steer-54';$('control-capture-kind').dispatchEvent(new window.Event('change',{bubbles:true}));
const captureStart=CONTROL_CAPTURE_STARTS[$('control-capture-kind').value];assert.equal(captureStart.protocolId,'steer-54');
click('#control-capture-reset');assert.deepEqual([state().position.x,state().position.y,state().position.z],captureStart.position);assert.equal(state().speedKmh,0);assert.equal(state().paused,true);assert.equal(state().research.experiment.recording,false);assert.equal($('control-capture-direction').value,String(captureStart.steerSign));
click('#control-capture-start');assert.equal(window.roadsterLab.getControlCapture().active,true,JSON.stringify(window.roadsterLab.getControlCapture())+' / '+$('toast').textContent);tick(30);assert.equal(state().research.experiment.recording,true);assert.equal($('control-capture-chip').classList.contains('hidden'),false);
key('KeyW');tick(2);key('KeyW',{type:'keyup'});assert.equal(window.roadsterLab.getControlCapture().active,false);assert.equal(state().research.experiment.recording,false);
click('#control-capture-export');await awaitExport(document,{advance:exportTurn});const capturedInputs=JSON.parse(await lastBlob.text());assert.equal(capturedInputs.status,'cancelled');assert.ok(capturedInputs.stepCount>0);assert.deepEqual(capturedInputs.initialSnapshot.physical.body.position.values,captureStart.position);assert.ok(capturedInputs.events.some(event=>event.type==='control_capture_start'));assert.ok(capturedInputs.inputRuns.some(run=>run.input.brake>0||run.input.throttle>0));
const beforeRejected=numerical(state());$('control-capture-kind').value='vertical-8-release';$('control-capture-kind').dispatchEvent(new window.Event('change',{bubbles:true}));assert.equal($('control-capture-reset').disabled,true);click('#control-capture-start');assert.equal(window.roadsterLab.getControlCapture().active,false);assert.equal(numerical(state()),beforeRejected);
click('#control-capture-export');await awaitExport(document,{advance:exportTurn});const rejected=JSON.parse(await lastBlob.text());assert.equal(rejected.status,'failed');assert.equal(rejected.stepCount,0);assert.ok(rejected.events.some(event=>event.type==='control_capture_clearance'));
values.controlCapture={scope:'Actual main input/recorder integration with numerical physics; renderer is stubbed',resetBeforeRecording:true,initialSpeedMps:0,manualTakeover:'cancelled',capturedSteps:capturedInputs.stepCount,invalidFlightCondition:'zero-step failed record'};
pass('The main capture controls reset only before recording, accelerate through ordinary inputs, preserve manual takeover, and retain failed preflight evidence without repositioning');

// This JSDOM document owns isolated storage. Reject only live-archive writes;
// no real user archive is read, cleared or removed, and all existing fixture
// records must survive byte-for-byte on disk and unchanged in session exports.
const liveRecordsModule=(await getModule(resolve(dist,'experiment-records.js'))).namespace,liveStorageKey=liveRecordsModule.EXPERIMENT_LIBRARY_KEY;
const oldLiveRaw=window.localStorage.getItem(liveStorageKey);assert.ok(oldLiveRaw,'A pre-existing live archive is required to test preservation');const oldDiskRecords=JSON.parse(oldLiveRaw).records;assert.ok(oldDiskRecords.length>0);
click('#csv-btn');click('[data-ex-action="export-all"]');await awaitExport(document,{advance:exportTurn});const beforeFailureRecords=JSON.parse(await lastBlob.text()).records,storagePrototype=Object.getPrototypeOf(window.localStorage),setItemDescriptor=Object.getOwnPropertyDescriptor(storagePrototype,'setItem'),writeFailures=[];
const livePersistenceCases=[];let rejection=null;
Object.defineProperty(storagePrototype,'setItem',{...setItemDescriptor,value:function(key,value){if(this===window.localStorage&&key===liveStorageKey&&rejection){writeFailures.push({name:rejection.name,message:rejection.message,key});throw new window.DOMException(rejection.message,rejection.name);}return setItemDescriptor.value.call(this,key,value);}});
try{
  for(const scenario of [{name:'QuotaExceededError',message:'QA isolated archive quota rejection',language:'zh'},{name:'SecurityError',message:'QA isolated archive write denial',language:'en'}]){
    rejection=scenario;$('language-select').value=scenario.language;$('language-select').dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
    const beforeCount=state().research.experiment.recordCount,beforeFailures=writeFailures.length;
    click('#record-btn');tick(18);assert.equal(state().research.experiment.recording,true);click('#record-btn');await new Promise(resolve=>setImmediate(resolve));
    const experiment=state().research.experiment,notice=q('[data-ex="persistence"]'),expectedToast=scenario.language==='en'?'The live experiment ended but is session only / unsaved. Export the complete result or archive; the previous archive was not overwritten.':'现场实验已结束，但仅本会话 / 未保存。请导出完整结果或整库；旧存档未覆盖。';
    assert.equal(experiment.recording,false);assert.equal(experiment.recordCount,beforeCount+1);assert.equal(writeFailures.length,beforeFailures+1,'The actual completed recording must attempt exactly one rejected archive write');assert.equal(experiment.persistence.sessionOnly,true);assert.equal(experiment.persistence.status,'unsaved');assert.equal(experiment.persistence.message,scenario.message);assert.ok(experiment.persistence.unsavedIds.includes(experiment.selectedId));
    assert.equal($('toast').textContent,expectedToast);assert.equal($('toast').classList.contains('hidden'),false);assert.doesNotMatch($('toast').textContent,/现场实验已保存|The live experiment (?:has been |was )?saved/i);assert.equal(notice.hidden,false);assert.match(notice.textContent,scenario.language==='en'?/session only \/ unsaved/i:/仅本会话 \/ 未保存/);assert.ok(notice.textContent.includes(scenario.message));assert.equal(window.localStorage.getItem(liveStorageKey),oldLiveRaw);
    const initialNotice=notice.textContent;click('#csv-btn');click('[data-ex-action="export-one"]');await awaitExport(document,{advance:exportTurn});const selectedText=await lastBlob.text(),selected=JSON.parse(selectedText);assert.equal(selected.id,experiment.selectedId);assert.equal(selected.status,'completed');assert.ok(selected.stepCount>0);assert.ok(selected.inputRuns.length>0);assert.ok(selected.initialSnapshot.physical);assert.ok(selected.finalSnapshot.physical);assert.equal(liveRecordsModule.parseExperimentArchive(selectedText).length,1,'The complete unsaved record must pass the normal import validator');
    click('[data-ex-action="export-all"]');await awaitExport(document,{advance:exportTurn});const sessionText=await lastBlob.text(),sessionArchive=JSON.parse(sessionText);assert.equal(sessionArchive.persistence.sessionOnly,true);assert.equal(sessionArchive.records.length,experiment.recordCount);assert.equal(liveRecordsModule.parseExperimentArchive(sessionText).length,experiment.recordCount);assert.deepEqual(sessionArchive.records.find(r=>r.id===selected.id),selected);
    for(const record of beforeFailureRecords)assert.deepEqual(sessionArchive.records.find(r=>r.id===record.id),record,'A rejected append must not mutate a previous in-memory record');
    const beforeExportedRecord=JSON.stringify(selected);tick(40,250);await new Promise(resolve=>setImmediate(resolve));assert.equal($('toast').classList.contains('hidden'),true,'Transient toast may expire, but persistence warning must not');assert.equal(notice.hidden,false);assert.equal(notice.textContent,initialNotice);assert.equal(state().research.experiment.persistence.sessionOnly,true);assert.equal(window.localStorage.getItem(liveStorageKey),oldLiveRaw);assert.deepEqual(JSON.parse(window.localStorage.getItem(liveStorageKey)).records,oldDiskRecords);
    click('[data-ex-action="export-one"]');await awaitExport(document,{advance:exportTurn});assert.equal(JSON.stringify(JSON.parse(await lastBlob.text())),beforeExportedRecord,'Later UI/physics updates must retain the complete session-only result');
    if(scenario.language==='en'){assert.ok(!/[\u3400-\u9fff]/u.test(expectedToast));assert.ok(!/[\u3400-\u9fff]/u.test(notice.textContent),'The persistent unsaved alert needs English too');}
    livePersistenceCases.push({error:scenario.name,language:scenario.language,rejectedWrites:writeFailures.length-beforeFailures,executionStatus:selected.status,persistenceStatus:experiment.persistence.status,selectedId:selected.id,stepCount:selected.stepCount,inputRuns:selected.inputRuns.length,fullRecordBytes:new TextEncoder().encode(selectedText).length,archiveRecords:sessionArchive.records.length,oldRawUnchanged:true,oldSessionRecordsUnchanged:true,exportPassesNormalImport:true,warningSurvivesToastExpiry:true,toast:expectedToast,persistentAlert:initialNotice});
  }
}finally{Object.defineProperty(storagePrototype,'setItem',setItemDescriptor);$('language-select').value='zh';$('language-select').dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));}
values.livePersistenceUI={scope:'Actual main record-button start/stop with isolated Storage prototype fault injection, actual recorder/export validator, no real user storage',oldDiskRecords:oldDiskRecords.length,oldRawSHA256:hashBytes(oldLiveRaw),oldRawBytes:new TextEncoder().encode(oldLiveRaw).length,cases:livePersistenceCases};
pass('Actual record-button quota/write failures keep old archive bytes, retain complete exportable session results and persistent bilingual warnings without a false saved toast');

click('#record-btn');tick(60);assert.equal(state().research.experiment.recording,true);
const physicalBeforeLoss=numerical(state());const canvas=$('viewport').querySelector('canvas');canvas.dispatchEvent(new window.Event('webglcontextlost',{cancelable:true}));
assert.equal(window.roadsterApp.getState().graphics.status,'context_lost');assert.equal(state().research.experiment.recording,false);tick(60);assert.equal(numerical(state()),physicalBeforeLoss);
assert.equal(state().paused,true);assert.ok(document.body.classList.contains('graphics-unavailable'));
values.contextLoss={livePhysicsStopped:true,recordingStopped:true,remainingViewportCanvases:document.querySelectorAll('#viewport canvas').length};
pass('A context-lost event stops live simulation and closes its recording while retaining the same application and local research history');
}else{
assert.equal(window.roadsterApp.getState().graphics.status,'unavailable');assert.equal(expectedGraphicsErrors.length,1);assert.equal(document.querySelectorAll('#viewport canvas').length,0);
await settle(()=>study()&&!study().hidden,'The ?view=lab entry must open numerical research after WebGL initialization fails');
values.initializationFailure={shellReady:true,graphicsUnavailable:true,viewportCanvases:0,queryLabOpened:true};
pass('Actual app.js initializes the research shell before a deliberately rejected WebGLRenderer and resolves ?view=lab to the same-page study');
}

assert.match($('render-stat-chip').textContent,/三维未运行/);assert.doesNotMatch($('render-stat-chip').textContent,/采样/);assert.match($('performance-label').textContent,/三维未运行/);
assert.equal($('graphics-status').classList.contains('hidden'),false);assert.equal($('error-screen').classList.contains('hidden'),true);
click('#graphics-open-records');assert.equal(window.roadsterApp.getState().research.open,true);assert.equal(q('[data-ex-action="record"]').disabled,true);assert.equal(q('[data-ex-action="replay"]').disabled,true);
assert.equal(window.roadsterApp.getState().research.experiment.liveAvailable,false);
if(!noGraphics){click('[data-ex-action="export-all"]');await awaitExport(document,{advance:exportTurn});const archive=JSON.parse(await lastBlob.text());assert.ok(archive.records.length>0);assert.equal(archive.records.at(-1).status,'failed');assert.match(archive.records.at(-1).reason,/图形上下文/);values.contextLoss.archiveRecords=archive.records.length;}
click('#graphics-open-study');await settle(()=>study()&&!study().hidden,'Numerical research must open without graphics');
const field=id=>study().querySelector('[data-study-id="'+id+'"]'),change=element=>element.dispatchEvent(new window.Event('change',{bubbles:true}));
field('lab-kind').value='brake';change(field('lab-kind'));field('lab-mode').value='single';change(field('lab-mode'));field('protocol-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
await settle(()=>workerRequests.length>0&&!field('lab-run').disabled,'Actual numerical worker facade must finish a standard braking study without graphics');
assert.ok(field('record-table').children.length>0);assert.equal(field('analysis-content').hidden,false);
field('export-rows').click();await awaitExport(document,{advance:exportTurn});const exported=await lastBlob.text();assert.ok(exported.includes('model='+MODEL_VERSION));assert.match(exported,/run_id,case,/);
field('export-library').click();await awaitExport(document,{advance:exportTurn});const library=JSON.parse(await lastBlob.text());assert.ok(library.entries.length>0);assert.ok(library.entries.at(-1).report.metrics.stop.distanceM>0);
values.noGraphicsResearch={actualSolver:true,workerRequests:workerRequests.length,records:library.entries.length,csvSelectedRecord:true,jsonLibrary:true,graphicsStatus:window.roadsterApp.getState().graphics.status};
pass('Without graphics, the same-page standard study executes the actual solver and keeps visible history, selected-record CSV and complete-library JSON usable');


// Locale is display-only, including lazily loaded numerical panels and exports.
const locale=(await getModule(resolve(dist,'i18n.js'))).namespace;
const beforeLocale=JSON.stringify(library.entries),beforeSnapshot=numerical(state());
$('language-select').value='en';$('language-select').dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
assert.equal(document.documentElement.lang,'en');assert.equal(window.localStorage.getItem('roadster-language'),'en');
assert.equal($('graphics-open-study').textContent,'Run numerical studies');assert.match($('render-stat-chip').textContent,/No frame-rate data/);
assert.ok(!/[\u3400-\u9fff]/u.test(field('lab-run').textContent),'Run must have English copy');
field('export-library').click();await awaitExport(document,{advance:exportTurn});assert.equal(JSON.stringify(JSON.parse(await lastBlob.text()).entries),beforeLocale,'Locale must not rewrite library data or identity');assert.equal(numerical(state()),beforeSnapshot);
const nodes=[],walk=document.createTreeWalker(document.body,4);let node;while((node=walk.nextNode())){if(node.parentElement?.closest('script,style,pre,code,textarea,[data-no-i18n]'))continue;const value=node.nodeValue?.trim();if(value&&/[\u3400-\u9fff]/u.test(value))nodes.push({text:value,parent:node.parentElement.tagName,id:node.parentElement.id});}
values.english={entries:locale.getTranslationDiagnostics().entries,patterns:locale.getTranslationDiagnostics().patterns,remainingChinese:nodes,missing:locale.getTranslationDiagnostics().missing};
if(process.env.ROADSTER_LOCALE_DIAGNOSTICS)await writeFile('/tmp/roadster-locale-diagnostics.json',JSON.stringify(values.english,null,2));
assert.equal(nodes.length,0,'Untranslated application text: '+JSON.stringify(nodes.slice(0,18)));
$('language-select').value='zh';$('language-select').dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));assert.equal(document.documentElement.lang,'zh-CN');assert.equal($('graphics-open-study').textContent,'运行标准数值研究');
pass('English reaches the actual main shell and lazy research UI, persists and switches back without changing snapshots or exported history');

const runtimeIdentityModule=await getModule(resolve(dist,'runtime-identity.js')),runtimeIdentity=runtimeIdentityModule.namespace.getRuntimeIdentity();
assert.ok(deploymentRequests.length>0,'The runtime identity network request must be explicitly covered');assert.equal(runtimeIdentity.sourceIdentityStatus,'matched-current-build');assert.equal(runtimeIdentity.modelVersion,MODEL_VERSION);assert.equal(runtimeIdentity.modelBuildId,MODEL_BUILD_ID);assert.equal(runtimeIdentity.sourceCommit,deploymentFixture.sourceCommit);assert.equal(runtimeIdentity.sourceTree,deploymentFixture.sourceTree);
values.runtimeIdentity={source:'explicit matching deployment fixture, not a deployed Git identity',response:deploymentFixture,requests:deploymentRequests,observed:JSON.parse(JSON.stringify(runtimeIdentity))};
pass('Runtime deployment identity fetch uses an explicit matching fixture and does not hide an unexpected-network rejection');

const cannonInstances=moduleConstructionCounts.get(resolve(dist,'vendor/cannon-es.js'))||0;
assert.equal(cannonInstances,1,'The real physics and snapshot modules must share one Cannon module instance');
values.moduleIdentity={cannonInstances,maximumInstancesPerCanonicalPath:Math.max(...moduleConstructionCounts.values())};
assert.equal(values.moduleIdentity.maximumInstancesPerCanonicalPath,1,'The QA loader must preserve browser module identity for every canonical path');
const hashes={};for(const filename of [...new Set([...loadedSources,...sourceSnapshots.keys(),'qa/same-page-ui-check.mjs'])].sort()){
  const current=hashBytes(await readFile(resolve(root,filename)));if(sourceSnapshots.has(filename))assert.equal(current,sourceSnapshots.get(filename),'Source changed during DOM execution; rerun after freezing '+filename);hashes[filename]=current;
}
const report={status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,generatedAt:new Date().toISOString(),checks,values,sourceHashes:hashes,
  environment:{node:process.version,jsdom:jsdomVersion,jsdomModule:jsdomPath,moduleEvaluation:'Actual app.js / app-shell.js / main.js and its non-visual dependency graph in vm.SourceTextModule',physics:'Actual RoadsterSim, no rigid-body/control mock',context:'JSDOM document only'},
  excluded:{browser:false,webgl:false,gpuTiming:false,pixelVisualQA:false,independentWorkerExecution:false,actualSolverThroughWorkerFacade:true},
  mocks:[...mocks.keys(),'deployment.json: explicit matching fixture','canvas.toBlob: fake bytes with optional deferred callback'],limits:'DOM interaction, controller integration and renderer/scene routing checks. Rendering, camera pixels, assets, shader execution, browser behavior, GPU performance and visual quality are not validated by these graphics mocks.'};
await writeFile(resolve(root,noGraphics?`qa/no-webgl-research-${REPORT_VERSION}.json`:`qa/same-page-ui-${REPORT_VERSION}.json`),JSON.stringify(report,null,2)+'\n');
dom.window.close();console.log(`Same-page UI: ${checks.length} DOM integration groups passed; no browser or visual acceptance performed.`);

dom.window.close();
