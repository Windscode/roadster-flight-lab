// Prepare without launching a browser:
// node qa/capture-vehicle-final-supplement-3.16.mjs --prepare OUTPUT_DIR CANDIDATE_URL
// Run only when the shared GPU window has been assigned:
// ROADSTER_CHROMIUM=/path/to/chrome FONTCONFIG_FILE=/path/to/fonts.conf \
//   node qa/capture-vehicle-final-supplement-3.16.mjs --capture OUTPUT_DIR CANDIDATE_URL
// Exactly two requested current views. The existing atomic pair ZIP also
// emits incidental frozen-reference and labelled comparison images, retained
// as native product output rather than silently discarded or relabelled.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {crc32} from '../dist/capture-archive.js';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';

const expectedBuild='81926b470303a5f51844285ff604fbb84717a627271efddde494e228ce319ec2';
const [mode,outputArg,candidateArg]=process.argv.slice(2);
assert.ok(['--prepare','--capture'].includes(mode)&&outputArg&&candidateArg,'Supply --prepare or --capture, OUTPUT_DIR and CANDIDATE_URL.');
assert.equal(MODEL_BUILD_ID,expectedBuild,'This script is scoped to one final runtime identity.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(JSON.stringify(MODEL_SOURCE_HASHES)),expectedBuild);
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(outputArg),candidate=new URL(candidateArg);
const originalFolder=resolve(repository,'qa/vehicle-native-3.16');
const study=JSON.parse(await readFile(join(originalFolder,'study/vehicle-study.json'),'utf8'));
const originalCapture=JSON.parse(await readFile(join(originalFolder,'vehicle-native-capture-3.16.json'),'utf8'));
const review=JSON.parse(await readFile(resolve(repository,'qa/vehicle-final-3.16/dependency-review-81926.json'),'utf8'));
assert.equal(review.targetBuildId,expectedBuild);assert.equal(review.wholeStaticClosureByteEquality,false);
const views=['front-quarter','cabin'],viewport={width:1280,height:720};
const renderKeys=['rig','viewId','focalLengthMm','filmGaugeMm','camera','lighting','lightingRevision','toneMappingExposure','environmentIntensity','resolution','cssStageSize','pixelRatio','surfaceDiagnostics','quality','steer','suspensionLength','cutaway','seal','suspensionSweep','displayConfiguration','lampMode','photoReference','materialState','geometry','renderCost'];
function renderedInputs(conditions){
  const result=Object.fromEntries(renderKeys.map(key=>[key,conditions[key]]));
  result.wingRenderPose=Object.fromEntries(['mode','command','deployment','position','incidenceRad'].map(key=>[key,conditions.wing?.[key]]));return result;
}
function assertMatching(actual,expected,label){
  if(typeof actual==='number'&&typeof expected==='number'){
    assert.ok(Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=1e-12*Math.max(1,Math.abs(actual),Math.abs(expected)),label+': '+actual+' vs '+expected);return;
  }
  if(actual&&expected&&typeof actual==='object'&&typeof expected==='object'){
    assert.deepEqual(Object.keys(actual),Object.keys(expected),label+' keys');
    for(const key of Object.keys(expected))assertMatching(actual[key],expected[key],label+'.'+key);return;
  }
  assert.equal(actual,expected,label);
}
const sourcePaths=[...new Set([...Object.keys(MODEL_SOURCE_HASHES),'model-build.js','assets/environment.hdr'])].sort();
const localHashes={};for(const path of sourcePaths){const actual=sha(await readFile(resolve(repository,'dist',path)));if(MODEL_SOURCE_HASHES[path])assert.equal(actual,MODEL_SOURCE_HASHES[path],path+' changed after build');localHashes[path]=actual;}
const plan={schema:'roadster-vehicle-final-two-view-plan-3.16',preparedAt:new Date().toISOString(),status:mode==='--prepare'?'prepared-no-browser-started':'capture-authorized-by-command',expectedBuild,viewport,deviceScaleFactor:1,drawingBuffer:[900,720],views:views.map(view=>{
  const original=study.frames.find(frame=>frame.id==='studio-'+view+'-current');assert.ok(original);return{view,oldImage:original.file,oldCaptureBuild:original.conditions.rendererBuildId,oldCaptureId:study.captureId,expectedRenderedInputs:renderedInputs(original.conditions)};
}),sourcePaths,localHashes,scope:'Two final current studio views only, through existing atomic pair actions. No new main-city or UI acceptance. Original 2d88/c12a evidence is preserved.',identityAndClock:'New capture IDs, real simulation times, clocks, device diagnostics and build metadata are retained. Matching is asserted only for the enumerated rendered inputs; no metadata is rewritten to match the old captures.'};
await mkdir(output,{recursive:true});await writeFile(join(output,'capture-plan-81926.json'),JSON.stringify(plan,null,2)+'\n');
if(mode==='--prepare'){
  console.log(JSON.stringify({status:plan.status,expectedBuild,viewport,drawingBuffer:plan.drawingBuffer,views,output},null,2));
}else{
  const summary={schema:'roadster-vehicle-final-two-view-capture-3.16',status:'running',startedAt:new Date().toISOString(),expectedBuild,viewport,deviceScaleFactor:1,plan:'capture-plan-81926.json',errors:[],requests:[],frames:[],browserVersion:null,sourceHashesBefore:null,sourceHashesAfter:null,scope:plan.scope};
  const json=async(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
  const checkCancel=()=>{if(existsSync(join(output,'cancel-requested')))throw Error('Task cancelled at the next view boundary; completed native files are retained.');};
  async function hashRemote(){const hashes={};for(const path of sourcePaths){const response=await fetch(new URL(path,candidate),{cache:'no-store'});assert.equal(response.status,200,path);hashes[path]=sha(Buffer.from(await response.arrayBuffer()));}assert.deepEqual(hashes,localHashes,'Served candidate differs from frozen local runtime');return hashes;}
  function unpackStoredZip(bytes){
    const files=new Map();let at=0;
    while(bytes.readUInt32LE(at)===0x04034b50){
      assert.equal(bytes.readUInt16LE(at+8),0,'Capture archive must use STORE');
      const checksum=bytes.readUInt32LE(at+14),length=bytes.readUInt32LE(at+18),nameLength=bytes.readUInt16LE(at+26),extraLength=bytes.readUInt16LE(at+28);
      const name=bytes.toString('utf8',at+30,at+30+nameLength);assert.match(name,/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/);
      const start=at+30+nameLength+extraLength,data=bytes.subarray(start,start+length);assert.equal(crc32(data),checksum,name+' CRC');assert.ok(!files.has(name));files.set(name,data);at=start+length;
    }return files;
  }
  function pngSize(bytes){assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');return[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];}
  async function click(page,selector){assert.equal(await page.locator(selector).isEnabled(),true,selector);await page.locator(selector).dispatchEvent('click');}
  async function bounded(promise,timeout,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded '+timeout+' ms')),timeout);})]);}finally{clearTimeout(timer);}}
  async function download(page,selector,path){
    const pending=page.waitForEvent('download',{timeout:180000});await click(page,selector);const downloaded=await pending;
    await bounded(downloaded.saveAs(path),120000,'Browser download save');assert.equal(await bounded(downloaded.failure(),30000,'Browser download result'),null);return{suggestedName:downloaded.suggestedFilename(),bytes:await readFile(path)};
  }
  let browser=null;
  try{
    checkCancel();summary.sourceHashesBefore=await hashRemote();
    const require=createRequire(import.meta.url),moduleRoot=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    const {chromium}=moduleRoot?require(moduleRoot+'/playwright'):require('playwright');
    browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROMIUM||undefined,headless:true,args:['--no-sandbox'],env:process.env});summary.browserVersion=browser.version();assert.equal(summary.browserVersion,originalCapture.browserVersion,'Use the original capture browser version.');
    const page=await browser.newPage({viewport,deviceScaleFactor:1,acceptDownloads:true});
    page.on('pageerror',error=>summary.errors.push({type:'pageerror',message:error.message}));
    page.on('console',message=>{if(['error','warning'].includes(message.type()))summary.errors.push({type:message.type(),message:message.text()});});
    page.on('response',response=>{if(response.status()>=400)summary.requests.push({url:response.url(),status:response.status()});});
    page.on('requestfailed',request=>summary.requests.push({url:request.url(),failure:request.failure()?.errorText}));
    const url=new URL('vehicle-inspection.html',candidate);url.searchParams.set('display','experimental');
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.querySelector('#inspection-stage')?.dataset.graphics==='ready'&&document.querySelector('#ready')?.textContent.includes('光棚已就绪'),null,{timeout:90000});
    await page.locator('#reference-version').selectOption('3.15');await page.locator('#inspection-quality').selectOption('ultra');await page.locator('#display-configuration').selectOption('experimental');await page.locator('#lamp-mode').selectOption('low-beam');
    assert.equal(Number(await page.locator('#suspension').inputValue()),.287);assert.equal(Number(await page.locator('#steer').inputValue()),0);assert.equal(Number(await page.locator('#wing-deployment').inputValue()),0);
    await click(page,'#studio-light');
    for(const view of views){
      checkCancel();await click(page,'button[data-view="'+view+'"]');
      const original=study.frames.find(frame=>frame.id==='studio-'+view+'-current'),folder=join(output,'studio-'+view);await mkdir(folder,{recursive:true});
      const started=performance.now(),archive=await download(page,'#capture-bundle',join(folder,'native-pair.zip')),files=unpackStoredZip(archive.bytes);
      for(const [name,bytes]of files)await writeFile(join(folder,name),bytes);
      const conditionsName=[...files.keys()].find(name=>name.endsWith('-conditions.json'));assert.ok(conditionsName);
      const record=JSON.parse(files.get(conditionsName));assert.equal(record.format,'roadster-surface-frame-pair-1');assert.equal(record.frames.length,2);assert.deepEqual(record.originalResolution,[900,720]);
      const current=record.frames.find(frame=>frame.role==='current');assert.ok(current);const conditions=current.conditions,pixels=files.get(current.file);assert.ok(pixels);
      assert.equal(conditions.recordScope,'rendered-frame-conditions');assert.equal(conditions.rendererBuildId,expectedBuild);assert.equal(conditions.modelBuildId,expectedBuild);assert.equal(conditions.modelVersion,'3.16.0');assert.equal(conditions.frameAssociation.captureId,record.captureId);assert.equal(conditions.frameAssociation.originalFile,current.file);assert.equal(conditions.frameAssociation.conditionsFile,conditionsName);assert.equal(conditions.lastProgramAudit.status,'passed');assert.deepEqual(pngSize(pixels),[900,720]);
      assertMatching(renderedInputs(conditions),renderedInputs(original.conditions),'studio-'+view+' original rendered inputs');
      assertMatching(conditions.graphicsDevice,original.conditions.graphicsDevice,'studio-'+view+' original WebGL device/context');
      const frame={id:'studio-'+view+'-current-81926',path:'studio-'+view+'/'+current.file,sha256:sha(pixels),bytes:pixels.length,resolution:pngSize(pixels),conditions:'studio-'+view+'/'+conditionsName,captureId:record.captureId,rendererBuildId:conditions.rendererBuildId,originalComparison:{path:'qa/vehicle-native-3.16/study/'+original.file,captureBuildId:original.conditions.rendererBuildId,captureId:study.captureId,matchingRenderedInputs:true,numericToleranceRelative:1e-12},actualSimTime:conditions.simTime,oldSimTime:original.conditions.simTime,simTimeMatchingRequired:false,renderedInputs:renderedInputs(conditions),graphicsDevice:conditions.graphicsDevice,drawStatus:conditions.lastProgramAudit.status,drawCalls:conditions.lastProgramAudit.drawCalls,programCount:conditions.lastProgramAudit.programCount,archive:'studio-'+view+'/native-pair.zip',archiveSHA256:sha(archive.bytes),suggestedDownloadName:archive.suggestedName,productExportThroughToolSavedMs:performance.now()-started,incidentalNativeFiles:[...files].filter(([name])=>name!==current.file&&name!==conditionsName).map(([path,bytes])=>({path:'studio-'+view+'/'+path,sha256:sha(bytes),bytes:bytes.length,role:path===record.files.reference?'frozen-3.15-reference-frame':path===record.files.comparison?'separately-labelled-composite':'native-readme'}))};
      summary.frames.push(frame);console.log('Captured',frame.id,'900×720; camera/light/material/articulation match original conditions.');await json(join(output,'capture-result-81926.json'),summary);
    }
    summary.sourceHashesAfter=await hashRemote();assert.deepEqual(summary.sourceHashesBefore,summary.sourceHashesAfter,'Source changed during the two-view capture');assert.equal(summary.errors.filter(row=>row.type==='pageerror').length,0,'Uncaught browser exceptions');assert.equal(summary.frames.length,2);
    summary.status='captured-pending-visual-review';summary.finishedAt=new Date().toISOString();
  }catch(error){summary.status='failed';summary.failure={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;console.error(error.message);}
  finally{if(browser)await browser.close();await json(join(output,'capture-result-81926.json'),summary);console.log(JSON.stringify({status:summary.status,currentFrameCount:summary.frames.length,output},null,2));}
}
