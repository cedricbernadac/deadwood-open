import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { setLanguage } from '../public/i18n.js';
import { EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, wallOpenings } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld } = await importPublicModule('world.js');

function withCanvas(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const calls = [];
      const context = new Proxy({
        calls,
        measureText(value) { return { width: value.length * Number.parseInt(this.font?.match(/\d+/)?.[0] ?? 42) * .6 }; },
        fillText(value) { calls.push(value); },
      }, { get: (object, key) => key in object ? object[key] : () => {} });
      return { width: 0, height: 0, getContext: () => context };
    },
  };
  try { run(); } finally { globalThis.document = previous; setLanguage('fr'); }
}

const signs = world => {
  const labels = [];
  world.root.traverse(node => { if (typeof node.userData.setLabel === 'function') labels.push(node); });
  return labels;
};
const labels = world => signs(world).map(mesh => mesh.userData.label);

test('inactive entrances become ordinary continuous timber walls, with no visible doorway or plate', () => withCanvas(() => {
  const world = createWorld(new THREE.Scene());
  const effectiveVisible = node => { for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return false; return true; };
  for (const exterior of EXTERIOR_WALLS) {
    const door = world.doors.get(exterior.id), { wall, seal, frame, openingSections, shelterSign } = door.userData;
    const opening = wallOpenings(exterior.id).find(item => item.door), timber = wall.material;
    assert.equal(seal.visible, false); assert.equal(frame.visible, true);
    // Honey planks since the storybook overhaul; the map is projected in world space.
    assert.equal(timber.color.getHex(), 0xbea690); assert.equal(timber.metalness, 0); assert.ok(timber.map);
    const adjacent = world.rayBlockers.find(mesh => mesh.material === timber && mesh.geometry.parameters.height === 6.5);
    assert.ok(adjacent); assert.equal(wall.material, adjacent.material, 'same wood, grain scale and colour on both faces');
    assert.deepEqual(Array.from(wall.geometry.attributes.uv.array), Array.from(adjacent.geometry.attributes.uv.array));
    assert.deepEqual([wall.geometry.parameters.width, wall.geometry.parameters.height, wall.geometry.parameters.depth],
      exterior.axis === 'x' ? [opening.width, 6.5, EXTERIOR_WALL_THICKNESS] : [EXTERIOR_WALL_THICKNESS, 6.5, opening.width]);
    assert.deepEqual(wall.position.toArray(), exterior.axis === 'x' ? [opening.center, 3.25, exterior.fixed] : [exterior.fixed, 3.25, opening.center]);
    world.setDoor(exterior.id, 1, [60, 60, 60, 60, 60], true);
    assert.equal(seal.visible, true); assert.equal(frame.visible, false); assert.equal(shelterSign.visible, false);
    assert.ok(openingSections.every(section => !section.visible), 'upper old panel does not overlap the new full-height wall');
    assert.ok(door.userData.boards.every(board => !effectiveVisible(board)));
    frame.traverse(node => assert.equal(effectiveVisible(node), false, 'jambs, planks and direction sign all disappear'));
    assert.equal(seal.children.length, 1, 'one plain wall, no steel, rivets or labels');
    assert.equal(door.userData.plate, undefined); assert.equal(seal.children.some(node => node.userData.label), false);
    world.setLanguage('en');
    world.setDoor(exterior.id, .4, [60, 0, 60, 0, 0], false);
    assert.equal(seal.visible, false); assert.equal(frame.visible, true); assert.equal(shelterSign.visible, true);
    assert.ok(openingSections.every(section => section.visible));
    assert.deepEqual(door.userData.boards.map(board => board.visible), [true, false, true, false, false]);
  }
  let before = 0; world.root.traverse(() => before++);
  for (let index = 0; index < 50; index++) for (const id of world.doors.keys()) world.setDoor(id, 0, [0, 0, 0, 0, 0], index % 2 === 0);
  let after = 0; world.root.traverse(() => after++); assert.equal(after, before, 'wave changes reuse the same meshes');
}));

test('world signs start in the saved language, including all directions, crate names and unlock waves', () => withCanvas(() => {
  setLanguage('en');
  const world = createWorld(new THREE.Scene());
  const visible = labels(world);
  assert.equal(visible.filter(label => label === 'SHELTER · COME BACK SOON').length, 4);
  for (const direction of ['NORTH', 'SOUTH', 'WEST', 'EAST']) assert.ok(visible.includes(direction));
  assert.ok(visible.some(label => label.startsWith('MACHINE GUN ·')));
  assert.ok(visible.some(label => label.startsWith('SHOTGUN ·')));
  assert.ok(visible.includes('BONUS · WAVE 4'));
  assert.ok(visible.includes('BONUS · WAVE 6'));
  assert.ok(!visible.some(label => /VAGUE|MITRAILLEUSE|POMPE|REFUGE/.test(label)));
}));

test('switching world language repaints existing textures and preserves positions, geometry, materials and barricade state', () => withCanvas(() => {
  setLanguage('fr');
  const world = createWorld(new THREE.Scene());
  world.setDoor('north', 40, [24, 0, 24, 0, 0]);
  const before = signs(world).map(mesh => ({ mesh, label: mesh.userData.label, geometry: mesh.geometry, material: mesh.material, texture: mesh.material.map, version: mesh.material.map.version, position: mesh.position.toArray() }));
  const blockers = [...world.rayBlockers];
  const boards = world.doors.get('north').userData.boards.map(board => board.visible);
  let nodeCount = 0; world.root.traverse(() => nodeCount++);
  world.setLanguage('en');
  before.forEach(record => {
    assert.equal(record.mesh.geometry, record.geometry);
    assert.equal(record.mesh.material, record.material);
    assert.equal(record.mesh.material.map, record.texture);
    assert.deepEqual(record.mesh.position.toArray(), record.position);
    assert.equal(record.texture.version, record.version + Number(record.mesh.userData.label !== record.label));
  });
  assert.deepEqual(world.rayBlockers, blockers);
  assert.deepEqual(world.doors.get('north').userData.boards.map(board => board.visible), boards);
  let afterCount = 0; world.root.traverse(() => afterCount++); assert.equal(afterCount, nodeCount);
  world.setLanguage('fr');
  for (const direction of ['NORD', 'SUD', 'OUEST', 'EST']) assert.ok(labels(world).includes(direction));
  assert.ok(labels(world).includes('BONUS · VAGUE 4'));
  assert.ok(labels(world).some(label => label.startsWith('MITRAILLEUSE ·')));
}));

test('reapplying a language does not upload unchanged signs and unsupported languages return to French', () => withCanvas(() => {
  setLanguage('fr');
  const world = createWorld(new THREE.Scene());
  const versions = signs(world).map(mesh => mesh.material.map.version);
  world.setLanguage('fr');
  assert.deepEqual(signs(world).map(mesh => mesh.material.map.version), versions);
  world.setLanguage('en'); world.setLanguage('unsupported');
  assert.ok(labels(world).includes('NORD'));
  assert.ok(labels(world).includes('REFUGE · REVIENS VITE'));
}));
