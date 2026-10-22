import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {parseLandingArchive,loadLandingLibrary,LANDING_LIBRARY_KEY,reexecuteLandingTask} from '../dist/landing-challenge.js';
// Explicit 3.19 review: prior task solvers/builds are not installed in the live
// application. Exact archived results and algorithms remain viewable/exportable;
// changing a version label cannot enable historical execution.
// Audit and snapshot-state boundaries: docs/history-contract-review-3.19.md.
assert.equal(MODEL_VERSION,'3.19.0','Review historical task compatibility for each new model.');
const checks=[],sources=[];let totalWrites=0;
for(const [relativePath,version] of [['qa/landing-task-fixtures-3.14.json','3.14.0'],['qa/height-study-fixtures-3.15.json','3.15.0'],['qa/landing-task-fixtures-3.16.json','3.16.0'],['qa/landing-task-fixtures-3.17.json','3.17.0']]){
  const path=new URL('../'+relativePath,import.meta.url),raw=readFileSync(path,'utf8'),original=parseLandingArchive(raw);
  assert.equal(original.records.length,3);assert(original.records.every(record=>record.identity.modelVersion===version));
  // The pretty-printed 3.15 fixture exceeds the existing 4 MiB storage cap.
  // Native libraries use compact JSON with the same complete record values.
  // Test the oversized original's protection separately, never relax the cap.
  const storedRaw=JSON.stringify(original);assert(Buffer.byteLength(storedRaw)<=4*1024*1024);
  let writes=0;const storage={getItem:key=>key===LANDING_LIBRARY_KEY?storedRaw:null,setItem(){writes++;throw Error('Historical read must not write');}};
  const loaded=loadLandingLibrary(storage);assert.equal(loaded.warning,null);assert.deepEqual(loaded.value.records,original.records);assert.deepEqual(parseLandingArchive(JSON.stringify(loaded.value)).records,original.records);assert.deepEqual(loaded.value.algorithms,original.algorithms);assert.equal(writes,0);assert.equal(storage.getItem(LANDING_LIBRARY_KEY),storedRaw);
  let oversizedProtection=null;if(Buffer.byteLength(raw)>4*1024*1024){const oversized=loadLandingLibrary({getItem:()=>raw,setItem(){writes++;throw Error('Oversized history must not be overwritten');}});assert.equal(oversized.readOnly,true);assert.equal(oversized.protectedRaw,raw);assert.match(oversized.warning,/容量/);assert.equal(writes,0);oversizedProtection={readOnly:oversized.readOnly,originalTextUnchanged:oversized.protectedRaw===raw,warning:oversized.warning};}
  checks.push('Original '+version+' task outcomes, algorithms, physical endpoints and full controller I/O survive read and export without storage writes.');
  for(const result of original.records)await assert.rejects(reexecuteLandingTask(result,{yieldEvery:0}),/Original task model\/build is not installed/);
  assert.equal(readFileSync(path,'utf8'),raw);checks.push('Reexecution refuses unavailable '+version+' model/build explicitly; historical identities and bytes are never relabelled as current.');
  totalWrites+=writes;sources.push({path:relativePath,sha256:createHash('sha256').update(raw).digest('hex'),originalBytes:Buffer.byteLength(raw),storedBytes:Buffer.byteLength(storedRaw),storageSerialization:'compact JSON; all original record and algorithm values retained',oversizedProtection,records:original.records.map(record=>({id:record.id,status:record.status,identity:record.identity,taskId:record.taskId,algorithmHash:record.algorithm.hash}))});
}
writeFileSync(new URL(`../qa/history-task-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({schema:'roadster-historical-task-readability',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',checks,sources,storageWrites:totalWrites,execution:'explicitly refused for unavailable original solver; view/export retained'},null,2)+'\n');for(const check of checks)console.log('PASS: '+check);
