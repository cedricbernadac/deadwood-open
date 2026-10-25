import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraSupportHeight, cameraSmoothingAlpha, normalizeCameraSmoothing, CAMERA_SMOOTHING_DEFAULTS, CAMERA_SMOOTHING_LIMITS } from '../public/camera-motion.js';
import { STAIRS, STAIR_CONTACT, stairContactY, stairRampY } from '../public/stairs.js';
import { RoomSimulation } from '../simulation.mjs';

const poseOnTread = (z, extra = {}) => ({ x: 3.8, y: stairContactY(z), z, grounded: true, ...extra });

test('camera preferences reject nonnumeric storage, bound numbers and preserve independent fields', () => {
  for (const value of [undefined, null, false, 45, '', [], { heightMs: '45', recoilMs: null }, { heightMs: NaN, recoilMs: Infinity }])
    assert.deepEqual(normalizeCameraSmoothing(value), CAMERA_SMOOTHING_DEFAULTS);
  assert.deepEqual(normalizeCameraSmoothing({ heightMs: -1, recoilMs: 999 }), { heightMs: 0, recoilMs: CAMERA_SMOOTHING_LIMITS.recoilMs });
  assert.deepEqual(normalizeCameraSmoothing({ heightMs: 999, recoilMs: 0 }), { heightMs: CAMERA_SMOOTHING_LIMITS.heightMs, recoilMs: 0 });
  const stored = Object.freeze({ heightMs: 80, recoilMs: 12.5, unexpected: 99 });
  assert.deepEqual(normalizeCameraSmoothing(stored), { heightMs: 80, recoilMs: 12.5 });
  assert.deepEqual(stored, { heightMs: 80, recoilMs: 12.5, unexpected: 99 });
  const normalized = normalizeCameraSmoothing(null); normalized.heightMs = 0;
  assert.equal(CAMERA_SMOOTHING_DEFAULTS.heightMs, 45, 'a returned preference object cannot change shared defaults');
});

test('zero smoothing is immediate and positive times close 63 percent of a gap per time constant', () => {
  assert.equal(cameraSmoothingAlpha(1 / 60, 0), 1);
  assert.equal(cameraSmoothingAlpha(0, 0), 1);
  for (const milliseconds of [31, 45, 100, 150]) {
    assert.ok(Math.abs(cameraSmoothingAlpha(milliseconds / 1000, milliseconds) - (1 - Math.exp(-1))) < 1e-12);
    assert.equal(cameraSmoothingAlpha(0, milliseconds), 0);
    assert.equal(cameraSmoothingAlpha(-1, milliseconds), 0);
    assert.ok(cameraSmoothingAlpha(1 / 60, milliseconds) >= 0 && cameraSmoothingAlpha(1 / 60, milliseconds) <= 1);
  }
  assert.ok(cameraSmoothingAlpha(1 / 60, 45) > cameraSmoothingAlpha(1 / 60, 150), 'larger milliseconds soften the same frame more');
});

test('millisecond smoothing has the same elapsed-time response at 60 and 144 FPS', () => {
  for (const milliseconds of [0, 31, 45, 100, 150]) {
    const results = [60, 144].map(fps => {
      let visible = 0;
      for (let frame = 0; frame < fps / 4; frame++) visible += (1 - visible) * cameraSmoothingAlpha(1 / fps, milliseconds);
      return visible;
    });
    assert.ok(Math.abs(results[0] - results[1]) < 1e-12);
    const expected = milliseconds === 0 ? 1 : 1 - Math.exp(-250 / milliseconds);
    assert.ok(Math.abs(results[0] - expected) < 1e-12);
  }
});

for (const direction of ['ascent', 'descent']) test(`supported stair ${direction} gives a continuous camera surface`, () => {
  const samples = Array.from({ length: 521 }, (_, index) => {
    const z = STAIRS.maxZ + .25 - index * .01;
    return poseOnTread(z);
  });
  if (direction === 'descent') samples.reverse();
  let previous = cameraSupportHeight(samples[0]), largestDelta = 0, physicalSteps = 0;
  for (let index = 1; index < samples.length; index++) {
    const next = cameraSupportHeight(samples[index]);
    const delta = next - previous;
    assert.ok(direction === 'ascent' ? delta >= -1e-12 : delta <= 1e-12);
    largestDelta = Math.max(largestDelta, Math.abs(delta));
    if (Math.abs(samples[index].y - samples[index - 1].y) > .2) physicalSteps++;
    previous = next;
  }
  assert.ok(physicalSteps >= 15, 'The input still contains real discrete tread heights.');
  assert.ok(largestDelta < .008, `The camera surface must stay continuous: ${largestDelta}`);
});

test('first tread footprint maps to ground height before the foot of the flight', () => {
  for (const z of [STAIRS.maxZ + .25, STAIR_CONTACT.maxZ + .25, STAIRS.maxZ + .01, STAIRS.maxZ]) {
    const pose = poseOnTread(z);
    assert.equal(pose.y, .2125);
    assert.equal(cameraSupportHeight(pose), 0);
  }
  assert.equal(cameraSupportHeight(poseOnTread(STAIR_CONTACT.maxZ + .25001)), .2125,
    'A position outside the footprint keeps physical height.');
});

test('upper landing and lateral footprint edges preserve their actual support', () => {
  for (const z of [STAIRS.minZ, STAIR_CONTACT.minZ - .25])
    assert.equal(cameraSupportHeight(poseOnTread(z)), STAIRS.topY);
  const z = .1;
  for (const x of [STAIR_CONTACT.minX - .25, STAIR_CONTACT.maxX + .25])
    assert.equal(cameraSupportHeight(poseOnTread(z, { x })), stairRampY(z));
  for (const x of [STAIR_CONTACT.minX - .25001, STAIR_CONTACT.maxX + .25001]) {
    const pose = poseOnTread(z, { x });
    assert.equal(cameraSupportHeight(pose), pose.y);
  }
});

test('the ground-floor underpass, airborne players and other supports keep physical height', () => {
  for (const pose of [
    { x: 3.8, y: 0, z: -.8, grounded: true },
    { x: 3.8, y: 0, z: .45, crouched: true, grounded: true },
    poseOnTread(.1, { grounded: false, vy: 3 }),
    poseOnTread(.1, { grounded: false, vy: -3 }),
    poseOnTread(.1, { grounded: undefined }),
    poseOnTread(.1, { y: stairContactY(.1) + .02 }),
    { x: 0, y: 3.4, z: -2, grounded: true },
  ]) assert.equal(cameraSupportHeight(pose), pose.y);
});

test('support tolerance does not change the pose, aim or any gameplay state', () => {
  const supported = Object.freeze(poseOnTread(.1, { y: stairContactY(.1) + .0008,
    yaw: 2.1, pitch: -.3, hp: 84, ammo: 17, grounded: true }));
  const before = structuredClone(supported);
  assert.equal(cameraSupportHeight(supported), stairRampY(.1));
  assert.deepEqual(supported, before);
  const unsupported = poseOnTread(.1, { y: stairContactY(.1) + .002 });
  assert.equal(cameraSupportHeight(unsupported), unsupported.y);
  assert.equal(cameraSupportHeight({ ...supported, x: NaN }), supported.y);
  assert.equal(cameraSupportHeight(null), undefined);
});

test('real serialized LAN snapshots keep ramp support on odd treads and rounded Z edges', () => {
  const room = new RoomSimulation('CAMERA', { practice: true, raids: false, random: () => .5 });
  const player = room.addPlayer('probe'); room.zombies.clear();
  for (let step = 1; step < STAIRS.steps; step++) {
    const edge = STAIRS.maxZ - step * (STAIRS.maxZ - STAIRS.minZ) / STAIRS.steps;
    for (const offset of [-.00001, .00001, .002, -.002]) {
      Object.assign(player, poseOnTread(edge + offset));
      const visible = JSON.parse(JSON.stringify(room.snapshot())).players[0];
      assert.equal(cameraSupportHeight(visible), stairRampY(visible.z), `step ${step}, offset ${offset}`);
    }
  }
});

test('online reconciliation offsets remain independent of raw predicted tread support', () => {
  const support = Object.freeze(poseOnTread(.1));
  const before = structuredClone(support);
  for (const correctionY of [-.05, .03, .15]) {
    const corrected = Object.freeze({ ...support, x: support.x + .08, y: support.y + correctionY, z: support.z - .08 });
    assert.ok(Math.abs(cameraSupportHeight(corrected, support) - stairRampY(support.z) - correctionY) < 1e-12);
    assert.deepEqual(support, before);
  }
  const airborne = { ...support, grounded: false };
  assert.equal(cameraSupportHeight({ ...airborne, y: airborne.y + .03 }, airborne), airborne.y + .03);
});
