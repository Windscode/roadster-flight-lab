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
const pilot315=run('tests/pilot-input-recovery-3.15.test.mjs');
const contact315=run('tests/contact-steering-3.15.test.mjs');
const input315=run('tests/input-session-3.15.test.mjs');
const reserve315=run('tests/landing-reserve-3.15.test.mjs');
const nav315=run('tests/city-navigation-3.15.test.mjs');
const task315=run('tests/city-flight-3.15.test.mjs');
const entry315=run('tests/city-vehicle-entry-3.15.test.mjs');
const history315=run('tests/history-task-3.15.test.mjs');
const research315=run('tests/research-value-3.15.test.mjs');
const visual315=run('tests/visual-lifecycle-3.15.test.mjs');
const contact316=run('tests/contact-convergence-3.16.test.mjs');
const footprint316=run('tests/braking-footprint-3.16.test.mjs');
const action316=run('tests/input-action-evidence-3.16.test.mjs');
const accounting316=run('tests/pitch-force-accounting-3.16.test.mjs');
const stepping316=run('tests/contact-step-contract-3.16.test.mjs');
const finite316=run('tests/finite-recovery-3.16.test.mjs');
const vehicle316=run('tests/vehicle-finish-3.16.test.mjs');
const city316=run('tests/city-quality-3.16.test.mjs');
const glazing316=run('tests/city-glazing-budget-3.16.test.mjs');
const reflection316=run('tests/reflection-feedback-3.16.test.mjs');
if(process.env.TRIM_ORACLE_PYTHON)run('tests/trim-independent-3.14.py',[],[],process.env.TRIM_ORACLE_PYTHON);

const visualStructure=run('qa/visual-upgrade-check.mjs');
const render=run('tests/render-performance.test.mjs');
const probeSun=run('tests/local-probe-sun.test.mjs');
run('tests/city-geometry-scope-3.14.test.mjs');
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
let boundaries314=null,cityUI315=null,pilotSequences315=null,cityHandoff315=null,export316=null,workspace316=null;
if(process.env.JSDOM_MODULE_PATH){
  export316=run('tests/export-progress-3.16.test.mjs',[process.env.JSDOM_MODULE_PATH]);
  workspace316=run('tests/research-workspace-3.16.test.mjs',[process.env.JSDOM_MODULE_PATH]);
  pilotSequences315=run('tests/pilot-sequences-3.15.test.mjs',[process.env.JSDOM_MODULE_PATH]);
  cityHandoff315=run('tests/city-flight-handoff-3.15.test.mjs',[process.env.JSDOM_MODULE_PATH]);
  cityUI315=run('tests/city-flight-ui-3.15.test.mjs',[process.env.JSDOM_MODULE_PATH]);
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
const passChecks=text=>[...text.matchAll(/^PASS(?::)? (.+)$/gm)].map(m=>m[1]);
report.regressions={flightControls:{status:'passed',checks:passChecks(flight)},flightPrograms:{status:'passed',checks:passChecks(programs)},windLaboratory:{status:'passed',checks:passChecks(windlab)},localReflectionSun:{status:'passed',checks:[...probeSun.matchAll(/PASS: (.+)/g)].map(m=>m[1])},exteriorMaterials:{status:'passed',checks:[...exterior.matchAll(/PASS: (.+)/g)].map(m=>m[1])},physicsCpu:{status:'passed',checks:[...physicsCpu.matchAll(/PASS: (.+)/g)].map(m=>m[1])},cityRenderBudget:{status:'passed',checks:read(`qa/render-budget-${REPORT_VERSION}.json`).checks},poseHold:{status:'passed',checks:[...hold.matchAll(/PASS: (.+)/g)].map(m=>m[1])},renderPerformance:{status:'passed',checks:[...render.matchAll(/PASS: (.+)/g)].map(m=>m[1])},researchStudy:{status:'passed',checks:[...study.matchAll(/PASS: (.+)/g)].map(m=>m[1])},researchDynamics:{status:'passed',checks:[...research.matchAll(/PASS: (.+)/g)].map(m=>m[1])},cityArchitecture:{status:'passed',checks:read(`qa/city-architecture-${REPORT_VERSION}.json`).checks},airStabilization:{status:'passed',checks:[...air.matchAll(/PASS: (.+)/g)].map(m=>m[1])},indirectLighting:{status:'passed',checks:[...indirect.matchAll(/PASS: (.+)/g)].map(m=>m[1])},handlingControlsAudioAndBroadphase:{status:'passed',checks:[...handling.matchAll(/PASS: (.+)/g)].map(m=>m[1])},braking:{status:'passed',checks:[...brakes.matchAll(/PASS: (.+)/g)].map(m=>m[1])},vehicleGeometry:{status:vehicle.status,checks:vehicle.tests,sweep:vehicle.sweep},cityAndSeal:{status:'passed',checks:[...city.matchAll(/PASS: (.+)/g)].map(m=>m[1])}};
Object.assign(report.regressions,{
  contactConvergence316:{status:'passed',checks:passChecks(contact316),report:'qa/contact-convergence-3.16.json',scope:'Independent swept tyre support, convex SAT overlap and 60/120/240/480/960/1920 Hz matched actual-solver traces. Reduced overlap does not establish converged high-speed obstacle handling; adverse trajectories are retained.'},
  brakingFootprint316:{status:'passed',checks:passChecks(footprint316),report:'qa/braking-footprint-3.16.json',scope:'Frozen three-section contact-query counterexample, continuous crowned support geometry and retained original high-speed braking/yaw gates; this does not establish calibrated real tyre compliance.'},
  pitchForceAccounting316:{status:'passed',checks:passChecks(accounting316),report:'qa/pitch-force-accounting-3.16.json',scope:'Every actual integration slice independently accounts for vertical gravity, nozzle, aerodynamic and damping contributions; original and feasible-request projection share initial state, bounds and timing, and the gas penalty is retained.'},
  contactStepContract316:{status:'passed',checks:passChecks(stepping316),report:'qa/contact-step-contract-3.16.json',scope:'Actual contact refinement retains outer controller/observer clocks, explicit short-contact diagnostics, integrated gas accounting and exact record replay; no hardware timing claim.'},
  inputActionEvidence316:{status:'passed',checks:passChecks(action316),report:'qa/input-action-evidence-3.16.json',scope:'Actual solver and received-event journal: action receipts, full quaternion travel and bounded recovery. Native browser observations are separately reported; accumulated body-axis travel alone is not a clean flip certificate.'},
  finiteRecovery316:{status:'passed',checks:passChecks(finite316),report:'qa/finite-recovery-3.16.json',scope:'Same onboard gas, earlier original-task abort and existing landing controller; recovery outcome is separate from original task completion. External supply remains zero in finite cases.'},
  vehicleFinish316:{status:'passed',checks:passChecks(vehicle316),report:'qa/vehicle-finish-3.16.json',scope:'Existing geometry, display identity, curvature and material-role constraints with frozen 3.15 reference. Matched actual WebGL pictures are reported separately.'},
  cityQuality316:{status:'passed',checks:passChecks(city316),report:'qa/city-quality-3.16.json',scope:'Existing continuous street corridor, ground use, real lighting and independent collision checks. Native route driving and hardware-GPU performance are separate gates.'},
  cityGlazingBudget316:{status:'passed',checks:read('qa/city-glazing-budget-3.16.json').checks.map(c=>c.name),report:'qa/city-glazing-budget-3.16.json',scope:'Actual authored window instances retain their external front plane, UV, LOD, colour, emission, and reflection response while removing hidden geometry and redundant opaque-glass batches; original fifteen-view submission budgets remain unchanged. Native pixels and GPU timing are separately reported.'},
  reflectionFeedback316:{status:'passed',checks:passChecks(reflection316),report:'qa/reflection-feedback-3.16.json',scope:'Frozen 3.15 feedback-loop counterexample, detached active sampler during reflection writes, exact restoration and half-written cache invalidation. Actual WebGL draw errors and switch-matrix results are separately retained.'},
  exportProgress316:{status:export316?'passed':'not_performed',checks:export316?passChecks(export316):[],report:'qa/export-progress-3.16.json',scope:'Exact JSON and raw data, cooperative preparation, worker protocol, cancellation, visible failure and browser-handoff distinction; actual browser download timing is reported separately.'},
  researchWorkspace316:{status:workspace316?'passed':'not_performed',checks:workspace316?passChecks(workspace316):[],report:'qa/research-workspace-3.16.json',scope:'Existing library, same solver, operating and analysis workspaces, actual stored metrics, compatibility and saved/completed state. Native layout is separately captured.'},
  cityGeometryScope315:{status:'passed',checks:read(`qa/city-geometry-scope-${REPORT_VERSION}.json`).checks.map(c=>c.name),report:`qa/city-geometry-scope-${REPORT_VERSION}.json`,scope:'Exact approved vehicle-mouth paving split, rejected mutations and reconstructed unchanged historical hashes; no rendered-route acceptance.'},
  cityHandoff315:{status:cityHandoff315?'passed':'not_performed',checks:cityHandoff315?read(`qa/city-flight-handoff-${REPORT_VERSION}.json`).checks.map(c=>c.name):[],report:`qa/city-flight-handoff-${REPORT_VERSION}.json`,scope:'Actual application-shell/research/city ownership handoff under DOM events; refused starts leave full physical/control state unchanged. Native key/focus timing remains open.'},
  pilotSequences315:{status:pilotSequences315?'passed':'not_performed',checks:pilotSequences315?read(`qa/pilot-sequences-${REPORT_VERSION}.json`).checks.map(c=>c.name):[],report:`qa/pilot-sequences-${REPORT_VERSION}.json`,scope:'18 paired received-DOM-event sequences through InputSession, driverAxes and actual 120 Hz solver. Not hardware keyboard or native main-page/GPU acceptance.'},
  pilotInput315:{status:'passed',checks:read(`qa/pilot-input-recovery-${REPORT_VERSION}.json`).checks.map(c=>c.name),report:`qa/pilot-input-recovery-${REPORT_VERSION}.json`,scope:'Recorded DOM-shaped events, pressed sets and matched actual 120 Hz physics; native keyboard hardware and rendered flight remain unaccepted.'},
  contactSteering315:{status:'passed',checks:read(`qa/contact-steering-${REPORT_VERSION}.json`).checks.map(c=>c.name),report:`qa/contact-steering-${REPORT_VERSION}.json`,scope:'Collision-wheel steering synchronization, production regeneration and retained physical upsets; not arbitrary obstacle recovery.'},
  inputSession315:{status:'passed',checks:passChecks(input315),report:`qa/input-session-${REPORT_VERSION}.json`,scope:'Input lifecycle and bounded trace contracts; actual focus/context-loss behavior remains a native-browser gate.'},
  landingReserve315:{status:'passed',checks:passChecks(reserve315),report:`qa/landing-reserve-${REPORT_VERSION}.json`,scope:'Read-only vertical near-level gas forecast using current trim, pressure and thermal model; not six-axis recovery or real-car safety.'},
  cityNavigation315:{status:'passed',checks:read(`qa/city-navigation-${REPORT_VERSION}.json`).assertions,report:`qa/city-navigation-${REPORT_VERSION}.json`,scope:'Layer-aware authored-road paths, entrances and rejoin geometry; selected destinations only, no native route certificate.'},
  cityFlightUI315:{status:cityUI315?'passed':'not_performed',checks:cityUI315?Object.keys(read(`qa/city-flight-ui-${REPORT_VERSION}.json`).assertions):[],report:`qa/city-flight-ui-${REPORT_VERSION}.json`,scope:'Isolated DOM/storage plus actual solver; no native play, GPU or frame-time acceptance.'},
  cityFlight315:{status:'passed',checks:read(`qa/city-flight-${REPORT_VERSION}.json`).checks??read(`qa/city-flight-${REPORT_VERSION}.json`).assertions??['Actual solver complete route, failures, recorded input replay, cancellation and protected storage'],report:`qa/city-flight-${REPORT_VERSION}.json`,scope:'One actual-solver drive/takeoff/swept-gate/platform task with retained failures and complete input replay; no native play or finite success claim.'},
  cityVehicleEntry315:{status:'passed',checks:['Default-regeneration matched entry passage meets the original 2 cm continuity criterion; original 12 cm failure retained'],report:`qa/city-entry-${REPORT_VERSION}-comparison.json`,scope:'Same low-speed initial state and controls, only the evidenced shared paving opening changes; not a full-city driving acceptance.'},
  historicalTask315:{status:'passed',checks:passChecks(history315),report:`qa/history-task-${REPORT_VERSION}.json`,scope:'Original 3.14 complete task records/algorithms remain readable/exportable; unavailable old solver is explicitly rejected before reexecution.'},
  heightResearch315:{status:'passed',checks:passChecks(research315),report:`qa/research-value-${REPORT_VERSION}.json`,scope:'Frozen conditions, bounded scan, non-dominated tradeoffs, independent validation wind and non-refilling task exit; actual solver evidence.'},
  visualLifecycle315:{status:'passed',checks:passChecks(visual315),report:`qa/visual-lifecycle-${REPORT_VERSION}.json`,scope:'Actual Three object lifecycle, lighting mode and regeneration brake signals; no rendered pixels, GPU memory or FPS acceptance.'},
  framebufferAndMatrix314:{status:'passed',checks:read(`qa/framebuffer-matrix-${REPORT_VERSION}.json`).checks.map(x=>typeof x==='string'?x:x.name),report:`qa/framebuffer-matrix-${REPORT_VERSION}.json`,scope:'Actual Three target construction, GL-interface and archive/PNG fixtures. Target-GPU framebuffer and color draws remain required.'},
  trimAndFailure314:{status:'passed',checks:passChecks(controls314),report:`qa/physics-controls-deepening-${REPORT_VERSION}.json`,independentOracle:`qa/trim-independent-${REPORT_VERSION}.json`,scope:'Bounded static wrench and preserved solver-failure states. Static feasibility is not dynamic recovery.'},
  cameraAndClearance314:{status:'passed',checks:passChecks(camera314),report:`qa/camera-clearance-${REPORT_VERSION}.json`,scope:'Actual OrbitControls and independent OBB/ray geometry. No native camera feel, visibility or recovery-height acceptance.'},
  contactFixtures314:{status:'passed',checks:['120 Hz contact fixtures complete with bounded energy and penetration diagnostics; adverse physical outcomes retained'],fixtureOutcomeStatus:read(`qa/contact-regressions-${REPORT_VERSION}.json`).status,report:`qa/contact-regressions-${REPORT_VERSION}.json`,scope:'Actual 120 Hz solver contact and steering fixtures with retained upsets and precondition failures; not realistic-speed obstacle certification.'},
  vehicleDisplay314:{status:'passed',checks:read(`qa/vehicle-display-${REPORT_VERSION}.json`).checks.map(x=>typeof x==='string'?x:x.name),report:`qa/vehicle-display-${REPORT_VERSION}.json`,scope:'Actual new geometry, material roles, display-only identity and independent nozzle-hole rays. Artistic result remains unaccepted.'},
  vehicleCapture314:{status:'passed',checks:read(`qa/vehicle-study-capture-${REPORT_VERSION}.json`).checks.map(x=>typeof x==='string'?x:x.name),report:`qa/vehicle-study-capture-${REPORT_VERSION}.json`,scope:'Same-condition still/video transaction and failure fixtures; synthetic capture bytes, not native images.'},
  cityContinuity314:{status:'passed',checks:read(`qa/city-continuity-${REPORT_VERSION}.json`).checks.map(x=>x.name),report:`qa/city-continuity-${REPORT_VERSION}.json`,scope:'Twelve-street and 113-route geometry preservation, independent SAT/rays, real instance transforms and low-detail primary masses. Native driving, pixels and performance remain pending.'},
  boundedResearchInterface314:{status:boundaries314?'passed':'not_performed',checks:boundaries314?passChecks(boundaries314):[],report:`qa/research-boundaries-${REPORT_VERSION}.json`,scope:'Data-only AST/state contracts, actual Node Worker generation/cancellation, isolated DOM error paths; not native browser/GPU execution.'},
  researchPlatform314:{status:'passed',checks:passChecks(research314),report:`qa/research-platform-${REPORT_VERSION}.json`,scope:'Isolated storage failure/quarantine transactions, bounded height AST, actual-solver same-task decisions and landing success/failure; no GPU play acceptance.'},

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
console.log(report.totalAcceptanceChecks+' declared regression assertions passed across numerical, geometry, interface and optional DOM checks; these counts are not independent experiments. Offline shaders, actual WebGL and real-vehicle validation are reported separately.');
