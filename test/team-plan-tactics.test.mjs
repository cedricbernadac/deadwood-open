import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { ARMORY } from '../public/rules.js';
import { weaponEntries } from '../public/weapon-inventory.js';
import { describeTeamPlan, normalizeTeamPlan, crateRunner } from '../companions/team-plan.mjs';
import { describeSituation, TACTICAL_ACTIONS, MAX_ACTIONS } from '../companions/situation.mjs';
import { spareWeapon, worthBuying, fightsBetter } from '../companions/arsenal.mjs';
import { createCompanionBody } from '../companions/body.mjs';
import { seededRandom } from '../validation/balance-report.mjs';

function room() {
  const events = [], sim = new RoomSimulation('TPLAN1', { random: seededRandom(9), onEvent: event => events.push(event) });
  const papa = sim.addPlayer('papa', 'Papa'), jules = sim.addPlayer('jules', 'Jules');
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  const lea = sim.addPlayer('lea', 'Lea', undefined, { companion: true });
  sim.start('papa');
  Object.assign(sim, { phase: 'intermission', wave: 16, timeLeft: 1e9, toSpawn: 1, spawnTimer: 1e9 });
  Object.assign(max, { x: -3, z: 1, points: 6000 });
  Object.assign(papa, { x: 5, z: 4 }); Object.assign(jules, { x: 4, z: 3 });
  Object.assign(lea, { x: -5, z: 0 });
  return { sim, events, papa, jules, max, lea };
}
function install(sim, overrides = {}) {
  const request = describeTeamPlan(sim);
  const choices = Object.fromEntries(request.questions.map(question => [question.name, question.choices[0].value]));
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, { choices: { ...choices, ...overrides } });
  assert.ok(sim.companionTeamPlan, 'a validated plan');
  return sim.companionTeamPlan;
}
const values = result => result.actions.map(action => action.value);
const inventory = (player, types) => {
  player.inventory = Object.fromEntries(types.map(type => [type, { ammo: type === 'katana' ? 0 : 5, reserve: type === 'katana' ? 0 : 20 }]));
  player.weapon = types[0]; player.weaponId = types[0];
};

test('the planned cheaper weapon replaces the non-preferred gun and the body completes that purchase', () => {
  const { sim, events, max } = room();
  inventory(max, ['sniper', 'minigun']);
  assert.equal(worthBuying(sim, max, 'flamethrower'), false, 'legacy price ordering');
  install(sim, { bot0_role: 'close', bot0_goalWeapon: 'flamethrower', bot0_keepWeapon: 'sniper' });
  assert.equal(spareWeapon(sim, max), 'minigun');
  assert.equal(worthBuying(sim, max, 'flamethrower'), true);
  const action = describeSituation(sim, 'max').actions.find(action => action.value === 'buy:flamethrower');
  assert.ok(action); assert.match(action.description, /Planned weapon.*replaces your gatling/);
  const rack = ARMORY.find(item => item.weapon === 'flamethrower');
  Object.assign(max, { x: rack.x, y: rack.y, z: rack.z - 1, grounded: true, interactAfter: 0 });
  const body = createCompanionBody(sim, 'max', { random: seededRandom(19) });
  body.setOrder({ kind: 'buy', rackId: rack.id });
  for (let index = 0; index < 10 && !max.inventory.flamethrower; index++) { body.tick(1 / 30); sim.tick(1 / 30); }
  assert.deepEqual(weaponEntries(max).map(item => item.weapon).sort(), ['flamethrower', 'sniper']);
  assert.equal(max.weapon, 'flamethrower', 'the chosen role outranks the more costly retained gun after purchase');
  assert.ok(events.some(event => event.event === 'purchase' && event.weapon === 'flamethrower' && event.replacedWeapon === 'minigun'));
});

test('both preferred usable weapons are retained, while an empty preferred gun never traps the bot', () => {
  const { sim, max } = room();
  inventory(max, ['smg', 'shotgun']);
  install(sim, { bot0_goalWeapon: 'shotgun', bot0_keepWeapon: 'smg' });
  assert.equal(worthBuying(sim, max, 'rocket'), false, 'price alone cannot replace a complete preferred pair');
  assert.equal(fightsBetter(sim, max, 'shotgun', 'smg'), true, 'goal may be cheaper');
  max.inventory.shotgun = { ammo: 0, reserve: 0 };
  assert.equal(fightsBetter(sim, max, 'shotgun', 'smg'), false, 'a loaded fallback outranks an empty goal');
  assert.equal(spareWeapon(sim, max), 'shotgun');
  assert.equal(worthBuying(sim, max, 'assault'), true, 'a survival replacement remains possible');
});

test('a planned melee role is possible without silently changing legacy purchasing for humans', () => {
  const { sim, max, papa } = room();
  inventory(max, ['rifle', 'pistol']); inventory(papa, ['rifle', 'pistol']);
  install(sim, { bot0_role: 'close', bot0_goalWeapon: 'katana', bot0_keepWeapon: 'rifle' });
  assert.equal(worthBuying(sim, max, 'katana'), true);
  assert.equal(spareWeapon(sim, max), 'pistol');
  assert.equal(worthBuying(sim, papa, 'katana'), false);
  assert.equal(spareWeapon(sim, papa), 'pistol');
  assert.doesNotMatch(describeSituation(sim, 'papa').text, /TEAM PLAN|planned turn/);
  const rack = ARMORY.find(item => item.weapon === 'katana');
  Object.assign(papa, { x: rack.x, y: rack.y, z: rack.z - 1, points: 6000, interactAfter: 0 });
  assert.equal(sim.buyWeapon('papa', 'katana'), true, 'humans remain free to choose their own replacement');
});

test('a nearly empty preferred pair allows an emergency purchase and keeps the newly full gun in hand', () => {
  const { sim, max } = room();
  Object.assign(sim, { phase: 'wave', wave: 8 });
  inventory(max, ['smg', 'shotgun']);
  Object.assign(max, { points: 1800, inventory: { smg: { ammo: 1, reserve: 0 }, shotgun: { ammo: 1, reserve: 0 } } });
  install(sim, { bot0_goalWeapon: 'smg', bot0_keepWeapon: 'shotgun' });
  assert.equal(worthBuying(sim, max, 'rifle'), true, 'two remaining rounds cannot hard-lock survival purchases');
  assert.ok(values(describeSituation(sim, max.id)).includes('buy:rifle'));
  max.inventory.smg = { ammo: 6, reserve: 0 }; max.inventory.shotgun = { ammo: 2, reserve: 0 };
  assert.equal(worthBuying(sim, max, 'rifle'), false, 'adequate preferred stocks still protect the pair');
  max.inventory.smg.ammo = 1; max.inventory.shotgun.ammo = 1;
  const rack = ARMORY.find(item => item.weapon === 'rifle');
  Object.assign(max, { x: rack.x + 1, y: rack.y, z: rack.z, grounded: true, interactAfter: 0 });
  const body = createCompanionBody(sim, max.id, { random: seededRandom(19) });
  body.setOrder({ kind: 'buy', rackId: rack.id });
  for (let index = 0; index < 10 && !max.inventory.rifle; index++) { body.tick(1 / 30); sim.tick(1 / 30); }
  assert.deepEqual(weaponEntries(max).map(item => item.weapon).sort(), ['rifle', 'smg']);
  assert.equal(max.weapon, 'rifle', 'the full useful gun beats a preferred gun with one remaining round');
  assert.equal(fightsBetter(sim, max, 'smg', 'rifle'), false);
  sim.companionTeamPlan = null;
  max.inventory = { smg: { ammo: 1, reserve: 0 }, pistol: { ammo: 12, reserve: 36 } };
  assert.equal(fightsBetter(sim, max, 'smg', 'pistol'), true, 'legacy price ordering is unchanged without a plan');
});

test('an expensive nearly empty pair may buy a cheaper filled gun for survival', () => {
  const { sim, max } = room();
  Object.assign(sim, { phase: 'wave', wave: 13 });
  inventory(max, ['sniper', 'minigun']);
  Object.assign(max, { points: 1400, inventory: { sniper: { ammo: 1, reserve: 0 }, minigun: { ammo: 1, reserve: 0 } } });
  install(sim, { bot0_role: 'marksman', bot0_goalWeapon: 'sniper', bot0_keepWeapon: 'minigun' });
  assert.equal(worthBuying(sim, max, 'assault'), true, 'survival stock outranks the higher prices of nearly empty weapons');
  assert.ok(values(describeSituation(sim, max.id)).includes('buy:assault'));
  const rack = ARMORY.find(item => item.weapon === 'assault');
  Object.assign(max, { x: rack.x, y: rack.y, z: rack.z + 1, grounded: true, interactAfter: 0 });
  const body = createCompanionBody(sim, max.id, { random: seededRandom(19) });
  body.setOrder({ kind: 'buy', rackId: rack.id });
  for (let index = 0; index < 10 && !max.inventory.assault; index++) { body.tick(1 / 30); sim.tick(1 / 30); }
  assert.deepEqual(weaponEntries(max).map(item => item.weapon).sort(), ['assault', 'sniper']);
  assert.equal(max.weapon, 'assault', 'the bought full gun stays active instead of returning to the preferred single sniper round');
  assert.equal(max.points, 0, 'ordinary authoritative price is still paid');
});

test('a saturated tactical menu keeps rescues, real weapon switches, reload, planned buy and crate claim', () => {
  const { sim, max, jules, lea } = room();
  inventory(max, ['pistol', 'smg', 'shotgun', 'katana']); max.backpack = true; max.reviveKit = true;
  sim.beginSupplyWave(); sim.doors.find(door => door.id === 'west').boards.fill(0);
  for (const door of sim.doors) door.boards[0] = 0;
  sim.damagePlayer(jules, 1000, { id: 'test' }); sim.damagePlayer(lea, 1000, { id: 'test' });
  for (let index = 0; index < 6; index++) sim.zombies.set(`target${index}`, { id: `target${index}`, x: -2 + index * .4, y: 0, z: 2.5,
    hp: 80, maxHp: 80, scale: 1, kind: 'walker', entered: true, speed: 0, attackAfter: Infinity, doorId: 'west' });
  for (const [id, kind] of [['box', 'ammo'], ['kit', 'revive'], ['health', 'health']]) sim.pickups.set(id,
    { id, kind, x: -2, y: 0, z: 1, amount: 1, expiresAt: sim.time + 90 });
  const legacy = describeSituation(sim, 'max', { order: { kind: 'defend', doorId: 'east' } });
  assert.equal(legacy.actions.length, MAX_ACTIONS);
  assert.ok(!values(legacy).includes('buy:flamethrower'), 'the original trailing slice loses the goal');
  install(sim, { bot0_role: 'close', bot0_goalWeapon: 'flamethrower', bot0_keepWeapon: 'smg', bot0_bonus: 'extended', bot0_post: 'west' });
  const result = describeSituation(sim, 'max', { order: { kind: 'defend', doorId: 'east' } });
  assert.ok(result.actions.length <= MAX_ACTIONS && result.actions.length >= TACTICAL_ACTIONS);
  for (const value of ['keep', 'revive:jules', 'revive:lea', 'kit:jules', 'kit:lea', 'hold', 'loft', 'reload',
    'weapon:smg', 'weapon:shotgun', 'weapon:katana', 'buy:flamethrower', 'claim:extended']) assert.ok(values(result).includes(value), value);
  assert.equal(values(result)[0], 'keep'); assert.ok(values(result).some(value => value.startsWith('shoot:')));
  assert.match(result.text, /TEAM PLAN/); assert.match(result.text, /Rescue, immediate danger, ammunition and humans outrank the plan/);
  assert.ok(result.text.length <= 2800);
});

test('out-of-ammo survival alternatives remain available despite a long term goal', () => {
  const { sim, max } = room();
  inventory(max, ['pistol', 'smg']); max.inventory.pistol = { ammo: 0, reserve: 0 }; max.inventory.smg = { ammo: 0, reserve: 0 };
  sim.pickups.set('ammo', { id: 'ammo', kind: 'ammo', x: -2, y: 0, z: 1, amount: 1, expiresAt: sim.time + 90 });
  install(sim, { bot0_goalWeapon: 'rocket', bot0_keepWeapon: 'smg' });
  const result = describeSituation(sim, 'max');
  assert.ok(values(result).includes('collect:ammo')); assert.ok(values(result).includes('supply:ammo'));
  assert.ok(values(result).some(value => value.startsWith('buy:')));
  sim.damagePlayer(max, 1000, { id: 'test' }); max.reviveKit = true;
  assert.deepEqual(values(describeSituation(sim, 'max')), ['self-kit', 'wait']);
});

test('crate turns coordinate cover without removing an eligible emergency override', () => {
  const { sim, max, lea } = room();
  sim.beginSupplyWave(); sim.doors.find(door => door.id === 'west').boards.fill(0);
  install(sim, { bot0_bonus: 'extended', bot1_bonus: 'reinforced', tripLead: 'max' });
  assert.equal(crateRunner(sim), 'max');
  let result = describeSituation(sim, 'lea');
  assert.match(result.text, /Crate trip turn: Max; others cover/);
  assert.ok(values(result).includes('claim:reinforced'), 'override stays legal for the covering companion');
  sim.supplyCrate.claimed.add(max.id);
  assert.equal(crateRunner(sim), 'lea');
  result = describeSituation(sim, 'lea'); assert.match(result.text, /Crate trip turn: Lea/);
  sim.supplyCrate.claimed.clear(); max.downed = true;
  assert.equal(crateRunner(sim), 'lea', 'a downed planned runner never holds the next companion');
  assert.ok(values(describeSituation(sim, 'lea')).includes('revive:max'));
  max.downed = false; max.alive = false;
  assert.equal(crateRunner(sim), 'lea');
  sim.supplyCrate.claimed.add(lea.id); assert.equal(crateRunner(sim), null);
});
