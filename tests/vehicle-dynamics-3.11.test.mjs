import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {RoadsterSim,DEFAULT_PARAMS} from '../dist/physics.js';
import {MODEL_VERSION,rollManeuverProfile,sampleRollManeuver,roadWheelAngle} from '../dist/vehicle-models.js';
import {lateralTireForce} from '../dist/tire-dynamics.js';
import {Vec3} from '../dist/vendor/cannon-es.js';
import {RoadsterSim as Before} from '../qa/fixtures/baseline-3.10/physics.js';
import {DT,DEG,flatDynamics,handlingRun,verticalRun,rotationRun,HANDLING_COLUMNS,FLIGHT_COLUMNS} from './dynamics-fixtures-3.11.mjs';

const checks=[],curves={handling:{columns:HANDLING_COLUMNS,runs:[]},flight:{columns:FLIGHT_COLUMNS,runs:[]}},evidence={};
const check=(name,run)=>{const result=run();checks.push({name,status:'PASS'});console.log('PASS: '+name);return result;};
const close=(a,b,tolerance,label)=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} vs ${b}, tolerance ${tolerance}`);
const summarize=r=>{const {rows,...summary}=r;return summary;};
const physical=s=>JSON.stringify([s.body.position,s.body.velocity,s.body.quaternion,s.body.angularVelocity]);
const hash=path=>createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex');

check('The reproduced 3 m/s lateral-force jump becomes a continuous contact law, including both blend boundaries',()=>{
  const condition={vlat:.1,normalLoadN:6000,mu:1.25,cornerStiffness:82000*(6000/5500)**.9,relaxedSlip:.03,effectiveMass:600};
  const beforeLow=-24*condition.effectiveMass*condition.vlat,beforeHigh=-7500*Math.tanh(condition.cornerStiffness*condition.relaxedSlip/7500);
  const low=lateralTireForce({...condition,vlong:2.999}),high=lateralTireForce({...condition,vlong:3.001});
  assert.ok(Math.abs(beforeLow-beforeHigh)>1100);assert.ok(Math.abs(low.forceN-high.forceN)<2);
  for(const speed of [1.5,4.5]){
    const a=lateralTireForce({...condition,vlong:speed-1e-6}).forceN,b=lateralTireForce({...condition,vlong:speed+1e-6}).forceN;
    assert.ok(Math.abs(a-b)<1e-6,'Smoothstep joins have zero branch derivative');
  }
  close(lateralTireForce({...condition,vlong:0,vlat:0,relaxedSlip:1}).forceN,0,0,'Zero creep velocity has no invented force on level ground');
  evidence.contactContinuity={condition,before:{at2_999N:beforeLow,at3_001N:beforeHigh,jumpN:Math.abs(beforeHigh-beforeLow)},after:{at2_999N:low.forceN,at3_001N:high.forceN,differenceN:Math.abs(high.forceN-low.forceN)},scope:'Local force-law state, not by itself an explanation of a high-speed slide.'};
});

check('Wheel rays, contact velocities and forces use a consistent world-space contact basis and the real moment arm',()=>{
  evidence.contactGeometry=[];
  for(const [version,Sim]of [['3.10',Before],[REPORT_VERSION,RoadsterSim]]){
    const sim=flatDynamics(Sim),b=sim.body,weightN=b.mass*sim.params.gravity,staticLoadN=sim.wheelStates.reduce((sum,w)=>sum+w.normalLoadN,0);
    close(staticLoadN,weightN,weightN*1e-4,'Settled flat-ground normal support');
    const staticData={massKg:b.mass,inertiaKgm2:{...b.inertia},heightM:b.position.y,weightN,normalSumN:staticLoadN,wheelLoadsN:sim.wheelStates.map(w=>w.normalLoadN)};
    // Declared tilted rolling state for the isolated contact call. A small body
    // roll/pitch makes projection onto the actual ground normal nontrivial.
    b.quaternion.setFromEuler(.012,.3,.016,'YXZ');b.velocity.set(.7,0,15);b.angularVelocity.set(0,.2,0);
    sim.wheelStates.forEach(w=>w.angularVelocityRadS=15/sim.params.wheelRadius);
    const startOmega=sim.wheelStates.map(w=>w.angularVelocityRadS),before=physical(sim),applications=[],apply=b.applyForce;
    b.force.setZero();b.torque.setZero();
    b.applyForce=function(force,relative){applications.push({force:force.clone(),relative:relative.clone()});return apply.call(this,force,relative);};
    try{sim._wheels(DT,{throttle:.05,steer:.2,brake:0});}finally{b.applyForce=apply;}
    assert.equal(physical(sim),before,'Contact evaluation accumulates forces, never rewrites body motion');
    assert.equal(sim._contactCount,4);assert.equal(applications.length,8);
    const sumForce=new Vec3(),sumMoment=new Vec3(),wheels=[];
    for(const application of applications){sumForce.vadd(application.force,sumForce);sumMoment.vadd(application.relative.cross(application.force),sumMoment);}
    for(const [i,w]of sim.wheelStates.entries()){
      const point=new Vec3(w.contactPointWorld.x,w.contactPointWorld.y,w.contactPointWorld.z),relative=point.vsub(b.position),normal=new Vec3(w.contactNormalWorld.x,w.contactNormalWorld.y,w.contactNormalWorld.z);
      const forward=b.quaternion.vmult(new Vec3(Math.sin(w.steer),0,Math.cos(w.steer)));forward.vsub(normal.scale(forward.dot(normal)),forward);forward.normalize();
      const right=normal.cross(forward);right.normalize();const velocity=b.angularVelocity.cross(relative).vadd(b.velocity),longitudinal=velocity.dot(forward),lateral=velocity.dot(right);
      close(normal.length(),1,1e-12,'Unit contact normal');close(forward.dot(normal),0,1e-12,'Longitudinal force tangent');close(right.dot(normal),0,1e-12,'Lateral force tangent');close(right.dot(forward),0,1e-12,'Orthogonal tire basis');
      close(point.y,0,1e-10,'Ray hits the actual floor');close(w.slipAngle,Math.atan2(lateral,Math.abs(longitudinal)+.6),1e-12,'Measured contact velocity controls slip angle');
      if(version===REPORT_VERSION){close(w.lateralSpeedMps,lateral,1e-12,'Exposed lateral contact velocity');close(w.longitudinalSpeedMps,longitudinal,1e-12,'Exposed longitudinal contact velocity');}
      close(applications[i].relative.distanceTo(relative),0,1e-12,'Spring contact moment arm');close(applications[4+i].relative.distanceTo(relative),0,1e-12,'Tire contact moment arm');
      close(applications[i].force.distanceTo(normal.scale(w.normalLoadN)),0,1e-8,'Reported normal load is the applied normal force');
      close(applications[4+i].force.distanceTo(forward.scale(w.longitudinalForceN).vadd(right.scale(w.lateralForceN))),0,1e-8,'Reported tire forces are the applied tangent force');
      const relativeSpinChange=sim.params.wheelInertia*(w.angularVelocityRadS-startOmega[i]);
      sumMoment.vsub(b.quaternion.vmult(new Vec3(Math.cos(w.steer),0,-Math.sin(w.steer))).scale(relativeSpinChange/DT),sumMoment);
      wheels.push({id:w.id,point:{...point},normal:{...normal},contactVelocity:{...velocity},longitudinalMps:longitudinal,lateralMps:lateral,loadN:w.normalLoadN,slipDeg:w.slipAngle*DEG});
    }
    close(sumForce.distanceTo(b.force),0,1e-8,'All accumulated contact force is accounted for');close(sumMoment.distanceTo(b.torque),0,1e-7,'Contact moments and wheel spin reaction account for accumulated torque');
    evidence.contactGeometry.push({version,static:staticData,tiltedProbe:{rollRad:.016,pitchRad:.012,yawRad:.3,wheels,appliedForce:{...b.force},appliedTorque:{...b.torque}},scope:'An isolated numerical contact call, not a suspension calibration or a rendered inspection.'});
  }
});

// Isolate each source change against the frozen 3.10 force law. These modules
// live in a temporary directory; the shipped application is never patched by
// the tests and no user record or historical report is modified.
const baselineUrl=new URL('../qa/fixtures/baseline-3.10/physics.js',import.meta.url),baselineText=readFileSync(baselineUrl,'utf8').replace(/from '([^']+)'/g,(_,p)=>`from '${new URL(p,baselineUrl).href}'`),temporary=mkdtempSync(join(tmpdir(),'roadster-311-ablation-'));
const actualPhysics=readFileSync(new URL('../dist/physics.js',import.meta.url),'utf8');
const reserveBlock=actualPhysics.slice(actualPhysics.indexOf('    const pilotDriveForce=driveForce;'),actualPhysics.indexOf('    const contactByWheel=new Map'));
const modifications={
  lowSpeed:s=>s.replace('if(Math.abs(c.vlong)<3)lateral=-c.vlat*effectiveMass*24;','const u=clamp((Math.abs(c.vlong)-1.5)/3,0,1),creep=-c.vlat*effectiveMass*24;lateral=creep+(lateral-creep)*u*u*(3-2*u);'),
  roadGrip:s=>s.replace('roadWheelAngle(input.steer,Math.abs(b.velocity.dot(b.quaternion.vmult(Z))),p)','roadWheelAngle(input.steer,Math.abs(b.velocity.dot(b.quaternion.vmult(Z))),{...p,tireMu:this._surfaceMu(b.position)})'),
  planarSpeed:s=>s.replace('roadWheelAngle(input.steer,Math.abs(b.velocity.dot(b.quaternion.vmult(Z))),p)','roadWheelAngle(input.steer,Math.sqrt(Math.max(0,b.velocity.lengthSquared()-b.velocity.dot(up)**2)),p)'),
  regenLoad:s=>s.replace('p.regenPower/Math.max(speed,1))/4:0','p.regenPower/Math.max(speed,1))*w.normalLoadN/totalLoad:0'),
  combinedTcs:s=>s.replace('    const contactByWheel=new Map','    const planarSpeed=Math.sqrt(Math.max(0,b.velocity.lengthSquared()-b.velocity.dot(up)**2)),steeringMu=this._surfaceMu(b.position);\n'+reserveBlock+'    const contactByWheel=new Map'),
};
try{
  evidence.ablation=[];
  const configurations=[{speedKmh:90,steer:1,power:'coast',surface:'dry'},{speedKmh:90,steer:1,power:'frozen',surface:'wet'},{speedKmh:54,steer:1,power:'full',surface:'dry'},{speedKmh:10,steer:.2,power:'hold',surface:'dry'}];
  for(const [name,change]of Object.entries(modifications)){
    const path=join(temporary,name+'.mjs'),source=change(baselineText);assert.notEqual(source,baselineText,'Ablation must really alter its one mechanism');writeFileSync(path,source);
    const {RoadsterSim:Variant}=await import(pathToFileURL(path));
    for(const configuration of configurations){const result=handlingRun(Variant,configuration);evidence.ablation.push({change:name,...summarize(result)});}
  }
}finally{rmSync(temporary,{recursive:true,force:true});}

check('Contact forces, regeneration and combined-drive budget are measured on low-speed turns, light inputs, circles, taps and lane changes',()=>{
  const configurations=[];
  for(const speedKmh of [10,18,54,90])for(const steer of [.2,1])configurations.push({speedKmh,steer,power:'hold'});
  for(const speedKmh of [54,90])for(const surface of ['dry','wet'])for(const power of ['coast','frozen','full'])configurations.push({speedKmh,steer:1,surface,power});
  for(const speedKmh of [10,54,90])for(const kind of ['tap','lane'])configurations.push({speedKmh,steer:kind==='lane'?.35:1,kind,power:'frozen'});
  for(const surface of ['dry','wet'])configurations.push({speedKmh:54,steer:.2,power:'full',surface},{speedKmh:90,steer:.2,power:'brake',surface});
  evidence.handling=configurations.map(configuration=>{
    const before=handlingRun(Before,configuration),after=handlingRun(RoadsterSim,configuration),m=after.metrics;
    assert.equal(m.minContacts,4);assert.equal(m.bodyContactSteps,0);assert.ok(m.peakGrip<=1+1e-9);assert.ok(m.peakMotorPowerW<=700000+1e-7);assert.ok(m.peakMotorTorqueBudgetExcessNm<1e-7);
    assert.ok(Math.abs(m.startSpeedKmh-configuration.speedKmh)<.5,'Measured turn starts close to its stated speed');
    // CG velocity on a tight rolling circle is not parallel to the body axis:
    // braking to 12 km/h gives about 2.84 deg CG beta with <.2 deg tire slip.
    // Preserve that complete curve, but evaluate high-speed drift in its actual
    // speed band rather than labelling the low-speed kinematic angle a skid.
    if(configuration.steer===.2&&configuration.speedKmh>=54){assert.ok(m.peakBodySlipAbove30KmhDeg<2,'Gentle steering above 30 km/h must not produce a gross drift');assert.ok(m.peakTireSlipDeg<3,'Light-steer tires remain in a small-slip regime throughout braking');}
    curves.handling.runs.push({id:'before-'+curves.handling.runs.length,...before},{id:'after-'+(curves.handling.runs.length+1),...after});
    return {configuration:after.configuration,before:before.metrics,after:m};
  });
  const coast=evidence.handling.find(r=>r.configuration.speedKmh===90&&r.configuration.power==='coast'&&r.configuration.surface==='dry');
  const wet=evidence.handling.find(r=>r.configuration.speedKmh===90&&r.configuration.power==='frozen'&&r.configuration.surface==='wet');
  const drive=evidence.handling.find(r=>r.configuration.speedKmh===54&&r.configuration.power==='full'&&r.configuration.surface==='dry'&&r.configuration.steer===1);
  assert.ok(coast.after.peakBodySlipDeg<coast.before.peakBodySlipDeg*.4,'Load-aware regen repairs the reproduced lift-off slide');
  assert.ok(wet.after.peakBodySlipDeg<wet.before.peakBodySlipDeg*.4,'Actual wet friction must inform the assisted command envelope');
  assert.ok(drive.after.peakBodySlipDeg<drive.before.peakBodySlipDeg*.4,'Combined TCS must preserve steering authority under full drive');
  evidence.primaryHandlingComparisons={coast,wet,drive};
  const unassisted=handlingRun(RoadsterSim,{speedKmh:54,steer:1,power:'full',params:{tractionAssist:false}});
  assert.ok(unassisted.metrics.peakLongitudinalSlip>.5&&unassisted.metrics.gripSaturationS>3,'Turning off torque assistance retains real wheelspin and combined-contact saturation');
  assert.equal(unassisted.metrics.minimumCorneringDriveScale,1);assert.equal(unassisted.metrics.corneringTractionActiveS,0);
  assert.ok(drive.after.minimumCorneringDriveScale<.5&&drive.after.corneringTractionActiveS>1,'The delivered drive reduction must be visible in telemetry');
  evidence.tcsDisabled=summarize(unassisted);
});

check('8 m/s E/Q commands and release braking become faster in both G modes without increasing available force',()=>{
  evidence.vertical=[];
  for(const level of [false,true]){
    const before=verticalRun(Before,{level}),after=verticalRun(RoadsterSim,{level});
    assert.ok(after.metrics.timeTo95S<before.metrics.timeTo95S*.7);assert.ok(after.metrics.extraClimbM<before.metrics.extraClimbM*.7);assert.ok(Math.abs(after.metrics.finalVelocityMps)<.01);
    assert.ok(after.metrics.peakAscentAccelerationMps2<=DEFAULT_PARAMS.verticalAccelerationMps2+.02);
    evidence.vertical.push({level,before:before.metrics,after:after.metrics});curves.flight.runs.push({id:'vertical-before-'+level,...before},{id:'vertical-after-'+level,...after});
    const landing=flatDynamics(RoadsterSim,{height:12,params:{climbRateMps:14}});landing.setAirStabilization(level);let contact=null;
    for(let k=0;k<12/DT;k++){const t=landing.advanceFixed({lift:-1},DT);if(t.contactCount>0&&contact===null)contact={timeS:(k+1)*DT,verticalMps:t.verticalSpeed};}
    assert.ok(contact&&Math.abs(contact.verticalMps)<.8);assert.equal(landing.mode,'drive');assert.ok(landing.telemetry().thrustN<.01);assert.equal(landing.telemetry().contactCount,4);
    evidence.vertical.at(-1).descentFrom12m={firstContact:contact,finalHeightM:landing.body.position.y,finalThrustN:landing.telemetry().thrustN};
  }
});

check('Manual full rotation, X and G recovery use bounded actual nozzles; the new default and maneuver preset have explicit different costs',()=>{
  evidence.flight=[];
  const variants=[{id:'3.10',Sim:Before,params:{}},{id:`${REPORT_VERSION}-default`,Sim:RoadsterSim,params:{}},{id:`${REPORT_VERSION}-maneuver`,Sim:RoadsterSim,params:{climbRateMps:14,verticalAccelerationMps2:6,rollRateDegS:240,pitchRateDegS:90,angularAccelerationDegS2:480}}];
  for(const {id,Sim,params}of variants){
    const options=[{automatic:true},{},{axis:'roll',gestureSeconds:.70},{axis:'pitch',gestureSeconds:.65}];
    if(Sim===RoadsterSim)options.push({prelaunch:true,params:{...params,climbRateMps:14}});
    for(const option of options){
      const r=rotationRun(Sim,{params,...option});assert.equal(r.accepted,true);assert.equal(r.metrics.firstContact,null);assert.ok(r.metrics.peakForceRatio<=1+1e-9);
      if(option.automatic||option.gestureSeconds===undefined){assert.ok(r.metrics.rotationDeg>=355&&r.metrics.rotationDeg<370);assert.ok(r.metrics.minimumUpDot<-.99);}
      if(!option.automatic){assert.ok(r.metrics.recoveredAtS!==null);assert.ok(Math.abs(r.metrics.finalRollDeg)<.8&&Math.abs(r.metrics.finalPitchDeg)<.8);}
      if(option.automatic&&Sim===RoadsterSim){
        assert.ok(r.plan.launchVelocity<=14);assert.ok(r.plan.launchAccelerationMps2<=simParam(params,'verticalAccelerationMps2'));
        for(let k=0;k<=200;k++){const s=sampleRollManeuver(r.plan.profile,r.plan.duration*k/200);assert.ok(Math.abs(s.rateRadS)*DEG<=simParam(params,'rollRateDegS')+1e-8);assert.ok(Math.abs(s.accelerationRadS2)*DEG<=simParam(params,'angularAccelerationDegS2')+1e-8);}
        assert.ok(r.metrics.maxHeightM<r.plan.plannedPeakHeight);assert.ok(Math.abs(r.metrics.finalHeightM-80)<.2);
      }
      evidence.flight.push({id,...summarize(r)});curves.flight.runs.push({id:id+'-'+(option.automatic?'X':option.prelaunch?'E14-roll-G':option.gestureSeconds?option.axis+'-release-G':'full-manual-roll-G'),...r});
    }
  }
  const before=evidence.flight.find(r=>r.id==='3.10'&&!r.configuration.automatic&&r.configuration.gestureSeconds===null),after=evidence.flight.find(r=>r.id===`${REPORT_VERSION}-default`&&!r.configuration.automatic&&!r.configuration.prelaunch&&r.configuration.gestureSeconds===null);
  assert.ok(after.metrics.release.timeS<before.metrics.release.timeS*.75);assert.ok(after.metrics.heightLossM<before.metrics.heightLossM*.55);
  evidence.defaultRationale='180 deg/s and 360 deg/s2 retain a less severe partial-roll/G recovery than the 240/480 maneuver preset. Both are references, not hard clips on actual body rates. X shares the selected reference limits and preflight accounts for its greater time, headroom and gas cost.';
});
function simParam(params,key){return params[key]??DEFAULT_PARAMS[key];}

check('Finite gas, overhead clearance, low altitude and G key semantics remain physical; mid-roll snapshots continue exactly',()=>{
  const finite=flatDynamics(RoadsterSim,{params:{supplyMode:'finite',tankLitres:900}}),before=physical(finite);
  assert.equal(finite.startManeuver('roll'),false);assert.equal(physical(finite),before);assert.match(finite.status,/冲量/);
  const agile=flatDynamics(RoadsterSim,{params:{supplyMode:'finite',tankLitres:900,rollRateDegS:360,angularAccelerationDegS2:720,verticalAccelerationMps2:10}});assert.equal(agile.startManeuver('roll'),true);let inversion=false;
  for(let k=0;k<15/DT;k++){const t=agile.advanceFixed({},DT);inversion||=Math.abs(t.rollDeg)>175;if(!t.maneuver&&t.mode==='drive'&&t.verticalSpeed<.1)break;}
  assert.ok(inversion);assert.equal(agile.mode,'drive');assert.ok(agile.gasMass>20);assert.ok(Math.abs(agile.body.velocity.y)<.8);
  const low=rotationRun(RoadsterSim,{height:5});assert.ok(low.metrics.firstContact,'A full manual roll without prelaunch cannot be guaranteed from 5 m');
  const roof=new RoadsterSim({}, {world:'windlab'});roof.body.position.y=14;roof.setMode('hover');const roofBefore=physical(roof);assert.equal(roof.startManeuver('roll'),false);assert.equal(physical(roof),roofBefore);assert.match(roof.status,/净空/);
  const level=flatDynamics(RoadsterSim,{height:40});level.setAirStabilization(true);let maxTilt=0;
  for(let k=0;k<120;k++){const t=level.advanceFixed({roll:1,pitch:1},DT);maxTilt=Math.max(maxTilt,Math.abs(t.rollDeg),Math.abs(t.pitchDeg));}
  assert.ok(maxTilt<5,'With G enabled Z/B are translation, not the off-G roll mapping');assert.ok(Math.abs(level.body.position.x)>1);
  const source=flatDynamics(RoadsterSim,{height:40});assert.equal(source.startManeuver('roll'),true);for(let k=0;k<4/DT;k++)source.advanceFixed({},DT);assert.equal(source._maneuver.phase,'rotate');
  const snapshot=source.exportState(),replay=flatDynamics(RoadsterSim,{height:40});replay.importState(snapshot);
  for(let k=0;k<240;k++){source.advanceFixed({},DT);replay.advanceFixed({},DT);}assert.deepEqual(replay.exportState(),source.exportState());
  const bad=structuredClone(snapshot);bad.params.verticalAccelerationMps2=0;assert.throws(()=>replay.importState(bad),/升降加速度/);
  evidence.bounds={finite900DefaultRejected:true,finite900AgileGasRemainingKg:agile.gasMass,finite900AgileHeightM:agile.body.position.y,low5mFirstContact:low.metrics.firstContact,overheadDeclinedWithoutMovement:true,GonPeakTiltDeg:maxTilt,GonLateralTranslationM:level.body.position.x,midRollReplay:'exact full snapshot',ratedPowerW:DEFAULT_PARAMS.motorPower,dryMu:DEFAULT_PARAMS.tireMu,mainNozzleN:DEFAULT_PARAMS.liftNozzleMax};
});

const sourceSha256=Object.fromEntries(['dist/physics.js','dist/tire-dynamics.js','dist/vehicle-models.js','dist/simulation-snapshot.js','dist/flight-programs.js'].map(path=>[path,hash(path)]));
writeFileSync(new URL(`../qa/vehicle-dynamics-curves-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({schema:'roadster.numerical-control-curves',version:1,modelVersion:MODEL_VERSION,sampleHz:20,solverHz:120,sourceSha256,scope:'Flat numerical fixtures; same stated initial conditions and pedal/steer protocols. No WebGL, device input, camera feel, FPS or Tesla calibration acceptance.',...curves})+'\n');
writeFileSync(new URL(`../qa/vehicle-dynamics-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({status:'passed',modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),baselineCommit:'6d2b897bc928ae0e44fa258a7184719cd660e48b',sourceSha256,checks,evidence,curveFile:`qa/vehicle-dynamics-curves-${REPORT_VERSION}.json`,limits:['Numerical dynamics only. Real keyboard/camera road feel still requires the matched live capture.','Large CG body beta on a tight low-speed turn can be kinematic; per-wheel slip and contact use are reported separately.','The raw tire capacity is unchanged. TCS reduces driver torque under combined demand; disabling it retains slide risk.','X shares reference limits, not a guarantee of zero height loss. Slower profiles need more headroom and gas.','Engineering assumptions remain mu=1.25, 700 kW mechanical drive and 20 kN per main nozzle.']},null,2)+'\n');
console.log(JSON.stringify({status:'passed',checks:checks.length,handlingCases:evidence.handling.length,flightCases:evidence.flight.length,primary:evidence.primaryHandlingComparisons}));
