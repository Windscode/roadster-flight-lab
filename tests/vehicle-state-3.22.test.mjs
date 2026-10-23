import assert from 'node:assert/strict';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createRoadster,VEHICLE_STEERING_PRESENTATION as P} from '../dist/vehicle.js';
import {RoadsterSim} from '../dist/physics.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const checks=[],car=createRoadster({inspection:true});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
const check=(name,fn)=>{fn();checks.push({name,status:'passed'});};
check('A separate batched yoke follows measured steering in both cabin identities',()=>{
  assert.equal(car.cockpitSteering.length,2);
  for(const degrees of [-20,0,20]){
    // Actual centre steering takes priority over uneven inner/outer wheel angles.
    car.update({steeringCentreDeg:degrees,wheelStates:[{steer:.4},{steer:.3}]},0);
    for(const yoke of car.cockpitSteering){
      near(yoke.rotation.z,-degrees*Math.PI/180*P.ratio);
      near(yoke.rotation.x,-.10);
      assert.equal(yoke.userData.source,'telemetry.steeringCentreDeg');
      assert.ok(yoke.children.some(o=>o.isMesh),'The moving group must retain visible geometry after batching');
    }
  }
});
check('Inspection poses use front wheels and return the yoke to neutral without telemetry',()=>{
  for(const steer of [-.49,0,.49]){
    car.update({wheelStates:car.wheels.map(w=>({steer:w.z>0?steer:0,suspensionLength:.32,rotation:1}))},0);
    for(const yoke of car.cockpitSteering)near(yoke.rotation.z,-steer*P.ratio);
  }
  car.update({},0);
  for(const yoke of car.cockpitSteering){near(yoke.rotation.z,0);assert.equal(yoke.userData.source,'neutral inspection pose');}
  car.update({steeringCentreDeg:999},0);
  for(const yoke of car.cockpitSteering)near(yoke.rotation.z,-P.maxRoadWheelAngleRad*P.ratio);
});
check('Quality, interior, cutaway and display changes preserve articulation and geometry identity',()=>{
  car.update({steeringCentreDeg:12},0);
  const identities=car.cockpitSteering.map(y=>({uuid:y.uuid,angle:y.rotation.z,children:y.children.map(o=>o.uuid)}));
  for(const quality of ['balanced','high','ultra'])for(const display of ['official-study','experimental']){
    car.setQuality(quality);car.setDisplayConfiguration(display);car.setInteriorView(true);car.setCutaway(true);car.setCutaway(false);car.setInteriorView(false);
    car.cockpitSteering.forEach((y,i)=>{assert.equal(y.uuid,identities[i].uuid);near(y.rotation.z,identities[i].angle);assert.deepEqual(y.children.map(o=>o.uuid),identities[i].children);});
  }
});
check('Changing driving-lamp mode cannot extinguish an active service or regenerative brake lamp',()=>{
  for(const telemetry of [{brake:1},{forwardSpeedKmh:30,longitudinalAcceleration:-1.2,driveAccounting:{totalRetardingForceN:2600}}]){
    car.update(telemetry,0);
    for(const mode of ['off','drl','low-beam']){car.setLampMode(mode);near(car.materials.tailLight.emissiveIntensity,2.4);}
    car.setLampMode('off');car.update({brake:0},0);near(car.materials.tailLight.emissiveIntensity,0);
  }
});
check('Actual simulation steering drives the display without changing physical or replay state',()=>{
  const sim=new RoadsterSim();
  for(const steer of [-.6,.6]){
    for(let i=0;i<60;i++)sim.advanceFixed({steer,throttle:.12},1/120);
    const t=sim.telemetry(),state=sim.exportState();
    car.update(t,1/60);
    assert.equal(Math.sign(t.steeringCentreDeg),Math.sign(steer));
    for(const yoke of car.cockpitSteering)near(yoke.rotation.z,-t.steeringCentreDeg*Math.PI/180*P.ratio);
    assert.deepEqual(sim.exportState(),state);
  }
});
car.dispose();
const report={modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,status:'passed',scope:'Scene-graph and actual numerical-state correspondence. No WebGL pixel, OEM steering-ratio or native input acceptance.',steeringPresentation:P,checks};
mkdirSync(`qa/vehicle-${REPORT_VERSION}`,{recursive:true});writeFileSync(`qa/vehicle-${REPORT_VERSION}/state-correspondence.json`,JSON.stringify(report,null,2)+'\n');
console.log(`${checks.length}/${checks.length} vehicle-state checks passed`);
