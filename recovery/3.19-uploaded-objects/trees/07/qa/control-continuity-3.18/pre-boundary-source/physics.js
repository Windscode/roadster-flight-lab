import * as CANNON from './vendor/cannon-es.js';
import {roadWheelAngle,nozzleExhaustVelocity,hoverBudget,rearWingPose,quickRollManeuverProfile,sampleRollManeuver} from './vehicle-models.js';
import {exportSimulationState,importSimulationState} from './simulation-snapshot.js';
import {solveStaticWrench,staticWrenchFeasible} from './trim-feasibility.js';
import {sampleVehicleClearance,sampleQuickRollHeadroom} from './vehicle-clearance.js';
import {resetSafetyJournal,noteSafetyInput,rememberValidStep,preserveFailure,getFailureReport,contactDiagnostics,motionDiagnostics,maneuverDiagnostics,noteManeuverAction,noteManeuverEnd} from './simulation-safety.js';
import {DEFAULT_OBSERVATION,observationConfiguration,measureControlState,controllerBody} from './control-observation.js';
import {integrateWheel,regularizedSlip,lateralTireForce} from './tire-dynamics.js';
import {describePilotInputIntent} from './pilot-input-intent.js';
import {circularWheelSupport} from './wheel-contact-envelope.js';
import {contactStepSchedule} from './contact-step-schedule.js';
import {startPitchManeuver,manualPitchEnvelope} from './pitch-maneuver.js';
import {installCoulombContactFriction} from './contact-friction.js';
import {installContactLedger} from './contact-ledger.js';
import {CITY,CITY_COLLIDERS,CITY_LOCATIONS} from './city-data.js';
import {STREET_COLLIDERS} from './street-life.js';
import {StaticCityBroadphase} from './static-city-broadphase.js';
import {WIND_LAB_GEOMETRY,WIND_LAB_SPAWN} from './wind-lab-data.js';
import {SEAL_OUTLINE,SEAL_SEGMENT_LENGTHS,SEAL_PERIMETER,SKIRT_BASE_Y,SKIRT_MAX_EXTENSION,SKIRT_RETRACTED_EXTENSION} from './vehicle-layout.js';

// An explicit engineering model: published demonstrations do not disclose enough
// information to identify Tesla's real mass, inertia, nozzle maps or controllers.
export const DEFAULT_PARAMS = Object.freeze({
  dryMass: 1950, gravity: 9.81, tireMu: 1.25, springRate: 65000,
  suspensionDamping: 5800, suspensionRest: 0.37, suspensionMin: .24, suspensionDroop: .04, wheelRadius: 0.37,
  maxMotorForce: 24000, motorPower: 700000, brakeForce: 42000,
  regenForce: 2600, regenPower: 60000,
  steeringAssist:true,tractionAssist:true,absEnabled:true,wheelInertia:1.8,roadSurface:'dry',wetGripMultiplier:.52,splitMuPositionX:0,steeringAccelG:1.0,cornerStiffnessFront:82000,cornerStiffnessRear:90000,tireRelaxationLength:.35,
  dragArea: 0.58, airDensity: 1.225,
  wingMode:'active',wingDeployment:0,wingAreaM2:.38,wingDragCoefficient:.75,wingDownforceCoefficient:1.1,wingActuatorRate:1.5,
  tankLitres: 600, initialPressureBar: 350, regulatorBar: 50,
  gasTemperatureK: 293.15, exhaustVelocity: 650, nozzleModel:'isentropic',nozzleVelocityEfficiency:.90,ambientPressureBar:1,climbRateMps:5.0,verticalAccelerationMps2:5,
  gasGamma: 1.4, tankThermalTime: 90, gasModel: 'adiabatic',
  valveRiseTime: .045, valveFallTime: .025,
  liftNozzleMax: 20000, sideNozzleMax: 5500, axialNozzleMax: 11000,
  suctionPressurePa: 8200, suctionArea: 4.8, sealRange: .08,
  fanPower:26000,fanEfficiency:.75,sealPerimeter:SEAL_PERIMETER,sealLeakCd:.6,sealLipGap:.003,skirtReach:SKIRT_MAX_EXTENSION+.126,
  batteryKWh: 200, supplyMode: 'bench', hoverHeight: 4,
  positionGain:2.4,velocityGain:3.1,altitudeGain:3.2,verticalDamping:3.6,attitudeResponse:4.5,
  rollRateDegS:180,pitchRateDegS:60,yawRateDegS:46,angularAccelerationDegS2:360,
});
export const PHYSICS_HZ=120, TELEMETRY_HZ=20;

export const SCENARIOS = Object.freeze({
  ...Object.fromEntries(CITY_LOCATIONS.map(s=>[s.id,{label:s.label,position:s.position,rotation:[0,s.yaw||0,0],mode:'drive'}])),
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
const WHEEL_NAMES = ['FR','FL','RR','RL']; // Driver-relative: right is local -X.

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
 * SI units throughout. Fixed 120 Hz pilot/controller input; the same force and
 * Cannon equations refine to 960 Hz near fast hard contact.
 * Controls are forces at actuators/contact patches; no commanded body pose.
 */
export class RoadsterSim {
  constructor(params={},options={}) {
    this.params = {...DEFAULT_PARAMS,...params};
    this.worldType=options.world==='windlab'?'windlab':'city';this._wind=null;
    this._observationConfig={...DEFAULT_OBSERVATION};this._nozzleFault=null;
    this.world = new CANNON.World({gravity:V(0,-this.params.gravity,0)});
    // Sparse contact history avoids clearing N(N-1)/2 static-city pairs at 120 Hz.
    // Cannon's native object matrix preserves contact / collision event semantics.
    this.world.collisionMatrix = new CANNON.ObjectCollisionMatrix();
    this.world.collisionMatrixPrevious = new CANNON.ObjectCollisionMatrix();
    this.world.solver.iterations = 16;
    this.world.solver.tolerance = 1e-7;
    this.world.allowSleep = false;
    this.world.broadphase = new StaticCityBroadphase(this.world);
    this.world.defaultContactMaterial.friction = .35;
    this.world.defaultContactMaterial.restitution = .03;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.defaultContactMaterial.contactEquationRelaxation = 5;
    this._roadMaterial=new CANNON.Material({friction:.35,restitution:.03});
    this._wheelStopMaterial=new CANNON.Material({friction:0,restitution:.01});this._wheelStopMaterial.name='wheel-bump-stop';
    this.geometry = [];
    this._createWorld();
    this.body = new MomentumBody({mass:this.params.dryMass,linearDamping:.004,angularDamping:.065,
      collisionFilterGroup:2,collisionFilterMask:1,allowSleep:false});
    this.body.addShape(new CANNON.Box(V(.93,.25,1.62)));
    this.body.addShape(new CANNON.Box(V(.86,.14,.36)),V(0,.05,1.84));
    this.body.addShape(new CANNON.Box(V(.90,.16,.35)),V(0,.02,-1.81));
    this.body.addShape(new CANNON.Box(V(.71,.26,.86)),V(0,.37,-.28));
    this.world.addBody(this.body);
    this._wheelStopIndices=[];
    for(const a of WHEEL_LOCATIONS){const shape=new CANNON.Cylinder(this.params.wheelRadius,this.params.wheelRadius,.265,20);shape.material=this._wheelStopMaterial;const q=new CANNON.Quaternion();q.setFromAxisAngle(V(0,0,1),Math.PI/2);this._wheelStopIndices.push(this.body.shapes.length);this.body.addShape(shape,V(a[0],a[1]-this.params.suspensionMin,a[2]),q);}
    this._ray = new CANNON.RaycastResult();
    this._wheelRays = WHEEL_LOCATIONS.map(()=>new CANNON.RaycastResult());
    this._pads = [[-.69,-.20,1.04],[.69,-.20,1.04],[-.69,-.20,-1.04],[.69,-.20,-1.04]].map(a=>V(...a));
    this._nozzles = [];
    WHEEL_LOCATIONS.forEach((a,i)=>this._nozzles.push(this._nozzle(`lift-${WHEEL_NAMES[i]}`,V(Math.sign(a[0])*.59,-.32,a[2]),V(0,1,0),'lift')));
    WHEEL_LOCATIONS.forEach((a,i)=>this._nozzles.push(this._nozzle(`roll-${WHEEL_NAMES[i]}`,V(a[0],-.22,a[2]),V(a[0]<0?1:-1,0,0),'roll')));
    this._nozzles.push(this._nozzle('rear-boost',V(0,0,-2.07),V(0,0,1),'longitudinal'));
    this._nozzles.push(this._nozzle('front-brake',V(0,0,2.07),V(0,0,-1),'longitudinal'));
    this.wheelStates = WHEEL_LOCATIONS.map((a,i)=>({id:WHEEL_NAMES[i],steer:0,rotation:0,suspensionLength:.30,
      contact:false,position:{x:a[0],y:a[1]-.30,z:a[2]},normalLoadN:0,slipAngle:0}));
    installCoulombContactFriction(this);installContactLedger(this);
    this.stabilizationMode='off';this.airStabilization=false;
    this.reset(this.worldType==='windlab'?'windlab':'free');
  }

  _nozzle(id,position,direction,kind) {
    const torque=position.cross(direction);
    return {id,position,direction,kind,force:0,command:0,maxForce:0,column:[direction.x,direction.y,direction.z,torque.x,torque.y,torque.z]};
  }

  _addBox(id,kind,size,position,rotation=[0,0,0],color) {
    const q=new CANNON.Quaternion();q.setFromEuler(...rotation,'XYZ');
    const b=new CANNON.Body({mass:0,position:V(...position),quaternion:q,collisionFilterGroup:1,collisionFilterMask:2});
    b.material=this._roadMaterial;
    b.addShape(new CANNON.Box(V(size[0]/2,size[1]/2,size[2]/2)));
    b.userData={id,kind};this.world.addBody(b);
    this.geometry.push({id,type:'box',kind,size:[...size],position:[...position],quaternion:quatArray(q),color});
  }

  _createWorld() {
    if(this.worldType==='windlab'){
      for(const c of WIND_LAB_GEOMETRY)this._addBox(c.id,c.kind,c.size,c.position,c.rotation,c.color);
      return;
    }
    this._addBox('ground','floor',[CITY.extent*2,1,CITY.extent*2],[0,-.5,0]);
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
    for(const c of [...CITY_COLLIDERS,...STREET_COLLIDERS])this._addBox(c.id,c.kind,c.size,c.position,c.rotation);
    this._addBox('boundary-west','boundary',[1,4,CITY.extent*2],[-CITY.extent,2,0]);
    this._addBox('boundary-east','boundary',[1,4,CITY.extent*2],[CITY.extent,2,0]);
    this._addBox('boundary-north','boundary',[CITY.extent*2,4,1],[0,2,CITY.extent]);
    this._addBox('boundary-south','boundary',[CITY.extent*2,4,1],[0,2,-CITY.extent]);
  }

  getWorldGeometry() { return this.geometry; }

  _resetMass() {
    this.gasInitialMass = this.params.initialPressureBar*1e5*(this.params.tankLitres/1000)/(287.05*this.params.gasTemperatureK);
    this.gasMass=this.gasInitialMass;
    this.gasTemperature=this.params.gasTemperatureK;
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
    if(this.worldType==='windlab')scenario='windlab';
    else if(!SCENARIOS[scenario])scenario='free';
    const s=scenario==='windlab'?{...WIND_LAB_SPAWN,rotation:[0,0,0]}:SCENARIOS[scenario];this.scenario=scenario;
    this.body.position.set(...s.position);this.body.quaternion.setFromEuler(...s.rotation,'XYZ');
    this.body.velocity.setZero();this.body.angularVelocity.setZero();this.body.force.setZero();this.body.torque.setZero();this.body.vlambda.setZero();this.body.wlambda.setZero();
    // A reset starts a new contact configuration. Old manifolds can contain
    // the state that triggered safety recovery, including non-finite impulses.
    this.world.contacts.length=0;this.world.frictionEquations.length=0;this.world.collisionMatrix.reset();this.world.collisionMatrixPrevious.reset();
    for(const keeper of [this.world.bodyOverlapKeeper,this.world.shapeOverlapKeeper]){keeper.current.length=0;keeper.previous.length=0;}
    this.body.previousPosition.copy(this.body.position);this.body.interpolatedPosition.copy(this.body.position);
    this.body.previousQuaternion.copy(this.body.quaternion);this.body.interpolatedQuaternion.copy(this.body.quaternion);
    this.body.aabbNeedsUpdate=true;this.body.wakeUp();this._resetMass();
    this.mode=s.mode;this.suctionEnabled=scenario==='ceiling'||scenario==='ramp';
    this._fanLevel=this.suctionEnabled?1:0;this._sealLipExtensions=SEAL_OUTLINE.map(()=>this.suctionEnabled?.30:SKIRT_RETRACTED_EXTENSION);this._sealLipContacts=SEAL_OUTLINE.map(()=>null);
    this.simTime=0;this._integration=null;this._accumulator=0;this._energyUsed=0;this._motorWork=0;this._stepCount=0;
    this._heightTarget=s.position[1];this._headingTarget=s.rotation[1];
    // A scenario reset explicitly releases an old world-space hold reference.
    if(this.stabilizationMode==='hold')this.stabilizationMode='level';
    this.airStabilization=this.stabilizationMode!=='off';
    this._holdPositionTarget=null;this._holdQuaternionTarget=null;this._holdActive=false;this._holdFeasible=null;this._holdStatus='inactive';this._poseTargetExplicit=false;this._poseTakeoffActive=false;
    this._stabilizationActive=false;this._heightJogging=false;this._stableJogging=false;this._stableHeight=s.position[1];this._stableHeading=s.rotation[1];
    this._positionTarget=this.body.position.clone();
    this._manualQuaternionTarget=this.body.quaternion.clone();this._manualReferenceRate=V();this._manualCommandInput=V();this._manualPoseFeasible=null;
    this._landingContactTime=0;this._manualTranslationActive=false;
    this._maneuver=null;this._rollReference=0;this._lastVelocity=V();
    this._heightIntegral=0;this._desiredWrench=Array(6).fill(0);this._achievedWrench=Array(6).fill(0);this._allocationError=0;
    this._gLoad=1;this._contactCount=0;this._suctionForce=0;this._thrustN=0;this._pressureLimited=false;
    this._motorForceN=0;this._regenForceN=0;this._longitudinalAcceleration=0;this._steerCentre=0;this._massFlowKgS=0;this._impulseNs=0;this._effectiveExhaustVelocity=nozzleExhaustVelocity(this.params,this.pressureBar(),this.gasTemperature);
    this.status='就绪';this._fault=null;this._thrustWanted=0;this._lastInput={};this._fallReset=false;
    this._nozzles.forEach(n=>{n.force=0;n.command=0;n.maxForce=0;});
    this.wheelStates.forEach((w,i)=>{w.steer=0;w.suspensionLength=.30;w.position={x:WHEEL_LOCATIONS[i][0],y:WHEEL_LOCATIONS[i][1]-.30,z:WHEEL_LOCATIONS[i][2]};w.contactPointWorld=null;w.contactObjectId=null;w.contactGeometry=null;w.contactNormalWorld=plain(this.body.quaternion.vmult(Y));w.slipAngle=0;w.gripUse=0;w.longitudinalForceN=0;w.lateralForceN=0;w.lateralSpeedMps=null;w.longitudinalSpeedMps=null;w.rotation=0;w.angularVelocityRadS=0;w.contact=false;w.normalLoadN=0;w.relaxedSlip=0;w.slipRatio=0;w.absPressure=1;w.tcsFactor=1;w.absActive=false;w.tcsActive=false;w.corneringTractionActive=false;w.corneringDriveScale=1;w.wheelEnergyJ=0;w.brakeDemandN=0;w.serviceBrakeDemandN=0;w.regenBrakeDemandN=0;w.brakeTorqueNm=0;w.serviceBrakeTorqueNm=0;w.regenBrakeTorqueNm=0;w.rollingBrakeTorqueNm=0;});
    for(const index of this._wheelStopIndices){this.body.shapeOrientations[index].setFromEuler(0,0,Math.PI/2,'YXZ');}
    this._wing={deployment:this.params.wingMode==='fixed'?this.params.wingDeployment:0,command:0,dragN:0,downforceN:0,dynamicPressurePa:0,forceBody:{x:0,y:0,z:0},...rearWingPose(this.params.wingMode==='fixed'?this.params.wingDeployment:0)};
    this._observationSeed=this._observationConfig.seed>>>0;this._observationHistory=[];this._observation=null;this._observationBody=null;
    this._gasConsumedKg=0;this._externalGasKg=0;this._brakeDissipationJ=0;this._tireDissipationJ=0;
    this._driveAccounting={torqueBudgetNm:0,requestedTorqueNm:0,postTcsTorqueNm:0,actualTorqueNm:0,mechanicalPowerLimitW:this.params.motorPower,mechanicalPowerW:0,electricalPowerW:0,mechanicalWorkJ:0,electricalWorkJ:0,powerLimited:false,airbornePolicy:this.params.tractionAssist?'unloaded-drive-cut':'equal-four-wheel-shares',shares:[0,0,0,0],brakeMechanicalWorkJ:0,liftOffBrakeMechanicalWorkJ:0,electricalRecoveredWorkJ:0};
    this._verticalControl={commandMps:0,targetMps:0,accelerationLimitMps2:this.params.verticalAccelerationMps2,braking:false,pilotActive:false};
    this._levelRecovery={active:false,status:'inactive',tiltErrorDeg:0,headingTargetRad:0,verticalSupportFeasible:true,torqueSaturated:false};
    this._researchHeightControl={enabled:false,active:false,requestedAccelerationMps2:null,appliedAccelerationMps2:null,commandStep:null,expiresAtStep:null,controllerHash:null,reason:'reset',lastFault:null};
    this._hasPower=this._energyUsed<this.params.batteryKWh;this._sealQuality=0;this._sealDistanceSum=0;this._sealDistanceCount=0;
    measureControlState(this);resetSafetyJournal(this);
    return this;
  }

  exportState(){return exportSimulationState(this);}
  importState(snapshot,options){const result=importSimulationState(this,snapshot,options);resetSafetyJournal(this);return result;}
  getFailureReport(){return getFailureReport(this);}
  getContactDiagnostics(){return contactDiagnostics(this);}
  getClearanceEstimate(options){return sampleVehicleClearance(this,options);}
  setResearchHeightControl({accelerationMps2,step=this._stepCount,controllerHash,expiresAfterSteps=12}={}){
    const reason=!Number.isFinite(accelerationMps2)?'non-finite-output':!Number.isInteger(step)||step!==this._stepCount?'stale-control-step':!Number.isInteger(expiresAfterSteps)||expiresAfterSteps<1||expiresAfterSteps>12?'invalid-expiry':typeof controllerHash!=='string'||controllerHash.length<1||controllerHash.length>128?'invalid-controller-identity':this.worldType!=='windlab'?'research-world-required':this.mode!=='hover'||this.stabilizationMode!=='hold'||this._maneuver?'hover-hold-required':null;
    if(reason){this.clearResearchHeightControl(reason);this._researchHeightControl.lastFault={reason,step:this._stepCount,simTime:this.simTime};return false;}
    const previous=this._researchHeightControl,continuous=previous.enabled&&previous.controllerHash===controllerHash;
    this._researchHeightControl={enabled:true,active:false,requestedAccelerationMps2:accelerationMps2,appliedAccelerationMps2:continuous?previous.appliedAccelerationMps2:0,commandStep:step,expiresAtStep:step+expiresAfterSteps,controllerHash,reason:Math.abs(accelerationMps2)>6?'request-clamped':'awaiting-physical-step',lastFault:null};return true;
  }
  clearResearchHeightControl(reason='cleared'){
    if(!this._researchHeightControl)return;
    this._researchHeightControl={...this._researchHeightControl,enabled:false,active:false,appliedAccelerationMps2:null,reason:String(reason).slice(0,120)};
  }
  _researchHeightAcceleration(fallback,dt){
    const state=this._researchHeightControl;if(!state.enabled)return fallback;
    if(this._stepCount>=state.expiresAtStep){this.clearResearchHeightControl('command-expired');return fallback;}
    const requested=clamp(state.requestedAccelerationMps2,-6,6),before=state.appliedAccelerationMps2??0;
    state.appliedAccelerationMps2=before+clamp(requested-before,-30*dt,30*dt);state.active=true;
    state.reason=Math.abs(state.requestedAccelerationMps2)>6?'request-clamped':Math.abs(state.appliedAccelerationMps2-requested)>1e-9?'slew-limited':'applied';return state.appliedAccelerationMps2;
  }
  setRoadSurface(preset){if(!['dry','wet','split'].includes(preset))return false;this.params.roadSurface=preset;return true;}
  getRoadSurface(){return{preset:this.params.roadSurface,dryMu:this.params.tireMu,wetMu:this.params.tireMu*this.params.wetGripMultiplier,splitPositionX:this.params.splitMuPositionX,splitLowMuSide:'negative-world-x'};}
  _surfaceMu(point){const p=this.params;return p.tireMu*(p.roadSurface==='wet'||p.roadSurface==='split'&&point.x<p.splitMuPositionX?p.wetGripMultiplier:1);}
  setWing({mode=this.params.wingMode,deployment=this.params.wingDeployment}={}){if(!['active','fixed'].includes(mode)||!Number.isFinite(deployment)||deployment<0||deployment>1)return false;this.params.wingMode=mode;this.params.wingDeployment=deployment;return true;}
  setObservation(config={}){try{const next=observationConfiguration(config);this._observationConfig=next;this._observationSeed=next.seed>>>0;this._observationHistory=[];measureControlState(this);return true;}catch{return false;}}
  getObservation(){return{configuration:{...this._observationConfig},sample:this._observation?structuredClone(this._observation):null,truthTime:this.simTime,measurementModel:'sampled uniform bounded noise, deterministic Mulberry32, zero-order-hold delay',channels:'flight position / attitude / velocity feedback; wheel speed and contact switches remain ideal'};}
  getReference(){
    const levelReference=this.stabilizationMode==='level'&&this._levelRecovery.status!=='pilot-pitch';
    const q=levelReference?this._levelQuaternion():this.stabilizationMode==='hold'?this._holdQuaternionTarget:this._manualQuaternionTarget;
    return{mode:this.mode,stabilizationMode:this.stabilizationMode,position:this.stabilizationMode==='hold'&&this._holdPositionTarget?plain(this._holdPositionTarget):plain(this._positionTarget),quaternion:q?{...plain(q),w:q.w}:null,
      height:levelReference?this._stableHeight:this._heightTarget,heading:levelReference?this._stableHeading:this._headingTarget,
      manualRate:plain(this._manualReferenceRate),verticalVelocityMps:this._verticalControl.targetMps,maneuver:this._maneuver?structuredClone(this._maneuver):null};
  }
  _levelQuaternion(){const q=new CANNON.Quaternion();q.setFromEuler(0,this._stableHeading,0,'YXZ');return q;}
  getControlAuthority(){
    const p=this.params,b=this.body,derate=clamp((this.pressureBar()-p.ambientPressureBar)/(p.regulatorBar-p.ambientPressureBar),0,1)*Number(this._hasPower);
    const maxes=this._nozzles.map(n=>(n.kind==='lift'?p.liftNozzleMax:n.kind==='roll'?p.sideNozzleMax:p.axialNozzleMax)*derate*(this._nozzleFault?.id===n.id?this._nozzleFault.scale:1));
    const positive=[0,0,0],negative=[0,0,0];let verticalUpper=0;
    this._nozzles.forEach((n,i)=>{verticalUpper+=Math.max(0,b.quaternion.vmult(n.direction).y)*maxes[i];for(let k=0;k<3;k++){positive[k]+=Math.max(0,n.column[k+3])*maxes[i];negative[k]+=Math.min(0,n.column[k+3])*maxes[i];}});
    const weight=b.mass*p.gravity,lift=maxes.slice(0,4).reduce((a,v)=>a+v,0);
    return{massKg:b.mass,weightN:weight,pressureBar:this.pressureBar(),regulatorBar:p.regulatorBar,liftMaxN:lift,hoverThrustRatio:lift/Math.max(1,weight),hoverReserveN:lift-weight,
      bodyUpDot:b.quaternion.vmult(Y).y,verticalForceUpperBoundN:verticalUpper,verticalForceReserveUpperBoundN:verticalUpper-weight,
      positiveTorqueUpperNm:{x:positive[0],y:positive[1],z:positive[2]},negativeTorqueLowerNm:{x:negative[0],y:negative[1],z:negative[2]},
      currentPoseTrimFeasible:this._holdTrimFeasible(maxes,b.quaternion),levelTargetTrimFeasible:this._holdTrimFeasible(maxes,this._levelQuaternion()),
      currentPoseTrim:this._assessHoldTrim(maxes,b.quaternion),levelTargetTrim:this._assessHoldTrim(maxes,this._levelQuaternion()),
      allocationResidual:this._allocationError,saturatedNozzles:this._nozzles.filter(n=>n.maxForce>0&&n.command>=n.maxForce*.985).map(n=>n.id),
      boundMeaning:'independent-axis bounds; not simultaneously achievable, valve lag and allocation coupling remain'};
  }
  setNozzleFault({id,scale}={}){if(!this._nozzles.some(n=>n.id===id)||!Number.isFinite(scale)||scale<0||scale>1)return false;this._nozzleFault={id,scale};return true;}
  clearNozzleFault(){this._nozzleFault=null;}
  _liftHealthFactor(){return this._nozzleFault?.id.startsWith('lift-')?(3+this._nozzleFault.scale)/4:1;}
  _availableLiftForce(){return 4*this.params.liftNozzleMax*this._liftHealthFactor()*clamp((this.pressureBar()-1)/(this.params.regulatorBar-1),0,1)*Number(this._hasPower);}
  _hoverBudget(){const p=this._liftHealthFactor()<1?{...this.params,liftNozzleMax:this.params.liftNozzleMax*this._liftHealthFactor()}:this.params;return hoverBudget(p,this.gasMass,this.gasTemperature);}

  setMode(mode) {
    if(!['drive','hover','manual'].includes(mode)) return;
    if(this.stabilizationMode==='hold')this.setStabilizationMode('level');
    this.mode=mode;this._maneuver=null;this.clearResearchHeightControl('control-mode-changed');
    this._verticalControl={commandMps:0,targetMps:0,accelerationLimitMps2:this.params.verticalAccelerationMps2,braking:false,pilotActive:false};
    this._heightIntegral=0;
    this._headingTarget=this._angles().heading;
    this._heightTarget=Math.max(this.body.position.y,1.5);
    this._positionTarget.copy(this.body.position);
    this._manualQuaternionTarget=this.body.quaternion.clone();this._manualReferenceRate=V();this._manualCommandInput=V();this._landingContactTime=0;this._manualTranslationActive=false;this._stabilizationActive=false;
    if(mode==='hover' && this.body.position.y<1.3) this._heightTarget=this.params.hoverHeight;
    this._stableHeight=this._heightTarget;this._stableHeading=this._headingTarget;
    if(mode!=='drive')this.suctionEnabled=false;
    this.status=mode==='hover'?'高度 / 姿态闭环接管':mode==='manual'?'手动喷口控制':'轮胎驱动';
  }

  setSuction(enabled) {
    if(this.stabilizationMode==='hold'&&this.suctionEnabled!==!!enabled)this.setStabilizationMode('level');
    this.suctionEnabled=!!enabled;
  }
  setStabilizationMode(mode){
    if(!['off','level','hold'].includes(mode))return false;
    if(!this._maneuver){
      // Every G transition captures the physical state now, including level ->
      // off after sustained translation. Never revive a pre-G world target.
      // Hand the underlying hover mode the current reference, not a stale
      // position from before hold. Only controller references change here.
      this._positionTarget.copy(this.body.position);this._heightTarget=this.body.position.y;
      this._headingTarget=this._angles().heading;this._heightIntegral=0;this._heightJogging=false;this._stableJogging=false;this._manualTranslationActive=Math.hypot(this.body.velocity.x,this.body.velocity.z)>.08;
    }
    this.stabilizationMode=mode;this.airStabilization=mode!=='off';this._stabilizationActive=false;
    if(mode!=='hold')this.clearResearchHeightControl('stabilization-mode-changed');
    this._holdActive=false;this._holdFeasible=null;this._holdStatus='inactive';
    this._holdPositionTarget=null;this._holdQuaternionTarget=null;this._poseTargetExplicit=false;this._poseTakeoffActive=false;
    // Switching off automatic levelling preserves the attitude reached now.
    // This reference is subsequently moved by rate commands, never the body.
    if(mode==='off'){this._manualQuaternionTarget=this.body.quaternion.clone();this._manualReferenceRate=V();this._manualCommandInput=V();}
    if(mode!=='off'){
      this._stableHeight=this.body.position.y;this._stableHeading=this._angles().heading;
      this._stableJogging=false;this._heightJogging=false;this._heightIntegral=0;
      this._manualReferenceRate.setZero();this._manualCommandInput.setZero();
      // G captures projected heading only. A previous manually tilted pose is
      // not the new level target, including near +/-180 degrees of Euler roll.
      if(mode==='level')this._manualQuaternionTarget=this._levelQuaternion();
    }
    this._verticalControl={commandMps:0,targetMps:0,accelerationLimitMps2:this.params.verticalAccelerationMps2,braking:false,pilotActive:false};
    this._levelRecovery={active:false,status:mode==='level'?'armed':'inactive',tiltErrorDeg:Math.acos(clamp(this.body.quaternion.vmult(Y).y,-1,1))*180/Math.PI,
      headingTargetRad:this._stableHeading,verticalSupportFeasible:true,torqueSaturated:false};
    if(mode==='hold'){
      // Capture once at the pilot's command, even when contact temporarily
      // inhibits thrust. Never recapture a drifting reference every substep.
      this._holdPositionTarget=this.body.position.clone();this._holdQuaternionTarget=this.body.quaternion.clone();
      this._holdStatus=this._contactCount||this.suctionEnabled?'surface':'tracking';
      this.status='定姿定点：已捕获当前姿态与位置，喷口闭环减速';
    }
    return true;
  }
  // Historical research archives store a boolean; true remains the original
  // level-and-damp controller, never the new fixed-attitude hold controller.
  setAirStabilization(enabled){return this.setStabilizationMode(enabled?'level':'off');}
  setPoseTarget(target){
    const position=target?.position,q=target?.quaternion;
    if(!position||!q||!['x','y','z'].every(k=>Number.isFinite(position[k]))||!['x','y','z','w'].every(k=>Number.isFinite(q[k])))return false;
    const norm=Math.hypot(q.x,q.y,q.z,q.w);
    if(norm<1e-6||Math.abs(position.x)>CITY.extent+60||Math.abs(position.z)>CITY.extent+60||position.y<.1||position.y>300)return false;
    this.setMode('hover');
    this.setStabilizationMode('hold');
    this._holdPositionTarget=V(position.x,position.y,position.z);
    this._holdQuaternionTarget=new CANNON.Quaternion(q.x/norm,q.y/norm,q.z/norm,q.w/norm);
    this._poseTargetExplicit=true;this._poseTakeoffOriginHeight=this.body.position.y;this._poseTakeoffQuaternion=this.body.quaternion.clone();
    this._heightTarget=position.y;this.status='研究目标：位置 / 四元数参考已更新';return true;
  }
  setWind(config={}){
    const {speedMps=0,directionDeg=0,gustMps=0,gustPeriodS=5}=config;
    if(![speedMps,directionDeg,gustMps,gustPeriodS].every(Number.isFinite)||speedMps<0||speedMps>80||gustMps<0||gustMps>40||gustPeriodS<.2||gustPeriodS>300)return false;
    this._wind={speedMps,directionDeg:((directionDeg%360)+360)%360,gustMps,gustPeriodS};return true;
  }
  clearWind(){this._wind=null;}
  getWind(){return this._wind?{...this._wind}:null;}
  _windVelocity(time=this.simTime){
    if(!this._wind)return V();
    const w=this._wind,speed=Math.max(0,w.speedMps+w.gustMps*Math.sin(2*Math.PI*time/w.gustPeriodS)),a=w.directionDeg*Math.PI/180;
    return V(Math.sin(a)*speed,0,Math.cos(a)*speed);
  }
  setSupplyMode(mode) { this.setParam('supplyMode',mode); }
  refillGas() { this._resetMass();this._pressureLimited=false;this.status='试验气源已补充'; }

  setParam(key,value,{refillGas=true}={}) {
    if(key==='supplyMode') { if(['finite','bench'].includes(value)) this.params[key]=value;return; }
    if(['steeringAssist','tractionAssist','absEnabled'].includes(key)){this.params[key]=!!value;return;}
    if(key==='roadSurface'){this.setRoadSurface(value);return;}
    if(key==='wingMode'){this.setWing({mode:value});return;}
    if(key==='nozzleModel'){if(['isentropic','constant'].includes(value))this.params[key]=value;return;}
    if(key==='gasModel') { if(['adiabatic','isothermal'].includes(value))this.params[key]=value;return; }
    const limits={wheelInertia:[.6,5],wetGripMultiplier:[.15,1],splitMuPositionX:[-300,300],wingDeployment:[0,1],wingAreaM2:[0,.8],wingDragCoefficient:[0,2],wingDownforceCoefficient:[0,2],wingActuatorRate:[.1,5],dryMass:[800,5000],gravity:[.1,20],tireMu:[.15,3],springRate:[25000,200000],
      suspensionDamping:[1500,18000],maxMotorForce:[0,60000],motorPower:[10000,2000000],
      tankLitres:[50,3000],initialPressureBar:[20,700],regulatorBar:[5,150],exhaustVelocity:[100,1000],
      liftNozzleMax:[1000,50000],sideNozzleMax:[100,20000],axialNozzleMax:[100,50000],
      suctionPressurePa:[0,25000],suctionArea:[.1,8],hoverHeight:[1,40],dragArea:[.1,3],
      valveRiseTime:[.005,.2],valveFallTime:[.005,.2],regenForce:[0,8000],cornerStiffnessFront:[20000,150000],cornerStiffnessRear:[20000,150000],steeringAccelG:[.2,1.2],nozzleVelocityEfficiency:[.5,1],climbRateMps:[.5,14],verticalAccelerationMps2:[1,10],
      positionGain:[.2,8],velocityGain:[.3,8],altitudeGain:[.3,10],verticalDamping:[.5,10],attitudeResponse:[1,7],
      rollRateDegS:[15,360],pitchRateDegS:[5,120],yawRateDegS:[5,100],angularAccelerationDegS2:[20,720]};
    if(!(key in limits)||!Number.isFinite(Number(value))) return;
    this.params[key]=clamp(Number(value),...limits[key]);
    if(key==='gravity') this.world.gravity.set(0,-this.params.gravity,0);
    if(['dryMass','tankLitres','initialPressureBar'].includes(key)) {
      // Leaving a research task may restore the user's settings without
      // manufacturing replacement gas or changing the recorded consumption.
      // Normal parameter editing retains its explicit refill behavior.
      if(refillGas)this._resetMass();else this._updateMass(true);
    }
    if(key==='hoverHeight') this._heightTarget=this.params.hoverHeight;
  }

  startManeuver(name) {
    const previous=this._maneuver,result=this._startManeuver(name);
    noteManeuverAction(this,name,result,previous);return result;
  }

  _startManeuver(name) {
    if(name==='pitch')return startPitchManeuver(this);
    if(name==='cancel') {
      const wasSurface=this._maneuver?.name==='ramp'||this._contactCount>1;
      this._maneuver=null;this.setMode(wasSurface?'drive':'hover');
      if(!wasSurface){this._heightTarget=this.body.position.y;this._stableHeight=this.body.position.y;this._positionTarget.copy(this.body.position);this._heightIntegral=0;this._manualTranslationActive=Math.hypot(this.body.velocity.x,this.body.velocity.z)>.08;}
      return;
    }
    if(name==='land') {
      this.setMode('hover');this._maneuver={name:'land',phase:'descent',time:0};return;
    }
    if(name==='roll') {
      if(this._maneuver?.name==='roll'){this.status='滚转预检：快翻正在执行，请等待完成或先取消';return false;}
      const p=this.params,b=this.body,profile=quickRollManeuverProfile(),duration=profile.durationS,origin=plain(b.position);
      if(b.quaternion.vmult(Y).y<Math.cos(10*Math.PI/180)){this.status='滚转预检：快翻要求初始倾角不超过 10°，请先回正车身（G）';return false;}
      if(b.angularVelocity.length()>.5){this.status='滚转预检：初始角速度过大，请先松键制动或用 G 回正';return false;}
      const below=this.traceSurface(b.position,{x:0,y:-1,z:0},220);
      const grounded=this._contactCount>=2||(below?.distance<.8&&Math.abs(b.velocity.y)<.7);
      const availableAccel=this._availableLiftForce()/b.mass-p.gravity,netAccel=availableAccel*.88;
      if(availableAccel<6||this._energyUsed>=p.batteryKWh){this.status='滚转预检：当前压力 / 供电下的起跳与制动推力不足';return false;}
      const authority=this.getControlAuthority(),rollTorque=Math.min(authority.positiveTorqueUpperNm.z,-authority.negativeTorqueLowerNm.z);
      const referenceTorque=b.inertia.z*profile.accelerationRadS2,torqueMargin=rollTorque/Math.max(1,referenceTorque);
      // The geometric torque upper bound is not simultaneous full-wrench
      // authority. Leave 40% for tracking, valve response and pitch/yaw control.
      if(torqueMargin<1.65){this.status='滚转预检：快翻的双向滚转 / 制动力矩余量不足，请检查压力、喷口或惯量';return false;}
      // The old g*T/2 launch assumed an unsupported entire rotation. The fast
      // profile accelerates only through upright quarter-turns; its inverted
      // constant-rate coast lasts 0.5 s. Keep an explicit 1.55 m/s valve/tracking
      // reserve, instead of binding takeoff to the pilot's comfort acceleration.
      const launchVelocity=p.gravity*profile.cruiseS*.5+1.55;
      const launchTime=Math.max(0,launchVelocity-b.velocity.y)/netAccel+4*p.valveRiseTime+.15;
      const minimumRotationClearanceM=1.55;
      const launchRise=Math.max(0,minimumRotationClearanceM-(below?.distance??origin.y),(b.velocity.y+launchVelocity)*launchTime*.5);
      const arrestDistance=Math.max(0,-b.velocity.y)**2/(2*netAccel)+Math.max(0,-b.velocity.y)*4*p.valveRiseTime;
      if(!grounded&&below&&below.distance<1.1+arrestDistance){this.status='滚转预检：当前下降速度下没有足够起跳制动净空';return false;}
      // Nominal vertical contribution of real differential main jets, with its
      // signed world-up direction. The maximum-positive version separately
      // bounds ceiling headroom; it is not granted as fictitious lift.
      let estimatedY=0,estimatedVy=launchVelocity,peakY=0,peakVy=launchVelocity,rotationPeak=0;
      for(let i=0;i<200;i++){
        const sample=sampleRollManeuver(profile,(i+.5)/200*duration),angle=sample.angleRad,alpha=sample.accelerationRadS2;
        const rollAccel=b.inertia.z/b.mass/.59*Math.abs(alpha),step=duration/200;
        estimatedVy+=(rollAccel*Math.cos(angle)-p.gravity)*step;estimatedY+=estimatedVy*step;
        peakVy+=(rollAccel*Math.max(0,Math.cos(angle))-p.gravity)*step;peakY+=peakVy*step;rotationPeak=Math.max(rotationPeak,peakY);
      }
      const peakRise=launchRise+rotationPeak+1.8;
      const overhead=sampleQuickRollHeadroom(b.position,(origin,direction,distance)=>this.traceSurface(origin,direction,distance),peakRise+1.5);
      if(overhead.distanceM!==null&&overhead.distanceM<peakRise+1.2){this.status='滚转预检：快翻旋转 / 制动包络上方净空不足';return false;}
      // Account for takeoff, actual reference angular impulse, the predicted
      // remaining downward speed, then 1.5 s settling and 16% explicit margin.
      // Counting half of g*T again for arrest double-counted the fast profile's
      // differential-jet support and rejected otherwise feasible finite runs.
      const launchImpulse=b.mass*(Math.max(0,launchVelocity-b.velocity.y)+p.gravity*launchTime);
      const rotationImpulse=2*b.inertia.z*profile.rateRadS/.59;
      const arrestSpeed=Math.max(0,-estimatedVy),arrestTime=arrestSpeed/netAccel+4*p.valveRiseTime+.15;
      const arrestImpulse=b.mass*(arrestSpeed+p.gravity*arrestTime),reserveImpulse=b.mass*p.gravity*1.5;
      const requiredImpulse=1.16*(launchImpulse+rotationImpulse+arrestImpulse+reserveImpulse),availableImpulse=this._hoverBudget().impulseNs;
      if(p.supplyMode==='finite'&&availableImpulse<requiredImpulse){this.status=`滚转预检：剩余冲量不足：可用 ${(availableImpulse/1000).toFixed(1)} kN·s，快翻 / 回稳预算 ${(requiredImpulse/1000).toFixed(1)} kN·s`;return false;}
      this.setMode('hover');
      this._maneuver={name:'roll',phase:'climb',time:0,angle:0,duration,origin,originGrounded:grounded,returnHeight:origin.y,
        launchVelocity,launchTime,launchAccelerationMps2:netAccel,minimumRotationClearanceM,profile,actualRollRad:0,
        requiredImpulseNs:requiredImpulse,plannedPeakHeight:origin.y+peakRise,autoLand:grounded,
        preflight:{policy:'quick-roll-1',referenceTorqueNm:referenceTorque,rollTorqueUpperNm:rollTorque,torqueMargin,availableAccelMps2:availableAccel,
          launchImpulseNs:launchImpulse,rotationImpulseNs:rotationImpulse,arrestImpulseNs:arrestImpulse,settlingImpulseNs:reserveImpulse,impulseMargin:1.16,
          predictedRotationEndVerticalMps:estimatedVy,predictedRotationDisplacementM:estimatedY,availableImpulseNs:Number.isFinite(availableImpulse)?availableImpulse:null}};
      this._heightTarget=origin.y;this.status=grounded?'快翻：短起跳，完成一周后着陆':'快翻：完成一周并返回起始高度';return true;
    }
    if(name==='ramp') {
      this.setMode('drive');this.suctionEnabled=true;
      this._maneuver={name:'ramp',phase:'approach',time:0};this.status='弧面试验：低速巡航';
    }
  }

  _angles(body=this.body) {
    const f=body.quaternion.vmult(Z),u=body.quaternion.vmult(Y),r=body.quaternion.vmult(X);
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

  traceSurface(origin,direction,distance=8) {
    const from=V(origin.x,origin.y,origin.z),to=from.vadd(V(direction.x,direction.y,direction.z).scale(distance));
    return this._raySurface(from,to)?{point:plain(this._ray.hitPointWorld),normal:plain(this._ray.hitNormalWorld),distance:this._ray.distance,objectId:this._ray.body?.userData?.id??null,kind:this._ray.body?.userData?.kind??null}:null;
  }

  pressureBar() {
    const p=this.params;
    return p.supplyMode==='bench'?p.initialPressureBar:this.gasMass*287.05*this.gasTemperature/(p.tankLitres/1000)/1e5;
  }

  _applyWorldForce(force,localPoint) {
    this.body.applyForce(force,this.body.quaternion.vmult(localPoint));
  }

  _wheels(dt,input) {
    const b=this.body,p=this.params,up=b.quaternion.vmult(Y);
    // Lateral sliding does not make a fast car slow: using only body-forward
    // speed made the steering envelope grow as beta grew. Use the complete
    // tangent-plane speed and the actual road's load-weighted contact grip.
    const planarSpeed=Math.sqrt(Math.max(0,b.velocity.lengthSquared()-b.velocity.dot(up)**2));
    const previousLoad=this.wheelStates.reduce((sum,w)=>sum+(w.contact?w.normalLoadN:0),0);
    const steeringMu=previousLoad>1?this.wheelStates.reduce((sum,w)=>sum+(w.contact?this._surfaceMu(w.contactPointWorld||b.position)*w.normalLoadN:0),0)/previousLoad:this._surfaceMu(b.position);
    const steerTarget=roadWheelAngle(input.steer,planarSpeed,p,steeringMu);
    this._steerCentre+=clamp((steerTarget-this._steerCentre)*(1-Math.exp(-dt/.10)),-1.8*dt,1.8*dt);
    const contacts=[];
    for(let i=0;i<4;i++) {
      const mount=V(...WHEEL_LOCATIONS[i]),from=b.pointToWorldFrame(mount);
      const extension=p.suspensionRest+p.suspensionDroop;
      const ray=this._wheelRays[i],w=this.wheelStates[i];
      const turn=this._steerCentre,radius=2.84/Math.max(1e-6,Math.tan(Math.abs(turn)));
      w.steer=i<2?Math.sign(turn)*Math.atan(2.84/(radius-Math.sign(turn)*mount.x)):0;
      // A wheel can strike a curb or land before its suspension ray reports
      // support. Its collider must follow the same steering command in air.
      const stopQ=new CANNON.Quaternion();stopQ.setFromEuler(0,w.steer,Math.PI/2,'YXZ');b.shapeOrientations[this._wheelStopIndices[i]].copy(stopQ);b.aabbNeedsUpdate=true;
      const wheelForward=b.quaternion.vmult(V(Math.sin(w.steer),0,Math.cos(w.steer)));
      const hit=circularWheelSupport(this.world,{mount:from,up,forward:wheelForward,radius:p.wheelRadius,minLength:p.suspensionMin-p.wheelRadius,maxLength:extension},ray);
      w.contactGeometry=hit?{...ray.wheelSupport}:null;
      const alignment=hit?ray.hitNormalWorld.dot(up):0;
      w.contactNormalWorld=hit?plain(ray.hitNormalWorld):plain(up);
      w.contactPointWorld=hit?plain(ray.hitPointWorld):null;w.contactObjectId=hit?ray.body?.userData?.id??null:null;
      const length=hit?ray.distance-p.wheelRadius:extension;
      w.contact=!!hit && length<=extension && alignment>.30;
      w.suspensionLength=clamp(length,p.suspensionMin,extension);
      w.position={x:mount.x,y:mount.y-w.suspensionLength,z:mount.z};w.normalLoadN=0;
      w.brakeDemandN=0;w.longitudinalForceN=0;w.lateralForceN=0;w.gripUse=0;
      w.lateralSpeedMps=null;w.longitudinalSpeedMps=null;w.lateralDemandN=0;w.rollingContactWeight=0;
      if(!w.contact) { w.relaxedSlip=0;continue; }
      const relative=ray.hitPointWorld.vsub(b.position);
      const velocity=b.angularVelocity.cross(relative).vadd(b.velocity);
      const vn=velocity.dot(ray.hitNormalWorld);
      const compression=p.suspensionRest-length;
      const bump=Math.max(0,p.suspensionMin+.015-length);
      const spring=clamp((p.springRate*compression-p.suspensionDamping*vn+600000*bump)/Math.max(.4,alignment),0,b.mass*p.gravity*2.3);
      w.contact=spring>1;
      if(!w.contact)continue;
      w.normalLoadN=spring;
      b.applyForce(ray.hitNormalWorld.scale(spring),relative);
      const forward=b.quaternion.vmult(V(Math.sin(w.steer),0,Math.cos(w.steer)));
      forward.vsub(ray.hitNormalWorld.scale(forward.dot(ray.hitNormalWorld)),forward);forward.normalize();
      const right=ray.hitNormalWorld.cross(forward);right.normalize();
      const vlong=velocity.dot(forward),vlat=velocity.dot(right);
      w.lateralSpeedMps=vlat;w.longitudinalSpeedMps=vlong;
      w.slipAngle=Math.atan2(vlat,Math.abs(vlong)+.6);
      contacts.push({w,relative,normal:ray.hitNormalWorld.clone(),forward,right,vlong,vlat});
    }
    this._contactCount=contacts.length;
    const n=Math.max(1,contacts.length),g=this.world.gravity;
    const totalLoad=Math.max(1,contacts.reduce((sum,c)=>sum+c.w.normalLoadN,0));
    this._motorForceN=0;this._regenForceN=0;
    let driveForce=this._hasPower&&input.brake<.01&&(this.mode==='drive'||contacts.length>0)?input.throttle*p.maxMotorForce:0;
    const speed=Math.abs(b.velocity.dot(b.quaternion.vmult(Z)));
    // Keep the existing 60/40 service-axle budgets. Sharing equal quarters
    // inside an axle overloaded the lightly loaded inside tire during a bend.
    // An unloaded wheel gets no extra share while its axle partner is grounded;
    // an entirely airborne axle retains its budget for braking wheel spin.
    const axleLoads=[this.wheelStates[0].normalLoadN+this.wheelStates[1].normalLoadN,this.wheelStates[2].normalLoadN+this.wheelStates[3].normalLoadN];
    const serviceShares=this.wheelStates.map((w,i)=>axleLoads[i>>1]>1?(i<2?.6:.4)*w.normalLoadN/axleLoads[i>>1]:(i<2?.30:.20));
    const pedal=Math.abs(input.throttle),pedalU=clamp((pedal-.010)/.010,0,1),pedalBlend=pedalU*pedalU*(3-2*pedalU);
    const liftOff=this._hasPower&&contacts.length?Math.min(p.brakeForce,p.regenForce,p.regenPower/Math.max(speed,1))*(1-pedalBlend):0;
    const serviceRequest=input.brake*p.brakeForce,totalBrakeRequest=Math.max(liftOff,serviceRequest);
    const takeover=liftOff>0?clamp(serviceRequest/liftOff,0,1):1,serviceBlend=takeover*takeover*(3-2*takeover);
    const regenRequest=liftOff*(1-serviceBlend),serviceRemainder=totalBrakeRequest-regenRequest;
    const regenDemands=this.wheelStates.map(w=>regenRequest*w.normalLoadN/totalLoad);
    const serviceDemands=serviceShares.map(share=>serviceRemainder*share);
    // A small brake-pedal movement must not release the existing low-speed
    // parking hold. Top-ups share only the unused vehicle brake budget.
    const parkTopUps=this.wheelStates.map((w,i)=>{
      const c=contacts.find(c=>c.w===w),holding=pedal<.010&&c&&Math.abs(c.vlong)<.18;
      return holding?Math.max(0,p.brakeForce*serviceShares[i]-serviceDemands[i]-regenDemands[i]):0;
    });
    const parkSum=parkTopUps.reduce((sum,value)=>sum+value,0),parkScale=Math.min(1,Math.max(0,p.brakeForce-totalBrakeRequest)/Math.max(1e-12,parkSum));
    for(let i=0;i<4;i++)serviceDemands[i]+=parkTopUps[i]*parkScale;
    const poweredWheels=p.tractionAssist?this.wheelStates.filter(w=>w.contact):this.wheelStates;
    const motorSpeed=Math.max(speed,...poweredWheels.map(w=>Math.abs(w.angularVelocityRadS*p.wheelRadius)));
    driveForce=clamp(driveForce,-p.motorPower/Math.max(8,motorSpeed),p.motorPower/Math.max(8,motorSpeed));
    const pilotDriveForce=driveForce;
    let corneringDriveScale=1;
    if(p.tractionAssist&&contacts.length&&Math.abs(driveForce)>1){
      // Preserve lateral authority before wheelspin develops. The old TCS
      // regulated longitudinal slip alone and could spend the same friction
      // budget twice when W and A/D were held together. Reduce one common
      // motor request using the most constrained contact, preserving the
      // existing load shares; this never adds a yaw moment or modifies motion.
      const requestedAy=Math.min(planarSpeed*planarSpeed*Math.abs(Math.tan(steerTarget))/2.84,
        Math.min(p.steeringAccelG,.85*steeringMu)*p.gravity*Math.abs(input.steer));
      for(const c of contacts){
        const index=this.wheelStates.indexOf(c.w),capacity=this._surfaceMu(c.w.contactPointWorld)*c.w.normalLoadN;
        const corner=(index<2?p.cornerStiffnessFront:p.cornerStiffnessRear)*Math.pow(Math.max(1,c.w.normalLoadN)/5500,.9);
        const currentDemand=Math.abs(Math.tanh(corner*c.w.slipAngle/Math.max(1,capacity))*capacity);
        const lateralDemand=Math.max(currentDemand,c.w.normalLoadN*requestedAy/p.gravity);
        // A 6% command reserve at full steering covers transient load changes.
        // Straight-line drive retains the complete existing torque budget.
        const commandCapacity=capacity*(1-.06*Math.abs(input.steer));
        const longitudinalLimit=Math.sqrt(Math.max(0,commandCapacity*commandCapacity-lateralDemand*lateralDemand));
        corneringDriveScale=Math.min(corneringDriveScale,longitudinalLimit/Math.max(1,Math.abs(driveForce)*c.w.normalLoadN/totalLoad));
      }
      driveForce*=corneringDriveScale;
    }
    const contactByWheel=new Map(contacts.map(c=>[c.w,c]));
    // One axle torque/power budget is normalized across all four wheels. With
    // TCS, unloaded wheels are cut rather than receiving an additional quarter
    // of the already distributed grounded budget. Without TCS the fixed 25%
    // shares allow real airborne spin and waste part of the available power.
    const rawShares=this.wheelStates.map(w=>p.tractionAssist?(w.contact?w.normalLoadN/totalLoad:0):.25);
    const shareScale=1/Math.max(1,rawShares.reduce((sum,value)=>sum+value,0));
    const shares=rawShares.map(value=>value*shareScale),totalTorque=driveForce*p.wheelRadius;
    const accounting=this._driveAccounting={torqueBudgetNm:Math.abs(pilotDriveForce*p.wheelRadius),requestedTorqueNm:0,postTcsTorqueNm:0,actualTorqueNm:0,
      mechanicalPowerLimitW:p.motorPower,mechanicalPowerW:0,electricalPowerW:0,mechanicalWorkJ:0,electricalWorkJ:0,
      powerLimited:false,airbornePolicy:p.tractionAssist?'unloaded-drive-cut':'equal-four-wheel-shares',shares:[...shares],corneringDriveScale,corneringTractionActive:corneringDriveScale<.98,steeringSurfaceMu:steeringMu,steeringSpeedMps:planarSpeed,
      brakeMechanicalWorkJ:0,liftOffBrakeMechanicalWorkJ:0,electricalRecoveredWorkJ:0};
    for(let i=0;i<4;i++) {
      const w=this.wheelStates[i],c=contactByWheel.get(w),effectiveMass=b.mass/n;
      const driveTorque=totalTorque*shares[i],maxDrivePowerW=p.motorPower*shares[i];
      accounting.requestedTorqueNm+=Math.abs(driveTorque);
      w.serviceBrakeDemandN=serviceDemands[i];w.regenBrakeDemandN=regenDemands[i];w.brakeDemandN=serviceDemands[i]+regenDemands[i];
      w.corneringDriveScale=corneringDriveScale;w.corneringTractionActive=!!c&&corneringDriveScale<.98&&Math.abs(pilotDriveForce*shares[i])>1;
      if(!c){
        // Free wheels retain spin and respond to axle/brake torque. Rotation is
        // never inferred from chassis speed, including immediately after lift.
        const result=integrateWheel(w,{dt,vlong:0,normalLoadN:0,mu:0,lateralForceN:0,
          driveTorqueNm:driveTorque,maxDrivePowerW,brakeTorqueNm:w.brakeDemandN*p.wheelRadius,regenTorqueNm:w.regenBrakeDemandN*p.wheelRadius,
          radius:p.wheelRadius,inertia:p.wheelInertia,effectiveMass,absEnabled:false,tcsEnabled:p.tractionAssist});
        b.torque.vadd(b.quaternion.vmult(V(Math.cos(w.steer),0,-Math.sin(w.steer))).scale(-result.spinMomentumChangeNms/dt),b.torque);
        this._motorWork+=result.driveWorkJ/.9;this._brakeDissipationJ+=result.brakeEnergyJ;
        accounting.brakeMechanicalWorkJ+=result.brakeEnergyJ;accounting.liftOffBrakeMechanicalWorkJ+=result.regenBrakeEnergyJ;
        this._motorForceN+=w.driveTorqueNm/p.wheelRadius;
        accounting.postTcsTorqueNm+=Math.abs(w.postTcsTorqueRequestNm);accounting.actualTorqueNm+=Math.abs(w.driveTorqueNm);accounting.mechanicalWorkJ+=result.driveWorkJ;accounting.powerLimited||=w.drivePowerLimited;
        w.longitudinalForceN=0;w.lateralForceN=0;w.gripUse=0;w.slipRatio=null;continue;
      }
      const mu=this._surfaceMu(w.contactPointWorld),capacity=mu*w.normalLoadN;
      const corner=(i<2?p.cornerStiffnessFront:p.cornerStiffnessRear)*Math.pow(Math.max(1,w.normalLoadN)/5500,.9);
      const relaxation=clamp(p.tireRelaxationLength/(Math.abs(c.vlong)+.8),.008,.25);
      w.relaxedSlip+=(w.slipAngle-(w.relaxedSlip||0))*(1-Math.exp(-dt/relaxation));
      const lateralContact=lateralTireForce({vlong:c.vlong,vlat:c.vlat,normalLoadN:w.normalLoadN,mu,cornerStiffness:corner,relaxedSlip:w.relaxedSlip,effectiveMass,gravityLateral:g.dot(c.right)});
      const lateral=lateralContact.forceN;w.lateralDemandN=lateral;w.rollingContactWeight=lateralContact.rollingWeight;
      // A brake torque distribution is not an ABS. Each wheel below has real
      // rotational inertia, contact reaction torque and a slip regulator that
      // releases/reapplies its requested pressure after measured wheel slip.
      // TCS only releases its already budgeted torque; it never creates a new pool.
      // The pedal first takes over the existing lift-off deceleration, then
      // adds service braking. max(R, S) is continuous and nondecreasing in S;
      // its smooth allocation crossfade never adds R on top of the 42 kN cap.
      // "regen" remains an equivalent motor-retarding channel: all passive
      // wheel work is dissipated in this model; no battery energy is credited.
      const brake=w.brakeDemandN;
      const result=integrateWheel(w,{dt,vlong:c.vlong,normalLoadN:w.normalLoadN,mu,lateralForceN:lateral,
        driveTorqueNm:driveTorque,maxDrivePowerW,brakeTorqueNm:brake*p.wheelRadius,regenTorqueNm:w.regenBrakeDemandN*p.wheelRadius,
        rollingTorqueNm:w.normalLoadN*.011*p.wheelRadius*pedalBlend,
        radius:p.wheelRadius,inertia:p.wheelInertia,effectiveMass,gravityLong:g.dot(c.forward),absEnabled:p.absEnabled,tcsEnabled:p.tractionAssist});
      w.tcsActive||=w.corneringTractionActive;
      const flong=result.longitudinalForceN,flat=result.lateralForceN;
      w.longitudinalForceN=flong;w.lateralForceN=flat;w.gripUse=capacity?Math.hypot(flong,flat)/capacity:0;
      this._motorForceN+=w.driveTorqueNm/p.wheelRadius;
      this._regenForceN+=w.regenBrakeTorqueNm/p.wheelRadius;
      b.applyForce(c.forward.scale(flong).vadd(c.right.scale(flat)),c.relative);
      // Contact forces act on the complete vehicle. Subtract the wheel's
      // changing relative spin momentum from chassis pitch torque; otherwise
      // axle acceleration creates unaccounted angular momentum. Steering-axis
      // gyroscopic cross terms remain outside this reduced four-wheel model.
      b.torque.vadd(b.quaternion.vmult(V(Math.cos(w.steer),0,-Math.sin(w.steer))).scale(-result.spinMomentumChangeNms/dt),b.torque);
      this._motorWork+=result.driveWorkJ/.9;
      accounting.postTcsTorqueNm+=Math.abs(w.postTcsTorqueRequestNm);accounting.actualTorqueNm+=Math.abs(w.driveTorqueNm);accounting.mechanicalWorkJ+=result.driveWorkJ;accounting.powerLimited||=w.drivePowerLimited;
      this._brakeDissipationJ+=result.brakeEnergyJ;this._tireDissipationJ+=result.tireEnergyJ+Math.max(0,-flat*c.vlat)*dt;
      accounting.brakeMechanicalWorkJ+=result.brakeEnergyJ;accounting.liftOffBrakeMechanicalWorkJ+=result.regenBrakeEnergyJ;
    }
    accounting.mechanicalPowerW=accounting.mechanicalWorkJ/dt;accounting.electricalWorkJ=accounting.mechanicalWorkJ/.9;accounting.electricalPowerW=accounting.electricalWorkJ/dt;
  }

  _suction(dt) {
    const p=this.params,b=this.body;
    this._fanLevel+=(Number(this.suctionEnabled&&this._hasPower)-this._fanLevel)*(1-Math.exp(-dt/.14));
    this._suctionForce=0;this._sealQuality=0;this._sealDistanceSum=0;this._sealDistanceCount=0;
    if(this._fanLevel<.001) return;
    const down=b.quaternion.vmult(V(0,-1,0));
    let conductance=0,lipHits=0;
    for(let i=0;i<SEAL_OUTLINE.length;i++){
      const [x,z]=SEAL_OUTLINE[i],from=b.pointToWorldFrame(V(x,SKIRT_BASE_Y,z));
      const hit=this._raySurface(from,from.vadd(down.scale(SKIRT_MAX_EXTENSION+.15)));
      const aligned=hit&&-this._ray.hitNormalWorld.dot(down)>.62;
      const distance=aligned?this._ray.distance:SKIRT_MAX_EXTENSION+.15;
      this._sealLipContacts[i]=aligned?{point:plain(this._ray.hitPointWorld),normal:plain(this._ray.hitNormalWorld),distance}:null;
      const target=this.suctionEnabled&&aligned?clamp(distance-p.sealLipGap,.04,SKIRT_MAX_EXTENSION):SKIRT_RETRACTED_EXTENSION;
      const previous=this._sealLipExtensions[i]||SKIRT_RETRACTED_EXTENSION;
      // A flexible lip compresses immediately; extension has a finite response.
      this._sealLipExtensions[i]=Math.min(target,previous+(target-previous)*(1-Math.exp(-dt/.005)));
      const gap=Math.max(p.sealLipGap,distance-this._sealLipExtensions[i]);
      conductance+=p.sealLeakCd*SEAL_SEGMENT_LENGTHS[i]*gap*Math.sqrt(2/p.airDensity);
      if(aligned)lipHits++;
    }
    const pressure=lipHits?Math.min(p.suctionPressurePa,Math.pow(p.fanPower*p.fanEfficiency/Math.max(1e-9,conductance),2/3)):0;
    for(const pad of this._pads){
      const from=b.pointToWorldFrame(pad);
      if(!this._raySurface(from,from.vadd(down.scale(.85))))continue;
      const alignment=-this._ray.hitNormalWorld.dot(down);if(alignment<.62)continue;
      const seal=clamp((alignment-.62)/.30,0,1)*pressure/p.suctionPressurePa;
      const force=p.suctionPressurePa*p.suctionArea/4*seal*this._fanLevel;
      this._sealDistanceSum+=this._ray.distance;this._sealDistanceCount++;
      this._applyWorldForce(this._ray.hitNormalWorld.scale(-force),pad);
      this._suctionForce+=force;this._sealQuality+=seal/4;
    }
    this._energyUsed+=this._fanLevel*p.fanPower*dt/3.6e6;
  }

  _attitudeTorque(target,frequency=4.2,targetOmega=V(),targetAlpha=V()) {
    const b=controllerBody(this),inv=b.quaternion.conjugate();
    const error=inv.mult(target);if(error.w<0){error.x*=-1;error.y*=-1;error.z*=-1;error.w*=-1;}
    const s=Math.hypot(error.x,error.y,error.z);
    const angle=2*Math.atan2(s,clamp(error.w,-1,1));
    const scale=s>1e-8?angle/s:2;
    const omega=inv.vmult(b.angularVelocity),e=[error.x*scale,error.y*scale,error.z*scale];
    const inertia=[b.inertia.x,b.inertia.y,b.inertia.z];
    // x pitch, y yaw, z roll in this forward-Z frame.
    const frequencies=[frequency,2.6,frequency*1.25];
    const wd=inv.vmult(targetOmega),ad=inv.vmult(targetAlpha),gyro=omega.cross(V(omega.x*inertia[0],omega.y*inertia[1],omega.z*inertia[2]));
    return e.map((v,i)=>clamp(inertia[i]*(frequencies[i]**2*v-2*.94*frequencies[i]*([omega.x,omega.y,omega.z][i]-[wd.x,wd.y,wd.z][i])+[ad.x,ad.y,ad.z][i])+[gyro.x,gyro.y,gyro.z][i],-65000,65000));
  }

  _completeLanding(){
    if(this._maneuver)noteManeuverEnd(this,this._maneuver.abortReason?'aborted-landed':'completed',this._maneuver.abortReason??'wheel-supported-landing',this._maneuver,{finalizeAfterStep:true});
    this._maneuver=null;this.mode='drive';this._heightTarget=this.body.position.y;
    this._positionTarget.copy(this.body.position);this._heightIntegral=0;this._heightJogging=false;this._stableJogging=false;
    this._manualQuaternionTarget=this.body.quaternion.clone();this._manualReferenceRate=V();this._manualCommandInput.setZero();this._manualTranslationActive=false;this._landingContactTime=0;
    this._stableHeight=this.body.position.y;this._stableHeading=this._angles().heading;
    this._stabilizationActive=false;this._verticalControl={commandMps:0,targetMps:0,accelerationLimitMps2:this.params.verticalAccelerationMps2,braking:false,pilotActive:false};this._thrustWanted=0;this.status='着陆完成：轮胎接管，喷口阀门关闭';
    return [0,0,0,0,0,0];
  }

  _pilotVerticalReference(input,holdReference){
    const b=controllerBody(this),p=this.params,acceleration=p.verticalAccelerationMps2,active=Math.abs(input.lift)>.01,command=active?input.lift*p.climbRateMps:0;
    const previousActive=this._verticalControl.pilotActive;
    let braking=this._verticalControl.braking;
    if(active)braking=false;else if(previousActive)braking=true;
    if(braking&&Math.abs(b.velocity.y)<.06){
      braking=false;
      // The post-release hold point is where finite-thrust braking actually
      // ended. Do not accelerate toward an unreachable open-loop stop estimate.
      if(this._stabilizationActive)this._stableHeight=b.position.y;
      this._heightTarget=b.position.y;holdReference=0;
    }
    let reference=active?command:braking?0:holdReference;
    // Q is a descent-speed request, with a physical stopping-distance approach
    // near a surface. It must not drive an 8 m/s reference into a supported tire.
    // Only the command is reduced: gravity, finite braking force and contact
    // still decide whether the vehicle has sufficient room to stop.
    if(active&&reference<0){
      const brakingAcceleration=Math.max(.25,Math.min(acceleration,this._availableLiftForce()/b.mass-p.gravity));
      const surface=this.traceSurface(b.position,{x:0,y:-1,z:0},Math.max(3,reference*reference/(2*brakingAcceleration)+2));
      if(surface){const clearance=Math.max(0,surface.distance-.60),responseAllowance=.4*brakingAcceleration;reference=Math.max(reference,-Math.max(.25,Math.sqrt(2*brakingAcceleration*Math.max(0,clearance-.20)+responseAllowance*responseAllowance)-responseAllowance));}
    }
    if(active&&reference>0)reference=Math.min(reference,Math.sqrt(2*acceleration*Math.max(0,300-b.position.y)));
    this._verticalControl={commandMps:command,targetMps:reference,accelerationLimitMps2:acceleration,braking,pilotActive:active};return reference;
  }

  _manualFlightController(dt,input,{strafe=0}={}){
    const b=controllerBody(this),p=this.params,m=b.mass,rad=Math.PI/180;
    if(this._heightJogging&&Math.abs(input.lift)<.01)this._heightTarget=b.position.y+b.velocity.y*Math.abs(b.velocity.y)/(2*p.verticalAccelerationMps2);
    this._heightJogging=Math.abs(input.lift)>.01;
    if(this._heightJogging)this._heightTarget=clamp(b.position.y,.45,300);
    const current=this._manualReferenceRate,wanted=V(-input.pitch*p.pitchRateDegS*rad,input.steer*p.yawRateDegS*rad,-input.roll*p.rollRateDegS*rad);
    const previous=current.clone(),rateStep=p.angularAccelerationDegS2*rad*dt;
    let target=this._manualQuaternionTarget;
    const released=['x','y','z'].filter(k=>Math.abs(wanted[k])<1e-6&&Math.abs(this._manualCommandInput[k])>1e-6);
    if(released.length){
      // On release, hold the pose actually achieved at that instant. Do not
      // finish a stored open-loop rotation arc after the pilot has let go.
      // Only reference states change; damping torque physically brakes omega.
      target=b.quaternion.clone();for(const k of released)current[k]=0;
    }
    this._manualCommandInput.copy(wanted);
    for(const k of ['x','y','z'])current[k]+=clamp(wanted[k]-current[k],-rateStep,rateStep);
    const omega=target.vmult(V(current.x,0,current.z)).vadd(Y.scale(current.y));
    const maxAlpha=p.angularAccelerationDegS2*rad;
    const alpha=target.vmult(V(clamp((current.x-previous.x)/dt,-maxAlpha,maxAlpha),0,clamp((current.z-previous.z)/dt,-maxAlpha,maxAlpha))).vadd(Y.scale(clamp((current.y-previous.y)/dt,-maxAlpha,maxAlpha)));
    target=rotateWorld(target,omega,dt);
    // Under saturation the reference may lead the real attitude by at most
    // 25 degrees. This anti-windup acts only on the reference quaternion; it
    // never modifies physical pose or angular velocity and permits full turns.
    const error=b.quaternion.conjugate().mult(target),angle=2*Math.atan2(Math.hypot(error.x,error.y,error.z),Math.abs(error.w));
    if(angle>25*rad&&wanted.lengthSquared()>1e-8)target=b.quaternion.slerp(target,25*rad/angle);
    this._manualQuaternionTarget=target;
    this._headingTarget=this._angles(b).heading;
    const heading=this._headingTarget,forward=V(Math.sin(heading),0,Math.cos(heading));
    let ax,az;
    if(Math.abs(input.throttle)>.02||input.boost||Math.abs(strafe)>.02){
      const velocity=forward.scale(input.boost?15:input.throttle*10);
      if(Math.abs(strafe)>.02)velocity.vadd(V(Math.cos(heading),0,-Math.sin(heading)).scale(strafe*7),velocity);
      ax=(velocity.x-b.velocity.x)*p.velocityGain;az=(velocity.z-b.velocity.z)*p.velocityGain;
      this._positionTarget.x=b.position.x;this._positionTarget.z=b.position.z;this._manualTranslationActive=true;
    }else{
      // Release means brake at the achieved trajectory, not return to the
      // last key-down sample. Capture a hold point only after actual braking.
      if(this._manualTranslationActive){
        this._positionTarget.x=b.position.x;this._positionTarget.z=b.position.z;
        if(Math.hypot(b.velocity.x,b.velocity.z)<.08)this._manualTranslationActive=false;
      }
      ax=(this._positionTarget.x-b.position.x)*p.positionGain-b.velocity.x*p.velocityGain;
      az=(this._positionTarget.z-b.position.z)*p.positionGain-b.velocity.z*p.velocityGain;
    }
    const heightError=this._heightTarget-b.position.y,up=b.quaternion.vmult(Y).y;
    if(this._hasPower&&!this._pressureLimited&&up>.7&&Math.abs(heightError)<.5&&Math.abs(b.velocity.y)<.2&&this._allocationError<.05)this._heightIntegral=clamp(this._heightIntegral+heightError*dt,-1.5,1.5);
    const verticalReference=this._pilotVerticalReference(input,clamp(heightError*1.8,-p.climbRateMps,p.climbRateMps));
    // Ordinary E/Q and release braking share the selected acceleration. A fast fall after an
    // unsupported attitude needs the available braking thrust, rather than
    // spending tens of metres at that comfort cap. This changes only the
    // requested acceleration: pressure, valve lag, torque allocation and the
    // one-way lift geometry still decide the force actually delivered.
    const fallExcess=Math.max(0,-b.velocity.y-p.climbRateMps-.75);
    const capacity=this._availableLiftForce()/m-p.gravity;
    const arrestLimit=Math.max(p.verticalAccelerationMps2,Math.min(p.gravity*1.4,capacity*.85));
    const verticalLimit=clamp(p.verticalAccelerationMps2+2.5*fallExcess,p.verticalAccelerationMps2,arrestLimit);
    this._verticalControl.accelerationLimitMps2=verticalLimit;
    const ay=clamp((verticalReference-b.velocity.y)*3.5+this._heightIntegral*.7,-p.verticalAccelerationMps2,verticalLimit);
    const worldForce=V(clamp(ax,-6,6),p.gravity+ay,clamp(az,-6,6)).scale(m);
    const force=b.quaternion.conjugate().vmult(worldForce);
    const torque=this._attitudeTorque(target,p.attitudeResponse,omega,alpha);
    this._thrustWanted=Math.max(0,force.y);
    // The bounded allocator is deliberately asked for the complete force.
    // If inverted, negative local lift is impossible and remains a residual;
    // gravity therefore causes real descent instead of an invented up-force.
    return [force.x,force.y,force.z,...torque];
  }

  _controller(dt,input) {
    const b=controllerBody(this),p=this.params,m=b.mass,angles=this._angles(b);
    if(this.mode==='hover'&&this.stabilizationMode!=='hold'&&!this._maneuver){
      const hullContact=this.world.contacts.some(c=>{const shape=c.bi===this.body?c.si:c.bj===this.body?c.sj:null;return shape&&shape.material!==this._wheelStopMaterial;});
      if(hullContact){
        // Collision is not permission to start a new controller. When H/E
        // assistance was already requested, invalidate its old free-space
        // capture instead of pulling the pilot back through the collision.
        this._positionTarget.copy(b.position);this._heightTarget=b.position.y;this._stableHeight=b.position.y;this._heightIntegral=0;
        this._manualTranslationActive=Math.hypot(b.velocity.x,b.velocity.z)>.08;
        if(Math.abs(input.pitch)<.01&&Math.abs(input.roll)<.01){this._manualQuaternionTarget=b.quaternion.clone();this._manualReferenceRate.setZero();this._manualCommandInput.setZero();}
      }
    }
    this._verticalControl={...this._verticalControl,commandMps:0,targetMps:0,accelerationLimitMps2:this.params.verticalAccelerationMps2};
    this._levelRecovery.active=false;this._levelRecovery.status=this.stabilizationMode==='level'?(this._contactCount>0?'surface':'armed'):'inactive';
    if(this.mode==='drive'&&(input.lift>0||this._contactCount===0&&(Math.abs(input.pitch)>.01||Math.abs(input.roll)>.01))){this.setMode('hover');this._heightTarget=Math.max(.65,b.position.y);}
    let desired=[0,0,0,0,0,0];
    const groundSupport=this._contactCount>=2&&b.quaternion.vmult(Y).y>.65&&this.wheelStates.filter(w=>w.contact&&w.contactNormalWorld?.y>.65).length>=2;
    if(input.lift<-.05&&groundSupport){
      this._landingContactTime+=dt;
      if(this._landingContactTime>=.075&&Math.abs(b.velocity.y)<1.2)return this._completeLanding();
      // A continuing descent request on supported wheels means closing the
      // valves, including during the short contact-confirmation interval.
      this._thrustWanted=0;return desired;
    }
    if(!(this._maneuver?.name==='land'||this._maneuver?.phase==='land'))this._landingContactTime=0;
    // Armed on the ground, active only in free air. This never fights wheel
    // contacts or pressure adhesion. Raw research valve overrides still take
    // precedence in _advance; the stabilizer resumes after their release.
    const adhered=this.suctionEnabled&&this._sealQuality>.05;
    // Merely arming F in free air is not a surface constraint. Previously this
    // disabled G even with zero seal/adhesion, leaving the tilted manual target
    // active. A real seal or tire contact still yields control to the surface.
    // G keeps its established Z/B translation semantics. A deliberate 1/2
    // request temporarily owns pitch through the existing bounded rate path;
    // release returns to G. It must not disappear at the first airborne tick.
    const pilotPitch=this.stabilizationMode==='level'&&this.mode==='hover'&&!adhered&&!this._maneuver&&Math.abs(input.pitch)>.01;
    const stabilize=this.airStabilization&&this._contactCount===0&&!adhered&&!this._maneuver&&!pilotPitch;
    this._levelRecovery.active=this.stabilizationMode==='level'&&stabilize;
    this._levelRecovery.status=this.stabilizationMode!=='level'?'inactive':adhered||this._contactCount>0?'surface':stabilize?'recovering':'armed';
    if(this.stabilizationMode==='level'&&!this._maneuver&&(adhered||this._contactCount>0&&input.lift<=.01&&(this._stabilizationActive||this._heightTarget<=b.position.y+.15))){
      // G yields to actual tyre/adhesion support. Do not fall through to the
      // H controller and resurrect its pre-G attitude/position at touchdown.
      this._stabilizationActive=false;this._holdActive=false;this._thrustWanted=0;
      this._positionTarget.copy(b.position);this._heightTarget=b.position.y;this._stableHeight=b.position.y;this._heightIntegral=0;
      this._manualQuaternionTarget=b.quaternion.clone();this._manualTranslationActive=false;return desired;
    }
    this._holdActive=false;
    if(this.stabilizationMode==='hold'){
      const hullContact=this.world.contacts.some(c=>{const shape=c.bi===this.body?c.si:c.bj===this.body?c.sj:null;return shape&&shape.material!==this._wheelStopMaterial;});
      if(this._poseTargetExplicit&&groundSupport&&this._holdPositionTarget.y>b.position.y+.15&&!this.suctionEnabled)this._poseTakeoffActive=true;
      if(hullContact||this.suctionEnabled||b.position.y>this._poseTakeoffOriginHeight+1.8)this._poseTakeoffActive=false;
      const takeoff=this._poseTakeoffActive&&this._holdPositionTarget.y>b.position.y+.15&&!this.suctionEnabled;
      const surfaceContact=this._contactCount>0&&!takeoff||hullContact;
      this._holdActive=(stabilize||takeoff)&&!surfaceContact;this._stabilizationActive=this._holdActive;
      if(!this._holdActive){this._holdStatus='surface';return desired;}
      // Full 6-DOF feedback: force is expressed in body axes before allocation,
      // so gravity can be supported at a tilted attitude without levelling it.
      // These are bounded acceleration requests, not velocity/pose constraints.
      const error=this._holdPositionTarget.vsub(b.position);
      const accel=V(clamp(error.x*p.positionGain-b.velocity.x*p.velocityGain,-6,6),
        clamp(error.y*p.altitudeGain-b.velocity.y*p.verticalDamping,-p.gravity*.8,p.gravity*1.4),
        clamp(error.z*p.positionGain-b.velocity.z*p.velocityGain,-6,6));
      accel.y=this._researchHeightAcceleration(accel.y,dt);
      const force=b.quaternion.conjugate().vmult(accel.vadd(V(0,p.gravity,0)).scale(m));
      // Establish wheel clearance before tilting toward an explicit lab pose;
      // the one-wheel interval must not chatter the takeoff controller on/off.
      const poseBlend=this._poseTakeoffActive?clamp((b.position.y-this._poseTakeoffOriginHeight-.6)/1.2,0,1):1;
      const attitude=this._poseTakeoffActive?this._poseTakeoffQuaternion.slerp(this._holdQuaternionTarget,poseBlend):this._holdQuaternionTarget;
      const torque=this._attitudeTorque(attitude,p.attitudeResponse);
      this._heightTarget=this._holdPositionTarget.y;this._thrustWanted=force.y;
      return[force.x,force.y,force.z,...torque];
    }
    if(pilotPitch){
      if(this._stabilizationActive||Math.abs(this._manualCommandInput.x)<1e-9){
        // Capture controller references only. Pose, rates and actuator limits
        // remain physical; no accumulated level reference fights pilot pitch.
        this._manualQuaternionTarget=b.quaternion.clone();this._manualReferenceRate.setZero();this._manualCommandInput.setZero();
        this._positionTarget.copy(b.position);this._headingTarget=angles.heading;this._heightTarget=b.position.y;this._heightIntegral=0;
      }
      this._stabilizationActive=false;this._levelRecovery.status='pilot-pitch';
      return this._manualFlightController(dt,{...input,roll:0},{strafe:input.roll});
    }
    if(stabilize){
      if(!this._stabilizationActive){
        this._stableHeight=this.mode==='hover'?this._heightTarget:b.position.y;
        if(this.stabilizationMode==='level'&&Math.abs(this._manualCommandInput.x)>1e-9){
          this._stableHeading=angles.heading;this._manualReferenceRate.setZero();this._manualCommandInput.setZero();
          this._manualQuaternionTarget=this._levelQuaternion();
        }
      }
      this._stabilizationActive=true;
      // G is heading/level/height plus velocity damping, not a hidden X/Z
      // position hold. Keep the inactive H reference local through all motion.
      this._positionTarget.copy(b.position);this._heightIntegral=0;
      this._stableHeading+=input.steer*.80*dt;
      if(this._stableJogging&&Math.abs(input.lift)<.01)this._stableHeight=b.position.y+b.velocity.y*Math.abs(b.velocity.y)/(2*p.verticalAccelerationMps2);
      this._stableJogging=Math.abs(input.lift)>.01;
      if(this._stableJogging)this._stableHeight=clamp(b.position.y,.65,300);
      const verticalReference=this._pilotVerticalReference(input,(this._stableHeight-b.position.y)*3.2/3.3);
      const pilotEnvelope=this._stableJogging||this._verticalControl.braking;
      const up=b.quaternion.vmult(Y),vertical=clamp((verticalReference-b.velocity.y)*3.3,pilotEnvelope?-p.verticalAccelerationMps2:-p.gravity*.8,pilotEnvelope?p.verticalAccelerationMps2:p.gravity*1.4);
      this._verticalControl.accelerationLimitMps2=pilotEnvelope?p.verticalAccelerationMps2:p.gravity*1.4;
      // Near inversion use torque to recover first, rather than commanding
      // maximum lift down into the ground. All forces still pass allocation.
      const lift=up.y>.35?m*(p.gravity+vertical)/up.y:m*p.gravity*clamp(up.y,0,.35);
      const target=this._levelQuaternion();
      const torque=this._attitudeTorque(target,3.3,V(0,input.steer*.80,0));
      const local=b.quaternion.conjugate().vmult(b.velocity);
      const fx=clamp(m*(input.roll*7-local.x)*1.35,-8500,8500),fz=clamp(m*(input.throttle*10-local.z)*1.35,-10000,10000);
      this._thrustWanted=lift;this._heightTarget=this._stableHeight;
      return[fx,clamp(lift,0,4*p.liftNozzleMax),input.boost?p.axialNozzleMax:fz,...torque];
    }
    this._stabilizationActive=false;
    if(this.mode==='drive') {
      if(input.boost) desired[2]=p.axialNozzleMax;
      return desired;
    }
    if(this.mode==='manual') {
      desired[1]=Math.max(0,input.lift)*4*p.liftNozzleMax;
      desired[2]=input.boost?p.axialNozzleMax:input.throttle*p.axialNozzleMax;
      desired[3]=-input.pitch*12000;desired[4]=input.steer*11000;desired[5]=-input.roll*28000;
      return desired;
    }
    if(!this._maneuver)return this._manualFlightController(dt,input);
    if(this._heightJogging&&Math.abs(input.lift)<.01&&!this._maneuver)this._heightTarget=b.position.y+b.velocity.y*Math.abs(b.velocity.y)/6;
    this._heightJogging=Math.abs(input.lift)>.01;this._heightTarget=clamp(this._heightTarget+input.lift*p.climbRateMps*dt,.52,48);
    this._headingTarget+=input.steer*.85*dt;
    let rollRef=0,pitchRef=0,rollRate=0,rollAccel=0,pitchRate=0,pitchAccel=0,landingTarget=null;
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
    const heightError=this._heightTarget-b.position.y,upBefore=b.quaternion.vmult(Y).y;
    // Integrate only in the controllable, unsaturated region. Deliberate roll
    // phases and low tank pressure cannot wind up an unreachable height demand.
    if(!this._maneuver&&this._hasPower&&!this._pressureLimited&&upBefore>.7&&Math.abs(heightError)<.5&&Math.abs(b.velocity.y)<.2&&this._allocationError<.05)this._heightIntegral=clamp(this._heightIntegral+heightError*dt,-1.5,1.5);
    const verticalReference=clamp(heightError*1.8,-p.climbRateMps,p.climbRateMps);
    let liftAccel=clamp((verticalReference-b.velocity.y)*3.5+this._heightIntegral*.7,-3,3);
    let rollRunning=false;
    if(this._maneuver) {
      const a=this._maneuver;a.time+=dt;
      if(a.name==='pitch'&&!a.abortReason&&(!this._hasPower||this._availableLiftForce()<m*p.gravity*1.15)){
        a.abortReason='动作中可用升力 / 供电下降；完整动作已撤销，按剩余真实执行器尝试回稳';
        // The requested U includes this bounded recovery. Never claim a safe
        // landing after an unrecoverable in-flight loss of pressure or power.
        if(a.phase==='climb'){a.phase=a.originGrounded?'land':'recover';a.time=0;this._heightIntegral=0;}
      }
      // A driving pitch flip returns level to its moving road contact. A
      // ten-metre-per-second hover target otherwise pitches against held W
      // while the tyres accelerate, preventing three-wheel landing handoff.
      if(a.name==='pitch'){pitchRef=0;rollRef=0;}
      if(a.name==='land'||a.phase==='land') {
        const surface=this.traceSurface(b.position,{x:0,y:-1,z:0},220),surfaceY=surface?b.position.y-surface.distance:0;
        const supportNormal=surface?.normal&&surface.normal.y>.7?V(surface.normal.x,surface.normal.y,surface.normal.z):Y.clone();
        const supportHeight=.60/supportNormal.y,clearance=Math.max(0,b.position.y-surfaceY-supportHeight),descent=-Math.max(.30,Math.min(7,Math.sqrt(2*1.5*Math.max(0,clearance-.40))));
        // Follow the sampled support plane under horizontal travel. A fixed
        // world-Y descent can chase a downhill surface forever without landing.
        const surfaceVerticalMps=-(supportNormal.x*b.velocity.x+supportNormal.z*b.velocity.z)/supportNormal.y;
        this._heightTarget=surfaceY+supportHeight;liftAccel=clamp((surfaceVerticalMps+descent-b.velocity.y)*8,-p.gravity*.95,p.gravity*2);
        // Surface alignment replaces the old horizontal-return bank while
        // landing. A held W or the old X origin must never pitch against the
        // tyres and create a rear-wheel + main-jet equilibrium.
        pitchRef=0;rollRef=0;this._positionTarget.copy(b.position);this._heightIntegral=0;
        const normal=supportNormal;
        const slope=new CANNON.Quaternion();slope.setFromVectors(Y,normal);
        const yaw=new CANNON.Quaternion();yaw.setFromEuler(0,heading,0,'YXZ');landingTarget=slope.mult(yaw);
        const supported=this.wheelStates.filter(w=>w.contact&&w.contactNormalWorld?.y>.65);
        const allSupported=supported.length===4&&supported.every(w=>w.normalLoadN>m*p.gravity*.01);
        const alignment=b.quaternion.vmult(Y).dot(normal);
        this.status=allSupported?'着陆载荷交接：确认四轮连续支撑，再关闭动作':'自动着陆：沿当前支撑面回平，不返回旧水平位置';
        if(allSupported&&alignment>Math.cos(4*Math.PI/180)&&Math.abs(b.velocity.dot(normal))<.65&&b.angularVelocity.length()<.35){
          this._landingContactTime+=dt;this._thrustWanted=0;
          // Close commands during the dwell. Valve lag, gravity, suspension
          // and contact alone establish the settled load; no body pose write.
          if(this._landingContactTime>=.20&&Math.abs(b.velocity.dot(normal))<.25)return this._completeLanding();
          return desired;
        }
        this._landingContactTime=0;
        if(supported.length>=2&&alignment>.8)liftAccel=-p.gravity;
      } else if(a.name==='roll'||a.name==='pitch') {
        const maneuverLabel=a.name==='pitch'?'受控后翻':'滚转';
        if(a.phase==='climb') {
          this.status=a.name==='pitch'?'受控后翻：建立车长旋转净空与起跳速度':a.profile?.kind==='quick-roll-1'?'快翻：建立短起跳与轮廓净空':'滚转：建立完整弹道旋转与制动余量';
          const hit=this.traceSurface(b.position,{x:0,y:-1,z:0},220),height=hit?.distance??b.position.y;
          if(height>=(a.minimumRotationClearanceM??1.55)&&b.velocity.y>=a.launchVelocity-.25){a.phase='rotate';a.time=0;}
          else if(a.time>Math.max(1,a.launchTime*2+.4)){a.abortReason='起跳速度 / 轮廓净空未在预定窗口建立';a.phase=a.originGrounded?'land':'recover';a.time=0;this._heightTarget=a.returnHeight;this.status=maneuverLabel+'中止：'+a.abortReason+'，尝试物理回稳';}
          const launchTarget=new CANNON.Quaternion();launchTarget.setFromEuler(0,heading,0,'YXZ');
          this._manualQuaternionTarget=launchTarget;
          // X uses its declared short-takeoff envelope within real available thrust.
          // A migrated historical mid-maneuver retains its stored comfort cap;
          // it is explicit current-model recomputation, never old-solver replay.
          const launchLimit=a.launchAccelerationMps2??Infinity;
          const thrust=Math.min(4*p.liftNozzleMax,m*(p.gravity+clamp((a.launchVelocity-b.velocity.y)*8,0,launchLimit)));
          return[0,thrust,0,...this._attitudeTorque(launchTarget,p.attitudeResponse)];
        } else if(a.phase==='rotate') {
          rollRunning=true;
          const duration=a.duration,t=clamp(a.time/duration,0,1);
          if(a.profile){
            const sample=sampleRollManeuver(a.profile,a.time);
            if(a.name==='pitch'){pitchRef=-sample.angleRad;pitchRate=-sample.rateRadS;pitchAccel=-sample.accelerationRadS2;rollRef=0;
              a.actualPitchRad=(a.actualPitchRad||0)-b.quaternion.conjugate().vmult(b.angularVelocity).x*dt;
            }else{rollRef=sample.angleRad;rollRate=sample.rateRadS;rollAccel=sample.accelerationRadS2;
              a.actualRollRad=(a.actualRollRad||0)+b.quaternion.conjugate().vmult(b.angularVelocity).z*dt;}
          }else{
            // Retain the frozen reference of a migrated 3.9 / 3.10 mid-roll.
            // New maneuvers never enter this historical quintic branch.
            rollRef=2*Math.PI*t*t*t*(10-15*t+6*t*t);
            if(t<1){rollRate=2*Math.PI*30*t*t*(1-t)*(1-t)/duration;rollAccel=2*Math.PI*60*t*(1-t)*(1-2*t)/(duration*duration);}
          }
          if(a.name!=='pitch')pitchRef=0;
          liftAccel=0;
          this.status=a.name==='pitch'?'受控后翻：喷口俯仰力矩闭环；倒置段真实弹道':'滚转：喷口力矩闭环';
          const actualTravel=a.name==='pitch'?a.actualPitchRad:a.actualRollRad;
          const rotationReached=a.time>=duration&&Math.abs(angles.roll)<.35&&Math.abs(angles.pitch)<.35&&upBefore>.8&&(!a.profile||actualTravel>=2*Math.PI-.12);
          if(rotationReached||a.time>duration+.5) {
            if(!rotationReached)a.abortReason=Number.isFinite(actualTravel)?`旋转窗口结束：实际累计 ${(actualTravel*180/Math.PI).toFixed(1)}°，未满足完整一周 / 回正判据`:'旋转窗口结束：未满足回正判据';
            a.phase=a.originGrounded?'land':'recover';a.time=0;if(a.originGrounded)this._positionTarget.copy(b.position);else this._positionTarget.set(a.origin.x,a.origin.y,a.origin.z);this._heightTarget=a.returnHeight;this._heightIntegral=0;
          }
        } else {
          this.status=a.abortReason?maneuverLabel+'中止：'+a.abortReason+'，尝试物理回稳':maneuverLabel+'：制动并返回起始空中高度';
          this._heightTarget=a.returnHeight;
          const vertical=clamp((a.returnHeight-b.position.y)*1.6,-4,3);
          const available=this._availableLiftForce()/m-p.gravity;
          liftAccel=clamp((vertical-b.velocity.y)*4.5,-p.gravity*.85,Math.max(0,available*.88));
          if(a.time>.5 && Math.abs(angles.roll)<.025&&Math.abs(angles.pitch)<.025&&b.angularVelocity.length()<.2&&Math.abs(b.velocity.y)<.2&&Math.abs(b.position.y-a.returnHeight)<.10) {
            // The position loop computed a bank earlier in this step. Clear it
            // before the shared output below, so it cannot overwrite the
            // horizontal handoff reference on the completion frame.
            rollRef=0;pitchRef=0;rollRate=0;rollAccel=0;
            noteManeuverEnd(this,a.abortReason?'aborted-recovered':'completed',a.abortReason??'returned-to-start-height',a,{finalizeAfterStep:true});
            this._maneuver=null;this._manualQuaternionTarget=new CANNON.Quaternion();this._manualQuaternionTarget.setFromEuler(0,heading,0,'YXZ');this._manualReferenceRate=V();this.status=a.abortReason?maneuverLabel+'未完成：'+a.abortReason+'；已返回起始空中高度':maneuverLabel+'结束：已返回起始空中高度';
          }
        }
      }
    }
    const target=landingTarget??new CANNON.Quaternion();if(!landingTarget)target.setFromEuler(pitchRef,heading,rollRef,'YXZ');
    this._manualQuaternionTarget=target;
    const axis=target.vmult(Z),pitchAxis=target.vmult(X),torque=this._attitudeTorque(target,p.attitudeResponse,axis.scale(rollRate).vadd(pitchAxis.scale(pitchRate)).vadd(V(0,input.steer*.85,0)),axis.scale(rollAccel).vadd(pitchAxis.scale(pitchAccel)));
    const up=b.quaternion.vmult(Y),upDot=up.y;
    // With only upward main jets the vehicle cannot support gravity when
    // inverted in free air. A roll contains an actual ballistic interval.
    const thrust=rollRunning?0:m*(p.gravity+liftAccel)/Math.max(.28,upDot);
    desired=[0,clamp(thrust,0,4*p.liftNozzleMax),input.boost?p.axialNozzleMax:0,...torque];
    this._thrustWanted=desired[1];
    return desired;
  }

  _thrusters(dt,desired,input={}) {
    const p=this.params,b=this.body;
    const pressure=this.pressureBar();
    const derate=clamp((pressure-1)/(p.regulatorBar-1),0,1);
    const maxes=this._nozzles.map(n=>(n.kind==='lift'?p.liftNozzleMax:n.kind==='roll'?p.sideNozzleMax:p.axialNozzleMax)*derate*Number(this._hasPower)*(this._nozzleFault?.id===n.id?this._nozzleFault.scale:1));
    // Weighted projected coordinate descent for a bounded, non-negative thrust
    // allocation. Every resulting body moment equals r × F at a real nozzle.
    const weights=[.8,1.5,.8,1.5,1.2,1.7],scales=[24000,80000,22000,70000,32000,30000];
    const columns=this._nozzles.map((n,i)=>n.column.map((c,k)=>c*maxes[i]/scales[k]));
    const direct=input.frontJets>0||input.rearJets>0,objective=[...desired];
    // Ordinary pilot rate control keeps the complete requested wrench below,
    // but negative body-Y force is outside this one-way lift geometry. Asking
    // the allocator to chase that unreachable force also suppressed necessary
    // attitude torque. Project only that force objective to its feasible lower
    // bound; zero remains the minimum-lift preference. The same weighted
    // allocator, nozzle bounds, valve dynamics and requested angles still apply.
    const pilotRate=!direct&&this.mode==='hover'&&!this._maneuver&&this.stabilizationMode!=='hold'&&!this._stabilizationActive;
    if(pilotRate&&desired[1]<0)objective[1]=0;
    if(this._integration)this._integration.allocation={policy:'pilot-rate-unilateral-lift-objective-1',active:pilotRate&&desired[1]<0,reason:pilotRate&&desired[1]<0?'negative-body-lift-unavailable-preserve-attitude-torque':null,requestedWrench:[...desired],objectiveWrench:[...objective]};
    const forces=this._nozzles.map(()=>0),residual=objective.map((d,k)=>d/scales[k]);
    // Start at zero: retaining the previous unconstrained null-space component
    // made opposing side jets keep wasting gas after a maneuver had ended.
    if(direct){this._stabilizationActive=false;this._holdActive=false;this._levelRecovery.active=false;this._levelRecovery.status=this.stabilizationMode==='level'?'armed':'inactive';this._verticalControl={commandMps:0,targetMps:0,accelerationLimitMps2:this.params.verticalAccelerationMps2,braking:false,pilotActive:false};}
    for(let pass=0;pass<(direct?0:28);pass++) {
      for(let i=0;i<this._nozzles.length;i++) {
        const col=columns[i];
        let numer=-1e-5*maxes[i]/22000,denom=1e-9;
        for(let k=0;k<6;k++){numer+=col[k]*residual[k]*weights[k]**2;denom+=col[k]**2*weights[k]**2;}
        const next=clamp(forces[i]+numer/denom,0,1),change=next-forces[i];
        forces[i]=next;for(let k=0;k<6;k++)residual[k]-=col[k]*change;
      }
    }
    const commands=forces.map((force,i)=>force*maxes[i]);
    if(direct){
      // Pilot-selected valves bypass attitude allocation. A front-only firing
      // must produce its real pitch moment, without compensating rear thrust.
      for(let i=0;i<4;i++)commands[i]=maxes[i]*(i<2?input.frontJets:input.rearJets);
      desired=Array(6).fill(0);
      this._nozzles.forEach((n,i)=>n.column.forEach((c,k)=>desired[k]+=c*commands[i]));
    }
    // These exact opposite column pairs have the same application line.
    // Removing their common part preserves the requested wrench identically.
    for(const [a,c]of [[4,5],[6,7],[8,9]]){const cancel=Math.min(commands[a],commands[c]);commands[a]-=cancel;commands[c]-=cancel;}
    this._nozzles.forEach((n,i)=>{
      n.maxForce=maxes[i];n.command=commands[i];
      const tau=n.command>n.force?p.valveRiseTime:p.valveFallTime;
      n.force=clamp(n.force+(n.command-n.force)*(1-Math.exp(-dt/tau)),0,maxes[i]);
    });
    const sum=this._nozzles.reduce((a,n)=>a+n.force,0);
    const ve=nozzleExhaustVelocity(p,pressure,this.gasTemperature);this._effectiveExhaustVelocity=ve;
    const requiredMass=sum/ve*dt;
    const availableScale=p.supplyMode==='bench'?1:Math.min(1,this.gasMass/Math.max(1e-10,requiredMass));
    this._thrustN=0;
    this._desiredWrench=[...desired];this._achievedWrench=Array(6).fill(0);
    this._nozzles.forEach((n,i)=>{
      n.force*=availableScale;
      b.applyLocalForce(n.direction.scale(n.force),n.position);
      this._thrustN+=n.force;
      n.column.forEach((c,k)=>this._achievedWrench[k]+=c*n.force);
    });
    this._massFlowKgS=this._thrustN/ve;this._impulseNs+=this._thrustN*dt;
    if(p.supplyMode==='bench')this._externalGasKg+=this._massFlowKgS*dt;else this._gasConsumedKg+=this._massFlowKgS*dt;
    if(p.supplyMode!=='bench'){
      const previous=this.gasMass;this.gasMass=Math.max(0,previous-requiredMass*availableScale);
      if(p.gasModel==='adiabatic'&&previous>1e-10)this.gasTemperature*=Math.pow(this.gasMass/previous,p.gasGamma-1);
      else this.gasTemperature=p.gasTemperatureK;
      this.gasTemperature+=(p.gasTemperatureK-this.gasTemperature)*(1-Math.exp(-dt/p.tankThermalTime));
    }
    this._allocationError=Math.hypot(...desired.map((d,k)=>(d-this._achievedWrench[k])/scales[k]));
    this._pressureLimited=derate<.99 || ((this.mode==='hover'||this._holdActive)&&this._thrustWanted>maxes.slice(0,4).reduce((a,c)=>a+c,0)*.95);
    if(this.stabilizationMode==='hold'){
      this._holdFeasible=this._holdTrimFeasible(maxes);
      if(this._holdActive){
        const error=this._holdErrors();
        this._holdStatus=!this._holdFeasible||this._allocationError>.08?'limited':
          error.position<.08&&error.attitude<.35&&b.velocity.length()<.08&&b.angularVelocity.length()<.02?'holding':'tracking';
      }
    }
    this._manualPoseFeasible=this.mode==='hover'&&this.stabilizationMode==='off'&&!this._maneuver?this._holdTrimFeasible(maxes,this._manualQuaternionTarget):null;
    const recovery=this._levelRecovery;
    recovery.tiltErrorDeg=Math.acos(clamp(b.quaternion.vmult(Y).y,-1,1))*180/Math.PI;recovery.headingTargetRad=this._stableHeading;
    recovery.verticalSupportFeasible=this._holdTrimFeasible(maxes,b.quaternion);
    recovery.torqueSaturated=this._nozzles.some(n=>n.maxForce>0&&n.command>=n.maxForce*.985)&&desired.slice(3).some(v=>Math.abs(v)>100);
    if(recovery.active){
      const targetFeasible=this._holdTrimFeasible(maxes,this._levelQuaternion());
      recovery.status=!targetFeasible?'limited':recovery.tiltErrorDeg<.8&&b.angularVelocity.length()<.05?'level':
        recovery.torqueSaturated||!recovery.verticalSupportFeasible?'limited':'recovering';
    }
    this._updateMass();
  }

  _assessHoldTrim(maxes,target=this._holdQuaternionTarget,{includeReserve=false}={}) {
    if(!target)return null;
    const f=target.conjugate().vmult(V(0,this.body.mass*this.params.gravity,0));
    return solveStaticWrench(this._nozzles,maxes,[f.x,f.y,f.z,0,0,0],{includeReserve});
  }

  _holdTrimFeasible(maxes,target=this._holdQuaternionTarget) {
    if(!target)return null;
    const f=target.conjugate().vmult(V(0,this.body.mass*this.params.gravity,0));
    return staticWrenchFeasible(this._nozzles,maxes,[f.x,f.y,f.z,0,0,0]);
  }

  getHoldTrimAssessment({target='current',includeReserve=true}={}) {
    const p=this.params,derate=clamp((this.pressureBar()-p.ambientPressureBar)/(p.regulatorBar-p.ambientPressureBar),0,1)*Number(this._hasPower);
    const maxes=this._nozzles.map(n=>(n.kind==='lift'?p.liftNozzleMax:n.kind==='roll'?p.sideNozzleMax:p.axialNozzleMax)*derate*(this._nozzleFault?.id===n.id?this._nozzleFault.scale:1));
    const q=target==='current'?this.body.quaternion:target==='level'?this._levelQuaternion():target==='hold'?this._holdQuaternionTarget:target;
    return this._assessHoldTrim(maxes,q,{includeReserve});
  }

  _holdErrors() {
    if(!this._holdPositionTarget||!this._holdQuaternionTarget)return{position:null,attitude:null};
    const q=this.body.quaternion.conjugate().mult(this._holdQuaternionTarget);
    return{position:this._holdPositionTarget.vsub(this.body.position).length(),
      attitude:2*Math.atan2(Math.hypot(q.x,q.y,q.z),Math.abs(q.w))*180/Math.PI};
  }

  _aero(dt) {
    const b=this.body,p=this.params,relativeVelocity=b.velocity.vsub(this._windVelocity()),localV=b.quaternion.conjugate().vmult(relativeVelocity);
    const speed=localV.length(),factor=-.5*p.airDensity*speed;
    b.applyLocalForce(V(factor*1.4*localV.x,factor*2.5*localV.y,factor*p.dragArea*localV.z),V());
    // One physical actuator drives the mesh and aerodynamic coefficients. The
    // area/coefficient map and rear application point are explicit engineering
    // assumptions; Tesla has not published a usable actuator/aero calibration.
    const wing=this._wing,braking=this._lastInput.brake>.05;
    wing.command=p.wingMode==='fixed'?p.wingDeployment:clamp((Math.abs(localV.z)-16)/34*.45+(braking?this._lastInput.brake*.8:0),0,1);
    wing.deployment+=clamp(wing.command-wing.deployment,-p.wingActuatorRate*dt,p.wingActuatorRate*dt);
    Object.assign(wing,rearWingPose(wing.deployment));
    wing.dynamicPressurePa=.5*p.airDensity*localV.z*localV.z;
    wing.dragN=wing.dynamicPressurePa*p.wingAreaM2*p.wingDragCoefficient*wing.deployment;
    wing.downforceN=wing.dynamicPressurePa*p.wingAreaM2*p.wingDownforceCoefficient*wing.deployment;
    const wingForce=V(0,-wing.downforceN,-Math.sign(localV.z)*wing.dragN);wing.forceBody=plain(wingForce);
    b.applyLocalForce(wingForce,V(wing.applicationPoint.x,wing.applicationPoint.y,wing.applicationPoint.z));
    // Aerodynamic angular damping is implemented as forces at four corners.
    for(const r of [V(-.9,0,1.7),V(.9,0,1.7),V(-.9,0,-1.7),V(.9,0,-1.7)]) {
      const rw=b.quaternion.vmult(r),vr=b.angularVelocity.cross(rw);
      b.applyForce(vr.scale(-8*vr.length()),rw);
    }
    this._energyUsed+=800*dt/3.6e6;
  }

  _advance(dt,raw) {
    const schedule=contactStepSchedule(this,dt);
    const startOnboard=this._gasConsumedKg,startExternal=this._externalGasKg,startImpulse=this._impulseNs;
    this._integration={controlStep:this._stepCount+1,controlDtS:dt,substeps:schedule.count,completedSubsteps:0,substepDtS:dt/schedule.count,contactMicrosteps:0,wheelContactMicrosteps:0,rigidContactMicrosteps:0,maxWheelContacts:0,maxRigidContacts:0,reason:schedule.reason,objectId:schedule.objectId??null,observationPolicy:this._observationConfig.enabled?'one-noisy-delayed-sample-per-control-step':'ideal-state-at-each-integration-slice'};
    for(let substep=0;substep<schedule.count;substep++){this._advanceContactSlice(dt/schedule.count,raw,substep===0);if(this._fault)return;}
    Object.assign(this._integration,{onboardGasDeltaKg:this._gasConsumedKg-startOnboard,externalGasDeltaKg:this._externalGasKg-startExternal,gasThroughputKg:this._gasConsumedKg-startOnboard+this._externalGasKg-startExternal,deliveredImpulseNs:this._impulseNs-startImpulse});
    rememberValidStep(this,dt);
  }

  _advanceContactSlice(dt,raw,sampleObservation=true) {
    raw=raw&&typeof raw==='object'?raw:{};noteSafetyInput(this,raw);
    this._researchHeightControl.active=false;
    if(this._researchHeightControl.enabled&&(this._stepCount>=this._researchHeightControl.expiresAtStep||this.mode!=='hover'||this.stabilizationMode!=='hold'||this._maneuver))this.clearResearchHeightControl(this._stepCount>=this._researchHeightControl.expiresAtStep?'command-expired':'control-layer-inactive');
    this._hasPower=this._energyUsed<this.params.batteryKWh;
    const input={throttle:clamp(finite(raw.throttle),-1,1),steer:clamp(finite(raw.steer),-1,1),
      brake:clamp(finite(raw.brake),0,1),lift:clamp(finite(raw.lift),-1,1),roll:clamp(finite(raw.roll),-1,1),pitch:clamp(finite(raw.pitch),-1,1),boost:!!raw.boost,
      frontJets:clamp(finite(raw.frontJets),0,1),rearJets:clamp(finite(raw.rearJets),0,1)};
    // A deliberate control input is an explicit pilot takeover. Holding a
    // fixed pose never silently converts stick motion into a drifting target.
    // Return to the rate-controlled hover pilot; raw research valves still bypass it.
    if(this.stabilizationMode==='hold'&&(Math.abs(input.throttle)>.02||Math.abs(input.steer)>.02||
      Math.abs(input.lift)>.02||Math.abs(input.roll)>.02||Math.abs(input.pitch)>.02||input.brake>.02||input.boost||input.frontJets>0||input.rearJets>0))this.setStabilizationMode('off');
    // A lift request always enters the same rate-limited takeoff controller.
    // Releasing the adhesion seal here precedes the fan/contact force pass.
    if(this.mode==='drive'&&input.lift>0){this.setMode('hover');this._heightTarget=Math.max(.65,this.body.position.y);}
    if(this.mode==='drive'&&input.brake>.01)input.boost=false;
    if(input.frontJets>0||input.rearJets>0){this._maneuver=null;this.clearResearchHeightControl('raw-valve-takeover');}
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
    // Sensor delay and seeded noise retain the caller/control sampling rate.
    // Internal contact slices hold that observation; ideal truth remains live.
    if(sampleObservation||!this._observationConfig.enabled)measureControlState(this);
    const direct=input.frontJets>0||input.rearJets>0;
    const desired=direct?Array(6).fill(0):this._controller(dt,input);this._thrusters(dt,desired,input);this._aero(dt);
    if(direct){this._heightTarget=this.body.position.y;this._headingTarget=this._angles().heading;this._positionTarget.copy(this.body.position);this._heightIntegral=0;}
    this._energyUsed+=this._motorWork/3.6e6;
    this._energyUsed=clamp(this._energyUsed,0,this.params.batteryKWh);
    const before=this.body.velocity.clone();this.world.step(dt);this.simTime+=dt;
    // Commit the caller's physical step only at its final contact slice. A
    // failure inside a partial slice retains the containing step and completed
    // slice count in the diagnostic without pretending a full 120 Hz tick ran.
    const integration=this._integration;let rigidContacts=0;for(const c of this.world.contacts)if(c.bi===this.body||c.bj===this.body)rigidContacts++;
    integration.completedSubsteps++;integration.contactMicrosteps+=Number(this._contactCount>0||rigidContacts>0);integration.wheelContactMicrosteps+=Number(this._contactCount>0);integration.rigidContactMicrosteps+=Number(rigidContacts>0);integration.maxWheelContacts=Math.max(integration.maxWheelContacts,this._contactCount);integration.maxRigidContacts=Math.max(integration.maxRigidContacts,rigidContacts);
    if(integration.completedSubsteps===integration.substeps)this._stepCount++;
    const accel=this.body.velocity.vsub(before).scale(1/dt).vsub(this.world.gravity);
    this._longitudinalAcceleration=this.body.velocity.vsub(before).scale(1/dt).dot(this.body.quaternion.vmult(Z));
    this._gLoad+=(accel.length()/this.params.gravity-this._gLoad)*Math.min(1,dt*8);
    this._sanity(true,integration.completedSubsteps===integration.substeps?'after-fixed-step':'after-contact-substep');
    if(this._fault) this.status=this._fault;
    else if(!this._hasPower)this.status='电池耗尽：电驱、风扇与喷口已失去供电';
    else if(this.params.supplyMode==='finite'&&this.pressureBar()<1.2&&(this.mode!=='drive'||this.airStabilization)) this.status='气源压差耗尽：推进器失去支撑';
    else if(this._pressureLimited&&this.mode==='hover') this.status='供压降低：可用推力受限';
    else if(!this._maneuver) {
      if(this.suctionEnabled&&this._sealQuality>.5) this.status=this.body.quaternion.vmult(Y).y<-.6?'倒挂：压差吸附保持':'近表面：压差吸附有效';
      else if(this.suctionEnabled&&!this._stabilizationActive) this.status='未形成近表面密封：无吸附';
      else if(this.stabilizationMode==='hold')this.status=this._holdStatus==='surface'?'定姿定点待命：接触表面，喷口保持让行':
        this._holdStatus==='limited'?'定姿定点受限：当前姿态或制动需求超出可用喷口能力':
        this._holdStatus==='holding'?'定姿定点：姿态与位置闭环保持':'定姿定点：正在减速 / 收敛至捕获参考';
      else if(this._levelRecovery.status==='pilot-pitch')this.status='俯仰输入已接收：G 临时让出俯仰，松键后恢复水平；Z / B 仍为横移';
      else if(this._stabilizationActive)this.status=this._levelRecovery.status==='limited'?'自动回正受限：正在用可用力矩恢复，当前姿态可能继续掉高':'自动稳姿：恢复水平滚转 / 俯仰，保持当前航向';
      else if(this.mode==='hover') this.status=this._manualPoseFeasible===false?'姿态保持受限：该姿态不能由当前喷口持续承重':'手动定率调姿 / 松键稳姿 / 位置闭环';
      else if(this.mode==='manual') this.status='手动喷口控制';
      else this.status=this._contactCount?'轮胎接地':'自由飞行';
    }
  }

  _sanity(normalize=true,phase='after-fixed-step') {
    const b=this.body,fields={};
    for(const [name,value]of Object.entries({position:b.position,velocity:b.velocity,quaternion:b.quaternion,angularVelocity:b.angularVelocity}))for(const key of name==='quaternion'?['x','y','z','w']:['x','y','z'])fields[name+'.'+key]=value[key];
    Object.assign(fields,{gasMass:this.gasMass,gasTemperature:this.gasTemperature,energyUsed:this._energyUsed,simTime:this.simTime});
    const nonFiniteFields=Object.entries(fields).filter(([,value])=>!Number.isFinite(value)).map(([path,value])=>({path,value:Number.isNaN(value)?'NaN':value>0?'Infinity':'-Infinity'}));
    const badQuaternion=Math.hypot(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w)<1e-9;
    const outside=b.position.y < -15 || b.position.y>350 || Math.abs(b.position.x)>CITY.extent+80 || Math.abs(b.position.z)>CITY.extent+80;
    if(nonFiniteFields.length||badQuaternion||outside){
      const reason=nonFiniteFields.length?'非有限状态已捕获，试验复位':badQuaternion?'无效姿态已捕获，试验复位':'越过试验安全域，场景已复位';
      preserveFailure(this,{kind:nonFiniteFields.length?'non-finite-state':badQuaternion?'invalid-quaternion':'safety-domain',reason,phase,nonFiniteFields});
      this.reset(this.scenario);this._fault=reason;this.status=reason;return false;
    }
    if(normalize)b.quaternion.normalize();return true;
  }

  advanceFixed(input={},dt=1/PHYSICS_HZ){if(!Number.isFinite(dt)||dt<1/240-1e-12||dt>1/60+1e-12)throw new Error('显式物理步长限于 60–240 Hz');if(this._fault||!this._sanity(false,'before-fixed-step'))return this.telemetry();this._advance(dt,input);return this.telemetry();}

  step(dt,input={},onSample,onFixedStep) {
    // Rendering may call step without advancing a physical tick. Normalizing
    // here introduced frame-rate-dependent roundoff in the feedback state.
    if(this._fault||!this._sanity(false,'before-render-step')){const failed=this.telemetry();if(onFixedStep)onFixedStep(failed,{},1/PHYSICS_HZ);if(onSample)onSample(failed);return failed;}
    if(!Number.isFinite(dt)||dt<=0) return this.telemetry();
    this._accumulator+=Math.min(dt,.1);
    const fixed=1/PHYSICS_HZ;
    let count=0;
    while(this._accumulator>=fixed-1e-10&&count<13) {
      this._advance(fixed,typeof input==='function'?input(this.simTime,fixed):input);
      if(this._fault){const failed=this.telemetry();if(onFixedStep)onFixedStep(failed,{...this._lastInput},fixed);if(onSample)onSample(failed);this._accumulator=0;break;}
      this._accumulator-=fixed;count++;
      const sample=onFixedStep||onSample&&this._stepCount%(PHYSICS_HZ/TELEMETRY_HZ)===0?this.telemetry():null;
      if(onFixedStep)onFixedStep(sample,{...this._lastInput},fixed);
      if(onSample&&this._stepCount%(PHYSICS_HZ/TELEMETRY_HZ)===0)onSample(sample);
    }
    return this.telemetry();
  }

  get interpolationAlpha(){return clamp(this._accumulator*PHYSICS_HZ,0,1);}

  releasePilotInput(reason='released'){
    const previous={...this._lastInput},rawValves=previous.frontJets>0||previous.rearJets>0;
    const pilotReference=this.mode==='hover'&&this.stabilizationMode!=='hold'&&!this._maneuver;
    // Preserve the canonical key shape: releasing an already neutral input is
    // idempotent, including archives whose reset state uses an empty object.
    this._lastInput=Object.fromEntries(Object.entries(this._lastInput).map(([key,value])=>[key,typeof value==='boolean'?false:0]));
    if(rawValves){for(const n of this._nozzles)n.command=0;this._desiredWrench=Array(6).fill(0);this._thrustWanted=0;}
    if(pilotReference){
      // Neutralizing the remembered rate must not leave a 25-degree leading
      // quaternion target to complete after blur/pause. Change references only.
      this._manualQuaternionTarget=this.body.quaternion.clone();
      this._positionTarget.copy(this.body.position);this._manualTranslationActive=Math.hypot(this.body.velocity.x,this.body.velocity.z)>.08;
      if(this._levelRecovery.status==='pilot-pitch')this._stableHeading=this._angles().heading;
    }
    this._manualReferenceRate.setZero();this._manualCommandInput.setZero();
    if(this._levelRecovery.status==='pilot-pitch'){this._levelRecovery.active=false;this._levelRecovery.status=this.stabilizationMode==='level'?'armed':'inactive';}
    this._verticalControl={...this._verticalControl,commandMps:0,targetMps:0,pilotActive:false,
      braking:pilotReference&&(this._verticalControl.pilotActive||this._verticalControl.braking)};
    return{schema:'roadster.pilot-input-release',version:1,reason:String(reason).slice(0,120),step:this._stepCount,simTime:this.simTime,
      previousInput:previous,rawValveCommandsCleared:rawValves,pilotReferenceCaptured:pilotReference,
      scope:'Pilot requests released; body pose/velocity and current nozzle force unchanged. Automatic task/hold references retained.'};
  }

  getPilotInputIntent(){
    return describePilotInputIntent(this._lastInput,{mode:this.mode,stabilizationMode:this.stabilizationMode,stabilizationActive:this._stabilizationActive,contactCount:this._contactCount,
      adhered:this.suctionEnabled&&this._sealQuality>.05,maneuver:this._maneuver?.name??null,pitchOverride:this._levelRecovery.status==='pilot-pitch',
      hasPower:this._hasPower,pressureLimited:this._pressureLimited,manualReferenceRate:this._manualReferenceRate,params:this.params});
  }

  getControlOwnership(){
    const raw=this._lastInput.frontJets>0||this._lastInput.rearJets>0;
    const owner=raw?'raw-valves':this._maneuver?'explicit-'+this._maneuver.name:this._holdActive?'explicit-pose-hold':this._stabilizationActive?'g-level-height':this.mode==='hover'?'flight-assist':this.mode==='manual'?'manual-wrench':'driver';
    const requested=this._desiredWrench.some(v=>Math.abs(v)>.01),commands=this._nozzles.reduce((sum,n)=>sum+n.command,0);
    const positionPolicy=this._holdActive?'explicit-world-target':this._maneuver?.phase==='land'||this._maneuver?.name==='land'?'coast-and-surface-land':this._stabilizationActive?'velocity-damping-no-xz-hold':this.mode==='hover'?this._manualTranslationActive?'pilot-or-release-braking':'captured-after-braking':'none';
    return {owner,requestedWrench:[...this._desiredWrench],automaticForceRequested:requested&&['flight-assist','g-level-height','explicit-pose-hold'].includes(owner),
      explicitManeuver:this._maneuver?.name??null,positionPolicy,positionTarget:positionPolicy==='explicit-world-target'?plain(this._holdPositionTarget):positionPolicy==='captured-after-braking'?plain(this._positionTarget):null,
      heightTarget:this._stabilizationActive?this._stableHeight:this.mode==='hover'?this._heightTarget:null,
      valveResidualOnly:commands<.01&&this._thrustN>.01,commandForceN:commands,actualForceN:this._thrustN,
      gSemantics:'Level attitude, heading and captured height; horizontal velocity damping. No world-XZ position lock.',
      offSemantics:'G off disables G only. Explicit H/E flight assist and X/U/L actions retain their declared controller. H to DRIVE closes automatic flight requests.',
      collisionTakeover:false,contactPolicy:'Existing ordinary flight-assist references recapture at hull contact; explicit research hold retains its requested world target.'};
  }

  telemetry() {
    const b=this.body,a=this._angles(),p=this.params,holdError=this._holdErrors();
    const localVelocity=b.quaternion.conjugate().vmult(b.velocity),budget=this._hoverBudget();
    const downFrom=b.position.vadd(V(0,.01,0)),downTo=b.position.vadd(V(0,-200,0));
    const hit=this._raySurface(downFrom,downTo);
    const altitude=hit?Math.max(0,this._ray.distance-.01):b.position.y;
    return {
      speedKmh:b.velocity.length()*3.6,forwardSpeedKmh:b.velocity.dot(b.quaternion.vmult(Z))*3.6,
      bodySlipDeg:Math.atan2(localVelocity.x,Math.max(.3,Math.abs(localVelocity.z)))*180/Math.PI,steeringCentreDeg:this._steerCentre*180/Math.PI,steeringAssist:p.steeringAssist,tractionAssist:p.tractionAssist,
      absEnabled:p.absEnabled,roadSurface:this.getRoadSurface(),observation:this.getObservation(),reference:this.getReference(),nozzleFault:this._nozzleFault?{...this._nozzleFault}:null,
      wing:{...this._wing,position:{...this._wing.position},forceBody:{...this._wing.forceBody},applicationPoint:{...this._wing.applicationPoint},mode:p.wingMode,actuatorRatePerS:p.wingActuatorRate},
      onboardGasConsumedKg:this._gasConsumedKg,externalGasSuppliedKg:this._externalGasKg,brakeDissipationJ:this._brakeDissipationJ,tireDissipationJ:this._tireDissipationJ,
      massFlowKgS:this._massFlowKgS,effectiveExhaustVelocity:this._effectiveExhaustVelocity,deliveredImpulseNs:this._impulseNs,hoverSecondsEstimate:budget.seconds,usableHoverImpulseNs:budget.impulseNs,nozzleModel:p.nozzleModel,
      researchHeightControl:{...this._researchHeightControl,lastFault:this._researchHeightControl.lastFault?{...this._researchHeightControl.lastFault}:null},
      controlAuthority:this.getControlAuthority(),controlOwnership:this.getControlOwnership(),driveAccounting:{...this._driveAccounting,shares:[...this._driveAccounting.shares]},verticalControl:{...this._verticalControl},levelRecovery:{...this._levelRecovery},
      motorForceN:this._motorForceN,regenForceN:this._regenForceN,motorLoad:Math.abs(this._motorForceN)/Math.max(1,p.maxMotorForce),
      longitudinalAcceleration:this._longitudinalAcceleration,driverInput:{...this._lastInput},pilotIntent:this.getPilotInputIntent(),
      altitude,altitudeDatum:'重心至世界竖直向下最近碰撞面的距离',heightWorld:b.position.y,
      verticalSpeed:b.velocity.y,rollDeg:a.roll*180/Math.PI,pitchDeg:a.pitch*180/Math.PI,
      headingDeg:((a.heading*180/Math.PI)%360+360)%360,
      mass:b.mass,pressureBar:this.pressureBar(),gasTemperatureK:this.gasTemperature,
      gasFraction:this.gasMass/Math.max(.001,this.gasInitialMass),gasMass:this.gasMass,initialGasMass:this.gasInitialMass,
      supplyMode:p.supplyMode,pressureLimited:this._pressureLimited,thrustN:this._thrustN,suctionN:this._suctionForce,
      sealQuality:this._sealQuality||0,sealLipExtensions:[...this._sealLipExtensions],sealLipContacts:this._sealLipContacts.map(c=>c?{point:{...c.point},normal:{...c.normal},distance:c.distance}:null),sealDistanceM:this._sealDistanceCount?this._sealDistanceSum/this._sealDistanceCount:null,suctionEnabled:this.suctionEnabled,contactCount:this._contactCount,
      energyKWh:Math.max(0,p.batteryKWh-this._energyUsed),energyUsedKWh:this._energyUsed,
      gLoad:this._gLoad,mode:this.mode,airStabilization:this.airStabilization,stabilizationActive:this._stabilizationActive,status:this.status,simTime:this.simTime,scenario:this.scenario,
      stabilizationMode:this.stabilizationMode,holdActive:this._holdActive,holdStatus:this._holdStatus,holdFeasible:this._holdFeasible,
      manualPoseFeasible:this._manualPoseFeasible,manualQuaternionTarget:this._manualQuaternionTarget?{x:this._manualQuaternionTarget.x,y:this._manualQuaternionTarget.y,z:this._manualQuaternionTarget.z,w:this._manualQuaternionTarget.w}:null,
      wind:this.getWind(),windVelocity:plain(this._windVelocity()),relativeAirSpeedMps:b.velocity.vsub(this._windVelocity()).length(),worldType:this.worldType,
      holdPositionError:holdError.position,holdAttitudeErrorDeg:holdError.attitude,holdSpeed:b.velocity.length(),holdWrenchResidual:this._allocationError,
      holdPositionTarget:this._holdPositionTarget?plain(this._holdPositionTarget):null,
      holdQuaternionTarget:this._holdQuaternionTarget?{x:this._holdQuaternionTarget.x,y:this._holdQuaternionTarget.y,z:this._holdQuaternionTarget.z,w:this._holdQuaternionTarget.w}:null,
      targetAltitude:this._heightTarget,maneuver:this._maneuver?{...this._maneuver}:null,
      physicalStep:this._stepCount,rigidContactCount:this.world.contacts.reduce((n,c)=>n+Number(c.bi===b||c.bj===b),0),integration:this._integration?{...this._integration}:null,attitudeTravel:motionDiagnostics(this),maneuverFeedback:maneuverDiagnostics(this),manualPitchEnvelope:manualPitchEnvelope(this),
      position:plain(b.position),velocity:plain(b.velocity),quaternion:{x:b.quaternion.x,y:b.quaternion.y,z:b.quaternion.z,w:b.quaternion.w},
      angularVelocity:plain(b.angularVelocity),fault:this._fault,failure:this._fault?getFailureReport(this):null,
      desiredWrench:[...this._desiredWrench],achievedWrench:[...this._achievedWrench],allocationError:this._allocationError,
      thrustMargin:this._nozzles.slice(0,4).reduce((s,n)=>s+n.maxForce,0)/Math.max(1,b.mass*p.gravity),
      nozzles:this._nozzles.map(n=>({id:n.id,kind:n.kind,position:plain(n.position),direction:plain(n.direction),force:n.force,command:n.command,maxForce:n.maxForce,healthScale:this._nozzleFault?.id===n.id?this._nozzleFault.scale:1,ratedForce:n.kind==='lift'?p.liftNozzleMax:n.kind==='roll'?p.sideNozzleMax:p.axialNozzleMax})),
      wheelStates:this.wheelStates.map(w=>({...w,position:{...w.position},contactNormalWorld:w.contactNormalWorld?{...w.contactNormalWorld}:null,contactPointWorld:w.contactPointWorld?{...w.contactPointWorld}:null})),
    };
  }
}
