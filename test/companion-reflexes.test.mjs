import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Lot 4: the umbrella refill order (offered calm and low, executed to the
// maximum) and the pinned-teammate sidestep (a biter masked by the human's
// own body is killed within 5 s, hold and follow, no friendly hit). The
// fixture is a real simulation in a child process, once per map.
for (const level of ['cabin', 'supermarket']) {
  test(`companion reflexes on ${level}: umbrella refill and saving a pinned teammate`, () => {
    const env = { ...process.env };
    if (level === 'supermarket') env.DEADWOOD_LEVEL = 'supermarket'; else delete env.DEADWOOD_LEVEL;
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/companion-reflexes-check.mjs', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, new RegExp(`${level} companion reflexes verified`));
  });
}
