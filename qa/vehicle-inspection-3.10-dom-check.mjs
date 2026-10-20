import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
// Interface-only regression. No renderer, pixel, driving or FPS verdict.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as vm from 'node:vm';
import * as NativeThree from '../dist/vendor/three.module.js';
import {RoadsterSim as NativeRoadsterSim} from '../dist/physics.js';
if(typeof vm.SourceTextModule!=='function'){
  const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit'});
  if(result.error)throw result.error;process.exit(result.status??1);
}
const jsdomPath=process.argv[2]||'/tmp/roadster-dom-qa/node_modules/jsdom/lib/api.js';
const {JSDOM}=await import(pathToFileURL(jsdomPath));
const html=readFileSync(new URL('../dist/vehicle-inspection.html',import.meta.url),'utf8');
const dom=new JSDOM(html,{url:'https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html',pretendToBeVisual:true});
const {window}=dom;
for(const [name,value]of Object.entries({window,document:window.document,location:window.location,localStorage:window.localStorage,devicePixelRatio:1,navigator:window.navigator}))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
window.HTMLCanvasElement.prototype.getContext=()=>null;
const expectedErrors=[],originalError=console.error;console.error=(...args)=>expectedErrors.push(args.map(String).join(' '));
const downloads=[];globalThis.URL.createObjectURL=blob=>{downloads.push(blob);return'blob:inspection-test';};globalThis.URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=()=>{};
await import('../dist/vehicle-inspection.js');
console.error=originalError;
const $=id=>window.document.getElementById(id),flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
await flush();
assert.equal($('inspection-stage').dataset.graphics,'unavailable');assert.equal($('capture-meta').disabled,false);assert.equal($('capture-pair').disabled,true);assert.equal($('capture-bundle').disabled,true);assert.equal($('model-baseline').disabled,true);assert.equal($('capture-diagnostics').disabled,true);assert.equal($('surface-mode').disabled,true);assert.equal($('shadow-correction').disabled,true);
assert.deepEqual([...$('reference-version').options].map(o=>o.value),['3.9','3.8']);assert.equal($('reference-version').value,'3.9');
const language=window.document.querySelector('[data-language-select]');language.value='en';language.dispatchEvent(new window.Event('change',{bubbles:true}));await flush();
const content=window.document.body.cloneNode(true);content.querySelectorAll('[data-language-select]').forEach(node=>node.remove());
const bodyText=content.textContent.replace(/\s+/g,' ').trim();assert.ok(!/[\u3400-\u9fff]/u.test(bodyText),'New inspection labels leak Chinese after selecting English');
assert.match($('inspection-failure').textContent,/This environment could not create a 3D rendering context/);assert.equal(window.localStorage.getItem('roadster-language'),'en');
assert.equal($('capture-bundle').textContent,'Original comparison frames + conditions ZIP');assert.equal($('model-current').textContent,`Current ${REPORT_VERSION} exterior`);assert.equal($('capture-diagnostics').textContent,'Capture seven matching diagnostic frames');assert.equal($('capture-meta').textContent,'Export current state JSON (independent)');
$('capture-meta').click();assert.equal(downloads.length,1);const metadata=JSON.parse(await downloads[0].text());
assert.equal(metadata.graphicsAvailable,false);assert.equal(metadata.camera,null);assert.equal(metadata.resolution,null);assert.equal(metadata.graphicsDevice,null);assert.equal(metadata.comparisonProtocol.schema,'roadster.surface-comparison');assert.equal(metadata.comparisonBaseline.version,'3.9.0');assert.equal(metadata.comparisonBaseline.commit,'6083bbf0e01f4eef5447f2c1b951d8b41e691f46');assert.equal(metadata.model,'current');
assert.equal(metadata.recordScope,'current-state-unbound');assert.equal(metadata.captureId,null);assert.equal(metadata.frameAssociation,null);assert.match(metadata.limits,/not associated with any previous PNG/);
language.value='zh';language.dispatchEvent(new window.Event('change',{bubbles:true}));await flush();assert.equal($('model-baseline').textContent,'3.9 外观基线');assert.equal($('capture-bundle').textContent,'对照原始帧 + 同次条件 ZIP');assert.equal($('capture-meta').textContent,'导出当前状态 JSON（独立）');assert.equal(window.localStorage.getItem('roadster-language'),'zh');
async function checkMatrixState(){
  const live=new JSDOM(html,{url:'https://qa.invalid/vehicle-inspection.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w=live.window,d=w.document,c=live.getInternalVMContext(),byId=id=>d.getElementById(id),draws=[],exports=[],instances=[],orbit=[],loaded=new Set();
  let lost=false,loseOnBlob=false,now=100,frameSequence=0;const frames=new Map(),noop=()=>{};
  const tick=()=>{now+=1000/60;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);};
  w.requestAnimationFrame=callback=>{const id=++frameSequence;frames.set(id,callback);return id;};w.cancelAnimationFrame=id=>frames.delete(id);w.setTimeout=()=>0;w.clearTimeout=noop;
  Object.defineProperty(w.performance,'now',{value:()=>now});Object.defineProperty(w,'devicePixelRatio',{value:1});
  w.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,width:1280,height:720,top:0,left:0,right:1280,bottom:720});
  w.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')throw Error('No GPU context in the inspection DOM fixture');return new Proxy({canvas:this,measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop})},{get:(o,k)=>k in o?o[k]:noop});};
  w.HTMLCanvasElement.prototype.toBlob=function(callback){tick();if(loseOnBlob){loseOnBlob=false;lost=true;this.dispatchEvent(new w.Event('webglcontextlost',{cancelable:true}));}Promise.resolve().then(()=>callback(new Blob(['DOM fixture: no GPU pixels'],{type:'image/png'})));};
  w.HTMLAnchorElement.prototype.click=noop;w.Blob=Blob;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.structuredClone=structuredClone;
  w.URL.createObjectURL=blob=>{exports.push(blob);return 'blob:inspection-dom';};w.URL.revokeObjectURL=noop;
  class Renderer{
    constructor(){this.domElement=d.createElement('canvas');this.shadowMap={};this.debug={};this.properties={get:()=>({})};this.renderBufferDirect=noop;this.info={render:{calls:0,triangles:0},programs:[]};this.ratio=1;}
    setPixelRatio(r){this.ratio=r;}getPixelRatio(){return this.ratio;}setSize(x,y){this.domElement.width=x*this.ratio;this.domElement.height=y*this.ratio;}
    getDrawingBufferSize(v){return v.set(this.domElement.width,this.domElement.height);}
    getContext(){return{getExtension:()=>null,getParameter:()=>16,getContextAttributes:()=>({alpha:false}),getError:()=>0,NO_ERROR:0,isContextLost:()=>lost};}
    render(scene){assert.equal(lost,false,'The finally path attempted to render after context loss');const types=new Set();scene.traverse(o=>{let vehicle=false;for(let n=o;n;n=n.parent)if(n.userData?.renderAuditGroup==='vehicle')vehicle=true;if(vehicle&&o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])types.add(m.type);});draws.push({surfaceMode:byId('surface-mode').value,types:[...types],intensity:scene.environmentIntensity});}
  }
  class PMREM{fromScene(){return{texture:new NativeThree.Texture()};}fromEquirectangular(){return{texture:new NativeThree.Texture()};}dispose(){}}
  class Controls extends NativeThree.EventDispatcher{constructor(camera){super();this.camera=camera;this.target=new NativeThree.Vector3();this.enabled=true;orbit.push(this);}update(){this.camera.lookAt(this.target);this.camera.updateMatrixWorld();}}
  class HDR{load(url,onLoad){const texture=new NativeThree.Texture();Promise.resolve().then(()=>onLoad(texture));return texture;}}
  class Sim extends NativeRoadsterSim{constructor(...args){super(...args);instances.push(this);}}
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist'),mods=new Map();
  const mocks=new Map([['vendor/three.module.js',{...NativeThree,WebGLRenderer:Renderer,PMREMGenerator:PMREM}],['vendor/addons/controls/OrbitControls.js',{OrbitControls:Controls}],['vendor/addons/loaders/HDRLoader.js',{HDRLoader:HDR}],['physics.js',{RoadsterSim:Sim}]]);
  function getModule(filename){
    filename=resolve(filename);if(mods.has(filename))return mods.get(filename);const key=relative(dist,filename),mock=mocks.get(key);let module;
    if(mock)module=new vm.SyntheticModule(Object.keys(mock),function(){for(const [name,value]of Object.entries(mock))this.setExport(name,value);},{context:c,identifier:pathToFileURL(filename).href});
    else{loaded.add(relative(root,filename));module=new vm.SourceTextModule(readFileSync(filename,'utf8'),{context:c,identifier:pathToFileURL(filename).href,initializeImportMeta:m=>{m.url=pathToFileURL(filename).href;}});}
    mods.set(filename,module);return module;
  }
  const entry=getModule(resolve(dist,'vehicle-inspection.js'));await entry.link((specifier,referencing)=>getModule(resolve(dirname(fileURLToPath(referencing.identifier)),specifier)));await entry.evaluate();await flush();tick();
  assert.equal(byId('inspection-stage').dataset.graphics,'ready');assert.equal(instances.length,1);
  const state=()=>JSON.stringify(instances[0].exportState()),change=(id,value)=>{byId(id).value=value;byId(id).dispatchEvent(new w.Event('change',{bubbles:true}));};
  const snapshot=async()=>{byId('capture-meta').click();return JSON.parse(await exports.at(-1).text());};
  const unzip=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),out={};let at=0;while(view.getUint32(at,true)===0x04034b50){const size=view.getUint32(at+18,true),names=view.getUint16(at+26,true),extras=view.getUint16(at+28,true),start=at+30+names+extras;out[new TextDecoder().decode(bytes.slice(at+30,at+30+names))]=bytes.slice(start,start+size);at=start+size;}return out;};
  const results=[];
  for(const mode of ['normals','no-environment']){
    byId('day-light').click();change('inspection-quality','balanced');change('surface-mode',mode);const before=await snapshot(),physical=state(),start=draws.length;
    const disabled=[...d.querySelectorAll('button,input,select')].map(e=>[e,e.disabled]);await byId('inspection-program-audit').onclick();
    const archive=await unzip(exports.at(-1)),matrix=JSON.parse(new TextDecoder().decode(archive['inspection-gpu-matrix.json']));
    assert.equal(matrix.status,'failed','The no-draw facade must never be accepted as a GPU pass');assert.equal(matrix.cases.length,10);assert.equal(Object.keys(archive).length,21);
    for(const item of matrix.cases){const condition=JSON.parse(new TextDecoder().decode(archive[item.conditionsFile]));assert.equal(condition.surfaceDiagnostics.mode,'surface');assert.equal(condition.simTime,before.simTime);assert.deepEqual(condition.wing,before.wing);assert.deepEqual(condition.camera,before.camera);assert.equal(new TextDecoder().decode(archive[item.imageFile]),'DOM fixture: no GPU pixels');assert.ok(item.normal.failures.includes('no-observed-draw-calls'));assert.ok(item.export.failures.includes('required-category-not-drawn:vehicle'));}
    const materialDraws=draws.slice(start).filter(draw=>draw.surfaceMode==='surface');assert.equal(materialDraws.length,20);assert.ok(materialDraws.every(draw=>draw.types.some(type=>['MeshStandardMaterial','MeshPhysicalMaterial'].includes(type))&&!draw.types.includes('MeshNormalMaterial')));
    const after=await snapshot();assert.equal(state(),physical);assert.equal(after.surfaceDiagnostics.mode,mode);assert.equal(after.environmentIntensity,before.environmentIntensity);assert.equal(after.lighting,before.lighting);assert.equal(after.quality,before.quality);assert.deepEqual(after.camera,before.camera);for(const [element,value]of disabled)assert.equal(element.disabled,value);assert.equal(orbit[0].enabled,true);
    change('surface-mode','surface');assert.equal((await snapshot()).environmentIntensity,.68,'Restoring a no-environment capture must retain the underlying daylight environment');results.push({initialMode:mode,cases:10,reportedStatus:matrix.status,physicsUnchanged:true,modeAndAuthoredEnvironmentRestored:true});
  }
  change('surface-mode','normals');const physical=state(),downloadCount=exports.length,drawCount=draws.length;loseOnBlob=true;await byId('inspection-program-audit').onclick();
  assert.equal(byId('inspection-stage').dataset.graphics,'unavailable');assert.equal(orbit[0].enabled,false);assert.equal(state(),physical);assert.equal(draws.length-drawCount,2,'No later case or finally draw may run after context loss');assert.equal(exports.length,downloadCount,'An interrupted capture must not export a success archive');
  for(const element of d.querySelectorAll('button,input,select'))assert.equal(element.disabled,!element.matches('[data-language-select],#capture-meta'),'Context loss must retain the failure-state controls');assert.equal(byId('surface-mode').value,'normals');
  live.window.close();return{sources:[...loaded,'dist/physics.js'],scope:'Actual inspection entry, original geometry and surface-diagnostic handlers with real rigid-body state and a declared no-draw renderer facade. No GPU or PNG pixel evidence.',cases:results,contextLoss:{stopsAfterFirstCase:true,controlsRemainDisabled:true,noFinalRender:true,physicsUnchanged:true}};
}
const matrixState=await checkMatrixState();
const sourcePaths=[...new Set(['dist/vehicle-inspection.js','dist/vehicle-inspection.html','dist/inspection-capture.js','dist/inspection-diagnostics-capture.js','dist/vehicle-surface-diagnostics.js','dist/i18n-visual-311-en.js','dist/i18n-vehicle-310-en.js','qa/vehicle-inspection-3.10-dom-check.mjs',...matrixState.sources])];delete matrixState.sources;
const report={status:'passed',asOf:new Date().toISOString(),modelVersion:metadata.modelVersion,rendererBuildId:metadata.rendererBuildId,scope:'JSDOM interface and metadata regression, plus actual inspection matrix state handling through a no-draw renderer facade. Not a real-browser, GPU, image or performance result.',checks:['3D failure leaves truthful metadata export and language selection available while disabling PNG/ZIP frame capture and reference rendering','3.9 default / 3.8 retained options','Original-frame ZIP and independent-state JSON labels translate to English and back without storage identity changes','No-GPU metadata has null camera/resolution/device, separate surface protocol, and the actual chosen frozen reference identity','Independent JSON explicitly has current-state-unbound scope and null captureId/frameAssociation','A normals or no-environment starting mode still exercises full PBR materials for all ten matrix cases, then restores the original mode, authored environment, camera, controls and physical state','Context loss aborts the matrix without another draw, export or reenabled controls'],matrixState,sourceHashes:Object.fromEntries(sourcePaths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),expectedRendererErrors:expectedErrors,limits:['A real WebGL device must check baseline loading, PNG/ZIP pixels, geometry/material appearance and motion.']};
writeFileSync(new URL(`../qa/vehicle-inspection-${REPORT_VERSION}-dom.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));window.close();
