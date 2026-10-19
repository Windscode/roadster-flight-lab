import {readFileSync,existsSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist');
const html=readFileSync(resolve(dist,'index.html'),'utf8');
const main=readFileSync(resolve(dist,'main.js'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'Duplicate HTML element IDs');
for(const m of main.matchAll(/(?<!\$)\$\('([^']+)'\)/g))assert.ok(ids.includes(m[1]),'Missing fixed UI element '+m[1]);
const assets=[...html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map(m=>m[1]);
for(const p of assets)assert.ok(existsSync(resolve(dist,p.split('?')[0])),'Missing static asset '+p);
const imports=new Set();
function checkModule(file){
  if(imports.has(file))return;imports.add(file);const source=readFileSync(file,'utf8');
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
  // Import patterns beginning at real module syntax; documentation is excluded.
  const deps=[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m=>m[1]);
  for(const dep of deps){assert.ok(dep.startsWith('.'),'Unexpected runtime external dependency '+dep);const next=resolve(dirname(file),dep);assert.ok(existsSync(next),'Missing module '+next);checkModule(next);}
}
checkModule(resolve(dist,'main.js'));
checkModule(resolve(dist,'research-lab.js'));
checkModule(resolve(dist,'experiment-worker.js'));
const researchEntry=readFileSync(resolve(dist,'research.html'),'utf8');
assert.match(researchEntry,/research-entry\.js/,'Legacy research URL must enter the same-page lab');
assert.ok(!/research-page-link|href=["']\.\/research\.html/.test(html),'City controls must not reload a separate research page');
checkModule(resolve(dist,'research-entry.js'));
const researchHtml=readFileSync(resolve(dist,'research-panel.html'),'utf8'),researchJS=readFileSync(resolve(dist,'research-lab.js'),'utf8');
const researchIds=[...researchHtml.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(researchIds).size,researchIds.length,'Duplicate research UI IDs');
for(const m of researchJS.matchAll(/(?<!\$)\$\('([^']+)'\)/g))assert.ok(researchIds.includes(m[1]),'Missing research UI '+m[1]);
for(const m of researchHtml.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))assert.ok(existsSync(resolve(dist,m[1].split('?')[0])),'Missing research asset '+m[1]);
checkModule(resolve(dist,'vendor/addons/exporters/GLTFExporter.js'));
const {createRoadster}=await import(pathToFileURL(resolve(dist,'vehicle.js')));
const {RoadsterSim}=await import(pathToFileURL(resolve(dist,'physics.js')));
const car=createRoadster(),sim=new RoadsterSim({supplyMode:'bench'});sim.reset('hover');
for(let i=0;i<120;i++){const t=sim.step(1/120,{});car.update({...t,brake:0},1/120);}
let meshCount=0,vertices=0;car.group.traverse(o=>{if(o.geometry){meshCount++;const p=o.geometry.attributes.position;if(p){vertices+=p.count;assert.ok(p.array.every(Number.isFinite),'Nonfinite car geometry');}}});
car.group.traverse(o=>{const n=o.geometry?.attributes.normal;if(n)for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.0005,'Non-unit surface normal in '+o.name);});
car.setCutaway(true);car.setCutaway(false);car.setColor('#e9ece3');car.dispose();
const result={status:'passed',researchPanelIds:researchIds.length,samePageLab:true,fixedUiElements:ids.length,modulesChecked:imports.size,meshCount,vertices,externalRuntimeModules:0,carPhysicsIntegrationFrames:120};
const report=JSON.parse(readFileSync(resolve(dist,'validation.json'),'utf8'));report.integration=result;writeFileSync(resolve(dist,'validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(result));
