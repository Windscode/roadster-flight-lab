import {prepareDependencies} from './prepare-dependencies.mjs';
import {MODEL_VERSION} from '../dist/vehicle-models.js';
import {MODEL_BUILD_ID} from '../dist/model-build.js';
prepareDependencies({purpose:'runtime'});
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const port=Number(process.env.ROADSTER_PORT??8080),host='127.0.0.1',application='roadster-flight-lab-reviewed';
if(!Number.isInteger(port)||port<0||port>65535)throw Error('ROADSTER_PORT must be an integer from 0 to 65535');
let url=`http://${host}:${port}/`;
const runtime=fileURLToPath(new URL('../.runtime/',import.meta.url));
const script=fileURLToPath(import.meta.url);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.md':'text/plain; charset=utf-8','.hdr':'application/octet-stream','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.glb':'model/gltf-binary','.zip':'application/zip','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav','.bin':'application/octet-stream'};
function openBrowser(){if(process.platform==='win32')spawn('cmd.exe',['/c','start','',url],{windowsHide:true,stdio:'ignore'});}
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  if(req.url==='/health'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:JSON.stringify({application,version:MODEL_VERSION,modelBuildId:MODEL_BUILD_ID,pid:process.pid}));return;
  }
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,url).pathname);}catch{res.writeHead(400);res.end('Bad path');return;}
  const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname)),relative=path.relative(root,target);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){res.writeHead(403);res.end('Forbidden');return;}
  fs.stat(target,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
    const headers={'Content-Type':mime[path.extname(target)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
    let start=0,end=stat.size-1,status=200;
    if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}else start=Math.max(0,stat.size-Number(m[2]));if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;headers['Content-Length']=end-start+1;}
    res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}fs.createReadStream(target,{start,end}).on('error',()=>res.destroy()).pipe(res);
  });
});
server.on('error',async err=>{
  if(err.code==='EADDRINUSE'){
    try{const health=await(await fetch(url+'health',{signal:AbortSignal.timeout(1500)})).json();
      if(health.application===application&&health.version===MODEL_VERSION&&health.modelBuildId===MODEL_BUILD_ID){console.log('Roadster Flight Lab is already running with this build: '+url);if(process.argv.includes('--open'))openBrowser();return;}
      if(health.application===application){console.error(`Port ${port} runs a different Roadster build. Stop that server or use ROADSTER_PORT to choose another port.`);process.exitCode=1;return;}
    }catch{}
    console.error(`Port ${port} is occupied by another application. Stop that server, then launch again.`);
  }else console.error(err.message);
  process.exitCode=1;
});
server.listen(port,host,()=>{
  url=`http://${host}:${server.address().port}/`;
  fs.mkdirSync(runtime,{recursive:true});fs.writeFileSync(path.join(runtime,'server.json'),JSON.stringify({pid:process.pid,script,url,application}));
  console.log(`ROADSTER FLIGHT LAB ${MODEL_VERSION}\n${url}\nKeep this window open. Ctrl+C stops this local server.`);
  if(process.argv.includes('--open'))openBrowser();
});

