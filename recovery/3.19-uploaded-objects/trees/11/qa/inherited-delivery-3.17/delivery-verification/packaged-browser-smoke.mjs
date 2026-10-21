import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const out=dirname(fileURLToPath(import.meta.url));
const base=new URL(process.argv[2]||'http://127.0.0.1:8318/');
const root=resolve(process.argv[3]);
const expected=JSON.parse(await readFile(join(root,'dist/deployment.json'),'utf8'));
assert.equal(base.hostname,'127.0.0.1');
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={schema:'roadster-packaged-candidate-browser-smoke-3.17',startedAt:new Date().toISOString(),status:'running',expectedIdentity:expected,errors:[],responseHashes:{},scope:'One fresh actual browser boot and screenshot from an independently extracted candidate ZIP served by its packaged launcher. This is a startup/identity/asset smoke check, not repeated city/physics/research acceptance or hardware-GPU performance.'};
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROMIUM,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
report.browserVersion=browser.version();
const pending=[];
page.on('pageerror',e=>report.errors.push({kind:'pageerror',message:e.message}));
page.on('console',m=>{if(m.type()==='error')report.errors.push({kind:'console',message:m.text()});});
page.on('requestfailed',r=>report.errors.push({kind:'requestfailed',url:r.url(),failure:r.failure()}));
page.on('response',r=>{
  const url=new URL(r.url());
  if(r.status()>=400)report.errors.push({kind:'http',status:r.status(),url:r.url()});
  const p=url.pathname.split('/').at(-1);
  if(['model-build.js','physics.js','vehicle.js','urban-architecture.js','index.html'].includes(p))pending.push(r.body().then(async data=>{
    const local=await readFile(join(root,'dist',p));
    report.responseHashes[p]={bytes:data.length,sha256:hash(data),matchesExtractedBytes:hash(data)===hash(local)};
  }).catch(e=>report.errors.push({kind:'response-read',message:e.message,url:r.url()})));
});
try{
  const response=await page.goto(base.href,{waitUntil:'domcontentloaded',timeout:60000});
  report.navigation={url:page.url(),status:response?.status()};
  await page.waitForFunction(()=>window.roadsterReady&&window.roadsterLab,null,{timeout:60000});
  report.actual=await page.evaluate(async()=>{
    const identity=await (await fetch('./deployment.json',{cache:'no-store'})).json();
    const module=await import('./model-build.js');
    const canvas=document.querySelector('#viewport canvas')||document.querySelector('canvas');
    const gl=canvas?.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
    const state=window.roadsterLab.getState();
    return{identity,modelBuildId:module.MODEL_BUILD_ID,sourceCount:Object.keys(module.MODEL_SOURCE_HASHES).length,ready:window.roadsterReady,version:window.roadsterLab.version,title:document.title,canvas:canvas?{width:canvas.width,height:canvas.height}:null,device:gl?{version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}:null,mode:state.mode,paused:state.paused};
  });
  assert.deepEqual(report.actual.identity,expected);
  assert.equal(report.actual.modelBuildId,expected.modelBuildId);
  assert.equal(report.actual.sourceCount,178);
  assert.equal(report.actual.ready,true);
  assert.ok(report.actual.canvas?.width>0&&report.actual.canvas?.height>0);
  const png=await page.screenshot({path:join(out,'packaged-startup.png'),timeout:20000});
  report.frame={file:'packaged-startup.png',bytes:png.length,sha256:hash(png)};
  await Promise.all(pending);
  assert.ok(Object.keys(report.responseHashes).length>=4);
  assert.ok(Object.values(report.responseHashes).every(x=>x.matchesExtractedBytes));
  assert.deepEqual(report.errors,[]);
  report.status='passed';
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};process.exitCode=1;}
finally{
  await Promise.allSettled(pending);
  report.finishedAt=new Date().toISOString();
  await writeFile(join(out,'packaged-browser-smoke.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
  console.log(JSON.stringify({status:report.status,url:report.navigation?.url,sourceCount:report.actual?.sourceCount,errors:report.errors,failure:report.failure}));
}
