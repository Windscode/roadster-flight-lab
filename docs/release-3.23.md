# 3.23 — local continuation, honest maneuvers and retained driving evidence

This local candidate continues `development/3.22` at `5e3664e`, whose direct parent is delivered 3.21 commit `94e5b73`. Complete Git objects and both original local branches remain. On 2026-10-23, read-only remote inspection still found `main` at `5f1ba5d` (3.19). No older remote tree replaced local work. This document does not claim a live deployment.

## Changes to try

- **X/U and overhead structures.** Shared, heading-aligned path samples include the initial support-plane slope. Forward roofs missed by the former start-point X check are rejected before physical state changes. X retains its 0.5 + 0.5 + 0.5 s turn reference, actuator limits and real landing dynamics.
- **A collision is not a successful flip.** First body contact during launch, rotation, landing or recovery marks X/U, and explicit L landing, incomplete. Existing landing/recovery phases keep their clocks. The HUD exposes the cause during recovery and after termination in Chinese and English. Wheel support alone is not a body strike; no pose reset or extra thrust is introduced.
- **Articulated shadows.** Actual casting geometry changes from wing, steering/suspension, skirt and LOD invalidate daylight, practical-light and laboratory shadows. Fixed joint references and cached casting participation avoid full-car traversal per frame. Hidden or non-casting motion does not force refreshes. Map sizes and light budgets are unchanged.
- **Resource-route saving.** Malformed/unknown old archives remain intact; export includes their original text. Every unsaved session result is retained, including more than six. Successful storage retains the declared six most recent summaries. Saves merge current stored summaries with this page's new results and verify the write. Conflict/quota warnings appear in the panel and driving completion notice. Full experiment records use the existing recorder.
- **Reproducible local development.** `.gitattributes` preserves exact committed bytes, including the existing line-ending mix. Windows paths in two QA entry points are corrected. Three legacy reporters now write to the running release's directory. The menu uses `MODEL_VERSION`; obsolete “battery recovery is not implemented” copy is corrected.

## Evidence

The current gate is [qa/release-3.23/validation.json](../qa/release-3.23/validation.json), with its runtime copy at `dist/release-validation.json`. It covers numerical/input/resource-route/record/replay/DOM/local-server/publication checks. Original reports and recovery manifests remain unchanged.

The original solver at 10 m/s hit a forward roof after 0.642 s and ultimately reported `completed`: see [before evidence](../qa/maneuver-clearance-3.23-before.json). New [maneuver evidence](../qa/maneuver-clearance-3.23.json) covers known-roof rejection, unforeseen collisions in all phases, exact continuation and five seconds of wheel-supported driving. Normal open-ground X remains around four seconds including launch and landing, with a CG peak below 4.5 m in the declared cases. The 1.5 s reference describes only the turn.

[Shadow evidence](../qa/rendering-3.23/vehicle-shadow-state.json) checks actual casting mesh transforms, same-frame invalidation, 120 frames of non-casting motion without refresh and 300 updates without full-car traversal. This is a scene/depth-update test, not universal flicker acceptance.

Actual local browser checks use real WebGL, separately from DOM facades. See [browser observations](../qa/browser-3.23/observations.json) for the tested build and flows. Automated browser events do not certify physical keyboard rollover, gamepads or audio perception. Short HUD FPS readings are not a standardized route benchmark.

## Limits and next work

The headroom check applies a conservative peak-height envelope along a constant-velocity path, at most five seconds / 1285 rays. It is not a swept-volume planner and cannot predict later steering, wind or moving obstacles. It can reject feasible flips: retained 10 m/s cases with roofs 30–45 m ahead would land before reaching them. The UI identifies this as a conservative estimate. A phase-dependent vehicle envelope is the next physics refinement; do not simply shorten the horizon or increase force limits.

LocalStorage merge/readback is optimistic detection, not an atomic cross-tab transaction. Protected original archives remain exportable. Cross-build exact replay remains restricted by recorded identity. No new districts, body-shell redesign, industrial fidelity, audio acceptance or full city-route performance certification is claimed.

Extend existing controller AST, landing A/B, wind studies and city-flight tasks instead of recreating their entrances. Continue using actual driving/inspection views to prioritize contact transitions, body surfaces and coherent district streetscapes.

## Recovery and publication

Redundant delivery files outside the project were deleted only after `git fsck --full`, full bundle verification, both branch-tip checks, and verifying a non-shallow object pack with no alternates. The [cleanup receipt](../qa/local-recovery-3.23.json) records 994,000,412 removed bytes. The project and assets remain.

Use `npm start`; production dependencies are vendored. Generate model identity, run the gate/static checks, commit source/evidence, then prepare a fresh `.pages-site` with `node scripts/prepare-pages.mjs`. The original Pages workflow and permissions remain intact. Local preparation does not update GitHub or Pages.
