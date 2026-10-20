// Read-only runtime verification. This writes a NEW, explicitly conditional
// dependency review; it never broadens or rewrites the earlier c12a receipt.
// node --experimental-vm-modules qa/vehicle-evidence-final-dependency-3.16.mjs
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SourceTextModule} from 'node:vm';
import {MODEL_BUILD_ID as capturedBuild,MODEL_SOURCE_HASHES as capturedSources} from './vehicle-native-3.16/captured-model-build-2d88.js';
import {MODEL_BUILD_ID as targetBuild,MODEL_SOURCE_HASHES as targetSources} from '../dist/model-build.js';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(repository,'dist');
const originals=resolve(repository,'qa/vehicle-native-3.16'),output=resolve(repository,'qa/vehicle-final-3.16');
const expectedCaptured='2d88af03b1867667f85f6a638b12648424a378450636bd400ba0095b3341acfa';
const expectedTarget='81926b470303a5f51844285ff604fbb84717a627271efddde494e228ce319ec2';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),read=path=>readFileSync(resolve(dist,path));
const originalCapture=JSON.parse(readFileSync(resolve(originals,'vehicle-native-capture-3.16.json')));
const manifest=JSON.parse(readFileSync(resolve(originals,'manifest.json')));
const study=JSON.parse(readFileSync(resolve(originals,'study/vehicle-study.json')));
const c12aPath=resolve(originals,'component-inheritance-c12a.json'),c12aBytes=readFileSync(c12aPath),c12a=JSON.parse(c12aBytes);
assert.equal(capturedBuild,expectedCaptured);assert.equal(targetBuild,expectedTarget);
assert.equal(sha(JSON.stringify(capturedSources)),capturedBuild);assert.equal(sha(JSON.stringify(targetSources)),targetBuild);
assert.deepEqual(originalCapture.sourceHashesBefore,originalCapture.sourceHashesAfter);
assert.equal(sha(readFileSync(resolve(originals,'captured-model-build-2d88.js'))),originalCapture.sourceHashesBefore['model-build.js']);
assert.equal(c12a.targetBuildId,'c12a71547cc90783b98cda473c2cb1a5b338a362a5d47592e8d238a9db0b819c');
const c12aSources=Object.fromEntries(c12a.sourceDiff.map(row=>[row.path,row.targetSHA256]));
const sourceDiff=[...new Set([...Object.keys(capturedSources),...Object.keys(targetSources)])].sort().map(path=>{
  const actualSHA256=sha(read(path));assert.equal(actualSHA256,targetSources[path],'Target runtime bytes: '+path);
  return{path,captured2d88SHA256:capturedSources[path]??null,reviewedC12aSHA256:c12aSources[path]??null,targetSHA256:targetSources[path]??null,actualSHA256,changedFrom2d88:capturedSources[path]!==targetSources[path],changedFromC12a:c12aSources[path]!==targetSources[path]};
});
assert.equal(sourceDiff.length,172);
const changes=sourceDiff.filter(row=>row.changedFrom2d88);
assert.deepEqual(changes.map(row=>row.path),['city-continuity.js','city-frontage-design.js','main.js','operation-hud.js','style.css','urban-architecture.js','wet-road-reflection.js']);
function closure(roots){
  const seen=new Set(),queue=[...roots],edges=[];
  while(queue.length){
    const path=queue.shift();if(seen.has(path))continue;seen.add(path);
    const module=new SourceTextModule(read(path).toString('utf8'),{identifier:path});
    for(const specifier of module.dependencySpecifiers){
      assert.ok(specifier.startsWith('.'),'Unreviewed bare import: '+path+' / '+specifier);
      const target=relative(dist,resolve(dist,dirname(path),specifier));assert.ok(!target.startsWith('..'));
      edges.push({from:path,specifier,to:target});queue.push(target);
    }
  }
  return{paths:[...seen].sort(),edges:edges.sort((a,b)=>(a.from+' '+a.to).localeCompare(b.from+' '+b.to))};
}
const inspection=read('vehicle-inspection.js').toString('utf8');
const dynamic=[...inspection.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)].map(match=>({from:'vehicle-inspection.js',specifier:match[2],to:relative(dist,resolve(dist,match[2]))}));
assert.deepEqual(dynamic.map(row=>row.to).sort(),['vehicle-reference-3.13.js','vehicle-reference-3.15.js','vehicle-reference-3.8.js','vehicle-reference-3.9.js']);
const direct=closure(['vehicle-inspection.js']),expanded=closure(['vehicle-inspection.js',...dynamic.map(row=>row.to)]);
assert.equal(direct.paths.length,48);assert.equal(expanded.paths.length,56);
for(const path of expanded.paths)if(path!=='vehicle-inspection.js')assert.doesNotMatch(read(path).toString('utf8'),/\bimport\s*\(/,'Unreviewed nested dynamic import: '+path);
const closureFiles=expanded.paths.map(path=>{
  const capturedSHA256=path==='model-build.js'?originalCapture.sourceHashesBefore[path]:capturedSources[path],actualSHA256=sha(read(path));
  return{path,capturedSHA256,actualSHA256,inDirectStaticClosure:direct.paths.includes(path),sameBytes:capturedSHA256===actualSHA256};
});
assert.deepEqual(closureFiles.filter(row=>!row.sameBytes).map(row=>row.path),['city-continuity.js','model-build.js']);
const pageFiles=['vehicle-inspection.html','vehicle-inspection.css'].map(path=>{
  const actualSHA256=sha(read(path));assert.equal(actualSHA256,capturedSources[path]);assert.equal(actualSHA256,originalCapture.sourceHashesBefore[path]);
  return{path,capturedSHA256:capturedSources[path],actualSHA256,sameBytes:true};
});
assert.doesNotMatch(read('vehicle-inspection.css').toString('utf8'),/\burl\s*\(/,'New stylesheet media needs review.');
const mediaPath='assets/environment.hdr',mediaSHA256=sha(read(mediaPath));
assert.equal(mediaSHA256,originalCapture.sourceHashesBefore[mediaPath]);assert.equal(mediaSHA256,originalCapture.sourceHashesAfter[mediaPath]);
const frames=manifest.frames.filter(row=>row.path.startsWith('study/')||row.path.startsWith('stock/')).map(row=>{
  const actualSHA256=sha(readFileSync(resolve(originals,row.path)));assert.equal(actualSHA256,row.sha256,'Original PNG changed: '+row.path);
  return{path:row.path,sha256:actualSHA256,originalCaptureBuildId:row.path.startsWith('stock/')&&row.path.endsWith('-3.15.png')?manifest.baselineBuildId:capturedBuild,relabeled:false,claim:'Retained original vehicle-work evidence, not a new target-build capture or full-byte inheritance assertion.'};
});
assert.equal(frames.length,32);
const renderInputKeys=['rig','viewId','focalLengthMm','filmGaugeMm','camera','lighting','lightingRevision','toneMappingExposure','environmentIntensity','resolution','cssStageSize','pixelRatio','surfaceDiagnostics','quality','steer','suspensionLength','cutaway','seal','suspensionSweep','displayConfiguration','lampMode','photoReference','materialState','geometry','renderCost'];
const plannedViews=['studio-front-quarter-current','studio-cabin-current'].map(id=>{
  const frame=study.frames.find(row=>row.id===id);assert.ok(frame);
  const conditions=Object.fromEntries(renderInputKeys.map(key=>[key,frame.conditions[key]]));
  conditions.wingRenderPose=Object.fromEntries(['mode','command','deployment','position','incidenceRad'].map(key=>[key,frame.conditions.wing[key]]));
  return{id,originalFile:'qa/vehicle-native-3.16/study/'+frame.file,originalSHA256:sha(readFileSync(resolve(originals,'study',frame.file))),originalCaptureId:study.captureId,originalSimTime:frame.conditions.simTime,renderInputs:conditions};
});
const changedReasons={
  'city-continuity.js':'Inside the physical static closure. The first pair of newly authored Foundry footways changes z interval [-117,-16] to [-84,-16], preserving the existing z=-100 crossing. This changes city collision geometry; it is not erased from the byte comparison.',
  'city-frontage-design.js':'Outside the inspection closure. Main-city entrance emitters moved outside the coarse bake occluder envelope; requires separate city pixels.',
  'main.js':'Outside the inspection closure. Wires the operation HUD pause/resume callback into the main application; requires separate UI/interaction acceptance.',
  'operation-hud.js':'Outside the inspection closure. Adds the visible pause/resume control and current paused label; no main-page UI inheritance is asserted.',
  'style.css':'Not loaded by vehicle-inspection.html, which uses vehicle-inspection.css. Adds the main operation-header/button styling; main-page UI is excluded.',
  'urban-architecture.js':'Outside the inspection closure. Removes hidden faces of sealed opaque window boxes while preserving their outward plane; glass instance response batching retains the established edge and attachment LOD distances. It is a city render change, not an inspection renderer input.',
  'wet-road-reflection.js':'Outside the inspection closure. Changes the city reflection projection/clipping and state invalidation; main-city pixels are excluded.'
};
const report={
  schema:'roadster-vehicle-final-render-input-dependency-review-3.16',generatedAt:new Date().toISOString(),status:'target-bytes-verified-conditional-render-path-inference',
  capturedBuildId:capturedBuild,earlierReviewTargetBuildId:c12a.targetBuildId,targetBuildId:targetBuild,
  method:'All 172 declared target source hashes were checked against actual local bytes and compared to both original 2d88 and the retained c12a receipt. Native SourceTextModule parsing did not execute the modules. The specific city collision change was reviewed along the actual inspection-to-physics-to-model call path. No browser/GPU was used; no new PNGs were made.',
  verifier:{path:'qa/vehicle-evidence-final-dependency-3.16.mjs',sha256:sha(readFileSync(fileURLToPath(import.meta.url))),command:'node --experimental-vm-modules qa/vehicle-evidence-final-dependency-3.16.mjs'},
  counts:{sourceEntries:sourceDiff.length,unchangedFrom2d88:sourceDiff.length-changes.length,changedFrom2d88:changes.length,changedFromC12a:sourceDiff.filter(row=>row.changedFromC12a).length,staticModules:direct.paths.length,unchangedStaticModules:closureFiles.filter(row=>row.inDirectStaticClosure&&row.sameBytes).length,expandedModules:expanded.paths.length,unchangedExpandedModules:closureFiles.filter(row=>row.sameBytes).length,retainedOriginalRendererImages:frames.length,plannedNewCurrentViews:plannedViews.length,newImagesMadeByThisReview:0},
  wholeStaticClosureByteEquality:false,wholeExpandedClosureByteEquality:false,all32ImagesCapturedAtTargetBuild:false,pixelBitwiseEquivalenceProven:false,
  preservedEarlierRecords:[{path:'qa/vehicle-native-3.16/captured-model-build-2d88.js',sha256:originalCapture.sourceHashesBefore['model-build.js']},{path:'qa/vehicle-native-3.16/component-inheritance-c12a.json',sha256:sha(c12aBytes),scope:'The earlier exact component claim remains limited to its original c12a target. This report does not overwrite it.'}],
  targetBuildFile:{path:'dist/model-build.js',sha256:sha(read('model-build.js'))},sourceDiff,changedFiles:changes.map(row=>({...row,inInspectionStaticClosure:direct.paths.includes(row.path),inExpandedInspectionClosure:expanded.paths.includes(row.path),reason:changedReasons[row.path]})),
  staticImportClosure:direct,reviewedLiteralLazyImports:dynamic,expandedImportEdges:expanded.edges,closureFiles,pageFiles,
  renderMedia:[{path:mediaPath,bytes:read(mediaPath).length,capturedSHA256:originalCapture.sourceHashesBefore[mediaPath],targetSHA256:mediaSHA256,sameBytes:true,scope:'The HDR resource loaded by inspection; studio softboxes are procedural in the unchanged inspection source.'}],
  callGrounds:[
    {source:'vehicle-inspection.js',call:"const sim=new RoadsterSim(); sim.setWing({mode:'fixed',deployment:0})",meaning:'Constructs a real city physics world. City-continuity is a genuine static and runtime dependency.'},
    {source:'physics.js → city-data.js → city-continuity.js',call:'RoadsterSim._createWorld() → CITY_COLLIDERS → createCityContinuity(...).solids',meaning:'The shortened footways reach the Cannon collision world. Default free physics starts at [0,0.62,-28], independently of the inspection model root.'},
    {source:'vehicle-inspection.js',call:'frame() / frozenArticulation() / capturePair()',meaning:'The sole physics-derived visual field supplied to the car is telemetry.wing. Authored wheelStates set suspensionLength, steer and rotation=0; contactCount=4 and seal controls are explicit. Model root y=length−0.287. Body position/quaternion and city meshes are not copied into this scene.'},
    {source:'physics.js / vehicle-models.js',call:'_aero(): fixed wing.command → deployment actuator → rearWingPose(deployment)',meaning:'At the captured fixed/0 state, render-consumed deployment, position and incidence remain rearWingPose(0). Dynamic pressure/forces are distinct telemetry and do not place or shade the model.'},
    {source:'vehicle.js',call:'createRoadster().update()',meaning:'Reads wing deployment, position and incidence for wing mesh/struts; uses the supplied wheel states. Does not read the city body transform.'},
    {source:'vehicle-inspection.js',call:'local THREE.Scene, floor, Hemisphere/Directional lights, procedural studio softboxes, environment.hdr, RIG/view camera',meaning:'No urban scene builder, city baked-light-field renderer or wet-road-reflection pass is constructed for these technical views. Official photo URLs only enter the optional reference DOM for photo views; these two technical views have photoReference=null.'}
  ],
  conclusion:'Under the recorded fixed technical camera/light/display/articulation settings and fixed wing deployment 0, no data path was identified by which the specific remote city-collider interval change enters the inspection rendered inputs. This is a conditional source/dataflow inference, not byte equality of the whole import closure or proof of 32 target-build PNGs.',
  excludedScopes:[
    'Both original 2d88 main-city cockpit renderer PNGs: subsequent light placement, window rendering, pavement topology and reflection changes require separate current city evidence.',
    'All UI screenshots, including the four original independent UI screenshots. Same inspection HTML/CSS source does not turn those screenshots into current UI acceptance; main.js, operation-hud.js and style.css have changed.',
    'Final city driving, navigation, 14-frame/draw coverage, hardware performance, GPU memory and handling.',
    'City baked light-field binaries and their whole-city runtime contribution. They are outside these inspection rendered inputs and are verified separately by the parent release workflow.',
    'Deployment/sourceCommit/sourceTree metadata. New deployment information cannot be inserted into old image companions; publication identity is separately checked.'
  ],
  retainedOriginalImages:frames,plannedSupplement:{status:'prepared-not-captured',viewport:{width:1280,height:720},drawingBuffer:[900,720],deviceScaleFactor:1,views:plannedViews,method:'Two uses of the existing atomic comparison ZIP action. Preserve each native bundle and its incidental reference/composite frames; index only the two target current PNGs as the requested supplement.',nonRenderFields:'Actual build identity, captureId, time stamps, simulation time and observed device diagnostics retain their new capture values. Do not edit them to match old metadata. Render inputs are compared separately.'},
  limitations:['No new target-build visual quality judgment is made by this read-only review.','No full static-closure equality or pixel-bitwise reproducibility claim.','Only the named fixed wing/camera/light controls were traced; this does not imply all possible inspection or city states are unaffected.']
};
assert.equal(sha(readFileSync(c12aPath)),sha(c12aBytes),'Earlier c12a receipt changed during review');
mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'dependency-review-81926.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,targetBuildId:targetBuild,counts:report.counts,wholeStaticClosureByteEquality:false,output:'qa/vehicle-final-3.16/dependency-review-81926.json'},null,2));
