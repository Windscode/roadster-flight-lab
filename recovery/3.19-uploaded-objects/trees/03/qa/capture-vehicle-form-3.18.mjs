import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/package.json');
const {chromium}=require('playwright');
const base=process.argv[2],out=process.argv[3];
if(!base||!out)throw new Error('Pass URL and output directory');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/workspace/scratch/4a18da1d1c35/browser-runtime/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,acceptDownloads:true});
const errors=[],responses=[];page.on('pageerror',e=>errors.push({kind:'pageerror',message:e.message}));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push({kind:m.type(),message:m.text()});});
page.on('response',r=>{if(r.status()>=400)errors.push({kind:'http',url:r.url(),status:r.status()});if(/\.(js|css)(\?|$)/.test(r.url()))responses.push(r);});
const receipt={schema:'roadster.vehicle-form-native-3.18',url:base,startedAt:new Date().toISOString(),frames:[],errors,sourceResponses:[]};
const bounded=(p,ms)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Bounded operation exceeded '+ms+'ms')),ms))]);
async function download(id,name){const start=Date.now(),pending=page.waitForEvent('download',{timeout:30000});await page.locator('#'+id).dispatchEvent('click',{timeout:20000});const d=await pending;await bounded(d.saveAs(out+'/'+name),20000);return{eventToSaveCompleteMs:Date.now()-start,bytes:(await readFile(out+'/'+name)).length};}
try{
 await page.goto(base+'/vehicle-inspection.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>document.querySelector('#inspection-stage')?.dataset.graphics==='ready',{timeout:60000});
 await page.waitForFunction(()=>document.querySelector('#ready').textContent.includes('已就绪'),{timeout:60000});
 for(const view of (process.argv[4]||'front-quarter,front,side,rear-quarter,photo-side,photo-front').split(',')){
  await page.locator('[data-view="'+view+'"]').dispatchEvent('click',{timeout:20000});
  await page.waitForTimeout(350);
  const before=await download('capture-meta',view+'-before.json');
  const png=await download('capture-frame',view+'.png');
  const after=await download('capture-meta',view+'-after.json');
  receipt.frames.push({view,before,png,after});
  await writeFile(out+'/capture.json',JSON.stringify(receipt,null,2)+'\n');
 }
 for(const r of responses){try{receipt.sourceResponses.push({url:r.url(),status:r.status(),sha256:createHash('sha256').update(await r.body()).digest('hex')});}catch(e){receipt.sourceResponses.push({url:r.url(),error:e.message});}}
 receipt.status='captured';
}catch(e){receipt.status='failed';receipt.failure=String(e);process.exitCode=1;}finally{receipt.finishedAt=new Date().toISOString();await writeFile(out+'/capture.json',JSON.stringify(receipt,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:receipt.status,frames:receipt.frames.length,errors,failure:receipt.failure}));
