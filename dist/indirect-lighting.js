import * as THREE from './vendor/three.module.js';
import {SUN_DIRECTION,irradianceAt} from './irradiance-math.js';

// Static, three-surface diffuse transport is baked offline. At runtime the
// directional irradiance is interpolated in space, independently of specular
// cube maps. This is a finite-resolution irradiance field, not live ray tracing.
export function createIndirectLighting(renderer,{fetchAsset=fetch}={}){
  const empty=new THREE.DataArrayTexture(new Uint16Array(4),1,1,1);empty.type=THREE.HalfFloatType;empty.format=THREE.RGBAFormat;empty.needsUpdate=true;
  const uniforms={giCity:{value:empty},giStreet:{value:empty},giSky:{value:Array.from({length:9},()=>new THREE.Vector3())},giReady:{value:0},giAO:{value:null},giAOEnabled:{value:0},giViewport:{value:new THREE.Vector2(1,1)}};
  const stats={algorithm:'Offline 3-bounce diffuse path tracing / spatial order-2 SH',loaded:false,bounces:3,evaluation:'fragment',maximumFieldTextureReadsPerFragment:36};
  let metadata=null,evaluation='fragment',enabled=true;const cpuVolumes=[];
  const ready=(async()=>{
    const base=new URL('./assets/irradiance/',import.meta.url),response=await fetchAsset(new URL('manifest.json',base));if(!response.ok)throw Error('Missing irradiance manifest');metadata=await response.json();
    metadata.skySH.forEach((v,i)=>uniforms.giSky.value[Math.floor(i/3)].setComponent(i%3,v));
    const textures=await Promise.all(metadata.volumes.map(async v=>{const r=await fetchAsset(new URL(v.file,base));if(!r.ok)throw Error('Missing '+v.file);const data=new Uint16Array(await r.arrayBuffer());if(data.length!==v.size[0]*v.size[1]*v.heights.length*9*4)throw Error('Invalid GI volume size');cpuVolumes.push({volume:v,coefficients:Float32Array.from(data,THREE.DataUtils.fromHalfFloat)});const t=new THREE.DataArrayTexture(data,v.size[0],v.size[1],v.heights.length*9);t.type=THREE.HalfFloatType;t.format=THREE.RGBAFormat;t.minFilter=t.magFilter=THREE.LinearFilter;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.generateMipmaps=false;t.needsUpdate=true;return t;}));
    uniforms.giCity.value=textures[0];uniforms.giStreet.value=textures[1];uniforms.giReady.value=enabled?1:0;Object.assign(stats,{loaded:true,validProbes:metadata.validProbes,samplesPerProbe:metadata.samplesPerProbe,bytes:metadata.volumes.reduce((s,v)=>s+v.bytes,0)});return true;
  })().catch(error=>{stats.error=error.message;console.warn('Indirect-light field:',error.message);return false;});
  const glsl=`
    uniform highp sampler2DArray giCity,giStreet;
    uniform vec3 giSky[9];uniform float giReady,giAOEnabled;
    uniform sampler2D giAO;uniform vec2 giViewport;varying vec3 giWorld;
    void giBasis(vec3 n,out float b[9]){
      b[0]=.886227;b[1]=1.023328*n.y;b[2]=1.023328*n.z;b[3]=1.023328*n.x;
      b[4]=.858086*n.x*n.y;b[5]=.858086*n.y*n.z;b[6]=.743125*n.z*n.z-.247708;b[7]=.858086*n.x*n.z;b[8]=.429043*(n.x*n.x-n.y*n.y);
    }
    vec3 giSkyE(vec3 n){float b[9];giBasis(n,b);vec3 E=vec3(0.);for(int i=0;i<9;i++)E+=giSky[i]*b[i];return max(E,vec3(0.));}
    vec3 giField(highp sampler2DArray field,vec3 p,vec3 n,vec2 origin,vec2 stepM,vec2 dims){
      vec2 uv=((p.xz-origin)/stepM+.5)/dims;
      float lower=0.,f=0.;
      if(p.y<2.6){f=(p.y-.8)/1.8;}
      else if(p.y<6.){lower=1.;f=(p.y-2.6)/3.4;}
      else if(p.y<14.){lower=2.;f=(p.y-6.)/8.;}
      else if(p.y<32.){lower=3.;f=(p.y-14.)/18.;}
      else{lower=4.;f=(p.y-32.)/32.;}
      f=clamp(f,0.,1.);float b[9];giBasis(n,b);vec3 E=vec3(0.);float validity=0.;
      for(int i=0;i<9;i++){
        vec4 a=textureLod(field,vec3(uv,lower*9.+float(i)),0.),c=textureLod(field,vec3(uv,(lower+1.)*9.+float(i)),0.);
        vec4 coefficient=mix(a,c,f);E+=coefficient.rgb*b[i];validity=coefficient.a;
      }
      return validity>.06?max(E/max(validity,.06),vec3(0.)):giSkyE(n);
    }
    vec3 giIrradiance(vec3 p,vec3 n){
      // Offset into the visible side of the surface. Solid probes were rejected
      // by the baker, then valid weights are normalized after interpolation.
      p+=n*.26;
      vec3 E=giSkyE(n);
      if(all(greaterThanEqual(p.xz,vec2(-624.)))&&all(lessThanEqual(p.xz,vec2(624.)))&&p.y<=64.){
      E=giField(giCity,p,n,vec2(-624.),vec2(32.),vec2(40.));
      if(p.x>-224.&&p.x< -176.&&p.z>-416.&&p.z<48.){
        float edge=min(min(p.x+224.,-176.-p.x),min(p.z+416.,48.-p.z));
        vec3 fine=giField(giStreet,p,n,vec2(-224.,-416.),vec2(4.,8.),vec2(13.,59.));E=mix(E,fine,smoothstep(0.,4.,edge));
      }
      }
      return E;
    }
  `;
  function inject(shader){
    Object.assign(shader.uniforms,uniforms);
    const vertex=evaluation==='vertex';
    // The smooth preset evaluates the same physical baked SH coefficients at
    // vertices. This removes 18 (or 36 in the fine street volume) texture reads
    // per shaded pixel; it changes interpolation resolution, not light energy.
    if(vertex){
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+glsl+'\nvarying vec3 giVertexIrradiance;');
      shader.fragmentShader='uniform float giReady,giAOEnabled;uniform sampler2D giAO;uniform vec2 giViewport;varying vec3 giVertexIrradiance;\n'+shader.fragmentShader;
    }else shader.vertexShader='varying vec3 giWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vec4 giPosition=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      giPosition=instanceMatrix*giPosition;
      #endif
      giWorld=(modelMatrix*giPosition).xyz;
      ${vertex?'giVertexIrradiance=giReady>.5?giIrradiance(giWorld,inverseTransformDirection(transformedNormal,viewMatrix)):vec3(0.);':''}
      #include <project_vertex>`);
    if(!vertex)shader.fragmentShader=glsl+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>',THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );',`if(giReady>.5)iblIrradiance+=${vertex?'giVertexIrradiance':'giIrradiance(giWorld,inverseTransformDirection(geometryNormal,viewMatrix))'};else iblIrradiance+=getIBLIrradiance(geometryNormal);`));
    shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`#include <aomap_fragment>
      if(giAOEnabled>.5){float contactAO=texture2D(giAO,gl_FragCoord.xy/giViewport).r;reflectedLight.indirectDiffuse*=mix(.78,1.,contactAO);}`);
  }
  function evaluate(volume,p,n){
    const {volume:v,coefficients:data}=volume,[nx,nz]=v.size,heights=v.heights;
    const gx=Math.max(0,Math.min(nx-1,(p.x-v.min[0])/v.step[0])),gz=Math.max(0,Math.min(nz-1,(p.z-v.min[1])/v.step[1]));
    const x=Math.min(nx-2,Math.floor(gx)),z=Math.min(nz-2,Math.floor(gz));let y=0;
    while(y<heights.length-2&&p.y>heights[y+1])y++;
    const f=[gx-x,Math.max(0,Math.min(1,(p.y-heights[y])/(heights[y+1]-heights[y]))),gz-z],c=new Array(27).fill(0);let validity=0;
    for(let dy=0;dy<2;dy++)for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++){
      const w=(dx?f[0]:1-f[0])*(dy?f[1]:1-f[1])*(dz?f[2]:1-f[2]);
      for(let j=0;j<9;j++){const i=((((y+dy)*9+j)*nz+z+dz)*nx+x+dx)*4;if(j===0)validity+=w*data[i+3];for(let k=0;k<3;k++)c[j*3+k]+=w*data[i+k];}
    }
    return validity>.06?irradianceAt(c.map(v=>v/validity),n):irradianceAt(metadata.skySH,n);
  }
  function exposureAt(p,sunVisible=true){
    if(!metadata||cpuVolumes.length<2)return .90;
    const normals=[[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]],weights=[.35,.1625,.1625,.1625,.1625];
    const inside=Math.abs(p.x)<624&&Math.abs(p.z)<624&&p.y<64;
    const fine=p.x>-220&&p.x< -180&&p.z>-412&&p.z<44,volume=cpuVolumes.find(v=>v.volume.id===(fine?'lower-market':'city'));
    const luminance=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
    let reference=0,metered=0;
    normals.forEach((n,i)=>{
      const sky=irradianceAt(metadata.skySH,n),E=inside?evaluate(volume,p,n):sky;
      const sunlight=metadata.sunIntensity*Math.max(0,n.reduce((s,v,k)=>s+v*SUN_DIRECTION[k],0))*.952;
      reference+=weights[i]*(luminance(sky)+sunlight);metered+=weights[i]*(luminance(E)+(sunVisible?sunlight:0));
    });
    // Camera adaptation, not a light source. The same sky/sun reference keeps
    // exposed locations near the calibrated exposure; shade can gain 1.6 EV.
    return .90*Math.max(1,Math.min(3,Math.sqrt(reference/Math.max(.025,metered))));
  }

  return{ready,stats,inject,uniforms,exposureAt,setEnabled(value){enabled=!!value;uniforms.giReady.value=enabled&&stats.loaded?1:0;stats.enabled=enabled;},get metadata(){return metadata;},get shaderKey(){return 'gi-'+evaluation+'-v3';},
    setQuality(q,profile={}){evaluation=profile.giMode||(q==='balanced'?'vertex':'fragment');stats.evaluation=evaluation;stats.maximumFieldTextureReadsPerFragment=evaluation==='vertex'?0:36;},
    setContactAO(t){uniforms.giAO.value=t;},setAOEnabled(v){uniforms.giAOEnabled.value=v?1:0;},resize(){renderer.getDrawingBufferSize(uniforms.giViewport.value);}};
}

export function makeSunlessEnvironment(hdr,metadata){
  const texture=hdr.clone(),data=new Uint16Array(hdr.image.data);texture.image={...hdr.image,data};
  const w=hdr.image.width,h=hdr.image.height,sun=SUN_DIRECTION,fill=metadata?.sunFill||[1,1,1];
  const cx=(Math.atan2(sun[2],sun[0])/(2*Math.PI)+.5)*w,cy=Math.acos(sun[1])/Math.PI*h;
  for(let y=Math.max(0,Math.floor(cy-18));y<Math.min(h,cy+18);y++)for(let x=Math.floor(cx-24);x<cx+24;x++){
    const a=(x/w-.5)*2*Math.PI,t=y/h*Math.PI,d=[Math.cos(a)*Math.sin(t),Math.cos(t),Math.sin(a)*Math.sin(t)];
    if(d.reduce((s,v,i)=>s+v*sun[i],0)<Math.cos(.025))continue;
    const i=(y*w+(x+w)%w)*4;for(let c=0;c<3;c++)data[i+c]=THREE.DataUtils.toHalfFloat(fill[c]);
  }
  texture.needsUpdate=true;texture.name='sunless sky / sun supplied once by CSM';return texture;
}
