import * as THREE from './vendor/three.module.js';
import {SUN_DIRECTION} from './irradiance-math.js';

// A cube capture needs its own sunlight visibility. A viewing-camera CSM is
// not a cube shadow map; turning all shadow receivers off loses street shade.
// This helper renders one small orthographic depth map per six-face capture.
// It neither creates an extra scene light nor modifies the baked diffuse field.
export function createLocalProbeSun(scene,renderer){
  const sun=new THREE.Vector3(...SUN_DIRECTION).normalize();
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.5,900);
  const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  depthMaterial.blending=THREE.NoBlending;
  const biasMatrix=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
  const uniforms={probeSunActive:{value:0},probeSunDepth:{value:null},probeSunMatrix:{value:new THREE.Matrix4()},probeSunTexel:{value:new THREE.Vector2(1,1)}};
  let target=null,candidates=[];
  const stats={mapSize:0,depthPasses:0,lastDrawCalls:0,lastTriangles:0,lastCpuMs:0,updatedThisFrame:false,
    maximumDepthPassesPerCapture:1,algorithm:'Local orthographic packed depth; 4 depth comparisons in cube capture only',
    limits:'Finite local capture volume; opaque geometry shadowing. Transparent transmission and dynamic GI are not solved.'};
  function configure(size=0){
    uniforms.probeSunActive.value=0;
    if(!size){target?.dispose();target=null;uniforms.probeSunDepth.value=null;stats.mapSize=0;return;}
    if(!target){target=new THREE.WebGLRenderTarget(size,size,{type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,stencilBuffer:false});target.texture.name='Local cube sunlight depth';target.texture.generateMipmaps=false;}
    else target.setSize(size,size);
    uniforms.probeSunDepth.value=target.texture;uniforms.probeSunTexel.value.set(1/size,1/size);stats.mapSize=size;
  }
  function refreshCasters(){
    candidates=[];scene.traverse(o=>{if(o.isMesh||o.isLine||o.isPoints||o.isLine2)candidates.push(o);});
  }
  function render(origin,range){
    stats.updatedThisFrame=false;if(!target)return false;
    // The light-axis margin includes towers that stand sunward of the probe,
    // rather than limiting blockers to its six face cameras' near surroundings.
    const offset=range*1.75+260;
    camera.far=2*offset+100;
    camera.position.copy(origin).addScaledVector(sun,offset);camera.up.set(0,1,0);camera.lookAt(origin);
    camera.updateMatrixWorld(true);
    // CubeCamera.far is face depth, not a sphere radius. Fit all eight corners
    // of [-range,range]^3 in the sun camera to keep oblique face corners inside.
    const corner=new THREE.Vector3();let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
      corner.copy(origin).add(new THREE.Vector3(x*range,y*range,z*range)).applyMatrix4(camera.matrixWorldInverse);
      minX=Math.min(minX,corner.x);maxX=Math.max(maxX,corner.x);minY=Math.min(minY,corner.y);maxY=Math.max(maxY,corner.y);
    }
    camera.left=minX-4;camera.right=maxX+4;camera.bottom=minY-4;camera.top=maxY+4;camera.updateProjectionMatrix();
    uniforms.probeSunMatrix.value.copy(biasMatrix).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    const old={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),
      viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),
      clear:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),autoClear:renderer.autoClear,
      override:scene.overrideMaterial,background:scene.background,xr:renderer.xr.enabled,
      shadowEnabled:renderer.shadowMap.enabled,shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeded:renderer.shadowMap.needsUpdate};
    const hidden=[];
    for(const o of candidates){
      if(!o.visible)continue;
      const materials=o.isMesh?(Array.isArray(o.material)?o.material:[o.material]):[];
      // Cast exactly opaque geometry, without turning cutout foliage or glass
      // panes into solid rectangular sun blockers. Main-view CSM is unchanged.
      if(!o.isMesh||(!o.castShadow&&o.userData.renderDetail!=='mass')||materials.some(m=>!m||m.transparent||m.alphaTest>0)){
        hidden.push(o);o.visible=false;
      }
    }
    const begin=performance.now(),calls=renderer.info?.render.calls||0,triangles=renderer.info?.render.triangles||0;
    try{
      scene.overrideMaterial=depthMaterial;scene.background=null;renderer.xr.enabled=false;
      renderer.shadowMap.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
      // setRenderTarget applies its physical-pixel viewport. Calling the
      // renderer's public setViewport here would multiply by screen DPR again.
      renderer.autoClear=false;renderer.setScissorTest(false);renderer.setRenderTarget(target);
      renderer.setClearColor(0xffffff,1);renderer.clear(true,true,false);renderer.render(scene,camera);
      stats.depthPasses++;stats.updatedThisFrame=true;
      stats.lastDrawCalls=(renderer.info?.render.calls||0)-calls;stats.lastTriangles=(renderer.info?.render.triangles||0)-triangles;
      return true;
    }finally{
      stats.lastCpuMs=performance.now()-begin;
      scene.overrideMaterial=old.override;scene.background=old.background;renderer.xr.enabled=old.xr;
      renderer.shadowMap.enabled=old.shadowEnabled;renderer.shadowMap.autoUpdate=old.shadowAuto;renderer.shadowMap.needsUpdate=old.shadowNeeded;
      renderer.autoClear=old.autoClear;renderer.setClearColor(old.clear,old.alpha);
      renderer.setViewport(old.viewport);renderer.setScissor(old.scissor);renderer.setScissorTest(old.scissorTest);
      // Restore global logical state first; an old render target must then
      // reapply its own physical viewport/scissor, without another DPR scale.
      renderer.setRenderTarget(old.target,old.face,old.mip);
      for(const o of hidden)o.visible=true;
    }
  }
  function inject(shader){
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 probeSunWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vec4 probeSunPoint=vec4(transformed,1.);
      #ifdef USE_BATCHING
      probeSunPoint=batchingMatrix*probeSunPoint;
      #endif
      #ifdef USE_INSTANCING
      probeSunPoint=instanceMatrix*probeSunPoint;
      #endif
      probeSunWorld=(modelMatrix*probeSunPoint).xyz;
      #include <project_vertex>`);
    shader.fragmentShader='uniform float probeSunActive;uniform sampler2D probeSunDepth;uniform mat4 probeSunMatrix;uniform vec2 probeSunTexel;varying vec3 probeSunWorld;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',`#include <shadowmap_pars_fragment>
      float roadsterProbeSun(vec3 worldNormal){
        vec4 coordinate=probeSunMatrix*vec4(probeSunWorld+worldNormal*.055,1.);
        vec3 p=coordinate.xyz/coordinate.w;
        if(any(lessThan(p,vec3(0.)))||any(greaterThan(p,vec3(1.))))return 1.;
        float depth=p.z-.00016;
        vec2 d=probeSunTexel*.65;
        float a=step(depth,unpackRGBAToDepth(texture2D(probeSunDepth,p.xy+vec2(-d.x,-d.y))));
        float b=step(depth,unpackRGBAToDepth(texture2D(probeSunDepth,p.xy+vec2(d.x,-d.y))));
        float c=step(depth,unpackRGBAToDepth(texture2D(probeSunDepth,p.xy+vec2(-d.x,d.y))));
        float e=step(depth,unpackRGBAToDepth(texture2D(probeSunDepth,p.xy+vec2(d.x,d.y))));
        return .25*(a+b+c+e);
      }`);
    // During a cube capture use one physical sun with the dedicated visibility
    // map, bypassing all viewing-camera cascade weights. Other direct lights,
    // SH diffuse and specular environment sampling retain their own transport.
    let lights=THREE.ShaderChunk.lights_fragment_begin;
    const start=lights.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
    const end=lights.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )',start);
    if(start<0||end<0)throw Error('Unsupported Three.js directional-light shader layout');
    const direct=lights.slice(start,end);
    lights=lights.slice(0,start)+`
      #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM )
      if(probeSunActive>.5){
        getDirectionalLightInfo(directionalLights[0],directLight);
        if(directLight.visible&&receiveShadow)directLight.color*=roadsterProbeSun(inverseTransformDirection(geometryNormal,viewMatrix));
        RE_Direct(directLight,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
      }else
      #endif
      {
      `+direct+'\n}\n'+lights.slice(end);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',lights);
  }
  return{configure,refreshCasters,render,inject,uniforms,stats,
    setActive(v){uniforms.probeSunActive.value=v&&target?1:0;},
    beginFrame(){stats.updatedThisFrame=false;},
    dispose(){target?.dispose();depthMaterial.dispose();}}
}
