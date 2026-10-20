import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';

const exportWorkerURL=new URL('../dist/export-worker.js',import.meta.url).href;
const bridgeSource=`import {parentPort} from 'node:worker_threads';
globalThis.self={postMessage:value=>parentPort.postMessage(value)};
await import(${JSON.stringify(exportWorkerURL)});
parentPort.on('message',data=>self.onmessage({data}));`;

// Legacy DOM fixtures own the numerical Worker facade and its deliberate
// failure/hold counters. Route only the separate export-worker URL to the
// actual runtime module in a Node thread. Serialization, structured cloning,
// Blob contents and async completion are real; this is not browser/GPU timing.
class ExportWorkerBridge{
  constructor(url,options){
    assert.equal(String(url),exportWorkerURL);
    assert.equal(options?.type,'module');
    this.stopped=false;
    this.worker=new NodeWorker(new URL('data:text/javascript,'+encodeURIComponent(bridgeSource)),{type:'module'});
    this.worker.on('message',data=>{if(!this.stopped)this.onmessage?.({data});});
    this.worker.on('error',error=>{if(!this.stopped)this.onerror?.({message:error.message,error,preventDefault(){}});});
  }
  postMessage(value){this.worker.postMessage(value);}
  terminate(){this.stopped=true;return this.worker.terminate();}
}

export function withActualExportWorker(NumericalWorker){
  return class extends NumericalWorker{
    constructor(url,options){
      if(String(url)===exportWorkerURL)return new ExportWorkerBridge(url,options);
      super(url,options);
    }
  };
}
