"""Read original native artifacts and reproduce the scoped summary; no browser."""
from collections import Counter
from hashlib import sha256
from pathlib import Path
import gzip
import json
import math

ROOT = Path(__file__).resolve().parent
BUILD = "81926b470303a5f51844285ff604fbb84717a627271efddde494e228ce319ec2"
REPORT_SHA = "dc66a9bcc24372bd3ee2fcef507280727c256fda3d4cba60bb9d877fb55d605e"
RUNNER_SHA = "b2a565673190746f982d0a6b9692688f54f31d4f33ad5b1773a523ad599d811a"
assert sha256((ROOT / "report.json").read_bytes()).hexdigest() == REPORT_SHA
report = json.loads((ROOT / "report.json").read_text())
assert report["identity"]["modelBuildId"] == BUILD
for key in ["sourceUnchanged", "servedSourceUnchanged", "localRunnerSourceUnchanged", "runnerSourcesUnchanged"]:
    assert report[key] is True
for key in ["runnerSourceBefore", "runnerSourceAfter"]:
    assert report[key]["scripts/native-controls-3.16.mjs"] == RUNNER_SHA

state_fields = ["simTime", "physicalStep", "paused", "mode", "position", "quaternion", "velocity", "angularVelocity", "pitchDeg", "rollDeg", "stabilizationMode", "driverInput", "contactCount", "rigidContactCount", "levelRecovery", "supplyMode", "pressureBar", "externalGasSuppliedKg", "onboardGasConsumedKg"]
def state(value):
    return {key: value.get(key) for key in state_fields}

cases = []
event_archive = {}
raw_cases = {}
for case in report["cases"]:
    filename = case["trace"]["filename"]
    data = (ROOT / filename).read_bytes()
    assert sha256(data).hexdigest() == case["trace"]["sha256"]
    raw = json.loads(gzip.decompress(data))
    raw_cases[case["id"]] = raw
    for event in raw["timeline"]["events"]:
        previous = event_archive.setdefault(event["sequence"], event)
        assert previous == event, "An archived immutable event changed between snapshots"
    start, end = raw["start"], raw["end"]
    rows = [row for row in raw["timeline"]["events"] if row["type"] == "physics-input" and row["sequence"] > start["traceStartSequence"] and row["simTime"] >= start["simTime"] - 1e-8]
    gaps = [{"afterStep": left["step"], "beforeStep": right["step"], "afterSimTimeS": left["simTime"], "beforeSimTimeS": right["simTime"], "gapS": right["simTime"] - left["simTime"]} for left, right in zip(rows, rows[1:]) if right["step"] != left["step"] + 1]
    held = [row for row in rows if row["input"]["throttle"] == 1 and row["input"]["lift"] == 1 and row["input"]["pitch"] == 1]
    pose = [row["actual"] for row in rows]
    contact_available = bool(rows) and all("wheelContactCount" in p and "rigidContactCount" in p for p in pose)
    item = {
        "id": case["id"], "trace": filename, "start": state(start), "end": state(end),
        "markedDurationS": end["simTime"] - start["simTime"],
        "markedExternalGasKg": end["externalGasSuppliedKg"] - start["externalGasSuppliedKg"],
        "markedOnboardGasKg": end["onboardGasConsumedKg"] - start["onboardGasConsumedKg"],
        "lastRun": end.get("maneuverFeedback", {}).get("lastRun"),
        "coverage": {"samples": len(rows), "firstSimTimeS": rows[0]["simTime"] if rows else None, "lastSimTimeS": rows[-1]["simTime"] if rows else None, "unrecordedMarkedHeadS": max(0, rows[0]["simTime"] - start["simTime"]) if rows else None, "lastSampleAfterMarkedEndS": rows[-1]["simTime"] - end["simTime"] if rows else None, "internalStepGaps": gaps, "allRetainedAdjacentStepsContiguous": not gaps if rows else None, "globalEventsDroppedDuringMarkedCase": raw["timeline"]["droppedEvents"] - start["traceDroppedAtStart"], "scope": "The bounded journal can evict earlier trials. Its global dropped count is not the number of missing samples in this trial. State/end and journal are separate readbacks; the journal may extend after the marked end. No rows is unknown contact, not zero contact."},
        "contact": {"fieldsAvailable": contact_available, "wheelSamples": sum(p["wheelContactCount"] > 0 for p in pose) if contact_available else None, "rigidSamples": sum(p["rigidContactCount"] > 0 for p in pose) if contact_available else None, "anyContactSamples": sum(row["actual"]["wheelContactCount"] > 0 or row["actual"]["rigidContactCount"] > 0 or row["integration"]["contactMicrosteps"] > 0 for row in rows) if contact_available else None, "contactMicrosteps": sum(row["integration"]["contactMicrosteps"] for row in rows) if contact_available else None, "maxRigidContactsInMicrosteps": max(row["integration"]["maxRigidContacts"] for row in rows) if contact_available else None},
        "recordedGeometry": {"minimumCgM": min(p["position"]["y"] for p in pose) if pose else None, "maximumCgM": max(p["position"]["y"] for p in pose) if pose else None, "maximumActualPitchTravelDeg": max(p["attitudeTravel"]["pitchDeg"] for p in pose) if pose else None},
        "fullWE1": {"samples": len(held), "appliedControlDurationS": len(held) / 120, "firstSampleSimTimeS": held[0]["simTime"] if held else None, "lastSampleSimTimeS": held[-1]["simTime"] if held else None, "acceptedPitchSamples": sum(row["pilotIntent"]["pitch"]["accepted"] for row in held), "gPitchOverrideSamples": sum(row["pilotIntent"]["gPitchOverride"] for row in held), "scope": "Actual production steps with all three input values equal to one. This duration includes real delivery/readback delay and is not the nominal 6.5 s tool request."},
        "sampledManeuverFeedbackPhases": dict(Counter(row.get("maneuverFeedback", {}).get("lastRun", {}).get("phase") for row in rows if row.get("maneuverFeedback", {}).get("lastRun"))),
        "nativeKeyEdges": raw["nativeKeys"][start["nativeKeyStart"]:],
    }
    if case["id"] == "we1-airborne-climb":
        item["climb"] = {"targetWorldHeightM": case["targetWorldHeightM"], "reached": state(case["reached"]), "sparsePublicObservations": case["climbObservations"], "scope": case["scope"]}
    if held:
        before_index = max(0, rows.index(held[0]) - 1)
        maneuver_rows = rows[before_index:]
        item["pitchToRecoveryCoverage"] = {"beforeFirstPitchSampleSimTimeS": maneuver_rows[0]["simTime"], "lastSimTimeS": maneuver_rows[-1]["simTime"], "samples": len(maneuver_rows), "allAdjacentStepsContiguous": all(right["step"] == left["step"] + 1 for left, right in zip(maneuver_rows, maneuver_rows[1:])), "firstActualPitchAtLeast360": next(({"simTimeS": row["simTime"], "elapsedFromRecordedPrePitchStateS": row["simTime"] - maneuver_rows[0]["simTime"], "cgM": row["actual"]["position"]["y"], "actualPitchTravelDeg": row["actual"]["attitudeTravel"]["pitchDeg"]} for row in maneuver_rows if row["actual"]["attitudeTravel"]["pitchDeg"] >= 360), None)}
        if case["id"] == "we1-airborne-120m-g-on":
            angles, projected_lengths, side_components, increments = [], [], [], []
            previous, unwrapped = None, 0
            for row in maneuver_rows:
                q = row["actual"]["quaternion"]
                x, y, z, w = (q[key] for key in ["x", "y", "z", "w"])
                ux, uy, uz = 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)
                angle = math.atan2(uz, uy)
                if previous is None:
                    unwrapped = angle
                else:
                    delta = (angle - previous + math.pi) % (2 * math.pi) - math.pi
                    unwrapped += delta
                    increments.append(abs(math.degrees(delta)))
                previous = angle
                angles.append(math.degrees(unwrapped))
                projected_lengths.append(math.hypot(uy, uz))
                side_components.append(abs(ux))
            item["independentQuaternionProjection"] = {"method": "Rotate body-up by each actual quaternion, unwrap atan2(worldZ, worldY) on contiguous production samples.", "startAngleDeg": angles[0], "minimumUnwrappedAngleDeg": min(angles), "maximumUnwrappedAngleDeg": max(angles), "endUnwrappedAngleDeg": angles[-1], "maximumPerSampleChangeDeg": max(increments), "minimumProjectionLength": min(projected_lengths), "maximumAbsoluteOutOfPlaneX": max(side_components), "scope": "An independent near-planar geometry cross-check using existing poses, not Euler pitch or the stored body-axis counter. Negative world-YZ rotation corresponds to positive pitch in the production counter. Projection validity, per-step continuity, contacts and terminal attitude are checked separately; this does not certify ground starts or finite supply."}
    cases.append(item)

download = json.loads((ROOT / "native-input-download.json").read_text())
assert len(download["events"]) == report["inputExportEvidence"]["exportedEvents"]
overlap = [event for event in download["events"] if event["sequence"] in event_archive]
assert all(event_archive[event["sequence"]] == event for event in overlap)
assert download["identity"] == report["identity"]
for capture in report["captures"]:
    assert sha256((ROOT / capture["filename"]).read_bytes()).hexdigest() == capture["sha256"]
assert sha256((ROOT / "native-input-download.json").read_bytes()).hexdigest() == report["inputExportEvidence"]["sha256"]
original_names = sorted({"report.json", "native-input-download.json", "runner.log", *[case["trace"]["filename"] for case in report["cases"]], *[capture["filename"] for capture in report["captures"]]})
summary = {
    "schema": "roadster-native-control-scope-summary", "version": 1, "modelBuildId": BUILD,
    "reportSha256": REPORT_SHA, "summaryProgramSha256": sha256(Path(__file__).read_bytes()).hexdigest(),
    "observedRunnerExitCode": 0, "exitScope": "Process completion was observed by the collector. Exit zero means the capture and its declared gates completed; it does not make the two ground flip/recovery cases successful.",
    "sourceAudit": {"beforeAfterExact": report["servedSourceUnchanged"], "sourceCount": report["servedIdentityBefore"]["sourceCount"], "localSourceStable": report["localRunnerSourceUnchanged"], "runnerAndToolchainStable": report["runnerSourcesUnchanged"], "runnerSha256": RUNNER_SHA, "pageSourceCommit": report["identity"]["sourceCommit"], "pageSourceTree": report["identity"]["sourceTree"], "scope": "172 actual served JS/HTML/CSS files and three irradiance assets verified before and after. Page commit/tree fields remain null as observed. No identity is transferred to a later build by relabeling this capture."},
    "outcomes": {"nativeXShortEdgesAndExpectedRouting": "passed-three-cases", "visiblePauseResumeAndHeldInputRelease": "passed", "groundGOnFlipAndRecovery": "not-completed-ground-contact-and-limited-recovery", "groundGOffThenGOnFlipAndRecovery": "not-completed-ground-contact-and-limited-recovery", "airbornePitchAndGRecovery": "completed-within-declared-recorded-high-altitude-bench-scope", "inputDownload": "completed-2400-events-exact-to-captured-expected-journal"},
    "shortKeyPolicy": report["shortKeyPolicy"], "shortKeyEdges": report["shortKeyEdges"], "cases": cases,
    "playback": {"trustedButtonActions": len(report["playbackActions"]), "allActionsPreservedPhysicalStateAtSameClick": all(action["physicalStatePreservedAtClick"] for action in report["playbackActions"]), "heldWCase": next(case for case in report["cases"] if case["id"] == "hud-pause-resume-held-w"), "exportPause": report["inputExportPauseEvidence"]},
    "inputExport": {**report["inputExportEvidence"], "independentlyMatchingArchivedEventOverlap": len(overlap), "scope": "The original native test compared all 2400 expected records before export. The summary independently verifies all records whose sequence also occurs in an earlier raw case snapshot. Application handoff, Worker serialization and automation download observation are different durations. This run does not establish the cause of the user's earlier 42-minute tool wait."},
    "pageErrors": report["errors"], "consoleErrors": report["consoleErrors"], "console404Scope": "One resource-404 console message was retained without its URL. Its resource identity and cause remain unresolved; do not silently label it a favicon or clear it.",
    "failure": report["failure"], "originalFiles": [{"path": name, "bytes": (ROOT / name).stat().st_size, "sha256": sha256((ROOT / name).read_bytes()).hexdigest()} for name in original_names],
    "visualScope": "12 actual whole-page PNGs, 800x600, Chrome/ANGLE SwiftShader. Screenshots bracket asynchronous telemetry, not atomic same-frame states or a full video. They do not certify a user's GPU FPS, hardware key rollover, or a complete city route.",
}
(ROOT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"originalFilesVerified": len(original_names), "cases": len(cases), "downloadOverlapVerified": len(overlap), "reportSha256": REPORT_SHA, "summarySha256": sha256((ROOT / "summary.json").read_bytes()).hexdigest()}, ensure_ascii=False))
