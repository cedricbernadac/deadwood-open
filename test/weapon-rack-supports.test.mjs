import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

// The rack hooks hold the weapon (weapon-racks lot, 24 October 2026). Before
// it, the two hook posts stood at fixed x ±0.37 (±0.19 for the SMG) with
// their tops at y 1.385 while each weapon was centred at y 1.5: on six racks
// both posts missed the weapon, on most others it floated 33-189 mm above
// them, and on the diagonal bat, axe and katana a post went through it. Now
// each weapon type names two support points in its own frame, carried
// through the rack fit, and each post stands under one of them.
const world = await importPublicModule('world.js');
const weapons = await importPublicModule('frisson/weapons.js');
const { readGlb } = await importPublicModule('frisson/glb.js');
const { createArmoryRack, setWeaponStyle, getWeaponStyle } = world;
const TYPES = ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'magnum', 'assault', 'rocket', 'flamethrower', 'katana', 'hammer', 'sniper', 'bat', 'fireaxe'];
const RACK_BOX = { min: [-.65, .9, 0], max: [.65, 2.15, .22] };
const EPS = 1e-4;

// Every triangle under root, in the frame of `frame`.
function trianglesIn(root, frame) {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(frame.matrixWorld).invert(), triangles = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld), position = node.geometry.attributes.position, index = node.geometry.index;
    const vertex = at => new THREE.Vector3().fromBufferAttribute(position, at).applyMatrix4(matrix);
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) triangles.push([0, 1, 2].map(k => vertex(index ? index.getX(i + k) : i + k)));
  });
  return triangles;
}
// Sutherland-Hodgman against one axis-aligned plane.
function clip(polygon, axis, value, keepAbove) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const pIn = keepAbove ? p[axis] >= value : p[axis] <= value, qIn = keepAbove ? q[axis] >= value : q[axis] <= value;
    if (pIn) out.push(p);
    if (pIn !== qIn) out.push(p.clone().lerp(q, (value - p[axis]) / (q[axis] - p[axis])));
  }
  return out;
}
// The lowest weapon surface inside the vertical column over a box's
// footprint: exact for triangle meshes (each triangle clipped to the column).
// If it is at or above the box's top, no part of the weapon enters the box.
function lowestOver(triangles, { min, max }) {
  let lowest = Infinity;
  for (const triangle of triangles) {
    let polygon = triangle;
    for (const [axis, value, above] of [['x', min.x, true], ['x', max.x, false], ['z', min.z, true], ['z', max.z, false]]) {
      polygon = clip(polygon, axis, value, above);
      if (!polygon.length) break;
    }
    for (const point of polygon) lowest = Math.min(lowest, point.y);
  }
  return lowest;
}
// The rack's own parts in structure space (the structure has a unit scale:
// ARMORY_RACK is 1.3 x 1.25 x 0.22 with its base at 0.9).
function rackParts(type) {
  const root = createArmoryRack(type), structure = root.children[0];
  root.updateMatrixWorld(true);
  const gun = structure.getObjectByName(`rackWeapon-${type}`);
  // The hook parts are the rack's only small boxes: a 0.15 m post and its
  // 0.035 m front lip, twice (the board and the trims are 1.2-1.3 m long
  // in one direction or the other).
  const irons = structure.children.filter(node => node.isMesh && node !== gun && node.geometry.parameters?.height <= .15 + 1e-9 && node.geometry.parameters.width <= .07)
    .map(node => ({ node, box: new THREE.Box3().setFromObject(node) }));
  const posts = irons.filter(({ node }) => Math.abs(node.geometry.parameters.height - .15) < 1e-9);
  return { root, structure, gun, irons, posts, triangles: trianglesIn(gun, structure) };
}

test('every rack: two posts whose tops touch the weapon from below (within 5 mm), no hook inside the weapon', t => {
  setWeaponStyle(null);
  // Every rack is measured before judging, so a failure lists them all.
  const table = [], problems = [];
  for (const type of TYPES) {
    const { gun, irons, posts, triangles } = rackParts(type);
    assert.equal(posts.length, 2, `${type}: two hook posts`);
    assert.equal(irons.length, 4, `${type}: each post keeps its front lip, nothing more`);
    const gaps = posts.map(({ box }) => lowestOver(triangles, box) - box.max.y);
    const centres = posts.map(({ box }) => (box.min.x + box.max.x) / 2);
    table.push(`${type}: posts x ${centres.map(x => x.toFixed(3)).join('/')}, gap ${gaps.map(gap => Number.isFinite(gap) ? `${(gap * 1000).toFixed(1)} mm` : 'no weapon above').join(' / ')}`);
    for (const [index, gap] of gaps.entries()) {
      if (!Number.isFinite(gap)) problems.push(`${type} post ${index + 1}: no weapon above it`);
      else if (gap < -EPS) problems.push(`${type} post ${index + 1}: enters the weapon by ${(-gap * 1000).toFixed(1)} mm`);
      else if (gap > .005) problems.push(`${type} post ${index + 1}: ${(gap * 1000).toFixed(1)} mm under the weapon`);
    }
    for (const { box } of irons) {
      const lowest = lowestOver(triangles, box);
      if (lowest < box.max.y - EPS) problems.push(`${type}: the hook part at x ${((box.min.x + box.max.x) / 2).toFixed(3)}, top ${box.max.y.toFixed(3)} enters the weapon (lowest ${lowest.toFixed(3)})`);
    }
    // The weapon rests between its posts, not beside them.
    const bounds = new THREE.Box3().setFromObject(gun), centre = (bounds.min.x + bounds.max.x) / 2;
    const [left, right] = [...centres].sort((a, b) => a - b);
    if (!(left < centre && centre < right)) problems.push(`${type}: the weapon's centre ${centre.toFixed(3)} is not between its posts ${left.toFixed(3)} and ${right.toFixed(3)}`);
    if (right - left < .12) problems.push(`${type}: posts only ${(right - left).toFixed(3)} m apart`);
  }
  t.diagnostic(table.join('; '));
  assert.deepEqual(problems, [], table.join('\n'));
});

test('the whole rack, weapon included, stays inside the rack box (x ±0.65, y 0.90-2.15, z 0-0.22)', () => {
  setWeaponStyle(null);
  for (const type of TYPES) {
    const { structure } = rackParts(type);
    const inverse = new THREE.Matrix4().copy(structure.matrixWorld).invert();
    structure.traverse(node => {
      if (!node.isMesh) return;
      node.geometry.computeBoundingBox();
      const box = node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
      for (const [axis, index] of [['x', 0], ['y', 1], ['z', 2]]) {
        assert.ok(box.min[axis] >= RACK_BOX.min[index] - 1e-6 && box.max[axis] <= RACK_BOX.max[index] + 1e-6,
          `${type} ${node.name || node.material.name} ${axis}: ${box.min[axis].toFixed(4)} … ${box.max[axis].toFixed(4)}`);
      }
    });
  }
});

test('a Frisson style hangs the same weapon on the same posts (restyleArmory rebuilds only the weapon)', () => {
  const placement = () => TYPES.map(type => {
    const { gun, posts } = rackParts(type);
    return [type, gun.matrix.toArray().map(value => +value.toFixed(9)), posts.map(({ box }) => [box.min.x, box.max.y].map(value => +value.toFixed(9)))];
  });
  setWeaponStyle(null);
  const famille = placement();
  const style = weapons.createWeaponsStyle({ roots: weapons.weaponsFromGlb(readGlb(readFileSync(new URL('../public/frisson/weapons.glb', import.meta.url)))), quality: 'high' });
  setWeaponStyle(style);
  try { assert.deepEqual(placement(), famille); } finally { setWeaponStyle(null); style.dispose(); }
  assert.equal(getWeaponStyle(), null);
});

test('the supermarket, hospital and funfair hang their racks through the same builder', () => {
  for (const file of ['world-supermarket.js', 'world-hospital.js', 'world-funfair.js']) {
    const source = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.match(source, /factories\.createArmoryRack\(crate\.weapon\)/, `${file}: racks from world.js`);
    assert.match(source, /factories\.buildRackWeapon\(type\)/, `${file}: restyled through world.js`);
    assert.doesNotMatch(source, /rackIron/, `${file}: no hook posts of its own`);
  }
});
