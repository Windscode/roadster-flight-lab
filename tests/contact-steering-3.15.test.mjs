import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RoadsterSim,DEFAULT_PARAMS} from '../dist/physics.js';
import {RoadsterSim as BeforeSim} from './fixtures/pilot-input-3.14-before/physics.js';
import {Quaternion} from '../dist/vendor/cannon-es.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';

const HZ=120,DT=1/HZ,checks=[],cases=[],rows=[];
const sha=x=>createHash('sha256').update(x).digest('hex');
const vec=x=>[x.x,x.y,x.z],quat=x=>[x.x,x.y,x.z,x.w];
const check=(name,passed,details={})=>{checks.push({name,passed:!!passed,...details});console.log(`${passed?'PASS':'FAIL'} ${name}`);};
function fixture(Sim,{regenForce=0}={}){
 const sim=new Sim({regenForce});
 for(const body of [...sim.world.bodies])if(body!==sim.body&&body.userData?.id!=='ground')sim.world.removeBody(body);
 sim.geometry=sim.geometry.filter(g=>g.id==='ground');sim.reset('free');sim.setAirStabilization(false);return sim;
}
function colliderErrorDegrees(sim){
 return sim.wheelStates.map((wheel,i)=>{
  const expected=new Quaternion().setFromEuler(0,wheel.steer,Math.PI/2,'YXZ');
  const actual=sim.body.shapeOrientations[sim._wheelStopIndices[i]];
  const dot=Math.abs(actual.x*expected.x+actual.y*expected.y+actual.z*expected.z+actual.w*expected.w);
  return 2*Math.acos(Math.min(1,dot))*180/Math.PI;
 });
}
function mechanicalEnergy(sim){
 const body=sim.body,omega=body.quaternion.conjugate().vmult(body.angularVelocity);
 return{translationJ:.5*body.mass*body.velocity.lengthSquared(),rotationJ:.5*(body.inertia.x*omega.x**2+body.inertia.y*omega.y**2+body.inertia.z*omega.z**2),gravityJ:body.mass*sim.params.gravity*body.position.y,
  wheelRotationJ:sim.wheelStates.reduce((sum,w)=>sum+.5*sim.params.wheelInertia*w.angularVelocityRadS**2,0),springJ:sim.wheelStates.reduce((sum,w)=>sum+.5*sim.params.springRate*Math.max(0,sim.params.suspensionRest-w.suspensionLength)**2,0)};
}
function rollingInitialState(sim,speedKmh,{y=.62,z=-12,settle=true}={}){
 sim.body.position.set(0,y,z);if(settle)for(let i=0;i<180;i++)sim._advance(DT,{brake:1});
 sim.body.velocity.set(0,0,speedKmh/3.6);sim.wheelStates.forEach(w=>w.angularVelocityRadS=speedKmh/3.6/sim.params.wheelRadius);
}
function run(id,variant,sim,steps,inputAt=()=>({}),extra={}){
 const initial=sim.telemetry(),physicalRows=[];let firstFixtureContact=null,maxColliderErrorDeg=0,maxTiltDeg=0,maxPenetrationM=0,maxWheelLoadN=0,maxGripUse=0,hullContactSteps=0,wheelStopContactSteps=0,fault=null;
 const minSuspension=Array(4).fill(Infinity),maxSuspension=Array(4).fill(-Infinity);
 for(let step=1;step<=steps;step++){
  const input=inputAt(step),preIntegrationSpeedKmh=sim.body.velocity.length()*3.6;sim._advance(DT,input);
  const contacts=sim.getContactDiagnostics(),t=sim.telemetry(),errors=colliderErrorDegrees(sim),bodyQ=sim.body.quaternion;
  maxColliderErrorDeg=Math.max(maxColliderErrorDeg,...errors);maxTiltDeg=Math.max(maxTiltDeg,Math.acos(Math.max(-1,Math.min(1,1-2*(bodyQ.x**2+bodyQ.z**2))))*180/Math.PI);
  const fixtureContacts=contacts.filter(c=>c.objectId.startsWith('fixture-'));
  if(!firstFixtureContact&&(fixtureContacts.length||sim.wheelStates.some(w=>w.contact&&w.contactObjectId?.startsWith('fixture-'))))firstFixtureContact={step,timeS:step/HZ,preIntegrationSpeedKmh,postIntegrationSpeedKmh:t.speedKmh,contacts:fixtureContacts,wheelRayContacts:sim.wheelStates.map(w=>w.contact? w.contactObjectId:null),colliderErrorDeg:errors};
  for(const c of contacts)maxPenetrationM=Math.max(maxPenetrationM,c.penetrationM);
  hullContactSteps+=Number(contacts.some(c=>c.vehicleShape<4));wheelStopContactSteps+=Number(contacts.some(c=>c.vehicleShape>=4));
  for(const [i,w]of sim.wheelStates.entries()){maxWheelLoadN=Math.max(maxWheelLoadN,w.normalLoadN);maxGripUse=Math.max(maxGripUse,w.gripUse);minSuspension[i]=Math.min(minSuspension[i],w.suspensionLength);maxSuspension[i]=Math.max(maxSuspension[i],w.suspensionLength);}
  const physical={position:vec(sim.body.position),velocity:vec(sim.body.velocity),quaternion:quat(sim.body.quaternion),omega:vec(sim.body.angularVelocity)};
  physicalRows.push(JSON.stringify(physical));
  rows.push(JSON.stringify({caseId:id,variant,step,timeS:step/HZ,input,...physical,speedKmh:t.speedKmh,bodySlipDeg:t.bodySlipDeg,colliderErrorDeg:errors,energy:mechanicalEnergy(sim),brakeDissipationJ:t.brakeDissipationJ,tireDissipationJ:t.tireDissipationJ,contacts,
   wheels:sim.wheelStates.map(w=>({id:w.id,objectId:w.contactObjectId,contact:w.contact,loadN:w.normalLoadN,suspensionM:w.suspensionLength,steerRad:w.steer,omegaRadS:w.angularVelocityRadS,alphaRad:w.slipAngle,kappa:w.slipRatio,longitudinalSpeedMps:w.longitudinalSpeedMps,lateralSpeedMps:w.lateralSpeedMps,FxN:w.longitudinalForceN,FyN:w.lateralForceN,gripUse:w.gripUse}))}));
  if(t.fault){fault=t.failure??t.fault;break;}
 }
 const end=sim.telemetry();
 const result={id,variant,...extra,parameters:{...sim.params},steps,durationS:steps/HZ,initialPosition:initial.position,initialSpeedKmh:initial.speedKmh,fixtureGeometry:sim.geometry.filter(g=>g.id!=='ground'),fixtureGeometryHash:sha(JSON.stringify(sim.geometry)),firstFixtureContact,
  maxColliderErrorDeg,maxTiltDeg,maxPenetrationM,maxWheelLoadN,maxGripUse,minSuspensionM:minSuspension,maxSuspensionM:maxSuspension,hullContactSteps,wheelStopContactSteps,finalPosition:end.position,finalVelocity:end.velocity,finalSpeedKmh:end.speedKmh,solverFault:fault,
  trajectorySha256:sha(physicalRows.join('\n')),physicalOutcome:fault?'solver-fault':maxTiltDeg>60?'vehicle-upset':hullContactSteps?'hull-contact':'finite-contact-response'};
 cases.push(result);return result;
}

// Steering a wheel in air must rotate the physical stop as well as the visible
// wheel. No force or pose correction is permitted to obtain this consistency.
const airborne=[];
for(const [variant,Sim]of [['before',BeforeSim],['after',RoadsterSim]]){
 const sim=fixture(Sim);rollingInitialState(sim,20,{y:4,z:-100,settle:false});
 airborne.push(run('airborne-steering-20',variant,sim,24,()=>({steer:.9})));
}
check('Airborne steering reproduces the historical stale physical wheel and aligns the candidate',airborne[0].maxColliderErrorDeg>10&&airborne[1].maxColliderErrorDeg<1e-5,{beforeDeg:airborne[0].maxColliderErrorDeg,afterDeg:airborne[1].maxColliderErrorDeg,toleranceDeg:1e-5});

const resets=[];
for(const [variant,Sim]of [['before',BeforeSim],['after',RoadsterSim]]){
 const sim=fixture(Sim);rollingInitialState(sim,0);for(let i=0;i<60;i++)sim._advance(DT,{steer:.8});
 const steeredDegrees=sim.wheelStates[0].steer*180/Math.PI;sim.reset('free');resets.push({variant,steeredDegrees,colliderErrorDeg:colliderErrorDegrees(sim),visibleSteer:sim.wheelStates.map(w=>w.steer)});
}
check('Reset clears the physical wheel steer together with the visible wheel state',Math.max(...resets[0].colliderErrorDeg)>5&&Math.max(...resets[1].colliderErrorDeg)<1e-5&&resets.every(r=>r.visibleSteer.every(x=>x===0)));

// The rail is beside the body, within the swept envelope of the turned front
// wheel. This is a local landing/grazing contact fixture, not a city driving run.
for(const [variant,Sim]of [['before',BeforeSim],['after',RoadsterSim]]){
 const sim=fixture(Sim);sim._addBox('fixture-wheel-only-rail','rail',[.1,1.1,.8],[1.15,.55,0]);
 rollingInitialState(sim,20,{y:1.1,z:-2.3,settle:false});run('landing-rail-graze-20',variant,sim,96,()=>({steer:.9}),{nominalInitialSpeedKmh:20,initialCgHeightM:1.1});
}
const get=(id,variant='after')=>cases.find(c=>c.id===id&&c.variant===variant);
const railBefore=get('landing-rail-graze-20','before'),railAfter=get('landing-rail-graze-20');
check('A turned airborne front wheel now generates the previously omitted rail contact',railAfter.firstFixtureContact?.contacts.some(c=>c.vehicleShape===5)&&railAfter.firstFixtureContact.wheelRayContacts.every(c=>c===null)&&railAfter.firstFixtureContact.step<railBefore.firstFixtureContact.step&&railBefore.firstFixtureContact.contacts.every(c=>c.vehicleShape<4),{beforeFirstContact:railBefore.firstFixtureContact,afterFirstContact:railAfter.firstFixtureContact});
check('The local contact change is an integrated physical trajectory difference',railAfter.trajectorySha256!==railBefore.trajectorySha256&&railAfter.maxPenetrationM<.1&&!railAfter.solverFault);

for(const config of [{id:'full-width-10cm-90',speed:90,height:.1,single:false,regen:0},{id:'single-wheel-10cm-90',speed:90,height:.1,single:true,regen:0},{id:'default-regen-2cm-initial20',speed:20,height:.02,single:false,regen:2600},{id:'passive-2cm-initial20',speed:20,height:.02,single:false,regen:0}]){
 for(const [variant,Sim]of [['before',BeforeSim],['after',RoadsterSim]]){
  const sim=fixture(Sim,{regenForce:config.regen}),h=config.height;
  sim._addBox('fixture-step','step',config.single?[.6,h,.8]:[12,h,60],config.single?[-.89,h/2,.4]:[0,h/2,30]);
  rollingInitialState(sim,config.speed);run(config.id,variant,sim,config.speed===90?360:672,()=>({}),{nominalInitialSpeedKmh:config.speed,stepHeightM:h,singleWheelPatch:config.single});
 }
 check(config.id+' retains the complete historical physical trajectory',get(config.id).trajectorySha256===get(config.id,'before').trajectorySha256);
}
check('90 km/h 10 cm curb upsets remain recorded adverse outcomes, not converted to acceptance',get('full-width-10cm-90').maxTiltDeg>160&&get('single-wheel-10cm-90').maxTiltDeg>100&&['full-width-10cm-90','single-wheel-10cm-90'].every(id=>get(id).physicalOutcome==='vehicle-upset'&&!get(id).solverFault));
check('Default lift-off regen remains 2600 N and its slower curb impact is distinguished from initial speed',DEFAULT_PARAMS.regenForce===2600&&get('default-regen-2cm-initial20').firstFixtureContact.preIntegrationSpeedKmh<10&&get('passive-2cm-initial20').firstFixtureContact.preIntegrationSpeedKmh>19,{defaultPreImpactKmh:get('default-regen-2cm-initial20').firstFixtureContact.preIntegrationSpeedKmh,passivePreImpactKmh:get('passive-2cm-initial20').firstFixtureContact.preIntegrationSpeedKmh});
check('All cases retain the original grip and suspension bounds and finite integration',cases.every(c=>!c.solverFault&&c.maxGripUse<=1+1e-8&&c.minSuspensionM.every(x=>x>=c.parameters.suspensionMin-1e-9)&&c.maxSuspensionM.every(x=>x<=c.parameters.suspensionRest+c.parameters.suspensionDroop+1e-9)));

const traceName=`contact-steering-${REPORT_VERSION}.ndjson.gz`,trace=gzipSync(Buffer.from(rows.join('\n')+'\n'),{level:9});writeFileSync(new URL('../qa/'+traceName,import.meta.url),trace);
const sourcePaths=['dist/physics.js','dist/vehicle-models.js','dist/tire-dynamics.js','dist/simulation-safety.js'];
const report={schema:'roadster-wheel-collider-steering-regression',version:1,createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:checks.every(c=>c.passed)?'passed-with-retained-adverse-outcomes':'failed',physicsHz:HZ,
 baseline:JSON.parse(readFileSync(new URL('./fixtures/pilot-input-3.14-before/provenance.json',import.meta.url),'utf8')),scope:'Localized physical wheel-orientation synchronization and reset correction. Before/after use the same current helper dependencies and declared fixture geometry. No target-GPU, real keyboard, city-route or general curb-recovery claim.',
 sourceHashes:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))])),checks,cases,resets,trace:{file:traceName,frequencyHz:HZ,samples:rows.length,sha256:sha(trace),compressedBytes:trace.length},
 retainedAdverseOutcomes:cases.filter(c=>c.variant==='after'&&c.physicalOutcome==='vehicle-upset').map(c=>({id:c.id,outcome:c.physicalOutcome,maxTiltDeg:c.maxTiltDeg,maxPenetrationM:c.maxPenetrationM,trajectoryUnchanged:c.trajectorySha256===get(c.id,'before').trajectorySha256})),
 limits:['This correction does not claim that 90 km/h curb strikes are recoverable. Both severe upsets remain.','The 20 km/h wheel/rail fixture demonstrates correct contact geometry, not a general handling or safety improvement.','The default-regen approach starts at 20 km/h but reaches the curb more slowly. The passive regen=0 fixture is declared test setup only; production default is unchanged.','Energy channels omit tyre deformation and exact discontinuous ray-spring work. They are diagnostics, not a complete vehicle impact model.']};
writeFileSync(new URL(`../qa/contact-steering-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
console.log(JSON.stringify({checks:checks.length,cases:cases.length,samples:rows.length,traceBytes:trace.length,retainedAdverseOutcomes:report.retainedAdverseOutcomes}));
