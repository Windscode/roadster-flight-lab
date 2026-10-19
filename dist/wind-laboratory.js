import * as THREE from './vendor/three.module.js';
import {mergeGeometries} from './vendor/addons/utils/BufferGeometryUtils.js';
import {WIND_LAB_GEOMETRY,WIND_LAB_DIMENSIONS} from './wind-lab-data.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finiteVector=v=>v&&[v.x,v.y,v.z].every(Number.isFinite);
const QUALITY=Object.freeze({balanced:{flowCount:44,shadowSize:1024,shadowHz:20,detail:false},high:{flowCount:100,shadowSize:1536,shadowHz:30,detail:true},ultra:{flowCount:160,shadowSize:2048,shadowHz:40,detail:true}});

/**
 * One room, one simulation datum, one shadow map. Flow tracers are passive
 * samples of the supplied spatially uniform wind velocity; they do not infer
 * a wake, separation, pressure, turbulence or CFD around the vehicle.
 *
 * Use a separate Scene and Roadster instance: city CSM/irradiance shaders are
 * deliberately not applied here. Call update(telemetry, physicalDeltaSeconds)
 * only for the active scene. A zero physical delta leaves flow and fans still.
 */
export function createWindLaboratory(scene,renderer,camera,geometry=WIND_LAB_GEOMETRY){
  const group=new THREE.Group();group.name='VECTOR / 07 — Roadster wind-field laboratory';scene.add(group);
  const originalBackground=scene.background,originalFog=scene.fog,originalEnvironment=scene.environment,originalEnvironmentIntensity=scene.environmentIntensity;
  scene.background=new THREE.Color(0x263941);scene.fog=new THREE.Fog(0x455861,95,180);scene.environmentIntensity=.65;
  const geometries=new Set(),materials=new Set(),textures=new Set(),batches=new Map(),detailMeshes=[];
  const keepGeometry=g=>{geometries.add(g);return g;},keepMaterial=m=>{materials.add(m);return m;};
  const standard=(color,roughness=.7,metalness=0)=>keepMaterial(new THREE.MeshStandardMaterial({color,roughness,metalness}));
  const basic=(color,extra={})=>keepMaterial(new THREE.MeshBasicMaterial({color,...extra}));
  const mats={
    floor:standard(0x677f86,.77),wall:standard(0x86979c,.84),ceiling:standard(0xc9d2d0,.88),
    frame:standard(0x30454e,.39,.64),dark:standard(0x182c36,.55,.35),panel:standard(0x657c83,.62,.20),
    aluminium:standard(0x93a6a8,.33,.76),rubber:standard(0x17272e,.94),datum:standard(0x293f49,.8),
    white:standard(0xd4dad2,.65),cyan:standard(0x78b4bb,.55,.1),amber:standard(0xbe9460,.61,.1),
    luminaire:basic(0xd5e8ec),warmLight:basic(0xffd9a3),
  };
  mats.luminaire.color.multiplyScalar(3.0);mats.warmLight.color.multiplyScalar(2.1);
  // Low-contrast neutral mineral grain. Mipmaps filter subpixel variation;
  // no per-fragment hashes or texture updates are evaluated while driving.
  const floorPixels=new Uint8Array(128*128*4);let noiseSeed=0x71d993;
  for(let i=0;i<128*128;i++){noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;const c=226+(noiseSeed>>>27);floorPixels.set([c,c,c,255],i*4);}
  const floorMap=new THREE.DataTexture(floorPixels,128,128,THREE.RGBAFormat);floorMap.wrapS=floorMap.wrapT=THREE.RepeatWrapping;floorMap.repeat.set(35,55);floorMap.generateMipmaps=true;floorMap.minFilter=THREE.LinearMipmapLinearFilter;floorMap.magFilter=THREE.LinearFilter;floorMap.colorSpace=THREE.SRGBColorSpace;floorMap.needsUpdate=true;textures.add(floorMap);mats.floor.map=floorMap;

  const unit=keepGeometry(new THREE.BoxGeometry()),matrixObject=new THREE.Object3D();
  function box(size,position,material,options={}){
    const key=material.uuid+'|'+!!options.shadow+'|'+!!options.detail;
    if(!batches.has(key))batches.set(key,{material,shadow:!!options.shadow,detail:!!options.detail,items:[]});
    batches.get(key).items.push({size,position,rotation:options.rotation||[0,0,0],quaternion:options.quaternion,id:options.id});
  }
  const colliderMaterials={'floor':mats.floor,'lab-wall':mats.wall,'lab-ceiling':mats.ceiling,'lab-structure':mats.frame,'lab-service':mats.dark};
  for(const g of geometry)box(g.size,g.position,colliderMaterials[g.kind]||mats.frame,{shadow:g.kind!=='floor',rotation:g.rotation,quaternion:g.quaternion,id:g.id});
  // A thin floor finish does not introduce steps into the physical datum.
  box([31,.004,69],[0,.003,0],mats.datum);
  for(const side of [-1,1]){
    box([.12,.005,78],[side*24,.006,0],mats.amber);
    box([.035,.005,68],[side*15.8,.006,0],mats.cyan);
    box([.07,.005,84],[side*26.4,.006,0],mats.white);
    // Perimeter service trunks and panel reveals are shallow visual detail.
    box([.18,1.2,105],[side*34.3,1.15,0],mats.dark);
    box([.10,.12,105],[side*34.18,3.4,0],mats.aluminium);
    box([.06,.10,105],[side*34.14,3.1,0],mats.cyan);
    box([.13,.22,105],[side*34.28,20.8,0],mats.frame);
    for(let z=-49.5;z<=49.5;z+=11){
      box([.12,16.6,.16],[side*34.29,12,z],mats.panel);
      box([.09,.10,10.5],[side*34.25,8.9,z],mats.panel);
      box([.09,.10,10.5],[side*34.25,15.0,z],mats.panel);
    }
    for(const z of [-33,-11,11,33]){
      box([3.3,.34,1.25],[side*28.5,.48,z],mats.frame);
      box([3.1,.04,1.1],[side*28.5,.66,z],mats.panel);
      box([2.6,.12,.055],[side*28.5,.77,z+.47],mats.warmLight);
      for(const zz of [-.40,.40])box([.18,.6,.18],[side*29.9,.8,z+zz],mats.aluminium,{detail:true});
    }
  }
  for(const z of [-44,-22,0,22,44]){
    // The beam itself is shared collision geometry; flanges add its readable
    // section without filling the large clear test volume with small objects.
    for(const y of [24.14,25.56])box([64.9,.10,1.6],[0,y,z],mats.aluminium);
    for(const side of [-1,1]){
      box([1.55,.13,1.55],[side*32,.09,z],mats.aluminium);
      box([.08,22.2,.30],[side*31.36,11.4,z],mats.cyan);
    }
  }
  // Long roof diffusers, warm service lights and ducts provide broad indoor
  // reflection features. The key/fill below approximate their integrated light.
  for(const x of [-23,-11,11,23]){
    box([1.55,.20,98],[x,25.70,0],mats.frame);
    for(const z of [-38.5,-16.5,5.5,27.5,46])box([1.30,.028,z===46?12:18],[x,25.57,z],mats.luminaire);
    if(Math.abs(x)>20)for(const z of [-36,-12,12,36])box([1.8,.025,.30],[x,25.54,z],mats.warmLight);
  }
  for(const x of [-29,29])box([1.55,.85,100],[x,25.32,0],mats.aluminium);
  // Calm layered exit wall, a sealed equipment door and an observation band.
  box([35,7,.10],[0,16.3,54.34],mats.dark);
  box([20,.15,.12],[0,12.72,54.26],mats.cyan);
  box([15,8.6,.12],[0,4.3,54.29],mats.frame);
  for(let x=-6.9;x<7;x+=1.15)box([1.10,7.6,.08],[x,4.1,54.18],mats.panel,{detail:true});
  box([16,.35,.18],[0,8.9,54.19],mats.aluminium);
  box([15.6,.05,.10],[0,8.68,54.06],mats.warmLight);
  for(const side of [-1,1]){
    box([10.5,4.8,.08],[side*24,10.5,54.34],mats.frame);
    box([10,4.25,.06],[side*24,10.5,54.27],mats.dark);
    for(const y of [8.9,10.5,12.1])box([9.4,.035,.035],[side*24,y,54.21],mats.cyan);
  }
  // The fan bank is represented by twelve instrument rotors, not simulated
  // compressor mechanics. Only the prescribed air-speed sets their animation.
  const fanCenters=[];for(const y of [5.3,15.0])for(const x of [-23,-13.8,-4.6,4.6,13.8,23])fanCenters.push([x,y,-51.18]);
  const ringGeometry=keepGeometry(new THREE.TorusGeometry(3.83,.20,8,48)),hubGeometry=keepGeometry(new THREE.CylinderGeometry(.56,.79,.65,20));hubGeometry.rotateX(Math.PI/2);
  const backGeometry=keepGeometry(new THREE.CircleGeometry(3.68,40));
  function instances(g,m,centers,name,shadow=false){const mesh=new THREE.InstancedMesh(g,m,centers.length);mesh.name=name;mesh.castShadow=shadow;mesh.receiveShadow=true;centers.forEach((p,i)=>{matrixObject.position.set(...p);matrixObject.quaternion.identity();matrixObject.scale.set(1,1,1);matrixObject.updateMatrix();mesh.setMatrixAt(i,matrixObject.matrix);});mesh.computeBoundingSphere();group.add(mesh);return mesh;}
  instances(backGeometry,mats.rubber,fanCenters.map(([x,y,z])=>[x,y,z-.045]),'fan bank recessed intake discs');
  instances(ringGeometry,mats.aluminium,fanCenters,'fan bank rolled aluminium inlet lips');
  instances(hubGeometry,mats.aluminium,fanCenters.map(([x,y,z])=>[x,y,z+.2]),'fan bank capped hubs');
  const bladeShape=new THREE.Shape();bladeShape.moveTo(.53,-.17);bladeShape.bezierCurveTo(1.05,-.08,2.1,.25,3.38,.07);bladeShape.quadraticCurveTo(3.79,.08,3.64,.59);bladeShape.bezierCurveTo(2.89,1.03,1.18,.72,.52,.22);bladeShape.closePath();
  const bladeSource=new THREE.ExtrudeGeometry(bladeShape,{depth:.10,bevelEnabled:true,bevelThickness:.025,bevelSize:.028,bevelSegments:1,curveSegments:6}),bladeParts=[];
  for(let k=0;k<7;k++){const g=bladeSource.clone();g.rotateZ(k*Math.PI*2/7);bladeParts.push(g);}const rotorGeometry=keepGeometry(mergeGeometries(bladeParts));bladeSource.dispose();bladeParts.forEach(g=>g.dispose());
  const rotors=instances(rotorGeometry,mats.panel,fanCenters.map(([x,y,z])=>[x,y,z+.065]),'prescribed wind instrument fan rotors');rotors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for(const x of [-27.3,-18.4,-9.2,0,9.2,18.4,27.3])box([.13,19.9,.22],[x,10.2,-51.22],mats.frame);
  for(const y of [.32,10.18,20.15])box([59.8,.16,.28],[0,y,-51.16],mats.aluminium);

  function lineSegments(name,segments,color,opacity=1){const g=keepGeometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(segments.flat(2),3));const m=keepMaterial(new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:false}));const mesh=new THREE.LineSegments(g,m);mesh.name=name;group.add(mesh);return mesh;}
  const grid=[];
  for(let x=-15;x<=15;x+=5)grid.push([[x,.009,-34],[x,.009,34]]);
  for(let z=-30;z<=30;z+=5)grid.push([[-15,.009,z],[15,.009,z]]);
  lineSegments('5 m floor measurement grid',grid,0x9fc6cb,.26);
  const ticks=[];
  for(let x=-24;x<=24;x++)ticks.push([[x,.012,-.18],[x,.012,x%5===0?-.75:-.40]]);
  for(let z=-40;z<=40;z++)ticks.push([[-.18,.012,z],[z%5===0?-.75:-.40,.012,z]]);
  lineSegments('1 m datum ticks with 5 m majors',ticks,0xaac6c7,.72);
  lineSegments('world lateral and longitudinal datum',[[[-24,.015,0],[24,.015,0]],[[0,.015,-41],[0,.015,41]]],0x6ea4ae,.75);
  const safeVolume=[];
  for(const side of [-1,1])for(const z of [-42,42])safeVolume.push([[side*24,.013,z],[side*20,.013,z]],[[side*24,.013,z],[side*24,.013,z-Math.sign(z)*4]]);
  lineSegments('clear experimental floor boundary',safeVolume,0xddb783,.8);
  const wallRuler=[];
  for(let h=1;h<=24;h++)for(const side of [-1,1]){const x=side*34.33;wallRuler.push([[x,h,-4],[x,h,h%5===0?-6.0:-5.0]]);}
  lineSegments('wall height datum — metres',wallRuler,0xd1dacf,.72);

  // All signs share one atlas and one merged mesh. In Node geometry checks,
  // labels are simply omitted; no fake DOM or network font is required.
  const labelSpecs=[
    {text:'VECTOR / 07',sub:'ROADSTER DYNAMICS LABORATORY',w:30,h:6.0,p:[0,16.9,54.24],r:[0,Math.PI,0]},
    {text:'FLOW CONDITIONING',sub:'PRESCRIBED FIELD  /  预设风场',w:28,h:2.6,p:[0,22.3,-54.31],r:[0,0,0]},
    {text:'01  TEST VOLUME',sub:'48 × 84 m  /  CLEAR HEIGHT 24 m',w:18,h:2.8,p:[-34.31,18.6,0],r:[0,Math.PI/2,0]},
    {text:'02  CONTROL & RESPONSE',sub:'POSITION  /  ATTITUDE  /  DISTURBANCE',w:23,h:2.8,p:[34.31,18.6,0],r:[0,-Math.PI/2,0]},
    {text:'X  /  LATERAL',sub:'横向 · WORLD AXIS',w:6,h:1.4,p:[18,.019,-2.3],r:[-Math.PI/2,0,0]},
    {text:'Z  /  FORWARD',sub:'纵向 · WORLD AXIS',w:6,h:1.4,p:[0,.019,38],r:[-Math.PI/2,0,0]},
    {text:'0 m',sub:'ORIGIN / 原点',w:3,h:.9,p:[-3,.019,-2.8],r:[-Math.PI/2,0,0]},
    {text:'REFERENCE GRID',sub:'5 m SPACING  /  1 m DATUM TICKS',w:9,h:1.8,p:[-9,.019,-29],r:[-Math.PI/2,0,0]},
    {text:'SERVICE  /  03',sub:'INSTRUMENTATION',w:5.9,h:1.8,p:[-34.31,5.6,-31],r:[0,Math.PI/2,0]},
    {text:'SERVICE  /  04',sub:'ACTUATION & ENERGY',w:5.9,h:1.8,p:[34.31,5.6,31],r:[0,-Math.PI/2,0]},
    ...[5,10,15,20].flatMap(y=>[-1,1].map(side=>({text:`${String(y).padStart(2,'0')} m`,sub:'',w:2.4,h:1.0,p:[side*34.31,y,-8.1],r:[0,-side*Math.PI/2,0]}))),
  ];
  let labelMesh=null;
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;const c=canvas.getContext('2d');
    if(c){const parts=[];c.clearRect(0,0,canvas.width,canvas.height);
      labelSpecs.forEach((s,i)=>{const col=i%4,row=Math.floor(i/4),x=col*512,y=row*128;c.fillStyle='#d3e4e2';c.textAlign='center';c.textBaseline='middle';c.font='600 39px Arial, Microsoft YaHei, sans-serif';c.fillText(s.text,x+256,y+(s.sub?44:61),480);if(s.sub){c.fillStyle='#96b8bd';c.font='500 17px Arial, Microsoft YaHei, sans-serif';c.fillText(s.sub,x+256,y+87,480);}const g=new THREE.PlaneGeometry(s.w,s.h),uv=g.getAttribute('uv');for(let j=0;j<uv.count;j++)uv.setXY(j,(col+uv.getX(j))/4,1-(row+1-uv.getY(j))/8);g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...s.p),new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.r)),new THREE.Vector3(1,1,1)));parts.push(g);});
      const atlas=new THREE.CanvasTexture(canvas);atlas.colorSpace=THREE.SRGBColorSpace;atlas.minFilter=THREE.LinearMipmapLinearFilter;atlas.anisotropy=4;textures.add(atlas);
      const g=keepGeometry(mergeGeometries(parts));parts.forEach(p=>p.dispose());labelMesh=new THREE.Mesh(g,basic(0xffffff,{map:atlas,transparent:true,alphaTest:.15,depthWrite:false}));labelMesh.name='laboratory printed information atlas';group.add(labelMesh);
    }
  }

  for(const batch of batches.values()){
    const mesh=new THREE.InstancedMesh(unit,batch.material,batch.items.length);mesh.name='laboratory '+batch.material.uuid.slice(0,7)+(batch.detail?' / detail':' / structure');mesh.castShadow=batch.shadow;mesh.receiveShadow=true;mesh.userData.colliders=[];
    batch.items.forEach((b,i)=>{matrixObject.position.set(...b.position);if(b.quaternion)matrixObject.quaternion.set(...b.quaternion);else matrixObject.quaternion.setFromEuler(new THREE.Euler(...b.rotation));matrixObject.scale.set(...b.size);matrixObject.updateMatrix();mesh.setMatrixAt(i,matrixObject.matrix);if(b.id)mesh.userData.colliders.push({id:b.id,instance:i,size:[...b.size],position:[...b.position],quaternion:matrixObject.quaternion.toArray()});});mesh.computeBoundingSphere();group.add(mesh);if(batch.detail)detailMeshes.push(mesh);
  }

  const hemi=new THREE.HemisphereLight(0xd6e8f0,0x5e7779,.75);hemi.name='laboratory integrated sky and floor fill';group.add(hemi);
  const key=new THREE.DirectionalLight(0xe8f1ec,3.05);key.name='laboratory broad overhead key approximation';key.position.set(10,25.3,17);key.target.position.set(0,4.8,0);key.castShadow=true;key.shadow.autoUpdate=false;key.shadow.camera.left=key.shadow.camera.bottom=-36;key.shadow.camera.right=key.shadow.camera.top=36;key.shadow.camera.near=.5;key.shadow.camera.far=115;key.shadow.bias=-.000012;key.shadow.normalBias=.032;key.shadow.radius=2;group.add(key,key.target);
  const fill=new THREE.DirectionalLight(0x8dc6dc,.68);fill.name='laboratory nonshadowed soft fill';fill.position.set(-16,17,-26);group.add(fill,fill.target);
  const ambient=new THREE.Color(.73,.86,.90),particleLights=[{position:new THREE.Vector3(0,22,0),color:new THREE.Color(0xc9e7f0),intensity:300,distance:65}];

  const flowGeometry=keepGeometry(new THREE.BufferGeometry()),flowPositions=new Float32Array(160*6);flowGeometry.setAttribute('position',new THREE.BufferAttribute(flowPositions,3).setUsage(THREE.DynamicDrawUsage));flowGeometry.setDrawRange(0,0);
  const flowMaterial=keepMaterial(new THREE.LineBasicMaterial({color:0xa3d3d7,transparent:true,opacity:.38,depthWrite:false})),flow=new THREE.LineSegments(flowGeometry,flowMaterial);flow.name='passive tracers of the prescribed uniform velocity — not CFD';flow.frustumCulled=false;flow.visible=false;flow.userData.skipContactAO=true;group.add(flow);
  const seeds=new Float64Array(160*3),flowMin=WIND_LAB_DIMENSIONS.flowBounds.min,flowMax=WIND_LAB_DIMENSIONS.flowBounds.max,flowRange=flowMax.map((v,i)=>v-flowMin[i]);
  function radicalInverse(n,base){let value=0,scale=1;while(n>0){scale/=base;value+=(n%base)*scale;n=Math.floor(n/base);}return value;}
  for(let i=0;i<160;i++)for(let axis=0;axis<3;axis++)seeds[i*3+axis]=flowMin[axis]+radicalInverse(i+1,[2,3,5][axis])*flowRange[axis];
  const flowArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(0,1.2,-13),5,0xb3dcd9,.85,.38);flowArrow.name='prescribed wind direction datum';flowArrow.visible=false;group.add(flowArrow);flowArrow.line.material.transparent=true;flowArrow.line.material.opacity=.75;
  // ArrowHelper's cone/line geometries are shared by Three.js globally. Own
  // only its materials, leaving shared geometry to its original owner.
  materials.add(flowArrow.line.material);materials.add(flowArrow.cone.material);

  const targetGroup=new THREE.Group();targetGroup.name='commanded pose reference only';targetGroup.visible=false;targetGroup.userData.skipContactAO=true;group.add(targetGroup);
  const footprint=[[-.88,-.20,-2.09],[-1.0,-.20,-1.45],[-.95,-.20,.94],[-.74,-.20,2.10],[0,-.20,2.25],[.74,-.20,2.10],[.95,-.20,.94],[1.0,-.20,-1.45],[.88,-.20,-2.09],[-.88,-.20,-2.09]],ghostSegments=[];
  for(let i=1;i<footprint.length;i++)ghostSegments.push([footprint[i-1],footprint[i]]);
  for(const side of [-1,1]){ghostSegments.push([[side*.83,-.2,-1.65],[side*.58,.73,-.57]],[[side*.58,.73,-.57],[side*.55,.73,.18]],[[side*.55,.73,.18],[side*.71,.07,1.10]],[[side*.71,.07,1.10],[side*.94,-.2,1.0]]);for(const z of [-1.4,1.35])for(let i=0;i<20;i++){const a=i*Math.PI/10,b=(i+1)*Math.PI/10;ghostSegments.push([[side*.91,-.18+Math.sin(a)*.34,z+Math.cos(a)*.34],[side*.91,-.18+Math.sin(b)*.34,z+Math.cos(b)*.34]]);}}
  for(const [y,z,x] of [[.73,-.57,.58],[.73,.18,.55],[.07,1.1,.71]])ghostSegments.push([[-x,y,z],[x,y,z]]);
  const ghost=lineSegments('Roadster commanded pose wire outline',ghostSegments,0xe5c18f,.8);targetGroup.add(ghost);
  const axisSegments=[],axisColors=[];
  for(let axis=0;axis<3;axis++){const end=[0,0,0];end[axis]=2.5;const wingA=[...end],wingB=[...end];wingA[axis]=wingB[axis]=2.18;wingA[(axis+1)%3]=.18;wingB[(axis+1)%3]=-.18;axisSegments.push([[0,0,0],end],[end,wingA],[end,wingB]);const color=new THREE.Color([0xe6b17d,0x91c9b4,0x8fbfda][axis]);for(let i=0;i<6;i++)axisColors.push(color.r,color.g,color.b);}
  const axesGeometry=keepGeometry(new THREE.BufferGeometry());axesGeometry.setAttribute('position',new THREE.Float32BufferAttribute(axisSegments.flat(2),3));axesGeometry.setAttribute('color',new THREE.Float32BufferAttribute(axisColors,3));const axes=new THREE.LineSegments(axesGeometry,keepMaterial(new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.9,depthWrite:false})));axes.name='commanded body axes X/Y/Z';targetGroup.add(axes);
  const targetGuideGeometry=keepGeometry(new THREE.BufferGeometry()),targetGuidePositions=new Float32Array(6);targetGuideGeometry.setAttribute('position',new THREE.BufferAttribute(targetGuidePositions,3).setUsage(THREE.DynamicDrawUsage));const targetGuide=new THREE.LineSegments(targetGuideGeometry,keepMaterial(new THREE.LineDashedMaterial({color:0xe5c18f,transparent:true,opacity:.45,dashSize:.28,gapSize:.24,depthWrite:false})));targetGuide.name='commanded altitude projection to floor';targetGuide.visible=false;targetGuide.frustumCulled=false;group.add(targetGuide);

  let quality='balanced',profile=QUALITY.balanced,elapsed=0,fanPhase=0,fanClock=0,flowVisible=true,manualPose=undefined,disposed=false;
  let lastShadowTime=-Infinity,environmentTarget=null,environmentCaptured=false;const lastShadowPoint=new THREE.Vector3(Infinity,Infinity,Infinity),windVector=new THREE.Vector3(),windDirection=new THREE.Vector3();
  const stats={name:'VECTOR / 07',type:'windlab',physicalSolids:geometry.length,dimensions:WIND_LAB_DIMENSIONS,prescribedFlow:{model:'spatially uniform input velocity; passive tracers, no CFD',velocity:{x:0,y:0,z:0},speedMps:0,tracers:0},environmentCapture:{status:'not attempted',size:128,captures:0},renderBudget:{quality:'balanced',shadowCascades:1,shadowSize:1024,shadowHz:20,shadowUpdates:0,shadowUpdatedThisFrame:false,pointLights:0,spotShadowMaps:0,probeFacesPerFrame:0,probeSize:0},liveScene:{}};
  function updateCost(){let allocated=0,draws=0,triangles=0,shadowDraws=0,shadowTriangles=0;group.traverse(o=>{if(!(o.isMesh||o.isLine)||!o.geometry)return;allocated++;let p=o;while(p&&p!==group){if(!p.visible)return;p=p.parent;}draws++;const n=o.isMesh?(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1):0;triangles+=n;if(o.castShadow){shadowDraws++;shadowTriangles+=n;}});Object.assign(stats.liveScene,{scope:'visible scene objects before camera culling; vehicle excluded',allocatedBatches:allocated,activeDistanceBatches:draws,activeDistanceTriangles:Math.round(triangles),shadowDistanceBatches:shadowDraws,shadowDistanceTriangles:Math.round(shadowTriangles)});}
  function setQuality(name){quality=QUALITY[name]?name:'balanced';profile=QUALITY[quality];detailMeshes.forEach(m=>m.visible=profile.detail);const maxAnisotropy=renderer?.capabilities?.getMaxAnisotropy?.()||4,anisotropy=Math.min(quality==='balanced'?2:8,maxAnisotropy);if(floorMap.anisotropy!==anisotropy){floorMap.anisotropy=anisotropy;floorMap.needsUpdate=true;}if(key.shadow.mapSize.x!==profile.shadowSize){key.shadow.map?.dispose();key.shadow.map=null;key.shadow.mapSize.set(profile.shadowSize,profile.shadowSize);key.shadow.camera.updateProjectionMatrix();}key.shadow.needsUpdate=true;lastShadowTime=-Infinity;Object.assign(stats.renderBudget,{quality,shadowSize:profile.shadowSize,shadowHz:profile.shadowHz});stats.prescribedFlow.tracers=flow.visible?profile.flowCount:0;flowGeometry.setDrawRange(0,profile.flowCount*2);updateCost();}
  function wantsShadowUpdate(time,position){if(disposed)return false;const p=finiteVector(position)?position:{x:0,y:0,z:0};const t=Number.isFinite(time)?time:elapsed;const moved=lastShadowPoint.distanceToSquared(p)>64,needed=moved||t-lastShadowTime>=1/profile.shadowHz;stats.renderBudget.shadowUpdatedThisFrame=needed;if(needed){const x=clamp(p.x,-12,12),z=clamp(p.z,-26,26);key.target.position.set(x,4.8,z);key.position.set(x+10,25.3,z+17);key.target.updateMatrixWorld();key.updateMatrixWorld();key.shadow.needsUpdate=true;lastShadowPoint.copy(p);lastShadowTime=t;stats.renderBudget.shadowUpdates++;}return needed;}
  function applyTarget(telemetry){
    const automatic=telemetry?.holdPositionTarget&&telemetry?.holdQuaternionTarget?{position:telemetry.holdPositionTarget,quaternion:telemetry.holdQuaternionTarget}:null;
    const pose=manualPose===undefined?automatic:manualPose,p=pose?.position,q=pose?.quaternion;
    const valid=pose?.enabled!==false&&finiteVector(p)&&q&&[q.x,q.y,q.z,q.w].every(Number.isFinite)&&Math.hypot(q.x,q.y,q.z,q.w)>1e-6;
    targetGroup.visible=targetGuide.visible=!!valid;if(!valid)return;
    targetGroup.position.set(p.x,p.y,p.z);targetGroup.quaternion.set(q.x,q.y,q.z,q.w).normalize();targetGuidePositions.set([p.x,.022,p.z,p.x,Math.max(.022,p.y),p.z]);targetGuideGeometry.attributes.position.needsUpdate=true;targetGuide.computeLineDistances();
  }
  function update(telemetry={},dt=0){
    if(disposed)return;const wasFlowVisible=flow.visible,wasTargetVisible=targetGroup.visible,delta=Number.isFinite(dt)?clamp(dt,0,.25):0;elapsed+=delta;
    const wind=telemetry.windVelocity||telemetry.wind?.velocity||telemetry.wind;
    windVector.set(finiteVector(wind)?wind.x:0,finiteVector(wind)?wind.y:0,finiteVector(wind)?wind.z:0);const speed=windVector.length();
    Object.assign(stats.prescribedFlow.velocity,{x:windVector.x,y:windVector.y,z:windVector.z});stats.prescribedFlow.speedMps=speed;flow.visible=flowArrow.visible=flowVisible&&speed>.015;stats.prescribedFlow.tracers=flow.visible?profile.flowCount:0;
    if(speed>.015&&flowVisible){const length=clamp(speed*.085,.20,2.5),scale=length/speed;for(let i=0;i<160;i++){let tailScale=scale;for(let axis=0;axis<3;axis++){const v=axis===0?windVector.x:axis===1?windVector.y:windVector.z,offset=i*3+axis;seeds[offset]=flowMin[axis]+((seeds[offset]-flowMin[axis]+v*delta)%flowRange[axis]+flowRange[axis])%flowRange[axis];if(v>0)tailScale=Math.min(tailScale,(seeds[offset]-flowMin[axis])/v);else if(v<0)tailScale=Math.min(tailScale,(flowMax[axis]-seeds[offset])/-v);}if(i<profile.flowCount)for(let axis=0;axis<3;axis++){const v=axis===0?windVector.x:axis===1?windVector.y:windVector.z;flowPositions[i*6+axis]=seeds[i*3+axis];flowPositions[i*6+3+axis]=seeds[i*3+axis]-v*tailScale;}}flowGeometry.attributes.position.needsUpdate=true;flowGeometry.setDrawRange(0,profile.flowCount*2);flowArrow.setDirection(windDirection.copy(windVector).multiplyScalar(1/speed));flowArrow.setLength(clamp(speed*.22+1.2,1.3,8),.7,.32);}
    // Aggregate animation uploads are limited to20 Hz; physical wind is still
    // evaluated by the simulation at its own fixed step.
    fanClock+=delta;fanPhase=(fanPhase+Math.min(speed*.18,10)*delta)%(Math.PI*2);
    if(speed>.015&&fanClock>=.05){fanClock%=.05;fanCenters.forEach(([x,y,z],i)=>{matrixObject.position.set(x,y,z+.065);matrixObject.rotation.set(0,0,fanPhase+(i%2)*.17);matrixObject.scale.set(1,1,1);matrixObject.updateMatrix();rotors.setMatrixAt(i,matrixObject.matrix);});rotors.instanceMatrix.needsUpdate=true;}
    applyTarget(telemetry);
    if(wasFlowVisible!==flow.visible||wasTargetVisible!==targetGroup.visible)updateCost();
  }
  function setTargetPose(pose){manualPose=pose===undefined?undefined:pose?{position:{...pose.position},quaternion:{...pose.quaternion},enabled:pose.enabled}:null;applyTarget({});}
  function captureEnvironment(){
    if(environmentCaptured||disposed)return !!environmentTarget;
    environmentCaptured=true;
    if(!renderer?.isWebGLRenderer){stats.environmentCapture.status='unsupported renderer; external environment allowed';return false;}
    const previous={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),xr:renderer.xr.enabled,shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeded:renderer.shadowMap.needsUpdate,toneMapping:renderer.toneMapping,autoClear:renderer.autoClear,background:scene.background,keyShadow:key.castShadow};
    const hidden=[...scene.children.filter(o=>o!==group),flow,flowArrow,targetGroup,targetGuide],visibility=hidden.map(o=>o.visible);let generator;
    try{hidden.forEach(o=>o.visible=false);key.castShadow=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;renderer.setScissorTest(false);group.updateMatrixWorld(true);generator=new THREE.PMREMGenerator(renderer);environmentTarget=generator.fromScene(scene,.02,.1,150,{size:128,position:new THREE.Vector3(0,2,0)});environmentTarget.texture.name='static indoor lab reflection — one capture at datum';scene.environment=environmentTarget.texture;stats.environmentCapture.status='captured';stats.environmentCapture.captures=1;return true;}
    catch(error){environmentTarget?.dispose();environmentTarget=null;stats.environmentCapture.status='capture unavailable; external environment allowed';stats.environmentCapture.reason=String(error?.message||error).slice(0,180);return false;}
    finally{generator?.dispose();hidden.forEach((o,i)=>o.visible=visibility[i]);key.castShadow=previous.keyShadow;scene.background=previous.background;renderer.xr.enabled=previous.xr;renderer.shadowMap.autoUpdate=previous.shadowAuto;renderer.shadowMap.needsUpdate=previous.shadowNeeded;renderer.toneMapping=previous.toneMapping;renderer.autoClear=previous.autoClear;renderer.setViewport(previous.viewport);renderer.setScissor(previous.scissor);renderer.setScissorTest(previous.scissorTest);renderer.setRenderTarget(previous.target,previous.face,previous.mip);key.shadow.needsUpdate=true;}
  }
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();if(scene.environment===environmentTarget?.texture)scene.environment=originalEnvironment;scene.background=originalBackground;scene.fog=originalFog;scene.environmentIntensity=originalEnvironmentIntensity;environmentTarget?.dispose();key.shadow.map?.dispose();key.shadow.mapPass?.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();}
  setQuality('balanced');captureEnvironment();updateCost();
  return {group,stats,ready:Promise.resolve(stats.environmentCapture),update,setQuality,wantsShadowUpdate,setTargetPose,
    setFlowVisible(value){flowVisible=!!value;if(!flowVisible){flow.visible=flowArrow.visible=false;stats.prescribedFlow.tracers=0;updateCost();}},
    particleLighting:()=>({ambient,lights:particleLights}),exposureAt:()=>.90,
    resize(){},setDay(){},setContactAO(){},updateReflections(){},captureEnvironment,dispose,
  };
}
