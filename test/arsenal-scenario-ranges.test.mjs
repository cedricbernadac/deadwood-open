import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioShot, scenarioReport } from '../public/weapon-scenarios.js';
import { damageAtDistance, scenarioColumns } from '../public/weapon-comparison.js';
import { WEAPONS } from '../simulation.mjs';
import { BOSS_HP } from '../public/rules.js';
import { penetrationMultiplier } from '../public/ballistics.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const body = (id, distance) => ({ id, x: 0, y: 0, z: -distance - .32, kind: 'walker', scale: 1 });

test('long-distance scenario rays use current smooth damage and penetration at every body distance', () => {
  const targets = Array.from({ length: 7 }, (_, index) => body(String(index), 50 + index * 1.5));
  for (const id of ['rifle', 'sniper']) {
    const weapon = { ...WEAPONS[id], spread: 0 }, result = scenarioShot(weapon, { targets });
    const expected = targets.slice(0, weapon.penetrationTargets).reduce((sum, target, index) => {
      const distance = 50 + index * 1.5;
      return sum + damageAtDistance(weapon, distance) * penetrationMultiplier(weapon, index, distance);
    }, 0);
    close(result.damage, expected);
    assert.equal(result.targetsHit, weapon.penetrationTargets);
    assert.ok(damageAtDistance(weapon, 91) > 0, 'no former hard range cutoff');
    assert.ok(damageAtDistance(weapon, 91) < damageAtDistance(weapon, 50));
  }
});

test('Magnum throughput is finite damage independent of selected target HP, in both timing modes', () => {
  const magnum = { ...WEAPONS.magnum, spread: 0 }, targets = [body('boss', 2)];
  const expected = damageAtDistance(magnum, 2);
  assert.ok(expected > 1000 && expected < 2000);
  for (const targetHp of [80, 1400, BOSS_HP]) close(scenarioShot(magnum, { targets, targetHp }).damage, expected);
  const ordinaryReport = scenarioReport({ magnum }, { samples: 1, shotsPerSample: 1 });
  const bossReport = scenarioReport({ magnum }, { samples: 1, shotsPerSample: 1, targetHp: BOSS_HP });
  for (const mode of ['sustained', 'active']) {
    const ordinary = scenarioColumns(ordinaryReport, 'magnum', 80, mode);
    const boss = scenarioColumns(bossReport, 'magnum', BOSS_HP, mode);
    ordinary.forEach((column, index) => close(column.values[0], boss[index].values[0]));
  }
  close(scenarioColumns(bossReport, 'magnum', BOSS_HP, 'active')[0].values[0], damageAtDistance(magnum, .25) / magnum.interval);
});
