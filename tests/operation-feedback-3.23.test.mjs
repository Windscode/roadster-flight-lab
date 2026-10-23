import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {RoadsterSim} from '../dist/physics.js';
import {createOperationHud} from '../dist/operation-hud.js';
import {setLanguage} from '../dist/i18n.js';

const require=createRequire(import.meta.url),{JSDOM}=require(process.env.JSDOM_MODULE_PATH||'jsdom');
const dom=new JSDOM('<main></main>'),sim=new RoadsterSim({supplyMode:'bench'});
const hud=createOperationHud({mount:dom.window.document.querySelector('main'),getSim:()=>sim,getContext:()=> 'city'});
const action=hud.node.querySelector('[data-operation="action"]');
const reason='起跳 / 旋转中车身碰撞（roof）；完整动作已中止，按实际执行器尝试回稳';
const run={name:'roll',state:'running',elapsedS:.65,actualRollTravelDeg:18.4};
const show=(state,abortReason)=>hud.update({...sim.telemetry(),maneuver:abortReason?{name:'roll',abortReason}:null,maneuverFeedback:{lastRun:{...run,state,reason:state==='completed'?'wheel-supported-landing':reason}}});
try{
  setLanguage('zh',{persist:false});
  show('running',reason);
  assert.equal(action.dataset.state,'aborting');assert.match(action.textContent,/动作中止.*尝试回稳.*车身碰撞/);
  for(const state of ['aborted-landed','aborted-recovered']){
    show(state);assert.match(action.textContent,/未完成.*车身碰撞/);assert(!action.textContent.includes(state));
  }
  show('completed');assert.match(action.textContent,/已完成/);assert(!action.textContent.includes('碰撞'));assert.match(action.title,/四轮承载/);
  setLanguage('en',{persist:false});show('running',reason);
  assert.match(action.textContent,/Maneuver aborted.*Body collision/);assert(!action.textContent.includes('车身碰撞'));
  show('aborted-landed');assert.match(action.textContent,/Not completed · landed.*Body collision/);
  for(const phase of ['着陆','回稳']){
    hud.update({...sim.telemetry(),maneuver:{name:'roll',abortReason:reason.replace('起跳 / 旋转',phase)},maneuverFeedback:{lastRun:run}});
    assert.match(action.textContent,/Body collision during (landing|recovery)/);
  }
  console.log('PASS maneuver collision / recovery reason is visible in Chinese and English, completed landing stays concise');
}finally{setLanguage('zh',{persist:false});dom.window.close();}
