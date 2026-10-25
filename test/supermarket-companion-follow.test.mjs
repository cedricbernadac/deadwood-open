import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Both supermarket flights, both directions, Papa walking and sprinting. The
// fixture uses the real simulation and companion bodies, without a brain,
// server or model API.
test('supermarket companions follow a human down and up both stairs without shuttling on the treads', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/supermarket-companion-follow-check.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' },
    encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
  });
  const diagnostic = [`status: ${result.status}, signal: ${result.signal}`, result.error ? String(result.error) : '', result.stdout, result.stderr].filter(Boolean).join('\n');
  assert.equal(result.status, 0, diagnostic);
  assert.match(result.stdout, /supermarket companion follow verified: 8 cases;/, diagnostic);
});
