import * as THREE from './vendor/three.module.js';

// Metre-scale scanned asphalt. Surface detail changes the distribution of
// reflectance/roughness, not the average material colour used by the GI bake.
// No displaced collision surface, transparent decal, extra draw or screen pass.
const ROAD_MEAN=.965;
const JOINT_MEAN=.020/3.5+.015/13-.020/3.5*.015/13;

export const ROAD_SURFACE_MODEL=Object.freeze({
  scannedTileMetres:4,diffuseScaleMean:ROAD_MEAN,jointCoverageMean:JOINT_MEAN,
  textureReads:{balanced:3,highNear:5,ultraNear:5},detailRangeMetres:[18,42],
  geometryDisplacement:false,additionalDrawCalls:0,
  wetness:'Damp aggregate remains rough; sparse shallow puddles collect near road edges and repair depressions. Wheel tracks drain first. Visual wetness does not alter tyre friction.',
  wetRoughness:{dampAsphalt:[.43,.61],standingWater:[.105,.18]},
  streetScale:'Canonical 10/18/22 m route widths; repair joints follow the nearest street direction rather than a world-aligned tile grid.',
  planarReflection:'One clipped low-resolution ground-plane capture in the benchmark district, budgeted only in high/ultra; no SSR/ray-tracing claim.',
  assumptions:'Scanned asphalt with authored repair/water distribution. Water depth, drainage and optical properties are visual engineering estimates.'
});

export function attachRoadSurface(material,{albedo,normal,roughness}){
  const uniforms={roadAlbedo:{value:albedo},roadNormal:{value:normal},roadRoughness:{value:roughness},roadFineDetail:{value:0},roadWetness:{value:0},roadReflection:{value:null},roadReflectionMatrix:{value:new THREE.Matrix4()},roadReflectionTexel:{value:new THREE.Vector2(1/512,1/288)},roadReflectionEnabled:{value:0},roadReflectionStrength:{value:0}};
  const original=material.onBeforeCompile,key=material.customProgramCacheKey();
  // World projection is used explicitly; the unused per-map UV transforms must
  // not accidentally create a second normal frame on long instanced ramps.
  material.normalMap=null;material.roughnessMap=null;
  material.onBeforeCompile=function(shader,renderer){
    original?.call(this,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 roadSurfaceWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vec4 roadSurfacePoint=vec4(transformed,1.);
      #ifdef USE_BATCHING
      roadSurfacePoint=batchingMatrix*roadSurfacePoint;
      #endif
      #ifdef USE_INSTANCING
      roadSurfacePoint=instanceMatrix*roadSurfacePoint;
      #endif
      roadSurfaceWorld=(modelMatrix*roadSurfacePoint).xyz;
      #include <project_vertex>`);
    shader.fragmentShader=`
      uniform sampler2D roadAlbedo,roadNormal,roadRoughness;
      uniform float roadFineDetail,roadWetness,roadReflectionEnabled,roadReflectionStrength;
      uniform sampler2D roadReflection;uniform mat4 roadReflectionMatrix;uniform vec2 roadReflectionTexel;
      varying vec3 roadSurfaceWorld;
      float roadJoint(float coordinate,float spacing,float halfWidth){
        float distanceToJoint=abs(mod(coordinate+spacing*.5,spacing)-spacing*.5);
        float footprint=max(fwidth(coordinate),.0002);
        // Once a line is subpixel, converge to its area coverage, not flicker.
        float nearLine=clamp((min(distanceToJoint+footprint*.5,halfWidth)-max(distanceToJoint-footprint*.5,-halfWidth))/footprint,0.,1.);
        return mix(nearLine,2.*halfWidth/spacing,smoothstep(.10,.7,footprint));
      }
      float roadHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      // Dominant-axis projection also gives vertical road-slab edges a valid
      // normal frame; no three-way triplanar texture multiplication is needed.
      vec3 roadGeometryNormal=inverseTransformDirection(normalize(vNormal),viewMatrix);
      vec3 roadAxis=abs(roadGeometryNormal);
      vec2 roadMetres=roadAxis.y>=max(roadAxis.x,roadAxis.z)?roadSurfaceWorld.xz:
        roadAxis.x>roadAxis.z?roadSurfaceWorld.zy:roadSurfaceWorld.xy;
      vec2 roadUv=roadMetres*.25,roadDx=dFdx(roadUv),roadDy=dFdy(roadUv);
      vec2 roadDetailUv=mat2(.8,-.6,.6,.8)*roadUv*2.3+vec2(.37,.71);
      vec2 roadDetailDx=mat2(.8,-.6,.6,.8)*roadDx*2.3;
      vec2 roadDetailDy=mat2(.8,-.6,.6,.8)*roadDy*2.3;
      float roadNear=roadFineDetail*(1.-smoothstep(18.,42.,length(vViewPosition)));
      vec3 roadColour=textureGrad(roadAlbedo,roadUv,roadDx,roadDy).rgb;
      if(roadNear>.001)roadColour=mix(roadColour,textureGrad(roadAlbedo,roadDetailUv,roadDetailDx,roadDetailDy).rgb,.20*roadNear);
      // Orient large-scale wear to the authored streets. The scan's 4 m grain
      // stays metric, while 9–22 m repair patches break its obvious repetition.
      float roadAcross=roadMetres.x,roadAlong=roadMetres.y,roadWidth=18.;
      float routeDistance=10000.,candidate;
      candidate=abs(roadMetres.x+200.);if(roadMetres.y> -410.&&roadMetres.y<42.&&candidate<routeDistance){routeDistance=candidate;roadAcross=roadMetres.x+200.;roadWidth=10.;}
      candidate=abs(roadMetres.x-100.);if(roadMetres.y> -412.&&roadMetres.y<492.&&candidate<routeDistance){routeDistance=candidate;roadAcross=roadMetres.x-100.;roadWidth=18.;}
      candidate=abs(roadMetres.y+400.);if(roadMetres.x> -582.&&roadMetres.x<112.&&candidate<routeDistance){routeDistance=candidate;roadAcross=roadMetres.y+400.;roadAlong=roadMetres.x;roadWidth=22.;}
      candidate=abs(roadMetres.y+132.5);if(roadMetres.x> -312.&&roadMetres.x<212.&&candidate<routeDistance){routeDistance=candidate;roadAcross=roadMetres.y+132.5;roadAlong=roadMetres.x;roadWidth=18.;}
      float routeWearMask=(1.-smoothstep(roadWidth*.5,roadWidth*.5+1.,routeDistance))*(1.-smoothstep(.12,.25,abs(roadSurfaceWorld.y)));
      float roadLongJoint=roadJoint(roadAcross,roadWidth*.5,.012);
      float repairCell=floor(roadAlong/19.),repairShift=roadHash(vec2(repairCell,3.7))*6.;
      float roadCrossJoint=roadJoint(roadAlong+repairShift,19.,.008)*(1.-smoothstep(roadWidth*.19,roadWidth*.48,abs(roadAcross)));
      float roadRepairJoint=roadLongJoint+roadCrossJoint-roadLongJoint*roadCrossJoint;
      // Keep the original scan scale. Added wear and wetness are approximate
      // dynamic finishes; the retained static diffuse bake is not recomputed.
      float roadWear=.5*sin(roadMetres.x*.21+sin(roadMetres.y*.09))*sin(roadMetres.y*.23);
      roadWear*=1.-smoothstep(.7,3.,max(length(dFdx(roadMetres)),length(dFdy(roadMetres))));
      float wheelTrack=routeWearMask*(1.-smoothstep(.18,1.5,abs(abs(roadAcross)-roadWidth*.25)));
      float repairPatch=smoothstep(.08,.17,fract((roadAlong+repairShift)/19.))*(1.-smoothstep(.71,.79,fract((roadAlong+repairShift)/19.)));
      repairPatch=mix(.4,repairPatch*smoothstep(.20,.29,roadHash(vec2(repairCell,floor((roadAcross+roadWidth*.5)/3.6)))),routeWearMask);
      // Rain film and standing water are distinct surfaces. Broad damp
      // asphalt keeps aggregate and rough reflections; only depressions and
      // the drained carriageway edge receive the planar puddle term.
      float roadCurbBasin=routeWearMask*smoothstep(roadWidth*.31,roadWidth*.48,abs(roadAcross));
      float puddleContour=.48+.23*sin(roadAlong*.46+sin(roadAcross*1.08))+.15*sin(roadAcross*.91-roadAlong*.17);
      float edgePuddle=smoothstep(.44,.76,puddleContour)*roadCurbBasin;
      float repairPuddle=smoothstep(.66,.81,puddleContour)*(.32+.46*repairPatch)*(1.-wheelTrack*.82);
      float roadRainFilm=roadWetness*(.61+.12*sin(roadAlong*.11)*sin(roadAcross*.52));
      float roadWater=roadWetness*max(edgePuddle,repairPuddle)*smoothstep(.55,.95,roadAxis.y);
      diffuseColor.rgb*=roadColour*(${ROAD_MEAN}+.090*roadWear-.085*(roadRepairJoint-${JOINT_MEAN})-.055*wheelTrack-.045*(repairPatch-.4))*mix(1.,.79,roadRainFilm)*mix(1.,.72,roadWater);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      float roadScannedRoughness=textureGrad(roadRoughness,roadUv,roadDx,roadDy).g;
      float roadDryRoughness=clamp(.885+.20*(roadScannedRoughness-.9314)+.055*roadWear-.055*roadRepairJoint-.045*wheelTrack,.72,.96);
      float dampAggregate=clamp(.50+.11*(roadScannedRoughness-.83)+.075*roadWear,.43,.61);
      roughnessFactor=mix(mix(roadDryRoughness,dampAggregate,roadWetness),.105+.075*(1.-roadWater),roadWater);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 roadN=textureGrad(roadNormal,roadUv,roadDx,roadDy).xyz*2.-1.;
      roadN.xy*=mix(.40-.09*roadRainFilm,.065,roadWater);
      if(roadNear>.001){
        vec3 roadFine=textureGrad(roadNormal,roadDetailUv,roadDetailDx,roadDetailDy).xyz*2.-1.;
        roadN.xy+=mat2(.8,.6,-.6,.8)*roadFine.xy*(.15*roadNear)*(1.-roadWater*.8);
      }
      float roadDet=roadDx.x*roadDy.y-roadDy.x*roadDx.y;
      vec3 roadQ0=dFdx(-vViewPosition),roadQ1=dFdy(-vViewPosition);
      vec3 roadT=(roadQ0*roadDy.y-roadQ1*roadDx.y)*sign(roadDet);
      roadT-=normal*dot(normal,roadT);
      if(abs(roadDet)>1e-12&&dot(roadT,roadT)>1e-14){
        roadT=normalize(roadT);
        vec3 roadB=normalize(cross(normal,roadT))*sign(roadDet);
        // The derivative frame incorporates the surface's handedness once.
        vec3 roadExpectedB=(-roadQ0*roadDy.x+roadQ1*roadDx.x)*sign(roadDet);
        roadB*=dot(roadB,roadExpectedB)<0.?-1.:1.;
        normal=normalize(mat3(roadT,roadB,normal)*normalize(roadN));
      }`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      // This is a sparse planar specular term, masked to the real ground level
      // and captured region. Its diffuse/normal/roughness still come from PBR.
      if(roadReflectionEnabled>.5&&roadWater>.08&&abs(roadSurfaceWorld.y)<.08){
        vec4 roadProjection=roadReflectionMatrix*vec4(roadSurfaceWorld,1.);
        vec2 roadReflectionUv=roadProjection.xy/max(roadProjection.w,.0001);
        float roadRegion=min(min(roadSurfaceWorld.x+245.,145.-roadSurfaceWorld.x),min(roadSurfaceWorld.z+425.,-105.-roadSurfaceWorld.z));
        float roadEdge=min(min(roadReflectionUv.x,1.-roadReflectionUv.x),min(roadReflectionUv.y,1.-roadReflectionUv.y));
        float roadReflectionMask=roadReflectionStrength*smoothstep(0.,.045,roadEdge)*smoothstep(0.,9.,roadRegion)*(1.-smoothstep(36.,65.,length(vViewPosition)));
        if(roadProjection.w>0.&&roadReflectionMask>.001){
          vec2 roadBlur=roadReflectionTexel*(1.3+roughnessFactor*4.0);
          vec2 roadWarp=roadN.xy*.0025;
          vec3 roadReflected=texture2D(roadReflection,roadReflectionUv+roadWarp).rgb*.40;
          roadReflected+=texture2D(roadReflection,roadReflectionUv+roadWarp+roadBlur*vec2(1.,0.)).rgb*.15;
          roadReflected+=texture2D(roadReflection,roadReflectionUv+roadWarp+roadBlur*vec2(-1.,0.)).rgb*.15;
          roadReflected+=texture2D(roadReflection,roadReflectionUv+roadWarp+roadBlur*vec2(0.,1.)).rgb*.15;
          roadReflected+=texture2D(roadReflection,roadReflectionUv+roadWarp+roadBlur*vec2(0.,-1.)).rgb*.15;
          float roadFresnel=.020+.98*pow(1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.),5.);
          // Replace the already counted environment specular over the captured
          // puddle coverage. Adding both made grazing wet roads overbright.
          outgoingLight+=(roadReflected*roadFresnel-reflectedLight.indirectSpecular)*roadWater*roadReflectionMask;
        }
      }
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>key+'|road-surface-damp-aggregate-puddles-domain-fade-3.12';
  material.needsUpdate=true;
  return{uniforms,model:ROAD_SURFACE_MODEL,setWetness(value){uniforms.roadWetness.value=Math.min(1,Math.max(0,Number(value)||0));},setQuality(q){uniforms.roadFineDetail.value=q==='balanced'?0:1;}};
}
