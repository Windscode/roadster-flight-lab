# Roadster Flight Lab · 1.0

Drive through the city, experiment with cold-gas flight, and replay what happened.

[Drive](https://windscode.github.io/roadster-flight-lab/) · [Wind laboratory](https://windscode.github.io/roadster-flight-lab/?view=lab) · [Vehicle inspection](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html) · [中文](README.md)

An independent, medium-scale vehicle and automatic-control research project. Public Roadster references inform the model; unavailable specifications remain engineering assumptions. The long-term tracks are consistent vehicle physics, detailed vehicle presentation, a continuous atmospheric city, and useful experiments/challenges.

1.0 is the first product release; 3.x denotes earlier development iterations. It adds explicit screening outside validated maneuver conditions, complete portable initial-state comparison and opt-in 3.24 recomputation. Front body curvature, stable night-light shader counts, serialized reflection preparation, a direct challenges entry and remapping-aware guidance improve the existing experience. The complete city and shared research/physics platform remain.

3.24 wraps the rear quarters into a recessed installation surround while preserving experimental outlets, extraction ducts and wheel hard points. The existing city gains confined lighting in 210 shallow displays. A phase-dependent headroom estimate reduces late-roof refusals for validated default conditions; customized physics, observations and unsupported initial conditions retain the conservative estimate. Neither is a collision certificate. Portable scene identity handles Node/browser floating-point differences at a declared geometry quantization; real geometry/body-layout mismatches remain rejected before restoring the live scene.

3.23 introduced shared X/U path headroom estimates, honest collision-abort results, shadows that follow actual articulated casting geometry, and protected resource-route summaries. Storage failures preserve all unsaved session runs and appear in the driving completion notice. Exact Git bytes are preserved across Windows checkouts. X retains its 1.5-second turn reference and physical actuator limits.

3.22 fixes held gamepad axes resuming after menus, browser shortcut leakage, duplicate night-light assignments and stale relit headlight shadows. Cockpit steering follows measured front-wheel state; brake lamps survive headlamp changes. Experiment summaries separate net battery use, delivery and regeneration, and opposing drive torque has an explicit unrecovered heat channel.

3.21 adds actual-work regenerative braking and a bounded battery ledger; shared keyboard/touch/gamepad actions with remapping and calibration; a 302.5 m finite-resource route; and comparable run summaries with full input replay. A 120 Wh initial budget represents a near-empty 200 kWh pack, not a real vehicle range claim. Only successful runs with matching build, conditions and full initial state are compared.

Open Input & gamepad settings from the menu/help. For the route, pause, open the map, choose the run mode, prepare, then Drive and record. Export recent resource summaries or open Inputs / replay for the complete experiment.

```bash
npm start
npm run model:build
npm run test:release
```

Node.js 22+; production dependencies are vendored. `ROADSTER_PORT` selects a local port. For the complete release gate, install pinned DOM dependencies with `npm ci --prefix tests/dom --ignore-scripts`, then set `JSDOM_MODULE_PATH` to the absolute `tests/dom/node_modules/jsdom/lib/api.js` path. The historical full validation command has separate archive requirements.

[Release scope and audit](docs/release-1.0.md) · [Current validation](qa/release-1.0/validation.json) · [Browser acceptance](qa/browser-1.0/observations.json) · [Development priorities](docs/development-plan.md)

The historical 3.23 evidence covers numerical dynamics, exact state/input replay, DOM lifecycle, HTTP serving and publication identity. That release's local WebGL browser checks included driving, X landing, combined inputs, day/wet-night and quality changes; they did not certify physical keyboards/gamepads, audio or universal shadow-flicker elimination. Version 3.23 added no city districts or art assets. Current 1.0 acceptance and limitations are recorded in the [release scope](docs/release-1.0.md). Historical 3.21 records remain viewable/exportable but cannot automatically execute under the new resource schema. The website's `deployment.json` identifies the actual published build.
