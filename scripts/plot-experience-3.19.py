#!/usr/bin/env python3
"""Plot final QA data only; these are numerical figures, never game screenshots."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "roadster-3.19-matplotlib"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch, Rectangle
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--build-id", required=True)
parser.add_argument("--qa-root", default="qa")
parser.add_argument("--output", default="qa/experience-3.19")
args = parser.parse_args()
qa, out = Path(args.qa_root), Path(args.output)
out.mkdir(parents=True, exist_ok=True)
sources = {}


def load(relative, *, lines=False):
    path = qa / relative
    raw = path.read_bytes()
    sources[str(path)] = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
    return [json.loads(line) for line in raw.splitlines() if line] if lines else json.loads(raw)


surface = load("surface-route-3.19/numerical-report.json")
route = load("surface-route-3.19/route-drive.json")
traces = load("surface-route-3.19/contact-and-sound-curves.ndjson", lines=True)
learning = load("learning-loop-3.19/report.json")
attempts = load("learning-loop-3.19/three-attempts.json")
practice = load("learning-loop-3.19/hard-practice.json")
hard = next(r for r in attempts["records"] if r["reason"] == "hard_or_tilted_landing")
for identity in [surface, route, hard["identity"], practice["identity"]]:
    assert identity["modelBuildId"] == args.build_id, "QA data does not match the declared final build"
assert practice["parentRunId"] == hard["id"]
assert hard["liveExperiment"]["initialSnapshot"]["stateLabel"] == practice["liveExperiment"]["initialSnapshot"]["stateLabel"]
comparison = next(r["comparison"] for r in learning["reviews"] if r["comparison"]["a"] == hard["id"] and r["comparison"]["b"] == practice["id"])
assert comparison["sameInitialState"] and comparison["sameConditions"] and comparison["sameModel"]
assert not comparison["strictControllerAB"]

NAVY, INK, MUTED, GRID = "#17374a", "#18313f", "#526773", "#dce5e8"
DRY, WET, HARD, SOFT = "#c47326", "#137d91", "#bf5047", "#138474"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 10.5, "axes.titlesize": 12.5,
    "axes.titleweight": "semibold", "axes.labelsize": 10, "axes.labelcolor": INK,
    "text.color": INK, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.edgecolor": "#bdcbd0", "axes.spines.top": False, "axes.spines.right": False,
    "figure.facecolor": "white", "axes.facecolor": "#fbfcfd", "savefig.facecolor": "white",
})


def style(ax):
    ax.grid(True, color=GRID, linewidth=.65, zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(labelsize=9)


def heading(fig, title, subtitle):
    fig.text(.055, .965, title, fontsize=23, fontweight="bold", color=NAVY, va="top")
    fig.text(.055, .924, subtitle, fontsize=11.5, color=MUTED, va="top")
    fig.text(.055, .886, "NUMERICAL SOLVER / NOT RENDERED GAMEPLAY", fontsize=10,
             color=NAVY, fontweight="bold", va="top",
             bbox=dict(boxstyle="round,pad=.38", facecolor="#edf3f5", edgecolor="none"))


def save(fig, filename, title):
    path = out / filename
    fig.savefig(path, dpi=220, metadata={"Title": title, "Description": "Numerical solver figure; not rendered gameplay or native keyboard/GPU evidence.", "ModelBuildId": args.build_id})
    plt.close(fig)
    raw = path.read_bytes()
    return {"path": str(path), "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


def route_figure():
    wet = next(d["descriptor"] for d in surface["evidence"]["descriptors"] if d["descriptor"]["presetId"] == "after-rain")
    brake = {r["preset"]: r for r in surface["evidence"]["braking"]}
    curves = {r["preset"]: r for r in traces if r["kind"] == "braking"}
    assert brake["dry-day"]["initial"] == brake["after-rain"]["initial"]
    assert brake["dry-day"]["input"] == brake["after-rain"]["input"] == {"brake": 1}
    fig = plt.figure(figsize=(14, 10))
    heading(fig, "One existing street, two measured responses", "302.5 m prepared route  |  Authored contact map + current-model driving and braking")
    grid = fig.add_gridspec(2, 2, left=.055, right=.96, bottom=.20, top=.825,
                           width_ratios=[1.05, 1.35], hspace=.39, wspace=.24)
    ax_map = fig.add_subplot(grid[:, 0])
    ax_speed = fig.add_subplot(grid[0, 1])
    ax_power = fig.add_subplot(grid[1, 1])
    region_colours = {"asphalt": "#dce2e4", "damp": "#b3d6e1", "metal": "#8d9aa7", "patch": "#baa3c8"}
    for _, region in sorted(enumerate(wet["regions"]), key=lambda item: (item[1]["priority"], item[0])):
        b = region["bounds"]
        ax_map.add_patch(Rectangle((b["minX"], b["minZ"]), b["maxX"]-b["minX"], b["maxZ"]-b["minZ"],
                                  facecolor=region_colours[region["materialId"]], edgecolor="white", linewidth=.5, zorder=1))
    for run, colour, dash in [(next(r for r in route["runs"] if r["preset"] == "dry-day"), DRY, "-"),
                              (next(r for r in route["runs"] if r["preset"] == "after-rain"), WET, "--")]:
        x, z = zip(*[(sample["position"]["x"], sample["position"]["z"]) for sample in run["samples"]])
        ax_map.plot(x, z, color=colour, linestyle=dash, linewidth=2.0, zorder=3)
    start, end = wet["route"]["waypoints"][0], wet["route"]["waypoints"][-1]
    ax_map.scatter([start["x"]], [start["z"]], marker="o", s=42, color=NAVY, edgecolor="white", zorder=4)
    ax_map.scatter([end["x"]], [end["z"]], marker="s", s=42, color=NAVY, edgecolor="white", zorder=4)
    ax_map.annotate("START", (start["x"], start["z"]), xytext=(-18, -18), textcoords="offset points", fontsize=9, fontweight="bold")
    ax_map.annotate("FINISH", (end["x"], end["z"]), xytext=(-24, 12), textcoords="offset points", fontsize=9, fontweight="bold")
    labels = [(-320, "Flush service plate", -320), (-287.5, "Runoff zone", -289),
              (-246.5, "Flush asphalt repair", -250), (-208, "Half-width damp", -211), (-155, "Damp turn approach", -165)]
    for target_z, text, label_z in labels:
        ax_map.annotate(text, xy=(-201, target_z), xytext=(-222, label_z), ha="left", va="center", fontsize=8.5,
                        arrowprops=dict(arrowstyle="-", color="#738b96", linewidth=.8),
                        bbox=dict(boxstyle="round,pad=.25", fc="white", ec="none", alpha=.9), zorder=5)
    ax_map.set_xlim(-226, -125);ax_map.invert_xaxis();ax_map.set_ylim(-390, -116);ax_map.set_aspect("equal")
    ax_map.set_xlabel("World X (m), mirrored as on the city map")
    ax_map.set_ylabel("World Z (m)")
    ax_map.set_title("A  After-rain regions and actual paths", loc="left", pad=13)
    style(ax_map)
    route_handles = [Line2D([0], [0], color=DRY, lw=2, label="Dry route"), Line2D([0], [0], color=WET, lw=2, ls="--", label="Rain route")]
    ax_map.legend(handles=route_handles, loc="lower left", frameon=True, facecolor="white", fontsize=8.5)
    fig.legend(handles=[Patch(facecolor=region_colours[k], label=label) for k, label in [("asphalt", "Asphalt"), ("damp", "Damp zone"), ("metal", "Service plate"), ("patch", "Repair")]],
               loc="lower left", bbox_to_anchor=(.055, .115), ncol=4, fontsize=9, frameon=False, columnspacing=1.2)

    for preset, colour, label in [("dry-day", DRY, "Dry"), ("after-rain", WET, "Local wet")]:
        data, trace = brake[preset], curves[preset]["samples"]
        initial = data["initial"]["position"]
        start_time = data["final"]["timeS"] - data["stopTimeS"]
        rows = trace if trace[-1]["timeS"] == data["final"]["timeS"] else trace + [data["final"]]
        distance = [0] + [math.sqrt(sum((row["position"][axis]-initial[axis])**2 for axis in "xyz")) for row in rows]
        speed = [data["initialSpeedKmh"]] + [row["speedKmh"] for row in rows]
        ax_speed.plot(distance, speed, color=colour, lw=2.4, label=f"{label}: {data['stopDistanceM']:.2f} m")
        ax_speed.scatter([data["stopDistanceM"]], [data["final"]["speedKmh"]], color=colour, edgecolor="white", s=45, zorder=4)
        ax_speed.annotate(f"{data['stopDistanceM']:.2f} m", (data["stopDistanceM"], data["final"]["speedKmh"]),
                          xytext=(-3, 11), textcoords="offset points", ha="right", color=colour, fontweight="bold", fontsize=10)
        times = [row["timeS"]-start_time for row in rows]
        powers = [row["slipPowerW"]/1000 for row in rows]
        ax_power.plot(times, powers, color=colour, lw=2.1, label=f"{label}: ABS active {data['absActiveS']:.2f} s")
    ax_speed.set_title("B  Same initial state, same full brake input", loc="left", pad=13)
    ax_speed.set_xlabel("Distance from braking start (m)");ax_speed.set_ylabel("Speed (km/h)")
    ax_speed.set_xlim(0, 26);ax_speed.set_ylim(-3, 65);style(ax_speed)
    ax_speed.legend(loc="upper right", frameon=False, fontsize=9)
    ax_speed.text(.98, .68, "60 km/h initial speed\nStop criterion: <0.36 km/h", transform=ax_speed.transAxes, ha="right", va="top", color=MUTED, fontsize=9)
    ax_power.set_title("C  Tyre slip work drives the feedback signal", loc="left", pad=13)
    ax_power.set_xlabel("Time after full brake input (s)");ax_power.set_ylabel("Total wheel slip power (kW)")
    style(ax_power);ax_power.legend(loc="upper right", frameon=False, fontsize=9)
    ax_power.set_ylim(bottom=0)
    fig.text(.055, .078, "Map colours identify authored materials; optical wetness and grip are independent. Flat repairs add no collision step.", fontsize=9.5, color=MUTED)
    fig.text(.055, .056, "Route traces use a feedback driver and therefore different inputs; the braking pair alone uses matched initial state and input. No hydroplaning model.", fontsize=9.2, color=MUTED)
    fig.text(.055, .032, f"Roadster 3.19  |  Build {args.build_id[:16]}  |  120 Hz integration; plotted stored samples, no invented intermediate states.", fontsize=8.7, color=MUTED)
    return save(fig, "Roadster_3.19_Numerical_Route_Surface_Braking.png", "302.5 m route surface and measured braking"), {"dryStopDistanceM":brake["dry-day"]["stopDistanceM"], "wetStopDistanceM":brake["after-rain"]["stopDistanceM"]}


def event(record, kind):
    return next(e for e in record["events"] if e["type"] == kind)


def learning_figure():
    fig = plt.figure(figsize=(14, 10))
    heading(fig, "A hard landing becomes a same-start practice", "One retained failure and its successful child attempt  |  Events align the comparison; outcomes keep their original limits")
    grid = fig.add_gridspec(2, 2, left=.07, right=.96, bottom=.18, top=.825,
                           width_ratios=[1.25, 1], hspace=.43, wspace=.25)
    ax_height = fig.add_subplot(grid[0, 0]);ax_force = fig.add_subplot(grid[1, 0], sharex=ax_height)
    ax_descent = fig.add_subplot(grid[0, 1]);ax_table = fig.add_subplot(grid[1, 1]);ax_table.axis("off")
    touchdown = []
    for record, colour, label in [(hard, HARD, "Original hard landing"), (practice, SOFT, "Same-start practice")]:
        samples = record["liveExperiment"]["samples"]
        takeoff, touch = event(record, "takeoff"), event(record, "touchdown")
        times = np.array([s["timeS"]-takeoff["timeS"] for s in samples])
        heights = [s["position"]["y"]-record["task"]["route"]["surfaceY"] for s in samples]
        ax_height.plot(times, heights, color=colour, lw=2.3, label=label)
        ax_force.plot(times, [s["actualForceN"]/1000 for s in samples], color=colour, lw=2.1)
        ax_force.plot(times, [s["commandForceN"]/1000 for s in samples], color=colour, lw=1.25, ls="--", alpha=.8)
        relative_touch = touch["timeS"]-takeoff["timeS"]
        touchdown.append(relative_touch)
        ax_height.scatter([relative_touch], [touch["detail"]["position"]["y"]-8], color=colour, s=38, edgecolor="white", zorder=5)
        approach = [s for s in samples if -2.3 <= s["timeS"]-touch["timeS"] < -1e-7]
        exact_descent = -touch["detail"]["preContactVerticalMps"]
        tx = [s["timeS"]-touch["timeS"] for s in approach]+[0]
        vy = [-s["velocity"]["y"] for s in approach]+[exact_descent]
        ax_descent.plot(tx, vy, color=colour, lw=2.3)
        ax_descent.scatter([0], [exact_descent], color=colour, s=50, edgecolor="white", zorder=5)
        ax_descent.annotate(f"{exact_descent:.3f} m/s", (0, exact_descent), xytext=(-10, 9), textcoords="offset points", ha="right", color=colour, fontsize=10, fontweight="bold")
    gate = event(hard, "gate_passed")["timeS"]-event(hard, "takeoff")["timeS"]
    command = next(e for e in hard["liveExperiment"]["events"] if e.get("method") == "setMode" and e.get("args") == ["drive"])
    command_time = command["step"]/120-event(hard, "takeoff")["timeS"]
    for ax in [ax_height, ax_force]:
        style(ax);ax.set_xlim(-1.8, 14.0);ax.axvline(0, color="#99aab2", lw=.9, ls=":");ax.axvline(gate, color="#99aab2", lw=.9, ls=":")
        ax.axvline(command_time, color="#8c819f", lw=1, ls="--")
    ax_height.set_title("A  Aligned at the recorded takeoff event", loc="left", pad=13)
    ax_height.set_ylabel("CG height above the 8 m platform (m)");ax_height.set_xlabel("Time since takeoff (s)");ax_height.set_ylim(0, 4.7)
    ax_height.legend(loc="lower left", frameon=False, fontsize=9)
    ax_height.text(.02, .94, f"Gate passed: +{gate:.2f} s in both attempts", transform=ax_height.transAxes, color=MUTED, fontsize=9, va="top")
    ax_height.annotate("Takeoff", xy=(0, 4.65), xytext=(0, 4.45), ha="center", fontsize=8.5, color=MUTED)
    ax_force.set_title("B  Actual force and requested force", loc="left", pad=13)
    ax_force.set_ylabel("Sum of nozzle force magnitudes (kN)");ax_force.set_xlabel("Time since takeoff (s)");ax_force.set_ylim(bottom=0)
    ax_force.legend(handles=[Line2D([0], [0], color=INK, lw=2, label="Actual"), Line2D([0], [0], color=INK, lw=1.3, ls="--", label="Requested")], loc="upper left", frameon=False, fontsize=9, ncol=2)
    ax_force.text(.98, .95, f"Commands diverge at +{command_time:.2f} s:\noriginal: drive mode; practice: land action", transform=ax_force.transAxes, ha="right", va="top", fontsize=8.8, color=MUTED)
    threshold = hard["task"]["route"]["landing"]["maximumTouchdownVerticalMps"]
    ax_descent.axhline(threshold, color=NAVY, lw=1, ls="--")
    ax_descent.axvline(0, color="#99aab2", lw=.9, ls=":")
    ax_descent.text(-2.15, threshold+.18, f"Touchdown limit: {threshold:.1f} m/s", color=NAVY, fontsize=9)
    ax_descent.set_title("C  Aligned at each first wheel contact", loc="left", pad=13)
    ax_descent.set_xlabel("Time relative to first contact (s)");ax_descent.set_ylabel("Downward velocity (m/s)")
    ax_descent.set_xlim(-2.3, .35);ax_descent.set_ylim(-.6, 8.8);style(ax_descent)
    ax_descent.text(.02, .95, "Dots use exact pre-contact event values.\nThe limit is evaluated at contact, not in flight.", transform=ax_descent.transAxes, fontsize=8.7, color=MUTED, va="top")
    h, p = hard["summary"], practice["summary"]
    rows = [
        ["First-contact descent", f"{-h['firstContact']['preContactVerticalMps']:.3f} m/s", f"{-p['firstContact']['preContactVerticalMps']:.3f} m/s"],
        ["First-contact tilt", f"{max(abs(h['firstContact']['rollDeg']),abs(h['firstContact']['pitchDeg'])):.5f}°", f"{max(abs(p['firstContact']['rollDeg']),abs(p['firstContact']['pitchDeg'])):.5f}°"],
        ["Stable landing", "No — failed", "Yes — practice"],
        ["Whole-run duration", f"{hard['durationS']:.2f} s", f"{practice['durationS']:.2f} s"],
        ["External gas supplied", f"{h['externalSupplyKg']:.2f} kg", f"{p['externalSupplyKg']:.2f} kg"],
        ["Onboard gas used", f"{h['onboardDischargedKg']:.2f} kg", f"{p['onboardDischargedKg']:.2f} kg"],
    ]
    ax_table.set_title("D  Result and cost stay visible", loc="left", pad=13)
    table = ax_table.table(cellText=rows, colLabels=["Measure", "Original", "Practice"], cellLoc="left", colLoc="left", colWidths=[.45,.27,.28], bbox=[0,.26,1,.73])
    table.auto_set_font_size(False);table.set_fontsize(9)
    for (r,c), cell in table.get_celld().items():
        cell.set_edgecolor("white");cell.set_facecolor("#eaf0f3" if r==0 else "#f4f7f8" if r%2 else "#ffffff")
        if r==0:cell.set_text_props(weight="bold",color=NAVY)
        elif c==1:cell.set_text_props(color=HARD)
        elif c==2:cell.set_text_props(color=SOFT)
    ax_table.text(0, .16, "Same complete initial snapshot, rules and model.\nDifferent public commands; this is not strict controller A/B.\nBoth use external constant-pressure supply; gas use increased.", fontsize=9.1, color=MUTED, va="top", linespacing=1.5)
    fig.text(.07, .125, f"Parent {hard['id']}  →  practice {practice['id']}  |  Practice is excluded from formal rankings.", fontsize=9.2, color=MUTED)
    fig.text(.07, .093, "120 Hz event/statistic values and stored 20 Hz curves. Lines join recorded samples; the failed attempt ends at its first violation.", fontsize=9.3, color=MUTED)
    fig.text(.07, .068, "This is a numerical public-command demonstration, not native human driving. Event order alone does not establish universal causality or success rates.", fontsize=9.1, color=MUTED)
    fig.text(.07, .038, f"Roadster 3.19  |  Build {args.build_id[:16]}  |  Initial snapshot {hard['liveExperiment']['initialSnapshot']['stateLabel']}", fontsize=8.7, color=MUTED)
    return save(fig, "Roadster_3.19_Numerical_Landing_Practice.png", "Event-aligned hard landing and same-start practice"), {"parentRunId":hard["id"],"practiceRunId":practice["id"],"descentThresholdMps":threshold,"originalDescentMps":-h["firstContact"]["preContactVerticalMps"],"practiceDescentMps":-p["firstContact"]["preContactVerticalMps"],"originalExternalGasKg":h["externalSupplyKg"],"practiceExternalGasKg":p["externalSupplyKg"],"strictControllerAB":False}


route_png, route_values = route_figure()
learning_png, learning_values = learning_figure()
manifest = {"schema":"roadster-numerical-figures-3.19","modelBuildId":args.build_id,"method":"Matplotlib/Agg plots from the identified final QA files only. No renderer, generated imagery or prior-version screenshots.","script":{"path":str(Path(__file__)),"sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},"sources":sources,"figures":[route_png,learning_png],"routeValues":route_values,"learningValues":learning_values,"limitations":["These are numerical solver figures, not rendered gameplay or GPU performance measurements.","No old-model recomputation or missing intermediate trajectory was invented.","Route-driver input traces differ; only the separate braking probe fixes the initial state and input.","The learning pair changes public commands and is not strict controller A/B. External gas use is shown without claiming onboard savings."]}
(out/"numerical-figures-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
print(json.dumps({"outputs":manifest["figures"],"modelBuildId":args.build_id},indent=2))
