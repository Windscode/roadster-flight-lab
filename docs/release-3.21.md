# 3.21 — resources, input and repeatable route runs

This is substantive development on the publicly recovered 3.19 source, not recovery of missing 3.20. Remote baseline: `5f1ba5dcbff0180abda1b7fb0e4782fd30f549fe`. Recovered stage2 head: `fb55a55a0ee7acd8eeb149cbde87e29212d5995e`; its `6060160` energy and `fb55a55` input/route changes were applied onto the published repository without removing history, workflow, assets or previous reports. Alternative stage1 head `4e0f2e721e170151e49c180880ebce494a5c4bdd` remains locally preserved and was reviewed; its competing energy/input schema was not mixed into stage2.

## User-visible behavior

Regenerative braking derives recovered electricity from actual passive wheel work, bounded by motor/generator power, battery charge acceptance, SOC taper, available capacity and efficiency. Friction compensation preserves requested braking when charge is unavailable. Motor loss, fan/auxiliary use, recovered work, conversion loss, friction braking, rolling resistance and tire slip have distinct fields. This is a reduced battery-terminal and wheel-work model, not a full thermal/electrochemical model or a whole-world energy certificate.

Input & gamepad settings provides saved bindings and explicit two-stage calibration. First connection and device changes require neutral input. Button hysteresis prevents repeated discrete actions while a trigger crosses the threshold. Pause, blur, settings and disconnect release authority; keyboard/touch aliases cannot cancel another held source. Research number keys and browser control keys are reserved. Release receipts retain the accepted keys that were actually cleared.

The existing mapped street now supports finite resources or practice. The finite task starts with 120 Wh usable energy in a 200 kWh pack and a 100 bar / 600 L gas tank; stop within 65 seconds with 5 Wh and 5 kg remaining. These are authored scenario budgets. Completed runs show time/electricity/gas/recovery differences only against another valid run with the same build, parameters, route and complete initial physical state. Preparation resets Cannon clocks as well as pose, so earlier driving does not silently change initial conditions. Failed runs remain visible and exportable. Summary export is separate from the full fixed-step experiment record.

## New defects fixed after stage2

- Settle a slice's battery ledger before capturing an in-step safety failure. Previously the reset could null the slice and crash; its failure snapshot also had a stale ledger and could not be restored.
- Preserve resource results from the captured failure terminal state; if a nonfinite failure lacks a complete terminal snapshot, label the last measured valid sample rather than using the reset car.
- Preserve physical reference state during diagnostic capture when input is released by blur/visibility.
- Remove rolling-resistance work from friction-brake heat without changing the applied mechanical braking.
- Guard first-connected/non-neutral pads, analog button hysteresis and mixed-source release ownership.
- Apply route configuration to the actual city simulator after scene switching; reject changed paused initial state and reset complete preparation bookkeeping.
- Stop only the route's own recording; ending/switching recording in another panel does not end an unrelated new record.
- Surface summary persistence failure and provide an export path; do not silently claim saving succeeded.
- Fresh Git checkout starts without a missing historical archive contract. Release preparation verifies current source and committed bytes independently from immutable 3.19 recovery evidence.

## Acceptance and limits

See [current release gate](../qa/release-3.21/validation.json), [energy cases](../qa/resource-3.21/energy.json), [route DOM lifecycle](../qa/resource-3.21/dom-lifecycle.json), [control feedback](../qa/controls-3.21/summary.json), and [replay regression](../qa/experiment-records-3.21.json). The gate reports each command and source identity; absent DOM support is explicitly marked. Historical `dist/validation.json` is retained as historical evidence and is not this release's acceptance report.

Bounded continuous controls passed: X benchmark rotation about 1.51 s, peak CG height 3.90 m (rise 3.30 m), four-wheel completion at 3.94 s, followed by five seconds of four-wheel support and zero requested jet force. Moving/slope/G transition cases also passed. W+E+1 retains all three requests. These cases do not reproduce the user's exact historical hardware/session; no universal defect-free claim is made. G level stabilization and explicit H/E flight assistance remain distinct commands.

The environment lacked usable WebGL. No new shadow, model, city pixels, native keyboard/gamepad, audible output or hardware-frame-time acceptance is claimed. Current screenshots from older releases retain their original source labels. This round does not add city/model art. Severe-contact fidelity, manual full flips close to the ground and actual-device rendering remain development priorities.

## Release identity

All executable JS/HTML/CSS contribute to `model-build.js`. `npm run test:release` is the current bounded gate. `check-static.mjs` checks runtime imports and source identities; after commit, `prepare-pages.mjs` requires matching Git blobs. The existing Pages workflow generates `deployment.json` from its actual source commit/tree and publishes the current evidence list. Source identity changes from the recovered independent-stage commits are explicit; no original author/date/SHA is fabricated.
