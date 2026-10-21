"""Check original evidence bytes; executable QA changes are explicit exceptions."""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = 'd9a4fbfd434fe49cdbeae18c32f624360e9dc4e9'
REVIEWED = {
    'qa/visual-upgrade-check.mjs': 'Executable QA helper: old fixed-rate shadow cap replaced by the same-display-pose update contract; finite pool/light/texture constraints retained. Historical data files are unchanged.',
    'qa/vehicle-inspection-3.10-dom-check.mjs': 'Await actual asynchronous export anchor handoffs with bounded timers instead of immediate blob counts. Original language, metadata, physical state, camera and archive assertions remain; language changes must not re-download or alter receipts/bytes.',
    'qa/render-budget-check.mjs': 'Only the result label now says stationary fallback rather than a universal 30 Hz cap. All numeric assertions, original view budgets and source checks are unchanged.',
}

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def sha256(data):
    return hashlib.sha256(data).hexdigest()

rows, missing, unexpected, changes = [], [], [], []
for raw in git('ls-tree', '-r', '-z', BASE, '--', 'qa', 'docs').split(b'\0'):
    if not raw:
        continue
    metadata, path_bytes = raw.split(b'\t', 1)
    mode, kind, oid = metadata.decode().split()
    if kind != 'blob':
        continue
    name = path_bytes.decode()
    path = ROOT / name
    if not path.is_file():
        missing.append(name)
        continue
    data = path.read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    row = {'path': name, 'baselineGitBlob': oid, 'currentGitBlob': actual,
           'bytes': len(data), 'unchanged': oid == actual}
    rows.append(row)
    if oid != actual:
        if name in REVIEWED:
            changes.append({**row, 'reviewedReason': REVIEWED[name]})
        else:
            unexpected.append(row)

payloads = []
for row in json.loads(git('show', BASE + ':repository-payloads/manifest.json'))['files']:
    name = row['path']
    if not name.startswith('qa/'):
        continue
    data = (ROOT / name).read_bytes()
    payloads.append({'path': name, 'expectedBytes': row['bytes'], 'actualBytes': len(data),
                     'expectedSha256': row['sha256'], 'actualSha256': sha256(data),
                     'unchanged': len(data) == row['bytes'] and sha256(data) == row['sha256']})

passed = not missing and not unexpected and all(row['unchanged'] for row in payloads)
report = {'schema': 'roadster-history-preservation-3.18',
          'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'baselineCommit': BASE, 'baselineTree': git('rev-parse', BASE + '^{tree}').decode().strip(),
          'status': 'historical-data-preserved-with-explicit-qa-code-changes' if passed else 'failed',
          'scope': 'Byte checks of every baseline tracked qa/ and docs/ blob and restored historical QA payload. Reviewed executable helpers are separate from evidence. Final complete ancestry and bundle recovery are independently checked after commit.',
          'trackedFilesChecked': len(rows) + len(missing), 'unchangedTrackedFiles': sum(row['unchanged'] for row in rows),
          'missing': missing, 'unexpectedChanges': unexpected, 'reviewedExecutableChanges': changes,
          'historicalQaPayloads': payloads, 'trackedFiles': rows}
(ROOT / 'qa/history-preservation-3.18.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: report[key] for key in ['status', 'trackedFilesChecked', 'unchangedTrackedFiles', 'missing', 'unexpectedChanges']}, indent=2))
raise SystemExit(0 if passed else 1)
