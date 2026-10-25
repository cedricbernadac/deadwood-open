import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { seededRandom } from '../validation/balance-report.mjs';
import { CHARACTER_BONUSES, characterStats } from '../public/character-bonuses.js';
import { characterBonusCatalogue, characterSummary, nextCharacterBonus } from '../companions/bonus-strategy.mjs';
import { describeTeamPlan, normalizeTeamPlan, planSignature, teamIntent } from '../companions/team-plan.mjs';
import { describeSituation, TEXT_LIMIT } from '../companions/situation.mjs';
import { rollCompanionProfile } from '../companions/profiles.mjs';
import { TACTICAL_GUIDE } from '../companion-brain/guide.mjs';

function room(wave = 4) {
  const sim = new RoomSimulation('GRENADIER', { random: seededRandom(20261018) });
  const human = sim.addPlayer('human', 'Jules');
  const bot = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(human.id);
  Object.assign(sim, { phase: 'wave', wave, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear(); sim.spawnWarnings.clear(); sim.beginSupplyWave();
  sim.doors.forEach(door => { if (!door.sealed) door.boards.fill(0); });
  Object.assign(bot, { x: -4, y: 0, z: 1, points: 2500,
    companionProfile: rollCompanionProfile('veteran', () => .5) });
  Object.assign(human, { x: 5, y: 0, z: 4 });
  return { sim, bot, human };
}
const answer = request => ({ choices: Object.fromEntries(request.questions.map(question => [question.name, question.choices[0].value])) });
const team = request => JSON.parse(request.situation.split('\n').find(line => line.startsWith('TEAM ')).slice(5));
const values = result => result.actions.map(action => action.value);
function pack(sim) {
  for (const [index, dx, dz] of [[0, 0, 0], [1, .6, .3], [2, -.4, .5]]) {
    const enemy = Object.assign(sim.spawnZombie(), { x: -4 + dx, y: 0, z: -4.5 + dz,
      hp: 80, maxHp: 80, scale: 1, kind: 'walker', entered: true, speed: 0, attackAfter: Infinity });
    sim.zombies.delete(enemy.id); enemy.id = `pack${index}`; sim.zombies.set(enemy.id, enemy);
  }
}

test('Grenadier enters the canonical catalogue, cumulative cadence/cap/damage ladder and strategic inventory', () => {
  const expected = { grenadeIntervalSeconds: [20, 20, 17, 17, 14, 14, 12, 10], maxGrenades: [2, 2, 3, 3, 3, 4, 4, 5],
    grenadeDamageBonusPercent: [0, 10, 10, 20, 20, 30, 40, 50] };
  assert.deepEqual(CHARACTER_BONUSES.grenadier.effects, expected);
  assert.deepEqual(characterBonusCatalogue().find(item => item.id === 'grenadier'), { id: 'grenadier', effects: expected });
  const { sim, bot } = room();
  bot.bonus = { grenadier: 6 }; bot.grenades = 3;
  const request = describeTeamPlan(sim), mine = team(request).find(person => person.id === bot.id);
  assert.equal(mine.grenades, 3); assert.equal(mine.character.grenadeEverySec, 14); assert.equal(mine.character.grenadeCap, 4);
  assert.equal(mine.character.grenadeDamage, 1.3);
  assert.match(request.situation, /cap rises at N3\/6\/8/);
  assert.match(request.situation, /First after a full interval, never instant or banked at cap/);
  assert.match(request.situation, /Pause freezes; practice\/downed\/dead inactive/);
  assert.match(request.situation, /Damage fixed at throw, grenades only; no larger blast or rockets/);
  assert.ok(request.questions.find(question => question.name === 'bot0_bonus').choices.some(choice => choice.value === 'grenadier'));
  assert.ok(request.situation.length < 16000);
});

test('Grenadier is a flexible closed bonus goal, invalidates old builds and disappears at N8', () => {
  const { sim, bot } = room();
  const request = describeTeamPlan(sim), result = answer(request);
  result.choices.bot0_bonus = 'grenadier';
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, result);
  assert.ok(sim.companionTeamPlan); assert.equal(sim.companionTeamPlan.assignments[0].bonus, 'grenadier');
  assert.match(teamIntent(sim, bot.id), /preferred crate bonus grenadier/);
  assert.match(teamIntent(sim, bot.id), /Rescue, immediate danger, ammunition and humans outrank the plan/);
  const action = describeSituation(sim, bot.id).actions.find(item => item.value === 'claim:grenadier');
  assert.ok(action); assert.match(action.description, /Planned bonus/); assert.match(action.description, /every 20 s/); assert.match(action.description, /capacity 2/);
  const before = planSignature(sim); bot.bonus = { grenadier: 8 };
  assert.notEqual(planSignature(sim), before);
  assert.equal(normalizeTeamPlan(sim, request, result), null);
  assert.ok(!describeTeamPlan(sim).questions.find(question => question.name === 'bot0_bonus').choices.some(choice => choice.value === 'grenadier'));
  assert.ok(!values(describeSituation(sim, bot.id)).includes('claim:grenadier'));
});

test('Grenadier SELF and next claims explain effective capacity and cadence at all eight levels', () => {
  const { sim, bot } = room();
  for (let level = 1; level <= 8; level++) {
    bot.bonus = { grenadier: level }; bot.grenades = 1;
    const stats = characterStats(bot), summary = characterSummary(bot, sim), next = nextCharacterBonus(bot, 'grenadier');
    assert.ok(summary.includes(`grenades 1/${stats.maxGrenades}`));
    assert.ok(summary.includes(`+1 every ${stats.grenadeIntervalSeconds}s active time; no bank at cap`));
    assert.ok(summary.includes(`grenade damage x${stats.grenadeDamageMultiplier}`));
    assert.match(summary, new RegExp(`next in ${stats.grenadeIntervalSeconds}s`));
    const upgraded = characterStats({ grenadier: Math.min(8, level + 1) });
    assert.ok(next.includes(`every ${upgraded.grenadeIntervalSeconds} s`)); assert.ok(next.includes(`capacity ${upgraded.maxGrenades}`));
    assert.ok(next.includes(`+${CHARACTER_BONUSES.grenadier.effects.grenadeDamageBonusPercent[Math.min(7, level)]} % grenade damage`));
    const situation = describeSituation(sim, bot.id);
    assert.ok(situation.text.includes(summary)); assert.ok(situation.text.length <= TEXT_LIMIT);
  }
  bot.grenades = 5;
  assert.doesNotMatch(characterSummary(bot, sim), /next in/);
  delete bot.bonus.grenadier;
  assert.equal(characterSummary(bot, sim), '', 'legacy builds gain no fictional regenerative skill');
});

test('grenades remain a loaded-gun pack choice, with dynamic cap, dry alternatives and urgent human rescue', () => {
  const { sim, bot, human } = room();
  bot.bonus = { grenadier: 8 }; bot.grenades = 5; pack(sim);
  const request = describeTeamPlan(sim); sim.companionTeamPlan = normalizeTeamPlan(sim, request, answer(request));
  let situation = describeSituation(sim, bot.id);
  assert.ok(values(situation).some(value => value.startsWith('shoot:')), 'loaded gun still offers ordinary shooting');
  const grenade = situation.actions.find(action => action.value.startsWith('grenade:'));
  assert.ok(grenade, 'an available grenade does not wait for an empty gun');
  assert.match(grenade.description, /pack of 3/); assert.match(grenade.description, /you carry 5\/5/);
  assert.match(grenade.description, /675 damage within 2 m/, 'only effective damage increases, not blast radius');
  bot.inventory.pistol.ammo = 0; bot.inventory.pistol.reserve = 0;
  sim.damagePlayer(human, 1000, { id: 'fixture' });
  situation = describeSituation(sim, bot.id);
  assert.ok(values(situation).includes('revive:human')); assert.ok(values(situation).includes('loft'));
  assert.ok(values(situation).some(value => value.startsWith('grenade:')));
  assert.ok(!values(situation).some(value => value.startsWith('shoot:')));
  assert.ok(TACTICAL_GUIDE.includes('spend grenades on packs, even with loaded guns'));
  assert.ok(TACTICAL_GUIDE.split(/\s+/).length <= 350);
  sim.zombies.delete('pack1'); sim.zombies.delete('pack2');
  assert.ok(!values(describeSituation(sim, bot.id)).some(value => value.startsWith('grenade:')), 'regeneration does not force waste on a lone target');
});

test('the station can refill the expanded Grenadier capacity and stops at the actual cap', () => {
  const { sim, bot } = room(15);
  // Keep a short menu with the fully claimed crate and repaired doors.
  sim.supplyCrate.claimed.add(bot.id); sim.doors.forEach(door => { if (!door.sealed) door.boards.fill(60); });
  bot.bonus = { grenadier: 8 }; bot.grenades = 4;
  let action = describeSituation(sim, bot.id).actions.find(item => item.value === 'supply:grenade');
  assert.ok(action); assert.match(action.description, /you carry 4\/5/);
  bot.grenades = 5;
  assert.ok(!values(describeSituation(sim, bot.id)).includes('supply:grenade'));
  bot.bonus = null; bot.grenades = 2;
  assert.ok(!values(describeSituation(sim, bot.id)).includes('supply:grenade'), 'ordinary survivors retain the base capacity');
});
