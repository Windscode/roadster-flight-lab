import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {RoadsterSim} from '../dist/physics.js';
import {createCityFlightUI} from '../dist/city-flight-ui.js';
import {CITY_FLIGHT_LIBRARY_KEY,validateCityFlightResult} from '../dist/city-flight-challenge.js';
import {contentLabel,currentExperimentIdentity} from '../dist/experiment-records.js';
import {setLanguage} from '../dist/i18n.js';
const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||process.env.JSDOM_MODULE_PATH||'jsdom');
const dom=new JSDOM('<main id="app"><div id="tasks"></div></main>',{url:'https://fixture.invalid/'}),doc=dom.window.document,originalDocument=globalThis.document;globalThis.document=doc;
const draw={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};dom.window.HTMLCanvasElement.prototype.getContext=()=>draw;
const archive=JSON.parse(fs.readFileSync('qa/learning-loop-3.19/three-attempts.json','utf8')),data=new Map([[CITY_FLIGHT_LIBRARY_KEY,JSON.stringify(archive)]]),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
let live=new RoadsterSim({supplyMode:'finite'},{world:'city'});live.reset('city');live.advanceFixed({brake:1});const originalLive=live,originalLabel=contentLabel(live.exportState());let mode='live',preparedSourceId=null;
const ui=createCityFlightUI({mount:doc.getElementById('tasks'),getSim:()=>live,getContext:()=> 'city',getSessionMode:()=>mode,storage,
 onReview:async ({review,step})=>{const state=await review.seekStep(step);if(state.cancelled)return state;live=review.sim;mode='review';return state;},onPractice:({sim,record})=>{live=sim;mode='practice';preparedSourceId=record?.id??null;},onReturn:()=>{live=originalLive;mode='live';}});
const $=key=>ui.panel.querySelector('[data-cf="'+key+'"]'),click=action=>ui.panel.querySelector('[data-cf-action="'+action+'"]').click();
async function until(check){for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('UI did not reach expected state');}
// First-time practice is reachable without importing a saved challenge or
// moving the live car to the task start. It is explicitly a separate class.
await ui.prepareInitialPractice();assert.equal(mode,'practice');assert.equal(ui.getState().practicePrepared,true);assert.equal(contentLabel(originalLive.exportState()),originalLabel);assert.equal(live.params.supplyMode,'bench');
click('start');assert.equal(ui.getState().live.attemptClass,'practice');ui.cancel('pilot_cancel');assert.equal(ui.getRecords().at(-1).parentRunId,null);
click('return-live');await until(()=>mode==='live');assert.equal(contentLabel(live.exportState()),originalLabel);
// Select a real recorded hard landing and enter its isolated review in one
// action; measured first breach values are visible before exporting anything.
const hard=archive.records.find(r=>r.reason==='hard_or_tilted_landing');$('records').value=hard.id;$('records').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
assert.match($('first-violation').textContent,/触地前下降速度/);assert.match($('first-violation').textContent,/1\.400/);assert.match($('first-violation').textContent,/之前发生/);
click('review');await until(()=>ui.getState().review?.mode==='isolated-exact-review'&&!ui.getState().review.busy);assert.equal(mode,'review');assert.equal(ui.deck.hidden,false);assert.equal(ui.getState().review.step,hard.violations[0].step-360);assert.match(ui.deck.textContent,/车头 \/ 速度方向/);assert.match(ui.deck.textContent,/命令 N/);assert.equal(contentLabel(originalLive.exportState()),originalLabel);
ui.deck.querySelector('[data-cf-action="review-exact"]').click();await until(()=>ui.getState().review?.step===hard.violations[0].step&&!ui.getState().review.busy);
// Selecting another record in the panel must not retarget the open review
// deck, and a panel action must use the newly selected record.
const envelope=archive.records.find(r=>r.reason==='gate_envelope_outside');$('records').value=envelope.id;$('records').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
assert.equal(ui.getState().selectedId,envelope.id);assert.equal(ui.getState().review.sourceId,hard.id);
ui.deck.querySelector('[data-cf-action="review-before"]').click();await until(()=>ui.getState().review?.step===hard.violations[0].step-360&&!ui.getState().review.busy);
click('practice');await until(()=>ui.getState().practicePrepared);assert.equal(preparedSourceId,envelope.id);
click('return-live');await until(()=>mode==='live');$('records').value=hard.id;$('records').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
click('review');await until(()=>ui.getState().review?.sourceId===hard.id&&!ui.getState().review.busy);
ui.deck.querySelector('[data-cf-action="practice"]').click();await until(()=>ui.getState().practicePrepared);assert.equal(mode,'practice');assert.equal(contentLabel(live.exportState()),hard.liveExperiment.initialSnapshot.stateLabel);
click('start');const input=ui.beforeStep({brake:1});ui.afterStep(live.advanceFixed(input),input,1/120);ui.cancel('pilot_cancel');const practice=ui.getRecords().at(-1);assert.equal(practice.parentRunId,hard.id);assert.notEqual(practice.runId,hard.id);assert.equal(practice.score.eligible,false);
click('compare');assert.match($('comparison').textContent,/人手输入不同/);assert.match($('comparison').textContent,/完整初态、规则与模型一致/);
const selected=ui.getState().selectedId;setLanguage('en',{persist:false});assert.equal(ui.getState().selectedId,selected);assert.match($('comparison').textContent,/Different human inputs/);assert.match($('learning-note').textContent,/separate vehicle/);
click('return-live');await until(()=>mode==='live');assert.equal(contentLabel(live.exportState()),originalLabel);assert.equal(ui.getState().selectedId,selected);
// An unavailable-build fixture uses retained samples only and leaves the host
// in live mode. Closing its card must not claim a pause it never performed.
const historical=structuredClone(hard);for(const identity of [historical.identity,historical.liveExperiment.identity,historical.liveExperiment.initialSnapshot.identity,historical.liveExperiment.finalSnapshot.identity])if(identity)identity.modelBuildId='unavailable-original-build';validateCityFlightResult(historical);
await ui.reviewAt(100,historical);assert.equal(mode,'live');assert.equal(ui.getState().review.mode,'historical-read-only');assert.match(ui.deck.textContent,/Historical samples/);ui.deck.querySelector('[data-cf-action="return-live"]').click();await until(()=>ui.deck.hidden);assert.match($('state').textContent,/Read-only sample card closed/);assert.doesNotMatch($('state').textContent,/paused/);assert.equal(contentLabel(live.exportState()),originalLabel);
const report={schema:'roadster-learning-ui-3.19',identity:currentExperimentIdentity(),environment:'JSDOM with actual RoadsterSim and replay plus an explicit mock host reference swap; no main.js integration, native graphics or actual keyboard claim',firstPracticeWithoutDrivingLiveCar:true,hardLandingOneActionReview:true,measuredThresholdVisible:true,eventBeforeAndAtSeek:true,panelSelectionAndReviewSourceIndependent:true,sourceInitialStatePreservedForPractice:true,newRunIdWithParent:true,practiceExcludedFromRanking:true,eventComparisonVisible:true,languagePreservesSelection:true,returnPreservesLiveState:true,historicalReadOnlyCloseDoesNotClaimPause:true,records:ui.getRecords().map(r=>({id:r.id,attemptClass:r.attemptClass,parentRunId:r.parentRunId,status:r.status,reason:r.reason}))};
fs.writeFileSync('qa/learning-loop-3.19/ui-report.json',JSON.stringify(report,null,2));ui.dispose();setLanguage('zh',{persist:false});globalThis.document=originalDocument;dom.window.close();
console.log('Learning UI: first practice, measured failure, exact event review, parent practice, comparison and original-scene return passed.');
