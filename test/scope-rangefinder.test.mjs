import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeTargetDistance } from '../public/scope-rangefinder.js';

const origin = { x: 0, y: 1.5, z: 0 }, direction = { x: 0, y: 0, z: -1 };
const enemy = (x, z, extra = {}) => ({ x, y: 0, z, kind: 'walker', hp: 80, ...extra });

test('rangefinder reports the first intersected enemy rather than the nearest enemy nearby', () => {
  const enemies = [enemy(2, -3), enemy(0, -20), enemy(0, -10), enemy(0, -2, { hp: 0 })];
  assert.equal(scopeTargetDistance({ origin, direction, enemies }), 9.68);
  assert.equal(scopeTargetDistance({ origin, direction, enemies: [enemy(2, -3)] }), null);
});

test('solid contact hides an enemy behind it and a closer enemy wins over the solid', () => {
  assert.equal(scopeTargetDistance({ origin, direction, enemies: [enemy(0, -20)], raycast: () => 5 }), 5);
  assert.equal(scopeTargetDistance({ origin, direction, enemies: [enemy(0, -3)], raycast: () => 5 }), 2.68);
});

test('rangefinder respects crawler, crouched raider, brute and raised floor hitboxes', () => {
  assert.equal(scopeTargetDistance({ origin, direction, enemies: [enemy(0, -5, { kind: 'crawler' })] }), null);
  assert.equal(scopeTargetDistance({ origin, direction, enemies: [enemy(0, -5, { kind: 'raider', crouched: true })] }), null);
  assert.equal(scopeTargetDistance({ origin, direction, enemies: [enemy(0, -5, { kind: 'raider', crouched: false })] }), 4.68);
  assert.equal(scopeTargetDistance({ origin, direction, enemies: [enemy(0, -5, { y: 3 })] }), null);
  assert.ok(Math.abs(scopeTargetDistance({ origin, direction, enemies: [enemy(0, -5, { kind: 'brute' })] }) - (5 - .32 * 1.22)) < 1e-9);
});

test('rangefinder normalizes its ray, caps the rendered range and leaves empty sky blank', () => {
  let observed;
  assert.equal(scopeTargetDistance({ origin, direction: { x: 0, y: 0, z: -7 }, raycast: (_, unit) => { observed = unit; return Infinity; }, enemies: [enemy(0, -20)] }), 19.68);
  assert.deepEqual(observed, direction);
  assert.equal(scopeTargetDistance({ origin, direction, enemies: [enemy(0, -20)], maxDistance: 10, raycast: () => 30 }), null);
  assert.equal(scopeTargetDistance({ origin, direction, raycast: () => Infinity }), null);
  assert.equal(scopeTargetDistance({ origin, direction: { x: 0, y: 0, z: 0 } }), null);
});

