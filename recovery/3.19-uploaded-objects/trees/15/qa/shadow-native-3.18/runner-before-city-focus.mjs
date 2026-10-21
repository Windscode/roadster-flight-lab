// Continuous native-key and camera observation. Run sequentially only after
// the shared GPU is available. The default prints its plan and opens nothing.
// Uses existing UI controls and the documented read-only roadsterLab reports.
// Does not call a simulation step, inject a pose, switch shadows off, or invent
// intermediate animation frames. Playwright video retains wall-clock stalls.
import {createRequire} from 'node:module';
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve,join} from 'node:path';

const args=process.argv.slice(2),opt=(k,d)=>args.find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3)??d;
const contextName=opt('context','city'),base=opt('url','http://127.0.0.1:8328/'),out=resolve(opt('out','qa/shadow-native-3.18/candidate-'+contextName));
const quality=opt('quality','high'),width=Number(opt('width','800')),height=Number(opt('height','450')),maxWallS=Number(opt('max-wall-s','240'));
if(!['city','lab'].includes(contextName)||!['balanced','high','ultra'].includes(quality)||width<480||height<300||maxWallS>360||maxWallS<60)throw Error('Invalid bounded native-shadow options');
const plan={schema:'roadster.native-shadow-motion-plan-3.18',url:base,context:contextName,quality,viewport:{width,height,dpr:1},maxWallS,
  input:'Real Playwright W/A/D key down/up, pointer drag and C camera key; existing weather/lamp/quality controls dispatch their normal UI change events.',
  sequence:contextName==='city'?['day idle','W straight','W+A','W+D','release + pointer orbit','continuous weather transition to wet-night','W night straight','W+A night turn','release + C camera','return to clear-day']:['idle','W straight','W+A','W+D','release + pointer orbit','C camera','release settle'],
  evidence:'Native WebM, a small number of actual screenshots, per-rAF read-only telemetry/renderBudget, received input journal and served source hashes.',
  limits:'Software GPU observation, no user-GPU performance acceptance or universal flicker-free verdict. The read-only rAF observer and viewport video add observation overhead. Physics state remains continuous within each case; release for camera/settings is recorded.'};
if(!args.includes('--run')){console.log(JSON.stringify(plan,null,2));process.exit(0);}
await mkdir(out,{recursive:true});
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const bounded=async(p,ms,label)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label+' exceeded '+ms+' ms')),ms))]);}finally{clearTimeout(timer);}};
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={...plan,startedAt:new Date().toISOString(),status:'running',events:[],phases:[],images:[],errors:[],sourceResponses:[]};
const save=()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const browser=await chromium.launch({headless:true,executablePath:process.env.ROADSTER_CHROME||'/workspace/scratch/4a18da1d1c35/browser-runtime/chrome-linux64/chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const browserContext=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,recordVideo:{dir:out,size:{width,height}}});
const page=await browserContext.newPage(),video=page.video();page.setDefaultTimeout(15000);report.browserVersion=browser.version();
const sourceReads=[],held=new Set();
page.on('pageerror',e=>report.errors.push({kind:'pageerror',message:e.message,at:new Date().toISOString()}));
page.on('console',m=>{if(['error','warning'].includes(m.type()))report.errors.push({kind:m.type(),message:m.text(),at:new Date().toISOString()});});
page.on('response',r=>{
  if(r.status()>=400)report.errors.push({kind:'http',status:r.status(),url:r.url()});
  const u=new URL(r.url());if(u.origin===new URL(base).origin&&(/\.(?:js|css)$/.test(u.pathname)||/\/deployment\.json$/.test(u.pathname)))
    sourceReads.push(r.body().then(bytes=>report.sourceResponses.push({path:u.pathname,status:r.status(),bytes:bytes.length,sha256:sha(bytes),...(u.pathname.endsWith('/model-build.js')?{declaredModelBuildId:bytes.toString().match(/MODEL_BUILD_ID\s*=\s*['"]([^'"]+)/)?.[1]??null}: {})})).catch(e=>report.errors.push({kind:'source-read',url:r.url(),message:String(e)})));
});
const read=fn=>bounded(page.evaluate(fn),20000,'Read public observation');
const state=()=>read(()=>window.roadsterLab.getState());
let startedDrivingAt=0,recorderInstalled=false;
async function key(name,down){
  const event={kind:down?'keydown':'keyup',key:name,requestedAt:new Date().toISOString(),heldBefore:[...held]};report.events.push(event);
  await bounded(page.keyboard[down?'down':'up'](name),15000,'Native key '+name);
  down?held.add(name):held.delete(name);event.returnedAt=new Date().toISOString();
}
async function release(){for(const name of [...held])await key(name,false);}
async function select(id,value){
  report.events.push({kind:'native-select-change',id,value,requestedAt:new Date().toISOString()});
  await bounded(page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e||e.disabled||!Array.from(e.options).some(o=>o.value===value))throw Error('Unavailable UI '+id);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value}),20000,'UI selection '+id);
  await page.locator('#viewport').focus();
}
async function exposureBaseline(){report.events.push({kind:'native-button',id:'exposure-baseline-39',requestedAt:new Date().toISOString()});await page.locator('#exposure-baseline-39').dispatchEvent('click');await page.locator('#viewport').focus();}
async function phase(name,seconds,{minimumFrames=5,wallMs=35000}={}){
  if(Date.now()-startedDrivingAt>maxWallS*1000)throw Error('Native case wall budget reached; partial evidence retained');
  const mark=await read(()=>({simTime:window.roadsterLab.getState().simTime,frames:window.shadowNativeObservation.samples.length,wall:performance.now()}));
  await page.evaluate(name=>window.shadowNativeObservation.phase=name,name);
  const row={name,targetSimSeconds:seconds,minimumFrames,start:mark,requestedAt:new Date().toISOString()};report.phases.push(row);await save();
  try{await bounded(page.waitForFunction(({start,seconds,frames,minimumFrames})=>{const s=window.roadsterLab.getState();return s.fault||s.paused||s.simTime>=start+seconds&&window.shadowNativeObservation.samples.length>=frames+minimumFrames;},{start:mark.simTime,seconds,frames:mark.frames,minimumFrames},{polling:250,timeout:wallMs}),wallMs+2000,'Continuous phase '+name);row.status='observed';}
  catch(e){row.status='bounded-partial';row.reason=e.message;}
  row.end=await read(()=>({simTime:window.roadsterLab.getState().simTime,frames:window.shadowNativeObservation.samples.length,wall:performance.now(),state:window.roadsterLab.getState()}));
  row.actualSimSeconds=row.end.simTime-mark.simTime;row.actualWallMs=row.end.wall-mark.wall;
  if(row.end.state.fault)throw Error('Actual solver fault: '+row.end.state.fault);
  if(row.end.state.paused)throw Error('Unexpected pause during continuous observation');
  await save();console.log(contextName,name,row.status,row.actualSimSeconds.toFixed(3)+' sim s',Math.round(row.actualWallMs)+' wall ms');
}
async function screenshot(name){
  const before=await state(),file=name+'.png',bytes=await bounded(page.screenshot({path:join(out,file),timeout:15000}),18000,'Actual native screenshot '+name),after=await state();
  report.images.push({file,sha256:sha(bytes),bytes:bytes.length,before,after,association:'Separate telemetry calls bracket the native viewport screenshot; not atomic framebuffer metadata.'});await save();
}
async function orbit(){
  report.events.push({kind:'native-pointer-drag',from:[width*.65,height*.52],to:[width*.42,height*.57],requestedAt:new Date().toISOString()});
  await page.mouse.move(width*.65,height*.52);await page.mouse.down();await page.mouse.move(width*.42,height*.57,{steps:8});await page.mouse.up();
  await page.locator('#viewport').focus();
}
try{
  await page.goto(new URL(contextName==='lab'?'?view=lab':'',base).href,{waitUntil:'domcontentloaded',timeout:60000});
  await bounded(page.waitForFunction(()=>window.roadsterReady===true&&window.roadsterLab,null,{timeout:60000}),62000,'Startup');
  if(contextName==='city')await page.locator('#play-city').dispatchEvent('click');
  else{if(await page.locator('#menu-resume').isVisible())await page.locator('#menu-resume').dispatchEvent('click');await page.locator('[data-rc-action="observe"]').dispatchEvent('click');}
  await select('quality',quality);
  if(contextName==='city'){await select('weather-preset','clear-day');await select('driving-lamp-mode','auto');await exposureBaseline();}
  await page.locator('#viewport').focus();
  if((await state()).paused)await page.locator('#pause-btn').dispatchEvent('click');
  // Cinema mode removes overlays only. It does not alter the renderer or pose.
  if(!await read(()=>document.body.classList.contains('body-cinema')))await page.keyboard.press('F9');
  report.initial={state:await state(),performance:await read(()=>window.roadsterLab.getPerformance())};
  if(report.initial.state.context!==contextName)throw Error('Requested scene not active');
  await page.evaluate(()=>{
    const o=window.shadowNativeObservation={phase:'start',active:true,samples:[],errors:[],startedAtMs:performance.now(),last:null};
    const sample=()=>{
      if(!o.active)return;
      try{const s=window.roadsterLab.getState(),p=window.roadsterLab.getPerformance(),now=performance.now();
        o.samples.push({wallMs:now,rafIntervalMs:o.last===null?null:now-o.last,phase:o.phase,simTime:s.simTime,paused:s.paused,position:s.position,quaternion:s.quaternion,velocity:s.velocity,speedKmh:s.speedKmh,headingDeg:s.headingDeg,pitchDeg:s.pitchDeg,rollDeg:s.rollDeg,cameraMode:s.cameraMode,driverInput:s.driverInput,contactCount:s.contactCount,wheelStates:s.wheelStates.map(w=>({steer:w.steer,rotation:w.rotation,suspensionLength:w.suspensionLength,contact:w.contact})),weather:p.scene?.weatherPreset??'lab',uiExposure:{locked:document.getElementById('exposure-lock').checked,value:Number(document.getElementById('exposure-lock-value').value),auto:document.getElementById('auto-exposure').checked},renderBudget:JSON.parse(JSON.stringify(p.scene?.renderBudget??null)),resolution:p.resolution,frame:p.rolling?.lastFrame});o.last=now;
        if(o.samples.length>6000){o.active=false;o.errors.push('Bounded sample capacity reached');}
      }catch(e){o.errors.push(String(e));o.active=false;}
      requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });recorderInstalled=true;startedDrivingAt=Date.now();
  await phase('day-idle',.25);await screenshot('01-before-motion');
  await key('w',true);await phase('day-straight',1.0);
  await key('a',true);await phase('day-left-turn',.55);await key('a',false);
  await key('d',true);await phase('day-right-turn',.55);await key('d',false);await key('w',false);
  await orbit();await phase('day-camera-orbit',.4);await screenshot('02-after-day-turn-camera');
  if(contextName==='city'){
    await select('weather-preset','wet-night');await exposureBaseline();
    await phase('day-to-night-transition',.3);await key('w',true);await phase('night-straight',.8);
    await key('a',true);await phase('night-left-turn',.45);await key('a',false);await key('w',false);
    await page.keyboard.press('c');report.events.push({kind:'native-keypress',key:'c',requestedAt:new Date().toISOString()});
    await phase('night-camera-release',.4);await screenshot('03-night-headlamps');
    await select('weather-preset','clear-day');await exposureBaseline();await phase('night-to-day-return',.3);
  }else{
    await page.keyboard.press('c');report.events.push({kind:'native-keypress',key:'c',requestedAt:new Date().toISOString()});await phase('camera-C-and-release',.6);await screenshot('03-camera-release');
  }
  report.status=report.phases.every(p=>p.status==='observed')?'continuous-protocol-observed':'bounded-partial-protocol';
}catch(e){report.status='incomplete';report.failure={message:e.message,stack:e.stack};process.exitCode=1;console.error(e);}
finally{
  await release().catch(e=>report.errors.push({kind:'release',message:String(e)}));
  try{
    if(recorderInstalled){const observation=await read(()=>{window.shadowNativeObservation.active=false;return window.shadowNativeObservation;}),bytes=gzipSync(JSON.stringify(observation)+'\n');await writeFile(join(out,'timing-and-render-budget.json.gz'),bytes);report.observation={file:'timing-and-render-budget.json.gz',sha256:sha(bytes),bytes:bytes.length,samples:observation.samples.length,errors:observation.errors};}
    report.final={state:await state(),performance:await read(()=>window.roadsterLab.getPerformance())};
    const timeline=await read(()=>window.roadsterLab.getInputTimeline()),bytes=gzipSync(JSON.stringify(timeline)+'\n');await writeFile(join(out,'received-input-timeline.json.gz'),bytes);report.inputJournal={file:'received-input-timeline.json.gz',sha256:sha(bytes),bytes:bytes.length,dropped:timeline.droppedEvents};
  }catch(e){report.errors.push({kind:'partial-evidence',message:String(e)});}
  await Promise.allSettled(sourceReads);await bounded(browserContext.close(),20000,'Close recorded context').catch(e=>report.errors.push({kind:'close',message:String(e)}));
  try{const old=await bounded(video.path(),5000,'Video path'),file='continuous-native.webm';await rename(old,join(out,file));const bytes=await readFile(join(out,file));report.video={file,bytes:bytes.length,sha256:sha(bytes),scope:'Actual browser viewport video with native wall-clock timing; repeated compositor frames/stalls are retained.'};}catch(e){report.errors.push({kind:'video',message:String(e)});}
  await bounded(browser.close(),15000,'Close browser').catch(e=>report.errors.push({kind:'browser-close',message:String(e)}));
  report.finishedAt=new Date().toISOString();report.verdict='Evidence retained for visual/temporal review. Protocol completion is not a flicker-free acceptance.';await save();console.log(JSON.stringify({status:report.status,out,video:report.video,observation:report.observation}));
}
