import * as THREE from './vendor/three.module.js';
import {SEAL_OUTLINE,SKIRT_MAX_EXTENSION,SKIRT_BASE_Y} from './vehicle-reference-layout-3.13.js';
import {vehicleProjectedPixels,chooseVehicleGeometryProfile,VEHICLE_INSPECTION_RIG} from './visual-presets.js';

/*
 * Roadster exterior study, independently reconstructed from Tesla's current public photographs.
 * This is an independently authored, parametric visual reconstruction, not an
 * OEM CAD model. Dimensions and the cutaway equipment are simulation assumptions.
 * Coordinate convention: metres, +X left when looking forward, +Y up, +Z forward; origin at the CG.
 */

const PI = Math.PI;
const TAU = PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const DOWN = new THREE.Vector3(0, -1, 0);
const geometryDetail = new WeakMap();
const QUALITY = Object.freeze({balanced:0,high:1,ultra:2});

// A profile replaces tessellation, never the physical outline or suspension
// state. Variants are built on demand once and reused across quality changes.
function detailGeometry(mesh,build) {
  geometryDetail.set(mesh,{build,cache:new Map([['high',mesh.geometry]])});
  return mesh;
}
function applyGeometryQuality(root,quality) {
  root.traverse(o=>{
    const detail=geometryDetail.get(o);if(!detail)return;
    if(!detail.cache.has(quality))detail.cache.set(quality,detail.build(quality));
    o.geometry=detail.cache.get(quality);
  });
}
const segmentsFor=(n,quality,minimum=3)=>quality==='balanced'?Math.max(minimum,Math.ceil(n*.45)):quality==='ultra'?Math.ceil(n*1.3):n;

// Shape-preserving cubic station interpolation. The old averaged slopes ran
// past local width/height extrema, producing extra shoulder/canopy lobes under
// long strip lights. Tangents remain C1; deliberate panel creases stay separate.
const stationTangents=new WeakMap();
function interpolate(keys,z){
  if(z<=keys[0][0])return keys[0][1];
  if(z>=keys[keys.length-1][0])return keys[keys.length-1][1];
  let tangents=stationTangents.get(keys);
  if(!tangents){
    const slopes=keys.slice(1).map((b,i)=>(b[1]-keys[i][1])/(b[0]-keys[i][0]));
    tangents=keys.map((_,i)=>{
      if(i===0)return slopes[0];if(i===keys.length-1)return slopes[slopes.length-1];
      const a=slopes[i-1],b=slopes[i];if(a*b<=0)return 0;
      const h0=keys[i][0]-keys[i-1][0],h1=keys[i+1][0]-keys[i][0],w0=2*h1+h0,w1=h1+2*h0;
      return(w0+w1)/(w0/a+w1/b);
    });
    stationTangents.set(keys,tangents);
  }
  for(let i=1;i<keys.length;i++)if(z<=keys[i][0]){
    const a=keys[i-1],b=keys[i],h=b[0]-a[0],t=(z-a[0])/h;
    return(2*t*t*t-3*t*t+1)*a[1]+(t*t*t-2*t*t+t)*tangents[i-1]*h
      +(-2*t*t*t+3*t*t)*b[1]+(t*t*t-t*t)*tangents[i]*h;
  }
}

const WIDTH = [[-2.30,.950],[-2.06,.995],[-1.42,1.047],[-.68,.988],[-.12,.971],[.55,.977],[1.42,1.034],[1.96,.947],[2.30,.855]];
const SHOULDER = [[-2.30,.225],[-2.02,.309],[-1.42,.350],[-.76,.330],[0,.307],[.73,.286],[1.42,.272],[1.95,.090],[2.30,-.026]];
const DECK = [[-2.30,.237],[-1.90,.306],[-1.48,.311],[.55,.265],[1.09,.228],[1.54,.154],[2.30,-.010]];
const widthAt = z => interpolate(WIDTH,z);
const shoulderAt = z => interpolate(SHOULDER,z) - .019;
export const VEHICLE_GEOMETRY = Object.freeze({
  tyreRadius:.372,frontTyreWidth:.265,rearTyreWidth:.284,
  wheelTrackHalf:.89,wheelbaseHalf:1.42,suspensionMountY:.06,
  suspensionMinimum:.24,suspensionMaximum:.41,maxSteer:.49,
  archCentreY:-.22,archLongRadius:.452,archVerticalRadius:.435,
  linerInnerX:.54,linerOuterX:1.040,
  model:'v9 / 3.13: preserved wedge sections, recessed service-lid joints, independently sorted glazing and layered projector covers; independent official-photo reconstruction, not OEM CAD',
  surfaceConstruction:'Shape-preserving longitudinal stations; feature-aligned transverse strips; no per-vertex wheel-arch uplift; analytic derivative normals',
  referenceRig:VEHICLE_INSPECTION_RIG.id
});
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function archCrown(z){
  let y=-1;
  for(const centre of [-1.42,1.42]){
    const d=(z-centre)/VEHICLE_GEOMETRY.archLongRadius;
    if(Math.abs(d)<1)y=Math.max(y,VEHICLE_GEOMETRY.archCentreY+VEHICLE_GEOMETRY.archVerticalRadius*Math.sqrt(1-d*d));
  }
  return y;
}
// The current official End / Pilot images show a nearly straight bonnet cut
// and a firm shoulder, not a raised blister above each front wheel. The 3.9
// function added a local soft maximum against an elliptical arch after forming
// the hood, which introduced a second curvature ridge. This single designed
// section clears the retained wheel sweep without a reactive vertex uplift.
const bonnetHalfWidthAt=z=>lerp(.718,.647,clamp((z-.80)/1.50,0,1));
function bodySection(z){
  const width=widthAt(z),crease=lerp(.66,bonnetHalfWidthAt(z)/width,smoothstep(.55,.82,z));
  return{width,crease,ridge:crease+.105,center:interpolate(DECK,z),shoulder:interpolate(SHOULDER,z)};
}
function bodySurfaceY(x,z){
  const {width,crease,ridge,center,shoulder}=bodySection(z),f=Math.abs(x)/width;
  const crown=.009,deck=center+crown*(1-(f/crease)**2);
  const risingFacet=lerp(center,shoulder,(f-crease)/(ridge-crease));
  const shoulderFacet=lerp(shoulder,shoulder-.019,(f-ridge)/(1-ridge));
  const panel=lerp(deck,risingFacet,smoothstep(crease-.006,crease+.006,f));
  return lerp(panel,shoulderFacet,smoothstep(ridge-.010,ridge+.010,f));
}
const fenderEdgeY=z=>Math.max(shoulderAt(z),bodySurfaceY(widthAt(z),z));
const sideSurfaceX=(z,y)=>{
  const t=clamp((fenderEdgeY(z)-y)/(fenderEdgeY(z)+.315),0,1);
  const door=Math.exp(-(((z+.03)/.89)**4)),haunch=Math.max(Math.exp(-(((z-1.42)/.48)**2)),Math.exp(-(((z+1.42)/.51)**2)));
  return widthAt(z)+.012*Math.sin(t*PI)+.009*haunch*Math.sin(t*PI)-.037*t*t-.020*door*Math.sin(t*PI)**2-.006*door*smoothstep(.50,.72,t);
};
// Read-only geometry specification lets the suspension acceptance test sample
// the same surface as the renderer, instead of duplicating an optimistic box.
export const sampleVehicleSurface=(x,z)=>({bodyY:bodySurfaceY(x,z),outerX:widthAt(z),archY:archCrown(z),linerInnerX:VEHICLE_GEOMETRY.linerInnerX,bonnetHalfWidth:bonnetHalfWidthAt(z),section:bodySection(z)});

function material(color, metalness = .0, roughness = .5, extras = {}) {
  return new THREE.MeshStandardMaterial({color, metalness, roughness, ...extras});
}

function addMesh(parent, geometry, mat, name = '') {
  const obj = new THREE.Mesh(geometry, mat);
  obj.name = name;
  obj.castShadow = true;
  obj.receiveShadow = true;
  parent.add(obj);
  return obj;
}

function setGraphNormals(mesh,sideSurface=0){
  const detail=geometryDetail.get(mesh);
  if(detail){
    const source=detail.build;
    detail.build=quality=>{const temp={geometry:source(quality)};setGraphNormals(temp,sideSurface);return temp.geometry;};
  }
  const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,delta=.0005,q=new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    if(sideSurface){
      const dy=(sideSurfaceX(z,y+delta)-sideSurfaceX(z,y-delta))/(2*delta),dz=(sideSurfaceX(z+delta,y)-sideSurfaceX(z-delta,y))/(2*delta);
      q.set(sideSurface,-dy,-dz).normalize();
    }else{
      const dx=(bodySurfaceY(x+delta,z)-bodySurfaceY(x-delta,z))/(2*delta),dz=(bodySurfaceY(x,z+delta)-bodySurfaceY(x,z-delta))/(2*delta);
      q.set(-dx,1,-dz).normalize();
    }
    n.setXYZ(i,q.x,q.y,q.z);
  }
  n.needsUpdate=true;
}

function gridGeometry(fn,nu,nv,reverse,analyticNormals=false) {
  const positions = [], uv = [], indices = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = fn(i / nu, j / nv);
      positions.push(...p);
      uv.push(i / nu, j / nv);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (reverse) indices.push(a,c,b,b,c,d); else indices.push(a,b,c,b,d,c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(indices);
  g.computeVertexNormals();
  if(analyticNormals){
    const normal=g.attributes.normal,du=new THREE.Vector3(),dv=new THREE.Vector3(),n=new THREE.Vector3(),delta=.00002;
    for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){
      const u=i/nu,v=j/nv,ua=clamp(u-delta,0,1),ub=clamp(u+delta,0,1),va=clamp(v-delta,0,1),vb=clamp(v+delta,0,1);
      const a=fn(ua,v),b=fn(ub,v),c=fn(u,va),d=fn(u,vb);
      du.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);dv.set(d[0]-c[0],d[1]-c[1],d[2]-c[2]);n.crossVectors(du,dv);
      if(n.lengthSq()>1e-24){n.normalize().multiplyScalar(reverse?-1:1);normal.setXYZ(j*(nu+1)+i,n.x,n.y,n.z);}
    }
  }
  return g;
}

function grid(parent, mat, fn, nu = 16, nv = 32, reverse = false, name = '', analyticNormals = false) {
  const smoothGlass=mat.isMeshPhysicalMaterial&&mat.transparent;
  const build=quality=>gridGeometry(fn,segmentsFor(nu,quality,Math.min(nu,3)),segmentsFor(nv,quality,Math.min(nv,6)),reverse,smoothGlass||analyticNormals);
  const mesh=addMesh(parent,build('high'),mat,name);
  // Seal vertices are physically deformed by all twenty independent lip
  // segments. Their topology stays fixed at every rendering profile.
  return parent.name==='surface-following perimeter seal'?mesh:detailGeometry(mesh,build);
}

function polygon(parent, points, mat, name = '', double = false) {
  const pos = points.flat(), idx = [];
  for (let i=1;i<points.length-1;i++) idx.push(0,i,i+1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx);g.computeVertexNormals();
  if (double) mat.side = THREE.DoubleSide;
  return addMesh(parent,g,mat,name);
}

function bonnetTriangle(parent,points,mat,offset,name){
  // A flat decal cuts through a curved hood between its three corners. Project
  // a tessellated triangle instead, maintaining clearance across the whole area.
  const positions=[],indices=[],lookup=new Map(),n=14;
  for(let i=0;i<=n;i++)for(let j=0;j<=n-i;j++){
    const a=i/n,b=j/n,c=1-a-b,x=points[0][0]*c+points[1][0]*a+points[2][0]*b,z=points[0][1]*c+points[1][1]*a+points[2][1]*b;
    lookup.set(`${i},${j}`,positions.length/3);positions.push(x,bodySurfaceY(x,z)+offset,z);
  }
  for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){
    const a=lookup.get(`${i},${j}`),b=lookup.get(`${i+1},${j}`),c=lookup.get(`${i},${j+1}`);indices.push(a,b,c);
    if(i+j<n-1)indices.push(b,lookup.get(`${i+1},${j+1}`),c);
  }
  // Mirroring the footprint reverses its geometric winding. Correct the
  // indices as well as the authored normals, so both outer covers face out.
  const footprintArea=(points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[1][1]-points[0][1])*(points[2][0]-points[0][0]);
  if(footprintArea>0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();const mesh=addMesh(parent,geometry,mat,name);setGraphNormals(mesh);return mesh;
}

const HEADLIGHTS=[-1,1].map(side=>[[side*.679,2.120],[side*.886,1.793],[side*.749,1.746]]);
// A 3.2 mm cut and 2.6 mm recess are authored scale assumptions, not OEM data.
// The painted mesh is really split at these slots; a dark raised tube no longer
// has to sit over unbroken paint to imitate a shut line.
export const BONNET_JOINT_SPEC=Object.freeze({widthM:.0032,depthM:.0026,longitudinalZM:[.8,2.30],transverseZM:1.0});
const jointHalf=BONNET_JOINT_SPEC.widthM/2;
const BONNET_JOINT_OPENINGS=[...[-1,1].map(side=>{
  const a=side*bonnetHalfWidthAt(.8),b=side*bonnetHalfWidthAt(2.3);
  return[[a-jointHalf,.7999],[b-jointHalf,2.3001],[b+jointHalf,2.3001],[a+jointHalf,.7999]];
}),[[-bonnetHalfWidthAt(1)-jointHalf,1-jointHalf],[bonnetHalfWidthAt(1)+jointHalf,1-jointHalf],
[bonnetHalfWidthAt(1)+jointHalf,1+jointHalf],[-bonnetHalfWidthAt(1)-jointHalf,1+jointHalf]]];

function independentTransparentPanel(mesh){
  // This Three revision sorts transparent objects by their transformed bounding
  // sphere centre, never by individual triangles. Preserve each optical panel
  // as one object so opposite views can reverse the pane order independently.
  mesh.geometry.computeBoundingSphere();mesh.userData.independentOpticalPanel=true;
  mesh.userData.sortAnchor='authored panel bounding sphere centre';return mesh;
}
function recessedBonnetJoint(parent,point,name,paint,seam,segments=64){
  const depth=BONNET_JOINT_SPEC.depthM;
  const sample=(t,offset,yDepth)=>{const [x,z,axis]=point(t),px=x+(axis==='x'?offset:0),pz=z+(axis==='z'?offset:0);return[px,bodySurfaceY(px,pz)-yDepth,pz];};
  const floor=grid(parent,seam,(u,v)=>sample(v,lerp(-jointHalf,jointHalf,u),depth),2,segments,false,name+' recessed floor');floor.castShadow=false;
  for(const side of [-1,1]){
    const wall=grid(parent,paint,(u,v)=>sample(v,side*(jointHalf-.00035*u),depth*u),2,segments,side<0,name+' painted edge return');wall.castShadow=false;
  }
}

function cutSurfaceOpenings(mesh,openings){
  // Clip the actual body mesh at each lamp perimeter. A black triangle resting
  // on top of paint cannot show a recessed housing / edge thickness correctly.
  const source=mesh.geometry,pos=source.attributes.position,norm=source.attributes.normal,uv=source.attributes.uv;
  const detail=geometryDetail.get(mesh);
  const positions=[],normals=[],uvs=[],indices=[],cache=new Map();
  const read=i=>[pos.getX(i),pos.getY(i),pos.getZ(i),norm.getX(i),norm.getY(i),norm.getZ(i),uv.getX(i),uv.getY(i)];
  const vertex=v=>{const key=v.slice(0,3).map(a=>Math.round(a*1e7)).join(',');if(cache.has(key))return cache.get(key);const i=positions.length/3,n=new THREE.Vector3(v[3],v[4],v[5]).normalize();positions.push(...v.slice(0,3));normals.push(n.x,n.y,n.z);uvs.push(v[6],v[7]);cache.set(key,i);return i;};
  const signed=(p,a,b)=>((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
  const split=(poly,a,b,sign)=>{
    const inside=[],outside=[];
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],d=signed(p,a,b)*sign,e=signed(q,a,b)*sign;
      (d>=-1e-10?inside:outside).push(p);
      if((d>1e-10&&e< -1e-10)||(d< -1e-10&&e>1e-10)){
        const f=d/(d-e),cross=p.map((v,k)=>lerp(v,q[k],f));inside.push(cross);outside.push(cross);
      }
    }
    return {inside,outside};
  };
  for(let i=0;i<source.index.count;i+=3){
    let polygons=[[read(source.index.getX(i)),read(source.index.getX(i+1)),read(source.index.getX(i+2))]];
    for(const hole of openings){
      const sign=Math.sign((hole[1][0]-hole[0][0])*(hole[2][1]-hole[0][1])-(hole[1][1]-hole[0][1])*(hole[2][0]-hole[0][0]));
      const output=[];
      for(const polygon of polygons){let remaining=polygon;for(let edge=0;edge<hole.length&&remaining.length>=3;edge++){
        const pieces=split(remaining,hole[edge],hole[(edge+1)%hole.length],sign);if(pieces.outside.length>=3)output.push(pieces.outside);remaining=pieces.inside;
      }}
      polygons=output;
    }
    for(const polygon of polygons)for(let j=1;j<polygon.length-1;j++){
      const a=polygon[0],b=polygon[j],c=polygon[j+1];
      if(Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))<1e-12)continue;
      indices.push(vertex(a),vertex(b),vertex(c));
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeBoundingSphere();source.dispose();mesh.geometry=g;
  mesh.userData.hasRecessedLampOpenings=true;
  if(detail){
    const build=detail.build;
    detailGeometry(mesh,quality=>{const proxy={geometry:build(quality),userData:{}};cutSurfaceOpenings(proxy,openings);return proxy.geometry;});
  }
}

function recessedLamp(parent,outline,materials){
  const cx=outline.reduce((s,p)=>s+p[0],0)/3,cz=outline.reduce((s,p)=>s+p[1],0)/3;
  const inner=outline.map(([x,z])=>[lerp(cx,x,.91),lerp(cz,z,.91)]);
  for(let edge=0;edge<3;edge++){
    const a=outline[edge],b=outline[(edge+1)%3],ia=inner[edge],ib=inner[(edge+1)%3];
    const rim=grid(parent,materials.black,(u,v)=>{const x=lerp(lerp(a[0],b[0],v),lerp(ia[0],ib[0],v),u),z=lerp(lerp(a[1],b[1],v),lerp(ia[1],ib[1],v),u);return[x,bodySurfaceY(x,z)-u*.025,z];},4,24,false,'recessed headlamp bevel');rim.castShadow=false;
  }
  const floor=bonnetTriangle(parent,inner,materials.black,-.025,'triangular headlight housing');floor.castShadow=false;
  // Small optical cells sit below the cover in black sockets. The former
  // five large coplanar white rectangles read as a striped sticker in the
  // captured front-light close-up. These are illustrative projector internals,
  // not a claim about the unexposed Tesla optical assembly.
  for(let j=0;j<3;j++){
    const along=.22+j*.28,back=[lerp(inner[2][0],inner[1][0],along),lerp(inner[2][1],inner[1][1],along)];
    const x=lerp(back[0],inner[0][0],.14),z=lerp(back[1],inner[0][1],.14),delta=.0005;
    const normal=new THREE.Vector3(-(bodySurfaceY(x+delta,z)-bodySurfaceY(x-delta,z))/(2*delta),1,-(bodySurfaceY(x,z+delta)-bodySurfaceY(x,z-delta))/(2*delta)).normalize();
    const cell=new THREE.Group();cell.position.set(x,bodySurfaceY(x,z)-.021,z);cell.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);parent.add(cell);
    cylinder(cell,.0165,.0155,.013,materials.black,[0,0,0],'z',18,'recessed projector socket');
    ring(cell,.0125,.002,materials.chrome,[0,0,.006],'z',22,'projector reflector bevel');
    const emitter=addMesh(cell,new THREE.CircleGeometry(.0105,20),materials.lampEmitter,'individual LED projector');emitter.position.z=.0065;emitter.castShadow=false;
    const dome=addMesh(cell,new THREE.SphereGeometry(.012,16,6,0,TAU,0,PI/2),materials.lens,'convex projector optic');
    dome.rotation.x=PI/2;dome.scale.y=.22;dome.position.z=.008;dome.castShadow=false;
  }
  // A thin clear cover meets a narrow dark perimeter land. It is separately
  // sorted from the six internal optics and sits flush instead of 2.5 mm proud.
  for(let edge=0;edge<3;edge++){
    const a=outline[edge],b=outline[(edge+1)%3];
    const lip=grid(parent,materials.seam,(u,v)=>{const x=lerp(a[0],b[0],v),z=lerp(a[1],b[1],v),k=u*.012;return[lerp(x,cx,k),bodySurfaceY(x,z)+.0002,lerp(z,cz,k)];},2,24,false,'headlamp cover perimeter land');lip.castShadow=false;
  }
  const lens=independentTransparentPanel(bonnetTriangle(parent,outline,materials.coverLens,.0004,'flush clear headlamp cover'));lens.castShadow=false;
}

function curve(parent, points, radius, mat, name = '', smooth = true) {
  const p = points.map(p => new THREE.Vector3(...p));
  const path = smooth ? new THREE.CatmullRomCurve3(p,false,'centripetal') : new THREE.CurvePath();
  if (!smooth) for (let i=1;i<p.length;i++) path.add(new THREE.LineCurve3(p[i-1],p[i]));
  const base=Math.max(8,Math.min(224,Math.ceil(points.length*1.2)));
  const build=quality=>new THREE.TubeGeometry(path,segmentsFor(base,quality,Math.min(base,8)),radius,quality==='balanced'?3:quality==='ultra'?7:5,false);
  return detailGeometry(addMesh(parent,build('high'),mat,name),build);
}

function cylinder(parent,r1,r2,h,mat,p=[0,0,0],axis='y',segments=32,name='') {
  const build=quality=>new THREE.CylinderGeometry(r1,r2,h,segmentsFor(segments,quality,8),1,false);
  const m=detailGeometry(addMesh(parent,build('high'),mat,name),build);
  m.position.set(...p);
  if(axis==='x')m.rotation.z=PI/2;
  if(axis==='z')m.rotation.x=PI/2;
  return m;
}

function ring(parent,r,t,mat,p=[0,0,0],axis='x',segments=56,name='') {
  const build=quality=>new THREE.TorusGeometry(r,t,quality==='balanced'?3:quality==='ultra'?8:t<.006?4:6,segmentsFor(segments,quality,12));
  const m=detailGeometry(addMesh(parent,build('high'),mat,name),build);
  m.position.set(...p);
  if(axis==='x')m.rotation.y=PI/2;
  if(axis==='y')m.rotation.x=PI/2;
  return m;
}

function roundedBoxGeometry(w,h,d,r=.025,segments=3) {
  const g=new THREE.BoxGeometry(w,h,d,segments,segments,segments);
  const p=g.attributes.position,n=g.attributes.normal;
  const q=new THREE.Vector3(),delta=new THREE.Vector3();
  for(let i=0;i<p.count;i++) {
    q.set(clamp(p.getX(i),-w/2+r,w/2-r),clamp(p.getY(i),-h/2+r,h/2-r),clamp(p.getZ(i),-d/2+r,d/2-r));
    delta.set(p.getX(i)-q.x,p.getY(i)-q.y,p.getZ(i)-q.z).normalize();
    p.setXYZ(i,q.x+delta.x*r,q.y+delta.y*r,q.z+delta.z*r);
    n.setXYZ(i,delta.x,delta.y,delta.z);
  }
  return g;
}

function box(parent,w,h,d,mat,p=[0,0,0],r=.02,name='') {
  const build=quality=>roundedBoxGeometry(w,h,d,Math.min(r,w/2,h/2,d/2),quality==='balanced'?2:3);
  const m=detailGeometry(addMesh(parent,build('high'),mat,name),build);
  m.position.set(...p);return m;
}

function carbonTexture() {
  const size=64, data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const a=((Math.floor(x/4)+Math.floor(y/4))%4)<2;
    const f=a ? (x%4)/3 : (y%4)/3;
    const k=190+Math.round(18*Math.sin(f*PI))+(((x*17+y*29)%11)-5)*.35;
    const i=(y*size+x)*4;data[i]=k;data[i+1]=k+2;data[i+2]=k+3;data[i+3]=255;
  }
  const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  t.needsUpdate=true;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(14,14);t.colorSpace=THREE.SRGBColorSpace;
  t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;
  t.anisotropy=4;return t;
}

function solidXZ(parent,outline,thickness,y,mat,name='') {
  const shape=new THREE.Shape();outline.forEach((p,i)=>i?shape.lineTo(...p):shape.moveTo(...p));shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelThickness:.004,bevelSize:.006,bevelSegments:1,steps:1});
  const m=addMesh(parent,g,mat,name);m.rotation.x=PI/2;m.position.y=y;return m;
}

function solidWheelFacet(parent,outline,thickness,x,side,mat,name){
  const shape=new THREE.Shape();outline.forEach(([y,z],i)=>i?shape.lineTo(-side*z,y):shape.moveTo(-side*z,y));shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelSize:.0015,bevelThickness:.0015,bevelSegments:2,steps:1});
  const mesh=addMesh(parent,g,mat,name);mesh.rotation.y=side*PI/2;mesh.position.x=x;return mesh;
}

function vectorLabel(parent,text,height,mat,position,reverse=false) {
  // Small machined lettering is geometric so the vehicle remains self contained.
  const alphabet={
    R:[[[0,0],[0,1],[.55,1],[.68,.86],[.68,.61],[.53,.48],[0,.48]],[[.32,.48],[.72,0]]],
    D:[[[0,0],[0,1],[.46,1],[.7,.79],[.7,.2],[.48,0],[0,0]]],
    S:[[[.68,.9],[.52,1],[.13,1],[0,.85],[0,.61],[.15,.51],[.54,.49],[.69,.35],[.69,.15],[.52,0],[.12,0],[0,.1]]],
    T:[[[0,1],[.76,1]],[[.38,1],[.38,0]]],
    E:[[[.67,1],[0,1],[0,0],[.67,0]],[[0,.51],[.54,.51]]],
    L:[[[0,1],[0,0],[.7,0]]],
    A:[[[0,0],[.36,1],[.72,0]],[[.17,.43],[.55,.43]]]
  };
  const total=text.length*.91*height;
  [...text].forEach((letter,j)=>(alphabet[letter]||[]).forEach(stroke=>{
    curve(parent,stroke.map(([x,y])=>[(j*.91+x)*height-total/2+position[0],y*height+position[1],position[2]]),height*.024,mat,'letter-'+letter,false);
  }));
  if(reverse)parent.scale.x=-1;
}

function combineGeometries(geometries) {
  let count=0,indexCount=0;
  for(const g of geometries){count+=g.attributes.position.count;indexCount+=g.index?.count||g.attributes.position.count;}
  const positions=new Float32Array(count*3),normals=new Float32Array(count*3),uvs=new Float32Array(count*2);
  const indices=count<65536?new Uint16Array(indexCount):new Uint32Array(indexCount);
  let offset=0,io=0;
  for(const g of geometries){
    positions.set(g.attributes.position.array,offset*3);
    if(g.attributes.normal)normals.set(g.attributes.normal.array,offset*3);
    if(g.attributes.uv)uvs.set(g.attributes.uv.array,offset*2);
    if(g.index)for(let i=0;i<g.index.count;i++)indices[io++]=g.index.getX(i)+offset;
    else for(let i=0;i<g.attributes.position.count;i++)indices[io++]=i+offset;
    offset+=g.attributes.position.count;g.dispose();
  }
  const combined=new THREE.BufferGeometry();
  combined.setAttribute('position',new THREE.BufferAttribute(positions,3));combined.setAttribute('normal',new THREE.BufferAttribute(normals,3));combined.setAttribute('uv',new THREE.BufferAttribute(uvs,2));combined.setIndex(new THREE.BufferAttribute(indices,1));combined.computeBoundingSphere();
  return combined;
}

function mergeStaticMeshes(parent,recursive=true,keep=new Set()) {
  // A material batch owns the builders of its original parts. A lower detail
  // mesh therefore stays one draw call instead of rebuilding hundreds of parts.
  parent.updateWorldMatrix(true,true);
  const inverse=parent.matrixWorld.clone().invert(),byMaterial=new Map();
  const visit=obj=>{
    if(!obj.isMesh||Array.isArray(obj.material)||keep.has(obj)||obj.userData.independentOpticalPanel)return;
    if(!byMaterial.has(obj.material))byMaterial.set(obj.material,[]);
    byMaterial.get(obj.material).push(obj);
  };
  if(recursive)parent.traverse(visit);else [...parent.children].forEach(visit);
  for(const [mat,objects] of byMaterial){
    if(objects.length<2)continue;
    const parts=objects.map(o=>({
      transform:new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld),
      geometry:o.geometry,
      build:geometryDetail.get(o)?.build,
    }));
    const build=quality=>combineGeometries(parts.map(p=>(p.build?p.build(quality):p.geometry.clone()).applyMatrix4(p.transform)));
    const combined=combineGeometries(parts.map(p=>p.geometry.clone().applyMatrix4(p.transform)));
    const names=objects.flatMap(o=>[o.name,...o.userData.parts||[]]);
    const cast=objects.some(o=>o.castShadow),receive=objects.some(o=>o.receiveShadow);
    objects.forEach(o=>{o.removeFromParent();o.geometry.dispose();});
    const mesh=detailGeometry(addMesh(parent,combined,mat,names[0]),build);mesh.userData.parts=names;mesh.castShadow=cast;mesh.receiveShadow=receive;
  }
}

function buildWheel(parent,side,z,materials) {
  const assembly=new THREE.Group();assembly.name=(z>0?'front':'rear')+(side<0?'-right':'-left');
  assembly.position.set(side*.89,-.22,z);parent.add(assembly);
  const spin=new THREE.Group();assembly.add(spin);
  const w=z>0?.265:.284,half=w/2;
  const profile=[ [.285,-half+.006],[.324,-half-.001],[.354,-half+.011],[.367,-half+.031] ];
  for(let i=0;i<=60;i++){
    const a=lerp(-half+.040,half-.040,i/60),edge=Math.abs(a)/(half-.040);
    let radius=.372-.004*edge**4;
    for(const groove of [-.060,0,.060])radius-=.0036*Math.exp(-(((a-groove)/.0032)**4));
    profile.push([radius,a]);
  }
  profile.push([.367,half-.031],[.354,half-.011],[.324,half+.001],[.285,half-.006],[.285,-half+.006]);
  const buildTyre=quality=>{
    const crossSection=quality==='balanced'?profile.filter((p,i)=>i<4||i>=profile.length-5||(i-4)%5===0):profile;
    const g=new THREE.LatheGeometry(crossSection.map(([r,a])=>new THREE.Vector2(r,a)),quality==='balanced'?48:quality==='ultra'?160:112);g.normalizeNormals();return g;
  };
  const tire=detailGeometry(addMesh(spin,buildTyre('high'),materials.rubber,'performance tire'),buildTyre);tire.rotation.z=PI/2;
  tire.userData={role:'tyre-contact-envelope',radiusMetres:.372,widthMetres:w};
  const face=side*(half+.002);
  const sidewall=materials.sidewall;
  ring(spin,.337,.0025,sidewall,[face,0,0]);ring(spin,.354,.0016,sidewall,[face-side*.009,0,0]);
  // Thin, angled tread sipes. They are geometry, not a repeating picture.
  const tread=[];
  for(const offset of [-.064,0,.064])for(let i=0;i<56;i++) {
    const a=i/56*TAU,b=(i+1)/56*TAU;
    tread.push(offset,Math.cos(a)*.3723,Math.sin(a)*.3723,offset,Math.cos(b)*.3723,Math.sin(b)*.3723);
  }
  for(let j=0;j<44;j++)for(const band of [-1,1]) {
    const a=j/44*TAU;
    for(let k=0;k<2;k++) {
      const ax=band*(.035+k*.067),theta=a+k*.048;
      tread.push(ax,Math.cos(theta)*.3725,Math.sin(theta)*.3725);
    }
  }
  const tg=new THREE.BufferGeometry();tg.setAttribute('position',new THREE.Float32BufferAttribute(tread,3));
  const tl=new THREE.LineSegments(tg,new THREE.LineBasicMaterial({color:0x090b0d}));tl.name='submillimetre tread sipes';spin.add(tl);
  cylinder(spin,.294,.294,.19,materials.wheelBarrel,[0,0,0],'x',56,'forged rim barrel');
  cylinder(spin,.249,.249,.017,materials.rotor,[side*(half-.04),0,0],'x',48,'ventilated brake rotor');
  for(let i=0;i<24;i++) {
    const angle=i*TAU/24;
    const hole=addMesh(spin,new THREE.CircleGeometry(.006,6),materials.seam,'rotor drill hole');
    hole.position.set(side*(half-.029),Math.cos(angle)*.211,Math.sin(angle)*.211);hole.rotation.y=side*PI/2;
    hole.castShadow=false;
  }
  // Five split spokes and broad silver aero surfaces match the 2026 wheel study.
  for(let j=0;j<5;j++) {
    const root=new THREE.Group();root.rotation.x=j*TAU/5;spin.add(root);
    const a=face+side*.004;
    solidWheelFacet(root,[[.065,-.029],[.274,-.052],[.293,-.027],[.281,.029],[.09,.034]],.022,a-side*.020,side,materials.wheelDark,'forged main spoke');
    solidWheelFacet(root,[[.084,.008],[.224,.111],[.243,.135],[.276,.108],[.132,.002]],.018,a-side*.019,side,materials.wheelDark,'forked spoke');
    // A shallow continuous radial dish connects hub and rim. The original
    // constant-depth extruded silver triangles remained visually flat despite
    // more bevel triangles. Four/three transverse samples suffice here because
    // the boundary and derivative normals follow the authored curved surface.
    const sector=(u,v)=>{
      const angle=lerp(lerp(.31,.12,v),lerp(1.18,1.02,v),u),r=lerp(.103,.282,v);
      const depth=.010+.030*(1-v)**1.5-.004*Math.sin(u*PI)*Math.sin(v*PI);
      return[a-side*depth,r*Math.cos(angle),r*Math.sin(angle)];
    };
    grid(root,materials.wheelSilver,sector,5,10,side<0,'continuous dished aero facet',true);
    for(const end of [0,1])grid(root,materials.wheelDark,(u,v)=>{const p=sector(end,v);p[0]-=side*u*.008;return p;},2,10,side* (end?1:-1)>0,'aero sector folded return',true);
    grid(root,materials.wheelDark,(u,v)=>{const p=sector(v,1);p[0]-=side*u*.008;return p;},2,5,side<0,'aero sector rim return',true);
    curve(root,[[a+side*.002,.097,-.011],[a+side*.002,.268,-.025]],.0029,materials.wheelSilver,'machined spoke edge',false);
    cylinder(root,.011,.011,.014,materials.chrome,[a+side*.002,.047*Math.cos(.25),.047*Math.sin(.25)],'x',8,'wheel bolt');
  }
  ring(spin,.290,.0105,materials.wheelDark,[face-side*.002,0,0]);
  ring(spin,.296,.0034,materials.wheelSilver,[face-side*.003,0,0]);
  cylinder(spin,.061,.061,.017,materials.wheelDark,[face+side*.006,0,0],'x',28,'hub cap');
  // Calipers stay with the upright rather than rotating with the rim.
  const caliper=box(assembly,.055,.145,.085,materials.caliper,[side*(half-.057),.061,-.187],.019,'brake caliper');
  caliper.rotation.x=.25;
  mergeStaticMeshes(spin);
  return {assembly,spin,side,z,tire,tyreProfile:profile.map(p=>[...p])};
}

function buildSuspension(parent,wheel,materials){
  const group=new THREE.Group();group.name=wheel.assembly.name+' pushrod suspension reconstruction';parent.add(group);
  const links=[];
  function rod(name,a,b,r,mat){
    const mesh=cylinder(group,r,r,1,mat,[0,0,0],'y',12,name);links.push({mesh,a,b});
  }
  const s=wheel.side,z=wheel.z;
  for(const upper of [false,true])for(const fore of [-1,1]){
    const y=upper?-.075:-.255;
    rod(upper?'upper wishbone':'lower wishbone',[s*.53,y,z+fore*.20],{x:s*.85,dy:upper?.105:-.095,dz:fore*.025},upper?.014:.018,materials.carbon);
  }
  rod('titanium pushrod',[s*.61,.105,z-.09],{x:s*.84,dy:-.08,dz:.018},.012,materials.chrome);
  rod('steering tie rod',[s*.54,-.12,z+.15],{x:s*.855,dy:.008,dz:.12},.010,materials.nozzle);
  // Public suspension photograph shows an inboard horizontal coil-over. The
  // exact rocker ratio / pivot coordinates here are an engineering layout.
  const springRoot=new THREE.Group();springRoot.position.set(s*.39,.09,z-.08);springRoot.rotation.z=PI/2;group.add(springRoot);
  cylinder(springRoot,.044,.044,.40,materials.black,[0,0,0],'y',28,'inboard damper body');
  cylinder(springRoot,.019,.019,.46,materials.chrome,[0,0,0],'y',20,'damper shaft');
  const points=[];for(let i=0;i<=224;i++){const t=i/224,a=t*TAU*8;points.push([.061*Math.cos(a),lerp(-.17,.17,t),.061*Math.sin(a)]);}
  curve(springRoot,points,.0084,materials.damper,'gold inboard coil spring',false);
  for(const y of [-.185,.185])cylinder(springRoot,.071,.071,.018,materials.nozzle,[0,y,0],'y',28,'spring perch');
  mergeStaticMeshes(springRoot);
  const from=new THREE.Vector3(),to=new THREE.Vector3(),delta=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  function update(){
    for(const link of links){
      from.set(...link.a);const p=link.b;
      const angle=wheel.assembly.rotation.y,c=Math.cos(angle),s=Math.sin(angle),dx=p.x-wheel.assembly.position.x;
      to.set(wheel.assembly.position.x+dx*c+p.dz*s,wheel.assembly.position.y+p.dy,z-dx*s+p.dz*c);
      delta.copy(to).sub(from);link.mesh.position.copy(from).add(to).multiplyScalar(.5);link.mesh.scale.y=delta.length();link.mesh.quaternion.setFromUnitVectors(up,delta.normalize());
    }
    springRoot.scale.y=clamp(1+((.06-wheel.assembly.position.y)-.287)*1.4,.91,1.17);
  }
  update();return {group,update};
}

function buildCockpit(cabin,mats){
  box(cabin,1.40,.026,1.67,mats.interior,[0,-.095,-.18],.015,'continuous cabin floor');
  box(cabin,1.38,.30,.075,mats.interior,[0,.066,-.75],.025,'cockpit rear bulkhead');
  const cx=-.36;
  box(cabin,.39,.065,.48,mats.interior,[cx,-.055,-.15],.028,'sculpted bucket seat shell');
  const cushion=(u,v)=>[cx+u*.204,-.018+.042*Math.abs(u)**3+.009*Math.cos(v*PI),lerp(.080,-.360,v)];
  const back=(u,v)=>{
    const w=.198-.066*smoothstep(.66,1,v),y=lerp(.015,.495,v),z=-.365-.187*v+.043*u*u;
    return[cx+u*w,y,z];
  };
  for(const [a,b,mat] of [[-1,-.67,mats.interiorTrim],[-.67,.67,mats.upholstery],[.67,1,mats.interiorTrim]]){
    grid(cabin,mat,(u,v)=>cushion(lerp(a,b,u),v),12,20,false,'bucket seat contoured cushion');
    grid(cabin,mat,(u,v)=>back(lerp(a,b,u),v),12,28,false,'bucket seat sculpted backrest');
  }
  for(const side of [-1,1]){
    const seam=[];for(let i=0;i<=32;i++){const p=back(side*.67,i/32);p[2]+=.0015;seam.push(p);}curve(cabin,seam,.0008,mats.stitch,'seat bolster stitch');
    const strap=grid(cabin,mats.black,(u,v)=>{
      const y=lerp(.415,.015,v),x=cx+side*.078+lerp(-.014,.014,u),z=lerp(-.506,-.134,v)+.003;
      return[x,y,z];
    },2,14,false,'flat woven shoulder harness');strap.material.side=THREE.DoubleSide;
  }
  box(cabin,.046,.020,.036,mats.chrome,[cx,.010,-.125],.005,'harness quick release buckle');
  for(const side of [-1,1]){
    grid(cabin,mats.interior,(u,v)=>{
      const z=lerp(.49,-.72,v),y=lerp(-.025,.238,u),x=side*(.748+.018*Math.sin(v*PI)-.018*Math.sin(u*PI));return[x,y,z];
    },8,24,side<0,'sculpted inner door card');
    curve(cabin,[[side*.745,.205,.43],[side*.746,.187,-.15],[side*.733,.143,-.61]],.020,mats.interiorTrim,'door armrest insert');
    curve(cabin,[[side*.744,.186,.39],[side*.744,.167,-.14],[side*.732,.122,-.59]],.0021,mats.cabinRed,'subtle red door ambient strip');
    box(cabin,.021,.021,.070,mats.chrome,[side*.734,.153,-.33],.004,'interior door release');
  }
  const dash=box(cabin,1.42,.10,.25,mats.upholstery,[0,.192,.48],.040,'stitched dashboard brow');dash.rotation.x=.06;
  box(cabin,1.34,.011,.030,mats.black,[0,.164,.338],.004,'full width dash ventilation slot');
  for(const side of [-1,1])box(cabin,.19,.014,.033,mats.carbon,[side*.53,.163,.332],.004,'flush dash air vent');
  for(const side of [-1,1]){
    const instrument=new THREE.Group();instrument.position.set(side*.51,.272,.429);instrument.rotation.x=-.15;cabin.add(instrument);
    box(instrument,.205,.072,.013,mats.black,[0,0,0],.007,'forward auxiliary display bezel');
    box(instrument,.190,.058,.002,mats.screen,[0,0,-.008],.003,'forward auxiliary driving display');
  }
  box(cabin,.203,.072,.328,mats.interior,[0,.058,.08],.020,'sculpted centre console');
  const screen=new THREE.Group();screen.position.set(0,.293,.299);screen.rotation.x=-.11;cabin.add(screen);
  box(screen,.322,.207,.016,mats.black,[0,0,0],.008,'landscape cabin display housing');
  box(screen,.306,.190,.003,mats.screen,[0,0,-.010],.004,'landscape cabin display glass');
  for(const y of [-.063,-.049,-.035])box(screen,.086,.002,.001,mats.screenInk,[-.084,y,-.013],.0004,'display status line');
  curve(screen,[[-.043,-.007,-.014],[-.034,.015,-.014],[.007,.032,-.014],[.069,.030,-.014],[.099,.007,-.014],[.100,-.014,-.014],[-.043,-.014,-.014]],.0018,mats.screenInk,'display vehicle profile',false);
  const steering=new THREE.Group();steering.name='squared steering yoke';steering.position.set(cx,.267,.212);steering.rotation.x=-.10;cabin.add(steering);
  const rim=[[-.115,.045,0],[-.117,-.053,0],[-.090,-.080,0],[.090,-.080,0],[.117,-.053,0],[.115,.045,0],[.083,.072,0],[-.083,.072,0],[-.115,.045,0]];
  curve(steering,rim,.012,mats.interior,'squared steering rim');
  box(steering,.134,.077,.033,mats.interior,[0,-.007,0],.020,'steering airbag and controls');
  for(const side of [-1,1]){
    box(steering,.053,.012,.016,mats.chrome,[side*.073,.012,-.012],.003,'steering spoke trim');
    cylinder(steering,.012,.012,.006,mats.black,[side*.078,.025,-.024],'z',16,'steering scroll control');
  }
  // Attach the mirror below the windscreen. Its old .612 m anchor at
  // z=.250 pierced the glass canopy and appeared as an exterior black lump.
  curve(cabin,[[0,.575,.150],[0,.525,.150]],.004,mats.black,'rear view mirror stalk',false);
  box(cabin,.150,.050,.021,mats.black,[0,.505,.150],.009,'frameless interior mirror');
  box(cabin,.135,.036,.002,mats.chrome,[0,.505,.137],.007,'mirror reflective glass');
}

function sealOutline(){
  // Front and rear wheel / thrust ducts stay outside the sealed volume.
  return SEAL_OUTLINE.map(p=>[...p]);
}

function buildPressureChamber(parent,materials){
  const root=new THREE.Group();root.name='sealed low-pressure chamber — independent engineering reconstruction';parent.add(root);
  const outline=sealOutline(),roof=solidXZ(root,outline,.027,-.299,materials.undertray,'continuous airtight chamber roof');
  // Continuous roof, isolated wheelhouses, flexible sidewall and a lower seal
  // form one chamber. The lower face is deliberately open to the road surface.
  const skirt=new THREE.Group();skirt.name='surface-following perimeter seal';skirt.position.y=-.326;root.add(skirt);
  const outer=[],inner=[];
  for(const [x,z] of outline){outer.push([x,z]);inner.push([x-Math.sign(x)*.016,z-Math.sign(z)*.010]);}
  const sample=(points,v)=>{const t=(v>=1?0:v)*points.length,i=Math.floor(t),f=t-i;return[lerp(points[i][0],points[(i+1)%points.length][0],f),lerp(points[i][1],points[(i+1)%points.length][1],f)];};
  for(const [points,reverse] of [[outer,false],[inner,true]])grid(skirt,materials.seal,(u,v)=>{
    const [x,z]=sample(points,v);return[x,-.255*u,z];
  },4,outline.length*3,reverse,'continuous flexible seal sidewall');
  grid(skirt,materials.seal,(u,v)=>{const a=sample(outer,v),b=sample(inner,v);return[lerp(a[0],b[0],u),-.255,lerp(a[1],b[1],u)];},2,outline.length*3,false,'replaceable ground seal lip');
  for(const [x,z] of outline){
    if(Math.abs(x)<.51)continue;
    cylinder(root,.012,.012,.006,materials.chrome,[x,-.296,z],'y',8,'undertray captive fastener');
  }
  for(const z of [-1.73,-1.13,-.72,-.24,.24,.72,1.13,1.73]){
    const width=Math.abs(z)>1?.86:1.30;
    const rib=box(root,width,.010,.017,materials.carbon,[0,-.331,z],.004,'undertray pressed stiffening bead');rib.castShadow=false;
    for(const x of [-width/2,width/2]){
      const screw=cylinder(root,.009,.009,.004,materials.chrome,[x,-.337,z],'y',8,'flush titanium access fastener');screw.castShadow=false;
    }
  }
  for(const x of [-.37,.37])for(const z of [-.68,.68]){
    const grille=box(root,.215,.008,.25,materials.black,[x,-.337,z],.017,'extraction intake grille');grille.castShadow=false;
    for(let i=0;i<8;i++){
      const louvre=box(root,.188,.006,.009,materials.nozzle,[x,-.344,z-.092+i*.026],.002,'protected intake louvre');louvre.castShadow=false;
    }
  }
  // Independent exhaust / extraction galleries: no daylight through the roof.
  for(const s of [-1,1]){
    const path=[[s*.39,-.267,-.65],[s*.39,-.245,-1.43],[s*.44,-.165,-1.87],[s*.48,-.22,-2.29]];
    curve(root,path,.049,materials.black,'sealed extraction gallery');
    for(const z of [-1.42,1.42]){
      ring(root,.093,.010,materials.nozzle,[s*.59,-.324,z],'y',32,'isolated thrust duct flange');
      cylinder(root,.092,.078,.053,materials.black,[s*.59,-.296,z],'y',32,'sealed thrust duct collar');
    }
  }
  mergeStaticMeshes(root,false,new Set([roof]));
  for(const mesh of root.children)if(mesh.isMesh&&mesh!==roof)mesh.castShadow=false;
  let area=0;outline.forEach(([x,z],i)=>{const next=outline[(i+1)%outline.length];area+=x*next[1]-next[0]*z;});
  root.userData={concept:'independent pressure chamber reconstruction, not a published Tesla underbody drawing',projectedAreaM2:Math.abs(area)/2,effectiveSimulationAreaM2:4.8,roofY:-.299,sealNominalExtendedY:-.581,sealExtendedY:SKIRT_BASE_Y-SKIRT_MAX_EXTENSION,wheelAndJetDuctsIsolated:true,perimeterXZ:outline.map(p=>[...p])};
  skirt.scale.y=1;
  const deformed=skirt.children.filter(o=>o.isMesh&&o.geometry.attributes.position);
  root.userData.sealMaximumExtension=SKIRT_MAX_EXTENSION;
  root.userData.sealGeometryUpdates=0;
  const lastExtensions=new Float64Array(outline.length).fill(NaN),extensions=new Float64Array(outline.length);
  const q=new THREE.Quaternion(),p=new THREE.Vector3(),down=new THREE.Vector3(),origin=new THREE.Vector3(),point=new THREE.Vector3(),normal=new THREE.Vector3();
  for(const mesh of deformed){
    mesh.geometry.computeBoundingBox();mesh.geometry.boundingBox.min.y=-SKIRT_MAX_EXTENSION;mesh.geometry.boundingBox.max.y=0;
    mesh.geometry.boundingSphere=mesh.geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  }
  return {root,roof,skirt,update(t,dt){
    const near=t.contactCount>0||(t.sealQuality||0)>.025;
    const fallback=t.suctionEnabled&&near?.255:.074;
    for(let i=0;i<extensions.length;i++)extensions[i]=Number.isFinite(t.sealLipExtensions?.[i])?clamp(t.sealLipExtensions[i],.04,SKIRT_MAX_EXTENSION):fallback;
    if(t.sealLipContacts&&t.position&&t.quaternion){
      q.set(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w);p.set(t.position.x,t.position.y,t.position.z);down.set(0,-1,0).applyQuaternion(q);
      outline.forEach(([x,z],i)=>{const contact=t.sealLipContacts[i];if(!contact)return;origin.set(x,SKIRT_BASE_Y,z).applyQuaternion(q).add(p);point.set(contact.point.x,contact.point.y,contact.point.z);normal.set(contact.normal.x,contact.normal.y,contact.normal.z);const denom=down.dot(normal);if(Math.abs(denom)>.3){const renderedDistance=point.sub(origin).dot(normal)/denom;extensions[i]=clamp(extensions[i]+renderedDistance-contact.distance,.04,SKIRT_MAX_EXTENSION);}});
    }
    skirt.userData.extensionMetres=Math.max(...extensions);
    if(extensions.every((e,i)=>Math.abs(e-lastExtensions[i])<1e-7))return;
    lastExtensions.set(extensions);root.userData.sealGeometryUpdates++;
    for(const mesh of deformed){const attr=mesh.geometry.attributes.position,rows=outline.length*3,width=attr.count/(rows+1),isLip=mesh.name.includes('replaceable');
      for(let j=0;j<=rows;j++){const sample=(j/rows*outline.length)%outline.length,a=Math.floor(sample),f=sample-a,e=lerp(extensions[a],extensions[(a+1)%extensions.length],f);for(let i=0;i<width;i++)attr.setY(j*width+i,-e*(isLip?1:i/(width-1)));}
      attr.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
  }};
}

function nozzleGeometry(parent,materials,name) {
  const root=new THREE.Group();root.name=name;parent.add(root);
  const profile=[ [.071,0],[.071,.012],[.062,.021],[.043,.082],[.039,.095],[.029,.095],[.032,.080],[.054,.016],[.064,.008],[.064,0] ];
  const build=quality=>{const g=new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),quality==='balanced'?16:quality==='ultra'?48:32);g.normalizeNormals();return g;};
  detailGeometry(addMesh(root,build('high'),materials.nozzle,'titanium nozzle bell'),build);
  ring(root,.068,.0044,materials.nozzle,[0,.004,0],'y',32,'radiused titanium nozzle lip');
  const jacket=cylinder(root,.048,.048,.031,materials.carbon,[0,.090,0],'y',16,'gimbal jacket');jacket.userData.minimumQuality=1;
  cylinder(root,.029,.029,.005,materials.seam,[0,.067,0],'y',16,'nozzle throat');
  mergeStaticMeshes(root);
  root.traverse(o=>{if(o.isMesh)o.castShadow=o.name.includes('titanium nozzle');});
  // Hardware stays on the body; condensation is emitted in world coordinates.
  return {root,level:0};
}

export function createRoadster({quality:initialQuality='high'}={}) {
  const group=new THREE.Group();group.name='Tesla Roadster — 2026 exterior study';
  group.userData={type:'independent parametric visual reconstruction',units:'metres',forward:'+Z',reference:'https://www.tesla.com/roadster',dimensionsAssumed:true};
  const shell=new THREE.Group();shell.name='exterior body panels';group.add(shell);
  const underbody=new THREE.Group();underbody.name='underbody and cold-gas equipment';group.add(underbody);
  const equipment=new THREE.Group();equipment.name='illustrative internal equipment';group.add(equipment);
  const cabin=new THREE.Group();cabin.name='single-seat cockpit';group.add(cabin);
  const wheelsRoot=new THREE.Group();wheelsRoot.name='four suspension uprights';group.add(wheelsRoot);
  const transparentMaterials=[];
  const mats={
    paint:new THREE.MeshPhysicalMaterial({color:0xbec6ca,metalness:.38,roughness:.29,clearcoat:.72,clearcoatRoughness:.16,envMapIntensity:1.0,side:THREE.DoubleSide}),
    glass:new THREE.MeshPhysicalMaterial({color:0x171b1e,metalness:0,roughness:.085,ior:1.52,clearcoat:0,specularColor:0xf3f5f4,envMapIntensity:1.0,transparent:true,opacity:.94,depthWrite:false,side:THREE.DoubleSide}),
    carbon:material(0x4d555a,.08,.35,{map:carbonTexture(),side:THREE.DoubleSide}),
    black:material(0x11161a,.36,.25,{side:THREE.DoubleSide}),
    seam:material(0x060a0c,.05,.72),
    rubber:material(0x171a1c,0,.85),
    sidewall:material(0x25292b,0,.78),
    wheelDark:material(0x20272e,.78,.29,{side:THREE.DoubleSide}),
    wheelSilver:material(0xb1bac0,.88,.25,{side:THREE.DoubleSide}),
    wheelBarrel:material(0x252a30,.7,.32),
    rotor:material(0x5f6267,.86,.42),
    chrome:material(0xa3b4bb,.93,.18),
    nozzle:material(0x998173,.82,.29,{side:THREE.DoubleSide}),
    caliper:material(0xb3583e,.52,.32),
    whiteLight:material(0xecf6ff,.15,.16,{emissive:0xdaf0ff,emissiveIntensity:2.4,toneMapped:true,side:THREE.DoubleSide}),
    tailLight:material(0xc90003,.05,.22,{emissive:0xff0003,emissiveIntensity:1.05,toneMapped:true,side:THREE.DoubleSide}),
    amberLight:material(0xa4541c,.1,.25,{emissive:0xb84b05,emissiveIntensity:.4}),
    interior:material(0x262829,.04,.79),
    interiorTrim:material(0x34393d,.02,.86),
    upholstery:material(0x42494c,.01,.90),
    stitch:material(0x797e80,.01,.82),
    screen:material(0x080f17,.12,.16,{emissive:0x0a1b28,emissiveIntensity:.32}),
    screenInk:material(0x8ba8b8,.03,.40,{emissive:0x285268,emissiveIntensity:.3}),
    cabinRed:material(0x7f0511,.05,.5,{emissive:0xbd0010,emissiveIntensity:.25}),
    battery:material(0x2b454e,.5,.38),
    copper:material(0xb97d42,.75,.27),
    tank:material(0x93a4aa,.76,.31),
    seal:material(0x151a1c,.02,.89,{side:THREE.DoubleSide}),
    undertray:material(0x293239,.40,.52,{side:THREE.DoubleSide}),
    damper:material(0xb18b4f,.77,.23),
    liner:material(0x111518,.05,.92,{side:THREE.DoubleSide}),
    lens:new THREE.MeshPhysicalMaterial({color:0xcad5da,metalness:0,roughness:.085,ior:1.49,clearcoat:0,transparent:true,opacity:.18,depthWrite:false,side:THREE.DoubleSide}),
    coverLens:new THREE.MeshPhysicalMaterial({color:0xd5dfe3,metalness:0,roughness:.065,ior:1.49,clearcoat:0,transparent:true,opacity:.18,depthWrite:false,side:THREE.FrontSide}),
    lampEmitter:material(0xd9e5e9,.10,.23,{emissive:0xc5e3ef,emissiveIntensity:1.35,toneMapped:true,side:THREE.DoubleSide}),
    frontPanel:new THREE.MeshPhysicalMaterial({color:0x242b33,metalness:.03,roughness:.22,clearcoat:.82,clearcoatRoughness:.08,envMapIntensity:1.1,side:THREE.DoubleSide}),
  };
  // The car occupies a small part of the driving frame. Balanced keeps the
  // same coating response while reducing geometry, hidden parts and shadows;
  // it no longer turns the flagship body into a different chalky material.
  mats.balancedPaint=new THREE.MeshPhysicalMaterial({color:mats.paint.color.clone(),metalness:mats.paint.metalness,roughness:mats.paint.roughness,clearcoat:mats.paint.clearcoat,clearcoatRoughness:mats.paint.clearcoatRoughness,envMapIntensity:1.0,side:THREE.DoubleSide});
  mats.balancedGlass=material(mats.glass.color.clone(),0,.095,{envMapIntensity:1.0,transparent:true,opacity:mats.glass.opacity,depthWrite:false,side:THREE.DoubleSide});
  transparentMaterials.push(mats.paint,mats.glass,mats.balancedPaint,mats.balancedGlass);
  for(const mat of transparentMaterials)mat.userData.exteriorOpacity=mat.opacity;
  for(const [name,mat] of Object.entries(mats)){mat.forceSinglePass=true;mat.name='Roadster / '+name.replace(/[A-Z]/g,c=>' '+c.toLowerCase());}
  mats.coverLens.userData.opticalAssumption='Illustrative clear polycarbonate cover; one-sided outward surface, ior 1.49, alpha approximation without refraction.';
  mats.paint.userData.opticalAssumption='Satin silver metallic base + dielectric clearcoat; visual estimate, not Tesla measured reflectance.';
  mats.glass.userData.opticalAssumption='Neutral smoked dielectric glazing with .94 exterior opacity; alpha surface approximation, no optical refraction pass. Cabin is an illustrative dark cockpit, not a measured Tesla interior.';
  // The weave map modulates the carbon base colour around a light neutral.
  // Multiplying the previous near-black map by a dark base crushed its diffuse
  // response a second time. Mip filtering keeps the fine
  // weave stable in a moving camera. These finishes are visual estimates, not
  // manufacturer optical measurements; glazing uses a dielectric reflection.
  mats.carbon.color.setHex(0x31373b);mats.carbon.roughness=.41;

  // Three continuous panels leave a genuine cabin aperture, rather than a
  // solid bonnet sheet hidden beneath an opaque glass bubble. Fine surface
  // sampling is concentrated around actual fender curvature and cabin edges.
  for(const side of [-1,1])for(const panel of [
    {a:.80,b:2.30,f:0,n:88,name:'front clamshell'},
    {a:-2.30,b:-1.57,f:0,n:52,name:'rear clamshell'},
    {a:-1.57,b:.80,f:.918,n:72,name:'door shoulder'}
  ]){
    const bands=panel.f?[[0,1,8]]:[[0,1,16],[1,2,3],[2,3,6],[3,4,3],[4,5,7]];
    for(const [a,b,columns]of bands){
      const panelMesh=grid(shell,mats.paint,(u,v)=>{
        const z=lerp(panel.b,panel.a,v),section=bodySection(z);
        const stations=panel.f?[panel.f,1]:[0,section.crease-.006,section.crease+.006,section.ridge-.010,section.ridge+.010,1];
        const x=side*lerp(stations[a],stations[b],u)*section.width;
        return[x,bodySurfaceY(x,z),z];
      },columns,panel.n,side<0,panel.name);
      setGraphNormals(panelMesh);
      if(panel.name==='front clamshell')cutSurfaceOpenings(panelMesh,[...HEADLIGHTS,...BONNET_JOINT_OPENINGS]);
    }
  }

  // Side panels have true wheel openings, not painted circles over a solid box.
  const archRadius=VEHICLE_GEOMETRY.archLongRadius,archRY=VEHICLE_GEOMETRY.archVerticalRadius,archY=-.22,lower=-.315;
  for(const side of [-1,1]) {
    const theta0=Math.asin((lower-archY)/archRY);
    // Interior surface samples, rather than a triangulated boundary polygon,
    // give the door / haunch an actual pressed section and continuous normals.
    const edges=[-2.30,-1.42-archRadius,-1.42+archRadius,1.42-archRadius,1.42+archRadius,2.30];
    for(let segment=0;segment<edges.length-1;segment++){
      const centre=segment===1?-1.42:segment===3?1.42:null;
      const sidePanel=grid(shell,mats.paint,(u,v)=>{
        const z=lerp(edges[segment],edges[segment+1],v),top=fenderEdgeY(z),base=centre===null?lower:archY+archRY*Math.sqrt(Math.max(0,1-((z-centre)/archRadius)**2));
        const y=lerp(top,base,u);return[side*sideSurfaceX(z,y),y,z];
      },24,centre===null?36:88,side>0,side<0?'right sculpted door and fenders':'left sculpted door and fenders');
      setGraphNormals(sidePanel,side);
    }
    for(const zc of [1.42,-1.42]) {
      // A returned sheet hem meets the side-panel aperture exactly. The old
      // protruding round tube looked like a white attached wire and opened a
      // highlight seam at the fender. The bend turns into the wheelhouse, with
      // its radial surface outside the preserved tyre-clearance envelope.
      grid(shell,mats.paint,(u,v)=>{
        const a=lerp(0,PI,v),z=zc+archRadius*Math.cos(a),y=archY+archRY*Math.sin(a),bend=Math.sin(u*PI/2);
        return[side*(sideSurfaceX(z,y)-.014*bend),y+.004*(1-Math.cos(u*PI/2))*Math.sin(a),z+.004*(1-Math.cos(u*PI/2))*Math.cos(a)];
      },4,64,side<0,'integrated rolled wheel arch hem');
      for(const end of [-1,1])grid(shell,mats.paint,(u,v)=>{
        const z=zc+end*archRadius,y=lerp(archY,lower,v);return[side*(sideSurfaceX(z,y)-u*.014),y,z+end*u*.004];
      },3,8,side*end>0,'wheel arch hem lower return');
      grid(underbody,mats.liner,(u,v)=>{
        const a=lerp(theta0,PI-theta0,v),z=zc+(archRadius-.003)*Math.cos(a),x=side*lerp(.54,widthAt(z)-.007,u);
        return[x,Math.min(archY+(archRY-.003)*Math.sin(a),bodySurfaceY(x,z)-.016),z];
      },14,64,side>0,'deep sealed wheelhouse liner');
      // The vertical inner wheelhouse isolates wheel spray / steering travel
      // from the low-pressure chamber, while staying outside the tyre sweep.
      grid(underbody,mats.liner,(u,v)=>{
        const a=lerp(theta0,PI-theta0,v),z=zc+(archRadius-.003)*Math.cos(a),roof=Math.min(archY+(archRY-.003)*Math.sin(a),bodySurfaceY(side*.54,z)-.016);
        return[side*.54,lerp(lower,roof,u),z];
      },3,64,side>0,'isolated wheelhouse bulkhead');
    }
    // Flush doors, hinge cuts and narrow frameless glass seals.
    const seamPoints=[[.63,.270],[.54,-.291],[-.72,-.291],[-.88,.312]],doorSeam=[];
    for(let edge=0;edge<seamPoints.length-1;edge++)for(let i=0;i<=24;i++){
      const f=i/24,z=lerp(seamPoints[edge][0],seamPoints[edge+1][0],f),y=lerp(seamPoints[edge][1],seamPoints[edge+1][1],f);
      doorSeam.push([side*(sideSurfaceX(z,y)+.0026),y,z]);
    }
    curve(shell,doorSeam,.0016,mats.seam,'door shut line',false);
    box(shell,.003,.010,.102,mats.black,[side*(sideSurfaceX(-.72,.257)+.001),.257,-.72],.0014,'flush door handle');
    const marker=box(shell,.012,.018,.118,mats.black,[side*.965,.123,.928],.005,'fender camera housing');
    marker.rotation.y=side*.06;
    box(shell,.014,.012,.042,mats.amberLight,[side*.972,.123,.971],.004,'side indicator');
    // A shallow folded rocker follows the body, instead of a 149 mm high
    // rectangular slab with exposed square ends beneath the whole door.
    for(const face of ['outer','lower','upper'])grid(underbody,mats.carbon,(u,v)=>{
      const z=lerp(.972,-.972,v),t=Math.sin(v*PI),outer=.946+.033*t,upper=-.304+.014*(1-t),bottom=-.350-.039*t;
      if(face==='outer')return[side*(outer-.012*Math.sin(u*PI)),lerp(upper,bottom,u),z];
      return[side*lerp(.845,outer,u),face==='upper'?upper:bottom+.009*(1-u),z];
    },6,42,side<0,'folded carbon rocker '+face);
    for(const z of [-.972,.972])polygon(underbody,[[side*.845,-.290,z],[side*.946,-.290,z],[side*.946,-.350,z],[side*.845,-.341,z]],mats.carbon,'closed rocker end return',true);
  }

  // The photographs show a shallow compound-curved canopy, not a flat top
  // stretched between two triangular side windows. The crown fades into both
  // the windscreen and backlight landing edges without a floating glass lip.
  // The official side study has a long nearly level crest and a clean windscreen
  // landing. Redistributed stations remove the former round bubble crown.
  const canopyKeys=[[-1.57,.340],[-1.40,.417],[-1.15,.543],[-.85,.635],[-.58,.658],[-.22,.660],[.04,.631],[.29,.524],[.80,.280]];
  const canopyW=[[-1.57,.775],[-1.12,.677],[-.65,.650],[-.02,.650],[.27,.678],[.80,.775]];
  const canopyEdge=z=>interpolate(canopyKeys,z)-.026*(1-smoothstep(.25,.80,z))*smoothstep(-1.57,-1.10,z);
  const canopySurface=(u,z)=>{
    const w=interpolate(canopyW,z),edge=canopyEdge(z),endBlend=(1-smoothstep(.30,.80,z))*smoothstep(-1.57,-1.15,z);
    return[u*w,edge+.035*(1-u*u)*endBlend,z];
  };
  const sideGlassSurface=(side,u,z)=>{
    const top=canopyEdge(z),w=interpolate(canopyW,z),lowerX=widthAt(z)-.078,lowerY=Math.min(bodySurfaceY(lowerX,z)+.004,top-.004);
    return[side*lerp(w,lowerX,u),lerp(top,lowerY,u)+.008*Math.sin(u*PI),z];
  };
  for(const [front,back,name] of [[.8,.04,'compound curved windscreen'],[.04,-.76,'panoramic roof glazing'],[-.76,-1.57,'curved rear backlight']]){
    independentTransparentPanel(grid(shell,mats.glass,(u,v)=>canopySurface(lerp(-1,1,u),lerp(front,back,v)),48,40,false,name));
  }
  for(const z of [.04,-.76])grid(shell,mats.seam,(u,v)=>{
    const p=canopySurface(lerp(-1,1,u),z+lerp(-.0025,.0025,v));p[1]+=.0017;return p;
  },36,2,false,'flush glazing panel joint');
  grid(shell,mats.seam,(u,v)=>{
    const x=lerp(-.775,.775,u),z=lerp(-1.57,-1.594,v),y=lerp(canopyEdge(-1.57)+.0015,bodySurfaceY(x,-1.594)+.0015,v);
    return[x,y,z];
  },36,4,false,'sealed rear glass landing');
  // Flush lower black frit and a cowl / wiper pocket, rather than an exposed
  // bright tube around the whole screen perimeter.
  grid(shell,mats.black,(u,v)=>{const p=canopySurface(lerp(-1,1,u),.778),z=lerp(.778,.812,v);return[p[0],lerp(p[1]+.002,bodySurfaceY(p[0],.812)+.0015,v),z];},36,6,false,'windscreen black frit and cowl');
  curve(shell,[[-.49,.286,.786],[-.20,.289,.788],[.12,.290,.788]],.003,mats.black,'concealed windscreen wiper',false).castShadow=false;
  for(const side of [-1,1]) {
    independentTransparentPanel(grid(shell,mats.glass,(u,v)=>sideGlassSurface(side,u,lerp(.8,-1.48,v)),14,72,side<0,(side<0?'right':'left')+' frameless side glazing'));
    // A narrow ceramic frit covers the adhesive landing inside the glazing.
    // It follows the existing pane, without altering canopy shape or opacity.
    for(const edge of [0,1]){const frit=grid(shell,mats.seam,(u,v)=>{const z=lerp(.80,-1.48,v),p=sideGlassSurface(side,edge===0?u*.035:1-u*.035,z);p[0]+=side*.00035;p[1]+=.00035;return p;},2,72,side<0,'side glazing ceramic edge frit');frit.castShadow=false;}
    grid(shell,mats.black,(u,v)=>{
      const z=lerp(.80,-1.53,v),w=interpolate(canopyW,z),h=canopyEdge(z);
      return[side*(w+lerp(-.012,.019,u)),h+.003-lerp(0,.015,u),z];
    },5,72,side<0,'flat windscreen aperture gasket');
    grid(shell,mats.paint,(u,v)=>{
      const z=lerp(.80,-1.55,v),w=interpolate(canopyW,z),h=canopyEdge(z);
      return[side*(w+lerp(-.005,.015,u)),h+.006-.010*u*u,z];
    },5,72,side<0,'flush sculpted roof rail');
    grid(shell,mats.seam,(u,v)=>{
      const z=lerp(.80,-1.48,v),p=sideGlassSurface(side,lerp(.985,1,u),z);p[0]+=side*.001;p[1]+=.001;return p;
    },2,72,side<0,'side window lower seal');
    grid(shell,mats.black,(u,v)=>{
      const z=-.58-v*.038+lerp(-.006,.006,u),p=sideGlassSurface(side,1-v,z);p[0]+=side*.002;return p;
    },2,18,side<0,'flush window division pillar');
    // Broad C-pillar facets flow into the rear quarter without an SUV-like roof.
    grid(shell,mats.paint,(u,v)=>{
      const start=lerp(-.94,-1.45,u),end=lerp(-1.61,-1.76,u),z=lerp(start,end,v),outer=widthAt(z),inner=interpolate(canopyW,Math.max(z,-1.57));
      const iy=canopyEdge(Math.max(z,-1.57));
      const windowInset=lerp(.014,.088,smoothstep(0,1,v)),x=lerp(inner+windowInset,outer,u);
      return[side*x,lerp(iy,bodySurfaceY(outer,z),smoothstep(0,1,u))+.006*Math.sin(u*PI)*Math.sin(v*PI),z];
    },12,30,side<0,'curved rear buttress');
  }
  // Panel lines on the front service lid and rear deck.
  for(const side of [-1,1]) {
    recessedBonnetJoint(shell,t=>{const z=lerp(2.30,.80,t);return[side*bonnetHalfWidthAt(z),z,'x'];},'bonnet joint',mats.paint,mats.seam);
    curve(shell,[[side*.87,.237,-2.30],[side*.884,.297,-2.025]],.0022,mats.seam,'rear bumper joint',false);
  }
  const rearSeam=[];for(let i=0;i<=20;i++){const x=lerp(-.925,.925,i/20);rearSeam.push([x,.299,-2.04]);}
  curve(shell,rearSeam,.0023,mats.seam,'rear deck trailing joint');
  recessedBonnetJoint(shell,t=>[lerp(-bonnetHalfWidthAt(1.0),bonnetHalfWidthAt(1.0),t),1.0,'z'],'service lid transverse joint',mats.paint,mats.seam,40);

  // Front fascia: a very thin horizontal DRL and recessed triangular projectors.
  grid(shell,mats.black,(u,v)=>{
    const y=lerp(-.039,-.397,v),w=lerp(.643,.700,v),x=lerp(-w,w,u);
    return[x,y,2.270+.010*(1-(x/w)**2)];
  },36,12,true,'recessed front central aperture');
  grid(shell,mats.frontPanel,(u,v)=>{
    const y=lerp(-.041,-.207,v),w=lerp(.643,.672,v),x=lerp(-w,w,u);
    return[x,y,2.296+.010*(1-(x/w)**2)+.002*Math.sin(v*PI)];
  },36,12,true,'closed curved black nose panel');
  box(shell,1.355,.011,.017,mats.black,[0,-.214,2.307],.004,'front panel lower seal');
  const frontFrame=[[-.655,-.025,2.313],[.655,-.025,2.313],[.715,-.416,2.352],[-.715,-.416,2.352]];
  for(let edge=0;edge<4;edge++)grid(shell,mats.black,(u,v)=>{
    const a=frontFrame[edge],b=frontFrame[(edge+1)%4],x=lerp(a[0],b[0],v),y=lerp(a[1],b[1],v);
    return[x*(1-u*.022),y+(y>-.1?-.014:.014)*u,lerp(lerp(a[2],b[2],v),2.275,u)];
  },4,24,false,'radiused front aperture return');
  grid(shell,mats.paint,(u,v)=>{
    const x=lerp(-.655,.655,u),y=lerp(bodySurfaceY(x,2.3),-.025,v);
    return[x,y,lerp(2.30,2.313,v)];
  },36,6,true,'folded nose leading edge');
  for(const side of [-1,1]) {
    grid(shell,mats.paint,(u,v)=>{
      const y=lerp(bodySurfaceY(side*lerp(.655,.855,u),2.30),-.283,v),x=lerp(.655+.058*v,sideSurfaceX(2.30,y),u);
      return[side*x,y,2.30+(.013+.025*v)*(1-u*u)];
    },16,20,side>0,'compound curved front bumper cheek');
    grid(underbody,mats.carbon,(u,v)=>{
      const y=lerp(-.283,-.418,v),x=lerp(.714+.004*v,sideSurfaceX(2.30,y)+.012,u);
      return[side*x,y,2.30+(.038+.015*v)*(1-u*u)];
    },12,10,side>0,'wrapped carbon lower bumper');
  }
  for(const side of [-1,1]){
    grid(underbody,mats.black,(u,v)=>{
      const y=lerp(-.203,-.413,u),z=lerp(2.318,2.034,v),x=.716+.051*v;
      return[side*x,y,z];
    },5,12,side>0,'sealed front intake side return');
    grid(underbody,mats.liner,(u,v)=>{
      const x=side*lerp(.716,.844,u),z=lerp(2.300,2.026,v);return[x,-.371-.032*(1-v),z];
    },5,12,side<0,'front bumper lower closure');
  }
  HEADLIGHTS.forEach(outline=>recessedLamp(shell,outline,mats));
  // A shallow extruded ribbon has the photograph's flat optical face. Tubes
  // made both lamps look like surface-mounted neon and rounded the silhouette.
  grid(shell,mats.black,(u,v)=>{const x=lerp(-.653,.653,u);return[x,-.022+lerp(-.010,.010,v),2.315+.008*(1-(x/.653)**2)];},40,2,true,'front light recessed bezel');
  grid(shell,mats.whiteLight,(u,v)=>{const x=lerp(-.647,.647,u);return[x,-.022+lerp(-.0035,.0035,v),2.317+.008*(1-(x/.647)**2)];},40,2,true,'front light blade');
  curve(underbody,[[-.85,-.412,2.283],[-.71,-.425,2.363],[0,-.425,2.388],[.71,-.425,2.363],[.85,-.412,2.283]],.008,mats.carbon,'front splitter outer lip');
  solidXZ(underbody,[[-.851,2.275],[-.719,2.363],[0,2.388],[.719,2.363],[.851,2.275],[.83,1.988],[-.83,1.988]],.027,-.414,mats.carbon,'front ground effect splitter');
  box(underbody,1.22,.018,.041,mats.black,[0,-.306,2.296],.006,'recessed front intake aero vane');
  for(const side of [-1,1])for(let j=0;j<3;j++)box(underbody,.010,.122,.018,mats.black,[side*(.474+j*.047),-.310,2.307],.003,'front intake fin');

  // Rear valance, continuous red blade, four main cold-gas nozzles and diffuser.
  grid(underbody,mats.carbon,(u,v)=>{
    const y=lerp(.219,-.423,v),w=lerp(.942,.827,smoothstep(.55,1,v)),x=lerp(-w,w,u),z=-2.309+.025*(Math.abs(x)/w)**4+.018*v;
    return[x,y,z];
  },48,24,false,'contoured rear carbon valance');
  // Official rear imagery has a dark lower valance underneath the red
  // optical strip. Painted corner returns, rather than a white full-width
  // apron, preserve the floating deck and the width of the exposed diffuser.
  for(const side of [-1,1])grid(shell,mats.paint,(u,v)=>{
    const x=side*lerp(.790+.018*v,.940,u),edge=Math.abs(x)/.940,y=lerp(.215,-.056-.045*u,v),z=-2.322+.037*edge**4+.006*Math.sin(v*PI);
    return[x,y,z];
  },12,14,side<0,'sculpted rear painted corner return');
  grid(shell,mats.black,(u,v)=>{const x=lerp(-.911,.911,u),edge=(Math.abs(x)/.911)**4;return[x,.222+lerp(-.016,.017,v),-2.321+.018*edge];},48,3,false,'recessed rear optical channel');
  grid(shell,mats.tailLight,(u,v)=>{const x=lerp(-.897,.897,u),edge=(Math.abs(x)/.897)**4;return[x,.222+lerp(-.008,.008,v),-2.324+.018*edge];},48,3,false,'full width rear light');
  curve(shell,[[-.884,.241,-2.306],[0,.244,-2.318],[.884,.241,-2.306]],.004,mats.paint,'rear trailing lip');
  box(underbody,.382,.112,.019,mats.chrome,[0,.112,-2.336],.009,'embossed rear plate surround');
  box(underbody,.366,.104,.014,mats.black,[0,.112,-2.350],.007,'rear RDSTR plate');
  const letters=new THREE.Group();underbody.add(letters);vectorLabel(letters,'RDSTR',.057,mats.chrome,[0,.082,-2.335]);
  letters.position.z=-.029;
  letters.scale.x=-1;
  for(const x of [-.166,.166])for(const y of [.073,.151])cylinder(underbody,.004,.004,.003,mats.chrome,[x,y,-2.359],'z',8,'plate fixing');
  const rearFans=[];
  for(let j=0;j<4;j++) {
    const x=(j-1.5)*.32;
    const n=nozzleGeometry(underbody,mats,'rear propulsion nozzle '+(j+1));
    n.root.position.set(x,-.035,-2.322);n.root.quaternion.setFromUnitVectors(DOWN,new THREE.Vector3(0,0,-1));
    // Cosmetic ports do not add forces. Their common force comes from physics.
    n.cosmetic=true;rearFans.push(n);
    const well=cylinder(underbody,.123,.108,.051,mats.black,[x,-.220,-2.306],'z',28,'rear turbine duct');
    ring(underbody,.118,.008,mats.carbon,[x,-.220,-2.338],'z',28,'fan duct edge');
    const fan=new THREE.Group();fan.position.set(x,-.220,-2.341);underbody.add(fan);
    for(let k=0;k<7;k++) {
      const a=k*TAU/7,pts=[[0,0,0],[Math.sin(a)*.106,Math.cos(a)*.106,0],[Math.sin(a+.35)*.103,Math.cos(a+.35)*.103,.010],[Math.sin(a+.55)*.025,Math.cos(a+.55)*.025,.014]];
      polygon(fan,pts,mats.wheelDark,'extraction fan blade',true);
    }
    cylinder(fan,.027,.027,.021,mats.nozzle,[0,0,0],'z',18,'turbine hub');
    mergeStaticMeshes(fan);
    n.fan=fan;
  }
  curve(underbody,[[-.660,-.141,-2.348],[-.682,-.174,-2.353],[-.682,-.345,-2.351],[-.623,-.395,-2.341],[.623,-.395,-2.341],[.682,-.345,-2.351],[.682,-.174,-2.353],[.660,-.141,-2.348]],.012,mats.black,'recessed four-fan module frame');
  for(let j=0;j<5;j++)polygon(underbody,[[(j-2)*.323,-.434,-2.351],[(j-2)*.323,-.152,-2.32],[(j-2)*.323,-.273,-1.81],[(j-2)*.323,-.444,-1.89]],mats.carbon,'rear diffuser strake',true);
  solidXZ(underbody,[[-.848,-2.36],[.848,-2.36],[.835,-1.86],[-.835,-1.86]],.022,-.422,mats.carbon,'rear diffuser floor');

  // Active aerodynamic wing, with actuators and a proper lenticular section.
  const wing=new THREE.Group();wing.name='active rear wing';wing.position.set(0,.325,-2.065);group.add(wing);
  grid(wing,mats.carbon,(u,v)=>{
    const x=lerp(-.918,.918,u),a=v*TAU;
    const sweep=.06*(Math.abs(x)/.918)**2;
    return[x,Math.sin(a)*.014,Math.cos(a)*.133+sweep];
  },32,16,false,'carbon airfoil');
  for(const side of [-1,1])polygon(wing,[[side*.918,-.012,-.10],[side*.918,.039,-.098],[side*.918,.047,.11],[side*.918,-.010,.19]],mats.carbon,'wing endplate',true);
  const wingStruts=[];
  for(const side of [-1,1]) {
    const strut=box(group,.035,.12,.05,mats.black,[side*.527,.30,-2.009],.005,'wing actuator');
    wingStruts.push(strut);
    cylinder(wing,.017,.017,.057,mats.nozzle,[side*.527,-.007,.057],'x',24,'upper active wing pivot');
    cylinder(underbody,.019,.019,.057,mats.nozzle,[side*.527,.264,-2.009],'x',24,'lower active wing pivot');
    for(const dx of [-.026,.026])box(wing,.009,.039,.059,mats.carbon,[side*.527+dx,.007,.053],.004,'paired wing support clevis');
  }
  mergeStaticMeshes(wing);

  // The airtight roof and skirt form a real visual enclosure; the old large
  // flat plate occupied the tyre sweep and did not explain the sealing path.
  const chamber=buildPressureChamber(underbody,mats);
  box(equipment,1.35,.145,2.43,mats.battery,[0,-.194,-.02],.036,'illustrative structural battery');
  for(let i=0;i<12;i++)box(equipment,1.22,.006,.006,mats.chrome,[0,-.115,-1.10+i*.195],.001,'battery module rib');
  for(const side of [-1,1]) {
    const tank=cylinder(equipment,.153,.153,.90,mats.tank,[side*.285,.032,-1.198],'z',32,'assumed composite cold-gas tank');
    for(const end of [-1,1]) {
      const cap=addMesh(equipment,new THREE.SphereGeometry(.153,20,12),mats.tank,'pressure vessel dome');cap.scale.z=.5;cap.position.set(side*.285,.032,-1.198+end*.45);
    }
    for(const z of [-1.49,-.94])ring(equipment,.157,.012,mats.black,[side*.285,.032,z],'z',28,'pressure tank clamp');
    curve(equipment,[[side*.28,-.004,-1.73],[side*.58,-.066,-1.77],[side*.63,-.147,-.40],[side*.66,-.145,.91]],.012,mats.copper,'gas supply manifold');
  }
  buildCockpit(cabin,mats);
  equipment.visible=false;

  const wheels=[buildWheel(wheelsRoot,-1,1.42,mats),buildWheel(wheelsRoot,1,1.42,mats),buildWheel(wheelsRoot,-1,-1.42,mats),buildWheel(wheelsRoot,1,-1.42,mats)];
  const suspensions=wheels.map(w=>buildSuspension(wheelsRoot,w,mats));
  mergeStaticMeshes(shell);
  mergeStaticMeshes(equipment);
  mergeStaticMeshes(cabin);
  mergeStaticMeshes(underbody,false);
  // Tiny gaps and luminous lenses do not cast extra stair-stepped shadows onto
  // the adjacent body. The actual surrounding body still casts full shadows.
  shell.traverse(o=>{if(o.isMesh&&[mats.seam,mats.black,mats.whiteLight,mats.lampEmitter,mats.tailLight,mats.lens,mats.coverLens].includes(o.material))o.castShadow=false;});
  const jets=[];
  const jetsRoot=new THREE.Group();jetsRoot.name='simulated force application nozzles';group.add(jetsRoot);
  const jetExhaust=new THREE.Vector3(),shadowDefaults=new WeakMap();
  let time=0,cutaway=false,wingExtension=0,quality='high',geometryQuality='high',projectedPixels=null;
  const viewPoint=new THREE.Vector3();

  function applyProfileObjects(root){
    root.traverse(o=>{
      if(Number.isFinite(o.userData.minimumQuality))o.visible=cutaway||QUALITY[geometryQuality]>=o.userData.minimumQuality;
      if(!o.isMesh)return;
      if(!shadowDefaults.has(o))shadowDefaults.set(o,o.castShadow);
      const silhouette=[mats.paint,mats.balancedPaint,mats.rubber].includes(o.material);
      o.castShadow=shadowDefaults.get(o)&&(geometryQuality!=='balanced'||silhouette);
      if(o.material===mats.paint||o.material===mats.balancedPaint)o.material=geometryQuality==='balanced'?mats.balancedPaint:mats.paint;
      if(o.material===mats.glass||o.material===mats.balancedGlass)o.material=geometryQuality==='balanced'?mats.balancedGlass:mats.glass;
    });
  }

  function applyDisplayProfile(value){
    geometryQuality=value;
    applyGeometryQuality(group,geometryQuality);applyProfileObjects(group);
    const anisotropy=geometryQuality==='balanced'?2:8;
    if(mats.carbon.map.anisotropy!==anisotropy){mats.carbon.map.anisotropy=anisotropy;mats.carbon.map.needsUpdate=true;}
    for(const s of suspensions)s.group.visible=geometryQuality!=='balanced'||cutaway;
    cabin.visible=geometryQuality!=='balanced'||cutaway;
    for(const wheel of wheels)wheel.spin.traverse(o=>{
      if(o.isLineSegments||[mats.sidewall,mats.seam,mats.chrome].includes(o.material))o.visible=geometryQuality!=='balanced'||cutaway;
    });
    group.userData.quality=quality;group.userData.geometryQuality=geometryQuality;
  }
  function setQuality(value){
    quality=Object.hasOwn(QUALITY,value)?value:'high';
    applyDisplayProfile(quality);return quality;
  }
  function setViewBudget(camera,drawingBufferHeight,{inspection=false}={}){
    if(!camera?.isPerspectiveCamera||!Number.isFinite(drawingBufferHeight))return geometryQuality;
    group.getWorldPosition(viewPoint);viewPoint.applyMatrix4(camera.matrixWorldInverse);
    projectedPixels=viewPoint.z>=0?0:vehicleProjectedPixels({distance:-viewPoint.z,fov:camera.fov,height:drawingBufferHeight});
    const next=cutaway?quality:chooseVehicleGeometryProfile(quality,projectedPixels,{inspection,previous:geometryQuality});
    if(next!==geometryQuality)applyDisplayProfile(next);
    group.userData.projectedPixels=projectedPixels;return geometryQuality;
  }

  function getRenderCost(){
    const cost={quality,geometryQuality,projectedPixels,drawables:0,meshes:0,vertices:0,triangles:0,shadowMeshes:0};
    group.traverseVisible(o=>{
      if(!o.geometry)return;cost.drawables++;cost.meshes+=!!o.isMesh;cost.vertices+=o.geometry.attributes.position?.count||0;
      if(o.isMesh)cost.triangles+=(o.geometry.index?.count||o.geometry.attributes.position?.count||0)/3;
      cost.shadowMeshes+=!!o.castShadow;
    });
    return cost;
  }

  function updateJet(jet,force,maxForce,dt,phase) {
    jet.level=clamp(Math.abs(force)/(maxForce||1),0,1);jet.root.userData.actualForce=force;
  }

  function update(telemetry={},dt=1/60) {
    dt=clamp(Number.isFinite(dt)?dt:1/60,0,.1);time+=dt;
    const ws=telemetry.wheelStates||telemetry.wheels||[];
    for(let i=0;i<wheels.length;i++) {
      const w=wheels[i],state=ws[i];
      if(state) {
        w.assembly.rotation.y=state.steer||0;
        w.spin.rotation.x=state.rotation||0;
        if(state.position)w.assembly.position.set(state.position.x,state.position.y,state.position.z);
        else if(Number.isFinite(state.suspensionLength))w.assembly.position.y=.06-state.suspensionLength;
      } else {
        w.spin.rotation.x+=((telemetry.speedKmh||0)/3.6/.37)*dt;
      }
    }
    suspensions.forEach(s=>{if(s.group.visible)s.update();});chamber.update(telemetry,dt);
    const nozzles=telemetry.nozzles||[];
    let rearThrust=0,rearMax=1;
    for(let i=0;i<nozzles.length;i++) {
      const n=nozzles[i];
      if(!jets[i]){
        jets[i]=nozzleGeometry(jetsRoot,mats,n.id||'force nozzle '+i);
        applyGeometryQuality(jets[i].root,geometryQuality);applyProfileObjects(jets[i].root);
      }
      const jet=jets[i];
      if(n.position)jet.root.position.set(n.position.x,n.position.y,n.position.z);
      const d=n.direction||{x:0,y:1,z:0};
      const exhaust=jetExhaust.set(-d.x,-d.y,-d.z).normalize();
      if(exhaust.lengthSq()>.5)jet.root.quaternion.setFromUnitVectors(DOWN,exhaust);
      // Moving an outlet along its force axis does not change its force moment.
      // Wheel-centre equivalent side actuators emerge through the outer hubs.
      if(n.kind==='roll')jet.root.position.addScaledVector(exhaust,.158);
      if(n.kind==='longitudinal'&&d.z<-.7)jet.root.position.addScaledVector(exhaust,.266);
      // A single longitudinal actuator drives four visible rear ports.
      const rear=(n.kind==='longitudinal'&&d.z>.7&&n.position?.z<0);
      jet.root.visible=!rear&&(!(n.kind==='longitudinal'&&d.z<-.7)||Math.abs(n.force||0)>20||cutaway);
      if(rear){rearThrust+=Math.abs(n.force||0);rearMax=Math.max(rearMax,n.maxForce||1);}
      updateJet(jet,n.force||0,n.maxForce||1,dt,i*.11);
    }
    for(let i=nozzles.length;i<jets.length;i++)jets[i].root.visible=false;
    rearFans.forEach((jet,i)=>{
      updateJet(jet,rearThrust,rearMax,dt,.07+i*.15);
      jet.fan.rotation.z+=dt*(telemetry.suctionEnabled?22+14*(telemetry.sealQuality||0):5*clamp((telemetry.speedKmh||0)/130,0,1));
    });
    const brake=clamp(telemetry.brake??telemetry.brakeInput??0,0,1);
    // The physical actuator owns deployment and rate limiting. Rendering has
    // no speed/brake-driven copy and never changes the aerodynamic state.
    const wingState=telemetry.wing||{};
    wingExtension=clamp(Number.isFinite(wingState.deployment)?wingState.deployment:0,0,1);
    const physicalPosition=wingState.position,hasPhysicalPose=physicalPosition&&['x','y','z'].every(axis=>Number.isFinite(physicalPosition[axis]))&&Number.isFinite(wingState.incidenceRad);
    // Legacy inspection fixtures only carry deployment; the running model
    // supplies the complete actuator pose shared with its aerodynamic force.
    if(hasPhysicalPose){wing.position.set(physicalPosition.x,physicalPosition.y,physicalPosition.z);wing.rotation.x=wingState.incidenceRad;}
    else{wing.position.set(0,.325+wingExtension*.30,-2.065);wing.rotation.x=-wingExtension*.25;}
    wing.userData.deployment=wingExtension;wing.userData.source=hasPhysicalPose?'telemetry.wing.position/incidenceRad':'telemetry.wing.deployment';
    for(const strut of wingStruts){strut.scale.y=1+wingExtension*2.5;strut.position.y=.30+wingExtension*.15;}
    mats.tailLight.emissiveIntensity=brake>.02?2.4:1.25;
  }

  function setColor(color) {mats.paint.color.set(color);mats.balancedPaint.color.copy(mats.paint.color);}
  function setCutaway(enabled) {
    cutaway=!!enabled;equipment.visible=cutaway;
    for(const mat of transparentMaterials) {
      const glass=mat===mats.glass||mat===mats.balancedGlass;
      mat.transparent=cutaway||glass;mat.opacity=cutaway?(glass?.08:.17):mat.userData.exteriorOpacity;
      mat.depthWrite=!cutaway&&!glass;mat.needsUpdate=true;
    }
    chamber.roof.visible=!cutaway;
    setQuality(quality);
  }
  function dispose() {
    const geometries=new Set(),materials=new Set(),textures=new Set();
    group.traverse(o=>{
      if(o.geometry)geometries.add(o.geometry);
      const detail=geometryDetail.get(o);if(detail){detail.cache.forEach(g=>geometries.add(g));detail.cache.clear();geometryDetail.delete(o);}
      for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m){materials.add(m);for(const k in m)if(m[k]?.isTexture)textures.add(m[k]);}
    });
    for(const m of Object.values(mats)){materials.add(m);for(const k in m)if(m[k]?.isTexture)textures.add(m[k]);}
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  }
  group.userData.pressureChamber={...chamber.root.userData};
  setQuality(initialQuality);
  return {group,update,setColor,setCutaway,setQuality,setViewBudget,getRenderCost,get quality(){return quality;},dispose,wheels,materials:mats,wing,chamber,suspensions};
}

