import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WORLD, WEAPONS } from '../simulation.mjs';
import { ARMORY, LATE_SUPPLIES, EXTERIOR, FAR_SPAWN_ENTRIES, farSpawnShare, waveBalance, armoryRackBounds } from '../public/rules.js';

function room(random = () => .5) {
  const simulation = new RoomSimulation('NAVARS', { random });
  const player = simulation.addPlayer('a'); simulation.start('a');
  simulation.phase = 'intermission'; simulation.timeLeft = 100000; simulation.wave = 18;
  return { simulation, player };
}
function step(simulation, player, delta, input = {}) {
  simulation.setInput(player.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0, ...input });
  simulation.time += delta; simulation.movePlayer(player, delta);
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true, 'Every traversed pose stays legal');
}

test('added and relocated racks have unobstructed same-floor approach positions and can actually be purchased', () => {
  for (const type of ['hammer', 'sniper', 'bat', 'katana']) {
    const { simulation, player } = room(), rack = ARMORY.find(item => item.weapon === type);
    Object.assign(player, { x: rack.x + Math.sin(rack.facing) * 1.1, y: rack.y,
      z: rack.z + Math.cos(rack.facing) * 1.1, grounded: true, points: rack.price });
    assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true, type);
    assert.equal(simulation.buyWeapon(player.id, rack.id), true, type);
    assert.equal(player.weapon, type); assert.equal(player.points, 0);
    assert.deepEqual(player.inventory[type], { ammo: WEAPONS[type].magazine, reserve: WEAPONS[type].reserve });
  }
});

test('the loft northern cross-passage and east aisle remain walkable past the new wall racks', () => {
  for (const delta of [1 / 30, .1]) {
    const { simulation, player } = room(); Object.assign(player, { x: 1, y: WORLD.loftY, z: -4.7 });
    for (let elapsed = 0; elapsed < 1.55; elapsed += delta) step(simulation, player, delta, { strafe: 1 });
    assert.ok(player.x > 6.7, `northern passage at ${delta}: ${player.x}`);
    player.x = 6.7;
    for (let elapsed = 0; elapsed < 2.4; elapsed += delta) step(simulation, player, delta, { forward: -1 });
    assert.ok(player.z > 4.1, `east aisle at ${delta}: ${player.z}`);
    assert.equal(player.y, WORLD.loftY);
  }
});

test('jumping into an added or relocated loft rack cannot establish an unreachable elevated perch', () => {
  for (const delta of [1 / 30, .1]) for (const type of ['hammer', 'sniper', 'katana']) {
    const { simulation, player } = room(), rack = ARMORY.find(item => item.weapon === type), bounds = armoryRackBounds(rack);
    Object.assign(player, { x: rack.x + Math.sin(rack.facing) * .65, y: rack.y,
      z: rack.z + Math.cos(rack.facing) * .65, grounded: true });
    let maxY = player.y;
    for (let elapsed = 0; elapsed < 2; elapsed += delta) {
      step(simulation, player, delta, { forward: 1, yaw: rack.facing, jump: elapsed === 0, sprint: true });
      maxY = Math.max(maxY, player.y);
    }
    assert.ok(maxY < bounds.baseY + bounds.height, `${type} rack top cannot be reached by a normal jump`);
    assert.equal(player.y, WORLD.loftY); assert.equal(player.grounded, true);
  }
});

test('the original south-rail two-hop route no longer lands on the added hammer display', () => {
  for (const delta of [1 / 30, .1]) {
    const { simulation, player } = room();
    // This legal rail pose reproduced a 2.15 m safe perch when the hammer was
    // mounted on the ground-floor south wall. Keep that regression concrete.
    Object.assign(player, { x: .5, y: 4.12, z: 5.3, grounded: true });
    for (let elapsed = 0; elapsed < 3; elapsed += delta) {
      const moving = player.x > -3.4;
      step(simulation, player, delta, { forward: moving ? 1 : 0, yaw: Math.PI / 2, sprint: true, jump: elapsed === 0 });
    }
    assert.equal(player.y, 0); assert.equal(player.grounded, true);
    assert.ok(player.x < -3.4);
  }
});

test('the flush late-supply post introduces no solid cover or support surface beneath it', () => {
  const { simulation, player } = room(), position = LATE_SUPPLIES.position;
  assert.ok(!WORLD.covers.some(cover => cover.id?.includes('supply')));
  Object.assign(player, { x: position.x, y: 0, z: position.z + .45, grounded: true });
  assert.equal(simulation.canOccupy(player, player.x, player.z, 0, .25), true);
  assert.equal(simulation.playerSurface(player, player.x, player.z, 2.4), 0);
  for (let tick = 0; tick < 90; tick++) step(simulation, player, 1 / 30, { jump: tick === 0 });
  assert.equal(player.y, 0);
});

test('actual runners from both distant clearings reach and cross an open cabin doorway at 10 and 30 Hz', () => {
  for (const delta of [1 / 30, .1]) for (const entry of FAR_SPAWN_ENTRIES) {
    const { simulation, player } = room(() => 0);
    simulation.wave = 12; simulation.beginWave();
    for (const door of simulation.doors) door.hp = 0;
    let zombie;
    do { zombie = simulation.spawnZombie(); } while (zombie.spawnEntryId !== entry.id);
    // Isolate navigation from crowd pressure while keeping the actual spawn,
    // speed, family, selected doorway and ordinary movement code.
    simulation.zombies.clear(); simulation.zombies.set(zombie.id, zombie);
    Object.assign(player, { x: -4.4, y: 0, z: 1, hp: 10000 });
    assert.equal(zombie.farSpawn, true); assert.ok(Math.hypot(zombie.x, zombie.z) > 45);
    let elapsed = 0;
    for (; elapsed < 35 && (!zombie.entered || Math.abs(zombie.x) >= 7.5 || Math.abs(zombie.z) >= 5.5); elapsed += delta) {
      simulation.time += delta; simulation.updateZombie(zombie, delta, [player]);
      assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true, entry.id);
    }
    assert.equal(zombie.entered, true, `${entry.id} must enter, not collect against a wall (${zombie.x},${zombie.z})`);
    assert.ok(elapsed < 35); assert.ok(Math.abs(zombie.x) < 8 && Math.abs(zombie.z) < 6);
  }
});

test('distant appearances are a minority introduced at wave 13, with unchanged total counts and no distant brutes', () => {
  for (const wave of [1, 12, 13, 14, 15, 20]) {
    const { simulation } = room(() => 0);
    simulation.wave = wave - 1; simulation.beginWave();
    const total = waveBalance(wave, 1).total;
    const zombies = Array.from({ length: total }, () => simulation.createZombie());
    const distant = zombies.filter(zombie => zombie.farSpawn);
    assert.equal(distant.length, Math.floor(total * farSpawnShare(wave)), `wave ${wave}`);
    assert.ok(distant.every(zombie => zombie.kind !== 'brute' && !zombie.boss));
    assert.ok(zombies.every(zombie => zombie.x > EXTERIOR.bounds.minX && zombie.x < EXTERIOR.bounds.maxX
      && zombie.z > EXTERIOR.bounds.minZ && zombie.z < EXTERIOR.bounds.maxZ));
  }
});
