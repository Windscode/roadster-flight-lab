import {attachShowcaseLighting,installShowcaseLighting} from './showcase-lighting.js';
import {createShadowMotionTracker,SHADOW_MOTION_POLICY} from './shadow-motion.js';
import {backgroundLightLayout} from './city-continuity.js';
import {buildCityHorizon} from './city-horizon.js';
import * as THREE from './vendor/three.module.js';
import {configureCubeProbeTarget} from './cube-probe-target.js';
import {HDRLoader} from './vendor/addons/loaders/HDRLoader.js';
import {CSM} from './vendor/addons/csm/CSM.js';
import {mergeGeometries} from './vendor/addons/utils/BufferGeometryUtils.js';
import {CITY_BUILDINGS,CITY_ROUTES,CITY_CONTINUITY} from './city-data.js';
import {CITY_PLAN,CITY_PLAN_SOLIDS,CITY_STREETS,CITY_NODES,CITY_ROUTE_CORRIDOR,roadSurfaceRectangles,plannedDistrictAt} from './city-plan.js';
import {buildUrbanArchitecture} from './urban-architecture.js';
import {buildStreetLife} from './street-life.js';
import {buildCityLandmarks} from './city-landmarks.js';
import {createIndirectLighting,makeSunlessEnvironment} from './indirect-lighting.js';
import {architectureDetailLevel,cityRenderProfile,createCityVisibility} from './city-render-budget.js';
import {attachRoadSurface} from './road-surface-material.js';
import {createRouteBridgeDetails} from './city-route-detail.js';
import {createLocalProbeSun} from './local-probe-sun.js';
import {CITY_WEATHER_PRESETS,CITY_BENCHMARK_ROUTE} from './visual-presets.js';
import {createCityPracticalLights,cityPracticalRoadHeight} from './city-practical-lights.js';
import {createWetRoadReflection} from './wet-road-reflection.js';
import {attachPavementSurface,CITY_PAVEMENT_SPECIFICATIONS} from './pavement-surface-material.js';
import {createNightCityLighting} from './night-city-lighting.js';
import {createNightDirectLighting} from './night-direct-lighting.js';
import {cityLightingVariant,injectCityMaterialLighting} from './city-material-lighting.js';

export function createEnvironment(scene,renderer,geometry,camera){
  const context=renderer.getContext?.(),max3DTextureSize=context?.getParameter?.(context.MAX_3D_TEXTURE_SIZE)??256;
  const indirect=createIndirectLighting(renderer),nightIndirect=createNightCityLighting({max3DTextureSize}),nightDirect=createNightDirectLighting({max3DTextureSize});
  const probeSun=createLocalProbeSun(scene,renderer);
  const root=new THREE.Group();root.name='Vesper / Weave commerce, Exchange and Southbank';scene.add(root);
  const unit=new THREE.BoxGeometry(),temp=new THREE.Object3D(),loader=new THREE.TextureLoader(),buckets=new Map();
  const loadTexture=path=>typeof document==='undefined'?new THREE.Texture():loader.load(path);
  const normal=loadTexture('./assets/roads/nor_gl.jpg'),rough=loadTexture('./assets/roads/rough.jpg'),albedo=loadTexture('./assets/roads/diff.jpg');albedo.colorSpace=THREE.SRGBColorSpace;
  for(const t of [normal,rough,albedo]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,1);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.anisotropy=8;}
  const mats={road:new THREE.MeshStandardMaterial({color:0x92989c,roughness:.88,metalness:0,normalMap:normal,normalScale:new THREE.Vector2(.13,.13),roughnessMap:rough}),concrete:new THREE.MeshStandardMaterial({color:0x778184,roughness:.92}),steel:new THREE.MeshStandardMaterial({color:0x34444c,metalness:.72,roughness:.47}),dark:new THREE.MeshStandardMaterial({color:0x18232b,roughness:.72}),paint:new THREE.MeshStandardMaterial({color:0xbab5a6,roughness:.86}),amber:new THREE.MeshBasicMaterial({color:0xffd4a0}),cyan:new THREE.MeshBasicMaterial({color:0x72d4d8}),red:new THREE.MeshBasicMaterial({color:0xd94734}),glass:new THREE.MeshPhysicalMaterial({color:0x345459,metalness:.35,roughness:.18,transparent:true,opacity:.45})};
  mats['warm-stone']=new THREE.MeshStandardMaterial({color:0x9b9988,roughness:.91});
  mats.basalt=new THREE.MeshStandardMaterial({color:0x697573,roughness:.9});
  mats.ivory=new THREE.MeshStandardMaterial({color:0xc5c2ae,roughness:.79});
  mats['aged-copper']=new THREE.MeshStandardMaterial({color:0x826f59,roughness:.63,metalness:.35});
  mats.oxide=new THREE.MeshStandardMaterial({color:0x967052,roughness:.73,metalness:.32});
  mats.glazing=mats.glass;
  mats['corridor-pale']=new THREE.MeshStandardMaterial({color:0x898f83,roughness:.89});
  mats['corridor-basalt']=new THREE.MeshStandardMaterial({color:0x737f7d,roughness:.89});
  mats['corridor-wood']=new THREE.MeshStandardMaterial({color:0x60533d,roughness:.75});
  for(const [key,material]of Object.entries(mats))if(!material.name)material.name='City / '+key;
  mats.road.name='City / scanned asphalt + local puddles';
  mats['continuity-stone']=new THREE.MeshStandardMaterial({name:'City / cut civic limestone',color:0x8c9185,roughness:.89,metalness:0});
  mats['service-concrete']=new THREE.MeshStandardMaterial({name:'City / brushed service concrete',color:0x8b9089,roughness:.93,metalness:0});
  mats['weathered-steel']=new THREE.MeshStandardMaterial({name:'City / coated service steel',color:0x506064,roughness:.56,metalness:.25});
  mats['safety-ochre']=new THREE.MeshStandardMaterial({name:'City / worn safety paint',color:0xb99a59,roughness:.86,metalness:0});
  mats['forecourt-mineral']=new THREE.MeshStandardMaterial({name:'City / flush mineral forecourt',color:0x505950,roughness:.94,metalness:0});
  mats['forecourt-border']=new THREE.MeshStandardMaterial({name:'City / forecourt basalt datum',color:0x35463e,roughness:.93,metalness:0});
  mats['boundary-aggregate']=new THREE.MeshStandardMaterial({name:'City / peripheral mineral embankment',color:0x737a6e,roughness:.97,metalness:0});
  mats['civic-plaster']=new THREE.MeshStandardMaterial({name:'City / public frontage pale mineral',color:0xc0bba4,roughness:.86});
  mats['sandstone-plaster']=new THREE.MeshStandardMaterial({name:'City / public frontage sandstone',color:0xaf9270,roughness:.89});
  mats['oxide-plaster']=new THREE.MeshStandardMaterial({name:'City / workshop terracotta',color:0x8e6750,roughness:.88});
  mats['warm-display']=new THREE.MeshStandardMaterial({name:'City / sealed warm display backing',color:0x50636a,roughness:.22,emissive:0xe3c79f,emissiveIntensity:.065,envMapIntensity:.8});
  mats['cool-display']=new THREE.MeshStandardMaterial({name:'City / sealed cool display backing',color:0x415c67,roughness:.22,emissive:0xaacdd4,emissiveIntensity:.05,envMapIntensity:.8});
  mats['display-warm-backing']=new THREE.MeshStandardMaterial({color:0x656151,roughness:.91});
  mats['display-cool-backing']=new THREE.MeshStandardMaterial({color:0x5b6e6a,roughness:.91});
  mats['display-timber']=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.74});
  mats['display-goods']=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.62});
  mats['display-glazing']=new THREE.MeshStandardMaterial({color:0xb6c9c5,roughness:.14,transparent:true,opacity:.19,depthWrite:false,envMapIntensity:.85});
  mats['display-glazing'].name='City / clear shallow display glass';
  mats['display-lamp']=new THREE.MeshStandardMaterial({name:'City / confined display shelf lamp',color:0xffffff,emissive:0xffe1b7,emissiveIntensity:2.1,roughness:.35});
  for(const name of ['display-warm-backing','display-cool-backing','display-timber','display-goods','weathered-steel'])attachShowcaseLighting(mats[name]);
  const pavementSurfaces=Object.entries(CITY_PAVEMENT_SPECIFICATIONS).map(([name,options])=>attachPavementSurface(mats[name],options));
  const plannedGeometry=new Map([...CITY_PLAN_SOLIDS,...CITY_CONTINUITY.solids].map(g=>[g.id,g]));
  const roadSurface=attachRoadSurface(mats.road,{albedo,normal,roughness:rough});
  const add=(size,pos,mat=mats.steel,rot=[0,0,0],shadow=true,level=null,tint=null,showcaseLight=null)=>{const a=buckets.get(mat)||[];a.push({size,pos,rot,shadow,level,tint,showcaseLight});buckets.set(mat,a);};
  const geometryById=new Map(geometry.map(g=>[g.id,g]));
  for(const g of geometry){
    if(['building','podium','street-prop','landmark'].includes(g.kind))continue;
    if(g.kind==='corridor-fixture'&&plannedGeometry.get(g.id)?.data.part==='bench')continue;
    const mat=plannedGeometry.has(g.id)?mats[plannedGeometry.get(g.id).data.material]||mats.concrete:['floor','urban-road','skyway'].includes(g.kind)?mats.road:['ceiling','city-canopy'].includes(g.kind)?mats.dark:mats.concrete;
    if(g.kind==='floor'){
      // A modest grid samples the baked field spatially in the vertex preset;
      // the plane's top agrees exactly with the unchanged physical floor box.
      const floor=new THREE.PlaneGeometry(g.size[0],g.size[2],Math.ceil(g.size[0]/24),Math.ceil(g.size[2]/24));floor.rotateX(-Math.PI/2);
      const m=new THREE.Mesh(floor,mat);m.name=g.id;m.position.set(g.position[0],g.position[1]+g.size[1]/2,g.position[2]);m.receiveShadow=true;m.userData.renderDetail='mass';root.add(m);
    }
    else{const items=buckets.get(mat)||[];items.push({size:g.size,pos:g.position,quaternion:g.quaternion,shadow:true,level:plannedGeometry.get(g.id)?.data.renderDetail});buckets.set(mat,items);}
  }
  const horizon=buildCityHorizon(THREE,root);
  for(const item of CITY_CONTINUITY.finishes)add(item.size,item.position,mats[item.material]||mats.paint,item.rotation,false,item.renderDetail||null,item.tint??null,item.showcaseLight||null);
  const routeDetails=createRouteBridgeDetails();
  for(const item of routeDetails.items)add(item.size,item.position,mats[item.material]||mats.steel,item.rotation,item.shadow,item.renderDetail);
  const architecture=buildUrbanArchitecture(THREE,root,CITY_BUILDINGS);
  const streetLife=buildStreetLife(THREE,root),landmarks=buildCityLandmarks(THREE,root,mats.road);
  for(let z=-80;z<84;z+=12)add([.11,.013,5],[200,14.014,z],mats.paint,undefined,false);
  // A canonical planar street union provides one surface at every junction.
  // The 8 m terrace is the physical support, so these are only asphalt layers.
  const streetSurfaces=roadSurfaceRectangles(CITY_STREETS,8).map(([x0,z0,x1,z1])=>{const g=new THREE.PlaneGeometry(x1-x0,z1-z0);g.rotateX(-Math.PI/2);g.translate((x0+x1)/2,8.002,(z0+z1)/2);return g;});
  const streetSurface=new THREE.Mesh(mergeGeometries(streetSurfaces),mats.road);streetSurface.name='canonical upper street union';streetSurface.receiveShadow=true;root.add(streetSurface);streetSurfaces.forEach(g=>g.dispose());
  for(let z=157;z<414;z+=12)if(![240,322,410].some(q=>Math.abs(q-z)<14))add([.11,.014,5],[400,8.018,z],mats.paint,undefined,false);
  const onPlannedRoad=(x,z)=>CITY_STREETS.some(street=>street.points[0][1]===0&&street.points.slice(1).some((b,i)=>{const a=street.points[i],dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz)));return Math.hypot(x-a[0]-dx*t,z-a[2]-dz*t)<street.width/2+1;}));
  // Markings are sparse and interrupted at junctions; no luminous street grid.
  for(let q=-600;q<=600;q+=100)for(let v=-600;v<600;v+=12){if(Math.abs(v%100)<18)continue;if(!plannedDistrictAt(q,v)&&!onPlannedRoad(q,v))add([.10,.012,5],[q,.018,v],mats.paint,undefined,false);if(!plannedDistrictAt(v,q)&&!onPlannedRoad(v,q))add([5,.012,.10],[v,.018,q],mats.paint,undefined,false);}
  for(let z=-395;z<40;z+=9)if(![-400,-132.5].some(j=>Math.abs(j-z)<14))add([.10,.007,4],[-200,.019,z],mats.paint,undefined,false);
  // A clear asphalt/kerb boundary anchors the hero canyon at vehicle height.
  // These are worn mineral markings, not emissive lines around every block.
  // CITY_STREETS defines this as a 10 m carriageway. The former ±8.45 m
  // lines were painted across the existing footways. Edge lines now follow
  // the actual kerb at ±5 m, interrupted before crossings and side streets.
  for(const x of [-204.70,-195.30])for(const [a,b]of [[-385,-146],[-119,36]])add([.095,.006,b-a],[x,.018,(a+b)/2],mats.paint,undefined,false);
  // The foundry avenue is wider and calmer than the woven street, while the
  // rear service lane is deliberately narrow and unmarked.
  for(let z=-390;z<484;z+=12)if(![-132.5,302.5].some(q=>Math.abs(q-z)<10))add([.11,.013,5],[100,.018,z],mats.paint,undefined,false);
  for(const [z,min,max]of [[-400,-570,100],[-132.5,-300,200]])for(let x=min+8;x<max-3;x+=12){if(Math.abs(x+200)<12||Math.abs(x-100)<12)continue;add([5,.013,.11],[x,.018,z],mats.paint,undefined,false);}
  for(const x of [91,109])for(let z=147;z<489;z+=6)add([.11,.013,5],[x,.018,z],mats.paint,undefined,false);
  // Hero street infrastructure: drainage, patch repairs, access covers and kerbs.
  for(const x of [-204.84,-195.16])for(let z=-379;z<39;z+=24){if(Math.abs(z+132.5)<16)continue;add([.24,.009,.80],[x,.024,z],mats.dark,undefined,false);for(let k=0;k<6;k++)add([.21,.010,.028],[x,.033,z-.31+k*.125],mats.steel,undefined,false);}
  for(let k=0;k<16;k++){const z=-395+k*27;add([1.3,.014,1.3],[-204+(k%3)*3,.032,z],mats.steel,[0,k*.7,0],false);}
  // Real underside depth, bridge ribs, pipe runs and angled pier braces.
  for(let x=-326;x<330;x+=5.5)add([.35,1.05,21.5],[x,18.8,-225],mats.concrete);
  for(const z of [-233,-217])add([660,1.3,.65],[0,18.65,z],mats.concrete);
  for(const z of [-234.8,-215.2])add([660,.32,.32],[0,18.25,z],mats.steel);
  for(const x of [-280,-160,-40,80,200,310])for(const side of [-1,1])add([1.1,6.8,1.4],[x,16.1,-225+side*5.7],mats.concrete,[side*.50,0,0]);
  // Rails and lane paint follow each route's actual 3D tangent.
  for(const route of CITY_ROUTES)route.points.slice(1).forEach((p,i)=>{
    const a=route.points[i],g=geometryById.get(`${route.id}-${i}`);if(!g)return;
    const q=new THREE.Quaternion(...g.quaternion),center=new THREE.Vector3(...g.position);
    for(const side of [-1,1]){const items=buckets.get(mats.steel)||[];items.push({size:[.13,.09,g.size[2]],pos:new THREE.Vector3(side*(route.width/2-.22),1.30,0).applyQuaternion(q).add(center).toArray(),quaternion:g.quaternion,shadow:true});buckets.set(mats.steel,items);}
    if(i%3===0||route.points.length<5){const items=buckets.get(mats.paint)||[];items.push({size:[.11,.015,g.size[2]*.60],pos:new THREE.Vector3(0,.337,0).applyQuaternion(q).add(center).toArray(),quaternion:g.quaternion,shadow:false});buckets.set(mats.paint,items);}
  });
  for(const z of [-320,-172])for(const side of [-1,1]){add([22,1.1,.1],[-200,5.95,z+side*1.9],mats.glass);add([22,.08,.08],[-200,6.55,z+side*1.9],mats.steel);for(let x=-210;x<=-190;x+=2)add([.08,1.3,.08],[x,5.9,z+side*1.9],mats.steel);}
  // Terraced footpaths and retaining-wall ledges make the upper city legible.
  for(let i=0;i<40;i++)for(const z of [180,390])add([2,.20*(i+1),4],[201+i*2,.10*(i+1),z],mats.concrete);
  for(const y of [1,4,7])add([278,.18,.6],[420,y,149.8],mats.steel);
  // Utility cables sag across the street and run along it, with actual thickness.
  const cableGeometries=[];
  function cable(points,radius=.025){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));cableGeometries.push(new THREE.TubeGeometry(curve,16,radius,4,false));}
  for(let z=-390;z<20;z+=37)for(let k=0;k<2;k++)cable([[-213,11+k*.24,z],[-200,9.1+k*.24,z+2.8],[-187,11+k*.24,z+1]],.025);
  for(const x of [-211,-189])for(let k=0;k<2;k++)cable([[x,10+k*.24,-400],[x,8.5+k*.24,-270],[x,11+k*.24,-120],[x,8+k*.24,35]],.033);
  const cableMesh=new THREE.Mesh(mergeGeometries(cableGeometries),mats.dark);cableMesh.name='composed overhead utility runs';cableMesh.castShadow=false;root.add(cableMesh);cableGeometries.forEach(g=>g.dispose());
  // Original street signage: dark backing, mechanical brackets, deliberate scale.
  function sign(text,x,y,z,w=8,h=2,color='#eac896',rotation=Math.PI){
    if(typeof document==='undefined')return;
    const c=document.createElement('canvas');c.width=2048;c.height=Math.max(128,Math.round(2048*h/w));const g=c.getContext('2d');g.fillStyle='#151b1b';g.fillRect(0,0,c.width,c.height);g.fillStyle=color;g.font=`600 ${Math.round(c.height*.53)}px Arial,Microsoft YaHei`;g.textAlign='center';g.textBaseline='middle';g.fillText(text,c.width/2,c.height*.49,c.width*.94);g.fillRect(c.width*.025,c.height*.89,c.width*.95,2);
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.20,roughness:.65});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);mesh.position.set(x,y,z);mesh.rotation.y=rotation;root.add(mesh);
  }
  sign('01  织 桥 街 / WEAVE QUARTER',-200,6.1,-319.85,15,1.2,'#b2cdd8');sign('交换厅 / EXCHANGE',-200,6.1,-286.12,15,1.0,'#dda37d');
  sign('环城高架   ←  CROSS CITY  →',-200,17.1,-236.1,18,1.7,'#a0c4cb');
  sign('03  SKY FORUM / 上城议庭',400,11,150.1,16,2.2,'#d5d8c9');
  sign('02  机造里 / FOUNDRY ROW',100,10.1,312.90,16,1.1,'#d9ad88');
  sign('半 环 议 庭 / SKY FORUM',552.55,14,365,28,2,'#e1d8ba',-Math.PI/2);
  sign('ROADSTER / RESEARCH',0,6,84,26,3.5,'#a8c3bc',Math.PI);
  function verticalSign(text,x,y,z,color){
    if(typeof document==='undefined'){add([1.7,6.2,.15],[x,y,z],mats.steel);return;}
    const c=document.createElement('canvas');c.width=256;c.height=1024;const g=c.getContext('2d');g.fillStyle='#102022';g.fillRect(0,0,256,1024);g.strokeStyle=color;g.lineWidth=6;g.strokeRect(10,10,236,1004);g.fillStyle=color;g.font='bold 150px Arial,Microsoft YaHei';g.textAlign='center';g.textBaseline='middle';[...text].forEach((v,i)=>g.fillText(v,128,120+i*220,210));
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.28,roughness:.6});
    for(const ry of [0,Math.PI]){const m=new THREE.Mesh(new THREE.PlaneGeometry(1.5,6),mat);m.position.set(x,y,z+(ry===0?.085:-.085));m.rotation.y=ry;root.add(m);}add([1.7,6.2,.15],[x,y,z],mats.steel);add([2.2,.13,.13],[x,y+2.8,z],mats.steel);
  }
  verticalSign('夜航旅店',-208.7,7.2,-333,'#5ed7d8');verticalSign('深夜食堂',-191.3,7,-307,'#eaa875');verticalSign('机能诊所',-208.7,8,-287,'#dc75b4');verticalSign('轨道通信',-191.3,10,-195,'#7bafc4');
  // Curated entry, exchange and junction identity sits on existing frontage /
  // bridge solids. No new interior, floating road or obstacle collider is added.
  sign('织 桥 / WEAVE',-209.96,5.15,-370,9,1.2,'#c5d2d3',Math.PI/2);
  sign('CITY EXCHANGE / 交换厅',-190.04,6.08,-270,10,1.25,'#e2b789',-Math.PI/2);
  sign('SOUTH BANK / 南岸公馆',-284,5.65,-417.92,24,1.45,'#d4c5a6',0);
  sign('CENTRAL / 中央横街 →',-200,4.85,-172.16,13,1.0,'#b8cbd1');
  // Loading pockets, crosswalks and stop bars have a legible human scale. The
  // unbroken road support and 2.1 m navigation corridor remain canonical.
  for(const z of [-390,-145]){
    for(let x=-204.0;x<=-196.0;x+=1.0)add([.45,.006,3.0],[x,.027,z],mats.paint,undefined,false);
    add([4.0,.006,.30],[-202.3,.027,z-3.8],mats.paint,undefined,false);
  }
  for(const [side,z]of [[-1,-358],[1,-295],[-1,-182]]){
    const x=-200+side*3.85;
    for(const zz of [z-5.4,z+5.4])add([1.65,.005,.075],[x,.026,zz],mats.paint,undefined,false);
    add([.075,.005,10.8],[x-side*.84,.026,z],mats.paint,undefined,false);
  }
  // A continuous protected utility datum ties the exchange/service frontages
  // together; its joints align to existing 12 m structural bays, not every window.
  for(const side of [-1,1])for(const [a,b]of [[-392,-337],[-313,-287],[-282,-244],[-194,-151]]){
    add([.12,.42,b-a],[-200+side*9.95,4.13,(a+b)/2],mats.steel,undefined,false);
    add([.035,.065,b-a],[-200+side*9.88,4.22,(a+b)/2],mats['aged-copper'],undefined,false);
  }
  for(const item of CITY_CONTINUITY.signs){sign(item.text,...item.position,item.width,item.height,'#e0d3af',item.yaw);if(item.backed)add([item.width,item.height,.07],[item.position[0]-Math.sin(item.yaw)*.045,item.position[1],item.position[2]-Math.cos(item.yaw)*.045],mats.steel,[0,item.yaw,0]);}
  const lightAnchors=[];
  for(const light of CITY_CONTINUITY.lights){add(light.lensSize,light.position,mats.amber,undefined,false);lightAnchors.push(light);}

  // Readable road-space hierarchy continues around all four legs. Every new
  // raised footway, street fixture and seat below has a CITY_ROUTE_CORRIDOR
  // physical counterpart; paint and drainage remain thin optical finishes.
  for(const leg of CITY_ROUTE_CORRIDOR.legs){
    const street=CITY_STREETS.find(s=>s.id===leg.id),vertical=street.points[0][0]===street.points[1][0],centre=vertical?street.points[0][0]:street.points[0][2],half=street.width/2;
    const pos=(along,across,y)=>vertical?[centre+across,y,along]:[along,y,centre+across];
    const size=(along,across,h)=>vertical?[across,h,along]:[along,h,across];
    for(const side of [-1,1]){
      // A deep mineral edge, lower dirt band, and a consistent 0.60 m paving
      // scale create contact and depth without hundreds of separate pavers.
      add(size(leg.to-leg.from,.11,.042),pos((leg.from+leg.to)/2,side*(half+.07),.101),mats.ivory,undefined,false);
      add(size(leg.to-leg.from,.014,.037),pos((leg.from+leg.to)/2,side*(half+.008),.020),mats.dark,undefined,false);
      add(size(leg.to-leg.from,.10,.006),pos((leg.from+leg.to)/2,side*(half-.36),.020),mats.paint,undefined,false);
      for(let along=leg.from+9;along<leg.to;along+=26){
        add(size(.76,.25,.010),pos(along,side*(half-.15),.023),mats.dark,undefined,false);
        for(let k=0;k<6;k++)add(size(.032,.23,.010),pos(along-.31+k*.125,side*(half-.15),.032),mats.steel,undefined,false);
      }
    }
    // Painted turning pockets are broad in silhouette. They do not take away
    // tyre grip or inject a steering force; physics still owns the surface.
    for(const along of [leg.from+12,leg.to-12])for(const side of [-1,1]){
      const lane=side*street.width*.25;
      add(size(2.6,.19,.006),pos(along,lane,.027),mats.paint,undefined,false);
      for(const tip of [-1,1]){
        const a=pos(along+side*1.30,lane,.027),b=pos(along+side*.30,lane+tip*.74,.027);
        add([.17,.006,Math.hypot(b[0]-a[0],b[2]-a[2])],[(a[0]+b[0])/2,.027,(a[2]+b[2])/2],mats.paint,[0,Math.atan2(b[0]-a[0],b[2]-a[2]),0],false);
      }
    }
    for(const along of [leg.from+4,leg.to-4]){
      for(let across=-half+1;across<half-1;across+=1.25)add(size(2.8,.53,.006),pos(along,across,.029),mats.paint,undefined,false);
      add(size(.29,half-.8,.006),pos(along+(along===leg.from+4?3.5:-3.5),-half/2,.029),mats.paint,undefined,false);
    }
  }
  for(const light of CITY_ROUTE_CORRIDOR.lights){add(light.lensSize,light.position,mats.amber,undefined,false);lightAnchors.push(light);}
  for(const g of CITY_ROUTE_CORRIDOR.solids.filter(s=>s.data.part==='bench')){
    const [x,y,z]=g.position,w=g.size[0],d=g.size[2],alongX=w>d;
    for(const u of [-.65,.65])add(alongX?[.075,.41,.42]:[.42,.41,.075],[x+(alongX?u:0),.325,z+(alongX?0:u)],mats.steel);
    for(let k=0;k<4;k++)add(alongX?[1.76,.055,.09]:[.09,.055,1.76],[x+(alongX?0:(k-1.5)*.12),.55,z+(alongX?(k-1.5)*.12:0)],mats['corridor-wood']);
    for(const yy of [.78,.94])add(alongX?[1.76,.11,.045]:[.045,.11,1.76],[x+(alongX?0:.23),yy,z+(alongX?.23:0)],mats['corridor-wood']);
  }

  for(let z=-397;z<40;z+=28)for(const side of [-1,1]){
    const x=-200+side*9.4;add([.13,7.5,.13],[x,3.75,z],mats.steel);add([1.4,.13,.48],[x-side*.6,7.52,z],mats.steel);add([.9,.035,.32],[x-side*.6,7.43,z],mats.amber);lightAnchors.push({position:[x-side*.6,7.30,z],target:[-200+side*2.0,.08,z+2],color:z<-310?0xf7c28e:z<-238?0xc7e2ef:0xe8bfa0,intensity:980,range:28,practical:true,role:'street'});
  }
  const backgroundLights=backgroundLightLayout(CITY_STREETS,CITY_ROUTES,plannedDistrictAt);
  for(const {pole,head,target,side}of backgroundLights.lights){
    add([.11,8,.11],[pole[0],4,pole[2]],mats.steel);
    // The lens belongs to the actual cantilever; its inward cut-off cone
    // reaches the carriageway instead of pointing at an empty kerb patch.
    add([1.5,.10,.5],[head[0],8,head[2]],mats.steel);add([1.1,.035,.35],[head[0],7.93,head[2]],mats.amber);
    lightAnchors.push({id:'grid-road-'+pole[0]+'-'+pole[2],position:head,target,surfaceY:0,color:side<0?0xc5d8e6:0xe5c79e,intensity:1450,range:32,angle:.96,penumbra:.42,practical:true,role:'street'});
  }
  for(let z=154;z<490;z+=34)for(const side of [-1,1]){
    const x=100+side*10.2;add([.12,7.2,.12],[x,3.6,z],mats.steel);add([1.2,.09,.45],[x-side*.45,7.2,z],mats.steel);add([.85,.025,.25],[x-side*.45,7.14,z],mats.amber);
    lightAnchors.push({id:'foundry-avenue-'+side+'-'+z,position:[x-side*.45,7.10,z],target:[100+side*2.6,.08,z+3.0],surfaceY:0,color:side<0?0xc8dce4:0xe7c29a,intensity:1150,range:29,angle:.96,penumbra:.45,practical:true,role:'street'});
  }
  // Lamps are fixed to the existing upper arcade underside. The upper-city
  // light-selection plane is the actual 8 m street, not the ground at y=0.
  for(const side of [-1,1])for(const [a,b]of [[150,231],[249,313],[331,401]])for(let j=0,n=Math.ceil((b-a-14)/29);j<=n;j++){
    const z=Number((a+7+(b-a-14)*j/n).toFixed(4));
    const x=400+side*17.5;add([.60,.08,2.15],[x,15.66,z],mats.steel,undefined,false);
    add([.42,.025,1.85],[x,15.6075,z],mats.amber,undefined,false);
    lightAnchors.push({id:'forum-arcade-'+side+'-'+z,position:[x,15.578,z],target:[400+side*4.4,8.08,z+3],surfaceY:8,color:0xdbd7bb,intensity:1400,range:30,angle:.92,penumbra:.45,practical:true,role:'street'});
  }
  // Recessed rail luminaires use the inherited ramp barrier as their support.
  // They continue the route's direction across the ground/elevated transition
  // without an extra pole or collision volume in the lane.
  for(const route of CITY_ROUTES.filter(r=>r.id.startsWith('terrace-')))route.points.slice(1).forEach((b,i)=>{
    const a=route.points[i],length=Math.hypot(...b.map((v,k)=>v-a[k]));
    const barrier=geometryById.get(route.id+'-barrier-'+i+'-1');if(!barrier)return;
    const q=new THREE.Quaternion(...barrier.quaternion),rotation=new THREE.Euler().setFromQuaternion(q).toArray().slice(0,3),normalUp=new THREE.Vector3(0,1,0).applyQuaternion(q),right=new THREE.Vector3(1,0,0).applyQuaternion(q);
    for(const side of [-1,1])for(let distance=5+(side>0?9:0),index=0;distance<length-3;distance+=18,index++){
      const t=distance/length,centre=new THREE.Vector3(...a.map((v,k)=>v+(b[k]-v)*t)),surfaceY=centre.y;
      const mount=centre.clone().addScaledVector(right,side*(route.width/2-.22)).addScaledVector(normalUp,.722);
      const position=mount.clone().addScaledVector(normalUp,.04);
      const target=centre.clone().addScaledVector(right,side*2.1).addScaledVector(normalUp,.08);
      add([.29,.048,.72],mount.toArray(),mats.steel,rotation,false);
      add([.20,.030,.56],position.toArray(),mats.amber,rotation,false);
      lightAnchors.push({id:'ramp-rail-'+route.id+'-'+i+'-'+side+'-'+index,position:position.toArray(),target:target.toArray(),surfaceY,color:0xb7d8dd,intensity:230,range:19,angle:.92,penumbra:.32,practical:true,role:'route-rail',mount:{sharedGeometryId:route.id+'-barrier-'+i+'-'+side,backingCentre:mount.toArray(),normal:normalUp.toArray()}});
    }
  });
  for(const [x,z]of [[-203.2,-279],[-196.8,-255],[-201.8,-230],[-198.2,-218]]){add([.80,.055,.26],[x,7.35,z],mats.amber,undefined,false);lightAnchors.push({position:[x,7.25,z],color:0xdeb996,intensity:1080,range:24,practical:true});}
  // Twin soffit lanes belong to the existing upper walkways. The visible
  // lenses and finite cones are the same sources used by the night bake;
  // the render pool remains bounded at 2/3/4 shadowed fixtures.
  for(const side of [-1,1])for(let z=-311;z<=-245;z+=11){
    const x=-200+side*7.70;
    add([.34,.055,1.75],[x,5.06,z],mats.steel,undefined,false);
    add([.20,.025,1.50],[x,5.02,z],mats.amber,undefined,false);
    lightAnchors.push({id:'exchange-soffit-'+side+'-'+z,position:[x,4.98,z],target:[-200+side*3.5,.16,z+1.5],color:0xefdabc,intensity:220,range:18,angle:.86,practical:true,role:'soffit'});
  }
  lightAnchors.push(...(architecture.lightAnchors||[]),...(streetLife.lightAnchors||[]),...(landmarks.lightAnchors||[]));
  lightAnchors.forEach((a,index)=>{a.id??='city-fixture-'+index;});
  // A little street furniture lives outside the drivable lane, at human scale.
  for(let k=0;k<30;k++){const z=-399+k*14,side=k%2?-1:1,x=-200+side*10.6;add([.75,1.1,.72],[x,.66,z],mats.steel);add([.8,.09,.77],[x,1.25,z],mats.dark);if(k%3===0){add([1.7,.06,.55],[x,.58,z+2],mats.paint);for(const dz of [-.6,.6])add([.08,.55,.4],[x,.29,z+2+dz],mats.steel);}}
  const visibility=createCityVisibility(THREE);
  for(const [mat,items] of buckets){
    const cells=new Map();
    for(const item of items){
      const pos=item.pos,kind=mat===mats.paint?'signs':mat===mats.glass?'glass':mat===mats.concrete?'concrete':mat===mats.dark?'darkConcrete':'metal';
      const level=item.level||(mat===mats.road?'mass':architectureDetailLevel(kind,'box',item.size));
      const key=Math.floor(pos[0]/160)+','+Math.floor(pos[2]/160)+'|'+level+'|'+!!item.shadow;
      if(!cells.has(key))cells.set(key,{level,items:[]});cells.get(key).items.push(item);
    }
    for(const [cell,batch]of cells){
      const geometry=mat.userData.showcaseLighting&&batch.items.some(item=>item.showcaseLight)?unit.clone():unit;
      if(mat.userData.showcaseLighting)installShowcaseLighting(THREE,geometry,batch.items);
      const mesh=new THREE.InstancedMesh(geometry,mat,batch.items.length);mesh.name='Street structures / '+cell;mesh.castShadow=batch.items[0].shadow;mesh.receiveShadow=true;
      batch.items.forEach((v,i)=>{temp.position.set(...v.pos);if(v.quaternion)temp.quaternion.set(...v.quaternion);else temp.rotation.set(...(v.rot||[0,0,0]));temp.scale.set(...v.size);temp.updateMatrix();mesh.setMatrixAt(i,temp.matrix);if(v.tint!==null&&v.tint!==undefined)mesh.setColorAt(i,new THREE.Color(v.tint));});mesh.computeBoundingSphere();root.add(mesh);visibility.add(mesh,{level:batch.level});
    }
  }
  for(const mesh of root.children){if(mesh.isMesh&&!mesh.isInstancedMesh)visibility.add(mesh,{level:mesh.userData.renderDetail||((mesh===streetSurface)?'mass':mesh===cableMesh?'detail':'facade')});}
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{day:{value:0}},vertexShader:'varying vec3 dir;void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 dir;uniform float day;void main(){vec3 d=normalize(dir);float h=max(0.,d.y);vec3 c=mix(vec3(.07,.09,.105),vec3(.008,.014,.025),pow(h,.4));c=mix(c,mix(vec3(.44,.48,.50),vec3(.15,.29,.43),pow(h,.5)),day);gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(1700,32,16),skyMat);root.add(sky);
  const hemi=new THREE.HemisphereLight(0xd5e5f5,0x665c4d,.28);scene.add(hemi);
  let quality='balanced',profile=cityRenderProfile(quality),csm=null,hdr=null,sunlessSky=null,skyEnvironment=null,nightEnvironment=null;
  let weatherPreset='clear-day',presentation=CITY_WEATHER_PRESETS['clear-day'];
  const practicals=createCityPracticalLights(scene,lightAnchors.filter(a=>a.practical),{surfaceHeight:p=>cityPracticalRoadHeight(p,CITY_STREETS,CITY_ROUTES)});
  const wetReflection=createWetRoadReflection(scene,renderer,camera,roadSurface);
  const emissiveBases=new Map();
  let lastShadowTime=-Infinity,lastProbeTime=-Infinity,probeFace=-1,cubeTarget=null,cube=null,vehicleRoot=null;
  const lastShadowPoint=new THREE.Vector3(Infinity,Infinity,Infinity),lastProbe=new THREE.Vector3(Infinity,Infinity,Infinity);
  const originalMaterials=new Map(),staticMaterials=new Set(),probeMaterials=new Map(),particleAmbient=new THREE.Color(.70,.74,.76);
  let shadowConfiguration=null,shadowVehicleRoot=null;const shadowMotion=createShadowMotionTracker();
  const renderStats={quality,shadowCascades:1,shadowSize:1024,shadowHz:30,shadowUpdates:0,shadowUpdatedThisFrame:false,pointLights:0,spotShadowMaps:0,planarReflectionPasses:0,practicalLights:practicals.stats,wetRoadReflection:wetReflection.stats,probeSize:0,probeFacesPerFrame:0,probeFacesRendered:0,probeCaptures:0,probePendingFace:-1,probeShadowMode:'Dedicated local sun depth; one physical direct sun in cube faces',probeSun:probeSun.stats,lastProbeCpuMs:0,visibility:visibility.stats};
  const stats={continuity:{version:CITY_CONTINUITY.version,streetEdge:CITY_CONTINUITY.streetEdge,streetCoverage:CITY_CONTINUITY.coverage,connectionSegments:CITY_CONTINUITY.connectionCoverage.length,backgroundLightsExcluded:backgroundLights.excluded,streetSections:{version:CITY_CONTINUITY.streetSections.version,forecourts:CITY_CONTINUITY.streetSections.forecourts,laneSections:CITY_CONTINUITY.streetSections.laneSections,limits:CITY_CONTINUITY.streetSections.limits},connectorFootways:CITY_CONTINUITY.connectorFootways,horizon:horizon.stats},cityPlan:{districts:CITY_PLAN.districts.length,nodes:CITY_NODES.length,streets:CITY_STREETS.length,version:CITY_PLAN.version},corridor:{version:'3.9',sharedSolids:CITY_ROUTE_CORRIDOR.solids.length,fixtures:CITY_ROUTE_CORRIDOR.lights.length,legs:CITY_ROUTE_CORRIDOR.legs},indirectLighting:indirect.stats,nightIndirectLighting:nightIndirect.stats,nightDirectLighting:nightDirect.stats,lightingDiagnostics:{selectionAnchor:'Main viewing camera, including fixed and paused views',practicals:practicals.stats,nightField:nightIndirect.stats,nightDirectField:nightDirect.stats,lastReflection:null},roadSurface:roadSurface.model,preparedRoute:roadSurface.routeState,routeDetails:{version:routeDetails.version,anchors:routeDetails.anchors,textureBytesAdded:routeDetails.textureBytesAdded,limits:routeDetails.limits},buildings:CITY_BUILDINGS.length,architecture:architecture.stats,streetLife:streetLife.stats,landmarks:landmarks.stats,routes:CITY_ROUTES.length,shadowCascades:1,benchmarkRoute:{id:CITY_BENCHMARK_ROUTE.id,lengthMetres:CITY_BENCHMARK_ROUTE.lengthMetres,estimatedDurationS:CITY_BENCHMARK_ROUTE.estimatedDurationS},weatherPreset,wetReflections:false,daylight:'CC0 measured midday sky / calibrated sun + baked diffuse',vehicleLocalProbe:false,renderBudget:renderStats,liveScene:{}};
  scene.fog=new THREE.FogExp2(0xa2b5bf,.00055);
  function calibrateShadowBias(){
    csm?.lights.forEach(l=>{const camera=l.shadow.camera,texel=(camera.right-camera.left)/l.shadow.mapSize.x;l.shadow.normalBias=Math.min(.065,Math.max(.005,texel*.40));});
  }
  function bindMaterial(mat){
    if(!originalMaterials.has(mat))originalMaterials.set(mat,{compile:mat.onBeforeCompile,key:mat.customProgramCacheKey()});
    const base=originalMaterials.get(mat);csm.setupMaterial(mat);const shadowCompile=mat.onBeforeCompile;
    const variant=cityLightingVariant({quality,night:presentation.night,isStatic:staticMaterials.has(mat)});
    mat.userData.cityLightingVariant=variant;
    mat.onBeforeCompile=function(shader,r){base.compile?.call(this,shader,r);shadowCompile.call(this,shader,r);injectCityMaterialLighting(shader,{variant,indirect,nightIndirect,nightDirect,probeSun});};
    mat.customProgramCacheKey=()=>base.key+'|vesper-csm-'+csm.cascades+'|'+variant.key+'|'+indirect.shaderKey+'|'+nightIndirect.shaderKey+'|'+nightDirect.shaderKey+'|receiver-plane-pcf-3.11';
    mat.needsUpdate=true;
  }
  function setupMaterials(){root.traverse(o=>{if(o.isMesh)for(const mat of Array.isArray(o.material)?o.material:[o.material])if(mat?.isMeshStandardMaterial)staticMaterials.add(mat);});scene.traverse(o=>{if(!o.isMesh)return;for(const mat of Array.isArray(o.material)?o.material:[o.material])if(mat?.isMeshStandardMaterial&&(!originalMaterials.has(mat)||mat.userData.cityLightingVariant?.isStatic!==staticMaterials.has(mat)))bindMaterial(mat);});probeSun.refreshCasters();}
  function createShadows(){
    const night=presentation.night,cascades=night?1:profile.shadowCascades,size=night?1024:profile.shadowSize,far=night?105:profile.shadowFar;
    const configuration=[night,cascades,size,far,quality==='balanced'?'vertex':'fragment'].join('|');
    // No sun is evaluated at night. High and ultra use the same transport
    // shader structure and zero-intensity CSM placeholder, so retain its
    // uniforms/program cache across that switch. Recreating a three-cascade
    // daylight system here used to dispose every city material needlessly.
    if(night&&csm&&configuration===shadowConfiguration){
      for(const mat of originalMaterials.keys())mat.userData.cityLightingVariant=cityLightingVariant({quality,night:true,isStatic:staticMaterials.has(mat)});
      renderStats.nightShadowSystemReuses=(renderStats.nightShadowSystemReuses||0)+1;
      Object.assign(renderStats,{shadowCascades:cascades,shadowSize:size,shadowHz:profile.shadowHz,nightSunShadowMaps:0});stats.shadowCascades=cascades;
      return;
    }
    if(csm){
      csm.remove();csm.lights.forEach(l=>{l.shadow.map?.dispose();l.shadow.mapPass?.dispose();});csm.dispose();
      // CSM.dispose removes its shader uniforms. Returning to an earlier
      // quality must not reuse that material's cached program/uniform table.
      // Material disposal clears renderer program state, retaining textures.
      for(const mat of originalMaterials.keys())mat.dispose();
    }
    csm=new CSM({camera,parent:scene,cascades,maxFar:far,mode:'custom',customSplitsCallback:(count,near,far,out)=>{if(count===1)out.push(1);else if(count===2)out.push(38/far,1);else out.push(22/far,82/far,1);},shadowMapSize:size,shadowBias:-.00001,lightDirection:new THREE.Vector3(-.554,-.743,-.376).normalize(),lightIntensity:presentation.sunIntensity,lightMargin:220,lightFar:650});
    // CSM's constructor defaults with `options.lightIntensity || 3`, so an
    // authored zero is lost there. Explicitly apply the actual preset after
    // construction; the night placeholder must never add a hidden sun.
    csm.fade=true;csm.updateFrustums();csm.lights.forEach(l=>{l.intensity=presentation.sunIntensity;l.color.set(presentation.sunColor);l.castShadow=!presentation.night;l.shadow.radius=2;});calibrateShadowBias();
    for(const mat of originalMaterials.keys())bindMaterial(mat);setupMaterials();
    shadowConfiguration=configuration;
    lastShadowTime=-Infinity;Object.assign(renderStats,{shadowCascades:cascades,shadowSize:size,shadowHz:profile.shadowHz});stats.shadowCascades=cascades;
  }
  function restoreVehicleEnvironment(){
    for(const [material,original]of probeMaterials){material.envMap=original.envMap;material.envMapIntensity=original.intensity;material.needsUpdate=true;}
  }
  function configureProbe(){
    restoreVehicleEnvironment();probeMaterials.clear();vehicleRoot=null;probeFace=-1;lastProbeTime=-Infinity;lastProbe.set(Infinity,Infinity,Infinity);
    probeSun.configure(presentation.night?0:profile.probeShadowSize??(quality==='balanced'?0:quality==='ultra'?768:512));
    const configured=configureCubeProbeTarget(scene,{target:cubeTarget,camera:cube},profile.probeSize,profile.probeFar);cubeTarget=configured.target;cube=configured.camera;
    Object.assign(renderStats,{probeSize:profile.probeSize,probeFacesPerFrame:0,probePendingFace:-1});stats.vehicleLocalProbe=!!profile.probeSize;
  }
  function setQuality(q,overrides={}){
    quality=q;profile=cityRenderProfile(q,overrides);renderStats.quality=q;
    indirect.setQuality(q,profile);nightIndirect.setQuality(q);nightDirect.setQuality(q);indirect.setAOEnabled(q!=='balanced');
    roadSurface.setQuality(q);
    architecture.setQuality(q,profile);streetLife.setQuality(q,profile);landmarks.setQuality(q,profile);visibility.setQuality(q,profile);
    for(const t of [normal,rough,albedo]){const next=q==='balanced'?2:8;if(t.anisotropy!==next){t.anisotropy=next;t.needsUpdate=true;}}
    practicals.configure(q);wetReflection.configure(q);wetReflection.setEnabled(presentation.night);stats.wetReflections=presentation.night&&q!=='balanced';
    createShadows();configureProbe();
  }
  const skyReady=typeof document==='undefined'?Promise.resolve(false):new Promise(resolve=>new HDRLoader().load('./assets/daylight.hdr',async t=>{
    hdr=t;t.mapping=THREE.EquirectangularReflectionMapping;
    await indirect.ready;sunlessSky=makeSunlessEnvironment(t,indirect.metadata);
    const pmrem=new THREE.PMREMGenerator(renderer);skyEnvironment=pmrem.fromEquirectangular(sunlessSky).texture;pmrem.dispose();
    setWeatherPreset(weatherPreset);resolve(true);
  },undefined,()=>resolve(false)));
  const ready=Promise.all([skyReady,architecture.ready,landmarks.ready,streetLife.ready,indirect.ready,nightIndirect.ready,nightDirect.ready]);
  // Register asynchronously arriving materials when the assets arrive. There
  // is no permanent two-second traversal of every city object.
  landmarks.ready.then(setupMaterials);streetLife.ready.then(setupMaterials);
  function collectEmissives(){
    root.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.emissiveIntensity>0&&!emissiveBases.has(m))emissiveBases.set(m,m.emissiveIntensity);});
  }
  function setWeatherPreset(value){
    if(!Object.hasOwn(CITY_WEATHER_PRESETS,value))return false;
    const previousNight=presentation.night;
    weatherPreset=value;presentation=CITY_WEATHER_PRESETS[value];const night=presentation.night;horizon.setNight(night);
    // An offline daylight transport field is not a night solution. Disable it
    // and use the low energy night environment plus actual selected fixtures.
    indirect.setEnabled(!night);nightIndirect.setEnabled(night);nightDirect.setEnabled(night);streetLife.setWetness?.(presentation.wetness);roadSurface.setWetness(presentation.wetness);pavementSurfaces.forEach(surface=>surface.setWetness(presentation.wetness));practicals.setEnabled(night);wetReflection.setEnabled(night);
    skyMat.uniforms.day.value=night?0:1;sky.visible=night||!hdr;
    scene.background=!night&&hdr?hdr:new THREE.Color(presentation.fog);scene.backgroundIntensity=presentation.backgroundIntensity;scene.backgroundBlurriness=0;
    scene.fog.color.set(presentation.fog);scene.fog.density=presentation.fogDensity;
    if(night&&!nightEnvironment&&typeof document!=='undefined'){
      const nightScene=new THREE.Scene();nightScene.background=new THREE.Color(0x111b2a);
      const dome=new THREE.Mesh(new THREE.SphereGeometry(25,20,12),skyMat.clone());nightScene.add(dome);
      const generator=new THREE.PMREMGenerator(renderer);const generated=generator.fromScene(nightScene,.06,.1,60);nightEnvironment=generated.texture;
      generator.dispose();dome.geometry.dispose();dome.material.dispose();
    }
    scene.environment=night?nightEnvironment:skyEnvironment;scene.environmentIntensity=presentation.environmentIntensity;
    hemi.intensity=night?presentation.ambientIntensity:indirect.stats.loaded?0:.28;hemi.color.set(night?0x89a9cf:0xd5e5f5);hemi.groundColor.set(night?0x15121d:0x665c4d);
    csm?.lights.forEach(l=>{l.intensity=presentation.sunIntensity;l.color.set(presentation.sunColor);l.castShadow=!night;});
    collectEmissives();for(const [m,base]of emissiveBases)m.emissiveIntensity=m.userData?.windowBacklight?(night?base*2.1:0):night?Math.min(2.1,Math.max(.18,base*3.0)):base;
    particleAmbient.set(night?0x3a506c:0xb3bdc2);
    stats.weatherPreset=value;stats.wetReflections=night&&quality!=='balanced';stats.daylight=night?'Night sky; static visible fixture direct + bounce; complementary near live diffuse, dynamic vehicle/headlamps; daylight GI disabled':'CC0 measured midday sky / calibrated sun + baked diffuse';
    lastShadowTime=-Infinity;configureProbe();
    if(previousNight!==night){
      // CSM tracks the last compiled shader per material. Retire its program
      // tables together with the transport variant so returning to a cached
      // weather cannot skip onBeforeCompile and leave stale CSM uniforms.
      createShadows();
    }
    return true;
  }
  const setDay=value=>setWeatherPreset(value===false?'wet-night':'clear-day');
  setQuality('balanced');setWeatherPreset('clear-day');
  ready.then(()=>{collectEmissives();setWeatherPreset(weatherPreset);});
  let lastSceneStats=-Infinity;
  return {root,ready,setDay,setWeatherPreset,get weatherPreset(){return weatherPreset;},getPresentation:()=>({...presentation}),setRouteSurfaceDescription:value=>roadSurface.setRouteSurfaceDescription(value),getRouteSurfaceDescription:()=>roadSurface.getRouteSurfaceDescription(),getBenchmarkRoute:()=>CITY_BENCHMARK_ROUTE,getPracticalLightAnchors:()=>lightAnchors.filter(a=>a.practical).map(a=>structuredClone(a)),setVehicleRoot:r=>{shadowVehicleRoot=r;shadowMotion.reset();practicals.setVehicleRoot(r);},setQuality,stats,exposureAt:(p,sunVisible)=>presentation.night?presentation.exposure:Math.min(2.0,indirect.exposureAt(p,sunVisible))*presentation.exposure/.90,setContactAO:t=>indirect.setContactAO(t),
    particleLighting(){return {ambient:particleAmbient,lights:[]};},
    resize(){csm.updateFrustums();calibrateShadowBias();indirect.resize();lastShadowTime=-Infinity;},
    wantsShadowUpdate(time,p,displayPose={}){
      const motion=shadowMotion.sample(p,{...displayPose,camera,shapeRevision:shadowVehicleRoot?.userData.shadowShapeRevision});
      const teleported=lastShadowPoint.distanceToSquared(p)>225;
      const sunNeeded=!presentation.night&&(teleported||motion.casterChanged||motion.cameraChanged||time-lastShadowTime>=1/profile.shadowHz);
      const localNeeded=practicals.wantsShadowUpdate(time,{casterChanged:motion.casterChanged});
      const needed=sunNeeded||localNeeded;
      Object.assign(renderStats,{shadowUpdatedThisFrame:needed,shadowPolicy:SHADOW_MOTION_POLICY,
        shadowMotion:motion,shadowIdleHz:profile.shadowHz});
      if(needed){
        if(sunNeeded){camera.updateMatrixWorld();csm.update();lastShadowTime=time;}
        lastShadowPoint.copy(p);renderStats.shadowUpdates++;
        if(motion.casterChanged||motion.cameraChanged)renderStats.motionShadowUpdates=(renderStats.motionShadowUpdates||0)+1;
      }
      return needed;
    },
    update(time,p){
      renderStats.probeFacesPerFrame=0;probeSun.beginFrame();sky.position.copy(p);
      const viewpoint=camera.position;architecture.update(time,viewpoint);streetLife.update(time,viewpoint);landmarks.update(time,viewpoint);visibility.update(time,viewpoint);practicals.update(time,viewpoint,camera);nightDirect.update(camera,practicals.stats);
      renderStats.spotShadowMaps=practicals.stats.shadowMaps;renderStats.pointLights=0;
      if(time-lastSceneStats>.25){
        const budgets=[visibility.stats,architecture.stats.renderBudget,streetLife.stats.renderBudget,landmarks.stats.renderBudget];
        stats.liveScene={allocatedBatches:budgets.reduce((s,b)=>s+b.allocatedBatches,0),activeDistanceBatches:budgets.reduce((s,b)=>s+b.activeBatches,0),activeDistanceTriangles:budgets.reduce((s,b)=>s+b.activeTriangles,0),shadowDistanceBatches:budgets.reduce((s,b)=>s+b.shadowBatches,0),shadowDistanceTriangles:budgets.reduce((s,b)=>s+b.shadowTriangles,0),visibilityCpuMs:budgets.reduce((s,b)=>s+b.updateMs,0)};
        lastSceneStats=time;
      }
    },
    updateReflections(time,p,exclude=[]){
      const aoBefore=indirect.uniforms.giAOEnabled.value;indirect.setAOEnabled(false);
      try{wetReflection.render(time,exclude.slice(1),{dynamicRoot:exclude[0],practicalLights:practicals.stats.selected});}finally{indirect.setAOEnabled(aoBefore>.5);}
      renderStats.planarReflectionPasses=wetReflection.stats.passesThisFrame;
      if(wetReflection.stats.passesThisFrame)stats.lightingDiagnostics.lastReflection={time,cameraPosition:camera.position.toArray(),vehiclePosition:[p.x,p.y,p.z],weatherPreset};
      if(!cubeTarget||(!hdr&&!presentation.night))return;
      const vehicle=exclude[0];if(vehicle&&vehicle!==vehicleRoot){restoreVehicleEnvironment();probeMaterials.clear();vehicleRoot=vehicle;vehicle.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.isMeshStandardMaterial&&!probeMaterials.has(m))probeMaterials.set(m,{envMap:m.envMap,intensity:m.envMapIntensity});});}
      if(probeFace<0){
        const age=time-lastProbeTime,moved=lastProbe.distanceToSquared(p)>=profile.probeDistance**2;
        if(age<profile.probeInterval||(!moved&&age<(profile.probeMaxAge??7)))return;
        cube.position.set(p.x,p.y+.55,p.z);cube.updateMatrixWorld(true);probeFace=0;
      }
      // One face per displayed frame replaces the old six-render burst. A
      // complete filtered cube becomes available only after all six faces.
      if(cube.coordinateSystem!==renderer.coordinateSystem){cube.coordinateSystem=renderer.coordinateSystem;cube.updateCoordinateSystem();}
      const hidden=exclude.filter(Boolean),states=hidden.map(o=>o.visible),background=scene.background,backgroundIntensity=scene.backgroundIntensity,ao=indirect.uniforms.giAOEnabled.value;
      const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),xr=renderer.xr.enabled,shadowAuto=renderer.shadowMap.autoUpdate,shadowNeeded=renderer.shadowMap.needsUpdate;
      const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
      scene.background=presentation.night?new THREE.Color(presentation.fog):sunlessSky;scene.backgroundIntensity=presentation.night?1:.80;indirect.setAOEnabled(false);hidden.forEach(o=>o.visible=false);renderer.xr.enabled=false;
      renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;cubeTarget.texture.generateMipmaps=probeFace===5;
      const begin=performance.now();
      try{
        // Every face sees the same capture origin and dedicated sunlight map.
        // This sparse depth pass never replaces or refreshes the main CSM maps.
        if(probeFace===0&&!presentation.night)probeSun.render(cube.position,profile.probeFar);
        probeSun.setActive(!presentation.night);renderer.setScissorTest(false);
        renderer.setRenderTarget(cubeTarget,probeFace,0);renderer.render(scene,cube.children[probeFace]);
        renderStats.probeFacesPerFrame=1;renderStats.probeFacesRendered++;probeFace++;
        if(probeFace===6){
          cubeTarget.texture.needsPMREMUpdate=true;
          for(const m of probeMaterials.keys()){const changed=m.envMap!==cubeTarget.texture;m.envMap=cubeTarget.texture;m.envMapIntensity=1;if(changed)m.needsUpdate=true;}
          lastProbe.copy(cube.position);lastProbeTime=time;probeFace=-1;renderStats.probeCaptures++;
        }
      }finally{
        renderStats.lastProbeCpuMs=performance.now()-begin;renderStats.probePendingFace=probeFace;
        renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeded;
        renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
        renderer.setRenderTarget(target,face,mip);
        cubeTarget.texture.generateMipmaps=true;scene.background=background;scene.backgroundIntensity=backgroundIntensity;indirect.setAOEnabled(ao>.5);hidden.forEach((o,i)=>o.visible=states[i]);
        probeSun.setActive(false);
      }
    }
  };
}
