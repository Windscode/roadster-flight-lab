import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createRoadster} from '../dist/vehicle.js';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {runExperiment} from '../dist/experiment-worker.js';
import {buildStudyRequests,studyArchive,importStudy} from '../dist/research-study.js';
import {standardReportCSV} from '../dist/research-lab.js';
import {createRouteSurfacePreset,routeSurfaceProgress} from '../dist/route-surface.js';
import {weaveApproach} from '../dist/route-sectors.js';

const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} differs from ${b}`);
const rows=[];
for(const speedKmh of [40,80,120]){
  const jobs=buildStudyRequests({kind:'coast',speedKmh,initialSoc:.8},{mode:'pair',pairKey:'liftOffBraking'});
  const entries=jobs.map(j=>({...j,report:runExperiment(j.request)}));
  assert.deepEqual(importStudy(studyArchive(entries)).map(j=>j.request),jobs.map(j=>j.request));
  const [free,braked]=entries.map(e=>e.report.metrics.coast);
  assert.ok(free.distanceM>braked.distanceM&&free.exitSpeedKmh>braked.exitSpeedKmh);
  assert.equal(free.recoveredWh,0);assert.equal(free.frictionHeatWh,0);
  assert.ok(free.rollingLossWh>0&&braked.recoveredWh>0&&braked.netBatteryWh<0);
  for(const e of entries){
    const coast=e.report.metrics.coast,last=e.report.rows.at(-1);
    close(coast.entrySpeedKmh,speedKmh);close(coast.entrySoc,.8);close(coast.distanceM,last.coastDistanceM);
    close(coast.recoveredWh,last.recoveredWh);close(coast.frictionHeatWh,last.frictionHeatWh);
    assert.ok(e.report.rows.every(r=>r.throttle===0&&r.brake===0));
    assert.match(standardReportCSV(e).split('\n').find(line=>line.startsWith('run_id,')),/coastDistanceM,recoveredWh,frictionHeatWh/);
    rows.push({liftOffBraking:e.request.params.liftOffBraking,...coast});
  }
}
const pedal=runExperiment({kind:'brake',speedKmh:80,initialSoc:.8,params:{liftOffBraking:false}}).metrics.stop;
assert.ok(pedal.recoveredWh>0&&pedal.distanceM>0&&pedal.confirmationSeconds>=.5);
const full=runExperiment({kind:'coast',speedKmh:80,initialSoc:1}).metrics.coast;
const normal=rows.find(r=>r.entrySpeedKmh===80&&r.liftOffBraking);
assert.ok(full.recoveredWh<normal.recoveredWh&&full.frictionHeatWh>normal.frictionHeatWh);
const desc=createRouteSurfacePreset('after-rain'),finish=desc.route.waypoints.at(-1);
function cue(x,z,vx,vz){
  const t={position:{x,z},velocity:{x:vx,z:vz}};
  return weaveApproach(desc,routeSurfaceProgress(desc,t.position),t);
}
const approach=cue(finish.x-20,finish.z,10,0);
assert.equal(approach.kind,'stop');close(approach.distance,20);close(approach.required,2.5);
assert.equal(cue(finish.x-20,finish.z,-10,0).required,0);
assert.equal(cue(finish.x,finish.z,0,0).kind,'inside');
assert.equal(cue(finish.x+10,finish.z,10,0).kind,'return');
assert.equal(cue(finish.x-12,finish.z+10,10,0).kind,'off-route');
assert.equal(cue(-200,-152.5,0,15).kind,'turn');
const pos={x:finish.x-20,z:finish.z},wheel={contact:true,surfaceMu:.5,normalLoadN:5000,lateralForceN:2000};
const demand=v=>weaveApproach(desc,routeSurfaceProgress(desc,pos),{position:pos,velocity:{x:v,z:0},mass:2000,wheelStates:Array(4).fill(wheel)});
assert.equal(demand(10).exceedsGrip,false);assert.equal(demand(15).exceedsGrip,true);

const car=createRoadster({inspection:true});
let verifiedWheels=0;
for(const quality of ['balanced','high']){
  car.setQuality(quality);car.group.updateMatrixWorld(true);
  for(const {spin,assembly} of car.wheels){
    const barrels=[];spin.traverse(o=>{if(o.isMesh&&o.material===car.materials.wheelBarrel)barrels.push(o);});
    assert.ok(barrels.length);assert.ok(assembly.getObjectByName('brake caliper'));
    function hits(radius){
      const origin=spin.localToWorld(new THREE.Vector3(1,radius,0));
      const direction=new THREE.Vector3(-1,0,0).transformDirection(spin.matrixWorld);
      return new THREE.Raycaster(origin,direction).intersectObjects(barrels,false).length;
    }
    assert.equal(hits(.265),0);assert.ok(hits(.286)>0);verifiedWheels++;
  }
}
car.dispose();
const dir='qa/release-'+REPORT_VERSION;mkdirSync(dir,{recursive:true});
writeFileSync(dir+'/coast-study.json',JSON.stringify({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,rows,pedalWithCoasting:pedal,fullBattery:full,approach,verifiedWheels},null,2)+'\n');
console.log('PASS coasting, pedal regeneration, archive and CSV, route approach and open wheel barrels');
