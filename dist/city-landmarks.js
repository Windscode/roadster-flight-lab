import {CITY_STREET_TREES} from './city-plan.js';
import {createCityVisibility} from './city-render-budget.js';
// Original, metre-scale destinations. This module is also imported by the
// headless physics runner: authoring data below never touches THREE or the DOM.
export const LANDMARK_RESERVATIONS = [
  {id:'botanical',minX:-570,maxX:-310,minZ:160,maxZ:390},
  {id:'waterfront',minX:-570,maxX:-310,minZ:-590,maxZ:-430},
  {id:'sculpture',minX:-85,maxX:85,minZ:150,maxZ:290},
];
export const LANDMARK_LOCATIONS = [
  {id:'garden',label:'穹顶植物园',subtitle:'曲面温室 · 林荫环路 · 树冠栈道',position:[-400,.62,174],yaw:-.50},
  {id:'waterfront',label:'南岸水庭',subtitle:'城市运河 · 工业遗构 · 滨水长廊',position:[-430,.62,-424],yaw:Math.PI},
  {id:'sculpture',label:'潮汐广场',subtitle:'双螺旋雕塑 · 水景 · 露天剧场',position:[-52,.62,166]},
];
export const LANDMARK_WATER_VOLUMES = [
  {id:'botanical-water',minX:-418,maxX:-386,minZ:247,maxZ:343,surfaceY:.72,bottomY:.02},
  {id:'south-canal',minX:-536,maxX:-332,minZ:-573,maxZ:-481,surfaceY:1.35,bottomY:.02},
  {id:'sculpture-water',minX:-26,maxX:26,minZ:204,maxZ:244,surfaceY:.72,bottomY:.02},
];
const solids=[],decor=[],trees=[],shrubPatches=[],surfaces=[],tubes=[],signs=[],waterfalls=[],boats=[],cafes=[];
function solid(id,size,position,material='limestone',rotation=[0,0,0],extra={}){
  const g={id:'landmark-'+id,kind:'landmark',size,position,rotation,data:{material,...extra}};solids.push(g);return g;
}
const box=(id,size,position,material='steel',rotation=[0,0,0])=>decor.push({id,size,position,material,rotation});
const ground=(id,w,d,x,z,material='paving',y=.025,rotation=0)=>surfaces.push({id,w,d,x,z,material,y,rotation});
const tube=(points,radius=.1,material='steel',segments=32)=>tubes.push({points,radius,material,segments});
const label=(text,x,y,z,w=14,h=2.2,rotation=0)=>signs.push({text,x,y,z,w,h,rotation});
let randomState=718391;
const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
const tree=(x,z,height=9,spread=5,y=0)=>trees.push({x,z,height,spread,y,seed:random()});
const shrubs=(x,z,w,d,count=22,y=.05)=>shrubPatches.push({x,z,w,d,count,y});
function pool(id,minX,maxX,minZ,maxZ,surfaceY){
  const h=surfaceY+.35,cx=(minX+maxX)/2,cz=(minZ+maxZ)/2,w=maxX-minX,d=maxZ-minZ;
  solid(id+'-west',[.8,h,d+1.6],[minX-.4,h/2,cz],'poolRim');
  solid(id+'-east',[.8,h,d+1.6],[maxX+.4,h/2,cz],'poolRim');
  solid(id+'-north',[w,h,.8],[cx,h/2,minZ-.4],'poolRim');
  solid(id+'-south',[w,h,.8],[cx,h/2,maxZ+.4],'poolRim');
  ground(id+'-bottom',w,d,cx,cz,'basin',.016);
}
function bench(id,x,z,ry=0){
  solid(id+'-seat',[2.8,.12,.72],[x,.55,z],'timber',[0,ry,0]);
  // Feet and backrest are visual details; seat is the continuous collision.
  const dx=Math.cos(ry),dz=-Math.sin(ry),bx=Math.sin(ry),bz=Math.cos(ry);
  for(const side of [-1,1])box(id+'-foot',[.14,.49,.66],[x+side*1.1*dx,.245,z+side*1.1*dz],'steel',[0,ry,0]);
  box(id+'-back',[2.8,.48,.1],[x+bx*.30,.96,z+bz*.30],'timber',[0,ry,0]);
}
function planter(id,x,z,w,d){
  solid(id,[w,.44,d],[x,.22,z],'limestone');
  ground(id+'-soil',w-.34,d-.34,x,z,'soil',.449);shrubs(x,z,w-.6,d-.6,Math.max(6,Math.round(w*d*.24)),.45);
}
function rail(id,a,b,height=1.1,baseY=0){
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]),yaw=Math.atan2(b[0]-a[0],b[1]-a[1]),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
  solid(id+'-barrier',[.07,height,length],[x,baseY+height/2,z],'steel',[0,yaw,0],{hidden:true,structure:'pedestrian railing'});
  tube([[a[0],baseY+height,a[1]],[b[0],baseY+height,b[1]]],.045,'steel',2);
  for(let s=0;s<=length;s+=1.8){const t=Math.min(1,s/length);box(id+'-post',[.045,height,.045],[a[0]+(b[0]-a[0])*t,baseY+height/2,a[1]+(b[1]-a[1])*t]);}
  tube([[a[0],baseY+.5,a[1]],[b[0],baseY+.5,b[1]]],.016,'steel',2);
}
function deckSegment(id,a,b,width,thickness=.28,material='timber'){
  const dx=b[0]-a[0],dz=b[2]-a[2],dy=b[1]-a[1],h=Math.hypot(dx,dz),len=Math.hypot(h,dy),yaw=Math.atan2(dx,dz),pitch=-Math.atan2(dy,h);
  // Same XYZ Euler convention as city-data routeSlab; a/b are TOP centres.
  const sp=Math.sin(pitch),cp=Math.cos(pitch),sy=Math.sin(yaw),cy=Math.cos(yaw),normal=[sy*sp,cp,cy*sp];
  return solid(id,[width,thickness,len+.015],a.map((v,k)=>(v+b[k])/2-normal[k]*thickness/2),material,[Math.atan2(sp,cy*cp),Math.asin(Math.max(-1,Math.min(1,sy*cp))),Math.atan2(-sy*sp,cy)]);
}

// BOTANICAL GARDEN: a drive-through loop encloses a real ribbed glasshouse,
// planted soil beds, a separate water garden and a walkable 4.8 m canopy path.
ground('garden-landscape',252,224,-440,275,'lawn');
ground('garden-water-promenade',56,118,-402,297,'paving',.05);
ground('garden-west-lawn',48,174,-536,276,'lawn',.035);
ground('garden-east-lawn',38,178,-342,275,'lawn',.035);
ground('garden-central-lawn',44,78,-454,286,'lawn',.035);
for(const x of [-536,-342])for(const z of [234,322])ground('garden-gravel-path',x===-536?47:37,2,x,z,'gravel',.043);
for(const z of [190,368])ground('garden-cross-drive',238,12,-440,z,'asphalt',.045);
for(const x of [-560,-428,-324])ground('garden-drive',12,184,x,277,'asphalt',.046);
ground('garden-entry-drive',12,43,-414,175,'asphalt',.049,-.75);
// Main entrance is open: no decorative invisible gate across the vehicle lane.
for(const x of [-416,-384])solid('garden-entry-pier-'+x,[1.6,7,1.8],[x,3.5,174],'limestone');
box('garden-entry-beam',[34,.7,1.7],[-400,7.05,174],'copper');
label('穹 顶 植 物 园   /   BOTANICAL GARDENS',-400,5.7,173.12,27,1.3,Math.PI);
for(const z of [207,232,258,284,311,339,360])for(const x of [-547,-334])tree(x+(random()-.5)*4,z,8+random()*6,4+random()*2);
for(let i=0;i<11;i++)tree(-459+(random()-.5)*24,250+i*8,8+random()*8,4+random()*2);
for(const z of [213,352])for(const x of [-512,-477,-380,-354])tree(x,z,7+random()*4,4.5);
for(const [x,z,w,d] of [[-535,222,28,28],[-537,315,29,38],[-346,242,22,48],[-346,330,23,48],[-458,286,29,58]])shrubs(x,z,w,d,55);
for(const z of [212,235,263,291,320,345])for(const x of [-425,-374])bench('garden-bench-'+x+'-'+z,x,z,Math.PI/2);
pool('garden-pool',-418,-386,247,343,.72);
// Stone stepping platforms are deliberately interrupted; the water has no
// colliding plane and cannot silently behave like a road.
for(let i=0;i<5;i++)solid('garden-water-island-'+i,[4,.82,4],[-402,.41,257+i*18],'limestone');
for(const x of [-417.8,-386.2])for(let z=252;z<341;z+=5.5){box('garden-reed-soil',[.55,.13,3],[x,.17,z],'soil');shrubs(x,z,.5,2.5,4,.20);}
// Barrel-vault conservatory: 44 x 82 m; the 24 thin collider facets follow
// the visible curved roof, rather than using a solid enclosing box.
const gx=-493,gz=278,gr=22,gl=82;
for(const side of [-1,1])for(let k=0;k<11;k++)solid('glasshouse-column-'+side+'-'+k,[.30,3,.30],[gx+side*gr,1.5,gz-gl/2+k*gl/10],'copper');
for(let i=0;i<24;i++){
  const a=i*Math.PI/24,b=(i+1)*Math.PI/24,ax=gx+gr*Math.cos(a),ay=3+gr*Math.sin(a),bx=gx+gr*Math.cos(b),by=3+gr*Math.sin(b);
  solid('glasshouse-glass-'+i,[Math.hypot(bx-ax,by-ay),.15,gl],[(ax+bx)/2,(ay+by)/2,gz],'glass',[0,0,Math.atan2(by-ay,bx-ax)],{hidden:true,structure:'curved glazing'});
}
for(let k=0;k<11;k++){const pts=[];for(let j=0;j<=32;j++){const a=j*Math.PI/32;pts.push([gx+gr*Math.cos(a),3+gr*Math.sin(a),gz-gl/2+k*gl/10]);}tube(pts,.12,'copper',64);}
for(let i=0;i<=8;i++){const a=i*Math.PI/8;tube([[gx+gr*Math.cos(a),3+gr*Math.sin(a),gz-gl/2],[gx+gr*Math.cos(a),3+gr*Math.sin(a),gz+gl/2]],.075,'copper',2);}
ground('glasshouse-floor',43,81,gx,gz,'paving',.055);
for(const x of [gx-15,gx+15])for(const z of [250,278,305]){planter('glasshouse-bed-'+x+'-'+z,x,z,9,15);tree(x,z,10+random()*5,5,.45);}
label('BIO / 03   CONSERVATORY',gx,5.4,gz-gl/2-.1,24,1.8,Math.PI);
// Gently bending elevated timber path, reachable by physical 0.16 m steps.
const skywalk=[[-424,4.8,224],[-423,4.8,248],[-430,4.8,275],[-424,4.8,306],[-420,4.8,339]];
for(let i=0;i<skywalk.length-1;i++){
  const a=skywalk[i],b=skywalk[i+1];deckSegment('garden-skywalk-'+i,a,b,4.5);
  const dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz),rx=dz/l*2.2,rz=-dx/l*2.2;
  for(const s of [-1,1])rail('garden-skywalk-rail-'+i+'-'+s,[a[0]+rx*s,a[2]+rz*s],[b[0]+rx*s,b[2]+rz*s],1.1,4.8);
  solid('garden-skywalk-pier-'+i,[.65,4.52,.65],[a[0],2.26,a[2]],'copper');
}
for(let k=0;k<30;k++)solid('garden-stair-'+k,[.4,.16*(k+1),4.4],[-410.2-k*.4,.08*(k+1),224],'timber');
// Low berms are rendered inside the planting beds. Their complete bases are
// bordered by low planters; no hidden hill is placed across a drivable loop.
for(const z of [216,350])planter('garden-corner-'+z,-363,z,15,16);

// SOUTH CANAL: an accessible quayside around a contained 1.35 m deep urban
// reservoir, with a retained pump crane, floating pontoons and fabric sails.
ground('quay-paving',252,154,-440,-511,'paving');
pool('canal',-536,-332,-573,-481,1.35);
for(const [z,tag] of [[-474,'north'],[-580,'south']])solid('quay-'+tag,[222,1.6,12],[-434,.8,z],'limestone');
for(const [x,tag] of [[-546,'west'],[-322,'east']])solid('quay-'+tag,[11,1.6,114],[x,.8,-527],'limestone');
// Quay coping is only 0.1 m above its raised deck. A real 1.1 m handrail is
// therefore necessary here; an apparent water boundary must stop the car.
for(const [i,a,b] of [[0,[-536,-480.6],[-501,-480.6]],[1,[-497,-480.6],[-413,-480.6]],[2,[-409,-480.6],[-332,-480.6]],[3,[-536.4,-481],[-536.4,-573]],[4,[-331.6,-481],[-331.6,-573]],[5,[-536,-573.4],[-332,-573.4]]])rail('quay-water-rail-'+i,a,b,1.1,1.7);
deckSegment('quay-access-ramp',[-430,0,-431],[-430,1.6,-468],12,.30,'limestone');
// South Quay arrival: one low, open canopy ties the arterial to the existing
// 12 m ramp and the retained pump crane. Every solid has the same authoring
// record in rendering, collision and the rebaked daylight/night occluders.
const entrySolid=(id,size,position,material)=>solid('quay-entry-'+id,size,position,material,[0,0,0],{project:'south-quay-entry-3.13'});
for(const side of [-1,1]){
  entrySolid('pier-'+side,[.60,6.40,1.0],[-430+side*9.6,3.20,-438],'steel');
  entrySolid('seat-plinth-'+side,[1.4,.64,4.6],[-430+side*11,.32,-438.8],'limestone');
  box('quay-entry-seat-cap-'+side,[1.38,.055,4.55],[-430+side*11,.6675,-438.8],'timber');
  // Recessed coffer: small ribs remain within the roof envelope, never across
  // the vehicle clearance. This is structure and drainage detail, not signage.
  for(let i=0;i<5;i++)box('quay-entry-roof-rib-'+side+'-'+i,[.09,.22,5.9],[-430+side*(1.8+i*1.7),6.25,-438],'copper');
}
entrySolid('crossbeam',[20.4,.60,1.0],[-430,6.10,-438],'steel');
entrySolid('roof',[20.6,.16,6.8],[-430,6.48,-438],'copper');
entrySolid('front-fascia',[20.6,.52,.16],[-430,6.14,-434.58],'steel');
entrySolid('wayfinding-fin',[1.20,8.60,.65],[-443,4.30,-433],'limestone');
box('quay-entry-fin-inlay',[.24,7.1,.025],[-443,4.5,-432.66],'copper');
box('quay-entry-drain-west',[.12,.10,6.2],[-440.10,6.35,-438],'steel');
box('quay-entry-drain-east',[.12,.10,6.2],[-419.90,6.35,-438],'steel');
label('SOUTH QUAY / 到达入口',-430,6.12,-434.489,17.8,.42,0);
label('03',-443,6.85,-432.669,.85,1.05,0);
// Two visible, directed fixtures share the existing global light pool. Their
// actual anchors also enter the static direct/bounce bake outside the live pool.
export const SOUTH_QUAY_ENTRY_LIGHTS=[-1,1].map(side=>({
  id:'quay-entry-downlight-'+side,position:[-430+side*7.3,5.77,-436.7],target:[-430+side*3.5,.25,-430.5],
  color:0xf0d4af,intensity:430,range:22,angle:.82,practical:true,role:'soffit',lensSize:[1.15,.045,.27]
}));

// The approach sides are explicit rather than hidden stairs under a ramp.
for(const side of [-1,1]){
  const x=-430+side*5.9,a=[x,.043,-432],b=[x,1.47,-465];
  const proxy=deckSegment('quay-approach-'+side,a.map((n,k)=>k===1?n+.9:n),b.map((n,k)=>k===1?n+.9:n),.07,.9,'steel');proxy.data.hidden=true;proxy.data.structure='sloping railing';
  for(const h of [.45,.9])tube([[x,a[1]+h,a[2]],[x,b[1]+h,b[2]]],.038,'steel',2);
  for(let k=0;k<=8;k++){const t=k/8;box('quay-approach-post',[.05,.9,.05],[x,a[1]+(b[1]-a[1])*t+.45,a[2]+(b[2]-a[2])*t],'steel');}
}
for(const x of [-499,-411]){
  solid('pontoon-stem-'+x,[3,.35,25.5],[x,1.375,-492.9],'timber');
  solid('pontoon-float-'+x,[21,.35,4],[x,1.375,-505.5],'timber');
  for(const z of [-486,-500])solid('pontoon-pile-'+x+'-'+z,[.32,2.8,.32],[x-2,1.4,z],'steel');
  // A bollard closes each narrow pedestrian approach to road traffic.
  solid('pontoon-bollard-'+x,[.4,.85,.4],[x,1.775,-482.2],'steel');
  boats.push({x,z:-511.5,yaw:Math.PI/2,length:14,width:3.6});
  solid('electric-launch-'+x,[3.0,1.1,12],[x,1.5,-511.5],'steel',[0,Math.PI/2,0],{hidden:true,structure:'moored boat hull'});
}
for(const z of [-469,-580])for(let x=-530;x<-340;x+=16){
  if(z===-469&&Math.abs(x+430)<8)continue; // full 12 m ramp approach stays open
  bench('quay-bench-'+x+'-'+z,x,z,z===-469?0:Math.PI);
  if((x+530)%32===0){planter('quay-pot-'+x+'-'+z,x+5,z,2.6,3);tree(x+5,z,6+random()*4,3.8,.44);}
}
for(let k=0;k<3;k++){
  const x=-495+k*63;
  for(const dx of [-14,14])solid('sail-pole-'+k+'-'+dx,[.2,9,.2],[x+dx,6.1,-472],'steel');
  solid('sail-anchor-'+k,[.2,7.1,.2],[x,5.15,-464],'steel');
}
label('南 岸 水 庭    /    SOUTH QUAY',-430,4.1,-465,24,1.5,0);
solid('pump-station',[14,7,10],[-553,3.5,-450],'concrete');
box('pump-station-roof',[15,.35,11],[-553,7.2,-450],'copper');
for(let i=0;i<4;i++)box('pump-vent',[.8,1.1,.16],[-558+i*2.3,4.4,-444.91],'steel');
for(const side of [-1,1])solid('crane-leg-'+side,[1.1,18,1.3],[-523+side*4,10.6,-472],'ochre');
solid('crane-top',[12,1.3,2.4],[-523,20.25,-472],'ochre');
solid('crane-boom',[1.2,1.6,30],[-523,21,-485],'ochre',[.12,0,0]);
tube([[-523,21,-499],[-523,4.5,-499]],.035,'steel',2);
for(const x of [-527,-519])tube([[x,1.7,-472],[-523,19.6,-472]],.10,'steel',2);
box('crane-hook',[.5,.7,.5],[-523,4.2,-499],'steel');
for(let i=0;i<5;i++){box('pump-pipe',[1,1,4],[-554+i*1.5,2.3,-457],'steel');tube([[-554+i*1.5,2.3,-457],[-554+i*1.5,3.8,-462],[-550+i*1.5,3.8,-467]],.36,'copper',20);}
for(const x of [-558,-311])for(const z of [-446,-464,-490,-516,-542,-570])tree(x,z,7+random()*3,3.8);

// TIDAL PLAZA: a vehicle-accessible loop frames a 24 m polished twin helix,
// reflecting basin, small amphitheatre, planted seating and shade pergolas.
ground('arts-paving',160,134,0,220,'paving');
for(const x of [-52,52])ground('arts-drive',12,130,x,220,'asphalt',.047);
for(const z of [163,279])ground('arts-drive-cross',116,12,0,z,'asphalt',.047);
pool('arts-pool',-26,26,204,244,.72);
solid('arts-monument-base',[13,1.7,13],[0,.85,224],'limestone');
// A ray of tilted water falling off the west lip adds movement without an
// opaque white cylinder masquerading as water.
waterfalls.push({x:-26.43,y:.8,z:223,w:.035,h:.75,d:13});
function helixPoint(t,side){const a=t*Math.PI*2.0+side*Math.PI;return [Math.cos(a)*6.5,1.7+t*24,224+Math.sin(a)*6.5];}
for(const side of [0,1]){
  const pts=[];for(let i=0;i<=120;i++)pts.push(helixPoint(i/120,side));tube(pts,.78,'sculpture',160);
  for(let i=0;i<32;i++){
    const a=helixPoint(i/32,side),b=helixPoint((i+1)/32,side),v=b.map((n,k)=>n-a[k]),len=Math.hypot(...v);
    solid('helix-'+side+'-'+i,[1.56,len+.025,1.56],a.map((n,k)=>(n+b[k])/2),'sculpture',[Math.atan2(v[2],v[1]),0,Math.atan2(-v[0],Math.hypot(v[1],v[2]))],{hidden:true,structure:'sculpture surface'});
  }
}
for(const x of [-70,70])for(const z of [179,206,235,263]){planter('arts-planter-'+x+'-'+z,x,z,9,10);tree(x,z,10+random()*3,5.3,.44);}
for(const x of [-36,36])for(const z of [183,260])bench('arts-bench-'+x+'-'+z,x,z,z===183?0:Math.PI);
for(const x of [-36,36])for(const z of [212,241]){
  cafes.push({x,z});
  solid('cafe-table-'+x+'-'+z,[1.45,.12,1.45],[x,.82,z],'timber',[0,0,0],{hidden:true,structure:'table'});
  solid('cafe-parasol-'+x+'-'+z,[.09,3.3,.09],[x,1.65,z],'steel');
  for(const side of [-1,1])for(const axis of [0,1]){
    const cx=x+(axis===0?side*1.75:0),cz=z+(axis===1?side*1.75:0);solid('cafe-seat-'+x+'-'+z+'-'+axis+'-'+side,[.52,.10,.52],[cx,.49,cz],'timber');
    for(const dx of [-.20,.20])for(const dz of [-.20,.20])box('cafe-chair-foot',[.035,.44,.035],[cx+dx,.22,cz+dz],'steel');
    box('cafe-chair-back',axis===0?[.05,.42,.52]:[.52,.42,.05],[cx+(axis===0?side*.23:0),.76,cz+(axis===1?side*.23:0)],'timber');
  }
}
for(const x of [-40,40]){
  for(let k=0;k<8;k++)box('pergola-fin',[.18,.35,17],[x-6+k*1.7,4.7,183],'timber');
  for(const dx of [-6,6])for(const dz of [-7,7])solid('pergola-post-'+x+'-'+dx+'-'+dz,[.23,4.5,.23],[x+dx,2.25,183+dz],'steel');
}
// The theatre's seating consists of 3 real semicircular terraces. Sixteen
// contact wedges per tier approximate the curved visible steps at 2 m scale.
const theatre={x:36,z:260};
for(let tier=0;tier<3;tier++)for(let k=0;k<16;k++){
  const a=(k+.5)*Math.PI/16,r=9+tier*2.4,h=.32*(tier+1),length=2*r*Math.sin(Math.PI/32)+.06;
  solid('theatre-seat-'+tier+'-'+k,[2.4,h,length],[theatre.x+Math.cos(a)*r,h/2,theatre.z+Math.sin(a)*r],'limestone',[0,-a,0]);
}
ground('theatre-stage',16,9,theatre.x,theatre.z-2,'timber',.06);
label('潮 汐   /   T I D A L',-2,3.1,193,20,1.4,Math.PI);
// Composed civic street trees use the existing leaf/branch asset kit.
for(const t of CITY_STREET_TREES)tree(t.x,t.z,t.height,t.spread,t.y);
// Tree trunks are the only vegetation collision proxies. Every proxy fits
// inside the visible trunk at vehicle height; distant branches remain visual.
trees.forEach((t,i)=>solid('tree-'+i,[.45,t.height*.46,.45],[t.x,t.y+t.height*.23,t.z],'bark',[0,0,0],{hidden:true,structure:'tree trunk'}));

export const LANDMARK_COLLIDERS=solids;
export const SOUTH_QUAY_ENTRY_SOLIDS=solids.filter(g=>g.data.project==='south-quay-entry-3.13');

export function buildCityLandmarks(THREE,root,roadMaterial=null){
  const group=new THREE.Group();group.name='Destinations / botanical · south quay · tidal plaza';root.add(group);
  const assetBase=new URL('./assets/landmarks/',import.meta.url).href;
  const textureLoader=new THREE.TextureLoader(),tmp=new THREE.Object3D(),buckets=new Map(),vegetationLods=[],unitBox=new THREE.BoxGeometry(),unitCylinder=new THREE.CylinderGeometry(.60,1,1,12,1),windUniform={value:0},visibility=createCityVisibility(THREE);
  const spatialKey=(x,z)=>Math.floor(x/120)+','+Math.floor(z/120);
  const textures=[],textureTasks=[];
  function texture(path,srgb=false){let finish;textureTasks.push(new Promise(resolve=>finish=resolve));const t=typeof document==='undefined'?new THREE.Texture():textureLoader.load(new URL(path,assetBase).href,()=>finish(true),undefined,()=>finish(false));if(typeof document==='undefined')finish(false);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.anisotropy=4;textures.push(t);return t;}
  const soilMap=texture('forest_leaves_02/textures/forest_leaves_02_diffuse_1k.jpg',true),soilNormal=texture('forest_leaves_02/textures/forest_leaves_02_nor_gl_1k.jpg'),soilRough=texture('forest_leaves_02/textures/forest_leaves_02_rough_1k.jpg');
  const grassMap=texture('leafy_grass/textures/leafy_grass_diff_1k.jpg',true),grassNormal=texture('leafy_grass/textures/leafy_grass_nor_gl_1k.jpg'),gravelMap=texture('grass_path_2/textures/grass_path_2_diff_1k.jpg',true),gravelNormal=texture('grass_path_2/textures/grass_path_2_nor_gl_1k.jpg'),gravelRough=texture('grass_path_2/textures/grass_path_2_rough_1k.jpg');
  const leafMap=texture('island_tree_03/textures/island_tree_03_leaves_diff_1k.jpg',true),leafArm=texture('island_tree_03/textures/island_tree_03_leaves_arm_1k.jpg');
  const pavingNormal=texture('../concrete-normal.jpg'),pavingRough=texture('../concrete-roughness.jpg');
  for(const t of [soilMap,soilNormal,soilRough,grassMap,grassNormal,gravelMap,gravelNormal,gravelRough,pavingNormal,pavingRough]){t.wrapS=t.wrapT=THREE.RepeatWrapping;}
  const mats={
    limestone:new THREE.MeshStandardMaterial({color:0xb7b4a5,roughness:.79}),
    entryLens:new THREE.MeshStandardMaterial({color:0xf2dfbc,roughness:.62,metalness:0,emissive:0xf2d7ad,emissiveIntensity:1.25}),
    poolRim:new THREE.MeshStandardMaterial({color:0x9a9e94,roughness:.57}),
    paving:new THREE.MeshStandardMaterial({color:0x999d95,normalMap:pavingNormal,normalScale:new THREE.Vector2(.17,.17),roughnessMap:pavingRough,roughness:.86}),
    concrete:new THREE.MeshStandardMaterial({color:0x848880,roughness:.87}),
    basin:new THREE.MeshStandardMaterial({color:0x345450,roughness:.78}),
    asphalt:new THREE.MeshStandardMaterial({color:0x3f4440,roughness:.89}),
    timber:new THREE.MeshStandardMaterial({color:0x826348,roughness:.78}),
    copper:new THREE.MeshStandardMaterial({color:0x747b68,metalness:.68,roughness:.41}),
    ochre:new THREE.MeshStandardMaterial({color:0xa59054,metalness:.4,roughness:.55}),
    steel:new THREE.MeshStandardMaterial({color:0x67726e,metalness:.76,roughness:.38}),
    sculpture:new THREE.MeshPhysicalMaterial({color:0xb2bbb7,metalness:1,roughness:.15,clearcoat:.65,clearcoatRoughness:.14}),
    glass:new THREE.MeshPhysicalMaterial({color:0xb4d0cb,metalness:.12,roughness:.17,transparent:true,opacity:.22,depthWrite:false,side:THREE.DoubleSide,clearcoat:1,ior:1.48}),
    soil:new THREE.MeshStandardMaterial({map:soilMap,normalMap:soilNormal,normalScale:new THREE.Vector2(.4,.4),roughnessMap:soilRough,roughness:.96,color:0xc3c9b1}),
    lawn:new THREE.MeshStandardMaterial({map:grassMap,normalMap:grassNormal,normalScale:new THREE.Vector2(.32,.32),roughness:.98,color:0xb3c9a0}),
    gravel:new THREE.MeshStandardMaterial({map:gravelMap,normalMap:gravelNormal,normalScale:new THREE.Vector2(.35,.35),roughnessMap:gravelRough,roughness:.98}),
    bark:new THREE.MeshStandardMaterial({color:0x635f4c,roughness:.99}),
    foliage:new THREE.MeshStandardMaterial({map:leafMap,roughnessMap:leafArm,roughness:.8,side:THREE.DoubleSide,alphaTest:.2,color:0xc9d7a9}),
  };
  function worldUv(shader){shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
    vec4 soilPosition=vec4(position,1.);
    #ifdef USE_INSTANCING
    soilPosition=instanceMatrix*soilPosition;
    #endif
    vec2 metreUv=(modelMatrix*soilPosition).xz*.5;
    #ifdef USE_MAP
    vMapUv=metreUv;
    #endif
    #ifdef USE_NORMALMAP
    vNormalMapUv=metreUv;
    #endif
    #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv=metreUv;
    #endif`);}
  for(const key of ['soil','lawn','gravel']){const material=mats[key];material.onBeforeCompile=worldUv;material.customProgramCacheKey=()=>key+'|landmark-world-uv-v1';}
  for(const [key,mat] of Object.entries(mats))mat.name='Landmark / '+key;
  // World-space grain avoids stretched UVs on metre-scale instanced blocks.
  for(const key of ['limestone','paving','concrete','timber','bark','asphalt']){
    const mat=mats[key];mat.onBeforeCompile=shader=>{
      if(key==='paving')worldUv(shader);
      shader.vertexShader='varying vec3 landmarkWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec4 lmp=vec4(position,1.);\n#ifdef USE_INSTANCING\nlmp=instanceMatrix*lmp;\n#endif\nlandmarkWorld=(modelMatrix*lmp).xyz;');
      shader.fragmentShader='varying vec3 landmarkWorld;float lmh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'+shader.fragmentShader;
      const wood=key==='timber'||key==='bark',paver=key==='paving';
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\nfloat lg=lmh(floor(landmarkWorld.xz*55.));float broad=lmh(floor(landmarkWorld.xz*.55));diffuseColor.rgb*=.90+.12*broad+.05*lg;${wood?'diffuseColor.rgb*=.84+.16*sin(landmarkWorld.y*19.+landmarkWorld.x*7.);':''}${paver?'vec2 joint=abs(fract(landmarkWorld.xz/1.2)-.5);float seam=max(smoothstep(.486,.496,joint.x),smoothstep(.486,.496,joint.y));diffuseColor.rgb*=1.-seam*.30;':''}`);
    };mat.customProgramCacheKey=()=>key+'|landmark-surface-v1';
  }
  // Use the city's scanned dry asphalt on the drive loop as well. Keeping one
  // shared material avoids an abrupt flat-colour road at a destination boundary.
  if(roadMaterial){mats.asphalt.dispose();mats.asphalt=roadMaterial;}
  const compileFoliage=shader=>{
    shader.uniforms.landmarkWind=windUniform;
    shader.vertexShader='uniform float landmarkWind;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat phase=instanceMatrix[3].x*.8+instanceMatrix[3].z*.6;transformed.x+=sin(landmarkWind*1.3+phase)*.035*uv.y;\n#endif');
    // The CC0 leaf atlas has a black exterior. Reject that exterior before
    // lighting, keeping genuine photographed leaf colour and silhouette.
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','float leafMask=max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b));diffuseColor.a*=smoothstep(.012,.035,leafMask);\n#include <alphatest_fragment>');
  };mats.foliage.onBeforeCompile=compileFoliage;mats.foliage.customProgramCacheKey=()=> 'landmark-leaf-atlas-v1';
  // Shadow maps must reject the same photographed black background as the
  // colour pass; otherwise individual leaves cast rectangular card shadows.
  const leafDepth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map:leafMap,alphaTest:.2,side:THREE.DoubleSide});leafDepth.onBeforeCompile=compileFoliage;leafDepth.customProgramCacheKey=()=> 'landmark-leaf-depth-v1';
  function instance(geo,mat,pos,scale,rotation=[0,0,0],color=null){
    const key=geo.uuid+mat.uuid+'|'+spatialKey(pos[0],pos[2]),a=buckets.get(key)||{geo,mat,items:[]};a.items.push({pos,scale,rotation,color});buckets.set(key,a);
  }
  for(const g of [...solids,...decor])if(!g.data?.hidden){instance(unitBox,mats[g.material||g.data.material],g.position,g.size,g.rotation);}
  for(const s of surfaces){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(s.w,s.d),mats[s.material]);mesh.rotation.set(-Math.PI/2,0,s.rotation);mesh.position.set(s.x,s.y,s.z);mesh.receiveShadow=true;mesh.name=s.id;group.add(mesh);}
  function beam(a,b,r1,r2,mat){const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),d=q.clone().sub(p),mid=p.clone().add(q).multiplyScalar(.5);tmp.position.copy(mid);tmp.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());tmp.scale.set(r1,d.length(),r2);tmp.updateMatrix();const key=unitCylinder.uuid+mat.uuid+'|'+spatialKey(mid.x,mid.z),v=buckets.get(key)||{geo:unitCylinder,mat,items:[]};v.items.push({matrix:tmp.matrix.clone()});buckets.set(key,v);}
  // Bent cards at leaf scale, not tree-sized billboard silhouettes.
  const leafGeo=new THREE.PlaneGeometry(.29,.69,1,3),leafPos=leafGeo.attributes.position,leafUv=leafGeo.attributes.uv;
  for(let i=0;i<leafPos.count;i++){const y=leafPos.getY(i);leafPos.setZ(i,.07*(1-Math.pow(y/.345,2)));leafUv.setXY(i,.014+leafUv.getX(i)*.146,.512+leafUv.getY(i)*.477);}leafGeo.computeVertexNormals();
  const leafColor=new THREE.Color();
  for(const t of trees){
    let n=(t.seed*0xffffffff)>>>0;const trand=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
    const top=t.y+t.height*.58;
    const trunk=[[t.x,t.y,t.z],[t.x+.19,top*.45+t.y*.55,t.z+.12],[t.x-.17,top,t.z-.12]];
    beam(trunk[0],trunk[1],.32,.31,mats.bark);beam(trunk[1],trunk[2],.27,.26,mats.bark);
    for(let branch=0;branch<8;branch++){
      const a=branch*Math.PI*.25+trand()*.4,r=t.spread*(.65+trand()*.35),origin=[t.x,top-(branch%3)*.55,t.z],fork=[t.x+Math.cos(a)*r*.57,t.y+t.height*(.67+trand()*.15),t.z+Math.sin(a)*r*.57],end=[t.x+Math.cos(a)*r,t.y+t.height*(.73+trand()*.24),t.z+Math.sin(a)*r];
      beam(origin,fork,.11,.10,mats.bark);beam(fork,end,.055,.05,mats.bark);
      for(let twig=0;twig<4;twig++){
        const f=.28+twig*.22,center=fork.map((v,k)=>v+(end[k]-v)*f),ta=a+(twig%2?-.8:.8),tip=[center[0]+Math.cos(ta)*1.3,center[1]+.6+trand()*.7,center[2]+Math.sin(ta)*1.3];beam(center,tip,.025,.024,mats.bark);
        for(let j=0;j<48;j++){
          const along=trand(),p=j<24?center.map((v,k)=>v+(tip[k]-v)*along):origin.map((v,k)=>v+(end[k]-v)*along);p[0]+=(trand()-.5)*2.5;p[1]+=(trand()-.5)*2.0;p[2]+=(trand()-.5)*2.5;
          leafColor.setRGB(.76+trand()*.24,.82+trand()*.18,.72+trand()*.21);const scale=.85+trand()*.85;
          instance(leafGeo,mats.foliage,p,[scale,scale,scale],[(trand()-.5)*1.5,trand()*Math.PI*2,(trand()-.5)*1.1],leafColor.clone());
        }
      }
    }
  }
  for(const t of tubes){const curve=new THREE.CatmullRomCurve3(t.points.map(p=>new THREE.Vector3(...p)),false,'centripetal'),mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,t.segments,t.radius,t.material==='sculpture'?12:6,false),mats[t.material]);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  // Actual barrel-vault surface. It has open ends and no floor-sized canopy
  // box obscuring the trees inside it.
  const gp=[],gu=[],gi=[],roofSegments=48,roofRuns=10;
  for(let j=0;j<=roofRuns;j++)for(let i=0;i<=roofSegments;i++){const a=i/roofSegments*Math.PI;gp.push(gx+gr*Math.cos(a),3+gr*Math.sin(a),gz-gl/2+j/roofRuns*gl);gu.push(i/roofSegments,j/roofRuns);if(i<roofSegments&&j<roofRuns){const k=j*(roofSegments+1)+i;gi.push(k,k+1,k+roofSegments+1,k+1,k+roofSegments+2,k+roofSegments+1);}}
  const roofGeo=new THREE.BufferGeometry();roofGeo.setAttribute('position',new THREE.Float32BufferAttribute(gp,3));roofGeo.setAttribute('uv',new THREE.Float32BufferAttribute(gu,2));roofGeo.setIndex(gi);roofGeo.computeVertexNormals();const roof=new THREE.Mesh(roofGeo,mats.glass);roof.name='open-ended curved conservatory glazing';roof.receiveShadow=false;group.add(roof);
  // Tensioned sails use curved, nonplanar fabric with stitched panel strips.
  const fabric=new THREE.MeshStandardMaterial({color:0xd9d3bf,roughness:.95,side:THREE.DoubleSide}),parasolFabric=new THREE.MeshStandardMaterial({color:0xab7857,roughness:.96,side:THREE.DoubleSide});
  const boatShell=new THREE.MeshPhysicalMaterial({color:0xbfc6be,roughness:.35,metalness:.25,clearcoat:.8}),boatGlass=new THREE.MeshPhysicalMaterial({color:0x466f75,metalness:.35,roughness:.16,transparent:true,opacity:.68});
  fabric.name='Landmark / tensioned sail fabric';parasolFabric.name='Landmark / cafe parasol fabric';
  boatShell.name='Landmark / moored launch hull';boatGlass.name='Landmark / moored launch glass';
  for(const b of boats){
    const vessel=new THREE.Group();vessel.position.set(b.x,1.05,b.z);vessel.rotation.y=b.yaw;vessel.name='moored electric water taxi';
    const positions=[],indices=[],sections=[[-7,1.2],[-5.3,1.65],[2.4,1.80],[5.5,1.25],[7,.08]];
    for(const [z,w] of sections)positions.push(-w,.52,z,w,.52,z,-w*.64,-.26,z,w*.64,-.26,z);
    for(let i=0;i<sections.length-1;i++){const a=i*4,c=(i+1)*4;indices.push(a,c,a+2,a+2,c,c+2,a+1,a+3,c+1,a+3,c+3,c+1,a+2,c+2,a+3,a+3,c+2,c+3,a,c+1,c,a,a+1,c+1);}
    indices.push(0,2,1,1,2,3,16,17,18,17,19,18);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();const hull=new THREE.Mesh(g,boatShell);hull.castShadow=true;hull.receiveShadow=true;vessel.add(hull);
    for(const [size,pos,mat] of [[[2.9,.15,8],[0,.65,-.3],mats.timber],[[2.65,.95,4.7],[0,1.23,-.8],boatGlass],[[3.0,.15,5.1],[0,1.80,-.8],mats.copper],[[1.8,.08,1.1],[0,1.92,-.9],mats.steel]]){const m=new THREE.Mesh(unitBox,mat);m.scale.set(...size);m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;vessel.add(m);}
    for(const side of [-1,1])for(const z of [-2.7,1.2]){const p=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1.25,6),mats.steel);p.position.set(side*1.3,1.17,z);vessel.add(p);}group.add(vessel);
  }
  for(const c of cafes){
    const table=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,.12,24),mats.timber);table.position.set(c.x,.82,c.z);table.castShadow=true;table.receiveShadow=true;group.add(table);
    const canopy=new THREE.Mesh(new THREE.ConeGeometry(3.4,.72,8,1,true),parasolFabric);canopy.position.set(c.x,3.18,c.z);canopy.castShadow=true;canopy.receiveShadow=true;group.add(canopy);
  }
  for(let k=0;k<3;k++){
    const x=-495+k*63,g=new THREE.PlaneGeometry(28,13,16,10),p=g.attributes.position;
    for(let i=0;i<p.count;i++){const px=p.getX(i),py=p.getY(i);p.setXYZ(i,px,7.6+.9*Math.pow(px/14,2)-1.4*Math.cos(px/28*Math.PI)*Math.cos(py/13*Math.PI),py);}
    g.computeVertexNormals();const sail=new THREE.Mesh(g,fabric);sail.position.set(x,1.6,-472);sail.castShadow=true;sail.receiveShadow=true;group.add(sail);
    for(const z of [-478.5,-465.5]){const curve=new THREE.CatmullRomCurve3([[x-14,9.1,z],[x,7.8,z],[x+14,9.1,z]].map(p=>new THREE.Vector3(...p)));const m=new THREE.Mesh(new THREE.TubeGeometry(curve,20,.035,5,false),mats.steel);m.castShadow=true;group.add(m);}
  }
  const waterUniforms=[];
  const waterMat=new THREE.MeshPhysicalMaterial({color:0x3c7069,roughness:.17,metalness:.22,clearcoat:1,clearcoatRoughness:.12,transparent:true,opacity:.91,envMapIntensity:1.7});
  waterMat.name='Landmark / canal and garden water';
  waterMat.onBeforeCompile=shader=>{
    const clock={value:0};waterUniforms.push(clock);shader.uniforms.waterTime=clock;
    shader.vertexShader='varying vec3 landmarkWaterWorld;varying vec2 landmarkWaterUv;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nlandmarkWaterWorld=(modelMatrix*vec4(position,1.)).xyz;landmarkWaterUv=uv;');
    shader.fragmentShader='uniform float waterTime;varying vec3 landmarkWaterWorld;varying vec2 landmarkWaterUv;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat ripple=sin(landmarkWaterWorld.x*1.1+waterTime*.7)*cos(landmarkWaterWorld.z*.81-waterTime*.45);float shore=min(min(landmarkWaterUv.x,1.-landmarkWaterUv.x),min(landmarkWaterUv.y,1.-landmarkWaterUv.y));diffuseColor.rgb*=.9+.06*ripple;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.29,.37,.31),.18*(1.-smoothstep(.002,.025,shore)));');
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nvec3 waveNormal=vec3(cos(landmarkWaterWorld.x*1.1+waterTime*.7)*.06,0.,sin(landmarkWaterWorld.z*.81-waterTime*.45)*.045);normal=normalize(normal+mat3(viewMatrix)*waveNormal);');
  };waterMat.customProgramCacheKey=()=> 'landmark-water-v1';
  for(const w of LANDMARK_WATER_VOLUMES){const m=new THREE.Mesh(new THREE.PlaneGeometry(w.maxX-w.minX,w.maxZ-w.minZ),waterMat);m.name=w.id+' / non-colliding water surface';m.rotation.x=-Math.PI/2;m.position.set((w.minX+w.maxX)/2,w.surfaceY,(w.minZ+w.maxZ)/2);m.receiveShadow=true;group.add(m);}
  const fallMat=new THREE.MeshPhysicalMaterial({color:0xc5e3d7,roughness:.15,transparent:true,opacity:.34,depthWrite:false,side:THREE.DoubleSide});
  fallMat.name='Landmark / falling water';
  for(const f of waterfalls){const mesh=new THREE.Mesh(new THREE.BoxGeometry(f.w,f.h,f.d),fallMat);mesh.position.set(f.x,f.y-f.h/2,f.z);group.add(mesh);}
  const lightAnchors=[];
  for(const anchor of SOUTH_QUAY_ENTRY_LIGHTS){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(...anchor.lensSize),mats.entryLens);mesh.name=anchor.id+' / actual luminaire';mesh.position.set(...anchor.position);mesh.castShadow=false;mesh.receiveShadow=true;group.add(mesh);
    lightAnchors.push({...anchor});
  }
  for(const s of signs){
    if(typeof document==='undefined')continue;
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=Math.max(128,Math.round(2048*s.h/s.w));const ctx=canvas.getContext('2d');ctx.fillStyle='#263832';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#d4d9c9';ctx.font=`500 ${Math.round(canvas.height*.52)}px Arial,Microsoft YaHei`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(s.text,canvas.width/2,canvas.height*.51,canvas.width*.94);ctx.fillStyle='#a89664';ctx.fillRect(canvas.width*.03,canvas.height*.85,canvas.width*.94,3);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;textures.push(map);const material=new THREE.MeshStandardMaterial({map,roughness:.76,metalness:.05});material.name='Landmark / wayfinding sign';const mesh=new THREE.Mesh(new THREE.PlaneGeometry(s.w,s.h),material);mesh.position.set(s.x,s.y,s.z);mesh.rotation.y=s.rotation;group.add(mesh);
  }
  for(const pos of [[-416,4,176],[-438,4,-462],[0,3,193],[-324,4,280],[-560,4,280],[-550,4,-530],[-322,4,-530]]){
    instance(unitBox,mats.steel,[pos[0],pos[1]/2,pos[2]],[.12,pos[1],.12]);lightAnchors.push({position:pos,color:0xffe4bc,intensity:240,range:18});
  }
  let drawCalls=0,leafInstances=0;
  for(const b of buckets.values()){
    // Interleave leaves from every tree in a cell. Reducing an instance count
    // then changes density consistently instead of deleting entire trees.
    if(b.mat===mats.foliage){for(const v of b.items){const p=v.pos;let h=(Math.imul(Math.round(p[0]*1024),73856093)^Math.imul(Math.round(p[1]*1024),19349663)^Math.imul(Math.round(p[2]*1024),83492791))>>>0;h=Math.imul(h^(h>>>16),0x45d9f3b)>>>0;v.priority=h;}b.items.sort((a,c)=>a.priority-c.priority);}
    const mesh=new THREE.InstancedMesh(b.geo,b.mat,b.items.length);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=b.mat===mats.foliage?'photographed individual leaf instances':'landscape structures / '+b.mat.name;
    b.items.forEach((v,i)=>{if(v.matrix)mesh.setMatrixAt(i,v.matrix);else{tmp.position.set(...v.pos);tmp.rotation.set(...v.rotation);tmp.scale.set(...v.scale);tmp.updateMatrix();mesh.setMatrixAt(i,tmp.matrix);}if(v.color)mesh.setColorAt(i,v.color);});
    if(b.mat===mats.foliage)mesh.customDepthMaterial=leafDepth;
    mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);drawCalls++;if(b.mat===mats.foliage){leafInstances+=b.items.length;vegetationLods.push({mesh,center:mesh.boundingSphere.center.clone(),radius:mesh.boundingSphere.radius,fullCount:mesh.count,kind:'leaf'});}
  }
  const bounds=new THREE.Box3(),dimensions=new THREE.Vector3();group.traverse(o=>{if(!o.isMesh)return;bounds.setFromObject(o).getSize(dimensions);const vegetation=o.material===mats.foliage;visibility.add(o,{level:vegetation?'vegetation':Math.max(dimensions.x,dimensions.z)>18||dimensions.y>9?'mass':'street',shadow:o.castShadow});});
  const stats={destinations:3,trees:trees.length,leafInstances,shrubs:0,colliders:solids.length,waterBodies:LANDMARK_WATER_VOLUMES.length,waterSurfaceM2:LANDMARK_WATER_VOLUMES.reduce((s,w)=>s+(w.maxX-w.minX)*(w.maxZ-w.minZ),0),instancedDrawCalls:drawCalls,botanicalVaultMetres:[44,25,82],assetLicense:'CC0 / Poly Haven',vegetationReady:false,renderBudget:visibility.stats};
  // The local shrub glTF has four unskinned, uncompressed mesh variants. Read
  // its explicit accessors, retaining original traced leaf geometry and UVs;
  // do not carry an 80 MB tree model into a freely explorable browser city.
  const ready=typeof document==='undefined'?Promise.resolve(false):(async()=>{
    const base=assetBase+'shrub_03/',[jsonResponse,bufferResponse]=await Promise.all([fetch(base+'shrub_03.gltf'),fetch(base+'shrub_03.bin')]);
    if(!jsonResponse.ok||!bufferResponse.ok)throw new Error('Local CC0 shrub asset missing');
    const [gltf,buffer]=await Promise.all([jsonResponse.json(),bufferResponse.arrayBuffer()]);
    const map=texture('shrub_03/textures/shrub_03_diff_1k.jpg',true),normal=texture('shrub_03/textures/shrub_03_nor_gl_1k.jpg'),arm=texture('shrub_03/textures/shrub_03_arm_1k.jpg');for(const t of [map,normal,arm])t.flipY=false;
    const material=new THREE.MeshStandardMaterial({map,normalMap:normal,normalScale:new THREE.Vector2(.4,.4),roughnessMap:arm,roughness:.9,metalness:0,side:THREE.DoubleSide});
    material.name='Landmark / photographed shrub foliage';
    function attribute(index){const a=gltf.accessors[index],view=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],Type={5126:Float32Array,5123:Uint16Array,5125:Uint32Array}[a.componentType];if(!Type||view.byteStride)throw new Error('Unsupported local shrub accessor');return new THREE.BufferAttribute(new Type(buffer,(view.byteOffset||0)+(a.byteOffset||0),a.count*size),size);}
    const variants=gltf.meshes.map(m=>{const p=m.primitives[0],g=new THREE.BufferGeometry();g.setAttribute('position',attribute(p.attributes.POSITION));g.setAttribute('normal',attribute(p.attributes.NORMAL));g.setAttribute('uv',attribute(p.attributes.TEXCOORD_0));g.setIndex(attribute(p.indices));return g;});
    const placements=variants.map(()=>[]);let n=593921;const r=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
    for(const p of shrubPatches)for(let i=0;i<p.count;i++){const height=1.3+r()*1.7;placements[i%variants.length].push({x:p.x+(r()-.5)*p.w,z:p.z+(r()-.5)*p.d,y:p.y,height,rotation:r()*Math.PI*2});}
    variants.forEach((g,i)=>{
      const cells=new Map();for(const p of placements[i]){const key=spatialKey(p.x,p.z),a=cells.get(key)||[];a.push(p);cells.set(key,a);}
      for(const [cell,plants]of cells){const mesh=new THREE.InstancedMesh(g,material,plants.length);mesh.name='CC0 photographed shrub variant '+i+' / '+cell;mesh.castShadow=true;mesh.receiveShadow=true;plants.forEach((p,k)=>{tmp.position.set(p.x,p.y,p.z);tmp.rotation.set(0,p.rotation,0);tmp.scale.setScalar(p.height);tmp.updateMatrix();mesh.setMatrixAt(k,tmp.matrix);});mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);stats.shrubs+=plants.length;stats.instancedDrawCalls++;vegetationLods.push({mesh,center:mesh.boundingSphere.center.clone(),radius:mesh.boundingSphere.radius,fullCount:mesh.count,kind:'shrub'});visibility.add(mesh,{level:'vegetation'});}
    });stats.vegetationReady=(await Promise.all(textureTasks)).every(Boolean);if(!stats.vegetationReady)throw new Error('A local landscape texture could not be loaded');return true;
  })().catch(error=>{stats.assetError=error.message;console.warn('Landscape shrub asset:',error.message);return false;});
  return {root:group,ready,stats,colliders:LANDMARK_COLLIDERS,lightAnchors,waterVolumes:LANDMARK_WATER_VOLUMES,
    setQuality(q,profile={}){visibility.setQuality(q,{...profile,massDistance:q==='balanced'?400:q==='high'?850:1400});textures.forEach(t=>t.anisotropy=q==='balanced'?2:8);},
    update(time,p){
      windUniform.value=time;waterUniforms.forEach(u=>u.value=time);if(!p)return;
      const profile=visibility.profile;let visible=0,shadow=0,activeLeaves=0;
      for(const v of vegetationLods){
        const edge=Math.max(0,Math.hypot(v.center.x-p.x,v.center.y-p.y,v.center.z-p.z)-v.radius);
        const nearDensity=profile.giMode==='vertex'?.48:profile.detailDistance<150?.78:1;
        const density=v.kind==='leaf'?nearDensity*(edge>profile.vegetationDistance*.55?.55:1):1;
        v.mesh.count=Math.max(1,Math.round(v.fullCount*density));
      }
      visibility.update(time,p);
      for(const v of vegetationLods){if(v.kind==='leaf'&&profile.giMode==='vertex')v.mesh.castShadow=false;if(v.mesh.visible){visible++;if(v.kind==='leaf')activeLeaves+=v.mesh.count;}if(v.mesh.visible&&v.mesh.castShadow)shadow++;}
      stats.activeVegetationCells=visible;stats.shadowVegetationCells=shadow;stats.activeLeafInstances=activeLeaves;
    },
    dispose(){group.removeFromParent();const seen=new Set();group.traverse(o=>{if(o.geometry&&!seen.has(o.geometry)){seen.add(o.geometry);o.geometry.dispose();}for(const m of Array.isArray(o.material)?o.material:[o.material])if(m&&m!==roadMaterial&&!seen.has(m)){seen.add(m);m.dispose();}});leafDepth.dispose();textures.forEach(t=>t.dispose());}
  };
}
