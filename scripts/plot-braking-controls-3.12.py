#!/usr/bin/env python3
"""Plot the retained 3.11/3.12 braking traces without rerunning the solver.

Run from any directory: python scripts/plot-braking-controls-3.12.py
Requires the existing numpy and matplotlib packages; installs nothing.
Reads only qa/braking-controls-curves-3.12.json. Writes the PNG and SVG under
qa/figures. All lines use saved samples; statistics use the input's 120 Hz
metrics. No resampling, smoothing, invented endpoints, or trajectory fit.
"""

from pathlib import Path
import hashlib
import json
import math
import os
import tempfile

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "roadster-mpl"))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np


ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "qa/braking-controls-curves-3.12.json"
OUTPUT = ROOT / "qa/figures/braking-turn-3.12"
STAGES = ("published-3.11", "production-3.12")
SURFACES = ("dry", "wet")
COLORS = {STAGES[0]: "#b7593f", STAGES[1]: "#007f87"}
INK = "#24374a"
SECONDARY = "#536576"


def main():
    raw = INPUT.read_bytes()
    data = json.loads(raw)
    assert data["schema"] == "roadster.numerical-braking-curves"
    assert data["version"] == 1 and data["modelVersion"] == "3.12.0"
    assert data["solverHz"] == 120 and data["sampleHz"] == 20
    digest = hashlib.sha256(raw).hexdigest()
    columns = data["columns"]
    assert len(columns) == len(set(columns)), "Ambiguous recorded columns"
    indices = {name: i for i, name in enumerate(columns)}

    def channel(run, name):
        assert all(len(row) == len(columns) for row in run["rows"])
        values = np.asarray([row[indices[name]] for row in run["rows"]], dtype=float)
        assert np.isfinite(values).all(), (run["stage"], name)
        return values

    def select(surface, stage):
        configuration = {
            "speedKmh": 90, "surface": surface, "steer": 1,
            "brake": .15, "throttle": 0, "seconds": 4,
            "stopAtRest": False, "settle": True,
        }
        matches = [run for run in data["runs"]
                   if run["stage"] == stage and run["configuration"] == configuration]
        assert len(matches) == 1, (surface, stage, len(matches))
        run = matches[0]
        times = channel(run, "timeS")
        assert len(times) == 80
        assert np.allclose(times, 1 / 120 + np.arange(80) / 20,
                           rtol=0, atol=1e-12)
        for name, value in (("inputSteer", 1), ("inputBrake", .15),
                            ("inputThrottle", 0), ("contacts", 4),
                            ("rigidContacts", 0)):
            assert np.all(channel(run, name) == value), name
        requests = sum(channel(run, wheel + "_brakeRequestN")
                       for wheel in ("FR", "FL", "RR", "RL"))
        assert np.allclose(requests, 6300, rtol=0, atol=1e-7)
        metrics = run["metrics"]
        assert metrics["durationSeconds"] == 4
        assert metrics["minimumContacts"] == 4
        assert metrics["hullContactSteps"] == metrics["wheelStopContactSteps"] == 0
        return run

    pairs = {surface: {stage: select(surface, stage) for stage in STAGES}
             for surface in SURFACES}
    for pair in pairs.values():
        before, after = (pair[stage] for stage in STAGES)
        assert before["configuration"] == after["configuration"]
        assert math.isclose(before["metrics"]["initialSpeedKmh"],
                            after["metrics"]["initialSpeedKmh"], abs_tol=1e-10)

    # Plan views share the same limits and equal metre scales. Translate each
    # run by its first retained sample; do not rotate it or infer a missing t=0.
    paths = {}
    for surface, pair in pairs.items():
        for stage, run in pair.items():
            x = channel(run, "xM")
            z = channel(run, "zM")
            paths[surface, stage] = (x - x[0], z - z[0])
    max_x = max(x.max() for x, z in paths.values())
    max_z = max(z.max() for x, z in paths.values())
    path_xlim = (-5, math.ceil(max_z / 10) * 10 + 5)
    path_ylim = (-5, math.ceil(max_x / 10) * 10 + 5)

    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 10,
        "axes.labelsize": 10, "axes.labelcolor": INK,
        "axes.edgecolor": "#a5b0ba", "axes.linewidth": .7,
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.axisbelow": True, "xtick.color": SECONDARY,
        "ytick.color": SECONDARY, "xtick.labelsize": 9.5,
        "ytick.labelsize": 9.5, "grid.color": "#dce3e8",
        "grid.linewidth": .65, "savefig.facecolor": "white",
        "svg.fonttype": "none", "svg.hashsalt": "roadster-braking-3.12",
    })
    fig, axes = plt.subplots(2, 4, figsize=(18.2, 10.3))
    fig.subplots_adjust(left=.058, right=.976, top=.752, bottom=.212,
                        wspace=.31, hspace=.68)
    fig.suptitle("Roadster Flight Lab 3.12 | Braking during a turn",
                 x=.058, y=.978, ha="left", fontsize=21,
                 fontweight="bold", color=INK)
    fig.text(.058, .938,
             "Matched rolling initialization at 90 km/h, then 1 s at 2% throttle; "
             "the measured 4 s use steer = +1, brake = 15%, throttle = 0.",
             fontsize=11, color=SECONDARY)
    fig.text(.058, .913,
             "Existing speed/surface steering maps remain active: wheel angles vary with speed. "
             "Both versions request 6.300 kN total braking.",
             fontsize=10.5, color=SECONDARY)
    fig.legend(handles=[
        Line2D([], [], color=COLORS[STAGES[0]], lw=2.2, ls="--",
               label="Published 3.11 (before)"),
        Line2D([], [], color=COLORS[STAGES[1]], lw=2.2,
               label="Final 3.12 solver (after)"),
    ], loc="upper left", bbox_to_anchor=(.052, .893),
       frameon=False, ncol=2, fontsize=11, handlelength=3)

    def heading(ax, title, statistic):
        ax.set_title(title, loc="left", pad=30, fontsize=11.7,
                     fontweight="bold", color=INK)
        ax.text(0, 1.025, statistic, transform=ax.transAxes,
                fontsize=9.7, color=SECONDARY, va="bottom")

    for row, surface in enumerate(SURFACES):
        pair = pairs[surface]
        before, after = (pair[stage]["metrics"] for stage in STAGES)
        fig.text(.058, axes[row, 0].get_position().y1 + .079,
                 f"{surface.upper()} ROAD  |  actual entry {before['initialSpeedKmh']:.3f} km/h",
                 fontsize=12.3, color=INK, fontweight="bold")
        for stage in STAGES:
            run = pair[stage]
            times = channel(run, "timeS")
            line = dict(color=COLORS[stage], lw=2.0,
                        ls="--" if stage == STAGES[0] else "-")
            axes[row, 0].plot(times, channel(run, "speedKmh"), **line)
            axes[row, 1].plot(times, channel(run, "bodyBetaDeg"), **line)
            grip = np.max([channel(run, wheel + "_grip")
                           for wheel in ("FR", "FL", "RR", "RL")], axis=0)
            axes[row, 2].plot(times, grip, **line)
            x, z = paths[surface, stage]
            path = axes[row, 3]
            path.plot(z, x, **line)
            path.plot(z[0], x[0], marker="o", markersize=5,
                      markerfacecolor="white", markeredgecolor=COLORS[stage], zorder=4)
            path.plot(z[-1], x[-1], marker="^", markersize=7,
                      color=COLORS[stage], zorder=4)

        heading(axes[row, 0], "Actual speed",
                f"4 s terminal: {before['endSpeedKmh']:.3f} → {after['endSpeedKmh']:.3f} km/h")
        heading(axes[row, 1], "Body sideslip β",
                f"Peak |β|, v ≥ 30: {before['peakBodySlipAbove30KmhDeg']:.3f}° "
                f"→ {after['peakBodySlipAbove30KmhDeg']:.3f}°")
        heading(axes[row, 2], "Maximum wheel friction utilization",
                f"Time > 0.99: {before['saturatedAnyWheelSeconds']:.3f} "
                f"→ {after['saturatedAnyWheelSeconds']:.3f} s")
        heading(axes[row, 3], "Plan-view path (equal scale)",
                "○ first  /  ▲ last retained sample")

        for column in range(3):
            ax = axes[row, column]
            ax.set_xlim(0, 4)
            ax.set_xticks([0, 1, 2, 3, 4])
            ax.set_xlabel("Time since turn/brake command (s)")
            ax.grid(True)
        axes[row, 0].set_ylabel("Speed (km/h)")
        axes[row, 0].set_ylim(0, 96)
        axes[row, 0].set_yticks([0, 30, 60, 90])
        axes[row, 0].axhline(30, color="#8e99a3", lw=1, ls=":")
        axes[row, 0].text(.075, 32, "30 km/h statistics cutoff",
                          fontsize=8.8, color=SECONDARY)
        axes[row, 1].set_ylabel("Signed body sideslip (deg)")
        axes[row, 1].axhline(0, color="#a8b1b8", lw=.7)
        axes[row, 1].margins(y=.15)
        axes[row, 2].set_ylabel(r"max$_{wheel}$  $\sqrt{F_x^2+F_y^2}/(\mu F_z)$")
        axes[row, 2].set_ylim(0, 1.08)
        axes[row, 2].set_yticks([0, .25, .5, .75, 1])
        axes[row, 2].axhline(.99, color="#8e99a3", lw=1, ls=":")
        path.set_xlabel("World Δz from first sample (m)")
        path.set_ylabel("World Δx from first sample (m)")
        path.set_xlim(*path_xlim)
        path.set_ylim(*path_ylim)
        path.set_aspect("equal", adjustable="box")
        path.grid(True)

    notes = [
        "Statistics above the panels use every 120 Hz solver step over 4 s. "
        "Peak |β| includes only actual speed ≥ 30 km/h; the signed β curves retain lower speeds.",
        "Friction utilization is the maximum of the four recorded combined-force ratios. "
        "The > 0.99 duration counts any wheel above that threshold, without a speed filter.",
        "Lines join the 80 saved samples at 20 Hz, t = 0.00833–3.95833 s; "
        "they are not extrapolated to 4 s. Path origins are the first saved positions, with no rotation or scale fitting.",
        "This is the full mapped-steering / 15% braking fault case. "
        "Gentle 20% steering was already stable. Both pairs retain four tire contacts and zero rigid contacts throughout.",
        "Flat-world numerical evidence only: no keyboard latency, camera feel, city-route, "
        "WebGL image or GPU/FPS acceptance. Source: qa/braking-controls-curves-3.12.json",
        f"Input SHA-256: {digest}",
    ]
    for y, note in zip((.140, .117, .094, .071, .048, .025), notes):
        fig.text(.058, y, note, fontsize=9.45, color=SECONDARY)

    description = json.dumps({
        "scope": "Recorded numerical solver traces; not a rendered scene or performance verdict.",
        "source": str(INPUT.relative_to(ROOT)), "sourceSha256": digest,
        "modelVersion": data["modelVersion"],
        "solverHz": data["solverHz"], "curveHz": data["sampleHz"],
        "baselinePublishedCommit": data["baselinePublishedCommit"],
        "selections": [{"stage": stage, "configuration": pairs[surface][stage]["configuration"]}
                       for surface in SURFACES for stage in STAGES],
        "curveRangeSeconds": [1 / 120, 1 / 120 + 79 / 20],
        "statisticsRangeSeconds": [0, 4],
        "betaStatisticFilter": "actual speedKmh >= 30; max absolute bodyBetaDeg",
        "saturationStatistic": "any wheel grip > 0.99, counted at 120 Hz over all speeds",
        "pathTransform": "Subtract each run's first saved world x/z; x-axis=delta z, y-axis=delta x; equal metre scales",
    }, ensure_ascii=False, sort_keys=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    svg_path = OUTPUT.with_name(OUTPUT.name + ".svg")
    png_path = OUTPUT.with_name(OUTPUT.name + ".png")
    fig.savefig(svg_path, metadata={"Date": None, "Description": description})
    svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text().splitlines()) + "\n")
    fig.savefig(png_path, dpi=160, metadata={"Description": description})
    plt.close(fig)
    # A concurrent validation run must not silently change the source mid-plot.
    assert INPUT.read_bytes() == raw, "Input changed while plotting; rerun from the saved final record"
    print(f"Wrote {png_path.relative_to(ROOT)} and {svg_path.relative_to(ROOT)}")
    print(f"Input SHA-256: {digest}; 4 runs × 80 samples; 120 Hz statistics / 20 Hz curves")


if __name__ == "__main__":
    main()
