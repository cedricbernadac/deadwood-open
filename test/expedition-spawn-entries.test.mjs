import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPEDITION, SPAWN_ENTRIES, SPAWN_WARNING, FUEL_CACHES } from '../public/expedition.js';
import { SPAWN_ENTRIES as exportedEntries } from '../public/rules.js';
import { RoomSimulation, WORLD } from '../simulation.mjs';

test('each facade has two distinct intermediate exits inside the playable clearing', () => {
  assert.equal(exportedEntries, SPAWN_ENTRIES);
  assert.equal(SPAWN_ENTRIES.length, 8);
  assert.equal(new Set(SPAWN_ENTRIES.map(entry => entry.id)).size, SPAWN_ENTRIES.length);
  assert.ok(Object.isFrozen(SPAWN_ENTRIES));
  const { minX, maxX, minZ, maxZ } = EXPEDITION.bounds;
  for (const doorId of ['north', 'south', 'west', 'east']) {
    const entries = SPAWN_ENTRIES.filter(entry => entry.doorId === doorId);
    assert.equal(entries.length, 2, doorId);
    assert.deepEqual(new Set(entries.map(entry => entry.kind)), new Set(['culvert', 'woods']));
    assert.ok(Math.hypot(entries[0].x - entries[1].x, entries[0].z - entries[1].z) >= SPAWN_WARNING.minPlayerDistance);
    for (const entry of entries) {
      assert.ok(Object.isFrozen(entry));
      assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.z));
      assert.ok(entry.x >= minX + 2 && entry.x <= maxX - 2 && entry.z >= minZ + 2 && entry.z <= maxZ - 2, entry.id);
      const facadeDistance = doorId === 'north' ? -entry.z - WORLD.depth / 2
        : doorId === 'south' ? entry.z - WORLD.depth / 2
          : doorId === 'west' ? -entry.x - WORLD.width / 2 : entry.x - WORLD.width / 2;
      assert.ok(facadeDistance >= 5 && facadeDistance <= 6, `${entry.id}: genuinely intermediate, not the old 8–12 m spawn`);
      assert.ok(FUEL_CACHES.every(cache => Math.hypot(entry.x - cache.x, entry.z - cache.z) >= 2), entry.id);
    }
  }
});

test('intermediate exits leave physical ground clearance for survivors and the largest zombie', () => {
  const simulation = new RoomSimulation('EXITQA', { random: () => .5 });
  simulation.addPlayer('qa');
  const survivor = simulation.players.get('qa');
  const overlord = { kind: 'brute', scale: 1.32, boss: true };
  for (const entry of SPAWN_ENTRIES) {
    assert.equal(simulation.canOccupy(survivor, entry.x, entry.z, 0, .25), true, `${entry.id}: survivor`);
    assert.equal(simulation.canOccupy(overlord, entry.x, entry.z, 0, .29 * overlord.scale), true, `${entry.id}: overlord`);
  }
});
