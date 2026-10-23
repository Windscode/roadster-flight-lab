const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number(v)||0));

// All sounds are synthesised feedback, not an OEM recording or a damage sensor.
// Tyre noise follows delivered contact work and support, not steering commands.
export function soundState(t){
  const speed=Math.abs(t.forwardSpeedKmh||0)/3.6,load=clamp(t.motorLoad),regen=clamp((t.energyAccounting?.chargePowerW||0)/46800);
  const wheels=(t.wheelStates||[]).filter(w=>w.contact&&w.normalLoadN>20),normalLoadN=wheels.reduce((sum,w)=>sum+w.normalLoadN,0);
  const contact=t.contactCount>0&&(wheels.length>0||!t.wheelStates),weight=Math.max(1,(t.mass||2200)*9.81);
  const support=clamp(normalLoadN/weight),travel=wheels.length?wheels.reduce((sum,w)=>sum+Math.hypot(w.longitudinalSpeedMps||0,w.lateralSpeedMps||0)*w.normalLoadN,0)/normalLoadN:speed;
  const texture=wheels.length?wheels.reduce((sum,w)=>sum+(w.rollingTexture??1)*w.normalLoadN,0)/normalLoadN:1;
  const slipPowerW=wheels.reduce((sum,w)=>sum+Math.max(0,w.slipPowerW||0),0),moving=clamp((travel-.06)/1.2);
  const road=contact?clamp(travel/45):0,flow=clamp((t.thrustN||0)/80000);
  const fan=t.suctionEnabled?clamp((t.suctionN||0)/39000):0;
  const slide=contact?clamp(Math.sqrt(Math.max(0,slipPowerW-12)/70000))*Math.sqrt(support)*moving:0;
  const absLoad=normalLoadN?wheels.filter(w=>w.absActive).reduce((sum,w)=>sum+w.normalLoadN,0)/normalLoadN:0;
  const absPulse=contact&&travel>1.2?absLoad*(.55+.45*Math.sin((t.simTime||0)*2*Math.PI*14)):0;
  const event=t.contactFeedback?.lastEvent,age=event?Number(t.simTime)-event.timeS:Infinity;
  const severity=event?clamp(Math.log1p(Math.max(0,event.normalEnergyJ-12)/45)/Math.log1p(20000/45)):0;
  const impact=event&&age>=0&&age<.35&&severity>0?{id:event.id,timeS:event.timeS,kind:event.kind,gain:.09*severity,hz:120-60*severity,normalEnergyJ:event.normalEnergyJ}:null;
  return {motorHz:78+Math.sqrt(speed/55)*250,motorGain:Math.min(.030,.026*Math.sqrt(load)+.006*regen),
    harmonicGain:.004*load,roadGain:.014*road*road*texture,roadCutoff:350+road*1100,
    slipGain:.045*slide,slipCutoff:650+1900*slide,slipPowerW,normalLoadN,absGain:.007*absPulse,
    impact,jetGain:.065*Math.sqrt(flow),fanGain:.010*fan,
    accelerating:load>.05,regenerating:regen>.02};
}

// One event can be observed by many rendered frames. A single onset schedules
// one envelope; sustained contact and paused frames cannot repeatedly fire it.
export function createContactSoundGate(){
  let lastKey=null,lastTime=null;
  return {consume(t){const state=soundState(t),event=state.impact;
    if(lastTime!==null&&t.simTime<lastTime-.001)lastKey=null;lastTime=t.simTime;
    if(!event)return null;const key=event.id+':'+event.timeS+':'+event.kind;if(key===lastKey)return null;lastKey=key;return event;
  },reset(){lastKey=null;lastTime=null;}};
}

export function createVehicleAudio({volume=.25}={}){
  const context=new(window.AudioContext||window.webkitAudioContext)();
  const master=context.createGain(),limiter=context.createDynamicsCompressor();
  master.gain.value=clamp(volume);limiter.threshold.value=-18;limiter.knee.value=16;
  limiter.ratio.value=4;limiter.attack.value=.008;limiter.release.value=.18;
  master.connect(limiter);limiter.connect(context.destination);
  const gains=[];
  function tone(hz){const o=context.createOscillator(),gain=context.createGain();o.type='sine';o.frequency.value=hz;gain.gain.value=0;o.connect(gain);gain.connect(master);o.start();gains.push(gain);return{o,gain};}
  // Deterministic, low-level pink-ish texture, with a separate band per source.
  const buffer=context.createBuffer(1,context.sampleRate*8,context.sampleRate),a=buffer.getChannelData(0);
  let state=48271,low=0;for(let i=0;i<a.length;i++){state=(state*16807)%2147483647;low=low*.88+(state/2147483647*2-1)*.12;a[i]=low*2.0;}
  function noise(cutoff,type='lowpass'){
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=buffer;source.loop=true;
    filter.type=type;filter.frequency.value=cutoff;filter.Q.value=.5;gain.gain.value=0;
    source.connect(filter);filter.connect(gain);gain.connect(master);source.start();gains.push(gain);return{filter,gain};
  }
  const motor=tone(78),harmonic=tone(156),road=noise(650),slip=noise(1400,'bandpass'),abs=noise(230,'bandpass'),jet=noise(2600,'bandpass'),fan=noise(320);
  const impactTone=tone(90),impactNoise=noise(480),impactGate=createContactSoundGate();
  const target=(param,value,tau=.10)=>param.setTargetAtTime(value,context.currentTime,tau);
  const strike=(gain,peak,decay)=>{const now=context.currentTime;gain.cancelScheduledValues(now);gain.setValueAtTime(0,now);gain.linearRampToValueAtTime(peak,now+.008);gain.exponentialRampToValueAtTime(.00001,now+decay);};
  return {enabled:true,context,volume:clamp(volume),lastFeedback:null,
    setVolume(value){this.volume=clamp(value);target(master.gain,this.volume);},
    update(t){if(!this.enabled){this.silence();return;}const s=soundState(t);this.lastFeedback=s;
      target(motor.o.frequency,s.motorHz,.13);target(harmonic.o.frequency,s.motorHz*2,.13);
      target(motor.gain.gain,s.motorGain);target(harmonic.gain.gain,s.harmonicGain);
      target(road.gain.gain,s.roadGain,.22);target(road.filter.frequency,s.roadCutoff,.2);
      target(slip.gain.gain,s.slipGain,.05);target(slip.filter.frequency,s.slipCutoff,.08);target(abs.gain.gain,s.absGain,.016);
      target(jet.gain.gain,s.jetGain,.045);target(fan.gain.gain,s.fanGain,.2);
      const impact=impactGate.consume(t);if(impact){target(impactTone.o.frequency,impact.hz,.01);strike(impactTone.gain.gain,impact.gain,.28);strike(impactNoise.gain.gain,impact.gain*.8,.16);}
    },silence(){for(const gain of gains){gain.gain.cancelScheduledValues(context.currentTime);target(gain.gain,0,.03);}},
    async dispose(){this.silence();await context.close();}};
}
