/** Optional DOM integration check. No browser, WebGL context or pixel output.
 * Run: JSDOM_MODULE_PATH=/path/to/jsdom/lib/api.js node --experimental-vm-modules qa/same-page-ui-check.mjs
 * jsdom is a developer-only optional dependency, not part of the static site.
 */
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname,relative} from 'node:path';
import * as NativeThree from '../dist/vendor/three.module.js';

if(typeof vm.SourceTextModule!=='function')throw new Error('Use node --experimental-vm-modules qa/same-page-ui-check.mjs');
const jsdomPath=process.env.JSDOM_MODULE_PATH||'/tmp/roadster-dom-qa/node_modules/jsdom/lib/api.js';
const {JSDOM,VirtualConsole}=await import(pathToFileURL(jsdomPath));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
const source=await readFile(resolve(dist,'index.html'),'utf8'),errors=[],checks=[],values={};
const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
const dom=new JSDOM(source,{url:'https://qa.invalid/roadster-flight-lab/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
const window=dom.window,document=window.document,context=dom.getInternalVMContext();
const $=id=>document.getElementById(id),q=selector=>document.querySelector(selector);
let nowMs=0,nextTimer=1,raf=[];const timers=new Map(),graphics={rendered:[],environments:[],cars:[],ao:[],composers:[]};
const noop=()=>{};
const canvasContext=canvas=>new Proxy({canvas,measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop}),getImageData:()=>({data:new Uint8ClampedArray(4)})},{get:(target,key)=>key in target?target[key]:noop,set:(target,key,value)=>(target[key]=value,true)});
window.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')throw new Error('GPU contexts are deliberately unavailable in DOM QA');return this._qaContext??=canvasContext(this);};
window.HTMLElement.prototype.setPointerCapture=noop;
window.HTMLElement.prototype.releasePointerCapture=noop;
Object.defineProperty(window,'innerWidth',{value:1365,writable:true});Object.defineProperty(window,'innerHeight',{value:768,writable:true});
Object.defineProperty(window,'devicePixelRatio',{value:1});Object.defineProperty(window.performance,'now',{value:()=>nowMs});
Object.defineProperty(window.navigator,'getGamepads',{value:()=>[]});
window.requestAnimationFrame=callback=>{raf.push(callback);return raf.length;};window.cancelAnimationFrame=noop;
window.setTimeout=(callback,delay=0)=>{const id=nextTimer++;timers.set(id,{callback,due:nowMs+delay});return id;};window.clearTimeout=id=>timers.delete(id);
window.console={...console,error:(...args)=>errors.push(args.map(value=>value?.stack||String(value)).join(' '))};
window.fetch=async request=>{
  const raw=String(request),url=new URL(raw,window.location.href),name=url.pathname.split('/').at(-1);
  if(!['research.json','research-panel.html'].includes(name))throw new Error('Unexpected network dependency in DOM QA: '+raw);
  const text=await readFile(resolve(dist,name),'utf8');
  loadedSources.add('dist/'+name);sourceSnapshots.set('dist/'+name,hashBytes(text));
  return{ok:true,status:200,text:async()=>text,json:async()=>JSON.parse(text)};
};
window.URL.createObjectURL=()=> 'blob:qa-local';window.URL.revokeObjectURL=noop;
window.TextEncoder=globalThis.TextEncoder;window.TextDecoder=globalThis.TextDecoder;
window.Worker=class{constructor(){throw new Error('Worker execution is outside this DOM routing check; numerical research worker tests are separate');}};

class MockRenderer{
  constructor(){this.domElement=document.createElement('canvas');this.shadowMap={};this.info={autoReset:false,render:{calls:0,triangles:0},programs:[],reset(){this.render.calls=0;this.render.triangles=0;}};this.ratio=1;}
  setPixelRatio(value){this.ratio=value;}getPixelRatio(){return this.ratio;}
  setSize(width,height){this.width=width;this.height=height;this.domElement.width=Math.floor(width*this.ratio);this.domElement.height=Math.floor(height*this.ratio);}
  getSize(value){return value.set(this.width,this.height);}getDrawingBufferSize(value){return value.set(this.domElement.width,this.domElement.height);}
  getContext(){return{getExtension:()=>null};}
  render(scene){this.info.render.calls++;graphics.rendered.push(scene.uuid);}
  async compileAsync(){}compile(){}
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
  const car={group:new NativeThree.Group(),quality,setQuality(value){this.quality=value;},setCutaway(value){this.cutaway=value;},setColor(value){this.color=value;},update(){},getRenderCost(){return{scope:'graphics mock; no GPU or geometry budget measured'};}};
  graphics.cars.push(car);return car;
}
function mockEnvironment(kind,scene){
  scene.userData.qaContext=kind;
  const environment={scene,stats:{qaContext:kind},ready:Promise.resolve(),quality:null,updates:0,reflections:0,
    setQuality(value){this.quality=value;},setContactAO(){},setDay(){},resize(){},update(){this.updates++;},wantsShadowUpdate(){return false;},updateReflections(){this.reflections++;},exposureAt(){return .90;},particleLighting(){return{ambient:new NativeThree.Color(.1,.1,.1),lights:[]};},setTargetPose(value){this.target=value;}};
  graphics.environments.push(environment);return environment;
}
const mocks=new Map([
  ['vendor/three.module.js',{...NativeThree,WebGLRenderer:MockRenderer}],
  ['vendor/addons/controls/OrbitControls.js',{OrbitControls:MockOrbitControls}],
  ['vendor/addons/postprocessing/EffectComposer.js',{EffectComposer:MockComposer}],
  ['vendor/addons/postprocessing/RenderPass.js',{RenderPass:MockRenderPass}],
  ...['UnrealBloomPass','OutputPass','SMAAPass','ShaderPass'].map(name=>[`vendor/addons/postprocessing/${name}.js`,{[name]:MockPass}]),
  ['contact-ao-pass.js',{ContactAOPass:MockContactAO}],
  ['vehicle.js',{createRoadster:mockCar}],
  ['exhaust.js',{ColdGasExhaust:MockExhaust}],
  ['city-environment.js',{createEnvironment:scene=>mockEnvironment('city',scene)}],
  ['wind-laboratory.js',{createWindLaboratory:scene=>mockEnvironment('lab',scene)}],
  ['audio.js',{createVehicleAudio:()=>({enabled:true,volume:1,context:{state:'running',resume:async()=>{}},silence(){},update(){},setVolume(){}})}],
  ['car-radio.js',{createCarRadio:async()=>({toggle(){},next(){}})}],
]);
const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const modules=new Map(),loadedSources=new Set(),sourceSnapshots=new Map([['dist/index.html',hashBytes(source)]]);
for(const name of ['style.css','game.css','research-console.css','research.css']){
  const path='dist/'+name;sourceSnapshots.set(path,hashBytes(await readFile(resolve(root,path))));
}
async function getModule(filename){
  filename=resolve(filename);if(modules.has(filename))return modules.get(filename);
  const key=relative(dist,filename),mock=mocks.get(key);let module;
  if(mock)module=new vm.SyntheticModule(Object.keys(mock),function(){for(const[name,value]of Object.entries(mock))this.setExport(name,value);},{context,identifier:pathToFileURL(filename).href});
  else{
    const code=await readFile(filename,'utf8');loadedSources.add(relative(root,filename));sourceSnapshots.set(relative(root,filename),hashBytes(code));
    module=new vm.SourceTextModule(code,{context,identifier:pathToFileURL(filename).href,initializeImportMeta(meta){meta.url=pathToFileURL(filename).href;},importModuleDynamically:async(specifier,referencing)=>{const next=await getModule(resolve(dirname(fileURLToPath(referencing.identifier)),specifier));if(next.status==='unlinked')await next.link(linker);if(next.status==='linked')await next.evaluate();return next;}});
  }
  modules.set(filename,module);return module;
}
async function linker(specifier,referencing){assert.ok(specifier.startsWith('.'),'Unexpected external module '+specifier);return getModule(resolve(dirname(fileURLToPath(referencing.identifier)),specifier));}
const entry=await getModule(resolve(dist,'main.js'));await entry.link(linker);await entry.evaluate();
for(let turn=0;turn<30&&!window.roadsterReady;turn++)await new Promise(resolve=>setImmediate(resolve));
const assertHealthy=()=>{assert.equal(errors.length,0,errors.join('\n'));assert.ok($('error-screen').classList.contains('hidden'),$('error-message').textContent);};
assertHealthy();assert.equal(window.roadsterReady,true,'Actual main.js boot must complete');
const state=()=>window.roadsterLab.getState();
const tick=(frames=1)=>{for(let i=0;i<frames;i++){nowMs+=1000/60;const callbacks=raf;raf=[];for(const callback of callbacks)callback(nowMs);for(const[id,timer]of [...timers])if(timer.due<=nowMs){timers.delete(id);timer.callback();}assertHealthy();}};
const click=selector=>{const element=selector.startsWith('#')?$(selector.slice(1)):q(selector);assert.ok(element,'Missing DOM control '+selector);element.click();assertHealthy();return element;};
const key=(code,{type='keydown',target=$('viewport'),repeat=false,...init}={})=>{const event=new window.KeyboardEvent(type,{code,bubbles:true,cancelable:true,repeat,...init});target.dispatchEvent(event);assertHealthy();return event;};
const tap=code=>{key(code);key(code,{type:'keyup'});};
const pass=name=>{checks.push(name);console.log('PASS: '+name);};
const numerical=telemetry=>JSON.stringify({position:telemetry.position,quaternion:telemetry.quaternion,velocity:telemetry.velocity,angularVelocity:telemetry.angularVelocity,gasMass:telemetry.gasMass,time:telemetry.simTime});

assert.equal(state().context,'city');assert.equal(state().scenario,'city');assert.equal(state().paused,true);
assert.equal(document.querySelectorAll('#viewport canvas').length,1);assert.ok($('play-city'));
click('#play-city');tick(120);assert.equal(state().paused,false);assert.ok(state().simTime>1.9);
pass('Actual main.js boots the city through the primary entry and advances the real 120 Hz simulation with a single viewport canvas');

for(const expected of ['level','off','level','off']){tap('KeyG');tick(1);assert.equal(state().stabilizationMode,expected);assert.notEqual(state().stabilizationMode,'hold');}
key('Digit1');tick(1);assert.equal(state().driverInput.pitch,1);assert.equal(state().driverInput.frontJets,0);assert.equal(state().driverInput.rearJets,0);key('Digit1',{type:'keyup'});
key('Numpad2');tick(1);assert.equal(state().driverInput.pitch,-1);assert.equal(state().driverInput.frontJets,0);assert.equal(state().driverInput.rearJets,0);key('Numpad2',{type:'keyup'});
tick(1);assert.equal(state().driverInput.pitch,0);
pass('Actual G event routing has only off/level states, and keyboard/numpad 1/2 deliver normalized pitch without opening raw valves');

key('KeyW');tick(30);key('KeyW',{type:'keyup'});tick(1);
const cityBefore=numerical(state()),cityScene=graphics.environments[0].scene.uuid,urlBefore=window.location.href;
click('#context-switch');assert.equal(state().context,'lab');assert.equal(state().worldType,'windlab');assert.equal(state().research.open,true);assert.equal(state().paused,false);tick(60);
assert.equal(window.location.href,urlBefore);assert.equal(document.querySelectorAll('#viewport canvas').length,1);
assert.equal(graphics.environments.length,2);const labEnvironment=graphics.environments[1];assert.ok(labEnvironment.updates>0);assert.equal(graphics.rendered.at(-1),labEnvironment.scene.uuid);
assert.equal(window.roadsterLab.getGeometry().some(item=>item.kind==='arch'),false);
click('#context-switch');assert.equal(state().context,'city');assert.equal(numerical(state()),cityBefore,'Entering and simulating the lab must not advance or teleport the saved city vehicle');tick(1);assert.equal(graphics.rendered.at(-1),cityScene);
values.contexts={cityGeometry:window.roadsterLab.getGeometry().length,labGeometry:24,viewports:document.querySelectorAll('#viewport canvas').length,cityStatePreserved:true,navigationChanged:false};
pass('City/lab switching keeps one document and renderer, uses isolated real physics worlds, preserves the city vehicle state and routes drawing to the active scene');

for(const quality of ['high','ultra','balanced']){
  $('quality').value=quality;$('quality').dispatchEvent(new window.Event('change',{bubbles:true}));tick(1);
  assert.equal(state().quality,quality);assert.equal(graphics.environments[0].quality,quality);
  const composer=graphics.composers[0];assert.equal(composer.passes.some(pass=>pass instanceof MockContactAO),quality!=='balanced');
  click('#context-switch');tick(1);assert.equal(state().context,'lab');assert.equal(labEnvironment.quality,quality);assert.equal(composer.passes.some(pass=>pass instanceof MockContactAO),false,'City contact AO must not run in the lab');
  assert.equal(graphics.cars[1].quality,quality);click('#context-switch');tick(1);assert.equal(state().context,'city');assert.equal(graphics.cars[0].quality,quality);
  if(quality!=='balanced')assert.equal(composer.passes.find(pass=>pass instanceof MockContactAO).scene.uuid,cityScene);
}
pass('All three quality changes and context round trips update the active car/environment and restore city AO to the right scene while keeping it disabled in the lab');

click('[data-research-console]');const input=q('[data-rc="program-name"]');assert.ok(input);input.focus();
const modeBefore=state().stabilizationMode;key('Digit1',{target:input});key('KeyG',{target:input});key('Digit3',{target:input});key('KeyW',{target:input});tick(1);
assert.equal(state().driverInput.pitch,0);assert.equal(state().driverInput.throttle,0);assert.equal(state().stabilizationMode,modeBefore);assert.equal(state().research.running,false);
for(const code of ['Digit1','KeyG','Digit3','KeyW'])key(code,{type:'keyup',target:input});
$('viewport').focus();key('KeyW');tick(1);assert.equal(state().driverInput.throttle,1);input.focus();tick(1);assert.equal(state().driverInput.throttle,0,'Editing focus must release previously held driving keys');key('KeyW',{type:'keyup',target:input});
pass('Actual form-focus events suppress driving, stabilization and saved-program shortcuts, and clear a previously held throttle');

input.value='DOM 集成姿态阶跃';input.dispatchEvent(new window.Event('change',{bubbles:true}));
const binding=q('[data-rc="program-shortcut"]');binding.value='Digit8';binding.dispatchEvent(new window.Event('change',{bubbles:true}));click('[data-rc-action="save-program"]');
assert.ok(state().research.savedPrograms.some(program=>program.shortcut==='Digit8'));
$('viewport').focus();tap('Digit8');tick(30);assert.equal(state().research.running,true);assert.equal(state().stabilizationMode,'hold');assert.equal(state().mode,'hover');
key('Digit1');tick(1);assert.equal(state().research.running,false,'Pilot pitch must cancel the custom program');assert.equal(state().driverInput.pitch,1);key('Digit1',{type:'keyup'});tick(1);
click('#context-switch');tick(1);$('viewport').focus();tap('Numpad8');tick(30);assert.equal(state().research.running,true);assert.equal(state().context,'lab');
click('[data-rc-action="stop"]');tick(1);assert.equal(state().research.running,false);
values.programs={savedShortcut:'Digit8',sameProgramRunsInCityAndLab:true,physicalTargetTrackingInvoked:true,pilotTakeoverCancels:true};
pass('The actual editor persists a custom shortcut, runs its real force-controlled program in both scenes and yields immediately to pilot pitch or the stop control');

const settle=async(predicate,label)=>{for(let turn=0;turn<2000&&!predicate();turn++)await new Promise(resolve=>setTimeout(resolve,1));assertHealthy();assert.ok(predicate(),label+'; last UI toast: '+$('toast').textContent);};
const study=()=>q('.research-study-panel');
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
click('#context-switch');assert.equal(state().context,'city');assert.equal(study().hidden,true);assert.equal(document.body.classList.contains('study-open'),false);assert.equal(state().paused,false);
tick(1);assert.equal(graphics.rendered.at(-1),cityScene);assert.equal(document.querySelectorAll('#viewport canvas').length,1);assert.equal(window.location.href,urlBefore);
values.advancedStudy={actualModule:true,lazyCloseRaceHandled:true,activeVehiclePaused:true,parametersReadOnlyToLiveVehicle:true,priorPausePreserved:true,sceneSwitchClosesPanel:true,panelInstances:document.querySelectorAll('.research-study-panel').length,workerExecutionTested:false};
pass('Closing the study preserves an existing pause, and switching back to the city closes the reused panel and restores the correct single-viewport scene');

const hashes={};for(const filename of [...new Set([...loadedSources,...sourceSnapshots.keys(),'qa/same-page-ui-check.mjs'])].sort()){
  const current=hashBytes(await readFile(resolve(root,filename)));if(sourceSnapshots.has(filename))assert.equal(current,sourceSnapshots.get(filename),'Source changed during DOM execution; rerun after freezing '+filename);hashes[filename]=current;
}
const report={status:'passed',generatedAt:new Date().toISOString(),checks,values,sourceHashes:hashes,
  environment:{node:process.version,jsdom:'26.1.0',moduleEvaluation:'Actual main.js and its non-visual dependency graph in vm.SourceTextModule',physics:'Actual RoadsterSim, no rigid-body/control mock',context:'JSDOM document only'},
  excluded:{browser:false,webgl:false,gpuTiming:false,pixelVisualQA:false,independentWorkerExecution:false},
  mocks:[...mocks.keys()],limits:'DOM interaction, controller integration and renderer/scene routing checks. Rendering, camera pixels, assets, shader execution, browser behavior, GPU performance and visual quality are not validated by these graphics mocks.'};
await writeFile(resolve(root,'qa/same-page-ui-3.7.json'),JSON.stringify(report,null,2)+'\n');
dom.window.close();console.log(`Same-page UI: ${checks.length} DOM integration groups passed; no browser or visual acceptance performed.`);
