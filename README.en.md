# Roadster Flight Lab · 3.21

Drive through the city, experiment with cold-gas flight, and replay what happened.

[Drive](https://windscode.github.io/roadster-flight-lab/) · [Wind laboratory](https://windscode.github.io/roadster-flight-lab/?view=lab) · [Vehicle inspection](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html) · [中文](README.md)

An independent, medium-scale vehicle and automatic-control research project. Public Roadster references inform the model; unavailable specifications remain engineering assumptions. The long-term tracks are consistent vehicle physics, detailed vehicle presentation, a continuous atmospheric city, and useful experiments/challenges.

3.21 adds actual-work regenerative braking and a bounded battery ledger; shared keyboard/touch/gamepad actions with remapping and calibration; a 302.5 m finite-resource route; and comparable run summaries with full input replay. A 120 Wh initial budget represents a near-empty 200 kWh pack, not a real vehicle range claim. Only successful runs with matching build, conditions and full initial state are compared.

Open Input & gamepad settings from the menu/help. For the route, pause, open the map, choose the run mode, prepare, then Drive and record. Export recent resource summaries or open Inputs / replay for the complete experiment.

```bash
npm start
npm run model:build
npm run test:release
```

Node.js 22+; production dependencies are vendored. `ROADSTER_PORT` selects a local port. DOM tests require an existing JSDOM path via `JSDOM_MODULE_PATH`. The historical full validation command has separate archive requirements.

[Release scope](docs/release-3.21.md) · [Current validation](qa/release-3.21/validation.json) · [Development priorities](docs/development-plan.md)

Current evidence covers numerical dynamics, exact state/input replay, DOM lifecycle, HTTP serving and publication identity. It does not certify native keyboard/gamepad behavior, audio, WebGL pixels or hardware performance. There are no new city/model art changes in this release. Historical images and results retain their original identities. Live version: `deployment.json` at the site root.
