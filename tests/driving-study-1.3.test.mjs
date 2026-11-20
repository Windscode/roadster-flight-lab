import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {vehicleBrakeSignal} from '../dist/vehicle-light-state.js';
import {RoadsterSim} from '../dist/physics.js';
import {frontWheelSteer,MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
import {REPORT_VERSION} from '../scripts/qa-report-version.mjs';
import {resolveCameraObstruction} from '../dist/chase-camera.js';
import {buildStudyRequests,studyArchive,importStudy} from '../dist/research-study.js';
import {runExperiment} from '../dist/experiment-worker.js';
import {normalizeResearchRequest} from '../dist/research-protocol.js';
import {createRouteSurfacePreset} from '../dist/route-surface.js';
import {attachRoadSurface} from '../dist/road-surface-material.js';
import {MeshStandardMaterial} from '../dist/vendor/three.module.js';

const sim=new RoadsterSim({regenForce:0});
for(let i=0;i<240;i++)sim.advanceFixed({});
sim.body.velocity.z=18;
for(const w of sim.wheelStates)w.angularVelocityRadS=18/sim.params.wheelRadius;
const before=sim.telemetry();
for(let i=0;i<120;i++)sim.advanceFixed({});
const coast=sim.telemetry();
const rollingJ=coast.energyAccounting.rollingLossJ-before.energyAccounting.rollingLossJ;
assert.ok(rollingJ>1000);
assert.equal(coast.energyAccounting.recoveredJ-before.energyAccounting.recoveredJ,0);
assert.equal(vehicleBrakeSignal({...coast,longitudinalAcceleration:-1.2}),false);
assert.ok(Math.abs(coast.energyAccounting.balanceErrorJ)<.02);

const poses=[];
for(const centre of [-.49,0,.49]){
  const left=frontWheelSteer(centre,.89),right=frontWheelSteer(centre,-.89);
  if(centre){
    assert.ok(Math.abs(2.84/Math.tan(right)-2.84/Math.tan(left)-1.78)<1e-9);
    assert.ok(right<centre&&left>centre);
  }else assert.equal(Math.abs(left)+Math.abs(right),0);
  poses.push({centre,left,right});
}

const material=new MeshStandardMaterial(),surface=attachRoadSurface(material,{});
surface.setRouteSurfaceDescription(createRouteSurfacePreset('after-rain'));
assert.deepEqual(surface.uniforms.roadTurn.value.toArray(),[-200,-132.5,1,0]);
surface.setRouteSurfaceDescription(null);assert.deepEqual(surface.uniforms.roadTurn.value.toArray(),[0,0,0,0]);material.dispose();

let maxCandidates=0,hits=0,queries=0,seed=91;
const random=()=>((seed=Math.imul(1664525,seed)+1013904223>>>0)/2**32);
for(const world of [sim,new RoadsterSim({},{world:'windlab'})]){
  const boxes=world.getWorldGeometry();
  for(let i=0;i<360;i++){
    const box=boxes[Math.floor(random()*boxes.length)],p=box.position;
    const target={x:p[0]+random()*24-12,y:p[1]+random()*10-5,z:p[2]+random()*24-12};
    const desired={x:target.x+random()*40-20,y:target.y+random()*20-10,z:target.z+random()*40-20};
    const spec={target,desired,aspect:2.3,viewOffsetFraction:.35,near:.12};
    const all=resolveCameraObstruction({...spec,geometry:boxes});
    const near=resolveCameraObstruction({...spec,geometryNear:(a,b,r)=>{
      const list=world.cameraGeometryNear(a,b,r);maxCandidates=Math.max(maxCandidates,list.length);return list;
    }});
    assert.deepEqual(near,all);queries++;if(all.hit)hits++;
  }
}
assert.ok(hits>50&&maxCandidates<sim.geometry.length/2);

const results=[];
for(const roadSurface of ['dry','wet','split']){
  const base={kind:'brake',initialSoc:.8,speedKmh:80,params:{roadSurface}};
  const jobs=buildStudyRequests(base,{mode:'pair',pairKey:'regenEnabled'});
  const entries=jobs.map(j=>({...j,report:runExperiment(j.request)}));
  const restored=importStudy(studyArchive(entries));
  assert.deepEqual(restored.map(j=>j.request),jobs.map(j=>j.request));
  const stops=entries.map(e=>e.report.metrics.stop);
  assert.ok(stops.every(s=>s&&s.entrySpeedKmh>75&&Math.abs(s.entrySoc-.8)<.001));
  assert.equal(stops[0].recoveredWh,0);assert.ok(stops[1].recoveredWh>1);
  assert.ok(stops[1].frictionHeatWh<stops[0].frictionHeatWh);
  assert.ok(Math.abs(stops[0].distanceM-stops[1].distanceM)<.05);
  for(const [i,stop] of stops.entries())results.push({roadSurface,regeneration:jobs[i].request.params.regenEnabled,...stop});
}
assert.throws(()=>normalizeResearchRequest({kind:'brake',initialSoc:1.01}));
assert.throws(()=>normalizeResearchRequest({kind:'hover',initialSoc:.8}));
const path='qa/release-'+REPORT_VERSION;
mkdirSync(path,{recursive:true});writeFileSync(path+'/driving-study.json',JSON.stringify({modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,coasting:{entrySpeedKmh:before.forwardSpeedKmh,finalSpeedKmh:coast.forwardSpeedKmh,rollingJ},poses,fullCityBoxes:sim.geometry.length,queries,hits,maxCandidates,results},null,2)+'\n');
console.log('PASS rolling work, steering geometry, route arrows, indexed camera queries and six braking trials');
