import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createPickup, setPickupFill, animatePickup } = await importPublicModule('world.js');

const meshes = group => {
  const result = [];
  group.traverse(child => { if (child.isMesh) result.push(child); });
  return result;
};

test('loot models stay small above their floor and use no light or external texture', () => {
  for (const [kind, special] of [['points', false], ['ammo', false], ['ammo', true], ['health', false], ['armor', false], ['revive', false]]) {
    const pickup = createPickup(kind, special);
    assert.equal(pickup.userData.kind, kind);
    assert.equal(pickup.userData.special, special);
    const bounds = new THREE.Box3().setFromObject(pickup);
    assert.ok(bounds.min.y >= 0, 'nothing clips through its authoritative floor');
    assert.ok(bounds.max.y < .4);
    assert.ok(bounds.getSize(new THREE.Vector3()).length() < 1);
    assert.ok(meshes(pickup).length <= 24, 'limited draw calls per item, including fill indicators');
    pickup.traverse(child => {
      assert.ok(!child.isLight, 'the number of drops never adds dynamic lights');
      if (child.isMesh) {
        assert.ok(!child.material.map);
        for (const value of child.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
      }
    });
  }
});

test('successive pickups reuse GPU resources while their animation stays independent', () => {
  for (const kind of ['points', 'ammo', 'health', 'armor']) {
    const first = createPickup(kind), second = createPickup(kind);
    const firstMeshes = meshes(first), secondMeshes = meshes(second);
    assert.equal(firstMeshes.length, secondMeshes.length);
    firstMeshes.forEach((mesh, index) => {
      assert.notEqual(mesh, secondMeshes[index]);
      assert.equal(mesh.geometry, secondMeshes[index].geometry);
      assert.equal(mesh.material, secondMeshes[index].material);
    });
    first.userData.phase = second.userData.phase = 0;
    animatePickup(first, 2);
    assert.equal(second.userData.model.rotation.y, 0);
    assert.equal(second.userData.model.position.y, 0);
    assert.equal(second.userData.halo.scale.x, 1);
  }
});

test('floating animation preserves the server anchor at ground, loft and stair height', () => {
  for (const kind of ['points', 'ammo', 'health', 'armor']) {
    for (const y of [0, 3.4, 1.7]) {
      const pickup = createPickup(kind);
      pickup.position.set(2, y, -3); pickup.rotation.y = .7; pickup.userData.phase = 0;
      for (let index = 0; index < 90; index++) {
        animatePickup(pickup, index / 7);
        assert.deepEqual(pickup.position.toArray(), [2, y, -3]);
        assert.equal(pickup.rotation.y, .7);
        assert.deepEqual(pickup.scale.toArray(), [1, 1, 1]);
        const bounds = new THREE.Box3().setFromObject(pickup);
        assert.ok(bounds.min.y >= y);
        assert.ok(bounds.max.y < y + .45);
        assert.ok(pickup.userData.model.position.y >= .006 - 1e-10);
        assert.ok(pickup.userData.model.position.y <= .038 + 1e-10);
        assert.equal(pickup.userData.halo.position.y, .014);
      }
      animatePickup(pickup, NaN);
      assert.ok(Number.isFinite(pickup.userData.model.rotation.y));
    }
  }
});

test('ammo special marking changes color without changing its silhouette or animation', () => {
  const ordinary = createPickup('ammo'), special = createPickup('ammo', true);
  assert.deepEqual(new THREE.Box3().setFromObject(ordinary).getSize(new THREE.Vector3()).toArray(), new THREE.Box3().setFromObject(special).getSize(new THREE.Vector3()).toArray());
  const ordinaryColors = new Set(meshes(ordinary).map(mesh => mesh.material.color.getHex()));
  const specialColors = new Set(meshes(special).map(mesh => mesh.material.color.getHex()));
  assert.ok(specialColors.has(0xe8c26b));
  assert.ok(!ordinaryColors.has(0xe8c26b));
  ordinary.userData.phase = special.userData.phase = 0;
  animatePickup(ordinary, 2); animatePickup(special, 2);
  assert.deepEqual(ordinary.userData.model.position.toArray(), special.userData.model.position.toArray());
  assert.deepEqual(ordinary.userData.model.rotation.toArray(), special.userData.model.rotation.toArray());
});

test('partial ammo fill changes only that instance and keeps its world anchor and shared materials', () => {
  const full = createPickup('ammo'), partial = createPickup('ammo', true, .9);
  partial.position.set(2, 3.4, -3);
  const indicator = partial.getObjectByName('ammoFill'), fullIndicator = full.getObjectByName('ammoFill');
  assert.equal(indicator.scale.x, .9);
  assert.ok(Math.abs(indicator.position.x + .0125) < 1e-12);
  setPickupFill(partial, .25); animatePickup(partial, 3);
  assert.equal(indicator.scale.x, .25); assert.equal(indicator.position.x, -.09375);
  assert.deepEqual(partial.position.toArray(), [2, 3.4, -3]);
  assert.equal(fullIndicator.scale.x, 1); assert.equal(fullIndicator.position.x, 0);
  setPickupFill(partial, 0); assert.equal(indicator.visible, false);
  setPickupFill(partial, 2); assert.equal(indicator.scale.x, 1); assert.equal(indicator.visible, true);
  setPickupFill(partial, NaN); assert.equal(partial.userData.fill, 1);
  const next = createPickup('ammo', true); assert.equal(next.userData.fill, 1);
  meshes(partial).forEach((mesh, i) => assert.equal(mesh.material, meshes(next)[i].material));
});

test('health drop has a distinct medical silhouette and green cross on both faces', () => {
  const health = createPickup('health', true);
  assert.equal(health.userData.kind, 'health'); assert.equal(health.userData.special, false);
  const crosses = meshes(health).filter(mesh => mesh.material.color.getHex() === 0x67dd98);
  assert.ok(crosses.some(mesh => mesh.position.z > .12));
  assert.ok(crosses.some(mesh => mesh.position.z < -.12));
  assert.ok(meshes(health).some(mesh => mesh.material.color.getHex() === 0xe1e7d5));
  assert.ok(!meshes(health).some(mesh => mesh.material.color.getHex() === 0xe7b85a));
  setPickupFill(health, .2); assert.equal(health.userData.fill, undefined);
});

test('the armor vest is a flat plate carrier with a pale-blue chevron, not a money pouch', () => {
  const vest = createPickup('armor', true);
  assert.equal(vest.userData.kind, 'armor'); assert.equal(vest.userData.special, false);
  const chevron = meshes(vest).filter(mesh => mesh.material.color?.getHex() === 0x8fd0ff);
  assert.equal(chevron.length, 2);
  assert.ok(chevron[0].rotation.y * chevron[1].rotation.y < 0, 'two arms of a V');
  assert.ok(!meshes(vest).some(mesh => mesh.material.color?.getHex() === 0xe7b85a), 'no gold coins');
  const model = new THREE.Box3().setFromObject(vest.userData.model);
  assert.ok(model.max.y - model.min.y < .2 && model.max.z - model.min.z > .4, 'lies flat and long');
  setPickupFill(vest, .2); assert.equal(vest.userData.fill, undefined);
});
