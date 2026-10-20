import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {encodeJsonChunks,exportJson,exportFile,getExportState,cancelExport} from '../dist/export-download.js';
import {InputSession} from '../dist/input-session.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const require=createRequire(import.meta.url),{JSDOM}=require(process.argv[2]||process.env.JSDOM_MODULE_PATH||'jsdom');
const checks=[],measurements={},pause=()=>new Promise(r=>setTimeout(r,0));
const test=async(name,fn)=>{await fn();checks.push({name,status:'passed'});console.log('PASS: '+name);};
const encode=async value=>(await encodeJsonChunks(value)).parts.join('');
await test('Chunked JSON preserves supported data and native JSON normalization without double toJSON',async()=>{
  const cases=[null,true,1.25,-0,'汉字 / \ud800',[undefined,()=>{},Symbol('x'),NaN,Infinity],{keep:1,omit:undefined,a:new Number(3),b:new Boolean(false),date:new Date('2026-01-01T00:00:00Z')},[{toJSON:key=>({key,empty:null})}]];
  const object={toJSON(){return{nested:{toJSON(){return{value:8};}}};}};cases.push(object);
  for(const value of cases)assert.equal(await encode(value),JSON.stringify(value));
  let count=0;const once={outer:{toJSON(){count++;return{toJSON(){throw Error('toJSON must not run twice for the same property');},ok:1};}}};
  assert.deepEqual(JSON.parse(await encode(once)),{outer:{ok:1}});assert.equal(count,1);
  const shared={value:1};assert.equal(await encode({a:shared,b:shared}),JSON.stringify({a:shared,b:shared}));
  await assert.rejects(encode(5n),/BigInt/);await assert.rejects(encode(undefined),/No JSON/);const cycle={};cycle.cycle=cycle;await assert.rejects(encode(cycle),/Circular/);
});
await test('Large preparation yields to the event loop and cancellation stops before file handoff',async()=>{
  const value=Array.from({length:40000},(_,i)=>({step:i,time:i/120,note:'project synthetic evidence',quaternion:{x:0,y:0,z:0,w:1},input:{throttle:.2,pitch:0,lift:0}}));
  const controller=new AbortController();let progress=0,yields=0;
  await assert.rejects(encodeJsonChunks(value,{signal:controller.signal,budgetMs:0,yieldTurn:async()=>{yields++;controller.abort();await pause();},onProgress:()=>progress++}),e=>e.name==='AbortError');
  assert.equal(yields,1);assert(progress>=1);
  let timerRan=false;setTimeout(()=>{timerRan=true;},0);const before=performance.now(),encoded=await encodeJsonChunks(value);
  measurements.synthetic40000={bytes:Buffer.byteLength(encoded.parts.join('')),elapsedMs:performance.now()-before,chunks:encoded.parts.length};
  assert(timerRan,'event loop must remain available');assert.deepEqual(JSON.parse(encoded.parts.join('')),value);
});
const dom=new JSDOM('<!doctype html><body></body>',{url:'https://fixture.invalid/'}),doc=dom.window.document;
const original={create:URL.createObjectURL,revoke:URL.revokeObjectURL};let blobs=[],clicks=0,failClick=false;
URL.createObjectURL=blob=>{blobs.push(blob);return'blob:export-'+blobs.length;};URL.revokeObjectURL=()=>{};
dom.window.HTMLAnchorElement.prototype.click=function(){if(failClick)throw Error('Synthetic browser handoff rejection');clicks++;};
try{
  await test('Preparation, browser handoff and disk completion are recorded as distinct states',async()=>{
    const events=new InputSession({capacity:8});events.note('fixture',{value:{x:1}});const snapshot=events.export({source:'synthetic-test'},{clone:false});
    events.note('later',{value:2});assert.equal(snapshot.events.length,1);assert(Object.isFrozen(snapshot.events[0]));
    const result=await exportJson(()=>snapshot,'input.json',{doc});assert.equal(result.status,'handed-off');assert.equal(result.browserCompletion,'unobservable');
    assert.equal(result.bytes,blobs.at(-1).size);assert.deepEqual(JSON.parse(await blobs.at(-1).text()),snapshot);assert(clicks>0);assert.equal(doc.querySelector('.export-job-card').hidden,false);
    for(const metric of ['elapsedMs','snapshotMs','serializeMs','blobMs'])assert(Number.isFinite(result[metric])&&result[metric]>=0);
    measurements.inputHandoff=result;
  });
  await test('Cancel, visible preparation failure and browser retry preserve an honest outcome',async()=>{
    let called=false;const before=clicks,pending=exportJson(()=>{called=true;return{};},'cancel.json',{doc});cancelExport(doc);const stopped=await pending;
    assert.equal(stopped.status,'cancelled');assert.equal(called,false);assert.equal(clicks,before);
    const failed=await exportJson(()=>{throw Error('Synthetic snapshot failure');},'failed.json',{doc});assert.equal(failed.status,'failed');assert.match(doc.querySelector('[data-export="detail"]').textContent,/Synthetic snapshot failure/);
    failClick=true;const handoffFailed=await exportJson(()=>({complete:true}),'retry.json',{doc});assert.equal(handoffFailed.status,'failed');assert.equal(doc.querySelector('[data-export="retry"]').hidden,false);
    failClick=false;doc.querySelector('[data-export="retry"]').click();assert.equal(getExportState(doc).status,'handed-off');assert.equal(clicks,before+1);
  });
  await test('Dedicated-worker protocol transfers exact records and cancels by terminating its worker',async()=>{
    const originalWorker=doc.defaultView.Worker,instances=[];
    class FixtureWorker{
      constructor(){this.terminated=false;instances.push(this);}
      async postMessage({value}){this.value=structuredClone(value);await pause();if(this.terminated)return;const encoded=await encodeJsonChunks(this.value);if(this.terminated)return;this.onmessage({data:{type:'progress',progress:{characters:encoded.characters,visited:encoded.visited}}});this.onmessage({data:{type:'complete',result:{blob:new Blob(encoded.parts,{type:'application/json'}),characters:encoded.characters,visited:encoded.visited,workerSerializeMs:1}}});}
      terminate(){this.terminated=true;}
    }
    try{
      doc.defaultView.Worker=FixtureWorker;
      const value={records:[{id:'synthetic-worker',samples:[1,2,3]}]},done=await exportJson(()=>value,'worker.json',{doc});
      assert.equal(done.serializer,'worker');assert.deepEqual(JSON.parse(await blobs.at(-1).text()),value);assert(instances.at(-1).terminated);assert.equal(done.workerSerializeMs,1);
      class CustomValue{toJSON(){return{custom:true};}}
      const special=await exportJson(()=>({nested:new CustomValue()}),'custom.json',{doc});assert.equal(special.serializer,'cooperative-main-thread');assert.deepEqual(JSON.parse(await blobs.at(-1).text()),{nested:{custom:true}});
      const count=clicks,pending=exportJson(()=>value,'worker-cancel.json',{doc});await pause();cancelExport(doc);const stopped=await pending;assert.equal(stopped.status,'cancelled');assert.equal(clicks,count);assert(instances.at(-1).terminated);
      measurements.workerProtocol={scope:'Worker transport fixture, not native worker performance',completed:done,cancelled:stopped};
    }finally{doc.defaultView.Worker=originalWorker;}
  });
  await test('A superseded asynchronous snapshot cannot replace or relabel a newer export',async()=>{
    let finish,start;const entered=new Promise(r=>{start=r;});const delayed=exportJson(()=>{start();return new Promise(r=>{finish=r;});},'old.json',{doc});await entered;
    const latest=await exportJson(()=>({current:true}),'new.json',{doc});finish({obsolete:true});const prior=await delayed;
    assert.equal(latest.filename,'new.json');assert.equal(prior.status,'cancelled');assert.equal(getExportState(doc).filename,'new.json');assert.deepEqual(JSON.parse(await blobs.at(-1).text()),{current:true});
    const raw='original archived bytes\n汉字';await exportFile(raw,'raw.json','application/json',{doc});assert.equal(await blobs.at(-1).text(),raw);
  });
}finally{URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;dom.window.close();}
const files=['dist/export-encoder.js','dist/export-worker.js','dist/export-download.js','dist/input-session.js','tests/export-progress-3.16.test.mjs'];
writeFileSync('qa/export-progress-3.16.json',JSON.stringify({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,checks,measurements,sourceHashes:Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),scope:'Actual cooperative encoder, immutable received-event journal and DOM download manager; browser handoff is simulated here. Native download measurement is reported separately. No claim about the earlier browser tool timeout.'},null,2)+'\n');
