import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {CITY_BUILDINGS,CITY_COLLIDERS} from '../dist/city-data.js';
import {buildUrbanArchitecture,URBAN_MATERIAL_PALETTE} from '../dist/urban-architecture.js';
import {buildStreetLife,STREET_COLLIDERS} from '../dist/street-life.js';
import {createCityExteriorMaterials,EXTERIOR_SURFACES,MINERAL_SCAN_MEAN} from '../dist/city-exterior-materials.js';
import {countVisibleGeometry} from '../dist/city-render-budget.js';
import {RoadsterSim} from '../dist/physics.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';

// This is a geometry/material contract audit, not browser visual or FPS evidence.
// The 3.5 baseline was captured from the committed b88b49b sources before edits.
const base=JSON.parse(readFileSync(new URL('./exterior-baseline-3.5.json',import.meta.url)));
const protocol=JSON.parse(readFileSync(new URL('./render-budget-comparison-3.5.json',import.meta.url)));
const checks=[],record=(name,data={})=>{checks.push({name,status:'passed',...data});console.log('PASS: '+name);};
const hash=v=>createHash('sha256').update(v).digest('hex');
const root=new THREE.Group(),architecture=buildUrbanArchitecture(THREE,root,CITY_BUILDINGS),street=buildStreetLife(THREE,root);
await Promise.all([architecture.ready,street.ready]);
const geometry=new RoadsterSim().getWorldGeometry(),canonicalSHA256=hash(canonicalGeometryJSON(geometry));
assert.equal(hash(JSON.stringify(STREET_COLLIDERS)),base.colliderSHA256);
assert.equal(hash(JSON.stringify(URBAN_MATERIAL_PALETTE)),base.paletteSHA256);
assert.equal(canonicalSHA256,protocol.geometry.canonicalSHA256);
record('Static collision world, 108 street proxies and shared average wall palette retain their 3.5 identities',{
  canonicalSHA256,streetColliderSHA256:base.colliderSHA256,paletteSHA256:base.paletteSHA256,quantization:1e-9,
});

let metricInstances=0,finiteInstances=0,metricMaxError=0;const matrix=new THREE.Matrix4(),materials=new Map();
root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  for(const attribute of Object.values(mesh.geometry.attributes))assert.ok(attribute.array.every(Number.isFinite),mesh.name+' nonfinite geometry');
  if(!mesh.isInstancedMesh)return;
  assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));finiteInstances+=mesh.count;
  const kind=mesh.material.userData.exteriorSurface;if(!kind)return;materials.set(kind,mesh.material);
  const metric=mesh.geometry.getAttribute('exteriorMetric');assert.ok(metric?.isInstancedBufferAttribute);assert.equal(metric.count,mesh.count);
  for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,matrix);const a=matrix.elements;
    const expected=[Math.hypot(...a.slice(0,3)),Math.hypot(...a.slice(4,7)),Math.hypot(...a.slice(8,11))];
    for(let k=0;k<3;k++){const actual=metric.array[i*4+k],error=Math.abs(actual-expected[k]);metricMaxError=Math.max(metricMaxError,error);assert.ok(actual>0&&error<Math.max(1,expected[k])*2e-7);}
    assert.ok(metric.getW(i)===0||metric.getW(i)===1);metricInstances++;
  }
});
assert.ok(metricInstances>100000);
record('Every exterior instance carries finite metre dimensions that match its actual transform',{metricInstances,finiteInstances,metricMaxErrorM:metricMaxError});

const surfaceKit=createCityExteriorMaterials(THREE),metricGeometry=new THREE.BoxGeometry();
const dimensions=[7.4,3.2,.35],rotations=[0,.3,Math.PI/4-.0001,Math.PI/4+.0001,Math.PI/2,Math.PI];
for(const yaw of rotations){
  const transform=new THREE.Matrix4().compose(new THREE.Vector3(130,12,-240),new THREE.Quaternion().setFromEuler(new THREE.Euler(.06,yaw,0,'YXZ')),new THREE.Vector3(...dimensions));
  surfaceKit.installGeometry(metricGeometry,[{matrix:transform}],'box');
  const metric=metricGeometry.getAttribute('exteriorMetric');for(let k=0;k<3;k++)assert.ok(Math.abs(metric.array[k]-dimensions[k])<1e-6);
  // BoxGeometry UV edge distances equal the physical edge distances on every
  // supported planar face. This also crosses the old 45-degree world-axis seam.
  const p=metricGeometry.attributes.position,n=metricGeometry.attributes.normal,uv=metricGeometry.attributes.uv;
  for(let face=0;face<6;face++)for(const [a,b]of [[face*4,face*4+1],[face*4,face*4+2]]){
    const normal=new THREE.Vector3().fromBufferAttribute(n,a),scale=Math.abs(normal.y)>.9?[dimensions[0],dimensions[2]]:Math.abs(normal.x)>.9?[dimensions[2],dimensions[1]]:[dimensions[0],dimensions[1]];
    const metreUV=Math.hypot((uv.getX(a)-uv.getX(b))*scale[0],(uv.getY(a)-uv.getY(b))*scale[1]);
    const physical=new THREE.Vector3().fromBufferAttribute(p,a).applyMatrix4(transform).distanceTo(new THREE.Vector3().fromBufferAttribute(p,b).applyMatrix4(transform));
    assert.ok(Math.abs(metreUV-physical)<1e-6);
  }
}
record('Metre UV edge lengths stay physical through yaw, 45-degree crossings and tilted anisotropic boxes',{rotations:rotations.length,edgeComparisons:rotations.length*12,scope:'Single-sided opaque city box faces with positive instance scale; not a general mirrored/DoubleSide proof.'});
metricGeometry.dispose();surfaceKit.dispose();

// Select the new facade component dimensions from the actual batched meshes.
// Every corner must remain in a pre-existing physical building box. This checks
// the visual addition, not just unchanged physics definitions or road samples.
const physicalBuildings=CITY_COLLIDERS.filter(g=>g.kind==='building').map(g=>({...g,inverse:new THREE.Matrix4().compose(new THREE.Vector3(...g.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...g.rotation,'YXZ')),new THREE.Vector3(1,1,1)).invert()}));
const close=(a,b)=>Math.abs(a-b)<1e-5,components={plinth:0,portalJamb:0,portalLintel:0,awning:0,dripEdge:0,floorBelt:0};
architecture.group.traverse(mesh=>{
  if(!mesh.isInstancedMesh||!mesh.name.endsWith('/ box'))return;
  for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,matrix);const a=matrix.elements,d=[Math.hypot(...a.slice(0,3)),Math.hypot(...a.slice(4,7)),Math.hypot(...a.slice(8,11))],kind=mesh.material.userData.exteriorSurface;
    let component=null;
    if(kind==='concrete'&&close(d[1],.42)&&close(d[2],.18))component='plinth';
    if(kind==='metal'&&close(d[0],.18)&&close(d[1],2.85)&&close(d[2],.35))component='portalJamb';
    if(kind==='metal'&&close(d[0],1.66)&&close(d[1],.21)&&close(d[2],.35))component='portalLintel';
    if(kind==='enamel'&&close(d[1],.18)&&close(d[2],.88))component='awning';
    if(kind==='metal'&&d[0]>2&&close(d[1],.08)&&close(d[2],.08))component='dripEdge';
    if(kind==='concrete'&&d[0]>4&&((close(d[1],.34)&&close(d[2],.66))||(close(d[1],.18)&&close(d[2],.48))))component='floorBelt';
    if(!component)continue;
    const corners=[];for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])corners.push(new THREE.Vector3(x,y,z).applyMatrix4(matrix));
    const container=physicalBuildings.find(box=>corners.every(corner=>{const p=corner.clone().applyMatrix4(box.inverse);return Math.abs(p.x)<=box.size[0]/2+.00005&&Math.abs(p.y)<=box.size[1]/2+.00005&&Math.abs(p.z)<=box.size[2]/2+.00005;}));
    assert.ok(container,component+' leaves the existing collision envelope: '+a.slice(12,15));components[component]++;
  }
});
assert.equal(components.plinth,architecture.stats.continuousPlinths);assert.equal(components.portalJamb,architecture.stats.entrancePortals*2);assert.equal(components.portalLintel,architecture.stats.entrancePortals);
assert.ok(components.awning>200&&components.floorBelt>1000);
record('All new plinths, portal frames, awnings, drip edges and floor belts fit inside existing physical building envelopes',{components,toleranceM:.00005,scope:'Solid facade collision envelopes stay conservative; shallow reveals are visual surfaces, not enterable rooms.'});

let derivative=.03;
const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};materials.get('enamel').onBeforeCompile(shader,{});
// Evaluate the two scalar expressions extracted from the actual shader source
// in double precision, then compare them to independent interval intersections.
// This checks area coverage only; the separate shader gate checks GLSL linking.
function scalarFunction(name){const source=shader.fragmentShader,start=source.indexOf('float '+name+'('),open=source.indexOf('{',start),end=source.indexOf('}',open);assert.ok(start>=0&&end>open);return source.slice(start,end+1).replace(new RegExp('float '+name+'\\(([^)]*)\\)'),(_,args)=>'function '+name+'('+args.replaceAll('float ','')+')').replace(/\bfloat\s+/g,'let ');}
const filteredLine=new Function('floor','min','max','fract','clamp','fwidth',scalarFunction('exteriorPulseIntegral')+'\n'+scalarFunction('exteriorLine')+'\nreturn exteriorLine;')(Math.floor,Math.min,Math.max,x=>x-Math.floor(x),(x,a,b)=>Math.max(a,Math.min(b,x)),()=>derivative);
const intersectionCoverage=(coordinate,spacing,width,footprint)=>{
  const left=coordinate-footprint/2,right=coordinate+footprint/2;let area=0;
  for(let cell=Math.floor(left/spacing)-1;cell<=Math.ceil(right/spacing)+1;cell++)area+=Math.max(0,Math.min(right,cell*spacing+width/2)-Math.max(left,cell*spacing-width/2));
  return area/footprint;
};
let seamSamples=0,seamMaxError=0;
for(const [spacing,width]of [[.6,.003],[.3,.003],[1.4,.018],[3.2,.018]])for(const footprintCells of [.0002,.002,.018,.11,.60,1.8,6.7,24])for(let phase=-13;phase<24;phase++){
  derivative=spacing*footprintCells;const coordinate=phase*.137*spacing,actual=filteredLine(coordinate,spacing,width),reference=intersectionCoverage(coordinate,spacing,width,derivative),error=Math.abs(actual-reference);
  seamMaxError=Math.max(seamMaxError,error);assert.ok(error<2e-9,'seam filter differs from rectangular area');
  if(footprintCells===24)assert.ok(Math.abs(actual-width/spacing)<1e-12,'distant seam does not converge to mean coverage');seamSamples++;
}
record('Periodic seam filtering matches physical covered area and distant glass/paint seams converge to their mean',{seamSamples,seamMaxError,numericScope:'Production scalar GLSL expressions evaluated in JS double precision; no claim of GPU execution.'});

assert.equal(materials.size,6);assert.equal(architecture.stats.interiorAtlases,0);
for(const [kind,material]of materials){assert.equal(material.transparent,false);assert.equal(material.side,THREE.FrontSide);assert.equal(material.metalness,EXTERIOR_SURFACES[kind].metalness);assert.equal(material.roughness,EXTERIOR_SURFACES[kind].roughness);}
assert.equal(materials.get('glass').metalness,0);assert.equal(materials.get('enamel').metalness,0);assert.ok(materials.get('metal').metalness>.8);
for(const [quality,value]of [['balanced',0],['high',1],['ultra',2],['balanced',0]]){architecture.setQuality(quality);assert.equal(shader.uniforms.exteriorQuality.value,value);}
// Exercise the real loader quality path with Texture objects, without a DOM,
// network, canvas or graphics context. Upload invalidation is version-based.
const savedDocument=globalThis.document,loaded=[];globalThis.document={};
const loaderKit=createCityExteriorMaterials({...THREE,TextureLoader:class{load(url,onLoad){const texture=new THREE.Texture();loaded.push({url,texture});queueMicrotask(onLoad);return texture;}}});
assert.equal(await loaderKit.ready,true);assert.equal(loaded.length,3);
const versions=loaded.map(({texture})=>texture.version);loaderKit.setQuality('balanced');loaded.forEach(({texture},i)=>{assert.equal(texture.anisotropy,2);assert.equal(texture.version,versions[i]+1);});
loaderKit.setQuality('high');loaded.forEach(({texture},i)=>{assert.equal(texture.anisotropy,8);assert.equal(texture.version,versions[i]+2);});
loaderKit.setQuality('ultra');loaded.forEach(({texture},i)=>assert.equal(texture.version,versions[i]+2));
assert.equal(loaded[0].texture.colorSpace,THREE.SRGBColorSpace);assert.equal(loaded[1].texture.colorSpace,THREE.NoColorSpace);assert.equal(loaded[2].texture.colorSpace,THREE.NoColorSpace);
loaderKit.dispose();if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;
record('Six opaque exterior responses, texture colour spaces and quality-switch upload invalidation are correct',{materialKinds:[...materials.keys()],mineralScanMean:MINERAL_SCAN_MEAN,interiorTextures:0,loaderContract:'Stub file delivery with real Three Texture version events; no image or GPU upload asserted.'});

const matrixFingerprint=()=>{const h=createHash('sha256');street.group.traverse(mesh=>{if(mesh.isInstancedMesh)h.update(new Uint8Array(mesh.instanceMatrix.array.buffer));});return h.digest('hex');};
const beforeMatrix=matrixFingerprint();let matrixVersion=0;street.group.traverse(mesh=>{if(mesh.isInstancedMesh)matrixVersion+=mesh.instanceMatrix.version;});
for(let i=0;i<480;i++){if(i%160===0)street.setQuality(['balanced','high','ultra'][i/160]);street.update(i/60,new THREE.Vector3(-200+i*.9,3,-385+i*.7));}
assert.equal(matrixFingerprint(),beforeMatrix);let afterMatrixVersion=0;street.group.traverse(mesh=>{if(mesh.isInstancedMesh)afterMatrixVersion+=mesh.instanceMatrix.version;});assert.equal(afterMatrixVersion,matrixVersion);
assert.equal(street.stats.pedestrians,0);assert.equal(street.stats.animals,0);assert.equal(street.stats.activeAnimations,0);assert.equal(street.stats.animationHz,0);assert.equal(street.stats.externalCharacterLoads,0);assert.equal(street.stats.crowdsEnabled,false);
const streetSource=readFileSync(new URL('../dist/street-life.js',import.meta.url),'utf8');assert.ok(!/GLTFLoader|AnimationMixer|\.loadAsync\(/.test(streetSource));
record('No crowds or character requests are constructed; 480 updates and three quality levels leave all street matrices untouched',{frames:480,matrixSHA256:beforeMatrix,instanceMatrixUploadVersionBefore:matrixVersion,instanceMatrixUploadVersionAfter:afterMatrixVersion,people:0,animals:0,characterRequests:0});

// A fresh scene follows the exact baseline route and visibility history, so
// earlier independent update/quality tests cannot bias the budget comparison.
architecture.dispose();street.dispose();const routeRoot=new THREE.Group(),routeArchitecture=buildUrbanArchitecture(THREE,routeRoot,CITY_BUILDINGS),routeStreet=buildStreetLife(THREE,routeRoot);
await Promise.all([routeArchitecture.ready,routeStreet.ready]);const camera=new THREE.PerspectiveCamera(52,16/9,.1,1800),views={};let time=1,coldStart;
for(const quality of ['balanced','high','ultra','balanced']){
  routeArchitecture.setQuality(quality);routeStreet.setQuality(quality);const rows=[];
  for(const view of protocol.views){camera.position.set(...view.position);camera.lookAt(...view.lookAt);camera.updateMatrixWorld(true);time+=1;routeArchitecture.update(time,camera.position);routeStreet.update(time,camera.position);rows.push({view:view.id,...countVisibleGeometry(THREE,routeRoot,camera)});}
  if(quality==='balanced'&&!coldStart)coldStart=rows;views[quality]=rows;
}
const oldTriangles=base.architecture.triangles+base.street.triangles,newTriangles=routeArchitecture.stats.triangles+routeStreet.stats.triangles;
assert.ok(newTriangles<oldTriangles);assert.ok(routeArchitecture.stats.drawBatches+routeStreet.stats.drawBatches<base.architecture.drawBatches+base.street.drawBatches);
for(const quality of ['balanced','high','ultra'])for(const row of views[quality]){const before=base.views[quality].find(v=>v.view===row.view);assert.ok(row.drawCalls<=before.drawCalls,row.view+' increased beauty calls');assert.ok(row.triangles<=before.triangles*1.10,row.view+' inflated triangles by more than 10%');if(quality==='balanced')assert.ok(row.drawCalls<300&&row.triangles<650000);}
record('Authored exterior upgrades reduce allocated geometry and all 15 matched-view draw counts remain within the 3.5 budget',{allocatedTrianglesBefore:oldTriangles,allocatedTrianglesAfter:newTriangles,allocatedBatchesBefore:base.architecture.drawBatches+base.street.drawBatches,allocatedBatchesAfter:routeArchitecture.stats.drawBatches+routeStreet.stats.drawBatches,comparison:'Last balanced pass after balanced/high/ultra/balanced, five views in the original order; cold start preserved separately.'});

const sourceFiles=['qa/exterior-materials-check.mjs','qa/exterior-baseline-3.5.json','dist/city-exterior-materials.js','dist/urban-architecture.js','dist/street-life.js','dist/city-data.js','dist/city-plan.js','dist/city-render-budget.js'];
const sourceSHA256=Object.fromEntries(sourceFiles.map(file=>[file,hash(readFileSync(new URL('../'+file,import.meta.url)))]));
const result={status:'passed',version:'3.6',createdAt:new Date().toISOString(),method:'Real Three geometry, matrices, frusta, material callbacks and independently checked seam coverage; no browser/GPU context.',sourceSHA256,baselineSourceCommit:base.sourceCommit,checks,architecture:routeArchitecture.stats,street:routeStreet.stats,views,coldStart,baselineViews:base.views,limits:['Counts cover architecture and static street furnishings only, excluding vehicle, environment extras and canvas text.','Aerial and botanical views may submit modestly more triangles after selected facade elements were strengthened; every matched view submits fewer draws and combined allocated geometry is lower.','Solid building envelopes still block shallow visual shop recesses; the simulation does not model enterable interiors.','Texture image average measurements preserve the existing envelope diffuse model approximately; no detailed interior or new per-facade bounce bake is claimed.','This audit does not establish actual target-device frame rate, rendered appearance, GPU numeric precision or arbitrary mirrored/DoubleSide normal-map behavior.']};
writeFileSync(new URL('./exterior-materials-3.6.json',import.meta.url),JSON.stringify(result,null,2)+'\n');routeArchitecture.dispose();routeStreet.dispose();
console.log(JSON.stringify({status:'passed',checks:checks.length,allocatedTrianglesBefore:oldTriangles,allocatedTrianglesAfter:newTriangles,balanced:views.balanced},null,2));
