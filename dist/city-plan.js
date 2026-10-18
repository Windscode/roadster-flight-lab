// Vesper 3.4: original city planning data, metres / Y up / [x,y,z].
// The map, authored scene and collision world consume these records. These are
// project dimensions, not measurements or extracted layouts from another game.
export const CITY_DISTRICTS=[
  {id:'weave',label:'织桥街',en:'WEAVE QUARTER',bounds:[-310,-416,-102,40],color:'#c38c68',identity:'压缩街谷 · 连续店面 · 双层步行廊',streetWidth:10,pedestrianWidth:5,elevation:0},
  {id:'foundry',label:'机造里',en:'FOUNDRY ROW',bounds:[42,136,165,490],color:'#729a9a',identity:'锯齿厂房 · 服务庭院 · 架空机电桥',streetWidth:18,pedestrianWidth:3,elevation:0},
  {id:'forum',label:'上城议庭',en:'SKY FORUM',bounds:[280,150,560,420],color:'#c8b98f',identity:'8 m 台地 · 林荫大道 · 半环形议庭',streetWidth:22,pedestrianWidth:11,elevation:8},
];
export const CITY_STREETS=[
  {id:'weave-main',label:'织桥街',type:'neighbourhood',width:10,points:[[-200,0,-408],[-200,0,40]],district:'weave'},
  {id:'canal-link',label:'南岸联络大道',type:'arterial',width:22,points:[[-570,0,-400],[100,0,-400]],district:'connector'},
  {id:'crosstown-link',label:'中央横街',type:'secondary',width:18,points:[[-300,0,-132.5],[200,0,-132.5]],district:'connector'},
  {id:'foundry-main',label:'机造大道',type:'arterial',width:18,points:[[100,0,-400],[100,0,490]],district:'foundry'},
  {id:'foundry-yard',label:'工坊后巷',type:'service',width:8,points:[[155,0,145],[155,0,475]],district:'foundry'},
  {id:'terrace-link',label:'台地入口',type:'service',width:8,points:[[100,0,302.5],[170,0,302.5],[180,0,300]],district:'connector'},
  {id:'forum-west-link',label:'议庭西入口',type:'secondary',width:16,points:[[280,8,300],[300,8,300],[300,8,322],[400,8,322]],district:'forum'},
  {id:'forum-main',label:'议庭大道',type:'boulevard',width:22,points:[[400,8,150],[400,8,410]],district:'forum'},
  ...[240,322,410].map(z=>({id:'forum-cross-'+z,label:'上城横街',type:'secondary',width:18,points:[[290,8,z],[550,8,z]],district:'forum'})),
  {id:'forum-court',label:'议庭前街',type:'service',width:16,points:[[488,8,322],[488,8,410]],district:'forum'},
];
export const CITY_NODES=[
  {id:'weave-exchange',label:'织桥交换厅',district:'weave',position:[-200,0,-262],radius:28,kind:'covered-street',description:'弧顶厅下车行；5.4 m 步廊连接两处过街桥。',camera:[[-200,2.4,-299],[-198,6.2,-252]]},
  {id:'foundry-gate',label:'机造服务桥',district:'foundry',position:[100,0,315],radius:31,kind:'industrial-gateway',description:'低矮锯齿厂房围合街道，9 m 机电连桥标识服务节点。',camera:[[100,2.3,291],[105,8.2,342]]},
  {id:'sky-forum',label:'半环议庭',district:'forum',position:[526,8,365],radius:29,kind:'civic-court',description:'向街道敞开的半环柱廊、宽台阶和一片完整前庭。',camera:[[488,10.2,342],[528,17,367]]},
];
export const CITY_WALKS=[
  {id:'weave-lower',label:'织桥沿街步行带',width:5,elevation:0,paths:[[[-207.5,0,-408],[-207.5,0,40]],[[-192.5,0,-408],[-192.5,0,40]]]},
  {id:'weave-upper',label:'织桥上层步廊',width:1.7,elevation:5.4,paths:[[[-208,5.4,-320],[-208,5.4,-172]],[[-192,5.4,-320],[-192,5.4,-172]]]},
  {id:'foundry-pavement',label:'机造工作步道',width:3,elevation:0,paths:[[[89.5,0,138],[89.5,0,490]],[[110.5,0,138],[110.5,0,490]]]},
  {id:'forum-arcade',label:'议庭柱廊步道',width:11,elevation:8,paths:[[[383.5,8,150],[383.5,8,420]],[[416.5,8,150],[416.5,8,420]]]},
];
export const CITY_STREET_TREES=[
  ...[-1,1].flatMap(side=>[168,215,267,298,351,389].map(z=>({x:400+side*13,z,y:8.12,height:7.4,spread:2.8}))),
  ...[337,393].map(z=>({x:500,z,y:8.12,height:6.5,spread:3.0})),
];

// Canonical union of axis-aligned road strips. Intersections are rendered
// once, avoiding the equal-height crossing planes used by the previous city.
export function roadSurfaceRectangles(streets,elevation=0){
  const source=[];
  for(const street of streets)for(let i=1;i<street.points.length;i++){
    const a=street.points[i-1],b=street.points[i];if(a[1]!==elevation||b[1]!==elevation)continue;
    const h=street.width/2;
    if(Math.abs(a[0]-b[0])<1e-6)source.push([a[0]-h,Math.min(a[2],b[2])-h,a[0]+h,Math.max(a[2],b[2])+h]);
    else if(Math.abs(a[2]-b[2])<1e-6)source.push([Math.min(a[0],b[0])-h,a[2]-h,Math.max(a[0],b[0])+h,a[2]+h]);
  }
  if(elevation===8)for(const r of source){r[0]=Math.max(280,r[0]);r[1]=Math.max(150,r[1]);r[2]=Math.min(560,r[2]);r[3]=Math.min(420,r[3]);}
  const xs=[...new Set(source.flatMap(r=>[r[0],r[2]]))].sort((a,b)=>a-b),zs=[...new Set(source.flatMap(r=>[r[1],r[3]]))].sort((a,b)=>a-b),rectangles=[];
  for(let iz=0;iz<zs.length-1;iz++){
    let start=-1;
    for(let ix=0;ix<xs.length;ix++){
      const x=(xs[ix]+xs[ix+1])/2,z=(zs[iz]+zs[iz+1])/2,filled=ix<xs.length-1&&source.some(r=>x>r[0]&&x<r[2]&&z>r[1]&&z<r[3]);
      if(filled&&start<0)start=ix;
      if(!filled&&start>=0){rectangles.push([xs[start],zs[iz],xs[ix],zs[iz+1]]);start=-1;}
    }
  }
  return rectangles;
}

const solids=[];
function box(id,size,position,material='concrete',rotation=[0,0,0],kind='plan-structure',extra={}){
  const row={id:'plan-'+id,kind,size,position,rotation,data:{material,...extra}};solids.push(row);return row;
}
// Continuous elevated walkways link the two existing 5.4 m crossing decks.
// No support or stair occupies the central ten-metre vehicle corridor.
for(const side of [-1,1]){
  const x=-200+side*8;
  box('weave-upper-'+side,[1.7,.30,148],[x,5.25,-246],'warm-stone',[0,0,0],'plan-walkway');
  for(const z of [-314,-299,-284,-269,-254,-239,-224,-209,-194,-179]){
    // The cross-city 20 m viaduct is above this neighbourhood layer.
    box('weave-upper-post-'+side+'-'+z,[.23,5.1,.23],[x+side*.58,2.55,z],'steel');
  }
  for(const edge of [-1,1]){
    box('weave-rail-'+side+'-'+edge,[.045,1.0,148],[x+edge*.79,5.9,-246],'steel',[0,0,0],'plan-rail');
  }
  // One stair per side, on alternate street ends, leaves an uncluttered walk.
  const z0=side<0?-332:-160,direction=side<0?1:-1;
  for(let step=0;step<30;step++){
    const h=(step+1)*.18;
    box('weave-stair-'+side+'-'+step,[1.55,h,.34],[x,h/2,z0+direction*(step+.5)*.33],'warm-stone',[0,0,0],'plan-step');
  }
}
// Vaulted exchange hall: the physical roof is the same chord-by-chord shape
// rendered in the scene, rather than an arched image over a flat collider.
for(let i=0;i<22;i++){
  if(i===10||i===11)continue; // a real open ridge-light slot
  const x0=-11+i,x1=x0+1,y0=6.4+2.1*(1-(x0/11)**2),y1=6.4+2.1*(1-(x1/11)**2),a=Math.atan2(y1-y0,x1-x0),n=[-Math.sin(a),Math.cos(a),0];
  box('exchange-roof-'+i,[Math.hypot(1,y1-y0)+.015,.18,48],[-200+(x0+x1)/2-n[0]*.09,(y0+y1)/2-n[1]*.09,-262],i%4===0?'steel':'aged-copper',[0,0,a],'plan-roof');
}
for(const z of [-282,-270,-258,-246])box('exchange-ridge-tie-'+z,[2.0,.12,.16],[-200,8.40,z],'steel');
for(const x of [-209,-191])for(const z of [-282,-270,-258,-246])box('exchange-column-'+x+'-'+z,[.28,6.3,.28],[x,3.15,z],'steel');

// Industrial frontage and clear, uninterrupted working pavements.
for(const x of [89.5,110.5])box('foundry-paving-'+x,[3,.12,352],[x,.06,314],'basalt',[0,0,0],'plan-walkway');
for(const x of [88.4,111.6]){
  box('foundry-gate-post-'+x,[.75,9.0,.9],[x,4.5,315],'oxide');
  box('foundry-gate-foot-'+x,[1.5,.35,1.7],[x,.175,315],'basalt');
}
box('foundry-service-deck',[24,.32,4.0],[100,8.84,315],'steel');
for(const z of [313.12,316.88])box('foundry-service-rail-'+z,[24,1.05,.10],[100,9.55,z],'steel',[0,0,0],'plan-rail');
box('foundry-service-trunk',[24,.7,.65],[100,10.8,315],'oxide');

// Civic street: its broad footways are interrupted at all three junctions.
// Parcel foundations stop at the frontage, so these strips never overlay them.
for(const side of [-1,1])for(const [a,b]of [[150,231],[249,313],[331,401]]){
  const x=400+side*16.5;
  box('forum-walk-'+side+'-'+a,[11,.12,b-a],[x,8.06,(a+b)/2],'ivory',[0,0,0],'plan-walkway');
  box('forum-arcade-roof-'+side+'-'+a,[4.5,.30,b-a-4],[400+side*17.5,15.85,(a+b)/2],'ivory',[0,0,0],'plan-roof');
  for(let z=a+8;z<b-3;z+=15)box('forum-column-'+side+'-'+z,[.42,7.7,.42],[400+side*15,11.85,z],'ivory');
}
// The east-side civic destination opens toward a service street, without
// obstructing the boulevard, its spawn or the three east-west crossings.
box('forum-court-base',[58,.12,58],[525,8.06,365],'ivory',[0,0,0],'plan-walkway');
for(let i=0;i<4;i++)box('forum-court-step-'+i,[2.0,.13*(i+1),48],[498+i*2,8+.065*(i+1),365],'ivory',[0,0,0],'plan-step');
box('forum-dais',[48,.52,48],[529,8.26,365],'ivory',[0,0,0],'plan-walkway');
for(let i=0;i<=12;i++){
  const a=-Math.PI/2+i*Math.PI/12,x=526+22*Math.cos(a),z=365+22*Math.sin(a);
  box('forum-fan-column-'+i,[.6,10.4,.6],[x,13.72,z],'ivory');
}
for(let i=0;i<24;i++){
  const a0=-Math.PI/2+i*Math.PI/24,a1=a0+Math.PI/24,am=(a0+a1)/2,chord=44*Math.sin((a1-a0)/2),x=526+22*Math.cos(am),z=365+22*Math.sin(am);
  box('forum-fan-roof-'+i,[chord+.02,.48,5.0],[x,19.16,z],'ivory',[0,-am-Math.PI/2,0],'plan-roof');
}
box('forum-back-screen',[.8,11.8,51],[553,14.42,365],'aged-copper');
for(const z of [340,390])box('forum-side-screen-'+z,[30,7,.30],[538,12.02,z],'aged-copper');
export const CITY_PLAN_SOLIDS=solids;

// Additional building solids: a factory roof has repeated sloped daylight
// pitches and vertical clerestories. Both are physical, not cosmetic roofs.
export function buildingExtras(b){
  if(b.archetype!=='foundry')return[];
  const rows=[],n=Math.max(3,Math.round(b.d/9)),run=b.d/n,rise=2.8;
  for(let i=0;i<n;i++){
    const z0=b.z-b.d/2+i*run,z1=z0+run,pitch=-Math.atan2(rise,run),normal=[0,Math.cos(pitch),Math.sin(pitch)],length=Math.hypot(run,rise);
    rows.push({id:b.id+'-roof-'+i,buildingId:b.id,kind:'building',size:[b.w,.20,length+.015],position:[b.x,b.baseY+b.height+rise/2-normal[1]*.10,(z0+z1)/2-normal[2]*.10],rotation:[pitch,0,0],style:b.style,data:{material:'oxide',part:'sawtooth-roof'}});
    rows.push({id:b.id+'-clerestory-'+i,buildingId:b.id,kind:'building',size:[b.w,rise,.12],position:[b.x,b.baseY+b.height+rise/2,z1-.06],rotation:[0,0,0],style:b.style,data:{material:'glazing',part:'clerestory'}});
  }
  return rows;
}

export function plannedDistrictAt(x,z){return CITY_DISTRICTS.find(d=>x>=d.bounds[0]&&x<=d.bounds[2]&&z>=d.bounds[1]&&z<=d.bounds[3]);}
export const CITY_PLAN={version:'3.4',coordinateSystem:'metres, Y up, points [x,y,z]',districts:CITY_DISTRICTS,streets:CITY_STREETS,nodes:CITY_NODES,walks:CITY_WALKS};
