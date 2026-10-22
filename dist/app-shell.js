import {createResearchConsole} from './research-console.js';
import {MODEL_VERSION} from './vehicle-models.js';
import {loadRuntimeIdentity} from './runtime-identity.js';

// This shell is created before graphics modules are imported. The numerical
// research panel and local records do not depend on a WebGL context.
export function createApplicationShell({initialSim}) {
  void loadRuntimeIdentity();
  const $=id=>document.getElementById(id);
  let live=null,study=null,studyPromise=null,studyOpen=false,studyGeneration=0,toastTimer;
  const graphics={status:'initializing',reason:'',startedAt:performance.now(),readyAfterMs:null};
  const getSim=()=>live?.getSim?.()||initialSim;
  const getContext=()=>live?.getContext?.()||(initialSim.worldType==='windlab'?'lab':'city');
  const available=()=>graphics.status==='available';
  const toast=(message,duration=5500)=>{
    if(live?.toast)return live.toast(message,duration);
    const node=$('toast');node.textContent=message;node.classList.remove('hidden');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.add('hidden'),duration);
  };
  const research=createResearchConsole({mount:$('research-console-root'),getSim,getContext,getSceneConfiguration:()=>live?.getSceneConfiguration?.()||{version:1,context:getContext()},
    getLiveAvailable:()=>available()&&live?.canUseLiveResearch?.()!==false,
    onEnterLab:()=>live?.switchContext?.('lab'),onReturnCity:()=>live?.switchContext?.('city'),
    onOpenStudy:()=>openStudy(),onEvent:(type,detail)=>live?.logEvent?.(type,detail),onToast:toast,
    onBeforeRun:program=>live?.beforeResearchRun?.(program),
    onStart:()=>live?.onStart?.(),onCancel:reason=>live?.onCancel?.(reason),
    onRestoreExperiment:request=>{
      if(!available()||!live?.restoreExperiment)throw new Error('三维操作当前不可用；仍可查看记录或运行数值研究。');
      return live.restoreExperiment(request);
    },
  });
  research.setLiveAvailable?.(false,'三维视景正在初始化；历史记录和标准数值研究仍可使用。');

  function finishStudy(){
    if(!studyOpen)return;
    studyOpen=false;studyGeneration++;
    $('research-study-root').classList.add('hidden');document.body.classList.remove('study-open');
    live?.afterStudy?.();
  }
  function closeStudy(){
    if(study?.getState().open)study.close();
    finishStudy();
  }
  async function openStudy(){
    if(live?.canUseLiveResearch?.()===false){toast('请先返回原现场，再打开数值研究。');return;}
    if(studyOpen)return;
    research.cancel?.('开始标准数值研究');research.close();
    live?.beforeStudy?.();studyOpen=true;const generation=++studyGeneration;
    document.body.classList.add('study-open');
    const mount=$('research-study-root');mount.classList.remove('hidden');
    try{
      if(!studyPromise)studyPromise=import('./research-lab.js').then(module=>module.createResearchStudyPanel({mount,getSim,onEvent:(type,data)=>live?.logEvent?.(type,data),onClose:finishStudy})).catch(error=>{studyPromise=null;throw error;});
      study=await studyPromise;
      if(studyOpen&&generation===studyGeneration){study.open();study.root.querySelector('button')?.focus({preventScroll:true});}
    }catch(error){finishStudy();toast('数值研究面板未能载入：'+error.message,8500);}
  }
  function openResearch(tab=research.getState().tab||'experiments'){
    if(live?.canUseLiveResearch?.()===false){toast('请先返回原现场；当前练习与复盘在浮卡中继续。');return;}
    closeStudy();live?.beforeResearch?.();research.open(tab);
  }
  function attachLive(adapter){live=adapter;}
  function graphicsReady(){
    graphics.status='available';graphics.reason='';graphics.readyAfterMs=performance.now()-graphics.startedAt;
    document.body.classList.remove('graphics-unavailable');$('graphics-status').classList.add('hidden');
    $('error-screen').classList.add('hidden');research.setLiveAvailable?.(true,'');
  }
  function graphicsUnavailable(reason,{contextLost=false}={}){
    // Keep one shell and the same local history even if initialization never
    // reached the render loop, or the context is lost during a live experiment.
    graphics.status=contextLost?'context_lost':'unavailable';graphics.reason=String(reason||'当前会话未提供可用的 WebGL 2 图形上下文。');
    live?.suspendGraphics?.();
    research.recordEvent?.(contextLost?'graphics_context_lost':'graphics_unavailable',{reason:graphics.reason});
    research.stopRecording?.(contextLost?'图形上下文丢失':'三维初始化未完成','failed');research.cancel?.('三维操作已暂停','failed');
    research.setLiveAvailable?.(false,'三维视景不可用：现场驾驶、录制和三维重放已暂停。记录查看、导出和数值研究仍可用。');
    $('loading-screen').style.display='none';$('error-screen').classList.add('hidden');
    $('game-menu').classList.add('hidden');document.body.classList.remove('body-menu','body-running');document.body.classList.add('graphics-unavailable');
    $('graphics-status').classList.remove('hidden');$('graphics-status-title').textContent=contextLost?'三维视景已暂停，研究仍可继续':'当前图形环境不可用，研究仍可继续';
    $('graphics-status-detail').textContent=graphics.reason;
    $('sim-state').textContent='数值研究可用 / 三维已停用';
    $('render-stat-chip').textContent='三维未运行 · 无帧率数据';$('performance-label').textContent='三维未运行 · 无帧率数据';
    for(const id of ['perf-fps','perf-p95','perf-p99','perf-long-frames','perf-gpu','perf-physics','perf-draws','perf-resolution'])if($(id))$(id).textContent='无帧率数据';
    if($('performance-status'))$('performance-status').textContent='三维未运行；数值求解时间不作为图形帧率。';
    if($('perf-breakdown'))$('perf-breakdown').textContent='';
    if($('vertical-response-status'))$('vertical-response-status').textContent='三维操作暂停；可在数值研究中使用升降速度参数。';
    for(const element of document.querySelectorAll('[data-requires-graphics]'))element.disabled=true;
    if(new URLSearchParams(location.search).get('view')==='lab'&&!studyOpen)void openStudy();
  }
  $('graphics-open-study').addEventListener('click',()=>void openStudy());
  $('graphics-open-records').addEventListener('click',()=>openResearch('experiments'));
  $('graphics-reload').addEventListener('click',()=>location.reload());
  document.addEventListener('keydown',event=>{
    if(available()||event.code!=='Escape')return;
    if(studyOpen){event.preventDefault();closeStudy();}
    else if(research.getState().open){event.preventDefault();research.close();}
  });
  const api={research,getSim,getContext,attachLive,graphicsReady,graphicsUnavailable,openStudy,closeStudy,openResearch,
    get studyOpen(){return studyOpen;},get graphics(){return {...graphics};},
    getState:()=>({version:MODEL_VERSION,graphics:{...graphics},context:getContext(),studyOpen,research:research.getState()}),
  };
  window.roadsterApp={getState:api.getState,openStudy,openRecords:()=>openResearch('experiments'),graphicsUnavailable};
  window.roadsterApplicationReady=true;
  return api;
}
