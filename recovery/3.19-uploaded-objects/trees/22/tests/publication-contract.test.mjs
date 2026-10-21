import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {SOURCE_INHERITANCE,SITE_BASE_URL,validatePublicationContract,verifyPublicationFiles,assertPublicationEvidenceCoverage,assertPublicationRuntimeInventory,assertCommittedPublicationFiles,selectPublicationPayloads,preparePublicationPayloads,copyPublicationFile,fileIdentity,renderAvailabilityPage} from '../scripts/publication-contract.mjs';
import {packPayloads,readPayloadManifest,restorePayloads,verifyPayloads} from '../scripts/repository-payloads.mjs';

const scratch=mkdtempSync(join(tmpdir(),'roadster-publication-contract-')),checks=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source={commit:'1'.repeat(40),tree:'2'.repeat(40),modelVersion:'fixture.0',modelBuildId:'3'.repeat(64),bundle:{path:'synthetic-fixture.bundle',bytes:1,sha256:'4'.repeat(64),saveStatus:'synthetic test metadata; no real archive or saved Library file is claimed'}};
const save=(root,path,body)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
function entry(root,path,classification){
  const identity=fileIdentity(join(root,path)),offline=classification==='archived-not-published';
  return{path,...identity,classification,publiclyAvailable:!offline,...(offline?{archive:{path,saveStatus:'synthetic archive identity retained for this fault fixture'}}:{onlineURL:new URL(path.startsWith('dist/')?path.slice(5):path,SITE_BASE_URL).href})};
}
const contract=files=>({schema:'roadster.publication-availability',version:1,sourceInheritance:SOURCE_INHERITANCE,source:structuredClone(source),files});
function check(name,run){run();checks.push(name);}
try{
  const root=join(scratch,'ordinary'),output=join(scratch,'site');mkdirSync(root);mkdirSync(output);
  save(root,'dist/main.js','export const fixture=1;\n');save(root,'qa/report.json','{"status":"failed-retained"}\n');save(root,'qa/check.mjs','// source location fixture\n');save(root,'qa/raw.ndjson','{"large":true}\n');
  const original=contract([entry(root,'dist/main.js','runtime-required'),entry(root,'qa/report.json','online-evidence'),entry(root,'qa/check.mjs','online-evidence'),entry(root,'qa/raw.ndjson','archived-not-published')]);
  rmSync(join(root,'qa/raw.ndjson'));
  check('Classified offline evidence may be absent locally without being represented as online',()=>{validatePublicationContract(original);assert.equal(verifyPublicationFiles({root,contract:original}).files,3);});
  check('Every validation reference is classified, including offline data and code locations',()=>{
    const coverage=assertPublicationEvidenceCoverage({report:'qa/report.json',trace:'qa/raw.ndjson',source:'qa/check.mjs:8'},original);
    assert.equal(coverage.references,3);assert.equal(coverage.onlineReferences,2);assert.equal(coverage.offlineReferences,1);assert.equal(coverage.items[1].publiclyAvailable,false);assert(!Object.hasOwn(coverage.items[1],'onlineURL'));
  });
  check('An unclassified reference fails instead of being skipped',()=>assert.throws(()=>assertPublicationEvidenceCoverage({report:'qa/missing.json'},original),/Unclassified validation evidence/));
  check('A missing required runtime file fails',()=>{rmSync(join(root,'dist/main.js'));assert.throws(()=>verifyPublicationFiles({root,contract:original}),/ENOENT/);save(root,'dist/main.js','export const fixture=1;\n');});
  check('Changed online bytes fail the declared hash identity',()=>{save(root,'qa/report.json','{"status":"forged-passed"}\n');assert.throws(()=>verifyPublicationFiles({root,contract:original}),/Online file identity mismatch/);save(root,'qa/report.json','{"status":"failed-retained"}\n');});
  check('Offline records require original source and bundle identity, with a real save-status declaration',()=>{
    const missingBundle=structuredClone(original);delete missingBundle.source.bundle;assert.throws(()=>validatePublicationContract(missingBundle),/bundle identity/);
    const missingStatus=structuredClone(original);delete missingStatus.files[3].archive.saveStatus;assert.throws(()=>validatePublicationContract(missingStatus),/real save status/);
    const missingCommit=structuredClone(original);delete missingCommit.source.commit;assert.throws(()=>validatePublicationContract(missingCommit),/original source identity/);
  });
  check('Offline entries reject any onlineURL, including a null placeholder',()=>{
    for(const value of [null,'https://example.invalid/fake']){const wrong=structuredClone(original);wrong.files[3].onlineURL=value;assert.throws(()=>validatePublicationContract(wrong),/must not claim public availability/);}
    const wrong=structuredClone(original);wrong.files[3].publiclyAvailable=true;assert.throws(()=>validatePublicationContract(wrong),/must not claim public availability/);
  });
  check('Only actual online copies contribute to copied file counts and bytes',()=>{
    const copied=original.files.filter(row=>row.publiclyAvailable).map(item=>copyPublicationFile({root,output,entry:item}));
    assert.equal(copied.length,3);assert.equal(copied.reduce((n,item)=>n+item.bytes,0),original.files.slice(0,3).reduce((n,item)=>n+item.bytes,0));
    assert(!existsSync(join(output,'qa/raw.ndjson')));assert.throws(()=>copyPublicationFile({root,output,entry:original.files[3]}),/Cannot copy archived/);
    assert.equal(readFileSync(join(output,'qa/report.json'),'utf8'),'{"status":"failed-retained"}\n');
  });
  check('Runtime source-browse copies retain the exact runtime bytes',()=>{
    copyPublicationFile({root,output,entry:original.files[0],sitePath:'dist/main.js'});
    assert.deepEqual(readFileSync(join(output,'main.js')),readFileSync(join(output,'dist/main.js')));
  });
  check('Runtime inventory rejects an omitted runtime path and an unaccounted new executable',()=>{
    const modelSourceHashes={'main.js':original.files[0].sha256};assertPublicationRuntimeInventory({contract:original,trackedPaths:['dist/main.js'],modelSourceHashes});
    assert.throws(()=>assertPublicationRuntimeInventory({contract:original,trackedPaths:['dist/main.js','dist/worker.js'],modelSourceHashes}),/Missing runtime-required/);
    assert.throws(()=>assertPublicationRuntimeInventory({contract:original,trackedPaths:['dist/main.js'],modelSourceHashes:{}}),/executable inventory/);
    assert.throws(()=>assertPublicationRuntimeInventory({contract:original,trackedPaths:['tests/real-input-test.mjs']}),/Source or test code must be published/);
  });
  check('Uncommitted source bytes cannot be labelled as actual publication HEAD',()=>{
    const headBlobs=new Map(original.files.filter(row=>row.publiclyAvailable).map(row=>[row.path,row.gitBlob]));
    assert.equal(assertCommittedPublicationFiles({contract:original,headBlobs}).ordinaryFiles,3);
    headBlobs.set('dist/main.js','0'.repeat(40));assert.throws(()=>assertCommittedPublicationFiles({contract:original,headBlobs}),/actual committed HEAD/);
  });
  check('Offline download page has no link for the archived path',()=>{
    const page=renderAvailabilityPage(original,{publicationCommit:'5'.repeat(40),publicationTree:'6'.repeat(40)});
    assert(page.includes('qa/raw.ndjson'));assert(!/href="[^"]*qa\/raw\.ndjson/.test(page));assert(page.includes('未在线发布'));assert(page.includes('forged-passed')===false);
  });
  check('Publication copies never follow a symbolic link',()=>{
    rmSync(join(root,'qa/report.json'));symlinkSync(join(root,'qa/check.mjs'),join(root,'qa/report.json'));
    assert.throws(()=>verifyPublicationFiles({root,contract:original}),/Symbolic link/);rmSync(join(root,'qa/report.json'));save(root,'qa/report.json','{"status":"failed-retained"}\n');
  });

  const packedRoot=join(scratch,'packed');mkdirSync(packedRoot);
  save(packedRoot,'dist/assets/field.bin',Buffer.from([1,4,8,16,32]));save(packedRoot,'qa/offline.json','{"original":"retained synthetic fixture"}\n');
  packPayloads({root:packedRoot,paths:['dist/assets/field.bin','qa/offline.json']});
  const manifest=readPayloadManifest(packedRoot),manifestBefore=readFileSync(join(packedRoot,'repository-payloads/manifest.json'));
  const packed=contract([entry(packedRoot,'dist/assets/field.bin','runtime-required'),entry(packedRoot,'qa/offline.json','archived-not-published')]);
  const offlineManifest=manifest.files.find(row=>row.path==='qa/offline.json'),retainedChunks=offlineManifest.parts.map(part=>({path:part.path,bytes:readFileSync(join(packedRoot,part.path))}));
  rmSync(join(packedRoot,'dist/assets/field.bin'));rmSync(join(packedRoot,'qa/offline.json'));for(const part of retainedChunks)rmSync(join(packedRoot,part.path));
  check('Public subset restores runtime while unpublished QA chunks are absent; full restore still fails',()=>{
    const selected=selectPublicationPayloads(packed,manifest);assert.equal(selected.files.length,1);
    const prepared=preparePublicationPayloads(packedRoot,packed);assert.equal(prepared.restoration.restored,1);assert.equal(prepared.verification.files,1);
    assert.deepEqual(readFileSync(join(packedRoot,'dist/assets/field.bin')),Buffer.from([1,4,8,16,32]));assert(!existsSync(join(packedRoot,'qa/offline.json')));
    assert.throws(()=>restorePayloads({root:packedRoot,strict:true}),/ENOENT/);
    assert.deepEqual(readFileSync(join(packedRoot,'repository-payloads/manifest.json')),manifestBefore);
  });
  check('Repository test inputs restore without becoming Pages downloads',()=>{
    for(const part of retainedChunks)save(packedRoot,part.path,part.bytes);
    const required=structuredClone(packed);required.files[1].repositoryRequired=true;required.files[1].consumers=['tests/actual-consumer.mjs'];
    assert.equal(selectPublicationPayloads(required,manifest).files.length,1);
    assert.equal(selectPublicationPayloads(required,manifest,{purpose:'runtime'}).files.length,1);
    assert.equal(selectPublicationPayloads(required,manifest,{purpose:'test'}).files.length,2);
    assert.equal(preparePublicationPayloads(packedRoot,required,{purpose:'test'}).restoration.restored,1);
    assert(!Object.hasOwn(required.files[1],'onlineURL'));assert.equal(required.files[1].publiclyAvailable,false);
    rmSync(join(packedRoot,'qa/offline.json'));for(const part of retainedChunks)rmSync(join(packedRoot,part.path));
    assert.throws(()=>preparePublicationPayloads(packedRoot,required,{purpose:'test'}),/ENOENT/);
    assert.equal(preparePublicationPayloads(packedRoot,required,{purpose:'runtime'}).verification.files,1);
    const missingConsumer=structuredClone(required);delete missingConsumer.files[1].consumers;assert.throws(()=>validatePublicationContract(missingConsumer),/explicit consumers/);
  });
  check('An unclassified packed logical file is rejected',()=>{const bad=structuredClone(packed);bad.files.pop();assert.throws(()=>selectPublicationPayloads(bad,manifest),/Unclassified packed payload/);});
  check('A corrupt or absent required runtime chunk fails even when the expanded runtime exists',()=>{
    const runtimeChunk=manifest.files.find(row=>row.path.startsWith('dist/')).parts[0],path=join(packedRoot,runtimeChunk.path),bytes=readFileSync(path);writeFileSync(path,Buffer.from('corrupt'));
    assert.throws(()=>preparePublicationPayloads(packedRoot,packed),/Corrupt payload segment/);rmSync(path);assert.throws(()=>preparePublicationPayloads(packedRoot,packed),/ENOENT/);writeFileSync(path,bytes);
  });
  check('Full archive restoration is a distinct positive fixture, not inferred from public-subset success',()=>{
    for(const part of retainedChunks)save(packedRoot,part.path,part.bytes);
    const full=restorePayloads({root:packedRoot,strict:true});assert.equal(full.files,2);assert.equal(full.restored,1);assert.equal(verifyPayloads({root:packedRoot}).files,2);
    assert.equal(hash(readFileSync(join(packedRoot,'repository-payloads/manifest.json'))),hash(manifestBefore));
  });
  console.log(JSON.stringify({schema:'roadster.publication-contract-fault-tests',status:'passed',checks,scope:'Small synthetic fault fixtures. Public-subset and full-archive restoration are checked separately; this is not a claim that the real complete project archive was restored here.'},null,2));
}finally{rmSync(scratch,{recursive:true,force:true});}
