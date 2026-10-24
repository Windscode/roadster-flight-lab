// One action registry drives keyboard, gamepad, help, rebinding and ingress logs.
// The stable 3.19 shell receives canonical events at this compatibility boundary;
// the journal explicitly distinguishes physical ingress from accepted actions.
const def=(id,label,en,code,keys,channel=null,sign=1)=>({id,label,en,code,keys,channel,sign});
export const inputKeyName=code=>code.replace(/^Key|^Digit/,'').replace('Space','SPACE').replace('ShiftLeft','SHIFT').replace('ShiftRight','R-SHIFT').replace('ArrowUp','↑').replace('ArrowDown','↓').replace('ArrowLeft','←').replace('ArrowRight','→');
export const actionKeyLabel=(id,profile=sharedInputs.profile)=>profile.keys[id].map(inputKeyName).join(' / ');
export const ACTIONS=Object.freeze([
  def('forward','前进','Forward','KeyW',['KeyW','ArrowUp'],'throttle'),
  def('reverse','后退 / 减速','Reverse / slow','KeyS',['KeyS','ArrowDown'],'throttle',-1),
  def('left','左转 / 偏航','Left / yaw','KeyA',['KeyA','ArrowLeft'],'steer'),
  def('right','右转 / 偏航','Right / yaw','KeyD',['KeyD','ArrowRight'],'steer',-1),
  def('brake','摩擦 + 再生制动','Blended brake','Space',['Space'],'brake'),
  def('liftUp','上升','Climb','KeyE',['KeyE'],'lift'),def('liftDown','下降','Descend','KeyQ',['KeyQ'],'lift',-1),
  def('rollLeft','手动左滚 / G 开时横移','Manual roll left / translate with G','KeyZ',['KeyZ'],'roll'),def('rollRight','手动右滚 / G 开时横移','Manual roll right / translate with G','KeyB',['KeyB'],'roll',-1),
  def('pitchUp','手动抬头（不是 U）','Manual pitch up (not U)','Digit1',['Digit1','Numpad1'],'pitch'),
  def('pitchDown','手动低头','Manual pitch down','Digit2',['Digit2','Numpad2'],'pitch',-1),
  def('boost','冷气加速','Cold-gas boost','ShiftLeft',['ShiftLeft','ShiftRight'],'boost'),
  def('level','自动回平开关','Level stabilization','KeyG',['KeyG']),def('flight','辅助飞行开关','Flight assist','KeyH',['KeyH']),
  def('autoRoll','自动完整滚转','Automatic roll','KeyX',['KeyX']),def('autoPitch','自动完整后翻','Automatic pitch flip','KeyU',['KeyU']),
  def('land','自动着陆','Automatic landing','KeyL',['KeyL']),def('pause','暂停 / 继续','Pause / resume','KeyP',['KeyP']),
  def('map','路线 / 地图','Route / map','KeyM',['KeyM']),def('camera','切换视角','Camera','KeyC',['KeyC']),
  def('reset','复位（结束本次）','Reset (ends run)','KeyR',['KeyR']),def('refill','补气（有限任务作废）','Refill (invalidates mission)','KeyT',['KeyT']),
  def('suction','吸附风扇','Suction fan','KeyF',['KeyF']),def('forces','力显示','Forces','KeyV',['KeyV']),
  def('radio','收音机','Radio','KeyJ',['KeyJ']),def('radioNext','下一曲','Next track','KeyK',['KeyK']),def('cinema','仪表显隐','Toggle HUD','F9',['F9']),
]);
const byId=new Map(ACTIONS.map(a=>[a.id,a])),clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
// 3–9 belong to research programs. Browser refresh/fullscreen/devtools remain
// native controls and cannot become hidden vehicle commands after rebinding.
const codeValid=code=>typeof code==='string'&&!/^(Digit|Numpad)[3-9]$/.test(code)&&!['F5','F11','F12'].includes(code)&&/^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|F([1-9]|1[012]))$/.test(code);
export const emptyAxes=()=>({throttle:0,steer:0,brake:0,lift:0,roll:0,pitch:0,boost:false,frontJets:0,rearJets:0});
export function defaultProfile(){return{schema:'roadster-actions-1',revision:0,keys:Object.fromEntries(ACTIONS.map(a=>[a.id,[...a.keys]])),
  axes:[{index:0,negative:'left',positive:'right'},{index:1,negative:'liftUp',positive:'liftDown'},{index:2,negative:'rollLeft',positive:'rollRight'}],
  buttons:{0:'brake',1:'boost',2:'autoRoll',3:'autoPitch',4:'pitchUp',5:'pitchDown',6:'reverse',7:'forward',8:'flight',9:'pause',10:'camera',11:'map',12:'level',13:'land'},
  calibration:{deviceId:null,deadzone:.13,axes:{},buttons:{}}};}
export function validateProfile(p){
  if(p?.schema!=='roadster-actions-1'||!Number.isInteger(p.revision)||p.revision<0||!p.keys||Object.keys(p.keys).length!==ACTIONS.length)throw Error('Unsupported input profile');
  const used=new Set();for(const a of ACTIONS){const list=p.keys[a.id];if(!Array.isArray(list)||!list.length||list.length>3)throw Error('Missing action binding');for(const code of list){if(!codeValid(code)||used.has(code))throw Error('Conflicting/reserved key: '+code);used.add(code);}}
  if(!Array.isArray(p.axes)||p.axes.length>8)throw Error('Invalid axis map');
  const indices=new Set();for(const a of p.axes){if(!Number.isInteger(a.index)||a.index<0||a.index>15||indices.has(a.index)||!byId.get(a.negative)?.channel||!byId.get(a.positive)?.channel)throw Error('Invalid axis binding');indices.add(a.index);}
  if(!p.buttons||Object.keys(p.buttons).length>32)throw Error('Invalid button map');
  for(const [index,id]of Object.entries(p.buttons))if(!/^\d+$/.test(index)||+index>31||!byId.has(id))throw Error('Invalid gamepad button');
  const c=p.calibration;if(!c||!Number.isFinite(c.deadzone)||c.deadzone<.02||c.deadzone>.4||!(c.deviceId===null||typeof c.deviceId==='string'&&c.deviceId.length<512)||!c.axes||!c.buttons)throw Error('Invalid calibration');
  if(Object.keys(c.axes).length>16||Object.keys(c.buttons).length>32)throw Error('Calibration too large');
  for(const [index,a]of Object.entries(c.axes))if(!/^\d+$/.test(index)||+index>15||!['min','max','center'].every(k=>Number.isFinite(a[k]))||a.min< -1.001||a.max>1.001||a.center-a.min<.15||a.max-a.center<.15)throw Error('Invalid calibrated axis');
  for(const [index,b]of Object.entries(c.buttons))if(!/^\d+$/.test(index)||+index>31||![b.min,b.max].every(Number.isFinite)||b.min<0||b.max>1||b.max-b.min<.5)throw Error('Invalid calibrated trigger');
  return structuredClone(p);
}
export function normalizeAxis(value,calibration=null,deadzone=.13){
  if(!Number.isFinite(value))return 0;
  const c=calibration??{center:0,min:-1,max:1},delta=value-c.center;
  const u=clamp(delta/(delta<0?c.center-c.min:c.max-c.center),-1,1);
  return Math.sign(u)*Math.max(0,(Math.abs(u)-deadzone)/(1-deadzone));
}
export class SemanticInput{
  constructor({profile=defaultProfile(),emit=()=>{},record=()=>{}}={}){
    this.profile=validateProfile(profile);this.emit=emit;this.record=record;this.physical=new Map();this.touches=new Map();this.blocked=new Set();this.events=[];this.sequence=0;this.dropped=0;
    this.padValues={};this.padPressed=new Set();this.padInhibited=true;this.padAxesInhibited=true;this.lastPad=null;this.enabled=true;this.releaseListeners=new Set();this.dispatchContext=null;
  }
  note(type,data={}){const e={sequence:++this.sequence,type,...data};this.events.push(structuredClone(e));if(this.events.length>1600){this.events.shift();this.dropped++;}this.record(e);return e;}
  actionForCode(code){return ACTIONS.find(a=>this.profile.keys[a.id].includes(code));}
  digitalHeld(id){return [...this.physical.values(),...this.touches.values()].includes(id);}
  dispatch(id,value,{source='keyboard',physical=null,repeat=false,emit=true}={}){
    const a=byId.get(id);if(!a)return;value=clamp(Number(value)||0);
    const detail={action:id,value,source,physical,profileRevision:this.profile.revision,phase:value>0?'down':'up',repeat};
    this.note('semantic-ingress',detail);
    if(emit){const previous=this.dispatchContext;this.dispatchContext=detail;try{this.emit(a,detail);}finally{this.dispatchContext=previous;}}
  }
  keyDown(code,{repeat=false}={}){
    const a=this.actionForCode(code);if(!a)return false;
    if(this.blocked.has(code)){this.note('input-suppressed',{code,reason:'release-required'});return true;}
    if(this.physical.has(code))return true;
    const already=this.digitalHeld(a.id);this.physical.set(code,a.id);
    if(!already)this.dispatch(a.id,1,{physical:code,repeat});return true;
  }
  keyUp(code){
    this.blocked.delete(code);const id=this.physical.get(code);this.physical.delete(code);
    if(id&&!this.digitalHeld(id))this.dispatch(id,0,{physical:code});
    return !!id||!!this.actionForCode(code);
  }
  touch(id,down,token=id){
    if(!byId.has(id))return false;
    if(down){if(this.touches.has(token))return true;const already=this.digitalHeld(id);this.touches.set(token,id);if(!already)this.dispatch(id,1,{source:'touch',physical:String(token)});}
    else{const held=this.touches.get(token);this.touches.delete(token);if(held&&!this.digitalHeld(held))this.dispatch(held,0,{source:'touch',physical:String(token)});}
    return true;
  }
  release(reason,{notify=true}={}){
    const held=[...new Set([...this.physical.values(),...this.touches.values(),...this.padPressed])];for(const code of this.physical.keys())this.blocked.add(code);this.physical.clear();this.touches.clear();
    this.padValues={};this.padPressed.clear();this.padInhibited=true;this.padAxesInhibited=true;
    this.note('semantic-release',{reason,held});
    // Accepted-input sessions capture their held keys before compatibility
    // keyups clear them; the release evidence must describe the prior state.
    if(notify)for(const fn of this.releaseListeners)fn(reason);
    for(const id of held)this.dispatch(id,0,{source:'release',physical:reason});
  }
  setProfile(profile){const next=validateProfile(profile);this.release('binding-change');this.profile=next;this.note('input-profile',{profile:this.getProfile()});}
  bindKey(id,code){if(!byId.has(id)||!codeValid(code))throw Error('Reserved or unsupported key');const p=this.getProfile();p.keys[id]=[code];p.revision++;this.setProfile(p);}
  bindButton(id,index){if(!byId.has(id))throw Error('Unknown action');const p=this.getProfile();for(const [key,value]of Object.entries(p.buttons))if(value===id)delete p.buttons[key];if(index!==null){if(!Number.isInteger(index)||index<0||index>31)throw Error('Button index must be 0–31');if(p.buttons[index])throw Error('Button is already assigned to '+p.buttons[index]);p.buttons[index]=id;}p.revision++;this.setProfile(p);}
  getProfile(){return structuredClone(this.profile);}
  readPad(pad){
    if(!pad?.connected)return{};
    const profile=this.profile,c=profile.calibration,useCalibration=c.deviceId===null||c.deviceId===pad.id,values={};
    for(const a of profile.axes){const v=normalizeAxis(pad.axes?.[a.index],useCalibration?c.axes[a.index]:null,c.deadzone);values[a.negative]=Math.max(values[a.negative]??0,-v);values[a.positive]=Math.max(values[a.positive]??0,v);}
    for(const [index,id]of Object.entries(profile.buttons)){
      const b=pad.buttons?.[index],raw=Number.isFinite(b?.value)?b.value:b?.pressed?1:0,cal=useCalibration?c.buttons[index]:null;
      const v=cal?clamp((raw-cal.min)/(cal.max-cal.min)):clamp(raw);values[id]=Math.max(values[id]??0,v);
    }
    return values;
  }
  poll(pad,{enabled=true,continuousEnabled=enabled}={}){
    const identity=pad?.connected?pad.index+':'+pad.id:null;
    if(this.lastPad!==null&&identity!==this.lastPad)this.release(identity?'gamepad-changed':'gamepad-disconnected');
    if(identity!==this.lastPad){this.padInhibited=true;this.note(identity?'gamepad-connected':'gamepad-disconnected',{device:identity});}this.lastPad=identity;
    if(identity===null){this.padValues={};this.padInhibited=true;this.padAxesInhibited=true;return;}
    const values=this.readPad(pad),neutral=Object.values(values).every(v=>v<.08);
    // Panels may keep discrete pause/map actions available, but a stick or
    // trigger held while editing must not become live when the panel closes.
    // Rearm continuous channels only after they have all returned to neutral.
    if(!continuousEnabled)this.padAxesInhibited=true;
    else if(ACTIONS.every(a=>!a.channel||(values[a.id]??0)<.08))this.padAxesInhibited=false;
    if(!enabled){if(this.padPressed.size||Object.values(this.padValues).some(v=>v>0))this.release('gamepad-input-disabled');this.padValues={};this.padInhibited=true;this.padAxesInhibited=true;return;}
    if(this.padInhibited){if(neutral)this.padInhibited=false;this.padValues={};return;}
    for(const a of ACTIONS){const value=values[a.id]??0,previous=this.padValues[a.id]??0;
      if(a.channel){if(Math.abs(value-previous)>.015||value===0&&previous!==0)this.dispatch(a.id,value,{source:'gamepad',physical:identity,emit:false});}
      else if(value>.55&&!this.padPressed.has(a.id)){this.padPressed.add(a.id);this.dispatch(a.id,1,{source:'gamepad',physical:identity});}
      else if(value<=.35&&this.padPressed.has(a.id)){this.padPressed.delete(a.id);this.dispatch(a.id,0,{source:'gamepad',physical:identity});}
      // A dispatched pause/reset may release input synchronously. Do not let
      // later buttons in the same sample reopen control or restore stale values.
      if(this.padInhibited)return;
    }
    this.padValues=values;
  }
  axes(keys,pad){
    const result=emptyAxes(),digital={},digitalChannels=new Set();
    // Canonical keys here are only those accepted by the existing shell. A
    // rebound physical key never bypasses its focus/replay/pause guards.
    for(const a of ACTIONS)if(a.channel){digital[a.id]=Number(a.keys.some(k=>keys.has(k)));if(digital[a.id])digitalChannels.add(a.channel);}
    const values=this.enabled&&!this.padInhibited&&!this.padAxesInhibited&&pad?.connected&&pad.index+':'+pad.id===this.lastPad?this.readPad(pad):{};
    // An accepted keyboard/touch command owns its whole channel. Opposing pad
    // drift must not weaken manual pitch, steering or braking.
    for(const a of ACTIONS)if(a.channel){const v=digitalChannels.has(a.channel)?digital[a.id]??0:values[a.id]??0;if(a.channel==='boost')result.boost||=v>.5;else result[a.channel]+=a.sign*v;}
    for(const key of ['throttle','steer','lift','roll','pitch'])result[key]=clamp(result[key],-1,1);result.brake=clamp(result.brake);return result;
  }
  export(){return{schema:'roadster-semantic-input-1',profile:this.getProfile(),droppedEvents:this.dropped,events:structuredClone(this.events),scope:'Ingress intent; accepted shell receipts and fixed-step inputs are recorded separately.'};}
}
export const sharedInputs=new SemanticInput();
export class GamepadCalibration{
  constructor(){this.cancel();}
  start(pad){if(!pad?.connected)throw Error('Connect a gamepad first');this.active=true;this.phase='center';this.device=pad.id;this.index=pad.index;this.samples=0;this.center=[];this.min=[];this.max=[];this.buttonMin=[];this.buttonMax=[];}
  sample(pad){
    if(!this.active)return false;
    if(!pad?.connected||pad.id!==this.device||pad.index!==this.index){this.cancel();return false;}
    const axes=pad.axes.map(v=>Number.isFinite(v)?clamp(v,-1,1):0);
    if(this.phase==='center'){
      axes.forEach((v,i)=>{this.center[i]=(this.center[i]??0)+v;this.min[i]=Math.min(this.min[i]??v,v);this.max[i]=Math.max(this.max[i]??v,v);});this.samples++;
      if(this.samples===90){if(this.max.some((v,i)=>v-this.min[i]>.1)){this.cancel();throw Error('Center was moving; release the sticks and retry');}
        this.center=this.center.map(v=>v/90);this.min=[...this.center];this.max=[...this.center];this.phase='range';this.samples=0;}
    }else{axes.forEach((v,i)=>{this.min[i]=Math.min(this.min[i]??v,v);this.max[i]=Math.max(this.max[i]??v,v);});pad.buttons.forEach((b,i)=>{const v=clamp(Number(b.value)||0);this.buttonMin[i]=Math.min(this.buttonMin[i]??v,v);this.buttonMax[i]=Math.max(this.buttonMax[i]??v,v);});this.samples++;}
    return true;
  }
  finish(profile){
    if(!this.active||this.phase!=='range'||this.samples<30)throw Error('Complete the center and range stages first');
    const p=structuredClone(profile);p.calibration.axes={};p.calibration.buttons={};p.calibration.deviceId=this.device;
    for(const a of p.axes){const i=a.index,c=this.center[i];if(!Number.isFinite(c)||c-this.min[i]<.25||this.max[i]-c<.25)throw Error('Move both ends of mapped axis '+i);p.calibration.axes[i]={center:c,min:this.min[i],max:this.max[i]};}
    for(const [i,min]of this.buttonMin.entries())if(this.buttonMax[i]-min>.5)p.calibration.buttons[i]={min,max:this.buttonMax[i]};
    p.revision++;const validated=validateProfile(p);this.cancel();return validated;
  }
  cancel(){this.active=false;this.phase='idle';this.samples=0;this.device=null;}
}
