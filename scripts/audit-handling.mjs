import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Reproducible reduced-model experiments. No alteration of running source or
// dynamic pose/velocity during the measured phase. The optional --current flag
// imports the current implementation; otherwise an immutable source snapshot is
// made before the experiments to permit safe concurrent implementation work.
const sourceURL=new URL('../dist/physics.js',import.meta.url);
const current=process.argv.includes('--current');
const variant=process.argv.find(v=>v.startsWith('--variant='))?.slice(10)||'baseline';
const source=readFileSync(sourceURL,'utf8');
const snapshotURL=new URL('../qa/handling-baseline-physics.mjs',import.meta.url);
mkdirSync(new URL('../qa/',import.meta.url),{recursive:true});
if(!current&&!process.argv.includes('--preserve-baseline'))writeFileSync(snapshotURL,source.replaceAll("'./vendor/cannon-es.js'","'../dist/vendor/cannon-es.js'").replaceAll("'./city-data.js'","'../dist/city-data.js'").replaceAll("'./vehicle-layout.js'","'../dist/vehicle-layout.js'"));
let moduleURL=current?sourceURL:snapshotURL;
if(variant!=='baseline'){
  let code=readFileSync(snapshotURL,'utf8');
  if(variant==='load-ebd')code=code.replace('input.brake*p.brakeForce/n','input.brake*p.brakeForce*c.w.normalLoadN/contacts.reduce((s,c)=>s+c.w.normalLoadN,0)');
  if(variant==='front-bias')code=code.replace('input.brake*p.brakeForce/n','input.brake*p.brakeForce*(c.relative.dot(b.quaternion.vmult(Z))>0?.39:.11)');
  if(variant==='lateral-load-independent')code=code.replace('Math.tanh(c.w.slipAngle*4.8)*capacity','Math.tanh(c.w.slipAngle*4.8)*(b.mass*p.gravity/n)');
  if(variant==='dt-half')code=code.replace('PHYSICS_HZ=120','PHYSICS_HZ=240');
  if(variant==='dt-double')code=code.replace('PHYSICS_HZ=120','PHYSICS_HZ=60');
  moduleURL=new URL('../qa/handling-variant-'+variant+'.mjs',import.meta.url);writeFileSync(moduleURL,code);
}
const {RoadsterSim,PHYSICS_HZ}=await import(moduleURL.href+'?audit='+Date.now());
const dt=1/PHYSICS_HZ,deg=180/Math.PI;
const plain=v=>({x:v.x,y:v.y,z:v.z});
const bodyContacts=s=>s.world.contacts.filter(c=>c.bi===s.body||c.bj===s.body).map(c=>({shape:(c.bi===s.body?c.si:c.sj)?.material?.name||'hull',surface:(c.bi===s.body?c.bj:c.bi)?.userData?.id}));
function make(gas='full',direction=1){
  const s=new RoadsterSim();
  // Isolate an unchanged 1.24 km flat ground slab: no buildings, edges, road
  // slope or scenery collision can be misclassified as a tire instability.
  for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);
  s.body.position.set(0,.62,-direction*350);s.body.quaternion.setFromEuler(0,direction===1?0:Math.PI,0);
  if(gas==='empty'){s.gasMass=0;s._updateMass(true);}
  for(let i=0;i<PHYSICS_HZ*3;i++)s.step(dt,{});
  if(s._contactCount!==4||bodyContacts(s).length)throw Error('Initial equilibrium invalid');
  s.body.angularVelocity.setZero();
  return s;
}
function run({label,speed=200,gas='full',direction=1,perturb='none',amplitude=1e-5,steer=0,brake=1,seconds=14,throttle=0}){
  const s=make(gas,direction),q0=s.body.quaternion.clone(),f0=q0.vmult({x:0,y:0,z:1});
  s.body.velocity.set(f0.x*speed/3.6,0,f0.z*speed/3.6);
  if(perturb==='yaw'){const dq=q0.clone();dq.setFromEuler(0,amplitude,0);s.body.quaternion.copy(dq.mult(q0));}
  if(perturb==='lat'){const right=q0.vmult({x:1,y:0,z:0});s.body.velocity.vadd(right.scale(amplitude),s.body.velocity);}
  if(perturb==='yawRate')s.body.angularVelocity.y=amplitude;
  if(perturb==='residualSteer')s.wheelStates.slice(0,2).forEach(w=>w.steer=amplitude);
  const start=plain(s.body.position),t0=s.simTime,records=[];
  let maxYaw=0,maxYawRate=0,maxLateral=0,maxSlip=0,maxForceAsym=0,minContacts=4,bodyContactSteps=0,wheelContactSteps=0;
  let stop=null,hold=0,totalDistance=0,last=plain(s.body.position),forces=[];
  const apply=s.body.applyForce.bind(s.body),wheels=s._wheels.bind(s);let measuring=false;
  s.body.applyForce=(force,relative)=>{if(measuring)forces.push({force:plain(force),relative:plain(relative)});return apply(force,relative);};
  s._wheels=(step,input)=>{forces=[];measuring=true;wheels(step,input);measuring=false;};
  for(let k=0;k<seconds*PHYSICS_HZ;k++){
    const t=s.step(dt,{brake,steer,throttle}),position=plain(s.body.position),elapsed=s.simTime-t0;
    if(t.fault)throw Error(label+': '+t.fault);
    const fw=s.body.quaternion.vmult({x:0,y:0,z:1});
    const yaw=Math.atan2(fw.x*f0.z-fw.z*f0.x,fw.x*f0.x+fw.z*f0.z)*deg;
    const lateral=(position.x-start.x)*f0.z-(position.z-start.z)*f0.x;
    totalDistance+=Math.hypot(position.x-last.x,position.z-last.z);last=position;
    maxYaw=Math.max(maxYaw,Math.abs(yaw));maxYawRate=Math.max(maxYawRate,Math.abs(s.body.angularVelocity.y*deg));maxLateral=Math.max(maxLateral,Math.abs(lateral));
    minContacts=Math.min(minContacts,t.contactCount);maxSlip=Math.max(maxSlip,...s.wheelStates.map(w=>Math.abs(w.slipAngle)));
    const contacts=bodyContacts(s);if(contacts.some(c=>c.shape==='hull'))bodyContactSteps++;if(contacts.some(c=>c.shape!=='hull'))wheelContactSteps++;
    const tire=forces.slice(s._contactCount),loads=s.wheelStates.map(w=>w.normalLoadN);
    const localTire=tire.map(c=>plain(s.body.quaternion.conjugate().vmult(c.force)));
    if(localTire.length===4)maxForceAsym=Math.max(maxForceAsym,Math.abs(localTire[0].z+localTire[2].z-localTire[1].z-localTire[3].z));
    if(k%12===0)records.push({s:+elapsed.toFixed(3),speedKmh:+t.forwardSpeedKmh.toFixed(5),yawDeg:+yaw.toFixed(6),yawRateDegS:+(s.body.angularVelocity.y*deg).toFixed(6),lateralM:+lateral.toFixed(6),loadsN:loads.map(v=>+v.toFixed(2)),slipAngles:s.wheelStates.map(w=>+w.slipAngle.toFixed(8)),localTireForcesN:localTire.map(f=>Object.fromEntries(Object.entries(f).map(([a,v])=>[a,+v.toFixed(3)]))),bodyContacts:contacts});
    if(!stop&&Math.hypot(s.body.velocity.x,s.body.velocity.z)<.1&&t.contactCount===4)stop={seconds:elapsed,pathM:totalDistance,yawDeg:yaw,lateralM:lateral};
    if(stop){if(s.body.velocity.length()<.15)hold+=dt;else hold=0;if(hold>=1)break;}
  }
  const fw=s.body.quaternion.vmult({x:0,y:0,z:1}),finalYaw=Math.atan2(fw.x*f0.z-fw.z*f0.x,fw.x*f0.x+fw.z*f0.z)*deg;
  return {label,input:{speed,gas,direction,perturb,amplitude,steer,brake,throttle},massKg:s.body.mass,maxYawDeg:maxYaw,maxYawRateDegS:maxYawRate,maxLateralM:maxLateral,maxSlipRad:maxSlip,maxLongitudinalAsymmetryN:maxForceAsym,minContacts,bodyContactSteps,wheelContactSteps,stop,finalYawDeg:finalYaw,finalSpeedKmh:s.body.velocity.length()*3.6,finalPosition:plain(s.body.position),valid:bodyContactSteps===0&&wheelContactSteps===0,records};
}
const experiments=[];
for(const direction of [1,-1])for(const steer of [-.4,.4])experiments.push(run({label:`steering ${steer} world direction ${direction}`,speed:50,direction,steer,brake:0,throttle:.25,seconds:1.5}));
for(const gas of ['full','empty'])for(const speed of [100,200,300])for(const perturb of ['none','yaw','lat','yawRate','residualSteer'])experiments.push(run({label:`brake ${speed} ${gas} ${perturb}`,speed,gas,perturb}));
for(const perturb of ['yaw','lat','yawRate','residualSteer'])for(const direction of [1,-1])for(const sign of [-1,1])experiments.push(run({label:`symmetry 300 ${perturb} direction ${direction} sign ${sign}`,speed:300,direction,perturb,amplitude:sign*1e-5}));
for(const steer of [-.002,.002,-.01,.01])experiments.push(run({label:`brake 200 held steer ${steer}`,speed:200,steer}));
const report={generatedAt:new Date().toISOString(),variant,physicsHz:PHYSICS_HZ,physicsSha256:createHash('sha256').update(source).digest('hex'),scope:'Internal reduced-order model, not measured Tesla data. Unchanged large level ground slab, all other static scenery removed only for isolation; no pose/speed modifications after initial perturbation.',coordinateConvention:'world Y up, vehicle forward +Z. Physical driver-right is -X. Positive raw steer in baseline means +X trajectory, which is driver-left.',experiments};
const output=process.argv.find(v=>v.startsWith('--output='))?.slice(9)||(current?'handling-after.json':'handling-before.json');
if(!/^[\w.-]+\.json$/.test(output))throw Error('Invalid output name');
writeFileSync(new URL('../qa/'+output,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,experiments:experiments.map(({records,...e})=>e)},null,2));
