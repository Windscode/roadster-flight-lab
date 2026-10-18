import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {RoadsterSim,DEFAULT_PARAMS,PHYSICS_HZ} from '../dist/physics.js';
import {Vec3} from '../dist/vendor/cannon-es.js';
import {normalizeResearchRequest} from '../dist/research-protocol.js';
const dt=1/PHYSICS_HZ,checks=[],values={};
const pass=name=>{checks.push(name);console.log('PASS: '+name);};
const vector=v=>({x:v.x,y:v.y,z:v.z});
const quaternion=q=>({x:q.x,y:q.y,z:q.z,w:q.w});
const close=(a,b,tol,name)=>assert.ok(Math.abs(a-b)<=tol,`${name}: ${a} vs ${b} (± ${tol})`);
function airborne({pitch=0,roll=0,yaw=.5,params={},velocity=[1.5,-.5,-1],omega=[.1,-.04,.15]}={}){
 const s=new RoadsterSim(params);
 for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);
 s.reset('free');s.body.position.set(0,60,-350);
 s.body.previousPosition.copy(s.body.position);s.body.interpolatedPosition.copy(s.body.position);
 s.body.quaternion.setFromEuler(pitch*Math.PI/180,yaw,roll*Math.PI/180,'YXZ');
 s.body.previousQuaternion.copy(s.body.quaternion);s.body.interpolatedQuaternion.copy(s.body.quaternion);
 s.body.velocity.set(...velocity);s.body.angularVelocity.set(...omega);s.body.aabbNeedsUpdate=true;
 return s;
}
function run(s,seconds,input={},observe){
 const start=s.simTime;
 for(let k=0;k<Math.round(seconds*PHYSICS_HZ);k++){
  const t=s.step(dt,input);assert.equal(t.fault,null,'no hidden recovery/reset may satisfy the test');
  close(t.simTime,start+(k+1)*dt,1e-8,'continuous elapsed time');observe?.(t,k);
 }
 return s.telemetry();
}
{
 assert.equal(DEFAULT_PARAMS.supplyMode,'bench');const s=airborne({velocity:[0,0,0],omega:[0,0,0]});
 assert.equal(normalizeResearchRequest({kind:'hover'}).params.supplyMode,'finite');
 assert.equal(normalizeResearchRequest({kind:'hover',params:{supplyMode:'bench'}}).params.supplyMode,'bench');
 assert.equal(s.stabilizationMode,'off');s.setAirStabilization(true);assert.equal(s.stabilizationMode,'level');
 s.setStabilizationMode('hold');assert.equal(s.airStabilization,true);s.setAirStabilization(false);assert.equal(s.stabilizationMode,'off');
 assert.equal(s.setStabilizationMode('freeze'),false);assert.equal(s.stabilizationMode,'off');
 s.setStabilizationMode('hold');const mass=s.gasMass;let through=0;run(s,2,{},t=>through+=t.massFlowKgS*dt);
 assert.ok(through>60);assert.equal(s.gasMass,mass);assert.equal(s.pressureBar(),s.params.initialPressureBar);
 values.externalSupply={throughputKg:through,vehicleGasMassChangeKg:mass-s.gasMass};
}
pass('The city defaults to continuous external supply; finite research defaults and the boolean stabilization API remain explicit and compatible');
{
 const s=airborne({pitch:10,roll:20}),position=vector(s.body.position),orientation=quaternion(s.body.quaternion),velocity=vector(s.body.velocity),omega=vector(s.body.angularVelocity);
 s.setStabilizationMode('hold');const before=s.telemetry();
 assert.deepEqual(before.holdPositionTarget,position);assert.deepEqual(before.holdQuaternionTarget,orientation);
 assert.deepEqual(vector(s.body.velocity),velocity);assert.deepEqual(vector(s.body.angularVelocity),omega);
 const t=s.step(dt);assert.ok(t.holdPositionError>.005);assert.ok(t.holdSpeed>1,'physical braking must take time');
 assert.deepEqual(t.holdPositionTarget,position);assert.deepEqual(t.holdQuaternionTarget,orientation);
 assert.ok(t.nozzles.some(n=>n.command>n.force*2),'capture may not bypass valve rise time');
 const q=s._holdQuaternionTarget.clone();s.setStabilizationMode('hold');assert.deepEqual(s.telemetry().holdQuaternionTarget,quaternion(s.body.quaternion));assert.notDeepEqual(quaternion(q),quaternion(s.body.quaternion));
}
pass('Hold captures the exact world position and quaternion once, preserves initial velocities and brakes through finite-response physical valves');
{
 const s=airborne({pitch:12,roll:-22,velocity:[0,0,0],omega:[0,0,0]}),b=s.body,q=b.quaternion.clone(),m=b.mass;
 s.setStabilizationMode('hold');const t=s.step(dt),f=new Vec3(...t.achievedWrench.slice(0,3)),tau=new Vec3(...t.achievedWrench.slice(3));
 const expected=q.vmult(f).scale(1/m).vadd(s.world.gravity).scale(dt);
 assert.ok(b.velocity.vsub(expected).length()<1e-10,'all translation must equal delivered nozzle forces plus gravity');
 const local=b.quaternion.conjugate().vmult(b.angularVelocity),momentum=b.quaternion.vmult(new Vec3(local.x*b.inertia.x,local.y*b.inertia.y,local.z*b.inertia.z));
 assert.ok(momentum.vsub(q.vmult(tau).scale(dt)).length()<1e-8,'angular momentum must equal the real nozzle torque impulse');
 values.firstStep={velocityErrorMps:b.velocity.vsub(expected).length(),momentumErrorNms:momentum.vsub(q.vmult(tau).scale(dt)).length()};
}
pass('Newton and angular-momentum balances reconstruct the held vehicle response solely from delivered nozzle force, r × F torque and gravity');
{
 values.tracking=[];
 for(const [pitch,roll,yaw] of [[0,0,.5],[10,20,.9],[-12,-22,-.7]]){
  const s=airborne({pitch,roll,yaw});s.setStabilizationMode('hold');const reference=s.telemetry().holdQuaternionTarget;let peakPositionError=0;
  const t=run(s,8,{},frame=>{assert.equal(frame.contactCount,0);assert.equal(frame.holdFeasible,true);peakPositionError=Math.max(peakPositionError,frame.holdPositionError);assert.ok(frame.nozzles.every(n=>n.force>=0&&n.force<=n.maxForce+1e-8));});
  assert.equal(t.holdStatus,'holding');assert.ok(t.holdPositionError<.004);assert.ok(t.holdAttitudeErrorDeg<.005);assert.ok(t.holdSpeed<.003);assert.ok(peakPositionError>.2,'a moving vehicle must exhibit a finite braking excursion');
  assert.deepEqual(t.holdQuaternionTarget,reference);
  if(roll!==0)assert.ok(Math.abs(t.rollDeg)>15,'the captured tilted pose must not be auto-levelled');
  // An external impulse disturbs the already settled state; this is a test
  // disturbance, never part of the controller implementation.
  s.body.applyImpulse(new Vec3(950,-250,600),new Vec3(.35,.1,-.4));
  const disturbed=s.telemetry().holdSpeed;const recovered=run(s,7);
  assert.ok(disturbed>.3);assert.ok(recovered.holdPositionError<.004&&recovered.holdAttitudeErrorDeg<.005&&recovered.holdSpeed<.003);
  values.tracking.push({pitchDeg:pitch,rollDeg:roll,yawRad:yaw,peakPositionErrorM:peakPositionError,positionErrorM:t.holdPositionError,attitudeErrorDeg:t.holdAttitudeErrorDeg,speedMps:t.holdSpeed,impulseRecoveryPositionErrorM:recovered.holdPositionError});
 }
}
pass('Supported combined pitch/roll attitudes converge to their captured pose and position, reject an external impulse, and retain finite braking overshoot');
{
 values.unsupported=[];
 for(const roll of [70,180]){
  const s=airborne({roll,velocity:[0,0,0],omega:[0,0,0]});s.setStabilizationMode('hold');const reference=s.telemetry().holdQuaternionTarget;
  const t=run(s,1,{},frame=>assert.ok(frame.nozzles.every(n=>n.command>=0&&n.command<=n.maxForce+1e-8)));
  assert.equal(t.holdFeasible,false);assert.equal(t.holdStatus,'limited');assert.ok(t.holdPositionError>.8);assert.ok(t.verticalSpeed<-1);
  assert.deepEqual(t.holdQuaternionTarget,reference);
  if(roll===180){assert.equal(t.thrustN,0);close(t.verticalSpeed,-9.81,.1,'inverted unsupported fall');}
  values.unsupported.push({rollDeg:roll,positionErrorM:t.holdPositionError,verticalSpeedMps:t.verticalSpeed,wrenchResidual:t.holdWrenchResidual});
 }
 for(const params of [{batteryKWh:0},{supplyMode:'finite'},{liftNozzleMax:2000,sideNozzleMax:400,axialNozzleMax:1000}]){
  const s=airborne({params,velocity:[0,0,0],omega:[0,0,0]});if(params.supplyMode==='finite')s.gasMass=0;
  s.setStabilizationMode('hold');const t=run(s,1);
  assert.equal(t.holdFeasible,false);assert.ok(t.holdPositionError>2);assert.ok(t.verticalSpeed<-5);
  assert.ok(t.nozzles.every(n=>n.force<=n.maxForce+1e-8));if(!params.liftNozzleMax)assert.equal(t.thrustN,0);
 }
}
pass('Unsupported attitudes, absent power, empty gas and undersized nozzles cannot freeze or support the vehicle; feasibility and residual expose the limitation');
{
 const s=airborne({params:{supplyMode:'finite'},velocity:[0,0,0],omega:[0,0,0]});s.setStabilizationMode('hold');const gas=s.gasMass;let consumed=0,lost=null;
 const t=run(s,8,{},frame=>{consumed+=frame.massFlowKgS*dt;if(!frame.holdFeasible)lost??={time:frame.simTime,pressureBar:frame.pressureBar};});
 close(gas-s.gasMass,consumed,1e-8,'finite hold mass conservation');assert.ok(lost&&lost.time>2&&lost.time<8);
 assert.ok(t.holdPositionError>2&&t.verticalSpeed<-1);assert.equal(t.holdFeasible,false);assert.equal(t.contactCount,0);
 values.depletion={supportLost:lost,consumedKg:consumed,massBalanceErrorKg:gas-s.gasMass-consumed,finalPositionErrorM:t.holdPositionError,finalVerticalSpeedMps:t.verticalSpeed};
}
pass('Finite-tank hold loses support as pressure and temperature fall and conserves every kilogram of delivered nozzle mass flow without hidden replenishment');
{
 for(const input of [{throttle:.5},{steer:.5},{lift:.5},{roll:.5},{brake:1},{boost:true},{frontJets:1},{rearJets:1}]){
  const s=airborne({pitch:8,roll:12,velocity:[0,0,0],omega:[0,0,0]});s.setStabilizationMode('hold');run(s,.2);const t=s.step(dt,input);
  assert.equal(t.stabilizationMode,'level');assert.equal(t.holdActive,false);assert.equal(t.holdPositionTarget,null);assert.equal(t.holdQuaternionTarget,null);
  if(input.frontJets||input.rearJets){assert.equal(t.stabilizationActive,false);for(let i=0;i<4;i++)close(t.nozzles[i].command,(i<2?input.frontJets:input.rearJets)?20000:0,1e-8,'manual pair precedence');s.step(dt);assert.equal(s.telemetry().stabilizationActive,true);}
 }
 const s=airborne();s.setStabilizationMode('hold');s.setMode('manual');assert.equal(s.stabilizationMode,'level');s.setStabilizationMode('hold');s.setSuction(true);assert.equal(s.stabilizationMode,'level');
 s.setStabilizationMode('hold');s.reset();assert.equal(s.stabilizationMode,'level');assert.equal(s.telemetry().holdPositionTarget,null);
 const h=airborne();h.setMode('hover');h.setStabilizationMode('hold');h.body.applyImpulse(new Vec3(800,0,0));run(h,.5);const position=vector(h.body.position),velocity=vector(h.body.velocity);h.setStabilizationMode('off');assert.deepEqual(vector(h._positionTarget),position);assert.equal(h._heightTarget,position.y);assert.deepEqual(vector(h.body.velocity),velocity);
}
pass('Deliberate pilot inputs release fixed hold to level assistance, manual 1/2 valves retain priority, and explicit mode/suction/reset commands release stale references');
{
 const s=new RoadsterSim();run(s,2);s.setStabilizationMode('hold');const target=s.telemetry().holdPositionTarget;const t=run(s,2);
 assert.equal(t.holdActive,false);assert.equal(t.holdStatus,'surface');assert.equal(t.thrustN,0);assert.deepEqual(t.holdPositionTarget,target);
 s.reset('ceiling');s.setStabilizationMode('hold');const ceiling=run(s,1);assert.equal(ceiling.holdActive,false);assert.ok(ceiling.suctionN>10000);assert.equal(ceiling.thrustN,0);
 const hull=airborne({roll:180,velocity:[0,0,0],omega:[0,0,0]});hull.body.position.y=.635;hull.setStabilizationMode('hold');const h=run(hull,.5);
 assert.equal(h.contactCount,0);assert.ok(hull.world.contacts.some(c=>c.bi===hull.body||c.bj===hull.body));assert.equal(h.holdActive,false);assert.equal(h.holdStatus,'surface');assert.equal(h.thrustN,0);
}
pass('Tire contact, hull contact and ceiling adhesion inhibit hold thrust without repeatedly relatching the captured world reference');
{
 const response=(stepSeconds,internal=false)=>{
  const s=airborne({pitch:10,roll:20});s.setStabilizationMode('hold');
  for(let k=0;k<Math.round(2/stepSeconds);k++){if(internal)s._advance(stepSeconds,{});else s.step(stepSeconds);assert.equal(s.telemetry().fault,null);}
  return {position:s.body.position.clone(),q:s.body.quaternion.clone(),velocity:s.body.velocity.clone()};
 };
 const stateError=(a,b)=>a.position.vsub(b.position).length()+a.velocity.vsub(b.velocity).length()+2*Math.acos(Math.min(1,Math.abs(a.q.x*b.q.x+a.q.y*b.q.y+a.q.z*b.q.z+a.q.w*b.q.w)));
 const base=response(1/60),render30=response(1/30),render144=response(1/144);
 assert.ok(stateError(base,render30)<1e-7);assert.ok(stateError(base,render144)<1e-7);
 const reference=response(1/960,true),coarse=stateError(response(1/60,true),reference),medium=stateError(response(1/120,true),reference),fine=stateError(response(1/240,true),reference);
 assert.ok(medium<coarse*.8&&fine<medium*.8,`actual integrator convergence ${coarse}, ${medium}, ${fine}`);
 values.timestep={render30Vs60:stateError(base,render30),render144Vs60:stateError(base,render144),referenceHz:960,error60Hz:coarse,error120Hz:medium,error240Hz:fine,errorDefinition:'position norm + velocity norm + quaternion angle (mixed-unit convergence diagnostic)'};
}
pass('Hold is independent of 30/60/144 Hz render cadence and converges when the actual physical integration step is halved');
writeFileSync('qa/pose-hold-3.6.json',JSON.stringify({status:'passed',model:'Roadster engineering approximation',checks,values,limits:'Synthetic disturbance acceptance and exact static trim for the model nozzle layout; not an OEM controller identification or an arbitrary-attitude flight guarantee.'},null,2)+'\n');
