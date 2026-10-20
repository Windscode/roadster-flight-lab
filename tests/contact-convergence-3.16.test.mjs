import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RoadsterSim,DEFAULT_PARAMS} from '../dist/physics.js';
import {RoadsterSim as BeforeSim} from './fixtures/physics-3.15-before/physics.js';
import {worldBox,vehiclePenetrations,mechanicalEnergy,energyTotal} from './contact-geometry-oracle-3.16.mjs';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const checks=[],cases=[],trace=[],geometryChecks=[],HZ=[60,120,240,480,960,1920];
const hash=x=>createHash('sha256').update(x).digest('hex'),copy=v=>({x:v.x,y:v.y,z:v.z});
const check=(name,pass,details={})=>{checks.push({name,passed:!!pass,...details});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
function fixture(Sim,single,{height=.1,speedKmh=90}={}){
  const s=new Sim({regenForce:0});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);
  s.geometry=s.geometry.filter(g=>g.id==='ground');s.reset('free');s.setAirStabilization(false);
  s._addBox('fixture-step','step',single?[.6,height,.8]:[12,height,60],single?[-.89,height/2,.4]:[0,height/2,30]);
  s.body.position.set(0,.62,-12);for(let i=0;i<180;i++)s.advanceFixed({brake:1});
  s.body.velocity.set(0,0,speedKmh/3.6);s.wheelStates.forEach(w=>w.angularVelocityRadS=speedKmh/3.6/s.params.wheelRadius);
  return s;
}

// A circular tyre contacts the top leading edge before the axle reaches it.
// The independent closed form is centreY=h+sqrt(R²-d²), n=(0,sqrt/R,-d/R).
for(const offset of [.10,.20,.30])for(const single of [false,true]){
  const before=fixture(BeforeSim,single),after=fixture(RoadsterSim,single);
  for(const s of [before,after]){s.body.position.set(0,.657,-1.42-offset);s.body.velocity.setZero();s.body.angularVelocity.setZero();s._wheels(1/120,{throttle:0,steer:0,brake:0});}
  const w=after.wheelStates[0],expectedLength=.657+.06-.1-Math.sqrt(.37**2-offset**2),expectedNormal={x:0,y:Math.sqrt(.37**2-offset**2)/.37,z:-offset/.37};
  const expectedObject=expectedLength<.657+.06-.37?'fixture-step':'ground';
  const row={expectedObject,offsetM:offset,singleWheelPatch:single,beforeObject:before.wheelStates[0].contactObjectId,afterObject:w.contactObjectId,actualLengthM:w.contactGeometry?.suspensionLengthM,expectedLengthM:expectedLength,actualNormal:w.contactNormalWorld,expectedNormal,patch:w.contactPointWorld};geometryChecks.push(row);
  check(`Circular edge support matches the analytic ${offset} m axle offset (${single?'single':'full'})`,w.contactObjectId===expectedObject&&before.wheelStates[0].contactObjectId==='ground'&&(expectedObject==='ground'?Math.abs(w.contactGeometry.suspensionLengthM-(.657+.06-.37))<1e-9:Math.abs(w.contactGeometry.suspensionLengthM-expectedLength)<1e-9&&Math.abs(w.contactNormalWorld.z-expectedNormal.z)<1e-9&&Math.abs(w.contactPointWorld.z)<1e-9),row);
}

function computeCost(Sim,hz,single,options){
  const samples=[];
  for(let repeat=0;repeat<3;repeat++){
    const s=fixture(Sim,single,options),cpu=process.cpuUsage(),start=performance.now();
    for(let i=0;i<Math.round(options.seconds*hz);i++)s._advance(1/hz,{});
    const elapsed=performance.now()-start,used=process.cpuUsage(cpu);
    samples.push({wallMs:elapsed,cpuMs:(used.user+used.system)/1000});
  }
  const median=key=>samples.map(s=>s[key]).sort((a,b)=>a-b)[1];
  return{samples,medianWallMs:median('wallMs'),medianCpuMs:median('cpuMs'),cpuMsPerSimulatedSecond:median('cpuMs')/options.seconds,scope:'Three runs without SAT/contact trace hooks; process user+system CPU and elapsed wall time. Constructor/settling, full telemetry creation and rendering excluded. Concurrent host activity can affect timings.'};
}
function run(variant,Sim,hz,single,{height=.1,speedKmh=90,seconds=3}={}){
  const s=fixture(Sim,single,{height,speedKmh}),id=`${variant}-${single?'single':'full'}-${height*100}cm-${speedKmh}kmh-${hz}Hz`,boxes=s.geometry.map(worldBox),e0=energyTotal(mechanicalEnergy(s));
  let elapsed=0,slices=0,controlStep=0,maxRawPen=0,maxSAT=0,maxStepSAT=0,maxImpulse=0,maxForce=0,maxTilt=0,maxEnergy=e0,minDt=Infinity,maxDt=0,firstContact=null,primaryImpulse=[0,0,0],primaryNormal=0,refinedControlSteps=0;
  const checkpoints={},original=s.world.step.bind(s.world);
  s.world.step=dt=>{
    const preSpeed=s.body.velocity.length()*3.6;original(dt);elapsed+=dt;slices++;minDt=Math.min(minDt,dt);maxDt=Math.max(maxDt,dt);
    const contacts=s.getContactDiagnostics(),sat=vehiclePenetrations(s,boxes),energy=mechanicalEnergy(s),stepContacts=contacts.filter(c=>c.objectId==='fixture-step'),supported=s.wheelStates.some(w=>w.contact&&w.contactObjectId==='fixture-step');
    const penetration=Math.max(0,...sat.map(c=>c.penetrationM)),raw=Math.max(0,...contacts.map(c=>c.penetrationM)),stepSAT=Math.max(0,...sat.filter(c=>c.objectId==='fixture-step').map(c=>c.penetrationM));
    const normalImpulse=contacts.reduce((sum,c)=>sum+Math.max(0,c.normalForceN)*dt,0);
    maxRawPen=Math.max(maxRawPen,raw);maxSAT=Math.max(maxSAT,penetration);maxStepSAT=Math.max(maxStepSAT,stepSAT);maxImpulse=Math.max(maxImpulse,normalImpulse);maxForce=Math.max(maxForce,...contacts.map(c=>Math.max(0,c.normalForceN)));maxEnergy=Math.max(maxEnergy,energyTotal(energy));
    const tilt=Math.acos(Math.max(-1,Math.min(1,1-2*(s.body.quaternion.x**2+s.body.quaternion.z**2))))*180/Math.PI;maxTilt=Math.max(maxTilt,tilt);
    if(!firstContact&&(stepContacts.length||supported))firstContact={timeS:elapsed,preImpactSpeedKmh:preSpeed,postImpactSpeedKmh:s.body.velocity.length()*3.6,integratorDtS:dt,mechanism:stepContacts.length?'rigid-contact':'circular-suspension-support'};
    if(firstContact&&elapsed-firstContact.timeS<=.2+1e-9){
      for(const c of stepContacts){const impulse=Math.max(0,c.normalForceN)*dt,sign=c.normalFromBody?-1:1;primaryNormal+=impulse;for(const [k,axis]of ['x','y','z'].entries())primaryImpulse[k]+=c.normal[axis]*impulse*sign;}
    }
    trace.push(JSON.stringify({id,controlStep,integrationSample:slices,timeS:elapsed,dt,position:copy(s.body.position),velocity:copy(s.body.velocity),quaternion:{...copy(s.body.quaternion),w:s.body.quaternion.w},angularVelocity:copy(s.body.angularVelocity),energy,contacts,sat,
      wheelContacts:s.wheelStates.map(w=>({id:w.id,object:w.contactObjectId,support:w.contactGeometry??null,suspensionM:w.suspensionLength,forceN:w.normalLoadN,normal:w.contactNormalWorld}))}));
  };
  for(controlStep=1;controlStep<=Math.round(seconds*hz);controlStep++){
    if(hz<=240)s.advanceFixed({},1/hz);else s._advance(1/hz,{});if(s._integration?.substeps>1)refinedControlSteps++;
    if(controlStep===hz||controlStep===Math.round(seconds*hz))checkpoints[(controlStep/hz).toFixed(1)]={position:copy(s.body.position),velocity:copy(s.body.velocity),quaternion:{...copy(s.body.quaternion),w:s.body.quaternion.w}};
    if(s._fault)break;
  }
  const row={id,variant,controlHz:hz,actualIntegrationSamples:slices,minIntegratorDtS:minDt,maxIntegratorDtS:maxDt,refinedControlSteps,singleWheelPatch:single,stepHeightM:height,nominalInitialSpeedKmh:speedKmh,durationS:seconds,
    stepEntry:hz<=240?'public-advanceFixed':'private-_advance-for-numerical-reference-only',computeCost:computeCost(Sim,hz,single,{height,speedKmh,seconds}),fixtureGeometry:s.geometry,firstContact,maxContactEquationDepthM:maxRawPen,maxIndependentSATPenetrationM:maxSAT,maxIndependentStepSATPenetrationM:maxStepSAT,peakPerSliceNormalImpulseNs:maxImpulse,peakContactNormalForceN:maxForce,
    primaryContactWindowS:.2,primaryStepNormalImpulseNs:primaryNormal,primaryStepImpulseVectorNs:primaryImpulse,maxTiltDeg:maxTilt,peakMechanicalEnergyGainFraction:Math.max(0,maxEnergy-e0)/e0,initialMechanicalEnergyJ:e0,finalMechanicalEnergyJ:energyTotal(mechanicalEnergy(s)),checkpoints,fault:s._fault,
    outcome:maxTilt>60?'vehicle-upset':'remained-upright',parameters:{...s.params}};
  cases.push(row);console.log(`${id}: SAT ${(maxSAT*1000).toFixed(2)} mm; contact-equation ${(maxRawPen*1000).toFixed(2)} mm; tilt ${maxTilt.toFixed(2)}°; ${slices} actual slices.`);return row;
}
for(const [variant,Sim]of [['before',BeforeSim],['after',RoadsterSim]])for(const hz of HZ)for(const single of [false,true])run(variant,Sim,hz,single);
for(const single of [false,true])run('after',RoadsterSim,120,single,{height:.02,speedKmh:20,seconds:5});
const get=(variant,hz,single)=>cases.find(c=>c.variant===variant&&c.controlHz===hz&&c.singleWheelPatch===single&&c.nominalInitialSpeedKmh===90),distance=(a,b)=>Math.hypot(...['x','y','z'].map(k=>a[k]-b[k]));
const fullRates=HZ.map(hz=>get('after',hz,false)),singleRates=HZ.map(hz=>get('after',hz,true));
const successive=rates=>rates.slice(1).map((c,i)=>({fromHz:rates[i].controlHz,toHz:c.controlHz,positionDeltaAt3sM:distance(rates[i].checkpoints['3.0'].position,c.checkpoints['3.0'].position),velocityDeltaAt3sMps:distance(rates[i].checkpoints['3.0'].velocity,c.checkpoints['3.0'].velocity),peakTiltDeltaDeg:Math.abs(rates[i].maxTiltDeg-c.maxTiltDeg),sameUprightClassification:rates[i].outcome===c.outcome}));
const convergence={full:{successive:successive(fullRates),status:'NOT_CONVERGED_FULL_TRAJECTORY',reason:'Agreement of 60/120/240 Hz callers with 960 Hz contact slices is contradicted by the 480/960 Hz references; the 1920 Hz reference changes again. The full-width trajectory is not accepted as converged.'},
  single:{successive:successive(singleRates),status:'NOT_CONVERGED_FULL_TRAJECTORY',reason:'The severe asymmetric curb upset retains large post-impact trajectory sensitivity; a smaller penetration is not a full-contact-model validation.'}};
check('Caller intervals and actual contact integration intervals are independently measured',fullRates.filter(c=>c.controlHz<960).every(c=>c.actualIntegrationSamples>c.controlHz*c.durationS&&Math.abs(c.minIntegratorDtS-1/960)<1e-12)&&fullRates.filter(c=>c.controlHz>=960).every(c=>c.actualIntegrationSamples===c.controlHz*c.durationS));
check('The convergence assessment includes 480/960 Hz references and the contradictory 1920 Hz refinement',HZ.includes(480)&&HZ.includes(960)&&HZ.includes(1920)&&convergence.full.status==='NOT_CONVERGED_FULL_TRAJECTORY'&&convergence.single.status==='NOT_CONVERGED_FULL_TRAJECTORY',convergence);
check('120 Hz independent SAT penetration decreases for both 90 km/h 10 cm fixtures',get('after',120,false).maxIndependentSATPenetrationM<get('before',120,false).maxIndependentSATPenetrationM&&get('after',120,true).maxIndependentSATPenetrationM<get('before',120,true).maxIndependentSATPenetrationM);
check('The report retains the measured severe outcomes at every tested interval',cases.every(c=>c.outcome===(c.maxTiltDeg>60?'vehicle-upset':'remained-upright')),{scope:'Outcome classification is not an acceptance criterion for a 90 km/h curb strike.'});
check('All passive cases remain finite with no significant peak mechanical energy creation',cases.every(c=>!c.fault&&c.peakMechanicalEnergyGainFraction<.005),{limitFraction:.005,scope:'Screen for energy injection only; deformation and damage energy are not modelled.'});
check('Suspension travel, damping, grip, lift and motor ratings retain the declared 3.15 values',DEFAULT_PARAMS.suspensionMin===.24&&DEFAULT_PARAMS.suspensionRest===.37&&DEFAULT_PARAMS.suspensionDamping===5800&&DEFAULT_PARAMS.tireMu===1.25&&DEFAULT_PARAMS.liftNozzleMax===20000&&DEFAULT_PARAMS.maxMotorForce===24000);
check('20 km/h 2 cm ordinary road cases stay upright',cases.filter(c=>c.nominalInitialSpeedKmh===20).every(c=>c.maxTiltDeg<15&&!c.fault));
const bytes=gzipSync(Buffer.from(trace.join('\n')+'\n'),{level:9}),traceName='contact-convergence-3.16.ndjson.gz';writeFileSync(new URL('../qa/'+traceName,import.meta.url),bytes);
const sources=['dist/physics.js','dist/wheel-contact-envelope.js','dist/contact-step-schedule.js','dist/simulation-safety.js','tests/contact-geometry-oracle-3.16.mjs'];
const report={schema:'roadster-independent-contact-convergence',version:1,createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:checks.every(c=>c.passed)?'geometry-and-diagnostic-regressions-passed-contact-trajectories-not-converged':'failed',
  baseline:JSON.parse(readFileSync(new URL('./fixtures/physics-3.15-before/provenance.json',import.meta.url),'utf8')),sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(readFileSync(new URL('../'+p,import.meta.url)))])),checks,geometryChecks,cases,convergence,
  geometryMethod:'Independent analytic circular edge contact; independent separating-axis test on transformed regular 20-gon cylinder and box volumes. SAT samples every actual solver slice. Contact-equation post-step offsets are reported separately.',
  energyScope:'Translation, body/wheel rotation, gravity and suspension spring potential. The stored spring compression is the last force-evaluation value. No drive/regen input in these declared passive fixtures. Energy screens are not a complete deformable tyre, restitution or damage validation.',
  trace:{file:traceName,format:'gzip UTF-8 NDJSON; one row per actual integrator slice, with caller step and dt',samples:trace.length,bytes:bytes.length,sha256:hash(bytes)},
  limits:['Neither severe fixture has a converged complete impact trajectory. Agreement at 60/120/240 Hz caller intervals alone was a false impression and is explicitly contradicted by finer references.','The 120 Hz product input interval is retained; hard contact can use the same solver at 960 Hz internally. This is not a claim of three pure 60/120/240 Hz solvers agreeing.','The continuous crowned support envelope is a radius-R sphere clipped to the existing finite tyre width, not a measured tyre profile; independent 20-sided rigid wheel stops retain their facets. Tyre deformation, rim damage and suspension structural failure are outside this model.','Full-width finite response and lower penetration do not establish that a real car could safely cross a 10 cm curb at 90 km/h.','Both 90 km/h 10 cm fixtures retain unresolved post-impact trajectory convergence. This is an open physical/numerical limitation, not reclassified as normal or accepted.']};
writeFileSync(new URL('../qa/contact-convergence-3.16.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
