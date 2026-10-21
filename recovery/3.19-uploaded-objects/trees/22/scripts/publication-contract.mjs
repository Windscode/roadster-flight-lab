// Public availability is separate from immutable development evidence.
// No absent path is accepted merely because it is large or historical.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,openSync,readSync,closeSync,mkdirSync,copyFileSync,constants} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {readPayloadManifest,restorePayloads,verifyPayloads} from './repository-payloads.mjs';

export const PUBLICATION_CONTRACT_FILE='publication/availability.json';
export const SOURCE_INHERITANCE='all files inherit source unless source is present';
export const SITE_BASE_URL='https://windscode.github.io/roadster-flight-lab/';
const SHA256=/^[0-9a-f]{64}$/,GIT_SHA=/^[0-9a-f]{40}$/;
const CLASSES=new Set(['runtime-required','online-evidence','archived-not-published']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export function safePublicationPath(root,name){
  root=resolve(root);
  if(typeof name!=='string'||!name||name.includes('\\')||name.split('/').some(part=>part==='.git'||part==='.env'))throw Error('Invalid publication path: '+name);
  const target=resolve(root,name),rel=relative(root,target);
  if(rel==='..'||rel.startsWith('..'+sep)||rel!==name.split('/').join(sep))throw Error('Publication path leaves its root: '+name);
  for(let current=target;current!==root;current=dirname(current))if(lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Symbolic link in publication path: '+name);
  return target;
}
export function fileIdentity(path){
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Publication source is not a regular file: '+path);
  const sha=createHash('sha256'),git=createHash('sha1').update(Buffer.from(`blob ${stat.size}\0`)),buffer=Buffer.allocUnsafe(1024*1024),fd=openSync(path,'r');
  let bytes=0;
  try{for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;bytes+=n;sha.update(buffer.subarray(0,n));git.update(buffer.subarray(0,n));}}
  finally{closeSync(fd);}
  if(bytes!==stat.size)throw Error('Publication file changed while hashing: '+path);
  return{bytes,sha256:sha.digest('hex'),gitBlob:git.digest('hex')};
}
export const publicSitePath=entry=>entry.path.startsWith('dist/')?entry.path.slice(5):entry.path;
function sourceIdentity(source,location){
  if(!source||!GIT_SHA.test(source.commit)||!GIT_SHA.test(source.tree)||typeof source.modelVersion!=='string'||!source.modelVersion||!SHA256.test(source.modelBuildId))throw Error('Missing original source identity: '+location);
  const bundle=source.bundle;
  if(!bundle||typeof bundle.path!=='string'||!bundle.path||!Number.isSafeInteger(bundle.bytes)||bundle.bytes<=0||!SHA256.test(bundle.sha256)||typeof bundle.saveStatus!=='string'||!bundle.saveStatus.trim())throw Error('Missing original bundle identity/save status: '+location);
}
export function validatePublicationContract(contract){
  if(contract?.schema!=='roadster.publication-availability'||contract.version!==1||!Array.isArray(contract.files))throw Error('Unsupported publication availability contract');
  if(contract.sourceInheritance!==SOURCE_INHERITANCE)throw Error('Publication source inheritance must be explicit');
  sourceIdentity(contract.source,'source');
  const base=contract.siteBaseURL??SITE_BASE_URL;
  if(base!==SITE_BASE_URL)throw Error('Unexpected public site base URL');
  const paths=new Map(),targets=new Map();
  for(const entry of contract.files){
    safePublicationPath('/publication-root',entry.path);
    if(paths.has(entry.path))throw Error('Duplicate publication path: '+entry.path);
    if(!CLASSES.has(entry.classification)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!SHA256.test(entry.sha256)||!GIT_SHA.test(entry.gitBlob))throw Error('Invalid classified publication identity: '+entry.path);
    if(entry.source)sourceIdentity(entry.source,entry.path);
    if(entry.repositoryRequired!==undefined&&typeof entry.repositoryRequired!=='boolean')throw Error('Invalid repository dependency flag: '+entry.path);
    if(entry.repositoryRequired&&(!Array.isArray(entry.consumers)||!entry.consumers.length||entry.consumers.some(path=>typeof path!=='string'||!path)))throw Error('Required repository input needs explicit consumers: '+entry.path);
    const offline=entry.classification==='archived-not-published';
    if(offline){
      if(entry.publiclyAvailable!==false||Object.hasOwn(entry,'onlineURL'))throw Error('Offline item must not claim public availability or an onlineURL: '+entry.path);
      if(!entry.archive||typeof entry.archive.path!=='string'||!entry.archive.path||typeof entry.archive.saveStatus!=='string'||!entry.archive.saveStatus.trim())throw Error('Offline item needs its archive path and real save status: '+entry.path);
      if(entry.path.startsWith('dist/'))throw Error('Runtime files may not be archived instead of published: '+entry.path);
    }else{
      const sitePath=publicSitePath(entry),expected=new URL(sitePath,base).href;
      if(entry.publiclyAvailable!==true||entry.onlineURL!==expected)throw Error('Online item needs its exact public URL: '+entry.path);
      if(entry.path.startsWith('dist/')&&entry.classification!=='runtime-required')throw Error('Runtime file classification is not runtime-required: '+entry.path);
      if(targets.has(sitePath))throw Error('Duplicate public target: '+sitePath);
      targets.set(sitePath,entry.path);
    }
    paths.set(entry.path,entry);
  }
  return paths;
}
export function readPublicationContract(root,file=PUBLICATION_CONTRACT_FILE){
  const bytes=readFileSync(safePublicationPath(root,file)),contract=JSON.parse(bytes);
  validatePublicationContract(contract);
  return{contract,path:file,bytes:bytes.length,sha256:hash(bytes)};
}
export function selectPublicationPayloads(contract,manifest,{purpose='online'}={}){
  if(!['online','runtime','test'].includes(purpose))throw Error('Unknown payload recovery purpose: '+purpose);
  const entries=validatePublicationContract(contract),selected=[];
  for(const payload of manifest.files){
    const entry=entries.get(payload.path);
    if(!entry)throw Error('Unclassified packed payload: '+payload.path);
    if(entry.bytes!==payload.bytes||entry.sha256!==payload.sha256||entry.gitBlob!==payload.gitBlobSha)throw Error('Payload differs from availability identity: '+payload.path);
    if(payload.path.startsWith('dist/')&&entry.classification!=='runtime-required')throw Error('Packed runtime is not required: '+payload.path);
    const required=purpose==='online'?entry.classification!=='archived-not-published':purpose==='runtime'?entry.classification==='runtime-required':entry.classification==='runtime-required'||entry.repositoryRequired===true;
    if(required)selected.push(payload);
  }
  return{schema:manifest.schema,version:manifest.version,scope:'Explicit '+purpose+' dependency subset of the preserved complete payload manifest. This does not verify or restore unselected archives.',files:selected};
}
export function preparePublicationPayloads(root,contract,{purpose='online'}={}){
  const manifest=readPayloadManifest(root),selected=selectPublicationPayloads(contract,manifest,{purpose});
  const restoration=restorePayloads({root,strict:true,manifest:selected});
  const verification=verifyPayloads({root,manifest:selected});
  return{manifest,selected,restoration,verification};
}
function assertIdentity(actual,entry,label){
  if(actual.bytes!==entry.bytes||actual.sha256!==entry.sha256||actual.gitBlob!==entry.gitBlob)throw Error(label+': '+entry.path);
}
export function verifyPublicationFiles({root,contract}){
  validatePublicationContract(contract);let files=0,bytes=0;
  for(const entry of contract.files){
    if(entry.classification==='archived-not-published')continue;
    assertIdentity(fileIdentity(safePublicationPath(root,entry.path)),entry,'Online file identity mismatch');files++;bytes+=entry.bytes;
  }
  return{status:'verified',files,bytes,scope:'Every declared online file exists as a regular file with its exact bytes, SHA-256 and Git blob identity. Offline originals are not claimed reverified by this public subset.'};
}
export function assertPublicationRuntimeInventory({contract,trackedPaths,packedEntries=[],modelSourceHashes}){
  const entries=validatePublicationContract(contract),required=new Set([...trackedPaths.filter(path=>path.startsWith('dist/')),...packedEntries.filter(entry=>entry.path.startsWith('dist/')).map(entry=>entry.path)]);
  for(const path of required)if(entries.get(path)?.classification!=='runtime-required')throw Error('Missing runtime-required classification: '+path);
  for(const path of trackedPaths){
    if(/^(?:scripts|tests)\//.test(path)||/^qa\/.*\.(?:[cm]?js|py)$/.test(path)){
      const entry=entries.get(path);if(!entry||entry.classification==='archived-not-published')throw Error('Source or test code must be published: '+path);
    }
  }
  if(modelSourceHashes){
    const actual=contract.files.filter(entry=>entry.path.startsWith('dist/')&&/\.(js|html|css)$/.test(entry.path)&&entry.path!=='dist/model-build.js').map(entry=>entry.path.slice(5)).sort();
    const expected=Object.keys(modelSourceHashes).sort();
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Runtime executable inventory differs from model-build source list');
    for(const name of expected)if(entries.get('dist/'+name)?.sha256!==modelSourceHashes[name])throw Error('Runtime source hash differs from model-build: '+name);
  }
  return{status:'covered',runtimePaths:required.size,modelSources:modelSourceHashes?Object.keys(modelSourceHashes).length:null};
}
export function assertCommittedPublicationFiles({contract,headBlobs,packedEntries=[]}){
  const logicalPayloads=new Set(packedEntries.map(entry=>entry.path));
  let ordinaryFiles=0,packedLogicalFiles=0;
  for(const entry of contract.files){
    if(entry.classification==='archived-not-published'&&!entry.repositoryRequired&&!entry.repositoryStorage)continue;
    const actual=headBlobs.get(entry.path);
    if(actual===undefined&&logicalPayloads.has(entry.path)){packedLogicalFiles++;continue;}
    if(actual!==entry.gitBlob)throw Error('Publication file differs from actual committed HEAD: '+entry.path);
    ordinaryFiles++;
  }
  return{status:'matched-actual-head',ordinaryFiles,packedLogicalFiles,scope:'Copied ordinary files match actual HEAD blobs. Ignored logical payloads retain their separate complete-manifest and selected-archive hashes.'};
}
export function assertPublicationEvidenceCoverage(validation,contract){
  const entries=validatePublicationContract(contract),references=[];
  function visit(value,location='$'){
    if(typeof value==='string'&&/^(?:qa|docs)\//.test(value)){
      const code=value.match(/:\d+(?::\d+)?$/),path=value.replace(/:\d+(?::\d+)?$/,'').split(/[?#]/)[0],entry=entries.get(path);
      if(!entry)throw Error('Unclassified validation evidence reference: '+path+' at '+location);
      references.push({location,value,path,classification:entry.classification,publiclyAvailable:entry.publiclyAvailable,...(code?{codeLocation:code[0]}:{}),...(entry.publiclyAvailable?{onlineURL:entry.onlineURL}:{archive:entry.archive,source:entry.source??contract.source}),bytes:entry.bytes,sha256:entry.sha256});
    }else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))visit(child,location+'.'+key);
  }
  visit(validation);
  return{status:'fully-classified',references:references.length,uniquePaths:new Set(references.map(row=>row.path)).size,onlineReferences:references.filter(row=>row.publiclyAvailable).length,offlineReferences:references.filter(row=>!row.publiclyAvailable).length,items:references,scope:'Every literal qa/docs path in the unchanged validation report is explicitly classified, including code locations. Recorded pass/fail outcomes remain historical facts; offline raw data are not available from this website.'};
}
export function copyPublicationFile({root,output,entry,sitePath=publicSitePath(entry)}){
  if(entry.classification==='archived-not-published')throw Error('Cannot copy archived-not-published evidence: '+entry.path);
  const source=safePublicationPath(root,entry.path),target=safePublicationPath(output,sitePath);
  assertIdentity(fileIdentity(source),entry,'Source changed before publication copy');
  mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target,constants.COPYFILE_EXCL);
  assertIdentity(fileIdentity(target),entry,'Public copy identity mismatch');
  return{...entry,sitePath};
}
const htmlEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderAvailabilityPage(contract,{publicationCommit,publicationTree}={}){
  validatePublicationContract(contract);
  const offline=contract.files.filter(entry=>!entry.publiclyAvailable),online=contract.files.filter(entry=>entry.publiclyAvailable);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Roadster 发布资料范围</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:32px auto;padding:0 20px;background:#111823;color:#e4ebf5}a{color:#88d6ff}code{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #344154;padding:8px;text-align:left;overflow-wrap:anywhere}summary{cursor:pointer}small{color:#b7c3d4}</style><h1>Roadster ${htmlEscape(contract.source.modelVersion)} · 发布资料范围</h1><p><a href="./index.html">进入试验场</a> · <a href="./availability.json">查看逐文件身份与可用性清单</a> · <a href="./validation.json">查看原始验证报告</a></p><p>运行程序、源码、测试输入与下列在线资料可访问。原验证报告记录的通过、失败和未测结论保持原样；部分新增大型生成数据没有随本次上线，不能将本网站称为完整证据归档。</p><p>原开发提交 <code>${htmlEscape(contract.source.commit)}</code>；运行构建 <code>${htmlEscape(contract.source.modelBuildId)}</code>。实际发布提交 <code>${htmlEscape(publicationCommit??'尚未发布')}</code>，发布树 <code>${htmlEscape(publicationTree??'尚未发布')}</code>。</p><h2>未在线发布 · ${offline.length} 项</h2><p>这些文件没有在线下载链接。原件及完整历史的保存状态以清单为准；本页面不会把本地保留或保存准备失败称为私人资料库已保存成功。</p><table><thead><tr><th>原路径</th><th>字节数</th><th>真实保存状态</th></tr></thead><tbody>${offline.map(entry=>`<tr><td><code>${htmlEscape(entry.path)}</code></td><td>${entry.bytes}</td><td>${htmlEscape(entry.archive.saveStatus)}</td></tr>`).join('')}</tbody></table><details><summary>在线文件 · ${online.length} 项</summary><ul>${online.map(entry=>`<li><a href="${htmlEscape(entry.onlineURL)}">${htmlEscape(entry.path)}</a> <small>${entry.bytes} B · ${htmlEscape(entry.sha256)}</small></li>`).join('')}</ul></details><h2>完整原始历史</h2><p><code>${htmlEscape(contract.source.bundle.path)}</code><br>${contract.source.bundle.bytes} B<br>SHA-256 <code>${htmlEscape(contract.source.bundle.sha256)}</code><br>保存状态：${htmlEscape(contract.source.bundle.saveStatus)}</p></html>`;
}
