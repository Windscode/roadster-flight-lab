# Roadster Flight Lab

Drive a cold-gas flight concept through the streets and elevated roads of Vesper. Practice a roll or a landing, then return to the same gust, patch of wet asphalt or tank of gas to compare two control strategies.

**[Enter the city](https://windscode.github.io/roadster-flight-lab/)** · [Wind laboratory](https://windscode.github.io/roadster-flight-lab/?view=lab) · [Vehicle workshop](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html) · [中文](README.md)

![Driving on Weave Street with the amber timing line ahead and four-wheel surface readings on the right](qa/browser-1.2/timing-line.jpg)

## First visit

| To try | Where to start |
| --- | --- |
| Drive and fly | Choose **Enter city**. W / S accelerate, slow and reverse. A / D steer. Space brakes. In open space, H enables flight assistance and E / Q command climb and descent. |
| Learn a braking line | Choose **Routes & challenges → Prepare route → Drive and record**. Cross the three amber lines, turn left and stop inside the teal ring for half a second. Free practice lets you stop and study the turn. |
| Compare controllers | Open the **Wind laboratory**, select a disturbance, initial state and controller, and record a run. Review inputs and attitude, or compare controllers from the same initial state. |
| Inspect the car | The **Vehicle workshop** has exterior, chassis and cutaway views. Adjust steering and suspension travel to see the pushrods, dampers and active wing. |

C cycles cameras, M opens the map and P or Esc pauses. The application provides automatic maneuvers, key remapping and gamepad calibration. On-screen hints follow the active bindings. City driving, challenges and laboratory runs use the same 120 Hz dynamics and resource accounting. Start in a desktop browser.

## One street, three driving strategies

The finite-resource route starts with **120 Wh available and a 600 L tank at 100 bar**. Cover 302.5 m within 65 seconds and retain at least 5 Wh and 5 kg of gas. Regeneration follows measured wheel work. The motor, fan, auxiliaries and valves draw from their respective supplies.

| Dry daylight, identical full starting state | Time | Net battery use | Recovered | Onboard gas used |
| --- | ---: | ---: | ---: | ---: |
| Economy | 52.81 s | 55.83 Wh | 14.40 Wh | 0 kg |
| Balanced | 43.72 s | 69.25 Wh | 16.79 Wh | 0 kg |
| Boost-assisted launch | 40.92 s | 60.74 Wh | 16.76 Wh | 15.67 kg |

These are three complete 1.2 simulation runs using ordinary throttle, brake, steering and jet inputs. Net battery use already accounts for regeneration. Open the four sectors after a run to see where time, electricity and gas went. Matched finishes include per-sector differences. An interrupted attempt retains the timing lines already crossed. [Full results and replayable input records](qa/resource-1.2)

## Vehicle, city and laboratory

- **Driving and flight.** Each wheel has its own contact, suspension and grip state. Manual valves, flight assistance, leveling and automatic maneuvers declare who controls thrust. Landing estimates account for pressure, energy, valve response and force direction.
- **Vehicle workshop.** Parametric surfaces and mechanical assemblies form the body, cabin, arches and underside. Paint, glass, rubber and metal use distinct materials. Public exterior views inform the independent reconstruction. Hidden linkages and the cold-gas installation are illustrative engineering assumptions. [Model references](dist/assets/references/README.md)
- **Explorable city.** Streets, ramps and elevated roads connect. Weave has double-level walkways, South Bank has tidal survey displays, and the foundry district has machine-tool shopfronts. Daylight, wet night and three quality levels are available. Buildings emphasize exterior streetscapes.
- **Repeatable research.** Records retain the complete physical initial state, effective inputs and build identity. Same-build replay checks state agreement. Compatible earlier records can be explicitly recomputed with the current model. Experiments, controller comparisons and results can be exported. This is an independent project for driving and control research.

<details>
<summary>See the vehicle and chassis in the workshop</summary>

![Body, glazing and wheels in the workshop daylight view](qa/browser-1.2/vehicle-exterior.png)
![Chassis cutaway with suspension extended and front wheels turned](qa/browser-1.2/vehicle-linkage.png)

</details>

[1.2 audit and scope](docs/release-1.2.md) · [Release checks](qa/release-1.2/validation.json) · [Browser acceptance](qa/browser-1.2/observations.json) · [Official Roadster exterior reference](https://www.tesla.com/roadster)

## Run locally

Use Node.js 22 or newer. Production dependencies and assets are vendored.

~~~sh
git clone https://github.com/Windscode/roadster-flight-lab.git
cd roadster-flight-lab
npm start
~~~

Open `http://127.0.0.1:8080/`. The editable runtime source lives in `dist/`. For the full release checks use the pinned DOM test dependency.

~~~sh
npm ci --prefix tests/dom --ignore-scripts
export JSDOM_MODULE_PATH="$PWD/tests/dom/node_modules/jsdom/lib/api.js"
npm run model:build
npm run test:release
node scripts/check-static.mjs
~~~

On PowerShell use `$env:JSDOM_MODULE_PATH = (Resolve-Path tests/dom/node_modules/jsdom/lib/api.js).Path`. The development guide describes historical check inputs and the current publication workflow. [Development guide](docs/DEVELOPMENT.md)

## Releases and feedback

1.0 was the first product release. Earlier 3.x numbers refer to development iterations. Versioned notes retain original measurements and scope. [1.1](docs/release-1.1.md) · [1.0](docs/release-1.0.md) · [3.24](docs/release-3.24.md) · [Development direction](docs/development-plan.md) · [Live build identity](https://windscode.github.io/roadster-flight-lab/deployment.json)

Bug reports are welcome. Include the browser, quality preset, input sequence and an exported record when available. [Report an issue](https://github.com/Windscode/roadster-flight-lab/issues)

Original code and procedural assets use the MIT license. Third-party libraries and assets retain their respective licenses. [LICENSE](LICENSE) · [Asset credits](dist/CREDITS.md)
