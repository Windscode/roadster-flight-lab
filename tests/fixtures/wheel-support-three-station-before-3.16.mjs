import {AABB,Vec3,Shape} from '../../dist/vendor/cannon-es.js';

// A downward ray sees a curb only after the axle crosses its leading edge.
// This query casts the circular tyre section down the existing suspension
// axis. Box cross-sections supply real face/edge normals and application
// points; the suspension, damping, friction budget and hard stop stay in the
// vehicle solver. Three width stations approximate the finite contact width.
// It is a rigid circular envelope, not a deformable tyre or wheel impact model.
const EDGES=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
const EPS=1e-8;
const cross=(a,b,c)=>(b.z-a.z)*(c.y-a.y)-(b.y-a.y)*(c.z-a.z);
function section(vertices,station){
  const points=[];
  const add=(y,z)=>{if(!points.some(p=>Math.abs(p.y-y)<EPS&&Math.abs(p.z-z)<EPS))points.push({y,z});};
  for(const [i,j]of EDGES){const a=vertices[i],b=vertices[j],da=a.x-station,db=b.x-station;
    if(Math.abs(da)<EPS)add(a.y,a.z);if(Math.abs(db)<EPS)add(b.y,b.z);
    if(da*db<0){const t=da/(da-db);add(a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);}
  }
  if(points.length<3)return[];
  points.sort((a,b)=>a.z-b.z||a.y-b.y);const lower=[],upper=[];
  for(const p of points){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=EPS)lower.pop();lower.push(p);}
  for(let i=points.length-1;i>=0;i--){const p=points[i];while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=EPS)upper.pop();upper.push(p);}
  lower.pop();upper.pop();return lower.concat(upper);
}

// This circle/convex-polygon calculation deliberately does not invoke Cannon
// narrowphase contact equations. The first eligible upper boundary is found
// by analytic face tangency or a vertex's circular offset.
function circleSupport(polygon,radius,minLength,maxLength){
  let best=null;
  const accept=(length,y,z,ny,nz,feature)=>{
    if(ny<=.30||length<minLength-EPS||length>maxLength+EPS)return;
    if(!best||length<best.length-EPS)best={length,y,z,ny,nz,feature};
  };
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dz=b.z-a.z,dy=b.y-a.y,norm=Math.hypot(dz,dy);
    if(norm<EPS)continue;
    const ny=-dz/norm,nz=dy/norm;
    if(ny>.30){const length=-(ny*a.y+nz*a.z+radius)/ny,y=-length-radius*ny,z=-radius*nz;
      const along=((y-a.y)*dy+(z-a.z)*dz)/(norm*norm);
      if(along>=-EPS&&along<=1+EPS)accept(length,y,z,ny,nz,'face');
    }
    if(Math.abs(a.z)<radius){const height=Math.sqrt(Math.max(0,radius*radius-a.z*a.z));
      accept(-a.y-height,a.y,a.z,height/radius,-a.z/radius,'edge');
    }
  }
  return best;
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
      for(let i=0;i<8;i++){
        const local=new Vec3((i&1?1:-1)*half.x,(i&2?1:-1)*half.y,(i&4?1:-1)*half.z),delta=shapeQ.vmult(local).vadd(origin).vsub(mount);
        vertices.push({x:delta.dot(right),y:delta.dot(up),z:delta.dot(forward)});
      }
      for(const station of [0,-halfWidth,halfWidth]){
        const polygon=section(vertices,station);if(polygon.length<3)continue;
        const support=circleSupport(polygon,radius,minLength,maxLength);
        if(support&&(!best||support.length<best.length-EPS))best={...support,station,body,shape,shapeQ,origin};
      }
    }
  }
  if(!best)return false;
  result.reset();result.hasHit=true;result.body=best.body;result.shape=best.shape;
  result.hitPointWorld.copy(mount.vadd(right.scale(best.station)).vadd(up.scale(best.y)).vadd(forward.scale(best.z)));
  result.hitNormalWorld.copy(up.scale(best.ny).vadd(forward.scale(best.nz)));result.hitNormalWorld.normalize();
  if(best.feature==='face'){
    const p=best.shapeQ.conjugate().vmult(result.hitPointWorld.vsub(best.origin)),half=best.shape.halfExtents;
    let face=null,distance=Infinity;
    for(const axis of ['x','y','z'])for(const sign of [-1,1]){
      const gap=Math.abs(p[axis]-sign*half[axis]),n=new Vec3();n[axis]=sign;best.shapeQ.vmult(n,n);
      if(n.dot(up)>.30&&(gap<distance-EPS||Math.abs(gap-distance)<EPS&&n.dot(up)>(face?.dot(up)??-1))){face=n;distance=gap;}
    }
    if(face&&distance<1e-6)result.hitNormalWorld.copy(face);
  }
  // distance remains the effective mount-to-support value expected by the
  // suspension code, not the Euclidean distance to this off-axis patch.
  result.distance=best.length+radius;
  result.wheelSupport={method:'circular-three-section',feature:best.feature,stationM:best.station,suspensionLengthM:best.length};
  return true;
}
