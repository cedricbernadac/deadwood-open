import test from 'node:test';
import assert from 'node:assert/strict';
import { importPublicModule } from './helpers/public-modules.mjs';
import { ballisticPosition, ballisticVelocity } from '../public/ballistics.js';

const { createBallisticTracer } = await importPublicModule('ballistic-visuals.js');
const { sharedEffects } = await importPublicModule('fx.js');
const fx = sharedEffects();
const head = () => Array.from(fx.pools.glow.center.array.slice(0, 3));
const near = (actual, point) => [point.x, point.y, point.z].forEach((value, index) => assert.ok(Math.abs(actual[index] - value) < 1e-4));

test('the visible projectile uses deceleration before and after a physical penetration segment', () => {
  fx.clear(); fx.update(0);
  const shot = { id: 'drag-shot', x: 0, y: 1.55, z: 0, vx: 0, vy: 0, vz: -170, drag: .0048, gravity: 9.81, maxAge: 4 };
  const tracer = createBallisticTracer(shot, { time: 0 });
  tracer.update(.1); near(head(), ballisticPosition(shot, .1));
  const point = ballisticPosition(shot, .1), v = ballisticVelocity(shot, .1);
  const continuation = { ...shot, ...point, vx: v.x * .6, vy: v.y * .6, vz: v.z * .6, segmentStartAge: .1, distanceOffset: 15 };
  tracer.contact({ ...point, age: .1, terminal: false, continuation }, .1);
  tracer.update(.2); near(head(), ballisticPosition(continuation, .2));
  assert.ok(head()[2] > ballisticPosition(shot, .2).z, 'the visible bullet really slowed down');
  tracer.dispose(); fx.update(.21); assert.equal(fx.count(), 0);
});

test('late contacts cannot rewind a continuation or restart a terminal projectile', () => {
  fx.clear(); fx.update(0);
  const shot = { id: 'ordered', x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: -170, drag: .005, gravity: 9.81, maxAge: 4 };
  const tracer = createBallisticTracer(shot, { time: 0 }), point = ballisticPosition(shot, .2);
  tracer.contact({ ...point, age: .2, terminal: true }, .2);
  tracer.contact({ x: 50, y: 50, z: 50, age: .1, terminal: false }, .21);
  tracer.update(.21); near(head(), point);
  assert.equal(tracer.update(.26), false); assert.equal(fx.count(), 0);
});
