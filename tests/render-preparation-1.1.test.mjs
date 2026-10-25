import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {compileScenePrograms,createRenderPreparation,awaitSceneReady} from '../dist/render-preparation.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

// A shared material's last program is ready before an earlier instanced
// variant. The pinned renderer's per-material promise resolves at that point.
let earlierReady=false,lastReady=true,yields=0;
const earlier={isReady:()=>earlierReady},last={isReady:()=>lastReady};
const renderer={info:{programs:[earlier,last]},compile(){assert.ok(lastReady);}};
const phases=[],queue=createRenderPreparation(()=>compileScenePrograms(renderer,{}, {},{yieldFrame:async()=>{yields++;earlierReady=true;}}),{onBusy:b=>phases.push(b)});
await queue.run();assert.equal(yields,1);assert.deepEqual(phases,[true,false]);assert.equal(queue.needed,false);
const second=await compileScenePrograms(renderer,{}, {},{yieldFrame:()=>{throw Error('Already ready programs must not wait');}});
assert.equal(second.programs,2);
let sync=0;assert.deepEqual(await compileScenePrograms({compile(){sync++;}}, {},{}),{programs:0});assert.equal(sync,1);
await assert.rejects(compileScenePrograms({compile(){throw Error('compile failure');}}, {},{}),/compile failure/);
let clock=0;const stuckProgram={compile(){},info:{programs:[{isReady:()=>false}]}};
await assert.rejects(compileScenePrograms(stuckProgram,{}, {},{timeoutMs:20,now:()=>clock,yieldFrame:async()=>{clock+=10;}}),/材质准备超时/);
await assert.rejects(compileScenePrograms({...stuckProgram,getContext:()=>({isContextLost:()=>true})},{},{}),/上下文已丢失/);
assert.equal(await awaitSceneReady(Promise.resolve('loaded'),{timeoutMs:10}),'loaded');
await assert.rejects(awaitSceneReady(Promise.reject(Error('asset failure')),{timeoutMs:10}),/asset failure/);
const busy=[];let compiled=false;
const stuck=createRenderPreparation(async()=>{await awaitSceneReady(new Promise(()=>{}),{timeoutMs:5});compiled=true;},{onBusy:v=>busy.push(v)});
await assert.rejects(stuck.run(),/载入超时/);assert.equal(compiled,false);assert.deepEqual(busy,[true,false]);assert.equal(stuck.needed,false);
const report={status:'passed',modelVersion:MODEL_VERSION,checks:['Every submitted shared-material variant completes before controls resume','Already-ready programs require no wait','Synchronous/facade fallback and compilation failures retain their semantics','Resource failure/deadline releases UI lock, never starts compilation and never retries each frame'],scope:'Pinned Three.js program-readiness contract; real shader/link timing and scene pixels require browser acceptance.'};
mkdirSync(`qa/rendering-${REPORT_VERSION}`,{recursive:true});writeFileSync(`qa/rendering-${REPORT_VERSION}/preparation.json`,JSON.stringify(report,null,2)+'\n');console.log('PASS all submitted shader variants awaited');
