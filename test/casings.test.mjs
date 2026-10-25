import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

const { CASINGS, CASING_KINDS, createCasingPool } = await importPublicModule('casings.js');

const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
const instance = (pool, index) => {
  pool.mesh.getMatrixAt(index, matrix); matrix.decompose(position, quaternion, scale);
  return { position: position.clone(), quaternion: quaternion.clone(), scale: scale.clone() };
};
const colorAt = (pool, index) => { const color = new THREE.Color(); pool.mesh.getColorAt(index, color); return color; };
const closeColor = (actual, hex) => {
  const expected = new THREE.Color(hex);
  return Math.abs(actual.r - expected.r) < 1e-6 && Math.abs(actual.g - expected.g) < 1e-6 && Math.abs(actual.b - expected.b) < 1e-6;
};

test('the pool pre-builds capacity * 2 hidden instances with the specified mesh flags', () => {
  const pool = createCasingPool();
  assert.equal(pool.mesh.count, CASINGS.capacity * 2);
  assert.equal(pool.mesh.name, 'ejectedCasings');
  assert.equal(pool.mesh.frustumCulled, false);
  assert.equal(pool.mesh.castShadow, false);
  assert.equal(pool.mesh.receiveShadow, false);
  assert.equal(pool.mesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
  assert.ok(pool.mesh.instanceColor, 'instance colours are initialised at creation');
  for (let index = 0; index < pool.mesh.count; index++) assert.equal(instance(pool, index).scale.x, 0, `instance ${index} hidden`);
  assert.equal(pool.count(), 0);
});

test('an upward-sideways casing rises, falls, never dips below the floor and rests before the fade', () => {
  const pool = createCasingPool({ capacity: 4, seed: 7 });
  assert.equal(pool.eject({ origin: { x: 0, y: 1, z: 0 }, velocity: { x: 2, y: 3, z: -1 }, time: 0, kind: 'rifle' }), true);
  const floorY = CASING_KINDS.rifle.radius;
  let peak = -Infinity;
  for (let step = 0; step <= 500; step++) {
    pool.update(step / 500 * 2);
    const { position } = instance(pool, 0);
    peak = Math.max(peak, position.y);
    assert.ok(position.y >= floorY - 1e-9, `above the floor at t=${step / 500 * 2}: ${position.y}`);
  }
  assert.ok(peak > 1.2, `it rose first (peak ${peak})`);
  pool.update(1.8); const a = instance(pool, 0).position;
  pool.update(1.95); const b = instance(pool, 0).position;
  assert.ok(1.95 < CASINGS.life - CASINGS.fade, 'sampled before the fade window');
  assert.ok(a.distanceTo(b) < 1e-12, 'at rest the position no longer changes');
  assert.ok(Math.abs(a.y - floorY) < 1e-9, 'resting on the floor');
});

test('casing motion is closed-form: 4 or 97 updates up to the same time give the same picture', () => {
  const run = steps => {
    const pool = createCasingPool({ capacity: 8, seed: 99 });
    pool.eject({ origin: { x: 0, y: 1.2, z: 0 }, velocity: { x: 3, y: 2, z: 1 }, time: 0, kind: 'pistol' });
    pool.eject({ origin: { x: .5, y: 1.4, z: .2 }, velocity: { x: -2, y: 4, z: 0 }, time: .1, kind: 'shell', floor: .1 });
    pool.eject({ origin: { x: 1, y: 1, z: 1 }, velocity: { x: 1, y: 0, z: -2 }, time: .2, kind: 'sniper', spin: { x: 4, y: -3, z: 9 } });
    for (let step = 1; step <= steps; step++) pool.update(step / steps * 1.234);
    return pool.mesh.instanceMatrix.array.slice();
  };
  const [a, b] = [run(4), run(97)];
  assert.equal(a.length, b.length);
  for (let index = 0; index < a.length; index++) assert.ok(Math.abs(a[index] - b[index]) < 1e-9, `matrix element ${index}`);
});

test('at rest the casing lies flat on its side, its local Y axis horizontal', () => {
  const pool = createCasingPool({ capacity: 4, seed: 5 });
  pool.eject({ origin: { x: 0, y: 1, z: 0 }, velocity: { x: 1, y: 1, z: 0 }, time: 0, kind: 'rifle' });
  pool.update(2);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(instance(pool, 0).quaternion);
  assert.ok(Math.abs(axis.y) < 1e-6, `local Y stays horizontal (${axis.y})`);
});

test('casings shrink during the fade window and are hidden at and after life', () => {
  const pool = createCasingPool({ capacity: 4, seed: 3 });
  pool.eject({ origin: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, time: 0, kind: 'rifle' });
  pool.update(CASINGS.life - CASINGS.fade - .01);
  assert.ok(Math.abs(instance(pool, 0).scale.y - CASING_KINDS.rifle.length) < 1e-6, 'full size before the fade');
  pool.update(CASINGS.life - CASINGS.fade / 2);
  const fading = instance(pool, 0).scale;
  assert.ok(fading.y < CASING_KINDS.rifle.length && fading.y > CASING_KINDS.rifle.length * .3, `shrinking (scale.y ${fading.y})`);
  assert.equal(pool.count(), 1);
  pool.update(CASINGS.life);
  assert.equal(instance(pool, 0).scale.x, 0, 'hidden exactly at life');
  pool.update(CASINGS.life + .5);
  assert.equal(instance(pool, 0).scale.x, 0, 'hidden after life');
  assert.equal(pool.count(), 0);
});

test('the ring buffer keeps exactly capacity casings and replaces the oldest', () => {
  const capacity = 8, pool = createCasingPool({ capacity, seed: 11 });
  for (let index = 0; index < capacity + 5; index++)
    assert.equal(pool.eject({ origin: { x: index, y: .5, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, time: 1, kind: 'rifle' }), true);
  pool.update(1.5);
  assert.equal(pool.count(), capacity);
  const landed = [];
  for (let index = 0; index < capacity; index++) landed.push(instance(pool, index).position.x);
  landed.sort((a, b) => a - b);
  assert.deepEqual(landed, [5, 6, 7, 8, 9, 10, 11, 12], 'the first 5 ejects were overwritten');
});

test('a shell shows a brass head, a rifle casing never does, and colours match CASING_KINDS', () => {
  const capacity = 4, pool = createCasingPool({ capacity, seed: 13 });
  pool.eject({ origin: { x: 0, y: .5, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, time: 0, kind: 'shell' });
  pool.eject({ origin: { x: 1, y: .5, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, time: 0, kind: 'rifle' });
  pool.update(1);
  const head = instance(pool, capacity + 0), headLength = CASING_KINDS.shell.length * CASING_KINDS.shell.head.fraction;
  assert.ok(Math.abs(head.scale.y - headLength) < 1e-6, `head length ${head.scale.y}`);
  assert.ok(Math.abs(head.scale.x - CASING_KINDS.shell.radius * 1.06) < 1e-6, 'head slightly wider than the body');
  assert.ok(closeColor(colorAt(pool, capacity + 0), CASING_KINDS.shell.head.color), 'head is brass');
  assert.ok(closeColor(colorAt(pool, 0), CASING_KINDS.shell.color), 'shell body is red');
  assert.ok(closeColor(colorAt(pool, 1), CASING_KINDS.rifle.color), 'rifle casing is brass');
  assert.equal(instance(pool, capacity + 1).scale.x, 0, 'no head for a rifle casing');
  // The head sits at the base of the shell, offset along its axis.
  const body = instance(pool, 0), axis = new THREE.Vector3(0, 1, 0).applyQuaternion(body.quaternion);
  // A hair (0.8 mm) below the body's base cap, so the two caps never z-fight.
  const expected = body.position.clone().addScaledVector(axis, headLength / 2 - CASING_KINDS.shell.length / 2 - .0008);
  assert.ok(head.position.distanceTo(expected) < 1e-6, 'head offset along the casing axis');
});

test('invalid input returns false and changes nothing; an unknown kind falls back to rifle', () => {
  const pool = createCasingPool({ capacity: 4, seed: 17 });
  const version = pool.mesh.instanceMatrix.version;
  assert.equal(pool.eject(null), false);
  assert.equal(pool.eject({ origin: { x: 0, y: 1, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, time: NaN }), false);
  assert.equal(pool.eject({ origin: { x: 0, y: 1, z: 0 }, time: 0 }), false);
  assert.equal(pool.eject({ origin: { x: Infinity, y: 1, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, time: 0 }), false);
  assert.equal(pool.eject({ origin: { x: 0, y: 1, z: 0 }, velocity: { x: 1, y: NaN, z: 0 }, time: 0 }), false);
  pool.update(1);
  assert.equal(pool.count(), 0);
  assert.equal(pool.mesh.instanceMatrix.version, version, 'invalid ejects leave the mesh untouched');
  assert.equal(pool.eject({ origin: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, time: 0, kind: 'cannon' }), true, 'unknown kinds are accepted');
  pool.update(1);
  assert.ok(Math.abs(instance(pool, 0).scale.y - CASING_KINDS.rifle.length) < 1e-6, 'rifle sizes as fallback');
});

test('update while idle leaves the matrices alone; clear hides everything', () => {
  const pool = createCasingPool({ capacity: 4, seed: 19 });
  const version = pool.mesh.instanceMatrix.version;
  pool.update(1); pool.update(2);
  assert.equal(pool.mesh.instanceMatrix.version, version, 'no needsUpdate while idle');
  pool.eject({ origin: { x: 0, y: 1, z: 0 }, velocity: { x: 1, y: 1, z: 0 }, time: 0, kind: 'shell' });
  pool.update(1);
  assert.equal(pool.count(), 1);
  pool.clear();
  assert.equal(pool.count(), 0);
  for (let index = 0; index < pool.mesh.count; index++) assert.equal(instance(pool, index).scale.x, 0, `instance ${index} hidden after clear`);
  const cleared = pool.mesh.instanceMatrix.version;
  pool.update(1.5);
  assert.equal(pool.mesh.instanceMatrix.version, cleared, 'idle again after clear');
});

test('an origin below the floor starts on the floor; a zero-velocity eject rests immediately', () => {
  const pool = createCasingPool({ capacity: 4, seed: 23 });
  pool.eject({ origin: { x: 0, y: -1, z: 0 }, velocity: { x: 1, y: .5, z: 0 }, time: 0, kind: 'rifle', floor: 0 });
  pool.update(0);
  assert.ok(Math.abs(instance(pool, 0).position.y - CASING_KINDS.rifle.radius) < 1e-6, 'clamped to the floor at birth');
  pool.eject({ origin: { x: 2, y: .3, z: 1 }, velocity: { x: 0, y: 0, z: 0 }, time: .5, kind: 'pistol', floor: .2 });
  pool.update(1); const a = instance(pool, 1).position;
  pool.update(1.4); const b = instance(pool, 1).position;
  const restY = .2 + CASING_KINDS.pistol.radius;
  assert.ok(Math.abs(a.y - restY) < 1e-6 && Math.abs(a.x - 2) < 1e-6 && Math.abs(a.z - 1) < 1e-6, 'rests right where it landed');
  assert.ok(a.distanceTo(b) < 1e-12, 'no sliding, no bouncing');
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(instance(pool, 1).quaternion);
  assert.ok(Math.abs(axis.y) < 1e-6, 'already lying flat');
});

test('a casing scheduled for later keeps the pool awake until it flies', () => {
  const pool = createCasingPool({ capacity: 8 });
  assert.equal(pool.eject({ origin: { x: 0, y: 1, z: 0 }, velocity: { x: 1, y: 1, z: 0 }, time: 1, kind: 'rifle' }), true);
  pool.update(.5);
  assert.equal(pool.count(), 0, 'not visible before its time');
  pool.update(1.1);
  assert.equal(pool.count(), 1, 'it appears once its time comes');
});
