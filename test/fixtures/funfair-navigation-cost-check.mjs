import assert from 'node:assert/strict';
import { navigationGraphCost } from '../../simulation.mjs';
import { IS_FUNFAIR } from '../../public/level-config.js';
import { SPACE } from '../../public/level-space.js';

assert.equal(IS_FUNFAIR, true, 'run with DEADWOOD_LEVEL=funfair');
const profiles = [['walker', 1.82, .29], ['crawler', .82, .29], ['boss', 1.91 * 1.32, .29 * 1.32]];
const costs = [];
for (const [floor, y] of [['ground', 0], ['cellar', SPACE.minY]]) for (const [profile, height, radius] of profiles) {
  const cost = navigationGraphCost(y, height, radius);
  assert.ok(cost.obstacles >= 30 && cost.corners >= 75, `${floor}/${profile} graph spans the funfair partitions: ${JSON.stringify(cost)}`);
  assert.ok(cost.casts <= cost.pairs * 4, `${floor}/${profile} graph casts ${(cost.casts / cost.pairs).toFixed(2)} obstacles per corner pair: ${JSON.stringify(cost)}`);
  costs.push({ floor, profile, ...cost });
}
console.log(JSON.stringify(costs));
console.log(`funfair navigation cost verified: ${costs.length} cold graphs, at most ${Math.max(...costs.map(c => c.casts / c.pairs)).toFixed(2)} casts per corner pair`);
