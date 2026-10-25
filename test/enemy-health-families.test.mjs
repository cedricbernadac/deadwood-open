import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { MAX_WAVES, difficultyLevel, waveBalance } from '../public/rules.js';
import { ENEMY_HEALTH, BRUTE_HEALTH, enemyHealth, enemyHealthMean, enemyAppearance, enemyProfile } from '../public/enemies.js';

test('a normal family has fixed health, and adjacent families mix gradually without random health inflation', () => {
  for (let wave = 1; wave <= MAX_WAVES; wave++) {
    const health = Array.from({length: 300}, (_, index) => enemyHealth(wave, index + 1));
    const distinct = [...new Set(health)].sort((a,b) => a-b);
    assert.ok(distinct.length <= 2, `wave${wave}: at most two neighbouring health families`);
    assert.ok(distinct.every(hp => ENEMY_HEALTH.includes(hp)));
    if (distinct.length === 2) assert.equal(ENEMY_HEALTH.indexOf(distinct[1]) - ENEMY_HEALTH.indexOf(distinct[0]), 1);
    const average = health.reduce((sum,hp) => sum+hp,0)/health.length;
    const mean = enemyHealthMean(wave), lower = ENEMY_HEALTH.findLast(hp => hp <= mean), upper = ENEMY_HEALTH.find(hp => hp >= mean);
    assert.ok(distinct.every(hp => hp === lower || hp === upper));
    // A very small blend may produce no upper-family member in this finite
    // sample. Bound rounding by the actual adjacent-family gap in that case.
    assert.ok(Math.abs(average-mean) <= (upper-lower)/health.length + 1e-6);
    if (wave === 1) assert.deepEqual(distinct,[80]);
    if (wave === MAX_WAVES) assert.deepEqual(distinct,[400]);
  }
  // A colour retains its meaning after the wave that introduced it.
  assert.equal(enemyHealth(10,1), enemyHealth(9,1));
  assert.equal(waveBalance(1).headshotMultiplier,waveBalance(MAX_WAVES).headshotMultiplier);
});

test('actual maximum health determines appearance across silhouettes, never remaining health', () => {
  const ids = ENEMY_HEALTH.map(maxHp => enemyAppearance({kind:'walker',maxHp}).id);
  assert.equal(new Set(ids).size,ENEMY_HEALTH.length);
  for (const maxHp of [...ENEMY_HEALTH,...BRUTE_HEALTH]) {
    const full = enemyAppearance({maxHp,hp:maxHp});
    const wounded = enemyAppearance({maxHp,hp:1});
    assert.equal(wounded,full);
    assert.ok(maxHp <= full.ceiling);
    assert.equal(enemyAppearance({kind:'crawler',maxHp}),full);
  }
  assert.equal(enemyAppearance({maxHp:180,kind:'crawler'}).id,'rust');
  assert.equal(enemyAppearance({maxHp:400,kind:'walker'}).id,'charcoal');
  assert.equal(enemyAppearance({maxHp:3600,hp:1,boss:true}).id,'overlord');
});

test('real spawns and network snapshots preserve fixed health families and each crawler silhouette', () => {
  const simulation = new RoomSimulation('FAMILY',{random:()=>.5});
  simulation.addPlayer('a'); simulation.start('a');
  for (const wave of [1,2,6,10,15,MAX_WAVES]) {
    simulation.zombies.clear(); simulation.wave=wave-1; simulation.beginWave();
    const total=simulation.toSpawn;
    for (let ordinal=1;ordinal<=total;ordinal++) {
      const zombie=simulation.spawnZombie();
      assert.equal(zombie.hp,enemyHealth(wave,ordinal,zombie.kind,zombie.boss));
      assert.equal(zombie.maxHp,zombie.hp);
      const bases=zombie.kind==='brute'?BRUTE_HEALTH:ENEMY_HEALTH;
      if (!zombie.boss) assert.ok(bases.some(hp=>Math.round(hp*enemyProfile(zombie).health)===zombie.maxHp));
    }
    for (const zombie of simulation.zombies.values()) zombie.hp=1;
    for (const zombie of simulation.snapshot().zombies) assert.equal(zombie.family,enemyAppearance(zombie).id);
  }
});

test('late pressure grows through population while early pressure follows compressed difficulty', () => {
  for (const players of [1,2,3,4]) {
    let previous=0;
    for (let wave=1;wave<=MAX_WAVES;wave++) {
      const balance=waveBalance(wave,players);
      assert.ok(balance.total>=previous);
      assert.ok(balance.maxActive<=60);
      assert.ok(balance.spawnInterval>0);
      if (difficultyLevel(wave)<=10) {
        const progress=(difficultyLevel(wave)-1)/29;
        const originalSolo=Math.round(8+92*progress**1.08);
        assert.equal(balance.total,Math.round(originalSolo*(1+(.55+.3*progress)*(players-1))));
      }
      previous=balance.total;
    }
  }
  assert.equal(waveBalance(MAX_WAVES,1).total,160);
  assert.equal(waveBalance(MAX_WAVES,4).total,568);
});
