import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test('supermarket zombies cross the interior stair head without a three-second stall', () => {
  const result = spawnSync(process.execPath, [fixture('supermarket-zombie-stairs-check.mjs')], {
    cwd, env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /supermarket zombie stock-stair routes verified/);
});

test('cabin zombie stair traversal remains unchanged', () => {
  const env = { ...process.env };
  delete env.DEADWOOD_LEVEL;
  const result = spawnSync(process.execPath, [fixture('cabin-zombie-stairs-check.mjs')], {
    cwd, env, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /cabin zombie stair routes unchanged/);
});
