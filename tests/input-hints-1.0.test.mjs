import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {installBrowserInput} from '../dist/browser-input.js';
import {sharedInputs,defaultProfile} from '../dist/semantic-input.js';
import {setLanguage} from '../dist/i18n.js';
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
  console.log('PASS remapped guide, HUD, accessible viewport, language and saved controls agree');
}finally{ui.dispose();setLanguage('zh',{persist:false});sharedInputs.setProfile(defaultProfile());dom.window.close();}
