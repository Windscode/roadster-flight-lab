export const MODEL_VERSION='3.8.0';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Reduced engineering models. Parameters are explicit hypotheses, not OEM data.
export function rearWingPose(deployment){
 const u=clamp(deployment,0,1),incidenceRad=-.25*u,position={x:0,y:.325+.30*u,z:-2.065};
 return{position,incidenceRad,applicationPoint:{x:0,y:position.y-.05*Math.sin(incidenceRad),z:position.z+.05*Math.cos(incidenceRad)}};
}
export function roadWheelAngle(input,speed,p){
 // A road wheel needs both geometric curvature and a small tyre-slip angle.
 // The old pure bicycle-angle cap fell below two degrees at ordinary highway
 // speed, even before the compliant tyres could develop their target force.
 // Use a bounded 0.9 g road envelope, derated by available friction, with the
 // front/rear slip difference predicted by the same corner stiffness model.
 // These are steering references only: the contact solver still decides grip.
 const lateralG=Math.min(p.steeringAccelG,.85*p.tireMu);
 const load=(p.dryMass+Math.max(0,p.initialPressureBar*1e5*(p.tankLitres/1000)/(287.05*p.gasTemperatureK)))*p.gravity/4;
 const front=Math.max(1,p.cornerStiffnessFront)*Math.pow(Math.max(1,load)/5500,.9);
 const rear=Math.max(1,p.cornerStiffnessRear)*Math.pow(Math.max(1,load)/5500,.9);
 const slip=Math.max(0,load*lateralG*(1/front-1/rear));
 const max=p.steeringAssist?Math.min(.49,Math.atan(2.84*lateralG*p.gravity/(speed*speed+4))+slip):.49;
 return clamp(input,-1,1)*max;
}
export function nozzleExhaustVelocity(p,pressureBar,temperatureK){
 if(p.nozzleModel==='constant')return p.exhaustVelocity;
 const chamber=Math.min(p.regulatorBar,pressureBar),ratio=clamp(p.ambientPressureBar/Math.max(chamber,p.ambientPressureBar),0,1);
 const energy=2*p.gasGamma/(p.gasGamma-1)*287.05*Math.max(1,temperatureK)*(1-ratio**((p.gasGamma-1)/p.gasGamma));
 return Math.max(.1,p.nozzleVelocityEfficiency*Math.sqrt(Math.max(0,energy)));
}
export function hoverBudget(p,gasMass,temperatureK){
 if(p.supplyMode==='bench')return{seconds:Infinity,impulseNs:Infinity};
 let m=gasMass,T=temperatureK,seconds=0,impulseNs=0;const dm=gasMass/96;
 for(let i=0;i<96&&m>0;i++){
  const pressure=m*287.05*T/(p.tankLitres/1000)/1e5,weight=(p.dryMass+m)*p.gravity;
  const max=4*p.liftNozzleMax*clamp((pressure-p.ambientPressureBar)/(p.regulatorBar-p.ambientPressureBar),0,1);
  if(max<weight)break;
  const ve=nozzleExhaustVelocity(p,pressure,T),take=Math.min(m,dm);seconds+=take*ve/weight;impulseNs+=take*ve;
  const previous=m;m-=take;if(p.gasModel==='adiabatic')T*=Math.pow(Math.max(1e-9,m/previous),p.gasGamma-1);
 }
 return{seconds,impulseNs};
}
