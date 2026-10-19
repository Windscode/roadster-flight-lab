# Development and evidence

The [project introduction](../README.md) is for playing and understanding the project. This page covers implementation, validation and the existing GitHub Pages delivery path.

## Local development

Use Node.js 22 or newer. `npm start` serves `dist/` on port 8080; edit the source modules there and refresh. Dependencies such as Three.js and cannon-es are vendored. Do not run the application as a `file://` URL: ES modules and research workers need HTTP. No package installation or bundler is needed.

## Shared simulation and data contracts

| Area | Main source |
|---|---|
| Rigid body, contact, force application, modes | `dist/physics.js` |
| Independent wheels, slip and wheel-work accounting | `dist/tire-dynamics.js` |
| Shared physical assumptions and steering reference | `dist/vehicle-models.js` |
| Snapshot schema and strict continuation state | `dist/simulation-snapshot.js` |
| Observations, seeded noise and delay | `dist/control-observation.js` |
| Input journal, original replay, explicit recompute and A/B | `dist/experiment-records.js` |
| Reproduction tolerances and first-divergence verdict | `dist/experiment-reproduction.js` |
| Standard protocol, executor and historical reports | `dist/research-protocol.js`, `dist/experiment-worker.js`, `dist/research-study.js` |
| Application shell, live renderer and shared scene switching | `dist/app-shell.js`, `dist/main.js` |
| Canonical city roads, solids and corridor plan | `dist/city-plan.js`, `dist/city-corridor-plan.js` |
| Vehicle geometry and studio | `dist/vehicle.js`, `dist/vehicle-inspection.js` |
| Render presets and measured performance | `dist/render-profiles.js`, `dist/performance-meter.js` |
| Display-only Chinese / English copy | `dist/i18n.js`, `dist/i18n-*-en.js` |

The fixed physics loop is independent of rAF display frequency. Snapshot replay feeds recorded effective driver inputs and public commands back to the declared solver; actuator decisions are recalculated. Controller A/B fixes the initial conditions and input journal while changing declared gains, so it is not an exact-output reproduction test.

Locale must never rewrite raw state, protocol fields, stored user names or identities. DOM translation tracks source copy for reversible switching. Canvas labels use the same presentation catalog. `data-no-i18n` marks raw records and user-supplied content. The vertical-speed preference affects a new session; loading an experimental snapshot retains the speed parameter recorded in that snapshot. A live slider edit goes through the public `setParam` API and is journaled.

## Validation is separated by what it can establish

- `npm run validate` runs numerical, geometric, budget and integration gates and writes a source-identified report to `dist/validation.json`.
- `tests/physics-controls-3.9.test.mjs` compares the unchanged 3.8 torque-budget fixture, handling/recovery and 3.9 commands. Historical 0.9 g / 1.5 m/s tests explicitly retain their old input references; their numerical thresholds were not broadened for the new defaults.
- Optional DOM checks under `qa/` require an existing JSDOM installation. `qa/same-page-ui-check.mjs` uses actual application and physical modules with declared graphics facades; `--graphics-unavailable` covers initialization failure. These are not browser, pixel or FPS tests.
- Offline GLSL checks require an existing `glslangValidator`. They establish syntax/interface compatibility only, not driver behavior, framebuffer correctness or visual quality.
- `qa/` retains earlier release reports. A report whose source hashes do not match this build must never be cited as current release acceptance.

For exact commands and measured outcomes, see [3.9 release evidence](../3.9-UPDATE-NOTES.md), [physical assumptions and results](../dist/physics-3.9-notes.md), and the release-specific JSON reports under `qa/`.

## Actual graphics acceptance

The graphics panel supports fixed route cameras, PNG capture and conditions JSON. Test clear day and wet night at the same model state, camera, focal length, device, browser, resolution, quality and exposure settings. Compare the immutable 3.8 commit `a25b228a6d56f358cba24106ce897e1cb5c99bc1` with the current release. The vehicle studio also loads the frozen 3.8 vehicle under the same studio lighting for paired image capture on a graphics-capable device.

Capture five active seconds of warm-up followed by 30 seconds or the 150-second route. Export rAF p50/p95/p99, long frames, CPU stages and GPU timings where supported. Retain resolution-governor changes and separate menu/pause/loading from steady driving. A reduced draw-call count, a DOM canvas facade or offline shader compilation cannot substitute for these observations.

This release’s cloud browser reports `GL_VENDOR=Disabled / GL_RENDERER=Disabled`. That is an environment limitation, not evidence of a website renderer regression. The available browser can validate the same-page numerical UI and exports; it cannot accept the 3D visuals or driving.

## Existing Pages delivery

The repository uses its GitHub Actions Pages workflow. Prepare the static artifact with `node scripts/prepare-pages.mjs`, using a fresh staging directory. The preparation copies the application, source metadata and publication identity; it does not upload private records.

Before publication, update the model version, regenerate `dist/model-build.js`, complete required checks and inspect the diff. Commit to this repository through a non-forced update based on the verified current `main`. After publication verify:

1. The remote source commit and tree are the intended ones.
2. The build and deploy jobs completed successfully.
3. The live `deployment.json` names that source commit and tree.
4. Critical published application modules match the committed bytes.
5. The actual hosted page reports the new model identity and usable entries.

Do not use a previous release’s successful deployment as evidence for a new one. The dated release notes and validation hashes document what was and was not accepted.

## Historical development notes

[3.8 notes](../3.8-UPDATE-NOTES.md), [3.7 notes](../3.7-UPDATE-NOTES.md), [3.6 notes](../3.6-UPDATE-NOTES.md), [3.5 notes](../3.5-UPDATE-NOTES.md), and the [archived 3.8 README](history/README-3.8.md) preserve earlier architecture, tuning and release context. The archived instructions describe their own release.
