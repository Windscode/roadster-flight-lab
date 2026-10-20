// Scratch-only read-only audit. Does not import prepare-pages or restore payloads.
import {readFileSync,writeFileSync,existsSync,lstatSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,extname,posix} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root='/workspace/scratch/867d449c399e/roadster-capture-316';
const output='/workspace/scratch/867d449c399e/evidence-delivery-plan-316/candidate-links-316';
const require=createRequire(import.meta.url);
const {lexer,parser}=await import(pathToFileURL(require.resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/marked')));
const {JSDOM}=require('/tmp/roadster-dom-314/node_modules/jsdom/lib/api.js');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=p=>readFileSync(resolve(root,p));
const listPath='scripts/pages-evidence-files-3.16.json';
const packedPath='repository-payloads/manifest.json';
const controls=[listPath,packedPath,'scripts/pages-evidence.mjs','scripts/prepare-pages.mjs','dist/model-build.js'];
const before=Object.fromEntries(controls.map(p=>[p,hash(read(p))]));
const ordinary=JSON.parse(read(listPath)).files;
const packed=JSON.parse(read(packedPath)).files;
// The managed runtime rejects Node-created subprocess pipe handles. This
// snapshot came from the successful read-only shell command `git ls-files -z`.
const trackedSnapshotPath='/workspace/scratch/867d449c399e/evidence-delivery-plan-316/git-tracked-paths-for-candidate-link-audit.snapshot';
const trackedSnapshotBytes=readFileSync(trackedSnapshotPath);
const tracked=new Set(trackedSnapshotBytes.toString('utf8').split('\0').filter(Boolean));
const runtime=[...new Set([...tracked].filter(p=>p.startsWith('dist/')).concat(packed.filter(x=>x.path.startsWith('dist/')).map(x=>x.path)))];
const files=new Map(), sourceToDest=new Map();
function add(source,dest,group){
  if(files.has(dest)){if(files.get(dest).source!==source)throw Error('copy destination collision: '+dest);return;}
  const sourcePath=resolve(root,source),stat=existsSync(sourcePath)?lstatSync(sourcePath):null;
  files.set(dest,{source,dest,group,exists:!!stat,regular:stat?.isFile()&&!stat?.isSymbolicLink(),bytes:stat?.size??null,gitTracked:tracked.has(source)});
  sourceToDest.set(source,dest);
}
for(const p of runtime)add(p,p.slice(5),'runtime');
for(const p of ordinary)add(p,p,'ordinary');
for(const e of packed.filter(x=>x.path.startsWith('qa/')))add(e.path,e.path,'packed-qa');
for(const p of ['LICENSE','THIRD-PARTY-NOTICES.md'])add(p,p,'root-license');
for(const p of ['deployment.json','evidence-manifest.json'])files.set(p,{source:null,dest:p,group:'generated-at-final-prepare',exists:false,regular:false,gitTracked:false});
const base=new URL('https://candidate.invalid/roadster-flight-lab/');
const repoBase=new URL('https://repo.invalid/');
const links=[],documents=[],skipped={fragment:0,external:0,embeddedOrAction:0};
const attrs={a:['href'],area:['href'],img:['src'],link:['href'],script:['src'],iframe:['src'],video:['src','poster'],audio:['src'],source:['src'],track:['src'],form:['action'],input:['src'],object:['data'],embed:['src']};
function priority(p){
  if(/^README(?:\.en)?\.md$/.test(p))return 'current-readme';
  if(p.startsWith('dist/'))return p.endsWith('.html')?'runtime-html':'runtime-historical-markdown';
  if(p.startsWith('qa/')&&p.endsWith('/index.html'))return 'current-gallery';
  if(p.startsWith('docs/')&&(p.includes('3.16')||p==='docs/DEVELOPMENT.md'))return 'current-documentation';
  if(p.startsWith('qa/')&&p.includes('3.16'))return 'current-qa-readme';
  return 'historical-documentation';
}
function category(p){if(p?.startsWith('dist/'))return 'runtime';for(const c of ['docs','qa','tests','scripts'])if(p?.startsWith(c+'/'))return c;return 'other';}
function isRepoFile(p){if(!p||p==='..'||p.startsWith('../')||p.startsWith('/'))return false;const a=resolve(root,p);return existsSync(a)&&lstatSync(a).isFile()&&!lstatSync(a).isSymbolicLink();}
function decode(p){try{return decodeURIComponent(p);}catch{return p;}}
function link(doc,raw,kind,label='',effectiveBase=null){
  raw=raw?.trim();if(!raw)return;
  if(raw.startsWith('#')){skipped.fragment++;return;}
  if(/^(?:data|javascript|mailto|tel|blob):/i.test(raw)){skipped.embeddedOrAction++;return;}
  if(/^(?:https?:)?\/\//i.test(raw)){skipped.external++;return;}
  if(/^[a-z][a-z\d+.-]*:/i.test(raw)){
    links.push({source:doc.source,sourceDestination:doc.dest,priority:priority(doc.source),kind,label,rawTarget:raw,status:'non-web-scheme',category:'other'});return;
  }
  let url;try{url=new URL(raw,effectiveBase||new URL(doc.dest,base));}catch{links.push({source:doc.source,priority:priority(doc.source),kind,label,rawTarget:raw,status:'invalid-url',category:'other'});return;}
  if(url.origin!==base.origin){skipped.external++;return;}
  const within=url.pathname.startsWith(base.pathname);
  const destination=decode(within?url.pathname.slice(base.pathname.length):url.pathname.slice(1));
  let repoResolved=null;try{repoResolved=decode(new URL(raw,new URL(doc.source,repoBase)).pathname.slice(1));}catch{}
  const candidates=[...new Set([repoResolved,destination,'dist/'+destination].filter(Boolean))];
  const existingRepoTargets=candidates.filter(isRepoFile);
  const copiedFromExisting=existingRepoTargets.map(p=>({path:p,copiedAs:sourceToDest.get(p)||null,bytes:lstatSync(resolve(root,p)).size,sha256:hash(read(p)),gitTracked:tracked.has(p)}));
  const exact=within?files.get(destination):null;
  const directoryIndex=within?files.get(posix.join(destination,'index.html')):null;
  let status;
  if(!within)status='outside-project-site-base';
  else if(exact)status=exact.group==='generated-at-final-prepare'?'generated-at-final-prepare':exact.exists&&exact.regular?'covered':'planned-source-missing-or-nonregular';
  else if((destination===''||destination.endsWith('/'))&&directoryIndex)status='covered-directory-index';
  else if(existingRepoTargets.length)status=copiedFromExisting.some(x=>x.copiedAs)?'existing-source-copied-at-different-url':'existing-repo-file-not-copied';
  else if(/:\d+(?:-\d+)?$/.test(destination))status='source-location-shaped-link';
  else if(existsSync(resolve(root,destination))&&lstatSync(resolve(root,destination)).isDirectory())status='directory-without-planned-index';
  else status='target-not-found-in-repository';
  links.push({source:doc.source,sourceDestination:doc.dest,priority:priority(doc.source),kind,label,rawTarget:raw,candidatePath:destination,candidatePathWithinProject:within,candidateURL:url.href,repositoryRelativeResolution:repoResolved,existingRepoTargets:copiedFromExisting,status,category:category(existingRepoTargets[0]||repoResolved||destination)});
}
function html(doc,fragment,kindPrefix='html',useBase=false){
  const dom=new JSDOM(fragment);const d=dom.window.document;
  const baseHref=useBase?d.querySelector('base[href]')?.getAttribute('href'):null;
  const effectiveBase=baseHref?new URL(baseHref,new URL(doc.dest,base)):null;
  if(baseHref)doc.htmlBaseHref=baseHref;
  for(const [tag,attributes]of Object.entries(attrs))for(const element of d.querySelectorAll(tag)){
    if(element.closest('code,pre'))continue;
    for(const a of attributes)if(element.hasAttribute(a))link(doc,element.getAttribute(a),kindPrefix+'-'+tag+'-'+a,(element.textContent||element.getAttribute('alt')||'').trim().slice(0,180),effectiveBase);
  }
  dom.window.close();
}
for(const f of files.values()){
  if(!f.source||!f.regular||!['.md','.html'].includes(extname(f.source).toLowerCase()))continue;
  const bytes=read(f.source);const doc={...f,sha256:hash(bytes),priority:priority(f.source)};documents.push(doc);
  if(extname(f.source).toLowerCase()==='.html')html(doc,bytes.toString('utf8'),'html',true);
  else{
    // Parse the lexed document as one inert tree so inline <code> ancestry and
    // raw HTML comments/scripts remain intact. Escaped code is not a link.
    const tokens=lexer(bytes.toString('utf8'));
    html(doc,parser(tokens),'markdown-rendered',true);
  }
}
const after=Object.fromEntries(controls.map(p=>[p,hash(read(p))]));
const documentsChanged=documents.filter(d=>hash(read(d.source))!==d.sha256).map(d=>d.source);
const controlsChanged=controls.filter(p=>before[p]!==after[p]);
const missing=links.filter(x=>!['covered','covered-directory-index','generated-at-final-prepare'].includes(x.status));
const repoExistingGaps=missing.filter(x=>x.existingRepoTargets?.length);
const uniqueTargets=[...new Set(repoExistingGaps.flatMap(l=>l.existingRepoTargets.map(t=>t.path)))].sort();
const groupedTargets=uniqueTargets.map(p=>{const refs=repoExistingGaps.filter(l=>l.existingRepoTargets.some(t=>t.path===p));return{path:p,category:category(p),bytes:lstatSync(resolve(root,p)).size,sha256:hash(read(p)),copiedAs:sourceToDest.get(p)||null,gitTracked:tracked.has(p),priorities:[...new Set(refs.map(r=>r.priority))],references:refs.map(({source,rawTarget,kind,label,candidatePath,status})=>({source,rawTarget,kind,label,candidatePath,status}))};});
const countBy=(items,key)=>Object.fromEntries([...new Set(items.map(x=>x[key]))].sort().map(k=>[k,items.filter(x=>x[key]===k).length]));
const result={schema:'roadster.candidate-local-link-review',version:1,createdAt:new Date().toISOString(),scope:'Read-only predicted copy-set audit, not an HTTP check or final prepare. Only actual Markdown links/images and passive HTML href/src/action/data attributes in documents already planned for copying; code tokens/comments/plain path strings are not links. No JavaScript execution, dynamic URL discovery, stylesheet URL expansion, recursive traversal of unselected historical documents, publishing or source mutations.',root,trackedSnapshot:{path:trackedSnapshotPath,sha256:hash(trackedSnapshotBytes),method:'git ls-files -z via read-only shell stdout redirection; initial Node subprocess pipe EPERM did not run Git.'},copySet:{ordinary:ordinary.length,immutablePayloadEntries:packed.length,packedRuntime:packed.filter(e=>e.path.startsWith('dist/')).length,packedQa:packed.filter(e=>e.path.startsWith('qa/')).length,runtime:runtime.length,rootLicense:2,generatedAtFinalPrepare:2,plannedDestinations:files.size,files:[...files.values()]},sourceControls:{before,after,changed:controlsChanged},parsedDocuments:documents,parsedDocumentsChangedDuringAudit:documentsChanged,summary:{parsedDocuments:documents.length,documentKinds:countBy(documents,'priority'),localLinks:links.length,localStatus:countBy(links,'status'),skipped,repoExistingGapOccurrences:repoExistingGaps.length,repoExistingGapUniqueTargets:groupedTargets.length,repoExistingGapUniqueBytes:groupedTargets.reduce((s,x)=>s+x.bytes,0),gapTargetsByCategory:countBy(groupedTargets,'category')},gapTargets:groupedTargets,otherUnresolvedLinks:missing.filter(x=>!x.existingRepoTargets?.length),allLocalLinks:links};
mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'candidate-local-link-review.json'),JSON.stringify(result,null,2)+'\n');
const cell=s=>String(s??'').replace(/\|/g,'\\|').replace(/\n/g,' ');
const md=['# 3.16 candidate copied-document local link review','','This is a read-only analysis of the planned copy set. It is not a prepared-site or HTTP result. No repository file, copy list, immutable payload or runtime was changed.','',`Snapshot: ${result.createdAt}. Ordinary list: ${ordinary.length}; immutable payloads: ${packed.length} (${result.copySet.packedRuntime} runtime + ${result.copySet.packedQa} QA); runtime destinations: ${runtime.length}.`,`Parsed ${documents.length} already-selected Markdown/HTML documents. Found ${links.length} local links; ${repoExistingGaps.length} repo-existing unresolved occurrences, ${groupedTargets.length} distinct target files (${result.summary.repoExistingGapUniqueBytes} bytes).`,'',`List/manifest/prepare/identity controls unchanged during audit: ${controlsChanged.length===0}. Parsed document bytes unchanged during audit: ${documentsChanged.length===0}.`,'','## Existing repository files absent at the linked candidate URL','','| Target | Category | Bytes | Already copied at another URL | Linked from |','| --- | --- | ---: | --- | --- |'];
for(const t of groupedTargets)md.push(`| ${cell(t.path)} | ${t.category} | ${t.bytes} | ${cell(t.copiedAs||'No')} | ${cell([...new Set(t.references.map(r=>r.source))].join('; '))} |`);
md.push('','## Exact occurrences','','| Source | Actual URL | Kind | Predicted problem |','| --- | --- | --- | --- |');
for(const l of repoExistingGaps)md.push(`| ${cell(l.source)} | ${cell(l.rawTarget)} | ${l.kind} | ${cell(l.status)} |`);
md.push('','## Other unresolved local links','','| Source | Actual URL | Classification |','| --- | --- | --- |');
for(const l of result.otherUnresolvedLinks)md.push(`| ${cell(l.source)} | ${cell(l.rawTarget)} | ${cell(l.status)} |`);
md.push('','## Boundary','','Code fences, inline code, comment text and unlinked path strings were ignored. External public URLs were not fetched. JavaScript-computed links and CSS URLs are outside this read-only Markdown/HTML pass. Historical document links and explicit test/script source links are reviewable optional content, not automatically promoted to runtime release gates. Generated deployment/evidence manifests are classified as final-prepare outputs. A runtime source under `dist/` is copied to the site root, so a link retaining `dist/` may need a URL correction rather than duplicate runtime copying.','');
writeFileSync(resolve(output,'candidate-local-link-review.md'),md.join('\n'));
console.log(JSON.stringify({output,summary:result.summary,controlsChanged,documentsChanged,targets:groupedTargets.map(({path,category,bytes,copiedAs,priorities})=>({path,category,bytes,copiedAs,priorities})),otherUnresolved:result.otherUnresolvedLinks.map(({source,rawTarget,status})=>({source,rawTarget,status}))},null,2));
