// User-facing command preference only. A restored experiment keeps the value
// in its snapshot; changing this setting is a recorded public setParam command.
export const VERTICAL_RESPONSE=Object.freeze({key:'roadster-vertical-speed',min:.5,max:14,step:.1,default:5,unit:'m/s'});
export const CONTROL_RESPONSE_PREFERENCE_KEY='roadster-control-response-v1';
export const CONTROL_RESPONSES=Object.freeze({
  verticalAccelerationMps2:Object.freeze({min:1,max:10,step:.5,default:5,unit:'m/s²'}),
  rollRateDegS:Object.freeze({min:15,max:360,step:5,default:180,unit:'°/s'}),
  pitchRateDegS:Object.freeze({min:5,max:120,step:5,default:60,unit:'°/s'}),
  angularAccelerationDegS2:Object.freeze({min:20,max:720,step:10,default:360,unit:'°/s²'}),
});
export function readVerticalResponse(storage){
  try{storage??=globalThis.localStorage;const raw=storage?.getItem(VERTICAL_RESPONSE.key),value=Number(raw);if(raw!==null&&raw!==undefined&&Number.isFinite(value)&&value>=VERTICAL_RESPONSE.min&&value<=VERTICAL_RESPONSE.max)return value;}catch{}
  return VERTICAL_RESPONSE.default;
}
export function saveVerticalResponse(value,storage){
  const n=Number(value);if(!Number.isFinite(n)||n<VERTICAL_RESPONSE.min||n>VERTICAL_RESPONSE.max)throw new RangeError('Vertical speed outside 0.5–14 m/s');
  try{storage??=globalThis.localStorage;storage?.setItem(VERTICAL_RESPONSE.key,String(n));}catch{}
  return n;
}
export function readControlResponses(storage){
  const values=Object.fromEntries(Object.entries(CONTROL_RESPONSES).map(([key,definition])=>[key,definition.default]));
  try{
    storage??=globalThis.localStorage;
    const saved=JSON.parse(storage?.getItem(CONTROL_RESPONSE_PREFERENCE_KEY)||'{}');
    for(const [key,definition]of Object.entries(CONTROL_RESPONSES)){
      const value=saved?.[key];
      if(typeof value==='number'&&Number.isFinite(value)&&value>=definition.min&&value<=definition.max)values[key]=value;
    }
  }catch{}
  return values;
}
export function saveControlResponse(key,value,storage){
  const definition=CONTROL_RESPONSES[key],number=Number(value);
  if(!definition||!Number.isFinite(number)||number<definition.min||number>definition.max)throw new RangeError('Control response outside its declared range: '+key);
  const values=readControlResponses(storage);values[key]=number;
  try{storage??=globalThis.localStorage;storage?.setItem(CONTROL_RESPONSE_PREFERENCE_KEY,JSON.stringify(values));}catch{}
  return number;
}
