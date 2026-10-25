import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { decodeSave } from '../save-game.mjs';
import { CompanionDirector } from '../companions/director.mjs';
import { characterStats } from '../public/character-bonuses.js';
import { claimStep, innateDebt, SHEET_PRESETS } from '../public/character-sheet.js';
import { CODE, HOST_ID, GUEST_ID, THIRD_ID, FOURTH_ID, makeRoom, run, sheetNight, SHEETS, forkableRandom } from './helpers/save-scenario.mjs';

// A saved night carries every survivor's character sheet (public/character-
// sheet.js): a seat keeps its character, its debt and its talents, whatever
// the player taking it back chose on their own computer.
const json = value => JSON.parse(JSON.stringify(value));
const character = player => ({ preset: player.sheet.preset, name: player.sheet.name, stats: { ...player.sheet.stats } });
function lobby({ sheet = null, events = null } = {}) {
  const simulation = new RoomSimulation(CODE, { random: forkableRandom(99), onEvent: events ? event => events.push(event) : () => {} });
  simulation.addPlayer(HOST_ID, 'Jules', undefined, { sheet });
  return simulation;
}
function join(simulation, id, name, sheet = null) {
  simulation.addPlayer(id, name, undefined, { defer: true, sheet });
  simulation.bindJoiningPlayer(id);
  return simulation.players.get(id);
}
const at = (player, target) => Object.assign(player, { x: target.x, y: target.y ?? 0, z: target.z, grounded: true, interactAfter: 0 });

test('a file’s sheet is rebuilt by normalizeSheet and its debt bounded by that sheet; a companion plays the standard sheet', () => {
  const save = json(sheetNight().simulation.exportSave());
  const [jules, lea, ines] = save.players;
  // An invalid stat line (sum +1) is the standard sheet, which owes nothing.
  jules.sheet = { preset: 'lumberjack', name: 'Triche', stats: { strength: 2, tinkering: -1, chemistry: 0 } };
  // More than the sheet owes, a family it does not owe, garbage: bounded or dropped.
  Object.assign(lea, { sheet: { ...lea.sheet, name: `Chi\u0007miste${'x'.repeat(40)}`, extra: 1 }, grenades: 5,
    sheetDebt: { grenadier: 9, frostaura: -3, medic: 'x', stone: 2, sorcery: 1 } });
  // A missing debt is the innate one, never a free repayment.
  delete ines.sheetDebt;
  save.players.push({ ...json(lea), id: 'ia-SAVE01-1', name: 'Max', companion: true, companionSlot: 0, sheet: { preset: 'pyro' }, sheetDebt: { stone: 1 },
    companionProfile: { selection: 'random', archetype: 'veteran', variation: { accuracy: 1, reaction: 1, pause: 1 } } });
  const records = decodeSave(json(save)).players.map(entry => entry.record);
  assert.deepEqual(records.map(record => record.name), ['Jules', 'Léa', 'Inès', 'Max']);
  const [first, second, third, bot] = records;
  assert.deepEqual(character(first), { preset: 'standard', name: '', stats: { ...SHEET_PRESETS.standard } });
  assert.deepEqual(first.sheetDebt, {}, 'the standard sheet owes nothing, whatever the file says');
  assert.equal(second.sheet.name, `Chimiste${'x'.repeat(16)}`, 'control characters stripped, 24 characters at most');
  assert.equal(Object.hasOwn(second.sheet, 'extra'), false);
  assert.deepEqual(second.sheet.stats, { strength: 0, agility: 0, ballistics: 2, tinkering: 0, chemistry: -2 });
  assert.deepEqual(second.sheetDebt, { grenadier: 2 }, 'clamped to the innate 2; the rest dropped');
  assert.equal(second.grenades, 1, 'a Chemistry debt carries one grenade');
  assert.deepEqual(third.sheetDebt, innateDebt({ stats: SHEET_PRESETS.scout }));
  assert.deepEqual(character(bot), { preset: 'standard', name: '', stats: { ...SHEET_PRESETS.standard } });
  assert.deepEqual(bot.sheetDebt, {});
  // A sheet that is no object is the standard one; prototype keys refuse the file.
  const shapeless = json(save); shapeless.players[1].sheet = 'pyro';
  assert.deepEqual(decodeSave(shapeless).players[1].record.sheetDebt, {});
  const polluted = JSON.parse(JSON.stringify(save).replace('"sheet":{', '"sheet":{"__proto__":{"stats":{"strength":2}},'));
  assert.deepEqual(lobby().importSave(polluted, HOST_ID), { ok: false, reason: 'invalid' });
});

test('a seat keeps its saved character whatever its player chose here; the free seats say whose character they are', () => {
  const { simulation: original } = sheetNight();
  const saved = id => original.players.get(id);
  const room = lobby({ sheet: SHEETS.scout });
  assert.equal(room.importSave(json(original.exportSave()), HOST_ID).ok, true);
  const jules = room.players.get(HOST_ID);
  assert.deepEqual(character(jules), character(saved(HOST_ID)), 'the loader plays the seat’s Lumberjack, not the Scout picked here');
  assert.deepEqual(jules.sheetDebt, saved(HOST_ID).sheetDebt);
  assert.deepEqual(room.snapshot().freeSeats.map(seat => [seat.name, seat.character.preset, seat.character.name, seat.character.stats.chemistry]),
    [['Léa', null, 'Chimiste', -2], ['Inès', 'scout', '', 0]]);
  const lea = join(room, GUEST_ID, 'LÉA', SHEETS.lumberjack);
  assert.equal(lea.waiting, false, 'paused: back in place at once');
  assert.deepEqual(character(lea), character(saved(GUEST_ID))); assert.deepEqual(lea.sheetDebt, saved(GUEST_ID).sheetDebt);
  // Re-saving keeps the free seat's character for whoever comes later.
  const again = decodeSave(json(room.exportSave())).players.map(entry => entry.record).find(record => record.name === 'Inès');
  assert.deepEqual(character(again), character(saved(THIRD_ID))); assert.deepEqual(again.sheetDebt, saved(THIRD_ID).sheetDebt);
  // A stranger with their own Lumberjack takes Inès's place: the Scout plays.
  const tom = join(room, FOURTH_ID, 'Tom', SHEETS.lumberjack);
  assert.equal(tom.waiting, true); assert.equal(tom.sheet.preset, 'lumberjack');
  assert.equal(room.claimSeat(FOURTH_ID, room.freeSeatList()[0].seat), true);
  const claimed = room.players.get(FOURTH_ID);
  assert.equal(claimed.name, 'Tom'); assert.deepEqual(character(claimed), character(saved(THIRD_ID)));
  assert.deepEqual(claimed.sheetDebt, saved(THIRD_ID).sheetDebt);
  assert.equal(characterStats(claimed).maxHp, 90, 'the Scout’s strength debt');
  const state = room.snapshot();
  assert.deepEqual(state.seatHolders, [HOST_ID, GUEST_ID, FOURTH_ID]);
  assert.deepEqual(state.players.map(player => [player.name, player.character, player.sheetDebt]),
    original.snapshot().players.map(player => [player.name === 'Inès' ? 'Tom' : player.name, player.character, player.sheetDebt]));
});

test('a seat taken back plays its character until the night ends, even while it waits; a fresh joiner can still change', () => {
  const { simulation: original } = sheetNight();
  const room = lobby();
  room.importSave(json(original.exportSave()), HOST_ID);
  assert.equal(room.setPause(HOST_ID, false), true);
  run(room, 20);
  assert.equal(room.setSheet(HOST_ID, SHEETS.scout), false, 'the loader is in the night');
  // Bound after the loaded night ran on: waiting for its admission, still locked.
  const lea = join(room, GUEST_ID, 'Léa', SHEETS.scout);
  assert.equal(lea.waiting, true);
  assert.equal(room.setSheet(GUEST_ID, SHEETS.scout), false);
  assert.equal(lea.sheet.name, 'Chimiste'); assert.deepEqual(lea.sheetDebt, original.players.get(GUEST_ID).sheetDebt);
  // A newcomer waiting for the admission is not a seat: they pick freely.
  const tom = join(room, FOURTH_ID, 'Tom');
  assert.equal(tom.waiting, true);
  assert.equal(room.setSheet(FOURTH_ID, SHEETS.lumberjack), true);
  assert.deepEqual(tom.sheetDebt, innateDebt({ stats: SHEET_PRESETS.lumberjack }));
  assert.deepEqual(room.snapshot().seatHolders, [HOST_ID, GUEST_ID]);
  // A seat claimed afterwards replaces the newcomer's pick with the seat's.
  assert.equal(room.claimSeat(FOURTH_ID, room.freeSeatList()[0].seat), true);
  const claimed = room.players.get(FOURTH_ID);
  assert.equal(claimed.sheet.preset, 'scout');
  assert.equal(room.setSheet(FOURTH_ID, SHEETS.lumberjack), false);
  // Admitted later, the seat's body gets the seat's own maximum health.
  assert.equal(room.admitPlayer(claimed), true); assert.equal(claimed.hp, 90, 'the Scout’s strength debt');
  // The night ends: the seats are free and so are the characters.
  room.endGame();
  assert.equal(room.snapshot().seatHolders, undefined);
  assert.equal(room.setSheet(GUEST_ID, SHEETS.scout), true);
  assert.equal(room.players.get(GUEST_ID).sheet.preset, 'scout');
});

test('after a load the crate repays debts and talents climb two levels; an elimination and a new night bring the innate debt back', () => {
  const { simulation: original } = sheetNight();
  const room = lobby();
  room.importSave(json(original.exportSave()), HOST_ID);
  join(room, GUEST_ID, 'Léa'); join(room, THIRD_ID, 'Inès');
  const crate = room.supplyCrate;
  assert.equal(crate.active, true); assert.equal(room.wave, 5);
  const claims = [[HOST_ID, 'radar'], [GUEST_ID, 'perforating'], [THIRD_ID, 'vitality']];
  const expected = claims.map(([id, kind]) => claimStep(original.players.get(id), kind));
  for (const [id] of claims) at(room.players.get(id), crate);
  assert.equal(room.setPause(HOST_ID, false), true);
  claims.forEach(([id, kind], index) => {
    const player = room.players.get(id);
    assert.deepEqual(claimStep(player, kind), expected[index], `${kind}: the same step as in the saved night`);
    assert.equal(room.supplyAction(player), 'crate');
    assert.equal(room.claimSupply(id, kind, crate.id), true, kind);
  });
  const [jules, lea, ines] = claims.map(([id]) => room.players.get(id));
  assert.equal(expected[0].repay, true); assert.equal(Object.hasOwn(jules.sheetDebt, 'radar'), false, 'repaid');
  assert.equal(jules.bonus.radar, undefined, 'a repayment gives no level');
  assert.equal(expected[1].talent, true); assert.equal(lea.bonus.perforating, 2, 'Ballistics +2: two levels a claim');
  assert.equal(Object.hasOwn(ines.sheetDebt, 'vitality'), false); assert.equal(characterStats(ines).maxHp, 100);
  // Eliminated: what was repaid goes with the bonuses.
  room.dropBonus(ines);
  assert.deepEqual(ines.sheetDebt, innateDebt(ines.sheet));
  // A new night after the loaded one: every seat's own sheet, from its innate debt.
  room.endGame();
  assert.equal(room.start(HOST_ID), true);
  for (const player of room.players.values()) {
    assert.deepEqual(player.sheetDebt, innateDebt(player.sheet), player.name);
    assert.equal(player.hp, characterStats(player).maxHp, player.name);
  }
  assert.deepEqual([...room.players.values()].map(player => player.sheet.preset), ['lumberjack', null, 'scout']);
  assert.equal(characterStats(room.players.get(THIRD_ID)).maxHp, 90);
  assert.equal(room.reservedSeats.size, 0); assert.equal(room.snapshot().seatHolders, undefined);
});

test('companions brought back by the director play the standard sheet', () => {
  const hub = { connected: true, request: () => new Promise(() => {}) };
  const create = simulation => {
    let director = null;
    simulation.onEvent = message => director?.onEvent(message);
    director = new CompanionDirector(simulation, hub, { createBody: (sim, id, { profile }) => ({ id, profile, setOrder() {}, tick: () => 'idle', setProfile() {} }), describe: () => null });
    return director;
  };
  const { simulation: original } = makeRoom({ seed: 5, players: [[HOST_ID, 'Jules', SHEETS.lumberjack]] });
  create(original).setCount(1, HOST_ID);
  original.start(HOST_ID); run(original, 10); original.setPause(HOST_ID, true);
  const save = json(original.exportSave());
  const bot = save.players.find(player => player.companion);
  Object.assign(bot, { sheet: { preset: 'pyro' }, sheetDebt: { stone: 1, perforating: 1 } });
  const room = lobby(), director = create(room);
  const result = room.importSave(save, HOST_ID, { beforeApply: () => director.dropAll(), adopt: companions => director.restore(companions) });
  assert.equal(result.adopted, 'restored');
  const back = [...room.players.values()].find(player => player.companion);
  assert.equal(back.sheet.preset, 'standard'); assert.deepEqual(back.sheetDebt, {});
  assert.equal(characterStats(back).maxHp, 100);
  assert.equal(room.players.get(HOST_ID).sheet.preset, 'lumberjack');
});
