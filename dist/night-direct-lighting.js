import * as THREE from './vendor/three.module.js';
import {createNightCityLighting} from './night-city-lighting.js';

// The original night bake contains bounced light only. Beyond the small real
// spotlight pool that left visible lamps over an unlit street. This separate
// field supplies stationary DIRECT diffuse light with static visibility.
// A complementary 12–28 m blend replaces the pool's diffuse term on static
// surfaces; it is never simply added on top of the same real direct light.
export const NIGHT_DIRECT_BLEND=Object.freeze({nearMetres:12,farMetres:28,maximumBytes:4*1024*1024,
  scope:'Static city diffuse; car/headlights remain dynamic; real spot specular is retained.',
  limits:'Far shadows use the 4/8 m static envelope field. The transition blends two lighting approximations; moving-car shadows are retained in the near live region, not in the far baked region.'});

export function createNightDirectLighting(options={}){
  // The shared bounce field normally fades itself above 24 m. Here the same
  // domain weight also restores live diffuse, so apply it once in the blend.
  // Fading this field again would darken an equal live/baked signal by 25%
  // halfway through the height transition.
  const field=createNightCityLighting({...options,assetFolder:'night-direct-irradiance',namespace:'stationary',addIrradiance:false,fadeHeight:false});
  const uniforms={stationaryViewpoint:{value:new THREE.Vector3()},stationaryPoolPositions:{value:Array.from({length:4},()=>new THREE.Vector3(1e8,1e8,1e8))}};
  Object.assign(field.stats,{transport:'Static direct diffuse with complementary live blend',blend:NIGHT_DIRECT_BLEND,maximumAdditionalTextureReads:3,maximumTransitionTextureReads:6,realTimeLightsAdded:0});
  function update(camera,practicalStats){
    uniforms.stationaryViewpoint.value.copy(camera.position);
    for(let i=0;i<4;i++){const selected=practicalStats.selected[i];if(selected)uniforms.stationaryPoolPositions.value[i].fromArray(selected.position);else uniforms.stationaryPoolPositions.value[i].set(1e8,1e8,1e8);}
  }
  function inject(shader){
    field.inject(shader);Object.assign(shader.uniforms,uniforms);
    const helpers=`uniform vec3 stationaryViewpoint;uniform vec3 stationaryPoolPositions[4];
      float stationaryFarWeight(vec3 p){
        if(stationaryFieldReady<.5||p.y>32.||any(greaterThan(abs(p.xz),vec2(624.))))return 0.;
        float domain=(1.-smoothstep(24.,32.,p.y))*(1.-smoothstep(600.,624.,max(abs(p.x),abs(p.z))));
        return smoothstep(${NIGHT_DIRECT_BLEND.nearMetres.toFixed(1)},${NIGHT_DIRECT_BLEND.farMetres.toFixed(1)},distance(p,stationaryViewpoint))*domain;
      }
      bool stationaryPoolLight(vec3 viewPosition){
        for(int k=0;k<4;k++)if(distance(viewPosition,(viewMatrix*vec4(stationaryPoolPositions[k],1.)).xyz)<.04)return true;
        return false;
      }
    `;
    shader.fragmentShader=shader.fragmentShader.replace('void main() {',helpers+'\nvoid main() {');
    // The city injector expands this chunk before us (for local probe sun).
    // Standalone validators may still present the original include.
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',THREE.ShaderChunk.lights_fragment_begin);
    const start=shader.fragmentShader.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'),end=shader.fragmentShader.indexOf('#if ( NUM_DIR_LIGHTS > 0 )',start);
    if(start<0||end<0)throw Error('Unsupported spot-light shader layout for stationary direct blend');
    let spots=shader.fragmentShader.slice(start,end);
    const direct='RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
    if(!spots.includes(direct))throw Error('Stationary direct blend cannot locate the spot diffuse term');
    spots=spots.replace(direct,`{vec3 stationaryBeforeDiffuse=reflectedLight.directDiffuse;
      ${direct}
      if(stationaryPoolLight(spotLight.position))reflectedLight.directDiffuse=mix(reflectedLight.directDiffuse,stationaryBeforeDiffuse,stationaryFarWeight(stationaryFieldWorld));}`);
    shader.fragmentShader=shader.fragmentShader.slice(0,start)+spots+shader.fragmentShader.slice(end);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`
      #if defined(RE_IndirectDiffuse)
        float stationaryWeight=stationaryFarWeight(stationaryFieldWorld);
        if(stationaryWeight>.001)irradiance+=stationaryBounce(stationaryFieldWorld,inverseTransformDirection(geometryNormal,viewMatrix))*stationaryWeight;
      #endif
      #include <lights_fragment_end>`);
  }
  return {...field,inject,update,uniforms:{...field.uniforms,...uniforms},get shaderKey(){return 'stationary-direct-complementary-atlas-3.13';}};
}
