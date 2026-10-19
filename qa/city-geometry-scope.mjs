// Exact geometry partition for historical render/GI contracts. The new shared
// roadside entities are checked individually, not removed by a broad kind or
// prefix filter that could conceal changes to old buildings or roads.
import assert from 'node:assert/strict';
import {CITY_ROUTE_CORRIDOR} from '../dist/city-plan.js';
export function partitionCityGeometry(geometry){
  const plan=new Map(CITY_ROUTE_CORRIDOR.solids.map(s=>[s.id,s]));
  assert.equal(plan.size,CITY_ROUTE_CORRIDOR.solids.length,'Duplicate corridor identities');
  const added=geometry.filter(g=>plan.has(g.id)),legacy=geometry.filter(g=>!plan.has(g.id));
  assert.equal(added.length,plan.size,'New corridor entities are missing or duplicated in the physical world');
  for(const actual of added){
    const expected=plan.get(actual.id);assert.ok(expected.id.startsWith('corridor-'));
    assert.equal(actual.kind,expected.kind);assert.deepEqual(actual.position,expected.position);assert.deepEqual(actual.size,expected.size);
    assert.deepEqual(expected.rotation,[0,0,0]);assert.deepEqual(actual.quaternion,[0,0,0,1]);
  }
  return {legacy,added,addedIds:added.map(g=>g.id)};
}
