// Authored presentation data. Route coordinates use the canonical city street
// plan in metres. A visual route never moves the vehicle or changes physics.
export const CITY_WEATHER_PRESETS=Object.freeze({
  'clear-day':Object.freeze({id:'clear-day',name:'晴天',night:false,wetness:0,exposure:.87,
    backgroundIntensity:.72,environmentIntensity:.76,fog:0xa4b4b9,fogDensity:.00072,
    sunIntensity:2.7,sunColor:0xfff3e3,ambientIntensity:.18,bloomStrength:.16,
    description:'实测日间天空、太阳阴影与按当前街道包络重烘焙的漫反射光场。'}),
  'wet-night':Object.freeze({id:'wet-night',name:'湿夜',night:true,wetness:1,exposure:1.02,
    backgroundIntensity:.88,environmentIntensity:.46,fog:0x14202c,fogDensity:.00125,
    sunIntensity:0,sunColor:0xaac6ef,ambientIntensity:.14,bloomStrength:.14,
    description:'粗糙潮湿沥青与局部积水；近场实时灯光与远场静态直接光互补，并叠加独立反射光场。湿夜曝光固定。'})
});

const routePoints=[[-200,0,-400],[-200,0,-320],[-200,0,-262],[-200,0,-225],[-200,0,-132.5],
  [-120,0,-132.5],[0,0,-132.5],[100,0,-132.5],[100,0,-265],[100,0,-400],[0,0,-400],[-110,0,-400],[-200,0,-400]];
const routeLength=routePoints.slice(1).reduce((s,b,i)=>s+Math.hypot(...b.map((v,k)=>v-routePoints[i][k])),0);
export const CITY_BENCHMARK_ROUTE=Object.freeze({
  id:'weave-canal-loop-38',name:'织桥 · 南岸环线',version:1,points:routePoints,
  presentationRevision:'3.11 / retained ground/storey design; complementary near live and far static direct light, independent bounce, receiver-plane shadows and drained wet surfaces',
  lengthMetres:routeLength,speedKmh:30,estimatedDurationS:routeLength/(30/3.6),
  suggestedDurationS:[136,180],spawn:{position:{x:-200,y:.74,z:-390},heading:0},
  streetIds:['weave-main','crosstown-link','foundry-main','canal-link'],
  instructions:['沿织桥街向北经过交换厅与高架桥下。','中央横街右转，向东到机造大道。','机造大道右转向南，再右转进入南岸联络大道，返回织桥入口。'],
  cameras:[
    {id:'weave-entry',name:'01 / 织桥入口',position:[-202.6,2.15,-393],target:[-198.5,4.0,-324],fov:48},
    {id:'exchange',name:'02 / 交换厅',position:[-202.4,2.05,-296],target:[-198.0,4.4,-254],fov:48},
    {id:'viaduct',name:'03 / 高架桥下',position:[-201.2,2.2,-244],target:[-198.3,4.2,-200],fov:48},
    {id:'junction',name:'04 / 横街路口',position:[-201.8,2.0,-146],target:[-176.0,4.0,-128.5],fov:48},
    {id:'canal',name:'05 / 南岸归途',position:[-138,2.1,-398],target:[-204,5.0,-402],fov:48},
    {id:'crosstown',name:'06 / 横街衔接',position:[-78,2.05,-135],target:[96,5.0,-129],fov:48},
    {id:'foundry-south',name:'07 / 机造大道南段',position:[102.5,2.1,-286],target:[99,5.0,-390],fov:48}
  ],
  limits:'约 2–3 分钟是按 30 km/h 加路口减速估计；路线为驾驶导航与实机采集基准，不是自动驾驶或闭环操纵输入。'
});

export const CITY_VISUAL_CAPTURE_PROTOCOL=Object.freeze({
  schema:'roadster.visual-comparison',version:3,baselineCommit:'a62b6e3d6f9b7a1410561ae64d9026dd35b64a2b',baselineModelVersion:'3.13.0',
  referenceResolution:[1280,720],pixelRatio:1,weather:['clear-day','wet-night'],quality:['balanced','high','ultra'],
  cameraIds:['weave-entry','exchange','viaduct','junction','canal'],
  addedViewIds:['crosstown','foundry-south'],routeId:CITY_BENCHMARK_ROUTE.id,
  baselineScope:'Untouched 3.13 checkout. The supplied 1280x720 wet-night high/balanced/high frames establish recovery of observed road/mineral facades; requiredCategories was empty and this is not a full-scene gate. Ultra had GL1286 despite linked programs. Keep different resolution, camera, LOD and supply-mode records separate.',
  stillConditions:'Same camera position/target, 48 degree vertical FOV, full paused vehicle position/quaternion/wing/light state, 1280x720 drawing buffer, pixel ratio 1, quality and weather. Wait 3 s of rendered frames for light selection to settle. Lock matched baseline exposure (day .87, night 1.02). Save source build, actual light IDs/gains, vehicle state, exposure, reflection time/position with the same PNG. A changed lighting preset is a separate comparison.',
  timingConditions:'Record observed browser/renderer (unknown stays unknown), resolution and quality. Separate paused 30 Hz refresh, loading/5 s warmup and 150 s driven steady capture. Actual route inputs/trajectory accompany p50/p95/p99 and long frames. A point HUD FPS is not a route benchmark.',
  acceptance:'Requires actual WebGL images and measured display/GPU timing. Scene graph, shader and DOM checks are separate structural evidence.'
});

// 50 mm on a 36 mm wide film gate, constant across all silhouette views. The
// official images do not publish EXIF/camera intrinsics; this is a repeatable
// inspection rig, not a claim to have recovered Tesla's photography calibration.
export const VEHICLE_INSPECTION_RIG=Object.freeze({
  id:'roadster-studio-50mm-v2',filmGaugeMm:36,focalLengthMm:50,referenceResolution:[1600,1000],
  groundY:-.599,target:[0,.03,0],
  cameras:[
    {id:'front',name:'正前',position:[0,.30,7.6],target:[0,.03,0]},
    {id:'rear',name:'正后',position:[0,.35,-7.6],target:[0,.03,0]},
    {id:'side',name:'正侧',position:[8.8,.30,0],target:[0,.03,0]},
    {id:'front-quarter',name:'前四分之三',position:[5.6,1.22,6.8],target:[0,.03,0]},
    {id:'rear-quarter',name:'后四分之三',position:[-5.6,1.22,-6.8],target:[0,.03,0]},
    {id:'top',name:'车顶与肩线',position:[0,8.5,.01],target:[0,0,0]},
    {id:'front-lamp',name:'前灯与鼻部',position:[1.70,.68,4.45],target:[.48,.045,1.83]},
    {id:'rear-wheel',name:'后轮与肩线',position:[3.35,.25,-3.15],target:[.87,-.045,-1.36]}
  ],
  sources:[
    {id:'official-product',url:'https://www.tesla.com/roadster',use:'当前官方外形与部件说明'},
    ...['02-Pilot','03-Carousel-Slide-1','03-Carousel-Slide-2','03-Carousel-Slide-3','08-End'].map(id=>({
      id,url:'https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-'+id+'-Desktop.jpg',use:'侧面、灯具、尾盖、玻璃和前四分之三形态参考'}))
  ],
  assumptions:'轴距 2.84 m、轮距 1.78 m、轮胎半径 0.372 m 沿用仿真假设；官方图像未提供可校准尺寸与焦距。'
});

export function vehicleProjectedPixels({distance,fov,height,diameter=4.8}){
  if(![distance,fov,height,diameter].every(Number.isFinite)||height<=0)return 0;
  return diameter*height/(2*Math.tan(Math.max(1,Math.min(175,fov))*Math.PI/360)*Math.max(.3,distance));
}

export function chooseVehicleGeometryProfile(quality,pixels,{inspection=false,previous=quality}={}){
  const maximum=['balanced','high','ultra'].includes(quality)?quality:'high';
  if(maximum==='balanced')return 'balanced';
  // Hysteresis changes the switch threshold according to the previous profile.
  const lowThreshold=previous==='balanced'?245:200;
  if(pixels<lowThreshold)return 'balanced';
  if(maximum==='high')return 'high';
  const highThreshold=previous==='ultra'?610:720;
  return inspection&&pixels>highThreshold?'ultra':'high';
}
