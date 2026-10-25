import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {installBrowserInput} from '../dist/browser-input.js';
import {sharedInputs,defaultProfile} from '../dist/semantic-input.js';
import {setLanguage} from '../dist/i18n.js';
import {createOperationHud} from '../dist/operation-hud.js';
import {RoadsterSim} from '../dist/physics.js';
const require=createRequire(import.meta.url),{JSDOM}=require(process.env.JSDOM_MODULE_PATH||'jsdom');
const dom=new JSDOM(readFileSync('dist/index.html','utf8'),{url:'https://input.fixture.invalid/',pretendToBeVisual:true});
const win=dom.window,doc=win.document;
win.requestAnimationFrame=()=>1;win.cancelAnimationFrame=()=>{};
sharedInputs.setProfile(defaultProfile());const ui=installBrowserInput({studyOpen:false},{win,doc});
try{
  win.roadsterInputs.bindKey('forward','KeyI');
  assert.match(doc.querySelector('.drive-hint').textContent,/I 前进/);
  assert.match(doc.getElementById('viewport').getAttribute('aria-label'),/I 前进/);
  assert.ok([...doc.querySelectorAll('[data-action-key="forward"]')].every(n=>n.textContent==='I'));
  win.roadsterInputs.bindKey('liftUp','KeyO');
  assert.ok([...doc.querySelectorAll('[data-action-key="liftUp"]')].every(n=>n.textContent==='O'));
  setLanguage('en',{persist:false});assert.match(doc.querySelector('.drive-hint').textContent,/I drive/);
  assert.match(doc.getElementById('viewport').getAttribute('aria-label'),/O Climb/);
  const saved=JSON.parse(win.localStorage.getItem('roadster-actions-3.21'));assert.deepEqual(saved.keys.forward,['KeyI']);
  win.roadsterInputs.bindKey('autoRoll','KeyN');win.roadsterInputs.bindKey('autoPitch','KeyY');win.roadsterInputs.bindKey('level','Digit0');
  const sim=new RoadsterSim(),host=doc.createElement('section');doc.body.append(host);
  const hud=createOperationHud({mount:host,getSim:()=>sim,getContext:()=> 'city'}),t=sim.telemetry();
  t.controlOwnership={...t.controlOwnership,owner:'explicit-roll'};t.maneuverFeedback={lastRun:{name:'roll',state:'running',elapsedS:.3,actualRollTravelDeg:20}};t.manualPitchEnvelope={active:true,requestedRateDegS:10,nominalFullTurnS:36};t.levelRecovery={status:'armed'};
  for(const language of ['zh','en']){setLanguage(language,{persist:false});hud.update(t);
    assert.match(host.querySelector('[data-operation="control-source"]').textContent,/N /);
    assert.match(host.querySelector('[data-operation="action"]').textContent,/^N /);
    assert.match(host.querySelector('[data-operation="pitch-envelope"]').textContent,/Y /);
    assert.match(host.querySelector('[data-operation="attitude"]').textContent,/0 /);
  }
  console.log('PASS remapped guide, HUD, accessible viewport, language and saved controls agree');
}finally{ui.dispose();setLanguage('zh',{persist:false});sharedInputs.setProfile(defaultProfile());dom.window.close();}
