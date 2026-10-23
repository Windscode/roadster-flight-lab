# Ongoing development after 3.21

The baseline is the actual Git source. 3.19 main was verified as `5f1ba5dcbff0180abda1b7fb0e4782fd30f549fe` at this handoff. The two 3.21 recovered packages are independent development histories; stage2 is the implemented foundation, with new lifecycle, accounting, comparison and publication fixes. No recovered 3.20 functionality is assumed.

| Priority | Work and reason | Concrete acceptance |
| --- | --- | --- |
| 1 — current release | Finish the existing regen/input/resource experience, repair actual defects and make local development reproducible | Bounded energy closure; exact continuation/replay; input release/neutral gating; successful route and honest failures; committed release identity |
| 2 — native control and rendering | Reproduce shadow flicker and historical user control failures on a real WebGL device; inspect dry day / wet night continuous motion, camera turns and quality changes | Same build/settings, continuous before/after frames; X plus five-second landing observation; physical W+E+1 events; p50/p95/p99 frame times, no fabricated GPU claim |
| 3 — physics architecture | Review contact substeps, wheel relaxation and actuator authority under mixed ground/air transitions; reduce duplication between resource wheel adapter and core | Shared invariants for total brake demand, contact/passive work, torque limits; severe-contact counterexamples retained; no grip/thrust inflation to mask failure |
| 4 — vehicle and continuous city | Use native close views and complete driving routes to select visible model/material/shadow work; distinct neighborhoods and skyline continuity | Matched reference cameras and original/experimental model identities; continuous routes across districts; quality/performance comparison at fixed resolution |
| 5 — research and replay | Extend useful controller comparison and perturbation/landing tasks from the existing recorder and challenge system | Same initial snapshot/disturbance seed, declared gain changes, complete input/resource journal, interpretable failure and return to live scene |

The four tracks remain long-term goals. This round completes a bounded control/resource slice, not all historical issues. Native GPU/keyboard/gamepad/audio evidence is still outstanding. Future changes should respond to reproduced behavior and measured constraints before new controls or modules are added.
