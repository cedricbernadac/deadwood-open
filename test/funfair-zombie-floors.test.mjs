import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/funfair-zombie-routes-check.mjs', import.meta.url));

test('funfair zombies climb from every cellar room and stair hall to every ground room and stair hall and come back down', () => {
  const result = spawnSync(process.execPath, [fixture, 'floors'], {
    cwd: ROOT, env: { ...process.env, DEADWOOD_LEVEL: 'funfair' }, encoding: 'utf8', timeout: 420000, maxBuffer: 4 * 1024 * 1024,
  });
  const diagnostic = [`status: ${result.status}, signal: ${result.signal}`, result.error ? String(result.error) : '', result.stdout, result.stderr].filter(Boolean).join('\n');
  assert.equal(result.status, 0, diagnostic);
  assert.match(result.stdout, /funfair zombie floor routes verified: \d+ /, diagnostic);
});
