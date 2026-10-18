import {CITY_PLAN,CITY_DISTRICTS,CITY_STREETS,CITY_NODES,CITY_WALKS} from './city-plan.js';
import {CITY_BUILDINGS,CITY_ROUTES,CITY_LOCATIONS} from './city-data.js';
export function createCityMap(onWaypoint=()=>{}){
 const canvas=document.getElementById('city-plan-canvas'),g=canvas.getContext('2d'),detail=document.getElementById('city-plan-detail'),buttons=document.getElementById('city-plan-nodes');
 let state=null,target=null,markedTarget=null;const extent=640,margin=32,w=canvas.width,h=canvas.height,s=(w-2*margin)/(extent*2),px=x=>w/2-x*s,pz=z=>h/2-z*s;
 function select(node){target=node;detail.replaceChildren();const heading=document.createElement('h3'),p=document.createElement('p'),button=document.createElement('button');heading.textContent=node.label;p.textContent=node.description;button.className='secondary-button';button.textContent='标记入口';button.onclick=()=>{markedTarget=node;onWaypoint(node);button.textContent='已标记 · ESC 返回驾驶';draw(state);};const clear=document.createElement('button');clear.className='text-link city-node-button';clear.textContent='取消导航标记';clear.onclick=()=>{markedTarget=null;onWaypoint(null);button.textContent='标记入口';draw(state);};detail.append(heading,p,button,clear);draw(state);}
 function line(points,width,color,dash=[]){g.strokeStyle=color;g.lineWidth=Math.max(1,width*s);g.setLineDash(dash);g.beginPath();points.forEach((p,i)=>i?g.lineTo(px(p[0]),pz(p[2])):g.moveTo(px(p[0]),pz(p[2])));g.stroke();g.setLineDash([]);}
 function draw(t){if(t)state=t;g.fillStyle='#101e28';g.fillRect(0,0,w,h);g.strokeStyle='#2c435044';g.lineWidth=1;for(let v=-600;v<=600;v+=100){g.beginPath();g.moveTo(px(v),pz(-620));g.lineTo(px(v),pz(620));g.stroke();g.beginPath();g.moveTo(px(-620),pz(v));g.lineTo(px(620),pz(v));g.stroke();}
  for(const d of CITY_DISTRICTS){const [x0,z0,x1,z1]=d.bounds;g.fillStyle=d.color+'22';g.fillRect(px(x1),pz(z1),(x1-x0)*s,(z1-z0)*s);g.strokeStyle=d.color+'77';g.strokeRect(px(x1),pz(z1),(x1-x0)*s,(z1-z0)*s);}
  g.fillStyle='#69818c70';for(const b of CITY_BUILDINGS)g.fillRect(px(b.x+b.w/2),pz(b.z+b.d/2),b.w*s,b.d*s);
  for(const r of CITY_STREETS)line(r.points,r.width,r.type==='arterial'?'#b9c8bc':'#799b9e');
  for(const walk of CITY_WALKS)for(const points of walk.paths)line(points,walk.width,walk.elevation?'#c4aacc':'#88ad82',[3,4]);
  for(const r of CITY_ROUTES)line(r.points,r.width,'#d9b37c',[9,5]);
  g.font='17px Microsoft YaHei, sans-serif';g.textAlign='center';for(const d of CITY_DISTRICTS){g.fillStyle=d.color;g.fillText(d.label,px((d.bounds[0]+d.bounds[2])/2),pz(d.bounds[3])+23);}
  for(const loc of CITY_LOCATIONS){g.fillStyle='#a6c5a3';g.beginPath();g.arc(px(loc.position[0]),pz(loc.position[2]),5,0,Math.PI*2);g.fill();}
  CITY_NODES.forEach((n,i)=>{const x=px(n.position[0]),y=pz(n.position[2]);g.fillStyle=target?.id===n.id?'#e5edbd':'#c1d8e0';g.beginPath();g.arc(x,y,target?.id===n.id?12:10,0,Math.PI*2);g.fill();g.fillStyle='#1c3036';g.font='bold 13px Consolas';g.fillText(i+1,x,y+4);});
  if(state){const x=px(state.position.x),y=pz(state.position.z);if(markedTarget){g.setLineDash([4,6]);g.strokeStyle='#bfe3d8';g.lineWidth=1.5;g.beginPath();g.moveTo(x,y);g.lineTo(px(markedTarget.position[0]),pz(markedTarget.position[2]));g.stroke();g.setLineDash([]);}g.save();g.translate(x,y);g.rotate(-state.headingDeg*Math.PI/180);g.fillStyle='#f1f8e5';g.beginPath();g.moveTo(0,-11);g.lineTo(-7,8);g.lineTo(0,4);g.lineTo(7,8);g.closePath();g.fill();g.restore();}
  g.textAlign='left';g.font='14px Consolas';g.fillStyle='#c2d6d5';g.fillText('N ↑    0 ━━━ 100 m',margin,h-17);
  canvas.dataset.plan=JSON.stringify({districts:CITY_DISTRICTS.length,nodes:CITY_NODES.length,streets:CITY_STREETS.length,selected:target?.id||null,marked:markedTarget?.id||null,version:CITY_PLAN.version});
 }
 CITY_NODES.forEach((n,i)=>{const b=document.createElement('button');b.className='city-node-button';b.textContent=(i+1)+' / '+n.label;b.onclick=()=>select(n);buttons.append(b);});
 canvas.onclick=e=>{const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*w,y=(e.clientY-rect.top)/rect.height*h,node=CITY_NODES.find(n=>Math.hypot(px(n.position[0])-x,pz(n.position[2])-y)<25);if(node)select(node);};
 select(CITY_NODES[0]);return{update:draw,get waypoint(){return markedTarget;}};
}
