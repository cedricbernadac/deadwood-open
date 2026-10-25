import { advanceBallisticFlight, settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, WORLD, damageFalloff } from '../simulation.mjs';
import { waveBalance } from '../public/rules.js';

function combat(weapon = 'rifle') {
  const events = [];
  const simulation = new RoomSimulation('COMBAT', { random: () => 0.5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a', 'Alice', weapon);
  simulation.start('a');
  player.weapon = weapon;
  player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
  // Keep the line inside the cabin and through its western partition opening.
  Object.assign(player, { x: -4.4, y: 0, z: 4, yaw: 0, pitch: 0 });
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
  return { simulation, player, events };
}

function zombie(simulation, id, options = {}) {
  const target = { id, x: -4.4, y: 0.4, z: 1, hp: 1000, maxHp: 1000, kind: 'walker', ...options };
  assert.equal(simulation.canOccupy(target, target.x, target.z, target.y, .29), true, `${id} must occupy clear floor space`);
  simulation.zombies.set(id, target);
  return target;
}

// Damage of one round entering a target box `distance` metres from the eye.
const at = (weapon, distance) => WEAPONS[weapon].damage * damageFalloff(WEAPONS[weapon], distance);

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < .01, `Expected ${actual} to equal ${expected}`);
}
// The score is the useful damage (owner, 18 October): whole points, the
// fraction of a point carried to the next hit.
const points = removed => Math.floor(removed.reduce((sum, amount) => sum + amount, 0) + 1e-9);

test('rifle penetrates three aligned bodies with decreasing damage, then stops', () => {
  const { simulation, player, events } = combat();
  const targets = [1, -1, -3, -4].map((z, index) => zombie(simulation, `z${index}`, { z }));
  assert.equal(simulation.shoot(player.id), true);
  assert.equal(simulation.shoot(player.id), false);
  advanceBallisticFlight(simulation, .08);
  close(targets[0].hp, 1000 - at('rifle', 2.68));
  close(targets[1].hp, 1000 - at('rifle', 4.68) * .65);
  close(targets[2].hp, 1000 - at('rifle', 6.68) * .65 ** 2);
  assert.equal(targets[3].hp, 1000);
  const removed = targets.slice(0, 3).map(target => 1000 - target.hp);
  assert.equal(player.score, points(removed), 'the score is the damage really dealt');
  assert.equal(player.inventory.rifle.ammo, WEAPONS.rifle.magazine - 1);
  const shot = { hits: events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie' && !event.visualOnly).length, kills: events.filter(event => event.event === 'kill').length };
  assert.equal(shot.hits, 3);
  assert.equal(shot.kills, 0);
  assert.equal(player.score, points(removed), 'The cooldown refusal before flight added no hit');
});

test('penetration resolves physical order even when the farthest zombie was inserted first', () => {
  const { simulation, player } = combat();
  const fourth = zombie(simulation, 'fourth', { z: -4 });
  const third = zombie(simulation, 'third', { z: -3 });
  const second = zombie(simulation, 'second', { z: -1 });
  const first = zombie(simulation, 'first', { z: 1 });
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  close(first.hp, 1000 - at('rifle', 2.68));
  close(second.hp, 1000 - at('rifle', 4.68) * .65);
  close(third.hp, 1000 - at('rifle', 6.68) * .65 ** 2);
  assert.equal(fourth.hp, 1000);
});

test('every penetrated target independently receives its headshot multiplier; kills score only the health they had left', () => {
  const { simulation, player, events } = combat();
  const head = zombie(simulation, 'head', { y: 0, z: 1, hp: 50 });
  const body = zombie(simulation, 'body', { y: 0.4, z: -1, hp: 19 });
  const rearHead = zombie(simulation, 'rear-head', { y: 0, z: -3, hp: 21 });
  const headMultiplier = waveBalance(simulation.wave, simulation.players.size).headshotMultiplier;
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  close(head.hp, 50 - at('rifle', 2.68) * headMultiplier);
  close(body.hp, 19 - at('rifle', 4.68) * .65);
  close(rearHead.hp, 21 - at('rifle', 6.68) * 0.65 ** 2 * headMultiplier);
  assert.equal(simulation.zombies.size, 0);
  assert.equal(player.kills, 3);
  assert.equal(player.score, 50 + 19 + 21 + 25 + 50, 'No overkill and no kill score: the health they had, plus the 25/50 kill-chain bonuses');
  assert.deepEqual(events.filter(event => event.event === 'kill').map(event => [event.zombieId, event.headshot]), [
    ['head', true], ['body', false], ['rear-head', true],
  ]);
});

test('an exterior wall stops penetration after the visible target', () => {
  const { simulation, player, events } = combat();
  Object.assign(player, { x: 3, z: -3 });
  const visible = zombie(simulation, 'visible', { x: 3, z: -5 });
  const hidden = zombie(simulation, 'hidden', { x: 3, z: -8 });
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  close(visible.hp, 1000 - at('rifle', 1.68));
  assert.equal(hidden.hp, 1000);
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie' && !event.visualOnly).length, 1);
});

test('the loft floor stops a downward bullet after an upstairs target', () => {
  const { simulation, player, events } = combat();
  Object.assign(player, { x: 5, y: WORLD.loftY, z: 1, pitch: -Math.PI / 2 });
  const upstairs = zombie(simulation, 'upstairs', { x: 5, y: WORLD.loftY, z: 1 });
  const downstairs = zombie(simulation, 'downstairs', { x: 5, y: 0, z: 1 });
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  assert.ok(upstairs.hp < 1000);
  assert.equal(downstairs.hp, 1000);
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie' && !event.visualOnly).length, 1);
});

test('a level bullet reaches the ground before the end of its free-flight range', () => {
  const { simulation, player } = combat();
  // A range test needs unobstructed ground beyond the exterior wall.
  Object.assign(player, { x: -40, z: -25, yaw: -Math.PI / 2 });
  const inRange = zombie(simulation, 'inside', { x: player.x + WEAPONS.rifle.range - .1, z: player.z });
  const outOfRange = zombie(simulation, 'outside', { x: player.x + WEAPONS.rifle.range + .5, z: player.z });
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  settleBallisticFlight(simulation);
  assert.equal(inRange.hp, 1000, 'gravity stops this level shot before a very distant body');
  assert.equal(outOfRange.hp, 1000);
});

test('SMG rounds penetrate at most two zombies with stronger damage loss', () => {
  const { simulation, player, events } = combat('smg');
  const targets = [1, -1, -3].map((z, index) => zombie(simulation, `z${index}`, { z }));
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  close(targets[0].hp, 1000 - at('smg', 2.68));
  close(targets[1].hp, 1000 - at('smg', 4.68) * 0.55);
  assert.equal(targets[2].hp, 1000);
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie' && !event.visualOnly).length, 2);
});

test('each shotgun pellet penetrates two targets and the entire shot consumes one shell', () => {
  const { simulation, player, events } = combat('shotgun');
  const targets = [1, -1, -3].map((z, index) => zombie(simulation, `z${index}`, { z }));
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  close(targets[0].hp, 1000 - WEAPONS.shotgun.pellets * at('shotgun', 2.68));
  close(targets[1].hp, 1000 - WEAPONS.shotgun.pellets * at('shotgun', 4.68) * 0.45);
  assert.equal(targets[2].hp, 1000);
  assert.equal(player.inventory.shotgun.ammo, WEAPONS.shotgun.magazine - 1);
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie' && !event.visualOnly).length, WEAPONS.shotgun.pellets * 2);
});

test('later pellets never hit, kill or score a zombie already killed by this shot', () => {
  const { simulation, player, events } = combat('shotgun');
  zombie(simulation, 'front', { z: 1, y: 0, hp: 1 });
  zombie(simulation, 'back', { z: -1, y: 0, hp: 1 });
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  assert.equal(simulation.zombies.size, 0);
  assert.equal(player.kills, 2);
  assert.equal(player.score, 1 + 1 + 25, 'Their single health point each, no head-shot bonus, plus the second kill\'s chain bonus');
  assert.equal(events.filter(event => event.event === 'kill').length, 2);
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie' && !event.visualOnly).length, 2);
  assert.equal(events.filter(event => event.event === 'kill').length, 2);
});
