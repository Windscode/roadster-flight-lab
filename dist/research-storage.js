/* Storage is a separate outcome from execution and physical success. All writes
 * are candidates; callers commit destructive UI state only after this returns. */
export const storageBytes=text=>new TextEncoder().encode(text).byteLength;
export function readProtectedArchive(storage,key,{parse,empty,maxBytes=Infinity}={}){
  let raw=null;
  try{
    if(!storage)throw Error('浏览器存储不可用');
    raw=storage.getItem(key);
    if(raw===null||raw==='')return{value:typeof empty==='function'?empty():empty,raw:raw??null,protectedRaw:null,warning:null};
    if(storageBytes(raw)>maxBytes)throw Error('旧存档超过受支持容量');
    return{value:parse(raw),raw,protectedRaw:null,warning:null};
  }catch(error){return{value:typeof empty==='function'?empty():empty,raw,protectedRaw:raw,warning:String(error.message),readOnly:true};}
}
export function writeArchiveCandidate(storage,key,value,{parse,serialize=JSON.stringify,maxBytes=Infinity,protectedRaw=null,expectedRaw}={}){
  if(!storage)throw Error('浏览器存储不可用；仅本会话 / 未保存');
  if(protectedRaw!==null)throw Error('旧存档只读隔离；原文未覆盖，新成果仅本会话 / 未保存');
  const current=storage.getItem(key);
  if(expectedRaw!==undefined&&current!==expectedRaw)throw Error('另一页面已修改存档；未执行替换，请先导出当前成果并刷新');
  if(current){try{parse?.(current);}catch(error){throw Error('旧存档只读隔离，未覆盖：'+error.message);}}
  const raw=serialize(value);
  if(typeof raw!=='string'||storageBytes(raw)>maxBytes)throw Error('达到存档容量上限；旧存档未覆盖，新增成果仅本会话 / 未保存');
  parse?.(raw);
  storage.setItem(key,raw);
  // localStorage is atomic per key. A failed call cannot justify committing a
  // deletion in memory. No removeItem, fallback overwrite, or quota pruning.
  return{value,raw};
}
export class PersistenceState{
  constructor(warning='',protectedRaw=null){this.status=warning?'unsaved':'saved';this.message=warning;this.protectedRaw=protectedRaw;this.unsavedIds=new Set();}
  failed(error,ids=[]){this.status='unsaved';this.message=String(error?.message??error);for(const id of ids)this.unsavedIds.add(id);return this.snapshot();}
  saved(){this.status='saved';this.message='';this.unsavedIds.clear();return this.snapshot();}
  snapshot(){return{status:this.status,sessionOnly:this.status==='unsaved',message:this.message,unsavedIds:[...this.unsavedIds],protectedArchive:this.protectedRaw!==null};}
}
