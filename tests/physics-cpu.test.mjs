import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RoadsterSim,PHYSICS_HZ} from '../dist/physics.js';
import {StaticCityBroadphase} from '../dist/static-city-broadphase.js';
import * as CANNON from '../dist/vendor/cannon-es.js';

// Frozen reference algorithm from commit 4a5cae1. Keeping it independent catches
// missing candidates and ordering changes in the production query cache.
class LegacyStaticCityBroadphase extends CANNON.Broadphase {
  constructor(world,cellSize=40){
    super();this.useBoundingBoxes=true;this.cellSize=cellSize;this.cells=new Map();this._indexDirty=true;
    this.world=world;const invalidate=()=>{this._indexDirty=true;};
    world.addEventListener('addBody',invalidate);world.addEventListener('removeBody',invalidate);
  }
  _range(aabb){const s=this.cellSize;return[Math.floor(aabb.lowerBound.x/s),Math.floor(aabb.upperBound.x/s),Math.floor(aabb.lowerBound.z/s),Math.floor(aabb.upperBound.z/s)];}
  _refresh(world){
    if(!this._indexDirty)return;this.cells.clear();
    for(const b of world.bodies){if(b.type!==CANNON.Body.STATIC)continue;if(b.aabbNeedsUpdate)b.updateAABB();
      const [x0,x1,z0,z1]=this._range(b.aabb);
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z,list=this.cells.get(key)||[];list.push(b);this.cells.set(key,list);}
    }
    this._indexDirty=false;this.dirty=false;
  }
  _query(aabb){
    const [x0,x1,z0,z1]=this._range(aabb),seen=new Set(),out=[];
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)for(const b of this.cells.get(x+','+z)||[]){if(seen.has(b.id))continue;seen.add(b.id);if(b.aabb.overlaps(aabb))out.push(b);}
    return out;
  }
  collisionPairs(world,p1,p2){
    this._refresh(world);const moving=world.bodies.filter(b=>b.type!==CANNON.Body.STATIC);
    for(const b of moving){if(b.aabbNeedsUpdate)b.updateAABB();for(const s of this._query(b.aabb))if(this.needBroadphaseCollision(b,s))this.intersectionTest(b,s,p1,p2);}
    for(let i=0;i<moving.length;i++)for(let j=i+1;j<moving.length;j++)if(this.needBroadphaseCollision(moving[i],moving[j]))this.intersectionTest(moving[i],moving[j],p1,p2);
  }
  aabbQuery(world,aabb,result=[]){
    this._refresh(world);result.push(...this._query(aabb));
    for(const b of world.bodies)if(b.type!==CANNON.Body.STATIC){if(b.aabbNeedsUpdate)b.updateAABB();if(b.aabb.overlaps(aabb))result.push(b);}
    return result;
  }
}
const report={status:'passed',referenceCommit:'4a5cae1',runtime:process.version,physicsHz:PHYSICS_HZ,checks:[]};
const pass=name=>{report.checks.push(name);console.log('PASS: '+name);};
const ids=bs=>bs.map(b=>b.id),vec=v=>[v.x,v.y,v.z];
const bodyName=b=>b.userData?.id??'car';
const contacts=world=>world.contacts.map(c=>({
  bodies:[bodyName(c.bi),bodyName(c.bj)],shapes:[c.bi.shapes.indexOf(c.si),c.bj.shapes.indexOf(c.sj)],
  ni:vec(c.ni),ri:vec(c.ri),rj:vec(c.rj),enabled:c.enabled,restitution:c.restitution,multiplier:c.multiplier
}));
const pairIds=(bp,world)=>{const a=[],b=[];bp.collisionPairs(world,a,b);return a.map((v,i)=>[v.id,b[i].id]);};
const unordered=ps=>ps.map(p=>[...p].sort((a,b)=>a-b).join(':')).sort();
function useLegacy(sim){
  sim.world.broadphase=new LegacyStaticCityBroadphase(sim.world);
  sim.world.collisionMatrix=new CANNON.ArrayCollisionMatrix();
  sim.world.collisionMatrixPrevious=new CANNON.ArrayCollisionMatrix();
  sim.world.collisionMatrix.setNumObjects(sim.world.bodies.length);
  sim.world.collisionMatrixPrevious.setNumObjects(sim.world.bodies.length);
  return sim;
}
let seed=37954;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};

// The shipped Cannon matrices share a boolean interface, but sparse keys use body
// IDs rather than indices. Check symmetry, false writes and tick/reset semantics.
{
  const s=new RoadsterSim(),dense=new CANNON.ArrayCollisionMatrix(),sparse=new CANNON.ObjectCollisionMatrix();
  assert.ok(s.world.collisionMatrix instanceof CANNON.ObjectCollisionMatrix);
  assert.ok(s.world.collisionMatrixPrevious instanceof CANNON.ObjectCollisionMatrix);
  const bodies=s.world.bodies;dense.setNumObjects(bodies.length);sparse.setNumObjects(bodies.length);
  for(let k=0;k<100;k++){
    const a=bodies[Math.floor(rand()*bodies.length)],b=bodies[Math.floor(rand()*bodies.length)];if(a===b)continue;
    dense.set(a,b,true);sparse.set(a,b,true);assert.equal(!!dense.get(a,b),sparse.get(a,b));assert.equal(!!dense.get(b,a),sparse.get(b,a));
    dense.set(b,a,false);sparse.set(b,a,false);assert.equal(!!dense.get(a,b),sparse.get(a,b));
  }
  dense.set(bodies[0],bodies.at(-1),true);sparse.set(bodies[0],bodies.at(-1),true);dense.reset();sparse.reset();
  assert.equal(!!dense.get(bodies[0],bodies.at(-1)),sparse.get(bodies[0],bodies.at(-1)));
  report.cityBodies=bodies.length;report.densePairsPerMatrix=bodies.length*(bodies.length-1)/2;
}
pass('Native sparse contact history retains symmetric get/set/reset semantics and is the production default');

{
  const s=new RoadsterSim(),grid=s.world.broadphase,legacy=new LegacyStaticCityBroadphase(s.world),naive=new CANNON.NaiveBroadphase();naive.useBoundingBoxes=true;
  let hits=0;
  for(let i=0;i<240;i++){
    const x=rand()*1200-600,z=rand()*1200-600,y=rand()*65;
    const box=new CANNON.AABB({lowerBound:new CANNON.Vec3(x-3,y-5,z-4),upperBound:new CANNON.Vec3(x+3,y+5,z+4)});
    assert.deepEqual(ids(grid.aabbQuery(s.world,box)),ids(legacy.aabbQuery(s.world,box)),'candidate ordering must match the old grid');
    assert.deepEqual(ids(grid.aabbQuery(s.world,box)).sort((a,b)=>a-b),ids(naive.aabbQuery(s.world,box)).sort((a,b)=>a-b));
    const from=new CANNON.Vec3(x,180,z),to=new CANNON.Vec3(x+rand()*15-7.5,-2,z+rand()*15-7.5);
    const cast=bp=>{s.world.broadphase=bp;const r=new CANNON.RaycastResult();s.world.raycastClosest(from,to,{collisionFilterMask:1,collisionFilterGroup:2,skipBackfaces:true},r);return r.hasHit?{body:r.body.id,distance:r.distance,point:vec(r.hitPointWorld),normal:vec(r.hitNormalWorld)}:null;};
    const a=cast(grid),b=cast(legacy),c=cast(naive);assert.deepEqual(a,b);assert.deepEqual(a,c);if(a)hits++;
    if(i<24){
      s.body.position.set(x,y,z);s.body.quaternion.setFromEuler(rand()*3,rand()*6,rand()*3);s.body.aabbNeedsUpdate=true;
      const pairs=pairIds(grid,s.world);assert.deepEqual(pairs,pairIds(legacy,s.world));assert.deepEqual(unordered(pairs),unordered(pairIds(naive,s.world)));
    }
  }
  assert.ok(hits>150);s.world.broadphase=grid;
  report.cityQueries={aabb:240,rays:240,rayHits:hits,collisionPoses:24,reference:'Frozen 3.4 grid and independent Cannon NaiveBroadphase'};
}
pass('Actual-city AABB candidates, ordering, closest rays and collision pairs match both old grid and full reference scan');

{
  const world=new CANNON.World(),grid=new StaticCityBroadphase(world,4),legacy=new LegacyStaticCityBroadphase(world,4),naive=new CANNON.NaiveBroadphase();naive.useBoundingBoxes=true;
  const add=(id,mass,x)=>{const b=new CANNON.Body({mass,position:new CANNON.Vec3(x,0,0)});b.userData={id};b.addShape(new CANNON.Box(new CANNON.Vec3(1,1,1)));world.addBody(b);return b;};
  const ground=add('fixed',0,0),mover=add('mover',1,1),tail=add('tail',1,8);
  const bounds=new CANNON.AABB({lowerBound:new CANNON.Vec3(-10,-10,-10),upperBound:new CANNON.Vec3(10,10,10)});
  const check=(old=true)=>{
    assert.deepEqual(ids(grid.aabbQuery(world,bounds)).sort((a,b)=>a-b),ids(naive.aabbQuery(world,bounds)).sort((a,b)=>a-b));
    assert.deepEqual(unordered(pairIds(grid,world)),unordered(pairIds(naive,world)));
    if(old){assert.deepEqual(ids(grid.aabbQuery(world,bounds)),ids(legacy.aabbQuery(world,bounds)));assert.deepEqual(pairIds(grid,world),pairIds(legacy,world));}
  };
  check();mover.position.x=8;mover.aabbNeedsUpdate=true;check();world.removeBody(tail);check();
  const newcomer=add('newcomer',1,.5);check();world.removeBody(ground);check();
  const fresh=add('fresh-static',0,.5);check();
  fresh.position.x=22;fresh.aabbNeedsUpdate=true;grid.invalidate();legacy._indexDirty=true;check();
  newcomer.type=CANNON.Body.STATIC;newcomer.mass=0;newcomer.updateMassProperties();grid.invalidate();check(false);
  newcomer.type=CANNON.Body.DYNAMIC;newcomer.mass=1;newcomer.updateMassProperties();grid.invalidate();check(false);
  grid._queryVersion=Number.MAX_SAFE_INTEGER;check(false);
  assert.deepEqual(grid.moving,[mover,newcomer]);
}
pass('Cached dynamic body membership handles add/remove, movement, explicit static/type invalidation and query counter rollover');

{
  function create(sparse){
    const w=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});w.broadphase=new StaticCityBroadphase(w,4);
    if(sparse){w.collisionMatrix=new CANNON.ObjectCollisionMatrix();w.collisionMatrixPrevious=new CANNON.ObjectCollisionMatrix();}
    const log=[];w.addEventListener('beginContact',e=>log.push(['begin',bodyName(e.bodyA),bodyName(e.bodyB)].sort()));w.addEventListener('endContact',e=>log.push(['end',bodyName(e.bodyA),bodyName(e.bodyB)].sort()));
    const add=(id,mass,y)=>{const b=new CANNON.Body({mass,position:new CANNON.Vec3(0,y,0),allowSleep:false});b.userData={id};b.addShape(new CANNON.Box(new CANNON.Vec3(mass?.5:10,.5,mass?.5:10)));b.addEventListener('collide',e=>log.push(['collide',id,bodyName(e.body)]));w.addBody(b);return b;};
    add('floor',0,-.5);const body=add('drop',1,1.2);return{w,body,add,log};
  }
  const a=create(false),b=create(true);
  let contactFrames=0;
  for(let i=0;i<480;i++){
    if(i===200)for(const s of[a,b])s.body.applyImpulse(new CANNON.Vec3(0,4,0));
    if(i===300)for(const s of[a,b]){s.extra=s.add('added-body',1,4);s.extra.position.x=5;}
    if(i===420)for(const s of[a,b])s.w.removeBody(s.extra);
    a.w.step(1/PHYSICS_HZ);b.w.step(1/PHYSICS_HZ);
    assert.deepEqual(vec(a.body.position),vec(b.body.position));assert.deepEqual(vec(a.body.velocity),vec(b.body.velocity));
    assert.deepEqual(contacts(a.w),contacts(b.w));assert.deepEqual(a.log,b.log);
    for(let j=0;j<a.w.bodies.length;j++)for(let k=j+1;k<a.w.bodies.length;k++){
      assert.equal(!!a.w.collisionMatrix.get(a.w.bodies[j],a.w.bodies[k]),b.w.collisionMatrix.get(b.w.bodies[j],b.w.bodies[k]));
      assert.equal(!!a.w.collisionMatrixPrevious.get(a.w.bodies[j],a.w.bodies[k]),b.w.collisionMatrixPrevious.get(b.w.bodies[j],b.w.bodies[k]));
    }
    if(a.w.contacts.length)contactFrames++;
  }
  assert.ok(contactFrames>100);assert.ok(a.log.some(v=>v.includes('begin')));assert.ok(a.log.some(v=>v.includes('end')));assert.ok(a.log.some(v=>v.includes('collide')));
  report.contactEvents={steps:480,contactFrames,events:a.log.length,exactContactEquationAgreement:true,exactBeginEndCollideAgreement:true};
}
pass('Dense/sparse worlds have identical contact equations, matrix history, begin/end/collide events and trajectories through separation and dynamic add/remove');

{
  const cases=[
    {name:'ground-driving-and-braking',scenario:'city',steps:240,input:i=>i<160?{throttle:.3,steer:i>90?.12:0}:{brake:.7}},
    {name:'inverted-ceiling-adhesion',scenario:'ceiling',steps:150,input:i=>({throttle:i>80?.12:0})},
    {name:'captured-pose-and-position',scenario:'free',steps:240,setup:s=>{s.body.position.set(0,12,-350);s.body.quaternion.setFromEuler(.16,.23,.32);s.body.velocity.set(1.5,-.5,-1);s.body.angularVelocity.set(.1,-.08,.13);s.setStabilizationMode('hold');},input:()=>({})},
    {name:'hull-ground-contact',scenario:'free',steps:120,setup:s=>{s.body.position.set(0,.3,-350);s.body.quaternion.setFromEuler(.3,.2,.5);s.setMode('manual');},input:()=>({})}
  ];
  report.trajectoryEquivalence=[];
  for(const c of cases){
    const a=useLegacy(new RoadsterSim()),b=new RoadsterSim();for(const s of[a,b]){s.reset(c.scenario);c.setup?.(s);s.body.aabbNeedsUpdate=true;}
    let contactFrames=0;
    for(let i=0;i<c.steps;i++){
      const input=c.input(i);const ta=a.step(1/PHYSICS_HZ,input),tb=b.step(1/PHYSICS_HZ,input);
      assert.deepEqual(tb,ta,c.name+' entire telemetry at fixed step '+i);assert.deepEqual(contacts(b.world),contacts(a.world),c.name+' contact equations');
      assert.equal(ta.fault,null);if(a.world.contacts.length)contactFrames++;
    }
    if(c.name==='hull-ground-contact')assert.ok(contactFrames>0);
    report.trajectoryEquivalence.push({scenario:c.name,fixedSteps:c.steps,contactFrames,maximumStateDifference:0,entireTelemetryExact:true});
  }
}
pass('Old-grid/dense and optimized/sparse Roadster trajectories match exactly for tires, ceiling adhesion, six-DOF hold and hull contacts');

{
  const a=useLegacy(new RoadsterSim()),b=new RoadsterSim();a.reset('city');b.reset('city');
  const sample={legacy:{frame:[],matrix:0,query:0},optimized:{frame:[],matrix:0,query:0}};
  let measuring=false;
  for(const[s,key]of[[a,'legacy'],[b,'optimized']])for(const[obj,method,bucket]of[[s.world,'collisionMatrixTick','matrix'],[s.world.broadphase,'aabbQuery','query']]){
    const original=obj[method];obj[method]=function(...args){const start=performance.now(),result=original.apply(this,args);if(measuring)sample[key][bucket]+=performance.now()-start;return result;};
  }
  for(let i=0;i<240;i++){
    measuring=i>=60;const order=i%2?[[a,'legacy'],[b,'optimized']]:[[b,'optimized'],[a,'legacy']];
    for(const[s,key]of order){const start=performance.now();s.step(1/60,{throttle:.2});if(measuring)sample[key].frame.push(performance.now()-start);}
  }
  assert.deepEqual(b.telemetry(),a.telemetry());
  const percentile=(sorted,p)=>sorted[Math.floor((sorted.length-1)*p)];
  const summarize=v=>{const ordered=[...v.frame].sort((x,y)=>x-y),total=v.frame.reduce((s,x)=>s+x,0);return{frames:ordered.length,medianMs:percentile(ordered,.5),p95Ms:percentile(ordered,.95),meanMs:total/ordered.length,matrixMs:v.matrix,rayBroadphaseMs:v.query,totalMs:total,matrixShare:v.matrix/total,rayBroadphaseShare:v.query/total};};
  report.benchmark={scope:'Node CPU only; 60 warm-up frames followed by 180 timed 60 Hz frames, two unchanged 120 Hz physics steps per frame. Alternating execution order; same process and input. Shared-machine timing is comparative and is not browser FPS.',legacy:summarize(sample.legacy),optimized:summarize(sample.optimized)};
  report.benchmark.medianReduction=1-report.benchmark.optimized.medianMs/report.benchmark.legacy.medianMs;
  report.benchmark.p95Reduction=1-report.benchmark.optimized.p95Ms/report.benchmark.legacy.p95Ms;
  report.benchmark.densePairSlotsClearedPerSecond=report.densePairsPerMatrix*PHYSICS_HZ;
  report.benchmark.optimizedContactEntriesAtEnd=Object.keys(b.world.collisionMatrix.matrix).length;
  assert.ok(Number.isFinite(report.benchmark.medianReduction)); // Timing is never a flaky pass/fail gate.
}
pass('Warm-up CPU benchmark records relative cost with unchanged physical rate, collider set and numerical output');

report.sourceHashes=Object.fromEntries(['dist/physics.js','dist/static-city-broadphase.js','dist/vendor/cannon-es.js'].map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]));
writeFileSync(new URL('../qa/physics-cpu-3.8.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.benchmark,null,2));
