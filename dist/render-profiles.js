// Display budgets never change the 120 Hz integrator, collision world or actuators.
export const RENDER_PROFILES=Object.freeze({
  balanced:Object.freeze({label:'流畅',maxDpr:1,maxPixels:1600000,adaptive:true,minScale:.62,
    aoScale:0,aoSamples:0,bloom:false,antialias:'fxaa',shadowCascades:1,shadowSize:1024,shadowHz:30,
    probeSize:0,probeInterval:0,probeDistance:0,probeMaxAge:0,probeShadowSize:0,particleLimit:1500,particleRate:.32,particleLife:.8}),
  high:Object.freeze({label:'高',maxDpr:1.35,maxPixels:3000000,adaptive:false,minScale:1,
    aoScale:.5,aoSamples:12,bloom:true,antialias:'smaa',shadowCascades:2,shadowSize:1536,shadowHz:45,
    probeSize:128,probeInterval:1.5,probeDistance:5,probeMaxAge:7,probeShadowSize:512,particleLimit:3400,particleRate:.65,particleLife:1}),
  ultra:Object.freeze({label:'极高',maxDpr:1.5,maxPixels:5000000,adaptive:false,minScale:1,
    aoScale:.65,aoSamples:20,bloom:true,antialias:'smaa',shadowCascades:3,shadowSize:2048,shadowHz:60,
    probeSize:256,probeInterval:.9,probeDistance:3.5,probeMaxAge:5,probeShadowSize:768,particleLimit:6000,particleRate:1,particleLife:1})
});

export function renderResolution(width,height,deviceDpr=1,quality='balanced',scale=1){
  const profile=RENDER_PROFILES[quality]||RENDER_PROFILES.balanced;
  width=Math.max(1,Math.floor(width));height=Math.max(1,Math.floor(height));
  const budgetRatio=Math.min(Math.max(.1,deviceDpr||1),profile.maxDpr,Math.sqrt(profile.maxPixels/(width*height)));
  const pixelRatio=budgetRatio*Math.max(profile.minScale,Math.min(1,scale));
  return{width:Math.max(1,Math.floor(width*pixelRatio)),height:Math.max(1,Math.floor(height*pixelRatio)),pixelRatio,budgetRatio};
}

export function sizeRenderPipeline(renderer,composer,width,height,deviceDpr,quality,scale){
  const size=renderResolution(width,height,deviceDpr,quality,scale);
  renderer.setPixelRatio(size.pixelRatio);renderer.setSize(width,height);
  // Work in physical pixels so the composer cannot retain an earlier HiDPI
  // ratio. All enabled passes share precisely the drawing-buffer dimensions.
  composer.setPixelRatio(1);composer.setSize(size.width,size.height);
  return size;
}

// A bounded, slow display-only governor. Vsync intervals measure delivered frames;
// pauses/background throttling and shader warm-up must not drive the governor.
export class ResolutionGovernor{
  constructor(quality='balanced'){this.setQuality(quality);}
  setQuality(quality){this.quality=quality;this.scale=1;this.samples=[];this.elapsed=0;this.cooldown=2.5;this.fastWindows=0;}
  update(frameMs,{active=true,cpuMs=0,gpuMs=null}={}){
    const profile=RENDER_PROFILES[this.quality];
    if(!profile?.adaptive||!active||!Number.isFinite(frameMs)||frameMs<=0||frameMs>250){this.samples=[];this.elapsed=0;return false;}
    this.cooldown-=frameMs/1000;if(this.cooldown>0)return false;
    this.samples.push(frameMs);this.elapsed+=frameMs;
    if(this.elapsed<1100||this.samples.length<20)return false;
    const sorted=this.samples.sort((a,b)=>a-b),p85=sorted[Math.floor((sorted.length-1)*.85)];
    this.samples=[];this.elapsed=0;let next=this.scale;
    if(p85>21){next=Math.max(profile.minScale,this.scale*.90);this.fastWindows=0;}
    else if(p85<18&&cpuMs<11&&(gpuMs==null||gpuMs<12)){if(++this.fastWindows>=5){next=Math.min(1,this.scale+.035);this.fastWindows=0;}}
    else this.fastWindows=0;
    if(Math.abs(next-this.scale)<.004)return false;
    this.scale=next;this.cooldown=1.5;return true;
  }
}
