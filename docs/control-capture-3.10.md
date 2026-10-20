# 3.10 control capture and research workflow

Historical 3.10 report. For the current 3.11 entry positions, protocol results and remaining real-browser acceptance, use [3.11 control capture](control-capture-3.11.md). The numerical tables below are retained as historical evidence.

This release adds a bounded way to collect the missing steering and levelling evidence through the existing physical simulation and experiment journal. It does not change the validated 3.9 tire, motor, thrust or stabilization parameters. Numerical results below are source-backed solver results; they do not establish browser driving feel, graphics quality or GPU performance.

## What changed

The research form now tracks an actual execution attempt, identified by its frozen requests and the current model, build and protocol. A successful returned batch changes the matching form to **completed**. Editing the request makes the edited configuration unrun; selecting an old response never makes a different form count as executed. Running, cancelled, failed and interrupted attempts remain distinct, with returned/expected result counts. Calculation completion does not imply that a physical success criterion passed.

Valid drafts and selected historical responses persist independently. Loading a historical configuration copies its request into the form without running it or replacing its original response. Failed partial batches keep their returned records. A build change cannot inherit a previous build's completed status. Chinese and English states cover these branches, including completed forms with no historical source.

The capture pilot is in [`dist/driving-capture.js`](../dist/driving-capture.js). Its authority is ordinary normalized driver input and existing public controller commands. It does not integrate a second vehicle, assign a velocity, rotate a body instantaneously, remove collision geometry or enlarge physical force limits.

## Running a capture in the city

Use **Engineering telemetry → Experiments → Control capture**. Select a protocol, initialize if needed, then start it. Physical driver input takes over immediately and saves the executed prefix. The Stop controls also save the prefix. The full-record JSON export belongs to that capture's actual record ID.

### 54 and 90 km/h steering

The two explicit **outer-city capture start · At rest** buttons use existing city ground:

| Protocol | Initial position, m | Heading | Steering direction |
|---|---|---|---|
| 54 km/h | x = −120, y = 0.62, z = −602 | +90° | Right, normalized −1 |
| 90 km/h | x = −300, y = 0.62, z = −602 | +90° | Right, normalized −1 |

Initialization is an explicit scene reset **before** recording, with zero body speed and zero wheel speeds. It does not start the vehicle at the target speed. The complete initial physical state is then captured. A just-reset suspension may settle naturally for up to 0.5 s before the procedure requires four wheel contacts.

These starts were checked with default **dry road and default steering assistance**. The UI preserves the user's surface, tire and assistance choices rather than silently changing them. A wet/split surface or different steering setup can require a different clear path; rejection under those conditions is not converted into a successful run.

The sequence is:

1. Probe the preparation corridor and three estimated turn arcs, including vehicle width and collision height. Check ground continuity. The lab is too small; this protocol requires city ground.
2. Accelerate with ordinary throttle/brake. The protocol's speed driver requests at most ±2.5 m/s² and has integral anti-windup, while the existing motor and tire limits remain authoritative.
3. Require every one of **240 consecutive 120 Hz samples** to satisfy target speed ±0.8 km/h, longitudinal acceleration below 0.2 m/s², body slip below 2°, angular speed below 0.04 rad/s and four wheel contacts. Preparation times out after 30 s if this does not happen.
4. Recheck turn clearance from the actual stabilized position. Freeze the last 0.5 s average throttle, apply the selected full steering input for exactly 4 s, then brake to rest.

The clearance estimate uses steering geometry and a grip-dependent minimum radius. It samples likely arcs instead of requiring an empty 100 m square. It is a diagnostic preflight check, not a guarantee of collision-free reachability. Actual contact loss or body collision fails the run and retains evidence. The preparation distance is an estimate; rechecking the real measurement position is therefore essential.

**Interpretation:** frozen throttle remains an active drive input. Speed loss includes its real drive work, aerodynamic/rolling resistance and tire dissipation. The reported path radius is horizontal speed divided by absolute yaw rate after the first second of steering. This is a variable-speed steering transient, **not** a constant-speed steady circle result. The time series and speed loss must accompany the radius.

### E at 8 m/s, release and Q landing

First reach a stable, nearly level hover in open city space, at least 20 m above the surface below. Use real E input to get there or the existing lab controller; the capture does not create a flying initial state. It checks overhead and side clearance. The 8 m/s test needs about 56 m of clear space above its initial position.

The recorded sequence enables level stabilization, explicitly sets the existing vertical target to 8 m/s, holds E for 5 s, releases until vertical motion settles, then holds Q through actual ground contact, Drive mode and valve closure. Completion requires support and low motion for a sustained interval, not a height threshold alone. The old vertical target is restored through a recorded public command. If the operator changes that setting during capture, capture cancels and preserves the new choice.

The 8 m/s setting is a target velocity, not additional thrust. Releasing E needs a physical braking distance. Under the declared default numerical condition below, release at 7.977 m/s produced **10.678 m** of additional rise. Plan adequate overhead clearance rather than expecting the vehicle to stop instantly.

### Z / B / 1 / 2, release and G

Start from the same open, stable airborne condition. Each protocol prepares in level mode for 1 s, disables levelling, applies the chosen full rate input for **0.9 s**, releases for 1 s, then enables G level mode. G targets horizontal roll/pitch and the heading at the recovery transition. It does not capture the tilted roll/pitch as a new level target.

Recovery requires tilt below 2°, angular speed below 5°/s and vertical speed below 0.3 m/s continuously for 1 s. The attempt ends after 15 s of recovery if those conditions do not hold. Tilt, angular speed, altitude, actuator saturation and recovery height loss are retained. These limited excursions do not establish recovery from all attitudes; inverted recovery can lose substantial height or fail with existing thrust authority.

## Evidence and exact-record semantics

All captures use `ExperimentRecorder` and the existing replay engine:

- The normal full snapshot contains model/build/protocol identity, physical state, controller state, observation state, wind phase, valves, wheel speeds and scene configuration.
- The normal input journal preserves actual **120 Hz pre-solver inputs**, with solver-applied input history and ordered public-command events. Replay feeds pre-solver inputs through the same interlocks.
- `control_capture_start`, clearance decisions and phase events describe the procedure. `control_capture_result` contains its dedicated 20 Hz pose/input curve, initial/final endpoints, and statistics accumulated from every 120 Hz step.
- Ordinary storage may compact generic display curves. It does not cut the protocol result event, the complete input journal or its original statistics. A shortened final interval is declared; stored curves do not claim a false uniform rate.
- The protocol report carries a unique `captureRunId` and links to the actual `recordId`. Starting a new run clears the previous capture's displayed result.
- Invalid preconditions create a fully identified, zero-step failed record. Takeover, timeout and cancellation retain their real prefix; they do not claim the missing phases occurred.
- If a recorder independently ends first, for example via the research console's own Stop control or a solver fault, the protocol links its saved prefix and reports non-completion. `resultEventInRecord: false` explicitly means the session summary was not appended retroactively. A temporary-setting cleanup after that record is also declared; it is outside the replayed interval.

Original-model execution and explicit current-model recomputation keep the existing compatibility and reproduction checks. A record that executes to its end is not automatically “reproduced”; the shared terminal/curve comparison must report `matched`. A/B with a different controller is a new comparison, not a demand for the original trajectory to be identical.

## Numerical regression results

The precise values, source hashes and identities are in [`qa/control-capture-3.10.json`](../qa/control-capture-3.10.json). The two complete road records are in [`qa/fixtures/numerical-control-capture-city-3.10.json`](../qa/fixtures/numerical-control-capture-city-3.10.json), using the normal importable live-experiment library schema.

### Intact city, at-rest starts, default dry road

These executions used the complete Cannon city collision world, with all its geometry retained. They are not tests with an empty mock-clearance surface. Both original-input replays passed the existing reproduction comparison.

| Measurement | 54 km/h procedure | 90 km/h procedure |
|---|---:|---:|
| Speed range throughout the 2 s gate | 54.083–54.295 km/h | 89.807–90.798 km/h |
| Peak absolute longitudinal acceleration during gate | 0.041 m/s² | 0.140 m/s² |
| Measurement starts after physical preparation | 15.517 s | 18.433 s |
| Steering input duration | 4.000 s | 4.000 s |
| Speed at steering start → end | 54.083 → 43.579 km/h | 89.807 → 78.066 km/h |
| Speed loss at frozen throttle | 10.504 km/h | 11.741 km/h |
| Yaw response at 0.5 s, magnitude | 34.063°/s | 21.310°/s |
| Mean transient path radius after 1 s | 19.425 m | 56.433 m |
| Peak body slip during steering | 1.063° | 3.425° |
| Peak lateral acceleration during steering | 9.399 m/s² | 9.570 m/s² |
| Total preparation/turn/stop duration | 21.275 s | 25.017 s |
| Total electric energy used | 0.12044 kWh | 0.30032 kWh |

### Flight fixture

Flight procedures were tested in an explicitly declared flat numerical scene. The initial hover was reached by ordinary E input and settling before its complete snapshot was reused. This isolates controller behavior; it is **not** a claim that all city flight-clearance conditions have been driven in a real browser.

| Procedure | Measured excursion / release | Recovery / release cost |
|---|---|---|
| E 8 m/s → release → Q | Release vertical speed 7.977 m/s | Extra rise 10.678 m; 3.900 s until sustained vertical settling; landing/valve confirmation at 26.517 s |
| Z → release → G | Peak absolute roll 79.344° | Recovery 3.842 s; 1.567 m recovery height loss |
| B → release → G | Peak absolute roll 79.353° | Recovery 3.850 s; 1.568 m recovery height loss |
| 1 → release → G | Peak absolute pitch 29.420° | Recovery 2.233 s; 0.00285 m recovery height loss |
| 2 → release → G | Peak absolute pitch 29.420° | Recovery 2.233 s; 0.00285 m recovery height loss |

The E/Q test consumed **974.275 kg of external supplied air** and zero onboard gas under the inherited continuous-supply model; its final nozzle flow and thrust were effectively zero. This large throughput is a real cost within the project's engineering assumptions, not an official Tesla supply measurement. The roll recovery tests include about 1.567 s of nozzle saturation and significant horizontal motion; the recovery criterion does not promise to return to the original position.

Synthetic 60/120/240 Hz display dispatch produced identical fixed-step input journals, terminal states and metrics. This checks render-scheduling independence; it is not a measured browser frame rate. Storage/replay checks retained all dedicated curves and input events. The three-record storage fixture used about 1.85 MB under the existing 4 MiB archive budget. Long recordings still need prompt JSON export when that budget is reached.

Failure coverage includes a 500 W motor failing the preparation gate without ever entering steering, an actual city obstacle rejecting preflight, driver takeover, external record Stop, and an operator changing the vertical target. The research workflow report separately covers completed, failed, partially cancelled and interrupted batches, draft/history independence and English presentation.

Run the bounded checks with:

```sh
node tests/control-capture-3.10.test.mjs
node qa/research-workflow-3.10-check.mjs /tmp/roadster-dom-qa/node_modules/jsdom
```

The latter uses JSDOM events and real numerical reports through a Worker facade; it does not validate layout, native worker timing or rendered pixels.

## Real-browser follow-up capture

The supplied IAB evidence already contains genuine WebGL frames. Its prior turn frames were 26 km/h before and 22 km/h after, so those frames are not a 68 km/h steering test. The E/Q 3/8 m/s setting and refresh persistence were already checked on the actual page; this release's new procedure addresses motion and stopping costs rather than claiming those existing settings as new work.

For new driving evidence, use the explicit starts above with declared dry/default parameters, save both complete record JSONs, and record the full preparation, stable gate, steering and braking sequence. For E/Q and G, record the declared initial height and condition and export the pose series alongside video. Keep the actual renderer/browser/device identity and display-frame measurements separate from simulation time. A paused fixed camera is not a driving-FPS sample. The parent visual work provides its own fixed-camera comparisons; this numerical module alone does not verify those pixels.

## Small next-stage experiments — designs, not shipped features

| Experiment | Variables and matched control | Measures and playable goal | Bounded first implementation |
|---|---|---|---|
| Attitude recovery and required height | Nine declared initial attitude/rate states; heights 20/40/80 m; healthy vs one declared 50% lift-nozzle derating. Freeze mass, gas, wind phase and gains. Preparation or numerical initial-condition assignment must be labelled and occur before the recorded recovery interval. | Recovery success, minimum altitude, time, saturation and air use. A player can compare their G decision to the recovery-height envelope; failures remain visible. | 9 × 3 × 2 = 54 attempts, at most 12 s each, 648 simulated seconds. Implement as saved preset batches using existing snapshot/replay contracts, not a new solver. |
| Small robust-controller comparison | The same physical snapshot, five explicit noise seeds, two gain sets and two measured-delay settings; retain the same wind/nozzle fault and reference/input schedule. | Pose/position error, settling time, peak height loss, saturation and gas cost. Show every seed and the worst result; five seeds do not justify a broad statistical guarantee. | 20 attempts × 12 s = 240 simulated seconds. Uses existing observation/controller interfaces and source-linked A/B results. |
| Grip, energy and air-budget route task | A declared existing-city route and braking/landing zones; dry/wet or assist on/off matched initial conditions, plus finite vs continuous gas as separate named scenarios. Input replay is the reference; an independently driven attempt is a separate record. | Missed gates, boundary/contact events, braking distance, final position error, electric energy and onboard/external air use. Finish safely within a stated budget rather than awarding points for an unphysical shortcut. | Start with one route, one brake zone and one landing zone. Add objective evaluation to the existing journal; do not teleport, apply hidden forces, or spawn a separate game physics model. |
