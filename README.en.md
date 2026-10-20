# Roadster Flight Lab

**Drive beyond the road, then turn the flight into an experiment you can inspect and replay.**

[简体中文](README.md) · English

[**Enter the city ↗**](https://windscode.github.io/roadster-flight-lab/) · [Wind laboratory](https://windscode.github.io/roadster-flight-lab/?view=lab) · [Vehicle studio](https://windscode.github.io/roadster-flight-lab/vehicle-inspection.html)

Roadster Flight Lab is an independent, playable vehicle and flight research project. Its original body reconstruction follows [Tesla’s current public Roadster imagery](https://www.tesla.com/roadster). Explore road driving, cold-gas propulsion, attitude control and near-surface suction in the original Vesper city. Tires, suspension, gas, nozzles, wing and controllers act on one six-degree-of-freedom rigid body.

Drive connected streets, leave the road for an attitude maneuver, then turn those inputs into an exportable, replayable experiment. Wind, measurement delay, nozzle derating and finite gas change the actual response. Successful and failed attempts remain part of the record.

## The proving ground

![Actual 3.9 WebGL historical frame: Weavebridge commercial street by day](qa/screenshots/3.9-evidence/city-day-01-weave-fixed.jpg)

![Actual 3.9 WebGL historical frame: Roadster front three-quarter inspection](qa/screenshots/3.9-evidence/39-studio-front-three-quarter.jpg)

*These are actual **3.9 historical frames**, showing the project's city and vehicle foundation. They are not matched-condition acceptance images of 3.11. [Image provenance and comparison conditions](docs/visual-evidence-3.10.md).*

## Your first drive and flight

1. **Drive a street.** W / S accelerates and brakes, A / D steers, and Space applies the wheel brakes. The Weavebridge–Southbank loop in the graphics panel connects approximately 1.1 km of streets, junctions and underpass space.
2. **Leave the ground.** H enables assisted flight; E / Q climbs and descends. Visible sliders set vertical speed and acceleration. Actual thrust, pressure and attitude limit the response; holding a key longer never increases its command indefinitely.
3. **Explore attitude maneuvers.** G restores level roll and pitch while retaining the heading at the switch. With G off, Z / B rolls and 1 / 2 pitches. Manual rates and angular acceleration are adjustable. X provides a complete roll after clearance and air-reserve checks.
4. **Record and compare.** Choose Record this drive / flight in the engineering panel. Inspect the resulting curves, export the record, replay original conditions, or explicitly recompute with the current model.

Continuous external air is the practice default. Finite supply adds tank depletion and cooling; pressure, valve response and installed nozzle thrust limits constrain maneuvers in both modes. Use the top-right **中文 / English** selector.

## Three entrances, one physical model

| Entrance | What to explore |
|---|---|
| **Vesper city** | Driving, flight, rolls and suction; clear day / wet night; map navigation, connected routes and live recording. |
| **Wind laboratory** | Position and attitude targets, control gains, wind and measurement disturbances. Save physically executed procedures and bind them to keys 3–9. City and laboratory retain separate vehicle states. |
| **Vehicle studio** | Locked lens and cameras for body surfaces, glass, lights, wheels, steering and suspension travel. Compare frozen historical models and export actual rendered frames. |

Advanced research inside the city and laboratory uses the same solver to run standard initial-condition experiments in the background, preserving the live vehicle. History, JSON / CSV export and numerical studies also work on devices without a 3D renderer.

## Experiments worth trying

**Compare controllers under noise and delay.** Choose Attitude recovery → Five-seed controller comparison. Compare A / B attitude responses under matched initial conditions, wind and gas supply: five explicit seeds × two observation delays × two controllers, 20 cases of 12 seconds each. Optionally derate the front-right lift nozzle. Inspect per-seed successes and failures, attitude / height errors, maximum height loss, saturation and actual gas throughput. Click a row for its paired curves. This mode uses the laboratory's pose controller; the ordinary G levelling experiment remains separate.

**Compare braking on dry, wet and split-friction roads.** Compare ABS on / off with matched initial states, measuring stopping distance, locking time and heading deviation, or observe wheel speed and TCS during launch. The response exposes tradeoffs between braking and directional stability.

**Explore the limits of finite gas supply.** Compare finite and external supply, observing loss of hover, gas use, saturation and confirmed landing. The active wing and wheel loads share the same physical state. New sessions use the constant-pressure bench; finite supply retains real impulse-shortfall rejections. Roll studies use a 20-second observation window by default, with an explicit historical 8-second option saved in each request.

**Verify historical trajectory reproduction.** Original-condition replay reports execution, model compatibility and numerical agreement separately. History retains its model and build identity. Current-model recomputation explicitly records differences and parameter mappings.

## Common controls

| Action | Key |
|---|---|
| Accelerate / brake; keep reverse input after stopping to reverse | W / S |
| Ground steering / flight yaw | A / D |
| Mechanical brakes / rear cold-gas boost | Space / Shift |
| Assisted-flight toggle; climb / descend | H; E / Q |
| Auto-level on / off | G |
| Roll; lateral motion with G enabled | Z / B |
| Pitch up / down | 1 / 2 |
| Suction / automatic roll / automatic landing | F / X / L |
| Saved research procedures | 3–9 |
| Camera / force vectors / map or research panel / hide instruments | C / V / M / F9 |
| Menu / pause / reset / explicit refill | ESC / P / R / T |
| Music play / next track | J / K |

Driving and procedure shortcuts are suspended while editing forms. Holding Q through reliable ground contact closes the nozzles. Large-tilt or low-altitude recovery can fail; rotation and braking use physical forces and torques.

## Model and data boundaries

This unofficial simulation combines public imagery with engineering assumptions. It has no Tesla CAD, tire database or vehicle calibration. The **700 kW** mechanical power rating, dry-road **μ = 1.25**, and **20 kN** per main nozzle are model assumptions. Experimental nozzles, suction hardware and internal construction include original research designs and should not be read as official vehicle specifications.

The model includes independent wheel rotation, combined tire grip, suspension contact, finite-response valves, gas supply and constrained control allocation. It has no industrial CFD, flexible body or full multibody suspension. The complete browser city remains in active production, with quality-dependent lighting, shadow and reflection budgets. Graphics, real driving frame times and numerical correctness have separate acceptance criteria. Matched-condition WebGL acceptance for the 3.11 body-stripe, night-lighting and material changes is still pending; see the [visual validation record](docs/visual-3.11.md).

Records stay in the current browser. At the storage limit, existing history is preserved and new results are explicitly marked as session-only; use full JSON exports to retain them. Language switching does not rewrite experiment fields, custom names or history. Five selected seeds explain only the declared conditions; they do not establish real-vehicle reliability.

## Run locally

Use Node.js 22+; runtime dependencies are included.

```sh
git clone https://github.com/Windscode/roadster-flight-lab.git
cd roadster-flight-lab
npm start
```

Open `http://127.0.0.1:8080/`. Windows users can also run `启动试验场.cmd`. 3D requires WebGL 2 and graphics acceleration; numerical research requires no GPU.

[Release evidence](docs/release-3.11.md) · [Driving and flight comparisons](docs/vehicle-dynamics-3.11.md) · [Development and validation](docs/DEVELOPMENT.md) · [Robustness protocol](docs/research-robustness-3.11.md) · [Physical assumptions](dist/physics-3.9-notes.md) · [Historical release](3.9-UPDATE-NOTES.md) · [Deployment identity](https://windscode.github.io/roadster-flight-lab/deployment.json)

Three.js · cannon-es · Poly Haven CC0 environment assets. Third-party licenses remain with the repository. Tesla branding identifies the research subject; this is an unofficial project, not a tool for vehicle design, safety assessment or performance certification.
