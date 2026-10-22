"""Verify and serve a complete private candidate using Python 3's standard library."""
from pathlib import Path, PurePosixPath
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from urllib.parse import unquote, urlsplit
import argparse
import hashlib
import json
import os
import re
import socket
import threading
import webbrowser

VERSION = "3.17.0"
OS_SIDECARS = {".DS_Store", "Thumbs.db", "desktop.ini"}


class CandidateError(ValueError):
    """A concrete missing file, mixed identity, or integrity mismatch."""


def safe_path(root, name):
    if (not isinstance(name, str) or not name or "\\" in name or ":" in name
            or name.startswith("/") or "\x00" in name):
        raise CandidateError("Invalid candidate path: " + repr(name))
    parts = PurePosixPath(name).parts
    if any(p in (".", "..") for p in name.split("/")) or "/".join(parts) != name:
        raise CandidateError("Non-canonical candidate path: " + name)
    current = Path(root)
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise CandidateError("Symbolic links are not candidate files: " + name)
    return current


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path):
    def unique(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise CandidateError("Duplicate JSON key: " + str(key))
            obj[key] = value
        return obj
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise CandidateError("Cannot read " + path.name + ": " + str(error)) from error


def runtime_files(root):
    directory = safe_path(root, "dist")
    if not directory.is_dir():
        raise CandidateError("dist/ is missing; extract the complete candidate first")
    files = {}
    for parent, folders, names in os.walk(str(directory), followlinks=False):
        for name in folders + names:
            path = Path(parent) / name
            if path.is_symlink():
                raise CandidateError("Runtime symlink: " + str(path.relative_to(root)))
        for name in names:
            if name in OS_SIDECARS:
                continue
            path = Path(parent) / name
            if not path.is_file():
                raise CandidateError("Runtime entry is not a regular file: " + str(path))
            files[path.relative_to(root).as_posix()] = path
    return files


def verify_runtime(root):
    """Reproduce model-build.mjs's exact source inventory and aggregate digest."""
    root = Path(root)
    files = runtime_files(root)
    build_path = safe_path(root, "dist/model-build.js")
    try:
        text = build_path.read_text(encoding="utf-8")
    except OSError as error:
        raise CandidateError("dist/model-build.js is missing") from error
    build_match = re.search(r'export\s+const\s+MODEL_BUILD_ID\s*=\s*"([0-9a-f]{64})"\s*;', text)
    source_match = re.search(r'export\s+const\s+MODEL_SOURCE_HASHES\s*=\s*(\{.*\})\s*;', text, re.S)
    if not build_match or not source_match:
        raise CandidateError("model-build.js has no valid generated build/source identity")
    try:
        recorded = json.loads(source_match.group(1))
    except json.JSONDecodeError as error:
        raise CandidateError("Malformed MODEL_SOURCE_HASHES") from error
    if not isinstance(recorded, dict) or not recorded:
        raise CandidateError("MODEL_SOURCE_HASHES is empty")
    names = sorted(path[5:] for path in files if path != "dist/model-build.js"
                   and Path(path).suffix in (".js", ".html", ".css"))
    if names != sorted(recorded):
        missing = sorted(set(recorded) - set(names))
        extra = sorted(set(names) - set(recorded))
        raise CandidateError("Runtime source inventory differs from build; missing="
                             + repr(missing[:8]) + ", extra=" + repr(extra[:8]))
    actual = {}
    for name in names:
        expected = recorded[name]
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise CandidateError("Invalid source digest for " + name)
        actual[name] = sha256_file(safe_path(root, "dist/" + name))
        if actual[name] != expected:
            raise CandidateError("Runtime source differs from build: dist/" + name)
    canonical = json.dumps(actual, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    build = hashlib.sha256(canonical).hexdigest()
    if build != build_match.group(1):
        raise CandidateError("MODEL_BUILD_ID does not match the complete source-hash map")
    vehicle_text = safe_path(root, "dist/vehicle-models.js").read_text(encoding="utf-8")
    version_match = re.search(r"export\s+const\s+MODEL_VERSION\s*=\s*(['\"])([^'\"]+)\1", vehicle_text)
    if not version_match or version_match.group(2) != VERSION:
        raise CandidateError("This launcher requires candidate " + VERSION)
    return {"modelVersion": VERSION, "modelBuildId": build,
            "sourceFiles": len(names), "runtimeFiles": files}


def verify_candidate(root):
    root = Path(root).resolve()
    manifest = read_json(safe_path(root, "CANDIDATE_FILES.json"))
    if (not isinstance(manifest, dict) or manifest.get("schema") != "roadster.local-candidate-files"
            or manifest.get("version") != 1):
        raise CandidateError("CANDIDATE_FILES.json is not a supported complete candidate manifest")
    identity = read_json(safe_path(root, "dist/deployment.json"))
    if not isinstance(identity, dict):
        raise CandidateError("dist/deployment.json must contain a candidate identity object")
    if manifest.get("identity") != identity:
        raise CandidateError("Candidate manifest and deployment identity differ; do not combine versions")
    if (identity.get("application") != "roadster-flight-lab"
            or identity.get("modelVersion") != VERSION
            or identity.get("delivery") != "private-local-candidate"
            or identity.get("publicDeploymentPerformed") is not False):
        raise CandidateError("Unsupported candidate identity")
    for field, length in (("sourceCommit", 40), ("sourceTree", 40), ("modelBuildId", 64)):
        value = identity.get(field)
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{%d}" % length, value):
            raise CandidateError("Missing committed candidate identity: " + field)
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise CandidateError("Candidate file list is missing")
    paths, folded = set(), set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise CandidateError("Invalid candidate file entry")
        name, count, expected = entry.get("path"), entry.get("bytes"), entry.get("sha256")
        path = safe_path(root, name)
        if name in paths or name.casefold() in folded or name == "CANDIDATE_FILES.json":
            raise CandidateError("Duplicate or self-referential candidate path: " + name)
        if (type(count) is not int or count < 0 or not isinstance(expected, str)
                or not re.fullmatch(r"[0-9a-f]{64}", expected)):
            raise CandidateError("Invalid size/digest: " + name)
        if not path.is_file() or path.stat().st_size != count or sha256_file(path) != expected:
            raise CandidateError("Missing, changed or mixed candidate file: " + name)
        paths.add(name)
        folded.add(name.casefold())
    required = {"dist/index.html", "dist/model-build.js", "dist/deployment.json", "launch.py", "START_HERE.md"}
    if not required.issubset(paths):
        raise CandidateError("Candidate is incomplete: " + repr(sorted(required - paths)))
    runtime = verify_runtime(root)
    if set(runtime["runtimeFiles"]) != {p for p in paths if p.startswith("dist/")}:
        raise CandidateError("Unlisted runtime files are present; extract into a new empty folder")
    if runtime["modelBuildId"] != identity["modelBuildId"]:
        raise CandidateError("Deployment identity differs from actual runtime source")
    return {"identity": identity, "files": len(paths), "sourceFiles": runtime["sourceFiles"],
            "allowedPaths": paths | {"CANDIDATE_FILES.json"}}


class LocalServer(ThreadingHTTPServer):
    # Never reuse a live listener, including Windows' permissive SO_REUSEADDR.
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description="Verify and run Roadster Flight Lab 3.17 locally")
    parser.add_argument("--port", type=int, default=8318,
                        help="Loopback port (default: 8318; existing listeners are never stopped)")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--check-only", action="store_true", help="Verify identity and all files, without opening a port")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Choose a port from 1024 to 65535")
    root = Path(__file__).resolve().parent
    try:
        verified = verify_candidate(root)
    except (CandidateError, OSError, UnicodeError) as error:
        parser.exit(1, "Candidate verification failed: " + str(error)
                    + "\nExtract the complete candidate into a new folder; existing files were not changed.\n")
    identity, allowed = verified["identity"], verified["allowedPaths"]
    print("Roadster Flight Lab", identity["modelVersion"], flush=True)
    print("Build:", identity["modelBuildId"], flush=True)
    print("Source commit:", identity["sourceCommit"], flush=True)
    print("Source tree:", identity["sourceTree"], flush=True)
    print("Verified:", verified["files"], "files;", verified["sourceFiles"], "executable/style sources.", flush=True)
    if args.check_only:
        print("Identity and file hashes match. No server was started.", flush=True)
        return

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript",
                          ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css"}

        def send_head(self):
            path = unquote(urlsplit(self.path).path)
            if path in ("/", "/dist"):
                self.send_response(302)
                self.send_header("Location", "/dist/")
                self.end_headers()
                return None
            name = path.lstrip("/") + ("index.html" if path.endswith("/") else "")
            if name not in allowed:
                self.send_error(404, "Not a candidate file")
                return None
            return super().send_head()

        def list_directory(self, path):
            self.send_error(404, "Directory listing is disabled")
            return None

        def end_headers(self):
            self.send_header("Cache-Control", "no-cache")
            super().end_headers()

    try:
        server = LocalServer(("127.0.0.1", args.port), partial(Handler, directory=str(root)))
    except OSError as error:
        parser.exit(1, "Cannot open port " + str(args.port) + ": " + str(error)
                    + "\nThe existing listener was not stopped. Use --port 8319 for a separate instance.\n")
    url = "http://127.0.0.1:" + str(args.port) + "/dist/"
    print("Open:", url, flush=True)
    print("Identity:", url + "deployment.json", flush=True)
    print("Press Ctrl+C in this window to stop only this server.", flush=True)
    if not args.no_browser:
        timer = threading.Timer(0.3, lambda: webbrowser.open(url))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
