import {SSAOPass} from './vendor/addons/postprocessing/SSAOPass.js';

// Produce contact AO/depth for indirect lighting only. No redundant fullscreen
// preview is copied over the beauty buffer. Shadow maps belong to the beauty
// pass, not the normals override; this also avoids an extra shadow submission.
export class ContactAOPass extends SSAOPass{
  constructor(scene,camera,width=1,height=1,samples=12){
    super(scene,camera,width,height,samples);this.needsSwap=false;
    // Replace the stock 16-tap colour-only box blur in place. Five bilateral
    // taps (AO, depth, normal = 15 texture reads) keep floor/kerb/car boundaries
    // separate, avoiding the dark outline made by blurring across silhouettes.
    Object.assign(this.blurMaterial.uniforms,{
      tDepth:{value:this.normalRenderTarget.depthTexture},tNormal:{value:this.normalRenderTarget.texture},
      cameraNear:{value:camera.near},cameraFar:{value:camera.far}
    });
    this.blurMaterial.fragmentShader=`
      uniform sampler2D tDiffuse,tDepth,tNormal;
      uniform vec2 resolution;
      uniform float cameraNear,cameraFar;
      varying vec2 vUv;
      float contactDistance(float d){return cameraNear*cameraFar/(cameraFar-(cameraFar-cameraNear)*d);}
      void main(){
        float depth=texture2D(tDepth,vUv).r;
        if(depth>=.9999999){gl_FragColor=vec4(1.);return;}
        float centre=contactDistance(depth);
        vec3 normal=normalize(texture2D(tNormal,vUv).xyz*2.-1.);
        float sum=texture2D(tDiffuse,vUv).r*2.,weight=2.;
        vec2 offsets[4];offsets[0]=vec2(-1.5,0.);offsets[1]=vec2(1.5,0.);offsets[2]=vec2(0.,-1.5);offsets[3]=vec2(0.,1.5);
        for(int i=0;i<4;i++){
          vec2 uv=vUv+offsets[i]/resolution;
          float neighbour=contactDistance(texture2D(tDepth,uv).r);
          vec3 neighbourNormal=normalize(texture2D(tNormal,uv).xyz*2.-1.);
          float depthWeight=exp(-abs(neighbour-centre)/(.045+min(.30,centre*.008)));
          float normalWeight=pow(max(dot(normal,neighbourNormal),0.),8.);
          float w=depthWeight*normalWeight;
          sum+=texture2D(tDiffuse,uv).r*w;weight+=w;
        }
        gl_FragColor=vec4(vec3(sum/weight),1.);
      }`;
  }
  render(renderer){
    const hidden=[],oldOverride=this.scene.overrideMaterial,shadowEnabled=renderer.shadowMap.enabled;
    this.scene.traverseVisible(o=>{
      if((o.isPoints||o.isLine||o.isLine2)||o.isMesh&&(o.userData.skipContactAO||(Array.isArray(o.material)?o.material:[o.material]).every(m=>m?.transparent))){hidden.push(o);o.visible=false;}
    });
    renderer.shadowMap.enabled=false;
    try{
      this._renderOverride(renderer,this.normalMaterial,this.normalRenderTarget,0x7777ff,1);
      this.ssaoMaterial.uniforms.kernelRadius.value=this.kernelRadius;
      this.ssaoMaterial.uniforms.minDistance.value=this.minDistance;
      this.ssaoMaterial.uniforms.maxDistance.value=this.maxDistance;
      this._renderPass(renderer,this.ssaoMaterial,this.ssaoRenderTarget);
      this._renderPass(renderer,this.blurMaterial,this.blurRenderTarget);
    }finally{renderer.shadowMap.enabled=shadowEnabled;this.scene.overrideMaterial=oldOverride;for(const o of hidden)o.visible=true;}
  }
  dispose(){super.dispose();this.ssaoMaterial.dispose();this.noiseTexture.dispose();}
}
