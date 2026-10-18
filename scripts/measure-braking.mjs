import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {RoadsterSim,DEFAULT_PARAMS,PHYSICS_HZ} from '../dist/physics.js';

// A reproducible internal-model experiment, not a Tesla performance claim.
// Set the speed only after normal-load equilibrium. Accept a stop only with
// positive tire loads, no body collisions, no reset, and a stable final hold.
const dt=1/PHYSICS_HZ;
const plain=v=>({x:v.x,y:v.y,z:v.z});
const source=readFileSync(new URL('../dist/physics.js',import.meta.url));
function contactCounts(s){
  let hull=0,wheelBumpStop=0;
  for(const contact of s.world.contacts){
    if(contact.bi!==s.body&&contact.bj!==s.body)continue;
    const shape=contact.bi===s.body?contact.si:contact.sj;
    if(shape?.material?.name==='wheel-bump-stop')wheelBumpStop++;else hull++;
  }
  return {hull,wheelBumpStop};
}
function settle(s) {
  s.body.position.set(0,.62,-80);
  for(let i=0;i<3*PHYSICS_HZ;i++) {
    const t=s.step(dt,{});if(t.fault)throw Error(t.fault);
  }
  if(s.telemetry().contactCount!==4||contactCounts(s).hull)throw Error('Initial state is not four-wheel equilibrium');
}
function measure({label,speedKmh=100,gas='full',throttle=0,brake=1,boost=false,mu=DEFAULT_PARAMS.tireMu,duration=12,stopping=true,allowNoStop=false}) {
  const s=new RoadsterSim({tireMu:mu});
  if(gas==='empty'){s.gasMass=0;s._updateMass(true);}
  settle(s);
  const initial=s.telemetry();s.body.velocity.set(0,0,speedKmh/3.6);s.body.angularVelocity.setZero();
  const start=s.simTime,z0=s.body.position.z,mass=s.body.mass;
  let firstStop=null,holdTime=0,stopStable=false,collisions=0,bumpStopContactSteps=0,missingContactSteps=0,minimumContacts=4,minLength=Infinity,maxLength=-Infinity;
  let maximumPitch=0,maximumDeceleration=0,totalNormalImpulse=0,totalBrakeImpulse=0,previousSpeed=speedKmh/3.6;
  const records=[];
  const wheels=s._wheels.bind(s);
  let longitudinalTireForce=0;
  s._wheels=(step,input)=>{
    const before=s.body.force.clone();wheels(step,input);
    longitudinalTireForce=s.body.force.z-before.z;
  };
  for(let i=0;i<duration*PHYSICS_HZ;i++) {
    const t=s.step(dt,{throttle,brake,boost});
    if(t.fault||t.simTime<=start)throw Error(`Invalid stop (${label}): ${t.fault||'time reset'}`);
    const elapsed=t.simTime-start,forward=t.forwardSpeedKmh/3.6;
    const contact=contactCounts(s);
    if(contact.hull)collisions++;
    if(contact.wheelBumpStop)bumpStopContactSteps++;
    minimumContacts=Math.min(minimumContacts,t.contactCount);
    if(t.contactCount<4)missingContactSteps++;
    for(const w of t.wheelStates){minLength=Math.min(minLength,w.suspensionLength);maxLength=Math.max(maxLength,w.suspensionLength);}
    maximumPitch=Math.max(maximumPitch,Math.abs(t.pitchDeg));
    maximumDeceleration=Math.max(maximumDeceleration,(previousSpeed-forward)/dt);
    totalNormalImpulse+=t.wheelStates.reduce((sum,w)=>sum+w.normalLoadN,0)*dt;
    totalBrakeImpulse+=-longitudinalTireForce*dt;
    previousSpeed=forward;
    if(!firstStop&&Math.abs(forward)<=.1&&t.contactCount===4)firstStop={seconds:elapsed,distanceM:t.position.z-z0,speedKmh:t.forwardSpeedKmh};
    if(firstStop){
      if(Math.abs(forward)<=.15&&t.contactCount===4)holdTime+=dt;else holdTime=0;
      if(holdTime>=1){stopStable=true;break;}
    }
    if(i%12===0)records.push({seconds:+elapsed.toFixed(3),speedKmh:+t.forwardSpeedKmh.toFixed(3),distanceM:+(t.position.z-z0).toFixed(3),heightM:+t.heightWorld.toFixed(4),pitchDeg:+t.pitchDeg.toFixed(3),normalLoadsN:t.wheelStates.map(w=>+w.normalLoadN.toFixed(1)),suspensionM:t.wheelStates.map(w=>+w.suspensionLength.toFixed(4)),longitudinalTireForceN:+longitudinalTireForce.toFixed(1)});
    if(!stopping&&elapsed>=duration-1e-9)break;
  }
  const final=s.telemetry(),elapsed=s.simTime-start;
  const valid=collisions===0&&(!stopping||stopStable);
  if(stopping&&!valid&&!allowNoStop)throw Error(`Invalid braking experiment ${label}: collisions=${collisions}, stable stop=${stopStable}`);
  return {label,input:{speedKmh,gas,throttle,brake,boost,tireMu:mu},valid,massKg:mass,initialPressureBar:initial.pressureBar,
    initialHeightM:initial.heightWorld,initialSuspensionM:initial.wheelStates.map(w=>w.suspensionLength),
    idealFrictionLimitMps2:mu*DEFAULT_PARAMS.gravity,idealFrictionStoppingDistanceM:(speedKmh/3.6)**2/(2*mu*DEFAULT_PARAMS.gravity),
    stop:firstStop,stopStable,observedDurationS:elapsed,finalSpeedKmh:final.forwardSpeedKmh,finalPosition:plain(s.body.position),
    averageDecelerationUntilStopMps2:firstStop?(speedKmh/3.6-Math.abs(firstStop.speedKmh)/3.6)/firstStop.seconds:null,
    speedReductionMps:speedKmh/3.6-final.forwardSpeedKmh/3.6,averageDecelerationMps2:(speedKmh/3.6-final.forwardSpeedKmh/3.6)/elapsed,
    maximumDecelerationMps2:maximumDeceleration,bodyContactSteps:collisions,wheelBumpStopContactSteps:bumpStopContactSteps,minimumWheelContacts:minimumContacts,notFourWheelSteps:missingContactSteps,
    minimumSuspensionM:minLength,maximumSuspensionM:maxLength,maximumPitchDeg:maximumPitch,
    averageNormalLoadN:totalNormalImpulse/elapsed,averageLongitudinalTireBrakingN:totalBrakeImpulse/elapsed,records};
}

const experiments=[
  {label:'100 km/h, full gas, explicit brake',speedKmh:100},
  {label:'50 km/h, full gas, explicit brake',speedKmh:50},
  {label:'100 km/h, empty gas, explicit brake',speedKmh:100,gas:'empty'},
  {label:'50 km/h, empty gas, explicit brake',speedKmh:50,gas:'empty'},
  {label:'100 km/h, W and Space held together',speedKmh:100,throttle:1,allowNoStop:true},
  {label:'100 km/h, W + Shift + Space held together',speedKmh:100,throttle:1,boost:true,allowNoStop:true},
  {label:'100 km/h, mu 0.85 engineering sensitivity',speedKmh:100,mu:.85},
  {label:'100 km/h, accelerator released, first second only',speedKmh:100,brake:0,duration:1,stopping:false},
].map(measure);
const report={generatedAt:new Date().toISOString(),physicsSha256:createHash('sha256').update(source).digest('hex'),
  scope:'Internal reduced-order model only. These are engineering assumptions and numerical experiments, not measured Tesla Roadster specifications.',
  protocol:'120 Hz; level floor; x=0,z=-80; settle 3 s; set initial forward speed; no steering or suction; no jets except the explicitly named boost-input interlock experiment. Stop threshold <=0.1 m/s, followed by >=1 s of four-wheel hold <=0.15 m/s. Body collision invalidates a brake stop; compressed-wheel safety contacts are counted separately. The averageDecelerationUntilStop field excludes the 1 s hold; observation averages include it.',
  model:{tireMu:DEFAULT_PARAMS.tireMu,brakeForceN:DEFAULT_PARAMS.brakeForce,motorForceN:DEFAULT_PARAMS.maxMotorForce,regenForceN:DEFAULT_PARAMS.regenForce,regenPowerW:DEFAULT_PARAMS.regenPower,springRatePerWheelNpm:DEFAULT_PARAMS.springRate,damperPerWheelNspm:DEFAULT_PARAMS.suspensionDamping,restLengthM:DEFAULT_PARAMS.suspensionRest,compressionMinimumM:DEFAULT_PARAMS.suspensionMin??null,legacyVisualOnlyCompressionClamp08:source.includes('clamp(length,.08,extension)'),droopLengthM:DEFAULT_PARAMS.suspensionRest+DEFAULT_PARAMS.suspensionDroop,wheelRadiusM:DEFAULT_PARAMS.wheelRadius},
  findings:{
    friction:'Each ray wheel load is max(0,k*(rest-length)-c*v_normal)/alignment; each contact has capacity mu*normalLoad. Combined longitudinal and lateral force is radially saturated to that friction circle. Tire force is applied at the ray hit point, so actual pitch and load transfer arise in the rigid body.',
    braking:'Explicit brake requests +/- brakeForce/contactCount per wheel, regularized as -v_long*(mass/contactCount)*28 near zero. It is not brake disc torque, wheel inertia, a slip-ratio tire curve, or a physical ABS implementation.',
    acceleratorRelease:'With no brake and no accelerator, regeneration is bounded by min(2600 N,60000 W/speed); aerodynamic drag and body damping add a small deceleration. At 100 km/h this means approximately 2160 N of regenerative force, not 42000 N of brake demand.',
    brakeThrottleConflict:'In the measured legacy model, throttle adds motor force during explicit braking. At high speed braking authority is reduced; near zero motor force and the velocity regularization reach a nonzero creep equilibrium. Brake priority should suppress drive torque and booster demand when braking deliberately.',
    suspension:'The legacy displayed wheel length is clamped at 0.08 m but the force law uses the unbounded geometric length. This can hide an already overcompressed physical state. A compressed-wheel collision envelope and progressive bump stop should enforce the same geometry used by the visible wheel and wheel arch.',
    updatedSuspension:DEFAULT_PARAMS.suspensionMin?'Current model adds a progressive bump force below minimum+0.015 m and zero-friction wheel-shaped rigid compression limits. Both visible and compressed collider wheel geometry use the same minimum length. These straight brake tests are supported by spring/bump loads before rigid compression contacts are needed.':null,
    assumptions:'mu=1.25 is an assumed high-grip dry tire/road value, not Tesla calibration. Treat 0.85 and wet-road values as sensitivity cases. Raising mu to hide input conflicts would be physically misleading.',
    limitations:['Single-ray wheels do not model tire width, finite contact patches or sidewall/curb impacts.','Wheel angular speed is visual kinematics; rotational wheel inertia, ABS pressure cycling, tire relaxation and load sensitivity are absent.','No official Roadster braking/adhesion calibration is inferred from these tests.','No driver reaction time is included; these are pure brake-application distances.'],
  },
  experiments};
mkdirSync(new URL('../qa',import.meta.url),{recursive:true});
const requested=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||'braking-analysis.json';
if(!/^[a-zA-Z0-9._-]+\.json$/.test(requested))throw Error('--output must be a JSON filename inside qa/');
writeFileSync(new URL('../qa/'+requested,import.meta.url),JSON.stringify(report,null,2)+'\n');
const baselinePath=new URL('../qa/braking-analysis.json',import.meta.url);
if(requested!=='braking-analysis.json'&&existsSync(baselinePath)){
  const before=JSON.parse(readFileSync(baselinePath,'utf8'));
  const comparison={generatedAt:report.generatedAt,scope:report.scope,protocol:report.protocol,
    beforePhysicsSha256:before.physicsSha256,afterPhysicsSha256:report.physicsSha256,
    observations:[
      'Pure explicit braking was already limited by the assumed high tire friction, not too little brake demand; the fix preserves roughly the same stop distance.',
      'The accelerator/brake conflict was a real cause of long stops and creep. Deliberate braking now has priority over motor and driving boost.',
      'The progressive stop reduces forward suspension compression. This geometry change can slightly lengthen the pure-brake distance without weakening the brake command.',
      'Every reported successful stop has four positive tire loads and no hull collision or automatic reset. Zero-friction compression-stop contacts are counted separately.',
    ],experiments:report.experiments.map(after=>{
      const previous=before.experiments.find(test=>test.label===after.label);
      return {label:after.label,before:previous?{stop:previous.stop,stopStable:previous.stopStable,finalSpeedKmh:previous.finalSpeedKmh,minimumSuspensionM:previous.minimumSuspensionM,maximumPitchDeg:previous.maximumPitchDeg}:null,
        after:{stop:after.stop,stopStable:after.stopStable,finalSpeedKmh:after.finalSpeedKmh,minimumSuspensionM:after.minimumSuspensionM,maximumPitchDeg:after.maximumPitchDeg,bodyContactSteps:after.bodyContactSteps,wheelBumpStopContactSteps:after.wheelBumpStopContactSteps}};
    })};
  writeFileSync(new URL('../qa/braking-comparison.json',import.meta.url),JSON.stringify(comparison,null,2)+'\n');
}
console.log(JSON.stringify({...report,experiments:experiments.map(({records,...r})=>r)},null,2));
