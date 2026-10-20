import {captureArchive} from './capture-archive.js';

export const INSPECTION_DIAGNOSTIC_FRAMES=Object.freeze([
  {id:'full-corrected',mode:'surface',correction:true},
  {id:'full-legacy-shadow',mode:'surface',correction:false},
  {id:'no-shadow',mode:'no-shadow',correction:true},
  {id:'no-environment',mode:'no-environment',correction:true},
  {id:'diffuse',mode:'diffuse',correction:true},
  {id:'normals',mode:'normals',correction:true},
  {id:'wireframe',mode:'wireframe',correction:true}
]);
const immutable=value=>{const copy=JSON.parse(JSON.stringify(value));const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};return freeze(copy);};

// Seven actual draw/copy/snapshot operations finish synchronously before PNG
// encoding begins. Caller holds pose, controls, resize and model selection.
export async function captureInspectionDiagnostics({renderer,render,snapshot,canvasFactory,captureId='surface-isolation-'+Date.now().toString(36)}){
  const width=renderer.domElement.width,height=renderer.domElement.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('No drawable frame');
  const originals=[],frames=[],conditionsFile=captureId+'-conditions.json';
  for(const spec of INSPECTION_DIAGNOSTIC_FRAMES){
    const canvas=canvasFactory();canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('No capture canvas');
    const result=render(spec);if(result&&typeof result.then==='function')throw Error('Diagnostic rendering must remain synchronous');
    context.drawImage(renderer.domElement,0,0);const file=captureId+'-'+spec.id+'.png',association={captureId,role:spec.id,originalFile:file,conditionsFile};
    frames.push(immutable({id:spec.id,file,diagnostic:spec,conditions:snapshot(spec,association)}));originals.push(canvas);
  }
  const record=immutable({format:'roadster-surface-isolation-1',captureId,createdAt:new Date().toISOString(),resolution:[width,height],frames,
    captureMethod:'Seven frozen-state live WebGL draws; immediate unscaled original copies and matching immutable conditions.',
    limits:'Diagnostic modes intentionally change the named rendering component. Pose, geometry LOD, camera and source lighting remain fixed. This capture is not a quality verdict or a driving performance benchmark.'});
  const blobs=await Promise.all(originals.map(canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG encoding returned no image')),'image/png'))));
  const archiveBlob=await captureArchive([...frames.map((frame,i)=>({name:frame.file,data:blobs[i]})),{name:conditionsFile,data:JSON.stringify(record,null,2)}]);
  return {record,archiveBlob,archiveName:captureId+'.zip'};
}
