import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
// Usage: git show 70e98013d6da246c78c4c50ca2ef44595d1f356b:dist/vehicle.js > /tmp/vehicle-312.js
// Then: node scripts/capture-vehicle-optical-baseline.mjs /tmp/vehicle-312.js
// This intentionally constructs geometry only; it neither launches a renderer nor creates screenshots.
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),commit='70e98013d6da246c78c4c50ca2ef44595d1f356b';
assert.ok(process.argv[2],'Pass the exact published 3.12 vehicle.js file');
const bytes=readFileSync(process.argv[2]);
assert.equal(createHash('sha256').update(bytes).digest('hex'),'b1de2dd86bdeee27a059101e9e004e3a2030214376d415f64fd0c0e251f5dfa5','Baseline source identity differs from the published commit');
const source=bytes.toString().replaceAll("from './", "from '"+pathToFileURL(root+'/dist/').href);
const {createRoadster,sampleVehicleSurface}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const car=createRoadster({quality:'high'}),surfaces=[];car.group.updateMatrixWorld(true);car.group.traverse(o=>{if(o.isMesh&&[car.materials.paint,car.materials.seam].includes(o.material))surfaces.push(o);});
const ray=new THREE.Raycaster(),jointRays=[];
for(const side of [-1,1])for(const z of [1.15,1.60,2.05]){const x=side*sampleVehicleSurface(0,z).bonnetHalfWidth,bodyY=sampleVehicleSurface(x,z).bodyY;ray.set(new THREE.Vector3(x,1,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObjects(surfaces,false)[0];jointRays.push({x,z,bodyY,topY:hit.point.y,aboveAuthoredBodyM:hit.point.y-bodyY,material:hit.object.material===car.materials.paint?'paint':'seam'});}
const glass=[];car.group.traverse(o=>{if(o.isMesh&&o.material===car.materials.glass)glass.push({name:o.name,parts:o.userData.parts??[o.name],worldOrigin:o.getWorldPosition(new THREE.Vector3()).toArray(),triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3});});
const baselineCoverWinding={triangles:0,upward:0,downward:0};car.group.traverse(o=>{if(!o.isMesh||!(o.userData.parts??[o.name]).includes('flush clear headlamp cover'))return;const g=o.geometry,p=g.attributes.position,index=g.index,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();for(let i=0;i<index.count;i+=3){a.fromBufferAttribute(p,index.getX(i));b.fromBufferAttribute(p,index.getX(i+1));c.fromBufferAttribute(p,index.getX(i+2));if(![a,b,c].every(v=>Math.abs(v.y-sampleVehicleSurface(v.x,v.z).bodyY-.0025)<2e-6))continue;const normal=b.sub(a).cross(c.sub(a));baselineCoverWinding.triangles++;baselineCoverWinding[normal.y>0?'upward':'downward']++;}});
const glassBounds=new THREE.Box3();car.group.traverse(o=>{if(o.isMesh&&o.material===car.materials.glass)glassBounds.union(new THREE.Box3().setFromObject(o));});
const profiles={};for(const q of ['balanced','high','ultra']){car.setQuality(q);profiles[q]=car.getRenderCost();}
const samplePoints=[[-.7,1.2],[.72,1.4],[.8,1.8],[0,2.05],[-.9,-1.4],[.9,-.5],[0,-2.1]].map(([x,z])=>({x,z,sample:sampleVehicleSurface(x,z)}));
const out={baselineCommit:commit,sourceSHA256:createHash('sha256').update(bytes).digest('hex'),method:'Construct exact public vehicle.js (only relative imports resolved), raycast actual source meshes at fixed samples; no GPU pixels.',jointRays,glass,baselineCoverWinding,glassBounds:{min:glassBounds.min.toArray(),max:glassBounds.max.toArray()},profiles,samplePoints,glassOpacity:car.materials.glass.opacity,paint:{roughness:car.materials.paint.roughness,metalness:car.materials.paint.metalness,clearcoat:car.materials.paint.clearcoat}};
writeFileSync(root+'/qa/fixtures/vehicle-optical-baseline-3.12.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({jointRays,glassBatches:glass.length,profiles}));car.dispose();
