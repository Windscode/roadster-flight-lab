"""Derive wind-minus-calm height response from retained production trajectories.

This is 20 Hz postprocessing, explicitly separate from 120 Hz primary metrics.
It does not run physics, interpolate samples, synthesize a response, or alter archives.
"""
from pathlib import Path
import gzip
import hashlib
import json
import math
import statistics
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'qa/wind-matrix-3.18/final')


def load(name):
    path = root / (name + '.json.gz')
    raw = gzip.decompress(path.read_bytes())
    return json.loads(raw), {'path': str(path), 'rawSha256': hashlib.sha256(raw).hexdigest()}


calm, provenance = load('calm-bench')
sources, rows = [provenance], []
for name in ['crosswind-bench', 'strong-bench']:
    archive, provenance = load(name)
    sources.append(provenance)
    for record in archive['records']:
        link = record['windComparison']
        reference = next(r for r in calm['records'] if r['windComparison']['seed'] == link['seed'] and r['windComparison']['role'] == link['role'])
        assert record['initialSnapshot']['physical'] == reference['initialSnapshot']['physical']
        assert record['algorithm']['hash'] == reference['algorithm']['hash']
        reference_steps = {s['step']: s for s in reference['samples']}
        values = []
        for sample in record['samples']:
            if not 2 < sample['timeS'] <= 6:
                continue
            assert sample['targetHeightM'] == reference_steps[sample['step']]['targetHeightM']
            values.append({'timeS': sample['timeS'], 'step': sample['step'], 'windMinusCalmHeightM': sample['heightM'] - reference_steps[sample['step']]['heightM']})
        assert len(values) == 80
        rms = math.sqrt(sum(s['windMinusCalmHeightM'] ** 2 for s in values) / len(values))
        rows.append({'profile': link['profile'], 'direction': link['direction'], 'role': link['role'], 'seed': link['seed'], 'resultId': record['id'], 'calmResultId': reference['id'], 'count20Hz': len(values), 'windMinusCalmHeightRmsM': rms, 'recordedVerticalWindPeakMps': max(abs(s['windVelocity']['y']) for s in record['samples']), 'values': values})

groups = []
for profile in ['crosswind', 'strong']:
    for direction in ['lateral', 'longitudinal']:
        group = {'profile': profile, 'direction': direction}
        for role in ['A', 'B']:
            values = [r['windMinusCalmHeightRmsM'] for r in rows if r['profile'] == profile and r['direction'] == direction and r['role'] == role]
            group[role] = {'minM': min(values), 'medianM': statistics.median(values), 'maxM': max(values), 'n': len(values)}
        groups.append(group)

report = {
    'schema': 'roadster-wind-increment-observation-3.18',
    'modelBuildId': calm['records'][0]['identity']['modelBuildId'],
    'sources': sources,
    'scope': 'Postprocessing of retained 20 Hz integrated states, not new physics and not the 120 Hz primary metric. For each law/seed, same-initial-state wind height minus calm height is paired at exact retained steps over 2 < t <= 6 seconds (80 samples). Calm repeats the same zero-wind case. Small deterministic sample; not general reliability.',
    'groups': groups, 'rows': rows,
}
(root / 'wind-increment-20hz.json').write_text(json.dumps(report, indent=2) + '\n')
print('Retained 20 Hz wind-minus-calm response written: ' + str(root / 'wind-increment-20hz.json'))
