/* Settings are scoped around a declared task fixture. The terminal record is
 * captured BEFORE this helper runs. Physical pose, velocity, time and gas mass
 * are never restored or refilled implicitly. */
const copy=v=>v===undefined?null:JSON.parse(JSON.stringify(v));
export function captureTaskSettings(sim){return{params:copy(sim.params),wind:copy(sim.getWind?.()),nozzleFault:copy(sim.telemetry().nozzleFault),observation:copy(sim.getObservation?.().configuration)};}
export function restoreTaskSettings(sim,settings,{reason='task-ended'}={}){
  if(!settings)return null;const before=sim.telemetry();sim.clearResearchHeightControl?.(reason);
  for(const [key,value]of Object.entries(settings.params??{}))sim.setParam(key,value,{refillGas:false});
  if(settings.wind)sim.setWind(copy(settings.wind));else sim.clearWind();
  if(settings.nozzleFault)sim.setNozzleFault(copy(settings.nozzleFault));else sim.clearNozzleFault();
  if(settings.observation)sim.setObservation(copy(settings.observation));
  sim.setMode(before.contactCount>=3?'drive':'hover');sim.setStabilizationMode('off');
  const after=sim.telemetry();return{reason,restored:['model parameter settings including gas supply mode','wind configuration','nozzle fault configuration','observation configuration'],retained:['terminal physical pose and velocity','simulation time','actual remaining gas mass; no refill'],authority:'pilot',supplyMode:after.supplyMode,gasRemainingKg:after.gasMass,wind:copy(after.wind),nozzleFault:copy(after.nozzleFault),physicalStateUnchanged:['position','velocity','quaternion','angularVelocity','simTime','gasMass'].every(k=>JSON.stringify(before[k])===JSON.stringify(after[k]))};
}
