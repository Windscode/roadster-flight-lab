import {FXAAShader as vendorFXAA} from './vendor/addons/shaders/FXAAShader.js';

// The composer input has exactly one mip level. Explicit LOD 0 preserves its
// intended bilinear sampling without implicit derivatives inside FXAA's
// per-pixel edge-search loops (ANGLE/D3D warning X3595). Keep the vendored
// algorithm and its attribution; only its local sampling/return paths change.
// A single initialized return also avoids the generated f_ApplyFXAA temporary
// flagged by some ANGLE/D3D compilers (X4000). Driver warning disappearance and
// moving-edge appearance still require an actual browser capture.
const sample='return texture( tex2D, uv );';
const begin=vendorFXAA.fragmentShader.indexOf('\t\tvec4 ApplyFXAA(');
const end=vendorFXAA.fragmentShader.indexOf('\n\t\tvoid main()',begin);
if(!vendorFXAA.fragmentShader.includes(sample)||begin<0||end<0)throw new Error('Review the pinned FXAA shader before updating its adapter');

const apply=`
        vec4 ApplyFXAA( sampler2D tex2D, vec2 texSize, vec2 uv ) {
            vec4 result = Sample( tex2D, uv );
            LuminanceData luminance = SampleLuminanceNeighborhood( tex2D, texSize, uv );
            if ( !ShouldSkipPixel( luminance ) ) {
                float pixelBlend = DeterminePixelBlendFactor( luminance );
                EdgeData edge = DetermineEdge( texSize, luminance );
                float edgeBlend = DetermineEdgeBlendFactor( tex2D, texSize, luminance, edge, uv );
                float finalBlend = max( pixelBlend, edgeBlend );
                vec2 sampleUV = uv;
                if ( edge.isHorizontal ) sampleUV.y += edge.pixelStep * finalBlend;
                else sampleUV.x += edge.pixelStep * finalBlend;
                result = Sample( tex2D, sampleUV );
            }
            return result;
        }
`;

export const FXAAShader={
  ...vendorFXAA,
  name:'RoadsterStableFXAA',
  uniforms:{tDiffuse:{value:null},resolution:{value:vendorFXAA.uniforms.resolution.value.clone()}},
  fragmentShader:(vendorFXAA.fragmentShader.slice(0,begin)+apply+vendorFXAA.fragmentShader.slice(end))
    .replace(sample,'return textureLod( tex2D, uv, 0.0 );'),
};
