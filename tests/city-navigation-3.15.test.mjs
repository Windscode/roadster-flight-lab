import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RoadsterSim} from '../dist/physics.js';
import {CityNavigator,CITY_NAV_GRAPH,CITY_NAV_GEOMETRY_ID,CITY_NAV_ROADS,locateCityRoad,buildCityNavigationGraph} from '../dist/city-navigation.js';
import {currentExperimentIdentity} from '../dist/experiment-records.js';
const t=(x,y,z,headingDeg=0,time=0)=>({position:{x,y:y+.60,z},headingDeg,simTime:time,contactCount:4,wheelStates:[{contact:true,contactPointWorld:{x,y,z}}]});
const nav=new CityNavigator();
let result=nav.setDestination('sky-forum',t(-200,0,-345));
assert.equal(result.status,'routing');assert.deepEqual(result.destination.position,[488,8,365]);
assert(result.pathRoadIds.includes('terrace-west'));assert(result.pathRoadIds.includes('terrace-link'));assert(result.pathRoadIds.includes('forum-court'));
assert(result.remainingM>1000&&result.remainingM<2000);
assert(!result.path.some(p=>p[0]>495&&p[2]>330&&p[2]<395),'route must stop before pedestrian steps/court');
const forumRoute=structuredClone(result);
assert.equal(nav.update(t(-200,0,-150)).nextTurn.kind,'left','+X turn is A/left in the actual physics and mirrored map convention');
const reroute=nav.update(t(-300,0,-400,90,1));assert(reroute.rejoining);assert(reroute.pathRoadIds.includes('canal-link'));
const rejoin=nav.update(t(-300,0,-414,90,2));assert.equal(rejoin.status,'return-to-road');assert(rejoin.rejoinPoint);assert(rejoin.path[0][2]===-400,'off-road car must not become a straight shortcut edge');
const ground=locateCityRoad(t(-200,0,-225)),high=locateCityRoad(t(-200,20,-225));assert.equal(ground.edge.roadId,'weave-main');assert.equal(high.edge.roadId,'cross-city');
const stacked=nav.setDestination('weave-exchange',t(-200,20,-225));assert.equal(stacked.status,'disconnected','overpass crossing must not connect levels');
const rampY=14*((-132.5+170)/85);assert.equal(locateCityRoad(t(200,rampY,-132.5)).edge.roadId,'skyway');assert.equal(locateCityRoad(t(200,0,-132.5)).edge.roadId,'crosstown-link');
const skyway=nav.setDestination('weave-exchange',t(200,rampY,-132.5));assert.equal(skyway.status,'disconnected');
const air=nav.update({...t(200,14,0),contactCount:0,wheelStates:[]});assert.equal(air.status,'airborne');
const townToStart=nav.setDestination('city-challenge-start',t(0,0,-28));assert.equal(townToStart.status,'routing');assert(townToStart.pathRoadIds.includes('test-center-access'));assert(townToStart.pathRoadIds.includes('terrace-west'));
const quay=nav.setDestination('southbank-entry',t(-200,0,-345));assert.deepEqual(quay.destination.position,[-430,0,-422]);assert.equal(quay.pathRoadIds.at(-1),'south-arrival');assert(quay.path.every(p=>p[2]>=-423),'no road line into the pedestrian water entrance');
const nodeGraph=buildCityNavigationGraph([{id:'low',label:'low',width:10,points:[[-5,0,0],[5,0,0]]},{id:'high',label:'high',width:10,points:[[0,5,-5],[0,5,5]]}]);assert.equal(nodeGraph.nodes.length,4);assert.equal(nodeGraph.edges.length,2);
const flatGraph=buildCityNavigationGraph([{id:'a',label:'a',width:10,points:[[-5,0,0],[5,0,0]]},{id:'b',label:'b',width:10,points:[[0,0,-5],[0,0,5]]}]);assert.equal(flatGraph.nodes.length,5);assert.equal(flatGraph.edges.length,4);
// Independent physical support rays along the selected cross-district path.
// This is not claimed as complete continuous driving or swept-body coverage.
const sim=new RoadsterSim({}, {world:'city'}),checks=[];
for(let i=1;i<forumRoute.path.length;i++){
 const a=forumRoute.path[i-1],b=forumRoute.path[i],distance=Math.hypot(...a.map((v,k)=>b[k]-v)),count=Math.max(1,Math.ceil(distance/5));
 for(let k=0;k<=count;k++){const u=k/count,p=a.map((v,j)=>v+(b[j]-v)*u),hit=sim.traceSurface({x:p[0],y:p[1]+2,z:p[2]},{x:0,y:-1,z:0},3);assert(hit,'missing actual support '+JSON.stringify(p));const error=Math.abs(hit.point.y-p[1]);assert(error<.12,'centreline level disagrees with actual support '+JSON.stringify({p,hit,error}));checks.push({point:p,objectId:hit.objectId,heightErrorM:error,raisedCrossing: error>.05});}
}
const report={schema:'roadster-city-navigation-qa',version:1,identity:currentExperimentIdentity(),navigationGeometryId:CITY_NAV_GEOMETRY_ID,roads:CITY_NAV_ROADS.map(r=>({id:r.id,source:r.source,widthM:r.width})),nodes:CITY_NAV_GRAPH.nodes.length,edges:CITY_NAV_GRAPH.edges.length,forumRoute,reroute,quay,independentSupportChecks:checks,retainedInitialFailure:{assertion:'height error < 0.12 m',actualM:0.1200000000000001,objectId:'plan-foundry-paving-110.5',position:[110,0,302.5],resolution:'The original raised paving crossing is preserved in city-entry-3.15-before.json. A narrow shared visual/collision opening now follows the existing 8 m vehicle mouth. The original <0.12 m assertion is retained without a wider tolerance; independent passage uses a stricter 0.02 m surface continuity gate.'},raisedCrossings:checks.filter(c=>c.raisedCrossing),assertions:['actual selected road topology','upper terrace vehicle entrance instead of pedestrian court','no level mixing at cross-city or skyway crossing','off-route safe rejoin indication with no invented straight edge','same-level junction splitting','central test lane to real terrace ramp','south arrival ends before accessibility ramp'],limits:['Selected route graph, not every city street or all physical access paths.','Support rays are static evidence; the city-flight test separately integrates a complete driving/flying/landing task.','No continuous full-city native driving, imagery or GPU performance claim.']};
fs.mkdirSync('qa',{recursive:true});fs.writeFileSync('qa/city-navigation-3.15.json',JSON.stringify(report,null,2));console.log('city-navigation-3.15: passed; '+checks.length+' independent support checks');
