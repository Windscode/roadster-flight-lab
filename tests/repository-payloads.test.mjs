import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync,symlinkSync,existsSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {restorePayloads,readPayloadManifest} from '../scripts/repository-payloads.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),manifest=readPayloadManifest(root),isolated=mkdtempSync(join(tmpdir(),'roadster-payload-'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const copy=path=>{const target=join(isolated,path);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,path),target);};
try{
  copy('repository-payloads/manifest.json');
  for(const entry of manifest.files)for(const part of entry.parts)copy(part.path);
  const first=restorePayloads({root:isolated,strict:true});
  assert.equal(first.restored,manifest.files.length);assert.equal(first.verified,0);
  for(const entry of manifest.files)assert.deepEqual(readFileSync(join(isolated,entry.path)),readFileSync(join(root,entry.path)),'Fresh restoration differs from the reviewed original '+entry.path);
  const second=restorePayloads({root:isolated,strict:true});assert.equal(second.restored,0);assert.equal(second.verified,manifest.files.length);
  const entry=manifest.files[0],target=join(isolated,entry.path),edited=Buffer.from('intentional local edit retained by restoration');
  writeFileSync(target,edited);assert.deepEqual(restorePayloads({root:isolated}).preservedLocalEdits,[entry.path]);assert.deepEqual(readFileSync(target),edited);
  assert.throws(()=>restorePayloads({root:isolated,strict:true}),/Local payload differs/);assert.deepEqual(readFileSync(target),edited);
  writeFileSync(target,readFileSync(join(root,entry.path)));
  const outsideDirectory=mkdtempSync(join(tmpdir(),'roadster-payload-outside-')),outsideTarget=join(outsideDirectory,'local-edit.bin');
  try{
    rmSync(target);
    for(const existing of [false,true]){
      if(existing)writeFileSync(outsideTarget,edited);
      symlinkSync(outsideTarget,target);
      for(const strict of [false,true]){
        assert.throws(()=>restorePayloads({root:isolated,strict}),/Symlink in payload path/);
        assert.equal(lstatSync(target).isSymbolicLink(),true,'A local symbolic link must be preserved');
        if(existing)assert.deepEqual(readFileSync(outsideTarget),edited,'Restoration must not overwrite an external target');
        else assert.equal(existsSync(outsideTarget),false,'Restoration must not create a dangling link target');
      }
      rmSync(target);
    }
  }finally{
    rmSync(target,{force:true});writeFileSync(target,readFileSync(join(root,entry.path)));
    rmSync(outsideDirectory,{recursive:true,force:true});
  }
  const corrupt=join(isolated,entry.parts[0].path),bytes=readFileSync(corrupt);bytes[0]^=1;writeFileSync(corrupt,bytes);
  assert.throws(()=>restorePayloads({root:isolated,strict:true}),/Corrupt payload segment/);
  const report={status:'passed',scope:'Fresh-directory byte-for-byte reconstruction of every packed original; idempotent restore, preservation of local edits, refusal of symbolic links and publication rejection of modified/corrupt data. No model or visual acceptance.',files:manifest.files.map(({path,bytes,sha256,gitBlobSha,compressedBytes})=>({path,bytes,sha256,gitBlobSha,compressedBytes})),checks:['Every packed asset and full evidence file reconstructs byte-for-byte from only checked-in segments','Repeated restoration preserves identical files','Local edits are preserved, and strict publication declines unreviewed edits','Existing and dangling symbolic links are refused without writing outside the checkout','Corrupt segments fail even when an already restored file exists'],sourceHashes:Object.fromEntries(['scripts/repository-payloads.mjs','repository-payloads/manifest.json','tests/repository-payloads.test.mjs'].map(path=>[path,sha(readFileSync(join(root,path)))]))};
  writeFileSync(join(root,'qa/repository-payloads-3.11.json'),JSON.stringify(report,null,2)+'\n');
  for(const check of report.checks)console.log('PASS: '+check);
}finally{rmSync(isolated,{recursive:true,force:true});}
