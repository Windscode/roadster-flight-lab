import {nozzleExhaustVelocity} from './vehicle-models.js';
import {nozzlePressureFactor} from './nozzle-supply.js';
import {AUXILIARY_POWER_W} from './energy-model.js';

// Advisory only. The real vehicle always remains on the 120 Hz 6-DOF solver.
// This bounded, one-dimensional forecast uses the same tank and nozzle laws,
// a torque-balanced trim ray, and explicit validity limits. It is not an
// emergency controller, collision certificate, or real-car safety guarantee.
export const LANDING_RESERVE_PROTOCOL='vertical-landing-reserve-2';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function forecast(t,p,height,trim,electrical,{arrest=false}={}){
  const dt=1/120,maxSteps=120*35,bench=p.supplyMode==='bench';
  let mass=t.gasMass,temperature=t.gasTemperatureK,y=height,v=t.verticalSpeed,spent=0,minY=y,elapsed=0;
  const weight=t.mass*p.gravity,shares=trim.nozzles.map(n=>n.forceN/weight),totalShare=shares.reduce((s,v)=>s+v,0);
  // A uniform scale of a feasible gravity wrench retains zero body torque.
  const capacities=t.nozzles.map(n=>n.ratedForce*n.healthScale);
  let thrust=Math.max(0,t.nozzles.reduce((s,n,i)=>s+n.force,0)/Math.max(1,totalShare));
  let peakDemandRatio=0,pressure=t.pressureBar,stop=null;
  let energyRemainingJ=electrical.initialEnergyJ,controlPowerLost=false;
  const supply=()=>({electricalUsedJ:electrical.initialEnergyJ-energyRemainingJ,electricalRemainingJ:energyRemainingJ,controlPowerLost,reserveElectricalPowerW:electrical.reservePowerW});
  if(arrest&&t.verticalSpeed>=0)return{status:'arrest-estimate',arrest:{timeS:0,heightUsedM:0,gasKg:0},gasRequiredKg:0,gasRemainingKg:bench?null:mass,peakDemandRatio,...supply()};
  for(let step=0;step<maxSteps;step++){
    pressure=bench?p.initialPressureBar:mass*287.05*temperature/(p.tankLitres/1000)/1e5;
    // Keep the same control-power priority as the real resource solver. For
    // an active/spinning fan, reserve its full rating throughout the forecast
    // rather than pretending its existing electrical load disappears.
    const powered=energyRemainingJ>=electrical.reservePowerW*dt;
    controlPowerLost||=!powered;
    const derate=nozzlePressureFactor(pressure,p.regulatorBar,p.ambientPressureBar)*Number(powered);
    const m=bench?t.mass:p.dryMass+mass;
    let maxVertical=Infinity;
    for(let i=0;i<shares.length;i++)if(shares[i]>1e-9)maxVertical=Math.min(maxVertical,capacities[i]*derate/shares[i]);
    if(!finite(maxVertical))return{status:'unavailable',reason:'trim-ray-empty',...supply()};
    // Leave 15% of the trim ray for unmodelled attitude correction. This is a
    // declared estimate margin, never an increase of the actual actuator limit.
    maxVertical*=.85;
    const descentTarget=-Math.min(1.2,Math.sqrt(Math.max(0,2*.8*y)));
    const acceleration=arrest?Infinity:clamp((descentTarget-v)*3.6,-3,4);
    const request=arrest?maxVertical:Math.max(0,m*(p.gravity+acceleration));
    peakDemandRatio=Math.max(peakDemandRatio,request/Math.max(1,maxVertical));
    const command=Math.min(request,maxVertical),tau=command>thrust?p.valveRiseTime:p.valveFallTime;
    thrust=clamp(thrust+(command-thrust)*(1-Math.exp(-dt/tau)),0,maxVertical);
    const scalar=thrust*totalShare,ve=nozzleExhaustVelocity(p,pressure,temperature),need=scalar/ve*dt,take=bench?need:Math.min(mass,need),scale=need>0?take/need:1;
    const previousV=v;v+=(thrust*scale/m-p.gravity)*dt;y+=v*dt;minY=Math.min(minY,y);elapsed+=dt;spent+=take;
    energyRemainingJ=Math.max(0,energyRemainingJ-electrical.reservePowerW*dt);
    if(!bench){const previous=mass;mass-=take;if(p.gasModel==='adiabatic'&&previous>1e-10)temperature*=Math.pow(mass/previous,p.gasGamma-1);else temperature=p.gasTemperatureK;temperature+=(p.gasTemperatureK-temperature)*(1-Math.exp(-dt/p.tankThermalTime));}
    if(arrest&&v>=0&&previousV<0){stop={timeS:elapsed,heightUsedM:Math.max(0,height-minY),gasKg:spent};break;}
    if(y<=0){return{status:Math.abs(v)<=.65?'soft-contact-estimate':'hard-contact-estimate',timeS:elapsed,contactVerticalMps:v,gasRequiredKg:spent,gasRemainingKg:bench?null:mass,pressureAtContactBar:pressure,peakDemandRatio,arrest:stop,...supply()};}
  }
  return arrest?{status:stop?'arrest-estimate':'not-arrested-in-window',arrest:stop,gasRequiredKg:spent,gasRemainingKg:bench?null:mass,peakDemandRatio,...supply()}:{status:'forecast-horizon-exceeded',timeS:elapsed,gasRequiredKg:spent,gasRemainingKg:bench?null:mass,peakDemandRatio,...supply()};
}
export function estimateLandingReserve(t,p,clearance){
  const a=t.controlAuthority,trim=a?.currentPoseTrim;
  const base={protocol:LANDING_RESERVE_PROTOCOL,simTime:t.simTime,step:Math.round(t.simTime*120),estimated:true,supplyMode:t.supplyMode,scope:'near-level, low-horizontal-speed descent over sampled collision surface; fixed current attitude, no lateral path/obstacle prediction',validity:{maximumTiltDeg:10,maximumAngularSpeedRadS:.35,maximumHorizontalSpeedMps:3,forecastHz:120,horizonS:35,trimRayFraction:.85},hover:{feasible:!!trim?.staticFeasible,marginN:a?.verticalForceReserveUpperBoundN??null,meaning:'static trim now; not a landing prediction'},arrest:{available:false,possible:null},landing:{available:false,gasRequiredKg:null,gasRemainingKg:null},limitations:[],status:'unavailable'};
  if(![t.mass,t.gasMass,t.gasTemperatureK,t.verticalSpeed,t.pressureBar,p.gravity,t.energyKWh,p.fanPower].every(finite)||t.energyKWh<0||p.fanPower<0||!trim){base.limitations.push('invalid-model-state');return base;}
  if(t.contactCount>=3&&Math.abs(t.verticalSpeed)<.35){base.status='grounded';base.landing={available:true,status:'already-supported',gasRequiredKg:0,gasRemainingKg:t.supplyMode==='bench'?null:t.gasMass};return base;}
  const h=clearance?.distances?.down?.distanceM;
  if(!finite(h)){base.limitations.push('no-sampled-landing-surface');return base;}
  base.sampledClearanceM=h;base.surfaceId=clearance.distances.down.objectId??null;
  const tilt=Math.acos(clamp(a.bodyUpDot,-1,1))*180/Math.PI,omega=Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z),horizontal=Math.hypot(t.velocity.x,t.velocity.z);
  if(tilt>10)base.limitations.push('attitude-outside-estimate');
  if(omega>.35)base.limitations.push('rotation-outside-estimate');
  if(horizontal>3)base.limitations.push('horizontal-motion-outside-estimate');
  // This one-dimensional descent cannot predict a continuing drive request
  // and its changing wheel electrical work; do not silently omit that load.
  if(Math.abs(t.driverInput?.throttle??0)>.01||(t.driveAccounting?.electricalPowerW??0)>1)base.limitations.push('wheel-drive-outside-estimate');
  if(!trim.staticFeasible){base.limitations.push('no-current-static-trim');base.status='insufficient-support';return base;}
  if(base.limitations.length)return base;
  const wind=t.wind??{};const windMagnitude=Math.hypot(wind.speedMps||0,wind.gustMps||0);
  if(windMagnitude>0||wind.enabled||wind.profile&&wind.profile!=='none')base.limitations.push('wind-not-forecast');
  if(t.nozzleFault)base.limitations.push('fault-capacity-included-not-dynamic-recovery');
  const fanActive=t.suctionEnabled||(t.electricalSupply?.fanSpinFraction??Number(t.suctionN>0))>=.001;
  const electrical={initialEnergyJ:t.energyKWh*3.6e6,auxiliaryPowerW:AUXILIARY_POWER_W,fanReservePowerW:fanActive?p.fanPower:0,
    reservePowerW:AUXILIARY_POWER_W+(fanActive?p.fanPower:0),scope:'Constant auxiliary load; active/spinning fan reserves its full rating until contact. Active wheel drive is outside this vertical forecast; future pilot commands are not predicted.'};
  base.electrical=electrical;
  const arrest=forecast(t,p,h,trim,electrical,{arrest:true}),landing=forecast(t,p,h,trim,electrical);
  base.arrest={available:true,possible:t.verticalSpeed>=0||arrest.status==='arrest-estimate',heightRequiredM:arrest.arrest?.heightUsedM??null,timeS:arrest.arrest?.timeS??null,gasRequiredKg:arrest.arrest?.gasKg??arrest.gasRequiredKg,status:arrest.status,electricalUsedJ:arrest.electricalUsedJ,electricalRemainingJ:arrest.electricalRemainingJ,controlPowerLost:arrest.controlPowerLost};
  base.landing={available:true,...landing};
  if(landing.controlPowerLost)base.limitations.push('electrical-supply-exhausted');
  base.status=!base.arrest.possible||landing.controlPowerLost||landing.status==='hard-contact-estimate'?'insufficient':landing.status==='soft-contact-estimate'?'estimated-reserve':'unavailable';
  if(t.supplyMode==='bench'){base.landing.gasRemainingKg=null;base.landing.enduranceS=null;base.landing.throughputKg=base.landing.gasRequiredKg;base.landing.gasRequiredKg=null;}
  if(base.limitations.length&&base.status==='estimated-reserve')base.status='conditional-estimate';
  return base;
}

export function controlLimitFeedback(t){
  if(t.mode==='drive'&&t.contactCount>=2&&!t.driverInput?.lift){
    const d=t.driveAccounting||{},w=t.wheelStates||[],reasons=[];
    if(w.some(x=>x.tcsActive))reasons.push('tcs-torque-limit');
    if(w.some(x=>x.corneringTractionActive||x.gripUse>.95))reasons.push('combined-tire-grip');
    if(d.powerLimited)reasons.push('motor-power-limit');
    if(t.regenForceN>10)reasons.push('lift-off-regeneration');
    return{layer:'drive',reasons,requested:d.requestedTorqueNm??0,achieved:d.actualTorqueNm??0,unit:'Nm'};
  }
  const reasons=[],a=t.controlAuthority||{};
  if(t.pressureBar<(a.regulatorBar||50))reasons.push('pressure-derating');
  if(!a.currentPoseTrimFeasible)reasons.push('attitude-support-limit');
  if(a.saturatedNozzles?.length)reasons.push('force-or-torque-saturation');
  if(t.nozzles?.some(n=>n.command-n.force>Math.max(200,n.maxForce*.1)))reasons.push('valve-rise');
  return{layer:'flight',reasons,requested:t.desiredWrench?.[1]??0,achieved:t.achievedWrench?.[1]??0,unit:'N'};
}
