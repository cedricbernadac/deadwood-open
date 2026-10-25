import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { seededRandom } from '../validation/balance-report.mjs';
import { SUPPLY_BONUSES } from '../public/weapon-upgrades.js';
import { rollCompanionProfile, companionProfilePrompt } from '../companions/profiles.mjs';
import { describeTeamPlan, normalizeTeamPlan, planSignature, teamIntent } from '../companions/team-plan.mjs';
import { describeSituation, TEXT_LIMIT, MAX_ACTIONS } from '../companions/situation.mjs';
import { buildInput, buildPlanInput, GUIDE, TACTICAL_GUIDE, PLAN_GUIDE } from '../companion-brain/guide.mjs';

const archetypes = ['sharpshooter', 'rusher', 'protector', 'timid', 'veteran'];
function room(count = 2) {
  const sim = new RoomSimulation('PROFILE', { random: seededRandom(20261017) });
  const human = sim.addPlayer('human', 'Jules');
  const bots = Array.from({ length: count }, (_, index) => sim.addPlayer(`bot${index}`, `Bot ${index}`, undefined, { companion: true }));
  sim.start(human.id);
  Object.assign(sim, { phase: 'intermission', wave: 15, timeLeft: 1e9, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear(); sim.spawnWarnings.clear();
  Object.assign(human, { x: 5, y: 0, z: 4 });
  bots.forEach((bot, index) => Object.assign(bot, { x: -2 - index, y: 0, z: 1, points: 6000,
    companionProfile: rollCompanionProfile(archetypes[index], () => .5) }));
  return { sim, human, bots };
}
const answer = request => ({ choices: Object.fromEntries(request.questions.map(question => [question.name, question.choices[0].value])) });
function install(sim) {
  const request = describeTeamPlan(sim);
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, answer(request));
  assert.ok(sim.companionTeamPlan);
}
const team = request => JSON.parse(request.situation.split('\n').find(line => line.startsWith('TEAM ')).slice(5));
const actionValues = result => result.actions.map(action => action.value);

test('each actual stable profile reaches TEAM and tactical SELF without becoming a forced role or purchase', () => {
  const { sim, human, bots: [bot] } = room(1);
  human.companionProfile = rollCompanionProfile('veteran', () => .5);
  for (const archetype of archetypes) {
    bot.companionProfile = rollCompanionProfile(archetype, () => .25);
    const prompt = companionProfilePrompt(bot.companionProfile), before = JSON.stringify(bot.companionProfile);
    const request = describeTeamPlan(sim), people = team(request);
    assert.equal(people.find(person => person.id === bot.id).profile, prompt);
    assert.equal(Object.hasOwn(people.find(person => person.id === human.id), 'profile'), false, 'human attributes are not companion capabilities');
    const result = describeSituation(sim, bot.id);
    assert.ok(result.text.includes(`YOUR PROFILE: ${prompt}`));
    assert.equal(JSON.stringify(bot.companionProfile), before, 'describing a profile cannot reroll or mutate it');
    assert.deepEqual(request.questions.find(question => question.name === 'bot0_role').choices.map(choice => choice.value), ['support', 'close', 'marksman', 'medic']);
    assert.ok(request.questions.find(question => question.name === 'bot0_goalWeapon').choices.some(choice => choice.value === 'none'));
    assert.ok(request.questions.find(question => question.name === 'bot0_goalWeapon').choices.some(choice => choice.value === 'flamethrower'));
    assert.doesNotMatch(describeSituation(sim, human.id).text, /YOUR PROFILE:/, 'human prompts never gain bot personality');
  }
});

test('profile changes invalidate a pending shared plan, while damage, ammunition and coins remain tactical', () => {
  const { sim, bots: [bot] } = room();
  const request = describeTeamPlan(sim), initial = planSignature(sim);
  bot.points -= 400; bot.hp -= 10; bot.inventory.pistol.ammo--;
  assert.equal(planSignature(sim), initial);
  assert.ok(normalizeTeamPlan(sim, request, answer(request)));
  bot.companionProfile = rollCompanionProfile('veteran', () => .25);
  assert.notEqual(planSignature(sim), initial);
  assert.equal(normalizeTeamPlan(sim, request, answer(request)), null, 'old role allocation cannot attach to different skills');
  const changed = planSignature(sim);
  bot.companionProfile = rollCompanionProfile('veteran', () => .75);
  assert.notEqual(planSignature(sim), changed, 'the same archetype with distinct handling is a different profile');
});

test('missing or invalid profiles preserve legacy decisions and the legacy guide fallback', () => {
  const { sim, bots: [bot] } = room(1);
  delete bot.companionProfile;
  const baseline = describeSituation(sim, bot.id);
  for (const profile of [undefined, null, {}, { archetype: 'veteran' }]) {
    bot.companionProfile = profile;
    const result = describeSituation(sim, bot.id);
    assert.equal(result.text, baseline.text);
    assert.deepEqual(result.actions, baseline.actions);
    assert.equal(Object.hasOwn(team(describeTeamPlan(sim)).find(person => person.id === bot.id), 'profile'), false);
    assert.ok(buildInput({ situation: result.text, companion: bot, mode: 'legacy' }).startsWith(GUIDE));
  }
});

test('profiles keep the full strategic inventory, catalogue and previous intentions below payload ceilings', t => {
  const { sim, bots } = room(3);
  for (const player of sim.players.values()) {
    player.name = 'Long survivor name '.repeat(4); player.backpack = true;
    player.inventory = Object.fromEntries(['pistol', 'smg', 'shotgun', `smg-copy-${'x'.repeat(60)}`]
      .map(id => [id, { ...(id.startsWith('smg-copy') ? { weapon: 'smg' } : {}), ammo: 10, reserve: 24 }]));
    player.bonus = Object.fromEntries(Object.keys(SUPPLY_BONUSES).map(kind => [kind, 8]));
  }
  bots.forEach((bot, index) => { bot.companionProfile = rollCompanionProfile(['veteran', 'protector', 'timid'][index], () => .75); });
  install(sim);
  const request = describeTeamPlan(sim);
  assert.ok(request.situation.length < 16000, `${request.situation.length} characters`);
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < 65536, 'closed-plan payload fits its existing transport ceiling');
  assert.equal(team(request).length, 4);
  assert.ok(team(request).every(person => person.weapons.length === 4));
  assert.equal(JSON.parse(request.situation.split('\n').find(line => line.startsWith('ARMORY ')).slice(7)).length, 13);
  assert.match(request.situation, /PREVIOUS INTENTIONS .*\]$/);
  bots.forEach(bot => assert.ok(request.situation.includes(companionProfilePrompt(bot.companionProfile))));
  assert.ok(buildPlanInput(request).endsWith(request.situation), 'the second prompt bound does not cut an already bounded context');
  t.diagnostic(JSON.stringify({ situationCharacters: request.situation.length, requestBytes: Buffer.byteLength(JSON.stringify(request)), survivors: team(request).length, questions: request.questions.length }));
});

test('cautious and aggressive personalities retain identical urgent menus and downed self-rescue', () => {
  const { sim, human, bots: [bot, mate] } = room();
  Object.assign(bot, { reviveKit: true, hp: 30, weapon: 'pistol', weaponId: 'pistol',
    inventory: { pistol: { ammo: 0, reserve: 0 }, smg: { ammo: 10, reserve: 60 } } });
  sim.damagePlayer(human, 1000, { id: 'test' });
  sim.damagePlayer(mate, 1000, { id: 'test' });
  sim.pickups.set('ammo', { id: 'ammo', kind: 'ammo', x: -2, y: 0, z: 1.5, expiresAt: sim.time + 90 });
  install(sim);
  let baseline;
  for (const archetype of archetypes) {
    bot.companionProfile = rollCompanionProfile(archetype, () => .5);
    const result = describeSituation(sim, bot.id), values = actionValues(result);
    for (const value of ['revive:human', 'kit:human', 'revive:bot1', 'kit:bot1', 'collect:ammo', 'weapon:smg', 'loft', 'hold'])
      assert.ok(values.includes(value), `${archetype}: ${value}`);
    if (baseline) assert.deepEqual(values, baseline, 'personality informs the decision but removes no emergency alternative');
    baseline = values;
  }
  sim.damagePlayer(bot, 1000, { id: 'test' });
  assert.deepEqual(actionValues(describeSituation(sim, bot.id)), ['self-kit', 'wait']);
});

test('loaded tactical text keeps profile, empty-gun warning and urgent human state when optional lines are trimmed', () => {
  const { sim, human, bots } = room(3), bot = bots[0];
  for (const survivor of sim.players.values()) {
    survivor.backpack = true;
    survivor.inventory = Object.fromEntries(['pistol', 'smg', 'shotgun', 'sniper'].map(type => [type, { ammo: 5, reserve: 24 }]));
    survivor.bonus = Object.fromEntries(Object.keys(SUPPLY_BONUSES).map(kind => [kind, 8]));
  }
  bot.inventory.pistol = { ammo: 0, reserve: 0 };
  bot.companionProfile = rollCompanionProfile('timid', () => .5);
  sim.damagePlayer(human, 1000, { id: 'test' });
  human.bleedOutAt = sim.time + 3;
  for (let index = 0; index < 30; index++) sim.zombies.set(`z${index}`, { id: `z${index}`, x: -3 + index % 6, y: 0, z: 3 + index % 2,
    hp: 80, maxHp: 80, scale: 1, kind: 'walker', entered: true, speed: 0, attackAfter: Infinity, doorId: 'west' });
  install(sim);
  const result = describeSituation(sim, bot.id, { order: { kind: 'hold' }, recent: ['Doors breaking; keep calm.'] });
  assert.ok(result.text.length <= TEXT_LIMIT);
  assert.ok(result.actions.length <= MAX_ACTIONS);
  assert.ok(result.text.includes(`YOUR PROFILE: ${companionProfilePrompt(bot.companionProfile)}`));
  assert.match(result.text, /NO AMMO:/);
  assert.match(result.text, /Jules \(human\): DOWN, .*3 s before elimination/);
  assert.ok(actionValues(result).includes('revive:human'));
  assert.match(result.text, /TEAM PLAN/);
  assert.match(result.text, /humans outrank the plan/);
  assert.ok(!result.text.endsWith('…'), 'critical lines fit without a final blind text cut');
});

test('the light guide describes personality as useful preferences while preserving emergency cooperation', () => {
  assert.ok(TACTICAL_GUIDE.split(/\s+/).length <= 350);
  for (const fact of ['courage', 'teamwork', 'aggression', 'never inactivity', 'No personality forbids emergencies', 'immediately override', 'rescue', 'escape danger'])
    assert.ok(TACTICAL_GUIDE.includes(fact), fact);
  for (const fact of ['actual aiming/reaction skills', 'without compulsory roles or purchases', 'Emergency cooperation overrides personality'])
    assert.ok(PLAN_GUIDE.includes(fact), fact);
});
