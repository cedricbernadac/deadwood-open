import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
test('supermarket depth: traversals, prediction, zombie routes, projectiles and negative saves',()=>{
 const run=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/supermarket-depth-physics-check.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,DEADWOOD_LEVEL:'supermarket'},encoding:'utf8',timeout:60000});assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/depth physics verified/);
});
