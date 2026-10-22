import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const base=process.argv[2]||'http://127.0.0.1:8317/',output=resolve(process.argv[3]||'qa/research-native-3.17/layout-verified');
const input=resolve(process.argv[4]||'qa/research-native-3.17/final-ui/native-task-library.json');
const hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(output,{recursive:true});
const report={schema:'roadster-native-research-layout-3.17',startedAt:new Date().toISOString(),status:'running',errors:[],responseHashes:{},scope:'Actual browser file-input import of an earlier actual Worker archive and one layout capture. This does not rerun the Worker, repeat a download or measure GPU performance.'};
const bytes=await readFile(input),archive=JSON.parse(bytes);
report.input={file:input,bytes:bytes.length,sha256:hash(bytes),records:archive.records.length,identities:archive.records.map(r=>r.identity)};
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROMIUM,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
report.browserVersion=browser.version();
const page=await browser.newPage({viewport:{width:1366,height:960},deviceScaleFactor:1}),pending=[];
page.setDefaultTimeout(20000);
page.on('pageerror',e=>report.errors.push({kind:'pageerror',message:e.message}));
page.on('response',r=>{
 if(r.status()>=400)report.errors.push({kind:'http',status:r.status(),url:r.url()});
 const path=new URL(r.url()).pathname.split('/').at(-1);
 if(['model-build.js','landing-research-ui.js','research-console.css','wind-control-study.js'].includes(path))pending.push(r.body().then(data=>{report.responseHashes[path]={bytes:data.length,sha256:hash(data)};}).catch(e=>report.errors.push({kind:'response-body',url:r.url(),message:e.message})));
});
try{
 await page.goto(new URL('?view=lab',base).href,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.roadsterReady&&window.roadsterLab,null,{timeout:60000});
 if(await page.locator('#menu-resume').isVisible())await page.locator('#menu-resume').click();
 if(!(await page.evaluate(()=>window.roadsterLab.getState())).paused)await page.locator('#pause-btn').dispatchEvent('click');
 if(!(await page.evaluate(()=>window.roadsterLab.getState())).research.open)await page.locator('[data-research-console]').first().click();
 await page.locator('[data-rc-tab="landing"]').click();
 await page.locator('input[data-lr="import"]').setInputFiles(input);
 await page.waitForFunction(count=>window.roadsterLab.getState().research.landing.recordCount===count,archive.records.length,{timeout:30000});
 await page.locator('[data-rc-workspace="analyze"]').click();
 await page.locator('[data-lr-present="analysis"]').click();
 await page.locator('.lr-wind-results').evaluate(el=>el.scrollIntoView({block:'start'}));
 report.layout=await page.evaluate(()=>{
  const section=document.querySelector('.lr-wind-results'),heading=section.querySelector('h3'),seed=section.querySelector('[data-lr="wind-results"]>p'),status=document.querySelector('.landing-research-panel .rc-numeric-controls');
  const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
  const visible=e=>{const r=e.getBoundingClientRect(),x=r.x+Math.min(r.width/2,200),y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return !!hit&&(e===hit||e.contains(hit));};
  return{busy:document.querySelector('.landing-research-panel').dataset.busy,statusPosition:getComputedStyle(status).position,heading:rect(heading),seed:rect(seed),status:rect(status),headingVisible:visible(heading),seedVisible:visible(seed),seedText:seed.textContent,table:section.querySelector('[data-lr="wind-results"]').innerText};
 });
 if(!report.layout.headingVisible||!report.layout.seedVisible)throw Error('Wind heading or exact seed is visually occluded');
 const file='wind-analysis.png',png=await page.screenshot({path:join(output,file),timeout:20000});report.frame={file,bytes:png.length,sha256:hash(png)};
 report.identity=await page.evaluate(async()=>{const m=await import('./model-build.js');return{modelBuildId:m.MODEL_BUILD_ID,sourceHashes:m.MODEL_SOURCE_HASHES};});
 const stored=JSON.parse(await page.evaluate(()=>localStorage.getItem('roadster-landing-research-v1')));
 if(JSON.stringify(stored.records)!==JSON.stringify(archive.records))throw Error('Imported records changed');
 report.archivePreserved=true;report.status='passed';
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};process.exitCode=1;try{await page.screenshot({path:join(output,'failure.png'),timeout:20000});}catch{}}
finally{await Promise.allSettled(pending);report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({status:report.status,output,layout:report.layout,errors:report.errors}));}
