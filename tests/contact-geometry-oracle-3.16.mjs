// Independent SAT oracle for the declared four chassis boxes and four regular
// 20-sided wheel-stop cylinders. No Cannon shapes, contact offsets, manifold
// normals, ray hits or penetration helpers are used in these calculations.
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),add=(a,b)=>a.map((v,i)=>v+b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const axes=[[1,0,0],[0,1,0],[0,0,1]];
export function rotate(q,v){const u=[q.x??q[0],q.y??q[1],q.z??q[2]],w=q.w??q[3],uv=cross(u,v),uuv=cross(u,uv);return v.map((x,i)=>x+2*(w*uv[i]+uuv[i]));}
function bounds(vertices){return{lo:[0,1,2].map(i=>Math.min(...vertices.map(p=>p[i]))),hi:[0,1,2].map(i=>Math.max(...vertices.map(p=>p[i])))};}
function box(half,position=[0,0,0],q=[0,0,0,1]){const v=[];for(let i=0;i<8;i++)v.push(add(position,rotate(q,half.map((h,k)=>(i&(1<<k)?1:-1)*h))));const normals=axes.map(a=>rotate(q,a));return{v,normals,edges:normals,bounds:bounds(v)};}
function transformed(shape,position,q){const v=shape.v.map(p=>add(position,rotate(q,p)));return{v,normals:shape.normals.map(n=>rotate(q,n)),edges:shape.edges.map(e=>rotate(q,e)),bounds:bounds(v)};}
const chassis=[box([.93,.25,1.62]),box([.86,.14,.36],[0,.05,1.84]),box([.90,.16,.35],[0,.02,-1.81]),box([.71,.26,.86],[0,.37,-.28])];
function wheel(radius,steer,position){
  const v=[],normals=[[1,0,0]],edges=[[1,0,0]],q=[0,Math.sin(steer/2),0,Math.cos(steer/2)];
  for(let i=0;i<20;i++){const a=i*2*Math.PI/20,m=a+Math.PI/20;for(const sign of [-1,1])v.push(add(position,rotate(q,[sign*.1325,-radius*Math.sin(a),radius*Math.cos(a)])));
    if(i<10){normals.push(rotate(q,[0,-Math.sin(m),Math.cos(m)]));edges.push(rotate(q,[0,-Math.cos(m),-Math.sin(m)]));}}
  normals[0]=rotate(q,normals[0]);edges[0]=rotate(q,edges[0]);return{v,normals,edges};
}
export function penetrationSAT(a,b){
  for(let i=0;i<3;i++)if(a.bounds.hi[i]<b.bounds.lo[i]||b.bounds.hi[i]<a.bounds.lo[i])return 0;
  let depth=Infinity;
  for(const raw of [...a.normals,...b.normals,...a.edges.flatMap(x=>b.edges.map(y=>cross(x,y)))]){
    const length=Math.hypot(...raw);if(length<1e-10)continue;const n=raw.map(x=>x/length),av=a.v.map(p=>dot(p,n)),bv=b.v.map(p=>dot(p,n));
    const amin=Math.min(...av),amax=Math.max(...av),bmin=Math.min(...bv),bmax=Math.max(...bv);
    if(amax<bmin||bmax<amin)return 0;depth=Math.min(depth,amax-bmin,bmax-amin);
  }
  return Number.isFinite(depth)?Math.max(0,depth):0;
}
export function worldBox(geometry){return{id:geometry.id,...box(geometry.size.map(v=>v/2),geometry.position,geometry.quaternion)};}
export function vehiclePenetrations(sim,staticBoxes){
  const p=[sim.body.position.x,sim.body.position.y,sim.body.position.z],q=sim.body.quaternion,centres=[[-.89,.06-sim.params.suspensionMin,1.42],[.89,.06-sim.params.suspensionMin,1.42],[-.89,.06-sim.params.suspensionMin,-1.42],[.89,.06-sim.params.suspensionMin,-1.42]];
  const volumes=[...chassis,...centres.map((c,i)=>wheel(sim.params.wheelRadius,sim.wheelStates[i].steer,c))].map(s=>transformed(s,p,q)),hits=[];
  for(const [i,a]of volumes.entries())for(const b of staticBoxes){const depth=penetrationSAT(a,b);if(depth>1e-10)hits.push({vehicleShape:i,objectId:b.id,penetrationM:depth});}
  return hits;
}
export function mechanicalEnergy(sim){const b=sim.body,local=rotate([-b.quaternion.x,-b.quaternion.y,-b.quaternion.z,b.quaternion.w],[b.angularVelocity.x,b.angularVelocity.y,b.angularVelocity.z]);return{
  translationJ:.5*b.mass*b.velocity.lengthSquared(),rotationJ:.5*dot([b.inertia.x,b.inertia.y,b.inertia.z],local.map(x=>x*x)),gravityJ:b.mass*sim.params.gravity*b.position.y,
  wheelsJ:sim.wheelStates.reduce((sum,w)=>sum+.5*sim.params.wheelInertia*w.angularVelocityRadS**2,0),springJ:sim.wheelStates.reduce((sum,w)=>sum+.5*sim.params.springRate*Math.max(0,sim.params.suspensionRest-w.suspensionLength)**2,0)};}
export const energyTotal=e=>Object.values(e).reduce((s,v)=>s+v,0);
