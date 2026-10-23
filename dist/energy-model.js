// Engineering assumptions, not an identified production-vehicle battery map.
// W, J and dimensionless SOC are used internally; kWh appears only at the UI.
export const RESOURCE_DEFAULTS=Object.freeze({regenEnabled:true,regenEfficiency:.78,
  chargePowerLimitW:60000,regenTaperSoc:.95});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function validateResourceParams(p){
  if(typeof p.regenEnabled!=='boolean')throw RangeError('regenEnabled must be boolean');
  for(const [key,lo,hi]of [['regenEfficiency',.01,1],['chargePowerLimitW',0,1e6],['regenTaperSoc',.5,.9999],['batteryKWh',.001,1000]])
    if(!Number.isFinite(p[key])||p[key]<lo||p[key]>hi)throw RangeError('Invalid resource parameter: '+key);
  return p;
}
export function regenerationAcceptance(p,energyUsedKWh,dt){
  const capacityJ=p.batteryKWh*3.6e6,headroomJ=clamp(energyUsedKWh*3.6e6,0,capacityJ);
  const soc=clamp(1-headroomJ/capacityJ,0,1);
  const taper=clamp((1-soc)/(1-p.regenTaperSoc),0,1);
  const enabled=p.regenEnabled&&headroomJ>0&&dt>0;
  const electricalPowerW=enabled?Math.min(p.chargePowerLimitW*taper,headroomJ/dt,p.regenPower*p.regenEfficiency):0;
  return{soc,taper,electricalPowerW,mechanicalPowerW:electricalPowerW/p.regenEfficiency,
    mechanicalEnergyJ:headroomJ/p.regenEfficiency,
    reason:!p.regenEnabled?'disabled':headroomJ<=0?'battery-full':!p.chargePowerLimitW?'charge-disabled':taper<1?'soc-taper':'power-or-wheel-work'};
}
export function brakeBlend({totalBrakeRequest,serviceShares,wheels,totalLoad,charge,params:p}){
  // Retain a single service-brake budget and the 60/40 axle distribution.
  // Regeneration replaces part of it; it never adds another force budget.
  const budget=Math.max(0,totalBrakeRequest);
  const request=Math.min(budget,p.regenForce);
  const regenDemands=wheels.map((w,i)=>{
    const speed=Math.abs(w.angularVelocityRadS*p.wheelRadius),u=clamp((speed-.5)/1,0,1);
    const speedFade=u*u*(3-2*u);
    return w.contact&&charge.electricalPowerW>0?
      Math.min(budget*serviceShares[i],request*Math.max(0,w.normalLoadN)/totalLoad)*speedFade:0;
  });
  const sum=regenDemands.reduce((a,b)=>a+b,0);
  return{regenDemands,serviceDemands:serviceShares.map((s,i)=>Math.max(0,budget*s-regenDemands[i])),
    regenShares:regenDemands.map(v=>sum>0?v/sum:0)};
}
export function createEnergyLedger(initialEnergyJ,revision=0){
  return{schema:'roadster-energy-ledger-2',initialEnergyJ,revision,seconds:0,
    motorMechanicalJ:0,motorElectricalJ:0,motorLossJ:0,motorBrakingHeatJ:0,fanJ:0,auxiliaryJ:0,
    regenMechanicalJ:0,recoveredJ:0,regenLossJ:0,frictionBrakeJ:0,brakeHeatJ:0,
    tireDissipationJ:0,rollingLossJ:0,unservedAuxiliaryJ:0};
}
export function validateEnergyLedger(value){
  const keys=Object.keys(createEnergyLedger(0));
  if(!value||Object.keys(value).length!==keys.length||keys.some(k=>!(k in value))||value.schema!=='roadster-energy-ledger-2')throw Error('Incomplete resource snapshot');
  for(const k of keys)if(k!=='schema'&&(!Number.isFinite(value[k])||value[k]<0))throw Error('Invalid resource snapshot: '+k);
  if(!Number.isInteger(value.revision))throw Error('Invalid resource revision');
  if(Math.abs(value.regenMechanicalJ-value.recoveredJ-value.regenLossJ)>.02||Math.abs(value.motorElectricalJ-value.motorMechanicalJ-value.motorLossJ)>.02||Math.abs(value.brakeHeatJ-value.frictionBrakeJ-value.regenLossJ)>.02)throw Error('Resource work partition does not close');
  return structuredClone(value);
}
export function energySummary(ledger,remainingJ,capacityJ,drive={}){
  const grossJ=ledger.motorElectricalJ+ledger.fanJ+ledger.auxiliaryJ;
  return{...structuredClone(ledger),grossJ,netJ:grossJ-ledger.recoveredJ,remainingJ,soc:clamp(remainingJ/capacityJ,0,1),
    balanceErrorJ:ledger.initialEnergyJ-grossJ+ledger.recoveredJ-remainingJ,
    chargePowerW:drive.chargePowerW??0,chargePowerLimitW:drive.chargePowerLimitW??0,
    chargeLimitReason:drive.chargeLimitReason??'rest',
    scope:'Battery terminal balance and wheel-work partition. Opposing drive torque is unrecovered motor-braking heat, separate from motoring conversion loss and friction brake heat; no whole-world energy certificate.'};
}
