import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {planPagesEvidence,assertValidationEvidenceCoverage,copyPagesEvidence} from '../roadster-capture-316/scripts/pages-evidence.mjs';

const output='/workspace/scratch/867d449c399e/preflight-late-316',root=mkdtempSync(join(output,'pages-evidence-fixture-'));
const sha=data=>createHash('sha256').update(data).digest('hex'),checks=[];
const save=(name,value)=>{const target=join(root,name);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,value);};
const listPath='scripts/list.json',ordinary=['qa/current.json','qa/raw-trace.bin','docs/report.md','qa/old.json'];
const list=files=>save(listPath,JSON.stringify({schema:'roadster.pages-evidence',version:1,release:'3.16',files}));
save('qa/old.json','{"old":true}\n');save('qa/current.json','{"createdAt":"first","result":7}\n');save('qa/raw-trace.bin',Buffer.from([0,255,3,19,128,10]));save('docs/report.md','# Complete fixture report\n');list(ordinary);
const packedBytes=readFileSync(join(root,'qa/old.json')),packed=[{path:'qa/old.json',bytes:packedBytes.length,sha256:sha(packedBytes)}];
const plan=()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:ordinary,packedEntries:packed});
const p=plan(),copy=copyPagesEvidence({root,output:join(root,'copy-one'),plan:p});
assert.equal(copy.fileCount,4);assert.equal(copy.packedFiles,1);assert.equal(copy.ordinaryFiles,4);assert.deepEqual(copy.files.find(x=>x.path==='qa/old.json').sources,['immutable-payload','ordinary-git-file']);
for(const entry of copy.files){const data=readFileSync(join(root,'copy-one',entry.path));assert.equal(data.length,entry.bytes);assert.equal(sha(data),entry.sha256);}
checks.push('Exact text and arbitrary binary bytes copied, complete manifest identities verified; an overlapping old payload is counted once and preserves both origins.');
save('qa/current.json','{"createdAt":"second","result":7}\n');const second=plan();assert.notEqual(second.files.find(x=>x.path==='qa/current.json').sha256,p.files.find(x=>x.path==='qa/current.json').sha256);copyPagesEvidence({root,output:join(root,'copy-two'),plan:second});checks.push('A regenerated ordinary report is accepted without changing an immutable payload.');
save('qa/current.json','{"createdAt":"third","result":7}\n');assert.throws(()=>copyPagesEvidence({root,output:join(root,'copy-race'),plan:second}),/changed during candidate preparation/);checks.push('Changing an ordinary source during its active copy is refused.');
save('qa/old.json','{"old":false}\n');assert.throws(plan,/differs from its strict manifest/);save('qa/old.json',packedBytes);checks.push('A modified old payload is still refused.');
assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:[],packedEntries:packed}),/not Git tracked/);checks.push('Listed but untracked ordinary evidence is refused, not silently skipped.');
list(['qa/../../outside.json']);assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:['qa/../../outside.json']}),/leaves its root/);checks.push('Path traversal is refused.');
symlinkSync(join(root,'qa/current.json'),join(root,'qa/link.json'));list(['qa/link.json']);assert.throws(()=>planPagesEvidence({root,listFile:listPath,release:'3.16',trackedPaths:['qa/link.json']}),/Symbolic link/);checks.push('A listed symbolic link is refused.');
const coverage=assertValidationEvidenceCoverage({report:'qa/current.json',instructions:'docs/report.md',location:'qa/render-budget-check.mjs:95'},ordinary);assert.equal(coverage.references,2);assert.equal(coverage.codeLocations.length,1);assert.throws(()=>assertValidationEvidenceCoverage({native:{report:'qa/native-acceptance-3.16.json'}},ordinary),/native-acceptance-3.16/);checks.push('Validation/native evidence paths must be present; code:line references are reported separately.');
assert.equal(sha(readFileSync(join(root,'qa/old.json'))),packed[0].sha256);
const result={schema:'roadster-pages-evidence-local-check-3.16',status:'passed',createdAt:new Date().toISOString(),checks,checkCount:checks.length,fixtureRoot:root,scope:'Local copy helper fixtures only. No prepare-pages/deployment.json, git commit, model identity, payload restore or public upload was performed.',sourceHashes:Object.fromEntries(['scripts/pages-evidence.mjs','scripts/prepare-pages.mjs','scripts/pages-evidence-files-3.16.json'].map(path=>[path,sha(readFileSync('/workspace/scratch/867d449c399e/roadster-capture-316/'+path))]))};
writeFileSync(join(output,'pages-evidence-local-check-316.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
