/**
 * Rendering budgets only. These ranges never remove or change physics solids.
 * Large building masses remain visible; only detail with little screen coverage
 * is retired. CPU visibility runs at 8 Hz, not once per instance per frame.
 */
export const CITY_RENDER_PRESETS = Object.freeze({
  balanced: Object.freeze({massDistance:1800,facadeDistance:210,detailDistance:70,streetDistance:95,vegetationDistance:115,actorDistance:45,actorHz:15,shadowCascades:1,shadowSize:1024,shadowHz:30,shadowFar:105,probeSize:0,probeInterval:0,probeDistance:0,probeMaxAge:0,probeShadowSize:0,probeFar:0,giMode:'vertex'}),
  high: Object.freeze({massDistance:1800,facadeDistance:380,detailDistance:135,streetDistance:165,vegetationDistance:210,actorDistance:80,actorHz:24,shadowCascades:2,shadowSize:1536,shadowHz:45,shadowFar:195,probeSize:128,probeInterval:1.5,probeDistance:5,probeMaxAge:7,probeShadowSize:512,probeFar:125,giMode:'fragment'}),
  ultra: Object.freeze({massDistance:1800,facadeDistance:560,detailDistance:205,streetDistance:225,vegetationDistance:285,actorDistance:110,actorHz:30,shadowCascades:3,shadowSize:2048,shadowHz:60,shadowFar:265,probeSize:256,probeInterval:.9,probeDistance:3.5,probeMaxAge:5,probeShadowSize:768,probeFar:180,giMode:'fragment'}),
});

export function cityRenderProfile(quality='balanced', overrides={}) {
  return {...CITY_RENDER_PRESETS[quality]||CITY_RENDER_PRESETS.balanced,...overrides};
}

// Architectural microdetail used to share a 300 m batch with entire buildings.
// Classifying before batching lets a distant railing leave the draw list while
// retaining its building, floors and load-bearing street silhouette.
export function architectureDetailLevel(kind,geometry,size) {
  if(geometry==='wall-pier'||geometry==='wall-spandrel')geometry='box';
  const sorted=[...size].sort((a,b)=>a-b);
  if(geometry==='box'&&((sorted[1]>3&&sorted[2]>8)||(sorted[0]>.65&&sorted[1]>2.6)))return 'mass';
  if(kind==='signs'||kind==='rooms'||kind==='glass')return 'facade';
  if((kind==='concrete'||kind==='darkConcrete')&&sorted[1]>.30)return 'facade';
  return 'detail';
}

export function createCityVisibility(THREE,{quality='balanced'}={}) {
  let profile=cityRenderProfile(quality),lastTime=-Infinity;
  const entries=[],lastPoint=new THREE.Vector3(Infinity,Infinity,Infinity),box=new THREE.Box3();
  const stats={quality,allocatedBatches:0,allocatedTriangles:0,activeBatches:0,activeTriangles:0,shadowBatches:0,shadowTriangles:0,culledBatches:0,updates:0,updateMs:0};
  function add(mesh,{level='detail',shadow=mesh.castShadow,padding=0}={}) {
    mesh.updateMatrixWorld(true);box.setFromObject(mesh);
    const bounds=box.clone().expandByScalar(padding),triangleCount=(mesh.geometry?.index?.count||mesh.geometry?.attributes.position?.count||0)/3*(mesh.isInstancedMesh?mesh.count:1);
    mesh.userData.renderDetail=level;
    entries.push({mesh,bounds,level,shadow,triangleCount});
    stats.allocatedBatches++;stats.allocatedTriangles+=triangleCount;
    lastTime=-Infinity;
    return mesh;
  }
  function distanceToBounds(p,b) {
    return Math.hypot(Math.max(b.min.x-p.x,0,p.x-b.max.x),Math.max(b.min.y-p.y,0,p.y-b.max.y),Math.max(b.min.z-p.z,0,p.z-b.max.z));
  }
  function update(time,p,force=false) {
    if(!p||(!force&&time-lastTime<.125&&lastPoint.distanceToSquared(p)<36))return stats;
    const begin=performance.now();lastTime=time;lastPoint.copy(p);
    stats.activeBatches=stats.activeTriangles=stats.shadowBatches=stats.shadowTriangles=0;
    for(const entry of entries) {
      const {mesh,level,bounds}=entry,d=distanceToBounds(p,bounds);
      const range=profile[level+'Distance']??profile.detailDistance;
      // Different show/hide distances prevent edge flicker while orbiting.
      mesh.visible=d<range+(mesh.visible?10:0);
      const shadowRange=level==='mass'?profile.shadowFar+310:level==='facade'?profile.shadowFar*.70:level==='vegetation'?(profile.giMode==='vertex'?0:profile.shadowFar*.26):profile.giMode==='vertex'?0:profile.detailDistance*.40;
      mesh.castShadow=entry.shadow&&mesh.visible&&d<shadowRange+(mesh.castShadow?6:0);
      const triangles=mesh.isInstancedMesh?(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3*mesh.count:entry.triangleCount;
      if(mesh.visible){stats.activeBatches++;stats.activeTriangles+=triangles;}
      if(mesh.castShadow){stats.shadowBatches++;stats.shadowTriangles+=triangles;}
    }
    stats.culledBatches=stats.allocatedBatches-stats.activeBatches;stats.updates++;stats.updateMs=performance.now()-begin;
    return stats;
  }
  return {add,update,stats,entries,setQuality(q,overrides={}){quality=q;profile=cityRenderProfile(q,overrides);stats.quality=q;lastTime=-Infinity;},get profile(){return profile;}};
}

/** Exact frustum submission estimate for Node audits, not a GPU FPS claim. */
export function countVisibleGeometry(THREE,root,camera) {
  root.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)),sphere=new THREE.Sphere();
  const result={drawCalls:0,triangles:0,instances:0,shadowDrawCalls:0,shadowTriangles:0};
  root.traverseVisible(o=>{
    if(!o.isMesh)return;
    if(o.isInstancedMesh){if(!o.boundingSphere)o.computeBoundingSphere();sphere.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);}
    else{if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);}
    if(o.frustumCulled&&!frustum.intersectsSphere(sphere))return;
    const count=o.isInstancedMesh?o.count:1,triangles=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*count;
    result.drawCalls+=Array.isArray(o.material)?o.geometry.groups.length:1;result.triangles+=triangles;result.instances+=count;
    if(o.castShadow){result.shadowDrawCalls++;result.shadowTriangles+=triangles;}
  });
  return result;
}
