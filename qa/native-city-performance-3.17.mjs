// Bounded native browser observation. Uses existing controls and read-only
// public reports; no application state setter, fabricated FPS or downloads.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const port=process.argv[2]||'8317',label=process.argv[3]||'candidate',out=new URL('./city-native-3.17/performance-'+label+'/',import.meta.url).pathname;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.ROADSTER_CHROME,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,acceptDownloads:false});
const errors=[],phases=[];page.on('pageerror',e=>errors.push({type:'pageerror',message:e.message}));page.on('console',m=>{if(m.type()==='error')errors.push({type:'console',message:m.text()});});
page.on('response',response=>{if(response.status()>=400)errors.push({type:'http',status:response.status(),url:response.url()});});
const sourceResponses={},sourceReads=[];page.on('response',response=>{const u=new URL(response.url());if(u.hostname==='127.0.0.1'&&(/\.(js|css)$/.test(u.pathname)||/\/manifest\.json$/.test(u.pathname)))sourceReads.push(response.body().then(bytes=>{sourceResponses[u.pathname]={status:response.status(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,...(u.pathname.endsWith('/model-build.js')?{modelBuildId:bytes.toString('utf8').match(/MODEL_BUILD_ID\s*=\s*['"]([^'"]+)/)?.[1]??null}:{})};}).catch(error=>{sourceResponses[u.pathname]={error:String(error)};}));});
const bounded=async(name,task,ms=45000)=>{let timer;try{return await Promise.race([task,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(name+' exceeded '+ms+' ms; partial data retained')),ms))]);}finally{clearTimeout(timer);}};
let device=null,identity=null,status='running';
try{
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.roadsterReady===true&&window.roadsterLab?.version,null,{timeout:60000});
  const setup=await bounded('native setup',page.evaluate(()=>{
    const select=(id,value)=>{const e=document.getElementById(id);if(!e||e.disabled||!Array.from(e.options).some(o=>o.value===value))throw Error('Unavailable native control '+id+'/'+value);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
    select('weather-preset','wet-night');document.getElementById('exposure-baseline-39').click();select('benchmark-camera','crosstown');
    window.cityFrameObservation={phase:'setup',last:null,samples:[],marks:[]};
    const tick=()=>{const o=window.cityFrameObservation,now=performance.now();if(o.last!==null)o.samples.push({atMs:now,intervalMs:now-o.last,phase:o.phase});o.last=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
    return{version:window.roadsterLab.version,performance:window.roadsterLab.getPerformance(),state:window.roadsterLab.getState()};
  }));device=setup.performance.device;identity={version:setup.version,weather:'wet-night',camera:'crosstown',viewport:{width:1280,height:720,dpr:1},exposure:1.02};
  await writeFile(out+'setup.json',JSON.stringify(setup,null,2)+'\n');
  if(!await page.evaluate(()=>document.body.classList.contains('body-cinema')))await page.keyboard.press('F9');
  for(const quality of ['high','ultra']){
    const started=await bounded('switch '+quality,page.evaluate(quality=>{
      const watch=window.cityFrameObservation;watch.phase=quality;const requestedAtMs=performance.now();watch.marks.push({quality,requestedAtMs});
      const e=document.getElementById('quality');e.value=quality;e.dispatchEvent(new Event('change',{bubbles:true}));const returnedAtMs=performance.now();
      // Official capture resumes the actual solver, isolates 5 s warmup and
      // retains every long frame in its subsequent 30 s active population.
      document.getElementById('performance-capture').click();
      return{quality,requestedAtMs,returnedAtMs,synchronousHandlerMs:returnedAtMs-requestedAtMs};
    },quality));
    console.log(label,quality,'capture started');
    await page.waitForFunction(()=>{const p=window.roadsterLab.getPerformance();return p.capture?.complete||p.capture?.stopped;},null,{polling:1000,timeout:90000});
    const result=await bounded('read '+quality,page.evaluate(()=>({performance:window.roadsterLab.getPerformance(),state:window.roadsterLab.getState(),observation:window.cityFrameObservation,resources:window.roadsterLab.getResourceHistory(),graphics:window.roadsterApp.getState().graphics})));
    const samples=result.observation.samples.filter(s=>s.phase===quality&&s.atMs>=started.requestedAtMs),first=samples[0];
    const row={...started,firstObservedRafAfterSwitchMs:first?first.atMs-started.requestedAtMs:null,maximumObservedRafGapMs:samples.length?Math.max(...samples.map(s=>s.intervalMs)):null,complete:result.performance.capture?.complete===true,steady:result.performance.capture?.summary,warmup:result.performance.capture?.warmup.summary,programResources:result.resources,scope:'Actual active solver with a fixed Crosstown camera and no throttle; stationary scene, not a driven route. Rendering and quality-switch observations are from this software GPU only.'};
    phases.push(row);await writeFile(out+quality+'-raw.json',JSON.stringify({switch:started,...result},null,2)+'\n');console.log(label,quality,JSON.stringify(row.steady));
    if(!row.complete)throw Error('Official capture did not complete: '+quality);
  }
  const returned=await bounded('return to high',page.evaluate(()=>{
    const o=window.cityFrameObservation;o.phase='return-high';const requestedAtMs=performance.now();const e=document.getElementById('quality');e.value='high';e.dispatchEvent(new Event('change',{bubbles:true}));return{requestedAtMs,synchronousHandlerMs:performance.now()-requestedAtMs};
  }));
  await page.waitForFunction(()=>window.cityFrameObservation.samples.filter(s=>s.phase==='return-high').length>=4,null,{polling:500,timeout:45000});
  const roundTrip=await bounded('read round trip',page.evaluate(()=>({state:window.roadsterLab.getState(),performance:window.roadsterLab.getPerformance(),resources:window.roadsterLab.getResourceHistory(),samples:window.cityFrameObservation.samples.filter(s=>s.phase==='return-high'),graphics:window.roadsterApp.getState().graphics})));
  phases.push({quality:'return-high',...returned,firstObservedRafAfterSwitchMs:roundTrip.samples[0]?.atMs-returned.requestedAtMs,maximumObservedRafGapMs:Math.max(...roundTrip.samples.map(s=>s.intervalMs)),scope:'Four subsequent native rAF intervals; this is a switch-response check, not another steady performance population.'});
  await writeFile(out+'return-high-raw.json',JSON.stringify(roundTrip,null,2)+'\n');status=errors.length?'completed-with-console-errors':'completed';
}catch(error){status='partial';errors.push({type:'observation',message:String(error),stack:error.stack});console.error(error);process.exitCode=1;
  try{const partial=await bounded('read partial',page.evaluate(()=>({state:window.roadsterLab?.getState(),performance:window.roadsterLab?.getPerformance(),observation:window.cityFrameObservation})),10000);await writeFile(out+'partial.json',JSON.stringify(partial,null,2)+'\n');}catch(e){errors.push({type:'partial-read',message:String(e)});}
}finally{
  await Promise.allSettled(sourceReads);
  await writeFile(out+'summary.json',JSON.stringify({schema:'roadster-native-city-performance-3.17',label,status,identity,device,phases,errors,sourceResponses,scope:'Chrome/ANGLE SwiftShader in this execution environment; 1280×720 DPR1. Fixed same camera and exposure, active stationary solver, 5 s warmup + 30 s steady per high/ultra. Source hashes are actual received JS/CSS/manifest bytes. No claim about the user GPU, 60 FPS, continuous driving, exhaustive per-draw validity or a statistically powered benchmark. Source/render changes include the rest of 3.17; timings do not isolate one optimization.'},null,2)+'\n');
  await bounded('close browser',browser.close(),15000).catch(e=>console.error(e));
}
