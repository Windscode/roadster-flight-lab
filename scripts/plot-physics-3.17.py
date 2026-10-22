#!/usr/bin/env python3
"""Small review figures from the saved complete solver evidence; no re-simulation."""
from pathlib import Path
import gzip, json, math, os
os.environ.setdefault('MPLCONFIGDIR','/tmp/roadster-physics-mpl-317')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[1]
qa=ROOT/'qa'
pitch=json.loads((qa/'pitch-maneuver-3.17.json').read_text())
contact=json.loads((qa/'contact-impulse-3.17.json').read_text())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.grid':True,'grid.alpha':.18,'figure.facecolor':'#f8fafc','axes.facecolor':'white','savefig.facecolor':'#f8fafc'})

selected=['pitch-W-0-Gtrue','current-X','manual-W-then-E1-0.62-Gtrue-6.5']
traces={k:[] for k in selected}
with gzip.open(qa/'pitch-maneuver-3.17.ndjson.gz','rt') as f:
    for line in f:
        r=json.loads(line)
        if r['id'] in traces: traces[r['id']].append(r)

def values(key):
    rows=traces[key]
    if key.startswith('manual'):
        run=next(r for r in pitch['manualCases'] if r['id']==key)
        start=run['initial']['state']['simTime']
    else:
        run=next(r for r in pitch['runs'] if r['id']==key)
        start=run['feedback']['lastRun']['startedAtSimTimeS']
    q=run['initial']['body']['quaternion']['values']
    initial_pitch=2*math.atan2(-q[0],q[3])*180/math.pi
    return rows,[r['simTime']-start for r in rows],[r['attitudeTravel']['pitchDeg']-initial_pitch for r in rows]

fig,axes=plt.subplots(1,3,figsize=(14,4.7),layout='constrained')
palette={'pitch-W-0-Gtrue':'#167dba','current-X':'#208a63','manual-W-then-E1-0.62-Gtrue-6.5':'#b64a48'}
labels={'pitch-W-0-Gtrue':'W then U: controlled pitch','current-X':'X: original quick roll','manual-W-then-E1-0.62-Gtrue-6.5':'W then E+1: manual pitch'}
for key in selected:
    rows,t,angle=values(key)
    axes[0].plot(t,[r['position']['y'] for r in rows],color=palette[key],label=labels[key],lw=1.9)
    if key!='current-X':axes[1].plot(t,angle,color=palette[key],label=labels[key],lw=1.9)
axes[0].set(xlabel='Time after action / s',ylabel='CG height / m',title='Real launch, rotation and landing',xlim=(0,8))
axes[0].legend(fontsize=8,loc='upper right')
axes[0].annotate('U: 6.13 m peak\n4.675 s to four-wheel DRIVE',(2,6.13),(3.0,4.6),arrowprops={'arrowstyle':'-','color':'#334155'},fontsize=9)
axes[1].axhline(360,color='#64748b',ls=':',lw=1)
axes[1].axvline(6.5,color='#b64a48',ls=':',lw=1)
axes[1].set(xlabel='Time after action / s',ylabel='Actual signed pitch path / deg',title='Manual ground request still fails',xlim=(0,12.5),ylim=(-10,410))
axes[1].annotate('E+1 released at 6.5 s\nW retained; G recovery',(6.5,180),(7.2,85),arrowprops={'arrowstyle':'-','color':'#b64a48'},fontsize=9,color='#913835')
rows,t,_=values('pitch-W-0-Gtrue')
up=[1-2*(r['quaternion']['x']**2+r['quaternion']['z']**2) for r in rows]
axes[2].plot(t,up,color='#167dba',lw=1.9,label='Body up dot world up')
axes[2].scatter([ti for ti,r in zip(t,rows) if r['contactCount']>=3],[1.12 for r in rows if r['contactCount']>=3],s=9,color='#208a63',label='Wheel support >= 3')
axes[2].axhline(-1,color='#64748b',ls=':',lw=1)
axes[2].set(xlabel='Time after U / s',ylabel='Orientation / support',title='U crosses inversion without contact',xlim=(0,4.8),ylim=(-1.15,1.25))
axes[2].legend(fontsize=7.5,loc='lower right')
fig.suptitle('3.17 physical controls | Same nozzles, inertia and 350 bar external supply',fontsize=15,fontweight='bold')
fig.supxlabel('Numerical solver evidence. U is a separate assisted action. Default finite 350 bar onboard supply is refused by the impulse preflight.',fontsize=9)
fig.savefig(qa/'physics-pitch-summary-3.17.png',dpi=150)
plt.close(fig)

fig,axes=plt.subplots(1,3,figsize=(14,4.7),layout='constrained')
for fixed,label,color in [(False,'Original contact friction','#b64a48'),(True,'Same-contact Coulomb impulse','#167dba')]:
    rows=[r for r in contact['analytic'] if r['fixed']==fixed and r['mass']==100 and not r['diagonal']]
    axes[0].plot([r['hz'] for r in rows],[r['actualSpeedMps'] for r in rows],'o-',label=label,color=color,lw=1.8)
axes[0].axhline(6.5665,color='#208a63',ls=':',label='Analytic 10 - 0.35 x 9.81')
axes[0].set(xlabel='Integration frequency / Hz',ylabel='Speed after 1 s / m/s',title='Independent friction oracle',ylim=(-.5,7.3),xticks=[60,120,240])
axes[0].legend(fontsize=8,loc='center right')
for variant,style in [('before-3.16','--'),('after-3.17','-')]:
    for single,color in [(False,'#167dba'),(True,'#b64a48')]:
        rows=[r for r in contact['cases'] if r['variant']==variant and r['kind']=='severe' and r['single']==single]
        axes[1].plot([r['hz'] for r in rows],[r['peakTiltDeg'] for r in rows],marker='o',ls=style,color=color,label=f"{'3.17' if variant.startswith('after') else '3.16'} {'single wheel' if single else 'full width'}")
axes[1].set(xlabel='Integration frequency / Hz',ylabel='Peak tilt / deg',title='90 km/h curb: still NOT converged',xticks=[480,960,1920],ylim=(0,195))
axes[1].legend(fontsize=8,loc='lower right')
x,z,cx,cz=[],[],[],[]
with gzip.open(qa/'city-contact-provenance-3.17.ndjson.gz','rt') as f:
    for line in f:
        r=json.loads(line);x.append(r['position']['x']);z.append(r['position']['z'])
        if r['contactLedger']:cx.append(x[-1]);cz.append(z[-1])
axes[2].plot(x,z,color='#64748b',lw=1.2,label='954.6 m continuous route')
axes[2].scatter(cx,cz,s=15,color='#cf7925',label='Front wheel stop contacts',zorder=4)
axes[2].scatter([x[0]],[z[0]],marker='o',color='#208a63',s=35,zorder=5)
axes[2].scatter([x[-1]],[z[-1]],marker='s',color='#167dba',s=35,zorder=5)
axes[2].set(xlabel='City x / m',ylabel='City z / m',title='313 contact equations; hull = 0')
axes[2].set_aspect('equal',adjustable='datalim');axes[2].legend(fontsize=8,loc='lower right')
fig.suptitle('3.17 contact evidence | A real friction fix, with severe-impact limits retained',fontsize=15,fontweight='bold')
fig.supxlabel('Current-city numerical run: 190.4 s / 22,848 steps. Changed collision identity is declared; this is not a native browser or original-world replay.',fontsize=9)
fig.savefig(qa/'physics-contact-summary-3.17.png',dpi=150)
plt.close(fig)
print('Created physics-pitch-summary-3.17.png and physics-contact-summary-3.17.png from stored evidence.')
