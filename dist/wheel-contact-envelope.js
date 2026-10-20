import {AABB,Vec3,Shape} from './vendor/cannon-es.js';

// Continuous rounded tread support: a radius-R sphere clipped to the existing
// axle half-width. The centre section retains the declared circular tyre
// radius; the shoulders have radius sqrt(R² - x²). This explicit crown is an
// engineering support approximation, not an OEM tyre profile or a replacement
// for the independently retained 20-sided rigid wheel-stop collider.
// Analytic face/edge contacts avoid choosing one of three flat width stations:
// that old hard minimum jumped a whole half-width at arbitrarily small camber.
const EDGES=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
const EPS=1e-8;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const radial=(radius,x)=>Math.sqrt(Math.max(0,radius*radius-x*x));

// First downward contact of the continuous crown with one line segment.
// L(t)=-y(t)-sqrt(R²-x(t)²-z(t)²) is convex on its valid interval. Its analytic
// stationary point and clipped endpoints include vertex and shoulder contacts.
function crownEdge(a,b,radius,halfWidth,accept){
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,A=dx*dx+dz*dz,B=a.x*dx+a.z*dz;
  let lo=0,hi=1;
  if(Math.abs(dx)>EPS){const u=(-halfWidth-a.x)/dx,v=(halfWidth-a.x)/dx;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));}
  else if(Math.abs(a.x)>halfWidth+EPS)return;
  let stationary;
  if(A>EPS*EPS){
    const centre=-B/A,remainder=radius*radius-a.x*a.x-a.z*a.z+B*B/A;
    if(remainder<0)return;
    const span=Math.sqrt(remainder/A);lo=Math.max(lo,centre-span);hi=Math.min(hi,centre+span);
    stationary=centre+dy*Math.sqrt(Math.max(0,remainder)/(A*(A+dy*dy)));
  }else{if(a.x*a.x+a.z*a.z>radius*radius)return;stationary=dy>0?hi:lo;}
  if(lo>hi+EPS)return;
  for(const t of [lo,hi,clamp(stationary,lo,hi)]){
    const x=a.x+dx*t,y=a.y+dy*t,z=a.z+dz*t,h2=radius*radius-x*x-z*z;if(h2< -EPS)continue;
    const h=Math.sqrt(Math.max(0,h2)),n={x:-x,y:h,z:-z};
    // At a width-limited edge contact, combine the crown and axle-cap normal
    // so the support reaction remains perpendicular to the static edge.
    const widthBoundary=(lo>EPS&&Math.abs(t-lo)<EPS||hi<1-EPS&&Math.abs(t-hi)<EPS)&&Math.abs(Math.abs(x)-halfWidth)<EPS;
    if(widthBoundary&&Math.abs(dx)>EPS){const nx=-(n.y*dy+n.z*dz)/dx;if((nx-n.x)*x<=EPS)n.x=nx;}
    const norm=Math.hypot(n.x,n.y,n.z);if(norm<EPS)continue;
    accept(-y-h,{x,y,z},{x:n.x/norm,y:n.y/norm,z:n.z/norm},t<EPS||t>1-EPS?'vertex':'edge');
  }
}

export function circularWheelSupport(world,{mount,up,forward,radius,halfWidth=.1325,minLength,maxLength},result){
  result.reset();result.wheelSupport=null;
  const right=up.cross(forward);right.normalize();
  const end=mount.vsub(up.scale(maxLength)),pad=radius+halfWidth;
  const bounds=new AABB({lowerBound:new Vec3(Math.min(mount.x,end.x)-pad,Math.min(mount.y,end.y)-pad,Math.min(mount.z,end.z)-pad),
    upperBound:new Vec3(Math.max(mount.x,end.x)+pad,Math.max(mount.y,end.y)+pad,Math.max(mount.z,end.z)+pad)});
  const bodies=world.broadphase.aabbQuery(world,bounds,[]);let best=null;
  for(const body of bodies){
    if(body.mass!==0||(body.collisionFilterGroup&1)===0)continue;
    for(let shapeIndex=0;shapeIndex<body.shapes.length;shapeIndex++){
      const shape=body.shapes[shapeIndex];if(shape.type!==Shape.types.BOX)continue;
      const half=shape.halfExtents,shapeQ=body.quaternion.mult(body.shapeOrientations[shapeIndex]);
      const origin=body.pointToWorldFrame(body.shapeOffsets[shapeIndex]),vertices=[];
      const accept=(length,point,normal,feature)=>{
        if(normal.y<=.30||length<minLength-EPS||length>maxLength+EPS)return;
        if(!best||length<best.length-EPS)best={length,point,normal,feature,body,shape};
      };
      // The support of a sphere clipped by |x|<=halfWidth has a continuous
      // analytic face tangency, including the transition onto its shoulder.
      for(const axis of ['x','y','z'])for(const sign of [-1,1]){
        const localNormal=new Vec3();localNormal[axis]=sign;const normalWorld=shapeQ.vmult(localNormal);
        const normal={x:normalWorld.dot(right),y:normalWorld.dot(up),z:normalWorld.dot(forward)};
        if(normal.y<=.30)continue;
        const x=clamp(-radius*normal.x,-halfWidth,halfWidth),sectionRadius=radial(radius,x),lengthYZ=Math.hypot(normal.y,normal.z);
        const offset={x,y:-sectionRadius*normal.y/lengthYZ,z:-sectionRadius*normal.z/lengthYZ};
        const facePoint=origin.vadd(normalWorld.scale(half[axis])),planeDistance=normalWorld.dot(mount.vsub(facePoint));
        const length=(planeDistance+normal.x*offset.x+normal.y*offset.y+normal.z*offset.z)/normal.y;
        const point={x:offset.x,y:offset.y-length,z:offset.z};
        const hit=mount.vadd(right.scale(point.x)).vadd(up.scale(point.y)).vadd(forward.scale(point.z));
        const inBox=shapeQ.conjugate().vmult(hit.vsub(origin));
        if(['x','y','z'].every(k=>Math.abs(inBox[k])<=half[k]+EPS))accept(length,point,normal,'face');
      }
      for(let i=0;i<8;i++){
        const local=new Vec3((i&1?1:-1)*half.x,(i&2?1:-1)*half.y,(i&4?1:-1)*half.z),delta=shapeQ.vmult(local).vadd(origin).vsub(mount);
        vertices.push({x:delta.dot(right),y:delta.dot(up),z:delta.dot(forward)});
      }
      for(const [i,j]of EDGES)crownEdge(vertices[i],vertices[j],radius,halfWidth,accept);
    }
  }
  if(!best)return false;
  result.reset();result.hasHit=true;result.body=best.body;result.shape=best.shape;
  const p=best.point,n=best.normal;
  result.hitPointWorld.copy(mount.vadd(right.scale(p.x)).vadd(up.scale(p.y)).vadd(forward.scale(p.z)));
  result.hitNormalWorld.copy(right.scale(n.x).vadd(up.scale(n.y)).vadd(forward.scale(n.z)));result.hitNormalWorld.normalize();
  // This is the effective suspension value, not Euclidean range to the patch.
  result.distance=best.length+radius;
  result.wheelSupport={method:'continuous-crowned-envelope',feature:best.feature,stationM:p.x,suspensionLengthM:best.length,crownRadiusM:radius,halfWidthM:halfWidth};
  return true;
}
