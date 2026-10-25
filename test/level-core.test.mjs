import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Separate processes exercise the same shared module imports as real servers.
// The default process remains the cabin, even when this test is run from map 2.
for (const level of ['cabin', 'supermarket']) test(`${level}: geometry, paths, AI and prediction share the selected level`, () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/level-core-check.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEADWOOD_LEVEL: level }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /level core verified/);
});
