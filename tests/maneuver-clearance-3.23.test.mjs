import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as CANNON from '../dist/vendor/cannon-es.js';
import {RoadsterSim,DEFAULT_PARAMS} from '../dist/physics.js';
import {quickRollManeuverProfile} from '../dist/vehicle-models.js';
import {sampleQuickRollHeadroom} from '../dist/vehicle-clearance.js';
import {sampleManeuverHeadroom} from '../dist/maneuver-clearance.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {flatDynamics,DT} from './dynamics-fixtures-3.11.mjs';

const checks=[],cases=[];
const check=(name,fn)=>{fn();checks.push({name,status:'passed'});console.log('PASS '+name);};
function fixture({speed=10,yaw=0,supplyMode='bench'}={}){
  const s=flatDynamics(RoadsterSim,{params:{supplyMode}});
  s.body.quaternion.setFromEuler(0,yaw,0,'YXZ');s.body.velocity.set(Math.sin(yaw)*speed,0,Math.cos(yaw)*speed);
  s.wheelStates.forEach(w=>w.angularVelocityRadS=speed/s.params.wheelRadius);
  return s;
}
function roof(s,{forward=10,height=3.5,width=10,length=8}={}){
  const heading=s.body.quaternion.vmult({x:0,y:0,z:1});
  const b=new CANNON.Body({mass:0,material:s._roadMaterial,
    shape:new CANNON.Box(new CANNON.Vec3(width/2,.15,length/2)),
    position:new CANNON.Vec3(s.body.position.x+heading.x*forward,height,s.body.position.z+heading.z*forward)});
  b.quaternion.copy(s.body.quaternion);b.userData={id:'maneuver-test-roof',kind:'test-fixture'};s.world.addBody(b);return b;
}
const physical=s=>JSON.stringify({body:s.exportState().body,gasMass:s.gasMass,energy:s._energyUsed,nozzles:s._nozzles});
function run(s,{seconds=10,postSeconds=0,obstacle=null,input={throttle:1},beforeStep=null}={}){
  let firstHull=null,firstAbort=null,completion=null,peak=s.body.position.y,peakForceRatio=0,postMinContacts=4,postMaxCommand=0,microHullContacts=0,peakHullNormalForceN=0;
  const start=s.simTime,noteContact=s._noteRigidContactFeedback;
  // Observe each actual contact slice, not only the final 120 Hz snapshot.
  // The original contact feedback still runs unchanged after this read.
  s._noteRigidContactFeedback=function(dt){
    const contacts=this.getContactDiagnostics().filter(c=>c.vehicleShape<4&&(!obstacle||c.objectId===obstacle.userData.id));
    microHullContacts+=contacts.length;
    for(const c of contacts)peakHullNormalForceN=Math.max(peakHullNormalForceN,c.normalForceN);
    if(contacts.length&&!firstHull)firstHull={elapsedS:this.simTime-start+dt,...contacts[0]};
    return noteContact.call(this,dt);
  };
  for(let i=0;i<seconds/DT;i++){
    beforeStep?.(s,i*DT);
    const t=s.advanceFixed(input,DT);assert.equal(t.fault,null);
    peak=Math.max(peak,t.heightWorld);
    peakForceRatio=Math.max(peakForceRatio,...t.nozzles.map(n=>n.maxForce?n.force/n.maxForce:0));
    if(t.maneuver?.abortReason&&!firstAbort)firstAbort={elapsedS:(i+1)*DT,reason:t.maneuver.abortReason};
    if(firstAbort&&t.maneuver)assert.equal(t.maneuver.abortReason,firstAbort.reason,'Sustained contacts retain the first failure reason');
    if(!s._maneuver&&!completion)completion={elapsedS:(i+1)*DT,feedback:t.maneuverFeedback.lastRun};
    if(completion){postMinContacts=Math.min(postMinContacts,t.contactCount);postMaxCommand=Math.max(postMaxCommand,t.controlOwnership.commandForceN);}
    if(completion&&(i+1)*DT-completion.elapsedS>=postSeconds-1e-9)break;
  }
  s._noteRigidContactFeedback=noteContact;
  const t=s.telemetry();return {firstHull,firstAbort,completion,microHullContacts,peakHullNormalForceN,peakHeightM:peak,peakForceRatio,postMinContacts,postMaxCommand,
    final:{mode:t.mode,contacts:t.contactCount,pitchDeg:t.pitchDeg,rollDeg:t.rollDeg,energyBalanceErrorJ:t.energyAccounting.balanceErrorJ}};
}

check('X rejects roofs along forward, reverse and rotated travel before changing physical state',()=>{
  for(const [yaw,speed,forward]of [[0,10,10],[Math.PI/2,10,10],[Math.PI/4,10,10],[0,-10,-10]]){
    const s=fixture({yaw,speed});roof(s,{forward});
    // This reproduces the old preflight's concrete blind spot without calling
    // a fake collision detector or granting a force/pose override.
    const originOnly=sampleQuickRollHeadroom(s.body.position,(o,d,r)=>s.traceSurface(o,d,r),12);
    assert.equal(originOnly.distanceM,null);
    const path=sampleManeuverHeadroom(s,{rangeM:12,horizonS:5});
    assert.equal(path.objectId,'maneuver-test-roof');assert.ok(path.nearestTimeS>0);assert.ok(path.stationSpacingM<=1);
    const before=physical(s);assert.equal(s.startManeuver('roll'),false);assert.equal(physical(s),before);
    assert.match(s.status,/滑行路径.*净空不足/);assert.equal(s._maneuver,null);
    cases.push({id:'roof-rejection',yaw,speed,forward,path,status:s.status});
  }
});

check('The bounded corridor leaves distant, side and sufficiently high roofs outside the rejection envelope',()=>{
  for(const kind of ['distant','side','high']){
    const s=fixture();const b=roof(s,{forward:kind==='distant'?90:10,height:kind==='high'?30:3.5});
    if(kind==='side'){b.position.x+=20;b.aabbNeedsUpdate=true;}
    assert.equal(s.startManeuver('roll'),true,kind);
    const headroom=s._maneuver.preflight.headroom;
    assert.ok(headroom.horizonS<=5&&headroom.sampleCount<=1285);
    assert.equal(headroom.distanceM,null);
    cases.push({id:'open-corridor-'+kind,headroom});
  }
});

check('Open-ground X retains its fast physical turn and four-wheel handoff with five seconds of continued W',()=>{
  for(const [speed,yaw,supplyMode]of [[0,0,'bench'],[10,0,'bench'],[30,0,'bench'],[10,Math.PI/2,'bench'],[10,0,'finite']]){
    const s=fixture({speed,yaw,supplyMode});assert.equal(s.startManeuver('roll'),true);
    assert.deepEqual(s._maneuver.profile,quickRollManeuverProfile());assert.equal(s._maneuver.profile.durationS,1.5);
    const result=run(s,{seconds:12,postSeconds:5});
    assert.equal(result.firstHull,null);assert.equal(result.firstAbort,null);assert.equal(result.completion?.feedback.state,'completed');
    assert.ok(result.completion.elapsedS<4.5&&result.peakHeightM<4.5);
    assert.ok(Math.abs(result.completion.feedback.actualRollTravelDeg)>355);
    assert.equal(result.postMinContacts,4);assert.equal(result.postMaxCommand,0);assert.equal(result.final.mode,'drive');
    assert.ok(result.peakForceRatio<=1+1e-9);assert.ok(Math.abs(result.final.energyBalanceErrorJ)<.02);
    cases.push({id:'open-ground',speed,yaw,supplyMode,...result});
  }
  assert.equal(DEFAULT_PARAMS.liftNozzleMax,20000);assert.equal(DEFAULT_PARAMS.tireMu,1.25);
});

check('An unforeseen hull collision aborts X, retains physical recovery and never reports completed',()=>{
  const s=fixture();assert.equal(s.startManeuver('roll'),true);const b=roof(s);
  // Geometry becomes available after acceptance: a sampled preflight is not
  // permission to call a later roof-assisted motion a successful maneuver.
  const result=run(s,{obstacle:b,seconds:10,postSeconds:5});
  assert.ok(result.firstHull&&result.firstAbort);assert.ok(result.firstAbort.elapsedS-result.firstHull.elapsedS<=DT+1e-9);
  assert.equal(result.completion?.feedback.state,'aborted-landed');assert.match(result.completion.feedback.reason,/车身碰撞.*maneuver-test-roof/);
  assert.equal(result.final.mode,'drive');assert.equal(result.postMinContacts,4);assert.equal(result.postMaxCommand,0);
  assert.ok(result.peakForceRatio<=1+1e-9);assert.ok(Math.abs(result.final.energyBalanceErrorJ)<.02);
  cases.push({id:'unforeseen-roof',...result});
});

check('Collision recovery continuation preserves the abort reason and exact physical state',()=>{
  const s=fixture();assert.equal(s.startManeuver('roll'),true);roof(s);
  for(let i=0;i<240&&!s._maneuver?.abortReason;i++)s.advanceFixed({throttle:1},DT);
  assert.match(s._maneuver?.abortReason??'',/车身碰撞/);
  const snapshot=s.exportState(),mirror=fixture();roof(mirror);mirror.importState(snapshot);
  for(let i=0;i<120;i++){
    s.advanceFixed({throttle:1},DT);mirror.advanceFixed({throttle:1},DT);
    assert.deepEqual(mirror.exportState(),s.exportState());
  }
});

check('Late X/U landing, airborne recovery and explicit L collisions preserve phase timing and cannot report success',()=>{
  for(const [name,height]of [['roll',.62],['roll',4],['pitch',.62],['pitch',4],['land',4]]){
    const s=flatDynamics(RoadsterSim,{height}),expectedPhase=name==='land'?'descent':height<1?'land':'recover';
    assert.notEqual(s.startManeuver(name),false);
    let added=null,transition=null;
    const controller=s._controller;
    s._controller=function(dt,input){
      const before={phase:this._maneuver?.phase,time:this._maneuver?.time,reason:this._maneuver?.abortReason};
      const output=controller.call(this,dt,input);
      if(!before.reason&&this._maneuver?.abortReason){
        transition={before,after:{phase:this._maneuver.phase,time:this._maneuver.time,reason:this._maneuver.abortReason},dt};
        assert.equal(transition.after.phase,before.phase);
        assert.ok(Math.abs(transition.after.time-before.time-dt)<1e-10,'An existing landing/recovery clock must not restart on contact');
      }
      return output;
    };
    const result=run(s,{seconds:14,input:{},beforeStep:(sim,time)=>{
      if(!added&&sim._maneuver?.phase===expectedPhase){
        const centerHeight=name==='roll'&&height<1?2.7:sim.body.position.y+.5;
        roof(sim,{forward:0,height:centerHeight,width:20,length:16});
        added={elapsedS:time,phase:sim._maneuver.phase,centerHeightM:centerHeight,position:{...sim.body.position}};
      }
    }});
    s._controller=controller;
    assert.ok(added&&result.microHullContacts>0&&result.firstAbort&&transition);
    assert.equal(transition.before.phase,expectedPhase);
    assert.equal(result.completion?.feedback.state,height<1||name==='land'?'aborted-landed':'aborted-recovered');
    assert.equal(result.completion.feedback.aborted,true);assert.match(result.completion.feedback.reason,/着陆中车身碰撞|回稳中车身碰撞/);
    assert.ok(result.peakForceRatio<=1+1e-9);assert.ok(Math.abs(result.final.energyBalanceErrorJ)<.02);
    cases.push({id:'late-hull-contact',name,initialHeightM:height,added,transition,...result});
  }
});

check('Conservative late-corridor refusals stay explicit and retain measured collision-free counterexamples',()=>{
  for(const forward of [30,35,40,45]){
    const blocked=fixture();roof(blocked,{forward});assert.equal(blocked.startManeuver('roll'),false);
    assert.match(blocked.status,/保守净空估计/);
    const s=fixture();assert.equal(s.startManeuver('roll'),true);const b=roof(s,{forward});
    const result=run(s,{seconds:12,postSeconds:5,obstacle:b});
    assert.equal(result.microHullContacts,0);assert.equal(result.completion?.feedback.state,'completed');
    assert.equal(result.postMinContacts,4);assert.equal(result.postMaxCommand,0);
    cases.push({id:'conservative-false-refusal',forwardM:forward,refusal:blocked.status,...result,
      limitation:'The corridor applies one peak-height envelope through the recovery reserve. These measured late roofs are refused even though the actual vehicle has already descended enough to pass. No collision is claimed or thrust/grip inflated to hide this conservative limit.'});
  }
});

check('U uses the same heading-aligned corridor without changing its pitch profile or force limits',()=>{
  const s=fixture({yaw:Math.PI/2});roof(s,{forward:15});const before=physical(s);
  assert.equal(s.startManeuver('pitch'),false);assert.equal(physical(s),before);assert.match(s.status,/滑行路径.*净空不足/);
  const open=fixture({speed:0});assert.equal(open.startManeuver('pitch'),true);
  assert.equal(open._maneuver.profile.durationS,1.8);assert.equal(open._maneuver.preflight.headroom.estimated,true);
  const result=run(open,{seconds:8});assert.equal(result.completion?.feedback.state,'completed');assert.equal(result.firstHull,null);
  cases.push({id:'pitch-shared-corridor',...result});
});

const sources=['dist/physics-kernel-319.js','dist/pitch-maneuver.js','dist/maneuver-clearance.js'];
const sourceHashes=Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
mkdirSync('qa',{recursive:true});
writeFileSync(`qa/maneuver-clearance-${REPORT_VERSION}.json`,JSON.stringify({schema:'roadster-maneuver-clearance-323',createdAt:new Date().toISOString(),modelBuildId:MODEL_BUILD_ID,status:'passed',checks,cases,sourceHashes,
  scope:'Numerical body/contact/actuator evidence. Finite constant-velocity path samples are conservative roof checks, not a collision-proof flight planner. New geometry after acceptance demonstrates the runtime abort fallback. No GPU or native keyboard claim.'},null,2)+'\n');
