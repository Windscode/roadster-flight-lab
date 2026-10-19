import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
function run(path,args=[]){const result=spawnSync(process.execPath,[path,...args],{cwd:root,encoding:'utf8'});if(result.status!==0){process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');throw new Error(path+' failed');}console.log('PASS '+path);return result.stdout;}
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
run('scripts/check-static.mjs');
const report=read('dist/validation.json'),vehicle=read('qa/vehicle-geometry.json');
const passChecks=text=>[...text.matchAll(/PASS: (.+)/g)].map(m=>m[1]);
report.regressions={flightControls:{status:'passed',checks:passChecks(flight)},flightPrograms:{status:'passed',checks:passChecks(programs)},windLaboratory:{status:'passed',checks:passChecks(windlab)},localReflectionSun:{status:'passed',checks:[...probeSun.matchAll(/PASS: (.+)/g)].map(m=>m[1])},exteriorMaterials:{status:'passed',checks:[...exterior.matchAll(/PASS: (.+)/g)].map(m=>m[1])},physicsCpu:{status:'passed',checks:[...physicsCpu.matchAll(/PASS: (.+)/g)].map(m=>m[1])},cityRenderBudget:{status:'passed',checks:read('qa/render-budget-3.8.json').checks},poseHold:{status:'passed',checks:[...hold.matchAll(/PASS: (.+)/g)].map(m=>m[1])},renderPerformance:{status:'passed',checks:[...render.matchAll(/PASS: (.+)/g)].map(m=>m[1])},researchStudy:{status:'passed',checks:[...study.matchAll(/PASS: (.+)/g)].map(m=>m[1])},researchDynamics:{status:'passed',checks:[...research.matchAll(/PASS: (.+)/g)].map(m=>m[1])},cityArchitecture:{status:'passed',checks:read('qa/city-architecture-3.8.json').checks},airStabilization:{status:'passed',checks:[...air.matchAll(/PASS: (.+)/g)].map(m=>m[1])},indirectLighting:{status:'passed',checks:[...indirect.matchAll(/PASS: (.+)/g)].map(m=>m[1])},handlingControlsAudioAndBroadphase:{status:'passed',checks:[...handling.matchAll(/PASS: (.+)/g)].map(m=>m[1])},braking:{status:'passed',checks:[...brakes.matchAll(/PASS: (.+)/g)].map(m=>m[1])},vehicleGeometry:{status:vehicle.status,checks:vehicle.tests,sweep:vehicle.sweep},cityAndSeal:{status:'passed',checks:[...city.matchAll(/PASS: (.+)/g)].map(m=>m[1])}};
Object.assign(report.regressions,{
  physicalResearch:{status:'passed',checks:passChecks(physicalResearch),report:'qa/physics-research-3.8.json'},
  liveExperimentReplay:{status:'passed',checks:passChecks(experimentRecords),report:'qa/experiment-records-3.8.json'},
  publicRoadStudies:{status:'passed',checks:passChecks(roadStudies),report:'qa/research-road-3.8.json'},
  performanceBookkeeping:{status:'passed',checks:passChecks(timing),report:'qa/performance-meter-3.8.json',scope:'Measurement bookkeeping with a GL query facade, not actual GPU or FPS'},
  visualStructure:{status:'passed',checks:passChecks(visualStructure),report:'qa/visual-upgrade-3.8.json',scope:'Geometry, light/reflection state and budget tests; no pixel acceptance'},
});
report.totalAcceptanceChecks=report.physics.total+Object.values(report.regressions).reduce((sum,group)=>sum+group.checks.length,0);
writeFileSync(new URL('dist/validation.json',root),JSON.stringify(enrichValidationReport(report),null,2)+'\n');
console.log(report.totalAcceptanceChecks+' numerical / geometric acceptance checks passed; browser and real-vehicle validation are reported separately.');
