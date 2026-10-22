#!/usr/bin/env python3
"""Check the actual candidate selection boundary without packaging a dirty HEAD."""
from pathlib import Path
import datetime
import hashlib
import importlib.util
import json
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('candidate_package_319', ROOT / 'scripts/package-candidate-3.19.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def refuses(call):
    try:
        call()
    except (RuntimeError, module.launcher.CandidateError):
        return
    raise AssertionError('Unsafe path unexpectedly accepted')


def main():
    with tempfile.TemporaryDirectory(prefix='roadster-package-paths-319-') as folder:
        root = Path(folder)
        (root / 'qa').mkdir()
        (root / 'dist').mkdir()
        original = root / 'retained-old-evidence.json'
        original.write_bytes(b'{"historical":true}\n')
        before = original.read_bytes()
        (root / 'qa/history.json').symlink_to(original)
        (root / 'dist/runtime.js').write_text('export const current = true;\n')
        assert module.logical_payload_name('qa/history.json') == 'qa/history.json'
        assert module.launcher.safe_path(root, 'dist/runtime.js').is_file()
        refuses(lambda: module.launcher.safe_path(root, 'qa/history.json'))
        (root / 'dist/linked.js').symlink_to(original)
        refuses(lambda: module.launcher.safe_path(root, 'dist/linked.js'))
        (root / 'linked-parent').symlink_to(root / 'dist', target_is_directory=True)
        refuses(lambda: module.launcher.safe_path(root, 'linked-parent/runtime.js'))
        invalid = [None, '', '/absolute', '../outside', 'dist/../outside', './dist/file',
                   'dist//file', 'dist/file/', 'C:escape', 'dist\\file', 'dist/\x00file']
        for name in invalid:
            refuses(lambda name=name: module.logical_payload_name(name))
        assert original.read_bytes() == before
    report = {
        'schema': 'roadster.package-candidate-path-boundary', 'version': 1,
        'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'status': 'passed',
        'checks': ['Unselected logical history names require no filesystem traversal',
                   'Selected history and runtime symlinks remain refused',
                   'Selected symlink parents remain refused',
                   'Noncanonical and escaping manifest names remain refused',
                   'Original evidence bytes remain unchanged'],
        'invalidNamesChecked': len(invalid),
        'scriptSha256': hashlib.sha256((ROOT / 'scripts/package-candidate-3.19.py').read_bytes()).hexdigest(),
        'scope': 'Temporary real filesystem path boundary only; final committed package verification is separate.'
    }
    (ROOT / 'qa/package-candidate-paths-3.19.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
