import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { upgradedWeapon, reinforcedDamagePercent } from '../public/weapon-upgrades.js';
import { describeSituation } from '../companions/situation.mjs';

// Munitions renforcées (owner, 16 October): +15% of the weapon's base damage
// every two levels — 0/15/15/30/30/45/45/60 — one multiplier on the base
// damage, composing with perforating and extended rounds, the piercing
// falloff untouched. Bullet weapons (shotgun and sniper included), never
// blades, flames, explosives or the exempt golden Magnum.
const bullet = { magazine: 30, reserve: 90, damage: 100, penetrationTargets: 3 };

function room(wave = 6) {
  const sim = new RoomSimulation('REINF', { random: () => .5 });
  const a = sim.addPlayer('a', 'Alice');
  sim.addPlayer('b', 'Bob'); // two survivors: the west and east doors stay unsealed
  sim.phase = 'wave'; sim.wave = wave - 1; sim.beginWave();
  sim.toSpawn = 0; sim.spawnWarnings.clear(); sim.zombies.clear();
  return { sim, a };
}
const equip = (player, weapons, active = weapons[0]) => {
  player.inventory = Object.fromEntries(weapons.map(id => [id, { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve }]));
  player.weapon = active;
};
const at = (player, target) => Object.assign(player, { x: target.x, y: target.y ?? 0, z: target.z, yaw: 0, grounded: true, interactAfter: 0 });

test('the ladder reads 0/15/15/30/30/45/45/60 percent of the base damage', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(reinforcedDamagePercent), [0, 15, 15, 30, 30, 45, 45, 60]);
  for (const [level, percent] of [[1, 0], [2, 15], [5, 30], [8, 60]]) {
    assert.ok(Math.abs(upgradedWeapon(bullet, 'rifle', { kind: 'reinforced', level }).damage - 100 * (1 + percent / 100)) < 1e-9, `level ${level}`);
  }
});

test('bullet weapons only: shotgun and sniper included, never blades, flames, explosives or the Magnum', () => {
  for (const id of ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'assault', 'sniper']) {
    assert.ok(upgradedWeapon({ ...bullet }, id, { kind: 'reinforced', level: 2 }).damage > bullet.damage, `${id} gains`);
  }
  const excluded = [
    [{ ...bullet, oneShot: true }, 'magnum'],
    [{ ...bullet, upgradeExempt: true }, 'magnum'],
    [{ ...bullet, fuel: true }, 'flamethrower'],
    [{ ...bullet, explosive: true }, 'rocket'],
    [{ ...bullet, melee: true, attacks: { light: { damage: 10, maxTargets: 1 } } }, 'katana'],
  ];
  for (const [weapon, id] of excluded) assert.equal(upgradedWeapon(weapon, id, { kind: 'reinforced', level: 8 }), weapon, `${id} untouched`);
});

test('it composes with perforating and extended rounds, never compounding with itself', () => {
  const all = upgradedWeapon(bullet, 'rifle', { extended: 2, perforating: 8, reinforced: 4 });
  assert.equal(all.magazine, 36, 'the extended magazine still grows');
  assert.equal(all.penetrationTargets, 6, 'the piercing ladder still applies');
  assert.ok(Math.abs(all.damage - 130) < 1e-9, 'one +30% multiplier on the base damage');
  // No successive multiplication between levels: level 4 is exactly +30%,
  // not +15% applied twice (1.15 x 1.15 would be 132.25).
  assert.notEqual(Math.round(upgradedWeapon(bullet, 'rifle', { kind: 'reinforced', level: 4 }).damage), 132);
});

test('the crate offers it and the server raises the real weapon damage', () => {
  const { sim, a } = room();
  equip(a, ['rifle', 'sniper']);
  at(a, sim.supplyCrate);
  assert.equal(sim.claimSupply('a', 'reinforced', sim.supplyCrate.id), true);
  assert.equal(a.bonus.reinforced, 1);
  assert.ok(Math.abs(sim.weaponProfile(a, 'rifle').damage - WEAPONS.rifle.damage) < 1e-9, 'level 1 invests with no gain yet');
  a.bonus.reinforced = 4;
  assert.ok(Math.abs(sim.weaponProfile(a, 'rifle').damage - WEAPONS.rifle.damage * 1.3) < 1e-9, 'the server damage follows the ladder');
  assert.ok(Math.abs(sim.weaponProfile(a, 'sniper').damage - WEAPONS.sniper.damage * 1.3) < 1e-9, 'the sniper gains too');
  // The eligibility of the choice follows the guns carried, like the others.
  for (const [weapons, expected, why] of [
    [['katana'], false, 'a blade alone cannot take it'],
    [['magnum'], false, 'the exempt Magnum cannot'],
    [['flamethrower'], false, 'flames cannot'],
    [['sniper'], true, 'the bolt-action can'],
    [['shotgun'], true, 'the shotgun can'],
  ]) {
    const other = room();
    equip(other.a, weapons);
    at(other.a, other.sim.supplyCrate);
    assert.equal(other.sim.claimSupply('a', 'reinforced', other.sim.supplyCrate.id), expected, why);
  }
});

test('the companions see it with their level, the next gain and may claim it like the others', () => {
  const { sim, a } = room();
  equip(a, ['rifle']);
  sim.doors.find(door => door.id === 'west').boards.fill(0); // the permanent crate is outside to the west, including wave 6
  const seen = describeSituation(sim, 'a');
  const claim = seen.actions.find(action => action.value === 'claim:reinforced');
  assert.ok(claim, 'offered to a rifle carrier');
  assert.match(claim.description, /\+15% damage every two levels, up to \+60%; 0->1/);
  assert.match(seen.text, /reinforced rounds: \+15% base damage every two levels/);
  a.bonus = { reinforced: 5 };
  const next = describeSituation(sim, 'a');
  assert.match(next.actions.find(action => action.value === 'claim:reinforced').description, /5->6/);
  assert.match(next.text, /yours 5 -> 6/);
});
