import * as CANNON from '../../dist/vendor/cannon-es.js';

// An explicit engineering model: published demonstrations do not disclose enough
// information to identify Tesla's real mass, inertia, nozzle maps or controllers.
export const DEFAULT_PARAMS = Object.freeze({
  dryMass: 1950, gravity: 9.81, tireMu: 1.25, springRate: 65000,
  suspensionDamping: 5800, suspensionRest: 0.37, wheelRadius: 0.37,
  maxMotorForce: 24000, motorPower: 700000, brakeForce: 42000,
  dragArea: 0.58, airDensity: 1.225,
  tankLitres: 600, initialPressureBar: 350, regulatorBar: 50,
  gasTemperatureK: 293.15, exhaustVelocity: 650,
  liftNozzleMax: 20000, sideNozzleMax: 5500, axialNozzleMax: 11000,
  suctionPressurePa: 8200, suctionArea: 4.8, sealRange: 0.34,
  batteryKWh: 200, supplyMode: 'finite', hoverHeight: 4,
  controllerFrequency: 120,
});

export const SCENARIOS = Object.freeze({
  free: { label: '自由试验场', position: [0, 0.62, -28], rotation: [0, 0, 0], mode: 'drive' },
  hover: { label: '悬停试验 · 空中初态', position: [0, 4, -5], rotation: [0, 0, 0], mode: 'hover' },
  ceiling: { label: '倒挂保持 · 顶下初态', position: [36, 7.395, 18], rotation: [0, 0, Math.PI], mode: 'drive' },
  ramp: { label: '180° 弧面爬行', position: [-36, 0.62, 27], rotation: [0, 0, 0], mode: 'drive' },
});

const V = (x=0,y=0,z=0) => new CANNON.Vec3(x,y,z);
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const finite = (x,fallback=0) => Number.isFinite(Number(x)) ? Number(x) : fallback;
const plain = v => ({x:v.x,y:v.y,z:v.z});
const quatArray = q => [q.x,q.y,q.z,q.w];
const Y = V(0,1,0), Z = V(0,0,1), X = V(1,0,0);
const WHEEL_LOCATIONS = [[-.89,.06,1.42],[.89,.06,1.42],[-.89,.06,-1.42],[.89,.06,-1.42]];
const WHEEL_NAMES = ['FL','FR','RL','RR'];

const angularMomentum = (q,omega,inertia) => {
  const local=q.conjugate().vmult(omega);
  return q.vmult(V(local.x*inertia.x,local.y*inertia.y,local.z*inertia.z));
};
const angularVelocityFromMomentum = (q,momentum,inertia) => {
  const local=q.conjugate().vmult(momentum);
  return q.vmult(V(local.x/inertia.x,local.y/inertia.y,local.z/inertia.z));
};
const rotateWorld = (q,omega,dt) => {
  const speed=omega.length();
  if(speed<1e-12)return q.clone();
  const increment=new CANNON.Quaternion();
  increment.setFromAxisAngle(omega.scale(1/speed),speed*dt);
  const result=increment.mult(q);result.normalize();return result;
};

/**
 * Cannon 0.20 omits the Euler gyroscopic term in Body.integrate. Only this
 * vehicle's rotational integrator is replaced. Advancing world angular
 * momentum and solving omega = R I_body^-1 R^T L is equivalent to
 * I_world omegaDot = tau - omega × (I_world omega).
 * This is an inertial equation, not an actuator or an attitude constraint.
 * Cannon still performs all collision impulses, damping and translation.
 */
class MomentumBody extends CANNON.Body {
  integrate(dt,quatNormalize,quatNormalizeFast) {
    if(this.type!==CANNON.Body.DYNAMIC || this.sleepState===CANNON.Body.SLEEPING) {
      super.integrate(dt,quatNormalize,quatNormalizeFast);return;
    }
    const q0=this.quaternion.clone(),omega0=this.angularVelocity.clone(),torque=this.torque.clone();
    const l0=angularMomentum(q0,omega0,this.inertia);
    const impulse=V(torque.x*this.angularFactor.x,torque.y*this.angularFactor.y,torque.z*this.angularFactor.z).scale(dt);
    const lmid=l0.vadd(impulse.scale(.5)),l1=l0.vadd(impulse);
    // Run Cannon's translational half with rotation disabled, then restore the
    // external torque bookkeeping for the world's standard force clearing.
    this.angularVelocity.setZero();this.torque.setZero();
    super.integrate(dt,quatNormalize,quatNormalizeFast);
    this.torque.copy(torque);
    let midOmega=angularVelocityFromMomentum(q0,lmid,this.inertia);
    // Implicit midpoint orientation solved with four local fixed-point passes.
    // At 120 Hz the tested maximum maneuver increment remains small.
    for(let i=0;i<4;i++) {
      const qmid=rotateWorld(q0,midOmega,dt*.5);
      midOmega=angularVelocityFromMomentum(qmid,lmid,this.inertia);
    }
    this.quaternion.copy(rotateWorld(q0,midOmega,dt));
    this.angularVelocity.copy(angularVelocityFromMomentum(this.quaternion,l1,this.inertia));
    this.aabbNeedsUpdate=true;this.updateInertiaWorld(true);
  }
}

/**
 * SI units throughout. Fixed 120 Hz force evaluation + Cannon rigid body solver.
 * Controls are forces at actuators/contact patches; no commanded body pose.
 */
export class RoadsterSim {
  constructor(params={}) {
    this.params = {...DEFAULT_PARAMS,...params};
    this.world = new CANNON.World({gravity:V(0,-this.params.gravity,0)});
    this.world.solver.iterations = 16;
    this.world.solver.tolerance = 1e-7;
    this.world.allowSleep = false;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = .35;
    this.world.defaultContactMaterial.restitution = .03;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.defaultContactMaterial.contactEquationRelaxation = 5;
    this.geometry = [];
    this._createWorld();
    this.body = new MomentumBody({mass:this.params.dryMass,linearDamping:.004,angularDamping:.065,
      collisionFilterGroup:2,collisionFilterMask:1,allowSleep:false});
    this.body.addShape(new CANNON.Box(V(.93,.25,1.62)));
    this.body.addShape(new CANNON.Box(V(.86,.14,.36)),V(0,.05,1.84));
    this.body.addShape(new CANNON.Box(V(.90,.16,.35)),V(0,.02,-1.81));
    this.body.addShape(new CANNON.Box(V(.71,.26,.86)),V(0,.37,-.28));
    this.world.addBody(this.body);
    this._ray = new CANNON.RaycastResult();
    this._wheelRays = WHEEL_LOCATIONS.map(()=>new CANNON.RaycastResult());
    this._pads = [[-.69,-.20,1.04],[.69,-.20,1.04],[-.69,-.20,-1.04],[.69,-.20,-1.04]].map(a=>V(...a));
    this._nozzles = [];
    WHEEL_LOCATIONS.forEach((a,i)=>this._nozzles.push(this._nozzle(`lift-${WHEEL_NAMES[i]}`,V(Math.sign(a[0])*.72,-.32,a[2]),V(0,1,0),'lift')));
    WHEEL_LOCATIONS.forEach((a,i)=>this._nozzles.push(this._nozzle(`roll-${WHEEL_NAMES[i]}`,V(a[0],-.22,a[2]),V(a[0]<0?1:-1,0,0),'roll')));
    this._nozzles.push(this._nozzle('rear-boost',V(0,0,-2.07),V(0,0,1),'longitudinal'));
    this._nozzles.push(this._nozzle('front-brake',V(0,0,2.07),V(0,0,-1),'longitudinal'));
    this.wheelStates = WHEEL_LOCATIONS.map((a,i)=>({id:WHEEL_NAMES[i],steer:0,rotation:0,suspensionLength:.30,
      contact:false,position:{x:a[0],y:a[1]-.30,z:a[2]},normalLoadN:0,slipAngle:0}));
    this.reset('free');
  }

  _nozzle(id,position,direction,kind) {
    const torque=position.cross(direction);
    return {id,position,direction,kind,force:0,maxForce:0,column:[direction.x,direction.y,direction.z,torque.x,torque.y,torque.z]};
  }

  _addBox(id,kind,size,position,rotation=[0,0,0],color) {
    const q=new CANNON.Quaternion();q.setFromEuler(...rotation,'XYZ');
    const b=new CANNON.Body({mass:0,position:V(...position),quaternion:q,collisionFilterGroup:1,collisionFilterMask:2});
    b.addShape(new CANNON.Box(V(size[0]/2,size[1]/2,size[2]/2)));
    b.userData={id,kind};this.world.addBody(b);
    this.geometry.push({id,type:'box',kind,size:[...size],position:[...position],quaternion:quatArray(q),color});
  }

  _createWorld() {
    this._addBox('ground','floor',[220,1,340],[0,-.5,0]);
    this._addBox('ceiling-bay','ceiling',[22,.5,28],[36,8.25,18]);
    for (const x of [26,46]) for (const z of [5,31]) this._addBox(`pillar-${x}-${z}`,'pillar',[.8,8,.8],[x,4,z]);
    const R=9,N=64,thickness=.40,da=Math.PI/N;
    for(let i=0;i<N;i++) {
      const a=(i+.5)*da,normal=V(0,Math.cos(a),-Math.sin(a));
      const p=V(-36,9-9*Math.cos(a),42+9*Math.sin(a));
      p.vsub(normal.scale(thickness/2),p);
      this._addBox(`arch-${i}`,'arch',[9,thickness,2*R*Math.tan(da/2)+.016],[p.x,p.y,p.z],[-a,0,0]);
    }
    this._addBox('arch-ceiling','ceiling',[9,.4,22],[-36,18.2,31]);
    // Physical boundaries match the rendered walls. They prevent a finite arena
    // from silently becoming an unbounded physics world.
    this._addBox('boundary-west','boundary',[1,3,340],[-110,1.5,0]);
    this._addBox('boundary-east','boundary',[1,3,340],[110,1.5,0]);
    this._addBox('boundary-north','boundary',[220,3,1],[0,1.5,170]);
    this._addBox('boundary-south','boundary',[220,3,1],[0,1.5,-170]);
  }

  getWorldGeometry() { return this.geometry; }

  _resetMass() {
    this.gasInitialMass = this.params.initialPressureBar*1e5*(this.params.tankLitres/1000)/(287.05*this.params.gasTemperatureK);
    this.gasMass=this.gasInitialMass;
    this._updateMass(true);
  }

  _updateMass(force=false) {
    const m=this.params.dryMass+this.gasMass;
    if(force || Math.abs(this.body.mass-m)>.3) {
      this.body.mass=m;this.body.updateMassProperties();
      // Explicit inertia approximation for a low battery chassis. Cannon's
      // compound AABB inertia would put too much mass in the roof envelope.
      this.body.inertia.set(m*1.59,m*1.88,m*.43);
      this.body.invInertia.set(1/this.body.inertia.x,1/this.body.inertia.y,1/this.body.inertia.z);
      this.body.updateInertiaWorld(true);
    }
  }

  reset(scenario='free') {
    if(!SCENARIOS[scenario]) scenario='free';
    const s=SCENARIOS[scenario];this.scenario=scenario;
    this.body.position.set(...s.position);this.body.quaternion.setFromEuler(...s.rotation,'XYZ');
    this.body.velocity.setZero();this.body.angularVelocity.setZero();this.body.force.setZero();this.body.torque.setZero();
    this.body.previousPosition.copy(this.body.position);this.body.interpolatedPosition.copy(this.body.position);
    this.body.previousQuaternion.copy(this.body.quaternion);this.body.interpolatedQuaternion.copy(this.body.quaternion);
    this.body.aabbNeedsUpdate=true;this.body.wakeUp();this._resetMass();
    this.mode=s.mode;this.suctionEnabled=scenario==='ceiling'||scenario==='ramp';
    this._fanLevel=this.suctionEnabled?1:0;
    this.simTime=0;this._accumulator=0;this._energyUsed=0;this._motorWork=0;
    this._heightTarget=s.position[1];this._headingTarget=0;
    this._positionTarget=this.body.position.clone();
    this._maneuver=null;this._rollReference=0;this._lastVelocity=V();
    this._gLoad=1;this._contactCount=0;this._suctionForce=0;this._thrustN=0;this._pressureLimited=false;
    this.status='就绪';this._fault=null;this._thrustWanted=0;this._lastInput={};this._fallReset=false;
    this._nozzles.forEach(n=>{n.force=0;});
    this.wheelStates.forEach(w=>{w.rotation=0;w.contact=false;w.normalLoadN=0;});
    return this;
  }

  setMode(mode) {
    if(!['drive','hover','manual'].includes(mode)) return;
    this.mode=mode;this._maneuver=null;
    this._headingTarget=this._angles().heading;
    this._heightTarget=Math.max(this.body.position.y,1.5);
    this._positionTarget.copy(this.body.position);
    if(mode==='hover' && this.body.position.y<1.3) this._heightTarget=this.params.hoverHeight;
    this.status=mode==='hover'?'高度 / 姿态闭环接管':mode==='manual'?'手动喷口控制':'轮胎驱动';
  }

  setSuction(enabled) { this.suctionEnabled=!!enabled; }
  setSupplyMode(mode) { this.setParam('supplyMode',mode); }
  refillGas() { this._resetMass();this._pressureLimited=false;this.status='试验气源已补充'; }

  setParam(key,value) {
    if(key==='supplyMode') { if(['finite','bench'].includes(value)) this.params[key]=value;return; }
    const limits={dryMass:[800,5000],gravity:[.1,20],tireMu:[.15,3],springRate:[25000,200000],
      suspensionDamping:[1500,18000],maxMotorForce:[0,60000],motorPower:[10000,2000000],
      tankLitres:[50,3000],initialPressureBar:[20,700],regulatorBar:[5,150],exhaustVelocity:[100,1000],
      liftNozzleMax:[1000,50000],sideNozzleMax:[100,20000],axialNozzleMax:[100,50000],
      suctionPressurePa:[0,25000],suctionArea:[.1,8],hoverHeight:[1,40],dragArea:[.1,3]};
    if(!(key in limits)||!Number.isFinite(Number(value))) return;
    this.params[key]=clamp(Number(value),...limits[key]);
    if(key==='gravity') this.world.gravity.set(0,-this.params.gravity,0);
    if(['dryMass','tankLitres','initialPressureBar'].includes(key)) this._resetMass();
    if(key==='hoverHeight') this._heightTarget=this.params.hoverHeight;
  }

  startManeuver(name) {
    if(name==='cancel') {
      const wasSurface=this._maneuver?.name==='ramp'||this._contactCount>1;
      this._maneuver=null;this.setMode(wasSurface?'drive':'hover');return;
    }
    if(name==='land') {
      this.setMode('hover');this._maneuver={name:'land',phase:'descent',time:0};return;
    }
    if(name==='roll') {
      this.setMode('hover');
      this._maneuver={name:'roll',phase:this.body.position.y<7?'climb':'rotate',time:0,angle:0};
      this._heightTarget=Math.max(9,this.body.position.y);this.status='滚转：先建立高度';return;
    }
    if(name==='ramp') {
      this.setMode('drive');this.suctionEnabled=true;
      this._maneuver={name:'ramp',phase:'approach',time:0};this.status='弧面试验：低速巡航';
    }
  }

  _angles() {
    const f=this.body.quaternion.vmult(Z),u=this.body.quaternion.vmult(Y),r=this.body.quaternion.vmult(X);
    // Roll about forward, pitch forward-up. Heading becomes undefined at
    // vertical, so the display uses the last horizontal projection there.
    const heading=Math.hypot(f.x,f.z)>.001?Math.atan2(f.x,f.z):(this._headingTarget||0);
    const pitch=Math.asin(clamp(f.y,-1,1));
    const roll=Math.atan2(r.y,u.y);
    return {heading,pitch,roll};
  }

  _raySurface(from,to,result=this._ray) {
    result.reset();
    return this.world.raycastClosest(from,to,{collisionFilterMask:1,collisionFilterGroup:2,skipBackfaces:true},result);
  }

  _applyWorldForce(force,localPoint) {
    this.body.applyForce(force,this.body.quaternion.vmult(localPoint));
  }

  _wheels(dt,input) {
    const b=this.body,p=this.params,up=b.quaternion.vmult(Y),down=up.negate();
    const steerTarget=input.steer*.49/(1+Math.abs(b.velocity.dot(b.quaternion.vmult(Z)))*.023);
    const contacts=[];
    for(let i=0;i<4;i++) {
      const mount=V(...WHEEL_LOCATIONS[i]),from=b.pointToWorldFrame(mount);
      const to=from.vadd(down.scale(p.suspensionRest+.21+p.wheelRadius));
      const ray=this._wheelRays[i],w=this.wheelStates[i];
      w.steer+=(i<2?steerTarget-w.steer:-w.steer)*Math.min(1,dt*14);
      const hit=this._raySurface(from,to,ray);
      const alignment=hit?ray.hitNormalWorld.dot(up):0;
      const length=hit?ray.distance-p.wheelRadius:p.suspensionRest+.15;
      w.contact=!!hit && length<p.suspensionRest+.12 && alignment>.30;
      w.suspensionLength=clamp(length,.08,p.suspensionRest+.15);
      w.position={x:mount.x,y:mount.y-w.suspensionLength,z:mount.z};w.normalLoadN=0;
      if(!w.contact) { w.rotation*=1;continue; }
      const relative=ray.hitPointWorld.vsub(b.position);
      const velocity=b.angularVelocity.cross(relative).vadd(b.velocity);
      const vn=velocity.dot(ray.hitNormalWorld);
      const compression=p.suspensionRest-length;
      const spring=clamp((p.springRate*compression-p.suspensionDamping*vn)/Math.max(.4,alignment),0,b.mass*p.gravity*2.3);
      w.normalLoadN=spring;
      b.applyForce(ray.hitNormalWorld.scale(spring),relative);
      const forward=b.quaternion.vmult(V(Math.sin(w.steer),0,Math.cos(w.steer)));
      forward.vsub(ray.hitNormalWorld.scale(forward.dot(ray.hitNormalWorld)),forward);forward.normalize();
      const right=ray.hitNormalWorld.cross(forward);right.normalize();
      const vlong=velocity.dot(forward),vlat=velocity.dot(right);
      w.slipAngle=Math.atan2(vlat,Math.abs(vlong)+.6);
      w.rotation+=vlong/p.wheelRadius*dt;
      contacts.push({w,relative,normal:ray.hitNormalWorld.clone(),forward,right,vlong,vlat});
    }
    this._contactCount=contacts.length;
    const n=Math.max(1,contacts.length),g=this.world.gravity;
    let driveForce=input.throttle*p.maxMotorForce;
    const speed=Math.abs(b.velocity.dot(b.quaternion.vmult(Z)));
    driveForce=clamp(driveForce,-p.motorPower/Math.max(8,speed),p.motorPower/Math.max(8,speed));
    for(const c of contacts) {
      const effectiveMass=b.mass/n,capacity=p.tireMu*c.w.normalLoadN;
      // Velocity-aware low-speed branch supplies static friction without a
      // sign(v) discontinuity. At speed it becomes a saturating slip-angle law.
      let flat=-Math.tanh(c.w.slipAngle*4.8)*capacity;
      if(Math.abs(c.vlong)<3) flat=-c.vlat*effectiveMass*24;
      flat-=g.dot(c.right)*effectiveMass;
      let flong=driveForce/n;
      const hold=input.brake>.01?input.brake*p.brakeForce/n:Math.abs(input.throttle)<.015?Math.min(p.brakeForce/n,3500):0;
      flong+=clamp(-c.vlong*effectiveMass*28-g.dot(c.forward)*effectiveMass,-hold,hold);
      if(Math.abs(input.throttle)>.015) flong-=Math.tanh(c.vlong*3)*p.gravity*b.mass*.011/n;
      const norm=Math.hypot(flong,flat),scale=norm>capacity&&norm>0?capacity/norm:1;
      flong*=scale;flat*=scale;
      const force=c.forward.scale(flong).vadd(c.right.scale(flat));
      b.applyForce(force,c.relative);
      this._motorWork+=Math.max(0,flong*c.vlong)*dt/.9;
    }
  }

  _suction(dt) {
    const p=this.params,b=this.body;
    this._fanLevel+=(Number(this.suctionEnabled)-this._fanLevel)*Math.min(1,dt/0.14);
    this._suctionForce=0;this._sealQuality=0;
    if(this._fanLevel<.001) return;
    const down=b.quaternion.vmult(V(0,-1,0));
    for(const pad of this._pads) {
      const from=b.pointToWorldFrame(pad),to=from.vadd(down.scale(.80));
      if(!this._raySurface(from,to)) continue;
      const alignment=-this._ray.hitNormalWorld.dot(down);
      if(alignment<.62) continue;
      // The deformable skirt extends 0.36 m below the pad hardpoint. Contact
      // can compress it; only nearby surfaces can form a pressure enclosure.
      const gap=Math.max(0,this._ray.distance-.36);
      const seal=clamp((p.sealRange-gap)/(p.sealRange-.16),0,1)*clamp((alignment-.62)/.30,0,1);
      const force=p.suctionPressurePa*p.suctionArea/4*seal*this._fanLevel;
      this._applyWorldForce(this._ray.hitNormalWorld.scale(-force),pad);
      this._suctionForce+=force;this._sealQuality+=seal/4;
    }
    this._energyUsed+=this._fanLevel*26000*dt/3.6e6;
  }

  _attitudeTorque(target,frequency=4.2) {
    const b=this.body,inv=b.quaternion.conjugate();
    const error=inv.mult(target);if(error.w<0){error.x*=-1;error.y*=-1;error.z*=-1;error.w*=-1;}
    const s=Math.hypot(error.x,error.y,error.z);
    const angle=2*Math.atan2(s,clamp(error.w,-1,1));
    const scale=s>1e-8?angle/s:2;
    const omega=inv.vmult(b.angularVelocity),e=[error.x*scale,error.y*scale,error.z*scale];
    const inertia=[b.inertia.x,b.inertia.y,b.inertia.z];
    // x pitch, y yaw, z roll in this forward-Z frame.
    const frequencies=[frequency,2.6,frequency*1.25];
    return e.map((v,i)=>clamp(inertia[i]*(frequencies[i]**2*v-2*.94*frequencies[i]*[omega.x,omega.y,omega.z][i]),-65000,65000));
  }

  _controller(dt,input) {
    const b=this.body,p=this.params,m=b.mass,angles=this._angles();
    let desired=[0,0,0,0,0,0];
    if(this.mode==='drive') {
      if(input.boost) desired[2]=p.axialNozzleMax;
      if(input.lift>.01) desired[1]=input.lift*4*p.liftNozzleMax;
      if(Math.abs(input.roll)>.01) desired[5]=-input.roll*28000;
      return desired;
    }
    if(this.mode==='manual') {
      desired[1]=Math.max(0,input.lift)*4*p.liftNozzleMax;
      desired[2]=input.boost?p.axialNozzleMax:input.throttle*p.axialNozzleMax;
      desired[3]=-input.throttle*12000;desired[4]=input.steer*11000;desired[5]=-input.roll*28000;
      return desired;
    }
    this._heightTarget=clamp(this._heightTarget+input.lift*3*dt,.52,48);
    this._headingTarget+=input.steer*.85*dt;
    let rollRef=0,pitchRef=0;
    const heading=this._headingTarget;
    const forward=V(Math.sin(heading),0,Math.cos(heading));
    const right=V(Math.cos(heading),0,-Math.sin(heading));
    let ax,az;
    if(Math.abs(input.throttle)>.02 || Math.abs(input.roll)>.02) {
      const targetVel=forward.scale(input.throttle*10).vadd(right.scale(input.roll*8));
      ax=(targetVel.x-b.velocity.x)*1.8;az=(targetVel.z-b.velocity.z)*1.8;
      this._positionTarget.x=b.position.x;this._positionTarget.z=b.position.z;
    } else {
      ax=(this._positionTarget.x-b.position.x)*.72-b.velocity.x*1.75;
      az=(this._positionTarget.z-b.position.z)*.72-b.velocity.z*1.75;
    }
    ax=clamp(ax,-6,6);az=clamp(az,-6,6);
    const accLocalX=ax*Math.cos(heading)-az*Math.sin(heading);
    const accLocalZ=ax*Math.sin(heading)+az*Math.cos(heading);
    pitchRef=clamp(Math.atan2(accLocalZ,p.gravity),-.40,.40);
    rollRef=clamp(-Math.atan2(accLocalX,p.gravity),-.40,.40);
    let liftAccel=clamp((this._heightTarget-b.position.y)*4-b.velocity.y*3.5,-p.gravity*.8,p.gravity*1.7);
    let rollRunning=false;
    if(this._maneuver) {
      const a=this._maneuver;a.time+=dt;
      if(a.name==='land') {
        this._heightTarget=Math.max(.53,this._heightTarget-dt*1.5);
        this.status='自动着陆：高度闭环下降';
        if(this._contactCount>=3 && b.position.y<1.2 && Math.abs(b.velocity.y)<.7) {
          this._maneuver=null;this.mode='drive';this.status='着陆完成';return [0,0,0,0,0,0];
        }
      } else if(a.name==='roll') {
        if(a.phase==='climb') {
          this.status='滚转：建立 7 m 安全高度';
          if(b.position.y>7 && Math.abs(b.velocity.y)<3) {a.phase='rotate';a.time=0;}
        } else if(a.phase==='rotate') {
          rollRunning=true;
          const t=clamp(a.time/1.6,0,1),smooth=t*t*(3-2*t);
          rollRef=2*Math.PI*smooth;pitchRef=0;
          liftAccel=0;
          this.status='滚转：喷口力矩闭环';
          if(a.time>2.1) {a.phase='recover';a.time=0;this._positionTarget.copy(b.position);}
        } else {
          this.status='滚转：恢复水平悬停';
          if(a.time>2.5 && Math.abs(angles.roll)<.15) {this._maneuver=null;this.status='滚转结束';}
        }
      }
    }
    const target=new CANNON.Quaternion();target.setFromEuler(pitchRef,heading,rollRef,'YXZ');
    const torque=this._attitudeTorque(target,rollRunning?6:4.3);
    const up=b.quaternion.vmult(Y),upDot=up.y;
    // With only upward main jets the vehicle cannot support gravity when
    // inverted in free air. A roll contains an actual ballistic interval.
    const thrust=rollRunning?m*p.gravity*clamp(upDot,0,1):m*(p.gravity+liftAccel)/Math.max(.28,upDot);
    desired=[0,clamp(thrust,0,4*p.liftNozzleMax),input.boost?p.axialNozzleMax:0,...torque];
    this._thrustWanted=desired[1];
    return desired;
  }

  _thrusters(dt,desired) {
    const p=this.params,b=this.body;
    const pressure=this.params.supplyMode==='bench'?p.initialPressureBar:this.gasMass/Math.max(.001,this.gasInitialMass)*p.initialPressureBar;
    const derate=clamp((pressure-1)/(p.regulatorBar-1),0,1);
    const maxes=this._nozzles.map(n=>(n.kind==='lift'?p.liftNozzleMax:n.kind==='roll'?p.sideNozzleMax:p.axialNozzleMax)*derate);
    // Weighted projected coordinate descent for a bounded, non-negative thrust
    // allocation. Every resulting body moment equals r × F at a real nozzle.
    const weights=[.65,1,.65,1.1,.9,1.2];
    const forces=this._nozzles.map(n=>Math.min(n.force,maxes[this._nozzles.indexOf(n)]));
    const residual=[...desired];
    this._nozzles.forEach((n,i)=>n.column.forEach((c,k)=>residual[k]-=c*forces[i]));
    for(let pass=0;pass<12;pass++) {
      for(let i=0;i<this._nozzles.length;i++) {
        const col=this._nozzles[i].column;
        let numer=0,denom=.001;
        for(let k=0;k<6;k++){numer+=col[k]*residual[k]*weights[k]**2;denom+=col[k]**2*weights[k]**2;}
        const next=clamp(forces[i]+numer/denom,0,maxes[i]),change=next-forces[i];
        forces[i]=next;for(let k=0;k<6;k++)residual[k]-=col[k]*change;
      }
    }
    let sum=forces.reduce((a,f)=>a+f,0);
    const requiredMass=sum/p.exhaustVelocity*dt;
    const availableScale=p.supplyMode==='bench'?1:Math.min(1,this.gasMass/Math.max(1e-10,requiredMass));
    this._thrustN=0;
    this._nozzles.forEach((n,i)=>{
      n.maxForce=maxes[i];n.force=forces[i]*availableScale;
      if(n.force<.02)n.force=0;
      b.applyLocalForce(n.direction.scale(n.force),n.position);
      this._thrustN+=n.force;
    });
    if(p.supplyMode!=='bench') this.gasMass=Math.max(0,this.gasMass-requiredMass*availableScale);
    this._pressureLimited=derate<.99 || (this.mode==='hover'&&this._thrustWanted>maxes.slice(0,4).reduce((a,c)=>a+c,0)*.95);
    this._updateMass();
  }

  _aero(dt) {
    const b=this.body,p=this.params,localV=b.quaternion.conjugate().vmult(b.velocity);
    const speed=localV.length(),factor=-.5*p.airDensity*speed;
    b.applyLocalForce(V(factor*1.4*localV.x,factor*2.5*localV.y,factor*p.dragArea*localV.z),V());
    // Aerodynamic angular damping is implemented as forces at four corners.
    for(const r of [V(-.9,0,1.7),V(.9,0,1.7),V(-.9,0,-1.7),V(.9,0,-1.7)]) {
      const rw=b.quaternion.vmult(r),vr=b.angularVelocity.cross(rw);
      b.applyForce(vr.scale(-8*vr.length()),rw);
    }
    this._energyUsed+=800*dt/3.6e6;
  }

  _advance(dt,raw) {
    const input={throttle:clamp(finite(raw.throttle),-1,1),steer:clamp(finite(raw.steer),-1,1),
      brake:clamp(finite(raw.brake),0,1),lift:clamp(finite(raw.lift),-1,1),roll:clamp(finite(raw.roll),-1,1),boost:!!raw.boost};
    if(this._maneuver?.name==='ramp') {
      const f=this.body.quaternion.vmult(Z),speed=this.body.velocity.dot(f);
      const gravityFeedForward=this.body.mass*this.params.gravity*f.y/Math.max(1,this.params.maxMotorForce);
      input.throttle=clamp((4.1-speed)*.48+gravityFeedForward+.012,-1,1);input.brake=0;
      input.steer=clamp((-36-this.body.position.x)*.22-this.body.velocity.x*.12,-.35,.35);
      this._maneuver.time+=dt;
      if(this.body.position.y>16.5 && this.body.position.z<40) {input.throttle=0;input.brake=1;this.status='弧面终点：倒挂制动';}
    }
    this._lastInput=input;
    this._motorWork=0;
    this._wheels(dt,input);this._suction(dt);
    const desired=this._controller(dt,input);this._thrusters(dt,desired);this._aero(dt);
    this._energyUsed+=this._motorWork/3.6e6;
    const before=this.body.velocity.clone();this.world.step(dt);this.simTime+=dt;
    const accel=this.body.velocity.vsub(before).scale(1/dt).vsub(this.world.gravity);
    this._gLoad+=(accel.length()/this.params.gravity-this._gLoad)*Math.min(1,dt*8);
    this._sanity();
    if(this._fault) this.status=this._fault;
    else if(this.params.supplyMode==='finite'&&this.gasMass/Math.max(.001,this.gasInitialMass)*this.params.initialPressureBar<1.2&&this.mode!=='drive') this.status='气源压差耗尽：推进器失去支撑';
    else if(this._pressureLimited&&this.mode==='hover') this.status='供压降低：可用推力受限';
    else if(!this._maneuver) {
      if(this.suctionEnabled&&this._sealQuality>.5) this.status=this.body.quaternion.vmult(Y).y<-.6?'倒挂：压差吸附保持':'近表面：压差吸附有效';
      else if(this.suctionEnabled) this.status='未形成近表面密封：无吸附';
      else if(this.mode==='hover') this.status='高度 / 姿态闭环';
      else if(this.mode==='manual') this.status='手动喷口控制';
      else this.status=this._contactCount?'轮胎接地':'自由飞行';
    }
  }

  _sanity() {
    const b=this.body;
    const values=[...Object.values(plain(b.position)),...Object.values(plain(b.velocity)),...quatArray(b.quaternion),...Object.values(plain(b.angularVelocity))];
    if(!values.every(Number.isFinite)) {
      this.reset(this.scenario);this._fault='非有限状态已捕获，试验复位';return;
    }
    if(b.position.y < -15 || b.position.y>180 || Math.abs(b.position.x)>230 || Math.abs(b.position.z)>280) {
      this.reset(this.scenario);this._fault='越过试验安全域，场景已复位';
    }
    b.quaternion.normalize();
  }

  step(dt,input={}) {
    this._sanity();
    if(!Number.isFinite(dt)||dt<=0) return this.telemetry();
    this._accumulator+=Math.min(dt,.1);
    const fixed=1/120;
    let count=0;
    while(this._accumulator>=fixed-1e-10&&count<13) {this._advance(fixed,input);this._accumulator-=fixed;count++;}
    return this.telemetry();
  }

  telemetry() {
    const b=this.body,a=this._angles(),p=this.params;
    const downFrom=b.position.vadd(V(0,.01,0)),downTo=b.position.vadd(V(0,-200,0));
    const hit=this._raySurface(downFrom,downTo);
    const altitude=hit?Math.max(0,this._ray.distance-.01):b.position.y;
    return {
      speedKmh:b.velocity.length()*3.6,forwardSpeedKmh:b.velocity.dot(b.quaternion.vmult(Z))*3.6,
      altitude,altitudeDatum:'重心至世界竖直向下最近碰撞面的距离',heightWorld:b.position.y,
      verticalSpeed:b.velocity.y,rollDeg:a.roll*180/Math.PI,pitchDeg:a.pitch*180/Math.PI,
      headingDeg:((a.heading*180/Math.PI)%360+360)%360,
      mass:b.mass,pressureBar:p.supplyMode==='bench'?p.initialPressureBar:p.initialPressureBar*this.gasMass/Math.max(.001,this.gasInitialMass),
      gasFraction:this.gasMass/Math.max(.001,this.gasInitialMass),gasMass:this.gasMass,initialGasMass:this.gasInitialMass,
      supplyMode:p.supplyMode,pressureLimited:this._pressureLimited,thrustN:this._thrustN,suctionN:this._suctionForce,
      sealQuality:this._sealQuality||0,suctionEnabled:this.suctionEnabled,contactCount:this._contactCount,
      energyKWh:Math.max(0,p.batteryKWh-this._energyUsed),energyUsedKWh:this._energyUsed,
      gLoad:this._gLoad,mode:this.mode,status:this.status,simTime:this.simTime,scenario:this.scenario,
      targetAltitude:this._heightTarget,maneuver:this._maneuver?{...this._maneuver}:null,
      position:plain(b.position),velocity:plain(b.velocity),quaternion:{x:b.quaternion.x,y:b.quaternion.y,z:b.quaternion.z,w:b.quaternion.w},
      angularVelocity:plain(b.angularVelocity),fault:this._fault,
      nozzles:this._nozzles.map(n=>({id:n.id,kind:n.kind,position:plain(n.position),direction:plain(n.direction),force:n.force,maxForce:n.maxForce})),
      wheelStates:this.wheelStates.map(w=>({...w,position:{...w.position}})),
    };
  }
}
