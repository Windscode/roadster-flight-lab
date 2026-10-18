import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { SMAAPass } from './vendor/addons/postprocessing/SMAAPass.js';
import { SSAOPass } from './vendor/addons/postprocessing/SSAOPass.js';
import { ColdGasExhaust } from './exhaust.js';
import { telemetryRow, telemetryCSV } from './telemetry.js';
import { RoadsterSim, DEFAULT_PARAMS } from './physics.js';
import { MODEL_VERSION } from './vehicle-models.js';
import { createRoadster } from './vehicle.js';
import { createEnvironment } from './city-environment.js';
import {CITY,CITY_BUILDINGS,CITY_ROUTES,CITY_LOCATIONS,districtAt} from './city-data.js';
import {driverAxes} from './controls.js';
import {SUN_DIRECTION} from './irradiance-math.js';
import {createVehicleAudio} from './audio.js';
import {createCarRadio} from './car-radio.js';
import {createResearchWorkbench} from './research-workbench.js';
import {createCityMap} from './city-map.js';
import {CITY_STREETS} from './city-plan.js';

const $=id=>document.getElementById(id);
const $$=selector=>[...document.querySelectorAll(selector)];
const clamp=THREE.MathUtils.clamp;
const format=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—';
const vec=v=>new THREE.Vector3(v.x,v.y,v.z);
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function boot(){
  const viewport=$('viewport');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.90;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.info.autoReset=false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));renderer.setSize(innerWidth,innerHeight);viewport.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xa4b2aa);
  const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.07,2300);
  const sim=new RoadsterSim();let t=sim.telemetry();
  const car=createRoadster();scene.add(car.group);
  const environment=createEnvironment(scene,renderer,sim.getWorldGeometry(),camera);let waypoint=null;const cityMap=createCityMap(node=>{waypoint=node;});
  const exhaust=new ColdGasExhaust(scene,sim);
  const headlampGroup=new THREE.Group();scene.add(headlampGroup);
  const headlamps=[-1,1].map(side=>{const light=new THREE.SpotLight(0xd3e7ff,850,90,.23,.55,2);light.position.set(side*.70,.12,1.94);light.target.position.set(side*.40,-.55,35);headlampGroup.add(light,light.target);light.shadow.mapSize.set(512,512);light.shadow.normalBias=.015;return light;});
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.enablePan=false;controls.minDistance=3.6;controls.maxDistance=85;controls.maxPolarAngle=Math.PI*.489;controls.minPolarAngle=.05;controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
  // Restrained post processing preserves technical readability and paint highlights.
  const composer=new EffectComposer(renderer);
  // SSAOPass compares orthographic-normalised depth, not metre distances.
  // Convert a 15 mm rejection threshold and a 0.65 m reach to that interval.
  const ssao=new SSAOPass(scene,camera,innerWidth,innerHeight);ssao.kernelRadius=.35;ssao.minDistance=.015/(camera.far-camera.near);ssao.maxDistance=.65/(camera.far-camera.near);ssao.enabled=true;ssao.output=SSAOPass.OUTPUT.SSAO;composer.addPass(ssao);
  // The normal/depth override cannot reconstruct custom billboard positions.
  // Transparent glass and mist also must not become opaque AO occluders.
  const renderContactDepth=ssao.render.bind(ssao);
  ssao.render=(...args)=>{const hidden=[];scene.traverse(o=>{if(o.isMesh&&o.visible&&(o===exhaust.mesh||(Array.isArray(o.material)?o.material:[o.material]).every(m=>m?.transparent))){hidden.push(o);o.visible=false;}});try{return renderContactDepth(...args);}finally{for(const o of hidden)o.visible=true;}};
  // AO is generated first and sampled only by indirect diffuse lighting.
  // The beauty pass replaces its preview, preserving direct/specular energy.
  environment.setContactAO(ssao.blurRenderTarget.texture);composer.addPass(new RenderPass(scene,camera));
  const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.15,.46,1.25);composer.addPass(bloom);
  const smaa=new SMAAPass();composer.addPass(smaa);composer.addPass(new OutputPass());
  let exposureTarget=.90,lastExposureSample=0;
  let quality='high',paused=true,started=false,scenario='city',cameraMode='orbit',showForces=false,showTrail=false,day=true,cutaway=false,activeDrawer=null,scale=1;
  let showHud=true,recording=false,recordRows=[],recordEvents=[],recordParams={...sim.params},samples=[];
  let toastTimer=0,uiTimer=0,frames=0,fpsTime=0,displayFps=60,lastTime=performance.now(),lastPosition=new THREE.Vector3(),pendingManeuver=null;
  const keys=new Set();let sound=null;let radio=null;createCarRadio(toast).then(r=>radio=r).catch(e=>$('radio-status').textContent='音乐资源未就绪：'+e.message);createResearchWorkbench(sim,logEvent);let menuOpen=true,reverseHold=0;document.body.classList.add('body-menu');
  const telemetryHistory=[];
  const scenarioText={
    city:{title:'织桥街',description:'弧顶交换厅、连续店面与双层步行廊。',button:'进入城市',kicker:'VESPER / LOWER CITY'},
    harbor:{title:'上城台地',description:'坡道连接 8 m 台地与山脊环线。',button:'进入街区',kicker:'VESPER / UPPER CITY'},
    skyway:{title:'空中长廊',description:'高架廊道可通过地面坡道到达。',button:'进入高架',kicker:'VESPER / SKYLINE'},
    ...Object.fromEntries(CITY_LOCATIONS.filter(s=>['garden','waterfront','sculpture'].includes(s.id)).map(s=>[s.id,{title:s.label,description:s.subtitle,button:'前往探索',kicker:'VESPER / CITY LANDMARK'}])),
    free:{title:'驾驶，从这里开始。',description:'WASD 控制车辆，按 H 启动飞行控制。拖动场景，自由观察。',button:'进入试验',kicker:'READY FOR A DIFFERENT KIND OF DRIVE'},
    hover:{title:'把重力，交给控制器。',description:'从 4 m 空中初态开始。默认有限储气；长时间练习可在工程面板选择恒压试验台。',button:'启动闭环',kicker:'02 / HOVER & ATTITUDE CONTROL'},
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

  function toast(message,duration=3900){$('toast').textContent=message;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),duration);}
  function logEvent(type,data={}){if(recording)recordEvents.push({time:sim.simTime,type,...data});}
  function setPaused(value){paused=value;if(value)keys.clear();$('pause-btn').textContent=paused?'▶':'Ⅱ';$('sim-state').textContent=paused?'仿真暂停':'实时仿真';if(paused&&sound)sound.silence();logEvent(paused?'pause':'resume');}
  function resetTrace(){samples=[];telemetryHistory.length=0;trailCount=0;trailGeometry.setDrawRange(0,0);trailClock=0;exhaust.reset();}
  function resetCamera(mode='orbit',instant=true){
    cameraMode=mode;camera.up.set(0,1,0);const p=vec(sim.body.position),yaw=t.headingDeg*Math.PI/180;
    controls.target.copy(p).add(new THREE.Vector3(0,.05,0));
    if(mode==='orbit'){
      let offset=new THREE.Vector3(6.15,2.5,7.4);
      if(scenario==='ceiling')offset.set(8.8,-3.7,9.5);
      if(scenario==='ramp')offset.set(10,4.5,-9);
      camera.position.copy(p).add(offset);controls.enabled=true;controls.maxPolarAngle=scenario==='ceiling'?Math.PI*.83:Math.PI*.489;controls.update();
    }else{controls.enabled=false;if(instant){camera.position.copy(p).add(new THREE.Vector3(-Math.sin(yaw)*8,3.2,-Math.cos(yaw)*8));camera.lookAt(p);}}
    $('camera-name').textContent={orbit:'环绕视角',chase:'跟随视角',cockpit:'驾驶员视角',top:'俯视测量'}[mode];lastPosition.copy(p);
  }
  function activateScenario(name){
    scenario=name;sim.reset(name);t=sim.telemetry();setPaused(true);resetTrace();pendingManeuver=name==='ramp'?'ramp':null;
    logEvent('scenario_reset',{scenario:name,params:{...sim.params}});
    $$('.experiment').forEach(b=>b.classList.toggle('active',b.dataset.scenario===name));
    const copy=scenarioText[name];$('launch-title').textContent=copy.title;$('launch-description').textContent=copy.description;$('launch-kicker').textContent=copy.kicker;$('start-btn').innerHTML=copy.button+' <span>↗</span>';
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
  function setMode(mode){sim.setMode(mode);pendingManeuver=null;logEvent('control_mode',{mode});syncUi(sim.telemetry());if(mode==='hover'&&sim.body.position.y<1.3)toast('辅助飞行已接管：E / Q 调整高度，W / S 前后移动，A / D 偏航。');else if(mode==='manual')toast('直接推力：E 增加升力，松开切断；Z / B 滚转，W / S 前后喷口。无姿态稳定。',6200);}
  function toggleStabilization(){sim.setAirStabilization(!sim.airStabilization);logEvent('air_stabilization',{enabled:sim.airStabilization});syncUi(sim.telemetry());toast(sim.airStabilization?'空中稳姿已开启：离地后自动回正、减小摆动并保持高度。1 / 2 直控优先，松开后恢复稳姿。':'空中稳姿已关闭，恢复当前驾驶模式。',5600);}
  function maneuver(name){
    if(name==='roll'&&sim.params.supplyMode==='finite'&&t.gasFraction<.75){toast('气量偏低。先按 T 补气，或选择恒压试验台；继续滚转可能中途失去推力。',5500);}
    if(name==='roll'&&t.suctionEnabled&&t.contactCount>1&&Math.abs(t.rollDeg)>90){toast('当前为倒悬接触工况。请先切换垂直飞行试验，再执行滚转。');return;}
    if(sim.startManeuver(name)===false){toast(sim.status,6000);return;}logEvent('maneuver_start',{name});ensureRunning();
    if(name==='roll'&&sim.params.supplyMode==='finite')toast('有限气源序列：短脉冲起跳 → 弹道滚转 → 按离地高度减速着陆。低气量可能失去控制裕度。',5700);
  }
  function takeOver(){if(sim.telemetry().maneuver){sim.startManeuver('cancel');toast('已取消自动动作，操纵权交给你。',2400);logEvent('manual_takeover');}}
  function refill(){sim.refillGas();logEvent('gas_refill',{pressureBar:sim.params.initialPressureBar});toast('试验干预：气源已恢复到 '+sim.params.initialPressureBar+' bar。');syncUi(sim.telemetry());}

  let panelFocus=null,pausedByPanel=false;
  function closePanels(){
    const resumeMap=activeDrawer==='map'&&pausedByPanel&&!menuOpen;
    $$('.drawer').forEach(d=>d.classList.add('hidden'));$('help-modal').classList.add('hidden');$('drawer-scrim').classList.add('hidden');activeDrawer=null;
    if(panelFocus?.isConnected)panelFocus.focus({preventScroll:true});panelFocus=null;
    if(menuOpen)$('game-menu').classList.remove('hidden');
    if(pausedByPanel){pausedByPanel=false;if(resumeMap)setPaused(false);else toast('查看面板时已暂停，按 P 继续仿真。',2500);}
  }
  function openPanel(name){
    closePanels();panelFocus=document.activeElement;activeDrawer=name;$('drawer-scrim').classList.remove('hidden');$(name==='help'?'help-modal':name+'-drawer').classList.remove('hidden');
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

  function openGameMenu(){menuOpen=true;setPaused(true);document.body.classList.add('body-menu');document.body.classList.remove('body-cinema');$('game-menu').classList.remove('hidden');$('menu-resume').focus();}
  function closeGameMenu(){if(!started){start();return;}menuOpen=false;document.body.classList.remove('body-menu');$('game-menu').classList.add('hidden');closePanels();setPaused(false);viewport.focus();}
  $('experiment-container').appendChild($('left-hud'));
  $('menu-btn').onclick=openGameMenu;$('menu-resume').onclick=closeGameMenu;$('play-city').onclick=()=>{activateScenario('city');start();};$('game-camera').onclick=()=>$('camera-btn').click();
  $$('[data-menu-page]').forEach(button=>button.onclick=()=>{for(const page of ['home','experiments'])$('menu-'+page).classList.toggle('hidden',page!==button.dataset.menuPage);$$('[data-menu-page]').forEach(b=>b.classList.toggle('selected',b===button));});
  $$('[data-spawn]').forEach(button=>button.onclick=()=>{activateScenario(button.dataset.spawn);start();});
  $$('[data-game-panel]').forEach(button=>button.onclick=()=>{const name=button.dataset.gamePanel;if(['render','parameters','telemetry','research'].includes(name)){openPanel('engineering');engineeringTab(name);}else openPanel(name);});
  $$('[data-game-command]').forEach(button=>button.onclick=()=>{const command=button.dataset.gameCommand;closeGameMenu();if(command==='hover'){setMode('hover');ensureRunning();}else if(command==='suction')$('suction-btn').click();else if(command==='stabilize')toggleStabilization();else maneuver(command);});
  function syncDrivingHud(data){
    $('hud-speed').textContent=Math.round(Math.hypot(data.velocity.x,data.velocity.z)*3.6);$('hud-mode').textContent=data.stabilizationActive?'AIR STABILIZE':data.mode==='hover'?'FLIGHT ASSIST':data.mode==='manual'?'DIRECT THRUST':data.forwardSpeedKmh<-.5?'REVERSE':'DRIVE';
    $('hud-seal').textContent=data.suctionEnabled?'吸附 '+Math.round(data.sealQuality*100)+'%':data.airStabilization?'稳姿 G':'';$('stabilize-btn').setAttribute('aria-pressed',data.airStabilization);$('stabilize-label').textContent=data.airStabilization?'空中稳姿 · 已开启':'空中稳姿';
    const airborne=data.mode!=='drive'||data.contactCount===0&&data.heightWorld>1.3;$('hud-flight').classList.toggle('hidden',!airborne);$('hud-flight').textContent='H '+data.heightWorld.toFixed(1)+' m    V '+data.verticalSpeed.toFixed(1)+' m/s';
    $('hud-air-label').textContent=data.supplyMode==='bench'?'理想供气 ∞':'气源 '+Math.round(data.gasFraction*100)+'%';$('hud-air-fill').style.width=(data.supplyMode==='bench'?100:data.gasFraction*100)+'%';
    if(waypoint){$('hud-waypoint').classList.remove('hidden');$('hud-waypoint').textContent=waypoint.label+' · '+Math.round(Math.hypot(data.position.x-waypoint.position[0],data.position.z-waypoint.position[2]))+' m';}else $('hud-waypoint').classList.add('hidden');if(activeDrawer==='map')cityMap.update(data);const district=districtAt(data.position.x,data.position.z);$('district-label').textContent=district;$('menu-location').textContent=district;
    const c=$('mini-map').getContext('2d'),w=288,range=130,scale=w/(range*2);c.clearRect(0,0,w,w);c.fillStyle='#0b1723';c.fillRect(0,0,w,w);c.save();c.translate(w/2,w/2);
    const px=x=>-(x-data.position.x)*scale,pz=z=>-(z-data.position.z)*scale;c.strokeStyle='#7397b344';c.lineWidth=28*scale;
    for(let q=-600;q<=600;q+=100){c.beginPath();c.moveTo(px(q),-w);c.lineTo(px(q),w);c.stroke();c.beginPath();c.moveTo(-w,pz(q));c.lineTo(w,pz(q));c.stroke();}
    c.strokeStyle='#b0c6b8aa';for(const street of CITY_STREETS){c.lineWidth=street.width*scale;c.beginPath();street.points.forEach((p,i)=>i?c.lineTo(px(p[0]),pz(p[2])):c.moveTo(px(p[0]),pz(p[2])));c.stroke();}
    c.strokeStyle='#b9c3a977';for(const route of CITY_ROUTES){c.lineWidth=route.width*scale;c.beginPath();route.points.forEach((p,i)=>i?c.lineTo(px(p[0]),pz(p[2])):c.moveTo(px(p[0]),pz(p[2])));c.stroke();}
    c.fillStyle='#57708766';for(const b of CITY_BUILDINGS)if(Math.abs(b.x-data.position.x)<range+40&&Math.abs(b.z-data.position.z)<range+40)c.fillRect(px(b.x+b.w/2),pz(b.z+b.d/2),b.w*scale,b.d*scale);
    for(const s of CITY_LOCATIONS){const x=px(s.position[0]),z=pz(s.position[2]);if(Math.abs(x)>w/2||Math.abs(z)>w/2)continue;c.fillStyle=['garden','waterfront','sculpture'].includes(s.id)?'#99c59b':'#c0ad86';c.beginPath();c.arc(x,z,4,0,7);c.fill();}
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
  $('refill-btn').onclick=refill;$('suction-btn').onclick=()=>{sim.setSuction(!sim.suctionEnabled);logEvent('suction_switch',{enabled:sim.suctionEnabled});syncUi(sim.telemetry());};
  $('roll-btn').onclick=()=>maneuver('roll');$('land-btn').onclick=()=>maneuver('land');
  $('camera-btn').onclick=()=>{const modes=['orbit','chase','cockpit','top'];resetCamera(modes[(modes.indexOf(cameraMode)+1)%4]);};
  $('forces-btn').onclick=()=>{showForces=!showForces;forcesRoot.visible=showForces;$('forces-btn').setAttribute('aria-pressed',showForces);if(showForces)toast('力矢量：杏色＝重力，青色＝吸附，浅绿＝喷口，蓝色＝轮胎支撑。长度按力的对数缩放。',5600);};
  $('trail-btn').onclick=()=>{showTrail=!showTrail;trail.visible=showTrail;$('trail-btn').setAttribute('aria-pressed',showTrail);};
  $('collapse-hud').onclick=()=>{showHud=false;$('left-hud').classList.add('hidden');$('expand-hud').classList.remove('hidden');};
  $('expand-hud').onclick=()=>{showHud=true;$('left-hud').classList.remove('hidden');$('expand-hud').classList.add('hidden');document.body.classList.remove('body-running');};
  $('fullscreen-btn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();}catch{toast('当前浏览器不允许自动全屏，可使用 F11。');}};
  $('supply-mode').onchange=e=>{sim.setSupplyMode(e.target.value);logEvent('supply_mode',{mode:e.target.value});toast(e.target.value==='bench'?'已切换恒压试验台：假设外部持续供气。':'已切换有限储气：气量与压力将随喷射降低。');syncUi(sim.telemetry());};
  const params=[
    ['cornerStiffnessFront','前轮标称角刚度',20000,150000,5000,'kN/rad',.001],['cornerStiffnessRear','后轮标称角刚度',20000,150000,5000,'kN/rad',.001],['steeringAccelG','辅助侧向加速度上限',.2,1.2,.05,'g',1],['climbRateMps','普通升降率上限',.3,3,.1,'m/s',1],
    ['dryMass','空车等效质量',1000,3500,50,'kg',1],['tireMu','轮胎摩擦系数',.3,2.2,.05,'',1],
    ['suctionPressurePa','满密封负压差',1000,15000,50,'kPa',.001],['liftNozzleMax','每个主升力喷口上限',5000,30000,500,'kN',.001],
    ['tankLitres','气罐总容积',200,1800,50,'L',1],['initialPressureBar','初始储气压力',100,600,10,'bar',1],
    ['springRate','每轮悬架刚度',35000,120000,2500,'kN/m',.001],['suspensionDamping','每轮悬架阻尼',2500,12000,100,'kN·s/m',.001],
  ];
  $('parameter-fields').innerHTML=params.map(([key,label,min,max,step,unit,factor])=>`<label class="field-label" for="param-${key}">${label}<small>假设</small><b id="param-label-${key}">${format(sim.params[key]*factor,factor===1&&step>=1?0:2)} ${unit}</b></label><input id="param-${key}" data-param="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${sim.params[key]}">`).join('');
  for(const [key,label,min,max,step,unit,factor] of params){const element=$('param-'+key);element.addEventListener('input',()=>{$('param-label-'+key).textContent=format(+element.value*factor,factor===1&&step>=1?0:2)+' '+unit;});element.addEventListener('change',()=>{sim.setParam(key,+element.value);logEvent('parameter_change',{key,value:+element.value});sim.reset(scenario);t=sim.telemetry();resetTrace();setPaused(true);syncUi(t);toast('已修改'+label+'并重新初始化试验，按 P 继续。');});}
  $('radio-chip').onclick=()=>openPanel('radio');
  for(const [id,key]of [['steering-assist','steeringAssist'],['traction-assist','tractionAssist']])$(id).onchange=e=>{sim.setParam(key,e.target.checked);logEvent('assistance_change',{key,enabled:e.target.checked});};
  $('nozzle-model').onchange=e=>{sim.setParam('nozzleModel',e.target.value);logEvent('nozzle_model',{model:e.target.value});};
  $('gas-model').onchange=e=>{sim.setParam('gasModel',e.target.value);logEvent('gas_model',{model:e.target.value});toast(e.target.value==='adiabatic'?'气源模型：绝热放空 + 缓慢环境换热。':'气源模型：等温对照（恒定气温假设）。');};
  $('target-height').oninput=e=>{sim.setParam('hoverHeight',+e.target.value);$('target-height-label').textContent=format(+e.target.value,1)+' m';logEvent('height_target',{value:+e.target.value});};
  $('time-scale').oninput=e=>{scale=+e.target.value;$('time-scale-label').textContent=format(scale,2)+' ×';logEvent('time_scale',{value:scale});};
  $('defaults-btn').onclick=()=>{for(const [key]of params){sim.setParam(key,DEFAULT_PARAMS[key]);$('param-'+key).value=DEFAULT_PARAMS[key];$('param-'+key).dispatchEvent(new Event('input'));}for(const key of ['steeringAssist','tractionAssist','nozzleModel'])sim.setParam(key,DEFAULT_PARAMS[key]);sim.setSupplyMode('finite');$('supply-mode').value='finite';sim.setParam('gasModel','adiabatic');$('gas-model').value='adiabatic';sim.setParam('hoverHeight',4);$('target-height').value=4;$('target-height-label').textContent='4.0 m';activateScenario(scenario);toast('默认参数已恢复。');};
  function setQuality(value){quality=value;const pixel=Math.min(devicePixelRatio||1,value==='ultra'?2:value==='balanced'?1:1.7);renderer.setPixelRatio(pixel);ssao.enabled=value!=='balanced';bloom.enabled=value!=='balanced';renderer.shadowMap.enabled=true;environment.setQuality(value);headlamps[0].castShadow=value==='ultra';resize();}
  $('quality').onchange=e=>setQuality(e.target.value);
  const switchState=(id,state)=>{$(id).classList.toggle('on',state);$(id).setAttribute('aria-checked',state);};
  environment.setDay(true);$('weather-label').textContent='日间 / 晴间多云';
  $('cutaway-btn').onclick=()=>{cutaway=!cutaway;car.setCutaway(cutaway);switchState('cutaway-btn',cutaway);};
  $$('.swatch').forEach(b=>b.onclick=()=>{car.setColor(b.dataset.color);$$('.swatch').forEach(x=>x.classList.toggle('active',x===b));});

  $('sound-btn').onclick=async()=>{try{if(!sound)sound=createVehicleAudio({volume:+$('sound-volume').value/100});else sound.enabled=!sound.enabled;await sound.context.resume();switchState('sound-btn',sound.enabled);if(!sound.enabled)sound.silence();}catch{toast('当前浏览器未提供可用音频输出。');}};

  $('sound-volume').oninput=e=>{const value=+e.target.value;$('sound-volume-label').textContent=value+'%';sound?.setVolume(value/100);};

  const inputKeys=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyE','KeyQ','KeyZ','KeyB','ShiftLeft','ShiftRight','Digit1','Digit2','Numpad1','Numpad2'];
  window.addEventListener('keydown',e=>{
    if(e.code==='Escape'){e.preventDefault();if(activeDrawer)closePanels();else if(menuOpen)closeGameMenu();else openGameMenu();return;}
    const target=e.target;if(target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target?.isContentEditable)return;
    if(e.code==='Tab'&&activeDrawer){const panel=activeDrawer==='help'?$('help-modal'):$(activeDrawer+'-drawer');const items=[...panel.querySelectorAll('button:not([disabled]),a,input,select')].filter(x=>x.offsetParent!==null);if(items.length){if(e.shiftKey&&document.activeElement===items[0]){items.at(-1).focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){items[0].focus();e.preventDefault();}}return;}
    if(menuOpen&&!activeDrawer&&e.code==='Tab'){const items=[...$('game-menu').querySelectorAll('button,a')].filter(o=>o.offsetParent!==null);if(e.shiftKey&&document.activeElement===items[0]){items.at(-1).focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){items[0].focus();e.preventDefault();}return;}
    if(e.code==='KeyP'&&menuOpen&&!activeDrawer){closeGameMenu();return;}
    if(e.code==='KeyM'&&activeDrawer==='map'){e.preventDefault();closePanels();return;}
    if(menuOpen||activeDrawer)return;
    if(inputKeys.includes(e.code)){e.preventDefault();if(activeDrawer)return;keys.add(e.code);if(e.code!=='ShiftLeft'&&e.code!=='ShiftRight')takeOver();if(!started)start();return;}
    if(e.repeat)return;
    const actions={KeyJ:()=>radio?.toggle(),KeyK:()=>radio?.next(),KeyG:toggleStabilization,KeyP:()=>{if(paused)closeGameMenu();else openGameMenu();},KeyM:()=>openPanel('map'),F9:()=>document.body.classList.toggle('body-cinema'),KeyR:()=>activateScenario(scenario),KeyT:refill,KeyF:()=>$('suction-btn').click(),KeyH:()=>{setMode(sim.mode==='hover'?'drive':'hover');ensureRunning();},KeyX:()=>maneuver('roll'),KeyL:()=>maneuver('land'),KeyC:()=>$('camera-btn').click(),KeyV:()=>$('forces-btn').click()};
    if(actions[e.code]){e.preventDefault();actions[e.code]();}
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();if(started&&!paused)setPaused(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();setPaused(true);}});
  $$('[data-touch]').forEach(button=>{button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);takeOver();ensureRunning();keys.add(button.dataset.touch);});for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>keys.delete(button.dataset.touch));});
  renderer.domElement.addEventListener('pointerdown',()=>{if(cameraMode!=='orbit')resetCamera('orbit',false);});
  function inputs(dt){
    const pad=navigator.getGamepads?.()?.find?.(p=>p?.connected);const i=driverAxes(keys,pad);
    if(pad&&t.maneuver&&(Math.abs(i.steer)+Math.abs(i.throttle)+Math.abs(i.lift)+i.frontJets+i.rearJets>.25))takeOver();
    if(sim.mode==='drive'){const velocity=t.forwardSpeedKmh/3.6;if(i.throttle<-.05){if(velocity>.35){i.brake=Math.max(i.brake,-i.throttle);i.throttle=0;reverseHold=0;}else if(velocity>-.1){reverseHold+=dt;if(reverseHold<.28){i.brake=Math.max(i.brake,-i.throttle);i.throttle=0;}}}else{reverseHold=0;if(i.throttle>.05&&velocity<-.35){i.brake=Math.max(i.brake,i.throttle);i.throttle=0;}}}
    return i;
  }

  // Records use simulation time and include state-reset events to prevent ambiguous traces.
  $('record-btn').onclick=()=>{
    if(!recording){recordRows=[];recordEvents=[];recordParams={...sim.params};recording=true;recordEvents.push({time:sim.simTime,type:'record_start',scenario});}
    else{recordEvents.push({time:sim.simTime,type:'record_stop'});recording=false;}
    $('record-btn').textContent=recording?'■ 停止记录':'● 新建记录';$('record-btn').classList.toggle('recording',recording);toast(recording?'正在按仿真时间记录，每秒 20 个样本。':'记录已停止，可导出 CSV。');
  };
  function download(content,name,type='text/plain;charset=utf-8'){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  const row=telemetryRow;
  function captureSample(data){
    samples.push({time:data.simTime,y:data.heightWorld,target:data.targetAltitude,demand:data.desiredWrench[1]/1000,delivered:data.achievedWrench[1]/1000,pressure:data.pressureBar,temperature:data.gasTemperatureK});
    if(samples.length>410)samples.shift();
    const record=row(data);telemetryHistory.push(record);if(telemetryHistory.length>24000)telemetryHistory.shift();
    if(recording){if(recordRows.length<72000)recordRows.push(record);else{recording=false;$('record-btn').classList.remove('recording');$('record-btn').textContent='● 新建记录';toast('记录已达到一小时上限，请导出保存。',6000);}}
    if(showTrail){if(trailCount>=trailCapacity){trailData.copyWithin(0,3);trailCount=trailCapacity-1;}trailData[trailCount*3]=data.position.x;trailData[trailCount*3+1]=data.position.y;trailData[trailCount*3+2]=data.position.z;trailCount++;trailGeometry.attributes.position.needsUpdate=true;trailGeometry.setDrawRange(0,trailCount);}
  }
  $('csv-btn').onclick=()=>{
    const records=recordRows.length?recordRows:telemetryHistory;if(!records.length){toast('先运行试验，再记录或导出遥测。');return;}
    const csv=telemetryCSV(records,{params:recordRows.length?recordParams:sim.params,events:recordRows.length?recordEvents:[]});
    download('\uFEFF'+csv,'roadster-telemetry-'+new Date().toISOString().replace(/[:.]/g,'-')+'.csv','text/csv;charset=utf-8');toast('已导出 '+records.length+' 行，物理时间 20 Hz 采样。');
  };
  $('export-model-btn').onclick=async()=>{
    const button=$('export-model-btn');button.disabled=true;button.textContent='正在导出几何与材质…';
    try{const {GLTFExporter}=await import('./vendor/addons/exporters/GLTFExporter.js');const pose=car.group.position.clone(),q=car.group.quaternion.clone();const wasCutaway=cutaway;car.setCutaway(false);car.group.position.set(0,0,0);car.group.quaternion.identity();const model=car.group.clone(true);model.visible=true;car.group.position.copy(pose);car.group.quaternion.copy(q);car.setCutaway(wasCutaway);model.traverse(o=>{if(o.isPoints||/plume|mist|exhaust particles|cold-gas particle|cold-gas condensation core/i.test(o.name))o.visible=false;if(o.isLine&&o.material?.isLineBasicMaterial)o.material=new THREE.MeshBasicMaterial({color:o.material.color,transparent:o.material.transparent,opacity:o.material.opacity,vertexColors:o.material.vertexColors});});const result=await new GLTFExporter().parseAsync(model,{binary:true,onlyVisible:true});download(result,'roadster-2026-study.glb','model/gltf-binary');toast('模型已导出。车辆外形是独立重建，非原厂 CAD。');}catch(err){toast('模型导出失败：'+err.message,6500);}finally{button.disabled=false;button.textContent='导出当前车辆模型 · GLB ↓';}
  };

  const detailFields=[['质量','mass','kg',1],['车身纵向速度','forwardSpeedKmh','km/h',1],['俯仰','pitchDeg','°',1],['滚转','rollDeg','°',1],['非重力比力','gLoad','g',2],['密封效率','sealQuality','%',0],['离下表面高度','altitude','m',2],['剩余空气质量','gasMass','kg',1],['目标重心高度','targetAltitude','m',2],['气体温度','gasTemperatureK','K',1],['升力上限 / 重力','thrustMargin','倍',2],['分配残差（归一化）','allocationError','',3],['累计电能¹','energyUsedKWh','kWh',3],['质心侧偏','bodySlipDeg','°',2],['路轮转角','steeringCentreDeg','°',2],['瞬时耗气','massFlowKgS','kg/s',2],['有效排速','effectiveExhaustVelocity','m/s',1],['累计喷流冲量','deliveredImpulseNs','N·s',0],['本状态悬停估时','hoverSecondsEstimate','s',2]];
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
    const groundSpeed=Math.hypot(data.velocity.x,data.velocity.z)*3.6;
    $('speed-value').textContent=format(groundSpeed,0);$('altitude-value').textContent=format(data.heightWorld,2);$('vertical-value').textContent=format(data.verticalSpeed,2);$('thrust-value').textContent=format(data.thrustN/1000,1);$('suction-value').textContent=format(data.suctionN/1000,1);$('pressure-value').textContent=format(data.pressureBar,0);$('contacts-value').textContent=data.contactCount+' / 4';
    $('gas-meter').style.width=clamp(data.gasFraction*100,0,100)+'%';$('gas-meter').style.background=data.gasFraction<.2?'#d9a576':'#bddda7';$('thrust-meter').style.width=clamp(data.thrustN/100000*100,0,100)+'%';
    $('drive-state').textContent=data.status;$('supply-label').textContent=data.supplyMode==='bench'?'CONSTANT-PRESSURE BENCH':'FINITE SUPPLY';$('time-value').textContent='T+ '+data.simTime.toFixed(1).padStart(5,'0')+' s';
    $('horizon-disk').setAttribute('transform',`rotate(${-data.rollDeg} 50 50) translate(0 ${clamp(data.pitchDeg*.75,-50,50)})`);$('attitude-label').textContent='ROLL '+format(data.rollDeg,1)+'°';
    $$('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===data.mode));$('suction-btn').setAttribute('aria-pressed',data.suctionEnabled);$('supply-mode').value=data.supplyMode;$('gas-model').value=sim.params.gasModel;$('nozzle-model').value=sim.params.nozzleModel;$('steering-assist').checked=sim.params.steeringAssist;$('traction-assist').checked=sim.params.tractionAssist;
    $('target-height-label').textContent=format(data.targetAltitude,1)+' m';if(document.activeElement!==$('target-height'))$('target-height').value=data.targetAltitude;
    if(activeDrawer==='engineering'){
      for(const [label,key,unit,digits]of detailFields)$('detail-'+key).textContent=key==='hoverSecondsEstimate'&&data.supplyMode==='bench'?'∞':format(key==='sealQuality'?data[key]*100:data[key],digits);
      data.nozzles.forEach((n,i)=>{$('nozzle-bar-'+i).style.width=clamp(n.force/Math.max(1,n.maxForce)*100,0,100)+'%';$('nozzle-label-'+i).textContent=format(n.force/1000,1)+' kN';});drawChart();drawSignals('force-chart',[['delivered','#c1e6b0'],['demand','#c4a675']]);drawSignals('gas-chart',[['pressure','#c1e6b0'],['temperature','#c4a675']],[sim.params.initialPressureBar,sim.params.gasTemperatureK]);
    }
    $('app').dataset.simState=JSON.stringify({time:+data.simTime.toFixed(3),scenario:data.scenario,mode:data.mode,paused,pressure:+data.pressureBar.toFixed(2),height:+data.heightWorld.toFixed(3),gas:+data.gasMass.toFixed(3),phase:data.maneuver?.phase||null,contacts:data.contactCount,recorded:recordRows.length,plumes:exhaust.particles.length,x:+data.position.x.toFixed(2),z:+data.position.z.toFixed(2),menu:menuOpen,heading:+data.headingDeg.toFixed(3),pitch:+data.pitchDeg.toFixed(3),roll:+data.rollDeg.toFixed(3),angularSpeed:+Math.hypot(data.angularVelocity.x,data.angularVelocity.y,data.angularVelocity.z).toFixed(4),input:data.driverInput,stabilization:{armed:data.airStabilization,active:data.stabilizationActive},dynamics:{beta:+data.bodySlipDeg.toFixed(3),steer:+data.steeringCentreDeg.toFixed(3),flow:+data.massFlowKgS.toFixed(3),exhaust:+data.effectiveExhaustVelocity.toFixed(1),hoverSeconds:+data.hoverSecondsEstimate.toFixed(2),nozzleModel:data.nozzleModel},jets:data.nozzles.slice(0,4).map(n=>Math.round(n.command)),audio:sound?{enabled:sound.enabled,volume:sound.volume,state:sound.context.state}:null});
    const message=data.fault?data.fault:data.pressureLimited&&(data.mode!=='drive'||data.stabilizationActive)?'储气压力不足 · 推力正在降低，按 T 进行试验补气':data.maneuver?data.status:data.supplyMode==='bench'&&data.mode!=='drive'?'恒压试验台 · 假设外部持续供气':'';
    $('status-banner').textContent=message;$('status-banner').classList.toggle('hidden',!message||!started);
    syncDrivingHud(data);
    $('performance-label').textContent=displayFps+' FPS · '+quality.toUpperCase();$('record-status').textContent=(recording?'正在记录':'可导出记录')+' · '+recordRows.length+' 个样本。重置、补气和参数变更会记录为独立事件。';
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
    car.group.visible=true;if(menuOpen&&cameraMode==='orbit')camera.setViewOffset(innerWidth,innerHeight,-innerWidth*.18,0,innerWidth,innerHeight);else if(camera.view?.enabled)camera.clearViewOffset();
    if(cameraMode==='orbit'){
      const shift=p.clone().sub(lastPosition);camera.position.add(shift);controls.target.copy(p).add(new THREE.Vector3(0,.05,0));controls.update();
    }else if(cameraMode==='chase'){
      const speed=Math.hypot(data.velocity.x,data.velocity.z);const offset=new THREE.Vector3(-Math.sin(heading)*(6.7+Math.min(speed*.045,2.5)),2.2,-Math.cos(heading)*(6.7+Math.min(speed*.045,2.5)));
      if(data.heightWorld>6&&data.contactCount>1&&Math.abs(data.rollDeg)>100)offset.y=-2.4;
      const desired=p.clone().add(offset);camera.position.lerp(desired,1-Math.exp(-dt*4));const look=p.clone().add(new THREE.Vector3(Math.sin(heading)*1.2,.4,Math.cos(heading)*1.2));camera.up.set(0,1,0);camera.lookAt(look);
    }else if(cameraMode==='cockpit'){
      car.group.visible=false;camera.position.copy(new THREE.Vector3(-.33,.4,-.15).applyQuaternion(q).add(p));camera.up.copy(new THREE.Vector3(0,1,0).applyQuaternion(q));camera.lookAt(new THREE.Vector3(0,.25,20).applyQuaternion(q).add(p));
    }else{camera.up.set(0,0,1);camera.position.lerp(p.clone().add(new THREE.Vector3(0,37,0)),1-Math.exp(-dt*5));camera.lookAt(p);}
    if(cameraMode==='orbit')camera.up.set(0,1,0);lastPosition.copy(p);
  }
  function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);environment.resize?.();composer.setSize(innerWidth,innerHeight);exhaust.setDepth(ssao.normalRenderTarget.depthTexture,innerWidth*renderer.getPixelRatio(),innerHeight*renderer.getPixelRatio(),camera.near,camera.far,ssao.enabled);ssao.setSize(Math.round(innerWidth*(quality==='ultra'?1:.75)),Math.round(innerHeight*(quality==='ultra'?1:.75)));}
  window.addEventListener('resize',resize);setQuality('high');activateScenario('free');
  // Research references are local; links open only when explicitly selected.
  fetch('./research.json').then(r=>r.json()).then(research=>{
    $('research-content').innerHTML=[['官方明确的功能',research.confirmed],['本模型的研究假设',research.assumptions]].map(([title,list])=>'<h3>'+escapeHtml(title)+'</h3><ul class="evidence-list">'+list.map(s=>'<li>'+escapeHtml(s)+'</li>').join('')+'</ul>').join('');
    $('source-links').innerHTML=research.sources.map(s=>`<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(s.title)}<small>${escapeHtml(s.type)}</small></span><span>↗</span></a>`).join('')+'<a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/" target="_blank" rel="noopener noreferrer"><span>NASA Glenn · 推力与气体质量流率<small>推进力学参考</small></span><span>↗</span></a><a href="https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky" target="_blank" rel="noopener noreferrer"><span>Poly Haven · Kloofendal 48° Partly Cloudy<small>HDR 环境 · CC0</small></span><span>↗</span></a>';
  }).catch(()=>{$('research-content').textContent='参考资料暂未载入。可直接查看 Tesla 官方 Roadster 产品页与本项目物理说明。';});
  $('day-btn').classList.remove('on');$('day-btn').setAttribute('aria-checked','false');$('weather-label').textContent='日间 / 晴间多云';
  activateScenario('city');
  await Promise.race([environment.ready,new Promise(resolve=>setTimeout(resolve,10000))]);
  $('loading-message').textContent='准备车辆材质、灯光与实时渲染…';
  exhaust.mesh.geometry.instanceCount=1;
  if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
  composer.render();exhaust.mesh.geometry.instanceCount=0;window.roadsterReady=true;
  $('loading-screen').style.opacity='0';setTimeout(()=>$('loading-screen').style.display='none',700);
  $('sim-state').textContent='系统就绪';$('solver-label').textContent='6DOF · 120 Hz / 遥测 20 Hz';syncUi(t);
  // A small read-only diagnostics surface makes the numerical state inspectable.
  window.roadsterLab={getState:()=>({...sim.telemetry(),paused,quality,cameraMode}),getParameters:()=>({...sim.params}),getGeometry:()=>sim.getWorldGeometry(),version:MODEL_VERSION};
  function frame(now){
    requestAnimationFrame(frame);if(document.hidden){lastTime=now;return;}const wallDelta=Math.max(0,(now-lastTime)/1000),dt=Math.min(wallDelta,.08);lastTime=now;
    try{
      renderer.info.reset();renderer.shadowMap.needsUpdate=true;let physicalDelta=0;
      if(now-lastExposureSample>200){const p=sim.body.position,sunVisible=!sim.traceSurface({x:p.x,y:p.y+.75,z:p.z},{x:SUN_DIRECTION[0],y:SUN_DIRECTION[1],z:SUN_DIRECTION[2]},1800);exposureTarget=$('auto-exposure').checked?environment.exposureAt(p,sunVisible):.90;lastExposureSample=now;}
      renderer.toneMappingExposure+=(exposureTarget-renderer.toneMappingExposure)*(1-Math.exp(-dt/1.1));
      if(!paused){const input=inputs(dt*scale),before=sim.simTime;t=sim.step(dt*scale,input,captureSample);physicalDelta=Math.max(0,t.simTime-before);if(t.fault){exhaust.reset();setPaused(true);toast(t.fault+'。已暂停，请重置并检查参数。',9000);}}
      else t=sim.telemetry();
      const alpha=paused?1:sim.interpolationAlpha;
      const renderPosition=vec(sim.body.previousPosition).lerp(vec(t.position),alpha),renderQuaternion=new THREE.Quaternion().copy(sim.body.previousQuaternion).slerp(new THREE.Quaternion(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w),alpha);
      const display={...t,position:renderPosition,quaternion:renderQuaternion};
      car.group.position.copy(renderPosition);car.group.quaternion.copy(renderQuaternion);car.update({...display,brake:sim._lastInput?.brake||0},physicalDelta);headlampGroup.position.copy(renderPosition);headlampGroup.quaternion.copy(renderQuaternion);headlampGroup.visible=!day;
      updateCamera(dt,display);camera.updateMatrixWorld();updateForces(display);environment.update(now/1000,t.position);environment.updateReflections(now/1000,t.position,[car.group,exhaust.mesh,forcesRoot,trail,targetGroup]);const mistLight=environment.particleLighting();exhaust.setLighting(mistLight.ambient,mistLight.lights);exhaust.update(display,physicalDelta,camera);targetGroup.visible=showForces&&t.mode==='hover';targetGroup.position.set(t.position.x,t.targetAltitude,t.position.z);
      ssao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);ssao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
      if(paused)sound?.silence();else sound?.update(t);composer.render();uiTimer+=dt;frames++;fpsTime+=wallDelta;if(fpsTime>.7){displayFps=Math.round(frames/fpsTime);fpsTime=0;frames=0;}if(uiTimer>.08){syncUi(t);$('performance-label').dataset.renderState=JSON.stringify({fps:displayFps,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,programs:renderer.info.programs.length,exposure:+renderer.toneMappingExposure.toFixed(3),scene:environment.stats});uiTimer=0;}
    }catch(error){setPaused(true);$('error-message').textContent='运行中断：'+error.message+'。当前试验已暂停，可重新加载恢复。';$('error-screen').classList.remove('hidden');console.error(error);}
  }
  lastTime=performance.now();requestAnimationFrame(frame);
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();setPaused(true);$('error-message').textContent='浏览器图形上下文已中断。请关闭占用显卡的其他页面，重新载入并选择流畅画质。';$('error-screen').classList.remove('hidden');});
}

boot().catch(error=>{console.error(error);$('loading-screen').style.display='none';$('error-screen').classList.remove('hidden');$('error-message').textContent='初始化失败：'+error.message+'。请使用支持 WebGL 2 的现代浏览器，开启硬件加速后重新加载。';});



