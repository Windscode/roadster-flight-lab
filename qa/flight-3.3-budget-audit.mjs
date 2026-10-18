import {readFileSync,writeFileSync} from 'node:fs';
const base=new URL('./physics-3.2-handling-reference.mjs',import.meta.url);
const src=readFileSync(base,'utf8');
const variants={
 original:src,
 short:src.replace("this.body.position.y<7?'climb'","this.body.position.y<5.8?'climb'").replace('Math.max(9,this.body.position.y)','Math.max(7.2,this.body.position.y)').replace('if(b.position.y>7 && Math.abs(b.velocity.y)<3)','if(b.position.y>5.8 && Math.abs(b.velocity.y)<3.6)').replace("this._heightTarget=3;this._heightIntegral=0;","this._heightTarget=2;this._heightIntegral=0;").replace("a.time>.5 && Math.abs(angles.roll)<.08","a.time>.18 && Math.abs(angles.roll)<.12").replace("Math.abs(b.position.y-3)<.35","Math.abs(b.position.y-2)<.7"),
 directLand:src.replace("this.body.position.y<7?'climb'","this.body.position.y<6?'climb'").replace('Math.max(9,this.body.position.y)','Math.max(7.4,this.body.position.y)').replace('if(b.position.y>7 && Math.abs(b.velocity.y)<3)','if(b.position.y>6 && Math.abs(b.velocity.y)<3.4)').replace("a.phase='recover';a.time=0;this._positionTarget.copy(b.position);this._heightTarget=3;this._heightIntegral=0;","a.phase='land';a.time=0;this._positionTarget.copy(b.position);this._heightTarget=b.position.y;this._heightIntegral=0;")
};
const dt=1/120,results=[];
for(const [variant,source] of Object.entries(variants)){
 const url=new URL('./physics-flight-'+variant+'.mjs',import.meta.url);writeFileSync(url,source);const {RoadsterSim}=await import(url);
 for(const engine of ['650','570','550','500','nozzle-eta90'])for(const maneuver of ['roll','hop']){
  const s=new RoadsterSim({exhaustVelocity:engine==='nozzle-eta90'?570:Number(engine)});
  for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.body.position.set(0,.62,-350);for(let i=0;i<240;i++)s.step(dt);
  if(maneuver==='roll')s.startManeuver('roll');else{s.setMode('hover');s.setParam('hoverHeight',2);}
  let lastPhase,transition=[],lowestAir=Infinity,maxHeight=0,landedTime=null,impactSpeed=0,minMass=s.gasMass,impulse=0,clampTime=null,previousV=0,fullTurns=false,previousRoll=0,continuousRoll=0;
  for(let i=0;i<12*120;i++){
   if(engine==='nozzle-eta90')s.params.exhaustVelocity=.9*Math.sqrt(2*1.4/.4*287.05*s.gasTemperature*Math.max(0,1-(1/Math.max(1.00001,Math.min(s.pressureBar(),50)))**(.4/1.4)));
   const t=s.step(dt);
   if(maneuver==='hop'&&i===2*120)s.startManeuver('land');
   impulse+=t.thrustN*dt;minMass=Math.min(minMass,t.gasMass);maxHeight=Math.max(maxHeight,t.heightWorld);
   let dr=(t.rollDeg-previousRoll+540)%360-180;continuousRoll+=dr;previousRoll=t.rollDeg;if(Math.abs(continuousRoll)>350)fullTurns=true;
   if(t.contactCount===0)lowestAir=Math.min(lowestAir,t.heightWorld);
   if(t.pressureLimited&&clampTime===null)clampTime=i*dt;
   if(i>60&&t.contactCount>=3&&landedTime===null){landedTime=i*dt;impactSpeed=-previousV;}
   const phase=t.maneuver?.phase||'done';if(phase!==lastPhase){transition.push({time:i*dt,phase,height:t.heightWorld,verticalSpeed:t.verticalSpeed,gasMass:t.gasMass,pressure:t.pressureBar});lastPhase=phase;}
   previousV=t.verticalSpeed;
  }
  results.push({variant,engine,maneuver,maxHeightM:maxHeight,gasConsumedKg:s.gasInitialMass-minMass,gasRemainingFraction:minMass/s.gasInitialMass,landedTime,impactSpeedMps:impactSpeed,fullTurns,continuousRollDeg:continuousRoll,pressureLimitedAt:clampTime,totalImpulseNs:impulse,finalMode:s.mode,transitions:transition});
 }
}
writeFileSync(new URL('./flight-3.3-budget-audit.json',import.meta.url),JSON.stringify({note:'Isolated frozen-source experiment. Short/directLand variants alter maneuver timing/height only; they do not change current dist sources. nozzle-eta90 changes the effective velocity at each 120 Hz step with ideal isentropic expansion from min(tankPressure,50 bar) to 1 bar and velocity efficiency 0.9. This is a feasibility study, not calibration against Tesla data.',results},null,2)+'\n');
console.log(JSON.stringify(results.map(({transitions,...r})=>r),null,2));
