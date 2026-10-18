import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync(new URL('./physics-3.2-handling-reference.mjs',import.meta.url),'utf8'),dt=1/120,results=[];
for(const initial of ['ground','hover4-fresh','hover4-established'])for(const launch of [0,.1,.15,.2,.25,.3,.45]){
 let src=source.replace("this.status='滚转：建立 7 m 安全高度';","this.status='Audit ballistic launch';liftAccel=p.gravity*4;").replace('if(b.position.y>7 && Math.abs(b.velocity.y)<3)',`if(a.time>${launch})`).replace('const duration=1.8,t=','const duration=2.0,t=').replace('rollRunning?m*p.gravity*clamp(upDot,0,1)','rollRunning?0').replace("a.phase='recover';a.time=0;this._positionTarget.copy(b.position);this._heightTarget=3;this._heightIntegral=0;","a.phase='land';a.time=0;this._positionTarget.copy(b.position);this._heightTarget=b.position.y;this._heightIntegral=0;").replace("this.status='自动着陆：高度闭环下降';","const auditTargetVy=-Math.max(.30,Math.min(7,Math.sqrt(2*1.5*Math.max(0,b.position.y-1.0))));liftAccel=clamp((auditTargetVy-b.velocity.y)*8,-p.gravity*.95,p.gravity*2);this.status='Audit velocity envelope';");
 const url=new URL('./physics-initial-current.mjs',import.meta.url);writeFileSync(url,src);const {RoadsterSim}=await import(url.href+'?'+initial+'-'+launch);
 const s=new RoadsterSim();for(const b of [...s.world.bodies])if(b!==s.body&&b.userData?.id!=='ground')s.world.removeBody(b);s.body.position.set(0,.62,-350);for(let i=0;i<240;i++)s.step(dt);
 const tune=()=>{s.params.exhaustVelocity=.9*Math.sqrt(2*1.4/.4*287.05*s.gasTemperature*Math.max(0,1-(1/Math.max(1.00001,Math.min(s.pressureBar(),50)))**(.4/1.4)));};
 if(initial!=='ground'){s.body.position.y=4;s.setMode('hover');s.setParam('hoverHeight',4);}
 if(initial==='hover4-established')for(let i=0;i<60;i++){tune();s.step(dt);}
 const start={height:s.body.position.y,verticalSpeed:s.body.velocity.y,gasMass:s.gasMass,pressure:s.pressureBar()};s.startManeuver('roll');
 let maxHeight=0,landed=null,impact=0,previousV=0,previousRoll=0,roll=0,maxRoll=0,bodyContact=false,lastPhase,transitions=[];
 for(let i=0;i<9*120;i++){
  tune();const t=s.step(dt);maxHeight=Math.max(maxHeight,t.heightWorld);roll+=(t.rollDeg-previousRoll+540)%360-180;previousRoll=t.rollDeg;maxRoll=Math.max(maxRoll,Math.abs(roll));bodyContact||=s.world.contacts.some(c=>c.bi===s.body||c.bj===s.body);
  if(i>40&&t.contactCount>=3&&landed===null){landed=i*dt;impact=-previousV;}previousV=t.verticalSpeed;
  const phase=t.maneuver?.phase||'done';if(phase!==lastPhase){transitions.push({time:i*dt,phase,height:t.heightWorld,verticalSpeed:t.verticalSpeed,rollDeg:t.rollDeg,gasMass:t.gasMass});lastPhase=phase;}
 }
 results.push({initial,launchSeconds:launch,start,maxHeightM:maxHeight,landedTime:landed,impactSpeedMps:impact,maxContinuousRollDeg:maxRoll,gasRemainingFraction:s.gasMass/s.gasInitialMass,bodyContact,finalMode:s.mode,transitions});
}
writeFileSync(new URL('./flight-3.3-initial-state-audit.json',import.meta.url),JSON.stringify({note:'Frozen 3.2 isolated experiment; geometry ground only, initial air at4m. Eta_v0.90 ideal isentropic effective exhaust speed updates each120Hz step. See script for precise branch timing.',results},null,2)+'\n');
console.log(JSON.stringify(results.map(({transitions,...r})=>r),null,2));
