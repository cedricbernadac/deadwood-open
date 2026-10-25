import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomSimulation } from '../simulation.mjs';
import { ARMORY, REVIVE } from '../public/rules.js';
import { SUPPLY_BONUSES, LATE_SUPPLIES } from '../public/weapon-upgrades.js';
import { seededRandom } from '../validation/balance-report.mjs';
import { describeSituation, doorstepSpot, orderValue, orderFromValue, ORDER_KINDS, TEXT_LIMIT, MAX_ACTIONS } from '../companions/situation.mjs';
import { wayOut, rainCost } from '../companions/outdoors.mjs';
import { weaponWorth, spareWeapon, replaced, worthBuying, fightsBetter } from '../companions/arsenal.mjs';

// The companion's "eyes" (companions/DESIGN.md): text ≤ ~2,800 characters,
// ≤ 24 legal actions, and the body order of each one, from real rooms.
const PARAMS = { shoot: 'zombieId', defend: 'doorId', repair: 'doorId', revive: 'playerId', kit: 'playerId', follow: 'playerId', collect: 'pickupId', buy: 'rackId', weapon: 'weapon', claim: 'bonus', supply: 'service' };
const GRAMMAR = /^(keep|hold|self-kit|wait|reload|loft|coins|umbrella|(shoot|defend|repair|revive|kit|follow|collect|buy|weapon|claim|supply):[^\s:]+)$/;
const NAMES = { papa: 'Papa', jules: 'Jules', max: 'Max', lea: 'Léa' };

function room({ humans = ['papa', 'jules'], companions = ['max'], seed = 3 } = {}) {
  const events = [];
  const sim = new RoomSimulation('SITUAT', { random: seededRandom(seed), onEvent: event => events.push(event) });
  for (const id of humans) sim.addPlayer(id, NAMES[id] ?? id);
  for (const id of companions) sim.addPlayer(id, NAMES[id] ?? id, undefined, { companion: true });
  sim.start(humans[0]);
  return { sim, events, get: id => sim.players.get(id) };
}
const tick = (sim, seconds) => { for (let step = 0; step < Math.round(seconds * 30); step++) sim.tick(1 / 30); };
function intoWave(sim) {
  for (let step = 0; step < 8 * 30 && sim.phase !== 'wave'; step++) sim.tick(1 / 30);
  assert.equal(sim.phase, 'wave');
}
// A wave with nothing on the field and nothing about to come: arranged by hand.
function quiet(sim) { sim.zombies.clear(); sim.spawnWarnings.clear(); sim.spawnTimer = 999; }
function zombieAt(sim, id, x, z, options = {}) {
  const zombie = { id, x, y: 0, z, yaw: 0, hp: 80, maxHp: 80, kind: 'walker', scale: 1, boss: false, speed: 0, attackAfter: Infinity,
    entered: false, doorId: 'west', stairState: null, pushX: 0, pushZ: 0, pushLeft: 0, ...options };
  sim.zombies.set(id, zombie);
  return zombie;
}
function pickupAt(sim, id, kind, x, z, options = {}) {
  const pickup = { id, kind, x, y: 0, z, amount: kind === 'points' ? 50 : 1, special: false, expiresAt: sim.time + 90, ...options };
  sim.pickups.set(id, pickup);
  return pickup;
}
const values = result => result.actions.map(action => action.value);
const kinds = (result, kind) => values(result).filter(value => value.startsWith(`${kind}:`));
const down = (sim, player) => sim.damagePlayer(player, 1000, { id: 'test' });

// Budgets, grammar, and an order of a valid kind for every value.
function wellFormed(sim, companionId, result) {
  const { text, actions, orders } = result;
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0 && text.length <= TEXT_LIMIT, `text is ${text.length} characters`);
  assert.equal(TEXT_LIMIT, 2800); assert.equal(MAX_ACTIONS, 24);
  assert.ok(actions.length >= 1 && actions.length <= MAX_ACTIONS, `${actions.length} actions`);
  const list = values(result);
  assert.equal(new Set(list).size, list.length, 'unique values');
  assert.deepEqual(Object.keys(orders).sort(), [...list].sort());
  assert.ok(kinds(result, 'shoot').length <= 6);
  const self = sim.players.get(companionId);
  for (const { value, description } of actions) {
    assert.match(value, GRAMMAR);
    assert.equal(typeof description, 'string');
    assert.ok(description.length > 0 && description.length <= 170 && !/[\u0000-\u001f]/.test(description), value);
    if (value === 'keep') { assert.equal(orders.keep, null); continue; }
    const order = orders[value];
    assert.ok(ORDER_KINDS.includes(order.kind), value);
    const param = PARAMS[order.kind];
    assert.deepEqual(Object.keys(order).sort(), param ? ['kind', param].sort() : ['kind'], value);
    assert.equal(orderValue(order), value);
    assert.deepEqual(orderFromValue(value), order);
    if (order.kind === 'shoot') assert.ok(sim.zombies.get(order.zombieId)?.hp > 0, value);
    if (order.kind === 'defend' || order.kind === 'repair') assert.equal(sim.doors.find(door => door.id === order.doorId)?.sealed, false, value);
    if (['revive', 'kit', 'follow'].includes(order.kind)) assert.ok(sim.players.has(order.playerId) && order.playerId !== companionId, value);
    if (order.kind === 'collect') assert.ok(sim.pickups.has(order.pickupId), value);
    if (order.kind === 'buy') assert.ok(ARMORY.some(rack => rack.id === order.rackId && rack.weapon !== 'magnum'), value);
    if (order.kind === 'weapon') assert.ok(Object.hasOwn(self.inventory, order.weapon), value);
    if (order.kind === 'claim') assert.ok(Object.hasOwn(SUPPLY_BONUSES, order.bonus) && sim.bonusEligible(self, order.bonus), value);
    if (order.kind === 'supply') assert.ok(Object.hasOwn(LATE_SUPPLIES.items, order.service) && sim.wave >= (LATE_SUPPLIES.items[order.service].unlockWave ?? LATE_SUPPLIES.unlockWave), value);
  }
  assert.equal(list.includes('keep'), list[0] === 'keep', 'keep comes first when present');
  return result;
}

// Wave 15 (the third raid) with four survivors: a full field, a raid under
// way, broken doors, a downed boy and a heap of loot.
function crowded({ seed = 7, names = NAMES } = {}) {
  const events = [];
  const sim = new RoomSimulation('CROWD1', { random: seededRandom(seed), onEvent: event => events.push(event) });
  sim.addPlayer('papa', names.papa); sim.addPlayer('jules', names.jules);
  sim.addPlayer('max', names.max, undefined, { companion: true }); sim.addPlayer('lea', names.lea, undefined, { companion: true });
  sim.start('papa');
  sim.wave = 14; sim.beginWave();
  for (const player of sim.players.values()) player.hp = 1e6;
  for (let step = 0; step < 40 * 30 && sim.zombies.size < 28; step++) sim.tick(1 / 30);
  const get = id => sim.players.get(id);
  Object.assign(get('papa'), { x: 5, y: 0, z: 3, hp: 35, weapon: 'rifle', inventory: { rifle: { ammo: 4, reserve: 0 }, shotgun: { ammo: 8, reserve: 24 } } });
  Object.assign(get('jules'), { x: 5.4, y: 3.4, z: -3.4, hp: 100 });
  Object.assign(get('max'), { x: 2, y: 0, z: 1, hp: 64, armor: 20, points: 1240, reviveKit: true, weapon: 'smg', inventory: { smg: { ammo: 12, reserve: 80 }, shotgun: { ammo: 8, reserve: 24 } } });
  Object.assign(get('lea'), { x: 4.6, y: 3.4, z: -3, hp: 80 });
  down(sim, get('jules'));
  const walkers = [...sim.zombies.values()].filter(zombie => zombie.kind !== 'raider');
  Object.assign(walkers[0], { x: 5.6, z: 3.5 }); Object.assign(walkers[1], { x: -1, z: 1 }); Object.assign(walkers[2], { x: 2, z: -4 });
  for (const [x, z] of [[12, 5], [-14, 3], [3, -14]]) {
    const raider = sim.createRaider(1, { id: null, doorId: 'east', x, z }, { index: 3, damageScale: 1 }, { point: { x, z } });
    sim.zombies.set(raider.id, raider);
  }
  Object.assign(sim.raid, { triggered: true, triggeredAt: sim.time, spawned: 3 });
  for (const door of sim.doors) door.boards = door.boards.map((hp, index) => index < 2 ? hp : 0);
  for (let index = 0; index < 12; index++) pickupAt(sim, `k${index}`, ['ammo', 'health', 'revive', 'points', 'armor', 'grenade'][index % 6], -6 + index, -4);
  return { sim, events, get, inside: walkers[0] };
}

test('a crowded late wave with a raid stays within the text and action budgets and says what matters', () => {
  const { sim, inside } = crowded();
  assert.ok(sim.wave >= 15 && sim.raid?.triggered, 'a raid wave');
  assert.ok(sim.zombies.size >= 25, `${sim.zombies.size} enemies on the field`);
  const recent = Array.from({ length: 30 }, (_, index) => `something loud happened number ${index} somewhere around the cabin`);
  const result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'defend', doorId: 'west' }, orderSince: sim.time - 14, recent }));
  const { text } = result;
  assert.match(text, /^Wave 15\/20/);
  assert.match(text, /RAID: \d+ raiders left/);
  assert.match(text, /YOU: Max \(AI teammate\)/);
  assert.match(text, /ORDER: defend the west door, for 14 s\./);
  assert.match(text, /Jules \(human\): DOWN, loft/);
  assert.match(text, new RegExp(`- ${inside.id} [\\w ]+, [\\d.]+ m SE, INSIDE \\(ground\\), next to Papa`), 'meaning, not coordinates');
  assert.match(text, /machine gun 4\/30 \+0 spare LOW AMMO/);
  assert.match(text, /no boards left|zombies can walk through|2\/5 boards/);
  assert.doesNotMatch(text, /x[:=] ?-?\d|z[:=] ?-?\d/, 'no raw coordinates');
  // The zombie inside next to a human is the first target; then the rest.
  assert.equal(kinds(result, 'shoot')[0], `shoot:${inside.id}`);
  assert.equal(kinds(result, 'shoot').length, 6);
  assert.ok(values(result).includes('revive:jules') && values(result).includes('kit:jules'));
  assert.deepEqual(kinds(result, 'follow'), ['follow:papa']);
  assert.equal(kinds(result, 'buy').length, 0, 'no shopping during a wave');
  // Twenty-four-character names and a flood of news never break the budget.
  const long = crowded({ seed: 11, names: { papa: 'P'.repeat(24), jules: 'C'.repeat(24), max: 'M'.repeat(24), lea: 'L'.repeat(24) } });
  const flood = Array.from({ length: 200 }, (_, index) => `${'x'.repeat(150)} ${index}`);
  wellFormed(long.sim, 'max', describeSituation(long.sim, 'max', { order: { kind: 'hold' }, orderSince: 0, recent: flood }));
  wellFormed(long.sim, 'lea', describeSituation(long.sim, 'lea', { recent: flood }));
});

test('a downed teammate: revive by hand or with the kit, who is on it, never one outside or eliminated', () => {
  const { sim, get } = room({ companions: ['max', 'lea'] });
  intoWave(sim); quiet(sim);
  Object.assign(get('papa'), { x: -4.5, z: .6 }); Object.assign(get('jules'), { x: -4.5, z: 1.5 });
  Object.assign(get('max'), { x: 0, z: 3 }); Object.assign(get('lea'), { x: 2, z: 3 });
  down(sim, get('jules'));
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.ok(values(result).includes('revive:jules'));
  assert.equal(values(result).includes('kit:jules'), false, 'no kit, no kit action');
  assert.deepEqual(result.orders['revive:jules'], { kind: 'revive', playerId: 'jules' });
  assert.match(result.text, /Jules \(human\): DOWN, ground, west, [\d.]+ m W; 25 s before elimination; nobody is reviving them\./);
  assert.deepEqual(kinds(result, 'follow'), ['follow:papa'], 'only standing humans are followed');
  get('max').reviveKit = true;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(result.orders['kit:jules'], { kind: 'kit', playerId: 'jules' });
  assert.match(result.actions.find(action => action.value === 'kit:jules').description, /1200/);
  // Papa starts the five-second revive: the text says who and how long.
  assert.equal(sim.interact('papa'), true);
  tick(sim, 1);
  sim.interact('papa');
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /Papa is reviving them \(4 s left\)/);
  assert.match(result.text, /Papa \(human\): .*reviving Jules/);
  assert.match(result.actions.find(action => action.value === 'revive:jules').description, /Papa is already on it/);
  // Another AI teammate down is a teammate too; it is revived, never followed.
  down(sim, get('lea'));
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.ok(values(result).includes('revive:lea') && values(result).includes('kit:lea'));
  assert.equal(values(result).some(value => value === 'follow:lea' || value === 'follow:jules'), false);
  // Outside the cabin (orders never leave it) or eliminated: nothing to do.
  Object.assign(get('lea'), { x: 11, z: 0 });
  get('jules').alive = false;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.equal(values(result).some(value => /^(revive|kit):/.test(value)), false);
  assert.match(result.text, /Jules \(human\): eliminated, back next wave/);
  assert.match(result.text, /Léa \(AI\): DOWN, outside.*you cannot go there/);
});

test('a downed companion may only use its own kit or wait', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max');
  down(sim, max);
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'defend', doorId: 'west' }, orderSince: sim.time - 2 }));
  assert.deepEqual(values(result), ['wait'], 'no kit: wait only, and the old order is no longer kept');
  assert.match(result.text, /YOU ARE DOWN: Max \(AI teammate\), .*25 s before elimination; zombies ignore you\. Nobody is reviving you yet\. Revive kit: no\./);
  max.reviveKit = true;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(values(result), ['self-kit', 'wait']);
  assert.deepEqual(result.orders, { 'self-kit': { kind: 'self-kit' }, wait: { kind: 'wait' } });
  result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'wait' }, orderSince: sim.time - 3 }));
  assert.deepEqual(values(result), ['self-kit', 'wait'], 'exactly the two values of the contract, even with a current order');
  // A teammate reviving the companion is reported.
  Object.assign(get('papa'), { x: max.x + .8, y: max.y, z: max.z });
  assert.equal(sim.interact('papa'), true);
  assert.match(describeSituation(sim, 'max').text, /Papa is reviving you \(5 s left\)/);
  // Eliminated: out until the next wave.
  max.alive = false;
  assert.deepEqual(values(wellFormed(sim, 'max', describeSituation(sim, 'max'))), ['wait']);
  assert.deepEqual(values(wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'wait' } }))), ['wait']);
});

test('the break: buy only what is unlocked, affordable and not owned, never the golden Magnum, and only between waves', () => {
  const { sim, get } = room({ humans: ['papa'] });
  const max = get('max');
  assert.equal(sim.phase, 'countdown');
  max.points = 99999;
  assert.equal(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'buy').length, 0, 'nothing is unlocked before wave 1');
  intoWave(sim);
  quiet(sim); zombieAt(sim, 'zc', max.x + 3, max.z, { entered: true });
  assert.equal(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'buy').length, 0, 'no shopping with a zombie close');
  sim.zombies.clear(); sim.wave = 2; // the shotgun unlocks at the start of wave 2
  const calm = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.ok(kinds(calm, 'buy').includes('buy:shotgun'));
  assert.ok(kinds(calm, 'buy').length > 0, 'a calm moment of a wave: the newly unlocked racks');
  assert.match(calm.text, /SHOP \(calm moment, nothing within 8 m\)/);
  // A real break after wave 15: everything but the rocket launcher is unlocked.
  quiet(sim); sim.toSpawn = 0; sim.wave = 15; sim.raid = null;
  sim.tick(1 / 30);
  assert.equal(sim.phase, 'intermission');
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'buy'), ['buy:sniper', 'buy:minigun', 'buy:flamethrower', 'buy:rifle'], 'the four best, by price');
  assert.deepEqual(result.orders['buy:sniper'], { kind: 'buy', rackId: 'sniper' });
  assert.equal(values(result).includes('buy:magnum'), false);
  assert.match(result.text, /^Break after wave 15\/20 \(normal\): wave 16 starts in 12 s; 0\/1 humans ready\./);
  assert.match(result.text, /SHOP \(between waves\): with 99999 coins you can buy bolt-action rifle 3200, gatling 2800/);
  assert.doesNotMatch(result.text, /golden magnum \d/);
  // After wave 8 with 1000 coins: unlocked and affordable, the pistol already
  // owned, and no blade while its pistol has ammo.
  sim.wave = 8; max.points = 1000;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'buy'), ['buy:smg', 'buy:shotgun']);
  assert.match(result.text, /next unlock: katana at wave 9 \(1200\)/);
  for (const rack of ARMORY) {
    const offered = values(result).includes(`buy:${rack.id}`);
    if (offered) assert.ok(rack.unlockWave <= 8 && rack.price <= 1000 && rack.weapon !== 'pistol', rack.id);
  }
  // Owned, or given up during this break: not offered again.
  max.inventory.smg = { ammo: 40, reserve: 120 };
  max.issuedWeapons.add('shotgun');
  max.points = 1500;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'buy'), ['buy:assault']);
  assert.match(result.actions.find(action => action.value === 'buy:assault').description, /replaces your pistol/, 'two slots are full');
  assert.ok(values(result).includes('weapon:smg'));
  max.points = 100;
  assert.equal(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'buy').length, 0, 'nothing affordable');
});

// Review of 13 October: with more coins, a companion buying the first rack
// offered went shotgun, bat, shotgun, fire axe, bat, and seldom held the SMG.
test('never a cheaper gun over a better one, nor a blade while a gun has ammo', () => {
  const { sim, get } = room({ humans: ['papa'] });
  const max = get('max');
  Object.assign(sim, { phase: 'intermission', wave: 5, timeLeft: 1e9 });
  max.inventory = { pistol: { ammo: 12, reserve: 60 }, shotgun: { ammo: 6, reserve: 30 } };
  Object.assign(max, { weapon: 'shotgun', points: 700 });
  const buys = () => kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'buy');
  assert.deepEqual(buys(), [], 'neither the fire axe nor the bat while its guns have ammo');
  max.weapon = 'pistol';
  assert.deepEqual(buys(), [], 'nor over its pistol');
  max.points = 1000;
  assert.deepEqual(buys(), ['buy:smg']);
  // Owner, 13 October: holding the shotgun, Max dropped it for the SMG. The
  // body takes out the weapon it can best spare first: the offer says which.
  max.weapon = 'shotgun';
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.actions.find(action => action.value === 'buy:smg').description, /; it replaces your pistol\.$/);
  // The SMG in hand or not: the shotgun replaces the pistol, never the SMG.
  max.inventory = { pistol: { ammo: 12, reserve: 60 }, smg: { ammo: 40, reserve: 120 } };
  Object.assign(max, { weapon: 'smg', points: 1000 });
  assert.deepEqual(buys(), ['buy:shotgun']);
  assert.match(wellFormed(sim, 'max', describeSituation(sim, 'max')).actions.find(action => action.value === 'buy:shotgun').description, /replaces your pistol/);
  max.weapon = 'pistol';
  assert.deepEqual(buys(), ['buy:shotgun'], 'the shotgun over its pistol');
  // "Le katana ... il n'y a pas besoin de munitions": a blade keeps its price,
  // so with a katana and a pistol a shotgun replaces the pistol; with a katana
  // and a shotgun only a gun dearer than the shotgun is offered.
  max.inventory = { katana: { ammo: 0, reserve: 0 }, pistol: { ammo: 12, reserve: 60 } };
  Object.assign(max, { weapon: 'katana', points: 1000 });
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'buy'), ['buy:smg', 'buy:shotgun']);
  for (const value of ['buy:smg', 'buy:shotgun']) assert.match(result.actions.find(action => action.value === value).description, /replaces your pistol/);
  max.inventory = { katana: { ammo: 0, reserve: 0 }, smg: { ammo: 40, reserve: 120 } };
  Object.assign(sim, { wave: 8 }); max.points = 2000;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'buy'), ['buy:rifle', 'buy:assault'], 'never the shotgun over the SMG, nor anything over the katana');
  assert.match(result.actions.find(action => action.value === 'buy:rifle').description, /replaces your SMG/);
  // A gun with no ammo at all is worth nothing: it goes first, even the machine gun.
  max.inventory = { rifle: { ammo: 0, reserve: 0 }, shotgun: { ammo: 8, reserve: 24 } };
  Object.assign(sim, { wave: 5 }); Object.assign(max, { weapon: 'shotgun', points: 1000 });
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'buy'), ['buy:smg']);
  assert.match(result.actions.find(action => action.value === 'buy:smg').description, /replaces your machine gun/);
  // A free slot: any gun; every gun empty: a blade too.
  max.inventory = { pistol: { ammo: 0, reserve: 0 } };
  max.points = 700;
  assert.deepEqual(buys(), ['buy:fireaxe', 'buy:shotgun', 'buy:bat']);
  max.inventory.pistol.reserve = 30;
  assert.deepEqual(buys(), ['buy:shotgun']);
  // A blade in hand, slots full, its pistol empty: the pistol goes, for a gun or a blade.
  max.inventory = { bat: { ammo: 0, reserve: 0 }, pistol: { ammo: 0, reserve: 0 } };
  Object.assign(max, { weapon: 'bat', points: 1000 });
  assert.deepEqual(buys(), ['buy:smg', 'buy:fireaxe', 'buy:shotgun']);
});

// The one value of companions/arsenal.mjs, shared by the eyes and the body:
// the rack price, a blade's for good, nothing for a gun with no ammo at all.
test('weapon worth: the price, a blade never runs dry, an empty gun is worth nothing', () => {
  const { sim, get } = room({ humans: ['papa'] });
  const max = get('max');
  max.inventory = { katana: { ammo: 0, reserve: 0 }, shotgun: { ammo: 0, reserve: 1 }, smg: { ammo: 0, reserve: 0 } };
  assert.deepEqual(['katana', 'shotgun', 'smg', 'rifle'].map(weapon => weaponWorth(sim, max, weapon)), [1200, 350, 0, 1800], 'a rack weapon comes full');
  assert.equal(spareWeapon(sim, max), 'smg');
  // To fight with: a gun with a round left, then a blade, then an empty gun;
  // then the worth (only between two: the dearest is not always the one).
  assert.equal(fightsBetter(sim, max, 'shotgun', 'katana'), true, 'a gun with a round left before a blade');
  assert.equal(fightsBetter(sim, max, 'katana', 'smg'), true, 'a blade before an empty gun');
  max.inventory.shotgun.reserve = 0;
  assert.equal(fightsBetter(sim, max, 'shotgun', 'katana'), false, 'every gun empty: the blade');
  max.inventory = { smg: { ammo: 40, reserve: 120 }, shotgun: { ammo: 8, reserve: 24 } };
  assert.equal(fightsBetter(sim, max, 'smg', 'shotgun'), true);
  assert.equal(fightsBetter(sim, max, 'shotgun', 'smg'), false);
  // Worth buying: with a slot free, any gun; slots full, only above the one
  // it can best spare; never a blade while a gun has a round left.
  max.inventory = { smg: { ammo: 40, reserve: 120 } };
  assert.equal(replaced(sim, max), null);
  assert.equal(worthBuying(sim, max, 'shotgun'), true);
  assert.equal(worthBuying(sim, max, 'katana'), false);
  max.inventory = { smg: { ammo: 40, reserve: 120 }, shotgun: { ammo: 8, reserve: 24 } };
  assert.equal(replaced(sim, max), 'shotgun');
  assert.deepEqual(['pistol', 'rifle'].map(weapon => worthBuying(sim, max, weapon)), [false, true]);
  max.inventory = { smg: { ammo: 0, reserve: 0 }, shotgun: { ammo: 0, reserve: 0 } };
  assert.deepEqual(['pistol', 'bat', 'katana'].map(weapon => worthBuying(sim, max, weapon)), [true, true, true], 'every gun empty: worth nothing');
  // Ties: the one with less ammo, then the cheaper (the break refills the other).
  max.inventory = { rifle: { ammo: 0, reserve: 0 }, pistol: { ammo: 0, reserve: 0 } };
  assert.equal(spareWeapon(sim, max), 'pistol');
  max.inventory = { katana: { ammo: 0, reserve: 0 }, pistol: { ammo: 12, reserve: 36 } };
  assert.equal(spareWeapon(sim, max), 'pistol', 'the starter pistol is the first to go');
  max.inventory = {};
  assert.equal(spareWeapon(sim, max), null);
});

test('duplicate copies keep their own worth, switch actions, active stock and ammo needs', () => {
  const { sim, get } = room({ humans: ['papa'] });
  intoWave(sim); quiet(sim);
  const max = get('max'), papa = get('papa');
  Object.assign(max, { x: -3, z: 0, weapon: 'pistol', weaponId: 'pistol#2', backpack: true,
    inventory: { pistol: { ammo: 12, reserve: 36 }, 'pistol#2': { ammo: 3, reserve: 9 },
      smg: { ammo: 0, reserve: 0 }, 'smg#2': { ammo: 1, reserve: 4 } } });
  Object.assign(papa, { x: 5, z: 4 });
  assert.equal(weaponWorth(sim, max, 'smg'), 0);
  assert.equal(weaponWorth(sim, max, 'smg#2'), ARMORY.find(rack => rack.weapon === 'smg').price);
  assert.equal(spareWeapon(sim, max), 'smg');
  assert.equal(replaced(sim, max), 'smg');
  assert.equal(fightsBetter(sim, max, 'smg#2', 'smg'), true);
  pickupAt(sim, 'box', 'ammo', -2.5, -.8);
  const result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /holding pistol 3\/12 \+9 spare/);
  assert.match(result.text, /also pistol 12\/12 \+36, SMG 0\/40 \+0 EMPTY, SMG 1\/40 \+4/);
  assert.match(result.actions.find(action => action.value === 'reload').description, /pistol 3\/12 \+9/);
  assert.deepEqual(kinds(result, 'weapon'), ['weapon:pistol', 'weapon:smg#2']);
  assert.match(result.actions.find(action => action.value === 'weapon:smg#2').description, /SMG 1\/40 \+4/);
  assert.ok(values(result).includes('collect:box'), 'the duplicate alone can need the ammo box');
  const kept = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'weapon', weapon: 'smg#2' } }));
  assert.equal(values(kept)[0], 'keep');
  assert.match(kept.text, /ORDER: switch to the SMG/);
});

test('reload context counts down and warns without withholding an emergency weapon switch', () => {
  const { sim, get } = room({ humans: ['papa'] });
  intoWave(sim); quiet(sim);
  const max = get('max');
  Object.assign(max, { x: 0, z: 0, hp: 20, weapon: 'shotgun', weaponId: 'shotgun',
    inventory: { shotgun: { ammo: 0, reserve: 24 }, pistol: { ammo: 12, reserve: 36 } } });
  zombieAt(sim, 'close', 1, 0, { entered: true });
  assert.ok(sim.reload('max'));
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /reloading: 2\.4 s left/);
  assert.match(result.actions.find(action => action.value === 'weapon:pistol').description,
    /cancels this reload \(2\.4 s left\), which must restart from zero on return/);
  assert.ok(values(result).includes('shoot:close'), 'the nearby threat remains actionable');
  tick(sim, .5);
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /reloading: 1\.9 s left/);
  assert.match(result.actions.find(action => action.value === 'weapon:pistol').description, /\(1\.9 s left\)/);
  tick(sim, 2);
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.equal(result.text.includes('reloading:'), false);
  assert.equal(result.actions.find(action => action.value === 'weapon:pistol').description.includes('cancels this reload'), false);
  assert.equal(max.inventory.shotgun.ammo, sim.weaponProfile(max).magazine, 'the ordinary recharge completes');
});

test('switching between independent copies warns about cancelling the active copy reload', () => {
  const { sim, get } = room({ humans: ['papa'] });
  intoWave(sim); quiet(sim);
  const max = get('max');
  Object.assign(max, { x: 0, z: 0, weapon: 'pistol', weaponId: 'pistol#2', backpack: true,
    inventory: { pistol: { ammo: 12, reserve: 36 }, 'pistol#2': { ammo: 0, reserve: 9 }, smg: { ammo: 40, reserve: 120 } } });
  assert.ok(sim.reload('max'));
  const result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /holding pistol 0\/12 \+9 spare.*reloading: 1\.3 s left/);
  assert.deepEqual(kinds(result, 'weapon'), ['weapon:pistol', 'weapon:smg']);
  for (const action of result.actions.filter(action => action.value.startsWith('weapon:')))
    assert.match(action.description, /cancels this reload \(1\.3 s left\)/);
  assert.ok(sim.chooseWeapon('max', 'pistol'), 'the model can still use the loaded copy immediately');
  assert.equal(max.reloadUntil, 0);
  assert.equal(max.inventory['pistol#2'].ammo, 0, 'the other copy did not finish reloading');
  const after = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.equal(after.text.includes('reloading:'), false);
  assert.equal(after.actions.find(action => action.value === 'weapon:pistol#2').description.includes('cancels this reload'), false);
});

test('NO AMMO applies to the empty held gun, not a reloadable gun, loaded alternative or melee weapon', () => {
  const { sim, get } = room({ humans: ['papa'] });
  intoWave(sim); quiet(sim);
  const max = get('max');
  Object.assign(max, { x: 0, z: 0, weapon: 'pistol', weaponId: 'pistol',
    inventory: { pistol: { ammo: 0, reserve: 0 }, smg: { ammo: 40, reserve: 120 } } });
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /NO AMMO: this weapon cannot fire or reload; if offered and safe, collect ammo, switch to a usable weapon or buy one; otherwise seek cover/);
  assert.match(result.text, /also SMG 40\/40 \+120/);
  assert.ok(values(result).includes('weapon:smg'), 'the usable alternative is still offered');
  assert.equal(values(result).includes('reload'), false);
  max.inventory.pistol.reserve = 4;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.equal(result.text.includes('NO AMMO:'), false, 'an empty magazine with reserve can reload');
  assert.ok(values(result).includes('reload'));
  max.inventory.pistol = { ammo: 1, reserve: 0 };
  assert.equal(describeSituation(sim, 'max').text.includes('NO AMMO:'), false, 'a loaded round can fire');
  Object.assign(max, { weapon: 'bat', weaponId: 'bat', inventory: { bat: { ammo: 0, reserve: 0 } } });
  assert.equal(describeSituation(sim, 'max').text.includes('NO AMMO:'), false, 'melee does not use ammunition');
});

test('a useful ammo recovery reports distance and continuity while keeping emergencies available', () => {
  const { sim, get } = room({ humans: ['papa'] });
  intoWave(sim); quiet(sim);
  const max = get('max'), papa = get('papa');
  Object.assign(max, { x: 0, z: 0, hp: 20, weapon: 'pistol', weaponId: 'pistol',
    inventory: { pistol: { ammo: 0, reserve: 0 } } });
  Object.assign(papa, { x: -2, z: 0 });
  down(sim, papa);
  zombieAt(sim, 'close', 1, 0, { entered: true });
  pickupAt(sim, 'box', 'ammo', 4, 0);
  const options = { order: { kind: 'collect', pickupId: 'box' }, orderSince: sim.time };
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max', options));
  assert.match(result.text, /ORDER: pick up the ammo box, for 0 s; ammo box 4\.0 m away; continue this recovery while the route remains safe; override for immediate danger or rescue/);
  for (const action of ['keep', 'collect:box', 'revive:papa', 'hold', 'loft'])
    assert.ok(values(result).includes(action), action);
  assert.equal(values(result).includes('shoot:close'), false, 'an empty gun cannot shoot, even during a useful recovery');
  max.x = 1;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max', options));
  assert.match(result.text, /ammo box 3\.0 m away/);
  max.inventory.pistol.reserve = sim.weaponProfile(max).reserve;
  assert.equal(describeSituation(sim, 'max', options).text.includes('continue this recovery'), false, 'no reminder when that ammo is no longer needed');
  max.inventory.pistol.reserve = 0;
  sim.pickups.delete('box');
  result = wellFormed(sim, 'max', describeSituation(sim, 'max', options));
  assert.equal(result.text.includes('continue this recovery'), false, 'no reminder for a vanished box');
  assert.equal(values(result).includes('keep'), false, 'the disappeared collection is not retained');
  assert.ok(values(result).includes('revive:papa'), 'rescue remains possible');
});

test('a companion does not buy another copy when only a numbered instance remains', () => {
  const { sim, get } = room({ humans: ['papa'] });
  intoWave(sim); quiet(sim);
  const max = get('max');
  sim.wave = 8;
  Object.assign(max, { weapon: 'smg', weaponId: 'smg#2', points: 5000,
    inventory: { 'smg#2': { ammo: 40, reserve: 120 } }, issuedWeapons: new Set() });
  const result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.equal(kinds(result, 'buy').includes('buy:smg'), false);
  assert.equal(result.text.includes('smg#2'), false, 'the brain reads the weapon name, not an internal instance id');
});

// The owner's night of 13 October: one purchase in 748 decisions. A purchase
// begun in a calm moment stayed legal only while nothing was within 8 m, so a
// zombie coming near on the way to the rack took 'keep' away and lost the walk.
test('a purchase under way may be kept when a zombie comes near; a new one waits for calm', () => {
  const { sim, get } = room({ humans: ['papa'] });
  intoWave(sim); quiet(sim);
  const max = get('max');
  sim.wave = 2; max.points = 500; Object.assign(max, { x: 3, z: -3 });
  assert.ok(values(wellFormed(sim, 'max', describeSituation(sim, 'max'))).includes('buy:shotgun'));
  zombieAt(sim, 'zc', max.x - 5, max.z, { entered: true });
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'buy', rackId: 'shotgun' }, orderSince: sim.time - 2 }));
  assert.equal(values(result)[0], 'keep', 'it may finish the purchase');
  assert.match(result.actions[0].description, /buy the shotgun \(2 s so far\)/);
  assert.equal(kinds(result, 'buy').length, 0, 'but no new purchase with a zombie within 8 m');
  // About to bite (review of 13 October: the buying body never backs off): no keep.
  for (const [x, kept] of [[max.x - 2.5, false], [max.x - 3.5, true]]) {
    Object.assign(sim.zombies.get('zc'), { x });
    result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'buy', rackId: 'shotgun' }, orderSince: sim.time - 2 }));
    assert.equal(values(result).includes('keep'), kept, `a zombie ${(max.x - x).toFixed(1)} m away`);
  }
  max.points = 100;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'buy', rackId: 'shotgun' }, orderSince: sim.time - 2 }));
  assert.equal(values(result).includes('keep'), false, 'no longer affordable: nothing to keep');
});

test('guards: collect only what helps, never weapons, bonuses, vests or grenades (coins have their own order); repair and defend only open doors', () => {
  const { sim, get } = room({ humans: ['papa'] });
  intoWave(sim); quiet(sim);
  const max = get('max'), papa = get('papa');
  for (const id of ['north', 'south']) assert.equal(sim.doors.find(door => door.id === id).sealed, true, 'one human and a companion (1.5) keep the solo two doors');
  Object.assign(max, { x: -3, z: 0 }); Object.assign(papa, { x: 5, z: 4 });
  for (const [id, kind, extra] of [['coins', 'points'], ['gift', 'points', { droppedBy: 'papa' }], ['gun', 'weapon', { weapon: 'magnum', ammo: 6, reserve: 0, expiresAt: Infinity }],
    ['bonus', 'bonus', { bonus: 'perforating' }], ['vest', 'armor'], ['nade', 'grenade'], ['box', 'ammo'], ['medkit', 'health'], ['kit', 'revive']]) pickupAt(sim, id, kind, -2.5, -.8, extra);
  pickupAt(sim, 'outbox', 'ammo', -10, 0);
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'collect'), ['collect:kit'], 'a kit beside it, papa far away: its to take (owner, 16 October)');
  assert.match(result.actions.find(action => action.value === 'collect:kit').description, /you have no kit and no human nearby needs it/);
  assert.match(result.text, /PICKUPS: .*2 coin piles inside \(100 coins\)/);
  assert.ok(values(result).includes('coins'), 'coins are never a collect order: they have their own');
  max.inventory.pistol.reserve = 4;
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'collect'), ['collect:box', 'collect:kit'], 'low reserve; never the box outside');
  max.inventory.pistol.reserve = 36; max.hp = 50;
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'collect'), ['collect:kit', 'collect:medkit']);
  papa.hp = 60; Object.assign(papa, { x: -2, z: 3 });
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'collect'), [], 'a hurt human nearby keeps the medkit, and with no kit of his own the kit is his too');
  papa.hp = 100; max.hp = 100; papa.reviveKit = true;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'collect'), ['collect:kit'], 'the human near already has a kit');
  assert.deepEqual(result.orders['collect:kit'], { kind: 'collect', pickupId: 'kit' });
  max.reviveKit = true;
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'collect'), [], 'one kit at a time');
  // Doors: all whole, then one broken, then the sealed one "damaged".
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'repair'), []);
  assert.deepEqual(kinds(result, 'defend'), ['defend:west', 'defend:east']);
  sim.doors.find(door => door.id === 'west').boards = [60, 60, 0, 0, 0];
  sim.doors.find(door => door.id === 'south').boards = [0, 0, 0, 0, 0];
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'repair'), ['repair:west']);
  assert.deepEqual(result.orders['repair:west'], { kind: 'repair', doorId: 'west' });
  assert.equal(values(result).some(value => value.endsWith(':south')), false);
  assert.match(result.text, /west door, [\d.]+ m W: 2\/5 boards \(40%\)/);
  assert.match(result.text, /Sealed \(nothing comes through\): north, south\./);
  // Never anything for the radar, ground weapons or bonuses, whatever the state.
  for (const value of values(result)) assert.doesNotMatch(value, /radar|magnum|gun|bonus|vest|nade|:coins|gift/);
});

test('shoot targets: seen, ranked by threat, six at most; the target rule of the simulation', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max');
  Object.assign(max, { x: 0, z: 2 }); Object.assign(get('jules'), { x: 5, z: 3 }); Object.assign(get('papa'), { x: 6, z: -5 });
  zombieAt(sim, 'zc', 5.6, 3.5);
  zombieAt(sim, 'zm', 1, 1);
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'shoot'), ['shoot:zc', 'shoot:zm'], 'inside and after a human first');
  // North is -z: (5.6, 3.5) is east of (0, 2), and (1, 1) north-east.
  assert.match(result.text, /- zc walker, 5\.8 m E, INSIDE \(ground\), next to Jules, 100% hp\n- zm walker, 1\.4 m NE, INSIDE \(ground\), next to YOU, 100% hp/);
  assert.deepEqual(result.orders['shoot:zc'], { kind: 'shoot', zombieId: 'zc' });
  // Eight more inside, all after the companion: the nearest come next.
  for (let index = 0; index < 8; index++) zombieAt(sim, `zx${index}`, -1 - index * .5, 1 - index * .1, { hp: 40 });
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'shoot'), ['shoot:zc', 'shoot:zm', 'shoot:zx0', 'shoot:zx1', 'shoot:zx2', 'shoot:zx3']);
  assert.match(result.text, /and \d+ more in sight \(not listed\)/);
  // Behind the partition: hidden, however close.
  sim.zombies.clear();
  Object.assign(max, { x: 0, z: -1.5 });
  zombieAt(sim, 'near', .5, -2.6); zombieAt(sim, 'far', -1, -4.5); zombieAt(sim, 'wall', -10, -3.5);
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'shoot'), []);
  assert.doesNotMatch(result.text, /- near walker|far walker|wall walker/, 'unseen identities are not free reconnaissance');
  assert.match(result.text, /No enemy in sight/);
  // Just behind the nailed-shut west window, 1.5 m away: close, but walled off.
  sim.zombies.clear();
  Object.assign(max, { x: -7.3, z: -3.5 });
  zombieAt(sim, 'behind', -8.8, -3.5);
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'shoot'), []);
  // The simulation's target rule: a survivor close outside pulls an outside
  // zombie; otherwise zombies go for the nearest survivor inside.
  sim.zombies.clear();
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  Object.assign(get('papa'), { x: -11, z: 0 }); Object.assign(max, { x: -6, z: 0 });
  zombieAt(sim, 'yard', -13, 2); zombieAt(sim, 'treeline', -16, -14);
  result = describeSituation(sim, 'max');
  assert.match(result.text, /- yard walker, .*going for Papa/);
  assert.doesNotMatch(result.text, /- treeline walker/, 'the hidden treeline enemy discloses neither identity nor its target');
  assert.match(result.text, /Papa \(human\): outside the west door/);
  // Raiders: aiming at a human is the most urgent; a retreating one the least.
  sim.zombies.clear();
  Object.assign(get('papa'), { x: -6, z: -4 }); Object.assign(max, { x: 0, z: 2 });
  // Outside, seen through the open east window (z -4.45..-2.55).
  const raider = sim.createRaider(1, { id: null, doorId: 'east', x: 11, z: -6 }, { index: 1, damageScale: 1 }, { point: { x: 11, z: -6 } });
  sim.zombies.set(raider.id, raider);
  Object.assign(raider.ai, { targetId: 'jules', aimingAt: 'jules', state: 'engage' });
  zombieAt(sim, 'zm', 1, 1);
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'shoot'), [`shoot:${raider.id}`, 'shoot:zm']);
  assert.match(result.text, new RegExp(`- ${raider.id} RAIDER \\(SMG\\), 14 m NE, outside, [\\d.]+ m from the east door, aiming at Jules, 100% hp\\n`));
  assert.match(result.text, /Jules \(human\): .*1 raider aiming at them/);
  raider.ai.state = 'retreat';
  assert.deepEqual(kinds(describeSituation(sim, 'max'), 'shoot'), ['shoot:zm', `shoot:${raider.id}`], 'a retreating raider comes last');
});

test('the survivor named as a zombie’s target is the one the simulation attacks', () => {
  const { sim, events, get } = room();
  intoWave(sim); quiet(sim);
  Object.assign(get('papa'), { x: -6, z: -4 });
  for (const [maxX, expected, said] of [[-.7, 'max', 'next to YOU'], [-.88, 'jules', 'next to Jules']]) {
    sim.zombies.clear();
    Object.assign(get('max'), { x: maxX, y: 0, z: 0 }); Object.assign(get('jules'), { x: .8, y: 0, z: 0 });
    zombieAt(sim, 'zt', 0, 0, { attackAfter: 0, speed: 0 });
    assert.match(describeSituation(sim, 'max').text, new RegExp(`- zt walker, .*INSIDE \\(ground\\), ${said}`));
    const before = events.length;
    sim.tick(1 / 30);
    assert.deepEqual(events.slice(before).filter(event => event.event === 'hit').map(event => event.id), [expected]);
  }
});

test('keep only with a current order that is still legal; the order text and its age', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  zombieAt(sim, 'z9', 1, 2.5);
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.equal(values(result).includes('keep'), false);
  assert.match(result.text, /ORDER: none yet\./);
  result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'shoot', zombieId: 'z9' }, orderSince: sim.time - 2.2 }));
  assert.equal(values(result)[0], 'keep');
  assert.equal(result.orders.keep, null);
  assert.match(result.actions[0].description, /Keep your current order: shoot z9 \(walker\) \(2 s so far\)/);
  assert.match(result.text, /ORDER: shoot z9 \(walker\), for 2 s\./);
  for (const order of [{ kind: 'shoot', zombieId: 'gone' }, { kind: 'buy', rackId: 'shotgun' }, { kind: 'defend', doorId: 'nowhere' },
    { kind: 'revive', playerId: 'papa' }, { kind: 'self-kit' }, { kind: 'wait' }, { kind: 'repair', doorId: 'west' }, { kind: 'teleport' }]) {
    const values_ = values(wellFormed(sim, 'max', describeSituation(sim, 'max', { order })));
    assert.equal(values_.includes('keep'), false, JSON.stringify(order));
  }
  for (const order of [{ kind: 'hold' }, { kind: 'loft' }, { kind: 'follow', playerId: 'papa' }, { kind: 'defend', doorId: 'west' }, 'defend:west']) {
    assert.equal(values(wellFormed(sim, 'max', describeSituation(sim, 'max', { order })))[0], 'keep', JSON.stringify(order));
  }
  // Reload and switch: offered only when they mean something.
  const max = get('max');
  assert.equal(values(describeSituation(sim, 'max')).includes('reload'), false, 'a full magazine');
  max.inventory.pistol.ammo = 3;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.actions.find(action => action.value === 'reload').description, /Reload your pistol 3\/12 \+36 now\./);
  max.inventory.pistol.reserve = 0;
  assert.equal(values(describeSituation(sim, 'max')).includes('reload'), false, 'nothing to reload with');
  max.inventory.shotgun = { ammo: 0, reserve: 0 }; max.inventory.katana = { ammo: 0, reserve: 0 };
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'weapon'), ['weapon:katana'], 'an empty gun is not worth switching to; a blade always is');
  // Outside the hazard phases there is nothing to decide but holding.
  sim.phase = 'victory';
  assert.deepEqual(values(wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'hold' } }))), ['keep', 'hold']);
  assert.deepEqual(describeSituation(sim, 'nobody'), { text: 'You are not in this room.', actions: [], orders: {} });
});

test('the situation is deterministic and leaves the room untouched', () => {
  const recent = ['Papa went down'];
  const first = crowded({ seed: 5 }), second = crowded({ seed: 5 });
  const before = JSON.stringify(first.sim.snapshot());
  const a = describeSituation(first.sim, 'max', { order: { kind: 'hold' }, orderSince: 1, recent });
  const b = describeSituation(first.sim, 'max', { order: { kind: 'hold' }, orderSince: 1, recent });
  const c = describeSituation(second.sim, 'max', { order: { kind: 'hold' }, orderSince: 1, recent });
  assert.deepEqual(a, b); assert.deepEqual(a, c);
  assert.equal(JSON.stringify(first.sim.snapshot()), before, 'nothing in the room changed');
  // Simulation events are worded for the model, newest last.
  const { sim, events, get } = room();
  intoWave(sim); quiet(sim);
  down(sim, get('jules'));
  tick(sim, 2);
  const text = describeSituation(sim, 'max', { recent: events.slice(-12) }).text;
  assert.match(text, /RECENT: .*Jules went down \(2 s ago\)\.$/);
});

test('a teammate downed on the doorstep is revived from inside the doorway; one really outside is not', () => {
  const scene = ({ boards = 0, at = { x: -8.3, z: .2 } } = {}) => {
    const { sim, get } = room();
    intoWave(sim); quiet(sim);
    const west = sim.doors.find(door => door.id === 'west');
    west.boards = west.boards.map(hp => boards ? hp : 0);
    Object.assign(get('papa'), { x: 5, z: 4 }); Object.assign(get('max'), { x: -4, z: 0 }); Object.assign(get('jules'), at);
    down(sim, get('jules'));
    return { sim, get };
  };
  const { sim, get } = scene();
  const max = get('max'), jules = get('jules');
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(result.orders['revive:jules'], { kind: 'revive', playerId: 'jules' });
  assert.match(result.actions.find(action => action.value === 'revive:jules').description, /from inside the west door/);
  assert.match(result.text, /Jules \(human\): DOWN, outside the west door, .*on the doorstep: revive them from inside the west door/);
  assert.doesNotMatch(result.text, /you cannot go there/);
  assert.equal(values(wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'revive', playerId: 'jules' } })))[0], 'keep');
  max.reviveKit = true;
  assert.ok(values(wellFormed(sim, 'max', describeSituation(sim, 'max'))).includes('kit:jules'));
  max.reviveKit = false;
  // The spot is inside, and from it the simulation itself revives him.
  const spot = doorstepSpot(sim, jules);
  assert.ok(spot && spot.doorId === 'west' && Math.abs(spot.x) < 8 && Math.abs(spot.z) < 6, JSON.stringify(spot));
  Object.assign(max, { x: spot.x, z: spot.z });
  assert.equal(sim.reviveTargetFor(max), jules);
  for (let step = 0; step < 6 * 30 && jules.downed; step++) { if (step % 6 === 0) sim.interact('max', { revive: true }); sim.tick(1 / 30); }
  assert.equal(jules.downed, false, 'revived from inside');
  assert.equal(Math.abs(max.x) < 8, true);
  // Four metres out, or behind intact boards: out of reach, and said so.
  for (const options of [{ at: { x: -12, z: 0 } }, { boards: 5 }]) {
    const other = scene(options);
    assert.equal(doorstepSpot(other.sim, other.get('jules')), null, JSON.stringify(options));
    const outcome = wellFormed(other.sim, 'max', describeSituation(other.sim, 'max', { order: { kind: 'revive', playerId: 'jules' } }));
    assert.equal(values(outcome).some(value => /^(keep|revive|kit):/.test(value) || value === 'keep'), false, JSON.stringify(options));
    assert.match(outcome.text, /Jules \(human\): DOWN, outside.*you cannot go there/);
  }
});

test('the only ammo box is left for a human nearby who is short of ammo', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max'), jules = get('jules');
  Object.assign(get('papa'), { x: 5, z: 4 }); Object.assign(max, { x: 2, z: 0 }); Object.assign(jules, { x: -3.5, z: -1 });
  max.inventory.pistol = { ammo: 2, reserve: 6 };
  jules.inventory.pistol = { ammo: 0, reserve: 0 };
  pickupAt(sim, 'box', 'ammo', -3.5, .6);
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'collect'), [], 'Jules is empty and 1.6 m from it');
  assert.match(result.text, /ammo box [\d.]+ m W \(leave it for Jules\)/);
  jules.inventory.pistol = { ammo: 12, reserve: 36 };
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'collect'), ['collect:box'], 'nobody else needs it');
  assert.match(result.text, /ammo box [\d.]+ m W \(you may take it\)/);
  jules.inventory.pistol = { ammo: 0, reserve: 0 };
  Object.assign(jules, { x: 6.5, z: 5 });
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'collect'), ['collect:box'], 'Jules is far from it and from Max');
});

test('a human outside is never followed; the door they went out by says so', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  Object.assign(get('papa'), { x: -13, z: 3 }); Object.assign(get('max'), { x: -5, z: 0 }); Object.assign(get('jules'), { x: 2, z: 3 });
  const result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'follow', playerId: 'papa' }, orderSince: sim.time - 4 }));
  assert.deepEqual(kinds(result, 'follow'), ['follow:jules']);
  assert.equal(values(result).includes('keep'), false, 'following Papa outside is over');
  assert.match(result.actions.find(action => action.value === 'defend:west').description, /Papa is outside beyond it/);
  assert.doesNotMatch(result.actions.find(action => action.value === 'defend:east').description, /outside beyond/);
  // Back inside: followed again.
  Object.assign(get('papa'), { x: -6, z: 3 });
  assert.equal(values(wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'follow', playerId: 'papa' } })))[0], 'keep');
});

test('a zombie behind a wall is not a target, not in sight, and never "next to" the companion', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  Object.assign(get('papa'), { x: 6, z: -4.5 }); Object.assign(get('jules'), { x: 6.5, z: -4.5 }); Object.assign(get('max'), { x: 0, z: -1.5 });
  zombieAt(sim, 'near', .5, -2.6);
  for (let index = 0; index < 6; index++) zombieAt(sim, `v${index}`, -2.5 + index, 2);
  const result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'shoot'), ['shoot:v2', 'shoot:v3', 'shoot:v1', 'shoot:v4', 'shoot:v0', 'shoot:v5']);
  assert.match(result.text, /\(6 zombies, 6 in your line of sight\)/);
  assert.match(result.text, /7 on the field\)/, 'the separate global progress counter is preserved');
  assert.doesNotMatch(result.text, /- near walker/, 'a hidden target does not disclose its identity, floor or HP');
});

test('targets stay within reach of the weapon in hand', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max'), west = sim.doors.find(door => door.id === 'west');
  west.boards = west.boards.map(() => 0);
  Object.assign(get('papa'), { x: 6, z: 4.5 }); Object.assign(get('jules'), { x: 6.5, z: 4.5 }); Object.assign(max, { x: -4, z: 0 });
  zombieAt(sim, 'far', -24, .3);
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'shoot'), ['shoot:far'], 'a pistol reaches it through the open door');
  for (const [weapon, stock] of [['katana', { ammo: 0, reserve: 0 }], ['flamethrower', { ammo: 80, reserve: 40 }]]) {
    Object.assign(max, { weapon, inventory: { [weapon]: stock } });
    const result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
    assert.deepEqual(kinds(result, 'shoot'), [], weapon);
    assert.match(result.text, new RegExp(`- far walker, .*beyond the reach of your ${weapon === 'katana' ? 'katana' : 'flamethrower'}`));
  }
  // A blade still reaches a zombie in the doorway and one a few steps inside.
  Object.assign(max, { x: -6.5, z: 0, weapon: 'katana', inventory: { katana: { ammo: 0, reserve: 0 } } });
  zombieAt(sim, 'door', -9, 0); zombieAt(sim, 'in', -2.5, -.5);
  const result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'shoot').sort(), ['shoot:door', 'shoot:in']);
  assert.match(result.actions.find(action => action.value === 'shoot:door').description, /^Attack door walker/);
});

test('when the text must be trimmed, the enemies shown and the "more" line still add up', () => {
  for (const limit of [2000, 1700]) {
    const { sim } = crowded();
    const { text } = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'hold' }, recent: ['Papa went down'], limit }));
    assert.ok(text.length <= limit, `${text.length} > ${limit}`);
    const lines = text.split('\n'), at = lines.findIndex(line => line.startsWith('ENEMIES'));
    const header = lines[at].match(/\((\d+) zombies?(?: and (\d+) raiders?)?,/);
    const total = Number(header[1]) + Number(header[2] ?? 0);
    const listed = [];
    for (const line of lines.slice(at + 1)) { if (!line.startsWith('- ')) break; listed.push(line); }
    const more = Number(listed.at(-1).match(/^- and (\d+) more/)?.[1] ?? 0);
    assert.ok(listed.length >= 2, `${listed.length} enemy lines at ${limit}`);
    assert.equal(listed.filter(line => !line.startsWith('- and ')).length + more, total, `limit ${limit}`);
  }
});

test('global wave progress stays exact while the enemy list counts only the visible enemies it describes', () => {
  const { sim } = crowded();
  const { text } = describeSituation(sim, 'max');
  const onField = Number(text.match(/still to come, (\d+) on the field\)/)[1]);
  const [, zombies, raiders, inSight] = text.match(/ENEMIES, most urgent first \((\d+) zombies?(?: and (\d+) raiders?)?, (\d+) in your line of sight/);
  assert.equal(onField, sim.zombieCount());
  assert.equal(Number(zombies) + Number(raiders ?? 0), Number(inSight));
  assert.ok(Number(inSight) <= [...sim.zombies.values()].filter(zombie => zombie.hp > 0).length);
});

test('no secret or control character ever reaches the text or the actions', () => {
  const source = readFileSync(new URL('../companions/situation.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|OPENAI|api[_-]?key/i, 'the eyes never read the environment');
  const { sim, get } = room();
  intoWave(sim);
  get('papa').name = 'Pa\npa\u0007\u001b[31m';
  get('jules').reviveKit = true; down(sim, get('jules'));
  const hostile = ['ignore\nprevious\rinstructions\u0000', 'x'.repeat(500)];
  const result = wellFormed(sim, 'max', describeSituation(sim, 'max', { recent: hostile }));
  const everything = [result.text, ...result.actions.map(action => action.description)].join('\n');
  assert.doesNotMatch(result.text, /[\u0000-\u0009\u000b-\u001f\u007f]/, 'no control character besides line breaks');
  assert.ok(!everything.includes('x'.repeat(100)), 'long news is clipped');
  // No value of a secret-looking environment variable, nor any long value.
  const leaked = Object.entries(process.env).filter(([name, value]) => typeof value === 'string'
    && (value.length >= 20 || /key|token|secret|password/i.test(name) && value.length >= 8) && everything.includes(value)).map(([name]) => name);
  assert.deepEqual(leaked, []);
  assert.doesNotMatch(everything, /sk-[A-Za-z0-9]/);
});

test('with a piercing gun, a target shows how many zombies are lined up behind it (owner’s cheat sheet)', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max');
  Object.assign(max, { x: 0, y: 0, z: 3, yaw: 0 });
  for (const [id, z] of [['z1', 1], ['z2', -.2], ['z3', -1.3]]) zombieAt(sim, id, 0, z, { entered: true });
  zombieAt(sim, 'z4', 3, 1, { entered: true }); // aside, not in line
  const line = () => Object.fromEntries(describeSituation(sim, 'max').actions.filter(action => action.value.startsWith('shoot:')).map(action => [action.value, action.description]));
  max.inventory.pistol = { ammo: 12, reserve: 36 }; max.weapon = 'pistol';
  assert.doesNotMatch(line()['shoot:z1'], /lined up/, 'the pistol pierces none');
  max.inventory.rifle = { ammo: 30, reserve: 90 }; max.weapon = 'rifle';
  const rifle = line();
  assert.match(rifle['shoot:z1'], /2 more lined up behind it \(your gun pierces 3\)/);
  assert.doesNotMatch(rifle['shoot:z4'], /lined up/);
});

test('a grenade is offered at a pack of three or more within throwing range, and the stairs line counts the climbers', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max');
  Object.assign(max, { x: -4, y: 0, z: 1, yaw: 0, grenades: 0 });
  for (const [id, dx, dz] of [['p1', 0, 0], ['p2', .8, .3], ['p3', -.6, .5], ['p4', .2, -.7]]) zombieAt(sim, id, -4 + dx, -4.5 + dz, { entered: true });
  const grenades = () => describeSituation(sim, 'max').actions.filter(action => action.value.startsWith('grenade:'));
  assert.equal(grenades().length, 0, 'no grenade, no offer');
  max.grenades = 2;
  const offered = grenades();
  assert.equal(offered.length, 1, 'one pack, one offer');
  assert.match(offered[0].description, /pack of 4/);
  assert.deepEqual(describeSituation(sim, 'max').orders[offered[0].value].kind, 'grenade');
  sim.zombies.clear(); zombieAt(sim, 'lone', -4, -4.5, { entered: true });
  assert.equal(grenades().length, 0, 'never on a single zombie');
  zombieAt(sim, 's1', 3.8, 1.4, { y: 1.3, entered: true }); zombieAt(sim, 's2', 3.8, .6, { y: 1.9, entered: true });
  assert.match(describeSituation(sim, 'max').text, /STAIRS: 2 zombies climbing in single file/);
});

// Trips outside (owner, 13 October: "il ne faut pas leur interdire d'aller dehors").
test('the way out: an open doorway a survivor gets through, the walk round the cabin within 14 m, and the rain it costs', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const west = sim.doors.find(door => door.id === 'west'), north = sim.doors.find(door => door.id === 'north');
  assert.equal(wayOut(sim, { x: -13, y: 0, z: 1 }), null, 'intact boards');
  west.boards = [60, 60, 0, 0, 0];
  assert.equal(wayOut(sim, { x: -13, y: 0, z: 1 }), null, 'the lower boards still bar it');
  west.boards = [0, 0, 0, 0, 60];
  const way = wayOut(sim, { x: -13, y: 0, z: 1 });
  assert.equal(way.door, west);
  assert.ok(Math.abs(way.distance - (1 + Math.hypot(4, 1))) < 1e-9);
  assert.equal(wayOut(sim, { x: -13, y: 1.2, z: 1 }), null, 'on the ground only');
  assert.equal(wayOut(sim, { x: -5, y: 0, z: 1 }), null, 'inside is no trip');
  assert.equal(wayOut(sim, { x: -26, y: 0, z: 0 }), null, 'too far');
  assert.equal(wayOut(sim, { x: 2, y: 0, z: 9 }), null, 'round the south-west corner: too far');
  assert.equal(wayOut(sim, { x: -6, y: 0, z: -10 })?.door, west, 'round the north-west corner');
  north.boards.fill(0);
  assert.equal(wayOut(sim, { x: -6, y: 0, z: -10 })?.door, north, 'a shorter walk by the north door');
  west.sealed = true;
  assert.equal(wayOut(sim, { x: -13, y: 0, z: 1 }), null, 'sealed');
  const max = get('max');
  assert.deepEqual(rainCost(sim, max, way.distance), { seconds: 4, umbrella: 100, burn: 0, affordable: true });
  max.umbrella.remaining = 0;
  assert.deepEqual(rainCost(sim, max, way.distance), { seconds: 4, umbrella: 0, burn: 21, affordable: true });
  sim.difficulty = 'hard'; max.hp = 40;
  assert.deepEqual(rainCost(sim, max, way.distance), { seconds: 4, umbrella: 0, burn: 27, affordable: false });
});

test('an ammo box or a medkit outside is offered only when needed, through a broken door within reach, and said honestly', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max'), jules = get('jules'), west = sim.doors.find(door => door.id === 'west');
  Object.assign(get('papa'), { x: 5, z: 4 }); Object.assign(jules, { x: 6, z: -4 }); Object.assign(max, { x: -4, z: 0 });
  pickupAt(sim, 'yard', 'ammo', -13, 1);
  const look = () => wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(look(), 'collect'), [], 'a full reserve: not needed');
  max.inventory.pistol.reserve = 4;
  let result = look();
  assert.deepEqual(kinds(result, 'collect'), [], 'never through intact boards');
  assert.match(result.text, /ammo box [\d.]+ m W outside \(no way out to it for you\)/);
  assert.doesNotMatch(result.text, /step outside/);
  west.boards = [60, 60, 0, 0, 0];
  assert.deepEqual(kinds(look(), 'collect'), [], 'nor past its lower boards');
  west.boards = [0, 0, 0, 0, 60];
  result = look();
  assert.deepEqual(kinds(result, 'collect'), ['collect:yard']);
  assert.deepEqual(result.orders['collect:yard'], { kind: 'collect', pickupId: 'yard' });
  assert.equal(result.actions.find(action => action.value === 'collect:yard').description,
    'Pick up the ammo box outside, 5.1 m past the broken west door (low on ammo): about 4 s in the rain, under your umbrella.');
  assert.match(result.text, /- west door, [^\n]*; you can step outside through it\./);
  assert.doesNotMatch(result.text, /- (east|north|south) door[^\n]*step outside/);
  assert.match(result.text, /ammo box [\d.]+ m W outside \(you may take it\)/);
  // The enemies by it are said: zombies outside go for anyone within 5 m.
  zombieAt(sim, 'yz', -14, 2.5);
  assert.match(look().actions.find(action => action.value === 'collect:yard').description, /under your umbrella; 1 enemy near it\.$/);
  sim.zombies.clear();
  // Too far round the cabin, a door about to be sealed, or a sealed one: no trip.
  pickupAt(sim, 'far', 'ammo', 2, 9);
  assert.deepEqual(kinds(look(), 'collect'), ['collect:yard'], 'the box round the corner is too far');
  sim.pickups.delete('far');
  for (const key of ['sealPending', 'sealed']) {
    west[key] = true;
    assert.deepEqual(kinds(look(), 'collect'), [], key);
    west[key] = false;
  }
  // The rain: a worn umbrella costs health, and too much of it rules the trip out.
  max.umbrella.remaining = 0;
  assert.match(look().actions.find(action => action.value === 'collect:yard').description, /about 4 s in the rain, umbrella 0 s left, ~21 HP of rain\.$/);
  max.hp = 30;
  assert.deepEqual(kinds(look(), 'collect'), [], 'it would leave it below 20 HP');
  max.hp = 100; max.umbrella.remaining = 100;
  // Humans first: Jules, empty and close by, gets it.
  Object.assign(jules, { x: -6, z: 2 }); jules.inventory.pistol = { ammo: 0, reserve: 0 };
  result = look();
  assert.deepEqual(kinds(result, 'collect'), []);
  assert.match(result.text, /ammo box [\d.]+ m W outside \(leave it for Jules\)/);
  Object.assign(jules, { x: 6, z: -4 }); jules.inventory.pistol = { ammo: 12, reserve: 36 };
  // A medkit when hurt; never a revive kit or coins out there.
  sim.pickups.delete('yard'); max.inventory.pistol.reserve = 36;
  pickupAt(sim, 'aid', 'health', -12, -2); pickupAt(sim, 'kit', 'revive', -12, 2); pickupAt(sim, 'coins', 'points', -11, 0);
  get('papa').reviveKit = jules.reviveKit = true;
  assert.deepEqual(kinds(look(), 'collect'), [], 'not hurt');
  max.hp = 50;
  result = look();
  assert.deepEqual(kinds(result, 'collect'), ['collect:aid']);
  assert.match(result.actions.find(action => action.value === 'collect:aid').description, /^Pick up the medkit outside, [\d.]+ m past the broken west door \(hurt\): about \d s in the rain/);
  // A collect order under way outside: kept, and said so; its own line tells the umbrella.
  Object.assign(max, { x: -10, z: -.5 }); max.umbrella = { open: true, remaining: 96.6 };
  result = wellFormed(sim, 'max', describeSituation(sim, 'max', { order: { kind: 'collect', pickupId: 'aid' }, orderSince: sim.time - 3 }));
  assert.equal(values(result)[0], 'keep');
  assert.match(result.text, /ORDER: pick up the medkit outside, for 3 s\./);
  assert.match(result.text, /YOU: Max \(AI teammate\), outside the west door; .*umbrella open, 96 s left/);
});

test('the longest trip description stays whole', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max');
  sim.doors.find(door => door.id === 'north').boards.fill(0);
  Object.assign(max, { x: 5, y: 3.4, z: -3 });
  max.inventory.pistol.reserve = 0; max.umbrella.remaining = 5;
  pickupAt(sim, 'big', 'ammo', 3, -16, { special: true });
  for (const [index, dx] of [-1, 0, 1].entries()) zombieAt(sim, `yz${index}`, 3 + dx * 1.5, -18);
  const description = wellFormed(sim, 'max', describeSituation(sim, 'max')).actions.find(action => action.value === 'collect:big').description;
  assert.equal(description, 'Pick up the big ammo box outside, 10 m past the broken north door (low on ammo): about 7 s in the rain, umbrella 5 s left, ~15 HP of rain.');
  assert.ok(description.length < 170);
});

test('a box on the doorstep of a broken door is a trip like any other, and one out of reach says why', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max'), west = sim.doors.find(door => door.id === 'west');
  Object.assign(get('papa'), { x: 5, z: 4 }); Object.assign(get('jules'), { x: 6, z: -4 }); Object.assign(max, { x: -5, z: 0 });
  max.inventory.pistol.reserve = 2;
  west.boards.fill(0);
  // Between the wall and the eaves, where zombies shot in the doorway drop their loot.
  for (const [x, z] of [[-8.3, 0], [-8.45, .2], [-8.55, .4], [-8.4, 2]]) {
    const way = wayOut(sim, { x, y: 0, z });
    assert.equal(way?.door, west, `(${x}, ${z})`);
    assert.ok(way.distance > 1 && way.distance < 3.5, `(${x}, ${z}): ${way.distance.toFixed(2)} m`);
  }
  pickupAt(sim, 'doorstep', 'ammo', -8.45, .2);
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'collect'), ['collect:doorstep']);
  assert.match(result.actions.find(action => action.value === 'collect:doorstep').description, /^Pick up the ammo box outside, 1\.6 m past the broken west door \(low on ammo\): about 2 s in the rain/);
  assert.match(result.text, /PICKUPS: ammo box [\d.]+ m W outside \(you may take it\)/);
  // Out of reach for other reasons than the doorway: said as it is.
  sim.pickups.clear();
  pickupAt(sim, 'yard', 'ammo', -13, 1);
  max.umbrella.remaining = 0; max.hp = 30;
  assert.match(wellFormed(sim, 'max', describeSituation(sim, 'max')).text, /ammo box [\d.]+ m W outside \(too long in the rain for you\)/);
  max.umbrella.remaining = 100; max.hp = 100;
  sim.pickups.get('yard').expiresAt = sim.time + 4;
  assert.match(wellFormed(sim, 'max', describeSituation(sim, 'max')).text, /ammo box [\d.]+ m W outside \(it fades before you get there\)/);
  sim.pickups.clear();
  pickupAt(sim, 'kit', 'revive', -12, 2);
  get('papa').reviveKit = get('jules').reviveKit = true;
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'collect'), []);
  assert.match(result.text, /revive kit [\d.]+ m W outside \(never yours outside\)/);
  west.boards.fill(60);
  sim.pickups.clear();
  pickupAt(sim, 'yard', 'ammo', -13, 1);
  assert.match(wellFormed(sim, 'max', describeSituation(sim, 'max')).text, /ammo box [\d.]+ m W outside \(no way out to it for you\)/);
});

test('a repair never shuts a teammate out: the action says who is beyond the door, and a companion shut out says so', () => {
  const { sim, get } = room({ companions: ['max', 'lea'] });
  intoWave(sim); quiet(sim);
  const max = get('max'), lea = get('lea'), papa = get('papa'), west = sim.doors.find(door => door.id === 'west');
  Object.assign(papa, { x: 5, z: 4 }); Object.assign(get('jules'), { x: 6, z: -4 }); Object.assign(lea, { x: -5, z: -1 });
  west.boards.fill(0);
  const repair = () => wellFormed(sim, 'lea', describeSituation(sim, 'lea')).actions.find(action => action.value === 'repair:west').description;
  Object.assign(max, { x: -5, z: 1 });
  assert.match(repair(), /^Rebuild the west door boards \(0\/5 left\); [\d.]+ m \w+\.$/, 'Max inside');
  Object.assign(max, { x: -12, z: 1 });
  assert.match(repair(), /\); [\d.]+ m W; Max is out beyond it: you wait till they are back in\.$/);
  Object.assign(papa, { x: -10, z: -2 });
  assert.match(repair(), /; Papa and Max are out beyond it: you wait till they are back in\.$/);
  // A teammate far off, downed, or with another open doorway nearer is not waited for.
  Object.assign(papa, { x: 5, z: 4 });
  Object.assign(max, { x: -30, z: 1 });
  assert.doesNotMatch(repair(), /beyond it/, 'far off');
  Object.assign(max, { x: 2, z: -10 });
  sim.doors.find(door => door.id === 'north').boards.fill(0);
  assert.doesNotMatch(repair(), /beyond it/, 'the north doorway is its way in');
  sim.doors.find(door => door.id === 'north').boards.fill(60);
  assert.match(repair(), /Max is out beyond it/, 'round the corner, the west doorway is its only way in');
  // Shut out: every doorway boarded up behind it.
  Object.assign(max, { x: -12, z: 1 });
  assert.doesNotMatch(describeSituation(sim, 'max').text, /SHUT OUTSIDE/);
  west.boards[0] = 25;
  assert.match(wellFormed(sim, 'max', describeSituation(sim, 'max')).text, /YOU: Max \(AI teammate\), [^\n]*; SHUT OUTSIDE \(every doorway boarded up\): you shoot a plank out of the nearest to get back in/);
  assert.doesNotMatch(repair(), /beyond it/, 'already shut: nothing left to wait for');
  max.inventory.pistol = { ammo: 0, reserve: 0 };
  assert.match(describeSituation(sim, 'max').text, /SHUT OUTSIDE \(every doorway boarded up\): you wait by the nearest \(a gun with ammo would shoot a plank out\)/);
});

test('zombies behind a wall are never counted as lined up', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  const max = get('max');
  Object.assign(max, { x: 0, y: 0, z: 3, yaw: 0 });
  max.inventory.rifle = { ammo: 30, reserve: 90 }; max.weapon = 'rifle';
  zombieAt(sim, 'front', 0, -1.2, { entered: true });
  zombieAt(sim, 'behind', 0, -3.2, { entered: true }); // beyond the partition at z = -2
  const shoot = describeSituation(sim, 'max').actions.find(action => action.value === 'shoot:front');
  assert.ok(shoot); assert.doesNotMatch(shoot.description, /lined up/);
});

// The supply crate (owner, 16 October): the whole picture in the text —
// ladders, levels, what the family carries — and one claim action per bonus
// its weapons make it eligible for, while a way out and the rain allow it.
test('the supply crate: one claim per eligible bonus, the line says it all, nothing once claimed or shut in', () => {
  const { sim, get } = room();
  intoWave(sim); quiet(sim);
  Object.assign(sim, { wave: 4 });
  sim.beginSupplyWave();
  const max = get('max'), papa = get('papa');
  Object.assign(max, { x: -3, y: 0, z: 1 });
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /SUPPLY CRATE \(free, one bonus per survivor/);
  assert.match(result.text, /you have NOT claimed yours/);
  assert.match(result.text, /extended \(extended magazine: \+10% magazine and reserve per level; new for you\)/);
  assert.match(result.text, /Nearby presence · 8 s · 25 m/);
  assert.match(result.text, /out through the west door, about \d+ s in the rain/);
  // A pistol: extended, perforating, reinforced rounds and radar fit; no melee weapon to reinforce.
  assert.deepEqual(kinds(result, 'claim').sort(), Object.keys(SUPPLY_BONUSES).filter(kind => kind !== 'stone').map(kind => `claim:${kind}`).sort());
  assert.deepEqual(result.orders['claim:extended'], { kind: 'claim', bonus: 'extended' });
  assert.deepEqual(orderFromValue('claim:radar'), { kind: 'claim', bonus: 'radar' });
  max.inventory.bat = { ammo: 0, reserve: 0 };
  max.bonus = { stone: 3 };
  const reinforced = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(reinforced.text, /reinforced weapons: \+10% melee damage per level/);
  assert.match(reinforced.text, /\+1 extra target per swing at level 4, \+2 at level 8/);
  assert.match(reinforced.text, /yours 3 -> 4/);
  assert.deepEqual(reinforced.orders['claim:stone'], { kind: 'claim', bonus: 'stone' });
  assert.match(reinforced.actions.find(action => action.value === 'claim:stone').description, /\+1 extra target per swing at level 4/);
  max.bonus.stone = 8;
  assert.ok(!kinds(describeSituation(sim, 'max'), 'claim').includes('claim:stone'));
  delete max.inventory.bat;
  assert.match(result.actions.find(action => action.value === 'claim:extended').description, /Claim extended \(\+10% magazine and reserve a level; 0->1\)/);
  // The levels it carries and what the family carries shape the choice.
  max.bonus = { extended: 2 };
  papa.bonus = { radar: 3 };
  assert.match(describeSituation(sim, 'max').text, /yours 2 -> 3/);
  assert.match(describeSituation(sim, 'max').text, /the family carries Papa radar 3/);
  max.bonus = null;
  // Claimed: the line says so and no claim is offered.
  sim.supplyCrate.claimed.add('max');
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'claim'), []);
  assert.match(result.text, /you have claimed yours/);
  // No open doorway out: nothing offered, the line says why.
  sim.supplyCrate.claimed.delete('max');
  sim.doors.find(door => door.id === 'west').boards.fill(60);
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.deepEqual(kinds(result, 'claim'), []);
  assert.match(result.text, /No way to it right now: no open doorway leads out to it/);
});

// The station (owner, 16 October): one of each per wave, offered with the
// racks while the shop is open, each service only while it makes sense.
test('the supply station: kits, grenades and armor while the shop is open, each only while it makes sense', () => {
  const { sim, get } = room();
  Object.assign(sim, { phase: 'intermission', wave: 5, timeLeft: 30 });
  const max = get('max');
  Object.assign(max, { points: 2000, x: -2.4, y: 0, z: -3 });
  let result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /SUPPLY STATION, ground, by the north door \(one of each per wave\): revive 1200, backpack: wave 10, grenade: wave 15, armor: wave 15, ammo: wave 15; you have 2,000 coins\./);
  // Wave 5: only the kit has opened (the pistol is full: no ammo either way).
  assert.deepEqual(kinds(result, 'supply'), ['supply:revive']);
  assert.deepEqual(result.orders['supply:revive'], { kind: 'supply', service: 'revive' });
  assert.deepEqual(orderFromValue('supply:revive'), { kind: 'supply', service: 'revive' });
  // A kit already carried: no second one; bought this wave: gone.
  max.reviveKit = true;
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'supply'), []);
  max.reviveKit = false;
  max.supplyPurchases = ['revive'];
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'supply'), []);
  max.supplyPurchases = [];
  // Wave 15: everything is open; 500 coins buy the grenade alone.
  Object.assign(sim, { wave: 15 });
  result = wellFormed(sim, 'max', describeSituation(sim, 'max'));
  assert.match(result.text, /revive 1200, backpack 1500, grenade 350, armor 600, ammo 700; you have 2,000 coins\./);
  assert.deepEqual(kinds(result, 'supply').sort(), ['supply:armor', 'supply:backpack', 'supply:grenade', 'supply:revive']);
  Object.assign(max, { points: 500 });
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'supply').sort(), ['supply:grenade']);
  // Mid-wave with an enemy near: the shop is shut, the station with it.
  Object.assign(sim, { phase: 'wave', toSpawn: 1, spawnTimer: 1e9 });
  Object.assign(max, { points: 2000 });
  zombieAt(sim, 'near', -1, -2, { entered: true });
  assert.deepEqual(kinds(wellFormed(sim, 'max', describeSituation(sim, 'max')), 'supply'), []);
});
