import {REPORT_VERSION} from './qa-report-version.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';

const root=new URL('../',import.meta.url);
const read=file=>JSON.parse(readFileSync(new URL(file,root),'utf8'));
function shaderEvidence(file){
  if(!existsSync(new URL(file,root)))return{report:file,status:'not_performed'};
  const evidence=read(file),hashes=Object.entries(evidence.sourceHashes||{});
  const current=hashes.length>0&&hashes.every(([name,expected])=>{
    const path=new URL(name,root);return existsSync(path)&&createHash('sha256').update(readFileSync(path)).digest('hex')===expected;
  });
  return{report:file,createdAt:evidence.createdAt,sourceHashesCurrent:current,
    status:!current?'outdated_source':evidence.summary?.failed?'failed':'passed_with_documented_compiler_normalization',
    ...evidence.summary,limitations:evidence.limitations};
}

// Validation history must never silently become evidence for a newer release.
// This only annotates already-executed results; it does not run or count tests.
export function enrichValidationReport(report){
  for(const [name,expected] of Object.entries(MODEL_SOURCE_HASHES)){
    const actual=createHash('sha256').update(readFileSync(new URL('dist/'+name,root))).digest('hex');
    if(actual!==expected)throw Error('Validation source identity is stale: '+name);
  }
  report.model='Roadster Flight Lab '+MODEL_VERSION;
  report.sourceIdentity={modelBuildId:MODEL_BUILD_ID,sourceHashes:MODEL_SOURCE_HASHES};
  report.browserVisualQA={status:'current_release_after_capture_pending',modelVersion:MODEL_VERSION,
    reason:'User-supplied 3.13 high / balanced / high 1280x720 wet-night exposure-1.02 pixels show recovered observed roads and facades. The named road/mineral programs used 13/12 active fragment sampler elements and linked, validated and drew without listed errors in that condition; requiredCategories was empty, so this is not all-scene acceptance. Ultra08 had 25 GL1286 draw errors despite 14/13 samplers and successful link/validate, and the 14-frame matrix did not complete. The 3.14 cube-target construction and frame-bound diagnostics have CPU/GL-interface/DOM checks, but no target-GPU after-pixels or warmed route timings. The 2026-10-20 browser attempt on the deployed baseline returned Error creating WebGL context; it is a separate environment and no current-release image was acquired.',
    baselineEvidence:'qa/visual-evidence-3.14.json',captureInstructions:'docs/release-3.15.md',bodyStripeSource:'qa/body-stripe-source-3.11.json',
    historicalReports:['qa/visual-evidence-3.13.json','qa/browser-live-3.12.json','qa/browser-release-3.9.json','qa/browser.json','qa/city-3.4-browser-assets.json'],
    historyScope:'The user\'s 3.13 full specified continuous route is traversable, not a current-release drive or all-street/collision/performance certificate. The actual X bench trace CG 0.597009→3.904830 m and roll peak 365.510947 degrees is preserved, not exact landing or finite-gas acceptance. The scoped 3.11 receiver-plane correction is retained. Previous 54/90 km/h records used physical dry mu=1.25, not wet-road or matched A/B. Paused/HUD figures are not route frame-time data.'};
  report.offlineShaderValidation={scope:'Offline final source syntax, stage-interface and active sampler array reflection; not WebGL driver, framebuffer, rendered-pixel or FPS validation.',
    postProcessing:shaderEvidence(`qa/render-shader-validation-${REPORT_VERSION}.json`),
    cityLighting:shaderEvidence(`qa/city-shaders-${REPORT_VERSION}.json`)};
  function domEvidence(file){
    if(!existsSync(new URL(file,root)))return{report:file,status:'not_performed',checks:[]};
    const evidence=read(file),hashes=Object.entries(evidence.sourceHashes||{});
    const current=hashes.length>0&&hashes.every(([name,expected])=>existsSync(new URL(name,root))&&createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex')===expected);
    const groups=Array.isArray(evidence.checks)?evidence.checks:evidence.tests||evidence.evidence||[],passed=evidence.status==='passed'||evidence.pass===true||groups.length>0&&groups.every(group=>group.status==='PASS');
    return{report:file,sourceHashesCurrent:current,status:!current?'outdated_source':passed?'passed':'failed',scope:evidence.scope||evidence.limits,checks:groups.map(group=>typeof group==='string'?group:group.name)};
  }
  const mainPage=domEvidence(`qa/same-page-ui-${REPORT_VERSION}.json`),advancedStudy=domEvidence(`qa/research-panel-dom-${REPORT_VERSION}.json`),liveExperiments=domEvidence(`qa/experiment-console-dom-${REPORT_VERSION}.json`),withoutWebGL=domEvidence(`qa/no-webgl-research-${REPORT_VERSION}.json`);
  const workflow=domEvidence(`qa/research-workflow-${REPORT_VERSION}.json`),vehicleInspection=domEvidence(`qa/vehicle-inspection-${REPORT_VERSION}-dom.json`),robustnessStudy=domEvidence(`qa/research-robustness-${REPORT_VERSION}-dom.json`);
  const recoveryGridStudy=domEvidence(`qa/research-recovery-grid-${REPORT_VERSION}-dom.json`);
  const researchSafety=domEvidence(`qa/research-safety-${REPORT_VERSION}-dom.json`);
  report.domInteractionQA={status:[mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy,recoveryGridStudy,researchSafety].every(e=>e.status==='passed')?'passed':'incomplete_or_stale',
    scope:'DOM events with actual application/controller code and explicit graphics/Worker facades. No actual browser layout, WebGL execution or FPS validation.',
    acceptanceGroups:[mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy,recoveryGridStudy,researchSafety].reduce((sum,e)=>sum+e.checks.length,0),mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy,recoveryGridStudy,researchSafety};
  return report;
}
