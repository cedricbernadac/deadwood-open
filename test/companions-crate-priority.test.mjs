import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { defendedDoorIds } from '../public/rules.js';
import { SUPPLY_BONUSES } from '../public/weapon-upgrades.js';
import { describeSituation, TEXT_LIMIT, MAX_ACTIONS } from '../companions/situation.mjs';
import { describeTeamPlan, normalizeTeamPlan } from '../companions/team-plan.mjs';
import { crateOpportunity, crateAccessAtDoor } from '../companions/crate-opportunity.mjs';
import { GUIDE, TACTICAL_GUIDE, PLAN_GUIDE } from '../companion-brain/guide.mjs';
import { rollCompanionProfile } from '../companions/profiles.mjs';

function room() {
  const sim = new RoomSimulation('CRATEQA', { random: () => .5 });
  const human = sim.addPlayer('human', 'Jules');
  const bot = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(human.id);
  Object.assign(sim, { phase: 'intermission', wave: 2, timeLeft: 1000, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear(); sim.spawnWarnings.clear(); sim.beginSupplyWave();
  const defended = new Set(defendedDoorIds(sim.participantCount()));
  sim.doors.forEach(door => { door.sealed = !defended.has(door.id); door.sealPending = false; });
  Object.assign(human, { x: 3, y: 0, z: 3 }); Object.assign(bot, { x: -6.7, y: 0, z: .9 });
  const west = sim.doors.find(door => door.id === 'west');
  west.boards = [0, 0, 60, 60, 60];
  return { sim, human, bot, west };
}
const actions = result => result.actions.map(action => action.value);
const jsonLine = (request, prefix) => JSON.parse(request.situation.split('\n').find(line => line.startsWith(prefix)).slice(prefix.length));
function install(sim) {
  const request = describeTeamPlan(sim), choices = Object.fromEntries(request.questions.map(question => [question.name, question.choices[0].value]));
  choices.bot0_bonus = 'vitamins'; choices.bot0_post = 'west';
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, { choices });
  return request;
}

test('one human and one bot can see their free wave2 claim through the crouch-only west opening without a plan', () => {
  const { sim, bot, west } = room();
  assert.equal(sim.participantCount(), 1.5);
  assert.deepEqual(sim.doors.filter(door => !door.sealed).map(door => door.id).sort(), ['east', 'west']);
  const opportunity = crateOpportunity(sim, bot);
  assert.ok(opportunity); assert.equal(opportunity.way.door, west); assert.equal(opportunity.way.crouch, true);
  const result = describeSituation(sim, bot.id);
  assert.ok(actions(result).includes('claim:vitamins'));
  assert.match(result.actions.find(action => action.value === 'claim:vitamins').description, /crouch out west/);
  assert.match(result.text, /CRATE WINDOW: your free bonus is unclaimed; west exit requires crouching/);
  assert.match(result.text, /crouch through the lower opening/);
  assert.match(result.text, /safe trip before resealing/);
  assert.match(result.actions.find(action => action.value === 'repair:west').description, /safe claims before resealing; danger overrides/);
  assert.ok(GUIDE.includes('take safe crate claims before resealing their last exit'));
  assert.ok(GUIDE.includes('crouch through low gaps'));
  assert.ok(result.text.length <= TEXT_LIMIT); assert.ok(result.actions.length <= MAX_ACTIONS);
});

test('crate opportunities follow the 17 independent wave claims and actual consumption, not a preferred plan bonus', () => {
  const { sim, bot } = room();
  const offeredWaves = [];
  for (let wave = 1; wave <= 20; wave++) {
    sim.wave = wave; sim.beginSupplyWave();
    const opportunity = crateOpportunity(sim, bot), offered = actions(describeSituation(sim, bot.id)).some(value => value.startsWith('claim:'));
    assert.equal(offered, Boolean(opportunity));
    if (opportunity) offeredWaves.push(wave);
  }
  assert.deepEqual(offeredWaves, Array.from({ length: 17 }, (_, index) => index + 2));
  sim.wave = 2; sim.beginSupplyWave(); install(sim);
  bot.bonus = { vitamins: 8 };
  assert.ok(actions(describeSituation(sim, bot.id)).includes('claim:grenadier'), 'a now-maxed preferred bonus does not suppress other free choices');
  sim.supplyCrate.claimed.add(bot.id);
  assert.equal(crateOpportunity(sim, bot), null);
  assert.ok(!actions(describeSituation(sim, bot.id)).some(value => value.startsWith('claim:')));
  assert.doesNotMatch(describeSituation(sim, bot.id).text, /CRATE WINDOW: your free bonus/);
});

test('strategy receives the usable crouch route, real pending claimants and advice to keep the exit open', () => {
  const { sim, bot, human } = room();
  let request = describeTeamPlan(sim), crate = jsonLine(request, 'CRATE '), doors = jsonLine(request, 'DOORS ');
  assert.equal(crate.via, 'west'); assert.equal(crate.crouch, true);
  assert.deepEqual(crate.ready.sort(), [bot.id, human.id].sort());
  assert.equal(doors.find(door => door.id === 'west').passage, 'crouch');
  assert.equal(Object.hasOwn(doors.find(door => door.id === 'east'), 'passage'), false);
  assert.match(request.situation, /Safe claims before resealing the last exit/);
  sim.supplyCrate.claimed.add(human.id); request = describeTeamPlan(sim); crate = jsonLine(request, 'CRATE ');
  assert.deepEqual(crate.ready, [bot.id]);
  assert.ok(TACTICAL_GUIDE.includes('Safe crate trips outrank closing their exit'));
  assert.ok(PLAN_GUIDE.includes('danger and rescues override'));
  assert.ok(TACTICAL_GUIDE.split(/\s+/).length <= 350);
});

test('repair advice names only survivors whose last affordable route it would close, and disappears when none need it', () => {
  const { sim, bot, human, west } = room();
  assert.deepEqual(crateAccessAtDoor(sim, west).claimants.map(player => player.id).sort(), [bot.id, human.id].sort());
  sim.supplyCrate.claimed.add(bot.id);
  assert.deepEqual(crateAccessAtDoor(sim, west).claimants.map(player => player.id), [human.id]);
  const repair = describeSituation(sim, bot.id).actions.find(action => action.value === 'repair:west');
  assert.ok(repair); assert.doesNotMatch(repair.description, /safe claims before resealing/, 'an uninterested human is not treated as a queued bot');
  sim.supplyCrate.claimed.add(human.id); assert.equal(crateAccessAtDoor(sim, west), null);
  sim.supplyCrate.claimed.clear(); sim.supplyCrate.active = false; assert.equal(crateAccessAtDoor(sim, west), null);
  sim.supplyCrate.active = true; bot.hp = 20; human.hp = 20; bot.umbrella.remaining = 0; human.umbrella.remaining = 0;
  assert.equal(crateAccessAtDoor(sim, west), null, 'an unaffordable rain trip must not prevent repairing');
});

test('an alternative affordable exit makes the first doorway unnecessary for preserving crate access', () => {
  const { sim, west } = room();
  Object.assign(sim.supplyCrate, { x: -10, z: 7 });
  const south = sim.doors.find(door => door.id === 'south'); south.sealed = false; south.boards.fill(0);
  assert.equal(crateAccessAtDoor(sim, west), null);
  assert.equal(crateAccessAtDoor(sim, south), null);
});

test('crate priorities leave urgent rescue, shooting, retreat and repair choices free', () => {
  const { sim, bot, human } = room(); install(sim);
  sim.phase = 'wave'; sim.damagePlayer(human, 1000, { id: 'fixture' }); bot.reviveKit = true;
  const enemy = Object.assign(sim.spawnZombie(), { x: -4.5, y: 0, z: .9, hp: 80, maxHp: 80, scale: 1,
    entered: true, kind: 'walker', speed: 0, attackAfter: Infinity });
  const result = describeSituation(sim, bot.id, { order: { kind: 'repair', doorId: 'west' } });
  for (const value of ['revive:human', 'kit:human', `shoot:${enemy.id}`, 'loft', 'hold', 'claim:vitamins']) assert.ok(actions(result).includes(value), value);
  assert.match(result.text, /Rescue and danger override/);
  assert.ok(result.actions.length <= MAX_ACTIONS); assert.ok(result.text.length <= TEXT_LIMIT);
});

test('four loaded builds keep the crate route and previous intentions intact within the strategic text budget', t => {
  const { sim, human, bot, west } = room();
  for (const id of ['bot1', 'bot2']) sim.addPlayer(id, `Companion ${id}`, undefined, { companion: true });
  // Existing joined survivors share the same quiet wave; the fixture supplies
  // only inventory/profile facts, without a server or model request.
  for (const [index, player] of [...sim.players.values()].entries()) {
    Object.assign(player, { alive: true, waiting: false, hp: 100, x: -3 + index, y: 0, z: 1, name: 'Long survivor name '.repeat(4), backpack: true,
      bonus: Object.fromEntries(Object.keys(SUPPLY_BONUSES).map(kind => [kind, 7])),
      inventory: Object.fromEntries(['pistol', 'smg', 'shotgun', `smg-copy-${'x'.repeat(60)}`].map(id => [id, { ...(id.startsWith('smg-copy') ? { weapon: 'smg' } : {}), ammo: 10, reserve: 24 }])) });
    if (player.companion) player.companionProfile = rollCompanionProfile(['veteran', 'protector', 'timid'][index - 1], () => .75);
  }
  install(sim); const request = describeTeamPlan(sim);
  assert.ok(request.situation.length < 16000, String(request.situation.length));
  assert.match(request.situation, /PREVIOUS INTENTIONS .*\]$/);
  const crate = jsonLine(request, 'CRATE '); assert.equal(crate.via, west.id); assert.equal(crate.ready.length, 4);
  assert.equal(jsonLine(request, 'TEAM ').length, 4); assert.equal(jsonLine(request, 'ARMORY ').length, 13);
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < 65536);
  t.diagnostic(JSON.stringify({ situationCharacters: request.situation.length, requestBytes: Buffer.byteLength(JSON.stringify(request)), survivors: 4, crateClaimants: crate.ready.length }));
});
