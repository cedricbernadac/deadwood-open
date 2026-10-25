import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { PICKUPS } from '../public/rules.js';

function fixture() {
  const events = [];
  const simulation = new RoomSimulation('SUPPLY', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start(player.id);
  simulation.phase = 'wave';
  simulation.toSpawn = 1;
  simulation.spawnTimer = 999;
  Object.assign(player, { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 });
  return { simulation, player, events };
}
function box(simulation, overrides = {}) {
  const pickup = { id: 'supply-' + simulation.nextPickupId++, kind: 'ammo', x: 0, y: 0, z: 2,
    amount: 1, special: false, expiresAt: simulation.time + PICKUPS.lifetime, ...overrides };
  simulation.pickups.set(pickup.id, pickup);
  return pickup;
}
function full(name, missing = 0) {
  return { ammo: WEAPONS[name].magazine, reserve: WEAPONS[name].reserve - missing };
}
const pickupEvents = events => events.filter(event => event.event === 'pickup');

test('one missing rifle round consumes exactly one tenth of a legacy shared box', () => {
  const { simulation, player, events } = fixture();
  player.weapon = 'rifle';
  player.inventory = { pistol: full('pistol'), rifle: full('rifle', 1) };
  const pickup = box(simulation);
  assert.equal(pickup.charge, undefined);
  assert.equal(simulation.snapshot().pickups[0].fill, 1);
  simulation.collectPickups();
  assert.equal(pickup.charge, 702);
  assert.equal(simulation.snapshot().pickups[0].fill, .9);
  assert.deepEqual(pickupEvents(events).at(-1).ammo, [{ weapon: 'rifle', amount: 1 }]);
  assert.equal(pickupEvents(events).at(-1).remainingFill, .9);
  assert.equal(pickupEvents(events).at(-1).removed, false);
  const untouched = structuredClone(pickup);
  simulation.collectPickups();
  assert.deepEqual(pickup, untouched, 'Both full stocks cannot consume the remainder');
  assert.equal(pickupEvents(events).length, 1);
});

test('paired refills consume the larger fraction once, never a fresh budget for each carried weapon', () => {
  for (const [missingPistol, missingRifle, expectedCharge] of [[2, 5, 390], [2, 10, 0]]) {
    const { simulation, player, events } = fixture();
    player.inventory = { pistol: full('pistol', missingPistol), rifle: full('rifle', missingRifle) };
    const pickup = box(simulation, { charge: PICKUPS.ammoCharge });
    simulation.collectPickups();
    assert.deepEqual(pickupEvents(events).at(-1).ammo,
      [{ weapon: 'pistol', amount: missingPistol }, { weapon: 'rifle', amount: missingRifle }]);
    assert.equal(pickup.charge, expectedCharge);
    assert.equal(simulation.pickups.has(pickup.id), expectedCharge > 0);
    assert.equal(pickupEvents(events).at(-1).removed, expectedCharge === 0);
  }
});

test('another survivor can take the conserved remainder in the same authoritative scan', () => {
  const { simulation, player, events } = fixture();
  player.inventory = { pistol: full('pistol', 1) };
  const teammate = simulation.addPlayer('b');
  Object.assign(teammate, { x: .3, y: 0, z: 2, weapon: 'rifle', inventory: { rifle: { ammo: 0, reserve: 0 } } });
  const pickup = box(simulation, { charge: PICKUPS.ammoCharge });
  simulation.collectPickups();
  assert.equal(player.inventory.pistol.ammo + player.inventory.pistol.reserve, 48);
  assert.equal(teammate.inventory.rifle.reserve, 7, 'Only floor(75% × 10) rounds remain for the second collector');
  assert.equal(simulation.pickups.has(pickup.id), false, 'The final 39 units cannot supply any weapon');
  assert.deepEqual(pickupEvents(events).map(event => [event.id, event.remainingFill, event.removed]),
    [['a', .75, false], ['b', 0, true]]);
  assert.ok(195 + 7 * 78 <= PICKUPS.ammoCharge);
  simulation.collectPickups();
  assert.equal(teammate.inventory.rifle.reserve, 7);
  assert.equal(pickupEvents(events).length, 2);
});

test('the same survivor can return after real shots but cannot regenerate one box indefinitely', () => {
  const { simulation, player, events } = fixture();
  const pickup = box(simulation, { charge: PICKUPS.ammoCharge });
  const expiry = pickup.expiresAt;
  for (let shot = 1; shot <= 4; shot++) {
    simulation.time = Math.max(simulation.time, player.shotAfter);
    assert.equal(simulation.shoot(player.id), true);
    simulation.collectPickups();
    assert.equal(player.inventory.pistol.ammo + player.inventory.pistol.reserve, 48);
    assert.equal(pickup.expiresAt, expiry, 'Returning never extends the original lifetime');
    assert.equal(pickup.charge, 780 - shot * 195);
  }
  assert.equal(simulation.pickups.has(pickup.id), false);
  assert.equal(pickupEvents(events).reduce((sum, event) => sum + event.ammo[0].amount, 0), 4);
  simulation.time = player.shotAfter;
  simulation.shoot(player.id);
  simulation.collectPickups();
  assert.equal(player.inventory.pistol.ammo + player.inventory.pistol.reserve, 47);
});

test('a partial special box keeps a finite transferable budget and never creates a Magnum round from a fraction', () => {
  const { simulation, player, events } = fixture();
  player.weapon = 'minigun';
  player.inventory = { minigun: full('minigun', 1), magnum: full('magnum') };
  const pickup = box(simulation, { special: true });
  simulation.collectPickups();
  assert.equal(pickup.charge, 715);
  assert.deepEqual(pickupEvents(events).at(-1).ammo, [{ weapon: 'minigun', amount: 1 }]);
  player.inventory = { magnum: { ammo: 0, reserve: 0 } };
  player.weapon = 'magnum';
  simulation.collectPickups();
  assert.equal(player.inventory.magnum.reserve, 0);
  assert.equal(pickup.charge, 715);
  player.inventory = { minigun: { ammo: 0, reserve: 0 } };
  player.weapon = 'minigun';
  simulation.collectPickups();
  assert.equal(player.inventory.minigun.reserve, 11);
  assert.equal(simulation.pickups.has(pickup.id), false);
  assert.equal(pickupEvents(events).flatMap(event => event.ammo).reduce((sum, item) => sum + item.amount, 0), 12);
});

test('a full special box supplies twelve Gatling rounds and one Magnum round and respects total caps', () => {
  const { simulation, player, events } = fixture();
  player.weapon = 'minigun';
  player.inventory = { minigun: { ammo: 0, reserve: 0 }, magnum: { ammo: 0, reserve: 0 } };
  box(simulation, { special: true });
  simulation.collectPickups();
  assert.deepEqual(player.inventory, { minigun: { ammo: 0, reserve: 12 }, magnum: { ammo: 0, reserve: 1 } });
  assert.equal(pickupEvents(events).at(-1).removed, true);
  assert.equal(simulation.pickups.size, 0);
  player.inventory = { minigun: full('minigun'), magnum: full('magnum') };
  const fullBox = box(simulation, { special: true, charge: 780 });
  const before = structuredClone(player.inventory);
  simulation.collectPickups();
  assert.deepEqual(player.inventory, before);
  assert.equal(fullBox.charge, 780);
  assert.equal(pickupEvents(events).length, 1);
});

test('partial supply expires at its original server deadline and remains unchanged in frozen phases', () => {
  const { simulation, player, events } = fixture();
  player.inventory = { pistol: full('pistol', 1) };
  const pickup = box(simulation, { charge: 780 });
  simulation.collectPickups();
  assert.equal(pickup.charge, 585);
  const expiresAt = pickup.expiresAt;
  for (const phase of ['lobby', 'extraction', 'victory', 'gameover']) {
    simulation.phase = phase;
    player.inventory.pistol.reserve--;
    const inventory = structuredClone(player.inventory);
    simulation.collectPickups();
    assert.deepEqual(player.inventory, inventory);
    assert.equal(pickup.charge, 585);
  }
  assert.equal(pickupEvents(events).length, 1);
  simulation.phase = 'wave';
  simulation.time = expiresAt;
  simulation.collectPickups();
  assert.equal(simulation.pickups.size, 0);
});

test('health drops every twenty-fifth kill without replacing cash or ammunition guarantees', () => {
  const { simulation, player } = fixture();
  Object.assign(player, { x: -7, z: 4 });
  for (let killed = 1; killed <= 50; killed++) {
    simulation.dropZombieLoot({ x: 0, y: 0, z: 2 }, 18);
    const pickups = [...simulation.pickups.values()];
    assert.equal(pickups.filter(pickup => pickup.kind === 'points').length, killed);
    assert.equal(pickups.filter(pickup => pickup.kind === 'ammo').length, Math.floor(killed / 5));
    assert.equal(pickups.filter(pickup => pickup.kind === 'health').length, Math.floor(killed / 25));
    assert.ok(pickups.filter(pickup => pickup.kind === 'ammo').every(pickup => pickup.charge === 780));
  }
  const health = simulation.snapshot().pickups.filter(pickup => pickup.kind === 'health');
  assert.equal(health.length, 2);
  assert.ok(health.every(pickup => pickup.amount === 100 && pickup.expiresIn === 90));
  assert.equal(simulation.ammoDrops, 10);
  simulation.tick(0);
  assert.equal([...simulation.pickups.values()].filter(pickup => pickup.kind === 'health').length, 2, 'No roll is repeated by a later tick');
});

test('a medkit fully heals one nearby hurt survivor, leaves full players alone and never revives', () => {
  const { simulation, player, events } = fixture();
  const pickup = box(simulation, { kind: 'health', amount: 100 });
  simulation.collectPickups();
  assert.equal(simulation.pickups.has(pickup.id), true);
  assert.equal(pickupEvents(events).length, 0);
  for (const state of [{ hp: 0, downed: true, alive: true }, { hp: 0, downed: false, alive: false }]) {
    Object.assign(player, state);
    simulation.collectPickups();
    assert.equal(player.hp, 0);
    assert.equal(simulation.pickups.has(pickup.id), true);
  }
  Object.assign(player, { hp: 100, downed: false, alive: true });
  const teammate = simulation.addPlayer('b');
  Object.assign(teammate, { x: .3, y: 0, z: 2, hp: 17 });
  simulation.collectPickups();
  assert.equal(player.hp, 100);
  assert.equal(teammate.hp, 100);
  assert.equal(simulation.pickups.has(pickup.id), false);
  assert.deepEqual(pickupEvents(events).map(event => [event.id, event.healed, event.removed]), [['b', 83, true]]);
  assert.deepEqual(pickupEvents(events).at(-1).ammo, []);
});

test('medkits use the same walls, floors, range and frozen-state rules as other loot', () => {
  for (const scenario of ['floor', 'wall', 'boards', 'distance', 'extraction', 'victory', 'gameover']) {
    const { simulation, player, events } = fixture();
    player.hp = 1;
    const pickup = box(simulation, { kind: 'health', amount: 100 });
    if (scenario === 'floor') pickup.y = WORLD.loftY;
    if (scenario === 'wall') { Object.assign(player, { x: 2, z: -5.5 }); Object.assign(pickup, { x: 2, z: -6.5 }); }
    if (scenario === 'boards') { player.z = -5.5; pickup.z = -6.5; }
    if (scenario === 'distance') pickup.x = PICKUPS.reach + .01;
    if (['extraction', 'victory', 'gameover'].includes(scenario)) simulation.phase = scenario;
    simulation.collectPickups();
    assert.equal(player.hp, 1, scenario);
    assert.equal(simulation.pickups.has(pickup.id), true, scenario);
    assert.equal(pickupEvents(events).length, 0, scenario);
  }
  const { simulation, player } = fixture();
  player.hp = 1;
  const expired = box(simulation, { kind: 'health', amount: 100 });
  simulation.time = expired.expiresAt;
  simulation.collectPickups();
  assert.equal(player.hp, 1);
  assert.equal(simulation.pickups.size, 0);
});
