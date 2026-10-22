import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const [base,outputArg,role='candidate',scope='inspection']=process.argv.slice(2);
if(!base||!outputArg)throw Error('base URL, output directory and baseline/candidate role required');
const output=resolve(outputArg);await mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={schema:'roadster-vehicle-form-capture-3.17',role,scope,startedAt:new Date().toISOString(),sourceHashes:{},frames:[],downloads:[],errors:[],failures:[],limitation:'Live product PNGs and/or full viewport screenshots. Inspection state exports bracket each PNG but are not atomic frame metadata. No physical-device performance claim.'};
for(const path of ['vehicle.js','vehicle-inspection.html','vehicle-inspection.js','receiver-plane-shadows.js','main.js','wind-laboratory.js','model-build.js','vehicle-models.js']){const r=await fetch(new URL(path,base));if(!r.ok)throw Error(path+' '+r.status);report.sourceHashes[path]=sha(Buffer.from(await r.arrayBuffer()));}
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROMIUM,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});report.browserVersion=browser.version();
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,acceptDownloads:true});
page.on('pageerror',e=>report.errors.push({type:'pageerror',message:e.message}));page.on('console',m=>{if(['error','warning'].includes(m.type()))report.errors.push({type:m.type(),message:m.text()});});
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out after '+ms+' ms')),ms);})]);}finally{clearTimeout(timer);}}
async function download(selector,path){
 const start=performance.now(),pending=page.waitForEvent('download',{timeout:30000});
 await page.locator(selector).dispatchEvent('click');const dispatched=performance.now(),d=await pending,eventAt=performance.now();
 await bounded(d.saveAs(path),20000,'Download save');const saved=performance.now(),failure=await bounded(d.failure(),5000,'Download result');if(failure)throw Error(failure);
 const bytes=await readFile(path);report.downloads.push({selector,file:path.slice(output.length+1),bytes:bytes.length,dispatchWallMs:dispatched-start,downloadEventWallMs:eventAt-start,saveCompleteWallMs:saved-start,scope:'Node Playwright wall timing, including browser scheduling and rendering; not isolated JavaScript encoding time.'});return bytes;
}
function same(a,b){if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b)<=1e-12*Math.max(1,Math.abs(a),Math.abs(b));if(a&&b&&typeof a==='object'&&typeof b==='object')return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>same(a[k],b[k]));return a===b;}
try{
 if(scope==='inspection'){
  await page.goto(new URL('vehicle-inspection.html?display=experimental',base).href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#inspection-stage')?.dataset.graphics==='ready'&&document.querySelector('#ready')?.textContent.includes('就绪'),null,{timeout:60000});
  await page.locator('#inspection-quality').selectOption('ultra');await page.locator('#display-configuration').selectOption('experimental');await page.locator('#studio-light').dispatchEvent('click');
  for(const view of (process.env.VEHICLE_VIEWS||'front-quarter,front,side,cabin,rear-quarter').split(',')){
   await page.locator('button[data-view="'+view+'"]').dispatchEvent('click');
   const before=JSON.parse(await download('#capture-meta',join(output,view+'-before.json')));
   const png=await download('#capture-frame',join(output,view+'.png'));
   const after=JSON.parse(await download('#capture-meta',join(output,view+'-after.json')));
   const keys=['camera','lighting','lightingRevision','toneMappingExposure','environmentIntensity','quality','steer','suspensionLength','cutaway','seal','displayConfiguration','lampMode','surfaceDiagnostics','materialState'];
   const changed=keys.filter(k=>!same(before[k],after[k]));if(changed.length)throw Error('Capture conditions changed: '+changed.join(','));
   report.frames.push({view,path:view+'.png',bytes:png.length,sha256:sha(png),conditionsBefore:view+'-before.json',conditionsAfter:view+'-after.json',conditionsUnchanged:true,modelVersion:after.modelVersion,modelBuildId:after.modelBuildId,graphicsDevice:after.graphicsDevice,drawAudit:after.lastProgramAudit});
   console.log(role+' '+view+' '+png.length+' bytes');
  }
 }else{
  await page.goto(new URL('?view=lab',base).href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.roadsterLab&&window.roadsterReady,null,{timeout:120000});
  await page.locator('#menu-resume').dispatchEvent('click');
  await page.locator('[data-rc-action="observe"]').dispatchEvent('click');
  if(!(await page.evaluate(()=>window.roadsterLab.getState().paused)))await page.locator('#pause-btn').dispatchEvent('click');
  await page.waitForFunction(()=>window.roadsterLab.getState().paused,null,{timeout:15000});
  if(await page.locator('#game-menu').isVisible())throw Error('Driving menu would obscure the laboratory vehicle');
  await page.waitForTimeout(1200);
  report.state=await page.evaluate(()=>({state:window.roadsterLab.getState(),performance:window.roadsterLab.getPerformance()}));
  const png=await page.screenshot({path:join(output,'lab-observe.png'),timeout:30000});report.frames.push({view:'lab-observe',path:'lab-observe.png',bytes:png.length,sha256:sha(png),capture:'unmodified full viewport screenshot',paused:report.state.state.paused});
 }
 report.status='captured';
}catch(e){report.status='failed';report.failures.push({message:e.message,stack:e.stack});process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await browser.close();await writeFile(join(output,'capture.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,frames:report.frames.length,output,failures:report.failures},null,2));}
