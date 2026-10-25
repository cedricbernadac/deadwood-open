import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { waveBalance, MAX_WAVES } from '../public/rules.js';

const input = { seq: 1, dt: 1 / 30, forward: 1, strafe: 0, yaw: 2, pitch: .3, jump: true };
const activeDoors = sim => sim.doors.filter(door => !door.sealed && !door.sealPending).map(door => door.id).sort();
function room(Type = RoomSimulation) {
  const events = [];
  const sim = new Type('LATEQA', { random: () => .5, clock: () => 1000, onEvent: event => events.push(event) });
  const host = sim.addPlayer('host', 'Host', 'pistol', { defer: true });
  sim.start(host.id); sim.beginWave();
  return { sim, host, events };
}
const join = (sim, id = 'late') => sim.addPlayer(id, id, 'magnum', { defer: true });

test('production lobby and practice arrivals stay immediate, while direct simulation fixtures retain compatibility', () => {
  const lobby = new RoomSimulation('LOBBY1');
  const first = join(lobby);
  assert.equal(first.waiting, false); assert.equal(first.alive, true);
  const practice = new RoomSimulation('PRACT1', { practice: true });
  const pupil = join(practice);
  assert.equal(pupil.waiting, false); assert.equal(pupil.alive, true);
  assert.deepEqual(Object.keys(pupil.inventory), ['assault', 'rocket']);
  const { sim } = room();
  const direct = sim.addPlayer('fixture');
  assert.equal(direct.waiting, false); assert.equal(direct.alive, true);
});

for (const Type of [RoomSimulation, OnlineRoomSimulation]) {
  test(`${Type.name}: late arrivals have no body, attacks, pickup, damage or money before admission`, () => {
    const { sim, host } = room(Type), late = join(sim);
    Object.assign(late, { x: 0, z: 0 }); Object.assign(host, { x: -5, z: 4 });
    const stock = { ...late.inventory.pistol }, pose = [late.x, late.y, late.z, late.yaw, late.pitch];
    assert.equal(late.waiting, true); assert.equal(late.alive, false);
    assert.deepEqual(sim.livingPlayers().map(player => player.id), ['host']);
    assert.equal(sim.setInput(late.id, input), false);
    assert.equal(Type === OnlineRoomSimulation ? sim.shootOnline(late.id, 0, { shotId: 1, yaw: 1, pitch: .5 }) : sim.shoot(late.id, 0), false);
    for (const [method, args] of [['reload', []], ['chooseWeapon', ['pistol']], ['dropWeapon', []], ['throwGrenade', []], ['interact', []], ['buyWeapon', ['pistol']], ['buySupply', ['armor']], ['claimSupply', ['radar', 'forged']]]) {
      assert.equal(sim[method](late.id, ...args), false, method);
    }
    sim.awardPoints(late, 100, 100); sim.damagePlayer(late, 500);
    const pickup = { id: 'cash', kind: 'cash', x: 0, y: 0, z: 0, value: 500, expiresAt: 100 };
    sim.pickups.set(pickup.id, pickup);
    sim.tick(1 / 30);
    assert.deepEqual([late.x, late.y, late.z, late.yaw, late.pitch], pose);
    assert.deepEqual(late.inventory.pistol, stock);
    assert.equal(late.hp, 100); assert.equal(late.points, 0); assert.equal(late.score, 0);
    assert.ok(sim.pickups.has(pickup.id));
    const zombie = { id: 'body-probe', kind: 'walker', x: 2, y: 0, z: 0, hp: 100 };
    assert.equal(sim.crowdBlocker(zombie, 0, 0, 0), null, 'waiting player does not block zombie movement');
  });
}

test('Ready during a wave waits for intermission; unready arrivals never auto-revive and every waiting slot counts', () => {
  const { sim, events } = room();
  const late = join(sim), unready = join(sim, 'unready'); join(sim, 'fourth');
  assert.throws(() => join(sim, 'fifth'), /complète/);
  assert.equal(sim.readyPlayer(late.id), true); assert.equal(sim.readyPlayer(late.id), false);
  assert.equal(late.waiting, true); assert.equal(late.ready, true); assert.equal(late.alive, false);
  sim.finishWave();
  assert.equal(late.waiting, false); assert.equal(late.ready, false); assert.equal(late.alive, true);
  assert.equal(unready.waiting, true); assert.equal(unready.alive, false);
  assert.equal(late.hp, 100); assert.equal(late.points, 0); assert.equal(late.grenades, 0);
  assert.deepEqual(late.inventory, { pistol: { ammo: WEAPONS.pistol.magazine, reserve: WEAPONS.pistol.reserve } });
  assert.equal(late.backpack, false); assert.equal(late.bonus, null);
  assert.ok(events.some(event => event.event === 'join-admitted' && event.id === late.id));
  assert.equal(sim.snapshot().players.find(player => player.id === unready.id).waiting, true);
  assert.equal(sim.readyPlayer(unready.id), true); assert.equal(unready.alive, true);
  assert.ok(Math.hypot(late.x - unready.x, late.z - unready.z) > .5, 'admitted survivors do not overlap');
});

test('countdown and intermission Ready can admit while the team pause keeps all timers frozen', () => {
  for (const phase of ['countdown', 'intermission']) {
    const { sim, host } = room(); sim.phase = phase; sim.timeLeft = 7;
    assert.equal(sim.setPause(host.id, true), true);
    const late = join(sim), before = [sim.time, sim.timeLeft];
    assert.equal(sim.readyPlayer(late.id), true); assert.equal(late.waiting, false);
    sim.tick(.1);
    assert.deepEqual([sim.time, sim.timeLeft], before);
    assert.equal(sim.paused, true);
  }
});

test('current-wave cadence, active cap, totals and entrances remain frozen as players join or leave', () => {
  const { sim } = room(), solo = waveBalance(1, 1), doors = activeDoors(sim);
  sim.addPlayer('direct-fixture');
  join(sim, 'ready-later'); sim.readyPlayer('ready-later');
  assert.equal(sim.wavePlayerCount, 1); assert.equal(sim.toSpawn, solo.total);
  assert.deepEqual(activeDoors(sim), doors);
  sim.tick(1 / 30);
  assert.equal(sim.spawnTimer, solo.spawnInterval, 'remaining spawns retain the opening player count');
  sim.zombies.clear(); sim.spawnWarnings.clear();
  for (let index = 0; index < solo.maxActive; index++) { const zombie = sim.createZombie(); sim.zombies.set(zombie.id, zombie); }
  sim.spawnTimer = 0; const remaining = sim.toSpawn;
  sim.tick(1 / 30);
  assert.equal(sim.toSpawn, remaining, 'adding participants cannot raise the current active cap');
  sim.zombies.clear(); sim.spawnWarnings.clear(); sim.finishWave();
  assert.deepEqual(activeDoors(sim), doors, 'even admission does not alter doors before the next wave');
  sim.beginWave();
  assert.equal(sim.wavePlayerCount, 3); assert.equal(sim.toSpawn, waveBalance(2, 3).total);
  assert.equal(activeDoors(sim).length, 4);
  sim.removePlayer('direct-fixture');
  assert.equal(sim.currentWaveBalance().spawnInterval, waveBalance(2, 3).spawnInterval);
  assert.equal(activeDoors(sim).length, 4);
});

test('pending arrivals neither increase raid squads nor rescue an eliminated team', () => {
  const { sim, host } = room(); sim.wave = 4;
  join(sim); join(sim, 'third'); sim.beginWave();
  assert.equal(sim.raid.players, 1);
  assert.equal(sim.wavePlayerCount, 1);
  sim.damagePlayer(host, 10000);
  sim.tick(1 / 30);
  assert.equal(sim.phase, 'gameover');
  assert.equal(sim.players.get('late').waiting, true);
  assert.equal(sim.readyPlayer('late'), false);
});

test('extraction and completed runs never admit late bodies or grant victory resupply', () => {
  for (const phase of ['extraction', 'gameover', 'victory']) {
    const { sim } = room(); sim.phase = phase;
    const late = join(sim);
    assert.equal(sim.readyPlayer(late.id), false);
    assert.equal(late.waiting, true); assert.equal(late.alive, false);
    assert.equal(late.points, 0); assert.equal(late.grenades, 0);
    sim.tick(1 / 30);
    assert.equal(late.waiting, true);
  }
  const { sim } = room(); sim.wave = MAX_WAVES;
  const late = join(sim); sim.readyPlayer(late.id);
  sim.toSpawn = 0; sim.zombies.clear(); sim.spawnWarnings.clear(); sim.finishWave();
  assert.equal(sim.phase, 'extraction'); assert.equal(late.waiting, true);
});

test('a new run resets waiting state normally, but a fresh identity cannot buy an immediate mid-wave respawn', () => {
  const { sim, host } = room(), late = join(sim);
  sim.removePlayer(late.id);
  const replacement = join(sim, 'replacement');
  assert.equal(replacement.alive, false); assert.equal(replacement.waiting, true);
  assert.equal(sim.readyPlayer(replacement.id), true); assert.equal(replacement.alive, false);
  sim.endGame(); assert.equal(sim.start(host.id), true);
  assert.equal(replacement.waiting, false); assert.equal(replacement.ready, false); assert.equal(replacement.alive, true);
  assert.equal(replacement.points, 0); assert.equal(sim.wavePlayerCount, null);
});

test('online reserved sessions preserve Ready, reject queued controls and wait for reconnection before admission', () => {
  const { sim } = room(OnlineRoomSimulation), late = join(sim);
  sim.readyPlayer(late.id); sim.setConnected(late.id, false);
  sim.finishWave();
  assert.equal(late.waiting, true); assert.equal(late.ready, true); assert.equal(late.alive, false);
  assert.equal(sim.setInput(late.id, input), false); assert.equal(sim.inputs.get(late.id).queue.length, 0);
  sim.setConnected(late.id, true);
  assert.equal(late.waiting, false); assert.equal(late.alive, true);
  assert.equal(sim.players.get(late.id), late);
  sim.setConnected(late.id, false); sim.beginWave();
  assert.equal(sim.wavePlayerCount, 1, 'disconnected reservations do not increase the next wave');
  assert.equal(sim.snapshot().players.find(player => player.id === late.id).connected, false);
});

for (const Type of [RoomSimulation, OnlineRoomSimulation]) {
  test(`${Type.name}: an earlier waiting slot cannot inherit and strand an admitted survivor's pause`, () => {
    const { sim, host } = room(Type), waiting = join(sim, 'earlier-waiting'), admitted = join(sim, 'later-admitted');
    sim.readyPlayer(admitted.id); sim.finishWave(); sim.beginWave();
    assert.equal(waiting.waiting, true); assert.equal(admitted.waiting, false);
    assert.equal(sim.setPause(host.id, true), true);
    sim.removePlayer(host.id);
    assert.equal(sim.hostId, admitted.id); assert.equal(sim.pauseById, admitted.id); assert.equal(sim.paused, true);
    assert.equal(sim.setPause(waiting.id, false), false);
    if (Type === OnlineRoomSimulation) {
      sim.setConnected(admitted.id, false); sim.setConnected(admitted.id, true);
      assert.equal(sim.hostId, admitted.id); assert.equal(sim.pauseById, admitted.id);
      assert.equal(sim.players.get(admitted.id), admitted);
    }
    assert.equal(sim.setPause(admitted.id, false), true); assert.equal(sim.paused, false);
  });

  test(`${Type.name}: the last waiting slot can still restart results after every participant leaves`, () => {
    const { sim, host } = room(Type), waiting = join(sim);
    sim.setPause(host.id, true); sim.removePlayer(host.id);
    assert.equal(sim.hostId, waiting.id); assert.equal(sim.phase, 'gameover'); assert.equal(sim.paused, false);
    assert.equal(sim.start(waiting.id), true); assert.equal(waiting.waiting, false); assert.equal(waiting.alive, true);
  });
}

test('online host transfer prefers a connected admitted survivor over an earlier disconnected reservation', () => {
  const { sim, host } = room(OnlineRoomSimulation), waiting = join(sim, 'waiting'), reserved = join(sim, 'reserved'), connected = join(sim, 'connected');
  sim.readyPlayer(reserved.id); sim.readyPlayer(connected.id); sim.finishWave(); sim.beginWave();
  sim.setConnected(reserved.id, false); sim.setPause(host.id, true); sim.removePlayer(host.id);
  assert.equal(sim.hostId, connected.id); assert.equal(sim.pauseById, connected.id);
  assert.equal(sim.setPause(connected.id, false), true);
  assert.equal(waiting.waiting, true); assert.equal(sim.players.get(reserved.id), reserved);
});
