import assert from 'node:assert/strict';
import {RoadsterSim} from '../dist/physics.js';
import {CITY,CITY_BUILDINGS,CITY_ROUTES} from '../dist/city-data.js';
import {SEAL_SEGMENT_LENGTHS,SKIRT_MAX_EXTENSION} from '../dist/vehicle-layout.js';
const run=(s,seconds)=>{for(let i=0;i<seconds*120;i++){const t=s.step(1/120);assert.ok(!t.fault);assert.ok(t.simTime>i/120);}return s.telemetry();};
const supported=new RoadsterSim();supported.setSuction(true);const t=run(supported,3);
assert.ok(t.suctionN>t.mass*9.81);assert.equal(t.sealLipContacts.filter(Boolean).length,20);
let conductance=0;t.sealLipContacts.forEach((c,i)=>{const gap=c.distance-t.sealLipExtensions[i];assert.ok(gap>=supported.params.sealLipGap-1e-8,'the lip cannot pass through its supporting surface');assert.ok(t.sealLipExtensions[i]<=SKIRT_MAX_EXTENSION);conductance+=supported.params.sealLeakCd*SEAL_SEGMENT_LENGTHS[i]*gap*Math.sqrt(2/supported.params.airDensity);});
const dp=t.suctionN/supported.params.suctionArea;assert.ok(conductance*dp**1.5<=supported.params.fanPower*supported.params.fanEfficiency*1.001,'pressure and leakage must respect hydraulic power');
console.log('PASS: shared perimeter lip follows the actual surface and obeys the fan power budget');
const leaking=new RoadsterSim({sealLipGap:.03});leaking.reset('ceiling');const dropped=run(leaking,.8);assert.ok(dropped.heightWorld<6&&dropped.contactCount===0);assert.ok(dropped.suctionN<dropped.mass*9.81);
console.log('PASS: an enlarged seal gap removes inverted holding authority');
const city=new RoadsterSim();assert.ok(CITY_BUILDINGS.length>100);assert.ok(city.getWorldGeometry().some(g=>g.kind==='building'));assert.ok(city.getWorldGeometry().find(g=>g.id==='ground').size[0]===CITY.extent*2);
city.reset('skyway');const deck=run(city,2);assert.equal(deck.contactCount,4);assert.ok(Math.abs(deck.heightWorld-14.6)<.1);
console.log('PASS: the 1.24 km city and elevated deck use physical shared geometry');
for(const z of [-169,-150,-110,-86]){const hit=city.traceSurface({x:200,y:30,z},{x:0,y:-1,z:0},35);assert.ok(hit);assert.ok(Math.abs(hit.point.y-(z+170)*14/85)<.03,'ramp top must join ground and deck without a step');}
console.log('PASS: both drivable ramp and deck follow the specified height profile');
let routeSamples=0;
for(const route of CITY_ROUTES)for(let i=0;i<route.points.length-1;i++){
  const a=route.points[i],b=route.points[i+1],mid=a.map((v,k)=>(v+b[k])/2);
  const hit=city.traceSurface({x:mid[0],y:mid[1]+.3,z:mid[2]},{x:0,y:-1,z:0},.6);
  assert.ok(hit,`${route.id}/${i} has no matching drive surface`);
  assert.ok(Math.abs(hit.point.y-mid[1])<.035,`${route.id}/${i}: visible and collision deck differ`);routeSamples++;
}
assert.ok(routeSamples>90);
city.reset('harbor');const upper=run(city,2);assert.equal(upper.contactCount,4);assert.ok(Math.abs(upper.heightWorld-8.6)<.10);
console.log(`PASS: ${routeSamples} authored road segments match their visible top, and the 8 m upper district supports all wheels`);
city.reset('city');let street;
for(let i=0;i<360;i++){street=city.step(1/120,{throttle:1});assert.ok(!street.fault);assert.ok(street.heightWorld>.35);}
assert.ok(street.position.z>-320);assert.equal(street.contactCount,4);assert.ok(Math.abs(street.position.x+200)<.1);
console.log('PASS: the market street is physically traversable beneath its raised footbridge');
