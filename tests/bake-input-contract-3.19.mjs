// A narrow, independently captured exception to source-file byte identity.
// It is not a new bake: every retained manifest and volume keeps its old hash.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {BAKE_INPUT_RECIPES,collectBakeInputs,bakeInputSHA256 as sha} from '../scripts/bake-input-audit.mjs';

export async function assertRetainedBakeInputs(){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const contract=JSON.parse(readFileSync(new URL('./fixtures/bake-input-contract-3.19.json',import.meta.url)));
  assert.equal(MODEL_VERSION,contract.reviewedModelVersion,'Later releases must review their bake source changes explicitly');
  const proof=readFileSync(resolve(root,contract.reviewEvidence.path));
  assert.equal(sha(proof),contract.reviewEvidence.sha256,'The independently captured original review must remain exact');
  assert.equal(JSON.parse(proof).status,'passed-input-equivalence');
  assert.equal(sha(readFileSync(resolve(root,contract.auditHelper.path))),contract.auditHelper.sha256,'Review the input extraction if its code changes');
  for(const [path,hash] of Object.entries(contract.reviewedAdditionalSources))assert.equal(sha(readFileSync(resolve(root,path))),hash,'Unreviewed authored dependency: '+path);
  const results=[];
  for(const entry of contract.bakes){
    const manifestBytes=readFileSync(resolve(root,entry.manifest.path));
    assert.equal(sha(manifestBytes),entry.manifest.sha256,'Do not relabel or rewrite retained bake provenance');
    const manifest=JSON.parse(manifestBytes),exceptions=new Map(entry.reviewedSourceDifferences.map(x=>[x.path,x]));
    assert.deepEqual(manifest.sourceHashes,entry.originalSourceHashes);
    for(const [path,originalHash] of Object.entries(entry.originalSourceHashes)){
      const exception=exceptions.get(path),currentHash=sha(readFileSync(resolve(root,path)));
      if(exception)assert.equal(exception.bakedSourceSHA256,originalHash);
      assert.equal(currentHash,exception?.reviewedCurrentSourceSHA256??originalHash,'An unreviewed bake dependency changed: '+path);
    }
    const compressed=readFileSync(resolve(root,entry.frozenActualInput.path));
    assert.equal(compressed.length,entry.frozenActualInput.gzipBytes);assert.equal(sha(compressed),entry.frozenActualInput.gzipSHA256);
    const frozen=gunzipSync(compressed,{maxOutputLength:entry.frozenActualInput.inputBytes+1});
    assert.equal(frozen.length,entry.frozenActualInput.inputBytes);assert.equal(sha(frozen),entry.frozenActualInput.inputSHA256);
    const recipe=BAKE_INPUT_RECIPES.find(x=>x.folder===entry.folder);assert.ok(recipe);
    const current=await collectBakeInputs(root,recipe);
    assert.equal(current.extraction.scriptSHA256,entry.bakerScriptSHA256,'The original transport code must remain unchanged');
    assert.equal(current.sha256,entry.frozenActualInput.inputSHA256,'Actual bake inputs changed; perform a new bake review');
    assert.ok(current.bytes.equals(frozen),'Actual generated inputs must be byte-for-byte equal, not within a relaxed tolerance');
    for(const v of manifest.volumes){
      const bytes=readFileSync(resolve(root,'dist/assets/'+entry.folder+'/'+v.file));
      assert.equal(bytes.length,v.bytes);assert.equal(sha(bytes),v.sha256,'A retained bake binary changed');
    }
    results.push({folder:entry.folder,inputSHA256:current.sha256,inputBytes:current.bytes.length,inputsByteEqual:true,manifestUnchanged:true,reviewedSourceDifferences:entry.reviewedSourceDifferences});
  }
  return {contract:'tests/fixtures/bake-input-contract-3.19.json',reviewEvidence:contract.reviewEvidence,baselineCommit:contract.baselineCommit,results,scope:'Current actual baker initialization compared with the original 3.18 captured bytes. No rebake, new provenance, physical threshold change or GPU claim.'};
}
