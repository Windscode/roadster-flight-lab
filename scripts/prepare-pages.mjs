// Publish only reviewed, version-controlled runtime files, never local reference images.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,lstatSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';

const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(root,'.pages-site');
if(relative(root,output)!=='.pages-site')throw Error('Invalid publishing directory');
if(existsSync(output))throw Error('Publication needs a fresh .pages-site directory; existing files were preserved.');
for(const [file,expected]of Object.entries(MODEL_SOURCE_HASHES)){
  const actual=createHash('sha256').update(readFileSync(resolve(root,'dist',file))).digest('hex');
  if(actual!==expected)throw Error('Model source differs from recorded build: '+file);
}
const files=execFileSync('git',['ls-files','-z','--','dist'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
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
for(const entry of ['index.html','app.js','app-shell.js','research.html','research-panel.html','vehicle-inspection.html','experiment-worker.js','experiment-replay-worker.js','assets/music/manifest.json','assets/music/CREDITS.txt','assets/irradiance/manifest.json'])if(!existsSync(resolve(output,entry)))throw Error('Missing public entry: '+entry);
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const sourceTree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim();
writeFileSync(resolve(output,'deployment.json'),JSON.stringify({application:'roadster-flight-lab',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,sourceCommit,sourceTree,sourceRepository:'https://github.com/Windscode/roadster-flight-lab',runtimeFiles:count,runtimeBytes:bytes},null,2)+'\n');
console.log(JSON.stringify({status:'ready',directory:'.pages-site',runtimeFiles:count,runtimeBytes:bytes,modelBuildId:MODEL_BUILD_ID}));
