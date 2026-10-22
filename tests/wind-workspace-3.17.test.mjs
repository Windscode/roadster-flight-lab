import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createLandingResearchPanel} from '../dist/landing-research-ui.js';
import {executeLandingTask,LANDING_LIBRARY_KEY,parseLandingArchive} from '../dist/landing-challenge.js';
import {executeWindPair,windStudyPlan,windStudyCandidate} from '../dist/wind-control-study.js';
import {contentLabel} from '../dist/experiment-records.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||process.env.JSDOM_MODULE_PATH||'jsdom'),checks=[];
const source=await executeLandingTask({yieldEvery:0}),cancel=new AbortController();
const partial=await executeWindPair({source,wind:{profile:'crosswind',seed:31701,candidateMode:'responsive'},signal:cancel.signal,yieldEvery:120,yieldTask:async()=>{},onProgress:p=>{if(p.timeS>=3)cancel.abort();}});
function panel(records){
 const dom=new JSDOM('<!doctype html><body><main></main></body>',{url:'https://fixture.invalid/'}),doc=dom.window.document,workers=[];
 dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 class WorkerFixture{constructor(){this.messages=[];workers.push(this);}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}}
 dom.window.Worker=WorkerFixture;const storage=dom.window.localStorage;storage.setItem(LANDING_LIBRARY_KEY,JSON.stringify({schema:'roadster.landing-library',version:1,records,algorithms:[source.algorithm.algorithm]}));
 const ui=createLandingResearchPanel({mount:doc.querySelector('main'),getSim:()=>null,getLiveAvailable:()=>false,storage});
 return{doc,ui,workers,storage,dom};
}
{
 const {doc,ui,workers,storage,dom}=panel([source]);
 try{
  doc.querySelector('[data-lr="wind-profile"]').value='strong';doc.querySelector('[data-lr="wind-seed"]').value='9012';doc.querySelector('[data-lr-action="windRun"]').click();assert.equal(workers.length,1);
  const request=workers[0].messages[0],plan=windStudyPlan(source.task,request.wind),candidate=windStudyCandidate(source,request.algorithm,request.wind.candidateMode);
  workers[0].onerror({message:'Intentional Worker failure: preserve request'});
  const saved=parseLandingArchive(storage.getItem(LANDING_LIBRARY_KEY)),attempt=saved.attempts.at(-1);
  assert.equal(attempt.status,'failed');assert.deepEqual(attempt.task,plan.task);assert.deepEqual(attempt.algorithm,candidate);assert.equal(attempt.wind.seed,9012);assert.equal(attempt.wind.profile,'strong');assert.equal(attempt.wind.scheduleHash,plan.scheduleHash);assert.equal(attempt.wind.candidateAlgorithmHash,contentLabel(candidate));assert.equal(attempt.wind.baselineAlgorithmHash,source.algorithm.hash);assert.deepEqual(saved.records,[source]);
  checks.push({name:'Worker failure preserves the actual frozen wind seed, schedule, declared A/B graphs and original source record',status:'passed',attempt:{...attempt,algorithm:contentLabel(attempt.algorithm)}});
 }finally{ui.dispose();dom.window.close();}
}
{
 const {doc,ui,dom}=panel([partial.baseline]);
 try{ui.setPresentation('analysis');const text=doc.querySelector('[data-lr="wind-results"]').textContent;assert.ok(text.includes('2.000–3.000 s · 120/480'));const rows=[...doc.querySelectorAll('[data-lr="wind-results"] tbody tr')];
  for(const label of ['高度 RMSE','水平偏移 RMSE','姿态 RMS','同窗气量','分配受限']){const row=rows.find(r=>r.textContent.includes(label));assert.ok(row,label);assert.deepEqual([...row.querySelectorAll('td')].map(x=>x.textContent),['—','—']);}
  assert.ok(partial.baseline.summary.windResponse.heightRmseM>0);checks.push({name:'A cancelled one-second window shows its actual time/sample count and no four-second metric; partial raw statistics remain',status:'passed'});
 }finally{ui.dispose();dom.window.close();}
}
const paths=['dist/wind-control-study.js','dist/landing-research-ui.js','dist/landing-challenge.js','dist/landing-research-worker.js','tests/wind-workspace-3.17.test.mjs'];
writeFileSync(`qa/wind-workspace-${REPORT_VERSION}.json`,JSON.stringify({schema:'roadster-wind-workspace-3.17',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',checks,sourceHashes:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),scope:'Isolated DOM with an intentionally failing Worker fixture, plus actual solver partial records. Native Worker and pixels are separately recorded.'},null,2)+'\n');for(const c of checks)console.log('PASS '+c.name);
