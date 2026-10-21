#!/usr/bin/env python3
"""Small actual Git fixtures for the independent delivery recovery verifier."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts/verify-delivery-history-3.19.py"
REPORT = ROOT / "qa/verify-delivery-history-fixture-3.19.json"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args, cwd=None, env=None):
    value = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True)
    if value.returncode:
        raise AssertionError(str(args) + "\n" + value.stdout + "\n" + value.stderr)
    return value.stdout.strip()


def build(source):
    dist = source / "dist"
    names = sorted(p.relative_to(dist).as_posix() for p in dist.rglob("*")
                   if p.is_file() and p.name != "model-build.js" and p.suffix in (".js", ".html", ".css"))
    hashes = {name: sha(dist / name) for name in names}
    digest = hashlib.sha256(json.dumps(hashes, separators=(",", ":")).encode()).hexdigest()
    (dist / "model-build.js").write_text("// Generated fixture identity.\nexport const MODEL_BUILD_ID=" + json.dumps(digest) + ";\nexport const MODEL_SOURCE_HASHES=" + json.dumps(hashes, indent=2) + ";\n")
    return digest


def add_worktree_advertisement(path, commit):
    # The real 3.18 full header advertises one linked-worktree HEAD too.
    data = path.read_bytes()
    end = data.index(b"\n\n")
    path.write_bytes(data[:end] + b"\n" + commit.encode() + b" worktrees/fixture-baseline/HEAD\n\n" + data[end + 2:])


checks = []
with tempfile.TemporaryDirectory(prefix="roadster-delivery-fixture-") as temporary:
    root = Path(temporary)
    source, temp_root = root / "source", root / "recoveries"
    source.mkdir()
    temp_root.mkdir()
    sentinel = temp_root / "unrelated-sentinel.txt"
    sentinel.write_text("Only script-created bare directories may be deleted.\n")
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
    git = lambda *args: run(["git", "-c", "gc.auto=0", *args], cwd=source, env=env)
    git("init", "--initial-branch=main")
    git("config", "user.name", "Delivery fixture")
    git("config", "user.email", "fixture@invalid.example")
    dist = source / "dist"
    (dist / "nested").mkdir(parents=True)
    (dist / "vehicle-models.js").write_text("export const MODEL_VERSION='3.18.0';\n")
    (dist / "app.js").write_text("export const fixture=1;\n")
    (dist / "nested/worker.js").write_text("export const worker=true;\n")
    (dist / "index.html").write_text("<!doctype html><script src='app.js'></script>\n")
    (dist / "game.css").write_text("body { color: #123; }\n")
    (dist / "asset.bin").write_bytes(b"retained non-executable asset\0" * 50)
    build(source)
    git("add", ".")
    git("commit", "-m", "Original independent baseline")
    baseline = git("rev-parse", "HEAD")
    baseline_tree = git("rev-parse", "HEAD^{tree}")
    baseline_bundle = root / "baseline.bundle"
    git("bundle", "create", str(baseline_bundle), "--all")
    add_worktree_advertisement(baseline_bundle, baseline)
    baseline_sha = sha(baseline_bundle)
    (dist / "vehicle-models.js").write_text("export const MODEL_VERSION='3.19.0';\n")
    (dist / "app.js").write_text("export const fixture=2;\n")
    expected_build = build(source)
    git("add", ".")
    git("commit", "-m", "New candidate")
    tip, tree = git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")
    full, incremental = root / "new-full.bundle", root / "new-incremental.bundle"
    git("bundle", "create", str(full), "--all")
    add_worktree_advertisement(full, baseline)
    git("bundle", "create", str(incremental), baseline + "..HEAD")
    full.chmod(0o640)
    full_sha, incremental_sha = sha(full), sha(incremental)
    # An inherited alternate would falsely make an incomplete restoration pass.
    # Feed one deliberately; the verifier must remove it from child Git's env.
    hostile_env = dict(env, GIT_ALTERNATE_OBJECT_DIRECTORIES=str(source / ".git/objects"),
                       GIT_DIR=str(source / ".git"), GIT_WORK_TREE=str(source))

    def invoke(label, extra=(), memory=True, expected_tree=tree, full_path=full, expected_commit=tip, expected_build_id=expected_build, inc_path=incremental, environment=None, background=False):
        receipt = root / (label + ".json")
        args = [sys.executable, str(SCRIPT), "--full-bundle", str(full_path),
                "--baseline-bundle", str(baseline_bundle), "--incremental-bundle", str(inc_path),
                "--baseline-commit", baseline, "--baseline-tree", baseline_tree,
                "--expected-commit", expected_commit, "--expected-tree", expected_tree,
                "--expected-build", expected_build_id, "--expected-model-version", "3.19.0",
                "--receipt", str(receipt), "--temp-root", str(temp_root)]
        if memory:
            args.append("--memory-cycle")
        if background:
            return subprocess.Popen(args + list(extra), env=environment or hostile_env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True), receipt
        result = subprocess.run(args + list(extra), env=environment or hostile_env, capture_output=True, text=True)
        return result, json.loads(receipt.read_text()) if receipt.exists() else None

    result, report = invoke("success", ("--expected-full-sha256", full_sha,
                                      "--expected-baseline-sha256", baseline_sha,
                                      "--expected-incremental-sha256", incremental_sha))
    assert result.returncode == 0, result.stdout + result.stderr
    assert report["status"] == "passed" and report["restoration"]["sha256"] == full_sha
    assert report["readOnlyInputsUnchanged"] and report["temporaryDirectoriesRemoved"]
    for branch in ("fullRecovery", "incrementalRecovery"):
        assert report[branch]["commit"] == tip and report[branch]["tree"] == tree
        assert report[branch]["runtime"]["modelBuildId"] == expected_build
        assert report[branch]["runtime"]["sourceFiles"] == 5
        assert report[branch]["runtime"]["inventoryMatchesGitTree"]
        assert report[branch]["independence"]["objectAlternates"] == []
    assert sha(full) == full_sha and full.stat().st_mode & 0o777 == 0o640
    assert sha(baseline_bundle) == baseline_sha and sha(incremental) == incremental_sha
    assert git("rev-parse", "HEAD") == tip and git("status", "--porcelain") == ""
    assert list(temp_root.iterdir()) == [sentinel]
    checks.append({"case": "independent-full-and-baseline-incremental", "status": "passed", "sourceFiles": 5,
                   "inheritedGitDirectoryAndAlternateIgnored": True, "linkedWorktreeHeaderRestored": True,
                   "originalFullShaRestored": True, "unrelatedSentinelRetained": True})

    result, report = invoke("wrong-tree", expected_tree="0" * 40)
    assert result.returncode != 0 and report["status"] == "failed"
    assert "tip tree" in report["error"]["message"]
    assert report["memoryCycle"]["removedOnlyNewFullBundle"] and report["restoration"]["restored"]
    assert report["temporaryDirectoriesRemoved"] and sha(full) == full_sha
    assert sha(baseline_bundle) == baseline_sha and list(temp_root.iterdir()) == [sentinel]
    checks.append({"case": "exception-after-actual-pack-import-restores-full", "status": "passed"})

    # Pause only the fixture's index-pack child, then send a real SIGTERM after
    # the new bundle has left disk. The production verifier has no test hooks.
    proxy_dir = root / "git-proxy"
    proxy_dir.mkdir()
    marker = root / "index-pack-started"
    real_git = shutil.which("git")
    proxy = proxy_dir / "git"
    proxy.write_text("#!" + sys.executable + "\nimport os,sys,time,pathlib\n"
                     "if 'index-pack' in sys.argv:\n"
                     " pathlib.Path(" + repr(str(marker)) + ").write_text('started')\n"
                     " time.sleep(30)\n"
                     "os.execv(" + repr(real_git) + ",[" + repr(real_git) + ",*sys.argv[1:]])\n")
    proxy.chmod(0o755)
    signal_env = dict(hostile_env, PATH=str(proxy_dir) + os.pathsep + os.environ["PATH"])
    process, receipt_path = invoke("signal-interruption", environment=signal_env, background=True)
    try:
        deadline = time.monotonic() + 10
        while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(.01)
        assert marker.exists() and not full.exists(), "Fixture did not reach the active memory cycle"
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=15)
        assert process.returncode != 0, stdout + stderr
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            process.wait(timeout=15)
    report = json.loads(receipt_path.read_text())
    assert "Interrupted by signal" in report["error"]["message"]
    assert report["restoration"]["restored"] and sha(full) == full_sha
    assert report["temporaryDirectoriesRemoved"] and list(temp_root.iterdir()) == [sentinel]
    assert sha(baseline_bundle) == baseline_sha
    checks.append({"case": "actual-sigterm-during-memory-cycle-restores-original-sha", "status": "passed"})

    result, report = invoke("no-permission", memory=False)
    assert result.returncode == 2 and report is None and "--memory-cycle is required" in result.stderr
    assert sha(full) == full_sha
    result, report = invoke("baseline-alias", full_path=baseline_bundle)
    assert result.returncode != 0 and "aliases a read-only input" in report["error"]["message"]
    assert sha(baseline_bundle) == baseline_sha and "memoryCycle" not in report
    link = root / "new-full-link.bundle"
    link.symlink_to(full)
    result, report = invoke("full-symlink", full_path=link)
    assert result.returncode != 0 and "not a symlink" in report["error"]["message"]
    assert link.is_symlink() and sha(full) == full_sha
    checks.append({"case": "explicit-cycle-required-and-baseline-alias-symlink-refused", "status": "passed"})

    # A committed extra JS file cannot be hidden by .gitattributes export-ignore
    # and an unchanged generated source map.
    (dist / "hidden.js").write_text("export const unrecorded=true;\n")
    (source / ".gitattributes").write_text("dist/hidden.js export-ignore\n")
    git("add", ".")
    git("commit", "-m", "Deliberately invalid hidden source fixture")
    bad_tip, bad_tree = git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")
    bad_full, bad_incremental = root / "bad-full.bundle", root / "bad-incremental.bundle"
    git("bundle", "create", str(bad_full), "--all")
    git("bundle", "create", str(bad_incremental), baseline + "..HEAD")
    bad_sha = sha(bad_full)
    result, report = invoke("hidden-source", full_path=bad_full, inc_path=bad_incremental,
                            expected_commit=bad_tip, expected_tree=bad_tree)
    assert result.returncode != 0 and "inventories differ" in report["error"]["message"]
    assert report["restoration"]["restored"] and sha(bad_full) == bad_sha
    assert sha(baseline_bundle) == baseline_sha and list(temp_root.iterdir()) == [sentinel]
    checks.append({"case": "archive-export-ignore-cannot-hide-unmapped-executable", "status": "passed"})

REPORT.write_text(json.dumps({"schema": "roadster-delivery-history-verifier-fixture", "version": 1,
                             "status": "passed", "scope": "Small temporary actual Git repositories and bundles only; the real delivery bundles have not been cycled by this fixture.",
                             "checks": checks, "verifierSha256": sha(SCRIPT),
                             "testSha256": sha(Path(__file__))}, indent=2) + "\n")
print(json.dumps({"status": "passed", "checks": len(checks), "report": str(REPORT)}))
