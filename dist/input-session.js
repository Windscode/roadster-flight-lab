// All ingress events and releases share one journal. Nothing here injects a
// physics state. Browser events and fixed-step accepted inputs remain distinct.
export class InputSession{
  constructor({keys=new Set(),onRelease=()=>{},onEvent=()=>{},capacity=2400}={}){this.keys=keys;this.onRelease=onRelease;this.onEvent=onEvent;this.capacity=capacity;this.events=[];this.serial=0;this.dropped=0;this.lastStepInput='';this.traceUntil=0;}
  note(type,detail={}){const event={sequence:++this.serial,wallTimeMs:typeof performance!=='undefined'?performance.now():0,type,...detail,pressed:[...this.keys].sort()};this.events.push(event);if(this.events.length>this.capacity){this.events.shift();this.dropped++;}if(type!=='physics-input')this.onEvent(event);return event;}
  get tracing(){return (typeof performance!=='undefined'?performance.now():0)<this.traceUntil;}
  armTrace(seconds=20){this.traceUntil=performance.now()+Math.min(20,Math.max(1,seconds))*1000;}
  down(event,accepted=true,reason='pilot'){if(accepted){this.keys.add(event.code);if(['KeyE','KeyQ','Digit1','Digit2','Numpad1','Numpad2'].includes(event.code))this.armTrace();}return this.note('keydown',{code:event.code,repeat:!!event.repeat,accepted,reason});}
  up(event){this.keys.delete(event.code);return this.note('keyup',{code:event.code,repeat:!!event.repeat});}
  release(reason,{pause=false}={}){const released=[...this.keys].sort();this.keys.clear();this.note('input-release',{reason,released,pause});this.onRelease(reason,{pause});}
  step(t,input){{this.note('physics-input',{step:Math.round(t.simTime*120),simTime:t.simTime,input:{...input},mode:t.mode,stabilization:t.stabilizationMode,pilotIntent:t.pilotIntent??null,reference:t.reference,desiredWrench:t.desiredWrench,achievedWrench:t.achievedWrench});}}
  export(identity={}){return{schema:'roadster-input-session',version:1,identity,source:'received-browser-events-and-actual-fixed-step-inputs',capacity:this.capacity,physicsTracePolicy:'120 Hz during the 20 s window after E/Q/1/2; other keyboard events remain recorded. A rolling journal, not an entire long-drive archive.',droppedEvents:this.dropped,events:JSON.parse(JSON.stringify(this.events))};}
}
