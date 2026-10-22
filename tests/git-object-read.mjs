// Read a historical blob without managed-runner pipe handles. This still
// fails on an execution error or nonzero status; callers retain byte hashes.
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export function readGitObject(object){
  const directory=mkdtempSync(join(tmpdir(),'roadster-git-object-'));
  const stdout=join(directory,'stdout'),stderr=join(directory,'stderr');let outFd,errFd;
  try{
    outFd=openSync(stdout,'w');errFd=openSync(stderr,'w');
    const result=spawnSync('git',['show',object],{stdio:['ignore',outFd,errFd]});
    const bytes=readFileSync(stdout),errorText=readFileSync(stderr,'utf8');
    if(result.error||result.status!==0)throw new Error('Cannot read historical git object '+object+': '+errorText,{cause:result.error});
    return bytes;
  }finally{
    if(outFd!==undefined)closeSync(outFd);if(errFd!==undefined)closeSync(errFd);
    rmSync(directory,{recursive:true,force:true});
  }
}
