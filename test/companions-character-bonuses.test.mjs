import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomSimulation } from '../simulation.mjs';
import { CHARACTER_BONUSES, characterStats } from '../public/character-bonuses.js';
import { SUPPLY_BONUSES } from '../public/weapon-upgrades.js';
import { describeTeamPlan, normalizeTeamPlan, planSignature } from '../companions/team-plan.mjs';
import { characterBonusCatalogue } from '../companions/bonus-strategy.mjs';
import { describeSituation } from '../companions/situation.mjs';
import { describeRecon } from '../companions/recon.mjs';
import { rainCost } from '../companions/outdoors.mjs';
import { createCompanionBody } from '../companions/body.mjs';
import { rollCompanionProfile } from '../companions/profiles.mjs';
import { seededRandom } from '../validation/balance-report.mjs';

function room() {
  const events = [], sim = new RoomSimulation('BONUSQA', { random: seededRandom(20261017), onEvent: event => events.push(event) });
  sim.addPlayer('bootstrap', 'Setup');
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  const lea = sim.addPlayer('lea', 'Lea', undefined, { companion: true });
  sim.removePlayer('bootstrap'); sim.start(null);
  Object.assign(sim, { phase: 'wave', wave: 4, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear(); sim.spawnWarnings.clear(); sim.beginSupplyWave();
  max.companionProfile = rollCompanionProfile('veteran', () => .5);
  lea.companionProfile = rollCompanionProfile('timid', () => .5);
  const bodies = [max, lea].map((player, index) => createCompanionBody(sim, player.id, { random: seededRandom(70 + index) }));
  function run(seconds, until = () => false) {
    for (let index = 0; index < Math.round(seconds * 30); index++) {
      bodies.forEach(body => body.tick(1 / 30)); sim.tick(1 / 30);
      if (until()) return true;
    }
    return false;
  }
  return { sim, max, lea, bodies, events, run };
}
const values = result => result.actions.map(action => action.value);
const answers = request => ({ choices: Object.fromEntries(request.questions.map(question => [question.name, question.choices[0].value])) });

test('strategic character ladders preserve the approved catalogue, with all bonus choices and effective teammate stats', () => {
  const approved = JSON.parse(readFileSync(new URL('../validation/character-bonus-catalog-2026-10-17.json', import.meta.url), 'utf8'));
  const byId = (a, b) => a.id.localeCompare(b.id);
  assert.deepEqual(characterBonusCatalogue().sort(byId), approved.definitions.map(({ id, effects }) => ({ id, effects })).sort(byId));
  const { sim, max } = room();
  max.bonus = { vitality: 4, reload: 8, medic: 8, frostaura: 4, switching: 8 };
  const request = describeTeamPlan(sim);
  const people = JSON.parse(request.situation.split('\n').find(line => line.startsWith('TEAM ')).slice(5));
  const mine = people.find(player => player.id === max.id);
  assert.equal(mine.character.maxHp, 140); assert.equal(mine.character.reload, .5); assert.equal(mine.character.reviveSec, 2);
  assert.equal(mine.character.dual, true);
  assert.equal(request.questions.find(question => question.name === 'bot0_bonus').choices.length, Object.keys(SUPPLY_BONUSES).filter(kind => (max.bonus[kind] ?? 0) < 8).length + 1);
  assert.ok(!request.questions.find(question => question.name === 'bot0_bonus').choices.some(choice => choice.value === 'reload'), 'a maxed bonus is not a future claim objective');
  assert.match(request.situation, /strongest aura only/); assert.match(request.situation, /wave 2-18/);
  const before = planSignature(sim); max.bonus.vitality++;
  assert.notEqual(planSignature(sim), before, 'a changed build can revise roles and bonus goals');
  assert.equal(normalizeTeamPlan(sim, request, answers(request)), null, 'old build plans do not attach after a stat change');
});

test('new bonus claims describe next effect, inactive crates cannot retain claims, and medic/vitality alter actionable needs', () => {
  const { sim, max, lea } = room();
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  Object.assign(max, { x: -4, y: 0, z: 0, hp: 90, bonus: { vitality: 4, medic: 4, frostaura: 4 } });
  Object.assign(lea, { x: 3, y: 0, z: 0 }); sim.damagePlayer(lea, 1000, { id: 'fixture' });
  sim.pickups.set('health', { id: 'health', kind: 'health', x: -4, y: 0, z: 1, expiresAt: sim.time + 90 });
  let result = describeSituation(sim, max.id);
  assert.match(result.text, /HP 90\/140/); assert.match(result.text, /frost 3m -18% movement/);
  assert.ok(values(result).includes('collect:health'), '90/140 is hurt despite exceeding the old 70 HP cutoff');
  assert.match(result.actions.find(action => action.value === 'revive:lea').description, /3.6 s/);
  for (const kind of Object.keys(CHARACTER_BONUSES)) assert.ok(values(result).includes(`claim:${kind}`), kind);
  assert.match(result.actions.find(action => action.value === 'claim:vitamins').description, /\+3 % movement speed/);
  sim.supplyCrate.active = false;
  result = describeSituation(sim, max.id, { order: { kind: 'claim', bonus: 'vitamins' } });
  assert.equal(values(result).some(value => value.startsWith('claim:')), false); assert.equal(values(result).includes('keep'), false);
  assert.match(result.text, /inactive/);
});

test('rain-trip estimates use effective movement and rain protection instead of flat base damage', () => {
  const { sim, max } = room(); max.umbrella.remaining = 0;
  const base = rainCost(sim, max, 12);
  max.bonus = { vitamins: 8, rainproof: 8 };
  const improved = rainCost(sim, max, 12);
  assert.ok(improved.seconds < base.seconds); assert.ok(improved.burn < base.burn * .3);
});

test('personal recon reveals only each unlocked tier and ignores contacts beyond 25m', () => {
  const { sim, max } = room(); Object.assign(max, { x: 0, y: 0, z: 0 });
  sim.zombies.set('secret-id', { id: 'secret-id', x: 12, y: 3.4, z: 3, kind: 'brute', hp: 37, maxHp: 80 });
  assert.equal(describeRecon(sim, max), '');
  for (let level = 1; level <= 8; level++) {
    max.bonus = { radar: level };
    const text = describeRecon(sim, max);
    assert.doesNotMatch(text, /secret-id/);
    assert.equal(/contact 1:/.test(text), level >= 3);
    assert.equal(/brute/.test(text), level >= 5);
    assert.equal(/loft/.test(text), level >= 6);
    assert.equal(/health about 50%/.test(text), level === 7);
    assert.equal(/HP 37\/80/.test(text), level === 8);
    if (level === 1) assert.match(text, /location and identity unknown/);
    if (level === 2) assert.match(text, /presence in sectors/);
    const situation = describeSituation(sim, max.id);
    assert.doesNotMatch(situation.text, /secret-id|37% hp/, 'invisible enemies are not printed by the normal visual survey');
  }
  sim.zombies.get('secret-id').hp = 37.375; sim.time += .21;
  assert.match(describeRecon(sim, max), /HP 37.375\/80/, 'N8 does not quantize current HP to a coarse or integer bar');
  sim.zombies.get('secret-id').x = 26; sim.time += .21;
  assert.match(describeRecon(sim, max), /no nearby presence/);
});

test('recon contacts remain pulse memories, not live tracking between refreshes', () => {
  const { sim, max } = room(); Object.assign(max, { x: 0, y: 0, z: 0, bonus: { radar: 3 } });
  const enemy = { id: 'hidden', x: 10, y: 0, z: 0, kind: 'walker', hp: 80, maxHp: 80 }; sim.zombies.set(enemy.id, enemy);
  assert.match(describeRecon(sim, max), /10m E/);
  enemy.x = -10; sim.time += 1;
  assert.match(describeRecon(sim, max), /10m E/);
  sim.time = 6.1;
  assert.match(describeRecon(sim, max), /10m W/);
});

test('door repair hints and the visual enemy summary never reveal hidden raider counts without recon', () => {
  const { sim, max } = room();
  Object.assign(max, { x: 5, y: 0, z: -4, bonus: null });
  const west = sim.doors.find(door => door.id === 'west'); west.sealed = false; west.boards[0] = 0;
  Object.assign(sim.spawnZombie(), { x: -8.8, y: 0, z: 0, kind: 'raider', hp: 100, maxHp: 100 });
  Object.assign(sim.spawnZombie(), { x: 5, y: 0, z: -4.8, kind: 'walker', hp: 100, maxHp: 100 });
  const result = describeSituation(sim, max.id);
  const repair = result.actions.find(action => action.value === 'repair:west');
  assert.ok(repair);
  assert.doesNotMatch(repair.description, /enemies? at it/);
  const visual = result.text.split('\n').find(line => line.startsWith('ENEMIES,'));
  assert.ok(visual); assert.doesNotMatch(visual, /raider/);
  assert.doesNotMatch(result.text, /more \(unobserved/);
});

test('dual mode is optional at N8, keeps usable secondary fire and preserves reload and rescue choices', () => {
  const { sim, max, lea } = room();
  max.inventory.smg = { ammo: 5, reserve: 20 }; max.bonus = { switching: 7 };
  assert.equal(values(describeSituation(sim, max.id)).includes('dual:smg'), false);
  max.bonus.switching = 8;
  assert.ok(values(describeSituation(sim, max.id)).includes('dual:smg')); assert.equal(max.dualWield, false, 'offering a pair never activates it');
  assert.ok(sim.setDualWield(max.id, true, 'smg'));
  max.inventory.pistol = { ammo: 0, reserve: 0 };
  const target = Object.assign(sim.spawnZombie(), { x: max.x, y: 0, z: max.z - 1, hp: 80, maxHp: 80, speed: 0, entered: true, attackAfter: Infinity });
  let result = describeSituation(sim, max.id);
  assert.ok(values(result).includes(`shoot:${target.id}`)); assert.match(result.text, /PRIMARY EMPTY/);
  assert.ok(values(result).includes('dual:off')); assert.ok(values(result).includes('reload'), 'secondary reserve can reload independently of an empty primary');
  sim.damagePlayer(lea, 1000, { id: 'fixture' }); result = describeSituation(sim, max.id);
  assert.ok(values(result).includes('revive:lea'));
  max.inventory.smg = { ammo: 0, reserve: 0 };
  assert.equal(values(describeSituation(sim, max.id)).some(value => value.startsWith('shoot:')), false, 'both exhausted hands cannot shoot');
});

test('two production bot bodies claim outdoors, recover a dropped bonus, dual fire independently and perform an urgent revive', t => {
  const { sim, max, lea, bodies, events, run } = room();
  sim.doors.forEach(door => { if (!door.sealed) door.boards.fill(0); });
  bodies[0].setOrder({ kind: 'claim', bonus: 'reload' });
  assert.ok(run(30, () => bodies[0].status === 'done'), 'veteran completes the real outdoor crate trip');
  assert.equal(max.bonus.reload, 1); assert.ok(Math.abs(max.x) < 8 && Math.abs(max.z) < 6);
  bodies[1].setOrder({ kind: 'claim', bonus: 'vitamins' });
  assert.ok(run(30, () => bodies[1].status === 'done'), 'timid companion also completes a safe crate trip');
  assert.equal(lea.bonus.vitamins, 1);
  assert.equal(characterStats(max).reloadMultiplier, .9); assert.equal(characterStats(lea).speedMultiplier, 1.03);
  const drop = { id: 'recovered', kind: 'bonus', x: max.x + .3, y: 0, z: max.z, bonus: { kind: 'medic', level: 8 }, expiresAt: sim.time + 90 };
  sim.pickups.set(drop.id, drop); bodies[0].setOrder({ kind: 'collect', pickupId: drop.id });
  assert.ok(run(3, () => bodies[0].status === 'done')); assert.equal(max.bonus.medic, 8); assert.equal(sim.pickups.has(drop.id), false);
  max.bonus.switching = 8; max.inventory.smg = { ammo: 40, reserve: 120 };
  Object.assign(max, { x: -4, y: 0, z: 3, hp: 100 }); Object.assign(lea, { x: 5, y: 0, z: -4 });
  assert.ok(values(describeSituation(sim, max.id)).includes('dual:smg'));
  bodies[0].setOrder({ kind: 'dual', weapon: 'smg' }); run(.1); assert.equal(max.dualWield, true);
  const enemy = Object.assign(sim.spawnZombie(), { x: -1, y: 0, z: 3, hp: 100000, maxHp: 100000, speed: 0, entered: true, attackAfter: Infinity });
  bodies[0].setOrder({ kind: 'shoot', zombieId: enemy.id }); run(5);
  const shots = events.filter(event => event.event === 'shot' && event.id === max.id), primary = shots.filter(event => event.hand !== 'secondary'), secondary = shots.filter(event => event.hand === 'secondary');
  assert.ok(primary.length > 0, JSON.stringify({body:bodies[0].status,at:[max.x,max.y,max.z],weapon:max.weapon,stock:max.inventory,enemy:[enemy.kind,enemy.x,enemy.y,enemy.z],shots:shots.length})); assert.ok(secondary.length > primary.length, 'SMG and pistol keep independent legal cadences');
  sim.zombies.clear(); Object.assign(lea, { x: max.x, y: 0, z: max.z - 1 }); sim.damagePlayer(lea, 1000, { id: 'fixture' });
  assert.ok(values(describeSituation(sim, max.id)).includes('revive:lea'), 'dual mode never hides emergency rescue');
  bodies[0].setOrder({ kind: 'revive', playerId: lea.id });
  assert.ok(run(6, () => !lea.downed), JSON.stringify({message:'N8 medic completes the authoritative manual revive',at:[max.x,max.y,max.z],mate:[lea.x,lea.y,lea.z],status:bodies[0].status,revives:events.filter(e=>['revive-start','revive-stop','revive'].includes(e.event)),channel:max.reviving,phase:sim.phase}));
  t.diagnostic(JSON.stringify({scope:'prepared decisions, two real bodies, no model/server/human',claims:events.filter(event=>event.event==='supply-claimed').map(({id,bonus,level})=>({id,bonus,level})),primaryShots:primary.length,secondaryShots:secondary.length,revived:!lea.downed}));
});
