import assert from 'node:assert/strict';
import test from 'node:test';
import { WEAPONS, WORLD, damageFalloff } from '../simulation.mjs';
import { comparisonStats, damageAtDistance, scenarioColumns, weightedWeaponScore } from '../public/weapon-comparison.js';
import { scenarioReport } from '../public/weapon-scenarios.js';

test('comparison reports shared game damage and the actual simulated horizon', () => {
  for (const weapon of Object.values(WEAPONS)) {
    for (const distance of [0, 3, 6, 10, 18, 25, 45, 65]) {
      const u = Math.max(0, Math.min(1, (6 - distance)));
      const expected = weapon.fuel ? weapon.damage * (6 * u ** 5 - 15 * u ** 4 + 10 * u ** 3)
        : distance > weapon.range ? 0 : weapon.damage * damageFalloff(weapon, distance);
      assert.ok(Math.abs(damageAtDistance(weapon, distance) - expected) < 1e-9);
    }
  }
  const stats = comparisonStats(WEAPONS, WORLD.armory);
  assert.equal(stats.length, Object.keys(WEAPONS).length);
  for (const stat of stats.filter(stat => stat.weapon.bulletPhysics)) {
    assert.ok(stat.body > 0 && stat.body < stat.weapon.damage);
    assert.ok(Math.abs(stat.body - stat.weapon.damage * damageFalloff(stat.weapon, 3)) < 1e-9);
  }
  assert.equal(stats.find(item => item.id === 'shotgun').totalPerShot, stats.find(item => item.id === 'shotgun').body * 9);
  assert.equal(stats.find(item => item.id === 'assault').unlockWave, 6);
  assert.ok(stats.find(item => item.id === 'rifle').dps > stats.find(item => item.id === 'assault').dps);
});

test('katana comparison distinguishes its two reaches and cannot invent ammunition or headshot damage', () => {
  const stat = distance => comparisonStats(WEAPONS, WORLD.armory, distance).find(item => item.id === 'katana');
  const close = stat(1);
  assert.ok(close.weapon.melee);
  assert.equal(close.totalStock, 0); assert.equal(close.normalAmmo, 0); assert.equal(close.specialAmmo, 0);
  assert.equal(close.head, null);
  assert.equal(close.attacks.light.damageAtDistance, WEAPONS.katana.attacks.light.damage);
  assert.equal(close.attacks.heavy.damageAtDistance, WEAPONS.katana.attacks.heavy.damage);
  assert.equal(close.attacks.heavy.rpm, 60 / WEAPONS.katana.attacks.heavy.interval);
  const edge = stat((WEAPONS.katana.attacks.light.range + WEAPONS.katana.attacks.heavy.range) / 2);
  assert.equal(edge.inRange, true); assert.equal(edge.attacks.light.inRange, false); assert.equal(edge.attacks.light.damageAtDistance, 0);
  assert.equal(edge.attacks.heavy.inRange, true);
  assert.equal(stat(3).inRange, false);
  assert.throws(() => comparisonStats({ ...WEAPONS, katana: { ...WEAPONS.katana, attacks: null } }), /Invalid melee weapon/);
  assert.throws(() => comparisonStats({ ...WEAPONS, assault: { ...WEAPONS.assault, magazine: 0 } }), /Invalid weapon: assault/);
});

test('comparison refuses missing or malformed live data instead of displaying stale fallback weapons', () => {
  assert.throws(() => comparisonStats(null), /Missing weapons/);
  assert.throws(() => comparisonStats({}), /Invalid weapon/);
  assert.throws(() => comparisonStats({ ...WEAPONS, assault: { ...WEAPONS.assault, damage: null } }), /Invalid weapon: assault/);
  assert.throws(() => comparisonStats(WEAPONS, []), /Missing rack/);
  assert.throws(() => damageAtDistance(WEAPONS.pistol, NaN), /Invalid distance/);
  assert.throws(() => damageAtDistance(WEAPONS.pistol, -1), /Invalid distance/);
});

test('fire axe comparison keeps both reaches, two-target retention, mobility and its own price gate', () => {
  const stat = distance => comparisonStats(WEAPONS, WORLD.armory, distance).find(item => item.id === 'fireaxe');
  const close = stat(1);
  assert.equal(close.price, 600); assert.equal(close.unlockWave, 5); assert.equal(close.movement, 100);
  assert.equal(close.totalStock, 0); assert.equal(close.normalAmmo, 0); assert.equal(close.specialAmmo, 0);
  assert.equal(close.head, null);
  assert.equal(close.attacks.light.damageAtDistance, 160); assert.equal(close.attacks.heavy.damageAtDistance, 320);
  assert.equal(close.attacks.light.maxTargets, 2); assert.equal(close.attacks.heavy.maxTargets, 2);
  assert.equal(close.attacks.light.retention, .75); assert.equal(close.attacks.heavy.retention, .75);
  const edge = stat(1.9);
  assert.equal(edge.attacks.light.inRange, false); assert.equal(edge.attacks.light.damageAtDistance, 0);
  assert.equal(edge.attacks.heavy.inRange, true); assert.equal(edge.attacks.heavy.damageAtDistance, 320);
  assert.equal(stat(4).inRange, false);
});

test('fire axe six scenario columns preserve the complete swing cycle and average both attacks in the weighted score', () => {
  const report = scenarioReport({ fireaxe: WEAPONS.fireaxe }, { samples: 3, shotsPerSample: 1 });
  assert.deepEqual(report.rows.map(row => row.mode), ['light', 'heavy']);
  const sustained = scenarioColumns(report, 'fireaxe'), active = scenarioColumns(report, 'fireaxe', 400, 'active');
  assert.deepEqual(sustained.map(column => column.distance), [0, 4, 12]);
  assert.deepEqual(active.map(column => column.values), sustained.map(column => column.values));
  assert.deepEqual(sustained[1].values, [0, 0]); assert.deepEqual(sustained[2].values, [0, 0]);
  for (const [index, mode] of ['light', 'heavy'].entries()) {
    const profile = WEAPONS.fireaxe.attacks[mode];
    assert.equal(sustained[0].cells[index].cycleTime, profile.duration);
    assert.equal(active[0].cells[index].preparationTime, profile.windup);
    assert.ok(sustained[0].values[index] > 0);
    assert.ok(sustained[0].cells[index].targetsPerShot <= 2);
  }
  const score = weightedWeaponScore(report, 'fireaxe');
  assert.deepEqual(score.distanceWeights, [.25, .5, .25]); assert.deepEqual(score.timingWeights, [.5, .5]);
  assert.ok(Math.abs(score.score - (sustained[0].values[0] + sustained[0].values[1]) / 8) < 1e-9);
});

test('the three sustained columns preserve both katana modes and never convert damage from target HP', () => {
  const report = scenarioReport(WEAPONS, { samples: 3, shotsPerSample: 16 });
  for (const id of Object.keys(WEAPONS)) {
    const columns = scenarioColumns(report, id);
    assert.deepEqual(columns.map(column => column.distance), [0, 4, 12]);
    assert.ok(columns.every(column => column.values.every(value => Number.isFinite(value) && value >= 0)));
  }
  const blade = scenarioColumns(report, 'katana');
  assert.deepEqual(blade[0].cells.map(cell => cell.mode), ['light', 'heavy']);
  assert.ok(blade[0].values.every(value => value > 0));
  assert.deepEqual(blade[1].values, [0, 0]); assert.deepEqual(blade[2].values, [0, 0]);
  const magnum80 = scenarioColumns(report, 'magnum', 80), magnum400 = scenarioColumns(report, 'magnum', 400);
  assert.deepEqual(magnum80, magnum400);
  assert.deepEqual(scenarioColumns(report, 'rifle', 80).map(column => column.values), scenarioColumns(report, 'rifle', 400).map(column => column.values));
  assert.equal(scenarioColumns(null, 'pistol'), null);
  assert.throws(() => scenarioColumns(report, 'missing'), /Missing scenario/);
  assert.throws(() => scenarioColumns(report, 'pistol', 0), /Invalid target HP/);
});

test('the three additional active columns select reload-free rates and retain both blade profiles and physical Magnum damage', () => {
  const report = scenarioReport(WEAPONS, { samples: 3, shotsPerSample: 16 });
  for (const id of Object.keys(WEAPONS)) {
    const sustained = scenarioColumns(report, id), active = scenarioColumns(report, id, 400, 'active');
    assert.deepEqual(active.map(column => column.distance), [0, 4, 12]);
    active.forEach((column, index) => {
      assert.equal(column.timingMode, 'active');
      column.values.forEach((value, mode) => assert.ok(Number.isFinite(value) && value >= sustained[index].values[mode] - 1e-9));
      assert.deepEqual(column.cells.map(cell => cell.targetsPerShot), sustained[index].cells.map(cell => cell.targetsPerShot));
      assert.ok(column.cells.every(cell => cell.reloadTime === 0 && (WEAPONS[id].melee ? cell.preparationTime > 0 : cell.preparationTime === 0)));
    });
  }
  const blade = scenarioColumns(report, 'katana', 400, 'active');
  assert.deepEqual(blade[0].cells.map(cell => cell.mode), ['light', 'heavy']);
  assert.deepEqual(blade[1].values, [0, 0]); assert.deepEqual(blade[2].values, [0, 0]);
  assert.deepEqual(blade.map(column => column.values), scenarioColumns(report, 'katana').map(column => column.values), 'katana keeps preparation in both sets, with no invented faster swing');
  const magnum80 = scenarioColumns(report, 'magnum', 80, 'active');
  const magnum400 = scenarioColumns(report, 'magnum', 400, 'active');
  assert.deepEqual(magnum80, magnum400);
  assert.ok(Math.abs(magnum400[0].values[0] - magnum400[0].cells[0].damagePerShot / WEAPONS.magnum.interval) < 1e-9);
  assert.throws(() => scenarioColumns(report, 'pistol', 400, 'unknown'), /Invalid scenario timing mode/);
  const missing = { ...report, rows: report.rows.map(row => ({ ...row, cells: row.cells.map(({ active, ...cell }) => cell) })) };
  assert.throws(() => scenarioColumns(missing, 'pistol', 400, 'active'), /Missing active scenario/);
});

test('weighted damage follows the requested six weights and averages blade attacks without rounding inputs', () => {
  const profile = (mode, multiplier) => ({ id: 'example', mode, cells: [10, 20, 30].map((rawDps, index) => ({
    rawDps: multiplier * rawDps, active: { rawDps: multiplier * [40, 60, 100][index] },
  })) });
  const report = { scenarios: [0, 4, 12].map(distance => ({ distance })), rows: [profile('light', 1)] };
  // Sustained: 2.5 + 10 + 7.5 = 20; active: 10 + 30 + 25 = 65.
  assert.equal(weightedWeaponScore(report, 'example').score, 42.5);
  report.rows.push(profile('heavy', 2));
  const result = weightedWeaponScore(report, 'example');
  assert.deepEqual(result.profileScores, [42.5, 85]);
  assert.equal(result.score, 63.75);
  assert.deepEqual(result.distanceWeights, [.25, .5, .25]);
  assert.deepEqual(result.timingWeights, [.5, .5]);
  const fractional = { scenarios: report.scenarios, rows: [{ id: 'example', cells:
    [0, 4, 12].map(() => ({ rawDps: 1.4, active: { rawDps: 1.4 } })) }] };
  assert.equal(weightedWeaponScore(fractional, 'example').score, 1.4);
  assert.equal(weightedWeaponScore(null, 'example'), null);
  assert.throws(() => weightedWeaponScore({ ...report, scenarios: [...report.scenarios].reverse() }, 'example'), /contact, 4 m and 12 m/);
  assert.throws(() => weightedWeaponScore(report, 'missing'), /Missing scenario/);
  assert.throws(() => weightedWeaponScore(report, 'example', NaN), /Invalid target HP/);
  assert.throws(() => weightedWeaponScore({ ...fractional, rows: [{ id: 'example', cells: [{ rawDps: NaN }] }] }, 'example'), /Invalid scenario/);
});

test('weighted real-weapon damage is independent of target HP and gives the katana equal light/heavy weight', () => {
  const report = scenarioReport(WEAPONS, { samples: 3, shotsPerSample: 16 });
  for (const id of Object.keys(WEAPONS)) {
    const low = weightedWeaponScore(report, id, 80), normal = weightedWeaponScore(report, id, 400);
    assert.ok(Number.isFinite(normal.score) && normal.score >= 0);
    assert.deepEqual(low, normal);
  }
  const blade = weightedWeaponScore(report, 'katana');
  const contact = scenarioColumns(report, 'katana')[0].values;
  assert.equal(blade.profileScores.length, 2);
  assert.ok(Math.abs(blade.score - (contact[0] + contact[1]) / 8) < 1e-9,
    'only contact reaches a target: 25% contact multiplied by the equal attack average');
});
