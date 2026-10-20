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
    reason:'User-computer IAB screenshots of 3.8/3.9 were successfully retrieved, opened and used to diagnose this revision. No actual 3.11 after-pixels, human driving time series or GPU frame-time acceptance has yet been collected. The root cloud browser has no usable WebGL; that environment limit does not invalidate the user-computer evidence or prove a website rendering fault.',
    baselineEvidence:'qa/visual-evidence-3.10.json',captureInstructions:'docs/visual-3.11.md',bodyStripeSource:'qa/body-stripe-source-3.11.json',
    historicalReports:['qa/browser-release-3.9.json','qa/browser.json','qa/city-3.4-browser-assets.json'],
    historyScope:'3.9 real WebGL screenshots establish the observed defects only. Mixed resolutions/vehicle states, paused preview refresh and instantaneous HUD FPS are not strict visual or performance A/B. The real GPU was not identified.'};
  report.offlineShaderValidation={scope:'Offline syntax and stage-interface checks, not WebGL driver, framebuffer, rendered-pixel or FPS validation.',
    postProcessing:shaderEvidence('qa/render-shader-validation-3.11.json'),
    cityLighting:shaderEvidence('qa/city-shaders-3.11.json')};
  function domEvidence(file){
    if(!existsSync(new URL(file,root)))return{report:file,status:'not_performed',checks:[]};
    const evidence=read(file),hashes=Object.entries(evidence.sourceHashes||{});
    const current=hashes.length>0&&hashes.every(([name,expected])=>existsSync(new URL(name,root))&&createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex')===expected);
    const groups=Array.isArray(evidence.checks)?evidence.checks:evidence.tests||evidence.evidence||[],passed=evidence.status==='passed'||evidence.pass===true||groups.length>0&&groups.every(group=>group.status==='PASS');
    return{report:file,sourceHashesCurrent:current,status:!current?'outdated_source':passed?'passed':'failed',scope:evidence.scope||evidence.limits,checks:groups.map(group=>typeof group==='string'?group:group.name)};
  }
  const mainPage=domEvidence('qa/same-page-ui-3.11.json'),advancedStudy=domEvidence('qa/research-panel-dom-3.11.json'),liveExperiments=domEvidence('qa/experiment-console-dom-3.11.json'),withoutWebGL=domEvidence('qa/no-webgl-research-3.11.json');
  const workflow=domEvidence('qa/research-workflow-3.11.json'),vehicleInspection=domEvidence('qa/vehicle-inspection-3.11-dom.json'),robustnessStudy=domEvidence('qa/research-robustness-3.11-dom.json');
  report.domInteractionQA={status:[mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy].every(e=>e.status==='passed')?'passed':'incomplete_or_stale',
    scope:'DOM events with actual application/controller code and explicit graphics/Worker facades. No actual browser layout, WebGL execution or FPS validation.',
    acceptanceGroups:[mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy].reduce((sum,e)=>sum+e.checks.length,0),mainPage,advancedStudy,liveExperiments,withoutWebGL,workflow,vehicleInspection,robustnessStudy};
  return report;
}
