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
  const nativeFile=`qa/native-acceptance-${REPORT_VERSION}.json`;
  const native=existsSync(new URL(nativeFile,root))?read(nativeFile):null;
  const nativeCurrent=native?.modelBuildId===MODEL_BUILD_ID;
  report.browserVisualQA={status:nativeCurrent?native.status:'current_release_final_capture_pending',modelVersion:MODEL_VERSION,
    currentEvidence:native?{report:nativeFile,modelBuildId:native.modelBuildId,sourceIdentityCurrent:nativeCurrent,scope:native.scope,openGates:native.openGates}:null,
    reason:nativeCurrent?native.summary:'The user supplied actual 3.15 candidate images and native observations. Actual Chrome WebGL2/SwiftShader rendering is available in this development environment and intermediate 3.16 frames were inspected; final same-source captures are reported separately once completed. Software-rendered pixels do not establish performance or driver behavior on the user GPU.',
    captureInstructions:'docs/release-3.16.md',bodyStripeSource:'qa/body-stripe-source-3.11.json',
    historicalReports:['docs/candidate-capture-3.15.md','qa/visual-evidence-3.14.json','qa/visual-evidence-3.13.json','qa/browser-live-3.12.json','qa/browser-release-3.9.json','qa/browser.json','qa/city-3.4-browser-assets.json'],
    historyScope:'The user ran the 3.15 candidate on their own computer. Those observations do not certify the final 3.16 whole-city route, full manual airborne pitch turn, high-speed step handling or hardware-GPU matrix. Earlier Euler-angle samples are not cumulative turns. Paused and software-GPU HUD readings are not route frame-time acceptance.'};
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
