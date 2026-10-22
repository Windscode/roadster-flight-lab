// Read-only input extraction from the actual offline bakers. The transport
// loops and all output writes are excluded; their source bytes remain bound.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const bakeInputSHA256=data=>createHash('sha256').update(data).digest('hex');
export const BAKE_INPUT_RECIPES=Object.freeze([
  {folder:'irradiance',script:'scripts/bake-indirect.mjs',marker:"if(process.argv.includes('--audit')){",finish:'',
    capture:"({geometry,boxes,tree,materialModel,sun,sunFill,skySH,samples,bounces,seed,volumes:GI_VOLUMES,heights:GI_HEIGHTS,hdr:{width:hdr.width,height:hdr.height,arrayType:hdr.data.constructor.name,byteLength:hdr.data.byteLength,sha256:createHash('sha256').update(new Uint8Array(hdr.data.buffer,hdr.data.byteOffset,hdr.data.byteLength)).digest('hex')}})"},
  {folder:'night-irradiance',script:'scripts/bake-night-city.mjs',marker:"const output=new URL('../dist/assets/night-irradiance/'",finish:'',
    capture:'({geometry,anchors,sources,layout:NIGHT_FIELD_LAYOUT,occluderCount:occluders.count})'},
  {folder:'night-direct-irradiance',script:'scripts/bake-night-direct.mjs',marker:",output=new URL('../dist/assets/night-direct-irradiance/'",finish:';',
    capture:'({geometry,anchors,layout:NIGHT_FIELD_LAYOUT,occluderCount:occluders.count})'}
]);

export async function collectBakeInputs(root,recipe){
  root=resolve(root);const url=pathToFileURL(resolve(root,recipe.script)),source=readFileSync(url,'utf8');
  const at=source.indexOf(recipe.marker);assert.ok(at>=0,recipe.script+' capture boundary missing');
  assert.equal(source.indexOf(recipe.marker,at+recipe.marker.length),-1,'Ambiguous bake capture boundary');
  const prefix=source.slice(0,at)+recipe.finish;
  assert.doesNotMatch(prefix,/\b(?:writeFileSync|mkdirSync)\s*\(/,'Input extraction must not execute a write');
  // A data module has no directory. Resolve only import locations and the
  // original import.meta.url; every executed calculation remains unchanged.
  const located=prefix.replace(/(\bfrom\s*['"])(\.\.?\/[^'"]+)(['"])/g,(_,a,p,b)=>a+new URL(p,url).href+b)
    .replace(/import\.meta\.url/g,JSON.stringify(url.href));
  const captured=located+'\nconst __bakeInputsJSON=JSON.stringify('+recipe.capture+');\nexport default __bakeInputsJSON;\n';
  const previousFetch=globalThis.fetch,previousSamples=process.env.GI_SAMPLES;
  // The retained field was generated with 768 samples. Do not silently inherit
  // a shell override while reviewing its inputs.
  delete process.env.GI_SAMPLES;
  let json;
  try{json=(await import('data:text/javascript;base64,'+Buffer.from(captured).toString('base64'))).default;}
  finally{globalThis.fetch=previousFetch;if(previousSamples===undefined)delete process.env.GI_SAMPLES;else process.env.GI_SAMPLES=previousSamples;}
  const bytes=Buffer.from(json),value=JSON.parse(json);
  return {bytes,value,sha256:bakeInputSHA256(bytes),extraction:{script:recipe.script,scriptSHA256:bakeInputSHA256(source),prefixSHA256:bakeInputSHA256(prefix),adaptedModuleSHA256:bakeInputSHA256(captured),boundary:recipe.marker,method:'Execute the actual baker initialization before transport/output. Relocate import specifiers and import.meta.url only; append JSON capture. No bake file writes or transport-loop substitution.'}};
}
