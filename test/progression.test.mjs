import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_WAVES, LEGACY_MAX_WAVES, boundedWave, difficultyLevel, waveAtDifficultyLevel } from '../public/progression.js';
import { ARMORY, grenadeDropsForWave, waveBalance } from '../public/rules.js';
import { enemyHealth, enemyHealthMean, enemyVariant } from '../public/enemies.js';

test('twenty actual rounds traverse the original difficulty continuously from one to thirty', () => {
  assert.equal(MAX_WAVES, 20); assert.equal(LEGACY_MAX_WAVES, 30);
  assert.equal(difficultyLevel(1), 1); assert.equal(difficultyLevel(MAX_WAVES), 30);
  assert.equal(difficultyLevel(2), 1 + 29 / 19);
  assert.equal(difficultyLevel(10.5), 15.5);
  assert.equal(boundedWave(-2), 1); assert.equal(boundedWave(999), MAX_WAVES);
  assert.equal(difficultyLevel(-2), 1); assert.equal(difficultyLevel(999), 30);
  for (const invalid of [NaN, Infinity, undefined]) assert.equal(difficultyLevel(invalid), 1);
  for (let old = 1; old <= 30; old++) {
    const first = waveAtDifficultyLevel(old);
    assert.ok(difficultyLevel(first) >= old - 1e-9);
    if (first > 1) assert.ok(difficultyLevel(first - 1) < old);
  }
});

test('compressed threat keeps its former thresholds independently of the revised weapon ladder', () => {
  assert.deepEqual([3, 4, 5, 7, 8].map(waveAtDifficultyLevel), [3, 3, 4, 5, 6]);
  assert.equal(waveBalance(2).runnerChance, 0); assert.ok(waveBalance(3).runnerChance > 0);
  assert.equal(waveBalance(3).brutes, 0); assert.equal(waveBalance(4).brutes, 1);
  assert.equal(waveBalance(5).brutes, 1); assert.equal(waveBalance(6).brutes, 2);
  for (const [wave, kind, appears] of [[2, 'crawler', false], [3, 'crawler', true], [4, 'armored', false], [5, 'armored', true]]) {
    const variants = Array.from({ length: 100 }, (_, index) => enemyVariant(wave, index + 1));
    assert.equal(variants.includes(kind), appears);
  }
  assert.equal(ARMORY.find(rack => rack.weapon === 'minigun').unlockWave, 12);
  assert.equal(ARMORY.find(rack => rack.weapon === 'magnum').unlockWave, 14);
});

test('the opening and final crowds, health families and six-grenade finale remain intact', () => {
  assert.deepEqual(Array.from({ length: 100 }, (_, index) => enemyHealth(1, index + 1)), Array(100).fill(80));
  assert.deepEqual([...new Set(Array.from({ length: 100 }, (_, index) => enemyHealth(2, index + 1)))].sort((a, b) => a - b), [80, 115], 'The second round begins a small visible adjacent-family mix');
  assert.equal(enemyHealthMean(20), 400);
  assert.equal(enemyHealthMean(20, true), 1400);
  assert.equal(enemyHealth(20, 1, 'brute', true), 6000);
  for (const players of [1, 4]) {
    assert.equal(waveBalance(1, players).total, players === 1 ? 8 : 21);
    assert.equal(waveBalance(20, players).total, players === 1 ? 160 : 568);
    assert.equal(waveBalance(19, players).bosses, 0); assert.equal(waveBalance(20, players).bosses, 1);
  }
  assert.deepEqual([0, 3, 4, 6, 7, 10, 11, 13, 14, 16, 17, 19, 20, 21].map(grenadeDropsForWave), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  assert.equal(waveBalance(21).wave, 20);
});
