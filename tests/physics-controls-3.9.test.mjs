import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim,DEFAULT_PARAMS,PHYSICS_HZ} from '../dist/physics.js';
import {roadWheelAngle,MODEL_VERSION,nozzleExhaustVelocity} from '../dist/vehicle-models.js';
import {integrateWheel} from '../dist/tire-dynamics.js';
import {Quaternion,Vec3} from '../dist/vendor/cannon-es.js';
import {flatFixture,wheelBudgetFixture,steeringFixture,levelFixture,cityBendFixture,PHYSICS_39_BASE} from './physics-fixtures-3.9.mjs';

const dt=1/PHYSICS_HZ,checks=[],evidence={};
const baseline=JSON.parse(readFileSync(new URL('../qa/physics-controls-3.9-baseline.json',import.meta.url)));
assert.equal(baseline.sourceCommit,PHYSICS_39_BASE);
const check=(name,fn)=>{fn();checks.push({name,status:'PASS'});console.log('PASS: '+name);};
const close=(a,b,tol,label)=>assert.ok(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b} (tolerance ${tol})`);
const run=(sim,seconds,input={})=>{for(let i=0;i<Math.round(seconds*120);i++){sim._advance(dt,typeof input==='function'?input(i*dt,i):input);assert.equal(sim._fault,null);}return sim.telemetry();};
const physical=sim=>JSON.stringify([sim.body.position,sim.body.velocity,sim.body.quaternion,sim.body.angularVelocity]);

check('One four-wheel drive budget survives partial contacts, TCS and actual substep mechanical-work limits',()=>{
  const rows=[];
  for(const speed of [-30,0,.1,8,30,60])for(const grounded of [4,3,2,0])for(const tcs of [true,false]){
    const row=wheelBudgetFixture(RoadsterSim,{speed,grounded,tcs,throttle:speed<0?-1:1});rows.push(row);
    const a=row.accounting;
    assert.ok(a.requestedTorqueNm<=a.torqueBudgetNm+1e-9,'Ground and airborne requests share the one declared vehicle budget');
    assert.ok(a.postTcsTorqueNm<=a.requestedTorqueNm+1e-9,'TCS must only release requested torque');
    assert.ok(a.actualTorqueNm<=a.postTcsTorqueNm+1e-9,'Power limiting cannot increase post-TCS torque');
    assert.ok(row.mechanicalPowerW<=700000+1e-8,'Actual midpoint drive work / dt, not beginning-of-step T*omega');
    close(a.electricalWorkJ*.9,a.mechanicalWorkJ,1e-9,'90% electrical-to-shaft ledger');
    close(row.electricalEnergyJ,a.electricalWorkJ,1e-9,'Existing motor energy accounting remains the source');
    for(const w of row.wheels)if(!w.contact&&tcs)close(w.actualTorqueNm,0,0,'TCS cuts unloaded drive');
    if(!tcs)assert.ok(row.wheels.every(w=>Math.abs(w.requestedTorqueNm)>0),'No-TCS airborne spin consumes its own fixed share');
  }
  const stress=[];
  for(const hz of [60,120,240])for(const grounded of [4,3,2,0])for(const omegaScale of [.1,3]){
    const row=wheelBudgetFixture(RoadsterSim,{speed:30,grounded,tcs:false,dt:1/hz,omegaScale});
    assert.ok(row.mechanicalPowerW<=700000+1e-8);stress.push({hz,grounded,omegaScale,powerW:row.mechanicalPowerW});
  }
  const reportedBefore=baseline.wheelBudgets.filter(r=>r.speedMps===30&&r.tcs&&r.grounded>0);
  [721373.010166619,885719.1767803485,1060920.7494797613].forEach((v,i)=>close(reportedBefore[i].mechanicalPowerW,v,1e-6,'Independent 3.8 reproduction'));
  evidence.driveBudget={before:reportedBefore,after:rows.filter(r=>r.speedMps===30&&r.tcs&&r.grounded>0),operatingCases:rows,physicalStepStress:stress,
    policy:'TCS on: normalized load shares, zero drive torque for unloaded wheels. TCS off: 25% torque and power per wheel, including airborne spin. No redistribution of unused power within a substep.',
    limiter:'Analytic conservative midpoint-work bound from spin inertia and friction-circle contact torque; a small amount of rated power may remain unused.'};
});

check('Mechanical/electrical accounting remains physical during free spin and complete rigid-body takeoff/landing contact changes',()=>{
  const free=[];
  for(const sign of [-1,1])for(const hz of [60,120,240]){
    const w={angularVelocityRadS:80*sign,rotation:0},before=.5*1.8*w.angularVelocityRadS**2;
    const r=integrateWheel(w,{dt:1/hz,vlong:0,normalLoadN:0,mu:0,lateralForceN:0,driveTorqueNm:2200*sign,brakeTorqueNm:0,radius:.37,inertia:1.8,effectiveMass:500,absEnabled:false,tcsEnabled:false,maxDrivePowerW:175000});
    close(w.wheelEnergyJ-before,r.driveWorkJ,1e-8,'Free-wheel increase equals actual motor work');assert.ok(r.driveWorkJ*hz<=175000+1e-8);
    free.push({sign,hz,shaftWorkJ:r.driveWorkJ,wheelEnergyIncreaseJ:w.wheelEnergyJ-before,powerW:r.driveWorkJ*hz});
  }
  const sim=flatFixture(RoadsterSim);run(sim,.4,{throttle:.45});const startElectrical=sim._energyUsed*3.6e6;
  let motorElectricalJ=0,shaftJ=0,maxPowerW=0,maxTorqueExcessNm=0;const contacts=[];
  run(sim,10,(time)=>({throttle:time<3?.4:0,lift:time<3?1:-1}),);
  // Replay the same maneuver from a fresh deterministic vehicle while keeping
  // the accounting of every real rigid-body step, including re-contact.
  const trace=flatFixture(RoadsterSim);run(trace,.4,{throttle:.45});
  const before=trace._energyUsed*3.6e6;
  for(let i=0;i<1200;i++){
    trace._advance(dt,{throttle:i<360?.4:0,lift:i<360?1:-1});assert.equal(trace._fault,null);
    const a=trace._driveAccounting;motorElectricalJ+=a.electricalWorkJ;shaftJ+=a.mechanicalWorkJ;
    maxPowerW=Math.max(maxPowerW,a.mechanicalPowerW);maxTorqueExcessNm=Math.max(maxTorqueExcessNm,a.actualTorqueNm-a.torqueBudgetNm);
    if(contacts.at(-1)?.count!==trace._contactCount)contacts.push({timeS:(i+1)/120,count:trace._contactCount,wheelOmegaRadS:trace.wheelStates.map(w=>w.angularVelocityRadS)});
    assert.ok(a.mechanicalPowerW<=trace.params.motorPower+1e-8);assert.ok(a.actualTorqueNm<=a.torqueBudgetNm+1e-8);
    assert.ok(trace.wheelStates.every(w=>Number.isFinite(w.angularVelocityRadS)&&w.gripUse<=1+1e-10));
  }
  assert.ok(contacts.some(c=>c.count===0)&&contacts.at(-1).count===4);assert.equal(trace.mode,'drive');assert.ok(trace._thrustN<.01);
  close((trace._energyUsed*3.6e6-before)-800*10,motorElectricalJ,1e-7,'Battery ledger equals motor input plus existing 800 W auxiliaries');
  close(motorElectricalJ*.9,shaftJ,1e-7,'Accumulated electrical / shaft energy');
  close(sim._energyUsed*3.6e6-startElectrical,trace._energyUsed*3.6e6-before,1e-8,'Repeated physical contact maneuver accounting');
  evidence.contactAndEnergy={freeSpin:free,rigidBodyContactTransitions:contacts,maxMechanicalPowerW:maxPowerW,maxTorqueBudgetExcessNm:maxTorqueExcessNm,motorElectricalJ,shaftJ,auxiliaryPowerW:800,
    limits:'The one-step partial-contact fixtures are deterministic load fixtures. This takeoff/landing trace is a separate full Cannon trajectory, not a curb-traversal claim. External gas compressor power is off-board.'};
});

check('Faster steering develops real tire-force curvature and yaw response on low/mid/high-speed circles and an authored city intersection',()=>{
  const rows=[];
  for(const old of baseline.steering){
    const after=steeringFixture(RoadsterSim,{speed:old.initialSpeedMps});rows.push({before:old,after});
    assert.ok(after.radiusM<old.radiusM*.94,'Improvement must occur at the rigid body, not just the steering label');
    assert.ok(after.yawAtHalfSecondRadS>old.yawAtHalfSecondRadS*1.10,'Finite steering actuator response');
    assert.equal(after.minContacts,4);assert.ok(after.maxGrip<=1+1e-10);assert.ok(after.peakBetaDeg<8);
    assert.ok(after.lateralAccelerationMps2<DEFAULT_PARAMS.tireMu*DEFAULT_PARAMS.gravity,'No grip-force bypass');
  }
  const city=cityBendFixture(RoadsterSim,roadWheelAngle);
  assert.equal(city.finished,true);assert.equal(city.hullImpactSteps,0);assert.equal(city.minContacts,4);
  assert.ok(city.maxCrossTrackErrorM<baseline.cityBend.maxCrossTrackErrorM*.6);assert.ok(city.maxGrip<=1+1e-10);
  evidence.steering={circlesAndStepResponse:rows,cityBend:{before:baseline.cityBend,after:city},unchangedTireMu:DEFAULT_PARAMS.tireMu,
    changes:'Input-side lateral reference 0.9→1.0 g; inverse tanh lateral-slip compensation; steering lag 0.16→0.10 s and rack rate 1.25→1.8 rad/s. No direct pose/yaw writes, grip increase or yaw-force assist.',
    tradeoff:'A stronger full-key steering request causes more body slip; the high-speed radius remains constrained by tire force. The city test driver is confined to numerical validation and is not a gameplay shortcut.'};
});

check('E/Q use the selected velocity immediately, brake smoothly on release and taper descent into real ground contact',()=>{
  const rows=[];
  for(const level of [false,true])for(const climbRateMps of [.5,3,8]){
    const sim=flatFixture(RoadsterSim,{height:40,params:{climbRateMps}});sim.setAirStabilization(level);
    sim._advance(dt,{lift:1});close(sim._verticalControl.commandMps,climbRateMps,0,'Immediate pilot velocity reference');close(sim._verticalControl.targetMps,climbRateMps,0,'No hold-time ramp');
    run(sim,5-dt,{lift:1});const atRelease=sim.telemetry();assert.ok(atRelease.verticalSpeed<=climbRateMps+.01&&atRelease.verticalSpeed>climbRateMps*.97);
    sim._advance(dt,{});assert.equal(sim._verticalControl.commandMps,0);assert.equal(sim._verticalControl.targetMps,0);assert.equal(sim._verticalControl.braking,true);
    const stopped=run(sim,5);assert.ok(Math.abs(stopped.verticalSpeed)<.02);assert.ok(stopped.heightWorld>atRelease.heightWorld);
    const h=stopped.heightWorld;run(sim,1);assert.ok(Math.abs(sim.body.position.y-h)<.02);
    const down=flatFixture(RoadsterSim,{height:5,params:{climbRateMps}});down.setAirStabilization(level);let firstContact=null,peakFall=0;
    for(let k=0;k<12*120;k++){down._advance(dt,{lift:-1});peakFall=Math.max(peakFall,-down.body.velocity.y);if(down._contactCount&&!firstContact)firstContact={timeS:(k+1)/120,verticalSpeedMps:down.body.velocity.y};}
    assert.ok(firstContact);assert.ok(Math.abs(firstContact.verticalSpeedMps)<.8);assert.equal(down.mode,'drive');assert.equal(down._contactCount,4);assert.ok(down._thrustN<.01);run(down,.5);assert.equal(down.mode,'drive');assert.ok(down._thrustN<.01);
    rows.push({level,climbRateMps,ascentAt5sMps:atRelease.verticalSpeed,heightAtReleaseM:atRelease.heightWorld,heightAfterBrakingM:stopped.heightWorld,settledVerticalMps:stopped.verticalSpeed,descentFirstContact:firstContact,peakDescentMps:peakFall});
  }
  const grounded=flatFixture(RoadsterSim);grounded._advance(dt,{lift:1});assert.equal(grounded.mode,'hover');assert.equal(grounded._verticalControl.commandMps,3);
  const limited=flatFixture(RoadsterSim,{height:40,params:{climbRateMps:8,liftNozzleMax:4000}});const forceLimits=limited._nozzles.map(n=>n.kind==='lift'?4000:n.kind==='roll'?5500:11000);
  const t=run(limited,.5,{lift:1});assert.ok(t.verticalSpeed<0);assert.equal(t.verticalControl.commandMps,8);assert.equal(t.controlAuthority.levelTargetTrimFeasible,false);assert.ok(t.nozzles.every((n,i)=>n.force<=forceLimits[i]+1e-9));
  const state=physical(grounded);grounded.setParam('climbRateMps',99);assert.equal(grounded.params.climbRateMps,8);grounded.setParam('climbRateMps',0);assert.equal(grounded.params.climbRateMps,.5);assert.equal(physical(grounded),state);
  evidence.verticalResponse={runs:rows,units:'World vertical velocity m/s; requested command is independent of button hold duration.',defaultMps:3,rangeMps:[.5,8],normalAccelerationRequestLimitMps2:3,
    release:'Finite force brakes velocity toward zero, then captures the achieved stop height.',landing:'Descent reference includes 3 m/s² stopping distance, 0.4 s feedback/valve allowance and a low-speed contact approach; contact still physically decides touchdown.',
    insufficientThrust:{ratedLiftN:16000,requestedVelocityMps:8,actualVelocityMps:t.verticalSpeed,limited:true}};
});

check('G recovers level after manual pose changes and unsealed F arming, while real adhesion and finite thrust retain authority',()=>{
  const rows=[];
  for(const config of [{gesture:{roll:1}},{gesture:{roll:-1}},{gesture:{pitch:1}},{gesture:{pitch:-1}},{rollDeg:179,headingDeg:179},{rollDeg:-179,headingDeg:-179},{pitchDeg:89,headingDeg:179},{gesture:{roll:1},suctionArmed:true,seconds:5}]){
    const row=levelFixture(RoadsterSim,config);rows.push(row);assert.equal(row.setterMovedBody,false);assert.ok(row.maxForceRatio<=1+1e-10);assert.equal(row.contact,false);
    assert.ok(Math.abs(row.after.rollDeg)<.02&&Math.abs(row.after.pitchDeg)<.02);assert.ok(row.firstLevelTimeS<3);assert.equal(row.levelRecovery.status,'level');
    let yaw=row.after.headingDeg-row.before.headingDeg;while(yaw>180)yaw-=360;while(yaw< -180)yaw+=360;assert.ok(Math.abs(yaw)<.01,'Projected heading capture, not a hidden yaw reset');
  }
  const armed=rows.at(-1);assert.equal(baseline.armedSuctionLevel.after.stabilizationActive,false);assert.ok(Math.abs(baseline.armedSuctionLevel.after.rollDeg)>30);assert.equal(armed.after.stabilizationActive,true);assert.equal(armed.after.sealQuality,0);
  const ceiling=new RoadsterSim();ceiling.reset('ceiling');run(ceiling,.7);ceiling.setAirStabilization(true);const t=run(ceiling,1);
  assert.ok(t.sealQuality>.5);assert.equal(t.stabilizationActive,false);assert.equal(t.levelRecovery.status,'surface');assert.ok(Math.abs(t.rollDeg)>170);assert.ok(t.thrustN<.01);
  ceiling.setMode('hover');ceiling.setSuction(true);ceiling.setAirStabilization(true);const sealedHover=run(ceiling,.5);
  assert.ok(sealedHover.sealQuality>.5);assert.equal(sealedHover.levelRecovery.status,'surface');assert.ok(sealedHover.thrustN<.01,'A retained sealed surface must not fall through to the manual hover controller and fight G');
  const weak=flatFixture(RoadsterSim,{height:40,params:{liftNozzleMax:4000}});weak.setAirStabilization(true);const w=run(weak,.5);assert.equal(w.levelRecovery.status,'limited');assert.ok(w.verticalSpeed<0);
  evidence.levelRecovery={poseAndWrapCases:rows,armedSuctionRegression:{before:baseline.armedSuctionLevel,after:armed},realAdhesion:{sealQuality:t.sealQuality,rollDeg:t.rollDeg,jetThrustN:t.thrustN,status:t.levelRecovery.status},insufficientLiftStatus:w.levelRecovery.status,
    diagnosis:'Ordinary unsealed/off-F 3.8 numerical cases already levelled. The reproduced defect was suctionEnabled alone suppressing G at zero seal. A real sealed surface still suppresses aerial recovery. No body pose is assigned by G.'};
});

check('New wheel, release-braking and recovery states preserve complete snapshot replay across display rates with seeded sensing and nozzle derating',()=>{
  const sim=new RoadsterSim();sim.reset('hover');sim.body.position.y=35;
  sim.setObservation({enabled:true,delayMs:25,seed:3901,positionNoiseM:.002,velocityNoiseMps:.005,attitudeNoiseDeg:.01,angularRateNoiseRadS:.001});sim.setNozzleFault({id:'lift-FR',scale:.8});sim.setSuction(true);sim.setAirStabilization(true);
  run(sim,1,{lift:1});sim.step(dt,{});assert.equal(sim._verticalControl.braking,true);
  const snapshot=JSON.parse(JSON.stringify(sim.exportState())),states=[];
  for(const mutate of [s=>delete s.state._verticalControl,s=>s.state._verticalControl.braking='yes',s=>s.state._driveAccounting.shares=[1,1,1,1],s=>s.state._levelRecovery.status='made-up']){
    const bad=structuredClone(snapshot);mutate(bad);const before=sim.exportState();assert.throws(()=>sim.importState(bad));assert.deepEqual(sim.exportState(),before,'New continuation states are validated atomically');
  }
  for(const fps of [30,60,144,240]){
    const clone=new RoadsterSim(snapshot.params,{world:snapshot.worldType});clone.importState(snapshot);
    let count=0;for(let i=0;i<fps*2;i++)clone.step(1/fps,time=>({steer:time<1.5?.1:0}),null,()=>count++);
    assert.equal(count,240);const result=clone.exportState();delete result.state._accumulator;states.push(result);
  }
  states.slice(1).forEach(s=>assert.deepEqual(s,states[0]));
  evidence.repeatability={displayHz:[30,60,144,240],fixedPhysicalHz:120,comparedSteps:240,completeSnapshotEqual:true,seed:3901,measurementDelayMs:25,fault:{id:'lift-FR',scale:.8},initialReleaseBraking:true};
});

const authoritySim=new RoadsterSim(),p=authoritySim.params,authority=authoritySim.getControlAuthority(),ve=nozzleExhaustVelocity(p,p.initialPressureBar,p.gasTemperatureK);
const maximumTrimAngle=axis=>{let lo=0,hi=90;for(let i=0;i<40;i++){const mid=(lo+hi)/2,q=new Quaternion();q.setFromAxisAngle(axis,mid*Math.PI/180);const maxes=authoritySim._nozzles.map(n=>n.kind==='lift'?p.liftNozzleMax:n.kind==='roll'?p.sideNozzleMax:p.axialNozzleMax);if(authoritySim._holdTrimFeasible(maxes,q))lo=mid;else hi=mid;}return lo;};
authoritySim.setSupplyMode('finite');
evidence.thrustAuthority={...authority,gasInitialMassKg:authoritySim.gasInitialMass,dryMassKg:p.dryMass,gasTemperatureK:p.gasTemperatureK,exhaustVelocityMps:ve,hoverMassFlowKgS:authority.weightN/ve,allMainNozzlesFlowKgS:80000/ve,finiteHoverBudgetS:authoritySim.telemetry().hoverSecondsEstimate,staticPureRollLimitDeg:maximumTrimAngle(new Vec3(0,0,1)),staticPurePitchLimitDeg:maximumTrimAngle(new Vec3(1,0,0)),inertiaKgm2:{...authoritySim.body.inertia},ratedNozzles:authoritySim._nozzles.map(n=>({id:n.id,position:{...n.position},direction:{...n.direction},ratedForceN:n.kind==='lift'?p.liftNozzleMax:n.kind==='roll'?p.sideNozzleMax:p.axialNozzleMax})),classification:'All installed masses, inertias, nozzle layout and force ceilings are explicit engineering/playable-lab hypotheses. The gas law and nozzle thermodynamic relation are physics-based; no Tesla actuator calibration has been identified.'};

const paths=['dist/physics.js','dist/vehicle-models.js','dist/tire-dynamics.js','dist/simulation-snapshot.js','dist/control-observation.js'];
writeFileSync(new URL('../qa/physics-controls-3.9.json',import.meta.url),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),baselineCommit:PHYSICS_39_BASE,sourceSha256:Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),checks,evidence,limits:['Numerical physics and control validation only; no GPU-rendered driving feel, visuals or device FPS claim.','Rated thrust is deliberately unchanged. Finite gas, valve lag, asymmetric actuator failure, unilateral lift and coupled allocation remain physical limitations.','ABS is not ESC. The drive-power repair does not retune ABS to guarantee universal shorter stopping distances.']},null,2)+'\n');
