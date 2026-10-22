// Cannon's generated slipForce is mu * reducedMass * |gravity| (newtons),
// while GSSolver clamps its lambda (newton seconds). Besides the missing dt,
// each contact point received the whole weight estimate. Use the actual normal
// impulse of that same contact and one circular two-tangent Coulomb budget.
// Normal contacts, stiffness, restitution and the tyre force model are intact.
export function installCoulombContactFriction(sim){
  const world=sim.world,np=world.narrowphase,source=new WeakMap(),create=np.createFrictionEquationsFromContact;
  np.createFrictionEquationsFromContact=function(contact,out){
    const start=out.length,result=create.call(this,contact,out);
    if(out.length>=start+2){
      const denominator=(world.frictionGravity||world.gravity).length()/(contact.bi.invMass+contact.bj.invMass||1);
      const coefficient=denominator>0?out[start].maxForce/denominator:0;
      const pair={contact,coefficient,equations:[out[start],out[start+1]]};
      for(const c of pair.equations)source.set(c,pair);
    }
    return result;
  };
  const solver=world.solver,original=solver.solve;
  solver.solve=function(dt,w){
    if(!w.frictionEquations.length)return original.call(this,dt,w);
    const originalEquations=this.equations,normal=originalEquations.filter(c=>!source.has(c)),pairs=[];
    for(const c of originalEquations){const pair=source.get(c);if(pair&&!pairs.includes(pair))pairs.push(pair);}
    if(!pairs.length)return original.call(this,dt,w);
    const equations=[...normal,...pairs.flatMap(p=>p.equations)],index=new Map(equations.map((c,i)=>[c,i]));
    for(const b of w.bodies)b.updateSolveMassProperties();
    const n=equations.length,lambda=new Float64Array(n),rhs=new Float64Array(n),inverse=new Float64Array(n);
    for(let i=0;i<n;i++){rhs[i]=equations[i].computeB(dt);inverse[i]=1/equations[i].computeC();}
    for(const b of w.bodies){b.vlambda.setZero();b.wlambda.setZero();}
    let iterations=0;
    const update=(i,min,max)=>{
      const c=equations[i],previous=lambda[i];
      const requested=previous+inverse[i]*(rhs[i]-c.computeGWlambda()-c.eps*previous);
      lambda[i]=Math.min(max,Math.max(min,requested));const change=lambda[i]-previous;c.addToWlambda(change);return Math.abs(change);
    };
    for(;iterations<this.iterations;iterations++){
      let change=0;
      for(let i=0;i<normal.length;i++)change+=update(i,equations[i].minForce,equations[i].maxForce);
      for(const p of pairs){
        const ni=index.get(p.contact),i=index.get(p.equations[0]),j=index.get(p.equations[1]);
        const limit=p.coefficient*Math.max(0,ni===undefined?0:lambda[ni]);
        change+=update(i,-limit,limit)+update(j,-limit,limit);
        const length=Math.hypot(lambda[i],lambda[j]);
        if(length>limit&&length>0)for(const k of [i,j]){const next=lambda[k]*limit/length,delta=next-lambda[k];lambda[k]=next;equations[k].addToWlambda(delta);change+=Math.abs(delta);}
      }
      if(change*change<this.tolerance*this.tolerance)break;
    }
    for(const b of w.bodies){b.vlambda.vmul(b.linearFactor,b.vlambda);b.velocity.vadd(b.vlambda,b.velocity);b.wlambda.vmul(b.angularFactor,b.wlambda);b.angularVelocity.vadd(b.wlambda,b.angularVelocity);}
    for(let i=0;i<n;i++)equations[i].multiplier=lambda[i]/dt;
    if(sim._integration){
      const metrics=sim._integration.contactFriction??(sim._integration.contactFriction={policy:'same-contact-coulomb-impulse-circle',solverSlices:0,pairs:0,maxBudgetExcessNs:0,normalImpulseNs:0,tangentImpulseNs:0});
      metrics.solverSlices++;
      for(const p of pairs){const ni=index.get(p.contact),normalImpulse=Math.max(0,ni===undefined?0:lambda[ni]),tangent=Math.hypot(...p.equations.map(c=>lambda[index.get(c)]));metrics.pairs++;metrics.normalImpulseNs+=normalImpulse;metrics.tangentImpulseNs+=tangent;metrics.maxBudgetExcessNs=Math.max(metrics.maxBudgetExcessNs,tangent-p.coefficient*normalImpulse);}
    }
    return iterations;
  };
}
