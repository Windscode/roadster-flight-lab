/** Preserve original native pixels and reports; compose comparisons off-line. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,basename,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';

const option=(key,fallback)=>process.argv.find(a=>a.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
const root=resolve(new URL('..',import.meta.url).pathname),base=resolve(option('baseline','')),candidate=resolve(option('candidate','')),out=resolve(option('out',join(root,'qa/city-native-3.16')));
if(!option('baseline')||!option('candidate'))throw Error('Provide the two complete original capture directories using --baseline= and --candidate=.');
const appendMatrix=process.argv.includes('--append-matrix');
if(existsSync(out)&&readdirSync(out).length&&!appendMatrix)throw Error('Do not overwrite a published or interrupted evidence directory.');
if(appendMatrix&&!option('matrix'))throw Error('--append-matrix only adds an independently source-verified later matrix; supply --matrix=.');
const parse=file=>JSON.parse(readFileSync(file,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const old=parse(join(base,'report.json')),now=parse(join(candidate,'report.json'));
const separateMatrix=option('matrix')?resolve(option('matrix')):null,matrixCollection=separateMatrix?parse(join(separateMatrix,'report.json')):now;
const oldFrames=old.captures.filter(c=>c.version==='315'&&c.captured),newFrames=now.captures.filter(c=>c.version==='316'&&c.captured);
assert.equal(oldFrames.length,10,'Use the complete restored original ten-frame baseline');
assert.equal(new Set(oldFrames.map(c=>c.view+'|'+c.weather)).size,10);
const oldSession=old.sessions.find(s=>s.version==='315'),session=now.sessions.find(s=>s.version==='316');
assert.ok(oldSession&&!oldSession.failure);assert.ok(session&&!session.failure,'Final source session failed; retain raw failed evidence without publishing it as accepted');
assert.ok(session.sourceAuditBefore&&session.sourceAuditAfter,'Final collection requires both actual served-source audits');
assert.equal(session.sourceAuditBefore.modelBuildId,session.sourceAuditAfter.modelBuildId);
const previousAssembly=appendMatrix?parse(join(out,'report.json')):null;
if(previousAssembly){assert.equal(previousAssembly.finalBuild,session.identity.modelBuildId);assert.equal(previousAssembly.baselineBuild,oldSession.identity.modelBuildId);assert.equal(previousAssembly.summary.matrixDrawsClean,false,'Do not replace an already accepted matrix.');}
mkdirSync(out,{recursive:true});const files=previousAssembly?[...previousAssembly.files]:[];
function preserve(source,destination,expected=null){
  const bytes=readFileSync(source),hash=sha(bytes);if(expected)assert.equal(hash,expected,'Original evidence bytes changed: '+source);
  const target=join(out,destination);mkdirSync(dirname(target),{recursive:true});
  if(existsSync(target))assert.equal(sha(readFileSync(target)),hash,'An existing original may only be reused byte-for-byte: '+target);else copyFileSync(source,target);
  assert.equal(sha(readFileSync(target)),hash);if(!files.some(f=>f.file===destination))files.push({file:destination,bytes:bytes.length,sha256:hash,sourceName:basename(source),pixelsEdited:false});return destination;
}
if(previousAssembly)preserve(join(out,'report.json'),'assembly-before-matrix.json');
preserve(join(base,'report.json'),'baseline-collection-report.json');
preserve(join(base,'capture-scope-addendum.json'),'baseline-collection-scope-addendum.json');
preserve(join(candidate,'report.json'),'candidate-collection-report.json');
if(separateMatrix){const matrixSession=matrixCollection.sessions.find(s=>s.version==='316');assert.ok(matrixSession&&!matrixSession.failure&&matrixSession.sourceAuditBefore&&matrixSession.sourceAuditAfter);assert.equal(matrixSession.sourceAuditBefore.modelBuildId,session.identity.modelBuildId);assert.equal(matrixSession.sourceAuditAfter.modelBuildId,session.identity.modelBuildId);preserve(join(separateMatrix,'report.json'),'matrix-collection-report.json');}
const baselineVerification=option('baseline-verification'),baselineServed=option('baseline-served-audit');
if(baselineVerification)preserve(resolve(baselineVerification),'baseline-candidate-file-verification.json');
if(baselineServed)preserve(resolve(baselineServed),'baseline-served-source-audit.json');
const captures=[];
for(const [directory,prefix,frames]of [[base,'baseline',oldFrames],[candidate,'candidate',newFrames]])for(const frame of frames){
  const png=frame.archive.files.find(f=>f.filename===basename(frame.imageFile)),json=frame.archive.files.find(f=>f.filename===basename(frame.conditionsFile));assert.ok(png&&json);
  const image=preserve(join(directory,frame.imageFile),prefix+'/'+basename(frame.imageFile),png.sha256),conditions=preserve(join(directory,frame.conditionsFile),prefix+'/'+basename(frame.conditionsFile),json.sha256);
  captures.push({...frame,imageFile:image,conditionsFile:conditions,originalCollectionPath:frame.imageFile,rawZipRetainedInFullDelivery:{filename:frame.download.filename,bytes:frame.download.bytes,sha256:frame.download.sha256}});
}
function differences(a,b,path=''){
  if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b)<=1e-9?[]:[{path,before:a,after:b}];
  if(a===b)return[];
  if(a&&b&&typeof a==='object'&&typeof b==='object')return[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differences(a[k],b[k],path?path+'.'+k:k));
  return[{path,before:a??null,after:b??null}];
}
const pairs=oldFrames.map(before=>{
  const a=captures.find(c=>c.version==='315'&&c.view===before.view&&c.weather===before.weather),b=captures.find(c=>c.version==='316'&&c.view===before.view&&c.weather===before.weather),delta=b?differences(a.conditionKey,b.conditionKey):null;
  return{view:before.view,weather:before.weather,beforeImage:a.imageFile,afterImage:b?.imageFile??null,beforeConditions:a.conditionsFile,afterConditions:b?.conditionsFile??null,beforeBuild:a.modelBuildId,afterBuild:b?.modelBuildId??null,matchingDeclaredConditions:delta!==null&&!delta.length,differences:delta,beforeDraw:a.audit,afterDraw:b?.audit??null};
});
const matrices=[];
for(const matrix of matrixCollection.matrices){
  const m={...matrix,viewport:{...matrixCollection.plan.viewport}};m.frames=[];
  const failedPrefix=m.viewport.width===1280&&m.viewport.height===720?'matrix-1280-failed':`matrix-${m.viewport.width}x${m.viewport.height}-failed`;
  const matrixDirectory=separateMatrix||candidate,matrixJson=join(matrixDirectory,'316-gpu-switch-matrix','gpu-switch-matrix.json'),prefix=matrix.collectionComplete?'matrix':failedPrefix;
  if(existsSync(matrixJson))m.originalApplicationReport=preserve(matrixJson,prefix+'/gpu-switch-matrix.json');
  for(const frame of matrix.frames||[]){
    const image=preserve(join(matrixDirectory,frame.imageFile),prefix+'/'+basename(frame.imageFile),frame.pngSha256),conditions=preserve(join(matrixDirectory,frame.conditionsFile),prefix+'/'+basename(frame.conditionsFile));
    m.frames.push({...frame,imageFile:image,conditionsFile:conditions});
  }
  matrices.push(m);
}
const finalImagesComplete=newFrames.length===12&&newFrames.every(c=>Object.values(c.expectedConditions).every(Boolean)),finalDrawsClean=newFrames.every(c=>c.audit.explicitDrawChecksPassed);
const report={schema:'roadster-native-city-evidence-3.16',createdAt:new Date().toISOString(),baselineBuild:oldSession.identity.modelBuildId,finalBuild:session.identity.modelBuildId,
  status:finalImagesComplete&&finalDrawsClean&&pairs.every(p=>p.matchingDeclaredConditions)&&matrices.length===1&&matrices[0].drawChecksPassed?'collected-draw-clean-visual-review-separate':'incomplete-or-failed-retained',
  sourceChain:{baseline:{captureFile:'baseline-collection-report.json',scope:'Ten original 3.15 frames were captured after all 271 candidate site files were byte-verified against the original ZIP. Every same-frame JSON retains the original build and field identities. The later full served audit corroborates the unchanged baseline. The source helper was added after this capture; do not claim before/after fetch fields in that original report.',byteVerification:baselineVerification?'baseline-candidate-file-verification.json':null,laterServedAudit:baselineServed?'baseline-served-source-audit.json':null,excludedOldCandidate:'baseline-collection-scope-addendum.json'},
    candidate:{captureFile:'candidate-collection-report.json',scope:'A fresh native context with actual fetch/hash audits of all declared served sources and all field volumes immediately before and after this capture session.',before:session.sourceAuditBefore,after:session.sourceAuditAfter}},
  summary:{baselineFrames:oldFrames.length,finalFrames:newFrames.length,matchedPairs:pairs.filter(p=>p.matchingDeclaredConditions).length,finalImagesComplete,finalDrawsClean,matrixFrames:matrices.flatMap(m=>m.frames).length,matrixDrawsClean:matrices.length===1&&matrices[0].drawChecksPassed},
  captures,pairs,matrices,previousMatrixAttempts:separateMatrix?now.matrices:[],matrixSourceReport:separateMatrix?'matrix-collection-report.json':'candidate-collection-report.json',files,
  limitations:['All PNGs are unchanged full-resolution application exports. No image synthesis, repainting, exposure editing or cropping is used.','The original 3.15 wet reflection draw errors remain in their reports; a baseline image does not mean its draw path was error-free.','Presentation wall clocks differ. Physical state, camera transform, weather, quality and exposure are compared exactly within 1e-9; moving decorative details are not synchronized.','Two new cockpit frames are final main-scene evidence, not new baseline comparisons.','This collection does not establish native route completion, human handling feel or hardware GPU FPS.','Individual visual review is written separately; successful draw/PNG decoding alone does not pass artistic quality.']};
writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const escape=s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const figure=(file,label)=>file?'<figure><a href="'+escape(file)+'"><img src="'+escape(file)+'" loading="lazy"></a><figcaption>'+escape(label)+'</figcaption></figure>':'<p>Frame absent; see report.</p>';
const html='<!doctype html><meta charset="utf-8"><title>Roadster 3.16 original native city evidence</title><style>body{margin:24px;background:#171b20;color:#e1e6e7;font:16px system-ui;line-height:1.6}a{color:#9ae0e2}section{margin:28px 0}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}figure{margin:0}img{width:100%;height:auto}figcaption{padding:8px}</style><h1>Original 3.15 / final 3.16 native city frames</h1><p>Full source pixels are preserved. CSS changes display size only. Read <a href="report.json">the exact condition/draw/source report</a> and <a href="visual-review.json">the separate individual visual observations</a>. Final build '+escape(report.finalBuild)+'.</p>'+pairs.map(p=>'<section><h2>'+escape(p.view+' · '+p.weather)+'</h2><p>Declared conditions matched: '+p.matchingDeclaredConditions+'.</p><div class="pair">'+figure(p.beforeImage,'Original 3.15')+figure(p.afterImage,'Final 3.16')+'</div></section>').join('')+captures.filter(c=>c.view==='cockpit').map(c=>'<section><h2>Main scene cockpit · '+escape(c.weather)+'</h2>'+figure(c.imageFile,'Final 3.16 main cockpit')+'</section>').join('')+matrices.flatMap(m=>m.frames).map(f=>'<section><h2>'+escape(f.case)+'</h2>'+figure(f.imageFile,'Original matrix PNG; actual exported draw: '+f.exported.status)+'</section>').join('');
writeFileSync(join(out,'index.html'),html);console.log(JSON.stringify({out:relative(root,out),status:report.status,summary:report.summary,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)},null,2));
