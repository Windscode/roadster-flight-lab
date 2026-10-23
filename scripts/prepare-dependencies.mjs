// Recover only declared dependencies before invoking application or test code.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync,existsSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {readPublicationContract,preparePublicationPayloads} from './publication-contract.mjs';
import {restorePayloads,verifyPayloads} from './repository-payloads.mjs';
export function prepareDependencies({root=fileURLToPath(new URL('../',import.meta.url)),purpose='test',fullArchive=false}={}){
  if(fullArchive){const restoration=restorePayloads({root,strict:true}),verification=verifyPayloads({root});return{scope:'complete-archive',restoration,verification};}
  // The recovered Git checkout contains runtime files directly. The older
  // archive contract has unavailable historical chunks and is not a launch
  // dependency. Never restore it over an actively edited development tree.
  const recovered=resolve(root,'publication/recovery-plan.json');
  if(existsSync(recovered)){
    const plan=JSON.parse(readFileSync(recovered,'utf8'));
    if(plan.schema!=='roadster.recovered-publication'||plan.version!==1)throw Error('Unsupported recovery manifest');
    const development=MODEL_VERSION!==plan.source?.modelVersion,modifiedAssets=[];
    let assets=0;
    for(const entry of plan.runtime){
      if(typeof entry.path!=='string'||!entry.path.startsWith('dist/')||entry.path.includes('\\')||entry.path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe runtime dependency path');
      const path=resolve(root,entry.path),stat=lstatSync(path,{throwIfNoEntry:false});
      if(!stat?.isFile()||stat.isSymbolicLink())throw Error('Missing runtime dependency: '+entry.path);
      if(entry.path.startsWith('dist/assets/')){
        const data=readFileSync(path);
        const current={path:entry.path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
        if(current.bytes!==entry.bytes||current.sha256!==entry.sha256){
          if(!development)throw Error('Recovered asset changed; exact recovery launch requires original bytes: '+entry.path);
          modifiedAssets.push(current);
        }
        assets++;
      }
    }
    return{scope:development?'development-runtime-files':'existing-runtime-files',purpose,restoration:{restored:0},verification:{runtimeFiles:plan.runtime.length,assetsChecked:assets,originalAssetsMatched:assets-modifiedAssets.length,modifiedAssets},historicalArchiveVerified:false};
  }
  const {contract}=readPublicationContract(root),result=preparePublicationPayloads(root,contract,{purpose});
  return{scope:purpose+'-dependencies',restoration:result.restoration,verification:result.verification};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareDependencies({purpose:process.argv[2]||'test',fullArchive:process.argv.includes('--full-archive')})));
