import {RoadsterSim} from './physics.js';
import {assertSnapshotWorldCompatible} from './simulation-snapshot.js';
import {canonicalJSON} from './experiment-records.js';

/** Validate a restoration without touching the live solver, controls or scene.
 * A missing presentation configuration is legitimate: route surface and all
 * other physical conditions come from the complete physical snapshot itself.
 * This does not promise trajectory agreement; playback measures it separately.
 */
export function preflightExperimentRestore({snapshot,context,allowVersionMismatch=false},targetSim=null){
  const expected=snapshot?.worldType==='windlab'?'lab':snapshot?.worldType==='city'?'city':null;
  if(!expected||context!==undefined&&context!==expected)throw Error('快照不可恢复：场景上下文与世界类型不匹配');
  if(targetSim)assertSnapshotWorldCompatible(targetSim,snapshot);
  const candidate=new RoadsterSim(snapshot.params,{world:snapshot.worldType});
  candidate.importState(snapshot,{allowVersionMismatch});
  // Legacy source data still requires an exact raw match. It cannot describe
  // off-metadata changes to the destination's actual static colliders, so also
  // verify that the live target matches the independently constructed world.
  if(targetSim&&!Object.hasOwn(snapshot,'geometryIdentity'))assertSnapshotWorldCompatible(targetSim,candidate.exportState());
  return{context:expected,sim:candidate};
}

/** Exact continuation-state comparison after a verified geometry match.
 * Raw geometry hashes remain source provenance; only that one field may differ
 * for a valid portable identity. No pose, resource or controller tolerance is
 * added. Neither the source snapshot nor its recorded content label is edited.
 */
export function matchesRestoredSnapshot(sim,snapshot){
  assertSnapshotWorldCompatible(sim,snapshot);
  const current=sim.exportState();
  if(Object.hasOwn(snapshot,'geometryIdentity'))current.geometrySignature=snapshot.geometrySignature;
  else delete current.geometryIdentity;
  return canonicalJSON(current)===canonicalJSON(snapshot);
}
