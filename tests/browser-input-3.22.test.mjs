import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installBrowserInput} from '../dist/browser-input.js';
import {sharedInputs,defaultProfile} from '../dist/semantic-input.js';
import {InputSession} from '../dist/input-session.js';

const require=createRequire(import.meta.url),{JSDOM}=require(process.env.JSDOM_MODULE_PATH||'jsdom');
const dom=new JSDOM('<main tabindex="0" id="viewport"></main><input id="editor">',{url:'https://input.fixture.invalid/',pretendToBeVisual:true});
const win=dom.window,doc=win.document,frames=new Map();let next=0,currentPad=null;
win.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};win.cancelAnimationFrame=id=>frames.delete(id);
Object.defineProperty(win.navigator,'getGamepads',{value:()=>currentPad?[currentPad]:[]});
const frame=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
sharedInputs.setProfile(defaultProfile());sharedInputs.blocked.clear();
const ui=installBrowserInput({studyOpen:false},{win,doc}),session=new InputSession(),commands=[];
// This is the legacy raw-code compatibility boundary used by main.js. The
// production adapter must keep native shortcut events out of that boundary.
win.addEventListener('keydown',event=>{commands.push(event.code);session.down(event);event.preventDefault();});
win.addEventListener('keyup',event=>session.up(event));
const key=(code,options={})=>{const event=new win.KeyboardEvent(options.type??'keydown',{code,bubbles:true,cancelable:true,...options});doc.getElementById('viewport').dispatchEvent(event);return event;};
try{
  for(const modifier of ['ctrlKey','metaKey','altKey'])for(const code of ['KeyR','KeyF','KeyW','Digit3']){
    const count=commands.length,event=key(code,{[modifier]:true});
    assert.equal(commands.length,count,modifier+' '+code+' must not reach vehicle/research actions');
    assert.equal(event.defaultPrevented,false,'Native shortcut behavior remains available');
    key(code,{type:'keyup',[modifier]:true});
  }
  for(const code of ['KeyW','KeyE','Digit1'])key(code);
  assert.deepEqual([sharedInputs.axes(session.keys).throttle,sharedInputs.axes(session.keys).lift,sharedInputs.axes(session.keys).pitch],[1,1,1]);
  // A modifier-qualified release must still clear its already accepted key.
  key('KeyW',{type:'keyup',ctrlKey:true});assert(!session.keys.has('KeyW'));
  key('KeyE',{type:'keyup'});key('Digit1',{type:'keyup'});
  key('ShiftLeft',{shiftKey:true});key('KeyW',{shiftKey:true});
  assert.equal(sharedInputs.axes(session.keys).throttle,1);assert.equal(sharedInputs.axes(session.keys).boost,true,'Shift remains a driving control');
  key('KeyW',{type:'keyup'});key('ShiftLeft',{type:'keyup'});
  currentPad={connected:true,index:0,id:'browser-panel-fixture',axes:[0,0,0],buttons:Array.from({length:14},()=>({value:0}))};frame();
  currentPad.buttons[7].value=.8;frame();assert.equal(sharedInputs.axes(session.keys,currentPad).throttle,.8);
  doc.body.classList.add('body-menu');frame();assert.equal(sharedInputs.axes(session.keys,currentPad).throttle,0);
  doc.body.classList.remove('body-menu');frame();assert.equal(sharedInputs.axes(session.keys,currentPad).throttle,0,'Menu close does not revive the held trigger');
  currentPad.buttons[7].value=0;frame();currentPad.buttons[7].value=.8;frame();assert.equal(sharedInputs.axes(session.keys,currentPad).throttle,.8);
  doc.getElementById('editor').focus();frame();doc.getElementById('viewport').focus();frame();
  assert.equal(sharedInputs.axes(session.keys,currentPad).throttle,0,'Leaving an editor also requires neutral');
  currentPad.buttons[7].value=0;frame();currentPad.buttons[7].value=.8;frame();assert.equal(sharedInputs.axes(session.keys,currentPad).throttle,.8);
  console.log(JSON.stringify({status:'passed',scope:'Production browser adapter and semantic router in JSDOM, with explicit raw-code shell boundary. No native keyboard/device claim.',cases:['Ctrl/Meta/Alt native shortcuts','research shortcut isolation','modifier keyup releases accepted input','W+E+1 combinations','Shift boost preserved','DOM menu and editing neutral rearm']}));
}finally{ui.dispose();session.dispose();sharedInputs.setProfile(defaultProfile());sharedInputs.blocked.clear();dom.window.close();}
