# Five-seed pose-controller comparison

Version 3.11 implements the bounded controller robustness study proposed at the end of [the 3.10 control-capture plan](control-capture-3.10.md). The feature lives in the existing standard research panel, uses its background executor, and preserves the existing report library, export/import and execution-attempt workflow.

## Run the experiment

Open the city or wind laboratory, then the advanced research panel. Choose the **Noise and delay** preset, or select **Attitude recovery → Five-seed controller comparison**. A reads the current vehicle parameter baseline. B changes only `attitudeResponse`; its starting value is 2.5 rad/s. The panel shows A's actual value.

The protocol runs five seeds, each at zero delay and the selected delay, for A and B: **20 cases × 12 seconds**. The controls expose B's response, nonzero comparison delay, mean wind speed and front-right main-nozzle derating. Existing mass, supply, valve, pressure and controller parameters remain those in the pending request. Finite and external supply are separate physical conditions; the feature never silently replenishes gas or raises nozzle limits.

The default disturbance specification is:

| Factor | Declared condition |
|---|---|
| Seeds | 37, 101, 271, 509, 997 |
| Observation delay | 0 / 120 ms; the second value can be set to 10–250 ms |
| Position noise | Independent uniform sample within ±0.02 m per axis |
| Velocity noise | Independent uniform sample within ±0.04 m/s per axis |
| Attitude noise | Independent uniform Euler perturbation within ±0.35° per axis |
| Angular-rate noise | Independent uniform sample within ±0.02 rad/s per axis |
| Mean wind | 6 m/s, flowing at world heading 65° |
| Gust | Mean wind / 3 amplitude, five-second sinusoidal period |
| Nozzle condition | Healthy, or front-right lift nozzle at 75% / 50% capability |
| Initial pose | The panel's roll and height, with the established −10° pitch and 0.2 / 0 / 0.3 rad/s angular-rate fixture |
| Reference | Original position and the level world quaternion |

The random source is the existing observation model's deterministic Mulberry32 implementation. A and B within a seed pair receive the same random sequence and time-zero wind phase. Different seeds enter the actual flight-feedback observation path; they are not labels added to identical deterministic runs. Wind and fault settings use `setWind` and `setNozzleFault` before execution.

## Why the research pose controller is explicit

This study uses `setPoseTarget`, the laboratory's existing position-and-attitude controller. Its `attitudeResponse` parameter reaches the physical torque request and constrained nozzle allocator. The ordinary **G levelling** experiment remains a separate option and retains its heading semantics.

In the inherited 3.10 implementation, changing `attitudeResponse` did not change the G levelling channel's fixed attitude frequency. Running that configuration as a gain comparison would therefore have produced a misleading A/B label. The new mode states which controller it exercises instead of changing the meaning of G or presenting inactive parameters as a comparison.

No body position, velocity, orientation or angular rate is assigned after the declared numerical initial-state preparation. The reference, observation and fault APIs influence the same controller and actuators as the live laboratory. Controller gains can request an infeasible wrench; the solver retains valve dynamics, pressure, individual force limits and saturation.

## Success, cost and incomplete execution

Physical success requires the **final continuous 0.5 seconds** of the 12-second interval to satisfy all of the following:

- Quaternion attitude error below 2°.
- Angular-rate magnitude below 0.15 rad/s.
- Absolute height error and horizontal position error each below 0.75 m.
- No wheel ground contact or hull collision during the entire attempt.

All 120 Hz physics steps contribute to the metrics. The retained curve uses 10 Hz sampling, with its frequency saved in each report and CSV header. It is not used to reconstruct peaks, gas throughput or RMS values. Each result retains attitude and height errors, maximum height loss, position error, saturation time, delivered gas, onboard/external gas distinction, electrical consumption, and original initial/terminal state evidence.

The aggregate table reports **recovered / returned cases**, height-error RMS, worst height loss, mean actual gas throughput and worst saturation time for each controller/delay combination. Every seed remains in the detail table. Clicking a row selects that seed's two controller responses in the existing curves, keeping the graph readable. “Export this complete comparison” exports all returned cases, complete requests and the derived summary. Reimport ignores exported conclusions and executes the requests again.

Returned results and requested results are separate counts. Cancellation or worker failure retains the frozen attempt and all reports already returned. A/B deltas require matching declared model, build, protocol, initial request, seed, wind and fault conditions, except the compared attitude response. Unmatched or duplicate cases do not become valid pairs. Finishing the numerical loop does not change a failed physical outcome into success.

Five deliberately selected seeds do **not** establish a population success rate, confidence interval, certified safe envelope, or best controller. The experiment exposes sensitivity to the declared delay/noise/initial-state assumptions.

## Measured numerical example

The current-source test uses external supply, a 35° initial roll at 12 m, −10° pitch, the disturbance settings above, **A = 4.5 rad/s** and **B = 2.5 rad/s**. Its exact source hashes and full per-seed results are in [the solver report](../qa/research-robustness-3.11.json). These are numerical results, not vehicle calibration or browser driving evidence.

| Controller / delay | Recovered | Mean height RMSE | Mean actual gas | Worst saturation |
|---|---:|---:|---:|---:|
| A / 0 ms | 5 / 5 | 0.0224 m | 471.36 kg | 0.258 s |
| B / 0 ms | 5 / 5 | 0.0478 m | 476.49 kg | 0.483 s |
| A / 120 ms | 0 / 5 | 19.0666 m | 737.81 kg | 7.842 s |
| B / 120 ms | 5 / 5 | 0.0565 m | 475.62 kg | 0.475 s |

The higher response gain improves the zero-delay transient in this example but performs badly with the added delay. The delayed A cases climb away from the target; their small **downward** height loss is not evidence of successful altitude control. The height curve, large RMS error, saturation and failure verdict expose that behavior. This comparison does not claim B is optimal or that the toy observation model matches a particular vehicle sensor.

The gas figures are the model's external-throughput accounting over a 12-second maneuver, not Tesla measurements. Finite-gas tests retain failure caused by pressure or depletion as a real outcome.

## Historical data and limits

The successful-run status correction was **already implemented in the local, unpublished 3.10 commit** and is carried forward. The panel matches completed attempts by complete frozen requests and model/build identity; selecting a historical result does not falsely complete the next configuration. The prior failure, cancellation, interruption and English-status cases remain covered by the inherited workflow check.

One complete 20-case report set occupies about **2.22 MB** in the numerical fixture. The existing 64-record / 4 MiB limit is unchanged. The integration check executes two full batches after loading a real 3.8 historical report: the first batch persists; the second reaches the limit while all pre-existing records remain unchanged. Session-only new results remain available for complete export, with an explicit warning. No oldest-first deletion or archive reset was added.

Historical 3.9 and source-generated local 3.10 live records retain their identities. Exact old-model replay is rejected when that solver is unavailable. Explicit 3.11 recomputation preserves all existing parameters and state, adding only the declared historical-equivalent `verticalAccelerationMps2 = 3` mapping. It does not silently apply the stronger new-session default or call the result exact reproduction.

## Verification and remaining work

```sh
node tests/research-robustness-3.11.test.mjs
node qa/research-robustness-3.11-dom-check.mjs /tmp/roadster-dom-qa/node_modules/jsdom
node tests/history-compatibility-3.11.test.mjs
```

The first check runs the actual solver, seed pairing, repeated execution, export/import, failure and aggregate matching. The second exercises DOM events and actual solver reports through a Worker facade, including storage exhaustion and bilingual presentation. It does not establish native browser Worker timing, layout, WebGL quality or FPS. The third uses records produced by the actual prior source versions.

The wider attitude capture map, minimum recovery-height study, and route/landing/gas-budget challenges remain future work from the existing plan. This release completes the bounded multi-seed comparison without presenting those other designs as shipped features.
