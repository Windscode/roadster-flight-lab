// Metre-scale scanned asphalt. Surface detail changes the distribution of
// reflectance/roughness, not the average material colour used by the GI bake.
// No displaced collision surface, transparent decal, extra draw or screen pass.
const ROAD_MEAN=.965;
const JOINT_MEAN=.020/3.5+.015/13-.020/3.5*.015/13;

export const ROAD_SURFACE_MODEL=Object.freeze({
  scannedTileMetres:4,diffuseScaleMean:ROAD_MEAN,jointCoverageMean:JOINT_MEAN,
  textureReads:{balanced:3,highNear:5,ultraNear:5},detailRangeMetres:[18,42],
  geometryDisplacement:false,additionalDrawCalls:0,
  assumptions:'Dry scanned asphalt, fine repair joints and wear. No wet-road or ray-traced-reflection claim.'
});

export function attachRoadSurface(material,{albedo,normal,roughness}){
  const uniforms={roadAlbedo:{value:albedo},roadNormal:{value:normal},roadRoughness:{value:roughness},roadFineDetail:{value:0}};
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
      uniform float roadFineDetail;
      varying vec3 roadSurfaceWorld;
      float roadJoint(float coordinate,float spacing,float halfWidth){
        float distanceToJoint=abs(mod(coordinate+spacing*.5,spacing)-spacing*.5);
        float footprint=max(fwidth(coordinate),.0002);
        // Once a line is subpixel, converge to its area coverage, not flicker.
        float nearLine=clamp((min(distanceToJoint+footprint*.5,halfWidth)-max(distanceToJoint-footprint*.5,-halfWidth))/footprint,0.,1.);
        return mix(nearLine,2.*halfWidth/spacing,smoothstep(.10,.7,footprint));
      }
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
      float roadLongJoint=roadJoint(roadMetres.x,3.5,.010);
      float roadCrossJoint=roadJoint(roadMetres.y+.28*sin(roadMetres.x*.23),13.,.0075);
      float roadRepairJoint=roadLongJoint+roadCrossJoint-roadLongJoint*roadCrossJoint;
      // Zero-centred broad variation and area-compensated joints preserve the
      // 3.5 bake's mean diffuse scale. Texture mixing preserves its scan mean.
      float roadWear=.5*sin(roadMetres.x*.37+sin(roadMetres.y*.12))*sin(roadMetres.y*.29);
      roadWear*=1.-smoothstep(.7,3.,max(length(dFdx(roadMetres)),length(dFdy(roadMetres))));
      diffuseColor.rgb*=roadColour*(${ROAD_MEAN}+.060*roadWear-.10*(roadRepairJoint-${JOINT_MEAN}));`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      float roadScannedRoughness=textureGrad(roadRoughness,roadUv,roadDx,roadDy).g;
      roughnessFactor=clamp(.885+.20*(roadScannedRoughness-.9314)+.055*roadWear-.055*roadRepairJoint,.72,.96);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 roadN=textureGrad(roadNormal,roadUv,roadDx,roadDy).xyz*2.-1.;
      roadN.xy*=.40;
      if(roadNear>.001){
        vec3 roadFine=textureGrad(roadNormal,roadDetailUv,roadDetailDx,roadDetailDy).xyz*2.-1.;
        roadN.xy+=mat2(.8,.6,-.6,.8)*roadFine.xy*(.15*roadNear);
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
  };
  material.customProgramCacheKey=()=>key+'|road-surface-metres-3.6';
  material.needsUpdate=true;
  return{uniforms,model:ROAD_SURFACE_MODEL,setQuality(q){uniforms.roadFineDetail.value=q==='balanced'?0:1;}};
}
