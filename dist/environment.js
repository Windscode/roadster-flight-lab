import * as THREE from './vendor/three.module.js';
import { HDRLoader } from './vendor/addons/loaders/HDRLoader.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
function noise(x,z){ return Math.sin(x*.037+Math.cos(z*.029)*2)*Math.cos(z*.027)+.43*Math.sin(x*.092+z*.054)+.18*Math.cos(z*.173-x*.139); }
function seeded(seed=1028){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}

export function createEnvironment(scene,renderer,geometry){
  const root = new THREE.Group(); root.name='Morrow proving ground'; scene.add(root);
  const textureLoader = new THREE.TextureLoader();
  const concrete = new THREE.MeshStandardMaterial({color:0x9faaa8,roughness:.89,metalness:.06});
  const asphalt = new THREE.MeshStandardMaterial({color:0x303c3f,roughness:.92,metalness:.03});
  const steel = new THREE.MeshStandardMaterial({color:0xb2bcba,roughness:.34,metalness:.78});
  const graphite = new THREE.MeshStandardMaterial({color:0x29383c,roughness:.5,metalness:.65});
  const porcelain = new THREE.MeshStandardMaterial({color:0xdfded2,roughness:.46,metalness:.3});
  const bronze = new THREE.MeshStandardMaterial({color:0x916849,roughness:.42,metalness:.68});
  const lightMaterial = new THREE.MeshBasicMaterial({color:0xb9ffdd,toneMapped:false});
  const warmLight = new THREE.MeshBasicMaterial({color:0xffd6a1,toneMapped:false});
  const windows = new THREE.MeshPhysicalMaterial({color:0x4e6265,metalness:.75,roughness:.08,clearcoat:1});
  const geometries = {box:new THREE.BoxGeometry(1,1,1),cyl:new THREE.CylinderGeometry(1,1,1,16)};
  const lights=[];
  function box(size,pos,mat=concrete,quat=null,cast=true){
    const mesh = new THREE.Mesh(geometries.box,mat); mesh.scale.set(...size);mesh.position.set(...pos);
    if(quat)mesh.quaternion.set(...quat);mesh.castShadow=cast;mesh.receiveShadow=true;root.add(mesh);return mesh;
  }
  function cylinder(radius,height,pos,mat=steel){const mesh=new THREE.Mesh(geometries.cyl,mat);mesh.scale.set(radius,height,radius);mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;}
  function beam(a,b,r=.15,mat=steel){const d=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));const m=cylinder(r,d.length(),new THREE.Vector3(...a).addScaledVector(d,.5).toArray(),mat);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m;}
  function line(points,color=0xa2cabb,opacity=.7){const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color,transparent:true,opacity}));root.add(l);return l;}
  function decal(text,pos,w=8,h=2,opts={}){
    const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d');
    ctx.clearRect(0,0,c.width,c.height);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=opts.color||'#d7e4dd';
    ctx.font=`${opts.weight||500} ${opts.fontSize||100}px Arial, sans-serif`;ctx.fillText(text,512,128,970);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}));
    m.position.set(...pos);if(opts.floor!==false)m.rotation.x=-Math.PI/2;if(opts.rotation)m.rotation.set(...opts.rotation);root.add(m);return m;
  }
  function ring(radius,x,z,color=0xaec6bb,width=.06,y=.012){
    const m=new THREE.Mesh(new THREE.RingGeometry(radius-width/2,radius+width/2,160),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.82,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);root.add(m);return m;
  }
  const albedo=textureLoader.load('./assets/concrete.jpg',undefined,undefined,()=>{});albedo.wrapS=albedo.wrapT=THREE.RepeatWrapping;albedo.repeat.set(55,85);albedo.colorSpace=THREE.SRGBColorSpace;albedo.anisotropy=8;concrete.map=albedo;
  const normal=textureLoader.load('./assets/concrete-normal.jpg',undefined,undefined,()=>{});normal.wrapS=normal.wrapT=THREE.RepeatWrapping;normal.repeat.set(55,85);concrete.normalMap=normal;concrete.normalScale.set(.28,.28);
  const rough=textureLoader.load('./assets/concrete-roughness.jpg',undefined,undefined,()=>{});rough.wrapS=rough.wrapT=THREE.RepeatWrapping;rough.repeat.set(55,85);concrete.roughnessMap=rough;

  // Every drivable structural mesh comes from the same data as its collision body.
  for(const g of geometry){
    const mat=g.kind==='floor'?concrete:g.kind==='arch'?asphalt:g.kind==='ceiling'?graphite:g.kind==='pillar'?porcelain:graphite;
    const m=box(g.size,g.position,mat,g.quaternion,g.kind!=='floor');m.name=g.id;
    if(g.kind==='boundary')m.material=graphite;
  }
  // Expansion joints and runway furniture stay flush to the physical ground.
  const jointMat=new THREE.LineBasicMaterial({color:0x637371,transparent:true,opacity:.3});const jp=[];
  for(let x=-104;x<105;x+=8)jp.push(x,.006,-163,x,.006,163);
  for(let z=-160;z<161;z+=8)jp.push(-106,.006,z,106,.006,z);
  const jg=new THREE.BufferGeometry();jg.setAttribute('position',new THREE.Float32BufferAttribute(jp,3));root.add(new THREE.LineSegments(jg,jointMat));
  const runway=box([15,.012,315],[0,.002,0],asphalt,null,false);runway.receiveShadow=true;
  for(let z=-155;z<160;z+=10){box([.14,.012,4],[0,.014,z],porcelain,null,false);}
  for(const x of [-7.1,7.1])box([.08,.014,313],[x,.015,0],porcelain,null,false);
  for(let z=-156;z<155;z+=12)for(const x of [-8.1,8.1]){
    box([.22,.04,.55],[x,.02,z],graphite,null,false);box([.16,.015,.3],[x,.047,z],warmLight,null,false);
  }
  for(const z of [-140,145]){for(const x of [-5,-3,-1,1,3,5])box([.85,.015,5],[x,.02,z],porcelain,null,false);}
  decal('01',[0,.045,-127],5,5);decal('19',[0,.045,131],5,5);
  // Hero pad / hover reference: real markings, not an artificial force field.
  for(const r of [4,6.8,8])ring(r,0,-28,0x83a99a,r===8?.16:.04,.027);
  for(let i=0;i<48;i++){const a=i/48*TAU;const len=i%4===0?.65:.22;const m=box([.045,.01,len],[Math.sin(a)*7.65,.04,-28+Math.cos(a)*7.65],porcelain,null,false);m.rotation.y=a;}
  decal('FLIGHT  /  01',[0,.05,-36.8],7.2,1.4);decal('ROADSTER',[0,.05,-20.5],7.6,1.5,{fontSize:86});
  for(const r of [3.1,4.9,6.1])ring(r,0,-5,0xb3a58a,.055,.029);
  decal('H',[0,.036,-5],2,2,{fontSize:150});decal('HOVER TEST',[0,.04,2.4],7,1.4);

  // A continuous half-circle, defined in exactly the same location as the physics ramp.
  for(const x of [-41,-31]){
    const pts=[];for(let i=0;i<=100;i++){const a=i/100*Math.PI;pts.push([x,9-9.28*Math.cos(a),42+9.28*Math.sin(a)]);}line(pts,0xced4c8,1);
    for(let i=0;i<9;i++){const a=(i+.5)/9*Math.PI;const y=9-9.3*Math.cos(a),z=42+9.3*Math.sin(a);if(y>2.5)beam([x,0,z],[x,y,z],.12,graphite);}
    for(let z=21;z<43;z+=3)box([.085,.1,1.6],[x,18.38,z],lightMaterial);
  }
  for(const x of [-39.9,-32.1])box([.07,.012,24],[x,.027,29],porcelain,null,false);
  decal('INVERSION ARCH',[-36,.04,17],8,1.5);decal('02',[-36,.04,22],3,3);
  for(const x of [-43,-29]){
    beam([x,0,42],[x,18.65,38],.16,steel);beam([x,18.65,38],[x,18.65,21],.16,steel);beam([x,18.65,21],[x,0,21],.16,steel);
  }
  // Ceiling bay: readable engineering architecture with a polished soffit.
  box([23,.35,29],[36,8.72,18],porcelain);box([23.4,.12,29.4],[36,8.96,18],steel);
  for(const x of [25,47])box([.1,.09,28],[x,7.93,18],lightMaterial);
  for(const z of [4,32])box([21,.085,.09],[36,7.93,z],lightMaterial);
  for(let z=5;z<32;z+=3){box([20,.06,.055],[36,7.965,z],steel);}
  decal('03  /  INVERTED',[36,8.85,3.21],15,2,{floor:false,fontSize:78,color:'#283a3d'});
  for(const x of [24.5,47.5])box([.09,.015,31],[x,.019,18],porcelain,null,false);
  for(const z of [2.5,33.5])box([23,.015,.09],[36,.019,z],porcelain,null,false);
  decal('SUCTION LAB',[36,.035,-.4],14,2);ring(4,36,18,0xaec5b4,.08);

  // Scenic structures sit beyond the closed driving boundary.
  function hangar(x,z,w=45){
    box([w,9,29],[x,4.5,z],porcelain);box([w+4,.65,33],[x,9.4,z],steel);
    box([w-5,7.4,.18],[x,4.3,z-14.61],windows);box([w+2,.32,1.4],[x,8.55,z-16.5],graphite);
    for(let k=-w/2+2;k<w/2;k+=2.4)box([.08,8,.28],[x+k,4.4,z-14.83],graphite);
    box([w-3,.055,.08],[x,8.3,z-16.7],lightMaterial);
    decal('M O R R O W',[x,10.8,z-14.95],w*.65,3,{floor:false,fontSize:95,color:'#e0e3d7'});
    for(let j=0;j<8;j++)box([w-3,.025,.11],[x,9.73,z-12+j*3.2],graphite,null,false);
  }
  hangar(-143,12,54);hangar(147,-15,45);
  // Observation tower and telemetry mast.
  box([15,16,15],[139,8,69],graphite);box([24,4.5,22],[139,18.25,69],windows);box([25,.4,23],[139,20.65,69],porcelain);
  for(const x of [128,135,143,150])box([.15,4.6,.2],[x,18.3,57.8],steel);
  cylinder(.18,18,[139,30,69],steel);cylinder(.25,.2,[139,39.1,69],warmLight);
  // Distant solar arrays are instanced to keep the render budget under control.
  const solarMat=new THREE.MeshStandardMaterial({color:0x1e414b,roughness:.22,metalness:.65});const arrays=new THREE.InstancedMesh(geometries.box,solarMat,100);const temp=new THREE.Object3D();
  let n=0;for(let iz=0;iz<10;iz++)for(let ix=0;ix<10;ix++){temp.position.set(-194+ix*7,2,100+iz*5);temp.scale.set(6,.1,3.4);temp.rotation.set(-.33,0,0);temp.updateMatrix();arrays.setMatrixAt(n++,temp.matrix);}arrays.receiveShadow=true;root.add(arrays);
  // Facility perimeter and light poles.
  for(let z=-155;z<=156;z+=20)for(const x of [-114,114]){
    cylinder(.1,9,[x,4.5,z],graphite);beam([x,8.8,z],[x-Math.sign(x)*3,8.8,z],.09,graphite);box([2.3,.11,.6],[x-Math.sign(x)*2,8.7,z],warmLight);
  }
  for(let z=-165;z<166;z+=6)for(const x of [-121,121])cylinder(.025,2.8,[x,1.4,z],steel);
  for(const x of [-121,121])for(const y of [.8,1.8,2.65])line([[x,y,-168],[x,y,168]],0x758283,.65);

  // Terrain blends the engineered apron into the landscape.
  const terrainGeo=new THREE.PlaneGeometry(2200,2200,150,150);terrainGeo.rotateX(-Math.PI/2);const pa=terrainGeo.attributes.position;const colors=[];const random=seeded();
  for(let i=0;i<pa.count;i++){
    const x=pa.getX(i),z=pa.getZ(i),d=Math.max(Math.abs(x)/128,Math.abs(z)/178);const fade=clamp((d-1)*.7,0,1);
    const h=fade*(8+noise(x,z)*8+Math.max(0,(Math.abs(x)+Math.abs(z)-420)/500)*35);pa.setY(i,h-.65);
    const c=new THREE.Color().setHSL(.15+random()*.035,.12+random()*.1,.19+random()*.065+h*.0005);colors.push(c.r,c.g,c.b);
  }
  terrainGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrainGeo.computeVertexNormals();const terrain=new THREE.Mesh(terrainGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));terrain.receiveShadow=true;root.add(terrain);
  // Sparse vegetation, tonal rather than cartoon trees.
  const grassGeo=new THREE.ConeGeometry(.38,1.1,5);const grassMat=new THREE.MeshStandardMaterial({color:0x5b6150,roughness:1});const grass=new THREE.InstancedMesh(grassGeo,grassMat,900);
  for(let i=0;i<900;i++){let x,z;do{x=(random()-.5)*950;z=(random()-.5)*950;}while(Math.abs(x)<131&&Math.abs(z)<182);
    const d=Math.max(Math.abs(x)/128,Math.abs(z)/178);const fade=clamp((d-1)*.7,0,1);const h=fade*(8+noise(x,z)*8+Math.max(0,(Math.abs(x)+Math.abs(z)-420)/500)*35)-.65;
    const s=.4+random()*1.8;temp.position.set(x,h+.4*s,z);temp.scale.set(s,s,s);temp.rotation.set(0,random()*TAU,0);temp.updateMatrix();grass.setMatrixAt(i,temp.matrix);
  }root.add(grass);

  // Procedural atmospheric sky; photographed HDR is used for physically based reflections.
  const skyUniforms={sun:{value:new THREE.Vector3(-.45,.28,.72).normalize()},day:{value:1},uTime:{value:0}};
  const sky=new THREE.Mesh(new THREE.SphereGeometry(1800,32,18),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:skyUniforms,vertexShader:`varying vec3 vDir; void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`
    varying vec3 vDir;uniform vec3 sun;uniform float day;uniform float uTime;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fb(vec2 p){return .5*n(p)+.25*n(p*2.01)+.125*n(p*4.03)+.065*n(p*8.07);}
    void main(){vec3 d=normalize(vDir);float y=max(d.y,0.);vec3 horizon=mix(vec3(.085,.115,.16),vec3(.69,.72,.68),day);vec3 zenith=mix(vec3(.012,.025,.058),vec3(.15,.31,.40),day);vec3 c=mix(horizon,zenith,pow(y,.48));
    float glow=pow(max(dot(d,sun),0.),12.);c+=vec3(1.,.54,.2)*glow*.28*day;
    if(d.y>0.){vec2 uv=d.xz/(d.y+.17)*1.2;float clouds=smoothstep(.47,.73,fb(uv+vec2(uTime*.0004,0.)));c=mix(c,mix(vec3(.1,.14,.19),vec3(.82,.78,.67),day),clouds*.57*smoothstep(0.,.12,d.y));}
    float disc=smoothstep(.9994,.9998,dot(d,sun));c+=disc*vec3(5.,3.8,2.5)*day;
    gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }` }));sky.frustumCulled=false;root.add(sky);
  const hemi=new THREE.HemisphereLight(0xa8d1e1,0x665846,2.1);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffe0b2,3.6);sun.position.set(-45,48,40);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=30;sun.shadow.camera.bottom=-30;sun.shadow.camera.near=1;sun.shadow.camera.far=160;sun.shadow.normalBias=.027;sun.shadow.bias=-.0001;sun.shadow.radius=3;scene.add(sun,sun.target);
  const rim=new THREE.DirectionalLight(0xb9dcf0,.75);rim.position.set(15,10,-35);scene.add(rim);
  scene.fog=new THREE.FogExp2(0xa5b2ae,.0019);
  let hdrTexture=null;let pmrem=null;
  const ready=new Promise(resolve=>{
    new HDRLoader().load('./assets/environment.hdr',t=>{
      hdrTexture=t;t.mapping=THREE.EquirectangularReflectionMapping;pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(t).texture;scene.environmentIntensity=.62;scene.background=t;scene.backgroundIntensity=.7;sky.visible=false;resolve(true);
    },undefined,()=>resolve(false));
  });
  let day=true;
  return {root,ready,setDay(value){
    day=value;sky.visible=!day||!hdrTexture;scene.background=day&&hdrTexture?hdrTexture:new THREE.Color(0x142833);skyUniforms.day.value=day?1:0;hemi.intensity=day?2.1:.6;sun.intensity=day?3.6:.38;sun.color.set(day?0xffe0b2:0xa4caff);rim.intensity=day?.75:.95;scene.environmentIntensity=day?.62:.3;scene.fog.color.set(day?0xa5b2ae:0x142833);
  },setQuality(q){sun.shadow.mapSize.set(q==='ultra'?4096:2048,q==='ultra'?4096:2048);sun.shadow.map?.dispose();sun.shadow.map=null;},update(time,position){
    skyUniforms.uTime.value=time;sun.target.position.set(position.x,position.y,position.z);sun.position.set(position.x-45,position.y+48,position.z+40);
  }};
}
