import {Broadphase,Body} from './vendor/cannon-es.js';

// The city is static and the car moves. Cannon's SAP implementation still visits
// every static/static pair before rejecting it (quadratic in street furniture).
// An XZ grid indexes immutable city AABBs; narrow-phase contacts remain Cannon's.
export class StaticCityBroadphase extends Broadphase{
  constructor(world,cellSize=40){
    super();this.useBoundingBoxes=true;this.cellSize=cellSize;this.cells=new Map();this._indexDirty=true;
    this.moving=[];this._candidates=[];this._seen=new Map();this._queryVersion=0;
    this.world=world;const invalidate=()=>{this._indexDirty=true;};
    world.addEventListener('addBody',invalidate);world.addEventListener('removeBody',invalidate);
  }
  // City bodies are immutable between world edits. Call this after deliberately
  // changing a static transform or body type; add/remove events do it automatically.
  invalidate(){this._indexDirty=true;}
  _range(aabb){const s=this.cellSize;return[Math.floor(aabb.lowerBound.x/s),Math.floor(aabb.upperBound.x/s),Math.floor(aabb.lowerBound.z/s),Math.floor(aabb.upperBound.z/s)];}
  _refresh(world){
    if(!this._indexDirty)return;this.cells.clear();this.moving.length=0;this._seen.clear();this._queryVersion=0;
    for(const b of world.bodies){if(b.type!==Body.STATIC){this.moving.push(b);continue;}if(b.aabbNeedsUpdate)b.updateAABB();
      const [x0,x1,z0,z1]=this._range(b.aabb);
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z,list=this.cells.get(key)||[];list.push(b);this.cells.set(key,list);}
    }
    this._indexDirty=false;this.dirty=false;
  }
  _query(aabb,out=[]){
    const s=this.cellSize,x0=Math.floor(aabb.lowerBound.x/s),x1=Math.floor(aabb.upperBound.x/s),z0=Math.floor(aabb.lowerBound.z/s),z1=Math.floor(aabb.upperBound.z/s);
    // Preserve the original cell/body order, including ties, without allocating a
    // Set and a temporary result array for every suspension or telemetry ray.
    if(this._queryVersion===Number.MAX_SAFE_INTEGER){this._seen.clear();this._queryVersion=0;}
    const version=++this._queryVersion,seen=this._seen;
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
      const list=this.cells.get(x+','+z);if(!list)continue;
      for(const b of list){if(seen.get(b.id)===version)continue;seen.set(b.id,version);if(b.aabb.overlaps(aabb))out.push(b);}
    }
    return out;
  }
  collisionPairs(world,p1,p2){
    this._refresh(world);const moving=this.moving,candidates=this._candidates;
    for(const b of moving){if(b.aabbNeedsUpdate)b.updateAABB();candidates.length=0;this._query(b.aabb,candidates);for(const s of candidates)if(this.needBroadphaseCollision(b,s))this.intersectionTest(b,s,p1,p2);}
    for(let i=0;i<moving.length;i++)for(let j=i+1;j<moving.length;j++)if(this.needBroadphaseCollision(moving[i],moving[j]))this.intersectionTest(moving[i],moving[j],p1,p2);
  }
  aabbQuery(world,aabb,result=[]){
    this._refresh(world);this._query(aabb,result);
    for(const b of this.moving){if(b.aabbNeedsUpdate)b.updateAABB();if(b.aabb.overlaps(aabb))result.push(b);}
    return result;
  }
}
