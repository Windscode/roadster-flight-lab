import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const port=process.argv[2]||'8316',label=process.argv[3]||'fixed',views=(process.argv[4]||'crosstown').split(','),weathers=(process.argv[5]||'clear-day').split(','),captureMethod=process.argv[6]||'page';
const width=Number(process.env.CITY_CAPTURE_WIDTH)||1280,height=Math.round(width*9/16),quality=process.env.CITY_CAPTURE_QUALITY||'high';
const output=(process.env.CITY_CAPTURE_OUTPUT||new URL('./city-pixels-3.16/reproduction/',import.meta.url).pathname)+label;await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.ROADSTER_CHROME||undefined,args:['--no-sandbox'],env:{...process.env}});
const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,acceptDownloads:true}),page=await context.newPage(),errors=[];page.setDefaultTimeout(30000);
page.on('pageerror',e=>{errors.push({type:'pageerror',message:e.message});console.log('pageerror',e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push({type:'console',message:m.text()});console.log('console',m.text());}});
try{
  console.log('navigate',label);await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.roadsterReady===true&&window.roadsterLab?.version,null,{timeout:45000});console.log('ready',label);
  for(const weather of weathers)for(const view of views){
    // These are the application's existing public UI handlers, invoked in one
    // DOM task to avoid repeated automation context stalls during software-GL
    // quality compilation. No simulator state or renderer internals are set.
    const setup=await page.evaluate(({weather,view,quality})=>{
      const select=(id,value)=>{const e=document.getElementById(id);if(!e||e.disabled||!Array.from(e.options).some(o=>o.value===value))throw new Error('Unavailable existing control '+id+'/'+value);if(e.value===value)return;e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
      select('weather-preset',weather);document.getElementById('exposure-baseline-39').click();select('benchmark-camera',view);select('quality',quality);
      return{version:window.roadsterLab.version,weather,view,quality:document.getElementById('quality').value,exposure:Number(document.getElementById('exposure-lock-value').value),settingMethod:'Existing public DOM controls and their change/click handlers; fixed still, not native driving'};
    },{weather,view,quality});console.log('configured',label,view,weather,quality,width,height);
    await page.waitForTimeout(8500);
    if(captureMethod==='native'){
      const pngDownload=page.waitForEvent('download',{timeout:45000});await page.evaluate(()=>document.getElementById('visual-capture').click());const png=await pngDownload;await png.saveAs(output+'/'+view+'-'+weather+'.png');
      const metaDownload=page.waitForEvent('download',{timeout:30000});await page.evaluate(()=>document.getElementById('visual-capture-metadata').click());const meta=await metaDownload;await meta.saveAs(output+'/'+view+'-'+weather+'-conditions.json');
      setup.frameSource='Existing application PNG export from a real completed frame; viewport canvas only';
    }else{await page.screenshot({path:output+'/'+view+'-'+weather+'.png',timeout:45000});setup.frameSource='Browser page screenshot including app HUD';}
    console.log('image',label,view,weather);
    const diagnostics=await page.evaluate(()=>({app:window.roadsterApp.getState(),state:window.roadsterLab.getState(),performance:window.roadsterLab.getPerformance()}));
    await writeFile(output+'/'+view+'-'+weather+'.json',JSON.stringify({setup,...diagnostics},null,2)+'\n');
  }
}catch(error){errors.push({type:'capture',message:String(error)});console.log('failed',String(error));process.exitCode=1;}
await writeFile(output+'/errors.json',JSON.stringify(errors,null,2)+'\n');await browser.close();
