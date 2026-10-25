import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SPAWN_ENTRIES, FUEL_CACHES, EXTERIOR } from '../public/rules.js';
import { SUPPLY_CACHES } from '../public/expedition.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createGroundDecor, decorAllowed, GROUND_DECOR } = await importPublicModule('ground-decor.js');
const { createSplinterPool, SPLINTERS } = await importPublicModule('splinters.js');

const instances = group => {
  const list = [], matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  for (const mesh of group.children) {
    mesh.geometry.computeBoundingBox();
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix); matrix.decompose(position, quaternion, scale);
      list.push({ name: mesh.name, x: position.x, y: position.y, z: position.z, top: position.y + mesh.geometry.boundingBox.max.y * scale.y });
    }
  }
  return list;
};

test('ground decor is walk-through: flat, instanced and out of every lane', () => {
  const decor = createGroundDecor({ density: 1 });
  assert.equal(decor.children.length, 6, 'six instanced draw calls whatever the density');
  assert.ok(decor.children.every(mesh => mesh.isInstancedMesh && !mesh.castShadow));
  const placed = instances(decor);
  assert.ok(placed.length > 3000);
  for (const item of placed) {
    assert.ok(item.top <= GROUND_DECOR.maxHeight + 1e-6, `${item.name} stays below ${GROUND_DECOR.maxHeight} m (${item.top.toFixed(3)})`);
    assert.ok(Math.abs(item.y) < 1e-9, 'rooted on the ground');
    assert.ok(decorAllowed(item.x, item.z));
    assert.ok(!(Math.abs(item.x) < 9.8 && Math.abs(item.z) < 7.8), 'never inside or against the cabin');
    for (const entry of SPAWN_ENTRIES) assert.ok(Math.hypot(item.x - entry.x, item.z - entry.z) >= 1.7, `clear of ${entry.id}`);
    for (const cache of [...FUEL_CACHES, ...SUPPLY_CACHES]) assert.ok(Math.hypot(item.x - cache.x, item.z - cache.z) >= 2.3);
    assert.ok(item.x > EXTERIOR.bounds.minX && item.x < EXTERIOR.bounds.maxX && item.z > EXTERIOR.bounds.minZ && item.z < EXTERIOR.bounds.maxZ);
  }
  // Trails around the cabin and to the far clearings stay bare.
  for (const [x, z] of [[0, 7.8], [0, -7.8], [9.8, 0], [-9.8, 0], [-30, 10], [30, -10]]) assert.equal(decorAllowed(x, z), false);
});

test('decor follows the quality density and is the same on every machine', () => {
  const counts = density => createGroundDecor({ density }).userData.counts;
  const low = counts(.35), high = counts(1);
  for (const key of Object.keys(high)) assert.ok(low[key] < high[key] || high[key] === 0, key);
  const a = instances(createGroundDecor({ density: .7 })), b = instances(createGroundDecor({ density: .7 }));
  assert.deepEqual(a, b);
  assert.equal(createGroundDecor({ density: 0 }).children.every(mesh => mesh.count === 0), true);
});

test('barricade splinters come from one pre-built pool and vanish', () => {
  const pool = createSplinterPool(), matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
  const visible = () => { let total = 0; for (let index = 0; index < pool.mesh.count; index++) { pool.mesh.getMatrixAt(index, matrix); scale.setFromMatrixScale(matrix); if (scale.x > .01) total++; } return total; };
  assert.equal(pool.mesh.count, SPLINTERS.bursts * SPLINTERS.chips);
  assert.equal(visible(), 0);
  const children = pool.mesh.children.length;
  pool.burst(new THREE.Vector3(0, 1, -6.5), new THREE.Vector3(0, 0, -1), 10);
  pool.update(10.1);
  assert.equal(visible(), SPLINTERS.chips, 'one burst of chips flies');
  const centre = new THREE.Vector3(); pool.mesh.getMatrixAt(0, matrix); centre.setFromMatrixPosition(matrix);
  assert.ok(centre.z < -6.5, 'chips fly outwards');
  for (let burst = 0; burst < SPLINTERS.bursts + 2; burst++) pool.burst(new THREE.Vector3(burst, 1, 0), null, 11);
  pool.update(11.05);
  assert.ok(visible() <= pool.mesh.count, 'the pool recycles its oldest bursts');
  pool.update(11 + SPLINTERS.duration + .01);
  assert.equal(visible(), 0, 'every chip disappears');
  assert.equal(pool.mesh.children.length, children, 'no node is ever created');
  pool.burst(undefined, undefined, NaN); pool.update(NaN);
});
