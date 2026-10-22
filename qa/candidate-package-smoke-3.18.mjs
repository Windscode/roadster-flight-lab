// Delivery identity check against an independently extracted candidate.
// No physical state setters, simulated driving sequence or publication action.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const [baseURL,output,expectedBuild,expectedCommit,expectedTree]=process.argv.slice(2);
if(!baseURL||!output||!expectedBuild||!expectedCommit||!expectedTree)throw Error('Supply candidate URL, output directory, build, commit and tree.');
const out=resolve(output);await mkdir(out,{recursive:true});
const startedAt=new Date().toISOString(),errors=[],responses={},pending=[];
const browser=await chromium.launch({headless:true,executablePath:process.env.ROADSTER_CHROME,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:960,height:600},deviceScaleFactor:1,acceptDownloads:false});
page.on('pageerror',error=>errors.push({type:'pageerror',message:String(error)}));
page.on('console',message=>{if(message.type()==='error')errors.push({type:'console',message:message.text()});});
page.on('response',response=>{
  const url=new URL(response.url());
  if(response.status()>=400)errors.push({type:'http',status:response.status(),url:response.url()});
  if(url.origin===new URL(baseURL).origin&&(/\.(js|css)$/.test(url.pathname)||url.pathname.endsWith('/deployment.json')))
    pending.push(response.body().then(bytes=>{responses[url.pathname]={status:response.status(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}).catch(error=>{responses[url.pathname]={error:String(error)};}));
});
const report={schema:'roadster-independent-candidate-browser-smoke-3.18',startedAt,baseURL,status:'not-complete',expected:{build:expectedBuild,commit:expectedCommit,tree:expectedTree},scope:'Actual Chromium/WebGL loading of independently unzipped candidate and runtime source/deployment identities. Read-only public application state and one screenshot. Not a controls, driving, GPU timing or broad visual acceptance run.'};
try{
  await page.goto(baseURL,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.roadsterReady===true&&window.roadsterLab?.version,null,{timeout:75000});
  Object.assign(report,await page.evaluate(async()=>{
    const module=await import('./model-build.js'),response=await fetch('./deployment.json'),deployment=await response.json();
    return {version:window.roadsterLab.version,build:module.MODEL_BUILD_ID,sourceHashes:module.MODEL_SOURCE_HASHES,deploymentStatus:response.status,deployment,state:window.roadsterLab.getState(),graphics:window.roadsterApp.getState().graphics};
  }));
  await page.screenshot({path:out+'/candidate-browser.png',timeout:45000});
  await Promise.allSettled(pending);
  const prefix=new URL(baseURL).pathname;
  report.sourceMismatches=Object.entries(responses).flatMap(([path,row])=>{
    const name=path.startsWith(prefix)?path.slice(prefix.length):path,expected=report.sourceHashes[name];
    return expected&&row.sha256!==expected?[{path,expected,actual:row.sha256,error:row.error}]:[];
  });
  if(report.build!==expectedBuild||report.deployment.modelBuildId!==expectedBuild||report.deployment.sourceCommit!==expectedCommit||report.deployment.sourceTree!==expectedTree||report.deploymentStatus!==200)throw Error('Candidate identity differs from the declared source.');
  if(report.sourceMismatches.length||errors.some(error=>error.type==='pageerror'))throw Error('Loaded-source mismatch or page error.');
  report.status='passed-package-loading-and-identity';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();report.errors=errors;report.sourceResponses=responses;
  await writeFile(out+'/candidate-browser-report.json',JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
console.log(JSON.stringify({status:report.status,version:report.version,build:report.build,sourceMismatches:report.sourceMismatches?.length,errors,report:out+'/candidate-browser-report.json'},null,2));
