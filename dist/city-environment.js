import * as THREE from './vendor/three.module.js';
import {HDRLoader} from './vendor/addons/loaders/HDRLoader.js';
import {Reflector} from './vendor/addons/objects/Reflector.js';
import {CSM} from './vendor/addons/csm/CSM.js';
import {mergeGeometries} from './vendor/addons/utils/BufferGeometryUtils.js';
import {CITY_BUILDINGS,CITY_ROUTES} from './city-data.js';
import {CITY_PLAN,CITY_PLAN_SOLIDS,CITY_STREETS,CITY_NODES,roadSurfaceRectangles,plannedDistrictAt} from './city-plan.js';
import {buildUrbanArchitecture} from './urban-architecture.js';
import {buildStreetLife} from './street-life.js';
import {buildCityLandmarks} from './city-landmarks.js';
import {createIndirectLighting,makeSunlessEnvironment} from './indirect-lighting.js';

export function createEnvironment(scene,renderer,geometry,camera){
  const indirect=createIndirectLighting(renderer);
  const root=new THREE.Group();root.name='Vesper 3.4 / woven street, foundry and civic terrace';scene.add(root);
  const unit=new THREE.BoxGeometry(),temp=new THREE.Object3D(),loader=new THREE.TextureLoader(),buckets=new Map();
  const normal=loader.load('./assets/roads/nor_gl.jpg'),rough=loader.load('./assets/roads/rough.jpg'),albedo=loader.load('./assets/roads/diff.jpg');albedo.colorSpace=THREE.SRGBColorSpace;
  for(const t of [normal,rough,albedo]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(310,310);t.anisotropy=8;}
  const mats={road:new THREE.MeshPhysicalMaterial({color:0x999da0,roughness:.88,metalness:0,clearcoat:.025,clearcoatRoughness:.6,normalMap:normal,normalScale:new THREE.Vector2(.13,.13),roughnessMap:rough}),concrete:new THREE.MeshStandardMaterial({color:0x707572,roughness:.92}),steel:new THREE.MeshStandardMaterial({color:0x344044,metalness:.72,roughness:.47}),dark:new THREE.MeshStandardMaterial({color:0x1b2223,roughness:.72}),paint:new THREE.MeshStandardMaterial({color:0xb4ac8d,roughness:.86}),amber:new THREE.MeshBasicMaterial({color:0xffd4a0}),cyan:new THREE.MeshBasicMaterial({color:0x72d4d8}),red:new THREE.MeshBasicMaterial({color:0xd94734}),glass:new THREE.MeshPhysicalMaterial({color:0x345459,metalness:.35,roughness:.18,transparent:true,opacity:.45})};
  mats['warm-stone']=new THREE.MeshStandardMaterial({color:0x9b9988,roughness:.91});
  mats.basalt=new THREE.MeshStandardMaterial({color:0x697573,roughness:.9});
  mats.ivory=new THREE.MeshStandardMaterial({color:0xc5c2ae,roughness:.79});
  mats['aged-copper']=new THREE.MeshStandardMaterial({color:0x826f59,roughness:.63,metalness:.35});
  mats.oxide=new THREE.MeshStandardMaterial({color:0x967052,roughness:.73,metalness:.32});
  mats.glazing=mats.glass;
  const plannedGeometry=new Map(CITY_PLAN_SOLIDS.map(g=>[g.id,g]));
  // Road grain is sampled in metres; unit-box UV derivatives become degenerate
  // on long instanced ramp slabs, so their normal frame must not use those UVs.
  mats.road.normalMap=null;mats.road.roughnessMap=null;
  // World-space grain and patchy roughness stay at metre scale on every slab.
  mats.road.onBeforeCompile=s=>{
    s.uniforms.roadMineralAlbedo={value:albedo};s.uniforms.roadMineralNormal={value:normal};s.uniforms.roadMineralRoughness={value:rough};
    s.vertexShader='varying vec3 roadWorld;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec4 rwp=vec4(position,1.);\n#ifdef USE_INSTANCING\nrwp=instanceMatrix*rwp;\n#endif\nroadWorld=(modelMatrix*rwp).xyz;');
    s.fragmentShader='uniform sampler2D roadMineralNormal,roadMineralRoughness,roadMineralAlbedo;varying vec3 roadWorld;float rh(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}float rn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(rh(i),rh(i+vec2(1,0)),f.x),mix(rh(i+vec2(0,1)),rh(i+1.),f.x),f.y);}\n'+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat detail=clamp(.012/max(length(fwidth(roadWorld.xz)),.001),0.,1.);float grain=mix(.5,rh(floor(roadWorld.xz*85.)),detail);float wear=rn(roadWorld.xz*.35);vec3 roadColour=texture2D(roadMineralAlbedo,roadWorld.xz*.25).rgb;diffuseColor.rgb*=roadColour*(.84+.19*wear+.06*grain);');
    s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(.53+.12*wear+.32*texture2D(roadMineralRoughness,roadWorld.xz*.25).g,.68,.98);');
    s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec2 roadUv=roadWorld.xz*.25,rs0=dFdx(roadUv),rs1=dFdy(roadUv);float rdet=rs0.x*rs1.y-rs1.x*rs0.y;
      if(abs(rdet)>.0000001){vec3 rq0=dFdx(-vViewPosition),rq1=dFdy(-vViewPosition),rT=normalize((rq0*rs1.y-rq1*rs0.y)*sign(rdet)),rB=normalize((-rq0*rs1.x+rq1*rs0.x)*sign(rdet));vec3 rnTex=texture2D(roadMineralNormal,roadUv).xyz*2.-1.;rnTex.xy*=.40;normal=normalize(mat3(rT,rB,normal)*rnTex);}`);
  };
  const add=(size,pos,mat=mats.steel,rot=[0,0,0],shadow=true)=>{const a=buckets.get(mat)||[];a.push({size,pos,rot,shadow});buckets.set(mat,a);};
  const geometryById=new Map(geometry.map(g=>[g.id,g]));
  for(const g of geometry){
    if(['building','podium','street-prop','landmark'].includes(g.kind))continue;
    const mat=plannedGeometry.has(g.id)?mats[plannedGeometry.get(g.id).data.material]||mats.concrete:['floor','urban-road','skyway'].includes(g.kind)?mats.road:['ceiling','city-canopy'].includes(g.kind)?mats.dark:mats.concrete;
    if(g.kind==='floor'){const m=new THREE.Mesh(unit,mat);m.name=g.id;m.scale.set(...g.size);m.position.set(...g.position);m.receiveShadow=true;root.add(m);}
    else{const items=buckets.get(mat)||[];items.push({size:g.size,pos:g.position,quaternion:g.quaternion,shadow:true});buckets.set(mat,items);}
  }
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
  for(let z=-395;z<50;z+=9){add([.10,.012,4],[-200,.02,z],mats.paint,undefined,false);for(const x of [-208.5,-191.5])add([.15,.02,5],[x,.024,z],mats.paint,undefined,false);}
  // The foundry avenue is wider and calmer than the woven street, while the
  // rear service lane is deliberately narrow and unmarked.
  for(let z=-390;z<484;z+=12)if(![-132.5,302.5].some(q=>Math.abs(q-z)<10))add([.11,.013,5],[100,.018,z],mats.paint,undefined,false);
  for(const [z,min,max]of [[-400,-570,100],[-132.5,-300,200]])for(let x=min+8;x<max-3;x+=12){if(Math.abs(x+200)<12||Math.abs(x-100)<12)continue;add([5,.013,.11],[x,.018,z],mats.paint,undefined,false);}
  for(const x of [91,109])for(let z=147;z<489;z+=6)add([.11,.013,5],[x,.018,z],mats.paint,undefined,false);
  // Hero street infrastructure: drainage, patch repairs, access covers and kerbs.
  for(const x of [-209,-191])for(let z=-400;z<48;z+=6){add([.7,.02,2.1],[x,.04,z],mats.dark,undefined,false);for(let k=0;k<7;k++)add([.57,.025,.05],[x,.057,z-.85+k*.28],mats.steel,undefined,false);}
  for(let k=0;k<16;k++){const z=-395+k*27;add([1.3,.014,1.3],[-204+(k%3)*3,.032,z],mats.steel,[0,k*.7,0],false);add([3.5,.011,2.6],[-198+(k%2)*4,.025,z+8],mats.dark,[0,k*.27,0],false);}
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
  function cable(points,radius=.025){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));cableGeometries.push(new THREE.TubeGeometry(curve,32,radius,5,false));}
  for(let z=-390;z<20;z+=37)for(let k=0;k<4;k++)cable([[-213,11+k*.17,z],[-200,9.1+k*.17,z+2.8],[-187,11+k*.17,z+1]],.025);
  for(const x of [-211,-189])for(let k=0;k<3;k++)cable([[x,10+k*.2,-400],[x,8.5+k*.2,-270],[x,11+k*.2,-120],[x,8+k*.2,35]],.033);
  const cableMesh=new THREE.Mesh(mergeGeometries(cableGeometries),mats.dark);cableMesh.name='merged overhead utilities';cableMesh.castShadow=true;root.add(cableMesh);cableGeometries.forEach(g=>g.dispose());
  // Original street signage: dark backing, mechanical brackets, deliberate scale.
  function sign(text,x,y,z,w=8,h=2,color='#eac896',rotation=Math.PI){
    const c=document.createElement('canvas');c.width=2048;c.height=Math.max(128,Math.round(2048*h/w));const g=c.getContext('2d');g.fillStyle='#151b1b';g.fillRect(0,0,c.width,c.height);g.fillStyle=color;g.font=`600 ${Math.round(c.height*.53)}px Arial,Microsoft YaHei`;g.textAlign='center';g.textBaseline='middle';g.fillText(text,c.width/2,c.height*.49,c.width*.94);g.fillRect(c.width*.025,c.height*.89,c.width*.95,2);
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:1.5,roughness:.65});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);mesh.position.set(x,y,z);mesh.rotation.y=rotation;root.add(mesh);
  }
  sign('织 桥 街 / WEAVE QUARTER',-200,6.1,-319.85,15,1.2,'#c3d6d1');sign('交换厅 / EXCHANGE',-200,6.1,-286.12,15,1.0,'#dda37d');
  sign('环城高架   ←  CROSS CITY  →',-200,17.1,-236.1,18,1.7,'#a0c4cb');
  sign('SKY FORUM / 上城议庭',400,11,150.1,16,2.2,'#cdd2b6');
  sign('机造里 / FOUNDRY ROW',100,10.1,312.90,16,1.1,'#d9c39a');
  sign('半 环 议 庭 / SKY FORUM',552.55,14,365,28,2,'#e1d8ba',-Math.PI/2);
  sign('ROADSTER / RESEARCH',0,6,84,26,3.5,'#a8c3bc',Math.PI);
  function verticalSign(text,x,y,z,color){
    const c=document.createElement('canvas');c.width=256;c.height=1024;const g=c.getContext('2d');g.fillStyle='#102022';g.fillRect(0,0,256,1024);g.strokeStyle=color;g.lineWidth=6;g.strokeRect(10,10,236,1004);g.fillStyle=color;g.font='bold 150px Arial,Microsoft YaHei';g.textAlign='center';g.textBaseline='middle';[...text].forEach((v,i)=>g.fillText(v,128,120+i*220,210));
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:3.4,roughness:.6});
    for(const ry of [0,Math.PI]){const m=new THREE.Mesh(new THREE.PlaneGeometry(1.5,6),mat);m.position.set(x,y,z+(ry===0?.085:-.085));m.rotation.y=ry;root.add(m);}add([1.7,6.2,.15],[x,y,z],mats.steel);add([2.2,.13,.13],[x,y+2.8,z],mats.steel);
  }
  verticalSign('夜航旅店',-208.7,7.2,-333,'#5ed7d8');verticalSign('深夜食堂',-191.3,7,-307,'#eaa875');verticalSign('机能诊所',-208.7,8,-287,'#dc75b4');verticalSign('轨道通信',-191.3,10,-195,'#7bafc4');
  const lightAnchors=[];
  for(let z=-397;z<40;z+=28)for(const side of [-1,1]){
    const x=-200+side*9.4;add([.13,7.5,.13],[x,3.75,z],mats.steel);add([1.4,.13,.48],[x-side*.6,7.52,z],mats.steel);add([.9,.035,.32],[x-side*.6,7.43,z],mats.amber);lightAnchors.push({position:[x-side*.6,7.30,z],color:0xb6d9dc,intensity:190,range:24});
  }
  for(let x=-600;x<=600;x+=100)for(let z=-580;z<=580;z+=55)for(const side of [-1,1]){if(plannedDistrictAt(x,z))continue;add([.11,8,.11],[x+side*12.7,4,z],mats.steel);add([1.5,.10,.5],[x+side*12,8,z],mats.steel);add([1.1,.035,.35],[x+side*12,7.93,z],mats.amber);lightAnchors.push({position:[x+side*12,7.85,z],color:0xcad8d6,intensity:500,range:30});}
  for(let z=154;z<490;z+=34)for(const side of [-1,1]){const x=100+side*10.2;add([.12,7.2,.12],[x,3.6,z],mats.steel);add([1.2,.09,.45],[x-side*.45,7.2,z],mats.steel);add([.85,.025,.25],[x-side*.45,7.14,z],mats.amber);}
  lightAnchors.push(...(architecture.lightAnchors||[]),...(streetLife.lightAnchors||[]),...(landmarks.lightAnchors||[]));
  // A little street furniture lives outside the drivable lane, at human scale.
  for(let k=0;k<30;k++){const z=-399+k*14,side=k%2?-1:1,x=-200+side*10.6;add([.75,1.1,.72],[x,.66,z],mats.steel);add([.8,.09,.77],[x,1.25,z],mats.dark);if(k%3===0){add([1.7,.06,.55],[x,.58,z+2],mats.paint);for(const dz of [-.6,.6])add([.08,.55,.4],[x,.29,z+2+dz],mats.steel);}}
  for(const [mat,items]of buckets){const mesh=new THREE.InstancedMesh(unit,mat,items.length);mesh.name='street structures / '+mat.type;mesh.castShadow=items.some(v=>v.shadow);mesh.receiveShadow=true;items.forEach((v,i)=>{temp.position.set(...v.pos);if(v.quaternion)temp.quaternion.set(...v.quaternion);else temp.rotation.set(...(v.rot||[0,0,0]));temp.scale.set(...v.size);temp.updateMatrix();mesh.setMatrixAt(i,temp.matrix);});mesh.computeBoundingSphere();root.add(mesh);}
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{day:{value:0}},vertexShader:'varying vec3 dir;void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 dir;uniform float day;void main(){vec3 d=normalize(dir);float h=max(0.,d.y);vec3 c=mix(vec3(.07,.09,.105),vec3(.008,.014,.025),pow(h,.4));c=mix(c,mix(vec3(.44,.48,.50),vec3(.15,.29,.43),pow(h,.5)),day);gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(1700,32,16),skyMat);root.add(sky);
  const hemi=new THREE.HemisphereLight(0xc3cfda,0x242c2c,.38);scene.add(hemi);
  const csm=new CSM({camera,parent:scene,cascades:3,maxFar:260,mode:'custom',customSplitsCallback:(c,n,f,out)=>out.push(22/f,75/f,1),shadowMapSize:2048,shadowBias:-.00001,lightDirection:new THREE.Vector3(-.554,-.743,-.376).normalize(),lightIntensity:.80,lightMargin:220,lightFar:650});csm.fade=true;csm.updateFrustums();csm.lights.forEach(l=>{l.color.set(0xb8cadb);l.shadow.normalBias=.007;l.shadow.radius=2;});
  function calibrateShadowBias(){csm.lights.forEach(l=>{const camera=l.shadow.camera,texel=(camera.right-camera.left)/l.shadow.mapSize.x;l.shadow.normalBias=Math.min(.12,Math.max(.008,texel*.8));});}
  calibrateShadowBias();
  const materialSet=new WeakSet();
  function setupMaterials(){scene.traverse(o=>{if(!o.isMesh)return;for(const mat of Array.isArray(o.material)?o.material:[o.material])if(mat?.isMeshStandardMaterial&&!materialSet.has(mat)){const old=mat.onBeforeCompile,originalKey=mat.customProgramCacheKey();csm.setupMaterial(mat);const shadowCompile=mat.onBeforeCompile;mat.onBeforeCompile=function(shader,r){old?.call(this,shader,r);shadowCompile.call(this,shader,r);indirect.inject(shader);};mat.customProgramCacheKey=()=>originalKey+'|vesper-csm-gi-v2';mat.needsUpdate=true;materialSet.add(mat);}});}
  setupMaterials();
  const pools=Array.from({length:4},()=>{const l=new THREE.PointLight(0xffcb9f,1,22,2);scene.add(l);return l;});
  const streetShadows=Array.from({length:2},()=>{const l=new THREE.SpotLight(0xffddbb,650,34,.85,.55,2);l.castShadow=true;l.shadow.mapSize.set(1024,1024);l.shadow.bias=-.00005;l.shadow.normalBias=.005;l.shadow.radius=3;scene.add(l,l.target);return l;});
  scene.fog=new THREE.FogExp2(0x182326,.0018);
  // One camera-relative patch of wet asphalt, with genuine planar scene reflection.
  // A Fresnel/micro-roughness mask exposes only irregular puddles, never a full mirror floor.
  const puddleShader={uniforms:{...Reflector.ReflectorShader.uniforms},vertexShader:`uniform mat4 textureMatrix;varying vec4 vUv;varying vec3 wp;void main(){vUv=textureMatrix*vec4(position,1.);wp=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform sampler2D tDiffuse;uniform vec3 color;varying vec4 vUv;varying vec3 wp;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    void main(){float mask=smoothstep(.71,.86,n(wp.xz*.27)*.7+n(wp.xz*.91)*.3);if(mask<.01)discard;vec2 uv=vUv.xy/vUv.w;vec2 d=vec2(.0009,.0005);vec3 r=texture2D(tDiffuse,uv).rgb*.4+(texture2D(tDiffuse,uv+d).rgb+texture2D(tDiffuse,uv-d).rgb+texture2D(tDiffuse,uv+vec2(d.x,-d.y)).rgb)*.2;float f=.08+.55*pow(1.-max(0.,normalize(cameraPosition-wp).y),3.);gl_FragColor=vec4(r*.82,mask*f);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`};
  const puddles=new Reflector(new THREE.PlaneGeometry(100,100),{textureWidth:768,textureHeight:512,clipBias:.002,shader:puddleShader,multisample:0});puddles.name='rough wet asphalt / live planar reflections';puddles.rotation.x=-Math.PI/2;puddles.position.y=.028;puddles.material.transparent=true;puddles.material.depthWrite=false;puddles.renderOrder=1;root.add(puddles);
  let day=true,hdr=null,sunlessSky=null,skyEnvironment=null,lastProbe=new THREE.Vector3(1e6,0,1e6),lastProbeTime=-100,lastMaterials=0,quality='high';
  const cubeTarget=new THREE.WebGLCubeRenderTarget(256,{type:THREE.HalfFloatType,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter}),cube=new THREE.CubeCamera(.3,220,cubeTarget);scene.add(cube);
  const skyReady=new Promise(resolve=>new HDRLoader().load('./assets/daylight.hdr',async t=>{
    hdr=t;t.mapping=THREE.EquirectangularReflectionMapping;
    await indirect.ready;sunlessSky=makeSunlessEnvironment(t,indirect.metadata);
    const pmrem=new THREE.PMREMGenerator(renderer);skyEnvironment=pmrem.fromEquirectangular(sunlessSky).texture;pmrem.dispose();
    hemi.intensity=indirect.stats.loaded?0:.28;
    // The photographed sky and shadow-casting sun share the measured HDR sun
    // direction (48 degrees elevation). No sunrise map underneath a night dome.
    scene.background=t;scene.backgroundIntensity=.75;scene.backgroundBlurriness=0;
    scene.environment=skyEnvironment;scene.environmentIntensity=.80;sky.visible=false;resolve(true);
  },undefined,()=>resolve(false)));
  const ready=Promise.all([skyReady,landmarks.ready,streetLife.ready,indirect.ready]);
  function setDay(){day=true;skyMat.uniforms.day.value=1;
    hemi.intensity=indirect.stats.loaded?0:.28;hemi.color.set(0xd5e5f5);hemi.groundColor.set(0x665c4d);
    csm.lights.forEach(l=>{l.intensity=2.7;l.color.set(0xfff3e3);});
    scene.fog.color.set(0xa2b5bf);scene.fog.density=.00055;scene.environmentIntensity=.80;
    lastProbe.set(1e6,0,1e6);
  }
  setDay();
  return{root,ready,setDay,exposureAt:(p,sunVisible)=>indirect.exposureAt(p,sunVisible),setContactAO:t=>indirect.setContactAO(t),stats:{cityPlan:{districts:CITY_PLAN.districts.length,nodes:CITY_NODES.length,streets:CITY_STREETS.length,version:CITY_PLAN.version},indirectLighting:indirect.stats,buildings:CITY_BUILDINGS.length,architecture:architecture.stats,streetLife:streetLife.stats,landmarks:landmarks.stats,routes:CITY_ROUTES.length,shadowCascades:3,wetReflections:false,daylight:"CC0 measured midday sky",vehicleLocalProbe:true},
    particleLighting(){return {ambient:new THREE.Color(day?.70:.22,day?.74:.28,day?.76:.30),lights:pools};},
    setQuality(q){quality=q;indirect.setAOEnabled(q!=='balanced');csm.lights.forEach(l=>{l.shadow.mapSize.set(q==='ultra'?3072:q==='balanced'?1024:2048,q==='ultra'?3072:q==='balanced'?1024:2048);l.shadow.map?.dispose();l.shadow.map=null;});streetShadows.forEach(l=>l.castShadow=q!=='balanced');puddles.visible=!day&&q!=='balanced';cubeTarget.setSize(q==='ultra'?512:q==='balanced'?128:256);calibrateShadowBias();lastProbe.set(1e6,0,1e6);},
    resize(){csm.updateFrustums();calibrateShadowBias();indirect.resize();},
    update(time,p){
      camera.updateMatrixWorld();csm.update();sky.position.copy(p);streetLife.update(time,p);landmarks.update(time,p);if(time-lastMaterials>2){setupMaterials();lastMaterials=time;}
      const nearest=lightAnchors.map(a=>({a,d:Math.hypot(a.position[0]-p.x,a.position[2]-p.z,Math.max(0,a.position[1]-p.y)*.4)})).sort((a,b)=>a.d-b.d);
      pools.forEach((l,i)=>{const a=nearest[i]?.a;if(a){l.position.set(...a.position);l.color.set(a.color);l.intensity=day?a.intensity*.12:a.intensity;l.distance=a.range;}});
      streetShadows.forEach((l,i)=>{l.visible=!day;const a=nearest[i*2]?.a;if(a){l.position.set(...a.position);l.target.position.set(a.position[0],a.position[1]-8,a.position[2]);l.intensity=day?70:430;l.color.set(a.color);}});
      const upper=p.x>280&&p.x<560&&p.z>150&&p.z<420;const y=upper?8:0;puddles.position.set(p.x,y+.028,p.z);puddles.visible=!day&&quality!=='balanced'&&p.y<y+3.5;
    },
    updateReflections(time,p,exclude=[]){
      if(!hdr||time-lastProbeTime<3||lastProbe.distanceTo(new THREE.Vector3(p.x,p.y,p.z))<18)return;
      const states=exclude.map(o=>o.visible),wet=puddles.visible,background=scene.background,backgroundIntensity=scene.backgroundIntensity,ao=indirect.uniforms.giAOEnabled.value;
      scene.background=sunlessSky;scene.backgroundIntensity=.80;indirect.setAOEnabled(false);exclude.forEach(o=>o.visible=false);puddles.visible=false;
      cube.position.set(p.x,p.y+.55,p.z);
      try{
        cube.update(renderer,scene);cubeTarget.texture.needsPMREMUpdate=true;
        // A local probe belongs on the vehicle, not the whole city's diffuse
        // lighting. Buildings retain stable sky illumination as the car moves.
        exclude[0]?.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.isMeshStandardMaterial){const initial=!m.envMap;m.envMap=cubeTarget.texture;m.envMapIntensity=1.;if(initial)m.needsUpdate=true;}});
        lastProbe.set(p.x,p.y,p.z);lastProbeTime=time;
      }finally{scene.background=background;scene.backgroundIntensity=backgroundIntensity;indirect.setAOEnabled(ao>.5);puddles.visible=wet;exclude.forEach((o,i)=>o.visible=states[i]);}
    }
  };
}



