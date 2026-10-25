import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, linkSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const windows=process.platform==='win32';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
// play.cmd runs `node -e` without `call`, so a fake node.cmd would take over the batch and never return:
// the fixture puts a real node.exe (hard link, or copy across volumes) first on PATH, which passes the Node 22 check.
function fixture(t,{npmExit=0}={}){
 const root=mkdtempSync(join(tmpdir(),'deadwood launcher '));
 t.after(()=>{const target=resolve(root);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('deadwood launcher '))throw Error('Unexpected launcher fixture cleanup path');rmSync(target,{recursive:true,force:true});});
 copyFileSync(new URL('../play.cmd',import.meta.url),join(root,'play.cmd'));
 const bin=join(root,'commands');mkdirSync(bin,{recursive:true});
 try{linkSync(process.execPath,join(bin,'node.exe'));}catch{copyFileSync(process.execPath,join(bin,'node.exe'));}
 writeFileSync(join(bin,'npm.cmd'),'@echo off\r\n> launched.txt echo %~1^|%~2^|%DEADWOOD_LEVEL%^|%PORT%\r\nexit /b '+npmExit+'\r\n');
 for(const name of ['three','ws']){const folder=join(root,'node_modules',name);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'package.json'),'{}');}
 const run=(extra={})=>{
  const env={...process.env,PATH:bin+';'+process.env.SystemRoot+'\\System32'};delete env.DEADWOOD_LEVEL;delete env.PORT;Object.assign(env,extra);
  return spawnSync(process.env.ComSpec??'C:\\Windows\\System32\\cmd.exe',['/d','/c',`call "${join(root,'play.cmd')}"`],{cwd:root,env,encoding:'utf8',input:'\r\n',windowsHide:true,windowsVerbatimArguments:true,timeout:15000});
 };
 return {root,run};
}
for(const [label,env,expected] of [
 ['the default port',{},'run|start:lan||3000'],
 ['PORT=3002',{PORT:'3002'},'run|start:lan||3002'],
])test('Windows play.cmd starts the LAN gateway with the map choice on '+label,{skip:!windows},t=>{
 const {root,run}=fixture(t);const result=run(env);assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(readFileSync(join(root,'launched.txt'),'utf8').trim(),expected);
 assert.match(result.stdout,/choisis le decor \(cabane, supermarche, hopital, fete foraine\) dans le menu du jeu/);
 assert.match(result.stdout,new RegExp('Ouvre http://localhost:'+expected.split('|')[3]+' sur cet ordinateur'));
 assert.match(result.stdout,/Pour arreter le serveur, appuie sur Ctrl\+C/);
});
test('Windows play.cmd keeps npm start when a level launcher falls back to it',{skip:!windows},t=>{
 const {root,run}=fixture(t);const result=run({DEADWOOD_LEVEL:'hospital',PORT:'3104'});assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(readFileSync(join(root,'launched.txt'),'utf8').trim(),'start||hospital|3104');
 assert.match(result.stdout,/Demarrage de DEADWOOD\. Garde cette fenetre ouverte pendant la partie\./);
 assert.doesNotMatch(result.stdout,/choisis le decor/);
});
test('Windows play.cmd still reports a gateway that stops with an error',{skip:!windows},t=>{
 const {root,run}=fixture(t,{npmExit:1});const result=run();
 assert.equal(readFileSync(join(root,'launched.txt'),'utf8').trim(),'run|start:lan||3000');
 assert.match(result.stdout,/Le serveur s'est arrete avec une erreur/);
});
test('play.cmd and package.json: LAN gateway script beside the unchanged standalone start',()=>{
 const scripts=JSON.parse(read('package.json')).scripts;
 assert.equal(scripts['start:lan'],'node lan-gateway.mjs');
 assert.equal(scripts.start,'node server.mjs');
 const launcher=read('play.cmd');
 assert.ok(!/taskkill|Stop-Process/i.test(launcher),'play.cmd never stops other processes');
 assert.ok(!/\r(?!\n)|(?<!\r)\n/.test(launcher),'play.cmd keeps CRLF line endings');
 assert.ok(/^[\x00-\x7f]*$/.test(launcher),'play.cmd stays ASCII');
 assert.equal((launcher.match(/set "PORT=/g)??[]).length,1,'only the 3000 default touches PORT');
 assert.match(launcher,/if not defined PORT set "PORT=3000"\r\n/);
});
