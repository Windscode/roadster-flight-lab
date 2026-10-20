import {encodeJsonChunks} from './export-encoder.js';

self.onmessage=async event=>{
  const started=performance.now();let lastProgress=-Infinity;
  try{
    const encoded=await encodeJsonChunks(event.data.value,{onProgress:progress=>{const current=performance.now();if(current-lastProgress>=50){self.postMessage({type:'progress',progress});lastProgress=current;}}});
    const blob=new Blob(encoded.parts,{type:'application/json'});
    self.postMessage({type:'complete',result:{blob,characters:encoded.characters,visited:encoded.visited,workerSerializeMs:performance.now()-started}});
  }catch(error){self.postMessage({type:'failed',error:String(error.message||error)});}
};
