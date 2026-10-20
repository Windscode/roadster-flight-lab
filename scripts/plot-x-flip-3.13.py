"""Render recorded physical curves; never synthesize a vehicle trajectory."""
from pathlib import Path
import json
import os
import tempfile
os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "roadster-matplotlib"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / "qa/x-flip-curves-3.13.json").read_text())
summary = json.loads((ROOT / "qa/x-flip-3.13.json").read_text())
columns = {name: i for i, name in enumerate(data["columns"])}
runs = {run["id"]: run["rows"] for run in data["runs"]}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                     "axes.spines.top": False, "axes.spines.right": False,
                     "axes.titleweight": "bold", "svg.fonttype": "none"})
COLORS = {"3.9": "#64748b", "3.12": "#d97706", "3.13": "#087f8c", "manual 270°": "#8b5cf6", "manual 355°": "#b45339"}


def series(run_id, column, scale=1):
    return [row[columns[column]] * scale for row in runs[run_id]]


def chart(axes, ids, quantities):
    for ax, (column, title, unit, scale) in zip(axes.flat, quantities):
        for label, run_id in ids:
            ax.plot(series(run_id, "timeS"), series(run_id, column, scale),
                    color=COLORS[label], lw=1.8, label=label)
        ax.set(title=title, ylabel=unit, xlabel="Time from X / first E (s)")
        ax.grid(alpha=.20)
        ax.set_xlim(left=0)


def save(fig, stem, caption):
    fig.text(.025, .012, caption, fontsize=9, color="#475569")
    fig.tight_layout(rect=[0, .055, 1, .91], h_pad=2.0, w_pad=2.4)
    svg_path = ROOT / f"qa/{stem}.svg"
    fig.savefig(svg_path, facecolor="white")
    # Matplotlib leaves spaces at SVG path line ends; keep the versioned XML clean.
    svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text().splitlines()) + "\n")
    fig.savefig(ROOT / f"qa/{stem}.png", dpi=150, facecolor="white")
    plt.close(fig)


quantities = [("heightM", "CG height above floor", "m", 1),
              ("rollRateDegS", "Measured local roll rate", "degrees / s", 1),
              ("thrustN", "Total delivered nozzle force", "kN", .001),
              ("integratedRollDeg", "Integrated actual body roll", "degrees", 1),
              ("externalSuppliedKg", "External gas supplied", "kg", 1),
              ("rigidEnvelopeClearanceM", "Lowest rigid envelope above floor", "m", 1)]
fig, axes = plt.subplots(2, 3, figsize=(14, 8.5))
ids = [(v, f"{v}-bench-600-h0.62") for v in ["3.9", "3.12", "3.13"]]
chart(axes, ids, quantities)
fig.suptitle("X roll: frozen 3.9, frozen 3.12 and 3.13 physical solver", x=.025, ha="left", fontsize=17, fontweight="bold", y=.98)
fig.legend(*axes[0, 0].get_legend_handles_labels(), loc="upper left", bbox_to_anchor=(.02, .94), ncol=3, frameon=False)
save(fig, "x-flip-ground-comparison-3.13", "Matched flat ground: initial CG 0.597 m; bench 350 bar; same 600 L mass setting, not finite storage.\n120 Hz integration / 20 Hz curves; traces end about 1 s after completion. This is numerical evidence, not rendered footage or a Tesla measurement.")

fig, axes = plt.subplots(2, 3, figsize=(14, 8.5))
ids = [("3.13", "3.13-bench-600-h0.62"), ("manual 270°", "manual-bench-600-h0.62"), ("manual 355°", "manual-late-release-bench-600-h0.62")]
chart(axes, ids, quantities)
practice = next(run for run in summary["manual"] if run["id"] == "manual-bench-600-h0.62")
start = practice["metrics"]["rollStart"]["timeS"]
release = practice["metrics"]["rollRelease"]["timeS"]
for ax in axes.flat:
    ax.axvline(start, color=COLORS["manual 270°"], alpha=.3, lw=1, ls=":")
    ax.axvline(release, color=COLORS["manual 270°"], alpha=.3, lw=1, ls=":")
fig.suptitle("Same hardware: X, early manual braking and late manual braking", x=.025, ha="left", fontsize=17, fontweight="bold", y=.98)
fig.legend(*axes[0, 0].get_legend_handles_labels(), loc="upper left", bbox_to_anchor=(.02, .94), ncol=3, frameon=False)
save(fig, "x-flip-manual-comparison-3.13", f"Bench 350 bar, 600 L mass setting; all begin at CG 0.597 m. Early manual: E 0-{start:.3f} s; Z {start:.3f}-{release:.3f} s; then G.\nLate 355-degree release overshoots 410 degrees. G physically finishes/brakes the turn and levels; manual has no automatic return to ground.")

fig, axes = plt.subplots(2, 3, figsize=(14, 8.5))
finite_quantities = [q if q[0] != "externalSuppliedKg" else ("onboardConsumedKg", "Actual onboard gas discharged", "kg", 1) for q in quantities]
chart(axes, [(v, f"{v}-finite-900-h0.62") for v in ["3.9", "3.13"]], finite_quantities)
fig.suptitle("Finite 900 L tank: actual cooling, pressure loss and gas discharge", x=.025, ha="left", fontsize=17, fontweight="bold", y=.98)
fig.legend(*axes[0, 0].get_legend_handles_labels(), loc="upper left", bbox_to_anchor=(.02, .94), ncol=2, frameon=False)
save(fig, "x-flip-finite-comparison-3.13", "Matched flat ground: initial CG 0.592 m; 350 bar / 293.15 K; adiabatic finite gas; 20 kN per main nozzle unchanged.\n3.12 refuses this same initial state for predicted impulse shortfall, so it has no execution curve. All accepted runs retain real return/landing dynamics.")
print("Saved 3 SVG and PNG comparisons from qa/x-flip-curves-3.13.json")
