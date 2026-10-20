import {captureArchive} from './capture-archive.js';

// Pair creation is synchronous through both live draws and immediate canvas
// copies. Only browser PNG encoding and ZIP assembly are asynchronous. The
// caller keeps simulation, camera controls, inputs and renderer resize locked
// until this promise settles. This helper never generates replacement pixels.
let captureSequence=0;
const uniqueId=()=>`surface-${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.()??(++captureSequence).toString(36)}`;
function immutableJSON(value){
  const copy=JSON.parse(JSON.stringify(value));
  const freeze=node=>{if(node&&typeof node==='object'){Object.values(node).forEach(freeze);Object.freeze(node);}return node;};
  return freeze(copy);
}
const png=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encoding returned no image.')),'image/png'));

export async function captureInspectionPair({renderer,render,snapshot,canvasFactory,baselineVersion,currentVersion,caption,footnote,archive=false,captureId=uniqueId()}){
  const createdAt=new Date().toISOString(),width=renderer.domElement.width,height=renderer.domElement.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('The rendered frame has no drawing buffer.');
  const names={reference:`${captureId}-reference-${baselineVersion}.png`,current:`${captureId}-current-${currentVersion}.png`,comparison:`${captureId}-comparison.png`,conditions:`${captureId}-conditions.json`};
  const originals=[],frames=[];
  for(const role of ['reference','current']){
    const canvas=canvasFactory();canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw new Error('The browser did not provide a 2D capture canvas.');
    const result=render(role);if(result&&typeof result.then==='function')throw new Error('Capture rendering must be synchronous.');
    // No scaling, annotation, readback transform or later renderer callback can
    // modify these original frame copies. The comparison gets its own canvas.
    context.drawImage(renderer.domElement,0,0);
    const association={captureId,role,originalFile:names[role],conditionsFile:names.conditions};
    frames.push(immutableJSON({role,file:names[role],conditions:snapshot(role,association)}));
    originals.push(canvas);
  }
  const paired=canvasFactory();paired.width=width*2;paired.height=height+62;
  const context=paired.getContext('2d');if(!context)throw new Error('The browser did not provide a 2D capture canvas.');
  context.fillStyle='#101820';context.fillRect(0,0,paired.width,paired.height);
  originals.forEach((canvas,index)=>{context.drawImage(canvas,index*width,0);context.fillStyle='#dfe7ec';context.font='16px system-ui';context.fillText(caption(frames[index].role,frames[index].conditions),index*width+18,height+26);});
  context.fillStyle='#97acb8';context.font='12px system-ui';context.fillText(footnote,18,height+49);
  const record=immutableJSON({format:'roadster-surface-frame-pair-1',captureId,createdAt,files:names,comparisonProtocol:frames[0].conditions.comparisonProtocol,
    captureMethod:'Two sequential live WebGL draws with the inspection simulation, camera controls, inputs and renderer resize frozen. Each original PNG is copied immediately after its corresponding draw.',
    originalResolution:[width,height],comparisonResolution:[paired.width,paired.height],frames,
    limits:'Original PNGs use browser encoding without scaling or retouching. The labelled comparison is a separate canvas. This capture does not certify appearance or performance. An independently exported current-state JSON is not a companion to these frames.'});
  const pairBlob=await png(paired);
  if(!archive)return{captureId,record,pairBlob,pairName:names.comparison};
  const blobs=await Promise.all(originals.map(png));
  const archiveBlob=await captureArchive([
    {name:names.reference,data:blobs[0]},{name:names.current,data:blobs[1]},
    {name:names.comparison,data:pairBlob},{name:names.conditions,data:JSON.stringify(record,null,2)},
    {name:'READ-ME.txt',data:'Two original live WebGL PNGs, a separately labelled comparison, and their immutable capture conditions.\nAll companion names and per-frame records share the captureId in the conditions JSON. Original PNGs are not scaled or retouched.\nThe two renders use one frozen inspection state, not two different simulation times. Frozen geometry references use the current renderer and light rig.\nKeep this JSON with these PNGs. A later current-state JSON export is independent and does not describe these frames.\nA paused inspection capture is not a driving FPS or a pixel-quality verdict.\n'}
  ]);
  return{captureId,record,pairBlob,pairName:names.comparison,archiveBlob,archiveName:`${captureId}-comparison.zip`};
}
