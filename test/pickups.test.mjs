import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { PICKUPS, EXTERIOR, MAX_WAVES } from '../public/rules.js';

function room() {
  const events = [];
  const simulation = new RoomSimulation('PICKUP', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start('a');
  simulation.phase = 'wave';
  simulation.toSpawn = 1;
  simulation.spawnTimer = 999;
  return { simulation, player, events };
}

function drop(simulation, { x = 0, y = 0, z = 2, amount = 100, kind = 'points', special = false } = {}) {
  const id = `fixture-${simulation.pickups.size}`;
  const pickup = { id, x, y, z, amount, kind, special, expiresAt: simulation.time + PICKUPS.lifetime };
  simulation.pickups.set(id, pickup);
  return pickup;
}

test('death drops fixed cash separately from combat score; first nearby living survivor collects once', () => {
  const { simulation, player, events } = room();
  const teammate = simulation.addPlayer('b');
  Object.assign(player, { x: -4.4, y: 0, z: 2, yaw: 0, pitch: 0 });
  Object.assign(teammate, { x: 2, y: 0, z: 2 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: -4.4, y: 0, z: -2, hp: 70, maxHp: 70 });
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  assert.equal(simulation.pickups.size, 0, 'A wound gives no money pickup yet');
  assert.equal(player.score, Math.floor(70 - zombie.hp), 'the wound scores the health it removed');
  assert.equal(player.points, 0);
  simulation.time = player.shotAfter;
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  const pickup = simulation.snapshot().pickups[0];
  assert.equal(pickup.amount, 24);
  assert.equal(pickup.y, 0);
  assert.ok(pickup.expiresIn > 89.9 && pickup.expiresIn <= 90, 'lifetime starts at impact, before flight settlement ends');
  assert.equal(player.score, 70, 'two shots, the 70 HP it had');
  assert.equal(player.points, 0);
  Object.assign(teammate, { x: -4.2, z: -2 });
  simulation.tick(0);
  assert.equal(teammate.points, 24);
  assert.equal(teammate.score, 0, 'Collecting money does not duplicate performance score');
  assert.equal(player.points, 0);
  assert.equal(simulation.pickups.size, 0);
  simulation.tick(0);
  assert.equal(teammate.points, 24);
  assert.equal(events.filter(event => event.event === 'pickup').length, 1);
});

test('ammo drops exactly every fifth kill, with one special box every fourth ammo box', () => {
  const { simulation } = room();
  for (let killed = 1; killed <= 20; killed++) {
    simulation.dropZombieLoot({ x: 0, y: 0, z: 2 }, 100);
    const boxes = [...simulation.pickups.values()].filter(pickup => pickup.kind === 'ammo');
    assert.equal(boxes.length, Math.floor(killed / 5));
  }
  const boxes = [...simulation.pickups.values()].filter(pickup => pickup.kind === 'ammo');
  assert.deepEqual(boxes.map(pickup => pickup.special), [false, false, false, true]);
});

test('ammo replenishes both carried weapons separately within finite stock caps', () => {
  const { simulation, player, events } = room();
  Object.assign(player, { x: 0, y: 0, z: 2, weapon: 'rifle', inventory: { rifle: { ammo: 5, reserve: 2 }, shotgun: { ammo: 1, reserve: 0 } } });
  drop(simulation, { kind: 'ammo' });
  simulation.tick(0);
  assert.deepEqual(player.inventory, { rifle: { ammo: 5, reserve: 12 }, shotgun: { ammo: 1, reserve: 2 } });
  assert.deepEqual(events.at(-1).ammo, [{ weapon: 'rifle', amount: 10 }, { weapon: 'shotgun', amount: 2 }]);
  player.inventory.rifle = { ammo: WEAPONS.rifle.magazine, reserve: WEAPONS.rifle.reserve - 1 };
  player.inventory.shotgun = { ammo: WEAPONS.shotgun.magazine, reserve: WEAPONS.shotgun.reserve - 1 };
  drop(simulation, { kind: 'ammo' });
  simulation.tick(0);
  assert.equal(player.inventory.rifle.reserve, WEAPONS.rifle.reserve);
  assert.equal(player.inventory.shotgun.reserve, WEAPONS.shotgun.reserve);
  assert.equal(simulation.pickups.size, 1, 'The one missing shell consumes half a box; its remaining half stays shared');
  assert.equal(simulation.snapshot().pickups[0].fill, .5);
  assert.equal(Object.keys(player.inventory).length, 2);
});

test('full stocks leave the shared box for a teammate, and bonus ammunition stays rare and capped', () => {
  const { simulation, player } = room();
  Object.assign(player, { x: 0, y: 0, z: 2 });
  const teammate = simulation.addPlayer('b');
  Object.assign(teammate, { x: .3, y: 0, z: 2 });
  drop(simulation, { kind: 'ammo' });
  simulation.tick(0);
  assert.equal(simulation.pickups.size, 1);
  teammate.inventory.pistol.reserve -= 2;
  simulation.tick(0);
  assert.equal(simulation.pickups.size, 1);
  assert.equal(simulation.snapshot().pickups[0].fill, .5);
  assert.equal(teammate.inventory.pistol.reserve, WEAPONS.pistol.reserve);
  // Isolate the bonus refill quantities from that already-tested remainder.
  simulation.pickups.clear();
  player.inventory = { minigun: { ammo: 0, reserve: 0 }, magnum: { ammo: 0, reserve: 0 } };
  player.weapon = 'minigun';
  drop(simulation, { kind: 'ammo' });
  simulation.tick(0);
  assert.deepEqual(player.inventory, { minigun: { ammo: 0, reserve: 6 }, magnum: { ammo: 0, reserve: 0 } });
  drop(simulation, { kind: 'ammo', special: true });
  simulation.tick(0);
  assert.deepEqual(player.inventory, { minigun: { ammo: 0, reserve: 18 }, magnum: { ammo: 0, reserve: 1 } });
  assert.equal(simulation.reload(player.id), true);
  simulation.time = player.reloadUntil;
  simulation.tick(0);
  assert.equal(player.inventory.minigun.ammo, 18);
});

test('pickup checks reject other floors, walls, boards, furniture, solid treads, downed and dead players', () => {
  for (const scenario of ['floor', 'wall', 'boards', 'furniture', 'stair-tread', 'downed', 'dead', 'distant']) {
    const { simulation, player } = room();
    Object.assign(player, { x: 0, y: 0, z: 2 });
    const pickup = drop(simulation);
    if (scenario === 'floor') Object.assign(pickup, { y: WORLD.loftY });
    if (scenario === 'wall') { Object.assign(player, { x: 2, z: -5.5 }); Object.assign(pickup, { x: 2, z: -6.5 }); }
    if (scenario === 'boards') { Object.assign(player, { x: 0, z: -5.5 }); Object.assign(pickup, { x: 0, z: -6.5 }); }
    if (scenario === 'furniture') { Object.assign(player, { x: -6.5, z: 2.8 }); Object.assign(pickup, { x: -5.5, z: 2.8 }); }
    if (scenario === 'stair-tread') { const z = WORLD.stair.maxZ - .5; Object.assign(player, { x: 3.8, y: .425, z }); Object.assign(pickup, { x: 3.8, z, y: 0 }); }
    if (scenario === 'downed') player.downed = true;
    if (scenario === 'dead') player.alive = false;
    if (scenario === 'distant') pickup.x = PICKUPS.reach + .01;
    assert.equal(simulation.canCollectPickup(player, pickup), false, scenario);
    simulation.collectPickups();
    assert.equal(player.points, 0, scenario);
    assert.equal(simulation.pickups.size, 1, scenario);
  }
  const lateral = room();
  const stairZ = WORLD.stair.maxZ - .5;
  Object.assign(lateral.player, { x: 2.7, y: 0, z: stairZ });
  const onStep = drop(lateral.simulation, { x: 3.3, z: stairZ, y: .425 });
  assert.equal(lateral.simulation.canCollectPickup(lateral.player, onStep), true, 'An open stair side has no virtual handrail blocking a clear pickup ray');
  const { simulation, player } = room();
  Object.assign(player, { x: 0, y: 0, z: -5.5 });
  drop(simulation, { x: 0, z: -6.5 });
  simulation.doors[0].hp = 0;
  simulation.collectPickups();
  assert.equal(player.points, 100, 'An open doorway allows actual nearby pickup');
  for (const door of simulation.doors) {
    door.hp = door.maxHp;
    const tangent = door.outZ < 0 || door.outX > 0 ? 1 : -1;
    Object.assign(player, { x: door.x - door.outX * .5 + (door.outZ ? tangent : 0), z: door.z - door.outZ * .5 + (door.outX ? tangent : 0), y: 0 });
    const throughGap = { x: door.x + door.outX * .5 + (door.outZ ? tangent : 0), z: door.z + door.outZ * .5 + (door.outX ? tangent : 0), y: 0 };
    assert.equal(simulation.canCollectPickup(player, throughGap), false, `${door.id}: no reaching under tilted boards`);
  }
});

test('drops are grounded on loft, steps and reachable outdoor edge', () => {
  const { simulation } = room();
  for (const [zombie, expectedY] of [
    [{ x: 5, y: 3.4, z: 0 }, 3.4],
    [{ x: 3.8, y: 1.7, z: (WORLD.stair.minZ + WORLD.stair.maxZ) / 2 }, 1.7],
    [{ x: -30, y: 0, z: 0 }, 0],
    [{ x: 0, y: 0, z: 30 }, 0],
  ]) {
    simulation.dropZombieLoot(zombie, 100);
    const pickup = [...simulation.pickups.values()].at(-1);
    assert.equal(pickup.y, expectedY);
    assert.ok(pickup.x >= EXTERIOR.bounds.minX && pickup.x <= EXTERIOR.bounds.maxX);
    assert.ok(pickup.z >= EXTERIOR.bounds.minZ && pickup.z <= EXTERIOR.bounds.maxZ);
  }
});

test('loot persists across wave resupply, expires by server time and clears on restart or terminal phases', () => {
  const { simulation, player } = room();
  Object.assign(player, { x: -2.8, z: 1.7 });
  drop(simulation, { x: 1, z: 3 });
  simulation.finishWave();
  assert.equal(simulation.pickups.size, 1);
  simulation.time += PICKUPS.lifetime;
  simulation.tick(0);
  assert.equal(simulation.pickups.size, 0);
  drop(simulation);
  simulation.endGame();
  assert.equal(simulation.pickups.size, 0);
  drop(simulation);
  simulation.start(player.id);
  assert.equal(simulation.pickups.size, 0);
  assert.equal(simulation.lootKills, 0);
  assert.equal(simulation.ammoDrops, 0);
  drop(simulation);
  simulation.phase = 'wave'; simulation.wave = MAX_WAVES; simulation.toSpawn = 0; simulation.zombies.clear();
  assert.equal(simulation.beginExtraction(), true);
  assert.equal(simulation.pickups.size, 0);
});
