import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('companions traverse both supermarket stairs, rescue and fight in the cellar without a model API', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/companions-supermarket-depth-check.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 90000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /complex supermarket companions verified/);
});
