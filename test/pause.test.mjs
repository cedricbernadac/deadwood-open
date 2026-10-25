import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { ARMORY, MAX_WAVES } from '../public/rules.js';
import { FUEL_CACHES } from '../public/expedition.js';

function room({ practice = false, players = 2, wave = 8 } = {}) {
  const events = [], sim = new RoomSimulation('PAUSE', { practice, random: () => .5, onEvent: event => events.push(event) });
  for (let index = 0; index < players; index++) sim.addPlayer(String(index), `Player ${index}`);
  if (!practice) { sim.wave = wave - 1; sim.beginWave(); sim.toSpawn = 1; sim.spawnTimer = 999; }
  return { sim, events, a: sim.players.get('0'), b: sim.players.get('1'), c: sim.players.get('2') };
}
function advance(sim, seconds) {
  for (let count = 0; count < Math.round(seconds * 30); count++) sim.tick(1 / 30);
}
function equip(player, id) {
  player.inventory[id] = { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve };
  player.weapon = id; player.shotAfter = 0; player.reloadUntil = 0; player.meleeAfter = 0;
}
function stableState(sim) {
  return structuredClone({ snapshot: sim.snapshot(), generator: sim.generator, pickups: [...sim.pickups],
    warnings: [...sim.spawnWarnings], grenade: [...sim.grenades], players: [...sim.players], zombies: [...sim.zombies],
    spawnTimer: sim.spawnTimer, nextZombieId: sim.nextZombieId, nextPickupId: sim.nextPickupId });
}

test('only the current host can explicitly pause or resume a live room', () => {
  const { sim, events } = room();
  assert.equal(sim.setPause('1', true), false);
  assert.equal(sim.setPause('0', 'true'), false);
  assert.equal(sim.setPause('missing', true), false);
  assert.equal(sim.paused, false);
  assert.deepEqual(events.filter(event => event.event === 'pause-denied').map(event => event.reason), ['host', 'invalid']);
  assert.equal(sim.setPause('0', true), true);
  assert.equal(sim.snapshot().paused, true); assert.equal(sim.snapshot().pauseById, '0');
  const number = events.length;
  assert.equal(sim.setPause('0', true), true); assert.equal(events.length, number, 'a repeated request never toggles');
  assert.equal(sim.setPause('1', false), false); assert.equal(sim.paused, true);
  assert.equal(sim.setPause('0', false), true);
  assert.equal(sim.snapshot().paused, false); assert.equal(sim.snapshot().pauseById, null);
});

test('a minute of pause freezes reload, melee recovery, bleed-out, burn, rain, fuel, fuses, loot and emergence', () => {
  const { sim, a, b, c, events } = room({ players: 3 });
  a.grenades = 1; assert.equal(sim.throwGrenade(a.id), true);
  a.inventory.pistol.ammo = 1; assert.equal(sim.reload(a.id), true);
  Object.assign(a, { x: 15, z: 1, outsideDamageAccumulator: .8 });
  a.umbrella.open = true; a.umbrella.remaining = 7;
  equip(c, 'hammer'); assert.equal(sim.shoot(c.id, 0, 'heavy'), true);
  sim.damagePlayer(b, 100); assert.equal(b.downed, true);
  Object.assign(sim.generator, { active: true, missionWave: 5, elapsed: 7 });
  sim.fuel = { ...FUEL_CACHES[0], carrierId: a.id, cacheIndex: 0 };
  const zombie = sim.spawnZombie();
  Object.assign(zombie, { hp: 10000, maxHp: 10000, speed: 0, attackAfter: Infinity,
    burnOwnerId: a.id, burnStartedAt: sim.time, burnDamageAt: sim.time, burnUntil: sim.time + 4 });
  sim.reserveZombieSpawn();
  sim.pickups.set('expiring', { id: 'expiring', kind: 'cash', x: 30, y: 0, z: 0, amount: 12, expiresAt: sim.time + .2 });
  assert.equal(sim.setPause(a.id, true), true);
  assert.equal(c.pendingMelee, null); assert.ok(c.meleeAfter > sim.time);
  const before = stableState(sim), eventCount = events.length;
  advance(sim, 60);
  assert.deepEqual(stableState(sim), before);
  assert.equal(events.length, eventCount, 'nothing keeps dealing damage or producing events in the frozen room');
  assert.equal(sim.setPause(a.id, false), true);
  advance(sim, 1);
  assert.ok(sim.time > before.snapshot.time + .99);
  assert.ok(sim.generator.elapsed > 7.99); assert.ok(a.umbrella.remaining < 6.01);
  assert.equal(c.pendingMelee, null); assert.equal(sim.pickups.has('expiring'), false);
  assert.equal(events.filter(event => event.event === 'melee-hit' && event.id === c.id).length, 0);
  assert.ok(zombie.hp < 10000); assert.ok(b.alive); assert.ok(b.bleedOutAt - sim.time > 23.9);
  assert.ok([...sim.grenades.values()][0].fuseLeft < before.grenade[0][1].fuseLeft - .99);
  assert.equal(sim.spawnWarnings.size, 1);
  assert.ok(sim.snapshot().spawnWarnings[0].remaining > .99, 'an emergence keeps its full remaining warning');
  assert.ok(a.reloadUntil > sim.time, 'only one second of the reload passed after resumption');
  advance(sim, 1.1); assert.equal(sim.spawnWarnings.size, 0); assert.equal(a.reloadUntil, 0);
});

test('pause clears held movement, spin and all committed melee while retaining their full recovery', () => {
  const { sim, a, b } = room();
  equip(a, 'minigun'); assert.equal(sim.setMinigunSpin(a.id, true), true);
  equip(b, 'hammer'); assert.equal(sim.shoot(b.id, 0, 'heavy'), true);
  sim.setInput(a.id, { forward: 1, strafe: 1, sprint: true, crouch: true, jump: true, yaw: 1, pitch: .2 });
  const recovery = { meleeAfter: b.meleeAfter, shotAfter: b.shotAfter };
  assert.equal(sim.setPause(a.id, true), true);
  assert.deepEqual(a.input, { forward: 0, strafe: 0, sprint: false, crouch: false });
  assert.equal(a.jumpRequested, false); assert.equal(a.jumpHeld, false); assert.equal(a.minigunSpinning, false);
  assert.equal(b.pendingMelee, null);
  assert.deepEqual({ meleeAfter: b.meleeAfter, shotAfter: b.shotAfter }, recovery);
  assert.equal(sim.setInput(a.id, { forward: 1, strafe: 0, yaw: 0, pitch: 0 }), false);
  assert.equal(sim.cancelMelee(b.id), false); assert.equal(b.pendingMelee, null);
  assert.equal(sim.setPause(a.id, false), true);
  const { x, z } = a; sim.tick(1 / 30);
  assert.equal(a.x, x); assert.equal(a.z, z); assert.equal(a.minigunSpinning, false);
  assert.equal(b.pendingMelee, null, 'no committed attack can land later as a ghost impact');
  assert.equal(sim.shoot(b.id, 0, 'heavy'), false, 'pausing does not refund the cancelled attack recovery');
});

test('gameplay actions cannot spend or grant resources while the authoritative clock is frozen', () => {
  const { sim, a, b } = room({ wave: 16 });
  const crate = sim.supplyCrate;
  Object.assign(a, { x: crate.x, y: crate.y ?? 0, z: crate.z, points: 99999, grenades: 2 });
  a.inventory.pistol.ammo = 1;
  sim.damagePlayer(b, 100);
  assert.equal(sim.setPause(a.id, true), true);
  const before = stableState(sim);
  for (const action of [
    () => sim.shoot(a.id, 99), () => sim.reload(a.id), () => sim.throwGrenade(a.id),
    () => sim.interact(a.id), () => sim.chooseWeapon(a.id, 'pistol'), () => sim.dropWeapon(a.id),
    () => sim.takeGroundWeapon(a.id, 'forged'), () => sim.buyWeapon(a.id, ARMORY[0].id),
    () => sim.setUmbrella(a.id, true), () => sim.setMinigunSpin(a.id, true),
    () => sim.claimSupply(a.id, 'radar', crate.id), () => sim.buySupply(a.id, 'ammo'),
    () => sim.takeBonus(a.id, 'forged'), () => sim.expeditionInteraction(a.id),
  ]) assert.equal(action(), false);
  assert.deepEqual(stableState(sim), before);
  assert.equal(sim.setPause(a.id, false), true);
  assert.equal(sim.claimSupply(a.id, 'radar', crate.id), true, 'a legal crate choice is possible once the host resumes');
});

test('pause retains the radar bonus and the crate; the next wave renews its claim', () => {
  const { sim, a } = room(); Object.assign(a, { x: sim.supplyCrate.x, y: sim.supplyCrate.y ?? 0, z: sim.supplyCrate.z });
  assert.equal(sim.claimSupply(a.id, 'radar', sim.supplyCrate.id), true);
  Object.assign(a, { x: -5, y: 0, z: 1.7 });
  sim.toSpawn = 0; sim.finishWave();
  const crateId = sim.supplyCrate.id;
  assert.equal(sim.setPause(a.id, true), true); advance(sim, 60);
  assert.equal(sim.phase, 'intermission'); assert.equal(sim.timeLeft, 12);
  assert.deepEqual(a.bonus, { radar: 1 }); assert.equal(sim.supplyCrate.id, crateId);
  assert.equal(sim.setPause(a.id, false), true); advance(sim, 11.9);
  assert.deepEqual(a.bonus, { radar: 1 }); assert.equal(sim.phase, 'intermission');
  advance(sim, .2); assert.equal(sim.wave, 9); assert.ok(sim.supplyCrate);
  assert.notEqual(sim.supplyCrate.id, crateId); assert.equal(sim.supplyCrate.active, true);
  assert.equal(sim.supplyCrate.claimed.size, 0);
  assert.deepEqual(a.bonus, { radar: 1 }, 'the personal radar never runs out of battery');
});

test('stand commands remain unchanged until the host resumes, and the radar bonus rides along', () => {
  const { sim, a } = room({ practice: true });
  assert.equal(sim.practiceAction(a.id, { action: 'radar' }), true);
  assert.deepEqual(a.bonus, { radar: 8 });
  assert.equal(sim.setPause(a.id, true), true);
  const before = stableState(sim);
  for (const command of [{ action: 'targets' }, { action: 'weapon', weapon: 'sniper' }, { action: 'refill' }, { action: 'radar' }]) {
    assert.equal(sim.practiceAction(a.id, command), false);
  }
  advance(sim, 30);
  assert.deepEqual(stableState(sim), before);
  assert.equal(sim.setPause(a.id, false), true); advance(sim, .3);
  assert.equal(sim.practiceAction(a.id, { action: 'targets' }), true);
  assert.deepEqual(a.bonus, { radar: 8 }, 'target reset leaves the personal radar alone');
});

for (const phase of ['countdown', 'wave', 'intermission', 'extraction']) {
  test(`the host can pause ${phase}, with no phase or wave timer progression`, () => {
    const { sim, a } = room(); sim.phase = phase; sim.timeLeft = .5;
    if (phase === 'extraction') sim.wave = MAX_WAVES;
    assert.equal(sim.setPause(a.id, true), true);
    const before = stableState(sim); advance(sim, 60); assert.deepEqual(stableState(sim), before);
    assert.equal(sim.setPause(a.id, false), true); advance(sim, .6);
    if (phase === 'countdown' || phase === 'intermission') assert.equal(sim.wave, before.snapshot.wave + 1);
    else if (phase === 'extraction') assert.equal(sim.phase, 'victory');
    else assert.ok(sim.time > before.snapshot.time + .59);
  });
}

test('lobby and end screens cannot acquire a pause, and a restart starts unpaused', () => {
  const { sim, a } = room();
  for (const phase of ['lobby', 'gameover', 'victory']) {
    sim.phase = phase; assert.equal(sim.setPause(a.id, true), false); assert.equal(sim.paused, false);
  }
  sim.phase = 'wave'; assert.equal(sim.setPause(a.id, true), true);
  sim.endGame(); assert.equal(sim.paused, false); assert.equal(sim.pauseById, null);
  assert.equal(sim.start(a.id), true); assert.equal(sim.phase, 'countdown'); assert.equal(sim.paused, false);
  advance(sim, .2); assert.ok(sim.timeLeft < 5);
});

test('joining and host transfer work while paused, without orphaning control or losing a dropped bonus', () => {
  const { sim, a, b } = room({ practice: true });
  assert.equal(sim.practiceAction(a.id, { action: 'radar' }), true);
  assert.equal(sim.setPause(a.id, true), true);
  const now = sim.time;
  const late = sim.addPlayer('late');
  assert.equal(sim.snapshot().paused, true); assert.equal(sim.players.has(late.id), true);
  sim.removePlayer(a.id);
  assert.equal(sim.paused, true); assert.equal(sim.hostId, b.id); assert.equal(sim.pauseById, b.id);
  const dropped = [...sim.pickups.values()].filter(item => item.kind === 'bonus');
  assert.deepEqual(dropped.map(item => item.bonus), [{ kind: 'radar', level: 8 }], 'the paused departure still deposits the bonus once');
  assert.equal(sim.setPause(a.id, false), false); assert.equal(sim.setPause(late.id, false), false);
  assert.equal(sim.setPause(b.id, false), true); assert.equal(sim.time, now);
  assert.equal(sim.setPause(b.id, true), true); sim.removePlayer(b.id);
  assert.equal(sim.hostId, late.id); assert.equal(sim.paused, true);
  sim.removePlayer(late.id); assert.equal(sim.paused, false); assert.equal(sim.pauseById, null);
});

test('a paused campaign ends cleanly if its last conscious survivor leaves', () => {
  const { sim, a, b } = room(); sim.damagePlayer(b, 100);
  assert.equal(sim.setPause(a.id, true), true); sim.removePlayer(a.id);
  assert.equal(sim.phase, 'gameover'); assert.equal(sim.paused, false); assert.equal(sim.pauseById, null);
  assert.equal(sim.start(b.id), true); assert.equal(b.alive, true); assert.equal(b.downed, false);
});
