# Development after 1.1

The first product release continues 3.24 `6d55c5f`, 3.23 `bb2fd93`, 3.22 `5e3664e` and 3.21 `94e5b73`. The 3.x numbers describe pre-release iterations. Preserve their branches, exact bytes and historical evidence. [1.0 scope and audit](release-1.0.md) distinguishes shipped behavior from approximations; the live `deployment.json` identifies publication.

1.0 closes the known low-gravity roof-screening gap, compares full portable initial states, explicitly recomputes compatible 3.24 records, rounds the front body transition, stabilizes night-light shader counts, serializes reflection/material preparation, and connects existing routes and remapped controls to the home experience. Do not repeat these features as new work.

1.1 continues the published 1.0 commit `88ddb11`. It corrects ambient-pressure actuator limits and depleted electrical supply, budgets power during landing estimates, closes measured front-body gaps, bounds and completes shader/resource preparation, protects concurrent experiment archives and makes individual analyses accessible. [The 1.1 audit](release-1.1.md) records concrete counterexamples and boundaries. Preserve the full city and its shared physical/recording contracts; these changes do not add city districts or certify industrial accuracy.

| Next priority | Reason and acceptance |
| --- | --- |
| Extend validated automatic-maneuver domains | Finite gas, wind and nondefault models currently require an open overhead corridor for automatic maneuvers. Establish measured parameter families with close/late roofs, disturbances and resource exhaustion before relaxing guards; keep actuator and grip limits. |
| Broaden rendering acceptance | Repeat retained day/night route inputs on other GPUs and screen sizes; include cockpit/camera turns, quality changes and long sessions. Keep load/preparation time separate from active frame distributions and retain all long frames. |
| Vehicle proportions and materials | Continue canopy, front/side relationship, arches, cabin and underside from verified public references. Matched inspection/chase views, declared assumptions and bounded draw/texture cost are required. |
| District identity | Develop coherent shop functions, materials, furniture and transitions around the full existing road network. Preserve driveable widths, consistent collision, performance and daytime readability. |
| Research depth | Expand identification and robustness tasks using the same physics, input and record contracts. Preserve exact provenance, migration boundaries and meaningful paired comparisons. |
| Lifecycle before hot reload | Cached city/lab switching is supported; independent scene recreation needs complete geometry, instance-buffer, texture, light and listener disposal before becoming a feature. |

Runtime source lives in `dist/`. Never replace it with stale remote files or normalize archived LF/CRLF bytes. Rebuild source identity, run the current release gate including DOM, check static publication, commit intended files, stage fresh Pages output, push normally and verify the live identity.
