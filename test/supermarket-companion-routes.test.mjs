import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Supermarket companions, lot 2: stair landings, dry flight choice, the
// garden partition's detour in budgets, cross-building trips from outside,
// and route-aware distance texts. Real simulation, no model API.
test('supermarket companion stairs and routes', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/supermarket-companion-routes-check.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /supermarket companion routes verified/);
});

// The cabin keeps the old straight-line helpers (DEADWOOD_LEVEL unset).
test('cabin companion route helpers are unchanged', () => {
  const env = { ...process.env }; delete env.DEADWOOD_LEVEL;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { LEVEL, IS_SUPERMARKET } from './public/level-config.js';
    import { routeLength, routeFlight, companionWaypoint, crossesPartition } from './companions/routes.mjs';
    import { walk } from './companions/coins.mjs';
    import { STAIRS, LOFT } from './public/rules.js';
    assert.equal(IS_SUPERMARKET, false);
    const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const a = { x: -6.5, y: 0, z: 0 }, b = { x: 6, y: 0, z: 4.6 };
    assert.equal(routeLength(a, b), flat(a, b), 'straight-line metres on the cabin');
    assert.equal(routeFlight(a, b), null, 'no flight named on the cabin');
    assert.equal(crossesPartition(a, b), false, 'no partition on the cabin');
    assert.deepEqual(companionWaypoint(a, b), { ...b }, 'the target itself is the waypoint');
    const STAIR_X = (STAIRS.minX + STAIRS.maxX) / 2;
    const LOWER = { x: STAIR_X, z: STAIRS.maxZ + .5 }, UPPER = { x: STAIR_X, z: STAIRS.minZ - .5 };
    const FLIGHT = Math.hypot(UPPER.z - LOWER.z, LOFT.y);
    const low = { x: 1, y: 0, z: 0 }, high = { x: 2.2, y: LOFT.y, z: -3.9 };
    assert.equal(walk(low, high), flat(low, LOWER) + FLIGHT + flat(UPPER, high), 'the cabin staircase formula is untouched');
    assert.equal(walk(a, b), flat(a, b), 'same floor: a straight line');
    console.log('cabin companion route helpers unchanged');
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /cabin companion route helpers unchanged/);
});
