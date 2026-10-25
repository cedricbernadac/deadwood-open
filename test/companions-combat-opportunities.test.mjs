import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { FLAMETHROWER, playerEyeHeight } from '../public/rules.js';
import { describeSituation, TEXT_LIMIT, MAX_ACTIONS } from '../companions/situation.mjs';
import { piercingOpportunity, flameCoverageAt, carriedCombatOpportunities } from '../companions/combat-opportunities.mjs';
import { GUIDE, TACTICAL_GUIDE, PLAN_GUIDE } from '../companion-brain/guide.mjs';

function room() {
  const events = [], sim = new RoomSimulation('COMBATQA', { random: () => .5, onEvent: event => events.push(event) });
  const human = sim.addPlayer('human', 'Jules'), bot = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(human.id); Object.assign(sim, { phase: 'wave', wave: 10, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear(); sim.spawnWarnings.clear();
  Object.assign(bot, { x: -4, y: 0, z: 3, weapon: 'smg', weaponId: 'smg',
    inventory: { smg: { ammo: 40, reserve: 120 }, flamethrower: { ammo: 80, reserve: 40 } } });
  Object.assign(human, { x: 6, y: 0, z: 4 });
  return { sim, bot, human, events };
}
function enemy(sim, id, x, z, extra = {}) {
  const zombie = Object.assign(sim.spawnZombie(), { id, x, y: 0, z, hp: 10000, maxHp: 10000, scale: 1,
    entered: true, kind: 'walker', boss: false, speed: 0, attackAfter: Infinity, ...extra });
  // spawnZombie installs under its generated id; replace that map entry.
  for (const [key, value] of sim.zombies) if (value === zombie) sim.zombies.delete(key);
  sim.zombies.set(id, zombie); return zombie;
}
const view = sim => [...sim.zombies.values()].map(zombie => ({ zombie, seen: true }));
const values = result => result.actions.map(action => action.value);
function cluster(sim) {
  return Array.from({ length: 8 }, (_, index) => enemy(sim, `crowd${index}`, -4 + (index % 4 - 1.5) * .3, -1 + (Math.floor(index / 4) - .5) * .4));
}

test('one or two isolated enemies expose small flame cones and preserve the usable ordinary gun choice', () => {
  for (const count of [1, 2]) {
    const { sim, bot } = room();
    enemy(sim, 'isolated1', -4, -1); if (count === 2) enemy(sim, 'isolated2', -1.8, -.8);
    const facts = carriedCombatOpportunities(sim, bot, view(sim)).find(fact => fact.weapon === 'flamethrower');
    assert.ok(facts.best.count >= 1 && facts.best.count <= 2);
    const before = bot.weaponId, result = describeSituation(sim, bot.id);
    assert.ok(values(result).includes('weapon:flamethrower'), 'fuel conservation is a preference, not a forbidden emergency alternative');
    assert.ok(values(result).some(value => value.startsWith('shoot:')));
    assert.match(result.actions.find(action => action.value === 'weapon:flamethrower').description, /80\/80 \+40; 6m flame cone: [12] visible exposed bodies/);
    assert.equal(bot.weaponId, before, 'describing an opportunity never switches weapons');
  }
  for (const guide of [GUIDE, TACTICAL_GUIDE, PLAN_GUIDE]) assert.ok(guide.includes('1-2 isolated'));
});

test('a compact exposed group gives the model a large flame cone and real fuel, without forcing a switch', () => {
  const { sim, bot } = room(); cluster(sim);
  let result = describeSituation(sim, bot.id);
  assert.match(result.actions.find(action => action.value === 'weapon:flamethrower').description, /6m flame cone: 8 visible exposed bodies/);
  assert.match(result.text, /COMBAT FIT/); assert.match(result.text, /flamethrower 80\+40/);
  assert.equal(bot.weapon, 'smg');
  bot.weapon = 'flamethrower'; bot.weaponId = 'flamethrower'; result = describeSituation(sim, bot.id);
  const shoots = result.actions.filter(action => action.value.startsWith('shoot:'));
  assert.ok(shoots.length > 0); assert.ok(shoots.every(action => /8 visible exposed bodies in flame cone/.test(action.description)));
  assert.ok(values(result).includes('weapon:smg'));
  assert.ok(result.text.length <= TEXT_LIMIT); assert.ok(result.actions.length <= MAX_ACTIONS);
});

test('many scattered enemies do not become a fictitious large flame group just because the room total is high', () => {
  const { sim, bot } = room(); Object.assign(bot, { x: 0, z: 0 });
  const observed = Array.from({ length: 12 }, (_, index) => {
    const angle = index * Math.PI / 6;
    return enemy(sim, `scattered${index}`, Math.sin(angle) * 4.5, Math.cos(angle) * 4.5);
  });
  for (const target of observed) {
    const point = { x: target.x, y: 1.2, z: target.z };
    assert.ok(flameCoverageAt(sim, bot, point, observed).count <= 2);
  }
});

test('flame coverage agrees with a real engine shot, including nonstacking burns and the unchanged range edge', () => {
  const { sim, bot, events } = room(), observed = cluster(sim);
  observed.push(enemy(sim, 'too-far', -4, -3.2));
  const origin = { x: bot.x, y: bot.y + playerEyeHeight(bot), z: bot.z }, point = { x: -4, y: 1.2, z: -1 };
  const predicted = flameCoverageAt(sim, bot, point, observed);
  assert.equal(predicted.count, 8); assert.ok(!predicted.ids.includes('too-far'));
  bot.yaw = Math.atan2(-(point.x - origin.x), -(point.z - origin.z));
  bot.pitch = Math.atan2(point.y - origin.y, Math.hypot(point.x - origin.x, point.z - origin.z));
  sim.shootFlame(bot, origin);
  const shot = events.findLast(event => event.event === 'shot' && event.weapon === 'flamethrower');
  assert.equal(shot.hits, predicted.count, 'the read-only count is checked against authoritative collision/damage resolution');
  assert.equal(flameCoverageAt(sim, bot, point, observed).burning, 8);
  const edge = enemy(sim, 'edge', -4, bot.z - FLAMETHROWER.range);
  assert.equal(flameCoverageAt(sim, bot, { x: edge.x, y: origin.y, z: edge.z }, [edge]).count, 0, 'zero-strength outer edge is not advertised as a hit');
});

test('walls, floors and unseen contacts never inflate the model flame or piercing opportunities', () => {
  const { sim, bot } = room(); Object.assign(bot, { x: 0, z: 0 });
  const front = enemy(sim, 'visible-front', 0, -1), hidden = enemy(sim, 'hidden-behind-partition', 0, -3.6);
  for (let index = 0; index < 8; index++) enemy(sim, `hidden${index}`, -.5 + index * .12, -3.6);
  const result = describeSituation(sim, bot.id);
  assert.doesNotMatch(result.text, /hidden-behind-partition|hidden[0-7]/);
  assert.ok(!values(result).some(value => value.includes('hidden')));
  assert.match(result.actions.find(action => action.value === 'weapon:flamethrower').description, /cone: 1 visible exposed/);
  assert.equal(piercingOpportunity(sim, bot, front, [front, hidden], sim.weaponProfile(bot, 'smg')).count, 1);
  const above = enemy(sim, 'above-floor', 0, -.7, { y: 3.4 });
  assert.equal(flameCoverageAt(sim, bot, { x: front.x, y: 1.2, z: front.z }, [front, above]).count, 1);
});

test('piercing line counts use the actual carried bonus, hitboxes and range instead of multiplying single-target damage', () => {
  const { sim, bot } = room(); Object.assign(bot, { x: -4, z: 4 });
  const observed = [2, 0, -1, -2.5].map((z, index) => enemy(sim, `line${index}`, -4, z));
  const base = sim.weaponProfile(bot, 'smg');
  assert.equal(piercingOpportunity(sim, bot, observed[0], observed, base).count, 2);
  bot.bonus = { perforating: 8 };
  const upgraded = sim.weaponProfile(bot, 'smg'); assert.equal(upgraded.penetrationTargets, 5);
  const line = piercingOpportunity(sim, bot, observed[0], observed, upgraded);
  assert.equal(line.count, 4); assert.equal(line.behind, 3); assert.equal(line.first, 'line0');
  assert.equal(piercingOpportunity(sim, bot, observed[0], observed, { ...upgraded, range: 3.5 }).count, 1);
  const result = describeSituation(sim, bot.id), shoot = result.actions.find(action => action.value === 'shoot:line0');
  assert.match(shoot.description, /3 more lined up behind it \(your gun pierces 5\)/);
  assert.ok(TACTICAL_GUIDE.includes('Use doors/stairs for piercing lines; aim at the front'));
  assert.ok(TACTICAL_GUIDE.split(/\s+/).length <= 350);
});

test('empty fuel never becomes an available switch and urgent human rescue remains present beside combat information', () => {
  const { sim, bot, human } = room(); cluster(sim); bot.inventory.flamethrower = { ammo: 0, reserve: 0 };
  sim.damagePlayer(human, 1000, { id: 'fixture' }); bot.reviveKit = true;
  const result = describeSituation(sim, bot.id);
  assert.ok(!values(result).includes('weapon:flamethrower'));
  assert.ok(values(result).includes('revive:human')); assert.ok(values(result).includes('kit:human'));
  assert.ok(values(result).includes('hold')); assert.ok(values(result).includes('loft'));
  assert.ok(result.text.length <= TEXT_LIMIT); assert.ok(result.actions.length <= MAX_ACTIONS);
});
