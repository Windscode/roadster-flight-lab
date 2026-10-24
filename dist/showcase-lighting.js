// A closed 0.62 m display has its own low-output shelf luminaire. This local
// diffuse approximation is assigned only to that display's opaque contents;
// it does not add a world light, illuminate streets or alter the city bake.
export const SHOWCASE_LIGHTING=Object.freeze({version:'confined-display-light-3.24',intensityCd:12,minimumDistanceM:.18,
  samples:3,warmRGB:[1,.78,.52],coolRGB:[.78,.90,1],
  scope:'Three unshadowed samples of a finite downward shelf bar; diffuse only, confined to authored display receivers. No inter-object visibility, specular, spill or baked transport claim.'});

export function showcaseIrradiance(point,normal,light){
  if(!light)return[0,0,0];
  const colour=light.cool?SHOWCASE_LIGHTING.coolRGB:SHOWCASE_LIGHTING.warmRGB;
  let power=0;
  for(const offset of [-1,0,1]){
    const delta=light.position.map((v,k)=>v+light.span[k]*offset-point[k]),distance=Math.hypot(...delta);
    if(distance<1e-8)continue;
    const direction=delta.map(v=>v/distance),cosine=Math.max(0,normal.reduce((s,v,k)=>s+v*direction[k],0)),downward=Math.max(0,direction[1]);
    power+=SHOWCASE_LIGHTING.intensityCd/3*cosine*downward/Math.max(SHOWCASE_LIGHTING.minimumDistanceM**2,distance**2);
  }
  return colour.map(v=>v*power);
}

export function attachShowcaseLighting(material){
  if(material.userData.showcaseLighting)return;
  material.userData.showcaseLighting=SHOWCASE_LIGHTING;
  // Shared urban materials also draw distant walls. Batches with no showcase
  // use constant zero attributes, avoiding two buffers for every city instance.
  material.defaultAttributeValues={...material.defaultAttributeValues,showcaseEmitter:[0,0,0,0],showcaseSpan:[0,0,0,0]};
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    previous?.call(this,shader,renderer);
    shader.vertexShader='attribute vec4 showcaseEmitter;attribute vec4 showcaseSpan;\nvarying vec4 vShowcaseEmitter;varying vec4 vShowcaseSpan;varying vec3 vShowcaseWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`vShowcaseEmitter=showcaseEmitter;vShowcaseSpan=showcaseSpan;
      vec4 showcasePosition=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      showcasePosition=instanceMatrix*showcasePosition;
      #endif
      vShowcaseWorld=(modelMatrix*showcasePosition).xyz;
      #include <project_vertex>`);
    shader.fragmentShader='varying vec4 vShowcaseEmitter;varying vec4 vShowcaseSpan;varying vec3 vShowcaseWorld;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`
      if(vShowcaseEmitter.w>0.){
        vec3 showcaseNormal=inverseTransformDirection(geometryNormal,viewMatrix);
        float showcasePower=0.;
        for(int sampleIndex=0;sampleIndex<3;sampleIndex++){
          vec3 showcaseDelta=vShowcaseEmitter.xyz+vShowcaseSpan.xyz*(float(sampleIndex)-1.)-vShowcaseWorld;
          float showcaseDistanceSquared=max(dot(showcaseDelta,showcaseDelta),.00000001);
          vec3 showcaseDirection=showcaseDelta*inversesqrt(showcaseDistanceSquared);
          showcasePower+=vShowcaseEmitter.w/3.*max(dot(showcaseNormal,showcaseDirection),0.)*max(showcaseDirection.y,0.)/max(showcaseDistanceSquared,.0324);
        }
        vec3 showcaseColour=mix(vec3(1.,.78,.52),vec3(.78,.90,1.),vShowcaseSpan.w);
        reflectedLight.directDiffuse+=showcaseColour*showcasePower*BRDF_Lambert(material.diffuseColor);
      }
      #include <lights_fragment_end>`);
  };
  material.customProgramCacheKey=()=>key+'|'+SHOWCASE_LIGHTING.version;
}

export function installShowcaseLighting(THREE,geometry,instances){
  if(!instances.some(instance=>instance.showcaseLight))return 0;
  const emitter=new Float32Array(instances.length*4),span=new Float32Array(instances.length*4);
  for(let i=0;i<instances.length;i++){
    const light=instances[i].showcaseLight;if(!light)continue;
    emitter.set([...light.position,SHOWCASE_LIGHTING.intensityCd],i*4);span.set([...light.span,Number(!!light.cool)],i*4);
  }
  geometry.setAttribute('showcaseEmitter',new THREE.InstancedBufferAttribute(emitter,4));
  geometry.setAttribute('showcaseSpan',new THREE.InstancedBufferAttribute(span,4));
  return emitter.byteLength+span.byteLength;
}
