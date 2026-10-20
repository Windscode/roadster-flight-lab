/**
 * Native-key road validation. The default only prints a plan and opens nothing.
 * Run sequentially, after the shared browser/GPU window has been allocated.
 * All motion is produced by existing UI controls and Playwright keyboard events.
 * Read-only public navigation and telemetry choose keys; no solver/state setter,
 * recorder import, direct input dispatch, or second vehicle model is used.
 */
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {auditNativeSourceIdentity} from './native-source-identity-3.16.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=') ?? fallback;
const stage = option('stage', 'crosstown');
const stages = {
  exchange: {label: 'Weave Exchange, before any road junction', point: [-200, 0, -262], plannedDistanceM: 83},
  crosstown: {label: '50 m into Crosstown, following one native left turn', point: [-150, 0, -132.5], plannedDistanceM: 262.5},
  foundry: {label: 'Foundry Service Bridge vehicle entrance', point: [100, 0, 315], plannedDistanceM: 960},
};
if (!stages[stage]) throw Error('--stage must be exchange, crosstown, or foundry');
const runRequested = args.includes('--run');
const url = option('url', process.env.ROADSTER_URL || 'http://127.0.0.1:8316/');
const startedAt = new Date().toISOString();
const out = resolve(option('out', 'qa/native-city-drive-3.16/' + startedAt.replace(/[:.]/g, '-') + '-' + stage));
const cruiseKmh = Number(option('cruise-kmh', '18'));
const maxWallS = Number(option('max-wall-s', '900'));
const maxSimS = Number(option('max-sim-s', stage === 'foundry' ? '280' : '140'));
const expectedBuild = option('build', readFileSync(new URL('../dist/model-build.js', import.meta.url), 'utf8').match(/MODEL_BUILD_ID="([a-f0-9]{64})"/)?.[1]);
if (!(cruiseKmh >= 8 && cruiseKmh <= 24 && maxWallS >= 60 && maxWallS <= 3600 && maxSimS > 0 && maxSimS <= 285)) {
  throw Error('Limits: cruise 8–24 km/h, wall budget 60–3600 s, simulation budget 0–285 s (below the existing 300 s record cap).');
}
const plan = {
  schema: 'roadster.native-city-drive-plan', version: 1, preparedAt: startedAt,
  execution: runRequested ? 'requested-native-run' : 'plan-only-no-browser', url, stage,
  spawn: {ui: '#play-city', scenario: 'city', position: [-200, .62, -345], headingDeg: 0},
  destination: {ui: '#city-plan-nodes button:nth-child(2), then #city-plan-detail .secondary-button', id: 'foundry-gate'},
  plannedRoute: [[-200, 0, -345], [-200, 0, -132.5], [100, 0, -132.5], [100, 0, 315]],
  selectedStage: stages[stage], quality: 'balanced', viewport: {width: 960, height: 540},
  weather: 'clear-day', tireSurface: 'dry (existing default; checked, not changed)',
  cruiseKmh, turnKmh: 8, maxWallS, maxSimS, expectedBuild,
  direction: 'Vehicle forward is +Z; A turns towards +X, D towards -X. The first turn uses A and the second uses D.',
  evidence: 'Fresh native UI record, requested-key journal, application-received input journal, telemetry/navigation samples, actual start/end images, explicit failure/partial/arrival state.',
  scope: 'The planned distance is source geometry, not a native-drive result. Automated key selection does not establish human handling quality or hardware GPU performance. Upper-level continuation is a separate pending run.',
};
if (!runRequested) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

if (existsSync(out) && readdirSync(out).length) throw Error('An existing run or interrupted run must not be overwritten; choose another --out.');
mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const append = (file, value) => appendFileSync(join(out, file), JSON.stringify(value) + '\n');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright');
const browser = await chromium.launch({
  executablePath: process.env.ROADSTER_CHROME || '/tmp/roadster-browser-316/chrome-linux64/chrome',
  headless: true, args: ['--no-sandbox'],
  env: {...process.env, FONTCONFIG_FILE: process.env.ROADSTER_FONTCONFIG || '/tmp/roadster-fonts-316/fonts.conf'},
});
const context = await browser.newContext({viewport: plan.viewport, deviceScaleFactor: 1, acceptDownloads: true});
const page = await context.newPage();
page.setDefaultTimeout(45000);
const wallStart = performance.now(), held = new Set(), errors = [], pictures = [], exports = [], milestones = [], observations = [];
const summary = {samples: 0, distanceTravelledM: 0, maxSpeedKmh: 0, maxAbsRollDeg: 0, maxAbsPitchDeg: 0, maxGLoad: 0, maxRigidContactCount: 0, offRouteSamples: 0, inputReceiptGaps: [], rejectedDrivingKeys: [], applicationJournalDroppedEvents: 0};
const sourceAudits = {};
let lastSequence = 0, inputIdentity = null, last = null, initial = null, initialNavigation = null, route = null;
let result = {status: 'not-started', reason: ''}, failure = null, device = null, recordStarted = false, recordFinished = false;
let recordStartSim = null, lastProgressSim = null, lastProgressWall = performance.now();
let stopSignal = null;
process.on('SIGINT', () => {stopSignal = 'SIGINT';});
process.on('SIGTERM', () => {stopSignal = 'SIGTERM';});
page.on('pageerror', error => {const e = {type: 'pageerror', at: new Date().toISOString(), message: error.stack || error.message}; errors.push(e); append('browser-errors.ndjson', e);});
page.on('console', message => {if (message.type() === 'error') {const e = {type: 'console', at: new Date().toISOString(), message: message.text()}; errors.push(e); append('browser-errors.ndjson', e);}});

async function ui(action, detail, execute) {
  const entry = {action, detail, requestedAt: new Date().toISOString(), wallS: (performance.now() - wallStart) / 1000};
  append('ui-actions.ndjson', {...entry, phase: 'requested'});
  try {const value = await execute(); append('ui-actions.ndjson', {...entry, phase: 'returned', returnedAt: new Date().toISOString()}); return value;}
  catch (error) {append('ui-actions.ndjson', {...entry, phase: 'error', message: error.message}); throw error;}
}
const click = selector => ui('click', {selector}, () => page.locator(selector).click());
const press = key => ui('key-press', {key}, () => page.keyboard.press(key));
const select = (selector, value) => ui('select', {selector, value}, () => page.locator(selector).selectOption(value));
async function driveKeys(next, reason) {
  const desired = new Set(next);
  for (const key of [...held]) if (!desired.has(key)) {
    const event = {action: 'keyup', key, reason, at: new Date().toISOString(), lastObservedSimTime: last?.telemetry.simTime ?? null};
    append('key-requests.ndjson', {...event, phase: 'requested'});
    await page.keyboard.up(key); held.delete(key);
    append('key-requests.ndjson', {...event, phase: 'returned', returnedAt: new Date().toISOString()});
  }
  for (const key of desired) if (!held.has(key)) {
    const event = {action: 'keydown', key, reason, at: new Date().toISOString(), lastObservedSimTime: last?.telemetry.simTime ?? null};
    append('key-requests.ndjson', {...event, phase: 'requested'});
    await page.keyboard.down(key); held.add(key);
    append('key-requests.ndjson', {...event, phase: 'returned', returnedAt: new Date().toISOString()});
  }
}
async function observe(decision = null) {
  const sample = await page.evaluate(afterSequence => {
    const t = window.roadsterLab?.getState();
    if (!t) return {unavailable: true, ready: window.roadsterReady ?? null, app: window.roadsterApp?.getState?.() ?? null};
    const journal = window.roadsterLab.getInputTimeline();
    return {browserTimeMs: performance.now(), telemetry: t, navigation: window.roadsterLab.getCityNavigation(),
      input: {identity: journal.identity, droppedEvents: journal.droppedEvents, events: journal.events.filter(e => e.sequence > afterSequence)},
      focus: {tag: document.activeElement?.tagName, id: document.activeElement?.id, visibility: document.visibilityState},
      ui: {menuOpen: !document.querySelector('#game-menu').classList.contains('hidden'),
        mapOpen: !document.querySelector('#map-drawer').classList.contains('hidden'),
        engineeringOpen: !document.querySelector('#engineering-drawer').classList.contains('hidden'),
        researchOpen: t.research?.open ?? false}};
  }, lastSequence);
  if (sample.unavailable) throw Error('Public telemetry unavailable: ' + JSON.stringify(sample));
  inputIdentity ||= sample.input.identity;
  for (const event of sample.input.events) {
    if (event.sequence !== lastSequence + 1) summary.inputReceiptGaps.push({after: lastSequence, next: event.sequence});
    lastSequence = event.sequence;
    append('received-input-events.ndjson', event);
    if (recordStarted && event.type === 'keydown' && ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space'].includes(event.code) && !event.accepted) summary.rejectedDrivingKeys.push(event);
  }
  summary.applicationJournalDroppedEvents = sample.input.droppedEvents;
  delete sample.input.events;
  sample.wallS = (performance.now() - wallStart) / 1000;
  sample.decision = decision;
  append('telemetry-navigation.ndjson', sample);
  const t = sample.telemetry;
  if (last && t.simTime >= last.telemetry.simTime) summary.distanceTravelledM += Math.hypot(t.position.x - last.telemetry.position.x, t.position.y - last.telemetry.position.y, t.position.z - last.telemetry.position.z);
  summary.samples++;
  summary.maxSpeedKmh = Math.max(summary.maxSpeedKmh, t.speedKmh || 0);
  summary.maxAbsRollDeg = Math.max(summary.maxAbsRollDeg, Math.abs(t.rollDeg || 0));
  summary.maxAbsPitchDeg = Math.max(summary.maxAbsPitchDeg, Math.abs(t.pitchDeg || 0));
  summary.maxGLoad = Math.max(summary.maxGLoad, t.gLoad || 0);
  summary.maxRigidContactCount = Math.max(summary.maxRigidContactCount, t.rigidContactCount || 0);
  if (sample.navigation?.offRoute) summary.offRouteSamples++;
  last = sample;
  return sample;
}
async function picture(label) {
  const filename = label + '.png';
  try {await page.screenshot({path: join(out, filename), timeout: 45000}); pictures.push({filename, sha256: sha(readFileSync(join(out, filename))), capturedAt: new Date().toISOString(), stateAfterScreenshot: await observe(), source: 'native-browser-screenshot', pixelsEdited: false});}
  catch (error) {observations.push({type: 'screenshot-failed', label, message: error.message});}
}
async function openMenu() {
  const s = await observe();
  if (!s.ui.menuOpen) await click('#menu-btn');
}
async function finishRecord() {
  await driveKeys([], 'finish-or-abort');
  await openMenu();
  await click('[data-game-panel="telemetry"]');
  const s = await observe();
  if (s.telemetry.research.experiment.recording) {await click('#record-btn'); recordFinished = true;}
  await click('#csv-btn');
  // Exports use the application's existing worker/download UI. No data is
  // reconstructed from a different solver or from an injected local library.
  const saved = await observe();
  if (saved.telemetry.research.experiment.recordCount > 0) {
    const requestedAt = performance.now();
    const downloading = page.waitForEvent('download', {timeout: 60000}).catch(error => ({error}));
    await click('[data-ex-action="export-one"]');
    const download = await downloading;
    if (download.error) throw download.error;
    const filename = 'native-experiment.json';
    await download.saveAs(join(out, filename));
    const error = await download.failure(), bytes = readFileSync(join(out, filename)), data = JSON.parse(bytes);
    exports.push({filename, sourceFilename: download.suggestedFilename(), bytes: bytes.length, sha256: sha(bytes), downloadFailure: error,
      automationObservedMs: performance.now() - requestedAt, application: await page.evaluate(() => window.roadsterLab.getExportState()),
      record: {id: data.id, durationS: data.durationS, stepCount: data.stepCount, status: data.status, reason: data.reason, identity: data.identity,
        inputRuns: data.inputRuns?.length, appliedInputRuns: data.appliedInputRuns?.length, events: data.events?.length, summary: data.summary}});
    if (error) throw Error('Browser download failed: ' + error);
  }
}

try {
  sourceAudits.before = await auditNativeSourceIdentity(url, {expectedBuildId: expectedBuild});
  await ui('navigate', {url}, () => page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000}));
  await page.waitForFunction(() => window.roadsterReady === true && !!window.roadsterLab?.getState(), null, {timeout: 45000});
  await observe();
  if (inputIdentity.modelBuildId !== expectedBuild) throw Error('Native driving page does not match the requested frozen build: ' + JSON.stringify({expected: expectedBuild, actual: inputIdentity}));
  device = await page.evaluate(() => {
    const gl = document.querySelector('#viewport canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {webgl2: !!gl, vendor: gl?.getParameter(gl.VENDOR), renderer: gl?.getParameter(gl.RENDERER),
      unmaskedRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, userAgent: navigator.userAgent,
      viewport: {width: innerWidth, height: innerHeight, devicePixelRatio}};
  });
  await select('#language-select', 'zh');
  await openMenu(); await click('[data-game-panel="render"]');
  await select('#quality', 'balanced'); await select('#weather-preset', 'clear-day');
  await press('Escape');
  await click('#play-city');
  let s = await observe();
  if (s.telemetry.scenario !== 'city' || Math.hypot(s.telemetry.position.x + 200, s.telemetry.position.z + 345) > .2) throw Error('Existing city UI did not produce the documented legal spawn');
  if (s.telemetry.quality !== 'balanced' || s.telemetry.roadSurface?.preset !== 'dry') throw Error('Unexpected render/road configuration; preserving the actual state and stopping');
  for (let count = 0; s.telemetry.cameraMode !== 'chase' && count < 4; count++) {await press('KeyC'); s = await observe();}
  if (s.telemetry.cameraMode !== 'chase') throw Error('Could not select the existing chase view');
  await press('KeyM'); await click('#city-plan-nodes button:nth-child(2)'); await click('#city-plan-detail button.secondary-button');
  initialNavigation = (await observe()).navigation;
  if (initialNavigation.destination?.id !== 'foundry-gate' || !initialNavigation.path?.length) throw Error('Existing map did not return a Foundry road route');
  route = routeGeometry(initialNavigation.path);
  if (!['weave-main', 'crosstown-link', 'foundry-main'].every(id => initialNavigation.pathRoadIds.includes(id))) throw Error('The live UI route no longer uses the planned three carriageways; preserve and review it');
  await press('Escape');
  await openMenu(); await click('[data-game-panel="telemetry"]'); await click('#record-btn');
  initial = await observe(); recordStarted = !!initial.telemetry.research.experiment.recording;
  if (!recordStarted || initial.telemetry.paused) throw Error('Existing record button did not start a running live record');
  recordStartSim = initial.telemetry.simTime;
  await picture('01-native-start');
  const stageTarget = project(route, stages[stage].point), stageEnd = stageTarget.along;
  const drivenStartWall = performance.now();
  let lastPrint = performance.now(), decision = null, offRouteSince = null, rigidSince = null, noContactSince = null;
  result = {status: 'running', reason: ''};
  for (;;) {
    s = await observe(decision);
    const t = s.telemetry, elapsedSim = t.simTime - recordStartSim;
    const p = [t.position.x, t.position.y, t.position.z], location = project(route, p), remaining = stageEnd - location.along;
    if (lastProgressSim === null || t.simTime > lastProgressSim + .01) {lastProgressSim = t.simTime; lastProgressWall = performance.now();}
    for (const milestone of [
      {id: 'weave-exchange', along: 83}, {id: 'weave-crosstown-junction', along: 212.5},
      {id: 'crosstown-50m', along: 262.5}, {id: 'crosstown-foundry-junction', along: 512.5},
      {id: 'foundry-district', along: 783},
    ]) if (location.along >= milestone.along && !milestones.some(m => m.id === milestone.id)) {
      milestones.push({...milestone, actual: {simTime: t.simTime, position: t.position, headingDeg: t.headingDeg, speedKmh: t.speedKmh, navigation: s.navigation}});
    }
    const navArrival = s.navigation.status === 'arrived' && s.navigation.destination?.id === 'foundry-gate';
    if ((stage === 'foundry' ? navArrival : remaining <= 3 && remaining >= -5 && location.lateralM <= 2.5) && t.speedKmh <= .8) {
      result = {status: 'stage-reached', reason: stage === 'foundry' ? 'Live navigation reported arrival and the vehicle stopped.' : 'Native telemetry reached the selected short segment endpoint and the vehicle stopped.', remainingM: remaining, navigationArrived: navArrival}; break;
    }
    if (stopSignal) {result = {status: 'partial', reason: 'Operator process signal: ' + stopSignal}; break;}
    if ((performance.now() - drivenStartWall) / 1000 > maxWallS || elapsedSim >= maxSimS) {result = {status: 'partial', reason: 'Declared native-run time budget reached', elapsedSimS: elapsedSim, drivingWallS: (performance.now() - drivenStartWall) / 1000}; break;}
    if (performance.now() - lastProgressWall > 90000) throw Error('Actual simulation clock has not advanced for 90 wall seconds');
    if (t.fault || t.failure) throw Error('Actual solver reported failure: ' + JSON.stringify(t.fault || t.failure));
    if (t.paused || s.ui.menuOpen || s.ui.mapOpen || s.ui.researchOpen || s.focus.visibility !== 'visible') throw Error('Driving was interrupted by an actual pause, panel, focus, or visibility state');
    if (Math.abs(t.rollDeg) > 30 || Math.abs(t.pitchDeg) > 30 || t.forwardSpeedKmh < -1) throw Error('Actual attitude or unintended reverse triggered the declared stop rule');
    offRouteSince = s.navigation.offRoute ? (offRouteSince ?? t.simTime) : null;
    rigidSince = t.rigidContactCount > 0 ? (rigidSince ?? t.simTime) : null;
    noContactSince = t.contactCount === 0 ? (noContactSince ?? t.simTime) : null;
    if (offRouteSince !== null && t.simTime - offRouteSince > .5) throw Error('Live navigation reported off-route for more than 0.5 simulation seconds');
    if (rigidSince !== null && t.simTime - rigidSince > .3) throw Error('Sustained rigid-body contact exceeded 0.3 simulation seconds; contact count is retained, impact severity is not inferred from count alone');
    if (noContactSince !== null && t.simTime - noContactSince > 1) throw Error('All tyres lost contact for more than 1 simulation second');
    if (summary.rejectedDrivingKeys.length) throw Error('Application explicitly rejected a requested native driving key');
    if (!t.research.experiment.recording) throw Error('Existing complete input recorder stopped before the intended segment finished');
    if (remaining < -8) throw Error('Vehicle passed the selected endpoint; no reset or hidden correction will be applied');
    const lookahead = Math.max(4.5, Math.min(7, t.speedKmh / 3.6 * .9 + 3));
    const target = pointAlong(route, Math.min(stageEnd, location.along + lookahead));
    const headingToTarget = Math.atan2(target[0] - p[0], target[2] - p[2]) * 180 / Math.PI;
    const headingError = wrap(headingToTarget - t.headingDeg);
    const wheelTargetDeg = Math.max(-28, Math.min(28, Math.atan2(2 * 2.84 * Math.sin(headingError * Math.PI / 180), Math.max(2, Math.hypot(target[0] - p[0], target[2] - p[2]))) * 180 / Math.PI));
    const turn = route.turns.find(c => c.along >= location.along - 5);
    const turnDistance = turn ? Math.max(0, turn.along - location.along - 8) : Infinity;
    const desiredSpeedKmh = Math.min(cruiseKmh, Math.sqrt((8 / 3.6) ** 2 + 2 * 1.4 * turnDistance) * 3.6,
      Math.sqrt(2 * 1.4 * Math.max(0, remaining - 2)) * 3.6, Math.abs(headingError) > 45 ? 7 : cruiseKmh);
    const next = [];
    if (remaining <= 2.5 || t.speedKmh > desiredSpeedKmh + 1.2 || navArrival && stage === 'foundry') next.push('Space');
    else if (t.speedKmh < desiredSpeedKmh - .8) next.push('KeyW');
    if (!next.includes('Space') || t.speedKmh > 2) {
      if (wheelTargetDeg > 2 && t.steeringCentreDeg < wheelTargetDeg + 1) next.push('KeyA');
      if (wheelTargetDeg < -2 && t.steeringCentreDeg > wheelTargetDeg - 1) next.push('KeyD');
    }
    decision = {stage, alongM: location.along, lateralM: location.lateralM, remainingM: remaining,
      lookaheadM: lookahead, target, headingErrorDeg: headingError, wheelTargetDeg, measuredSteeringDeg: t.steeringCentreDeg,
      targetSpeedKmh: desiredSpeedKmh, keys: next, method: 'external navigation lookahead selects native keys; actual app solver supplies all motion'};
    append('key-decisions.ndjson', {simTime: t.simTime, wallS: s.wallS, ...decision});
    await driveKeys(next, 'navigation-speed-and-heading');
    if (performance.now() - lastPrint > 30000) {console.log(JSON.stringify({stage, simS: elapsedSim, drivingWallS: (performance.now() - drivenStartWall) / 1000, position: t.position, speedKmh: t.speedKmh, remainingM: remaining, navigation: s.navigation.status, keys: next})); lastPrint = performance.now();}
    await new Promise(resolveWait => setTimeout(resolveWait, 70));
  }
} catch (error) {
  failure = {message: error.message, stack: error.stack, at: new Date().toISOString()};
  result = {status: 'failed-or-interrupted', reason: error.message};
} finally {
  try {
    await driveKeys([], 'final-release');
    let stop = await observe();
    const beganSim = stop.telemetry.simTime, beganWall = performance.now();
    if (!stop.telemetry.paused && stop.telemetry.speedKmh > .8) {
      await driveKeys(['Space'], 'bounded-final-service-brake');
      while (!stop.telemetry.paused && stop.telemetry.speedKmh > .8 && stop.telemetry.simTime - beganSim < 3 && performance.now() - beganWall < 30000) {
        await new Promise(resolveWait => setTimeout(resolveWait, 70)); stop = await observe();
      }
    }
    await driveKeys([], 'final-service-brake-release');
    if (!stop.telemetry.paused && !stop.ui.menuOpen) await click(await page.locator('#operation-pause').isVisible() ? '#operation-pause' : '#pause-btn');
    await observe(); await picture('02-native-end');
  } catch (error) {observations.push({type: 'final-observation-failed', message: error.message});}
  if (recordStarted) try {await finishRecord();} catch (error) {observations.push({type: 'record-save-or-export-failed', message: error.message});}
  try {await observe();} catch (error) {observations.push({type: 'final-receipt-failed', message: error.message});}
  try {sourceAudits.after = await auditNativeSourceIdentity(url, {expectedBuildId: expectedBuild});}
  catch (error) {failure = {...failure, sourceIdentityAfter: error.message}; observations.push({type: 'source-identity-after-failed', message: error.message});}
  const report = {schema: 'roadster.native-city-drive-result', version: 1, startedAt, finishedAt: new Date().toISOString(),
    plan, result, failure, device, inputIdentity, sourceAudits, initial, initialNavigation, last,
    summary, milestones, recordStarted, recordFinished, exports, pictures, errors, observations,
    limitations: [
      'Actual native browser keys drove the existing simulator. This external key chooser is a QA operator, not a new in-game autopilot or a second solver.',
      'Observed input requests, browser completion, application receipt, accepted physics input, navigation arrival and complete record export are separate evidence.',
      'Navigation/telemetry sampling is not exhaustive impact-force measurement. The full application record retains original inputs and its own statistics.',
      'PNG capture and telemetry immediately following it are separate browser operations, not an atomic same-frame bundle.',
      'ANGLE/SwiftShader wall duration does not establish hardware GPU frame rate or human steering feel.',
      'The upper-level road connection is not included in this run; reaching a lower Foundry entrance does not establish ramp traversal.',
    ]};
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  console.log(JSON.stringify({out, result, exports: exports.map(e => ({filename: e.filename, bytes: e.bytes, durationS: e.record.durationS})), errors: errors.length, observations}));
  if (result.status !== 'stage-reached' || !exports.length || summary.inputReceiptGaps.length || failure) process.exitCode = 1;
}

function wrap(angle) {return ((angle + 540) % 360) - 180;}
function routeGeometry(points) {
  const vertices = points.filter((p, i) => !i || Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]) > 1e-5).map(p => [...p]);
  const segments = [], turns = []; let lengthM = 0;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i], length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    segments.push({a, b, length, start: lengthM}); lengthM += length;
    if (i < vertices.length - 1) {
      const c = vertices[i + 1], h1 = Math.atan2(b[0] - a[0], b[2] - a[2]), h2 = Math.atan2(c[0] - b[0], c[2] - b[2]);
      const angleDeg = wrap((h2 - h1) * 180 / Math.PI);
      if (Math.abs(angleDeg) > 25) turns.push({along: lengthM, angleDeg, point: b});
    }
  }
  return {segments, turns, lengthM};
}
function project(route, point) {
  let best = null;
  for (const segment of route.segments) {
    const {a, b, length, start} = segment, dx = b[0] - a[0], dz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[2] - a[2]) * dz) / (length * length)));
    const x = a[0] + dx * t, z = a[2] + dz * t, lateralM = Math.hypot(point[0] - x, point[2] - z);
    if (!best || lateralM < best.lateralM) best = {along: start + length * t, lateralM, point: [x, a[1] + (b[1] - a[1]) * t, z]};
  }
  return best;
}
function pointAlong(route, along) {
  const segment = route.segments.find(s => s.start + s.length >= along) || route.segments.at(-1);
  const t = Math.max(0, Math.min(1, (along - segment.start) / segment.length));
  return segment.a.map((v, i) => v + (segment.b[i] - v) * t);
}
