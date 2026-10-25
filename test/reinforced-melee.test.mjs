import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { upgradedWeapon, reinforcedMeleeTargets } from '../public/weapon-upgrades.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const weapons = ['katana', 'hammer', 'bat', 'fireaxe'];

test('reinforced weapons keep base profiles immutable and compose with other bonuses in every carried format', () => {
  for (const id of weapons) {
    const base = WEAPONS[id], before = structuredClone(base);
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const extra = [0, 0, 0, 1, 1, 1, 1, 2][level - 1];
      assert.equal(reinforcedMeleeTargets(level), extra);
      for (const bonus of [{ kind: 'stone', level }, { stone: level }, { stone: level, extended: 8, perforating: 8 }]) {
        const profile = upgradedWeapon(base, id, bonus);
        assert.equal(profile.penetrationTargets, before.penetrationTargets + extra);
        for (const mode of ['light', 'heavy']) {
          const original = before.attacks[mode], attack = profile.attacks[mode];
          close(attack.damage, original.damage * (1 + level * .1));
          assert.deepEqual({ ...attack, damage: original.damage, maxTargets: original.maxTargets }, original);
          assert.equal(attack.maxTargets, original.maxTargets + extra);
        }
      }
    }
    assert.deepEqual(base, before);
    assert.deepEqual(upgradedWeapon(base, id, 'stone'), upgradedWeapon(base, id, { stone: 1 }));
  }
  assert.equal(upgradedWeapon(WEAPONS.rifle, 'rifle', { stone: 8 }), WEAPONS.rifle);
});

test('authoritative light and heavy swings gain victims at 4 and 8, with unchanged retention, arc, range and cover', () => {
  for (const id of weapons) for (const mode of ['light', 'heavy']) for (const level of [3, 4, 7, 8]) {
    const events = [];
    const sim = new RoomSimulation('RENFOR', { practice: true, random: () => .5, onEvent: event => events.push(event) });
    const player = sim.addPlayer('a'); sim.zombies.clear();
    Object.assign(player, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon: id,
      inventory: { [id]: { ammo: 0, reserve: 0 } }, bonus: { stone: level } });
    const target = (name, options = {}) => {
      const zombie = { id: name, x: 12, y: 0, z: 6.7, yaw: 0, hp: 10000, maxHp: 10000,
        kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: true, ...options };
      sim.zombies.set(name, zombie); return zombie;
    };
    const victims = Array.from({ length: 6 }, (_, index) => target('front'+index, { z: 6.7-index*.025 }));
    const excluded = [target('rear', { z: 9.5 }), target('far', { z: 3 }), target('side', { x: 15, z: 8 })];
    const base = WEAPONS[id].attacks[mode], count = base.maxTargets + (level >= 8 ? 2 : level >= 4 ? 1 : 0);
    assert.equal(sim.shoot('a', 0, mode), true);
    sim.time = player.pendingMelee.impactAt + .001; sim.updateMelee();
    const hit = events.find(event => event.event === 'melee-hit');
    assert.equal(hit.hits, count, `${id}/${mode}/${level}`);
    victims.forEach((zombie, index) => close(10000-zombie.hp, index<count ? base.damage*(1+.1*level)*base.retention**index : 0));
    excluded.forEach(zombie => assert.equal(zombie.hp, 10000));
    // A high-level swing still cannot reach through an interior wall.
    sim.zombies.clear(); Object.assign(player, { x: -1, z: -1.3, shootAfter: 0, meleeUntil: 0 });
    const covered = target('covered', { x: -1, z: -2.7 });
    sim.time += 10;
    assert.equal(sim.shoot('a', 0, mode), true);
    sim.time = player.pendingMelee.impactAt + .001; sim.updateMelee();
    assert.equal(covered.hp, 10000);
  }
});
