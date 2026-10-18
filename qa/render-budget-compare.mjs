import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as THREE from '../dist/vendor/three.module.js';
import {RoadsterSim} from '../dist/physics.js';
import {createEnvironment} from '../dist/city-environment.js';
import {countVisibleGeometry,CITY_RENDER_PRESETS} from '../dist/city-render-budget.js';
import {canonicalGeometryJSON} from '../dist/irradiance-math.js';

// Optional, read-only git-baseline comparison. Requires the original 3.4 commit
// locally; never fetches it, creates a browser, executes GL or measures FPS.
const root=fileURLToPath(new URL('../',import.meta.url)),dist=new URL('../dist/',import.meta.url);
const baselineCommit='4a5cae1',sha=b=>createHash('sha256').update(b).digest('hex');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'roadster-city-baseline-'));
const legacyNames=['city-environment.js','urban-architecture.js','street-life.js','city-landmarks.js','indirect-lighting.js'];
const currentFiles=['qa/render-budget-compare.mjs','qa/render-budget-check.mjs','dist/city-environment.js',
  'dist/urban-architecture.js','dist/street-life.js','dist/city-landmarks.js','dist/indirect-lighting.js',
  'dist/city-render-budget.js','dist/city-data.js','dist/city-plan.js','dist/irradiance-math.js',
  'dist/physics.js','dist/static-city-broadphase.js','dist/vendor/three.module.js','dist/vendor/three.core.js'];
const views=[{id:'weave-street',position:[-200,3,-385],lookAt:[-200,4,-280]},
  {id:'foundry-avenue',position:[100,3,335],lookAt:[100,7,420]},
  {id:'civic-terrace',position:[400,12,180],lookAt:[400,18,320]},
  {id:'aerial',position:[-30,95,-180],lookAt:[-200,20,-280]},
  {id:'botanical',position:[-400,4,180],lookAt:[-440,12,280]}];
const sequence=['balanced','high','ultra','balanced'];
function gitSource(name){return new Promise((resolve,reject)=>{
  const child=spawn('git',['show',baselineCommit+':'+name],{cwd:root,stdio:['ignore','pipe','pipe']});
  const buffers=[];let error='';child.stdout.on('data',b=>buffers.push(b));child.stderr.on('data',b=>error+=b);
  child.on('error',reject);child.on('close',code=>code===0?resolve(Buffer.concat(buffers)):reject(Error(error)));
});}
function replaceOnce(source,needle,replacement){assert.ok(source.includes(needle),'Baseline adapter no longer matches: '+needle);return source.replace(needle,replacement);}
const originalFetch=globalThis.fetch,originalTextureLoad=THREE.TextureLoader.prototype.load;
try{
  const baselineSources={},adapters={};
  // These shared source dependencies must still be exactly the original city.
  for(const name of ['city-data.js','city-plan.js']){
    const original=await gitSource('dist/'+name),current=await fs.readFile(new URL(name,dist));
    assert.equal(sha(current),sha(original),'Shared authored city source changed: '+name);
    baselineSources['dist/'+name]=sha(original);
  }
  for(const name of legacyNames){
    const original=await gitSource('dist/'+name);baselineSources['dist/'+name]=sha(original);
    let source=original.toString('utf8'),changes=[];
    if(name==='city-environment.js'){
      source=replaceOnce(source,"function sign(text,x,y,z,w=8,h=2,color='#eac896',rotation=Math.PI){","function sign(text,x,y,z,w=8,h=2,color='#eac896',rotation=Math.PI){if(typeof document==='undefined')return;");
      source=replaceOnce(source,'function verticalSign(text,x,y,z,color){',"function verticalSign(text,x,y,z,color){if(typeof document==='undefined'){add([1.7,6.2,.15],[x,y,z],mats.steel);return;}");
      source=replaceOnce(source,'const skyReady=new Promise(',"const skyReady=typeof document==='undefined'?Promise.resolve(false):new Promise(");
      changes=['Skip canvas-only labels and their companion tiny supports equally to the current headless factory; keep vertical backing boxes.','Skip HDR/PMREM loading without a GL renderer.'];
    }else if(name==='city-landmarks.js'){
      source=replaceOnce(source,'for(const s of signs){',"for(const s of signs){if(typeof document==='undefined')continue;");
      source=replaceOnce(source,'const ready=(async()=>{',"const ready=typeof document==='undefined'?Promise.resolve(false):(async()=>{");
      changes=['Skip canvas-only labels and externally loaded shrub assets, as in the current headless factory.'];
    }else if(name==='indirect-lighting.js'){
      source=replaceOnce(source,"new URL('./assets/irradiance/',import.meta.url)",'new URL('+JSON.stringify(new URL('assets/irradiance/',dist).href)+')');
      changes=['Resolve local irradiance assets from the current dist directory; no shader or lighting is executed by the geometry estimate.'];
    }
    source=source.replace(/from '(\.\/[^']+)'/g,(_whole,ref)=>{
      const bare=ref.slice(2),target=legacyNames.includes(bare)?pathToFileURL(path.join(temporary,bare)).href:new URL(bare,dist).href;
      return 'from '+JSON.stringify(target);
    });
    adapters[name]={changes,sourceSHA256:sha(source)};
    await fs.writeFile(path.join(temporary,name),source);
  }
  const {createEnvironment:oldEnvironment}=await import(pathToFileURL(path.join(temporary,'city-environment.js')));
  globalThis.fetch=async url=>{const b=await fs.readFile(url);return{ok:true,json:async()=>JSON.parse(b.toString('utf8')),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
  THREE.TextureLoader.prototype.load=function(_url,onLoad){const t=new THREE.Texture();queueMicrotask(()=>onLoad?.(t));return t;};
  const geometry=new RoadsterSim().getWorldGeometry(),canonicalSHA256=sha(canonicalGeometryJSON(geometry));
  const originalBrowser=JSON.parse(await fs.readFile(new URL('./city-3.4-browser-assets.json',import.meta.url)));
  assert.equal(canonicalSHA256,originalBrowser.stats.roundedGeometryHash,'Baseline comparison requires the unchanged original static envelopes');
  const result={format:'roadster-city-render-comparison-2',createdAt:new Date().toISOString(),
    method:'Real Three geometry/frustum submission estimates without GPU execution. Both versions run the same four quality passes and five-camera route. The main balanced rows are the final pass, matching render-budget-check.mjs; initial balanced rows are preserved separately.',
    baselineCommit,camera:{fov:52,aspect:16/9,near:.1,far:1800},views,
    evaluationProtocol:{qualitySequence:sequence,viewSequence:views.map(v=>v.id),initialTimeSeconds:1,advanceSecondsPerView:1,
      visibleState:'Retain production visibility state between views and quality switches, including its 10 m hysteresis. No hidden-state reset or random warmup.',
      reportedPass:'Last occurrence of each quality; balanced after the full round trip.',
      excluded:'Vehicle, canvas labels and companion tiny supports, externally loaded character/shrub assets, HDR/PMREM and all GL rendering.'},
    geometry:{canonicalSHA256,quantization:1e-9,originalBrowserEvidence:'qa/city-3.4-browser-assets.json'},
    sourceIdentity:{current:Object.fromEntries(await Promise.all(currentFiles.map(async name=>[name,sha(await fs.readFile(path.join(root,name)))]))),baselineOriginal:baselineSources,baselineHeadlessAdapters:adapters},
    coldStart:{},historyDiagnostic:null};
  for(const [version,factory]of [['v3.4',oldEnvironment],['v3.5',createEnvironment]]){
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(52,16/9,.1,1800);
    const environment=factory(scene,{getDrawingBufferSize:v=>v.set(1600,900)},geometry,camera);await environment.ready;
    let time=1,coldHero=null,returnHero=null;result[version]={};
    const contributions=()=>{const rows=new Map();environment.root.traverseVisible(o=>{if(!o.isMesh)return;const row=countVisibleGeometry(THREE,o,camera);if(row.drawCalls)rows.set(o,{name:o.name,level:o.userData.renderDetail,...row});});return rows;};
    for(const [pass,quality]of sequence.entries()){
      environment.setQuality(quality);const rows=[];
      for(const [index,view]of views.entries()){
        camera.position.set(...view.position);camera.lookAt(...view.lookAt);camera.updateMatrixWorld(true);
        environment.update(time+=1,camera.position);environment.wantsShadowUpdate?.(time,camera.position);
        rows.push({view:view.id,...countVisibleGeometry(THREE,environment.root,camera)});
        if(version==='v3.5'&&index===0&&quality==='balanced'){if(pass===0)coldHero=contributions();else returnHero=contributions();}
      }
      if(pass===0)result.coldStart[version]={balanced:rows};
      result[version][quality]=rows;
    }
    if(version==='v3.5'){
      const p=new THREE.Vector3(...views[0].position),removed=[...coldHero].filter(([o])=>!returnHero.has(o)).map(([o,row])=>{
        const b=new THREE.Box3().setFromObject(o),distance=Math.hypot(Math.max(b.min.x-p.x,0,p.x-b.max.x),Math.max(b.min.y-p.y,0,p.y-b.max.y),Math.max(b.min.z-p.z,0,p.z-b.max.z));
        return{...row,distanceToAABB:distance,showDistance:CITY_RENDER_PRESETS.balanced[row.level+'Distance'],hideDistance:CITY_RENDER_PRESETS.balanced[row.level+'Distance']+10};
      });
      const added=[...returnHero].filter(([o])=>!coldHero.has(o)).map(([,row])=>row);
      assert.equal(added.length,0);assert.ok(removed.every(o=>o.distanceToAABB>=o.showDistance&&o.distanceToAABB<o.hideDistance));
      result.historyDiagnostic={view:'weave-street',reason:'Cold-created detail batches start visible and retain the 10 m exit margin; after visiting the other views they are hidden and must enter the base radius to reappear. Both outcomes are produced by the same final source.',
        removedBatches:removed.length,removedTriangles:removed.reduce((s,o)=>s+o.triangles,0),removed,added};
    }
  }
  // The formal validation is not rerun or rewritten by this comparison.
  const verified=JSON.parse(await fs.readFile(new URL('./render-budget-3.5.json',import.meta.url)));
  assert.deepEqual(result['v3.5'],verified.views,'Comparison must match the completed formal validation for the same quality/view history');
  const report=new URL('./render-budget-comparison-3.5.json',import.meta.url);await fs.writeFile(report,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({formalValidationMatches:true,coldStartHero:result.coldStart['v3.5'].balanced[0],reportedHero:result['v3.5'].balanced[0],historyRemovedBatches:result.historyDiagnostic.removedBatches,historyRemovedTriangles:result.historyDiagnostic.removedTriangles},null,2));
}finally{globalThis.fetch=originalFetch;THREE.TextureLoader.prototype.load=originalTextureLoad;await fs.rm(temporary,{recursive:true,force:true});}
