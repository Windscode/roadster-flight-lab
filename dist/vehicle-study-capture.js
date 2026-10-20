import {captureArchive} from './capture-archive.js';

const frozenJSON=value=>JSON.parse(JSON.stringify(value));
const encodePNG=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG encoding returned no image.')),'image/png'));
const identifier=()=>`vehicle-study-${Date.now().toString(36)}`;
export function vehicleStudyCases(views){
  if(!Array.isArray(views)||views.length!==6||new Set(views).size!==6)throw new RangeError('Six distinct study views are required.');
  return ['studio','daylight'].flatMap(lighting=>views.flatMap(view=>['reference','current'].map(role=>({lighting,view,role,id:`${lighting}-${view}-${role}`}))));
}
// Each frame is copied synchronously immediately after its actual colour draw.
// Encoding/ZIP I/O never chooses a later renderer frame. Cancelled/failed archives
// retain their exact partial frame count and never receive a passed status.
export async function captureVehicleStudy({renderer,views,prepare,render,snapshot,canvasFactory,signal,archiveWriter=captureArchive,captureId=identifier()}){
  const width=renderer.domElement.width,height=renderer.domElement.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('No inspection drawing buffer.');
  const cases=vehicleStudyCases(views),frames=[],files=[];let error=null,status='completed';
  try{
    for(const spec of cases){
      if(signal?.aborted){status='cancelled';break;}
      await prepare(spec);
      if(signal?.aborted){status='cancelled';break;}
      const canvas=canvasFactory();canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');
      if(!context)throw Error('No 2D copy canvas.');
      const programAudit=render(spec);if(programAudit?.then)throw Error('Study colour rendering must be synchronous.');
      context.drawImage(renderer.domElement,0,0);
      const file=spec.id+'.png',conditions=frozenJSON(snapshot(spec,{captureId,role:spec.role,imageFile:file,conditionsFile:'vehicle-study.json',source:'actual-inspection-webgl-frame',pixelsEdited:false}));
      const blob=await encodePNG(canvas);canvas.width=1;canvas.height=1;
      frames.push({...spec,file,programAudit:frozenJSON(programAudit??null),conditions});files.push({name:file,data:blob});
    }
  }catch(cause){status='failed';error={name:cause?.name||'Error',message:String(cause?.message||cause),atFrame:frames.length};}
  if(status==='completed'&&frames.some(frame=>frame.programAudit?.status!=='passed'))status='draw-failed';
  const report={schema:'roadster-vehicle-study-1',captureId,createdAt:new Date().toISOString(),status,expectedFrames:cases.length,actualFrames:frames.length,resolution:[width,height],frames,error,
    protocol:'Six technical views × studio/daylight × frozen 3.13/current experimental display. Same 50 mm technical lens except the explicit 18 mm interior view, same resolution, exposure, articulated state, light rig and corrected shadows. Low-beam state; same current renderer. Each view/light pair is separate.',
    limitations:'No wet-city illumination is synthesized here. Official dual-seat study is a different display identity and is captured separately. Images are original live renderer pixels, not an appearance or performance verdict.'};
  files.push({name:'vehicle-study.json',data:JSON.stringify(report,null,2)},{name:'READ-ME.txt',data:'Original WebGL pixels and corresponding immutable conditions. Check status and actualFrames before treating a suite as complete. No image rescaling or retouching. A completed suite is evidence availability, not a visual-quality verdict.\n'});
  try{return{report,blob:await archiveWriter(files),name:`${captureId}-${status}.zip`};}
  catch(cause){report.captureStatusBeforeArchiveFailure=report.status;report.status='failed';report.archiveError={step:'archive-encoding',message:String(cause?.message||cause),imagesExported:false};return{report,blob:new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),name:`${captureId}-archive-failed.json`};}
}
export function preferredOrbitMime(MediaRecorderClass){
  return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorderClass?.isTypeSupported?.(type))||null;
}
export async function captureVehicleOrbit({renderer,renderAt,snapshot,signal,durationS=12,MediaRecorderClass=globalThis.MediaRecorder,requestFrame=callback=>requestAnimationFrame(callback),archiveWriter=captureArchive,captureId=identifier()}){
  if(durationS<10||durationS>15)throw RangeError('Orbit duration must be 10–15 seconds.');
  const mime=preferredOrbitMime(MediaRecorderClass);
  if(!mime||typeof renderer.domElement.captureStream!=='function')throw Error('This browser cannot record a WebM canvas. Use the original PNG suite.');
  const stream=renderer.domElement.captureStream(30),chunks=[],frames=[];let recorder;
  try{recorder=new MediaRecorderClass(stream,{mimeType:mime,videoBitsPerSecond:8000000});}catch(cause){stream.getTracks().forEach(track=>track.stop());throw cause;}
  let status='completed',error=null,recordingError=null,finished=false,start=null;
  const completion=new Promise(resolve=>{recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};recorder.onstop=()=>resolve();recorder.onerror=event=>{recordingError=event.error||Error('MediaRecorder failed.');resolve();};});
  try{
    recorder.start(1000);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{finished=true;reject(Error('Orbit recording exceeded its 30 second wall-clock budget.'));},30000);
      const tick=now=>{
        if(finished)return;
        try{
          if(signal?.aborted){status='cancelled';finished=true;clearTimeout(timeout);resolve();return;}
          if(recordingError)throw recordingError;
          if(start===null)start=now;const timeS=Math.min(durationS,(now-start)/1000),angleRad=timeS/durationS*Math.PI*2;
          renderAt({timeS,angleRad});
          frames.push(frozenJSON(snapshot({timeS,angleRad,index:frames.length},{captureId,source:'actual-inspection-canvas-video',videoFile:'orbit.webm',conditionsFile:'orbit.json'})));
          if(timeS>=durationS){finished=true;clearTimeout(timeout);resolve();}else requestFrame(tick);
        }catch(cause){finished=true;clearTimeout(timeout);reject(cause);}
      };requestFrame(tick);
    });
  }catch(cause){status='failed';error={name:cause?.name||'Error',message:String(cause?.message||cause),atFrame:frames.length};}
  finally{
    try{if(recorder.state!=='inactive')recorder.stop();let stopTimer;await Promise.race([completion.finally(()=>clearTimeout(stopTimer)),new Promise(resolve=>{stopTimer=setTimeout(()=>{status='failed';error={name:'RecorderStopTimeout',message:'Recorder did not finish within 5 seconds.'};resolve();},5000);})]);}
    finally{stream.getTracks().forEach(track=>track.stop());}
  }
  const video=new Blob(chunks,{type:mime});if(!video.size&&status==='completed'){status='failed';error={name:'EmptyVideo',message:'The browser returned no recorded video bytes.'};}
  const report={schema:'roadster-vehicle-orbit-1',captureId,status,requestedDurationS:durationS,videoMime:mime,videoBytes:video.size,frameConditions:frames,error,
    scope:'Real 12 second camera orbit with frozen articulated vehicle and one display identity. Canvas stream records at a requested 30 Hz; actual condition frame timestamps are retained. A video is not full transparent-layer, LOD or performance acceptance.'};
  const files=[{name:'orbit.json',data:JSON.stringify(report,null,2)}];if(video.size)files.unshift({name:'orbit.webm',data:video});
  try{return{report,blob:await archiveWriter(files),name:`${captureId}-orbit-${status}.zip`};}
  catch(cause){report.captureStatusBeforeArchiveFailure=report.status;report.status='failed';report.archiveError={step:'archive-encoding',message:String(cause?.message||cause),videoExported:false};return{report,blob:new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),name:`${captureId}-orbit-archive-failed.json`};}
}
