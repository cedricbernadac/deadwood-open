import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { ballisticDistance } from '../public/ballistics.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WINDOWS, EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, DOOR_OPENING, wallOpenings } from '../public/layout.js';
import { ARMORY, armoryRackBounds } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';
import { RoomSimulation } from '../simulation.mjs';

// One shared definition: four glassless windows in a pinwheel stay open, the
// other four are nailed shut and solid for every shot, on server and screen.
const { createWorld } = await importPublicModule('world.js');

function renderedWorld() {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
  try {
    const world = createWorld(new THREE.Scene());
    world.root.updateMatrixWorld(true);
    return world;
  } finally { globalThis.document = previous; }
}
// World point at the middle of a window, `depth` metres into the room.
function windowPoint(window, depth = 0, y = (window.bottom + window.top) / 2) {
  const wall = EXTERIOR_WALLS.find(item => item.id === window.wall);
  const inward = -Math.sign(wall.fixed);
  return wall.axis === 'x'
    ? new THREE.Vector3(window.center, y, wall.fixed + inward * depth)
    : new THREE.Vector3(wall.fixed + inward * depth, y, window.center);
}

test('eight windows, one kept open per wall and per corner, the rest nailed shut', () => {
  assert.ok(Object.isFrozen(WINDOWS) && WINDOWS.every(Object.isFrozen));
  assert.equal(WINDOWS.length, 8);
  assert.deepEqual(WINDOWS.filter(window => window.open).map(window => `${window.wall}:${window.center}`).sort(),
    ['east:-3.5', 'north:-4.8', 'south:4.8', 'west:3.5']);
  for (const wall of EXTERIOR_WALLS) {
    assert.equal(WINDOWS.filter(window => window.wall === wall.id && window.open).length, 1, wall.id);
    assert.equal(WINDOWS.filter(window => window.wall === wall.id && !window.open).length, 1, wall.id);
    const solid = wallOpenings(wall.id), decorated = wallOpenings(wall.id, { includeBoarded: true });
    assert.deepEqual(solid.map(opening => opening.center), [...solid.map(opening => opening.center)].sort((a, b) => a - b));
    assert.equal(solid.length, 2, `${wall.id}: doorway plus its open window`);
    assert.equal(decorated.length, 3);
    assert.equal(solid.filter(opening => opening.door).length, 1);
    assert.equal(solid.find(opening => opening.door).width, DOOR_OPENING.width);
  }
  // Each corner of the cabin is watched from exactly one window.
  const corners = new Map();
  for (const window of WINDOWS.filter(item => item.open)) {
    const point = windowPoint(window);
    const key = `${Math.sign(point.x)}${Math.sign(point.z)}`;
    corners.set(key, (corners.get(key) ?? 0) + 1);
  }
  assert.deepEqual([...corners.values()], [1, 1, 1, 1]);
});

test('bullets leave through every open window and stop in every nailed-shut one', () => {
  for (const window of WINDOWS) {
    const events = [];
    const simulation = new RoomSimulation('WINDOW', { random: () => .5, onEvent: event => events.push(event) });
    const player = simulation.addPlayer('a'); simulation.start('a');
    const inside = windowPoint(window, 1.8, 0), outside = windowPoint(window, -4, 0);
    // Sample boarded windows beside their racks, so this checks the wall's
    // inner face rather than a suspended rack hanging just in front.
    const shift = window.id === 'west-a' ? .75 : window.id === 'north-b' ? -.75 : 0;
    const along = window.axis === 'x' ? 'x' : 'z';
    inside[along] += shift; outside[along] += shift;
    Object.assign(player, { x: inside.x, y: 0, z: inside.z, pitch: 0, yaw: Math.atan2(inside.x - outside.x, inside.z - outside.z) });
    const zombie = { id: 'z', x: outside.x, y: 0, z: outside.z, hp: 500, maxHp: 500, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity };
    simulation.zombies.set(zombie.id, zombie);
    assert.equal(simulation.shoot('a'), true);
    settleBallisticFlight(simulation);
    assert.equal(zombie.hp < 500, window.open, `${window.id} ${window.open ? 'lets the round through' : 'is solid'}`);
    const pellet = events.find(event => event.event === 'bullet-impact');
    const projectile = events.find(event => event.event === 'shot').projectiles[0];
    if (!window.open) {
      assert.equal(pellet.stop, 'solid');
      assert.ok(Math.abs(ballisticDistance(projectile, pellet.age) - (1.8 - EXTERIOR_WALL_THICKNESS / 2)) < .02, `${window.id}: stops at the inner face`);
    }
  }
});

test('the rendered walls match the server: open frames are empty, boarded ones fully block', () => {
  const world = renderedWorld();
  const blockers = world.rayBlockers.map(mesh => new THREE.Box3().setFromObject(mesh));
  for (const window of WINDOWS) {
    for (const y of [window.bottom + .05, (window.bottom + window.top) / 2, window.top - .05]) {
      for (const offset of [-.9, 0, .9]) {
        const point = windowPoint(window, 0, y);
        point[window.axis === 'x' ? 'x' : 'z'] += offset;
        assert.equal(blockers.some(box => box.containsPoint(point)), !window.open, `${window.id} at y=${y}, offset ${offset}`);
      }
    }
  }
  const meshes = [];
  world.root.traverse(node => { if (node.isMesh) meshes.push(node); });
  // No pane is left: only small shards of glass, and only in the open frames.
  const glass = meshes.filter(mesh => mesh.material?.transparent && mesh.material.opacity > .3 && mesh.material.opacity < .5 && mesh.geometry.type === 'ShapeGeometry');
  assert.equal(glass.length, 4 * 5);
  for (const shard of glass) {
    const box = new THREE.Box3().setFromObject(shard), size = box.getSize(new THREE.Vector3());
    assert.ok(Math.max(size.x, size.y, size.z) < .4, 'a shard, not a pane');
    const centre = box.getCenter(new THREE.Vector3());
    const window = WINDOWS.find(item => item.open && windowPoint(item, 0, centre.y).distanceTo(new THREE.Vector3(centre.x, centre.y, centre.z)) < 1.1);
    assert.ok(window, 'every shard sits in an open window frame');
    assert.ok(centre.y > window.bottom && centre.y < window.top);
  }
});

test('no weapon rack hangs in front of a window that stays open', () => {
  for (const crate of ARMORY.filter(item => item.y === 0)) {
    const rack = armoryRackBounds(crate);
    for (const window of WINDOWS.filter(item => item.open)) {
      const min = window.center - window.width / 2, max = window.center + window.width / 2;
      const [rackMin, rackMax] = window.axis === 'x' ? [rack.minX, rack.maxX] : [rack.minZ, rack.maxZ];
      const nearWall = window.axis === 'x' ? Math.abs((rack.minZ + rack.maxZ) / 2 - window.fixed) < 1 : Math.abs((rack.minX + rack.maxX) / 2 - window.fixed) < 1;
      const verticalOverlap = rack.baseY < window.top && rack.baseY + rack.height > window.bottom;
      assert.ok(!(nearWall && verticalOverlap && rackMin < max && rackMax > min), `${crate.id} rack covers open window ${window.id}`);
    }
  }
});
