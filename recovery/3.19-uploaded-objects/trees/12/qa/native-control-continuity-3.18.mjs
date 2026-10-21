import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';

// Native browser keys and visible UI only. roadsterLab is read for evidence;
// no simulation setters, synthetic time, body teleport or protected settings.
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const base=process.argv[2]||'http://127.0.0.1:8328/',out=resolve(process.argv[3]||'qa/control-continuity-3.18/native-candidate');
const kinds=(process.env.CONTINUITY_CASES||'X-release-W,G-continuous').split(',');
await mkdir(out,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const bounded=(promise,ms,label)=>new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error(`${label}: ${ms} ms wall deadline`)),ms);promise.then(v=>{clearTimeout(t);res(v);},e=>{clearTimeout(t);rej(e);});});
const report={schema:'roadster-native-control-continuity-318',startedAt:new Date().toISOString(),base,cases:[],errors:[],scope:'Real Chromium keyboard down/up, actual received browser events and production fixed-step input journal; no body, velocity or clock injection. Software rendering. Native browser input is not a physical keyboard or the user GPU. Simulated seconds and wall time are separately reported.'};
const save=()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const browser=await chromium.launch({executablePath:process.env.ROADSTER_CHROMIUM,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
report.browserVersion=browser.version();
try{
 for(const kind of kinds){
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,recordVideo:{dir:join(out,'raw-video'),size:{width:1280,height:720}}});
  const page=await context.newPage();page.setDefaultTimeout(15000);const video=page.video();
  const row={kind,status:'running',startedAt:new Date().toISOString(),events:[],stages:[],journalCheckpoints:[],loadedSources:[]},merged=new Map(),sourceReads=[];report.cases.push(row);await save();
  page.on('pageerror',e=>report.errors.push({kind,message:e.message}));page.on('response',r=>{if(r.status()>=400)report.errors.push({kind,status:r.status(),url:r.url()});if(/\/(physics|pitch-maneuver|simulation-snapshot|controls|main|model-build)\.js$/.test(new URL(r.url()).pathname)){sourceReads.push(r.body().then(bytes=>row.loadedSources.push({url:r.url(),status:r.status(),bytes:bytes.length,sha256:hash(bytes)})).catch(e=>report.errors.push({kind,url:r.url(),message:'Source response read: '+e.message})));}});
  const state=()=>bounded(page.evaluate(()=>window.roadsterLab.getState()),15000,'read public telemetry');
  async function journal(label){const j=await bounded(page.evaluate(()=>window.roadsterLab.getInputTimeline()),15000,'read received-input journal');for(const e of j.events)merged.set(e.sequence,e);row.journalCheckpoints.push({label,wallAt:new Date().toISOString(),firstSequence:j.events[0]?.sequence,lastSequence:j.events.at(-1)?.sequence,droppedInRollingBuffer:j.droppedEvents});return j;}
  async function stage(label){const s=await state();row.stages.push({label,wallAt:new Date().toISOString(),state:s});await journal(label);await save();console.log(JSON.stringify({kind,label,simTime:s.simTime,mode:s.mode,phase:s.maneuver?.phase??null,contacts:s.contactCount,pitch:s.pitchDeg,position:s.position}));return s;}
  async function key(key,down){row.events.push({key,down,requestedAt:new Date().toISOString()});await page.keyboard[down?'down':'up'](key);row.events.at(-1).returnedAt=new Date().toISOString();}
  async function tap(keyName){await key(keyName,true);await key(keyName,false);}
  const until=(start,seconds)=>page.waitForFunction(({start,seconds})=>window.roadsterLab.getState().simTime>=start+seconds,{start,seconds},{timeout:180000});
  try{
   console.log('starting '+kind+' '+base);
   await page.goto(new URL('?view=lab',base).href,{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForFunction(()=>window.roadsterReady&&window.roadsterLab,null,{timeout:60000});
   if(await page.locator('#menu-resume').isVisible())await page.locator('#menu-resume').click();
   await page.locator('[data-rc-action="observe"]').click();await page.locator('#viewport').focus();
   row.identity=await page.evaluate(async()=>{const b=await import('./model-build.js');return{modelVersion:window.roadsterLab.version,modelBuildId:b.MODEL_BUILD_ID};});
   if(process.env.EXPECTED_BUILD&&row.identity.modelBuildId!==process.env.EXPECTED_BUILD)throw Error('Loaded build does not match the requested frozen stage');
   if(process.env.EXPECTED_PHYSICS_SHA){await Promise.allSettled(sourceReads);if(!row.loadedSources.some(s=>s.url.endsWith('/physics.js')&&s.sha256===process.env.EXPECTED_PHYSICS_SHA))throw Error('Loaded physics response does not match the frozen source hash');}
   row.initial=await state();if(row.initial.paused)await page.locator('#operation-pause').click();await page.locator('#viewport').focus();
   // Start every sequence after real four-wheel settling, using the same UI.
   const ready=await state();await until(ready.simTime,1);await stage('settled');
   if(['X-release-W','Q-held-X','Q-held-U'].includes(kind)){
    const preheldQ=kind.startsWith('Q-held-'),maneuverName=kind==='Q-held-U'?'pitch':'roll';
    if((await state()).airStabilization)await tap('g');
    if(process.env.VERIFY_G_DRIVE_TOAST==='1'){
     await tap('g');await tap('g');row.gOffDrivePrompt={state:await state(),text:await page.locator('#toast').innerText()};
     if(row.gOffDrivePrompt.state.mode!=='drive'||row.gOffDrivePrompt.state.airStabilization||!row.gOffDrivePrompt.text.includes('当前为 DRIVE')||row.gOffDrivePrompt.text.includes('按 H'))throw Error('G-off DRIVE prompt did not reflect the actual current mode');
     const png=await page.screenshot({path:join(out,'G-off-drive-prompt.png'),timeout:15000});row.gOffDrivePrompt.frame={file:'G-off-drive-prompt.png',bytes:png.length,sha256:hash(png)};await stage('G-off-while-already-DRIVE-prompt-checked');
    }
    await key(preheldQ?'q':'w',true);const start=(await state()).simTime;await until(start,.5);
    row.beforeAction=await state();await tap(maneuverName==='pitch'?'u':'x');if(!preheldQ)await key('w',false);row.afterAction=await stage(preheldQ?'explicit-action-requested-with-Q-already-held':'X-requested-and-W-released');
    const actionStart=row.afterAction.maneuverFeedback?.current?.startedAtSimTimeS??row.afterAction.maneuverFeedback?.lastRun?.startedAtSimTimeS??row.afterAction.simTime;
    // Read in bounded chunks so failed states and the rolling journal survive.
    let observation=null;
    for(let part=0;part<7;part++){
     const now=await state(),feedback=now.maneuverFeedback?.lastRun;
     if(feedback?.name===maneuverName&&feedback.state==='completed'){
      row.completionFirstObserved=now;const completionS=feedback.endedAtSimTimeS??now.simTime;
      await until(completionS,5.05);observation=await stage('five-seconds-after-completion');break;
     }
     if(now.simTime-actionStart>=12.5){observation=now;break;}
     await until(now.simTime,2);await stage('X-continuous-observation-'+part);
    }
    row.final=observation??await state();row.status=row.final.maneuverFeedback?.lastRun?.name===maneuverName&&row.final.maneuverFeedback.lastRun.state==='completed'&&row.final.mode==='drive'&&row.final.contactCount===4?'completed-with-post-observation':'persistent-incomplete-landing-recorded';
    if(preheldQ){
     const actualTravel=row.final.maneuverFeedback?.lastRun?.[maneuverName==='pitch'?'actualPitchTravelDeg':'actualRollTravelDeg'];
     if(row.status!=='completed-with-post-observation'||Math.abs(actualTravel)<355)throw Error('Pre-held Q bypassed the complete physical action or stable landing');
     await key('q',false);row.driveResponse=await page.locator('#control-response-mode').textContent();
     if(!row.driveResponse.includes('当前为 DRIVE')||row.driveResponse.includes('按 H 返回 DRIVE'))throw Error('DRIVE control-response text implies already-active H assistance');
    }
    if(process.env.VERIFY_DRIVE_HANDOFF==='1'&&row.status==='completed-with-post-observation'){
     row.beforeDriveHandoff=await state();await key('w',true);const resumed=(await state()).simTime;await until(resumed,1);await key('w',false);row.afterDriveHandoff=await stage('W-resumed-after-five-second-ground-observation');
     if(row.afterDriveHandoff.mode!=='drive'||row.afterDriveHandoff.contactCount!==4||row.afterDriveHandoff.forwardSpeedKmh<=row.beforeDriveHandoff.forwardSpeedKmh+3||Math.hypot(...row.afterDriveHandoff.desiredWrench)>.01)throw Error('Native W did not restore ordinary four-wheel driving after X');
    }
   }else if(kind==='G-continuous'){
    if((await state()).airStabilization)await tap('g');
    await tap('h');let s=await state();await until(s.simTime,6);row.beforeG=await stage('explicit-H-flight');
    await tap('g');await key('w',true);s=await state();await until(s.simTime,5);row.beforeGoff=await stage('G-on-W-moving');
    await tap('g');await key('w',false);row.release=await stage('G-off-W-released');
    for(let i=0;i<4;i++){s=await state();await until(s.simTime,2);await stage('G-off-release-observation-'+i);}
    row.beforeReopen=await state();await tap('g');await key('w',true);s=await state();await until(s.simTime,2);row.reopenMoving=await stage('G-reopened-with-W');
    await key('w',false);s=await state();await until(s.simTime,3);row.reopenReleased=await stage('G-reopened-W-released');
    await tap('g');s=await state();await until(s.simTime,2);row.final=await stage('G-off-again');row.status='continuous-G-transitions-recorded';
   }else if(['moving-H-and-hold-exit','hold-exit-focused'].includes(kind)){
    if((await state()).airStabilization)await tap('g');
    row.initialDriveResponse=await page.locator('#control-response-mode').textContent();
    if(!row.initialDriveResponse.includes('当前为 DRIVE')||row.initialDriveResponse.includes('按 H 返回 DRIVE'))throw Error('Initial DRIVE control-response text misstates ownership');
    await tap('h');let s=await state();await until(s.simTime,6);await stage('explicit-H-takeoff');
    if(kind==='moving-H-and-hold-exit'){
    await key('w',true);s=await state();await until(s.simTime,3);row.beforeHExit=await stage('W-translation-before-H-switch');
    await key('w',false);await tap('h');s=await state();await until(s.simTime,.1);row.coastingDrive=await stage('H-DRIVE-coast-without-W');
    await tap('h');row.movingHEntry=await stage('H-reentered-while-coasting');
    if(row.movingHEntry.mode!=='hover'||row.movingHEntry.controlOwnership.positionPolicy!=='pilot-or-release-braking')throw Error('Moving H entry did not begin physical braking before capture');
    for(let part=0;part<4;part++){s=await state();await until(s.simTime,2);await stage('H-brake-then-capture-'+part);}
    row.stoppedAfterH=await state();
    if(row.stoppedAfterH.reference.position.z<row.coastingDrive.position.z+1||Math.abs(row.stoppedAfterH.velocity.z)>.2)throw Error('Moving H did not capture its physically reached stopping region');
    }
    await tap('m');await page.locator('[data-rc-tab="controls"]').click();
    await page.locator('[data-rc-action="capture"]').click();row.capturedResearchHold=await stage('visible-research-capture-current-pose');
    if(row.capturedResearchHold.stabilizationMode!=='hold')throw Error('Visible capture action did not request research hold');
    await page.locator('[data-rc-action="observe"]').click();await page.locator('#viewport').focus();
    await tap('h');row.afterHoldExitBeforePhysics=await stage('H-exits-research-hold-to-DRIVE');
    // Telemetry immediately after a mode event can still contain the previous
    // integrated control sample. Observe the next real fixed steps, including
    // the physical valve tail, before checking that no new force is requested.
    await until(row.afterHoldExitBeforePhysics.simTime,.025);row.afterHoldExit=await stage('H-exit-after-next-real-control-steps');
    row.driveResponse=await page.locator('#control-response-mode').textContent();
    if(row.afterHoldExit.mode!=='drive'||row.afterHoldExit.stabilizationMode!=='off'||row.afterHoldExit.controlOwnership.commandForceN!==0)throw Error('Research hold exit armed or retained unrequested assistance');
    if(!row.driveResponse.includes('当前为 DRIVE')||row.driveResponse.includes('按 H 返回 DRIVE'))throw Error('Post-hold DRIVE control-response text misstates ownership');
    s=await state();await until(s.simTime,2);row.final=await stage('DRIVE-remains-unassisted-after-hold-exit');
    row.status=kind==='hold-exit-focused'?'hold-exit-continuous-window-recorded':'moving-H-braking-and-hold-exit-recorded';
   }else if(kind==='manual-WE1'){
    if(!(await state()).airStabilization)await tap('g');
    await key('w',true);let s=await state();await until(s.simTime,.5);row.beforeAdditionalKeys=await state();
    await key('e',true);await key('1',true);s=await state();await until(s.simTime,6.5);row.manualEnd=await stage('manual-W-E-1-held');
    await key('1',false);await key('e',false);s=await state();await until(s.simTime,5);row.final=await stage('manual-release-W-held');await key('w',false);row.status='manual-outcome-recorded';
   }else throw Error('Unknown native protocol '+kind);
   await journal('final');
   const s=await state();if(!s.paused)await page.locator('#operation-pause').click();
   const shot=await page.screenshot({path:join(out,kind+'.png'),timeout:15000});row.frame={file:kind+'.png',bytes:shot.length,sha256:hash(shot)};
  }catch(error){
   row.status='protocol-failed';row.failure={message:error.message,stack:error.stack};process.exitCode=1;
   try{row.failureState=await state();await journal('failure');await page.screenshot({path:join(out,kind+'-failure.png'),timeout:10000});}catch(e){row.failureCapture=e.message;}
  }finally{
   await Promise.allSettled(sourceReads);
   const events=[...merged.values()].sort((a,b)=>a.sequence-b.sequence),physics=events.filter(e=>e.type==='physics-input');
   const payload={schema:'roadster-native-merged-input-journal',identity:row.identity,source:'Overlapping read-only production journal checkpoints merged by original sequence; never interpolated.',checkpoints:row.journalCheckpoints,events};
   const data=gzipSync(JSON.stringify(payload)+'\n',{level:9}),file=kind+'-input.json.gz';await writeFile(join(out,file),data);
   const sequenceGaps=events.slice(1).map((e,i)=>({before:events[i].sequence,after:e.sequence})).filter(g=>g.after>g.before+1);
   row.journal={file,bytes:data.length,sha256:hash(data),firstSimS:physics[0]?.simTime,lastSimS:physics.at(-1)?.simTime,physicsSamples:physics.length,sequenceGaps,receivedKeys:events.filter(e=>['keydown','keyup','action-receipt','input-release'].includes(e.type))};
   if(['X-release-W','Q-held-X','Q-held-U'].includes(kind)){
    const end=row.final?.maneuverFeedback?.lastRun?.endedAtSimTimeS;
    const post=Number.isFinite(end)?physics.filter(e=>e.simTime>=end):[];
    row.postCompletion={completionSimS:end??null,observedS:post.length?post.at(-1).simTime-end:0,minWheelContacts:post.length?Math.min(...post.map(e=>e.actual?.wheelContactCount??-1)):null,allDrive:post.length?post.every(e=>e.mode==='drive'):null,maxDesiredWrenchMagnitude:post.length?Math.max(...post.map(e=>Math.hypot(...e.desiredWrench))):null};
   }
   try{await bounded(context.close(),20000,'close browser context and flush video');await bounded(video.saveAs(join(out,kind+'.webm')),20000,'save recorded video');const bytes=await readFile(join(out,kind+'.webm'));row.video={file:kind+'.webm',bytes:bytes.length,sha256:hash(bytes)};}catch(e){row.videoFailure=e.message;}
   row.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({kind,status:row.status,postCompletion:row.postCompletion,video:row.video,videoFailure:row.videoFailure}));
  }
 }
}finally{report.finishedAt=new Date().toISOString();report.status=report.cases.some(c=>c.status==='protocol-failed')?'incomplete':'protocols-executed-outcomes-recorded';await save();await bounded(browser.close(),20000,'close Chromium').catch(e=>console.log(e.message));}
