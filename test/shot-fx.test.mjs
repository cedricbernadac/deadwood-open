import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createFx, sharedEffects } = await importPublicModule('fx.js');
const { bulletLook, launchProjectile, impactBurst, muzzleFlash, explosionBurst, createFlameEmitter, BULLET_SPEED } = await importPublicModule('shot-fx.js');
const fx = sharedEffects();
const counts = () => Object.fromEntries(Object.entries(fx.pools).map(([name, pool]) => [name, pool.particles.length]));

test('bullets grow with the damage they carry; the pellet spray stays small', () => {
  const order = ['smg', 'pistol', 'minigun', 'assault', 'magnum', 'sniper'];
  for (let index = 1; index < order.length; index++) assert.ok(bulletLook(order[index]).glow >= bulletLook(order[index - 1]).glow, order[index]);
  assert.ok(bulletLook('shotgun').pellet && bulletLook('shotgun').core < bulletLook('magnum').core);
  assert.ok(bulletLook('rocket').rocket);
  assert.ok(bulletLook('pistol', { local: true }).dim < bulletLook('pistol').dim, 'your own shots stay discreet');
});

test('a projectile keeps the old tracer speed and nothing is drawn for a zero-length or invalid shot', () => {
  fx.clear();
  const start = new THREE.Vector3(0, 1.5, 0);
  assert.ok(Math.abs(launchProjectile(start, new THREE.Vector3(0, 1.5, -17), { weapon: 'assault', time: 1 }) - 17 / BULLET_SPEED) < 1e-12);
  assert.ok(counts().glow >= 1 && counts().streak >= 2);
  fx.clear();
  assert.equal(launchProjectile(start, start.clone(), { time: 1 }), 0);
  assert.equal(launchProjectile(start, new THREE.Vector3(0, 0, -5), { time: NaN }), 0);
  impactBurst({ x: NaN, y: 0, z: 0 }, { time: 1 }); impactBurst(null, { time: 1 }); muzzleFlash(null); explosionBurst({ x: Infinity }, { time: 1 });
  assert.deepEqual(counts(), { smoke: 0, glow: 0, streak: 0 });
});

test('impacts, kills, head shots, rockets and blasts fill all three pools; nothing adds a light', () => {
  fx.clear();
  impactBurst({ x: 0, y: 1, z: 0 }, { kind: 'wood', time: 0, direction: new THREE.Vector3(0, 0, -1) });
  assert.ok(counts().smoke > 0 && counts().streak > 0, 'wood throws dust and sparks');
  const before = counts().glow;
  impactBurst({ x: 0, y: 1, z: 0 }, { kind: 'headshot', time: 0 });
  assert.ok(counts().glow - before >= 20, 'a head shot pops a crown of gold');
  explosionBurst({ x: 0, y: 0, z: 0 }, { time: 0, radius: 4 });
  launchProjectile(new THREE.Vector3(), new THREE.Vector3(0, 0, -20), { weapon: 'rocket', time: 0 });
  assert.ok(counts().smoke > 20, 'smoke trails and clouds');
  assert.ok(fx.update(.2) > 0);
  let lights = 0; fx.root.traverse(node => { if (node.isLight) lights++; });
  assert.equal(lights, 0);
  assert.equal(fx.update(30), 0, 'every particle expires');
});

test('pools recycle their oldest particles instead of growing during a huge wave', () => {
  const engine = createFx({ glow: 50, streak: 30, smoke: 20 });
  for (let index = 0; index < 10000; index++) {
    engine.glow({ start: 0, life: 99 }); engine.streak({ start: 0, life: 99 }); engine.smoke({ start: 0, life: 99 });
  }
  assert.deepEqual(Object.values(engine.pools).map(pool => pool.particles.length), [20, 50, 30]);
  assert.equal(engine.update(1), 100);
  assert.equal(engine.update(NaN), 0);
  for (const pool of Object.values(engine.pools)) assert.ok(pool.mesh.geometry.instanceCount <= pool.capacity);
  assert.ok('STREAK' in engine.pools.streak.mesh.material.defines && !('STREAK' in engine.pools.glow.mesh.material.defines));
  assert.equal(engine.pools.smoke.mesh.material.blending, THREE.NormalBlending);
  assert.equal(engine.pools.glow.mesh.material.blending, THREE.AdditiveBlending);
});

test('particle motion is closed-form: the same instant gives the same picture whatever the frame rate', () => {
  const run = steps => {
    const engine = createFx();
    engine.glow({ start: 0, life: 2, x: 1, y: 2, z: 3, vx: 2, vy: 4, vz: -1, drag: 1.5, gravity: 9 });
    for (let step = 1; step <= steps; step++) engine.update(step / steps * .8);
    return Array.from(engine.pools.glow.center.array.slice(0, 3));
  };
  const [a, b] = [run(4), run(97)];
  for (let index = 0; index < 3; index++) assert.ok(Math.abs(a[index] - b[index]) < 1e-6);
});

test('a flame jet emits at a steady rate, bounded by its range, and stops when released', () => {
  fx.clear();
  const flame = createFlameEmitter();
  flame.aim(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, -6), 0, .5);
  assert.equal(flame.update(.1), true);
  const early = counts().glow;
  flame.aim(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, -6), .15, .5);
  flame.update(.2);
  const added = counts().glow - early;
  assert.ok(added >= 12 && added <= 40, `a steady stream over .1 s, not a burst (${added})`);
  assert.equal(flame.update(5), false, 'released after its keep-alive');
  flame.stop(); assert.equal(flame.update(5.1), false);
});
