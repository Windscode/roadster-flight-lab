// Read-only review of the 3.3 fixture and its report semantics. Does not edit dist.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
const frozenURL=new URL('./experiment-worker-3.3-reference.mjs',import.meta.url);
if(!existsSync(frozenURL))writeFileSync(frozenURL,readFileSync(new URL('../dist/experiment-worker.js',import.meta.url),'utf8').replaceAll("from './","from '../dist/"));
const {runExperiment}=await import(frozenURL);
const names=['physics.js','vehicle-models.js','experiment-worker.js','research-workbench.js','telemetry.js'];
const hashes=()=>Object.fromEntries(names.map(n=>[n,createHash('sha256').update(readFileSync(new URL('../dist/'+n,import.meta.url))).digest('hex')]));
const initialHashes=hashes(),dt=1/120,deg=180/Math.PI;
const results=[];
function audit(request){
 const captures=[],step=RoadsterSim.prototype.step;
 RoadsterSim.prototype.step=function(...args){
  const before={vy:this.body.velocity.y,position:{x:this.body.position.x,y:this.body.position.y,z:this.body.position.z},gas:this.gasMass,references:{position:{x:this._positionTarget.x,y:this._positionTarget.y,z:this._positionTarget.z},height:this._heightTarget,heading:this._headingTarget}};
  const t=step.apply(this,args),local=this.body.quaternion.conjugate().vmult(this.body.velocity),omega=this.body.quaternion.conjugate().vmult(this.body.angularVelocity);
  captures.push({t,before,longSpeed:local.z,horizontalSpeed:Math.hypot(t.velocity.x,t.velocity.z),forwardBeta:Math.atan2(local.x,local.z)*deg,bodyRollRate:omega.z,hullContact:this.world.contacts.some(c=>c.bi===this.body||c.bj===this.body)});return t;
 };
 let report;try{report=runExperiment(request);}finally{RoadsterSim.prototype.step=step;}
 const trace=captures.slice(-Math.round(report.input.duration/dt));let airSince=null,firstContact=null,stableSince=null,stableLanding=null,integratedRoll=0,referenceHeight=4,firstHeightFailure=null,continuousFailure=0,maxHeightError=0;
 let peakFlow=0,impulse=0,massFlowIntegral=0,maxResidual=0,perAxisResidual=Array(6).fill(0),saturatedSteps=0,bodyContacts=0,minMargin=Infinity;
 for(const c of trace){const {t}=c;
  if(!t.contactCount&&airSince===null)airSince=t.simTime;
  if(airSince!==null&&t.simTime-airSince>.15&&t.contactCount&&!firstContact)firstContact={time:t.simTime,contactCount:t.contactCount,preStepVerticalSpeed:c.before.vy,postStepVerticalSpeed:t.verticalSpeed,mode:t.mode,phase:t.maneuver?.phase};
  const stable=t.contactCount>=3&&t.mode==='drive'&&Math.abs(t.verticalSpeed)<.3&&Math.hypot(t.velocity.x,t.velocity.z)<.5&&Math.abs(t.rollDeg)<3&&Math.abs(t.pitchDeg)<3&&Math.hypot(t.angularVelocity.x,t.angularVelocity.y,t.angularVelocity.z)<.2;
  if(stable){stableSince??=t.simTime;if(t.simTime-stableSince>=.5&&!stableLanding&&firstContact)stableLanding={stableSince,confirmedAt:t.simTime};}else stableSince=null;
  integratedRoll+=c.bodyRollRate*dt*deg;peakFlow=Math.max(peakFlow,t.massFlowKgS);massFlowIntegral+=t.massFlowKgS*dt;impulse+=t.thrustN*dt;maxResidual=Math.max(maxResidual,t.allocationError);minMargin=Math.min(minMargin,t.thrustMargin);
  for(let i=0;i<6;i++)perAxisResidual[i]=Math.max(perAxisResidual[i],Math.abs(t.desiredWrench[i]-t.achievedWrench[i]));
  saturatedSteps+=Number(t.nozzles.some(n=>n.maxForce>1&&n.command/n.maxForce>.98));bodyContacts+=Number(c.hullContact);
  if(request.kind==='hover'){const e=t.heightWorld-referenceHeight;maxHeightError=Math.max(maxHeightError,Math.abs(e));continuousFailure=Math.abs(e)>.5?continuousFailure+dt:0;if(continuousFailure>.25&&firstHeightFailure===null)firstHeightFailure=t.simTime;}
 }
 const speedErrors=trace.map(c=>c.longSpeed*3.6-(request.speedKmh??80)),speeds=trace.map(c=>c.longSpeed*3.6),steerRows=trace.filter(c=>c.t.simTime>.9&&c.t.simTime<2.4),last=trace.at(-1).t;
 const metrics={reported:report.metrics,independentlyDerived:{initialControllerReferences:trace[0].before.references,initialPosition:trace[0].before.position,finalPosition:last.position,maxWorldHorizontalSpeedKmh:Math.max(...trace.map(c=>c.horizontalSpeed))*3.6,finalHorizontalDisplacementM:Math.hypot(last.position.x-trace[0].before.position.x,last.position.z-trace[0].before.position.z),forwardSpeedRangeKmh:[Math.min(...speeds),Math.max(...speeds)],speedRmseKmh:request.kind==='steer'?Math.sqrt(speedErrors.reduce((s,x)=>s+x*x,0)/speedErrors.length):null,steerPlateauRangeDeg:request.kind==='steer'&&steerRows.length?[Math.min(...steerRows.map(c=>c.t.steeringCentreDeg)),Math.max(...steerRows.map(c=>c.t.steeringCentreDeg))]:null,integratedBodyRollDeg:integratedRoll,firstContact,stableLanding,finalMode:last.mode,finalHeightM:last.heightWorld,maxHeightErrorM:request.kind==='hover'?maxHeightError:null,persistentHeightFailureSeconds:firstHeightFailure,peakFlowKgS:peakFlow,massFlowIntegralKg:massFlowIntegral,deliveredImpulseNs:impulse,maxAllocationResidualNormalized:maxResidual,maxPerAxisResidualNmOrN:perAxisResidual,nozzleSaturationTimeFraction:saturatedSteps/trace.length,minRatedThrustMargin:minMargin,hullContactSteps:bodyContacts,finalHeightTargetM:last.targetAltitude,overrides:report.appliedParams.steeringAssist}};
 results.push({request,metrics,reportHeader:{modelVersion:report.modelVersion,input:report.input,appliedParams:report.appliedParams}});
 return report;
}
for(const request of [
 {kind:'steer',speedKmh:80,angleDeg:2},
 {kind:'steer',speedKmh:160,angleDeg:5},
 {kind:'steer',speedKmh:160,angleDeg:5,params:{steeringAssist:true}},
 {kind:'steer',speedKmh:160,angleDeg:5,params:{steeringAssist:false}},
 {kind:'hover'},
 {kind:'hover',params:{supplyMode:'bench'}},
 {kind:'hover',params:{hoverHeight:10,supplyMode:'bench'}},
 {kind:'hover',params:{initialPressureBar:20}},
 {kind:'roll'},
 {kind:'roll',params:{initialPressureBar:20}},
 {kind:'rise'},
])audit(request);
const forward=new RoadsterSim();forward.body.quaternion.set(0,0,0,1);forward.body.velocity.set(1,0,10);const betaForward=forward.telemetry().bodySlipDeg;forward.body.velocity.set(1,0,-10);const betaReverse=forward.telemetry().bodySlipDeg;
const out={generatedAt:new Date().toISOString(),auditScope:'Fixture semantics and independent 120 Hz metric recomputation, not OEM validation',sourceHashesBefore:initialHashes,sourceHashesAfter:hashes(),fixtureFrozenAt:frozenURL.href,sideslipDefinitionProbe:{vx:1,vzForward:10,vzReverse:-10,reportedForwardDeg:betaForward,reportedReverseDeg:betaReverse,headingRelativeForwardDeg:Math.atan2(1,10)*deg,headingRelativeReverseDeg:Math.atan2(1,-10)*deg},results};
writeFileSync(new URL('./research-3.4-metric-audit.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({sourceChangedDuringRun:JSON.stringify(out.sourceHashesBefore)!==JSON.stringify(out.sourceHashesAfter),sideslipDefinitionProbe:out.sideslipDefinitionProbe,results:results.map(r=>({request:r.request,...r.metrics}))},null,2));
