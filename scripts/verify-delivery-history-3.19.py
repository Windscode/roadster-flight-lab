#!/usr/bin/env python3
"""Independently recover delivery history while holding one new bundle in RAM.

Only --full-bundle may temporarily leave disk, and only with --memory-cycle.
The original baseline bundle and source repository are never written. Catchable
errors/signals restore the RAM bytes in finally; SIGKILL or power loss cannot run
finally, so the selected full bundle must be a newly generated reproducible copy.
No model/source identity is generated or assigned by this verifier.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time


class VerificationError(RuntimeError):
    pass


CHUNK = 1024 * 1024
SHA1 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SOURCE_SUFFIXES = (".js", ".html", ".css")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def fingerprint(path):
    value = os.stat(path, follow_symlinks=False)
    return {key: getattr(value, key) for key in
            ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_mode")}


def git_environment():
    # In particular, do not inherit the development checkout's object alternate,
    # Git directory, worktree, config injection, replacement refs or index.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_SYSTEM=os.devnull,
               GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT="0",
               GIT_NO_REPLACE_OBJECTS="1", GIT_OPTIONAL_LOCKS="0")
    return env


def bundle_header(prefix):
    end = prefix.find(b"\n\n")
    if end < 0 or end + 6 > len(prefix):
        raise VerificationError("Missing bounded bundle header / pack marker")
    offset = end + 2
    if prefix[offset:offset + 4] != b"PACK":
        raise VerificationError("Bundle payload does not start with PACK")
    lines = prefix[:end].decode("utf-8").split("\n")
    if lines[0] not in ("# v2 git bundle", "# v3 git bundle"):
        raise VerificationError("Only SHA-1 Git bundle v2/v3 is supported")
    refs, prerequisites, capabilities = {}, [], []
    for line in lines[1:]:
        if line.startswith("@"):
            if line != "@object-format=sha1":
                raise VerificationError("Unsupported bundle capability: " + line)
            capabilities.append(line)
            continue
        if line.startswith("-"):
            oid = line[1:].split(" ", 1)[0]
            if not SHA1.fullmatch(oid):
                raise VerificationError("Invalid bundle prerequisite")
            prerequisites.append(oid)
            continue
        try:
            oid, name = line.split(" ", 1)
        except ValueError as error:
            raise VerificationError("Malformed advertised bundle ref") from error
        if (not SHA1.fullmatch(oid) or name in refs or
                not (name == "HEAD" or name.startswith("refs/") or
                     re.fullmatch(r"worktrees/[^/]+/HEAD", name))):
            raise VerificationError("Invalid or duplicate advertised bundle ref")
        refs[name] = oid
    if not refs:
        raise VerificationError("Bundle advertises no refs")
    return {"format": lines[0], "packOffset": offset, "refs": refs,
            "prerequisites": prerequisites, "capabilities": capabilities}


def file_header(path):
    with open(path, "rb") as stream:
        return bundle_header(stream.read(CHUNK))


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError("Duplicate JSON source-map key: " + key)
        result[key] = value
    return result


def js_sort(names):
    # JS Array.sort compares UTF-16 code units, including for non-ASCII paths.
    return sorted(names, key=lambda name: name.encode("utf-16-be"))


class IndependentVerifier:
    def __init__(self, args, receipt):
        self.args, self.receipt = args, receipt
        self.env = git_environment()
        self.git = shutil.which("git")
        if not self.git:
            raise VerificationError("git is not installed")
        self.owned_directories = []

    def stage(self, name):
        self.receipt["stage"] = name
        print("history verification: " + name, file=sys.stderr, flush=True)

    def command(self, directory, *args):
        command = [self.git, "-c", "core.hooksPath=" + os.devnull,
                   "-c", "gc.auto=0", "-c", "maintenance.auto=false"]
        if directory is not None:
            command += ["--git-dir=" + str(directory)]
        return command + list(args)

    def run_git(self, directory, *args, data=None, stdin=None):
        result = subprocess.run(self.command(directory, *args), input=data,
                                stdin=stdin, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env=self.env,
                                cwd=self.args.temp_root,
                                timeout=self.args.command_timeout)
        entry = {"operation": list(args), "exitCode": result.returncode,
                 "stdout": result.stdout.decode("utf-8", "replace")[-32768:],
                 "stderr": result.stderr.decode("utf-8", "replace")[-32768:]}
        self.receipt["commands"].append(entry)
        if result.returncode:
            raise VerificationError("git " + " ".join(args[:3]) + " failed: " + entry["stderr"])
        return result.stdout

    def new_bare(self, label):
        directory = Path(tempfile.mkdtemp(prefix="roadster-history-3.19-" + label + "-",
                                          dir=self.args.temp_root))
        self.owned_directories.append(directory)
        self.receipt["temporaryDirectories"].append(str(directory))
        self.run_git(None, "init", "--bare", "--template=", "--object-format=sha1", str(directory))
        self.assert_independent(directory)
        return directory

    def remove_bare(self, directory):
        if directory not in self.owned_directories:
            raise VerificationError("Refusing to remove a directory this run did not create")
        shutil.rmtree(directory)
        self.owned_directories.remove(directory)

    def assert_independent(self, directory):
        for name in ("objects/info/alternates", "objects/info/http-alternates"):
            if os.path.lexists(directory / name):
                raise VerificationError("Object alternate appeared in independent recovery")
        count = self.run_git(directory, "count-objects", "-v").decode()
        if any(line.startswith("alternate:") for line in count.splitlines()):
            raise VerificationError("Recovery reports an external object alternate")
        return {"objectAlternates": [], "countObjects": count}

    def restore_refs(self, directory, header):
        for name in header["refs"]:
            if name != "HEAD":
                self.run_git(None, "check-ref-format", "--allow-onelevel", name)
        updates = "".join("update " + name + " " + oid + "\n"
                          for name, oid in header["refs"].items()).encode()
        self.run_git(directory, "update-ref", "--no-deref", "--stdin", data=updates)
        for name, oid in header["refs"].items():
            actual = self.run_git(directory, "rev-parse", "--verify", name).decode().strip()
            if actual != oid:
                raise VerificationError("Advertised ref did not restore: " + name)

    def import_full_pack(self, directory, header, *, ram=None, path=None):
        if header["prerequisites"]:
            raise VerificationError("A full restoration bundle has prerequisites")
        if ram is not None:
            self.run_git(directory, "index-pack", "--stdin",
                         data=memoryview(ram)[header["packOffset"]:])
        else:
            with open(path, "rb") as stream:
                stream.seek(header["packOffset"])
                self.run_git(directory, "index-pack", "--stdin", stdin=stream)
        self.restore_refs(directory, header)
        self.run_git(directory, "fsck", "--full")
        return self.assert_independent(directory)

    def commit_tree(self, directory, commit):
        if self.run_git(directory, "cat-file", "-t", commit).strip() != b"commit":
            raise VerificationError("Expected identity is not a commit")
        actual = self.run_git(directory, "rev-parse", commit + "^{commit}").decode().strip()
        tree = self.run_git(directory, "rev-parse", commit + "^{tree}").decode().strip()
        if actual != commit:
            raise VerificationError("Commit identity mismatch")
        return tree

    def archive_runtime(self, directory, commit):
        # ls-tree checks the archive inventory too: export-ignore cannot hide an
        # extra executable file from a stale MODEL_SOURCE_HASHES map.
        raw_tree = self.run_git(directory, "ls-tree", "-r", "-z", "--full-tree", commit, "--", "dist")
        tree_sources = []
        for row in raw_tree.split(b"\0"):
            if not row:
                continue
            meta, raw_name = row.split(b"\t", 1)
            mode, kind, _oid = meta.decode().split()
            name = raw_name.decode("utf-8")
            if name != "dist/model-build.js" and name.endswith(SOURCE_SUFFIXES):
                if kind != "blob" or mode not in ("100644", "100755"):
                    raise VerificationError("Executable source is not a regular Git blob: " + name)
                tree_sources.append(name[5:])
        actual, retained, seen = {}, {}, set()
        source_bytes = 0
        with tempfile.TemporaryFile(dir=directory) as errors:
            process = subprocess.Popen(self.command(directory, "archive", "--format=tar", commit, "dist"),
                                       stdout=subprocess.PIPE, stderr=errors,
                                       env=self.env, cwd=self.args.temp_root)
            try:
                with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                    for member in archive:
                        path = PurePosixPath(member.name)
                        if path.is_absolute() or ".." in path.parts or path.parts[0] != "dist":
                            raise VerificationError("Unexpected path in runtime archive")
                        if member.isdir():
                            continue
                        if not member.isfile() or member.name in seen:
                            raise VerificationError("Non-regular or duplicate runtime archive entry")
                        seen.add(member.name)
                        name = member.name[5:]
                        if name not in ("model-build.js", "vehicle-models.js") and not name.endswith(SOURCE_SUFFIXES):
                            continue
                        stream = archive.extractfile(member)
                        digest, chunks = hashlib.sha256(), []
                        keep = name in ("model-build.js", "vehicle-models.js")
                        if keep and member.size > 8 * CHUNK:
                            raise VerificationError("Generated identity source exceeds bounded parser size")
                        for block in iter(lambda: stream.read(CHUNK), b""):
                            digest.update(block)
                            if keep:
                                chunks.append(block)
                        if name != "model-build.js":
                            actual[name] = digest.hexdigest()
                            source_bytes += member.size
                        if keep:
                            retained[name] = b"".join(chunks).decode("utf-8")
                result = process.wait(timeout=self.args.command_timeout)
                errors.seek(0)
                error_text = errors.read().decode("utf-8", "replace")[-32768:]
                self.receipt["commands"].append({"operation": ["archive", "--format=tar", commit, "dist"],
                                                  "exitCode": result, "stderr": error_text,
                                                  "stdout": "tar stream consumed without filesystem extraction"})
                if result:
                    raise VerificationError("git archive failed: " + error_text)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()
        if js_sort(tree_sources) != js_sort(actual):
            raise VerificationError("Git tree / streamed archive source inventories differ")
        text = retained.get("model-build.js", "")
        build_matches = re.findall(r'export\s+const\s+MODEL_BUILD_ID\s*=\s*"([0-9a-f]{64})"\s*;', text)
        source_match = re.search(r"export\s+const\s+MODEL_SOURCE_HASHES\s*=\s*(\{.*\})\s*;", text, re.S)
        if len(build_matches) != 1 or not source_match:
            raise VerificationError("Archived model-build.js has no unique generated identity")
        recorded = json.loads(source_match.group(1), object_pairs_hook=unique_object)
        if not isinstance(recorded, dict) or not recorded or js_sort(recorded) != js_sort(actual):
            raise VerificationError("Archived complete source inventory differs from MODEL_SOURCE_HASHES")
        for name, value in actual.items():
            if not isinstance(recorded[name], str) or not SHA256.fullmatch(recorded[name]) or recorded[name] != value:
                raise VerificationError("Archived source differs from model-build map: " + name)
        ordered = {name: actual[name] for name in js_sort(actual)}
        canonical = json.dumps(ordered, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        aggregate = hashlib.sha256(canonical).hexdigest()
        if aggregate != build_matches[0] or aggregate != self.args.expected_build:
            raise VerificationError("Archived build aggregate differs from recorded / expected build")
        versions = re.findall(r"export\s+const\s+MODEL_VERSION\s*=\s*(['\"])([^'\"]+)\1", retained.get("vehicle-models.js", ""))
        if len(versions) != 1 or versions[0][1] != self.args.expected_model_version:
            raise VerificationError("Archived model version differs from expected delivery")
        return {"modelVersion": versions[0][1], "modelBuildId": aggregate,
                "sourceFiles": len(actual), "sourceBytes": source_bytes,
                "sourceHashes": ordered, "inventoryMatchesGitTree": True,
                "archiveExtractedToDisk": False}

    def verify_tip(self, directory):
        tree = self.commit_tree(directory, self.args.expected_commit)
        if tree != self.args.expected_tree:
            raise VerificationError("Recovered tip tree differs from expected delivery")
        return {"commit": self.args.expected_commit, "tree": tree,
                "runtime": self.archive_runtime(directory, self.args.expected_commit),
                "independence": self.assert_independent(directory)}

    def restore_ram_bundle(self, full, ram, original_stat, expected_sha):
        self.stage("restore-original-RAM-bundle")
        if os.path.lexists(full):
            if full.is_symlink() or not full.is_file() or sha256_file(full) != expected_sha:
                raise VerificationError("Concurrent differing artifact at original full-bundle path; refusing to overwrite")
            return {"restored": True, "sha256": expected_sha, "bytes": len(ram), "alreadyPresentIdentical": True}
        descriptor, temporary = tempfile.mkstemp(prefix=full.name + ".restore-", dir=full.parent)
        temporary = Path(temporary)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                for offset in range(0, len(ram), CHUNK):
                    stream.write(memoryview(ram)[offset:offset + CHUNK])
                stream.flush()
                os.fchmod(stream.fileno(), stat.S_IMODE(original_stat.st_mode))
                os.fsync(stream.fileno())
            if sha256_file(temporary) != expected_sha:
                raise VerificationError("RAM bundle restoration byte identity mismatch")
            os.utime(temporary, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
            # Publish atomically without replacing a concurrent creator's file.
            # A hard link does not allocate a second on-disk copy of the pack.
            os.link(temporary, full, follow_symlinks=False)
            temporary.unlink()
            directory_fd = os.open(full.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            if sha256_file(full) != expected_sha:
                raise VerificationError("Restored final bundle SHA-256 differs from pre-cycle bytes")
            return {"restored": True, "sha256": expected_sha, "bytes": len(ram), "alreadyPresentIdentical": False}
        finally:
            if temporary.exists():
                temporary.unlink()

    def verify(self):
        args, receipt = self.args, self.receipt
        self.stage("read-only-preflight")
        full = args.full_bundle
        if full.is_symlink():
            raise VerificationError("--full-bundle must be a new regular file, not a symlink")
        original_stat = full.stat()
        if not stat.S_ISREG(original_stat.st_mode) or original_stat.st_nlink != 1:
            raise VerificationError("New full bundle must be a regular file with one hard link")
        for other in (args.baseline_bundle, args.incremental_bundle):
            if os.path.samefile(full, other):
                raise VerificationError("The cycled new full bundle aliases a read-only input")
        before = {str(path): fingerprint(path) for path in
                  (full, args.baseline_bundle, args.incremental_bundle)}
        ram = full.read_bytes()
        ram_sha = hashlib.sha256(ram).hexdigest()
        if len(ram) != original_stat.st_size or sha256_file(full) != ram_sha or fingerprint(full) != before[str(full)]:
            raise VerificationError("New full bundle changed while being captured in RAM")
        inputs = {}
        for label, path in (("full", full), ("baseline", args.baseline_bundle), ("incremental", args.incremental_bundle)):
            sha = ram_sha if label == "full" else sha256_file(path)
            expected = getattr(args, "expected_" + label + "_sha256")
            if expected and sha != expected:
                raise VerificationError(label + " bundle SHA-256 differs from supplied identity")
            inputs[label] = {"path": str(path), "bytes": path.stat().st_size, "sha256": sha,
                             "header": bundle_header(ram[:CHUNK]) if label == "full" else file_header(path)}
        for label in ("full", "baseline"):
            if inputs[label]["header"]["prerequisites"]:
                raise VerificationError(label + " bundle is not independently complete")
        for label in ("full", "incremental"):
            if args.expected_commit not in inputs[label]["header"]["refs"].values():
                raise VerificationError(label + " bundle does not advertise the expected new commit")
        if args.baseline_commit not in inputs["baseline"]["header"]["refs"].values():
            raise VerificationError("Baseline bundle does not advertise the specified base commit")
        if inputs["incremental"]["header"]["prerequisites"] != [args.baseline_commit]:
            raise VerificationError("Incremental prerequisites must be exactly the specified baseline commit")
        for path in (args.baseline_bundle, args.incremental_bundle):
            if fingerprint(path) != before[str(path)]:
                raise VerificationError("Read-only input changed during preflight")
        available = shutil.disk_usage(args.temp_root).free
        freed_here = len(ram) if full.parent.stat().st_dev == args.temp_root.stat().st_dev else 0
        largest_pack = max(inputs["full"]["bytes"], inputs["baseline"]["bytes"] + inputs["incremental"]["bytes"])
        required = largest_pack + max(64 * CHUNK, largest_pack // 16)
        receipt.update(inputs=inputs, diskPreflight={"availableBytes": available, "releasedOnTempFilesystemBytes": freed_here,
                                                     "requiredPackAndIndexAllowanceBytes": required,
                                                     "notAReservation": True,
                                                     "thinPackBaseExpansionNotKnownBeforeImport": True})
        if available + freed_here < required:
            raise VerificationError("Insufficient space for one independent bare pack and index allowance")
        removed = False
        old_handlers = {}
        def interrupt(signum, _frame):
            raise VerificationError("Interrupted by signal " + str(signum) + "; restoring cycled bundle")
        for signum in (signal.SIGINT, signal.SIGTERM):
            old_handlers[signum] = signal.signal(signum, interrupt)
        try:
            self.stage("memory-cycle-remove-new-full-copy")
            if fingerprint(full) != before[str(full)]:
                raise VerificationError("New full bundle changed before memory cycle")
            # Mark the restoration obligation before unlink: an ordinary signal
            # between unlink and the next Python statement must still recover.
            removed = True
            receipt["memoryCycle"] = {"explicitlyAuthorized": True, "removedOnlyNewFullBundle": True,
                                      "ramSha256": ram_sha, "ramBytes": len(ram)}
            full.unlink()
            self.stage("independent-full-pack-recovery")
            full_bare = self.new_bare("full")
            self.import_full_pack(full_bare, inputs["full"]["header"], ram=ram)
            receipt["fullRecovery"] = self.verify_tip(full_bare)
            self.remove_bare(full_bare)
            self.stage("independent-baseline-pack-recovery")
            incremental_bare = self.new_bare("incremental")
            self.import_full_pack(incremental_bare, inputs["baseline"]["header"], path=args.baseline_bundle)
            baseline_tree = self.commit_tree(incremental_bare, args.baseline_commit)
            if args.baseline_tree and baseline_tree != args.baseline_tree:
                raise VerificationError("Restored baseline tree differs from expected baseline")
            receipt["baselineRecovery"] = {"commit": args.baseline_commit, "tree": baseline_tree,
                                            "independence": self.assert_independent(incremental_bare)}
            self.stage("verify-and-unbundle-incremental")
            self.run_git(incremental_bare, "bundle", "verify", str(args.incremental_bundle))
            self.run_git(incremental_bare, "bundle", "unbundle", str(args.incremental_bundle))
            self.restore_refs(incremental_bare, inputs["incremental"]["header"])
            self.run_git(incremental_bare, "fsck", "--full")
            receipt["incrementalRecovery"] = self.verify_tip(incremental_bare)
            if receipt["fullRecovery"]["runtime"] != receipt["incrementalRecovery"]["runtime"]:
                raise VerificationError("Independent full and baseline+incremental source identities differ")
            self.remove_bare(incremental_bare)
            for label, path in (("baseline", args.baseline_bundle), ("incremental", args.incremental_bundle)):
                if fingerprint(path) != before[str(path)] or sha256_file(path) != inputs[label]["sha256"]:
                    raise VerificationError("Read-only " + label + " bundle changed")
            receipt["readOnlyInputsUnchanged"] = True
        finally:
            failure_stage = receipt["stage"]
            # Finish cleanup/restoration even if a second ordinary stop signal
            # arrives. This cannot protect against SIGKILL or loss of the host.
            for signum in old_handlers:
                signal.signal(signum, signal.SIG_IGN)
            try:
                cleanup_errors = []
                for directory in list(self.owned_directories):
                    try:
                        self.remove_bare(directory)
                    except Exception as error:
                        cleanup_errors.append(str(error))
                receipt["temporaryDirectoriesRemoved"] = not self.owned_directories
                if removed:
                    receipt["restoration"] = {"restored": False, "expectedSha256": ram_sha}
                    receipt["restoration"] = self.restore_ram_bundle(full, ram, original_stat, ram_sha)
                else:
                    receipt["restoration"] = {"restored": False, "notRequired": True, "newFullWasNeverRemoved": True}
                if cleanup_errors:
                    raise VerificationError("Own temporary bare cleanup failed: " + "; ".join(cleanup_errors))
            finally:
                receipt["lastVerificationStage"] = failure_stage
                for signum, handler in old_handlers.items():
                    signal.signal(signum, handler)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("full-bundle", "baseline-bundle", "incremental-bundle", "receipt"):
        parser.add_argument("--" + name, required=True, type=Path)
    for name in ("expected-commit", "expected-tree", "expected-build", "expected-model-version", "baseline-commit"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--baseline-tree")
    for name in ("full", "baseline", "incremental"):
        parser.add_argument("--expected-" + name + "-sha256")
    parser.add_argument("--memory-cycle", action="store_true", help="Explicitly allow only the new reproducible full bundle to leave disk temporarily")
    parser.add_argument("--temp-root", type=Path, default=Path(tempfile.gettempdir()))
    parser.add_argument("--command-timeout", type=float, default=1800)
    args = parser.parse_args()
    if not args.memory_cycle:
        parser.error("--memory-cycle is required; no artifact has been removed")
    for name in ("expected_commit", "expected_tree", "baseline_commit", "baseline_tree"):
        value = getattr(args, name)
        if value is not None and not SHA1.fullmatch(value):
            parser.error(name + " must be a full 40-hex SHA-1 identity")
    for name in ("expected_build", "expected_full_sha256", "expected_baseline_sha256", "expected_incremental_sha256"):
        value = getattr(args, name)
        if value is not None and not SHA256.fullmatch(value):
            parser.error(name + " must be a full 64-hex SHA-256 identity")
    if args.command_timeout <= 0:
        parser.error("--command-timeout must be positive")
    for name in ("full_bundle", "baseline_bundle", "incremental_bundle", "receipt", "temp_root"):
        setattr(args, name, Path(os.path.abspath(getattr(args, name))))
    if os.path.lexists(args.receipt):
        parser.error("Receipt already exists; use a new receipt path to retain earlier attempts")
    if not args.receipt.parent.is_dir() or not args.temp_root.is_dir():
        parser.error("Receipt parent and temporary root must already exist")
    return args


def main():
    args = parse_args()
    begin = time.monotonic()
    receipt = {"schema": "roadster-independent-delivery-history", "version": 1,
               "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "status": "running", "expected": {"commit": args.expected_commit,
               "tree": args.expected_tree, "build": args.expected_build,
               "modelVersion": args.expected_model_version, "baselineCommit": args.baseline_commit},
               "scope": "Two independent bare recoveries; no development-repository objects, alternates, worktree checkout, or runtime execution. Committed source identities are checked, never assigned.",
               "memoryCycleLimit": "Catchable failures and SIGINT/SIGTERM restore the new full bundle. SIGKILL/power loss cannot execute finally; the selected new artifact must be reproducible from preserved source history.",
               "temporaryDirectories": [], "commands": []}
    try:
        IndependentVerifier(args, receipt).verify()
        receipt["status"] = "passed"
    except BaseException as error:
        receipt["status"] = "failed"
        receipt["error"] = {"type": type(error).__name__, "message": str(error)}
    receipt["seconds"] = time.monotonic() - begin
    receipt["verifierSha256"] = sha256_file(Path(__file__))
    try:
        with open(args.receipt, "x", encoding="utf-8") as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as error:
        print("Receipt could not be written: " + str(error), file=sys.stderr)
        return 1
    print(json.dumps({"status": receipt["status"], "receipt": str(args.receipt),
                      "restoration": receipt.get("restoration"), "error": receipt.get("error")}, ensure_ascii=False))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
