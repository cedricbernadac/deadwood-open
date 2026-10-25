import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { EXTERIOR, PICKUPS } from '../public/rules.js';
import { STAIR_TREADS, stairTreadY } from '../public/stairs.js';

function fixture() {
  const events = [];
  const simulation = new RoomSimulation('SUPPORT', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start(player.id); simulation.wave = 4; simulation.beginWave();
  simulation.spawnTimer = 999;
  return { simulation, player, events };
}

test('gunshot and explosion deaths under the stairs leave every simultaneous loot kind collectible on the ground floor', () => {
  for (const attack of ['shot', 'blast']) {
    const { simulation, player, events } = fixture();
    Object.assign(player, { x: 2.9, y: 0, z: -1.1, yaw: -Math.PI / 2, pitch: 0, hp: 55 });
    player.inventory.pistol.reserve -= PICKUPS.ammo.pistol;
    const zombie = simulation.spawnZombie();
    Object.assign(zombie, { x: 3.8, y: 0, z: -1.1, hp: attack === 'shot' ? 40 : 400, maxHp: 400,
      kind: 'walker', scale: 1, boss: false, entered: true });
    assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
    assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true);
    simulation.lootKills = 24;
    simulation.waveKills = simulation.waveGrenadeThresholds[0] - 1;
    if (attack === 'shot') { assert.equal(simulation.shoot(player.id), true); advanceBallisticFlight(simulation, .1); }
    else {
      const grenade = { id: 'support-grenade', ownerId: player.id, x: 3.8, y: .09, z: -.9 };
      simulation.grenades.set(grenade.id, grenade);
      assert.equal(simulation.explodeGrenade(grenade), true);
    }
    assert.equal(simulation.zombies.has(zombie.id), false, attack);
    const pickups = [...simulation.pickups.values()];
    assert.deepEqual(pickups.map(pickup => pickup.kind).sort(), ['ammo', 'grenade', 'health', 'points']);
    for (const pickup of pickups) {
      assert.equal(pickup.y, 0, `${attack}: ${pickup.kind} stays below the overhead treads`);
      assert.equal(pickup.x, zombie.x); assert.equal(pickup.z, zombie.z);
      assert.equal(simulation.canCollectPickup(player, pickup), true, `${attack}: ${pickup.kind} is reachable at the actual death position`);
    }
    simulation.collectPickups();
    assert.equal(simulation.pickups.size, 0);
    assert.equal(player.hp, 100);
    assert.equal(player.grenades, 1);
    assert.equal(player.inventory.pistol.reserve, 36);
    assert.equal(player.points, attack === 'shot' ? 24 : 18);
    assert.deepEqual(events.filter(event => event.event === 'pickup').map(event => event.kind).sort(), ['ammo', 'grenade', 'health', 'points']);
  }
});

test('loot retains the actual ground, every tread and expanded loft support without moving its horizontal death position', () => {
  const positions = [
    { x: 3.8, y: 0, z: -1.1 },
    { x: 1.2, y: 0, z: 1 },
    { x: 1.2, y: WORLD.loftY, z: 1 },
    { x: 5.5, y: WORLD.loftY, z: 0 },
    ...STAIR_TREADS.map(tread => ({ x: 3.8, y: tread.maxY, z: (tread.minZ + tread.maxZ) / 2 })),
  ];
  for (const position of positions) {
    const { simulation } = fixture();
    simulation.dropZombieLoot(position, 18);
    const [pickup] = [...simulation.pickups.values()];
    assert.equal(pickup.x, position.x); assert.equal(pickup.z, position.z);
    assert.equal(pickup.y, position.y, JSON.stringify(position));
    if (position.y > 0 && position.y < WORLD.loftY) assert.equal(pickup.y, stairTreadY(position.z));
  }
});

test('outdoor perimeter clamping stays outside the cabin on accessible ground and does not invent a loft beneath a high corpse', () => {
  for (const position of [
    { x: -30, y: 0, z: 0 }, { x: 30, y: 3.4, z: 3 },
    { x: 0, y: 0, z: -30 }, { x: 3.8, y: 3.4, z: 30 },
    { x: 30, y: 3.4, z: 30 },
  ]) {
    const { simulation, player } = fixture();
    simulation.dropZombieLoot(position, 18);
    const [pickup] = [...simulation.pickups.values()];
    assert.equal(pickup.y, 0);
    assert.ok(Math.abs(pickup.x) > WORLD.width / 2 || Math.abs(pickup.z) > WORLD.depth / 2);
    assert.ok(pickup.x >= EXTERIOR.bounds.minX + .25 && pickup.x <= EXTERIOR.bounds.maxX - .25);
    assert.ok(pickup.z >= EXTERIOR.bounds.minZ + .25 && pickup.z <= EXTERIOR.bounds.maxZ - .25);
    Object.assign(player, { x: pickup.x, y: 0, z: pickup.z });
    assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
    assert.equal(simulation.canCollectPickup(player, pickup), true);
  }
});
