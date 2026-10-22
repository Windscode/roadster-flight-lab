// A small, authored engineering surface map for the existing Weave street.
// Moisture, optical appearance and grip are separate measurements/assumptions.
// This is neither a water-film simulation nor a hydroplaning/tire calibration.
export const ROUTE_SURFACE_SCHEMA='roadster-route-surface';
export const ROUTE_SURFACE_VERSION=1;
export const ROUTE_SURFACE_PRESETS=Object.freeze(['dry-day','after-rain']);
const clone=value=>JSON.parse(JSON.stringify(value));
const finite=Number.isFinite;
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export function routeSurfaceHash(descriptor){
  // Deterministic content identity; explicitly not a cryptographic signature.
  let value=2166136261;for(const c of canonical(descriptor)){value^=c.charCodeAt(0);value=Math.imul(value,16777619);}
  return 'fnv1a32-'+(value>>>0).toString(16).padStart(8,'0');
}
const material=(kind,label,labelEn,gripScale,moisture,opticalWetness,roughness,rollingTexture)=>({kind,label,labelEn,gripScale,moisture,opticalWetness,roughness,rollingTexture});
const region=(id,materialId,minX,maxX,minZ,maxZ,priority)=>({id,materialId,bounds:{minX,maxX,minZ,maxZ},priority});
export function createRouteSurfacePreset(presetId='dry-day'){
  if(!ROUTE_SURFACE_PRESETS.includes(presetId))throw Error('Unknown route surface preset');
  const wet=presetId==='after-rain';
  return {
    schema:ROUTE_SURFACE_SCHEMA,version:ROUTE_SURFACE_VERSION,id:'weave-learning-route',presetId,
    label:wet?'织桥街 · 雨后局部潮湿':'织桥街 · 干燥日间',labelEn:wet?'Weave street · after rain':'Weave street · dry day',
    groundY:0,contactToleranceM:.08,
    route:{lengthM:302.5,start:{x:-200,y:.62,z:-380,yaw:0},waypoints:[{x:-200,z:-380},{x:-200,z:-132.5},{x:-145,z:-132.5}],widthM:10},
    preparation:{lighting:wet?'overcast':'day',application:'explicit-paused-preparation',physics:'per-wheel-contact-map'},
    calibration:{referenceDryMu:1.25,interpretation:'mu = vehicle tireMu × authored gripScale; illustrative engineering assumptions, no OEM calibration',heightGeometry:'flush surfaces; no added collision bumps',opticalPolicy:'opticalWetness is independent of moisture and gripScale; lighting changes do not alter this descriptor'},
    materials:{
      asphalt:material('asphalt','干沥青','Dry asphalt',1,0,0,.84,1),
      damp:material('asphalt',wet?'潮湿沥青':'干沥青',wet?'Damp asphalt':'Dry asphalt',wet?.56:1,wet?.65:0,wet?.72:0,wet?.32:.84,wet?1.12:1),
      metal:material('metal',wet?'潮湿检修钢板':'检修钢板',wet?'Damp service plate':'Service plate',wet?.42:.72,wet?.40:0,wet?.48:0,wet?.27:.52,.76),
      patch:material('patch',wet?'微潮修补面':'修补沥青',wet?'Damp asphalt repair':'Asphalt repair',wet?.76:.90,wet?.24:0,wet?.18:0,wet?.64:.91,1.22),
    },
    regions:[
      region('weave-straight','asphalt',-205,-195,-387,-123.5,0),
      region('weave-turn-east','asphalt',-205,-139,-141.5,-123.5,1),
      region('bridge-service-plate','metal',-204.5,-195.5,-321.15,-318.85,20),
      region('shelter-runoff','damp',-205,-195,-310,-265,10),
      region('utility-asphalt-repair','patch',-203,-197,-249,-244,20),
      region('half-width-damp','damp',-200,-195,-221,-194,10),
      region('turn-approach-damp','damp',-205,-195,-170,-139,10),
      region('turn-exit-damp','damp',-195,-161,-141.5,-123.5,10),
    ],
  };
}
export function validateRouteSurface(descriptor){
  const json=(value,depth=0)=>{if(depth>12)throw Error('Surface descriptor nesting limit');if(value===null||typeof value==='string'||typeof value==='boolean')return;if(typeof value==='number'&&finite(value))return;if(!value||typeof value!=='object'||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Surface descriptor must be finite JSON');for(const [key,child]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw Error('Invalid surface key');json(child,depth+1);}};json(descriptor);
  if(!descriptor||descriptor.schema!==ROUTE_SURFACE_SCHEMA||descriptor.version!==ROUTE_SURFACE_VERSION||descriptor.id!=='weave-learning-route'||!ROUTE_SURFACE_PRESETS.includes(descriptor.presetId))throw Error('Unsupported route surface identity');
  if(!finite(descriptor.groundY)||Math.abs(descriptor.groundY)>1||!finite(descriptor.contactToleranceM)||descriptor.contactToleranceM<.001||descriptor.contactToleranceM>.15)throw Error('Invalid route support height');
  const route=descriptor.route;if(!route||!finite(route.lengthM)||route.lengthM<250||route.lengthM>350||!route.start||!['x','y','z','yaw'].every(k=>finite(route.start[k]))||!Array.isArray(route.waypoints)||route.waypoints.length<2||route.waypoints.length>8||route.waypoints.some(p=>!finite(p.x)||!finite(p.z)||Math.abs(p.x)>620||Math.abs(p.z)>620))throw Error('Invalid route geometry');
  const length=route.waypoints.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-route.waypoints[i].x,p.z-route.waypoints[i].z),0);if(Math.abs(length-route.lengthM)>1e-7||!finite(route.widthM)||route.widthM<4||route.widthM>28||Math.hypot(route.start.x-route.waypoints[0].x,route.start.z-route.waypoints[0].z)>1e-7)throw Error('Surface route length/start mismatch');
  if(!descriptor.materials||Object.keys(descriptor.materials).length>8)throw Error('Invalid surface material set');
  for(const [id,m]of Object.entries(descriptor.materials)){
    if(!/^[a-z][a-z0-9-]{0,47}$/.test(id)||!m||!['label','labelEn'].every(k=>typeof m[k]==='string'&&m[k].length<=80)||!['asphalt','patch','metal'].includes(m.kind)||!finite(m.gripScale)||m.gripScale<.1||m.gripScale>1.5||!['moisture','opticalWetness','roughness'].every(k=>finite(m[k])&&m[k]>=0&&m[k]<=1)||!finite(m.rollingTexture)||m.rollingTexture<0||m.rollingTexture>2)throw Error('Invalid surface calibration');
  }
  if(!Array.isArray(descriptor.regions)||descriptor.regions.length<1||descriptor.regions.length>12)throw Error('Invalid surface region count');
  const ids=new Set();for(const r of descriptor.regions){const b=r?.bounds;if(!r||typeof r.id!=='string'||ids.has(r.id)||!descriptor.materials[r.materialId]||!Number.isInteger(r.priority)||r.priority<0||r.priority>100||!b||!['minX','maxX','minZ','maxZ'].every(k=>finite(b[k])&&Math.abs(b[k])<=620)||b.minX>=b.maxX||b.minZ>=b.maxZ)throw Error('Invalid surface region');ids.add(r.id);}
  const text=JSON.stringify(descriptor);if(text.length>20000||text.includes('"__proto__"')||text.includes('"constructor"')||text.includes('"prototype"'))throw Error('Invalid surface payload');
  return clone(descriptor);
}
export function queryRouteSurface(descriptor,x,z,{y=0,normalY=1,baseMu=1.25}={}){
  if(!descriptor||!finite(x)||!finite(z)||!finite(y)||Math.abs(y-descriptor.groundY)>descriptor.contactToleranceM||normalY<.85)return null;
  let selected=null;
  for(const region of descriptor.regions){const b=region.bounds;if(x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ&&(!selected||region.priority>=selected.priority))selected=region;}
  if(!selected)return null;
  const material=descriptor.materials[selected.materialId];
  return {surfaceId:selected.id,materialId:selected.materialId,...material,mu:baseMu*material.gripScale};
}
export function routeSurfaceProgress(descriptor,point){
  if(!descriptor?.route||!point)return null;
  let best=null,offset=0;const points=descriptor.route.waypoints;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),u=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/(length*length)));
    const distance=Math.hypot(point.x-a.x-u*dx,point.z-a.z-u*dz),candidate={distanceM:offset+u*length,lateralDistanceM:distance,segment:i-1,remainingM:descriptor.route.lengthM-offset-u*length};
    if(!best||distance<best.lateralDistanceM)best=candidate;offset+=length;
  }
  return best;
}
