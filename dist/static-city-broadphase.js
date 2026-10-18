import {Broadphase,Body} from './vendor/cannon-es.js';

// The city is static and the car moves. Cannon's SAP implementation still visits
// every static/static pair before rejecting it (quadratic in street furniture).
// An XZ grid indexes immutable city AABBs; narrow-phase contacts remain Cannon's.
export class StaticCityBroadphase extends Broadphase{
  constructor(world,cellSize=40){
    super();this.useBoundingBoxes=true;this.cellSize=cellSize;this.cells=new Map();this._indexDirty=true;
    this.world=world;const invalidate=()=>{this._indexDirty=true;};
    world.addEventListener('addBody',invalidate);world.addEventListener('removeBody',invalidate);
  }
  _range(aabb){const s=this.cellSize;return[Math.floor(aabb.lowerBound.x/s),Math.floor(aabb.upperBound.x/s),Math.floor(aabb.lowerBound.z/s),Math.floor(aabb.upperBound.z/s)];}
  _refresh(world){
    if(!this._indexDirty)return;this.cells.clear();
    for(const b of world.bodies){if(b.type!==Body.STATIC)continue;if(b.aabbNeedsUpdate)b.updateAABB();
      const [x0,x1,z0,z1]=this._range(b.aabb);
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z,list=this.cells.get(key)||[];list.push(b);this.cells.set(key,list);}
    }
    this._indexDirty=false;this.dirty=false;
  }
  _query(aabb){
    const [x0,x1,z0,z1]=this._range(aabb),seen=new Set(),out=[];
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)for(const b of this.cells.get(x+','+z)||[]){if(seen.has(b.id))continue;seen.add(b.id);if(b.aabb.overlaps(aabb))out.push(b);}
    return out;
  }
  collisionPairs(world,p1,p2){
    this._refresh(world);const moving=world.bodies.filter(b=>b.type!==Body.STATIC);
    for(const b of moving){if(b.aabbNeedsUpdate)b.updateAABB();for(const s of this._query(b.aabb))if(this.needBroadphaseCollision(b,s))this.intersectionTest(b,s,p1,p2);}
    for(let i=0;i<moving.length;i++)for(let j=i+1;j<moving.length;j++)if(this.needBroadphaseCollision(moving[i],moving[j]))this.intersectionTest(moving[i],moving[j],p1,p2);
  }
  aabbQuery(world,aabb,result=[]){
    this._refresh(world);result.push(...this._query(aabb));
    for(const b of world.bodies)if(b.type!==Body.STATIC){if(b.aabbNeedsUpdate)b.updateAABB();if(b.aabb.overlaps(aabb))result.push(b);}
    return result;
  }
}
