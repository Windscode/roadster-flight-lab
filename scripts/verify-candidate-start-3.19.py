#!/usr/bin/env python3
"""Independently extract and start this turn's candidate on loopback only.

This checks the real launcher and served file bytes. It does not launch a
browser, create WebGL, simulate hardware keys, or certify rendered gameplay.
Only this verifier's new extraction and own child process are cleaned up.
"""
from pathlib import Path, PurePosixPath
import argparse
import datetime
import hashlib
import json
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--tree', required=True)
    parser.add_argument('--build', required=True)
    parser.add_argument('--temp-root', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    # Reject an output/input alias before entering the receipt-writing finally
    # block. This includes symlink aliases and existing hard links to the ZIP.
    if (args.receipt.resolve() == args.candidate.resolve()
            or args.receipt.exists() and args.candidate.exists()
            and args.receipt.samefile(args.candidate)):
        parser.error('The receipt must not overwrite the candidate ZIP')
    receipt = {'schema': 'roadster-independent-candidate-start-3.19',
               'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'status': 'running', 'candidate': str(args.candidate.resolve()),
               'scope': 'Fresh extraction, actual launcher hash verification and actual loopback HTTP. No browser/WebGL, native key, sound device or GPU acceptance.',
               'requestedIdentity': {'sourceCommit': args.commit, 'sourceTree': args.tree,
                                     'modelBuildId': args.build, 'modelVersion': '3.19.0'}}
    owned = None
    child = None
    logs = None
    try:
        if args.candidate.is_symlink():
            raise RuntimeError('Candidate must be a regular ZIP file')
        source = args.candidate.resolve(strict=True)
        if not source.is_file():
            raise RuntimeError('Candidate must be a regular ZIP file')
        receipt['candidateBytes'] = source.stat().st_size
        receipt['candidateSha256'] = sha256(source.read_bytes())
        args.temp_root.mkdir(parents=True, exist_ok=True)
        owned = Path(tempfile.mkdtemp(prefix='roadster-candidate-start-3.19-', dir=args.temp_root))
        receipt['extractionDirectory'] = str(owned)
        root = owned / 'Roadster_Flight_Lab_3.19'
        with zipfile.ZipFile(source) as archive:
            seen = set()
            for member in archive.infolist():
                path = PurePosixPath(member.filename)
                if (path.is_absolute() or '..' in path.parts or '\\' in member.filename
                        or not path.parts or path.parts[0] != root.name
                        or member.filename in seen
                        or stat.S_ISLNK(member.external_attr >> 16)):
                    raise RuntimeError('Unsafe, duplicate or unexpected ZIP member')
                seen.add(member.filename)
            archive.extractall(owned)
        if (root / '.git').exists() or any(p.is_symlink() for p in root.rglob('*')):
            raise RuntimeError('The independent extraction must contain no repository or symlink')
        check = subprocess.run([sys.executable, 'launch.py', '--check-only'], cwd=root,
                               capture_output=True, text=True, timeout=60)
        receipt['launcherCheck'] = {'exitCode': check.returncode, 'stdout': check.stdout, 'stderr': check.stderr}
        if check.returncode:
            raise RuntimeError('Independent launch.py --check-only failed')
        identity = json.loads((root / 'dist/deployment.json').read_text())
        if any(identity.get(k) != v for k, v in receipt['requestedIdentity'].items()):
            raise RuntimeError('Unpacked candidate identity differs from the selected final identity')
        receipt['identity'] = identity
        with socket.socket() as selection:
            selection.bind(('127.0.0.1', 0))
            port = selection.getsockname()[1]
        # This is an ephemeral verifier-owned HTTP process, not the managed
        # browser preview. If the free port is taken meanwhile, fail normally.
        logs = (owned / 'launcher-http.log').open('w+')
        child = subprocess.Popen([sys.executable, 'launch.py', '--no-browser', '--port', str(port)],
                                 cwd=root, stdout=logs, stderr=subprocess.STDOUT)
        receipt['server'] = {'host': '127.0.0.1', 'port': port, 'pid': child.pid,
                             'browserOpened': False, 'existingListenersModified': False}
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        prefix = 'http://127.0.0.1:' + str(port)
        ready = False
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError('The independent launcher exited before serving HTTP')
            # The launcher's flushed Open line is printed only after its own
            # successful bind. An unrelated listener winning the ephemeral-port
            # race must never qualify, even if it serves an identical candidate.
            own_log = (owned / 'launcher-http.log').read_text(encoding='utf-8', errors='replace')
            if 'Open: ' + prefix + '/dist/' not in own_log.splitlines():
                time.sleep(0.05)
                continue
            try:
                with opener.open(prefix + '/dist/deployment.json', timeout=1) as response:
                    ready = response.status == 200 and json.loads(response.read()) == identity
                if ready:
                    if child.poll() is not None:
                        raise RuntimeError('The owned launcher exited during its identity request')
                    receipt['server']['ownedLauncherBindConfirmed'] = True
                    break
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                pass
            time.sleep(0.05)
        if not ready:
            raise RuntimeError('The independent launcher did not serve its identity')
        paths = ['dist/index.html', 'dist/model-build.js', 'dist/main.js', 'dist/route-surface.js',
                 'dist/route-experience.js', 'dist/city-flight-review.js', 'dist/audio.js',
                 'dist/vendor/three.module.js', 'dist/vendor/cannon-es.js']
        manifest = json.loads((root / 'CANDIDATE_FILES.json').read_text())
        texture = next(row['path'] for row in manifest['files'] if row['path'].startswith('dist/assets/')
                       and Path(row['path']).suffix.lower() in ('.jpg', '.png', '.webp'))
        paths.append(texture)
        receipt['httpFiles'] = []
        for path in paths:
            with opener.open(prefix + '/' + path, timeout=5) as response:
                data = response.read()
                actual = {'path': path, 'status': response.status, 'bytes': len(data),
                          'sha256': sha256(data), 'contentType': response.headers.get('Content-Type')}
            if actual['status'] != 200 or actual['sha256'] != sha256((root / path).read_bytes()):
                raise RuntimeError('HTTP bytes differ from the independent extraction: ' + path)
            receipt['httpFiles'].append(actual)
        with opener.open(prefix + '/', timeout=5) as response:
            receipt['entryRedirect'] = {'url': response.url, 'status': response.status,
                                        'matchesIndex': response.read() == (root / 'dist/index.html').read_bytes()}
        if not receipt['entryRedirect']['matchesIndex']:
            raise RuntimeError('Entry URL did not reach this candidate index')
        try:
            opener.open(prefix + '/not-a-candidate-file', timeout=5)
            raise RuntimeError('The server unexpectedly exposed an unlisted path')
        except urllib.error.HTTPError as error:
            receipt['unlistedPathStatus'] = error.code
            if error.code != 404:
                raise
        if child.poll() is not None:
            raise RuntimeError('The owned launcher exited before HTTP verification completed')
        receipt['status'] = 'passed-independent-unpack-launch-and-http'
    except Exception as error:
        receipt['status'] = 'failed'
        receipt['error'] = type(error).__name__ + ': ' + str(error)
    finally:
        cleanup_errors = []
        if child is not None:
            try:
                if child.poll() is None:
                    # Windows does not support SIGINT via Popen.send_signal.
                    # terminate/kill act on this Popen child, never a port owner.
                    if sys.platform == 'win32':
                        child.terminate()
                    else:
                        child.send_signal(signal.SIGINT)
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=5)
            except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                cleanup_errors.append('own child: ' + str(error))
                try:
                    if child.poll() is None:
                        child.kill()
                        child.wait(timeout=5)
                except (OSError, ValueError, subprocess.TimeoutExpired) as fallback_error:
                    cleanup_errors.append('own child fallback: ' + str(fallback_error))
            receipt['ownServerExitCode'] = child.returncode
            receipt['ownServerStopped'] = child.poll() is not None
            if not receipt['ownServerStopped']:
                cleanup_errors.append('The verifier-owned child is still running')
        if logs is not None:
            try:
                logs.seek(0)
                receipt['serverLog'] = logs.read()
            except (OSError, UnicodeError) as error:
                cleanup_errors.append('own server log: ' + str(error))
            finally:
                try:
                    logs.close()
                except OSError as error:
                    cleanup_errors.append('own server log close: ' + str(error))
        if owned is not None:
            try:
                shutil.rmtree(owned)
            except OSError as error:
                cleanup_errors.append('own extraction: ' + str(error))
            receipt['ownExtractionRemoved'] = not owned.exists()
        if cleanup_errors:
            receipt['cleanupErrors'] = cleanup_errors
            receipt['status'] = 'failed'
            receipt.setdefault('error', 'Cleanup did not complete cleanly; see cleanupErrors')
        receipt['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': receipt['status'], 'receipt': str(args.receipt),
                      'error': receipt.get('error')}, ensure_ascii=False))
    return 0 if receipt['status'] == 'passed-independent-unpack-launch-and-http' else 1


if __name__ == '__main__':
    raise SystemExit(main())
