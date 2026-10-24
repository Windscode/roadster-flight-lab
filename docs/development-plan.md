# Ongoing development after 3.24

The current local source descends from 3.23 `bb2fd93`, 3.22 `5e3664e` and 3.21 `94e5b73`. Original branches and historical evidence remain. [3.24 scope](release-3.24.md) describes the actual changed behavior and limits; a local candidate is not a live deployment.

| Priority | Work and reason | Concrete acceptance |
| --- | --- | --- |
| 1 — usable flight envelope | Extend the default-only phase estimate to finite gas and validated parameter families without an expanding exception whitelist | Reproduce close/late roofs, delayed observations, wind, slopes and contact recovery; reject unsupported claims; unchanged actuator/grip limits |
| 2 — repeatable driving and rendering | Investigate the retained 697 ms reflection-stage hitch, then extend real WebGL checks to complete 150 s day/wet-night loops, camera turns and quality changes | Fixed build/settings/resolution; p50/p95/p99 and actual GPU timing; retain input/trajectory; separate loading, menus and diagnostic frames |
| 3 — vehicle form | Improve the overall front/side/canopy relationship, wheel arches, underside and cabin visibility after the rear-quarter closure | Matched actual inspection and chase views; labelled reference assumptions; state-driven articulation and stable budgets |
| 4 — city character | Develop coherent materials, shop functions, street furniture and district transitions around the retained full road network | Legible streets while driving; day/night contrast; bounded draw/texture/memory cost; geometry consistent with collision |
| 5 — research continuity | Expand cross-environment record checks and controller comparisons with explicit error attribution | Preserve original identity and inputs; do not silently relax reproduction tolerances; mismatch rejection leaves the live scene and recording intact |
| 6 — lifecycle | Complete disposal before introducing city hot reload or repeated independent world instances | Release mesh instance buffers, geometry, maps, lights and listeners; repeated cycles return to steady resource counts |

Retain the existing height-controller AST, landing A/B, wind studies, finite-resource route and city-flight tasks. Build complete experiments on shared physics/input/resource/recording rather than adding disconnected entrances. Keep original QA bytes and exact committed LF/CRLF conventions. `dist/` is editable source.
