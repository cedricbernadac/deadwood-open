import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { INTERIOR_WALLS, INTERIOR_DOORWAYS, INTERIOR_PASSAGES } from '../public/layout.js';
import { ARMORY, ARMORY_REACH, armoryRackBounds } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';
import { STAIRS, STAIR_TREADS } from '../public/stairs.js';
import { RoomSimulation } from '../simulation.mjs';

const furniture = [
  { minX: -6, maxX: -3.2, minZ: 2.4, maxZ: 3.5, baseY: 0, height: 1 },
  { minX: -2, maxX: .2, minZ: -1, maxZ: .2, baseY: 0, height: .8 },
  ...ARMORY.map(armoryRackBounds),
];
const stair = { ...STAIRS, baseY: 0, height: 10 };
const treads = STAIR_TREADS.map(tread => ({ ...tread, baseY: tread.minY, height: tread.maxY - tread.minY }));
const stairX = (STAIRS.minX + STAIRS.maxX) / 2;
const lowerLanding = { x: stairX, z: STAIRS.maxZ + .5 }, upperLanding = { x: stairX, z: STAIRS.minZ - .5 };
const overlaps = (a, b) => a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6
  && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6
  && a.baseY < b.baseY + b.height - 1e-6 && a.baseY + a.height > b.baseY + 1e-6;

// A conservative 20 cm grid with full body-radius inflation. This checks the
// floor plan independently of the runtime pathfinder.
function reachableFloor(baseY, radius) {
  const step = .2, minX = baseY ? 2.4 : -7.4, minZ = -5.4;
  const width = Math.round((7.4 - minX) / step) + 1, depth = 55;
  const obstacles = [...INTERIOR_WALLS, ...furniture, stair];
  const points = new Map();
  for (let iz = 0; iz < depth; iz++) for (let ix = 0; ix < width; ix++) {
    const x = minX + ix * step, z = minZ + iz * step;
    if (obstacles.some(box => baseY < box.baseY + box.height && baseY + 2.4 > box.baseY
      && x >= box.minX - radius && x <= box.maxX + radius && z >= box.minZ - radius && z <= box.maxZ + radius)) continue;
    points.set(iz * width + ix, { x, z });
  }
  const start = baseY ? upperLanding : { x: -2.8, z: 1.7 };
  const closest = [...points].sort((a, b) => Math.hypot(a[1].x - start.x, a[1].z - start.z) - Math.hypot(b[1].x - start.x, b[1].z - start.z))[0]?.[0];
  const visited = new Set([closest]), queue = [closest];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index], column = current % width;
    for (const next of [column ? current - 1 : -1, column < width - 1 ? current + 1 : -1, current - width, current + width]) {
      if (!points.has(next) || visited.has(next)) continue;
      visited.add(next); queue.push(next);
    }
  }
  return [...visited].map(index => points.get(index)).filter(Boolean);
}

test('the short north partition leaves two finite, frozen and boss-sized routes without framed doors', () => {
  assert.ok(Object.isFrozen(INTERIOR_WALLS));
  assert.ok(Object.isFrozen(INTERIOR_DOORWAYS));
  assert.ok(Object.isFrozen(INTERIOR_PASSAGES));
  assert.equal(INTERIOR_DOORWAYS.length, 0, 'neither former jambs nor lintels remain');
  assert.equal(INTERIOR_PASSAGES.length, 2, 'both ends provide a genuine escape route');
  const panels = INTERIOR_WALLS.filter(wall => wall.kind === 'partition');
  assert.equal(panels.length, 1, 'the north barrier is a single screen rather than a corridor');
  assert.ok(!INTERIOR_WALLS.some(wall => wall.kind === 'lintel'));
  assert.ok(INTERIOR_WALLS.every(wall => wall.baseY < 3.4), 'the loft remains open');
  const ids = new Set();
  for (const box of [...INTERIOR_WALLS, ...INTERIOR_PASSAGES]) {
    assert.ok(Object.isFrozen(box));
    assert.ok(!ids.has(box.id)); ids.add(box.id);
    for (const key of ['minX', 'maxX', 'minZ', 'maxZ', 'baseY', 'height']) assert.ok(Number.isFinite(box[key]));
    assert.ok(box.minX < box.maxX && box.minZ < box.maxZ && box.height > 0);
  }
  for (const passage of INTERIOR_PASSAGES) {
    assert.ok(passage.maxX - passage.minX > 4, 'an open end is wider than an ordinary doorway');
    assert.ok(passage.height > 2.8, 'there is no former 2.6 m lintel over either escape route');
    assert.ok(!INTERIOR_WALLS.some(wall => overlaps(wall, passage)), `${passage.id}: the full opening must be empty`);
  }
});

test('partitions preserve the staircase, furniture and wall rack volumes', () => {
  for (const wall of INTERIOR_WALLS) {
    assert.ok(!treads.some(tread => overlaps(wall, tread)), `${wall.id}: no partition touches an existing stair tread`);
    assert.ok(!furniture.some(prop => overlaps(wall, prop)), `${wall.id}: an existing prop must not be moved or embedded`);
    assert.ok(wall.minX >= -7.85 && wall.maxX <= 7.85 && wall.minZ >= -5.85 && wall.maxZ <= 5.85);
  }
});

test('players and the boss can reach all four entrances, both landings and every wall rack', () => {
  for (const radius of [.25, .29 * 1.32]) {
    for (const baseY of [0, 3.4]) {
      const floor = reachableFloor(baseY, radius);
      const anchors = baseY ? [upperLanding, { x: 5.5, z: -4 }] : [
        { x: 0, z: -4.8 }, { x: 0, z: 4.8 }, { x: -6.8, z: 0 }, { x: 6.8, z: 0 }, lowerLanding,
      ];
      for (const anchor of anchors) assert.ok(floor.some(point => Math.hypot(point.x - anchor.x, point.z - anchor.z) < .3), `radius ${radius}: ${JSON.stringify(anchor)} reachable on floor ${baseY}`);
      for (const crate of ARMORY.filter(crate => crate.y === baseY)) {
        assert.ok(floor.some(point => Math.hypot(point.x - crate.x, point.z - crate.z) < ARMORY_REACH - .1), `${crate.id} retains a reachable purchase approach for radius ${radius}`);
      }
    }
  }
});

test('survivors retreat through both open ends in either direction while standing or crouched', () => {
  const paths = [
    { x: -4.6, end: 'west' },
    { x: 5.7, end: 'east' },
  ];
  for (const { x, end } of paths) for (const fromNorth of [false, true]) for (const crouch of [false, true]) {
    const simulation = new RoomSimulation('RETREAT', { random: () => .5 });
    const player = simulation.addPlayer('a'); simulation.start('a');
    Object.assign(player, { x, z: fromNorth ? -3.3 : -.8, y: 0 });
    assert.equal(simulation.setInput('a', { forward: 1, strafe: 0, yaw: fromNorth ? Math.PI : 0, pitch: 0, crouch }), true);
    let crossed = false;
    for (let tick = 0; tick < 100 && !crossed; tick++) {
      simulation.movePlayer(player, 1 / 30);
      assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true, `${end}: the whole body stays in real free space`);
      assert.equal(player.y, 0, `${end}: taking the escape route does not force a stair or loft transition`);
      crossed = fromNorth ? player.z > -1.5 : player.z < -2.5;
    }
    assert.ok(crossed, `${end}: a ${crouch ? 'crouched' : 'standing'} survivor crosses ${fromNorth ? 'south' : 'north'} without a jump`);
  }
});

test('the closed opening facing the north entrance blocks movement and bullets from both sides', () => {
  assert.ok(INTERIOR_WALLS.some(wall => wall.minX <= -.8 && wall.maxX >= 1.4 && wall.minZ < -2 && wall.maxZ > -2 && wall.baseY === 0 && wall.height === 3.05));
  for (const crouch of [false, true]) for (const fromNorth of [false, true]) {
    const events = [];
    const simulation = new RoomSimulation('CLOSED', { random: () => .5, onEvent: event => events.push(event) });
    const player = simulation.addPlayer('a'); simulation.start('a');
    Object.assign(player, { x: 0, z: fromNorth ? -3.4 : -1.5, y: 0 });
    for (let tick = 0; tick < 90; tick++) {
      simulation.setInput('a', { forward: 1, strafe: 0, yaw: fromNorth ? Math.PI : 0, pitch: 0, crouch });
      simulation.tick();
    }
    assert.ok(fromNorth ? player.z < -2.36 : player.z > -1.64, `the solid north-facing panel stops a ${crouch ? 'crouched' : 'standing'} survivor from either side`);
    const zombie = simulation.spawnZombie();
    Object.assign(zombie, { x: 0, y: 0, z: fromNorth ? 1.3 : -3.4, hp: 1000, maxHp: 1000, entered: true });
    assert.equal(simulation.shoot('a'), true);
    assert.equal(zombie.hp, 1000, 'the filled opening stops bullets before the visible target');
    const shot = events.find(event => event.event === 'shot');
    assert.equal(shot.hits, 0);
    assert.ok(shot.pellets.every(pellet => pellet.stop === 'solid'));
  }
});

test('north and north-east arrivals route around either end of the screen without intersecting a solid', () => {
  const cases = [
    { startX: 0, targetX: -5.2, passage: INTERIOR_PASSAGES[0], name: 'north to western retreat' },
    { startX: 0, targetX: 6, passage: INTERIOR_PASSAGES[1], name: 'north to eastern retreat' },
    { startX: 7, targetX: 0, passage: INTERIOR_PASSAGES[1], name: 'former north-east dead end to living room' },
  ];
  for (const scenario of cases) for (const boss of [false, true]) {
    const simulation = new RoomSimulation('DETOUR', { random: () => .5 });
    const player = simulation.addPlayer('a'); simulation.start('a');
    simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 1000;
    Object.assign(player, { x: scenario.targetX, z: 1.3, y: 0, hp: 10000 });
    const zombie = simulation.spawnZombie();
    Object.assign(zombie, { x: scenario.startX, z: -4.8, y: 0, entered: true, entryTarget: null,
      kind: boss ? 'brute' : 'walker', boss, scale: boss ? 1.32 : 1, speed: 2 });
    const radius = .29 * zombie.scale;
    let crossed = false;
    for (let tick = 0; tick < 30 * 35 && player.hp === 10000; tick++) {
      const beforeZ = zombie.z;
      simulation.tick();
      assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius), true, `${scenario.name}: each moving body clears real solids`);
      if (beforeZ < -2 && zombie.z >= -2) {
        assert.ok(zombie.x > scenario.passage.minX + radius && zombie.x < scenario.passage.maxX - radius, `${scenario.name}: the whole ${boss ? 'boss' : 'walker'} crosses the intended end`);
        crossed = true;
      }
    }
    assert.ok(crossed, `${scenario.name}: the ${boss ? 'boss' : 'walker'} leaves the north strip`);
    assert.ok(zombie.z > -1.5, `${scenario.name}: the living room is reached`);
    assert.ok(player.hp < 10000, `${scenario.name}: the survivor remains reachable after the detour`);
  }
});

test('waist-high cover hides a crouched eye while leaving a standing view and routes at both ends', () => {
  const cover = INTERIOR_WALLS.find(wall => wall.kind === 'low-cover');
  assert.equal(cover.height, 1.15);
  assert.ok(cover.height > .95 && cover.height < 1.55);
  const floor = reachableFloor(0, .29 * 1.32);
  for (const point of [{ x: .9, z: 2.1 }, { x: .9, z: 5.1 }, { x: 1.6, z: 3.6 }, { x: .2, z: 3.6 }]) {
    assert.ok(floor.some(candidate => Math.hypot(candidate.x - point.x, candidate.z - point.z) < .3), `${JSON.stringify(point)} is reachable around low cover`);
  }
});

test('the authoritative boss AI can return north through both open ends', () => {
  assert.equal(INTERIOR_PASSAGES.length, 2);
  for (const passage of INTERIOR_PASSAGES) {
    const x = (passage.minX + passage.maxX) / 2, z = (passage.minZ + passage.maxZ) / 2;
    const simulation = new RoomSimulation('LAYOUT', { random: () => .5 });
    const player = simulation.addPlayer('a'); simulation.start('a');
    simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 1000;
    Object.assign(player, { x, z: z - 1.4, y: passage.baseY, hp: 10000 });
    const zombie = simulation.spawnZombie();
    Object.assign(zombie, { x: x + .4, z: z + .6, y: passage.baseY, entered: true, entryTarget: null, kind: 'brute', boss: true, scale: 1.32, speed: 2 });
    let crossed = false;
    for (let tick = 0; tick < 450; tick++) {
      simulation.tick();
      assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29 * zombie.scale), true, `${passage.id}: the boss body never overlaps an obstacle`);
      crossed ||= zombie.z < passage.minZ - .2;
    }
    assert.ok(crossed, `${passage.id}: the boss must pass beyond the wall, not merely approach it`);
    assert.ok(player.hp < 10000, `${passage.id}: a living survivor beyond the screen is reachable`);
  }
});

test('the authoritative boss AI walks around waist-high cover instead of hitting through it', () => {
  const simulation = new RoomSimulation('LAYOUT', { random: () => .5 });
  const player = simulation.addPlayer('a'); simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 1000;
  Object.assign(player, { x: 2.5, z: 3.6, y: 0, hp: 10000 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: -1, z: 3.6, y: 0, entered: true, entryTarget: null, kind: 'brute', boss: true, scale: 1.32, speed: 2 });
  let usedEnd = false;
  for (let tick = 0; tick < 450; tick++) {
    simulation.tick();
    if (zombie.z < 2.4 || zombie.z > 4.8) usedEnd = true;
  }
  assert.ok(usedEnd, 'the boss must go around one end of the wall');
  assert.ok(zombie.x > 1.4);
  assert.ok(player.hp < 10000);
});

test('zombies approach a survivor beneath the high stairs on the ground and after descending from the loft', () => {
  for (const fromLoft of [false, true]) for (const boss of [false, true]) {
    const simulation = new RoomSimulation('UNDERPASS', { random: () => .5 });
    const player = simulation.addPlayer('a'); simulation.start('a');
    simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 1000;
    Object.assign(player, { x: stairX, z: -.6, y: 0, hp: 10000 });
    assert.equal(simulation.canOccupy(player, player.x, player.z, 0, .25), true, 'the standing underpass target starts in physical free space');
    const zombie = simulation.spawnZombie();
    Object.assign(zombie, { x: 5.5, z: fromLoft ? -4 : -.6, y: fromLoft ? STAIRS.topY : 0,
      entered: true, entryTarget: null, kind: boss ? 'brute' : 'walker', boss, scale: boss ? 1.32 : 1, speed: 2 });
    const radius = .29 * zombie.scale;
    assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius), true, 'the pursuing body starts in physical free space');
    let reachedGround = !fromLoft;
    for (let tick = 0; tick < 30 * 35 && player.hp === 10000; tick++) {
      simulation.tick();
      reachedGround ||= zombie.y < .3;
      assert.equal(player.y, 0, 'standing underneath never selects an overhead tread as the player floor');
      assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius), true, 'the entire pursuing body stays clear of the staircase and partition');
    }
    assert.ok(reachedGround, `${boss ? 'boss' : 'walker'} descends instead of stopping above a ground-level target`);
    assert.ok(player.hp < 10000, `${boss ? 'boss' : 'walker'} reaches the underpass target from ${fromLoft ? 'the loft' : 'the ground floor'}`);
  }
});

const { createWorld } = await importPublicModule('world.js');

test('rendered Three.js partitions match every server AABB and leave both ends clear of old frames', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
  try {
    // Per-mesh clearance needs the unfused build; world-merge.test.mjs proves
    // the merged build has identical triangles and bounds.
    const world = createWorld(new THREE.Scene(), { mergeStatic: false });
    world.root.updateMatrixWorld(true);
    const meshes = [];
    world.root.traverse(node => { if (node.isMesh) meshes.push(node); });
    for (const wall of INTERIOR_WALLS) {
      const mesh = meshes.find(node => node.userData.layoutId === wall.id);
      assert.ok(mesh && world.rayBlockers.includes(mesh), `${wall.id}: rendered and registered for visual ray casts`);
      const actual = new THREE.Box3().setFromObject(mesh);
      for (const [value, expected] of [[actual.min.x, wall.minX], [actual.max.x, wall.maxX], [actual.min.z, wall.minZ], [actual.max.z, wall.maxZ], [actual.min.y, wall.baseY], [actual.max.y, wall.baseY + wall.height]]) assert.ok(Math.abs(value - expected) < 1e-6);
    }
    assert.equal(INTERIOR_PASSAGES.length, 2, 'the mesh clearance check measures both real open ends');
    for (const passage of INTERIOR_PASSAGES) for (const mesh of meshes) {
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.max.y <= passage.baseY + .02) continue; // existing 8 mm decorative floor seams
      if (!overlaps(passage, { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, baseY: box.min.y, height: box.max.y - box.min.y })) continue;
      // Rotated stair stringers have broad axis-aligned envelopes. Measure
      // their real oriented volume rather than falsely filling the air below.
      mesh.geometry.computeBoundingBox();
      const physicalMesh = new OBB().fromBox3(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      const clearRoute = new THREE.Box3(
        new THREE.Vector3(passage.minX + 1e-6, passage.baseY + .02, passage.minZ + 1e-6),
        new THREE.Vector3(passage.maxX - 1e-6, passage.baseY + passage.height - 1e-6, passage.maxZ - 1e-6),
      );
      assert.ok(!physicalMesh.intersectsBox3(clearRoute), `${passage.id}: mesh ${mesh.userData.layoutId ?? mesh.id} at ${mesh.position.toArray()} must not intrude into the clear opening`);
    }
  } finally { globalThis.document = previous; }
});
