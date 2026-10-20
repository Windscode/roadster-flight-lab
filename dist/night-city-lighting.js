import * as THREE from './vendor/three.module.js';
import {NIGHT_FIELD_LAYOUT} from './city-night-transport.js';

// Static reflected diffuse field. Near practicals keep their existing direct
// shadow maps and car headlights remain entirely dynamic.
export function createNightCityLighting({fetchAsset=fetch,assetFolder='night-irradiance',namespace='night',addIrradiance=true,fadeHeight=true}={}){
  const empty=new THREE.Data3DTexture(new Uint16Array(4),1,1,1);empty.type=THREE.HalfFloatType;empty.format=THREE.RGBAFormat;empty.needsUpdate=true;
  const uniforms={nightCityField:{value:empty},nightRouteField:{value:empty},nightFieldReady:{value:0},nightRouteStep:{value:new THREE.Vector2(8,8)},nightRouteSize:{value:new THREE.Vector2(55,41)}};
  let enabled=false,quality='balanced',loadedTextures=[];const stats={loaded:false,enabled:false,identity:null,algorithm:'Offline occluded fixture → surface → probe diffuse transport / nonnegative ambient cube',
    runtimeTextureReadsPerFragment:3,maximumTransitionReads:6,routeSpacingMetres:8,citySpacingMetres:24,realTimeLightsAdded:0,source:NIGHT_FIELD_LAYOUT.assumptions};
  const ready=(async()=>{
    const base=new URL('./assets/'+assetFolder+'/',import.meta.url),r=await fetchAsset(new URL('manifest.json',base));if(!r.ok)throw Error('Night field manifest unavailable');
    const manifest=await r.json();if(manifest.version!==1||manifest.coefficients!==6)throw Error('Unsupported night field layout');
    const textures=await Promise.all(manifest.volumes.map(async v=>{const response=await fetchAsset(new URL(v.file,base));if(!response.ok)throw Error('Missing night field '+v.file);const data=new Uint16Array(await response.arrayBuffer());
      if(data.length!==v.size[0]*v.size[1]*manifest.heights.length*6*4)throw Error('Invalid night field dimensions');
      const texture=new THREE.Data3DTexture(data,v.size[0],v.size[1],manifest.heights.length*6);texture.type=THREE.HalfFloatType;texture.format=THREE.RGBAFormat;texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
    }));
    loadedTextures=textures;uniforms.nightCityField.value=textures[0];setQuality(quality);uniforms.nightFieldReady.value=enabled?1:0;
    Object.assign(stats,{loaded:true,identity:manifest.identity,geometryCanonicalSHA256:manifest.geometryCanonicalSHA256,anchorSHA256:manifest.anchorSHA256,bounceSources:manifest.bounceSources,bytes:manifest.volumes.reduce((n,v)=>n+v.bytes,0),algorithm:manifest.algorithm||stats.algorithm});return true;
  })().catch(error=>{stats.error=error.message;return false;});
  function setQuality(q){
    quality=q;const coarse=q==='balanced';stats.quality=q;stats.routeSpacingMetres=coarse?8:4;
    uniforms.nightRouteStep.value.set(coarse?8:4,coarse?8:4);uniforms.nightRouteSize.value.set(coarse?55:109,coarse?41:81);
    if(loadedTextures.length)uniforms.nightRouteField.value=loadedTextures[coarse?2:1];
  }
  const glsl=`
    uniform highp sampler3D nightCityField,nightRouteField;uniform float nightFieldReady;uniform vec2 nightRouteStep,nightRouteSize;varying vec3 nightFieldWorld;
    vec3 nightReadField(highp sampler3D field,vec3 p,vec3 n,vec2 origin,vec2 stepM,vec2 dims){
      vec2 uv=((p.xz-origin)/stepM+.5)/dims;float lower=0.,f=(p.y-.6)/1.8;
      if(p.y>=2.4){lower=1.;f=(p.y-2.4)/3.6;}if(p.y>=6.){lower=2.;f=(p.y-6.)/6.;}if(p.y>=12.){lower=3.;f=(p.y-12.)/14.;}
      float height=lower+clamp(f,0.,1.)+.5;
      // Each directional slice owns five height layers. Sampling only within
      // their centre range cannot blend different direction coefficients.
      vec4 x=textureLod(field,vec3(uv,((n.x>=0.?0.:1.)*5.+height)/30.),0.);
      vec4 y=textureLod(field,vec3(uv,((n.y>=0.?2.:3.)*5.+height)/30.),0.);
      vec4 z=textureLod(field,vec3(uv,((n.z>=0.?4.:5.)*5.+height)/30.),0.);
      vec3 E=x.rgb*n.x*n.x+y.rgb*n.y*n.y+z.rgb*n.z*n.z;
      return x.a>.06?E/x.a:vec3(0.);
    }
    vec3 nightBounce(vec3 p,vec3 n){
      p+=n*.18;if(p.y>32.||any(greaterThan(abs(p.xz),vec2(624.))))return vec3(0.);
      float edge=min(min(p.x+304.,128.-p.x),min(p.z+424.,-104.-p.z));
      vec3 E;
      if(edge>=5.)E=nightReadField(nightRouteField,p,n,vec2(-304.,-424.),nightRouteStep,nightRouteSize);
      else{E=nightReadField(nightCityField,p,n,vec2(-624.),vec2(24.),vec2(53.));if(edge>0.)E=mix(E,nightReadField(nightRouteField,p,n,vec2(-304.,-424.),nightRouteStep,nightRouteSize),smoothstep(0.,5.,edge));}
      return E${fadeHeight?'*(1.-smoothstep(24.,32.,p.y))':''};
    }
  `;
  const rename=source=>namespace==='night'?source:source.replace(/\bnight[A-Z]\w*/g,name=>namespace+name.slice(5));
  function inject(shader){
    Object.assign(shader.uniforms,Object.fromEntries(Object.entries(uniforms).map(([name,value])=>[rename(name),value])));
    shader.vertexShader=rename('varying vec3 nightFieldWorld;\n')+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',rename(`vec4 nightPoint=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        nightPoint=instanceMatrix*nightPoint;
      #endif
      nightFieldWorld=(modelMatrix*nightPoint).xyz;
      #include <project_vertex>`));
    shader.fragmentShader=rename(glsl)+shader.fragmentShader;
    // The preceding indirect-light injector may already expand maps. Insert
    // before lights_fragment_end, after irradiance has been initialized.
    if(addIrradiance)shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',rename(`
      #if defined(RE_IndirectDiffuse)
        if(nightFieldReady>.5)irradiance+=nightBounce(nightFieldWorld,inverseTransformDirection(geometryNormal,viewMatrix));
      #endif
      #include <lights_fragment_end>`));
  }
  return {ready,stats,inject,uniforms,setQuality,get shaderKey(){return namespace+'-fixture-ambient-cube-3.11-'+(fadeHeight?'height-fade':'raw-height');},setEnabled(value){enabled=!!value;stats.enabled=enabled;uniforms.nightFieldReady.value=enabled&&stats.loaded?1:0;}};
}
