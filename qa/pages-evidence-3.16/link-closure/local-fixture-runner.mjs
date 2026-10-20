// Local packaging fixtures only; never imports or runs prepare-pages.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,symlinkSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {planPagesEvidence,assertValidationEvidenceCoverage,copyPagesEvidence,assertRuntimeSourceBrowseCopies} from '../../../scripts/pages-evidence.mjs';

const repository=fileURLToPath(new URL('../../../',import.meta.url));
const output=process.argv[2]?resolve(process.argv[2]):mkdtempSync(join(tmpdir(),'roadster-pages-link-fixtures-'));
mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(output,'fixture-'));
const sha=data=>createHash('sha256').update(data).digest('hex'),checks=[];
const write=(base,name,value)=>{const target=join(base,name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,value);};
const save=(name,value)=>write(root,name,value);
const listPath='scripts/list.json',ordinary=['qa/current.json','qa/raw-trace.bin','docs/report.md','qa/old.json'];
const list=files=>save(listPath,JSON.stringify({schema:'roadster.pages-evidence',version:1,release:'3.16',files}));
save('qa/old.json','{"old":true}\n');save('qa/current.json','{"createdAt":"first","result":7}\n');
save('qa/raw-trace.bin',Buffer.from([0,255,3,19,128,10]));save('docs/report.md','# Complete fixture report\n');list(ordinary);
const packedBytes=readFileSync(join(root,'qa/old.json')),packed=[{path:'qa/old.json',bytes:packedBytes.length,sha256:sha(packedBytes)}];
const plan=()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:ordinary,packedEntries:packed});

// The original eight checks are rerun against the changed helper. The prior
// 19:37 runner/result and their timestamps remain separate archived files.
const p=plan(),copy=copyPagesEvidence({root,output:join(root,'copy-one'),plan:p});
assert.equal(copy.fileCount,4);assert.equal(copy.packedFiles,1);assert.equal(copy.ordinaryFiles,4);
assert.deepEqual(copy.files.find(x=>x.path==='qa/old.json').sources,['immutable-payload','ordinary-git-file']);
for(const entry of copy.files){const data=readFileSync(join(root,'copy-one',entry.path));assert.equal(data.length,entry.bytes);assert.equal(sha(data),entry.sha256);}
checks.push('Exact text and arbitrary binary bytes copied, complete manifest identities verified; an overlapping old payload is counted once and preserves both origins.');
save('qa/current.json','{"createdAt":"second","result":7}\n');const second=plan();
assert.notEqual(second.files.find(x=>x.path==='qa/current.json').sha256,p.files.find(x=>x.path==='qa/current.json').sha256);
copyPagesEvidence({root,output:join(root,'copy-two'),plan:second});
checks.push('A regenerated ordinary report is accepted without changing an immutable payload.');
save('qa/current.json','{"createdAt":"third","result":7}\n');
assert.throws(()=>copyPagesEvidence({root,output:join(root,'copy-race'),plan:second}),/changed during candidate preparation/);
checks.push('Changing an ordinary source during its active copy is refused.');
save('qa/old.json','{"old":false}\n');assert.throws(plan,/differs from its strict manifest/);save('qa/old.json',packedBytes);
checks.push('A modified old payload is still refused.');
assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:[],packedEntries:packed}),/not Git tracked/);
checks.push('Listed but untracked ordinary evidence is refused, not silently skipped.');
list(['qa/../../outside.json']);
assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:['qa/../../outside.json']}),/leaves its root/);
checks.push('Path traversal is refused.');
symlinkSync(join(root,'qa/current.json'),join(root,'qa/link.json'));list(['qa/link.json']);
assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:['qa/link.json']}),/Symbolic link/);
checks.push('A listed symbolic link is refused.');
const coverage=assertValidationEvidenceCoverage({report:'qa/current.json',instructions:'docs/report.md',location:'qa/render-budget-check.mjs:95'},ordinary);
assert.equal(coverage.references,2);assert.equal(coverage.codeLocations.length,1);
assert.throws(()=>assertValidationEvidenceCoverage({native:{report:'qa/native-acceptance-3.16.json'}},ordinary),/native-acceptance-3.16/);
checks.push('Validation/native evidence paths must be present; code:line references are reported separately.');

const additions={
  'scripts/check.mjs':'export const scriptFixture = "read only";\n',
  'tests/check.test.mjs':'export const testFixture = "not executed";\n',
  'tests/fixtures/frozen.json':'{"frozen":true,"value":3}\n',
  'dist/physics-3.9-notes.md':'# Historical source document\n[fixture](../tests/fixtures/frozen.json)\n',
  'dist/wet-road-reflection.js':'export const reflectionFixture = 1;\n',
  'dist/vendor/three.module.js':'export const vendorFixture = 2;\n',
  '3.8-UPDATE-NOTES.md':'# Retained release notes\n',
  'repository-payloads/README.md':'# Immutable payload documentation\n'
};
for(const [path,data]of Object.entries(additions))save(path,data);
const expandedPaths=[...ordinary,...Object.keys(additions),listPath];list(expandedPaths);
const expandedPlan=planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:expandedPaths,packedEntries:packed});
const expandedOutput=join(root,'copy-expanded');
// Simulate only the three already-copied runtime files, not an actual site.
for(const entry of expandedPlan.files.filter(row=>row.runtimeSitePath))write(expandedOutput,entry.runtimeSitePath,readFileSync(join(root,entry.path)));
const expandedCopy=copyPagesEvidence({root,output:expandedOutput,plan:expandedPlan});
assert.equal(expandedCopy.fileCount,13);
for(const entry of expandedCopy.files){const data=readFileSync(join(expandedOutput,entry.path));assert.equal(data.length,entry.bytes);assert.equal(sha(data),entry.sha256);}
assert.equal(expandedCopy.files.find(x=>x.path===listPath).sha256,sha(readFileSync(join(root,listPath))));
assert.equal(expandedCopy.files.find(x=>x.path==='scripts/check.mjs').category,'source-reference');
assert.equal(expandedCopy.files.find(x=>x.path==='tests/fixtures/frozen.json').category,'source-reference');
assert.equal(expandedCopy.files.find(x=>x.path==='3.8-UPDATE-NOTES.md').category,'historical-release-notes');
assert.equal(expandedCopy.files.find(x=>x.path==='repository-payloads/README.md').category,'payload-documentation');
checks.push('Explicit tracked test/script, historical notes, payload documentation and the path list itself are copied byte-for-byte, with their categories recorded.');

const browseParity=assertRuntimeSourceBrowseCopies({output:expandedOutput,files:expandedCopy.files});
assert.equal(browseParity.copies.length,3);assert.equal(expandedCopy.runtimeSourceBrowseCopies.length,3);
for(const entry of browseParity.copies){assert.equal(entry.path,'dist/'+entry.runtimeSitePath);assert.equal(sha(readFileSync(join(expandedOutput,entry.path))),sha(readFileSync(join(expandedOutput,entry.runtimeSitePath))));}
const runtimePath=join(expandedOutput,'wet-road-reflection.js'),runtimeBytes=readFileSync(runtimePath);
writeFileSync(runtimePath,'changed runtime fixture\n');
assert.throws(()=>assertRuntimeSourceBrowseCopies({output:expandedOutput,files:expandedCopy.files}),/differs from its site-root runtime file/);
writeFileSync(runtimePath,runtimeBytes);assertRuntimeSourceBrowseCopies({output:expandedOutput,files:expandedCopy.files});
checks.push('Three dist source-browsing copies retain repository URLs, leave the site-root runtime bytes intact, expose their role in metadata and reject a mismatched runtime counterpart.');

for(const missing of [...Object.keys(additions),listPath])assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:expandedPaths.filter(p=>p!==missing),packedEntries:packed}),/not Git tracked/);
checks.push('Every newly accepted source/documentation category still refuses an explicitly listed but untracked file.');

save('dist/assets/references/unrequested.jpg',Buffer.from([0xff,0xd8,0xff,0xd9]));list(['dist/assets/references/unrequested.jpg']);
assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:['dist/assets/references/unrequested.jpg']}),/Unlisted evidence category/);
list(['repository-payloads/manifest.json']);
assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:['repository-payloads/manifest.json']}),/Unlisted evidence category/);
list(['scripts/../../outside.mjs']);
assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:['scripts/../../outside.mjs']}),/leaves its root/);
symlinkSync(join(root,'qa/current.json'),join(root,'tests/fixture-link.mjs'));list(['tests/fixture-link.mjs']);
assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:['tests/fixture-link.mjs']}),/Symbolic link/);
checks.push('The added source categories preserve traversal/symlink rejection and do not admit reference images or ordinary replacements for the immutable payload manifest.');

list(expandedPaths);
const collisionOutput=join(root,'copy-collision'),collisionPath=expandedPlan.files[0].path,originalDestination=Buffer.from('existing destination retained\n');
write(collisionOutput,collisionPath,originalDestination);
assert.throws(()=>copyPagesEvidence({root,output:collisionOutput,plan:expandedPlan}),/EEXIST/);
assert.deepEqual(readFileSync(join(collisionOutput,collisionPath)),originalDestination);
checks.push('A pre-existing destination is refused without overwriting it, including the newly accepted source-browsing categories.');

assert.equal(sha(readFileSync(join(root,'qa/old.json'))),packed[0].sha256);
const sourcePaths=['scripts/pages-evidence.mjs','scripts/prepare-pages.mjs','scripts/pages-evidence-files-3.16.json','repository-payloads/manifest.json','qa/pages-evidence-3.16/local-fixture-result.json','qa/pages-evidence-3.16/link-closure/local-fixture-runner.mjs'];
const result={schema:'roadster-pages-link-closure-local-check-3.16',status:'passed',createdAt:new Date().toISOString(),checkCount:checks.length,inheritedCheckCount:8,addedCheckCount:checks.length-8,checks,fixtureRoot:root,scope:'Synthetic local packaging fixtures only; the original eight checks plus five source-link checks. Independent of the 607 application assertions. No actual prepare-pages, deployment identity, runtime test, payload restore, browser, Git stage/commit or publication was performed.',syntheticTracking:'Fixture trackedPaths are declared test inputs; they are not a claim that pending project evidence has been staged.',sourceHashes:Object.fromEntries(sourcePaths.map(path=>[path,sha(readFileSync(join(repository,path)))])),copyManifest:expandedCopy,sourceBrowseVerification:browseParity};
writeFileSync(join(output,'local-fixture-result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,checkCount:result.checkCount,inheritedCheckCount:8,addedCheckCount:result.addedCheckCount,output:join(output,'local-fixture-result.json')},null,2));
