// Prepare the explicit public subset. Complete development evidence remains
// independently archived; the original manifest and reports are not rewritten.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync,mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {assertRuntimeSourceBrowseCopies} from './pages-evidence.mjs';
import {readPublicationContract,preparePublicationPayloads,verifyPublicationFiles,assertPublicationRuntimeInventory,assertCommittedPublicationFiles,assertPublicationEvidenceCoverage,copyPublicationFile,renderAvailabilityPage,fileIdentity,SITE_BASE_URL} from './publication-contract.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(root,'.pages-site');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function gitText(args){
  const directory=mkdtempSync(resolve(tmpdir(),'roadster-pages-git-'));
  const stdoutPath=resolve(directory,'stdout.log'),stderrPath=resolve(directory,'stderr.log');
  let outFd,errFd;
  try{
    outFd=openSync(stdoutPath,'w');errFd=openSync(stderrPath,'w');
    const result=spawnSync('git',args,{cwd:root,stdio:['ignore',outFd,errFd]});
    if(result.error||result.status!==0)throw new Error('git '+args.join(' ')+' failed: '+readFileSync(stderrPath,'utf8'),{cause:result.error});
    return readFileSync(stdoutPath,'utf8');
  }finally{
    if(outFd!==undefined)closeSync(outFd);if(errFd!==undefined)closeSync(errFd);
    rmSync(directory,{recursive:true,force:true});
  }
}
if(relative(root,output)!=='.pages-site')throw Error('Invalid publishing directory');
if(existsSync(output))throw Error('Publication needs a fresh .pages-site directory; existing files were preserved.');
const availability=readPublicationContract(root),{contract}=availability;
if(contract.source.modelVersion!==MODEL_VERSION||contract.source.modelBuildId!==MODEL_BUILD_ID)throw Error('Original development identity does not match this runtime build');
const payloads=preparePublicationPayloads(root,contract);
const onlineVerification=verifyPublicationFiles({root,contract});
const trackedPaths=gitText(['ls-files','-z']).split('\0').filter(Boolean);
const runtimeInventory=assertPublicationRuntimeInventory({contract,trackedPaths,packedEntries:payloads.manifest.files,modelSourceHashes:MODEL_SOURCE_HASHES});
const originalValidation=fileIdentity(resolve(root,'dist/validation.json'));
const validation=JSON.parse(readFileSync(resolve(root,'dist/validation.json'),'utf8'));
const evidenceCoverage=assertPublicationEvidenceCoverage(validation,contract);
const staticCheck=JSON.parse(readFileSync(resolve(root,'.runtime/publication-check.json'),'utf8'));
if(staticCheck.scope!=='public-subset-static-check'||staticCheck.integration?.status!=='passed'||staticCheck.modelBuildId!==MODEL_BUILD_ID||staticCheck.modelVersion!==MODEL_VERSION||staticCheck.publication?.contract?.sha256!==availability.sha256||staticCheck.originalValidation?.sha256!==originalValidation.sha256)throw Error('Run check-static for this exact public contract before preparing Pages');
const publicationCommit=gitText(['rev-parse','HEAD']).trim(),publicationTree=gitText(['rev-parse','HEAD^{tree}']).trim();
const headBlobs=new Map(gitText(['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean).map(row=>{const tab=row.indexOf('\t'),parts=row.slice(0,tab).split(' ');return[row.slice(tab+1),parts[2]];}));
const committedFiles=assertCommittedPublicationFiles({contract,headBlobs,packedEntries:payloads.manifest.files});
mkdirSync(output);
const runtime=[],evidence=[],generated=[];
for(const entry of contract.files){
  if(entry.classification==='archived-not-published')continue;
  const record=copyPublicationFile({root,output,entry});
  if(entry.classification==='runtime-required')runtime.push(record);
  else evidence.push({...record,category:'online-evidence',sources:['availability-contract']});
  if(entry.path.startsWith('dist/')&&/\.(?:[cm]?js|html|css|md)$/.test(entry.path)){
    const copy=copyPublicationFile({root,output,entry,sitePath:entry.path});
    evidence.push({...copy,classification:'online-evidence',onlineURL:new URL(entry.path,SITE_BASE_URL).href,category:'runtime-source-browse-copy',sources:['runtime-source-browse-copy'],runtimeSitePath:entry.path.slice(5),purpose:'Byte-identical source browsing copy; runtime imports use the separate site-root file.'});
  }
}
const sourceBrowseVerification=assertRuntimeSourceBrowseCopies({output,files:evidence});
for(const entry of ['index.html','app.js','app-shell.js','research.html','research-panel.html','vehicle-inspection.html','experiment-worker.js','experiment-replay-worker.js','landing-research-worker.js','export-worker.js','export-encoder.js','export-download.js','assets/music/manifest.json','assets/music/CREDITS.txt','assets/irradiance/manifest.json','assets/irradiance/city.bin','assets/night-irradiance/manifest.json','assets/night-irradiance/night-city.bin','assets/night-irradiance/night-route-balanced.bin','assets/night-irradiance/night-route.bin','assets/night-direct-irradiance/manifest.json','assets/night-direct-irradiance/night-direct-city.bin','assets/night-direct-irradiance/night-direct-route-balanced.bin','assets/night-direct-irradiance/night-direct-route.bin','night-city-lighting.js','city-frontage-design.js','driving-capture.js','inspection-capture.js','capture-archive.js','LICENSE','THIRD-PARTY-NOTICES.md'])if(!existsSync(resolve(output,entry)))throw Error('Missing public entry: '+entry);
function generate(path,bytes,purpose){
  if(!Buffer.isBuffer(bytes))bytes=Buffer.from(typeof bytes==='string'?bytes:JSON.stringify(bytes,null,2)+'\n');
  const target=resolve(output,path);if(existsSync(target))throw Error('Generated publication metadata collides with a declared copy: '+path);
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
  generated.push({path,sitePath:path,bytes:bytes.length,sha256:sha(bytes),purpose,publiclyAvailable:true,onlineURL:new URL(path,SITE_BASE_URL).href});
}
const sourceMapping={originalDevelopment:contract.source,publicationCommit,publicationTree,meaning:'The connector publication commit has its own identity and current author/date. Runtime source bytes match the declared original build; this is not an import of the original development commit SHA.'};
generate('availability.json',readFileSync(resolve(root,availability.path)),'Unchanged explicit three-class availability contract. Offline items have no online URL.');
generate('availability.html',renderAvailabilityPage(contract,{publicationCommit,publicationTree}),'Human-readable online files and offline archive status; no download links for unpublished data.');
generate('publication/source-mapping.json',sourceMapping,'Original development identity and actual publication identity.');
generate('publication/static-check.json',readFileSync(resolve(root,'.runtime/publication-check.json')),'New public-subset static checks; original validation report remains unchanged.');
generate('publication/payloads.json',payloads.selected,'Exact public selection of the unchanged complete payload manifest.');
generate('publication/validation-availability.json',evidenceCoverage,'Per-reference availability overlay for the unchanged validation report.');
const evidenceFiles=evidence.length,evidenceBytes=evidence.reduce((sum,entry)=>sum+entry.bytes,0),runtimeBytes=runtime.reduce((sum,entry)=>sum+entry.bytes,0);
const evidenceManifest={schema:'roadster.prepared-evidence',version:2,preparedAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,sourceCommit:publicationCommit,sourceTree:publicationTree,publicationCommit,publicationTree,originalDevelopment:contract.source,
  scope:'Only files actually copied to this website are counted as online evidence. Historical report outcomes are preserved. Archived-not-published files are separately identified and are not copied, downloadable, or included in fileCount/bytes. Preparation is not itself a successful deployment receipt.',
  availabilityContract:{path:'availability.json',sha256:availability.sha256},originalValidation,
  immutablePayloadManifest:{path:'repository-payloads/manifest.json',...fileIdentity(resolve(root,'repository-payloads/manifest.json')),entries:payloads.manifest.files.length,selectedEntries:payloads.selected.files.length,selectedRuntimeEntries:payloads.selected.files.filter(entry=>entry.path.startsWith('dist/')).length},
  validationCoverage:evidenceCoverage,sourceBrowseVerification,runtimeInventory,committedFiles,onlineVerification,
  fileCount:evidenceFiles,bytes:evidenceBytes,files:evidence,runtime:{fileCount:runtime.length,bytes:runtimeBytes,files:runtime},generatedFiles:generated,
  archivedNotPublished:contract.files.filter(entry=>entry.classification==='archived-not-published').map(entry=>({...entry,source:entry.source??contract.source}))};
const evidenceManifestBytes=Buffer.from(JSON.stringify(evidenceManifest,null,2)+'\n');writeFileSync(resolve(output,'evidence-manifest.json'),evidenceManifestBytes);
writeFileSync(resolve(output,'deployment.json'),JSON.stringify({application:'roadster-flight-lab',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,
  // Existing runtime readers use sourceCommit/sourceTree; both are actual HEAD.
  sourceCommit:publicationCommit,sourceTree:publicationTree,publicationCommit,publicationTree,originalDevelopment:contract.source,
  sourceRepository:'https://github.com/Windscode/roadster-flight-lab',runtimeFiles:runtime.length,runtimeBytes,evidenceFiles,evidenceBytes,archivedNotPublishedFiles:evidenceManifest.archivedNotPublished.length,
  availability:{path:'availability.json',page:'availability.html',sha256:availability.sha256},evidenceManifest:{path:'evidence-manifest.json',sha256:sha(evidenceManifestBytes)}},null,2)+'\n');
if(JSON.stringify(fileIdentity(resolve(root,'dist/validation.json')))!==JSON.stringify(originalValidation))throw Error('Original validation bytes changed during preparation');
console.log(JSON.stringify({status:'ready',directory:'.pages-site',runtimeFiles:runtime.length,runtimeBytes,evidenceFiles,evidenceBytes,archivedNotPublishedFiles:evidenceManifest.archivedNotPublished.length,modelBuildId:MODEL_BUILD_ID,publicationCommit,publicationTree}));
