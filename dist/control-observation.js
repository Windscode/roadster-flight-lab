import {Vec3,Quaternion} from './vendor/cannon-es.js';

export const DEFAULT_OBSERVATION=Object.freeze({enabled:false,delayMs:0,seed:1,positionNoiseM:0,velocityNoiseMps:0,attitudeNoiseDeg:0,angularRateNoiseRadS:0});
const plain=v=>({x:v.x,y:v.y,z:v.z});
export function observationConfiguration(value={}){
  const config={...DEFAULT_OBSERVATION,...value};
  if(Object.keys(config).some(k=>!(k in DEFAULT_OBSERVATION))||typeof config.enabled!=='boolean'||!Number.isInteger(config.seed)||config.seed<0||config.seed>4294967295)throw new Error('观测参数或种子无效');
  const bounds={delayMs:500,positionNoiseM:5,velocityNoiseMps:5,attitudeNoiseDeg:15,angularRateNoiseRadS:2};
  for(const [key,max]of Object.entries(bounds))if(!Number.isFinite(config[key])||config[key]<0||config[key]>max)throw new Error(`观测参数 ${key} 超出范围`);
  return config;
}
function symmetric(sim){
  // Mulberry32: explicit uint32 state. Independent of Math.random/render time.
  let t=sim._observationSeed=(sim._observationSeed+0x6D2B79F5)>>>0;
  t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
  return 2*((t^(t>>>14))>>>0)/4294967296-1;
}
export function measureControlState(sim){
  const b=sim.body,c=sim._observationConfig;
  const truth={simTime:sim.simTime,position:plain(b.position),velocity:plain(b.velocity),quaternion:{...plain(b.quaternion),w:b.quaternion.w},angularVelocity:plain(b.angularVelocity)};
  if(!c.enabled){sim._observation=truth;sim._observationBody=null;return;}
  const sample=structuredClone(truth);
  for(const [field,amplitude]of [['position',c.positionNoiseM],['velocity',c.velocityNoiseMps],['angularVelocity',c.angularRateNoiseRadS]])for(const axis of ['x','y','z'])sample[field][axis]+=symmetric(sim)*amplitude;
  const attitude=new Quaternion();attitude.setFromEuler(symmetric(sim)*c.attitudeNoiseDeg*Math.PI/180,symmetric(sim)*c.attitudeNoiseDeg*Math.PI/180,symmetric(sim)*c.attitudeNoiseDeg*Math.PI/180,'XYZ');
  const q=b.quaternion.mult(attitude);q.normalize();sample.quaternion={...plain(q),w:q.w};
  const history=sim._observationHistory;history.push(sample);
  const time=sim.simTime-c.delayMs/1000;
  while(history.length>2&&history[1].simTime<=time+1e-10)history.shift();
  // The first sample is held during the delay line's startup; the record
  // contains this initial condition, the entire delay line and PRNG state.
  sim._observation=structuredClone(history[0]);sim._observationBody=null;
}
export function controllerBody(sim){
  if(!sim._observationConfig.enabled||!sim._observation)return sim.body;
  if(!sim._observationBody){
    const o=sim._observation;
    sim._observationBody={position:new Vec3(o.position.x,o.position.y,o.position.z),velocity:new Vec3(o.velocity.x,o.velocity.y,o.velocity.z),quaternion:new Quaternion(o.quaternion.x,o.quaternion.y,o.quaternion.z,o.quaternion.w),angularVelocity:new Vec3(o.angularVelocity.x,o.angularVelocity.y,o.angularVelocity.z),mass:sim.body.mass,inertia:sim.body.inertia};
  }
  return sim._observationBody;
}
