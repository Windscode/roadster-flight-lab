const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number(v)||0));

// Synthesised EV sound, not a Tesla recording. RPM changes pitch, actual wheel
// torque / regeneration change loudness and texture. No stationary engine idle.
// Gains are peak linear amplitudes before a separate 25% default volume control.
export function soundState(t){
  const speed=Math.abs(t.forwardSpeedKmh||0)/3.6,load=clamp(t.motorLoad),regen=clamp((t.regenForceN||0)/2600);
  const road=t.contactCount?clamp(speed/45):0,flow=clamp((t.thrustN||0)/80000);
  const fan=t.suctionEnabled?clamp((t.suctionN||0)/39000):0;
  return {motorHz:78+Math.sqrt(speed/55)*250,motorGain:Math.min(.030,.026*Math.sqrt(load)+.006*regen),
    harmonicGain:.004*load,roadGain:.014*road*road,roadCutoff:350+road*1100,
    jetGain:.065*Math.sqrt(flow),fanGain:.010*fan,
    accelerating:load>.05,regenerating:regen>.02};
}

export function createVehicleAudio({volume=.25}={}){
  const context=new(window.AudioContext||window.webkitAudioContext)();
  const master=context.createGain(),limiter=context.createDynamicsCompressor();
  master.gain.value=clamp(volume);limiter.threshold.value=-18;limiter.knee.value=16;
  limiter.ratio.value=4;limiter.attack.value=.008;limiter.release.value=.18;
  master.connect(limiter);limiter.connect(context.destination);
  const gains=[];
  function tone(hz){const o=context.createOscillator(),gain=context.createGain();o.type='sine';o.frequency.value=hz;gain.gain.value=0;o.connect(gain);gain.connect(master);o.start();gains.push(gain);return{o,gain};}
  // Low-level, non-repeating-in-the-short-term pink-ish source with no sharp
  // white-noise transients. Each physical source has a separate spectral band.
  const buffer=context.createBuffer(1,context.sampleRate*8,context.sampleRate),a=buffer.getChannelData(0);
  let state=48271,low=0;for(let i=0;i<a.length;i++){state=(state*16807)%2147483647;low=low*.88+(state/2147483647*2-1)*.12;a[i]=low*2.0;}
  function noise(cutoff,type='lowpass'){
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=buffer;source.loop=true;
    filter.type=type;filter.frequency.value=cutoff;filter.Q.value=.5;gain.gain.value=0;
    source.connect(filter);filter.connect(gain);gain.connect(master);source.start();gains.push(gain);return{filter,gain};
  }
  const motor=tone(78),harmonic=tone(156),road=noise(650),jet=noise(2600,'bandpass'),fan=noise(320);
  const target=(param,value,tau=.10)=>param.setTargetAtTime(value,context.currentTime,tau);
  return {enabled:true,context,volume:clamp(volume),
    setVolume(value){this.volume=clamp(value);target(master.gain,this.volume);},
    update(t){if(!this.enabled){this.silence();return;}const s=soundState(t);
      target(motor.o.frequency,s.motorHz,.13);target(harmonic.o.frequency,s.motorHz*2,.13);
      target(motor.gain.gain,s.motorGain);target(harmonic.gain.gain,s.harmonicGain);
      target(road.gain.gain,s.roadGain,.22);target(road.filter.frequency,s.roadCutoff,.2);
      target(jet.gain.gain,s.jetGain,.045);target(fan.gain.gain,s.fanGain,.2);
    },silence(){for(const gain of gains)target(gain.gain,0,.03);},
    async dispose(){this.silence();await context.close();}};
}
