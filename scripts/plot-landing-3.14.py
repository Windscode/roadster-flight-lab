#!/usr/bin/env python3
"""Plot retained solver evidence, without rerunning or resampling the solver.

Usage: python scripts/plot-landing-3.14.py
The fixture must match the current model-build.js, or --expect-build explicitly.
Only recorded samples, control decisions, exact contact events and 120 Hz
summary fields are used. No smoothed, inferred or reconstructed trajectory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re

os.environ.setdefault("MPLCONFIGDIR", "/tmp/roadster-landing-matplotlib")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import MultipleLocator

ROOT = Path(__file__).resolve().parents[1]
BLUE, ORANGE, RED = "#2563A6", "#AD6322", "#B43748"
INK, MUTED, GRID = "#203047", "#59677A", "#E2E7ED"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def state_without_hash(record):
    return {k: v for k, v in record["initialControllerState"].items() if k != "hash"}


def load_records(path, expected_build):
    raw = path.read_bytes()
    library = json.loads(raw)
    require(library["schema"] == "roadster.landing-library", "Wrong fixture schema")
    records = library["records"]
    require(len(records) == 3, "Expected exactly two bench runs and one finite failure")
    bench = [r for r in records if r["supplyMode"] == "bench"]
    finite = [r for r in records if r["supplyMode"] == "finite"]
    require(len(bench) == 2 and len(finite) == 1, "Unexpected supply-mode fixture set")
    pd = next(r for r in bench if r["algorithm"]["nodeCount"] == 7)
    pi = next(r for r in bench if r["algorithm"]["nodeCount"] == 13)
    failure = finite[0]
    for record in [pd, pi, failure]:
        require(record["identity"]["modelBuildId"] == expected_build,
                "Fixture is stale: expected build " + expected_build + "; found " + record["identity"]["modelBuildId"])
        require(record["identity"]["modelVersion"] == "3.14.0", "Review the figure for a new model version")
        require(record["summary"]["statisticsHz"] == 120 and record["summary"]["count"] == record["stepCount"], "Incomplete 120 Hz statistics")
        require(record["sampling"]["curveHz"] == 20 and record["sampling"]["decimated"] is False, "Expected retained 20 Hz curves")
        require(record["algorithm"]["controlHz"] == 60, "Review control-rate caption")
        require(record["sampling"]["storedCount"] == len(record["samples"]), "Stored sample count mismatch")
        require(all(math.isfinite(s["heightM"]) and math.isfinite(s["targetHeightM"]) for s in record["samples"]), "Non-finite height")
        require(all(isinstance(io.get("actuatorRequest"), dict) and isinstance(io["actuatorRequest"].get("active"), bool) and math.isfinite(io["output"]) and (not io["actuatorRequest"]["active"] or math.isfinite(io["actuatorRequest"]["applied"])) for io in record["controllerIO"]), "Missing command/application-status evidence")
        event = next(e for e in record["events"] if e["type"] == "first_contact")
        require(event["detail"] == record["summary"]["firstContact"], "Contact summary/event mismatch")
        require(record["task"]["nozzleScale"] == 1, "Nozzle derating would change the caption")
    require(pd["initialSnapshot"]["physical"] == pi["initialSnapshot"]["physical"], "Bench initial physical states differ")
    require(pd["task"] == pi["task"] and pd["taskId"] == pi["taskId"], "Bench tasks differ")
    require(state_without_hash(pd) == state_without_hash(pi), "Bench controller initial states differ")
    require(pd["identity"] == pi["identity"] and pd["collisionIdentity"] == pi["collisionIdentity"], "Bench model/collision identities differ")
    require(pd["status"] == pi["status"] == "completed", "Bench completion assumption changed")
    require(pd["task"]["initialPressureBar"] == 350, "Bench pressure changed")
    require(failure["task"]["initialPressureBar"] == 100, "Finite pressure changed")
    require(failure["algorithm"]["algorithm"] == pd["algorithm"]["algorithm"], "Finite law differs from PD")
    require(failure["status"] == "failed" and failure["reason"] == "hard_or_tilted_touchdown", "Finite failure changed")
    require(failure["failureEvidence"] is None, "This figure requires a physical landing failure, not a solver fault")
    require(failure["taskId"] != pd["taskId"] and failure["initialSnapshot"]["physical"] != pd["initialSnapshot"]["physical"], "Separate-failure caption must match changed conditions")
    require(pd["summary"]["onboardDischargedKg"] == pi["summary"]["onboardDischargedKg"] == 0, "Bench onboard consumption assumption changed")
    require(failure["summary"]["externalSupplyKg"] == 0, "Finite result includes external supply")
    return pd, pi, failure, hashlib.sha256(raw).hexdigest()


def style_axis(ax, xmax, ylim, ylabel):
    ax.set_xlim(0, xmax)
    ax.set_ylim(*ylim)
    ax.set_ylabel(ylabel, color=INK)
    ax.grid(axis="y", color=GRID, linewidth=0.65)
    ax.spines[["top", "right"]].set_visible(False)
    for spine in ("left", "bottom"):
        ax.spines[spine].set_color("#BAC4D0")
        ax.spines[spine].set_linewidth(0.7)
    ax.tick_params(colors=MUTED, width=0.6, length=3)
    ax.set_axisbelow(True)


def height_trace(ax, record, color, target=False):
    samples = record["samples"]
    if target:
        ax.plot([s["timeS"] for s in samples], [s["targetHeightM"] for s in samples], color="#788392", linewidth=1.2, linestyle=(0, (4, 3)), zorder=2)
    ax.plot([s["timeS"] for s in samples], [s["heightM"] for s in samples], color=color, linewidth=1.7, zorder=4)
    contact = record["summary"]["firstContact"]
    ax.scatter([contact["timeS"]], [contact["position"]["y"]], marker="o", s=30, color="white", edgecolor=color, linewidth=1.3, zorder=6)
    if record["status"] == "completed":
        ax.scatter([record["durationS"]], [samples[-1]["heightM"]], marker="s", s=24, color=color, edgecolor="white", linewidth=0.5, zorder=6)


def command_trace(ax, record, color):
    decisions = record["controllerIO"]
    # These are the physics hook's applied bounded acceleration requests, not
    # the body's measured acceleration or the unconstrained AST expressions.
    times = [d["timeS"] for d in decisions]
    ax.step(times, [d["actuatorRequest"]["applied"] if d["actuatorRequest"]["active"] else math.nan for d in decisions], where="post", color=color, linewidth=1.25)
    # Inactive rows retain the previous applied value in telemetry. Never draw
    # that stale value as a newly applied command after surface contact.
    ax.step(times, [math.nan if d["actuatorRequest"]["active"] else d["output"] for d in decisions], where="post", color=color, linewidth=1.1, linestyle=(0, (3, 2)))


def thrust_trace(ax, record, color):
    samples = record["samples"]
    ax.plot([s["timeS"] for s in samples], [sum(n["actualN"] for n in s["nozzleThrustN"] if n["id"].startswith("lift-")) / 1000 for s in samples], color=color, linewidth=1.5)


def metrics_table(fig, pd, pi, finite):
    left = fig.add_axes([0.083, 0.095, 0.518, 0.116])
    left.axis("off")
    left.text(0, 1.13, "COMPLETE TASK METRICS  ·  all 120 Hz states", fontsize=8.4, weight="bold", color=INK)
    rows = [
        ["Stable landing / s", f'{pd["durationS"]:.3f}', f'{pi["durationS"]:.3f}'],
        ["Contact descent speed / m/s", f'{pd["summary"]["firstContact"]["preContactVerticalMps"]:.3f}', f'{pi["summary"]["firstContact"]["preContactVerticalMps"]:.3f}'],
        ["Height RMSE / m", f'{pd["summary"]["heightRmseM"]:.3f}', f'{pi["summary"]["heightRmseM"]:.3f}'],
        ["External gas throughput / kg", f'{pd["summary"]["externalSupplyKg"]:.3f}', f'{pi["summary"]["externalSupplyKg"]:.3f}'],
    ]
    table = left.table(cellText=rows, colLabels=["", "PD", "Edited PI"], colWidths=[0.62, 0.19, 0.19], cellLoc="right", colLoc="right", bbox=[0, 0, 1, 1])
    table.auto_set_font_size(False)
    table.set_fontsize(8.2)
    for (row, col), cell in table.get_celld().items():
        cell.set_linewidth(0)
        cell.PAD = 0.025
        cell.get_text().set_color(INK)
        if col == 0:
            cell.get_text().set_ha("left")
        if row == 0:
            cell.get_text().set_weight("bold")
            cell.get_text().set_color(BLUE if col == 1 else ORANGE if col == 2 else INK)
        elif row % 2 == 0:
            cell.set_facecolor("#F2F5F8")
    right = fig.add_axes([0.699, 0.091, 0.278, 0.126])
    right.axis("off")
    s = finite["summary"]
    right.text(0, 1.03, "PHYSICAL FAILURE  ·  no solver fault", fontsize=8.4, weight="bold", color=RED)
    right.text(0, 0.85,
               f'Hard touchdown at {finite["durationS"]:.3f} s\n'
               f'Contact descent: {s["firstContact"]["preContactVerticalMps"]:.3f} m/s\n'
               f'Onboard gas discharged: {s["onboardDischargedKg"]:.3f} kg\n'
               f'Gas remaining: {s["gasRemainingKg"]:.3f} kg\n'
               f'Allocation / pressure limited: {s["saturationSeconds"]:.3f} s',
               fontsize=8.5, color=INK, linespacing=1.4, va="top")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "qa/landing-task-fixtures-3.14.json")
    parser.add_argument("--output", type=Path, default=ROOT / "qa/landing-response-3.14.svg")
    parser.add_argument("--expect-build", default=None)
    args = parser.parse_args()
    build = args.expect_build or re.search(r'MODEL_BUILD_ID="([0-9a-f]{64})"', (ROOT / "dist/model-build.js").read_text()).group(1)
    pd, pi, failure, input_hash = load_records(args.input, build)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9.0, "axes.labelsize": 9.0,
                         "xtick.labelsize": 8.3, "ytick.labelsize": 8.3, "figure.facecolor": "white",
                         "svg.fonttype": "path", "svg.hashsalt": "roadster-landing-3.14"})
    fig = plt.figure(figsize=(10.6, 9.7))
    gs = fig.add_gridspec(3, 2, left=0.083, right=0.977, bottom=0.274, top=0.846,
                         width_ratios=[1.6, 1], height_ratios=[1.48, 1, 1], hspace=0.27, wspace=0.31)
    axes = [[fig.add_subplot(gs[row, col]) for col in range(2)] for row in range(3)]
    fig.text(0.083, 0.966, "Changing the control law changes the landing", fontsize=17.4, weight="bold", color=INK)
    fig.text(0.083, 0.943, "Roadster Flight Lab 3.14  /  retained actual-solver evidence  /  VECTOR 07", fontsize=9.6, color=MUTED)
    fig.text(0.083, 0.906, "A  SAME INITIAL STATE + TASK", fontsize=10.4, weight="bold", color=INK)
    fig.text(0.083, 0.888, "350 bar external supply · only the height control law changes", fontsize=8.8, color=MUTED)
    fig.text(0.699, 0.906, "B  SEPARATE FAILURE CASE", fontsize=10.4, weight="bold", color=RED)
    fig.text(0.699, 0.888, "PD · finite 100 bar · different gas / initial state", fontsize=8.4, color=MUTED)
    fig.legend(handles=[Line2D([0], [0], color=BLUE, lw=2, label="PD"), Line2D([0], [0], color=ORANGE, lw=2, label="Edited PI + filter (Kp 1.8)"), Line2D([0], [0], color="#788392", ls="--", lw=1.2, label="Recorded target")], loc="lower left", bbox_to_anchor=(0.075, 0.849), ncol=3, frameon=False, fontsize=8.0, handlelength=2, columnspacing=1.5)
    fig.legend(handles=[Line2D([0], [0], color=RED, lw=2, label="Finite PD"), Line2D([0], [0], color=INK, marker="o", mfc="white", ls="none", label="First contact")], loc="lower left", bbox_to_anchor=(0.69, 0.849), ncol=2, frameon=False, fontsize=8.0, columnspacing=1)
    for row in range(3):
        style_axis(axes[row][0], 12, [(0, 3.12), (-1.25, 2.05), (0, 26)][row], ["World CG height / m", "Height command / m/s²", "Four lift nozzles / kN"][row])
        style_axis(axes[row][1], 2.25, [(0, 3.12), (-1.25, 6.65), (0, 26)][row], "")
        axes[row][0].xaxis.set_major_locator(MultipleLocator(2))
        axes[row][1].xaxis.set_major_locator(MultipleLocator(0.5))
        if row < 2:
            axes[row][0].tick_params(labelbottom=False)
            axes[row][1].tick_params(labelbottom=False)
    axes[0][0].yaxis.set_major_locator(MultipleLocator(1))
    axes[0][1].yaxis.set_major_locator(MultipleLocator(1))
    for record, color in [(pd, BLUE), (pi, ORANGE)]:
        height_trace(axes[0][0], record, color, target=record is pi)
        command_trace(axes[1][0], record, color)
        thrust_trace(axes[2][0], record, color)
    height_trace(axes[0][1], failure, RED, target=True)
    command_trace(axes[1][1], failure, RED)
    thrust_trace(axes[2][1], failure, RED)
    axes[1][0].axhline(0, color="#AAB4C0", linewidth=0.6)
    axes[1][1].axhline(0, color="#AAB4C0", linewidth=0.6)
    axes[1][1].axhline(6, color="#8B96A5", linewidth=0.8, linestyle=(0, (3, 3)))
    axes[1][1].text(0.04, 6.12, "+6 request limit", fontsize=7.6, color=MUTED)
    axes[1][0].text(0.02, 0.04, "Solid: active hook  ·  dashed: inactive request", transform=axes[1][0].transAxes, ha="left", va="bottom", fontsize=7.4, color=MUTED)
    for t, label in [(2, "wind 1"), (4, "wind 2"), (7.5, "calm")]:
        axes[0][0].axvline(t, color="#BEC7D2", linewidth=0.7, linestyle=(0, (2, 3)), zorder=1)
        axes[0][0].text(t + 0.08, 3.0, label, fontsize=7.4, color=MUTED)
    axes[0][1].axvline(2, color="#BEC7D2", linewidth=0.7, linestyle=(0, (2, 3)), zorder=1)
    contact = failure["summary"]["firstContact"]
    axes[0][1].annotate(f'Contact at {contact["timeS"]:.3f} s', xy=(contact["timeS"], contact["position"]["y"]), xytext=(0.62, 0.22), textcoords="data", fontsize=7.8, color=RED, arrowprops={"arrowstyle": "-", "color": RED, "lw": 0.8})
    axes[0][0].text(0.98, 0.08, "○ first contact   ■ stable landing", ha="right", transform=axes[0][0].transAxes, fontsize=7.6, color=MUTED)
    axes[2][0].set_xlabel("Task time / s")
    axes[2][1].set_xlabel("Task time / s  (shorter failure window)")
    metrics_table(fig, pd, pi, failure)
    fig.text(0.083, 0.071, "Traces: retained 20 Hz samples; requests: all 60 Hz decisions. Metrics and contact events: 120 Hz. No smoothing or curve-derived metrics.", fontsize=7.6, color=MUTED)
    fig.text(0.083, 0.056, "Commands are not measured body acceleration. Thrust is actual main-nozzle force sum. Bench gas is external throughput; finite gas is onboard discharge.", fontsize=7.6, color=MUTED)
    fig.text(0.083, 0.039, f'Tasks: A {pd["taskId"]}  /  B {failure["taskId"]}  ·  source: qa/landing-task-fixtures-3.14.json', fontsize=6.9, color=MUTED)
    fig.text(0.083, 0.025, f'Model 3.14.0  ·  build {build}  ·  numerical evidence, not a 3D after-image', fontsize=6.9, color=MUTED)
    provenance = {"schema": "roadster.landing-figure", "version": 1, "modelVersion": "3.14.0", "modelBuildId": build,
                  "input": str(args.input.relative_to(ROOT)), "inputSHA256": input_hash,
                  "generator": "scripts/plot-landing-3.14.py", "generatorSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  "records": [{"id": r["id"], "taskId": r["taskId"], "algorithmHash": r["algorithm"]["hash"], "initialStateLabel": r["initialSnapshot"]["stateLabel"], "collisionIdentity": r["collisionIdentity"], "status": r["status"], "reason": r["reason"], "statisticsHz": r["summary"]["statisticsHz"], "statisticsCount": r["summary"]["count"], "displaySamples": len(r["samples"]), "controllerDecisions": len(r["controllerIO"]), "activeCommandDecisions": sum(1 for d in r["controllerIO"] if d["actuatorRequest"]["active"]), "inactiveRequestDecisions": sum(1 for d in r["controllerIO"] if not d["actuatorRequest"]["active"])} for r in [pd, pi, failure]],
                  "benchComparison": "Only algorithm differs; complete initial physical snapshot, initial state values, task, model and collision identity checked equal.",
                  "finiteComparison": "Separate descriptive failure; gas mode, initial pressure, initial state and task identity differ. Not a single-factor controller comparison.",
                  "dataScope": "Height, target and actual main-nozzle forces from retained 20 Hz samples; active applied acceleration request from 60 Hz controller IO, with inactive requests separately dashed and stale applied values omitted; exact contact markers and all metrics from 120 Hz event/summary records. No interpolation, smoothing or inferred peak.",
                  "gasScope": "Bench externalSupplyKg to its own completed task endpoint; finite onboardDischargedKg and gasRemainingKg at physical failure. Never equate throughput with onboard tank use."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.output, metadata={"Title": "Roadster Flight Lab 3.14: control-law and landing comparison", "Description": canonical(provenance), "Date": None})
    # Matplotlib emits spaces before path-data line breaks. Normalize only
    # text whitespace so the checked-in vector remains clean and reproducible.
    args.output.write_text("\n".join(line.rstrip() for line in args.output.read_text().splitlines()) + "\n")
    png = args.output.with_suffix(".png")
    fig.savefig(png, dpi=160, metadata={"Title": "Roadster Flight Lab 3.14 actual-solver landing evidence", "Description": canonical(provenance)})
    plt.close(fig)
    sidecar = args.output.with_name(args.output.stem + "-provenance.json")
    sidecar.write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"svg": str(args.output), "png": str(png), "provenance": str(sidecar), "modelBuildId": build, "inputSHA256": input_hash}))


if __name__ == "__main__":
    main()
