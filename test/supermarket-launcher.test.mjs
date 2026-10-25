import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const windows=process.platform==='win32';
function fixture(t,{bundled=false,dependencies=true,npm=false,oldNode=false}={}){
 const root=mkdtempSync(join(tmpdir(),'deadwood launcher '));
 t.after(()=>{const target=resolve(root);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('deadwood launcher '))throw Error('Unexpected launcher fixture cleanup path');rmSync(target,{recursive:true,force:true});});
 copyFileSync(new URL('../play-supermarket.cmd',import.meta.url),join(root,'play-supermarket.cmd'));
 copyFileSync(new URL('../play.cmd',import.meta.url),join(root,'play.cmd'));
 const bin=join(root,'commands'),profile=join(root,'profile with spaces');mkdirSync(bin,{recursive:true});
 const env={...process.env,PATH:process.env.SystemRoot+'\\System32',USERPROFILE:profile};
 if(bundled){
  const executable=join(profile,'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','bin','node.exe');mkdirSync(dirname(executable),{recursive:true});copyFileSync(process.execPath,executable);
  writeFileSync(join(root,'start-supermarket.mjs'),`import fs from 'node:fs';fs.writeFileSync('launched.json',JSON.stringify({args:process.argv.slice(2),map:process.env.DEADWOOD_LEVEL,port:process.env.PORT}));`);
 }else{
  env.PATH=bin+';'+env.PATH;
  writeFileSync(join(bin,'node.cmd'),'@echo off\r\nif "%~1"=="-e" exit /b '+(oldNode?1:0)+'\r\n> launched.txt echo %~1^|%~2^|%DEADWOOD_LEVEL%^|%PORT%\r\nexit /b 0\r\n');
 }
 if(npm){env.PATH=bin+';'+env.PATH;writeFileSync(join(bin,'npm.cmd'),'@echo off\r\nif "%~1"=="install" > installed.txt echo installed\r\nif "%~1"=="start" > fallback.txt echo %DEADWOOD_LEVEL%^|%PORT%\r\nexit /b 0\r\n');}
 if(dependencies)for(const name of ['three','ws']){const folder=join(root,'node_modules',name);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'package.json'),'{}');}
 const run=port=>spawnSync(process.env.ComSpec??'C:\\Windows\\System32\\cmd.exe',['/d','/c',`call "${join(root,'play-supermarket.cmd')}"${port?' '+port:''}`],{cwd:root,env,encoding:'utf8',input:'\r\n',windowsHide:true,windowsVerbatimArguments:true,timeout:15000});
 return {root,run};
}
for(const port of [undefined,'3047'])test('Windows supermarket launcher starts without npm, port '+(port??'default'),{skip:!windows},t=>{
 const {root,run}=fixture(t);const result=run(port);assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(readFileSync(join(root,'launched.txt'),'utf8').trim(),`start-supermarket.mjs|${port??3013}|supermarket|${port??3013}`);
});
test('Windows supermarket launcher falls back to the bundled Node executable in a spaced path',{skip:!windows},t=>{
 const {root,run}=fixture(t,{bundled:true});const result=run();assert.equal(result.status,0,result.stdout+result.stderr);
 assert.deepEqual(JSON.parse(readFileSync(join(root,'launched.json'),'utf8')),{args:['3013'],map:'supermarket',port:'3013'});
});
test('Windows supermarket launcher explains missing npm only when dependencies need installing',{skip:!windows},t=>{
 const {root,run}=fixture(t,{dependencies:false});const result=run();assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stdout,/dependances manquent et npm est introuvable/);assert.equal(existsSync(join(root,'launched.txt')),false);
});
test('Windows supermarket launcher keeps the existing installer when npm is available',{skip:!windows},t=>{
 const {root,run}=fixture(t,{bundled:true,dependencies:false,npm:true});const result=run('3048');assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(existsSync(join(root,'installed.txt')),true);assert.equal(readFileSync(join(root,'fallback.txt'),'utf8').trim(),'supermarket|3048');
});
test('Windows supermarket launcher rejects Node older than 22 before starting',{skip:!windows},t=>{
 const {root,run}=fixture(t,{oldNode:true});const result=run();assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stdout,/trop ancienne/);assert.equal(existsSync(join(root,'launched.txt')),false);
});
