// 3.21 is a new implementation on the recovered 3.19 kernel, not recovered 3.20.
// The original rigid-body/contact/control model is retained, with bounded
// fixes documented in the current release.
import {RoadsterSim as Kernel,DEFAULT_PARAMS as KERNEL_PARAMS} from './physics-kernel-319.js';
import {applyResourceWheels} from './resource-wheels.js';
import {AUXILIARY_POWER_W,RESOURCE_DEFAULTS,validateResourceParams,createEnergyLedger,validateEnergyLedger,energySummary} from './energy-model.js';
import {resetSafetyJournal} from './simulation-safety.js';
export {PHYSICS_HZ,TELEMETRY_HZ,SCENARIOS} from './physics-kernel-319.js';
export const DEFAULT_PARAMS=Object.freeze({...KERNEL_PARAMS,...RESOURCE_DEFAULTS});
const clone=value=>structuredClone(value);
export class RoadsterSim extends Kernel{
  constructor(params={},options={}){super(validateResourceParams({...DEFAULT_PARAMS,...params}),options);}
  reset(scenario='free'){
    const result=super.reset(scenario);
    if(!Object.hasOwn(this,'_resourceLedger')){
      Object.defineProperty(this,'_resourceLedger',{value:null,writable:true});
      Object.defineProperty(this,'_resourceSlice',{value:null,writable:true});
    }
    this._resourceLedger=createEnergyLedger(this.params.batteryKWh*3.6e6);
    this._resourceSlice=null;resetSafetyJournal(this);return result;
  }
  setParam(key,value,options){
    if(key in RESOURCE_DEFAULTS){
      const next={...this.params,[key]:value};validateResourceParams(next);this.params[key]=value;return;
    }
    return super.setParam(key,value,options);
  }
  prepareEnergy(remainingKWh){
    if(!Number.isFinite(remainingKWh)||remainingKWh<0||remainingKWh>this.params.batteryKWh)throw RangeError('Energy must be within physical battery capacity');
    if(this.body.velocity.length()>.45||this._maneuver)throw Error('Prepare resources only at a stopped initial state');
    this._energyUsed=this.params.batteryKWh-remainingKWh;
    this._hasPower=remainingKWh>0;
    this._resourceLedger=createEnergyLedger(remainingKWh*3.6e6,(this._resourceLedger?.revision??0)+1);
    resetSafetyJournal(this);
  }
  _wheels(dt,input){return applyResourceWheels.call(this,dt,input);}
  _suction(dt){
    // Reserve the wheel work already solved plus the 800 W auxiliary load.
    // When the battery runs out the fan force cannot spend unprovided energy.
    const rated=this.params.fanPower,before=this._energyUsed;
    const remaining=Math.max(0,(this.params.batteryKWh-before)*3.6e6-this._motorWork);
    // One declared auxiliary supply powers valve/control electronics and the
    // wing actuator. Do not grant a full slice of powered actuation for an
    // arbitrarily small positive battery remainder. The sub-slice cutoff is
    // conservative by at most this integration slice; no hidden energy source
    // or pose correction is used. _aero still books the delivered remainder.
    this._hasPower=remaining>=AUXILIARY_POWER_W*dt;
    const available=Math.max(0,remaining-AUXILIARY_POWER_W*dt);
    this.params.fanPower=Math.min(rated,available/dt);
    try{super._suction(dt);}finally{this.params.fanPower=rated;}
    if(this._resourceSlice)this._resourceSlice.fanJ=Math.max(0,(this._energyUsed-before)*3.6e6);
  }
  _aero(dt){
    const before=this._energyUsed,requested=AUXILIARY_POWER_W*dt;
    super._aero(dt);
    const available=Math.max(0,(this.params.batteryKWh-before)*3.6e6-this._motorWork);
    const delivered=Math.min(requested,available);
    this._energyUsed=before+delivered/3.6e6;
    if(this._resourceSlice){this._resourceSlice.auxiliaryJ=delivered;this._resourceSlice.unservedAuxiliaryJ=requested-delivered;}
  }
  _advanceContactSlice(dt,raw,observation=true){
    this._resourceSlice={dt,tireBefore:this._tireDissipationJ,fanJ:0,auxiliaryJ:0,unservedAuxiliaryJ:0};
    super._advanceContactSlice(dt,raw,observation);
    this._settleEnergySlice();
  }
  _sanity(normalize=true,phase='after-fixed-step'){
    // The kernel captures the failed terminal state before resetting it. Book
    // the completed slice first so that snapshot carries the same energy as
    // its body/actuator state, then allow the original failure lifecycle to run.
    if(phase==='after-fixed-step'||phase==='after-contact-substep')this._settleEnergySlice();
    return super._sanity(normalize,phase);
  }
  _settleEnergySlice(){
    if(!this._resourceSlice)return;
    const a=this._driveAccounting,l=this._resourceLedger,s=this._resourceSlice;
    l.seconds+=s.dt;l.motorMechanicalJ+=a.mechanicalWorkJ;l.motorElectricalJ+=a.electricalWorkJ;
    l.motorLossJ+=Math.max(0,a.electricalWorkJ-a.mechanicalWorkJ);
    l.motorBrakingHeatJ+=a.motorBrakingWorkJ??0;
    l.fanJ+=s.fanJ;l.auxiliaryJ+=s.auxiliaryJ;l.unservedAuxiliaryJ+=s.unservedAuxiliaryJ;
    l.regenMechanicalJ+=a.regenMechanicalWorkJ??0;l.recoveredJ+=a.electricalRecoveredWorkJ??0;
    l.regenLossJ+=a.regenConversionLossJ??0;l.frictionBrakeJ+=a.frictionBrakeWorkJ??0;
    l.rollingLossJ+=a.rollingLossWorkJ??0;
    l.brakeHeatJ+=(a.frictionBrakeWorkJ??0)+(a.regenConversionLossJ??0);
    l.tireDissipationJ+=Math.max(0,this._tireDissipationJ-s.tireBefore);
    this._resourceSlice=null;
  }
  exportState(){
    const snapshot=super.exportState();
    snapshot.resourceAccounting=this._resourceLedger?clone(this._resourceLedger):createEnergyLedger(Math.max(0,this.params.batteryKWh-this._energyUsed)*3.6e6);
    return snapshot;
  }
  importState(snapshot,options){
    // Validate before mutating the live car. The kernel continues to reject
    // cross-version execution and to validate every original physical field.
    const ledger=validateEnergyLedger(snapshot?.resourceAccounting);
    validateResourceParams(snapshot.params);
    const remaining=(snapshot.params.batteryKWh-snapshot.state?._energyUsed)*3.6e6;
    const summary=energySummary(ledger,remaining,snapshot.params.batteryKWh*3.6e6);
    if(!Number.isFinite(remaining)||remaining<-.01||remaining>snapshot.params.batteryKWh*3.6e6+.01||Math.abs(summary.balanceErrorJ)>.02)throw Error('Battery snapshot does not close');
    const result=super.importState(snapshot,options);this._resourceLedger=ledger;this._resourceSlice=null;resetSafetyJournal(this);return result;
  }
  telemetry(){
    const result=super.telemetry();
    const remaining=Math.max(0,this.params.batteryKWh-this._energyUsed)*3.6e6;
    result.energyAccounting=energySummary(this._resourceLedger??createEnergyLedger(remaining),remaining,this.params.batteryKWh*3.6e6,this._driveAccounting);
    result.electricalSupply={controlPowered:this._hasPower,auxiliaryDemandW:AUXILIARY_POWER_W,fanSpinFraction:this._fanLevel,
      policy:'reserve-full-auxiliary-slice-before-powered-actuation',scope:'Lumped auxiliary supply; cutoff is conservative within one integration slice.'};
    return result;
  }
}
