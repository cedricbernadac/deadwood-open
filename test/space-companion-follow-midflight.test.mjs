import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Papa stops on the treads of each flight of both SPACE maps, Max following.
// The fixture uses the real simulation and companion bodies, without a brain,
// server or model API.
for (const level of ['supermarket', 'hospital']) {
  test(`${level} companions following a human who stops on a flight settle beside him instead of running landing to landing`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/space-companion-follow-midflight-check.mjs', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DEADWOOD_LEVEL: level },
      encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
    });
    const diagnostic = [`status: ${result.status}, signal: ${result.signal}`, result.error ? String(result.error) : '', result.stdout, result.stderr].filter(Boolean).join('\n');
    assert.equal(result.status, 0, diagnostic);
    assert.match(result.stdout, new RegExp(`${level} companion follow mid-flight verified: 24 cases;`), diagnostic);
  });
}
