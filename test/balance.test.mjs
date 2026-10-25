import { sampleBulletAtDistance } from '../public/ballistics.js';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMORY, MAX_WAVES, difficultyLevel, waveBalance, enemyHealth } from '../public/rules.js';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { formationTrial, waveBudget, idealUnlockedLoadout } from '../validation/balance-report.mjs';

function room(players = 1) {
  const simulation = new RoomSimulation('CURVE1', { random: () => 0.5 });
  for (let index = 0; index < players; index++) simulation.addPlayer(`p${index}`);
  simulation.start('p0');
  return simulation;
}

test('the 20-wave curve grows smoothly, stays finite and scales with every extra survivor', () => {
  assert.equal(MAX_WAVES, 20);
  for (let players = 1; players <= 4; players++) {
    let previous = null;
    for (let wave = 1; wave <= MAX_WAVES; wave++) {
      const balance = waveBalance(wave, players);
      assert.ok(Object.values(balance).every(Number.isFinite));
      assert.equal(balance.headshotMultiplier, 2.2, 'The same exposed head must not gain an invisible round-dependent bonus');
      assert.ok(balance.spawnInterval > 0 && balance.runnerChance <= 0.4);
      assert.ok(balance.maxActive >= 18 && balance.maxActive <= 60);
      if (players > 1) assert.ok(balance.total > waveBalance(wave, players - 1).total);
      if (previous) {
        assert.ok(balance.total > previous.total);
        assert.ok(balance.zombieHp >= previous.zombieHp);
        assert.ok(balance.zombieHp / previous.zombieHp < 1.18, `HP must not jump abruptly at wave ${wave}`);
        assert.equal(balance.headshotMultiplier, previous.headshotMultiplier);
        assert.ok(balance.spawnInterval < previous.spawnInterval);
      }
      previous = balance;
    }
  }
  assert.equal(waveBalance(1, 1).total, 8);
  for (let wave = 1; difficultyLevel(wave) <= 10; wave++) {
    const progress = (difficultyLevel(wave) - 1) / 29;
    assert.equal(waveBalance(wave, 1).soloTotal, Math.round(8 + 92 * progress ** 1.08), 'Early pressure follows the compressed original curve');
  }
  assert.equal(waveBalance(MAX_WAVES, 1).total, 160);
  assert.equal(waveBalance(MAX_WAVES, 4).total, 568);
  assert.equal(waveBalance(1, 1).zombieHp, 80);
  assert.equal(waveBalance(MAX_WAVES, 1).zombieHp, 400);
  assert.deepEqual(waveBalance(NaN, Infinity), waveBalance(1, 1));
  assert.deepEqual(waveBalance(999, 99), waveBalance(MAX_WAVES, 4));
});

test('the server uses a fixed family health, constant headshot bonus and shared wave cadence', () => {
  const simulation = room();
  simulation.wave = 14;
  simulation.beginWave();
  const balance = waveBalance(15, 1);
  assert.equal(simulation.toSpawn, balance.total);
  const zombie = simulation.spawnZombie();
  assert.equal(zombie.hp, enemyHealth(15, 1, zombie.kind, zombie.boss));
  assert.equal(zombie.speed, balance.walkerSpeed);
  const player = simulation.players.get('p0');
  player.weapon = 'rifle';
  player.inventory.rifle = { ammo: WEAPONS.rifle.magazine, reserve: WEAPONS.rifle.reserve };
  Object.assign(player, { x: -4.4, y: 0, z: 1, yaw: 0, pitch: 0 });
  Object.assign(zombie, { x: -4.4, y: 0, z: -2, hp: 1000 });
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  assert.ok(Math.abs(zombie.hp - (1000 - sampleBulletAtDistance(WEAPONS.rifle, 2.68).damage * balance.headshotMultiplier)) < 1e-8);
  assert.equal(simulation.snapshot().headshotMultiplier, balance.headshotMultiplier);
  simulation.zombies.clear();
  simulation.spawnTimer = 0;
  simulation.tick(0);
  assert.equal(simulation.spawnTimer, balance.spawnInterval);
});

test('late two-weapon ammunition and every shared drop cannot clear the wave with isolated body shots', () => {
  for (let players = 1; players <= 4; players++) {
    for (let wave = 1; wave <= MAX_WAVES; wave++) {
      const budget = waveBudget(wave, players, { weapons: idealUnlockedLoadout(wave) });
      assert.ok(budget.remainingHp > 0);
      assert.ok(budget.alignedHeads >= budget.heads);
      assert.ok(budget.heads >= budget.body);
    }
    const end = waveBudget(MAX_WAVES, players);
    assert.deepEqual(end.weapons, ['rifle', 'shotgun']);
    assert.equal(end.ammoBoxes, Math.floor(end.enemies / 5));
    assert.ok(end.body < 1, 'Even doubled contact pellets and every shared box remain below the required isolated body damage');
    // The contact boost makes the bound exceed one for aligned body shots:
    // it places every penetrated body at zero distance with no overkill.
    // This impossible upper bound cannot prove a headshot requirement; the
    // finite production-cone trials below still check that actual constraint.
    assert.ok(end.alignedBody > 1, 'The optimistic contact bound must reflect the approved shotgun boost');
    assert.ok(end.alignedHeads > 1.2, 'Close aligned headshots retain a finite damage margin with the reduced two-weapon stock');
    assert.equal(end.magnumKills, 0, 'The two-slot fixture cannot silently include a third bonus gun');
  }
});

test('finite production-cone trials clear the final wave with aligned heads but fail either technique alone', () => {
  for (const players of [1, 4]) {
    for (const [heads, aligned] of [[false, false], [false, true], [true, false]]) {
      const trial = formationTrial({ players, heads, aligned, seed: 17 });
      assert.ok(trial.remaining > 0, `${players} players, heads=${heads}, aligned=${aligned}`);
      assert.equal(trial.ammoLeft, 0);
    }
  }
  for (let players = 1; players <= 4; players++) {
    const trial = formationTrial({ players, seed: 17 });
    assert.equal(trial.remaining, 0, `${players} players must have a constructively viable ideal formation`);
    assert.ok(trial.ammoLeft > 0);
    assert.deepEqual(Object.keys(trial.spent), ['rifle', 'shotgun']);
    assert.equal(trial.ammoCollected, Math.floor(trial.enemies / 5));
  }
});

test('hypothetically financed but unlocked loadouts have finite seeded aligned-head routes at 1–4 players', () => {
  for (const players of [1, 2, 3, 4]) {
    for (let wave = 1; wave <= MAX_WAVES; wave++) {
      const weapons = idealUnlockedLoadout(wave);
      const trial = formationTrial({ wave, players, seed: 17, weapons });
      assert.equal(trial.remaining, 0, `${players} players at wave ${wave}`);
      assert.ok(trial.ammoLeft > 0);
      assert.deepEqual(trial.weapons, weapons);
      assert.ok(weapons.every(name => wave >= ARMORY.find(rack => rack.weapon === name).unlockWave));
    }
    const withoutDrops = formationTrial({ players, pickups: false, seed: 17 });
    assert.ok(withoutDrops.remaining > 0, 'Collecting dropped ammunition is required late, even with ideal aim');
  }
});

test('ideal availability fixtures keep the pistol opening and never bypass the finite-trial wave locks', () => {
  assert.deepEqual(idealUnlockedLoadout(1), ['pistol']);
  assert.deepEqual(idealUnlockedLoadout(2), ['pistol', 'shotgun']);
  assert.deepEqual(idealUnlockedLoadout(7), ['pistol', 'shotgun']);
  assert.deepEqual(idealUnlockedLoadout(8), ['rifle', 'shotgun']);
  for (const [wave, weapons] of [[1,['pistol','shotgun']], [7,['rifle','shotgun']], [11,['rifle','minigun']], [13,['rifle','magnum']]]) {
    assert.throws(() => waveBudget(wave, 1, { weapons }), /unlocked/);
    assert.throws(() => formationTrial({ wave, players:1, weapons }), /unlocked/);
  }
  assert.equal(waveBudget(12, 1, { weapons:['rifle','minigun'] }).wave, 12);
  assert.equal(waveBudget(14, 1, { weapons:['rifle','magnum'] }).wave, 14);
});

test('several real cone seeds preserve close aligned-head routes and expose the bonus loadout limit', () => {
  for (const players of [1, 4]) {
    for (const seed of [17, 31, 71]) {
      for (const weapons of [['rifle', 'shotgun'], ['rifle', 'minigun']]) {
        const trial = formationTrial({ players, seed, weapons });
        assert.equal(trial.remaining, 0, `${weapons.join('+')}, ${players} players, seed ${seed}`);
        assert.equal(trial.dispersion, 'seeded production cone');
        assert.ok(trial.composition.runner > 0, 'Seeded trials include real fast variants');
      }
      const support = formationTrial({ players, seed, weapons: ['rifle', 'magnum'] });
      assert.ok(support.remaining > 0, 'A rare anti-colossus bonus is not falsely reported as a universal late-wave pairing');
      assert.equal(support.ammoLeft, 0);
    }
  }
  assert.deepEqual(formationTrial({ wave: 20, seed: 31 }), formationTrial({ wave: 20, seed: 31 }), 'The dispersion experiment is reproducible');
});

test('the common starting pistol handles wave 1 but does not replace late crate purchases', () => {
  for (const players of [1, 4]) {
    const start = formationTrial({ wave: 1, players, heads: false, aligned: false, starterOnly: true });
    assert.equal(start.remaining, 0);
    assert.ok(start.ammoLeft > 0);
    const end = formationTrial({ players, starterOnly: true });
    assert.ok(end.remaining > 0);
    assert.equal(end.ammoLeft, 0);
  }
});

test('bonus crates, switching and resupply cannot inflate their per-wave ammunition caps', () => {
  assert.equal(WEAPONS.pistol.magazine + WEAPONS.pistol.reserve, 48);
  assert.equal(WEAPONS.rifle.magazine + WEAPONS.rifle.reserve, 120);
  assert.equal(WEAPONS.shotgun.magazine + WEAPONS.shotgun.reserve, 32);
  assert.equal(WEAPONS.smg.magazine + WEAPONS.smg.reserve, 160);
  assert.equal(WEAPONS.minigun.magazine + WEAPONS.minigun.reserve, 150);
  assert.equal(WEAPONS.magnum.magazine + WEAPONS.magnum.reserve, 6);
  const simulation = room();
  simulation.wave = Math.max(...ARMORY.filter(crate => ['minigun','magnum'].includes(crate.weapon)).map(crate => crate.unlockWave));
  simulation.phase = 'wave';
  const player = simulation.players.get('p0');
  player.points = 20000;
  for (const name of ['minigun', 'magnum']) {
    // Replace the pistol, retaining minigun as the other freely chosen slot.
    simulation.chooseWeapon(player.id, 'pistol');
    const crate = ARMORY.find(crate => crate.weapon === name);
    Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1 });
    simulation.time += 1;
    assert.equal(simulation.buyWeapon(player.id, crate.id), true);
    const inventory = player.inventory[name];
    assert.equal(inventory.ammo + inventory.reserve, name === 'minigun' ? 150 : 6);
    Object.assign(inventory, { ammo: 0, reserve: 0 });
    const points = player.points;
    simulation.time += 1;
    assert.equal(simulation.buyWeapon(player.id, crate.id), true);
    assert.equal(player.points, points);
    assert.equal(inventory.ammo + inventory.reserve, 0, 'A purchased crate must select its weapon without refilling it');
    const other = Object.keys(player.inventory).find(weapon => weapon !== name);
    simulation.chooseWeapon(player.id, other);
    simulation.chooseWeapon(player.id, name);
    assert.equal(inventory.ammo + inventory.reserve, 0);
    assert.equal(simulation.reload(player.id), false);
  }
  simulation.finishWave();
  assert.equal(player.inventory.minigun.ammo + player.inventory.minigun.reserve, 150);
  assert.equal(player.inventory.magnum.ammo + player.inventory.magnum.reserve, 6);
});

test('active-actor caps preserve pending enemies, the exact wave size and delayed brute quotas', () => {
  for (const players of [1, 4]) {
    const simulation = room(players);
    simulation.wave = MAX_WAVES - 1;
    simulation.beginWave();
    simulation.updateZombie = () => {};
    const balance = waveBalance(MAX_WAVES, players);
    assert.equal(balance.maxActive, players === 1 ? 42 : 60);
    assert.equal(balance.total, players === 1 ? 160 : 568);
    const seen = new Map();
    const remember = () => {
      for (const zombie of simulation.zombies.values()) seen.set(zombie.id, zombie.kind);
    };
    for (let tick = 0; tick < 2000; tick++) simulation.tick(0.1);
    remember();
    assert.equal(simulation.zombies.size + simulation.spawnWarnings.size, balance.maxActive);
    assert.equal(simulation.spawnWarnings.size, 0, 'The woodland exits must have room to materialize the entire cap after 200 seconds');
    assert.equal(simulation.zombies.size, balance.maxActive);
    assert.equal(simulation.toSpawn, balance.total - balance.maxActive);
    assert.equal(simulation.snapshot().remaining, balance.total);
    assert.equal(simulation.phase, 'wave', 'The cap must never be mistaken for a cleared wave');
    assert.equal(simulation.brutesToSpawn, 2);
    // A reserved emergence is still part of the same finite wave. Drain the
    // warning queue too, so the final reservations are actually observed.
    while (simulation.toSpawn > 0 || simulation.spawnWarnings.size > 0) {
      simulation.zombies.delete(simulation.zombies.keys().next().value);
      simulation.tick(0.1);
      remember();
      assert.ok(simulation.zombies.size + simulation.spawnWarnings.size <= balance.maxActive);
    }
    assert.equal(seen.size, balance.total);
    assert.equal([...seen.values()].filter(kind => kind === 'brute').length, 2);
    assert.equal(simulation.brutesToSpawn, 0);
    assert.equal(simulation.phase, 'wave');
  }
});
