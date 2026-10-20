import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
// Capture transaction and archive association only. The fixture supplies opaque
// canvas marker bytes; this is deliberately not pixel, WebGL or FPS evidence.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {captureInspectionPair} from '../dist/inspection-capture.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const drawOrder=[],renderer={domElement:{width:960,height:540,markers:[]}};
const conditions={simTime:12.25,camera:{position:[3,1.2,5],projectionMatrix:[1,0,0,1]},wing:{position:.31,incidenceRad:.055},suspensionLength:.287,steer:.12,lighting:'studio',quality:'ultra',materialState:{currentGlassOpacity:.94,referenceGlassOpacity:.78}};
class CanvasFixture{
  constructor(){this.markers=[];this.text=[];}
  getContext(){return{drawImage:(source,...args)=>{assert.ok(args.length===2,'Original/comparison draw must not scale the source');this.markers.push(...source.markers.map(value=>({...value})));},fillRect:()=>{},fillText:text=>this.text.push(text)};}
  toBlob(callback,type){const bytes=JSON.stringify({width:this.width,height:this.height,markers:this.markers,text:this.text});queueMicrotask(()=>callback(new Blob([bytes],{type})));}
}
const request={renderer,canvasFactory:()=>new CanvasFixture(),baselineVersion:'3.9',currentVersion:'3.10',archive:true,captureId:'surface-fixture-frozen-state',
  render:role=>{drawOrder.push(role);renderer.domElement.markers=[{role,simTime:conditions.simTime,cameraX:conditions.camera.position[0]}];},
  snapshot:(role,association)=>({...conditions,recordScope:'rendered-frame-conditions',captureId:association.captureId,frameAssociation:association,modelVersion:role==='reference'?'3.9.0':MODEL_VERSION,comparisonProtocol:{schema:'roadster.surface-comparison',version:2,baselineCommit:'6083bbf0e01f4eef5447f2c1b951d8b41e691f46'}}),
  caption:role=>role,footnote:'fixture labels'};
const pending=captureInspectionPair(request);
// Both synchronous copies must already exist before the first PNG callback.
assert.deepEqual(drawOrder,['reference','current']);
conditions.simTime=90;conditions.camera.position[0]=99;conditions.wing.position=.8;renderer.domElement.markers[0].cameraX=-50;
const result=await pending;
assert.ok(Object.isFrozen(result.record));assert.ok(Object.isFrozen(result.record.frames[0].conditions.camera.position));
assert.throws(()=>{result.record.frames[0].conditions.camera.position[0]=7;},TypeError);
for(const frame of result.record.frames){assert.equal(frame.conditions.simTime,12.25);assert.equal(frame.conditions.camera.position[0],3);assert.equal(frame.conditions.wing.position,.31);assert.equal(frame.conditions.captureId,result.captureId);assert.equal(frame.conditions.frameAssociation.originalFile,frame.file);}
assert.deepEqual(result.record.originalResolution,[960,540]);assert.deepEqual(result.record.comparisonResolution,[1920,602]);

function storedEntries(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result=new Map();let offset=0;while(view.getUint32(offset,true)===0x04034b50){assert.equal(view.getUint16(offset+8,true),0);const length=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+nameLength+extra;const name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength));result.set(name,bytes.slice(start,start+length));offset=start+length;}return result;}
const files=storedEntries(new Uint8Array(await result.archiveBlob.arrayBuffer())),decode=name=>JSON.parse(new TextDecoder().decode(files.get(name)));
assert.equal(files.size,5);assert.deepEqual(decode(result.record.files.conditions),result.record);
for(const role of ['reference','current']){const frame=decode(result.record.files[role]);assert.equal(frame.width,960);assert.equal(frame.height,540);assert.deepEqual(frame.markers,[{role,simTime:12.25,cameraX:3}]);assert.deepEqual(frame.text,[],'Original frames must not receive the comparison labels');}
assert.deepEqual(decode(result.record.files.comparison).markers.map(marker=>marker.role),['reference','current']);
const comparisonOnly=await captureInspectionPair({...request,archive:false,captureId:'surface-fixture-comparison-only'});assert.ok(comparisonOnly.pairBlob);assert.equal(comparisonOnly.archiveBlob,undefined);
await assert.rejects(captureInspectionPair({...request,canvasFactory:()=>({getContext:()=>null})}),/2D capture canvas/);
class NoImage extends CanvasFixture{toBlob(callback){queueMicrotask(()=>callback(null));}}
await assert.rejects(captureInspectionPair({...request,canvasFactory:()=>new NoImage()}),/PNG encoding returned no image/);
const sourcePaths=['dist/inspection-capture.js','dist/capture-archive.js','tests/inspection-capture-3.10.test.mjs'];
const report={status:'passed',asOf:new Date().toISOString(),modelVersion:MODEL_VERSION,buildId:MODEL_BUILD_ID,scope:'Synthetic canvas lifecycle and ZIP association regression. Fixture marker bytes are not PNG image evidence; no WebGL, appearance or frame-time result.',checks:['Two render/copy/snapshot operations complete before asynchronous PNG encoding','Immutable per-frame nested conditions remain unchanged after caller state mutates','Both original frame copies preserve their role and conditions while a separate comparison carries labels','Original drawing-buffer size is preserved; the comparison alone adds a label band','Five-file ZIP binds original/comparison bytes and JSON by one captureId','Standalone comparison PNG remains available; unavailable canvas and missing PNG reject without a success bundle'],sourceHashes:Object.fromEntries(sourcePaths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]))};
writeFileSync(new URL(`../qa/inspection-capture-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
