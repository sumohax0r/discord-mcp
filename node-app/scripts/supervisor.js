// A small Windows-friendly process supervisor with bounded local logs.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'logs');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const log=path.join(dir,'service.log');let stopping=false,child,timer;
function write(data){try{if(fs.existsSync(log)&&fs.statSync(log).size>1024*1024){for(let i=3;i>=1;i--){const from=log+'.'+i;if(fs.existsSync(from))fs.renameSync(from,log+'.'+(i+1));}fs.renameSync(log,log+'.1');}fs.appendFileSync(log,data,{mode:0o600});}catch{}}
function start(){if(stopping)return;write(`${new Date().toISOString()} Starting service\n`);child=spawn(process.execPath,[path.join(root,'src','server.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',write);child.stderr.on('data',write);child.on('error',()=>write('Service process could not start.\n'));child.on('exit',code=>{write(`${new Date().toISOString()} Service exited (${code})\n`);if(!stopping)timer=setTimeout(start,10000);});}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearTimeout(timer);child?.kill();});start();
