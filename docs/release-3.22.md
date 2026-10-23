# 3.22 — consistent controls, energy records and vehicle lighting

This release continues the actual local 3.21 source (`94e5b73`) on the published 3.19 history (`5f1ba5d`). It does not reconstruct the missing 3.20. Both the previously unpublished 3.21 implementation and these new changes are included in the publication.

## Changes users can try

- Open and close a menu with a gamepad throttle or lift axis held: continuous commands stay inhibited until the axes return to neutral. Discrete pause/map controls remain available. Ctrl/Meta/Alt browser shortcuts no longer leak into raw vehicle/research key handlers; Shift boost is retained.
- Drive in the cockpit: the yoke now follows actual steering telemetry through quality and display changes. The authored 12:1 display ratio and ±0.49 rad road-wheel clamp are presentation assumptions, not measured Tesla specifications. Three material batches articulate independently; the balanced exterior keeps the cabin hidden.
- Change headlamp mode while braking: active brake lamps remain on. Turn headlights off, move, stop and relight: the shadow camera refreshes immediately. Quality changes release inactive street-light assignments and retain both outgoing/incoming assignments during crossfades, preventing duplicated fixtures without removing shadows or increasing the light budget.
- Record a braking experiment and compare/replay it: the table now separates signed net battery use, battery delivery and recovered electricity. Negative net use means net recharge. Explicit resets are excluded; incomplete or legacy accounting is labelled rather than guessed.
- Use reverse drive torque while still rolling: actual unrecovered motor-braking work is now tracked separately as `motorBrakingHeatJ` and shown in route accounting. It is not credited to battery recovery. Force, torque and traction budgets are unchanged.
- Set adhesion pressure to zero: its seal calculation stays finite and the simulator no longer resets from a 0/0 force. Returning to nonzero pressure still works.

## Evidence and scope

The current gate is [qa/release-3.22/validation.json](../qa/release-3.22/validation.json). It combines new boundary, input, lighting, vehicle and experiment tests with the existing energy, continuous-control, replay, route, local-server and publication checks. `dist/release-validation.json` is its public runtime copy. Original 3.19/3.21 reports retain their identities.

Concrete counterexamples include 2 seconds of braking that adds 8.225625 Wh to the battery: the old recorder reported positive use of 0.026735 Wh; the new net summary matches the battery. Opposing torque braking from 54 to about 34.2 km/h over one second now accounts for about 142.253 kJ of unrecovered motor work. Wheel-only energy checks retain a measured sub-millijoule discretization residual when friction braking overlaps a zero-speed reversal; this is not a whole-world energy-conservation certificate.

Lighting evidence records duplicate fixture selection and a relit headlight shadow-camera error of 6 m before the fixes, then unique assignments and zero camera error after. These are scene-graph/depth-update tests. This environment has no usable browser executable; the attempted browser download did not produce a valid archive. No WebGL pixel quality, shadow-flicker elimination, hardware frame-time, physical keyboard/gamepad or audio acceptance is claimed. Historical X/G/W+E+1 cases remain bounded solver/input regressions, not proof that every user's session is fixed.

The old `physics-controls-3.9` battery equality fails identically on the unchanged local 3.21 baseline because it omits regeneration. It is not counted as a passing 3.22 test or silently rewritten. The current energy gate uses the actual charge/discharge ledger.

## Record compatibility and remaining work

The resource ledger is now `roadster-energy-ledger-2`. Archived 3.21 experiments remain viewable, validatable and exportable, but exact cross-version replay and automatic 3.21 resource-state migration are unavailable. Rejected import does not alter the simulator. Record a fresh experiment under 3.22; missing historical motor-braking heat is never silently filled in as measured zero.

Next work should prioritize a real-device dry-day/wet-night route with continuous motion, camera turns and quality switches, then severe-contact/manual-flip counterexamples, suspension and tyre transitions, continuous district/skyline quality, and useful controller/landing comparisons. This release improves all four tracks in a bounded way; it does not add new districts, art assets or claim industrial vehicle fidelity.

## Publication

All development and tests run in a separate local Git worktree. Source/build identities and committed-byte Pages preparation precede publication. GitHub receives batched final objects, not repeated source-file inspection. The existing Pages workflow and permission scopes are retained, and the remote branch advances normally without rewriting its history. If the connector creates different commit identities, the original local SHAs and corresponding publication SHAs are recorded explicitly. The live `deployment.json` identifies the actual deployed commit and tree.
