#!/usr/bin/env python3
"""Plot retained Roadster numerical traces; never synthesize rendered evidence.

Run from any directory: python scripts/plot-dynamics-3.11.py
Requires numpy and matplotlib. Inputs are the full, unchanged 20 Hz traces and
their 120 Hz summary metrics. Selection is by the declared protocol, not row ID.
"""

from pathlib import Path
import hashlib
import json
import os
import tempfile

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "roadster-mpl"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "qa/vehicle-dynamics-curves-3.11.json"
OUT = ROOT / "qa/figures"
DATA = json.loads(INPUT.read_text())
assert DATA["schema"] == "roadster.numerical-control-curves"
assert DATA["solverHz"] == 120 and DATA["sampleHz"] == 20
OUT.mkdir(parents=True, exist_ok=True)
COLORS = {"before": "#ba624b", "after": "#087c82", "manual": "#087c82", "X": "#6954a4"}
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9.2,
    "axes.titlesize": 10.4, "axes.labelsize": 9.2,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.edgecolor": "#a5aeb6", "axes.labelcolor": "#283746",
    "xtick.color": "#435364", "ytick.color": "#435364",
    "grid.color": "#d8e0e6", "grid.linewidth": .6,
    "axes.axisbelow": True, "savefig.facecolor": "white",
    "svg.fonttype": "none", "svg.hashsalt": "roadster-dynamics-3.11",
})
PROVENANCE = {
    "input": str(INPUT.relative_to(ROOT)),
    "inputSha256": hashlib.sha256(INPUT.read_bytes()).hexdigest(),
    "modelVersion": DATA["modelVersion"], "solverHz": 120, "curveHz": 20,
    "scope": "Numerical solver figures. No WebGL, human input, camera or FPS acceptance.",
    "selections": {},
}


def channel(section, run, name):
    """Use the recorded schema; missing or non-numeric channels fail loudly."""
    columns = DATA[section]["columns"]
    idx = columns.index(name)
    assert all(len(row) == len(columns) for row in run["rows"])
    values = np.asarray([row[idx] for row in run["rows"]], dtype=float)
    assert np.isfinite(values).all(), (run["id"], name)
    return values


def style_time(ax, end, measured=False):
    ax.grid(True)
    ax.set_xlim(0, end)
    if measured:
        ax.axvspan(1, 5, color="#527a91", alpha=.06, lw=0)
        for boundary in (1, 5):
            ax.axvline(boundary, color="#86949f", lw=.7, ls=":")


def save(fig, stem):
    description = ("Actual recorded numerical traces, 120 Hz solver / 20 Hz curves; "
                   "not rendered graphics or performance evidence. Input SHA256: "
                   + PROVENANCE["inputSha256"])
    fig.savefig(OUT / (stem + ".svg"), metadata={"Date": None, "Description": description})
    svg = OUT / (stem + ".svg")
    svg.write_text("\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n")
    fig.savefig(OUT / (stem + ".png"), dpi=145,
                metadata={"Description": description})
    plt.close(fig)


def road_pair(speed, surface, power):
    selected = [r for r in DATA["handling"]["runs"]
                if r["configuration"] == {"speedKmh": speed, "steer": 1,
                    "power": power, "surface": surface, "kind": "step",
                    "seconds": 6, "params": {}}]
    assert len(selected) == 2, (speed, surface, power)
    pair = {r["id"].split("-")[0]: r for r in selected}
    assert set(pair) == {"before", "after"}
    assert pair["before"]["configuration"] == pair["after"]["configuration"]
    return pair


def plot_road():
    cases = [(90, "dry", "coast", "Dry · 90 km/h entry · coast"),
             (90, "wet", "frozen", "Wet · 90 km/h entry · 2% throttle"),
             (54, "dry", "full", "Dry · 54 km/h entry · full throttle")]
    fig, axes = plt.subplots(3, 4, figsize=(15.0, 10.25))
    fig.subplots_adjust(left=.065, right=.985, top=.864, bottom=.135, wspace=.36, hspace=.53)
    fig.suptitle("Roadster Flight Lab 3.11 | Measured road response", x=.065, y=.977,
                 ha="left", fontsize=18, fontweight="bold", color="#203347")
    fig.text(.065, .941, "Matched protocol per pair: 1 s pedal settling → 4 s steering → 1 s settling. "
             "Shading marks the measured interval.", fontsize=10, color="#526474")
    fig.legend(handles=[Line2D([], [], color=COLORS["before"], ls="--", lw=2,
                              label="Retained 3.10 solver (before)"),
                        Line2D([], [], color=COLORS["after"], lw=2, label="3.11 solver (after)")],
               loc="upper left", bbox_to_anchor=(.06, .923), frameon=False, ncol=2)
    for row_index, (speed, surface, power, title) in enumerate(cases):
        pair = road_pair(speed, surface, power)
        PROVENANCE["selections"][title] = {key: r["id"] for key, r in pair.items()}
        for key, run in pair.items():
            t = channel("handling", run, "timeS")
            line = dict(color=COLORS[key], lw=1.9, ls="--" if key == "before" else "-")
            for col, name in enumerate(("speedKmh", "bodyBetaDeg", "yawRateDegS")):
                axes[row_index, col].plot(t, channel("handling", run, name), **line)
            # Plan view covers the measured interval only. Translate each start
            # to the turn-onset origin; no rotations or scale fitting are applied.
            active = (t >= 1) & (t < 5)
            x, z = (channel("handling", run, name)[active] for name in ("xM", "zM"))
            x, z = x - x[0], z - z[0]
            path = axes[row_index, 3]
            path.plot(x, z, **line)
            path.plot(x[-1], z[-1], marker="^", ms=5, color=COLORS[key])
            path.plot(x[0], z[0], marker="o", ms=3, color=COLORS[key])
        before, after = (pair[k]["metrics"] for k in ("before", "after"))
        axes[row_index, 0].set_title(title, loc="left", fontweight="bold", pad=11)
        axes[row_index, 1].set_title("Peak |β|: %.2f° → %.2f°" %
            (before["peakBodySlipDeg"], after["peakBodySlipDeg"]), loc="left", pad=11)
        axes[row_index, 2].set_title("Actual yaw response", loc="left", pad=11)
        axes[row_index, 3].set_title("Path during steering (1–5 s)", loc="left", pad=11)
        for col, label in enumerate(("Actual speed (km/h)", "Body sideslip β (deg)", "Yaw rate (deg/s)")):
            ax = axes[row_index, col]
            ax.set_ylabel(label)
            ax.set_xlabel("Time from protocol start (s)")
            style_time(ax, 6, measured=True)
        path.set_xlabel("Lateral displacement Δx (m)")
        path.set_ylabel("Forward displacement Δz (m)")
        path.set_aspect("equal", adjustable="datalim")
        path.grid(True)
    fig.text(.065, .078, "All cases use full normalized steering input with each solver's speed-dependent wheel-angle mapping. "
             "The 90 km/h wet case holds throttle at 0.02 during steering.", fontsize=9)
    fig.text(.065, .055, "Speeds are measured, not constrained: full throttle accelerates the 3.11 car from %.2f to %.2f km/h; "
             "cornering TCS limits torque for the entire 4 s." %
             (after["startSpeedKmh"], after["endSpeedKmh"]), fontsize=9)
    fig.text(.065, .029, "Numerical fixed-step solver · 120 Hz statistics / 20 Hz curves · flat world · "
             "no keyboard/camera, WebGL or FPS verdict. Peaks come from the 120 Hz record.", fontsize=9, color="#526474")
    save(fig, "dynamics-3.11-road")


def flight_run(identity):
    matches = [r for r in DATA["flight"]["runs"] if r["id"] == identity]
    assert len(matches) == 1 and matches[0]["accepted"]
    return matches[0]


def plot_flight():
    cases = [
        ("Standard · 180°/s, 360°/s²", "3.11-default-X",
         "3.11-default-full-manual-roll-G", "Manual: roll → release → G (no pre-climb)"),
        ("Maneuver · 240°/s, 480°/s²", "3.11-maneuver-X",
         "3.11-maneuver-E14-roll-G", "Manual: E at 14 m/s → roll → release → G"),
    ]
    fig, axes = plt.subplots(4, 2, figsize=(12.0, 12.4), sharex="col")
    fig.subplots_adjust(left=.095, right=.965, top=.83, bottom=.152, hspace=.23, wspace=.25)
    fig.suptitle("Roadster Flight Lab 3.11 | Manual roll and X", x=.095, y=.975,
                 ha="left", fontsize=18, fontweight="bold", color="#203347")
    fig.text(.095, .944, "Each column starts upright at 80 m, stationary, G off, with identical response settings. "
             "Real actuator limits remain active.", fontsize=9.5, color="#526474")
    fig.text(.095, .922, "Constant-pressure numerical bench; supplied gas is counted. "
             "These cases do not establish feasibility with a finite tank.", fontsize=9.5, color="#526474")
    fig.legend(handles=[Line2D([], [], color=COLORS["X"], ls="--", lw=2, label="Automatic X"),
                        Line2D([], [], color=COLORS["manual"], lw=2, label="Manual inputs, then G")],
               loc="upper left", bbox_to_anchor=(.09, .908), frameon=False, ncol=2)
    for col, (title, automatic_id, manual_id, subtitle) in enumerate(cases):
        auto, manual = flight_run(automatic_id), flight_run(manual_id)
        for key in ("height", "axis", "levelInitially", "params"):
            assert auto["configuration"][key] == manual["configuration"][key], key
        assert auto["metrics"]["firstContact"] is None and manual["metrics"]["firstContact"] is None
        PROVENANCE["selections"][title] = {"X": automatic_id, "manual": manual_id}
        axes[0, col].set_title(title + "\n" + subtitle, loc="left", pad=14, fontsize=10.1, fontweight="bold")
        max_time = max(auto["metrics"]["durationS"], manual["metrics"]["durationS"])
        for key, run in (("X", auto), ("manual", manual)):
            t = channel("flight", run, "timeS")
            roll = np.rad2deg(np.unwrap(np.deg2rad(channel("flight", run, "rollDeg"))))
            nozzle_names = [c for c in DATA["flight"]["columns"] if c.endswith("_actualN")]
            thrust = np.sum([channel("flight", run, name) for name in nozzle_names], axis=0)
            assert np.allclose(thrust, channel("flight", run, "thrustN"), rtol=1e-12, atol=1e-8)
            traces = [roll, channel("flight", run, "rollRateDegS"),
                      channel("flight", run, "heightM") - run["configuration"]["height"], thrust / 1000]
            for row, values in enumerate(traces):
                axes[row, col].plot(t, values, color=COLORS[key], lw=1.75,
                                    ls="--" if key == "X" else "-")
                axes[row, col].plot(t[-1], values[-1], color=COLORS[key], marker="o", ms=3)
        for row, label in enumerate(("Actual roll (deg, unwrapped)", "Actual body roll rate (deg/s)",
                                      "Height above start (m)", "Delivered nozzle thrust sum (kN)")):
            style_time(axes[row, col], np.ceil(max_time))
            axes[row, col].set_ylabel(label)
        axes[0, col].axhline(360, ls=":", color="#87939e", lw=.7)
        axes[2, col].axhline(0, ls=":", color="#87939e", lw=.7)
        axes[3, col].set_xlabel("Time from same initial state (s)")
    fig.text(.095, .11, "Manual input is released after one integrated revolution; G is enabled 0.30 s later. "
             "Time axes include each method's full preparation and recovery.", fontsize=9)
    fig.text(.095, .087, "X returns to the initial height. Manual E + roll then G captures a higher hover: "
             "the maneuver pair ends at %.2f m (X) and %.2f m (manual)." %
             (auto["metrics"]["finalHeightM"], manual["metrics"]["finalHeightM"]), fontsize=9)
    fig.text(.095, .064, "Thrust is the sum of actual nozzle-force magnitudes, not vertical support force. "
             "The solid line ends when manual recovery criteria are met; it is not extended.", fontsize=9)
    fig.text(.095, .035, "Numerical fixed-step solver · 120 Hz statistics / 20 Hz curves · flat world · "
             "no WebGL, human control feel or FPS acceptance.", fontsize=9, color="#526474")
    save(fig, "dynamics-3.11-flight")


if __name__ == "__main__":
    plot_road()
    plot_flight()
    (OUT / "dynamics-3.11-provenance.json").write_text(json.dumps(PROVENANCE, indent=2) + "\n")
    print(json.dumps({"output": str(OUT), "inputSha256": PROVENANCE["inputSha256"],
                      "selections": PROVENANCE["selections"]}, indent=2))
