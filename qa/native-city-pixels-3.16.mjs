/** Existing UI frame bundles and real draw matrix; no new product entry point. */
import {createRequire} from 'node:module';
import {mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync} from 'node:fs';
import {join, resolve, basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {auditNativeSourceIdentity} from './native-source-identity-3.16.mjs';

const args = process.argv.slice(2), option = (key, fallback) => args.find(a => a.startsWith('--' + key + '='))?.split('=').slice(1).join('=') ?? fallback;
const matrixOnly = args.includes('--matrix-only'), skipMatrix = args.includes('--skip-matrix');
const viewport=matrixOnly?{width:Number(option('matrix-width','1280')),height:Number(option('matrix-height','720'))}:{width:1280,height:720};
if(!Number.isInteger(viewport.width)||!Number.isInteger(viewport.height)||viewport.width<640||viewport.width>1280||Math.abs(viewport.width/viewport.height-16/9)>1e-9)throw Error('Matrix-only viewport must retain 16:9 and be 640–1280 CSS pixels wide; exact dimensions are recorded.');
const views = option('views', 'weave-entry,crosstown,cross-east-gateway,foundry-work-bay,terrace-arrival').split(',');
if (args.includes('--cockpit') && !views.includes('cockpit')) views.push('cockpit');
const weathers = option('weathers', 'clear-day,wet-night').split(',');
const versions = matrixOnly ? ['316'] : option('versions', '315,316').split(',');
const urls = {'315': option('baseline-url', 'http://127.0.0.1:8315/'), '316': option('candidate-url', 'http://127.0.0.1:8316/')};
const localBuild = readFileSync(new URL('../dist/model-build.js', import.meta.url), 'utf8').match(/MODEL_BUILD_ID="([a-f0-9]{64})"/)?.[1];
const expectedBuilds = {'315': option('baseline-build', '0ca13961ae8e9db6061a0e6ca63f9e56ada83ead5848b1724b48a05ee778978b'), '316': option('candidate-build', localBuild)};
if (versions.some(v => !urls[v]) || weathers.some(w => !['clear-day', 'wet-night'].includes(w))) throw Error('Unsupported version or weather');
const startedAt = new Date().toISOString(), out = resolve(option('out', 'qa/native-city-pixels-3.16/' + startedAt.replace(/[:.]/g, '-')));
const plan = {schema: 'roadster.native-city-pixel-plan', version: 1, startedAt,
  execution: args.includes('--run') ? 'requested-native-run' : 'plan-only-no-browser',
  versions, urls, expectedBuilds, views: matrixOnly ? [] : views, weathers, viewport, quality: 'high',
  exposure: {'clear-day': .87, 'wet-night': 1.02}, matrix: !skipMatrix && versions.includes('316'),
  source: 'Existing benchmark-camera, weather/quality/exposure controls and visual-capture-bundle. Matrix uses the existing render-program-matrix button.',
  scope: 'Fixed city frames do not move the car and do not prove a route. Foundry-work-bay is the existing maintenance-court camera south of the exact navigation endpoint; terrace-arrival is the existing cross-level connection camera. Actual endpoint driving is a separate native-key run.',
  preservation: 'Original PNG and same-frame JSON extracted byte-for-byte from the application ZIP; ZIP CRC and every PNG decode are verified. Source pixels are never generated, retouched or resized.',
};
if (!args.includes('--run')) {console.log(JSON.stringify(plan, null, 2)); process.exit(0);}
if (existsSync(out) && readdirSync(out).length) throw Error('Existing evidence must not be overwritten; use a new --out');
mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url), {chromium} = require(process.env.PLAYWRIGHT_MODULE || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright');
const captures = [], matrices = [], errors = [], sessions = [], setupLog = [];
const browser = await chromium.launch({headless: true, executablePath: process.env.ROADSTER_CHROME || '/tmp/roadster-browser-316/chrome-linux64/chrome',
  args: ['--no-sandbox'], env: {...process.env, FONTCONFIG_FILE: process.env.ROADSTER_FONTCONFIG || '/tmp/roadster-fonts-316/fonts.conf'}});
let currentPage = null, progressReading = false, stopRequested = null;
// Close only this script's owned page on an operator stop. This releases a
// pending download wait and lets the normal finally block preserve all completed
// originals and close Chrome; no candidate frame is silently carried forward.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopRequested) return;
  stopRequested = {signal, at: new Date().toISOString()};
  console.log(JSON.stringify({phase: 'stop-requested', ...stopRequested}));
  currentPage?.close().catch(() => {});
});
const heartbeat = setInterval(async () => {
  if (!currentPage || progressReading) return;
  progressReading = true;
  try {
    const progress = await currentPage.evaluate(() => ({ready: window.roadsterReady ?? false,
      matrix: document.querySelector('#render-program-progress-text')?.textContent ?? null,
      status: document.querySelector('#render-program-status')?.textContent ?? null,
      toast: document.querySelector('#toast')?.textContent ?? null}));
    console.log(JSON.stringify({phase: 'browser-progress', at: new Date().toISOString(), ...progress}));
  } catch (error) {console.log(JSON.stringify({phase: 'progress-read-failed', message: error.message}));}
  finally {progressReading = false;}
}, 30000);

async function configure(page, version, view, weather) {
  // Still-image configuration through the existing control handlers. This is
  // deliberately labelled separately from the native keyboard driving script.
  const setup = await page.evaluate(({view, weather}) => {
    const select = (id, value) => {
      const e = document.getElementById(id);
      if (!e || e.disabled || !Array.from(e.options).some(o => o.value === value)) throw Error('Unavailable existing UI option ' + id + '/' + value);
      if (e.value !== value) {e.value = value; e.dispatchEvent(new Event('change', {bubbles: true}));}
    };
    const before = window.roadsterLab.getState();
    select('language-select', 'zh'); select('quality', 'high'); select('weather-preset', weather); select('driving-lamp-mode', 'auto');
    document.getElementById('exposure-baseline-39').click(); select('benchmark-camera', view === 'cockpit' ? 'drive' : view);
    if (view === 'cockpit') {
      for (let count=0; window.roadsterLab.getState().cameraMode !== 'cockpit' && count<4; count++) document.getElementById('camera-btn').click();
    }
    const after = window.roadsterLab.getState();
    return {version: window.roadsterLab.version, before: {simTime: before.simTime, position: before.position, quaternion: before.quaternion},
      after: {simTime: after.simTime, position: after.position, quaternion: after.quaternion, paused: after.paused, cameraMode: after.cameraMode, quality: after.quality},
      view, weather, exposureUi: Number(document.getElementById('exposure-lock-value').value),
      method: 'Existing DOM select/change and button/click handlers batched in one task; no sim, camera or renderer internals are set directly'};
  }, {view, weather});
  if (!setup.after.paused || setup.after.cameraMode !== (view === 'cockpit' ? 'cockpit' : 'fixed') || setup.after.quality !== 'high') throw Error('Existing frame controls did not produce the requested paused high-quality view');
  setupLog.push({version, ...setup}); appendFileSync(join(out, 'setup-events.ndjson'), JSON.stringify({version, ...setup}) + '\n');
  await page.evaluate(() => new Promise((resolveFrames, reject) => {
    const began = performance.now(), timeout = setTimeout(() => reject(Error('Three settled rendered callbacks were not observed in 45 s')), 45000); let frames = 0;
    function frame() {frames++; if (frames >= 3 && performance.now() - began >= 3000) {clearTimeout(timeout); resolveFrames({frames, wallMs: performance.now() - began});} else requestAnimationFrame(frame);}
    requestAnimationFrame(frame);
  }));
  return setup;
}

async function downloadFrom(page, selector, filename, predicate, timeout = 180000) {
  const requestedAt = new Date().toISOString(), began = performance.now();
  const awaiting = page.waitForEvent('download', {predicate, timeout}).catch(error => ({error}));
  await page.evaluate(id => {
    const button = document.querySelector(id); if (!button || button.disabled) throw Error('Unavailable existing capture button ' + id); button.click();
  }, selector);
  const download = await awaiting;
  if (download.error) throw download.error;
  await download.saveAs(filename); const failure = await download.failure();
  const raw = readFileSync(filename);
  if (failure) throw Error('Browser download failed: ' + failure);
  return {requestedAt, browserFilename: download.suggestedFilename(), filename: basename(filename), bytes: raw.length, sha256: sha(raw),
    automationObservedMs: performance.now() - began, browserFailure: failure};
}

function unpackAndInspect(filename, directory) {
  mkdirSync(directory, {recursive: true});
  // Standard ZIP/PIL readers validate bytes; no image pixels are rewritten.
  const script = String.raw`
import sys,json,zipfile,pathlib,hashlib,math
from PIL import Image,ImageStat
source=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2]); result=[]
with zipfile.ZipFile(source) as z:
    bad=z.testzip()
    if bad: raise ValueError('ZIP CRC failure: '+bad)
    for info in z.infolist():
        if pathlib.PurePosixPath(info.filename).name != info.filename or '\\' in info.filename: raise ValueError('Unsafe archive path')
        raw=z.read(info); p=out/info.filename; p.write_bytes(raw)
        item={'filename':info.filename,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'zipCrcVerified':True}
        if p.suffix.lower()=='.png':
            with Image.open(p) as im: im.verify()
            with Image.open(p) as im:
                im.load(); rgb=im.convert('RGB'); lum=rgb.convert('L',(0.2126,0.7152,0.0722,0)); st=ImageStat.Stat(lum)
                pixels=list(rgb.getdata()); stride=max(1,len(pixels)//50000); sampled=pixels[::stride]
                item['pixels']={'width':im.width,'height':im.height,'mode':im.mode,'sampledUniqueRgb':len(set(sampled)),
                    'encodedLumaMean':st.mean[0],'encodedLumaStdDev':st.stddev[0],'encodedLumaExtrema':lum.getextrema(),
                    'sampledNearBlackFraction':sum(max(p)<4 for p in sampled)/len(sampled),
                    'alphaExtrema':im.getchannel('A').getextrema() if 'A' in im.getbands() else None,
                    'meaning':'Decoded original PNG distribution only, not an art/coverage or physical luminance verdict'}
        result.append(item)
print(json.dumps({'files':result,'zipCrcVerified':True}))`;
  return JSON.parse(execFileSync(process.env.CITY_PYTHON || 'python', ['-c', script, filename, directory], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024}));
}
function auditSummary(audit) {
  if (!audit) return {status: 'missing', checked: false};
  const draws = (audit.programs || []).flatMap(p => (p.draws || []).map(d => ({...d, programId: p.programId}))).concat(audit.unattributedDraws || []);
  const badDraws = draws.filter(d => (d.preDrawErrors?.length || 0) + (d.drawErrors?.length || 0) + (d.diagnosticErrors?.length || 0));
  const invalidPrograms = (audit.programs || []).filter(p => !p.linked || !p.validated || !p.boundProgramMatches ||
    p.activeSamplerElements > Math.min(audit.limits?.fragmentTextureImageUnits ?? 0, audit.limits?.targetFragmentSamplers ?? 16));
  const badFramebuffers = (audit.framebuffers || []).filter(f => !f.available || !f.complete || !f.target?.validDimensions);
  const required = audit.requiredCategories || [], categories = [...new Set((audit.programs || []).filter(p => p.successfulMainColorDrawCalls > 0).flatMap(p => p.successfulMainColorCategories || []))];
  return {checked: true, status: audit.status, drawCalls: audit.drawCalls, drawEvents: audit.drawEvents, retainedDrawEvents: draws.length,
    allDrawEventsRetained: draws.length === audit.drawEvents && !audit.omittedDrawEvents, badDrawEvents: badDraws.map(d => ({index: d.index, pass: d.pass, programId: d.programId, material: d.material, preDrawErrors: d.preDrawErrors, drawErrors: d.drawErrors, diagnosticErrors: d.diagnosticErrors})),
    invalidPrograms: invalidPrograms.map(p => p.programId), invalidFramebuffers: badFramebuffers.map(f => f.id),
    requiredCategories: required, successfulMainColorCategories: categories, missingMainColorCategories: required.filter(c => !categories.includes(c)),
    unattributedDrawCalls: audit.unattributedDrawCalls, unattributedErrorDraws: audit.unattributedErrorDraws,
    priorGlErrors: audit.priorGlErrors, remainingGlErrors: audit.remainingGlErrors, shaderErrors: audit.shaderErrors?.length,
    applicationFailures: audit.failures,
    explicitDrawChecksPassed: audit.status === 'passed' && !audit.failures?.length && audit.drawCalls > 0 &&
      !badDraws.length && !invalidPrograms.length && !badFramebuffers.length && draws.length === audit.drawEvents && !audit.omittedDrawEvents &&
      !audit.unattributedDrawCalls && !audit.unattributedErrorDraws && required.every(c => categories.includes(c)),
  };
}
function conditionKey(c) {
  return {camera: Object.fromEntries(['id', 'mode', 'position', 'quaternion', 'up', 'target', 'fov', 'near', 'far', 'aspect', 'viewOffset'].map(k => [k, c.camera?.[k]])),
    exposure: c.exposure, exposureLock: c.exposureLock, autoExposure: c.autoExposure, quality: c.quality, weatherPreset: c.weatherPreset,
    resolution: Object.fromEntries(['width', 'height', 'cssWidth', 'cssHeight', 'devicePixelRatio'].map(k => [k, c.resolution?.[k]])),
    paused: c.paused, context: c.context, lampSelection: c.lampSelection, vehicleLampMode: c.vehicleLampMode,
    physical: {position: c.simState?.body?.position, quaternion: c.simState?.body?.quaternion, velocity: c.simState?.body?.velocity,
      angularVelocity: c.simState?.body?.angularVelocity, simTime: c.simState?.state?.simTime, wing: c.simState?.state?._wing}};
}
function difference(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 ? [] : [{path, before: a, after: b}];
  if (a === b) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => difference(a[k], b[k], path ? path + '.' + k : k));
  return [{path, before: a ?? null, after: b ?? null}];
}

try {
  for (const version of versions) {
    if (stopRequested) break;
    const context = await browser.newContext({viewport: plan.viewport, deviceScaleFactor: 1, acceptDownloads: true}), page = await context.newPage();
    currentPage = page; page.setDefaultTimeout(45000);
    page.on('pageerror', e => {const error = {version, type: 'pageerror', message: e.stack || e.message}; errors.push(error); appendFileSync(join(out, 'browser-errors.ndjson'), JSON.stringify(error) + '\n');});
    page.on('console', m => {if (m.type() === 'error') {const error = {version, type: 'console', message: m.text(), location: m.location()}; errors.push(error); appendFileSync(join(out, 'browser-errors.ndjson'), JSON.stringify(error) + '\n');}});
    page.on('response', response => {if (response.status() >= 400) {const error = {version, type: 'http-response', status: response.status(), url: response.url()}; errors.push(error); appendFileSync(join(out, 'browser-errors.ndjson'), JSON.stringify(error) + '\n');}});
    const session = {version, url: urls[version], startedAt: new Date().toISOString(), failure: null}; sessions.push(session);
    try {
      console.log('open city pixel baseline/candidate ' + version);
      session.sourceAuditBefore = await auditNativeSourceIdentity(urls[version], {expectedBuildId: expectedBuilds[version]});
      await page.goto(urls[version], {waitUntil: 'domcontentloaded', timeout: 60000});
      await page.waitForFunction(() => window.roadsterReady === true && !!window.roadsterLab?.getState(), null, {timeout: 45000});
      session.identity = await page.evaluate(() => window.roadsterLab.getInputTimeline().identity);
      if (session.identity.modelBuildId !== expectedBuilds[version]) throw Error('Loaded build differs from the requested frozen source: ' + JSON.stringify({expected: expectedBuilds[version], actual: session.identity}));
      session.device = await page.evaluate(() => {const gl = document.querySelector('#viewport canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info'); return {version: window.roadsterLab.version, userAgent: navigator.userAgent, vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER), unmaskedRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio}};});
      if (!matrixOnly) for (const view of views) for (const weather of weathers) {
        const entry = {version, view, weather, captured: false}, stem = version + '-' + view + '-' + weather, folder = join(out, stem); captures.push(entry);
        try {
          console.log('capture ' + stem); entry.setup = await configure(page, version, view, weather);
          entry.download = await downloadFrom(page, '#visual-capture-bundle', join(out, stem + '.zip'), d => d.suggestedFilename().includes('-' + view + '-' + weather) && d.suggestedFilename().endsWith('.zip'));
          entry.archive = unpackAndInspect(join(out, stem + '.zip'), folder);
          const json = entry.archive.files.find(f => f.filename.endsWith('.json'));
          if (!json) throw Error('Same-frame conditions JSON missing from app archive');
          const conditions = JSON.parse(readFileSync(join(folder, json.filename), 'utf8'));
          if (conditions.modelBuildId !== expectedBuilds[version]) throw Error('Capture identity changed during the session');
          const png = entry.archive.files.find(f => f.filename === conditions.capture?.imageFile);
          if (!png?.pixels || conditions.capture?.conditionsFile !== json.filename) throw Error('Image/conditions binding or PNG decode missing');
          if (png.pixels.width !== conditions.resolution.width || png.pixels.height !== conditions.resolution.height) throw Error('PNG dimensions differ from its bound actual draw conditions');
          entry.boundCapture = conditions.capture; entry.conditionKey = conditionKey(conditions); entry.modelVersion = conditions.modelVersion; entry.modelBuildId = conditions.modelBuildId;
          entry.imageFile = stem + '/' + png.filename; entry.conditionsFile = stem + '/' + json.filename; entry.pixels = png.pixels;
          entry.audit = auditSummary(conditions.lastProgramAudit); entry.captured = true;
          entry.expectedConditions = {cameraId: view === 'cockpit' ? conditions.camera.mode === 'cockpit' && conditions.camera.id === null : conditions.camera.id === view, exposure: Math.abs(conditions.exposure - plan.exposure[weather]) <= 1e-9,
            quality: conditions.quality === 'high', resolution: png.pixels.width === 1280 && png.pixels.height === 720, paused: conditions.paused === true,
            actualUneditedFrame: conditions.capture.source === 'actual-webgl-composer-frame' && conditions.capture.pixelsEdited === false};
        } catch (error) {
          entry.failure = {message: error.message, at: new Date().toISOString()};
          try {await page.screenshot({path: join(out, stem + '-failed-ui.png'), timeout: 30000});} catch (captureError) {entry.failedUiCaptureError = captureError.message;}
          console.log(JSON.stringify({capture: stem, failure: entry.failure}));
          const available = await page.evaluate(() => window.roadsterLab?.getState().graphics.status === 'available').catch(() => false);
          if (!available) throw Error('Graphics unavailable after capture failure; remaining cases in this session are unexecuted');
        }
        writeFileSync(join(out, 'capture-progress.json'), JSON.stringify({captures, sessions}, null, 2) + '\n');
      }
      if (version === '316' && !skipMatrix) {
        const matrix = {version, expectedFrames: 14, startedAt: new Date().toISOString(), failure: null}; matrices.push(matrix);
        try {
          // Use each existing weather preset's exposure during the matrix.
          // This control affects presentation only; the built-in diagnostic
          // independently records whether all original physical state survives.
          await page.evaluate(() => {const e = document.getElementById('exposure-lock'); if (e.checked) e.click();});
          matrix.before = await page.evaluate(() => window.roadsterLab.getState());
          console.log('begin existing 14-frame native draw matrix');
          matrix.download = await downloadFrom(page, '#render-program-matrix', join(out, '316-gpu-switch-matrix.zip'), d => d.suggestedFilename().includes('gpu-switch-matrix') && d.suggestedFilename().endsWith('.zip'), 900000);
          const folder = join(out, '316-gpu-switch-matrix'); matrix.archive = unpackAndInspect(join(out, '316-gpu-switch-matrix.zip'), folder);
          const data = JSON.parse(readFileSync(join(folder, 'gpu-switch-matrix.json'), 'utf8'));
          matrix.application = {status: data.status, executionStatus: data.executionStatus, drawStatus: data.drawStatus, expectedFrames: data.expectedFrames,
            completedFrames: data.completedFrames, physicsUnchanged: data.physicsUnchanged, shaderFailures: data.shaderFailures, failure: data.failure, restoreFailure: data.restoreFailure,
            modelVersion: data.modelVersion, modelBuildId: data.modelBuildId};
          matrix.frames = data.cases.map(item => {
            const png = matrix.archive.files.find(f => f.filename === item.imageFile), c = JSON.parse(readFileSync(join(folder, item.conditionsFile), 'utf8'));
            return {case: item.case, imageFile: '316-gpu-switch-matrix/' + item.imageFile, conditionsFile: '316-gpu-switch-matrix/' + item.conditionsFile,
              pixels: png?.pixels ?? null, pngSha256: png?.sha256 ?? null,
              sameFrameBound: c.capture?.imageFile === item.imageFile && c.capture?.conditionsFile === item.conditionsFile && c.capture?.pixelsEdited === false,
              pngMatchesDrawingBuffer: png?.pixels?.width === c.resolution.width && png?.pixels?.height === c.resolution.height,
              ordinary: auditSummary(item.paused), exported: auditSummary(item.export)};
          });
          matrix.collectionComplete = data.executionStatus === 'completed' && data.expectedFrames === 14 && data.completedFrames === 14 && matrix.frames.length === 14;
          matrix.drawChecksPassed = matrix.collectionComplete && data.physicsUnchanged === true && !data.shaderFailures?.total && matrix.frames.every(f => f.sameFrameBound && f.pngMatchesDrawingBuffer && f.ordinary.explicitDrawChecksPassed && f.exported.explicitDrawChecksPassed);
          matrix.visualReview = 'Pending human/assistant inspection of each original PNG; decoded nonconstant image statistics do not mark art quality passed.';
        } catch (error) {
          matrix.failure = {message: error.message, at: new Date().toISOString()};
          // Cancel through the existing visible control; retain any app prefix
          // download if one is produced. A timed-out collection is never passed.
          try {
            const partial = page.waitForEvent('download', {predicate: d => d.suggestedFilename().includes('gpu-switch-matrix'), timeout: 45000}).catch(e => ({error: e}));
            await page.evaluate(() => {const b = document.getElementById('render-program-cancel'); if (b && !b.disabled) b.click();});
            const downloaded = await partial;
            if (!downloaded.error) {const filename = join(out, '316-gpu-switch-matrix-interrupted-' + basename(downloaded.suggestedFilename())); await downloaded.saveAs(filename); matrix.partialArchive = {filename: basename(filename), bytes: readFileSync(filename).length, sha256: sha(readFileSync(filename))};}
          } catch (cancelError) {matrix.cancelFailure = cancelError.message;}
        }
      }
    } catch (error) {session.failure = {message: error.message, at: new Date().toISOString()};}
    finally {
      try {session.sourceAuditAfter = await auditNativeSourceIdentity(urls[version], {expectedBuildId: expectedBuilds[version]});}
      catch (error) {session.failure = {...session.failure, sourceIdentityAfter: error.message, at: new Date().toISOString()};}
      session.finishedAt = new Date().toISOString(); currentPage = null; await context.close();
    }
  }
} finally {
  clearInterval(heartbeat); currentPage = null; await browser.close();
  const pairs = views.flatMap(view => weathers.map(weather => {
    const a = captures.find(c => c.version === '315' && c.view === view && c.weather === weather), b = captures.find(c => c.version === '316' && c.view === view && c.weather === weather);
    const differences = a?.captured && b?.captured ? difference(a.conditionKey, b.conditionKey) : null;
    return {view, weather, before: a?.imageFile ?? null, after: b?.imageFile ?? null,
      boundFramesAvailable: !!a?.captured && !!b?.captured, matchingDeclaredConditions: differences !== null && differences.length === 0, differences,
      beforeBuild: a?.modelBuildId ?? null, afterBuild: b?.modelBuildId ?? null,
      limits: 'Model/source/lighting geometry and material differences are intentional; the complete snapshots remain in each ZIP. Render wall time differs, and moving presentation details are not frozen by a shared animation clock.'};
  }));
  const report = {schema: 'roadster.native-city-pixels-result', version: 1, startedAt, finishedAt: new Date().toISOString(), stopRequested, plan, sessions, captures, pairs, matrices, errors,
    reviewStatus: 'Original images still require individual visual inspection and written observations. Completed draws alone do not establish appearance, route coverage or hardware performance.'};
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const escape = text => String(text).replace(/[&<>\"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const figure = (file, label) => file ? '<figure><a href="' + escape(file) + '"><img src="' + escape(file) + '" loading="lazy"></a><figcaption>' + escape(label) + '</figcaption></figure>' : '<p>Missing original frame</p>';
  writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Native city 3.15 / 3.16</title><style>body{background:#14191d;color:#d6dfdc;font:16px system-ui;margin:24px}section{margin:24px 0}div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;height:auto}figcaption{padding:8px}a{color:inherit}</style><h1>Original native city frames</h1><p>PNG source files are unchanged. The gallery only scales their display. Read report.json for conditions, draw errors, partial outcomes and bounds.</p>' + pairs.map(p => '<section><h2>' + escape(p.view + ' / ' + p.weather) + '</h2><p>Declared conditions matched: ' + p.matchingDeclaredConditions + '</p><div>' + figure(p.before, '3.15 original') + figure(p.after, '3.16 original') + '</div></section>').join('') + matrices.flatMap(m => m.frames || []).map(f => '<section><h2>' + escape(f.case) + '</h2>' + figure(f.imageFile, 'Actual matrix PNG; exported draw pass: ' + f.exported.explicitDrawChecksPassed) + '</section>').join(''));
  console.log(JSON.stringify({out, sessions: sessions.map(s => ({version: s.version, failure: s.failure})), images: captures.filter(c => c.captured).length,
    matchingPairs: pairs.filter(p => p.matchingDeclaredConditions).length, matrices: matrices.map(m => ({collectionComplete: m.collectionComplete, drawChecksPassed: m.drawChecksPassed, failure: m.failure}))}));
  if (stopRequested || sessions.some(s => s.failure) || captures.some(c => !c.captured) || (!matrixOnly && versions.length === 2 && pairs.some(p => !p.matchingDeclaredConditions)) || matrices.some(m => !m.drawChecksPassed)) process.exitCode = 1;
}
