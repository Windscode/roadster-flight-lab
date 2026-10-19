# Roadster Flight Lab

**Drive a car beyond the road — then turn the flight into an experiment you can inspect and replay.**

[简体中文](README.md) · English

[**Enter the city ↗**](https://windscode.github.io/roadster-flight-lab/) · [Wind laboratory](https://windscode.github.io/roadster-flight-lab/?view=lab) · [Vehicle surface studio](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html)

Roadster Flight Lab is an independent, playable vehicle and flight simulation research project. Inspired by [Tesla’s public Roadster imagery and feature descriptions](https://www.tesla.com/roadster), it explores road driving, cold-gas propulsion, attitude control and near-surface suction in the original Vesper city. Tires, suspension, gas, nozzles, the wing and controllers act on one six-degree-of-freedom rigid body.

It gives you both physical limits and tools to investigate them: change the road or controller, inspect wheel speeds, slip and air use, record your inputs, replay the same initial conditions, and run a fair controller A/B. Large tilts, finite air, a derated nozzle or an unsealed surface can make a maneuver fail. Failed attempts remain part of the research record.

## Start exploring

Open the [online proving ground](https://windscode.github.io/roadster-flight-lab/) and choose **Enter the city**. Smooth graphics and continuous external air are the defaults. Initial loading downloads the bundled scene assets. Use the top-right **中文 / English** selector; your choice is saved on this device.

1. **Drive a street.** W / S accelerates and brakes, A / D steers and Space applies the wheel brakes. In graphics settings, choose the Weavebridge–Southbank loop: roughly 1.1 km of connected streets, junctions and an underpass.
2. **Leave the road.** H enables assisted flight; E / Q climbs and descends. The visible **Vertical response** slider directly sets target vertical speed: **0.5–8 m/s, default 3 m/s**. Actual thrust limits acceleration. Holding a key longer does not increase its command.
3. **Explore attitude control.** G enables auto-level, restoring horizontal roll and pitch while retaining the heading at the switch. With G off, Z / B roll continuously and 1 / 2 adjust pitch; releasing them attempts to hold the reached attitude. X performs a complete roll after clearance and air-reserve checks.
4. **Keep this flight.** Choose “Record this drive / flight” in engineering telemetry. Finish it, then view, export or replay it in the research console without rebuilding the experiment.

External supply is a convenient practice and comparison condition. It sustains supply pressure without raising nozzle hardware limits and does not imply unlimited real-car hover. Select a finite tank in model parameters or the research console.

## Three ways to investigate

| Mode | What you can do |
|---|---|
| **Vesper city** | Drive, fly, attach to surfaces and roll; switch between clear day and wet night; follow the map and continuous street route; record and replay live experiments. |
| **Same-page wind lab** | Set position and attitude targets, tune gains, introduce wind and observation disturbances, edit physically executed sequences, then bind them to 3–9 and use them in the city. Each scene retains its own vehicle state. |
| **Standard numerical studies** | Define initial conditions and protocols; compare braking, launches, steering, climbs, hover, rolls and attitude response. Run sweeps, controller A/B, inspect history and explicitly recompute with the current model. No WebGL required. |

The [vehicle studio](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html) provides fixed focal length and camera views for body surfaces, glass, lamps, wheels, steering and suspension travel. Its geometry is an original reconstruction from photographs, not Tesla CAD.

![Actual 3.9 English numerical research UI showing wet-road ABS recomputed from a historical request](qa/screenshots/3.9-verified-study-webgl-unavailable.jpg)

*Actual 3.9 browser UI: explicitly recomputing a historical wet-road ABS request creates a separate new record. This browser has no WebGL, so the image shows working numerical research, not a city or vehicle rendering sample. [Browser evidence and original exports](qa/browser-release-3.9.json).*

## Experiments worth trying

- **Same full braking, different direction.** Compare ABS on / off on dry, wet and split-friction surfaces. Inspect stopping distance, lock-up time and heading deviation. ABS regulates individual brake pressures; it is not ESC, and stopping distance can trade off against directional stability.
- **Can this attitude really stay still?** Set a tilted pose in the wind lab. Compare weight, vertical thrust components and torque allocation. If the bounded nozzles cannot support it, the vehicle descends. Recovery uses actual torque, never an instant attitude change.
- **Same inputs, different controller.** Record a wind-disturbed flight, fix its initial state, inputs and disturbance seed, and change only declared gains for A/B. Add measurement delay, seeded noise or one derated nozzle.
- **Did it actually reproduce?** Original-condition replay reports execution status, compatibility and reproduction consistency separately. Terminal state, retained key curves and control state include errors, tolerances and first divergence. Viewing history, replaying original conditions and recomputing with the current model are distinct actions.
- **The wing is an actuator.** Compare fixed and active wings using deployment, drag, downforce and wheel loads. The mesh and aerodynamics read the same physical state.

## Essential controls

| Action | Key |
|---|---|
| Accelerate / Brake first, then hold opposite input after stopping to reverse | W / S |
| Ground steering / Assisted-flight yaw | A / D |
| Mechanical wheel brakes / Rear cold-gas boost | Space / Shift |
| Assisted flight toggle | H |
| Climb / Descend; keep Q after contact to finish landing and close valves | E / Q |
| Auto-level on / off, always two states | G |
| Continuous roll; lateral translation when G is on | Z / B |
| Bounded pitch-rate up / down | 1 / 2 |
| Suction / Automatic roll / Automatic landing | F / X / L |
| Saved research sequences | 3–9 |
| Menu / Pause or resume | ESC / P |
| Reset scenario / Explicit air-refill intervention | R / T |
| Camera / Force vectors / Map or lab console / Hide instruments | C / V / M / F9 |
| Radio play / Next track | J / K |

Driving and sequence shortcuts are suppressed while editing a form. Arbitrary research pose targets remain in the research console; G never enters position-and-attitude hold.

## How credible is it?

**Physically based does not mean calibrated to the real vehicle.** The model includes independent wheel speed and inertia, drive/brake/contact torques, regularized slip, combined grip limits, suspension and contact, nozzle valves, temperature/pressure-dependent exhaust velocity and gas consumption, low-order pressure-difference suction, an aerodynamic wing and constrained control allocation. Physics runs at 120 Hz by default, regardless of graphics quality.

Public imagery and descriptions define the research subject. Mass, inertia, dimensions, nozzle forces and layout, tire curves, fans, valves, wing coefficients and internal construction include engineering assumptions. A complete OEM dataset and real-car calibration are unavailable. The project does not include CFD, flexible bodies, full multibody suspension, structural FEA or a real-gas database. [Thrust and control notes](dist/physics-3.9-notes.md) explain how actuator authority limits hover, tilt and recovery.

**The browser city is still being developed.** The full city remains, with priority on continuous drivable streets, materials, the vehicle and lighting. There are no building interiors or crowds. Day and wet night are separate presets, with detail and reflection budgets for each quality setting. Smooth mode’s 60 FPS is a target, not a guarantee for every device. The cloud browser used for this release has no usable WebGL; 3D pixels, driving feel and real GPU frame times remain unaccepted. This project does not claim native AAA visual quality.

The app includes fixed viewpoints, PNG and scene-condition export, and frame-time recording with separate warm-up and steady phases. Judge graphics and performance from actual rendering on your device. If graphics are unavailable, numerical studies, history and exports remain on the same page, with an explicit “No frame-rate data” status.

## Your data stays in your browser

Live records retain the initial state, model/build/protocol identity, inherited wind and disturbance phase, every physics-step input, controller state and intervention events. If an old model cannot run, its history remains viewable and original-condition execution is explicitly rejected. A new model runs only through the explicit current-model recompute action.

Live-library JSON, standard-study-library JSON and sequence-configuration JSON have separate, stated scopes. CSV exports only the selected record, with its own identity, retained sampling interval and original statistics provenance. Language changes affect presentation, never raw fields, units, user names or historical data. Browser site-data deletion removes local records; back up using JSON.

## Run locally or contribute

Node.js 22+ is required. Runtime dependencies are included; there is no `npm install` or bundler step.

```sh
git clone https://github.com/Windscode/roadster-flight-lab.git
cd roadster-flight-lab
npm start
```

Open `http://127.0.0.1:8080/`. On Windows, you can also launch `启动试验场.cmd`. 3D requires WebGL 2 and usable graphics acceleration; numerical research does not require a GPU.

- [Development, validation and Pages deployment](docs/DEVELOPMENT.md)
- [3.9 changes and evidence scope](3.9-UPDATE-NOTES.md)
- [Numerical validation summary](https://windscode.github.io/roadster-flight-lab/validation.json)
- [3.8 release notes](3.8-UPDATE-NOTES.md) · [Earlier development history](docs/history/README-3.8.md)

Three.js · cannon-es · Poly Haven CC0 environment assets. Asset licenses remain in the repository. Tesla names identify the research subject. This is unofficial software, not a tool for vehicle design, safety assessment or performance certification.
