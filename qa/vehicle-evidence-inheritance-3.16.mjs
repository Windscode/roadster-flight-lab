// Run with: node --experimental-vm-modules qa/vehicle-evidence-inheritance-3.16.mjs
// Parses native ES-module dependency lists without evaluating browser modules.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SourceTextModule} from 'node:vm';
import {MODEL_BUILD_ID as capturedBuild,MODEL_SOURCE_HASHES as capturedSources} from './vehicle-native-3.16/captured-model-build-2d88.js';
import {MODEL_BUILD_ID as targetBuild,MODEL_SOURCE_HASHES as targetSources} from '../dist/model-build.js';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(repository,'dist'),evidence=resolve(repository,'qa/vehicle-native-3.16');
const expectedCaptured='2d88af03b1867667f85f6a638b12648424a378450636bd400ba0095b3341acfa';
const expectedTarget='c12a71547cc90783b98cda473c2cb1a5b338a362a5d47592e8d238a9db0b819c';
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=path=>readFileSync(resolve(dist,path));
const capture=JSON.parse(readFileSync(resolve(evidence,'vehicle-native-capture-3.16.json')));
const manifest=JSON.parse(readFileSync(resolve(evidence,'manifest.json')));
assert.equal(capturedBuild,expectedCaptured);assert.equal(targetBuild,expectedTarget);
assert.equal(sha(JSON.stringify(capturedSources)),capturedBuild);
assert.equal(sha(JSON.stringify(targetSources)),targetBuild);
assert.deepEqual(capture.sourceHashesBefore,capture.sourceHashesAfter);
assert.equal(sha(readFileSync(resolve(evidence,'captured-model-build-2d88.js'))),capture.sourceHashesBefore['model-build.js']);

const sourceDiff=[...new Set([...Object.keys(capturedSources),...Object.keys(targetSources)])].sort().map(path=>{
  const actual=sha(read(path)),before=capturedSources[path]??null,after=targetSources[path]??null;
  assert.equal(actual,after,'Current source differs from the target identity: '+path);
  return{path,capturedSHA256:before,targetSHA256:after,actualSHA256:actual,status:before===after?'unchanged':'changed'};
});
const changed=sourceDiff.filter(row=>row.status==='changed');
assert.deepEqual(changed.map(row=>row.path),['city-frontage-design.js','wet-road-reflection.js']);

function staticClosure(roots){
  const seen=new Set(),queue=[...roots],edges=[];
  while(queue.length){
    const path=queue.shift();if(seen.has(path))continue;seen.add(path);
    const module=new SourceTextModule(read(path).toString('utf8'),{identifier:path});
    for(const specifier of module.dependencySpecifiers){
      assert.ok(specifier.startsWith('.'),'Unhandled bare/static import: '+path+' / '+specifier);
      const target=relative(dist,resolve(dist,dirname(path),specifier));
      assert.ok(!target.startsWith('..'),'Import leaves the distribution: '+path);
      edges.push({from:path,specifier,to:target});queue.push(target);
    }
  }
  return{paths:[...seen].sort(),edges:edges.sort((a,b)=>(a.from+' '+a.to).localeCompare(b.from+' '+b.to))};
}
const direct=staticClosure(['vehicle-inspection.js']);
const inspection=read('vehicle-inspection.js').toString('utf8');
const dynamic=[...inspection.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)].map(match=>({from:'vehicle-inspection.js',specifier:match[2],to:relative(dist,resolve(dist,match[2]))}));
assert.deepEqual(dynamic.map(row=>row.to).sort(),['vehicle-reference-3.13.js','vehicle-reference-3.15.js','vehicle-reference-3.8.js','vehicle-reference-3.9.js']);
const expanded=staticClosure(['vehicle-inspection.js',...dynamic.map(row=>row.to)]);
for(const path of expanded.paths){
  if(path!=='vehicle-inspection.js')assert.doesNotMatch(read(path).toString('utf8'),/\bimport\s*\(/,'Unreviewed nested dynamic import in '+path);
  if(path!=='model-build.js')assert.equal(capturedSources[path],targetSources[path],'Inspection component changed: '+path);
}
for(const row of changed)assert.ok(!expanded.paths.includes(row.path),'Changed city module entered the inspection dependency closure: '+row.path);
const closureFiles=expanded.paths.map(path=>path==='model-build.js'?{
  path,status:'changed-identity-metadata-only',capturedSHA256:capture.sourceHashesBefore[path],targetSHA256:sha(read(path)),
  explanation:'Generated BUILD_ID and full source hash constants. Inspection uses BUILD_ID for exported metadata, diagnostic labels and optional composite-image captions. The retained 32 renderer PNGs contain no composite captions; geometry, camera, materials and lighting do not branch on this value.'
}:{path,status:'unchanged',capturedSHA256:capturedSources[path],targetSHA256:targetSources[path]});

const pageFiles=['vehicle-inspection.html','vehicle-inspection.css'].map(path=>{
  const actual=sha(read(path));assert.equal(actual,capturedSources[path]);assert.equal(actual,capture.sourceHashesBefore[path]);
  return{path,capturedSHA256:capturedSources[path],targetSHA256:actual,status:'unchanged'};
});
assert.doesNotMatch(read('vehicle-inspection.css').toString('utf8'),/\burl\s*\(/,'Inspect newly referenced stylesheet media.');
const environmentPath='assets/environment.hdr',environmentSHA=sha(read(environmentPath));
assert.equal(environmentSHA,capture.sourceHashesBefore[environmentPath]);assert.equal(environmentSHA,capture.sourceHashesAfter[environmentPath]);
const renderMedia=[{path:environmentPath,status:'unchanged',bytes:read(environmentPath).byteLength,capturedBeforeSHA256:capture.sourceHashesBefore[environmentPath],capturedAfterSHA256:capture.sourceHashesAfter[environmentPath],targetSHA256:environmentSHA,scope:'The loaded daylight reflection environment. Studio softboxes and all car geometry/materials are procedural code in the unchanged closure.'}];
const baselineRoot=resolve(repository,'../baseline-315/dist');
const original315=Object.entries(capture.original315SourceHashes).map(([path,recorded])=>{
  const actual=sha(readFileSync(resolve(baselineRoot,path)));assert.equal(actual,recorded,'Original 3.15 source changed since capture: '+path);
  return{path,capturedSHA256:recorded,currentIsolatedBaselineSHA256:actual,status:'unchanged'};
});
const frames=manifest.frames.filter(frame=>frame.path.startsWith('study/')||frame.path.startsWith('stock/')).map(frame=>{
  const actual=sha(readFileSync(resolve(evidence,frame.path)));assert.equal(actual,frame.sha256,'Original frame bytes changed: '+frame.path);
  return{path:frame.path,sha256:actual,captureBuildId:frame.path.startsWith('stock/')&&frame.path.endsWith('-3.15.png')?manifest.baselineBuildId:capturedBuild,conditions:frame.conditions,relabeled:false};
});
assert.equal(frames.length,32);
const report={
  schema:'roadster-vehicle-inspection-component-inheritance-3.16',status:'verified-unchanged-render-components',generatedAt:new Date().toISOString(),
  verifier:{path:'qa/vehicle-evidence-inheritance-3.16.mjs',sourceSHA256:sha(readFileSync(fileURLToPath(import.meta.url))),command:'node --experimental-vm-modules qa/vehicle-evidence-inheritance-3.16.mjs'},
  capturedBuildId:capturedBuild,targetBuildId:targetBuild,publicationStatus:'Target runtime identity only; publication and deployment identity are separately verified by the release workflow.',
  method:'All 172 original MODEL_SOURCE_HASHES entries compared to target MODEL_SOURCE_HASHES and current bytes. Native VM SourceTextModule dependency parsing is non-executing. The four known literal lazy reference imports and their static dependencies are included separately. No browser was started and no new pixels were generated.',
  counts:{sourceManifestEntries:sourceDiff.length,unchangedSourceEntries:sourceDiff.length-changed.length,changedSourceEntries:changed.length,staticModules:direct.paths.length,staticModulesWithoutIdentity:direct.paths.length-1,lazyReferenceRoots:dynamic.length,expandedModules:expanded.paths.length,unchangedExpandedModules:expanded.paths.length-1,pageFiles:pageFiles.length,renderMedia:renderMedia.length,inheritedRendererFrames:frames.length,capturedCurrentRendererFrames:frames.filter(row=>row.captureBuildId===capturedBuild).length,retainedOriginal315Frames:frames.filter(row=>row.captureBuildId===manifest.baselineBuildId).length},
  capturedBuildFile:{path:'captured-model-build-2d88.js',sha256:capture.sourceHashesBefore['model-build.js']},targetBuildFile:{path:'dist/model-build.js',sha256:sha(read('model-build.js'))},
  sourceDiff,changedFiles:changed.map(row=>({...row,outsideInspectionClosure:true,reason:row.path==='city-frontage-design.js'?'Actual city entrance-light locations moved outside the coarse building bake envelope. Inspection does not import this scene builder.':'Main city wet-road planar reflection pass, including its projection/clipping and source-state invalidation. Inspection has its own floor and fixed rig and does not import this module.'})),
  staticImportClosure:direct,reviewedLazyImports:dynamic,expandedStaticImportEdges:expanded.edges,closureFiles,pageFiles,renderMedia,original315SourceVerification:original315,frames,
  excludedResources:[
    {path:'deployment.json',reason:'Fetched for exported sourceCommit/sourceTree and deployment identity metadata, without modifying geometry, camera, lights or shading. Capture kept its observed 404. A later deployment receipt cannot be inserted into old image conditions.'},
    {path:'assets/landmarks/',reason:'city-landmarks.js is imported through physical city geometry. Its texture loader is scoped to buildCityLandmarks(), which inspection never calls; it is not an input to these inspection frames.'},
    {path:'assets city light-field media',reason:'City-specific direct/indirect lighting scene modules are outside the inspection rendering path. New city light fields require independent city frames.'},
    {path:'Tesla sourceURL and file fields in vehicle-display-study.js',reason:'Reference descriptions and landmark data; the inspection page does not load these official photos as framebuffer content. The data module itself is byte-identical.'}
  ],
  limits:[
    'The original PNGs and capture JSON retain the original 2d88 identity, except the four original-page stock comparison PNGs which retain the actual 3.15 baseline identity. They are component evidence inherited by c12a, not new c12a pixel captures.',
    'model-build.js is explicitly different identity metadata. Thus the full static import set is not literally byte-identical; all other 47 static modules and 55 expanded modules, HTML/CSS, and the loaded HDR are byte-identical.',
    'The two 2d88 main-city cockpit PNGs and four independent UI screenshots are outside this 32-frame inheritance assertion. Final city cockpit evidence is captured separately under the new city build.',
    'No hardware FPS or pixel-bitwise reproducibility claim follows from unchanged sources. Original images remain actual ANGLE SwiftShader WebGL2 captures under their recorded conditions.'
  ]
};
writeFileSync(resolve(evidence,'component-inheritance-c12a.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,capturedBuildId:capturedBuild,targetBuildId:targetBuild,counts:report.counts,output:'qa/vehicle-native-3.16/component-inheritance-c12a.json'},null,2));
