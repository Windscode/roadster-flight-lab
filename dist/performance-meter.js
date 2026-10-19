const percentile=(values,p)=>{if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*p))];};
const round=v=>Number.isFinite(v)?Math.round(v*100)/100:null;
const distribution=values=>({samples:values.length,p50Ms:round(percentile(values,.5)),p95Ms:round(percentile(values,.95)),p99Ms:round(percentile(values,.99)),maxMs:values.length?round(Math.max(...values)):null});
let captureSerial=0;

// rAF intervals, CPU submission and asynchronous GPU execution are independent
// measurements. A GPU query is counted once when its actual result arrives.
export class PerformanceMeter{
  constructor(renderer,{capacity=360}={}){
    this.renderer=renderer;this.capacity=capacity;this.frames=[];this.frameNumber=0;
    this.gl=renderer.getContext();this.ext=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending=[];this.gpuMs=null;this.query=null;this.gpuSamples=[];this.capture=null;this.last=null;this.disjointDiscarded=0;
    const safeParameter=p=>{try{return p===undefined?null:this.gl.getParameter(p);}catch{return null;}};
    const debug=this.gl.getExtension('WEBGL_debug_renderer_info');
    this.device={userAgent:typeof navigator==='undefined'?null:navigator.userAgent,hardwareConcurrency:typeof navigator==='undefined'?null:navigator.hardwareConcurrency||null,deviceMemoryGiB:typeof navigator==='undefined'?null:navigator.deviceMemory||null,
      vendor:safeParameter(debug?.UNMASKED_VENDOR_WEBGL??this.gl.VENDOR),renderer:safeParameter(debug?.UNMASKED_RENDERER_WEBGL??this.gl.RENDERER),webglVersion:safeParameter(this.gl.VERSION),gpuTimerSupported:!!this.ext};
  }
  begin(now,frameMs){
    this.pollGpu();this.current={frameNumber:++this.frameNumber,time:now,frameMs,cpu:{},passes:{}};this.started=performance.now();
  }
  measure(name,fn){
    const before=performance.now(),calls=this.renderer.info.render.calls,triangles=this.renderer.info.render.triangles;
    try{return fn();}finally{
      if(this.current){this.current.cpu[name]=(this.current.cpu[name]||0)+performance.now()-before;
        const dc=this.renderer.info.render.calls-calls,dt=this.renderer.info.render.triangles-triangles;
        if(dc>0)this.current.passes[name]={calls:dc,triangles:dt};}
    }
  }
  beginGpu(){
    if(!this.ext||this.pending.length>=4||this.frameNumber%12!==0)return;
    const query=this.gl.createQuery();if(!query)return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,query);this.query={query,frame:this.current};
  }
  endGpu(){if(this.query){this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending.push(this.query);this.query=null;}}
  pollGpu(){
    if(!this.ext||!this.pending.length)return;
    const gl=this.gl,disjoint=gl.getParameter(this.ext.GPU_DISJOINT_EXT),remaining=[];
    for(const pending of this.pending){const {query,frame}=pending;
      if(disjoint){gl.deleteQuery(query);this.gpuMs=null;this.disjointDiscarded++;if(this.capture&&frame.captureId===this.capture.id)this.capture.gpuDisjointDiscarded++;}
      else if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){
        const value=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;this.gpuMs=Number.isFinite(value)&&value>=0?value:null;gl.deleteQuery(query);
        if(this.gpuMs!==null){const sample={frameNumber:frame.frameNumber,time:frame.time,phase:frame.capturePhase||'rolling',gpuMs:this.gpuMs};this.gpuSamples.push(sample);if(this.gpuSamples.length>Math.max(this.capacity,240))this.gpuSamples.shift();if(this.capture&&frame.captureId===this.capture.id)this.capture.gpuSamples.push(sample);}
      }else remaining.push(pending);
    }
    this.pending=remaining;
  }
  end(extra={}){
    this.endGpu();const frame=this.current;frame.cpu.total=performance.now()-this.started;frame.calls=this.renderer.info.render.calls;frame.triangles=this.renderer.info.render.triangles;Object.assign(frame,extra);this.last=frame;
    this.frames.push(frame);if(this.frames.length>this.capacity)this.frames.shift();
    const capture=this.capture;
    if(capture&&!capture.complete&&!capture.stopped&&frame.active){
      frame.captureId=capture.id;
      if(capture.warmupElapsedMs<capture.warmupMs){frame.capturePhase='warmup';capture.warmupFrames.push(frame);capture.warmupElapsedMs+=frame.frameMs;}
      else {frame.capturePhase='steady';capture.frames.push(frame);capture.elapsedMs+=frame.frameMs;}
      if(capture.elapsedMs>=capture.durationMs){capture.complete=true;capture.endedAt=new Date().toISOString();}
      if(capture.frames.length+capture.warmupFrames.length>=50000){capture.stopped=true;capture.stopReason='采样达到 50000 帧上限，部分记录已保留';}
    }
    return frame;
  }
  reset(){this.frames.length=0;this.gpuSamples.length=0;this.last=null;}
  startCapture({warmupMs=0,durationMs=30000,metadata={}}={}){
    if(!Number.isFinite(warmupMs)||warmupMs<0||warmupMs>60000||!Number.isFinite(durationMs)||durationMs<1000||durationMs>180000)throw new RangeError('Invalid performance capture window');
    this.capture={id:'render-'+Date.now()+'-'+(++captureSerial),startedAt:new Date().toISOString(),metadata:JSON.parse(JSON.stringify(metadata)),warmupMs,warmupElapsedMs:0,durationMs,elapsedMs:0,frames:[],warmupFrames:[],gpuSamples:[],gpuDisjointDiscarded:0,events:[],complete:false,stopped:false};
    return this.capture;
  }
  stopCapture(reason='用户停止采样'){if(this.capture&&!this.capture.complete){this.capture.stopped=true;this.capture.stopReason=reason;this.capture.endedAt=new Date().toISOString();}}
  markEvent(type,detail={}){if(this.capture&&!this.capture.complete&&!this.capture.stopped)this.capture.events.push({type,frameNumber:this.frameNumber,elapsedMs:this.capture.elapsedMs,phase:this.capture.warmupElapsedMs<this.capture.warmupMs?'warmup':'steady',...detail});}
  snapshot(frames=this.frames,gpuSamples=this.gpuSamples){
    const active=frames.filter(frame=>frame.active),use=active.length?active:frames;
    // Long frames remain in percentiles. Hidden/paused intervals are excluded
    // only through the explicit active flag, never through a duration cutoff.
    const intervals=use.map(frame=>frame.frameMs).filter(value=>Number.isFinite(value)&&value>0);
    const cpuNames=new Set(use.flatMap(frame=>Object.keys(frame.cpu))),frameNumbers=new Set(use.map(frame=>frame.frameNumber));
    const cpu=Object.fromEntries([...cpuNames].map(name=>{const d=distribution(use.map(frame=>frame.cpu[name]||0));return[name,{...d,medianMs:d.p50Ms}];}));
    const gpu=gpuSamples.filter(sample=>frameNumbers.has(sample.frameNumber));
    const raf=distribution(intervals),resolutions=use.map(frame=>frame.resolution).filter(Boolean),pixels=resolutions.map(size=>size.width*size.height);
    return{samples:use.length,activeDriving:active.length>0,medianFps:round(raf.p50Ms?1000/raf.p50Ms:null),frameMedianMs:raf.p50Ms,frameP95Ms:raf.p95Ms,frameP99Ms:raf.p99Ms,onePercentLowFps:round(raf.p99Ms?1000/raf.p99Ms:null),rafFrameTime:raf,
      longFrames:{over50Ms:intervals.filter(ms=>ms>50).length,over100Ms:intervals.filter(ms=>ms>100).length,over250Ms:intervals.filter(ms=>ms>250).length,maxMs:raf.maxMs},
      cpuSubmission:cpu,gpuExecution:distribution(gpu.map(sample=>sample.gpuMs)),gpuMs:round(this.gpuMs),gpuTimerSupported:!!this.ext,
      renderPixels:pixels.length?{min:Math.min(...pixels),max:Math.max(...pixels),changed:Math.min(...pixels)!==Math.max(...pixels)}:null,
      lastFrame:use.length?{calls:use.at(-1).calls,triangles:use.at(-1).triangles,passes:use.at(-1).passes,resolution:use.at(-1).resolution,physicsSteps:use.at(-1).physicsSteps}:null};
  }
  export(extra={}){
    const capture=this.capture;
    return{format:'roadster-render-profile-2',...extra,device:this.device,capturedAt:new Date().toISOString(),
      capture:capture?{id:capture.id,startedAt:capture.startedAt,endedAt:capture.endedAt||null,metadata:capture.metadata,elapsedMs:capture.elapsedMs,durationMs:capture.durationMs,complete:capture.complete,stopped:capture.stopped,stopReason:capture.stopReason||null,
        warmup:{requestedMs:capture.warmupMs,elapsedMs:capture.warmupElapsedMs,summary:this.snapshot(capture.warmupFrames,capture.gpuSamples),frames:capture.warmupFrames},
        summary:this.snapshot(capture.frames,capture.gpuSamples),frames:capture.frames,gpuSamples:capture.gpuSamples,gpuDisjointDiscarded:capture.gpuDisjointDiscarded,events:capture.events,
        comparisonConditionsChanged:capture.events.some(event=>['quality_change','weather_change','scene_change','camera_change'].includes(event.type))}:null,
      rolling:this.snapshot(),pendingGpuQueries:this.pending.length,disjointQueriesDiscarded:this.disjointDiscarded,
      measurement:'Actual browser rAF frame intervals including long frames; CPU submission timings; optional nonblocking WebGL GPU query results counted once each. Loading duration is separate from active warmup and steady-state capture. No actual GPU sample is inferred from draw calls, CPU time or an unavailable timer.'};
  }
  dispose(){this.endGpu();for(const {query} of this.pending)this.gl.deleteQuery(query);this.pending.length=0;}
}
