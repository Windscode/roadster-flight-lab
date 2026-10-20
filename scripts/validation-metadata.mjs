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
    reason:'User-supplied 3.12 high/balanced/high same-camera PNG pixels and console prove missing mineral facade/road drawing; the named mineral shader exceeds 16 fragment samplers. Original road program attribution was incomplete; exact frozen offline reflection reproduces its overflow and 3.13 adds named on-device diagnostics. Seven 3.11 isolation PNGs establish the receiver-plane stripe fix at one camera, distinct from broad environment highlights. No current 3.13 after-pixels or target-GPU timing has been collected. The cloud browser reports GL_VENDOR / GL_RENDERER Disabled, which is not a verdict on the user device.',
    baselineEvidence:'qa/visual-evidence-3.13.json',captureInstructions:'docs/visual-3.13.md',bodyStripeSource:'qa/body-stripe-source-3.11.json',
    historicalReports:['qa/browser-live-3.12.json','qa/browser-release-3.9.json','qa/browser.json','qa/city-3.4-browser-assets.json'],
    historyScope:'3.12 missing drawing and the scoped 3.11 receiver-plane correction have real pixel evidence. The 54/90 km/h records use physical dry mu=1.25 and different input protocols; they are not wet-road or single-factor A/B acceptance. Paused preview/HUD figures are not route frame-time data; the user GPU identity remains unverified.'};
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
  report.domInteractionQA={status:[mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy,recoveryGridStudy].every(e=>e.status==='passed')?'passed':'incomplete_or_stale',
    scope:'DOM events with actual application/controller code and explicit graphics/Worker facades. No actual browser layout, WebGL execution or FPS validation.',
    acceptanceGroups:[mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy,recoveryGridStudy].reduce((sum,e)=>sum+e.checks.length,0),mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy,recoveryGridStudy};
  return report;
}
