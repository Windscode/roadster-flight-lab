// Recovery publication gates. Historical acceptance reports are immutable;
// missing historical evidence is declared, never counted as a passing check.
import {readFileSync,readdirSync,lstatSync,mkdirSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const hash=b=>createHash('sha256').update(b).digest('hex');
export function safe(name){assert(typeof name==='string'&&!name.includes('\\')&&!name.startsWith('/')&&!name.split('/').some(x=>!x||x==='.'||x==='..'||x==='.git'),'Unsafe release path');return resolve(root,name);}
export function files(folder){return readdirSync(safe(folder),{withFileTypes:true}).flatMap(e=>{const p=folder+'/'+e.name;assert(!e.isSymbolicLink(),'Symlink in release');return e.isDirectory()?files(p):[p];}).sort();}
export function identity(path){const b=readFileSync(safe(path));return{path,bytes:b.length,sha256:hash(b)};}
export function verifyPlan(plan){
  assert.equal(plan.schema,'roadster.recovered-publication');assert.equal(plan.version,1);
  assert.equal(plan.source.modelVersion,MODEL_VERSION);assert.equal(plan.source.modelBuildId,MODEL_BUILD_ID);
  const seen=new Set();
  for(const e of plan.runtime){safe(e.path);assert(e.path.startsWith('dist/'));assert(!seen.has(e.path),'Duplicate runtime');seen.add(e.path);assert.deepEqual(identity(e.path),e,'Runtime changed');}
  assert.deepEqual([...seen].sort(),files('dist'),'Missing or extra runtime file');
  const names=files('dist').filter(p=>/\.(js|html|css)$/.test(p)&&p!=='dist/model-build.js').map(p=>p.slice(5));
  assert.deepEqual(names.sort(),Object.keys(MODEL_SOURCE_HASHES).sort(),'Runtime module inventory changed');
  for(const [p,h]of Object.entries(MODEL_SOURCE_HASHES))assert.equal(identity('dist/'+p).sha256,h,'Original model hash: '+p);
  assert.equal(hash(JSON.stringify(MODEL_SOURCE_HASHES)),MODEL_BUILD_ID,'Aggregate model build');
  for(const e of plan.onlineEvidence){assert(!seen.has(e.path),'Duplicate online path');seen.add(e.path);assert.deepEqual(identity(e.path),e,'Online evidence changed');}
  const references=new Set();const visit=v=>{if(typeof v==='string'&&/^(qa|docs)\//.test(v))references.add(v.replace(/:\d+(?::\d+)?$/,'').split(/[?#]/)[0]);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};
  visit(JSON.parse(readFileSync(safe('dist/validation.json'),'utf8')));
  assert.deepEqual([...references].sort(),plan.historicalReferences.map(e=>e.path).sort(),'Unclassified historical reference');
  for(const e of plan.historicalReferences){
    safe(e.path);assert(['online','repository-only','unrecovered'].includes(e.status),'Unknown availability');
    if(e.status==='online')assert(plan.onlineEvidence.some(x=>x.path===e.path),'False online reference');
    if(e.status==='repository-only')assert.deepEqual(identity(e.path),{path:e.path,bytes:e.bytes,sha256:e.sha256});
    if(e.status==='unrecovered'){assert(!existsSync(safe(e.path)),'Available evidence marked unrecovered');assert(!e.onlineURL&&!e.sha256&&!e.bytes,'Unrecovered evidence must not invent identity');}
  }
  return{status:'passed',scope:'Recovered runtime and selected online files only; not full historical regression or original Git history restoration',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,runtimeFiles:plan.runtime.length,modelSources:names.length,onlineEvidence:plan.onlineEvidence.length,unrecoveredReferences:plan.historicalReferences.filter(e=>e.status==='unrecovered').length};
}
export function readPlan(){const plan=JSON.parse(readFileSync(safe('publication/recovery-plan.json'),'utf8'));return{plan,verification:verifyPlan(plan)};}
export function copyTo(output,path,target=path){safe(path);const dst=resolve(output,target);assert(dst.startsWith(resolve(output)+'/')||dst.startsWith(resolve(output)+'\\'));mkdirSync(dirname(dst),{recursive:true});copyFileSync(safe(path),dst);assert.equal(hash(readFileSync(dst)),identity(path).sha256);}
export function save(path,value){mkdirSync(dirname(safe(path)),{recursive:true});writeFileSync(safe(path),JSON.stringify(value,null,2)+'\n');}
