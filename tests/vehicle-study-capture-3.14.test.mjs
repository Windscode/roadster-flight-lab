import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {captureVehicleStudy,captureVehicleOrbit,vehicleStudyCases} from '../dist/vehicle-study-capture.js';
import {VEHICLE_STUDY_VIEWS} from '../dist/vehicle-display-study.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const checks=[],check=async(name,fn)=>checks.push({name,status:'passed',detail:await fn()});
const renderer={domElement:{width:1280,height:720,marker:null}};
class CanvasFixture{
  getContext(){return{drawImage:(source,...args)=>{assert.deepEqual(args,[0,0]);this.marker=JSON.parse(JSON.stringify(source.marker));}};}
  toBlob(callback){const body=JSON.stringify({width:this.width,height:this.height,marker:this.marker,fixture:'Synthetic marker bytes, not pixels'});queueMicrotask(()=>callback(new Blob([body],{type:'image/png'})));}
}
const unpack=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),files=new Map();let offset=0;while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),names=view.getUint16(offset+26,true),extras=view.getUint16(offset+28,true),start=offset+30+names+extras;files.set(new TextDecoder().decode(bytes.subarray(offset+30,offset+30+names)),bytes.slice(start,start+size));offset=start+size;}return files;};
const json=(files,name)=>JSON.parse(new TextDecoder().decode(files.get(name)));
function request(overrides={}){let index=0;return{renderer,views:VEHICLE_STUDY_VIEWS,canvasFactory:()=>new CanvasFixture(),prepare:()=>{},render:spec=>{renderer.domElement.marker={index:index++,id:spec.id};return{status:'passed',drawCount:1};},snapshot:(spec,association)=>({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,simTime:7.5,physical:{wheelSteer:.2},association,spec}),...overrides};}
await check('Exactly 24 immediate copy/frame-condition associations survive asynchronous PNG and ZIP encoding',async()=>{
  assert.throws(()=>vehicleStudyCases(['front']),/Six/);const result=await captureVehicleStudy(request()),files=await unpack(result.blob);assert.equal(result.report.status,'completed');assert.equal(files.size,26);assert.equal(result.report.actualFrames,24);
  for(const [index,frame] of result.report.frames.entries()){const png=json(files,frame.file);assert.equal(png.width,1280);assert.equal(png.height,720);assert.equal(png.marker.index,index);assert.equal(png.marker.id,frame.id);assert.equal(frame.conditions.association.imageFile,frame.file);assert.equal(frame.conditions.simTime,7.5);assert.equal(frame.conditions.association.pixelsEdited,false);}
  const directory=mkdtempSync('/tmp/roadster-vehicle-zip-'),zipPath=directory+'/synthetic-study.zip';
  try{
    writeFileSync(zipPath,Buffer.from(await result.blob.arrayBuffer()));
    const open=spawnSync('python3',['-c',"import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({'files':len(z.infolist()),'frames':len(json.loads(z.read('vehicle-study.json'))['frames'])}))",zipPath],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000});
    assert.equal(open.status,0,open.error?.message||open.stderr);assert.deepEqual(JSON.parse(open.stdout),{files:26,frames:24});
  }finally{rmSync(directory,{recursive:true,force:true});}
  return{frames:24,files:26,zipOpenAndCRC:'Python standard-library ZipFile.testzip; all 26 entries readable',scope:'Synthetic canvas copy/ZIP contract only. PNG entries contain declared fixture markers, not actual pixels.'};
});
await check('Cancellation and prepare/PNG/draw failures keep exact partial outcomes instead of success',async()=>{
  const abort=new AbortController();let n=0;const cancelled=await captureVehicleStudy(request({signal:abort.signal,prepare:()=>{if(++n===4)abort.abort();}}));assert.equal(cancelled.report.status,'cancelled');assert.equal(cancelled.report.actualFrames,3);assert.equal((await unpack(cancelled.blob)).size,5);
  n=0;const failed=await captureVehicleStudy(request({prepare:()=>{if(++n===6)throw Error('fixture preparation failed');}}));assert.equal(failed.report.status,'failed');assert.equal(failed.report.actualFrames,5);assert.equal(failed.report.error.atFrame,5);assert.match(failed.report.error.message,/preparation failed/);
  class NoPNG extends CanvasFixture{toBlob(callback){queueMicrotask(()=>callback(null));}}
  const pngFailed=await captureVehicleStudy(request({canvasFactory:()=>new NoPNG()}));assert.equal(pngFailed.report.status,'failed');assert.equal(pngFailed.report.actualFrames,0);assert.match(pngFailed.report.error.message,/PNG/);
  const drawFailed=await captureVehicleStudy(request({render:spec=>{renderer.domElement.marker={id:spec.id};return{status:'failed',glErrors:[1286]};}}));assert.equal(drawFailed.report.actualFrames,24);assert.equal(drawFailed.report.status,'draw-failed');assert.deepEqual(drawFailed.report.frames[0].programAudit.glErrors,[1286]);
  return{cancelledFrames:3,prepareFailureFrames:5,pngFailureFrames:0,drawFailureFrames:24,drawFailurePreserved:[1286]};
});
await check('Archive failure returns a readable failure JSON without claiming image export',async()=>{
  const result=await captureVehicleStudy(request({archiveWriter:()=>{throw Error('fixture ZIP failure');}}));assert.equal(result.report.status,'failed');assert.equal(result.report.captureStatusBeforeArchiveFailure,'completed');assert.equal(result.report.archiveError.imagesExported,false);assert.match(result.name,/archive-failed.json$/);const report=JSON.parse(await result.blob.text());assert.equal(report.actualFrames,24);assert.equal(report.archiveError.step,'archive-encoding');return{fallback:'failure JSON',frameConditionsRetained:24,imagesExported:false};
});
class RecorderFixture{
  static isTypeSupported(type){return type==='video/webm';}
  constructor(){this.state='inactive';}
  start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['synthetic video fixture, not actual recording'])});this.onstop?.();});}
}
await check('Orbit duration, cancellation, errors and track cleanup are explicit',async()=>{
  let time=0,stops=0;const stream={getTracks:()=>[{stop(){stops++;}}]},r={domElement:{captureStream:()=>stream}},frames=[];
  const options={renderer:r,MediaRecorderClass:RecorderFixture,requestFrame:callback=>queueMicrotask(()=>callback(time+=1000)),renderAt:frame=>frames.push(frame),snapshot:frame=>frame};
  const complete=await captureVehicleOrbit(options);assert.equal(complete.report.status,'completed');assert.equal(complete.report.frameConditions.at(-1).timeS,12);assert.equal(complete.report.frameConditions.at(-1).angleRad,Math.PI*2);assert.equal(stops,1);assert.equal((await unpack(complete.blob)).size,2);
  const abort=new AbortController();time=0;const cancelled=await captureVehicleOrbit({...options,signal:abort.signal,renderAt:frame=>{if(frame.timeS===3)abort.abort();}});assert.equal(cancelled.report.status,'cancelled');assert.equal(cancelled.report.frameConditions.at(-1).timeS,3);assert.equal(stops,2);
  time=0;const failed=await captureVehicleOrbit({...options,renderAt:()=>{throw Error('fixture render failed');}});assert.equal(failed.report.status,'failed');assert.match(failed.report.error.message,/render failed/);assert.equal(stops,3);
  await assert.rejects(captureVehicleOrbit({...options,durationS:4}),/10–15/);await assert.rejects(captureVehicleOrbit({...options,MediaRecorderClass:null}),/cannot record/);
  return{completeRequestedS:12,cancelledAtS:3,failedAtFrame:failed.report.error.atFrame,tracksClosed:stops,videoEvidence:false};
});
const files=['dist/vehicle-study-capture.js','dist/vehicle-display-study.js','tests/vehicle-study-capture-3.14.test.mjs'];
const report={status:'passed',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,asOf:new Date().toISOString(),scope:'Synthetic canvas, ZIP and recorder failure lifecycle tests. No WebGL pixels, actual video, transparency or performance result.',checks,sourceHashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]))};
writeFileSync(new URL(`../qa/vehicle-study-capture-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
