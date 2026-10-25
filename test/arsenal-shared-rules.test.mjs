import { WEAPONS, damageFalloff } from '../simulation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMORY, FIRE_INTERVALS, WEAPON_MOVEMENT, MELEE, MELEE_WEAPONS, PICKUPS, MAGNUM_BOSS_DAMAGE, waveBalance } from '../public/rules.js';
import { BOSS_HP, enemyHealth } from '../public/enemies.js';
import { EXPEDITION, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, FUEL_CACHES, SUPPLY_CACHES, farSpawnShare } from '../public/expedition.js';
import { legacyFalloff, longRangeFalloff, penetrationMultiplier } from '../public/ballistics.js';
import { upgradedWeapon, SUPPLY_WAVES, LATE_SUPPLIES } from '../public/weapon-upgrades.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const bullet = { damage: 30, magazine: 30, reserve: 90, pellets: 1, penetrationTargets: 3, penetrationRetention: .65,
  longRangeDamage50: 28, falloff: { start: 20, end: 50, near: 1, far: .8 } };

test('all shipped bullet curves remain positive and continuous beyond their former range boundaries', () => {
  for (const name of ['pistol', 'smg', 'rifle', 'assault', 'minigun', 'shotgun', 'sniper', 'magnum']) {
    const weapon = WEAPONS[name];
    for (const distance of [0, 5, 10, 20, 30, 50, 65, 100]) {
      const value = damageFalloff(weapon, distance);
      assert.ok(value > 0 && value <= 1, name);
      assert.ok(Math.abs(value - damageFalloff(weapon, distance + 1e-5)) < 1e-5, name);
      assert.ok(damageFalloff(weapon, distance + .5) <= value, name);
    }
  }
});

test('physical penetration retains each material loss once, independently of air drag', () => {
  for (const name of ['pistol', 'smg', 'rifle', 'assault', 'minigun', 'shotgun', 'sniper', 'magnum']) {
    const weapon = WEAPONS[name], retention = 1 - weapon.bulletPhysics.transmission;
    for (const distance of [0, 30, 50, 90]) for (let index = 0; index < weapon.penetrationTargets; index++)
      close(penetrationMultiplier(weapon, index, distance), retention ** index);
  }
});

test('small non-stacking supply profiles preserve reserve, cleave and Magnum identity', () => {
  const hammer = { melee: true, damage: MELEE_WEAPONS.hammer.light.damage, attacks: MELEE_WEAPONS.hammer };
  // Only actual attacks are used by the production weapon, not the parent metadata.
  hammer.attacks = { light: MELEE_WEAPONS.hammer.light, heavy: MELEE_WEAPONS.hammer.heavy };
  const sharpened = upgradedWeapon(hammer, 'hammer', 'stone');
  close(sharpened.attacks.light.damage, 330); close(sharpened.attacks.heavy.damage, 990);
  assert.equal(sharpened.attacks.heavy.retention, .5); assert.equal(hammer.attacks.heavy.damage, 900);
  const extended = upgradedWeapon(bullet, 'rifle', { kind: 'extended', level: 1 });
  assert.equal(extended.magazine, 33); assert.equal(extended.reserve, 99, 'the reserve keeps whole extended magazines'); assert.equal(bullet.magazine, 30);
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'extended', level: 8 }).magazine, 54);
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'extended', level: 8 }).reserve, 162);
  const stacked = upgradedWeapon(bullet, 'rifle', { extended: 2, perforating: 8 });
  assert.equal(stacked.magazine, 36); assert.equal(stacked.reserve, 108); assert.equal(stacked.penetrationTargets, 6, 'levels of different bonuses compose');
  // The 3-3-2 ladder (owner, 16 October): nothing before 3, +1 at 3, +2 at 6, +3 at 8.
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'perforating', level: 1 }).penetrationTargets, 3, 'levels 1-2 invest with no effect yet');
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'perforating', level: 2 }).penetrationTargets, 3);
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'perforating', level: 3 }).penetrationTargets, 4);
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'perforating', level: 5 }).penetrationTargets, 4);
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'perforating', level: 6 }).penetrationTargets, 5);
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'perforating', level: 7 }).penetrationTargets, 5);
  assert.equal(upgradedWeapon(bullet, 'rifle', { kind: 'perforating', level: 8 }).penetrationTargets, 6);
  assert.equal(upgradedWeapon({ ...bullet, penetrationTargets: 6 }, 'rifle', { kind: 'perforating', level: 8 }).penetrationTargets, 6);
  const magnum = { ...bullet, oneShot: true, magazine: 6, penetrationTargets: 1 };
  for (const kind of ['stone', 'perforating']) assert.equal(upgradedWeapon(magnum, 'magnum', { kind, level: 8 }), magnum);
  assert.equal(upgradedWeapon(magnum, 'magnum', { kind: 'extended', level: 1 }).magazine, 7, 'every firearm grows, the Magnum included');
  assert.equal(upgradedWeapon(bullet, 'rifle', { extended: 1, stone: 8 }).magazine, 33, 'a melee bonus leaves firearms alone');
  const sniper = { ...bullet, penetrationTargets: 6 };
  assert.equal(upgradedWeapon(sniper, 'sniper', 'perforating'), sniper);
  assert.equal(upgradedWeapon(bullet, 'rifle', 'unknown'), bullet);
});

test('new weapons keep all earlier unlocks and the fixed 6000-HP final boss', () => {
  assert.equal(ARMORY.length, 14);
  assert.equal(ARMORY.find(item => item.weapon === 'fireaxe').price, 600);
  assert.equal(ARMORY.find(item => item.weapon === 'fireaxe').unlockWave, 5);
  assert.equal(ARMORY.find(item => item.weapon === 'magnum').unlockWave, 14);
  assert.equal(ARMORY.find(item => item.weapon === 'rifle').unlockWave, 8);
  assert.equal(ARMORY.find(item => item.weapon === 'hammer').price, 1000);
  assert.equal(ARMORY.find(item => item.weapon === 'sniper').price, 3200);
  assert.equal(MELEE_WEAPONS.katana, MELEE);
  assert.equal(MELEE_WEAPONS.hammer.heavy.windup, .75);
  assert.equal(MELEE_WEAPONS.hammer.heavy.duration, 2.2);
  assert.equal(FIRE_INTERVALS.sniper, 1.25);
  assert.equal(WEAPON_MOVEMENT.rifle, .96); assert.equal(WEAPON_MOVEMENT.assault, 1);
  assert.equal(BOSS_HP, 6 * MAGNUM_BOSS_DAMAGE);
  for (const players of [1, 2, 3, 4]) assert.equal(waveBalance(20, players).bossHp, BOSS_HP);
  assert.equal(enemyHealth(20, 1, 'brute', true), BOSS_HP);
});

test('ammunition fractions remain exact integers including the doubled Gatling boxes and sniper', () => {
  assert.equal(PICKUPS.ammo.minigun, 6); assert.equal(PICKUPS.specialAmmo.minigun, 12);
  assert.equal(PICKUPS.ammo.sniper, 1); assert.equal(PICKUPS.specialAmmo.sniper, 2);
  for (const quantities of [PICKUPS.ammo, PICKUPS.specialAmmo]) for (const amount of Object.values(quantities))
    if (amount > 0) assert.ok(Number.isInteger(PICKUPS.ammoCharge / amount), `${amount} must consume an integer charge`);
});

test('expanded woods preserve close entrances and bonus runs while offering longer fuel and sniper routes', () => {
  assert.deepEqual(EXPEDITION.bounds, { minX: -140, maxX: 140, minZ: -64, maxZ: 64 });
  assert.equal(SPAWN_ENTRIES.length, 8); assert.equal(FAR_SPAWN_ENTRIES.length, 2);
  assert.deepEqual(SUPPLY_CACHES.map(({ x, z }) => [x, z]), [[-16, 10], [15, -11], [-14, -12]]);
  assert.deepEqual(FUEL_CACHES.map(({ x, z }) => [x, z]), [[-125, 36], [125, -36], [-120, -50]]);
  for (const entry of FAR_SPAWN_ENTRIES) assert.ok(Math.hypot(entry.x, entry.z) > 60);
  for (const [wave, share] of [[1, 0], [12, 0], [13, .1], [14, .1], [15, .2], [20, .2]]) assert.equal(farSpawnShare(wave), share);
  assert.deepEqual(SUPPLY_WAVES, Array.from({ length: 17 }, (_, index) => index + 2));
  assert.equal(LATE_SUPPLIES.unlockWave, 15);
  assert.deepEqual(Object.fromEntries(Object.entries(LATE_SUPPLIES.items).map(([id, item]) => [id, item.price])), { revive: 1200, backpack: 1500, grenade: 350, armor: 600, ammo: 700 });
  assert.equal(LATE_SUPPLIES.items.backpack.unlockWave, 10);
});
