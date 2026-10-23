# Roadster Flight Lab · 3.23

Drive through the city, experiment with cold-gas flight, and replay what happened.

[Drive](https://windscode.github.io/roadster-flight-lab/) · [Wind laboratory](https://windscode.github.io/roadster-flight-lab/?view=lab) · [Vehicle inspection](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html) · [中文](README.md)

An independent, medium-scale vehicle and automatic-control research project. Public Roadster references inform the model; unavailable specifications remain engineering assumptions. The long-term tracks are consistent vehicle physics, detailed vehicle presentation, a continuous atmospheric city, and useful experiments/challenges.

3.23 continues local 3.22 with shared X/U path headroom estimates, honest collision-abort results, shadows that follow actual articulated casting geometry, and protected resource-route summaries. Storage failures preserve all unsaved session runs and appear in the driving completion notice. Exact Git bytes are preserved across Windows checkouts. X retains its 1.5-second turn reference and physical actuator limits. The headroom estimate is conservative and can reject feasible near-bridge maneuvers.

3.22 fixes held gamepad axes resuming after menus, browser shortcut leakage, duplicate night-light assignments and stale relit headlight shadows. Cockpit steering follows measured front-wheel state; brake lamps survive headlamp changes. Experiment summaries separate net battery use, delivery and regeneration, and opposing drive torque has an explicit unrecovered heat channel.

3.21 adds actual-work regenerative braking and a bounded battery ledger; shared keyboard/touch/gamepad actions with remapping and calibration; a 302.5 m finite-resource route; and comparable run summaries with full input replay. A 120 Wh initial budget represents a near-empty 200 kWh pack, not a real vehicle range claim. Only successful runs with matching build, conditions and full initial state are compared.

Open Input & gamepad settings from the menu/help. For the route, pause, open the map, choose the run mode, prepare, then Drive and record. Export recent resource summaries or open Inputs / replay for the complete experiment.

```bash
npm start
npm run model:build
npm run test:release
```

Node.js 22+; production dependencies are vendored. `ROADSTER_PORT` selects a local port. DOM tests require an existing JSDOM path via `JSDOM_MODULE_PATH`. The historical full validation command has separate archive requirements.

[Release scope](docs/release-3.23.md) · [Current validation](qa/release-3.23/validation.json) · [Development priorities](docs/development-plan.md)

Evidence covers numerical dynamics, exact state/input replay, DOM lifecycle, HTTP serving and publication identity. Actual local WebGL browser checks include driving, X landing, combined inputs, day/wet-night and quality changes; these do not certify physical keyboards/gamepads, audio or universal shadow-flicker elimination. No city districts or art assets are added. Historical 3.21 records remain viewable/exportable but cannot automatically execute under the new resource schema. This is a local development candidate; the live version is identified by the website's `deployment.json`.
