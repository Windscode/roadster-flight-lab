import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const root=mkdtempSync(join(tmpdir(),'roadster-launch-'));
const put=(name,value)=>{mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),typeof value==='string'?value:JSON.stringify(value));};
const asset='fixture-data';
const launch=port=>spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,ROADSTER_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let child;
try{
  put('package.json',{type:'module'});
  mkdirSync(join(root,'scripts'));
  for(const name of ['serve.mjs','prepare-dependencies.mjs','publication-contract.mjs','repository-payloads.mjs'])copyFileSync(new URL('../scripts/'+name,import.meta.url),join(root,'scripts',name));
  put('dist/vehicle-models.js',"export const MODEL_VERSION='3.21.0';");
  put('dist/model-build.js',"export const MODEL_BUILD_ID='fixture-current';");
  put('dist/index.html','<!doctype html><title>Local development</title>');
  put('dist/assets/fixture.bin',asset);
  put('publication/recovery-plan.json',{schema:'roadster.recovered-publication',version:1,source:{modelVersion:'3.19.0'},runtime:[{path:'dist/index.html'},{path:'dist/assets/fixture.bin',bytes:asset.length,sha256:createHash('sha256').update(asset).digest('hex')}]});
  const {prepareDependencies}=await import(pathToFileURL(join(root,'scripts/prepare-dependencies.mjs')));
  assert.equal(prepareDependencies({root,purpose:'runtime'}).restoration.restored,0);
  const original=readFileSync(join(root,'dist/assets/fixture.bin'));
  put('dist/assets/fixture.bin','edited-asset');
  const edited=prepareDependencies({root,purpose:'runtime'});
  assert.equal(edited.scope,'development-runtime-files');
  assert.equal(edited.verification.modifiedAssets.length,1);
  assert.equal(edited.verification.modifiedAssets[0].path,'dist/assets/fixture.bin');
  assert.equal(readFileSync(join(root,'dist/assets/fixture.bin'),'utf8'),'edited-asset','Never restore over edited assets');
  // Original-version recovery still requires the exact historical asset.
  put('dist/vehicle-models.js',"export const MODEL_VERSION='3.19.0';");
  const exact=launch(0);let exactError='';exact.stderr.on('data',b=>exactError+=b);
  const [exactCode]=await once(exact,'exit');assert.equal(exactCode,1);assert.match(exactError,/Recovered asset changed/);
  assert.equal(readFileSync(join(root,'dist/assets/fixture.bin'),'utf8'),'edited-asset');
  put('dist/vehicle-models.js',"export const MODEL_VERSION='3.21.0';");
  put('dist/assets/fixture.bin',original.toString());
  child=launch(0);
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Server did not start: '+log)),8000);
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+log));});
    child.stdout.on('data',()=>{const m=log.match(/http:\/\/127\.0\.0\.1:\d+\//);if(m){clearTimeout(timer);resolve(m[0]);}});
  });
  const health=await (await fetch(url+'health')).json();
  assert.equal(health.version,'3.21.0');assert.equal(health.modelBuildId,'fixture-current');
  assert.match(await (await fetch(url)).text(),/Local development/);
  const range=await fetch(url+'assets/fixture.bin',{headers:{Range:'bytes=0-6'}});
  assert.equal(range.status,206);assert.equal(await range.text(),'fixture');
  assert.equal((await fetch(url,{method:'HEAD'})).status,200);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  // A previously running version must never silently satisfy a new launch.
  put('dist/model-build.js',"export const MODEL_BUILD_ID='fixture-newer';");
  const newer=launch(new URL(url).port);let error='';newer.stderr.on('data',b=>error+=b);
  const [exitCode]=await once(newer,'exit');assert.equal(exitCode,1);assert.match(error,/different Roadster build/);
  console.log('PASS: fresh development launch, edited assets allowed and preserved, exact recovery strict, HTTP content/ranges, stale server rejection');
}finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}rmSync(root,{recursive:true,force:true});}
