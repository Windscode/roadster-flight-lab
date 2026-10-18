// Real SH, same ordering and normalization as Three's SphericalHarmonics3.
export const SUN_DIRECTION=[.55390484,.74283427,.37599693];
// JSON identities at sub-nanometre precision must not depend on the final bit
// of Math.sin/cos/pow across Node/Chromium/platform versions. The unrounded hash
// is retained separately in bake manifests for exact build provenance.
export function canonicalGeometryJSON(geometry){return JSON.stringify(geometry,(_key,value)=>typeof value==='number'?Math.round(value*1e9)/1e9:value);}
export const GI_HEIGHTS=[.8,2.6,6,14,32,64];
export function shBasis([x,y,z]){return[.282095,.488603*y,.488603*z,.488603*x,1.092548*x*y,1.092548*y*z,.315392*(3*z*z-1),1.092548*x*z,.546274*(x*x-y*y)];}
export function irradianceAt(coefficients,normal){const b=shBasis(normal),out=[0,0,0];for(let i=0;i<9;i++){const convolution=i===0?Math.PI:i<4?2*Math.PI/3:Math.PI/4;for(let c=0;c<3;c++)out[c]+=coefficients[i*3+c]*b[i]*convolution;}return out.map(v=>Math.max(0,v));}
export function fibonacciDirection(i,n,phase=0){const y=1-2*(i+.5)/n,r=Math.sqrt(Math.max(0,1-y*y)),a=i*2.399963229728653+phase;return[Math.cos(a)*r,y,Math.sin(a)*r];}
export const GI_VOLUMES=[
  {id:'city',min:[-624,-624],step:[32,32],size:[40,40]},
  {id:'lower-market',min:[-224,-416],step:[4,8],size:[13,59]},
];
