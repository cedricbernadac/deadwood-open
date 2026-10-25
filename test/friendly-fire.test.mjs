import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './fixtures/friendly-fire-scenarios.mjs';

// Friendly fire (owner, 23 October): the authority on the cabin, scenario by
// scenario, then the same scenarios on the supermarket in a child process
// (the level is chosen once per process).
for (const [name, scenario] of Object.entries(SCENARIOS)) test(`cabin: ${name}`, scenario);

test('supermarket: every friendly fire scenario holds on the second map', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runAll } from './test/fixtures/friendly-fire-scenarios.mjs';
    import { LEVEL } from './public/level-config.js';
    if (LEVEL.id !== 'supermarket') throw new Error('not the supermarket: ' + LEVEL.id);
    console.log('supermarket friendly fire: ' + runAll().length + ' scenarios');
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, new RegExp(`supermarket friendly fire: ${Object.keys(SCENARIOS).length} scenarios`));
});
