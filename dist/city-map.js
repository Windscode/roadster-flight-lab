import {t as tr,getLanguage,onLanguageChange} from './i18n.js';
import {CITY_BENCHMARK_ROUTE} from './visual-presets.js';
import {CITY_PLAN,CITY_DISTRICTS,CITY_STREETS,CITY_NODES,CITY_WALKS} from './city-plan.js';
import {CITY_BUILDINGS,CITY_ROUTES,CITY_LOCATIONS} from './city-data.js';
import {CityNavigator,CITY_NAV_DESTINATIONS,CITY_NAV_ROADS} from './city-navigation.js';
const L=(zh,en)=>getLanguage()==='en'?en:zh;
export function createCityMap(onWaypoint=()=>{},{navigator=new CityNavigator()}={}){
 const canvas=document.getElementById('city-plan-canvas'),g=canvas.getContext('2d'),detail=document.getElementById('city-plan-detail'),buttons=document.getElementById('city-plan-nodes');
 let state=null,target=null,markedTarget=null,surfaceRoute=null;const extent=640,margin=32,w=canvas.width,h=canvas.height,s=(w-2*margin)/(extent*2),px=x=>w/2-x*s,pz=z=>h/2-z*s;
 const destinations=CITY_NAV_DESTINATIONS,selectionNodes=destinations.map(d=>({...CITY_NODES.find(n=>n.id===d.id),...d,description:d.note}));
 const routeNode={id:CITY_BENCHMARK_ROUTE.id,label:CITY_BENCHMARK_ROUTE.name,labelEn:'Weave–Quay loop start',position:CITY_BENCHMARK_ROUTE.points[0],description:CITY_BENCHMARK_ROUTE.instructions.join(' ')};
 const navStatus=document.createElement('p');navStatus.className='field-help';navStatus.setAttribute('data-no-i18n','');navStatus.setAttribute('role','status');navStatus.dataset.cityNavigation='';detail.after(navStatus);
 function select(node){target=node;detail.replaceChildren();const heading=document.createElement('h3'),p=document.createElement('p'),button=document.createElement('button');heading.textContent=getLanguage()==='en'?node.labelEn??tr(node.label):node.label;p.textContent=getLanguage()==='en'?node.noteEn??tr(node.description):node.description;button.className='secondary-button';button.textContent=markedTarget?.id===node.id?L('已导航 · ESC 返回驾驶','Route selected · ESC to drive'):L('导航到车行入口','Route to vehicle entrance');button.onclick=()=>{setDestination(node);};const clear=document.createElement('button');clear.className='text-link city-node-button';clear.textContent=L('取消导航','Clear route');clear.onclick=()=>setDestination(null);detail.append(heading,p,button,clear);draw(state);}
 function setDestination(value,t=state){
  if(t)state=t;const node=typeof value==='string'?selectionNodes.find(n=>n.id===value)??(value===routeNode.id?routeNode:null):value;
  markedTarget=node??null;const result=navigator.setDestination(markedTarget,state);onWaypoint(result.destination??markedTarget,result);if(node)select(node);else if(target)select(target);else draw(state);return result;
 }
 function line(points,width,color,dash=[]){g.strokeStyle=color;g.lineWidth=Math.max(1,width*s);g.setLineDash(dash);g.beginPath();points.forEach((p,i)=>i?g.lineTo(px(p[0]),pz(p[2])):g.moveTo(px(p[0]),pz(p[2])));g.stroke();g.setLineDash([]);}
 function draw(t){if(t)state=t;const nav=state?navigator.update(state):navigator.getState();g.fillStyle='#101e28';g.fillRect(0,0,w,h);g.strokeStyle='#2c435044';g.lineWidth=1;for(let v=-600;v<=600;v+=100){g.beginPath();g.moveTo(px(v),pz(-620));g.lineTo(px(v),pz(620));g.stroke();g.beginPath();g.moveTo(px(-620),pz(v));g.lineTo(px(620),pz(v));g.stroke();}
  for(const d of CITY_DISTRICTS){const [x0,z0,x1,z1]=d.bounds;g.fillStyle=d.color+'22';g.fillRect(px(x1),pz(z1),(x1-x0)*s,(z1-z0)*s);g.strokeStyle=d.color+'77';g.strokeRect(px(x1),pz(z1),(x1-x0)*s,(z1-z0)*s);}
  g.fillStyle='#69818c70';for(const b of CITY_BUILDINGS)g.fillRect(px(b.x+b.w/2),pz(b.z+b.d/2),b.w*s,b.d*s);
  for(const r of CITY_STREETS)line(r.points,r.width,r.type==='arterial'?'#b9c8bc':'#799b9e');
  for(const walk of CITY_WALKS)for(const points of walk.paths)line(points,walk.width,walk.elevation?'#c4aacc':'#88ad82',[3,4]);
  for(const r of CITY_ROUTES)line(r.points,r.width,'#d9b37c',[9,5]);
  for(const r of CITY_NAV_ROADS.filter(r=>['skyway','south-arrival','test-center-access'].includes(r.id)))line(r.points,r.width,r.id==='skyway'?'#d9b37c':'#799b9e',r.id==='skyway'?[9,5]:[]);
  const benchmarkSelected=target?.id===CITY_BENCHMARK_ROUTE.id;line(CITY_BENCHMARK_ROUTE.points,benchmarkSelected?4.5:2.4,benchmarkSelected?'#d8efc0':'#9abaa488',[5,4]);
  if(surfaceRoute)line(surfaceRoute.route.waypoints.map(p=>[p.x,0,p.z]),7,'#f0cf8d');
  if(nav.path?.length>1)line(nav.path,6.5,nav.status==='airborne'?'#91aeae':'#bdf2cf',nav.offRoute?[5,4]:[]);
  g.font='17px Microsoft YaHei, sans-serif';g.textAlign='center';for(const d of CITY_DISTRICTS){g.fillStyle=d.color;g.fillText(tr(d.label),px((d.bounds[0]+d.bounds[2])/2),pz(d.bounds[3])+23);}
  for(const loc of CITY_LOCATIONS){g.fillStyle='#a6c5a3';g.beginPath();g.arc(px(loc.position[0]),pz(loc.position[2]),5,0,Math.PI*2);g.fill();}
  selectionNodes.forEach((n,i)=>{const x=px(n.position[0]),y=pz(n.position[2]);g.fillStyle=target?.id===n.id?'#e5edbd':'#c1d8e0';g.beginPath();g.arc(x,y,target?.id===n.id?12:10,0,Math.PI*2);g.fill();g.fillStyle='#1c3036';g.font='bold 13px Consolas';g.fillText(i+1,x,y+4);});
  if(state){const x=px(state.position.x),y=pz(state.position.z);g.save();g.translate(x,y);g.rotate(-state.headingDeg*Math.PI/180);g.fillStyle='#f1f8e5';g.beginPath();g.moveTo(0,-11);g.lineTo(-7,8);g.lineTo(0,4);g.lineTo(7,8);g.closePath();g.fill();g.restore();}
  if(nav.rejoinPoint){g.strokeStyle='#f0c68a';g.lineWidth=2;g.beginPath();g.arc(px(nav.rejoinPoint[0]),pz(nav.rejoinPoint[2]),8,0,Math.PI*2);g.stroke();}
  g.textAlign='left';g.font='14px Consolas';g.fillStyle='#c2d6d5';g.fillText('N ↑    0 ━━━ 100 m',margin,h-17);
  navStatus.textContent=getLanguage()==='en'?nav.messageEn:nav.messageZh;
  canvas.dataset.navigation=JSON.stringify({status:nav.status,geometryId:nav.geometryId,destination:nav.destination?.id??null,path:nav.path,remainingM:nav.remainingM,levelM:nav.levelM,offRoute:nav.offRoute,nextTurn:nav.nextTurn});
  canvas.dataset.plan=JSON.stringify({districts:CITY_DISTRICTS.length,nodes:CITY_NODES.length,streets:CITY_STREETS.length,selected:target?.id||null,marked:markedTarget?.id||null,version:CITY_PLAN.version,selectedRoadDestinations:selectionNodes.length,benchmarkRoute:{id:CITY_BENCHMARK_ROUTE.id,lengthMetres:CITY_BENCHMARK_ROUTE.lengthMetres,selected:target?.id===CITY_BENCHMARK_ROUTE.id}});
 }
 function paintButtons(){buttons.replaceChildren();selectionNodes.forEach((n,i)=>{const b=document.createElement('button');b.className='city-node-button';b.textContent=(i+1)+' / '+(getLanguage()==='en'?n.labelEn:n.label);b.onclick=()=>select(n);buttons.append(b);});const b=document.createElement('button');b.className='city-node-button';b.textContent=L('★ / 织桥 · 南岸环线起点','★ / Weave–Quay loop start');b.onclick=()=>select(routeNode);buttons.append(b);}
 canvas.onclick=e=>{const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*w,y=(e.clientY-rect.top)/rect.height*h,node=selectionNodes.find(n=>Math.hypot(px(n.position[0])-x,pz(n.position[2])-y)<25);if(node)select(node);};
 onLanguageChange(()=>{paintButtons();if(target)select(target);else draw(state);});paintButtons();select(selectionNodes[0]);
 return{update:draw,navigator,setDestination,setSurfaceRoute(descriptor){surfaceRoute=descriptor?JSON.parse(JSON.stringify(descriptor)):null;draw(state);},get navigation(){return navigator.getState();},get waypoint(){return markedTarget;}};
}
