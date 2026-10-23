import assert from 'node:assert/strict';
import {SemanticInput} from '../dist/semantic-input.js';

const actions=[],input=new SemanticInput({emit:(_action,event)=>actions.push(event)});
const pad={connected:true,index:0,id:'panel-transition-fixture',axes:[0,0,0],buttons:Array.from({length:14},()=>({value:0}))};
input.poll(pad);
pad.buttons[7].value=.8;input.poll(pad);assert.equal(input.axes(new Set(),pad).throttle,.8);
// The panel masks continuous controls but still permits pause/map buttons.
input.enabled=false;input.poll(pad,{continuousEnabled:false});
pad.buttons[9].value=1;input.poll(pad,{continuousEnabled:false});
assert(actions.some(event=>event.action==='pause'&&event.value===1),'A controller can close its menu');
input.enabled=true;input.poll(pad,{continuousEnabled:true});
assert.equal(input.axes(new Set(),pad).throttle,0,'A trigger held through a panel must not reapply on return');
pad.buttons[7].value=0;input.poll(pad,{continuousEnabled:true});
pad.buttons[7].value=.8;input.poll(pad,{continuousEnabled:true});
assert.equal(input.axes(new Set(),pad).throttle,.8,'Fresh trigger input after neutral is accepted');

// Neutral is required for every continuous channel, not just the throttle.
input.enabled=false;input.poll(pad,{continuousEnabled:false});
pad.buttons[7].value=0;pad.axes[1]=-.7;input.enabled=true;input.poll(pad);
assert.equal(input.axes(new Set(),pad).lift,0);
pad.axes[1]=0;input.poll(pad);pad.axes[1]=-.7;input.poll(pad);assert(input.axes(new Set(),pad).lift>0);
input.release('pause');assert.equal(input.axes(new Set(),pad).lift,0);
console.log(JSON.stringify({status:'passed',cases:['continuous trigger held across menu','discrete pause remains usable','all continuous channels must return to neutral','fresh input after neutral','ordinary release still inhibits']}));
