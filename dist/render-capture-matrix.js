// Every terminal outcome retains the completed prefix. This orchestrates
// captures; it cannot manufacture an image, a driver result or a visual pass.
export const CITY_PROGRAM_MATRIX=Object.freeze([
  ['high','clear-day'],['high','wet-night'],['ultra','wet-night'],['ultra','clear-day'],['balanced','wet-night'],['high','wet-night'],['ultra','wet-night']
].flatMap(([quality,weather],index)=>['viaduct','vehicle'].map(vantage=>Object.freeze({quality,weather,vantage,label:String(index+1).padStart(2,'0')+'-'+quality+'-'+weather+'-'+vantage}))));

export function captureCancelled(){const error=new Error('Capture cancelled by user');error.name='AbortError';return error;}
export async function collectProgramMatrix({captureCase,signal,onProgress=()=>{},metadata={},cases=CITY_PROGRAM_MATRIX}){
  const frames=[],files=[],startedAt=new Date().toISOString();let executionStatus='completed',failure=null;
  try{
    for(const item of cases){
      if(signal?.aborted)throw captureCancelled();
      onProgress({completed:frames.length,total:cases.length,label:item.label,phase:'capturing'});
      const {ordinary,exported}=await captureCase(item);
      if(!exported?.blob||!exported.conditions||!ordinary?.report||!exported.report)throw Error('Incomplete actual frame result');
      frames.push({case:item.label,paused:ordinary.report,export:exported.report,conditionsFile:item.label+'.json',imageFile:item.label+'.png'});
      files.push({name:item.label+'.json',data:JSON.stringify(exported.conditions,null,2)},{name:item.label+'.png',data:exported.blob});
      onProgress({completed:frames.length,total:cases.length,label:item.label,phase:'captured'});
    }
  }catch(error){executionStatus=error.name==='AbortError'?'cancelled':'failed';failure={name:String(error.name||'Error'),message:String(error.message||error),completedFrames:frames.length,nextCase:cases[frames.length]?.label??null,partialAudit:error.partialAudit??null,partialAuditSource:error.partialAuditSource??null,captureProgress:error.captureProgress??null,captureAudit:error.captureAudit??null};}
  const drawStatus=frames.some(f=>f.paused.status!=='passed'||f.export.status!=='passed')?'failed':frames.length===cases.length?'passed':'incomplete';
  const report={schema:'roadster.gpu-switch-matrix-2',...metadata,startedAt,finishedAt:new Date().toISOString(),status:executionStatus==='completed'?drawStatus:executionStatus,executionStatus,drawStatus,expectedFrames:cases.length,completedFrames:frames.length,cases:frames,failure,scope:'Original actual rendered frames plus per-draw program/framebuffer evidence. Completed collection is separate from a clean draw verdict. Cancel/failure exports only the captured prefix and explicitly lists missing frames. No pixel-quality or performance verdict.'};
  return {report,files};
}

export function matrixArchiveFiles(result){
  return [{name:'gpu-switch-matrix.json',data:JSON.stringify(result.report,null,2)},...result.files,{name:'READ-ME.txt',data:'Original device frames, with no generated or resized substitutes. Read executionStatus, drawStatus, expectedFrames and completedFrames separately. Each PNG is bound to its conditions and named program/framebuffer evidence. A failed/cancelled archive is intentionally partial. Diagnostics are excluded from route timing.\n'}];
}
