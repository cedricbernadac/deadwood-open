import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { OnlineSession } from '../public/online/session.js';
import { clonePredictedPlayer, createPhysicsContext, stepPredictedPlayer } from '../public/online/physics.js';

const move = { forward: 1, strafe: 0, sprint: false, crouch: false, jump: false, yaw: 0, pitch: 0 };
function fixture() {
  let now = 0;
  const simulation = new RoomSimulation('ONLINE', { practice: true });
  const player = simulation.addPlayer('p');
  Object.assign(player, { x: 20, y: 0, z: 20, grounded: true, vy: 0, yaw: 0, pitch: 0 });
  simulation.zombies.clear();
  const snapshot = (time = now, ack = 0, extra = {}) => {
    const state = simulation.snapshot();
    return { ...state, phase: 'wave', paused: false,
      players: [{ ...state.players[0], ...clonePredictedPlayer(player) }], zombies: [],
      net: { serverTime: time, epoch: 'night-1', acks: { p: ack } }, ...extra };
  };
  const session = new OnlineSession({ playerId: 'p', now: () => now });
  session.ingestSnapshot(snapshot(0), { receivedAt: 0 });
  return { simulation, player, session, snapshot, setNow: value => { now = value; } };
}

test('movement is visible within the first frame, before a 50-150 ms RTT can return', () => {
  const { session, setNow } = fixture();
  setNow(16);
  const first = session.update(.016, move);
  assert.equal(first.commands.length, 0, 'commands retain a fixed 30 Hz budget');
  assert.ok(Math.abs(first.predictedPlayer.z - (20 - 3.5 * .016)) < 1e-10);
  const second = session.update(.018, move);
  assert.equal(second.commands.length, 1);
  assert.equal(second.commands[0].seq, 1);
  assert.equal(second.commands[0].dt, 1 / 30);
});

test('acknowledgment removes only processed commands and replays the rest from authority', () => {
  const { session, snapshot, player, setNow } = fixture();
  const commands = session.update(.1, move).commands;
  assert.equal(commands.length, 3);
  const authoritative = clonePredictedPlayer(player), context = createPhysicsContext(snapshot());
  stepPredictedPlayer(authoritative, commands[0], commands[0].dt, context);
  Object.assign(player, authoritative); setNow(100);
  assert.equal(session.ingestSnapshot(snapshot(100, 1)), true);
  assert.deepEqual(session.pending.map(command => command.seq), [2, 3]);
  assert.ok(Math.abs(session.predictedPlayer.z - (20 - .35)) < 1e-10);
  assert.equal(session.update(1 / 30, move).commands[0].seq, 4);
});

test('small position corrections are smoothed while the mouse aim stays local', () => {
  const { session, snapshot, player, setNow } = fixture();
  session.update(1 / 30, { ...move, yaw: 1.2, pitch: -.4 });
  const before = session.cameraPlayer();
  Object.assign(player, { x: before.x + .15, z: before.z, yaw: -2.8, pitch: .9 });
  setNow(100); session.ingestSnapshot(snapshot(100, 1));
  const corrected = session.cameraPlayer();
  assert.ok(Math.abs(corrected.x - before.x) < 1e-10);
  assert.equal(corrected.yaw, 1.2); assert.equal(corrected.pitch, -.4);
  for (let i = 0; i < 60; i++) session.cameraPlayer(null, 1 / 60);
  assert.ok(Math.abs(session.cameraPlayer().x - player.x) < 1e-5);
  assert.equal(session.cameraPlayer().yaw, 1.2);
});

test('large corrections return to a safe authority pose and never rotate the camera', () => {
  const { session, snapshot, player, setNow } = fixture();
  session.update(0, { ...move, yaw: 2 });
  player.x = 40; player.yaw = -1;
  setNow(100); session.ingestSnapshot(snapshot(100));
  assert.equal(session.cameraPlayer().x, 40);
  assert.equal(session.cameraPlayer().yaw, 2);
});

test('pause freezes input, clears pending movement and has no resume backlog', () => {
  const { session, snapshot, setNow } = fixture();
  session.update(.1, move); assert.equal(session.pendingCount, 3);
  setNow(100); session.ingestSnapshot(snapshot(100, 3, { paused: true }));
  const pausedZ = session.cameraPlayer().z;
  for (let i = 0; i < 20; i++) assert.deepEqual(session.update(.1, move).commands, []);
  assert.equal(session.pendingCount, 0); assert.equal(session.cameraPlayer().z, pausedZ);
  setNow(200); session.ingestSnapshot(snapshot(200, 3));
  assert.equal(session.update(.016, move).commands.length, 0);
  assert.equal(session.update(.018, move).commands.length, 1);
});

test('epoch changes reset motion and old-night reordered states cannot revive it', () => {
  const { session, snapshot, setNow } = fixture();
  session.update(.1, move);
  setNow(100); const next = snapshot(100, 0); next.net.epoch = 'night-2';
  assert.equal(session.ingestSnapshot(next), true);
  assert.equal(session.pendingCount, 0);
  assert.equal(session.ingestSnapshot(snapshot(200, 3)), false);
  assert.equal(session.epoch, 'night-2');
  assert.equal(session.timeline.frames.length, 1);
});

test('welcome reset works without a snapshot, reconnect keeps input identifiers monotonic', () => {
  const { session, snapshot, setNow } = fixture();
  const old = session.update(.1, move).commands.at(-1).seq;
  session.reset({ playerId: 'p' });
  assert.equal(session.cameraPlayer(), null);
  assert.deepEqual(session.update(.1, move).commands, []);
  setNow(100); session.ingestSnapshot(snapshot(100, old));
  assert.ok(session.update(1 / 30, move).commands[0].seq > old);
});

test('stalled tabs, stale snapshots and disconnects cannot accumulate a movement burst', () => {
  const { session, snapshot, setNow } = fixture();
  assert.deepEqual(session.update(10, move).commands, []);
  assert.equal(session.update(.016, move).commands.length, 0);
  session.disconnected();
  assert.deepEqual(session.update(.1, move).commands, []);
  assert.equal(session.pendingCount, 0);
  session.setConnected(true); setNow(100); session.ingestSnapshot(snapshot(100));
  assert.equal(session.update(1 / 30, move).commands.length, 1);
  setNow(1200);
  assert.deepEqual(session.update(.1, move).commands, []);
  assert.equal(session.pendingCount, 0);
});

test('malformed deltas and poses cannot produce NaN or replace local aim', () => {
  const { session, snapshot } = fixture();
  session.update(0, { ...move, yaw: .7, pitch: .4 });
  for (const dt of [NaN, Infinity, -1]) assert.deepEqual(session.update(dt, move).commands, []);
  session.update(1 / 30, { forward: Infinity, strafe: NaN, yaw: NaN, pitch: Infinity });
  const pose = session.cameraPlayer();
  assert.ok([pose.x, pose.y, pose.z].every(Number.isFinite));
  assert.equal(pose.yaw, .7); assert.equal(pose.pitch, .4);
  const invalid = snapshot(100); invalid.players[0].x = NaN;
  assert.equal(session.ingestSnapshot(invalid), false);
  assert.equal(session.ingestSnapshot(snapshot(Infinity)), false);
});

test('duplicate and backward acknowledgments cannot roll back accepted state', () => {
  const { session, snapshot, setNow } = fixture();
  setNow(100); session.ingestSnapshot(snapshot(100, 8));
  assert.equal(session.ingestSnapshot(snapshot(100, 9)), false);
  assert.equal(session.ingestSnapshot(snapshot(90, 8)), false);
  assert.equal(session.ingestSnapshot(snapshot(110, 7)), false);
  assert.equal(session.update(1 / 30, move).commands[0].seq, 9);
});

test('prediction never spends ammunition, applies damage or mutates a snapshot', () => {
  const { session, snapshot } = fixture();
  const inputState = snapshot(100);
  const original = JSON.stringify(inputState);
  session.ingestSnapshot(inputState);
  const before = session.cameraPlayer();
  session.update(.1, move);
  const after = session.cameraPlayer();
  assert.equal(after.hp, before.hp); assert.equal(after.ammo, before.ammo);
  assert.equal(after.reserve, before.reserve);
  assert.equal(JSON.stringify(inputState), original);
});

test('pending commands have a strict cap and resume only after an authoritative acknowledgment', () => {
  const { snapshot } = fixture();
  const session = new OnlineSession({ playerId: 'p', now: () => 0, maxPending: 4 });
  session.ingestSnapshot(snapshot(0));
  const sent = [];
  for (let frame = 0; frame < 300; frame++) sent.push(...session.update(1 / 60, move).commands);
  assert.equal(sent.length, 4); assert.equal(session.pendingCount, 4);
  assert.ok(Math.abs(session.predictedPlayer.z - (20 - 4 * 3.5 / 30)) < 1e-10);
  session.ingestSnapshot(snapshot(100, 4));
  assert.equal(session.update(1 / 30, move).commands[0].seq, 5);
});

test('downing and extraction cancel movement without adding combat or financial prediction', () => {
  const { session, snapshot, setNow } = fixture();
  session.update(.1, move);
  const downed = snapshot(100, 3); downed.players[0].downed = true;
  setNow(100); session.ingestSnapshot(downed);
  assert.equal(session.pendingCount, 0);
  const before = session.predictedPlayer.z;
  session.update(.1, move);
  assert.equal(session.predictedPlayer.z, before);
  setNow(200); session.ingestSnapshot(snapshot(200, 6, { phase: 'extraction' }));
  assert.deepEqual(session.update(.1, move).commands, []);
  assert.equal(session.createShot(), null);
  assert.equal(session.pendingCount, 0);
});

test('a held jump replays exactly once after acknowledgment instead of jumping twice', () => {
  const { session, snapshot, player, setNow } = fixture();
  const commands = session.update(.1, { ...move, forward: 0, jump: true }).commands;
  const authoritative = clonePredictedPlayer(player), context = createPhysicsContext(snapshot());
  stepPredictedPlayer(authoritative, commands[0], commands[0].dt, context);
  Object.assign(player, authoritative); setNow(100);
  session.ingestSnapshot(snapshot(100, 1));
  const after = session.predictedPlayer;
  assert.equal(after.jumpHeld, true); assert.equal(after.grounded, false);
  assert.ok(Math.abs(after.y - .47) < 1e-10, '5.6 m/s jump minus half the 18 m/s² gravity over 100 ms');
  assert.ok(Math.abs(after.vy - 3.8) < 1e-10);
});

test('immediate-effect history stays bounded even during sustained fire', () => {
  const { session } = fixture();
  for (let shot = 1; shot <= 1000; shot++) session.markShotPlayed(shot, 0);
  assert.equal(session.effects.size, 256);
  session.trimEffects(10001);
  assert.equal(session.effects.size, 0);
});

test('shot IDs suppress only already-played local echoes and leave remote effects intact', () => {
  const { session } = fixture();
  const shot = session.createShot({ yaw: .1, pitch: .2, now: 0 });
  assert.equal(shot.type, 'shoot'); assert.ok(Number.isFinite(shot.viewTime));
  session.markShotPlayed(shot.shotId);
  assert.equal(session.consumeShotEcho({ id: 'p', shotId: shot.shotId }), false);
  assert.equal(session.consumeShotEcho({ id: 'other', shotId: shot.shotId }), true);
  const next = session.createShot(); assert.ok(next.shotId > shot.shotId);
  assert.equal(session.consumeShotEcho({ id: 'p', shotId: next.shotId }), true);
  assert.equal(session.consumeShotEcho({ id: 'p', shotId: next.shotId }), false);
  session.disconnected(); assert.equal(session.createShot(), null);
});

test('shots advertise the current jitter buffer within the authoritative 100-200 ms bound', () => {
  const { session, snapshot, setNow } = fixture();
  session.ingestSnapshot(snapshot(100), { receivedAt: 100 });
  session.ingestSnapshot(snapshot(200), { receivedAt: 450 });
  session.ingestSnapshot(snapshot(300), { receivedAt: 451 });
  setNow(451);
  const shot = session.createShot();
  assert.ok(shot.interpolationMs > 100 && shot.interpolationMs <= 200);
  assert.equal(shot.interpolationMs, session.timeline.delay);
  assert.ok(Math.abs(shot.viewTime + shot.interpolationMs - session.clock.serverNow(451)) < 1e-10);
  for (const [delay, expected] of [[50, 100], [500, 200], [NaN, 100]]) {
    session.timeline.delay = delay;
    assert.equal(session.createShot().interpolationMs, expected);
  }
});

for (const rtt of [50, 100, 150]) test(`fixed command stream tolerates ${rtt} ms RTT, jitter and reordered snapshots`, () => {
  const { session, snapshot, player, setNow } = fixture();
  const authoritative = clonePredictedPlayer(player), context = createPhysicsContext(snapshot());
  const uploads = [], downloads = [];
  let ack = 0, received = 0, largestCorrection = 0, lastSequence = 0;
  for (let frame = 1; frame <= 240; frame++) {
    const now = frame * 1000 / 60; setNow(now);
    for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].at <= now) {
      const [{ state }] = downloads.splice(i, 1);
      const before = session.cameraPlayer();
      if (session.ingestSnapshot(state, { receivedAt: now })) {
        received++;
        largestCorrection = Math.max(largestCorrection, Math.hypot(before.x - session.cameraPlayer().x, before.z - session.cameraPlayer().z));
      }
    }
    const moving = frame < 150;
    const result = session.update(1 / 60, { ...move, forward: moving ? 1 : 0, yaw: .15 });
    for (const command of result.commands) {
      assert.ok(command.seq > lastSequence); lastSequence = command.seq;
      uploads.push({ at: now + rtt / 2 + (frame % 5 ? 0 : 12), command });
    }
    if (frame % 2 === 0) {
      const ready = uploads.filter(item => item.at <= now).sort((a, b) => a.command.seq - b.command.seq);
      for (const item of ready) {
        uploads.splice(uploads.indexOf(item), 1);
        if (item.command.seq > ack) { stepPredictedPlayer(authoritative, item.command, item.command.dt, context); ack = item.command.seq; }
      }
    }
    if (frame % 4 === 0) {
      Object.assign(player, authoritative);
      const state = snapshot(now, ack);
      downloads.push({ at: now + rtt / 2 + (frame % 16 === 0 ? 100 : 0), state });
    }
    const camera = session.cameraPlayer(null, 1 / 60);
    assert.equal(camera.yaw, .15);
    assert.ok([camera.x, camera.y, camera.z].every(Number.isFinite));
    assert.ok(session.pendingCount < 15);
  }
  assert.ok(received > 30);
  assert.ok(largestCorrection < .001, `reconciliation should preserve a continuous view: ${largestCorrection}`);
  assert.ok(Math.hypot(session.cameraPlayer().x - authoritative.x, session.cameraPlayer().z - authoritative.z) < .02);
});
