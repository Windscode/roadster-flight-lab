import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {solveStaticWrench,TRIM_TOLERANCES} from '../dist/trim-feasibility.js';

const dt=1/120,checks=[],evidence={};
const check=(name,run)=>{run();checks.push({name,status:'passed'});console.log('PASS: '+name);};
const clone=o=>JSON.parse(JSON.stringify(o));
const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} vs ${b} exceeds ${t}`);
const hash=p=>createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex');
const flat=(options={})=>{const sim=new RoadsterSim(options);for(const b of [...sim.world.bodies])if(b!==sim.body&&b.userData?.id!=='ground')sim.world.removeBody(b);sim.geometry=sim.geometry.filter(g=>g.id==='ground');sim.reset('free');return sim;};
function independentlySumWrench(sim,forces){
  const wrench=Array(6).fill(0);
  // Deliberately do not read the allocator's .column or achievedWrench.
  sim._nozzles.forEach((n,i)=>{const p=n.position,d=n.direction,F={x:d.x*forces[i],y:d.y*forces[i],z:d.z*forces[i]};wrench[0]+=F.x;wrench[1]+=F.y;wrench[2]+=F.z;wrench[3]+=p.y*F.z-p.z*F.y;wrench[4]+=p.z*F.x-p.x*F.z;wrench[5]+=p.x*F.y-p.y*F.x;});return wrench;
}
function independentGravity(sim){const {x,y,z,w}=sim.body.quaternion,weight=sim.body.mass*sim.params.gravity;return[2*(x*y+w*z)*weight,(1-2*(x*x+z*z))*weight,2*(y*z-w*x)*weight,0,0,0];}
function legacy313(sim,maxes){const q=sim.body.quaternion,f=q.conjugate().vmult({x:0,y:sim.body.mass*sim.params.gravity,z:0}),difference=.22*f.x/.59;return sim._nozzles.map(n=>n.kind==='lift'?(f.y-Math.sign(n.position.x)*difference)/4:n.kind==='roll'?Math.max(0,f.x*n.direction.x)/2:Math.max(0,f.z*n.direction.z)).every((v,i)=>v>=-1e-7&&v<=maxes[i]+1e-7);}

check('Published equal-candidate false negative has an independent zero-wrench-residual counterexample',()=>{
  const sim=flat();sim.setNozzleFault({id:'lift-FL',scale:0});const after=sim.getHoldTrimAssessment(),maxes=after.nozzles.map(n=>n.maximumN),forces=after.nozzles.map(n=>n.forceN),weight=sim.body.mass*sim.params.gravity;
  assert.equal(legacy313(sim,maxes),false);assert.equal(after.staticFeasible,true);close(forces[0],weight/2);close(forces[3],weight/2);close(forces[1],0);close(forces[2],0);
  const actual=independentlySumWrench(sim,forces),wanted=independentGravity(sim);actual.forEach((v,k)=>close(v,wanted[k]));
  assert.equal(after.dynamicRecovery,'not-evaluated');assert.ok(after.reserve.bidirectionalTorqueNm.x<.001&&after.reserve.bidirectionalTorqueNm.z<.001,'Static support must not be sold as bidirectional transient torque authority');
  evidence.counterexample={baselineCommit:'1dde9a3df081297978d7cc98409be86bcc6daa23',baselineFunction:'3.13 _holdTrimFeasible copied only for this numerical before check',massKg:sim.body.mass,gravityMps2:sim.params.gravity,weightN:weight,oldEqualCandidate:false,newAssessment:after,independentWrench:actual};
});

check('All four lift faults, four health values, pressure and tilted poses receive independent wrench checks',()=>{
  const cases=[];
  for(const pressureBar of [350,30,20])for(const [pose,roll,pitch]of [['level',0,0],['roll15',15,0],['pitch20',0,20],['combined',20,15],['inverted',180,0]])for(const id of ['lift-FR','lift-FL','lift-RR','lift-RL'])for(const scale of [0,.25,.5,1]){
    const sim=flat({initialPressureBar:pressureBar});sim.body.quaternion.setFromEuler(pitch*Math.PI/180,0,roll*Math.PI/180,'YXZ');sim.setNozzleFault({id,scale});
    const a=sim.getHoldTrimAssessment({includeReserve:false}),forces=a.nozzles.map(n=>n.forceN),wrench=independentlySumWrench(sim,forces),desired=independentGravity(sim),residual=desired.map((v,k)=>v-wrench[k]);
    forces.forEach((v,i)=>assert.ok(v>=-1e-9&&v<=a.nozzles[i].maximumN+1e-9));residual.forEach((v,k)=>close(v,a.residualWrench[k],1e-7));
    if(a.staticFeasible){assert.ok(Math.hypot(...residual.slice(0,3))<=TRIM_TOLERANCES.forceN);assert.ok(Math.hypot(...residual.slice(3))<=TRIM_TOLERANCES.torqueNm);}
    if(pose==='inverted')assert.equal(a.staticFeasible,false,'Upward-only lift cannot sustain an inverted gravity trim');
    cases.push({pressureBar,pose,rollDeg:roll,pitchDeg:pitch,fault:{id,health:scale},massKg:sim.body.mass,desiredWrench:desired,staticFeasible:a.staticFeasible,forcesN:forces,maxForcesN:a.nozzles.map(n=>n.maximumN),independentWrench:wrench,independentResidual:residual,forceResidualN:Math.hypot(...residual.slice(0,3)),torqueResidualNm:Math.hypot(...residual.slice(3)),diagonalIntervalN:a.diagonalIntervalN});
  }
  assert.equal(cases.length,240);assert.ok(cases.some(c=>!c.staticFeasible&&c.pose==='level'&&c.pressureBar===20));
  evidence.trimMatrix={nozzleGeometry:flat()._nozzles.map(n=>({id:n.id,position:{...n.position},direction:{...n.direction}})),tolerances:TRIM_TOLERANCES,scope:'static, zero velocity/angular velocity and no wind; all failed cases retained, no assertion of dynamic recovery',cases};
});

check('Safety-domain and nonfinite failures preserve terminal evidence before reset, and old inputs/valves clear',()=>{
  const sim=flat();for(let i=0;i<60;i++)sim.advanceFixed({frontJets:.2});const step=sim._stepCount,time=sim.simTime;sim.body.position.y=400;
  let callbacks=0;const t=sim.step(dt,{throttle:1},null,data=>{callbacks++;assert.ok(data.failure);});const failure=sim.getFailureReport();assert.equal(callbacks,1);assert.equal(failure.kind,'safety-domain');assert.equal(failure.triggerStep,step);close(failure.triggerSimTime,time);assert.equal(failure.triggerPhysical.position.y,400);assert.ok(failure.lastValidPhysical.position.y<400);assert.equal(t.position.y,.62);assert.deepEqual(t.driverInput,{});assert.ok(t.nozzles.every(n=>n.command===0&&n.force===0));assert.ok(failure.history.length===60);assert.ok(failure.triggerContinuationSnapshot);assert.doesNotThrow(()=>JSON.parse(JSON.stringify(failure)));
  const unchanged=sim.exportState();sim.advanceFixed({throttle:1});assert.deepEqual(sim.exportState(),unchanged,'Faulted simulation cannot resume old input until explicit reset');sim.reset('free');assert.equal(sim.telemetry().fault,null);assert.ok(sim.getFailureReport(),'Manual reset retains separately exported diagnostic evidence');
  for(let i=0;i<5;i++)sim.advanceFixed({});sim.body.velocity.x=NaN;const bad=sim.advanceFixed({throttle:1}),nf=bad.failure;assert.equal(nf.kind,'non-finite-state');assert.deepEqual(nf.triggerPhysical.velocity.x,{nonFinite:'NaN'});assert.equal(nf.triggerContinuationSnapshot,null);assert.ok(nf.continuationUnavailable);assert.ok(nf.nonFiniteFields.some(v=>v.path==='velocity.x'));assert.doesNotThrow(()=>JSON.parse(JSON.stringify(nf)));assert.deepEqual(sim._lastInput,{});
  const after=flat();after.body.position.x=650;after.body.velocity.set(100000,0,0);const out=after.advanceFixed({throttle:.25});assert.equal(out.failure.phase,'after-fixed-step');assert.equal(out.failure.triggerStep,1);assert.equal(out.failure.triggerPhysical.input.throttle,.25);assert.ok(out.failure.triggerPhysical.position.x>700);
  evidence.failureCases={safetyDomain:failure,nonfinite:nf,afterIntegration:out.failure};
});

check('Low finite gas and hard landing remain physical outcomes, not fabricated solver failures',()=>{
  const sim=flat({supplyMode:'finite'});sim.gasMass=.01;sim._updateMass(true);sim.body.position.y=3;sim.body.velocity.y=-7;
  let contactSteps=0;for(let i=0;i<240;i++){const t=sim.advanceFixed({});assert.equal(t.fault,null);if(sim.getContactDiagnostics().length||t.contactCount)contactSteps++;}
  assert.ok(contactSteps>0);assert.equal(sim.getFailureReport(),null);evidence.lowGasLanding={pressureBar:sim.pressureBar(),contactSteps,final:sim.telemetry().position,solverFault:false};
});

check('Research height outer loop obeys layer, expiry, slew, authority and continuation contracts',()=>{
  const sim=new RoadsterSim({}, {world:'windlab'});sim.setPoseTarget({position:{x:0,y:3,z:0},quaternion:{x:0,y:0,z:0,w:1}});
  assert.equal(sim.setResearchHeightControl({accelerationMps2:99,controllerHash:'fixture',expiresAfterSteps:12}),true);const initial=sim.exportState();const mirror=new RoadsterSim({}, {world:'windlab'});mirror.importState(initial);
  const outputs=[];for(let i=0;i<14;i++){const a=sim.advanceFixed({}),b=mirror.advanceFixed({});assert.deepEqual(sim.exportState(),mirror.exportState());assert.ok(a.nozzles.every(n=>n.force<=n.maxForce+1e-9));if(a.researchHeightControl.active){assert.ok(Math.abs(a.researchHeightControl.appliedAccelerationMps2)<=6);assert.ok(a.researchHeightControl.appliedAccelerationMps2<=(i+1)*30*dt+1e-9);}outputs.push(a.researchHeightControl);}
  assert.equal(outputs[12].enabled,false);assert.equal(outputs[12].reason,'command-expired');
  const physicalBefore={position:{...sim.body.position},velocity:{...sim.body.velocity},quaternion:{...sim.body.quaternion}};assert.equal(sim.setResearchHeightControl({accelerationMps2:NaN,controllerHash:'fixture'}),false);assert.equal(sim.telemetry().researchHeightControl.lastFault.reason,'non-finite-output');assert.deepEqual({position:{...sim.body.position},velocity:{...sim.body.velocity},quaternion:{...sim.body.quaternion}},physicalBefore);
  assert.equal(flat().setResearchHeightControl({accelerationMps2:2,controllerHash:'fixture'}),false);
  assert.equal(sim.setResearchHeightControl({accelerationMps2:2,controllerHash:'fixture',expiresAfterSteps:13}),false);
  const malformed=clone(initial);malformed.state._researchHeightControl.expiresAtStep=100;assert.throws(()=>mirror.importState(malformed));
  evidence.researchHook={scope:'wind laboratory hover+hold vertical acceleration only; no direct state changes',physicalHz:120,accelerationBoundMps2:6,slewBoundMps3:30,maxHoldSteps:12,outputs,continuationBitwiseMatched:true};
});

const sources=['dist/physics.js','dist/trim-feasibility.js','dist/simulation-safety.js','dist/vehicle-clearance.js','dist/simulation-snapshot.js'];
mkdirSync(new URL('../qa/',import.meta.url),{recursive:true});
writeFileSync(new URL(`../qa/physics-controls-deepening-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify({schema:'roadster-physics-controls-evidence',version:1,modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',scope:'Node fixed-step numerical and independent wrench evidence. No GPU, real keyboard, camera image or driving-feel acceptance is claimed.',checks,sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(p)])),evidence},null,2)+'\n');
