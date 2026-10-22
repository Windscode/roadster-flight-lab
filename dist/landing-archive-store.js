/* The existing task archive, stored as one validated JSON document. IndexedDB
 * provides room for a bounded matrix without pruning its full solver traces.
 * The legacy localStorage item is never removed or overwritten by this adapter. */
export function createLandingArchiveStore({indexedDB,parse,key='roadster-landing-research-v1',deadlineMs=5000}={}){
  if(!indexedDB)return null;
  let db=null,revision=0,loaded=false,protectedRaw=null,queue=Promise.resolve();
  const error=text=>new Error(text);
  function bounded(start){return new Promise((resolve,reject)=>{
    let ended=false,abort=()=>{};
    const finish=(failure,value)=>{if(ended)return;ended=true;clearTimeout(timer);failure?reject(failure):resolve(value);};
    const timer=setTimeout(()=>{try{abort();}catch{}finish(error('Task archive storage exceeded '+deadlineMs+' ms; retained data was not reported saved.'));},deadlineMs);
    try{abort=start((value)=>finish(null,value),failure=>finish(failure))??abort;}catch(failure){finish(failure);}
  });}
  function open(){if(db)return Promise.resolve(db);return bounded((resolve,reject)=>{
    const request=indexedDB.open('roadster-landing-results',1);let abandoned=false;
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('archives'))request.result.createObjectStore('archives',{keyPath:'key'});};
    request.onerror=()=>reject(request.error??error('Task archive database could not open'));
    request.onsuccess=()=>{if(abandoned){request.result.close();return;}db=request.result;db.onversionchange=()=>{db?.close();db=null;};resolve(db);};
    return()=>{abandoned=true;};
  });}
  async function read(){
    const database=await open(),stored=await bounded((resolve,reject)=>{const tx=database.transaction('archives','readonly'),request=tx.objectStore('archives').get(key);request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);return()=>tx.abort();});
    revision=stored?.revision??0;loaded=true;
    if(!stored)return{value:null,raw:null,revision};
    if(!Number.isSafeInteger(revision)||revision<1||typeof stored.raw!=='string'){protectedRaw=stored?.raw??JSON.stringify(stored);throw error('Task database archive is protected; invalid storage envelope');}
    try{return{value:parse(stored.raw),raw:stored.raw,revision};}catch(failure){protectedRaw=stored.raw;throw error('Task database archive is protected; '+failure.message);}
  }
  function write(value){
    const raw=JSON.stringify(value);parse(raw); // Freeze before queuing; later UI changes cannot enter this write.
    const operation=queue.catch(()=>{}).then(async()=>{
      if(!loaded)throw error('Task archive is still loading; current work is retained in the session');
      if(protectedRaw!==null)throw error('Task database archive is protected; original bytes were not overwritten');
      const database=await open(),expected=revision;
      return bounded((resolve,reject)=>{
        const tx=database.transaction('archives','readwrite'),store=tx.objectStore('archives'),request=store.get(key);let rejection=null;
        request.onsuccess=()=>{
          const current=request.result,currentRevision=current?.revision??0;
          if(currentRevision!==expected){rejection=error('Another page updated the task archive; original data remains. Export current work and reload before merging.');tx.abort();return;}
          if(current){try{parse(current.raw);}catch(failure){rejection=error('Previous task archive is protected; '+failure.message);tx.abort();return;}}
          store.put({key,revision:expected+1,raw,storedAt:new Date().toISOString()});
        };
        tx.oncomplete=()=>{revision=expected+1;resolve({revision,bytes:new TextEncoder().encode(raw).length});};
        tx.onerror=()=>reject(rejection??tx.error??error('Task archive write failed'));
        tx.onabort=()=>reject(rejection??tx.error??error('Task archive write aborted; original data remains'));
        return()=>tx.abort();
      });
    });
    queue=operation;return operation;
  }
  return{read,write,getProtectedRaw:()=>protectedRaw,close(){queue.finally(()=>{db?.close();db=null;}).catch(()=>{});}};
}
