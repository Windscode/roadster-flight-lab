import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const base=process.argv[2]||'http://127.0.0.1:8317/',output=resolve(process.argv[3]||'qa/research-native-3.17');
const coreOnly=process.env.RESEARCH_CORE_ONLY==='1';
await mkdir(output,{recursive:true});
const report={schema:'roadster-native-research-3.17',startedAt:new Date().toISOString(),steps:[],errors:[],failures:[],scope:'Actual Chromium WebGL with a software GPU; real module Workers and browser downloads. This does not establish user-device performance or explain earlier browser-tool disconnections.'};
report.protocol=coreOnly?'Final source Worker, persistence and layout check; no repeat download or full workflow.':'Full Worker, persistence, bounded download, reload and live-observation workflow.';
const hash=b=>createHash('sha256').update(b).digest('hex');
const bounded=(promise,ms,label)=>new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error(label+' exceeded '+ms+' ms')),ms);promise.then(v=>{clearTimeout(timer);res(v);},e=>{clearTimeout(timer);rej(e);});});
const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROMIUM,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
report.browserVersion=browser.version();
const page=await browser.newPage({viewport:{width:1366,height:960},deviceScaleFactor:1,acceptDownloads:true});
page.setDefaultTimeout(15000);page.on('response',r=>{if(r.status()>=400)report.errors.push({kind:'http',status:r.status(),url:r.url()});});page.on('pageerror',e=>report.errors.push({kind:'pageerror',message:e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({kind:'console',message:m.text()});});
const read=fn=>bounded(page.evaluate(fn),15000,'Read browser state');
const state=()=>read(()=>window.roadsterLab.getState());
async function step(name,fn){const start=Date.now();report.activeStep=name;await save();try{const result=await fn();report.steps.push({name,status:'passed',wallMs:Date.now()-start,...result});console.log(name+' passed');await save();return result;}catch(e){report.steps.push({name,status:'failed',wallMs:Date.now()-start,error:e.message});await save();throw e;}}
async function picture(name){const path=join(output,name);const b=await page.screenshot({path,timeout:15000});return{file:name,bytes:b.length,sha256:hash(b),viewport:{width:1366,height:960}};}
try{
 await step('Start actual lab and pause through application control',async()=>{
  await page.goto(new URL('?view=lab',base).href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.roadsterReady&&window.roadsterLab,null,{timeout:60000});
  if(await page.locator('#menu-resume').isVisible())await page.locator('#menu-resume').click();if(!(await state()).paused)await page.locator('#pause-btn').dispatchEvent('click');
  const s=await state();report.modelVersion=await read(()=>window.roadsterLab.version);report.graphics=s.graphics;
  report.identity=await read(async()=>{const m=await import('./model-build.js');return{modelBuildId:m.MODEL_BUILD_ID,sourceCount:Object.keys(m.MODEL_SOURCE_HASHES).length,sourceHashes:m.MODEL_SOURCE_HASHES};});
  if(!(await state()).research.open)await page.locator('[data-research-console]').first().click();await page.locator('[data-rc-tab="landing"]').click();return{context:s.context,paused:s.paused};
 });
 await step('Actual module Worker creates baseline',async()=>{
  await page.locator('[data-lr-action="numeric"]').click();
  await page.waitForFunction(()=>{const l=window.roadsterLab.getState().research.landing;return!l.numericRunning&&l.recordCount===1;},null,{timeout:60000});
  const s=await state();if(s.research.landing.result.status!=='completed')throw Error('Baseline did not land: '+JSON.stringify(s.research.landing));return{landing:s.research.landing};
 });
 await step('Strong seeded wind A/B runs through existing Worker and saves both records',async()=>{
  await page.locator('[data-lr-present="setup"]').click();await page.locator('[data-lr="wind-profile"]').selectOption('strong');await page.locator('[data-lr="wind-seed"]').fill('31701');await page.locator('[data-lr="wind-seed"]').dispatchEvent('change');
  report.setupFrame=await picture('wind-setup.png');await page.locator('[data-lr-action="windRun"]').click();
  await page.waitForFunction(()=>{const l=window.roadsterLab.getState().research.landing;return!l.numericRunning&&l.recordCount>=3;},null,{timeout:90000});
  const s=await state(),raw=await read(()=>localStorage.getItem('roadster-landing-research-v1'));if(!raw)throw Error('Library did not persist');const archive=JSON.parse(raw);if(archive.records.length!==3)throw Error('Expected 3 saved records');
  await writeFile(join(output,'native-task-library.json'),raw+'\n');report.savedLibrary={bytes:Buffer.byteLength(raw),sha256:hash(raw),records:archive.records.map(r=>({id:r.id,status:r.status,reason:r.reason,identity:r.identity,windComparison:r.windComparison,windResponse:r.summary.windResponse}))};
  await page.locator('[data-rc-workspace="analyze"]').click();await page.locator('[data-lr="wind-results"]').scrollIntoViewIfNeeded();report.analysisFrame=await picture('wind-analysis.png');
  return{landing:s.research.landing,table:await page.locator('[data-lr="wind-results"]').innerText()};
 });
 if(!coreOnly){
 await step('One bounded full-library browser download preserves actual records',async()=>{
  const began=Date.now(),waiting=page.waitForEvent('download',{timeout:30000});await page.locator('[data-lr-action="export"]').click();const d=await waiting,handed=Date.now();const name='native-downloaded-task-library.json';await bounded(d.saveAs(join(output,name)),20000,'Browser file transfer');const data=await readFile(join(output,name)),archive=JSON.parse(data);
  const original=JSON.parse(await readFile(join(output,'native-task-library.json'),'utf8'));if(JSON.stringify(archive.records)!==JSON.stringify(original.records))throw Error('Downloaded records differ from saved records');
  const receipt=await read(()=>window.roadsterLab.getExportState());await page.locator('[data-export="close"]').click();return{file:name,bytes:data.length,sha256:hash(data),downloadEventMs:handed-began,savedMs:Date.now()-began,applicationReceipt:receipt,records:archive.records.length};
 });
 await step('Reload retains wind pair and explanatory table',async()=>{
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.roadsterReady&&window.roadsterLab,null,{timeout:60000});if(await page.locator('#menu-resume').isVisible())await page.locator('#menu-resume').click();if(!(await state()).paused)await page.locator('#pause-btn').dispatchEvent('click');
  if(!(await state()).research.open)await page.locator('[data-research-console]').first().click();await page.locator('[data-rc-tab="landing"]').click();await page.locator('[data-rc-workspace="analyze"]').click();await page.locator('[data-lr-present="analysis"]').click();
  const s=await state(),text=await page.locator('[data-lr="wind-results"]').innerText();if(s.research.landing.recordCount!==3||!text.includes('31701'))throw Error('Wind pair did not survive reload');return{landing:s.research.landing,table:text};
 });
 await step('Selected B starts in same live solver; observation mode clears workspace',async()=>{
  await page.locator('[data-lr-wind-live]').last().click();await page.waitForFunction(()=>window.roadsterLab.getState().research.landing.running,null,{timeout:15000});
  await page.waitForFunction(()=>window.roadsterLab.getState().research.landing.live?.timeS>=1.7,null,{timeout:60000});const s=await state();report.observationFrame=await picture('wind-live-observation.png');
  if(s.research.open)throw Error('Research workspace remained over live observation');if(!s.research.landing.running)throw Error('Live task not running');
  await page.locator('[data-rc-action="stop"]').last().click();await page.waitForFunction(()=>!window.roadsterLab.getState().research.landing.running,null,{timeout:15000});
  const final=await state(),raw=await read(()=>localStorage.getItem('roadster-landing-research-v1'));await writeFile(join(output,'native-task-library-after-cancel.json'),raw+'\n');
  if(final.research.landing.recordCount!==4)throw Error('Cancelled live record was not retained');return{during:s.research,after:final.research};
 });
 }
 report.status='passed';
}catch(e){report.status='failed';report.failures.push({message:e.message,stack:e.stack});try{report.failureFrame=await picture('failure.png');report.failureState=await state();}catch(error){report.failureCaptureError=error.message;}process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();delete report.activeStep;await save();await bounded(browser.close(),20000,'Close browser').catch(e=>console.log(e.message));console.log(JSON.stringify({status:report.status,output,steps:report.steps.length,failures:report.failures}));}
