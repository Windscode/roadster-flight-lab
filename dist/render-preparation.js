/** Serialize async preparation, including changes received while it is running.
 * The caller keeps simulation/render frames frozen; no solver state is touched.
 * Failures are consumed once and surfaced, never retried every animation frame. */
export function createRenderPreparation(prepare,{onBusy=()=>{},onComplete=()=>{}}={}){
  let revision=1,completed=0,pending=null;
  const stats={runs:0,lastDurationMs:0,totalDurationMs:0,lastError:null};
  return {stats,get needed(){return revision!==completed;},get busy(){return !!pending;},
    invalidate(){revision++;},
    run(){
      if(pending)return pending;
      if(revision===completed)return Promise.resolve();
      const began=performance.now();onBusy(true);
      pending=Promise.resolve().then(async()=>{
        while(completed!==revision){const target=revision;await prepare();completed=target;stats.runs++;}
        stats.lastError=null;
      }).catch(error=>{completed=revision;stats.lastError=String(error.message);throw error;}).finally(()=>{
        stats.lastDurationMs=performance.now()-began;stats.totalDurationMs+=stats.lastDurationMs;
        pending=null;onBusy(false);onComplete({...stats});
      });
      return pending;
    }
  };
}

/** The vendored renderer's compileAsync tracks one current program per material.
 * Shared materials can compile several variants (plain/instanced/color), so its
 * promise alone does not cover every submitted program. Drain the whole known
 * program set before resuming driving. No forced GPU finish or visual downgrade.
 * isReady is the same nonblocking KHR check used by this pinned Three renderer. */
export async function compileScenePrograms(renderer,scene,camera,{yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,10)),timeoutMs=60000,now=()=>performance.now()}={}){
  const began=now();
  // Initiate through compile(), then own the bounded readiness polling. This
  // avoids compileAsync's uncancellable, last-program-per-material poller.
  renderer.compile(scene,camera);
  const programs=[...(renderer.info?.programs||[])].filter(program=>typeof program.isReady==='function');
  let pending=programs;
  while(pending.length){
    if(renderer.getContext?.()?.isContextLost?.())throw Error('图形上下文已丢失，请刷新后重试。');
    pending=pending.filter(program=>!program.isReady());
    if(pending.length){if(now()-began>=timeoutMs)throw Error('材质准备超时，请刷新后尝试较低画质；本地实验记录仍保留。');await yieldFrame();}
  }
  return {programs:programs.length};
}

// Expiry fails closed: never compile a scene whose pending loaders can still
// rebind its materials. The application shell keeps records/research available.
export async function awaitSceneReady(ready,{timeoutMs=60000}={}){
  let timer;
  try{return await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('街景资源载入超时，请检查网络后刷新；本地实验记录仍保留。')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}
