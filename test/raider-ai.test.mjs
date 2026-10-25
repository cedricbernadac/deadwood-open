import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { RAIDS, RAIDER_LOADOUTS } from '../public/rules.js';
import { seededRandom } from '../validation/balance-report.mjs';
import { RAIDER_AIM_TUNING } from '../public/raids.js';

const TICK = 1 / 30;
// A real raid room with the horde already gone; survivors are sturdy so a
// long scripted fight never ends the game.
function raidRoom({ players = 1, wave = 5, random = seededRandom(11), positions = [] } = {}) {
  const events = [], simulation = new RoomSimulation('RAIDAI', { random, onEvent: event => events.push(event) });
  for (let index = 0; index < players; index++) simulation.addPlayer(String.fromCharCode(97 + index));
  simulation.start('a');
  simulation.wave = wave - 1; simulation.beginWave();
  [...simulation.players.values()].forEach((player, index) => Object.assign(player, { hp: 1e6 }, positions[index] ?? {}));
  simulation.toSpawn = 0; simulation.zombies.clear(); simulation.spawnWarnings.clear();
  return { simulation, events };
}
// A quiet wave 14 room (no raid plan) for raiders placed by hand.
function quietRoom({ random = seededRandom(3) } = {}) {
  const events = [], simulation = new RoomSimulation('RAIDQ1', { random, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  simulation.wave = 13; simulation.beginWave(); simulation.spawnTimer = 999;
  player.hp = 1e6;
  return { simulation, events, player };
}
function raiderAt(simulation, { x, z, loadout = 'smg', door = 'east', state = 'advance' }) {
  const raider = simulation.createRaider(1, { id: null, doorId: door, x, z }, { index: 1, damageScale: 1 }, { point: { x, z }, loadout });
  simulation.zombies.set(raider.id, raider);
  raider.ai.state = state;
  return raider;
}
const raidersOf = simulation => [...simulation.zombies.values()].filter(zombie => zombie.kind === 'raider');
const named = (events, name) => events.filter(event => event.event === name);
const scripted = (draws, seed) => { const next = seededRandom(seed); return () => draws.length ? draws.shift() : next(); };
// Every state change of every raider, with the time it happened.
function run(simulation, seconds, stop = () => false) {
  const log = new Map();
  for (let step = 0; step < Math.round(seconds / TICK); step++) {
    simulation.tick(TICK);
    for (const raider of raidersOf(simulation)) {
      const list = log.get(raider.id) ?? [];
      if (list.at(-1)?.state !== raider.ai.state) list.push({ state: raider.ai.state, time: simulation.time });
      log.set(raider.id, list);
    }
    if (stop(log)) break;
  }
  return log;
}
const firstTime = (entries, state) => entries.find(entry => entry.state === state)?.time;

test('a squad advances to staging, engages, breaches in a staggered order and assaults inside', () => {
  // Two players: active doors north, west, east; the first draw (.99) starts on the east.
  const { simulation, events } = raidRoom({ players: 2, random: scripted([.99, .1], 21), positions: [{ x: 5, z: -3.5 }, { x: 0, z: 3 }] });
  const log = run(simulation, 60, seen => ['r1', 'r2'].every(id => seen.get(id)?.some(entry => entry.state === 'assault')));
  const [leader, follower] = ['r1', 'r2'].map(id => log.get(id));
  for (const entries of [leader, follower]) {
    assert.deepEqual(entries.map(entry => entry.state), ['advance', 'engage', 'breach', 'assault']);
  }
  assert.equal(named(events, 'raid')[0].side, 'east');
  // The leader (squad ordinal 0) goes first; its mate covers until it reaches the door, or 2.5 s.
  const leaderBreach = firstTime(leader, 'breach'), followerBreach = firstTime(follower, 'breach');
  assert.ok(followerBreach > leaderBreach, `${followerBreach} after ${leaderBreach}`);
  assert.ok(followerBreach <= leaderBreach + 2.5 + TICK + 1e-9);
  // Shorter cover window, still visibly staggered rather than an instant rush.
  assert.ok(leaderBreach - firstTime(leader, 'engage') >= 4.5 - TICK && leaderBreach - firstTime(leader, 'engage') <= 7 + TICK);
  // Both entered through the door the squad broke with butt-strokes.
  assert.ok(named(events, 'door').some(event => event.bash === true && event.doorId === 'east' && /^r\d+$/.test(event.zombieId)), 'butt-strokes');
  const squad = ['r1', 'r2'].map(id => simulation.zombies.get(id));
  assert.ok(squad.every(raider => raider.entered));
  run(simulation, 3);
  assert.ok(squad.every(raider => raider.ai.state === 'assault' && Math.abs(raider.x) < 8 && Math.abs(raider.z) < 6), 'inside the cabin');
  assert.ok(named(events, 'raider-shot').length > 10, 'they fired while closing in');
});

test('engage starts on staging, on a visible survivor within engageRange, or on a wound', () => {
  const { simulation, player } = quietRoom();
  Object.assign(player, { x: 30, z: RAIDER_LOADOUTS.smg.engageRange - 2 });
  // An SMG raider sees a survivor in the open 2 m inside its engageRange.
  const spotter = raiderAt(simulation, { x: 30, z: 0 });
  Object.assign(spotter.ai, { stagingX: 17, stagingZ: -3 });
  simulation.tick(TICK);
  assert.equal(spotter.ai.state, 'engage');
  // A pistol raider far from the survivor is shot while running in.
  const runner = raiderAt(simulation, { x: 40, z: -30, loadout: 'pistol' });
  simulation.tick(TICK);
  assert.equal(runner.ai.state, 'advance');
  // Wounded far from its target (more than advanceFireRange), it keeps running in.
  runner.ai.targetId = player.id;
  runner.hp -= 30;
  simulation.tick(TICK);
  assert.equal(runner.ai.state, 'advance');
  assert.ok(runner.ai.flinchUntil > simulation.time);
  // Wounded within advanceFireRange of its target, it stops and fights back.
  const close = raiderAt(simulation, { x: player.x + 6, z: player.z - 12, loadout: 'pistol' });
  simulation.tick(TICK);
  close.ai.targetId = player.id;
  assert.ok(Math.hypot(close.x - player.x, close.z - player.z) <= RAIDER_AIM_TUNING.advanceFireRange);
  close.hp -= 30;
  simulation.tick(TICK);
  assert.equal(close.ai.state, 'engage');
});

test('raiders breach only active doors and climb the stairs to a survivor on the loft', () => {
  const { simulation, events } = raidRoom({ positions: [{ x: 7, y: 3.4, z: -5 }] });
  const sealed = simulation.doors.filter(door => door.sealed);
  assert.deepEqual(sealed.map(door => door.id), ['north', 'south']);
  let climber = null;
  run(simulation, 90, () => (climber = raidersOf(simulation).find(raider => raider.y > 3)));
  assert.ok(climber, 'a raider reached the loft');
  assert.equal(climber.ai.state, 'assault');
  const bashed = new Set(named(events, 'board').concat(named(events, 'door')).filter(event => event.bash).map(event => event.doorId));
  assert.ok(bashed.size >= 1 && [...bashed].every(id => ['west', 'east'].includes(id)), [...bashed].join());
  assert.ok(sealed.every(door => door.sealed && door.hp === door.maxHp), 'sealed plates are never attacked');
  assert.ok(named(events, 'board').concat(named(events, 'door')).every(event => !sealed.some(door => door.id === event.doorId)));
});

test('a survivor outdoors is approached and shot, never ignored for an empty door', () => {
  // A shotgun raider breaching while its target stands 10 m away in the open, beyond its engageRange.
  const { simulation, events, player } = quietRoom();
  Object.assign(player, { x: 20, z: 10 });
  const shotgun = raiderAt(simulation, { x: 20, z: 0, loadout: 'shotgun', state: 'breach' });
  run(simulation, 4);
  assert.equal(shotgun.ai.state, 'engage');
  assert.ok(Math.hypot(shotgun.x - player.x, shotgun.z - player.z) <= RAIDER_LOADOUTS.shotgun.engageRange + .1, 'it closed to its engage range');
  assert.ok(shotgun.x > 12, 'it never walked to the east door');
  assert.ok(named(events, 'raider-shot').some(shot => shot.raiderId === shotgun.id));
  // An SMG raider at 10 m already holds its range: it fires and leaves the door alone.
  const room = quietRoom();
  Object.assign(room.player, { x: 20, z: 10 });
  const smg = raiderAt(room.simulation, { x: 20, z: 0, state: 'assault' });
  run(room.simulation, 6);
  assert.equal(smg.ai.state, 'engage');
  assert.ok(smg.x > 12 && Math.hypot(smg.x - 20, smg.z) < 3);
  assert.ok(named(room.events, 'raider-shot').length >= 6);
  assert.equal(room.simulation.doors.every(door => door.hp === door.maxHp), true);
});

// The first raider hit on each survivor, in seconds after the trigger; a cap
// retreat ends the watch.
function watchRaid(simulation, events, survivors, seconds, input) {
  const hitAt = new Map();
  let retreat = false;
  for (let step = 0; step < Math.round(seconds / TICK) && hitAt.size < survivors.length && !retreat; step++) {
    input();
    const before = events.length;
    simulation.tick(TICK);
    for (const event of events.slice(before)) {
      if (event.event === 'hit' && event.source === 'raider' && !hitAt.has(event.id)) hitAt.set(event.id, simulation.time - simulation.raid.triggeredAt);
      retreat ||= event.event === 'raid-retreat';
    }
  }
  return { hitAt, retreat };
}

test('survivors pressed into the sealed south wall under the eave are hunted round the cabin and shot', () => {
  // The first draw picks the side among active doors: solo west/east, two players north/west/east.
  for (const [players, wave, start, side] of [[1, 5, .1, 'west'], [1, 10, .99, 'east'], [1, 15, .1, 'west'],
    [2, 5, .1, 'north'], [2, 10, .5, 'west'], [2, 15, .99, 'east']]) {
    const { simulation, events } = raidRoom({ players, wave, random: scripted([start, .1], wave) });
    const survivors = [...simulation.players.values()], label = `${players} player(s), wave ${wave}`;
    // Normal health exercises the sticky target's real transfer after a down.
    // An immortal decoy would keep both shooters focused forever; requiring a
    // stray bullet to hit its teammate rewards bad aim rather than good routing.
    survivors.forEach((player, index) => Object.assign(player, { x: index ? -3 : 3, y: 0, z: 10, hp: 100 }));
    assert.equal(simulation.doors.find(door => door.id === 'south').sealed, true, label);
    // Real inputs only: walking north from the yard ends against the wall's outer face, under the roof and dry.
    const walk = () => survivors.forEach(player => simulation.setInput(player.id, { forward: 1, strafe: 0, yaw: 0, pitch: 0 }));
    for (let step = 0; step < 90; step++) { walk(); simulation.tick(TICK); }
    for (const player of survivors) {
      assert.ok(player.z > 6.4 && player.z < 6.5 && Math.abs(Math.abs(player.x) - 3) < .01, `${label}: ${player.x}, ${player.z}`);
      assert.equal(simulation.rainExposed(player), false, `${label}: sheltered by the eave`);
    }
    assert.equal(named(events, 'raid')[0].side, side, label);
    // Each survivor takes raider fire well before any cap, and the raid never gives up on them.
    const { hitAt, retreat } = watchRaid(simulation, events, survivors, 30, walk);
    assert.equal(retreat, false, label);
    assert.deepEqual([...hitAt.keys()].sort(), survivors.map(player => player.id).sort(), `${label}: ${[...hitAt].join(' ')}`);
    assert.ok([...hitAt.values()].every(seconds => seconds <= 30), `${label}: ${JSON.stringify([...hitAt])}`);
    assert.ok(raidersOf(simulation).every(raider => raider.ai.state !== 'assault'), `${label}: nobody inside an empty cabin`);
  }
});

test('a survivor in the open yard beyond the cabin is hunted round it, not left to a doorway loop', () => {
  // Solo wave 5 from the west; the survivor waits in the east yard, out of sight of the west facade.
  const { simulation, events } = raidRoom({ random: scripted([.1, .1], 4), positions: [{ x: 12, y: 0, z: 4 }] });
  const survivors = [...simulation.players.values()];
  const { hitAt, retreat } = watchRaid(simulation, events, survivors, 30, () => simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0 }));
  assert.equal(named(events, 'raid')[0].side, 'west');
  assert.equal(retreat, false);
  assert.ok(hitAt.get('a') <= 30, `first raider hit ${hitAt.get('a')}`);
  assert.ok(named(events, 'board').concat(named(events, 'door')).every(event => !event.bash), 'no door was bashed for an outdoor survivor');
});

test('assault is only ever inside, and a raider leaving for an outdoor survivor takes the door on the survivor side', () => {
  // Back outside after an earlier crossing, a breaching raider keeps breaching until it is in again.
  const { simulation, player } = quietRoom();
  simulation.doors.find(door => door.id === 'west').boards.fill(0);
  Object.assign(player, { x: 2, z: 1 });
  const returning = raiderAt(simulation, { x: -12, z: 0, door: 'west', state: 'breach' });
  returning.entered = true;
  simulation.tick(TICK);
  assert.deepEqual([returning.ai.state, Math.abs(returning.x) > 8], ['breach', true], 'no assault from the yard');
  run(simulation, 8, () => Math.abs(returning.x) < 7.5);
  assert.deepEqual([returning.ai.state, Math.abs(returning.x) < 8], ['assault', true]);
  // Inside by the west door, with the survivor out in the east yard: the east door is the shorter run.
  const room = quietRoom();
  for (const door of room.simulation.doors) if (!door.sealed) door.boards.fill(0);
  Object.assign(room.player, { x: 14, z: 3 });
  const leaving = raiderAt(room.simulation, { x: -5, z: -1, door: 'west', state: 'assault' });
  leaving.entered = true;
  run(room.simulation, 10, () => Math.abs(leaving.x) > 8.5 || Math.abs(leaving.z) > 6.5);
  assert.ok(leaving.x > 8.5, `left by the east door: ${leaving.x.toFixed(2)}, ${leaving.z.toFixed(2)}`);
});

test('a stuck raider re-plans after 20 s still, then retreats alone and leaves', () => {
  const { simulation, events } = quietRoom();
  const raider = raiderAt(simulation, { x: 25, z: 15, loadout: 'pistol' });
  // Frozen bodies ring it 0.6 m away: every step would push into one of them.
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    simulation.zombies.set(`z${90 + index}`, { id: `z${90 + index}`, x: 25 + Math.cos(angle) * .6, y: 0, z: 15 + Math.sin(angle) * .6, yaw: 0,
      hp: 80, maxHp: 80, kind: 'walker', scale: 1, boss: false, speed: 0, attackAfter: Infinity, entered: false, doorId: 'east',
      stairState: null, pushX: 0, pushZ: 0, pushLeft: 0 });
  }
  const start = simulation.time;
  run(simulation, 19.8);
  assert.deepEqual([raider.ai.state, raider.ai.replanned], ['advance', false]);
  assert.ok(Math.hypot(raider.x - 25, raider.z - 15) < 1, 'really stuck');
  run(simulation, .4);
  assert.equal(raider.ai.replanned, true);
  run(simulation, RAIDS.stuckRetreatAfter - .4);
  assert.equal(raider.ai.state, 'advance');
  run(simulation, .4, () => !simulation.zombies.has(raider.id) || raider.ai.state === 'retreat');
  assert.ok(raider.ai.state === 'retreat' || !simulation.zombies.has(raider.id));
  assert.ok(Math.abs(raider.ai.retreatStartedAt - start - STUCK_TOTAL) < .1);
  run(simulation, RAIDS.retreatMaxSeconds + .1, () => !simulation.zombies.has(raider.id));
  assert.equal(simulation.zombies.has(raider.id), false);
  assert.deepEqual(named(events, 'raider-left').map(event => event.id), [raider.id]);
  assert.equal(raidersOf(simulation).length, 0);
});
const STUCK_TOTAL = 20 + RAIDS.stuckRetreatAfter;

test('materialization to engage takes 4 to 7 s in a typical layout', () => {
  for (const [players, wave] of [[1, 5], [2, 10], [4, 15]]) {
    for (const seed of [1, 2]) {
      const { simulation } = raidRoom({ players, wave, random: seededRandom(seed) });
      const squad = simulation.raid.squad;
      const log = run(simulation, 20, () => raidersOf(simulation).filter(raider => raider.ai.state !== 'advance').length >= squad);
      const spawned = new Map(raidersOf(simulation).map(raider => [raider.id, raider.ai.spawnedAt]));
      const delays = [...log].filter(([id]) => spawned.has(id)).map(([id, entries]) => firstTime(entries, 'engage') - spawned.get(id));
      assert.equal(delays.length, squad, `${players} players`);
      assert.ok(delays.every(delay => delay >= 4 && delay <= 7), `${players} players: ${delays.map(delay => delay.toFixed(2))}`);
    }
  }
});
