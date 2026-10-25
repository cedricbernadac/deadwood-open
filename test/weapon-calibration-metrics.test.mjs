import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { WEAPONS } from '../simulation.mjs';
import { baselineSample, currentSample, historyMeanDamage } from '../public/weapon-damage-history.js';

const before = JSON.parse(await fs.readFile(new URL('../public/weapon-damage-before.json', import.meta.url), 'utf8')).weapons;
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('continuous old SMG mean gives no weight to its strict 30 m cutoff endpoint', () => {
  const nearDamage = before.smg.damage * before.smg.falloff.near;
  const farDamage = before.smg.damage * before.smg.falloff.far;
  const expected = (6 * nearDamage + 14 * (nearDamage + farDamage) / 2 + 10 * farDamage) / 30;
  assert.equal(baselineSample(before.smg, 30).damage, 0);
  near(historyMeanDamage(before.smg, { version: 'before' }), expected);
  near(historyMeanDamage(before.smg, { version: 'before', maxDistance: 60 }), expected / 2);
  near(historyMeanDamage(before.smg, { version: 'before', minDistance: 29, maxDistance: 31 }), farDamage / 2);
});

test('continuous old pump mean integrates the proximity smoothstep and far plateau', () => {
  const nearDamage = before.shotgun.damage * before.shotgun.falloff.near;
  const farDamage = before.shotgun.damage * before.shotgun.falloff.far;
  const expected = (nearDamage * (2 + 3 * 1.5 + 2) + 12 * (nearDamage + farDamage) / 2 + 12 * farDamage) / 30;
  near(historyMeanDamage(before.shotgun, { version: 'before' }), expected);
  near(historyMeanDamage(before.shotgun, { version: 'before', shotgunUnit: 'shell' }), expected * 9);
});

test('synthetic exponential means agree with their independent integral, including shortened flight', () => {
  for (const original of Object.values(WEAPONS).filter(item => item.bulletPhysics)) {
    const weapon = { ...original, damageCurve: undefined, bulletPhysics: { ...original.bulletPhysics, damageCurve: undefined } };
    const rate = 2 * weapon.bulletPhysics.drag, end = currentSample(weapon, 0).endDistance;
    for (const [minDistance, maxDistance] of [[0, 30], [5, 20], [0, end + 100], [end + 1, end + 2]]) {
      const upper = Math.min(end, maxDistance);
      const expected = upper <= minDistance ? 0 : rate > 0
        ? weapon.damage * Math.exp(-rate * minDistance) * -Math.expm1(-rate * (upper - minDistance)) / rate / (maxDistance - minDistance)
        : weapon.damage * (upper - minDistance) / (maxDistance - minDistance);
      near(historyMeanDamage(weapon, { minDistance, maxDistance }), expected, 1e-7);
    }
  }
});

test('a zero-drag physical curve remains constant within its flight horizon', () => {
  const weapon = { ...WEAPONS.pistol, damage: 42, damageCurve: undefined,
    bulletPhysics: { ...WEAPONS.pistol.bulletPhysics, drag: 0, damageCurve: undefined } };
  near(historyMeanDamage(weapon), 42);
  near(historyMeanDamage(weapon, { minDistance: 5, maxDistance: 25 }), 42);
});

test('rational squared damage means agree with the independent arctangent integral', () => {
  for (const weapon of Object.values(WEAPONS).filter(item => item.damageCurve?.power === 2)) {
    const length = weapon.damageCurve.halfDistance, end = currentSample(weapon, 0).endDistance;
    for (const [minDistance, maxDistance] of [[0, 30], [5, 20], [0, end + 100], [end + 1, end + 2]]) {
      const upper = Math.min(end, maxDistance);
      const expected = upper <= minDistance ? 0
        : weapon.damage * length * (Math.atan(upper / length) - Math.atan(minDistance / length)) / (maxDistance - minDistance);
      near(historyMeanDamage(weapon, { minDistance, maxDistance }), expected, 1e-7);
    }
  }
});

test('ordinary Magnum means represent capped HP removed rather than stored old damage', () => {
  near(historyMeanDamage(before.magnum, { version: 'before' }), 1000);
  near(historyMeanDamage(before.magnum, { version: 'before', target: 'ordinary', targetHp: 400 }), 400);
  near(historyMeanDamage(WEAPONS.magnum, { target: 'ordinary', targetHp: 400 }), 400);
  const weapon = { ...WEAPONS.magnum, damage: 2000, bulletPhysics: { ...WEAPONS.magnum.bulletPhysics, drag: .05 } };
  const targetHp = 1000, crossing = Math.log(2) / .1;
  const expected = (targetHp * crossing + (targetHp - 2000 * Math.exp(-.1 * 30)) / .1) / 30;
  near(historyMeanDamage(weapon, { target: 'ordinary', targetHp }), expected, 1e-6);
});

test('current shell units scale the continuous per-pellet mean exactly', () => {
  near(historyMeanDamage(WEAPONS.shotgun, { shotgunUnit: 'shell' }), historyMeanDamage(WEAPONS.shotgun) * WEAPONS.shotgun.pellets);
});

test('invalid intervals or versions cannot appear as valid calibration means', () => {
  for (const options of [{ version: 'other' }, { minDistance: -1 }, { minDistance: 30 }, { maxDistance: 0 }, { maxDistance: Infinity }, { minDistance: NaN }]) {
    assert.throws(() => historyMeanDamage(WEAPONS.pistol, options), /Invalid mean inputs/);
  }
  assert.throws(() => historyMeanDamage(before.pistol), /Missing current bullet physics/);
});
