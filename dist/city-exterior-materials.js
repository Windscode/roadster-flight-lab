/**
 * Exterior surfaces at metre scale. Uses this project's existing mineral scans
 * only for concrete; paint, metal, glazing and shutters have separate responses.
 * Detail never displaces collision or silhouette geometry. No interior mapping,
 * transparency, transmission render target or copied game texture is introduced.
 */
export const EXTERIOR_SURFACES=Object.freeze({
  concrete:Object.freeze({roughness:.90,metalness:0,tileMetres:2.5,baseDiffuseScale:.76}),
  enamel:Object.freeze({roughness:.40,metalness:0,tileMetres:1,baseDiffuseScale:1}),
  metal:Object.freeze({roughness:.48,metalness:.82,tileMetres:1,baseDiffuseScale:1}),
  frame:Object.freeze({roughness:.28,metalness:.90,tileMetres:1,baseDiffuseScale:1}),
  glass:Object.freeze({roughness:.13,metalness:0,tileMetres:1,baseDiffuseScale:1}),
  shutter:Object.freeze({roughness:.54,metalness:.72,tileMetres:1,baseDiffuseScale:1}),
});

// Full 1024² scan averages, decoded with the standard sRGB transfer function.
// Neutralized scan contrast leaves the shared authored wall tint / .76 diffuse
// envelope model unchanged. The roughness image is linear data, not sRGB colour.
export const MINERAL_SCAN_MEAN=Object.freeze({linearRGB:[.20091006904210976,.169245237992863,.11505865403087426],roughness:.5171397340038038});

export function createCityExteriorMaterials(THREE){
  const textures=[],bindings=new Map(),quality={value:0},scanReady={value:0};
  const stats={quality:'balanced',materialKinds:[],textureCount:0,scanLoaded:false,scanTileMetres:2.5,
    uvContract:'Local face UV multiplied by each instance metre dimensions; independent of world yaw.',
    normalContract:'Cotangent frame with UV determinant, tangent length and normal length guards.',
    fineDetail:'Derivative-filtered, with an additional distance fade; no displacement.',interiorTextures:0,transparentMaterials:0};
  const maps={};
  const ready=typeof document==='undefined'?Promise.resolve(false):Promise.all([
    ['colour','concrete.jpg',true],['normal','concrete-normal.jpg',false],['roughness','concrete-roughness.jpg',false],
  ].map(([key,file,srgb])=>new Promise(resolve=>{
    const texture=new THREE.TextureLoader().load(new URL('./assets/'+file,import.meta.url).href,()=>resolve(true),undefined,()=>resolve(false));
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;
    if(srgb)texture.colorSpace=THREE.SRGBColorSpace;
    textures.push(texture);maps[key]=texture;
  }))).then(results=>{scanReady.value=results.every(Boolean)?1:0;stats.scanLoaded=scanReady.value===1;return stats.scanLoaded;});
  stats.textureCount=textures.length;
  const common=`
    varying vec2 vExteriorUv;
    varying vec3 vExteriorWorld;
    uniform float exteriorQuality,exteriorScanReady;
    uniform sampler2D exteriorMineral,exteriorMineralNormal,exteriorMineralRoughness;
    float exteriorPulseIntegral(float coordinate,float duty){
      float shifted=coordinate+.5*duty;
      return floor(shifted)*duty+min(fract(shifted),duty);
    }
    float exteriorLine(float coordinate,float spacing,float width){
      // Integrate a periodic rectangular seam over this pixel footprint. A
      // distant seam tends to width/spacing, never to a whole dark panel.
      float footprint=max(fwidth(coordinate)/spacing,.0001);
      float q=coordinate/spacing,duty=clamp(width/spacing,0.,1.);
      return clamp((exteriorPulseIntegral(q+.5*footprint,duty)-exteriorPulseIntegral(q-.5*footprint,duty))/footprint,0.,1.);
    }
    vec3 exteriorMappedNormal(vec3 n,vec3 tangentNormal,vec2 uv){
      vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition);
      vec2 st0=dFdx(uv),st1=dFdy(uv);
      float uvDet=st0.x*st1.y-st0.y*st1.x;
      vec3 perpendicular1=cross(q1,n),perpendicular0=cross(n,q0);
      vec3 t=perpendicular1*st0.x+perpendicular0*st1.x;
      vec3 b=perpendicular1*st0.y+perpendicular0*st1.y;
      float tangentLength=max(dot(t,t),dot(b,b));
      if(abs(uvDet)<1.e-12||tangentLength<1.e-16)return n;
      float scale=inversesqrt(tangentLength);
      vec3 mapped=mat3(t*scale,b*scale,n)*tangentNormal;
      return dot(mapped,mapped)>1.e-12?normalize(mapped):n;
    }
    vec3 exteriorHeightNormal(vec3 n,float height){
      vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
      vec3 r1=cross(dy,n),r2=cross(n,dx);
      float determinant=dot(dx,r1);
      if(abs(determinant)<1.e-12)return n;
      vec3 mapped=abs(determinant)*n-sign(determinant)*(dFdx(height)*r1+dFdy(height)*r2);
      return dot(mapped,mapped)>1.e-16?normalize(mapped):n;
    }
  `;
  function attach(material,kind){
    if(bindings.has(material))return material;
    const surface=EXTERIOR_SURFACES[kind];if(!surface)throw Error('Unknown exterior surface: '+kind);
    bindings.set(material,{kind,surface});stats.materialKinds=[...new Set([...bindings.values()].map(v=>v.kind))];
    material.roughness=surface.roughness;material.metalness=surface.metalness;
    material.userData.exteriorSurface=kind;
    const originalCompile=material.onBeforeCompile,originalKey=material.customProgramCacheKey();
    material.onBeforeCompile=function(shader,renderer){
      originalCompile?.call(this,shader,renderer);
      Object.assign(shader.uniforms,{exteriorQuality:quality,exteriorScanReady:scanReady,
        exteriorMineral:{value:maps.colour||null},exteriorMineralNormal:{value:maps.normal||null},exteriorMineralRoughness:{value:maps.roughness||null}});
      shader.vertexShader=`
        #ifdef USE_INSTANCING
        attribute vec4 exteriorMetric;
        #endif
        varying vec2 vExteriorUv;varying vec3 vExteriorWorld;
      `+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        vec3 exteriorDimensions=vec3(1.);float exteriorShape=0.;
        #ifdef USE_INSTANCING
          exteriorDimensions=max(exteriorMetric.xyz,vec3(.0001));exteriorShape=exteriorMetric.w;
        #endif
        vec3 exteriorFace=abs(normal);
        vec2 exteriorFaceMetres=exteriorFace.y>.9?exteriorDimensions.xz:exteriorFace.x>.9?exteriorDimensions.zy:exteriorDimensions.xy;
        if(exteriorShape>.5&&exteriorFace.y<.9)exteriorFaceMetres=vec2(3.14159265*(exteriorDimensions.x+exteriorDimensions.z)*.5,exteriorDimensions.y);
        vExteriorUv=uv*exteriorFaceMetres;
        vec4 exteriorPosition=vec4(transformed,1.);
        #ifdef USE_INSTANCING
          exteriorPosition=instanceMatrix*exteriorPosition;
        #endif
        vExteriorWorld=(modelMatrix*exteriorPosition).xyz;
      `);
      // vViewPosition is declared by the built-in shader before these helpers.
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+common);
      const base=`
        float exteriorFootprint=max(length(fwidth(vExteriorUv)),.00001);
        float exteriorDistance=length(cameraPosition-vExteriorWorld);
        float exteriorFine=(1.-smoothstep(.018,.075,exteriorFootprint))*(1.-smoothstep(45.,110.,exteriorDistance));
        float exteriorRelief=0.;float exteriorRoughDelta=0.;
      `;
      let colour='',normal='';
      if(kind==='concrete'){
        const mean=MINERAL_SCAN_MEAN.linearRGB;
        const meanLuminance=mean[0]*.2126+mean[1]*.7152+mean[2]*.0722;
        colour=`
          diffuseColor.rgb*=.76;
          if(exteriorScanReady>.5){
            float mineral=dot(texture2D(exteriorMineral,vExteriorUv/2.5).rgb,vec3(.2126,.7152,.0722));
            diffuseColor.rgb*=1.+.18*(mineral/${meanLuminance.toFixed(12)}-1.);
            if(exteriorQuality>.5)exteriorRoughDelta=(texture2D(exteriorMineralRoughness,vExteriorUv/2.5).g-${MINERAL_SCAN_MEAN.roughness.toFixed(12)})*.42;
          }
        `;
        normal=`
          if(exteriorQuality>.5&&exteriorScanReady>.5){
            vec3 mineralNormal=texture2D(exteriorMineralNormal,vExteriorUv/2.5).xyz*2.-1.;
            mineralNormal.xy*=mix(.28,.42,step(1.5,exteriorQuality))*exteriorFine;
            normal=exteriorMappedNormal(normal,normalize(mineralNormal),vExteriorUv/2.5);
          }
        `;
      }else if(kind==='enamel'){
        colour=`
          float jointX=exteriorLine(vExteriorUv.x,.60,.003),jointY=exteriorLine(vExteriorUv.y,.30,.003);
          float enamelJoint=jointX+jointY-jointX*jointY,jointMean=.003/.60+.003/.30-.003*.003/(.60*.30);
          diffuseColor.rgb*=1.-.12*(enamelJoint-jointMean)*exteriorFine;
          exteriorRoughDelta=.07*enamelJoint;
          exteriorRelief=-.0013*enamelJoint*exteriorFine;
        `;
      }else if(kind==='shutter'){
        colour=`
          float slatFilter=1.-smoothstep(.012,.05,exteriorFootprint);
          float slat=cos(vExteriorUv.y*57.11986643);
          diffuseColor.rgb*=1.+.055*slat*slatFilter;
          exteriorRoughDelta=.07*slat*slatFilter;
          exteriorRelief=.0035*slat*slatFilter;
        `;
      }else if(kind==='glass'){
        colour=`
          // Sealed, opaque facade glazing: reflection, edge seal and surface
          // waviness only. There is no fake room image or transmission pass.
          float sealX=exteriorLine(vExteriorUv.x,1.4,.018),sealY=exteriorLine(vExteriorUv.y,3.2,.018);
          float seal=sealX+sealY-sealX*sealY,sealMean=.018/1.4+.018/3.2-.018*.018/(1.4*3.2);
          diffuseColor.rgb*=1.-.28*(seal-sealMean);
          exteriorRoughDelta=.10*seal+.022*cos(vExteriorUv.y*1.3)*cos(vExteriorUv.x*2.1)*(1.-smoothstep(.3,1.5,exteriorFootprint));
          exteriorRelief=.00018*sin(vExteriorUv.x*2.1)*sin(vExteriorUv.y*1.3)*exteriorFine;
        `;
      }else{
        colour=`
          float brushedFilter=1.-smoothstep(.00065,.0028,exteriorFootprint);
          float brushed=sin(vExteriorUv.y*1450.)*brushedFilter;
          exteriorRoughDelta=.065*brushed;
          exteriorRelief=.000013*brushed*exteriorFine;
        `;
      }
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+base+colour);
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=clamp(roughnessFactor+exteriorRoughDelta,${kind==='glass'?'.085':'.20'},.98);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        ${normal}
        if(exteriorQuality>.5)normal=exteriorHeightNormal(normal,exteriorRelief);
      `);
    };
    material.customProgramCacheKey=()=>originalKey+'|city-exterior-metres-v1|'+kind;
    material.needsUpdate=true;return material;
  }
  function installGeometry(geometry,instances,shape){
    const metric=new Float32Array(instances.length*4);
    for(let i=0;i<instances.length;i++){
      const matrix=instances[i].matrix.elements||instances[i].matrix;
      metric.set([Math.hypot(matrix[0],matrix[1],matrix[2]),Math.hypot(matrix[4],matrix[5],matrix[6]),Math.hypot(matrix[8],matrix[9],matrix[10]),shape==='cylinder'?1:0],i*4);
    }
    geometry.setAttribute('exteriorMetric',new THREE.InstancedBufferAttribute(metric,4));
  }
  return{attach,installGeometry,ready,stats,setQuality(q){stats.quality=q;quality.value=q==='ultra'?2:q==='high'?1:0;textures.forEach(t=>{const anisotropy=q==='balanced'?2:8;if(t.anisotropy!==anisotropy){t.anisotropy=anisotropy;t.needsUpdate=true;}});},dispose(){textures.forEach(t=>t.dispose());}};
}
