import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim,DEFAULT_PARAMS} from '../dist/physics.js';
import {MODEL_VERSION,quickRollManeuverProfile,sampleRollManeuver} from '../dist/vehicle-models.js';
import {FlightProgramRunner,defaultProgramLibrary} from '../dist/flight-programs.js';
import {RoadsterSim as V39} from '../qa/fixtures/baseline-3.9-x/physics.js';
import {RoadsterSim as V312} from '../qa/fixtures/baseline-3.12-x/physics.js';
import {flatDynamics,DT} from './dynamics-fixtures-3.11.mjs';
const DEG=180/Math.PI,checks=[],summaries=[],runs=[],manual=[],bounds=[];
const check=(name,run)=>{run();checks.push({name,status:'PASS'});console.log('PASS '+name);};
const physical=sim=>JSON.stringify([sim.body.position,sim.body.velocity,sim.body.quaternion,sim.body.angularVelocity,sim.gasMass,sim._nozzles]);
const columns=['timeS','phase','xM','heightM','zM','vxMps','verticalMps','vzMps','rollDeg','pitchDeg','headingDeg','rollRateDegS','pitchRateDegS','yawRateDegS','integratedRollDeg','referenceAngleDeg','referenceRateDegS','referenceAccelerationDegS2','thrustN','allocationResidual','pressureBar','gasMassKg','onboardConsumedKg','externalSuppliedKg','contactCount','quaternionX','quaternionY','quaternionZ','quaternionW','inputLift','inputRoll','inputPitch','rigidEnvelopeClearanceM',...['desired','achieved'].flatMap(k=>['FxN','FyN','FzN','MxNm','MyNm','MzNm'].map(c=>k+c)),...['lift-FR','lift-FL','lift-RR','lift-RL','roll-FR','roll-FL','roll-RR','roll-RL','rear-boost','front-brake'].flatMap(id=>[id+'DeliveredN',id+'CommandN'])];
function refSample(a){if(a?.phase!=='rotate')return{angleRad:0,rateRadS:0,accelerationRadS2:0};if(a.profile)return sampleRollManeuver(a.profile,a.time);const u=Math.max(0,Math.min(1,a.time/a.duration));return{angleRad:2*Math.PI*u**3*(10-15*u+6*u*u),rateRadS:u<1?2*Math.PI*30*u*u*(1-u)**2/a.duration:0,accelerationRadS2:u<1?2*Math.PI*60*u*(1-u)*(1-2*u)/a.duration**2:0};}
function rigidClearance(sim){sim.body.updateAABB();return sim.body.aabb.lowerBound.y;}
function curveRow(sim,t,time,phase,integrated,ref,clearance){const w=sim.body.quaternion.conjugate().vmult(sim.body.angularVelocity),q=sim.body.quaternion,input=t.driverInput;return[time,phase,t.position.x,t.heightWorld,t.position.z,t.velocity.x,t.verticalSpeed,t.velocity.z,t.rollDeg,t.pitchDeg,t.headingDeg,w.z*DEG,w.x*DEG,w.y*DEG,integrated,ref.angleRad*DEG,ref.rateRadS*DEG,ref.accelerationRadS2*DEG,t.thrustN,t.allocationError,t.pressureBar,t.gasMass,t.onboardGasConsumedKg,t.externalGasSuppliedKg,t.contactCount,q.x,q.y,q.z,q.w,input.lift,input.roll,input.pitch,clearance,...t.desiredWrench,...t.achievedWrench,...t.nozzles.flatMap(n=>[n.force,n.command])];}
function run(Sim,version,configuration){
 const {height,params}=configuration,sim=flatDynamics(Sim,{height,params}),initial=sim.telemetry(),before=physical(sim),accepted=sim.startManeuver('roll'),reason=sim.status,plan=structuredClone(sim._maneuver),rows=[];
 const metrics={accepted,reason,rotationStart:null,rotationEnd:null,completionTimeS:null,groundedStart:initial.contactCount>=2,initialHeightM:initial.heightWorld,initialRigidClearanceM:rigidClearance(sim),initialGasKg:initial.gasMass,initialMassKg:initial.mass,initialRollInertiaKgm2:sim.body.inertia.z,maxHeightM:initial.heightWorld,minHeightM:initial.heightWorld,minHeightDuringRotateM:null,minRigidClearanceDuringRotateM:null,maximumIntegratedRollDeg:0,finalIntegratedRollDeg:0,peakRollRateDegS:0,peakThrustN:0,peakRollTorqueNm:0,commandSaturationS:0,peakNozzleForceFraction:0,minPressureBar:initial.pressureBar,rotateContact:false,hullContactAfterTakeoff:false,minimumUpDot:1,impulseAtCompletionNs:null,gasAtCompletionKg:null,gasThroughputAtCompletionKg:null};
 let integrated=0,airborne=false,postComplete=0;
 if(!accepted)assert.equal(physical(sim),before,'Refused action never changes physical state');
 for(let k=0;accepted&&k<25/DT;k++){
  const prior=sim._maneuver?.phase,t=sim.advanceFixed({},DT),w=sim.body.quaternion.conjugate().vmult(sim.body.angularVelocity),time=(k+1)*DT,ref=refSample(t.maneuver),clearance=rigidClearance(sim);
  assert.equal(t.fault,null);integrated+=w.z*DT*DEG;
  metrics.maxHeightM=Math.max(metrics.maxHeightM,t.heightWorld);metrics.minHeightM=Math.min(metrics.minHeightM,t.heightWorld);metrics.maximumIntegratedRollDeg=Math.max(metrics.maximumIntegratedRollDeg,integrated);metrics.finalIntegratedRollDeg=integrated;
  metrics.peakRollRateDegS=Math.max(metrics.peakRollRateDegS,Math.abs(w.z)*DEG);metrics.peakThrustN=Math.max(metrics.peakThrustN,t.thrustN);metrics.peakRollTorqueNm=Math.max(metrics.peakRollTorqueNm,Math.abs(t.achievedWrench[5]));metrics.minimumUpDot=Math.min(metrics.minimumUpDot,sim.body.quaternion.vmult({x:0,y:1,z:0}).y);metrics.minPressureBar=Math.min(metrics.minPressureBar,t.pressureBar);
  metrics.commandSaturationS+=Number(t.nozzles.some(n=>n.maxForce>0&&n.command>=.985*n.maxForce))*DT;metrics.peakNozzleForceFraction=Math.max(metrics.peakNozzleForceFraction,...t.nozzles.map(n=>n.maxForce>0?n.force/n.maxForce:0));
  const bodyContacts=sim.world.contacts.filter(c=>c.bi===sim.body||c.bj===sim.body);airborne||=t.contactCount===0&&bodyContacts.length===0;
  if(airborne)metrics.hullContactAfterTakeoff||=bodyContacts.some(c=>(c.bi===sim.body?c.si:c.sj).material!==sim._wheelStopMaterial);
  if(t.maneuver?.phase==='rotate'&&!metrics.rotationStart)metrics.rotationStart={timeS:time,heightM:t.heightWorld,rigidEnvelopeClearanceM:clearance,verticalMps:t.verticalSpeed};
  if(prior==='rotate'||t.maneuver?.phase==='rotate'){
   metrics.minHeightDuringRotateM=Math.min(metrics.minHeightDuringRotateM??Infinity,t.heightWorld);metrics.minRigidClearanceDuringRotateM=Math.min(metrics.minRigidClearanceDuringRotateM??Infinity,clearance);metrics.rotateContact||=t.contactCount>0||bodyContacts.length>0;
   if(prior==='rotate'&&t.maneuver?.phase!=='rotate')metrics.rotationEnd={timeS:time,heightM:t.heightWorld,verticalMps:t.verticalSpeed,integratedRollDeg:integrated,rollDeg:t.rollDeg,rollRateDegS:w.z*DEG};
  }
  if(!t.maneuver&&metrics.completionTimeS===null){metrics.completionTimeS=time;metrics.impulseAtCompletionNs=t.deliveredImpulseNs;metrics.gasAtCompletionKg=t.gasMass;metrics.gasThroughputAtCompletionKg=t.externalGasSuppliedKg+t.onboardGasConsumedKg;}
  if(k%6===0)rows.push(curveRow(sim,t,time,t.maneuver?.phase??'post-completion',integrated,ref,clearance));
  if(metrics.completionTimeS!==null){postComplete+=DT;if(postComplete>=1-1e-9)break;}
 }
 const t=sim.telemetry();Object.assign(metrics,{riseM:metrics.maxHeightM-initial.heightWorld,dropBelowStartM:initial.heightWorld-metrics.minHeightM,dropFromPeakM:metrics.maxHeightM-metrics.minHeightM,gasThroughputIncludingPostSecondKg:t.externalGasSuppliedKg+t.onboardGasConsumedKg,final:{heightM:t.heightWorld,verticalMps:t.verticalSpeed,rollDeg:t.rollDeg,pitchDeg:t.pitchDeg,headingDeg:t.headingDeg,angularRateRadS:sim.body.angularVelocity.length(),contacts:t.contactCount,mode:t.mode,phase:t.maneuver?.phase??null,gasMassKg:t.gasMass}});
 const id=`${version}-${params.supplyMode}-${params.tankLitres}-h${height}`,summary={id,version,configuration,plan,metrics};summaries.push(summary);runs.push({id,rows});return summary;
}
check('Frozen baseline sources retain their original bytes except relocated imports, with unchanged shared physical dependencies',()=>{
 const sha=value=>createHash('sha256').update(value).digest('hex');
 for(const version of ['3.9','3.12']){
  const root=new URL(`../qa/fixtures/baseline-${version}-x/`,import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
  for(const [path,hashes]of Object.entries(manifest.files)){const bytes=fs.readFileSync(new URL(path,root));assert.equal(sha(bytes),hashes.fixtureSha256);assert.equal(sha(bytes.toString().replaceAll('../../../dist/','./')),hashes.sourceSha256);}
  for(const [path,expected]of Object.entries(manifest.sharedDependencies))assert.equal(sha(fs.readFileSync(new URL('../'+path,import.meta.url))),expected,path+' baseline dependency changed');
 }
});
check('Matched complete 3.9 / 3.12 / current X runs retain actual force, trajectory, gas and contact outcomes',()=>{
 const configurations=[...['bench','finite'].flatMap(supplyMode=>[.62,4].map(height=>({height,params:{supplyMode,tankLitres:600}}))),...[.62,4].map(height=>({height,params:{supplyMode:'finite',tankLitres:900}})),{height:80,params:{supplyMode:'bench',tankLitres:600}}];
 for(const [version,Sim]of [['3.9',V39],['3.12',V312],['3.13',RoadsterSim]])for(const c of configurations){const r=run(Sim,version,c),m=r.metrics;
  assert.ok(m.peakNozzleForceFraction<=1+1e-9);if(m.accepted){assert.ok(m.completionTimeS!==null,r.id+' must finish');assert.equal(m.rotateContact,false,r.id+' rotation contact');assert.equal(m.hullContactAfterTakeoff,false,r.id+' hull impact');assert.ok(m.maximumIntegratedRollDeg>=355&&m.minimumUpDot<-.99,r.id+' physical full turn');assert.ok(Math.abs(m.final.rollDeg)<2&&Math.abs(m.final.pitchDeg)<2&&Math.abs(m.final.verticalMps)<.2,r.id+' post-action settling');}
 }
 const find=(v,h=.62,mode='bench',tank=600)=>summaries.find(r=>r.version===v&&r.configuration.height===h&&r.configuration.params.supplyMode===mode&&r.configuration.params.tankLitres===tank);
 assert.equal(find('3.9').plan.duration,2);assert.equal(find('3.12').plan.duration,2.5);assert.equal(find('3.13').plan.duration,1.5);
 assert.ok(find('3.13').metrics.peakRollRateDegS>330);assert.ok(find('3.13').metrics.maxHeightM<5);assert.ok(find('3.13').metrics.rotationEnd.timeS<2.1);assert.ok(find('3.13').metrics.gasThroughputAtCompletionKg<find('3.9').metrics.gasThroughputAtCompletionKg);
 assert.equal(find('3.13',.62,'finite').metrics.accepted,true);assert.equal(find('3.13',4,'finite').metrics.accepted,true);assert.equal(find('3.12',.62,'finite',900).metrics.accepted,false);
});
check('Fast reference is independent of comfort sliders; nozzle torque and short-takeoff authority remain physical',()=>{
 const profile=quickRollManeuverProfile();assert.equal(profile.kind,'quick-roll-1');assert.equal(profile.durationS,1.5);assert.equal(profile.rampS,.5);assert.equal(profile.cruiseS,.5);
 for(const params of [{rollRateDegS:15,angularAccelerationDegS2:20,verticalAccelerationMps2:1},{rollRateDegS:360,angularAccelerationDegS2:720,verticalAccelerationMps2:10}]){const s=flatDynamics(RoadsterSim,{height:4,params});assert.equal(s.startManeuver('roll'),true);assert.deepEqual(s._maneuver.profile,profile);assert.ok(s._maneuver.launchAccelerationMps2<s._availableLiftForce()/s.body.mass-s.params.gravity);}
 assert.equal(DEFAULT_PARAMS.motorPower,700000);assert.equal(DEFAULT_PARAMS.tireMu,1.25);assert.equal(DEFAULT_PARAMS.liftNozzleMax,20000);
});
check('Quick-roll practice uses E, then Z, then G through real input APIs, with a sustained recovery window and complete curves',()=>{
 const preset={climbRateMps:4,verticalAccelerationMps2:10,rollRateDegS:360,pitchRateDegS:90,angularAccelerationDegS2:720};
 const configurations=[...['bench','finite'].flatMap(supplyMode=>[.62,4].map(height=>({height,supplyMode,tankLitres:600,releaseDeg:270}))),...[.62,4].map(height=>({height,supplyMode:'finite',tankLitres:900,releaseDeg:270})),{height:.62,supplyMode:'bench',tankLitres:600,releaseDeg:355}];
 for(const {height,supplyMode,tankLitres,releaseDeg}of configurations){
  const params={...preset,supplyMode,tankLitres},sim=flatDynamics(RoadsterSim,{height,params});sim.setMode('hover');sim.setAirStabilization(false);
  const initial=sim.telemetry(),rows=[],events=[{timeS:0,action:'G off; E held',input:{lift:1,roll:0,pitch:0}}];
  const m={initialHeightM:initial.heightWorld,initialRigidClearanceM:rigidClearance(sim),initialGasKg:initial.gasMass,maxHeightM:initial.heightWorld,minHeightM:initial.heightWorld,minRigidClearanceAfterRollStartM:null,peakRollRateDegS:0,maximumIntegratedRollDeg:0,peakThrustN:0,peakNozzleForceFraction:0,minUpDot:1,rollStart:null,rollRelease:null,firstStableCrossingS:null,stableWindowStartS:null,confirmedRecoveryS:null,contactDuringRollOrRecovery:false};
  let phase='E-climb',integrated=0,stableDuration=0;
  for(let k=0;k<12/DT;k++){
   const prior=phase,input=phase==='E-climb'?{lift:1}:phase==='Z-roll'?{roll:-1}:{},t=sim.advanceFixed(input,DT),time=(k+1)*DT,w=sim.body.quaternion.conjugate().vmult(sim.body.angularVelocity),clearance=rigidClearance(sim);
   integrated+=w.z*DT*DEG;assert.equal(t.fault,null);m.maximumIntegratedRollDeg=Math.max(m.maximumIntegratedRollDeg,integrated);m.maxHeightM=Math.max(m.maxHeightM,t.heightWorld);m.minHeightM=Math.min(m.minHeightM,t.heightWorld);m.peakRollRateDegS=Math.max(m.peakRollRateDegS,Math.abs(w.z)*DEG);m.peakThrustN=Math.max(m.peakThrustN,t.thrustN);m.peakNozzleForceFraction=Math.max(m.peakNozzleForceFraction,...t.nozzles.map(n=>n.maxForce>0?n.force/n.maxForce:0));m.minUpDot=Math.min(m.minUpDot,sim.body.quaternion.vmult({x:0,y:1,z:0}).y);
   if(prior!=='E-climb'){m.minRigidClearanceAfterRollStartM=Math.min(m.minRigidClearanceAfterRollStartM??Infinity,clearance);m.contactDuringRollOrRecovery||=t.contactCount>0||sim.world.contacts.some(c=>c.bi===sim.body||c.bj===sim.body);}
   if(phase==='E-climb'&&t.verticalSpeed>=preset.climbRateMps*.94&&t.altitude>=1.65){phase='Z-roll';m.rollStart={timeS:time,heightM:t.heightWorld,verticalMps:t.verticalSpeed,rigidEnvelopeClearanceM:clearance};events.push({timeS:time,action:'Release E; hold Z',input:{lift:0,roll:-1,pitch:0},condition:'Measured vertical speed >= 3.76 m/s and CG-to-surface distance >= 1.65 m'});}
   if(phase==='Z-roll'&&integrated>=releaseDeg){phase='G-recover';m.rollRelease={timeS:time,heightM:t.heightWorld,verticalMps:t.verticalSpeed,integratedRollDeg:integrated,rollRateDegS:w.z*DEG};const before=physical(sim);sim.setAirStabilization(true);assert.equal(physical(sim),before);events.push({timeS:time,action:'Release Z; enable G level recovery',input:{lift:0,roll:0,pitch:0},condition:`Measured integrated body roll >= ${releaseDeg} degrees`,referenceHeightM:sim._stableHeight});}
   if(prior==='G-recover'){
    const stable=Math.abs(t.rollDeg)<1&&Math.abs(t.pitchDeg)<1&&sim.body.angularVelocity.length()<.2&&Math.abs(t.verticalSpeed)<.2;
    if(stable){m.firstStableCrossingS??=time;if(stableDuration===0)m.stableWindowStartS=time;stableDuration+=DT;}else{stableDuration=0;m.stableWindowStartS=null;}
    if(stableDuration>=.5-1e-9)m.confirmedRecoveryS=time;
   }
   if(k%6===0||m.confirmedRecoveryS!==null)rows.push(curveRow(sim,t,time,prior,integrated,{angleRad:0,rateRadS:sim.getReference().manualRate.z,accelerationRadS2:0},clearance));
   if(m.confirmedRecoveryS!==null)break;
  }
  const t=sim.telemetry();Object.assign(m,{riseM:m.maxHeightM-initial.heightWorld,finalIntegratedRollDeg:integrated,gasThroughputKg:t.externalGasSuppliedKg+t.onboardGasConsumedKg,remainingGasKg:t.gasMass,finalPressureBar:t.pressureBar,final:{heightM:t.heightWorld,verticalMps:t.verticalSpeed,rollDeg:t.rollDeg,pitchDeg:t.pitchDeg,angularRateRadS:sim.body.angularVelocity.length(),mode:t.mode}});
  const id=`manual-${releaseDeg===355?'late-release-':''}${supplyMode}-${tankLitres}-h${height}`;manual.push({id,configuration:{height,params,releaseDeg},inputEvents:events,metrics:m});runs.push({id,rows});
  assert.ok(m.peakNozzleForceFraction<=1+1e-9);assert.ok(m.confirmedRecoveryS!==null,id+' continuous 0.5 s recovery');assert.ok(m.minUpDot<-.99&&integrated>355&&integrated<370,id+' complete physical rotation');assert.equal(m.contactDuringRollOrRecovery,false,id+' contact');
  if(releaseDeg===270)assert.ok(m.maximumIntegratedRollDeg<370,id+' anticipatory release limits overshoot');else assert.ok(m.maximumIntegratedRollDeg>400,'The measured late-release overshoot must remain visible');
 }
});
check('Low pressure, torque loss, ceiling, descent and unstable initial conditions reject without physical mutation',()=>{
 const cases=[
  ['low-pressure',()=>flatDynamics(RoadsterSim,{height:4,params:{supplyMode:'finite',initialPressureBar:15}}),/推力/],
  ['low-gas-budget',()=>flatDynamics(RoadsterSim,{height:4,params:{supplyMode:'finite',tankLitres:150}}),/冲量/],
  ['failed-front-right',()=>{const s=flatDynamics(RoadsterSim,{height:4});s.setNozzleFault({id:'lift-FR',scale:0});return s;},/力矩/],
  ['ceiling',()=>{const s=new RoadsterSim({}, {world:'windlab'});s.body.position.y=22;s.setMode('hover');return s;},/净空/],
  ['tilted-start',()=>{const s=flatDynamics(RoadsterSim,{height:4});s.body.quaternion.setFromEuler(0,0,.2);return s;},/倾角/],
  ['spinning-start',()=>{const s=flatDynamics(RoadsterSim,{height:4});s.body.angularVelocity.z=.7;return s;},/角速度/],
  ['low-fast-descent',()=>{const s=flatDynamics(RoadsterSim,{height:1.2});s.body.velocity.y=-5;return s;},/下降速度/],
 ];
 for(const [id,make,pattern]of cases){const s=make(),before=physical(s);assert.equal(s.startManeuver('roll'),false,id);assert.equal(physical(s),before);assert.match(s.status,pattern);bounds.push({id,result:'refused',reason:s.status});}
});
check('Repeated X cannot restart a running roll; G cancels to a level heading reference without changing body state',()=>{
 const s=flatDynamics(RoadsterSim,{height:40});s.body.quaternion.setFromEuler(0,.45,0,'YXZ');s.setMode('hover');assert.equal(s.startManeuver('roll'),true);
 for(let k=0;k<100;k++)s.advanceFixed({},DT);const before=physical(s),plan=structuredClone(s._maneuver);assert.equal(s.startManeuver('roll'),false);assert.equal(physical(s),before);assert.deepEqual(s._maneuver,plan);
 const heading=s._angles().heading;assert.equal(s.setAirStabilization(true),true);assert.equal(physical(s),before);assert.equal(s._maneuver,null);assert.ok(Math.abs(s._stableHeading-heading)<1e-10);assert.ok(s._manualQuaternionTarget.vmult({x:0,y:1,z:0}).y>.999999);
 for(let k=0;k<8/DT;k++)s.advanceFixed({},DT);const t=s.telemetry();assert.ok(Math.abs(t.rollDeg)<1&&Math.abs(t.pitchDeg)<1);bounds.push({id:'G-during-roll',result:'recovered',heightM:t.heightWorld,rollDeg:t.rollDeg,headingDeg:t.headingDeg});
});
check('A real main-nozzle fault during rotation is a failed program and retains its physical recovery controller',()=>{
 const sim=flatDynamics(RoadsterSim,{height:40});let result=null,atFailure=null;
 const runner=new FlightProgramRunner({getSim:()=>sim,onFinish:r=>{result=r;}});runner.start(defaultProgramLibrary().programs.find(p=>p.id==='roll-return'));
 for(let k=0;k<8/DT&&runner.active;k++){
  if(k===80)assert.equal(sim.setNozzleFault({id:'lift-FL',scale:0}),true);
  const before=physical(sim),plan=sim._maneuver,input=runner.stepInput(DT,{});
  if(result){assert.equal(physical(sim),before,'Reporting failure does not change body or delivered jet state');assert.equal(sim._maneuver,plan,'The physical recovery is not cancelled by the research report');atFailure={timeS:sim.simTime,heightM:sim.body.position.y,phase:sim._maneuver?.phase,integratedRollDeg:(sim._maneuver?.actualRollRad??0)*DEG};break;}
  sim.advanceFixed(input,DT);
 }
 assert.equal(result?.status,'failed');assert.match(result.reason,/未满足完整一周/);assert.equal(atFailure.phase,'recover');assert.ok(atFailure.integratedRollDeg<355);
 const before=sim.body.velocity.clone();for(let k=0;k<12;k++)sim.advanceFixed({},DT);assert.notDeepEqual(sim.body.velocity,before,'Dynamics continue after failure report');
 bounds.push({id:'mid-rotation-main-nozzle-failure',fault:{id:'lift-FL',scale:0,timeS:80*DT},result:result.status,reason:result.reason,atFailure,recoveryPreserved:true,scope:'Confirms failure detection and continuing physical dynamics, not guaranteed recovery under the persistent failure.'});
});
check('Current fast-roll snapshots continue exactly and legacy 3.12 profile is preserved during explicit current-model mapping',()=>{
 const s=flatDynamics(RoadsterSim,{height:40});s.startManeuver('roll');for(let k=0;k<100;k++)s.advanceFixed({},DT);assert.equal(s._maneuver.phase,'rotate');
 const snap=s.exportState(),replay=flatDynamics(RoadsterSim,{height:40});replay.importState(snap);for(let k=0;k<240;k++){s.advanceFixed({},DT);replay.advanceFixed({},DT);}assert.deepEqual(replay.exportState(),s.exportState());
 const bad=structuredClone(snap);bad.state._maneuver.profile.rateRadS=100;assert.throws(()=>replay.importState(bad),/轨迹/);
 const noClearance=structuredClone(snap);delete noClearance.state._maneuver.minimumRotationClearanceM;assert.throws(()=>replay.importState(noClearance),/轮廓净空/);
 const legacy=flatDynamics(V312,{height:40});legacy.startManeuver('roll');for(let k=0;k<480;k++)legacy.advanceFixed({},DT);assert.equal(legacy._maneuver.phase,'rotate');const original=legacy.exportState();assert.equal(original.modelVersion,'3.12.0');
 fs.writeFileSync(new URL('../qa/fixtures/x-midroll-3.12.json',import.meta.url),JSON.stringify(original)+'\n');
 const mapped=structuredClone(original);mapped.modelVersion=MODEL_VERSION;const target=flatDynamics(RoadsterSim,{height:40});target.importState(mapped);assert.deepEqual(target._maneuver,legacy._maneuver);assert.equal(target._maneuver.profile.kind,'pilot-rate-envelope');assert.equal(target._maneuver.duration,2.5);assert.equal(target._maneuver.launchAccelerationMps2,5);
 for(let k=0;k<30;k++)target.advanceFixed({},DT);assert.equal(target._maneuver.profile.kind,'pilot-rate-envelope');bounds.push({id:'legacy-profile',sourceModel:'3.12.0',executionModel:MODEL_VERSION,durationS:target._maneuver.duration,launchAccelerationMps2:target._maneuver.launchAccelerationMps2,scope:'Only modelVersion mapping here; public record migrator is independently tested. Historical reports never rewritten.'});
});
const paths=['dist/physics.js','dist/vehicle-models.js','dist/simulation-snapshot.js','dist/flight-programs.js','tests/x-flip-3.13.test.mjs','qa/fixtures/baseline-3.9-x/manifest.json','qa/fixtures/baseline-3.12-x/manifest.json'];
const sourceSha256=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(fs.readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]));
fs.writeFileSync(new URL('../qa/x-flip-curves-3.13.json',import.meta.url),JSON.stringify({schema:'roadster.x-flip-curves',version:2,modelVersion:MODEL_VERSION,solverHz:120,sampleHz:20,samplingScope:'Automatic rows are saved every six solver steps and may end before the final telemetry at completion + 119/120 s. Manual rows use the same 20 Hz sampling plus the terminal recovery-confirmation sample; that last interval may be shorter than 0.05 s.',columns,sourceSha256,runs})+'\n');
fs.writeFileSync(new URL('../qa/x-flip-3.13.json',import.meta.url),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),sourceSha256,scope:'Actual numerical solver, matched flat-world initial conditions; original 3.9/3.12 physics source frozen, current scene reduced to common ground before integration. No WebGL or human flight acceptance, no OEM calibration.',heightScope:'heightM is CG world height above the common y=0 floor. rigidEnvelopeClearanceM is the lowest transformed rigid collision AABB point, including wheel bump stops; it excludes suspension ray/visual-tire extension. Contact gates independently check both rigid and ray contacts.',metricsScope:'Automatic: all 120 Hz steps through final telemetry at completion + 119/120 s (0.991667 s) of ordinary control settling; completion gas/impulse separated from the approximately one-second post-completion totals. The last stored 20 Hz row can precede final telemetry; rejected rows are not executed. Manual: real input sequence through a continuous 0.5 s recovery window; 20 Hz curves plus the terminal recovery sample. G preserves the existing flight-height reference rather than automatically returning to the origin.',checks,summaries,manual,bounds},null,2)+'\n');
console.log(JSON.stringify({status:'passed',checks:checks.length,cases:summaries.length,manualCases:manual.length,current:summaries.filter(r=>r.version==='3.13').map(r=>({id:r.id,accepted:r.metrics.accepted,rise:r.metrics.riseM,peak:r.metrics.peakRollRateDegS,rotate:r.metrics.rotationEnd?.timeS,complete:r.metrics.completionTimeS,gas:r.metrics.gasThroughputAtCompletionKg})),manual:manual.map(r=>({id:r.id,peak:r.metrics.peakRollRateDegS,complete:r.metrics.confirmedRecoveryS,gas:r.metrics.gasThroughputKg}))}));
