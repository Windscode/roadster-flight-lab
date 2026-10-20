// Sustained numerical circles complement, rather than replace, the short live
// input protocols. No body state is assigned after the declared rolling start.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim as Current} from '../dist/physics.js';
import {RoadsterSim as Before} from './fixtures/baseline-3.10/physics.js';

const DT=1/120,DEG=180/Math.PI,DURATION=40,WINDOW_START=35;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const average=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const stats=v=>v.length?{mean:average(v),min:Math.min(...v),max:Math.max(...v),range:Math.max(...v)-Math.min(...v),rms:Math.sqrt(average(v.map(x=>x*x)))}:null;
const slope=(times,values)=>{if(!times.length)return null;const mt=average(times),mv=average(values);return values.reduce((n,v,i)=>n+(times[i]-mt)*(v-mv),0)/times.reduce((n,t)=>n+(t-mt)**2,0);};
function circleFit(points){
  if(points.length<3)return null;
  const ox=average(points.map(p=>p[0])),oz=average(points.map(p=>p[1])),M=Array.from({length:3},()=>[0,0,0,0]);
  for(const [x0,z0]of points){const x=x0-ox,z=z0-oz,v=[x,z,1],y=-(x*x+z*z);for(let i=0;i<3;i++){for(let j=0;j<3;j++)M[i][j]+=v[i]*v[j];M[i][3]+=v[i]*y;}}
  for(let k=0;k<3;k++){let p=k;for(let i=k+1;i<3;i++)if(Math.abs(M[i][k])>Math.abs(M[p][k]))p=i;[M[p],M[k]]=[M[k],M[p]];if(Math.abs(M[k][k])<1e-10)return null;const d=M[k][k];for(let j=k;j<4;j++)M[k][j]/=d;for(let i=0;i<3;i++)if(i!==k){const q=M[i][k];for(let j=k;j<4;j++)M[i][j]-=q*M[k][j];}}
  const cx=-M[0][3]/2,cz=-M[1][3]/2,r=Math.sqrt(cx*cx+cz*cz-M[2][3]);
  return{centreXM:cx+ox,centreZM:cz+oz,radiusM:r,radialResidualRmsM:Math.sqrt(average(points.map(([x,z])=>(Math.hypot(x-ox-cx,z-oz-cz)-r)**2)))};
}
const wheelIds=['FR','FL','RR','RL'];
const wheelFields=['normalLoadN','alphaDeg','longitudinalSlip','frictionUtilization','longitudinalForceN','lateralForceN','roadWheelAngleDeg','angularSpeedRadS','tcsFactor','tcsActive','corneringDriveScale','corneringTractionActive','absPressure','absActive'];
const columns=['elapsedS','xM','zM','speedKmh','speedErrorKmh','steerInput','throttleInput','brakeInput','wheelCentreDeg','yawRateDegS','bodyBetaDeg','lateralAccelerationMps2','wheelContacts','rigidContacts','torqueBudgetNm','postTcsTorqueRequestNm','actualMotorPowerW',...wheelIds.flatMap(id=>wheelFields.map(field=>id+'_'+field))];
const wheelValues=w=>[w.normalLoadN,w.slipAngle*DEG,w.slipRatio,w.gripUse,w.longitudinalForceN,w.lateralForceN,w.steer*DEG,w.angularVelocityRadS,w.tcsFactor,Number(w.tcsActive),w.corneringDriveScale??1,Number(w.corneringTractionActive||false),w.absPressure,Number(w.absActive)];
const thresholds={windowS:5,maxAbsoluteSpeedErrorKmh:.5,speedRangeKmh:.5,wheelCentreRangeDeg:.05,yawRateRangeDegS:.1,bodyBetaRangeDeg:.1,maxAbsoluteYawSlopeDegS2:.02,maxAbsoluteBetaSlopeDegS:.02,maxCircleRadialResidualRmsM:.25,minimumWheelContacts:4,maximumRigidContactSteps:0};
const sourceNames=['dist/physics.js','dist/tire-dynamics.js','dist/vehicle-models.js','qa/fixtures/baseline-3.10/physics.js','qa/fixtures/baseline-3.10/tire-dynamics.js','qa/fixtures/baseline-3.10/vehicle-models.js','qa/check-steady-circles-3.11.mjs'];
const sourceSha256=Object.fromEntries(sourceNames.map(name=>[name,createHash('sha256').update(fs.readFileSync(new URL('../'+name,import.meta.url))).digest('hex')]));
const outDir=new URL('./steady-circles-3.11/',import.meta.url);fs.mkdirSync(outDir,{recursive:true});
const results=[];
for(const speedKmh of [54,90])for(const surface of ['dry','wet'])for(const [version,Sim]of [['3.10',Before],['3.11',Current]]){
  const angleDeg=speedKmh===54?2:.8,params={roadSurface:surface,steeringAssist:false,tractionAssist:true,absEnabled:true,supplyMode:'bench'};
  const sim=new Sim(params);
  // Keep the original floor/contact material and remove the city's obstacles
  // only for this explicitly flat numerical test, never from the application.
  for(const b of [...sim.world.bodies])if(b!==sim.body&&b.userData?.id!=='ground')sim.world.removeBody(b);
  sim.body.position.set(-320,.62,0);
  for(let k=0;k<240;k++)sim.advanceFixed({},DT);
  sim.body.velocity.set(0,0,speedKmh/3.6);
  for(const w of sim.wheelStates)w.angularVelocityRadS=(speedKmh/3.6)/sim.params.wheelRadius;
  const initial=sim.telemetry(),rows=[],last=[],all=[];let integral=0,previousPosition={...initial.position},pathLength=0,peakPower=0,peakTorqueExcess=0,peakGrip=0,fault=null,contactLossSteps=0,rigidContactSteps=0;
  for(let k=0;k<DURATION/DT;k++){
    const elapsed=k*DT,v=Math.hypot(sim.body.velocity.x,sim.body.velocity.z),error=speedKmh/3.6-v;
    const feedForward=.5*sim.params.airDensity*sim.params.dragArea*v*v+sim.body.mass*sim.params.gravity*.011;
    const driveLimit=Math.min(sim.params.maxMotorForce,sim.params.motorPower/Math.max(8,v));
    const request=feedForward+sim.body.mass*(1.6*error+.6*integral);
    if(request<driveLimit&&request>-sim.params.brakeForce||request*error<0)integral=clamp(integral+error*DT,-6,6);
    const phase=clamp(elapsed-5,0,1),smooth=phase*phase*(3-2*phase);
    const input={steer:angleDeg/DEG/.49*smooth,throttle:request>=0?clamp(request/driveLimit,0,1):0,brake:request<0?clamp(-request/sim.params.brakeForce,0,1):0};
    // Convert a force request to the raw pedal correctly when the shared motor
    // is power-limited: the public physics layer itself applies that power cap.
    if(request>=0)input.throttle=clamp(request/sim.params.maxMotorForce,0,1);
    const beforeVelocity=sim.body.velocity.clone(),t=sim.advanceFixed(input,DT);
    const speed=Math.hypot(t.velocity.x,t.velocity.z)*3.6,bodyRight=sim.body.quaternion.vmult({x:1,y:0,z:0});
    const acceleration=sim.body.velocity.vsub(beforeVelocity).scale(1/DT).dot(bodyRight),accounting=t.driveAccounting;
    const rigid=sim.world.contacts.filter(c=>c.bi===sim.body||c.bj===sim.body).length;
    const record={elapsed:elapsed+DT,x:t.position.x,z:t.position.z,speed,speedError:speed-speedKmh,wheelCentre:t.steeringCentreDeg,yaw:t.angularVelocity.y*DEG,beta:t.bodySlipDeg,lateralAcceleration:acceleration,contacts:t.contactCount,rigid,input,wheels:t.wheelStates.map(wheelValues),accounting};
    all.push(record);if(k>=WINDOW_START/DT)last.push(record);
    pathLength+=Math.hypot(t.position.x-previousPosition.x,t.position.z-previousPosition.z);previousPosition={...t.position};
    peakPower=Math.max(peakPower,accounting.mechanicalPowerW);peakTorqueExcess=Math.max(peakTorqueExcess,accounting.actualTorqueNm-accounting.torqueBudgetNm);peakGrip=Math.max(peakGrip,...t.wheelStates.map(w=>w.gripUse));contactLossSteps+=Number(t.contactCount<4);rigidContactSteps+=Number(rigid>0);
    // Export only table values at 5 Hz before the evaluation window, 20 Hz
    // within it. Full 120 Hz unrounded values above determine all statistics.
    if(k%(elapsed<WINDOW_START?24:6)===0){const row=[record.elapsed,t.position.x,t.position.z,speed,record.speedError,input.steer,input.throttle,input.brake,t.steeringCentreDeg,record.yaw,record.beta,acceleration,t.contactCount,rigid,accounting.torqueBudgetNm,accounting.postTcsTorqueNm,accounting.mechanicalPowerW,...record.wheels.flat()];rows.push(row.map(v=>typeof v==='number'?Number(v.toFixed(6)):v));}
    if(t.fault){fault=t.fault;break;}
  }
  const times=last.map(r=>r.elapsed),speedStats=stats(last.map(r=>r.speed)),speedError=stats(last.map(r=>r.speedError)),yaw=stats(last.map(r=>r.yaw)),beta=stats(last.map(r=>r.beta)),wheelCentre=stats(last.map(r=>r.wheelCentre));
  const fit=circleFit(last.map(r=>[r.x,r.z]));
  const metrics={windowStartS:WINDOW_START,windowEndS:DURATION,windowSamples:last.length,speedKmh:speedStats,speedErrorKmh:speedError,yawRateDegS:yaw,bodyBetaDeg:beta,wheelCentreDeg:wheelCentre,yawSlopeDegS2:slope(times,last.map(r=>r.yaw)),betaSlopeDegS:slope(times,last.map(r=>r.beta)),lateralAccelerationMps2:stats(last.map(r=>r.lateralAcceleration)),throttle:stats(last.map(r=>r.input.throttle)),brake:stats(last.map(r=>r.input.brake)),circleFit:fit,curvatureRadiusM:last.length?average(last.map(r=>r.speed/3.6))/Math.abs(average(last.map(r=>r.yaw))/DEG):null,
    tcsActiveWheelSeconds:last.reduce((n,r)=>n+r.wheels.filter(w=>w[9]).length*DT,0),corneringTcsActiveWheelSeconds:last.reduce((n,r)=>n+r.wheels.filter(w=>w[11]).length*DT,0),minimumTcsFactor:last.length?Math.min(...last.flatMap(r=>r.wheels.map(w=>w[8]))):null,minimumCorneringDriveScale:last.length?Math.min(...last.flatMap(r=>r.wheels.map(w=>w[10]))):null,
    minimumWheelContacts:last.length?Math.min(...last.map(r=>r.contacts)):null,rigidContactSteps:last.filter(r=>r.rigid>0).length,wheels:Object.fromEntries(wheelIds.map((id,i)=>[id,Object.fromEntries(wheelFields.map((field,j)=>[field,stats(last.map(r=>r.wheels[i][j]))]))]))};
  const checks={completeWindow:last.length===5/DT,noFault:fault===null,fourWheelContact:metrics.minimumWheelContacts===4,noRigidContact:metrics.rigidContactSteps===0,
    speedError:!!speedError&&Math.max(Math.abs(speedError.min),Math.abs(speedError.max))<=thresholds.maxAbsoluteSpeedErrorKmh,
    speedVariation:!!speedStats&&speedStats.range<=thresholds.speedRangeKmh,wheelAngleVariation:!!wheelCentre&&wheelCentre.range<=thresholds.wheelCentreRangeDeg,
    yawVariation:!!yaw&&yaw.range<=thresholds.yawRateRangeDegS,betaVariation:!!beta&&beta.range<=thresholds.bodyBetaRangeDeg,
    yawTrend:metrics.yawSlopeDegS2!==null&&Math.abs(metrics.yawSlopeDegS2)<=thresholds.maxAbsoluteYawSlopeDegS2,betaTrend:metrics.betaSlopeDegS!==null&&Math.abs(metrics.betaSlopeDegS)<=thresholds.maxAbsoluteBetaSlopeDegS,
    circularArc:!!fit&&fit.radialResidualRmsM<=thresholds.maxCircleRadialResidualRmsM};
  const id=surface+'-'+speedKmh+'-'+version,curveFile='qa/steady-circles-3.11/'+id+'.json';
  const result={id,version,surface,targetSpeedKmh:speedKmh,targetWheelCentreDeg:angleDeg,appliedParams:sim.params,initial:{position:initial.position,velocity:initial.velocity,quaternion:initial.quaternion,massKg:initial.mass,wheelAngularSpeedsRadS:initial.wheelStates.map(w=>w.angularVelocityRadS)},steady:Object.values(checks).every(Boolean),checks,metrics,wholeRun:{durationS:all.at(-1)?.elapsed??0,pathLengthM:pathLength,peakMotorPowerW:peakPower,peakMotorTorqueBudgetExcessNm:peakTorqueExcess,peakFrictionUtilization:peakGrip,contactLossSteps,rigidContactSteps,fault},curveFile};
  fs.writeFileSync(new URL(id+'.json',outDir),JSON.stringify({id,sourceSha256,columns,sampling:'120 Hz physics/statistics; 5 Hz exported before 35 s, 20 Hz from 35–40 s; exported tables rounded to six decimal places only.',rows})+'\n');
  results.push(result);
  console.log(JSON.stringify({id,steady:result.steady,speedKmh:speedStats,yawDegS:yaw,betaDeg:beta,radiusM:fit?.radiusM,failedChecks:Object.keys(checks).filter(key=>!checks[key])}));
}
const report={schema:'roadster.steady-circle-comparison',version:1,generatedAt:new Date().toISOString(),sourceSha256,baselineCommit:'6d2b897bc928ae0e44fa258a7184719cd660e48b',reproductionCommand:'node qa/check-steady-circles-3.11.mjs',
  protocol:{world:'Original flat city floor/contact material only; city obstacles removed for this isolated numerical fixture. The application city is unchanged.',initial:'2 s physical rest settling at [-320,0.62,0], then one declared forward rolling state v=target and wheel omega=v/r. No measured state assignments.',physicsHz:120,durationS:DURATION,straightSeconds:5,steerRampSeconds:1,steering:'Fixed road-wheel centre 2 deg at 54 km/h and 0.8 deg at 90 km/h; steeringAssist=false, ABS/TCS=true. This is not a keyboard turn or a test of the speed-sensitive steering map.',longitudinal:'Same PI ordinary-pedal driver: ground-plane speed feedback, Kp=1.6, Ki=0.6, integral +/-6; drag+rolling feed-forward. Uses actual throttle/brake, without assigning velocity.',referenceLateralG:{at54:Math.pow(54/3.6,2)*Math.tan(2/DEG)/2.84/9.81,at90:Math.pow(90/3.6,2)*Math.tan(.8/DEG)/2.84/9.81},steadyWindow:[35,40],steadyThresholds:thresholds},
  results,limitations:['Numerical sustained-turn regression, not real keyboard/camera feel, rendered pixels, GPU performance or Tesla calibration.','The fixed final 5 s window is evaluated without searching for a favorable interval; failure remains a failure.','A stable circular arc does not imply a complete lap. Radius is fitted to actual last-window trajectory and also reported from speed/yaw.','All physical parameters stay at their declared version defaults except the explicit identical road/supply/steering protocol. Both models use the same dry mu=1.25, wet multiplier=0.52, 700 kW motor ceiling and 600 L bench mass.']};
fs.writeFileSync(new URL('./steady-circles-3.11.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
