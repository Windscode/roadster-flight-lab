import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as CANNON from '../dist/vendor/cannon-es.js';
import {RoadsterSim} from '../dist/physics.js';
import {RoadsterSim as BeforeSim} from './fixtures/physics-3.16-before/physics.js';
import {installCoulombContactFriction} from '../dist/contact-friction.js';
import {installContactLedger} from '../dist/contact-ledger.js';
import {ExperimentRecorder,prepareRecordedStateForCurrentModel} from '../dist/experiment-records.js';
import {parseLandingArchive,loadLandingLibrary,LANDING_LIBRARY_KEY,reexecuteLandingTask} from '../dist/landing-challenge.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {assertHistoricalReadOnly,assertCurrentSnapshotRejected} from './history-contract-3.14.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex'),checks=[],analytic=[],cases=[],trace=[];
const currentVariant=`after-${REPORT_VERSION}`;
const check=(name,pass,details={})=>{checks.push({name,passed:!!pass,...details});console.log((pass?'PASS ':'FAIL ')+name);};
const vec=v=>({x:v.x,y:v.y,z:v.z}),state=s=>({position:vec(s.body.position),velocity:vec(s.body.velocity),quaternion:{...s.body.quaternion},angularVelocity:vec(s.body.angularVelocity)});
const tilt=s=>Math.acos(Math.max(-1,Math.min(1,1-2*(s.body.quaternion.x**2+s.body.quaternion.z**2))))*180/Math.PI;
const distance=(a,b)=>Math.hypot(...['x','y','z'].map(k=>a[k]-b[k]));
function slider({fixed,hz,mass,diagonal=false}){
  const world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});world.solver.iterations=16;world.solver.tolerance=1e-7;
  world.defaultContactMaterial.friction=.35;world.defaultContactMaterial.restitution=0;
  const body=new CANNON.Body({mass,position:new CANNON.Vec3(0,.5,0),linearDamping:0,angularDamping:0,fixedRotation:true});
  body.addShape(new CANNON.Box(new CANNON.Vec3(.5,.5,.5)));world.addBody(body);
  const floor=new CANNON.Body({mass:0,position:new CANNON.Vec3(0,-.5,0)});floor.addShape(new CANNON.Box(new CANNON.Vec3(100,.5,100)));world.addBody(floor);
  const sim={world,body,wheelStates:[],simTime:0,_integration:{}};if(fixed)installCoulombContactFriction(sim);
  for(let i=0;i<hz*2;i++)world.step(1/hz);body.velocity.set(diagonal?10/Math.sqrt(2):0,0,diagonal?10/Math.sqrt(2):10);
  let excess=0;for(let i=0;i<hz;i++){sim._integration={};world.step(1/hz);excess=Math.max(excess,sim._integration.contactFriction?.maxBudgetExcessNs??0);}
  return{fixed,hz,mass,diagonal,expectedSpeedMps:10-.35*9.81,actualSpeedMps:Math.hypot(body.velocity.x,body.velocity.z),maximumCoulombBudgetExcessNs:excess};
}
for(const fixed of [false,true])for(const hz of [60,120,240])for(const mass of [100,2000])for(const diagonal of [false,true])analytic.push(slider({fixed,hz,mass,diagonal}));
check('Independent Coulomb slider matches v0-mu*g*t for mass, step and direction variants',analytic.filter(r=>r.fixed).every(r=>Math.abs(r.actualSpeedMps-r.expectedSpeedMps)<1e-5&&r.maximumCoulombBudgetExcessNs<1e-8),{baseline:analytic.filter(r=>!r.fixed),corrected:analytic.filter(r=>r.fixed)});
check('The unmodified solver demonstrably violates the same independent friction oracle',analytic.filter(r=>!r.fixed).every(r=>Math.abs(r.actualSpeedMps-r.expectedSpeedMps)>1));

function fixture(Sim,{single=false,height=0,speedKmh=0}={}){
  const s=new Sim({regenForce:0});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.geometry=s.geometry.filter(g=>g.id==='ground');s.reset('free');s.setAirStabilization(false);
  if(height)s._addBox('fixture-step','step',single?[.6,height,.8]:[12,height,60],single?[-.89,height/2,.4]:[0,height/2,30]);
  s.body.position.set(0,.62,-12);for(let i=0;i<180;i++)s.advanceFixed({brake:1});s.body.velocity.set(0,0,speedKmh/3.6);s.wheelStates.forEach(w=>w.angularVelocityRadS=speedKmh/3.6/s.params.wheelRadius);if(Sim===BeforeSim)installContactLedger(s);return s;
}
function summary(){return{contactControlSteps:0,normalEquations:0,wheelStopEquations:0,hullEquations:0,duplicatePointEquations:0,normalImpulseNs:0,normalWorkJ:0,frictionWorkJ:0,constraintKineticDeltaJ:0,maxAbsoluteWorkResidualJ:0,maxNormalForceN:0,maxCoulombBudgetExcessNs:0,pairs:{},firstContact:null};}
function account(sum,s,timeS){
  const l=s._integration?.contactLedger;if(!l)return;sum.contactControlSteps++;sum.firstContact??={timeS,state:state(s),ledger:structuredClone(l)};
  for(const [a,b]of [['normalEquations','normalEquationCount'],['wheelStopEquations','wheelStopEquations'],['hullEquations','hullEquations'],['duplicatePointEquations','duplicatePointEquations'],['normalImpulseNs','normalImpulseNs'],['normalWorkJ','normalWorkJ'],['frictionWorkJ','frictionWorkJ'],['constraintKineticDeltaJ','constraintKineticDeltaJ']])sum[a]+=l[b];
  sum.maxAbsoluteWorkResidualJ=Math.max(sum.maxAbsoluteWorkResidualJ,Math.abs(l.workResidualJ));sum.maxNormalForceN=Math.max(sum.maxNormalForceN,l.peakNormalForceN);sum.maxCoulombBudgetExcessNs=Math.max(sum.maxCoulombBudgetExcessNs,s._integration.contactFriction?.maxBudgetExcessNs??0);
  for(const p of l.pairs){if(!sum.pairs[p.id])sum.pairs[p.id]={...p};else{for(const k of ['equations','normalImpulseNs','normalWorkJ'])sum.pairs[p.id][k]+=p[k];sum.pairs[p.id].peakNormalForceN=Math.max(sum.pairs[p.id].peakNormalForceN,p.peakNormalForceN);}}
}
function run(variant,Sim,{hz=120,single=false,height=.1,speedKmh=90,seconds=3,inputAt=()=>({}),kind='severe'}={}){
  const s=fixture(Sim,{single,height,speedKmh}),id=`${variant}-${kind}-${single?'single':'full'}-${hz}`,contacts=summary(),trajectoryHash=createHash('sha256');let peakTilt=0,peakRawDepth=0;
  const initial=s.exportState();for(let i=0;i<hz*seconds;i++){
    const input=inputAt(i);s._advance(1/hz,input);peakTilt=Math.max(peakTilt,tilt(s));peakRawDepth=Math.max(peakRawDepth,0,...s.getContactDiagnostics().map(c=>c.penetrationM));account(contacts,s,(i+1)/hz);
    const actual=state(s);trajectoryHash.update(JSON.stringify(actual));trace.push(JSON.stringify({id,step:i+1,timeS:(i+1)/hz,dt:1/hz,input,...actual,wheelContacts:s._contactCount,wheelSupports:s.wheelStates.map(w=>({id:w.id,objectId:w.contactObjectId,lengthM:w.suspensionLength,loadN:w.normalLoadN,normal:w.contactNormalWorld,point:w.contactPointWorld})),contactLedger:s._integration.contactLedger??null,friction:s._integration.contactFriction??null}));if(s._fault)break;
  }
  const row={id,variant,kind,hz,single,heightM:height,speedKmh,seconds,initial,final:{...state(s),mode:s.mode,contacts:s._contactCount,fault:s._fault},peakTiltDeg:peakTilt,peakPostStepEquationDepthM:peakRawDepth,contacts,trajectorySha256:trajectoryHash.digest('hex')};cases.push(row);console.log(`${id}: tilt ${peakTilt.toFixed(3)} deg, peak normal ${(contacts.maxNormalForceN/1e6).toFixed(3)} MN, work residual ${contacts.maxAbsoluteWorkResidualJ.toExponential(2)} J`);return row;
}
for(const [variant,Sim]of [['before-3.16',BeforeSim],[currentVariant,RoadsterSim]])for(const hz of [480,960,1920])for(const single of [false,true])run(variant,Sim,{hz,single});
for(const [variant,Sim]of [['before-3.16',BeforeSim],[currentVariant,RoadsterSim]]){
  for(const single of [false,true])run(variant,Sim,{single,height:.02,speedKmh:20,seconds:5,kind:'ordinary-seam'});
  run(variant,Sim,{height:0,speedKmh:100,seconds:8,inputAt:()=>({brake:1}),kind:'straight-brake'});
  run(variant,Sim,{height:0,speedKmh:20,seconds:4,inputAt:()=>({steer:.4,throttle:.1}),kind:'ordinary-steer'});
}
check('Contact work equals the actual solver kinetic jump at fixed pose',cases.every(r=>r.contacts.maxAbsoluteWorkResidualJ<1e-6),{scope:'Constraint work only. External forces, suspension and changing geometry are excluded and are not claimed to be globally energy closed.'});
check('Corrected real-car tangential impulses stay inside their own contact normal budget',cases.filter(r=>r.variant===currentVariant).every(r=>r.contacts.maxCoulombBudgetExcessNs<1e-8));
const regressions=cases.filter(r=>r.variant===currentVariant&&r.kind!=='severe').map(r=>{const before=cases.find(b=>b.variant==='before-3.16'&&b.kind===r.kind&&b.single===r.single);return{kind:r.kind,single:r.single,beforeFinal:before.final,afterFinal:r.final,identicalAllStepTrajectory:before.trajectorySha256===r.trajectorySha256,peakTiltDeg:r.peakTiltDeg};});
check('Ordinary seam, braking and steering preserve the full 3.16 physical trajectory',regressions.every(r=>r.identicalAllStepTrajectory&&!r.afterFinal.fault&&r.peakTiltDeg<15));
const convergence=[];for(const variant of ['before-3.16',currentVariant])for(const single of [false,true]){
  const rates=[480,960,1920].map(hz=>cases.find(r=>r.variant===variant&&r.kind==='severe'&&r.hz===hz&&r.single===single));
  const deltas=rates.slice(1).map((r,i)=>({fromHz:rates[i].hz,toHz:r.hz,positionDeltaAt3sM:distance(rates[i].final.position,r.final.position),velocityDeltaAt3sMps:distance(rates[i].final.velocity,r.final.velocity),peakTiltDeltaDeg:Math.abs(rates[i].peakTiltDeg-r.peakTiltDeg)}));
  convergence.push({variant,single,status:'NOT_CONVERGED_FULL_TRAJECTORY',deltas,reason:'The 1920 Hz refinement changes the full impact outcome; a corrected friction budget and smaller overlap do not validate severe-impact convergence.'});
}
check('Severe failures retain complete 480/960/1920 Hz before and after trajectories',cases.filter(r=>r.kind==='severe').length===12&&convergence.every(r=>r.status==='NOT_CONVERGED_FULL_TRAJECTORY'),{claim:'Evidence completeness only, not a passing severe-impact result.'});

// The old 3.16 -> 3.17 adapter is not a 3.18 full-state migration contract.
// Keep the delivered history and prior 3.17 evidence intact; reject unavailable
// historical state import and task execution, while retaining read/export.
const currentWorld=snapshot=>new RoadsterSim(snapshot.params,{world:snapshot.worldType});
const oldLabPath='qa/native-ui-3.16/final-81926/current-model-task.json',oldLabURL=new URL('../'+oldLabPath,import.meta.url),oldLabBytes=readFileSync(oldLabURL),oldLab=JSON.parse(oldLabBytes);
const oldLabArchive=parseLandingArchive(oldLabBytes.toString('utf8')),oldLabArchiveText=JSON.stringify(oldLabArchive);let taskHistoryWrites=0;
const taskStorage={getItem:key=>key===LANDING_LIBRARY_KEY?oldLabArchiveText:null,setItem(){taskHistoryWrites++;throw Error('History reads and exports must not save');}},loadedTask=loadLandingLibrary(taskStorage);
assert.equal(loadedTask.warning,null);assert.deepEqual(loadedTask.value.records,[oldLab]);assert.deepEqual(parseLandingArchive(JSON.stringify(loadedTask.value)),oldLabArchive);assert.equal(taskHistoryWrites,0);assert.equal(taskStorage.getItem(LANDING_LIBRARY_KEY),oldLabArchiveText);
const oldTaskDestination=currentWorld(oldLab.initialSnapshot.physical),oldTaskDestinationBefore=oldTaskDestination.exportState();
assert.throws(()=>prepareRecordedStateForCurrentModel(oldLab,oldTaskDestination,{recompute:true}),{name:'Error',message:'没有此历史模型的显式状态迁移器'});assert.deepEqual(oldTaskDestination.exportState(),oldTaskDestinationBefore);
// The task API builds its ordinary settled current fixture before checking the
// archived identity. Record those 240 preparation steps honestly; neither the
// historical state nor its task controller may be imported/started.
const taskCalls={advanceFixed:0,importState:0,setPoseTarget:0},taskMethods=Object.fromEntries(Object.keys(taskCalls).map(key=>[key,Object.getOwnPropertyDescriptor(RoadsterSim.prototype,key)]));
try{
  for(const key of Object.keys(taskCalls)){const original=taskMethods[key].value;Object.defineProperty(RoadsterSim.prototype,key,{...taskMethods[key],value:function(...args){taskCalls[key]++;return original.apply(this,args);}});}
  await assert.rejects(reexecuteLandingTask(oldLab,{yieldEvery:0}),{name:'Error',message:'Original task model/build is not installed; old results remain viewable/exportable. Create a new current-model task explicitly.'});
}finally{for(const key of Object.keys(taskCalls))Object.defineProperty(RoadsterSim.prototype,key,taskMethods[key]);}
assert.deepEqual(readFileSync(oldLabURL),oldLabBytes);assert.deepEqual(oldLabArchive.records,[oldLab]);
const oldLabHistory={sourceIdentity:oldLab.identity,recordType:oldLab.schema,execution:'historical-task-refused-before-import-or-controller-start',historyViewAndExportRetained:true,originalFileBytesUnchanged:true,archiveValuesUnchanged:true,storageWrites:taskHistoryWrites,physicalImports:taskCalls.importState,fixtureSettlingSteps:taskCalls.advanceFixed,taskStartRequests:taskCalls.setPoseTarget,fullStatePreparation:'explicitly-refused-no-migrator',scope:'The task API prepares a new current-model fixture for 240 settling steps before refusing the unavailable historical identity. No historical state is imported and no task controller starts; this does not claim zero physical steps in fixture preparation.'};
check('Real delivered 3.16 laboratory task retains original bytes and export but refuses undeclared current-model migration',oldLabHistory.physicalImports===0&&oldLabHistory.fixtureSettlingSteps===240&&oldLabHistory.taskStartRequests===0,{sourceFile:oldLabPath,sourceSha256:hash(oldLabBytes),legacyMigrationEvidence:'qa/contact-impulse-3.17.json',...oldLabHistory});

// Test geometry independently: both the recorded state and destination use the
// genuine current model. The destination adds a real collision fixture; no old
// snapshot version or geometry signature is rewritten to manufacture migration.
const lab=currentWorld(oldLab.initialSnapshot.physical),geometryRecorder=new ExperimentRecorder({getSim:()=>lab,getContext:()=> 'lab'});
geometryRecorder.start({name:`${REPORT_VERSION} current-model geometry rejection fixture`});
const geometryInput=geometryRecorder.beforeStep({}),geometryTelemetry=lab.advanceFixed(geometryInput);geometryRecorder.afterStep(geometryTelemetry,geometryInput);
const geometryRecord=geometryRecorder.finish(),mismatchedWorld=snapshot=>{const destination=currentWorld(snapshot);destination._addBox('current-geometry-mismatch','fixture',[1,1,1],[30,1,30]);return destination;};
const currentGeometryRejection=await assertCurrentSnapshotRejected({record:geometryRecord,createSim:mismatchedWorld,message:'快照不可恢复：场景几何或世界类型不匹配'});
check('A genuine current-model laboratory snapshot independently refuses a changed collision world before integration',currentGeometryRejection.physicalSteps===0&&currentGeometryRejection.destinationUnchanged,{...currentGeometryRejection,recordIdentity:geometryRecord.identity,sourceGeometrySignature:geometryRecord.initialSnapshot.physical.geometrySignature,destinationGeometrySignature:mismatchedWorld(geometryRecord.initialSnapshot.physical).exportState().geometrySignature});

const sourcePath='qa/city-drive-native-3.16/native-experiment.json',sourceURL=new URL('../'+sourcePath,import.meta.url),sourceBytes=readFileSync(sourceURL),source=JSON.parse(sourceBytes),s=new RoadsterSim(source.initialSnapshot.physical.params);
const oldCityHistory=await assertHistoricalReadOnly({source,bytes:sourceBytes,path:sourceURL,createSim:currentWorld}),oldCityRejected=oldCityHistory.execution==='rejected-before-import-and-integration',oldCityReason=oldCityHistory.reason;
// Current city has intentionally added/moved solid architecture. Establish a
// fresh, declared current-world initial condition; never rewrite an old hash.
s.reset('free');s.body.position.set(-200,.62,-345);s.body.quaternion.set(0,0,0,1);s.body.aabbNeedsUpdate=true;for(let i=0;i<124;i++)s.advanceFixed({});
const recorder=new ExperimentRecorder({getSim:()=>s,getContext:()=> 'city'});recorder.start({name:`${REPORT_VERSION} continuous city contact provenance`,kind:'manual',lineage:{sourceId:source.id,sourceIdentity:source.identity,sourceSha256:hash(sourceBytes),meaning:'New current-world experiment using the prior effective input program as a route reference. No claim of the old physical world or exact replay.'}});
const cityContacts=summary(),cityTrace=[],startPosition=vec(s.body.position),cityGeometry=s.exportState().geometrySignature;let step=0,pathLength=0,previous=vec(s.body.position),firstHull=null,peakSpeed=0,peakTilt=0;
for(const run of source.inputRuns)for(let i=0;i<run.steps;i++){
  const input=structuredClone(run.input);recorder.beforeStep(input);const t=s.advanceFixed(input);recorder.afterStep(t,input);step++;pathLength+=distance(previous,s.body.position);previous=vec(s.body.position);peakSpeed=Math.max(peakSpeed,s.body.velocity.length());peakTilt=Math.max(peakTilt,tilt(s));account(cityContacts,s,step/120);
  if(s._integration.contactLedger?.hullEquations)firstHull??={step,timeS:step/120,state:state(s),ledger:structuredClone(s._integration.contactLedger)};
  cityTrace.push(JSON.stringify({step,timeS:step/120,input,...state(s),wheelContacts:s._contactCount,contactLedger:s._integration.contactLedger??null}));if(s._fault)break;
}
const currentCityRecord=recorder.finish(s._fault?'failed':'completed',s._fault??'All 22848 prior driver-input steps integrated in the declared current city');
const city={sourceFile:sourcePath,sourceSha256:hash(sourceBytes),sourceIdentity:source.identity,sourceGeometrySignature:source.initialSnapshot.physical.geometrySignature,currentGeometrySignature:cityGeometry,oldCityMigrationRejected:oldCityRejected,oldCityMigrationReason:oldCityReason,execution:'new-current-world-experiment-with-prior-driver-input-program',initialization:'Current city and source parameter values, reset free, declared position (-200,0.62,-345), upright and at rest, 124 settling steps. No mid-route resets or position changes.',steps:step,durationS:step/120,pathLengthM:pathLength,initialPosition:startPosition,final:{...state(s),mode:s.mode,contacts:s._contactCount,fault:s._fault},peakSpeedMps:peakSpeed,peakTiltDeg:peakTilt,contacts:cityContacts,firstHull,recordFile:`city-contact-provenance-${REPORT_VERSION}.record.json.gz`,traceFile:`city-contact-provenance-${REPORT_VERSION}.ndjson.gz`,scope:'Numerical current-model experiment using the production recorder/solver. The reference input was originally captured with native browser keys in 3.16; this execution is not a new native-browser or GPU observation.'};
check('Continuous current-city route classifies every rigid pair by wheel stop or hull',step===source.stepCount&&!s._fault&&pathLength>900&&cityContacts.normalEquations>0&&cityContacts.normalEquations===cityContacts.wheelStopEquations+cityContacts.hullEquations&&Object.values(cityContacts.pairs).every(p=>p.vehiclePart!=='unresolved'),{steps:step,pathLengthM:pathLength,wheelStopEquations:cityContacts.wheelStopEquations,hullEquations:cityContacts.hullEquations});
check('Original city history stays read-only and the referenced input route is explicitly a new current-model experiment',oldCityRejected&&oldCityHistory.physicalImports===0&&oldCityHistory.physicalSteps===0&&currentCityRecord.identity.modelVersion===MODEL_VERSION&&source.identity.modelVersion!==MODEL_VERSION&&readFileSync(sourceURL).equals(sourceBytes),{...oldCityHistory,routeExecutionIdentity:currentCityRecord.identity,sourceGeometrySignature:source.initialSnapshot.physical.geometrySignature,currentGeometrySignature:cityGeometry,geometryScope:'Unavailable historical-model refusal and current-world collision geometry are independent contracts; geometry refusal is tested above with a genuine current-model state.'});

mkdirSync(new URL('../qa/',import.meta.url),{recursive:true});
const compressed=(name,data)=>{const bytes=gzipSync(Buffer.from(data),{level:9});writeFileSync(new URL('../qa/'+name,import.meta.url),bytes);return{file:name,bytes:bytes.length,sha256:hash(bytes)};};
const traceArtifact=compressed(`contact-impulse-${REPORT_VERSION}.ndjson.gz`,trace.join('\n')+'\n'),cityTraceArtifact=compressed(city.traceFile,cityTrace.join('\n')+'\n'),cityRecordArtifact=compressed(city.recordFile,JSON.stringify(currentCityRecord));
const sources=['dist/physics.js','dist/contact-friction.js','dist/contact-ledger.js','dist/wheel-contact-envelope.js','dist/contact-step-schedule.js','dist/experiment-records.js'];
const report={schema:'roadster-contact-pair-impulse-work',version:1,createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:checks.every(c=>c.passed)?'friction-and-ordinary-regressions-passed-severe-trajectory-still-failed':'failed',checks,analytic,cases,regressions,convergence,city,sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))])),artifacts:{trace:{...traceArtifact,samples:trace.length},cityTrace:{...cityTraceArtifact,samples:cityTrace.length},cityRecord:cityRecordArtifact},limits:['Million-newton normal peaks and severe 90 km/h trajectory convergence are unresolved.','The unchanged faceted rigid wheel stops and compliant crown support are different modelling approximations; tested crown replacement did not justify merging it.','Exact duplicate contact-point accounting does not prove every near-coincident manifold point is physically appropriate.','Impulse-work closure isolates the constraint solve; it is not a complete deformable tyre or damage energy model.']};
writeFileSync(new URL(`../qa/contact-impulse-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
