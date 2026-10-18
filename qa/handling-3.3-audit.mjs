// Independent quantitative audit. Default imports the frozen 3.2 source saved
// alongside this file; --current audits the actively edited implementation.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const current=process.argv.includes('--current');
const sourceURL=new URL('../dist/physics.js',import.meta.url);
const frozenURL=new URL('./physics-3.2-handling-reference.mjs',import.meta.url);
if(!existsSync(frozenURL))writeFileSync(frozenURL,readFileSync(sourceURL,'utf8').replaceAll("from './","from '../dist/"));
const {RoadsterSim,DEFAULT_PARAMS}=await import(current?sourceURL:frozenURL);
const dt=1/120,deg=180/Math.PI;
const r=x=>Math.round(x*1e6)/1e6;
const flat=(params={})=>{const s=new RoadsterSim(params);for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.body.position.set(0,.62,-350);for(let i=0;i<240;i++)s.step(dt);return s;};
const observe=s=>{const t=s.telemetry(),lv=s.body.quaternion.conjugate().vmult(s.body.velocity);return{
  elapsed:r(s.simTime-2),speedKmh:r(t.speedKmh),betaDeg:r(Math.atan2(lv.x,Math.abs(lv.z))*deg),yawRateDegPerSec:r(t.angularVelocity.y*deg),headingDeg:r(t.headingDeg),rollDeg:r(t.rollDeg),steerDeg:r(t.wheelStates[0].steer*deg),
  contacts:t.contactCount,minLoadN:r(Math.min(...t.wheelStates.map(w=>w.normalLoadN))),maxLoadN:r(Math.max(...t.wheelStates.map(w=>w.normalLoadN))),maxGripUse:r(Math.max(...t.wheelStates.map(w=>w.gripUse))),
  slipDeg:t.wheelStates.map(w=>r(w.slipAngle*deg)),loadsN:t.wheelStates.map(w=>r(w.normalLoadN)),forcesN:t.wheelStates.map(w=>[r(w.longitudinalForceN),r(w.lateralForceN)]),gripUse:t.wheelStates.map(w=>r(w.gripUse)),
  position:t.position,fault:t.fault};};
const handling=[];
for(const speedKmh of [30,60,100,160])for(const steer of [.1,.25,1])for(const holdSeconds of [.35,2]){
 const s=flat();s.body.velocity.z=speedKmh/3.6;
 const start=s.simTime,trace=[];let peakBetaDeg=0,peakYawRate=0,minLoadN=Infinity,maxGrip=0,maxRoll=0,saturatedWheelSteps=0;
 for(let i=0;i<Math.round((holdSeconds+3)*120);i++){
   // Hold the requested speed approximately with actual motor force; coast
   // separately to avoid making a full-throttle turn the sole handling test.
   const t=s.step(dt,{steer:i<holdSeconds*120?steer:0,throttle:.03});
   const o=observe(s);peakBetaDeg=Math.max(peakBetaDeg,Math.abs(o.betaDeg));peakYawRate=Math.max(peakYawRate,Math.abs(o.yawRateDegPerSec));minLoadN=Math.min(minLoadN,o.minLoadN);maxGrip=Math.max(maxGrip,o.maxGripUse);maxRoll=Math.max(maxRoll,Math.abs(o.rollDeg));
   saturatedWheelSteps+=t.wheelStates.filter(w=>w.gripUse>.95).length;
   if(i%12===0||i===Math.round(holdSeconds*120)-1||i===Math.round((holdSeconds+3)*120)-1)trace.push(o);
 }
 const delta=steer*.49/(1+(speedKmh/3.6)*.023),kinematicAy=(speedKmh/3.6)**2*Math.tan(delta)/2.84;
 handling.push({speedKmh,inputSteer:steer,holdSeconds,requestedRoadWheelAngleDeg:r(delta*deg),kinematicLateralDemandG:r(kinematicAy/9.81),peakBetaDeg:r(peakBetaDeg),peakYawRateDegPerSec:r(peakYawRate),minLoadN:r(minLoadN),maxGripUse:r(maxGrip),peakRollDeg:r(maxRoll),saturatedWheelTimeFraction:r(saturatedWheelSteps/((holdSeconds+3)*120*4)),releasePlus3Seconds:observe(s),trace});
}
const flight=[];
for(const supplyMode of ['finite','bench'])for(const duration of [.25,.5,1,2]){
 const s=flat({supplyMode}),initial=s.telemetry();let maxAcceleration=0,impulse=0;
 for(let i=0;i<duration*120;i++){const v=s.body.velocity.y,t=s.step(dt,{lift:1});maxAcceleration=Math.max(maxAcceleration,(t.verticalSpeed-v)/dt);impulse+=t.thrustN*dt;}
 const t=s.telemetry();flight.push({supplyMode,duration,initialMassKg:r(initial.mass),heightRiseM:r(t.heightWorld-initial.heightWorld),verticalSpeedMps:r(t.verticalSpeed),peakUpwardAccelerationMps2:r(maxAcceleration),gasConsumedKg:r(initial.gasMass-t.gasMass),gasRemainingFraction:r(t.gasFraction),pressureBar:r(t.pressureBar),gasTemperatureK:r(t.gasTemperatureK),impulseNs:r(impulse),thrustN:r(t.thrustN)});
}
const hover=flat();hover.body.position.y=12;hover.setMode('hover');hover.setParam('hoverHeight',12);
const hoverTrace=[];for(let i=0;i<20*120;i++){const t=hover.step(dt);if(i%60===0)hoverTrace.push({time:r(i*dt),heightM:r(t.heightWorld),pressureBar:r(t.pressureBar),temperatureK:r(t.gasTemperatureK),gasFraction:r(t.gasFraction),gasMassKg:r(t.gasMass),pressureLimited:t.pressureLimited,thrustN:r(t.thrustN),verticalSpeedMps:r(t.verticalSpeed),fault:t.fault});}
const roll=flat();roll.startManeuver('roll');let rollMinGas=1;const rollTrace=[];for(let i=0;i<15*120;i++){const t=roll.step(dt);rollMinGas=Math.min(rollMinGas,t.gasFraction);if(i%30===0)rollTrace.push({time:r(i*dt),heightM:r(t.heightWorld),rollDeg:r(t.rollDeg),phase:t.maneuver?.phase,gasMassKg:r(t.gasMass),gasFraction:r(t.gasFraction),pressureBar:r(t.pressureBar),fault:t.fault});}
const p=DEFAULT_PARAMS,initialGas=p.initialPressureBar*1e5*(p.tankLitres/1000)/(287.05*p.gasTemperatureK),m=p.dryMass+initialGas;
const thermo={gasMassIdealKg:r(initialGas),loadedMassKg:r(m),ratedLiftN:4*p.liftNozzleMax,liftThrustWeightRatio:r(4*p.liftNozzleMax/(m*p.gravity)),initialNetUpAccelerationMps2:r(4*p.liftNozzleMax/m-p.gravity),fullThrustMassFlowKgPerSec:r(4*p.liftNozzleMax/p.exhaustVelocity),hoverMassFlowKgPerSec:r(m*p.gravity/p.exhaustVelocity),constantVelocityGasImpulseNs:r(initialGas*p.exhaustVelocity),constantVelocityIdealHoverSeconds:r(p.exhaustVelocity/p.gravity*Math.log(m/p.dryMass)),ispSeconds:r(p.exhaustVelocity/p.gravity),idealAdiabaticNozzleExitVelocity50bar293K:r(Math.sqrt(2*p.gasGamma/(p.gasGamma-1)*287.05*p.gasTemperatureK*(1-(1/50)**((p.gasGamma-1)/p.gasGamma)))),vacuumColdAirEnergyLimit293K:r(Math.sqrt(2*p.gasGamma/(p.gasGamma-1)*287.05*p.gasTemperatureK)),note:'650 m/s is an effective constant exhaust velocity assumption, not measured Roadster data. The 50 bar isentropic perfectly expanded air value at 293 K is an upper ideal value before nozzle losses; tank cooling further lowers the available exit speed.'};
const out={schema:1,auditedAt:new Date().toISOString(),implementation:current?'current':'frozen-3.2',physicsSha256:createHash('sha256').update(readFileSync(current?sourceURL:frozenURL)).digest('hex'),parameters:p,protocol:{hz:120,gravity:9.81,ground:'shared infinite-enough flat ground; all city and boundary bodies removed',start:[0,.62,-350],settleSeconds:2,turnThrottle:.03,note:'No ESC, no artificial yaw/sideslip forces. Road-wheel step with existing 14/s first-order steering. Peak beta computed from body-frame CG velocity; trace samples 10 Hz. Different runs may decelerate due to tire scrub.'},thermo,handling,flight,hoverTrace,roll:{minGasFraction:r(rollMinGas),trace:rollTrace}};
const outputURL=new URL(current?'./handling-3.3-current.json':'./handling-3.3-audit.json',import.meta.url);writeFileSync(outputURL,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({output:fileURLToPath(outputURL),thermo,handling:handling.map(({trace,...o})=>({...o,releasePlus3Seconds:{betaDeg:o.releasePlus3Seconds.betaDeg,yawRateDegPerSec:o.releasePlus3Seconds.yawRateDegPerSec,speedKmh:o.releasePlus3Seconds.speedKmh}})),flight,hoverLast:hoverTrace.at(-1),rollMinGasFraction:rollMinGas},null,2));
