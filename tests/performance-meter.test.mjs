import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {PerformanceMeter} from '../dist/performance-meter.js';

// Measurement bookkeeping only. The GL facade supplies known timer values;
// these are not measurements of any browser or GPU.
const checks=[],pass=name=>{checks.push(name);console.log('PASS: '+name);};
function fixture({timer=false,capacity=400}={}){
  const ext={TIME_ELAPSED_EXT:99,GPU_DISJOINT_EXT:98};
  const gl={VENDOR:1,RENDERER:2,VERSION:3,QUERY_RESULT_AVAILABLE:4,QUERY_RESULT:5,disjoint:false,queries:[],deleted:[],
    getExtension:name=>name==='EXT_disjoint_timer_query_webgl2'&&timer?ext:null,
    getParameter(parameter){return parameter===98?this.disjoint:parameter===1?'test-vendor':parameter===2?'timer-facade':'facade';},
    createQuery(){const query={id:this.queries.length,ready:false,value:4000000};this.queries.push(query);return query;},
    beginQuery(){},endQuery(){},deleteQuery(query){this.deleted.push(query.id);},
    getQueryParameter(query,parameter){return parameter===this.QUERY_RESULT_AVAILABLE?query.ready:query.value;},
  };
  const renderer={getContext:()=>gl,info:{render:{calls:0,triangles:0}}};
  const meter=new PerformanceMeter(renderer,{capacity});let time=0;
  const frame=(frameMs,{active=true,gpu=false,diagnosticFrame=false,resolution={width:1280,height:720}}={})=>{
    time+=frameMs;meter.begin(time,frameMs);
    const returned=meter.measure('submission',()=>{renderer.info.render.calls++;return 37;});assert.equal(returned,37);
    if(gpu)meter.beginGpu();return meter.end({active,resolution,diagnosticFrame});
  };
  return{meter,frame,gl};
}

{
  const {meter,frame}=fixture();for(let ms=1;ms<=100;ms++)frame(ms);frame(1500);frame(20000,{active:false});
  const summary=meter.snapshot();assert.equal(summary.samples,101);assert.equal(summary.frameMedianMs,51);assert.equal(summary.frameP95Ms,96);assert.equal(summary.frameP99Ms,100);
  assert.deepEqual(summary.longFrames,{over50Ms:51,over100Ms:1,over250Ms:1,maxMs:1500});
  assert.equal(summary.gpuExecution.samples,0);assert.equal(summary.gpuMs,null);assert.equal(summary.gpuTimerSupported,false);
  assert.equal(summary.cpuSubmission.submission.samples,101);assert.ok(summary.cpuSubmission.submission.p50Ms>=0);
  pass('Frame percentiles retain a 1.5 s long frame, exclude explicitly paused intervals, and do not invent GPU samples');
}
{
  const {meter,frame}=fixture();meter.startCapture({warmupMs:100,durationMs:1000,metadata:{preset:'clear-day',resolution:[1280,720]}});
  for(let i=0;i<5;i++)frame(20);frame(9000,{active:false});
  for(let i=0;i<49;i++)frame(20);assert.equal(meter.capture.complete,false);assert.equal(meter.capture.elapsedMs,980);
  frame(20);assert.equal(meter.capture.complete,true);frame(20);
  const report=meter.export();assert.equal(report.capture.warmup.frames.length,5);assert.equal(report.capture.frames.length,50);
  assert.equal(report.capture.summary.samples,50);assert.equal(report.capture.warmup.summary.samples,5);assert.equal(report.capture.complete,true);
  assert.equal(report.capture.comparisonConditionsChanged,false);assert.equal(report.capture.metadata.preset,'clear-day');
  assert.equal(report.capture.summary.renderPixels.changed,false);
  pass('Active warmup and steady-state windows are separate, pause time is excluded, and completion freezes the requested capture');
}
{
  const {meter,frame}=fixture();meter.startCapture({durationMs:30000});frame(16);meter.markEvent('weather_change',{weatherPreset:'wet-night'});frame(40,{resolution:{width:960,height:540}});meter.stopCapture('user-cancel');frame(16);
  const report=meter.export();assert.equal(report.capture.complete,false);assert.equal(report.capture.stopped,true);assert.equal(report.capture.stopReason,'user-cancel');
  assert.equal(report.capture.frames.length,2);assert.equal(report.capture.events[0].type,'weather_change');assert.equal(report.capture.comparisonConditionsChanged,true);assert.equal(report.capture.summary.renderPixels.changed,true);
  assert.throws(()=>meter.startCapture({durationMs:NaN}),RangeError);assert.throws(()=>meter.startCapture({durationMs:0}),RangeError);
  pass('Cancellation retains partial evidence and configuration/resolution changes are visible in exported comparison conditions');
}
{
  const {meter,frame,gl}=fixture({timer:true});meter.startCapture({durationMs:30000});
  for(let i=0;i<12;i++)frame(16,{gpu:true});assert.equal(gl.queries.length,1);assert.equal(meter.gpuSamples.length,0);
  gl.queries[0].ready=true;frame(16);assert.equal(meter.gpuSamples.length,1);assert.equal(meter.gpuSamples[0].frameNumber,12);
  for(let i=0;i<10;i++)frame(16);assert.equal(meter.gpuSamples.length,1);assert.equal(meter.capture.gpuSamples.length,1);
  frame(16,{gpu:true});assert.equal(gl.queries.length,2);gl.disjoint=true;frame(16);gl.disjoint=false;
  assert.equal(meter.gpuSamples.length,1);assert.equal(meter.disjointDiscarded,1);assert.equal(meter.capture.gpuDisjointDiscarded,1);assert.equal(meter.pending.length,0);
  const report=meter.export();assert.equal(report.capture.summary.gpuExecution.samples,1);assert.equal(report.capture.summary.gpuExecution.p50Ms,4);
  assert.equal(report.capture.gpuSamples[0].phase,'steady');assert.deepEqual(gl.deleted,[0,1]);
  pass('Asynchronous GPU queries are attributed to their original frame once, and disjoint queries are discarded with evidence');
}

{
  const {meter,frame}=fixture();frame(33,{active:false});frame(900,{active:false,diagnosticFrame:true});let summary=meter.snapshot();assert.equal(summary.samples,1);assert.equal(summary.diagnosticFramesExcluded,1);assert.equal(summary.population,'paused-preview');assert.equal(summary.frameP99Ms,33);
  meter.startCapture({durationMs:1000});frame(700,{diagnosticFrame:true});frame(16);summary=meter.snapshot();assert.equal(summary.samples,1);assert.equal(summary.frameP99Ms,16);assert.equal(summary.diagnosticFramesExcluded,2);assert.equal(meter.capture.frames.length,1);assert.equal(meter.capture.elapsedMs,16);
  pass('Explicit diagnostic frames are excluded from paused and driving statistics and cannot advance a performance capture');
}
writeFileSync(new URL(`../qa/performance-meter-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({status:'passed',createdAt:new Date().toISOString(),checks,
  scope:'Unit validation of timing statistics, phased capture and a deterministic GL query facade.',
  limitations:'No real browser, rAF scheduler, WebGL driver or GPU was measured. These checks do not constitute FPS or visual acceptance.'},null,2)+'\n');
