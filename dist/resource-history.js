import {readProtectedArchive,storageBytes,writeArchiveCandidate} from './research-storage.js';

export const RESOURCE_HISTORY_KEY='roadster-resource-runs-3.21';
const MAX_BYTES=4*1024*1024,RECENT_RUNS=6;
const clone=value=>structuredClone(value);
const identity=run=>run.recordId??run.summaryId??null;

// A partial load would silently discard evidence when the next run is saved.
// Keep the whole original archive protected if any entry is unreadable.
export function parseResourceHistory(raw){
  if(storageBytes(raw)>MAX_BYTES)throw Error('resource-history-too-large');
  const runs=JSON.parse(raw);
  if(!Array.isArray(runs))throw Error('resource-history-invalid');
  for(const run of runs){
    if(!run||run.schema!=='roadster-resource-route-1'||typeof run.comparisonKey!=='string'||run.comparisonKey.length>100000||
      typeof run.reason!=='string'||typeof run.finite!=='boolean'||typeof run.completed!=='boolean'||!run.work||Array.isArray(run.work)||
      !['elapsedS','remainingKWh','gasUsedKg','netEnergyJ'].every(key=>Number.isFinite(run[key]))||!Number.isFinite(run.work.recoveredJ)||
      (run.recordId!=null&&typeof run.recordId!=='string')||(run.summaryId!=null&&typeof run.summaryId!=='string'))throw Error('resource-history-invalid');
  }
  return runs;
}

export class ResourceHistory{
  constructor(getStorage=()=>globalThis.localStorage){
    this.getStorage=getStorage;this.pending=[];this.warning=null;this.protectedRaw=null;
    let loaded;
    try{loaded=readProtectedArchive(getStorage(),RESOURCE_HISTORY_KEY,{parse:parseResourceHistory,empty:()=>[],maxBytes:MAX_BYTES});}
    catch(error){loaded={value:[],warning:error.message,protectedRaw:null};}
    this.runs=loaded.value;this.protectedRaw=loaded.protectedRaw;
    if(loaded.warning)this.warning=loaded.protectedRaw!==null?'protected':'unavailable';
  }
  append(result){
    const run=clone(result);
    if(!identity(run))run.summaryId=globalThis.crypto?.randomUUID?.()??`route-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    parseResourceHistory(JSON.stringify([run]));
    this.pending.push(run);this.runs.push(run);this.save();
    return this.snapshot();
  }
  save(){
    let storage,expectedRaw;
    try{
      if(this.protectedRaw!==null){this.warning='protected';return false;}
      storage=this.getStorage();
      if(!storage){this.warning='unavailable';return false;}
      // Only append this page's new results to the latest archive. Re-saving a
      // stale copy of its old six results would evict another page's new run.
      while(this.pending.length){
        const loaded=readProtectedArchive(storage,RESOURCE_HISTORY_KEY,{parse:parseResourceHistory,empty:()=>[],maxBytes:MAX_BYTES});
        if(loaded.warning){this.protectedRaw=loaded.protectedRaw;this.warning=loaded.protectedRaw!==null?'protected':'unavailable';return false;}
        expectedRaw=loaded.raw;
        const next=this.pending[0],existing=loaded.value.find(run=>identity(run)===identity(next));
        if(existing&&JSON.stringify(existing)!==JSON.stringify(next)){this.warning='conflict';return false;}
        const candidate=existing?loaded.value:[...loaded.value,next].slice(-RECENT_RUNS);
        // Check for a change since the merge and verify this exact write. This
        // is optimistic conflict detection, not a cross-tab transaction.
        const saved=writeArchiveCandidate(storage,RESOURCE_HISTORY_KEY,candidate,{parse:parseResourceHistory,maxBytes:MAX_BYTES,expectedRaw:loaded.raw});
        if(storage.getItem(RESOURCE_HISTORY_KEY)!==saved.raw){this.warning='conflict';return false;}
        this.pending.shift();
        this.runs.splice(0,this.runs.length,...clone(candidate),...this.pending);
      }
      this.warning=null;return true;
    }catch{
      this.warning='unavailable';
      try{if(expectedRaw!==undefined&&storage.getItem(RESOURCE_HISTORY_KEY)!==expectedRaw)this.warning='conflict';}catch{}
      return false;
    }
  }
  snapshot(){return{status:this.warning?'unsaved':'saved',reason:this.warning,unsavedCount:this.pending.length,protectedArchive:this.protectedRaw!==null};}
  archive(){return{schema:'roadster-resource-summary-1',runs:clone(this.runs),persistence:this.snapshot(),protectedRaw:this.protectedRaw,scope:'Resource summaries; up to six saved recent runs plus every unsaved session result. Use Inputs / replay for full fixed-step records.'};}
}
