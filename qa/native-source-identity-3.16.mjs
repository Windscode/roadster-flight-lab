import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function bytesAt(base,path){
  const response=await fetch(new URL(path,base),{cache:'no-store'});
  if(!response.ok)throw Error(`Native source audit could not read ${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// QA only. Inspect the actual served bytes before trusting the displayed build
// label; changing a source without rebuilding must stop a claimed final run.
// No browser state, shader, clock, input or simulation value is changed.
export async function auditNativeSourceIdentity(base,{expectedBuildId=null}={}){
  const raw=await bytesAt(base,'model-build.js'),source=raw.toString('utf8');
  const idMatch=source.match(/export const MODEL_BUILD_ID=("[a-f0-9]{64}");/);
  const hashesMatch=source.match(/export const MODEL_SOURCE_HASHES=(\{[\s\S]*\});\s*$/);
  if(!idMatch||!hashesMatch)throw Error('Native source audit cannot parse the declared build identity');
  const modelBuildId=JSON.parse(idMatch[1]),declared=JSON.parse(hashesMatch[1]);
  if(sha(JSON.stringify(declared))!==modelBuildId)throw Error('Declared source map does not hash to the declared model build');
  if(expectedBuildId&&modelBuildId!==expectedBuildId)throw Error('Served model build differs from the requested build');
  const checked={},names=Object.keys(declared),mismatches=[];
  for(let index=0;index<names.length;index+=12){
    const results=await Promise.allSettled(names.slice(index,index+12).map(async path=>({path,actual:sha(await bytesAt(base,path))})));
    for(const result of results){if(result.status==='rejected')throw result.reason;const{path,actual}=result.value;checked[path]=actual;if(actual!==declared[path])mismatches.push({path,declared:declared[path],actual});}
  }
  const assets=[];
  for(const directory of ['assets/irradiance/','assets/night-irradiance/','assets/night-direct-irradiance/']){
    const rawManifest=await bytesAt(base,directory+'manifest.json'),manifest=JSON.parse(rawManifest),volumes=[];
    for(const volume of manifest.volumes??[]){
      const path=directory+volume.file,rawVolume=await bytesAt(base,path),actual=sha(rawVolume);
      volumes.push({path,bytes:rawVolume.length,sha256:actual});
      if(actual!==volume.sha256||rawVolume.length!==volume.bytes)mismatches.push({path,declared:volume.sha256,actual,declaredBytes:volume.bytes,actualBytes:rawVolume.length});
    }
    assets.push({path:directory+'manifest.json',sha256:sha(rawManifest),geometryCanonicalSHA256:manifest.geometryCanonicalSHA256,volumes});
  }
  if(mismatches.length)throw Error('Served source/assets differ from their declared identities: '+JSON.stringify(mismatches));
  return{schema:'roadster-native-served-source-audit',modelBuildId,modelBuildFileSHA256:sha(raw),sourceCount:names.length,sourceHashes:checked,assets,status:'passed',scope:'All served JS/HTML/CSS bytes match the declared build; each stored irradiance volume matches its manifest. Media beyond these declared fields retain their separate artifact identities. This proves byte identity, not rendered validity.'};
}
