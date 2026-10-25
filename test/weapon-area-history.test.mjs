import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { WEAPONS } from '../simulation.mjs';
import { GRENADES } from '../public/rules.js';
import { BASELINE_GRENADE, GRENADE_BASELINE_PROVENANCE } from '../public/weapon-area-before.js';
import { baselineSample, currentSample, historyCurve, historyMeanDamage } from '../public/weapon-damage-history.js';
import { blastDamageAtDistance, comparisonStats } from '../public/weapon-comparison.js';

const before = JSON.parse(await fs.readFile(new URL('../public/weapon-damage-before.json', import.meta.url), 'utf8')).weapons;
const grenade = { ...GRENADES, explosive: true };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test('grenade baseline is additive and identifies the habitual server rules without altering the fourteen weapons', () => {
  assert.equal(Object.keys(before).length, 14);
  assert.equal('grenade' in before, false);
  assert.equal(GRENADE_BASELINE_PROVENANCE.sourceUrl, 'http://127.0.0.1:3002/rules.js');
  assert.equal(Object.isFrozen(BASELINE_GRENADE), true);
  assert.deepEqual([BASELINE_GRENADE.damage, BASELINE_GRENADE.innerRadius, BASELINE_GRENADE.radiusDamage], [450, 2, 4]);
});

test('rocket and grenade charts keep the original linear edge and expose the new smooth edge', () => {
  for (const [old, current] of [[before.rocket, WEAPONS.rocket], [BASELINE_GRENADE, grenade]]) {
    for (const distance of [0, 1, 2]) {
      near(baselineSample(old, distance).damage, old.damage);
      near(currentSample(current, distance).damage, old.damage);
    }
    for (const [distance, originalFactor, currentFactor] of [[2.5, .75, .896484375], [3, .5, .5], [3.5, .25, .103515625], [4, 0, 0], [5, 0, 0]]) {
      near(baselineSample(old, distance).damage, old.damage * originalFactor);
      near(currentSample(current, distance).damage, old.damage * currentFactor);
      near(blastDamageAtDistance(current, distance), old.damage * currentFactor);
    }
    near(historyMeanDamage(old, { version: 'before', maxDistance: 4 }), old.damage * .75);
    near(historyMeanDamage(current, { maxDistance: 4 }), old.damage * .75);
  }
});

test('flame selector compares direct, fresh lingering burn and combined rates with the same edge factor', () => {
  for (const [flameMode, full] of [['direct', 50], ['burn', 175], ['total', 225]]) {
    for (const distance of [0, 3, 4, 5]) near(baselineSample(before.flamethrower, distance, { flameMode }).damage, full);
    for (const [distance, factor] of [[0, 1], [4, 1], [5, 1], [5.5, .5], [6, 0], [7, 0]]) {
      const value = currentSample(WEAPONS.flamethrower, distance, { flameMode });
      near(value.damage, full * factor);
      assert.equal(value.metric, 'dps');
    }
    near(historyMeanDamage(WEAPONS.flamethrower, { flameMode, maxDistance: 6 }), full * 5.5 / 6);
  }
  assert.throws(() => currentSample(WEAPONS.flamethrower, 3, { flameMode: 'stored-burning-target' }), /Invalid history options/);
});

test('old flame graph retains its hard cutoff while the current graph joins zero without a false vertical segment', () => {
  const old = historyCurve(before.flamethrower, { version: 'before', maxDistance: 6 }).filter(point => point.distance === 5);
  assert.deepEqual(old.map(point => point.damage), [50, 0]);
  const current = historyCurve(WEAPONS.flamethrower, { maxDistance: 7 });
  assert.deepEqual(current.filter(point => point.distance === 6).map(point => point.damage), [0]);
  assert.equal(current.some(point => point.boundary), false);
  assert.ok(current.some(point => point.distance === 5 && point.damage === 50));
});

test('full comparison flame statistics track the actual direct and newly applied burn attenuation', () => {
  for (const [distance, factor] of [[2, 1], [5, 1], [5.5, .5], [6, 0]]) {
    const flame = comparisonStats(WEAPONS, undefined, distance).find(row => row.id === 'flamethrower');
    near(flame.flameScale, factor);
    near(flame.body, WEAPONS.flamethrower.damage * factor);
  }
});
