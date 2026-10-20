import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {auditNativeSourceIdentity} from '../qa/native-source-identity-3.16.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const url=process.env.ROADSTER_URL||'http://127.0.0.1:8316/',out=resolve(process.env.ROADSTER_CAPTURE_DIR||'qa/native-ui-3.16'),baseline=process.argv.includes('--baseline');mkdirSync(out,{recursive:true});
const fixturePath='qa/height-study-fixtures-3.15.json',fixtureRaw=readFileSync(fixturePath,'utf8'),fixture=JSON.parse(fixtureRaw),errors=[],consoleErrors=[],captures=[];
const sha=data=>createHash('sha256').update(data).digest('hex');
const sourcePaths=['model-build.js','main.js','index.html','style.css','game.css','research-console.js','research-console.css','landing-research-ui.js','research.css'];
async function sourceHashes(){const pairs=await Promise.all(sourcePaths.map(async path=>{const response=await fetch(new URL(path,url));if(!response.ok)throw Error('Capture source unavailable: '+path);return[path,sha(Buffer.from(await response.arrayBuffer()))];}));return Object.fromEntries(pairs);}
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROME||'/tmp/roadster-browser-316/chrome-linux64/chrome',headless:true,env:{...process.env,...(process.env.ROADSTER_FONTCONFIG?{FONTCONFIG_FILE:process.env.ROADSTER_FONTCONFIG}:{})},args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,acceptDownloads:true});
// Only the repository's already-existing synthetic result library is loaded.
// No solver state, pose, control decision or result values are injected.
await context.addInitScript(raw=>{localStorage.setItem('roadster-language','zh');localStorage.setItem('roadster-quality','balanced');if(localStorage.getItem('roadster-landing-research-v1')===null)localStorage.setItem('roadster-landing-research-v1',raw);},JSON.stringify(fixture));
const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.stack));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
const state=()=>page.evaluate(()=>{const t=window.roadsterLab?.getState();if(!t)return null;const research={...t.research},landing=research.landing;if(landing?.live?.result){const r=landing.live.result;research.landing={...landing,live:{...landing.live,result:{id:r.id,status:r.status,reason:r.reason,summary:r.summary}}};}return{version:window.roadsterLab.version,simTime:t.simTime,paused:t.paused,context:t.context,mode:t.mode,quality:t.quality,cameraMode:t.cameraMode,position:t.position,quaternion:t.quaternion,research,graphics:t.graphics};});
async function capture(name){console.log('capture '+name);const filename=name+'.png',beforeCapture=await state();await page.screenshot({path:join(out,filename),timeout:45000});captures.push({filename,sha256:sha(readFileSync(join(out,filename))),beforeCapture,state:await state(),scope:'Telemetry brackets asynchronous screenshot capture; a running/ended filename is an intended checkpoint, not an exact same-frame certificate.',ui:await page.evaluate(()=>{const r=document.querySelector('.research-console'),a=document.querySelector('.lr-setup'),b=document.querySelector('.lr-analysis');const box=x=>{if(!x)return null;const z=x.getBoundingClientRect(),style=getComputedStyle(x),visible=x.getClientRects().length>0&&z.width>0&&z.height>0&&style.display!=='none'&&style.visibility!=='hidden';return{x:z.x,y:z.y,width:z.width,height:z.height,visible,intersectsViewport:visible&&z.right>0&&z.bottom>0&&z.left<innerWidth&&z.top<innerHeight};};return{research:box(r),setup:box(a),analysis:box(b),bodyClasses:document.body.className,horizontalOverflow:document.documentElement.scrollWidth>innerWidth};})});}
let device=null,identity=null,sourceHashesBefore=null,sourceHashesAfter=null,servedIdentityBefore=null,servedIdentityAfter=null,exportEvidence=null,lifecycleEvidence=null,failure=null;
try{
  servedIdentityBefore=await auditNativeSourceIdentity(url,{expectedBuildId:process.env.ROADSTER_EXPECTED_BUILD});
  sourceHashesBefore=await sourceHashes();
  console.log('open '+url);await page.goto(new URL('?view=lab',url).href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.roadsterLab?.getState().context==='lab',null,{timeout:90000});console.log('lab ready');
  identity=await page.evaluate(()=>window.roadsterLab.getInputTimeline().identity);if(process.env.ROADSTER_EXPECTED_BUILD&&identity.modelBuildId!==process.env.ROADSTER_EXPECTED_BUILD)throw Error('Loaded build differs from the requested frozen build');
  device=await page.evaluate(()=>{const gl=document.querySelector('#viewport canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{webgl2:!!gl,vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};});
  await page.locator('[data-rc-tab="landing"]').click();await capture('01-prepare');
  if(!baseline)await page.locator('[data-rc-workspace="analyze"]').click();
  await page.locator('[data-lr="records"]').selectOption(fixture.records[0].id);await page.locator('[data-lr="compare-record"]').selectOption(fixture.records[1].id);
  await page.locator('.rc-body').evaluate(node=>{node.scrollTop=0;});await capture('02-results');
  if(!baseline){await page.locator('[data-rc-workspace="operate"]').click();await page.locator('[data-rc-action="observe"]').click();await capture('03-observe');await page.locator('[data-rc-action="show-running"]').click();}
  // The native click-to-anchor interval brackets the application handler. It
  // excludes Playwright command queuing and cannot establish disk completion.
  await page.evaluate(()=>{window.__exportTiming={};document.addEventListener('click',e=>{if(e.target.closest('[data-lr-action="export"]'))window.__exportTiming.startedAt=performance.now();},true);const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==='roadster-landing-research.json'){window.__exportTiming.handedOffAt=performance.now();window.__exportTiming.applicationHandlerMs=window.__exportTiming.handedOffAt-window.__exportTiming.startedAt;}return click.call(this);};});
  const observedStart=performance.now(),downloadPromise=page.waitForEvent('download',{timeout:60000});await page.locator('[data-lr-action="export"]').click();const download=await downloadPromise;console.log('download event');
  const destination=join(out,'task-library.json');await download.saveAs(destination);const downloadFailure=await download.failure(),raw=readFileSync(destination),archive=JSON.parse(raw);
  exportEvidence={application:await page.evaluate(()=>window.__exportTiming),receipt:await page.evaluate(()=>window.roadsterLab.getExportState?.()??null),automationObservedMs:performance.now()-observedStart,browserDownloadFailure:downloadFailure,bytes:raw.length,sha256:sha(raw),filename:'task-library.json',recordsEqualToFixture:JSON.stringify(archive.records)===JSON.stringify(fixture.records),sourceRecords:fixture.records.map(r=>r.id)};
  if(downloadFailure||!exportEvidence.recordsEqualToFixture)throw Error('Native export failed or changed source records');
  if(!baseline)await capture('04-export-handoff');
  if(!baseline){
    // This is one explicitly new current-model task to inspect the new
    // operating/running/finished/saved/return states. The historical graph
    // editing and comparison workflow is not repeated or relabelled.
    await page.locator('[data-rc-workspace="operate"]').click();
    lifecycleEvidence={before:await state(),scope:'One new current-model default PD task, launched through its existing native Live challenge button. Original 3.15 records remain unchanged; this does not redo their accepted graph-edit workflow.'};
    await page.locator('[data-lr-action="live"]').click();
    await page.waitForFunction(()=>window.roadsterLab.getState().research.landing.running,{},{timeout:60000});
    lifecycleEvidence.running=await state();await capture('05-task-running');
    await page.waitForFunction(()=>{const r=window.roadsterLab.getState().research.landing;return !r.running&&!!r.live?.result;},{},{timeout:240000,polling:100});
    lifecycleEvidence.ended=await state();await capture('06-task-ended');
    await page.locator('[data-rc-action="show-running"]').click();await page.locator('[data-rc-workspace="analyze"]').click();
    await capture('07-new-result');
    const onePromise=page.waitForEvent('download',{timeout:90000});await page.locator('[data-lr-action="one"]').click();const one=await onePromise;await one.saveAs(join(out,'current-model-task.json'));
    const oneRaw=readFileSync(join(out,'current-model-task.json')),record=JSON.parse(oneRaw),oneFailure=await one.failure();
    const rawStored=await page.evaluate(()=>localStorage.getItem('roadster-landing-research-v1')),stored=JSON.parse(rawStored);
    lifecycleEvidence.result={filename:'current-model-task.json',bytes:oneRaw.length,sha256:sha(oneRaw),browserDownloadFailure:oneFailure,id:record.id,identity:record.identity,status:record.status,reason:record.reason,summary:record.summary,exitContract:record.exitContract};
    lifecycleEvidence.storage={bytes:Buffer.byteLength(rawStored),sha256:sha(rawStored),newRecordSaved:stored.records.some(r=>JSON.stringify(r)===JSON.stringify(record)),historicalRecordsExact:fixture.records.every(r=>JSON.stringify(r)===JSON.stringify(stored.records.find(v=>v.id===r.id)))};
    if(oneFailure||record.identity.modelBuildId!==identity.modelBuildId||!lifecycleEvidence.storage.newRecordSaved||!lifecycleEvidence.storage.historicalRecordsExact)throw Error('Current task export identity, new record persistence or original history preservation failed');
    // The initializer only fills an empty isolated library. Refresh therefore
    // reads the actual saved bytes rather than silently restoring the fixture.
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.roadsterLab?.getState().context==='lab',null,{timeout:90000});
    await page.locator('[data-rc-tab="landing"]').click();await page.locator('[data-rc-workspace="analyze"]').click();
    const refreshedRaw=await page.evaluate(()=>localStorage.getItem('roadster-landing-research-v1'));lifecycleEvidence.storage.refreshBytesExact=rawStored===refreshedRaw;
    await page.locator('[data-lr="records"]').selectOption(record.id);
    lifecycleEvidence.refreshed=await state();await capture('08-saved-refresh');
    if(!lifecycleEvidence.storage.refreshBytesExact)throw Error('Native refresh changed the stored library bytes');
    await page.locator('[data-rc-action="context"]').click();await page.waitForFunction(()=>window.roadsterLab.getState().context==='city',{},{timeout:90000});
    lifecycleEvidence.returned=await state();await capture('09-return-city');
  }
  sourceHashesAfter=await sourceHashes();if(JSON.stringify(sourceHashesBefore)!==JSON.stringify(sourceHashesAfter))throw Error('Source changed during the native UI capture');
  servedIdentityAfter=await auditNativeSourceIdentity(url,{expectedBuildId:identity.modelBuildId});if(JSON.stringify(servedIdentityBefore)!==JSON.stringify(servedIdentityAfter))throw Error('Served source or baked assets changed during the native UI capture');
}catch(error){failure={message:error.message,stack:error.stack};console.log('FAIL '+error.message);}
finally{
  const report={generatedAt:new Date().toISOString(),url,baseline,identity,sourceHashesBefore,sourceHashesAfter,servedIdentityBefore,servedIdentityAfter,scope:'Actual Chrome/WebGL whole-page UI and native DOM control interactions. Existing synthetic 3.15 results are viewed and exported; the already-accepted graph-edit workflow is not repeated or claimed as a new result. The new current-model task only checks lifecycle presentation and history-preserving persistence. This run does not claim hardware-GPU performance.',fixture:{path:fixturePath,sha256:sha(fixtureRaw),identity:fixture.records.map(r=>r.identity)},device,captures,exportEvidence,lifecycleEvidence,errors,consoleErrors,failure};writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({captures:captures.length,exportEvidence,lifecycleEvidence:lifecycleEvidence?.result,failure,errors}));if(failure||errors.length)process.exitCode=1;
}
