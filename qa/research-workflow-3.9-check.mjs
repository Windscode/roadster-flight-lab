// DOM behavior and localization contract with real numerical reports.
// No browser layout, WebGL pixels, native Worker timing or FPS evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createResearchStudyPanel,standardReportCSV} from '../dist/research-lab.js';
import {createResearchConsole} from '../dist/research-console.js';
import {RoadsterSim} from '../dist/physics.js';
import {runExperiment} from '../dist/experiment-worker.js';
import {defaultProgramLibrary,PROGRAM_STORAGE_KEY} from '../dist/flight-programs.js';
import {registerTranslations,setLanguage,getLanguage,getTranslationDiagnostics,resetTranslationDiagnostics,localizeTree,observeTranslations,t} from '../dist/i18n.js';
import {entries,patterns} from '../dist/i18n-research-en.js';

const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||'/tmp/roadster-dom-qa/node_modules/jsdom');
const dom=new JSDOM('<!doctype html><html><head></head><body><div id="study"></div><div id="live"></div></body></html>',{url:'https://windscode.github.io/roadster-flight-lab/?view=lab'}),doc=dom.window.document;
const original={fetch:globalThis.fetch,Worker:globalThis.Worker,localStorage:globalThis.localStorage};
let study,live,stopObserver=null;const evidence=[],requests=[],workers=new Set(),drawnText=[];
dom.window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:(target,key)=>key==='fillText'?text=>drawnText.push(String(text)):key in target?target[key]:()=>{},set:(target,key,value)=>{target[key]=value;return true;}});dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
globalThis.localStorage=dom.window.localStorage;globalThis.fetch=async url=>({ok:true,status:200,text:async()=>readFileSync(new URL('../dist/research-panel.html',import.meta.url),'utf8')});
globalThis.Worker=class{constructor(){this.stopped=false;workers.add(this);}postMessage(request){requests.push(structuredClone(request));this.timer=setTimeout(()=>{if(this.stopped)return;try{this.onmessage?.({data:{ok:true,report:runExperiment(request)}});}catch(error){this.onmessage?.({data:{ok:false,error:error.message}});}},0);}terminate(){this.stopped=true;clearTimeout(this.timer);workers.delete(this);}};
registerTranslations(entries,patterns);setLanguage('zh');
const sim=new RoadsterSim({}, {world:'windlab'}),getSim=()=>sim;
const oldReport=JSON.parse(readFileSync(new URL('./fixtures/standard-brake-wet-3.8.json',import.meta.url),'utf8')),oldEntry={id:'actual-3.8-wet-brake',label:'单次实验',note:'Original historical archive fixture',report:oldReport};
const originalReportJSON=JSON.stringify(oldReport),originalCSV=standardReportCSV(oldEntry);
dom.window.localStorage.setItem('roadster-research-library-v2',JSON.stringify([oldEntry]));
const $=id=>study.root.querySelector(`[data-study-id="${id}"]`),change=el=>el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
const wait=async predicate=>{const end=Date.now()+30000;while(!predicate()){assert.ok(Date.now()<end,'Research UI timeout');await new Promise(resolve=>setTimeout(resolve,10));}};
async function test(name,fn){const data=await fn();evidence.push({name,status:'PASS',...data});console.log('PASS: '+name);}
const hanTexts=()=>{const walker=doc.createTreeWalker(doc.body,4),texts=[];let node;while((node=walker.nextNode()))if(!node.parentElement.closest('pre,code,textarea,input,script,style,[data-no-i18n],[translate="no"]')&&/[\u3400-\u9fff]/.test(node.nodeValue))texts.push(node.nodeValue.trim());return[...new Set(texts)].filter(Boolean);};
try{
  study=await createResearchStudyPanel({mount:doc.getElementById('study'),getSim});study.open();
  await test('The actual 3.8 wet-braking result remains selected independently of the next-run form; edited next-run settings survive refresh',async()=>{
    assert.equal(study.getState().activeId,oldEntry.id);assert.equal(study.getState().pendingRequest.kind,'steer');assert.match($('active-title').textContent,/直线制动/);assert.match($('pending-config').textContent,/转向阶跃/);
    $('lab-kind').value='steer';change($('lab-kind'));$('lab-speed').value='60';change($('lab-speed'));$('lab-angle').value='3';change($('lab-angle'));$('lab-road-surface').value='split';change($('lab-road-surface'));
    study.dispose();study=await createResearchStudyPanel({mount:doc.getElementById('study'),getSim});study.open();assert.equal(study.getState().activeId,oldEntry.id);assert.equal(study.getState().pendingRequest.kind,'steer');assert.equal(+$('lab-speed').value,60);assert.equal(+$('lab-angle').value,3);assert.equal($('lab-road-surface').value,'split');assert.equal(JSON.stringify(JSON.parse(dom.window.localStorage.getItem('roadster-research-library-v2'))[0].report),originalReportJSON);return{selectedResultKind:oldReport.kind,pendingKind:study.getState().pendingRequest.kind,pendingSpeedKmh:60,pendingAngleDeg:3};
  });
  await test('Load historical configuration copies all request controls without running, changing the live vehicle or overwriting the selected response',async()=>{
    const before=JSON.stringify(sim.exportState());$('load-active-config').click();assert.equal(study.getState().activeId,oldEntry.id);assert.equal(study.getState().running,false);assert.equal(requests.length,0);assert.equal(study.getState().pendingRequest.kind,'brake');assert.equal($('lab-road-surface').value,'wet');assert.equal($('lab-abs').checked,false);assert.equal(study.getState().draftSource.modelVersion,'3.8.0');assert.equal(JSON.stringify(sim.exportState()),before);assert.match($('pending-config').textContent,/当前模型 3.9.0/);assert.equal(standardReportCSV(oldEntry),originalCSV);return{sourceVersion:study.getState().draftSource.modelVersion,currentModel:'3.9.0',executionStarted:false};
  });
  await test('Running the loaded history creates a new current-model record with declared provenance and explicit wet-road / assist labels',async()=>{
    $('protocol-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!study.getState().running);assert.equal(study.getState().records,2);const stored=JSON.parse(dom.window.localStorage.getItem('roadster-research-library-v2')),current=stored.at(-1);assert.equal(JSON.stringify(stored[0].report),originalReportJSON);assert.equal(current.report.modelVersion,'3.9.0');assert.equal(current.sourceConfiguration.modelVersion,'3.8.0');assert.match(current.label,/湿地/);assert.match(current.label,/ABS关闭/);assert.match(current.label,/TCS开启/);return{historicalDistanceM:oldReport.metrics.stop.distanceM,currentDistanceM:current.report.metrics.stop.distanceM,historicalLockedSeconds:oldReport.metrics.lockedWheelSeconds,currentLockedSeconds:current.report.metrics.lockedWheelSeconds,sourceConfiguration:current.sourceConfiguration};
  });
  await test('English research panels, chart labels and prompts use presentation strings while JSON/CSV, user names and physical state stay unchanged',async()=>{
    const programs=defaultProgramLibrary(),customName='完成 · 高度与姿态阶跃';programs.programs.push({...structuredClone(programs.programs[0]),id:'user-i18n-fixture',name:customName,shortcut:'Digit9'});dom.window.localStorage.setItem(PROGRAM_STORAGE_KEY,JSON.stringify(programs));
    live=createResearchConsole({mount:doc.getElementById('live'),getSim,getContext:()=> 'lab',getLiveAvailable:()=>false});live.open('experiments');stopObserver=observeTranslations(doc.body);const physical=JSON.stringify(sim.exportState()),archive=dom.window.localStorage.getItem('roadster-research-library-v2');resetTranslationDiagnostics();setLanguage('en');await new Promise(resolve=>setTimeout(resolve,5));localizeTree(doc.body);
    assert.equal(getLanguage(),'en');assert.equal(dom.window.localStorage.getItem('roadster-language'),'en');assert.match($('pending-config').textContent,/Next run/);assert.match($('selected-result-context').textContent,/Viewing a saved result/);assert.match($('active-title').textContent,/Straight-line braking/);assert.equal($('load-active-config').textContent,"Load this record's configuration");assert.equal(JSON.stringify(sim.exportState()),physical);assert.equal(dom.window.localStorage.getItem('roadster-research-library-v2'),archive);assert.equal(standardReportCSV(oldEntry),originalCSV);
    assert.equal(doc.querySelector('[data-rc="program-select"] option[value="user-i18n-fixture"]').textContent,customName+' · 9');assert.equal(doc.querySelector('[data-rc="program-select"] option[value="user-i18n-fixture"]').hasAttribute('data-no-i18n'),true);assert.match(doc.querySelector('[data-rc="program-select"] option[value="pose-step"]').textContent,/Height & attitude/);assert.equal(dom.window.localStorage.getItem(PROGRAM_STORAGE_KEY),JSON.stringify(programs));
    const missing=hanTexts();if(missing.length){writeFileSync('/tmp/roadster-research-missing-39.json',JSON.stringify({visible:missing,diagnostics:getTranslationDiagnostics().missing},null,2));console.log('UNTRANSLATED',missing);}
    assert.deepEqual(missing,[],'Untranslated research UI text (raw names/JSON excluded)');return{language:getLanguage(),catalogEntries:Object.keys(entries).length,catalogPatterns:patterns.length,rawHistoryUnchanged:true,graphicsAcceptance:false};
  });
  await test('Switching back restores Chinese presentation and preserves editable numeric configuration',async()=>{
    const request=study.getState().pendingRequest;setLanguage('zh');await new Promise(resolve=>setTimeout(resolve,5));localizeTree(doc.body);assert.match($('pending-config').textContent,/待运行/);assert.equal($('load-active-config').textContent,'载入此记录的配置');assert.match($('lab-kind').options[0].textContent,/转向阶跃/);assert.deepEqual(study.getState().pendingRequest,request);assert.equal(standardReportCSV(oldEntry),originalCSV);return{language:'zh',numericConfigurationUnchanged:true};
  });
  const files=['dist/research-lab.js','dist/research-panel.html','dist/research-study.js','dist/research-console.js','dist/experiment-console.js','dist/i18n.js','dist/i18n-research-en.js','qa/research-workflow-3.9-check.mjs','qa/fixtures/standard-brake-wet-3.8.json'];
  writeFileSync(new URL('./research-workflow-3.9.json',import.meta.url),JSON.stringify({status:'passed',scope:'JSDOM text/events and actual numerical Roadster solver reports through a Worker endpoint facade. No browser layout, GPU pixels, native Worker timing or FPS acceptance.',sourceHashes:Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),evidence},null,2)+'\n');
}finally{stopObserver?.();live?.dispose();study?.dispose();setLanguage('zh',{persist:false});globalThis.fetch=original.fetch;globalThis.Worker=original.Worker;if(original.localStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=original.localStorage;dom.window.close();}
