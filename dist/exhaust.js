import * as THREE from './vendor/three.module.js';

// Entrained condensation mist, not CFD or an additional source of forces.
const clamp=THREE.MathUtils.clamp;
export function plumeOutlets(nozzles=[]) {
  const outlets=[];
  for(const n of nozzles){
    const direction=new THREE.Vector3(-n.direction.x,-n.direction.y,-n.direction.z).normalize();
    if(n.kind==='longitudinal'&&n.direction.z>.7&&n.position.z<0){
      for(let i=0;i<4;i++)outlets.push({id:`${n.id}-${i}`,position:new THREE.Vector3((i-1.5)*.32,-.035,-2.322),direction:direction.clone(),force:n.force/4});
    }else{
      const position=new THREE.Vector3(n.position.x,n.position.y,n.position.z);
      if(n.kind==='roll')position.addScaledVector(direction,.158);
      if(n.kind==='longitudinal'&&n.direction.z<-.7)position.addScaledVector(direction,.266);
      outlets.push({id:n.id,position,direction,force:n.force});
    }
  }
  return outlets;
}

export class ColdGasExhaust {
  constructor(scene,sim,{capacity=8000,seed=3721}={}){
    this.scene=scene;this.sim=sim;this.capacity=capacity;this.particles=[];this.clocks=new Map();this.previous=new Map();this.emitted=0;this.seed=seed;this.particleLimit=capacity;this.emissionScale=1;this.lifeScale=1;this.surfaceCache=new Map();this._scratch=new THREE.Vector3();this._sorted=[];
    const base=new THREE.PlaneGeometry(1,1),g=new THREE.InstancedBufferGeometry();g.index=base.index;g.attributes.position=base.attributes.position;g.attributes.uv=base.attributes.uv;
    const attributes={aWorld:[3,new Float32Array(capacity*3)],aSize:[1,new Float32Array(capacity)],aOpacity:[1,new Float32Array(capacity)],aAngle:[1,new Float32Array(capacity)],aStretch:[1,new Float32Array(capacity)],aSeed:[1,new Float32Array(capacity)]};
    for(const [name,[size,array]]of Object.entries(attributes))g.setAttribute(name,new THREE.InstancedBufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount=0;
    const mat=new THREE.ShaderMaterial({defines:{MIST_LIGHTWEIGHT:0},transparent:true,depthWrite:false,depthTest:true,blending:THREE.NormalBlending,uniforms:{sceneDepth:{value:null},depthEnabled:{value:0},depthViewport:{value:new THREE.Vector2(1,1)},cameraNear:{value:.07},cameraFar:{value:2300},mistColor:{value:new THREE.Color('#f0f3f2')},fogColor:{value:scene.fog?.color||new THREE.Color('#a5b2ae')},fogDensity:{value:scene.fog?.density||.0019},mistAmbient:{value:new THREE.Color(.35,.38,.40)},mistLampPosition:{value:Array.from({length:4},()=>new THREE.Vector3())},mistLampColor:{value:Array.from({length:4},()=>new THREE.Color(0,0,0))},mistLampRange:{value:[1,1,1,1]}},
      vertexShader:`attribute vec3 aWorld;attribute float aSize,aOpacity,aAngle,aStretch,aSeed;varying vec2 vUv;varying vec3 mistWorld;varying float vOpacity,vSeed,vDepth;
        void main(){vUv=uv;mistWorld=aWorld;vOpacity=aOpacity;vSeed=aSeed;vec4 view=viewMatrix*vec4(aWorld,1.);vec2 offset=position.xy*vec2(aSize,aSize*aStretch);float c=cos(aAngle),s=sin(aAngle);view.xy+=mat2(c,-s,s,c)*offset;vDepth=-view.z;gl_Position=projectionMatrix*view;}`,
      fragmentShader:`uniform sampler2D sceneDepth;uniform float depthEnabled,cameraNear,cameraFar;uniform vec2 depthViewport;uniform vec3 mistColor,fogColor,mistAmbient,mistLampPosition[4],mistLampColor[4];uniform float fogDensity,mistLampRange[4];varying vec2 vUv;varying vec3 mistWorld;varying float vOpacity,vSeed,vDepth;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
        void main(){vec2 p=vUv-.5;float n;
        #if MIST_LIGHTWEIGHT == 1
        n=noise(vUv*5.+vSeed*13.);
        #else
        n=.65*noise(vUv*5.+vSeed*13.)+.35*noise(vUv*13.+vSeed);
        #endif
        float r=length(p)+.16*(n-.5);float edge=1.-smoothstep(.12,.52,r);float alpha=1.-exp(-vOpacity*edge*(.32+.68*n));if(depthEnabled>.5){float depth=texture2D(sceneDepth,gl_FragCoord.xy/depthViewport).x;float sceneDistance=cameraNear*cameraFar/(cameraFar-(cameraFar-cameraNear)*depth);alpha*=clamp((sceneDistance-vDepth)/.12,0.,1.);}if(alpha<.003)discard;vec3 illumination=mistAmbient;vec3 eye=normalize(cameraPosition-mistWorld);
        #if MIST_LIGHTWEIGHT != 1
        for(int i=0;i<4;i++){vec3 delta=mistLampPosition[i]-mistWorld;float d=length(delta);float attenuation=pow(clamp(1.-pow(d/mistLampRange[i],4.),0.,1.),2.)/max(d*d,.2);float phase=.065*(1.+.45*pow(max(dot(normalize(delta),-eye),0.),3.));illumination+=mistLampColor[i]*attenuation*phase;}
        #endif
        vec3 color=mistColor*illumination*(.88+.12*n);float fog=1.-exp(-fogDensity*fogDensity*vDepth*vDepth);gl_FragColor=vec4(mix(color,fogColor,fog),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`});
    this.mesh=new THREE.Mesh(g,mat);this.mesh.name='world-space cold-gas mist';this.mesh.frustumCulled=false;this.mesh.renderOrder=2;scene.add(this.mesh);
  }
  setQuality(quality,profile={}){
    this.particleLimit=Math.min(this.capacity,profile.particleLimit||this.capacity);this.emissionScale=profile.particleRate||1;this.lifeScale=profile.particleLife||1;
    if(this.particles.length>this.particleLimit)this.particles.splice(0,this.particles.length-this.particleLimit);
    const material=this.mesh.material,next=quality==='balanced'?1:0;
    if(material.defines.MIST_LIGHTWEIGHT!==next){material.defines.MIST_LIGHTWEIGHT=next;material.needsUpdate=true;}
  }
  random(){this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/4294967296;}
  setLighting(ambient,lights=[]){const u=this.mesh.material.uniforms;u.mistAmbient.value.copy(ambient);for(let i=0;i<4;i++){const l=lights[i];if(l){u.mistLampPosition.value[i].copy(l.position);u.mistLampColor.value[i].copy(l.color).multiplyScalar(l.intensity);u.mistLampRange.value[i]=l.distance||30;}else u.mistLampColor.value[i].setRGB(0,0,0);}}
  setDepth(texture,width,height,near,far,enabled=true){const u=this.mesh.material.uniforms;u.sceneDepth.value=texture;u.depthViewport.value.set(width,height);u.cameraNear.value=near;u.cameraFar.value=far;u.depthEnabled.value=enabled?1:0;}
  reset(){this.particles.length=0;this.clocks.clear();this.previous.clear();this.surfaceCache.clear();this.mesh.geometry.instanceCount=0;this.emitted=0;}
  update(t,dt,camera){
    dt=clamp(Number.isFinite(dt)?dt:0,0,.1);
    const q=new THREE.Quaternion(t.quaternion.x,t.quaternion.y,t.quaternion.z,t.quaternion.w),center=new THREE.Vector3(t.position.x,t.position.y,t.position.z);
    const carrier=new THREE.Vector3(t.velocity.x,t.velocity.y,t.velocity.z),omega=new THREE.Vector3(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z);
    if(dt>0){
      const decay=Math.exp(-3.6*dt);
      for(const p of this.particles){
        p.age+=dt;p.position.addScaledVector(p.velocity,(1-decay)/3.6);p.velocity.multiplyScalar(decay);p.velocity.y+=.20*dt;
        if(!p.core&&!p.impacted){const a=(1-Math.exp(-p.age*9))*7*dt;p.velocity.addScaledVector(p.tangent,(Math.sin(p.age*19+p.seed*33)+.5*Math.sin(p.age*43+p.seed*89))*a);p.velocity.addScaledVector(p.bitangent,Math.cos(p.age*23+p.seed*57)*a);}
        if(p.surface){
          const gap=this._scratch.copy(p.position).sub(p.surface.point).dot(p.surface.normal);
          if(gap<.035){
            p.position.addScaledVector(p.surface.normal,.035-gap);const vn=p.velocity.dot(p.surface.normal);
            if(vn<0)p.velocity.addScaledVector(p.surface.normal,-vn*1.03);
            if(!p.impacted){const tangent=new THREE.Vector3(this.random()-.5,this.random()-.5,this.random()-.5);tangent.addScaledVector(p.surface.normal,-tangent.dot(p.surface.normal)).normalize();p.velocity.addScaledVector(tangent,6+8*this.random());p.impacted=true;p.growth*=1.35;}
          }
        }
      }
      this.particles=this.particles.filter(p=>p.age<p.life);
    }
    for(const outlet of plumeOutlets(t.nozzles)){
      const offset=outlet.position.clone().applyQuaternion(q),origin=center.clone().add(offset),direction=outlet.direction.clone().applyQuaternion(q);
      const previous=this.previous.get(outlet.id)||origin;this.previous.set(outlet.id,origin.clone());
      if(dt===0||outlet.force<25)continue;
      const strength=clamp(outlet.force/20000,0,1.5),flow=outlet.force/(t.effectiveExhaustVelocity||this.sim?.params.exhaustVelocity||650);
      const rate=(45+flow*32)*this.emissionScale,priorClock=this.clocks.get(outlet.id)||0,clock=priorClock+rate*dt,count=Math.floor(clock);this.clocks.set(outlet.id,clock-count);
      let cached=this.surfaceCache.get(outlet.id);
      if(!cached||t.simTime-cached.time>.06||cached.origin.distanceToSquared(origin)>.09||cached.direction.dot(direction)<.995){
        const hit=this.sim?.traceSurface(origin,direction,9);
        cached={time:t.simTime,origin:origin.clone(),direction:direction.clone(),surface:hit?{point:new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z),normal:new THREE.Vector3(hit.normal.x,hit.normal.y,hit.normal.z)}:null};this.surfaceCache.set(outlet.id,cached);
      }
      const surface=cached.surface;
      const moving=carrier.clone().add(new THREE.Vector3().crossVectors(omega,offset));
      const tangent=new THREE.Vector3().crossVectors(direction,Math.abs(direction.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize();
      const bitangent=new THREE.Vector3().crossVectors(direction,tangent).normalize();
      for(let i=0;i<count;i++){
        if(this.particles.length>=this.particleLimit)break;
        const fraction=clamp((i+1-priorClock)/(rate*dt),0,1),age=dt*(1-fraction),angle=this.random()*Math.PI*2,spread=.12+.20*Math.sqrt(strength),radius=(this.random()-.5)*.055,seed=this.random(),core=this.emitted%3===0;
        const position=previous.clone().lerp(origin,fraction).addScaledVector(direction,.035).addScaledVector(tangent,Math.cos(angle)*radius).addScaledVector(bitangent,Math.sin(angle)*radius);
        const velocity=moving.clone().addScaledVector(direction,core?28+12*seed:28+16*Math.sqrt(strength)).addScaledVector(tangent,Math.cos(angle)*spread).addScaledVector(bitangent,Math.sin(angle)*spread);
        // Births occur throughout the physical frame; ageing/advecting each one
        // avoids a visible train of coincident puffs at the display frequency.
        const birthDecay=Math.exp(-3.6*age);position.addScaledVector(velocity,(1-birthDecay)/3.6);velocity.multiplyScalar(birthDecay);
        this.particles.push({position,velocity,age,life:core?.19+.05*seed:(1.25+.5*seed)*this.lifeScale,size:core?.10+.05*Math.sqrt(strength):.13+.07*Math.sqrt(strength),growth:core?.30:1.3+seed*.7,
          opacity:(core?3.5:(.30+.25*Math.sqrt(strength))*Math.min(1.7,1/Math.sqrt(this.emissionScale)))*Math.min(1,Math.sqrt(outlet.force/3000)),stretch:core?6.0:2.0,core,tangent:tangent.clone(),bitangent:bitangent.clone(),seed,surface,impacted:false});this.emitted++;
      }
    }
    const sorted=this._sorted;sorted.length=0;for(const p of this.particles){p.sortDepth=camera?p.position.distanceToSquared(camera.position):0;sorted.push(p);}if(camera)sorted.sort((a,b)=>b.sortDepth-a.sortDepth);
    const a=this.mesh.geometry.attributes,view=camera?.matrixWorldInverse;
    for(let i=0;i<sorted.length;i++){
      const p=sorted[i],life=clamp(p.age/p.life,0,1),fade=Math.min(1,p.age/(p.core?.008:.025))*(1-life)*(1-life);
      a.aWorld.setXYZ(i,p.position.x,p.position.y,p.position.z);a.aSize.setX(i,Math.min(3.2,p.size+p.age*p.growth));a.aOpacity.setX(i,p.opacity*fade);a.aStretch.setX(i,p.impacted?.30:1+(p.stretch-1)*Math.exp(-p.age*5));a.aSeed.setX(i,p.seed);
      if(p.impacted&&p.surface&&view){const normal=this._scratch.copy(p.surface.normal).transformDirection(view);a.aAngle.setX(i,-Math.atan2(normal.x,normal.y));}
      else if(p.stretch>1&&view){const direction=this._scratch.copy(p.velocity).transformDirection(view);a.aAngle.setX(i,-Math.atan2(direction.x,direction.y));}
      else a.aAngle.setX(i,p.seed*6.28+p.age*.2);
    }
    for(const attribute of Object.values(a))if(attribute.isInstancedBufferAttribute&&sorted.length){attribute.clearUpdateRanges();attribute.addUpdateRange(0,sorted.length*attribute.itemSize);attribute.needsUpdate=true;}
    this.mesh.geometry.instanceCount=sorted.length;
    if(this.scene.fog){this.mesh.material.uniforms.fogColor.value.copy(this.scene.fog.color);this.mesh.material.uniforms.fogDensity.value=this.scene.fog.density;}
  }
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
