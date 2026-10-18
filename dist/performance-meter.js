const percentile=(values,p)=>{if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*p))];};
const round=v=>Number.isFinite(v)?Math.round(v*100)/100:null;

// CPU submission time is not GPU time. GPU queries are optional, asynchronous,
// sampled once per 12 frames, and discarded on disjoint events without gl.finish.
export class PerformanceMeter{
  constructor(renderer,{capacity=360}={}){
    this.renderer=renderer;this.capacity=capacity;this.frames=[];this.frameNumber=0;
    this.gl=renderer.getContext();this.ext=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending=[];this.gpuMs=null;this.query=null;this.capture=null;this.last=null;
  }
  begin(now,frameMs){
    this.pollGpu();this.current={time:now,frameMs,cpu:{},passes:{},gpuMs:this.gpuMs};this.started=performance.now();this.frameNumber++;
  }
  measure(name,fn){
    const before=performance.now(),calls=this.renderer.info.render.calls,triangles=this.renderer.info.render.triangles;
    try{return fn();}finally{
      this.current.cpu[name]=(this.current.cpu[name]||0)+performance.now()-before;
      const dc=this.renderer.info.render.calls-calls,dt=this.renderer.info.render.triangles-triangles;
      if(dc>0)this.current.passes[name]={calls:dc,triangles:dt};
    }
  }
  beginGpu(){
    if(!this.ext||this.pending.length>=4||this.frameNumber%12!==0)return;
    const q=this.gl.createQuery();if(!q)return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,q);this.query=q;
  }
  endGpu(){if(this.query){this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending.push(this.query);this.query=null;}}
  pollGpu(){
    if(!this.ext||!this.pending.length)return;
    const gl=this.gl,disjoint=gl.getParameter(this.ext.GPU_DISJOINT_EXT),remaining=[];
    for(const q of this.pending){
      if(disjoint){gl.deleteQuery(q);this.gpuMs=null;}
      else if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){const value=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;this.gpuMs=Number.isFinite(value)&&value>=0?value:null;gl.deleteQuery(q);}
      else remaining.push(q);
    }
    this.pending=remaining;
  }
  end(extra={}){
    this.endGpu();const f=this.current;f.cpu.total=performance.now()-this.started;f.calls=this.renderer.info.render.calls;f.triangles=this.renderer.info.render.triangles;Object.assign(f,extra);this.last=f;
    this.frames.push(f);if(this.frames.length>this.capacity)this.frames.shift();
    if(this.capture&&!this.capture.complete&&f.active&&this.capture.frames.length<18000){this.capture.frames.push(f);this.capture.elapsedMs+=f.frameMs;if(this.capture.elapsedMs>=30000)this.capture.complete=true;}
    return f;
  }
  reset(){this.frames.length=0;this.last=null;}
  startCapture(){this.capture={startedAt:new Date().toISOString(),elapsedMs:0,frames:[],complete:false};}
  snapshot(frames=this.frames){
    const active=frames.filter(f=>f.active),use=active.length?active:frames,intervals=use.map(f=>f.frameMs).filter(v=>v>0&&v<1000),cpuNames=new Set(use.flatMap(f=>Object.keys(f.cpu)));
    const cpu=Object.fromEntries([...cpuNames].map(name=>[name,{medianMs:round(percentile(use.map(f=>f.cpu[name]||0),.5)),p95Ms:round(percentile(use.map(f=>f.cpu[name]||0),.95))}]));
    const median=percentile(intervals,.5),p95=percentile(intervals,.95),p99=percentile(intervals,.99);
    return{samples:use.length,activeDriving:active.length>0,medianFps:round(median?1000/median:null),frameMedianMs:round(median),frameP95Ms:round(p95),onePercentLowFps:round(p99?1000/p99:null),cpuSubmission:cpu,gpuMs:round(this.gpuMs),gpuTimerSupported:!!this.ext,lastFrame:this.last?{calls:this.last.calls,triangles:this.last.triangles,passes:this.last.passes,resolution:this.last.resolution,physicsSteps:this.last.physicsSteps}:null};
  }
  export(extra={}){
    const capture=this.capture;
    return{format:'roadster-render-profile-1',...extra,capturedAt:new Date().toISOString(),capture:capture?{startedAt:capture.startedAt,elapsedMs:capture.elapsedMs,complete:capture.complete,summary:this.snapshot(capture.frames),frames:capture.frames}:null,rolling:this.snapshot(),measurement:'Browser rAF frame intervals; CPU submission timings. Optional nonblocking EXT_disjoint_timer_query_webgl2 GPU samples. This is runtime data, not a hardware FPS guarantee.'};
  }
  dispose(){this.endGpu();for(const q of this.pending)this.gl.deleteQuery(q);this.pending.length=0;}
}
