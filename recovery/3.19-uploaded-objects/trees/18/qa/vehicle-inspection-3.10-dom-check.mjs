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
const downloads=[],downloadURLs=new Map();let downloadSequence=0;
globalThis.URL.createObjectURL=blob=>{const url='blob:inspection-test-'+(++downloadSequence);downloadURLs.set(url,blob);return url;};globalThis.URL.revokeObjectURL=url=>downloadURLs.delete(url);
window.HTMLAnchorElement.prototype.click=function(){assert.ok(this.download,'A download handoff needs its filename');assert.ok(downloadURLs.has(this.href),'The handoff must reference a prepared Blob');downloads.push(downloadURLs.get(this.href));};
await import('../dist/vehicle-inspection.js');
console.error=originalError;
const $=id=>window.document.getElementById(id),flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
async function awaitDownload(doc,observed,expected,{timeoutMs=5000}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const card=doc.querySelector('.export-job-card'),status=card?.dataset.exportStatus;
    if(status==='failed'||status==='cancelled')throw Error('Export did not reach browser handoff: '+card.dataset.exportReceipt);
    if(observed.length>=expected&&status==='handed-off'){
      assert.equal(observed.length,expected,'Each request must produce exactly one new download handoff');
      const receipt=JSON.parse(card.dataset.exportReceipt);assert.equal(receipt.browserCompletion,'unobservable');return receipt;
    }
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Timed out waiting for an actual download handoff: '+JSON.stringify({expected,observed:observed.length,receipt:doc.querySelector('.export-job-card')?.dataset.exportReceipt}));
}
async function switchLanguageWithoutExport(select,value,doc,observed){
  const count=observed.length,blob=observed.at(-1),contents=await blob.text(),card=doc.querySelector('.export-job-card'),receipt=JSON.parse(card.dataset.exportReceipt);
  select.value=value;select.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));await flush();
  assert.equal(observed.length,count,'Changing language must not repeat a download handoff');
  assert.equal(await observed.at(-1).text(),contents,'Changing language must not rewrite the exported file');
  assert.deepEqual(JSON.parse(card.dataset.exportReceipt),receipt,'Changing language only repaints the existing export receipt');
}
await flush();
assert.equal($('inspection-stage').dataset.graphics,'unavailable');assert.equal($('capture-meta').disabled,false);assert.equal($('capture-pair').disabled,true);assert.equal($('capture-bundle').disabled,true);assert.equal($('model-baseline').disabled,true);assert.equal($('capture-diagnostics').disabled,true);assert.equal($('surface-mode').disabled,true);assert.equal($('shadow-correction').disabled,true);
assert.deepEqual([...$('reference-version').options].map(o=>o.value),['3.15','3.13','3.9','3.8']);assert.equal($('reference-version').value,'3.15');
const language=window.document.querySelector('[data-language-select]');language.value='en';language.dispatchEvent(new window.Event('change',{bubbles:true}));await flush();
const content=window.document.body.cloneNode(true);content.querySelectorAll('[data-language-select]').forEach(node=>node.remove());
const bodyText=content.textContent.replace(/\s+/g,' ').trim();assert.ok(!/[\u3400-\u9fff]/u.test(bodyText),'New inspection labels leak Chinese after selecting English');
assert.match($('inspection-failure').textContent,/This environment could not create a 3D rendering context/);assert.equal(window.localStorage.getItem('roadster-language'),'en');
assert.equal($('capture-bundle').textContent,'Original comparison frames + conditions ZIP');assert.equal($('model-current').textContent,`Current ${REPORT_VERSION} exterior`);assert.equal($('capture-diagnostics').textContent,'Capture seven matching diagnostic frames');assert.equal($('capture-meta').textContent,'Export current state JSON (independent)');
$('capture-meta').click();await awaitDownload(window.document,downloads,1);assert.equal(downloads.length,1);const metadata=JSON.parse(await downloads[0].text());
assert.equal(metadata.graphicsAvailable,false);assert.equal(metadata.camera,null);assert.equal(metadata.resolution,null);assert.equal(metadata.graphicsDevice,null);assert.equal(metadata.comparisonProtocol.schema,'roadster.surface-comparison');assert.equal(metadata.comparisonBaseline.version,'3.15.0');assert.equal(metadata.comparisonBaseline.commit,'9f6c8f47a2678beee3915a0320ac2bf93312e96b');assert.equal(metadata.model,'current');
assert.equal(metadata.recordScope,'current-state-unbound');assert.equal(metadata.captureId,null);assert.equal(metadata.frameAssociation,null);assert.match(metadata.limits,/not associated with any previous PNG/);
await switchLanguageWithoutExport(language,'zh',window.document,downloads);assert.equal($('model-baseline').textContent,'3.15 外观基线');assert.equal($('capture-bundle').textContent,'对照原始帧 + 同次条件 ZIP');assert.equal($('capture-meta').textContent,'导出当前状态 JSON（独立）');assert.equal(window.localStorage.getItem('roadster-language'),'zh');
async function checkMatrixState(){
  const live=new JSDOM(html,{url:'https://qa.invalid/vehicle-inspection.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w=live.window,d=w.document,c=live.getInternalVMContext(),byId=id=>d.getElementById(id),draws=[],exports=[],instances=[],orbit=[],loaded=new Set();
  let lost=false,loseOnBlob=false,now=100,frameSequence=0;const frames=new Map(),noop=()=>{};
  const tick=()=>{now+=1000/60;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);};
  w.requestAnimationFrame=callback=>{const id=++frameSequence;frames.set(id,callback);return id;};w.cancelAnimationFrame=id=>frames.delete(id);
  const timers=new Set();w.setTimeout=(callback,delay=0,...args)=>{const timer=setTimeout(()=>{timers.delete(timer);callback(...args);},delay);timers.add(timer);return timer;};w.clearTimeout=timer=>{clearTimeout(timer);timers.delete(timer);};
  Object.defineProperty(w.performance,'now',{value:()=>now});Object.defineProperty(w,'devicePixelRatio',{value:1});
  w.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,width:1280,height:720,top:0,left:0,right:1280,bottom:720});
  w.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')throw Error('No GPU context in the inspection DOM fixture');return new Proxy({canvas:this,measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop})},{get:(o,k)=>k in o?o[k]:noop});};
  w.HTMLCanvasElement.prototype.toBlob=function(callback){tick();if(loseOnBlob){loseOnBlob=false;lost=true;this.dispatchEvent(new w.Event('webglcontextlost',{cancelable:true}));}Promise.resolve().then(()=>callback(new Blob(['DOM fixture: no GPU pixels'],{type:'image/png'})));};
  w.Blob=Blob;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.structuredClone=structuredClone;w.AbortController=AbortController;
  const exportURLs=new Map();let exportSequence=0;
  w.URL.createObjectURL=blob=>{const url='blob:inspection-dom-'+(++exportSequence);exportURLs.set(url,blob);return url;};w.URL.revokeObjectURL=url=>exportURLs.delete(url);
  w.HTMLAnchorElement.prototype.click=function(){assert.ok(this.download,'A download handoff needs its filename');assert.ok(exportURLs.has(this.href),'The handoff must reference a prepared Blob');exports.push(exportURLs.get(this.href));};
  class Renderer{
    constructor(){this.domElement=d.createElement('canvas');this.shadowMap={};this.debug={};this.properties={get:()=>({})};this.renderBufferDirect=noop;this.info={render:{calls:0,triangles:0},programs:[]};this.ratio=1;}
    setPixelRatio(r){this.ratio=r;}getPixelRatio(){return this.ratio;}setSize(x,y){this.domElement.width=x*this.ratio;this.domElement.height=y*this.ratio;}
    getSize(v){return v.set(this.domElement.width/this.ratio,this.domElement.height/this.ratio);}
    setViewport(){}setScissor(){}setScissorTest(){}clear(){}
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
    else{loaded.add(relative(root,filename));module=new vm.SourceTextModule(readFileSync(filename,'utf8'),{context:c,identifier:pathToFileURL(filename).href,initializeImportMeta:m=>{m.url=pathToFileURL(filename).href;},importModuleDynamically:async(specifier,referencing)=>{const child=getModule(resolve(dirname(fileURLToPath(referencing.identifier)),specifier));if(child.status==='unlinked')await child.link((path,parent)=>getModule(resolve(dirname(fileURLToPath(parent.identifier)),path)));if(child.status==='linked')await child.evaluate();return child;}});}
    mods.set(filename,module);return module;
  }
  const entry=getModule(resolve(dist,'vehicle-inspection.js'));await entry.link((specifier,referencing)=>getModule(resolve(dirname(fileURLToPath(referencing.identifier)),specifier)));await entry.evaluate();await flush();tick();
  assert.equal(byId('inspection-stage').dataset.graphics,'ready');assert.equal(instances.length,1);
  const state=()=>JSON.stringify(instances[0].exportState()),change=(id,value)=>{byId(id).value=value;byId(id).dispatchEvent(new w.Event('change',{bubbles:true}));};
  const snapshot=async()=>{const expected=exports.length+1;byId('capture-meta').click();await awaitDownload(d,exports,expected);return JSON.parse(await exports.at(-1).text());};
  const unzip=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),out={};let at=0;while(view.getUint32(at,true)===0x04034b50){const size=view.getUint32(at+18,true),names=view.getUint16(at+26,true),extras=view.getUint16(at+28,true),start=at+30+names+extras;out[new TextDecoder().decode(bytes.slice(at+30,at+30+names))]=bytes.slice(start,start+size);at=start+size;}return out;};
  const results=[];
  for(const mode of ['normals','no-environment']){
    byId('day-light').click();change('inspection-quality','balanced');change('surface-mode',mode);const before=await snapshot(),physical=state(),start=draws.length;
    const disabled=[...d.querySelectorAll('button,input,select')].map(e=>[e,e.disabled]),expectedExport=exports.length+1;await byId('inspection-program-audit').onclick();await awaitDownload(d,exports,expectedExport);
    const archive=await unzip(exports.at(-1)),matrix=JSON.parse(new TextDecoder().decode(archive['inspection-gpu-matrix.json']));
    assert.equal(matrix.status,'failed','The no-draw facade must never be accepted as a GPU pass');assert.equal(matrix.cases.length,10);assert.equal(Object.keys(archive).length,21);
    for(const item of matrix.cases){const condition=JSON.parse(new TextDecoder().decode(archive[item.conditionsFile]));assert.equal(condition.surfaceDiagnostics.mode,'surface');assert.equal(condition.simTime,before.simTime);assert.deepEqual(condition.wing,before.wing);assert.deepEqual(condition.camera,before.camera);assert.equal(new TextDecoder().decode(archive[item.imageFile]),'DOM fixture: no GPU pixels');assert.ok(item.normal.failures.includes('no-observed-draw-calls'));assert.ok(item.export.failures.includes('required-category-not-drawn:vehicle'));}
    const materialDraws=draws.slice(start).filter(draw=>draw.surfaceMode==='surface');assert.equal(materialDraws.length,20);assert.ok(materialDraws.every(draw=>draw.types.some(type=>['MeshStandardMaterial','MeshPhysicalMaterial'].includes(type))&&!draw.types.includes('MeshNormalMaterial')));
    const after=await snapshot();assert.equal(state(),physical);assert.equal(after.surfaceDiagnostics.mode,mode);assert.equal(after.environmentIntensity,before.environmentIntensity);assert.equal(after.lighting,before.lighting);assert.equal(after.quality,before.quality);assert.deepEqual(after.camera,before.camera);for(const [element,value]of disabled)assert.equal(element.disabled,value);assert.equal(orbit[0].enabled,true);
    change('surface-mode','surface');assert.equal((await snapshot()).environmentIntensity,.68,'Restoring a no-environment capture must retain the underlying daylight environment');results.push({initialMode:mode,cases:10,reportedStatus:matrix.status,physicsUnchanged:true,modeAndAuthoredEnvironmentRestored:true});
  }
  const identityPhysical=state();
  change('display-configuration','official-study');change('lamp-mode','drl');
  const originalStudy=await snapshot();assert.equal(originalStudy.displayConfiguration,'official-study');assert.equal(originalStudy.displayOnly,true);assert.equal(originalStudy.lampMode,'drl');assert.equal(state(),identityPhysical);
  assert.match(byId('display-identity-note').textContent,/不会重建质量/);
  const photoButton=[...d.querySelectorAll('#photo-cameras button')].find(b=>b.dataset.view==='photo-side');assert.ok(photoButton);photoButton.click();
  const matched=await snapshot();assert.equal(matched.photoReference.id,'photo-side');assert.equal(matched.photoReference.aligned,true);assert.equal(matched.photoReference.landmarks.status,'design-comparison-only');assert.equal(matched.camera.aspect,3440/1024);assert.equal(state(),identityPhysical);
  const captureBefore=await snapshot();const beforeSuite=exports.length;await byId('capture-study').onclick();await awaitDownload(d,exports,beforeSuite+1);assert.equal(exports.length,beforeSuite+1);
  const studyArchive=await unzip(exports.at(-1)),study=JSON.parse(new TextDecoder().decode(studyArchive['vehicle-study.json']));assert.equal(study.status,'draw-failed');assert.equal(study.actualFrames,24);assert.equal(Object.keys(studyArchive).length,26);
  for(const frame of study.frames){assert.equal(frame.conditions.displayConfiguration,'experimental');assert.equal(frame.conditions.simTime,captureBefore.simTime);assert.equal(frame.conditions.quality,captureBefore.quality);assert.equal(new TextDecoder().decode(studyArchive[frame.file]),'DOM fixture: no GPU pixels');}
  const captureAfter=await snapshot();assert.equal(captureAfter.displayConfiguration,'official-study');assert.equal(captureAfter.lampMode,'drl');assert.deepEqual(captureAfter.camera,captureBefore.camera);assert.equal(captureAfter.photoReference.id,'photo-side');assert.equal(state(),identityPhysical);assert.equal(orbit[0].enabled,true);assert.equal(byId('capture-stop').hidden,true);
  const beforeCancel=exports.length,cancelling=byId('capture-study').onclick();byId('capture-stop').click();await cancelling;await awaitDownload(d,exports,beforeCancel+1);
  const cancelledArchive=await unzip(exports.at(-1)),cancelled=JSON.parse(new TextDecoder().decode(cancelledArchive['vehicle-study.json']));assert.equal(cancelled.status,'cancelled');assert.ok(cancelled.actualFrames<24);assert.equal(byId('capture-stop').hidden,true);assert.equal(state(),identityPhysical);assert.equal(orbit[0].enabled,true);
  const languageSelect=d.querySelector('[data-language-select]');await switchLanguageWithoutExport(languageSelect,'en',d,exports);
  const liveCopy=d.body.cloneNode(true);liveCopy.querySelectorAll('[data-language-select]').forEach(e=>e.remove());const untranslated=liveCopy.textContent.replace(/\s+/g,' ').trim();assert.ok(!/[\u3400-\u9fff]/u.test(untranslated),'New ready-state inspection labels leak Chinese: '+untranslated.match(/[\u3400-\u9fff][^<>]{0,100}/u));
  const englishSnapshot=await snapshot();assert.equal(englishSnapshot.displayConfiguration,'official-study');assert.equal(englishSnapshot.lampMode,'drl');assert.equal(state(),identityPhysical);assert.match(byId('display-identity-note').textContent,/Inspection display only/);
  await switchLanguageWithoutExport(languageSelect,'zh',d,exports);assert.equal(byId('display-configuration').value,'official-study');assert.equal(byId('lamp-mode').value,'drl');
  results.push({displayIdentity:'inspection-only two-seat study',physicsUnchanged:true,lampState:'drl',photoMatch:'photo-side',suiteFrames:study.actualFrames,suiteReportedStatus:study.status,cancelReportedStatus:cancelled.status,cameraAndConfigurationRestored:true});
  change('surface-mode','normals');const physical=state(),downloadCount=exports.length,drawCount=draws.length;loseOnBlob=true;await byId('inspection-program-audit').onclick();
  assert.equal(byId('inspection-stage').dataset.graphics,'unavailable');assert.equal(orbit[0].enabled,false);assert.equal(state(),physical);assert.equal(draws.length-drawCount,2,'No later case or finally draw may run after context loss');assert.equal(exports.length,downloadCount,'An interrupted capture must not export a success archive');
  for(const element of d.querySelectorAll('button,input,select'))assert.equal(element.disabled,!element.matches('[data-language-select],#capture-meta'),'Context loss must retain the failure-state controls');assert.equal(byId('surface-mode').value,'normals');
  for(const timer of timers)clearTimeout(timer);live.window.close();return{sources:[...loaded,'dist/physics.js'],scope:'Actual inspection entry, original geometry and surface-diagnostic handlers with real rigid-body state and a declared no-draw renderer facade. No GPU or PNG pixel evidence.',cases:results,contextLoss:{stopsAfterFirstCase:true,controlsRemainDisabled:true,noFinalRender:true,physicsUnchanged:true}};
}
const matrixState=await checkMatrixState();
const sourcePaths=[...new Set(['dist/vehicle-inspection.js','dist/vehicle-inspection.html','dist/inspection-capture.js','dist/inspection-diagnostics-capture.js','dist/vehicle-surface-diagnostics.js','dist/i18n-visual-311-en.js','dist/i18n-vehicle-310-en.js','qa/vehicle-inspection-3.10-dom-check.mjs',...matrixState.sources])];delete matrixState.sources;
const report={status:'passed',asOf:new Date().toISOString(),modelVersion:metadata.modelVersion,rendererBuildId:metadata.rendererBuildId,scope:'JSDOM interface and metadata regression, plus actual inspection matrix state handling through a no-draw renderer facade. Not a real-browser, GPU, image or performance result.',acceptanceChange:{reason:'The preceding functional release is now the frozen 3.15 exterior default. The 3.13, 3.9 and 3.8 selection, source identity and legacy comparison paths remain. Standard Three viewport methods were added to the no-draw test facade for photo letterboxing; no GPU result is inferred.'},checks:['3D failure leaves truthful metadata export and language selection available while disabling PNG/ZIP frame capture and reference rendering','3.15 is the new frozen comparison default; 3.13, 3.9 and 3.8 remain selectable','Original-frame ZIP and independent-state JSON labels translate to English and back without storage identity changes','No-GPU metadata has null camera/resolution/device, separate surface protocol, and the actual chosen frozen reference identity','Independent JSON explicitly has current-state-unbound scope and null captureId/frameAssociation','A normals or no-environment starting mode still exercises full PBR materials for all ten matrix cases, then restores the original mode, authored environment, camera, controls and physical state','Context loss aborts the matrix without another draw, export or reenabled controls'],matrixState,sourceHashes:Object.fromEntries(sourcePaths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),expectedRendererErrors:expectedErrors,limits:['A real WebGL device must check baseline loading, PNG/ZIP pixels, geometry/material appearance and motion.']};
writeFileSync(new URL(`../qa/vehicle-inspection-${REPORT_VERSION}-dom.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));window.close();
