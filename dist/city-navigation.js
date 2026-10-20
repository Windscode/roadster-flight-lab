/** Selected road navigation. Every edge comes from an existing carriageway.
 * X/Z crossings join only at a common road level. This is a route guide, not
 * an automatic driver or a claim that every reachable patch is a road. */
import {CITY_STREETS} from './city-plan.js';
import {CITY_ROUTES,CITY_COLLIDERS} from './city-data.js';
import {contentLabel} from './experiment-records.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const length=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
const horizontal=(a,b)=>Math.hypot(b[0]-a[0],b[2]-a[2]);
const at=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const heading=(a,b)=>Math.atan2(b[0]-a[0],b[2]-a[2])*180/Math.PI;
const wrap=angle=>((angle+540)%360)-180;
const cross=(a,b)=>a[0]*b[2]-a[2]*b[0];
const vector=(a,b)=>b.map((v,i)=>v-a[i]);
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;};

export const CITY_NAVIGATION_VERSION='selected-carriageways-1';
export const CITY_NAV_DESTINATIONS=deepFreeze([
 {id:'weave-exchange',label:'织桥交换厅',labelEn:'Weave Exchange',position:[-200,0,-262],streetId:'weave-main',arrivalRadiusM:7,note:'抵达厅下车行街；上层步廊不是车行入口。',noteEn:'Arrival is on the carriageway beneath the hall, not the upper walkways.'},
 {id:'foundry-gate',label:'机造服务桥',labelEn:'Foundry Service Bridge',position:[100,0,315],streetId:'foundry-main',arrivalRadiusM:8,note:'沿机造大道到服务桥下。',noteEn:'Arrive on Foundry Avenue beneath the service bridge.'},
 {id:'sky-forum',label:'上城议庭车行入口',labelEn:'Sky Forum vehicle entrance',position:[488,8,365],streetId:'forum-court',arrivalRadiusM:7,note:'导航止于 8 m 台地议庭前街；东侧台阶与柱廊为步行空间。',noteEn:'Route ends on the 8 m terrace street; the eastern steps and colonnade are pedestrian space.'},
 {id:'southbank-entry',label:'南岸水庭到达区',labelEn:'South Quay arrival area',position:[-430,0,-422],streetId:'south-arrival',arrivalRadiusM:5,note:'止于车行到达区；前方门廊、扶手坡道与水际不计入车行导航。',noteEn:'Stop in the vehicle arrival area; the portal, railed ramp and water edge are outside this road guide.'},
 {id:'city-challenge-start',label:'上城驾飞挑战起点',labelEn:'Upper City drive–flight start',position:[400,8,230],streetId:'forum-main',arrivalRadiusM:5,note:'议庭大道 8 m 台地，车头朝 +Z，停车后开始；不传送车辆。',noteEn:'On the 8 m terrace avenue, face +Z and stop before starting. No vehicle teleport.'},
 {id:'test-center',label:'车辆试验中心车道',labelEn:'Vehicle test-centre lane',position:[0,0,-28],streetId:'test-center-access',arrivalRadiusM:8,note:'沿实际中央车道到达。',noteEn:'Arrive along the existing central test lane.'},
]);

function sources(){
 const skywayIds=['skyway-south-ramp','skyway-deck','skyway-north-ramp'];
 if(!skywayIds.every(id=>CITY_COLLIDERS.some(c=>c.id===id)))throw Error('Skyway collision identity is unavailable');
 return [
  ...CITY_STREETS.map(s=>({...s,source:'CITY_STREETS',name:s.label})),
  ...CITY_ROUTES.map(s=>({...s,source:'CITY_ROUTES',label:s.name})),
  // These coordinates are the top centreline of the three existing skyway
  // solids. A ground crossing underneath is deliberately not an entrance.
  {id:'skyway',label:'14 m 高架廊道',width:14,source:'skyway-deck + two existing ramp colliders',points:[[200,0,-170],[200,14,-85],[200,14,85],[200,0,170]]},
  // Existing visible centre lane of the test centre, bounded before the
  // sculpture reservation. No connector is drawn through an occupied block.
  {id:'test-center-access',label:'试验中心通道',width:15,source:'existing central floor / lane markings in environment',points:[[0,0,-132.5],[0,0,90]]},
  // Inherited 3.14 arrival apron, between the existing kerbs. Ends before the
  // pedestrian crossing and accessibility ramp, not inside the water garden.
  {id:'south-arrival',label:'南岸车行到达区',width:23,source:'CITY_CONTINUITY south-arrival edges / parking',points:[[-430,0,-400],[-430,0,-423]]},
 ];
}
export const CITY_NAV_ROADS=deepFreeze(sources());
export const CITY_NAV_GEOMETRY_ID=contentLabel({version:CITY_NAVIGATION_VERSION,roads:CITY_NAV_ROADS});

function projection(point,a,b){const dx=b[0]-a[0],dz=b[2]-a[2],den=dx*dx+dz*dz,t=den?clamp(((point[0]-a[0])*dx+(point[2]-a[2])*dz)/den,0,1):0,p=at(a,b,t);return{point:p,t,lateralM:horizontal(point,p),heightErrorM:Math.abs(point[1]-p[1])};}

export function buildCityNavigationGraph(roads=CITY_NAV_ROADS){
 const segments=roads.flatMap(road=>road.points.slice(1).map((b,i)=>({road,a:road.points[i],b,cuts:[0,1]})));
 const eps=1e-7,levelTolerance=.25;
 for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
  const p=segments[i],q=segments[j],r=vector(p.a,p.b),s=vector(q.a,q.b),delta=vector(p.a,q.a),den=cross(r,s);
  if(Math.abs(den)>eps){
   const t=cross(delta,s)/den,u=cross(delta,r)/den;
   if(t>=-eps&&t<=1+eps&&u>=-eps&&u<=1+eps&&Math.abs(at(p.a,p.b,t)[1]-at(q.a,q.b,u)[1])<=levelTolerance){p.cuts.push(clamp(t,0,1));q.cuts.push(clamp(u,0,1));}
  }else if(Math.abs(cross(delta,r))<eps){
   for(const [one,two]of [[p,q],[q,p]])for(const endpoint of [one.a,one.b]){const hit=projection(endpoint,two.a,two.b);if(hit.lateralM<1e-5&&hit.heightErrorM<=levelTolerance)two.cuts.push(hit.t);}
  }
 }
 const nodes=[],edges=[],adj=[];
 function node(point){let i=nodes.findIndex(p=>horizontal(p,point)<1e-5&&Math.abs(p[1]-point[1])<=levelTolerance);if(i<0){i=nodes.length;nodes.push([...point]);adj.push([]);}return i;}
 for(const segment of segments){
  const cuts=[...new Set(segment.cuts.map(t=>Math.round(t*1e9)/1e9))].sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++){
   const a=at(segment.a,segment.b,cuts[i-1]),b=at(segment.a,segment.b,cuts[i]);if(length(a,b)<1e-5)continue;
   const from=node(a),to=node(b),edge={id:edges.length,from,to,a,b,lengthM:length(a,b),roadId:segment.road.id,label:segment.road.label??segment.road.name,width:segment.road.width,source:segment.road.source};edges.push(edge);adj[from].push({node:to,edge});adj[to].push({node:from,edge});
  }
 }
 return{version:CITY_NAVIGATION_VERSION,geometryId:CITY_NAV_GEOMETRY_ID,nodes,edges,adj,levelToleranceM:levelTolerance};
}
export const CITY_NAV_GRAPH=buildCityNavigationGraph();

export function roadSurfaceLevel(telemetry){
 const hits=(telemetry?.wheelStates??[]).filter(w=>w.contact&&Number.isFinite(w.contactPointWorld?.y));
 if(hits.length){const heights=hits.map(w=>w.contactPointWorld.y).sort((a,b)=>a-b);return{heightM:heights[Math.floor(heights.length/2)],estimated:false,datum:'current wheel contact surface'};}
 return{heightM:(telemetry?.position?.y??0)-.60,estimated:true,datum:'CG minus nominal ride height; unavailable as ground guidance while airborne'};
}
export function locateCityRoad(telemetry,{graph=CITY_NAV_GRAPH,maxDistanceM=35,streetId=null}={}){
 if(!telemetry?.position)return null;const p=telemetry.position,level=roadSurfaceLevel(telemetry),point=[p.x,level.heightM,p.z],candidates=[];
 for(const edge of graph.edges){if(streetId&&edge.roadId!==streetId)continue;const hit=projection(point,edge.a,edge.b);if(hit.lateralM<=maxDistanceM&&hit.heightErrorM<=1.05)candidates.push({...hit,edge,level,score:hit.lateralM+hit.heightErrorM*5});}
 candidates.sort((a,b)=>a.score-b.score||a.edge.id-b.edge.id);return candidates[0]??null;
}
function destination(id){
 const key=typeof id==='string'?id:id?.id;
 const found=CITY_NAV_DESTINATIONS.find(d=>d.id===key);if(found)return found;
 // The historical loop button navigates to its real street start, not the
 // next screenshot camera. The drive itself is still up to the user.
 if(key==='weave-canal-loop-38')return{id:key,label:'织桥 · 南岸环线起点',labelEn:'Weave–Quay loop start',position:[-200,0,-393],streetId:'weave-main',arrivalRadiusM:7,note:'抵达真实街道起点后按地图连续驾驶。',noteEn:'Arrive at the actual road start, then drive the mapped loop.'};
 return null;
}

function pathBetween(graph,start,end){
 const distances=graph.nodes.map(()=>Infinity),previous=graph.nodes.map(()=>null),visited=new Set();
 for(const [node,cost]of [[start.edge.from,start.edge.lengthM*start.t],[start.edge.to,start.edge.lengthM*(1-start.t)]])if(cost<distances[node]){distances[node]=cost;previous[node]={root:true};}
 for(let k=0;k<graph.nodes.length;k++){
  let node=-1,best=Infinity;for(let i=0;i<distances.length;i++)if(!visited.has(i)&&distances[i]<best){node=i;best=distances[i];}if(node<0)break;visited.add(node);
  for(const link of graph.adj[node]){const candidate=best+link.edge.lengthM;if(candidate+1e-8<distances[link.node]){distances[link.node]=candidate;previous[link.node]={node,edge:link.edge};}}
 }
 let terminal=null,total=Infinity;
 for(const [node,cost]of [[end.edge.from,end.edge.lengthM*end.t],[end.edge.to,end.edge.lengthM*(1-end.t)]])if(distances[node]+cost<total){total=distances[node]+cost;terminal=node;}
 if(start.edge.id===end.edge.id&&Math.abs(start.t-end.t)*start.edge.lengthM<=total)return{points:[start.point,end.point],legs:[start.edge],lengthM:Math.abs(start.t-end.t)*start.edge.lengthM};
 if(terminal===null||!Number.isFinite(total))return null;
 const nodePath=[terminal],middle=[];let cursor=terminal;
 while(previous[cursor]&&!previous[cursor].root){middle.unshift(previous[cursor].edge);cursor=previous[cursor].node;nodePath.unshift(cursor);}
 const points=[start.point,...nodePath.map(n=>graph.nodes[n]),end.point],legs=[start.edge,...middle,end.edge];
 const cleaned=[points[0]],cleanLegs=[];
 for(let i=1;i<points.length;i++)if(length(cleaned.at(-1),points[i])>1e-5){cleaned.push(points[i]);cleanLegs.push(legs[i-1]);}
 return{points:cleaned,legs:cleanLegs,lengthM:total};
}
function nextTurn(route,destination){
 if(route.lengthM<12)return{kind:'arrive',inM:route.lengthM,roadId:destination.streetId,roadLabel:destination.label};
 let travel=0;
 for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1],b=route.points[i],d=length(a,b);
  if(Math.abs(b[1]-a[1])>.65)return{kind:b[1]>a[1]?'ramp-up':'ramp-down',inM:travel,roadId:route.legs[i-1]?.roadId,roadLabel:route.legs[i-1]?.label};
  travel+=d;if(i<route.points.length-1){const angle=wrap(heading(b,route.points[i+1])-heading(a,b));if(Math.abs(angle)>25)return{kind:Math.abs(angle)>145?'turn-around':angle>0?'left':'right',angleDeg:angle,inM:travel,roadId:route.legs[i]?.roadId,roadLabel:route.legs[i]?.label};}
 }
 return{kind:'straight',inM:route.lengthM,roadId:destination.streetId,roadLabel:destination.label};
}
function textState(state){
 const label=state.destination?.label??'',en=state.destination?.labelEn??label;
 const turnZh={'left':'左转','right':'右转','turn-around':'在安全位置掉头','ramp-up':'沿坡道上行','ramp-down':'沿坡道下行','arrive':'抵达车行入口','straight':'沿道路继续'},turnEn={'left':'Turn left','right':'Turn right','turn-around':'Turn around where safe','ramp-up':'Take the ramp up','ramp-down':'Take the ramp down','arrive':'Arrive at vehicle entrance','straight':'Continue along the road'};
 const base={idle:['请选择车行目的地。','Choose a vehicle destination.'],unknown:['未收录该目的地的可靠车行入口。','No verified road entrance is listed for this destination.'],airborne:['空中：公路导航保留路线，落地后恢复层级定位。','Airborne: road route retained; road level guidance resumes after contact.'],unavailable:['当前不在精选道路上；未生成穿越楼体的直线。请回到地图所示车道。','Outside the selected road network; no straight shortcut is supplied. Rejoin a mapped carriageway.'],disconnected:['此层道路与目标无已确认车行连接。请按实际出入口返回相连路网。','This road level has no verified vehicle connection to the destination. Return through its actual entrance.'],arrived:[`已到 ${label} · 车行入口`,`${en} vehicle entrance reached`],'return-to-road':[`偏离车道约 ${Math.round(state.lateralM??0)} m；在可见、安全位置回到 ${state.currentRoad?.label??'地图车道'}。`,`About ${Math.round(state.lateralM??0)} m from road centre; safely rejoin ${state.currentRoad?.label??'the mapped road'} using the visible access.`]};
 if(base[state.status])return{messageZh:base[state.status][0],messageEn:base[state.status][1]};
 const turn=state.nextTurn??{kind:'straight',inM:0},distance=Math.round(turn.inM);
 return{messageZh:`${state.rejoining?'已按当前道路重算 · ':''}${distance} m 后${turnZh[turn.kind]} · ${turn.roadLabel??label} · 余 ${Math.round(state.remainingM??0)} m`,messageEn:`${state.rejoining?'Route recalculated · ':''}${turnEn[turn.kind]} in ${distance} m · ${turn.roadLabel??en} · ${Math.round(state.remainingM??0)} m remaining`};
}
export class CityNavigator{
 constructor({graph=CITY_NAV_GRAPH}={}){this.graph=graph;this.target=null;this.last=null;this.lastRoad=null;this.lastPathRoads=[];this.rejoinUntil=-Infinity;this.state=this.empty('idle');}
 empty(status){const s={version:CITY_NAVIGATION_VERSION,geometryId:this.graph.geometryId,status,path:[],remainingM:null,currentRoad:null,levelM:null,nextTurn:null,offRoute:false,rejoining:false,destination:this.target?copy(this.target):null};return{...s,...textState(s)};}
 setDestination(value,telemetry=this.last){this.target=value?destination(value):null;this.lastRoad=null;this.lastPathRoads=[];this.rejoinUntil=-Infinity;this.state=this.empty(value&&!this.target?'unknown':'idle');if(this.target&&telemetry)return this.update(telemetry);return this.state;}
 update(telemetry){
  if(telemetry)this.last=telemetry;if(!this.target||!this.last)return this.state;
  const t=this.last;
  if(t.contactCount===0){this.state={...this.state,status:'airborne',offRoute:false,rejoining:false,...textState({...this.state,status:'airborne'})};return this.state;}
  const start=locateCityRoad(t,{graph:this.graph});if(!start){this.state=this.empty('unavailable');return this.state;}
  const targetTelemetry={position:{x:this.target.position[0],y:this.target.position[1]+.6,z:this.target.position[2]},contactCount:4,wheelStates:[{contact:true,contactPointWorld:{y:this.target.position[1]}}]},end=locateCityRoad(targetTelemetry,{graph:this.graph,streetId:this.target.streetId,maxDistanceM:1});
  const route=end&&pathBetween(this.graph,start,end);if(!route){this.state={...this.empty('disconnected'),currentRoad:{id:start.edge.roadId,label:start.edge.label},levelM:start.point[1]};return this.state;}
  const time=t.simTime??0,changed=this.lastRoad&&this.lastRoad!==start.edge.roadId,unexpected=changed&&!this.lastPathRoads.includes(start.edge.roadId);
  if(unexpected)this.rejoinUntil=time+4;
  const offRoute=start.lateralM>start.edge.width/2-.9,status=offRoute?'return-to-road':route.lengthM<=this.target.arrivalRadiusM?'arrived':'routing';
  const guidance=nextTurn(route,this.target);
  if(!offRoute&&route.points.length>1&&Number.isFinite(t.headingDeg)&&Math.abs(wrap(heading(route.points[0],route.points[1])-t.headingDeg))>130&&guidance.inM>8)Object.assign(guidance,{kind:'turn-around',inM:0});
  const state={version:CITY_NAVIGATION_VERSION,geometryId:this.graph.geometryId,status,path:route.points.map(p=>[...p]),pathRoadIds:route.legs.map(e=>e.roadId),remainingM:route.lengthM,currentRoad:{id:start.edge.roadId,label:start.edge.label,widthM:start.edge.width},levelM:start.point[1],surfaceDatum:start.level.datum,surfaceEstimated:start.level.estimated,nextTurn:guidance,offRoute,rejoining:time<this.rejoinUntil,lateralM:start.lateralM,rejoinPoint:offRoute?[...start.point]:null,destination:copy(this.target),scope:'Selected authored carriageways and their existing approaches; no automatic driver or off-road shortcut'};
  this.lastRoad=start.edge.roadId;this.lastPathRoads=state.pathRoadIds;this.state={...state,...textState(state)};return this.state;
 }
 getState(){return this.state;}
}
