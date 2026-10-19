// A coarse, anti-aliased paving pattern anchors scale even in balanced mode.
// Geometry/collision heights are unchanged; this changes reflectance and
// roughness only. Joints converge to area coverage when smaller than a pixel.
export function attachPavementSurface(material){
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
      float pavingRow=floor(pavementWorld.z/.60);
      float pavingJ=max(pavingJoint(pavementWorld.x+mod(pavingRow,2.)*.30,.60,.009),pavingJoint(pavementWorld.z,.60,.009));
      float pavingVariation=sin(floor(pavementWorld.x/.60)*8.71+pavingRow*3.13)*.035;
      float pavingRain=pavementWetness*(.52+.18*sin(pavementWorld.x*.73)*sin(pavementWorld.z*.29));
      diffuseColor.rgb*=mix(1.+pavingVariation-.29*pavingJ,.63,pavingRain);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=clamp(mix(.86,.37,pavingRain)+.09*pavingJ,.30,.98);`);
  };
  material.customProgramCacheKey=()=>key+'|paving-metres-3.9';material.needsUpdate=true;
  return {setWetness(value){wetness.value=Math.max(0,Math.min(1,Number(value)||0));}};
}
