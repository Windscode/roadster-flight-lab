import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {MODEL_SOURCE_HASHES} from '../dist/model-build.js';
import {runExperiment} from '../dist/experiment-worker.js';
import {buildStudyRequests,importStudy,studyArchive} from '../dist/research-study.js';
const root=new URL('../',import.meta.url),args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
for(const [name,hash]of Object.entries(MODEL_SOURCE_HASHES))if(createHash('sha256').update(readFileSync(new URL('dist/'+name,root))).digest('hex')!==hash)throw Error('模型源码已变动，请先运行 npm run model:build：'+name);
const preset=value('--preset')||'brake',plan=value('--plan');let jobs;
if(plan){const bytes=readFileSync(resolve(plan));if(bytes.length>6e6)throw Error('研究方案不能超过6MB');jobs=importStudy(JSON.parse(bytes.toString('utf8')));}
else if(preset==='brake')jobs=buildStudyRequests({kind:'brake'},{mode:'sweep',sweepKey:'tireMu',from:.65,to:1.25,count:3});
else if(preset==='attitude')jobs=buildStudyRequests({kind:'attitude'},{mode:'pair',pairKey:'stabilization'});
else if(preset==='hover')jobs=buildStudyRequests({kind:'hover'},{mode:'pair',pairKey:'supplyMode'});
else throw Error('预设支持 brake / attitude / hover，或使用 --plan 研究包路径');
const entries=jobs.map(job=>{const report=runExperiment(job.request);console.log(job.label+' | '+report.runId+' | '+report.outcome);return{...job,report};});
const output=resolve(value('--out')||'qa/headless-study-3.4.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(studyArchive(entries,'Headless recomputation; see source/build/protocol metadata'),null,2)+'\n');console.log('Saved '+output);
