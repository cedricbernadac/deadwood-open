import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The open-air terrace is rain, not shelter: the east door is guarded from
// the roofed passage, trips end under the roof, and combat orders still act.
test('supermarket companions keep out of the terrace rain and still fight there', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/supermarket-companion-terrace-check.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 240000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /supermarket terrace verified/);
});

// On the cabin nothing is rain-sheltered differently: the helpers are inert.
test('cabin companions are unchanged by the terrace rules', () => {
  const env = { ...process.env }; delete env.DEADWOOD_LEVEL;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { sheltered, wetApproach, TERRACE_PASSAGE } from './companions/outdoors.mjs';
    import { LEVEL } from './public/level-config.js';
    assert.equal(LEVEL.id, 'cabin');
    assert.equal(TERRACE_PASSAGE, null);
    assert.equal(sheltered({ x: 20, y: 0, z: 0 }), true);
    assert.equal(wetApproach({ x: 4, y: 0, z: 0, outX: 1, outZ: 0 }), 0);
    console.log('cabin unchanged by the terrace rules');
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /cabin unchanged by the terrace rules/);
});
