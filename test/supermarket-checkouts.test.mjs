import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Two more checkout counters in the supermarket row: collisions, navigation,
// companions, placements and restored saves.
test('supermarket checkout counters are solid, navigable and save-safe', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/supermarket-checkouts-check.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /supermarket checkout row verified/);
});

// The cabin keeps its historical layout: no furniture, building bounds alone.
test('cabin navigation and furniture are unchanged by the checkout row', () => {
  const env = { ...process.env }; delete env.DEADWOOD_LEVEL;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { navigationObstacles } from './simulation.mjs';
    import { LEVEL } from './public/level-config.js';
    assert.equal(LEVEL.id, 'cabin');
    assert.equal(LEVEL.furniture.length, 0);
    const obstacles = navigationObstacles(0, true);
    assert.equal(obstacles.length, 1);
    assert.equal(obstacles[0], LEVEL.buildingBounds);
    console.log('cabin unchanged by the checkout row');
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /cabin unchanged by the checkout row/);
});
