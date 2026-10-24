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
