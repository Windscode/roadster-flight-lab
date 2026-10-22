// Bounded, read-only accounting at the actual Cannon constraint solve. Work is
// impulse times the mean pre/post constraint velocity at unchanged lever arms.
// It isolates constraint work from gravity, suspension, tyres and integration.
const vec=v=>({x:v.x,y:v.y,z:v.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const kinetic=b=>{const w=b.quaternion.conjugate().vmult(b.angularVelocity);return .5*b.mass*dot(b.velocity,b.velocity)+.5*(b.inertia.x*w.x*w.x+b.inertia.y*w.y*w.y+b.inertia.z*w.z*w.z);};
const shapeName=(sim,index)=>index<0?'unresolved':index<4?['main-chassis','front-nose','rear-frame','cabin'][index]:'wheel-stop-'+(sim.wheelStates[index-4]?.id??index);

export function installContactLedger(sim){
  const solver=sim.world.solver,solve=solver.solve;
  solver.solve=function(dt,world){
    const b=sim.body,normal=world.contacts.filter(c=>c.bi===b||c.bj===b);
    if(!normal.length)return solve.call(this,dt,world);
    const beforeV=vec(b.velocity),beforeW=vec(b.angularVelocity),beforeK=kinetic(b);
    const result=solve.call(this,dt,world),afterV=vec(b.velocity),afterW=vec(b.angularVelocity);
    const work=equation=>{
      const jac=equation.bi===b?equation.jacobianElementA:equation.jacobianElementB;
      const pre=dot(jac.spatial,beforeV)+dot(jac.rotational,beforeW),post=dot(jac.spatial,afterV)+dot(jac.rotational,afterW);
      const impulse=(equation.multiplier??0)*dt;
      return {preVelocityMps:pre,postVelocityMps:post,impulseNs:impulse,workJ:impulse*(pre+post)*.5};
    };
    const integration=sim._integration;
    if(!integration)return result;
    const ledger=integration.contactLedger??(integration.contactLedger={schema:'roadster-contact-impulse-work',version:1,solverSlices:0,normalEquationCount:0,
      normalImpulseNs:0,normalWorkJ:0,frictionWorkJ:0,constraintKineticDeltaJ:0,workResidualJ:0,peakNormalForceN:0,
      wheelStopEquations:0,hullEquations:0,duplicatePointEquations:0,pairs:[],events:[],omittedEvents:0,
      workScope:'Constraint velocity jump at fixed pose only, before damping/external-force integration. Includes friction work; no claim of complete road/suspension energy closure.'});
    ledger.solverSlices++;ledger.normalEquationCount+=normal.length;
    let normalWork=0,frictionWork=0;
    const points=new Set();
    for(const c of normal){
      const isA=c.bi===b,other=isA?c.bj:c.bi,index=b.shapes.indexOf(isA?c.si:c.sj),staticShape=other.shapes.indexOf(isA?c.sj:c.si);
      const offset=isA?c.ri:c.rj,point=b.position.vadd(offset),w=work(c),objectId=other.userData?.id??'unnamed-static';
      const key=`${objectId}:${staticShape}:${index}`,signedNormal=isA?c.ni.negate():c.ni;
      const pointKey=key+':'+[point.x,point.y,point.z,signedNormal.x,signedNormal.y,signedNormal.z].map(x=>Math.round(x*1e8)).join(',');
      const duplicate=points.has(pointKey);points.add(pointKey);ledger.duplicatePointEquations+=Number(duplicate);
      let pair=ledger.pairs.find(p=>p.id===key);if(!pair){pair={id:key,objectId,staticShape,vehicleShape:index,vehiclePart:shapeName(sim,index),equations:0,normalImpulseNs:0,normalWorkJ:0,peakNormalForceN:0};ledger.pairs.push(pair);}
      pair.equations++;pair.normalImpulseNs+=w.impulseNs;pair.normalWorkJ+=w.workJ;pair.peakNormalForceN=Math.max(pair.peakNormalForceN,c.multiplier??0);
      ledger.normalImpulseNs+=w.impulseNs;normalWork+=w.workJ;ledger.peakNormalForceN=Math.max(ledger.peakNormalForceN,c.multiplier??0);
      if(index>=4)ledger.wheelStopEquations++;else if(index>=0)ledger.hullEquations++;
      const separation=c.bj.position.vadd(c.rj).vsub(c.bi.position.vadd(c.ri)).dot(c.ni);
      if(ledger.events.length<32)ledger.events.push({slice:integration.completedSubsteps,timeS:sim.simTime,dtS:dt,pairId:key,objectId,staticShape,vehicleShape:index,vehiclePart:shapeName(sim,index),pointWorld:vec(point),normalOnVehicle:vec(signedNormal),penetrationBeforeSolveM:Math.max(0,-separation),normalForceN:c.multiplier??0,duplicatePoint:duplicate,...w});
      else ledger.omittedEvents++;
    }
    for(const c of world.frictionEquations)if(c.bi===b||c.bj===b)frictionWork+=work(c).workJ;
    const delta=kinetic(b)-beforeK;ledger.normalWorkJ+=normalWork;ledger.frictionWorkJ+=frictionWork;ledger.constraintKineticDeltaJ+=delta;ledger.workResidualJ+=delta-normalWork-frictionWork;
    return result;
  };
}
