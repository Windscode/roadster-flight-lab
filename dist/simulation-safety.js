/** Bounded diagnostic history. Not part of the physical integrator or a
 * continuation snapshot: it must never change a replay's forces or timing. */
const journals=new WeakMap();
const HISTORY_STEPS=240;
const vector=v=>({x:v.x,y:v.y,z:v.z});

export function serializableDiagnostic(value,seen=new Set(),depth=0){
  if(typeof value==='number')return Number.isFinite(value)?value:{nonFinite:Number.isNaN(value)?'NaN':value>0?'Infinity':'-Infinity'};
  if(value==null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='undefined')return{unavailable:'undefined'};
  if(typeof value!=='object')return{unavailable:typeof value};
  if(depth>10)return{unavailable:'depth-limit'};
  if(seen.has(value))return{unavailable:'cyclic-reference'};
  seen.add(value);
  const result=Array.isArray(value)?value.slice(0,600).map(v=>serializableDiagnostic(v,seen,depth+1)):Object.fromEntries(Object.entries(value).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).slice(0,180).map(([k,v])=>[k,serializableDiagnostic(v,seen,depth+1)]));
  seen.delete(value);return result;
}

export function contactDiagnostics(sim){
  return sim.world.contacts.filter(c=>c.bi===sim.body||c.bj===sim.body).map(c=>{
    const a=c.bi.position.vadd(c.ri),b=c.bj.position.vadd(c.rj),relative=b.vsub(a),other=c.bi===sim.body?c.bj:c.bi;
    return{objectId:other.userData?.id??'unnamed-static',kind:other.userData?.kind??'unknown',vehicleShape:sim.body.shapes.indexOf(c.bi===sim.body?c.si:c.sj),
      pointWorld:vector(c.bi===sim.body?a:b),normal:vector(c.ni),normalFromBody:c.bi===sim.body,penetrationM:Math.max(0,-relative.dot(c.ni)),normalForceN:c.multiplier??0};
  });
}

export function physicalDiagnosticSnapshot(sim){
  const b=sim.body,omega=b.quaternion.conjugate().vmult(b.angularVelocity);
  return serializableDiagnostic({schema:'roadster-physical-diagnostic',version:1,scope:'last physical pose, velocities, resources, actuators, wheel and contact state; diagnostic, not a full Cannon continuation snapshot',
    step:sim._stepCount,simTime:sim.simTime,scenario:sim.scenario,worldType:sim.worldType,mode:sim.mode,stabilizationMode:sim.stabilizationMode,
    position:vector(b.position),velocity:vector(b.velocity),quaternion:{...vector(b.quaternion),w:b.quaternion.w},angularVelocity:vector(b.angularVelocity),massKg:b.mass,
    energy:{translationJ:.5*b.mass*b.velocity.lengthSquared(),rotationJ:.5*(b.inertia.x*omega.x**2+b.inertia.y*omega.y**2+b.inertia.z*omega.z**2),wheelRotationJ:sim.wheelStates.reduce((s,w)=>s+.5*sim.params.wheelInertia*(w.angularVelocityRadS??0)**2,0),potentialJ:b.mass*sim.params.gravity*b.position.y,electricUsedKWh:sim._energyUsed,brakeDissipationJ:sim._brakeDissipationJ,tireDissipationJ:sim._tireDissipationJ},
    gas:{massKg:sim.gasMass,temperatureK:sim.gasTemperature,pressureBar:sim.pressureBar(),supplyMode:sim.params.supplyMode,onboardConsumedKg:sim._gasConsumedKg,externalSuppliedKg:sim._externalGasKg},
    input:sim._lastInput,nozzles:sim._nozzles.map(n=>({id:n.id,forceN:n.force,commandN:n.command,maxForceN:n.maxForce})),
    wheels:sim.wheelStates.map(w=>({id:w.id,contact:w.contact,objectId:w.contactObjectId??null,normalLoadN:w.normalLoadN,suspensionLengthM:w.suspensionLength,steerRad:w.steer,angularVelocityRadS:w.angularVelocityRadS,slipAngleRad:w.slipAngle,slipRatio:w.slipRatio,gripUse:w.gripUse,contactPointWorld:w.contactPointWorld??null})),
    contacts:contactDiagnostics(sim),desiredWrench:sim._desiredWrench,achievedWrench:sim._achievedWrench,maneuver:sim._maneuver,researchHeightControl:sim._researchHeightControl??null});
}

function get(sim){let journal=journals.get(sim);if(!journal){journal={history:[],lastValidPhysical:null,lastRawInput:null,failure:null};journals.set(sim,journal);}return journal;}
export function resetSafetyJournal(sim){const previous=get(sim);journals.set(sim,{history:[],lastValidPhysical:physicalDiagnosticSnapshot(sim),lastRawInput:null,failure:previous.failure});}
export function noteSafetyInput(sim,input){get(sim).lastRawInput=serializableDiagnostic(input);}
export function rememberValidStep(sim,dt){
  const journal=get(sim),state=physicalDiagnosticSnapshot(sim);journal.lastValidPhysical=state;
  journal.history.push({step:state.step,simTime:state.simTime,dt,input:state.input,rawInput:journal.lastRawInput,position:state.position,velocity:state.velocity,angularVelocity:state.angularVelocity,contacts:state.contacts,wheels:state.wheels});
  if(journal.history.length>HISTORY_STEPS)journal.history.shift();
}
export function preserveFailure(sim,{kind,reason,phase,nonFiniteFields=[]}){
  const journal=get(sim);let continuationSnapshot=null,continuationUnavailable=null;
  try{continuationSnapshot=sim.exportState();}catch(error){continuationUnavailable=String(error.message);}
  const report={schema:'roadster-simulation-failure',version:1,kind,reason,phase,triggerStep:sim._stepCount,triggerSimTime:sim.simTime,
    lastValidPhysical:journal.lastValidPhysical,triggerPhysical:physicalDiagnosticSnapshot(sim),lastRawInput:journal.lastRawInput,
    history:journal.history,historyFrequencyHz:journal.history.length&&journal.history.every(s=>Math.abs(s.dt-journal.history[0].dt)<1e-12)?1/journal.history[0].dt:null,historyLimitSteps:HISTORY_STEPS,nonFiniteFields,
    triggerContinuationSnapshot:continuationSnapshot,continuationUnavailable,
    safetyAction:'reset and pause requested; reset origin is not the failed terminal state'};
  journal.failure=serializableDiagnostic({...report,triggerContinuationSnapshot:null});
  // exportState already encoded and checked every value. Preserve it exactly;
  // diagnostic depth/length guards must not silently truncate a continuation.
  journal.failure.triggerContinuationSnapshot=continuationSnapshot;return journal.failure;
}
export function getFailureReport(sim){const value=get(sim).failure;return value?structuredClone(value):null;}
