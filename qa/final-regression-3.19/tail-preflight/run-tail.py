"""Sequential non-DOM preflight from pitch317 to the static checker.

Original assertions and commands are retained. The CPU timing comparison is
deferred to the isolated aggregate gate while other agents run DOM solvers.
"""
from pathlib import Path
import datetime
import hashlib
import json
import re
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
version = '.'.join(json.loads((root / 'package.json').read_text())['version'].split('.')[:2])
commands = [
    ['node', 'tests/pitch-maneuver-3.17.test.mjs'],
    ['node', 'tests/contact-impulse-3.17.test.mjs'],
    ['node', 'tests/vehicle-form-3.17.test.mjs'],
    ['node', 'tests/city-streets-3.17.test.mjs'],
    ['node', 'tests/city-street-detail-3.18.test.mjs'],
    ['node', 'tests/shadow-motion-3.18.test.mjs'],
    ['node', 'tests/control-continuity-3.18.test.mjs'],
    ['node', 'tests/control-transition-guards-3.18.test.mjs'],
    ['node', 'tests/vehicle-form-3.18.test.mjs'],
    ['node', 'tests/wind-matrix-3.18.test.mjs', f'qa/wind-matrix-{version}/validation'],
    ['node', 'tests/wind-response-3.17.test.mjs'],
    ['node', 'qa/surface-route-3.19-check.mjs'],
    ['node', 'qa/route-visuals-3.19-check.mjs'],
    ['node', 'tests/driver-feedback-3.19.test.mjs'],
    ['node', 'tests/city-learning-3.19.test.mjs'],
    [sys.executable, 'tests/trim-independent-3.14.py'],
    ['node', 'qa/visual-upgrade-check.mjs'],
    ['node', 'tests/render-performance.test.mjs'],
    ['node', 'tests/local-probe-sun.test.mjs'],
    ['node', 'tests/city-geometry-scope-3.14.test.mjs'],
    ['node', 'qa/exterior-materials-check.mjs'],
    ['node', 'qa/render-budget-check.mjs'],
    ['node', 'tests/indirect-lighting.test.mjs'],
    ['node', 'tests/research-dynamics.test.mjs'],
    ['node', 'tests/research-study.test.mjs'],
    ['node', 'qa/city-3.4-geometry-check.mjs'],
    ['node', 'tests/repository-payloads.test.mjs'],
    ['node', '--experimental-vm-modules', 'scripts/check-static.mjs'],
]
start_index = int(sys.argv[1]) if len(sys.argv) > 1 else 1
assert 1 <= start_index <= len(commands)
sha = lambda b: hashlib.sha256(b).hexdigest()
model_bytes = (root / 'dist/model-build.js').read_bytes()
build_id = re.search(rb'MODEL_BUILD_ID="([a-f0-9]+)"', model_bytes).group(1).decode()
assert build_id == '8ccb2ab0d967509682aae900ba5a9067bd986d8468f5d5f57f48256fcb857579'
validator_sha = sha((root / 'scripts/validate.mjs').read_bytes())
for number, command in enumerate(commands, 1):
    if number < start_index:
        continue
    source = next(x for x in command[1:] if x.startswith(('tests/', 'qa/', 'scripts/')))
    prefix = f'{number:02d}-{Path(source).stem}'
    attempt = len(list(out.glob(prefix + '-attempt-*.json'))) + 1
    log = out / f'{prefix}-attempt-{attempt:02d}.log'
    receipt = log.with_suffix('.json')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    tick = time.monotonic()
    before = sha((root / source).read_bytes())
    print('START', number, source, flush=True)
    with log.open('w') as stream:
        result = subprocess.run(command, cwd=root, stdout=stream, stderr=subprocess.STDOUT)
    record = {
        'sequence': number, 'attempt': attempt, 'command': command,
        'startedAt': started, 'durationS': time.monotonic() - tick,
        'exitCode': result.returncode, 'modelBuildId': build_id,
        'validatorSHA256AtInvocation': validator_sha,
        'runtimeManifestUnchanged': (root / 'dist/model-build.js').read_bytes() == model_bytes,
        'source': source, 'sourceSHA256AtStart': before,
        'sourceSHA256AtEnd': sha((root / source).read_bytes()),
        'log': str(log.relative_to(root)), 'logSHA256': sha(log.read_bytes()),
        'scope': 'Original non-DOM regression command, sequential preflight only. This is not a full aggregate pass, native input or GPU acceptance.',
    }
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    rows = [json.loads(p.read_text()) for p in sorted(out.glob('*-attempt-*.json'))]
    (out / 'index.json').write_text(json.dumps({
        'modelBuildId': build_id, 'commands': commands,
        'deferredToAggregate': ['tests/physics-cpu.test.mjs'],
        'reason': 'Timing-sensitive CPU comparison is reserved for the final isolated aggregate while another agent runs DOM/solver tests.',
        'attempts': rows,
    }, indent=2) + '\n')
    print('DONE', number, 'exit', result.returncode, f'{record["durationS"]:.2f}s', flush=True)
    if result.returncode or not record['runtimeManifestUnchanged'] or before != record['sourceSHA256AtEnd']:
        raise SystemExit(result.returncode or 1)
