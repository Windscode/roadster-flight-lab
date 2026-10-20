export const CITY_PAVEMENT_SPECIFICATIONS=Object.freeze({
  'corridor-pale':Object.freeze({wet:.68}), 'corridor-basalt':Object.freeze({wet:.71}),
  'forecourt-mineral':Object.freeze({spacing:[1.8,1.2],joint:.012,stagger:.5,dry:.94,wet:.82,wetDiffuse:.25}),
  'continuity-stone':Object.freeze({spacing:[1.2,.8],joint:.012,stagger:.5,dry:.89,wet:.69}),
  'service-concrete':Object.freeze({spacing:[3,4],joint:.016,stagger:0,dry:.93,wet:.67}),
  ivory:Object.freeze({spacing:[1.8,1.2],joint:.014,stagger:0,dry:.86,wet:.65}),
  basalt:Object.freeze({spacing:[.9,.45],joint:.008,stagger:.5,dry:.91,wet:.69}),
});
// A coarse, anti-aliased paving pattern anchors scale even in balanced mode.
// Geometry/collision heights are unchanged; this changes reflectance and
// roughness only. Joints converge to area coverage when smaller than a pixel.
export function attachPavementSurface(material,{spacing=[.6,.6],joint=.009,stagger=.5,dry=.89,wet=.68,wetDiffuse=.28}={}){
  if(![...spacing,joint,stagger,dry,wet,wetDiffuse].every(Number.isFinite)||spacing.some(x=>x<=0)||wetDiffuse<0||wetDiffuse>1)throw new Error('Invalid metric paving specification');
  const spec={spacing:[...spacing],joint,stagger,dry,wet,wetDiffuse};material.userData.pavementMetres=spec;
  const wetness={value:0},original=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    original?.call(this,shader,renderer);shader.uniforms.pavementWetness=wetness;
    shader.vertexShader='varying vec3 pavementWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`vec4 pavementPoint=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        pavementPoint=instanceMatrix*pavementPoint;
      #endif
      pavementWorld=(modelMatrix*pavementPoint).xyz;
      #include <project_vertex>`);
    shader.fragmentShader=`varying vec3 pavementWorld;uniform float pavementWetness;
      float pavingJoint(float coordinate,float spacing,float width){
        float footprint=max(fwidth(coordinate),.001),d=abs(mod(coordinate+spacing*.5,spacing)-spacing*.5);
        return mix(1.-smoothstep(width*.5-footprint*.5,width*.5+footprint*.5,d),width/spacing,smoothstep(.10,.7,footprint));
      }\n`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float pavingRow=floor(pavementWorld.z/${spacing[1].toFixed(5)});
      float pavingJ=max(pavingJoint(pavementWorld.x+mod(pavingRow,2.)*${(spacing[0]*stagger).toFixed(5)},${spacing[0].toFixed(5)},${joint.toFixed(5)}),pavingJoint(pavementWorld.z,${spacing[1].toFixed(5)},${joint.toFixed(5)}));
      float pavingVariation=sin(floor(pavementWorld.x/${spacing[0].toFixed(5)})*8.71+pavingRow*3.13)*.035;
      // Absorptive mineral remains coarse when wet. Rain darkens its diffuse
      // lobe; it does not turn the whole footway into a bright smooth mirror.
      // The small dry variation and joints remain spatially visible in rain.
      float pavingRain=pavementWetness*(.86+.08*sin(pavementWorld.x*.73)*sin(pavementWorld.z*.29));
      diffuseColor.rgb*=(1.+pavingVariation-.29*pavingJ)*mix(1.,${wetDiffuse.toFixed(5)},pavingRain);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=clamp(mix(${dry.toFixed(5)},${wet.toFixed(5)},pavingRain)+.09*pavingJ,.30,.98);`);
  };
  material.customProgramCacheKey=()=>key+'|paving-metres-3.16|'+JSON.stringify(spec);material.needsUpdate=true;
  return {setWetness(value){wetness.value=Math.max(0,Math.min(1,Number(value)||0));}};
}
