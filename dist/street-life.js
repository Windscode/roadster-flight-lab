/**
 * Original street market kit, authored in metres. Visual study: Dan Hargreaves'
 * Kabuki 5 and Dave Yablonsky's Kabuki 01 portfolio photographs (qa/city-references).
 * Neither game textures nor extracted game assets are used. All shapes, painted
 * atlases, lettering, goods and clothing here are made for this project.
 *
 * buildStreetLife(THREE, root) -> {group, update(seconds,vehiclePosition),
 * lightAnchors, colliders, stats, dispose}. Colliders are static metre-scale
 * box proxies in the same {id,kind,size,position,rotation} format as city-data.
 * Pedestrians follow short sidewalk paths, yield to a nearby vehicle and do
 * not cross the carriageway. They are visual residents, not collision bodies.
 */
import {CITY_BUILDINGS} from './city-data.js';
import {GLTFLoader} from './vendor/addons/loaders/GLTFLoader.js';

// Shared placement plan is deliberately independent of Three, Canvas and the
// browser. The physics world and the asset factory consume identical records.
const sections=[];
CITY_BUILDINGS.filter(b=>/^market-(front|gate)-/.test(b.id)).sort((a,b)=>a.z-b.z||a.x-b.x).forEach((b,bi)=>{
  const side=Math.sign(b.x+200);sections.push({b,bi,district:'lower',x:b.x-side*b.w/2,z:b.z,y:b.baseY+.12,yaw:-side*Math.PI/2,count:['market-front--1-0','market-front-1-1','market-front--1-2','market-gate-1-2'].includes(b.id)?2:0,spacing:5.8});
});
CITY_BUILDINGS.filter(b=>b.id.startsWith('industrial-')).forEach((b,bi)=>{
  const side=Math.sign(b.x-100);sections.push({b,bi,district:'industrial',x:b.x-side*b.w/2,z:b.z,y:b.baseY+.12,yaw:-side*Math.PI/2,count:0,spacing:9.3});
});
CITY_BUILDINGS.filter(b=>b.id.startsWith('terrace-')).forEach((b,bi)=>{
  for(const dir of [-1,1]){const face=b.z+dir*b.d/2;if(face>=229&&face<=338)sections.push({b,bi,dir,district:'upper',x:b.x,z:face,y:b.baseY+.12,yaw:dir>0?0:Math.PI,count:(b.id==='terrace-365-200'&&dir===1)||(b.id==='terrace-435-280'&&dir===1)?2:0,spacing:8.2});}
});
const courts=[[0,312,280],[1,499,285]];
const colliderDefinition=(id,size,x,z,baseY,yaw,u,y,v)=>({id:'street-'+id,kind:'street-prop',size,position:[x+Math.cos(yaw)*u+Math.sin(yaw)*v,baseY+y,z-Math.sin(yaw)*u+Math.cos(yaw)*v],rotation:[0,yaw,0]});
export const STREET_COLLIDERS=[];
for(const s of sections.filter(s=>s.district==='lower')){
  STREET_COLLIDERS.push(colliderDefinition(s.b.id+'-pavement',[s.b.d+3,.12,5],s.x,s.z,s.y,s.yaw,0,-.06,2.5));
  if(s.b.d>35&&s.count>0)for(const edge of [-1,1]){
    const u=edge*(s.b.d/2-2.5);
    STREET_COLLIDERS.push(colliderDefinition(s.b.id+'-table-'+edge,[.80,.86,.80],s.x,s.z,s.y,s.yaw,u,.46,3.25));
    for(const side of [-1,1])STREET_COLLIDERS.push(colliderDefinition(s.b.id+'-chair-'+edge+'-'+side,[.45,.99,.45],s.x,s.z,s.y,s.yaw,u+side*.91,.52,3.25));
  }
}
for(const s of sections)for(let k=0;k<s.count;k++){
  const type=s.district==='lower'?(s.bi*3+k)%8:s.district==='industrial'?[4,2,3,4][(s.bi+k)%4]:[5,3,2,0,3][(s.bi+k)%5],w=type===2||type===5?3.45:3.65;
  const id=s.b.id+'-'+(s.dir?s.dir+'-':'')+k;
  STREET_COLLIDERS.push(colliderDefinition(id,[w,.90,.78],s.x,s.z,s.y,s.yaw,(k-(s.count-1)/2)*s.spacing,.55,s.district==='lower'?2.30:.60));
}
for(const [ci,x,z]of courts){
  STREET_COLLIDERS.push(colliderDefinition('courtyard-'+ci+'-a',[ci===0?3.65:3.45,.90,.78],x,z-13.5,8.12,0,-4,.55,.60),colliderDefinition('courtyard-'+ci+'-b',[3.65,.90,.78],x,z-13.5,8.12,0,3,.55,.60));
  for(const side of [-1,1])for(const vv of [-9,9])STREET_COLLIDERS.push(colliderDefinition('court-bench-'+ci+'-'+side+'-'+vv,[1.7,1.10,.52],x,z,8.05,0,side*3.4,.61,vv));
  for(const side of [-1,1])for(const vv of [-9,9]){
    STREET_COLLIDERS.push(colliderDefinition('court-planter-'+ci+'-'+side+'-'+vv,[1.6,.44,1.2],x,z,8.05,0,side*7.6,.28,vv));
    STREET_COLLIDERS.push(colliderDefinition('court-trunk-'+ci+'-'+side+'-'+vv,[.17,4.1,.17],x,z,8.05,0,side*7.6,2.2,vv));
  }
  for(let i=0;i<6;i++){
    const u=(i%3-1)*4.4,v=(Math.floor(i/3)-.5)*7;
    STREET_COLLIDERS.push(colliderDefinition('court-table-'+ci+'-'+i,[.80,.86,.80],x,z,8.05,0,u,.46,v));
    for(const side of [-1,1])STREET_COLLIDERS.push(colliderDefinition('court-chair-'+ci+'-'+i+'-'+side,[.45,.99,.45],x,z,8.05,0,u+side*.91,.52,v));
  }
}

export function buildStreetLife(THREE,root){
  const group=new THREE.Group();group.name='Street life / sparse neighbourhood accents';root.add(group);
  const batches=new Map(),materials=[],textures=[],geometries=[],lightAnchors=[],colliders=STREET_COLLIDERS,people=[],animals=[];
  const stats={marketSections:0,stalls:0,cafes:0,repairShops:0,flowerStalls:0,produceStalls:0,
    bookStalls:0,foodStalls:0,pedestrians:0,bicycles:0,benches:0,goods:0,trees:0,
    instances:0,drawBatches:0,triangles:0,collisionProxies:0,originalAtlases:0,sectorSizeM:300,animals:0,animalTriangles:0,animatedAnimals:0,animalAssetErrors:[]};
  const rand=(seed=>()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;})(930217);
  const unit={box:new THREE.BoxGeometry(),cylinder:new THREE.CylinderGeometry(.5,.5,1,10),
    cone:new THREE.ConeGeometry(.5,1,10),sphere:new THREE.SphereGeometry(.5,10,7),
    plane:new THREE.PlaneGeometry(),torus:new THREE.TorusGeometry(.5,.065,5,14)};
  const leafShape=new THREE.Shape();leafShape.moveTo(0,-.5);leafShape.bezierCurveTo(-.23,-.22,-.20,.21,0,.5);leafShape.bezierCurveTo(.20,.21,.23,-.22,0,-.5);unit.leaf=new THREE.ShapeGeometry(leafShape,3);
  // Bevels are metre-scale shared meshes. Their face normals remain smooth at
  // corners while the broad panels stay flat; no postprocess outline is used.
  function roundedBox(w,h,d,r){
    const g=new THREE.BoxGeometry(1,1,1,4,4,4),p=g.attributes.position,n=g.attributes.normal;
    const core=new THREE.Vector3(),delta=new THREE.Vector3(),dims=[w,h,d];
    for(let i=0;i<p.count;i++){
      const q=[p.getX(i)*2,p.getY(i)*2,p.getZ(i)*2];
      core.set(...q.map((v,k)=>Math.max(-.5,Math.min(.5,v))*(dims[k]-2*r)));
      delta.set(...q.map(v=>v-Math.max(-.5,Math.min(.5,v)))).normalize();
      p.setXYZ(i,core.x+delta.x*r,core.y+delta.y*r,core.z+delta.z*r);n.setXYZ(i,delta.x,delta.y,delta.z);
    }return g;
  }
  function ringMesh(rings,segments=12){
    const p=[],uv=[],indices=[];
    rings.forEach(([y,rx,rz,z=0],j)=>{for(let k=0;k<=segments;k++){const a=k/segments*Math.PI*2;p.push(Math.cos(a)*rx,y,Math.sin(a)*rz+z);uv.push(k/segments,j/(rings.length-1));}});
    for(let j=0;j<rings.length-1;j++)for(let k=0;k<segments;k++){const a=j*(segments+1)+k,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  unit.counter=roundedBox(3.65,.76,.72,.027);unit.counterTop=roundedBox(3.73,.055,.79,.016);
  unit.seat=roundedBox(.43,.055,.43,.016);unit.chairBack=roundedBox(.42,.15,.035,.014);
  // Elliptical ring sections provide shoulders, a flatter back, waist and jaw.
  // The former circular torso and cuboid jaw read as toy parts at street level.
  unit.jacket=ringMesh([[0,.145,.092],[.08,.148,.098],[.19,.147,.089],[.36,.18,.104],[.465,.205,.090],[.495,.146,.076],[.515,.075,.065]]);
  unit.head=ringMesh([[-.116,.022,.035,.019],[-.096,.054,.052,.016],[-.05,.075,.069,.008],[.025,.081,.077],[.085,.069,.067,-.002],[.119,.030,.039,-.005],[.125,.001,.001,-.005]]);
  unit.hair=ringMesh([[.030,.080,.075,-.009],[.065,.081,.077,-.009],[.105,.067,.065,-.009],[.133,.027,.035,-.009],[.137,.001,.001,-.009]]);
  unit.shoe=ringMesh([[-.037,.051,.104,.008],[-.028,.065,.124,.004],[.005,.062,.121],[.032,.050,.088,-.023],[.041,.029,.046,-.041]],10);
  // A bone's +Y endpoint is its distal joint, so the narrow cylinder radius
  // belongs at +Y (ankle / wrist), not at the shoulder as on the old figures.
  unit.leg=new THREE.CylinderGeometry(.052,.071,1,9);
  unit.sleeve=ringMesh([[-.5,.001,.001],[-.47,.067,.065],[-.30,.074,.071],[.25,.062,.061],[.48,.055,.053],[.5,.001,.001]],10);
  unit.loaf=ringMesh([[0,.115,.065],[.025,.132,.074],[.075,.106,.062],[.11,.035,.025],[.114,.001,.001]],12);
  unit.bowl=new THREE.LatheGeometry([[.026,-.046],[.064,-.040],[.108,.017],[.121,.045],[.111,.045],[.098,.017],[.057,-.030],[.026,-.034]].map(p=>new THREE.Vector2(...p)),14);
  unit.cup=new THREE.LatheGeometry([[.032,-.058],[.047,-.057],[.052,.058],[.045,.058],[.040,-.047],[.032,-.049]].map(p=>new THREE.Vector2(...p)),14);
  function fabricMesh(valance=false){
    const p=[],uv=[],co=[],idx=[],segments=valance?40:10,rows=valance?1:8;
    for(let k=0;k<segments;k++)for(let j=0;j<rows;j++){
      const offset=p.length/3;
      for(const [uu,vv]of [[k/segments,j/rows],[(k+1)/segments,j/rows],[k/segments,(j+1)/rows],[(k+1)/segments,(j+1)/rows]]){
        const wave=Math.sin(uu*10*Math.PI),yy=valance?-vv*(.135+.030*Math.abs(wave)):-.11*vv-.075*Math.sin(Math.PI*vv)+.009*wave*Math.sin(Math.PI*vv);
        p.push(uu-.5,yy,valance?0:vv);uv.push(uu,vv);const tone=Math.floor((k+.5)/segments*10)%3===0?1:.76;co.push(tone,tone,tone);
      }idx.push(offset,offset+2,offset+1,offset+1,offset+2,offset+3);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(co,3));g.setIndex(idx);g.computeVertexNormals();return g;
  }
  unit.canopy=fabricMesh();unit.valance=fabricMesh(true);
  geometries.push(...Object.values(unit));
  const colours=new Map(),object=new THREE.Object3D(),rotationQ=new THREE.Quaternion();
  const colour=value=>{if(!colours.has(value))colours.set(value,new THREE.Color(value));return colours.get(value);};
  const mat=(name,options={})=>{const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.78,...options});m.name='Street / '+name;materials.push(m);return m;};
  const m={metal:mat('brushed stainless',{metalness:.78,roughness:.33}),steel:mat('powder-coated metal',{metalness:.42,roughness:.57}),wood:mat('worn timber',{roughness:.86}),
    ceramic:mat('glazed ceramics',{roughness:.33}),rubber:mat('tyres and soles',{roughness:.94}),paper:mat('paper and cartons',{roughness:.95}),
    food:mat('fruit vegetables and meals',{roughness:.56}),leaf:mat('living foliage',{roughness:.91,side:THREE.DoubleSide}),
    cloth:mat('woven clothing',{roughness:.91}),awning:mat('tensioned woven canvas',{roughness:.94,side:THREE.DoubleSide,vertexColors:true}),skin:mat('skin',{roughness:.69}),hair:mat('hair',{roughness:.89}),
    sign:mat('painted market sign'),lamp:mat('small practical lamps',{color:0xe9dbb4,emissive:0xffdaa1,emissiveIntensity:1.8,roughness:.4}),
    glass:mat('vending display glazing',{color:0x88a6a1,roughness:.18,metalness:.45}),stone:mat('planter stone',{roughness:.94})};
  function paintTexture(w,h,paint){
    if(typeof document==='undefined')return null;const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');if(!g)return null;paint(g,w,h);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;textures.push(t);stats.originalAtlases++;return t;
  }
  const labels=[['早市鲜蔬','FRESH / DAILY'],['街角面馆','NOODLE KITCHEN'],['旧物交换','SECOND LIFE'],['山茶咖啡','CAMELLIA / COFFEE'],
    ['港湾修理','HARBOR / REPAIR'],['四时花房','SEASONAL / FLOWERS'],['纸上旅行','BOOKS / RECORDS'],['海盐食堂','SEA SALT / DINER'],
    ['山脊农场','RIDGE / PRODUCE'],['茶与点心','TEA / PASTRIES'],['城市单车','CITY / CYCLES'],['街坊便利','NEIGHBOURHOOD'],
    ['晨光面包','DAWN / BAKERY'],['慢下来吧','TAKE A MOMENT'],['新鲜上市','FROM THE FARM'],['修补·再用','REPAIR / REUSE']];
  const signMap=paintTexture(2048,1024,(g,w,h)=>{
    g.fillStyle='#172525';g.fillRect(0,0,w,h);
    labels.forEach(([name,small],i)=>{const x=i%4*512,y=Math.floor(i/4)*256;
      // Paint at the physical 6.67:1 sign aspect, then pack. Wide sign meshes
      // must not stretch square-tile typography into horizontally smeared text.
      g.save();g.translate(x,y);g.scale(512/1000,256/150);
      g.fillStyle=['#d6c7a5','#42645b','#a56642','#596775'][i%4];g.fillRect(3,3,994,144);
      g.strokeStyle=['#554b35','#c5ccad','#e4cfaa','#d9ccb2'][i%4];g.lineWidth=2;g.strokeRect(14,8,972,134);
      g.fillStyle=i%4===0?'#33403a':'#eee3ca';g.textAlign='center';g.textBaseline='middle';g.font='600 65px Microsoft YaHei, sans-serif';g.fillText(name,500,55,920);
      g.font='20px sans-serif';g.fillText(small,500,105,910);g.font='11px monospace';g.fillText('NEIGHBOURHOOD MARKET  /  '+String(i+1).padStart(2,'0'),500,133,900);
      for(let k=0;k<75;k++){g.globalAlpha=.08;g.fillStyle=rand()>.5?'#fff5db':'#292d29';g.fillRect(rand()*1000,rand()*150,rand()*18+1,rand()+.5);}g.restore();
    });
  });
  m.sign.map=signMap;m.sign.roughness=.72;
  if(signMap){m.sign.onBeforeCompile=s=>{
    s.vertexShader='attribute vec4 streetUv;varying vec4 vStreetUv;varying vec2 vStreetBaseUv;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvStreetUv=streetUv;vStreetBaseUv=uv;');
    s.fragmentShader='varying vec4 vStreetUv;varying vec2 vStreetBaseUv;\n'+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','#ifdef USE_MAP\n diffuseColor*=texture2D(map,vStreetUv.xy+vStreetBaseUv*vStreetUv.zw);\n#endif');
  };m.sign.customProgramCacheKey=()=> 'street-original-sign-atlas-1';}
  // Fine woven grain follows world coordinates. Its size stays at centimetres,
  // rather than stretching with each differently sized canopy or jacket.
  for(const material of [m.cloth,m.awning,m.wood,m.stone,m.food]){
    const fabric=material===m.cloth||material===m.awning,timber=material===m.wood,food=material===m.food;
    material.onBeforeCompile=s=>{
      s.vertexShader='varying vec3 vStreetWorld;\n'+s.vertexShader;
      s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec4 swp=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nswp=instanceMatrix*swp;\n#endif\nvStreetWorld=(modelMatrix*swp).xyz;');
      s.fragmentShader='varying vec3 vStreetWorld;float streetNoise(vec3 p){return fract(sin(dot(floor(p),vec3(127.1,311.7,74.7)))*43758.5453);}\n'+s.fragmentShader;
      const detail=fabric?'float sw=sin(vStreetWorld.x*2600.)*sin(vStreetWorld.y*2600.)+sin(vStreetWorld.z*2600.)*.3;float weave=sw*clamp(.0015/max(length(fwidth(vStreetWorld)),.0001),0.,1.);diffuseColor.rgb*=.97+.025*weave;':timber?'float grain=sin(vStreetWorld.x*148.+sin(vStreetWorld.z*8.)*2.7+sin(vStreetWorld.y*12.));diffuseColor.rgb*=.94+.055*grain;':'diffuseColor.rgb*=.96+.08*mix(.5,streetNoise(vStreetWorld*'+(food?'430.':'95.')+'),sd);';
      s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat sd=clamp(.016/max(length(fwidth(vStreetWorld)),.001),0.,1.);'+detail);
      // Tangent-free height derivatives keep grain at physical scale on all
      // instanced orientations, including the tilted awnings and chair backs.
      const height=fabric?'sin(dot(vStreetWorld,vec3(2510.,1730.,2370.)))*.000035*clamp(.001/max(length(fwidth(vStreetWorld)),.0001),0.,1.)':timber?'sin(vStreetWorld.x*148.+sin(vStreetWorld.z*8.)*2.7+sin(vStreetWorld.y*12.))*.0008':food?'streetNoise(vStreetWorld*430.)*.00008':'streetNoise(vStreetWorld*95.)*.00025';
      s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nfloat streetHeight='+height+';vec3 streetDx=dFdx(vViewPosition),streetDy=dFdy(vViewPosition);vec3 streetR1=cross(streetDy,normal),streetR2=cross(normal,streetDx);float streetDet=dot(streetDx,streetR1);if(abs(streetDet)>1e-10)normal=normalize(abs(streetDet)*normal-sign(streetDet)*(dFdx(streetHeight)*streetR1+dFdy(streetHeight)*streetR2));');
    };material.customProgramCacheKey=()=> 'street-physical-grain-2-'+(fabric?'cloth':timber?'wood':food?'food':'stone');
  }
  let sector='';
  function add(material,geometry,size,pos,rot=[0,0,0],tint=0xffffff,tile=-1){
    if(size.some(v=>!Number.isFinite(v)||v<=0))return null;
    const key=sector+'|'+Object.keys(m).find(k=>m[k]===material)+'|'+geometry;
    let b=batches.get(key);if(!b){b={material,geometry,items:[]};batches.set(key,b);}
    object.position.set(...pos);object.rotation.set(...rot,'YXZ');object.scale.set(...size);object.updateMatrix();
    const item={matrix:object.matrix.clone(),colour:colour(tint),tile,index:b.items.length,batch:b};b.items.push(item);stats.instances++;return item;
  }
  const box=(mat,size,pos,rot,tint,tile)=>add(mat,'box',size,pos,rot,tint,tile);
  const cylinder=(mat,d,h,pos,tint,rot)=>add(mat,'cylinder',[d,h,d],pos,rot,tint);
  function link(material,a,b,r=.025,tint=0x626c65){const aa=new THREE.Vector3(...a),bb=new THREE.Vector3(...b),v=bb.clone().sub(aa);rotationQ.setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize());const e=new THREE.Euler().setFromQuaternion(rotationQ,'YXZ');return add(material,'cylinder',[r*2,v.length(),r*2],aa.add(bb).multiplyScalar(.5).toArray(),[e.x,e.y,e.z],tint);}
  function surface(x,z,baseY,yaw){
    const c=Math.cos(yaw),s=Math.sin(yaw);sector=Math.floor((x+100)/300)+','+Math.floor((z+100)/300);
    const point=(u,y,v)=>[x+c*u+s*v,baseY+y,z-s*u+c*v];
    const put=(mat,geo,size,u,y,v,tint=0xffffff,rot=[0,0,0],tile=-1)=>add(mat,geo,size,point(u,y,v),[rot[0],yaw+rot[1],rot[2]],tint,tile);
    const cube=(mat,size,u,y,v,tint,rot,tile)=>put(mat,'box',size,u,y,v,tint,rot,tile);
    const wire=(a,b,r,tint)=>link(m.steel,point(...a),point(...b),r,tint);
    return {x,z,baseY,yaw,point,put,cube,wire};
  }
  const fabric=[0x8f5f46,0x65786b,0xb0a17a,0x687c80,0x89715d,0x777d56],woodColours=[0x8e7150,0x6c5e47,0xa08b67];
  function sign(f,u,y,v,w,h,tile){
    f.cube(m.steel,[w+.08,h+.08,.08],u,y,v,0x26322f);
    f.put(m.sign,'plane',[w,h,1],u,y,v+.046,0xffffff,undefined,tile);
  }
  function crate(f,u,y,v,w=.57,d=.48,goods=0){
    f.cube(m.wood,[w,.055,d],u,y-.16,v,woodColours[goods%3]);
    for(const side of [-1,1]){
      for(let slat=0;slat<3;slat++){f.cube(m.wood,[w,.052,.028],u,y-.11+slat*.092,v+side*(d/2-.014),woodColours[goods%3]);f.cube(m.wood,[.028,.052,d],u+side*(w/2-.014),y-.11+slat*.092,v,woodColours[(goods+1)%3]);}
      for(const zz of [-1,1])f.cube(m.wood,[.033,.29,.033],u+side*(w/2-.04),y-.015,v+zz*(d/2-.04),0x796248);
    }
    if(goods===0)return;
    for(let a=0;a<3;a++)for(let b=0;b<3;b++){
      const xx=u+(a-1)*w*.23,zz=v+(b-1)*d*.23,yy=y+.04+rand()*.045;
      if(goods%4===1){f.put(m.food,'sphere',[.115,.102,.113],xx,yy,zz,a%2?0xb4402c:0x896f29);f.put(m.leaf,'leaf',[.023,.055,1],xx,yy+.051,zz,0x465839,[-Math.PI/2,rand()*3,.2]);}
      else if(goods%4===2){f.put(m.food,'sphere',[.16,.14,.145],xx,yy,zz,0x73845c);for(let q=0;q<2;q++)f.put(m.leaf,'sphere',[.13,.055,.15],xx,yy+.04,zz,0x556e49,[.4,rand()*5,0]);}
      else if(goods%4===3){f.put(m.food,'cone',[.052,.24,.05],xx,yy,zz,0xbf753a,[.5,rand(),.7]);f.put(m.leaf,'leaf',[.045,.14,1],xx+.06,yy+.11,zz,0x496644,[0,0,-.5]);}
      else {f.put(m.food,'sphere',[.10,.085,.105],xx,yy,zz,0xbd9c51);}
      stats.goods++;
    }
  }
  function canopy(f,u,width,shade,depth=1.35){
    const h=2.52;
    // One curved, tensioned sheet replaces twenty flat boards. The wall roll,
    // scalloped hem and edge piping make the fabric construction legible.
    f.put(m.awning,'canopy',[width,1,depth],u,h+.04,.05,shade);
    f.put(m.awning,'valance',[width,1,1],u,h-.07,depth+.05,shade);
    f.put(m.cloth,'cylinder',[.018,width,.018],u,h-.07,depth+.05,shade,[0,0,Math.PI/2]);
    f.put(m.steel,'cylinder',[.055,width,.055],u,h+.08,.05,0x53645e,[0,0,Math.PI/2]);
    for(const side of [-1,1]){f.wire([u+side*width*.43,1.88,.08],[u+side*width*.43,h-.04,depth-.08],.018,0x444f49);f.wire([u+side*width*.43,h+.06,.04],[u+side*width*.43,h-.06,depth-.08],.017,0x78847b);}
    for(const side of [-1,1]){f.put(m.steel,'cylinder',[.035,h,.035],u+side*width*.47,h/2,.10,0x52614f);f.put(m.steel,'cylinder',[.035,h-.12,.035],u+side*width*.47,(h-.12)/2,depth-.08,0x52614f);}
  }
  function counter(f,u,width,id,shade,kind){
    stats.stalls++;canopy(f,u,width+.24,shade);
    const wood=kind%2===0;
    f.put(wood?m.wood:m.steel,'counter',[width/3.65,1,1],u,.51,.59,wood?0x72634e:0x58665c);
    f.put(m.metal,'counterTop',[(width+.08)/3.73,1,1],u,.92,.60,0xaeb2a4);
    for(const side of [-1,1]){f.cube(m.steel,[.014,.53,.014],u+side*width*.32,.52,.957,0x3e4941);f.put(m.metal,'cylinder',[.022,.017,.022],u+side*width*.24,.64,.963,0xb6b8aa,[Math.PI/2,0,0]);}
    f.cube(m.steel,[width,.10,.05],u,.26,.985,0x424c43);
    for(const side of [-1,1])f.put(m.rubber,'cylinder',[.15,.045,.15],u+side*width*.35,.18,.67,0x242923,[Math.PI/2,0,0]);
    sign(f,u,2.20,.11,width*.83,.45,kind===0?0:kind===1?1:kind===2?6:kind===3?4:kind===4?5:3);
  }
  function kitchen(f,u,id,shade){
    stats.foodStalls++;counter(f,u,3.65,id,shade,1);
    // Steamers, serving bowls, ingredients, condiment jars and a cooking hood.
    f.cube(m.metal,[1.25,.16,.53],u-.87,1.02,.64,0x8b9286);
    for(let k=0;k<3;k++){const q=u-1.25+k*.38;
      f.put(m.metal,'cylinder',[.29,.24,.29],q,1.20,.57,0x929a8c);
      f.put(m.metal,'cone',[.31,.06,.31],q,1.35,.57,0xa4aa9c);
      f.cube(m.steel,[.08,.035,.04],q,1.39,.57,0x354438);
    }
    f.cube(m.metal,[1.37,.21,.54],u-.87,1.83,.29,0x6b756a);
    for(let k=0;k<6;k++)f.cube(m.steel,[.017,.05,.44],u-1.37+k*.19,1.69,.31,0x36463d);
    for(let k=0;k<6;k++){const x=u+.05+(k%3)*.40,z=.43+Math.floor(k/3)*.31;
      f.put(m.ceramic,'bowl',[1,1,1],x,1.01,z,0xcac6ae);f.put(m.food,'cylinder',[.20,.012,.20],x,1.035,z,0x9a7444);
      for(let garnish=0;garnish<2;garnish++)f.put(m.leaf,'leaf',[.048,.085,1],x+(garnish-.5)*.05,1.046,z+.015,0x63844d,[-Math.PI/2,0,garnish*.7]);
      f.cube(m.wood,[.29,.012,.012],x,1.10,z-.08,0x8c7654,[0,.32,0]);stats.goods++;
    }
    for(let k=0;k<4;k++){f.put(m.ceramic,'cylinder',[.105,.23,.105],u+1.30,1.06,.30+k*.17,k%2?0x7c402e:0xc0ac73);f.put(m.steel,'cylinder',[.11,.025,.11],u+1.30,1.19,.30+k*.17,0x3d493e);}
    f.cube(m.paper,[.32,.25,.26],u+1.05,1.06,.50,0xc6bda6);
  }
  function produce(f,u,id,shade){
    stats.produceStalls++;counter(f,u,3.65,id,shade,0);
    for(let k=0;k<5;k++)crate(f,u-1.41+k*.70,1.12,.63,.64,.53,1+k%4);
    for(let k=0;k<3;k++)crate(f,u-1.18+k*.75,.40,.55,.66,.54,0);
    f.put(m.metal,'cylinder',[.32,.045,.32],u+1.49,1.36,.58,0x9a9f90);
    f.cube(m.steel,[.21,.32,.18],u+1.49,1.18,.58,0x596e60);
    f.cube(m.paper,[.19,.105,.012],u+1.49,1.28,.695,0xb9b59f);
  }
  function books(f,u,id,shade){
    stats.bookStalls++;counter(f,u,3.45,id,shade,2);
    const bookColours=[0x7c6454,0xa3936b,0x536d70,0x7e6e56,0x76616b,0xadb3a2];
    for(let k=0;k<8;k++){
      const x=u-1.4+k*.40,hh=.12+(k%3)*.055;
      for(let q=0;q<3;q++){f.cube(m.paper,[.30,.036,.41],x,1.02+q*.052,.61,bookColours[(k+q)%6],[0,.1*(q-1),0]);f.cube(m.paper,[.275,.025,.39],x,1.02+q*.052+.002,.61,0xbeb9a1,[0,.1*(q-1),0]);}
      f.cube(m.paper,[.32,hh,.07],x,1.06+hh*.5,.24,bookColours[k%6]);stats.goods+=4;
    }
    f.cube(m.wood,[3.1,.05,.32],u,1.61,.11,0x73654d);
    for(let k=0;k<22;k++)f.cube(m.paper,[.045+.015*(k%2),.27+(k%3)*.05,.22],u-1.39+k*.129,1.80,.12,bookColours[k%6],[0,0,(k%7===0?.12:0)]);
  }
  function flower(f,u,id,shade){
    stats.flowerStalls++;counter(f,u,3.45,id,shade,4);
    for(let k=0;k<7;k++){
      const x=u-1.4+k*.45,yy=1.10+(k%2)*.08,z=.50+(k%2)*.20;
      f.put(m.ceramic,'cone',[.27,.31,.27],x,yy-.07,z,0x8b7158,[Math.PI,0,0]);
      for(let q=0;q<5;q++){
        const xx=x+(rand()-.5)*.21,zz=z+(rand()-.5)*.21,h=.22+rand()*.24;
        f.put(m.leaf,'cylinder',[.009,h,.009],xx,yy+h*.5,zz,0x586e42);
        f.put(m.leaf,'sphere',[.13,.025,.057],xx+.035,yy+h*.55,zz,0x557342,[0,q, .35]);
        f.put(m.food,'sphere',[.083,.055,.083],xx,yy+h,zz,[0xb69c76,0xb77568,0xc6b98e,0x917a95][k%4]);stats.goods++;
      }
    }
    for(const dx of [-1.38,1.38])f.put(m.leaf,'cone',[.31,.40,.31],u+dx,1.70,.12,0x60734d);
  }
  function repair(f,u,id,shade){
    stats.repairShops++;counter(f,u,3.65,id,shade,3);
    f.cube(m.wood,[3.45,.56,.06],u,1.56,.05,0x6a7468);
    for(let k=0;k<10;k++)for(let j=0;j<3;j++)f.put(m.steel,'cylinder',[.014,.015,.014],u-1.5+k*.33,1.36+j*.17,.09,0x303c32,[Math.PI/2,0,0]);
    for(let k=0;k<7;k++){
      const x=u-1.4+k*.44,y=1.52+(k%3)*.08;
      f.cube(m.metal,[.025,.28,.025],x,y,.12,0xa3a99a,[0,0,(k%2?.25:-.2)]);
      f.put(m.metal,'torus',[.11,.11,.50],x,y+.15,.12,0x959e8b);
      f.cube(m.steel,[.10,.07,.05],x,y-.15,.13,0x67523b);
    }
    f.cube(m.steel,[.33,.27,.26],u-.92,1.09,.64,0x57664e);f.cube(m.metal,[.43,.07,.23],u-.92,1.23,.64,0x939c8a);
    f.put(m.metal,'cylinder',[.25,.045,.25],u-.30,1.01,.57,0x9d9e8c);f.put(m.metal,'cylinder',[.18,.14,.18],u+.10,1.06,.65,0x7d8775);
    for(let k=0;k<5;k++)f.cube(m.steel,[.25,.06,.15],u+.55+(k%2)*.30,1.00+Math.floor(k/2)*.07,.53,0x414e44,[0,k*.3,0]);
    f.put(m.rubber,'torus',[.62,.62,1.0],u+1.42,1.63,.12,0x252d26);f.put(m.metal,'torus',[.42,.42,.55],u+1.42,1.63,.16,0x7a8477);stats.goods+=15;
  }
  function coffee(f,u,id,shade){
    stats.cafes++;counter(f,u,3.65,id,shade,5);
    f.cube(m.steel,[.75,.52,.42],u-1.03,1.21,.50,0x5e7466);f.cube(m.metal,[.78,.055,.45],u-1.03,1.50,.50,0xa0a798);
    f.cube(m.steel,[.67,.13,.42],u-1.03,1.36,.74,0x384940);f.cube(m.metal,[.66,.04,.20],u-1.03,1.08,.82,0x8b9685);
    for(const dx of [-.16,.16])f.put(m.metal,'cylinder',[.06,.06,.06],u-1.03+dx,1.30,.80,0xa0a895);
    for(let k=0;k<7;k++){f.put(m.ceramic,'cup',[1,1,1],u-.42+k*.26,1.01,.74,0xd1ceba);f.put(m.ceramic,'torus',[.06,.06,.27],u-.36+k*.26,1.02,.74,0xd1ceba,[0,Math.PI/2,0]);}
    f.cube(m.wood,[1.57,.04,.39],u+.71,1.02,.31,0x786147);
    for(let k=0;k<8;k++){
      const xx=u+.12+(k%4)*.32,zz=.23+Math.floor(k/4)*.17;
      f.put(m.food,'loaf',[.86,1,.97],xx,1.04,zz,0xb28b51,[0,k*.2,0]);
      // Three shallow flour scores sit on the rounded crust rather than
      // adding another stack of rectangular bakery products.
      for(let q=0;q<3;q++)f.cube(m.paper,[.007,.002,.063],xx+(q-1)*.034,1.139-Math.abs(q-1)*.012,zz,0xc9b784,[0,k*.2+.3,0]);
    }stats.goods+=15;
  }
  const shopTypes=[produce,kitchen,books,coffee,repair,flower,kitchen,coffee];
  function bicycle(f,u,v,tint=0x62766b){
    stats.bicycles++;
    for(const x of [-.55,.55]){f.put(m.rubber,'torus',[.65,.65,.42],u+x,.40,v,0x262c26);f.put(m.metal,'torus',[.56,.56,.22],u+x,.40,v+.008,0x929d8b);
      for(let k=0;k<8;k++){const angle=k*Math.PI/4;f.wire([u+x,.40,v],[u+x+Math.sin(angle)*.27,.40+Math.cos(angle)*.27,v],.004,0x879482);}}
    for(const [a,b]of [[[-.55,.40],[0,.40]],[[0,.40],[-.20,.91]],[[-.20,.91],[-.55,.40]],[[-.20,.91],[.35,.91]],[[.35,.91],[0,.40]],[[.35,.91],[.55,.40]]])f.wire([u+a[0],a[1],v],[u+b[0],b[1],v],.018,tint);
    f.wire([u+.35,.91,v],[u+.31,1.10,v],.018,tint);f.wire([u+.31,1.10,v-.17],[u+.31,1.10,v+.17],.018,0x445548);
    f.wire([u-.2,.91,v],[u-.2,1.05,v],.018,0x889781);f.cube(m.rubber,[.25,.07,.18],u-.23,1.07,v,0x2c3229);
    f.put(m.metal,'torus',[.20,.20,.25],u,.40,v+.03,0x8f9a84);f.cube(m.wood,[.28,.23,.27],u+.52,1.01,v,0x7d7454);
  }
  function chair(f,u,v,angle=0){
    const p=f.point(u,0,v),c=surface(p[0],p[2],p[1],f.yaw+angle);
    c.put(m.wood,'seat',[1,1,1],0,.55,0,0x8a765a);
    for(const sx of [-1,1])for(const sz of [-1,1])c.put(m.steel,'cylinder',[.029,.52,.029],sx*.16,.29,sz*.16,0x435347);
    for(const sx of [-1,1])c.put(m.steel,'cylinder',[.029,.48,.029],sx*.16,.80,-.18,0x435347);
    c.put(m.wood,'chairBack',[1,1,1],0,.93,-.18,0x8a765a,[-.12,0,0]);
  }
  function table(f,u,v){
    f.put(m.wood,'cylinder',[.74,.06,.74],u,.83,v,0x8e795b);f.put(m.steel,'cylinder',[.075,.75,.075],u,.44,v,0x485b49);
    f.put(m.steel,'cylinder',[.45,.045,.45],u,.09,v,0x485b49);
    for(const side of [-1,1]){f.put(m.ceramic,'cup',[1,1,1],u+side*.2,.92,v,0xd1ceba);f.put(m.food,'cylinder',[.079,.006,.079],u+side*.2,.969,v,0x493d26);}
    f.cube(m.paper,[.24,.02,.32],u,.88,v+.02,0xc9c2a7,[0,.32,0]);
  }
  function bench(f,u,v){
    stats.benches++;
    for(let k=0;k<5;k++)f.cube(m.wood,[1.65,.045,.085],u,.57,v-.2+k*.1,0x8b7857);
    for(let k=0;k<4;k++)f.cube(m.wood,[1.65,.085,.04],u,.78+k*.1,v-.24,0x8b7857,[-.13,0,0]);
    for(const s of [-1,1]){f.cube(m.steel,[.06,.54,.40],u+s*.63,.30,v,0x415242);f.cube(m.steel,[.06,.55,.055],u+s*.63,.85,v-.29,0x415242);}
  }
  function tree(f,u,v,size=1){
    stats.trees++;f.cube(m.stone,[1.6,.44,1.2],u,.28,v,0x8d9280);f.cube(m.wood,[1.39,.055,.99],u,.53,v,0x514a33);
    f.put(m.wood,'cylinder',[.14,3.3*size,.14],u,1.8*size,v,0x6f6650);
    for(let i=0;i<18;i++){
      const a=i*2.399,h=(2.1+rand()*1.55)*size,r=(.28+rand()*.62)*size,cx=u+Math.cos(a)*r,cz=v+Math.sin(a)*r;
      f.wire([u,h-.75,v],[cx,h,cz],.016,0x776c50);
      for(let j=0;j<105;j++){
        const phi=rand()*Math.PI*2,q=Math.sqrt(rand())*.67*size,yy=(rand()-.5)*.70*size;
        f.put(m.leaf,'leaf',[.19*size,.22*size,1],cx+Math.cos(phi)*q,h+.15+yy,cz+Math.sin(phi)*q,[0x53693d,0x667b48,0x758a50,0x4e6239][j%4],[rand()*2,rand()*6,rand()*6]);
      }
    }
  }
  function residentPose(person,time,active){
    const q={},phase=time*3.7+person.phase,swing=active?Math.sin(phase):0;
    for(const side of [-1,1]){
      q['hip'+side]=[side*.087,.925,0];q['knee'+side]=[side*.09,.51,.019+swing*side*.12];
      q['ankle'+side]=[side*.09,.089+Math.max(0,swing*side)*.06,.025+swing*side*.22];
      q['shoulder'+side]=[side*.19,1.357,0];q['elbow'+side]=[side*.234,1.065,.035-swing*side*.09];
      q['wrist'+side]=[side*.23,.785,.065-swing*side*.20];
    }
    if(!person.walking){
      const pose=person.index%5;
      if(pose===0)for(const side of [-1,1]){q['elbow'+side]=[side*.225,1.08,.15];q['wrist'+side]=[side*.20,1.06,.365];}
      if(pose===1){q.elbow1=[.23,1.06,.16];q.wrist1=[.13,1.18,.28];}
      if(pose===2){q['elbow-1']=[-.31,1.09,.025];q['wrist-1']=[-.154,.99,.02];}
      if(pose===3){q['elbow-1']=[-.23,1.045,.15];q['wrist-1']=[-.11,1.13,.29];q.elbow1=[.225,1.025,.17];q.wrist1=[.025,1.13,.28];}
      if(pose===4){q.elbow1=[.265,1.08,.14];q.wrist1=[.25,1.20,.21];}
    }
    const breath=Math.sin(time*.94+person.phase)*.0025;
    q.head=[0,1.606+breath,.004];q.root=[0,.923+breath,0];
    q.leanX=Math.sin(time*.31+person.phase)*.009;q.leanZ=person.walking?.014:(person.index%5===0?.045:.007);
    q.headYaw=Math.sin(time*.22+person.phase)*.10+(person.index%3-1)*.08;
    return q;
  }
  const personA=new THREE.Vector3(),personB=new THREE.Vector3(),personQ=new THREE.Quaternion(),personYawQ=new THREE.Quaternion(),upAxis=new THREE.Vector3(0,1,0);
  function placeResidentPart(p,part,pose,walk=0){
    const transform=(point,target)=>{
      let [x,y,z]=point;x+=pose.leanX*(y-.923);z+=pose.leanZ*(y-.923);x*=p.build;z*=p.build;y*=p.height;
      const a=p.relativeYaw,world=p.f.point(p.u+walk+Math.cos(a)*x+Math.sin(a)*z,y,p.v-Math.sin(a)*x+Math.cos(a)*z);return target.set(...world);
    };
    if(part.bone){
      transform(pose[part.bone[0]],personA);transform(pose[part.bone[1]],personB);personB.sub(personA);
      object.position.copy(personA).addScaledVector(personB,.5);object.quaternion.setFromUnitVectors(upAxis,personB.clone().normalize());object.scale.set(part.size[0]*p.build,personB.length()+.035*p.height,part.size[2]*p.build);
    }else{
      let [x,y,z]=part.pos;const rot=part.rot.slice();
      if(part.anchor){const anchor=pose[part.anchor];x+=anchor[0];y+=anchor[1];z+=anchor[2];}
      if(part.head){const dx=x,dz=z-.004;x=Math.cos(pose.headYaw)*dx+Math.sin(pose.headYaw)*dz;z=.004-Math.sin(pose.headYaw)*dx+Math.cos(pose.headYaw)*dz;y+=pose.head[1]-1.606;rot[1]+=pose.headYaw;}
      transform([x,y,z],personA);object.position.copy(personA);personQ.setFromEuler(new THREE.Euler(rot[0]+pose.leanZ,rot[1],rot[2]-pose.leanX,'YXZ'));personYawQ.setFromAxisAngle(upAxis,p.yaw);object.quaternion.copy(personYawQ).multiply(personQ);object.scale.set(part.size[0]*p.build,part.size[1]*p.height,part.size[2]*p.build);
    }
    object.updateMatrix();return object.matrix;
  }
  function resident(f,u,v,index,walking=false){
    const skin=[0xa67b60,0xc6a086,0x8b644b,0xb58a6a][index%4],jacket=[0x667168,0x594f48,0x687477,0x8a785b,0x73666c][index%5],trousers=[0x414a47,0x4c5049,0x51534c][index%3],parts=[];
    const relativeYaw=walking?Math.PI/2:(index%3-1)*.24,yaw=f.yaw+relativeYaw;
    const p={f,u,v,yaw,relativeYaw,parts,walking,index,world:f.point(u,0,v),phase:index*2.397,speed:.32+(index%4)*.08,height:.96+(index%5)*.018,build:.93+(index%4)*.045},pose=residentPose(p,0,false);
    // Preserve the articulated matrix: add() uses the common placement object.
    function part(geo,size,pos,material,tint,options={}){
      const entry={size,pos,rot:[0,0,0],...options},matrix=placeResidentPart(p,entry,pose).clone(),item=add(material,geo,[1,1,1],[0,0,0],undefined,tint);
      if(item){item.matrix.copy(matrix);entry.item=item;parts.push(entry);}return entry;
    }
    part('jacket',[1,1,1],[0,.923,0],m.cloth,jacket);
    part('box',[.008,.34,.007],[0,1.19,.102],m.cloth,0x464c43);
    for(const side of [-1,1])part('box',[.074,.008,.009],[side*.105,1.14,.102],m.cloth,0x4c544b,{rot:[0,0,side*.05]});
    part('cylinder',[.088,.12,.086],[0,1.457,0],m.skin,skin);
    part('head',[1,1,1],[0,1.606,.004],m.skin,skin,{head:true});
    part('hair',[1,1,1],[0,1.606,.004],m.hair,[0x34352d,0x565143,0x3f3830][index%3],{head:true});
    if(index%4===1)part('sphere',[.069,.079,.075],[0,1.661,-.090],m.hair,0x4b4134,{head:true});
    part('sphere',[.027,.047,.042],[0,1.589,.084],m.skin,skin,{head:true});
    part('box',[.035,.004,.004],[0,1.549,.070],m.skin,0x875b4b,{head:true});
    for(const side of [-1,1]){
      part('sphere',[.025,.048,.027],[side*.081,1.60,-.001],m.skin,skin,{head:true});
      part('sphere',[.017,.007,.007],[side*.030,1.621,.073],m.paper,0xc5b5a3,{head:true});
      part('sphere',[.008,.008,.005],[side*.030,1.621,.076],m.hair,0x30312c,{head:true});
      part('box',[.030,.005,.005],[side*.030,1.637,.075],m.hair,0x4b4134,{head:true,rot:[0,0,side*.10]});
      part('leg',[1,1,1],[0,0,0],m.cloth,trousers,{bone:['hip'+side,'knee'+side]});
      part('leg',[.75,1,.75],[0,0,0],m.cloth,trousers,{bone:['knee'+side,'ankle'+side]});
      part('shoe',[1,1,1],[0,-.040,.055],m.rubber,0x4c5046,{anchor:'ankle'+side});
      part('shoe',[1.04,.24,1.04],[0,-.080,.055],m.rubber,0x262e28,{anchor:'ankle'+side});
      part('sleeve',[1,1,1],[0,0,0],m.cloth,jacket,{bone:['shoulder'+side,'elbow'+side]});
      part('sleeve',[.76,1,.76],[0,0,0],m.cloth,jacket,{bone:['elbow'+side,'wrist'+side]});
      part('sphere',[.061,.096,.038],[0,-.036,.007],m.skin,skin,{anchor:'wrist'+side});
      part('sphere',[.023,.043,.025],[-side*.029,-.020,.020],m.skin,skin,{anchor:'wrist'+side,rot:[0,0,side*.35]});
    }
    if(!walking&&index%5===1)part('cup',[.83,.83,.83],[0,.009,.031],m.ceramic,0xc7c7af,{anchor:'wrist1'});
    if(!walking&&index%5===3)part('box',[.064,.106,.009],[0,.017,.028],m.steel,0x303c36,{anchor:'wrist-1',rot:[-.40,0,0]});
    stats.pedestrians++;people.push(p);
  }

  // Shops are part of the architecture. Only four small lower-city pockets
  // receive outdoor kiosks; the continuous street wall remains the main scene.
  for(const s of sections.filter(s=>s.district==='lower')){
    const {b,bi,count,spacing}=s,f=surface(s.x,s.z,s.y,s.yaw),span=b.d;if(count)stats.marketSections++;
    f.cube(m.stone,[span+3,.12,5],0,-.06,2.5,0x92978a);
    f.cube(m.stone,[span+3,.10,.16],0,-.015,4.93,0xb3b6a4);
    // Paving slabs are 0.8 m, with seams and a dark utility channel along the
    // wall. The five-metre strip leaves a 10 m clear driving carriageway.
    for(let uu=-span/2;uu<span/2;uu+=.8)f.cube(m.stone,[.012,.004,4.65],uu,.002,2.49,0x686f62);
    for(let vv=.9;vv<4.9;vv+=.8)f.cube(m.stone,[span+2.8,.004,.012],0,.003,vv,0x686f62);
    const shifted=f.point(0,0,1.7),shopF=surface(shifted[0],shifted[2],shifted[1],s.yaw);
    for(let k=0;k<count;k++){
      const u=(k-(count-1)/2)*spacing,type=(bi*3+k)%shopTypes.length;
      shopTypes[type](shopF,u,b.id+'-'+k,fabric[(bi+k)%fabric.length]);
      if(k===0)resident(f,u+2.18,1.20,bi*6+k,false);
      if((bi+k)%5===0)bicycle(f,u+2.30,.40,0x6b7563);
    }
    // Small walkable cross-alley at the end of the frontage: crates and a
    // public seat are on the sidewalk side, never inside a solid building.
    if(span>35&&count>0){const u=span/2-1.6;crate(f,u,.40,.55,.66,.52,0);crate(f,u,.73,.55,.62,.49,0);for(const edge of [-1,1]){const uu=edge*(span/2-2.5);table(f,uu,3.25);chair(f,uu-.91,3.25,Math.PI/2);chair(f,uu+.91,3.25,-Math.PI/2);}}
    if(count>0&&bi%2===0)resident(f,-span/2+.7,4.00,bi+81,true);
  }
  for(const s of sections.filter(s=>s.district==='industrial')){
    const {b,bi,count,spacing}=s,f=surface(s.x,s.z,s.y,s.yaw);if(count)stats.marketSections++;
    for(let k=0;k<count;k++){
      const u=(k-(count-1)/2)*spacing;[repair,books,coffee,repair][(bi+k)%4](f,u,b.id+'-'+k,fabric[(bi+k+2)%6]);
      if(k===0){bicycle(f,u+2.8,.68,0x67766a);resident(f,u+2.4,1.3,180+bi*5+k,false);}
      crate(f,u+2.5,.40,.30,.65,.58,0);
    }
  }
  // Upper city cafés occupy the 2 m cross-street pavements between the fixed
  // terrace buildings. Nothing is placed on the already narrow x=400 lane.
  for(const s of sections.filter(s=>s.district==='upper')){
      const {b,bi,dir,count,spacing}=s,f=surface(s.x,s.z,s.y,s.yaw);if(count)stats.marketSections++;
      for(let k=0;k<count;k++){
        const u=(k-(count-1)/2)*spacing;[flower,coffee,books,produce,coffee][(bi+k)%5](f,u,b.id+'-'+dir+'-'+k,fabric[(bi+k)%6]);
        if(k===0)resident(f,u+2.5,.65,260+bi*7+k,false);
      }
  }
  // Attractive destinations in the open terrace pockets: garden dining and a
  // book / flower courtyard, with a clear route to the adjacent driving road.
  for(const [courtIndex,x,z]of courts){
    const f=surface(x,z,8.05,0);stats.marketSections++;
    // A recognisable destination needs a composed floor and garden edge,
    // rather than tables dropped on the city-wide concrete slab.
    for(let row=0;row<43;row++)for(let col=0;col<19;col++){
      const u=-11.25+col*1.20+(row%2)*.60,v=-12.6+row*.60;
      if(Math.abs(u)>11.4)continue;
      f.cube(m.stone,[1.18,.035,.58],u,-.025,v,[0xa5a18a,0x9d9c87,0xb0a991,0x9b9f8d][(col+row*3)%4]);
    }
    for(const side of [-1,1])f.cube(m.stone,[.12,.055,27],side*11.8,-.005,0,0x717c69);
    for(const side of [-1,1])for(const vv of [-9,9]){tree(f,side*7.6,vv,1.22);bench(f,side*3.4,vv);}
    for(let i=0;i<6;i++){const u=(i%3-1)*4.4,v=(Math.floor(i/3)-.5)*7;table(f,u,v);chair(f,u-.91,v,Math.PI/2);chair(f,u+.91,v,-Math.PI/2);}
    const back=surface(x,z-13.5,8.12,0);[coffee,flower,books][courtIndex](back,-4,'courtyard-'+courtIndex+'-a',fabric[1]);coffee(back,3,'courtyard-'+courtIndex+'-b',fabric[4]);
    for(let k=0;k<2;k++)resident(f,(k*2-1)*4.4+1.2,-5,340+courtIndex*11+k,k===1);
    sign(f,0,3.1,-12.9,7.6,.86,courtIndex?13:3);
    for(const xx of [-8,8]){f.put(m.steel,'cylinder',[.075,3.1,.075],xx,1.58,-11.4,0x53634d);f.wire([xx,3.12,-11.4],[xx,3.12,11.4],.012,0x52624c);}
    for(let k=0;k<10;k++)for(const side of [-1,1]){f.put(m.lamp,'sphere',[.09,.09,.09],side*8,3.03,-10+k*2.2,0xe3d8b2);}
    lightAnchors.push({position:f.point(0,3.1,0),color:0xf5d9ab,intensity:65,range:16});
  }

  // Each geometry/material is instanced per 300 m sector so a dense street is
  // still frustum culled as a street, not one giant always-visible city batch.
  for(const b of batches.values()){
    const geometry=unit[b.geometry].clone();geometries.push(geometry);
    if(b.material===m.sign){const uv=new Float32Array(b.items.length*4);b.items.forEach((it,i)=>{const tile=Math.max(0,it.tile)%16,pad=3/2048;uv.set([tile%4*.25+pad,1-(Math.floor(tile/4)+1)*.25+pad,.25-pad*2,.25-pad*2],i*4);});geometry.setAttribute('streetUv',new THREE.InstancedBufferAttribute(uv,4));}
    const mesh=new THREE.InstancedMesh(geometry,b.material,b.items.length);mesh.name='Street / '+b.material.name+' / '+b.geometry;
    b.items.forEach((it,i)=>{mesh.setMatrixAt(i,it.matrix);mesh.setColorAt(i,it.colour);});
    // Small products and printed signs sit under larger awnings/counters.
    // Their supporting geometry provides the street shadow without submitting
    // every cup, page and face to all three city shadow cascades.
    mesh.castShadow=![m.sign,m.food,m.paper,m.skin,m.hair,m.glass,m.lamp,m.ceramic].includes(b.material);mesh.receiveShadow=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);b.mesh=mesh;
    stats.drawBatches++;stats.triangles+=(geometry.index?.count||geometry.attributes.position.count)/3*b.items.length;
  }
  // A pair of original Quaternius CC0 animals replaces crowd-as-decoration.
  // They stand in sidewalk/courtyard pockets, never on a vehicle lane. Skinning
  // and idle clips retain the authored joints; no existing game IP is imported.
  const animalPlan=[
    {name:'Quaternius fox / lower-city pocket',file:'quaternius-fox.glb',position:[-207.0,.12,-361.6],yaw:-.70,scale:.22,clip:'Idle'},
    {name:'Quaternius shiba / upper garden',file:'quaternius-shiba-inu.glb',position:[320.4,8.05,279.4],yaw:1.10,scale:.20,clip:'Idle_2'},
  ];
  const ready=typeof document==='undefined'?Promise.resolve([]):Promise.allSettled(animalPlan.map(async plan=>{
    try{
      const gltf=await new GLTFLoader().loadAsync(new URL('./assets/characters/'+plan.file,import.meta.url).href),asset=gltf.scene;
      asset.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(asset),center=bounds.getCenter(new THREE.Vector3());
      asset.position.set(-center.x,-bounds.min.y,-center.z);
      const wrapper=new THREE.Group();wrapper.name=plan.name;wrapper.add(asset);wrapper.scale.setScalar(plan.scale);wrapper.position.set(...plan.position);wrapper.rotation.y=plan.yaw;group.add(wrapper);
      let triangles=0;asset.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;for(const material of Array.isArray(o.material)?o.material:[o.material]){material.roughness=.82;material.metalness=0;}});
      const mixer=new THREE.AnimationMixer(asset),clip=gltf.animations.find(a=>a.name===plan.clip)||gltf.animations.find(a=>a.name==='Idle');
      if(clip){mixer.clipAction(clip).play();stats.animatedAnimals++;}mixer.update(0);
      animals.push({wrapper,mixer});stats.animals++;stats.animalTriangles+=triangles;
      return{file:plan.file,triangles,clip:clip?.name};
    }catch(error){stats.animalAssetErrors.push(plan.file+': '+error.message);throw error;}
  }));
  stats.collisionProxies=colliders.length;
  let last=-1;
  return{group,lightAnchors,colliders,stats,ready,
    update(time,vehiclePosition){
      if(!Number.isFinite(time)||time===last)return;const elapsed=last<0?0:Math.min(.1,Math.max(0,time-last));last=time;const touched=new Set();
      for(const animal of animals){const p=animal.wrapper.position,distance=vehiclePosition?Math.hypot(p.x-vehiclePosition.x,p.z-vehiclePosition.z):0;animal.wrapper.visible=distance<160;if(distance<90)animal.mixer.update(elapsed);}
      for(const p of people){
        const world=p.world,distance=vehiclePosition?Math.hypot(world[0]-vehiclePosition.x,world[2]-vehiclePosition.z):0;if(distance>95)continue;
        let active=p.walking&&distance>2.8,walk=p.walk??0;
        if(active){const target=.7*(1+Math.sin(time*p.speed+p.phase)),step=elapsed*p.speed*.7;walk+=Math.max(-step,Math.min(step,target-walk));const next=p.f.point(p.u+walk,0,p.v);for(const neighbour of people){if(neighbour===p||neighbour.walking)continue;const other=neighbour.world;if(Math.abs(next[1]-other[1])<.4&&Math.hypot(next[0]-other[0],next[2]-other[2])<.58){walk=p.walk??0;active=false;break;}}}
        p.walk=walk;const pose=residentPose(p,time,active);
        for(const part of p.parts){
          part.item.batch.mesh.setMatrixAt(part.item.index,placeResidentPart(p,part,pose,walk));touched.add(part.item.batch.mesh);
        }
      }
      touched.forEach(mesh=>mesh.instanceMatrix.needsUpdate=true);
    },
    dispose(){group.removeFromParent();for(const animal of animals){animal.mixer.stopAllAction();animal.wrapper.traverse(o=>{if(!o.isMesh)return;o.geometry?.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])material?.dispose();});}materials.forEach(o=>o.dispose());textures.forEach(o=>o.dispose());geometries.forEach(o=>o.dispose());}
  };
}
