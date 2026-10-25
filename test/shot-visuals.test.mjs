import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { applyWeaponViewPose, copyWeaponMuzzleInView } from '../public/weapon-view.js';
import { shotMuzzleFromView, safeTracerStart } from '../public/shot-visuals.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWeapon } = await importPublicModule('world.js');
const firearms = ['pistol', 'smg', 'assault', 'rifle', 'minigun', 'sniper', 'shotgun', 'magnum', 'rocket'];
const vector = point => new THREE.Vector3(point.x, point.y, point.z);
const point = value => Object.freeze({ x: value.x, y: value.y, z: value.z });
const direction = (yaw, pitch) => new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));

test('shot-space muzzle reconstruction matches real Three.js YXZ cameras and animated weapons', () => {
  const eye = point(new THREE.Vector3(2.5, 4.95, -7));
  for (const weapon of firearms) {
    const gun = createWeapon(weapon), camera = new THREE.PerspectiveCamera();
    camera.add(gun); camera.position.copy(eye);
    for (const state of [{}, { moving: true, time: .37, bob: .028, recoil: .06 }, { reloading: true }]) {
      applyWeaponViewPose(gun, state);
      const offset = point(copyWeaponMuzzleInView(gun, new THREE.Vector3()));
      for (const yaw of [-Math.PI, -.7, 0, Math.PI / 2, Math.PI]) for (const pitch of [-1.2, 0, .8]) {
        camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.updateMatrixWorld(true);
        const expected = gun.localToWorld(gun.userData.muzzle.clone());
        const actual = shotMuzzleFromView(eye, yaw, pitch, offset);
        assert.ok(actual && vector(actual).distanceTo(expected) < 1e-12, `${weapon}: ${yaw}/${pitch}`);
      }
    }
  }
});

test('captured view-space muzzle stays anchored to the confirmed shot after later movement, turning and reloading', () => {
  const eye = point(new THREE.Vector3(1, 1.55, 2)), yaw = .4, pitch = -.12;
  const gun = createWeapon('rifle'), camera = new THREE.PerspectiveCamera();
  camera.position.copy(eye); camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.add(gun);
  applyWeaponViewPose(gun, { recoil: .03 }); camera.updateMatrixWorld(true);
  const expected = gun.localToWorld(gun.userData.muzzle.clone());
  const captured = point(copyWeaponMuzzleInView(gun, new THREE.Vector3()));
  camera.position.set(8, 6, -8); camera.rotation.set(.5, yaw + Math.PI / 2, 0, 'YXZ');
  applyWeaponViewPose(gun, { reloading: true, recoil: .06 }); camera.updateMatrixWorld(true);
  const current = gun.localToWorld(gun.userData.muzzle.clone());
  assert.ok(current.distanceTo(expected) > 3, 'the live barrel has moved enough to corrupt an old trace');
  assert.ok(vector(shotMuzzleFromView(eye, yaw, pitch, captured)).distanceTo(expected) < 1e-12);
});

test('a real barrel past a wall 38 cm ahead produces a forward ray rather than a backwards or sideways tracer', () => {
  const eye = point(new THREE.Vector3(-1, 1.55, -1.5));
  for (const weapon of firearms) for (const [yaw, pitch] of [[0, 0], [.8, .3], [-2, -.5]]) {
    const gun = createWeapon(weapon); applyWeaponViewPose(gun);
    const aim = direction(yaw, pitch), end = point(vector(eye).addScaledVector(aim, .38));
    const muzzle = shotMuzzleFromView(eye, yaw, pitch, copyWeaponMuzzleInView(gun, new THREE.Vector3()));
    assert.ok(vector(muzzle).sub(eye).dot(aim) > .38, `${weapon}: barrel really passes through the wall`);
    const start = safeTracerStart(eye, end, muzzle);
    assert.ok(start, weapon);
    const travel = vector(end).sub(start);
    assert.ok(travel.dot(aim) > 0, `${weapon}: never shoots backwards`);
    assert.ok(travel.clone().normalize().distanceTo(aim) < 1e-12, `${weapon}: no sideways line across the screen`);
    assert.ok(vector(start).distanceTo(eye) < .38 && vector(start).distanceTo(end) < .38);
  }
});

test('zero and very short stopped rays have no streak; short visible rays remain inside their authoritative segment', () => {
  const eye = point(new THREE.Vector3(2, 1.55, 3));
  for (const distance of [0, .01, .04, .05]) {
    const end = point(vector(eye).add(new THREE.Vector3(0, 0, -distance)));
    assert.equal(safeTracerStart(eye, end, { x: 2.4, y: 1.2, z: 1 }), null, `${distance} m`);
  }
  for (const distance of [.051, .1, .2, .38]) {
    const end = point(vector(eye).add(new THREE.Vector3(0, 0, -distance)));
    const start = safeTracerStart(eye, end, { x: 2.4, y: 1.2, z: 1 });
    assert.ok(start.z < eye.z && start.z > end.z);
    assert.equal(start.x, eye.x); assert.equal(start.y, eye.y);
  }
});

test('long visible shots retain their real barrel and exact endpoint without mutating captured geometry', () => {
  const eye = point(new THREE.Vector3(-3, 4.95, 8)), aim = direction(.7, -.22);
  const gun = createWeapon('sniper'); applyWeaponViewPose(gun);
  const muzzle = point(shotMuzzleFromView(eye, .7, -.22, copyWeaponMuzzleInView(gun, new THREE.Vector3())));
  const end = point(vector(eye).addScaledVector(aim, 70));
  const before = JSON.stringify({ eye, muzzle, end });
  const start = safeTracerStart(eye, end, muzzle);
  assert.deepEqual(start, muzzle);
  assert.ok(vector(end).distanceTo(eye) > 69.999999999);
  assert.ok(vector(end).sub(start).normalize().angleTo(aim) < .01);
  assert.equal(JSON.stringify({ eye, muzzle, end }), before);
  assert.notEqual(start, muzzle, 'the returned point does not alias the stored muzzle');
});

test('stale lateral and backwards muzzles safely fall back to the shot ray', () => {
  const eye = point(new THREE.Vector3(0, 1.55, 0)), end = point(new THREE.Vector3(0, 1.55, -2));
  for (const muzzle of [{ x: 4, y: 1.2, z: -1 }, { x: 0, y: 1.55, z: 1 }, { x: 0, y: 1.55, z: -3 }]) {
    const start = safeTracerStart(eye, end, muzzle);
    assert.equal(start.x, 0); assert.equal(start.y, eye.y);
    assert.ok(start.z < eye.z && start.z > end.z);
  }
});

test('invalid shot geometry cannot create NaN trails, while an unavailable muzzle can use a valid confirmed ray', () => {
  const eye = { x: 0, y: 1.55, z: 0 }, end = { x: 0, y: 1.55, z: -5 }, offset = { x: .3, y: -.3, z: -1 };
  for (const invalid of [null, { x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: 0, z: 0 }]) {
    assert.equal(shotMuzzleFromView(invalid, 0, 0, offset), null);
    assert.equal(shotMuzzleFromView(eye, 0, 0, invalid), null);
    assert.equal(safeTracerStart(invalid, end, offset), null);
    assert.equal(safeTracerStart(eye, invalid, offset), null);
    const start = safeTracerStart(eye, end, invalid);
    assert.ok(start && Object.values(start).every(Number.isFinite));
    assert.equal(start.x, 0); assert.equal(start.y, eye.y); assert.ok(start.z < 0 && start.z > -5);
  }
  for (const invalid of [NaN, Infinity, undefined]) {
    assert.equal(shotMuzzleFromView(eye, invalid, 0, offset), null);
    assert.equal(shotMuzzleFromView(eye, 0, invalid, offset), null);
  }
});
