import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Solid parking props on the supermarket lot: navigation, placement, saves.
test('supermarket props block outdoor routes, placements and restored saves', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/supermarket-props-check.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /supermarket parking props verified/);
});

// The cabin keeps its historical exterior: the building bounds alone.
test('cabin exterior navigation obstacles are unchanged by the props', () => {
  const env = { ...process.env }; delete env.DEADWOOD_LEVEL;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { navigationObstacles } from './simulation.mjs';
    import { LEVEL } from './public/level-config.js';
    const obstacles = navigationObstacles(0, true);
    assert.equal(obstacles.length, 1);
    assert.equal(obstacles[0], LEVEL.buildingBounds);
    console.log('cabin exterior obstacles unchanged');
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /cabin exterior obstacles unchanged/);
});
