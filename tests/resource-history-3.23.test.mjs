import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {RoadsterSim} from '../dist/physics.js';
import {ResourceMission,prepareResourceRoute,completeResourcePreparation} from '../dist/resource-mission.js';
import {ResourceHistory,RESOURCE_HISTORY_KEY,parseResourceHistory} from '../dist/resource-history.js';
import {prepare,DT} from './route-driver-3.21.mjs';

const sim=new RoadsterSim();prepareResourceRoute(sim);prepare(sim);completeResourcePreparation(sim);
const mission=new ResourceMission(sim,{descriptorHash:sim.getRouteSurface().descriptorHash});
const telemetry=sim.advanceFixed({throttle:.3},DT);mission.check(sim,telemetry);
const measured=mission.result(sim,'pilot-ended');
const run=id=>({...structuredClone(measured),recordId:id});
function storageWith(raw=null){
  const storage={raw,writes:[],getItem(key){assert.equal(key,RESOURCE_HISTORY_KEY);return this.raw;},setItem(key,text){assert.equal(key,RESOURCE_HISTORY_KEY);this.writes.push(text);this.raw=text;}};
  return storage;
}
const ids=history=>history.runs.map(item=>item.recordId);
const checks=[];

{
  const storage=storageWith(),history=new ResourceHistory(()=>storage);
  for(let i=0;i<8;i++)history.append(run(`normal-${i}`));
  assert.deepEqual(ids(history),Array.from({length:6},(_,i)=>`normal-${i+2}`));
  assert.deepEqual(new ResourceHistory(()=>storage).runs,history.runs);
  assert.deepEqual(history.runs.at(-1).work,measured.work);
  assert.equal(history.snapshot().status,'saved');
  checks.push('Measured resources round-trip exactly through the documented last-six history');
}

for(const original of ['{truncated',JSON.stringify([run('readable'),{schema:'broken'}]),JSON.stringify({unknownFutureSchema:1})]){
  const storage=storageWith(original),history=new ResourceHistory(()=>storage);
  assert.equal(history.snapshot().protectedArchive,true);
  for(let i=0;i<8;i++)history.append(run(`unsaved-${i}`));
  assert.equal(storage.raw,original);assert.equal(storage.writes.length,0);
  assert.equal(history.runs.length,8);assert.equal(history.snapshot().unsavedCount,8);
  assert.equal(history.archive().protectedRaw,original);
  assert.deepEqual(history.archive().runs,history.runs);
}
checks.push('Corrupt, partially readable and unknown archives remain byte-identical and exportable; all unsaved results survive');

{
  const storage=storageWith(JSON.stringify([run('existing')])),history=new ResourceHistory(()=>storage),write=storage.setItem;
  storage.setItem=()=>{throw Error('Quota exceeded');};
  for(let i=0;i<8;i++)history.append(run(`quota-${i}`));
  assert.equal(history.runs.length,9);assert.equal(history.snapshot().unsavedCount,8);
  assert.equal(JSON.parse(storage.raw)[0].recordId,'existing');
  storage.setItem=write;assert.equal(history.save(),true);
  // Retry commits each pending result before normal rolling retention can
  // remove it. No unsaved result is pruned just to make a write fit.
  assert.equal(storage.writes.length,8);
  for(let i=0;i<8;i++)assert(JSON.parse(storage.writes[i]).some(item=>item.recordId===`quota-${i}`));
  assert.equal(history.snapshot().unsavedCount,0);assert.equal(history.runs.length,6);
  checks.push('Quota failure retains all session results and recovery verifies each pending write before rolling retention');
}

{
  const storage=storageWith(),first=new ResourceHistory(()=>storage),second=new ResourceHistory(()=>storage);
  first.append(run('first'));second.append(run('second'));first.append(run('third'));
  assert.deepEqual(parseResourceHistory(storage.raw).map(item=>item.recordId),['first','second','third']);
  first.append({...run('second'),netEnergyJ:123});
  assert.equal(first.snapshot().reason,'conflict');
  assert.equal(parseResourceHistory(storage.raw).find(item=>item.recordId==='second').netEnergyJ,measured.netEnergyJ);
  checks.push('Two stale page views append only new runs; conflicting content for the same record cannot replace evidence');
}

{
  const storage=storageWith(JSON.stringify([run('original')])),history=new ResourceHistory(()=>storage),read=storage.getItem;
  let reads=0;
  storage.getItem=function(key){if(++reads===2)this.raw=JSON.stringify([run('original'),run('other-page')]);return read.call(this,key);};
  history.append(run('local'));
  assert.equal(history.snapshot().reason,'conflict');assert.equal(history.snapshot().unsavedCount,1);
  assert.deepEqual(parseResourceHistory(storage.raw).map(item=>item.recordId),['original','other-page']);
  storage.getItem=read;assert.equal(history.save(),true);
  assert.deepEqual(ids(history),['original','other-page','local']);
  checks.push('A detected change between merge and write preserves the other page and keeps the local run pending for retry');
}

{
  const storage=storageWith(JSON.stringify([run('old')])),history=new ResourceHistory(()=>storage);
  storage.setItem=()=>{};history.append(run('silent-write-failure'));
  assert.equal(history.snapshot().status,'unsaved');assert.equal(history.snapshot().unsavedCount,1);
  assert.deepEqual(ids(history),['old','silent-write-failure']);
  assert.equal(parseResourceHistory(storage.raw).length,1);
  const unavailable=new ResourceHistory(()=>{throw Error('Access denied');});unavailable.append(run('denied'));
  assert.equal(unavailable.snapshot().status,'unsaved');assert.equal(unavailable.archive().runs.length,1);
  checks.push('Silent write failure and storage access denial never report saved or discard in-memory evidence');
}

// Use the actual route controls, simulator, and browser export encoder. A DOM
// adapter does not establish native graphics, download completion or input QA.
const {JSDOM}=createRequire(import.meta.url)(process.env.JSDOM_MODULE_PATH||'jsdom');
const {createRouteExperience}=await import('../dist/route-experience.js');
const {setLanguage}=await import('../dist/i18n.js');
const {getExportState}=await import('../dist/export-download.js');
const dom=new JSDOM('<main><div id="route"></div><div id="hud"></div></main>',{url:'https://resource-history.fixture.invalid/'});
const previousStorage=globalThis.localStorage,previousDocument=globalThis.document;
const original='{old-summary-file-truncated',storage=storageWith(original);
globalThis.localStorage=storage;globalThis.document=dom.window.document;
const doc=dom.window.document,live=new RoadsterSim(),notifications=[];let paused=true,recording={recording:false},downloadedUrl=null;
dom.window.HTMLAnchorElement.prototype.click=function(){downloadedUrl=this.href;};
const ui=createRouteExperience({mount:doc.getElementById('route'),hudMount:doc.getElementById('hud'),getSim:()=>live,getPaused:()=>paused,getContext:()=> 'city',getRecording:()=>recording,
  onPrepare:(_,{prepareSim})=>{prepareSim(live);return{descriptor:prepare(live)};},
  onStart:()=>{paused=false;recording={recording:true,id:'ui-measured'};return recording;},onFinish:()=>{recording={recording:false};return{id:'ui-measured'};},onInspect(){},onOpen(){},onSound(){},onHead(){},notify:message=>notifications.push(message)});
const resource=name=>doc.querySelector(`[data-resource="${name}"]`);
async function click(action){doc.querySelector(`[data-route-action="${action}"]`).click();await Promise.resolve();await Promise.resolve();ui.update();}
try{
  assert.equal(resource('storage').hidden,false);assert.equal(resource('storage').closest('details'),null);
  assert.match(resource('storage').textContent,/保护|protected/);assert.equal(resource('export').disabled,false);
  await click('prepare');await click('start');const t=live.advanceFixed({throttle:.3},DT);ui.afterStep(t,DT);await click('end');
  assert.equal(ui.getState().resourceHistory.length,1);assert.equal(ui.getState().lastResult.reason,'pilot-ended');
  assert.equal(ui.getState().resourcePersistence.status,'unsaved');assert.equal(storage.raw,original);
  assert.match(notifications.at(-1),/摘要未保存，请打开路线面板导出/);
  setLanguage('en',{persist:false});assert.match(resource('storage').textContent,/not saved/);
  paused=true;ui.update();await click('prepare');await click('start');ui.afterStep(live.advanceFixed({throttle:.3},DT),DT);await click('end');
  assert.match(notifications.at(-1),/Summary not saved; open the route panel to export/);
  resource('export').click();
  for(let i=0;i<100&&getExportState(doc).status!=='handed-off';i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(getExportState(doc).status,'handed-off');assert(downloadedUrl);
  const exported=await(await fetch(downloadedUrl)).json();
  assert.equal(exported.protectedRaw,original);assert.deepEqual(exported.runs,ui.getState().resourceHistory);
  assert.equal(exported.persistence.status,'unsaved');
  doc.querySelector('[data-export="close"]').click();
  checks.push('Route UI exposes damaged storage outside its collapsed history and exports original bytes plus the actual new measured result');
}finally{ui.dispose();setLanguage('zh',{persist:false});dom.window.close();if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}

console.log(JSON.stringify({status:'passed',checks,scope:'Production history, physics resources, route UI and export encoding; optimistic conflict detection, not a cross-tab transaction or native browser acceptance.'},null,2));
