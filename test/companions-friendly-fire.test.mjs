import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { seededRandom } from '../validation/balance-report.mjs';
import { createCompanionBody, liveBursts } from '../companions/body.mjs';
import { describeSituation } from '../companions/situation.mjs';
import { IS_SUPERMARKET } from '../public/level-config.js';
import { findLane } from './fixtures/friendly-fire-scenarios.mjs';
import { playerHitbox, GRENADES } from '../public/rules.js';

// Friendly fire (companions/DESIGN.md, "Friendly fire"): with the room setting
// on, the body holds any shot, swing, flame, rocket or throw that could hurt a
// teammate, and the eyes say so; with it off, nothing changes. A real
// RoomSimulation at 30 Hz, the body ticked before sim.tick() as the director
// does. Trigger pulls are seen by wrapping sim.shoot / sim.throwGrenade: only
// accepted calls count. The scenarios stand on the cabin's open floor; under
// DEADWOOD_LEVEL=supermarket only the level-agnostic situation checks run.
const TICK = 1 / 30;
// No tremor and no reaction time: the aim is the exact intended line, so what
// the trigger does is deterministic.
const STEADY = { aim: { tremorYaw: 0, tremorPitch: 0, reaction: [0, 0] } };
const cabinTest = (name, fn) => IS_SUPERMARKET ? test.skip(`${name} (cabin coordinates)`, fn) : test(name, fn);

function room({ seed = 7, wave = 1, friendlyFire, papaInput = () => ({ forward: 0, strafe: 0, yaw: 0, pitch: 0 }) } = {}) {
  const events = [];
  const sim = new RoomSimulation('FFIRE0', { random: seededRandom(seed), onEvent: event => events.push(event) });
  const papa = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave, toSpawn: 1, spawnTimer: 1e9 }); // a wave that never spawns nor ends
  if (friendlyFire) sim.friendlyFire = friendlyFire;
  const body = createCompanionBody(sim, 'max', { random: seededRandom(seed + 1000), profile: STEADY });
  const pulled = { shots: 0, throws: 0 };
  const shoot = sim.shoot.bind(sim), throwGrenade = sim.throwGrenade.bind(sim);
  sim.shoot = (...args) => { const ok = shoot(...args); if (ok && args[0] === 'max') pulled.shots++; return ok; };
  sim.throwGrenade = (...args) => { const ok = throwGrenade(...args); if (ok && args[0] === 'max') pulled.throws++; return ok; };
  const run = (seconds, until = () => false, each = () => {}) => {
    for (let index = 0; index < Math.round(seconds * 30); index++) {
      if (papa.alive && !papa.downed) sim.setInput('papa', papaInput());
      body.tick(TICK);
      sim.tick(TICK);
      each();
      if (until()) return true;
    }
    return false;
  };
  const arm = weapon => Object.assign(max, { weapon, weaponId: weapon,
    inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].magazine ? 400 : 0 } } });
  return { sim, events, papa, max, body, run, arm, pulled };
}
// A zombie that never moves, never bites and never dies: a fixed target.
const statue = (sim, point) => Object.assign(sim.spawnZombie(), { y: 0, speed: 0, attackAfter: Infinity, entered: true, hp: 1e6, maxHp: 1e6, ...point });
const swings = (events, id = 'max') => events.filter(event => event.event === 'melee-start' && event.id === id).length;

cabinTest('a teammate between the companion and its target is never shot through, friendly fire off or on', () => {
  for (const weapon of ['pistol', 'smg']) for (const friendlyFire of [undefined, 'full']) {
    const { sim, papa, max, body, run, arm, pulled } = room({ friendlyFire });
    arm(weapon);
    Object.assign(max, { x: -1, z: 4.6 });
    Object.assign(papa, { x: -6.4, z: 4.6 }); // hugging the zombie: every line to it crosses him
    const zombie = statue(sim, { x: -7.2, z: 4.6 });
    body.setOrder({ kind: 'hold' });
    run(8);
    assert.equal(pulled.shots, 0, `${weapon}, ${friendlyFire ?? 'off'}: not a shot with him in the line`);
    assert.ok(sim.zombies.has(zombie.id), 'the zombie stands');
    // Control: with him out of the line, the same setup fires at once.
    Object.assign(papa, { x: 6, z: -4 });
    run(4);
    assert.ok(pulled.shots > 0, `${weapon}, ${friendlyFire ?? 'off'}: fires once the line is clear`);
  }
});

cabinTest('a piercing gun: a teammate 2 m behind the target on the same line — shoots when off, holds when on', () => {
  for (const friendlyFire of [undefined, 'full', 'reduced']) {
    const { sim, papa, max, body, run, arm, pulled } = room({ friendlyFire });
    arm('rifle'); // the machine gun pierces three bodies
    sim.doors.find(door => door.id === 'west').boards.fill(0); // no plank of ours in this either
    Object.assign(max, { x: 5, z: 0 });
    Object.assign(papa, { x: -5, z: 0 }); // 2 m beyond the target, on the line
    const zombie = statue(sim, { x: -3, z: 0 });
    body.setOrder({ kind: 'hold' });
    run(6);
    if (friendlyFire) {
      assert.equal(pulled.shots, 0, `${friendlyFire}: holds its fire, the round would pierce into him`);
      assert.ok(sim.zombies.has(zombie.id), 'the zombie stands');
    } else assert.ok(pulled.shots > 0, 'off: it shoots, a round past the target is harmless');
  }
});

cabinTest('a teammate overlapping the companion (bodies pass through) is never shot through when on', () => {
  // Papa .15 m behind or beside Max's eye: his box holds it, so a round
  // fired from there starts inside him. Before: rifle and shotgun fired at
  // once, a shotgun took Papa 100 -> 0. Now the body may step clear first.
  for (const weapon of ['rifle', 'shotgun']) for (const [dx, dz] of [[.15, 0], [0, .15]]) for (const friendlyFire of [undefined, 'full']) {
    const { sim, events, papa, max, body, run, arm, pulled } = room({ friendlyFire });
    arm(weapon);
    Object.assign(max, { x: 0, y: 0, z: 3, yaw: Math.PI / 2, pitch: 0 });
    Object.assign(papa, { x: dx, y: 0, z: 3 + dz });
    statue(sim, { x: -4, z: 3 });
    const from = [], shoot = sim.shoot.bind(sim);
    sim.shoot = (...args) => { if (args[0] === 'max') from.push({ x: max.x, z: max.z }); return shoot(...args); };
    body.setOrder({ kind: 'hold' });
    run(2);
    const label = `${weapon}, Papa at (${dx}, ${dz}), ${friendlyFire ?? 'off'}`;
    if (!friendlyFire) {
      assert.ok(pulled.shots > 0 && Math.hypot(from[0].x - papa.x, from[0].z - papa.z) < .27, `${label}: fires from inside him, rounds pass through harmlessly`);
      continue;
    }
    assert.equal(papa.hp, 100, label);
    assert.equal(events.filter(event => event.event === 'hit' && event.source === 'friendly').length, 0);
    for (const at of from) assert.ok(Math.abs(at.x - papa.x) > .42 || Math.abs(at.z - papa.z) > .42, `${label}: every trigger pull clear of his body: (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`);
    // Control: Papa steps away, the same aim fires.
    Object.assign(papa, { x: 6, z: -4 });
    run(2);
    assert.ok(pulled.shots > 0, `${label}: fires once he has stepped away`);
  }
});

// sim.tick moves the players before it flies the bullets, so the round the
// body fires on a tick meets each teammate where that tick's move leaves him.
cabinTest('a crouched teammate behind the companion who stands up as it fires is never hit when on', () => {
  // Papa crouched .2 m behind Max: the eye line passes over his crouched
  // box, and he stands up at one of 8 tick phases. Before: the round
  // started inside his standing box in 3, 3 and 5 of the 8 phases with
  // smg, rifle and minigun (64, 91 and 159 damage).
  for (const weapon of ['smg', 'rifle', 'minigun']) for (let phase = 0; phase < 8; phase++) {
    let up = false;
    const { sim, events, papa, max, body, run, arm, pulled } = room({ friendlyFire: 'full', papaInput: () => ({ forward: 0, strafe: 0, yaw: Math.PI / 2, pitch: 0, crouch: !up }) });
    arm(weapon);
    Object.assign(max, { x: 0, y: 0, z: 3, yaw: Math.PI / 2, pitch: 0 });
    Object.assign(papa, { x: .2, y: 0, z: 3, crouched: true });
    statue(sim, { x: -4, z: 3 });
    body.setOrder({ kind: 'hold' });
    run(1.5 + phase / 30);
    up = true;
    run(.4);
    const label = `${weapon}, standing up at phase ${phase}`;
    assert.equal(papa.crouched, false, `${label}: he stood up`);
    assert.equal(events.filter(event => event.event === 'hit' && event.source === 'friendly').length, 0, label);
    assert.equal(papa.hp, 100, label);
    if (phase) continue;
    // Control: Papa steps away, the same aim fires.
    const before = pulled.shots;
    Object.assign(papa, { x: 6, z: -4 });
    run(1);
    assert.ok(pulled.shots > before, `${label}: fires once he has stepped away`);
  }
});

cabinTest('a teammate sprinting across just behind the companion\'s eye is never hit when on', () => {
  // Papa sprints across Max's line .2 m behind the eye, from a start swept
  // over one stride (his tick at a sprint, ~.19 m with his pistol), so the
  // tick his box first reaches the eye takes every phase. Before, FF_ROOM
  // (.15 m) under a stride: minigun and assault hurt him from 6 and 5 of
  // the 13 starts.
  for (const weapon of ['minigun', 'assault']) for (let start = 0; start < 13; start++) {
    let go = false;
    const { sim, events, papa, max, body, run, arm, pulled } = room({ friendlyFire: 'full', papaInput: () => ({ forward: go ? 1 : 0, strafe: 0, yaw: 0, pitch: 0, sprint: true }) });
    arm(weapon);
    Object.assign(max, { x: 0, y: 0, z: 3, yaw: Math.PI / 2, pitch: 0 });
    Object.assign(papa, { x: .2, y: 0, z: 4.3 + start * .015 });
    statue(sim, { x: -4, z: 3 });
    body.setOrder({ kind: 'hold' });
    run(1.5);
    const label = `${weapon}, start ${start}`;
    assert.ok(pulled.shots > 0, `${label}: was firing before he ran`);
    go = true;
    run(.5);
    assert.ok(papa.z < 2, `${label}: he ran across`);
    assert.equal(events.filter(event => event.event === 'hit' && event.source === 'friendly').length, 0, label);
    assert.equal(papa.hp, 100, label);
    const past = pulled.shots;
    run(.2);
    assert.ok(pulled.shots > past, `${label}: fires again once he is past`);
  }
});

test('the pellets under a line lifted just over a teammate\'s head never reach him when on', () => {
  // A runner 5.35 m down a clear lane, Papa .9 m behind it; a trembling hand
  // lifts Max's aim .15 rad (his tremor round a head aim): the centre line
  // passes over Papa's head, the shotgun's lower pellets do not. Before:
  // 3 shots, Papa 100 -> 38.7.
  for (const friendlyFire of ['off', 'full']) {
    const events = [];
    const sim = new RoomSimulation('FFLIFT', { random: seededRandom(5), raids: false, onEvent: event => events.push(event) });
    const papa = sim.addPlayer('papa', 'Papa'), max = sim.addPlayer('max', 'Max', undefined, { companion: true });
    if (friendlyFire !== 'off') sim.setFriendlyFire('papa', friendlyFire);
    sim.start('papa');
    Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
    for (const door of sim.doors) door.boards.fill(0);
    const lane = findLane(sim);
    Object.assign(max, { ...lane.at(0), y: 0, yaw: lane.yaw, pitch: 0, weapon: 'shotgun', weaponId: 'shotgun', inventory: { shotgun: { ammo: WEAPONS.shotgun.magazine, reserve: 100 } } });
    const runner = statue(sim, { ...lane.at(5.35), kind: 'runner', scale: 1 });
    Object.assign(papa, { ...lane.at(6.25), y: 0 });
    const setInput = sim.setInput.bind(sim);
    sim.setInput = (who, input) => setInput(who, who === 'max' ? { ...input, pitch: input.pitch + .152 } : input);
    const body = createCompanionBody(sim, 'max', { random: seededRandom(6), profile: STEADY });
    let shots = 0;
    const shoot = sim.shoot.bind(sim);
    sim.shoot = (...args) => { const ok = shoot(...args); if (ok && args[0] === 'max') shots++; return ok; };
    body.setOrder({ kind: 'shoot', zombieId: runner.id });
    for (let tick = 0; tick < 90; tick++) { sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0 }); body.tick(TICK); sim.tick(TICK); }
    if (friendlyFire === 'off') { assert.ok(shots > 0, 'off: fires'); continue; }
    assert.equal(shots, 0, 'on: holds, a pellet would reach him');
    assert.equal(papa.hp, 100);
    assert.equal(events.filter(event => event.event === 'hit' && event.source === 'friendly').length, 0);
  }
});

cabinTest('a teammate who jumps on a stair tread under the line is never hit by the round fired that tick', () => {
  // Max on the loft landing fires a minigun at a crawler on the far loft;
  // Papa stands on a stair tread under the line and jumps once. The line
  // passes about .25 m over his head, his jump's first tick lifts him
  // .18 m: the round fired on that tick met his head in its first segment
  // (before: 31.7 damage in some of the five phases).
  let fired = 0;
  for (let phase = -1; phase < 5; phase++) {
    // phase -1: Papa off the line, on the ground floor: Max fires freely.
    const events = [];
    const sim = new RoomSimulation('FFJUMP', { random: seededRandom(5), raids: false, onEvent: event => events.push(event) });
    const papa = sim.addPlayer('papa', 'Papa'), max = sim.addPlayer('max', 'Max', undefined, { companion: true });
    sim.setFriendlyFire('papa', 'full');
    sim.start('papa');
    Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
    for (const door of sim.doors) door.boards.fill(0);
    Object.assign(max, { x: 3.8, z: -2.4, y: 3.4, yaw: Math.PI, pitch: 0, weapon: 'minigun', weaponId: 'minigun', inventory: { minigun: { ammo: WEAPONS.minigun.magazine || 1, reserve: 400 } } });
    const crawler = statue(sim, { x: 3.8, z: 4.5, y: 3.4, kind: 'crawler', scale: 1 });
    if (phase < 0) Object.assign(papa, { x: -4, z: 4, y: 0 });
    else Object.assign(papa, { x: 3.8, z: -.9, y: sim.playerSurface({ ...papa, x: 3.8, z: -.9, y: 3.3 }, 3.8, -.9, 3.3), vy: 0, grounded: true });
    const body = createCompanionBody(sim, 'max', { random: seededRandom(50), profile: STEADY });
    const shoot = sim.shoot.bind(sim);
    sim.shoot = (...args) => { const ok = shoot(...args); if (ok && args[0] === 'max' && phase < 0) fired++; return ok; };
    body.setOrder({ kind: 'shoot', zombieId: crawler.id });
    let jump = false;
    const step = () => { sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0, jump }); body.tick(TICK); sim.tick(TICK); };
    for (let tick = 0; tick < 30 + Math.max(0, phase); tick++) step();
    jump = true; step(); jump = false;
    for (let tick = 0; tick < 18; tick++) step();
    assert.equal(events.filter(event => event.event === 'hit' && event.source === 'friendly').length, 0, `phase ${phase}`);
    assert.equal(papa.hp, 100, `phase ${phase}`);
  }
  assert.ok(fired > 0, 'fires when the teammate is off the line');
});

cabinTest('a blade: a teammate inside the swing next to the zombie — swings when off, holds when on', () => {
  for (const friendlyFire of [undefined, 'full']) {
    const { sim, events, papa, max, body, run, arm } = room({ friendlyFire });
    arm('katana');
    Object.assign(max, { x: 0, z: 3 });
    statue(sim, { x: 0, z: 1.8 }); // 1.2 m ahead
    Object.assign(papa, { x: .75, z: 2.05 }); // inside the 80° arc, off the straight line
    body.setOrder({ kind: 'hold' });
    run(5);
    if (friendlyFire) assert.equal(swings(events), 0, 'full: never starts the swing');
    else assert.ok(swings(events) > 0, 'off: it swings');
  }
});

cabinTest('the flamethrower: a teammate in the guarded cone — fires when off, holds when on', () => {
  for (const friendlyFire of [undefined, 'full']) {
    const { sim, papa, max, body, run, arm, pulled } = room({ friendlyFire });
    arm('flamethrower');
    Object.assign(max, { x: 2, z: 4.5 });
    statue(sim, { x: -1.5, z: 4.5 }); // 3.5 m ahead
    Object.assign(papa, { x: -.5, z: 5.6 }); // 24° off the aim: inside the guarded cone (20° + .1 rad)
    body.setOrder({ kind: 'hold' });
    run(5);
    if (friendlyFire) assert.equal(pulled.shots, 0, 'full: holds the flame');
    else assert.ok(pulled.shots > 0, 'off: fires');
  }
});

cabinTest('the flamethrower: a teammate inside the real 20° cone, whom the jet would burn — fires when off, holds when on', () => {
  for (const friendlyFire of [undefined, 'full']) {
    const { sim, papa, max, body, run, arm, pulled } = room({ friendlyFire });
    arm('flamethrower');
    Object.assign(max, { x: 2, z: 4.5 });
    statue(sim, { x: -1.5, z: 4.5 });
    Object.assign(papa, { x: -.5, z: 5.2 }); // 15.6° off the aim, 2.6 m away
    const eye = { x: 2, y: 1.55, z: 4.5 };
    assert.ok(sim.flameReach(eye, { x: -1, y: 0, z: 0 }, playerHitbox(papa), papa),
      'the authority’s flame reaches him on the line to the target');
    body.setOrder({ kind: 'hold' });
    run(5);
    if (friendlyFire) { assert.equal(pulled.shots, 0, 'full: holds the flame'); assert.equal(papa.hp, 100); }
    else assert.ok(pulled.shots > 0, 'off: fires');
  }
});

// Max lights a zombie in front of him; Papa stands 5.4 m down the same line
// behind the low wall (x .9, 1.15 m high): his chest is hidden, his head is
// not, and the real flame reaches the head. Before, the guard tested only
// the chest: 25 shots in 3 s and Papa 100 -> 73.2, on a shoot order or a
// plain hold alike.
function flameWall(papaAt, kind) {
  const { sim, papa, max, body, run, arm, pulled } = room({ friendlyFire: 'full' });
  arm('flamethrower');
  for (const door of sim.doors) door.boards.fill(0);
  Object.assign(max, { x: -3.9, y: 0, z: 4, yaw: -Math.PI / 2, pitch: 0 });
  const zombie = statue(sim, { x: -2.5, z: 4 });
  Object.assign(papa, { ...papaAt, y: 0 });
  body.setOrder(kind === 'shoot' ? { kind, zombieId: zombie.id } : { kind });
  run(3);
  return { sim, papa, pulled };
}

cabinTest('the flamethrower: a teammate whose head shows over the low wall is never burnt when on', () => {
  for (const kind of ['shoot', 'hold']) {
    const { sim, papa, pulled } = flameWall({ x: 1.47, z: 4 }, kind);
    assert.equal(sim.grenadeBlastVisible({ x: -3.9, y: 1.55, z: 4 }, { x: 1.47, y: 1.1, z: 4 }), false, 'the chest is behind the wall');
    assert.ok(sim.flameReach({ x: -3.9, y: 1.55, z: 4 }, { x: 1, y: 0, z: 0 }, playerHitbox(papa), papa), 'the head is in the flame');
    assert.equal(pulled.shots, 0, `${kind}: holds the flame`);
    assert.equal(papa.hp, 100, `${kind}: Papa unhurt`);
  }
  // Controls: out of reach, behind Max, off the axis: the flame goes, Papa unhurt.
  for (const at of [{ x: 4.5, z: 4 }, { x: -6.5, z: -4 }, { x: 1.6, z: .2 }]) {
    const { papa, pulled } = flameWall(at, 'shoot');
    assert.ok(pulled.shots > 0, `Papa at ${JSON.stringify(at)}: it fires`);
    assert.equal(papa.hp, 100);
  }
});

cabinTest('the rocket launcher: a blast catching a teammate, or the companion itself, is never fired when on', () => {
  // The target 3 m from papa: the blast (radiusDamage 4 m) would reach him.
  for (const friendlyFire of [undefined, 'full']) {
    const { sim, papa, max, body, run, arm, pulled } = room({ friendlyFire });
    arm('rocket');
    Object.assign(max, { x: 3, z: 4.5 });
    const zombie = statue(sim, { x: -1, z: 4.5 });
    Object.assign(papa, { x: -1, z: 1.5 }); // 3 m from the target
    body.setOrder({ kind: 'hold' });
    run(5);
    if (friendlyFire) {
      assert.equal(pulled.shots, 0, 'full: a teammate in the blast holds it');
      assert.ok(sim.zombies.has(zombie.id), 'the zombie stands');
    } else assert.ok(pulled.shots > 0, 'off: it fires');
  }
  // The target 3 m from the companion itself: its own blast would reach it.
  for (const friendlyFire of [undefined, 'full']) {
    const { sim, papa, max, body, run, arm, pulled } = room({ friendlyFire });
    arm('rocket');
    Object.assign(papa, { x: 6, z: -4 }); // out of this
    Object.assign(max, { x: 3, z: 4.5 });
    statue(sim, { x: 0, z: 4.5 });
    body.setOrder({ kind: 'hold' });
    run(5);
    if (friendlyFire) assert.equal(pulled.shots, 0, 'full: its own blast holds it');
    else assert.ok(pulled.shots > 0, 'off: it fires at the close target');
  }
});

// A shoot order on a far zombie with another one nearer on the same line:
// the rocket bursts on the nearer one (shootRocket stops on the first zombie
// it meets), next to the team. Bodies stand in a lane found on the map
// (test/fixtures/friendly-fire-scenarios.mjs), the target 5 m down it, Papa
// off the line where only a blast on the nearer zombie reaches him.
function rocketLane({ blocker = null, mateNear = 2.5 } = {}) {
  const sim = new RoomSimulation('FFROCKET', { random: () => .5, raids: false, onEvent: () => {} });
  const papa = sim.addPlayer('papa', 'Papa'), max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  assert.equal(sim.setFriendlyFire('papa', 'full'), true);
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
  for (const door of sim.doors) door.boards.fill(0);
  const lane = findLane(sim), start = lane.at(0), target = lane.at(5), near = { ...lane.at(mateNear), y: 1.1 };
  Object.assign(max, { ...start, y: 0, yaw: lane.yaw, pitch: 0, weapon: 'rocket', weaponId: 'rocket',
    inventory: { rocket: { ammo: 1, reserve: 2 } }, shotAfter: 0, switchUntil: 0, reloadUntil: 0 });
  // Out of the blast on the target (4.5 m and more), in it on the nearer zombie.
  let spot = null;
  for (let dx = -4; dx <= 4 && !spot; dx += .5) for (let dz = -4; dz <= 4 && !spot; dz += .5) {
    const candidate = { x: start.x + dx, y: 0, z: start.z + dz };
    if (Math.abs(dx * lane.dz - dz * lane.dx) < .8 || Math.hypot(candidate.x - target.x, candidate.z - target.z) <= 4.5
      || Math.hypot(candidate.x - near.x, candidate.z - near.z) >= 4) continue;
    if (sim.canOccupy(papa, candidate.x, candidate.z, 0, .45) && sim.grenadeBlastVisible(near, { x: candidate.x, y: .875, z: candidate.z })) spot = candidate;
  }
  assert.ok(spot, 'a spot for Papa by the nearer zombie');
  Object.assign(papa, { ...spot, yaw: 0, pitch: 0 });
  const statue = t => Object.assign(sim.spawnZombie(), { ...lane.at(t), y: 0, speed: 0, attackAfter: Infinity, entered: true, hp: 1e6, maxHp: 1e6, kind: 'walker', scale: 1 });
  const far = statue(5);
  if (blocker !== null) statue(blocker);
  const body = createCompanionBody(sim, 'max', { random: () => .5, profile: STEADY });
  const pulled = { shots: 0 }, shoot = sim.shoot.bind(sim);
  sim.shoot = (...args) => { const ok = shoot(...args); if (ok && args[0] === 'max') pulled.shots++; return ok; };
  body.setOrder({ kind: 'shoot', zombieId: far.id });
  for (let tick = 0; tick < 240 && !pulled.shots; tick++) { body.tick(TICK); sim.tick(TICK); }
  return { papa, max, pulled };
}

cabinTest('the rocket launcher: a zombie nearer on the line takes the rocket, so that blast by the team is never fired when on', () => {
  const control = rocketLane();
  assert.equal(control.pulled.shots, 1, 'control: the far target alone is shot');
  assert.deepEqual([control.papa.hp, control.max.hp], [100, 100], 'control: the blast on the target reaches nobody');
  // Before the guard stopped on the first zombie: 1 shot, Max 100 -> 0 and
  // Papa 100 -> 88.1 (2.5 m) or 86.9 (3.5 m).
  for (const blocker of [2.5, 3.5]) {
    const blocked = rocketLane({ blocker, mateNear: blocker });
    assert.equal(blocked.pulled.shots, 0, `a zombie ${blocker} m down the line: held`);
    assert.deepEqual([blocked.papa.hp, blocked.max.hp], [100, 100], `${blocker} m: nobody hurt`);
  }
});

cabinTest('the rocket launcher: a hand off the mark flies past its target to the wall by a teammate, so that shot is held when on', () => {
  // Max at (-7,-5) aims at a zombie 5 m north; every shot leaves .09 rad to
  // the side of the body's own aim (a hand off the mark, set on its inputs),
  // passes beside the target and bursts on the south wall near Papa. Before,
  // the guard judged the aimed point only: 1 shot, Papa 100 -> 0.
  const run = papaAt => {
    const events = [];
    const sim = new RoomSimulation('FFMISS', { random: () => .5, raids: false, onEvent: event => events.push(event) });
    const papa = sim.addPlayer('papa', 'Papa'), max = sim.addPlayer('max', 'Max', undefined, { companion: true });
    assert.equal(sim.setFriendlyFire('papa', 'full'), true);
    sim.start('papa');
    Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
    for (const door of sim.doors) door.boards.fill(0);
    Object.assign(max, { x: -7, y: 0, z: -5, yaw: -Math.PI, pitch: 0, weapon: 'rocket', weaponId: 'rocket',
      inventory: { rocket: { ammo: 1, reserve: 2 } }, shotAfter: 0, switchUntil: 0, reloadUntil: 0 });
    Object.assign(papa, { ...papaAt, y: 0 });
    const target = Object.assign(sim.spawnZombie(), { x: -7, y: 0, z: 0, speed: 0, attackAfter: Infinity, entered: true, hp: 1e6, maxHp: 1e6, kind: 'walker', scale: 1 });
    const setInput = sim.setInput.bind(sim);
    sim.setInput = (id, input) => setInput(id, id === 'max' ? { ...input, yaw: input.yaw + .09 } : input);
    const body = createCompanionBody(sim, 'max', { random: () => .5, profile: STEADY });
    const pulled = { shots: 0 }, shoot = sim.shoot.bind(sim);
    sim.shoot = (...args) => { const ok = shoot(...args); if (ok && args[0] === 'max') pulled.shots++; return ok; };
    body.setOrder({ kind: 'shoot', zombieId: target.id });
    for (let tick = 0; tick < 240 && !pulled.shots; tick++) { body.tick(TICK); sim.tick(TICK); }
    for (let tick = 0; tick < 3; tick++) sim.tick(TICK);
    return { papa, max, pulled, shot: events.find(event => event.event === 'shot' && event.id === 'max') };
  };
  const away = run({ x: 6, z: -4 });
  assert.equal(away.pulled.shots, 1, 'control: Papa far away, the shot goes');
  assert.equal(away.shot.pellets[0].stop, 'solid', 'it misses the target and meets the south wall');
  const near = run({ x: -5.02, z: 4.865 }); // 1.4 m from that burst, 5.3 m from the target
  assert.equal(near.pulled.shots, 0, 'held');
  assert.deepEqual([near.papa.hp, near.max.hp], [100, 100]);
});

cabinTest('the grenade order: a pack centre 3 m from a teammate — thrown when off, failed when on', () => {
  const pack = sim => [[-.2, 0], [.5, .3], [-.4, .4]].map(([dx, dz]) => statue(sim, { x: -4.5 + dx, z: -4.6 + dz }));
  for (const friendlyFire of [undefined, 'full']) {
    const { sim, papa, max, body, run, pulled } = room({ friendlyFire });
    Object.assign(max, { x: -4.5, y: 0, z: 1.2, grenades: 2 });
    Object.assign(papa, { x: -4.5, z: -1.6 }); // 3 m from the pack's centre
    const [first] = pack(sim);
    body.setOrder({ kind: 'grenade', zombieId: first.id });
    run(4, () => body.status !== 'running');
    if (friendlyFire) {
      assert.equal(body.status, 'failed', 'full: the order is refused, not thrown');
      assert.equal(pulled.throws, 0);
      assert.equal(max.grenades, 2);
    } else {
      assert.equal(body.status, 'done');
      assert.equal(pulled.throws, 1);
      assert.equal(max.grenades, 1);
    }
  }
  // On, with nobody near the pack: the throw still goes.
  {
    const { sim, papa, max, body, run, pulled } = room({ friendlyFire: 'full' });
    Object.assign(max, { x: -4.5, y: 0, z: 1.2, grenades: 2 });
    Object.assign(papa, { x: 6, z: 4.5 });
    const [first] = pack(sim);
    body.setOrder({ kind: 'grenade', zombieId: first.id });
    run(4, () => body.status !== 'running');
    assert.equal(body.status, 'done', 'a safe pack is still thrown at');
    assert.equal(pulled.throws, 1);
  }
});

// Grenades a floor away or falling back: a room with friendly fire on, Max
// and Papa where the scene puts them, a pack of statues and a grenade order
// given straight to the body (or the one the eyes offer). The burst the body
// predicted at its trigger is kept.
function grenadeScene({ max: maxAt, papa: papaAt, pack, packY = 0, friendlyFire = 'full' }) {
  const events = [];
  const sim = new RoomSimulation('FFGREN', { random: () => .5, raids: false, onEvent: event => events.push(event) });
  const papa = sim.addPlayer('papa', 'Papa'), max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  if (friendlyFire !== 'off') assert.equal(sim.setFriendlyFire('papa', friendlyFire), true);
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
  for (const door of sim.doors) door.boards.fill(0);
  Object.assign(max, { ...maxAt, yaw: 0, pitch: 0, grenades: 2 });
  Object.assign(papa, { ...papaAt, yaw: 0, pitch: 0 });
  const zombies = pack.map(([x, z]) => Object.assign(sim.spawnZombie(), { x, y: packY, z, speed: 0, attackAfter: Infinity, entered: true, hp: 1e6, maxHp: 1e6, kind: 'walker', scale: 1 }));
  const body = createCompanionBody(sim, 'max', { random: () => .5, profile: STEADY });
  const seen = { throws: 0, predicted: null };
  const throwGrenade = sim.throwGrenade.bind(sim), predictGrenade = sim.predictGrenade.bind(sim);
  sim.throwGrenade = (...args) => { const ok = throwGrenade(...args); if (ok && args[0] === 'max') seen.throws++; return ok; };
  sim.predictGrenade = (...args) => (seen.predicted = predictGrenade(...args));
  const order = (value = null) => body.setOrder(value ?? { kind: 'grenade', zombieId: zombies[0].id });
  const run = () => { for (let tick = 0; tick < 150; tick++) { body.tick(TICK); sim.tick(TICK); } };
  return { sim, events, papa, max, body, seen, order, run, explosion: () => events.find(event => event.event === 'explosion' && event.id === 'max') };
}

cabinTest('the grenade order: a pack on the loft right above the team is never thrown at when on', () => {
  // The pack 3.4 m up, Papa under it, Max 2.6 m back on the ground. Before
  // the 3D rule: thrown, it burst under the loft slab, Papa 100 -> 0 and
  // Max 100 -> 0.
  const scene = { max: { x: 3.8, y: 0, z: 5.3 }, papa: { x: 3.8, y: 0, z: 2.5 }, pack: [[3.3, 2.6], [4.2, 2.6], [3.85, 2.9]], packY: 3.4 };
  const on = grenadeScene(scene);
  on.order(); on.run();
  assert.equal(on.body.status, 'failed');
  assert.equal(on.seen.throws, 0);
  assert.deepEqual([on.papa.hp, on.max.hp, on.max.grenades], [100, 100, 2]);
});

cabinTest('the grenade order: a pack by the stairs with Papa on them is neither offered nor thrown at when on', () => {
  // Papa 1.7 m up the flight, 1.4 m from the pack's centre in plan. Before:
  // offered, thrown, burst on target and Papa 100 -> 0 (263.5).
  const scene = { max: { x: 5.7, y: 0, z: 5.2 }, papa: { x: 4.3, y: 1.7, z: .5 }, pack: [[5.3, .3], [6.1, .3], [5.7, -.1]] };
  const offered = sim => describeSituation(sim, 'max').actions.filter(action => action.value.startsWith('grenade:'));
  const off = grenadeScene({ ...scene, friendlyFire: 'off' });
  assert.equal(offered(off.sim).length, 1, 'off: the pack is offered');
  const on = grenadeScene(scene);
  assert.deepEqual(offered(on.sim), [], 'on: not offered, the body would refuse it');
  on.order(); on.run();
  assert.equal(on.body.status, 'failed', 'given anyway: refused');
  assert.equal(on.seen.throws, 0);
  assert.deepEqual([on.papa.hp, on.max.hp], [100, 100]);
});

cabinTest('the grenade order: a throw that falls back off the partition is refused at the trigger when on', () => {
  // The pack behind the partition (z -2): the grenade strikes it and falls
  // back at Max's feet. The pack itself is 4.9 m from Max and 5.8 m from
  // Papa, so only the predicted flight shows it. Before: thrown, Max and
  // Papa 100 -> 0.
  const scene = { max: { x: 1.3, y: 0, z: 1 }, papa: { x: -.95, y: 0, z: 1.4036820567238482 }, pack: [[.9, -3.8], [1.7, -3.8], [1.3, -4.2]] };
  const on = grenadeScene(scene);
  on.order(); on.run();
  assert.equal(on.body.status, 'failed');
  assert.equal(on.seen.throws, 0);
  assert.deepEqual([on.papa.hp, on.max.hp, on.max.grenades], [100, 100, 2]);
  assert.ok(on.seen.predicted && on.seen.predicted.z > -2, `the predicted burst is on Max's side: ${JSON.stringify(on.seen.predicted)}`);
  // Off, the same hand throws, and it bursts exactly where it was foretold.
  const off = grenadeScene({ ...scene, friendlyFire: 'off' });
  off.order(); off.run();
  assert.equal(off.seen.throws, 1);
  const burst = off.explosion();
  assert.deepEqual({ x: burst.x, y: burst.y, z: burst.z }, on.seen.predicted, 'the prediction is the real burst');
});

cabinTest('the grenade action: a rolled throw that would stop against the low wall by the thrower is neither offered nor thrown when on', () => {
  // A pack seen over the low wall (x .9, 1.15 m high), 5.7 m away: the low
  // throw that lands there in the open rolls into the wall and stops 2.6 m
  // from Max, whatever pitch the hand settles on. The pack itself is far
  // from everyone. Before: offered, and the body threw it.
  const scene = { max: { x: -2.5, y: 0, z: 2.5 }, papa: { x: -7.5, y: 0, z: 5.5 }, pack: [[2.6, 4], [3.4, 4], [3, 3.6]] };
  const offered = sim => describeSituation(sim, 'max').actions.filter(action => action.value.startsWith('grenade:'));
  const off = grenadeScene({ ...scene, friendlyFire: 'off' });
  assert.equal(offered(off.sim).length, 1, 'off: the pack is offered');
  const on = grenadeScene(scene);
  assert.deepEqual(offered(on.sim), [], 'on: not offered, the body would refuse it at its trigger');
  on.order(); on.run();
  assert.equal(on.body.status, 'failed', 'given anyway: refused');
  assert.equal(on.seen.throws, 0);
  assert.ok(on.seen.predicted && Math.hypot(on.seen.predicted.x + 2.5, on.seen.predicted.z - 2.5) < 4.5, `the burst would be by Max: ${JSON.stringify(on.seen.predicted)}`);
  assert.deepEqual([on.papa.hp, on.max.hp, on.max.grenades], [100, 100, 2]);
});

// A grenade in flight (anyone's): while its fuse burns the bodies keep out
// of where it will burst. Papa and companions as the scene puts them, doors
// open, statues for the pack; `bursts` keeps how far (3D, to the middle of
// the body's box, as blastSurvivors measures) each body stood at each burst.
function liveGrenadeRoom({ companions = ['max'], friendlyFire = 'full' } = {}) {
  const events = [];
  const sim = new RoomSimulation('FFLIVE', { random: seededRandom(3), raids: false, onEvent: event => events.push(event) });
  const papa = sim.addPlayer('papa', 'Papa');
  const bots = companions.map(id => sim.addPlayer(id, id, undefined, { companion: true }));
  if (friendlyFire !== 'off') assert.equal(sim.setFriendlyFire('papa', friendlyFire), true);
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
  for (const door of sim.doors) door.boards.fill(0);
  const bodies = Object.fromEntries(companions.map((id, index) => [id, createCompanionBody(sim, id, { random: seededRandom(10 + index), profile: STEADY })]));
  const arm = (player, weapon) => Object.assign(player, { weapon, weaponId: weapon, inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: 100 } } });
  const pack = points => points.map(([x, z]) => statue(sim, { x, z, kind: 'walker', scale: 1 }));
  const reachOf = (player, at) => { const box = playerHitbox(player); return Math.hypot(player.x - at.x, (box.minY + box.maxY) / 2 - at.y, player.z - at.z); };
  const bursts = [];
  const run = (seconds, each = () => {}) => {
    for (let tick = 0; tick < Math.round(seconds * 30); tick++) {
      sim.setInput('papa', { forward: 0, strafe: 0, yaw: papa.yaw, pitch: papa.pitch });
      for (const body of Object.values(bodies)) body.tick(TICK);
      const before = events.length;
      sim.tick(TICK);
      for (const event of events.slice(before)) if (event.event === 'explosion' && event.grenadeId) {
        bursts.push({ ...event, reach: Object.fromEntries(bots.map(bot => [bot.id, reachOf(bot, event)])) });
      }
      each();
    }
  };
  const blasted = () => events.filter(event => event.event === 'hit' && event.source === 'friendly' && event.weapon === 'grenade');
  return { sim, events, papa, bots, bodies, arm, pack, run, bursts, blasted };
}

cabinTest('a live grenade: the thrower sent at the pack it just threw at keeps out of the blast till it bursts when on', () => {
  // Max, a flamethrower, throws at a pack 10 m off; the grenade bursts 7.3 m
  // from him, short of the pack. Then told to shoot the pack, he closes to
  // flame range (4.5 m of it), into his own blast. Before: 2.3 m from the
  // burst, 422.9 to himself, down.
  for (const friendlyFire of ['full', 'off']) {
    const scene = liveGrenadeRoom({ friendlyFire });
    const [max] = scene.bots;
    scene.arm(max, 'flamethrower');
    Object.assign(max, { x: -7.2, y: 0, z: 3, yaw: -Math.PI / 2, pitch: 0, grenades: 2 });
    Object.assign(scene.papa, { x: -7, y: 0, z: -4.5 });
    const [target] = scene.pack([[2.5, 3], [3.1, 3.3], [2.8, 2.5]]);
    scene.bodies.max.setOrder({ kind: 'grenade', zombieId: target.id });
    let sent = false, foreseen = null;
    scene.run(4, () => {
      if (!sent && scene.bodies.max.status === 'done') { sent = true; foreseen = liveBursts(scene.sim); scene.bodies.max.setOrder({ kind: 'shoot', zombieId: target.id }); }
    });
    assert.ok(sent, `${friendlyFire}: thrown`);
    assert.equal(scene.bursts.length, 1);
    const [burst] = scene.bursts;
    assert.deepEqual(foreseen, [{ x: burst.x, y: burst.y, z: burst.z }], 'the burst foreseen in flight is the real one');
    if (friendlyFire === 'off') {
      assert.ok(burst.reach.max < GRENADES.radiusDamage, `off: the same order walks into the blast (${burst.reach.max.toFixed(2)} m), harmless`);
      continue;
    }
    assert.ok(burst.reach.max >= GRENADES.radiusDamage + .4, `on: kept out of its reach (${burst.reach.max.toFixed(2)} m)`);
    assert.deepEqual(scene.blasted(), []);
    assert.equal(max.hp, 100);
    // Burst: the order goes on, into flame range.
    scene.run(3);
    assert.ok(Math.hypot(max.x - target.x, max.z - target.z) < 4.8, `then closes on the pack: (${max.x.toFixed(2)}, ${max.z.toFixed(2)})`);
  }
});

cabinTest('a live grenade: a second companion sent at the pack waits outside the blast till it bursts when on', () => {
  // Max throws and holds; Lou, a flamethrower 1.4 m beside him, is then told
  // to shoot the pack. Before: Lou 2.5 m from the burst, 394 damage, down.
  for (const friendlyFire of ['full', 'off']) {
    const scene = liveGrenadeRoom({ companions: ['max', 'lou'], friendlyFire });
    const [max, lou] = scene.bots;
    scene.arm(max, 'pistol'); scene.arm(lou, 'flamethrower');
    Object.assign(max, { x: -7.2, y: 0, z: 3, yaw: -Math.PI / 2, pitch: 0, grenades: 2 });
    Object.assign(lou, { x: -7.2, y: 0, z: 4.4, yaw: -Math.PI / 2, pitch: 0 });
    Object.assign(scene.papa, { x: -7, y: 0, z: -4.5 });
    const [target] = scene.pack([[2.5, 3], [3.1, 3.3], [2.8, 2.5]]);
    scene.bodies.max.setOrder({ kind: 'grenade', zombieId: target.id });
    scene.bodies.lou.setOrder({ kind: 'hold' });
    let sent = false;
    scene.run(4, () => {
      if (!sent && scene.sim.grenades.size) { sent = true; scene.bodies.max.setOrder({ kind: 'hold' }); scene.bodies.lou.setOrder({ kind: 'shoot', zombieId: target.id }); }
    });
    assert.ok(sent, `${friendlyFire}: thrown`);
    const [burst] = scene.bursts;
    if (friendlyFire === 'off') {
      assert.ok(burst.reach.lou < GRENADES.radiusDamage, `off: Lou walks into the blast (${burst.reach.lou.toFixed(2)} m), harmless`);
      continue;
    }
    assert.ok(burst.reach.lou >= GRENADES.radiusDamage + .4, `on: Lou kept out of its reach (${burst.reach.lou.toFixed(2)} m)`);
    assert.deepEqual(scene.blasted(), []);
    assert.deepEqual([max.hp, lou.hp], [100, 100]);
  }
});

cabinTest('a live grenade: a companion holding where Papa\'s grenade will burst gets out of its reach when on', () => {
  // Papa throws across the room; Max holds 2.5 m from where it will burst
  // (sim.predictGrenade). Before: he stayed, 403.4 damage, down.
  for (const friendlyFire of ['full', 'off']) {
    const scene = liveGrenadeRoom({ friendlyFire });
    const [max] = scene.bots;
    scene.arm(max, 'pistol');
    Object.assign(scene.papa, { x: -6, y: 0, z: 0, yaw: -Math.PI / 2, pitch: .1, grenades: 2, throwAfter: 0 });
    const landing = scene.sim.predictGrenade(scene.papa);
    Object.assign(max, { x: landing.x, y: 0, z: landing.z + 2.5, yaw: 0, pitch: 0 });
    scene.bodies.max.setOrder({ kind: 'hold' });
    scene.run(.2);
    assert.equal(scene.sim.throwGrenade('papa'), true);
    scene.run(2.5);
    const [burst] = scene.bursts;
    assert.deepEqual({ x: burst.x, y: burst.y, z: burst.z }, landing, 'it bursts where it was foretold');
    if (friendlyFire === 'off') {
      assert.ok(Math.abs(burst.reach.max - 2.5) < .05, `off: Max holds where he stood (${burst.reach.max.toFixed(2)} m)`);
      continue;
    }
    assert.ok(burst.reach.max >= GRENADES.radiusDamage, `on: Max got out of its reach (${burst.reach.max.toFixed(2)} m)`);
    assert.deepEqual(scene.blasted(), []);
    assert.equal(max.hp, 100);
  }
});

// The eyes (companions/situation.mjs): no ticking needed, the text and the
// actions are read straight off the room.
function situationRoom({ friendlyFire, mateNearPack = false, pack = true } = {}) {
  const sim = new RoomSimulation('SITFF0', { random: seededRandom(3), onEvent: () => {} });
  sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave: 3, toSpawn: 1, spawnTimer: 1e9 });
  if (friendlyFire) sim.friendlyFire = friendlyFire;
  Object.assign(max, { x: 2.6, y: 0, z: 1.8, grenades: 2 });
  Object.assign(sim.players.get('papa'), mateNearPack ? { x: 2.3, y: 0, z: .2 } : { x: 6, y: 0, z: 4.5 });
  if (pack) [[2.6, -2.9], [2.2, -3.2], [2.4, -2.5]].forEach(([x, z], index) => sim.zombies.set(`z${index}`, {
    id: `z${index}`, x, y: 0, z, yaw: 0, hp: 80, maxHp: 80, kind: 'walker', scale: 1, boss: false, speed: 0, attackAfter: Infinity,
    entered: true, doorId: 'west', stairState: null, pushX: 0, pushZ: 0, pushLeft: 0 }));
  return sim;
}
const grenadeAction = result => result.actions.find(action => action.value.startsWith('grenade:'));

test('the friendly-fire line appears in the situation only when the room turns it on', () => {
  const text = level => describeSituation(situationRoom({ friendlyFire: level, pack: false }), 'max').text;
  assert.ok(!text(undefined).includes('FRIENDLY FIRE'), 'default: no line');
  assert.ok(!text('off').includes('FRIENDLY FIRE'), 'off: no line');
  assert.ok(text('reduced').includes('FRIENDLY FIRE ON (reduced: a quarter of the damage):'));
  assert.ok(text('full').includes('FRIENDLY FIRE ON (full: full damage):'));
});

// A crowd for the eyes: statues where `points` puts them, Max and Papa too,
// each predicted flight counted.
function crowdRoom({ max: maxAt, papa: papaAt, points, entered = true, boards = 'open' }) {
  const sim = new RoomSimulation('FFCROW', { random: () => .5, raids: false, onEvent: () => {} });
  const papa = sim.addPlayer('papa', 'Papa'), max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  sim.setFriendlyFire('papa', 'full'); sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
  if (boards === 'open') for (const door of sim.doors) door.boards.fill(0);
  Object.assign(max, { ...maxAt, grenades: 3 }); Object.assign(papa, papaAt);
  for (const [x, z] of typeof points === 'function' ? points(sim) : points) Object.assign(sim.spawnZombie(), { x, y: 0, z, speed: 0, attackAfter: Infinity, entered, hp: 1e6, maxHp: 1e6, kind: 'walker', scale: 1 });
  const flights = { count: 0 }, predict = sim.predictGrenade.bind(sim);
  sim.predictGrenade = (...args) => { flights.count++; return predict(...args); };
  return { sim, flights };
}

cabinTest('the grenade action: a crowd whose throws all fall back costs a few flights, not one per zombie, when on', () => {
  // 15 zombies piled outside the boarded west door, Max inside facing it:
  // every throw strikes the planks and falls back 4 m from him. Before: 15
  // flights (~1 ms each) per describeSituation.
  const pile = sim => {
    const west = sim.doors.find(entry => entry.id === 'west'), points = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) points.push([west.x - 1.2 - i * .7, west.z - 1.4 + j * .7]);
    return points;
  };
  const door = crowdRoom({ max: { x: -3, y: 0, z: 0, yaw: Math.PI / 2 }, papa: { x: 5, y: 0, z: 4 }, points: pile, entered: false, boards: 'intact' });
  assert.deepEqual(describeSituation(door.sim, 'max').actions.filter(action => action.value.startsWith('grenade:')), []);
  assert.ok(door.flights.count <= 4, `${door.flights.count} flights`);
  // 24 zombies beyond the low wall: the packs behind it roll into it, the
  // ones a low line reaches past its end are flown first and one is offered.
  const wall = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) wall.push([2.2 + i * .8, 1.6 + j * .8]);
  const low = crowdRoom({ max: { x: -2.5, y: 0, z: 2.5 }, papa: { x: -7.5, y: 0, z: 5.5 }, points: wall });
  const offered = describeSituation(low.sim, 'max').actions.filter(action => action.value.startsWith('grenade:'));
  assert.equal(offered.length, 1, 'a safe pack is still offered');
  assert.ok(low.flights.count <= 4, `${low.flights.count} flights`);
});

cabinTest('the grenade action says who the blast hurts, and a pack next to a teammate is not offered when on', () => {
  // Off: the historical wording, and the pack is offered even with papa near it.
  const off = describeSituation(situationRoom({ mateNearPack: true }), 'max');
  assert.ok(grenadeAction(off), 'off: the pack is offered');
  assert.ok(grenadeAction(off).description.includes('never hurts the team or the boards.'), grenadeAction(off).description);
  // Reduced and full: the honest wording, and a safe pack is still offered.
  for (const level of ['reduced', 'full']) {
    const on = describeSituation(situationRoom({ friendlyFire: level }), 'max');
    assert.ok(grenadeAction(on), `${level}: a safe pack is still offered`);
    assert.ok(grenadeAction(on).description.includes('the blast hurts survivors within 4 m too, you included.'), grenadeAction(on).description);
  }
  // Full, papa 3 m from the pack's centre: no grenade action at all.
  const near = describeSituation(situationRoom({ friendlyFire: 'full', mateNearPack: true }), 'max');
  assert.equal(grenadeAction(near), undefined, 'full: the pack by a teammate is not offered');
});

test('a default room (friendlyFire off) gives exactly the situation it always did', () => {
  const bare = situationRoom({}); // never touched: the default is 'off'
  assert.equal(bare.friendlyFire, 'off');
  const before = describeSituation(bare, 'max');
  const explicit = describeSituation(situationRoom({ friendlyFire: 'off' }), 'max');
  assert.equal(before.text, explicit.text);
  assert.deepEqual(before.actions, explicit.actions);
});

// The same guards on both maps: lane scenarios (a clear line found on the map
// itself) run here on the cabin, and on the supermarket in a child process.
test('cabin and supermarket lanes: the teammate is never hurt, and off the companion still fires and throws', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  for (const level of ['cabin', 'supermarket']) {
    const env = { ...process.env }; if (level === 'supermarket') env.DEADWOOD_LEVEL = 'supermarket'; else delete env.DEADWOOD_LEVEL;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { runLaneScenarios } from './test/fixtures/companions-friendly-fire-lane.mjs';
      import { LEVEL } from './public/level-config.js';
      console.log(LEVEL.id + ' lanes: ' + runLaneScenarios());
    `], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, new RegExp(`${level} lanes: 2`));
  }
});
