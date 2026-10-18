# Indirect lighting review · 3.1 baseline

Date: 2026-10-18. Scope: source audit and primary-source research only. No runtime code or media assets changed by this review. Recommendations below are implementation proposals, not measured performance or a claim of visual equivalence to Cyberpunk 2077.

## Confirmed causes and limits

- `dist/city-environment.js:updateReflections()` sets every vehicle Standard/Physical material's `envMap` to the local 256² cubemap and sets `envMapIntensity=.75`. In the shipped Three.js r180 shader, **both** `getIBLIrradiance()` (diffuse) and `getIBLRadiance()` (specular, including clearcoat) sample this material map. Thus a reflection capture also replaces the vehicle's sky diffuse illumination. The rest of the city still uses sky IBL at scene intensity `.80`. A low probe surrounded by dark road and walls has a much darker diffuse convolution than the sky. This is a verified coupling, and a plausible large contributor to the reported black white paint; its pixel-level contribution still requires an A/B render.
- A local diffuse capture is not intrinsically wrong: real enclosure should reduce sky visibility. The missing element is an adequately solved spatial indirect field with wall/ground interreflection. Uniformly brightening the car or adding unoccluded sky diffuse to the local result would hide the issue and leak light beneath bridges.
- There is no vehicle self-feedback in the present capture: `car.group` is hidden during capture. Whole-city materials retain the stable sky IBL, so the probe is not recursively applied to the city each frame. It is, however, effectively a single capture of a scene with ambient approximations, not a converged multi-bounce solution.
- `dist/main.js` uses `SSAOPass` with an 0.85 m kernel. Its `copyMaterial` uses `DstColorFactor/ZeroFactor`, multiplying the **entire** beauty result by AO. This also dims direct highlights, clearcoat, and emissive radiance, rather than occluding diffuse indirect light alone. The shipped pass has no intensity control; changing `kernelRadius` alone does not reduce its maximum darkness.
- No AO texture is assigned to the vehicle paint. Its clearcoat/metalness settings can change appearance but do not explain a global lighting-sign error. The paint is currently white, metalness `.13`, base roughness `.23`, clearcoat `1`, coat roughness `.045`.
- The CSM shader attenuates direct directional illumination; the reviewed code does not multiply hemisphere or IBL illumination by the shadow factor. Preserve its material shader chaining and distinct cache keys. Probe rendering uses cascades aligned to the main camera, so inspect sun-shadow consistency in cubemap captures as a secondary issue.

## Recommended implementation order

1. **Decouple diffuse and specular IBL.** Continue using the local PMREM for reflection. Override only `getIBLIrradiance()` with independently evaluated world-space diffuse irradiance. First use SH projected from the existing linear HDR as the safe fallback, then substitute a baked spatial SH field. Do not also add the same SH as a scene `LightProbe`: that double counts energy. Reset local probe material intensity to a calibrated reflection value rather than using it as a diffuse brightness knob.
2. **Bake static sky visibility and interreflection offline.** The city and daytime sun are mostly fixed, making a static irradiance field economical. Use actual render geometry where possible; simplified building/bridge boxes can be a clearly labelled first approximation, but must include elevated slabs, awnings, and local wall reflectance near the car. A collision-only solver misses important visible occluders and colored bounce. Store radiance SH plus validity/visibility, not a single ambient brightness scalar.
3. **Apply spatial irradiance to static materials too.** For the car, blend eight surrounding valid probes on CPU and send nine RGB uniforms. For buildings/road, sample a compact texture/3D texture using world position in the material shader. One global Three.js `LightProbe` moves illumination for the entire scene and cannot represent individual streets.
4. **Limit AO to residual contact detail.** Correct path: evaluate half-resolution AO first, sample its texture in the beauty material, and apply it to `reflectedLight.indirectDiffuse` plus a roughness-aware specular occlusion term. Do not apply it to direct or emissive light. If that integration is out of scope, a deliberately mild beauty multiplier `1-strength*(1-AO)` with strength around `.20–.30`, kernel `.20–.35 m`, 1–2 cm self-rejection, and bilateral depth/normal-aware filtering is an explicit approximation. Keep physical tire contact shadows.
5. **Add surface detail after light transport is stable.** White paint should primarily behave as a coated dielectric; metalness `0–.05`, base roughness `.22–.30`, coat roughness `.055–.10` are useful art starting ranges, not Tesla measurements. Keep Fresnel and energy compensation. A very weak, derivative-filtered clearcoat normal/roughness variation breaks perfect plastic smoothness. Do not draw visible noise across the white albedo or use self-emission to brighten shaded paint. Geometry bevels, panel thickness, and consistent world-scale material texture improve edge response more than a stronger ambient light.

## SH and offline transport contract

Use linear radiance throughout projection and baking. For an orthonormal real SH basis through band 2:

`L_lm = integral_sphere L(w) Y_lm(w) dw`

`E(n) = sum_lm A_l L_lm Y_lm(n)`, with `A_0=pi`, `A_1=2*pi/3`, `A_2=pi/4`.

The Lambert outgoing diffuse term is `rho*E/pi`. Three.js r180's `shGetIrradianceAt()` / `SphericalHarmonics3.getIrradianceAt()` already contains this cosine convolution. Store **radiance** coefficients and do not multiply the cosine factors twice. A constant radiance test must return `E=pi*L`, independent of normal. Clamp small negative irradiance from low-order SH ringing at the final evaluation, not by clamping each coefficient. Use the exact basis order exported by Three.js.

At each probe use uniform sphere samples (Fibonacci directions or stratified cube solid angles). For uniform samples, `L_lm ~= (4*pi/N) sum_k L(w_k)*Y_lm(w_k)`. Evaluate radiance along rays:

- Miss: measured HDR sky radiance, with the direct solar disk excluded from diffuse baking if a separate directional sun already supplies direct light.
- Hit: `L_e + rho/pi * (E_sun + E_sky_visible + E_bounce)`. Test sun visibility by a shadow ray. Match renderer sun RGB and intensity, convert hit albedo to linear, and include any fixed emissive contribution deliberately.
- Use bounded paths with 2–3 diffuse surface bounces or converged Jacobi updates of a probe/radiance field; deterministic sampling and Russian roulette/energy decay prevent invented bright energy. Count bounce conventions in metadata.

Initial proposed budgets: city spacing 24–32 m, additional street probes 6–10 m, height bands around 1.5/5/12/25 m; sparse validity removes points inside buildings. Start with 128–256 rays per probe and validate against a higher-sample small reference area. Nine RGB float32 coefficients occupy 108 bytes/probe; 16,000 probes are about 1.65 MiB before visibility/metadata. These are budget proposals, not measured timings.

Use normalized trilinear weights times validity and visibility. Plain trilinear SH leaks through walls. A practical first filter rejects a probe if the query-to-probe segment crosses an opaque wall and avoids blending between ground and upper deck. A more robust distance-moment visibility interpolation follows the DDGI paper. Relocate/discard probes inside surfaces and bias the query a few centimetres along the geometric normal. On the car, blend coefficient targets over roughly `.15–.3 s`; reset immediately after teleport. Local reflection captures can crossfade over `.2–.4 s` independently, avoiding 18 m reflection jumps.

For shader integration: `getIBLIrradiance()` receives a view-space normal; transform it to world with `inverseTransformDirection(normal,viewMatrix)`. Add the SH function declaration **before** `envmap_physical_pars_fragment`: built-in `lights_pars_begin`, which declares `shGetIrradianceAt`, is included later. Preserve the custom material compile chain, CSM defines, and a new cache-key suffix. Keep SH diffuse independent of `envMapIntensity`. Disable/reduce the original hemisphere term when the baked field already includes equivalent sky/ground transport.

## Screen-space GI boundary

Screen-space indirect illumination can add nearby moving color bounce if a separate linear-radiance buffer, normal/depth data, temporal reprojection, rejection, and bilateral denoising are implemented. It cannot light an unseen street, see behind the camera, or replace offscreen sky/wall transport. Therefore make the baked world field the stable fallback; a screen-space result should replace/blend the portion it estimates, not add the full sky contribution again. A low-resolution SSGI prototype without stable history is likely to shimmer more than the current scene. This is a lower priority than fixing diffuse/specular coupling, AO composition, and world-space irradiance.

## Acceptance captures and numeric tests

- Freeze exposure, sun, camera, color, and car pose. Capture full sun, open shade, narrow street shade, bridge interior/entrance, upper deck, and upside-down poses. A/B old local diffuse vs independent sky SH vs spatial baked SH, with AO separately enabled/disabled. Include 18% grey and white diffuse reference swatches; compare linear rendered radiance rather than only tone-mapped PNG values.
- SH unit tests: constant radiance returns `pi*L`; first-order directional field rotates correctly; interpolation at a grid node returns that node; invalid probes do not enter the blend; all outputs are finite and nonnegative after evaluation. Verify sRGB albedo conversion once and HDR radiance conversion zero times.
- Bake convergence: compare one/two/three bounce irradiance and 256/1024 ray samples in a representative alley. Extra bounces should not decrease received energy for nonnegative materials under the same sampling; converged energy must not explode. Test a black sealed room and two adjacent rooms separated by an opaque wall for leakage.
- Movement: no black frame or visible pop crossing cells, 18 m reflection thresholds, ground/upper deck boundary, or teleporting. Check car, road and adjacent wall receive mutually coherent indirect color.
- AO: a sun-facing white plane must keep identical direct/emissive response when only AO changes; wheel contact and panel recesses remain legible without a black halo around the whole car.
- Performance: record CPU bake time separately from steady-state frame cost; use GPU timer query when available, and report median/95th percentile driving frame time with city and street geometry present. Local captures and their shadow work should be budgeted separately from normal frames.

## Verified primary references

- Three.js r180 environment shader (same dual diffuse/specular map coupling as the vendored build): https://raw.githubusercontent.com/mrdoob/three.js/r180/src/renderers/shaders/ShaderChunk/envmap_physical_pars_fragment.glsl.js
- Three.js r180 LightProbeGenerator (solid-angle projection, half-float readback, basis normalization): https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/lights/LightProbeGenerator.js
- Three.js r180 SSAOPass (whole beauty multiply): https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/postprocessing/SSAOPass.js
- Peter-Pike Sloan, SH overview and irradiance convolution: https://www.ppsloan.org/publications/StupidSH36.pdf
- Majercik et al., 2019 DDGI, visibility-aware irradiance interpolation: https://research.nvidia.com/publication/2019-05_dynamic-diffuse-global-illumination-ray-traced-irradiance-fields
- McGuire et al., 2017, static precomputed light field probes and visibility: https://research.nvidia.com/publication/2017-02_real-time-global-illumination-using-precomputed-light-field-probes
- Filament authors' material/lighting reference (dielectric clearcoat, separation of material/lighting, energy conservation): https://google.github.io/filament/Filament.md.html

The current scene has no full GI solver, no path tracing, and no visibility-aware irradiance volume. PMREM, CSM, SSAO, and a local cubemap together should not be described as complete global illumination or as reaching a shipped AAA title's production quality.
