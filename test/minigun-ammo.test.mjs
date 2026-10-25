import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { ARMORY, PICKUPS } from '../public/rules.js';

function room() {
  const simulation = new RoomSimulation('AMMO25', { random: () => .5 });
  const player = simulation.addPlayer('a');
  simulation.start(player.id);
  simulation.phase = 'wave';
  simulation.wave = ARMORY.find(crate => crate.weapon === 'minigun').unlockWave;
  simulation.toSpawn = 1;
  simulation.spawnTimer = 999;
  return { simulation, player };
}

test('buying the Gatling grants two finite 75-round drums without changing the pistol', () => {
  const { simulation, player } = room();
  const rack = ARMORY.find(crate => crate.weapon === 'minigun');
  const pistol = structuredClone(player.inventory.pistol);
  Object.assign(player, { points: rack.price, x: rack.x + Math.sin(rack.facing) * 1.1,
    y: rack.y, z: rack.z + Math.cos(rack.facing) * 1.1 });
  assert.equal(simulation.buyWeapon(player.id, rack.id), true);
  assert.equal(player.points, 0);
  assert.deepEqual(player.inventory.minigun, { ammo: 75, reserve: 75 });
  assert.deepEqual(player.inventory.pistol, pistol);
  const snapshot = simulation.snapshot().players.find(entry => entry.id === player.id);
  assert.equal(snapshot.ammo, 75);
  assert.equal(snapshot.magazine, 75);
  assert.equal(snapshot.reserve, 75);
  assert.deepEqual(snapshot.weapons.find(entry => entry.weapon === 'minigun'), {
    id: 'minigun', weapon: 'minigun', ammo: 75, reserve: 75, magazine: 75, reserveCapacity: 75, equipped: true,
  });

  player.inventory.minigun.ammo = 25;
  assert.equal(simulation.reload(player.id), true);
  simulation.time = player.reloadUntil;
  simulation.tick(0);
  assert.deepEqual(player.inventory.minigun, { ammo: 75, reserve: 25 }, 'Reloading transfers exactly the 50 missing rounds and conserves the remaining reserve');
  assert.equal(simulation.reload(player.id), false);
  player.inventory.minigun.ammo = 0;
  assert.equal(simulation.reload(player.id), true);
  simulation.time = player.reloadUntil;
  simulation.tick(0);
  assert.deepEqual(player.inventory.minigun, { ammo: 25, reserve: 0 }, 'A depleted stock cannot produce another full drum for free');
  assert.equal(simulation.reload(player.id), false);
});

test('the larger Gatling stock obeys a total cap of 150 and leaves unused pickup charge on the floor', () => {
  const { simulation, player } = room();
  Object.assign(player, { x: 0, y: 0, z: 2, weapon: 'minigun',
    inventory: { minigun: { ammo: 75, reserve: 74 } } });
  const pickup = { id: 'cap', kind: 'ammo', special: false, x: 0, y: 0, z: 2,
    expiresAt: simulation.time + PICKUPS.lifetime };
  simulation.pickups.set(pickup.id, pickup);
  simulation.collectPickups();
  assert.deepEqual(player.inventory.minigun, { ammo: 75, reserve: 75 });
  assert.equal(simulation.pickups.size, 1);
  assert.equal(simulation.snapshot().pickups[0].fill, 5 / 6);
  simulation.collectPickups();
  assert.deepEqual(player.inventory.minigun, { ammo: 75, reserve: 75 });
  assert.equal(simulation.pickups.size, 1, 'Full stock must leave the remainder available to a teammate');

  simulation.pickups.clear();
  player.inventory.minigun = { ammo: 0, reserve: 0 };
  for (const special of [false, true]) {
    simulation.pickups.set('supply', { ...pickup, id: 'supply', special, charge: PICKUPS.ammoCharge });
    simulation.collectPickups();
  }
  assert.deepEqual(player.inventory.minigun, { ammo: 0, reserve: 18 }, 'Normal/special boxes still grant 6/12 rounds while preserving the finite 150-round stock');
  assert.equal(player.inventory.minigun.ammo + player.inventory.minigun.reserve < WEAPONS.minigun.magazine + WEAPONS.minigun.reserve, true);
});

test('wave resupply restores the two drums, and the extended magazine now covers every firearm', () => {
  for (const [bonus, magazine, reserve] of [[null, 75, 75], [{ extended: 2 }, 90, 90]]) {
    const { simulation, player } = room();
    Object.assign(player, { weapon: 'minigun', bonus,
      inventory: { pistol: { ammo: 1, reserve: 2 }, minigun: { ammo: 3, reserve: 4 } } });
    assert.equal(simulation.reload(player.id), true);
    assert.ok(player.reloadUntil > simulation.time);
    simulation.finishWave();
    assert.equal(simulation.phase, 'intermission');
    assert.equal(player.reloadUntil, 0);
    assert.deepEqual(player.inventory.minigun, { ammo: magazine, reserve }, 'the between-wave refill hands out full extended loadouts');
    assert.deepEqual(player.inventory.pistol, { ammo: bonus ? 14 : 12, reserve: bonus ? 43 : 36 });
    const equipped = simulation.snapshot().players.find(entry => entry.id === player.id);
    assert.equal(equipped.magazine, magazine); assert.equal(equipped.reserve, reserve);
    assert.equal(equipped.weapons.find(entry => entry.weapon === 'minigun').reserveCapacity, reserve);
    assert.equal(equipped.weapons.find(entry => entry.weapon === 'pistol').magazine, bonus ? 14 : 12, 'the pistol grows too');
  }
});

test('practice refill restores 75+75 and cancels a real reload without modifying the other weapon', () => {
  const simulation = new RoomSimulation('DRUM75', { practice: true, random: () => .5 });
  const player = simulation.addPlayer('a');
  const rocket = structuredClone(player.inventory.rocket);
  assert.equal(simulation.practiceAction(player.id, { action: 'weapon', weapon: 'minigun' }), true);
  assert.deepEqual(player.inventory.minigun, { ammo: 75, reserve: 75 });
  player.inventory.minigun = { ammo: 1, reserve: 2 };
  assert.equal(simulation.reload(player.id), true);
  simulation.time += .25;
  assert.equal(simulation.practiceAction(player.id, { action: 'refill' }), true);
  assert.equal(player.reloadUntil, 0);
  assert.deepEqual(player.inventory.minigun, { ammo: 75, reserve: 75 });
  assert.deepEqual(player.inventory.rocket, rocket);
});
