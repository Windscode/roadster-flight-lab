import * as THREE from './vendor/three.module.js';

const PROFILES={balanced:{street:2,heads:1,size:256,headSize:384,hz:20},high:{street:3,heads:2,size:384,headSize:512,hz:24},ultra:{street:4,heads:2,size:512,headSize:768,hz:30}};
export const CITY_PRACTICAL_LIGHT_BUDGET=Object.freeze(PROFILES);

// Coverage is evaluated on the viewed ground corridor, not merely distance
// to a lamp housing. Camera direction matters at a fixed view or a corner.
export function rankCityPracticalAnchors(anchors,p,{direction={x:0,y:0,z:1},previous=[]}={}){
  const length=Math.hypot(direction.x,direction.z)||1,dx=direction.x/length,dz=direction.z/length;
  const samples=[[0,0,.25],[7,0,.31],[18,0,.26],[5,-4,.09],[5,4,.09]].map(([along,side,weight])=>({point:[p.x+dx*along+dz*side,.35,p.z+dz*along-dx*side],weight}));
  const remembered=new Set(previous),smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  return anchors.map((anchor,index)=>{
    const position=anchor.position,target=anchor.target||[position[0],Math.max(0,position[1]-10),position[2]],axis=target.map((v,k)=>v-position[k]),axisLength=Math.hypot(...axis)||1,
      range=Math.min(32,anchor.range||28),angle=anchor.angle||.90,outer=Math.cos(angle),inner=Math.cos(angle*(1-(anchor.penumbra??.55))),distance=Math.hypot(position[0]-p.x,position[1]-p.y,position[2]-p.z);
    let coverage=0;const contributions=[];
    for(const sample of samples){const d=sample.point.map((v,k)=>v-position[k]),l=Math.hypot(...d),cone=l>0?smooth(outer,inner,d.reduce((sum,v,k)=>sum+v*axis[k],0)/(l*axisLength)):0,
      value=l<range?(anchor.intensity||1500)*cone*(1-(l/range)**4)**2/Math.max(1,l*l):0;coverage+=value*sample.weight;contributions.push(value);}
    const preference=anchor.role==='door'?.80:1,score=coverage*preference*(remembered.has(anchor)?1.20:1);
    return {anchor,index,distance,score,coverage,contributions};
  }).filter(a=>a.distance<58&&a.coverage>.002).sort((a,b)=>b.score-a.score||a.index-b.index);
}

// Reuse a bounded light pool rather than assigning a real light to each sign.
// All selected practicals are shadowed; their downward cones and finite range
// are coupled to visible fixture anchors, reducing through-wall illumination.
export function createCityPracticalLights(scene,anchors){
  const pool=[],heads=[],position=new THREE.Vector3(),point=new THREE.Vector3();
  let quality='balanced',profile=PROFILES.balanced,enabled=false,vehicle=null,lastSelect=-Infinity,lastShadow=-Infinity,lastTime=null,shadowDirty=true;
  const forward=new THREE.Vector3(0,0,1),lastVehicleMatrix=new THREE.Matrix4(),lastViewpoint=new THREE.Vector3(Infinity,Infinity,Infinity);let vehicleMatrixReady=false;
  const stats={enabled:false,streetSpots:0,headlightSpots:0,shadowMaps:0,shadowMapSize:256,shadowHz:20,updates:0,selected:[],
    policy:'Main camera ground coverage, 20% selection hysteresis, one occupied-slot crossfade at a time, 2/3/4 bounded shadowed fixtures. Static bounced diffuse stays continuous between direct-light pools.',selectionAnchor:null,selectionDirection:null,transitions:0};
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
  function update(time,p,camera=null){
    const dt=lastTime===null?1/60:Math.max(0,Math.min(.10,time-lastTime));lastTime=time;
    if(!enabled){stats.streetSpots=stats.headlightSpots=stats.shadowMaps=0;return;}
    if(camera)camera.getWorldDirection(forward);else forward.set(0,0,1);
    stats.selectionAnchor=[p.x,p.y,p.z];stats.selectionDirection=forward.toArray();
    if(lastViewpoint.distanceToSquared(p)>70*70){for(const entry of pool){if(entry.anchor&&Math.hypot(entry.anchor.position[0]-p.x,entry.anchor.position[2]-p.z)>65){entry.anchor=entry.next=null;entry.gain=0;}}lastSelect=-Infinity;}
    lastViewpoint.copy(p);
    if(time-lastSelect>.18||time<lastSelect){
      lastSelect=time;const active=pool.slice(0,profile.street),ranked=rankCityPracticalAnchors(anchors,p,{direction:forward,previous:active.map(e=>e.anchor).filter(Boolean)});
      // Greedy residual coverage avoids spending two scarce slots on the same
      // bright doorway while the next road segment receives no direct light.
      const chosen=[],covered=[0,0,0,0,0];
      for(let slot=0;slot<profile.street;slot++){
        let best=null,bestValue=-1;
        for(const row of ranked){if(chosen.includes(row))continue;const marginal=row.contributions.reduce((sum,v,i)=>sum+Math.max(0,v-covered[i]*.75)*[.25,.31,.26,.09,.09][i],0)*(row.score/Math.max(.00001,row.coverage));if(marginal>bestValue){best=row;bestValue=marginal;}}
        if(!best)break;chosen.push(best);best.contributions.forEach((v,i)=>covered[i]+=v);
      }
      const desired=chosen.map(row=>row.anchor),occupied=new Set(active.map(e=>e.next||e.anchor).filter(Boolean));
      for(const entry of active.filter(e=>!e.anchor&&!e.next)){const next=desired.find(a=>!occupied.has(a));if(next){entry.next=next;occupied.add(next);}}
      const inTransition=active.some(e=>e.anchor!==e.next);
      if(!inTransition){
        const next=desired.find(a=>!occupied.has(a)),out=active.filter(e=>!desired.includes(e.anchor)).sort((a,b)=>(ranked.find(r=>r.anchor===a.anchor)?.score||0)-(ranked.find(r=>r.anchor===b.anchor)?.score||0))[0];
        if(out&&out.next!==(next||null)){out.next=next||null;stats.transitions++;}
      }
    }
    stats.streetSpots=0;stats.selected=[];
    pool.forEach((entry,i)=>{
      const active=i<profile.street,changing=entry.next!==entry.anchor,target=active&&entry.next&&!changing?1:0;
      entry.gain=THREE.MathUtils.damp(entry.gain,target,12,dt);
      if(changing&&entry.gain<.035){
        entry.anchor=entry.next;entry.gain=0;
        if(entry.anchor){const a=entry.anchor;entry.light.position.set(...a.position);entry.light.target.position.set(...(a.target||[a.position[0],Math.max(0,a.position[1]-10),a.position[2]]));entry.light.color.set(a.color||0xffd0a2);entry.light.distance=Math.min(32,a.range||28);entry.light.shadow.camera.far=entry.light.distance;entry.light.angle=a.angle||.90;entry.light.penumbra=a.penumbra??.55;shadowDirty=true;}
      }
      entry.light.visible=active&&!!entry.anchor;
      entry.light.intensity=(entry.anchor?.intensity||1500)*entry.gain;
      if(entry.light.visible){stats.streetSpots++;stats.selected.push({id:entry.anchor.id||'fixture-'+anchors.indexOf(entry.anchor),role:entry.anchor.role||'street',position:[...entry.anchor.position],target:[...(entry.anchor.target||[entry.anchor.position[0],0,entry.anchor.position[2]])],intensity:entry.light.intensity,gain:entry.gain});}
    });
    stats.headlightSpots=0;
    if(vehicle){
      vehicle.updateWorldMatrix(true,false);
      if(!vehicleMatrixReady||vehicle.matrixWorld.elements.some((v,i)=>Math.abs(v-lastVehicleMatrix.elements[i])>.0002)){shadowDirty=true;lastVehicleMatrix.copy(vehicle.matrixWorld);vehicleMatrixReady=true;}
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
    const needed=(shadowDirty||time<lastShadow)&&(time<lastShadow||time-lastShadow>=1/profile.hz);
    if(!needed)return false;
    pool.concat(heads).forEach(({light})=>{if(light.visible)light.shadow.needsUpdate=true;});lastShadow=time;shadowDirty=false;stats.updates++;return true;
  }
  return {stats,configure,update,wantsShadowUpdate,setVehicleRoot(root){vehicle=root;vehicleMatrixReady=false;shadowDirty=true;},
    setEnabled(value){enabled=!!value;stats.enabled=enabled;pool.forEach(({light},i)=>light.visible=enabled&&i<profile.street);heads.forEach(({light},i)=>light.visible=enabled&&!!vehicle&&i<profile.heads);shadowDirty=true;lastSelect=-Infinity;},
    getLights(){return pool.concat(heads).filter(({light})=>light.visible).map(({light})=>light);},
    dispose(){for(const {light}of pool.concat(heads)){light.shadow.map?.dispose();scene.remove(light,light.target);}}
  };
}
