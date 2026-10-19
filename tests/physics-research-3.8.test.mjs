import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim,PHYSICS_HZ} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {integrateWheel} from '../dist/tire-dynamics.js';

const dt=1/PHYSICS_HZ,checks=[],evidence={};
const check=(name,run)=>{run();checks.push({name,status:'PASS'});console.log('PASS: '+name);};
const clone=value=>JSON.parse(JSON.stringify(value));
const drive=(sim,seconds,input={},hz=120)=>{let t;for(let i=0;i<Math.round(seconds*hz);i++){t=sim.advanceFixed(typeof input==='function'?input(i/hz):input,1/hz);assert.equal(t.fault,null);}return t;};
const fixture=(params={},hz=120)=>{const sim=new RoadsterSim(params,{world:'windlab'});sim.body.position.z=-40;drive(sim,2,{},hz);return sim;};
const roadInitialSpeed=(sim,speed)=>{sim.body.velocity.set(0,0,speed);sim.body.angularVelocity.setZero();for(const w of sim.wheelStates){w.angularVelocityRadS=speed/sim.params.wheelRadius;w.rotation=0;w.absPressure=1;w.tcsFactor=1;}};
const dynamicState=sim=>{const t=sim.telemetry();return{position:t.position,quaternion:t.quaternion,velocity:t.velocity,angularVelocity:t.angularVelocity,simTime:t.simTime,gasMass:t.gasMass,temperature:t.gasTemperatureK,nozzles:t.nozzles,wheels:t.wheelStates,wing:t.wing,observation:t.observation,reference:t.reference};};

check('Complete snapshots restore ground contact, active flight/valves, delayed seeded observation and maneuver continuation; invalid/version-mixed imports are atomic',()=>{
  const fixtures=[];
  const road=fixture({roadSurface:'split'});drive(road,.3,{throttle:.8,steer:.25});fixtures.push(road);
  const flight=new RoadsterSim({supplyMode:'finite',tankLitres:1100});flight.reset('hover');flight.setWind({speedMps:3,directionDeg:90,gustMps:1.2,gustPeriodS:2.7});
  flight.setObservation({enabled:true,delayMs:40,seed:381,positionNoiseM:.01,velocityNoiseMps:.02,attitudeNoiseDeg:.05,angularRateNoiseRadS:.002});flight.setNozzleFault({id:'lift-FR',scale:.8});flight.step(.0625,{pitch:.2});fixtures.push(flight);
  const roll=new RoadsterSim();roll.reset('hover');assert.equal(roll.startManeuver('roll'),true);drive(roll,1.1);fixtures.push(roll);
  const hull=new RoadsterSim();hull.body.position.y=.30;hull.step(dt);assert.ok(hull.world.contacts.length>0);fixtures.push(hull);
  const cases=[];
  for(const sim of fixtures){
    const snapshot=clone(sim.exportState()),restored=new RoadsterSim(snapshot.params,{world:snapshot.worldType});restored.importState(snapshot);
    assert.deepEqual(dynamicState(restored),dynamicState(sim));
    for(let i=0;i<180;i++){const input=sim===road?{throttle:i<90?.4:0,steer:.2}:{};sim.step(dt,input);restored.step(dt,input);assert.deepEqual(dynamicState(restored),dynamicState(sim));}
    const unchanged=clone(restored.exportState());
    for(const mutate of [s=>s.modelVersion='3.7.0',s=>s.state._positionTarget={x:0,y:0,z:0},s=>delete s.state._observationSeed,s=>s.state._nozzles[0].column[0]=123,s=>s.geometrySignature='other-scene']){
      const bad=clone(snapshot);mutate(bad);assert.throws(()=>restored.importState(bad));assert.deepEqual(clone(restored.exportState()),unchanged);
    }
    cases.push({world:snapshot.worldType,maneuver:snapshot.state._maneuver?.name??null,initialSimTime:snapshot.state.simTime,initialPhase:snapshot.state._accumulator,historySamples:snapshot.state._observationHistory.length,maxPositionDifferenceM:0,comparedPhysicalSteps:180});
  }
  evidence.snapshotCases=cases;
});

check('A fixed-step observation/input/reference sequence is bitwise repeatable at 60/120/240 display Hz, and failed substeps remain observable',()=>{
  const initial=new RoadsterSim();initial.reset('hover');initial.setWind({speedMps:2,directionDeg:35,gustMps:1,gustPeriodS:1.7});initial.setObservation({enabled:true,seed:2838,delayMs:25,positionNoiseM:.006,velocityNoiseMps:.01,attitudeNoiseDeg:.03});initial.step(1/144);
  const snapshot=clone(initial.exportState()),states=[];
  for(const fps of [60,120,240]){
    const sim=new RoadsterSim(snapshot.params,{world:snapshot.worldType});sim.importState(snapshot);let fixed=0,samples=0;
    for(let frame=0;frame<fps*3;frame++)sim.step(1/fps,time=>({pitch:time<.5?.15:0,throttle:time>1&&time<1.5?.1:0}),()=>samples++,()=>fixed++);
    states.push(dynamicState(sim));assert.equal(fixed,360);assert.equal(samples,60);
  }
  assert.deepEqual(states[1],states[0]);assert.deepEqual(states[2],states[0]);
  const broken=new RoadsterSim();broken.body.position.y=400;let failure;
  broken.step(dt,{},null,t=>{failure=t.fault;});assert.ok(failure,'fault callback must preserve numerical recovery evidence');
  evidence.displayRateRepeatability={displayHz:[60,120,240],fixedSteps:360,samples20Hz:60,bitwiseEqual:true,failureCallbackObserved:true};
});

check('Independent tire/wheel integration dissipates slip and brake energy, obeys combined friction and settles forward/reverse low-speed contact',()=>{
  const rows=[];
  for(const hz of [60,120,240])for(const sign of [-1,1]){
    const wheel={angularVelocityRadS:sign*8,rotation:0};let speed=sign*16,previous=.5*500*speed**2+.5*1.8*wheel.angularVelocityRadS**2,maxEnergyGain=0,maxGrip=0;
    for(let i=0;i<hz*4;i++){
      const result=integrateWheel(wheel,{dt:1/hz,vlong:speed,normalLoadN:5500,mu:.65,lateralForceN:0,driveTorqueNm:0,brakeTorqueNm:1500,radius:.37,inertia:1.8,effectiveMass:500});
      speed+=result.longitudinalForceN/500/hz;
      const energy=.5*500*speed**2+.5*1.8*wheel.angularVelocityRadS**2;maxEnergyGain=Math.max(maxEnergyGain,energy-previous);previous=energy;
      maxGrip=Math.max(maxGrip,Math.hypot(result.longitudinalForceN,result.lateralForceN)/(.65*5500));
      assert.ok(result.brakeEnergyJ>=0&&result.tireEnergyJ>=0);assert.ok(energy>=0);
    }
    assert.ok(maxEnergyGain<1e-8);assert.ok(Math.abs(speed)<1e-6);assert.ok(Math.abs(wheel.angularVelocityRadS)<1e-8);assert.ok(maxGrip<=1+1e-10);
    rows.push({hz,direction:sign,maxEnergyGainJ:maxEnergyGain,finalSpeedMps:speed,finalOmegaRadS:wheel.angularVelocityRadS,maxGrip});
  }
  const airborne=new RoadsterSim();airborne.reset('hover');airborne.setMode('drive');airborne.body.position.y=30;airborne.wheelStates.forEach(w=>w.angularVelocityRadS=50);drive(airborne,.4);
  assert.ok(airborne.wheelStates.every(w=>Math.abs(w.angularVelocityRadS-50)<1e-10&&w.rotation>19.9&&w.slipRatio===null));
  const brake=airborne.wheelStates[0].angularVelocityRadS;drive(airborne,.2,{brake:1});assert.ok(airborne.wheelStates.every(w=>Math.abs(w.angularVelocityRadS)<brake*.05));
  evidence.wheelEnergy=rows;evidence.freeWheel={initialOmegaRadS:50,airborneCoastSeconds:.4,brakeSeconds:.2,bodySpeedDidNotDefineWheelSpin:true};
});

function roadTrial(surface,assist,launch){
  const sim=fixture({roadSurface:surface,absEnabled:assist,tractionAssist:assist});if(!launch)roadInitialSpeed(sim,80/3.6);
  const z0=sim.body.position.z;let sumSlip=0,sampleCount=0,peakSlip=0,lockedWheelSamples=0,regulatedWheelSamples=0,maxGrip=0,time=0,peakYawRate=0;
  for(let i=0;i<120*(launch?3:8);i++){
    const t=sim.advanceFixed(launch?{throttle:1}:{brake:1});time=(i+1)/120;assert.equal(t.fault,null);assert.equal(t.contactCount,4);
    peakYawRate=Math.max(peakYawRate,Math.abs(t.angularVelocity.y));
    for(const w of t.wheelStates){assert.ok(w.gripUse<=1+1e-10);maxGrip=Math.max(maxGrip,w.gripUse);if(Math.abs(w.contactSpeedMps)>3){sumSlip+=Math.abs(w.slipRatio);sampleCount++;peakSlip=Math.max(peakSlip,Math.abs(w.slipRatio));if(Math.abs(w.angularVelocityRadS)<1)lockedWheelSamples++;if(w.absActive||w.tcsActive)regulatedWheelSamples++;}}
    if(!launch&&t.speedKmh<.36)break;
  }
  if(!launch)assert.ok(sim.telemetry().speedKmh<.36,'braking must reach a measured stop');
  return{surface,assistance:assist,trial:launch?'full-throttle-3s':'80kmh-service-brake',distanceM:sim.body.position.z-z0,elapsedS:time,finalSpeedKmh:sim.telemetry().speedKmh,meanAbsoluteSlip:sumSlip/sampleCount,peakSlip,lockedWheelSamples,regulatedWheelSamples,peakYawRateRadS:peakYawRate,maxGrip};
}
check('Dry/wet/split-mu braking and launch pairs show actual lock/spin without assists and measured slip regulation with ABS/TCS, without guaranteeing shorter stops',()=>{
  const rows=[];
  for(const surface of ['dry','wet','split'])for(const launch of [false,true]){
    const off=roadTrial(surface,false,launch),on=roadTrial(surface,true,launch);rows.push(off,on);
    assert.ok(on.meanAbsoluteSlip<off.meanAbsoluteSlip*.6);assert.ok(on.regulatedWheelSamples>0);assert.equal(off.regulatedWheelSamples,0);
    if(!launch){assert.ok(off.lockedWheelSamples>20);assert.equal(on.lockedWheelSamples,0);}else assert.ok(off.peakSlip>.5);
  }
  const wet=rows.find(r=>r.surface==='wet'&&!r.assistance&&r.trial==='80kmh-service-brake'),dry=rows.find(r=>r.surface==='dry'&&!r.assistance&&r.trial==='80kmh-service-brake');assert.ok(wet.distanceM>dry.distanceM*1.5);
  evidence.roadComparison=rows;
});

check('The physical road integration converges at 60/120/240 Hz and preserves steering/contact transitions instead of changing the display rate',()=>{
  const rows=[];
  for(const hz of [60,120,240]){
    const sim=fixture({roadSurface:'wet'},hz);roadInitialSpeed(sim,80/3.6);const z0=sim.body.position.z;
    const t=drive(sim,2,{brake:1},hz);assert.equal(t.contactCount,4);assert.ok(t.wheelStates.every(w=>w.gripUse<=1+1e-10));
    rows.push({hz,distanceM:sim.body.position.z-z0,speedMps:sim.body.velocity.z,wheelOmegaRadS:sim.wheelStates.map(w=>w.angularVelocityRadS),pitchDeg:t.pitchDeg});
  }
  const coarse=Math.abs(rows[1].distanceM-rows[0].distanceM),fine=Math.abs(rows[2].distanceM-rows[1].distanceM);
  assert.ok(fine<coarse*.65);assert.ok(fine<.04);assert.ok(Math.abs(rows[2].speedMps-rows[1].speedMps)<.015);
  const takeoff=fixture();drive(takeoff,.8,{throttle:.4});const omega=takeoff.wheelStates.map(w=>w.angularVelocityRadS);drive(takeoff,1.7,{lift:1});assert.equal(takeoff.telemetry().contactCount,0);assert.ok(takeoff.wheelStates.some((w,i)=>Math.abs(w.angularVelocityRadS-omega[i])<8));drive(takeoff,4,{lift:-1});assert.equal(takeoff.telemetry().mode,'drive');assert.ok(takeoff.wheelStates.every(w=>Number.isFinite(w.angularVelocityRadS)));
  evidence.physicalStepConvergence={rows,coarseDistanceDifferenceM:coarse,fineDistanceDifferenceM:fine,method:'Cannon chassis first-order translation + implicit substepped wheel contact; this is physical dt, not display FPS'};
});

check('The finite-rate wing actuator generates no zero-q force and fixed/active choices change drag and rear wheel load in the physical state',()=>{
  const still=new RoadsterSim({wingMode:'fixed',wingDeployment:1});still.body.velocity.setZero();still.body.angularVelocity.setZero();still.body.force.setZero();still.body.torque.setZero();still._aero(dt);
  assert.equal(still._wing.dragN,0);assert.equal(still._wing.downforceN,0);
  still.setWing({mode:'fixed',deployment:0});still._aero(.1);assert.ok(Math.abs(still._wing.deployment-.85)<1e-12);
  const rows=[];
  for(const deployment of [0,1]){
    const sim=fixture({wingMode:'fixed',wingDeployment:deployment});roadInitialSpeed(sim,30);const t=drive(sim,.75);
    rows.push({deployment,speedKmh:t.speedKmh,wing:t.wing,wheelLoadsN:t.wheelStates.map(w=>w.normalLoadN),totalWheelLoadN:t.wheelStates.reduce((a,w)=>a+w.normalLoadN,0)});
  }
  assert.ok(rows[1].wing.dragN>100&&rows[1].wing.downforceN>180);assert.ok(rows[1].speedKmh<rows[0].speedKmh);assert.ok(rows[1].totalWheelLoadN>rows[0].totalWheelLoadN+150);assert.ok(rows[1].wheelLoadsN[2]>rows[0].wheelLoadsN[2]+100);
  const active=fixture({wingMode:'active'});roadInitialSpeed(active,30);const initial=active._wing.deployment;let last=initial;
  for(let i=0;i<24;i++){const t=active.advanceFixed({brake:1});assert.ok(Math.abs(t.wing.deployment-last)<=active.params.wingActuatorRate*dt+1e-12);last=t.wing.deployment;}
  assert.ok(last>initial+.25);evidence.wing={fixedComparison:rows,activeDeploymentAfterPoint2Seconds:last,zeroDynamicPressureForcesN:[still._wing.dragN,still._wing.downforceN]};
});

check('Seeded delay/noise changes the actual feedback solution, nozzle derating changes allocation, and onboard/external gas accounting stays distinct',()=>{
  const base=new RoadsterSim();base.reset('hover');const snapshot=base.exportState();const runs=[];
  for(const seed of [77,77,78]){const sim=new RoadsterSim();sim.importState(snapshot);assert.equal(sim.setObservation({enabled:true,seed,delayMs:35,positionNoiseM:.02,velocityNoiseMps:.03,attitudeNoiseDeg:.08}),true);assert.equal(sim.setNozzleFault({id:'lift-FR',scale:.6}),true);drive(sim,1);runs.push(dynamicState(sim));assert.ok(sim._nozzles[0].maxForce<=sim.params.liftNozzleMax*.6+1e-9);assert.ok(sim._externalGasKg>1);assert.equal(sim._gasConsumedKg,0);const stored=sim._externalGasKg;sim.setSupplyMode('finite');drive(sim,.2);assert.equal(sim._externalGasKg,stored);assert.ok(sim._gasConsumedKg>0);assert.equal(sim.setObservation({enabled:true,seed:-1}),false);assert.equal(sim.setNozzleFault({id:'not-an-actuator',scale:0}),false);}
  assert.deepEqual(runs[0],runs[1]);assert.notDeepEqual(runs[0].quaternion,runs[2].quaternion);assert.notDeepEqual(runs[0].nozzles.map(n=>n.command),runs[2].nozzles.map(n=>n.command));
  const healthy=new RoadsterSim({liftNozzleMax:9000});healthy.reset('hover');const condition=healthy.exportState();assert.equal(healthy.startManeuver('roll'),true);
  const failed=new RoadsterSim(condition.params);failed.importState(condition);failed.setNozzleFault({id:'lift-FR',scale:0});const position=failed.body.position.clone();assert.equal(failed.startManeuver('roll'),false);assert.deepEqual(failed.body.position,position);assert.equal(failed._maneuver,null);
  evidence.observation={seeds:[77,77,78],sameSeedBitwiseEqual:true,differentSeedChangesRealActuatorCommand:true,noiseDistribution:'independent bounded uniform per axis, not Gaussian',delayMs:35,idealChannels:'wheel speed and contact switches',nozzleFault:{id:'lift-FR',scale:.6},preflightUsesKnownFaultAvailability:{ratedLiftN:9000,healthyAccepted:true,oneFailedRejected:true}};
});

const paths=['dist/physics.js','dist/vehicle-models.js','dist/tire-dynamics.js','dist/simulation-snapshot.js','dist/control-observation.js'];
const report={modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),status:'passed',checks:checks.length,sourceSha256:Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),acceptance:checks,evidence,
  regressionFixtureChanges:[{test:'tests/handling-controls.test.mjs',change:'The former exact load-proportional EBD-force assertion is replaced by total axle brake-request balance, delivered brake torque bounded by demand, independent finite wheel speed and the unchanged friction/yaw/contact/stop requirements.',reason:'Independent rotating wheels and ABS pressure modulation intentionally supersede ideal longitudinal force assignment.'},{tests:['tests/braking.test.mjs','tests/handling-controls.test.mjs','tests/research-dynamics.test.mjs','tests/flight-controls-3.7.test.mjs'],change:'Authored initial road speeds now initialize omega=v/r for all wheels. Waterfront approach/stop observation is12s instead of9s with unchanged marker, controls, collision and complete-stop assertions.',reason:'A stationary wheel on a vehicle initialized at300km/h is a locked-slide initial condition. Finite brake/wheel transients require a stopping interval after the approach marker.'}],
  assumptions:['Four independent lumped spin inertias; brush/sliding longitudinal law with regularized slip and a combined friction circle. Existing tire lateral relaxation and suspension contact remain.','ABS/TCS are finite-rate pressure/torque modulation from slip, with ideal wheel-speed sensing. No universal stopping-distance improvement is asserted.','Relative wheel spin acceleration reacts on the chassis. Steering-axis gyroscopic cross terms, full driveline dynamics, tire carcass thermodynamics and multi-body suspension are outside scope.','Wing area .38 m², Cd .75, downforce coefficient1.1, moving wing-origin[0,.325+.30u,-2.065]m, incidence-.25u rad, a point.05m forward on the wing and1.5/s travel rate are engineering assumptions, not Tesla calibration.','Delay/noise acts on flight position, velocity, attitude and angular-rate feedback. Wind is analytic; no CFD.'],limits:['These are numerical tests, not physical Tesla validation, GPU rendering or browser FPS measurements.','JSON exact replay is supported only for the same model version and static world geometry; the recording layer must additionally enforce build/protocol identity.']};
writeFileSync(new URL('../qa/physics-research-3.8.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(`Physics research3.8: ${checks.length} integrated acceptance groups passed.`);
