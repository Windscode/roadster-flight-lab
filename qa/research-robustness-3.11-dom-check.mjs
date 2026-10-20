import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
// Actual standard-experiment reports delivered through a Worker facade.
// This checks DOM/state/storage contracts; it is not browser graphics evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createResearchStudyPanel} from '../dist/research-lab.js';
import {runExperiment} from '../dist/experiment-worker.js';
import {RoadsterSim} from '../dist/physics.js';
import {registerTranslations,setLanguage,localizeTree} from '../dist/i18n.js';
import {entries,patterns} from '../dist/i18n-research-en.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||'/tmp/roadster-dom-qa/node_modules/jsdom');
const dom=new JSDOM('<!doctype html><html><body><div id="mount"></div></body></html>',{url:'https://windscode.github.io/roadster-flight-lab/?view=lab'}),doc=dom.window.document;
const previous={fetch:globalThis.fetch,Worker:globalThis.Worker,localStorage:globalThis.localStorage};let panel;
dom.window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{},set:()=>true});dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
globalThis.localStorage=dom.window.localStorage;globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../dist/research-panel.html',import.meta.url),'utf8')});
globalThis.Worker=class{postMessage(request){this.timer=setTimeout(()=>{try{this.onmessage({data:{ok:true,report:runExperiment(request)}});}catch(error){this.onmessage({data:{ok:false,error:error.message}});}},0);}terminate(){clearTimeout(this.timer);}};
registerTranslations(entries,patterns);setLanguage('zh');
const oldReport=JSON.parse(readFileSync(new URL('./fixtures/standard-brake-wet-3.8.json',import.meta.url),'utf8')),historical={id:'old-3.8',label:'单次实验',report:oldReport};
const oldText=JSON.stringify(oldReport),store='roadster-research-library-v2',sim=new RoadsterSim({attitudeResponse:3.6},{world:'windlab'}),liveText=JSON.stringify(sim.exportState());
dom.window.localStorage.setItem(store,JSON.stringify([historical]));
const $=id=>panel.root.querySelector(`[data-study-id="${id}"]`),input=id=>$(id).dispatchEvent(new dom.window.Event('input',{bubbles:true})),wait=async fn=>{const end=Date.now()+60000;while(!fn()){assert.ok(Date.now()<end,'Timed out waiting for actual standard reports');await new Promise(resolve=>setTimeout(resolve,10));}};
const han=()=>{const walker=doc.createTreeWalker(doc.body,4),out=[];let node;while((node=walker.nextNode()))if(!node.parentElement.closest('pre,code,input,textarea,script,style,[data-no-i18n]')&&/[\u3400-\u9fff]/.test(node.nodeValue))out.push(node.nodeValue.trim());return [...new Set(out)];};
const evidence=[];
try{
 panel=await createResearchStudyPanel({mount:doc.getElementById('mount'),getSim:()=>sim});panel.open();panel.root.querySelector('[data-preset="attitude"]').click();
 assert.equal($('lab-mode').value,'robustness');assert.equal(panel.getState().pendingExecution.total,20);assert.equal($('robustness-fields').hidden,false);
 $('robustness-delay').value='130';input('robustness-delay');const draft=JSON.parse(dom.window.localStorage.getItem('roadster-study-draft-v1'));assert.equal(draft.robustness.delayMs,130);
 panel.dispose();panel=await createResearchStudyPanel({mount:doc.getElementById('mount'),getSim:()=>sim});panel.open();assert.equal($('lab-mode').value,'robustness');assert.equal($('robustness-delay').value,'130');assert.equal(panel.getState().activeId,'old-3.8');
 $('robustness-delay').value='120';input('robustness-delay');$('protocol-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>panel.getState().pendingExecution.status==='completed');
 let saved=JSON.parse(dom.window.localStorage.getItem(store));assert.equal(saved.length,21);assert.equal(JSON.stringify(saved[0].report),oldText);assert.equal(JSON.stringify(sim.exportState()),liveText);
 const summary=JSON.parse($('robustness-summary').dataset.summary);assert.equal(summary.complete,true);assert.equal(summary.returnedCases,20);assert.equal(summary.pairedCases,10);assert.equal($('robustness-runs').children.length,20);assert.doesNotMatch($('pending-config').textContent,/尚未执行/);
 $('robustness-runs').querySelector('button').click();assert.equal($('response-legend').children.length,2);assert.equal(panel.getState().pendingExecution.status,'completed');
 evidence.push({name:'Twenty real reports, paired curve selection, completed-state persistence and unchanged pre-existing history/live vehicle',status:'PASS',groups:summary.groups,archiveBytes:Buffer.byteLength(dom.window.localStorage.getItem(store))});
 // Replace only presentation text of the pre-existing row for the language
 // check; the historical report itself must remain immutable.
 setLanguage('en');localizeTree(doc.body);const missing=han();assert.deepEqual(missing,[],'All new research controls and result states must be translated');setLanguage('zh');
 evidence.push({name:'New controls, complete and partial results, and selected-curve UI translate without changing raw records',status:'PASS'});
 // A second complete batch exceeds the 4 MiB cap. Earlier data must remain;
 // unpersisted new results stay in memory and the exportable attempt history.
 $('robustness-response').value='2.6';input('robustness-response');$('protocol-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>panel.getState().pendingExecution.status==='completed');
 const firstIds=new Set(saved.map(e=>e.id));saved=JSON.parse(dom.window.localStorage.getItem(store));assert.ok(saved.length<41);assert.ok(saved.length>=21);for(const id of firstIds)assert.ok(saved.some(e=>e.id===id));assert.equal(JSON.stringify(saved.find(e=>e.id==='old-3.8').report),oldText);assert.equal(panel.getState().records,41);assert.equal($('library-notice').hidden,false);assert.equal($('export-robustness').disabled,false);assert.equal($('export-library').disabled,false);
 evidence.push({name:'Storage ceiling retains all earlier records and warns that newer results remain session-only and exportable',status:'PASS',persistedRecords:saved.length,sessionRecords:41,archiveBytes:Buffer.byteLength(dom.window.localStorage.getItem(store))});
 const activeRequest=JSON.parse($('analysis-content').dataset.result);$('load-active-config').click();assert.equal($('lab-mode').value,'imported');const loadedDraft=JSON.parse(dom.window.localStorage.getItem('roadster-study-draft-v1'));assert.equal(loadedDraft.imported.length,1);assert.ok(loadedDraft.imported[0].request.robustness);assert.equal(loadedDraft.imported[0].request.robustness.group,'B');
 evidence.push({name:'Loading one historical robustness case preserves its full noise, seed, delay and fault request for explicit current-model recomputation',status:'PASS',runId:activeRequest.runId});
 const paths=['dist/research-lab.js','dist/research-panel.html','dist/research-robustness.js','dist/i18n-research-en.js','qa/research-robustness-3.11-dom-check.mjs'];
 writeFileSync(new URL(`./research-robustness-${REPORT_VERSION}-dom.json`,import.meta.url),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'JSDOM contracts and actual solver reports through a Worker facade; no layout, native Worker timing, graphics or FPS acceptance.',sourceHashes:Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),evidence},null,2)+'\n');
 for(const row of evidence)console.log('PASS: '+row.name);
}finally{panel?.dispose();setLanguage('zh',{persist:false});globalThis.fetch=previous.fetch;globalThis.Worker=previous.Worker;if(previous.localStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous.localStorage;dom.window.close();}
