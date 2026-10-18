// Shared engineering reconstruction, not Tesla CAD.
const right=[[.67,-2.04],[.70,-1.94],[.50,-1.83],[.50,-1.03],[.73,-.89],[.73,.89],[.50,1.03],[.50,1.83],[.70,1.94],[.67,2.04]];
export const SEAL_OUTLINE=[...right,...right.slice().reverse().map(([x,z])=>[-x,z])];
export const SKIRT_BASE_Y=-.326,SKIRT_MAX_EXTENSION=.44,SKIRT_RETRACTED_EXTENSION=.074;
export const SEAL_SEGMENT_LENGTHS=SEAL_OUTLINE.map(([x,z],i)=>{const b=SEAL_OUTLINE[(i+1)%SEAL_OUTLINE.length];return Math.hypot(x-b[0],z-b[1]);});
export const SEAL_PERIMETER=SEAL_SEGMENT_LENGTHS.reduce((a,b)=>a+b,0);
