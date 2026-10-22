import {getLanguage,onLanguageChange} from './i18n.js';
import {encodeJsonChunks} from './export-encoder.js';
export {encodeJsonChunks} from './export-encoder.js';

// Preparation is application work. A successful anchor click is only a handoff
// to the browser; the application cannot observe a completed disk download.
const managers=new WeakMap();
const now=()=>globalThis.performance?.now?.()??Date.now();
const cancelled=()=>Object.assign(new Error('Export cancelled'),{name:'AbortError'});
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
const abortReason=signal=>signal?.reason?.name?signal.reason:cancelled();
const check=signal=>{if(signal?.aborted)throw abortReason(signal);};
export const EXPORT_PREPARATION_DEADLINE_MS=30000;
function waitForPreparation(value,signal){
  check(signal);
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(abortReason(signal));};
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(value).then(result=>{signal.removeEventListener('abort',abort);signal.aborted?reject(abortReason(signal)):resolve(result);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}


// Structured clone does not preserve custom prototypes, accessors or toJSON.
// Detect those without invoking getters, then use the exact JSON encoder on
// the original values. Normal saved project archives are plain data.
async function workerCompatible(value,signal){
  const stack=[value],seen=new Set();let visited=0,lastYield=now();
  while(stack.length){
    check(signal);
    const item=stack.pop();if(item===null||typeof item!=='object')continue;
    if(seen.has(item))continue;seen.add(item);
    const proto=Object.getPrototypeOf(item);
    if(!Array.isArray(item)&&proto!==null&&proto!==Object.prototype)return false;
    if('toJSON' in item)return false;
    for(const key of Object.keys(item)){
      const descriptor=Object.getOwnPropertyDescriptor(item,key);
      if(!descriptor||!Object.hasOwn(descriptor,'value'))return false;
      if(descriptor.value&&typeof descriptor.value==='object')stack.push(descriptor.value);
      else if(typeof descriptor.value==='function'||typeof descriptor.value==='symbol')return false;
      if((++visited&2047)===0&&now()-lastYield>7){await turn();check(signal);lastYield=now();}
    }
  }
  return true;
}

// A dedicated worker prevents every small serialization slice from waiting
// behind another expensive WebGL frame. postMessage still has a measured
// structured-clone cost; no claim of zero-cost or completed disk saving is made.
async function prepareJson(value,{doc,signal,onProgress,onPhase=()=>{}}){
  const WorkerType=doc.defaultView?.Worker??globalThis.Worker;
  const scanStart=now();onPhase('compatibility-scan');
  const compatible=WorkerType?await workerCompatible(value,signal):false,compatibilityScanMs=now()-scanStart;
  check(signal);onPhase(compatible?'worker-start':'cooperative-encode');
  if(!compatible)return{...await encodeJsonChunks(value,{signal,onProgress}),serializer:'cooperative-main-thread',workerSerializeMs:null,postMessageMs:0,compatibilityScanMs};
  let worker;
  try{worker=new WorkerType(new URL('./export-worker.js',import.meta.url),{type:'module',name:'roadster-export'});}
  catch(error){error.message='Export worker could not start: '+error.message;throw error;}
  return new Promise((resolve,reject)=>{
    let settled=false,postMessageMs=0;
    const finish=(error,result)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve({...result,serializer:'worker',postMessageMs,compatibilityScanMs});};
    const abort=()=>finish(abortReason(signal));signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>{if(settled)return;const message=event.data;if(message.type==='progress')onProgress(message.progress);else if(message.type==='complete'){onPhase('worker-complete');finish(null,message.result);}else if(message.type==='failed')finish(new Error(message.error));};
    worker.onerror=event=>{event.preventDefault?.();finish(new Error('Export worker failed: '+(event.message||'unknown error')));};
    try{check(signal);const sent=now();worker.postMessage({value});postMessageMs=now()-sent;onPhase('worker-wait');}
    catch(error){
      // Project archives are plain structured-cloneable records. Preserve the
      // public encoder's JSON semantics for unusual caller values with toJSON.
      if(error.name==='DataCloneError'){
        settled=true;signal.removeEventListener('abort',abort);worker.terminate();
        onPhase('cooperative-encode');encodeJsonChunks(value,{signal,onProgress}).then(result=>resolve({...result,serializer:'cooperative-main-thread',workerSerializeMs:null,postMessageMs:0,compatibilityScanMs}),reject);
      }else finish(error);
    }
  });
}

function manager(doc){
  if(managers.has(doc))return managers.get(doc);
  const node=doc.createElement('aside');node.className='export-job-card';node.hidden=true;node.setAttribute('data-no-i18n','');node.setAttribute('aria-label','Export progress');
  node.innerHTML='<header><strong data-export="title"></strong><button type="button" data-export="close" aria-label="Close export status">×</button></header><p data-export="status" role="status" aria-live="polite"></p><small data-export="detail"></small><div><button type="button" data-export="cancel"></button><button type="button" data-export="retry" hidden></button></div>';
  doc.body.append(node);const $=name=>node.querySelector('[data-export="'+name+'"]');
  const state={status:'idle',filename:null,elapsedMs:0,snapshotMs:0,serializeMs:0,blobMs:0,bytes:0,visited:0,characters:0,error:null,browserCompletion:'unobservable',serializer:null,workerSerializeMs:null,postMessageMs:0,compatibilityScanMs:0,queueWaitMs:0,phase:null,deadlineMs:EXPORT_PREPARATION_DEADLINE_MS,events:[]};
  let controller=null,blob=null,url=null,started=0,finishTime=0,serial=0;
  const L=(zh,en)=>getLanguage()==='en'?en:zh;
  function note(phase){state.phase=phase;state.events.push({phase,atMs:Math.max(0,now()-started)});if(state.events.length>32)state.events.shift();}
  function paint(){
    const labels={snapshot:L('正在冻结导出内容','Capturing export contents'),serialize:L('正在整理数据，可取消','Preparing data; cancellation available'),blob:L('正在生成文件','Creating file'),'handed-off':L('已交给浏览器','Handed to browser'),failed:L('导出未完成','Export failed'),cancelled:L('已取消导出','Export cancelled')};
    state.elapsedMs=Math.max(0,(finishTime||now())-started);node.dataset.exportStatus=state.status;
    $('title').textContent=L('文件导出','File export');$('status').textContent=labels[state.status]||'';
    $('detail').textContent=(state.filename||'')+' · '+(state.bytes?(state.bytes/1048576).toFixed(2)+' MiB':state.visited?state.visited.toLocaleString()+' '+L('项已整理','items prepared'):'')+' · '+(state.elapsedMs/1000).toFixed(2)+' s'+(state.error?'\n'+state.error:state.status==='handed-off'?'\n'+L('浏览器负责后续保存；此处不能确认磁盘下载完成。','The browser handles saving; disk completion cannot be verified here.'):'');
    $('cancel').textContent=L('取消','Cancel');$('cancel').hidden=!['snapshot','serialize','blob'].includes(state.status);
    $('retry').textContent=L('重新交给浏览器','Hand to browser again');$('retry').hidden=!(blob&&['handed-off','failed'].includes(state.status));
    node.dataset.exportReceipt=JSON.stringify(state);
  }
  function handoff(){
    if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
    const anchor=doc.createElement('a');anchor.href=url;anchor.download=state.filename;anchor.hidden=true;doc.body.append(anchor);
    try{note('browser-click');anchor.click();note('browser-handoff');state.status='handed-off';state.error=null;}finally{anchor.remove();}
    finishTime=now();paint();
  }
  $('cancel').addEventListener('click',()=>controller?.abort());
  $('close').addEventListener('click',()=>{controller?.abort();node.hidden=true;if(url){URL.revokeObjectURL(url);url=null;}blob=null;});
  $('retry').addEventListener('click',()=>{try{handoff();}catch(error){state.status='failed';state.error=String(error.message);paint();}});
  const api={node,getState:()=>({...state,events:state.events.map(event=>({...event}))}),cancel:()=>controller?.abort(),async run(getValue,filename,{json=true,type='application/json',deadlineMs=EXPORT_PREPARATION_DEADLINE_MS}={}){
    controller?.abort();const id=++serial;controller=new AbortController();const signal=controller.signal;
    if(url){URL.revokeObjectURL(url);url=null;}blob=null;started=now();finishTime=0;
    Object.assign(state,{status:'snapshot',filename,elapsedMs:0,snapshotMs:0,serializeMs:0,blobMs:0,bytes:0,visited:0,characters:0,error:null,serializer:null,workerSerializeMs:null,postMessageMs:0,compatibilityScanMs:0,queueWaitMs:0,phase:'queued',events:[],deadlineMs});node.hidden=false;note('queued');paint();
    const timeout=()=>Object.assign(new Error('Export preparation exceeded '+deadlineMs+' ms at '+state.phase+'; no completed disk download is claimed.'),{name:'TimeoutError'});
    const ownController=controller,deadline=setTimeout(()=>ownController.abort(timeout()),deadlineMs);
    const checkDeadline=()=>{if(now()-started>deadlineMs&&!signal.aborted)ownController.abort(timeout());check(signal);};
    try{
      await turn();checkDeadline();state.queueWaitMs=now()-started;note('snapshot');const snapshotStart=now();const value=await waitForPreparation(typeof getValue==='function'?getValue():getValue,signal);checkDeadline();state.snapshotMs=now()-snapshotStart;
      state.status='serialize';paint();check(signal);const encodeStart=now();let progressPaint=0;
      const data=json?await prepareJson(value,{doc,signal,onPhase:note,onProgress:p=>{check(signal);Object.assign(state,p);if(now()-progressPaint>160){paint();progressPaint=now();}}}):{parts:[value],serializer:'raw-bytes',workerSerializeMs:null,postMessageMs:0};
      checkDeadline();state.serializeMs=now()-encodeStart;Object.assign(state,{compatibilityScanMs:data.compatibilityScanMs??0,serializer:data.serializer,workerSerializeMs:data.workerSerializeMs,postMessageMs:data.postMessageMs,visited:data.visited??state.visited,characters:data.characters??state.characters});state.status='blob';note('blob');paint();
      const blobStart=now();blob=data.blob??(value instanceof Blob&&!json?value:new Blob(data.parts,{type}));state.blobMs=now()-blobStart;state.bytes=blob.size;checkDeadline();handoff();
    }catch(error){if(id!==serial)return{status:'cancelled',filename};finishTime=now();state.status=error.name==='AbortError'?'cancelled':'failed';state.error=error.name==='AbortError'?null:String(error.message||error);note(error.name==='TimeoutError'?'deadline':state.status);paint();}finally{clearTimeout(deadline);}
    return{...state,events:state.events.map(event=>({...event}))};
  }};
  // Refresh existing progress text only; language changes must not re-export.
  onLanguageChange(paint);
  managers.set(doc,api);return api;
}

export function exportJson(getValue,filename,{doc=document,deadlineMs=EXPORT_PREPARATION_DEADLINE_MS}={}){return manager(doc).run(getValue,filename,{deadlineMs});}
export function exportFile(getValue,filename,type,{doc=document,deadlineMs=EXPORT_PREPARATION_DEADLINE_MS}={}){return manager(doc).run(getValue,filename,{json:false,type,deadlineMs});}
export function getExportState(doc=document){return managers.get(doc)?.getState()??{status:'idle'};}
export function cancelExport(doc=document){managers.get(doc)?.cancel();}
