import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const file=fileURLToPath(new URL('../.runtime/server.json',import.meta.url));
try{
  const info=JSON.parse(fs.readFileSync(file,'utf8'));
  const expected=fileURLToPath(new URL('./serve.mjs',import.meta.url));
  if(!Number.isSafeInteger(info.pid)||info.pid<=0||info.script!==expected)throw new Error('Invalid local server identity.');
  const health=await(await fetch(info.url+'health',{signal:AbortSignal.timeout(1500)})).json();
  if(health.application!=='roadster-flight-lab-reviewed'||health.pid!==info.pid)throw new Error('The port belongs to another application. Nothing was stopped.');
  if(process.platform!=='win32')throw new Error('Use Ctrl+C in the server terminal on this platform.');
  const command=execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-CimInstance Win32_Process -Filter 'ProcessId = ${info.pid}').CommandLine`],{encoding:'utf8',windowsHide:true});
  if(!command.replaceAll('\\','/').toLowerCase().includes(expected.replaceAll('\\','/').toLowerCase()))throw new Error('Process identity changed. Nothing was stopped.');
  process.kill(info.pid);console.log('Roadster Flight Lab stopped.');
}catch(error){console.log(error.code==='ENOENT'?'No local server has been started.':error.message);}
