/** Shared diagnostic sampling. Distances are sampled estimates, never a
 * continuous collision certificate or available manoeuvre recovery height. */
export const QUICK_ROLL_HEADROOM_OFFSETS=Object.freeze([[0,0],[-1.2,-2.2],[1.2,-2.2],[-1.2,2.2],[1.2,2.2]].map(Object.freeze));
const DIRECTIONS={down:{x:0,y:-1,z:0},up:{x:0,y:1,z:0},negativeX:{x:-1,y:0,z:0},positiveX:{x:1,y:0,z:0},negativeZ:{x:0,y:0,z:-1},positiveZ:{x:0,y:0,z:1}};
const rotate=(p,q)=>{const x=p.x,y=p.y,z=p.z,ix=q.w*x+q.y*z-q.z*y,iy=q.w*y+q.z*x-q.x*z,iz=q.w*z+q.x*y-q.y*x,iw=-q.x*x-q.y*y-q.z*z;return{x:ix*q.w-iw*q.x-iy*q.z+iz*q.y,y:iy*q.w-iw*q.y-iz*q.x+ix*q.z,z:iz*q.w-iw*q.z-ix*q.y+iy*q.x};};
const translated=(p,o)=>({x:p.x+o.x,y:p.y+o.y,z:p.z+o.z});

export function sampleQuickRollHeadroom(position,trace,distance){
  const samples=QUICK_ROLL_HEADROOM_OFFSETS.map(([x,z])=>{const origin={x:position.x+x,y:position.y,z:position.z+z};return{origin,hit:trace(origin,DIRECTIONS.up,distance)};});
  const nearest=samples.filter(s=>s.hit).sort((a,b)=>a.hit.distance-b.hit.distance)[0];
  return{distanceM:nearest?.hit.distance??null,objectId:nearest?.hit.objectId??null,samples,rangeM:distance,datum:'CG plane, same five world-axis rays used by quick-roll-1 preflight',estimated:true};
}

function envelopePoints(sim){
  const q=sim.body.quaternion,p=sim.body.position,points=[];
  // Four physical hull boxes, not the mesh bounding box. Their world corners
  // retain the actual tilted shape and do not subtract 0.6 m from a CG ray.
  for(let i=0;i<4;i++){
    const shape=sim.body.shapes[i],h=shape.halfExtents,o=sim.body.shapeOffsets[i];
    if(!h)continue;
    for(const x of [-h.x,h.x])for(const y of [-h.y,h.y])for(const z of [-h.z,h.z])points.push({part:'hull-'+i,point:translated(rotate({x:o.x+x,y:o.y+y,z:o.z+z},q),p)});
  }
  // Tyre radial extrema + shoulder width at current suspension positions.
  for(const w of sim.wheelStates)for(const axis of ['x','y','z'])for(const sign of [-1,1]){
    const local={...w.position};local[axis]+=sign*(axis==='x'?.1325:sim.params.wheelRadius);points.push({part:'tyre-'+w.id,point:translated(rotate(local,q),p)});
  }
  return points;
}

export function sampleVehicleClearance(sim,{maxDistance=12,includeQuickRoll=true,directions=Object.keys(DIRECTIONS)}={}){
  const distance=Number.isFinite(maxDistance)?Math.max(.5,Math.min(220,maxDistance)):12;
  const points=envelopePoints(sim),trace=(o,d,r)=>sim.traceSurface(o,d,r),results={},hullResults={};
  for(const [name,direction]of Object.entries(DIRECTIONS)){
    if(!directions.includes(name))continue;
    // All physical hull corners and tyre extrema are sampled. Rays can miss a
    // thin obstacle between points; the API exposes that qualification.
    let nearest=null,nearestHull=null,hits=0,hullHits=0;
    for(const sample of points){const hit=trace(sample.point,direction,distance);if(!hit)continue;hits++;const entry={distanceM:Math.max(0,hit.distance),objectId:hit.objectId??null,part:sample.part,point:sample.point,surfacePoint:hit.point};if(!nearest||hit.distance<nearest.distanceM)nearest=entry;if(sample.part.startsWith('hull-')){hullHits++;if(!nearestHull||hit.distance<nearestHull.distanceM)nearestHull=entry;}}
    for(const w of sim.wheelStates){const n=w.contactNormalWorld;if(w.contact&&n&&(n.x*direction.x+n.y*direction.y+n.z*direction.z)<-.25){nearest={distanceM:0,objectId:w.contactObjectId??null,part:'tyre-contact-'+w.id,point:null,surfacePoint:w.contactPointWorld??null};break;}}
    // A contact is stronger evidence than a ray from an already penetrating
    // sample, whose exit face may correctly be excluded as a back face.
    for(const c of sim.world.contacts){
      if(c.bi!==sim.body&&c.bj!==sim.body)continue;const sign=c.bi===sim.body?-1:1;
      if(sign*(c.ni.x*direction.x+c.ni.y*direction.y+c.ni.z*direction.z)<-.25){const other=c.bi===sim.body?c.bj:c.bi;nearest={distanceM:0,objectId:other.userData?.id??null,part:'active-rigid-contact',point:null,surfacePoint:null};const index=sim.body.shapes.indexOf(c.bi===sim.body?c.si:c.sj);if(index>=0&&index<4)nearestHull=nearest;}
    }
    results[name]={...(nearest??{distanceM:null,objectId:null,part:null}),sampleCount:points.length,hitCount:hits,estimated:true,availability:nearest?'sampled':'no-surface-in-range'};
    hullResults[name]={...(nearestHull??{distanceM:null,objectId:null,part:null}),sampleCount:32,hitCount:hullHits,estimated:true,availability:nearestHull?'sampled':'no-surface-in-range'};
  }
  const centre=trace(sim.body.position,DIRECTIONS.down,220);
  return{schema:'roadster-clearance-estimate',version:1,simTime:sim.simTime,step:sim._stepCount,worldCgHeightM:sim.body.position.y,centreDownDistanceM:centre?.distance??null,centreDownObjectId:centre?.objectId??null,
    rangeM:distance,distances:results,hullDistances:hullResults,hullDatum:'four physical hull collision boxes; tyres excluded, visual-only details excluded',quickRollHeadroom:includeQuickRoll?sampleQuickRollHeadroom(sim.body.position,trace,distance):null,
    estimate:true,method:'rays from physical hull box corners and current tyre extrema',contactSamplePhase:'wheel/contact state from the most recent fixed step',notCovered:'continuous swept volume, obstacles between samples, non-collision visual details',recoveryHeightM:null};
}
