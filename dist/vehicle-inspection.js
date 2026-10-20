import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/addons/controls/OrbitControls.js';
import {HDRLoader} from './vendor/addons/loaders/HDRLoader.js';
import {createRoadster,VEHICLE_GEOMETRY} from './vehicle.js';
import {RoadsterSim} from './physics.js';
import {MODEL_VERSION} from './vehicle-models.js';
import {MODEL_BUILD_ID} from './model-build.js';
import {VEHICLE_INSPECTION_RIG as RIG} from './visual-presets.js';
import {captureInspectionPair} from './inspection-capture.js';
import {captureArchive} from './capture-archive.js';
import {createRenderProgramDiagnostics} from './render-program-diagnostics.js';
import './i18n-render-313-en.js';
import {captureInspectionDiagnostics} from './inspection-diagnostics-capture.js';
import {attachReceiverPlaneShadows,receiverPlaneShadowEnabled,RECEIVER_PLANE_SHADOW_MODEL} from './receiver-plane-shadows.js';
import {createVehicleSurfaceDiagnostics,VEHICLE_SURFACE_MODES} from './vehicle-surface-diagnostics.js';
import {entries as diagnosticEntries} from './i18n-visual-311-en.js';
import {t,registerTranslations,observeTranslations,bindLanguageSelectors,onLanguageChange} from './i18n.js';
import {entries,patterns} from './i18n-visual-en.js';
import {entries as surfaceEntries,patterns as surfacePatterns} from './i18n-vehicle-310-en.js';
registerTranslations(diagnosticEntries);registerTranslations(entries,patterns);registerTranslations(surfaceEntries,surfacePatterns);observeTranslations(document.body);bindLanguageSelectors(document);
const translateTitle=()=>{document.title=t('Roadster · 50 mm 曲面检视');};translateTitle();onLanguageChange(translateTitle);

const $=id=>document.getElementById(id),stage=$('inspection-stage');
const CURRENT_RELEASE=MODEL_VERSION.replace(/\.0$/,'');
const inspectionParams=new URLSearchParams(location.search);
const BASELINES=Object.freeze({
  '3.9':{version:'3.9.0',commit:'6083bbf0e01f4eef5447f2c1b951d8b41e691f46',sourceSHA256:'cb37f8d9ca5b502831f1ea0f4a3642c3c3a4436976a75e489d65a412a6f1d05a',load:()=>import('./vehicle-reference-3.9.js')},
  '3.8':{version:'3.8.0',commit:'a25b228a6d56f358cba24106ce897e1cb5c99bc1',sourceSHA256:'3f532f879f1a86af187a7f89a8f860de61175bdef27d78a783e2ba7fb62763f7',load:()=>import('./vehicle-reference-3.8.js')}
});
const baselineCache=new Map(),baselineLoading=new Map();let baselineVersion='3.9';
let renderer,renderPrograms,scene,camera,controls,car,surfaceDiagnostics,inspectionKeyLight,baseline=null,baselineGeometry=null,baselineActive=false,cut=false,sealed=false,sweep=false,lightMode='studio',viewId='front-quarter',lastTime=performance.now(),frameId,captureBusy=false;
const reference=$('reference-links');RIG.sources.forEach(source=>{const a=document.createElement('a');a.href=source.url;a.target='_blank';a.rel='noopener';a.textContent=source.id+' ↗';reference.append(a);});
const sim=new RoadsterSim();sim.setWing?.({mode:'fixed',deployment:0});
function fail(message){$('inspection-failure').hidden=false;$('inspection-failure').textContent=message;stage.dataset.graphics='unavailable';for(const b of document.querySelectorAll('button,input,select'))if(!b.matches('[data-language-select]'))b.disabled=true;$('capture-meta').disabled=false;$('ready').textContent='三维不可用；官方参考和状态 JSON 仍可查看。';}
function selected(id,group){for(const name of group)$(name).classList.toggle('selected',name===id);}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function graphicsDevice(){
  if(!renderer)return null;
  const gl=renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
  return{vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedVendor:extension?gl.getParameter(extension.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null,webglVersion:gl.getParameter(gl.VERSION),contextAttributes:gl.getContextAttributes()};
}
function metadata({referenceActive=baselineActive,association=null}={}){
  const original=BASELINES[baselineVersion],size=stage.getBoundingClientRect();
  return{comparisonProtocol:{schema:'roadster.surface-comparison',version:2,baselineCommit:original.commit,baselineModelVersion:original.version,rig:RIG.id,scope:'Frozen geometry/material code with the same current renderer, lighting and articulated state; no previous renderer claim.'},format:'roadster-surface-capture-2',createdAt:new Date().toISOString(),
    recordScope:association?'rendered-frame-conditions':'current-state-unbound',captureId:association?.captureId??null,frameAssociation:association,
    model:referenceActive?baselineVersion+' geometry with current renderer/lighting':'current',modelVersion:referenceActive?original.version:MODEL_VERSION,
    buildId:referenceActive?null:MODEL_BUILD_ID,rendererBuildId:MODEL_BUILD_ID,geometrySourceSHA256:referenceActive?original.sourceSHA256:null,baselineCommit:referenceActive?original.commit:null,
    comparisonBaseline:{version:original.version,commit:original.commit,geometrySourceSHA256:original.sourceSHA256},rig:RIG.id,viewId,focalLengthMm:RIG.focalLengthMm,filmGaugeMm:RIG.filmGaugeMm,
    camera:camera?{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray(),fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,projectionMatrix:camera.projectionMatrix.toArray()}:null,
    lighting:lightMode,lightingRevision:'3.9 light rig retained; studio .72 / daylight .68, exposure .92; 3.11 receiver-plane shadow comparison',toneMappingExposure:renderer?.toneMappingExposure??null,
    environmentIntensity:scene?.environmentIntensity??null,resolution:renderer?renderer.getDrawingBufferSize(new THREE.Vector2()).toArray():null,cssStageSize:[size.width,size.height],pixelRatio:renderer?.getPixelRatio()??null,graphicsDevice:graphicsDevice(),
    surfaceDiagnostics:{...surfaceDiagnostics?.snapshot(),receiverPlaneCorrection:receiverPlaneShadowEnabled.value>.5,shadowComparison:RECEIVER_PLANE_SHADOW_MODEL,shadowMapSize:inspectionKeyLight?.shadow.mapSize.toArray()??null,shadowNormalBiasM:inspectionKeyLight?.shadow.normalBias??null,shadowDepthBias:inspectionKeyLight?.shadow.bias??null},
    quality:$('inspection-quality').value,simTime:sim.simTime,steer:Number($('steer').value),suspensionLength:Number($('suspension').value),wing:sim.telemetry().wing||null,cutaway:cut,seal:sealed,suspensionSweep:sweep,
    lastProgramAudit:renderPrograms?.snapshot()??null,materialState:{currentGlassOpacity:car?.materials.glass.opacity??null,referenceGlassOpacity:baseline?.materials.glass.opacity??null},geometry:referenceActive?baselineGeometry:VEHICLE_GEOMETRY,renderCost:(referenceActive?baseline:car)?.getRenderCost(),userAgent:navigator.userAgent,graphicsAvailable:stage.dataset.graphics==='ready',
    limits:(association?'These conditions were frozen beside the named rendered frame; keep the PNG and companion JSON together. ':'This is the state at this JSON export click. It is not associated with any previous PNG and does not attest that a framebuffer was captured. ')+
      'PNG exports require live WebGL. No automatic quality/FPS verdict. Dimensions, lens match and internal equipment are engineering assumptions. Frozen references retain original geometry/material code under the same current light rig; they are not old renderer pipelines.'};
}
$('capture-meta').onclick=()=>download(new Blob([JSON.stringify(metadata(),null,2)],{type:'application/json'}),'roadster-surface-current-state-'+viewId+'-'+(baselineActive?baselineVersion:'current')+'.json');
try{
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.outputColorSpace=THREE.SRGBColorSpace;stage.append(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color(0x111820);surfaceDiagnostics=createVehicleSurfaceDiagnostics(scene);
  camera=new THREE.PerspectiveCamera(35,1,.04,100);camera.filmGauge=RIG.filmGaugeMm;renderPrograms=createRenderProgramDiagnostics(renderer,{primaryCamera:camera});
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.addEventListener('start',()=>{viewId='user-orbit';$('view-caption').textContent='自由环视 / 50 mm';});controls.minDistance=1.2;controls.maxDistance=14;controls.maxPolarAngle=Math.PI*.97;
  const hemi=new THREE.HemisphereLight(0xd8e0e8,0x2b2928,.16);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xfff8ee,2.3);sun.position.set(-3.5,6,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-4;sun.shadow.camera.right=4;sun.shadow.camera.top=4;sun.shadow.camera.bottom=-4;sun.shadow.camera.near=.1;sun.shadow.camera.far=20;sun.shadow.normalBias=.0025;sun.shadow.bias=-.00008;sun.shadow.radius=2;scene.add(sun);inspectionKeyLight=sun;
  const fill=new THREE.DirectionalLight(0xc4d4e4,.32);fill.position.set(4,3,-3);scene.add(fill);
  const underLight=new THREE.DirectionalLight(0xc9d7e0,2.8);underLight.position.set(1,-4,3);underLight.visible=false;scene.add(underLight);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0x252d32,roughness:.57,metalness:0}));floor.rotation.x=-Math.PI/2;floor.position.y=RIG.groundY;floor.receiveShadow=true;scene.add(floor);
  function prepareShadowMaterials(model){model.group.userData.renderAuditGroup='vehicle';model.group.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.isMeshStandardMaterial)attachReceiverPlaneShadows(m);});}
  car=createRoadster({quality:'ultra'});prepareShadowMaterials(car);attachReceiverPlaneShadows(floor.material);scene.add(car.group);
  const allModels=()=>[car,...[...baselineCache.values()].map(e=>e.model)];
  function applySurfaceMode(){surfaceDiagnostics.setMode($('surface-mode').value);receiverPlaneShadowEnabled.value=$('shadow-correction').checked?1:0;surfaceDiagnostics.apply(allModels());}
  $('surface-mode').onchange=applySurfaceMode;$('shadow-correction').onchange=applySurfaceMode;
  const studio=new THREE.Scene();studio.background=new THREE.Color(0x11151c);
  function softbox(w,h,p,r,intensity){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(intensity,intensity,intensity),side:THREE.DoubleSide}));m.position.set(...p);m.rotation.set(...r);studio.add(m);}
  softbox(.62,8,[-1.6,4,0],[Math.PI/2,0,0],5);softbox(.42,8,[1.6,3.8,0],[Math.PI/2,0,0],4);
  softbox(6,2.8,[-4,1.7,0],[0,Math.PI/2,0],2.6);softbox(6,2.8,[4,1.7,0],[0,-Math.PI/2,0],2.3);
  softbox(4,.55,[0,2.4,-4],[0,0,0],3.2);softbox(3,.60,[0,1.5,4],[0,Math.PI,0],2.7);
  const pmrem=new THREE.PMREMGenerator(renderer),studioTarget=pmrem.fromScene(studio,.028),studioEnvironment=studioTarget.texture;
  scene.environment=studioEnvironment;scene.environmentIntensity=.72;let daylightEnvironment=null;
  new HDRLoader().load('./assets/environment.hdr',t=>{t.mapping=THREE.EquirectangularReflectionMapping;daylightEnvironment=pmrem.fromEquirectangular(t).texture;t.dispose();pmrem.dispose();$('ready').textContent='光棚已就绪 · 固定机位可导出当前设备真实帧。';},undefined,()=>{pmrem.dispose();$('ready').textContent='条灯光棚已就绪；自然光纹理未载入。';});
  function view(id){const preset=RIG.cameras.find(c=>c.id===id);if(!preset)return;viewId=id;controls.enableDamping=false;controls.update();camera.position.set(...preset.position);controls.target.set(...preset.target);controls.update();controls.enableDamping=true;camera.setFocalLength(RIG.focalLengthMm);floor.visible=true;underLight.visible=false;$('view-caption').textContent=preset.name+' / 50 mm';for(const b of $('inspection-cameras').children)b.classList.toggle('selected',b.dataset.view===id);}
  for(const preset of RIG.cameras){const button=document.createElement('button');button.textContent=preset.name;button.dataset.view=preset.id;button.onclick=()=>view(preset.id);$('inspection-cameras').append(button);}
  function refreshModel(){
    car.group.visible=!baselineActive;
    for(const entry of baselineCache.values())entry.model.group.visible=baselineActive&&entry.model===baseline;
    selected(baselineActive?'model-baseline':'model-current',['model-current','model-baseline']);
    $('model-current').textContent='当前 '+CURRENT_RELEASE+' 外观';$('model-baseline').textContent=baselineVersion+' 外观基线';
    $('model-caption').textContent=baselineActive?'BASELINE / '+baselineVersion:'CURRENT / '+CURRENT_RELEASE;
    $('capture-pair').textContent='导出同机位 '+baselineVersion+' / '+CURRENT_RELEASE+' 对照 PNG';
    $('wing-deployment').disabled=captureBusy;
  }
  async function loadBaseline(version=baselineVersion){
    if(!baselineCache.has(version)){
      if(!baselineLoading.has(version))baselineLoading.set(version,(async()=>{
        $('baseline-note').textContent='正在按需载入 '+version+' 原始外观…';
        const old=await BASELINES[version].load(),model=old.createRoadster({quality:$('inspection-quality').value});
        model.setCutaway(cut);prepareShadowMaterials(model);model.group.visible=false;scene.add(model.group);baselineCache.set(version,{model,geometry:old.VEHICLE_GEOMETRY});
      })());
      try{await baselineLoading.get(version);}finally{baselineLoading.delete(version);}
    }
    const entry=baselineCache.get(version);
    if(version===baselineVersion){baseline=entry.model;baselineGeometry=entry.geometry;$('baseline-note').textContent='基线：'+BASELINES[version].commit.slice(0,7)+' · 使用当前渲染器 / 光棚 / 机位。';}
    return entry.model;
  }
  $('model-current').onclick=()=>{if(captureBusy)return;baselineActive=false;refreshModel();};
  $('model-baseline').onclick=async()=>{if(captureBusy)return;const requested=baselineVersion;try{await loadBaseline(requested);if(captureBusy||requested!==baselineVersion)return;baselineActive=true;refreshModel();}catch(error){$('baseline-note').textContent='基线载入失败：'+error.message;}};
  $('reference-version').onchange=async()=>{
    if(captureBusy){$('reference-version').value=baselineVersion;return;}
    baselineVersion=$('reference-version').value;
    if(baselineActive){try{await loadBaseline();}catch(error){baselineActive=false;$('baseline-note').textContent='基线载入失败：'+error.message;}}
    else{const entry=baselineCache.get(baselineVersion);baseline=entry?.model||null;baselineGeometry=entry?.geometry||null;}
    refreshModel();
  };
  refreshModel();
  $('under').onclick=()=>{viewId='under';camera.position.set(3,-3.5,5);controls.target.set(0,-.2,0);controls.update();floor.visible=false;underLight.visible=true;$('view-caption').textContent='底盘运动包络 / 50 mm';};
  $('cutaway').onclick=()=>{cut=!cut;car.setCutaway(cut);baselineCache.forEach(({model})=>model.setCutaway(cut));$('cutaway').textContent=cut?'剖视开启':'剖视关闭';};
  $('seal').onclick=()=>{sealed=!sealed;$('seal').textContent=sealed?'收回近地密封裙':'展开近地密封裙';};
  $('sweep').onclick=()=>{sweep=!sweep;$('sweep').classList.toggle('selected',sweep);};
  $('inspection-quality').onchange=()=>{surfaceDiagnostics.restore();car.setQuality($('inspection-quality').value);baselineCache.forEach(({model})=>model.setQuality($('inspection-quality').value));};
  $('wing-deployment').oninput=()=>sim.setWing?.({mode:'fixed',deployment:Number($('wing-deployment').value)});
  $('studio-light').onclick=()=>{surfaceDiagnostics.restore();lightMode='studio';scene.environment=studioEnvironment;scene.environmentIntensity=.72;selected('studio-light',['studio-light','day-light']);};
  $('day-light').onclick=()=>{if(!daylightEnvironment){$('ready').textContent='自然光纹理尚未载入，条灯光棚仍可使用。';return;}surfaceDiagnostics.restore();lightMode='daylight';scene.environment=daylightEnvironment;scene.environmentIntensity=.68;selected('day-light',['studio-light','day-light']);};
  let resizePending=false;
  function resize(){if(captureBusy){resizePending=true;return;}resizePending=false;const rect=stage.getBoundingClientRect();camera.aspect=Math.max(1,rect.width)/Math.max(1,rect.height);camera.setFocalLength(RIG.focalLengthMm);camera.updateProjectionMatrix();renderer.setSize(rect.width,rect.height);}
  addEventListener('resize',resize);resize();view(viewId);stage.dataset.graphics='ready';

  function auditInspectionFrame(label){
    renderPrograms.beginFrame({label,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,quality:$('inspection-quality').value,lighting:lightMode,referenceActive:baselineActive,viewId,simTime:sim.simTime,resolution:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()});
    try{renderer.render(scene,camera);return renderPrograms.endFrame({requiredCategories:['vehicle']});}
    catch(error){if(renderPrograms.active)renderPrograms.endFrame({aborted:error.message});throw error;}
  }
  $('inspection-program-audit').onclick=async()=>{
    if(captureBusy||stage.dataset.graphics!=='ready')return;
    if(!daylightEnvironment){$('ready').textContent='自然光纹理尚未载入；请稍后再运行完整材质检查。';return;}
    const originalSurfaceMode=surfaceDiagnostics.mode;
    // Save the authored environment underneath a no-environment override,
    // then exercise the actual PBR materials instead of a diagnostic proxy.
    surfaceDiagnostics.restore();
    const saved={quality:$('inspection-quality').value,lightMode,environment:scene.environment,intensity:scene.environmentIntensity,baselineActive,controlsEnabled:controls.enabled,surfaceMode:originalSurfaceMode};
    const disabled=[...document.querySelectorAll('button,input,select')].filter(e=>!e.matches('[data-language-select]')).map(e=>[e,e.disabled]);
    captureBusy=true;controls.enabled=false;disabled.forEach(([e])=>e.disabled=true);$('ready').textContent='正在冻结检视状态并检查实际材质绘制…';
    const frames=[],files=[];
    try{
      surfaceDiagnostics.setMode('surface');$('surface-mode').value='surface';baselineActive=false;refreshModel();
      for(const [index,quality] of ['high','ultra','balanced','high','ultra'].entries())for(const lighting of ['studio','daylight']){
        if(stage.dataset.graphics!=='ready')throw Error(t('当前没有可用的 WebGL 绘制。'));
        surfaceDiagnostics.restore();
        $('inspection-quality').value=quality;car.setQuality(quality);lightMode=lighting;scene.environment=lighting==='studio'?studioEnvironment:daylightEnvironment;scene.environmentIntensity=lighting==='studio'?.72:.68;
        surfaceDiagnostics.apply(allModels());const label=String(index+1).padStart(2,'0')+'-'+quality+'-'+lighting;
        const normal=auditInspectionFrame(label+'-normal'),exported=auditInspectionFrame(label+'-export');
        const conditions=JSON.parse(JSON.stringify({...metadata({association:{captureId:label,source:'actual-inspection-webgl-frame',imageFile:label+'.png',conditionsFile:label+'.json',pixelsEdited:false}}),programAudit:exported}));
        const blob=await new Promise((resolve,reject)=>renderer.domElement.toBlob(b=>b?resolve(b):reject(Error(t('此浏览器未提供 PNG 帧。'))),'image/png'));
        frames.push({case:label,normal,export:exported,imageFile:label+'.png',conditionsFile:label+'.json'});files.push({name:label+'.png',data:blob},{name:label+'.json',data:JSON.stringify(conditions,null,2)});
      }
      const report={schema:'roadster.inspection-gpu-matrix-1',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,createdAt:new Date().toISOString(),status:frames.every(f=>f.normal.status==='passed'&&f.export.status==='passed')?'passed':'failed',cases:frames,shaderFailures:renderPrograms.failures(),scope:'Actual inspection renderer high/ultra and repeated quality/light changes with complete original PNGs. Frozen physical state. Link/draw acceptance is distinct from visual quality and driving performance.'};
      files.unshift({name:'inspection-gpu-matrix.json',data:JSON.stringify(report,null,2)});download(await captureArchive(files),'roadster-'+MODEL_VERSION+'-inspection-gpu-matrix.zip');$('ready').textContent=report.status==='passed'?'本次实际链接与绘制检查通过；画质与路线性能仍需另验。':'检测到材质链接、资源预算或绘制失败；请导出诊断。';
    }catch(error){$('ready').textContent='对照采集失败：'+error.message;}
    finally{
      surfaceDiagnostics.restore();$('inspection-quality').value=saved.quality;car.setQuality(saved.quality);lightMode=saved.lightMode;scene.environment=saved.environment;scene.environmentIntensity=saved.intensity;baselineActive=saved.baselineActive;refreshModel();surfaceDiagnostics.setMode(saved.surfaceMode);$('surface-mode').value=saved.surfaceMode;surfaceDiagnostics.apply(allModels());captureBusy=false;lastTime=performance.now();
      if(stage.dataset.graphics==='ready'){controls.enabled=saved.controlsEnabled;disabled.forEach(([e,value])=>e.disabled=value);if(resizePending)resize();renderer.render(scene,camera);}
      else controls.enabled=false;
    }
  };

  $('capture-frame').onclick=()=>{surfaceDiagnostics.apply(allModels());auditInspectionFrame('single-image-export');renderer.domElement.toBlob(blob=>{if(blob)download(blob,'roadster-'+(baselineActive?baselineVersion:CURRENT_RELEASE)+'-'+viewId+'-'+lightMode+'-'+surfaceDiagnostics.mode+'.png');else $('ready').textContent='此浏览器未提供 PNG 帧。';},'image/png');};
  async function capturePair(archive){
    if(captureBusy||stage.dataset.graphics!=='ready')return;
    const originalActive=baselineActive,originalControlsEnabled=controls.enabled,disabledStates=[...document.querySelectorAll('button,input,select')].map(element=>[element,element.disabled]);
    captureBusy=true;controls.enabled=false;disabledStates.forEach(([element])=>element.disabled=true);$('ready').textContent='正在锁定机位与物理状态，采集同条件双帧…';
    try{
      await loadBaseline();surfaceDiagnostics.restore();
      const state=sim.telemetry(),length=Number($('suspension').value),steer=Number($('steer').value);
      for(const model of [car,baseline]){model.setCutaway(cut);model.group.position.y=length-.287;model.update({wheelStates:model.wheels.map(w=>({suspensionLength:length,steer:w.z>0?steer:0,rotation:0})),contactCount:4,suctionEnabled:sealed,sealQuality:sealed?1:0,wing:state.wing},0);model.setViewBudget(camera,renderer.getDrawingBufferSize(new THREE.Vector2()).y,{inspection:true});}
      camera.updateMatrixWorld();surfaceDiagnostics.apply(allModels());
      const result=await captureInspectionPair({renderer,archive,baselineVersion,currentVersion:CURRENT_RELEASE,canvasFactory:()=>document.createElement('canvas'),
        render:role=>{if(renderer.getContext().isContextLost())throw new Error(t('采集时 WebGL 上下文不可用。'));car.group.visible=role==='current';baselineCache.forEach(({model})=>model.group.visible=role==='reference'&&model===baseline);auditInspectionFrame('comparison-'+role);},
        snapshot:(role,association)=>metadata({referenceActive:role==='reference',association}),
        caption:(role,record)=>(role==='reference'?baselineVersion+' / '+BASELINES[baselineVersion].commit.slice(0,7):CURRENT_RELEASE+' / '+MODEL_BUILD_ID.slice(0,8))+' · '+record.viewId+' · 50 mm · '+record.lighting,
        footnote:t('两帧均来自当前设备真实渲染；同机位、光照、悬架、转向与尾翼状态。')});
      if(archive){download(result.archiveBlob,result.archiveName);$('ready').textContent='两张原始帧、对照图与同次条件已合并导出；captureId 将它们关联。';}
      else{download(result.pairBlob,result.pairName);$('ready').textContent='已采集同条件双帧；左侧 '+baselineVersion+'，右侧 '+CURRENT_RELEASE+'。';}
    }catch(error){$('ready').textContent='对照采集失败：'+error.message;}
    finally{baselineActive=originalActive&&baselineCache.has(baselineVersion);captureBusy=false;lastTime=performance.now();if(stage.dataset.graphics==='ready'){controls.enabled=originalControlsEnabled;refreshModel();disabledStates.forEach(([element,disabled])=>element.disabled=disabled);if(resizePending)resize();renderer.render(scene,camera);}}
  }
  $('capture-pair').onclick=()=>capturePair(false);
  $('capture-bundle').onclick=()=>capturePair(true);
  $('capture-diagnostics').onclick=async()=>{
    if(captureBusy||stage.dataset.graphics!=='ready')return;
    const originalMode=surfaceDiagnostics.mode,originalCorrection=receiverPlaneShadowEnabled.value,originalControls=controls.enabled,
      disabled=[...document.querySelectorAll('button,input,select')].map(e=>[e,e.disabled]);
    captureBusy=true;controls.enabled=false;disabled.forEach(([e])=>e.disabled=true);$('ready').textContent='正在冻结当前模型与机位，采集七项隔离画面…';
    try{
      const result=await captureInspectionDiagnostics({renderer,canvasFactory:()=>document.createElement('canvas'),
        render:spec=>{if(renderer.getContext().isContextLost())throw Error(t('采集时 WebGL 上下文不可用。'));surfaceDiagnostics.setMode(spec.mode);receiverPlaneShadowEnabled.value=spec.correction?1:0;surfaceDiagnostics.apply(allModels());auditInspectionFrame('surface-isolation-'+spec.mode);},
        snapshot:(spec,association)=>metadata({association})});
      download(result.archiveBlob,result.archiveName);$('ready').textContent='七项原始隔离帧与同次条件已导出。';
    }catch(error){$('ready').textContent='对照采集失败：'+error.message;}
    finally{surfaceDiagnostics.setMode(originalMode);receiverPlaneShadowEnabled.value=originalCorrection;surfaceDiagnostics.apply(allModels());captureBusy=false;lastTime=performance.now();if(stage.dataset.graphics==='ready'){controls.enabled=originalControls;disabled.forEach(([e,value])=>e.disabled=value);if(resizePending)resize();renderer.render(scene,camera);}}
  };
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(frameId);fail('当前浏览器 WebGL 上下文已丢失。检视渲染暂停，元数据可导出；请刷新后重试。');});
  const drawingSize=new THREE.Vector2();let statusTime=-Infinity;
  function refreshStatus(){const cost=(baselineActive?baseline:car).getRenderCost();$('inspection-status').textContent=t('细节')+' '+(cost.geometryQuality||cost.quality)+' · '+Math.round(cost.triangles).toLocaleString()+' triangles\n'+RIG.id+'\n'+t('轮距 1.78 m · 轴距 2.84 m · R 0.372 m');}
  onLanguageChange(refreshStatus);
  function frame(now){if(captureBusy){lastTime=now;frameId=requestAnimationFrame(frame);return;}const dt=Math.max(0,Math.min(.05,(now-lastTime)/1000));lastTime=now;surfaceDiagnostics.restore();
    if(sweep){$('suspension').value=.325+.085*Math.sin(now*.0007);$('steer').value=.49*Math.sin(now*.0011);}
    const length=Number($('suspension').value),steer=Number($('steer').value);$('length').textContent=length.toFixed(3)+' m';$('angle').textContent=(steer*180/Math.PI).toFixed(1)+'°';
    sim.step(dt,{});const state=sim.telemetry();$('wing-value').textContent=Math.round((state.wing?.deployment||0)*100)+'% 实际';
    for(const model of [car,...[...baselineCache.values()].map(e=>e.model)]){model.group.position.y=length-.287;model.update({wheelStates:model.wheels.map(w=>({suspensionLength:length,steer:w.z>0?steer:0,rotation:0})),contactCount:4,suctionEnabled:sealed,sealQuality:sealed?1:0,wing:state.wing},dt);}
    controls.update();camera.updateMatrixWorld();for(const model of [car,...[...baselineCache.values()].map(e=>e.model)])model.setViewBudget(camera,renderer.getDrawingBufferSize(drawingSize).y,{inspection:true});surfaceDiagnostics.apply(allModels());renderer.render(scene,camera);
    if(now-statusTime>250){refreshStatus();statusTime=now;}frameId=requestAnimationFrame(frame);
  }
  if(inspectionParams.has('view'))view(inspectionParams.get('view'));
  if(VEHICLE_SURFACE_MODES.some(m=>m.id===inspectionParams.get('surface')))$('surface-mode').value=inspectionParams.get('surface');
  if(inspectionParams.get('shadow')==='legacy')$('shadow-correction').checked=false;
  applySurfaceMode();frameId=requestAnimationFrame(frame);
}catch(error){fail('此环境无法创建三维渲染上下文：'+error.message+'。这不会证明网站的车辆网格或着色器存在故障。');console.error(error);}
