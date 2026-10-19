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
  report.browserVisualQA={status:'not_performed',modelVersion:MODEL_VERSION,
    reason:'No browser, GPU frame-time or visual acceptance was performed for this release. Numerical, geometric, static integration and offline shader checks have separate scopes.',
    historicalReports:['qa/browser.json','qa/city-3.4-browser-assets.json'],
    historyScope:'Older-version reports are preserved as history and do not validate this release.'};
  report.offlineShaderValidation={scope:'Offline syntax and stage-interface checks, not WebGL driver, framebuffer, rendered-pixel or FPS validation.',
    postProcessing:shaderEvidence('qa/render-shader-validation-3.8.json'),
    cityLighting:shaderEvidence('qa/render-shaders-3.8.json')};
  function domEvidence(file){
    if(!existsSync(new URL(file,root)))return{report:file,status:'not_performed',checks:[]};
    const evidence=read(file),hashes=Object.entries(evidence.sourceHashes||{});
    const current=hashes.length>0&&hashes.every(([name,expected])=>existsSync(new URL(name,root))&&createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex')===expected);
    const groups=Array.isArray(evidence.checks)?evidence.checks:evidence.tests||[],passed=evidence.status==='passed'||evidence.pass===true||groups.length>0&&groups.every(group=>group.status==='PASS');
    return{report:file,sourceHashesCurrent:current,status:!current?'outdated_source':passed?'passed':'failed',scope:evidence.scope||evidence.limits,checks:groups.map(group=>typeof group==='string'?group:group.name)};
  }
  const mainPage=domEvidence('qa/same-page-ui-3.8.json'),advancedStudy=domEvidence('qa/research-panel-dom-3.8.json'),liveExperiments=domEvidence('qa/experiment-console-dom-3.8.json'),withoutWebGL=domEvidence('qa/no-webgl-research-3.8.json');
  report.domInteractionQA={status:[mainPage,advancedStudy,liveExperiments,withoutWebGL].every(e=>e.status==='passed')?'passed':'incomplete_or_stale',
    scope:'DOM events with actual application/controller code and explicit graphics/Worker facades. No actual browser layout, WebGL execution or FPS validation.',
    acceptanceGroups:[mainPage,advancedStudy,liveExperiments,withoutWebGL].reduce((sum,e)=>sum+e.checks.length,0),mainPage,advancedStudy,liveExperiments,withoutWebGL};
  return report;
}
