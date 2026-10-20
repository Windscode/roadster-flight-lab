import {createCityContinuity} from './city-continuity.js';
import {CITY_PLAN_SOLIDS,CITY_STREETS,buildingExtras,plannedDistrictAt} from './city-plan.js';
import {LANDMARK_RESERVATIONS,LANDMARK_LOCATIONS,LANDMARK_COLLIDERS} from './city-landmarks.js';
// Metres. Visible decks and tire contacts use the same authored surfaces.
export const CITY={extent:620,block:100,roadWidth:28,seed:58261};
const random=(()=>{let n=CITY.seed;return()=>{n=(1664525*n+1013904223)>>>0;return n/4294967296;};})();
const catmull=(a,b,c,d,t)=>b.map((v,k)=>.5*((2*v)+(-a[k]+c[k])*t+(2*a[k]-5*v+4*c[k]-d[k])*t*t+(-a[k]+3*v-3*c[k]+d[k])*t*t*t));
const hillControls=[[300,0,-430],[437,6,-330],[490,15,-150],[492,26,80],[588,29,300],[592,24,450],[480,8,420]],hillPoints=[];
for(let i=0;i<hillControls.length-1;i++)for(let k=0;k<18;k++)hillPoints.push(catmull(hillControls[Math.max(0,i-1)],hillControls[i],hillControls[i+1],hillControls[Math.min(hillControls.length-1,i+2)],k/18));
hillPoints.push(hillControls.at(-1));
export const CITY_ROUTES=[
  {id:'cross-city',name:'CROSS CITY / 环城高架',width:22,points:[[-550,0,-225],[-330,20,-225],[330,20,-225],[550,0,-225]]},
  {id:'east-ridge',name:'EAST RIDGE / 山脊环线',width:14,points:hillPoints},
  {id:'terrace-south',name:'UPPER CITY',width:18,points:[[400,0,40],[400,8,150]]},
  {id:'terrace-west',name:'UPPER CITY',width:16,points:[[180,0,300],[280,8,300]]},
];
const distanceSegment=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz)));return Math.hypot(x-a[0]-t*dx,z-a[2]-t*dz);};
const reserved=(x,z,r)=>CITY_ROUTES.some(route=>route.points.slice(1).some((p,i)=>distanceSegment(x,z,route.points[i],p)<route.width/2+r+3));
export const CITY_BUILDINGS=[];
function building(id,x,z,w,d,height,style=0,hero=false,baseY=0,extra={}){CITY_BUILDINGS.push({id,x,z,w,d,height,style,hero,baseY,...extra,accent:Math.floor(random()*4),seed:random(),tier:height>70});}
for(let ix=-6;ix<6;ix++)for(let iz=-6;iz<6;iz++){
  const x=ix*100+50,z=iz*100+50;
  if(Math.abs(x)<100&&Math.abs(z)<100)continue;
  if(x>-295&&x<-105&&z>-410&&z<-100)continue;
  if(x>270&&x<570&&z>130&&z<440)continue;
  const w=38+random()*20,d=38+random()*20;
  if(reserved(x,z,Math.hypot(w,d)*.5))continue;
  building(`block-${ix}-${iz}`,x,z,w,d,25+Math.pow(random(),1.3)*110,Math.floor(random()*5));
}
// Dense 5-12 storey frontage, a 14 m vehicle street and small service alleys.
for(const side of [-1,1])for(let k=0;k<5;k++){
  const z=-370+k*50;if(Math.abs(z+225)<30)continue;
  building(`market-front-${side}-${k}`,-200+side*29,z,38,42,21+random()*23,k%3,true);
  building(`market-back-${side}-${k}`,-200+side*77,z+8,34,37,45+random()*39,(k+2)%5,true);
}
for(const side of [-1,1])for(let k=0;k<4;k++)building(`market-gate-${side}-${k}`,-200+side*27,-102+k*34,33,28,20+random()*27,(k+1)%4,true);
building('arcology-west',-284,-450,45,64,122,3,false,0,{district:'weave'});
building('arcology-east',-75,-300,47,58,116,4,false,0,{district:'weave'});
building('arcology-spire',-65,-195,39,44,142,2,false,0,{district:'weave'});
for(const [index,x]of [365,435].entries())for(const [j,z]of [200,280,365].entries())building(`terrace-${x}-${z}`,index?444:356,z,44,46,[32,64,25,52,28,76][index*3+j],index?2:1,true,8,{archetype:'civic',district:'forum'});
for(const side of [-1,1])for(let k=0;k<6;k++){
  const x=100+side*27,z=160+k*57;
  if(!reserved(x,z,23))building(`industrial-${side}-${k}`,x,z,30,45,12+(k%3)*2.0,4,true,0,{archetype:'foundry',district:'foundry'});
}
// Clear complete footprints for the same visual and physical destination space.
for(let i=CITY_BUILDINGS.length-1;i>=0;i--){const b=CITY_BUILDINGS[i];if(LANDMARK_RESERVATIONS.some(r=>b.x+b.w/2+2.5>r.minX&&b.x-b.w/2-2.5<r.maxX&&b.z+b.d/2+2.5>r.minZ&&b.z-b.d/2-2.5<r.maxZ))CITY_BUILDINGS.splice(i,1);}
// Authored blocks own their parcels. Background grid buildings are removed
// when they overlap an authored frontage, the industrial back lane or a street
// reservation. This fixes the old hall/tower and rear-street/arcology overlaps.
const authored=CITY_BUILDINGS.filter(b=>!b.id.startsWith('block-'));
const overlapParcel=(a,b,pad=3)=>Math.abs(a.x-b.x)<(a.w+b.w)/2+pad&&Math.abs(a.z-b.z)<(a.d+b.d)/2+pad;
for(let i=CITY_BUILDINGS.length-1;i>=0;i--){const b=CITY_BUILDINGS[i];if(!b.id.startsWith('block-'))continue;
  const streetConflict=CITY_STREETS.some(street=>street.points[0][1]===0&&street.points.slice(1).some((point,j)=>distanceSegment(b.x,b.z,street.points[j],point)<street.width/2+Math.hypot(b.w,b.d)/2+3));
  if(authored.some(a=>overlapParcel(a,b))||streetConflict)CITY_BUILDINGS.splice(i,1);
}
// Shared storey-aligned massing. Every change in silhouette is a physical box
// used by both the renderer and contact/ray queries; no invisible full-height
// tower remains in the air above a visible setback. All tiers stay inside the
// existing parcel, preserving the road, footbridge and landmark clearances.
export function buildingStoreys(b){
  const shopH=Math.min(4.4,b.height*.25),floorCount=Math.max(1,Math.round((b.height-shopH)/(b.hero?3.45:3.85)));
  return{shopH,floorCount,floorH:(b.height-shopH)/floorCount};
}
export function buildingMassing(b){
  // Three existing anchor parcels now have different large-scale profiles.
  // These volumes are shared by facade construction, physics and light bakes.
  const profiles={
    'arcology-west':[{bottom:0,top:31,w:45,d:64,x:0,z:0,yaw:0},{bottom:31,top:92,w:35,d:43,x:-3,z:4,yaw:0},{bottom:92,top:122,w:20,d:43,x:-8,z:4,yaw:0}],
    'arcology-east':[{bottom:0,top:24,w:47,d:58,x:0,z:0,yaw:0},{bottom:24,top:98,w:40,d:26,x:0,z:10,yaw:0},{bottom:98,top:116,w:19,d:26,x:10,z:10,yaw:0}],
    'arcology-spire':[{bottom:0,top:34,w:39,d:44,x:0,z:0,yaw:0},{bottom:34,top:130,w:18,d:40,x:-7,z:0,yaw:0},{bottom:130,top:142,w:18,d:27,x:-7,z:5,yaw:0}],
  };
  if(profiles[b.id]){
    const {shopH,floorH}=buildingStoreys(b);
    const align=height=>height===0||height===b.height?height:shopH+Math.round((height-shopH)/floorH)*floorH;
    return profiles[b.id].map(v=>({...v,bottom:align(v.bottom),top:align(v.top)}));
  }

  if(b.archetype==='foundry')return[{bottom:0,top:b.height,w:b.w,d:b.d,x:0,z:0,yaw:0}];
  const {shopH,floorCount,floorH}=buildingStoreys(b),style=Math.abs(b.style||0)%5;
  const low=Math.max(1,Math.floor(floorCount*.24)),middle=Math.max(low+1,Math.floor(floorCount*.57)),high=Math.max(middle+1,Math.floor(floorCount*.80));
  const cuts=[0,low,middle,high,floorCount].filter((n,i,a)=>n<=floorCount&&a.indexOf(n)===i);
  const plans=[
    [[1,1,0,0,0],[.88,.92,.03,-.01,0],[.71,.83,.11,-.04,0],[.57,.70,.18,-.10,0]],
    [[1,1,0,0,0],[.77,.93,-.10,.01,0],[.82,.75,.06,-.10,0],[.61,.66,.16,-.16,0]],
    [[1,1,0,0,0],[.72,.70,0,0,.16],[.64,.61,.04,-.04,.16],[.48,.54,.10,-.06,.16]],
    [[1,1,0,0,0],[.67,.78,-.12,.07,0],[.84,.86,-.04,.03,0],[.56,.62,.16,-.09,0]],
    [[1,1,0,0,0],[.91,.71,.02,-.11,0],[.72,.63,.11,-.16,0],[.54,.48,.19,-.20,0]],
  ][style];
  const lower=/^market-(front|gate)-/.test(b.id),streetSide=Math.sign(b.x+200)||1;
  const result=[{bottom:0,top:shopH,w:b.w,d:b.d,x:0,z:0,yaw:0}];
  for(let i=0;i<cuts.length-1;i++){
    const [sw,sd,ox,oz,yaw]=plans[Math.min(i,3)];
    let w=b.w*sw,d=b.d*sd,x=b.w*ox,z=b.d*oz;
    // Lower-city terraces retreat away from the vehicle street, making a
    // readable 5-12 storey street wall rather than an alternating overhang.
    if(lower&&i>0){x=streetSide*(b.w-w)*.43;z*=.45;}
    const ex=(Math.abs(Math.cos(yaw))*w+Math.abs(Math.sin(yaw))*d)/2,ez=(Math.abs(Math.sin(yaw))*w+Math.abs(Math.cos(yaw))*d)/2;
    x=Math.max(-b.w/2+ex,Math.min(b.w/2-ex,x));z=Math.max(-b.d/2+ez,Math.min(b.d/2-ez,z));
    result.push({bottom:shopH+cuts[i]*floorH,top:shopH+cuts[i+1]*floorH,w,d,x,z,yaw});
  }
  return result;
}
export const CITY_CONTINUITY=createCityContinuity(CITY_STREETS,CITY_ROUTES,CITY_BUILDINGS);
export const CITY_COLLIDERS=[...LANDMARK_COLLIDERS,...CITY_PLAN_SOLIDS,...CITY_CONTINUITY.solids];
for(const b of CITY_BUILDINGS){
  const lower=/^market-(front|gate)-/.test(b.id)||b.archetype==='foundry'||b.archetype==='civic',side=Math.sign(b.x-(b.archetype==='foundry'?100:b.archetype==='civic'?400:-200));
  // The 5 m street-life paving strip starts at the shop face. Remove the
  // generic 2.5 m frontage extension so two equal-height decks never overlap.
  CITY_COLLIDERS.push({id:b.id+'-sidewalk',kind:'sidewalk',size:[b.w+(lower?2.5:5),.12,b.d+5],position:[b.x+(lower?side*1.25:0),b.baseY+.06,b.z],rotation:[0,0,0]});
  buildingMassing(b).forEach((v,i)=>CITY_COLLIDERS.push({id:i===0?b.id:b.id+'-tier-'+i,buildingId:b.id,kind:'building',size:[v.w,v.top-v.bottom,v.d],position:[b.x+v.x,b.baseY+(v.bottom+v.top)/2,b.z+v.z],rotation:[0,v.yaw,0],style:b.style}));
  CITY_COLLIDERS.push(...buildingExtras(b));
}
CITY_COLLIDERS.push({id:'upper-city-terrace',kind:'terrace',size:[280,8,270],position:[420,4,285],rotation:[0,0,0]});
for(const [id,size,position] of [
  ['south-west',[109,.75,.4],[334.5,8.375,150]],['south-east',[149,.75,.4],[485.5,8.375,150]],
  ['north-west',[180,.75,.4],[370,8.375,420]],['north-east',[60,.75,.4],[530,8.375,420]],
  ['west-south',[.4,.75,140],[280,8.375,220]],['west-north',[.4,.75,110],[280,8.375,365]],['east',[.4,.75,270],[560,8.375,285]],
])CITY_COLLIDERS.push({id:'terrace-parapet-'+id,kind:'road-barrier',size,position,rotation:[0,0,0]});
// Two TOP-centreline points, including pitch/yaw and slab thickness.
export function routeSlab(a,b,width,thickness=.65){
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],h=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz),pitch=-Math.atan2(dy,h),sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch),normal=[sy*sp,cp,cy*sp];
  return {size:[width,thickness,Math.hypot(h,dy)+.025],position:a.map((v,i)=>(v+b[i])/2-normal[i]*thickness/2),rotation:[Math.atan2(sp,cy*cp),Math.asin(Math.max(-1,Math.min(1,sy*cp))),Math.atan2(-sy*sp,cy)]};
}
for(const route of CITY_ROUTES)route.points.slice(1).forEach((p,i)=>{
  const a=route.points[i],slab=routeSlab(a,p,route.width);CITY_COLLIDERS.push({id:`${route.id}-${i}`,kind:'urban-road',...slab});
  const yaw=Math.atan2(p[0]-a[0],p[2]-a[2]),pitch=-Math.atan2(p[1]-a[1],Math.hypot(p[0]-a[0],p[2]-a[2])),normal=[Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)],right=[Math.cos(yaw),0,-Math.sin(yaw)];
  for(const side of [-1,1])CITY_COLLIDERS.push({id:`${route.id}-barrier-${i}-${side}`,kind:'road-barrier',size:[.32,.65,slab.size[2]],position:slab.position.map((v,k)=>v+normal[k]*.72+right[k]*side*(route.width/2-.22)),rotation:slab.rotation});
  if(i%7===0&&Math.min(a[1],p[1])>3){const x=(a[0]+p[0])/2,z=(a[2]+p[2])/2,h=(a[1]+p[1])/2-.7;CITY_COLLIDERS.push({id:`${route.id}-pier-${i}`,kind:'city-column',size:[2.4,h,3.4],position:[x,h/2,z],rotation:[0,0,0]});}
});
for(const x of [-280,-160,-40,80,200,310])CITY_COLLIDERS.push({id:`cross-city-pier-${x}`,kind:'city-column',size:[2.2,19.35,10],position:[x,9.675,-225],rotation:[0,0,0]});
CITY_COLLIDERS.push({id:'skyway-deck',kind:'skyway',size:[14,.65,170],position:[200,13.675,0],rotation:[0,0,0]});
const rise=14,run=85,length=Math.hypot(rise,run),angle=Math.atan2(rise,run);
CITY_COLLIDERS.push({id:'skyway-south-ramp',kind:'skyway',size:[14,.65,length],position:[200,7-.325*Math.cos(angle),-127.5+.325*Math.sin(angle)],rotation:[-angle,0,0]});
CITY_COLLIDERS.push({id:'skyway-north-ramp',kind:'skyway',size:[14,.65,length],position:[200,7-.325*Math.cos(angle),127.5-.325*Math.sin(angle)],rotation:[angle,0,0]});
for(const z of [-65,0,65])for(const x of [195,205])CITY_COLLIDERS.push({id:`viaduct-${x}-${z}`,kind:'city-column',size:[1.1,13.35,1.1],position:[x,6.675,z],rotation:[0,0,0]});
for(const [i,a,b]of [[0,[200,0,-170],[200,14,-85]],[1,[200,14,-85],[200,14,85]],[2,[200,14,85],[200,0,170]]]){
  const slab=routeSlab(a,b,14),pitch=-Math.atan2(b[1]-a[1],b[2]-a[2]);
  for(const side of [-1,1])CITY_COLLIDERS.push({id:`skyway-edge-${i}-${side}`,kind:'road-barrier',size:[.28,.72,slab.size[2]],position:[200+side*6.7,slab.position[1]+Math.cos(pitch)*.69,slab.position[2]+Math.sin(pitch)*.69],rotation:slab.rotation});
}
// The old flat market roof is replaced by the shared exchange-vault chords.

for(const z of [-320,-172])CITY_COLLIDERS.push({id:`market-footbridge-${z}`,kind:'footbridge',size:[22,.38,4],position:[-200,5.21,z],rotation:[0,0,0]});
export const CITY_LOCATIONS=[
  ...LANDMARK_LOCATIONS,
  {id:'city',label:'织桥街',subtitle:'双层步廊 · 弧顶交换厅',position:[-200,.62,-345]},
  {id:'harbor',label:'上城议庭',subtitle:'林荫柱廊 · 半环议庭',position:[400,8.62,230]},
  {id:'skyway',label:'空中长廊',subtitle:'14 m 高架 · 坡道可达',position:[200,14.62,0]},
];
export function districtAt(x,z){const r=LANDMARK_RESERVATIONS.find(r=>x>r.minX&&x<r.maxX&&z>r.minZ&&z<r.maxZ);if(r)return{botanical:'BOTANICAL / 穹顶植物园',waterfront:'WATERFRONT / 南岸水庭',sculpture:'TIDAL / 潮汐广场'}[r.id];if(Math.abs(x)<100&&Math.abs(z)<100)return'CENTRAL / 车辆试验中心';const planned=plannedDistrictAt(x,z);if(planned)return planned.en+' / '+planned.label;if(x>380)return'EAST RIDGE / 山脊环线';if(x>150&&Math.abs(z)<180)return'SKYLINE / 高架廊道';if(x<-110&&z<60)return'LOWER CITY / 下城街市';return'DOWNTOWN / 中央城区';}
