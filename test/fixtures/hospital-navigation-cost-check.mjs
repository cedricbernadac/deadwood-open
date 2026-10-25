import assert from 'node:assert/strict';
// The zombies' visibility graph on the hospital (56 partition pieces): one
// cold build per floor and enemy profile hitches the whole server once, so its
// cost is guarded in obstacle casts, not milliseconds (a loaded machine
// cannot flake a count). Before the broad phase in segmentClear every corner
// pair cast every obstacle in turn until one blocked: 31.6 casts per pair on
// the ground floor (82 obstacles, ~540 ms); now only the obstacles near the
// segment are cast (2.9 per pair, ~85 ms). Run with DEADWOOD_LEVEL=hospital.
import { navigationGraphCost } from '../../simulation.mjs';
import { IS_HOSPITAL } from '../../public/level-config.js';
import { SPACE } from '../../public/level-space.js';

assert.equal(IS_HOSPITAL, true, 'run with DEADWOOD_LEVEL=hospital');
const profiles = [['walker', 1.82, .29], ['crawler', .82, .29], ['boss', 1.91 * 1.32, .29 * 1.32]];
const costs = [];
for (const [floor, y] of [['ground', 0], ['basement', SPACE.minY]]) for (const [profile, height, radius] of profiles) {
  const cost = navigationGraphCost(y, height, radius);
  assert.ok(cost.obstacles >= 40 && cost.corners >= 100, `${floor}/${profile} graph spans the partitions: ${JSON.stringify(cost)}`);
  assert.ok(cost.casts <= cost.pairs * 4, `${floor}/${profile} graph casts ${(cost.casts / cost.pairs).toFixed(2)} obstacles per corner pair: ${JSON.stringify(cost)}`);
  costs.push({ floor, profile, ...cost });
}
console.log(JSON.stringify(costs));
console.log(`hospital navigation cost verified: ${costs.length} cold graphs, at most ${Math.max(...costs.map(c => c.casts / c.pairs)).toFixed(2)} casts per corner pair`);
