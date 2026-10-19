// User-facing command preference only. A restored experiment keeps the value
// in its snapshot; changing this setting is a recorded public setParam command.
export const VERTICAL_RESPONSE=Object.freeze({key:'roadster-vertical-speed',min:.5,max:8,step:.1,default:3,unit:'m/s'});
export function readVerticalResponse(storage){
  try{storage??=globalThis.localStorage;const raw=storage?.getItem(VERTICAL_RESPONSE.key),value=Number(raw);if(raw!==null&&raw!==undefined&&Number.isFinite(value)&&value>=VERTICAL_RESPONSE.min&&value<=VERTICAL_RESPONSE.max)return value;}catch{}
  return VERTICAL_RESPONSE.default;
}
export function saveVerticalResponse(value,storage){
  const n=Number(value);if(!Number.isFinite(n)||n<VERTICAL_RESPONSE.min||n>VERTICAL_RESPONSE.max)throw new RangeError('Vertical speed outside 0.5–8 m/s');
  try{storage??=globalThis.localStorage;storage?.setItem(VERTICAL_RESPONSE.key,String(n));}catch{}
  return n;
}
