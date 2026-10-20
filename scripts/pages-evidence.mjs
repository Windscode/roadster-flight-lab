// Local candidate preparation only. Ordinary tracked reports may be regenerated
// between preparations; only an in-progress copy is bound to its current bytes.
// The immutable repository-payloads manifest keeps its separate strict contract.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,mkdirSync,copyFileSync,constants} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function evidenceCategory(name){
  if(typeof name!=='string')throw Error('Invalid evidence path: '+name);
  if(/^qa\//.test(name))return 'qa-evidence';
  if(/^(docs\/|README(?:\.en)?\.md$)/.test(name))return 'documentation';
  // These are still explicit list entries, not directory-copy rules. Source
  // references are copied as bytes for reading; preparation never runs them.
  if(/^(scripts|tests)\/.+\.(?:[cm]?js|json|md)$/.test(name))return 'source-reference';
  if(/^dist\/.+\.(?:[cm]?js|md)$/.test(name))return 'runtime-source-browse-copy';
  if(/^\d+\.\d+-UPDATE-NOTES\.md$/.test(name))return 'historical-release-notes';
  if(name==='repository-payloads/README.md')return 'payload-documentation';
  throw Error('Unlisted evidence category: '+name);
}
function safeFile(root,name){
  root=resolve(root);
  if(typeof name!=='string'||!name||name.includes('\\'))throw Error('Invalid evidence path: '+name);
  const target=resolve(root,name),rel=relative(root,target);
  if(rel==='..'||rel.startsWith('..'+sep)||rel!==name.split('/').join(sep))throw Error('Evidence path leaves its root: '+name);
  for(let current=target;current!==root;current=dirname(current))if(lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Symbolic link in evidence path: '+name);
  return target;
}
export function planPagesEvidence({root,listFile,release,trackedPaths,packedEntries=[]}){
  const listBytes=readFileSync(safeFile(root,listFile)),list=JSON.parse(listBytes);
  if(list.schema!=='roadster.pages-evidence'||list.version!==1||list.release!==release||!Array.isArray(list.files))throw Error('Unsupported ordinary evidence list: '+listFile);
  if(new Set(list.files).size!==list.files.length)throw Error('Duplicate ordinary evidence path');
  const tracked=new Set(trackedPaths),files=new Map();
  function inspect(name,origin,expected=null){
    const category=evidenceCategory(name);
    const source=safeFile(root,name),stat=lstatSync(source);
    if(!stat.isFile())throw Error('Evidence is not a regular file: '+name);
    const data=readFileSync(source),record={path:name,bytes:data.length,sha256:sha(data),sources:[origin],category};
    if(category==='runtime-source-browse-copy')Object.assign(record,{runtimeSitePath:name.slice('dist/'.length),purpose:'Byte-identical source browsing copy for repository-relative documentation URLs. Runtime imports use the separate site-root path; this copy is not loaded again by the application.'});
    if(expected&&(record.bytes!==expected.bytes||record.sha256!==expected.sha256))throw Error('Packed evidence differs from its strict manifest: '+name);
    const previous=files.get(name);
    if(previous){if(previous.sha256!==record.sha256||previous.bytes!==record.bytes)throw Error('Evidence source changed while planning: '+name);previous.sources.push(origin);}
    else files.set(name,record);
  }
  for(const entry of packedEntries){if(!entry.path.startsWith('qa/'))throw Error('Non-QA packed evidence entry: '+entry.path);inspect(entry.path,'immutable-payload',entry);}
  for(const name of list.files){if(!tracked.has(name))throw Error('Ordinary evidence is not Git tracked: '+name);inspect(name,'ordinary-git-file');}
  return{list:{path:listFile,sha256:sha(listBytes),release,ordinaryPaths:list.files.length,scope:list.scope,origin:list.origin??null},files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),packedEntries:packedEntries.length};
}
export function assertValidationEvidenceCoverage(validation,availablePaths){
  const available=new Set(availablePaths),references=[],codeLocations=[];
  function visit(value,location='$'){
    if(typeof value==='string'&&/^(?:qa|docs)\//.test(value)){
      // A source citation such as qa/render-budget-check.mjs:95 is explicitly
      // a code location, not a candidate URL. Nothing is silently removed.
      if(/:\d+(?::\d+)?$/.test(value)){codeLocations.push({location,value});return;}
      const path=value.split(/[?#]/)[0];references.push({location,path});
    }else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))visit(child,location+'.'+key);
  }
  visit(validation);
  const missing=[...new Set(references.filter(row=>!available.has(row.path)).map(row=>row.path))];
  if(missing.length)throw Error('Validation evidence is not in the candidate copy list: '+missing.join(', '));
  return{status:'covered',references:references.length,uniquePaths:new Set(references.map(row=>row.path)).size,codeLocations,scope:'Literal qa/docs file paths in validation.json. This does not claim that all prose/source citations or all repository files are part of the site.'};
}
export function copyPagesEvidence({root,output,plan}){
  const files=[];
  for(const entry of plan.files){
    const source=safeFile(root,entry.path),target=safeFile(output,entry.path),sourceBytes=readFileSync(source);
    if(sourceBytes.length!==entry.bytes||sha(sourceBytes)!==entry.sha256)throw Error('Evidence changed during candidate preparation: '+entry.path);
    mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target,constants.COPYFILE_EXCL);
    const actual=readFileSync(target);
    if(actual.length!==entry.bytes||sha(actual)!==entry.sha256)throw Error('Copied evidence identity mismatch: '+entry.path);
    files.push({...entry});
  }
  return{files,fileCount:files.length,bytes:files.reduce((sum,row)=>sum+row.bytes,0),packedFiles:files.filter(row=>row.sources.includes('immutable-payload')).length,ordinaryFiles:files.filter(row=>row.sources.includes('ordinary-git-file')).length,runtimeSourceBrowseCopies:files.filter(row=>row.category==='runtime-source-browse-copy').map(({path,runtimeSitePath})=>({path,runtimeSitePath}))};
}
export function assertRuntimeSourceBrowseCopies({output,files}){
  const copies=[];
  for(const entry of files.filter(row=>row.category==='runtime-source-browse-copy')){
    const runtimeBytes=readFileSync(safeFile(output,entry.runtimeSitePath));
    if(runtimeBytes.length!==entry.bytes||sha(runtimeBytes)!==entry.sha256)throw Error('Source browsing copy differs from its site-root runtime file: '+entry.path);
    copies.push({path:entry.path,runtimeSitePath:entry.runtimeSitePath,bytes:entry.bytes,sha256:entry.sha256});
  }
  return{status:'matched',copies,scope:'These dist/ paths support source-document links only. The site-root runtime files retain their existing load paths and bytes.'};
}
