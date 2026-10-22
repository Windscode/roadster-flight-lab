import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {createApplicationShell} from '../dist/app-shell.js';
import {createCityFlightUI} from '../dist/city-flight-ui.js';
import {validateCityFlightResult} from '../dist/city-flight-challenge.js';
import {InputSession} from '../dist/input-session.js';
import {currentExperimentIdentity} from '../dist/experiment-records.js';
import {captureTaskSettings} from '../dist/task-setting-scope.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require(process.env.JSDOM_MODULE_PATH||process.argv[2]||'jsdom');
const copy=x=>JSON.parse(JSON.stringify(x)),sha=x=>createHash('sha256').update(x).digest('hex'),checks=[],cases=[];
const prior=JSON.parse(readFileSync(new URL('../qa/city-flight-handoff-3.15-before.json',import.meta.url),'utf8'));
const check=(name,passed,detail={})=>{checks.push({name,passed:!!passed,...detail});console.log(`${passed?'PASS':'FAIL'} ${name}`);};
const kinematics=snapshot=>Object.fromEntries(['position','velocity','quaternion','angularVelocity'].map(key=>[key,snapshot.body[key]]));
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
function harness(){
 const dom=new JSDOM(html,{url:'https://handoff-fixture.invalid/'}),doc=dom.window.document;
 globalThis.document=doc;globalThis.window=dom.window;
 dom.window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>{o[k]=v;return true;}});
 const sim=new RoadsterSim({supplyMode:'finite'});sim.reset('harbor');for(let i=0;i<240;i++)sim.advanceFixed({brake:1});
 sim.setMode('manual');for(let i=0;i<30;i++)sim.advanceFixed({frontJets:.35,rearJets:.35,brake:1});sim.setMode('drive');for(let i=0;i<240;i++)sim.advanceFixed({brake:1});sim.setSupplyMode('bench');
 sim.setWind({speedMps:2,directionDeg:90,gustMps:0,gustPeriodS:5});sim.setNozzleFault({id:'lift-FL',scale:.75});
 const original=captureTaskSettings(sim),originalMethods=Object.fromEntries(['reset','refillGas','setMode','setParam','setWind','clearWind','setNozzleFault','setStabilizationMode'].map(k=>[k,sim[k]]));
 const shell=createApplicationShell({initialSim:sim}),keys=new Set(),session=new InputSession({keys,onRelease:r=>sim.releasePilotInput(r)}),timeline=[];let city=null,context='city',preStartCalls=0;
 // Same ownership adapter as main.js; the shell's production forwarding and
 // research console's real Run path execute here, without initializing WebGL.
 shell.attachLive({getSim:()=>sim,getContext:()=>context,toast:()=>{},logEvent:()=>{},beforeResearchRun:program=>{
  timeline.push({event:'before-research',programId:program.id,cityRunning:city.getState().running,researchRecording:shell.research.getExperimentState().recording,gasKg:sim.gasMass});
  city.cancel('research_control');session.release('research-control-start');
  timeline.push({event:'city-terminal-before-new-recorder',cityRunning:city.getState().running,recordCount:city.getState().recordCount,researchRecording:shell.research.getExperimentState().recording,supplyMode:sim.params.supplyMode,gasKg:sim.gasMass,physical:sim.exportState()});
 },onStart:()=>timeline.push({event:'research-started',cityRunning:city.getState().running,researchRecording:shell.research.getExperimentState().recording})});
 shell.graphicsReady();
 city=createCityFlightUI({mount:doc.querySelector('#map-drawer .drawer-content'),getSim:()=>sim,getContext:()=>context,storage:dom.window.localStorage,onBeforeStart:()=>{preStartCalls++;shell.research.cancel('开始城市挑战');shell.research.stopRecording('开始城市挑战','cancelled');session.release('city-challenge-start');},onFinish:r=>timeline.push({event:'city-finished',status:r.status,reason:r.reason,step:r.stepCount,researchRecording:shell.research.getExperimentState().recording})});
 city.panel.querySelector('[data-cf="supply"]').value='finite';
 const received=[];dom.window.addEventListener('keydown',event=>{let handled=false;if(!event.repeat)handled=shell.research.handleKey(event.code.replace(/^Numpad([3-9])$/,'Digit$1'));received.push({code:event.code,repeat:event.repeat,isTrusted:event.isTrusted,handled});});
 return{dom,doc,sim,shell,city,session,timeline,received,original,originalMethods,preStartCalls:()=>preStartCalls,start(){city.start();for(let i=0;i<2;i++){const u=city.beforeStep({brake:1});city.afterStep(sim.advanceFixed(u),u,1/120);}},key(code,repeat=false){dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{code,key:code.replace(/\D/g,''),repeat,bubbles:true}));},contextChange(){city.onContextChange();context='lab';},dispose(){city.dispose();shell.research.dispose();dom.window.close();}};
}
check('The immutable pre-fix evidence reproduces default Digit3 dual ownership and rejected-start G loss',prior.shortcut.violatesExclusiveOwnership&&prior.shortcut.received.code==='Digit3'&&prior.failedStart.beforeStabilization==='level'&&prior.failedStart.afterStabilization==='off'&&!prior.failedStart.fullStateUnchanged);
for(const trigger of ['Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Numpad3','run-button']){
 const h=harness();h.start();const before=h.sim.exportState(),gasBefore=h.sim.gasMass;
 if(trigger==='run-button'){
  // Exercise the same Run action even when the caller has not already gone
  // through main's research-panel opening callback.
  h.shell.research.open('programs');h.doc.querySelector('[data-rc-action="run"]').click();
 }else{h.key(trigger,true);assert.equal(h.city.getState().running,true,'repeat must not start research');h.key(trigger);}
 const bound=['Digit3','Digit4','Digit5','Digit6','Numpad3','run-button'].includes(trigger),stateAtTrigger=h.shell.research.getState(),cityState=h.city.getState();
 if(bound){
  assert.equal(cityState.running,false);assert.equal(cityState.recordCount,1);const result=h.city.getRecords()[0];validateCityFlightResult(result);
  assert.equal(result.status,'cancelled');assert.equal(result.reason,'research_control');assert.equal(result.supplyMode,'finite');assert.equal(result.liveExperiment.finalSnapshot.physical.params.supplyMode,'finite');assert.equal(result.exitContract.supplyMode,'bench');assert.equal(result.exitContract.physicalStateUnchanged,true);
  const finishIndex=h.timeline.findIndex(x=>x.event==='city-finished'),boundaryIndex=h.timeline.findIndex(x=>x.event==='city-terminal-before-new-recorder'),startIndex=h.timeline.findIndex(x=>x.event==='research-started');
  assert(finishIndex>=0&&boundaryIndex>finishIndex);assert.equal(h.timeline[boundaryIndex].researchRecording,false);assert.equal(h.timeline[boundaryIndex].cityRunning,false);assert.equal(h.timeline[boundaryIndex].gasKg,gasBefore);
  if(startIndex>=0){assert(startIndex>boundaryIndex);assert.equal(h.timeline[startIndex].cityRunning,false);assert.equal(h.timeline[startIndex].researchRecording,true);}
  assert.deepEqual(result.liveExperiment.finalSnapshot.physical.body,before.body,'city terminal must precede research commands');
  assert.deepEqual(kinematics(h.sim.exportState()),kinematics(before),'handoff must not move the vehicle');assert.equal(h.sim.gasMass,gasBefore,'handoff must not refill');assert.equal(h.sim.body.mass,h.sim.params.dryMass+h.sim.gasMass,'refreshed mass equals dry mass plus actual remaining gas');
  assert(!/控制：驾驶者|Control: pilot/.test(h.city.panel.querySelector('[data-cf="state"]').textContent),'city task cannot keep an active pilot-control claim');
  for(let i=0;i<12&&h.shell.research.getState().running;i++){const u=h.shell.research.beforeFixedStep(1/120,{}),t=h.sim.advanceFixed(u);h.shell.research.afterFixedStep(t,u,1/120);}
  h.shell.research.cancel('fixture-end');h.shell.research.stopRecording('fixture-end','cancelled');
  const record=h.shell.research.getExperimentRecords().at(-1);assert(record,'research attempt retains its own new record');
  assert.deepEqual(record.initialSnapshot.physical.body,h.timeline[boundaryIndex].physical.body);assert.equal(record.initialSnapshot.physical.params.supplyMode,'bench','new record starts after city supply restoration');
  for(const [key,original]of Object.entries(h.originalMethods))assert.equal(h.sim[key],original,'recorder/guard wrapper leaked: '+key);
  const timeline=h.timeline.map(({physical,...entry})=>entry);cases.push({trigger,bound,received:h.received,timeline,researchRunningAtTrigger:stateAtTrigger.running,cityResult:{id:result.id,status:result.status,reason:result.reason,stepCount:result.stepCount,supplyMode:result.supplyMode,exitContract:result.exitContract},newResearchRecord:{id:record.id,initialSupply:record.initialSnapshot.physical.params.supplyMode,status:record.status},mutualExclusion:true,noRefill:true,wrappersReleased:true});
 }else{
  assert.equal(cityState.running,true);assert.equal(cityState.recordCount,0);assert.equal(stateAtTrigger.running,false);assert.equal(stateAtTrigger.experiment.recording,false);assert.equal(h.timeline.length,0);assert.deepEqual(h.sim.exportState(),before);cases.push({trigger,bound:false,received:h.received,noSideEffects:true});
 }
 h.dispose();
}
check('Default bound shortcuts 3/4/5/6, numpad 3 and Run button end/save the city task before opening a new recorder',cases.filter(x=>x.bound).length===6&&cases.filter(x=>x.bound).every(x=>x.mutualExclusion&&x.noRefill&&x.wrappersReleased));
check('Unbound default keys 7/8/9 and repeat events do not cancel the current city attempt',cases.filter(x=>!x.bound).length===3&&cases.filter(x=>!x.bound).every(x=>x.noSideEffects));
const rejected=[];
for(const mode of ['ground-level','air-level','air-hold','air-land']){
 const h=harness();h.sim.reset(mode==='ground-level'?'free':'hover');h.sim.setStabilizationMode('level');
 if(mode==='air-hold'){const t=h.sim.telemetry();h.sim.setPoseTarget({position:{...t.position,y:t.position.y+1},quaternion:{...t.quaternion}});}
 if(mode==='air-land')h.sim.startManeuver('land');
 const before=h.sim.exportState(),beforeReference=h.sim.getReference(),calls=h.preStartCalls(),gas=h.sim.gasMass;let message;
 try{h.city.start();}catch(error){message=error.message;}
 assert(message);assert.deepEqual(h.sim.exportState(),before);assert.deepEqual(h.sim.getReference(),beforeReference);assert.equal(h.preStartCalls(),calls);assert.equal(h.city.getState().running,false);assert.equal(h.city.getState().recordCount,0);assert.equal(h.sim.params.supplyMode,'bench');assert.equal(h.sim.gasMass,gas);
 rejected.push({mode,message,originalMode:before.state.mode,originalStabilization:before.state.stabilizationMode,originalManeuver:before.state._maneuver,fullStateUnchanged:true,referenceUnchanged:true,noOwnershipCallback:true,noTaskRecord:true});h.dispose();
}
check('Rejected city start preserves the exact original G, hold/land references, physical state and gas without entering ownership',rejected.length===4&&rejected.every(x=>x.fullStateUnchanged&&x.referenceUnchanged&&x.noOwnershipCallback));
const exits=[];
for(const cause of ['context_change','pilot_takeover','dispose']){
 const h=harness();h.start();const terminal=h.sim.exportState(),gas=h.sim.gasMass;
 if(cause==='context_change')h.contextChange();else if(cause==='dispose')h.city.dispose();else h.city.cancel(cause);
 const record=h.city.getRecords().at(-1);validateCityFlightResult(record);assert.equal(record.liveExperiment.finalSnapshot.physical.params.supplyMode,'finite');assert.equal(record.exitContract.physicalStateUnchanged,true);assert.deepEqual(captureTaskSettings(h.sim),h.original);assert.equal(h.sim.gasMass,gas);assert.deepEqual(kinematics(h.sim.exportState()),kinematics(terminal));assert.equal(h.sim.body.mass,h.sim.params.dryMass+h.sim.gasMass);assert.equal(h.city.getState().running,false);const count=h.city.getState().recordCount;h.city.cancel();h.city.dispose();assert.equal(h.city.getState().recordCount,count);
 for(const [key,original]of Object.entries(h.originalMethods))assert.equal(h.sim[key],original);exits.push({cause,reason:record.reason,recordCount:count,settingsRestored:true,bodyAndGasRetained:true,wrappersReleased:true,idempotent:true});h.dispose();
}
check('Context change, pilot takeover and disposal restore scoped settings exactly once after retaining the terminal',exits.every(x=>x.settingsRestored&&x.bodyAndGasRetained&&x.wrappersReleased&&x.idempotent));
const main=readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');
const beforeRunSource=main.match(/^\s*beforeResearchRun:(.+),$/m)?.[1];assert(beforeRunSource,'production beforeResearchRun adapter must remain present');
const handoffOrder=[],makeBeforeRun=mode=>new Function('learningSessionMode','routeExperience','cityFlight','inputSession',`return (${beforeRunSource});`)(mode,{cancel:reason=>handoffOrder.push('route:'+reason)},{cancel:reason=>handoffOrder.push('city:'+reason)},{release:reason=>handoffOrder.push('input:'+reason)});
makeBeforeRun('live')();const cityRelease=handoffOrder.indexOf('city:research_control'),inputRelease=handoffOrder.indexOf('input:research-control-start');
check('Main adapter cancels city ownership before releasing the old inputs',cityRelease>=0&&inputRelease>cityRelease);
const beforeGuard=handoffOrder.length;assert.throws(()=>makeBeforeRun('practice')(),/返回原现场/);assert.equal(handoffOrder.length,beforeGuard,'isolated practice must refuse before cancelling task ownership');
const sourcePaths=['dist/main.js','dist/app-shell.js','dist/research-console.js','dist/city-flight-ui.js','dist/task-setting-scope.js','tests/city-flight-handoff-3.15.test.mjs'];
const report={schema:'roadster-city-flight-handoff-regression',version:1,createdAt:new Date().toISOString(),identity:currentExperimentIdentity(),status:checks.every(x=>x.passed)?'passed':'failed',environment:'Production application shell and research/city UI, synthetic JSDOM KeyboardEvents, actual RoadsterSim. No WebGL or native hardware events.',priorEvidence:{file:'city-flight-handoff-3.15-before.json',sha256:sha(readFileSync(new URL('../qa/city-flight-handoff-3.15-before.json',import.meta.url))),retainedUnchanged:true},assertionClarification:{originalFailureLog:'city-flight-handoff-3.15-initial-assertion.txt',originalAssertion:'Complete body export equality was used for the no-motion rule.',observedMassKg:{cachedBefore:2188.3306815160886,refreshedAfter:2188.1330270565372},reason:'The existing no-refill parameter restore refreshes cached mass/inertia after finite discharge. Position, velocity, quaternion, angular velocity, time and gas are the exit invariants; refreshed body mass is checked separately against dryMass + actual gasMass. No runtime physics or tolerance change.'},checks,cases,rejectedStarts:rejected,exitPaths:exits,sourceHashes:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))])),scope:'Ownership transition and side-effect-free refusal. Actual terminal state is retained; normal task completion still hands control back to the pilot. No physical state is restored on exit.',pending:['Native browser shortcut/focus and GPU acceptance.','The complete graphics main module is not run here; its exact adapter wiring is source-checked, and production shell forwarding executes.']};
writeFileSync(new URL(`../qa/city-flight-handoff-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');assert(checks.every(x=>x.passed));console.log(JSON.stringify({checks:checks.length,triggers:cases.length,rejectedStarts:rejected.length,exitPaths:exits.length}));
