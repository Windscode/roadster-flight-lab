// Recompute the one QA study exported through the deployed 3.13 browser UI.
// This checks numerical agreement, not WebGL, input-device feel, or frame rate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runExperiment} from '../dist/experiment-worker.js';
import {importStudy} from '../dist/research-study.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const bundle=JSON.parse(readFileSync(new URL('./live-browser-x-3.13.json',import.meta.url),'utf8'));
assert.equal(bundle.results.length,1);
assert.equal(bundle.requests.length,1);
const observed=bundle.results[0].report;
assert.equal(observed.modelBuildId,MODEL_BUILD_ID,'Check out the published 3.13 sources before recomputing this evidence.');
const replay=runExperiment(importStudy(bundle)[0].request);
const fields=['modelVersion','modelBuildId','protocolVersion','runId','request','appliedParams','initialState','finalState','metrics','phases','events','rows'];
let numericValuesCompared=0,maxAbsDifference=0,maxRelativeDifference=0;
function compare(a,b,path){
  if(typeof a==='number'&&typeof b==='number'){
    assert.ok(Number.isFinite(a)&&Number.isFinite(b),path+' must be finite');
    numericValuesCompared++;
    const absolute=Math.abs(a-b),relative=absolute/Math.max(1,Math.abs(a),Math.abs(b));
    maxAbsDifference=Math.max(maxAbsDifference,absolute);
    maxRelativeDifference=Math.max(maxRelativeDifference,relative);
    assert.ok(relative<=1e-11,path+' differs: '+a+' / '+b);
    return;
  }
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
    assert.deepEqual(Object.keys(a),Object.keys(b),path+' keys');
    for(const key of Object.keys(a))compare(a[key],b[key],path+'.'+key);
    return;
  }
  assert.deepEqual(a,b,path);
}
for(const field of fields)compare(observed[field],replay[field],field);
assert.equal(observed.outcome,'stable_landing');
assert.equal(replay.outcome,observed.outcome);
console.log(JSON.stringify({status:'matched',modelBuildId:MODEL_BUILD_ID,rows:observed.rows.length,numericValuesCompared,maxAbsDifference,maxRelativeDifference,relativeTolerance:1e-11,scope:'Deployed native Worker versus the same published numerical sources. No GPU acceptance.'}));
