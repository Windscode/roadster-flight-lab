import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const results=[],samples=60,warmCalls=16;
for(const scenario of ['city','harbor','skyway','waterfront']){
  const sim=new RoadsterSim();sim.reset(scenario);assert.equal(sim.scenario,scenario,'The timing location must not silently fall back to the free scenario');
  for(let i=0;i<60;i++)sim.advanceFixed({});
  const options={maxDistance:8,includeQuickRoll:true};for(let i=0;i<warmCalls;i++)sim.getClearanceEstimate(options);
  const times=[];let last;
  for(let i=0;i<samples;i++){const start=performance.now();last=sim.getClearanceEstimate(options);times.push(performance.now()-start);}
  const sorted=[...times].sort((a,b)=>a-b),percentile=p=>sorted[Math.min(samples-1,Math.ceil(samples*p)-1)];
  results.push({scenario,actualScenario:sim.scenario,position:{...sim.body.position},geometrySignature:sim.exportState().geometrySignature,samples,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),maximumMs:Math.max(...times),estimatedMsPerSecondAt4Hz:4*percentile(.5),timesMs:times,sampledDirections:Object.keys(last.distances),rangeM:last.rangeM});
}
const sources=['dist/physics.js','dist/vehicle-clearance.js','dist/city-data.js','dist/city-plan.js','dist/city-landmarks.js'];
const report={schema:'roadster-clearance-cpu-sampling',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,scope:'Node CPU, shared validation machine; 16 warm calls then 60 measurements per static declared city location. No browser frame-time, GPU timing or driving-route claim.',environment:{node:process.version,platform:process.platform,cpuModel:os.cpus()[0]?.model??null},directions:6,envelopePoints:56,raysPerCall:342,warmCalls,sourceHashes:Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')])),results};
writeFileSync(new URL(`../qa/clearance-cpu-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,results:results.map(({scenario,p50Ms,p95Ms,p99Ms})=>({scenario,p50Ms,p95Ms,p99Ms}))}));
