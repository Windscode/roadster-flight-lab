# Development and evidence

The [project introduction](../README.md) is for playing and understanding the project. This page covers implementation, validation and the existing GitHub Pages delivery path.

## Local development

Use Node.js 22 or newer. `npm start` serves `dist/` on port 8080; edit the source modules there and refresh. Dependencies such as Three.js and cannon-es are vendored. Do not run the application as a `file://` URL: ES modules and research workers need HTTP. No package installation or bundler is needed.

Large reviewed binary assets and complete curve evidence are stored as lossless gzip segments in [`repository-payloads/`](../repository-payloads/README.md). Local serving, validation and Pages preparation restore the original paths and verify their content hashes. Runtime rendering uses the same original bytes. Restoration preserves local edits; publication rejects a mismatch until the edited payload has been reviewed and repacked.

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
- `qa/` retains earlier release reports. Legacy test filenames name the feature's introduction; `scripts/qa-report-version.mjs` sends each new run to the current model's report filename, preserving the earlier bytes. A report whose source hashes do not match this build must never be cited as current release acceptance.

The 3.11 dynamics gate compares the retained 3.10 source against the current solver with 30 stated road protocols and 14 flight cases. It records 120 Hz extrema and 20 Hz curves, with actual speed, wheel load, tire slip, force usage, quaternion, angular speed and delivered nozzle force. These deterministic cases do not establish human steering feel. `npm test` and `npm run validate` now run the same complete numerical/integration gate.

To include the optional interface and compiler checks in that run, supply paths to tools that are already installed:

```sh
JSDOM_MODULE_PATH=/absolute/path/to/jsdom/lib/api.js \
GLSLANG_VALIDATOR=/absolute/path/to/glslangValidator \
npm run validate
```

The compiler reports exact passes separately from the documented temporary-input normalization of the stock Three `average` identifier. Production vendor code is unchanged. Raw 3.11 curve JSON and its plotting script are retained; `python scripts/plot-dynamics-3.11.py` regenerates the numerical figures when matplotlib is available.

The 3.12 gates add matched service-braking ablations, a continuous pedal handoff and passive wheel-work ledger, camera transport, moving-source reflection invalidation, and sixteen ordinary-G recovery samples. Grid results preserve failed/missing cells and never interpolate a safe minimum height.

For exact commands and measured outcomes, see [3.12 release evidence](release-3.12.md), [corner braking](braking-controls-3.12.md), [reflection stability](reflection-stability-3.12.md), [chase-camera kinematics](chase-camera-3.12.md), [3.11 release evidence](release-3.11.md), [matched driving and flight comparisons](vehicle-dynamics-3.11.md), [seeded controller protocol](research-robustness-3.11.md), [continuous capture protocols](control-capture-3.11.md), [physical assumptions and results](../dist/physics-3.9-notes.md), and the release-specific JSON reports under `qa/`.

## Actual graphics acceptance

The graphics panel supports fixed route cameras and a ZIP containing an original rendered PNG with conditions captured synchronously from that frame. Test clear day and wet night at the same model state, camera, focal length, device, browser, resolution, quality and exposure settings. Compare the immutable 3.9 commit `6083bbf0e01f4eef5447f2c1b951d8b41e691f46` with the current release. The vehicle studio defaults to the frozen 3.9 vehicle under the same 50 mm camera and lighting; its capture ZIP preserves both original rendered PNGs, a separately annotated comparison and their same-frame conditions. Frozen 3.8 remains available as an older reference. Standalone conditions exports are explicitly unbound to a frame.

Capture five active seconds of warm-up followed by 30 seconds or the 150-second route. Export rAF p50/p95/p99, long frames, CPU stages and GPU timings where supported. Retain resolution-governor changes and separate menu/pause/loading from steady driving. A reduced draw-call count, a DOM canvas facade or offline shader compilation cannot substitute for these observations.

The user’s computer supplied actual WebGL 3.9 city and vehicle images, which were retrieved and inspected for 3.10. The development cloud browser has no usable WebGL; this is a separate environment limitation, not evidence of a website rendering fault. Matched current-release after-images, motion and route GPU timings remain pending. Use the [current graphics protocol](visual-3.12.md) and [inherited isolation and light-field handoff](visual-3.11.md) alongside the [original same-frame conditions](visual-evidence-3.10.md); keep paused preview, loading, warmup and steady driving separate. The cloud browser can validate the same-page numerical UI and exports, not current 3D pixels or driving feel.

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

### 验证输出与当前环境

3.11 完整整合命令的实际退出码、模型构建身份、先前失败与最终运行证据保存在 `qa/validation-final-run-3.11.json`；3.12 的独立最终运行记录使用 `qa/validation-final-run-3.12.json`。本次开发环境的 Node 管道捕获曾返回 `EPERM` 且丢失子进程输出，导致明细汇总低计数；`scripts/validate.mjs` 改用临时常规文件描述符保存 stdout/stderr，任何执行错误或非零退出仍使门禁失败。成功和退出码 7 的独立探针见 `qa/validation-subprocess-output-diagnostic-3.11.json`。该修正仅涉及报告收集，物理判据与实际调用的子测试保持原样。
