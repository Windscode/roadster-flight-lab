import {writeFileSync} from 'node:fs';
import {RoadsterSim as Before} from '../qa/baseline/physics.js';
import {RoadsterSim as After} from '../dist/physics.js';

function run(sim,seconds,input={},observe){
  for(let i=0;i<Math.round(seconds*120);i++){
    const t=sim.step(1/120,input);
    if(t.fault)throw new Error(t.fault);
    observe?.(t);
  }
  return sim.telemetry();
}
function measure(Model){
  const coast=new Model();run(coast,3,{throttle:1});
  const speed=coast.body.velocity.length();run(coast,1);
  const bench=new Model({supplyMode:'bench'});bench.reset('hover');bench.startManeuver('roll');
  const hold=run(bench,11);
  const finite=new Model();finite.reset('hover');finite.startManeuver('roll');
  let minimum=Infinity,inverted=false,firstTouch=null,settledTime=null;
  const last=run(finite,12,{},t=>{
    if(t.maneuver&&t.maneuver.phase!=='land')minimum=Math.min(minimum,t.heightWorld);
    if(finite.body.quaternion.vmult({x:0,y:1,z:0}).y<-.9)inverted=true;
    if(t.simTime>2&&t.contactCount&&!firstTouch)firstTouch={time:t.simTime,verticalSpeed:t.verticalSpeed,gasKg:t.gasMass};
    if(firstTouch&&!settledTime&&t.contactCount===4&&t.speedKmh<.05)settledTime=t.simTime;
  });
  return {coastDecelerationMps2:speed-coast.body.velocity.length(),
    idleSideThrustAfterRollN:hold.nozzles.filter(n=>n.kind==='roll').reduce((s,n)=>s+n.force,0),
    steadyHoverScalarThrustN:hold.thrustN,weightN:hold.mass*9.81,
    finiteRollMinimumHeightBeforeLandingM:minimum,inverted,firstTouch,settledTime,
    gasAfter12sKg:last.gasMass,finalMode:last.mode};
}
const comparison={generatedAt:new Date().toISOString(),
  scope:'Internal model comparison. Both use their original default assumptions; thermal and control laws differ. Not vehicle measurements.',
  protocol:'120 Hz. Coast: full throttle 3 s, release 1 s. Bench: roll from hover, observe at 11 s. Finite: roll from 4 m hover, observe 12 s. First contact means positive wheel normal load, not body collision.',
  before:measure(Before),after:measure(After)};
writeFileSync(new URL('../qa/comparison.json',import.meta.url),JSON.stringify(comparison,null,2)+'\n');
console.log(JSON.stringify(comparison,null,2));
