import {executeLandingTask,reexecuteLandingTask,compareLandingAlgorithms} from './landing-challenge.js';
const jobs=new Map();
self.onmessage=async({data})=>{
  if(data?.action==='cancel'){if(typeof data.id==='string'&&data.id.length<=128&&Object.keys(data).every(key=>['id','action'].includes(key)))jobs.get(data.id)?.abort();return;}
  if(!data||typeof data.id!=='string'||!['run','rerun','compare'].includes(data.action))return;
  if(data.id.length>128||Object.keys(data).some(key=>!['id','action','task','algorithm','source'].includes(key))){self.postMessage({id:data.id,type:'rejected',error:'Invalid bounded task request'});return;}
  if(jobs.size){self.postMessage({id:data.id,type:'rejected',error:'Worker already owns one task; concurrent or duplicate requests are refused'});return;}
  const controller=new AbortController();jobs.set(data.id,controller);
  try{const options={signal:controller.signal,yieldEvery:120,onProgress:progress=>self.postMessage({id:data.id,type:'progress',progress:{step:progress.step,timeS:progress.timeS,phase:progress.phase}})};
    const result=data.action==='compare'?await compareLandingAlgorithms(data.source,data.algorithm,options):data.action==='rerun'?await reexecuteLandingTask(data.source,{...options,algorithm:data.algorithm}):await executeLandingTask({...options,task:data.task,algorithm:data.algorithm});self.postMessage({id:data.id,type:'result',result});
  }catch(error){self.postMessage({id:data.id,type:'error',error:String(error.message)});}finally{jobs.delete(data.id);}
};
