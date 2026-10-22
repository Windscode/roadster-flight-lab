import {readFileSync,existsSync,mkdirSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,readPlan,copyTo,hash,save} from './recovery-publication.mjs';
import assert from 'node:assert/strict';
const {plan,verification}=readPlan(),out=resolve(root,'.pages-site');
assert(!existsSync(out),'Use a fresh output directory; existing output is preserved');
const check=JSON.parse(readFileSync(resolve(root,'.runtime/publication-check.json'),'utf8'));
assert.equal(check.integration.status,'passed');assert.equal(check.modelBuildId,plan.source.modelBuildId);
assert.equal(check.publication.planSha256,hash(readFileSync(resolve(root,'publication/recovery-plan.json'))));
// Use file descriptors rather than captured pipes (Windows process wrapper),
// and enumerate the committed tree once instead of spawning Git per file.
mkdirSync(resolve(root,'.runtime'),{recursive:true});
const git=args=>{const path=resolve(root,'.runtime/git-output.txt'),fd=openSync(path,'w');try{const p=spawnSync('git',args,{cwd:root,stdio:['ignore',fd,'inherit']});if(p.error)throw p.error;assert.equal(p.status,0,'Git inspection failed');}finally{closeSync(fd);}return readFileSync(path,'utf8').trim();};
const commit=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
const blobs=new Map(git(['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean).map(row=>{const i=row.indexOf('\t');return[row.slice(i+1),row.slice(0,i).split(' ')[2]];}));
import {createHash} from 'node:crypto';
for(const e of [...plan.runtime,...plan.onlineEvidence]){const b=readFileSync(resolve(root,e.path));const sha=createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');assert.equal(blobs.get(e.path),sha,'Not committed: '+e.path);}
mkdirSync(out);
for(const e of plan.runtime){
  // The original candidate deployment metadata remains available verbatim.
  // The site-root deployment.json is separately generated from actual HEAD.
  if(e.path!=='dist/deployment.json')copyTo(out,e.path,e.path.slice(5));
  if(/\.(js|html|css|md)$/.test(e.path)||e.path==='dist/deployment.json')copyTo(out,e.path);
}
for(const e of plan.onlineEvidence)copyTo(out,e.path);
const put=(p,v)=>writeFileSync(resolve(out,p),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');
put('availability.json',plan);
put('availability.html','<!doctype html><meta charset="utf-8"><title>3.19 recovery availability</title><h1>Roadster 3.19 recovered release</h1><p>Runtime bytes match the original 3.19 candidate. This is a recovery publication, not recovery of the complete original development history. Historical reports are unchanged; their unavailable evidence is explicitly listed.</p><p><a href="availability.json">File hashes and online / repository-only / unrecovered references</a> · <a href="docs/recovery-release-3.19.md">Recovery scope and limits</a> · <a href="index.html">Drive</a></p>');
const manifest={schema:'roadster.recovered-evidence',version:1,publicationCommit:commit,publicationTree:tree,originalDevelopment:plan.source,runtime:plan.runtime.map(e=>({...e,sitePath:e.path==='dist/deployment.json'?e.path:e.path.slice(5)})),files:plan.onlineEvidence,fileCount:plan.onlineEvidence.length,bytes:plan.onlineEvidence.reduce((s,e)=>s+e.bytes,0),historicalReferences:plan.historicalReferences,scope:'Only copied evidence is counted. Unrecovered references have no online URL and no fabricated hash. Original candidate deployment metadata is at dist/deployment.json; root deployment.json is generated from actual HEAD. See availability.json.'};
put('evidence-manifest.json',manifest);
put('deployment.json',{application:'roadster-flight-lab',modelVersion:plan.source.modelVersion,modelBuildId:plan.source.modelBuildId,sourceCommit:commit,sourceTree:tree,publicationCommit:commit,publicationTree:tree,originalDevelopment:plan.source,evidenceManifest:{path:'evidence-manifest.json',sha256:hash(JSON.stringify(manifest,null,2)+'\n')},availability:{path:'availability.json',page:'availability.html'},recoveryPublication:true});
put('publication-check.json',check);
console.log(JSON.stringify({status:'ready',commit,tree,...verification}));
