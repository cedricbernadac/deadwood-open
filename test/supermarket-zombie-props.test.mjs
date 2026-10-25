import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/supermarket-zombie-props-check.mjs', import.meta.url));

test('supermarket zombies pressed against every exterior prop face walk round it and get inside', () => {
  const result = spawnSync(process.execPath, [fixture], {
    cwd, env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const diagnostic = [
    `status: ${result.status}, signal: ${result.signal}`,
    result.error ? String(result.error) : '',
    result.stdout,
    result.stderr,
  ].filter(Boolean).join('\n');
  assert.equal(result.status, 0, diagnostic);
  assert.match(result.stdout, /supermarket zombie props verified: 80 prop starts walked at least 5 m and got inside within 40 s/, diagnostic);
});
