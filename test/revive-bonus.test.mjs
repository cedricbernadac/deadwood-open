import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, EXTRACTION_DURATION } from '../simulation.mjs';
import { REVIVE, REVIVE_SCORE_FLOOR, ECONOMY, MAX_WAVES } from '../public/rules.js';
import { completeRevive } from './helpers/revive.mjs';

// Revive bonuses (owner, 18 October): « relever quelqu'un ça devrait compter
// pas mal de points … ça te donne tous les dégâts que la personne que tu as
// relevée fait après que tu l'aies relevée dans cette vague … on te le donne
// à la fin de la vague ». At least REVIVE_SCORE_FLOOR; a copy, not a transfer.
function room(names = ['a', 'b', 'c'], { companions = [] } = {}) {
  const events = [];
  const simulation = new RoomSimulation('BONUS', { random: () => .5, raids: false, onEvent: event => events.push(event) });
  const players = names.map(name => simulation.addPlayer(name, name === 'a' ? 'Jules' : name === 'b' ? 'Léa' : name.toUpperCase(),
    undefined, companions.includes(name) ? { companion: true } : {}));
  simulation.start(names.find(name => !companions.includes(name)));
  simulation.beginWave(); simulation.toSpawn = 0; simulation.spawnTimer = 1e9;
  players.forEach((player, index) => Object.assign(player, { x: -4.5, y: 0, z: 1.5 - index * .9, yaw: 0, pitch: 0 }));
  return { simulation, players, events };
}
const down = (simulation, player) => Object.assign(player, { downed: true, hp: 0, bleedOutAt: simulation.time + REVIVE.bleedOut });
const named = (events, name) => events.filter(event => event.event === name);
// Damage of the revived survivor's own: any path goes through the same scoring.
function deal(simulation, player, amount) {
  const zombie = { id: `z${simulation.nextZombieId++}`, x: 10, y: 0, z: 10, hp: amount, maxHp: amount, kind: 'walker', scale: 1 };
  simulation.zombies.set(zombie.id, zombie);
  simulation.damageSpecialZombie(zombie, amount, player.id, { x: 0, z: 1 }, 'pistol');
}
const credits = simulation => simulation.reviveCredits.map(({ reviverId, revivedId, copied, open }) => [reviverId, revivedId, copied, open]);

test('a revive by hand and a kit used on a teammate open a credit; getting up by yourself does not', () => {
  const { simulation, players: [a, b, c], events } = room();
  down(simulation, b);
  assert.equal(completeRevive(simulation, 'a'), true);
  assert.equal(b.downed, false);
  assert.deepEqual(credits(simulation), [['a', 'b', 0, true]]);
  assert.equal(a.points, ECONOMY.revive, 'the coins at once'); assert.equal(a.score, 0, 'the score at the end of the wave');
  down(simulation, c); c.selfReviveAt = 0;
  a.reviveKit = true; simulation.time += 2;
  assert.equal(simulation.useReviveKit('a'), true);
  assert.equal(c.downed, false); assert.equal(a.points, 2 * ECONOMY.revive);
  assert.deepEqual(credits(simulation), [['a', 'b', 0, true], ['a', 'c', 0, true]]);
  // Own kit, started by hand or automatic at the end of the bleed-out (what
  // the tick does then). Going down closes the credit on that survivor.
  simulation.time += REVIVE.shield + .1;
  simulation.damagePlayer(b, 1e6, { id: 'z0' }); assert.equal(b.downed, true); b.reviveKit = true;
  assert.equal(simulation.useReviveKit('b'), true); simulation.time += REVIVE.kitDuration + .1; simulation.updateRevives(0);
  assert.equal(b.downed, false);
  simulation.damagePlayer(c, 1e6, { id: 'z0' }); assert.equal(c.downed, true); c.reviveKit = true;
  assert.equal(simulation.useReviveKit('c', true), true);
  assert.equal(c.downed, false);
  assert.ok(named(events, 'revive').some(event => event.automatic === true));
  assert.deepEqual(credits(simulation), [['a', 'b', 0, false], ['a', 'c', 0, false]], 'self-revives open nothing; the downs closed both credits');
});

test('the revived survivor\'s damage is copied, kept by them too, and paid at the end of the wave with a 150 floor', () => {
  for (const [dealt, paid] of [[0, REVIVE_SCORE_FLOOR], [40, REVIVE_SCORE_FLOOR], [1840, 1840]]) {
    const { simulation, players: [a, b], events } = room(['a', 'b']);
    deal(simulation, a, 10);
    down(simulation, b); completeRevive(simulation, 'a');
    if (dealt) deal(simulation, b, dealt);
    assert.equal(b.score, dealt, 'the revived survivor keeps their own score');
    assert.equal(a.score, 10);
    simulation.finishWave();
    assert.equal(simulation.phase, 'intermission');
    assert.equal(a.score, 10 + paid, `${dealt} dealt: ${paid} paid`);
    assert.equal(b.score, dealt, 'a copy, not a transfer');
    const [bonus] = named(events, 'revive-bonus');
    assert.deepEqual(bonus.payouts, [{ reviverId: 'a', revivedId: 'b', reviverName: 'Jules', revivedName: 'Léa', damage: dealt, amount: paid }]);
    assert.equal(bonus.reason, 'wave'); assert.equal(bonus.wave, 1);
    const snapshot = simulation.snapshot().players.find(player => player.id === 'a');
    assert.equal(snapshot.waveScore, 10 + paid, 'included in the wave\'s total');
    assert.equal(simulation.reviveCredits.length, 0, 'paid once');
    assert.ok(named(events, 'revive-bonus')[0].eventId < named(events, 'resupply')[0].eventId, 'before the break begins');
  }
});

test('going down again freezes the credit; the next reviver opens a new one; one open credit at most', () => {
  const { simulation, players: [a, b, c], events } = room();
  down(simulation, b); completeRevive(simulation, 'a');
  deal(simulation, b, 300);
  b.reviveShieldUntil = 0; simulation.damagePlayer(b, 1e6, { id: 'z0' });
  assert.equal(b.downed, true);
  deal(simulation, b, 999); // a burn lit before going down still scores for them, never for the frozen credit
  assert.deepEqual(credits(simulation), [['a', 'b', 300, false]]);
  simulation.time += 2; completeRevive(simulation, 'c');
  deal(simulation, b, 500);
  assert.deepEqual(credits(simulation), [['a', 'b', 300, false], ['c', 'b', 500, true]]);
  assert.equal(simulation.reviveCredits.filter(credit => credit.open && credit.revivedId === 'b').length, 1);
  simulation.finishWave();
  assert.deepEqual(named(events, 'revive-bonus')[0].payouts.map(({ reviverId, amount }) => [reviverId, amount]), [['a', 300], ['c', 500]]);
  assert.equal(a.score, 300); assert.equal(c.score, 500);
});

test('a reviver who left is paid to no one; a revived survivor who left still pays their reviver', () => {
  const { simulation, players: [a, b, c], events } = room();
  down(simulation, b); completeRevive(simulation, 'a');
  deal(simulation, b, 400);
  simulation.removePlayer('a');
  down(simulation, c); simulation.time += 2; completeRevive(simulation, 'b');
  deal(simulation, c, 250);
  simulation.removePlayer('c');
  assert.deepEqual(credits(simulation), [['a', 'b', 400, true], ['b', 'c', 250, false]]);
  simulation.finishWave();
  const [bonus] = named(events, 'revive-bonus');
  assert.deepEqual(bonus.payouts, [{ reviverId: 'b', revivedId: 'c', reviverName: 'Léa', revivedName: 'C', damage: 250, amount: 250 }]);
  assert.equal(b.score, 400 + 250);
});

test('companions follow the same rule as reviver and as revived', () => {
  const { simulation, players: [a, bot], events } = room(['a', 'bot'], { companions: ['bot'] });
  assert.equal(bot.companion, true);
  down(simulation, a); completeRevive(simulation, 'bot');
  deal(simulation, a, 700);
  down(simulation, bot); simulation.time += 2; completeRevive(simulation, 'a');
  deal(simulation, bot, 60);
  simulation.finishWave();
  assert.deepEqual(named(events, 'revive-bonus')[0].payouts.map(({ reviverId, revivedId, amount }) => [reviverId, revivedId, amount]),
    [['bot', 'a', 700], ['a', 'bot', REVIVE_SCORE_FLOOR]]);
  assert.equal(bot.score, 60 + 700); assert.equal(a.score, 700 + REVIVE_SCORE_FLOOR);
});

test('the bonuses are also paid when the night ends, at a game over and at a victory', () => {
  const lost = room(['a', 'b']);
  down(lost.simulation, lost.players[1]); completeRevive(lost.simulation, 'a');
  deal(lost.simulation, lost.players[1], 222);
  lost.simulation.endGame();
  assert.equal(lost.simulation.phase, 'gameover');
  assert.equal(lost.players[0].score, 222);
  assert.equal(named(lost.events, 'revive-bonus')[0].reason, 'gameover');

  const won = room(['a', 'b']), { simulation } = won;
  simulation.wave = MAX_WAVES; simulation.zombies.clear();
  down(simulation, won.players[1]); completeRevive(simulation, 'a');
  deal(simulation, won.players[1], 90);
  simulation.zombies.clear(); simulation.toSpawn = 0;
  assert.equal(simulation.finishWave(), true, 'the last wave goes to the extraction');
  assert.equal(simulation.phase, 'extraction');
  assert.equal(named(won.events, 'revive-bonus').length, 0, 'held through the extraction');
  for (let tick = 0; tick < Math.ceil(EXTRACTION_DURATION * 30) + 2; tick++) simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'victory');
  const [bonus] = named(won.events, 'revive-bonus');
  assert.equal(bonus.reason, 'victory'); assert.equal(bonus.payouts[0].amount, REVIVE_SCORE_FLOOR);
  assert.equal(won.players[0].score, REVIVE_SCORE_FLOOR);
});

test('a new night forgets every credit; the practice stand opens none', () => {
  const { simulation, players: [a, b] } = room(['a', 'b']);
  down(simulation, b); completeRevive(simulation, 'a');
  simulation.endGame(); assert.equal(simulation.reviveCredits.length, 0);
  simulation.reviveCredits.push({ reviverId: 'a', revivedId: 'b', revivedName: 'Léa', copied: 5, open: true });
  assert.equal(simulation.start('a'), true); assert.deepEqual(simulation.reviveCredits, []);
  const practice = new RoomSimulation('P', { practice: true });
  const first = practice.addPlayer('a'), second = practice.addPlayer('b');
  assert.equal(practice.beginReviveCredit(first, second), null);
  assert.deepEqual(practice.payReviveCredits('wave'), []);
});
