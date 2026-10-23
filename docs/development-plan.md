# Ongoing development after 3.23

The baseline is actual local source on `development/3.23`, descending directly from `5e3664e` / 3.22 and `94e5b73` / 3.21. Both delivered branches and complete Git history remain. Remote main was still `5f1ba5d` / 3.19 at the 2026-10-23 inspection. See [3.23 scope](release-3.23.md); candidate documents do not imply publication.

3.23 closes concrete gaps in maneuver collision results, path headroom, articulated shadows, resource-summary persistence and Windows validation. Actual local WebGL observations complement numerical/DOM evidence; they are bounded tests, not blanket physical-input, audio or GPU acceptance.

| Priority | Work and reason | Concrete acceptance |
| --- | --- | --- |
| 1 — flight envelope | Replace the conservative whole-path peak-height bound with a phase-dependent envelope; investigate severe contact and landing transitions | Keep forward-roof rejection; permit retained feasible 30–45 m roof cases; no force/grip inflation; contact results and five-second wheel handoff |
| 2 — driving and rendering | Repeatable complete day/wet-night route, camera turns, tier changes and matched motion capture | Fixed build/settings/resolution; p50/p95/p99 and genuine GPU timing where available; separate loading/diagnostic intervals |
| 3 — Roadster and city | Use close inspection and continuous routes to improve silhouette, wheel arches, cabin/bottom structure, street frontage and district identity | Reference proportions labelled as assumptions; state-driven articulation; continuous city retained; runtime cost at driving resolution |
| 4 — research/play | Extend existing height-controller AST, landing A/B, resource route and city-flight challenges into complete studies | Same snapshot/seed; declared gain/fault differences; complete input/resource journal; interpretable result, retry and return to live scene |
| 5 — recording resilience | Improve migration/recovery and concurrent archive semantics where needed | No silent overwrite; explicit save outcome; downloadable original evidence; proven compatibility before cross-version exact replay |

Keep original QA bytes. `.gitattributes` disables line-ending conversion because the archive contains both LF and CRLF. Runtime identity covers all JS/HTML/CSS; current evidence must identify the final build. `dist/` is editable source. Use the current release gate rather than treating missing fixtures in historical comparison scripts as current numerical failures.
