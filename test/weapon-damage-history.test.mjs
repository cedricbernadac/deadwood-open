import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { WEAPONS } from '../simulation.mjs';
import { sampleBulletAtDistance } from '../public/ballistics.js';
import { BASELINE_WEAPON_IDS, baselineSample, currentSample, historyCurve } from '../public/weapon-damage-history.js';

const frozen = JSON.parse(await fs.readFile(new URL('../public/weapon-damage-before.json', import.meta.url), 'utf8'));
const before = frozen.weapons;
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('historical data identifies the actual habitual server and includes every weapon', () => {
  assert.equal(frozen.provenance.sourceUrl, 'http://127.0.0.1:3002/world.json');
  assert.match(frozen.provenance.responseSha256, /^[0-9a-f]{64}$/);
  assert.equal(frozen.provenance.sourceFilesClean, true);
  assert.deepEqual(Object.keys(before).sort(), [...BASELINE_WEAPON_IDS].sort());
  assert.equal(Object.values(before).some(weapon => weapon.bulletPhysics || weapon.distanceFade), false);
  assert.equal(before.pistol.range, 60);
  assert.equal(before.smg.range, 30);
  assert.equal(before.sniper.range, 90);
  assert.equal(before.magnum.oneShot, true);
  assert.equal(frozen.specialRules.magnumBossDamage, 1000);
});

test('original pistol segments and exact maximum range are preserved, not intermediate outdoor curves', () => {
  near(baselineSample(before.pistol, 4).damage, 24 * 1.0483870967741935);
  near(baselineSample(before.pistol, 25).damage, 12);
  near(baselineSample(before.pistol, 30).damage, 12);
  near(baselineSample(before.pistol, 40).damage, 10);
  near(baselineSample(before.pistol, 50).damage, 8);
  near(baselineSample(before.pistol, 59.999).damage, 8);
  assert.equal(baselineSample(before.pistol, 60).damage, 0);
  assert.equal(baselineSample(before.pistol, 60).reachable, false);
  assert.equal(baselineSample(before.pistol, 120).damage, 0);
});

test('old SMG cannot reach its nominal 50m falloff, while machinegun uses its original 30m blend anchor', () => {
  near(baselineSample(before.smg, 29.999).damage, 19 * .55);
  assert.equal(baselineSample(before.smg, 30).damage, 0);
  assert.equal(baselineSample(before.smg, 50).damage, 0);
  for (const distance of [30, 40, 50, 64.99]) near(baselineSample(before.rifle, distance).damage, 28);
  near(baselineSample(before.assault, 50).damage, 18);
  near(baselineSample(before.sniper, 89.999).damage, 350);
  assert.equal(baselineSample(before.sniper, 90).damage, 0);
});

test('pump uses the historical smoothstep bonus per pellet and only scales to nine theoretical hits on request', () => {
  const base = before.shotgun.damage * before.shotgun.falloff.near;
  near(baselineSample(before.shotgun, 0).damage, 2 * base);
  near(baselineSample(before.shotgun, 1).damage, 2 * base);
  near(baselineSample(before.shotgun, 2.5).damage, 1.5 * base);
  near(baselineSample(before.shotgun, 4).damage, base);
  near(baselineSample(before.shotgun, 18).damage, 7.2);
  near(baselineSample(before.shotgun, 31).damage, 7.2);
  assert.equal(baselineSample(before.shotgun, 32).damage, 0);
  for (const distance of [0, 2.5, 4, 12, 31, 32]) {
    near(baselineSample(before.shotgun, distance, { shotgunUnit: 'shell' }).damage, baselineSample(before.shotgun, distance).damage * 9);
    near(currentSample(WEAPONS.shotgun, distance, { shotgunUnit: 'shell' }).damage, currentSample(WEAPONS.shotgun, distance).damage * 9);
  }
});

test('Magnum cannot misrepresent the stored 200 as its former zombie damage', () => {
  assert.equal(before.magnum.damage, 200);
  assert.equal(baselineSample(before.magnum, 10).damage, 1000);
  assert.equal(baselineSample(before.magnum, 10, { target: 'ordinary', targetHp: 6400 }).damage, 6400);
  assert.equal(baselineSample(before.magnum, 45, { target: 'ordinary', targetHp: 6400 }).damage, 0);
  near(currentSample(WEAPONS.magnum, 0).damage, 2000, 1e-6);
  assert.equal(currentSample(WEAPONS.magnum, 0, { target: 'ordinary', targetHp: 400 }).damage, 400);
  near(currentSample(WEAPONS.magnum, 0, { target: 'ordinary', targetHp: 6400 }).damage, 2000, 1e-6);
  assert.ok(currentSample(WEAPONS.magnum, 60, { target: 'ordinary', targetHp: 400 }).damage > 0);
});

test('current bullets use the authoritative physical sampler, including the latest assault/minigun speeds', () => {
  assert.equal(WEAPONS.assault.bulletPhysics.muzzleSpeed, 250);
  assert.equal(WEAPONS.minigun.bulletPhysics.muzzleSpeed, 200);
  for (const weapon of Object.values(WEAPONS).filter(weapon => weapon.bulletPhysics)) {
    for (const distance of [0, 4, 12, 30, 50, 90, 250, 1000]) {
      const authoritative = sampleBulletAtDistance(weapon, distance), actual = currentSample(weapon, distance);
      near(actual.damage, authoritative.reachable ? authoritative.damage : 0);
      assert.equal(actual.endDistance, authoritative.endDistance);
      assert.equal(actual.reachable, authoritative.reachable);
    }
  }
});

test('rocket and flame preserve their core strength, smooth their edges, and melee attacks remain unchanged', () => {
  for (const [distance, damage] of [[0, 700], [2, 700], [3, 350], [4, 0], [60, 0]]) {
    assert.equal(baselineSample(before.rocket, distance).damage, damage);
    assert.equal(currentSample(WEAPONS.rocket, distance).damage, damage);
  }
  for (const distance of [0, 4, 5, 5.01, 5.5, 6]) {
    const old = baselineSample(before.flamethrower, distance);
    assert.equal(old.metric, 'dps');
    assert.equal(old.damage, distance <= 5 ? 50 : 0);
    const current = currentSample(WEAPONS.flamethrower, distance);
    assert.equal(current.metric, 'dps');
    assert.equal(current.endDistance, 6);
    if (distance <= 5) assert.equal(current.damage, 50);
    else if (distance === 5.5) assert.equal(current.damage, 25);
    else if (distance === 6) assert.equal(current.damage, 0);
    else assert.ok(current.damage > 49 && current.damage < 50);
  }
  for (const id of ['bat', 'katana', 'hammer', 'fireaxe']) for (const attack of ['light', 'heavy']) {
    const profile = before[id].attacks[attack];
    for (const distance of [1, profile.range, profile.range + .01]) {
      const old = baselineSample(before[id], distance, { attack });
      assert.equal(old.damage, distance <= profile.range ? profile.damage : 0);
      assert.deepEqual(currentSample(WEAPONS[id], distance, { attack }), old);
    }
  }
});

test('drawing retains real old cutoff jumps and stops new flight curves with positive remaining energy', () => {
  const points = historyCurve(before.pistol, { version: 'before', maxDistance: 120 });
  const cutoff = points.filter(point => point.distance === 60);
  assert.equal(cutoff.length, 2);
  near(cutoff[0].damage, 8);
  assert.equal(cutoff[1].damage, 0);
  assert.equal(points.at(-1).damage, 0);
  for (const weapon of Object.values(WEAPONS).filter(weapon => weapon.bulletPhysics)) {
    const curve = historyCurve(weapon, { maxDistance: 1000 });
    near(curve.at(-1).distance, sampleBulletAtDistance(weapon, 0).endDistance);
    assert.ok(curve.at(-1).damage > 0, weapon.name + ' has an invented zero endpoint');
    assert.ok(curve.every(point => Number.isFinite(point.damage) && point.damage >= 0));
  }
});

test('invalid inputs cannot turn missing or malformed profiles into apparently valid curves', () => {
  for (const sample of [baselineSample, currentSample]) {
    assert.throws(() => sample(null, 1), /Invalid weapon/);
    for (const distance of [-1, NaN, Infinity]) assert.throws(() => sample(WEAPONS.pistol, distance), /Invalid distance/);
    assert.throws(() => sample(WEAPONS.pistol, 1, { shotgunUnit: 'anything' }), /Invalid history options/);
    assert.throws(() => sample(WEAPONS.magnum, 1, { targetHp: 0 }), /Invalid history options/);
  }
  assert.throws(() => currentSample(before.pistol, 1), /Missing current bullet physics/);
  assert.throws(() => historyCurve(WEAPONS.pistol, { version: 'unknown' }), /Invalid curve inputs/);
});
