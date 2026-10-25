import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { ballisticDistance } from '../public/ballistics.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { LOFT } from '../public/rules.js';
import { STAIR_WELL, stairTreadY } from '../public/stairs.js';

function fixture(position = {}) {
  const events = [];
  const simulation = new RoomSimulation('LOFT01', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start(player.id);
  Object.assign(player, position);
  return { simulation, player, events };
}

test('loft gains eighteen square metres while retaining the exact stairwell', () => {
  assert.equal(WORLD.loft, LOFT);
  assert.equal(WORLD.loftY, LOFT.y);
  assert.deepEqual(LOFT, { minX: .5, maxX: 8, minZ: -6, maxZ: 6, y: 3.4, thickness: .24 });
  assert.equal((LOFT.maxX - LOFT.minX) * (LOFT.maxZ - LOFT.minZ) - 72, 18);
  for (const [axis, expected] of Object.entries({ minX: 2.7, maxX: 4.9, minZ: -2, maxZ: 2.5 })) assert.ok(Math.abs(STAIR_WELL[axis] - expected) < 1e-9);
});

test('new loft strip supports ordinary walking and falling from above without altering the hole', () => {
  for (const x of [.8, 1.3, 1.8]) {
    const { simulation, player } = fixture({ x, y: 4, z: 0, grounded: false, vy: -1 });
    for (let i = 0; i < 60; i++) simulation.movePlayer(player, 1 / 30);
    assert.equal(player.y, LOFT.y, `x ${x}`);
    assert.equal(player.grounded, true);
    simulation.setInput(player.id, { forward: -1, strafe: 0, yaw: 0, pitch: 0 });
    simulation.movePlayer(player, .1);
    assert.equal(player.y, LOFT.y);
  }
  const hole = fixture({ x: 3.8, y: LOFT.y + .4, z: 1.1, grounded: false, vy: -1 });
  for (let i = 0; i < 90; i++) hole.simulation.movePlayer(hole.player, 1 / 30);
  assert.equal(hole.player.y, stairTreadY(1.1));
});

test('the expanded floor stops heads and real bullets from crossing its new underside', () => {
  for (const x of [.8, 1.3, 1.8]) {
    const { simulation, player, events } = fixture({ x, y: 1.2, z: 0, grounded: false, vy: 5.6, pitch: 1.2, yaw: 0 });
    for (let i = 0; i < 3; i++) simulation.movePlayer(player, 1 / 30);
    assert.ok(player.y + 1.75 <= LOFT.y - LOFT.thickness + 1e-8);
    Object.assign(player, { x, y: 0, z: 0, pitch: 1.2 });
    assert.equal(simulation.shoot(player.id), true);
    settleBallisticFlight(simulation);
    const shot = events.find(event => event.event === 'shot');
    const impact = events.find(event => event.event === 'bullet-impact');
    assert.equal(impact.stop, 'solid');
    assert.ok(ballisticDistance(shot.projectiles[0], impact.age) < 2, 'The added floor, rather than an outer wall, stops the shot');
  }
});

test('the outer loft railing prevents walking off the added floor and zombies pursue across its strip', () => {
  const { simulation, player } = fixture({ x: LOFT.minX + .3, y: LOFT.y, z: -3 });
  for (let i = 0; i < 60; i++) {
    simulation.setInput(player.id, { forward: 0, strafe: -1, yaw: 0, pitch: 0 });
    simulation.movePlayer(player, 1 / 30);
  }
  assert.ok(player.x >= LOFT.minX + .25);
  assert.equal(player.y, LOFT.y);
  Object.assign(player, { x: 6, z: 3 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: 2.3, y: LOFT.y, z: -3, speed: 2, entered: true, navigation: null });
  const target = { x: 1.1, y: LOFT.y, z: -3 };
  for (let i = 0; i < 60; i++) simulation.moveZombieTowards(zombie, target, 1 / 30);
  assert.ok(Math.hypot(zombie.x - target.x, zombie.z - target.z) < .1);
  assert.equal(zombie.y, LOFT.y);
});

test('weapon deposits and ground pickup interactions use the new loft surface and still reject other floors', () => {
  const { simulation, player } = fixture({ x: 1.2, y: LOFT.y, z: 1, yaw: 0 });
  assert.equal(simulation.dropWeapon(player.id), true);
  const [pickup] = [...simulation.pickups.values()];
  assert.equal(pickup.y, LOFT.y);
  simulation.time += 1;
  assert.equal(simulation.snapshot().players[0].nearbyWeaponId, pickup.id);
  player.y = 0;
  assert.equal(simulation.snapshot().players[0].nearbyWeaponId, null);
  assert.equal(simulation.takeGroundWeapon(player.id, pickup.id), false);
  player.y = LOFT.y;
  assert.equal(simulation.takeGroundWeapon(player.id, pickup.id), true);
});
