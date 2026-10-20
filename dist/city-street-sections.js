// The inherited background road grid is 28 m wide. Its full floor remains
// driveable; flush mineral forecourts make the difference between carriageway
// and building apron visible without adding a disguised kerb or hidden step.
// Authored streets, ramp mouths and landmark reservations cut these finishes.
export const CITY_STREET_SECTION_VERSION='street-sections-3.16-1';

export function subtractStreetRectangle(rect,cut){
  const [x0,z0,x1,z1]=rect,[a,b,c,d]=cut;
  const l=Math.max(x0,a),r=Math.min(x1,c),s=Math.max(z0,b),n=Math.min(z1,d);
  if(l>=r||s>=n)return[rect];
  return [[x0,z0,l,z1],[r,z0,x1,z1],[l,z0,r,s],[l,n,r,z1]].filter(q=>q[2]-q[0]>.05&&q[3]-q[1]>.05);
}

export function createStreetSectionFinishes(streets,routes,buildings,reservations=[]){
  const finishes=[],forecourts=[],cuts=[];
  for(const road of [...streets,...routes])for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i];
    if(Math.min(a[1],b[1])>2)continue;
    // A conservative AABB is deliberate on curved/inclined route mouths:
    // keeping a little extra asphalt is preferable to painting over a ramp.
    const h=road.width/2+.22;
    cuts.push([Math.min(a[0],b[0])-h,Math.min(a[2],b[2])-h,Math.max(a[0],b[0])+h,Math.max(a[2],b[2])+h]);
  }
  cuts.push(...reservations.map(r=>[r.minX-1,r.minZ-1,r.maxX+1,r.maxZ+1]));
  const background=new Map(buildings.filter(b=>b.id.startsWith('block-')&&(b.baseY||0)===0).map(b=>[b.x+','+b.z,b]));
  // Removing a conflicting background tower preserved the old road but used
  // to leave its entire original cell as unqualified asphalt. Give those same
  // original cells a flush public forecourt as well, without recreating towers.
  const cells=[];for(let x=-550;x<=550;x+=100)for(let z=-550;z<=550;z+=100)cells.push({x,z,building:background.get(x+','+z)});
  for(const cell of cells){
    const b=cell.building;
    let rectangles=[[cell.x-36,cell.z-36,cell.x+36,cell.z+36]];
    for(const cut of cuts)rectangles=rectangles.flatMap(rect=>subtractStreetRectangle(rect,cut));
    rectangles.forEach(([x0,z0,x1,z1],index)=>{
      const id='street-section-'+(b?.id||'open-cell-'+cell.x+'-'+cell.z)+'-forecourt-'+index,rectangle=[x0,z0,x1,z1];
      forecourts.push({id,building:b?.id||null,cell:[cell.x,cell.z],role:b?'building apron':'unbuilt original grid forecourt',rectangle,carriagewayBoundary:'28 m inherited grid',topM:.009,support:'existing physical floor'});
      finishes.push({id,size:[x1-x0,.008,z1-z0],position:[(x0+x1)/2,.005,(z0+z1)/2],material:'forecourt-mineral',rotation:[0,0,0],renderDetail:'mass'});
      // A narrow perimeter datum is a finish on the flush apron. It adds
      // human-scale depth to the silhouette without closing any road opening.
      if(x1-x0>8&&z1-z0>8)for(const side of [-1,1]){
        finishes.push({id:id+'-x-'+side,size:[.32,.006,z1-z0],position:[side<0?x0+.16:x1-.16,.012,(z0+z1)/2],material:'forecourt-border',rotation:[0,0,0]});
        finishes.push({id:id+'-z-'+side,size:[x1-x0-.64,.006,.32],position:[(x0+x1)/2,.012,side<0?z0+.16:z1-.16],material:'forecourt-border',rotation:[0,0,0]});
      }
    });
  }
  // Four narrow traffic lanes read as a boulevard, instead of one enormous
  // unqualified asphalt apron. Paint changes neither the 18/22 m envelope
  // nor tyre forces, and it ends before every authored crossing.
  const laneSections=[];
  for(const street of streets.filter(s=>s.width>=18))for(let i=1;i<street.points.length;i++){
    const a=street.points[i-1],b=street.points[i],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
    if(length<1||a[1]!==b[1])continue;
    const tangent=[dx/length,dz/length],normal=[tangent[1],-tangent[0]],half=street.width/2;
    const point=(u,v)=>[a[0]+tangent[0]*u+normal[0]*v,a[1]+.028,a[2]+tangent[1]*u+normal[1]*v];
    const insideOtherRoad=p=>streets.some(other=>other!==street&&other.points.slice(1).some((c,j)=>{
      const d=other.points[j];if(Math.abs(d[1]-a[1])>1||Math.abs(c[1]-a[1])>1)return false;
      const ux=c[0]-d[0],uz=c[2]-d[2],t=Math.max(0,Math.min(1,((p[0]-d[0])*ux+(p[2]-d[2])*uz)/(ux*ux+uz*uz||1)));
      return Math.hypot(p[0]-d[0]-ux*t,p[2]-d[2]-uz*t)<other.width/2+5;
    }));
    const offset=Math.min(3.55,half*.42);let markings=0;
    for(let u=12;u<length-10;u+=12)for(const side of [-1,1]){
      const p=point(u,side*offset);if(insideOtherRoad(p))continue;
      finishes.push({id:'street-section-'+street.id+'-lane-'+i+'-'+side+'-'+u,size:[.085,.006,4.6],position:p,rotation:[0,Math.atan2(dx,dz),0],material:'paint'});markings++;
    }
    laneSections.push({street:street.id,segment:i,widthM:street.width,dividerOffsetsM:[-offset,offset],markings,collisionChange:false});
  }
  return {version:CITY_STREET_SECTION_VERSION,finishes,forecourts,laneSections,limits:'Flush art finishes on existing support; not a change to navigation topology, legal road width, road friction or pedestrian/traffic simulation.'};
}
