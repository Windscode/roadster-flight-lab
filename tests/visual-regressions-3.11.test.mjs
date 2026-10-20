import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster} from '../dist/vehicle.js';
import {RoadsterSim} from '../dist/physics.js';
import {createEnvironment} from '../dist/city-environment.js';
import {createNightOccluders,evaluateNightCoefficients} from '../dist/city-night-transport.js';
import {createNightDirectEvaluator} from '../dist/night-direct-transport.js';
import {createVehicleSurfaceDiagnostics,VEHICLE_SURFACE_MODES} from '../dist/vehicle-surface-diagnostics.js';
import {createNightCityLighting} from '../dist/night-city-lighting.js';
import {createNightDirectLighting,NIGHT_DIRECT_BLEND} from '../dist/night-direct-lighting.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';
import {captureInspectionDiagnostics,INSPECTION_DIAGNOSTIC_FRAMES} from '../dist/inspection-diagnostics-capture.js';

const checks=[],evidence={},sha=b=>createHash('sha256').update(b).digest('hex');
const pass=(name,detail)=>{checks.push({name,status:'passed',detail});console.log('PASS:',name);};

// Independent physical oracle: a plane with no blocker is fully visible to
// the light. The original vendored PCF-soft kernel is evaluated at fractional
// texel phases; its same-centre depth comparison introduces false occlusion.
const mapSize=1536,gradient=[.067,.042],bias=-.000043,
  planeDepth=(u,v)=>.30+gradient[0]*(u-.5)+gradient[1]*(v-.5),mix=(a,b,t)=>a+(b-a)*t,fract=x=>x-Math.floor(x);
function planeVisibility(u,v,correct,blockerDepth=0){
  const fx=fract(u*mapSize+.5),fy=fract(v*mapSize+.5),base=[u-fx/mapSize,v-fy/mapSize],depth=planeDepth(u,v)+bias;
  function sample(x,y){const uv=[base[0]+x/mapSize,base[1]+y/mapSize],centre=uv.map(z=>(Math.floor(z*mapSize)+.5)/mapSize),reference=depth+(correct?gradient[0]*(centre[0]-u)+gradient[1]*(centre[1]-v):0);return reference<=planeDepth(...centre)-blockerDepth?1:0;}
  return(sample(0,0)+sample(1,0)+sample(0,1)+sample(1,1)+mix(sample(-1,0),sample(2,0),fx)+mix(sample(-1,1),sample(2,1),fx)+mix(sample(0,-1),sample(0,2),fy)+mix(sample(1,-1),sample(1,2),fy)+mix(mix(sample(-1,-1),sample(2,-1),fx),mix(sample(-1,2),sample(2,2),fx),fy))/9;
}
const planeResults=[];
for(const corrected of [false,true]){
  let sum=0,minimum=1,maximum=0;const samples=80*80;
  for(let y=0;y<80;y++)for(let x=0;x<80;x++){const v=planeVisibility(.451+x/144127,.457+y/132359,corrected);sum+=v;minimum=Math.min(minimum,v);maximum=Math.max(maximum,v);if(corrected)assert.equal(v,1,'an unobstructed plane must receive all direct light');}
  const withBlocker=planeVisibility(.45123,.45742,corrected,.002);assert.equal(withBlocker,0,'real occlusion must remain');planeResults.push({corrected,samples,meanVisibility:sum/samples,minimum,maximum,visibilityWithRealBlocker:withBlocker});
}
assert.ok(planeResults[0].maximum-planeResults[0].minimum>.1);
pass('Receiver-plane correction removes PCF self-occlusion on an independent sloping-plane oracle while preserving a blocker',planeResults);
evidence.shadowOracle={mapSize,gradient,bias,results:planeResults,scope:'A numerical mechanism reproduction, not a rendered diagnosis of all stripes in the uploaded vehicle image.'};

// Equal live and static irradiance is an independent energy invariant: a
// complementary transition must preserve it at every height and distance.
// Bind that scalar oracle to the actually injected shader return and blend
// expressions, so a second fade inside the shared field cannot reappear.
const shaderFixture=()=>({uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}),missingAsset=async()=>({ok:false});
const bounceLighting=createNightCityLighting({fetchAsset:missingAsset}),directLighting=createNightDirectLighting({fetchAsset:missingAsset}),bounceShader=shaderFixture(),directShader=shaderFixture();
bounceLighting.inject(bounceShader);directLighting.inject(directShader);await Promise.all([bounceLighting.ready,directLighting.ready]);
const fieldReturn=(shader,name)=>shader.fragmentShader.match(new RegExp('vec3 '+name+'Bounce\\(vec3 p,vec3 n\\)\\{[\\s\\S]*?return (E[^;]*);'))?.[1];
assert.equal(fieldReturn(bounceShader,'night'),'E*(1.-smoothstep(24.,32.,p.y))','existing bounced light must keep its default height fade');
assert.equal(fieldReturn(directShader,'stationary'),'E','the direct field must not fade a second time inside the complementary blend');
assert.match(directShader.fragmentShader,/mix\(reflectedLight\.directDiffuse,stationaryBeforeDiffuse,stationaryFarWeight\(stationaryFieldWorld\)\)/);
assert.match(directShader.fragmentShader,/float stationaryWeight=stationaryFarWeight\(stationaryFieldWorld\);[\s\S]*?irradiance\+=stationaryBounce\(stationaryFieldWorld,inverseTransformDirection\(geometryNormal,viewMatrix\)\)\*stationaryWeight;/);
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
let blendCases=0,maximumPreviousDeficit=0;
for(const distance of [0,12,20,28,60])for(const height of [0,24,26,28,30,32,40])for(const extent of [0,600,612,624,650]){
  const heightWeight=1-smoothstep(24,32,height),weight=smoothstep(12,28,distance)*heightWeight*(1-smoothstep(600,624,extent));
  const live=1-weight,current=live+weight,previous=live+weight*heightWeight;
  assert.ok(Math.abs(current-1)<1e-12,'matched input irradiance must remain constant throughout the blend');
  maximumPreviousDeficit=Math.max(maximumPreviousDeficit,1-previous);blendCases++;
}
assert.equal(maximumPreviousDeficit,.25);
evidence.directBlend={blendCases,maximumPreviousDeficit,matchedInputAtHeight28:{before:.75,after:1},existingBounceHeightFadePreserved:true,scope:'Uniform matched-source scalar oracle bound to actual shader injection contracts; not a GPU or pixel comparison.'};
pass('Direct night field uses a single complementary domain fade while the existing bounce retains its own height fade',evidence.directBlend);

const scene=new THREE.Scene(),car=createRoadster({quality:'high'});scene.add(car.group);scene.environmentIntensity=.72;
const diagnostic=createVehicleSurfaceDiagnostics(scene),original=new Map();car.group.traverse(o=>{if(o.isMesh)original.set(o,{material:o.material,receiveShadow:o.receiveShadow,geometry:o.geometry,position:o.position.toArray(),quaternion:o.quaternion.toArray()});});
for(const {id}of VEHICLE_SURFACE_MODES){
  diagnostic.setMode(id);diagnostic.apply([car]);
  if(id==='no-shadow')car.group.traverse(o=>{if(o.isMesh)assert.equal(o.receiveShadow,false);});
  if(id==='no-environment')assert.equal(scene.environmentIntensity,0);
  diagnostic.restore();assert.equal(scene.environmentIntensity,.72);
  for(const [o,state]of original){assert.equal(o.material,state.material);assert.equal(o.geometry,state.geometry);assert.equal(o.receiveShadow,state.receiveShadow);assert.deepEqual(o.position.toArray(),state.position);assert.deepEqual(o.quaternion.toArray(),state.quaternion);}
}
diagnostic.dispose();car.dispose();pass('Every inspection isolation mode restores original materials, receiver flags, glass state, geometry and articulated pose',{modes:VEHICLE_SURFACE_MODES.map(m=>m.id),meshes:original.size});

// These are opaque marker bytes, deliberately not image/GPU evidence. This
// checks that asynchronous PNG encoding cannot associate seven later states
// with an earlier frame or quietly scale the captured drawing buffer.
const drawOrder=[],frameRenderer={domElement:{width:1280,height:720,marker:null}},captureState={time:15,camera:[3,1.2,5],wing:.31};
class CaptureFixture{
  getContext(){return {drawImage:(source,...args)=>{assert.deepEqual(args,[0,0]);this.marker=JSON.parse(JSON.stringify(source.marker));}};}
  toBlob(callback,type){assert.equal(drawOrder.length,7);const bytes=JSON.stringify({width:this.width,height:this.height,marker:this.marker});queueMicrotask(()=>callback(new Blob([bytes],{type})));}
}
const capturePending=captureInspectionDiagnostics({renderer:frameRenderer,canvasFactory:()=>new CaptureFixture(),captureId:'seven-frame-fixture',
  render:spec=>{drawOrder.push(spec.id);frameRenderer.domElement.marker={id:spec.id,time:captureState.time,cameraX:captureState.camera[0]};},
  snapshot:(spec,association)=>({...captureState,surfaceDiagnostics:{mode:spec.mode,receiverPlaneCorrection:spec.correction},frameAssociation:association})});
assert.deepEqual(drawOrder,INSPECTION_DIAGNOSTIC_FRAMES.map(f=>f.id));captureState.time=99;captureState.camera[0]=90;captureState.wing=.9;
const capture=await capturePending;assert.ok(Object.isFrozen(capture.record));assert.deepEqual(capture.record.resolution,[1280,720]);
const archiveBytes=new Uint8Array(await capture.archiveBlob.arrayBuffer()),view=new DataView(archiveBytes.buffer),archive=new Map();
for(let offset=0;view.getUint32(offset,true)===0x04034b50;){const length=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+nameLength+extra;assert.equal(view.getUint16(offset+8,true),0);archive.set(new TextDecoder().decode(archiveBytes.subarray(offset+30,offset+30+nameLength)),archiveBytes.slice(start,start+length));offset=start+length;}
assert.equal(archive.size,8);assert.deepEqual(JSON.parse(new TextDecoder().decode(archive.get('seven-frame-fixture-conditions.json'))),capture.record);
for(const frame of capture.record.frames){assert.equal(frame.conditions.time,15);assert.equal(frame.conditions.camera[0],3);assert.equal(frame.conditions.wing,.31);assert.ok(Object.isFrozen(frame.conditions.camera));assert.equal(frame.conditions.frameAssociation.originalFile,frame.file);assert.deepEqual(JSON.parse(new TextDecoder().decode(archive.get(frame.file))),{width:1280,height:720,marker:{id:frame.id,time:15,cameraX:3}});}
pass('Seven diagnostic frames are synchronously copied, immutable and bound to the correct original bytes before PNG encoding',{frames:capture.record.frames.map(f=>f.id),archiveFiles:archive.size,resolution:capture.record.resolution,scope:'Synthetic lifecycle/ZIP fixture; not rendered pixels.'});

globalThis.fetch=async url=>{try{const b=readFileSync(url);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return {ok:false};}};
const geometry=new RoadsterSim().getWorldGeometry(),camera=new THREE.PerspectiveCamera(48,16/9,.1,2300),renderer={capabilities:{getMaxAnisotropy:()=>8},getDrawingBufferSize:v=>v.set(1280,720),shadowMap:{autoUpdate:false,needsUpdate:true},coordinateSystem:THREE.WebGLCoordinateSystem};
camera.position.set(-202.6,2.15,-393);camera.lookAt(-198.5,4,-324);camera.updateMatrixWorld();
const world=createEnvironment(new THREE.Scene(),renderer,geometry,camera);await world.ready;
const anchors=world.getPracticalLightAnchors(),occluders=createNightOccluders(geometry),evaluator=createNightDirectEvaluator(anchors,occluders),manifest=JSON.parse(readFileSync('dist/assets/night-direct-irradiance/manifest.json'));
assert.equal(manifest.geometryCanonicalSHA256,sha(canonicalGeometryJSON(geometry)));assert.equal(manifest.anchorSHA256,sha(JSON.stringify(anchors)));
let bytes=0;
for(const volume of manifest.volumes){const b=readFileSync('dist/assets/night-direct-irradiance/'+volume.file);assert.equal(sha(b),volume.sha256);assert.equal(b.byteLength,volume.bytes);bytes+=b.byteLength;assert.ok(Math.max(...volume.size,manifest.heights.length*6)<=256);}
assert.ok(bytes<NIGHT_DIRECT_BLEND.maximumBytes);
const clear={trace:()=>null},light={practical:true,position:[0,6,0],target:[0,0,0],intensity:1000,color:0xffffff,range:28,angle:.90,penumbra:.55},reference=createNightDirectEvaluator([light],clear).evaluate([0,0,0]),expected=1000/36*(1-(6/28)**4)**2;
assert.ok(Math.abs(evaluateNightCoefficients(reference.coefficients,[0,1,0])[0]-expected)<1e-12);
assert.equal(evaluateNightCoefficients(reference.coefficients,[0,-1,0])[0],0);
assert.deepEqual(createNightDirectEvaluator([light],{trace:()=>({distance:2})}).evaluate([0,0,0]).coefficients,new Array(18).fill(0));
assert.deepEqual(createNightDirectEvaluator([],clear).evaluate([0,0,0]).coefficients,new Array(18).fill(0));
let blocked=0;const cases=[];
for(const p of [[-200,.6,-344],[-200,.6,-279],[-203,2.4,-264],[-138,.6,-398]]){
  const value=evaluator.evaluate(p),open=evaluator.evaluate(p,{occlusion:false});value.coefficients.forEach((v,i)=>assert.ok(v>=0&&v<=open.coefficients[i]+1e-10));blocked+=value.blocked;
  const direct=evaluateNightCoefficients(value.coefficients,[0,1,0]);assert.ok(direct[0]>1);cases.push({position:p,upIrradiance:direct,contributingFixtures:value.contributing,blocked:value.blocked,previousOutOfPoolDirectIrradiance:[0,0,0]});
}
assert.ok(blocked>0);world.setWeatherPreset('wet-night');world.update(0,{x:-200,y:.7,z:-390});assert.equal(world.stats.nightDirectLighting.loaded,true);assert.equal(world.stats.nightDirectLighting.enabled,true);
const identity=world.stats.nightDirectLighting.identity;camera.position.z=-260;camera.updateMatrixWorld();world.update(3,{x:100,y:.7,z:-132});assert.equal(world.stats.nightDirectLighting.identity,identity);
world.setWeatherPreset('clear-day');assert.equal(world.stats.nightDirectLighting.enabled,false);
pass('Static direct night field has source/geometry identities, independent inverse-square/cone/occlusion checks and nonzero far fixture illumination',{bytes,blocked,cases,identity});
evidence.stationaryDirect={identity,bytes,totalWithExistingBounceBytes:bytes+JSON.parse(readFileSync('dist/assets/night-irradiance/manifest.json')).volumes.reduce((n,v)=>n+v.bytes,0),cases,blend:NIGHT_DIRECT_BLEND};

const paths=['dist/city-environment.js','dist/receiver-plane-shadows.js','dist/vehicle-surface-diagnostics.js','dist/vehicle-inspection.js','dist/vehicle-inspection.html','dist/inspection-diagnostics-capture.js','dist/night-city-lighting.js','dist/night-direct-lighting.js','dist/night-direct-transport.js','scripts/bake-night-direct.mjs','tests/visual-regressions-3.11.test.mjs'];
const report={status:'passed',createdAt:new Date().toISOString(),checks,evidence,sourceHashes:Object.fromEntries(paths.map(p=>[p,sha(readFileSync(p))])),limits:['Numerical transport, restoration and sampling tests do not constitute GPU pixel, motion or performance acceptance.','The uploaded 3.9 evidence established the visible defects; no matched 3.11 rendered after-frame is present in this report.','Static direct lighting is a budgeted interpolation of closed-envelope visibility, not industrial radiometry or fine facade lightmaps.']};
writeFileSync('qa/visual-regressions-3.11.json',JSON.stringify(report,null,2)+'\n');
