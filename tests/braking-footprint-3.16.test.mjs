import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import * as CANNON from '../dist/vendor/cannon-es.js';
import {RoadsterSim} from '../dist/physics.js';
import {circularWheelSupport as crownSupport} from '../dist/wheel-contact-envelope.js';
import {circularWheelSupport as oldSupport} from './fixtures/wheel-support-three-station-before-3.16.mjs';
import {wheelsWithFrozenForcePass} from './fixtures/wheel-force-pass-before-crown-3.16.mjs';
import {contentLabel} from '../dist/experiment-records.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
const dt=1/120,checks=[],cases=[],trace=[],geometries=[],r=.37,w=.1325,hash=x=>createHash('sha256').update(x).digest('hex'),v=(x=0,y=0,z=0)=>new CANNON.Vec3(x,y,z);
const check=(name,pass,detail={})=>{checks.push({name,passed:!!pass,...detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
const forceBody=fn=>{const source=fn.toString();return source.slice(source.indexOf('{')).replace(/\r\n/g,'\n').trim();};
const identicalWheelForcePass=forceBody(RoadsterSim.prototype._wheels)===forceBody(wheelsWithFrozenForcePass);
// 3.19 deliberately added route queries and read-only wheel/contact feedback.
// Keep the frozen 3.16 fixture untouched. These exact, individually audited
// substitutions only compare source; no substituted function is executed.
// Every remaining byte of the force pass must still match the original fixture.
const auditedSourceAdditions=[
  ['steering contact normal','this._surfaceMu(w.contactPointWorld||b.position,w.contactNormalWorld?.y??1)','this._surfaceMu(w.contactPointWorld||b.position)'],
  ['cornering contact normal','this._surfaceMu(c.w.contactPointWorld,c.w.contactNormalWorld?.y??1)','this._surfaceMu(c.w.contactPointWorld)'],
  ['tyre contact normal','this._surfaceMu(w.contactPointWorld,w.contactNormalWorld?.y??1)','this._surfaceMu(w.contactPointWorld)'],
  ['onset collection','const contacts=[],contactOnsets=[];','const contacts=[];'],
  ['previous contact diagnostics','const ray=this._wheelRays[i],w=this.wheelStates[i],wasContact=w.contact,airTime=w.contactAirTimeS||0;','const ray=this._wheelRays[i],w=this.wheelStates[i];'],
  ['reset new diagnostic fields','w.rollingContactWeight=0;w.slipPowerW=0;w.surfaceId=null;w.surfaceMaterial=null;w.surfaceLabel=null;w.surfaceLabelEn=null;w.surfaceKind=null;w.opticalWetness=0;w.rollingTexture=1;w.contactNormalSpeedMps=0;','w.rollingContactWeight=0;'],
  ['airtime without support','if(!w.contact) { w.relaxedSlip=0;w.contactAirTimeS=airTime+dt;continue; }','if(!w.contact) { w.relaxedSlip=0;continue; }'],
  ['contact metadata and onset observation',`if(!w.contact){w.contactAirTimeS=airTime+dt;continue;}
      w.contactAirTimeS=0;w.contactNormalSpeedMps=vn;
      const surface=this._surfaceAt(w.contactPointWorld,ray.hitNormalWorld.y);
      w.surfaceId=surface?.surfaceId??'legacy-'+p.roadSurface;w.surfaceMaterial=surface?.materialId??p.roadSurface;w.surfaceLabel=surface?.label??({dry:'干沥青',wet:'全局湿路',split:'世界X分界'}[p.roadSurface]);w.surfaceLabelEn=surface?.labelEn??p.roadSurface;w.surfaceKind=surface?.kind??'asphalt';w.opticalWetness=surface?.opticalWetness??null;w.rollingTexture=surface?.rollingTexture??1;
      if(!wasContact&&airTime>=.06&&vn<-.18&&this.simTime>.15)contactOnsets.push({wheelId:w.id,normalSpeedMps:-vn,normalEnergyJ:.5*(b.mass/4)*vn*vn,normalImpulseNs:spring*dt});`,'if(!w.contact)continue;'],
  ['contact feedback publication','this._contactCount=contacts.length;this._noteContactOnsets(contactOnsets);','this._contactCount=contacts.length;'],
  ['slip power projection','      w.slipPowerW=Math.max(0,result.tireEnergyJ/dt)+Math.max(0,-flat*c.vlat);\n',''],
];
let legacyForceBody=forceBody(RoadsterSim.prototype._wheels);
const sourceAdaptations=auditedSourceAdditions.map(([name,current,original])=>{const occurrences=legacyForceBody.split(current).length-1;legacyForceBody=legacyForceBody.replace(current,original);return{name,occurrences,expectedOccurrences:1};});
const identicalLegacyForcePath=sourceAdaptations.every(row=>row.occurrences===1)&&legacyForceBody===forceBody(wheelsWithFrozenForcePass);
const legacyForceComparisons=[],excludedWheelDiagnostics=['slipPowerW','contactNormalSpeedMps'];
const legacyComparableSnapshot=sim=>{const snapshot=sim.exportState();for(const wheel of snapshot.state.wheelStates)for(const key of excludedWheelDiagnostics)delete wheel[key];return snapshot;};
function flat(){const s=new RoadsterSim({supplyMode:'finite'});for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.body.position.set(0,.62,-350);for(let i=0;i<360;i++)s.step(dt);return s;}
for(const speed of [100,200,300])for(const sign of [-1,1]){
  const initialSim=flat();initialSim.body.velocity.z=speed/3.6;initialSim.wheelStates.forEach(q=>q.angularVelocityRadS=initialSim.body.velocity.z/initialSim.params.wheelRadius);initialSim.body.quaternion.setFromEuler(0,sign*1e-5,0);const initial=initialSim.exportState();
  for(const variant of ['three-station-before','continuous-crown-after']){
    const s=flat();if(variant==='three-station-before')Object.defineProperty(s,'_wheels',{configurable:true,value:function(interval,input){return wheelsWithFrozenForcePass.call(this,interval,input,oldSupport);}});s.importState(initial);
    // Independently execute the untouched frozen force pass with the current
    // crown support. This verifies the audited additions leave every original
    // physical/snapshot field exactly equal on every original braking step.
    // Only two newly projected diagnostics differ; contact feedback, complete
    // body/world state, wheel forces, ABS, energy and resources stay compared.
    let legacyTwin=null,comparedSteps=0,firstLegacyDifference=null,legacySurfaceUnchanged=true;
    if(variant==='continuous-crown-after'){legacyTwin=flat();Object.defineProperty(legacyTwin,'_wheels',{configurable:true,value:function(interval,input){return wheelsWithFrozenForcePass.call(this,interval,input,crownSupport);}});legacyTwin.importState(initial);assert.deepEqual(s.exportState(),legacyTwin.exportState());}
    let maxYaw=0,maxRoll=0,stopped=false,minContacts=4,rigid=0,refined=0,maximumPatchStation=0,firstOuter=null,forceLimits=true,tick=0;
    for(;tick<1200;tick++){
      const t=s.step(dt,{brake:1}),fw=s.body.quaternion.vmult(v(0,0,1)),yaw=Math.atan2(fw.x,fw.z)*180/Math.PI;
      if(legacyTwin){legacyTwin.step(dt,{brake:1});comparedSteps++;legacySurfaceUnchanged&&=s.getRouteSurface()===null&&s.wheelStates.every(q=>s._surfaceAt(q.contactPointWorld,q.contactNormalWorld.y)===null&&s._surfaceMu(q.contactPointWorld,q.contactNormalWorld.y)===s.params.tireMu);if(!isDeepStrictEqual(legacyComparableSnapshot(s),legacyComparableSnapshot(legacyTwin))&&firstLegacyDifference===null)firstLegacyDifference=tick+1;}
      maxYaw=Math.max(maxYaw,Math.abs(yaw));maxRoll=Math.max(maxRoll,Math.abs(t.rollDeg));minContacts=Math.min(minContacts,t.contactCount);rigid+=t.rigidContactCount;refined+=Number(t.integration.substeps>1);
      forceLimits&&=Math.abs(t.wheelStates.reduce((a,q)=>a+q.brakeDemandN,0)-s.params.brakeForce)<1e-8&&t.wheelStates.every(q=>Number.isFinite(q.angularVelocityRadS)&&q.brakeTorqueNm<=q.brakeDemandN*s.params.wheelRadius+1e-6&&q.gripUse<=1+1e-10);
      maximumPatchStation=Math.max(maximumPatchStation,...t.wheelStates.map(q=>Math.abs(q.contactGeometry?.stationM??0)));
      if(!firstOuter&&t.wheelStates.some(q=>Math.abs(q.contactGeometry?.stationM??0)>.1))firstOuter={timeS:(tick+1)*dt,yawDeg:yaw,rollDeg:t.rollDeg,stationsM:t.wheelStates.map(q=>q.contactGeometry?.stationM??null)};
      trace.push(JSON.stringify({variant,speedKmh:speed,yawSign:sign,step:tick+1,timeS:(tick+1)*dt,speedKmhAfter:t.speedKmh,position:t.position,quaternion:t.quaternion,velocity:t.velocity,yawDeg:yaw,rollDeg:t.rollDeg,contacts:t.contactCount,rigid:t.rigidContactCount,integration:t.integration,wheels:t.wheelStates.map(q=>({id:q.id,normalLoadN:q.normalLoadN,contactPoint:q.contactPointWorld,contactNormal:q.contactNormalWorld,contactGeometry:q.contactGeometry,brakeDemandN:q.brakeDemandN,brakeTorqueNm:q.brakeTorqueNm,gripUse:q.gripUse}))}));
      if(t.fault)break;if(t.speedKmh<.36){stopped=true;break;}
    }
    const row={variant,speedKmh:speed,yawSign:sign,initialSnapshot:initial,initialSnapshotLabel:contentLabel(initial),stopped,maxYawDeg:maxYaw,maxRollDeg:maxRoll,durationS:(tick+1)*dt,finalSpeedKmh:s.telemetry().speedKmh,minWheelContacts:minContacts,rigidContactSamples:rigid,refinedControlSteps:refined,maximumAbsolutePatchStationM:maximumPatchStation,firstOuter,forceLimits,fault:s.telemetry().fault};cases.push(row);console.log(`${variant} ${speed} km/h / ${sign}: stopped=${stopped}; max yaw ${maxYaw.toFixed(9)} deg; max roll ${maxRoll.toFixed(9)} deg; patch ${maximumPatchStation.toFixed(9)} m.`);
    if(legacyTwin)legacyForceComparisons.push({speedKmh:speed,yawSign:sign,comparedSteps,firstDifferentStep:firstLegacyDifference,exactPhysicalSnapshots:firstLegacyDifference===null,legacySurfaceUnchanged,excludedWheelDiagnostics});
  }
}
const before=cases.filter(c=>c.variant==='three-station-before'),after=cases.filter(c=>c.variant==='continuous-crown-after');
check('The frozen support reproduces the defect with unchanged legacy wheel forces, audited read-only additions and identical complete initial snapshots',identicalLegacyForcePath&&legacyForceComparisons.length===6&&legacyForceComparisons.every(c=>c.comparedSteps>0&&c.exactPhysicalSnapshots&&c.legacySurfaceUnchanged)&&before.every((c,i)=>c.initialSnapshotLabel===after[i].initialSnapshotLabel&&c.stopped&&c.maxYawDeg>.01&&c.firstOuter?.timeS<=.025+1e-12),{identicalWheelForcePass,identicalLegacyForcePath,normalizedForceBodySha256:hash(forceBody(RoadsterSim.prototype._wheels)),projectedLegacyForceBodySha256:hash(legacyForceBody),frozenForceBodySha256:hash(forceBody(wheelsWithFrozenForcePass)),sourceAdaptations,legacyForceComparisons});
check('The original six perturbed 100/200/300 km/h braking cases retain the unchanged stopping and 0.01 degree yaw limits',after.every(c=>c.stopped&&c.maxYawDeg<.01&&!c.fault));
check('Both branches keep four supporting tyres, zero rigid impacts and zero contact refinement, isolating the contact patch selection',cases.every(c=>c.minWheelContacts===4&&c.rigidContactSamples===0&&c.refinedControlSteps===0));
check('The original per-wheel force, brake budget, torque and grip limits remain satisfied with no suppression of the actual contact moment',cases.every(c=>c.forceLimits)&&after.every(c=>c.maximumAbsolutePatchStationM<.001)&&before.every(c=>c.maximumAbsolutePatchStationM===w));
function boxWorld(half,position=v()) {const world=new CANNON.World(),body=new CANNON.Body({mass:0,shape:new CANNON.Box(half)});body.position.copy(position);world.addBody(body);return world;}
const plane=boxWorld(v(100,.05,100),v(0,.05,0));
function query(world,{x=0,roll=0,support=crownSupport}={}){
  const q=new CANNON.Quaternion();q.setFromEuler(0,0,roll);const mount=v(x,.75,0),up=q.vmult(v(0,1,0)),forward=q.vmult(v(0,0,1)),right=up.cross(forward),result=new CANNON.RaycastResult();
  if(!support(world,{mount,up,forward,radius:r,halfWidth:w,minLength:-r,maxLength:1},result))return null;
  const length=result.distance-r,centre=mount.vsub(up.scale(length)),delta=result.hitPointWorld.vsub(centre),row={rollRad:roll,mountX:x,point:{...result.hitPointWorld},normal:{...result.hitNormalWorld},suspensionLengthM:length,localStationM:delta.dot(right),radiusResidualM:delta.length()-r,widthMarginM:w-Math.abs(delta.dot(right)),feature:result.wheelSupport?.feature,method:result.wheelSupport?.method};geometries.push(row);return row;
}
const epsilon=1e-6,near=[query(plane,{roll:-epsilon}),query(plane,{roll:0}),query(plane,{roll:epsilon})],oldNear=[query(plane,{roll:-epsilon,support:oldSupport}),query(plane,{roll:epsilon,support:oldSupport})];
check('At infinitesimal camber the continuous tread patch obeys the geometric radius bound instead of jumping the entire tyre half-width',Math.abs(near[2].localStationM-near[0].localStationM)<=2*r*Math.sin(epsilon)+1e-10&&oldNear.every(g=>Math.abs(Math.abs(g.localStationM)-w)<=Number.EPSILON),{crownStationsM:near.map(g=>g.localStationM),oldStationsM:oldNear.map(g=>g.localStationM),perturbationRad:epsilon});
const shoulderAngle=Math.asin(w/r),shoulder=[query(plane,{roll:shoulderAngle-epsilon}),query(plane,{roll:shoulderAngle+epsilon})];
check('The crown-to-shoulder transition stays continuous and its contact point lies on the declared rounded envelope and static face',Math.abs(shoulder[1].localStationM-shoulder[0].localStationM)<=2*r*epsilon+1e-10&&[...near,...shoulder].every(g=>Math.abs(g.point.y-.1)<1e-9&&Math.abs(g.radiusResidualM)<1e-9&&g.widthMarginM>=-1e-9&&Math.abs(g.normal.y-1)<1e-9));
const narrow=boxWorld(v(.2,.05,2),v(0,.05,0)),transition=[query(narrow,{x:.2-epsilon}),query(narrow,{x:.2+epsilon})],inside=query(narrow,{x:.2+w-epsilon}),outside=query(narrow,{x:.2+w+epsilon});
check('A finite face-to-edge contact is continuous while a point beyond the actual tyre width supplies no support',transition.every(Boolean)&&Math.abs(transition[1].suspensionLengthM-transition[0].suspensionLengthM)<1e-9&&Math.hypot(transition[1].normal.x-transition[0].normal.x,transition[1].normal.y-transition[0].normal.y)<2*epsilon/r&&inside!==null&&outside===null&&Math.abs(inside.radiusResidualM)<1e-9,{transition,inside,outside});
const bytes=gzipSync(Buffer.from(trace.join('\n')+'\n'),{level:9}),traceName=`braking-footprint-${REPORT_VERSION}.ndjson.gz`;writeFileSync(new URL('../qa/'+traceName,import.meta.url),bytes);
const sources=['dist/physics.js','dist/simulation-snapshot.js','dist/wheel-contact-envelope.js','dist/tire-dynamics.js','tests/fixtures/wheel-support-three-station-before-3.16.mjs','tests/fixtures/wheel-force-pass-before-crown-3.16.mjs','tests/braking-footprint-3.16.test.mjs'];
const report={schema:'roadster-continuous-tread-braking-regression',version:1,createdAt:new Date().toISOString(),modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:checks.every(c=>c.passed)?'passed':'failed',checks,cases,geometryChecks:geometries,sourceHashes:Object.fromEntries(sources.map(path=>[path,hash(readFileSync(new URL('../'+path,import.meta.url)))])),baselineProvenance:JSON.parse(readFileSync(new URL('./fixtures/wheel-support-before-crown-3.16.provenance.json',import.meta.url),'utf8')),trace:{file:traceName,samples:trace.length,bytes:bytes.length,sha256:hash(bytes)},modelDefinition:{supportEnvelope:'radius-R sphere clipped to |local axle x|<=existing half tyre width',radiusM:r,halfWidthM:w,shoulderRadiusM:Math.sqrt(r*r-w*w),existingRigidStop:'independent 20-sided cylinder, unchanged',forceChanges:'none; existing force at the returned contact point retains its real lever arm',numericalEPSM:1e-8},limits:['This is an explicit rounded support-envelope approximation, not a measured tyre profile or an OEM tyre calibration. It does not replace the separately existing rigid wheel-stop shape.','The initial three-flat-section minimum was a defective discontinuous support selection. Its failure is preserved here, not removed by changing brake/yaw acceptance limits.','The severe 90 km/h step convergence remains a separate acceptance limitation and must be read from the recomputed contact-convergence-3.16 report.']};writeFileSync(new URL(`../qa/braking-footprint-${REPORT_VERSION}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');assert.ok(checks.every(c=>c.passed),checks.filter(c=>!c.passed).map(c=>c.name).join('\n'));
