// Publish reviewed, version-controlled runtime and explicitly listed QA payloads.
// Local reference images outside these lists are not publication inputs.
import {spawnSync} from 'node:child_process';
import {restorePayloads,readPayloadManifest} from './repository-payloads.mjs';
restorePayloads({strict:true});
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,lstatSync,mkdirSync,copyFileSync,writeFileSync,mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';

const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(root,'.pages-site');
function gitText(args){
  // Keep Git output readable in managed runners that reject pipe handles.
  // Execution errors and nonzero exits still stop publication preparation.
  const directory=mkdtempSync(resolve(tmpdir(),'roadster-pages-git-'));
  const stdoutPath=resolve(directory,'stdout.log'),stderrPath=resolve(directory,'stderr.log');
  let outFd,errFd;
  try{
    outFd=openSync(stdoutPath,'w');errFd=openSync(stderrPath,'w');
    const result=spawnSync('git',args,{cwd:root,stdio:['ignore',outFd,errFd]});
    if(result.error||result.status!==0)throw new Error('git '+args.join(' ')+' failed: '+readFileSync(stderrPath,'utf8'),{cause:result.error});
    return readFileSync(stdoutPath,'utf8');
  }finally{
    if(outFd!==undefined)closeSync(outFd);if(errFd!==undefined)closeSync(errFd);
    rmSync(directory,{recursive:true,force:true});
  }
}
if(relative(root,output)!=='.pages-site')throw Error('Invalid publishing directory');
if(existsSync(output))throw Error('Publication needs a fresh .pages-site directory; existing files were preserved.');
for(const [file,expected]of Object.entries(MODEL_SOURCE_HASHES)){
  const actual=createHash('sha256').update(readFileSync(resolve(root,'dist',file))).digest('hex');
  if(actual!==expected)throw Error('Model source differs from recorded build: '+file);
}
const packedRuntime=readPayloadManifest(root).files.filter(entry=>entry.path.startsWith('dist/')).map(entry=>entry.path);
const files=[...new Set([...gitText(['ls-files','-z','--','dist']).split('\0').filter(Boolean),...packedRuntime])];
if(!files.length)throw Error('No tracked runtime files');
mkdirSync(output);
let bytes=0,count=0;
for(const file of files){
  const local=file.slice('dist/'.length);
  if(!file.startsWith('dist/')||local==='assets/reference-roadster.jpg'||/^assets\/references\/.*\.(jpg|jpeg|png|webp)$/i.test(local)||/\.(zip|log)$/i.test(local))throw Error('Unreviewed public file: '+file);
  const source=resolve(root,file),target=resolve(output,local),targetRelative=relative(output,target);
  if(targetRelative==='..'||targetRelative.startsWith('..'+sep)||lstatSync(source).isSymbolicLink())throw Error('Invalid runtime path: '+file);
  mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);bytes+=lstatSync(source).size;count++;
}
for(const name of ['LICENSE','THIRD-PARTY-NOTICES.md'])copyFileSync(resolve(root,name),resolve(output,name));
// Public numerical/raw-image evidence is explicitly listed in the reviewed
// payload manifest. It is downloaded only when its link is opened.
let evidenceFiles=0,evidenceBytes=0;
for(const entry of readPayloadManifest(root).files.filter(entry=>entry.path.startsWith('qa/'))){
  const source=resolve(root,entry.path),target=resolve(output,entry.path);
  mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);evidenceFiles++;evidenceBytes+=entry.bytes;
}
for(const entry of ['index.html','app.js','app-shell.js','research.html','research-panel.html','vehicle-inspection.html','experiment-worker.js','experiment-replay-worker.js','assets/music/manifest.json','assets/music/CREDITS.txt','assets/irradiance/manifest.json','assets/night-irradiance/manifest.json','night-city-lighting.js','city-frontage-design.js','driving-capture.js','inspection-capture.js','capture-archive.js'])if(!existsSync(resolve(output,entry)))throw Error('Missing public entry: '+entry);
const sourceCommit=gitText(['rev-parse','HEAD']).trim();
const sourceTree=gitText(['rev-parse','HEAD^{tree}']).trim();
writeFileSync(resolve(output,'deployment.json'),JSON.stringify({application:'roadster-flight-lab',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,sourceCommit,sourceTree,sourceRepository:'https://github.com/Windscode/roadster-flight-lab',runtimeFiles:count,runtimeBytes:bytes,evidenceFiles,evidenceBytes},null,2)+'\n');
console.log(JSON.stringify({status:'ready',directory:'.pages-site',runtimeFiles:count,runtimeBytes:bytes,modelBuildId:MODEL_BUILD_ID}));
