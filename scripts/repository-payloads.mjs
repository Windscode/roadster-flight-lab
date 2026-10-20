// Lossless storage for large reviewed repository assets and numerical evidence.
// Runtime consumers still receive the original bytes and original file names.
import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const digest=data=>createHash('sha256').update(data).digest('hex');
const gitBlob=data=>createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
const manifestPath='repository-payloads/manifest.json';
function safePath(root,name){
  root=resolve(root);
  if(typeof name!=='string'||!name||name.includes('\\'))throw Error('Invalid payload path');
  const target=resolve(root,name),rel=relative(root,target);
  if(rel==='..'||rel.startsWith('..'+sep)||rel!==name.split('/').join(sep))throw Error('Payload outside repository: '+name);
  // Never follow a symlink while restoring a checked-in logical path.
  // existsSync follows links and reports a dangling link as absent. Inspect the
  // directory entry itself so restoration cannot create its external target.
  for(let path=target;path!==root;path=dirname(path))if(lstatSync(path,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Symlink in payload path: '+name);
  return target;
}
export function readPayloadManifest(root=defaultRoot){
  const path=safePath(root,manifestPath);
  if(!existsSync(path))return{schema:'roadster.repository-payloads',version:1,files:[]};
  const manifest=JSON.parse(readFileSync(path,'utf8'));
  if(manifest.schema!=='roadster.repository-payloads'||manifest.version!==1||!Array.isArray(manifest.files))throw Error('Unsupported payload manifest');
  return manifest;
}
export function restorePayloads({root=defaultRoot,strict=false}={}){
  root=resolve(root);const manifest=readPayloadManifest(root);let restored=0,verified=0,bytes=0;const modified=[];
  for(const entry of manifest.files){
    const target=safePath(root,entry.path);
    if(!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>100*1024*1024||entry.encoding!=='gzip'||!Array.isArray(entry.parts))throw Error('Invalid payload entry: '+entry.path);
    const compressed=Buffer.concat(entry.parts.map(part=>{
      const data=readFileSync(safePath(root,part.path));
      if(data.length!==part.bytes||digest(data)!==part.sha256)throw Error('Corrupt payload segment: '+part.path);
      return data;
    }));
    if(digest(compressed)!==entry.compressedSha256)throw Error('Compressed payload identity mismatch: '+entry.path);
    const data=gunzipSync(compressed,{maxOutputLength:entry.bytes+1});
    if(data.length!==entry.bytes||digest(data)!==entry.sha256||gitBlob(data)!==entry.gitBlobSha)throw Error('Restored payload identity mismatch: '+entry.path);
    if(existsSync(target)){
      if(digest(readFileSync(target))===entry.sha256){verified++;bytes+=entry.bytes;continue;}
      if(strict)throw Error('Local payload differs from its reviewed archive; preserve and review the edit, then repack before publishing: '+entry.path);
      modified.push(entry.path);continue;
    }
    mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data);restored++;bytes+=data.length;
  }
  return{restored,verified,files:manifest.files.length,bytes,preservedLocalEdits:modified};
}
export function packPayloads({root=defaultRoot,paths}={}){
  root=resolve(root);const existing=readPayloadManifest(root);
  const names=[...new Set(paths||existing.files.map(entry=>entry.path))].sort();
  const files=names.map(name=>{
    if(!/^(dist\/assets\/|qa\/)/.test(name))throw Error('Only reviewed assets and QA data may be packed: '+name);
    const data=readFileSync(safePath(root,name)),sha256=digest(data),compressed=gzipSync(data,{level:9,mtime:0});
    const parts=[];
    for(let offset=0,index=0;offset<compressed.length;offset+=196608,index++){
      const content=compressed.subarray(offset,offset+196608),path=`repository-payloads/chunks/${sha256}.${index}.gzpart`,target=safePath(root,path);
      mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);parts.push({path,bytes:content.length,sha256:digest(content)});
    }
    return{path:name,bytes:data.length,sha256,gitBlobSha:gitBlob(data),encoding:'gzip',compressedBytes:compressed.length,compressedSha256:digest(compressed),parts};
  });
  const manifest={schema:'roadster.repository-payloads',version:1,scope:'Lossless transport storage. Restore original bytes before local use, validation and Pages preparation; hashes are content identities, not visual or physical acceptance.',files};
  const target=safePath(root,manifestPath);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(manifest,null,2)+'\n');
  return{files:files.length,originalBytes:files.reduce((n,f)=>n+f.bytes,0),compressedBytes:files.reduce((n,f)=>n+f.compressedBytes,0),segments:files.reduce((n,f)=>n+f.parts.length,0)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]||'restore';
  if(mode==='restore')console.log(JSON.stringify(restorePayloads()));
  else if(mode==='pack')console.log(JSON.stringify(packPayloads({paths:process.argv.length>3?process.argv.slice(3):undefined})));
  else throw Error('Usage: node scripts/repository-payloads.mjs [restore|pack [reviewed logical paths...]]');
}
