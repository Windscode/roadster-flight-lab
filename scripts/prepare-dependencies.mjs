// Recover only declared dependencies before invoking application or test code.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readPublicationContract,preparePublicationPayloads} from './publication-contract.mjs';
import {restorePayloads,verifyPayloads} from './repository-payloads.mjs';
export function prepareDependencies({root=fileURLToPath(new URL('../',import.meta.url)),purpose='test',fullArchive=false}={}){
  if(fullArchive){const restoration=restorePayloads({root,strict:true}),verification=verifyPayloads({root});return{scope:'complete-archive',restoration,verification};}
  const {contract}=readPublicationContract(root),result=preparePublicationPayloads(root,contract,{purpose});
  return{scope:purpose+'-dependencies',restoration:result.restoration,verification:result.verification};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareDependencies({purpose:process.argv[2]||'test',fullArchive:process.argv.includes('--full-archive')})));
