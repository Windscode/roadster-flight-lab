import {MODEL_VERSION} from './vehicle-models.js';
import {MODEL_BUILD_ID} from './model-build.js';
import {energySummary,validateEnergyLedger} from './energy-model.js';
// Deliberately near-depleted 200 kWh pack, not a fictitiously lightweight pack.
// Budgets are a game scenario; they are not specifications of a real Roadster.
export const RESOURCE_ROUTE=Object.freeze({id:'weave-finite-1',initialKWh:.12,initialPressureBar:100,tankLitres:600,deadlineS:65,minimumFinishKWh:.005,minimumGasKg:5});
const copy=x=>structuredClone(x);
const snapshotBudget=t=>({motorElectricalJ:t.energyAccounting.motorElectricalJ,motorBrakingHeatJ:t.energyAccounting.motorBrakingHeatJ,fanJ:t.energyAccounting.fanJ,auxiliaryJ:t.energyAccounting.auxiliaryJ,recoveredJ:t.energyAccounting.recoveredJ,regenMechanicalJ:t.energyAccounting.regenMechanicalJ,regenLossJ:t.energyAccounting.regenLossJ,frictionBrakeJ:t.energyAccounting.frictionBrakeJ,rollingLossJ:t.energyAccounting.rollingLossJ,tireDissipationJ:t.energyAccounting.tireDissipationJ});
const resourceSample=t=>({simTime:t.simTime,energyKWh:t.energyKWh,gasMass:t.gasMass,onboardGasConsumedKg:t.onboardGasConsumedKg,externalGasSuppliedKg:t.externalGasSuppliedKg,energyAccounting:copy(t.energyAccounting)});
function failureResourceSample(t){
  // The safety kernel has already reset the live car. Only the preserved
  // finite terminal snapshot can establish resources at the failure trigger.
  const snapshot=t.failure?.triggerContinuationSnapshot;
  if(!snapshot||snapshot.modelVersion!==MODEL_VERSION)return null;
  try{
    const ledger=validateEnergyLedger(snapshot.resourceAccounting),state=snapshot.state;
    const capacityJ=snapshot.params.batteryKWh*3.6e6,remainingJ=capacityJ-state._energyUsed*3.6e6;
    const sample={simTime:state.simTime,energyKWh:remainingJ/3.6e6,gasMass:state.gasMass,onboardGasConsumedKg:state._gasConsumedKg,externalGasSuppliedKg:state._externalGasKg,energyAccounting:energySummary(ledger,remainingJ,capacityJ)};
    if(!Number.isFinite(capacityJ)||capacityJ<=0||remainingJ<0||remainingJ>capacityJ||Math.abs(sample.energyAccounting.balanceErrorJ)>.02||['simTime','energyKWh','gasMass','onboardGasConsumedKg','externalGasSuppliedKg'].some(k=>!Number.isFinite(sample[k])||sample[k]<0))return null;
    return sample;
  }catch{return null;}
}
export function prepareResourceRoute(sim,finite=true){
  // Route preparation is a new initial condition, including Cannon's clock.
  // Otherwise two settled starts differ solely by earlier driving history.
  sim.world.time=0;sim.world.stepnumber=0;sim.world.accumulator=0;
  sim.body.timeLastSleepy=0;
  sim.setSupplyMode(finite?'finite':'bench');
  if(finite){sim.setParam('initialPressureBar',RESOURCE_ROUTE.initialPressureBar);sim.setParam('tankLitres',RESOURCE_ROUTE.tankLitres);}
}
export function resourceInitialState(sim){return JSON.stringify(sim.exportState());}
export function completeResourcePreparation(sim,finite=true){
  if(finite)sim.prepareEnergy(Math.min(RESOURCE_ROUTE.initialKWh,sim.params.batteryKWh));
  return{finite,params:JSON.stringify(sim.params),revision:sim.telemetry().energyAccounting.revision,initialState:resourceInitialState(sim)};
}
export class ResourceMission{
  constructor(sim,{descriptorHash,finite=true,recordId=null,inputProfile=null}={}){
    const t=sim.telemetry();if(!t.energyAccounting)throw Error('Energy accounting unavailable');
    if(finite&&(sim.params.supplyMode!=='finite'||Math.abs(t.energyKWh-RESOURCE_ROUTE.initialKWh)>.000001||Math.abs(sim.params.initialPressureBar-RESOURCE_ROUTE.initialPressureBar)>.001||Math.abs(sim.params.tankLitres-RESOURCE_ROUTE.tankLitres)>.001))throw Error('Prepare the finite-resource initial state again');
    this.finite=finite;this.descriptorHash=descriptorHash;this.recordId=recordId;this.startedAt=t.simTime;this.lastTime=t.simTime;this.initial=copy(t);this.params=JSON.stringify(sim.params);this.wind=JSON.stringify(sim.getWind());this.revision=t.energyAccounting.revision;this.failure=null;this.samples=[];this.lastSample=-1;
    this.lastValidResources=resourceSample(t);this.terminalResources=null;this.resourceEvidence=null;
    this.identity={modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,descriptorHash,profile:finite?RESOURCE_ROUTE.id:'free-practice',parameters:copy(sim.params),wind:sim.getWind(),initialKWh:t.energyKWh,initialGasKg:t.gasMass,initialGasTemperatureK:t.gasTemperatureK,initialState:resourceInitialState(sim),inputProfile};
    this.comparisonKey=JSON.stringify({...this.identity,inputProfile:undefined});
  }
  check(sim,t=sim.telemetry()){
    if(this.failure)return this.failure;
    const elapsed=t.simTime-this.startedAt;
    let reason=null;
    if(t.fault)reason='simulation-fault';
    else if(t.rigidContactCount>0)reason='collision';
    else if(t.simTime+1e-7<this.lastTime||t.energyAccounting.revision!==this.revision)reason='reset-or-resource-reprepared';
    else if(JSON.stringify(sim.params)!==this.params||JSON.stringify(sim.getWind())!==this.wind||sim.getRouteSurface()?.descriptorHash!==this.descriptorHash)reason='conditions-changed';
    else if(this.finite&&t.externalGasSuppliedKg-this.initial.externalGasSuppliedKg>1e-6)reason='external-gas-supply';
    else if(this.finite&&Math.abs(t.gasMass-this.initial.gasMass+t.onboardGasConsumedKg-this.initial.onboardGasConsumedKg)>.0001)reason='gas-refilled-or-state-changed';
    else if(Math.abs(t.energyAccounting.balanceErrorJ)>.02)reason='energy-accounting-failed';
    else if(this.finite&&elapsed>RESOURCE_ROUTE.deadlineS+1e-8)reason='time-budget-exceeded';
    else if(this.finite&&t.energyKWh<=1e-8)reason='battery-exhausted';
    this.lastTime=t.simTime;
    if(reason){
      let sample=null,scope='live-terminal-state';
      if(reason==='simulation-fault'){
        sample=failureResourceSample(t);scope='failure-terminal-snapshot';
        if(sample&&(sample.simTime+1e-7<this.startedAt||sample.energyAccounting.revision!==this.revision))sample=null;
      }else if(!['reset-or-resource-reprepared','conditions-changed','gas-refilled-or-state-changed','energy-accounting-failed'].includes(reason))sample=resourceSample(t);
      if(!sample){sample=copy(this.lastValidResources);scope='last-measured-valid-state';}
      this.terminalResources=sample;this.resourceEvidence={scope,simTime:sample.simTime,terminal:scope!=='last-measured-valid-state'};
      this.failure={reason,elapsedS:Math.max(0,sample.simTime-this.startedAt),energyKWh:sample.energyKWh,gasKg:sample.gasMass,resourceScope:scope};
      return this.failure;
    }
    this.lastValidResources=resourceSample(t);
    if(elapsed-this.lastSample>=.5){this.lastSample=elapsed;this.samples.push({elapsedS:elapsed,position:{...t.position},speedKmh:t.speedKmh,energyKWh:t.energyKWh,gasKg:t.gasMass,chargePowerW:t.energyAccounting.chargePowerW,chargeLimitReason:t.energyAccounting.chargeLimitReason});if(this.samples.length>260)this.samples.shift();}
    return this.failure;
  }
  result(sim,reason){
    const current=sim.telemetry();this.check(sim,current);const t=this.terminalResources??current,end=snapshotBudget(t),start=snapshotBudget(this.initial),work=Object.fromEntries(Object.keys(end).map(k=>[k,end[k]-start[k]]));
    const reserveOK=!this.finite||(t.energyKWh>=RESOURCE_ROUTE.minimumFinishKWh&&t.gasMass>=RESOURCE_ROUTE.minimumGasKg);
    const completed=reason==='route-completed'&&!this.failure&&reserveOK;
    return{schema:'roadster-resource-route-1',recordId:this.recordId,identity:copy(this.identity),comparisonKey:this.comparisonKey,completed,finite:this.finite,reason:this.failure?.reason??(!reserveOK&&reason==='route-completed'?'finish-reserve-insufficient':reason),elapsedS:Math.max(0,t.simTime-this.startedAt),remainingKWh:t.energyKWh,gasRemainingKg:t.gasMass,gasUsedKg:t.onboardGasConsumedKg-this.initial.onboardGasConsumedKg,externalGasKg:t.externalGasSuppliedKg-this.initial.externalGasSuppliedKg,netEnergyJ:(this.initial.energyKWh-t.energyKWh)*3.6e6,work,balanceErrorJ:t.energyAccounting.balanceErrorJ,resourceEvidence:copy(this.resourceEvidence??{scope:'live-terminal-state',simTime:t.simTime,terminal:true}),firstFailure:copy(this.failure),samples:copy(this.samples),comparisonScope:'Matched build, route, full initial simulation snapshot and parameters; successful driver strategies, not a strict controller A/B test.'};
  }
}
export function comparableResourceRuns(a,b){
  return a?.schema==='roadster-resource-route-1'&&b?.schema===a.schema&&a.completed===true&&b.completed===true&&
    a.reason==='route-completed'&&b.reason==='route-completed'&&!a.firstFailure&&!b.firstFailure&&
    typeof a.identity?.initialState==='string'&&a.identity.initialState===b.identity?.initialState&&a.comparisonKey===b.comparisonKey&&
    [a,b].every(r=>['elapsedS','netEnergyJ','gasUsedKg','balanceErrorJ'].every(k=>Number.isFinite(r[k]))&&Math.abs(r.balanceErrorJ)<.02);
}
export function resourceRunDifference(current,previous){
  if(!comparableResourceRuns(current,previous))return null;
  return{elapsedS:current.elapsedS-previous.elapsedS,netWh:(current.netEnergyJ-previous.netEnergyJ)/3600,
    gasKg:current.gasUsedKg-previous.gasUsedKg,recoveredWh:(current.work.recoveredJ-previous.work.recoveredJ)/3600};
}
export function resourceVerdict(reason,english=false){const labels={
 'route-completed':['完成路线并停稳','Route completed and stopped'],
 'finish-reserve-insufficient':['到达终点，但剩余储备不足','Arrived, but finish reserve was insufficient'],
 'time-budget-exceeded':['超过 65 秒驾驶时间预算','65-second driving-time budget exceeded'],
 'battery-exhausted':['电池耗尽','Battery exhausted'],
 'conditions-changed':['物理条件已改变；本次不可比','Physical conditions changed; run is not comparable'],
 'gas-refilled-or-state-changed':['补气或改写状态；本次任务作废','Gas refill or state edit; mission invalidated'],
 'reset-or-resource-reprepared':['已复位或重新准备资源','Reset or resources re-prepared'],
 'external-gas-supply':['使用了外部供气','External gas was supplied'],
 'energy-accounting-failed':['电量收支校验失败','Battery accounting check failed'],
 'simulation-fault':['仿真触发保护；本次任务无效','Simulation safety triggered; run invalid'],
 'collision':['发生车体碰撞；重新准备后再试','Body collision; prepare a new attempt'],
 'recording-ended-externally':['记录已在其他面板结束','Recording ended in another panel'],
 'pilot-ended':['驾驶者提前结束','Ended by driver']};return labels[reason]?.[english?1:0]??reason;}
