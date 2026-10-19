# 3.9 — continuous streets, exterior reconstruction and honest visual evidence

本轮把道路边界、连续步道、真实灯具、沿街门廊、路面尺度和 Roadster 的车尾/曲面/材质作为整体修改。下文明确区分**实际实现与结构验证**、**等待真实图形设备验收的画面和帧时间**。云端浏览器报告 `GL_VENDOR/GL_RENDERER = Disabled`；因此本轮没有可诚实发表的城市前后截图或 GPU 帧时间，不把环境限制写成网站渲染故障。

## What was insufficient in 3.8

The previous specific frontage treatment addressed eight `market-front` facades on Weave Street. Most of the 1,135 m loop still used the general city kit. The default clear-day/balanced view also had neither the high/ultra planar wet reflection nor the local vehicle reflection capture. Adding those optional lighting paths alone did little to alter the dominant daytime street image. That is an implementation and design limitation, not evidence that a visitor chose the wrong setting.

## Changes present in the new scene

- **Complete road edges on the three connector legs.** Crosstown, south Foundry Avenue and South Bank Link now have paired 3 m footways, mineral curb faces, drainage strips, sparse cabinets and seats, and fixtures that define the pedestrian/road boundary. Six footways and their fixtures use 150 explicit shared rendering/contact solids. Every new solid clears the entire canonical carriageway, including the junction approaches. The original road centerlines, buildings, other districts and elevated routes remain.
- **Correct Weave road markings.** The canonical carriageway is 10 m wide. Former edge paint at ±8.45 m sat on its footways; it now lies at ±4.70 m, inside the actual curb. Crossings, loading edges and drains follow the same width. Arrow geometry uses its actual endpoint direction.
- **Street-facing architecture.** Forty faces addressing the route receive a readable lower-storey order: tiled or mineral plinths, deep portal returns, thicker corner piers and first-storey cornices. Upper layers extend that order through paired-storey piers and differentiated opaque window panels. Materials vary across market, canal, civic and working-street families. The original eight curated Weave faces remain. There are no added rooms or crowds.
- **Finite, functional night lights.** The 44 new road fixtures have visible lenses and directional targets on the road. Forty doorway anchors point outside their building envelopes toward the adjacent footway. At least one available road light keeps a slot when doorway lights compete. Existing balanced/high/ultra pools remain capped at 2/3/4 local lights and 1/2/2 headlamps; selected lights cast shadows and fade before relocation. The 389 warm window panels are sealed facade surfaces, not fictitious interior imagery.
- **Metric road and paving finishes.** The asphalt retains its scanned 4 m grain, with larger repair patches, joints and tyre tracks aligned to the authored ground roads. Elevated surfaces do not inherit ground-level tyre tracks. The 0.60 m paving joints use derivative filtering; neither surface displaces collision geometry. Wetness changes spatial roughness, normal response and reflection weight. The planar sample replaces the overlapping environment-specular contribution instead of adding the two reflections together.
- **Coherent presentation settings.** Revised day/night exposure, fog, environment strength and restrained emissive levels work with those surface differences. Daytime shade adaptation is capped at a lower exposure. These are authored settings awaiting pixel inspection on graphics hardware, not a claim of measured photometric calibration.
- **Roadster exterior.** The rear valance is visibly darker below the thin red lamp band, with painted corner returns rather than a broad painted lower apron. Shoulder and canopy profiles, concave lower-door surfacing and front cowl landing were adjusted. Five wheel sectors now have a shallow dished face and folded return. Satin silver clearcoat, neutral smoked glazing, wheel contrast, rubber roughness and toned lamp lenses replace excessively bright or flat material responses. Balanced mode retains the car-paint coating while continuing to use its lower geometry and shadow budget.

### Photo sources and assumptions

Sources actually opened or downloaded for this revision:

- [Tesla Roadster official product page](https://www.tesla.com/roadster)
- [Official side profile](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-02-Pilot-Desktop.jpg)
- [Official front image](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-1-Desktop.jpg)
- [Official rear detail](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-2-Desktop.jpg)
- [Official canopy/upper body image](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-3-Desktop.jpg)
- [Official front quarter](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-08-End-Desktop.jpg)

These images support exterior form, relative contour and visible finish choices. They do not supply OEM CAD, exact camera intrinsics, wheelbase/track measurements, hidden duct construction, material BRDF measurements or aerodynamic/thrust calibration. The retained 2.84 m wheelbase, 1.78 m track and 0.372 m tyre radius are simulation assumptions. No unsupported launch month or internal calibration is attributed to Tesla.

## Wet-reflection distance correction

The old code set `virtual.far = 400` and subsequently copied a main-camera projection built for 2,300 m. The far property did not enforce the claimed projection budget.

The new pass copies lens settings, then rebuilds the perspective projection with a 400 m far limit **before** applying the oblique ground-plane clip. Zoom, film offset, sub-view settings and the original camera are preserved. World camera orientation, including roll, is mirrored consistently. A separate conservative radius check also hides meshes and instanced batches whose complete bounding sphere is beyond 400 m, without reviving objects hidden by general city culling. Visibility and render state are restored even after a failed pass.

A batch whose bound crosses the 400 m radius is retained. Oblique clipping changes the near/far plane shape, so this is a bounded base lens plus conservative batch culling, not a promise that every submitted instance or fragment is individually clipped to a perfect sphere. High still uses 512×288 at at most 12 captures/s; ultra uses 768×432 at at most 20 captures/s; balanced performs no planar pass. Actual GPU savings are unmeasured.

## Evidence and remaining image-quality gate

The following are **structural** evidence, not rendered image-quality or FPS evidence:

| Contract | Result / artifact |
|---|---|
| Original whole-city subset | Its canonical geometry hash still exactly matches the original city and diffuse-light bake. The 150 new entities are identified individually and verified against their shared plan. |
| Full street support | Existing 4,254 road/support samples and all elevated routes pass; 114 buildings and all three districts remain. `qa/city-architecture-3.9.json` |
| Corridor and reflection | Complete carriageway clearance, 400 m base projection, 50/600 m mesh fixtures, far instanced batches, failed-pass state restoration, and low-camera heading/pitch/roll plane clipping pass. `qa/visual-corridor-3.9.json` |
| Vehicle motion envelope | Minimum sampled tyre-to-liner clearance 17.69 mm and tyre-to-roof clearance 16.47 mm across the established 0.24–0.41 m suspension and ±0.49 rad steering envelope. `qa/vehicle-geometry-3.9.json` |
| Retained geometry budget | In the existing balanced Weave fixture, city submissions change from 279 / 455,356 to 287 / 479,416 draws/triangles. Balanced car geometry changes from 74 / 49,847 to 74 / 50,595. These increases buy authored street/exterior work; they are not presented as a speedup. `qa/render-budget-{3.8,3.9}.json`, `qa/vehicle-{3.8,3.9}-render-cost.json` |
| Shader interface | The new road/paving path is included in the existing offline GLSL matrix. Vendor `average` identifier compatibility renaming is confined to temporary compiler input and recorded. `qa/city-shaders-3.9.json` |

**Static indirect-light limitation:** the retained field was baked for the exact original city subset. It has not been rebaked for the new roadside entities or the changed fine facade/road finishes. New geometry affects real-time direct-light shadows, but its fine indirect bounce contribution remains approximate. The checks retain the historical geometry assertion for the original subset and list the additions; they do not silently label the field as current full-world lighting.

Real WebGL rendering must still assess highlight continuity, exposure, curb contact shadows, glass reflections, wet-road reflection stability, light leaking, shimmer, driving feel, and p50/p95/p99 frame times. No actual 3D screenshot or display/GPU timing was obtained in the available graphics-disabled cloud browser. The desired high-quality city appearance and smoothness are **not signed off** by these reports; no “AAA achieved” conclusion is made.

## Repeatable actual capture

### Car: directly comparable pair in the product

Open [the vehicle inspection page](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html). Select a fixed 50 mm view and studio/daylight lighting, set suspension, steering, wing and detail, then use **Export matching 3.8 / 3.9 PNG**. The application freezes those conditions and copies two real WebGL frames side by side. It does not generate concept art. The JSON export records the camera, drawing-buffer size, physical wing state, build and geometry identity.

The lazily loaded reference keeps the actual original 3.8 body/material source. Reversing its sole import-path redirection gives SHA-256 `3f532f879f1a86af187a7f89a8f860de61175bdef27d78a783e2ba7fb62763f7`, from commit `a25b228a6d56f358cba24106ce897e1cb5c99bc1`. Both models use the **current identical light rig**, not two different renderer pipelines. Six existing fixed views remain, with front-lamp and rear-wheel close views added. Near inspection and driving geometry budgets use camera screen occupancy.

### City: preserve the whole old scene when comparing

Use a separate untouched checkout of the original commit for the before image. Do not feed old rendering modules the new shared city plan and call that the original city. `CITY_VISUAL_CAPTURE_PROTOCOL` and the main camera JSON export define:

1. The original five fixed route cameras, 48° vertical FOV, identical position/target and paused vehicle state.
2. A 1600×900 drawing buffer at pixel ratio 1, the same quality and weather. For a geometry/material comparison, lock both exposures to the original preset: day 0.90 or night 1.08. Capture revised automatic exposure separately.
3. The original 1,135 m Weave–Crosstown–Foundry–South Bank loop. The two new connector views are additional views, not substituted baselines.
4. A recorded browser/device/GPU, a separate 5 s active warmup and 150 s driven capture. Save the actual input/trajectory record with the display/CPU/GPU measurements; a freehand repeat of the route is not an identical input sequence. Keep loading, warmup, steady frames and long frames distinct.

Follow-up visual work should begin with that actual hardware comparison, then target the observed exposure/contact/reflection defects and the most visible scene discontinuities. The project still uses a medium-budget browser renderer, sparse static diffuse probes, a small light pool and bounded raster reflections; it does not implement the full lighting or asset pipeline of a large commercial game.
