import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/addons/controls/OrbitControls.js';
import {HDRLoader} from './vendor/addons/loaders/HDRLoader.js';
import {createRoadster,VEHICLE_GEOMETRY} from './vehicle.js';
import {RoadsterSim} from './physics.js';
import {MODEL_VERSION} from './vehicle-models.js';
import {MODEL_BUILD_ID} from './model-build.js';
import {VEHICLE_INSPECTION_RIG as RIG,CITY_VISUAL_CAPTURE_PROTOCOL} from './visual-presets.js';
import {t,registerTranslations,observeTranslations,bindLanguageSelectors,onLanguageChange} from './i18n.js';
import {entries,patterns} from './i18n-visual-en.js';
registerTranslations(entries,patterns);observeTranslations(document.body);bindLanguageSelectors(document);
const translateTitle=()=>{document.title=t('Roadster · 50 mm 曲面检视');};translateTitle();onLanguageChange(translateTitle);

const $=id=>document.getElementById(id),stage=$('inspection-stage');
let renderer,scene,camera,controls,car,baseline=null,baselineGeometry=null,baselineLoading=null,baselineActive=false,cut=false,sealed=false,sweep=false,lightMode='studio',viewId='front-quarter',lastTime=performance.now(),frameId,captureBusy=false;
const reference=$('reference-links');RIG.sources.forEach(source=>{const a=document.createElement('a');a.href=source.url;a.target='_blank';a.rel='noopener';a.textContent=source.id+' ↗';reference.append(a);});
const sim=new RoadsterSim();sim.setWing?.({mode:'fixed',deployment:0});
function fail(message){$('inspection-failure').hidden=false;$('inspection-failure').textContent=message;stage.dataset.graphics='unavailable';for(const b of document.querySelectorAll('button,input,select'))if(!b.matches('[data-language-select]'))b.disabled=true;$('capture-meta').disabled=false;$('ready').textContent='三维不可用；官方参考和状态 JSON 仍可查看。';}
function selected(id,group){for(const name of group)$(name).classList.toggle('selected',name===id);}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function metadata(){return{comparisonProtocol:CITY_VISUAL_CAPTURE_PROTOCOL,format:'roadster-surface-capture-1',createdAt:new Date().toISOString(),model:baselineActive?'3.8 geometry with current renderer/lighting':'current',modelVersion:baselineActive?'3.8.0':MODEL_VERSION,buildId:baselineActive?null:MODEL_BUILD_ID,rendererBuildId:MODEL_BUILD_ID,geometrySourceSHA256:baselineActive?'3f532f879f1a86af187a7f89a8f860de61175bdef27d78a783e2ba7fb62763f7':null,baselineCommit:baselineActive?'a25b228a6d56f358cba24106ce897e1cb5c99bc1':null,rig:RIG.id,viewId,focalLengthMm:RIG.focalLengthMm,filmGaugeMm:RIG.filmGaugeMm,camera:camera?{position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov,aspect:camera.aspect}:null,lighting:lightMode,resolution:renderer?renderer.getDrawingBufferSize(new THREE.Vector2()).toArray():null,steer:Number($('steer').value),suspensionLength:Number($('suspension').value),wing:sim.telemetry().wing||null,cutaway:cut,seal:sealed,geometry:baselineActive?baselineGeometry:VEHICLE_GEOMETRY,renderCost:(baselineActive?baseline:car)?.getRenderCost(),userAgent:navigator.userAgent,graphicsAvailable:stage.dataset.graphics==='ready',limits:'Metadata only: this JSON does not attest that a framebuffer was captured. PNG exports require a live WebGL renderer. No automatic image-quality or FPS verdict; dimensions are engineering assumptions. 3.8 baseline retains its own original glass/body materials under the current light rig.'};}
$('capture-meta').onclick=()=>download(new Blob([JSON.stringify(metadata(),null,2)],{type:'application/json'}),'roadster-surface-'+viewId+'-'+(baselineActive?'3.8':'current')+'.json');
try{
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.outputColorSpace=THREE.SRGBColorSpace;stage.append(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color(0x111820);
  camera=new THREE.PerspectiveCamera(35,1,.04,100);camera.filmGauge=RIG.filmGaugeMm;
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.addEventListener('start',()=>{viewId='user-orbit';$('view-caption').textContent='自由环视 / 50 mm';});controls.minDistance=1.2;controls.maxDistance=14;controls.maxPolarAngle=Math.PI*.97;
  const hemi=new THREE.HemisphereLight(0xd8e0e8,0x2b2928,.16);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xfff8ee,2.3);sun.position.set(-3.5,6,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-4;sun.shadow.camera.right=4;sun.shadow.camera.top=4;sun.shadow.camera.bottom=-4;sun.shadow.camera.near=.1;sun.shadow.camera.far=20;sun.shadow.normalBias=.0025;sun.shadow.bias=-.00008;sun.shadow.radius=2;scene.add(sun);
  const fill=new THREE.DirectionalLight(0xc4d4e4,.32);fill.position.set(4,3,-3);scene.add(fill);
  const underLight=new THREE.DirectionalLight(0xc9d7e0,2.8);underLight.position.set(1,-4,3);underLight.visible=false;scene.add(underLight);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0x252d32,roughness:.57,metalness:0}));floor.rotation.x=-Math.PI/2;floor.position.y=RIG.groundY;floor.receiveShadow=true;scene.add(floor);
  car=createRoadster({quality:'ultra'});scene.add(car.group);
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
  function refreshModel(){car.group.visible=!baselineActive;if(baseline)baseline.group.visible=baselineActive;selected(baselineActive?'model-baseline':'model-current',['model-current','model-baseline']);$('model-caption').textContent=baselineActive?'BASELINE / 3.8':'CURRENT / 3.9';$('wing-deployment').disabled=false;}
  $('model-current').onclick=()=>{baselineActive=false;refreshModel();};
  $('model-baseline').onclick=async()=>{if(!baseline){$('baseline-note').textContent='正在按需载入 3.8 原始外观…';try{baselineLoading??=import('./vehicle-reference-3.8.js');const old=await baselineLoading;if(!baseline){baseline=old.createRoadster({quality:$('inspection-quality').value});baselineGeometry=old.VEHICLE_GEOMETRY;baseline.setCutaway(cut);scene.add(baseline.group);}$('baseline-note').textContent='基线：a25b228 · 使用当前渲染器 / 光棚 / 机位。';}catch(error){baselineLoading=null;$('baseline-note').textContent='基线载入失败：'+error.message;return;}}baselineActive=true;refreshModel();};
  $('under').onclick=()=>{viewId='under';camera.position.set(3,-3.5,5);controls.target.set(0,-.2,0);controls.update();floor.visible=false;underLight.visible=true;$('view-caption').textContent='底盘运动包络 / 50 mm';};
  $('cutaway').onclick=()=>{cut=!cut;car.setCutaway(cut);baseline?.setCutaway(cut);$('cutaway').textContent=cut?'剖视开启':'剖视关闭';};
  $('seal').onclick=()=>{sealed=!sealed;$('seal').textContent=sealed?'收回近地密封裙':'展开近地密封裙';};
  $('sweep').onclick=()=>{sweep=!sweep;$('sweep').classList.toggle('selected',sweep);};
  $('inspection-quality').onchange=()=>{car.setQuality($('inspection-quality').value);baseline?.setQuality($('inspection-quality').value);};
  $('wing-deployment').oninput=()=>sim.setWing?.({mode:'fixed',deployment:Number($('wing-deployment').value)});
  $('studio-light').onclick=()=>{lightMode='studio';scene.environment=studioEnvironment;scene.environmentIntensity=.72;selected('studio-light',['studio-light','day-light']);};
  $('day-light').onclick=()=>{if(!daylightEnvironment){$('ready').textContent='自然光纹理尚未载入，条灯光棚仍可使用。';return;}lightMode='daylight';scene.environment=daylightEnvironment;scene.environmentIntensity=.68;selected('day-light',['studio-light','day-light']);};
  function resize(){const rect=stage.getBoundingClientRect();camera.aspect=Math.max(1,rect.width)/Math.max(1,rect.height);camera.setFocalLength(RIG.focalLengthMm);camera.updateProjectionMatrix();renderer.setSize(rect.width,rect.height);}
  addEventListener('resize',resize);resize();view(viewId);stage.dataset.graphics='ready';
  $('capture-frame').onclick=()=>{renderer.render(scene,camera);renderer.domElement.toBlob(blob=>{if(blob)download(blob,'roadster-'+(baselineActive?'3.8':'3.9')+'-'+viewId+'-'+lightMode+'.png');else $('ready').textContent='此浏览器未提供 PNG 帧。';},'image/png');};
  $('capture-pair').onclick=async()=>{
    if(captureBusy)return;captureBusy=true;const originalActive=baselineActive;
    try{
      if(!baseline){const old=await import('./vehicle-reference-3.8.js');baseline=old.createRoadster({quality:$('inspection-quality').value});baselineGeometry=old.VEHICLE_GEOMETRY;scene.add(baseline.group);}
      const state=sim.telemetry(),length=Number($('suspension').value),steer=Number($('steer').value);
      for(const model of [car,baseline]){model.setCutaway(cut);model.group.position.y=length-.287;model.update({wheelStates:model.wheels.map(w=>({suspensionLength:length,steer:w.z>0?steer:0,rotation:0})),contactCount:4,suctionEnabled:sealed,sealQuality:sealed?1:0,wing:state.wing},0);model.setViewBudget(camera,renderer.getDrawingBufferSize(new THREE.Vector2()).y,{inspection:true});}
      const size=renderer.getDrawingBufferSize(new THREE.Vector2()),canvas=document.createElement('canvas');canvas.width=size.x*2;canvas.height=size.y+62;const context=canvas.getContext('2d');
      if(!context)throw new Error(t('浏览器未提供二维截图合成画布。'));
      context.fillStyle='#101820';context.fillRect(0,0,canvas.width,canvas.height);
      for(const [index,old]of [true,false].entries()){car.group.visible=!old;baseline.group.visible=old;renderer.render(scene,camera);context.drawImage(renderer.domElement,index*size.x,0,size.x,size.y);context.fillStyle='#dfe7ec';context.font='16px system-ui';context.fillText((old?'3.8 / a25b228':'3.9 / '+MODEL_BUILD_ID.slice(0,8))+' · '+viewId+' · 50 mm · '+lightMode,index*size.x+18,size.y+26);}
      context.fillStyle='#97acb8';context.font='12px system-ui';context.fillText(t('两帧均来自当前设备真实渲染；同机位、光照、悬架、转向与尾翼状态。'),18,size.y+49);
      canvas.toBlob(blob=>{if(blob)download(blob,'roadster-3.8-vs-3.9-'+viewId+'-'+lightMode+'.png');},'image/png');
      $('ready').textContent='已采集同条件双帧；左侧 3.8，右侧 3.9。';
    }catch(error){$('ready').textContent='对照采集失败：'+error.message;}
    finally{baselineActive=originalActive;captureBusy=false;refreshModel();if(stage.dataset.graphics==='ready')renderer.render(scene,camera);}
  };
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(frameId);fail('当前浏览器 WebGL 上下文已丢失。检视渲染暂停，元数据可导出；请刷新后重试。');});
  const drawingSize=new THREE.Vector2();let statusTime=-Infinity;
  function refreshStatus(){const cost=(baselineActive?baseline:car).getRenderCost();$('inspection-status').textContent=t('细节')+' '+(cost.geometryQuality||cost.quality)+' · '+Math.round(cost.triangles).toLocaleString()+' triangles\n'+RIG.id+'\n'+t('轮距 1.78 m · 轴距 2.84 m · R 0.372 m');}
  onLanguageChange(refreshStatus);
  function frame(now){if(captureBusy){lastTime=now;frameId=requestAnimationFrame(frame);return;}const dt=Math.max(0,Math.min(.05,(now-lastTime)/1000));lastTime=now;
    if(sweep){$('suspension').value=.325+.085*Math.sin(now*.0007);$('steer').value=.49*Math.sin(now*.0011);}
    const length=Number($('suspension').value),steer=Number($('steer').value);$('length').textContent=length.toFixed(3)+' m';$('angle').textContent=(steer*180/Math.PI).toFixed(1)+'°';
    sim.step(dt,{});const state=sim.telemetry();$('wing-value').textContent=Math.round((state.wing?.deployment||0)*100)+'% 实际';
    for(const model of [car,baseline].filter(Boolean)){model.group.position.y=length-.287;model.update({wheelStates:model.wheels.map(w=>({suspensionLength:length,steer:w.z>0?steer:0,rotation:0})),contactCount:4,suctionEnabled:sealed,sealQuality:sealed?1:0,wing:state.wing},dt);}
    controls.update();camera.updateMatrixWorld();for(const model of [car,baseline].filter(Boolean))model.setViewBudget(camera,renderer.getDrawingBufferSize(drawingSize).y,{inspection:true});renderer.render(scene,camera);
    if(now-statusTime>250){refreshStatus();statusTime=now;}frameId=requestAnimationFrame(frame);
  }
  frameId=requestAnimationFrame(frame);
}catch(error){fail('此环境无法创建三维渲染上下文：'+error.message+'。这不会证明网站的车辆网格或着色器存在故障。');console.error(error);}
