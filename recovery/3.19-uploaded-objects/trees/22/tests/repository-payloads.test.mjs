import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync,symlinkSync,existsSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {restorePayloads,verifyPayloads,readPayloadManifest} from '../scripts/repository-payloads.mjs';
import {readPublicationContract,selectPublicationPayloads} from '../scripts/publication-contract.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),fullArchive=process.argv.includes('--full-archive'),completeManifest=readPayloadManifest(root),manifest=fullArchive?completeManifest:selectPublicationPayloads(readPublicationContract(root).contract,completeManifest,{purpose:'test'}),isolated=mkdtempSync(join(tmpdir(),'roadster-payload-'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const copy=path=>{const target=join(isolated,path);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,path),target);};
try{
  mkdirSync(join(isolated,'repository-payloads'),{recursive:true});writeFileSync(join(isolated,'repository-payloads/manifest.json'),JSON.stringify(manifest));
  for(const entry of manifest.files)for(const part of entry.parts)copy(part.path);
  const first=restorePayloads({root:isolated,strict:true});
  assert.equal(first.restored,manifest.files.length);assert.equal(first.verified,0);
  for(const entry of manifest.files)assert.deepEqual(readFileSync(join(isolated,entry.path)),readFileSync(join(root,entry.path)),'Fresh restoration differs from the reviewed original '+entry.path);
  const second=restorePayloads({root:isolated,strict:true});assert.equal(second.restored,0);assert.equal(second.verified,manifest.files.length);
  const verified=verifyPayloads({root:isolated});assert.equal(verified.restored,0);assert.equal(verified.verified,manifest.files.length);assert.equal(verified.archivesVerified,manifest.files.length);assert.equal(verified.logicalSymlinks,0);
  const entry=manifest.files[0],target=join(isolated,entry.path),edited=Buffer.from('intentional local edit retained by restoration');
  writeFileSync(target,edited);assert.deepEqual(restorePayloads({root:isolated}).preservedLocalEdits,[entry.path]);assert.deepEqual(readFileSync(target),edited);
  assert.throws(()=>restorePayloads({root:isolated,strict:true}),/Local payload differs/);assert.deepEqual(readFileSync(target),edited);
  assert.throws(()=>verifyPayloads({root:isolated}),/Existing logical payload identity mismatch/);assert.deepEqual(readFileSync(target),edited,'Read-only verification must preserve a differing local file');
  rmSync(target);assert.throws(()=>verifyPayloads({root:isolated}),/Missing logical payload/);assert.equal(existsSync(target),false,'Read-only verification must not restore a missing file');
  writeFileSync(target,readFileSync(join(root,entry.path)));
  const outsideDirectory=mkdtempSync(join(tmpdir(),'roadster-payload-outside-')),outsideTarget=join(outsideDirectory,'local-edit.bin');
  try{
    rmSync(target);
    for(const existing of [false,true]){
      if(existing)writeFileSync(outsideTarget,edited);
      symlinkSync(outsideTarget,target);
      assert.throws(()=>verifyPayloads({root:isolated}),existing?/Existing logical payload identity mismatch/:/Logical payload is not an existing regular file/);
      assert.equal(lstatSync(target).isSymbolicLink(),true,'Verification must preserve both valid and dangling links');
      if(existing)assert.deepEqual(readFileSync(outsideTarget),edited,'Verification must preserve a differing external target');
      else assert.equal(existsSync(outsideTarget),false,'Verification must not create a dangling link target');
      for(const strict of [false,true]){
        assert.throws(()=>restorePayloads({root:isolated,strict}),/Symlink in payload path/);
        assert.equal(lstatSync(target).isSymbolicLink(),true,'A local symbolic link must be preserved');
        if(existing)assert.deepEqual(readFileSync(outsideTarget),edited,'Restoration must not overwrite an external target');
        else assert.equal(existsSync(outsideTarget),false,'Restoration must not create a dangling link target');
      }
      rmSync(target);
    }
    writeFileSync(outsideTarget,readFileSync(join(root,entry.path)));symlinkSync(outsideTarget,target);
    const before=lstatSync(outsideTarget),linkBefore=lstatSync(target),linked=verifyPayloads({root:isolated});
    assert.equal(linked.verified,manifest.files.length);assert.equal(linked.logicalSymlinks,1);assert.equal(linked.restored,0);
    for(const field of ['size','mtimeMs','ctimeMs','ino']){assert.equal(lstatSync(outsideTarget)[field],before[field],'Verification changed the existing external file '+field);assert.equal(lstatSync(target)[field],linkBefore[field],'Verification changed the existing symbolic link '+field);}
    for(const strict of [false,true])assert.throws(()=>restorePayloads({root:isolated,strict}),/Symlink in payload path/,'Read-only verification must not weaken restoration permissions');
  }finally{
    rmSync(target,{force:true});writeFileSync(target,readFileSync(join(root,entry.path)));
    rmSync(outsideDirectory,{recursive:true,force:true});
  }
  const corrupt=join(isolated,entry.parts[0].path),bytes=readFileSync(corrupt);bytes[0]^=1;writeFileSync(corrupt,bytes);
  assert.throws(()=>restorePayloads({root:isolated,strict:true}),/Corrupt payload segment/);
  assert.throws(()=>verifyPayloads({root:isolated}),/Corrupt payload segment/,'Verification must check archives even when the logical file is correct');
  rmSync(join(isolated,'repository-payloads/manifest.json'));assert.throws(()=>verifyPayloads({root:isolated}),/Missing payload manifest/);
  const report={status:'passed',scope:(fullArchive?'Complete archive':'Explicit runtime/test dependencies only')+': fresh-directory byte-for-byte reconstruction of every selected packed original; independent read-only archive/logical-file verification; idempotent restore, preservation of local edits, refusal of restoration through symbolic links and publication rejection of modified/corrupt data. No model or visual acceptance.',files:manifest.files.map(({path,bytes,sha256,gitBlobSha,compressedBytes})=>({path,bytes,sha256,gitBlobSha,compressedBytes})),checks:['Every selected payload reconstructs byte-for-byte from only checked-in segments; unselected historical data are not claimed tested','Repeated restoration preserves identical files','Local edits are preserved, and strict publication declines unreviewed edits','Existing and dangling symbolic links are refused during restoration without writing outside the checkout','Read-only verification checks archives and existing logical bytes, accepting only matching existing file symlinks without changing them or their targets','Read-only verification rejects missing, dangling and differing logical files without restoring or replacing them','Corrupt segments fail in restore and verify even when an already restored file exists','Read-only verification rejects a missing manifest'],sourceHashes:Object.fromEntries(['scripts/repository-payloads.mjs','repository-payloads/manifest.json','tests/repository-payloads.test.mjs'].map(path=>[path,sha(readFileSync(join(root,path)))]))};
  writeFileSync(join(root,`qa/repository-payloads-${REPORT_VERSION}.json`),JSON.stringify(report,null,2)+'\n');
  for(const check of report.checks)console.log('PASS: '+check);
}finally{rmSync(isolated,{recursive:true,force:true});}
