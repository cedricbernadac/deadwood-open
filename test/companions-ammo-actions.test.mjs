import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { describeSituation } from '../companions/situation.mjs';

function room() {
  const sim = new RoomSimulation('AMMOQA', { random: () => .5 });
  const human = sim.addPlayer('human', 'Jules');
  const bot = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(human.id);
  Object.assign(sim, { phase: 'wave', wave: 4, timeLeft: 999, toSpawn: 1, spawnTimer: 999 });
  sim.zombies.clear(); sim.spawnWarnings.clear();
  Object.assign(human, { x: 6, y: 0, z: 4 });
  Object.assign(bot, { x: -3, y: 0, z: 0, yaw: 0, pitch: 0, weapon: 'pistol', weaponId: 'pistol',
    inventory: { pistol: { ammo: 0, reserve: 0 } } });
  return { sim, human, bot };
}
function zombie(sim, id, x = -3, z = -1) {
  sim.zombies.set(id, { id, x, y: 0, z, hp: 80, maxHp: 80, kind: 'walker', scale: 1,
    entered: true, doorId: 'west', speed: 0, attackAfter: Infinity });
}
const values = result => result.actions.map(action => action.value);
const shooting = result => values(result).filter(value => value.startsWith('shoot:'));

test('a spent held gun offers neither shoot nor keep-shoot, even with a loaded alternate available', () => {
  const { sim, bot } = room();
  zombie(sim, 'target');
  bot.inventory.smg = { ammo: 40, reserve: 120 };
  const result = describeSituation(sim, bot.id, { order: { kind: 'shoot', zombieId: 'target' } });
  assert.deepEqual(shooting(result), []);
  assert.equal(values(result).includes('keep'), false);
  assert.ok(values(result).includes('weapon:smg'), 'switching is still the model choice, not an automatic replacement');
  assert.equal(bot.weapon, 'pistol');
  assert.equal(bot.inventory.smg.ammo, 40);
  assert.equal(values(result).includes('reload'), false);
});

test('shoot and keep-shoot disappear when the last real round is consumed and return when reserve is available', () => {
  const { sim, bot } = room();
  zombie(sim, 'target');
  bot.inventory.pistol.ammo = 1;
  const options = { order: { kind: 'shoot', zombieId: 'target' } };
  assert.ok(values(describeSituation(sim, bot.id, options)).includes('keep'));
  assert.deepEqual(shooting(describeSituation(sim, bot.id)), ['shoot:target']);
  assert.ok(sim.shoot(bot.id), 'production shooting consumes the last round');
  assert.equal(bot.inventory.pistol.ammo, 0);
  assert.equal(values(describeSituation(sim, bot.id, options)).includes('keep'), false);
  assert.deepEqual(shooting(describeSituation(sim, bot.id)), []);
  bot.inventory.pistol.reserve = 4;
  const reloadable = describeSituation(sim, bot.id, options);
  assert.ok(values(reloadable).includes('keep'), 'the body can reload before completing a shoot order');
  assert.ok(values(reloadable).includes('reload'));
  assert.deepEqual(shooting(reloadable), ['shoot:target']);
  assert.ok(sim.reload(bot.id));
  assert.deepEqual(shooting(describeSituation(sim, bot.id)), ['shoot:target'], 'an in-progress reload remains a viable shoot order');
});

test('ammo legality uses the held independent instance, while melee needs no ammunition', () => {
  const { sim, bot } = room();
  zombie(sim, 'target', -3, -1);
  bot.inventory = { pistol: { ammo: 12, reserve: 36 }, 'pistol-copy': { weapon: 'pistol', ammo: 0, reserve: 0 } };
  bot.weaponId = 'pistol-copy';
  assert.deepEqual(shooting(describeSituation(sim, bot.id)), [], 'a loaded duplicate cannot make the held empty instance fire');
  bot.inventory['pistol-copy'].reserve = 1;
  assert.deepEqual(shooting(describeSituation(sim, bot.id)), ['shoot:target']);
  Object.assign(bot, { weapon: 'bat', weaponId: 'bat', inventory: { bat: { ammo: 0, reserve: 0 } } });
  const melee = describeSituation(sim, bot.id, { order: { kind: 'shoot', zombieId: 'target' } });
  assert.deepEqual(shooting(melee), ['shoot:target']);
  assert.ok(values(melee).includes('keep'));
  assert.match(melee.actions.find(action => action.value === 'shoot:target').description, /^Attack/);
});

test('spent bullet, flame and rocket weapons cannot offer impossible shots', () => {
  const { sim, bot } = room();
  zombie(sim, 'target', -3, -1);
  for (const weapon of ['pistol', 'smg', 'flamethrower', 'rocket']) {
    Object.assign(bot, { weapon, weaponId: weapon, inventory: { [weapon]: { ammo: 0, reserve: 0 } } });
    const result = describeSituation(sim, bot.id, { order: { kind: 'shoot', zombieId: 'target' } });
    assert.deepEqual(shooting(result), [], weapon);
    assert.equal(values(result).includes('keep'), false, weapon);
  }
});

test('rescue, grenade, ammo collection and safe cover remain choices with a spent gun', () => {
  const { sim, human, bot } = room();
  bot.reviveKit = true; bot.grenades = 1;
  const mate = sim.addPlayer('mate', 'Papa');
  Object.assign(mate, { x: 5, y: 0, z: 4 });
  sim.damagePlayer(human, 1000, { id: 'test' });
  for (let index = 0; index < 3; index++) zombie(sim, `pack${index}`, -3 + index * .3, 4.5);
  sim.pickups.set('ammo', { id: 'ammo', kind: 'ammo', x: -2, y: 0, z: 1, expiresAt: sim.time + 90 });
  const result = describeSituation(sim, bot.id), choices = values(result);
  for (const value of ['revive:human', 'kit:human', 'collect:ammo', 'hold', 'loft', 'follow:mate']) assert.ok(choices.includes(value), value);
  assert.ok(choices.some(value => value.startsWith('grenade:')), 'grenades use their own inventory');
  assert.deepEqual(shooting(result), []);
  assert.ok(choices.some(value => value.startsWith('defend:')));
  for (const action of result.actions.filter(action => /^(hold|loft|follow:|defend:)/.test(action.value))) {
    assert.match(action.description, /No ammunition/);
    assert.doesNotMatch(action.description, /shoot|protect them/);
  }
  assert.ok(values(describeSituation(sim, bot.id, { order: { kind: 'collect', pickupId: 'ammo' } })).includes('keep'), 'a useful recovery is still continuable');
  assert.ok(values(describeSituation(sim, bot.id, { order: { kind: 'hold' } })).includes('keep'), 'safe cover does not require ammo');
});
