import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { COMPANION_SHARE, MAX_WAVES, LEGACY_MAX_WAVES, waveBalance, defendedDoorIds, difficultyLevel, raidPlayers, raidTotal, raidSquad, BOSS_HP } from '../public/rules.js';
import { enemyHealthMean } from '../public/enemies.js';

// Owner, 13 October: "ils devraient compter pour des demi-joueurs". For the
// size of a wave an AI companion counts half a survivor; doors and raids
// keep whole survivors.

// waveBalance as it was before fractional counts (whole players only).
function wholeBalance(wave = 1, playerCount = 1) {
  const level = Math.max(1, Math.min(MAX_WAVES, Math.floor(Number.isFinite(wave) ? wave : 1)));
  const difficulty = difficultyLevel(level);
  const players = Math.max(1, Math.min(4, Math.floor(Number.isFinite(playerCount) ? playerCount : 1)));
  const progress = (difficulty - 1) / (LEGACY_MAX_WAVES - 1);
  const soloTotal = Math.round(8 + 92 * progress ** 1.08) + Math.round(60 * Math.max(0, (difficulty - 10) / 20) ** 1.15);
  return { wave: level, soloTotal, total: Math.round(soloTotal * (1 + (0.55 + 0.3 * progress) * (players - 1))),
    zombieHp: Math.round(enemyHealthMean(level)), headshotMultiplier: 2.2, walkerSpeed: 1.15 + 0.65 * progress, runnerSpeed: 1.85 + 0.6 * progress,
    runnerChance: difficulty < 3 ? 0 : 0.08 + 0.32 * progress, bruteHp: Math.round(enemyHealthMean(level, true)),
    brutes: difficulty >= 8 ? 2 : difficulty >= 5 ? 1 : 0, bosses: level === MAX_WAVES ? 1 : 0, bossHp: BOSS_HP,
    maxActive: Math.round(18 + 24 * progress + 6 * (players - 1)), spawnInterval: (1.1 - 0.84 * progress) / Math.sqrt(players) };
}

test('whole counts give exactly the waves of before; a half survivor lands between', () => {
  assert.equal(COMPANION_SHARE, .5);
  for (let wave = 1; wave <= MAX_WAVES; wave++) {
    for (const players of [1, 2, 3, 4]) assert.deepEqual({ ...waveBalance(wave, players) }, wholeBalance(wave, players), `wave ${wave}, ${players}`);
    for (const players of [1.5, 2.5, 3.5]) {
      const balance = waveBalance(wave, players), below = waveBalance(wave, players - .5), above = waveBalance(wave, players + .5);
      assert.ok(balance.total >= below.total && balance.total <= above.total, `wave ${wave}, ${players}: ${balance.total}`);
      assert.ok(balance.maxActive > below.maxActive && balance.maxActive < above.maxActive);
      assert.ok(balance.spawnInterval < below.spawnInterval && balance.spawnInterval > above.spawnInterval);
      assert.equal(balance.soloTotal, below.soloTotal); assert.equal(balance.zombieHp, below.zombieHp); assert.equal(balance.brutes, below.brutes);
    }
  }
  // One human and one companion: wave 1 has 10 zombies (solo 8, duo 12), wave 20 has 228 (160, 296).
  assert.equal(waveBalance(1, 1.5).total, 10); assert.equal(waveBalance(MAX_WAVES, 1.5).total, 228);
  assert.equal(waveBalance(4, 2.5).total, 40); assert.equal(waveBalance(4, 3.5).total, 52);
  // Clamped to 1..4, never NaN.
  assert.deepEqual(waveBalance(3, .5), waveBalance(3, 1)); assert.deepEqual(waveBalance(3, 4.5), waveBalance(3, 4));
  assert.deepEqual(waveBalance(3, NaN), waveBalance(3, 1));
});

test('doors and raids keep whole survivors: 1.5 is solo, 2.5 a duo, 3.5 three', () => {
  assert.deepEqual(defendedDoorIds(1.5), ['west', 'east']);
  assert.deepEqual(defendedDoorIds(2.5), ['west', 'east', 'north']);
  assert.deepEqual(defendedDoorIds(3.5), ['west', 'east', 'north', 'south']);
  for (const [count, whole] of [[1.5, 1], [2.5, 2], [3.5, 3]]) {
    assert.equal(raidPlayers(count), whole);
    assert.equal(raidTotal(2, count), raidTotal(2, whole)); assert.equal(raidSquad(count), raidSquad(whole));
  }
});

function room(humans, companions, { waiting = 0 } = {}) {
  const sim = new RoomSimulation('HALVES', { random: () => .5 });
  for (let index = 0; index < humans; index++) sim.addPlayer(`h${index}`, `Human ${index}`);
  for (let index = 0; index < companions; index++) sim.addPlayer(`ia${index}`, `IA ${index}`, undefined, { companion: true });
  sim.start('h0');
  for (let index = 0; index < waiting; index++) sim.addPlayer(`w${index}`, `Late ${index}`, undefined, { defer: true });
  return sim;
}
const active = sim => sim.doors.filter(door => !door.sealed && !door.sealPending).map(door => door.id).sort();

test('participants: a human counts 1, a companion half, one still waiting nothing', () => {
  for (const [humans, companions, count] of [[1, 0, 1], [1, 1, 1.5], [1, 2, 2], [1, 3, 2.5], [2, 1, 2.5], [2, 2, 3], [3, 1, 3.5], [4, 0, 4]]) {
    const sim = room(humans, companions);
    assert.equal(sim.participantCount(), count, `${humans} + ${companions}`);
    sim.beginWave();
    assert.equal(sim.wavePlayerCount, count);
    assert.equal(sim.toSpawn, waveBalance(1, count).total);
    assert.equal(sim.currentWaveBalance().maxActive, waveBalance(1, count).maxActive);
    assert.deepEqual(active(sim), defendedDoorIds(count).sort(), `${humans} + ${companions}: doors`);
    assert.equal(sim.snapshot().wavePlayerCount, count);
  }
  const late = room(1, 1, { waiting: 1 });
  assert.equal(late.participantCount(), 1.5, 'a human waiting to join counts from the next wave');
});

test('the wave keeps its frozen count; a raid plans for whole survivors', () => {
  const sim = room(1, 1);
  sim.beginWave();
  sim.removePlayer('ia0');
  assert.equal(sim.wavePlayerCount, 1.5, 'frozen for the wave under way');
  assert.equal(sim.currentWaveBalance().total, waveBalance(1, 1.5).total);
  const raid = room(1, 3);
  raid.wave = 4; raid.beginWave();
  assert.equal(raid.wave, 5); assert.equal(raid.wavePlayerCount, 2.5);
  assert.equal(raid.raid.players, 2); assert.equal(raid.raid.total, raidTotal(1, 2)); assert.equal(raid.raid.squad, raidSquad(2));
});

test('online rooms (never any companion) count whole connected survivors, with the same weights', () => {
  const sim = new OnlineRoomSimulation('ONLINE', { clock: () => 0, random: () => .5 });
  sim.addPlayer('a', 'A'); sim.addPlayer('b', 'B'); sim.addPlayer('c', 'C');
  assert.equal(sim.participantCount(), 3);
  sim.setConnected('c', false);
  assert.equal(sim.participantCount(), 2, 'a disconnected survivor does not count');
  assert.equal(Number.isInteger(sim.participantCount()), true);
  // Consistent with the LAN rule should one ever join.
  sim.players.get('b').companion = true;
  assert.equal(sim.participantCount(), 1.5);
});
