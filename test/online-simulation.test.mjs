import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import { sampleBulletAtDistance } from '../public/ballistics.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';

const command = (seq, fields = {}) => ({ seq, dt: 1 / 30, forward: 1, strafe: 0, yaw: 0, pitch: 0, ...fields });
function fixture() {
  let now = 1000;
  const events = [];
  const sim = new OnlineRoomSimulation('ABCDEF', { practice: true, clock: () => now, random: () => .5, onEvent: event => events.push(event) });
  const player = sim.addPlayer('p');
  sim.zombies.clear();
  sim.phase = 'countdown'; sim.timeLeft = 10000;
  Object.assign(player, { x: 20, y: 0, z: 20, hp: 10000, weapon: 'pistol', inventory: { pistol: { ammo: 12, reserve: 48 } } });
  return { sim, player, events, now: value => { now = value; } };
}

function target(sim) {
  const zombie = { id: 'target', x: 20, y: 0, z: 15, yaw: 0, hp: 1000, maxHp: 1000, kind: 'walker', scale: 1, boss: false,
    entered: true, speed: 0, attackAfter: Infinity, damage: 0, pushX: 0, pushZ: 0, pushLeft: 0 };
  sim.zombies.set(zombie.id, zombie); return zombie;
}

test('online is an additive RoomSimulation adapter; LAN accepts its original unsequenced input', () => {
  const local = new RoomSimulation('LOCAL1', { practice: true }); local.addPlayer('p');
  assert.equal(local.setInput('p', { forward: 1, strafe: 0, yaw: 0, pitch: 0 }), true);
  const { sim } = fixture(); assert.ok(sim instanceof RoomSimulation);
  assert.equal(sim.setInput('p', { forward: 1, strafe: 0, yaw: 0, pitch: 0 }), false);
});

test('sequence acknowledgments follow consumed commands, not received commands', () => {
  const { sim } = fixture();
  assert.equal(sim.setInput('p', command(1)), true);
  assert.equal(sim.setInput('p', command(2)), true);
  assert.equal(sim.snapshot().net.acks.p, 0);
  sim.tick(1 / 30); assert.equal(sim.snapshot().net.acks.p, 1);
  sim.tick(1 / 30); assert.equal(sim.snapshot().net.acks.p, 2);
  assert.equal(sim.setInput('p', command(2)), false);
  assert.equal(sim.setInput('p', command(1)), false);
});

test('burst packets cannot buy extra movement time and queue stays bounded', () => {
  const { sim, player } = fixture(); const z = player.z;
  for (let seq = 1; seq <= 64; seq++) assert.equal(sim.setInput('p', command(seq, { dt: .05 })), true);
  assert.equal(sim.setInput('p', command(65)), false);
  sim.tick(1 / 30);
  assert.ok(Math.abs(z - player.z - 3.5 * 1.08 / 30) < 1e-9);
  assert.equal(sim.snapshot().net.acks.p, 0, 'partial command is not acknowledged');
  sim.tick(1 / 30); assert.equal(sim.snapshot().net.acks.p, 1);
  assert.ok(Math.abs(z - player.z - 3.5 * 1.08 * 2 / 30) < 1e-9);
});

test('invalid dt, sequence and finite input values leave received state untouched', () => {
  const { sim } = fixture();
  for (const fields of [{ seq: 0 }, { seq: -1 }, { seq: 1.1 }, { seq: Infinity }, { dt: 100 }, { dt: -.01 }, { dt: NaN }, { dt: .001 }, { yaw: Infinity }, { forward: '1' }]) {
    assert.equal(sim.setInput('p', command(1, fields)), false);
  }
  assert.equal(sim.inputs.get('p').received, 0);
  assert.equal(sim.setInput('p', command(1)), true);
});

test('no queued input stops translation but preserves crouch and gravity', () => {
  const { sim, player } = fixture();
  sim.setInput('p', command(1, { crouch: true })); sim.tick(1 / 30);
  const z = player.z; sim.tick(1 / 30);
  assert.equal(player.z, z); assert.equal(player.crouched, true);
  player.y = 3; player.grounded = false; player.vy = 0; player.fallStartY = 3;
  sim.tick(1 / 30); assert.ok(player.y < 3); assert.ok(player.vy < 0);
});

test('online input consumption preserves LAN motion smoothing used by raider aim', () => {
  const { sim, player } = fixture();
  const local = new RoomSimulation('LOCAL1', { practice: true });
  const localPlayer = local.addPlayer('p');
  local.phase = sim.phase;
  Object.assign(localPlayer, { x: player.x, y: player.y, z: player.z, weapon: player.weapon, inventory: structuredClone(player.inventory) });
  for (let seq = 1; seq <= 45; seq++) {
    const input = command(seq, { forward: 0, strafe: seq <= 30 ? 1 : 0 });
    sim.setInput('p', input); sim.tick(1 / 30);
    local.setInput('p', input); local.time += 1 / 30; local.movePlayer(localPlayer, 1 / 30);
    for (const key of ['x', 'y', 'z', 'motionX', 'motionZ'])
      assert.ok(Math.abs((player[key] ?? 0) - (localPlayer[key] ?? 0)) < 1e-11, `${key} at command ${seq}`);
    assert.ok(player.motionX > 0, 'lateral movement must remain measurable, including its decay after release');
  }
});

test('disconnect neutralizes pending controls and attacks while preserving inventory identity', () => {
  const { sim, player } = fixture();
  const inventory = player.inventory;
  sim.setInput('p', command(1)); sim.setConnected('p', false); sim.tick(1 / 30);
  assert.equal(player.z, 20); assert.equal(player.inventory, inventory);
  assert.equal(sim.snapshot().players[0].connected, false);
  assert.equal(sim.setInput('p', command(2)), false);
  sim.setConnected('p', true); assert.equal(sim.setInput('p', command(2)), true);
});

test('pause flushes queued controls and physics snapshot contains replay state', () => {
  const { sim, player } = fixture(); sim.setInput('p', command(1));
  assert.equal(sim.setPause('p', true), true);
  const snapshot = sim.snapshot(), before = player.z;
  assert.equal(snapshot.net.acks.p, 1);
  for (const key of ['vy', 'grounded', 'fallStartY', 'jumpHeld', 'jumpRequested', 'partitionSlideLeft', 'lastInputAt', 'input', 'movementMultiplier']) assert.ok(key in snapshot.players[0], key);
  sim.tick(); assert.equal(player.z, before);
  sim.setPause('p', false); sim.tick(); assert.equal(player.z, before);
});

test('new game changes epoch and clears old input/shot sequence history', () => {
  const { sim } = fixture(); const old = sim.epoch;
  sim.inputs.get('p').shotId = 50; sim.setInput('p', command(40)); sim.phase = 'gameover'; sim.practice = false;
  assert.equal(sim.start('p'), true); assert.notEqual(sim.epoch, old);
  assert.equal(sim.inputs.get('p').received, 0); assert.equal(sim.inputs.get('p').shotId, -1);
  assert.equal(sim.setInput('p', command(1)), true);
});

test('finite bullets ignore old poses and retain authoritative unique shot identity', () => {
  const { sim, player, now, events } = fixture();
  const zombie = target(sim);
  sim.recordHistory(1000); zombie.x = 22; now(1100); sim.recordHistory(1100);
  assert.equal(sim.shootOnline('p', 0, { shotId: 1, yaw: 0, pitch: 0, viewTime: 1000 }, { rttMs: 0 }), true);
  assert.equal(zombie.hp, 1000); advanceBallisticFlight(sim, .1); assert.equal(zombie.hp, 1000); assert.equal(zombie.x, 22); assert.equal(zombie.z, 15);
  assert.equal(player.inventory.pistol.ammo, 11);
  assert.equal(events.findLast(event => event.event === 'shot').shotId, 1);
  sim.time += 1;
  assert.equal(sim.shootOnline('p', 0, { shotId: 1, viewTime: 1000 }), false);
  assert.equal(player.inventory.pistol.ammo, 11);
});

for (const oldCrouched of [false, true]) {
  test(`flight uses the current raider silhouette (${oldCrouched ? 'crouched' : 'standing'}) at arrival`, () => {
    const { sim, now } = fixture(), raider = target(sim);
    Object.assign(raider, { kind: 'raider', crouched: oldCrouched });
    sim.recordHistory(1000);
    raider.crouched = !oldCrouched; raider.yaw = .7;
    now(1100); sim.recordHistory(1100);
    assert.equal(sim.shootOnline('p', 0, { shotId: 1, yaw: 0, pitch: 0, viewTime: 1000 }), true);
    advanceBallisticFlight(sim, .1);
    assert.equal(raider.hp < 1000, oldCrouched, 'eye-height shot hits the standing silhouette at arrival');
    assert.equal(raider.crouched, !oldCrouched); assert.equal(raider.yaw, .7);
  });

  test(`flight uses the current raider headshot threshold (${oldCrouched ? 'crouched' : 'standing'})`, () => {
    const { sim, now } = fixture(), raider = target(sim);
    Object.assign(raider, { kind: 'raider', crouched: oldCrouched });
    sim.recordHistory(1000); raider.crouched = !oldCrouched;
    now(1100); sim.recordHistory(1100);
    const pitch = Math.atan2(1 - 1.55, 5);
    assert.equal(sim.shootOnline('p', 0, { shotId: 1, yaw: 0, pitch, viewTime: 1000 }), true);
    advanceBallisticFlight(sim, .1);
    const damage = sampleBulletAtDistance(WEAPONS.pistol, 4.68 / Math.cos(pitch)).damage * (!oldCrouched ? 2.2 : 1);
    assert.ok(Math.abs(1000 - raider.hp - damage) < .01, `expected ${damage}, received ${1000 - raider.hp}`);
    assert.equal(raider.crouched, !oldCrouched);
  });
}

test('raider posture history is discrete between frames and restored when a shot is refused', () => {
  const { sim, player, now } = fixture(), raider = target(sim);
  Object.assign(raider, { kind: 'raider', crouched: false });
  sim.recordHistory(1000); raider.crouched = true; raider.x = 21;
  now(1100); sim.recordHistory(1100);
  assert.deepEqual(sim.historicalPositions(1050).get(raider.id), { x: 20.5, y: 0, z: 15, yaw: 0, crouched: false });
  assert.equal(sim.historicalPositions(1100).get(raider.id).crouched, true);
  player.inventory.pistol.ammo = 0;
  assert.equal(sim.shootOnline('p', 0, { shotId: 1, yaw: 0, pitch: 0, viewTime: 1000 }), false);
  assert.equal(raider.crouched, true); assert.equal(raider.x, 21);
  assert.equal(raider.hp, 1000);
});

test('future, old and forged timestamps cannot make physical bullets hit an old pose', () => {
  const { sim, now } = fixture(); const zombie = target(sim); sim.recordHistory(1000);
  zombie.x = 22; sim.recordHistory(1100); now(1200); sim.recordHistory(1200);
  sim.shootOnline('p', 0, { shotId: 1, yaw: 0, pitch: 0, viewTime: 1e9 }, { rttMs: 1000 });
  assert.equal(zombie.hp, 1000);
  sim.time += 1;
  sim.shootOnline('p', 0, { shotId: 2, yaw: 0, pitch: 0, viewTime: -1e9 }, { rttMs: 0 });
  assert.equal(zombie.hp, 1000, 'zero RTT only permits 100 ms interpolation rewind');
  sim.time += 1;
  sim.shootOnline('p', 0, { shotId: 3, yaw: 0, pitch: 0, viewTime: -1e9 }, { rttMs: 1000 });
  advanceBallisticFlight(sim, .1);
  assert.equal(zombie.hp, 1000, 'even extreme RTT does not rewind a finite projectile');
});

test('finite flight can hit a target born after the displayed history', () => {
  const { sim, now } = fixture(); sim.recordHistory(1000);
  const zombie = target(sim);
  now(1100); sim.recordHistory(1100);
  sim.shootOnline('p', 0, { shotId: 1, yaw: 0, pitch: 0, viewTime: 1000 });
  assert.equal(zombie.hp, 1000); advanceBallisticFlight(sim, .1); assert.ok(zombie.hp < 1000); assert.equal(sim.zombies.get(zombie.id), zombie);
});

test('adaptive interpolation metadata matches its bounded displayed delay and cannot extend rewind beyond 200 ms', () => {
  const { sim, now } = fixture(), zombie = target(sim);
  sim.recordHistory(900); zombie.x = 22; sim.recordHistory(1000); now(1200); sim.recordHistory(1200);
  sim.shootOnline('p', 0, { shotId: 1, yaw: 0, pitch: 0, viewTime: 900, interpolationMs: 1e9 }, { rttMs: 1e9 });
  assert.equal(zombie.hp, 1000, 'Even forged metadata only reaches pose at 1000, not 900');
  zombie.x = 20; sim.history.length = 0; sim.recordHistory(1020); zombie.x = 22; sim.recordHistory(1200);
  sim.time += 1;
  sim.shootOnline('p', 0, { shotId: 2, yaw: 0, pitch: 0, viewTime: 1020, interpolationMs: 180 }, { rttMs: 0 });
  advanceBallisticFlight(sim, .1);
  assert.equal(zombie.hp, 1000, 'interpolation metadata never rewinds the physical flight');
});

test('physical lethal impact keeps loot at authoritative present and cannot resurrect a killed zombie', () => {
  const { sim, now } = fixture(); sim.practice = false; const zombie = target(sim); zombie.hp = 1; sim.recordHistory(1000);
  zombie.x = 22; now(1100); sim.recordHistory(1100);
  // The real loot method is retained; every cash pickup must use the current pose.
  sim.shootOnline('p', 0, { shotId: 1, yaw: -Math.atan2(2, 5), pitch: 0, viewTime: 1000 });
  advanceBallisticFlight(sim, .1);
  assert.equal(sim.zombies.has(zombie.id), false);
  assert.ok([...sim.pickups.values()].some(pickup => Math.abs(pickup.x - 22) < .8));
});

test('history is bounded and never substitutes client HP, ammo or selected targets', () => {
  const { sim, player, now } = fixture();
  for (let i = 0; i < 1000; i++) { now(i * 34); sim.recordHistory(); }
  assert.ok(sim.history.length <= 32); assert.ok(sim.history.length < 12);
  sim.shootOnline('p', 0, { shotId: 1, damage: 1e12, ammo: 1e9, zombieId: 'forged', yaw: 0, pitch: 0 });
  assert.equal(player.inventory.pistol.ammo, 11); assert.equal(player.hp, 10000);
  assert.ok(WEAPONS.pistol.damage > 25 && WEAPONS.pistol.damage < 26, 'server profile remains unchanged by forged damage');
});
