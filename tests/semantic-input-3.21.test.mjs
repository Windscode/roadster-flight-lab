import assert from 'node:assert/strict';
import {SemanticInput,GamepadCalibration,defaultProfile,normalizeAxis,validateProfile,sharedInputs} from '../dist/semantic-input.js';
import {InputSession} from '../dist/input-session.js';
const accepted=new Set(),events=[];
const input=new SemanticInput({emit:(a,e)=>{events.push(e);if(e.value)accepted.add(a.code);else accepted.delete(a.code);}});
for(const order of [['KeyW','KeyE','Digit1'],['Digit1','KeyW','KeyE'],['KeyE','Digit1','KeyW']]){for(const code of order)input.keyDown(code);assert.deepEqual(input.axes(accepted,null),{throttle:1,steer:0,brake:0,lift:1,roll:0,pitch:1,boost:false,frontJets:0,rearJets:0});for(const code of order.toReversed())input.keyUp(code);assert.equal(accepted.size,0);}
assert(!events.some(e=>e.action==='autoPitch'));
input.keyDown('KeyW');input.keyDown('ArrowUp');input.keyUp('KeyW');assert(accepted.has('KeyW'));input.keyUp('ArrowUp');assert(!accepted.size);
input.bindKey('forward','KeyO');input.keyDown('KeyW');assert(!accepted.size);input.keyDown('KeyO');assert(accepted.has('KeyW'));input.release('blur');assert(!accepted.size);input.keyDown('KeyO',{repeat:true});assert(!accepted.size);input.keyUp('KeyO');input.keyDown('KeyO');assert(accepted.has('KeyW'));input.keyUp('KeyO');
assert.throws(()=>input.bindKey('forward','KeyE'));assert.throws(()=>input.bindKey('forward','Escape'));
const pad={connected:true,id:'fixture',index:0,axes:[0,0,0],buttons:Array.from({length:14},()=>({value:0}))};input.poll(pad);input.poll(pad);pad.buttons[7].value=.7;input.poll(pad);assert.equal(input.axes(accepted,pad).throttle,.7);input.poll(null);assert.equal(input.axes(accepted,pad).throttle,0);input.poll(pad);assert.equal(input.axes(accepted,pad).throttle,0);pad.buttons[7].value=0;input.poll(pad);pad.buttons[7].value=.7;input.poll(pad);assert.equal(input.axes(accepted,pad).throttle,.7);
assert.equal(normalizeAxis(.04,{center:.04,min:-.8,max:.9},.13),0);assert.equal(normalizeAxis(.9,{center:.04,min:-.8,max:.9},.13),1);
const cal=new GamepadCalibration();cal.start(pad);for(let i=0;i<90;i++)cal.sample(pad);assert.equal(cal.phase,'range');for(let i=0;i<40;i++){pad.axes=[i%2?-1:1,i%2?-1:1,i%2?-1:1];cal.sample(pad);}const p=cal.finish(defaultProfile());assert.equal(p.calibration.deviceId,'fixture');assert(!cal.active);cal.start(pad);cal.cancel();assert.equal(cal.sample(pad),false);cal.start(pad);cal.sample(null);assert(!cal.active);
for(const code of ['Digit3','Digit9','Numpad3','Numpad9','F5','F11','F12']){
  assert.throws(()=>input.bindKey('forward',code));
  const invalid=defaultProfile();invalid.keys.forward=[code];assert.throws(()=>validateProfile(invalid));
}
assert.deepEqual(validateProfile(JSON.parse(JSON.stringify(input.getProfile()))),input.getProfile(),'profile round-trips without losing remapping');
const beforeConflict=input.getProfile();assert.throws(()=>input.bindButton('forward',0));assert.deepEqual(input.getProfile(),beforeConflict,'conflict must not partially mutate profile');

// Connecting an already held trigger/automatic action must wait for neutral.
const padEvents=[],fresh=new SemanticInput({emit:(a,e)=>padEvents.push({...e})});
const freshPad={connected:true,id:'held-at-connect',index:2,axes:[0,0,0],buttons:Array.from({length:14},()=>({value:0}))};
freshPad.buttons[7].value=.9;freshPad.buttons[2].value=1;
assert.equal(fresh.axes(new Set(),freshPad).throttle,0);
fresh.poll(freshPad);fresh.poll(freshPad);assert.equal(fresh.axes(new Set(),freshPad).throttle,0);assert.equal(padEvents.length,0);
freshPad.buttons[7].value=0;freshPad.buttons[2].value=0;fresh.poll(freshPad);
for(const value of [.7,.5,.6,.4,.7]){freshPad.buttons[2].value=value;fresh.poll(freshPad);}
assert.equal(padEvents.filter(e=>e.action==='autoRoll'&&e.value===1).length,1,'button jitter does not retrigger a maneuver');
freshPad.buttons[2].value=.3;fresh.poll(freshPad);freshPad.buttons[2].value=.7;fresh.poll(freshPad);
assert.equal(padEvents.filter(e=>e.action==='autoRoll'&&e.value===1).length,2);
fresh.release('pause');assert(!fresh.padPressed.size);assert.equal(fresh.axes(new Set(),freshPad).throttle,0);
fresh.poll(freshPad);assert.equal(padEvents.filter(e=>e.action==='autoRoll'&&e.value===1).length,2);
freshPad.buttons[2].value=0;fresh.poll(freshPad);freshPad.buttons[7].value=.9;fresh.poll(freshPad);
assert.equal(fresh.axes(new Set(),freshPad).throttle,.9);
const replacement={...freshPad,id:'another-device'};assert.equal(fresh.axes(new Set(),replacement).throttle,0,'unpolled device cannot inherit authorization');
fresh.poll(replacement);assert.equal(fresh.axes(new Set(),replacement).throttle,0);

// A synchronous pause from the shell stops this entire controller sample.
let pausedInput;const pauseEvents=[];
pausedInput=new SemanticInput({emit:(a,e)=>{pauseEvents.push(e);if(a.id==='pause'&&e.value)pausedInput.release('menu-open');}});
const menuPad={...freshPad,id:'menu-pad',buttons:Array.from({length:14},()=>({value:0}))};pausedInput.poll(menuPad);
menuPad.buttons[9].value=1;menuPad.buttons[10].value=1;pausedInput.poll(menuPad);
assert(!pauseEvents.some(e=>e.action==='camera'&&e.value),'buttons after a pause do not change the vehicle');

// Keyboard and multiple touch pointers own one accepted action jointly.
const touchKeys=new Set(),touchEvents=[],touchInput=new SemanticInput({emit:(a,e)=>{touchEvents.push(e);if(e.value)touchKeys.add(a.code);else touchKeys.delete(a.code);}});
touchInput.keyDown('KeyW');touchInput.touch('forward',true,1);touchInput.touch('forward',true,2);touchInput.keyUp('KeyW');assert(touchKeys.has('KeyW'));
touchInput.touch('forward',false,1);assert(touchKeys.has('KeyW'));touchInput.touch('forward',false,2);assert(!touchKeys.size);
touchInput.touch('pitchUp',true,3);assert.equal(touchInput.axes(touchKeys,null).pitch,1);touchInput.release('reset');assert(!touchKeys.size);touchInput.touch('pitchUp',false,3);assert(!touchKeys.size);
assert(touchEvents.some(e=>e.source==='touch'&&e.action==='pitchUp'));
const listenerCount=sharedInputs.releaseListeners.size,session=new InputSession();assert.equal(sharedInputs.releaseListeners.size,listenerCount+1);session.dispose();assert.equal(sharedInputs.releaseListeners.size,listenerCount);
// Real browser compatibility events synchronously clear accepted key state.
// The release receipt must still list the input that existed before release.
const receiptSession=new InputSession();sharedInputs.emit=(a,e)=>e.value?receiptSession.down({code:a.code}):receiptSession.up({code:a.code});
for(const route of ['session','router']){sharedInputs.keyDown('KeyW');if(route==='session')receiptSession.release('pause');else sharedInputs.release('window-blur');assert.deepEqual(receiptSession.events.filter(e=>e.type==='input-release').at(-1).released,['KeyW']);assert.equal(receiptSession.keys.size,0);sharedInputs.keyUp('KeyW');}
receiptSession.dispose();sharedInputs.emit=()=>{};
console.log(JSON.stringify({status:'passed',cases:['W+E+1 permutations','alias releases','rebind/conflict and reserved keys','profile round-trip','blur hold latch','first-connect and reconnect neutral gate','gamepad action hysteresis','synchronous pause stops sample','keyboard/touch ownership','axis normalization','center/range calibration','cancel/disconnect stops sampling','session listener cleanup'],events:events.length}));
