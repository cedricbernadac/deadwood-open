import test from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync, SnapshotTimeline, shortestAngle, reconnectDelay } from '../public/online/timeline.js';

const actor = (id, x, extra = {}) => ({ id, x, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: true, ...extra });
const state = (serverTime, x, extra = {}) => ({ phase: 'wave', paused: false, players: [actor('p', x)],
  zombies: [actor('z', x)], net: { serverTime, epoch: 'night-1' }, ...extra });

test('clock midpoint estimates 50, 100 and 150 ms RTT without using it as a simulation clock', () => {
  for (const rtt of [50, 100, 150]) {
    const clock = new ClockSync();
    assert.equal(clock.recordPong({ clientTime: 500, serverTime: 1500 + rtt / 2 }, 500 + rtt), true);
    assert.equal(clock.rtt, rtt);
    assert.equal(clock.serverNow(2000), 3000);
  }
});

test('clock rejects invalid, negative, absurd and reordered probes', () => {
  const clock = new ClockSync();
  for (const [message, received] of [
    [{ clientTime: NaN, serverTime: 1 }, 100], [{ clientTime: 100, serverTime: Infinity }, 110],
    [{ clientTime: 100, serverTime: 1 }, 99], [{ clientTime: 0, serverTime: 1 }, 30001],
  ]) assert.equal(clock.recordPong(message, received), false);
  clock.recordPong({ clientTime: 500, serverTime: 1550 }, 600);
  assert.equal(clock.recordPong({ clientTime: 400, serverTime: 1450 }, 600), false);
  assert.equal(clock.serverNow(Infinity), null);
  assert.equal(clock.samples.length, 1);
});

test('clock can present snapshots before the first ping and resets between servers', () => {
  const clock = new ClockSync();
  assert.equal(clock.serverNow(0), null);
  assert.equal(clock.recordSnapshot(10000, 200), true);
  assert.equal(clock.serverNow(250), 10050);
  assert.equal(clock.recordSnapshot(9999, 300), false);
  clock.reset();
  assert.equal(clock.serverNow(250), null);
});

test('100 ms interpolation gives a linear, non-extrapolated remote pose', () => {
  const timeline = new SnapshotTimeline();
  for (let time = 0; time <= 300; time += 50) timeline.push(state(time, time / 100), time);
  assert.equal(timeline.sample(300).players[0].x, 2);
  assert.equal(timeline.sample(350).players[0].x, 2.5);
  assert.equal(timeline.sample(10000).players[0].x, 3, 'a cut freezes on the last received pose');
});

test('raider posture and reload follow displayed time while damage and membership remain authoritative', () => {
  const timeline = new SnapshotTimeline();
  for (const [time, crouched, reloading, hp] of [[0, false, false, 175], [100, true, true, 175], [200, false, false, 50]]) {
    timeline.push(state(time, time / 100, {
      zombies: [actor('raider', time / 100, { kind: 'raider', crouched, reloading, hp })],
    }), time);
  }
  const crouched = timeline.sample(200).zombies[0];
  assert.equal(crouched.x, 1);
  assert.equal(crouched.crouched, true, 'the displayed raider is crouched at server time 100');
  assert.equal(crouched.reloading, true);
  const halfway = timeline.sample(250).zombies[0];
  assert.equal(halfway.x, 1.5);
  assert.equal(halfway.crouched, true, 'the newest standing pose must not replace the older rendered pose');
  assert.equal(halfway.reloading, true);
  assert.equal(halfway.hp, 50, 'damage remains immediate and must not rewind with the visual pose');
  const standing = timeline.sample(300).zombies[0];
  assert.equal(standing.crouched, false);
  assert.equal(standing.reloading, false);
  timeline.push(state(300, 3, { zombies: [] }), 300);
  assert.deepEqual(timeline.sample(300).zombies, [], 'a dead raider never returns from the visual history');
});

test('yaw crosses the +/- pi boundary on the short arc', () => {
  const timeline = new SnapshotTimeline({ interpolationMs: 50 });
  timeline.push(state(0, 0, { players: [actor('p', 0, { yaw: Math.PI - .1 })] }), 0);
  timeline.push(state(100, 1, { players: [actor('p', 1, { yaw: -Math.PI + .1 })] }), 100);
  const yaw = timeline.sample(100).players[0].yaw;
  assert.ok(Math.abs(yaw - Math.PI) < 1e-10);
  assert.ok(Math.abs(shortestAngle(0, Math.PI, .5) - Math.PI / 2) < 1e-10);
});

test('reordered and duplicated snapshots never rewind actors', () => {
  const timeline = new SnapshotTimeline();
  timeline.push(state(0, 0), 0);
  timeline.push(state(100, 1), 100);
  assert.equal(timeline.push(state(50, 900), 120), false);
  assert.equal(timeline.push(state(100, 900), 130), false);
  assert.equal(timeline.push(state(NaN, 900), 140), false);
  assert.equal(timeline.sample(200).players[0].x, 1);
  assert.equal(timeline.frames.length, 2);
});

test('jitter adapts within 100-200 ms and a growing buffer never makes time run backward', () => {
  const timeline = new SnapshotTimeline();
  let serverTime = 0, arrival = 0, lastRender = -Infinity;
  for (let frame = 0; frame < 100; frame++) {
    serverTime += 67; arrival += frame % 2 ? 180 : 1;
    timeline.push(state(serverTime, frame / 10), arrival);
    const render = timeline.renderTime(arrival);
    assert.ok(render >= lastRender); lastRender = render;
    assert.ok(timeline.delay >= 100 && timeline.delay <= 200);
  }
  assert.ok(timeline.delay > 130);
  assert.ok(timeline.frames.length <= 32);
  assert.ok(timeline.frames.at(-1).serverTime - timeline.frames[0].serverTime <= 2000);
});

test('despawn and death take effect immediately without resurrecting older actors', () => {
  const timeline = new SnapshotTimeline();
  timeline.push(state(0, 0), 0);
  timeline.push(state(100, 1, { zombies: [] }), 100);
  assert.deepEqual(timeline.sample(100).zombies, []);
  timeline.push(state(200, 2, { players: [actor('p', 2, { hp: 0, alive: false })], zombies: [] }), 200);
  const player = timeline.sample(200).players[0];
  assert.equal(player.alive, false); assert.equal(player.x, 2);
});

test('new spawns stay hidden until render time reaches their birth, then use their real pose', () => {
  const timeline = new SnapshotTimeline();
  timeline.push(state(0, 0, { zombies: [] }), 0);
  timeline.push(state(100, 1, { zombies: [actor('new', 30)] }), 100);
  assert.deepEqual(timeline.sample(100).zombies, []);
  assert.deepEqual(timeline.sample(199).zombies, []);
  assert.equal(timeline.sample(200).zombies[0].x, 30);
});

test('teleport-sized changes are not interpolated through walls', () => {
  const timeline = new SnapshotTimeline();
  timeline.push(state(0, 0, { zombies: [actor('new', 30)] }), 0);
  timeline.push(state(100, 1, { zombies: [actor('new', 30)] }), 100);
  timeline.push(state(200, 100, { zombies: [actor('new', 100)] }), 200);
  assert.equal(timeline.sample(250).zombies[0].x, 100);
});

test('existing initial actors are immediately visible but newly joined remote players wait for render time', () => {
  const timeline = new SnapshotTimeline();
  timeline.push(state(1000, 1), 0);
  assert.equal(timeline.sample(0).players[0].id, 'p');
  timeline.push(state(1100, 2, { players: [actor('p', 2), actor('friend', 3)] }), 100);
  assert.deepEqual(timeline.sample(100).players.map(actor => actor.id), ['p']);
  assert.deepEqual(timeline.sample(200).players.map(actor => actor.id), ['p', 'friend']);
});

test('reused actor IDs get a new birth and the birth table remains bounded by living membership', () => {
  const timeline = new SnapshotTimeline();
  timeline.push(state(0, 0), 0);
  timeline.push(state(100, 1, { zombies: [] }), 100);
  assert.equal(timeline.births.zombies.size, 0);
  timeline.push(state(200, 2), 200);
  assert.deepEqual(timeline.sample(200).zombies, []);
  assert.equal(timeline.sample(300).zombies[0].id, 'z');
  assert.equal(timeline.births.zombies.size, 1);
});

test('buffer owns its pose copies and drops malformed actors rather than producing NaN', () => {
  const timeline = new SnapshotTimeline();
  const snapshot = state(0, 1);
  timeline.push(snapshot, 0); snapshot.players[0].x = 500;
  assert.equal(timeline.sample(0).players[0].x, 1);
  timeline.push(state(100, 1, { players: [actor('broken', NaN)] }), 100);
  assert.deepEqual(timeline.sample(100).players, []);
});

test('reconnect backoff is deterministic, bounded and can accept caller-owned jitter', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => reconnectDelay(i)), [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(reconnectDelay(100, { jitter: .5, random: 1 }), 30000);
  assert.equal(reconnectDelay(0, { jitter: .2, random: 0 }), 400);
  assert.equal(reconnectDelay(0, { jitter: .2, random: 1 }), 600);
  assert.equal(reconnectDelay(NaN), 500);
});
