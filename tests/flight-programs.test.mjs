import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {RoadsterSim} from '../dist/physics.js';
import {
  FlightProgramRunner,defaultProgramLibrary,defaultStage,validateProgram,
  validateProgramLibrary,validateController,parseProgramLibrary,loadProgramLibrary,
  saveProgramLibrary,loadResults,saveResults,compactResult,resultCSV,
  quaternionFromAttitude,quaternionErrorDeg,hasPilotInput,PROGRAM_STORAGE_KEY,
} from '../dist/flight-programs.js';

const dt=1/120,clone=v=>JSON.parse(JSON.stringify(v));let count=0;
function test(name,fn){fn();count++;console.log(`PASS: ${name}`);}
function program(stages,extra={}){return{id:'test',name:'调度试验',shortcut:null,supplyMode:'inherit',wind:null,stages,...extra};}
function simFixture(){
  const sim={simTime:0,mode:'hover',stabilizationMode:'off',params:{supplyMode:'bench',rollRateDegS:120,pitchRateDegS:32,yawRateDegS:46},status:'',wind:null,reference:null,maneuver:null,commands:[],autoFollow:true,rejectManeuver:false,completeAfter:Infinity,contactCount:0,holdFeasible:true,pressureLimited:false,
    body:{position:{x:10,y:4,z:20},quaternion:{x:0,y:0,z:0,w:1},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}},
    telemetry(){return{simTime:this.simTime,position:{...this.body.position},quaternion:{...this.body.quaternion},velocity:{...this.body.velocity},angularVelocity:{...this.body.angularVelocity},headingDeg:0,pitchDeg:0,rollDeg:0,mode:this.mode,stabilizationMode:this.stabilizationMode,holdActive:this.stabilizationMode==='hold',holdFeasible:this.holdFeasible,pressureLimited:this.pressureLimited,holdPositionTarget:this.reference?.position??null,holdQuaternionTarget:this.reference?.quaternion??null,contactCount:this.contactCount,verticalSpeed:this.body.velocity.y,maneuver:this.maneuver?{...this.maneuver}:null,targetAltitude:this.reference?.position.y??4,supplyMode:this.params.supplyMode,gasMass:12,energyUsedKWh:this.simTime*.001,pressureBar:300,massFlowKgS:2,allocationError:0,wind:this.getWind(),fault:this.fault??null};},
    setPoseTarget(target){this.commands.push({type:'pose',time:this.simTime,target:clone(target)});this.reference=clone(target);this.stabilizationMode='hold';return true;},
    setStabilizationMode(mode){this.commands.push({type:'stabilization',time:this.simTime,mode});this.stabilizationMode=mode;return true;},
    setMode(mode){this.mode=mode;this.commands.push({type:'mode',time:this.simTime,mode});},
    setSupplyMode(mode){this.params.supplyMode=mode;},setWind(wind){this.wind={...wind};return true;},clearWind(){this.wind=null;},getWind(){return this.wind?{...this.wind}:null;},
    startManeuver(name){this.commands.push({type:'maneuver',name,time:this.simTime});if(name==='cancel'){this.maneuver=null;return;}if(this.rejectManeuver){this.status='净空不足';return false;}this.maneuver={name,start:this.simTime};},
    advance(step=dt){this.simTime+=step;if(this.autoFollow&&this.reference){this.body.position={...this.reference.position};this.body.quaternion={...this.reference.quaternion};}if(this.maneuver&&this.simTime-this.maneuver.start>=this.completeAfter){if(this.maneuver.name==='land'){this.mode='drive';this.contactCount=4;}this.maneuver=null;}},
  };return sim;
}
function runnerFixture(sim=simFixture(),options={}){let context='lab';const finished=[],events=[];const runner=new FlightProgramRunner({getSim:()=>sim,getContext:()=>context,now:()=> '2026-10-19T03:00:00.000Z',onEvent:(type,detail)=>events.push({type,...detail}),onFinish:r=>finished.push(r),...options});return{runner,sim,finished,events,setContext:value=>context=value};}
function tick(f,n,input={}){for(let i=0;i<n;i++){const result=f.runner.stepInput(dt,input);f.sim.advance();if(i===0&&input.marker)assert.equal(result.marker,input.marker);}}
function memory(){const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value))};}

test('versioned presets round-trip with independent copies and bounded stages',()=>{
  const original=defaultProgramLibrary(),restored=parseProgramLibrary(JSON.stringify(original));assert.deepEqual(restored,original);restored.programs[0].name='改名';assert.notEqual(defaultProgramLibrary().programs[0].name,'改名');assert.equal(original.programs.length,4);
});
test('reject non-finite, coerced, unknown, over-budget and unsafe imported data',()=>{
  const base=defaultProgramLibrary();
  for(const mutate of [x=>x.version=2,x=>x.programs[0].stages[0].dyM='3',x=>x.programs[0].stages[0].dyM=null,x=>x.programs[0].stages[0].durationS=Infinity,x=>x.programs[0].stages[0].dxM=101,x=>x.programs[0].stages[0].code='body.position.y=10',x=>x.programs[0].stages=Array(13).fill(defaultStage('wait')),x=>x.programs[0].stages=Array(4).fill({type:'wait',durationS:90}),x=>x.programs[0].wind={speedMps:9,directionDeg:0,gustMps:2,gustPeriodS:0},x=>x.programs[0].stages[0].settleS=10]){const candidate=clone(base);mutate(candidate);assert.throws(()=>validateProgramLibrary(candidate));}
  assert.throws(()=>parseProgramLibrary('{"schema":"roadster.flight-program-library","version":1,"__proto__":{}}'));
  assert.throws(()=>parseProgramLibrary(' '.repeat(131073)));assert.throws(()=>parseProgramLibrary('{not json}'));assert.throws(()=>validateController({velocityGain:8.01}));
});
test('shortcut conflicts and all reserved game/browser keys are rejected',()=>{
  const base=defaultProgramLibrary();base.programs[1].shortcut=base.programs[0].shortcut;assert.throws(()=>validateProgramLibrary(base),/冲突/);
  for(const code of ['KeyG','KeyX','KeyQ','Digit1','Digit2','Numpad3','F5','Escape','KeyW','KeyU'])assert.throws(()=>validateProgram(program([{type:'wait',durationS:1}],{shortcut:code})));
  const duplicate=defaultProgramLibrary();duplicate.programs[1].id=duplicate.programs[0].id;assert.throws(()=>validateProgramLibrary(duplicate),/重复 ID/);
});
test('controller persistence validates before writing and corruption falls back visibly',()=>{
  const storage=memory(),library=defaultProgramLibrary();library.controller={positionGain:3,rollRateDegS:150};saveProgramLibrary(storage,library);assert.deepEqual(loadProgramLibrary(storage).library,library);
  const previous=storage.getItem(PROGRAM_STORAGE_KEY);assert.throws(()=>saveProgramLibrary(storage,{...library,version:9}));assert.equal(storage.getItem(PROGRAM_STORAGE_KEY),previous);
  storage.setItem(PROGRAM_STORAGE_KEY,'{broken');const loaded=loadProgramLibrary(storage);assert.ok(loaded.warning);assert.equal(loaded.library.programs.length,4);
});
test('attitude convention raises the nose and quaternion error ignores sign',()=>{
  const q=quaternionFromAttitude(30,0,0),fy=2*(q.y*q.z-q.w*q.x);assert.ok(Math.abs(fy-.5)<1e-12);
  const opposite=Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v]));assert.ok(quaternionErrorDeg(q,opposite)<1e-6);
  const yaw=quaternionFromAttitude(0,0,90);assert.ok(Math.abs(2*(yaw.x*yaw.z+yaw.w*yaw.y)-1)<1e-12);
  assert.ok(Math.abs(quaternionErrorDeg({x:0,y:0,z:0,w:1},quaternionFromAttitude(0,90,0))-90)<1e-9);
});
test('fixed-step schedule is identical across rendering frame groupings',()=>{
  function execute(groups){const f=runnerFixture();f.runner.start(program([{type:'wait',durationS:.25},{type:'rate',axis:'roll',rateDegS:60,durationS:.5},{type:'wait',durationS:.25}]));const outputs=[];for(const size of groups)for(let j=0;j<size;j++){outputs.push(f.runner.stepInput(dt,{}).roll||0);f.sim.advance();}return{outputs,events:f.events,commands:f.sim.commands,result:f.finished[0]};}
  const a=execute(Array(60).fill(3)),b=execute(Array(30).fill(6));assert.deepEqual(a,b);assert.equal(a.outputs.filter(v=>v===.5).length,60);assert.equal(a.result.status,'completed');assert.ok(Math.abs(a.result.durationS-1)<1e-8);
});
test('pose stages issue references only and preserve initial full quaternion',()=>{
  const f=runnerFixture();f.sim.body.quaternion=quaternionFromAttitude(13,37,81);const before=clone(f.sim.body);f.runner.start(program([{...defaultStage(),dxM:3,dyM:2,dzM:-4,durationS:.5}]));assert.deepEqual(f.sim.body,before);assert.deepEqual(f.sim.reference.position,{x:13,y:6,z:16});assert.deepEqual(f.sim.reference.quaternion,before.quaternion);assert.equal(f.sim.stabilizationMode,'hold');
  tick(f,61);assert.equal(f.finished[0].status,'completed');assert.equal(f.sim.stabilizationMode,'hold');assert.deepEqual(f.sim.reference.quaternion,before.quaternion);
});
test('every pilot axis cancels immediately without changing pilot values or rigid-body state',()=>{
  for(const input of [{throttle:.1},{steer:-.1},{lift:-1},{roll:1},{pitch:-1},{brake:1},{frontJets:1},{rearJets:1},{boost:true}]){
    const f=runnerFixture();f.runner.start(program([defaultStage()]));const before=clone(f.sim.body),pilot={...input,marker:7};assert.equal(f.runner.stepInput(dt,pilot),pilot);assert.deepEqual(f.sim.body,before);assert.equal(f.finished[0].status,'cancelled');assert.equal(f.sim.stabilizationMode,'off');
  }
  assert.equal(hasPilotInput({roll:.01}),false);assert.equal(hasPilotInput({pitch:NaN}),false);
});
test('scene changes and reset cancel on original simulation and restore its wind / supply',()=>{
  const original=simFixture(),second=simFixture();original.wind={speedMps:3,directionDeg:20,gustMps:1,gustPeriodS:8};let current=original;const f=runnerFixture(original,{getSim:()=>current});f.runner.start(program([{type:'wait',durationS:2}],{supplyMode:'finite',wind:{speedMps:10,directionDeg:90,gustMps:3,gustPeriodS:4}}));assert.equal(original.params.supplyMode,'finite');current=second;f.runner.stepInput(dt,{});assert.equal(f.finished[0].status,'cancelled');assert.equal(original.params.supplyMode,'bench');assert.equal(original.wind.speedMps,3);assert.equal(second.wind,null);
  const r=runnerFixture();r.sim.simTime=20;r.runner.start(program([{type:'wait',durationS:2}]));r.sim.simTime=0;r.runner.stepInput(dt,{});assert.equal(r.finished[0].status,'cancelled');
});
test('wind preset changes only references and restores prior settings after completion',()=>{
  const f=runnerFixture();f.sim.wind={speedMps:35,directionDeg:30,gustMps:1,gustPeriodS:80};const previous=clone(f.sim.wind);f.runner.start(program([{type:'wind',durationS:.25,wind:{speedMps:5,directionDeg:90,gustMps:3,gustPeriodS:4}},{type:'wind',durationS:.25,wind:null}],{supplyMode:'finite'}));assert.equal(f.sim.wind.speedMps,5);tick(f,31);assert.equal(f.sim.wind,null);tick(f,31);assert.equal(f.finished[0].status,'completed');assert.deepEqual(f.sim.wind,previous);assert.equal(f.sim.params.supplyMode,'bench');
});
test('continuous rotation is rate bounded, can span 360°, then captures measured attitude',()=>{
  const f=runnerFixture();f.sim.params.rollRateDegS=90;f.runner.start(program([{type:'rate',axis:'roll',rateDegS:180,durationS:4}]));assert.equal(f.runner.getState().effectiveRateDegS,90);let commandedAngle=0;for(let i=0;i<480;i++){const input=f.runner.stepInput(dt,{});assert.equal(input.roll,1);commandedAngle+=input.roll*90*dt;f.sim.advance();}assert.ok(Math.abs(commandedAngle-360)<1e-8);
  f.sim.body.quaternion=quaternionFromAttitude(0,51,0);const before=clone(f.sim.body);f.runner.stepInput(dt,{});assert.deepEqual(f.sim.body,before);assert.deepEqual(f.sim.reference.quaternion,before.quaternion);assert.equal(f.finished[0].status,'completed');assert.equal(f.sim.stabilizationMode,'hold');
});
test('settling stage needs sustained measured stability and records unreachable timeout honestly',()=>{
  const stable=runnerFixture();stable.runner.start(program([{...defaultStage(),dyM:0,durationS:1,exit:'settled',settleS:.25}]));tick(stable,61);assert.equal(stable.finished[0].status,'completed');assert.notEqual(stable.finished[0].stages[0].settlingTimeS,null);
  const unreachable=runnerFixture();unreachable.sim.autoFollow=false;unreachable.sim.holdFeasible=false;unreachable.runner.start(program([{...defaultStage(),durationS:.5,exit:'settled',settleS:.25}]));tick(unreachable,62);assert.equal(unreachable.finished[0].status,'timeout');assert.equal(unreachable.finished[0].stages[0].settlingTimeS,null);assert.ok(unreachable.finished[0].summary.peakPositionErrorM>=2);
});
test('builtin maneuver completion is observed; precheck refusal and timeout never succeed',()=>{
  const completed=runnerFixture();completed.sim.completeAfter=.4;completed.runner.start(program([{type:'roll',durationS:1}]));tick(completed,121);assert.equal(completed.finished[0].status,'completed');assert.ok(completed.finished[0].durationS<.6);assert.equal(completed.sim.stabilizationMode,'hold');
  const timeout=runnerFixture();timeout.runner.start(program([{type:'roll',durationS:.5}]));tick(timeout,62);assert.equal(timeout.finished[0].status,'timeout');assert.equal(timeout.sim.maneuver,null);
  const refused=runnerFixture();refused.sim.rejectManeuver=true;assert.throws(()=>refused.runner.start(program([{type:'roll',durationS:1}])));assert.equal(refused.finished[0].status,'failed');
});
test('landing requires contact and descent convergence and remains drive after success',()=>{
  const f=runnerFixture();f.sim.completeAfter=.3;f.runner.start(program([{type:'land',durationS:1}]));tick(f,121);assert.equal(f.finished[0].status,'completed');assert.equal(f.sim.mode,'drive');assert.equal(f.sim.reference,null);
  const missing=runnerFixture();missing.runner.start(program([{type:'land',durationS:.5}]));tick(missing,12);missing.sim.maneuver=null;tick(missing,20);assert.equal(missing.finished[0].status,'failed');assert.match(missing.finished[0].reason,/接触/);
});
test('20 Hz gas accounting measures bench throughput instead of reservoir difference',()=>{
  const f=runnerFixture();f.runner.start(program([{type:'wait',durationS:1}]));tick(f,121);const r=f.finished[0];assert.equal(r.status,'completed');assert.ok(Math.abs(r.summary.gasThroughputKg-2)<1e-8);assert.equal(r.summary.gasRemainingKg,12);assert.equal(r.samples.length,21);for(let i=1;i<r.samples.length;i++)assert.ok(Math.abs(r.samples[i].timeS-r.samples[i-1].timeS-.05)<1e-8);assert.ok(resultCSV(r).includes('massFlowKgS'));
});
test('bounded result persistence retains honest outcome and compact samples',()=>{
  const f=runnerFixture();f.runner.start(program([{type:'wait',durationS:12}]));tick(f,1441);const result=f.finished[0],compact=compactResult(result);assert.ok(compact.samples.length<=181);assert.ok(result.samples.length>compact.samples.length);assert.equal(compact.samples.at(-1).timeS,result.samples.at(-1).timeS);
  const storage=memory();saveResults(storage,[result]);const loaded=loadResults(storage);assert.equal(loaded.length,1);assert.equal(loaded[0].status,'completed');assert.ok(loaded[0].samples.length<=181);
});
const physicalResults=[];
function runPhysicalPreset(preset,airborne=false){
  // The slower, pilot-bounded roll needs an open sky. The wind laboratory's
  // 24.1 m beam is a real obstacle, not an unlimited numerical fixture.
  const world=preset.id==='roll-return'?'city':'windlab';
  const sim=new RoadsterSim({}, {world});
  if(world==='city'&&airborne){sim.reset('hover');const t=sim.telemetry();assert.equal(sim.setPoseTarget({position:t.position,quaternion:t.quaternion}),true);}
  for(let i=0;i<240;i++)sim.step(dt,{});
  if(airborne&&world==='windlab'){const t=sim.telemetry();assert.equal(sim.setPoseTarget({position:{...t.position,y:4},quaternion:t.quaternion}),true);for(let i=0;i<1200;i++)sim.step(dt,{});}
  const initial=sim.telemetry();let result;const runner=new FlightProgramRunner({getSim:()=>sim,getContext:()=> world==='city'?'city':'lab',now:()=> '2026-10-19T03:00:00.000Z',onFinish:r=>result=r});runner.start(preset);
  let minHeight=initial.heightWorld,maxHeight=initial.heightWorld,samples=0;
  const maxSteps=Math.ceil(preset.stages.reduce((n,s)=>n+s.durationS,0)/dt)+120;
  for(let i=0;i<maxSteps&&runner.active;i++){const t=sim.step(dt,(_,fixed)=>runner.stepInput(fixed,{}),()=>samples++);minHeight=Math.min(minHeight,t.heightWorld);maxHeight=Math.max(maxHeight,t.heightWorld);assert.equal(t.fault,null);}
  assert.ok(result,'program produced an outcome');assert.equal(result.status,'completed',result.reason);const end=sim.telemetry();
  physicalResults.push({preset:preset.id,world,scenario:sim.scenario,initialState:airborne?'airborne':'ground',status:result.status,durationS:result.durationS,positionStart:initial.position,positionEnd:end.position,minHeightM:minHeight,maxHeightM:maxHeight,finalMode:end.mode,finalContacts:end.contactCount,finalThrustN:end.thrustN,sampleCallbacks:samples,summary:result.summary,stages:result.stages});
  return{sim,result,initial,end};
}
test('actual rigid-body pose-step preset reaches its target without state assignment',()=>{
  const {result,end}=runPhysicalPreset(defaultProgramLibrary().programs.find(p=>p.id==='pose-step'));
  assert.ok(result.summary.finalPositionErrorM<.1);assert.ok(result.summary.finalAttitudeErrorDeg<3);assert.equal(result.summary.finalFeasible,true);assert.equal(end.mode,'hover');
});
test('actual gust-rejection preset measures crosswind response and restores calm',()=>{
  const {sim,result,end}=runPhysicalPreset(defaultProgramLibrary().programs.find(p=>p.id==='gust-rejection'));
  assert.equal(sim.getWind(),null);assert.ok(result.summary.finalPositionErrorM<.1);assert.equal(end.mode,'hover');assert.ok(result.stages[1].peakPositionErrorM>0);assert.equal(result.stages[1].type,'wind');
});
test('actual wind-laboratory beam rejects a default roll without changing rigid-body state',()=>{
  const sim=new RoadsterSim({}, {world:'windlab'});for(let i=0;i<240;i++)sim.step(dt,{});
  const state=()=>JSON.stringify([sim.body.position,sim.body.quaternion,sim.body.velocity,sim.body.angularVelocity]);
  const before=state(),initial=sim.telemetry();let result;
  const runner=new FlightProgramRunner({getSim:()=>sim,getContext:()=> 'lab',onFinish:r=>result=r});
  assert.throws(()=>runner.start(defaultProgramLibrary().programs.find(p=>p.id==='roll-return')),/上方净空不足/);
  assert.equal(state(),before);assert.equal(runner.active,null);assert.equal(sim.telemetry().maneuver,null);assert.equal(result.status,'failed');
  physicalResults.push({preset:'roll-return',world:'windlab',scenario:'windlab',initialState:'ground',status:result.status,reason:result.reason,positionStart:initial.position,positionEnd:sim.telemetry().position,rigidBodyUnchanged:true});
});
test('actual ground-start roll preset only completes after physically returning to ground',()=>{
  const {sim,result,initial,end}=runPhysicalPreset(defaultProgramLibrary().programs.find(p=>p.id==='roll-return'));
  assert.equal(end.mode,'drive');assert.ok(end.contactCount>0);assert.ok(Math.abs(end.heightWorld-initial.heightWorld)<.3);assert.ok(result.durationS>3);for(let i=0;i<120;i++)sim.step(dt,{});assert.ok(sim.telemetry().thrustN<1);
});
test('actual airborne roll preset finishes near starting height and keeps physical hold',()=>{
  const {result,initial,end}=runPhysicalPreset(defaultProgramLibrary().programs.find(p=>p.id==='roll-return'),true);
  assert.equal(end.mode,'hover');assert.equal(end.contactCount,0);assert.equal(end.stabilizationMode,'hold');assert.ok(Math.abs(end.heightWorld-initial.heightWorld)<.6);assert.ok(result.durationS>3);
});
test('actual finite-tank preset lands and preserves measured consumption when supply restores',()=>{
  const {sim,result,initial,end}=runPhysicalPreset(defaultProgramLibrary().programs.find(p=>p.id==='finite-budget'));
  assert.equal(end.mode,'drive');assert.ok(end.contactCount>0);assert.ok(end.gasMass<initial.gasMass);assert.ok(result.summary.gasThroughputKg>150);assert.ok(Math.abs((initial.gasMass-end.gasMass)-result.summary.gasThroughputKg)<1);assert.equal(sim.params.supplyMode,'bench');
});
const sourceFiles=['dist/flight-programs.js','dist/research-console.js','dist/research-console.css','dist/physics.js','dist/wind-lab-data.js','tests/flight-programs.test.mjs'];
const hashes=Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(new URL(`../${file}`,import.meta.url))).digest('hex')]));
const report={version:'3.11',pass:true,groups:count,schedulerAndSchemaGroups:16,actualPhysicsGroups:6,physicsHz:120,metricsHz:20,sourceHashes:hashes,physicalResults,limitations:'Deterministic analytic-wind and rigid-body model. Interface-fixture schedule tests are listed separately from actual physics preset runs. Authored wind-lab geometry, its real roll refusal, open-city roll starts and default parameters are covered; arbitrary obstacles, user-defined controls and unsupported sustained attitudes are not certified. No browser rendering or real vehicle validity claim.'};
fs.writeFileSync(new URL('../qa/flight-programs-3.11.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(`Flight program regression complete: ${count} groups; 16 scheduler/schema interface groups and 6 actual 120 Hz rigid-body preset / refusal checks.`);
