/** Follow actual vehicle translation before smoothing the relative chase offset.
 * World-space lag otherwise grows by approximately speed / damping: at 90 km/h
 * it adds about six metres to the intended follow distance and keeps the camera
 * outside the turn. Heading remains the physical chassis heading, never the
 * velocity direction, so real tyre sideslip remains visible.
 *
 * Only the horizontal translation is transported. The existing world-space
 * vertical filter still softens suspension movement, touchdown and flight.
 * Inputs are read-only; this function changes no physical state or camera target.
 */
export const CHASE_DAMPING_PER_SECOND=4;

export function advanceChasePosition(current,vehicle,previousVehicle,offset,dt){
  const blend=1-Math.exp(-CHASE_DAMPING_PER_SECOND*Math.max(0,Number.isFinite(dt)?dt:0));
  const carriedX=current.x+vehicle.x-previousVehicle.x;
  const carriedZ=current.z+vehicle.z-previousVehicle.z;
  return{
    x:carriedX+(vehicle.x+offset.x-carriedX)*blend,
    y:current.y+(vehicle.y+offset.y-current.y)*blend,
    z:carriedZ+(vehicle.z+offset.z-carriedZ)*blend,
  };
}
