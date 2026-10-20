/** Static wrench certificate for the actual symmetric ten-nozzle layout.
 *
 * Four vertical jets have one free diagonal load split after Fy / Tx / Tz
 * have been imposed. Testing the whole feasible interval, rather than its
 * equal-front/rear candidate, retains that freedom when one jet is derated.
 * Side and axial opposing pairs cannot enlarge their signed force bounds.
 * This is a static allocation certificate; valves, momentum, gas depletion
 * and recovery trajectories are deliberately outside its claim.
 */
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const EPS=1e-7;
const geometryCache=new WeakMap();
export const TRIM_TOLERANCES=Object.freeze({forceN:.05,torqueNm:.05,boundN:EPS});

function geometry(nozzles){
  if(geometryCache.has(nozzles))return geometryCache.get(nozzles);
  if(nozzles.length!==10)return null;
  const a=Math.abs(nozzles[0].position.x),z=Math.abs(nozzles[0].position.z),h=-nozzles[4].position.y;
  const signs=[[-1,1],[1,1],[-1,-1],[1,-1]];
  if(!(a>0&&z>0&&h>=0))return null;
  const close=(x,y)=>Math.abs(x-y)<1e-9;
  for(let i=0;i<4;i++){
    const n=nozzles[i],s=nozzles[i+4],[sx,sz]=signs[i];
    if(!close(n.position.x,sx*a)||!close(n.position.z,sz*z)||!close(n.direction.x,0)||!close(n.direction.y,1)||!close(n.direction.z,0)||
      !close(s.position.z,sz*z)||!close(s.position.y,-h)||!close(s.direction.x,-sx)||!close(s.direction.y,0)||!close(s.direction.z,0))return null;
  }
  for(let i=8;i<10;i++)if(!close(nozzles[i].position.x,0)||!close(nozzles[i].position.y,0)||!close(nozzles[i].direction.x,0)||!close(nozzles[i].direction.y,0)||!close(nozzles[i].direction.z,i===8?1:-1))return null;
  const result={a,z,h};geometryCache.set(nozzles,result);return result;
}

export function staticWrenchFeasible(nozzles,maxes,desiredWrench){
  const g=geometry(nozzles);if(!g)throw new Error('Static trim certificate does not support this nozzle geometry');
  return intervalSolution(g,maxes,desiredWrench).feasible;
}

function intervalSolution(g,maxes,w){
  const [fx,fy,fz,tx,ty,tz]=w;
  const frontSide=(fx+ty/g.z)/2,rearSide=(fx-ty/g.z)/2;
  const frontLift=(fy-tx/g.z)/2,rearLift=(fy+tx/g.z)/2;
  const positiveXLift=(fy+(tz-g.h*fx)/g.a)/2;
  // t is front-left (+X) thrust. The other three follow from the wrench.
  const lower=Math.max(0,frontLift-maxes[0],positiveXLift-rearLift,positiveXLift-maxes[3]);
  const upper=Math.min(maxes[1],frontLift,maxes[2]-rearLift+positiveXLift,positiveXLift);
  const signedPairs=[[frontSide,-maxes[5],maxes[4]],[rearSide,-maxes[7],maxes[6]],[fz,-maxes[9],maxes[8]]];
  const feasible=lower<=upper+EPS&&signedPairs.every(([v,min,max])=>v>=min-EPS&&v<=max+EPS);
  const t=(lower+upper)/2;
  const forces=[frontLift-t,t,rearLift-positiveXLift+t,positiveXLift-t,
    Math.max(0,frontSide),Math.max(0,-frontSide),Math.max(0,rearSide),Math.max(0,-rearSide),Math.max(0,fz),Math.max(0,-fz)].map((v,i)=>clamp(v,0,maxes[i]));
  return{feasible,forces,diagonalIntervalN:{minimum:lower,maximum:upper},signedPairs};
}

function wrenchFromColumns(nozzles,forces){
  const result=Array(6).fill(0);nozzles.forEach((n,i)=>n.column.forEach((v,k)=>result[k]+=v*forces[i]));return result;
}

// Only used to describe an infeasible request's bounded residual. It does not
// decide feasibility and is not the vehicle's dynamic allocation algorithm.
function boundedResidualCandidate(nozzles,maxes,desired,initial){
  const scales=[22000,22000,22000,32000,32000,14000];
  const columns=nozzles.map((n,i)=>n.column.map((v,k)=>v*maxes[i]/scales[k]));
  const fractions=initial.map((v,i)=>maxes[i]>0?v/maxes[i]:0);
  const achieved=wrenchFromColumns(nozzles,initial),residual=desired.map((v,k)=>(v-achieved[k])/scales[k]);
  for(let pass=0;pass<96;pass++)for(let i=0;i<columns.length;i++){
    const c=columns[i],denom=c.reduce((s,v)=>s+v*v,0);if(denom<1e-20)continue;
    const delta=c.reduce((s,v,k)=>s+v*residual[k],0)/denom,next=clamp(fractions[i]+delta,0,1),change=next-fractions[i];
    fractions[i]=next;for(let k=0;k<6;k++)residual[k]-=c[k]*change;
  }
  return fractions.map((v,i)=>v*maxes[i]);
}

export function solveStaticWrench(nozzles,maxes,desiredWrench,{includeReserve=false}={}){
  if(maxes.length!==nozzles.length||maxes.some(v=>!Number.isFinite(v)||v<0)||desiredWrench.length!==6||!desiredWrench.every(Number.isFinite))throw new Error('Static trim requires finite non-negative capacities and a finite six-axis wrench');
  const g=geometry(nozzles);
  if(!g)throw new Error('Static trim certificate does not support this nozzle geometry');
  const solution=intervalSolution(g,maxes,desiredWrench),forces=solution.feasible?solution.forces:boundedResidualCandidate(nozzles,maxes,desiredWrench,solution.forces);
  const achieved=wrenchFromColumns(nozzles,forces),residual=desiredWrench.map((v,k)=>v-achieved[k]);
  const staticFeasible=solution.feasible&&residual.slice(0,3).every(v=>Math.abs(v)<=TRIM_TOLERANCES.forceN)&&residual.slice(3).every(v=>Math.abs(v)<=TRIM_TOLERANCES.torqueNm);
  const result={staticFeasible,method:'bounded-symmetric-wrench-interval-v1',requestedWrench:[...desiredWrench],achievedWrench:achieved,residualWrench:residual,
    forceResidualN:Math.hypot(...residual.slice(0,3)),torqueResidualNm:Math.hypot(...residual.slice(3)),tolerances:{...TRIM_TOLERANCES},
    diagonalIntervalN:solution.diagonalIntervalN,nozzles:nozzles.map((n,i)=>({id:n.id,forceN:forces[i],maximumN:maxes[i],remainingIncreaseN:maxes[i]-forces[i],remainingDecreaseN:forces[i],disabled:maxes[i]<=EPS,saturated:maxes[i]>EPS&&forces[i]>=maxes[i]-Math.max(.05,maxes[i]*.001)})),
    saturatedNozzles:nozzles.filter((n,i)=>maxes[i]>EPS&&forces[i]>=maxes[i]-Math.max(.05,maxes[i]*.001)).map(n=>n.id),
    dynamicRecovery:'not-evaluated',reserve:null,scope:'zero velocity, zero angular velocity, gravity wrench only; no aerodynamic, valve-lag or transient recovery certificate'};
  if(includeReserve&&staticFeasible){
    const axes=['forceX','forceY','forceZ','torqueX','torqueY','torqueZ'];result.reserve={method:'one-axis perturbation, other five wrench components held fixed',units:['N','N','N','N m','N m','N m'],axes:{},simultaneouslyAchievable:false,includesValveLag:false};
    for(let k=0;k<6;k++){
      const bound=nozzles.reduce((s,n,i)=>s+Math.abs(n.column[k])*maxes[i],0)+Math.abs(desiredWrench[k])+1;
      const limits={};for(const sign of [-1,1]){let lo=0,hi=bound;for(let n=0;n<30;n++){const m=(lo+hi)/2,w=[...desiredWrench];w[k]+=sign*m;if(intervalSolution(g,maxes,w).feasible)lo=m;else hi=m;}limits[sign>0?'positive':'negative']=lo;}
      result.reserve.axes[axes[k]]=limits;
    }
    result.reserve.bidirectionalTorqueNm=Object.fromEntries(['x','y','z'].map((a,k)=>[a,Math.min(result.reserve.axes[axes[k+3]].positive,result.reserve.axes[axes[k+3]].negative)]));
  }
  return result;
}
