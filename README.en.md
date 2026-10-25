# Roadster Flight Lab

**Drive through a city, practice flight control, and turn each attempt into an experiment you can explain and replay.**

[Drive](https://windscode.github.io/roadster-flight-lab/) · [Wind laboratory](https://windscode.github.io/roadster-flight-lab/?view=lab) · [Vehicle workshop](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html) · [中文](README.md)

An independent vehicle-driving, cold-gas-flight and automatic-control research project. Explore the connected streets of Vesper, practice takeoff and landing, or change controllers, disturbances and resource conditions. Driving, challenges and research share the same physics, inputs and resource accounting.

![Actual driving view in Vesper](qa/browser-1.1/day-route.png)

## Explore, drive, experiment

| Area | Available today |
| --- | --- |
| Vehicle simulation | 120 Hz rigid-body dynamics, tire/suspension/contact models, varying grip, manual jets, attitude assistance, automatic maneuvers and landing |
| Vehicle workshop | Independently reconstructed Roadster concept body, cabin, underside and nozzles; steering, suspension, wing and lighting follow actual state; cutaway and model export |
| Complete city | Connected roads, elevated streets and ramps, commercial blocks, civic spaces and industrial waterfront; daylight/wet night, three quality levels and multiple cameras |
| Research and play | Finite-resource driving, flight/landing tasks, wind disturbances, controller A/B, parameter studies, initial-state/input recording, replay and export |

Resources participate in the dynamics: motors and fans draw battery energy, finite tanks lose gas through the jets, and regenerative braking follows actual wheel work within power, efficiency and state-of-charge limits. Free driving uses a declared external gas supply; resource challenges specify their own initial conditions.

## First drive

Choose **Enter city**, learn steering and braking on the road, then try flight assistance in open space. **Routes & challenges** leads to navigation, resource driving and flight/landing practice. Review a failed attempt and restart from its result card.

| Default keys | Action |
| --- | --- |
| W / S, A / D | Forward / slow and reverse, steering; arrow keys also work |
| Space | Blended friction and regenerative braking |
| H, E / Q | Flight-assist toggle, climb / descend |
| 1 / 2, Z / B | Manual pitch and roll; Z / B translate when G is enabled |
| P, Esc, R | Pause / resume, menu, end attempt and reset |
| C, M | Camera, map / routes |

Full controls, rebinding and gamepad calibration are in the application. Help follows your bindings. Start with a desktop browser and keyboard, and select a graphics preset suitable for your device.

## Repeatable research

The city and wind laboratory share one page. Configure controllers, conditions and experimental procedures; record full initial states and effective inputs; review responses, resource budgets and failures. A record can retain multiple recomputations or controller A/B analyses, each selectable and exportable.

Original-condition replay under the same build checks state errors. Compatible historical records require an explicit current-model recomputation and retain their source identity; this never claims to execute an old solver. Fair comparisons require matching conditions and complete initial states. Storage limits and concurrent-page conflicts are reported. Export important experiments for safekeeping.

## Version 1.1

- Consistent ambient-pressure nozzle limits and actuator power behavior near battery depletion.
- Continuous front hood/return/corner boundaries with preserved mechanical hard points and draw budgets.
- Preparation of all submitted material variants, without reissuing shadow-update requests already consumed by wet-road reflections.
- Concurrent archive protection, selectable analysis history and explicit compatible-record recomputation.

[Audit and release scope](docs/release-1.1.md) · [Current checks](qa/release-1.1/validation.json) · [Real browser acceptance](qa/browser-1.1/observations.json) · [Development direction](docs/development-plan.md)

## Scope and limitations

Public Roadster references inform the independently authored model; unpublished specifications remain declared engineering assumptions. This is **not an official Tesla product, OEM CAD, real-vehicle performance prediction or industrially certified simulator**. The explorable city currently emphasizes exterior streetscapes.

Initial resource/shader preparation may take time and pauses the vehicle. Preparation costs and active-driving long frames are reported separately. Acceptance states its actual device and scope; numerical/DOM checks do not certify physical keyboards/gamepads, listening quality or performance on every GPU.

## Run locally

**Node.js 22+**; production dependencies and reviewed assets are vendored.

~~~sh
git clone https://github.com/Windscode/roadster-flight-lab.git
cd roadster-flight-lab
npm start
~~~

Open http://127.0.0.1:8080/ . Edit the runtime source in `dist/`; it is not disposable build output. Serve over HTTP rather than opening files directly.

For the full current release gate:

~~~sh
npm ci --prefix tests/dom --ignore-scripts
export JSDOM_MODULE_PATH="$PWD/tests/dom/node_modules/jsdom/lib/api.js"
npm run model:build
npm run test:release
node scripts/check-static.mjs
~~~

PowerShell: `$env:JSDOM_MODULE_PATH = (Resolve-Path tests/dom/node_modules/jsdom/lib/api.js).Path`. Historical `npm test` / `npm run validate` require separate archived inputs; they are not the current release entry point. See [development documentation](docs/DEVELOPMENT.md).

## History, feedback and license

1.0 was the first product release; 3.19–3.24 were development iteration numbers. Earlier notes and evidence remain intact: [1.0](docs/release-1.0.md), [3.24](docs/release-3.24.md), [3.23](docs/release-3.23.md), [3.22](docs/release-3.22.md), [3.21](docs/release-3.21.md). The live [deployment identity](https://windscode.github.io/roadster-flight-lab/deployment.json) identifies the published build.

Use [Issues](https://github.com/Windscode/roadster-flight-lab/issues) for reproducible bugs, research proposals and usability feedback. Include your browser, quality setting, steps and an exported record or capture conditions where possible.

Original code and procedural assets use the [MIT License](LICENSE). Third-party assets and libraries retain their own licenses; see [asset credits](dist/CREDITS.md).
