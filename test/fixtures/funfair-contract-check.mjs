import assert from 'node:assert/strict';
import { RoomSimulation, WORLD } from '../../simulation.mjs';
import { LEVEL, LEVELS, LEVEL_IDS, IS_FUNFAIR, HAS_SPACE } from '../../public/level-config.js';
import { SPACE, spaceFloor, spaceFlightAt, spaceFloorId, spaceRoute } from '../../public/level-space.js';
import { FUNFAIR_CEILING } from '../../public/level-space-funfair.js';
import { WORLD as PREDICTED_WORLD, movementMethods } from '../../public/online/physics.js';
import { ARMORY, ARMORY_REACH, LATE_SUPPLIES } from '../../public/rules.js';
import { GENERATOR, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, SUPPLY_CACHES, hasRainShelter, rainRoofHeight } from '../../public/expedition.js';
import { RAID_ENTRIES } from '../../public/raids.js';
import { wayOut, outdoors, canopyMetres } from '../../companions/outdoors.mjs';

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ID = '0123456789abcdef';
const ADMIT_GRID = [1.7, 2.7, .7, 3.7, -.3].flatMap(z => [-2.8, -1.7, -.6, .5, -3.9, -5, 1.6].map(x => ({ x, y: 0, z })));
const stand = rack => ({ x: rack.x + Math.sin(rack.facing ?? 0) * .95, y: rack.y, z: rack.z + Math.cos(rack.facing ?? 0) * .95 });
const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

assert.equal(process.env.DEADWOOD_LEVEL, 'funfair', 'run with DEADWOOD_LEVEL=funfair');
assert.equal(LEVEL, LEVELS.funfair);
assert.equal(LEVEL.id, 'funfair');
assert.equal(LEVEL.name, 'La Fête Foraine');
assert.equal(IS_FUNFAIR, true);
assert.equal(HAS_SPACE, true);
assert.deepEqual(LEVEL_IDS, ['cabin', 'supermarket', 'hospital', 'funfair']);
assert.equal(LEVEL.width, 36);
assert.equal(LEVEL.depth, 26);
assert.equal(LEVEL.halfWidth, 18);
assert.equal(LEVEL.halfDepth, 13);
assert.equal(LEVEL.spaceId, 'funfair-depth');
assert.equal(LEVEL.minY, -3.4);
assert.equal(SPACE.id, LEVEL.spaceId);
assert.equal(SPACE.minY, LEVEL.minY);
assert.deepEqual(SPACE.flights.map(flight => flight.id), ['main-stair', 'service-stair']);
assert.deepEqual(SPACE.flights.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ })), [
  { minX: -14.6, maxX: -11.6, minZ: -8, maxZ: -1 },
  { minX: 11.2, maxX: 14.2, minZ: 3, maxZ: 10 },
]);
for (const flight of SPACE.flights) {
  assert.equal(flight.baseY, -3.4);
  assert.equal(flight.topY, 0);
  assert.equal(flight.steps, 20);
  assert.equal(flight.holdLanding, true);
  for (const [from, to] of [[flight.lower, flight.upper], [flight.upper, flight.lower]]) {
    assert.ok(spaceRoute(from, to).some(point => point.flightId === flight.id), `${flight.id} route uses its own flight`);
  }
}
assert.deepEqual(SPACE.floors.map(({ id, y, minX, maxX, minZ, maxZ }) => ({ id, y, minX, maxX, minZ, maxZ })), [
  { id: 'ground', y: 0, minX: -18, maxX: 18, minZ: -13, maxZ: 13 },
  { id: 'cellar', y: -3.4, minX: -17, maxX: 17, minZ: -12, maxZ: 12 },
]);
assert.deepEqual(FUNFAIR_CEILING, { minY: 3.2, maxY: 3.26 });
assert.deepEqual(WORLD, PREDICTED_WORLD);
assert.equal(WORLD.width, 36);
assert.equal(WORLD.depth, 26);
for (const [name, method] of Object.entries(movementMethods)) {
  assert.equal(method.toString(), RoomSimulation.prototype[name].toString(), `authority/prediction method ${name}`);
}

const sim = new RoomSimulation('FUNCONT', { random: () => .5, raids: false });
const player = sim.addPlayer(ID, 'Jules');
sim.start(ID);
Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
for (const door of sim.doors) {
  door.boards.fill(0);
  door.sealed = false;
  door.sealPending = false;
}
assert.deepEqual(LEVEL.doors, [
  { id: 'north', x: 0, z: -13, outX: 0, outZ: -1 },
  { id: 'south', x: 0, z: 13, outX: 0, outZ: 1 },
  { id: 'west', x: -18, z: 0, outX: -1, outZ: 0 },
  { id: 'east', x: 18, z: 0, outX: 1, outZ: 0 },
]);
assert.deepEqual(sim.doors.map(({ id, x, z, outX, outZ }) => ({ id, x, z, outX, outZ })), LEVEL.doors);
assert.equal(sim.snapshot().mapId, 'funfair');
assert.equal(ARMORY.length, 14);
assert.equal(ARMORY.filter(rack => rack.y === 0).length, 7);
assert.equal(ARMORY.filter(rack => rack.y === SPACE.minY).length, 7);
assert.deepEqual(new Set(ARMORY.map(rack => rack.id)), new Set(Object.keys(LEVEL.armoryPositions)));
for (const rack of ARMORY) assert.deepEqual({ x: rack.x, y: rack.y, z: rack.z, facing: rack.facing }, LEVEL.armoryPositions[rack.id], `rack contract ${rack.id}`);
assert.deepEqual(SPAWN_ENTRIES, LEVEL.spawnEntries);
assert.deepEqual(RAID_ENTRIES, LEVEL.raidEntries);
assert.deepEqual(SUPPLY_CACHES, LEVEL.supplyCaches);
assert.deepEqual(LATE_SUPPLIES.position, LEVEL.lateSupplyPosition);
assert.deepEqual({ x: GENERATOR.x, y: GENERATOR.y, z: GENERATOR.z }, { x: 6, y: -3.4, z: 9 });
assert.deepEqual(LEVEL.generator, { x: 6, y: -3.4, z: 9 });

function free(point, label, radius = .25) {
  Object.assign(player, { x: point.x, y: point.y ?? 0, z: point.z, grounded: true, crouched: false });
  assert.equal(sim.canOccupy(player, point.x, point.z, point.y ?? 0, radius), true, `${label} is not free: ${JSON.stringify(point)}`);
}
function reachable(y, radius) {
  const body = radius === .25 ? player : { id: `flood-${radius}`, kind: 'brute', scale: radius / .29, y, grounded: true };
  Object.assign(body, { y, grounded: true, crouched: false });
  const step = .4, points = [], keys = new Map();
  for (let ix = 0, x = -LEVEL.halfWidth + .6; x < LEVEL.halfWidth - .5; ix++, x = -LEVEL.halfWidth + .6 + ix * step) {
    for (let iz = 0, z = -LEVEL.halfDepth + .6; z < LEVEL.halfDepth - .5; iz++, z = -LEVEL.halfDepth + .6 + iz * step) {
      if (Math.abs(spaceFloor(x, z, y) - y) > .05 || !sim.canOccupy(body, x, z, y, radius)) continue;
      keys.set(`${ix}:${iz}`, points.length);
      points.push({ x, y, z, ix, iz });
    }
  }
  assert.ok(points.length > 100, `reachable floor has enough space at y=${y}, radius=${radius}`);
  const anchor = y === 0 ? { x: 0, z: 0 } : SPACE.refuge;
  let closest = 0;
  for (let index = 1; index < points.length; index++) if (flat(points[index], anchor) < flat(points[closest], anchor)) closest = index;
  const seen = new Set([closest]), queue = [closest];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const point = points[queue[cursor]];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = keys.get(`${point.ix + dx}:${point.iz + dz}`);
      if (next !== undefined && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return queue.map(index => points[index]);
}

const floors = new Map();
for (const radius of [.25, .29 * 1.32]) for (const y of [0, SPACE.minY]) {
  const floor = reachable(y, radius);
  floors.set(`${radius}:${y}`, floor);
  for (const rack of ARMORY.filter(item => item.y === y)) assert.ok(floor.some(point => flat(point, rack) < ARMORY_REACH - .1), `rack ${rack.id} reachable for radius ${radius}`);
  for (const flight of SPACE.flights) {
    const landing = y === 0 ? flight.upper : flight.lower;
    assert.ok(floor.some(point => flat(point, landing) < .45), `${flight.id} landing reachable at y=${y}, radius=${radius}`);
  }
  const localPoints = y === 0 ? [stand(LATE_SUPPLIES.position)] : [SPACE.refuge, { x: GENERATOR.x + 1.3, y: GENERATOR.y, z: GENERATOR.z }];
  for (const point of localPoints) assert.ok(floor.some(candidate => flat(candidate, point) < .45), `interaction point reachable ${JSON.stringify(point)}`);
  if (y === 0) for (const door of sim.doors) {
    const approach = { x: door.x - door.outX * 1.1, y: 0, z: door.z - door.outZ * 1.1 };
    assert.ok(floor.some(point => flat(point, approach) < .45), `inside door approach ${door.id}, radius=${radius}`);
  }
}
const survivorGround = floors.get('0.25:0'), survivorCellar = floors.get(`0.25:${SPACE.minY}`);
for (const rack of ARMORY) {
  const point = stand(rack);
  free(point, `rack ${rack.id} stand`);
  assert.equal(sim.interactionVisible(player, rack, `rack-${rack.id}`), true, `rack ${rack.id} visible from its stand`);
  const floor = rack.y === 0 ? survivorGround : survivorCellar;
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
free(SPACE.refuge, 'cellar refuge');
assert.deepEqual(SPACE.refuge, { x: -6, y: -3.4, z: -7 });
assert.equal(spaceFloorId(SPACE.refuge), 'cellar');
assert.ok(survivorCellar.some(point => flat(point, SPACE.refuge) < .45), 'refuge connected to cellar');
free(SPACE.watch, 'main-stair watch');
assert.equal(spaceFlightAt(SPACE.watch.x, SPACE.watch.z, SPACE.watch.y)?.id, 'main-stair');
assert.equal(spaceFloorId(SPACE.watch), 'stair');

for (const hole of SPACE.holes) for (const slab of SPACE.slabs) {
  if (slab.id.startsWith('ground-slab-') || slab.id.startsWith('ceiling-')) assert.ok(!overlap(hole, slab), `${slab.id} closes a stairwell`);
}
assert.ok(SPACE.slabs.some(slab => slab.id === 'cellar-slab' && slab.minY === -3.64 && slab.maxY === -3.4));
assert.ok(SPACE.slabs.filter(slab => slab.id.startsWith('ceiling-')).every(slab => slab.minY === 3.2 && slab.maxY === 3.26));
assert.deepEqual({ minY: SPACE.shelters.find(s => s.id === 'funfair-roof')?.minY, maxY: SPACE.shelters.find(s => s.id === 'funfair-roof')?.maxY }, { minY: 6.26, maxY: 6.5 });
const canopyChecks = [
  ['entrance-canopy', { x: 0, y: 0, z: -14.6 }],
  ['carousel-canopy', { x: -26, y: 0, z: 25.1 }],
  ['stall-canopy-west', { x: -13.5, y: 0, z: -15.45 }],
  ['stall-canopy-east', { x: 13.5, y: 0, z: -15.45 }],
];
for (const [id, point] of canopyChecks) {
  assert.ok(SPACE.shelters.some(shelter => shelter.id === id), `shelter ${id} exists`);
  free(point, `${id} standable dry ground`);
  assert.equal(hasRainShelter(point, 1.75), true, `${id} keeps a survivor dry beside the solid attraction`);
}
assert.equal(SPACE.shelters.filter(shelter => /canopy/.test(shelter.id)).length, 4, 'exactly the entrance, carousel and two stall canopies are canopy shelters');
assert.equal(hasRainShelter({ x: 0, y: 0, z: 0 }, 1.75), true);
assert.equal(hasRainShelter(SPACE.refuge, 1.75), true);
assert.equal(hasRainShelter(SPACE.watch, 1.75), true);
assert.equal(hasRainShelter({ x: LEVEL.roof.bounds.maxX + .1, y: 0, z: 0 }, 1.75), false);
assert.equal(hasRainShelter({ x: -32, y: 0, z: 20 }, 1.75), false, 'outside the carousel canopy is wet');
assert.equal(spaceFloorId({ x: LEVEL.halfWidth + 1, y: 0, z: 0 }), 'outside');
assert.equal(rainRoofHeight(0), LEVEL.roof.height - LEVEL.roof.thickness);
assert.ok(canopyMetres(sim.doors.find(door => door.id === 'north')) > 2);
assert.equal(canopyMetres(sim.doors.find(door => door.id === 'south')), 0);

const boss = { id: 'spawn-probe', kind: 'brute', scale: 1.32, boss: true };
const distanceToProp = (point, prop) => Math.hypot(Math.max(prop.minX - point.x, 0, point.x - prop.maxX), Math.max(prop.minZ - point.z, 0, point.z - prop.maxZ));
assert.equal(SPACE.props.length, 14);
assert.deepEqual(new Set(SPACE.props.map(prop => prop.kind)), new Set(['carousel', 'stall', 'caravan', 'lorry', 'arch-support', 'fence', 'lamp']));
for (const prop of SPACE.props) assert.ok(prop.maxY >= 1, `${prop.id} cannot be jumped onto`);
for (const entry of [...SPAWN_ENTRIES, ...FAR_SPAWN_ENTRIES, ...RAID_ENTRIES]) {
  assert.ok(LEVEL.doors.some(door => door.id === entry.doorId), `${entry.id} names a real door`);
  assert.equal(outdoors(entry), true, `${entry.id} outdoors`);
  assert.equal(sim.canOccupy(boss, entry.x, entry.z, 0, .29 * 1.32), true, `${entry.id} boss clearance`);
  if (!entry.id.startsWith('far-')) for (const prop of SPACE.props) assert.ok(distanceToProp(entry, prop) >= 2.65, `${entry.id} clears ${prop.id}`);
}
for (const [index, point] of SUPPLY_CACHES.entries()) {
  free(point, `supply cache ${index}`);
  assert.ok(wayOut(sim, point), `supply cache ${index} has a companion exit route`);
  for (const prop of SPACE.props) assert.ok(distanceToProp(point, prop) >= 2.65, `supply cache ${index} clears ${prop.id}`);
}

Object.assign(player, { x: -2.8, y: 0, z: 1.7, grounded: true });
sim.phase = 'intermission';
const late = sim.addPlayer('late', 'Late', undefined, { defer: true });
assert.equal(late.waiting, true);
assert.equal(sim.readyPlayer(late.id), true);
assert.equal(late.waiting, false);
assert.equal(sim.canOccupy(late, late.x, late.z, late.y, .25), true);

console.log(`funfair contract verified: 36x26 over 34x24, four doors, ${ARMORY.length} racks and stands, ${ADMIT_GRID.length} admit cells, two holdLanding flights, four canopies, fourteen props, spawns, refuge/watch and movement-method parity`);
