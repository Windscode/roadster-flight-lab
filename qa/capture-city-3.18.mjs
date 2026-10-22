import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const port=process.argv[2]||'8317',label=process.argv[3]||'candidate',views=(process.argv[4]||'crosstown').split(','),weathers=(process.argv[5]||'clear-day,wet-night').split(',');
const output=new URL('./city-native-3.18/'+label+'/',import.meta.url).pathname;await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.ROADSTER_CHROME,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,acceptDownloads:false});
const errors=[];page.on('pageerror',e=>errors.push({type:'pageerror',message:e.message}));page.on('console',m=>{if(m.type()==='error')errors.push({type:'console',message:m.text()});});
page.on('response',response=>{if(response.status()>=400)errors.push({type:'http',status:response.status(),url:response.url()});});
const sourceResponses={},sourceReads=[];page.on('response',response=>{const u=new URL(response.url());if(u.hostname==='127.0.0.1'&&(/\.(js|css)$/.test(u.pathname)||/\/manifest\.json$/.test(u.pathname)))sourceReads.push(response.body().then(bytes=>{sourceResponses[u.pathname]={status:response.status(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}).catch(error=>{sourceResponses[u.pathname]={error:String(error)};}));});
page.setDefaultTimeout(30000);
try{
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.roadsterReady===true&&window.roadsterLab?.version,null,{timeout:60000});
  const identity=await page.evaluate(async()=>{const m=await import('/model-build.js');return {build:m.MODEL_BUILD_ID,sourceHashes:m.MODEL_SOURCE_HASHES};});
  if(process.env.ROADSTER_EXPECT_BUILD&&identity.build!==process.env.ROADSTER_EXPECT_BUILD)throw Error('Unexpected build '+identity.build);
  console.log('ready',label);
  for(const view of views)for(const weather of weathers){
    if(view==='drive'&&weather!=='clear-day')continue;
    const setup=await page.evaluate(({weather,view})=>{
      const select=(id,value)=>{const e=document.getElementById(id);if(!e||e.disabled||!Array.from(e.options).some(o=>o.value===value))throw Error('Unavailable UI control '+id+'/'+value);if(e.value!==value){e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}};
      select('weather-preset',weather);document.getElementById('exposure-baseline-39').click();
      if(view==='drive')document.getElementById('benchmark-route-start').click();
      select('benchmark-camera',view);select('quality','high');
      return {version:window.roadsterLab.version,weather,view,quality:document.getElementById('quality').value,exposure:Number(document.getElementById('exposure-lock-value').value)};
    },{weather,view});
    await page.waitForTimeout(7500);
    if(await page.evaluate(()=>window.roadsterLab.getState().paused))await page.keyboard.press('p');
    if(!await page.evaluate(()=>document.body.classList.contains('body-cinema')))await page.keyboard.press('F9');
    await page.waitForTimeout(1200);
    const nativeDrive=view==='drive'?{requestedSimS:.8,startedWallMs:Date.now(),startSimS:await page.evaluate(()=>window.roadsterLab.getState().simTime)}:null;
    if(nativeDrive){
      await page.keyboard.down('w');
      let observed=nativeDrive.startSimS;
      while(observed-nativeDrive.startSimS<nativeDrive.requestedSimS&&Date.now()-nativeDrive.startedWallMs<25000){await page.waitForTimeout(250);observed=await page.evaluate(()=>window.roadsterLab.getState().simTime);}
      nativeDrive.observedBeforeCaptureSimS=observed-nativeDrive.startSimS;
    }
    const before=await page.evaluate(()=>({state:window.roadsterLab.getState(),performance:window.roadsterLab.getPerformance(),renderer:window.roadsterApp.getState().graphics}));
    await page.screenshot({path:output+view+'-'+weather+'.png',timeout:45000});
    const after=await page.evaluate(()=>({state:window.roadsterLab.getState(),performance:window.roadsterLab.getPerformance()}));
    if(nativeDrive){await page.keyboard.up('w');nativeDrive.finishedWallMs=Date.now();nativeDrive.observedAfterCaptureSimS=after.state.simTime-nativeDrive.startSimS;}
    await Promise.allSettled(sourceReads);
    const sourceMismatches=Object.entries(sourceResponses).filter(([path,row])=>identity.sourceHashes[path.slice(1)]&&row.sha256!==identity.sourceHashes[path.slice(1)]).map(([path,row])=>({path,expected:identity.sourceHashes[path.slice(1)],actual:row.sha256}));
    await writeFile(output+view+'-'+weather+'.json',JSON.stringify({identity,setup,before,after,nativeDrive,sourceResponses,sourceMismatches,scope:'Unedited browser PNG at 1280x720/DPR1 from real WebGL. Existing fixed-view/weather/exposure/quality UI controls, real P resume and F9 cinema keys. Source hashes are actual received response bytes, checked against the loaded source manifest. Fixed street views run without drive input. The drive view uses the existing route-entry UI, normal chase camera and real held W through the screenshot; actual elapsed simulation/wall times and before/after state are recorded separately. These samples bracket the PNG and are not an atomic frame binding. No target GPU performance claim.'},null,2)+'\n');
    if(sourceMismatches.length)throw Error('Loaded source manifest mismatch: '+sourceMismatches.map(r=>r.path).join(', '));
    console.log('saved',label,view,weather);
  }
}catch(error){await page.keyboard.up('w').catch(()=>{});errors.push({type:'capture',message:String(error)});console.error(error);process.exitCode=1;}
await writeFile(output+'errors.json',JSON.stringify(errors,null,2)+'\n');await browser.close();
