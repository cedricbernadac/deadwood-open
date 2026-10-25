import assert from 'node:assert/strict';
import { RoomSimulation, WORLD } from '../../simulation.mjs';
import { LEVEL, IS_HOSPITAL, HAS_SPACE } from '../../public/level-config.js';
import { SPACE } from '../../public/level-space.js';
import { ARMORY, LATE_SUPPLIES } from '../../public/rules.js';
import { GENERATOR, SPAWN_ENTRIES, SUPPLY_CACHES } from '../../public/expedition.js';
import { RAID_ENTRIES } from '../../public/raids.js';

const id = process.env.DEADWOOD_LEVEL ?? 'cabin';
assert.ok(['cabin', 'supermarket'].includes(id));
assert.equal(LEVEL.id, id);
assert.equal(IS_HOSPITAL, false);
assert.equal(HAS_SPACE, id === 'supermarket');
assert.equal(WORLD.width, LEVEL.width);
assert.equal(WORLD.depth, LEVEL.depth);
assert.equal(ARMORY.length, 14);
assert.equal(SPAWN_ENTRIES.length, 8);
assert.equal(RAID_ENTRIES.length, 8);

const sim = new RoomSimulation('LEGACY', { random: () => .5, raids: false });
sim.addPlayer('legacy', 'Legacy');
assert.deepEqual(sim.doors.map(({ id, x, z, outX, outZ }) => ({ id, x, z, outX, outZ })), LEVEL.doors);
if (id === 'supermarket') {
  assert.deepEqual(SPAWN_ENTRIES, LEVEL.spawnEntries);
  assert.deepEqual(RAID_ENTRIES, LEVEL.raidEntries);
  assert.deepEqual(SUPPLY_CACHES, LEVEL.supplyCaches);
}
assert.deepEqual(LATE_SUPPLIES.position, LEVEL.lateSupplyPosition);
assert.deepEqual({ x: GENERATOR.x, y: GENERATOR.y, z: GENERATOR.z }, LEVEL.generator);

const rack = (weapon, x, y, z) => {
  const actual = ARMORY.find(item => item.weapon === weapon);
  assert.ok(actual, weapon);
  assert.deepEqual({ x: actual.x, y: actual.y, z: actual.z }, { x, y, z });
};

if (id === 'cabin') {
  assert.equal(LEVEL.width, 16);
  assert.equal(LEVEL.depth, 12);
  assert.equal(LEVEL.spaceId, undefined);
  assert.equal(LEVEL.minY, undefined);
  assert.deepEqual(LEVEL.doors, [
    { id: 'north', x: 0, z: -6, outX: 0, outZ: -1 },
    { id: 'south', x: 0, z: 6, outX: 0, outZ: 1 },
    { id: 'west', x: -8, z: 0, outX: -1, outZ: 0 },
    { id: 'east', x: 8, z: 0, outX: 1, outZ: 0 },
  ]);
  rack('pistol', -6.3, 0, 5.82);
  rack('assault', 3, 3.4, -5.82);
  rack('rocket', 7.82, 3.4, 0);
  assert.deepEqual({ x: GENERATOR.x, y: GENERATOR.y, z: GENERATOR.z }, { x: -5.3, y: 0, z: -4.6 });
  assert.deepEqual(LATE_SUPPLIES.position, { x: -2.4, y: 0, z: -5.82, facing: 0 });
  assert.deepEqual(SUPPLY_CACHES, [{ x: -16, y: 0, z: 10 }, { x: 15, y: 0, z: -11 }, { x: -14, y: 0, z: -12 }]);
  assert.equal(SPAWN_ENTRIES[0].z, -11.4);
  assert.equal(RAID_ENTRIES[0].z, -28);
  assert.equal(sim.snapshot().mapId, undefined);
} else {
  assert.equal(LEVEL.width, 28);
  assert.equal(LEVEL.depth, 22);
  assert.equal(LEVEL.spaceId, 'supermarket-depth');
  assert.equal(LEVEL.minY, -3.4);
  assert.equal(SPACE.id, 'supermarket-depth');
  assert.deepEqual(SPACE.flights.map(flight => flight.id), ['stock-stair', 'garden-stair']);
  assert.deepEqual(LEVEL.doors, [
    { id: 'north', x: 0, z: -11, outX: 0, outZ: -1 },
    { id: 'south', x: 0, z: 11, outX: 0, outZ: 1 },
    { id: 'west', x: -14, z: 0, outX: -1, outZ: 0 },
    { id: 'east', x: 14, z: 0, outX: 1, outZ: 0 },
  ]);
  rack('pistol', -12.3, 0, 10.82);
  rack('assault', .1, -3.4, -8.8);
  rack('rocket', 12.82, -3.4, .2);
  assert.deepEqual({ x: GENERATOR.x, y: GENERATOR.y, z: GENERATOR.z }, { x: -2.8, y: 0, z: -8.6 });
  assert.deepEqual(LATE_SUPPLIES.position, { x: -2.4, y: 0, z: -10.82, facing: 0 });
  assert.deepEqual(SUPPLY_CACHES, [{ x: -22, y: 0, z: 10 }, { x: 21, y: 0, z: -11 }, { x: -20, y: 0, z: -12 }]);
  assert.equal(SPAWN_ENTRIES[0].z, -16.4);
  assert.equal(RAID_ENTRIES[0].z, -33);
  assert.equal(sim.snapshot().mapId, 'supermarket');
}

console.log(`${id} legacy contract guarded: dimensions, doors, racks, expedition points, map identity and multi-floor flags`);
