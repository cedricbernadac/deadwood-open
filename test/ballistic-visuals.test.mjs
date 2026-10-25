import test from 'node:test';
import assert from 'node:assert/strict';
import { importPublicModule } from './helpers/public-modules.mjs';
import { ballisticPosition, ballisticSpeed, ballisticRange, ballisticRangeAge } from '../public/ballistics.js';

const { createBallisticTracer } = await importPublicModule('ballistic-visuals.js');
const { sharedEffects } = await importPublicModule('fx.js');
const fx = sharedEffects();
const projectile = { id: 'p1', x: 0, y: 3, z: 0, vx: 0, vy: 0, vz: -170, gravity: 9.81, maxAge: 90 / 170 };
const head = () => Array.from(fx.pools.glow.center.array.slice(0, 3));
const close = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-5));

test('the visible head follows the same curved flight as the server at close and long range', () => {
  fx.clear(); fx.update(40);
  const tracer = createBallisticTracer(projectile, { weapon: 'sniper', local: true, time: 10 });
  for (const age of [0, 5 / 170, 50 / 170, 90 / 170]) {
    assert.equal(tracer.update(10 + age), true);
    const position = ballisticPosition(projectile, age);
    close(head(), [position.x, position.y, position.z]);
  }
  assert.ok(head()[1] < projectile.y - 1, 'gravity produces a visible drop at 90 m');
  tracer.dispose(); fx.update(41); assert.equal(fx.count(), 0);
});

test('a local slow-motion FX clock cannot hold back the physical bullet', () => {
  fx.clear(); fx.update(100); fx.driven = true;
  try {
    const tracer = createBallisticTracer(projectile, { time: 20 });
    tracer.update(20.3);
    fx.update(100.01); // the rest of the scene advanced only ten milliseconds
    const position = ballisticPosition(projectile, .3);
    close(head(), [position.x, position.y, position.z]);
    tracer.dispose(); fx.update(100.02); assert.equal(fx.count(), 0);
  } finally { fx.driven = false; }
});

test('a physical bullet leaves the captured barrel and smoothly rejoins the unchanged server flight', () => {
  fx.clear(); fx.update(0);
  const shot = Object.freeze({ ...projectile, drag: .002 }), muzzle = { x: .35, y: 2.65, z: -1.25 };
  const tracer = createBallisticTracer(shot, { local: true, muzzle, time: 1 });
  tracer.update(1); close(head(), [muzzle.x, muzzle.y, muzzle.z]);
  close(Array.from(fx.pools.streak.tail.array.slice(0, 3)), [muzzle.x, muzzle.y, muzzle.z]);
  muzzle.x = 99; // later camera motion cannot drag a bullet already in flight
  tracer.update(1.02);
  assert.ok(head()[0] > 0 && head()[0] < .35);
  for (const age of [.1, .3, .5]) {
    tracer.update(1 + age);
    const expected = ballisticPosition(shot, age); close(head(), [expected.x, expected.y, expected.z]);
  }
  tracer.dispose(); fx.update(2); assert.equal(fx.count(), 0);
});

test('a close physical impact beyond a protruding barrel never draws a backwards tail', () => {
  fx.clear(); fx.update(0);
  const tracer = createBallisticTracer(projectile, { muzzle: { x: .35, y: 2.65, z: -1.4 }, time: 1 });
  const age = .38 / 170, at = ballisticPosition(projectile, age);
  tracer.contact({ ...at, age, terminal: true }, 1.01); tracer.update(1.01);
  close(head(), [at.x, at.y, at.z]);
  for (const index of [0, 3]) {
    const tail = Array.from(fx.pools.streak.tail.array.slice(index, index + 3));
    assert.equal(tail[0], 0); assert.ok(tail[2] >= at.z - 1e-5 && tail[2] <= 0);
  }
  tracer.dispose(); fx.update(2);
});

test('a muzzle correction meets the first penetration and never shifts its continuation', () => {
  fx.clear(); fx.update(0);
  const tracer = createBallisticTracer(projectile, { muzzle: { x: .4, y: 2.7, z: -1 }, time: 1 });
  const age = 3 / 170, at = ballisticPosition(projectile, age);
  const next = { ...projectile, ...at, vz: -85, vy: -9.81 * age, drag: .002, segmentStartAge: age };
  tracer.contact({ ...at, age, terminal: false, continuation: next }, 1 + age);
  tracer.update(1 + age); close(head(), [at.x, at.y, at.z]);
  tracer.update(1.1);
  const expected = ballisticPosition(next, .1); close(head(), [expected.x, expected.y, expected.z]);
  tracer.dispose(); fx.update(2);
});

test('a contact just beyond the barrel keeps the luminous tail before the impact', () => {
  fx.clear(); fx.update(0);
  const tracer = createBallisticTracer(projectile, { muzzle: { x: .35, y: 2.7, z: -1.9 }, time: 1 });
  const age = 2 / 170, at = ballisticPosition(projectile, age);
  tracer.contact({ ...at, age, terminal: true }, 1.02); tracer.update(1.02);
  close(head(), [at.x, at.y, at.z]);
  for (const index of [0, 3]) assert.ok(fx.pools.streak.tail.array[index + 2] >= at.z - 1e-5, 'tail cannot overshoot a close contact');
  tracer.dispose(); fx.update(2);
});

test('the faster sniper head reaches a distant target on its captured physical clock', () => {
  fx.clear(); fx.update(0);
  const speed = ballisticSpeed('sniper'), shot = { ...projectile, vz: -speed };
  shot.maxAge = ballisticRangeAge(shot, ballisticRange('sniper', 90));
  const tracer = createBallisticTracer(shot, { weapon: 'sniper', time: 1 });
  const age = 200 / speed;
  tracer.update(1 + age);
  const position = ballisticPosition(shot, age);
  close(head(), [position.x, position.y, -200]);
  const drop = shot.y - position.y;
  assert.ok(Math.abs(drop - .5 * shot.gravity * age ** 2) < 1e-12, 'the captured velocity determines actual visible drop');
  assert.ok(drop > 1.3 && drop < 1.4, 'the 382.5 m/s sniper drops about 1.34 m over 200 m');
  tracer.dispose(); fx.update(1); assert.equal(fx.count(), 0);
});

test('a terminal impact clamps the head to the actual contact, then fades without overshooting', () => {
  fx.clear(); fx.update(0);
  const tracer = createBallisticTracer(projectile, { time: 1 });
  tracer.update(1.1);
  tracer.contact({ x: 0, y: 2.9, z: -18, age: .106, terminal: true }, 1.1);
  assert.equal(tracer.update(1.12), true);
  close(head(), [0, 2.9, -18]);
  assert.equal(tracer.update(1.15), false); assert.equal(fx.count(), 0);
});

test('penetrating contact continues its curved flight and an abandoned trace expires', () => {
  fx.clear(); fx.update(0);
  const tracer = createBallisticTracer(projectile, { time: 1 });
  tracer.contact({ x: 0, y: 2.9, z: -17, age: .1, terminal: false }, 1.1);
  tracer.update(1.2);
  const position = ballisticPosition(projectile, .2);
  close(head(), [position.x, position.y, position.z]);
  assert.equal(tracer.update(2), false); assert.equal(fx.count(), 0);
});

test('invalid projectile data creates no particle and disposing an active trace releases its effects', () => {
  fx.clear(); fx.update(0);
  for (const bad of [null, { ...projectile, vy: NaN }, { ...projectile, maxAge: 0 }]) assert.equal(createBallisticTracer(bad), null);
  assert.equal(fx.count(), 0);
  const tracer = createBallisticTracer(projectile); tracer.dispose(); fx.update(.01); assert.equal(fx.count(), 0);
});

test('disposing an old bullet cannot delete effects that recycled its particle slots', () => {
  fx.clear(); fx.update(0);
  const tracer = createBallisticTracer(projectile);
  for (const name of ['glow', 'streak']) for (let index = 0; index < fx.pools[name].capacity + 10; index++) fx[name]({ start: 0, life: 2 });
  const before = fx.count();
  tracer.dispose(); fx.update(.01);
  assert.equal(fx.count(), before, 'all recycled effects are still alive');
  fx.clear();
});
