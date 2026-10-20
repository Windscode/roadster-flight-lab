// Run only after the release source has stopped changing and its build has been
// regenerated. Operates an independent local browser through the real UI.
// ROADSTER_EXPECTED_BUILD=<64-hex> ROADSTER_CHROMIUM=/path/to/chrome \
//   node qa/capture-vehicle-finish-3.16.mjs OUTPUT_DIR CANDIDATE_URL BASELINE_URL
// Example URLs are http://127.0.0.1:8316/ and http://127.0.0.1:8315/.
// No pixels are generated, edited, rescaled or replaced by this harness.
// To stop a running task, create OUTPUT_DIR/cancel-requested. During the study
// this uses its existing Stop button and retains the product's partial ZIP;
// otherwise it stops at the active page/next stage and keeps completed files.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {crc32} from '../dist/capture-archive.js';

const [outputArg,candidateArg,baselineArg]=process.argv.slice(2);
if(!outputArg||!candidateArg||!baselineArg||!/^[0-9a-f]{64}$/.test(process.env.ROADSTER_EXPECTED_BUILD||''))throw Error('Supply OUTPUT_DIR, CANDIDATE_URL, BASELINE_URL and exact ROADSTER_EXPECTED_BUILD.');
const require=createRequire(import.meta.url),moduleRoot=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=moduleRoot?require(moduleRoot+'/playwright'):require('playwright');
const output=resolve(outputArg),candidate=new URL(candidateArg),baseline=new URL(baselineArg),expectedBuild=process.env.ROADSTER_EXPECTED_BUILD;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
const viewport={width:1280,height:720},errors=[],requests=[],attemptStarted=new Date().toISOString();
const sourcePaths=['vehicle.js','main.js','vehicle-layout.js','vehicle-inspection.js','vehicle-inspection.html','vehicle-inspection.css','vehicle-display-study.js','vehicle-study-capture.js','vehicle-reference-3.15.js','vehicle-reference-layout-3.15.js','vehicle-models.js','physics.js','model-build.js','visual-presets.js','receiver-plane-shadows.js','vehicle-surface-diagnostics.js','render-program-diagnostics.js','inspection-capture.js','capture-archive.js','vendor/three.module.js','assets/environment.hdr'];
const originalSourcePaths=['vehicle.js','vehicle-layout.js','vehicle-inspection.js','vehicle-inspection.html','vehicle-inspection.css','vehicle-display-study.js','visual-presets.js','physics.js','vehicle-models.js','model-build.js','receiver-plane-shadows.js','vehicle-surface-diagnostics.js','render-program-diagnostics.js','inspection-capture.js','vendor/three.module.js','assets/environment.hdr'];
await mkdir(output,{recursive:true});
const summary={schema:'roadster-native-vehicle-capture-3.16',status:'running',attemptStarted,expectedBuild,viewport,deviceScaleFactor:1,headless:true,interaction:'DOM click events on the actual product capture/camera controls. Live WebGL pixels; no hardware pointer or driving-input acceptance is implied.',sourceScope:'Same-current-renderer 24-frame comparison; separately bracketed stock views on the original 3.15 and current 3.16 pages; two current driving-cockpit paused views with atomic frame conditions.',browserVersion:null,errors,requests,timings:{},suite:null,stock:[],driver:[]};
const cancelFile=join(output,'cancel-requested');let currentPage=null,activePhase='preparing',cancelRequested=false,cancelPokePending=false,cancelAppliedToStudy=false;
function markCancellation(){if(cancelRequested)return;cancelRequested=true;summary.cancelRequestedAt=new Date().toISOString();summary.cancellation={reason:'Local task marker',marker:cancelFile,phase:activePhase};console.log('Cancellation requested during',activePhase);}
function checkCancellation(){if(cancelRequested||existsSync(cancelFile)){markCancellation();const error=Error('Capture cancelled by its local task marker; completed files are retained.');error.name='CaptureTaskCancelled';throw error;}}

async function hashSources(base,paths){
  const result={};for(const path of paths){const response=await fetch(new URL(path,base));assert.equal(response.status,200,path);result[path]=sha(Buffer.from(await response.arrayBuffer()));}return result;
}
function unpackStoredZip(bytes){
  const files=new Map();let at=0;
  while(bytes.readUInt32LE(at)===0x04034b50){
    assert.equal(bytes.readUInt16LE(at+8),0,'The capture format is expected to use STORE, without recompression');
    const checksum=bytes.readUInt32LE(at+14),length=bytes.readUInt32LE(at+18),nameLength=bytes.readUInt16LE(at+26),extraLength=bytes.readUInt16LE(at+28);
    const name=bytes.toString('utf8',at+30,at+30+nameLength);assert.match(name,/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/);
    const start=at+30+nameLength+extraLength,data=bytes.subarray(start,start+length);assert.equal(crc32(data),checksum,name+' CRC');assert.equal(files.has(name),false,name+' duplicate');files.set(name,data);at=start+length;
  }
  return files;
}
function pngSize(bytes){assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');return[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];}
async function bounded(promise,timeout,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded '+timeout+' ms')),timeout);})]);}finally{clearTimeout(timer);}}
async function click(page,selector){assert.equal(await page.locator(selector).isEnabled(),true,selector);await page.locator(selector).dispatchEvent('click');}
async function download(page,id,path,timeout=60000){
  checkCancellation();
  const promise=page.waitForEvent('download',{timeout});await click(page,'#'+id);const file=await promise;
  await bounded(file.saveAs(path),120000,'Browser download save');const failure=await bounded(file.failure(),30000,'Browser download result');assert.equal(failure,null);return{path,suggestedName:file.suggestedFilename(),bytes:await readFile(path)};
}
async function state(page,path){const saved=await download(page,'capture-meta',path);return JSON.parse(saved.bytes);}
function comparable(record){const wing=record.wing?{deployment:record.wing.deployment,command:record.wing.command,position:record.wing.position,incidenceRad:record.wing.incidenceRad,mode:record.wing.mode}:null;return{camera:record.camera,lighting:record.lighting,toneMappingExposure:record.toneMappingExposure,environmentIntensity:record.environmentIntensity,resolution:record.resolution,pixelRatio:record.pixelRatio,quality:record.quality,steer:record.steer,suspensionLength:record.suspensionLength,cutaway:record.cutaway,seal:record.seal,wing,displayConfiguration:record.displayConfiguration,lampMode:record.lampMode};}
function matchingConditions(a,b,label){
  if(typeof a==='number'&&typeof b==='number'){assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-12*Math.max(1,Math.abs(a),Math.abs(b)),label);return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a),Object.keys(b),label);for(const key of Object.keys(a))matchingConditions(a[key],b[key],label+'.'+key);return;}
  assert.equal(a,b,label);
}
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROMIUM||undefined,headless:true,args:['--no-sandbox'],env:process.env});
summary.browserVersion=browser.version();
const cancelTimer=setInterval(()=>{
  if(!cancelRequested&&existsSync(cancelFile))markCancellation();
  if(!cancelRequested||cancelPokePending)return;cancelPokePending=true;
  (async()=>{
    if(!currentPage||currentPage.isClosed())return;
    if(activePhase==='suite'){
      const stop=currentPage.locator('#capture-stop');
      if(!cancelAppliedToStudy&&await stop.isEnabled()){await stop.dispatchEvent('click');cancelAppliedToStudy=true;summary.cancellation.productStopButtonUsed=true;}
    }else await currentPage.close();
  })().catch(error=>{summary.cancellationHandlingError=error.message;}).finally(()=>{cancelPokePending=false;});
},1000);
function observe(page,label){
  page.on('pageerror',error=>errors.push({page:label,type:'pageerror',message:error.message}));
  page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push({page:label,type:message.type(),message:message.text()});});
  page.on('response',response=>{if(response.status()>=400)requests.push({page:label,url:response.url(),status:response.status()});});
  page.on('requestfailed',request=>requests.push({page:label,url:request.url(),failure:request.failure()?.errorText}));
}
async function pageAt(base,label,display='experimental'){
  checkCancellation();const start=performance.now(),page=await browser.newPage({viewport,deviceScaleFactor:1,acceptDownloads:true});currentPage=page;observe(page,label);
  const url=new URL('vehicle-inspection.html',base);url.searchParams.set('display',display);await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#inspection-stage')?.dataset.graphics==='ready'&&document.querySelector('#ready')?.textContent.includes('光棚已就绪'),null,{timeout:90000});
  await page.locator('#inspection-quality').selectOption('ultra');summary.timings[label+'ReadyMs']=performance.now()-start;console.log(label,'ready',Math.round(summary.timings[label+'ReadyMs']),'ms');return page;
}

try{
  summary.sourceHashesBefore=await hashSources(candidate,sourcePaths);
  const page=await pageAt(candidate,'candidate-suite');
  await page.locator('#reference-version').selectOption('3.15');
  const initial=await state(page,join(output,'candidate-initial-state-unbound.json'));assert.equal(initial.modelBuildId,expectedBuild);assert.equal(initial.modelVersion,'3.16.0');assert.equal(initial.steer,0);assert.equal(initial.suspensionLength,.287);assert.equal(initial.cutaway,false);assert.equal(initial.seal,false);
  summary.graphicsDevice=initial.graphicsDevice;
  activePhase='suite';const started=performance.now(),zip=await download(page,'capture-study',join(output,'vehicle-study-originals.zip'),240000);
  summary.timings.suiteClickThroughSavedDownloadMs=performance.now()-started;
  const files=unpackStoredZip(zip.bytes),study=JSON.parse(files.get('vehicle-study.json'));
  const folder=join(output,'study');await mkdir(folder,{recursive:true});for(const [name,bytes]of files)await writeFile(join(folder,name),bytes);
  summary.suitePartial={status:study.status,actualFrames:study.actualFrames,expectedFrames:study.expectedFrames,error:study.error,archive:'vehicle-study-originals.zip',suggestedDownloadName:zip.suggestedName};
  checkCancellation();activePhase='suite-verification';
  assert.equal(study.status,'completed');assert.equal(study.actualFrames,24);assert.equal(study.expectedFrames,24);
  const views=[];let maximumActiveSamplerElements=0;
  for(const frame of study.frames){
    const bytes=files.get(frame.file);assert.ok(bytes,frame.file);assert.deepEqual(pngSize(bytes),study.resolution);assert.equal(frame.programAudit.status,'passed',frame.id+' actual draw');
    assert.equal(frame.conditions.rendererBuildId,expectedBuild);assert.equal(frame.conditions.frameAssociation.captureId,study.captureId);assert.equal(frame.conditions.frameAssociation.imageFile,frame.file);assert.equal(frame.conditions.frameAssociation.pixelsEdited,false);
    assert.equal(frame.conditions.displayConfiguration,'experimental');
    assert.equal(frame.conditions.modelVersion,frame.role==='reference'?'3.15.0':'3.16.0');
    if(frame.role==='reference')assert.equal(frame.conditions.baselineCommit,'9f6c8f47a2678beee3915a0320ac2bf93312e96b');
    for(const program of frame.programAudit.programs)maximumActiveSamplerElements=Math.max(maximumActiveSamplerElements,program.activeSamplerElements??0);
    views.push({id:frame.id,path:'study/'+frame.file,sha256:sha(bytes),bytes:bytes.length,resolution:pngSize(bytes),sourceModelVersion:frame.conditions.modelVersion,rendererBuildId:frame.conditions.rendererBuildId,drawStatus:frame.programAudit.status,drawCalls:frame.programAudit.drawCalls,programCount:frame.programAudit.programCount});
  }
  for(let i=0;i<study.frames.length;i+=2){
    const old=study.frames[i],current=study.frames[i+1];assert.equal(old.role,'reference');assert.equal(current.role,'current');
    // 3.15 records its inherited lamp mode as legacy-fixed-low-beam. Both
    // identities use the same low-beam values, with exact pose/light/camera.
    const a=comparable(old.conditions),b=comparable(current.conditions);delete a.lampMode;delete b.lampMode;matchingConditions(a,b,old.id+' conditions');assert.equal(old.conditions.simTime,current.conditions.simTime);
  }
  summary.suite={captureId:study.captureId,status:study.status,actualFrames:study.actualFrames,archive:'vehicle-study-originals.zip',archiveSHA256:sha(zip.bytes),conditions:'study/vehicle-study.json',maximumActiveSamplerElements,views};
  await page.screenshot({path:join(output,'candidate-suite-completed-ui.png')});await page.close();currentPage=null;console.log('suite completed',study.actualFrames,'actual frames');

  // The frozen-reference suite intentionally uses the experimental identity.
  // Stock uses the original 3.15 page and current 3.16 page with identical UI
  // settings. A pair of independent states brackets each PNG; these records
  // are explicitly NOT represented as an atomic capture companion.
  const stockFolder=join(output,'stock');await mkdir(stockFolder,{recursive:true});
  const stockBeforeHashes=await hashSources(baseline,originalSourcePaths);summary.original315SourceHashes=stockBeforeHashes;
  activePhase='stock';
  for(const [version,base]of [['3.15',baseline],['3.16',candidate]]){
    const stockPage=await pageAt(base,'stock-'+version,'official-study');
    for(const lighting of ['studio','daylight'])for(const view of ['front-quarter','cabin']){
      await click(stockPage,'#'+(lighting==='studio'?'studio-light':'day-light'));await click(stockPage,'button[data-view="'+view+'"]');
      const id=lighting+'-'+view+'-'+version,first=await state(stockPage,join(stockFolder,id+'-state-before-unbound.json'));
      assert.equal(first.displayConfiguration,'official-study');assert.equal(first.lighting,lighting);assert.equal(first.modelVersion,version+'.0');assert.equal(first.modelBuildId,version==='3.16'?expectedBuild:'0ca13961ae8e9db6061a0e6ca63f9e56ada83ead5848b1724b48a05ee778978b');
      const png=await download(stockPage,'capture-frame',join(stockFolder,id+'.png')),last=await state(stockPage,join(stockFolder,id+'-state-after-unbound.json'));
      matchingConditions(comparable(first),comparable(last),id+' bracketed camera/light/articulation changed');assert.deepEqual(pngSize(png.bytes),first.resolution);assert.equal(last.lastProgramAudit.status,'passed',id+' actual single-frame draw audit');
      summary.stock.push({id,path:'stock/'+id+'.png',sha256:sha(png.bytes),bytes:png.bytes.length,resolution:pngSize(png.bytes),beforeState:'stock/'+id+'-state-before-unbound.json',afterState:'stock/'+id+'-state-after-unbound.json',sourceModelVersion:first.modelVersion,rendererBuildId:first.rendererBuildId,comparableConditions:comparable(first),scope:'Real PNG from the original version page. Two independent state exports bracket it and agree on camera, light, articulation and display. They are not an atomic frame companion.'});
      console.log('stock',id,'saved');
    }
    await stockPage.close();currentPage=null;
  }
  for(const lighting of ['studio','daylight'])for(const view of ['front-quarter','cabin']){
    const old=summary.stock.find(row=>row.id===lighting+'-'+view+'-3.15'),current=summary.stock.find(row=>row.id===lighting+'-'+view+'-3.16');matchingConditions(old.comparableConditions,current.comparableConditions,lighting+' '+view+' original-page A/B conditions');
  }
  assert.deepEqual(await hashSources(baseline,originalSourcePaths),stockBeforeHashes,'The original 3.15 page changed during capture');

  // The real driving camera now includes the existing cabin. These two paused
  // city views exercise that path at the normal balanced preset. They are
  // final-current illustrations, not an old/new or moving-driving comparison.
  const driverViewport={width:1440,height:900},driverFolder=join(output,'driver');await mkdir(driverFolder,{recursive:true});
  checkCancellation();activePhase='driver';const driverPage=await browser.newPage({viewport:driverViewport,deviceScaleFactor:1,acceptDownloads:true});currentPage=driverPage;observe(driverPage,'driver');
  await driverPage.goto(candidate.href,{waitUntil:'domcontentloaded',timeout:60000});
  await driverPage.waitForFunction(()=>!!window.roadsterLab,null,{timeout:90000});
  await click(driverPage,'#play-city');
  if(!(await driverPage.evaluate(()=>window.roadsterLab.getState().paused)))await click(driverPage,'#pause-btn');
  for(let i=0;i<4&&!(await driverPage.locator('#camera-name').textContent()).includes('驾驶员');i++)await click(driverPage,'#camera-btn');
  await driverPage.waitForFunction(()=>window.roadsterLab.getState().cameraMode==='cockpit',null,{timeout:30000});
  for(const weather of ['clear-day','wet-night']){
    const open=driverPage.locator('[data-open="engineering"]').first();assert.equal(await open.isEnabled(),true);await open.dispatchEvent('click');await click(driverPage,'[data-engineering-tab="render"]');
    await driverPage.locator('#quality').selectOption('balanced');await driverPage.locator('#weather-preset').selectOption(weather);
    const id='cockpit-'+weather,started=performance.now(),bundle=await download(driverPage,'visual-capture-bundle',join(driverFolder,id+'.zip'),120000),bundleExportAndSaveMs=performance.now()-started,entries=unpackStoredZip(bundle.bytes);
    for(const [name,bytes]of entries)await writeFile(join(driverFolder,name),bytes);
    const conditionName=[...entries.keys()].find(name=>name.endsWith('.json')),conditions=JSON.parse(entries.get(conditionName)),imageName=conditions.capture.imageFile,png=entries.get(imageName);
    assert.ok(png);assert.equal(conditions.capture.conditionsFile,conditionName);assert.equal(conditions.capture.source,'actual-webgl-composer-frame');assert.equal(conditions.capture.pixelsEdited,false);assert.equal(conditions.modelBuildId,expectedBuild);assert.equal(conditions.modelVersion,'3.16.0');assert.equal(conditions.context,'city');assert.equal(conditions.camera.mode,'cockpit');assert.equal(conditions.quality,'balanced');assert.equal(conditions.weatherPreset,weather);assert.equal(conditions.paused,true);assert.equal(conditions.lastProgramAudit.status,'passed');assert.deepEqual(pngSize(png),[conditions.resolution.width,conditions.resolution.height]);
    await driverPage.screenshot({path:join(driverFolder,id+'-ui.png')});
    summary.driver.push({id,path:'driver/'+imageName,sha256:sha(png),bytes:png.length,resolution:pngSize(png),archive:'driver/'+id+'.zip',archiveSHA256:sha(bundle.bytes),conditions:'driver/'+conditionName,uiPath:'driver/'+id+'-ui.png',uiAssociation:'A separate whole-page screenshot after the atomic renderer bundle (whose product action closes the engineering drawer); not represented as the same framebuffer.',viewport:driverViewport,rendererBuildId:conditions.modelBuildId,drawStatus:conditions.lastProgramAudit.status,drawCalls:conditions.lastProgramAudit.drawCalls,programCount:conditions.lastProgramAudit.programCount,bundleExportAndSaveMs,scope:'Paused current city cockpit at the ordinary balanced preset. Frame-bound metadata. No performance, full-drive or old/new pixel-comparison claim.'});console.log('driver',id,'saved');
  }
  await click(driverPage,'#camera-btn');await click(driverPage,'#camera-btn');await driverPage.waitForFunction(()=>window.roadsterLab.getState().cameraMode==='orbit',null,{timeout:30000});
  await driverPage.screenshot({path:join(driverFolder,'exterior-restored-ui.png')});await driverPage.close();currentPage=null;checkCancellation();
  summary.sourceHashesAfter=await hashSources(candidate,sourcePaths);assert.deepEqual(summary.sourceHashesBefore,summary.sourceHashesAfter,'Candidate source changed during capture');
  assert.equal(errors.filter(row=>row.type==='pageerror').length,0,'Uncaught browser exceptions');
  summary.status='captured-pending-visual-review';summary.finishedAt=new Date().toISOString();
}catch(error){summary.status=cancelRequested?'cancelled':'failed';summary.failure={name:error.name,message:error.message,stack:error.stack};console.error('Capture '+summary.status+':',error.message);process.exitCode=1;}
finally{clearInterval(cancelTimer);await browser.close();await json(join(output,'vehicle-native-capture-3.16.json'),summary);console.log('Saved',join(output,'vehicle-native-capture-3.16.json'),summary.status);}
