import assert from 'node:assert/strict';
import {VERTICAL_RESPONSE,CONTROL_RESPONSES,readVerticalResponse,saveVerticalResponse,readControlResponses,saveControlResponse} from '../dist/ui-preferences.js';

const values=new Map(),storage={getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value)};
assert.equal(readVerticalResponse(storage),5);
// An explicitly saved old value is still the user's preference.
values.set(VERTICAL_RESPONSE.key,'3');assert.equal(readVerticalResponse(storage),3);
saveVerticalResponse(14,storage);assert.equal(readVerticalResponse(storage),14);
assert.throws(()=>saveVerticalResponse(14.1,storage),RangeError);
const before=readControlResponses(storage);
saveControlResponse('rollRateDegS',275,storage);saveControlResponse('verticalAccelerationMps2',7.5,storage);
assert.deepEqual(readControlResponses(storage),{...before,rollRateDegS:275,verticalAccelerationMps2:7.5});
assert.throws(()=>saveControlResponse('unknown',1,storage),RangeError);
assert.throws(()=>saveControlResponse('angularAccelerationDegS2',721,storage),RangeError);
const unavailable={getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');}};
assert.equal(saveControlResponse('pitchRateDegS',100,unavailable),100);
assert.deepEqual(readControlResponses(unavailable),Object.fromEntries(Object.entries(CONTROL_RESPONSES).map(([key,d])=>[key,d.default])));
console.log('PASS: control preferences preserve earlier choices, save independent limits immediately, reject invalid ranges and survive unavailable storage.');
