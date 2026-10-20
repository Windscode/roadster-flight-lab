const now=()=>globalThis.performance?.now?.()??Date.now();
const cancelled=()=>Object.assign(new Error('Export cancelled'),{name:'AbortError'});
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
const check=signal=>{if(signal?.aborted)throw cancelled();};
const unsupported=value=>value===undefined||typeof value==='function'||typeof value==='symbol';

function jsonValue(value,key){
  if(value!==null&&(typeof value==='object'||typeof value==='bigint')&&typeof value.toJSON==='function')value=value.toJSON(key);
  const tag=Object.prototype.toString.call(value);
  if(['[object Number]','[object String]','[object Boolean]','[object BigInt]'].includes(tag))value=value.valueOf();
  return value;
}
function* tokens(value,ancestors=new Set(),key='',prepared=false){
  if(!prepared)value=jsonValue(value,key);
  if(typeof value==='bigint')throw new TypeError('BigInt cannot be exported as JSON');
  if(!value||typeof value!=='object'){yield JSON.stringify(value)??'null';return;}
  if(ancestors.has(value))throw new TypeError('Circular reference in export data');
  ancestors.add(value);
  if(Array.isArray(value)){
    yield '[';const length=value.length;
    for(let i=0;i<length;i++){if(i)yield ',';yield* tokens(unsupported(value[i])?null:value[i],ancestors,String(i));}
    yield ']';
  }else{
    yield '{';let first=true;
    for(const k of Object.keys(value)){
      const item=jsonValue(value[k],k);
      if(unsupported(item))continue;
      if(!first)yield ',';first=false;yield JSON.stringify(k)+':';yield* tokens(item,ancestors,k,true);
    }
    yield '}';
  }
  ancestors.delete(value);
}

export async function encodeJsonChunks(value,{signal,onProgress=()=>{},yieldTurn=turn,budgetMs=7,chunkChars=65536}={}){
  const parts=[];let pending='',characters=0,visited=0,lastYield=now();
  check(signal);
  value=jsonValue(value,'');if(unsupported(value))throw new TypeError('No JSON data to export');
  for(const token of tokens(value,new Set(),'',true)){
    check(signal);pending+=token;visited++;
    if(pending.length>=chunkChars){characters+=pending.length;parts.push(pending);pending='';}
    if((visited&255)===0&&now()-lastYield>=budgetMs){onProgress({characters:characters+pending.length,visited});await yieldTurn();check(signal);lastYield=now();}
  }
  if(pending){characters+=pending.length;parts.push(pending);}
  onProgress({characters,visited});check(signal);return{parts,characters,visited};
}

