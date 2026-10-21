"""Derive concise observations and a plot from original native event journals.

No trajectories are generated, interpolated or repaired here.  The source
report/video failures and per-case build identities remain unchanged.
"""
from pathlib import Path
from datetime import datetime
import gzip
import hashlib
import json
import math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

OUT = Path(__file__).resolve().parent / 'control-continuity-3.18'

def seconds_between(start, end):
    return (datetime.fromisoformat(end.replace('Z', '+00:00')) - datetime.fromisoformat(start.replace('Z', '+00:00'))).total_seconds()

def input_intervals(samples):
    intervals = []
    for sample in samples:
        if not intervals or sample['input'] != intervals[-1]['input']:
            intervals.append({'input': sample['input'], 'firstSampleSimS': sample['simTime'], 'lastSampleSimS': sample['simTime'], 'physicsSteps': 0})
        intervals[-1]['lastSampleSimS'] = sample['simTime']
        intervals[-1]['physicsSteps'] += 1
    for interval in intervals:
        interval['integratedDurationS'] = interval['physicsSteps'] / 120
    return intervals

def read_case(folder, kind):
    root = OUT / folder
    report = json.loads((root / 'report.json').read_text())
    case = next(c for c in report['cases'] if c['kind'] == kind)
    raw = (root / case['journal']['file']).read_bytes()
    journal = json.loads(gzip.decompress(raw))
    samples = [e for e in journal['events'] if e['type'] == 'physics-input']
    events = case['events']
    shot = root / case.get('frame', {}).get('file', kind + '-failure.png')
    return case, samples, {'kind': kind, 'report': str((root / 'report.json').relative_to(OUT)),
        'journal': str((root / case['journal']['file']).relative_to(OUT)),
        'journalSha256': hashlib.sha256(raw).hexdigest(),
        'identity': case['identity'], 'protocolStatus': case['status'],
        'sequenceGaps': case['journal']['sequenceGaps'],
        'video': str((root / case['video']['file']).relative_to(OUT)),
        'videoBytes': case['video']['bytes'], 'videoSha256': case['video']['sha256'],
        'frame': ({'file': str(shot.relative_to(OUT)), 'bytes': shot.stat().st_size, 'sha256': hashlib.sha256(shot.read_bytes()).hexdigest()} if shot.exists() else None),
        'timing': {'wallStartedAt': case['startedAt'], 'wallFinishedAt': case['finishedAt'],
            'wallElapsedS': seconds_between(case['startedAt'], case['finishedAt']),
            'firstActuationAt': events[0]['requestedAt'], 'lastActuationAt': events[-1]['returnedAt'],
            'actuationWallSpanS': seconds_between(events[0]['requestedAt'], events[-1]['returnedAt']),
            'physicsSamples': len(samples), 'recordedIntegratedTimeS': len(samples) / 120,
            'physicsStepJournalAvailable': bool(samples),
            'firstSampleSimS': samples[0]['simTime'] if samples else None, 'lastSampleSimS': samples[-1]['simTime'] if samples else None,
            'sampleTimeSpanS': samples[-1]['simTime'] - samples[0]['simTime'] if samples else None,
            'firstStageSimS': case['stages'][0]['state']['simTime'], 'lastStageSimS': case['stages'][-1]['state']['simTime'],
            'stageObservationSpanS': case['stages'][-1]['state']['simTime'] - case['stages'][0]['state']['simTime'],
            'scope': 'Wall time includes navigation, rendering, observations, pause/screenshot and video flush. Recorded integrated time is the sum of the production 1/120 s steps; it is not the wall duration.'},
        'keyboardEvents': events,
        'receivedKeyAndActionEvents': [{k: e[k] for k in ['sequence', 'wallTimeMs', 'type', 'code', 'name', 'accepted', 'reason', 'state', 'simTime', 'mode', 'pressed'] if k in e} for e in case['journal']['receivedKeys']],
        'actualInputIntervals': input_intervals(samples),
        'telemetrySnapshots': [{'label': stage['label'], 'wallAt': stage['wallAt'], **{k: stage['state'][k] for k in ['simTime', 'mode', 'stabilizationMode', 'position', 'velocity', 'contactCount', 'desiredWrench', 'controlOwnership'] if k in stage['state']}} for stage in case['stages']],
        'loadedHttpSources': case.get('loadedSources', []),
        'recordedErrors': [e for e in report['errors'] if e.get('kind') == kind],
        'protocolFailure': case.get('failure'),
        'sourceEvidenceScope': 'Per-case build was read from the running application. Candidate HTTP source bytes were hashed while loading; the first baseline run predates that additional capture and retains its exact build identity and original report.'}

before, bs, bi = read_case('native-baseline-317', 'X-release-W')
initial, ix, ii = read_case('native-candidate-318', 'X-release-W')
after, af, ai = read_case('native-final-318-focused', 'X-release-W')
g, gs, gi = read_case('native-candidate-318', 'G-continuous')
manual, ms, mi = read_case('native-candidate-318', 'manual-WE1')

def x_stats(c, s):
    final = c['final']
    observed = c.get('failureState', final)
    feedback = final['maneuverFeedback']['lastRun']
    return {'requestedWBeforeActionSeconds': 0.5 if c['kind'] == 'X-release-W' else None,
        'requestedQBeforeActionSeconds': 0.5 if c['kind'].startswith('Q-held-') else None,
        'startSimS': feedback['startedAtSimTimeS'],
        'recordedActionElapsedS': observed['simTime'] - feedback['startedAtSimTimeS'],
        'lastObservedMode': observed['mode'],
        'lastObservedPhase': (observed.get('maneuver') or {}).get('phase'),
        'lastObservedPitchDeg': observed['pitchDeg'],
        'lastObservedWheelContacts': observed['contactCount'],
        'lastWheelSupport': [{'id': w['id'], 'contact': w['contact'], 'loadN': w['normalLoadN'], 'suspensionLengthM': w['suspensionLength']} for w in observed['wheelStates']],
        'lastObservedActualJetForceN': observed['thrustN'],
        'actionFeedback': feedback, 'postCompletion': c['postCompletion'],
        'nativeWAfterObservation': ({'beforeSpeedKmh': c['beforeDriveHandoff']['forwardSpeedKmh'],
            'afterSpeedKmh': c['afterDriveHandoff']['forwardSpeedKmh'],
            'mode': c['afterDriveHandoff']['mode'], 'contacts': c['afterDriveHandoff']['contactCount'],
            'desiredWrench': c['afterDriveHandoff']['desiredWrench']} if 'afterDriveHandoff' in c else None)}

release, stopped = g['release'], g['beforeReopen']
gw = [e for e in gs if release['simTime'] <= e['simTime'] <= stopped['simTime']]
gm = {'beforeGWorldPosition': g['beforeG']['reference']['position'],
    'releaseWorldPosition': release['position'], 'releaseReference': release['reference']['position'],
    'stoppedWorldPosition': stopped['position'],
    'minimumZAfterReleaseM': min(e['actual']['position']['z'] for e in gw),
    'peakZAfterReleaseM': max(e['actual']['position']['z'] for e in gw),
    'minimumVzMps': min(e['actual']['velocity']['z'] for e in gw),
    'firstReleaseHadActualHullContact': any(e['actual']['rigidContactCount'] > 0 for e in gw),
    'reopenAndCollisionFinalReference': g['final']['reference']['position'],
    'finalOwnership': g['final']['controlOwnership'],
    'interpretation': 'The lab wall produced a real short rebound, including negative longitudinal velocity. The car did not return to the distant pre-G origin; the first release stopped near the reached wall and the next off transition captured its current position. H flight assist had been explicitly requested and remained the owner with G off.'}

we1 = [e for e in ms if e['input'].get('throttle', 0) > .99 and e['input'].get('lift', 0) > .99 and e['input'].get('pitch', 0) > .99]
q = manual['final']['quaternion']
mm = {'simultaneousWE1DurationS': len(we1) / 120,
    'firstWE1SimS': we1[0]['simTime'], 'lastWE1SimS': we1[-1]['simTime'],
    'lastActualSignedPitchTravelDeg': manual['final']['attitudeTravel']['pitchDeg'],
    'lastUpDotWorldUp': 1 - 2 * (q['x'] ** 2 + q['z'] ** 2),
    'lastWheelContacts': manual['final']['contactCount'],
    'lastRigidContactEquations': manual['final']['rigidContactCount'],
    'outcome': 'Manual low-clearance rear flip still fails. E and 1 were both received. This is not a controlled U success and is not claimed to be the old exact 780-step browser sequence.'}

summary = {'schema': 'roadster-native-continuity-observations-318',
    'stageNames': {'finalX': 'The c080 focused X run before the three later entry guards; this key is retained for compatibility and does not claim the final shipped build.',
        'initialCandidateX': 'The earlier f841 candidate run. Source bytes and identity stay attached to each recording.'},
    'sources': {'baselineX': bi, 'initialCandidateX': ii, 'finalX': ai, 'GChain': gi, 'manualWE1': mi},
    'requestedProtocols': {'baselineX': 'Settle on four wheels; W for at least 0.5 physical seconds; request X; release W; observe through at least 12.5 physical seconds if still incomplete.',
        'initialCandidateX': 'Same W then X then W release; after a physical completion observe at least another 5.05 physical seconds.',
        'finalX': 'Verify G on/off while in DRIVE and actual mode-specific toast; same W/X sequence; observe at least 5.05 physical seconds after completion; resume W for at least 1 physical second, release and observe ordinary driving.',
        'GChain': 'Explicit H flight for at least 6 s; G on + W for at least 5 s; G off + W release; four observation chunks of at least 2 s; reopen G + W for at least 2 s; release W for at least 3 s; G off again for at least 2 s.',
        'manualWE1': 'G on; W first for at least 0.5 s; add E and 1 and hold for at least 6.5 s; release E/1 and keep W for at least another 5 s. Actual simultaneous W/E/1 was 7.091667 s, not the old exact 780-step sequence.'},
    'baselineX': x_stats(before, bs), 'initialCandidateX': x_stats(initial, ix), 'finalX': x_stats(after, af),
    'GChain': gm, 'manualWE1': mm,
    'finalGOffDrivePrompt': after.get('gOffDrivePrompt', {}).get('text'),
    'limits': ['The f841 G chain and c080 focused moving-X run share byte-identical controller sources. The final a347 build adds separately tested entry/hold-exit guards; earlier recordings keep their actual identity.',
        'The original 3.17 end screenshot pause selector was hidden and timed out after continuous observation. Its failure report, unpaused screenshot and video are preserved; this does not erase the recorded persistent LAND result.',
        'Playwright generated native browser keyboard events under SwiftShader. This is not physical keyboard or user-GPU acceptance.',
        'Native sampling/UI round trips mean requested dwell lengths and actually received simultaneous-input duration differ; both are retained.',
        'All local runs requested the optional deployment.json and received HTTP 404; no pageerror exception was captured.',
        'The existing production input journal arms physics-step tracing only on X/U/G/E/Q/1/2. H/W/research-capture-only chains retain native key events, complete telemetry checkpoints and continuous video, but no 120 Hz journal. Empty journals are not treated as every-step passes. The numerical entry-guard tests separately retain every physical step.']}
boundary_report = OUT / 'native-final-a347' / 'report.json'
if boundary_report.exists():
    boundary = json.loads(boundary_report.read_text())
    if boundary.get('finishedAt'):
        available = {c['kind'] for c in boundary['cases'] if c.get('video')}
        summary['finalBoundaryStage'] = {'report': 'native-final-a347/report.json', 'protocolStatus': boundary['status'], 'sources': {}, 'outcomes': {}}
        if 'Q-held-X' in available:
            q, qs, qi = read_case('native-final-a347', 'Q-held-X')
            summary['finalBoundaryStage']['sources']['preHeldQX'] = qi
            summary['finalBoundaryStage']['outcomes']['preHeldQX'] = x_stats(q, qs)
            summary['finalBoundaryStage']['outcomes']['preHeldQX']['driveResponseText'] = q.get('driveResponse')
        if 'moving-H-and-hold-exit' in available:
            h, hs, hi = read_case('native-final-a347', 'moving-H-and-hold-exit')
            summary['finalBoundaryStage']['sources']['movingHAndHoldExit'] = hi
            if h.get('stoppedAfterH'):
                braking = [e for e in hs if h['movingHEntry']['simTime'] <= e['simTime'] <= h['stoppedAfterH']['simTime']]
                summary['finalBoundaryStage']['outcomes']['movingHBeforeToolFailure'] = {
                    'coastingBeforeH': {'position': h['coastingDrive']['position'], 'velocity': h['coastingDrive']['velocity']},
                    'HEntryOwner': h['movingHEntry']['controlOwnership'],
                    'HStoppedPosition': h['stoppedAfterH']['position'], 'HStoppedReference': h['stoppedAfterH']['reference']['position'],
                    'observedAfterEntryS': h['stoppedAfterH']['simTime'] - h['movingHEntry']['simTime'],
                    'minimumVzDuringRecordedBrakingMps': min((e['actual']['velocity']['z'] for e in braking), default=None),
                    'minimumVzAmongTelemetrySnapshotsMps': min(stage['state']['velocity']['z'] for stage in h['stages'] if stage['label'].startswith('H-brake-then-capture')),
                    'physicsStepJournalAvailable': bool(braking),
                    'sourceProtocolStatus': h['status'],
                    'limitation': 'The motion/braking stages completed, but the original combined protocol then asserted old command telemetry before a new physics step after hold exit. Its failure and video remain unchanged; a separate focused run supplies the missing post-exit window.'}
            if h.get('final') and h.get('afterHoldExit'):
                last_h = [e for e in hi['receivedKeyAndActionEvents'] if e.get('type') == 'keydown' and e.get('code') == 'KeyH'][-1]
                after_h = [e for e in hs if e['sequence'] > last_h['sequence']]
                braking = [e for e in hs if h['movingHEntry']['simTime'] <= e['simTime'] <= h['stoppedAfterH']['simTime']]
                summary['finalBoundaryStage']['outcomes']['movingHAndHoldExit'] = {
                    'coastingBeforeH': {'position': h['coastingDrive']['position'], 'velocity': h['coastingDrive']['velocity']},
                    'HEntryOwner': h['movingHEntry']['controlOwnership'],
                    'HStoppedPosition': h['stoppedAfterH']['position'], 'HStoppedReference': h['stoppedAfterH']['reference']['position'],
                    'minimumVzDuringRecordedBrakingMps': min((e['actual']['velocity']['z'] for e in braking), default=None),
                    'researchCapturedState': {'stabilizationMode': h['capturedResearchHold']['stabilizationMode'], 'position': h['capturedResearchHold']['position']},
                    'postHoldHMode': h['afterHoldExit']['mode'], 'postHoldHStabilization': h['afterHoldExit']['stabilizationMode'],
                    'postHoldHOwner': h['afterHoldExit']['controlOwnership'],
                    'postHoldHContinuousEvidence': {'integratedDurationS': len(after_h) / 120,
                        'physicsStepJournalAvailable': bool(after_h),
                        'everyStepDrive': all(e['mode'] == 'drive' for e in after_h) if after_h else None,
                        'everyStepGOff': all(e['stabilization'] == 'off' for e in after_h) if after_h else None,
                        'maxRequestedWrenchMagnitude': max((math.hypot(*e['desiredWrench']) for e in after_h), default=None)},
                    'initialDriveResponseText': h.get('initialDriveResponse'), 'postHoldDriveResponseText': h.get('driveResponse')}
focused_report = OUT / 'native-final-a347-hold-focused' / 'report.json'
if focused_report.exists():
    focused = json.loads(focused_report.read_text())
    if focused.get('finishedAt') and focused['cases'][0].get('video'):
        h, hs, hi = read_case('native-final-a347-hold-focused', 'hold-exit-focused')
        summary['finalHoldExitFocused'] = {'source': hi, 'protocolStatus': h['status']}
        if h.get('final') and h.get('afterHoldExit'):
            last_h = [e for e in hi['receivedKeyAndActionEvents'] if e.get('type') == 'keydown' and e.get('code') == 'KeyH'][-1]
            after_h = [e for e in hs if e['sequence'] > last_h['sequence']]
            summary['finalHoldExitFocused']['outcome'] = {
                'researchCapturedState': {'stabilizationMode': h['capturedResearchHold']['stabilizationMode'], 'position': h['capturedResearchHold']['position']},
                'modeEventSampleBeforeNextPhysics': {'simTime': h['afterHoldExitBeforePhysics']['simTime'], 'owner': h['afterHoldExitBeforePhysics']['controlOwnership'], 'mode': h['afterHoldExitBeforePhysics']['mode'], 'stabilization': h['afterHoldExitBeforePhysics']['stabilizationMode']},
                'firstIntegratedObservation': {'simTime': h['afterHoldExit']['simTime'], 'owner': h['afterHoldExit']['controlOwnership'], 'mode': h['afterHoldExit']['mode'], 'stabilization': h['afterHoldExit']['stabilizationMode']},
                'lastIntegratedObservation': {'simTime': h['final']['simTime'], 'owner': h['final']['controlOwnership'], 'mode': h['final']['mode'], 'stabilization': h['final']['stabilizationMode'], 'contacts': h['final']['contactCount']},
                'observedPhysicalWindowAfterModeEventS': h['final']['simTime'] - h['afterHoldExitBeforePhysics']['simTime'],
                'postHoldHContinuousEvidence': {'integratedDurationS': len(after_h) / 120,
                    'physicsStepJournalAvailable': bool(after_h),
                    'everyStepDrive': all(e['mode'] == 'drive' for e in after_h) if after_h else None,
                    'everyStepGOff': all(e['stabilization'] == 'off' for e in after_h) if after_h else None,
                    'maxRequestedWrenchMagnitude': max((math.hypot(*e['desiredWrench']) for e in after_h), default=None)},
                'initialDriveResponseText': h.get('initialDriveResponse'), 'postHoldDriveResponseText': h.get('driveResponse')}
(OUT / 'native-observation-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
(OUT / 'native-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')

plt.rcParams.update({'font.size': 10, 'axes.titlesize': 12, 'font.family': 'DejaVu Sans', 'axes.spines.top': False, 'axes.spines.right': False})
fig, axes = plt.subplots(3, 1, figsize=(11.2, 8.4), sharex=True, layout='constrained', gridspec_kw={'height_ratios': [1.3, 1, 1.1]})
colours = ['#c35b48', '#187b78']
for c, samples, colour, label in [(before, bs, colours[0], '3.17 / original'), (after, af, colours[1], '3.18 / c080 moving-X stage')]:
    start = c['final']['maneuverFeedback']['lastRun']['startedAtSimTimeS']
    points = [s for s in samples if s['simTime'] >= start]
    xs = [s['simTime'] - start for s in points]
    axes[0].plot(xs, [s['actual']['pitchDeg'] for s in points], color=colour, lw=1.7, label=label)
    axes[1].step(xs, [s['actual']['wheelContactCount'] for s in points], where='post', color=colour, lw=1.6)
    axes[2].plot(xs, [s['desiredWrench'][1] / 1000 for s in points], color=colour, lw=1.3)

feedback = after['final']['maneuverFeedback']['lastRun']
end = feedback['endedAtSimTimeS'] - feedback['startedAtSimTimeS']
for ax in axes:
    ax.axvspan(end, end + 5, color=colours[1], alpha=.075)
    ax.axvline(end, color=colours[1], lw=1, ls='--')
    ax.grid(alpha=.18)
    ax.set_xlim(0, max(s['simTime'] for s in bs) - before['final']['maneuverFeedback']['lastRun']['startedAtSimTimeS'])
axes[0].set_ylabel('Actual pitch (degrees)')
axes[0].set_title('Moving X: W held first, X requested, W released — actual native input / solver journals', loc='left', fontweight='bold')
axes[0].legend(loc='upper left', frameon=False)
axes[0].set_ylim(-1.5, 23)
axes[0].annotate('Original remains nose-up in LAND', (12.7, 19), xytext=(9.7, 21.5), arrowprops={'arrowstyle': '-', 'color': colours[0]}, color=colours[0])
axes[1].set_ylabel('Wheel contacts')
axes[1].set_yticks([0, 1, 2, 3, 4])
axes[1].set_ylim(-.2, 4.7)
axes[1].text(end + .15, 4.37, 'Four-wheel handoff + at least 5 s continuous observation', color=colours[1], fontsize=9)
axes[2].set_ylabel('Requested body-up force (kN)')
axes[2].set_xlabel('Physical simulation time after X request (s)')
fig.suptitle('Moving X lands on four wheels and returns control to driving', x=.07, ha='left', fontsize=14)
fig.savefig(OUT / 'native-x-continuity.png', dpi=160)
plt.close(fig)
print(json.dumps({'baselineX': summary['baselineX']['lastObservedPitchDeg'], 'finalX': summary['finalX']['postCompletion'], 'finalNativeW': summary['finalX']['nativeWAfterObservation'], 'GRelease': gm['releaseWorldPosition'], 'GStopped': gm['stoppedWorldPosition'], 'manual': mm}, ensure_ascii=False))
