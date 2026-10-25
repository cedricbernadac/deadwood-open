import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { enemyHitbox } from '../public/enemies.js';

// Impact numbers (owner, 18 October): the score each hit earned, which is
// its useful damage, numbered for its own survivor only. These tests replace
// the room-wide opt-in « Dégâts à l'impact » ones: same accuracy, isolation,
// burn batching and payload measurements, under the new per-survivor rule.
const near = (actual, expected, tolerance = .00051) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function fixture(weapon = 'flamethrower', ambiance = 'family', Type = RoomSimulation, observers = ['a']) {
  const events = [], sim = new Type('DAMAGE', { random: () => .5, raids: false, ambiance, onEvent: event => events.push(event) });
  const player = sim.addPlayer('a'); sim.addPlayer('b'); sim.start(player.id);
  sim.setImpactObservers(observers);
  Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
  Object.assign(player, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon, weaponId: weapon,
    inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } } });
  const batches = [];
  // What the servers do after every tick and shot: one private list each.
  const take = () => { for (const [id, records] of sim.takeImpactNumbers()) batches.push({ id, time: sim.time, records }); };
  return { sim, player, events, batches, take };
}
function target(sim, id = 'victim', extra = {}) {
  const zombie = { id, x: 12, y: 0, z: 6, yaw: 0, hp: 10000, maxHp: 10000, kind: 'walker', scale: 1,
    speed: 0, attackAfter: Infinity, entered: true, ...extra };
  sim.zombies.set(id, zombie); return zombie;
}
function advance(sim, seconds, update, take = () => {}) {
  for (let left = seconds; left > 1e-9;) {
    const delta = Math.min(1 / 30, left); sim.time += delta; update(delta); take(); left -= delta;
  }
}
const records = batches => batches.flatMap(batch => batch.records);
const burnsOf = batches => records(batches).filter(record => record[5] & 8);
const sum = list => list.reduce((total, record) => total + record[4], 0);

test('impact numbers are personal and opt-in, and change neither damage, ownership nor score', () => {
  const fresh = new RoomSimulation('OFF'); fresh.addPlayer('a');
  assert.equal(fresh.impactObservers.size, 0);
  assert.equal(Object.hasOwn(fresh.snapshot(), 'damageFeedbackEnabled'), false, 'nothing about anyone\'s numbers in the room snapshot');
  for (const invalid of [undefined, null, 1, 'a', {}]) assert.equal(fresh.setImpactObservers(invalid), false);
  assert.equal(fresh.setImpactObservers(['a', 'missing', 7]), true);
  assert.deepEqual([...fresh.impactObservers], ['a'], 'only survivors of this room');
  for (const weapon of ['flamethrower', 'rocket', 'grenade']) {
    const outcomes = [];
    for (const observers of [[], ['a'], ['b']]) {
      const { sim, player, events, batches, take } = fixture(weapon === 'grenade' ? 'pistol' : weapon, 'family', RoomSimulation, observers);
      const victim = target(sim, 'armored', { kind: 'armored', hp: 1000, maxHp: 1000 });
      if (weapon === 'grenade') {
        const box = enemyHitbox(victim), grenade = { id: 'g', ownerId: player.id, x: victim.x,
          y: (box.minY + box.maxY) / 2, z: victim.z };
        sim.grenades.set('g', grenade); sim.explodeGrenade(grenade);
      } else sim.shoot(player.id);
      take(); advance(sim, 4.5, delta => sim.updateBurns(delta), take);
      assert.ok(!events.some(event => event.event === 'burn-damage' || Object.hasOwn(event, 'impacts') && event.event !== 'melee-hit'), 'no impact data in any public event');
      if (observers.includes('a')) {
        assert.ok(batches.length > 0 && batches.every(batch => batch.id === 'a'), weapon);
        assert.equal(sum(records(batches)), player.score, `${weapon}: the numbers add up to the score`);
      } else assert.equal(batches.length, 0, `${weapon}: nobody else's numbers (${observers})`);
      outcomes.push({ hp: victim.hp, score: player.score, kills: player.kills,
        killOwners: events.filter(event => event.event === 'kill').map(event => event.id) });
    }
    assert.deepEqual(outcomes[0], outcomes[1], weapon); assert.deepEqual(outcomes[0], outcomes[2], weapon);
    assert.ok(Math.abs(outcomes[0].score - Math.min(1000, 1000 - outcomes[0].hp)) <= 1, `${weapon}: the score is the useful damage`);
  }
});

test('stopping drops the burn numbers still waiting; starting never numbers past damage', () => {
  const { sim, player, batches, take } = fixture(), zombie = target(sim);
  sim.shoot(player.id); take(); sim.time += .1; sim.updateBurns(.1); assert.equal(sim.burnDamagePending.size, 1);
  sim.setImpactObservers([]); assert.equal(sim.burnDamagePending.size, 0); assert.equal(sim.burnDamageNextAt, 0);
  const previousHp = zombie.hp; advance(sim, .5, delta => sim.updateBurns(delta), take); assert.ok(zombie.hp < previousHp);
  const before = batches.length;
  assert.equal(burnsOf(batches).length, 0, 'no burn batch while off');
  sim.setImpactObservers(['a']); sim.flushBurnNumbers(); take(); assert.equal(batches.length, before);
  const score = player.score; advance(sim, .4, delta => sim.updateBurns(delta), take);
  assert.ok(burnsOf(batches.slice(before)).length > 0);
  assert.ok(sum(burnsOf(batches.slice(before))) <= player.score - score, 'only what burned since');
});

test('a bullet numbers its useful damage after armour and overkill, in LAN and online, and only for its shooter', () => {
  for (const Type of [RoomSimulation, OnlineRoomSimulation]) for (const ambiance of ['family', 'frisson']) for (const hp of [1, 10000]) {
    const { sim, player, events, batches, take } = fixture('pistol', ambiance, Type, ['a', 'b']);
    const zombie = target(sim, 'armored', { y: .4, kind: 'armored', hp });
    assert.equal(sim.shoot(player.id), true); take();
    assert.equal(batches.length, 0, 'nothing before the bullet arrives');
    advance(sim, .2, delta => sim.updateBullets(delta), take);
    const impact = events.find(event => event.event === 'bullet-impact' && event.zombieId === zombie.id);
    assert.ok(impact); near(impact.damage, Math.min(hp, hp - zombie.hp));
    assert.deepEqual(batches.map(batch => batch.id), ['a'], 'b watches its own numbers, never a\'s');
    const [[id, x, y, z, amount, flags]] = batches[0].records;
    assert.equal(id, zombie.id); assert.ok([x, y, z].every(Number.isFinite));
    assert.equal(amount, player.score, 'the number is the score the hit earned');
    assert.equal(amount, hp === 1 ? 1 : Math.floor(impact.damage + 1e-6));
    assert.equal(Boolean(flags & 4), hp === 1, 'the killing blow is marked');
  }
});

test('one shotgun shot makes one number per enemy; blood-only contacts add nothing', () => {
  const { sim, player, batches, take } = fixture('shotgun', 'frisson'); const front = target(sim, 'fragile', { hp: 1, y: .4 });
  const back = target(sim, 'back', { z: 5, y: .4 });
  sim.shoot(player.id); advance(sim, .2, delta => sim.updateBullets(delta), take);
  const list = records(batches);
  assert.equal(list.filter(record => record[0] === 'fragile').length, 1);
  assert.deepEqual(list.find(record => record[0] === 'fragile').slice(4), [1, 4], 'its one HP, a kill');
  assert.ok(list.filter(record => record[0] === 'back').length <= batches.length, 'at most one number per enemy per tick');
  assert.equal(sum(list), player.score);
  assert.ok(back.hp < 10000 && front.hp <= 0);
});

test('a melee blow numbers the clipped, armour-adjusted amount for its owner', () => {
  for (const hp of [1, 10000]) {
    const { sim, player, events, batches, take } = fixture('katana');
    const zombie = target(sim, 'armored', { kind: 'armored', z: 6.7, hp });
    assert.equal(sim.shoot(player.id, 0, 'light'), true);
    sim.time = player.pendingMelee.impactAt + .001; sim.updateMelee(); take();
    const event = events.find(event => event.event === 'melee-hit'), impact = event.impacts[0];
    near(impact.damage, Math.min(hp, hp - zombie.hp));
    const [record] = records(batches);
    assert.equal(record[0], zombie.id); assert.equal(record[4], player.score); assert.equal(Boolean(record[5] & 4), hp === 1);
  }
});

test('grenade and rocket blasts number each actual victim including armoured enemies and raiders in every look', () => {
  for (const weapon of ['grenade', 'rocket']) for (const ambiance of ['family', 'frisson']) {
    const { sim, player, events, batches, take } = fixture(weapon === 'grenade' ? 'pistol' : weapon, ambiance);
    const primary = target(sim, 'fragile', { hp: 1, maxHp: 1, y: .615 });
    const impactZ = weapon === 'rocket' ? primary.z + .3201 : primary.z;
    const armored = target(sim, 'armored', { x: 13, z: impactZ, y: .615, kind: 'armored' });
    const raider = target(sim, 'raider', { x: 11, z: impactZ, y: .615, kind: 'raider', bodyDamage: .5 });
    const excluded = target(sim, 'outside-radius', { x: 17 });
    if (weapon === 'rocket') assert.equal(sim.shoot(player.id), true);
    else {
      const box = enemyHitbox(primary), grenade = { id: 'g', ownerId: player.id, x: primary.x,
        y: (box.minY + box.maxY) / 2, z: primary.z };
      sim.grenades.set(grenade.id, grenade); assert.equal(sim.explodeGrenade(grenade), true);
    }
    take();
    const blast = events.find(event => event.event === 'explosion');
    assert.equal(blast.id, player.id); assert.equal(Object.hasOwn(blast, 'impacts'), false, 'the public blast carries no numbers');
    const list = records(batches);
    assert.deepEqual(list.map(record => record[0]).sort(), ['armored', 'fragile', 'raider']);
    for (const zombie of [primary, armored, raider]) {
      const record = list.find(item => item[0] === zombie.id);
      assert.ok(Math.abs(record[4] - Math.min(zombie.maxHp, zombie.maxHp - zombie.hp)) <= 1, `${weapon} ${zombie.id}`);
      assert.equal(Boolean(record[5] & 4), zombie === primary);
      // A rocket's numbers are marked (16): its shooter draws them when the
      // visible rocket lands, like its kills; a grenade's blast is already seen.
      assert.equal(Boolean(record[5] & 16), weapon === 'rocket', `${weapon} ${zombie.id} blast flag`);
    }
    assert.equal(sum(list), player.score);
    assert.equal(excluded.hp, 10000);
  }
});

test('a grenade whose thrower left damages but scores and numbers nobody', () => {
  const { sim, player, batches, take } = fixture('pistol'), zombie = target(sim, 'fragile', { hp: 5, maxHp: 5 });
  const box = enemyHitbox(zombie), grenade = { id: 'g', ownerId: player.id, x: zombie.x,
    y: (box.minY + box.maxY) / 2, z: zombie.z };
  sim.grenades.set(grenade.id, grenade); sim.removePlayer(player.id);
  assert.equal(sim.explodeGrenade(grenade), true); take();
  assert.equal(sim.zombies.has(zombie.id), false);
  assert.equal(batches.length, 0);
});

test('flame contact and coalesced burns are numbered apart, as continuous fire, and add up to the score', () => {
  for (const hp of [1, 40, 10000]) {
    const { sim, player, batches, take } = fixture(), zombie = target(sim, 'armored', { kind: 'armored', hp, maxHp: hp });
    assert.equal(sim.shoot(player.id), true); take();
    const [contact] = records(batches);
    assert.equal(contact[0], zombie.id); assert.ok(contact[5] & 2, 'continuous fire');
    assert.equal(Boolean(contact[5] & 4), hp === 1);
    advance(sim, 4.5, delta => sim.updateBurns(delta), take);
    assert.equal(sum(records(batches)), player.score);
    assert.ok(Math.abs(player.score - Math.min(hp, hp - zombie.hp)) <= 1);
    if (hp === 40) assert.ok(burnsOf(batches).some(record => record[5] & 4), 'the burn that kills is marked');
  }
});

// The burn's score follows the flame that keeps it alive (review, 18 October):
// it used to go wholly to the first igniter, who keeps the kill and its loot.
test('the first igniter keeps the burn and its kill; the stretch another flame keeps alive is numbered and scored for that shooter', () => {
  const { sim, player, events, batches, take } = fixture('flamethrower', 'family', RoomSimulation, ['a', 'b']), zombie = target(sim);
  const other = sim.players.get('b'); Object.assign(other, { ...player, id: 'b', inventory: { flamethrower: { ammo: 80, reserve: 40 } } });
  sim.shoot(player.id); take(); advance(sim, .5, delta => sim.updateBurns(delta), take); sim.shoot(other.id); take();
  advance(sim, 1, delta => sim.updateBurns(delta), take);
  assert.equal(zombie.burnOwnerId, player.id);
  assert.deepEqual(events.filter(event => event.event === 'shot').map(event => event.id), ['a', 'b']);
  const ofA = batches.filter(batch => batch.id === 'a').flatMap(batch => batch.records), ofB = batches.filter(batch => batch.id === 'b').flatMap(batch => batch.records);
  assert.ok(Math.abs(sum(burnsOf(batches.filter(batch => batch.id === 'a'))) - 175 * .5) <= 1, 'a’s burn: the half second before b’s flame');
  assert.ok(Math.abs(sum(burnsOf(batches.filter(batch => batch.id === 'b'))) - 175) <= 1, 'b’s flame drives the next second of it');
  assert.equal(sum(ofB), other.score);
  assert.equal(sum(ofA), player.score);
  assert.ok(Math.abs(player.score + player.scoreCarry + other.score + other.scoreCarry - (10000 - zombie.hp)) < 1e-6, 'every HP once');
});

test('burn batches survive the victim, freeze during the pause, flush after an ending and clear on a new night', () => {
  const { sim, player, batches, take } = fixture(), zombie = target(sim, 'fragile', { hp: 10, maxHp: 10 });
  sim.shoot(player.id); take(); sim.tick(1 / 30); take();
  assert.equal(sim.zombies.has(zombie.id), false); assert.equal(burnsOf(batches).length, 0);
  const time = sim.time; sim.paused = true; sim.tick(.1); assert.equal(sim.time, time);
  assert.equal(burnsOf(batches).length, 0);
  sim.paused = false; sim.endGame(); for (let index = 0; index < 3; index++) { sim.tick(.1); take(); }
  assert.equal(burnsOf(batches).length, 1); assert.ok(burnsOf(batches)[0][5] & 4);
  assert.equal(sum(records(batches)), 10, 'the contact and the burn: its ten HP');
  sim.phase = 'wave'; const next = target(sim, 'new-burn');
  sim.shoot(player.id); take(); sim.time += 1 / 30; sim.updateBurns(1 / 30);
  assert.ok(next.hp < 10000); assert.equal(sim.burnDamagePending.size, 1);
  sim.endGame();
  assert.equal(sim.start(player.id), true); assert.equal(sim.burnDamagePending.size, 0);
  assert.equal(sim.burnDamageNextAt, 0); assert.equal(sim.impactPending.size, 0);
  const before = batches.length; for (let index = 0; index < 10; index++) { sim.tick(.1); take(); }
  assert.equal(batches.length, before);
});

test('removed fixtures cannot number fake burns and a practice reset drops old burn numbers', () => {
  const { sim, player, batches, take } = fixture(), zombie = target(sim);
  sim.shoot(player.id); take(); sim.zombies.delete(zombie.id); sim.time += 1; sim.applyZombieBurn(zombie, sim.time);
  sim.time += .3; sim.flushBurnNumbers(); take(); assert.equal(burnsOf(batches).length, 0);
  const practice = new RoomSimulation('P', { practice: true }); practice.addPlayer('a');
  practice.setImpactObservers(['a']);
  practice.queueBurnNumber({ ...zombie, hp: 100 }, 'a', 5, false);
  assert.equal(practice.burnDamagePending.size, 1);
  practice.resetPracticeTargets(); assert.equal(practice.burnDamagePending.size, 0);
});

// Spec rule 1: practice rooms keep their score behaviour; the stand always
// kept a running score (never coins).
test('the practice stand numbers its damage and keeps its running score', () => {
  const events = [], sim = new RoomSimulation('P', { practice: true, random: () => .5, onEvent: event => events.push(event) }), player = sim.addPlayer('a');
  sim.setImpactObservers(['a']);
  const [first] = sim.zombies.values();
  Object.assign(player, { x: first.x, z: first.z + 3, yaw: 0, pitch: 0 });
  const batches = [];
  for (let shot = 0; shot < 4; shot++) {
    sim.time = Math.max(sim.time, player.shotAfter); sim.shoot('a');
    for (let tick = 0; tick < 6; tick++) { sim.tick(1 / 30); for (const [id, list] of sim.takeImpactNumbers()) batches.push({ id, records: list }); }
  }
  assert.ok(sum(records(batches)) > 0, 'the stand shows its damage');
  const chainBonus = events.filter(event => event.event === 'kill').reduce((total, event) => total + event.chainBonus, 0);
  assert.equal(player.score, sum(records(batches)) + chainBonus, 'and scores it, with its chain bonuses');
  assert.equal(player.points, 0, 'no coins in the stand');
});

test('50 and 100 burning targets share at most four burn batches a second, capped per batch', t => {
  for (const count of [50, 100]) {
    const { sim, player, batches, take } = fixture();
    for (let index = 0; index < count; index++) target(sim, `target-${index}`, {
      x: 12 + (index % 10 - 4.5) * .04, z: 6 - Math.floor(index / 10) * .04, hp: 1e6, maxHp: 1e6 });
    const began = performance.now(); sim.shoot(player.id); take(); advance(sim, 4.5, delta => sim.updateBurns(delta), take);
    const elapsed = performance.now() - began, burns = batches.filter(batch => batch.records.some(record => record[5] & 8));
    assert.ok(burns.length <= 17, 'including the final partial batch after four seconds of burn');
    for (let index = 1; index < burns.length; index++) assert.ok(burns[index].time - burns[index - 1].time >= .25 - 1e-8);
    assert.ok(batches.every(batch => batch.records.length <= 16), 'a batch numbers sixteen enemies at most');
    const bytes = batches.reduce((total, batch) => total + Buffer.byteLength(JSON.stringify({ type: 'impacts', impacts: batch.records })), 0);
    t.diagnostic(JSON.stringify({ targets: count, simulatedSeconds: 4.5, burnSeconds: 4, messages: batches.length,
      bytes, bytesPerSecond: Math.round(bytes / 4), updateCpuMs: Math.round(elapsed * 100) / 100,
      scope: 'synthetic stable targets, one real flame contact plus 135 burn updates, one observer' }));
  }
});

// Codex measured ~97 kB/s per enabled client for the room-wide opt-in with
// 100 overlapping targets under continuous fire. Same scene here: the bytes
// of the private messages its shooter receives, against nothing at all off.
test('continuous flame on 50 and 100 targets: added bytes for its shooter, none when off', t => {
  for (const count of [50, 100]) {
    const modes = [false, true].map(enabled => ({ enabled, samples: [], last: null }));
    for (let sample = -1; sample < 5; sample++) for (const mode of sample % 2 ? modes : [...modes].reverse()) {
      const { sim, player, events, batches, take } = fixture('flamethrower', 'family', RoomSimulation, mode.enabled ? ['a'] : []);
      for (let index = 0; index < count; index++) target(sim, `target-${index}`, {
        x: 12 + (index % 10 - 4.5) * .04, z: 6 - Math.floor(index / 10) * .04, hp: 1e6, maxHp: 1e6 });
      const began = performance.now(); sim.shoot(player.id); take();
      advance(sim, 4, delta => { sim.shoot(player.id); sim.updateBurns(delta); }, take);
      const elapsed = performance.now() - began, shots = events.filter(event => event.event === 'shot');
      assert.ok(shots.length >= 30);
      assert.ok(shots.every(event => !Object.hasOwn(event, 'impacts')), 'public shots never grow');
      const bytes = batches.reduce((total, batch) => total + Buffer.byteLength(JSON.stringify({ type: 'impacts', impacts: batch.records })), 0);
      if (!mode.enabled) assert.equal(bytes, 0);
      if (sample >= 0) mode.samples.push(elapsed);
      mode.last = { flameShots: shots.length, messages: batches.length, addedBytes: bytes, addedBytesPerSecond: Math.round(bytes / 4),
        hp: [...sim.zombies.values()].map(zombie => zombie.hp), score: player.score };
    }
    assert.deepEqual(modes[0].last.hp, modes[1].last.hp); assert.equal(modes[0].last.score, modes[1].last.score);
    for (const mode of modes) {
      const { hp, ...measurements } = mode.last;
      t.diagnostic(JSON.stringify({ targets: count, enabled: mode.enabled, simulatedSeconds: 4, ...measurements,
        simulationCpuMedianMs: Math.round(mode.samples.sort((a, b) => a - b)[2] * 100) / 100, measuredRuns: 5,
        scope: 'synthetic overlapping targets, held fire plus 120 burn updates, one observer; serialization of the private message only' }));
    }
  }
});
