// Current, bounded release regression. Historical validate.mjs remains archived
// for its larger fixtures; this command states exactly what ran for this build.
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID,MODEL_SOURCE_HASHES} from '../dist/model-build.js';
const version=MODEL_VERSION.split('.').slice(0,2).join('.'),dir=`qa/release-${version}`;
mkdirSync(dir,{recursive:true});mkdirSync('.runtime/release-tests',{recursive:true});
const jobs=[
 ['tests/maneuver-envelope-3.24.test.mjs'],['tests/vehicle-shadow-state-3.23.test.mjs'],
 ['tests/vehicle-rear-shell-3.24.test.mjs'],['tests/showcase-lighting-3.24.test.mjs'],
 ['tests/city-street-detail-3.18.test.mjs'],['tests/sampler-budget-3.13.test.mjs'],['tests/city-glazing-budget-3.16.test.mjs'],
 ['tests/energy-boundaries-3.22.test.mjs'],['tests/semantic-input-3.22.test.mjs'],['tests/experiment-energy-3.22.test.mjs'],
 ['tests/practical-light-lifecycle-3.22.test.mjs'],['tests/vehicle-state-3.22.test.mjs'],
 ['tests/city-lighting-3.10.test.mjs'],['tests/city-quality-3.16.test.mjs'],['tests/shadow-motion-3.18.test.mjs'],
 ['tests/vehicle-geometry.test.mjs'],['tests/vehicle-display-3.14.test.mjs'],
 ['tests/energy-3.21.test.mjs'],['tests/semantic-input-3.21.test.mjs'],['tests/handling-controls.test.mjs'],
 ['tests/input-session-3.15.test.mjs'],['tests/control-continuity-3.18.test.mjs'],['tests/control-transition-guards-3.18.test.mjs'],
 ['tests/pilot-input-recovery-3.15.test.mjs'],['scripts/check-control-feedback.mjs'],['tests/experiment-records.test.mjs'],['tests/resource-comparison-3.21.test.mjs'],['tests/resource-failure-3.21.test.mjs'],
 ['tests/resource-route-3.21.test.mjs','economy','dry-day'],['tests/resource-route-3.21.test.mjs','balanced','dry-day'],
 ['tests/resource-route-3.21.test.mjs','boost','after-rain'],
 ['tests/development-publication-3.21.test.mjs'],['tests/local-launch-3.21.test.mjs']
];
const domAvailable=!!process.env.JSDOM_MODULE_PATH;
if(domAvailable)jobs.push(['tests/experiment-restore-3.24.test.mjs'],['tests/resource-history-3.23.test.mjs'],['tests/operation-feedback-3.23.test.mjs'],['tests/browser-input-3.22.test.mjs'],['tests/resource-route-ui-3.21.test.mjs'],['qa/same-page-ui-check.mjs'],['qa/same-page-ui-check.mjs','--graphics-unavailable']);
const report={schema:'roadster-release-validation-1',modelVersion:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,createdAt:new Date().toISOString(),status:'running',scope:'Focused current-source numerical, input, replay, local launch and publication tests. DOM is explicitly recorded. No native input, audio, WebGL pixels or hardware performance acceptance.',sourceHashes:MODEL_SOURCE_HASHES,domAvailable,jobs:[]};
for(const [i,args] of jobs.entries()){
 const path=`.runtime/release-tests/${String(i).padStart(2,'0')}.log`,fd=openSync(path,'w');const start=Date.now();
 let result;try{result=spawnSync(process.execPath,[...(args[0].startsWith('qa/')?['--experimental-vm-modules']:[]),...args],{stdio:['ignore',fd,fd],env:{...process.env,REPLAY:'1'},timeout:180000});}finally{closeSync(fd);}
 const bytes=readFileSync(path),ok=result.status===0&&!result.error;
 report.jobs.push({command:['node',...args].join(' '),status:ok?'passed':'failed',durationMs:Date.now()-start,outputSha256:createHash('sha256').update(bytes).digest('hex'),sourceSha256:createHash('sha256').update(readFileSync(args[0])).digest('hex'),error:result.error?.message??null});
 console.log(`${ok?'PASS':'FAIL'} ${args.join(' ')}`);if(!ok)console.error(bytes.toString().slice(-8000));
 writeFileSync(`${dir}/validation.json`,JSON.stringify(report,null,2)+'\n');
}
report.status=report.jobs.every(x=>x.status==='passed')?'passed':'failed';
writeFileSync(`${dir}/validation.json`,JSON.stringify(report,null,2)+'\n');
console.log(`${report.status}: ${report.jobs.filter(x=>x.status==='passed').length}/${report.jobs.length}; DOM ${domAvailable?'included':'not run'}`);
writeFileSync('dist/release-validation.json',JSON.stringify(report,null,2)+'\n');
if(report.status!=='passed')process.exitCode=1;
