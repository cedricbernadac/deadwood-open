import assert from 'node:assert/strict';
import { RoomSimulation, WORLD } from '../../simulation.mjs';
import { LEVEL, LEVELS, IS_HOSPITAL, HAS_SPACE } from '../../public/level-config.js';
import { SPACE, spaceFloor, spaceFlightAt, spaceFloorId } from '../../public/level-space.js';
import { WORLD as PREDICTED_WORLD, movementMethods } from '../../public/online/physics.js';
import { ARMORY, ARMORY_REACH, LATE_SUPPLIES } from '../../public/rules.js';
import { GENERATOR, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, SUPPLY_CACHES, hasRainShelter, rainRoofHeight } from '../../public/expedition.js';
import { RAID_ENTRIES } from '../../public/raids.js';
import { wayOut, outdoors } from '../../companions/outdoors.mjs';

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ID = '0123456789abcdef';
const ADMIT_GRID = [1.7, 2.7, .7, 3.7, -.3].flatMap(z => [-2.8, -1.7, -.6, .5, -3.9, -5, 1.6].map(x => ({ x, y: 0, z })));
const stand = rack => ({ x: rack.x + Math.sin(rack.facing ?? 0) * .95, y: rack.y, z: rack.z + Math.cos(rack.facing ?? 0) * .95 });

assert.equal(LEVEL, LEVELS.hospital);
assert.equal(LEVEL.id, 'hospital');
assert.equal(IS_HOSPITAL, true);
assert.equal(HAS_SPACE, true);
assert.equal(LEVEL.width, 40);
assert.equal(LEVEL.depth, 30);
assert.equal(LEVEL.halfWidth, 20);
assert.equal(LEVEL.halfDepth, 15);
assert.equal(LEVEL.spaceId, 'hospital-depth');
assert.equal(LEVEL.minY, -3.4);
assert.equal(SPACE.id, LEVEL.spaceId);
assert.equal(SPACE.minY, LEVEL.minY);
assert.deepEqual(SPACE.flights.map(flight => flight.id), ['main-stair', 'service-stair']);
assert.deepEqual(SPACE.floors.map(({ id, y }) => ({ id, y })), [{ id: 'ground', y: 0 }, { id: 'cellar', y: -3.4 }]);
assert.deepEqual(WORLD, PREDICTED_WORLD);
assert.equal(WORLD.width, 40);
assert.equal(WORLD.depth, 30);
for (const [name, method] of Object.entries(movementMethods)) {
  assert.equal(method.toString(), RoomSimulation.prototype[name].toString(), `authority/prediction method ${name}`);
}

const sim = new RoomSimulation('HOSCONT', { random: () => .5, raids: false });
const player = sim.addPlayer(ID, 'Jules');
sim.start(ID);
Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
for (const door of sim.doors) {
  door.boards.fill(0);
  door.sealed = false;
  door.sealPending = false;
}
assert.equal(LEVEL.doors.length, 4);
assert.deepEqual(sim.doors.map(({ id, x, z, outX, outZ }) => ({ id, x, z, outX, outZ })), LEVEL.doors);
assert.deepEqual(new Set(LEVEL.doors.map(door => door.id)), new Set(['north', 'south', 'west', 'east']));
assert.equal(sim.snapshot().mapId, 'hospital');
assert.equal(ARMORY.length, 14);
assert.deepEqual(new Set(ARMORY.map(rack => rack.id)), new Set(Object.keys(LEVEL.armoryPositions)));
for (const rack of ARMORY) {
  assert.deepEqual({ x: rack.x, y: rack.y, z: rack.z, facing: rack.facing }, LEVEL.armoryPositions[rack.id], `rack contract ${rack.id}`);
}
assert.deepEqual(SPAWN_ENTRIES, LEVEL.spawnEntries);
assert.deepEqual(RAID_ENTRIES, LEVEL.raidEntries);
assert.deepEqual(SUPPLY_CACHES, LEVEL.supplyCaches);
assert.deepEqual(LATE_SUPPLIES.position, LEVEL.lateSupplyPosition);
assert.deepEqual({ x: GENERATOR.x, y: GENERATOR.y, z: GENERATOR.z }, LEVEL.generator);

function free(point, label, radius = .25) {
  Object.assign(player, { x: point.x, y: point.y ?? 0, z: point.z, grounded: true, crouched: false });
  assert.equal(sim.canOccupy(player, point.x, point.z, point.y ?? 0, radius), true, `${label} is not free: ${JSON.stringify(point)}`);
}

function reachable(y, radius) {
  const body = radius === .25 ? player : { id: `flood-${radius}`, kind: 'brute', scale: radius / .29, y, grounded: true };
  Object.assign(body, { y, grounded: true, crouched: false });
  const step = .4;
  const points = [];
  const keys = new Map();
  for (let ix = 0, x = -LEVEL.halfWidth + .6; x < LEVEL.halfWidth - .5; ix++, x = -LEVEL.halfWidth + .6 + ix * step) {
    for (let iz = 0, z = -LEVEL.halfDepth + .6; z < LEVEL.halfDepth - .5; iz++, z = -LEVEL.halfDepth + .6 + iz * step) {
      if (Math.abs(spaceFloor(x, z, y) - y) > .05) continue;
      if (!sim.canOccupy(body, x, z, y, radius)) continue;
      keys.set(`${ix}:${iz}`, points.length);
      points.push({ x, y, z, ix, iz });
    }
  }
  assert.ok(points.length > 100, `reachable floor has enough space at y=${y}, radius=${radius}`);
  const anchor = y === 0 ? { x: 0, z: 0 } : SPACE.refuge;
  let closest = 0;
  for (let index = 1; index < points.length; index++) if (flat(points[index], anchor) < flat(points[closest], anchor)) closest = index;
  const seen = new Set([closest]);
  const queue = [closest];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const point = points[queue[cursor]];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = keys.get(`${point.ix + dx}:${point.iz + dz}`);
      if (next !== undefined && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return queue.map(index => points[index]);
}

const floors = new Map();
for (const radius of [.25, .29 * 1.32]) for (const y of [0, SPACE.minY]) {
  const floor = reachable(y, radius);
  floors.set(`${radius}:${y}`, floor);
  for (const rack of ARMORY.filter(item => item.y === y)) {
    assert.ok(floor.some(point => flat(point, rack) < ARMORY_REACH - .1), `rack ${rack.id} reachable for radius ${radius}`);
  }
  for (const flight of SPACE.flights) {
    const landing = y === 0 ? flight.upper : flight.lower;
    assert.ok(floor.some(point => flat(point, landing) < .45), `${flight.id} landing reachable at y=${y}, radius=${radius}`);
  }
  const localPoints = y === 0 ? [stand(LATE_SUPPLIES.position), { x: GENERATOR.x + 1.3, y: GENERATOR.y, z: GENERATOR.z }] : [SPACE.refuge];
  for (const point of localPoints) assert.ok(floor.some(candidate => flat(candidate, point) < .45), `interaction point reachable ${JSON.stringify(point)}`);
  if (y === 0) for (const door of sim.doors) {
    const approach = { x: door.x - door.outX * 1.1, y: 0, z: door.z - door.outZ * 1.1 };
    assert.ok(floor.some(point => flat(point, approach) < .45), `inside door approach ${door.id}, radius=${radius}`);
  }
}

const survivorGround = floors.get('0.25:0');
const survivorBasement = floors.get(`0.25:${SPACE.minY}`);
for (const rack of ARMORY) {
  const point = stand(rack);
  free(point, `rack ${rack.id} stand`);
  assert.equal(sim.interactionVisible(player, rack, `rack-${rack.id}`), true, `rack ${rack.id} visible from its stand`);
  const floor = rack.y === 0 ? survivorGround : survivorBasement;
  assert.ok(floor.some(candidate => flat(candidate, point) < .45), `rack ${rack.id} stand connected to its floor`);
}

const generatorStand = { x: GENERATOR.x + 1.3, y: GENERATOR.y, z: GENERATOR.z };
free(generatorStand, 'generator interaction stand');
assert.ok(flat(generatorStand, GENERATOR) < GENERATOR.reach);
const lateSupplyStand = stand(LATE_SUPPLIES.position);
free(lateSupplyStand, 'late supply stand');
assert.ok(flat(lateSupplyStand, LATE_SUPPLIES.position) < LATE_SUPPLIES.reach);
for (const [index, point] of ADMIT_GRID.entries()) {
  free(point, `admit grid ${index}`);
  assert.ok(survivorGround.some(candidate => flat(candidate, point) < .45), `admit grid ${index} reachable`);
}
free(SPACE.refuge, 'basement refuge');
assert.equal(spaceFloorId(SPACE.refuge), 'cellar');
assert.ok(survivorBasement.some(point => flat(point, SPACE.refuge) < .45), 'refuge connected to basement');
free(SPACE.watch, 'main-stair watch');
assert.equal(spaceFlightAt(SPACE.watch.x, SPACE.watch.z, SPACE.watch.y)?.id, 'main-stair');
assert.equal(spaceFloorId(SPACE.watch), 'stair');

assert.ok(SPACE.shelters.length > 0);
assert.ok(SPACE.shelters.some(shelter => shelter.id === 'hospital-roof'));
assert.equal(hasRainShelter({ x: 0, y: 0, z: 0 }, 1.75), true, 'ground floor sheltered');
assert.equal(hasRainShelter(SPACE.refuge, 1.75), true, 'basement sheltered');
assert.equal(hasRainShelter(SPACE.watch, 1.75), true, 'stair watch sheltered');
assert.equal(hasRainShelter({ x: -21, y: 0, z: 0 }, 1.75), true, 'ambulance canopy shelters its bay');
assert.equal(hasRainShelter({ x: LEVEL.roof.bounds.maxX + .1, y: 0, z: 0 }, 1.75), false, 'outside the roof is exposed');
assert.equal(spaceFloorId({ x: LEVEL.halfWidth + 1, y: 0, z: 0 }), 'outside');
assert.equal(rainRoofHeight(0), LEVEL.roof.height - LEVEL.roof.thickness);

const boss = { id: 'spawn-probe', kind: 'brute', scale: 1.32, boss: true };
for (const entry of [...SPAWN_ENTRIES, ...FAR_SPAWN_ENTRIES, ...RAID_ENTRIES]) {
  assert.ok(LEVEL.doors.some(door => door.id === entry.doorId), `${entry.id} names a real door`);
  assert.equal(outdoors(entry), true, `${entry.id} outdoors`);
  assert.equal(sim.canOccupy(boss, entry.x, entry.z, 0, .29 * 1.32), true, `${entry.id} boss clearance`);
}
const unreachableSupplies = [];
for (const [index, point] of SUPPLY_CACHES.entries()) {
  free(point, `supply cache ${index}`);
  if (!wayOut(sim, point)) unreachableSupplies.push({ index, ...point });
}

Object.assign(player, { x: -2.8, y: 0, z: 1.7, grounded: true });
sim.phase = 'intermission';
const late = sim.addPlayer('late', 'Late', undefined, { defer: true });
assert.equal(late.waiting, true);
assert.equal(sim.readyPlayer(late.id), true);
assert.equal(late.waiting, false, 'real admission uses the verified grid');
assert.equal(sim.canOccupy(late, late.x, late.z, late.y, .25), true);
assert.deepEqual(unreachableSupplies, [], 'every outdoor supply cache has a real companion exit route');

console.log(`hospital contract verified: 40x30, four doors, ${ARMORY.length} racks and stands, ${ADMIT_GRID.length} admit cells, supplies, spawns, refuge/watch/shelters and movement-method parity`);
