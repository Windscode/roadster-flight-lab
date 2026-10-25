// Shared reduced regulator map for the actual valves, authority display and
// maneuver/hover estimates. All pressures are absolute bar. With no positive
// chamber-to-ambient pressure difference, a passive nozzle cannot deliver
// thrust or drain the tank. This is not a measured production nozzle map.
export function nozzlePressureFactor(pressureBar,regulatorBar,ambientPressureBar){
  if(![pressureBar,regulatorBar,ambientPressureBar].every(Number.isFinite)||ambientPressureBar<0||regulatorBar<=ambientPressureBar)return 0;
  return Math.max(0,Math.min(1,(pressureBar-ambientPressureBar)/(regulatorBar-ambientPressureBar)));
}
