import test from 'node:test';
import assert from 'node:assert/strict';
import { createAimAssist } from '../public/aim-assist.js';
import { radialStick } from '../public/gamepad-controls.js';

const radians = degrees => degrees * Math.PI / 180;
const eye = { x: 0, y: 1.55, z: 0 };
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function candidate(id, yawDegrees = -3, distance = 10, overrides = {}) {
  const yaw = radians(yawDegrees);
  return { id, hp: 80, aimPoint: { x: -Math.sin(yaw) * distance, y: eye.y, z: -Math.cos(yaw) * distance }, ...overrides };
}
const input = overrides => ({ eye, yaw: 0, pitch: 0, lookX: .2, lookY: 0,
  yawDelta: -.003, pitchDelta: 0, dt: 1 / 60, candidates: [candidate('walker')], ...overrides });

test('every assistance level leaves mouse aim and a neutral right stick unchanged', () => {
  for (const overrides of ['light', 'normal', 'strong'].flatMap(level => [
    { level, inputSource: 'mouse' }, { level, lookX: 0, lookY: 0 },
  ]).concat([{ level: 'off' }, { level: 'invalid' }])) {
    let visibilityChecks = 0;
    const state = createAimAssist().update(input({ ...overrides, isBlocked: () => { visibilityChecks++; return false; } }));
    assert.deepEqual(state, { yawDelta: -.003, pitchDelta: 0, targetId: null, slowdown: 1 });
    assert.equal(visibilityChecks, 0);
  }
});

test('only living hostile, visible, close enough targets in a narrow front cone are eligible', () => {
  const excluded = [
    candidate('dead', -3, 10, { hp: 0 }), candidate('invalid-health', -3, 10, { hp: NaN }),
    candidate('not-alive', -3, 10, { alive: false }), candidate('downed', -3, 10, { downed: true }),
    candidate('friendly', -3, 10, { friendly: true }), candidate('invisible', -3, 10, { visible: false }),
    candidate('behind', 180), candidate('far', -3, 60.1), candidate('outside-cone', -12.1),
    candidate('too-close', -3, .1), candidate('occluded'),
    candidate(null), candidate('invalid-point', -3, 10, { aimPoint: { x: NaN, y: 1, z: -10 } }),
  ];
  const assist = createAimAssist();
  const state = assist.update(input({ candidates: excluded, isBlocked: enemy => enemy.id === 'occluded' }));
  assert.equal(state.targetId, null);
  assert.equal(state.yawDelta, -.003);
  assert.equal(assist.update(input({ candidates: [...excluded, candidate('valid')], isBlocked: enemy => enemy.id === 'occluded' })).targetId, 'valid');
});

test('light, normal and strong acquire increasingly wide but bounded front cones', () => {
  for (const [level, inside, outside] of [['light', 5.9, 6.1], ['normal', 8.9, 9.1], ['strong', 11.9, 12.1]]) {
    assert.equal(createAimAssist().update(input({ candidates: [candidate('edge', -inside)], level })).targetId, 'edge', level);
    assert.equal(createAimAssist().update(input({ candidates: [candidate('edge', -outside)], level })).targetId, null, level);
  }
});

test('visible target slows active aiming and tracking is bounded by angular speed', () => {
  const args = input();
  const state = createAimAssist().update(args);
  assert.equal(state.targetId, 'walker');
  assert.ok(state.slowdown >= .42 && state.slowdown < 1);
  const tracking = Math.hypot(state.yawDelta - args.yawDelta * state.slowdown, state.pitchDelta - args.pitchDelta * state.slowdown);
  assert.ok(tracking > 0);
  assert.ok(tracking <= .60 * args.dt * args.lookX + 1e-12);
  assert.ok(state.yawDelta < 0);
});

test('normal and strong add progressively more friction and tracking than light', () => {
  const args = input({ candidates: [candidate('walker', -1)] });
  const normal = createAimAssist().update({ ...args, level: 'normal' });
  const light = createAimAssist().update({ ...args, level: 'light' });
  const strong = createAimAssist().update({ ...args, level: 'strong' });
  assert.ok(normal.slowdown < light.slowdown);
  assert.ok(strong.slowdown < normal.slowdown);
  const normalTracking = Math.abs(normal.yawDelta - args.yawDelta * normal.slowdown);
  const lightTracking = Math.abs(light.yawDelta - args.yawDelta * light.slowdown);
  assert.ok(normalTracking > lightTracking);
  assert.ok(Math.abs(strong.yawDelta - args.yawDelta * strong.slowdown) > normalTracking);
});

test('light preserves the former normal tuning for a horizontal approach', () => {
  const state = createAimAssist().update(input({ level: 'light' }));
  near(state.slowdown, .8716666666666667);
  near(state.yawDelta, -.002957222222222222);
});

test('a half-deflected Xbox stick has noticeably more friction on normal and strong', () => {
  const right = radialStick(.5, 0, .16, 1.6);
  const args = input({ lookX: right.x, yawDelta: -right.x * radians(240) / 60 });
  const result = level => Math.abs(createAimAssist().update({ ...args, level }).yawDelta / args.yawDelta);
  const light = result('light'), normal = result('normal'), strong = result('strong');
  assert.ok(light > .85 && light < .95, 'former normal remains a subtle slowdown');
  assert.ok(normal < light * .85, 'new normal reduces angular travel substantially');
  assert.ok(strong < normal * .90, 'strong adds at least another 10% reduction in angular travel');
});

test('tracking follows deliberate input towards a target without pulling a turn away back towards it', () => {
  const away = createAimAssist().update(input({ yawDelta: .003, lookX: -.2 }));
  near(away.yawDelta, .003 * away.slowdown);
  assert.ok(away.yawDelta > 0);
  const stationary = createAimAssist().update(input({ yawDelta: 0, pitchDelta: 0 }));
  assert.equal(stationary.yawDelta, 0); assert.equal(stationary.pitchDelta, 0);
});

test('tracking never overshoots the target or snaps across the aim cone', () => {
  const args = input({ yawDelta: -.000001, lookX: 1, dt: .05, candidates: [candidate('near', -.001)] });
  const state = createAimAssist().update(args);
  assert.ok(state.yawDelta >= radians(-.001) - 1e-12);
  assert.ok(state.yawDelta < 0);
  const wide = createAimAssist().update(input({ yawDelta: -.00001, lookX: 1, dt: .05, candidates: [candidate('wide', -8.9)] }));
  assert.ok(Math.abs(wide.yawDelta) <= .00001 + .60 * .05);
  assert.ok(Math.abs(wide.yawDelta) < radians(1));
});

test('default aim point is upper torso, accounts for actual height and never targets the head automatically', () => {
  const seen = [];
  const args = input({ eye: { x: 0, y: 2.01, z: 0 }, candidates: [
    { id: 'colossus', hp: 1200, x: 0, y: 0, z: -10, height: 3 },
  ], isBlocked: (enemy, point) => { seen.push(point); return false; } });
  const state = createAimAssist().update(args);
  assert.equal(state.targetId, 'colossus');
  near(seen[0].y, 3 * .67);
  assert.ok(seen[0].y < 3 * .8);
});

test('explicit model aim point is respected for visibility and tracking rather than guessed from scale', () => {
  const aimPoint = { x: .1, y: 1.6, z: -8 };
  let observed;
  const state = createAimAssist().update(input({ candidates: [{ id: 'actual-model', hp: 200, scale: 3, aimPoint }],
    isBlocked: (enemy, point) => { observed = point; return false; } }));
  assert.equal(state.targetId, 'actual-model');
  assert.equal(observed, aimPoint);
  assert.equal(state.pitchDelta, 0, 'horizontal aiming must not add a vertical torso correction');
  const vertical = createAimAssist().update(input({ lookY: -.2, pitchDelta: .001,
    candidates: [{ id: 'actual-model', hp: 200, aimPoint }] }));
  assert.ok(vertical.pitchDelta > .001 * vertical.slowdown, 'vertical tracking follows an intentional vertical approach');
});

test('strong assistance does not drag a head-height sweep down or reverse an axis turned away', () => {
  const torso = { id: 'close-walker', hp: 80, aimPoint: { x: .1, y: 1.22, z: -4 } };
  const horizontal = createAimAssist().update(input({ level: 'strong', candidates: [torso] }));
  assert.equal(horizontal.targetId, torso.id);
  assert.equal(horizontal.pitchDelta, 0);
  const mixed = createAimAssist().update(input({ level: 'strong', candidates: [torso], lookY: -.2, pitchDelta: .002 }));
  near(mixed.pitchDelta, .002 * mixed.slowdown, 1e-12);
  assert.ok(mixed.yawDelta < -.003 * mixed.slowdown, 'approaching horizontal axis still follows');
});

test('strong two-axis correction remains speed-bounded and never introduces motion on an idle axis', () => {
  const args = input({ level: 'strong', lookX: .3, lookY: -.4, yawDelta: -.001, pitchDelta: .001,
    candidates: [candidate('diagonal', -4, 10, { aimPoint: { x: .7, y: 1.9, z: -10 } })] });
  const state = createAimAssist().update(args);
  const correction = Math.hypot(state.yawDelta - args.yawDelta * state.slowdown, state.pitchDelta - args.pitchDelta * state.slowdown);
  assert.ok(correction > 0 && correction <= .95 * args.dt * .5 + 1e-12);
  const vertical = createAimAssist().update({ ...args, yawDelta: 0, lookX: 0 });
  assert.equal(vertical.yawDelta, 0);
});

test('target hysteresis stays on one member of a dense crowd through minor angular changes', () => {
  const assist = createAimAssist();
  assert.equal(assist.update(input({ candidates: [candidate('first', -2), candidate('second', -2.2)] })).targetId, 'first');
  for (let tick = 0; tick < 20; tick++) {
    const state = assist.update(input({ candidates: [candidate('second', -1.9 - tick % 2 * .05), candidate('first', -2.1)] }));
    assert.equal(state.targetId, 'first');
  }
  assert.equal(assist.update(input({ candidates: [candidate('first', -3.2), candidate('second', -.8)] })).targetId, 'second');
});

test('death or occlusion immediately releases the previous crowd target', () => {
  for (const cause of ['dead', 'blocked', 'out-of-cone']) {
    const assist = createAimAssist();
    assist.update(input({ candidates: [candidate('first', -1), candidate('second', -2)] }));
    const first = cause === 'dead' ? candidate('first', -1, 10, { hp: 0 })
      : candidate('first', cause === 'out-of-cone' ? -13 : -1);
    const state = assist.update(input({ candidates: [first, candidate('second', -2)], isBlocked: enemy => cause === 'blocked' && enemy.id === 'first' }));
    assert.equal(state.targetId, 'second', cause);
  }
});

test('reset or changing to neutral/mouse input clears target hysteresis', () => {
  for (const cause of ['reset', 'neutral', 'mouse']) {
    const assist = createAimAssist();
    assist.update(input({ candidates: [candidate('first', -2), candidate('second', -2.2)] }));
    if (cause === 'reset') assist.reset();
    if (cause === 'neutral') assist.update(input({ lookX: 0, lookY: 0 }));
    if (cause === 'mouse') assist.update(input({ inputSource: 'mouse' }));
    assert.equal(assist.update(input({ candidates: [candidate('first', -2.1), candidate('second', -1.9)] })).targetId, 'second', cause);
  }
});

test('tracking wraps yaw across pi without turning the long way around', () => {
  const args = input({ yaw: radians(179), yawDelta: .001, lookX: -.2, candidates: [candidate('wrap', -179)] });
  const state = createAimAssist().update(args);
  assert.equal(state.targetId, 'wrap');
  assert.ok(state.yawDelta > args.yawDelta * state.slowdown);
  assert.ok(state.yawDelta < .005);
});

test('all levels evolve consistently at 60 and 144 FPS while held input stays in control', () => {
  function simulate(fps, level) {
    const assist = createAimAssist();
    let yaw = 0;
    for (let frame = 0; frame < fps; frame++) {
      const state = assist.update(input({ yaw, yawDelta: -.04 / fps, dt: 1 / fps, lookX: .1, candidates: [candidate('fixed', -4)], level }));
      yaw += state.yawDelta;
    }
    return yaw;
  }
  for (const level of ['light', 'normal', 'strong']) {
    const low = simulate(60, level), high = simulate(144, level);
    near(low, high, .0001);
    // Keeping the stick held can pass the target; assistance cannot lock it
    // there, or add overshoot beyond a full second of the manual input.
    assert.ok(low < -.03 && low > radians(-4) - .04, level);
  }
});

test('hitch timing is bounded and invalid input cannot propagate non-finite aim', () => {
  const args = input({ lookX: 1, yawDelta: -.001 });
  const hitch = createAimAssist().update({ ...args, dt: 3 });
  const bounded = createAimAssist().update({ ...args, dt: .05 });
  assert.deepEqual(hitch, bounded);
  for (const overrides of [{ dt: NaN }, { dt: -1 }, { eye: null }, { yaw: NaN }, { pitch: Infinity }]) {
    const state = createAimAssist().update({ ...args, ...overrides });
    assert.equal(state.targetId, null); assert.equal(state.yawDelta, -.001);
  }
  assert.deepEqual(createAimAssist().update(input({ yawDelta: NaN, pitchDelta: Infinity, inputSource: 'mouse' })),
    { yawDelta: 0, pitchDelta: 0, targetId: null, slowdown: 1 });
});
