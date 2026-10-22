import {createStreetSectionFinishes} from './city-street-sections.js';
import {createCrosstownStreetEdge} from './city-street-edge.js';
// Authored 3.14 public-space pass. Road centrelines, legal widths, the 114
// building parcels and the 113 elevated segments are retained. Raised elements
// enter the same collision/lighting geometry; markings are optical finishes.
export const CITY_CONTINUITY_VERSION='city-continuity-3.17-1';
const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[2]-a[2])*dz)/(dx*dx+dz*dz)));return{distance:Math.hypot(p[0]-a[0]-dx*t,p[2]-a[2]-dz*t),y:a[1]+(b[1]-a[1])*t,t};};
export function roadOccupancy(position,streets,routes=[],margin=.6){
  for(const road of [...streets,...routes])for(let i=1;i<road.points.length;i++){
    const result=distance(position,road.points[i-1],road.points[i]);
    if(result.distance<road.width/2+margin&&Math.abs(position[1]-result.y)<20)return{road:road.id,...result};
  }
  return null;
}
export function backgroundLightLayout(streets,routes,plannedDistrictAt){
  const lights=[],excluded=[];
  for(let x=-600;x<=600;x+=100)for(let z=-580;z<=580;z+=55)for(const side of [-1,1]){
    const staggered=z+(side>0?27.5:0);if(staggered>603)continue;
    if(plannedDistrictAt(x,staggered))continue;
    const pole=[x+side*12.7,0,staggered],conflict=roadOccupancy(pole,streets,routes,1.0);
    if(conflict){excluded.push({pole,reason:'authored-carriageway-or-ramp',road:conflict.road});continue;}
    lights.push({pole,head:[x+side*12,7.85,staggered],target:[x+side*3.4,.08,staggered+4.5],side});
  }
  return {lights,excluded};
}

export function createCityContinuity(streets,routes,buildings,reservations=[]){
  const solids=[],finishes=[],signs=[],lights=[],coverage=[];
  const box=(id,size,position,material='continuity-stone',rotation=[0,0,0],kind='continuity-structure')=>{const item={id:'continuity-'+id,kind,size,position,rotation,data:{material,project:'city-continuity-3.16-1'}};solids.push(item);return item;};
  const finish=(id,size,position,material='paint',rotation=[0,0,0])=>finishes.push({id:'continuity-'+id,size,position,material,rotation});
  const line=(id,a,b,width=.1,material='paint',height=.006)=>finish(id,[width,height,Math.hypot(b[0]-a[0],b[2]-a[2])],[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],material,[0,Math.atan2(b[0]-a[0],b[2]-a[2]),0]);
  const arrow=(id,x,y,z,yaw)=>{
    const pt=(u,v)=>[x+Math.cos(yaw)*u+Math.sin(yaw)*v,y,z-Math.sin(yaw)*u+Math.cos(yaw)*v];
    line(id+'-stem',pt(0,-1.8),pt(0,1.5),.18);
    for(const side of [-1,1])line(id+'-head-'+side,pt(0,1.5),pt(side*.8,.4),.18);
  };
  const existingEdges=new Set(['weave-main','foundry-main','canal-link','crosstown-link']);
  for(const street of streets){
    const row={id:street.id,label:street.label,widthM:street.width,elevationM:street.points[0][1],segments:[],existingRetained:existingEdges.has(street.id),newElements:[],nativeDrive:'pending-final-build',dayNightPixels:'pending-final-build'};
    for(let index=1;index<street.points.length;index++){
      const a=street.points[index-1],b=street.points[index],length=Math.hypot(b[0]-a[0],b[2]-a[2]);if(length<.1)continue;
      const forward=[(b[0]-a[0])/length,(b[2]-a[2])/length],right=[forward[1],-forward[0]],yaw=Math.atan2(forward[0],forward[1]),h=street.width/2;
      const point=(u,v,y=a[1])=>[a[0]+forward[0]*u+right[0]*v,y,a[2]+forward[1]*u+right[1]*v];
      const blocked=(u,v)=>[...streets,...routes].some(other=>other!==street&&other.points.slice(1).some((p,j)=>{const projected=distance(point(u,v),other.points[j],p);return Math.abs(projected.y-a[1])<1&&projected.distance<other.width/2+2;}));
      const runs=[];for(const side of [-1,1]){
        let start=null;
        for(let u=0;u<=length+2;u+=2){const usable=u<length-2&&u>=2&&!blocked(u,side*(h+.12));
          if(usable&&start===null)start=u;
          if(!usable&&start!==null){if(u-start>2)runs.push({side,from:start,to:Math.min(u,length-2)});start=null;}
        }
        for(let u=9;u<length-6;u+=32)if(!blocked(u,side*(h-.18))){
          finish(street.id+'-drain-'+index+'-'+side+'-'+u,[.22,.007,.74],point(u,side*(h-.18),a[1]+.026),'dark',[0,yaw,0]);
          for(let k=0;k<5;k++)finish(street.id+'-grate-'+index+'-'+side+'-'+u+'-'+k,[.20,.008,.03],point(u-.27+k*.135,side*(h-.18),a[1]+.031),'steel',[0,yaw,0]);
        }
      }
      for(const run of runs){
        const {side,from,to}=run,mid=(from+to)/2;
        if(!existingEdges.has(street.id)){
          const id=street.id+'-kerb-'+index+'-'+side+'-'+from;
          box(id,[.22,.12,to-from],point(mid,side*(h+.12),a[1]+.06),street.district==='forum'?'continuity-stone':'basalt',[0,yaw,0],'continuity-kerb');row.newElements.push('continuity-'+id);
          finish(id+'-edge',[.09,.006,to-from],point(mid,side*(h-.35),a[1]+.023),'paint',[0,yaw,0]);
        }
        if(!existingEdges.has(street.id)&&to-from>18)arrow(street.id+'-direction-'+index+'-'+side+'-'+from, ...point(mid,-side*h*.5,a[1]+.027),yaw+(side<0?Math.PI:0));
      }
      row.segments.push({from:a,to:b,lengthM:length,clearRoadHalfWidthM:h,edgeRuns:runs});
    }
    row.finishes=finishes.filter(f=>f.id.startsWith('continuity-'+street.id+'-')).length;coverage.push(row);
  }

  // The selected Weave → Central Cross Street → Foundry route previously
  // lost its footway section between z=-149 and z=138. New shared strips
  // connect to the existing industrial pavement, leaving the inherited
  // 28 m background crossings at z=-100, 0 and 100 and the turning mouth open.
  // Starting at -84 also avoids a disconnected 1 m paving stub before the
  // -100 crossing; the original asphalt approach remains clear there.
  const connectorFootways=[];
  for(const [start,end]of [[-84,-16],[16,84],[116,138]])for(const side of [-1,1]){
    const id='foundry-inner-walk-'+side+'-'+start;
    box(id,[3,.12,end-start],[100+side*10.5,.06,(start+end)/2],'basalt',[0,0,0],'continuity-paving');
    finish(id+'-edge',[.095,.006,end-start],[100+side*8.67,.024,(start+end)/2]);
    connectorFootways.push({id:'continuity-'+id,street:'foundry-main',from:start,to:end,side,clearHalfWidthM:9});
  }
  // A sheltered seat marks the long cross-town transition. All structural
  // volumes share the existing 3 m footway; no column enters the road.
  for(const x of [-79,-73])box('crosstown-shelter-post-'+x,[.12,3.0,.12],[x,1.62,-144.05],'weathered-steel');
  box('crosstown-shelter-roof',[6.6,.18,1.65],[-76,3.15,-143.64],'weathered-steel');
  box('crosstown-shelter-back',[6.1,2.30,.08],[-76,1.60,-144.08],'glazing');
  box('crosstown-shelter-seat',[3.5,.10,.48],[-76,.63,-143.72],'corridor-wood');
  for(const x of [-77.3,-74.7])box('crosstown-shelter-seat-leg-'+x,[.08,.46,.38],[x,.35,-143.72],'steel');
  signs.push({text:'CENTRAL → FOUNDRY / 机造大道',position:[-76,2.83,-143.92],width:5.3,height:.40,yaw:0});
  lights.push({id:'crosstown-shelter-soffit',position:[-76,3.045,-143.28],target:[-76,.14,-141.8],intensity:95,range:9,color:0xc9e0e1,angle:.95,practical:true,role:'soffit',lensSize:[2.8,.028,.10]});
  const sections=createStreetSectionFinishes(streets,routes,buildings,reservations);
  finishes.push(...sections.finishes);
  const streetEdge=createCrosstownStreetEdge();
  solids.push(...streetEdge.solids);finishes.push(...streetEdge.finishes);signs.push(...streetEdge.signs);lights.push(...streetEdge.lights);

  // South approach: vehicle apron and parking stay north of the inherited
  // 12 m accessible ramp. A walking/service route is stated, not blocked off.
  for(const side of [-1,1]){
    box('south-arrival-edge-'+side,[.22,.12,17],[-430+side*12.4,.06,-420.3],'continuity-stone',[0,0,0],'continuity-kerb');
    for(let j=0;j<3;j++){
      const x=-430+side*(7.6+j*2.35);finish('south-parking-'+side+'-'+j,[.09,.006,5.2],[x,.028,-422.1]);
    }
    box('south-arrival-stone-'+side,[6.5,.10,13.5],[-430+side*16,.05,-421],'continuity-stone',[0,0,0],'continuity-paving');
  }
  finish('south-dropoff-threshold',[23,.008,2.1],[-430,.03,-426.6],'service-concrete');
  for(let k=-5;k<=5;k++)finish('south-walk-crossing-'+k,[.48,.006,2.1],[-430+k,.039,-426.6]);
  signs.push({text:'P  ARRIVAL / 到达停车',position:[-443,2.2,-420],width:4.5,height:.7,yaw:0,backed:true},
    {text:'WATER WALK / 步行优先 · 服务慢行',position:[-440.6,1.7,-429.4],width:5.8,height:.58,yaw:0,backed:true});
  box('south-parking-post',[.10,2.2,.10],[-443,1.1,-420.08],'steel');
  box('south-guidance-post',[.10,1.8,.10],[-440.6,.9,-429.5],'steel');

  // Industrial maintenance pocket uses the real gap between the east halls;
  // a 4.6 m open bay, external work apron and supported service rail.
  finish('foundry-work-apron',[30,.009,10.5],[126.8,.021,245.5],'service-concrete');
  box('foundry-bay-back',[.35,4.8,10.5],[142.6,2.4,245.5],'oxide');
  for(const z of [240.55,250.45])box('foundry-bay-post-'+z,[.22,4.6,.22],[131,2.3,z],'steel');
  box('foundry-bay-roof',[12.2,.24,10.7],[136.8,4.72,245.5],'oxide');
  box('foundry-bay-rail',[11.8,.26,.18],[136.8,4.33,245.5],'steel');
  box('foundry-power-base',[1.8,.18,1.2],[140.9,.09,249.2],'basalt');
  box('foundry-power-cabinet',[1.55,1.55,.8],[140.9,.955,249.2],'weathered-steel');
  for(const z of [241,250])line('foundry-safety-'+z,[112,.034,z],[129,.034,z],.16,'safety-ochre');
  signs.push({text:'WORK BAY 02 / 维护庭',position:[130.86,4.32,245.5],width:8.1,height:.6,yaw:-Math.PI/2});
  lights.push({id:'continuity-foundry-worklight',position:[135.1,4.42,245.5],target:[126.3,.12,245.5],intensity:380,range:17,color:0xe8d6b6,angle:.9,practical:true,role:'soffit',lensSize:[.18,.04,1.5]});
  // A planted/plinth-scaled threshold at the two connector corners; every
  // column lies beyond both crossing carriageways, leaving sight triangles.
  for(const x of [69,132]){
    box('cross-portal-foot-'+x,[1.5,.24,1.5],[x,.12,-150.7],'basalt');
    box('cross-portal-pier-'+x,[.36,4.9,.36],[x,2.45,-150.7],'oxide');
    box('cross-portal-canopy-'+x,[9.8,.22,3.2],[x,4.9,-151.8],'weathered-steel');
  }
  signs.push({text:'FOUNDRY ↑ / 机造服务桥',position:[69,4.4,-150],width:8.3,height:.58,yaw:0});

  // Upper arrival: paint follows the actual ramp top and orthogonal turn. No
  // implicit steering or collider change on the existing asphalt lane.
  for(const x of [283,292])arrow('upper-arrival-'+x,x,8.024,297.0,Math.PI/2);
  arrow('upper-return',290,8.026,303.3,-Math.PI/2);
  for(const x of [283,291])line('upper-stop-'+x,[x,8.028,293],[x,8.028,299],.25);
  for(const z of [335.5,394.5]){
    finish('forum-threshold-'+z,[58,.008,1.2],[525,8.128,z],'basalt');
    box('forum-side-bench-'+z,[4.2,.45,.58],[500.4,8.345,z],'continuity-stone');
  }
  for(const x of [509,520,531,542])finish('forum-dais-band-'+x,[.75,.007,46],[x,8.525,365],'basalt');
  for(const z of [342,354,366,378,390])finish('forum-walk-inlay-'+z,[1.7,.007,.35],[497,8.128,z],'aged-copper');
  for(const t of [{x:500,z:337},{x:500,z:393}]){
    for(const side of [-1,1]){box('forum-tree-kerb-x-'+t.z+'-'+side,[.18,.20,5.8],[t.x+side*2.8,8.1,t.z],'continuity-stone');box('forum-tree-kerb-z-'+t.z+'-'+side,[5.6,.20,.18],[t.x,8.1,t.z+side*2.8],'continuity-stone');}
  }
  for(const side of [-1,1]){
    // Outside the route slab: terraced abutments clarify ramp support.
    for(let i=0;i<5;i++)box('ramp-abutment-'+side+'-'+i,[17.8,(i+.5)*1.6,1.15],[190+i*18,(i+.5)*.8,300+side*8.65],'continuity-stone');
  }

  // The four previously isolated luminous plates now have backing and a
  // hanger to their actual exchange roof / viaduct underside.
  for(const [x,z]of [[-203.2,-279],[-196.8,-255],[-201.8,-230],[-198.2,-218]]){
    box('pendant-backing-'+z,[.94,.10,.38],[x,7.43,z],'steel');
    for(const dx of [-.30,.30]){
      // Match the actual one-metre roof chords and their normal thickness,
      // at each hanger rather than approximating the curved lamp centre.
      const localX=x+dx+200,x0=Math.floor(localX),x1=x0+1;
      const y0=6.4+2.1*(1-(x0/11)**2),y1=6.4+2.1*(1-(x1/11)**2);
      const top=z<-238?y0+(localX-x0)*(y1-y0)-.18*Math.hypot(1,y1-y0)+.015:19.365;
      box('pendant-hanger-'+z+'-'+dx,[.045,top-7.48,.045],[x+dx,(top+7.48)/2,z],'steel');
    }
  }
  // Purposeful roof equipment on the original industrial parcels. Major
  // silhouettes survive balanced mode and share physical/light envelopes.
  for(const id of ['industrial-1-2','industrial--1-5']){
    const b=buildings.find(x=>x.id===id);if(!b)continue;
    box(id+'-service-core',[6.2,5.4,9],[b.x+9,b.height+2.7,b.z+8],'weathered-steel');
    box(id+'-exhaust-stack',[1.1,12,1.1],[b.x+9,b.height+11.4,b.z+8],'oxide').data.renderDetail='mass';
    for(const yy of [b.height+7,b.height+13])box(id+'-stack-collar-'+yy,[1.5,.35,1.5],[b.x+9,yy,b.z+8],'weathered-steel');
  }
  for(const id of ['arcology-west','arcology-east','arcology-spire']){
    const b=buildings.find(x=>x.id===id);if(!b)continue;
    const offset={'arcology-west':[-8,4],'arcology-east':[10,10],'arcology-spire':[-7,5]}[id];
    box(id+'-crown',[b.w*.34,2.1,b.d*.35],[b.x+offset[0],b.baseY+b.height+1.05,b.z+offset[1]],'weathered-steel');
  }
  // The existing 620 m physical perimeter and 700 m flight working limit
  // stay put. Shared mineral embankments cover the old outside-floor gap;
  // their upper surfaces descend from the wall footing to distant geography.
  const bankSlope=Math.atan2(2,80);
  for(const [id,position,size,rotation]of [
    ['east',[660,-2,0],[80.1,2,1400],[0,0,-bankSlope]],
    ['west',[-660,-2,0],[80.1,2,1400],[0,0,bankSlope]],
    ['north',[0,-2,660],[1240,2,80.1],[bankSlope,0,0]],
    ['south',[0,-2,-660],[1240,2,80.1],[-bankSlope,0,0]],
  ])box('perimeter-bank-'+id,size,position,'boundary-aggregate',rotation,'boundary-bank');
  for(const [id,position,yaw]of [['east',[615,3,18],-Math.PI/2],['west',[-615,3,18],Math.PI/2],['north',[18,3,615],Math.PI],['south',[18,3,-615],0]]){
    signs.push({text:'CITY LIMIT / 城市边界',position,width:7.2,height:.9,yaw,backed:true});
    box('boundary-sign-'+id,[.16,3,.16],[position[0],1.5,position[2]],'steel');
  }
  const connectionCoverage=routes.flatMap(route=>route.points.slice(1).map((b,i)=>({routeId:route.id,segment:i,from:route.points[i],to:b,widthM:route.width,sharedSlab:true,railAndPaint:'retained actual tangent',nativeDrive:'pending-final-build'})));
  return {version:CITY_CONTINUITY_VERSION,solids,finishes,signs,lights,coverage,streetSections:sections,streetEdge:{version:streetEdge.version,frontages:streetEdge.frontages,limits:streetEdge.limits},connectorFootways,connectionCoverage,routeSequence:['weave-main','crosstown-link','foundry-main','terrace-link','terrace-west','forum-west-link','forum-main','forum-cross-322','forum-court','canal-link','south-quay-entry'],limits:'Base street pass plus authored maintenance/civic/waterfront transitions. Not final all-street art, physical driving coverage or GPU/performance acceptance.'};
}
