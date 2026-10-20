import {REPORT_VERSION} from './qa-report-version.mjs';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
function run(path,args=[],nodeArgs=[],runtime=process.execPath){
  // Regular files preserve actual child output when a managed runner denies
  // pipe handles. An execution error or nonzero exit still fails the gate.
  const directory=mkdtempSync(join(tmpdir(),'roadster-validation-'));
  const stdoutPath=join(directory,'stdout.log'),stderrPath=join(directory,'stderr.log');
  let outFd,errFd;
  try{
    outFd=openSync(stdoutPath,'w');errFd=openSync(stderrPath,'w');
    const result=spawnSync(runtime,[...nodeArgs,path,...args],{cwd:root,stdio:['ignore',outFd,errFd]});
    const stdout=readFileSync(stdoutPath,'utf8'),stderr=readFileSync(stderrPath,'utf8');
    if(result.error||result.status!==0){process.stdout.write(stdout);process.stderr.write(stderr);throw new Error(path+' failed',{cause:result.error});}
    console.log('PASS '+path);return stdout;
  }finally{
    if(outFd!==undefined)closeSync(outFd);if(errFd!==undefined)closeSync(errFd);
    rmSync(directory,{recursive:true,force:true});
  }
}
run('scripts/repository-payloads.mjs',['restore']);
run('scripts/model-build.mjs');
// Load generated identities only after the builder has replaced model-build.js.
const {enrichValidationReport}=await import('./validation-metadata.mjs');
run('tests/physics.test.mjs',['--report']);
const brakes=run('tests/braking.test.mjs');
run('tests/vehicle-geometry.test.mjs');
const city=run('tests/city-seal.test.mjs');
const handling=run('tests/handling-controls.test.mjs');
const air=run('tests/air-stabilization.test.mjs');
const hold=run('tests/pose-hold.test.mjs');
const flight=run('tests/flight-controls-3.7.test.mjs');
const programs=run('tests/flight-programs.test.mjs');
const windlab=run('tests/wind-laboratory.test.mjs');
const physicalResearch=run('tests/physics-research-3.8.test.mjs');
const experimentRecords=run('tests/experiment-records.test.mjs');
const roadStudies=run('tests/research-road-3.8.test.mjs');
const timing=run('tests/performance-meter.test.mjs');
const controls39=run('tests/physics-controls-3.9.test.mjs');
const reproduction39=run('tests/reproduction-verdict-3.9.test.mjs');
const corridor39=run('tests/visual-corridor-3.9.test.mjs');
const cityLighting310=run('tests/city-lighting-3.10.test.mjs');
const vehicleSurface310=run('tests/vehicle-surface-3.10.test.mjs');
run('tests/inspection-capture-3.10.test.mjs');
const history310=run('tests/history-compatibility-3.10.test.mjs');
const controlCapture310=run('tests/control-capture-3.10.test.mjs');
const dynamics311=run('tests/vehicle-dynamics-3.11.test.mjs');
const response311=run('tests/ui-response-3.11.test.mjs');
const capture311=run('tests/capture-detail-3.11.test.mjs');
const robustness311=run('tests/research-robustness-3.11.test.mjs');
const history311=run('tests/history-compatibility-3.11.test.mjs');
const visual311=run('tests/visual-regressions-3.11.test.mjs');
const braking312=run('tests/braking-corner-3.12.test.mjs');
const chase312=run('tests/chase-camera-3.12.test.mjs');
const reflection312=run('tests/reflection-stability-3.12.test.mjs');
const recovery312=run('tests/research-recovery-grid-3.12.test.mjs');
const sampler313=run('tests/sampler-budget-3.13.test.mjs');
const renderPrograms313=run('tests/render-program-diagnostics-3.13.test.mjs');
const flip313=run('tests/x-flip-3.13.test.mjs');
const surfaces313=run('tests/visual-quality-3.13.test.mjs');
const history313=run('tests/history-compatibility-3.13.test.mjs');
const framebuffer314=run('tests/framebuffer-matrix-3.14.test.mjs');
const controls314=run('tests/physics-controls-3.14.test.mjs');
const camera314=run('tests/camera-clearance-3.14.test.mjs');
const contacts314=run('tests/contact-regressions-3.14.test.mjs');
const vehicle314=run('tests/vehicle-display-3.14.test.mjs');
const vehicleCapture314=run('tests/vehicle-study-capture-3.14.test.mjs');
const city314=run('tests/city-continuity-3.14.test.mjs');
const research314=run('tests/research-platform-3.14.test.mjs');
run('tests/clearance-cpu-3.14.mjs');
if(process.env.TRIM_ORACLE_PYTHON)run('tests/trim-independent-3.14.py',[],[],process.env.TRIM_ORACLE_PYTHON);

const visualStructure=run('qa/visual-upgrade-check.mjs');
const render=run('tests/render-performance.test.mjs');
const probeSun=run('tests/local-probe-sun.test.mjs');
const exterior=run('qa/exterior-materials-check.mjs');
const physicsCpu=run('tests/physics-cpu.test.mjs');
run('qa/render-budget-check.mjs');
const indirect=run('tests/indirect-lighting.test.mjs');
const research=run('tests/research-dynamics.test.mjs');
const study=run('tests/research-study.test.mjs');
run('qa/city-3.4-geometry-check.mjs');
const payloads311=run('tests/repository-payloads.test.mjs');
run('scripts/check-static.mjs',[],['--experimental-vm-modules']);
// Optional tools are explicitly supplied by the caller; validation never installs
// dependencies or substitutes these DOM/GLSL checks for actual WebGL acceptance.
let boundaries314=null;
if(process.env.JSDOM_MODULE_PATH){
  boundaries314=run('tests/research-boundaries-3.14.test.mjs',[process.env.JSDOM_MODULE_PATH]);
  run('qa/same-page-ui-check.mjs',[],['--experimental-vm-modules']);
  run('qa/same-page-ui-check.mjs',['--graphics-unavailable'],['--experimental-vm-modules']);
  for(const path of ['qa/research-panel-dom-check.mjs','qa/experiment-console-dom-check.mjs','qa/research-workflow-3.10-check.mjs','qa/research-robustness-3.11-dom-check.mjs','qa/research-recovery-grid-3.12-dom-check.mjs','qa/vehicle-inspection-3.10-dom-check.mjs','qa/research-safety-3.14-dom-check.mjs'])run(path,[process.env.JSDOM_MODULE_PATH]);
}
if(process.env.GLSLANG_VALIDATOR){
  run('scripts/validate-city-shaders.mjs',['--validatorPath',process.env.GLSLANG_VALIDATOR,'--compareBaseline']);
  run('scripts/validate-render-shaders.mjs',['--validatorPath',process.env.GLSLANG_VALIDATOR]);
}
const report=read('dist/validation.json'),vehicle=read(`qa/vehicle-geometry-${REPORT_VERSION}.json`);
const passChecks=text=>[...text.matchAll(/PASS: (.+)/g)].map(m=>m[1]);
report.regressions={flightControls:{status:'passed',checks:passChecks(flight)},flightPrograms:{status:'passed',checks:passChecks(programs)},windLaboratory:{status:'passed',checks:passChecks(windlab)},localReflectionSun:{status:'passed',checks:[...probeSun.matchAll(/PASS: (.+)/g)].map(m=>m[1])},exteriorMaterials:{status:'passed',checks:[...exterior.matchAll(/PASS: (.+)/g)].map(m=>m[1])},physicsCpu:{status:'passed',checks:[...physicsCpu.matchAll(/PASS: (.+)/g)].map(m=>m[1])},cityRenderBudget:{status:'passed',checks:read(`qa/render-budget-${REPORT_VERSION}.json`).checks},poseHold:{status:'passed',checks:[...hold.matchAll(/PASS: (.+)/g)].map(m=>m[1])},renderPerformance:{status:'passed',checks:[...render.matchAll(/PASS: (.+)/g)].map(m=>m[1])},researchStudy:{status:'passed',checks:[...study.matchAll(/PASS: (.+)/g)].map(m=>m[1])},researchDynamics:{status:'passed',checks:[...research.matchAll(/PASS: (.+)/g)].map(m=>m[1])},cityArchitecture:{status:'passed',checks:read(`qa/city-architecture-${REPORT_VERSION}.json`).checks},airStabilization:{status:'passed',checks:[...air.matchAll(/PASS: (.+)/g)].map(m=>m[1])},indirectLighting:{status:'passed',checks:[...indirect.matchAll(/PASS: (.+)/g)].map(m=>m[1])},handlingControlsAudioAndBroadphase:{status:'passed',checks:[...handling.matchAll(/PASS: (.+)/g)].map(m=>m[1])},braking:{status:'passed',checks:[...brakes.matchAll(/PASS: (.+)/g)].map(m=>m[1])},vehicleGeometry:{status:vehicle.status,checks:vehicle.tests,sweep:vehicle.sweep},cityAndSeal:{status:'passed',checks:[...city.matchAll(/PASS: (.+)/g)].map(m=>m[1])}};
Object.assign(report.regressions,{
  framebufferAndMatrix314:{status:'passed',checks:read('qa/framebuffer-matrix-3.14.json').checks.map(x=>typeof x==='string'?x:x.name),report:'qa/framebuffer-matrix-3.14.json',scope:'Actual Three target construction, GL-interface and archive/PNG fixtures. Target-GPU framebuffer and color draws remain required.'},
  trimAndFailure314:{status:'passed',checks:passChecks(controls314),report:'qa/physics-controls-deepening-3.14.json',independentOracle:'qa/trim-independent-3.14.json',scope:'Bounded static wrench and preserved solver-failure states. Static feasibility is not dynamic recovery.'},
  cameraAndClearance314:{status:'passed',checks:passChecks(camera314),report:'qa/camera-clearance-3.14.json',scope:'Actual OrbitControls and independent OBB/ray geometry. No native camera feel, visibility or recovery-height acceptance.'},
  contactFixtures314:{status:'passed',checks:['120 Hz contact fixtures complete with bounded energy and penetration diagnostics; adverse physical outcomes retained'],fixtureOutcomeStatus:read('qa/contact-regressions-3.14.json').status,report:'qa/contact-regressions-3.14.json',scope:'Actual 120 Hz solver contact and steering fixtures with retained upsets and precondition failures; not realistic-speed obstacle certification.'},
  vehicleDisplay314:{status:'passed',checks:read('qa/vehicle-display-3.14.json').checks.map(x=>typeof x==='string'?x:x.name),report:'qa/vehicle-display-3.14.json',scope:'Actual new geometry, material roles, display-only identity and independent nozzle-hole rays. Artistic result remains unaccepted.'},
  vehicleCapture314:{status:'passed',checks:read('qa/vehicle-study-capture-3.14.json').checks.map(x=>typeof x==='string'?x:x.name),report:'qa/vehicle-study-capture-3.14.json',scope:'Same-condition still/video transaction and failure fixtures; synthetic capture bytes, not native images.'},
  cityContinuity314:{status:'passed',checks:read('qa/city-continuity-3.14.json').checks.map(x=>x.name),report:'qa/city-continuity-3.14.json',scope:'Twelve-street and 113-route geometry preservation, independent SAT/rays, real instance transforms and low-detail primary masses. Native driving, pixels and performance remain pending.'},
  boundedResearchInterface314:{status:boundaries314?'passed':'not_performed',checks:boundaries314?passChecks(boundaries314):[],report:'qa/research-boundaries-3.14.json',scope:'Data-only AST/state contracts, actual Node Worker generation/cancellation, isolated DOM error paths; not native browser/GPU execution.'},
  researchPlatform314:{status:'passed',checks:passChecks(research314),report:'qa/research-platform-3.14.json',scope:'Isolated storage failure/quarantine transactions, bounded height AST, actual-solver same-task decisions and landing success/failure; no GPU play acceptance.'},

  samplerBudget313:{status:'passed',checks:passChecks(sampler313),report:`qa/sampler-budget-${REPORT_VERSION}.json`,scope:'Exact final source and offline active sampler reflection, never target-GPU acceptance.'},
  actualProgramCapture313:{status:'passed',checks:passChecks(renderPrograms313),report:`qa/render-program-diagnostics-${REPORT_VERSION}.json`,scope:'GL-interface contract tests, not a real GPU run.'},
  quickRoll313:{status:'passed',checks:passChecks(flip313),report:`qa/x-flip-${REPORT_VERSION}.json`,curves:`qa/x-flip-curves-${REPORT_VERSION}.json`,scope:'Frozen 3.9/3.12 and current actual-solver traces, finite/bench, real manual input and failure boundaries.'},
  opticalSurfacesAndQuay313:{status:'passed',checks:passChecks(surfaces313),report:`qa/visual-quality-${REPORT_VERSION}.json`,scope:'Actual geometry, material sorting and shared collision/bake identities; after-pixels still pending.'},
  historicalRecompute313:{status:'passed',checks:passChecks(history313),report:`qa/history-compatibility-3.12-to-${REPORT_VERSION}.json`},
  cornerBraking312:{status:'passed',checks:passChecks(braking312),report:`qa/braking-controls-${REPORT_VERSION}.json`,curves:`qa/braking-controls-curves-${REPORT_VERSION}.json`,scope:'Three matched actual-solver stages, per-wheel loads/slip/force demand and passive work. No human driving acceptance.'},
  chaseCamera312:{status:'passed',checks:passChecks(chase312),report:`qa/chase-camera-${REPORT_VERSION}.json`,scope:'Deterministic camera kinematics, not rendered driving feel or measured FPS.'},
  reflectionStability312:{status:'passed',checks:passChecks(reflection312),report:`qa/reflection-stability-${REPORT_VERSION}.json`,scope:'CPU pass submission, shader weighting and state restoration. Matched WebGL motion and GPU cost remain open.'},
  gRecoveryGrid312:{status:'passed',checks:passChecks(recovery312),report:`qa/research-recovery-grid-${REPORT_VERSION}.json`,scope:'Ordinary G levelling under actual wind/nozzle conditions at sixteen sampled initial attitudes/heights. No interpolated safety boundary.'},
  repositoryPayloads311:{status:'passed',checks:passChecks(payloads311),report:`qa/repository-payloads-${REPORT_VERSION}.json`,scope:'Byte-identical source/archive restoration, not physical or graphical acceptance.'},
  vehicleDynamics311:{status:'passed',checks:passChecks(dynamics311),report:`qa/vehicle-dynamics-${REPORT_VERSION}.json`,curves:`qa/vehicle-dynamics-curves-${REPORT_VERSION}.json`,scope:'120 Hz actual solver, matched baseline source, causal ablations, per-wheel and flight traces. Real keyboard/camera experience remains open.'},
  controlPreferences311:{status:'passed',checks:passChecks(response311),scope:'Persisted independent response limits and retained earlier preferences; actual DOM interactions are reported separately.'},
  detailedLiveCapture311:{status:'passed',checks:passChecks(capture311),scope:'Actual flat-world continuous-input capture, declared timings and recorded force channels; not rendered or human driving.'},
  controllerRobustness311:{status:'passed',checks:passChecks(robustness311),report:`qa/research-robustness-${REPORT_VERSION}.json`,scope:'Twenty paired seeded numerical experiments, bounded success and preserved failures; not a population reliability estimate.'},
  historicalRecompute311:{status:'passed',checks:passChecks(history311),report:`qa/history-compatibility-${REPORT_VERSION}.json`},
  visualMechanisms311:{status:'passed',checks:passChecks(visual311),report:`qa/visual-regressions-${REPORT_VERSION}.json`,scope:'Shadow-plane and light-transport oracles plus capture-state fixtures; matched rendered after-images remain pending.'},
  cityLighting310:{status:'passed',checks:passChecks(cityLighting310),report:`qa/city-lighting-${REPORT_VERSION}.json`,scope:'Light selection, transitions, baked-field sampling and shared authored collision identity; actual after-pixels and GPU timing pending'},
  vehicleSurface310:{status:'passed',checks:read(`qa/vehicle-surface-${REPORT_VERSION}.json`).checks.map(check=>check.name),report:`qa/vehicle-surface-${REPORT_VERSION}.json`,scope:'Frozen reference identity, surface normals, material state and physical motion envelope; not a rendered-image verdict'},
  inspectionCapture310:{status:'passed',checks:read(`qa/inspection-capture-${REPORT_VERSION}.json`).checks,report:`qa/inspection-capture-${REPORT_VERSION}.json`,scope:'Canvas and ZIP transaction fixture; no actual WebGL pixels'},
  history310:{status:'passed',checks:passChecks(history310),report:`qa/history-original-3.9-to-${REPORT_VERSION}.json`},
  controlCapture310:{status:'passed',checks:passChecks(controlCapture310),report:`qa/control-capture-${REPORT_VERSION}.json`,scope:'Continuous actual fixed-step solver inputs, including complete city collision world; not human driving or real browser performance'},
  boundedDriveAndFlightControls:{status:'passed',checks:passChecks(controls39),report:`qa/physics-controls-${REPORT_VERSION}.json`,scope:'Actual fixed-step physics, original 3.8 fixture comparison and authored city bend; no human driving or GPU acceptance'},
  reproductionConsistency:{status:'passed',checks:passChecks(reproduction39),report:`qa/reproduction-verdict-${REPORT_VERSION}.json`},
  corridorAndReflection:{status:'passed',checks:read(`qa/visual-corridor-${REPORT_VERSION}.json`).checks.map(check=>check.name),report:`qa/visual-corridor-${REPORT_VERSION}.json`,scope:'Canonical route geometry, exact projection and pass culling; not pixels or FPS'},
  physicalResearch:{status:'passed',checks:passChecks(physicalResearch),report:`qa/physics-research-${REPORT_VERSION}.json`},
  liveExperimentReplay:{status:'passed',checks:passChecks(experimentRecords),report:`qa/experiment-records-${REPORT_VERSION}.json`},
  publicRoadStudies:{status:'passed',checks:passChecks(roadStudies),report:`qa/research-road-${REPORT_VERSION}.json`},
  performanceBookkeeping:{status:'passed',checks:passChecks(timing),report:`qa/performance-meter-${REPORT_VERSION}.json`,scope:'Measurement bookkeeping with a GL query facade, not actual GPU or FPS'},
  visualStructure:{status:'passed',checks:read(`qa/visual-upgrade-${REPORT_VERSION}.json`).checks.map(check=>check.name),report:`qa/visual-upgrade-${REPORT_VERSION}.json`,scope:'Geometry, light/reflection state and budget tests; no pixel acceptance'},
});
report.totalAcceptanceChecks=report.physics.total+Object.values(report.regressions).reduce((sum,group)=>sum+group.checks.length,0);
writeFileSync(new URL('dist/validation.json',root),JSON.stringify(enrichValidationReport(report),null,2)+'\n');
console.log(report.totalAcceptanceChecks+' numerical / geometric acceptance checks passed; DOM, offline shaders, actual WebGL and real-vehicle validation are reported separately.');
