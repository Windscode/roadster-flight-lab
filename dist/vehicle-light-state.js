// Presentation only. These thresholds are simulation design choices, not
// undocumented Tesla lamp-control specifications. No force or gas is changed.
export function resolveVehicleLampMode(selection='auto',night=false){
  if(!['auto','off','drl','low-beam'].includes(selection))throw RangeError('Unknown vehicle lamp selection');
  return selection==='auto'?(night?'low-beam':'drl'):selection;
}
export function vehicleBrakeSignal(t={},previous=false){
  const service=(t.brake??t.brakeInput??t.driverInput?.brake??0)>.02;
  const moving=Math.abs(t.forwardSpeedKmh??t.speedKmh??0)>2;
  const deceleration=-(t.longitudinalAcceleration??0)*Math.sign(t.forwardSpeedKmh??1);
  // Rolling resistance and aerodynamic drag can slow the car on their own.
  // A friction top-up to lift-off braking still warrants the deceleration signal.
  const detailed=t.wheelStates?.some(w=>Number.isFinite(w.serviceBrakeTorqueNm));
  const retarding=detailed?t.wheelStates.some(w=>w.contact&&(w.serviceBrakeTorqueNm+w.regenBrakeTorqueNm)>1):
    (t.driveAccounting?.totalRetardingForceN??t.regenForceN??0)>10;
  const regenerative=retarding&&moving&&deceleration>(previous?.6:.9);
  return service||regenerative;
}
