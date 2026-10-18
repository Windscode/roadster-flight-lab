// Compare completed, matching geometry audits. This is not an FPS benchmark.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';

const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=name=>readFileSync(new URL(name,root)),read=name=>JSON.parse(bytes(name));
assert.equal(MODEL_VERSION,'3.6.0','This comparison belongs to release 3.6.');
const baselineHashes={
  'qa/render-budget-3.5.json':'04145721700d85f1e89d27e525b1b524ea9e8119ea9ca392f1fac95cc4ae86b2',
  'qa/render-budget-comparison-3.5.json':'4e01e2103f141928ab1f98ae1e9645ada1f5d8d5834366521090eb56df5d5f91',
  'qa/vehicle-3.5-render-cost.json':'502490a03046724da5e1c92ee3161c3aa119a093db252ff2fe161321fccce2f3'
};
for(const [name,hash]of Object.entries(baselineHashes))assert.equal(sha(bytes(name)),hash,'Historical evidence was changed: '+name);
const before=read('qa/render-budget-3.5.json'),after=read('qa/render-budget-3.6.json');
const history=read('qa/render-budget-comparison-3.5.json');
const oldCar=read('qa/vehicle-3.5-render-cost.json'),newCar=read('qa/vehicle-3.6-render-cost.json');
assert.equal(before.status,'passed');assert.equal(after.status,'passed');assert.equal(newCar.status,'passed');
const city={};
for(const quality of ['balanced','high','ultra']){
  city[quality]=after.views[quality].map(row=>{
    const old=before.views[quality].find(item=>item.view===row.view);
    assert.ok(old,'Camera route differs from the reference run.');
    return{view:row.view,before:old,after:row,
      triangleReduction:1-row.triangles/old.triangles,
      drawChange:row.drawCalls-old.drawCalls};
  });
  assert.deepEqual(newCar.profiles[quality].atRest,oldCar.profiles[quality].atRest,
    'The finish-only vehicle change must preserve its geometry and draw budget.');
}
const physicalBefore=before.checks.find(c=>c.canonicalSHA256)?.canonicalSHA256;
const physicalAfter=after.checks.find(c=>c.canonicalSHA256)?.canonicalSHA256;
assert.ok(physicalBefore);assert.equal(physicalAfter,physicalBefore,'Physical collision envelopes changed.');
const sources=readdirSync(new URL('dist/',root)).filter(name=>name.endsWith('.js')).map(name=>'dist/'+name);
sources.push('dist/index.html','dist/game.css','qa/render-budget-check.mjs','qa/compare-graphics-3.6.mjs');
const report={format:'roadster-graphics-comparison-3.6',createdAt:new Date().toISOString(),status:'passed',
  modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,
  method:'Comparison of independently completed Three.js geometry/frustum audits with identical five-camera and quality-switch sequences. The frozen 3.5 reports are checked by SHA-256. No graphics driver is executed by this comparison.',
  baselineCommit:'b88b49b71201f458143e4e7e2ad77aff4c5cfaf0',baselineHashes,
  camera:history.camera,views:history.views,evaluationProtocol:history.evaluationProtocol,
  sourceHashes:Object.fromEntries(sources.map(name=>[name,sha(bytes(name))])),
  reportHashes:Object.fromEntries(['qa/render-budget-3.6.json','qa/vehicle-3.6-render-cost.json'].map(name=>[name,sha(bytes(name))])),
  city,coldStart:{before:history.coldStart['v3.5'].balanced,after:after.coldStart},
  vehicle:{geometryUnchanged:true,profiles:newCar.profiles},physicalGeometryCanonicalSHA256:physicalAfter,
  limitations:[
    'These are beauty-pass geometry submission estimates, not achieved frame rates or total GPU draw calls.',
    'The new dedicated reflection shadow map, material texture reads and bilateral AO cost are not represented by beauty triangles.',
    'Canvas signs and asynchronous shrub assets are omitted equally; 3.6 generates no people or animals.',
    'LOD hysteresis makes a cold start and a return to the same viewpoint differ; both are preserved.',
    'The visual appearance, driver shader behavior and target-device frame time require real browser verification.'
  ]};
writeFileSync(new URL('qa/graphics-comparison-3.6.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,balanced:city.balanced.map(c=>({view:c.view,
  triangles:[c.before.triangles,c.after.triangles],draws:[c.before.drawCalls,c.after.drawCalls]})),
  vehicleGeometryUnchanged:true,collisionGeometryUnchanged:true},null,2));
