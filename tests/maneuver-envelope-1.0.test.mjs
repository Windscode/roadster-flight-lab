import assert from 'node:assert/strict';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as CANNON from '../dist/vendor/cannon-es.js';
import {RoadsterSim,DEFAULT_PARAMS} from '../dist/physics.js';
import {DEFAULT_PARAMS as KERNEL_DEFAULTS} from '../dist/physics-kernel-319.js';
import {createManeuverEnvelope,envelopeClearanceAt} from '../dist/maneuver-envelope.js';
import {sampleManeuverHeadroom} from '../dist/maneuver-clearance.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {flatDynamics,DT} from './dynamics-fixtures-3.11.mjs';

const checks=[],cases=[],matrix=[];
const check=(name,fn)=>{fn();checks.push({name,status:'passed'});console.log('PASS '+name);};
function fixture({speed=10,yaw=0,height=.62,params={}}={}){
  const s=flatDynamics(RoadsterSim,{height,params});s.body.quaternion.setFromEuler(0,yaw,0,'YXZ');
  s.body.velocity.set(Math.sin(yaw)*speed,0,Math.cos(yaw)*speed);
  s.wheelStates.forEach(w=>w.angularVelocityRadS=speed/s.params.wheelRadius);return s;
}
function roof(s,{forward=10,height=3.5,width=10,length=8}={}){
  const heading=s.body.quaternion.vmult({x:0,y:0,z:1});
  const b=new CANNON.Body({mass:0,material:s._roadMaterial,shape:new CANNON.Box(new CANNON.Vec3(width/2,.15,length/2)),
    position:new CANNON.Vec3(s.body.position.x+heading.x*forward,height,s.body.position.z+heading.z*forward)});
  b.quaternion.copy(s.body.quaternion);b.userData={id:'envelope-test-roof'};s.world.addBody(b);return b;
}
function observeRun(s,{input={throttle:1},seconds=12,postSeconds=0,envelope=null,beforeStep=null}={}){
  const start=s.simTime,base=s.body.position.y,original=s._noteRigidContactFeedback,descriptor=Object.getOwnPropertyDescriptor(s,'_noteRigidContactFeedback');
  let hullContacts=0,peakForceFraction=0,maxEnvelopeExcessM=-Infinity,completion=null,postMinContacts=4,postCommandN=0,firstAbort=null,phaseAtFirstHull=null;
  Object.defineProperty(s,'_noteRigidContactFeedback',{configurable:true,writable:true,value:function(dt){
    const hull=this.getContactDiagnostics().filter(c=>c.vehicleShape<4);
    hullContacts+=hull.length;if(hull.length&&!phaseAtFirstHull)phaseAtFirstHull=this._maneuver?.phase??'finished';
    const timeS=this.simTime-start+dt;
    if(envelope&&timeS<=envelope.summary.horizonS){
      this.body.updateAABB();maxEnvelopeExcessM=Math.max(maxEnvelopeExcessM,this.body.aabb.upperBound.y-base-envelopeClearanceAt(envelope,timeS));
    }
    return original.call(this,dt);
  }});
  for(let i=0;i<seconds/DT;i++){
    beforeStep?.(s,i*DT);const t=s.advanceFixed(input,DT);assert.equal(t.fault,null);
    peakForceFraction=Math.max(peakForceFraction,...t.nozzles.map(n=>n.maxForce?n.force/n.maxForce:0));
    if(t.maneuver?.abortReason){firstAbort??=t.maneuver.abortReason;assert.equal(t.maneuver.abortReason,firstAbort);}
    if(!t.maneuver)completion??={timeS:(i+1)*DT,feedback:t.maneuverFeedback.lastRun};
    if(completion){postMinContacts=Math.min(postMinContacts,t.contactCount);postCommandN=Math.max(postCommandN,t.controlOwnership.commandForceN);}
    if(completion&&(i+1)*DT-completion.timeS>=postSeconds-1e-9)break;
  }
  if(descriptor)Object.defineProperty(s,'_noteRigidContactFeedback',descriptor);else delete s._noteRigidContactFeedback;
  assert.ok(peakForceFraction<=1+1e-9);assert.ok(Math.abs(s.telemetry().energyAccounting.balanceErrorJ)<.02);
  return {hullContacts,phaseAtFirstHull,firstAbort,peakForceFraction,maxEnvelopeExcessM:Number.isFinite(maxEnvelopeExcessM)?maxEnvelopeExcessM:null,completion,postMinContacts,postCommandN};
}

check('Near roofs remain refused while 30–45 m X corridors now complete with five seconds of driving',()=>{
  for(const forward of [10,15,20,25,30,35,40,45]){
    const s=fixture();roof(s,{forward});const bodyBefore=s.exportState().body;
    const oldPeak=sampleManeuverHeadroom(s,{rangeM:6.49,requiredM:6.18,horizonS:3.984});
    const accepted=s.startManeuver('roll');assert.deepEqual(s.exportState().body,bodyBefore);
    assert.equal(accepted,forward>=30);assert.equal(oldPeak.blocked,true);
    if(!accepted){assert.match(s.status,/分阶段净空估计/);cases.push({id:'near-refused',forwardM:forward,reason:s.status});continue;}
    const plan=structuredClone(s._maneuver),result=observeRun(s,{postSeconds:5});
    assert.equal(plan.profile.durationS,1.5);assert.equal(plan.preflight.headroom.envelope.active,true);
    assert.equal(result.hullContacts,0);assert.equal(result.completion.feedback.state,'completed');
    assert.equal(result.postMinContacts,4);assert.equal(result.postCommandN,0);
    cases.push({id:'late-roof-opened',forwardM:forward,oldPeak,newHeadroom:plan.preflight.headroom,...result});
  }
});

check('Reverse travel, rotated headings and a stationary car sample their complete timed envelope',()=>{
  for(const [speed,yaw,forward]of [[10,Math.PI/2,10],[10,Math.PI/4,10],[-10,0,-10]]){
    const s=fixture({speed,yaw});roof(s,{forward});const before=s.exportState().body;
    assert.equal(s.startManeuver('roll'),false);assert.deepEqual(s.exportState().body,before);
  }
  for(const [speed,yaw,forward]of [[10,Math.PI/2,30],[10,Math.PI/4,30],[-10,0,-30]]){
    const s=fixture({speed,yaw});roof(s,{forward});assert.equal(s.startManeuver('roll'),true);
    const result=observeRun(s,{input:{throttle:Math.sign(speed)},postSeconds:5});
    assert.equal(result.hullContacts,0);assert.equal(result.completion.feedback.state,'completed');assert.equal(result.postMinContacts,4);
    cases.push({id:'heading-or-reverse',speed,yaw,forward,...result});
  }
  for(const [height,expected]of [[3.5,false],[12,true]]){
    const s=fixture({speed:0});roof(s,{forward:0,height});assert.equal(s.startManeuver('roll'),expected);
    if(expected)assert.ok(s._maneuver.preflight.headroom.stationCount>1,'Stationary flight still samples future rotation height');
  }
});

check('Default X and U collider heights stay within reserves; custom-parameter research runs explicitly use fallback',()=>{
  const variants=[{}, {dryMass:1700},{dryMass:2300},{initialPressureBar:40},{valveRiseTime:.025,valveFallTime:.015},
    {valveRiseTime:.08,valveFallTime:.05},{gravity:7},{gravity:12},{liftNozzleMax:24000},{liftNozzleMax:16000}];
  for(const name of ['roll','pitch'])for(const speed of [-10,0,10,30])for(const params of variants){
    const s=fixture({speed,params}),accepted=s.startManeuver(name);
    if(!accepted){matrix.push({name,speed,params,accepted,reason:s.status});continue;}
    const initial=s.exportState(),envelope=createManeuverEnvelope(s,s._maneuver,KERNEL_DEFAULTS),isDefault=Object.keys(params).length===0;
    assert.deepEqual(s.exportState(),initial,'A prediction must not change live physics, resources or references');
    assert.equal(envelope.summary.active,isDefault);
    assert.equal(s._maneuver.preflight.headroom.envelope.active,isDefault);
    if(isDefault)assert.ok(envelope.summary.transitions.rotateS>0&&envelope.summary.transitions.landS>envelope.summary.transitions.rotateS);
    else assert.ok(envelope.summary.fallbackReasons.includes('custom-physics-parameters-outside-validated-domain'));
    const result=observeRun(s,{envelope:isDefault?envelope:null});
    assert.equal(result.completion?.feedback.state,'completed');assert.equal(result.hullContacts,0);
    if(isDefault)assert.ok(result.maxEnvelopeExcessM<=0,JSON.stringify({name,speed,params,...result}));
    matrix.push({name,speed,params,accepted,envelope:envelope.summary,...result});
  }
  assert.equal(matrix.length,80);assert.equal(matrix.filter(r=>r.accepted).length,61);
  for(const name of ['roll','pitch'])for(const verticalMps of [-.29,.29]){
    const s=fixture();s.body.velocity.y=verticalMps;assert.equal(s.startManeuver(name),true);
    const envelope=createManeuverEnvelope(s,s._maneuver,KERNEL_DEFAULTS);assert.equal(envelope.summary.active,true);
    const result=observeRun(s,{envelope});assert.equal(result.completion?.feedback.state,'completed');assert.ok(result.maxEnvelopeExcessM<=0);
    cases.push({id:'vertical-entry-boundary',name,verticalMps,...result});
  }
  assert.equal(DEFAULT_PARAMS.liftNozzleMax,20000);assert.equal(DEFAULT_PARAMS.tireMu,1.25);
});

check('Custom physics and independent observation / actuator states cannot silently activate the default envelope',()=>{
  const s=fixture();assert.equal(s.startManeuver('roll'),true);
  const original=s.params,plan=s._maneuver;
  for(const params of [{gravity:1},{gravity:3},{gravity:20,liftNozzleMax:50000},{gravity:7,dryMass:1700},
    {attitudeResponse:7},{sideNozzleMax:20000},{axialNozzleMax:50000},{tankLitres:3000},{airDensity:2},
    {springRate:200000},{suspensionDamping:1500},{dragArea:3},{wheelRadius:.4},{wingMode:'fixed',wingDeployment:1}]){
    s.params={...original,...params};const envelope=createManeuverEnvelope(s,plan,KERNEL_DEFAULTS);
    assert.equal(envelope.summary.active,false);assert.equal(envelope.samples.length,0);
    assert.ok(envelope.summary.fallbackReasons.includes('custom-physics-parameters-outside-validated-domain'));
    assert.deepEqual(envelope.summary.parameterDomain.differences.map(d=>d.key).sort(),Object.keys(params).sort());
    cases.push({id:'custom-parameter-domain',params,envelope:envelope.summary});
  }
  s.params=original;
  for(const configure of [()=>s.setObservation({enabled:true}),()=>s.setObservation({enabled:true,delayMs:250})]){
    configure();const envelope=createManeuverEnvelope(s,plan,KERNEL_DEFAULTS);
    assert.equal(envelope.summary.active,false);assert.ok(envelope.summary.fallbackReasons.includes('ideal-control-observation-required'));
  }
  s.setObservation({enabled:false});
  for(const [object,key,value]of [[s,'_fanLevel',.1],[s._wing,'deployment',.5],[s._nozzles[0],'force',100]]){
    const before=object[key];object[key]=value;const envelope=createManeuverEnvelope(s,plan,KERNEL_DEFAULTS);object[key]=before;
    assert.equal(envelope.summary.active,false);assert.ok(envelope.summary.fallbackReasons.includes('settled-actuator-state-required'));
  }
  assert.equal(createManeuverEnvelope(s,plan).summary.active,false,'An absent default baseline must fail closed');
  const delayed=fixture();delayed.setObservation({enabled:true,delayMs:250});roof(delayed,{forward:30,width:100});
  assert.equal(delayed.startManeuver('roll'),false);assert.match(delayed.status,/顶棚预测范围/);
  cases.push({id:'delayed-observation-roof-refused',reason:delayed.status});
  // Regression: 3.24 accepted this low-gravity roof, then hit it. An unknown
  // phase envelope now requires an open-overhead corridor before X/U begins.
  const lowGravity=fixture({params:{gravity:3}});roof(lowGravity,{forward:35,height:12.15});
  const before=lowGravity.exportState();assert.equal(lowGravity.startManeuver('roll'),false);
  assert.match(lowGravity.status,/顶棚预测范围/);assert.deepEqual(lowGravity.exportState().body,before.body);
  assert.equal(lowGravity._maneuver,null);assert.equal(lowGravity.gasMass,before.state.gasMass);
  cases.push({id:'low-gravity-roof-now-refused',reason:lowGravity.status});
});

check('Unmodelled supply, wind, surface and entry conditions retain the conservative fallback',()=>{
  const variants=[
    ['finite',s=>s.setSupplyMode('finite'),'constant-supply-required'],
    ['wind',s=>s.setWind({speedMps:6,directionDeg:90}),'still-air-required'],
    ['nozzle',s=>s.setNozzleFault({id:'lift-FR',scale:.95}),'healthy-nozzles-required'],
    ['tilt',s=>s.body.quaternion.setFromEuler(.08,0,0),'settled-upright-start-required'],
    ['lateral',s=>{s.body.velocity.x=1;},'straight-driving-envelope-required'],
    ['slow-valve',s=>{s.params.valveRiseTime=.1;},'valve-response-outside-validated-range']
  ];
  for(const [id,configure,reason]of variants){
    const s=fixture();configure(s);assert.equal(s.startManeuver('roll'),true,id);
    const envelope=s._maneuver.preflight.headroom.envelope;
    assert.equal(envelope.active,false);assert.ok(envelope.fallbackReasons.includes(reason));
    cases.push({id:'fallback-'+id,envelope});
  }
  const airborne=fixture({height:4});assert.equal(airborne.startManeuver('roll'),true);
  assert.ok(airborne._maneuver.preflight.headroom.envelope.fallbackReasons.includes('four-wheel-ground-start-required'));
  const slope=fixture({speed:0}),ground=slope.world.bodies.find(b=>b.userData?.id==='ground'),radians=5*Math.PI/180;
  ground.quaternion.setFromEuler(-radians,0,0);ground.position.z=slope.body.position.z;ground.position.y=-.5/Math.cos(radians);ground.aabbNeedsUpdate=true;
  slope.body.quaternion.copy(ground.quaternion);
  for(let i=0;i<240;i++)slope.advanceFixed({brake:1},DT);
  slope.body.velocity.set(0,10*Math.tan(radians),10);assert.equal(slope.startManeuver('roll'),true);
  assert.ok(slope._maneuver.preflight.headroom.envelope.fallbackReasons.includes('approximately-level-support-required'));
  cases.push({id:'fallback-slope',envelope:slope._maneuver.preflight.headroom.envelope});
  const stepped=fixture();stepped._addBox('upcoming-step','test',[10,.2,10],[0,.1,-220]);
  assert.equal(stepped.startManeuver('roll'),true);
  assert.equal(stepped._maneuver.preflight.headroom.envelope.active,false);
  assert.ok(stepped._maneuver.preflight.headroom.envelope.fallbackReasons.includes('support-plane-changes-along-path'));
  cases.push({id:'fallback-changing-support',headroom:stepped._maneuver.preflight.headroom});
});

check('Pitch uses its own longer physical envelope instead of reusing the quicker roll clearance',()=>{
  for(const [forward,expected]of [[15,false],[30,false],[35,false],[40,true],[45,true]]){
    const s=fixture();roof(s,{forward});assert.equal(s.startManeuver('pitch'),expected);
    if(!expected)continue;
    assert.equal(s._maneuver.profile.durationS,1.8);
    const result=observeRun(s,{postSeconds:5});assert.equal(result.hullContacts,0);assert.equal(result.completion.feedback.state,'completed');
    cases.push({id:'pitch-late-roof',forwardM:forward,...result});
  }
});

check('Unexpected collisions still abort launch, rotation, landing, recovery and explicit L without resetting recovery clocks',()=>{
  for(const [name,height,target]of [['roll',.62,'immediate'],['roll',.62,'land'],['roll',4,'recover'],['pitch',.62,'land'],['pitch',4,'recover'],['land',4,'descent']]){
    const s=fixture({speed:target==='immediate'?10:0,height});assert.notEqual(s.startManeuver(name),false);
    const controller=s._controller;let inserted=false,transition=null;
    Object.defineProperty(s,'_controller',{configurable:true,value:function(dt,input){
      const before={phase:this._maneuver?.phase,time:this._maneuver?.time,reason:this._maneuver?.abortReason};
      const result=controller.call(this,dt,input);
      if(!before.reason&&this._maneuver?.abortReason){transition={before,phase:this._maneuver.phase,time:this._maneuver.time,dt};
        if(['land','recover','descent'].includes(before.phase)){assert.equal(transition.phase,before.phase);assert.ok(Math.abs(transition.time-before.time-dt)<1e-10);}}
      return result;
    }});
    const result=observeRun(s,{input:target==='immediate'?{throttle:1}:{},seconds:14,beforeStep:sim=>{
      if(inserted||target!=='immediate'&&sim._maneuver?.phase!==target)return;
      roof(sim,target==='immediate'?{}:{forward:0,height:name==='roll'&&height<1?2.7:sim.body.position.y+.5,width:20,length:16});inserted=true;
    }});
    delete s._controller;
    assert.ok(inserted&&result.hullContacts>0&&transition);assert.equal(result.completion.feedback.aborted,true);
    assert.match(result.completion.feedback.state,/^aborted-/);cases.push({id:'collision-fallback',name,height,target,transition,...result});
  }
});

check('Maneuver continuation serializes compact evidence and preserves exact solver execution',()=>{
  const s=fixture();assert.equal(s.startManeuver('roll'),true);
  assert.equal('samples' in s._maneuver.preflight.headroom.envelope,false);
  for(let i=0;i<120;i++)s.advanceFixed({throttle:1},DT);
  const snapshot=s.exportState(),mirror=fixture();mirror.importState(snapshot);
  for(let i=0;i<240;i++){s.advanceFixed({throttle:1},DT);mirror.advanceFixed({throttle:1},DT);assert.deepEqual(mirror.exportState(),s.exportState());}
});

const sources=['dist/maneuver-envelope.js','dist/maneuver-clearance.js','dist/physics-kernel-319.js','dist/pitch-maneuver.js'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHashes=Object.fromEntries(sources.map(p=>[p,sha(readFileSync(p))]));
const accepted=matrix.filter(r=>r.accepted),active=accepted.filter(r=>r.envelope.active),worst=active.reduce((a,b)=>b.maxEnvelopeExcessM>a.maxEnvelopeExcessM?b:a);
mkdirSync('qa',{recursive:true});
writeFileSync(`qa/maneuver-envelope-${REPORT_VERSION}.json`,JSON.stringify({schema:'roadster-maneuver-envelope-100',createdAt:new Date().toISOString(),status:'passed',modelBuildId:MODEL_BUILD_ID,
  checks,cases,matrix,sourceHashes,worstEnvelopeCase:{name:worst.name,speed:worst.speed,params:worst.params,maxEnvelopeExcessM:worst.maxEnvelopeExcessM},
  archived323ReportSha256:sha(readFileSync('qa/maneuver-clearance-3.23.json')),
  scope:'Production physics/contact integration. Default phase envelopes remain unchanged; unsupported parameters/supply/observation/support now require an open-overhead sampled corridor instead of relying on the old peak estimate. The known low-gravity roof is refused without changing body or gas. Bounded rays still omit thin obstacles, steering and wind drift; no collision certificate or native-input claim.'},null,2)+'\n');
