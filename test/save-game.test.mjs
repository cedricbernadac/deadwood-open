import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, TICK_RATE, WEAPONS } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { decodeSave, SAVE_FORMAT, SAVE_LIMITS, bodyLimit, unrangedSaveNumbers } from '../save-game.mjs';
import { sharedReferences, encodeValue } from '../save-codec.mjs';
import { CompanionDirector } from '../companions/director.mjs';
import { rollCompanionProfile, restoreCompanionProfile } from '../companions/profiles.mjs';
import { MAX_BONUS_LEVEL } from '../public/weapon-upgrades.js';
import { BALLISTICS } from '../public/ballistics.js';
import { FUEL_CACHES } from '../public/expedition.js';
import { characterStats } from '../public/character-bonuses.js';
import { CODE, HOST_ID, GUEST_ID, THIRD_ID, FOURTH_ID, makeRoom, run, autopilot, startAtWave, arm, busyNight, sheetNight, creditNight, SHEETS, forkableRandom } from './helpers/save-scenario.mjs';

const json = value => JSON.parse(JSON.stringify(value));
const withoutMeta = ({ savedAt, ...save }) => save;
// The room code and who took a restored seat back are the restored room's own.
const view = ({ room, seatHolders, ...state }) => state;
// The sheet night's survivors come back with another character chosen on
// their own computer: the seat's saved character plays.
const SHEET_JOINERS = [[GUEST_ID, 'Léa', SHEETS.scout], [THIRD_ID, 'Inès', SHEETS.lumberjack]];

// A fresh lobby: the loader alone, as a new room created to load a file.
function lobby({ random = forkableRandom(99), id = HOST_ID, name = 'Jules', Simulation = RoomSimulation, events = null, others = [] } = {}) {
  const simulation = new Simulation(CODE, { random, onEvent: events ? event => events.push(event) : () => {} });
  simulation.addPlayer(id, name);
  for (const [otherId, otherName] of others) simulation.addPlayer(otherId, otherName);
  return simulation;
}
function join(simulation, id, name, sheet = null) {
  simulation.addPlayer(id, name, undefined, { defer: true, sheet });
  simulation.bindJoiningPlayer(id);
  return simulation.players.get(id);
}
function restored(save, { random, others = [], ...options } = {}) {
  const simulation = lobby({ random, ...options });
  const result = simulation.importSave(json(save), options.id ?? HOST_ID);
  assert.equal(result.ok, true, `import refused: ${result.reason}`);
  for (const [id, name, sheet] of others) join(simulation, id, name, sheet);
  return { simulation, result };
}

function countdownNight() {
  const { simulation, random } = makeRoom({ seed: 3 });
  simulation.start(HOST_ID);
  run(simulation, 20);
  simulation.setPause(HOST_ID, true);
  return { simulation, random };
}
function intermissionNight() {
  const { simulation, random } = makeRoom({ seed: 4 });
  startAtWave(simulation, 1);
  arm(simulation);
  for (let tick = 0; tick < 30 * 120 && simulation.phase === 'wave'; tick++) run(simulation, 1);
  assert.equal(simulation.phase, 'intermission');
  run(simulation, 10);
  simulation.voteNextWave(GUEST_ID, true);
  simulation.setPause(HOST_ID, true);
  return { simulation, random };
}

test('countdown, a busy raid wave and an intermission come back with every persistent field', () => {
  const lea = [[GUEST_ID, 'Léa']];
  for (const [label, build, others] of [['countdown', countdownNight, lea], ['wave', busyNight, lea], ['intermission', intermissionNight, lea], ['wave', sheetNight, SHEET_JOINERS]]) {
    const { simulation: original } = build();
    assert.equal(original.phase, label);
    const save = original.exportSave({ build: 'abc123', requesterId: GUEST_ID });
    assert.equal(save.format, SAVE_FORMAT); assert.equal(save.version, 1); assert.equal(save.build, 'abc123');
    assert.ok(Number.isFinite(Date.parse(save.savedAt)));
    const { simulation: copy } = restored(save, { others });
    assert.equal(copy.phase, label); assert.equal(copy.paused, true); assert.equal(copy.pauseById, HOST_ID);
    assert.deepStrictEqual(view(copy.snapshot()), view(original.snapshot()), `${label}: same snapshot`);
    assert.deepStrictEqual(withoutMeta(json(copy.exportSave())), withoutMeta(json(original.exportSave())), `${label}: same persistent state`);
  }
  // The busy night really carried the hard cases.
  const { simulation } = busyNight(), kinds = new Set([...simulation.pickups.values()].map(pickup => pickup.kind));
  for (const kind of ['points', 'weapon', 'bonus']) assert.ok(kinds.has(kind), kind);
  assert.ok([...simulation.zombies.values()].some(zombie => zombie.kind === 'raider') && simulation.raid.triggered);
  assert.ok(simulation.players.get(GUEST_ID).downed);
  assert.ok(simulation.bullets.size > 0 && simulation.grenades.size > 0);
  assert.ok([...simulation.pickups.values()].some(pickup => pickup.droppedBy === HOST_ID));
});

test('with the same random sequence and inputs, the restored night plays exactly like the original', () => {
  // Two busy nights of standard survivors, then one with character sheets:
  // a Lumberjack with debts (one repaid, one offset by a picked-up level), a
  // Chemistry −2 survivor whose smell hastens a walker and whose medkit heals
  // half, a Scout whose pellets in flight hit weaker. Maluses and talents
  // must survive the file.
  // The fourth night carries an open revive credit (owner, 18 October): the
  // restored night must pay the same bonus as the original.
  for (const [seed, build, others] of [[11, busyNight, [[GUEST_ID, 'Léa']]], [23, busyNight, [[GUEST_ID, 'Léa']]], [31, sheetNight, SHEET_JOINERS], [17, creditNight, [[GUEST_ID, 'Léa']]]]) {
    const events = [], originalEvents = [];
    const { simulation: original, random } = build({ seed, events: originalEvents });
    const save = json(original.exportSave());
    const { simulation: copy } = restored(save, { random: random.clone(), others, events });
    original.setPause(HOST_ID, false); copy.setPause(HOST_ID, false);
    let smelled = 0;
    for (let tick = 0; tick < 300; tick++) {
      autopilot(original); autopilot(copy);
      if (tick === 40) { original.throwGrenade(HOST_ID); copy.throwGrenade(HOST_ID); }
      original.tick(1 / TICK_RATE); copy.tick(1 / TICK_RATE);
      assert.deepStrictEqual(view(copy.snapshot()), view(original.snapshot()), `seed ${seed}, tick ${tick}`);
      if ([...copy.zombies.values()].some(zombie => zombie.scentHaste > 0)) smelled++;
    }
    if (build === sheetNight) {
      assert.equal(copy.players.get(GUEST_ID).sheet.name, 'Chimiste', 'the seat’s character, not the joiner’s');
      assert.equal(copy.players.get(THIRD_ID).sheet.preset, 'scout');
      assert.deepEqual(copy.players.get(HOST_ID).sheetDebt, { radar: 1, grenadier: 1, frostaura: 1, medic: 1 }, 'the debt still owed, the repaid one gone');
      assert.ok(smelled > 200, `the Chemistry smell hastened a walker (${smelled} ticks)`);
      assert.ok(events.some(event => event.event === 'pickup' && event.id === GUEST_ID && event.partial === true && event.healed === 35), 'half a medkit');
      assert.ok([...save.bullets.$map].some(([, bullet]) => bullet.ownerId === THIRD_ID), 'the Scout’s pellets were in flight');
    }
    original.setPause(HOST_ID, true); copy.setPause(HOST_ID, true);
    assert.deepStrictEqual(withoutMeta(json(copy.exportSave())), withoutMeta(json(original.exportSave())));
    if (build === creditNight) {
      assert.deepEqual(save.reviveCredits.map(({ reviverId, revivedId, open }) => [reviverId, revivedId, open]), [[HOST_ID, GUEST_ID, true]], 'the file carries the open credit');
      const credit = copy.openReviveCredit(GUEST_ID);
      assert.ok(credit && credit.copied > 0, 'Léa’s damage after the load fills Jules’s credit');
      original.endGame(); copy.endGame();
      const payouts = list => list.filter(event => event.event === 'revive-bonus').map(event => event.payouts);
      assert.deepEqual(payouts(events), payouts(originalEvents), 'the same bonus is paid');
      assert.equal(payouts(events).length, 1);
      assert.equal(copy.players.get(HOST_ID).score, original.players.get(HOST_ID).score);
    }
  }
});

test('an older save without revive credits or score carries loads with no credit', () => {
  const { simulation: original } = creditNight();
  const save = json(original.exportSave());
  delete save.reviveCredits;
  for (const player of save.players) delete player.scoreCarry;
  const { simulation: copy } = restored(save, { others: [[GUEST_ID, 'Léa']] });
  assert.deepEqual(copy.reviveCredits, []);
  assert.ok([...copy.players.values()].every(player => player.scoreCarry === 0));
  const broken = json(original.exportSave());
  broken.reviveCredits = [{ reviverId: 'x', copied: 'lots' }, { reviverId: HOST_ID, revivedId: GUEST_ID, copied: -5, open: true, revivedName: 1 }];
  broken.players[0].scoreCarry = 7;
  const { simulation: clamped } = restored(broken, { others: [[GUEST_ID, 'Léa']] });
  assert.deepEqual(clamped.reviveCredits.map(({ copied }) => copied), [0], 'a malformed credit is dropped, a bad number clamped');
  assert.ok([...clamped.players.values()].every(player => player.scoreCarry >= 0 && player.scoreCarry <= 1));
});

// A burn scores for the shooter whose flame drives it (review, 18 October):
// each exposure's shooter is part of the night and must come back.
test('a burn driven by two flamethrowers keeps each exposure’s shooter through a save', () => {
  const { simulation: original } = busyNight();
  const [zombie] = [...original.zombies.values()], now = original.time;
  Object.assign(zombie, { hp: 5000, maxHp: 5000, burnOwnerId: HOST_ID, burnStartedAt: now, burnDamageAt: now, burnUntil: now + 4,
    burnExposures: [{ strength: 1, until: now + 2, ownerId: HOST_ID }, { strength: .5, until: now + 4, ownerId: GUEST_ID }] });
  const save = json(original.exportSave());
  assert.deepEqual(save.zombies.$map.find(([id]) => id === zombie.id)[1].burnExposures.map(exposure => exposure.ownerId), [HOST_ID, GUEST_ID]);
  const { simulation: copy } = restored(save, { others: [[GUEST_ID, 'Léa']] });
  const back = copy.zombies.get(zombie.id);
  assert.deepEqual(back.burnExposures, zombie.burnExposures);
  const gains = simulation => {
    const before = [HOST_ID, GUEST_ID].map(id => simulation.players.get(id).score + simulation.players.get(id).scoreCarry);
    simulation.applyZombieBurn(simulation.zombies.get(zombie.id), now + 4);
    return [HOST_ID, GUEST_ID].map((id, index) => simulation.players.get(id).score + simulation.players.get(id).scoreCarry - before[index]);
  };
  const [host, guest] = gains(copy);
  assert.ok(guest > 0 && Math.abs(host - 2 * guest) < 1e-6, `two seconds at full strength for Jules, two at half for Léa: ${host} / ${guest}`);
  assert.deepEqual([host, guest], gains(original), 'the same split as the original night');
});

test('every saved field is read back: a field added to the game must be given a schema or marked transient', () => {
  for (const build of [busyNight, sheetNight]) everyFieldReadBack(build);
});
function everyFieldReadBack(build) {
  const { simulation } = build();
  const save = json(simulation.exportSave());
  const decoded = decodeSave(json(save));
  const missing = [];
  const compare = (label, raw, read, ignore = []) => {
    for (const key of Object.keys(raw)) if (!ignore.includes(key) && !Object.hasOwn(read, key)) missing.push(`${label}.${key}`);
  };
  compare('simulation', save, decoded.fields, ['format', 'version', 'mapId', 'build', 'savedAt', 'players', 'doors', 'bullets', 'shotGroups', 'companionSelections', 'hostId']);
  const records = new Map(decoded.players.map(({ record }, index) => [index, record]));
  save.players.forEach((raw, index) => compare('player', raw, records.get(index)));
  for (const [id, raw] of save.zombies.$map) {
    const read = decoded.fields.zombies.get(id);
    compare(raw.kind === 'raider' ? 'raider' : 'zombie', raw, read);
    if (raw.ai) compare('raider.ai', raw.ai, read.ai);
  }
  for (const [id, raw] of save.pickups.$map) compare(`pickup:${raw.kind}`, raw, decoded.fields.pickups.get(id));
  for (const [id, raw] of save.bullets.$map) compare('bullet', raw, decoded.bullets.get(id));
  for (const [id, raw] of save.grenades.$map) compare('grenade', raw, decoded.fields.grenades.get(id));
  compare('raid', save.raid, decoded.fields.raid);
  compare('generator', save.generator, decoded.fields.generator);
  assert.deepEqual(missing, [], 'add these fields to save-game.mjs schemas or its transient lists');
}

test('only the relinked bullet references are shared, before and after a restore', () => {
  const { simulation } = busyNight();
  const allowed = path => /\.bullets<b\d+>\.(owner|shotGroup|profile)$/.test(path) || /\.navigation\.path\.\d+$/.test(path);
  const check = sim => {
    const shared = sharedReferences({ zombies: sim.zombies, pickups: sim.pickups, bullets: sim.bullets, grenades: sim.grenades, players: sim.players,
      spawnWarnings: sim.spawnWarnings, raidWarnings: sim.raidWarnings, raid: sim.raid, doors: sim.doors, supplyCrate: sim.supplyCrate, fuel: sim.fuel });
    assert.deepEqual(shared.filter(paths => !paths.some(allowed)), []);
  };
  check(simulation);
  const { simulation: copy } = restored(simulation.exportSave(), { others: [[GUEST_ID, 'Léa']] });
  check(copy);
  const bullets = [...copy.bullets.values()];
  assert.ok(bullets.length > 1);
  assert.ok(bullets.every(bullet => bullet.owner === copy.players.get(bullet.ownerId)), 'owner relinked to the restored record');
  const group = bullets.filter(bullet => bullet.shotGroup.id === bullets[0].shotGroup.id);
  assert.ok(group.length > 1 && group.every(bullet => bullet.shotGroup === group[0].shotGroup && bullet.profile === group[0].profile));
});

test('wrong format, wrong version, oversize, prototype keys and too many bodies are refused; the lobby stays a lobby', () => {
  const { simulation } = busyNight(), save = json(simulation.exportSave());
  const refuse = (value, reason) => {
    const room = lobby({ others: [] });
    const before = view(room.snapshot());
    assert.deepEqual(room.importSave(value, HOST_ID), { ok: false, reason });
    assert.deepStrictEqual(view(room.snapshot()), before, `${reason}: lobby untouched`);
  };
  refuse({ ...save, format: 'other-game' }, 'format');
  refuse(null, 'format');
  refuse({ ...save, version: 2 }, 'version');
  refuse({ ...save, padding: 'x'.repeat(SAVE_LIMITS.bytes) }, 'too-large');
  refuse(JSON.parse(JSON.stringify(save).replace('"generator":{', '"generator":{"__proto__":{"polluted":true},')), 'invalid');
  assert.equal(({}).polluted, undefined);
  refuse(JSON.parse(JSON.stringify(save).replace('"wave":5,', '"constructor":{"prototype":{"bad":1}},"wave":5,')), 'invalid');
  const horde = json(save);
  horde.zombies.$map = Array.from({ length: SAVE_LIMITS.zombies + 1 }, (_, index) => [`z${index + 1}`, { ...save.zombies.$map[0][1], id: `z${index + 1}` }]);
  refuse(horde, 'too-large');
  // Under the file's cap, still more bodies than this wave ever lets live at once.
  const crowd = json(save), [, body] = save.zombies.$map[0], prefix = body.kind === 'raider' ? 'r' : 'z';
  crowd.zombies.$map = Array.from({ length: bodyLimit(save.wave) + 1 }, (_, index) => [`${prefix}${index + 900}`, { ...body, id: `${prefix}${index + 900}` }]);
  assert.ok(crowd.zombies.$map.length < SAVE_LIMITS.zombies);
  refuse(crowd, 'too-large');
  refuse({ ...save, phase: 'lobby' }, 'phase');
  refuse({ ...save, phase: 'victory' }, 'phase');
  refuse({ ...save, time: { $num: 'Infinity' } }, 'invalid');
  refuse({ ...save, time: { $num: 'NaN' } }, 'invalid');
  // Only the host of a lobby loads; never a practice range or a running night.
  const guestLobby = lobby({ others: [[GUEST_ID, 'Léa']] });
  assert.deepEqual(guestLobby.importSave(json(save), GUEST_ID), { ok: false, reason: 'host' });
  const running = lobby(); running.start(HOST_ID);
  assert.deepEqual(running.importSave(json(save), HOST_ID), { ok: false, reason: 'phase' });
  const practice = new RoomSimulation(CODE, { practice: true }); practice.addPlayer(HOST_ID, 'Jules');
  assert.deepEqual(practice.importSave(json(save), HOST_ID), { ok: false, reason: 'practice' });
});

test('malformed seats are refused; NaN, infinities, unknown weapons and bonuses fall back, clamp or drop', () => {
  const { simulation } = busyNight(), save = json(simulation.exportSave());
  const refuse = (value, reason = 'seats') => assert.deepEqual(lobby().importSave(value, HOST_ID), { ok: false, reason });
  refuse({ ...save, players: 'nobody' });
  refuse({ ...save, players: [] });
  refuse({ ...save, players: Array.from({ length: 5 }, (_, index) => ({ ...save.players[0], id: `000000000000000${index}` })) });
  refuse({ ...save, players: save.players.map(player => ({ ...player, id: 'not an id' })) });
  refuse({ ...save, players: save.players.map(player => ({ ...player, name: 7 })) });
  // Ids are peer-like only: a crafted id (here a body's) drops its record.
  const clash = json(save); clash.players[0].id = clash.zombies.$map[0][0];
  const clashed = lobby(); assert.equal(clashed.importSave(clash, HOST_ID).ok, true);
  assert.equal(clashed.players.get(HOST_ID).downed, true, 'only the guest record was left');
  assert.equal(clashed.zombies.has(clash.zombies.$map[0][0]), true);
  const odd = json(save), host = odd.players[0], guest = odd.players[1];
  Object.assign(host, { x: { $num: 'NaN' }, y: 999, hp: -40, armor: { $num: 'Infinity' }, name: 'Char\u0007les  ', pendingMelee: 5,
    inventory: { shotgun: { ammo: 8, reserve: 50 }, laser: { ammo: 9, reserve: 9 }, 'pistol#2': { ammo: 3, reserve: 1 } },
    weaponId: 'laser', bonus: { stone: 99, sorcery: 3, vitality: 0 }, issuedWeapons: { $set: ['pistol', 'laser'] } });
  guest.lastKillAt = { $num: '-Infinity' };
  odd.zombies.$map[0][1].x = { $num: 'NaN' };
  odd.pickups.$map[0][1].x = 1e9;
  odd.time = 1234.5;
  const room = lobby(), result = room.importSave(odd, HOST_ID);
  assert.equal(result.ok, true, result.reason);
  const loaded = room.players.get(HOST_ID);
  assert.equal(loaded.x, -2.8, 'NaN falls back to the fresh default');
  assert.equal(loaded.y, 40, 'clamped height'); assert.equal(loaded.hp, 0, 'HP never below 0');
  assert.equal(loaded.armor, 0, 'an infinite armor is no armor');
  assert.equal(loaded.name, 'Jules', 'control characters and spaces removed');
  assert.equal(loaded.pendingMelee, null, 'a shapeless wind-up is ignored');
  assert.deepEqual(Object.keys(loaded.inventory), ['shotgun', 'pistol#2'], 'unknown weapons dropped, instance ids kept');
  assert.equal(loaded.weaponId, 'shotgun'); assert.equal(loaded.weapon, 'shotgun');
  assert.deepEqual(loaded.bonus, { stone: MAX_BONUS_LEVEL, vitality: 1 }, 'levels clamped to 1..8, unknown kinds dropped');
  assert.deepEqual([...loaded.issuedWeapons], ['pistol']);
  assert.equal(room.time, 1234.5);
  assert.equal(room.zombies.has(save.zombies.$map[0][0]), false, 'a body without a position is dropped');
  assert.equal(room.pickups.get(save.pickups.$map[0][0]).x, 160, 'a far pickup is brought to the edge of the world');
  assert.equal(room.reservedSeats.size, 1);
  assert.doesNotThrow(() => { room.setPause(HOST_ID, false); run(room, 30); room.snapshot(); });
});

test('seats: names match without case, the host seat is the fallback, a claim takes a free seat, four at most', () => {
  const { simulation } = busyNight(), save = json(simulation.exportSave());
  // The loader with a different name takes the saved host's seat and keeps their own name.
  const renamed = lobby({ name: 'Papa' });
  assert.equal(renamed.importSave(json(save), HOST_ID).ok, true);
  assert.equal(renamed.players.get(HOST_ID).name, 'Papa');
  assert.equal(renamed.players.get(HOST_ID).kills, simulation.players.get(HOST_ID).kills);
  assert.deepEqual(renamed.freeSeatList().map(seat => seat.name), ['Léa']);
  assert.deepEqual(renamed.snapshot().freeSeats.map(seat => seat.name), ['Léa']);
  // A loader named like the guest takes the guest's seat instead.
  const asGuest = lobby({ name: ' léa ' });
  asGuest.importSave(json(save), HOST_ID);
  assert.equal(asGuest.players.get(HOST_ID).downed, true, 'the downed guest record');
  assert.equal(asGuest.players.get(HOST_ID).name, 'Léa', 'a matched seat keeps its saved name');
  // Joiners: an exact name (any case) binds at once; another joins as a newcomer.
  const room = lobby();
  room.importSave(json(save), HOST_ID);
  const stranger = join(room, THIRD_ID, 'Inconnu');
  assert.equal(stranger.waiting, true); assert.equal(room.freeSeatList().length, 1);
  assert.equal(room.claimSeat(HOST_ID, room.freeSeatList()[0].seat), false, 'an admitted survivor cannot take a seat');
  assert.equal(room.claimSeat(THIRD_ID, 'seat-000000000000'), false, 'no such seat');
  const seat = room.freeSeatList()[0].seat;
  assert.equal(room.claimSeat(THIRD_ID, seat), true);
  const claimed = room.players.get(THIRD_ID);
  assert.equal(claimed.waiting, false, 'paused: the seat comes back as saved, not as a spectator');
  assert.equal(claimed.downed, true); assert.equal(claimed.name, 'Inconnu', 'a claim keeps the claimer’s name');
  assert.equal(claimed.points, simulation.players.get(GUEST_ID).points);
  assert.equal(room.claimSeat(THIRD_ID, seat), false, 'one seat per survivor');
  assert.deepEqual(room.freeSeatList(), []);
  assert.equal(room.snapshot().freeSeats, undefined);
  const late = join(room, GUEST_ID, 'LÉA');
  assert.equal(late.waiting, true, 'a taken seat is not offered again');
  // Free seats do not fill the cabin: three newcomers next to one restored survivor.
  const crowd = lobby();
  const four = json(save);
  four.players = [save.players[0], { ...save.players[1], id: '00000000000000e5', name: 'Sam' }, { ...save.players[1], id: '00000000000000e6', name: 'Max' }, save.players[1]];
  assert.equal(crowd.importSave(four, HOST_ID).ok, true);
  assert.equal(crowd.freeSeatList().length, 3); assert.equal(crowd.players.size, 1);
  assert.equal(crowd.participantCount(), 1, 'free seats never size a wave');
  for (const [id, name] of [[GUEST_ID, 'A'], [THIRD_ID, 'B'], [FOURTH_ID, 'C']]) join(crowd, id, name);
  assert.equal(crowd.players.size, 4);
  assert.throws(() => crowd.addPlayer('00000000000000f7', 'Sam', undefined, { defer: true }), /4 joueurs/);
  assert.equal(crowd.claimSeat(GUEST_ID, crowd.freeSeatList()[0].seat), true, 'a claim replaces the joiner, never adds a fifth');
  assert.equal(crowd.players.size, 4);
});

test('a seat bound while the night runs keeps its belongings and enters through the admission queue', () => {
  const { simulation } = intermissionNight();
  simulation.setPause(HOST_ID, false);
  const guestBefore = simulation.players.get(GUEST_ID);
  guestBefore.bonus = { toughskin: 4 }; guestBefore.points = 777; guestBefore.inventory = { assault: { ammo: 5, reserve: 40 } };
  guestBefore.weapon = guestBefore.weaponId = 'assault';
  // Back to the previous wave's fight for this test: save mid-wave instead.
  simulation.phase = 'wave'; simulation.toSpawn = 3;
  simulation.setPause(HOST_ID, true);
  const save = json(simulation.exportSave());
  const room = lobby();
  room.importSave(save, HOST_ID);
  room.setPause(HOST_ID, false);
  run(room, 3);
  const guest = join(room, GUEST_ID, 'Léa');
  assert.equal(guest.waiting, true); assert.equal(guest.alive, false);
  assert.equal(guest.points, 777); assert.deepEqual(guest.bonus, { toughskin: 4 });
  assert.deepEqual(Object.keys(guest.inventory), ['assault']);
  assert.equal(room.participantCount(), 1, 'a waiting seat does not fight yet');
  room.readyPlayer(GUEST_ID);
  room.zombies.clear(); room.spawnWarnings.clear(); room.toSpawn = 0; room.raid = null;
  run(room, 3, { pilot: false });
  assert.equal(room.phase, 'intermission');
  assert.equal(room.players.get(GUEST_ID).waiting, false, 'admitted at the break');
  assert.equal(room.players.get(GUEST_ID).points, 777); assert.deepEqual(Object.keys(room.players.get(GUEST_ID).inventory), ['assault']);
});

test('free seats last until the end of the night; a reserved Magnum stays unique; fuel is set down', () => {
  const { simulation } = busyNight(), save = json(simulation.exportSave());
  const magnum = json(save);
  magnum.players[1].inventory = { magnum: { ammo: 6, reserve: 0 } }; magnum.players[1].weapon = magnum.players[1].weaponId = 'magnum';
  magnum.fuel = { x: 3, y: 0, z: 2, carrierId: magnum.players[1].id, cacheIndex: 0 };
  magnum.players[1].downed = false; magnum.players[1].alive = true; magnum.players[1].x = 0; magnum.players[1].z = 1;
  const room = lobby();
  assert.equal(room.importSave(magnum, HOST_ID).ok, true);
  assert.equal(room.magnumAvailable(), false, 'a seat nobody took yet still holds the Magnum');
  assert.equal(room.fuel.carrierId, null, 'an absent carrier sets the team’s fuel down');
  assert.equal(room.freeSeatList().length, 1);
  room.setPause(HOST_ID, false);
  room.endGame();
  assert.equal(room.phase, 'gameover');
  assert.deepEqual(room.freeSeatList(), []); assert.equal(room.snapshot().freeSeats, undefined);
  join(room, GUEST_ID, 'Léa');
  assert.equal(room.players.get(GUEST_ID).weapon, 'pistol', 'after the night, a namesake is a newcomer');
  // Victory and a new night free them too.
  const won = lobby(); won.importSave(json(save), HOST_ID); won.setPause(HOST_ID, false);
  won.phase = 'extraction'; won.timeLeft = .01; won.tick(1 / TICK_RATE);
  assert.equal(won.phase, 'victory'); assert.deepEqual(won.freeSeatList(), []);
  const again = lobby(); again.importSave(json(save), HOST_ID); again.setPause(HOST_ID, false); again.endGame();
  again.start(HOST_ID); assert.deepEqual(again.freeSeatList(), []);
});

test('the lobby’s other survivors are bound by name or wait for the admission; host and pause go to the loader', () => {
  const { simulation } = busyNight(), save = json(simulation.exportSave());
  const events = [];
  const room = lobby({ events, others: [[GUEST_ID, 'LÉA'], [THIRD_ID, 'Nouveau']] });
  assert.equal(room.importSave(save, HOST_ID).ok, true);
  assert.equal(room.hostId, HOST_ID); assert.equal(room.pauseById, HOST_ID); assert.equal(room.paused, true);
  assert.equal(room.players.get(GUEST_ID).downed, true, 'Léa found her seat');
  assert.equal(room.players.get(THIRD_ID).waiting, true, 'the newcomer waits for the admission');
  assert.deepEqual([...room.players.keys()], [HOST_ID, GUEST_ID, THIRD_ID], 'saved order first');
  assert.ok(events.some(event => event.event === 'seat-bound' && event.id === GUEST_ID));
  room.announceRestore({ companions: 'offline' });
  assert.deepEqual(events.filter(event => event.event === 'game-restored').map(({ wave, phase, companions }) => ({ wave, phase, companions })),
    [{ wave: 5, phase: 'wave', companions: 'offline' }]);
});

test('saving: any admitted human while paused, never in practice, never outside a night', () => {
  const { simulation } = countdownNight();
  assert.ok(simulation.exportSave({ requesterId: GUEST_ID }));
  simulation.setPause(HOST_ID, false);
  assert.throws(() => simulation.exportSave({ requesterId: HOST_ID }), error => error.code === 'not-paused');
  simulation.setPause(HOST_ID, true);
  simulation.addPlayer(THIRD_ID, 'Tard', undefined, { defer: true });
  assert.throws(() => simulation.exportSave({ requesterId: THIRD_ID }), error => error.code === 'not-admitted');
  assert.throws(() => lobby().exportSave({ requesterId: HOST_ID }), error => error.code === 'phase');
  const practice = new RoomSimulation(CODE, { practice: true }); practice.addPlayer(HOST_ID, 'Jules'); practice.setPause(HOST_ID, true);
  assert.throws(() => practice.exportSave({ requesterId: HOST_ID }), error => error.code === 'practice');
  // A Frisson save loaded on a Famille room stays Famille (the room's choice).
  const { simulation: frisson } = makeRoom({ seed: 2, ambiance: 'frisson' });
  frisson.start(HOST_ID); frisson.setPause(HOST_ID, true);
  const copy = lobby(); copy.importSave(json(frisson.exportSave()), HOST_ID);
  assert.equal(frisson.exportSave().ambiance, 'frisson'); assert.equal(copy.ambiance, 'family');
  // Sizes stay far below the limit.
  assert.ok(JSON.stringify(busyNight().simulation.exportSave()).length < 64 * 1024);
});

test('the online wrapper saves no epoch or rewind history and starts a new epoch on import', () => {
  const { simulation: original } = makeRoom({ seed: 8, Simulation: OnlineRoomSimulation });
  startAtWave(original, 3);
  original.spawnZombie(); original.tick(1 / TICK_RATE);
  original.setPause(HOST_ID, true);
  const save = json(original.exportSave());
  assert.equal(save.zombies.$map.length, 1);
  for (const key of ['inputs', 'history', 'epoch', 'clock', 'activeShot']) assert.equal(Object.hasOwn(save, key), false, key);
  const room = lobby({ Simulation: OnlineRoomSimulation });
  const epoch = room.epoch;
  room.inputs.get(HOST_ID).received = 40; room.inputs.get(HOST_ID).ack = 38;
  assert.equal(room.importSave(save, HOST_ID).ok, true);
  assert.notEqual(room.epoch, epoch);
  assert.equal(room.history.length, 1);
  assert.deepEqual({ received: room.inputs.get(HOST_ID).received, ack: room.inputs.get(HOST_ID).ack }, { received: 0, ack: 0 });
  join(room, GUEST_ID, 'Léa');
  assert.equal(room.inputs.get(GUEST_ID).connected, true);
  const snapshot = room.snapshot();
  assert.equal(snapshot.net.epoch, room.epoch);
  assert.ok(snapshot.players.every(player => player.input && typeof player.connected === 'boolean'));
});

test('physical bullets are the room’s own: a save never carries them, and a file saying false never turns them off', () => {
  for (const Simulation of [RoomSimulation, OnlineRoomSimulation]) {
    const { simulation: original } = makeRoom({ seed: 8, Simulation });
    startAtWave(original, 3);
    original.setPause(HOST_ID, true);
    const save = json(original.exportSave());
    assert.equal(Object.hasOwn(save, 'ballisticsEnabled'), false, `${Simulation.name}: not written`);
    // A hand-edited file (saves are plain JSON) and an older one that still carries it.
    for (const value of [false, true]) {
      const room = lobby({ Simulation });
      assert.equal(room.importSave({ ...save, ballisticsEnabled: value }, HOST_ID).ok, true, `${Simulation.name}: ${value} still loads`);
      assert.equal(room.ballisticsEnabled, true, `${Simulation.name}: ${value} in the file, physical bullets on`);
    }
  }
});

test('companions come back with their slot, selection, frozen profile and belongings when the brain is here', () => {
  const hub = { connected: true, request: () => new Promise(() => {}) };
  const bodies = [];
  const create = simulation => {
    let director = null;
    simulation.onEvent = message => director?.onEvent(message);
    director = new CompanionDirector(simulation, hub, { createBody: (sim, id, { profile }) => { const body = { id, profile, setOrder() {}, tick: () => 'idle', setProfile() {} }; bodies.push(body); return body; }, describe: () => null });
    return director;
  };
  const { simulation: original } = makeRoom({ seed: 5, players: [[HOST_ID, 'Jules']] });
  const director = create(original);
  director.setCount(2, HOST_ID, ['veteran', 'timid', 'random']);
  original.start(HOST_ID); run(original, 20); original.setPause(HOST_ID, true);
  const bots = [...original.players.values()].filter(player => player.companion);
  bots[1].points = 345; bots[1].bonus = { grenadier: 2 }; bots[1].inventory = { smg: { ammo: 11, reserve: 30 } }; bots[1].weapon = bots[1].weaponId = 'smg';
  const save = json(original.exportSave());
  assert.deepEqual(save.companionSelections, ['veteran', 'timid', 'random']);
  // A lobby with its own companion: the load replaces it.
  const room = lobby();
  const restoredDirector = create(room);
  restoredDirector.setCount(1, HOST_ID);
  const result = room.importSave(save, HOST_ID, { beforeApply: () => restoredDirector.dropAll(), adopt: companions => restoredDirector.restore(companions) });
  assert.equal(result.ok, true);
  assert.equal(result.companions.length, 2);
  assert.equal(result.adopted, 'restored');
  const back = [...room.players.values()].filter(player => player.companion);
  assert.deepEqual(back.map(player => [player.name, player.companionSlot]), bots.map(player => [player.name, player.companionSlot]));
  assert.deepEqual(back.map(player => player.companionProfile), bots.map(player => player.companionProfile), 'frozen profiles identical');
  assert.ok(back.every(player => Object.isFrozen(player.companionProfile)));
  assert.equal(back[1].points, 345); assert.deepEqual(back[1].bonus, { grenadier: 2 }); assert.equal(back[1].weapon, 'smg');
  assert.deepEqual(back.map(player => [player.x, player.z, player.hp]), bots.map(player => [player.x, player.z, player.hp]));
  assert.deepEqual(room.companionSelections, ['veteran', 'timid', 'random']);
  assert.equal(restoredDirector.count, 2);
  assert.ok(back.every(player => /^ia-SAVE01-\d+$/.test(player.id)));
  // No brain: they stay behind and the room says so.
  hub.connected = false;
  const alone = lobby(), lonely = create(alone);
  const refused = alone.importSave(json(save), HOST_ID, { beforeApply: () => lonely.dropAll(), adopt: companions => lonely.restore(companions) });
  assert.equal(refused.adopted, 'offline');
  assert.equal(lobby().importSave(json(save), HOST_ID).adopted, 'unsupported', 'online: no director at all');
  assert.equal([...alone.players.values()].filter(player => player.companion).length, 0);
  // The frozen profile is rebuilt from its archetype and variation only.
  const profile = rollCompanionProfile('random', () => .3);
  assert.deepStrictEqual(restoreCompanionProfile(json(profile)), profile);
  assert.equal(restoreCompanionProfile({ ...json(profile), archetype: 'wizard' }), null);
  assert.equal(restoreCompanionProfile({ ...json(profile), variation: { accuracy: 50, reaction: 1, pause: 1 } }).variation.accuracy, 1.08);
});

test('the encoding keeps Maps, Sets, infinities and negative zero', () => {
  const value = { map: new Map([['a', 1]]), set: new Set(['x']), up: Infinity, down: -Infinity, zero: -0, nan: NaN, skip: () => 1 };
  assert.deepEqual(encodeValue(value), { map: { $map: [['a', 1]] }, set: { $set: ['x'] }, up: { $num: 'Infinity' }, down: { $num: '-Infinity' }, zero: { $num: '-0' }, nan: { $num: 'NaN' } });
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => encodeValue(cycle), /Cyclic/);
});

test('a loaded night whose only fighters are free seats waits for them instead of ending at once', () => {
  const { simulation } = busyNight(), save = json(simulation.exportSave());
  // Léa, downed, loads it; Jules, still standing, is not back yet.
  const events = [];
  const room = lobby({ id: GUEST_ID, name: 'Léa', events, others: [[THIRD_ID, 'Nouveau']] });
  assert.equal(room.importSave(json(save), GUEST_ID).ok, true);
  assert.equal(room.players.get(GUEST_ID).downed, true);
  assert.deepEqual(room.freeSeatList().map(seat => seat.name), ['Jules']);
  assert.equal(room.setPause(GUEST_ID, false), false, 'resuming now would end the night');
  assert.deepEqual(events.filter(event => event.event === 'pause-denied').map(event => event.reason), ['seats']);
  room.tick(1 / TICK_RATE);
  // A waiting newcomer who leaves does not end it either.
  room.removePlayer(THIRD_ID);
  assert.equal(room.phase, 'wave'); assert.equal(room.paused, true); assert.equal(room.freeSeatList().length, 1);
  // Jules comes back exactly as saved: the night goes on.
  const jules = join(room, HOST_ID, 'Jules');
  assert.equal(jules.waiting, false); assert.equal(jules.downed, false);
  assert.equal(room.setPause(GUEST_ID, false), true);
  run(room, 3);
  assert.equal(room.phase, 'wave');
  // A night nobody can still fight is not held hostage: it ends as it would have.
  const lost = json(save);
  Object.assign(lost.players[0], { downed: true, reviveKit: false, bleedOutAt: lost.time + 5 });
  const alone = lobby({ id: GUEST_ID, name: 'Léa' });
  assert.equal(alone.importSave(lost, GUEST_ID).ok, true);
  assert.equal(alone.setPause(GUEST_ID, false), true);
  alone.tick(1 / TICK_RATE);
  assert.equal(alone.phase, 'gameover');
});

test('a seat taken back after the loaded night ran on enters through the admission, never with stale timers', () => {
  const { simulation } = busyNight(), save = json(simulation.exportSave());
  const saved = simulation.players.get(GUEST_ID);
  assert.equal(saved.downed, true);
  const events = [];
  const room = lobby({ events });
  assert.equal(room.importSave(json(save), HOST_ID).ok, true);
  assert.equal(room.setPause(HOST_ID, false), true);
  room.players.get(HOST_ID).hp = 1e6;
  // Jules plays on alone past Léa's bleed-out, then the wave is cleared.
  run(room, Math.ceil((saved.bleedOutAt - room.time + 1) * TICK_RATE));
  assert.ok(room.time > saved.bleedOutAt);
  room.zombies.clear(); room.spawnWarnings.clear(); room.raidWarnings.clear(); room.toSpawn = 0; room.raid = null;
  run(room, 3, { pilot: false });
  assert.equal(room.phase, 'intermission');
  // He pauses so that she can come in.
  room.setPause(HOST_ID, true);
  const lea = join(room, GUEST_ID, 'Léa');
  assert.equal(lea.waiting, true, 'stale timers: through the admission queue');
  assert.equal(lea.downed, false); assert.equal(lea.points, saved.points);
  room.setPause(HOST_ID, false); run(room, 2, { pilot: false });
  assert.ok(!events.some(event => event.event === 'eliminated' && event.id === GUEST_ID));
  room.readyPlayer(GUEST_ID);
  assert.equal(lea.waiting, false); assert.equal(lea.alive, true); assert.equal(lea.downed, false);
  assert.equal(lea.hp, characterStats(lea).maxHp);
  assert.equal(lea.points, saved.points);
});

test('fuel carried by a companion stays with it when the brain brings it back, else is set down where it stood', () => {
  const COMPANION = 'ia-SAVE01-1';
  const { simulation } = makeRoom({ seed: 4 });
  simulation.addPlayer(COMPANION, 'Max', undefined, { companion: true });
  Object.assign(simulation.players.get(COMPANION), { companionSlot: 0, companionProfile: rollCompanionProfile('random', forkableRandom(2)) });
  startAtWave(simulation, 5); arm(simulation); run(simulation, 30);
  assert.ok(simulation.fuel, 'a fuel mission');
  // The companion walked out and picked the fuel up, far from its cache.
  Object.assign(simulation.players.get(COMPANION), { x: 60, z: 10 });
  simulation.fuel.carrierId = COMPANION;
  simulation.setPause(HOST_ID, true);
  const save = json(simulation.exportSave());
  const hub = { connected: true, request: () => new Promise(() => {}) };
  const load = () => {
    const room = lobby();
    const director = new CompanionDirector(room, hub, { createBody: () => ({ tick: () => 'idle', setOrder() {}, setProfile() {} }), describe: () => null });
    const result = room.importSave(json(save), HOST_ID, { beforeApply: () => director.dropAll(), adopt: companions => director.restore(companions) });
    assert.equal(result.ok, true, result.reason);
    return { room, result };
  };
  const { room, result } = load();
  assert.equal(result.adopted, 'restored');
  const max = [...room.players.values()].find(player => player.companion);
  assert.deepEqual([max.x, max.z], [60, 10]);
  assert.equal(room.fuel.carrierId, max.id, 'the companion still carries it');
  // Without the brain (or online), the fuel is set down where Max stood.
  hub.connected = false;
  const { room: alone, result: offline } = load();
  assert.equal(offline.adopted, 'offline');
  assert.equal(alone.fuel.carrierId, null);
  assert.ok(Math.hypot(alone.fuel.x - 60, alone.fuel.z - 10) < 3, 'next to Max, not back at the far cache');
  const cache = FUEL_CACHES[alone.fuel.cacheIndex];
  assert.ok(Math.hypot(alone.fuel.x - cache.x, alone.fuel.z - cache.z) > 100);
});

test('saving a loaded night again keeps every survivor’s record; more than four is refused, never cut', () => {
  const { simulation } = makeRoom({ players: [[HOST_ID, 'Papa'], [GUEST_ID, 'Jules'], [THIRD_ID, 'Léa']] });
  startAtWave(simulation, 3); arm(simulation); run(simulation, 60);
  simulation.players.get(THIRD_ID).points = 4321;
  simulation.setPause(HOST_ID, true);
  const save = json(simulation.exportSave());
  const room = lobby({ name: 'Papa' });
  assert.equal(room.importSave(json(save), HOST_ID).ok, true);
  // Two friends join while Jules and Léa are still asleep.
  const tom = join(room, FOURTH_ID, 'Tom'), zoe = join(room, '00000000000000e5', 'Zoé');
  assert.equal(tom.waiting, true); assert.equal(zoe.waiting, true);
  const again = json(room.exportSave());
  assert.deepEqual(again.players.map(player => player.name), ['Papa', 'Jules', 'Léa', 'Tom'], 'free seats before newcomers who carry nothing');
  assert.equal(again.players[2].points, 4321);
  const reloaded = lobby({ name: 'Papa' });
  assert.equal(reloaded.importSave(again, HOST_ID).ok, true);
  assert.equal(join(reloaded, THIRD_ID, 'Léa').points, 4321);
  // Once Tom and Zoé fight, five records carry something.
  assert.equal(room.admitPlayer(tom), true); assert.equal(room.admitPlayer(zoe), true);
  assert.throws(() => room.exportSave(), error => error.code === 'crowded');
});

test('a loader whose own record still waited takes it back and is admitted at once, never the host’s record', () => {
  const { simulation } = makeRoom({ players: [[HOST_ID, 'Papa']] });
  startAtWave(simulation, 3); arm(simulation); run(simulation, 30);
  simulation.players.get(HOST_ID).points = 7777;
  simulation.addPlayer(GUEST_ID, 'Jules', undefined, { defer: true });
  simulation.setPause(HOST_ID, true);
  const save = json(simulation.exportSave());
  // Next day Jules's PC opens the room and loads the file.
  const room = lobby({ id: THIRD_ID, name: 'Jules' });
  assert.equal(room.importSave(json(save), THIRD_ID).ok, true);
  const jules = room.players.get(THIRD_ID);
  assert.equal(jules.name, 'Jules'); assert.equal(jules.points, 0);
  assert.equal(jules.waiting, false); assert.equal(jules.alive, true);
  assert.deepEqual(room.freeSeatList().map(seat => seat.name), ['Papa']);
  const papa = join(room, HOST_ID, 'Papa');
  assert.equal(papa.points, 7777); assert.equal(papa.waiting, false);
  assert.equal(room.setPause(THIRD_ID, false), true, 'the loader resumes');
});

test('every number a template carries has a range; crafted pushes, timers and bullets cannot buy a long tick', () => {
  assert.deepEqual(unrangedSaveNumbers(), [], 'give these fields a range in save-game.mjs');
  const { simulation } = busyNight(), save = json(simulation.exportSave());
  const [id, body] = save.zombies.$map[0];
  Object.assign(body, { pushX: 1e12, pushZ: -1e12, pushLeft: 1e12, burnUntil: 1e12, attackInterval: 0, damage: 1e12, barricadeDamage: -5 });
  const sample = save.bullets.$map[0][1];
  save.bullets.$map = Array.from({ length: 40 }, (_, index) => [`b${9000 + index}`, { ...sample, id: `b${9000 + index}`, shotGroupId: null,
    vx: 0, vy: 5000, vz: 1, gravity: 0, drag: 0, maxAge: 60, age: 0, startAt: save.time - 60, segmentStartAge: 30, distanceOffset: 1e5 }]);
  const room = lobby();
  assert.equal(room.importSave(save, HOST_ID).ok, true);
  const zombie = room.zombies.get(id);
  // A hammer (×2) is the strongest push: 0.35 m over a 0.04 s decay; 0.26 s long.
  assert.ok(Math.abs(zombie.pushX) <= 17.5 + 1e-9 && Math.abs(zombie.pushZ) <= 17.5 + 1e-9 && zombie.pushLeft <= .26);
  assert.deepEqual([zombie.burnUntil, zombie.attackInterval, zombie.damage, zombie.barricadeDamage], [1e9, .05, 1000, 0]);
  const profile = WEAPONS[sample.weapon].bulletPhysics;
  for (const bullet of room.bullets.values()) {
    assert.equal(bullet.maxAge, BALLISTICS.maxLife);
    assert.ok(bullet.startAt >= room.time - bullet.age - 1 / TICK_RATE - 1e-9, 'only what was pending at the pause');
    assert.equal(bullet.drag, profile.drag); assert.equal(bullet.gravity, BALLISTICS.gravity);
    assert.ok(Math.hypot(bullet.vx, bullet.vy, bullet.vz) <= profile.muzzleSpeed * (1 + 1e-9));
    assert.ok(bullet.segmentStartAge <= bullet.age && bullet.distanceOffset <= BALLISTICS.ranges[sample.weapon]);
  }
  room.setPause(HOST_ID, false); room.tick(1 / TICK_RATE);
  for (const bullet of room.bullets.values()) assert.ok(bullet.age <= 2 / TICK_RATE + 1e-9, 'one tick flies one tick (and what was pending)');
  // The game never has more bullets in flight than its own cap.
  const many = json(simulation.exportSave());
  many.bullets.$map = Array.from({ length: BALLISTICS.maxActive + 1 }, (_, index) => [`b${9000 + index}`, { ...sample, id: `b${9000 + index}` }]);
  assert.deepEqual(lobby().importSave(many, HOST_ID), { ok: false, reason: 'too-large' });
});
