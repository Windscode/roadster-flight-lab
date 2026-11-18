// Shared reduced regulator map for the actual valves, authority display and
// maneuver/hover estimates. All pressures are absolute bar. With no positive
// chamber-to-ambient pressure difference, a passive nozzle cannot deliver
// thrust or drain the tank. This is not a measured production nozzle map.
export function nozzlePressureFactor(pressureBar,regulatorBar,ambientPressureBar){
  if(![pressureBar,regulatorBar,ambientPressureBar].every(Number.isFinite)||ambientPressureBar<0||regulatorBar<=ambientPressureBar)return 0;
  return Math.max(0,Math.min(1,(pressureBar-ambientPressureBar)/(regulatorBar-ambientPressureBar)));
}

// During a discharge slice P/P0 = (m/m0)^k, before heat flows back from the tank.
// Only mass above ambient equilibrium can escape through a passive valve.
export function deliverableGasMass(params,mass,pressureBar,requestedKg){
  if(requestedKg<=0||mass<=0||pressureBar<=params.ambientPressureBar)return 0;
  const exponent=params.gasModel==='adiabatic'?params.gasGamma:1;
  const drop=(pressureBar-params.ambientPressureBar)/pressureBar;
  // Concavity gives a cheap lower bound far from cutoff, including normal driving.
  if(requestedKg<=mass*drop/exponent)return requestedKg;
  const available=mass*(-Math.expm1(Math.log1p(-drop)/exponent));
  return Math.min(requestedKg,available);
}
