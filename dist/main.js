import {exportJson,exportFile,getExportState} from './export-download.js';
import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { SMAAPass } from './vendor/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from './vendor/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from './stable-fxaa-shader.js';
import { ContactAOPass } from './contact-ao-pass.js';
import { RENDER_PROFILES, ResolutionGovernor, sizeRenderPipeline } from './render-profiles.js';
import { PerformanceMeter } from './performance-meter.js';
import { ColdGasExhaust } from './exhaust.js';
import { RoadsterSim, DEFAULT_PARAMS } from './physics.js';
import { MODEL_VERSION } from './vehicle-models.js';
import { createRoadster,VEHICLE_DRIVER_VIEW } from './vehicle.js';
import { createEnvironment } from './city-environment.js';
import {CITY,CITY_BUILDINGS,CITY_ROUTES,CITY_LOCATIONS,districtAt} from './city-data.js';
import {driverAxes} from './controls.js';
import {ACTIONS,sharedInputs} from './semantic-input.js';
import {resolveVehicleLampMode} from './vehicle-light-state.js';
import {InputSession} from './input-session.js';
import {createOperationHud} from './operation-hud.js';
import {advanceChasePosition,resolveCameraObstruction} from './chase-camera.js';
import {getRuntimeIdentity,loadRuntimeIdentity} from './runtime-identity.js';
import {SUN_DIRECTION} from './irradiance-math.js';
import {createVehicleAudio} from './audio.js';
import {createCarRadio} from './car-radio.js';
import {createResearchWorkbench} from './research-workbench.js';
import {createCityMap} from './city-map.js';
import {createCityFlightUI} from './city-flight-ui.js';
import {createRouteExperience} from './route-experience.js';
import {createRouteSurfacePreset} from './route-surface.js';
import {DriverHeadFeedback} from './driver-feedback.js';
import {CITY_STREETS} from './city-plan.js';
import {CITY_REVIEW_CAMERAS,CITY_REVIEW_ROUTE} from './city-review.js';
const CITY_CAPTURE_CAMERAS=[...CITY_BENCHMARK_ROUTE.cameras,...CITY_REVIEW_CAMERAS];
import {createWindLaboratory} from './wind-laboratory.js';
import {WIND_LAB_GEOMETRY} from './wind-lab-data.js';
import {MODEL_BUILD_ID} from './model-build.js';
import {CITY_BENCHMARK_ROUTE,CITY_WEATHER_PRESETS,CITY_VISUAL_CAPTURE_PROTOCOL} from './visual-presets.js';
import {t as tr,onLanguageChange,getLanguage,registerTranslations} from './i18n.js';
import {ControlCaptureProtocol,CONTROL_CAPTURE_PROTOCOLS,CONTROL_CAPTURE_STARTS} from './driving-capture.js';
import {VERTICAL_RESPONSE,saveVerticalResponse,CONTROL_RESPONSES,saveControlResponse} from './ui-preferences.js';
import {captureArchive} from './capture-archive.js';
import {collectProgramMatrix,matrixArchiveFiles,captureCancelled} from './render-capture-matrix.js';
import './i18n-release-314-en.js';
import './i18n-release-315-en.js';
import './i18n-release-316-en.js';
import './i18n-release-317-en.js';
import './i18n-release-318-en.js';
import './i18n-release-319-en.js';
import './i18n-capture-en.js';
import './i18n-controls-311-en.js';
import './i18n-render-313-en.js';
import {createRenderProgramDiagnostics} from './render-program-diagnostics.js';
import {entries as visual311Entries} from './i18n-visual-311-en.js';
registerTranslations(visual311Entries);

const $=id=>document.getElementById(id);
const $$=selector=>[...document.querySelectorAll(selector)];
const clamp=THREE.MathUtils.clamp;
const format=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—';
const vec=v=>new THREE.Vector3(v.x,v.y,v.z);
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function boot(shell){
  void loadRuntimeIdentity();
  const viewport=$('viewport');
  let quality='balanced';try{const saved=localStorage.getItem('roadster-quality')||localStorage.getItem('roadster-quality-3.5');if(RENDER_PROFILES[saved])quality=saved;}catch{}
  let renderProfile=RENDER_PROFILES[quality],renderSize={width:1,height:1,pixelRatio:1};
  const governor=new ResolutionGovernor(quality);
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.90;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.info.autoReset=false;
  renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);viewport.appendChild(renderer.domElement);
  const meter=new PerformanceMeter(renderer);
  let scene=new THREE.Scene();scene.background=new THREE.Color(0xa4b2aa);
  const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.07,2300);
  const renderPrograms=createRenderProgramDiagnostics(renderer,{primaryCamera:camera});
  let sim=shell.getSim();let t=sim.telemetry();
  let car=createRoadster({quality});car.group.userData.renderAuditGroup='vehicle';scene.add(car.group);
  let environment=createEnvironment(scene,renderer,sim.getWorldGeometry(),camera);environment.setVehicleRoot?.(car.group);let waypoint=null;const cityMap=createCityMap(node=>{waypoint=node;});
  let exhaust=new ColdGasExhaust(scene,sim);
  let activeContext='city',researchConsole=shell.research,studyWasRunning=false,controlCapture=null,cityFlight=null,routeExperience=null;
  let learningSessionMode='live',learningSaved=null,learningPrepared=false,learningSeekSerial=0;
  const headFeedback=new DriverHeadFeedback();
  const contexts={city:{scene,sim,car,environment,exhaust,scenario:'city',cameraState:null},lab:null};
  document.body.dataset.context=activeContext;
  // Controls operate on an unobstructed proxy camera. Pulling the rendered
  // camera inside minDistance must not be mistaken for a user zoom.
  const orbitCamera=camera.clone();
  const controls=new OrbitControls(orbitCamera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.enablePan=false;controls.minDistance=3.6;controls.maxDistance=85;controls.maxPolarAngle=Math.PI*.489;controls.minPolarAngle=.05;controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
  const composer=new EffectComposer(renderer);
  function timedPass(pass,label){const render=pass.render.bind(pass);pass.render=(...args)=>renderPrograms.withPass(label,()=>meter.current?meter.measure(label,()=>render(...args)):render(...args));return pass;}
  function createContactAO(samples=12){
    const pass=timedPass(new ContactAOPass(scene,camera,1,1,samples),'contactAO');
    pass.kernelRadius=.35;pass.minDistance=.015/(camera.far-camera.near);pass.maxDistance=.65/(camera.far-camera.near);return pass;
  }
  let ssao=createContactAO(),aoSamples=12;
  const beauty=timedPass(new RenderPass(scene,camera),'sceneAndShadows');
  const bloom=timedPass(new UnrealBloomPass(new THREE.Vector2(1,1),.13,.42,1.35),'bloom');
  const smaa=timedPass(new SMAAPass(),'antialias');
  const fxaa=timedPass(new ShaderPass(FXAAShader),'antialias');
  const output=timedPass(new OutputPass(),'toneMapping');
  exhaust.mesh.userData.skipContactAO=true;
  let exposureTarget=.90,lastExposureSample=0;
  let graphicsStopped=false,paused=true,started=false,scenario='city',cameraMode='orbit',showForces=false,showTrail=false,day=true,cutaway=false,activeDrawer=null,scale=1;
  let showHud=true,samples=[],weatherPreset='clear-day',fixedCameraId=null,activeBenchmarkRoute=null,captureImageRequested=false,captureBundleRequested=false,exposureLock=null;
  let toastTimer=0,uiTimer=0,frames=0,fpsTime=0,displayFps=60,lastTime=performance.now(),lastPosition=new THREE.Vector3(),pendingManeuver=null;
  let pendingProgramCapture=null,programMatrixBusy=false,previousFrameWasDiagnostic=false,matrixAbort=null,lastMatrixArchive=null,matrixPackaging=false,lastMatrixResult=null;
  let wantedCamera=null,cameraObstruction=null,cameraSolveMode=null;
  let clearanceEstimate=null,clearanceSampleAt=-Infinity;
  let lampSelection='auto';
  const resourceHistory=[];let nextResourceSample=0;
  const keys=new Set();
  let lastActionResetSequence=0;
  const inputSession=new InputSession({keys,onEvent:event=>{if(event.type==='input-release'&&['scenario-reset','context-switch'].includes(event.reason))lastActionResetSequence=event.sequence;logEvent('pilot_input_event',event);},onRelease:reason=>{if(programMatrixBusy)return;if(!protectedLearningState())sim.releasePilotInput?.(reason);reverseHold=0;}});
  const operationStack=document.createElement('div');operationStack.className='operation-stack';$('app').append(operationStack);
  const operationHud=createOperationHud({mount:operationStack,getSim:()=>sim,getContext:()=>activeContext,getOwner:()=>researchConsole?.getState().running?'研究流程 / Research program':'',getLastAction:()=>inputSession.lastActionReceipt?.sequence>lastActionResetSequence?inputSession.lastActionReceipt:null,onTogglePaused:()=>{if(graphicsStopped||programMatrixBusy)return;if(paused&&(!started||!$('launch-card').classList.contains('hidden')))start();else setPaused(!paused);operationHud.update(sim.telemetry(),{paused});viewport.focus({preventScroll:true});},exportInputs:()=>exportJson(()=>inputSession.export(getRuntimeIdentity(),{clone:false}),'roadster-input-timeline.json')});
  cityFlight=createCityFlightUI({mount:document.querySelector('#map-drawer .drawer-content'),hudMount:operationStack,scene:contexts.city.scene,getSim:()=>sim,getContext:()=>activeContext,storage:localStorage,
    getSceneConfiguration:sceneConfiguration,getSessionMode:()=>learningSessionMode,
    onReview:async request=>{retainLearningLive();const serial=++learningSeekSerial;learningSessionMode='review';setPaused(true,{releaseInput:false});try{const state=await request.review.seekStep(request.step);if(serial!==learningSeekSerial||state?.cancelled)return{...state,cancelled:true};activateLearningSim(request.review.sim,'review',request.record.liveExperiment.initialSnapshot.sceneConfiguration);closePanels();return request.review.state;}catch(error){if(serial===learningSeekSerial)returnLearningLive();throw error;}},
    onPractice:request=>{retainLearningLive();learningSeekSerial++;activateLearningSim(request.sim,'practice',request.sceneConfiguration);learningPrepared=true;closePanels();},
    onReturn:returnLearningLive,
    onNavigate:id=>cityMap.setDestination(id,sim.telemetry()),
    onBeforeStart:()=>{routeExperience?.cancel('city-challenge-start');controlCapture?.cancel('开始城市挑战，采集已结束。','City challenge started; capture ended.');researchConsole?.cancel('开始城市挑战');researchConsole?.stopRecording?.('开始城市挑战','cancelled');inputSession.release('city-challenge-start');},
    onStart:()=>{learningPrepared=false;closePanels();ensureRunning();viewport.focus({preventScroll:true});operationHud.invalidate();},
    onFinish:()=>operationHud.invalidate(),notify:message=>toast(message,6500)});
  let sound=null;let radio=null;createCarRadio(toast).then(r=>radio=r).catch(e=>$('radio-status').textContent='音乐资源未就绪：'+e.message);createResearchWorkbench(()=>sim,logEvent);let menuOpen=true,reverseHold=0;document.body.classList.add('body-menu');
  routeExperience=createRouteExperience({mount:document.querySelector('#map-drawer .drawer-content'),hudMount:operationStack,getSim:()=>sim,getContext:()=>activeContext,getPaused:()=>paused,
    onPrepare:prepareSurfaceRoute,onStart:descriptor=>{if(!paused||learningSessionMode!=='live')throw Error(getLanguage()==='en'?'Start from the paused route preparation.':'请从暂停的路线准备状态开始。');const state=researchConsole.startRecording({name:(getLanguage()==='en'?descriptor.labelEn:descriptor.label)+' / 302.5 m'});logEvent('surface_route_start',{surface:sim.getRouteSurface(),scene:sceneConfiguration()});closePanels();ensureRunning();return state;},
    onFinish:reason=>{const result=researchConsole.stopRecording(reason,reason==='route-completed'?'completed':'cancelled');return result;},
    onInspect:id=>{if(id)researchConsole.selectExperimentRecord?.(id);openResearch('experiments');},onOpen:()=>openPanel('map'),recordEvent:logEvent,notify:toast,
    getRecording:()=>researchConsole?.getExperimentState?.(),getSessionMode:()=>learningSessionMode,
    onSound:enabled=>setSoundEnabled(enabled),onHead:enabled=>{headFeedback.setEnabled(enabled);$('head-feedback').checked=enabled;}});
  const scenarioText={
    windlab:{title:'风场实验室',description:'在同一个三维视景中调试风场、姿态和自动流程。',button:'进入风场实验室',kicker:'MORROW / WIND LAB'},
    city:{title:'织桥街',description:'弧顶交换厅、连续店面与双层步行廊。',button:'进入城市',kicker:'VESPER / LOWER CITY'},
    harbor:{title:'上城台地',description:'坡道连接 8 m 台地与山脊环线。',button:'进入街区',kicker:'VESPER / UPPER CITY'},
    skyway:{title:'空中长廊',description:'高架廊道可通过地面坡道到达。',button:'进入高架',kicker:'VESPER / SKYLINE'},
    ...Object.fromEntries(CITY_LOCATIONS.filter(s=>['garden','waterfront','sculpture'].includes(s.id)).map(s=>[s.id,{title:s.label,description:s.subtitle,button:'前往探索',kicker:'VESPER / CITY LANDMARK'}])),
    free:{title:'驾驶，从这里开始。',description:'WASD 控制车辆，按 H 启动飞行控制。拖动场景，自由观察。',button:'进入试验',kicker:'READY FOR A DIFFERENT KIND OF DRIVE'},
    hover:{title:'把重力，交给控制器。',description:'从 4 m 空中初态开始，默认外部持续供气。G 切换自动回正；关闭回正后 Z / B 连续滚转，1 / 2 平滑调整俯仰。',button:'启动闭环',kicker:'02 / HOVER & ATTITUDE CONTROL'},
    ceiling:{title:'倒过来，也能停下来。',description:'初始化于天花板下方。WASD 沿顶面行驶；按 F 关闭吸附，观察自然下落。',button:'开始倒悬',kicker:'03 / SURFACE ADHESION EXPERIMENT'},
    ramp:{title:'连续驶过，180°。',description:'启动自动低速爬弧，在顶部倒挂停车。按任意驾驶键接管；F 可关闭吸附。',button:'开始爬弧',kicker:'04 / CONTINUOUS INVERSION ARCH'},
  };

  const forcesRoot=new THREE.Group();scene.add(forcesRoot);forcesRoot.visible=false;
  const arrow=(color)=>{const a=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(),1,color,.24,.11);forcesRoot.add(a);a.line.material.depthTest=false;a.cone.material.depthTest=false;a.renderOrder=10;return a;};
  const gravityArrow=arrow(0xedbe88),suctionArrow=arrow(0x68d6be),jetArrows=Array.from({length:10},()=>arrow(0xb7eaa2));
  const contactArrows=Array.from({length:4},()=>arrow(0x8bc9ea));
  const trailCapacity=3600,trailData=new Float32Array(trailCapacity*3);let trailCount=0,trailClock=0;
  const trailGeometry=new THREE.BufferGeometry();trailGeometry.setAttribute('position',new THREE.BufferAttribute(trailData,3).setUsage(THREE.DynamicDrawUsage));trailGeometry.setDrawRange(0,0);
  const trail=new THREE.Line(trailGeometry,new THREE.LineBasicMaterial({color:0xbce5b5,transparent:true,opacity:.75,depthWrite:false}));trail.frustumCulled=false;trail.visible=false;scene.add(trail);
  const targetGroup=new THREE.Group();scene.add(targetGroup);
  const targetRing=new THREE.Mesh(new THREE.RingGeometry(1.1,1.13,72),new THREE.MeshBasicMaterial({color:0xcbeab5,side:THREE.DoubleSide,transparent:true,opacity:.25,depthWrite:false}));targetRing.rotation.x=-Math.PI/2;targetGroup.add(targetRing);targetGroup.visible=false;

  function saveContextCamera(){
    contexts[activeContext].scenario=scenario;
    contexts[activeContext].cameraState={mode:cameraMode,position:camera.position.clone(),wantedPosition:cameraMode==='orbit'?orbitCamera.position.clone():wantedCamera?.clone(),up:camera.up.clone(),target:controls.target.clone()};
  }
  function switchContext(name,{run=true,openConsole=name==='lab'}={}){
    if(learningSessionMode!=='live'){toast('请先在复盘卡上返回原现场，再切换场景。');return;}
    routeExperience?.cancel('context-change');
    cityFlight?.onContextChange();inputSession.release('context-switch',{pause:true});operationHud.invalidate();
    if(!['city','lab'].includes(name))return;
    closeStudy();
    if(name!==activeContext){
      controlCapture?.cancel('切换场景，已保留采集区间。','Scene changed; captured interval retained.');
      researchConsole?.cancel('切换场景');
      if(sim.telemetry().maneuver)sim.startManeuver('cancel');
      researchConsole?.stopRecording?.('切换三维场景','cancelled');meter.markEvent('scene_change',{context:name});
      setPaused(true);keys.clear();saveContextCamera();
      if(!contexts[name]){
        const labScene=new THREE.Scene();
        const labSim=new RoadsterSim({...contexts.city.sim.params},{world:'windlab'});
        const labEnvironment=createWindLaboratory(labScene,renderer,camera,WIND_LAB_GEOMETRY);
        const labCar=createRoadster({quality});labCar.group.userData.renderAuditGroup='vehicle';labScene.add(labCar.group);
        const labExhaust=new ColdGasExhaust(labScene,labSim);labExhaust.mesh.userData.skipContactAO=true;
        contexts.lab={scene:labScene,sim:labSim,car:labCar,environment:labEnvironment,exhaust:labExhaust,scenario:'windlab',cameraState:null};
      }
      activeContext=name;
      ({scene,sim,car,environment,exhaust}=contexts[name]);scenario=contexts[name].scenario;environment.setVehicleRoot?.(car.group);
      t=sim.telemetry();beauty.scene=scene;ssao.scene=scene;
      scene.add(forcesRoot,trail,targetGroup);resetTrace();reverseHold=0;pendingManeuver=null;
      car.setCutaway(cutaway);const swatch=document.querySelector('.swatch.active');if(swatch)car.setColor(swatch.dataset.color);
      document.body.dataset.context=name;researchConsole?.onContextChange(name);setQuality(quality);
      resetCamera(name==='lab'?'orbit':contexts[name].cameraState?.mode||'chase');
      const saved=contexts[name].cameraState;
      if(saved){camera.position.copy(saved.position);camera.up.copy(saved.up);controls.target.copy(saved.target);camera.lookAt(controls.target);orbitCamera.position.copy(saved.wantedPosition||saved.position);orbitCamera.up.copy(camera.up);wantedCamera=orbitCamera.position.clone();cameraSolveMode=cameraMode;lastPosition.copy(vec(t.position));}
      car.group.position.copy(vec(t.position));car.group.quaternion.set(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w);car.update(t,0);
      for(const [key,,,,step,unit,factor]of params){$('param-'+key).value=sim.params[key];$('param-label-'+key).textContent=format(sim.params[key]*factor,factor===1&&step>=1?0:2)+' '+unit;}
      exposureTarget=name==='lab'?environment.exposureAt(camera.position):CITY_WEATHER_PRESETS[weatherPreset].exposure;lastExposureSample=0;
      bloom.strength=name==='lab'?.16:CITY_WEATHER_PRESETS[weatherPreset].bloomStrength;
      renderer.toneMappingExposure=exposureTarget;renderer.shadowMap.needsUpdate=true;
      $('weather-label').textContent=name==='lab'?'室内 / 可编程风场':CITY_WEATHER_PRESETS[weatherPreset].name;
      logEvent('context_enter',{context:name});
    }
    closePanels();menuOpen=false;started=true;document.body.classList.remove('body-menu');document.body.classList.add('body-running');
    $('game-menu').classList.add('hidden');$('launch-card').classList.add('hidden');$('touch-controls').classList.add('active');
    $('menu-resume').innerHTML='继续仿真 <kbd>ESC</kbd>';
    $('context-switch').textContent=activeContext==='lab'?'返回城市':'进入风场实验室';
    $('context-switch').setAttribute('aria-label',activeContext==='lab'?'返回并继续城市中的车辆状态':'进入同页风场实验室');
    $('map-world-label').textContent=activeContext==='lab'?'WIND LAB':'VESPER CITY';
    $('mini-map').setAttribute('aria-label',activeContext==='lab'?'风场实验室测量平面图':'城市导航小地图');
    setPaused(!run);if(openConsole)researchConsole?.open('controls');else researchConsole?.close();
    syncUi(t);viewport.focus({preventScroll:true});
  }
  function openResearch(tab){if(learningSessionMode!=='live'){toast('请先返回原现场；挑战复盘和练习在当前卡片中继续。');return;}shell.openResearch(tab);}
  function closeStudy(){shell.closeStudy();}
  function openStudy(){return shell.openStudy();}
  function updateEnvironment(now,data,physicalDelta){
    if(activeContext==='city'&&(environment.stats?.preparedRoute?.hash??null)!==(data.roadSurface?.descriptorHash??null)){
      const descriptor=sim.getRouteSurface?.()?.descriptor??null;environment.setRouteSurfaceDescription?.(descriptor);cityMap.setSurfaceRoute?.(descriptor);
    }
    const lamps=resolveVehicleLampMode(lampSelection,activeContext==='city'&&CITY_WEATHER_PRESETS[weatherPreset].night);if(car.lampMode!==lamps)car.setLampMode(lamps);
    if(activeContext==='lab'){
      environment.update(data,physicalDelta);
      environment.setTargetPose(data.stabilizationMode==='hold'&&data.holdPositionTarget?{position:data.holdPositionTarget,quaternion:data.holdQuaternionTarget}:null);
    }else environment.update(now/1000,data.position);
  }

  function toast(message,duration=3900){$('toast').textContent=message;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),duration);}
  function logEvent(type,data={}){researchConsole?.recordEvent?.(type,data);}
  function setPaused(value,{releaseInput=true}={}){if((programMatrixBusy||protectedLearningState())&&!value)value=true;paused=value;lastTime=performance.now();if(value){if(releaseInput&&!programMatrixBusy)inputSession.release('pause',{pause:true});else keys.clear();}$('pause-btn').textContent=paused?'▶':'Ⅱ';$('sim-state').textContent=paused?'仿真暂停':'实时仿真';if($('drive-pause-hint'))$('drive-pause-hint').classList.toggle('hidden',!paused||menuOpen||programMatrixBusy);if(paused&&sound)sound.silence();logEvent(paused?'pause':'resume');}
  function resetTrace(){samples=[];trailCount=0;trailGeometry.setDrawRange(0,0);trailClock=0;exhaust.reset();}
  function protectedLearningState(){return learningSessionMode==='review'||learningSessionMode==='practice'&&learningPrepared;}
  function retainLearningLive(){
    if(!learningSaved){
      const research=researchConsole?.getState(),capture=controlCapture?.getState?.();
      if(research?.running||research?.experiment?.recording||research?.experiment?.replaying||research?.experiment?.numericRunning||research?.landing?.running||research?.landing?.numericRunning||capture?.active||programMatrixBusy){
        throw Error(getLanguage()==='en'?'Finish the active recording or research run before entering an isolated practice or review.':'请先结束正在进行的记录或研究，再进入隔离练习或复盘。');
      }
      learningSaved={sim,snapshot:sim.exportState(),context:activeContext,scene:sceneConfiguration(),scenario,scale,camera:cameraConditions(),headEnabled:headFeedback.enabled,navigation:cityMap.waypoint};
    }
    inputSession.release('learning-session',{pause:true});setPaused(true,{releaseInput:false});keys.clear();
  }
  function applyScenePresentation(config){
    if(config?.weatherPreset&&CITY_WEATHER_PRESETS[config.weatherPreset])setCityWeather(config.weatherPreset,{record:false});
    if(config?.quality&&RENDER_PROFILES[config.quality]&&quality!==config.quality)setQuality(config.quality,{persist:false});
    if(config&&'exposureLock'in config){exposureLock=Number.isFinite(config.exposureLock)?config.exposureLock:null;syncExposureControls();}
    if(typeof config?.autoExposure==='boolean')$('auto-exposure').checked=config.autoExposure;
    if(Number.isFinite(config?.exposure))renderer.toneMappingExposure=config.exposure;
    if(['auto','off','drl','low-beam'].includes(config?.lampSelection)){lampSelection=config.lampSelection;$('driving-lamp-mode').value=lampSelection;}
    if(typeof config?.driverHead?.enabled==='boolean'){headFeedback.setEnabled(config.driverHead.enabled);$('head-feedback').checked=headFeedback.enabled;routeExperience?.setFeedback({head:headFeedback.enabled});}
    const descriptor=sim.getRouteSurface?.()?.descriptor??null;
    environment.setRouteSurfaceDescription?.(descriptor);cityMap.setSurfaceRoute?.(descriptor);activeBenchmarkRoute=config?.routeId??descriptor?.id??null;
    cityMap.setDestination(config?.navigationDestination??null,sim.telemetry());
  }
  function activateLearningSim(next,mode,presentation){
    if(!next)throw Error('复盘未生成可显示的原模型状态');
    // Capture/release the live input before changing the reference. Never call
    // releasePilotInput on a source snapshot or a prepared exact-start practice.
    if(activeContext!=='city'){learningSessionMode='live';switchContext('city',{run:false,openConsole:false});}
    learningSessionMode=mode;learningPrepared=mode==='practice';sim=next;exhaust.sim=next;t=sim.telemetry();scenario=sim.scenario;
    pendingManeuver=null;keys.clear();reverseHold=0;resetTrace();headFeedback.reset();applyScenePresentation(presentation);
    resetCamera('chase');car.group.position.copy(vec(t.position));car.group.quaternion.set(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w);car.update(t,0);
    started=true;menuOpen=false;document.body.classList.remove('body-menu');document.body.classList.add('body-running');$('game-menu').classList.add('hidden');$('launch-card').classList.add('hidden');
    setPaused(true,{releaseInput:false});operationHud.invalidate();syncUi(t);document.body.dataset.learningSession=mode;
  }
  function returnLearningLive(){
    learningSeekSerial++;
    if(!learningSaved)return;const saved=learningSaved;
    // Input release belongs to the isolated attempt, not the preserved live car.
    keys.clear();sound?.silence();learningSessionMode='live';learningPrepared=false;
    contexts.city.sim=learningSaved.context==='city'?saved.sim:contexts.city.sim;
    if(activeContext!==saved.context)switchContext(saved.context,{run:false,openConsole:false});
    sim=saved.sim;sim.importState(saved.snapshot);contexts[saved.context].sim=sim;exhaust.sim=sim;scenario=saved.scenario;scale=saved.scale;t=sim.telemetry();
    resetTrace();headFeedback.setEnabled(saved.headEnabled);$('head-feedback').checked=saved.headEnabled;routeExperience?.setFeedback({head:saved.headEnabled});applyScenePresentation(saved.scene);activeBenchmarkRoute=saved.scene.routeId??null;cityMap.setDestination(saved.navigation??null,t);
    resetCamera(saved.camera.mode==='fixed'?'chase':saved.camera.mode);cameraMode=saved.camera.mode;fixedCameraId=saved.camera.id;camera.position.fromArray(saved.camera.position);camera.quaternion.fromArray(saved.camera.quaternion);camera.up.fromArray(saved.camera.up);controls.target.fromArray(saved.camera.orbitTarget??saved.camera.target);orbitCamera.position.fromArray(saved.camera.orbitDesiredPosition??saved.camera.position);orbitCamera.up.copy(camera.up);wantedCamera=orbitCamera.position.clone();cameraSolveMode=cameraMode;camera.fov=saved.camera.fov;camera.updateProjectionMatrix();lastPosition.copy(vec(t.position));
    car.group.position.copy(vec(t.position));car.group.quaternion.set(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w);car.update(t,0);
    learningSaved=null;setPaused(true,{releaseInput:false});document.body.dataset.learningSession='live';operationHud.invalidate();syncUi(t);
  }
  function prepareSurfaceRoute(presetId,{prepareSim}={}){
    if(!paused)throw Error('请先暂停，再准备新的路线条件。');
    if(learningSessionMode!=='live')throw Error('请先返回原现场，再准备城市路线。');
    routeExperience?.cancel('new-route-preparation');cityFlight?.cancel('context_change');controlCapture?.cancel('准备新的城市路线。','Prepare new route.');researchConsole?.stopRecording?.('准备新的城市路线','cancelled');researchConsole?.cancel('准备新的城市路线');
    if(activeContext!=='city')switchContext('city',{run:false,openConsole:false});
    prepareSim?.(sim);
    const descriptor=createRouteSurfacePreset(presetId==='dry-day'?'dry-day':'after-rain'),origin=descriptor.route.start;
    sim.reset('city');sim.setRoadSurface('dry');sim.setRouteSurface(descriptor,{phase:'preparation'});
    sim.body.position.set(origin.x,origin.y,origin.z);sim.body.quaternion.setFromEuler(0,origin.yaw,0);sim.body.previousPosition.copy(sim.body.position);sim.body.interpolatedPosition.copy(sim.body.position);sim.body.previousQuaternion.copy(sim.body.quaternion);sim.body.interpolatedQuaternion.copy(sim.body.quaternion);sim.body.aabbNeedsUpdate=true;
    // Preparation is outside the new recorded run; settle on the unchanged road.
    for(let step=0;step<60;step++)sim.advanceFixed({brake:1},1/120);
    inputSession.release('route-preparation',{pause:true});keys.clear();pendingManeuver=null;scenario='city';contexts.city.scenario=scenario;t=sim.telemetry();
    environment.setRouteSurfaceDescription(descriptor);setCityWeather(presetId==='after-rain-night'?'wet-night':'clear-day',{record:false});activeBenchmarkRoute=descriptor.id;
    cityMap.setSurfaceRoute?.(descriptor);cityMap.setDestination(null,t);resetTrace();resetCamera('chase');started=true;menuOpen=false;document.body.classList.remove('body-menu');document.body.classList.add('body-running');$('game-menu').classList.add('hidden');$('launch-card').classList.add('hidden');setPaused(true,{releaseInput:false});syncUi(t);
    meter.markEvent('route_preparation',{surface:sim.getRouteSurface(),physicalInitialization:true});return{descriptor};
  }
  async function setSoundEnabled(enabled){try{if(enabled&&!sound)sound=createVehicleAudio({volume:+$('sound-volume').value/100});if(sound){sound.enabled=!!enabled;if(enabled)await sound.context.resume();else sound.silence();switchState('sound-btn',sound.enabled);}routeExperience?.setFeedback({sound:!!sound?.enabled});}catch(error){toast('当前浏览器未提供可用音频输出。');routeExperience?.setFeedback({sound:false});}}
  function resetCamera(mode='orbit',instant=true){
    headFeedback.reset();
    fixedCameraId=null;camera.fov=48;camera.updateProjectionMatrix();$('benchmark-camera').value='drive';meter.markEvent('camera_change',{mode});
    cameraMode=mode;wantedCamera=null;cameraObstruction=null;cameraSolveMode=null;clearanceSampleAt=-Infinity;controls.maxDistance=activeContext==='lab'?28:85;camera.up.set(0,1,0);const p=vec(sim.body.position),yaw=t.headingDeg*Math.PI/180;
    controls.target.copy(p).add(new THREE.Vector3(0,.05,0));
    if(mode==='orbit'){
      let offset=new THREE.Vector3(6.15,2.5,7.4);
      if(scenario==='ceiling')offset.set(8.8,-3.7,9.5);
      if(scenario==='ramp')offset.set(10,4.5,-9);
      camera.position.copy(p).add(offset);controls.enabled=true;controls.maxPolarAngle=scenario==='ceiling'?Math.PI*.83:Math.PI*.489;orbitCamera.position.copy(camera.position);orbitCamera.up.copy(camera.up);controls.update();camera.position.copy(orbitCamera.position);camera.quaternion.copy(orbitCamera.quaternion);
    }else{controls.enabled=false;if(instant){camera.position.copy(p).add(new THREE.Vector3(-Math.sin(yaw)*8,3.2,-Math.cos(yaw)*8));camera.lookAt(p);}}
    $('camera-name').textContent={orbit:'环绕视角',chase:'跟随视角',cockpit:'驾驶员视角',top:'俯视测量'}[mode];lastPosition.copy(p);
  }
  function activateScenario(name){
    if(learningSessionMode!=='live'){toast('请先在复盘卡上返回原现场，再重置场景。');return;}
    routeExperience?.cancel('scenario-reset');
    inputSession.release('scenario-reset',{pause:true});operationHud.invalidate();
    controlCapture?.cancel('重新初始化场景，已保留采集区间。','Scenario reset; captured interval retained.');
    researchConsole?.stopRecording?.('重新初始化试验','cancelled');researchConsole?.cancel('重置试验');if(name!=='windlab'&&activeContext==='lab')switchContext('city',{run:false,openConsole:false});
    scenario=activeContext==='lab'?'windlab':name;activeBenchmarkRoute=null;sim.reset(scenario);t=sim.telemetry();setPaused(true);resetTrace();pendingManeuver=name==='ramp'?'ramp':null;
    logEvent('scenario_reset',{scenario:name,params:{...sim.params}});
    $$('.experiment').forEach(b=>b.classList.toggle('active',b.dataset.scenario===name));
    const copy=scenarioText[scenario];$('launch-title').textContent=copy.title;$('launch-description').textContent=copy.description;$('launch-kicker').textContent=copy.kicker;$('start-btn').innerHTML=copy.button+' <span>↗</span>';
    $('launch-card').classList.remove('hidden');document.body.classList.remove('body-running');$('touch-controls').classList.remove('active');
    resetCamera('orbit');car.group.position.copy(vec(t.position));car.group.quaternion.set(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w);car.update(t,0);syncUi(t);closePanels();
  }
  function start(){
    if(pendingManeuver){sim.startManeuver(pendingManeuver);logEvent('maneuver_start',{name:pendingManeuver});pendingManeuver=null;}
    $('menu-resume').innerHTML='继续驾驶 <kbd>ESC</kbd>';
    menuOpen=false;$('game-menu').classList.add('hidden');document.body.classList.remove('body-menu');closePanels();
    started=true;$('launch-card').classList.add('hidden');document.body.classList.add('body-running');$('touch-controls').classList.add('active');setPaused(false);
    if(['free',...CITY_LOCATIONS.map(s=>s.id)].includes(scenario))resetCamera('chase');else if(scenario==='ceiling'){resetCamera('orbit');}else if(scenario==='ramp'){resetCamera('chase');}
    if(scenario==='hover'&&sim.params.supplyMode==='finite')toast('有限储气试验已开始。气压下降会削弱推力；T 是试验补气，L 自动降落。',5800);
    viewport.focus({preventScroll:true});
  }
  function ensureRunning(){if(!started||!$('launch-card').classList.contains('hidden')){pendingManeuver=null;start();}else if(paused)setPaused(false);}
  function setMode(mode){if(protectedLearningState())return;controlCapture?.cancel('手动切换控制模式，采集结束。','Control mode changed manually; capture ended.');researchConsole?.cancel('切换控制模式');sim.setMode(mode);pendingManeuver=null;logEvent('control_mode',{mode});syncUi(sim.telemetry());if(mode==='hover'&&sim.body.position.y<1.3)toast('辅助飞行已接管：E / Q 调整高度，W / S 前后移动，A / D 偏航。');else if(mode==='manual')toast('原始喷口研究接口已启用。日常空中调姿请使用 H 辅助飞行，并用 G 切换自动回正。',6200);}
  function toggleStabilization(){
    if(protectedLearningState())return;
    controlCapture?.cancel('手动切换 G，采集结束。','G was switched manually; capture ended.');
    researchConsole?.cancel('G 切换自动回正');
    const mode=sim.stabilizationMode==='level'?'off':'level';
    sim.setStabilizationMode(mode);inputSession.action('KeyG',{accepted:true,reason:mode==='level'?'已开启 G 回平保高':'已关闭 G 回平保高',telemetry:sim.telemetry()});logEvent('stabilization_mode',{mode});syncUi(sim.telemetry());
    const ownership=sim.telemetry().controlOwnership;
    const offMessage=ownership?.explicitManeuver?'G 已关闭；已请求的 X / U / L 动作继续，操作卡显示当前阶段。':
      sim.mode==='hover'?'G 已关闭；H / E 辅助飞行仍由你先前的请求保持。按 H 返回 DRIVE 可关闭。':
      sim.mode==='drive'?'G 已关闭；当前为 DRIVE，碰撞或倾斜不会自动开启辅助喷气。':'G 已关闭；当前直接推力控制仍按手动输入执行。';
    toast(mode==='level'?'G 已开启：回平、保高与水平速度阻尼；不锁定 X/Z 位置。':offMessage,6000);
  }
  function maneuver(name){
    if(protectedLearningState())return;
    controlCapture?.cancel('启动其他机动流程，采集结束。','Another maneuver started; capture ended.');
    researchConsole?.cancel('启动 '+(name==='roll'?'自动滚转':name==='pitch'?'受控后空翻':'自动降落'));
    if(name==='roll'&&sim.params.supplyMode==='finite'&&t.gasFraction<.75){toast('气量偏低。先按 T 补气，或选择恒压试验台；继续滚转可能中途失去推力。',5500);}
    if(name==='roll'&&t.suctionEnabled&&t.contactCount>1&&Math.abs(t.rollDeg)>90){const reason='当前为倒悬接触工况。请先切换垂直飞行试验，再执行滚转。';inputSession.action(name,{accepted:false,reason,telemetry:sim.telemetry()});toast(reason);return;}
    if(sim.startManeuver(name)===false){inputSession.action(name,{accepted:false,reason:sim.status,telemetry:sim.telemetry()});toast(sim.status,6000);return;}
    inputSession.action(name,{accepted:true,reason:sim.status,telemetry:sim.telemetry()});logEvent('maneuver_start',{name});ensureRunning();
    if(name==='pitch')toast('受控后空翻已接管：真实起跳、俯仰旋转、落地后交还驾驶。1 / 2 仍为手动定率姿态；新操纵可取消自动动作。',6500);
    if(name==='roll'&&sim.params.supplyMode==='finite')toast('已通过有限气源预检：按起始状态规划滚转。地面起始回到地面，空中起始恢复到原高度附近。',5700);
  }
  function takeOver(){if(protectedLearningState())return;controlCapture?.cancel('人工操纵接管，已保留采集区间。','Pilot took over; captured interval retained.');researchConsole?.cancel('驾驶操纵接管');if(sim.telemetry().maneuver){sim.startManeuver('cancel');toast('已取消自动动作，操纵权交给你。',2400);logEvent('manual_takeover');}}
  function refill(){if(protectedLearningState())return;controlCapture?.cancel('试验补气接管，采集结束。','Refill intervention ended capture.');researchConsole?.cancel('试验补气');sim.refillGas();logEvent('gas_refill',{pressureBar:sim.params.initialPressureBar});toast('试验干预：气源已恢复到 '+sim.params.initialPressureBar+' bar。');syncUi(sim.telemetry());}

  let panelFocus=null,pausedByPanel=false;
  function closePanels({restoreFocus=true}={}){
    const resumeMap=activeDrawer==='map'&&pausedByPanel&&!menuOpen;
    $$('.drawer').forEach(d=>d.classList.add('hidden'));$('help-modal').classList.add('hidden');$('drawer-scrim').classList.add('hidden');activeDrawer=null;
    if(restoreFocus&&panelFocus?.isConnected)panelFocus.focus({preventScroll:true});panelFocus=null;
    if(menuOpen)$('game-menu').classList.remove('hidden');
    if(pausedByPanel){pausedByPanel=false;if(resumeMap)setPaused(false);else toast('查看面板时已暂停，按 P 继续仿真。',2500);}
  }
  function openPanel(name){
    inputSession.release('panel-open');
    closeStudy();researchConsole?.close();closePanels();panelFocus=document.activeElement;activeDrawer=name;$('drawer-scrim').classList.remove('hidden');$(name==='help'?'help-modal':name+'-drawer').classList.remove('hidden');
    if(menuOpen)$('game-menu').classList.add('hidden');if(name==='map')cityMap.update(sim.telemetry());
    // Telemetry stays live. Reading assumptions/settings pauses to preserve the finite gas experiment.
    if(name!=='engineering'&&!paused){setPaused(true);pausedByPanel=true;}
    const el=name==='help'?$('help-close'):$(name+'-drawer').querySelector('[data-close]');el.focus();
  }
  function engineeringTab(name){
    $$('[data-engineering-tab]').forEach(b=>b.classList.toggle('active',b.dataset.engineeringTab===name));
    for(const n of ['telemetry','parameters','render','research'])$('engineering-'+n).classList.toggle('hidden',n!==name);
    if(['parameters','research'].includes(name)&&!paused){setPaused(true);toast('参数编辑已暂停仿真，调整完按 P 继续。');}
    if(name==='telemetry')drawChart();
  }

  function openGameMenu(){researchConsole?.close();menuOpen=true;closeStudy();setPaused(true);document.body.classList.add('body-menu');document.body.classList.remove('body-cinema');$('game-menu').classList.remove('hidden');$('menu-resume').focus();}
  function closeGameMenu(){if(!started||!$('launch-card').classList.contains('hidden')){start();return;}menuOpen=false;document.body.classList.remove('body-menu');$('game-menu').classList.add('hidden');closePanels();setPaused(false);viewport.focus();}
  $('experiment-container').appendChild($('left-hud'));
  $$('[data-study-panel]').forEach(button=>button.onclick=openStudy);
  $$('[data-enter-lab]').forEach(button=>button.onclick=()=>switchContext('lab'));
  $$('[data-research-console]').forEach(button=>button.onclick=()=>openResearch(button.dataset.researchConsole==='resume'?undefined:button.dataset.researchConsole));
  $('context-switch').onclick=()=>switchContext(activeContext==='lab'?'city':'lab');
  $('menu-btn').onclick=openGameMenu;$('menu-resume').onclick=closeGameMenu;$('play-city').onclick=()=>{activateScenario('city');start();};$('game-camera').onclick=()=>$('camera-btn').click();
  $$('[data-menu-page]').forEach(button=>button.onclick=()=>{for(const page of ['home','experiments'])$('menu-'+page).classList.toggle('hidden',page!==button.dataset.menuPage);$$('[data-menu-page]').forEach(b=>b.classList.toggle('selected',b===button));});
  $$('[data-spawn]').forEach(button=>button.onclick=()=>{activateScenario(button.dataset.spawn);start();});
  $$('[data-game-panel]').forEach(button=>button.onclick=()=>{const name=button.dataset.gamePanel;if(['render','parameters','telemetry','research'].includes(name)){openPanel('engineering');engineeringTab(name);}else openPanel(name);});
  $$('[data-game-command]').forEach(button=>button.onclick=()=>{const command=button.dataset.gameCommand;closeGameMenu();if(command==='hover'){setMode('hover');ensureRunning();}else if(command==='suction')$('suction-btn').click();else if(command==='stabilize')toggleStabilization();else maneuver(command);});
  function syncDrivingHud(data){
    $('hud-speed').textContent=Math.round(Math.hypot(data.velocity.x,data.velocity.z)*3.6);$('hud-mode').textContent=data.holdActive?'POSE HOLD':data.stabilizationActive?'AIR STABILIZE':data.mode==='hover'?'FLIGHT ASSIST':data.mode==='manual'?'DIRECT THRUST':data.forwardSpeedKmh<-.5?'REVERSE':'DRIVE';
    $('hud-seal').textContent=data.suctionEnabled?'吸附 '+Math.round(data.sealQuality*100)+'%':data.stabilizationMode==='hold'?({holding:'研究姿态保持',tracking:'目标收敛中',limited:'推力受限',surface:'接触面约束'}[data.holdStatus]||'研究保持待命'):data.airStabilization?'自动回正 G':'';
    $('stabilize-btn').setAttribute('aria-pressed',data.stabilizationMode==='level');$('stabilize-label').textContent=data.stabilizationMode==='level'?'G 回平保高 · 开启':'G 回平保高 · 关闭';
    $('hud-hold').classList.toggle('hidden',data.stabilizationMode!=='hold');$('hud-hold').textContent='位置误差 '+format(data.holdPositionError,2)+' m · 姿态误差 '+format(data.holdAttitudeErrorDeg,1)+'°';
    $('hud-flight').classList.remove('hidden');$('hud-flight').textContent=tr('世界重心 H')+' '+data.heightWorld.toFixed(1)+' m · V '+data.verticalSpeed.toFixed(1)+' m/s';
    const now=performance.now();if(now-clearanceSampleAt>=250||!clearanceEstimate){clearanceEstimate=sim.getClearanceEstimate({maxDistance:8,includeQuickRoll:true});clearanceSampleAt=now;}
    const gap=value=>Number.isFinite(value)?format(value,2)+' m':tr('8 m内未采到');
    const side=Object.entries(clearanceEstimate.distances).filter(([key])=>!['up','down'].includes(key)).map(([,value])=>value.distanceM).filter(Number.isFinite);
    $('hud-clearance').textContent=tr('车壳下估计')+' '+gap(clearanceEstimate.hullDistances?.down?.distanceM)+' · '+tr('整车上方')+' '+gap(clearanceEstimate.distances.up?.distanceM)+' · '+tr('含轮胎下方')+' '+gap(clearanceEstimate.distances.down?.distanceM)+(side.length&&Math.min(...side)<3?' · '+tr('侧向')+' '+gap(Math.min(...side)):'');
    $('hud-clearance').title=tr('物理包络采样，可能漏过细小障碍；不是可用恢复高度。')+' '+tr('重心向下射线')+' '+format(clearanceEstimate.centreDownDistanceM,2)+' m';
    $('hud-clearance').dataset.estimate=JSON.stringify(clearanceEstimate);
    $('hud-air-label').textContent=data.supplyMode==='bench'?'外部持续供气 ∞':'气源 '+Math.round(data.gasFraction*100)+'%';$('hud-air-fill').style.width=(data.supplyMode==='bench'?100:data.gasFraction*100)+'%';
    if(activeContext==='lab'){
      $('hud-waypoint').classList.add('hidden');$('district-label').textContent='MORROW / WIND LAB';$('menu-location').textContent='MORROW / WIND LAB';
      const c=$('mini-map').getContext('2d'),w=288,k=2.1;c.clearRect(0,0,w,w);c.fillStyle='#101e29';c.fillRect(0,0,w,w);
      c.save();c.translate(w/2,w/2);c.strokeStyle='#446574';c.lineWidth=1;
      for(let x=-30;x<=30;x+=5){c.beginPath();c.moveTo(x*k,-55*k);c.lineTo(x*k,55*k);c.stroke();}
      for(let z=-55;z<=55;z+=5){c.beginPath();c.moveTo(-35*k,z*k);c.lineTo(35*k,z*k);c.stroke();}
      c.fillStyle='#92abae';for(const part of WIND_LAB_GEOMETRY){if(part.kind==='floor'||part.kind==='lab-ceiling'||part.position[1]>20)continue;const [x,,z]=part.position,[sx,,sz]=part.size;c.fillRect((-x-sx/2)*k,(-z-sz/2)*k,sx*k,sz*k);}
      c.translate(-data.position.x*k,-data.position.z*k);c.rotate(-data.headingDeg*Math.PI/180);c.fillStyle='#d5f7e4';c.beginPath();c.moveTo(0,-10);c.lineTo(-5,7);c.lineTo(5,7);c.closePath();c.fill();c.restore();return;
    }
    const navigation=cityMap.navigator.update(data);
    $('hud-waypoint').classList.toggle('hidden',!navigation.destination);$('hud-waypoint').textContent=getLanguage()==='en'?navigation.messageEn:navigation.messageZh;
    $('hud-waypoint').setAttribute('data-no-i18n','');$('hud-waypoint').dataset.navigation=JSON.stringify({status:navigation.status,destination:navigation.destination?.id??null,remainingM:navigation.remainingM,levelM:navigation.levelM,nextTurn:navigation.nextTurn,offRoute:navigation.offRoute});
    if(activeDrawer==='map')cityMap.update(data);const district=districtAt(data.position.x,data.position.z);$('district-label').textContent=district;$('menu-location').textContent=district;
    const c=$('mini-map').getContext('2d'),w=288,range=130,scale=w/(range*2);c.clearRect(0,0,w,w);c.fillStyle='#0b1723';c.fillRect(0,0,w,w);c.save();c.translate(w/2,w/2);
    const px=x=>-(x-data.position.x)*scale,pz=z=>-(z-data.position.z)*scale;c.strokeStyle='#7397b344';c.lineWidth=28*scale;
    for(let q=-600;q<=600;q+=100){c.beginPath();c.moveTo(px(q),-w);c.lineTo(px(q),w);c.stroke();c.beginPath();c.moveTo(-w,pz(q));c.lineTo(w,pz(q));c.stroke();}
    c.strokeStyle='#b0c6b8aa';for(const street of CITY_STREETS){c.lineWidth=street.width*scale;c.beginPath();street.points.forEach((p,i)=>i?c.lineTo(px(p[0]),pz(p[2])):c.moveTo(px(p[0]),pz(p[2])));c.stroke();}
    c.strokeStyle='#b9c3a977';for(const route of CITY_ROUTES){c.lineWidth=route.width*scale;c.beginPath();route.points.forEach((p,i)=>i?c.lineTo(px(p[0]),pz(p[2])):c.moveTo(px(p[0]),pz(p[2])));c.stroke();}
    c.fillStyle='#57708766';for(const b of CITY_BUILDINGS)if(Math.abs(b.x-data.position.x)<range+40&&Math.abs(b.z-data.position.z)<range+40)c.fillRect(px(b.x+b.w/2),pz(b.z+b.d/2),b.w*scale,b.d*scale);
    for(const s of CITY_LOCATIONS){const x=px(s.position[0]),z=pz(s.position[2]);if(Math.abs(x)>w/2||Math.abs(z)>w/2)continue;c.fillStyle=['garden','waterfront','sculpture'].includes(s.id)?'#99c59b':'#c0ad86';c.beginPath();c.arc(x,z,4,0,7);c.fill();}
    const mappedRoute=sim.getRouteSurface?.()?.descriptor;if(mappedRoute&&activeBenchmarkRoute===mappedRoute.id){c.strokeStyle='#f0cf8d';c.lineWidth=3;c.beginPath();mappedRoute.route.waypoints.forEach((p,i)=>i?c.lineTo(px(p.x),pz(p.z)):c.moveTo(px(p.x),pz(p.z)));c.stroke();}
    if(navigation.path?.length>1){c.strokeStyle=navigation.offRoute?'#e1bd82':'#c0efcb';c.lineWidth=3;c.setLineDash(navigation.offRoute?[4,3]:[]);c.beginPath();navigation.path.forEach((p,i)=>i?c.lineTo(px(p[0]),pz(p[2])):c.moveTo(px(p[0]),pz(p[2])));c.stroke();c.setLineDash([]);}
    c.fillStyle='#8ac5d7';for(const [x,z]of [[0,-28],[36,18],[-36,42]]){c.beginPath();c.arc(px(x),pz(z),3,0,7);c.fill();}c.rotate(-data.headingDeg*Math.PI/180);c.fillStyle='#d1f3f2';c.beginPath();c.moveTo(0,-12);c.lineTo(-7,8);c.lineTo(0,4);c.lineTo(7,8);c.closePath();c.fill();c.restore();
  }

  // All controls call the same simulation API, including touch and gamepad input.
  $$('.experiment').forEach(b=>b.addEventListener('click',()=>{activateScenario(b.dataset.scenario);start();}));
  $$('[data-mode]').forEach(b=>b.addEventListener('click',()=>{setMode(b.dataset.mode);ensureRunning();}));
  $$('[data-open]').forEach(b=>b.addEventListener('click',()=>openPanel(b.dataset.open)));
  $$('[data-close]').forEach(b=>b.addEventListener('click',closePanels));
  $$('[data-engineering-tab]').forEach(b=>b.addEventListener('click',()=>engineeringTab(b.dataset.engineeringTab)));
  $('drawer-scrim').addEventListener('click',closePanels);$('help-btn').onclick=()=>openPanel('help');$('help-close').onclick=closePanels;$('help-done').onclick=closePanels;
  $('drive-tab').onclick=closePanels;document.querySelector('.brand').onclick=e=>{e.preventDefault();activateScenario('free');};
  $('start-btn').onclick=start;$('pause-btn').onclick=()=>{if(!started)start();else setPaused(!paused);};$('reset-btn').onclick=()=>activateScenario(scenario);
  $('refill-btn').onclick=refill;$('suction-btn').onclick=()=>{if(protectedLearningState())return;sim.setSuction(!sim.suctionEnabled);logEvent('suction_switch',{enabled:sim.suctionEnabled});syncUi(sim.telemetry());};
  $('roll-btn').onclick=()=>maneuver('roll');$('pitch-btn').onclick=()=>maneuver('pitch');$('land-btn').onclick=()=>maneuver('land');
  $('camera-btn').onclick=()=>{const modes=['orbit','chase','cockpit','top'];resetCamera(modes[(modes.indexOf(cameraMode)+1)%4]);};
  $('forces-btn').onclick=()=>{showForces=!showForces;forcesRoot.visible=showForces;$('forces-btn').setAttribute('aria-pressed',showForces);if(showForces)toast('力矢量：杏色＝重力，青色＝吸附，浅绿＝喷口，蓝色＝轮胎支撑。长度按力的对数缩放。',5600);};
  $('trail-btn').onclick=()=>{showTrail=!showTrail;trail.visible=showTrail;$('trail-btn').setAttribute('aria-pressed',showTrail);};
  $('collapse-hud').onclick=()=>{showHud=false;$('left-hud').classList.add('hidden');$('expand-hud').classList.remove('hidden');};
  $('expand-hud').onclick=()=>{showHud=true;$('left-hud').classList.remove('hidden');$('expand-hud').classList.add('hidden');document.body.classList.remove('body-running');};
  $('fullscreen-btn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();}catch{toast('当前浏览器不允许自动全屏，可使用 F11。');}};
  $('supply-mode').onchange=e=>{researchConsole?.cancel('修改供气模式');sim.setSupplyMode(e.target.value);logEvent('supply_mode',{mode:e.target.value});toast(e.target.value==='bench'?'已切换恒压试验台：假设外部持续供气。':'已切换有限储气：气量与压力将随喷射降低。');syncUi(sim.telemetry());};
  const params=[
    ['cornerStiffnessFront','前轮标称角刚度',20000,150000,5000,'kN/rad',.001],['cornerStiffnessRear','后轮标称角刚度',20000,150000,5000,'kN/rad',.001],['steeringAccelG','道路转向横向加速度参考',.2,1.2,.05,'g',1],
    ['dryMass','空车等效质量',1000,3500,50,'kg',1],['tireMu','轮胎摩擦系数',.3,2.2,.05,'',1],
    ['suctionPressurePa','满密封负压差',1000,15000,50,'kPa',.001],['liftNozzleMax','每个主升力喷口上限',5000,30000,500,'kN',.001],
    ['tankLitres','气罐总容积',200,1800,50,'L',1],['initialPressureBar','初始储气压力',100,600,10,'bar',1],
    ['springRate','每轮悬架刚度',35000,120000,2500,'kN/m',.001],['suspensionDamping','每轮悬架阻尼',2500,12000,100,'kN·s/m',.001],
  ];
  $('parameter-fields').innerHTML=params.map(([key,label,min,max,step,unit,factor])=>`<label class="field-label" for="param-${key}">${label}<small>假设</small><b id="param-label-${key}">${format(sim.params[key]*factor,factor===1&&step>=1?0:2)} ${unit}</b></label><input id="param-${key}" data-param="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${sim.params[key]}">`).join('');
  for(const [key,label,min,max,step,unit,factor] of params){const element=$('param-'+key);element.addEventListener('input',()=>{$('param-label-'+key).textContent=format(+element.value*factor,factor===1&&step>=1?0:2)+' '+unit;});element.addEventListener('change',()=>{researchConsole?.cancel('修改物理参数');sim.setParam(key,+element.value);logEvent('parameter_change',{key,value:+element.value});sim.reset(scenario);t=sim.telemetry();resetTrace();setPaused(true);syncUi(t);toast('已修改'+label+'并重新初始化试验，按 P 继续。');});}
  const responseLabels={verticalAccelerationMps2:'升降加速与制动',rollRateDegS:'Z / B 滚转速率',pitchRateDegS:'1 / 2 俯仰速率',angularAccelerationDegS2:'姿态角加速度'};
  $('control-response-fields').innerHTML=Object.entries(CONTROL_RESPONSES).map(([key,d])=>`<label for="response-${key}"><span>${responseLabels[key]}</span><output id="response-value-${key}" for="response-${key}"></output></label><input id="response-${key}" data-requires-graphics type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${sim.params[key]??d.default}">`).join('');
  function setVerticalResponse(value){
    if(protectedLearningState())return;
    const next=saveVerticalResponse(value);
    if(sim.params.climbRateMps!==next){sim.setParam('climbRateMps',next);logEvent('vertical_response_change',{targetSpeedMps:next,definition:'World vertical target speed, immediate key command; actuator limits unchanged'});}
    syncVerticalResponse(sim.telemetry());
  }
  function setControlResponse(key,value){
    if(protectedLearningState())return;
    const next=saveControlResponse(key,value);
    if(sim.params[key]!==next){sim.setParam(key,next);logEvent('control_response_change',{key,value:next,definition:'Reference motion limit shared by manual control and automatic roll; physical actuator capacity unchanged'});}
    syncVerticalResponse(sim.telemetry());
  }
  function syncVerticalResponse(data){
    if(document.activeElement!==$('vertical-speed-command'))$('vertical-speed-command').value=sim.params.climbRateMps;
    $('vertical-response-summary-value').textContent='E / Q · '+sim.params.climbRateMps.toFixed(1)+' m/s';$('vertical-speed-value').textContent=format(Number($('vertical-speed-command').value),1)+' m/s';
    const command=data.verticalControl;
    $('vertical-response-status').textContent=command&&data.mode==='hover'?'指令 '+format(command.commandMps,1)+' m/s · 实际垂速 '+format(data.verticalSpeed,1)+' m/s':'按键立即采用设定值；加速度受实际推力限制。';
    for(const [key,d]of Object.entries(CONTROL_RESPONSES)){
      const element=$('response-'+key);if(document.activeElement!==element)element.value=sim.params[key]??d.default;
      $('response-value-'+key).textContent=format(Number(element.value),key==='verticalAccelerationMps2'?1:0)+' '+d.unit;
    }
    const controlOwner=data.controlOwnership?.owner;
    const offResponse=data.maneuver?'G 已关闭：已请求的动作继续；H 取消动作并返回 DRIVE。':
      controlOwner==='raw-valves'?'G 已关闭：直接阀门输入正在控制喷气；松开阀门后请求归零。':
      data.mode==='hover'?'G 已关闭：H / E 辅助飞行正在运行；按 H 返回 DRIVE 可关闭。Z / B 滚转，1 / 2 俯仰。':
      data.mode==='drive'?'G 已关闭：当前为 DRIVE。H / E 会开启辅助飞行；碰撞和倾斜不会自动开启。':
      'G 已关闭：当前为直接推力模式，喷气请求跟随手动输入。';
    $('control-response-mode').textContent=data.stabilizationMode==='off'?offResponse:data.stabilizationMode==='hold'?'研究程序保持目标姿态；按 G 转为水平稳定，手动输入可接管。':'G 已开启：1 / 2 临时控制俯仰，松键回正；Z / B 为横移。连续滚转请关闭 G。';
  }
  $('vertical-speed-command').oninput=e=>setVerticalResponse(Number(e.target.value));
  $('vertical-speed-command').onchange=e=>setVerticalResponse(Number(e.target.value));
  $('vertical-speed-reset').onclick=()=>{setVerticalResponse(VERTICAL_RESPONSE.default);$('vertical-speed-command').value=VERTICAL_RESPONSE.default;syncVerticalResponse(sim.telemetry());toast('升降响应已恢复默认 5 m/s。');};
  for(const key of Object.keys(CONTROL_RESPONSES))$('response-'+key).oninput=e=>setControlResponse(key,Number(e.target.value));
  const responsePresets={gentle:{climbRateMps:3,verticalAccelerationMps2:3,rollRateDegS:90,pitchRateDegS:30,angularAccelerationDegS2:180},standard:{climbRateMps:5,verticalAccelerationMps2:5,rollRateDegS:180,pitchRateDegS:60,angularAccelerationDegS2:360},maneuver:{climbRateMps:14,verticalAccelerationMps2:6,rollRateDegS:240,pitchRateDegS:90,angularAccelerationDegS2:480},quickroll:{climbRateMps:4,verticalAccelerationMps2:10,rollRateDegS:360,pitchRateDegS:90,angularAccelerationDegS2:720}};
  for(const button of $$('[data-response-preset]'))button.onclick=()=>{const settings=responsePresets[button.dataset.responsePreset];setVerticalResponse(settings.climbRateMps);for(const key of Object.keys(CONTROL_RESPONSES))setControlResponse(key,settings[key]);syncVerticalResponse(sim.telemetry());toast('已应用操控响应；实际动作仍受喷口、压力与制动余量限制。');};
  $('radio-chip').onclick=()=>openPanel('radio');
  for(const [id,key]of [['steering-assist','steeringAssist'],['traction-assist','tractionAssist'],['abs-enabled','absEnabled']])$(id).onchange=e=>{sim.setParam(key,e.target.checked);logEvent('assistance_change',{key,enabled:e.target.checked});};
  $('nozzle-model').onchange=e=>{researchConsole?.cancel('修改喷口模型');sim.setParam('nozzleModel',e.target.value);logEvent('nozzle_model',{model:e.target.value});};
  $('gas-model').onchange=e=>{researchConsole?.cancel('修改气源模型');sim.setParam('gasModel',e.target.value);logEvent('gas_model',{model:e.target.value});toast(e.target.value==='adiabatic'?'气源模型：绝热放空 + 缓慢环境换热。':'气源模型：等温对照（恒定气温假设）。');};
  $('target-height').oninput=e=>{sim.setParam('hoverHeight',+e.target.value);$('target-height-label').textContent=format(+e.target.value,1)+' m';logEvent('height_target',{value:+e.target.value});};
  $('time-scale').oninput=e=>{scale=+e.target.value;$('time-scale-label').textContent=format(scale,2)+' ×';logEvent('time_scale',{value:scale});};
  $('defaults-btn').onclick=()=>{setVerticalResponse(VERTICAL_RESPONSE.default);for(const [key,d]of Object.entries(CONTROL_RESPONSES))setControlResponse(key,d.default);for(const [key]of params){sim.setParam(key,DEFAULT_PARAMS[key]);$('param-'+key).value=DEFAULT_PARAMS[key];$('param-'+key).dispatchEvent(new Event('input'));}for(const key of ['steeringAssist','tractionAssist','absEnabled','roadSurface','wingMode','wingDeployment','nozzleModel'])sim.setParam(key,DEFAULT_PARAMS[key]);sim.setSupplyMode(DEFAULT_PARAMS.supplyMode);$('supply-mode').value=DEFAULT_PARAMS.supplyMode;sim.setParam('gasModel','adiabatic');$('gas-model').value='adiabatic';sim.setParam('hoverHeight',4);$('target-height').value=4;$('target-height-label').textContent='4.0 m';activateScenario(scenario);toast('默认参数已恢复。');};
  function setQuality(value,{persist=true}={}){
    meter.markEvent('quality_change',{quality:value});quality=RENDER_PROFILES[value]?value:'balanced';renderProfile=RENDER_PROFILES[quality];governor.setQuality(quality);meter.reset();
    if(persist)try{localStorage.setItem('roadster-quality',quality);}catch{}
    $('quality').value=quality;document.body.dataset.quality=quality;
    if(renderProfile.aoSamples&&aoSamples!==renderProfile.aoSamples){ssao.dispose();ssao=createContactAO(renderProfile.aoSamples);aoSamples=renderProfile.aoSamples;}
    ssao.enabled=activeContext==='city'&&renderProfile.aoScale>0;bloom.enabled=renderProfile.bloom;
    composer.passes=[];if(ssao.enabled)composer.addPass(ssao);composer.addPass(beauty);if(bloom.enabled)composer.addPass(bloom);
    if(renderProfile.antialias==='fxaa'){composer.addPass(output);composer.addPass(fxaa);}else{composer.addPass(smaa);composer.addPass(output);}
    if(!ssao.enabled)ssao.setSize(1,1);if(!bloom.enabled)bloom.setSize(1,1);if(quality==='balanced')smaa.setSize(1,1);
    environment.setContactAO(ssao.blurRenderTarget.texture);car.setQuality?.(quality);environment.setQuality(quality,renderProfile);exhaust.setQuality(quality,renderProfile);renderer.shadowMap.enabled=true;renderer.shadowMap.needsUpdate=true;resize();
  }
  $('quality').onchange=e=>setQuality(e.target.value);
  function cameraConditions(){const fixed=cameraMode==='fixed'?CITY_CAPTURE_CAMERAS.find(v=>v.id===fixedCameraId):null;const target=fixed?[...fixed.target]:cameraMode==='orbit'?controls.target.toArray():camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),10).toArray();return {id:fixedCameraId,mode:cameraMode,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),target,targetMeaning:fixed?'fixed preset look-at':cameraMode==='orbit'?'orbit look-at':'point 10 m along actual optical axis',orbitTarget:controls.target.toArray(),orbitDesiredPosition:cameraMode==='orbit'?orbitCamera.position.toArray():null,fov:camera.fov,near:camera.near,far:camera.far,aspect:camera.aspect,viewOffset:camera.view?.enabled?{...camera.view}:null};}
  function sceneConfiguration(){return {version:3,routeSurface:sim.getRouteSurface?.()??null,driverHead:headFeedback.getState(),learningSessionMode,navigationDestination:cityMap.waypoint?.id??null,exposureLock,lampSelection,vehicleLampMode:car.lampMode,context:activeContext,weatherPreset:activeContext==='city'?weatherPreset:null,quality,routeId:activeContext==='city'?activeBenchmarkRoute:null,camera:cameraConditions(),exposure:renderer.toneMappingExposure,autoExposure:$('auto-exposure').checked};}
  function visualConditions(){const simState=sim.exportState();return {...getRuntimeIdentity(),collisionIdentity:simState.geometrySignature,clearanceEstimate,cameraObstruction:cameraObstruction?{...cameraObstruction,wantedPosition:wantedCamera?.toArray()}:null,schema:'roadster-visual-conditions',version:2,exposureLock,lampSelection,vehicleLampMode:car.lampMode,brakeSignal:car.group.userData.brakeSignal,resourceHistory:[...resourceHistory],paused,renderState:paused?'paused-preview':'active-simulation',lighting:environment.stats?.lightingDiagnostics||null,sceneStats:environment.stats,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,context:activeContext,weatherPreset,route:activeContext==='city'?activeBenchmarkRoute:null,quality,profile:renderProfile,resolution:{...renderSize,cssWidth:innerWidth,cssHeight:innerHeight,devicePixelRatio:devicePixelRatio||1},camera:cameraConditions(),exposure:renderer.toneMappingExposure,autoExposure:$('auto-exposure').checked,simState,graphicsStartup:shell.graphics,device:meter.device,lastProgramAudit:renderPrograms.snapshot(),comparisonProtocol:CITY_VISUAL_CAPTURE_PROTOCOL,cityReviewRoute:CITY_REVIEW_ROUTE};}
  function beginPerformanceCapture(durationMs){
    if(activeContext==='lab'&&durationMs>30000){toast('完整路线采样请先进入城市的织桥环线。');return;}
    closePanels();if(menuOpen)closeGameMenu();else if(paused)setPaused(false);
    meter.startCapture({warmupMs:5000,durationMs,metadata:visualConditions()});
    toast('先记录 5 秒活动预热，再采集 '+durationMs/1000+' 秒稳态驾驶。暂停不计入，两阶段分开导出。',6000);
  }
  $('performance-capture').onclick=()=>beginPerformanceCapture(30000);
  $('performance-route-capture').onclick=()=>beginPerformanceCapture(150000);
  $('performance-stop').onclick=()=>{meter.stopCapture();toast('采样已停止，已有数据与停止原因均可导出。');};
  $('performance-export').onclick=()=>download(JSON.stringify(meter.export({...getRuntimeIdentity(),version:MODEL_VERSION,quality,weatherPreset,route:activeBenchmarkRoute,profile:renderProfile,resolution:renderSize,scene:environment.stats,vehicle:car.getRenderCost?.()||null,graphicsStartup:shell.graphics}),null,2),'roadster-performance-'+weatherPreset+'-'+quality+'.json','application/json');
  $('driving-lamp-mode').onchange=e=>{lampSelection=e.target.value;updateEnvironment(performance.now(),sim.telemetry(),0);logEvent('vehicle_lamp_selection',{selection:lampSelection,applied:car.lampMode});};
  function setCityWeather(value,{record=true}={}){
    if(!CITY_WEATHER_PRESETS[value])return;
    weatherPreset=value;contexts.city.environment.setWeatherPreset?.(value);const presentation=CITY_WEATHER_PRESETS[value];
    $('weather-preset').value=value;$('day-btn').textContent=presentation.name;
    syncExposureControls();
    if(activeContext==='city'){bloom.strength=presentation.bloomStrength;exposureTarget=exposureLock??presentation.exposure;renderer.toneMappingExposure=exposureTarget;lastExposureSample=0;$('weather-label').textContent=presentation.name;renderer.shadowMap.needsUpdate=true;}
    if(record){meter.markEvent('weather_change',{weatherPreset:value});logEvent('visual_weather',{preset:value});}
  }
  function syncExposureControls(){
    const night=activeContext==='city'&&CITY_WEATHER_PRESETS[weatherPreset].night;
    $('exposure-lock').checked=exposureLock!==null;
    $('exposure-lock-value').disabled=exposureLock===null||graphicsStopped;
    if(exposureLock!==null)$('exposure-lock-value').value=exposureLock;
    $('auto-exposure').disabled=exposureLock!==null||night||graphicsStopped;
    $('exposure-status').textContent=exposureLock!==null?'对照曝光已锁定；切换天气也保留该值。':night?'湿夜采用固定预设曝光；明暗适应只用于晴天，开关保存值不变。':'晴天可按相机所在街巷缓慢适应明暗。';
  }
  function setExposureLock(value){
    exposureLock=value===null?null:clamp(Number(value)||1,.25,3);
    if(exposureLock!==null){exposureTarget=exposureLock;renderer.toneMappingExposure=exposureLock;}
    lastExposureSample=0;syncExposureControls();
    meter.markEvent('exposure_change',{exposureLock});logEvent('visual_exposure',{exposureLock});
  }
  $('exposure-lock').onchange=event=>setExposureLock(event.target.checked?Number($('exposure-lock-value').value):null);
  $('exposure-lock-value').onchange=event=>setExposureLock(Number(event.target.value));
  $('exposure-baseline-39').onclick=()=>setExposureLock(weatherPreset==='wet-night'?1.02:.87);
  $('auto-exposure').onchange=()=>{lastExposureSample=0;meter.markEvent('exposure_change',{autoExposure:$('auto-exposure').checked});};
  $('weather-preset').onchange=event=>setCityWeather(event.target.value);
  $('benchmark-camera').innerHTML='<option value="drive">驾驶相机</option>'+CITY_CAPTURE_CAMERAS.map(view=>'<option value="'+view.id+'">'+escapeHtml(view.name)+'</option>').join('');
  $('benchmark-route-start').onclick=()=>{
    if(learningSessionMode!=='live'){toast('请先返回原现场，再载入路线初态。');return;}
    researchConsole?.stopRecording?.('载入路线初态','cancelled');researchConsole?.cancel('载入路线初态');
    if(activeContext!=='city')switchContext('city',{run:false,openConsole:false});activateScenario('city');
    const origin=CITY_BENCHMARK_ROUTE.spawn;sim.body.position.set(origin.position.x,origin.position.y,origin.position.z);sim.body.previousPosition.copy(sim.body.position);sim.body.interpolatedPosition.copy(sim.body.position);sim.body.quaternion.setFromEuler(0,origin.heading,0);sim.body.previousQuaternion.copy(sim.body.quaternion);sim.body.interpolatedQuaternion.copy(sim.body.quaternion);sim.body.aabbNeedsUpdate=true;
    activeBenchmarkRoute=CITY_BENCHMARK_ROUTE.id;t=sim.telemetry();resetTrace();resetCamera('chase');
    closePanels();if(menuOpen)closeGameMenu();setPaused(true);syncUi(t);logEvent('route_initial_state',{route:activeBenchmarkRoute,position:{...origin.position}});
    toast('已到织桥环线入口。按 P 继续，沿地图路线驾驶；建议约 30 km/h，路口减速。',7000);
  };
  $('benchmark-camera').onchange=event=>{
    const view=CITY_CAPTURE_CAMERAS.find(item=>item.id===event.target.value);
    if(!view){resetCamera('chase');return;}
    if(activeContext!=='city')switchContext('city',{run:false,openConsole:false});closePanels();if(menuOpen)closeGameMenu();setPaused(true);
    fixedCameraId=view.id;activeBenchmarkRoute=CITY_BENCHMARK_ROUTE.id;cameraMode='fixed';controls.enabled=false;camera.clearViewOffset();camera.position.set(...view.position);camera.up.set(0,1,0);camera.fov=view.fov;camera.lookAt(new THREE.Vector3(...view.target));camera.updateProjectionMatrix();$('camera-name').textContent=view.name;
    meter.markEvent('camera_change',{id:view.id});toast('已锁定 '+view.name+'，可以切换晴天／湿夜并导出画面对照。');
  };
  $('visual-capture').onclick=()=>{closePanels();if(menuOpen)closeGameMenu();setPaused(true);captureImageRequested=true;};
  $('visual-capture-bundle').onclick=()=>{closePanels();if(menuOpen)closeGameMenu();setPaused(true);captureBundleRequested=true;};
  $('visual-capture-metadata').onclick=()=>download(JSON.stringify(visualConditions(),null,2),'roadster-view-'+(fixedCameraId||cameraMode)+'-'+weatherPreset+'.json','application/json');

  function requestProgramFrame({label='current-frame',png=false,requiredCategories=[],imageFile=label+'.png',conditionsFile=label+'.json'}={}){
    if(matrixAbort?.signal.aborted)return Promise.reject(captureCancelled());
    if(pendingProgramCapture)return Promise.reject(Error(tr('已有绘制诊断正在等待当前帧。')));
    if(graphicsStopped)return Promise.reject(Error(tr('当前没有可用的 WebGL 绘制。')));
    return new Promise((resolve,reject)=>{
      const queuedAt=performance.now();
      const job={label,png,requiredCategories,imageFile,conditionsFile,captureId:label+'-'+Date.now(),inFlight:false,timer:null,phase:'queued',phases:{queued:{at:new Date().toISOString(),elapsedMs:0}},report:null,
        mark:phase=>{job.phase=phase;job.phases[phase]={at:new Date().toISOString(),elapsedMs:performance.now()-queuedAt};},
        progress:()=>({captureId:job.captureId,label,png,phase:job.phase,inFlight:job.inFlight,deadlineMs:20000,elapsedMs:performance.now()-queuedAt,phases:JSON.parse(JSON.stringify(job.phases))}),
        resolve:value=>{if(pendingProgramCapture!==job)return;clearTimeout(job.timer);const progress=job.progress();if(value.conditions)value.conditions.captureProgress=progress;pendingProgramCapture=null;resolve({...value,captureProgress:progress});},
        reject:error=>{if(pendingProgramCapture!==job)return;clearTimeout(job.timer);error.captureProgress=job.progress();error.captureAudit=job.report;pendingProgramCapture=null;reject(error);}};
      pendingProgramCapture=job;
      job.timer=setTimeout(()=>{if(pendingProgramCapture===job){job.reject(Error(tr('没有收到完整绘制与PNG编码结果；请保持页面可见并检查WebGL。')));}},20000);
    });
  }
  function programConditions(label){return {...getRuntimeIdentity(),label,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,context:activeContext,quality,weatherPreset,paused,renderState:paused?'paused-preview':'active-simulation',simTime:t.simTime,camera:cameraConditions(),resolution:{...renderSize},exposure:renderer.toneMappingExposure};}
  function programStatus(report){if(programMatrixBusy)return;$('render-program-status').textContent=tr(report.status==='passed'?'本次实际链接与绘制检查通过；画质与路线性能仍需另验。':'检测到材质链接、资源预算或绘制失败；请导出诊断。');}
  async function exportCurrentProgramFrame({resume=false}={}){
    if(programMatrixBusy)return;
    try{
      closePanels();if(menuOpen)closeGameMenu();setPaused(!resume);
      const stem='roadster-'+MODEL_VERSION+'-gpu-'+(resume?'active':'paused');
      const result=await requestProgramFrame({label:resume?'active-driving-frame':'paused-frame',png:true,imageFile:stem+'.png',conditionsFile:stem+'.json'});
      const archive=await captureArchive([{name:stem+'.json',data:JSON.stringify(result.conditions,null,2)},{name:stem+'.png',data:result.blob}]);
      download(archive,stem+'.zip','application/zip');programStatus(result.report);toast('真实绘制诊断与同帧 PNG 已导出；诊断帧不计入性能统计。');
    }catch(error){$('render-program-status').textContent=error.message;toast(error.message,6500);}
  }
  async function runProgramMatrix(){
    if(programMatrixBusy||matrixPackaging)return;
    if(activeContext!=='city'){toast('请先进入城市，再检查街道与建筑材质。');return;}
    const researchState=researchConsole?.getState();
    if(cityFlight?.needsFixedStep()||controlCapture?.getState().active||researchState?.experiment?.recording||researchState?.experiment?.replaying||researchState?.running||researchState?.status==='running'||meter.capture&&!meter.capture.complete&&!meter.capture.stopped){toast('请先结束当前记录、自动流程或性能采集，再运行切换检查。');return;}
    const initialPhysical=JSON.stringify(sim.exportState());
    const saved={quality,weatherPreset,exposureLock,actualExposure:renderer.toneMappingExposure,exposureTarget,lastExposureSample,paused,menuOpen,cameraMode,fixedCameraId,activeBenchmarkRoute,camera:cameraConditions(),controlsEnabled:controls.enabled,wantedCamera:wantedCamera?.clone(),cameraObstruction:cameraObstruction?structuredClone(cameraObstruction):null,cameraSolveMode};
    const disabled=[...document.querySelectorAll('button,input,select')].filter(e=>!e.matches('[data-language-select],#render-program-cancel')).map(e=>[e,e.disabled]);
    programMatrixBusy=true;matrixAbort=new AbortController();$('render-program-progress').classList.remove('hidden');$('render-program-cancel').disabled=false;disabled.forEach(([e])=>e.disabled=true);const suspendedKeys=[...keys];keys.clear();inputSession.note('diagnostic-input-freeze',{released:suspendedKeys,physicalReferencePreserved:true});closePanels({restoreFocus:false});menuOpen=false;document.body.classList.remove('body-menu');$('game-menu').classList.add('hidden');setPaused(true,{releaseInput:false});controls.enabled=false;
    let result=null;
    try{
      let readinessTimer;
      try{await Promise.race([environment.ready,new Promise((_,reject)=>{readinessTimer=setTimeout(()=>reject(Error(tr('场景资源在 20 秒内未就绪；检查已结束，已采结果保留。'))),20000);matrixAbort.signal.addEventListener('abort',()=>reject(captureCancelled()),{once:true});})]);}
      finally{clearTimeout(readinessTimer);}
      result=await collectProgramMatrix({signal:matrixAbort.signal,metadata:getRuntimeIdentity(),onProgress:state=>{
        const message=tr('真实绘制采集')+' '+state.completed+' / '+state.total+' · '+state.label;
        $('render-program-progress-text').textContent=message;$('render-program-status').textContent=message;
      },captureCase:async item=>{
        const {quality:nextQuality,weather:nextWeather,vantage,label}=item;
        setQuality(nextQuality,{persist:false});setCityWeather(nextWeather,{record:false});
        exposureLock=saved.exposureLock??CITY_WEATHER_PRESETS[nextWeather].exposure;renderer.toneMappingExposure=exposureLock;exposureTarget=exposureLock;syncExposureControls();
        if(vantage==='viaduct'){
          const view=CITY_CAPTURE_CAMERAS.find(v=>v.id==='viaduct');fixedCameraId=view.id;cameraMode='fixed';camera.clearViewOffset();camera.fov=view.fov;camera.position.set(...view.position);camera.up.set(0,1,0);camera.lookAt(new THREE.Vector3(...view.target));camera.updateProjectionMatrix();
        }else{
          fixedCameraId=null;cameraMode='orbit';camera.clearViewOffset();camera.fov=48;camera.up.set(0,1,0);const p=vec(t.position);camera.position.copy(p).add(new THREE.Vector3(6,2.8,7));controls.target.copy(p).add(new THREE.Vector3(0,.05,0));camera.lookAt(controls.target);camera.updateProjectionMatrix();lastPosition.copy(p);
        }
        await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,750);matrixAbort.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(captureCancelled());},{once:true});});
        const requiredCategories=vantage==='viaduct'?['road','mineral-facade','instanced-building']:['vehicle'];
        const ordinary=await requestProgramFrame({label:label+'-paused',requiredCategories});
        try{const exported=await requestProgramFrame({label:label+'-export',png:true,requiredCategories,imageFile:label+'.png',conditionsFile:label+'.json'});return{ordinary,exported};}
        catch(error){error.partialAudit=ordinary.report;error.partialAuditSource='ordinary-paused-frame';throw error;}
      }});
    }catch(error){result={files:[],report:{...getRuntimeIdentity(),schema:'roadster.gpu-switch-matrix-2',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:error.name==='AbortError'?'cancelled':'failed',executionStatus:error.name==='AbortError'?'cancelled':'failed',drawStatus:'incomplete',expectedFrames:14,completedFrames:0,cases:[],failure:{name:error.name,message:String(error.message)},createdAt:new Date().toISOString()}};}
    finally{
      try{if(!graphicsStopped){setQuality(saved.quality,{persist:false});setCityWeather(saved.weatherPreset,{record:false});}}
      catch(error){if(result){result.report.restoreFailure={name:error.name,message:String(error.message)};result.report.status='failed';}}
      finally{
        exposureLock=saved.exposureLock;renderer.toneMappingExposure=saved.actualExposure;exposureTarget=saved.exposureTarget;lastExposureSample=saved.lastExposureSample;fixedCameraId=saved.fixedCameraId;cameraMode=saved.cameraMode;activeBenchmarkRoute=saved.activeBenchmarkRoute;wantedCamera=null;cameraObstruction=null;cameraSolveMode=null;
        camera.position.fromArray(saved.camera.position);camera.quaternion.fromArray(saved.camera.quaternion);camera.up.fromArray(saved.camera.up);camera.fov=saved.camera.fov;camera.clearViewOffset();
        const view=saved.camera.viewOffset;if(view)camera.setViewOffset(view.fullWidth,view.fullHeight,view.offsetX,view.offsetY,view.width,view.height);camera.updateProjectionMatrix();controls.target.fromArray(saved.camera.orbitTarget);orbitCamera.position.fromArray(saved.camera.orbitDesiredPosition||saved.camera.position);orbitCamera.up.copy(camera.up);wantedCamera=saved.wantedCamera?.clone()||orbitCamera.position.clone();cameraObstruction=saved.cameraObstruction;cameraSolveMode=saved.cameraSolveMode;controls.enabled=!graphicsStopped&&saved.controlsEnabled;
        disabled.forEach(([e,value])=>e.disabled=graphicsStopped&&e.hasAttribute('data-requires-graphics')?true:value);programMatrixBusy=false;matrixAbort=null;$('render-program-progress').classList.add('hidden');$('render-program-cancel').disabled=true;syncExposureControls();setPaused(graphicsStopped||saved.paused,{releaseInput:false});
        menuOpen=saved.menuOpen;document.body.classList.toggle('body-menu',saved.menuOpen);$('game-menu').classList.toggle('hidden',!saved.menuOpen);lastTime=performance.now();
      }
    }
    if(result){
      matrixPackaging=true;lastMatrixResult=result;
      result.report.physicsUnchanged=JSON.stringify(sim.exportState())===initialPhysical;
      result.report.shaderFailures=renderPrograms.failures();
      if(!result.report.physicsUnchanged)result.report.status='failed';
      try{
        lastMatrixArchive=await captureArchive(matrixArchiveFiles(result));$('render-program-download').disabled=false;
        download(lastMatrixArchive,'roadster-'+MODEL_VERSION+'-gpu-switch-matrix-'+result.report.executionStatus+'.zip','application/zip');
        const failureMessage=result.report.failure?.message||result.report.restoreFailure?.message;
        const message=tr('采集结束')+' · '+result.report.completedFrames+' / 14 · '+tr(result.report.status==='passed'?'绘制检查通过':result.report.status==='cancelled'?'已取消，已采前缀保留':'未通过，原始失败证据已保留')+(failureMessage?' · '+failureMessage:'');
        $('render-program-status').textContent=message;toast(message,9000);
      }catch(error){$('render-program-status').textContent=tr('采集包编码失败；可导出诊断JSON：')+error.message;lastMatrixArchive=new Blob([JSON.stringify(result.report,null,2)],{type:'application/json'});$('render-program-download').disabled=false;}
      finally{matrixPackaging=false;}
    }
  }
  $('render-program-capture').onclick=()=>exportCurrentProgramFrame();
  $('render-program-driving').onclick=()=>exportCurrentProgramFrame({resume:true});
  $('render-program-matrix').onclick=runProgramMatrix;
  function cancelProgramMatrix(){matrixAbort?.abort();pendingProgramCapture?.reject(captureCancelled());}
  $('render-program-cancel').onclick=cancelProgramMatrix;
  $('render-program-download').onclick=async()=>{if(matrixPackaging)return;if(lastMatrixResult&&lastMatrixArchive?.type!=='application/zip'){try{matrixPackaging=true;lastMatrixArchive=await captureArchive(matrixArchiveFiles(lastMatrixResult));}catch(error){toast(error.message,6500);}finally{matrixPackaging=false;}}if(lastMatrixArchive)download(lastMatrixArchive,'roadster-'+MODEL_VERSION+'-gpu-switch-matrix.'+(lastMatrixArchive.type==='application/zip'?'zip':'json'),lastMatrixArchive.type);};


  let lastTrimReport=null;
  $('trim-inspect').onclick=()=>{
    const trim=sim.getHoldTrimAssessment();lastTrimReport={...getRuntimeIdentity(),simTime:sim.simTime,context:activeContext,physical:sim.exportState(),trim,clearance:sim.getClearanceEstimate({maxDistance:12})};
    const verdict=trim.staticFeasible?tr('存在静态配平解'):tr('当前请求无静态配平解');
    $('trim-status').textContent=verdict+' · '+tr('力残差')+' '+format(trim.forceResidualN,3)+' N · '+tr('力矩残差')+' '+format(trim.torqueResidualNm,3)+' N·m · '+tr('动态恢复未据此判定');
    const reserves=trim.reserve?.bidirectionalTorqueNm;
    $('trim-detail').textContent=(reserves?tr('双向单轴力矩余量')+' X / Y / Z: '+[reserves.x,reserves.y,reserves.z].map(v=>format(v,1)).join(' / ')+' N·m. ':'')+tr('其它五轴保持不变；各轴余量不能同时相加，未含阀门滞后。');
    $('trim-forces').innerHTML=trim.nozzles.map(n=>'<tr><td>'+escapeHtml(n.id)+'</td><td>'+format(n.forceN,1)+'</td><td>'+format(n.maximumN,1)+'</td><td>'+tr(n.disabled?'失效':n.saturated?'饱和':'有余量')+'</td></tr>').join('');$('trim-export').disabled=false;
  };
  $('trim-export').onclick=()=>{if(lastTrimReport)download(JSON.stringify(lastTrimReport,null,2),'roadster-'+MODEL_VERSION+'-static-trim.json','application/json');};
  $('failure-export').onclick=()=>{const failure=sim.getFailureReport();if(!failure){toast('当前场景没有已保留的求解故障。低气源或硬着陆请查看对应任务结果。');return;}download(JSON.stringify({...getRuntimeIdentity(),failure},null,2),'roadster-'+MODEL_VERSION+'-failure-step-'+failure.triggerStep+'.json','application/json');toast('已导出复位前故障与最后有效状态；非有限值使用明确字段保存。');};

  $('road-surface').onchange=event=>{if(protectedLearningState())return;routeExperience?.cancel('research-road-change');sim.setRoadSurface(event.target.value);environment.setRouteSurfaceDescription?.(null);cityMap.setSurfaceRoute?.(null);logEvent('road_surface',{preset:event.target.value});};
  $('wing-mode').onchange=event=>{sim.setWing({mode:event.target.value});logEvent('wing_configuration',{mode:event.target.value,deployment:sim.params.wingDeployment});};
  $('wing-command').oninput=event=>$('wing-command-label').textContent=event.target.value+'%';
  $('wing-command').onchange=event=>{sim.setWing({deployment:+event.target.value/100});logEvent('wing_configuration',{mode:sim.params.wingMode,deployment:+event.target.value/100});};
  const switchState=(id,state)=>{$(id).classList.toggle('on',state);$(id).setAttribute('aria-checked',state);};
  setCityWeather('clear-day',{record:false});
  $('cutaway-btn').onclick=()=>{cutaway=!cutaway;car.setCutaway(cutaway);switchState('cutaway-btn',cutaway);};
  $$('.swatch').forEach(b=>b.onclick=()=>{car.setColor(b.dataset.color);$$('.swatch').forEach(x=>x.classList.toggle('active',x===b));});

  $('sound-btn').onclick=()=>setSoundEnabled(!sound?.enabled);
  $('head-feedback').onchange=event=>{headFeedback.setEnabled(event.target.checked);routeExperience?.setFeedback({head:event.target.checked});};

  $('sound-volume').oninput=e=>{const value=+e.target.value;$('sound-volume-label').textContent=value+'%';sound?.setVolume(value/100);};

  const inputKeys=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyE','KeyQ','KeyZ','KeyB','ShiftLeft','ShiftRight','Digit1','Digit2','Numpad1','Numpad2'];
  const actionKeys=['KeyX','KeyU','KeyG','KeyL','KeyH'];
  function rejectedKey(event,reason){
    if(inputKeys.includes(event.code)||actionKeys.includes(event.code))inputSession.down(event,false,reason);
    if(!event.repeat&&actionKeys.includes(event.code)){
      const reasons={'editing':'正在编辑输入框；点击驾驶画面后再按键','panel-or-menu':'菜单或检视面板正在占用操作；返回驾驶后再按键','graphics-stopped':'三维渲染已停止，操纵未执行','capture-running':'正在采集固定条件画面，暂不执行操纵'};
      inputSession.action(event.code,{accepted:false,reason:reasons[reason]??reason,telemetry:sim.telemetry()});
      operationHud.update(sim.telemetry(),{paused});
    }
  }
  // Freeze user mutations during the explicitly requested comparison; keyup
  // still clears keys. Capture phase also covers other controller listeners.
  window.addEventListener('keydown',e=>{if(programMatrixBusy){rejectedKey(e,'capture-running');if(e.code==='Escape')cancelProgramMatrix();e.preventDefault();e.stopImmediatePropagation();keys.clear();}},true);
  window.addEventListener('keydown',e=>{if(protectedLearningState()&&!['Escape','Tab','KeyC','KeyM','F9'].includes(e.code)&&!e.target?.closest?.('.city-flight-panel,.city-review-deck,.city-practice-ready')){e.preventDefault();e.stopImmediatePropagation();keys.clear();}},true);
  for(const type of ['click','input','change','pointerdown'])document.addEventListener(type,e=>{
    if(protectedLearningState()&&e.target?.closest?.('[data-mode],[data-game-command],[data-touch],#engineering-parameters,.vertical-response-card,#benchmark-route-start,#refill-btn,#suction-btn,#record-btn,#control-capture-start,#control-capture-reset')){e.preventDefault();e.stopImmediatePropagation();keys.clear();}
  },{capture:true});
  for(const event of ['click','input','change','pointerdown','wheel'])document.addEventListener(event,e=>{if(programMatrixBusy&&!e.target?.closest?.('[data-language-select],#render-program-cancel')){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,passive:false});
  window.addEventListener('keydown',e=>{if(graphicsStopped||programMatrixBusy){rejectedKey(e,graphicsStopped?'graphics-stopped':'capture-running');return;}
    if(e.code==='Escape'){e.preventDefault();if(shell.studyOpen)closeStudy();else if(activeDrawer)closePanels();else if(researchConsole?.getState().open)researchConsole.close();else if(menuOpen)closeGameMenu();else openGameMenu();return;}
    const target=e.target;if(target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement||target?.isContentEditable){rejectedKey(e,'editing');return;}
    if(e.code==='Tab'&&activeDrawer){const panel=activeDrawer==='help'?$('help-modal'):$(activeDrawer+'-drawer');const items=[...panel.querySelectorAll('button:not([disabled]),a,input,select')].filter(x=>x.offsetParent!==null);if(items.length){if(e.shiftKey&&document.activeElement===items[0]){items.at(-1).focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){items[0].focus();e.preventDefault();}}return;}
    if(menuOpen&&!activeDrawer&&e.code==='Tab'){const items=[...$('game-menu').querySelectorAll('button,a')].filter(o=>o.offsetParent!==null);if(e.shiftKey&&document.activeElement===items[0]){items.at(-1).focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){items[0].focus();e.preventDefault();}return;}
    if(e.code==='KeyP'&&menuOpen&&!activeDrawer){closeGameMenu();return;}
    if(e.code==='KeyM'&&activeDrawer==='map'){e.preventDefault();closePanels();return;}
    if(protectedLearningState()){
      if(!e.repeat&&e.code==='KeyC'){e.preventDefault();$('camera-btn').click();}
      else if(!e.repeat&&e.code==='KeyM'){e.preventDefault();openPanel('map');}
      else if(!e.repeat&&e.code==='F9'){e.preventDefault();document.body.classList.toggle('body-cinema');}
      return;
    }
    if(menuOpen||activeDrawer||shell.studyOpen){rejectedKey(e,'panel-or-menu');return;}
    if(!e.repeat&&researchConsole?.handleKey(e.code.replace(/^Numpad([3-9])$/,'Digit$1'))){e.preventDefault();return;}
    if(inputKeys.includes(e.code)){e.preventDefault();if(activeDrawer)return;inputSession.down(e,true);if(!e.repeat)takeOver();if(!started)start();return;}
    if(e.repeat)return;
    const actions={KeyJ:()=>radio?.toggle(),KeyK:()=>radio?.next(),KeyG:toggleStabilization,KeyP:()=>{if(paused)closeGameMenu();else openGameMenu();},KeyM:()=>activeContext==='lab'?openResearch('controls'):openPanel('map'),F9:()=>document.body.classList.toggle('body-cinema'),KeyR:()=>{activateScenario(scenario);toast('已复位并暂停。按 P 继续；旧按键与阀门指令已清除。',6500);},KeyT:refill,KeyF:()=>$('suction-btn').click(),KeyH:()=>{setMode(sim.mode==='hover'?'drive':'hover');ensureRunning();},KeyX:()=>maneuver('roll'),KeyU:()=>maneuver('pitch'),KeyL:()=>maneuver('land'),KeyC:()=>$('camera-btn').click(),KeyV:()=>$('forces-btn').click()};
    if(actions[e.code]){e.preventDefault();inputSession.note('keydown',{code:e.code,repeat:!!e.repeat,accepted:true,reason:'action'});actions[e.code]();}
  });
  function releaseDiagnosticInput(reason){const released=[...keys];keys.clear();inputSession.note('diagnostic-input-release',{reason,released,physicalReferencePreserved:true});}
  document.addEventListener('focusin',e=>{if(e.target?.matches?.('input,select,textarea,[contenteditable="true"]')){if(programMatrixBusy)releaseDiagnosticInput('editing-focus');else inputSession.release('editing-focus');}});
  window.addEventListener('keyup',e=>{if(inputKeys.includes(e.code)||['KeyG','KeyH','KeyX','KeyU','KeyP','KeyR'].includes(e.code))inputSession.up(e);});window.addEventListener('blur',()=>{if(programMatrixBusy)releaseDiagnosticInput('window-blur');else inputSession.release('window-blur',{pause:true});if(started&&!paused)setPaused(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden){if(programMatrixBusy)releaseDiagnosticInput('document-hidden');else inputSession.release('document-hidden',{pause:true});setPaused(true);}lastTime=performance.now();});
  $$('[data-touch]').forEach(button=>{const action=ACTIONS.find(a=>a.keys.includes(button.dataset.touch));button.addEventListener('pointerdown',e=>{e.preventDefault();if(!action||protectedLearningState()||graphicsStopped||programMatrixBusy||menuOpen||activeDrawer||shell.studyOpen)return;button.setPointerCapture(e.pointerId);takeOver();ensureRunning();sharedInputs.touch(action.id,true,e.pointerId);});for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,e=>{if(action)sharedInputs.touch(action.id,false,e.pointerId);});});
  renderer.domElement.addEventListener('pointerdown',()=>{if(cameraMode!=='orbit')resetCamera('orbit',false);});
  function inputs(dt){
    const editing=document.activeElement?.matches?.('input,select,textarea,[contenteditable="true"]');
    const pad=editing?null:navigator.getGamepads?.()?.find?.(p=>p?.connected);const i=driverAxes(editing?new Set():keys,pad);
    if(pad&&(Math.abs(i.steer)+Math.abs(i.throttle)+Math.abs(i.lift)+Math.abs(i.roll)+Math.abs(i.pitch)+i.brake+Number(i.boost)>.25))takeOver();
    if(sim.mode==='drive'){const velocity=t.forwardSpeedKmh/3.6;if(i.throttle<-.05){if(velocity>.35){i.brake=Math.max(i.brake,-i.throttle);i.throttle=0;reverseHold=0;}else if(velocity>-.1){reverseHold+=dt;if(reverseHold<.28){i.brake=Math.max(i.brake,-i.throttle);i.throttle=0;}}}else{reverseHold=0;if(i.throttle>.05&&velocity<-.35){i.brake=Math.max(i.brake,i.throttle);i.throttle=0;}}}
    return i;
  }

  // The primary record action creates a replayable experiment, not only a CSV.
  $('record-btn').onclick=()=>{
    try{if(controlCapture?.getState().active){controlCapture.cancel();return;}cityFlight?.cancel('recording_started');if(researchConsole.getExperimentState?.().recording){researchConsole.stopRecording('用户结束','completed');const unsaved=researchConsole.getExperimentState().persistence.sessionOnly;toast(unsaved?'现场实验已结束，但仅本会话 / 未保存。请导出完整结果或整库；旧存档未覆盖。':'现场实验已保存，可查看、导出或按原始条件重放。',unsaved?9000:3800);}
      else{researchConsole.startRecording({name:(activeContext==='lab'?'风场实验室':'城市')+'驾驶 / 飞行记录'});toast('正在记录完整初态、逐物理步输入与事件；按同一按钮结束保存。');}
    }catch(error){toast(error.message,7000);}
  };
  function download(content,name,type='text/plain;charset=utf-8'){return exportFile(content,name,type);}
  const controlPhaseNames={prepare:'预备与稳定',steer:'转向计量',brake:'制动收束',climb:'E 上升',release:'松键制动',descend:'Q 下降与接地',manual:'姿态输入', 'manual-release':'姿态松键',recover:'G 回正'};
  function syncControlCapture(){
    if(!controlCapture)return;
    const state=controlCapture.getState(),result=controlCapture.getResult(),english=getLanguage()==='en';
    const selection=$('control-capture-kind').value||CONTROL_CAPTURE_PROTOCOLS[0].id;
    if($('control-capture-kind').dataset.language!==getLanguage()){
      $('control-capture-kind').innerHTML=CONTROL_CAPTURE_PROTOCOLS.map(d=>'<option value="'+d.id+'">'+escapeHtml(english?d.labelEn:d.label)+'</option>').join('');
      $('control-capture-kind').value=selection;$('control-capture-kind').dataset.language=getLanguage();
    }
    const def=CONTROL_CAPTURE_PROTOCOLS.find(d=>d.id===$('control-capture-kind').value);
    $('control-capture-description').textContent=english?def.descriptionEn:def.description;
    $('control-capture-direction').disabled=state.active||def.type!=='steer'||graphicsStopped;
    $('control-capture-kind').disabled=state.active||graphicsStopped;
    $('control-capture-start').disabled=state.active||graphicsStopped;
    const initial=CONTROL_CAPTURE_STARTS[def.id];$('control-capture-reset').disabled=state.active||!initial||graphicsStopped;
    $('control-capture-reset').textContent=initial?(english?initial.labelEn:initial.label):tr('飞行采集使用当前悬停初态');
    $('control-capture-stop').disabled=!state.active;$('control-capture-export').disabled=!result?.record;
    $('control-capture-chip').classList.toggle('hidden',!state.active);
    const line=state.active?(english?state.labelEn:state.label)+' · '+tr(controlPhaseNames[state.phase]||state.phase)+' · '+format(state.timeS,1)+' s'+(state.targetSpeedKmh?' · '+format(state.actualSpeedKmh,1)+' / '+state.targetSpeedKmh+' km/h':''):state.reason?(english?state.reasonEn:state.reason):tr('尚未开始现场采集。');
    $('control-capture-status').textContent=line;$('control-capture-chip-status').textContent=line;
    if(!result)$('control-capture-metrics').innerHTML='';
    if(result){const m=result.metrics,rows=result.protocolId.startsWith('steer')?[
      ['转向起始 / 结束速度',[m.steerStartSpeedKmh,m.steerEndSpeedKmh].map(v=>format(v,1)).join(' / ')+' km/h'],
      ['转向计量时长',format(m.measuredSteeringDurationS,2)+' s'],['路径半径中位数',format(m.medianPathRadiusM,2)+' m'],['最大侧滑',format(m.peakSlipDeg,2)+'°'],['最大横向加速度',format(m.peakLateralAccelerationMps2,2)+' m/s²'],['转向速度损失',format(m.speedLossKmh,2)+' km/h']
    ]:result.protocolId==='vertical-8-release'?[
      ['松键时垂速',format(m.releaseVerticalMps,2)+' m/s'],['松键后继续上升',format(m.releaseClimbDistanceM,2)+' m'],['松键制动时间',format(m.releaseBrakeTimeS,2)+' s'],['接地喷口推力',format(m.groundThrustN,2)+' N'],['接地流量',format(m.groundMassFlowKgS,3)+' kg/s']
    ]:[['G 回正起始滚转 / 俯仰',[m.recoveryStartRollDeg,m.recoveryStartPitchDeg].map(v=>format(v,1)).join(' / ')+'°'],['G 恢复时间',format(m.recoveryTimeS,2)+' s'],['G 恢复掉高',format(m.recoveryHeightLossM,2)+' m'],['结束倾角',format(m.finalTiltDeg,2)+'°'],['航向误差',format(m.finalHeadingErrorDeg,2)+'°']];
      $('control-capture-metrics').innerHTML=rows.map(([label,value])=>'<div><span>'+escapeHtml(tr(label))+'</span><b>'+escapeHtml(value)+'</b></div>').join('');
    }
  }
  controlCapture=new ControlCaptureProtocol({getSim:()=>sim,startRecording:options=>{cityFlight?.cancel('recording_started');return researchConsole.startRecording(options);},stopRecording:(...args)=>researchConsole.stopRecording(...args),recordEvent:(...args)=>researchConsole.recordEvent(...args),getRecordingState:()=>researchConsole.getExperimentState(),getRecords:()=>researchConsole.getExperimentRecords(),onStatus:()=>syncControlCapture(),onFinish:result=>{
    meter.markEvent('control_capture_end',{protocolId:result.protocolId,status:result.status,recordId:result.recordId});
    if(meter.capture?.metadata?.controlCaptureProtocol)meter.stopCapture('Control capture '+result.status);
    syncControlCapture();toast(getLanguage()==='en'?result.reasonEn:result.reason,6500);
  }});
  $('control-capture-kind').onchange=syncControlCapture;
  $('control-capture-reset').onclick=()=>{
    const initial=CONTROL_CAPTURE_STARTS[$('control-capture-kind').value];if(!initial)return;
    controlCapture.cancel('重置采集初态，已保留原记录。','Capture initial state reset; previous record retained.');
    researchConsole.stopRecording?.('显式复位到静止采集起点','cancelled');researchConsole.cancel('显式复位到采集起点');
    if(activeContext!=='city')switchContext('city',{run:false,openConsole:false});activateScenario('city');
    const body=sim.body;body.position.set(...initial.position);body.quaternion.setFromEuler(0,initial.yaw,0,'YXZ');
    body.previousPosition.copy(body.position);body.interpolatedPosition.copy(body.position);body.previousQuaternion.copy(body.quaternion);body.interpolatedQuaternion.copy(body.quaternion);body.aabbNeedsUpdate=true;
    t=sim.telemetry();resetTrace();resetCamera('chase');car.group.position.copy(vec(t.position));car.group.quaternion.set(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w);car.update(t,0);
    $('control-capture-direction').value=String(initial.steerSign);$('launch-card').classList.add('hidden');if(menuOpen)closeGameMenu();started=true;document.body.classList.add('body-running');setPaused(true);
    meter.markEvent('capture_initial_state',{id:initial.id,position:initial.position,yaw:initial.yaw,initialSpeedMps:0,scope:'Explicit reset before experiment recording.'});
    syncUi(t);openPanel('engineering');engineeringTab('research');toast('已复位到外圈静止起点。点击开始采集后，车辆才真实加速；此复位不属于驾驶或飞行过程。',7500);
  };
  $('control-capture-start').onclick=()=>{
    try{
      if(researchConsole.getState().running||researchConsole.getExperimentState().recording||researchConsole.getExperimentState().replaying)throw Error(tr('请先结束当前流程 / 记录 / 重放。'));
      const id=$('control-capture-kind').value;keys.clear();controlCapture.start(id,{steerSign:Number($('control-capture-direction').value)});
      if(controlCapture.getState().active){meter.startCapture({warmupMs:5000,durationMs:120000,metadata:{...visualConditions(),controlCaptureProtocol:id}});closePanels();ensureRunning();}
    }catch(error){toast(error.message,7000);}syncControlCapture();
  };
  $('control-capture-stop').onclick=()=>controlCapture.cancel();
  $('control-capture-stop-top').onclick=()=>controlCapture.cancel();
  $('control-capture-export').onclick=()=>{const result=controlCapture.getResult();if(result?.record)download(JSON.stringify(result.record,null,2),'roadster-'+result.protocolId+'-'+result.record.id+'.json','application/json');};
  syncControlCapture();
  function captureSample(data){
    researchConsole?.captureSample?.(data);
    samples.push({time:data.simTime,y:data.heightWorld,target:data.targetAltitude,demand:data.desiredWrench[1]/1000,delivered:data.achievedWrench[1]/1000,pressure:data.pressureBar,temperature:data.gasTemperatureK});
    if(samples.length>410)samples.shift();
    if(showTrail){if(trailCount>=trailCapacity){trailData.copyWithin(0,3);trailCount=trailCapacity-1;}trailData[trailCount*3]=data.position.x;trailData[trailCount*3+1]=data.position.y;trailData[trailCount*3+2]=data.position.z;trailCount++;trailGeometry.attributes.position.needsUpdate=true;trailGeometry.setDrawRange(0,trailCount);}
  }
  $('csv-btn').onclick=()=>openResearch('experiments');
  $('export-model-btn').onclick=async()=>{
    const button=$('export-model-btn');button.disabled=true;button.textContent='正在导出几何与材质…';
    try{const {GLTFExporter}=await import('./vendor/addons/exporters/GLTFExporter.js');const pose=car.group.position.clone(),q=car.group.quaternion.clone();const wasCutaway=cutaway;car.setQuality?.('ultra');car.setCutaway(false);car.group.position.set(0,0,0);car.group.quaternion.identity();const model=car.group.clone(true);model.visible=true;car.group.position.copy(pose);car.group.quaternion.copy(q);car.setQuality?.(quality);car.setCutaway(wasCutaway);model.traverse(o=>{if(o.isPoints||/plume|mist|exhaust particles|cold-gas particle|cold-gas condensation core/i.test(o.name))o.visible=false;if(o.isLine&&o.material?.isLineBasicMaterial)o.material=new THREE.MeshBasicMaterial({color:o.material.color,transparent:o.material.transparent,opacity:o.material.opacity,vertexColors:o.material.vertexColors});});const result=await new GLTFExporter().parseAsync(model,{binary:true,onlyVisible:true});download(result,'roadster-2026-study.glb','model/gltf-binary');toast('模型已导出。车辆外形是独立重建，非原厂 CAD。');}catch(err){toast('模型导出失败：'+err.message,6500);}finally{button.disabled=false;button.textContent='导出当前车辆模型 · GLB ↓';}
  };

  const detailFields=[['质量','mass','kg',1],['车身纵向速度','forwardSpeedKmh','km/h',1],['俯仰','pitchDeg','°',1],['滚转','rollDeg','°',1],['非重力比力','gLoad','g',2],['密封效率','sealQuality','%',0],['离下表面高度','altitude','m',2],['剩余空气质量','gasMass','kg',1],['目标重心高度','targetAltitude','m',2],['气体温度','gasTemperatureK','K',1],['升力上限 / 重力','thrustMargin','倍',2],['分配残差（归一化）','allocationError','',3],['累计电能¹','energyUsedKWh','kWh',3],['车载累计耗气','onboardGasConsumedKg','kg',2],['外部累计供气','externalGasSuppliedKg','kg',2],['实际轴功率','driveAccounting.mechanicalPowerW','kW',1,.001],['电驱输入功率','driveAccounting.electricalPowerW','kW',1,.001],['质心侧偏','bodySlipDeg','°',2],['路轮转角','steeringCentreDeg','°',2],['瞬时耗气','massFlowKgS','kg/s',2],['有效排速','effectiveExhaustVelocity','m/s',1],['累计喷流冲量','deliveredImpulseNs','N·s',0],['本状态悬停估时','hoverSecondsEstimate','s',2],['保持位置误差','holdPositionError','m',3],['保持姿态误差','holdAttitudeErrorDeg','°',2],['保持实际速度','holdSpeed','m/s',3],['保持分配残差','holdWrenchResidual','',3]];
  $('details-grid').innerHTML=detailFields.map(([label,key,unit,digits])=>`<div><span>${label}</span><b id="detail-${key}">—</b><small>${unit}</small></div>`).join('');
  $('nozzle-bars').innerHTML=t.nozzles.map((n,i)=>`<div class="nozzle-bar"><span>${n.id}</span><div class="bar-track"><div id="nozzle-bar-${i}" class="bar-fill"></div></div><b id="nozzle-label-${i}">0.0 kN</b></div>`).join('');
  const note=document.createElement('p');note.className='field-help';note.textContent='¹ 使用电能账本作供电截止判据，未模拟电压与热特性。喷口总推力是标量和；主轴指令与实际输出见曲线。';$('details-grid').after(note);
  function drawChart(){
    const canvas=$('telemetry-chart'),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,left=45,right=w-15,top=18,bottom=h-28;c.clearRect(0,0,w,h);c.fillStyle='#0f201f';c.fillRect(0,0,w,h);
    const s=samples.slice(-400);const high=Math.max(5,...s.map(x=>Math.max(x.y,x.target)))*1.12;const low=Math.min(0,...s.map(x=>Math.min(x.y,x.target)))-.2;
    c.font='15px Consolas, monospace';c.textAlign='right';c.strokeStyle='#284133';c.fillStyle='#759781';c.lineWidth=1;
    for(let i=0;i<5;i++){const y=top+(bottom-top)*i/4;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.fillText(format(high-(high-low)*i/4,1),left-9,y+5);}
    if(s.length<2)return;const end=s.at(-1).time,start=end-20;const px=time=>left+(time-start)/20*(right-left),py=v=>bottom-(v-low)/(high-low)*(bottom-top);
    c.save();c.beginPath();c.rect(left,top,right-left,bottom-top);c.clip();for(const [field,color,dash]of [['target','#c4a675',[7,7]],['y','#c1e6b0',[]]]){c.strokeStyle=color;c.lineWidth=2;c.setLineDash(dash);c.beginPath();s.forEach((v,i)=>i?c.lineTo(px(v.time),py(v[field])):c.moveTo(px(v.time),py(v[field])));c.stroke();}c.restore();c.setLineDash([]);c.textAlign='left';c.fillText(format(Math.max(0,start),1)+' s',left,h-6);c.textAlign='right';c.fillText(format(end,1)+' s',right,h-6);
  }
  function drawSignals(id,fields,limits){
    const canvas=$(id),c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,left=52,right=w-52,top=18,bottom=h-30,series=samples.slice(-400);c.clearRect(0,0,w,h);c.fillStyle='#0f201f';c.fillRect(0,0,w,h);c.font='15px Consolas,monospace';
    const maximum=limits||Math.max(5,...series.flatMap(sample=>fields.map(([field])=>sample[field])))*1.15;
    c.strokeStyle='#284133';c.lineWidth=1;
    for(let i=0;i<=4;i++){const y=top+(bottom-top)*i/4;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();fields.forEach(([field,color],j)=>{if(j&&!Array.isArray(maximum))return;c.fillStyle=color;c.textAlign=j?'left':'right';c.fillText(format((Array.isArray(maximum)?maximum[j]:maximum)*(1-i/4),0),j?right+9:left-9,y+5);});}
    if(series.length<2)return;const end=series.at(-1).time,start=end-20;c.save();c.beginPath();c.rect(left,top,right-left,bottom-top);c.clip();
    fields.forEach(([field,color],j)=>{c.strokeStyle=color;c.lineWidth=2;c.setLineDash(j?[7,5]:[]);c.beginPath();series.forEach((sample,i)=>{const x=left+(sample.time-start)/20*(right-left),y=bottom-sample[field]/(Array.isArray(maximum)?maximum[j]:maximum)*(bottom-top);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();});c.restore();c.setLineDash([]);c.fillStyle='#759781';c.textAlign='left';c.fillText(format(Math.max(0,start),1)+' s',left,h-6);c.textAlign='right';c.fillText(format(end,1)+' s',right,h-6);
  }
  function syncUi(data){
    syncVerticalResponse(data);syncControlCapture();operationHud.update(data,{paused});
    const groundSpeed=Math.hypot(data.velocity.x,data.velocity.z)*3.6;
    $('speed-value').textContent=format(groundSpeed,0);$('altitude-value').textContent=format(data.heightWorld,2);$('vertical-value').textContent=format(data.verticalSpeed,2);$('thrust-value').textContent=format(data.thrustN/1000,1);$('suction-value').textContent=format(data.suctionN/1000,1);$('pressure-value').textContent=format(data.pressureBar,0);$('contacts-value').textContent=data.contactCount+' / 4';
    $('gas-meter').style.width=clamp(data.gasFraction*100,0,100)+'%';$('gas-meter').style.background=data.gasFraction<.2?'#d9a576':'#bddda7';$('thrust-meter').style.width=clamp(data.thrustN/100000*100,0,100)+'%';
    $('drive-state').textContent=data.status;$('supply-label').textContent=data.supplyMode==='bench'?'CONSTANT-PRESSURE BENCH':'FINITE SUPPLY';$('time-value').textContent='T+ '+data.simTime.toFixed(1).padStart(5,'0')+' s';
    $('horizon-disk').setAttribute('transform',`rotate(${-data.rollDeg} 50 50) translate(0 ${clamp(data.pitchDeg*.75,-50,50)})`);$('attitude-label').textContent='ROLL '+format(data.rollDeg,1)+'°';
    $$('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===data.mode));$('suction-btn').setAttribute('aria-pressed',data.suctionEnabled);$('supply-mode').value=data.supplyMode;$('gas-model').value=sim.params.gasModel;$('nozzle-model').value=sim.params.nozzleModel;$('steering-assist').checked=sim.params.steeringAssist;$('traction-assist').checked=sim.params.tractionAssist;$('abs-enabled').checked=sim.params.absEnabled;$('road-surface').value=sim.params.roadSurface;$('wing-mode').value=sim.params.wingMode;
    const mappedSurface=sim.getRouteSurface?.();$('road-surface-status').textContent=mappedSurface?(getLanguage()==='en'?'Mapped route active: ':'区域路线图生效：')+(getLanguage()==='en'?mappedSurface.descriptor.labelEn:mappedSurface.descriptor.label)+(getLanguage()==='en'?'. The selector above is the outside-map fallback; changing it exits the map.':'。上方下拉显示区域外后备工况；更改将退出路线地图。'):(getLanguage()==='en'?'Legacy physical road preset; presentation weather is independent.':'旧物理路面预设；观赏天气与物理工况分开。');
    if(document.activeElement!==$('wing-command'))$('wing-command').value=Math.round(sim.params.wingDeployment*100);$('wing-command-label').textContent=Math.round(sim.params.wingDeployment*100)+'%';$('wing-command').disabled=sim.params.wingMode!=='fixed'||graphicsStopped;
    const wing=data.wing;$('wing-feedback').textContent=wing?'实际展开 '+format(wing.deployment*100,0)+'% / 指令 '+format(wing.command*100,0)+'% · 阻力 '+format(wing.dragN,0)+' N · 下压力 '+format(wing.downforceN,0)+' N':'—';
    $('wheel-feedback').innerHTML=data.wheelStates.map(w=>'<tr><td>'+escapeHtml(w.id)+'</td><td>'+format(w.angularVelocityRadS*60/(2*Math.PI),0)+'</td><td>'+(w.slipRatio===null?'离地':format(w.slipRatio*100,1)+'%')+'</td><td>'+([w.absActive?'ABS调压':'',w.tcsActive?'TCS限矩':''].filter(Boolean).join(' / ')||(w.contact?'滚动':'离地'))+'</td></tr>').join('');
    $('weather-preset').disabled=activeContext!=='city'||graphicsStopped;syncExposureControls();

    const authority=data.controlAuthority;
    if(authority&&activeDrawer==='about'){
      const torque=authority.positiveTorqueUpperNm;
      $('thrust-authority').textContent='质量 '+format(authority.massKg,0)+' kg · 重力 '+format(authority.weightN/1000,1)+' kN\n'+'主升力上限 '+format(authority.liftMaxN/1000,1)+' kN · 水平悬停推重比 '+format(authority.hoverThrustRatio,2)+'\n'+'当前姿态竖直力上界 '+format(authority.verticalForceUpperBoundN/1000,1)+' kN · 裕量 '+format(authority.verticalForceReserveUpperBoundN/1000,1)+' kN\n'+'单轴正向力矩上界 X/Y/Z '+[torque.x,torque.y,torque.z].map(v=>format(v/1000,1)).join(' / ')+' kN·m\n'+'当前姿态可配平：'+(authority.currentPoseTrimFeasible?'是':'否')+' · 水平目标可配平：'+(authority.levelTargetTrimFeasible?'是':'否');
    }
    $('target-height-label').textContent=format(data.targetAltitude,1)+' m';if(document.activeElement!==$('target-height'))$('target-height').value=data.targetAltitude;
    if(activeDrawer==='engineering'){
      for(const [label,key,unit,digits,factor=1]of detailFields){const value=key.split('.').reduce((object,part)=>object?.[part],data);$('detail-'+key).textContent=key==='hoverSecondsEstimate'&&data.supplyMode==='bench'?'∞':format(key==='sealQuality'?value*100:value*factor,digits);}
      data.nozzles.forEach((n,i)=>{$('nozzle-bar-'+i).style.width=clamp(n.force/Math.max(1,n.maxForce)*100,0,100)+'%';$('nozzle-label-'+i).textContent=format(n.force/1000,1)+' kN';});drawChart();drawSignals('force-chart',[['delivered','#c1e6b0'],['demand','#c4a675']]);drawSignals('gas-chart',[['pressure','#c1e6b0'],['temperature','#c4a675']],[sim.params.initialPressureBar,sim.params.gasTemperatureK]);
    }
    $('app').dataset.simState=JSON.stringify({time:+data.simTime.toFixed(3),context:activeContext,programRunning:researchConsole?.getState().running===true,scenario:data.scenario,mode:data.mode,paused,pressure:+data.pressureBar.toFixed(2),height:+data.heightWorld.toFixed(3),gas:+data.gasMass.toFixed(3),phase:data.maneuver?.phase||null,contacts:data.contactCount,recorded:researchConsole.getExperimentState?.().stepCount||0,plumes:exhaust.particles.length,x:+data.position.x.toFixed(2),z:+data.position.z.toFixed(2),menu:menuOpen,heading:+data.headingDeg.toFixed(3),pitch:+data.pitchDeg.toFixed(3),roll:+data.rollDeg.toFixed(3),angularSpeed:+Math.hypot(data.angularVelocity.x,data.angularVelocity.y,data.angularVelocity.z).toFixed(4),input:data.driverInput,stabilization:{mode:data.stabilizationMode,armed:data.airStabilization,active:data.stabilizationActive,holdActive:data.holdActive,holdFeasible:data.holdFeasible,positionError:data.holdPositionError,attitudeErrorDeg:data.holdAttitudeErrorDeg},dynamics:{beta:+data.bodySlipDeg.toFixed(3),steer:+data.steeringCentreDeg.toFixed(3),flow:+data.massFlowKgS.toFixed(3),exhaust:+data.effectiveExhaustVelocity.toFixed(1),hoverSeconds:+data.hoverSecondsEstimate.toFixed(2),nozzleModel:data.nozzleModel},jets:data.nozzles.slice(0,4).map(n=>Math.round(n.command)),audio:sound?{enabled:sound.enabled,volume:sound.volume,state:sound.context.state}:null});
    const message=data.fault?data.fault:data.levelRecovery?.status==='limited'?'回正受限 · 可用推力或力矩不足，姿态仍按真实受力恢复':data.levelRecovery?.status==='recovering'?'正在恢复水平姿态 · 保持切换时航向，推力与力矩有界':data.stabilizationMode==='hold'&&data.holdActive&&data.holdFeasible===false?'当前姿态超出喷口可持续配平能力 · 控制器已饱和，车辆仍按真实受力运动':data.pressureLimited&&(data.mode!=='drive'||data.stabilizationActive)?'储气压力不足 · 推力正在降低，按 T 进行试验补气':data.maneuver?data.status:data.supplyMode==='bench'&&(data.mode!=='drive'||data.stabilizationActive)?'外部持续供气 · 恒压试验工况':'';
    $('status-banner').textContent=message;$('status-banner').classList.toggle('hidden',!message||!started);
    syncDrivingHud(data);cityFlight?.update();routeExperience?.update();
    $('performance-label').textContent=graphicsStopped?'三维未运行 · 无帧率数据':displayFps+' FPS · '+renderProfile.label;syncPerformanceUi();const experiment=researchConsole.getExperimentState?.()||{};$('record-btn').textContent=experiment.recording?'■ 停止并保存实验':'● 记录这次驾驶 / 飞行';$('record-btn').classList.toggle('recording',!!experiment.recording);$('record-status').textContent=experiment.recording?'完整实验记录中 · '+format(experiment.durationS||0,1)+' s · 输入与干预事件按物理步保存。':'现场实验记录包含完整初态与身份。导出范围在研究控制台中选择：单记录 CSV 或完整 JSON 库。';
  }
  function updateForces(data){
    if(!showForces)return;const p=vec(data.position),q=new THREE.Quaternion(data.quaternion.x,data.quaternion.y,data.quaternion.z,data.quaternion.w);
    const length=f=>Math.max(.02,Math.log1p(Math.max(0,f)/2000)*1.2);
    gravityArrow.position.copy(p);gravityArrow.setDirection(new THREE.Vector3(0,-1,0));gravityArrow.setLength(length(data.mass*sim.params.gravity),.22,.12);
    suctionArrow.visible=data.suctionN>20;suctionArrow.position.copy(p);suctionArrow.setDirection(new THREE.Vector3(0,-1,0).applyQuaternion(q));suctionArrow.setLength(length(data.suctionN),.24,.12);
    data.nozzles.forEach((n,i)=>{const a=jetArrows[i];a.visible=n.force>50;a.position.copy(vec(n.position).applyQuaternion(q).add(p));a.setDirection(vec(n.direction).applyQuaternion(q));a.setLength(length(n.force),.2,.09);});
    data.wheelStates.forEach((w,i)=>{const a=contactArrows[i];a.visible=w.contact&&w.normalLoadN>40;a.position.copy(w.contactPointWorld?vec(w.contactPointWorld):vec(w.position).applyQuaternion(q).add(p));a.setDirection(w.contactNormalWorld?vec(w.contactNormalWorld):new THREE.Vector3(0,1,0).applyQuaternion(q));a.setLength(length(w.normalLoadN),.18,.07);});
  }
  function updateCamera(dt,data){
    const p=vec(data.position),q=new THREE.Quaternion(data.quaternion.x,data.quaternion.y,data.quaternion.z,data.quaternion.w),heading=data.headingDeg*Math.PI/180;
    car.group.visible=true;car.setInteriorView(cameraMode==='cockpit'&&!programMatrixBusy);if(cameraMode!=='cockpit')headFeedback.reset();
    if(programMatrixBusy){camera.clearViewOffset();lastPosition.copy(p);return;}
    if(cameraSolveMode!==cameraMode){wantedCamera=camera.position.clone();if(cameraMode==='orbit'){orbitCamera.position.copy(camera.position);orbitCamera.up.copy(camera.up);}cameraObstruction=null;cameraSolveMode=cameraMode;}
    if(menuOpen&&cameraMode==='orbit')camera.setViewOffset(innerWidth,innerHeight,-innerWidth*.18,0,innerWidth,innerHeight);
    else if(shell.studyOpen&&innerWidth>900)camera.setViewOffset(innerWidth,innerHeight,Math.min(920,innerWidth*.72)*.5,0,innerWidth,innerHeight);
    else if(researchConsole?.getState().open&&innerWidth>900)camera.setViewOffset(innerWidth,innerHeight,Math.min(460,innerWidth*.39)*.5,0,innerWidth,innerHeight);
    else if(camera.view?.enabled)camera.clearViewOffset();
    if(cameraMode==='orbit'){
      const shift=p.clone().sub(lastPosition);orbitCamera.position.add(shift);orbitCamera.fov=camera.fov;orbitCamera.aspect=camera.aspect;orbitCamera.updateProjectionMatrix();controls.target.copy(p).add(new THREE.Vector3(0,.05,0));controls.update();wantedCamera=orbitCamera.position.clone();camera.position.copy(wantedCamera);camera.quaternion.copy(orbitCamera.quaternion);
    }else if(cameraMode==='fixed'){const view=CITY_CAPTURE_CAMERAS.find(item=>item.id===fixedCameraId);if(view){camera.clearViewOffset();camera.position.set(...view.position);camera.up.set(0,1,0);camera.lookAt(new THREE.Vector3(...view.target));}}else if(cameraMode==='chase'){
      const speed=Math.hypot(data.velocity.x,data.velocity.z);const offset=new THREE.Vector3(-Math.sin(heading)*(6.7+Math.min(speed*.045,2.5)),2.2,-Math.cos(heading)*(6.7+Math.min(speed*.045,2.5)));
      if(data.heightWorld>6&&data.contactCount>1&&Math.abs(data.rollDeg)>100)offset.y=-2.4;
      const next=advanceChasePosition(wantedCamera||camera.position,p,lastPosition,offset,dt);camera.position.set(next.x,next.y,next.z);wantedCamera=camera.position.clone();const look=p.clone().add(new THREE.Vector3(Math.sin(heading)*1.2,.4,Math.cos(heading)*1.2));camera.up.set(0,1,0);camera.lookAt(look);
    }else if(cameraMode==='cockpit'){
      const head=headFeedback.update(data,{active:learningSessionMode!=='review',paused});const shift=new THREE.Vector3(head.x,head.y,head.z);camera.position.copy(new THREE.Vector3().fromArray(VEHICLE_DRIVER_VIEW.position).add(shift).applyQuaternion(q).add(p));camera.up.copy(new THREE.Vector3(0,1,0).applyQuaternion(q));camera.lookAt(new THREE.Vector3().fromArray(VEHICLE_DRIVER_VIEW.target).add(shift).applyQuaternion(q).add(p));
    }else{camera.up.set(0,0,1);camera.position.lerp(p.clone().add(new THREE.Vector3(0,37,0)),1-Math.exp(-dt*5));camera.lookAt(p);}
    if(['chase','orbit'].includes(cameraMode)){
      const target=cameraMode==='orbit'?controls.target:p.clone().add(new THREE.Vector3(Math.sin(heading)*1.2,.4,Math.cos(heading)*1.2));
      cameraObstruction=resolveCameraObstruction({target,desired:wantedCamera,geometry:sim.getWorldGeometry(),previous:cameraObstruction?.state,dt,near:camera.near,fov:camera.fov,aspect:camera.aspect,viewOffsetFraction:camera.view?.enabled?camera.view.offsetX/camera.view.fullWidth:0});
      camera.position.set(cameraObstruction.position.x,cameraObstruction.position.y,cameraObstruction.position.z);camera.lookAt(target);
    }else cameraObstruction=null;
    if(cameraMode==='orbit')camera.up.set(0,1,0);lastPosition.copy(p);
  }
  onLanguageChange(()=>{syncUi(sim.telemetry());syncPerformanceUi();cityMap.update(sim.telemetry());});
  function syncPerformanceUi(){
    if(graphicsStopped){$('render-stat-chip').textContent='三维未运行 · 无帧率数据';return;}
    const report=meter.snapshot(meter.frames.filter(frame=>frame.active===!(paused||menuOpen))),cpu=report.cpuSubmission,physics=cpu.physics?.medianMs,gpu=report.gpuMs;
    $('render-stat-chip').textContent=((paused||menuOpen)?tr('暂停预览')+' · ':'')+(report.medianFps?Math.round(report.medianFps):'—')+' FPS · '+renderProfile.label+' · '+renderSize.width+'×'+renderSize.height;
    if(activeDrawer!=='engineering'||$('engineering-render').classList.contains('hidden'))return;
    $('perf-fps').textContent=report.medianFps?Math.round(report.medianFps)+' FPS':'正在采样';
    $('perf-p95').textContent=format(report.frameP95Ms,1)+' ms';$('perf-p99').textContent=format(report.frameP99Ms,1)+' ms';$('perf-long-frames').textContent=report.longFrames.over50Ms+' / '+report.samples;$('perf-resolution').textContent=renderSize.width+' × '+renderSize.height;
    $('perf-gpu').textContent=gpu==null?(report.gpuTimerSupported?'等待有效 GPU 计时':'GPU 计时不可用'):format(gpu,1)+' ms';$('perf-physics').textContent=format(physics,2)+' ms';
    $('perf-draws').textContent=(report.lastFrame?.calls??'—')+' / '+Math.round((report.lastFrame?.triangles||0)/1000)+'k';
    const names={physics:'物理积分',sceneUpdate:'场景更新',reflections:'车辆 / 湿路反射',sceneAndShadows:'主视景 + 阴影',contactAO:'接触遮蔽',bloom:'高光泛光',toneMapping:'色调映射',antialias:'抗锯齿',total:'帧内总 CPU'};
    $('perf-breakdown').textContent=Object.entries(cpu).filter(([name])=>names[name]).map(([name,v])=>names[name]+' '+format(v.medianMs,2)+' ms').join(' · ');
    const cap=meter.capture;$('performance-status').textContent=cap?(cap.complete?'稳态采样完成，可导出预热、稳态和设备信息。':cap.stopped?'采样已停止，保留已测数据与停止原因。':cap.warmupElapsedMs<cap.warmupMs?'活动预热 '+(cap.warmupElapsedMs/1000).toFixed(1)+' / '+cap.warmupMs/1000+' s':'稳态采样 '+(cap.elapsedMs/1000).toFixed(1)+' / '+cap.durationMs/1000+' s；菜单暂停不计入。'):'帧时间、CPU 提交与 GPU 抽样分开记录；实际渲染分辨率变化会写入报告。';
    const lightBudget=environment.stats?.renderBudget?.practicalLights,wetBudget=environment.stats?.renderBudget?.wetRoadReflection;
    const shadowDescription=weatherPreset==='wet-night'?(lightBudget?lightBudget.streetSpots+' 街灯 + '+lightBudget.headlightSpots+' 车灯 / 运动逐显示帧，静止 '+lightBudget.shadowHz+' Hz':'有限近灯阴影')+' · '+(wetBudget?.enabled?wetBudget.width+'×'+wetBudget.height+' 湿路反射 ≤'+wetBudget.maximumHz+' Hz':'无湿路附加反射'):renderProfile.shadowCascades+' 层 '+renderProfile.shadowSize+' 太阳阴影';
    $('perf-budget').textContent=activeContext==='lab'?'室内单主灯阴影 · 静态室内环境反射 · 无屏幕遮蔽 · '+Math.round(governor.scale*100)+'% 渲染倍率':shadowDescription+' · '+(renderProfile.probeSize?renderProfile.probeSize+' 车辆局部反射':'静态环境反射')+' · '+(renderProfile.aoScale?'接触遮蔽':'无屏幕遮蔽')+' · '+Math.round(governor.scale*100)+'% 渲染倍率';
  }
  function resize(){
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
    renderSize=sizeRenderPipeline(renderer,composer,innerWidth,innerHeight,devicePixelRatio||1,quality,governor.scale);
    environment.resize?.();
    if(ssao.enabled)ssao.setSize(Math.max(1,Math.round(renderSize.width*renderProfile.aoScale)),Math.max(1,Math.round(renderSize.height*renderProfile.aoScale)));
    fxaa.material.uniforms.resolution.value.set(1/renderSize.width,1/renderSize.height);
    exhaust.setDepth(ssao.normalRenderTarget.depthTexture,renderSize.width,renderSize.height,camera.near,camera.far,ssao.enabled);
    renderer.shadowMap.needsUpdate=true;
  }
  shell.attachLive({getSim:()=>sim,getContext:()=>activeContext,getSceneConfiguration:sceneConfiguration,toast,logEvent,switchContext,
    canUseLiveResearch:()=>learningSessionMode==='live',
    beforeResearch:()=>{cityFlight?.cancel('research_control');inputSession.release('research-open');closePanels();if(menuOpen)closeGameMenu();},
    // Program shortcuts and Run buttons cross the same ownership boundary
    // before any research recorder or controller is created.
    beforeResearchRun:()=>{if(learningSessionMode!=='live')throw Error('请先返回原现场，再开始研究流程。');routeExperience?.cancel('research-control-start');cityFlight?.cancel('research_control');inputSession.release('research-control-start');},
    beforeStudy:()=>{cityFlight?.cancel('inspection_open');studyWasRunning=started&&!paused;closePanels();if(menuOpen)closeGameMenu();setPaused(true);keys.clear();},
    afterStudy:()=>{if(studyWasRunning&&!menuOpen&&shell.graphics.status==='available')setPaused(false);studyWasRunning=false;viewport.focus({preventScroll:true});},
    onStart:()=>{keys.clear();closePanels();if(menuOpen)closeGameMenu();else ensureRunning();},
    onCancel:reason=>logEvent('program_cancel',{reason}),
    suspendGraphics:()=>{cityFlight?.cancel('graphics_context_lost');if(programMatrixBusy)releaseDiagnosticInput('graphics-stopped');else inputSession.release('graphics-stopped',{pause:true});matrixAbort?.abort();pendingProgramCapture?.reject?.(Error('WebGL context stopped'));pendingProgramCapture=null;controlCapture?.cancel('图形运行中断；已保留采集区间。','Graphics stopped; captured interval retained.');graphicsStopped=true;captureImageRequested=false;captureBundleRequested=false;setPaused(true);keys.clear();sound?.silence();meter.endGpu();},
    restoreExperiment:({snapshot,context,sceneConfiguration:recordedScene,allowVersionMismatch=false})=>{
      if(learningSessionMode!=='live')throw Error('请先返回原现场，再重放现场实验记录。');
      controlCapture?.cancel('进入记录重放，操纵采集结束。','Record replay started; pilot capture ended.');
      const name=context==='lab'||snapshot.worldType==='windlab'?'lab':'city';
      switchContext(name,{run:false,openConsole:false});
      sim.importState(snapshot,{allowVersionMismatch});environment.setRouteSurfaceDescription?.(sim.getRouteSurface?.()?.descriptor??null);cityMap.setSurfaceRoute?.(sim.getRouteSurface?.()?.descriptor??null);headFeedback.reset();t=sim.telemetry();scenario=sim.scenario;contexts[name].scenario=scenario;
      resetTrace();pendingManeuver=null;keys.clear();reverseHold=0;
      car.group.position.copy(vec(t.position));car.group.quaternion.set(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w);car.update(t,0);
      resetCamera(name==='lab'?'orbit':'chase');
      if(recordedScene){
        if(['auto','off','drl','low-beam'].includes(recordedScene.lampSelection)){lampSelection=recordedScene.lampSelection;$('driving-lamp-mode').value=lampSelection;}
        if(RENDER_PROFILES[recordedScene.quality]&&quality!==recordedScene.quality)setQuality(recordedScene.quality);
        if(name==='city'&&CITY_WEATHER_PRESETS[recordedScene.weatherPreset])setCityWeather(recordedScene.weatherPreset,{record:false});
        activeBenchmarkRoute=name==='city'&&[CITY_BENCHMARK_ROUTE.id,sim.getRouteSurface?.()?.descriptor?.id].includes(recordedScene.routeId)?recordedScene.routeId:null;
        exposureLock=Number.isFinite(recordedScene.exposureLock)?clamp(recordedScene.exposureLock,.25,3):null;syncExposureControls();
        if(typeof recordedScene.autoExposure==='boolean')$('auto-exposure').checked=recordedScene.autoExposure;
        if(Number.isFinite(recordedScene.exposure)&&recordedScene.exposure>0)renderer.toneMappingExposure=recordedScene.exposure;
        const view=recordedScene.camera,vector=(value,length)=>Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);
        if(view&&['orbit','chase','cockpit','top','fixed'].includes(view.mode)&&vector(view.position,3)&&vector(view.quaternion,4)){
          resetCamera(view.mode==='fixed'?'chase':view.mode);cameraMode=view.mode;fixedCameraId=CITY_CAPTURE_CAMERAS.some(item=>item.id===view.id)?view.id:null;
          controls.enabled=cameraMode==='orbit';camera.clearViewOffset();camera.position.fromArray(view.position);camera.quaternion.fromArray(view.quaternion).normalize();
          if(vector(view.up,3))camera.up.fromArray(view.up);if(vector(view.target,3))controls.target.fromArray(view.target);orbitCamera.position.fromArray(vector(view.orbitDesiredPosition,3)?view.orbitDesiredPosition:view.position);orbitCamera.up.copy(camera.up);wantedCamera=orbitCamera.position.clone();cameraSolveMode=cameraMode;
          if(Number.isFinite(view.fov)&&view.fov>=15&&view.fov<=100)camera.fov=view.fov;camera.updateProjectionMatrix();
          $('benchmark-camera').value=fixedCameraId||'drive';$('camera-name').textContent=fixedCameraId?CITY_CAPTURE_CAMERAS.find(item=>item.id===fixedCameraId).name:({orbit:'环绕视角',chase:'跟随视角',cockpit:'驾驶员视角',top:'俯视测量',fixed:'记录机位'}[cameraMode]);
        }
      }
      lastTime=performance.now();syncUi(t);
      return sim;
    },
  });
  window.addEventListener('resize',resize);setQuality(quality);activateScenario('free');
  // Research references are local; links open only when explicitly selected.
  fetch('./research.json').then(r=>r.json()).then(research=>{
    $('research-content').innerHTML=[['官方明确的功能',research.confirmed],['本模型的研究假设',research.assumptions]].map(([title,list])=>'<h3>'+escapeHtml(title)+'</h3><ul class="evidence-list">'+list.map(s=>'<li>'+escapeHtml(s)+'</li>').join('')+'</ul>').join('');
    $('source-links').innerHTML=research.sources.map(s=>`<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(s.title)}<small>${escapeHtml(s.type)}</small></span><span>↗</span></a>`).join('')+'<a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/" target="_blank" rel="noopener noreferrer"><span>NASA Glenn · 推力与气体质量流率<small>推进力学参考</small></span><span>↗</span></a><a href="https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky" target="_blank" rel="noopener noreferrer"><span>Poly Haven · Kloofendal 48° Partly Cloudy<small>HDR 环境 · CC0</small></span><span>↗</span></a>';
  }).catch(()=>{$('research-content').textContent='参考资料暂未载入。可直接查看 Tesla 官方 Roadster 产品页与本项目物理说明。';});
  setCityWeather(weatherPreset,{record:false});
  activateScenario('city');
  await Promise.race([environment.ready,new Promise(resolve=>setTimeout(resolve,10000))]);
  $('loading-message').textContent='准备车辆材质、灯光与实时渲染…';
  exhaust.mesh.geometry.instanceCount=1;
  if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
  updateEnvironment(performance.now(),t,0);environment.wantsShadowUpdate?.(performance.now()/1000,t.position);renderer.shadowMap.needsUpdate=true;composer.render();exhaust.mesh.geometry.instanceCount=0;shell.graphicsReady();window.roadsterReady=true;
  $('loading-screen').style.opacity='0';setTimeout(()=>$('loading-screen').style.display='none',700);
  $('sim-state').textContent='系统就绪';$('solver-label').textContent='6DOF · 120 Hz / 遥测 20 Hz';syncUi(t);
  // A small read-only diagnostics surface makes the numerical state inspectable.
  window.roadsterLab={getControlCapture:()=>controlCapture.getState(),getState:()=>({...sim.telemetry(),paused,quality,cameraMode,context:activeContext,graphics:shell.graphics,research:researchConsole.getState()}),getParameters:()=>({...sim.params}),getInputTimeline:()=>inputSession.export(getRuntimeIdentity()),getExportState:()=>getExportState(),getLandingReserve:()=>operationHud.snapshot(),getCityNavigation:()=>cityMap.navigation,getCityFlight:()=>cityFlight.getState(),getCityFlightRecords:()=>cityFlight.getRecords(),getRouteExperience:()=>routeExperience.getState(),getPreparedSurface:()=>sim.getRouteSurface?.(),getDriverFeedback:()=>headFeedback.getState(),getLearningSession:()=>({mode:learningSessionMode,prepared:learningPrepared,hasLiveReturn:!!learningSaved}),getResourceHistory:()=>structuredClone(resourceHistory),getGeometry:()=>sim.getWorldGeometry(),getPerformance:()=>meter.export({version:MODEL_VERSION,quality,profile:renderProfile,resolution:renderSize,scene:environment.stats}),version:MODEL_VERSION};
  let lastRendered=0,captureNotice=false;
  function frame(now){
    if(graphicsStopped)return;requestAnimationFrame(frame);if(document.hidden){lastTime=now;return;}
    // The paused frame is already frozen. Leave rAF and DOM cancellation live,
    // but do not enqueue another city render while its PNG readback is pending.
    // Active-driving exports still advance the original simulation and view.
    if(paused&&pendingProgramCapture?.inFlight){lastTime=now;return;}
    if(paused&&now-lastRendered<1000/30)return;
    const wallDelta=Math.max(0,(now-lastTime)/1000),dt=Math.min(wallDelta,.08);lastTime=now;lastRendered=now;
    try{
      if(now>=nextResourceSample){resourceHistory.push({at:new Date().toISOString(),quality,weatherPreset,context:activeContext,diagnostic:programMatrixBusy,memory:{...renderer.info.memory},programs:renderer.info.programs?.length??null});if(resourceHistory.length>120)resourceHistory.shift();nextResourceSample=now+2000;}
      renderer.info.reset();meter.begin(now,wallDelta*1000);let physicalDelta=0;
      meter.measure('physics',()=>{
        if(!paused&&!programMatrixBusy){const input=inputs(dt*scale),before=sim.simTime;let fixedInput=input;t=sim.step(dt*scale,(_simTime,fixedDt)=>{const captureInput=controlCapture.beforeStep(fixedDt,input);fixedInput=researchConsole.beforeFixedStep?researchConsole.beforeFixedStep(fixedDt,captureInput):researchConsole.stepInput(fixedDt,captureInput);return cityFlight.beforeStep(fixedInput);},captureSample,researchConsole.needsFixedStep?.()||controlCapture.getState().active||inputSession.tracing||cityFlight.needsFixedStep()||routeExperience?.needsFixedStep()?(data,appliedInput,fixedDt)=>{if(inputSession.tracing)inputSession.step(data,appliedInput);researchConsole.afterFixedStep(data,appliedInput,fixedDt);controlCapture.afterStep(data,fixedDt);cityFlight.afterStep(data,appliedInput,fixedDt);routeExperience?.afterStep(data,fixedDt);}:undefined);physicalDelta=Math.max(0,t.simTime-before);if(t.fault){researchConsole.stopRecording?.(t.fault,'failed');researchConsole.cancel?.(t.fault,'failed');exhaust.reset();setPaused(true);toast(t.fault+'。已暂停，请重置并检查参数。',9000);}}
        else t=sim.telemetry();
      });
      meter.measure('sceneUpdate',()=>{
        const alpha=paused?1:sim.interpolationAlpha;
        const renderPosition=vec(sim.body.previousPosition).lerp(vec(t.position),alpha),renderQuaternion=new THREE.Quaternion().copy(sim.body.previousQuaternion).slerp(new THREE.Quaternion(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w),alpha);
        const display={...t,position:renderPosition,quaternion:renderQuaternion};
        car.group.position.copy(renderPosition);car.group.quaternion.copy(renderQuaternion);car.update({...display,brake:sim._lastInput?.brake||0},physicalDelta);
        updateCamera(dt,display);camera.updateMatrixWorld();car.setViewBudget?.(camera,renderSize.height,{inspection:cameraMode==='orbit'});
        // Meter the viewing camera: an orbit camera outside a covered street
        // must not inherit the vehicle's deep-shade exposure and bleach the city.
        if(now-lastExposureSample>350){const p=camera.position,sunVisible=activeContext==='city'?!sim.traceSurface({x:p.x,y:p.y,z:p.z},{x:SUN_DIRECTION[0],y:SUN_DIRECTION[1],z:SUN_DIRECTION[2]},1800):true;exposureTarget=exposureLock??($('auto-exposure').checked?environment.exposureAt(p,sunVisible):(activeContext==='city'?CITY_WEATHER_PRESETS[weatherPreset].exposure:environment.exposureAt(p)));lastExposureSample=now;}
        renderer.toneMappingExposure+=(exposureTarget-renderer.toneMappingExposure)*(1-Math.exp(-dt/1.1));
        updateForces(display);updateEnvironment(now,display,physicalDelta);researchConsole.update(t,physicalDelta);
        const refreshShadows=environment.wantsShadowUpdate?.(now/1000,display.position,display)===true;renderer.shadowMap.needsUpdate=renderer.shadowMap.needsUpdate||refreshShadows;
        const mistLight=environment.particleLighting();exhaust.setLighting(mistLight.ambient,mistLight.lights);exhaust.update(display,physicalDelta,camera);
        targetGroup.visible=showForces&&(t.mode==='hover'||t.stabilizationMode==='hold');const target=t.holdPositionTarget;if(t.stabilizationMode==='hold'&&target)targetGroup.position.set(target.x,target.y,target.z);else targetGroup.position.set(t.position.x,t.targetAltitude,t.position.z);
      });
      const programCapture=pendingProgramCapture&&!pendingProgramCapture.inFlight?pendingProgramCapture:null,checkPrograms=!!programCapture||captureImageRequested||captureBundleRequested;
      if(programCapture)programCapture.mark('draw-start');
      if(checkPrograms)renderPrograms.beginFrame(programConditions(programCapture?.label||'ordinary-image-export'));
      const diagnosticFrame=checkPrograms||programMatrixBusy||previousFrameWasDiagnostic||inputSession.tracing;
      if(!diagnosticFrame)meter.beginGpu();
      meter.measure('reflections',()=>renderPrograms.withPass('reflections',()=>environment.updateReflections(now/1000,t.position,[car.group,exhaust.mesh,forcesRoot,trail,targetGroup])));
      if(ssao.enabled){ssao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);ssao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);}
      if(paused)sound?.silence();else sound?.update(t);composer.render();
      if(checkPrograms){
        const report=renderPrograms.endFrame({requiredCategories:programCapture?.requiredCategories||[]});programStatus(report);
        if(programCapture){programCapture.report=report;programCapture.mark('draw-end');programCapture.inFlight=true;const conditions=JSON.parse(JSON.stringify({...visualConditions(),capture:{captureId:programCapture.captureId,imageFile:programCapture.imageFile,conditionsFile:programCapture.conditionsFile,source:'actual-webgl-composer-frame',capturedAt:new Date().toISOString(),frameNumber:meter.frameNumber,renderTimeS:now/1000,pixelsEdited:false},programAudit:report}));
          programCapture.mark('conditions-frozen');
          if(programCapture.png){
            programCapture.mark('toBlob-call');
            renderer.domElement.toBlob(blob=>{programCapture.mark('callback');blob?programCapture.resolve({report,conditions,blob}):programCapture.reject(Error(tr('当前浏览器未能导出画面。')));},'image/png');
            programCapture.mark('toBlob-return');
          }else programCapture.resolve({report,conditions});
        }
      }
      if(captureImageRequested||captureBundleRequested){
        const bundle=captureBundleRequested;captureImageRequested=false;captureBundleRequested=false;
        const stem='roadster-'+MODEL_VERSION+'-'+(fixedCameraId||cameraMode)+'-'+weatherPreset;
        // Freeze conditions on this rendered frame, before toBlob's async callback.
        const metadata=JSON.parse(JSON.stringify({...visualConditions(),capture:{capturedAt:new Date().toISOString(),frameNumber:meter.frameNumber,renderTimeS:now/1000,source:'actual-webgl-composer-frame',postprocessAA:renderProfile.antialias,fxaaRevision:'explicit-lod0-single-return-310',imageFile:stem+'.png',conditionsFile:stem+'.json',pixelsEdited:false}}));
        renderer.domElement.toBlob(async blob=>{
          if(!blob){toast('当前浏览器未能导出画面。');return;}
          try{
            if(bundle){
              const archive=await captureArchive([{name:stem+'.png',data:blob},{name:stem+'.json',data:JSON.stringify(metadata,null,2)},
                {name:'READ-ME.txt',data:'Actual WebGL frame and its same-frame conditions. PNG pixels have not been edited.\nMatch viewport, drawing buffer, quality, camera, physical state and exposure before A/B comparison.\nA paused preview is not a driving FPS measurement. New lighting preset comparisons must be labelled separately.\n'}]);
              download(archive,stem+'.zip','application/zip');toast('真实画面与同帧条件已合并导出；暂停帧不代表驾驶性能。');
            }else download(blob,stem+'.png','image/png');
          }catch(error){toast('画面采集包导出失败：'+error.message,6500);}
        },'image/png');
      }
      const sample=meter.end({active:!paused&&!menuOpen&&!diagnosticFrame,diagnosticFrame,resolution:{width:renderSize.width,height:renderSize.height},physicsSteps:Math.round(physicalDelta*120),quality,context:activeContext,weatherPreset:activeContext==='city'?weatherPreset:null,cameraMode,simTime:t.simTime,vehiclePosition:{...t.position},cameraPosition:{x:camera.position.x,y:camera.position.y,z:camera.position.z}});
      previousFrameWasDiagnostic=checkPrograms||programMatrixBusy;
      if(governor.update(wallDelta*1000,{active:!paused&&!menuOpen&&!diagnosticFrame,cpuMs:sample.cpu.total,gpuMs:meter.gpuMs}))resize();
      if(meter.capture?.complete&&!captureNotice){toast('性能采样完成。预热、稳态、长帧和 GPU 计时可用性已分别记录，可导出报告。');captureNotice=true;}if(meter.capture&&!meter.capture.complete)captureNotice=false;
      uiTimer+=dt;frames++;fpsTime+=wallDelta;if(fpsTime>.7){displayFps=Math.round(frames/fpsTime);fpsTime=0;frames=0;}
      if(uiTimer>.14){syncUi(t);$('performance-label').dataset.renderState=JSON.stringify({fps:displayFps,calls:sample.calls,triangles:sample.triangles,resolution:renderSize,programs:renderer.info.programs.length,exposure:+renderer.toneMappingExposure.toFixed(3),scene:environment.stats});uiTimer=0;}
    }catch(error){if(renderPrograms.active){const abortedReport=renderPrograms.endFrame({aborted:error.message});if(pendingProgramCapture)pendingProgramCapture.report=abortedReport;}if(pendingProgramCapture){clearTimeout(pendingProgramCapture.timer);pendingProgramCapture.reject(error);pendingProgramCapture=null;}meter.endGpu();shell.graphicsUnavailable('三维运行已暂停：'+error.message);console.error(error);}
  }
  if(new URLSearchParams(location.search).get('view')==='lab')switchContext('lab');
  lastTime=performance.now();requestAnimationFrame(frame);
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();shell.graphicsUnavailable('浏览器已通知 WebGL 上下文丢失。当前三维试验已暂停并保留记录；数值研究与导出仍可使用。',{contextLost:true});});
}

