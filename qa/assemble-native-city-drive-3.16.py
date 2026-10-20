#!/usr/bin/env python3
"""Preserve one completed native run and derive a bounded, read-only review.

This does not start a browser, instantiate a solver, alter inputs, or edit PNGs.
Original collector counters and gaps stay in the original report and journals.
"""
import argparse
import collections
import datetime
import hashlib
import json
import math
from pathlib import Path
import shutil
import statistics
import struct
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--console', required=True, type=Path)
parser.add_argument('--contact-audit', required=True, type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
out = repo / 'qa/city-drive-native-3.16'
if out.exists() and any(out.iterdir()):
    raise SystemExit('Refusing to replace a previous native archive.')
out.mkdir(parents=True, exist_ok=True)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def load(name):
    return json.loads((args.source / name).read_text())

def journal(name):
    return [json.loads(line) for line in (args.source / name).read_text().splitlines()]

def describe(values):
    values = list(values)
    return {'count': len(values), 'min': min(values), 'median': statistics.median(values), 'max': max(values)} if values else {'count': 0}

report = load('report.json')
record = load('native-experiment.json')
telemetry = journal('telemetry-navigation.ndjson')
keylog = journal('key-requests.ndjson')
received = journal('received-input-events.ndjson')
decisions = journal('key-decisions.ndjson')
ui = journal('ui-actions.ndjson')
requested = [entry for entry in keylog if entry['phase'] == 'requested']
returned = [entry for entry in keylog if entry['phase'] == 'returned']
driving_codes = {'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space'}
driving_received = [entry for entry in received if entry['type'] in {'keydown', 'keyup'} and entry.get('code') in driving_codes]
record_driving = [entry for entry in record['events'] if entry.get('type') == 'pilot_input_event' and entry['detail']['type'] in {'keydown', 'keyup'} and entry['detail'].get('code') in driving_codes]
key_id = lambda entry: (entry['action'], entry['key'], entry['at'], entry['reason'], entry['lastObservedSimTime'])
returns_by_id = {key_id(entry): entry for entry in returned}
missing_returns = []
for index, request in enumerate(requested):
    if key_id(request) not in returns_by_id:
        event = driving_received[index] if index < len(driving_received) else None
        match = next((entry for entry in record_driving if event and entry['detail']['sequence'] == event['sequence']), None)
        missing_returns.append({'request': request, 'applicationReceipt': event, 'recordStep': match['step'] if match else None,
                                'meaning': 'The returned line is absent. Application receipt and the actual record are separate, retained evidence; no return time is reconstructed.'})

record_start = record['initialSnapshot']['initialSimTime']
record_end = record['finalSnapshot']['initialSimTime']
record_samples = [entry for entry in telemetry if record_start - 1e-8 <= entry['telemetry']['simTime'] <= record_end + 1e-8]
sim_intervals = [b['telemetry']['simTime'] - a['telemetry']['simTime'] for a, b in zip(record_samples, record_samples[1:])]
wall_intervals = [b['wallS'] - a['wallS'] for a, b in zip(record_samples, record_samples[1:])]
arrivals = [entry for entry in telemetry if entry.get('navigation', {}).get('status') == 'arrived' and entry['telemetry']['speedKmh'] <= .8]
stop_sample = arrivals[0] if arrivals else None
contact_samples = []
for index, sample in enumerate(telemetry):
    t = sample['telemetry']
    integration = t.get('integration') or {}
    rigid = t.get('rigidContactCount')
    microsteps = integration.get('rigidContactMicrosteps')
    if (isinstance(rigid, (int, float)) and rigid > 0) or (isinstance(microsteps, (int, float)) and microsteps > 0):
        previous = telemetry[index - 1]['telemetry'] if index else None
        following = telemetry[index + 1]['telemetry'] if index + 1 < len(telemetry) else None
        contact_samples.append({'line': index + 1, 'simTime': t['simTime'], 'position': t['position'],
            'speedKmh': t['speedKmh'], 'rollDeg': t['rollDeg'], 'pitchDeg': t['pitchDeg'], 'gLoad': t.get('gLoad'),
            'wheelContacts': t.get('contactCount'), 'rigidContactCount': rigid, 'integration': integration,
            'previousSample': {k: previous.get(k) for k in ['simTime', 'position', 'speedKmh', 'rigidContactCount']} if previous else None,
            'nextSample': {k: following.get(k) for k in ['simTime', 'position', 'speedKmh', 'rigidContactCount']} if following else None})

inventory = []
for source, name, role in [(path, path.name, 'original-native-run-file') for path in sorted(args.source.iterdir()) if path.is_file()] + [
        (args.console, 'console.log', 'original-process-output'),
        (args.contact_audit, 'rigid-contact-readonly.json', 'independent-read-only-geometry-analysis')]:
    data = source.read_bytes()
    target = out / name
    shutil.copy2(source, target)
    if target.read_bytes() != data:
        raise RuntimeError('Archive byte mismatch: ' + name)
    item = {'path': name, 'role': role, 'bytes': len(data), 'sha256': digest(data)}
    if name.endswith('.png'):
        item['dimensions'] = dict(zip(['width', 'height'], struct.unpack('>II', data[16:24])))
        item['pixelsEdited'] = False
    inventory.append(item)

validator_code = """import {readFileSync} from 'node:fs';
import {validateExperimentRecord} from './dist/experiment-records.js';
const r=validateExperimentRecord(JSON.parse(readFileSync(process.argv[1],'utf8')));
console.log(JSON.stringify({validator:'dist/experiment-records.js validateExperimentRecord',passed:true,id:r.id,stepCount:r.stepCount,durationS:r.durationS}));"""
validation = subprocess.run(['node', '--input-type=module', '-e', validator_code, str(args.source / 'native-experiment.json')],
                            cwd=repo, text=True, capture_output=True, check=True)
validator_result = json.loads(validation.stdout)

source_before = report['sourceAudits']['before']
source_after = report['sourceAudits']['after']
source_changes = [name for name in sorted(set(source_before['sourceHashes']) | set(source_after['sourceHashes']))
                  if source_before['sourceHashes'].get(name) != source_after['sourceHashes'].get(name)]
sample_times = {round(entry['telemetry']['simTime'], 8) for entry in telemetry}
missing_decision_samples = [entry['simTime'] for entry in decisions if round(entry['simTime'], 8) not in sample_times]
step_deltas = collections.Counter(b['step'] - a['step'] for a, b in zip(record['samples'], record['samples'][1:]))
max_nav_lateral = max((entry for entry in record_samples if isinstance((entry.get('navigation') or {}).get('lateralM'), (int, float))), key=lambda entry: entry['navigation']['lateralM'])
commands = [{k: entry.get(k) for k in ['step', 'simTime', 'method', 'args', 'accepted']} for entry in record['events'] if entry['kind'] == 'command']
end = record['summary']['finalPosition']
goal = report['initialNavigation']['destination']['position']
duration_wall = (datetime.datetime.fromisoformat(report['finishedAt'].replace('Z', '+00:00')) - datetime.datetime.fromisoformat(report['startedAt'].replace('Z', '+00:00'))).total_seconds()
post_export = report['last']['telemetry']

review = {
    'schema': 'roadster-native-city-drive-review', 'version': 1,
    'modelBuildId': record['identity']['modelBuildId'],
    'result': 'The existing lower Foundry entrance navigation reported arrival and the native vehicle stopped during one uninterrupted route. Compound rigid-contact samples and QA-journal gaps remain explicit.',
    'originalRun': {'startedAt': report['startedAt'], 'finishedAt': report['finishedAt'], 'automationWallS': duration_wall,
                    'plan': report['plan'], 'collectorResult': report['result'], 'failure': report['failure']},
    'sourceIdentity': {'beforeStatus': source_before['status'], 'afterStatus': source_after['status'],
        'sourceCountBefore': source_before['sourceCount'], 'sourceCountAfter': source_after['sourceCount'], 'changedSources': source_changes,
        'fieldManifests': len(source_before['assets']), 'fieldVolumes': sum(len(asset['volumes']) for asset in source_before['assets']),
        'allFieldManifestAndVolumeIdentitiesUnchanged': source_before['assets'] == source_after['assets'],
        'runtimeCommitAndTree': 'The local original record retains null sourceCommit/sourceTree. Actual served byte audits do not invent a published commit.',
        'operatorFile': {'path': '../native-city-drive-3.16.mjs', 'sha256': digest((repo / 'qa/native-city-drive-3.16.mjs').read_bytes()), 'measurement': 'Measured after execution; original plan and run journals retain their own timestamps.'}},
    'endpoint': {'goal': goal, 'existingArrivalRadiusM': report['initialNavigation']['destination']['arrivalRadiusM'],
        'firstObservedArrivalAndStopped': {k: stop_sample.get(k) for k in ['browserTimeMs', 'wallS', 'telemetry', 'navigation']} if stop_sample else None,
        'recordFinalPosition': end, 'recordFinalSpeedKmh': math.sqrt(sum(v * v for v in record['summary']['finalVelocity'].values())) * 3.6,
        'horizontalDistanceToGoalM': math.hypot(end['x'] - goal[0], end['z'] - goal[2]),
        'postExport': {k: post_export.get(k) for k in ['simTime', 'position', 'speedKmh', 'paused', 'mode']},
        'postExportMeaning': 'Opening the existing research/export workspace resumed simulation after the completed record. Inputs were released; the record final snapshot and the paused end image are preserved separately.'},
    'recordCoverage': {'validator': validator_result, 'startSimTime': record_start, 'endSimTime': record_end,
        'durationS': record['durationS'], 'fixedHz': record['identity']['fixedHz'], 'stepCount': record['stepCount'],
        'snapshotPhysicalStepDelta': record['finalSnapshot']['physical']['state']['_stepCount'] - record['initialSnapshot']['physical']['state']['_stepCount'],
        'inputRuns': len(record['inputRuns']), 'inputCoveredSteps': sum(run['steps'] for run in record['inputRuns']),
        'appliedInputRuns': len(record['appliedInputRuns']), 'appliedInputCoveredSteps': sum(run['steps'] for run in record['appliedInputRuns']),
        'inputsAndAppliedInputsExactlyEqual': record['inputRuns'] == record['appliedInputRuns'],
        'allStepStatisticsCount': record['summary']['count'], 'storedCurve': record['sampling'],
        'curveStepDeltaCounts': dict(step_deltas), 'curveFirstStep': record['samples'][0]['step'], 'curveLastStep': record['samples'][-1]['step'],
        'events': len(record['events']), 'recordedDrivingEvents': len(record_driving), 'publicCommandsDuringRecord': commands,
        'scope': 'All 120 Hz pre-solver and applied driver-input steps, initial/final physical snapshots and existing all-step statistics are retained. Full intermediate physical state is a 20 Hz curve; the raw record does not contain every Cannon contact pair or impulse.'},
    'inputReceiptCoverage': {'nativeRequestedDrivingEvents': len(requested), 'returnedJournalLines': len(returned),
        'applicationDrivingEvents': len(driving_received),
        'requestAndReceiptCodeOrderExactlyEqual': len(requested) == len(driving_received) and all((a['action'], a['key']) == (b['type'], b['code']) for a, b in zip(requested, driving_received)),
        'recordAndApplicationDrivingEventsExactlyEqual': [entry['detail'] for entry in record_driving] == driving_received,
        'receivedJournalLines': len(received), 'receivedFirstSequence': received[0]['sequence'], 'receivedLastSequence': received[-1]['sequence'],
        'receivedSequenceGaps': [[a['sequence'], b['sequence']] for a, b in zip(received, received[1:]) if b['sequence'] != a['sequence'] + 1],
        'applicationDroppedEvents': report['summary']['applicationJournalDroppedEvents'],
        'rejectedDrivingKeydowns': [entry for entry in driving_received if entry['type'] == 'keydown' and entry.get('accepted') is not True],
        'missingReturnedJournalLines': missing_returns,
        'gapMeaning': 'Eight original requested calls lack a returned journal line, despite matched application receipts and complete record input coverage. Their browser-call completion timestamps are unavailable; the original journals are not repaired.'},
    'telemetrySampling': {'originalCollectorCount': report['summary']['samples'], 'actualJournalLines': len(telemetry),
        'counterDifference': report['summary']['samples'] - len(telemetry), 'counterDifferenceCause': 'Unresolved collector/log discrepancy. The original report and actual journal are both preserved.',
        'controlDecisions': len(decisions), 'decisionTimesWithoutTelemetryRow': missing_decision_samples,
        'rowsWithinRecordInterval': len(record_samples), 'firstRecordedIntervalSampleSimTime': record_samples[0]['telemetry']['simTime'],
        'recordHeadBeforeFirstTelemetrySampleS': record_samples[0]['telemetry']['simTime'] - record_start,
        'positiveSimIntervalsS': describe(dt for dt in sim_intervals if dt > 1e-8), 'repeatedSimTimeIntervals': sum(abs(dt) < 1e-8 for dt in sim_intervals),
        'wallIntervalsS': describe(wall_intervals), 'scope': 'Readonly native telemetry/navigation polling. These rows do not establish continuous contact-force coverage; all-step inputs are in the separate original experiment record.'},
    'observedDynamics': {
        'peakSpeedKmhAll120HzStatistics': record['summary']['peakSpeedMps'] * 3.6,
        'peakSpeedKmhNativeTelemetrySamples': max(entry['telemetry']['speedKmh'] for entry in record_samples),
        'nativeTelemetryPeakAbsRollDeg': max(abs(entry['telemetry']['rollDeg']) for entry in record_samples),
        'nativeTelemetryPeakAbsPitchDeg': max(abs(entry['telemetry']['pitchDeg']) for entry in record_samples),
        'record20HzPeakAbsRollDeg': max(abs(entry['rollDeg']) for entry in record['samples']),
        'record20HzPeakAbsPitchDeg': max(abs(entry['pitchDeg']) for entry in record['samples']),
        'nativeTelemetryPeakGLoad': max(entry['telemetry']['gLoad'] for entry in record_samples if isinstance(entry['telemetry'].get('gLoad'), (int, float))),
        'nativeTelemetryPeakNavigationLateralM': max_nav_lateral['navigation']['lateralM'],
        'peakNavigationLateralAtSimTime': max_nav_lateral['telemetry']['simTime'],
        'offRouteTrueSamplesWithinRecord': sum(entry['navigation'].get('offRoute') is True for entry in record_samples),
        'recordIntervalTelemetryWheelContacts': dict(collections.Counter(entry['telemetry'].get('contactCount') for entry in record_samples)),
        'record20HzWheelContacts': dict(collections.Counter(entry.get('contactCount') for entry in record['samples'])),
        'all120HzMinimumHeightM': record['summary']['minimumHeightM'], 'all120HzMaximumHeightM': record['summary']['maximumHeightM'],
        'recordSummary': record['summary'],
        'attitudeReferenceCaution': 'The record peakAttitudeErrorDeg compares a flight reference and includes authored road turns; it is not a route lateral error or a vehicle roll angle.'},
    'compoundRigidContact': {'lastIntegrationSlicePositiveSamples': sum(isinstance(entry['telemetry'].get('rigidContactCount'), (int, float)) and entry['telemetry']['rigidContactCount'] > 0 for entry in record_samples),
        'lastSliceCountUnavailableSamples': sum(not isinstance(entry['telemetry'].get('rigidContactCount'), (int, float)) for entry in record_samples),
        'anyIntegrationMicrostepPositiveSamples': sum(isinstance((entry['telemetry'].get('integration') or {}).get('rigidContactMicrosteps'), (int, float)) and entry['telemetry']['integration']['rigidContactMicrosteps'] > 0 for entry in record_samples),
        'rigidMicrostepCountUnavailableSamples': sum(not isinstance((entry['telemetry'].get('integration') or {}).get('rigidContactMicrosteps'), (int, float)) for entry in record_samples),
        'maxObservedLastSliceCount': max(entry['telemetry']['rigidContactCount'] for entry in record_samples if isinstance(entry['telemetry'].get('rigidContactCount'), (int, float))),
        'samples': contact_samples, 'independentAnalysis': 'rigid-contact-readonly.json',
        'definition': 'The vehicle compound rigid body includes four wheel bump-stop cylinders and four vehicle boxes. The count alone does not identify a body shell, wheel, contact object, contact point or severity.',
        'readOnlyGeometryConclusion': 'At the positive sampled poses the four vehicle boxes remain about 0.30 m above y=0; front wheel bump-stop cylinders slightly cross the ground plane. Ground is the only nearby static AABB candidate. This supports wheel hard-stop contact as an inference, not a captured Cannon pair.',
        'remainingGap': 'Actual contact pair/shape IDs, contact points, multipliers/forces/impulses and continuous contact timing were not captured. The 20 Hz experiment curve has no rigid-contact field. Zero contact or independently validated impact severity is not established.'},
    'saveAndExport': {'recordStatus': record['status'], 'recordReason': record['reason'], 'persistence': report['last']['telemetry']['research']['experiment']['persistence'],
        'originalExports': report['exports'], 'byteHashMatched': all(item['sha256'] == digest((args.source / item['filename']).read_bytes()) for item in report['exports']),
        'timingScope': 'Application handed-off elapsed time, worker serialization time and automation-observed browser download completion remain separate. The app does not claim to observe browser save completion.'},
    'visualReview': [
        {'file': '01-native-start.png', 'actuallyOpened': True, 'pixelsEdited': False,
         'observed': 'Chase view shows the car, the lower Weave road, overhead structure and sky. The navigation displays the first left turn and 960 m remaining. Recording, four-wheel support and bench supply are visible; the mounted experimental rear assemblies are visible.',
         'limits': 'A single start image is not video and is not an atomic same-frame telemetry bundle. Software-renderer preview frame rate is not hardware performance.'},
        {'file': '02-native-end.png', 'actuallyOpened': True, 'pixelsEdited': False,
         'observed': 'The original UI displays Foundry vehicle entrance reached, 0 km/h and paused. Four experimental rear assemblies, lane markings, pavement borders and the lower street continue into the distance.',
         'limits': 'Foundry facade modules remain repetitive and simplified. The image shows the lower arrival area, not the maintenance court or an ascent to the upper road. It precedes ending/saving the live record.'}],
    'errors': report['errors'], 'errorScope': 'One original console 404 lacks its URL in this operator journal. No pageerror was recorded. Its resource identity is not retrospectively inferred from a different capture.',
    'limitations': [
        'One original route from the legal city spawn, using real native keys and the existing physics. The external key chooser is QA operation, not human handling evaluation.',
        'Lower Foundry entrance reached within the existing 8 m arrival radius; the vehicle did not need to touch the exact center coordinate. Upper-road ascent, maintenance court and the full drive-flight challenge remain untested by this run.',
        'This x=100 northbound drive does not prove the separate transverse X crossing at z=-100. Its existing geometry-ray evidence is separate.',
        'Existing bench supply, no wind, clear day and dry road. No flight thrust was requested; 0 kg gas throughput does not establish finite-air flight performance.',
        'Native key receipts are complete in the original application journal; eight external returned lines and one collector telemetry-count difference are explicitly unresolved.',
        'Geometry analysis does not replace unrecorded contact pair/force data, and the route is not described as compound-contact-free.',
        'The two PNGs are original start/end stills, not a full route video. No RGB pixel edits or exposure postprocessing were performed.'
    ],
    'files': inventory,
}
(out / 'review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
(out / 'validator-result.json').write_text(json.dumps(validator_result, ensure_ascii=False, indent=2) + '\n')
html = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Roadster 3.16 · Original native Foundry route</title>
<style>body{max-width:1100px;margin:32px auto;padding:0 20px;background:#12191e;color:#dce5e8;font:16px/1.65 system-ui}a{color:#89dadd}figure{margin:28px 0}img{width:100%;height:auto}figcaption{color:#b6c3c8}code{overflow-wrap:anywhere}</style>
<h1>3.16 原生 Foundry 连续路线</h1><p>实际采集构建 <code>28e9bc415a0509990cb88dcbb0a95117f013969e2283260208df5921c54b1d8f</code>。一次从原有出生点经 Weave → Crosstown → Foundry 下层车行入口的真实按键运行。原有导航判定抵达并刹停；不覆盖上层连接或维护庭。</p>
<p><a href="review.json">完整范围、输入覆盖、接触与日志缺口</a> · <a href="report.json">原始执行报告</a> · <a href="native-experiment.json">原生记录 4,149,005 字节</a> · <a href="rigid-contact-readonly.json">接触几何只读核查</a></p>
<p>190.4 s / 22,848 个物理步，3,809 个 20 Hz 轨迹点未抽稀。25 个末片刚体计数阳性、26 个微步阳性采样；compound 车体包含车轮硬限位，实际接触 pair 与冲量未采，不能称为全程无接触。1,130 个驾驶按键接收逐项吻合；外部日志缺 8 个 returned 条目，原遥测计数有 1 行差异，均原样保留。</p>
<figure><img src="01-native-start.png" alt="Original native Weave start, 960 by 540"><figcaption>原始起点：960×540，晴天、干地、balanced。完整路线并非由两张截图证明，连续输入和记录分别留存。</figcaption></figure>
<figure><img src="02-native-end.png" alt="Original native Foundry entrance arrival, 960 by 540"><figcaption>原始终点：现有导航显示“已到 · 车行入口”，车辆已暂停、0 km/h。Foundry 立面仍简化重复。这张图不是维护庭或上层坡道验收。</figcaption></figure>'''
(out / 'index.html').write_text(html + '\n')
print(json.dumps({'out': str(out), 'preservedFiles': len(inventory), 'preservedBytes': sum(item['bytes'] for item in inventory),
    'originalDownloadBytes': len((args.source / 'native-experiment.json').read_bytes()), 'sourceAudit': source_after['status'],
    'recordSteps': record['stepCount'], 'drivingRequests': len(requested), 'drivingReceipts': len(driving_received),
    'missingReturnedLines': len(missing_returns), 'telemetryRows': len(telemetry), 'collectorTelemetryCount': report['summary']['samples']}, ensure_ascii=False))
