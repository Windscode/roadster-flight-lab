// Assemble existing bounded native observations without rerunning, relabelling
// or upgrading their scope. A partial acceptance status is intentional.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
const root=new URL('../',import.meta.url),bytes=p=>readFileSync(new URL(p,root)),read=p=>JSON.parse(bytes(p));
const sha=b=>createHash('sha256').update(b).digest('hex'),receipt=p=>({report:p,bytes:bytes(p).length,sha256:sha(bytes(p))});
for(const [p,h] of Object.entries(MODEL_SOURCE_HASHES))assert.equal(sha(bytes('dist/'+p)),h,'Stale final source: '+p);
const compare=hashes=>({same:Object.keys(MODEL_SOURCE_HASHES).filter(p=>hashes[p]===MODEL_SOURCE_HASHES[p]),changed:Object.keys(MODEL_SOURCE_HASHES).filter(p=>hashes[p]!==MODEL_SOURCE_HASHES[p])});
const inputPath='qa/input-native-3.17/first/report.json',input=read(inputPath),inputId=input.cases[0].identity.modelBuildId;
assert.ok(input.cases.every(c=>c.identity.modelBuildId===inputId));
const inputManifest=await import(new URL('../qa/build-identities-3.17/'+inputId+'.js',import.meta.url));
const inputComparison=compare(inputManifest.MODEL_SOURCE_HASHES);
for(const p of ['physics.js','pitch-maneuver.js','contact-friction.js','contact-ledger.js','input-session.js','controls.js','pilot-input-intent.js','main.js','operation-hud.js','vehicle-models.js'])assert.ok(inputComparison.same.includes(p));
const fullPath='qa/research-native-3.17/second/report.json',full=read(fullPath);
const workerPath='qa/research-native-3.17/final-ui/report.json',worker=read(workerPath),workerComparison=compare(worker.identity.sourceHashes);
assert.equal(worker.status,'passed');
for(const p of ['wind-control-study.js','landing-challenge.js','landing-research-worker.js','bounded-height-controller.js','physics.js'])assert.ok(workerComparison.same.includes(p));
const layoutPath='qa/research-native-3.17/layout-verified/report.json',layout=read(layoutPath);
assert.equal(layout.status,'passed');assert.equal(layout.identity.modelBuildId,MODEL_BUILD_ID);assert.deepEqual(layout.identity.sourceHashes,MODEL_SOURCE_HASHES);
for(const [p,v] of Object.entries(layout.responseHashes))assert.equal(v.sha256,sha(bytes('dist/'+p)));
const cityPath='qa/city-native-3.17/final-after-batch/crosstown-wet-night.json',city=read(cityPath);
const cityResponses=Object.entries(city.sourceResponses),cityMismatches=cityResponses.filter(([p,v])=>v.status===200&&sha(bytes('dist'+p))!==v.sha256).map(([p])=>p);
assert.deepEqual(cityMismatches,[]);assert.equal(city.sourceResponses['/model-build.js'].sha256,sha(bytes('dist/model-build.js')));
assert.equal(city.sourceResponses['/urban-architecture.js'].sha256,MODEL_SOURCE_HASHES['urban-architecture.js']);
const vehiclePath='qa/vehicle-form-3.17/candidate/capture.json',vehicle=read(vehiclePath);
const vehicleMatches=Object.entries(vehicle.sourceHashes).filter(([p,h])=>p!=='model-build.js'&&sha(bytes('dist/'+p))===h).map(([p])=>p);
assert.equal(vehicleMatches.length,7);
const performance=['baseline','candidate'].map(label=>{
 const path='qa/city-native-3.17/performance-'+label+'/summary.json',r=read(path);
 return{...receipt(path),label,status:r.status,device:r.device,scope:'Fixed camera and active solver with no throttle; not a driven route. Candidate performance predates final equivalent batching. Baseline overlapped CPU regression, candidate did not; no causal speed comparison.',phases:r.phases.map(p=>({quality:p.quality,complete:p.complete,handlerMs:p.synchronousHandlerMs,firstRafMs:p.firstObservedRafAfterSwitchMs,samples:p.steady?.samples??null,frameMedianMs:p.steady?.frameMedianMs??null,p95Ms:p.steady?.frameP95Ms??null,maxMs:p.steady?.rafFrameTime?.maxMs??null,gpuSamples:p.steady?.gpuExecution?.samples??null}))};
});
const report={schema:'roadster-native-acceptance-3.17',createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'partial-native-acceptance-with-open-gates',
 summary:'Final-build wet-night city and imported wind-analysis layout rendered; genuine earlier continuous keyboard and Worker workflows retain their exact source scope. Software-renderer long frames, manual ground pitch failure and severe step non-convergence remain failures. No user-GPU acceptance is claimed.',
 scope:'Actual Chrome 156 / WebGL2 / ANGLE SwiftShader pixels, native keyboard sequences, module Workers, local persistence and one bounded task-library download. Source-equivalent earlier observations are explicitly separate from final whole-build observations.',
 sourceIdentity:{sourceCount:Object.keys(MODEL_SOURCE_HASHES).length,moduleSHA256:sha(bytes('dist/model-build.js')),allFinalSourceHashesVerified:true},
 evidence:{
  finalCity:{...receipt(cityPath),frame:'qa/city-native-3.17/final-after-batch/crosstown-wet-night.png',modelBuildId:MODEL_BUILD_ID,matchingHttpResponses:cityResponses.length,scope:'One actual high-quality Crosstown wet-night frame after batching and rebake. Not a repeated sustained performance or complete route test.'},
  finalResearchLayout:{...receipt(layoutPath),frame:'qa/research-native-3.17/layout-verified/wind-analysis.png',modelBuildId:layout.identity.modelBuildId,archivePreserved:layout.archivePreserved,headingVisible:layout.layout.headingVisible,seedVisible:layout.layout.seedVisible,errors:layout.errors,scope:layout.scope},
  actualKeyboard:{...receipt(inputPath),modelBuildId:inputId,status:input.status,cases:input.cases.map(c=>({kind:c.kind,status:c.status,frame:c.frame})),unchangedSourceCount:inputComparison.same.length,changedSources:inputComparison.changed,scope:'Real W down before additional U or E+1 on the laboratory flat ground, with actual fixed-step input/quaternion journal. The native manual case has G enabled; both G states are covered separately by numerical tests. Durations are simulation time, not wall-clock performance. Relevant physics and input source bytes equal final; this is not a full city-route maneuver test, rerun of the final entire build, or physical user-keyboard test.'},
  vehicleForm:{...receipt(vehiclePath),sourceEquivalentFiles:vehicleMatches,scope:'Five matched workshop A/B views retain their original draft build labels. Render-relevant source hashes match final. Lab before/after pause heights differ by 26.934 mm and are qualitative only.'},
  actualWindWorker:{...receipt(workerPath),modelBuildId:worker.identity.modelBuildId,status:worker.status,steps:worker.steps.map(s=>({name:s.name,status:s.status})),changedSources:workerComparison.changed,scope:'Actual baseline and seeded A/B module Workers and persistence. Final differences are equivalent city batching and the idle-status layout wiring; core solver, wind study and Worker bytes match.'},
  earlierFullResearchWorkflow:{...receipt(fullPath),modelBuildId:full.identity.modelBuildId,status:full.status,steps:full.steps.map(s=>({name:s.name,status:s.status,wallMs:s.wallMs})),scope:'Genuine earlier full workflow, including one download, reload, live B and retained cancellation. A full source manifest for this draft was not retained; later fixes are covered separately, not retroactively certified.'},
  sustainedPerformance:performance,
  completeScopes:'docs/evidence-scope-3.17.md'
 },
 openGates:[
  {id:'manual-ground-WE1',status:'failed',detail:'780 simultaneous W/E/1 request steps did not complete the low-altitude manual backflip; G remained limited.'},
  {id:'severe-step-trajectory',status:'failed',detail:'90 km/h 10 cm full/single-wheel trajectories do not converge across 480/960/1920 Hz; MN normal-force peaks retained.'},
  {id:'finite-U',status:'preflight-refused',detail:'Default finite 350 bar onboard supply is below the controlled-pitch impulse reserve; successful U/X evidence uses constant external supply.'},
  {id:'software-renderer-fluidity',status:'failed',detail:'Only 4–8 frames per 30-second window, second-scale frame times and double-digit-second quality switching. Small samples and different CPU loads preclude a stable percentile or speedup claim.'},
  {id:'user-GPU',status:'not-tested',detail:'No user hardware sustained route, exhaustive per-draw or quality-switch certification.'},
  {id:'final-batch-sustained-timing',status:'not-repeated',detail:'Original actual timing remains tied to pre-batch df685 build; final geometry equivalence and original budgets pass, and one final native frame is separate.'},
  {id:'export-tool-long-hang',status:'unresolved-not-reproduced',detail:'One actual task-library download completed. Earlier 1758/2561-second tool hangs have not been attributed to application encoding or browser handoff.'},
  {id:'full-AAA-art',status:'not-claimed',detail:'Visible shape/street/light improvements retain simplified shop glass, upper night floors, distant streets and parameterized vehicle form.'}
 ]};
writeFileSync(new URL('../qa/native-acceptance-3.17.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,modelBuildId:MODEL_BUILD_ID,sources:Object.keys(MODEL_SOURCE_HASHES).length,keyboardUnchanged:inputComparison.same.length,openGates:report.openGates.length}));
