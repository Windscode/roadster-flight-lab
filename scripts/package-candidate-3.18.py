"""Package a committed private runtime candidate. No network or publication action.

Full Git history and the original evidence remain in the repository and are
separate deliverables. This script copies only declared runtime assets, current
notes and a small, explicit 3.18 evidence selection. It never removes old output.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import importlib.util
import io
import json
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BASELINE = "d9a4fbfd434fe49cdbeae18c32f624360e9dc4e9"
PACKAGE = "Roadster_Flight_Lab_3.18"
RUNTIME_SUFFIXES = {".js", ".html", ".css", ".json", ".md", ".txt", ".jpg", ".jpeg", ".png",
                    ".webp", ".avif", ".svg", ".ico", ".hdr", ".bin", ".gltf", ".glb", ".mp3",
                    ".m4a", ".ogg", ".wav", ".woff", ".woff2"}
REQUIRED_REPORTS = ["qa/control-continuity-3.18/report.json",
                    "qa/control-continuity-3.18/entry-guards-final.json", "qa/contact-impulse-3.18.json",
                    "qa/vehicle-main-form-3.18.json", "qa/city-street-detail-3.18.json",
                    "qa/shadow-motion-3.18/report.json", "qa/wind-matrix-3.18/final/report.json",
                    "qa/native-acceptance-3.18.json"]
OPTIONAL_EVIDENCE = ["qa/vehicle-form-3.18/candidate/front-quarter.png",
                     "qa/vehicle-form-3.18/candidate/side.png",
                     "qa/city-native-3.18/final-batching/weave-entry-clear-day.png",
                     "qa/city-native-3.18/final-batching/weave-entry-wet-night.png"]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("roadster_candidate_launcher", ROOT / "scripts/candidate-launcher-3.18.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def git(args, check=True):
    result = subprocess.run(["git"] + args, cwd=str(ROOT), stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if check and result.returncode:
        raise RuntimeError("Git check failed (" + " ".join(args[:3]) + "): "
                           + result.stderr.decode("utf-8", "replace").strip())
    return result


def git_text(args):
    return git(args).stdout.decode("utf-8").strip()


def file_identity(path):
    size = path.stat().st_size
    sha1, sha256 = hashlib.sha1(), hashlib.sha256()
    sha1.update(("blob " + str(size) + "\0").encode("ascii"))
    count = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha1.update(block)
            sha256.update(block)
            count += len(block)
    if count != size:
        raise RuntimeError("File changed while checking: " + str(path))
    return {"bytes": count, "sha256": sha256.hexdigest(), "gitBlobSha": sha1.hexdigest()}


def source_tree():
    entries = {}
    for row in git(["ls-tree", "-r", "-z", "--full-tree", "HEAD"]).stdout.split(b"\0"):
        if not row:
            continue
        metadata, raw_path = row.split(b"\t", 1)
        mode, kind, oid = metadata.decode("ascii").split()
        name = raw_path.decode("utf-8")
        entries[name] = {"mode": mode, "kind": kind, "oid": oid}
    return entries


def committed_file(name, entries, cache):
    if name in cache:
        return cache[name]
    entry = entries.get(name)
    if not entry or entry["kind"] != "blob" or entry["mode"] not in ("100644", "100755"):
        raise RuntimeError("File is not an ordinary file in the final HEAD commit: " + name)
    path = launcher.safe_path(ROOT, name)
    if not path.is_file():
        raise RuntimeError("Committed file is missing from the working tree: " + name)
    actual = file_identity(path)
    if actual["gitBlobSha"] != entry["oid"]:
        raise RuntimeError("Working bytes differ from final HEAD: " + name)
    cache[name] = {"path": name, **actual, "origin": "committed-blob"}
    return cache[name]


def assert_committed_state(expected_commit=None):
    commit = git_text(["rev-parse", "HEAD"])
    if expected_commit is not None and commit != expected_commit:
        raise RuntimeError("HEAD changed from the explicitly selected source commit")
    if commit == BASELINE:
        raise RuntimeError("HEAD is still the 3.17 baseline; commit the finished 3.18 work before packaging")
    if git_text(["rev-parse", "--is-shallow-repository"]) != "false":
        raise RuntimeError("Complete source history is required; this checkout is shallow")
    if git(["merge-base", "--is-ancestor", BASELINE, "HEAD"], check=False).returncode:
        raise RuntimeError("The declared 3.17 baseline is not an ancestor of HEAD")
    changed = git(["diff", "--quiet", "HEAD", "--"], check=False)
    if changed.returncode == 1:
        names = git_text(["diff", "--name-only", "HEAD", "--"]).splitlines()
        raise RuntimeError("Tracked changes are not in the final commit: " + ", ".join(names[:8]))
    if changed.returncode:
        raise RuntimeError("Cannot verify the committed working tree")
    return commit


def excluded_runtime(name):
    path = Path(name)
    return (name == "dist/deployment.json" or path.suffix.lower() in (".zip", ".log", ".gz", ".bundle")
            or path.name in launcher.OS_SIDECARS
            or name == "dist/assets/reference-roadster.jpg"
            or name.startswith("dist/assets/references/") and path.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))


def payload_file(entry, entries, cache):
    if not isinstance(entry, dict):
        raise RuntimeError("Invalid declared payload entry")
    name = entry.get("path")
    path = launcher.safe_path(ROOT, name)
    count = entry.get("bytes")
    if (entry.get("encoding") != "gzip" or type(count) is not int or not 0 <= count <= 100 * 1024 * 1024
            or not isinstance(entry.get("parts"), list) or not entry["parts"]):
        raise RuntimeError("Invalid declared payload: " + str(name))
    compressed, seen = bytearray(), set()
    for part in entry["parts"]:
        if not isinstance(part, dict):
            raise RuntimeError("Invalid payload segment entry: " + name)
        part_name = part.get("path")
        if not isinstance(part_name, str) or not part_name.startswith("repository-payloads/chunks/") or part_name in seen:
            raise RuntimeError("Invalid or duplicated payload segment: " + str(part_name))
        seen.add(part_name)
        actual = committed_file(part_name, entries, cache)
        if actual["bytes"] != part.get("bytes") or actual["sha256"] != part.get("sha256"):
            raise RuntimeError("Payload segment differs from committed manifest: " + part_name)
        compressed.extend(launcher.safe_path(ROOT, part_name).read_bytes())
    if (len(compressed) != entry.get("compressedBytes")
            or hashlib.sha256(compressed).hexdigest() != entry.get("compressedSha256")):
        raise RuntimeError("Compressed payload identity differs: " + name)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as archive:
        restored = archive.read(count + 1)
        if len(restored) != count or archive.read(1):
            raise RuntimeError("Payload decoded size differs: " + name)
    archive_sha = hashlib.sha256(restored).hexdigest()
    blob = hashlib.sha1(("blob " + str(count) + "\0").encode("ascii") + restored).hexdigest()
    if archive_sha != entry.get("sha256") or blob != entry.get("gitBlobSha"):
        raise RuntimeError("Decoded payload differs from manifest: " + name)
    if not path.is_file():
        raise RuntimeError("Declared runtime payload is missing: " + name
                           + ". Restore the committed payloads before packaging; no file was changed.")
    actual = file_identity(path)
    if actual["bytes"] != count or actual["sha256"] != archive_sha or actual["gitBlobSha"] != blob:
        raise RuntimeError("Restored payload was edited; preserve and review it before packaging: " + name)
    return {"path": name, **actual, "origin": "committed-payload-archive",
            "compressedSha256": entry["compressedSha256"], "verifiedSegments": len(seen)}


def preflight(expected_commit=None):
    commit = assert_committed_state(expected_commit)
    entries, cache = source_tree(), {}
    # These exact scripts and the instructions must also belong to the final commit.
    for name in ["scripts/candidate-launcher-3.18.py", "scripts/package-candidate-3.18.py",
                 "scripts/model-build.mjs", "docs/start-3.18.md", "LICENSE", "THIRD-PARTY-NOTICES.md"]:
        committed_file(name, entries, cache)
    manifest_name = "repository-payloads/manifest.json"
    manifest_identity = committed_file(manifest_name, entries, cache)
    manifest = launcher.read_json(launcher.safe_path(ROOT, manifest_name))
    if (not isinstance(manifest, dict) or manifest.get("schema") != "roadster.repository-payloads"
            or manifest.get("version") != 1 or not isinstance(manifest.get("files"), list)):
        raise RuntimeError("Unsupported committed payload manifest")
    payloads = {}
    for entry in manifest["files"]:
        if not isinstance(entry, dict):
            raise RuntimeError("Invalid logical payload entry")
        name = entry.get("path")
        launcher.safe_path(ROOT, name)
        if name in payloads:
            raise RuntimeError("Duplicate logical payload path: " + name)
        payloads[name] = entry
    runtime = {}
    excluded = []
    names = sorted({p for p in entries if p.startswith("dist/")} | {p for p in payloads if p.startswith("dist/")})
    for name in names:
        if excluded_runtime(name):
            excluded.append(name)
            continue
        if Path(name).suffix.lower() not in RUNTIME_SUFFIXES:
            raise RuntimeError("Undeclared runtime file type: " + name)
        runtime[name] = payload_file(payloads[name], entries, cache) if name in payloads else committed_file(name, entries, cache)
        if name in entries and runtime[name]["gitBlobSha"] != entries[name]["oid"]:
            raise RuntimeError("Tracked file and payload archive disagree: " + name)
    working_runtime = launcher.runtime_files(ROOT)
    undeclared = sorted(p for p in working_runtime if p not in runtime and not excluded_runtime(p))
    if undeclared:
        raise RuntimeError("Runtime files are neither committed nor declared payloads: " + ", ".join(undeclared[:8]))
    model = launcher.verify_runtime(ROOT)
    if sum(row["bytes"] for row in runtime.values()) > 256 * 1024 * 1024:
        raise RuntimeError("Runtime exceeds the 256 MiB candidate budget; review assets before packaging")
    selected = dict(runtime)
    for name in ["LICENSE", "THIRD-PARTY-NOTICES.md"]:
        selected[name] = committed_file(name, entries, cache)
    docs = sorted(p for p in entries if p.startswith("docs/") and "/" not in p[5:] and "3.18" in p and p.endswith(".md"))
    for path in (ROOT / "docs").glob("*3.18*.md"):
        if path.relative_to(ROOT).as_posix() not in entries:
            raise RuntimeError("Current 3.18 instructions are not committed: " + path.name)
    for name in docs:
        selected[name] = committed_file(name, entries, cache)
    selected_reports, omitted_optional = [], []
    for name in REQUIRED_REPORTS + OPTIONAL_EVIDENCE:
        if name not in entries and name not in payloads:
            if name in REQUIRED_REPORTS or (ROOT / name).exists():
                raise RuntimeError("Current candidate evidence is missing from the final commit: " + name)
            omitted_optional.append(name)
            continue
        row = payload_file(payloads[name], entries, cache) if name in payloads else committed_file(name, entries, cache)
        if row["bytes"] > 8 * 1024 * 1024:
            raise RuntimeError("Selected candidate evidence exceeds 8 MiB; keep the full file in the separate evidence deliverable: " + name)
        selected[name] = row
        selected_reports.append(name)
    if sum(selected[p]["bytes"] for p in selected_reports) > 20 * 1024 * 1024:
        raise RuntimeError("Selected evidence exceeds 20 MiB; retain full evidence separately")
    assert_committed_state(commit)
    identity = {"application": "roadster-flight-lab", "modelVersion": model["modelVersion"],
                "modelBuildId": model["modelBuildId"], "sourceCommit": commit,
                "sourceTree": git_text(["rev-parse", "HEAD^{tree}"]),
                "sourceRepository": "https://github.com/Windscode/roadster-flight-lab",
                "delivery": "private-local-candidate", "publicDeploymentPerformed": False,
                "baselineCommit": BASELINE,
                "sourceParents": git_text(["show", "-s", "--format=%P", "HEAD"]).split(),
                "sourceHistoryCommits": int(git_text(["rev-list", "--count", "HEAD"])),
                "sourceHistoryScope": "Complete non-shallow ancestor history retained; source bundle and full original evidence are separate deliverables.",
                "payloadManifestSha256": manifest_identity["sha256"],
                "verifiedRuntimePayloads": sum(r["origin"] == "committed-payload-archive" for r in runtime.values())}
    return {"identity": identity, "selected": selected, "runtimeFiles": len(runtime),
            "runtimeBytes": sum(r["bytes"] for r in runtime.values()), "sourceFiles": model["sourceFiles"],
            "excludedRuntime": excluded, "selectedEvidence": selected_reports,
            "omittedOptionalEvidence": omitted_optional, "launcher": cache["scripts/candidate-launcher-3.18.py"],
            "instructions": cache["docs/start-3.18.md"]}


def copy_checked(row, target, destination=None):
    dest = launcher.safe_path(target, destination or row["path"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    with launcher.safe_path(ROOT, row["path"]).open("rb") as source, dest.open("xb") as output:
        shutil.copyfileobj(source, output, 1024 * 1024)
    if dest.stat().st_size != row["bytes"] or launcher.sha256_file(dest) != row["sha256"]:
        raise RuntimeError("Source changed while copying: " + row["path"])


def package(output, plan):
    output = output.resolve()
    try:
        output.relative_to(ROOT)
    except ValueError:
        pass
    else:
        raise RuntimeError("Choose an output directory outside the repository so candidates cannot include themselves")
    target, archive = output / PACKAGE, output / (PACKAGE + "_candidate.zip")
    if target.exists() or archive.exists():
        raise RuntimeError("Existing candidate/output is preserved; choose a fresh output location")
    # All preflight checks have completed. No output directory was created before this point.
    output.mkdir(parents=True, exist_ok=True)
    target.mkdir()
    for row in plan["selected"].values():
        copy_checked(row, target)
    copy_checked(plan["launcher"], target, "launch.py")
    copy_checked(plan["instructions"], target, "START_HERE.md")
    (target / "START_WINDOWS.cmd").write_bytes(b'@echo off\r\ncd /d "%~dp0"\r\nwhere py >nul 2>nul\r\nif errorlevel 1 (\r\n  python launch.py %*\r\n) else (\r\n  py -3 launch.py %*\r\n)\r\npause\r\n')
    (target / "START_MAC_LINUX.sh").write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec python3 launch.py "$@"\n', encoding="utf-8")
    (target / "START_MAC_LINUX.sh").chmod(0o755)
    (target / "dist/deployment.json").write_text(json.dumps(plan["identity"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    files = []
    for path in sorted(target.rglob("*")):
        if path.is_file():
            name = path.relative_to(target).as_posix()
            origin = plan["selected"].get(name)
            if name == "launch.py":
                origin = plan["launcher"]
            elif name == "START_HERE.md":
                origin = plan["instructions"]
            files.append({"path": name, "bytes": path.stat().st_size, "sha256": launcher.sha256_file(path),
                          "source": origin or {"origin": "generated-candidate-wrapper-or-identity"}})
    manifest = {"schema": "roadster.local-candidate-files", "version": 1, "identity": plan["identity"],
                "scope": "Runnable distribution, current notes and explicit small 3.18 evidence only. Complete Git history, original images and failure traces are preserved in separate deliverables, not discarded.",
                "files": files, "excludedRuntime": plan["excludedRuntime"],
                "omittedOptionalEvidence": plan["omittedOptionalEvidence"]}
    (target / "CANDIDATE_FILES.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    launcher.verify_candidate(target)
    assert_committed_state(plan["identity"]["sourceCommit"])
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as zipped:
        for path in sorted(target.rglob("*")):
            if path.is_file():
                zipped.write(path, path.relative_to(output).as_posix())
    archive_rows = files + [{"path": "CANDIDATE_FILES.json",
                             "bytes": (target / "CANDIDATE_FILES.json").stat().st_size,
                             "sha256": launcher.sha256_file(target / "CANDIDATE_FILES.json")}]
    with zipfile.ZipFile(archive) as zipped:
        expected_names = {PACKAGE + "/" + row["path"] for row in archive_rows}
        if len(zipped.namelist()) != len(expected_names) or set(zipped.namelist()) != expected_names:
            raise RuntimeError("Candidate ZIP file inventory differs from the verified candidate")
        for row in archive_rows:
            member = PACKAGE + "/" + row["path"]
            if zipped.getinfo(member).file_size != row["bytes"]:
                raise RuntimeError("Candidate ZIP size differs: " + row["path"])
            digest = hashlib.sha256()
            with zipped.open(member) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            if digest.hexdigest() != row["sha256"]:
                raise RuntimeError("Candidate ZIP digest differs: " + row["path"])
    assert_committed_state(plan["identity"]["sourceCommit"])
    return {"status": "private-candidate-created", "path": str(archive), "bytes": archive.stat().st_size,
            "sha256": launcher.sha256_file(archive), "files": len(files) + 1,
            "identity": plan["identity"], "runtimeBytes": plan["runtimeBytes"],
            "fullHistoryAndEvidence": "Separate deliverables required; this candidate does not replace them.",
            "publicDeploymentPerformed": False}


def main():
    parser = argparse.ArgumentParser(description="Package committed Roadster 3.18 locally; never publish")
    parser.add_argument("output", nargs="?", type=Path, help="Fresh directory outside the repository")
    parser.add_argument("--expect-commit", help="Optionally require this exact final HEAD commit")
    parser.add_argument("--check-only", action="store_true", help="Run read-only preflight without creating a candidate")
    args = parser.parse_args()
    if not args.check_only and args.output is None:
        parser.error("Provide an output directory or use --check-only")
    try:
        plan = preflight(args.expect_commit)
        if args.check_only:
            result = {"status": "committed-candidate-preflight-passed", "identity": plan["identity"],
                      "runtimeFiles": plan["runtimeFiles"], "runtimeBytes": plan["runtimeBytes"],
                      "sourceFiles": plan["sourceFiles"], "selectedEvidence": plan["selectedEvidence"],
                      "omittedOptionalEvidence": plan["omittedOptionalEvidence"], "outputCreated": False}
        else:
            result = package(args.output, plan)
    except (RuntimeError, launcher.CandidateError, OSError, ValueError, KeyError, TypeError, EOFError,
            zipfile.BadZipFile) as error:
        parser.exit(1, "Candidate preparation stopped: " + str(error)
                    + "\nNo existing candidate, repository history or evidence was removed. Any partial new output is preserved for inspection.\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
