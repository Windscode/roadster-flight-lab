import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const base=process.argv[2]||'http://127.0.0.1:8317/',out=resolve(process.argv[3]||'qa/input-native-3.17');await mkdir(out,{recursive:true});
const report={schema:'roadster-native-continuous-input-3.17',startedAt:new Date().toISOString(),cases:[],errors:[],scope:'Actual Playwright keyboard down/up events in Chromium while W remains held. Fixed-step input and quaternion journals are read from the application. Software rendering, no physical keyboard or user-GPU acceptance; simulation time and wall time remain distinct.'};
const hash=x=>createHash('sha256').update(x).digest('hex'),bounded=(p,ms,label)=>new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error(label+' timeout '+ms+' ms')),ms);p.then(v=>{clearTimeout(timer);res(v);},e=>{clearTimeout(timer);rej(e);});});
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROMIUM,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});report.browserVersion=browser.version();
const save=()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
try{for(const kind of (process.env.INPUT_CASES||'controlled-U,manual-WE1').split(',')){
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});page.setDefaultTimeout(15000);const row={kind,status:'running',startedAt:new Date().toISOString(),events:[]};report.cases.push(row);await save();
 page.on('pageerror',e=>report.errors.push({kind,message:e.message}));page.on('response',r=>{if(r.status()>=400)report.errors.push({kind,status:r.status(),url:r.url()});});
 const read=fn=>bounded(page.evaluate(fn),15000,'Read input state'),state=()=>read(()=>window.roadsterLab.getState());
 async function key(key,down){row.events.push({key,down,requestedAt:new Date().toISOString(),beforeSimS:(await state()).simTime});await page.keyboard[down?'down':'up'](key);row.events.at(-1).afterSimS=(await state()).simTime;}
 const until=(start,seconds,timeout=120000)=>page.waitForFunction(({start,seconds})=>window.roadsterLab.getState().simTime>=start+seconds,{start,seconds},{timeout});
 try{
  await page.goto(new URL('?view=lab',base).href,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.roadsterReady&&window.roadsterLab,null,{timeout:60000});
  if(await page.locator('#menu-resume').isVisible())await page.locator('#menu-resume').click();await page.locator('[data-rc-action="observe"]').click();
  // Focus only; no injected state, simulation steps, pose or velocity.
  await page.locator('#viewport').focus();row.initial=await state();row.identity=await read(async()=>{const b=await import('./model-build.js');return{modelVersion:window.roadsterLab.version,modelBuildId:b.MODEL_BUILD_ID};});
  if(row.initial.paused)await page.locator('#pause-btn').dispatchEvent('click');
  if(kind==='manual-WE1'&&!(await state()).airStabilization){await key('g',true);await key('g',false);}
  await page.locator('#viewport').focus();await key('w',true);const drivingStart=(await state()).simTime;await until(drivingStart,.5);row.beforeAdditionalKeys=await state();
  if(kind==='controlled-U'){
   await key('u',true);await key('u',false);row.afterAction=await state();
   await page.waitForFunction(()=>{const s=window.roadsterLab.getState();return s.maneuverFeedback?.lastRun?.name==='pitch'&&s.maneuverFeedback.lastRun.state==='completed'&&s.mode==='drive';},null,{timeout:120000});
   row.landing=await state();await until(row.landing.simTime,.25);row.finalWithW=await state();
   if(row.finalWithW.driverInput.throttle<.99||row.finalWithW.contactCount!==4)throw Error('W/ground control did not remain after U');
  }else{
   await key('e',true);await key('1',true);const requestStart=(await state()).simTime;row.afterAdditionalKeys=await state();await until(requestStart,6.5);row.endRequest=await state();await key('1',false);await key('e',false);
   const recoveryStart=(await state()).simTime;await until(recoveryStart,6);row.finalWithW=await state();
  }
  await key('w',false);const timeline=await read(()=>window.roadsterLab.getInputTimeline()),data=gzipSync(JSON.stringify(timeline)+'\n',{level:9}),file=kind+'-input.json.gz';await writeFile(join(out,file),data);
  const p=timeline.events.filter(e=>e.type==='physics-input');row.journal={file,bytes:data.length,sha256:hash(data),droppedEvents:timeline.droppedEvents,physicsSamples:p.length,receivedKeyEvents:timeline.events.filter(e=>['keydown','keyup','action-receipt','input-release'].includes(e.type)),simulatedWE1Samples:p.filter(e=>e.input?.throttle>.99&&e.input?.lift>.99&&e.input?.pitch>.99).length};
  await page.locator('#pause-btn').dispatchEvent('click');const image=await page.screenshot({path:join(out,kind+'.png'),timeout:15000});row.frame={file:kind+'.png',bytes:image.length,sha256:hash(image)};row.status=kind==='controlled-U'?'completed-and-driving':'manual-outcome-recorded';
 }catch(e){row.status='failed-or-uncompleted';row.failure={message:e.message,stack:e.stack};try{row.failureState=await state();const timeline=await read(()=>window.roadsterLab.getInputTimeline());await writeFile(join(out,kind+'-failure-input.json.gz'),gzipSync(JSON.stringify(timeline)+'\n'));await page.screenshot({path:join(out,kind+'-failure.png'),timeout:10000});}catch(f){row.failureCapture=f.message;}process.exitCode=1;}
 row.finishedAt=new Date().toISOString();await save();await bounded(page.close(),15000,'Close input page');console.log(kind+' '+row.status);
}}
finally{report.finishedAt=new Date().toISOString();report.status=report.cases.every(r=>['completed-and-driving','manual-outcome-recorded'].includes(r.status))?'protocols-executed':'incomplete';await save();await bounded(browser.close(),20000,'Close input browser').catch(e=>console.log(e.message));console.log(JSON.stringify({status:report.status,out,cases:report.cases.map(c=>({kind:c.kind,status:c.status,failure:c.failure}))}));}
