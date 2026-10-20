import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RoadsterSim} from '../dist/physics.js';
import {InputSession} from '../dist/input-session.js';
import {ExperimentRecorder,executeExperiment,contentLabel} from '../dist/experiment-records.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const checks=[],cases=[],records=[],dt=1/120,steps=180,hash=x=>createHash('sha256').update(x).digest('hex');
const check=(name,pass,detail={})=>{checks.push({name,passed:!!pass,...detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
function fixture(supplyMode='bench'){
  const s=new RoadsterSim({supplyMode,regenForce:0});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.geometry=s.geometry.filter(g=>g.id==='ground');s.reset('free');
  s._addBox('step-contract','step',[12,.1,60],[0,.05,30]);s.body.position.set(0,.62,-12);for(let i=0;i<180;i++)s.advanceFixed({brake:1});
  s.body.velocity.set(0,0,25);s.wheelStates.forEach(w=>w.angularVelocityRadS=25/s.params.wheelRadius);
  s.setObservation({enabled:true,delayMs:500,seed:41239,positionNoiseM:.005,velocityNoiseMps:.01,attitudeNoiseDeg:.05,angularRateNoiseRadS:.002});return s;
}
for(const supply of ['bench','finite']){
  const s=fixture(supply),seed=s._observationSeed,startStep=s._stepCount,startTime=s.simTime,startGas=s.gasMass,startExternal=s._externalGasKg,startOnboard=s._gasConsumedKg;
  const initial=s.exportState(),session=new InputSession();let record,sliceCount=0,controlCalls=0,refined=0,held=true,gasIntegral=0,impulseIntegral=0,endSampleGas=0,maxHistory=0,contactSlices=0,maxRigid=0,previousSeed=seed;
  const recorder=new ExperimentRecorder({getSim:()=>s,getContext:()=> 'city',onFinish:r=>record=r,now:()=> '2026-10-20T00:00:00.000Z'});recorder.start({name:`接触微步契约 ${supply}`});
  const actualStep=s.world.step.bind(s.world);let observedSeeds=[];s.world.step=sliceDt=>{observedSeeds.push(s._observationSeed);sliceCount++;return actualStep(sliceDt);};
  for(let i=0;i<steps;i++){
    observedSeeds=[];const pair=i%20<10?.02:.05,input={frontJets:pair,rearJets:pair};
    s.step(dt,()=>{controlCalls++;return recorder.beforeStep(input);},undefined,(t,applied,interval)=>{
      recorder.afterStep(t,applied,interval);session.step(t,applied);const x=t.integration;refined+=Number(x.substeps>1);gasIntegral+=x.gasThroughputKg;impulseIntegral+=x.deliveredImpulseNs;endSampleGas+=t.massFlowKgS*interval;contactSlices+=x.contactMicrosteps;maxRigid=Math.max(maxRigid,x.maxRigidContacts);
      assert.equal(x.completedSubsteps,x.substeps);assert.equal(t.physicalStep,startStep+i+1);assert.ok(Math.abs(x.controlDtS-dt)<1e-12);assert.ok(Math.abs(x.substepDtS*x.substeps-dt)<1e-12);
    });
    const expected=(previousSeed+12*0x6D2B79F5)>>>0;held&&=s._observationSeed===expected&&observedSeeds.every(value=>value===expected);previousSeed=s._observationSeed;maxHistory=Math.max(maxHistory,s._observationHistory.length);
  }
  recorder.finish();records.push(record);const replay=await executeExperiment(record,{createSim:snapshot=>fixture(snapshot.params.supplyMode),yieldEvery:0});
  const independentGas=supply==='bench'?s._externalGasKg-startExternal:startGas-s.gasMass,events=session.export().events.filter(e=>e.type==='physics-input');
  const row={supply,initialSnapshotLabel:contentLabel(initial),controlSteps:steps,controlCalls,actualIntegrationSlices:sliceCount,refinedControlSteps:refined,actualDurationS:s.simTime-startTime,initialObservationSeed:seed,finalObservationSeed:s._observationSeed,expectedNoiseDraws:12*steps,observationHeldAcrossEachControlStep:held,maximumDelaySamples:maxHistory,gasIntegralKg:gasIntegral,independentGasKg:independentGas,endOfStepRiemannGasKg:endSampleGas,endSampleGasErrorKg:endSampleGas-independentGas,impulseIntegralNs:impulseIntegral,totalDeliveredImpulseNs:s._impulseNs,contactSlices,maxRigidContacts:maxRigid,recordGasKg:record.summary.gasThroughputKg,recordStepCount:record.stepCount,replayStatus:replay.status,replaySummaryExact:JSON.stringify(replay.summary)===JSON.stringify(record.summary),replayPhysicalSnapshotExact:JSON.stringify(replay.finalSnapshot.physical)===JSON.stringify(record.finalSnapshot.physical),externalDeltaKg:s._externalGasKg-startExternal,onboardDeltaKg:s._gasConsumedKg-startOnboard,inputEvents:events.length,inputContactEvidence:events.some(e=>e.actual.wheelContactCount>0&&Number.isInteger(e.actual.rigidContactCount)&&e.integration.contactMicrosteps>0)};cases.push(row);
}
check('The caller, input journal, recorder and seeded delayed observation retain 120 Hz while the real contact integration refines',cases.every(c=>c.controlCalls===steps&&c.inputEvents===steps&&c.recordStepCount===steps&&c.actualIntegrationSlices>steps&&c.refinedControlSteps>0&&Math.abs(c.actualDurationS-steps*dt)<1e-9&&c.observationHeldAcrossEachControlStep&&c.maximumDelaySamples<=62));
check('Every delivered kilogram and nozzle impulse is integrated across all contact slices, not inferred from the last instantaneous sample',cases.every(c=>Math.abs(c.gasIntegralKg-c.independentGasKg)<1e-8&&Math.abs(c.recordGasKg-c.independentGasKg)<1e-8&&Math.abs(c.impulseIntegralNs-c.totalDeliveredImpulseNs)<1e-6)&&cases.some(c=>Math.abs(c.endSampleGasErrorKg)>1e-4),{lastSampleErrorKg:cases.map(c=>({supply:c.supply,error:c.endSampleGasErrorKg}))});
check('Finite and bench supply remain distinct during refined contacts',cases.find(c=>c.supply==='finite').externalDeltaKg===0&&cases.find(c=>c.supply==='bench').onboardDeltaKg===0);
check('The actual recorded contact episode replays with an identical full physical terminal snapshot and raw summary, including noise and delay state',cases.every(c=>c.replayStatus==='completed'&&c.replaySummaryExact&&c.replayPhysicalSnapshotExact));
check('Input evidence includes wheel and rigid contacts and retains brief contacts from earlier microsteps',cases.every(c=>c.inputContactEvidence&&c.contactSlices>0&&c.maxRigidContacts>0));
{
  const s=fixture();s._addBox('partial-step-safety-fixture','step',[10,.1,10],[665,.05,-350]);s.body.position.set(650,.62,-350);s.body.velocity.set(100000,-2,0);const before=s._stepCount,t=s.advanceFixed({throttle:.25}),failure=t.failure;
  check('A failure inside an unfinished contact-refined tick records its partial integration without fabricating a completed control step',failure?.phase==='after-contact-substep'&&failure.triggerStep===before&&failure.triggerPhysical.integration.controlStep===before+1&&failure.triggerPhysical.integration.completedSubsteps<failure.triggerPhysical.integration.substeps&&failure.triggerPhysical.integration.completedSubsteps>0,{failure:failure?{phase:failure.phase,triggerStep:failure.triggerStep,simTimeS:failure.triggerSimTime,integration:failure.triggerPhysical.integration}:null});
}
const archive=gzipSync(Buffer.from(JSON.stringify({schema:'roadster-contact-step-contract-records',version:1,records})+'\n'),{level:9}),archiveName='contact-step-contract-3.16.records.json.gz';writeFileSync(new URL('../qa/'+archiveName,import.meta.url),archive);
const paths=['dist/physics.js','dist/contact-step-schedule.js','dist/input-session.js','dist/experiment-records.js','dist/control-observation.js','dist/simulation-snapshot.js'];
const report={schema:'roadster-contact-step-contract-evidence',version:1,createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:checks.every(c=>c.passed)?'passed':'failed',checks,cases,sourceHashes:Object.fromEntries(paths.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))])),archive:{file:archiveName,bytes:archive.length,sha256:hash(archive)},limits:['The synthetic 90 km/h step episode with alternating direct valves verifies sampling, accounting and exact continuation. It is not a claim of safe or converged impact behavior.','Noisy flight observation is sampled once per caller interval and held during contact refinement. Ideal-state control uses the actual state on every force-integration slice.','Gas/impulse integrals are exact physical counter deltas. The displayed mass-flow and thrust values remain instantaneous end-of-interval samples.']};
writeFileSync(new URL('../qa/contact-step-contract-3.16.json',import.meta.url),JSON.stringify(report,null,2)+'\n');assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
