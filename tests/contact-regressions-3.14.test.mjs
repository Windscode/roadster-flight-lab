import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {driverAxes} from '../dist/controls.js';

const DT=1/120,rows=[],cases=[],failures=[];
const sha=data=>createHash('sha256').update(data).digest('hex');
function fixture(params={}){const sim=new RoadsterSim({regenForce:0,...params});for(const b of [...sim.world.bodies])if(b!==sim.body&&b.userData?.id!=='ground')sim.world.removeBody(b);sim.geometry=sim.geometry.filter(g=>g.id==='ground');sim.reset('free');return sim;}
function settle(sim,{x=0,y=.62,z=-12,pitch=0}={}){sim.body.position.set(x,y,z);sim.body.quaternion.setFromEuler(pitch,0,0);for(let i=0;i<180;i++)sim.advanceFixed({brake:1});assert.equal(sim.telemetry().fault,null);}
function roll(sim,speedKmh,{heading=0,pitch=0}={}){const v=speedKmh/3.6;sim.body.quaternion.setFromEuler(pitch,heading,0,'YXZ');const q=sim.body.quaternion,f=q.vmult({x:0,y:0,z:1});sim.body.velocity.set(f.x*v,f.y*v,f.z*v);sim.body.angularVelocity.setZero();sim.wheelStates.forEach(w=>w.angularVelocityRadS=v/sim.params.wheelRadius);}
function energy(sim){const b=sim.body,w=b.quaternion.conjugate().vmult(b.angularVelocity);return{bodyTranslationJ:.5*b.mass*b.velocity.lengthSquared(),bodyRotationJ:.5*(b.inertia.x*w.x*w.x+b.inertia.y*w.y*w.y+b.inertia.z*w.z*w.z),gravityJ:b.mass*sim.params.gravity*b.position.y,wheelRotationJ:sim.wheelStates.reduce((s,v)=>s+.5*sim.params.wheelInertia*v.angularVelocityRadS**2,0),springJ:sim.wheelStates.reduce((s,v)=>s+.5*sim.params.springRate*Math.max(0,sim.params.suspensionRest-v.suspensionLength)**2,0)};}
const total=e=>Object.values(e).reduce((s,v)=>s+v,0);
function run(id,kind,sim,seconds,inputAt=()=>({}),extra={}){
  const initial=sim.telemetry(),initialEnergy=energy(sim),geometry=sim.getWorldGeometry(),geometryHash=sha(JSON.stringify(geometry)),startTime=sim.simTime,origin={...sim.body.position},last=sim.body.position.clone();
  const summary={id,kind,...extra,durationS:seconds,initialSpeedKmh:initial.speedKmh,initialEnergy,fixtureGeometryHash:geometryHash,fixtureGeometry:geometry.filter(g=>g.id!=='ground'),initialPosition:origin,parameters:{...sim.params},firstFixtureContact:null,
    maxSpeedKmh:initial.speedKmh,minSpeedKmh:initial.speedKmh,maxWheelLoadN:0,minSuspensionLengthM:Infinity,maxSuspensionLengthM:0,maxPenetrationM:0,maxMechanicalEnergyJ:total(initialEnergy),maxBodySlipDeg:0,maxWheelLongitudinalSlip:0,maxWheelSlipAngleDeg:0,maxYawRateDegS:0,peakWheelSteerDeg:0,maxGripUse:0,maxTiltDeg:0,hullContactSteps:0,wheelStopContactSteps:0,airborneSteps:0,pathLengthM:0,contactObjectIds:[],solverFault:null};
  const objects=new Set();let previousSpeedKmh=initial.speedKmh;
  for(let step=0;step<Math.round(seconds/DT);step++){
    const input=inputAt(step,sim),t=sim.advanceFixed(input),contacts=sim.getContactDiagnostics(),e=energy(sim),wheels=t.wheelStates;
    if(t.fault){summary.solverFault=t.failure??t.fault;failures.push({id,type:'solver-fault',details:summary.solverFault});break;}
    summary.maxSpeedKmh=Math.max(summary.maxSpeedKmh,t.speedKmh);summary.minSpeedKmh=Math.min(summary.minSpeedKmh,t.speedKmh);summary.maxMechanicalEnergyJ=Math.max(summary.maxMechanicalEnergyJ,total(e));summary.maxBodySlipDeg=Math.max(summary.maxBodySlipDeg,Math.abs(t.bodySlipDeg));summary.maxYawRateDegS=Math.max(summary.maxYawRateDegS,Math.abs(t.angularVelocity.y)*180/Math.PI);summary.peakWheelSteerDeg=Math.max(summary.peakWheelSteerDeg,Math.abs(t.steeringCentreDeg));
    summary.maxTiltDeg=Math.max(summary.maxTiltDeg,Math.acos(Math.max(-1,Math.min(1,1-2*(t.quaternion.x*t.quaternion.x+t.quaternion.z*t.quaternion.z))))*180/Math.PI);summary.airborneSteps+=Number(t.contactCount===0);summary.hullContactSteps+=Number(contacts.some(c=>c.vehicleShape<4));summary.wheelStopContactSteps+=Number(contacts.some(c=>c.vehicleShape>=4));summary.pathLengthM+=sim.body.position.distanceTo(last);last.copy(sim.body.position);
    if(summary.firstFixtureContact===null&&(contacts.some(c=>c.objectId.startsWith('fixture-'))||wheels.some(w=>w.contact&&(w.contactObjectId??'').startsWith('fixture-'))))summary.firstFixtureContact={step:step+1,timeS:t.simTime-startTime,preIntegrationSpeedKmh:previousSpeedKmh,postIntegrationSpeedKmh:t.speedKmh,position:t.position};
    for(const c of contacts){objects.add(c.objectId);summary.maxPenetrationM=Math.max(summary.maxPenetrationM,c.penetrationM);}
    for(const w of wheels){if(w.contactObjectId)objects.add(w.contactObjectId);summary.maxWheelLoadN=Math.max(summary.maxWheelLoadN,w.normalLoadN);summary.minSuspensionLengthM=Math.min(summary.minSuspensionLengthM,w.suspensionLength);summary.maxSuspensionLengthM=Math.max(summary.maxSuspensionLengthM,w.suspensionLength);summary.maxWheelLongitudinalSlip=Math.max(summary.maxWheelLongitudinalSlip,Math.abs(w.slipRatio??0));summary.maxWheelSlipAngleDeg=Math.max(summary.maxWheelSlipAngleDeg,Math.abs(w.slipAngle??0)*180/Math.PI);summary.maxGripUse=Math.max(summary.maxGripUse,w.gripUse);}
    rows.push(JSON.stringify({caseId:id,step:step+1,timeS:t.simTime-startTime,input,position:t.position,velocity:t.velocity,quaternion:t.quaternion,angularVelocity:t.angularVelocity,speedKmh:t.speedKmh,bodySlipDeg:t.bodySlipDeg,steeringCentreDeg:t.steeringCentreDeg,energy:e,brakeDissipationJ:t.brakeDissipationJ,tireDissipationJ:t.tireDissipationJ,contacts,
      wheels:wheels.map(w=>({id:w.id,objectId:w.contactObjectId,contact:w.contact,loadN:w.normalLoadN,suspensionM:w.suspensionLength,steerRad:w.steer,omegaRadS:w.angularVelocityRadS,alphaRad:w.slipAngle,kappa:w.slipRatio,longitudinalSpeedMps:w.longitudinalSpeedMps,lateralSpeedMps:w.lateralSpeedMps,gripUse:w.gripUse,FxN:w.longitudinalForceN,FyN:w.lateralForceN}))}));previousSpeedKmh=t.speedKmh;
  }
  const end=sim.telemetry();Object.assign(summary,{contactObjectIds:[...objects],finalPosition:end.position,finalSpeedKmh:end.speedKmh,speedLossKmh:initial.speedKmh-end.speedKmh,finalEnergy:energy(sim),unexplainedPeakEnergyGainJ:Math.max(0,summary.maxMechanicalEnergyJ-total(initialEnergy)),energyAccountingScope:'rigid translation + rotation + wheel rotation + gravity + ray-spring potential; no motor in passive cases. Ideal ray suspension relocates spring compression at a discontinuity; this diagnostic is not a complete deformable-tyre work model.'});
  summary.physicalOutcome=summary.solverFault?'solver-fault':summary.maxTiltDeg>60?'vehicle-upset':summary.hullContactSteps>0?'hull-contact':'finite-contact-response';
  summary.unexplainedPeakEnergyGainFraction=summary.unexplainedPeakEnergyGainJ/Math.max(1,total(initialEnergy));
  if(kind!=='steering'&&summary.unexplainedPeakEnergyGainFraction>.04)failures.push({id,type:'passive-energy-review',actualFraction:summary.unexplainedPeakEnergyGainFraction,screeningLimit:.04,meaning:'Retained review case; identifies unmodelled work/numerical injection, not a certification limit'});
  if(summary.maxPenetrationM>.30)failures.push({id,type:'penetration-review',actualM:summary.maxPenetrationM,screeningLimitM:.30});
  assert.ok(summary.maxGripUse<=1+1e-8,'Combined tyre budget must remain bounded');assert.ok(summary.minSuspensionLengthM>=sim.params.suspensionMin-1e-9&&summary.maxSuspensionLengthM<=sim.params.suspensionRest+sim.params.suspensionDroop+1e-9,'Suspension stops retained');
  cases.push(summary);console.log(`${id}: ${initial.speedKmh.toFixed(1)} -> ${end.speedKmh.toFixed(1)} km/h, penetration ${summary.maxPenetrationM.toFixed(4)} m, peak energy gain ${(100*summary.unexplainedPeakEnergyGainFraction).toFixed(2)}%`);
}

for(const speed of [20,50,90])for(const h of [.02,.05,.10])for(const single of [false,true]){
  const sim=fixture(),id=`${single?'single-wheel':'full-width'}-step-${h*100}cm-${speed}`;
  sim._addBox('fixture-step','step',single?[.60,h,.80]:[12,h,60],single?[-.89,h/2,.4]:[0,h/2,30]);settle(sim);roll(sim,speed);run(id,'step',sim,Math.max(3,20/(speed/3.6)+2),()=>({}),{heightM:h,singleWheelPatch:single,nominalSpeedKmh:speed});
}

for(const speed of [20,50,90])for(const endpoint of ['foot','crest']){
  const sim=fixture(),angle=Math.atan2(2,20);sim._addBox('fixture-ramp','ramp',[12,.5,Math.hypot(20,2)],[0,1-.25/Math.cos(angle),10],[-angle,0,0]);sim._addBox('fixture-upper','deck',[12,2,70],[0,1,55]);
  settle(sim,endpoint==='crest'?{z:12,y:1.2+.62,pitch:-angle}:{});roll(sim,speed,{pitch:endpoint==='crest'?-angle:0});run(`slope-${endpoint}-${speed}`,'slope',sim,(endpoint==='crest'?17:36)/(speed/3.6)+1.5,()=>({}),{slopeDegrees:angle*180/Math.PI,endpoint,nominalSpeedKmh:speed});
}

for(const speed of [50,90]){const sim=fixture();sim._addBox('fixture-pillar','pillar',[1.2,12,1.2],[0,6,0]);settle(sim);roll(sim,speed);run(`pillar-head-on-${speed}`,'collision',sim,3,()=>({}),{nominalSpeedKmh:speed});}
{const sim=fixture();sim._addBox('fixture-pillar','pillar',[1.2,12,1.2],[0,6,0]);settle(sim,{x:-.8});roll(sim,50,{heading:10*Math.PI/180});run('pillar-oblique-50','collision',sim,3,()=>({}),{nominalSpeedKmh:50,headingDeg:10});}
{const sim=fixture();sim._addBox('fixture-guardrail','rail',[.3,1.1,100],[3,.55,30]);settle(sim,{x:1});roll(sim,50,{heading:5*Math.PI/180});run('guardrail-oblique-50','collision',sim,4,()=>({}),{nominalSpeedKmh:50,headingDeg:5});}
{const sim=fixture();settle(sim);sim.body.position.y=5;sim.body.velocity.set(0,-8,0);run('hard-landing-8mps','landing',sim,3,()=>({}),{initialVerticalMps:-8,initialCgHeightM:5});}

// Actual driverAxes key mapping and genuine continuous axis requests are kept
// separate. These are numerical key-state fixtures, not native keyboard UX.
for(const speed of [54,90])for(const surface of ['dry','wet'])for(const device of ['keyboard','axis']){
  const sim=fixture({regenForce:2600});settle(sim);sim.setRoadSurface(surface);roll(sim,speed);const keys=new Set(['KeyD']);
  run(`steering-${speed}-${surface}-${device}`,'steering',sim,4,()=>device==='keyboard'?{steer:driverAxes(keys,null).steer}:{steer:speed===54?.2:.5},{nominalSpeedKmh:speed,roadSurface:surface,inputDeviceFixture:device,inputMeaning:device==='keyboard'?'held KeyD mapped through production driverAxes':'constant normalized analogue request',physicalDryMu:sim.params.tireMu});
}

mkdirSync(new URL('../qa/',import.meta.url),{recursive:true});
const traces=Buffer.from(rows.join('\n')+'\n'),compressed=gzipSync(traces,{level:9});writeFileSync(new URL(`../qa/contact-regressions-${REPORT_VERSION}.ndjson.gz`,import.meta.url),compressed);
const sourcePaths=['dist/physics.js','dist/tire-dynamics.js','dist/simulation-safety.js','dist/controls.js'];
const report={schema:'roadster-contact-regression-matrix',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:failures.length?'completed-with-retained-review-cases':cases.some(c=>c.physicalOutcome==='vehicle-upset')?'completed-with-adverse-physical-outcomes':'passed-numerical-screening',scope:'Declared isolated fixtures at 120 Hz. Intact city and real keyboard/camera driving acceptance are not inferred. Initial rolling velocity/wheel spin are fixture setup only; all subsequent movement is integrated.',physicsHz:120,sourceHashes:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))])),trace:{file:`contact-regressions-${REPORT_VERSION}.ndjson.gz`,format:'gzip of UTF-8 NDJSON, one full sample per 120 Hz physical step',samples:rows.length,uncompressedBytes:traces.length,compressedBytes:compressed.length,sha256:sha(compressed)},preconditionRevision:{retainedReport:'contact-preconditions-3.14.json',reason:'Default lift-off regen decelerated the approach; passive contact fixtures now declare regenForce=0 and report first contact speed. Steering fixtures retain default regenForce=2600.'},screeningCriteria:{passivePeakMechanicalEnergyGainFraction:.04,maximumContactPenetrationM:.30,notCertificationTolerances:true},cases,observedAdverseOutcomes:cases.filter(c=>['vehicle-upset','hull-contact'].includes(c.physicalOutcome)).map(c=>({id:c.id,outcome:c.physicalOutcome,maxTiltDeg:c.maxTiltDeg,hullContactSteps:c.hullContactSteps,finalSpeedKmh:c.finalSpeedKmh,meaning:'Physical outcome retained; a 90 km/h curb strike is not promised recoverable, and no solver bug is inferred solely from the upset.'})),retainedFailures:failures};
writeFileSync(new URL(`../qa/contact-regressions-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
assert.ok(cases.every(c=>!c.solverFault),'A solver fault is a hard numerical failure, not a successful contact test');
console.log(`Completed ${cases.length} isolated fixtures / ${rows.length} physical samples; retained ${failures.length} specific review cases in qa/contact-regressions-${REPORT_VERSION}.json.`);
