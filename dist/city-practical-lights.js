import * as THREE from './vendor/three.module.js';

const PROFILES={balanced:{street:2,heads:1,size:256,headSize:384,hz:20},high:{street:3,heads:2,size:384,headSize:512,hz:24},ultra:{street:4,heads:2,size:512,headSize:768,hz:30}};
export const CITY_PRACTICAL_LIGHT_BUDGET=Object.freeze(PROFILES);

// Reuse a bounded light pool rather than assigning a real light to each sign.
// All selected practicals are shadowed; their downward cones and finite range
// are coupled to visible fixture anchors, reducing through-wall illumination.
export function createCityPracticalLights(scene,anchors){
  const pool=[],heads=[],position=new THREE.Vector3(),point=new THREE.Vector3();
  let quality='balanced',profile=PROFILES.balanced,enabled=false,vehicle=null,lastSelect=-Infinity,lastShadow=-Infinity,lastTime=null,shadowDirty=true;
  const stats={enabled:false,streetSpots:0,headlightSpots:0,shadowMaps:0,shadowMapSize:256,shadowHz:20,updates:0,selected:[],
    policy:'Near shadowed fixtures and finite-range headlamps. Distant signs are emissive surfaces only; no light pool teleport while visibly lit.'};
  const add=(isHead,index)=>{
    const light=new THREE.SpotLight(isHead?0xe6f0ff:0xffd1a0,0,isHead?66:30,isHead?.29:.90,.55,2);
    light.name=(isHead?'Roadster headlamp ':'City practical ')+index;
    light.castShadow=true;light.shadow.camera.near=.10;light.shadow.camera.far=light.distance;
    light.shadow.bias=-.00008;light.shadow.normalBias=isHead?.004:.014;light.shadow.radius=2;
    light.shadow.autoUpdate=false;light.shadow.needsUpdate=true;light.visible=false;scene.add(light,light.target);
    return {light,anchor:null,gain:0,next:null,index};
  };
  for(let i=0;i<4;i++)pool.push(add(false,i));for(let i=0;i<2;i++)heads.push(add(true,i));
  function resizeShadow(entry,size){if(entry.light.shadow.mapSize.x===size)return;entry.light.shadow.mapSize.set(size,size);entry.light.shadow.map?.dispose();entry.light.shadow.map=null;entry.light.shadow.needsUpdate=true;}
  function configure(q){
    quality=q;profile=PROFILES[q]||PROFILES.balanced;
    pool.forEach((entry,i)=>{resizeShadow(entry,profile.size);entry.light.visible=enabled&&i<profile.street;});
    heads.forEach((entry,i)=>{resizeShadow(entry,profile.headSize);entry.light.visible=enabled&&!!vehicle&&i<profile.heads;});
    Object.assign(stats,{shadowMapSize:profile.size,headlightShadowMapSize:profile.headSize,shadowHz:profile.hz});shadowDirty=true;lastSelect=-Infinity;
  }
  function update(time,p){
    const dt=lastTime===null?1/60:Math.max(0,Math.min(.10,time-lastTime));lastTime=time;
    if(!enabled){stats.streetSpots=stats.headlightSpots=stats.shadowMaps=0;return;}
    if(time-lastSelect>.18||time<lastSelect){
      lastSelect=time;
      const ranked=anchors.map((anchor,index)=>({anchor,index,distance:Math.hypot(anchor.position[0]-p.x,anchor.position[1]-p.y,anchor.position[2]-p.z)}))
        .filter(a=>a.distance<Math.min(40,(a.anchor.range||28)+8)).sort((a,b)=>a.distance-b.distance||a.index-b.index);
      // At least one available road fixture survives nearby doorway lights.
      // The rest of the same small pool can reveal the vehicle/facade contact.
      const road=ranked.find(a=>a.anchor.role==='street'),selected=ranked.slice(0,profile.street);
      if(road&&!selected.includes(road)&&selected.length)selected[selected.length-1]=road;
      ranked.splice(0,ranked.length,...selected);
      const desired=new Set(ranked.map(a=>a.anchor)),occupied=new Set();
      for(const entry of pool.slice(0,profile.street))if(entry.anchor&&desired.has(entry.anchor)){entry.next=entry.anchor;occupied.add(entry.anchor);}else entry.next=null;
      for(const candidate of ranked.filter(a=>!occupied.has(a.anchor))){const free=pool.slice(0,profile.street).find(entry=>!entry.next);if(free)free.next=candidate.anchor;}
    }
    stats.streetSpots=0;stats.selected=[];
    pool.forEach((entry,i)=>{
      const active=i<profile.street,changing=entry.next!==entry.anchor,target=active&&entry.next&&!changing?1:0;
      entry.gain=THREE.MathUtils.damp(entry.gain,target,12,dt);
      if(changing&&entry.gain<.035){
        entry.anchor=entry.next;entry.gain=0;
        if(entry.anchor){const a=entry.anchor;entry.light.position.set(...a.position);entry.light.target.position.set(...(a.target||[a.position[0],Math.max(0,a.position[1]-10),a.position[2]]));entry.light.color.set(a.color||0xffd0a2);entry.light.distance=Math.min(32,a.range||28);entry.light.shadow.camera.far=entry.light.distance;shadowDirty=true;}
      }
      entry.light.visible=active&&!!entry.anchor;
      entry.light.intensity=(entry.anchor?.intensity||1500)*entry.gain;
      if(entry.light.visible){stats.streetSpots++;stats.selected.push({position:[...entry.anchor.position],gain:entry.gain});}
    });
    stats.headlightSpots=0;
    if(vehicle){
      vehicle.updateWorldMatrix(true,false);
      heads.forEach((entry,i)=>{
        entry.light.visible=i<profile.heads;if(!entry.light.visible)return;
        const side=profile.heads===1?0:(i===0?-1:1);
        position.set(side*.56,-.018,2.327).applyMatrix4(vehicle.matrixWorld);
        point.set(side*.92,-.50,24).applyMatrix4(vehicle.matrixWorld);
        entry.light.position.copy(position);entry.light.target.position.copy(point);entry.light.intensity=profile.heads===1?12500:8000;
        stats.headlightSpots++;
      });
    }
    stats.shadowMaps=stats.streetSpots+stats.headlightSpots;
  }
  function wantsShadowUpdate(time){
    if(!enabled)return false;
    const needed=shadowDirty||time<lastShadow||time-lastShadow>=1/profile.hz;
    if(!needed)return false;
    pool.concat(heads).forEach(({light})=>{if(light.visible)light.shadow.needsUpdate=true;});lastShadow=time;shadowDirty=false;stats.updates++;return true;
  }
  return {stats,configure,update,wantsShadowUpdate,setVehicleRoot(root){vehicle=root;shadowDirty=true;},
    setEnabled(value){enabled=!!value;stats.enabled=enabled;pool.forEach(({light},i)=>light.visible=enabled&&i<profile.street);heads.forEach(({light},i)=>light.visible=enabled&&!!vehicle&&i<profile.heads);shadowDirty=true;lastSelect=-Infinity;},
    getLights(){return pool.concat(heads).filter(({light})=>light.visible).map(({light})=>light);},
    dispose(){for(const {light}of pool.concat(heads)){light.shadow.map?.dispose();scene.remove(light,light.target);}}
  };
}
