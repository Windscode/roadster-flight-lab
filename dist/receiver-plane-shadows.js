import * as THREE from './vendor/three.module.js';

// A PCF footprint compares several DIFFERENT light-space positions. Comparing
// them all against the centre depth gives a sloping, unoccluded surface a
// periodic false shadow. Correct each tap for the receiver plane instead of
// moving the whole surface farther from its real shadow.
export const RECEIVER_PLANE_SHADOW_MODEL=Object.freeze({id:'receiver-plane-pcf-3.11',
  mechanism:'Per-tap projected receiver-depth correction; derivatives evaluated before light branches',
  extraTextureReads:0,extraShadowMaps:0,changesLightIntensity:false,changesReceiverNormalBias:false,
  limits:'First-order receiver plane; silhouette/depth discontinuities and curved geometry still require a small normal/depth bias and rendered inspection.'});
// Exposed only for same-frame diagnostics; production defaults to correction.
export const receiverPlaneShadowEnabled={value:1};

function replaceShadowCalls(source){
  for(const [varying,array] of [['vDirectionalShadowCoord','roadsterDirectionalPlane'],['vSpotLightCoord','roadsterSpotPlane']]){
    const pattern=new RegExp('\\bgetShadow\\(\\s*([^\\n;]*?),\\s*'+varying+'\\s*\\[\\s*([^\\]]+)\\s*\\]\\s*\\)','g');
    source=source.replace(pattern,(_,args,index)=>`roadsterGetShadow(${args},${varying}[${index}],${array}[${index}])`);
  }
  return source;
}

export function injectReceiverPlaneShadows(shader){
  if(shader.fragmentShader.includes('roadsterPlaneCompare'))return;
  shader.uniforms.roadsterPlaneEnabled=receiverPlaneShadowEnabled;
  const original=THREE.ShaderChunk.shadowmap_pars_fragment,start=original.indexOf('float getShadow('),end=original.indexOf('vec2 cubeToUV',start);
  if(start<0||end<0)throw Error('Unsupported shadow comparison layout');
  let plane=original.slice(start,end).replace('float getShadow(','float roadsterGetShadow(').replace('vec4 shadowCoord )','vec4 shadowCoord, vec2 receiverPlane )');
  plane=plane.replace(/texture2DCompare\( shadowMap, ([\s\S]*?), shadowCoord.z \)/g,(_,uv)=>`roadsterPlaneCompare( shadowMap, ${uv}, shadowCoord.z, shadowCoord.xy, receiverPlane, shadowMapSize )`);
  const compare=`
    uniform float roadsterPlaneEnabled;
    float roadsterPlaneCompare(sampler2D depths,vec2 uv,float reference,vec2 origin,vec2 plane,vec2 mapSize){
      vec2 sampleCentre=(floor(uv*mapSize)+.5)/mapSize;
      return texture2DCompare(depths,uv,reference+dot(sampleCentre-origin,plane)*roadsterPlaneEnabled);
    }
  `;
  const gradients=`
    vec2 roadsterReceiverPlane(vec4 coordinate){
      vec3 p=coordinate.xyz/max(abs(coordinate.w),1.e-8);
      vec3 dx=dFdx(p),dy=dFdy(p);
      float determinant=dx.x*dy.y-dx.y*dy.x;
      if(abs(determinant)<1.e-14)return vec2(0.);
      vec2 gradient=vec2(dy.y*dx.z-dx.y*dy.z,dx.x*dy.z-dy.x*dx.z)/determinant;
      return clamp(gradient,vec2(-2.),vec2(2.));
    }
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      vec2 roadsterDirectionalPlane[NUM_DIR_LIGHT_SHADOWS];
    #endif
    #if defined(USE_SHADOWMAP) && NUM_SPOT_LIGHT_SHADOWS > 0
      vec2 roadsterSpotPlane[NUM_SPOT_LIGHT_SHADOWS];
    #endif
  `;
  shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',original.slice(0,end)+compare+plane+original.slice(end)+'\n'+gradients);
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',THREE.ShaderChunk.lights_fragment_begin);
  shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmask_pars_fragment>',THREE.ShaderChunk.shadowmask_pars_fragment);
  shader.fragmentShader=replaceShadowCalls(shader.fragmentShader);
  shader.fragmentShader=shader.fragmentShader.replace('void main() {',`void main() {
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      #pragma unroll_loop_start
      for(int i=0;i<NUM_DIR_LIGHT_SHADOWS;i++){
        roadsterDirectionalPlane[i]=roadsterReceiverPlane(vDirectionalShadowCoord[i]);
      }
      #pragma unroll_loop_end
    #endif
    #if defined(USE_SHADOWMAP) && NUM_SPOT_LIGHT_SHADOWS > 0
      #pragma unroll_loop_start
      for(int i=0;i<NUM_SPOT_LIGHT_SHADOWS;i++){
        roadsterSpotPlane[i]=roadsterReceiverPlane(vSpotLightCoord[i]);
      }
      #pragma unroll_loop_end
    #endif`);
}

export function attachReceiverPlaneShadows(material){
  if(material.userData.receiverPlaneShadows)return material;
  const original=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){original?.call(this,shader,renderer);injectReceiverPlaneShadows(shader);};
  material.customProgramCacheKey=()=>key+'|'+RECEIVER_PLANE_SHADOW_MODEL.id;
  material.userData.receiverPlaneShadows=RECEIVER_PLANE_SHADOW_MODEL.id;material.needsUpdate=true;return material;
}
