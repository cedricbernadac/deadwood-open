import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { LEVEL } from '../../public/level-config.js';
import { SPACE, spaceFloor, spaceFloorId } from '../../public/level-space.js';

// Real rooms, not floor colours: every named room is a descriptor with
// bounds, a reachable target and boss-width door openings, enclosed by real
// partition segments and raised lintels in SPACE.walls. Geometry is probed
// with the real collision solver, never trusted from descriptors alone.
// Doorways must clear the colossus (boss walker profile 1.91 m x scale 1.32 =
// 2.52 m): a 2.2 m lintel would be an obstacle in its visibility graph.
const PLAYER_RADIUS = .25;
const BOSS_RADIUS = .29 * 1.32;
const BOSS_HEIGHT = 1.91 * 1.32;
const MIN_OPENING = 1.4;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const FLOOR_Y = { ground: 0, cellar: SPACE.minY };
const EXPECTED = new Map([
  ['reception', 'ground'], ['ward', 'ground'], ['theatre', 'ground'], ['emergency', 'ground'], ['chapel', 'ground'],
  ['pharmacy', 'cellar'], ['linen', 'cellar'], ['boiler', 'cellar'], ['archives', 'cellar'],
]);

assert.ok(Array.isArray(SPACE.rooms),
  'SPACE.rooms is an array of room descriptors {id, floor, bounds, target, doors} — the hospital is still one open hall');
const byId = new Map(SPACE.rooms.map(room => [room.id, room]));
for (const id of EXPECTED.keys()) assert.ok(byId.has(id), `SPACE.rooms lists the ${id} room`);

const sim = new RoomSimulation('HOSROOMS', { random: () => .5, raids: false });
const player = sim.addPlayer('0123456789abcdef', 'Jules');
sim.start(player.id);
for (const door of sim.doors) {
  door.boards.fill(0);
  door.sealed = false;
  door.sealPending = false;
}
Object.assign(player, { grounded: true, crouched: false });
const bossBody = { id: 'boss-probe', kind: 'brute', scale: BOSS_RADIUS / .29, grounded: true };
const floorsById = new Map(SPACE.floors.map(floor => [floor.id, floor]));
const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

function free(body, radius, x, z, y, label) {
  assert.equal(sim.canOccupy(body, x, z, y, radius), true, `${label} blocked at ${JSON.stringify({ x, z, y })} for radius ${radius}`);
}

// Retaining walls survive the partition work.
for (const id of ['cellar-west', 'cellar-east', 'cellar-north', 'cellar-south']) {
  assert.ok(SPACE.walls.some(wall => wall.id === id), `retaining wall ${id} remains`);
}

let wallCount = 0;
let openingCount = 0;
const allDoors = [];
for (const [id, floor] of EXPECTED) {
  const room = byId.get(id);
  const y = FLOOR_Y[floor];
  assert.equal(room.floor, floor, `room ${id} sits on the ${floor} floor`);
  const bounds = room.bounds;
  assert.ok(bounds && [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite), `room ${id} bounds is a rect`);
  assert.ok(bounds.minX < bounds.maxX && bounds.minZ < bounds.maxZ, `room ${id} bounds has area`);
  const floorRect = floorsById.get(floor);
  assert.ok(
    bounds.minX >= floorRect.minX - .01 && bounds.maxX <= floorRect.maxX + .01
    && bounds.minZ >= floorRect.minZ - .01 && bounds.maxZ <= floorRect.maxZ + .01,
    `room ${id} bounds stay inside the ${floor} floor: ${JSON.stringify(bounds)}`,
  );

  const target = room.target;
  assert.ok(target && [target.x, target.y, target.z].every(Number.isFinite), `room ${id} has a target point`);
  assert.ok(Math.abs(target.y - y) < .01, `room ${id} target rests on its floor elevation: ${JSON.stringify(target)}`);
  assert.ok(target.x > bounds.minX && target.x < bounds.maxX && target.z > bounds.minZ && target.z < bounds.maxZ,
    `room ${id} target is inside its bounds`);
  assert.equal(spaceFloorId(target), floor, `room ${id} target stands on the ${floor} floor surface`);
  free(player, PLAYER_RADIUS, target.x, target.z, y, `room ${id} target`);
  free(bossBody, BOSS_RADIUS, target.x, target.z, y, `room ${id} target (boss body)`);

  const partitions = SPACE.walls.filter(wall => wall.id.startsWith(`room-${id}-`));
  assert.ok(partitions.length >= 1, `room ${id} has at least one real partition wall room-${id}-* in SPACE.walls`);
  wallCount += partitions.length;

  assert.ok(Array.isArray(room.doors) && room.doors.length >= 1, `room ${id} declares at least one door opening`);
  const doorIds = new Set();
  for (const door of room.doors) {
    assert.ok(typeof door.id === 'string' && door.id.length > 0 && !doorIds.has(door.id), `room ${id} door has a unique id`);
    doorIds.add(door.id);
    assert.ok(door.axis === 'x' || door.axis === 'z', `door ${door.id} axis is the wall direction (x|z): ${door.axis}`);
    assert.ok([door.x, door.z, door.width, door.height].every(Number.isFinite), `door ${door.id} geometry is numeric`);
    assert.ok(door.height >= BOSS_HEIGHT + .05, `door ${door.id} clears the colossus (${BOSS_HEIGHT.toFixed(2)} m): ${door.height}`);
    assert.ok(door.width >= MIN_OPENING, `door ${door.id} leaves >= 1.4 m clear: ${door.width}`);
    if (door.internal) {
      assert.ok(door.x > bounds.minX && door.x < bounds.maxX && door.z > bounds.minZ && door.z < bounds.maxZ,
        `internal door ${door.id} stays inside ${id}`);
    } else if (door.axis === 'x') {
      assert.ok(Math.min(Math.abs(door.z - bounds.minZ), Math.abs(door.z - bounds.maxZ)) < .6,
        `door ${door.id} (axis x) lies on a z edge of ${id}: z=${door.z}`);
      assert.ok(door.x - door.width / 2 >= bounds.minX - .6 && door.x + door.width / 2 <= bounds.maxX + .6,
        `door ${door.id} spans x inside ${id}`);
    } else {
      assert.ok(Math.min(Math.abs(door.x - bounds.minX), Math.abs(door.x - bounds.maxX)) < .6,
        `door ${door.id} (axis z) lies on an x edge of ${id}: x=${door.x}`);
      assert.ok(door.z - door.width / 2 >= bounds.minZ - .6 && door.z + door.width / 2 <= bounds.maxZ + .6,
        `door ${door.id} spans z inside ${id}`);
    }
    allDoors.push({ ...door, floor });

    // Nothing solid below lintel height inside the opening: partition
    // segments flank it, the raised lintel starts at the door height.
    const opening = door.axis === 'x'
      ? { minX: door.x - door.width / 2 + .02, maxX: door.x + door.width / 2 - .02, minZ: door.z - .34, maxZ: door.z + .34 }
      : { minX: door.x - .34, maxX: door.x + .34, minZ: door.z - door.width / 2 + .02, maxZ: door.z + door.width / 2 - .02 };
    for (const box of SPACE.boxes) {
      if (!overlap(opening, box)) continue;
      const clears = box.maxY <= y + .05 || box.minY >= y + door.height - 1e-6;
      assert.ok(clears, `solid ${box.id} blocks the central passage of door ${door.id} below ${door.height} m`);
    }
    // Furniture may flank a doorway (the theatre's leaves stand open inside
    // it) but never narrows the colossus lane through it.
    const lane = door.axis === 'x'
      ? { minX: door.x - door.width / 2 + BOSS_RADIUS, maxX: door.x + door.width / 2 - BOSS_RADIUS, minZ: door.z - .6, maxZ: door.z + .6 }
      : { minX: door.x - .6, maxX: door.x + .6, minZ: door.z - door.width / 2 + BOSS_RADIUS, maxZ: door.z + door.width / 2 - BOSS_RADIUS };
    for (const cover of LEVEL.furniture) {
      const base = cover.baseY ?? 0;
      if (Math.abs(base - y) > .1 || !overlap(lane, cover)) continue;
      assert.fail(`furniture ${cover.id} stands in the colossus lane of door ${door.id}`);
    }

    // A player and a boss-radius body both stand and cross at the opening.
    const half = door.width / 2 - BOSS_RADIUS - .01;
    for (const along of [...new Set([0, half, -half])]) {
      const [px, pz] = door.axis === 'x' ? [door.x + along, door.z] : [door.x, door.z + along];
      free(player, PLAYER_RADIUS, px, pz, y, `door ${door.id} passage`);
      free(bossBody, BOSS_RADIUS, px, pz, y, `door ${door.id} passage (boss body)`);
    }
    for (const across of [-.55, .55]) {
      const [px, pz] = door.axis === 'x' ? [door.x, door.z + across] : [door.x + across, door.z];
      free(player, PLAYER_RADIUS, px, pz, y, `door ${door.id} threshold`);
    }
    openingCount++;
  }
}

// Enclosure: from each target, a straight probe through any wall stretch
// without a door must hit real collision geometry before reaching outside.
function segmentBlocked(from, to, y) {
  const length = flat(from, to);
  for (let d = .1; d <= length; d += .15) {
    const x = from.x + (to.x - from.x) * d / length;
    const z = from.z + (to.z - from.z) * d / length;
    if (!sim.canOccupy(player, x, z, y, .12)) return true;
  }
  return false;
}
const segmentNearDoor = (from, to, floor) => allDoors.some(door => {
  if (door.floor !== floor) return false;
  const length = flat(from, to);
  const t = Math.max(0, Math.min(1, ((door.x - from.x) * (to.x - from.x) + (door.z - from.z) * (to.z - from.z)) / (length * length)));
  return Math.hypot(from.x + (to.x - from.x) * t - door.x, from.z + (to.z - from.z) * t - door.z) < door.width / 2 + .35;
});
for (const [id, floor] of EXPECTED) {
  const room = byId.get(id);
  const { bounds, target } = room;
  const y = FLOOR_Y[floor];
  const edges = [
    { sample: s => ({ x: bounds.minX + s, z: bounds.minZ - .45 }), length: bounds.maxX - bounds.minX },
    { sample: s => ({ x: bounds.minX + s, z: bounds.maxZ + .45 }), length: bounds.maxX - bounds.minX },
    { sample: s => ({ x: bounds.minX - .45, z: bounds.minZ + s }), length: bounds.maxZ - bounds.minZ },
    { sample: s => ({ x: bounds.maxX + .45, z: bounds.minZ + s }), length: bounds.maxZ - bounds.minZ },
  ];
  for (const edge of edges) {
    for (let s = .6; s <= edge.length - .6; s += 1) {
      const outside = edge.sample(s);
      if (allDoors.some(door => door.floor === floor && flat(outside, door) < door.width / 2 + .9)) continue;
      if (floor === 'ground' && LEVEL.doors.some(door => flat(outside, door) < 1.5)) continue;
      if (segmentNearDoor(target, outside, floor)) continue;
      assert.ok(segmentBlocked(target, outside, y),
        `room ${id} leaks: target ${JSON.stringify(target)} sees straight out to ${JSON.stringify(outside)} with no wall`);
    }
  }
}

// Reachability: flood each floor on the player and boss-radius grids from a
// shared anchor; every room target is reached only by walking through real
// openings, since walls block the grid.
function flood(y, radius) {
  const body = radius === PLAYER_RADIUS ? player : { id: `flood-${radius}`, kind: 'brute', scale: radius / .29, y, grounded: true };
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
  assert.ok(points.length > 100, `flood grid has enough free space at y=${y}, radius=${radius}`);
  const anchor = y === 0 ? { x: 0, z: 0 } : SPACE.refuge;
  let closest = 0;
  for (let index = 1; index < points.length; index++) if (flat(points[index], anchor) < flat(points[closest], anchor)) closest = index;
  const seen = new Set([closest]);
  const queue = [closest];
  for (const cursor = { index: 0 }; cursor.index < queue.length; cursor.index++) {
    const point = points[queue[cursor.index]];
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

for (const radius of [PLAYER_RADIUS, BOSS_RADIUS]) {
  for (const [floor, y] of Object.entries(FLOOR_Y)) {
    const grid = flood(y, radius);
    for (const [id, roomFloor] of EXPECTED) {
      if (roomFloor !== floor) continue;
      const target = byId.get(id).target;
      assert.ok(grid.some(point => flat(point, target) < .45),
        `room ${id} target reachable through its openings on the radius ${radius.toFixed(3)} ${floor} grid`);
    }
  }
}

console.log(`hospital real rooms verified: ${EXPECTED.size} rooms, ${wallCount} partition walls, ${openingCount} boss-width openings, enclosed targets, player+boss flood grids on both floors`);
