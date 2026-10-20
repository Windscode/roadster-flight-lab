/* A data-only control graph. No source evaluation, callbacks, property access,
 * loops, network or global object are part of this language. */
import {contentLabel} from './experiment-records.js';
export const HEIGHT_INTERFACE='height-outer-acceleration-1';
export const HEIGHT_LIMITS=Object.freeze({physicsHz:120,maxNodes:80,maxDepth:14,maxBytes:12000,stateSlots:4,operations:96,maxAccelerationMps2:6,maxSlewMps3:30,maxState:20});
const INPUTS=Object.freeze(['error','height','targetHeight','verticalSpeed','time','dt']);
const clone=x=>JSON.parse(JSON.stringify(x)),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const C=value=>({op:'const',value}),I=name=>({op:'input',name}),M=(a,b)=>({op:'mul',args:[a,b]}),A=(a,b)=>({op:'add',args:[a,b]});
export const HEIGHT_TEMPLATES=Object.freeze({
  pd:Object.freeze({schema:'roadster.height-controller',version:1,name:'PD / height outer loop',interfaceVersion:HEIGHT_INTERFACE,controlHz:60,outputLimit:6,slewLimit:18,root:{op:'sub',args:[M(C(3.2),I('error')),M(C(3.6),I('verticalSpeed'))]}}),
  filteredPI:Object.freeze({schema:'roadster.height-controller',version:1,name:'PI + filtered velocity',interfaceVersion:HEIGHT_INTERFACE,controlHz:60,outputLimit:6,slewLimit:18,root:{op:'sub',args:[A(M(C(2.6),I('error')),M(C(.35),{op:'integrate',slot:0,limit:2,input:I('error')})),M(C(3.4),{op:'filter',slot:1,tau:.08,input:I('verticalSpeed')})]}}),
});
function object(v,path){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error(path+': expected plain object');for(const key of Reflect.ownKeys(v)){const descriptor=Object.getOwnPropertyDescriptor(v,key);if(!descriptor||!('value'in descriptor))throw Error(path+': data fields only');}}
function keys(v,allowed,path){for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!allowed.includes(k))throw Error(path+': illegal field '+String(k));if(!d||!('value'in d)||!d.enumerable)throw Error(path+': data fields only');}for(const k of allowed)if(!Object.hasOwn(v,k))throw Error(path+': missing field '+k);}
function array(v,length,path){if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length!==length)throw Error(path+': dense fixed-size array required');const allowed=new Set(['length',...Array.from({length},(_,i)=>String(i))]);for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!allowed.has(k)||!d||!('value'in d))throw Error(path+': data array only');}for(let i=0;i<length;i++)if(!Object.hasOwn(v,String(i)))throw Error(path+': sparse arrays are not allowed');}
function number(v,min,max,path){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(path+': finite number required in ['+min+', '+max+']');return v;}
export function validateHeightAlgorithm(value){
  object(value,'algorithm');keys(value,['schema','version','name','interfaceVersion','controlHz','outputLimit','slewLimit','root'],'algorithm');
  if(value.schema!=='roadster.height-controller'||value.version!==1||value.interfaceVersion!==HEIGHT_INTERFACE)throw Error('Unsupported height-control interface/version');
  if(typeof value.name!=='string'||!value.name.trim()||value.name.length>80||/[\u0000-\u001f]/.test(value.name))throw Error('Controller name must be 1–80 visible characters');
  if(![10,20,30,40,60,120].includes(value.controlHz))throw Error('Control frequency must divide 120 Hz exactly');
  number(value.outputLimit,.1,HEIGHT_LIMITS.maxAccelerationMps2,'outputLimit');number(value.slewLimit,.1,HEIGHT_LIMITS.maxSlewMps3,'slewLimit');
  const slots=new Set();let count=0;
  function node(v,depth=0){
    if(++count>HEIGHT_LIMITS.maxNodes||depth>HEIGHT_LIMITS.maxDepth)throw Error('Control graph node/depth budget exceeded');object(v,'node');if(typeof v.op!=='string')throw Error('Control operator must be a string');
    if(v.op==='const'){keys(v,['op','value'],'const');number(v.value,-1000,1000,'constant');}
    else if(v.op==='input'){keys(v,['op','name'],'input');if(!INPUTS.includes(v.name))throw Error('Illegal observation: '+v.name);}
    else if(['add','sub','mul','div','min','max'].includes(v.op)){keys(v,['op','args'],v.op);array(v.args,2,'binary arguments');v.args.forEach(child=>node(child,depth+1));}
    else if(v.op==='clamp'){keys(v,['op','input','min','max'],'clamp');number(v.min,-1000,1000,'min');number(v.max,v.min,1000,'max');node(v.input,depth+1);}
    else if(v.op==='integrate'||v.op==='filter'){
      keys(v,v.op==='integrate'?['op','slot','limit','input']:['op','slot','tau','input'],v.op);
      if(!Number.isInteger(v.slot)||v.slot<0||v.slot>=HEIGHT_LIMITS.stateSlots||slots.has(v.slot))throw Error('State slot must be unique and in 0–3');slots.add(v.slot);
      if(v.op==='integrate')number(v.limit,.001,HEIGHT_LIMITS.maxState,'integral limit');else number(v.tau,.005,5,'filter time constant');node(v.input,depth+1);
    }else throw Error('Illegal control node: '+String(v.op));
  }
  node(value.root);if(new TextEncoder().encode(JSON.stringify(value)).length>HEIGHT_LIMITS.maxBytes)throw Error('Control graph text budget exceeded');
  const algorithm=clone(value);return{algorithm,hash:contentLabel(algorithm),nodeCount:count,stateSlots:[...slots],interfaceVersion:HEIGHT_INTERFACE,controlHz:value.controlHz,divisor:120/value.controlHz};
}
export function parseHeightAlgorithm(text){if(typeof text!=='string'||text.length>HEIGHT_LIMITS.maxBytes||new TextEncoder().encode(text).length>HEIGHT_LIMITS.maxBytes)throw Error('Control graph text budget exceeded');let value;try{value=JSON.parse(text);}catch{throw Error('Controller must be valid JSON data, never JavaScript');}return validateHeightAlgorithm(value);}
export function validateHeightState(state,definition,{allowFault=true}={}){
  object(state,'controller state');keys(state,['interfaceVersion','hash','states','lastOutput','lastStep','fault'],'controller state');array(state.states,HEIGHT_LIMITS.stateSlots,'controller states');
  const limits=Array(HEIGHT_LIMITS.stateSlots).fill(0);function slots(node){if(node.op==='integrate'||node.op==='filter')limits[node.slot]=node.op==='integrate'?node.limit:HEIGHT_LIMITS.maxState;if(node.input)slots(node.input);if(node.args)node.args.forEach(slots);}slots(definition.algorithm.root);
  if(state.interfaceVersion!==HEIGHT_INTERFACE||state.hash!==definition.hash||state.states.some((v,i)=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>limits[i])||typeof state.lastOutput!=='number'||!Number.isFinite(state.lastOutput)||Math.abs(state.lastOutput)>definition.algorithm.outputLimit||state.lastStep!==null&&(!Number.isSafeInteger(state.lastStep)||state.lastStep<0||state.lastStep%definition.divisor!==0))throw Error('Controller state does not match bounded interface/hash');
  if(state.fault!==null){
    if(!allowFault)throw Error('Nested controller faults are not allowed');const fault=state.fault;object(fault,'controller fault');keys(fault,['step','timeS','code','reason','operations','lastValidState'],'controller fault');
    if(!Number.isSafeInteger(fault.step)||fault.step<0||fault.timeS!==fault.step/120||fault.code!=='height-controller-disabled'||typeof fault.reason!=='string'||fault.reason.length>512||!Number.isInteger(fault.operations)||fault.operations<0||fault.operations>HEIGHT_LIMITS.operations+1)throw Error('Invalid controller fault payload');
    validateHeightState(fault.lastValidState,definition,{allowFault:false});if(fault.lastValidState.lastOutput!==state.lastOutput||fault.lastValidState.lastStep!==state.lastStep||fault.lastValidState.states.some((v,i)=>v!==state.states[i]))throw Error('Fault last-valid state does not match the retained controller state');
  }
  return clone(state);
}
export class BoundedHeightController{
  constructor(algorithm,{state=null}={}){this.definition=validateHeightAlgorithm(algorithm);this.states=Array(HEIGHT_LIMITS.stateSlots).fill(0);this.lastOutput=0;this.lastStep=null;this.fault=null;if(state)this.importState(state);}
  exportState(){return{interfaceVersion:HEIGHT_INTERFACE,hash:this.definition.hash,states:[...this.states],lastOutput:this.lastOutput,lastStep:this.lastStep,fault:this.fault?clone(this.fault):null};}
  importState(state){const valid=validateHeightState(state,this.definition);this.states=valid.states;this.lastOutput=valid.lastOutput;this.lastStep=valid.lastStep;this.fault=valid.fault;}
  tick(observation,step){
    if(!Number.isSafeInteger(step)||step<0)throw Error('Control step must be a non-negative safe integer');if(this.fault)return{active:false,fault:clone(this.fault)};
    if(step===this.lastStep)return{active:true,updated:false,output:this.lastOutput,step};
    const before=this.exportState(),dt=1/this.definition.controlHz,inputs={dt};let operations=0;const next=[...this.states];
    try{
      if(this.lastStep!==null&&step<this.lastStep)throw Error('Control step moved backwards');
      if(this.lastStep===null&&step!==0||this.lastStep!==null&&step>this.lastStep+this.definition.divisor)throw Error('Missing declared control decision step');
      if(step%this.definition.divisor!==0)return{active:true,updated:false,output:this.lastOutput,step};
      object(observation,'observation');keys(observation,INPUTS.filter(name=>name!=='dt'),'observation');for(const name of INPUTS)if(name!=='dt'){if(typeof observation[name]!=='number'||!Number.isFinite(observation[name]))throw Error('Non-finite observation: '+name);inputs[name]=observation[name];}
      const evaluate=node=>{
        if(++operations>HEIGHT_LIMITS.operations)throw Error('Control operation budget exceeded');let result;
        if(node.op==='const')result=node.value;
        else if(node.op==='input')result=inputs[node.name];
        else if(node.op==='clamp')result=clamp(evaluate(node.input),node.min,node.max);
        else if(node.op==='integrate'){result=clamp(this.states[node.slot]+evaluate(node.input)*dt,-node.limit,node.limit);next[node.slot]=result;}
        else if(node.op==='filter'){result=clamp(this.states[node.slot]+(evaluate(node.input)-this.states[node.slot])*(dt/(node.tau+dt)),-HEIGHT_LIMITS.maxState,HEIGHT_LIMITS.maxState);next[node.slot]=result;}
        else{const a=evaluate(node.args[0]),b=evaluate(node.args[1]);if(node.op==='add')result=a+b;else if(node.op==='sub')result=a-b;else if(node.op==='mul')result=a*b;else if(node.op==='div'){if(Math.abs(b)<1e-9)throw Error('Division denominator below 1e-9');result=a/b;}else if(node.op==='min')result=Math.min(a,b);else result=Math.max(a,b);}
        if(!Number.isFinite(result)||Math.abs(result)>1e9)throw Error('Non-finite or excessive intermediate value');return result;
      };
      const raw=evaluate(this.definition.algorithm.root),limited=clamp(raw,-this.definition.algorithm.outputLimit,this.definition.algorithm.outputLimit),delta=this.definition.algorithm.slewLimit*dt,output=clamp(limited,this.lastOutput-delta,this.lastOutput+delta);
      this.states=next;this.lastStep=step;this.lastOutput=output;return{active:true,updated:true,step,inputs,raw,limited,output,saturated:Math.abs(raw-output)>1e-10,operations,stateBefore:before,stateAfter:this.exportState()};
    }catch(error){this.fault={step,timeS:step/120,code:'height-controller-disabled',reason:String(error.message).slice(0,512),operations,lastValidState:before};return{active:false,updated:true,fault:clone(this.fault)};}
  }
}
