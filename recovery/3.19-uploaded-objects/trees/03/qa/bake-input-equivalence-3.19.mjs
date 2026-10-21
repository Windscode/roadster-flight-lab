// Explicit 3.19 review of retained bake provenance. This does not rebake or
// rewrite the historical manifests. Supply a readable frozen 3.18 checkout.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {BAKE_INPUT_RECIPES,collectBakeInputs,bakeInputSHA256 as sha} from '../scripts/bake-input-audit.mjs';

const currentRoot=fileURLToPath(new URL('../',import.meta.url)),baselineRoot=process.argv[2];
assert.ok(baselineRoot,'Provide the frozen, readable 3.18 checkout path');
assert.equal(MODEL_VERSION,'3.19.0','This explicit reviewed delta belongs to 3.19');
const folder=resolve(currentRoot,'qa/bake-input-equivalence-3.19');mkdirSync(folder,{recursive:true});
const reports=[];
for(const recipe of BAKE_INPUT_RECIPES){
  const manifestPath='dist/assets/'+recipe.folder+'/manifest.json',original=readFileSync(resolve(baselineRoot,manifestPath)),current=readFileSync(resolve(currentRoot,manifestPath));
  assert.deepEqual(current,original,'Retained bake manifest must remain byte-identical');
  const manifest=JSON.parse(original),sourceDifferences=[];
  for(const [path,hash] of Object.entries(manifest.sourceHashes)){
    const before=sha(readFileSync(resolve(baselineRoot,path))),after=sha(readFileSync(resolve(currentRoot,path)));
    assert.equal(before,hash,'Frozen source does not match bake provenance: '+path);
    if(after!==hash)sourceDifferences.push({path,bakedSourceSHA256:hash,reviewedCurrentSourceSHA256:after});
  }
  const before=await collectBakeInputs(baselineRoot,recipe),after=await collectBakeInputs(currentRoot,recipe);
  assert.equal(before.extraction.scriptSHA256,manifest.sourceHashes[recipe.script]);
  assert.equal(after.extraction.scriptSHA256,before.extraction.scriptSHA256,'Transport algorithm changed');
  const {canonicalGeometryJSON}=await import('../dist/irradiance-math.js');
  for(const input of [before,after]){
    assert.equal(sha(canonicalGeometryJSON(input.value.geometry)),manifest.geometryCanonicalSHA256);
    if(manifest.geometrySHA256)assert.equal(sha(JSON.stringify(input.value.geometry)),manifest.geometrySHA256);
    if(input.value.materialModel){
      assert.deepEqual(input.value.materialModel,manifest.materialModel);
      assert.deepEqual(input.value.skySH,manifest.skySH);assert.deepEqual(input.value.sunFill,manifest.sunFill);
      assert.equal(input.value.samples,manifest.samplesPerProbe);assert.equal(input.value.bounces,manifest.bounces);
    }
    if(input.value.anchors)assert.equal(sha(JSON.stringify(input.value.anchors)),manifest.anchorSHA256);
  }
  const stored=[];
  for(const [label,input] of [['frozen-3.18',before],['current-3.19',after]]){
    const path=resolve(folder,recipe.folder+'-'+label+'.json.gz'),bytes=gzipSync(input.bytes,{level:9});writeFileSync(path,bytes);
    stored.push({label,path:relative(currentRoot,path),gzipSHA256:sha(bytes),gzipBytes:bytes.length,inputSHA256:input.sha256,inputBytes:input.bytes.length,extraction:input.extraction});
  }
  const retainedVolumes=manifest.volumes.map(v=>{
    const path='dist/assets/'+recipe.folder+'/'+v.file,beforeBytes=readFileSync(resolve(baselineRoot,path)),afterBytes=readFileSync(resolve(currentRoot,path));
    assert.equal(sha(beforeBytes),v.sha256);assert.equal(sha(afterBytes),v.sha256);assert.deepEqual(afterBytes,beforeBytes);
    return {path,sha256:v.sha256,bytes:afterBytes.length};
  });
  const inputsByteEqual=after.bytes.equals(before.bytes);
  reports.push({folder:recipe.folder,manifest:{path:manifestPath,sha256:sha(original),bytes:original.length,unchanged:true},sourceDifferences,inputsByteEqual,inputs:stored,retainedVolumes});
  console.log(recipe.folder+': '+(inputsByteEqual?'identical':'DIFFERENT')+' actual input bytes ('+before.bytes.length+'), '+sourceDifferences.length+' reviewed source differences');
}
const paths=['scripts/bake-input-audit.mjs','qa/bake-input-equivalence-3.19.mjs','dist/city-route-detail.js'];
const report={schema:'roadster-retained-bake-input-review-3.19',createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:reports.every(r=>r.inputsByteEqual)?'passed-input-equivalence':'input-changed-rebake-review-required',baseline:{commit:'eb2ca9d67f5b9fe7a81907f5304646e585a535e6',tree:'33f4463d70b8490ec74735a28df58ac8e3fea255',root:resolve(baselineRoot),sourceIdentity:'Each frozen source was independently hashed against the unchanged manifest before executing its baker initialization.'},reports,sourceHashes:Object.fromEntries(paths.map(path=>[path,sha(readFileSync(resolve(currentRoot,path)))])),limits:['No full bake was rerun, and no manifest source hash or binary was rewritten.','The daylight static envelope/averaged albedo, source sky, layout and initialization bytes; and the night geometry/anchors/layout/generated bounce-source bytes are compared. Fine facade trim and optical wetness are outside these original bake models.','Transport algorithm bytes remain exactly the retained manifest versions. Input equality supports reuse of the retained approximate field, not pixel equivalence of redesigned facades or GPU acceptance.']};
writeFileSync(resolve(folder,'report.json'),JSON.stringify(report,null,2)+'\n');
assert.ok(reports.every(r=>r.inputsByteEqual),'At least one actual bake input differs; do not relax the source gate');
