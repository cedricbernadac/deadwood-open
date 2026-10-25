import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { applyWeaponViewPose, copyWeaponMuzzleInView } from '../public/weapon-view.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const world = await importPublicModule('world.js');
const firearms = ['pistol', 'smg', 'assault', 'rifle', 'minigun', 'sniper', 'shotgun', 'magnum', 'rocket', 'flamethrower'];
const shotRecoil = { pistol: .045, minigun: .025, sniper: .14, shotgun: .13, magnum: .18, rocket: .12, flamethrower: .008 };
const states = [{}, { time: 1, moving: true, bob: .028 }, { reloading: true, bob: .028 }];

function vertices(gun, visit) {
  gun.updateMatrixWorld(true);
  gun.traverse(node => {
    if (!node.isMesh) return;
    const positions = node.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) visit(node.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index)));
  });
}

test('FPS weapon geometry leaves the central aiming band clear during idle, walking, recoil and reload', () => {
  for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
    const camera = new THREE.PerspectiveCamera(76, aspect, .06, 130); camera.updateMatrixWorld(true);
    for (const type of firearms) {
      const gun = world.createWeapon(type);
      for (const state of [...states, { bob: .028, recoil: shotRecoil[type] ?? .06 }]) {
        applyWeaponViewPose(gun, state);
        vertices(gun, point => {
          assert.ok(point.z < -camera.near, `${type}: no near-plane clipping during ${JSON.stringify(state)}`);
          point.project(camera);
          // All vertices are below this band, so every triangle is too.
          assert.ok(point.y < -.12, `${type}: central +/-6% screen-height band stays clear`);
        });
      }
    }
  }
});

test('compact sidearms occupy less screen width than the long and heavy weapons using their true artwork', () => {
  const camera = new THREE.PerspectiveCamera(76, 16 / 9, .06, 130); camera.updateMatrixWorld(true);
  const widths = {};
  for (const type of ['pistol', 'smg', 'assault', 'rifle', 'minigun', 'sniper']) {
    const gun = world.createWeapon(type);
    // The final four root meshes are the FPS hands and sleeves (the support
    // hand's sleeve since the weapon-racks lot), whose human dimensions
    // intentionally stay constant rather than scaling per gun.
    gun.children.slice(-4).forEach(node => node.removeFromParent());
    applyWeaponViewPose(gun);
    const bounds = new THREE.Box2();
    vertices(gun, point => { point.project(camera); bounds.expandByPoint(new THREE.Vector2(point.x, point.y)); });
    widths[type] = (Math.min(1, bounds.max.x) - Math.max(-1, bounds.min.x)) / 2;
  }
  assert.ok(widths.pistol < widths.smg * .65);
  for (const type of ['assault', 'rifle', 'minigun', 'sniper']) assert.ok(widths[type] > widths.smg * 1.25, `${type} is visibly broader than the compact SMG`);
  assert.ok(widths.sniper > widths.assault);
});

test('camera-space muzzle follows each real transformed barrel through firing and reloading', () => {
  for (const type of firearms) for (const state of [...states, { recoil: shotRecoil[type] ?? .06 }]) {
    const gun = world.createWeapon(type); applyWeaponViewPose(gun, state); gun.updateMatrixWorld(true);
    const expected = gun.localToWorld(gun.userData.muzzle.clone());
    assert.ok(copyWeaponMuzzleInView(gun, new THREE.Vector3()).distanceTo(expected) < 1e-12, `${type}: transformed muzzle`);
  }
});

test('pose animation preserves the existing additive movement, recoil and reload, without resizing artwork or melee motion', () => {
  for (const type of firearms) {
    const gun = world.createWeapon(type), geometry = [], scale = gun.scale.clone();
    gun.traverse(node => { if (node.isMesh) geometry.push(node.geometry); });
    applyWeaponViewPose(gun); const position = gun.position.clone(), rotation = gun.rotation.clone();
    assert.deepEqual(rotation.toArray().slice(0, 3), [0, -.018, 0], `${type}: original inclination`);
    applyWeaponViewPose(gun, { time: 0, bob: .02, recoil: .04, reloading: true });
    assert.ok(Math.abs(gun.position.y - position.y - .014 + .16) < 1e-12);
    assert.ok(Math.abs(gun.position.z - position.z - .04) < 1e-12);
    assert.ok(Math.abs(gun.rotation.x - rotation.x - .026 + .35) < 1e-12);
    assert.deepEqual(gun.scale, scale);
    const after = []; gun.traverse(node => { if (node.isMesh) after.push(node.geometry); }); assert.deepEqual(after, geometry);
  }
  for (const type of ['bat', 'hammer', 'fireaxe', 'katana']) {
    const gun = world.createWeapon(type), pivot = gun.userData.meleePivot;
    world.animateMeleeWeapon(gun, { attack: 'heavy', elapsed: .2 }); const swing = pivot.rotation.clone();
    applyWeaponViewPose(gun);
    assert.deepEqual(gun.position.toArray(), [.32, -.28, -.48]);
    assert.deepEqual(gun.rotation.toArray().slice(0, 3), [0, -.018, 0]);
    assert.deepEqual(pivot.rotation.toArray(), swing.toArray());
  }
});
