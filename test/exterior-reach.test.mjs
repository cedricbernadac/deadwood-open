import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { FUEL_CACHES, SUPPLY_CACHES, FAR_SPAWN_ENTRIES, GENERATOR, farSpawnShare } from '../public/expedition.js';
import { SUPPLY_WAVES } from '../public/weapon-upgrades.js';
import { waveBalance } from '../public/rules.js';

function room(players = 1, random = () => .99) {
  const simulation = new RoomSimulation('REACHQ', { random });
  for (let index = 0; index < players; index++) simulation.addPlayer(`p${index}`);
  simulation.start('p0');
  return simulation;
}

function walk(simulation, player, target, delta = 1 / 30) {
  const start = simulation.time;
  for (let tick = 0; Math.hypot(player.x - target.x, player.z - target.z) > .2; tick++) {
    assert.ok(tick < 2400, 'route must not get stuck');
    const yaw = Math.atan2(player.x - target.x, player.z - target.z);
    simulation.setInput(player.id, { forward: 1, strafe: 0, yaw, pitch: 0, sprint: false });
    simulation.time += delta;
    simulation.movePlayer(player, delta);
    simulation.updateOutsideDamage(player, delta);
    assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
    assert.equal(player.hp, 100, 'a repaired open umbrella covers the actual route');
  }
  return simulation.time - start;
}

test('all three fuel runs can be walked out and back with the starter weapon and one umbrella charge', () => {
  for (const [index, cache] of FUEL_CACHES.entries()) {
    const simulation = room(), player = simulation.players.get('p0');
    simulation.wave = [5, 10, 15][index] - 1; simulation.beginWave();
    for (const door of simulation.doors) door.hp = 0;
    const side = Math.sign(cache.x), corner = { x: side * 9.8, z: Math.sign(cache.z) * 7.8 };
    Object.assign(player, { x: side * 7.4, y: 0, z: 0, grounded: true });
    assert.equal(simulation.setUmbrella(player.id, true), true);
    const outward = walk(simulation, player, { x: side * 9.8, z: 0 })
      + walk(simulation, player, corner) + walk(simulation, player, cache);
    assert.ok(outward > 33 && outward < 42, `actual outward walking time: ${outward}`);
    assert.equal(simulation.expeditionAction(player.id), 'take-fuel');
    assert.equal(simulation.interact(player.id), true);
    walk(simulation, player, corner);
    walk(simulation, player, { x: -9.8, z: corner.z });
    walk(simulation, player, { x: -9.8, z: 0 });
    walk(simulation, player, { x: GENERATOR.x - 1.2, z: 0 });
    walk(simulation, player, { x: GENERATOR.x - 1.2, z: GENERATOR.z });
    assert.equal(simulation.expeditionAction(player.id), 'deliver-fuel');
    assert.equal(simulation.interact(player.id), true);
    assert.ok(player.umbrella.remaining > 15, `detour margin: ${player.umbrella.remaining}s`);
    assert.equal(simulation.fuel, null);
    assert.ok(Math.hypot(cache.x, cache.z) >= 125);
  }
});

test('every party size gets the exact early distant quota even when runner rolls always fail', () => {
  for (const players of [1, 2, 3, 4]) for (let wave = 1; wave <= 20; wave++) {
    for (const random of [() => .99, () => 0]) {
      const simulation = room(players, random);
      simulation.wave = wave - 1; simulation.beginWave();
      const total = waveBalance(wave, players).total;
      const zombies = Array.from({ length: total }, () => simulation.createZombie());
      const far = zombies.filter(zombie => zombie.farSpawn);
      assert.equal(far.length, Math.floor(total * farSpawnShare(wave)), `${players} players, wave ${wave}`);
      assert.ok(zombies.every((zombie, index) => !zombie.farSpawn || index < Math.floor(total / 3)));
      assert.ok(far.every(zombie => zombie.kind !== 'brute' && !zombie.boss));
      if (far.length) {
        assert.equal(new Set(far.map(zombie => zombie.spawnEntryId)).size, 2);
        assert.ok(far.every(zombie => Math.hypot(zombie.x, zombie.z) > 60));
      }
      if (random() === .99) assert.ok(zombies.every(zombie => zombie.speed <= waveBalance(wave, players).walkerSpeed), 'no forced runners');
    }
  }
});

test('slow distant arrivals cross their actual open cabin door at 10 and 30 Hz', () => {
  for (const delta of [.1, 1 / 30]) for (const entry of FAR_SPAWN_ENTRIES) {
    const simulation = room(), player = simulation.players.get('p0');
    simulation.wave = 12; simulation.beginWave();
    for (const door of simulation.doors) door.hp = 0;
    let zombie;
    do { zombie = simulation.createZombie(); } while (zombie.spawnEntryId !== entry.id);
    simulation.zombies.set(zombie.id, zombie);
    Object.assign(player, { x: -4.4, y: 0, z: 1, hp: 10000 });
    let elapsed = 0;
    for (; elapsed < 75 && !zombie.entered; elapsed += delta) {
      simulation.time += delta; simulation.updateZombie(zombie, delta, [player]);
      assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true);
    }
    assert.equal(zombie.entered, true, `${entry.id}: ${elapsed}s, (${zombie.x},${zombie.z})`);
  }
});

test('the permanent bonus crate stays at its fixed outdoor location through all claim waves', () => {
  const simulation = room();
  for (const [index, wave] of SUPPLY_WAVES.entries()) {
    simulation.wave = wave; simulation.beginSupplyWave();
    const cache = SUPPLY_CACHES[0];
    assert.deepEqual([simulation.supplyCrate.x, simulation.supplyCrate.y, simulation.supplyCrate.z], [cache.x, 0, cache.z]);
    assert.ok(Math.hypot(cache.x, cache.z) < 20);
  }
});
