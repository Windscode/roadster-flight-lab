import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {auditNativeSourceIdentity} from '../qa/native-source-identity-3.16.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
const shortKeyPolicy={requestedApiHoldMs:50,maximumObservedIntervalMs:100,protocolDeadlineMs:30000,scope:'50 ms is a Node scheduling request, not a measured key hold. A short-edge claim requires ordered trusted down/up events and API-dispatch, DOM eventTimeStamp and handler observedAt intervals each >0 and <=100 ms. Exact observed intervals are retained; no exact-50-ms or physical-keyboard claim.'};
async function dispatchIndependentKeyEdge(keyboard,key,{requestedHoldMs=50,deadlineMs=30000}={}){
  const stamp=()=>({nodeMonotonicMs:performance.now(),nodeEpochMs:Date.now(),utc:new Date().toISOString()}),origin=stamp(),timing={key,requestedHoldMs,origin,upDueNodeMonotonicMs:origin.nodeMonotonicMs+requestedHoldMs,upTimerIndependentOfDownCompletion:true,dispatch:{},outcomes:[],protocolTimedOut:false};
  const invoke=type=>{
    const row=timing.dispatch[type]={invokedAt:stamp(),status:'pending'};if(type==='up')timing.upDispatchedBeforeDownSettled=!timing.dispatch.down?.settledAt;
    let promise;try{promise=keyboard[type](key);}catch(error){promise=Promise.reject(error);}
    return Promise.resolve(promise).then(()=>{row.status='fulfilled';row.settledAt=stamp();},error=>{row.status='rejected';row.settledAt=stamp();row.error={name:error.name,message:error.message};throw error;});
  };
  // Schedule release before calling down. Never await its Chromium ACK before
  // queuing up: Keyboard.press() does exactly that before starting its delay.
  const up=new Promise((resolveUp,rejectUp)=>setTimeout(()=>invoke('up').then(resolveUp,rejectUp),requestedHoldMs));
  const down=invoke('down'),completion=Promise.allSettled([down,up]).then(results=>{timing.outcomes=results.map((result,index)=>({type:index?'up':'down',status:result.status,...(result.status==='rejected'?{error:{name:result.reason.name,message:result.reason.message}}:{})}));});
  let deadline;await Promise.race([completion,new Promise(resolveTimeout=>{deadline=setTimeout(()=>{timing.protocolTimedOut=true;resolveTimeout();},deadlineMs);})]);clearTimeout(deadline);
  timing.returnedAt=stamp();timing.apiDispatchIntervalMs=timing.dispatch.up?timing.dispatch.up.invokedAt.nodeMonotonicMs-timing.dispatch.down.invokedAt.nodeMonotonicMs:null;timing.upTimerLatenessMs=timing.dispatch.up?timing.dispatch.up.invokedAt.nodeMonotonicMs-timing.upDueNodeMonotonicMs:null;
  return structuredClone(timing);
}
const require=createRequire(import.meta.url),playwrightModule=process.env.PLAYWRIGHT_MODULE||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright',{chromium}=require(playwrightModule),playwrightRequire=createRequire(require.resolve(playwrightModule)),corePackagePath=playwrightRequire.resolve('playwright-core/package.json'),coreBundlePath=join(dirname(corePackagePath),'lib/coreBundle.js'),coreBundle=readFileSync(coreBundlePath);
const keyboardProtocol={package:'playwright-core',version:JSON.parse(readFileSync(corePackagePath,'utf8')).version,artifact:'lib/coreBundle.js',bytes:coreBundle.length,sha256:sha(coreBundle),sourceModules:['client/input.ts','client/connection.ts','inprocess.ts','server/dispatchers/dispatcher.ts','server/dispatchers/pageDispatcher.ts','server/input.ts','server/chromium/crInput.ts','server/chromium/crConnection.ts'],finding:'press awaits down ACK, then its delay, then up. Separate down/up have independent channel requests and progress controllers. In-process dispatch uses separate setImmediate callbacks; Chromium send writes each request before waiting for its own response id. Browser-side input/render queues can still delay or reorder delivery; actual DOM timing remains the gate.'};
if(process.argv.includes('--check-x-scheduler')){
  const source=coreBundle.toString('utf8'),extract=name=>{const start=source.indexOf(name+' = class {'),end=source.indexOf('\n    };',start);if(start<0||end<0)throw Error('Installed keyboard source is not recognized for the isolated scheduler check');const code=source.slice(start,end+'\n    }'.length).replace(name+' = ','');return{constructor:runInNewContext('('+code+')',{kNoTimeout:{timeout:0}}),sha256:sha(code)};};
  const client=extract('Keyboard2'),server=extract('Keyboard'),messages=[];let acknowledgeDown;
  const keyboard=new client.constructor({_channel:{keyboardDown:()=>new Promise(resolveDown=>setImmediate(()=>{messages.push('down');acknowledgeDown=resolveDown;})),keyboardUp:()=>new Promise((resolveUp,rejectUp)=>setImmediate(()=>{messages.push('up');if(!acknowledgeDown){rejectUp(Error('up overtook down in the fixture'));return;}acknowledgeDown();resolveUp();}))}});
  const concurrent=await dispatchIndependentKeyEdge(keyboard,'x',{requestedHoldMs:50,deadlineMs:1000});if(concurrent.protocolTimedOut||concurrent.outcomes.some(row=>row.status!=='fulfilled')||!concurrent.upDispatchedBeforeDownSettled||messages.join(',')!=='down,up')throw Error('Independent release waited for down completion or failed to reach the isolated real client channel');
  const old={origin:performance.now()},oldKeyboard=Object.create(server.constructor.prototype);oldKeyboard.down=()=>{old.downInvokedMs=performance.now()-old.origin;return new Promise(resolveDown=>setTimeout(()=>{old.downAcknowledgedMs=performance.now()-old.origin;resolveDown();},150));};oldKeyboard.up=async()=>{old.upInvokedMs=performance.now()-old.origin;};await oldKeyboard.press({wait:ms=>new Promise(resolveWait=>setTimeout(resolveWait,ms))},'x',{delay:50});
  if(old.upInvokedMs<old.downAcknowledgedMs+40)throw Error('The installed press implementation no longer matches the reviewed serial-ACK cause');
  console.log(JSON.stringify({status:'passed',scope:'No browser or GPU. Actual installed client Keyboard code with deliberately delayed channel ACKs, and actual server press code with a 150 ms fake down ACK. This proves scheduler/channel concurrency, not native DOM delivery.',keyboardProtocol,clientKeyboardSourceSha256:client.sha256,serverKeyboardSourceSha256:server.sha256,concurrent,channelMessages:messages,serialPressControl:old},null,2));process.exit(0);
}
const out=resolve(process.env.ROADSTER_CAPTURE_DIR||'qa/native-controls-3.16'),url=process.env.ROADSTER_URL||'http://127.0.0.1:8316/',baseline=process.argv.includes('--baseline');
if(existsSync(out)&&readdirSync(out).length)throw Error('Capture directory already contains evidence. Choose a new ROADSTER_CAPTURE_DIR; prior long-interval X evidence must not be overwritten.');mkdirSync(out,{recursive:true});
const cases=[],errors=[],consoleErrors=[],captures=[],playbackActions=[],shortKeyEdges=[];
const sourcePaths=['main.js','physics.js','input-session.js','operation-hud.js','export-download.js','export-encoder.js','export-worker.js','vehicle.js','model-build.js'];
const sourceHashes=()=>Object.fromEntries(sourcePaths.map(path=>[path,sha(readFileSync(new URL('../dist/'+path,import.meta.url)))]));
const runnerSourceHashes=()=>({'scripts/native-controls-3.16.mjs':sha(readFileSync(new URL(import.meta.url))),'qa/native-source-identity-3.16.mjs':sha(readFileSync(new URL('../qa/native-source-identity-3.16.mjs',import.meta.url))),'toolchain/playwright-core/lib/coreBundle.js':sha(readFileSync(coreBundlePath))});
const sourceBefore=sourceHashes(),runnerSourceBefore=runnerSourceHashes();
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROME||'/tmp/roadster-browser-316/chrome-linux64/chrome',headless:true,env:{...process.env,...(process.env.ROADSTER_FONTCONFIG?{FONTCONFIG_FILE:process.env.ROADSTER_FONTCONFIG}:{})},args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:1,acceptDownloads:true});
await context.addInitScript(()=>{
  localStorage.setItem('roadster-language','zh');localStorage.setItem('roadster-quality','balanced');
  window.__nativeKeys=[];for(const type of ['keydown','keyup'])addEventListener(type,event=>{window.__nativeKeys.push({type,code:event.code,key:event.key,repeat:event.repeat,isTrusted:event.isTrusted,eventTimeStamp:event.timeStamp,observedAt:performance.now(),timeOrigin:performance.timeOrigin,target:event.target?.id??null});},true);
  // Observe the same trusted click before and after its production handler.
  // The bubbling sample precedes the next RAF; no state or clock is injected.
  window.__nativeClicks=[];const clickRecords=new WeakMap();
  document.addEventListener('click',event=>{const control=event.target?.closest?.('[data-operation="pause"]');if(!control||!window.roadsterLab)return;const row={action:'operation-pause',isTrusted:event.isTrusted,eventTimeStamp:event.timeStamp,observedAt:performance.now(),labelBefore:control.textContent,ariaLabelBefore:control.getAttribute('aria-label'),before:structuredClone(window.roadsterLab.getState())};clickRecords.set(event,row);window.__nativeClicks.push(row);},true);
  addEventListener('click',event=>{const row=clickRecords.get(event);if(!row)return;const control=event.target.closest('[data-operation="pause"]');row.after=structuredClone(window.roadsterLab.getState());row.labelAfter=control.textContent;row.ariaLabelAfter=control.getAttribute('aria-label');});
});
const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.stack));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
let device=null,identity=null,servedIdentityBefore=null,servedIdentityAfter=null,failure=null,activeTrial=null,inputExportEvidence=null,inputExportPauseEvidence=null;
const state=()=>page.evaluate(()=>window.roadsterLab.getState());
const markedState=()=>page.evaluate(()=>{const t=window.roadsterLab.getState(),journal=window.roadsterLab.getInputTimeline();return{...t,traceStartSequence:journal.events.at(-1)?.sequence??0,traceDroppedAtStart:journal.droppedEvents,nativeKeyStart:window.__nativeKeys.length,nativeClickStart:window.__nativeClicks.length};});
const physicalState=t=>({simTime:t.simTime,physicalStep:t.physicalStep,position:t.position,quaternion:t.quaternion,velocity:t.velocity,angularVelocity:t.angularVelocity,gasMass:t.gasMass,onboardGasConsumedKg:t.onboardGasConsumedKg,externalGasSuppliedKg:t.externalGasSuppliedKg});
async function clickPlayback(expectedPaused){
  const beforeRequest=await state(),beforeClicks=await page.evaluate(()=>window.__nativeClicks.length),control=page.locator('[data-operation="pause"]');
  if(beforeRequest.paused===expectedPaused)throw Error('Unexpected playback state before the requested visible HUD '+(expectedPaused?'pause':'resume'));
  if(!(await control.isVisible()))throw Error('The operation HUD pause/resume button is not visible in the actual page');
  await control.click();const actualClick=await page.evaluate(()=>window.__nativeClicks.at(-1)),afterRequest=await state();
  const evidence={method:'Visible operation HUD button → existing production setPaused/start path.',beforeRequest,actualClick,afterRequest,expectedPaused,physicalStatePreservedAtClick:!!actualClick?.after&&JSON.stringify(physicalState(actualClick.before))===JSON.stringify(physicalState(actualClick.after)),scope:'Capture-phase and window-bubble telemetry bracket the same trusted button handler. The separate request samples may include ordinary physical steps before a pause click or after a resume click.'};playbackActions.push(evidence);
  if((await page.evaluate(()=>window.__nativeClicks.length))!==beforeClicks+1||!actualClick?.isTrusted||!actualClick.after||actualClick.before.paused===expectedPaused||actualClick.after.paused!==expectedPaused||afterRequest.paused!==expectedPaused||actualClick.labelAfter!==(expectedPaused?'继续':'暂停')||actualClick.ariaLabelAfter!==(expectedPaused?'继续仿真':'暂停仿真以观察')||!evidence.physicalStatePreservedAtClick)throw Error('The trusted visible HUD click did not preserve physical state or reach its declared pause/resume state');
  return evidence;
}
async function snapshot(name){
  const before=await state(),filename=name+'.png';await page.screenshot({path:join(out,filename),timeout:60000});
  captures.push({filename,sha256:sha(readFileSync(join(out,filename))),beforeCapture:before,afterCapture:await state(),scope:'Actual whole-page pixels; the two telemetry samples bracket asynchronous screenshot capture, not an exact same-frame claim.'});console.log('capture '+name);
}
async function untilTime(target,timeout=240000){await page.waitForFunction(target=>{const t=window.roadsterLab.getState();return t.simTime>=target||!!t.fault;},target,{polling:100,timeout});const t=await state();if(t.fault)throw Error('Actual simulation fault: '+t.fault);return t;}
async function reset(){
  for(const key of ['w','e','1','2','q','z','b'])await page.keyboard.up(key);
  // The frozen baseline has no operation playback button. The candidate uses
  // the visible HUD entry after R, including the existing start() transition.
  await page.keyboard.press('r');if(baseline)await page.keyboard.press('p');else await clickPlayback(false);
  const initial=await state();await untilTime(initial.simTime+.6);const settled=await state();
  if(settled.context!=='city'||settled.mode!=='drive'||settled.paused||settled.supplyMode!=='bench'||Math.abs(settled.pressureBar-350)>.1||Math.hypot(settled.velocity.x,settled.velocity.y,settled.velocity.z)>.2||settled.contactCount<3||settled.wind?.speedMps||settled.wind?.gustMps||settled.nozzleFault||settled.fault)throw Error('Declared running city/DRIVE/350 bar/rest/wheel-support/no-wind/no-fault initial condition was not reached');
  return markedState();
}
async function pressShortX(id,start,expectedRoutingAccepted){
  const edge={id,key:'x',code:'KeyX',policy:shortKeyPolicy,expectedRoutingAccepted,sourceSequence:start.traceStartSequence,nativeKeyStart:start.nativeKeyStart,status:'incomplete',failures:[]};shortKeyEdges.push(edge);if(activeTrial)activeTrial.details={...activeTrial.details,shortKeyEdge:edge};
  edge.dispatch=await dispatchIndependentKeyEdge(page.keyboard,'x',{requestedHoldMs:shortKeyPolicy.requestedApiHoldMs,deadlineMs:shortKeyPolicy.protocolDeadlineMs});
  if(edge.dispatch.protocolTimedOut||edge.dispatch.outcomes.length!==2||edge.dispatch.outcomes.some(row=>row.status!=='fulfilled')){edge.status='keyboard-protocol-not-confirmed';edge.failures.push('keyboard-protocol-incomplete-or-rejected');throw Error('X independent key requests failed or exceeded their 30 s protocol deadline; no short-key claim');}
  const observed=await page.evaluate(({nativeKeyStart,sequence})=>({timeOrigin:performance.timeOrigin,nativeEvents:window.__nativeKeys.slice(nativeKeyStart).filter(event=>event.code==='KeyX'),applicationEvents:window.roadsterLab.getInputTimeline().events.filter(event=>event.sequence>sequence&&(event.code==='KeyX'||event.type==='action-receipt'&&['KeyX','roll'].includes(event.name)))}),{nativeKeyStart:start.nativeKeyStart,sequence:start.traceStartSequence});
  edge.observed=observed;const down=observed.nativeEvents[0],up=observed.nativeEvents[1],orderedTrustedPair=observed.nativeEvents.length===2&&down.type==='keydown'&&up.type==='keyup'&&down.isTrusted&&up.isTrusted&&!down.repeat&&!up.repeat;
  const appDown=observed.applicationEvents.find(event=>event.type==='keydown'&&event.code==='KeyX')??null,appUp=observed.applicationEvents.find(event=>event.type==='keyup'&&event.code==='KeyX')??null,receipts=observed.applicationEvents.filter(event=>event.type==='action-receipt');
  edge.intervalsMs={apiDispatch:edge.dispatch.apiDispatchIntervalMs,domEventTimeStamp:orderedTrustedPair?up.eventTimeStamp-down.eventTimeStamp:null,handlerObservedAt:orderedTrustedPair?up.observedAt-down.observedAt:null,applicationReceived:appDown&&appUp?appUp.wallTimeMs-appDown.wallTimeMs:null};
  edge.eventQueueDelayMs=orderedTrustedPair?{down:down.observedAt-down.eventTimeStamp,up:up.observedAt-up.eventTimeStamp}:null;edge.application={keydown:appDown,keyup:appUp,routingAccepted:appDown?.accepted??null,actionReceipts:receipts,physicalActionAccepted:receipts.at(-1)?.accepted??null,scope:'Accepted routing and maneuver acceptance are separate. The frozen 3.15 page lacks the new action receipt; missing fields stay null and actual motion remains separately recorded. A delayed handler-observation interval alone does not establish an application X defect.'};
  edge.nativeDelivery={status:orderedTrustedPair?'ordered-trusted-pair':'not-confirmed',eventCount:observed.nativeEvents.length};
  const timingBasis={apiDispatch:'Independent Node keyboard API invocation times; not browser delivery.',domEventTimeStamp:'Browser event creation timestamps; not handler execution times.',handlerObservedAt:'Capture-phase observer execution times on the page; a busy main thread may delay observation.'};
  edge.timingChecks=Object.fromEntries(Object.entries(timingBasis).map(([field,basis])=>{const observedIntervalMs=edge.intervalsMs[field],confirmed=Number.isFinite(observedIntervalMs)&&observedIntervalMs>0&&observedIntervalMs<=shortKeyPolicy.maximumObservedIntervalMs;return[field,{status:confirmed?'within-declared-short-bound':'not-confirmed-short',observedIntervalMs,maximumIntervalMs:shortKeyPolicy.maximumObservedIntervalMs,basis}];}));
  if(!orderedTrustedPair)edge.failures.push('missing-duplicate-untrusted-or-out-of-order-native-edges');
  for(const [field,check]of Object.entries(edge.timingChecks))if(check.status!=='within-declared-short-bound')edge.failures.push(field+'-interval-not-confirmed-short');
  if(!appDown||!appUp)edge.failures.push('application-key-edge-receipt-missing');else if(appDown.accepted!==expectedRoutingAccepted)edge.failures.push('unexpected-application-routing-acceptance');
  if(!baseline&&!receipts.length)edge.failures.push('current-model-action-receipt-missing');if(receipts.length&&receipts.at(-1).accepted!==expectedRoutingAccepted)edge.failures.push('unexpected-action-acceptance');
  edge.applicationChecks={keyEdgesRecorded:!!appDown&&!!appUp,routingAcceptedAsExpected:appDown?appDown.accepted===expectedRoutingAccepted:null,actionReceiptAvailable:receipts.length>0,actionAcceptedAsExpected:receipts.length?receipts.at(-1).accepted===expectedRoutingAccepted:null};
  edge.applicationReceiptStatus=edge.applicationChecks.keyEdgesRecorded&&edge.applicationChecks.routingAcceptedAsExpected&&(receipts.length?edge.applicationChecks.actionAcceptedAsExpected:baseline)?'matched-available-expected-receipts':'not-confirmed';
  edge.shortTimingConfirmed=orderedTrustedPair&&Object.values(edge.timingChecks).every(check=>check.status==='within-declared-short-bound');
  edge.status=!orderedTrustedPair?'native-delivery-not-confirmed':edge.applicationReceiptStatus==='not-confirmed'?'application-receipts-not-confirmed':!edge.shortTimingConfirmed?'short-timing-not-confirmed':'passed-short-native-edge';
  console.log(JSON.stringify({id,shortKeyStatus:edge.status,timingChecks:edge.timingChecks,applicationReceiptStatus:edge.applicationReceiptStatus,intervalsMs:edge.intervalsMs,routingAccepted:edge.application.routingAccepted,physicalActionAccepted:edge.application.physicalActionAccepted,failures:edge.failures}));
  if(!orderedTrustedPair)throw Error('X native edges were missing, duplicated, untrusted or out of order; original evidence retained');
  // A complete but delayed pair may still trigger the maneuver. Preserve that
  // motion and subsequent independent trials, but make the final run fail.
  return edge;
}
async function evidence(id,start,details={}){
  const end=await state(),timeline=await page.evaluate(()=>window.roadsterLab.getInputTimeline()),rows=timeline.events.filter(e=>e.type==='physics-input'&&e.sequence>(start.traceStartSequence??0)&&e.simTime>=start.simTime-1e-8),poses=rows.map(e=>e.actual).filter(Boolean);
  const bytes=gzipSync(Buffer.from(JSON.stringify({schema:'roadster-native-keyboard-evidence',version:1,id,start,end,parameters:await page.evaluate(()=>window.roadsterLab.getParameters()),nativeKeys:await page.evaluate(()=>window.__nativeKeys),nativeClicks:await page.evaluate(()=>window.__nativeClicks),shortKeyEdge:details.shortKeyEdge??null,keyboardProtocol,timeline},null,2)),{level:9}),filename=id+'.json.gz';writeFileSync(join(out,filename),bytes);
  const pitchTravel=poses.map(p=>p.attitudeTravel?.pitchDeg).filter(Number.isFinite),contactFieldsAvailable=rows.length>0&&rows.every(e=>Number.isFinite(e.actual?.wheelContactCount)&&Number.isFinite(e.actual?.rigidContactCount));
  const row={id,start,end,...details,trace:{filename,bytes:bytes.length,sha256:sha(bytes),events:timeline.events.length,capacity:timeline.capacity,dropped:timeline.droppedEvents,droppedSinceTrialStart:timeline.droppedEvents-(start.traceDroppedAtStart??0),physicsRows:rows.length,firstRecordedSimTime:rows[0]?.simTime??null,lastRecordedSimTime:rows.at(-1)?.simTime??null,unrecordedHeadS:rows.length?Math.max(0,rows[0].simTime-start.simTime):null,unrecordedTailS:rows.length?Math.max(0,end.simTime-rows.at(-1).simTime):null,policy:timeline.physicsTracePolicy,scope:'Only retained production samples are summarized. Trace expiry, rolling eviction and screenshot delays can leave uncovered intervals; zero recorded contacts is not a whole-trial no-contact certificate.'},minimumRecordedCgHeightM:poses.length?Math.min(...poses.map(p=>p.position.y)):null,maximumRecordedCgHeightM:poses.length?Math.max(...poses.map(p=>p.position.y)):null,maximumActualPitchTravelDeg:pitchTravel.length?Math.max(...pitchTravel):null,pitchTravelDatum:'Cumulative actual body-axis quaternion travel since the most recent scenario reset; not Euler pitch and not reset again for the airborne subtrial.',contactFieldsAvailable,contactSamples:contactFieldsAvailable?rows.filter(e=>e.actual.wheelContactCount>0||e.actual.rigidContactCount>0||(e.integration?.contactMicrosteps??0)>0).length:null,lastActionReceipt:timeline.lastActionReceipt?.sequence>(start.traceStartSequence??0)?timeline.lastActionReceipt:null};cases.push(row);console.log(JSON.stringify({id,time:end.simTime,phase:end.maneuver?.phase??null,lastRun:end.maneuverFeedback?.lastRun,pitch:end.pitchDeg,roll:end.rollDeg,travel:end.attitudeTravel,recovery:end.levelRecovery,contacts:row.contactSamples}));return row;
}
try{
  servedIdentityBefore=await auditNativeSourceIdentity(url,{expectedBuildId:process.env.ROADSTER_EXPECTED_BUILD});
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.roadsterLab,null,{timeout:90000});
  await page.locator('#play-city').click();await reset();
  identity=await page.evaluate(()=>window.roadsterLab.getInputTimeline().identity);if(process.env.ROADSTER_EXPECTED_BUILD&&identity.modelBuildId!==process.env.ROADSTER_EXPECTED_BUILD)throw Error('Loaded build differs from the requested frozen build');
  device=await page.evaluate(()=>{const gl=document.querySelector('#viewport canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{webgl2:!!gl,unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};});
  console.log('native city start '+JSON.stringify(identity));
  if(!baseline){
    const start=await reset();activeTrial={id:'hud-pause-resume-held-w',start};await page.keyboard.down('w');const wOnlyEnd=await untilTime(start.simTime+.25);if(wOnlyEnd.driverInput.throttle!==1)throw Error('Native W did not reach the production driver input before HUD pause');
    const pause=await clickPlayback(true),journal=await page.evaluate(()=>window.roadsterLab.getInputTimeline()),release=journal.events.filter(event=>event.sequence>start.traceStartSequence&&event.type==='input-release'&&event.reason==='pause').at(-1);
    if(!release?.released?.includes('KeyW')||!release.pause||release.pressed.length||Object.values(pause.actualClick.after.driverInput).some(value=>value!==0&&value!==false))throw Error('The visible pause did not release the still-held native W input');
    const pausedWallStart=performance.now(),pausedBefore=await state();await page.waitForTimeout(200);const pausedAfter=await state(),pausedWallObservedMs=performance.now()-pausedWallStart;
    if(!pausedAfter.paused||JSON.stringify(physicalState(pausedBefore))!==JSON.stringify(physicalState(pausedAfter)))throw Error('The paused physical end state advanced during native observation');
    const resume=await clickPlayback(false),afterResume=await untilTime(resume.actualClick.after.simTime+.12);if(afterResume.driverInput.throttle!==0)throw Error('HUD resume resurrected the old W command without a new native keydown');await page.keyboard.up('w');
    await evidence('hud-pause-resume-held-w',start,{wOnlyEnd,pause,release,pausedBefore,pausedAfter,pausedWallObservedMs,resume,afterResume,scope:'Trusted visible HUD pause/resume with W keydown sent first and its keyup sent only after resumed neutral input was observed. No new W keydown or repeat is synthesized during the pause; this does not claim hardware auto-repeat behavior.'});activeTrial=null;
  }
  const prepared=await reset();activeTrial={id:'x-short-press',start:prepared};await snapshot('01-x-before');const start=await markedState();activeTrial.start=start;const shortX=await pressShortX('x-short-press',start,true);
  await untilTime(start.simTime+1.2);await snapshot('02-x-running');
  await page.waitForFunction(startTime=>{const t=window.roadsterLab.getState();return t.fault||!t.maneuver&&t.simTime>=startTime+3;},start.simTime,{polling:100,timeout:240000});
  if((await state()).fault)throw Error('Actual simulation fault during the X completion wait');
  await evidence('x-short-press',start,{requestedKeyHoldMs:50,shortKeyEdge:shortX,scope:'Independent trusted down/up requests. 50 ms is only the requested Node dispatch interval; the attached actual API, DOM timestamp and handler observation gaps determine short-edge acceptance. Motion completion cannot turn a delayed key pair into a short-press pass.'});activeTrial=null;await snapshot('03-x-after');
  if(!baseline){
    await page.keyboard.press('r');const paused=await markedState();activeTrial={id:'x-from-reset-pause',start:paused};const pausedX=await pressShortX('x-from-reset-pause',paused,true);await untilTime(paused.simTime+5);await evidence('x-from-reset-pause',paused,{requestedKeyHoldMs:50,shortKeyEdge:pausedX});activeTrial=null;
    for(const g of [true,false]){
      const base=await reset();if((base.stabilizationMode==='level')!==g)await page.keyboard.press('g',{delay:50});
      const initial=await markedState();if((initial.stabilizationMode==='level')!==g)throw Error('The requested native G mode was not accepted');activeTrial={id:g?'we1-ground-g-on':'we1-ground-g-off-then-g-on',start:initial};await page.keyboard.down('w');const wOnlyEnd=await untilTime(initial.simTime+.25);await page.keyboard.down('e');await page.keyboard.down('1');
      const allHeld=await state();await untilTime(allHeld.simTime+6.5);
      await page.keyboard.up('1');await page.keyboard.up('e');await page.keyboard.up('w');const released=await state();await snapshot(g?'04-we1-g-on-release':'06-we1-g-off-release');
      // Ordinary G-on is left on. The G-off case is then explicitly toggled on
      // so its manual hold and a later G recovery are separately inspectable.
      if(!g){await untilTime(released.simTime+1);await page.keyboard.press('g',{delay:50});}
      await untilTime((await state()).simTime+6);await evidence(g?'we1-ground-g-on':'we1-ground-g-off-then-g-on',initial,{wOnlyEnd,allHeldAt:allHeld.simTime,release:released,scope:'Ground-start real city with original continuous W and later E/1 appended. Any ground/building contact remains a counterexample to a clean airborne flip.'});activeTrial=null;await snapshot(g?'05-we1-g-on-after':'07-we1-g-off-then-g-after');
    }
    // Reach altitude using the same native E key before this separate trial.
    // This higher-airspace observation cannot certify the ground-start cases.
    const climbStart=await reset();activeTrial={id:'we1-airborne-climb',start:climbStart};
    if(climbStart.stabilizationMode!=='level')await page.keyboard.press('g',{delay:50});
    await page.keyboard.down('e');const climbObservations=[],climbDeadline=performance.now()+600000;activeTrial.details={targetWorldHeightM:120,climbObservations};let climbing=await state();
    // A 120 m climb at the default 5 m/s can exceed the journal's 20 s trace.
    // Keep sparse read-only public telemetry as separate evidence; do not
    // synthesize repeat key events or re-arm the application's recorder.
    const observeClimb=t=>climbObservations.push({simTime:t.simTime,physicalStep:t.physicalStep,position:t.position,velocity:t.velocity,quaternion:t.quaternion,contactCount:t.contactCount,rigidContactCount:t.rigidContactCount,mode:t.mode,stabilizationMode:t.stabilizationMode,driverInput:t.driverInput,verticalControl:t.verticalControl,pressureBar:t.pressureBar,supplyMode:t.supplyMode});observeClimb(climbing);
    while(climbing.position.y<120&&!climbing.fault){
      const timeout=Math.max(1,climbDeadline-performance.now());if(timeout<=1)throw Error('Native E climb did not reach 120 m within the declared 600 s wall budget');
      await page.waitForFunction(nextTime=>{const t=window.roadsterLab.getState();return t.position.y>=120||t.simTime>=nextTime||t.paused||!!t.fault;},climbing.simTime+2,{polling:100,timeout});
      climbing=await state();observeClimb(climbing);console.log(JSON.stringify({trial:'native-e-climb',simTime:climbing.simTime,heightWorldM:climbing.position.y,verticalSpeedMps:climbing.velocity.y}));
      if(climbing.paused&&!climbing.fault)throw Error('Native E climb paused before its altitude threshold; original state retained');
    }
    await page.keyboard.up('e');const reached=await state();if(reached.fault)throw Error('Native altitude preparation fault: '+reached.fault);await untilTime(reached.simTime+2);await evidence('we1-airborne-climb',climbStart,{targetWorldHeightM:120,reached,climbObservations,scope:'Actual native E climb from the city start; no altitude injection. Sparse public telemetry above is independent of the bounded production trace and cannot establish contact absence between those samples.'});
    let airborne=await markedState();activeTrial={id:'we1-airborne-120m-g-on',start:airborne};await snapshot('09-we1-airborne-before');airborne=await markedState();activeTrial.start=airborne;
    await page.keyboard.down('w');const airborneWOnlyEnd=await untilTime(airborne.simTime+.25);await page.keyboard.down('e');await page.keyboard.down('1');const airborneHeld=await state();await untilTime(airborneHeld.simTime+6.5);
    await page.keyboard.up('1');await page.keyboard.up('e');await page.keyboard.up('w');const airborneReleased=await state();await snapshot('10-we1-airborne-release');await untilTime(airborneReleased.simTime+6);
    await evidence('we1-airborne-120m-g-on',airborne,{wOnlyEnd:airborneWOnlyEnd,allHeldAt:airborneHeld.simTime,actualStartWorldHeightM:airborne.position.y,release:airborneReleased,scope:'Separate high-altitude trial after crossing 120 m through native E and physically braking. The actual starting height is recorded, not assumed to equal exactly 120 m. Actual travel and contact trace determine whether a full turn and G recovery occurred; it does not certify ground-start safety, finite air supply, or physical keyboard rollover.'});activeTrial=null;await snapshot('11-we1-airborne-after');
    // Pause directly in the visible driving HUD, preserving the final physical
    // state for inspection and export without opening a menu or saving a PNG.
    inputExportPauseEvidence=await clickPlayback(true);
    if(!(await page.locator('.operation-detail').evaluate(node=>node.open)))await page.locator('[data-operation="summary"]').click();
    const expectedJournal=await page.evaluate(()=>window.roadsterLab.getInputTimeline());
    await page.evaluate(()=>{window.__inputExportTiming={};document.addEventListener('click',event=>{if(event.target.closest('[data-operation="export"]'))window.__inputExportTiming.startedAt=performance.now();},true);const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==='roadster-input-timeline.json'){window.__inputExportTiming.handedOffAt=performance.now();window.__inputExportTiming.applicationHandlerMs=window.__inputExportTiming.handedOffAt-window.__inputExportTiming.startedAt;}return original.call(this);};});
    const inputExportStarted=performance.now(),inputDownloadPromise=page.waitForEvent('download',{timeout:90000});await page.locator('[data-operation="export"]').click();const inputDownload=await inputDownloadPromise,destination=join(out,'native-input-download.json');await inputDownload.saveAs(destination);
    const inputDownloadFailure=await inputDownload.failure(),inputBytes=readFileSync(destination),exportedJournal=JSON.parse(inputBytes),expectedEvents=new Map(expectedJournal.events.map(event=>[event.sequence,event]));
    inputExportEvidence={application:await page.evaluate(()=>window.__inputExportTiming),receipt:await page.evaluate(()=>window.roadsterLab.getExportState()),automationObservedMs:performance.now()-inputExportStarted,browserDownloadFailure:inputDownloadFailure,filename:'native-input-download.json',bytes:inputBytes.length,sha256:sha(inputBytes),expectedEvents:expectedEvents.size,exportedEvents:exportedJournal.events.length,allExpectedEventsExact:expectedJournal.events.every(event=>JSON.stringify(event)===JSON.stringify(exportedJournal.events.find(value=>value.sequence===event.sequence))),identityExact:JSON.stringify(exportedJournal.identity)===JSON.stringify(expectedJournal.identity)};
    if(inputDownloadFailure||!inputExportEvidence.allExpectedEventsExact||!inputExportEvidence.identityExact)throw Error('Native input export failed or changed actual journal records');await snapshot('12-input-export-handoff');
    await reset();await page.keyboard.press('Escape');const menu=await markedState();activeTrial={id:'x-menu-refusal',start:menu};const menuX=await pressShortX('x-menu-refusal',menu,false);await evidence('x-menu-refusal',menu,{requestedKeyHoldMs:50,shortKeyEdge:menuX});activeTrial=null;await snapshot('08-menu-refusal');await page.keyboard.press('Escape');
  }
  servedIdentityAfter=await auditNativeSourceIdentity(url,{expectedBuildId:identity.modelBuildId});if(JSON.stringify(servedIdentityBefore)!==JSON.stringify(servedIdentityAfter))throw Error('Served source or baked assets changed during native controls');
}catch(error){failure={message:error.message,stack:error.stack};console.log('FAIL '+error.message);}
finally{
  for(const key of ['w','e','1','2','q','z','b','x'])try{await page.keyboard.up(key);}catch{}
  if(activeTrial)try{await evidence(activeTrial.id+'-interrupted',activeTrial.start,{...activeTrial.details,interrupted:true,failure,scope:'Incomplete active trial retained after failure; no successful maneuver or clean recovery is inferred.'});}catch(error){failure={...failure,evidenceSaveFailure:error.message};}
  const sourceAfter=sourceHashes(),localRunnerSourceUnchanged=JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter),servedSourceUnchanged=servedIdentityBefore&&servedIdentityAfter?JSON.stringify(servedIdentityBefore)===JSON.stringify(servedIdentityAfter):null;
  const runnerSourceAfter=runnerSourceHashes(),runnerSourcesUnchanged=JSON.stringify(runnerSourceBefore)===JSON.stringify(runnerSourceAfter);if(!runnerSourcesUnchanged)failure={...failure,qaRunnerOrProtocolSourceChanged:true};
  const shortKeyFailures=shortKeyEdges.filter(edge=>edge.status!=='passed-short-native-edge').map(edge=>({id:edge.id,status:edge.status,intervalsMs:edge.intervalsMs??null,failures:edge.failures}));if(shortKeyFailures.length)failure={...failure,shortKeyEdgeFailures:shortKeyFailures};
  if(!baseline&&!localRunnerSourceUnchanged)failure={...failure,sourceChangedDuringCapture:true};
  const sourceUnchanged=baseline?servedSourceUnchanged:servedSourceUnchanged===true&&localRunnerSourceUnchanged,localSourceScope=baseline?'Current candidate dist files are runner context only. Frozen baseline identity and stability are determined exclusively by the complete actual served-source audits.':'Current candidate dist file hashes supplement the complete actual served-source audits.';
  writeFileSync(join(out,'report.json'),JSON.stringify({createdAt:new Date().toISOString(),url,baseline,identity,device,sourceBefore,sourceAfter,localRunnerSourceUnchanged,localSourceScope,sourceUnchanged,servedSourceUnchanged,servedIdentityBefore,servedIdentityAfter,runnerSourceBefore,runnerSourceAfter,runnerSourcesUnchanged,keyboardProtocol,shortKeyPolicy,shortKeyEdges,cases,captures,playbackActions,inputExportPauseEvidence,inputExportEvidence,errors,consoleErrors,failure,scope:'Actual Chrome/WebGL rendering and trusted browser key/click events, production page and solver. Read-only telemetry is sampled; no physical pose, solver input, controller state or performance clock is injected. Software GPU and automation do not establish target-device FPS or physical keyboard rollover. Requested key delay and all actual observed intervals are separate evidence.'},null,2)+'\n');await browser.close();if(failure||errors.length)process.exitCode=1;
}
