import {RoadsterSim} from './physics.js';
import {executeExperiment,compareControllers} from './experiment-records.js';
let active=null;
self.onmessage=async({data})=>{
  if(data?.action==='cancel'){if(active&&(!data.id||data.id===active.id))active.controller.abort();return;}
  if(active){self.postMessage({id:data?.id,type:'error',error:'数值执行器正在运行'});return;}
  const job={id:data?.id,controller:new AbortController()};active=job;
  try{
    const options={createSim:snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType}),signal:job.controller.signal,onProgress:progress=>self.postMessage({id:job.id,type:'progress',progress})};
    const result=data?.action==='compare'?await compareControllers(data.record,{...options,controllerA:data.controllerA,controllerB:data.controllerB}):await executeExperiment(data.record,{...options,recompute:data?.recompute===true});
    self.postMessage({id:job.id,type:'result',result});
  }catch(error){self.postMessage({id:job.id,type:'error',error:error.message});}
  finally{if(active===job)active=null;}
};
