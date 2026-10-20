import {compareConditions} from './research-comparison.js';

// Presentation uses saved all-step statistics, never recomputes a separate
// demonstration simulation and never ranks external supply against a tank.
export function landingResultSummary(record,other=null){
  if(!record)return null;
  const s=record.summary,finite=record.supplyMode==='finite';
  const completed=record.status==='completed'&&s.landingSucceeded===true;
  const out={id:record.id,completed,status:record.status,reason:record.reason,supplyMode:record.supplyMode,sourceModelVersion:record.identity?.modelVersion??null,sourceBuildId:record.identity?.modelBuildId??null,
    landingTimeS:s.stableLandingAtS??null,settlingTimeS:s.hoverSettlingTimeS??null,
    overshootM:s.holdOvershootM??null,touchdownVerticalMps:s.firstContact?.preContactVerticalMps??null,
    totalGasKg:finite?s.onboardDischargedKg:s.externalSupplyKg,
    fixedWindowGasKg:s.takeoffHoldDurationS>=6-1e-9?s.takeoffHoldGasKg:null,
    limitedSeconds:s.controllerLimitedSeconds??null,comparison:null};
  if(other){
    const a=landingResultSummary(other),conditions=compareConditions(other,record);
    const controlled=conditions.controlled&&a.supplyMode===out.supplyMode;
    const differences={};for(const key of ['landingTimeS','settlingTimeS','overshootM','totalGasKg','fixedWindowGasKg','limitedSeconds'])differences[key]=Number.isFinite(out[key])&&Number.isFinite(a[key])?out[key]-a[key]:null;
    out.comparison={baselineId:other.id,controlled,qualified:controlled&&completed&&a.completed,differences};
  }
  return out;
}
