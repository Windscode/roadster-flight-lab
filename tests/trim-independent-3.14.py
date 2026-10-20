"""Independent static feasibility cross-check, deliberately outside JS solver.

Run after physics-controls-3.14.test.mjs. Requires scipy/HiGHS in the validation
environment only; the web application has no Python or optimizer dependency.
Builds all six wrench rows from exported position/direction, not JS .column.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import scipy
from scipy.optimize import linprog

root = Path(__file__).resolve().parents[1]
report_version = ".".join(json.loads((root / "package.json").read_text())["version"].split(".")[:2])
path = root / f"qa/physics-controls-deepening-{report_version}.json"
source = json.loads(path.read_text())
matrix = source["evidence"]["trimMatrix"]
geometry = matrix["nozzleGeometry"]
columns = []
for nozzle in geometry:
    p = np.array([nozzle["position"][k] for k in "xyz"])
    d = np.array([nozzle["direction"][k] for k in "xyz"])
    columns.append(np.concatenate((d, np.cross(p, d))))
A = np.array(columns).T
results = []
for case in matrix["cases"]:
    wanted = np.array(case["desiredWrench"])
    answer = linprog(np.zeros(len(geometry)), A_eq=A, b_eq=wanted,
                     bounds=[(0, v) for v in case["maxForcesN"]], method="highs")
    if answer.status not in (0, 2):
        raise AssertionError(f"Unexpected independent solver status {answer.status}: {answer.message}")
    feasible = answer.status == 0
    if feasible != case["staticFeasible"]:
        raise AssertionError(f"JS certificate / HiGHS disagree: {case}")
    residual = (wanted - A @ answer.x).tolist() if feasible else None
    if feasible and max(abs(v) for v in residual) > 0.05:
        raise AssertionError(f"Independent wrench residual exceeds public tolerance: {residual}")
    results.append({"pressureBar": case["pressureBar"], "pose": case["pose"],
                    "fault": case["fault"], "staticFeasible": feasible,
                    "independentStatus": answer.status, "message": answer.message,
                    "independentForcesN": answer.x.tolist() if feasible else None,
                    "independentResidual": residual})
report = {"schema": "roadster-independent-trim-crosscheck", "version": 1,
          "modelVersion": source["modelVersion"], "modelBuildId": source["modelBuildId"],
          "inputReportSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
          "validator": "SciPy scipy.optimize.linprog / HiGHS", "scipyVersion": scipy.__version__,
          "matrixConstruction": "independent Python position cross direction; JS allocator column is not read",
          "scope": "Static bounded equality feasibility only; no dynamic recovery assertion",
          "status": "passed", "cases": results}
(root / f"qa/trim-independent-{report_version}.json").write_text(json.dumps(report, indent=2) + "\n")
print(f"PASS: independent HiGHS feasibility and wrench verification agreed in {len(results)} cases.")
