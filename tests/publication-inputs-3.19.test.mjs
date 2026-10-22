// Exercise real consumers of restored publication inputs, without altering them.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {prepareDependencies} from '../scripts/prepare-dependencies.mjs';
import {validateExperimentRecord,executeExperiment,parseExperimentArchive} from '../dist/experiment-records.js';
import {parseLandingArchive} from '../dist/landing-challenge.js';
import {parseCityFlightArchive,validateCityFlightResult} from '../dist/city-flight-challenge.js';
import {RoadsterSim} from '../dist/physics.js';
const recovery=prepareDependencies({purpose:'test'}),files=[];
const hash=data=>createHash('sha256').update(data).digest('hex');
const load=path=>{const raw=readFileSync(path);files.push({path,bytes:raw.length,sha256:hash(raw)});return raw;};
let current;
for(const version of ['3.10','3.11','3.12','3.13','3.14','3.15','3.17','3.18','3.19']){
  const path=`qa/fixtures/numerical-control-capture-city-${version}.json`,raw=load(path),archive=JSON.parse(raw);
  assert.equal(archive.schema,'roadster.live-experiment-library');assert.ok(archive.records.length>0);
  for(const record of archive.records)validateExperimentRecord(record);
  // The 3.19 QA aggregate exceeds the interactive 12 MiB import limit. Keep
  // that application limit and original single logical file; validate its
  // records using the production numerical consumer, without splitting storage.
  if(raw.length<=12*1024*1024)assert.equal(parseExperimentArchive(raw.toString()).length,archive.records.length);
  else assert.throws(()=>parseExperimentArchive(raw.toString()),/12 MiB/);
  if(version==='3.19')current=archive.records.reduce((a,b)=>a.stepCount<b.stepCount?a:b);
}
const execution=await executeExperiment(current,{createSim:state=>new RoadsterSim(state.params,{world:state.worldType}),yieldEvery:0});
assert.equal(execution.status,'completed');assert.equal(execution.completedSteps,current.stepCount);assert.equal(execution.reproduction.status,'matched');
for(const path of ['qa/research-native-3.17/final-ui/native-task-library.json','qa/wind-matrix-3.18/development-2/strong-bench.json.gz','qa/wind-matrix-3.18/final/calm-bench.json.gz','qa/wind-matrix-3.18/final/crosswind-bench.json.gz','qa/wind-matrix-3.18/final/strong-bench.json.gz']){
  const raw=load(path),text=(path.endsWith('.gz')?gunzipSync(raw):raw).toString();assert.ok(parseLandingArchive(text).records.length>0);
}
const attempts=parseCityFlightArchive(load('qa/learning-loop-3.19/three-attempts.json').toString());
const practice=JSON.parse(load('qa/learning-loop-3.19/hard-practice.json'));validateCityFlightResult(practice);
const parent=attempts.records.find(record=>record.id===practice.parentRunId);assert(parent);assert.equal(parent.liveExperiment.initialSnapshot.stateLabel,practice.liveExperiment.initialSnapshot.stateLabel);
const route=JSON.parse(load('qa/surface-route-3.19/route-drive.json'));assert.deepEqual(route.runs.map(run=>run.preset),['dry-day','after-rain']);assert(route.runs.every(run=>run.physicalSteps>0&&run.samples.length>0));
for(const path of ['qa/pitch-maneuver-3.17.ndjson.gz','qa/city-contact-provenance-3.17.ndjson.gz','qa/surface-route-3.19/contact-and-sound-curves.ndjson']){
  const raw=load(path),text=(path.endsWith('.gz')?gunzipSync(raw):raw).toString(),rows=text.trim().split('\n');assert(rows.length>0);for(const row of rows)assert.equal(typeof JSON.parse(row),'object');
}
for(const file of files)assert.equal(hash(readFileSync(file.path)),file.sha256,'Consumer changed original input '+file.path);
console.log(JSON.stringify({status:'passed',scope:'Actual production record/task parsers, preserved aggregate import limit, one exact current-model city numerical replay, parent-practice linkage, route structure and original trace decoding. No native graphics, full historical solver replay or full route UI acceptance.',recovery,replayed:{recordId:current.id,steps:execution.completedSteps,reproduction:execution.reproduction.status},files},null,2));
